/**
 * caisseUtils.js — Pure helpers for the Gestion de Caisse "Transactions" screen.
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/caisseUtils.js"> → exposes window.CaisseUtils
 *   - In node:test via require('./caisseUtils.js') → exposes module.exports
 *
 * All functions are pure (no DOM, no network, no Firestore). The "now" parameter
 * is always optional and defaults to new Date() — tests should pass a fixed date.
 *
 * Sprint 1 (2026-05) — initial creation.
 */
// @ts-check
'use strict';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Transaction types that count as money OUT of the caisse. */
const EXPENSE_TYPES = ['depense', 'sortie', 'transfer_out'];

/** Transaction types that count as money IN to the caisse. */
const INCOME_TYPES  = ['alimentation', 'transfer_in'];

/** Pure operational expense types (excludes transfers). */
const OP_EXPENSE_TYPES = ['depense', 'sortie'];

/** Pure operational income types (excludes transfers). */
const OP_INCOME_TYPES = ['alimentation'];

/** Inter-caisse transfer types. */
const TRANSFER_TYPES = ['transfer_in', 'transfer_out'];

/** Quick-filter period chips, in display order. 'all' = no date filter. */
const QUICK_PERIODS = ['all', 'today', 'last7', 'thisMonth', 'lastMonth'];

/** Quick-filter type chips, in display order. 'all' = no type filter. */
const QUICK_TYPES   = ['all', 'depenses', 'recettes', 'transferts'];

/** Anomaly codes returned by detectCaisseAnomalies() and detectAnomaliesBatch(). */
const ANOMALY_CODES = {
  // Sprint 1 — per-tx rules
  DATE_ABERRANTE:      'DATE_ABERRANTE',
  MONTANT_INHABITUEL:  'MONTANT_INHABITUEL',
  DESCRIPTION_COURTE:  'DESCRIPTION_COURTE',
  ANALYTIQUE_VIDE:     'ANALYTIQUE_VIDE',
  // Sprint 2 — cross-dataset rules
  DOUBLON_PROBABLE:               'DOUBLON_PROBABLE',
  MONTANT_ATYPIQUE:               'MONTANT_ATYPIQUE',
  DESCRIPTION_GENERIQUE:          'DESCRIPTION_GENERIQUE',
  BENEFICIAIRE_IMPRECIS:          'BENEFICIAIRE_IMPRECIS',
  INCOHERENCE_CAISSE_ANALYTIQUE:  'INCOHERENCE_CAISSE_ANALYTIQUE',
};

/** Threshold above which a montant is flagged as unusual (in DH). */
const MONTANT_ANOMALY_THRESHOLD = 50000;

/** Minimum description length (after trim) before flagging. */
const DESCRIPTION_MIN_LENGTH = 5;

/** Code analytique value considered "non précisé". */
const ANALYTIQUE_PLACEHOLDER = 'BGF - BGF';

/** Sprint 2 — multiplier above the analytique-mean (90-day window) flagging MONTANT_ATYPIQUE. */
const MONTANT_ATYPIQUE_FACTOR = 3;

/** Sprint 2 — sliding window for MONTANT_ATYPIQUE mean computation, in days. */
const MONTANT_ATYPIQUE_WINDOW_DAYS = 90;

/** Sprint 2 — minimum sample size for MONTANT_ATYPIQUE mean to be considered significant. */
const MONTANT_ATYPIQUE_MIN_SAMPLE = 3;

/** Sprint 2 — max date delta (in days) for DOUBLON_PROBABLE candidate pairs. */
const DOUBLON_MAX_DATE_DELTA_DAYS = 1;

/** Sprint 2 — Levenshtein distance threshold below which two descriptions are considered duplicates. */
const DOUBLON_LEVENSHTEIN_THRESHOLD = 3;

/** Sprint 2 — length of description prefix used by the duplicate-detection Levenshtein. */
const DOUBLON_DESC_PREFIX_LEN = 20;

/** Sprint 2 — regex flagging a fully-generic description (case-insensitive, allows surrounding whitespace). */
const DESCRIPTION_GENERIC_REGEX = /^\s*(avance|achat|paiement|divers|frais)\s*$/i;

/** Sprint 2 — substring marker on caisse_id indicating Bahia perimeter (case-insensitive). */
const BAHIA_MARKER = 'bahia';


// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Detect data-quality anomalies on a single transaction.
 *
 * @param {Object} tx              Transaction (see typedef in JSDoc header).
 * @param {Date} [now=new Date()]  Inject a fixed date in tests.
 * @returns {Array<{code:string, message:string}>}
 */
