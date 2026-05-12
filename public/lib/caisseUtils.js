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

/** Anomaly codes returned by detectCaisseAnomalies(). */
const ANOMALY_CODES = {
  DATE_ABERRANTE:      'DATE_ABERRANTE',
  MONTANT_INHABITUEL:  'MONTANT_INHABITUEL',
  DESCRIPTION_COURTE:  'DESCRIPTION_COURTE',
  ANALYTIQUE_VIDE:     'ANALYTIQUE_VIDE',
};

/** Threshold above which a montant is flagged as unusual (in DH). */
const MONTANT_ANOMALY_THRESHOLD = 50000;

/** Minimum description length (after trim) before flagging. */
const DESCRIPTION_MIN_LENGTH = 5;

/** Code analytique value considered "non précisé". */
const ANALYTIQUE_PLACEHOLDER = 'BGF - BGF';


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
// UMD-style export (browser global + CommonJS for node:test)
// ============================================================================

const __api = {
  // constants
  EXPENSE_TYPES, INCOME_TYPES, OP_EXPENSE_TYPES, OP_INCOME_TYPES, TRANSFER_TYPES,
  QUICK_PERIODS, QUICK_TYPES, ANOMALY_CODES,
  MONTANT_ANOMALY_THRESHOLD, DESCRIPTION_MIN_LENGTH, ANALYTIQUE_PLACEHOLDER,
  // functions
  detectCaisseAnomalies, computeTotals, quickPeriodToDateRange,
  searchTransactions, filterByQuickType,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __api;
if (typeof window !== 'undefined') window.CaisseUtils = __api;