function detectCaisseAnomalies(tx, now) {
  if (!tx || typeof tx !== 'object') return [];
  const ref = now instanceof Date ? now : new Date();
  const anomalies = [];

  // Rule 1 — DATE_ABERRANTE
  // date > now + 1 day OR date < now - 2 years (day-level granularity, inclusive bounds).
  if (tx.date) {
    const txDate = new Date(tx.date);
    if (!isNaN(txDate.getTime())) {
      const dayMs = 86400000;
      const refDay = Math.floor(ref.getTime() / dayMs);
      const txDay  = Math.floor(txDate.getTime() / dayMs);
      const maxDay = refDay + 1;          // tolerance: now + 1 day inclusive
      const minDay = refDay - (2 * 365);  // ~2 years inclusive
      if (txDay > maxDay || txDay < minDay) {
        anomalies.push({
          code: ANOMALY_CODES.DATE_ABERRANTE,
          message: `Date aberrante : ${tx.date}`,
        });
      }
    }
  }

  // Rule 2 — MONTANT_INHABITUEL
  // |montant| > threshold
  const montantNum = Number(tx.montant);
  if (Number.isFinite(montantNum) && Math.abs(montantNum) > MONTANT_ANOMALY_THRESHOLD) {
    anomalies.push({
      code: ANOMALY_CODES.MONTANT_INHABITUEL,
      message: `Montant inhabituel (${montantNum.toLocaleString('fr-FR')} DH > ${MONTANT_ANOMALY_THRESHOLD.toLocaleString('fr-FR')} DH)`,
    });
  }

  // Rule 3 — DESCRIPTION_COURTE
  // trimmed length < threshold
  const desc = typeof tx.description === 'string' ? tx.description.trim() : '';
  if (desc.length < DESCRIPTION_MIN_LENGTH) {
    anomalies.push({
      code: ANOMALY_CODES.DESCRIPTION_COURTE,
      message: 'Description manquante ou trop courte',
    });
  }

  // Rule 4 — ANALYTIQUE_VIDE
  // empty or === placeholder
  const ana = typeof tx.code_analytique === 'string' ? tx.code_analytique.trim() : '';
  if (!ana || ana === ANALYTIQUE_PLACEHOLDER) {
    anomalies.push({
      code: ANOMALY_CODES.ANALYTIQUE_VIDE,
      message: 'Analytique non précisé',
    });
  }

  return anomalies;
}


/**
 * Sum a list of transactions into operational totals + transfers + solde net.
 *
 * Returns:
 *   - count             : number of transactions
 *   - totalDepensesOp   : sum of montant for depense + sortie (POSITIVE number)
 *   - totalRecettes     : sum of montant for alimentation (POSITIVE number)
 *   - totalTransfers    : algebraic transfer_in − transfer_out (signed, near 0 in multi-caisse view)
 *   - soldeNet          : recettes + transfer_in − dépenses − sortie − transfer_out (signed)
 *
 * @param {Array<Object>} transactions
 * @returns {{count:number, totalDepensesOp:number, totalRecettes:number, totalTransfers:number, soldeNet:number}}
 */
function computeTotals(transactions) {
  const out = { count: 0, totalDepensesOp: 0, totalRecettes: 0, totalTransfers: 0, soldeNet: 0 };
  if (!Array.isArray(transactions)) return out;
  out.count = transactions.length;
  let transfersIn = 0, transfersOut = 0;
  for (const tx of transactions) {
    const m = Number(tx && tx.montant);
    if (!Number.isFinite(m)) continue;
    const t = tx.type;
    if (t === 'depense' || t === 'sortie') out.totalDepensesOp += m;
    else if (t === 'alimentation') out.totalRecettes += m;
    else if (t === 'transfer_in') transfersIn += m;
    else if (t === 'transfer_out') transfersOut += m;
  }
  out.totalTransfers = transfersIn - transfersOut;
  out.soldeNet = out.totalRecettes + transfersIn - out.totalDepensesOp - transfersOut;
  return out;
}


/**
 * Resolve a quick-period chip into an inclusive ISO date range.
 *
 *   - 'all'        → null
 *   - 'today'      → { from: today, to: today }
 *   - 'last7'      → last 7 days including today
 *   - 'thisMonth'  → 1st of current month → today
 *   - 'lastMonth'  → 1st → last day of previous month
 *
 * Local time zone (Africa/Casablanca on user's machine).
 *
 * @param {string} period
 * @param {Date} [now=new Date()]
 * @returns {{from:string,to:string}|null}
 */
function quickPeriodToDateRange(period, now) {
  if (period === 'all' || !period) return null;
  const ref = now instanceof Date ? new Date(now) : new Date();
  ref.setHours(0, 0, 0, 0);

  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };

  if (period === 'today') {
    const today = iso(ref);
    return { from: today, to: today };
  }
  if (period === 'last7') {
    const from = new Date(ref);
    from.setDate(from.getDate() - 6); // 7 days inclusive (today − 6 → today)
    return { from: iso(from), to: iso(ref) };
  }
  if (period === 'thisMonth') {
    const from = new Date(ref.getFullYear(), ref.getMonth(), 1);
    return { from: iso(from), to: iso(ref) };
  }
  if (period === 'lastMonth') {
    const from = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
    const to = new Date(ref.getFullYear(), ref.getMonth(), 0); // day 0 of current month = last day of previous
    return { from: iso(from), to: iso(to) };
  }
  return null; // unknown period treated as 'all'
}


/**
 * Normalize a string for accent-insensitive substring search.
 * Lowercases + strips diacritics + normalizes French decimal separator (',' → '.').
 *
 * @param {string|number|null|undefined} v
 * @returns {string}
 */
function _normalize(v) {
  if (v === null || v === undefined) return '';
  return String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/,/g, '.');
}


/**
 * Filter transactions by free-text query.
 *
 * - Normalize query: lowercase, strip diacritics, ',' → '.'.
 * - Split into whitespace-delimited tokens. Empty query → return input as-is.
 * - For each transaction, build a haystack from:
 *     description, reference, code_analytique, fournisseur,
 *     saisie_by.name, montant (string)
 *   normalized via _normalize().
 * - Keep transactions where EVERY token is a substring of the haystack (AND).
 *
 * @param {Array<Object>} transactions
 * @param {string} query
 * @returns {Array<Object>}
 */
function searchTransactions(transactions, query) {
  if (!Array.isArray(transactions)) return [];
  const q = _normalize(query).trim();
  if (!q) return transactions.slice();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return transactions.slice();

  return transactions.filter((tx) => {
    if (!tx) return false;
    // Include both the raw montant (e.g. "500") and the 2-decimal formatted
    // version (e.g. "500.00") so a query like "500,00" → normalized "500.00"
    // matches transactions with montant 500 or -500.
    const m = Number(tx.montant);
    const montantParts = [];
    if (Number.isFinite(m)) {
      montantParts.push(String(m));
      montantParts.push(m.toFixed(2));
      montantParts.push(Math.abs(m).toFixed(2));
    } else if (tx.montant !== undefined && tx.montant !== null) {
      montantParts.push(String(tx.montant));
    }
    const haystack = [
      tx.description,
      tx.reference,
      tx.code_analytique,
      tx.fournisseur,
      tx.saisie_by && tx.saisie_by.name,
      // Axes analytiques — cherchables au même titre que le code analytique.
      tx.ferme,
      tx.campagne,
      tx.culture,
      tx.parcelle,
      ...montantParts,
    ].map(_normalize).join(' | '); // separator unlikely to appear in data
    return tokens.every((tok) => haystack.indexOf(tok) !== -1);
  });
}


/**
 * Filter transactions by quick-type chip.
 *
 *   - 'all'         → unchanged
 *   - 'depenses'    → keep where type ∈ {depense, sortie}
 *   - 'recettes'    → keep where type === 'alimentation'
 *   - 'transferts'  → keep where type ∈ {transfer_in, transfer_out}
 *
 * @param {Array<Object>} transactions
 * @param {string} quickType
 * @returns {Array<Object>}
 */
function filterByQuickType(transactions, quickType) {
  if (!Array.isArray(transactions)) return [];
  if (!quickType || quickType === 'all') return transactions.slice();
  if (quickType === 'depenses')   return transactions.filter((tx) => tx && OP_EXPENSE_TYPES.indexOf(tx.type) !== -1);
  if (quickType === 'recettes')   return transactions.filter((tx) => tx && OP_INCOME_TYPES.indexOf(tx.type) !== -1);
  if (quickType === 'transferts') return transactions.filter((tx) => tx && TRANSFER_TYPES.indexOf(tx.type) !== -1);
  return transactions.slice();
}


// ============================================================================
// Sprint 2 — Private helpers (NOT exported)
// ============================================================================

/**
 * Bounded Levenshtein edit distance with early exit.
 *
 * Standard DP with two rolling rows (O(min(m,n)) memory). The early exit
 * kicks in when the minimum value of the current row exceeds maxDistance,
 * which is critical for the DOUBLON_PROBABLE rule on large datasets.
 *
 * Returns `maxDistance + 1` as a sentinel when the actual distance exceeds
 * the budget (so callers test with `<` not `===` against the threshold).
 *
 * @param {string} a
 * @param {string} b
 * @param {number} [maxDistance=Infinity]
 * @returns {number}
 */
function levenshtein(a, b, maxDistance) {
  const s = a == null ? '' : String(a);
  const t = b == null ? '' : String(b);
  const max = (typeof maxDistance === 'number' && Number.isFinite(maxDistance)) ? maxDistance : Infinity;
  if (s === t) return 0;
  // Quick early exit on length diff
  if (Math.abs(s.length - t.length) > max) return max + 1;

  const m = s.length;
  const n = t.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Two rolling rows
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    const sc = s.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = sc === t.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost      // substitution
      );
      curr[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1; // early exit — no chance to come back under budget
    // swap rows
    const tmp = prev; prev = curr; curr = tmp;
  }
  return prev[n];
}

/**
 * Convert an ISO date string ('YYYY-MM-DD') to an integer day index (UTC).
 * Returns NaN on failure.
 * @param {string} iso
 * @returns {number}
 */
function _dayIndex(iso) {
  if (!iso) return NaN;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return NaN;
  return Math.floor(d.getTime() / 86400000);
}


// ============================================================================
// Sprint 2 — detectAnomaliesBatch
// ============================================================================

/**
 * Detect anomalies on an entire list of transactions, combining:
 *   - Sprint 1 per-tx rules (via detectCaisseAnomalies — unchanged contract)
 *   - Sprint 2 cross-dataset rules: DOUBLON_PROBABLE, MONTANT_ATYPIQUE,
 *     DESCRIPTION_GENERIQUE, BENEFICIAIRE_IMPRECIS, INCOHERENCE_CAISSE_ANALYTIQUE.
 *
 * Returns Map<string, Anomaly[]> keyed by `tx.id || tx.reference`.
 * Transactions with zero anomalies are NOT in the map (absence = clean).
 *
 * For each tx with anomalies, the array is ordered:
 *   Sprint 1 codes (DATE → MONTANT → DESC → ANA), then
 *   Sprint 2 codes (DOUBLON → ATYPIQUE → GENERIQUE → IMPRECIS → INCOH).
 *
 * Performance: target < 500ms on 5000 tx. A naive O(N²) DOUBLON check
 * would be ~25M pairs on 5000 tx (≥ 5s with Levenshtein). The optimizations
 * are essential:
 *   1) pre-group by (caisse_id, montant) → only intra-group pairs compared
 *   2) within each group, sort by date and slide a ±1-day window
 *   3) Levenshtein with early-exit at DOUBLON_LEVENSHTEIN_THRESHOLD
 *
 * @param {Array<Object>} transactions
 * @param {Date} [now=new Date()]
 * @returns {Map<string, Array<{code:string, message:string}>>}
 */
function detectAnomaliesBatch(transactions, now) {
  const out = new Map();
  if (!Array.isArray(transactions) || transactions.length === 0) return out;
  const ref = now instanceof Date ? now : new Date();

  // ---- Pre-pass: compute MONTANT_ATYPIQUE means per analytique (within 90-day window) ----
  // maxDate = max of tx.date in the dataset (single computation)
  let maxDayIdx = -Infinity;
  for (const tx of transactions) {
    const di = _dayIndex(tx && tx.date);
    if (!isNaN(di) && di > maxDayIdx) maxDayIdx = di;
  }
  const windowStartDay = maxDayIdx - MONTANT_ATYPIQUE_WINDOW_DAYS;

  // Map<analytique, {sum, count}>
  const anaStats = new Map();
  for (const tx of transactions) {
    if (!tx) continue;
    const ana = typeof tx.code_analytique === 'string' ? tx.code_analytique.trim() : '';
    if (!ana) continue;
    const di = _dayIndex(tx.date);
    if (isNaN(di) || di < windowStartDay) continue;
    const m = Number(tx.montant);
    if (!Number.isFinite(m)) continue;
    const cur = anaStats.get(ana) || { sum: 0, count: 0 };
    cur.sum += Math.abs(m);
    cur.count += 1;
    anaStats.set(ana, cur);
  }

  // ---- DOUBLON_PROBABLE pre-grouping by (caisse_id, montant) ----
  // groupKey = `${caisse_id}|${montant}` ; value = list of {id, ref, dayIdx, descPrefix, tx}
  const doublonGroups = new Map();
  for (const tx of transactions) {
    if (!tx) continue;
    const di = _dayIndex(tx.date);
    if (isNaN(di)) continue;
    const m = Number(tx.montant);
    if (!Number.isFinite(m)) continue;
    if (!tx.caisse_id) continue;
    const key = tx.caisse_id + '|' + m;
    const descRaw = typeof tx.description === 'string' ? tx.description.trim().toLowerCase() : '';
    const entry = {
      id: tx.id || tx.reference || null,
      ref: tx.reference || tx.id || '?',
      dayIdx: di,
      descPrefix: descRaw.slice(0, DOUBLON_DESC_PREFIX_LEN),
    };
    if (!entry.id) continue;
    const arr = doublonGroups.get(key);
    if (arr) arr.push(entry); else doublonGroups.set(key, [entry]);
  }

  // For each group, compare pairs within ±1 day window (sorted by day)
  // Result: Map<txId, Array<refOfOther>>  (multiple entries per tx allowed)
  const doublonMatches = new Map();
  for (const arr of doublonGroups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => a.dayIdx - b.dayIdx);
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (b.dayIdx - a.dayIdx > DOUBLON_MAX_DATE_DELTA_DAYS) break; // sliding window cutoff
        // Bounded Levenshtein on first 20 chars
        const dist = levenshtein(a.descPrefix, b.descPrefix, DOUBLON_LEVENSHTEIN_THRESHOLD);
        if (dist < DOUBLON_LEVENSHTEIN_THRESHOLD) {
          const aArr = doublonMatches.get(a.id) || [];
          aArr.push(b.ref);
          doublonMatches.set(a.id, aArr);
          const bArr = doublonMatches.get(b.id) || [];
          bArr.push(a.ref);
          doublonMatches.set(b.id, bArr);
        }
      }
    }
  }

  // ---- Main pass: per-tx Sprint 1 rules + Sprint 2 rules ----
  for (const tx of transactions) {
    if (!tx) continue;
    const key = tx.id || tx.reference;
    if (!key) continue;

    // Sprint 1 anomalies (existing function — unchanged)
    const anomalies = detectCaisseAnomalies(tx, ref).slice();

    // Sprint 2 — DOUBLON_PROBABLE
    const dm = doublonMatches.get(key);
    if (dm && dm.length > 0) {
      for (const otherRef of dm) {
        anomalies.push({
          code: ANOMALY_CODES.DOUBLON_PROBABLE,
          message: `Doublon probable avec réf. ${otherRef}`,
        });
      }
    }

    // Sprint 2 — MONTANT_ATYPIQUE
    // Excludes the candidate tx itself from the mean to avoid self-biasing on small samples.
    const ana = typeof tx.code_analytique === 'string' ? tx.code_analytique.trim() : '';
    const m = Number(tx.montant);
    if (ana && Number.isFinite(m)) {
      const di = _dayIndex(tx.date);
      const stats = anaStats.get(ana);
      if (stats && !isNaN(di) && di >= windowStartDay) {
        const sampleCount = stats.count - 1; // exclude self
        if (sampleCount >= MONTANT_ATYPIQUE_MIN_SAMPLE) {
          const sumOthers = stats.sum - Math.abs(m);
          const mean = sumOthers / sampleCount;
          if (mean > 0 && Math.abs(m) > mean * MONTANT_ATYPIQUE_FACTOR) {
            anomalies.push({
              code: ANOMALY_CODES.MONTANT_ATYPIQUE,
              message: `Montant atypique pour cet analytique (moy : ${Math.round(mean)} DH)`,
            });
          }
        }
      }
    }

    // Sprint 2 — DESCRIPTION_GENERIQUE
    const desc = typeof tx.description === 'string' ? tx.description : '';
    if (DESCRIPTION_GENERIC_REGEX.test(desc)) {
      anomalies.push({
        code: ANOMALY_CODES.DESCRIPTION_GENERIQUE,
        message: 'Description trop générique',
      });
    }

    // Sprint 2 — BENEFICIAIRE_IMPRECIS
    // Description commence par AVANCE ou PAIEMENT (mot entier), mais aucun token
    // capitalisé (1ère lettre en majuscule unicode) ET de longueur > 3 après le mot-clé.
    // Heuristique littérale du spec — faux négatifs possibles (e.g. "Avance Achat"),
    // à affiner Sprint 3.
    const beneficMatch = desc.match(/^\s*(avance|paiement)\b\s*(.*)$/i);
    if (beneficMatch) {
      const rest = beneficMatch[2] || '';
      const tokens = rest.split(/\s+/).filter(Boolean);
      const hasCapName = tokens.some((tok) => tok.length > 3 && /^[A-ZÀ-Ý]/.test(tok));
      if (!hasCapName) {
        anomalies.push({
          code: ANOMALY_CODES.BENEFICIAIRE_IMPRECIS,
          message: 'Bénéficiaire à préciser',
        });
      }
    }

    // Sprint 2 — INCOHERENCE_CAISSE_ANALYTIQUE
    // Skip for transfer types (transfer_in/out) — transferts inter-caisses ont souvent
    // un analytique vide ou inter-périmètre par design.
    // Skip if analytique vide (déjà couvert par ANALYTIQUE_VIDE Sprint 1).
    const caisseLower = typeof tx.caisse_id === 'string' ? tx.caisse_id.toLowerCase() : '';
    const anaLower = ana.toLowerCase();
    const isTransfer = tx.type === 'transfer_in' || tx.type === 'transfer_out';
    if (!isTransfer && ana && caisseLower.indexOf(BAHIA_MARKER) !== -1 && anaLower.indexOf(BAHIA_MARKER) === -1) {
      anomalies.push({
        code: ANOMALY_CODES.INCOHERENCE_CAISSE_ANALYTIQUE,
        message: 'Analytique incohérent avec la caisse',
      });
    }

    if (anomalies.length > 0) out.set(key, anomalies);
  }

  return out;
}


// ============================================================================
// Sprint 3 — Suivi des avances
// ============================================================================

/** Regex for detecting an "avance" transaction by description. */
const AVANCE_KEYWORD_REGEX = /^(avances?|acomptes?)\b/i;

/** Tokens we strip iteratively at the start of the residual (prepositions, civilities, contexts). */
const _BENEF_NOISE_REGEX = /^(?:au?x?|à|en\s+faveur\s+de|vers[ée]+s?\s+(?:au?x?|à)|achat|sur\s+(?:salaire|location|loyer|le|la)|sur|pour\s+(?:les\s+)?|pour|de\s+la|de|du|le|la|mr\.?|mme\.?|mlle\.?|m\.|m\.o\.?|m\.o|mo|monsieur|madame)\b\s*/i;

/** Tokens that mark the start of a "purpose" suffix (cuts off the name). */
const _BENEF_PURPOSE_CUT_REGEX = /\b(?:pour|sur|installation|instalation|location|maison|gasoil|salaire|travaux|traveaux|nivellement|construction|toilette|paie|paiment|paiement|cordage|corde|transport|nitrate|loyer|terrain|réparation|reparation|cover\s+crop|engrais|pesticide|vente|d['’ ]agadir|d['’ ]\s*agadir)\b/i;

/** Cut at the "demande par/demandé par/demanded by" pattern to drop the requester. */
const _BENEF_REQUESTER_CUT_REGEX = /\b(?:demand[ée]?e?s?\s+par|demand[ée]?\s+par|demanded\s+by)\b/i;

/**
 * Extract a beneficiary name from an "avance" transaction description.
 * Returns null if the description is not an avance, or no individual beneficiary
 * can be identified (collective avances like "8 GARDIENNES", purpose-only like
 * "POUR INSTALATION", or main-d'oeuvre collective "M.O").
 *
 * Output is always UPPERCASE (key normalized for aggregation, regardless of input casing).
 *
 * @param {string} description
 * @returns {string|null}
 */
function extractBeneficiaire(description) {
  if (!description || typeof description !== 'string') return null;
  let s = description.trim();
  if (!s) return null;

  // 1. Must start with avance|acompte
  if (!AVANCE_KEYWORD_REGEX.test(s)) return null;

  // 2. Strip the keyword
  s = s.replace(AVANCE_KEYWORD_REGEX, '').trim();
  if (!s) return null;

  // 3. Cut at "DEMANDE PAR" — keep what's before (the actual beneficiary)
  const cutReq = s.search(_BENEF_REQUESTER_CUT_REGEX);
  if (cutReq >= 0) s = s.slice(0, cutReq).trim();
  if (!s) return null;

  // 4. Strip leading noise tokens iteratively (prepositions, civilities, contexts)
  let prev;
  do { prev = s; s = s.replace(_BENEF_NOISE_REGEX, '').trim(); } while (s !== prev && s);
  if (!s) return null;

  // 5. Cut at purpose-marker (the words after are not part of the name)
  // We only apply this AFTER stripping leading noise so the cut doesn't fire on the leading "SUR/POUR".
  const cutPurp = s.search(_BENEF_PURPOSE_CUT_REGEX);
  if (cutPurp >= 0) s = s.slice(0, cutPurp).trim();
  if (!s) return null;

  // 6. Normalize: strip trailing noise punctuation (quotes, commas, etc.) but KEEP
  //    trailing dots so abbreviations like "Mohamed H." are preserved. Collapse spaces.
  s = s.replace(/[\s"',;:!?\-–—()/\\]+$/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // 7. Reject collective numbered groups (e.g. "8 GARDIENNES D'AGADIR" — D1 adjusted)
  if (/^\d/.test(s)) return null;

  // 8. Must contain at least one letter, length >= 2
  if (s.length < 2 || !/[A-Za-zÀ-ÿ]/.test(s)) return null;

  return s.toUpperCase();
}


/**
 * Aggregate "avance" transactions by beneficiary.
 *
 * Filters input to keep only depense + status=valide + description matching
 * an avance keyword. Groups by extractBeneficiaire(description). Transactions
 * whose beneficiary cannot be identified are counted in `unidentifiedCount`.
 *
 * For each beneficiary, computes:
 *   - avances: Array<tx>
 *   - totalAvance: sum of montant
 *   - totalRegularise: sum of regularisations[].montant across all avances
 *   - soldeDu: totalAvance - totalRegularise (≥ 0)
 *   - ancienneteDate: date of the OLDEST tx with solde > 0 (or null)
 *   - ancienneteJours: days between ancienneteDate and `now` (or null)
 *
 * By default avances that are fully soldées (soldeDu == 0) are filtered OUT
 * from the byBeneficiaire Map. Pass options.showSoldees=true to include them.
 *
 * @param {Array<Object>} transactions
 * @param {Date} [now=new Date()]
 * @param {{showSoldees?: boolean}} [options]
 * @returns {{byBeneficiaire: Map<string, Object>, unidentifiedCount: number}}
 */
function aggregateAvances(transactions, now, options) {
  const out = { byBeneficiaire: new Map(), unidentifiedCount: 0 };
  if (!Array.isArray(transactions)) return out;
  const opts = options || {};
  const showSoldees = !!opts.showSoldees;
  const ref = now instanceof Date ? now : new Date();

  for (const tx of transactions) {
    if (!tx) continue;
    if (tx.type !== 'depense') continue;
    if (tx.status !== 'valide') continue;
    const desc = typeof tx.description === 'string' ? tx.description : '';
    if (!AVANCE_KEYWORD_REGEX.test(desc.trim())) continue;

    const benef = extractBeneficiaire(desc);
    if (!benef) { out.unidentifiedCount++; continue; }

    const cur = out.byBeneficiaire.get(benef) || {
      avances: [],
      totalAvance: 0,
      totalRegularise: 0,
      soldeDu: 0,
      ancienneteDate: null,
      ancienneteJours: null,
    };
    cur.avances.push(tx);
    const m = Number(tx.montant) || 0;
    cur.totalAvance += m;
    const regs = Array.isArray(tx.regularisations) ? tx.regularisations : [];
    const regSum = regs.reduce(function (s, r) { return s + (Number(r && r.montant) || 0); }, 0);
    cur.totalRegularise += regSum;
    out.byBeneficiaire.set(benef, cur);
  }

  // Compute soldes + ancienneté per beneficiary, then filter soldées if needed
  for (const [key, cur] of out.byBeneficiaire) {
    cur.soldeDu = Math.max(0, cur.totalAvance - cur.totalRegularise);
    // Find oldest avance with solde > 0 (per-avance solde)
    let oldest = null;
    for (const tx of cur.avances) {
      const m = Number(tx.montant) || 0;
      const regs = Array.isArray(tx.regularisations) ? tx.regularisations : [];
      const regSum = regs.reduce(function (s, r) { return s + (Number(r && r.montant) || 0); }, 0);
      const txSolde = m - regSum;
      if (txSolde > 0) {
        if (!oldest || (tx.date || '') < (oldest.date || '')) oldest = tx;
      }
    }
    if (oldest) {
      cur.ancienneteDate = oldest.date || null;
      const od = new Date(oldest.date);
      if (!isNaN(od.getTime())) {
        cur.ancienneteJours = Math.max(0, Math.floor((ref.getTime() - od.getTime()) / 86400000));
      } else {
        cur.ancienneteJours = null;
      }
    } else {
      cur.ancienneteDate = null;
      cur.ancienneteJours = null;
    }
    if (!showSoldees && cur.soldeDu <= 0) {
      out.byBeneficiaire.delete(key);
    }
  }

  return out;
}

// ============================================================================
// COMPTES CLIENTS MARCHÉ LOCAL (sous-lot 4.4) — read-only aggregation
// ============================================================================

/**
 * Prefix that identifies a "compte client marché local" caisse id.
 * The 5 client accounts live as caisse_definitions with id
 * 'compte_client_<client_id>' (e.g. compte_client_mustapha_chafik_a).
 */
const COMPTE_CLIENT_PREFIX = 'compte_client_';

/**
 * Returns true if a caisse is a marché-local client account.
 * Detection is by id prefix (no dedicated `kind` field is guaranteed in DB);
 * if a `kind` field equal to 'compte_client_marche_local' is present it also
 * qualifies, for forward compatibility.
 *
 * @param {{id?: string, kind?: string}} caisse
 * @returns {boolean}
 */
function isCompteClientCaisse(caisse) {
  if (!caisse || typeof caisse !== 'object') return false;
  if (caisse.kind === 'compte_client_marche_local') return true;
  return typeof caisse.id === 'string' && caisse.id.indexOf(COMPTE_CLIENT_PREFIX) === 0;
}

/**
 * Aggregates a client's transactions into totals for the read-only account view.
 * - totalVendu     = Σ montant of type 'vente'
 * - totalEncaisse  = Σ montant of type 'encaissement'
 * - resteDu        = totalVendu - totalEncaisse
 *
 * Pure: no DOM, no network. Ignores non vente/encaissement types.
 *
 * @param {Array<{type?: string, montant?: number}>} transactions
 * @returns {{totalVendu: number, totalEncaisse: number, resteDu: number, nbVentes: number, nbEncaissements: number}}
 */
function computeCompteClientTotals(transactions) {
  const list = Array.isArray(transactions) ? transactions : [];
  let totalVendu = 0;
  let totalEncaisse = 0;
  let nbVentes = 0;
  let nbEncaissements = 0;
  for (const t of list) {
    if (!t || typeof t !== 'object') continue;
    const m = Number(t.montant) || 0;
    if (t.type === 'vente') { totalVendu += m; nbVentes += 1; }
    else if (t.type === 'encaissement') { totalEncaisse += m; nbEncaissements += 1; }
  }
  return {
    totalVendu,
    totalEncaisse,
    resteDu: totalVendu - totalEncaisse,
    nbVentes,
    nbEncaissements,
  };
}


// ============================================================================
// UMD-style export (browser global + CommonJS for node:test)
// ============================================================================

const __api = {
  // constants — Sprint 1
  EXPENSE_TYPES, INCOME_TYPES, OP_EXPENSE_TYPES, OP_INCOME_TYPES, TRANSFER_TYPES,
  QUICK_PERIODS, QUICK_TYPES, ANOMALY_CODES,
  MONTANT_ANOMALY_THRESHOLD, DESCRIPTION_MIN_LENGTH, ANALYTIQUE_PLACEHOLDER,
  // constants — Sprint 2
  MONTANT_ATYPIQUE_FACTOR, MONTANT_ATYPIQUE_WINDOW_DAYS, MONTANT_ATYPIQUE_MIN_SAMPLE,
  DOUBLON_MAX_DATE_DELTA_DAYS, DOUBLON_LEVENSHTEIN_THRESHOLD, DOUBLON_DESC_PREFIX_LEN,
  DESCRIPTION_GENERIC_REGEX, BAHIA_MARKER,
  // constants — Sprint 3
  AVANCE_KEYWORD_REGEX,
  // functions — Sprint 1
  detectCaisseAnomalies, computeTotals, quickPeriodToDateRange,
  searchTransactions, filterByQuickType,
  // functions — Sprint 2
  detectAnomaliesBatch,
  // functions — Sprint 3
  extractBeneficiaire, aggregateAvances,
  // constants — Comptes Clients Marché Local (sous-lot 4.4)
  COMPTE_CLIENT_PREFIX,
  // functions — Comptes Clients Marché Local (sous-lot 4.4)
  isCompteClientCaisse, computeCompteClientTotals,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __api;
if (typeof window !== 'undefined') window.CaisseUtils = __api;
