/**
 * factureExportUtils.js — Pure helpers for the "Export Excel" feature of the
 * Factures module (Achats + Finance screens).
 *
 * Loaded twice (UMD, same pattern as caisseUtils.js):
 *   - In the browser via <script src="lib/factureExportUtils.js"> → window.FactureExportUtils
 *   - In node:test via require('./factureExportUtils.js') → module.exports
 *
 * All functions are pure (no DOM, no network, no Firestore). They take a plain
 * facture object as read from the `invoices` Firestore collection and produce
 * line-level data with a reconstructed (per-facture) VAT breakdown.
 *
 * 2026-06 — initial creation (lot export factures).
 *
 * 2026-06 (v5) — REVIREMENT de design (validé DG). Le taux de TVA par ligne ne
 * vient PLUS QUE du taux_tva SAISI en base. La devinette par mot-clé est
 * ABANDONNÉE : on a prouvé (analyse read-only) que la taxabilité dépend de la
 * FACTURE et non du produit (un même produit — KSC MIX, RHIZO AMINE, ECOVIGOR,
 * FERTIACTYL, SEACTIV, acides… — est facturé tantôt 20%, tantôt 0% selon la
 * facture). Conséquence :
 *   - taux ligne = parseSaisiTaux(taux_tva) si saisi (0 inclus = exonéré valide) ;
 *   - sinon (null/absent) → ligne "NON DÉTERMINÉE" (PAS 0, PAS de devinette).
 * normalizeDesignation / matchProduitTaxable / TAXABLE_PRODUCT_PATTERNS /
 * deriveTauxLigne sont conservés en CODE MORT documenté (référence historique),
 * mais ne sont PLUS appelés dans le calcul du taux ligne.
 */
// @ts-check
'use strict';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Standard Moroccan VAT rates, expressed as fractions (not percents). */
const STANDARD_TVA_RATES = [0, 0.07, 0.1, 0.14, 0.2];

/** Snap tolerance: if |derived − standard| < EPS, snap to the standard rate. */
const TVA_SNAP_EPS = 0.005;

/** Agricultural campaign starts in July (month index 6, 0-based). */
const CAMPAIGN_START_MONTH = 6; // July

// ----------------------------------------------------------------------------
// [CODE MORT — CONSERVÉ POUR RÉFÉRENCE — NON UTILISÉ DEPUIS v5]
// ----------------------------------------------------------------------------
// Devinette du taux par mot-clé : ABANDONNÉE (décision DG, juin 2026). Prouvé
// structurellement faux — la taxabilité dépend de la FACTURE, pas du produit
// (même produit facturé tantôt 20%, tantôt 0% selon la facture). Le bloc
// ci-dessous (normalizeDesignation / TAXABLE_PRODUCT_PATTERNS /
// matchProduitTaxable / deriveTauxLigne) n'est PLUS appelé dans le calcul du
// taux ligne ; il est laissé à titre d'archive de la règle historique.
// ----------------------------------------------------------------------------
// TVA PAR LIGNE — règle métier TIMAC (confirmée DG, février 2026)
// ----------------------------------------------------------------------------
// Chez TIMAC, SEULS ces produits sont taxables à 20% ; TOUS les autres engrais
// sont EXONÉRÉS (0%). Une même facture peut donc être MULTI-TAUX (engrais 0%
// + un acide 20%). On classe CHAQUE ligne par sa désignation.
//
// MÉTHODE DE MATCHING (robuste, pas de comparaison exacte fragile) :
//   1. normaliser la désignation via `normalizeDesignation()` :
//        - majuscules
//        - suppression des accents (NFD + strip des diacritiques)
//        - l'abréviation "AC." ou "AC " (mot isolé) → "ACIDE"
//        - collapse des espaces multiples + trim
//   2. tester la PRÉSENCE (substring) de chacun des motifs ci-dessous, eux-mêmes
//      déjà normalisés. Le test par inclusion gère les variantes du type
//      "ACIDE NITRIQUE 60%", "AC. NITRIQUE", casse mixte, accents, suffixes.
//
// Pour étendre la liste : ajouter un motif (déjà en MAJUSCULES, sans accent)
// dans TAXABLE_PRODUCT_PATTERNS. Les motifs multi-mots doivent utiliser des
// espaces simples (ils seront comparés à la désignation normalisée).
const TAXABLE_TVA_RATE = 0.2;

/**
 * Motifs (déjà normalisés) des produits TIMAC taxables à 20%. Étendre ici.
 *
 * NB : la règle DG nomme "Deptyl" ; le produit réel facturé par TIMAC s'écrit
 * "DEPTIL" (ex. "DEPTIL PA5 10 L"). On accepte les deux orthographes — même
 * produit.
 *
 * ---------------------------------------------------------------------------
 * ARBITRAGE DG (v4, 2026-06) — extension par déduction CERTAINE (subset-sum).
 * ---------------------------------------------------------------------------
 * Suite à l'analyse read-only des 24 factures flaggées "cas A" (TVA estimée
 * non réconciliée), le subset-sum a identifié de manière UNIQUE 6 familles de
 * produits qui portent à coup sûr 20% chez TIMAC. Le DG a validé leur ajout :
 *   FERTIACTYL, ECOVIGOR, SEACTIV, RHIZO, KSC, SULFATE DE MAGNESIE
 * Ces 6 familles couvrent les 12 produits déduits (KSC MIX, FERTIACTYL GREEN
 * EXTREME, FERTIACTYL GZ, RHIZO HUMUS, ECOVIGOR AA, RHIZO AMINE, RHIZO BORE,
 * SULFATE DE MAGNESIE, SEACTIV MAGICAL, KSC SULFACID, SEACTIV OPAL, SEACTIV
 * KALEO) → ~19 factures supplémentaires réconcilient.
 *
 * VIGILANCE FAUX POSITIFS :
 *   - "KSC" et "RHIZO" sont des motifs courts → risque de sur-matching. Vérifié
 *     sur les 55 factures TIMAC 25-26 : ils ne touchent QUE des produits TIMAC
 *     attendus (KSC ..., RHIZO ...), aucun engrais réellement exonéré.
 *   - "SULFATE DE MAGNESIE" en ENTIER (jamais "SULFATE" seul) pour ne PAS
 *     sur-matcher un éventuel sulfate exonéré.
 * Le garde-fou de réconciliation reste prioritaire : ces motifs n'ont AUCUN
 * effet sur une facture dont Σ(HT×taux) ≠ (TTC−HT) — elle reste flaggée.
 */
const TAXABLE_PRODUCT_PATTERNS = [
  // Motifs historiques (acides + Deptyl/Deptil).
  'DEPTYL',
  'DEPTIL',
  'ACIDE NITRIQUE',
  'ACIDE SULFURIQUE',
  'ACIDE PHOSPHORIQUE',
  // Extension v4 — familles déduites (subset-sum unique), arbitrage DG ci-dessus.
  'FERTIACTYL',
  'ECOVIGOR',
  'SEACTIV',
  'RHIZO',
  'KSC',
  'SULFATE DE MAGNESIE',
];

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Round to 2 decimals, the BerryGood way (matches backend Math.round(x*100)/100).
 * @param {number} n
 * @returns {number}
 */
function fxRound2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Parse a facture date. Accepts:
 *   - ISO `YYYY-MM-DD` (also tolerates a trailing time component)
 *   - French `DD/MM/YYYY`
 * Returns a Date at local midnight, or null if unparseable.
 * @param {string} value
 * @returns {Date|null}
 */
function parseFactureDate(value) {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  // ISO: YYYY-MM-DD (optionally followed by T... )
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  // French: DD/MM/YYYY
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Build the [start, end] Date bounds for an agricultural campaign.
 * Campaign N runs July N → June N+1.
 * @param {number} startYear e.g. 2025 → [2025-07-01, 2026-06-30]
 * @returns {{start: Date, end: Date, label: string}}
 */
function campaignBounds(startYear) {
  const y = Number(startYear);
  const start = new Date(y, CAMPAIGN_START_MONTH, 1);
  const end = new Date(y + 1, CAMPAIGN_START_MONTH, 0); // last day of June N+1
  end.setHours(23, 59, 59, 999);
  return { start, end, label: y + '-' + (y + 1) };
}

/**
 * Is a facture date within [start, end] (inclusive)? Unparseable dates → false.
 * @param {string} dateValue
 * @param {Date} start
 * @param {Date} end
 * @returns {boolean}
 */
function isWithinPeriod(dateValue, start, end) {
  const d = parseFactureDate(dateValue);
  if (!d) return false;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

/**
 * Année de campagne d'une date (campagne agricole juillet N → juin N+1).
 * Une date dont le mois >= juillet appartient à la campagne de son année ;
 * janvier→juin appartient à la campagne de l'année précédente.
 * @param {Date} d
 * @returns {number} startYear de la campagne
 */
function campaignYearOf(d) {
  const y = d.getFullYear();
  return d.getMonth() >= CAMPAIGN_START_MONTH ? y : y - 1;
}

/**
 * Dérive la liste des campagnes disponibles à partir d'une liste de dates de
 * factures (ISO ou dd/mm/yyyy). Retourne les campagnes du min au max année,
 * triées de la plus récente à la plus ancienne. Les dates illisibles sont
 * ignorées. Liste vide si aucune date exploitable.
 *
 * @param {Array<string|Date>} dates  valeurs date_facture brutes
 * @returns {Array<{year: number, label: string, bounds: {start: Date, end: Date, label: string}}>}
 */
function listAvailableCampaigns(dates) {
  const list = Array.isArray(dates) ? dates : [];
  let minY = null;
  let maxY = null;
  for (const raw of list) {
    const d = parseFactureDate(raw);
    if (!d) continue;
    const cy = campaignYearOf(d);
    if (minY === null || cy < minY) minY = cy;
    if (maxY === null || cy > maxY) maxY = cy;
  }
  if (minY === null) return [];
  const out = [];
  for (let y = maxY; y >= minY; y--) {
    const bounds = campaignBounds(y);
    out.push({ year: y, label: 'Campagne ' + bounds.label, bounds });
  }
  return out;
}

// ============================================================================
// TVA RATE DERIVATION
// ============================================================================

/**
 * Derive the VAT rate of a facture from its HT and TVA totals, snapping to the
 * nearest standard rate when close enough.
 *
 * @param {number} totalHt
 * @param {number} totalTva
 * @returns {{rate: number, nonStandard: boolean}} rate as a fraction (0.2 = 20%)
 */
function deriveTauxTva(totalHt, totalTva) {
  const ht = Number(totalHt) || 0;
  const tva = Number(totalTva) || 0;
  if (ht === 0) {
    // No base → treat as 0% (snapped, standard).
    return { rate: 0, nonStandard: false };
  }
  const raw = tva / ht;
  let best = null;
  let bestDelta = Infinity;
  for (const std of STANDARD_TVA_RATES) {
    const delta = Math.abs(raw - std);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = std;
    }
  }
  if (bestDelta < TVA_SNAP_EPS) {
    return { rate: best, nonStandard: false };
  }
  return { rate: raw, nonStandard: true };
}

// ============================================================================
// TVA PAR LIGNE — classification produit taxable / exonéré
// ============================================================================

/**
 * Normalise une désignation pour le matching produit (voir doc en tête de
 * fichier). Majuscules, sans accents, "AC."/"AC " → "ACIDE", espaces collapsés.
 * @param {string} designation
 * @returns {string}
 */
function normalizeDesignation(designation) {
  let s = String(designation == null ? '' : designation);
  s = s.toUpperCase();
  // Supprime les accents (décompose puis strip les diacritiques combinés).
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Abréviation "AC." (avec point) ou "AC" mot isolé → "ACIDE".
  // \bAC suivi soit d'un point, soit d'une limite de mot (mot "AC" isolé).
  s = s.replace(/\bAC(\.|\b)/g, 'ACIDE ');
  // (le remplacement peut introduire des espaces multiples → re-collapsés plus bas)
  // Collapse des espaces (y compris insécables déjà devenus espaces) + trim.
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * La désignation correspond-elle à un produit TIMAC taxable à 20% ?
 * @param {string} designation
 * @returns {boolean}
 */
function matchProduitTaxable(designation) {
  const norm = normalizeDesignation(designation);
  if (!norm) return false;
  for (const pattern of TAXABLE_PRODUCT_PATTERNS) {
    if (norm.indexOf(pattern) !== -1) return true;
  }
  return false;
}

/**
 * Taux de TVA d'une ligne selon sa désignation : 20 (taxable) ou 0 (exonéré).
 * Retourne un POURCENTAGE entier (0 | 20), pas une fraction.
 * @param {string} designation
 * @returns {0|20}
 */
function deriveTauxLigne(designation) {
  return matchProduitTaxable(designation) ? 20 : 0;
}

// ----------------------------------------------------------------------------
// CASCADE v3 — taux SAISI prioritaire, mot-clé en SECOURS
// ----------------------------------------------------------------------------
// Modèle de donnée réel (collection `invoices`, items[].taux_tva), observé sur
// les 55 factures TIMAC 25-26 :
//   - "non saisi" = `null` (cas largement majoritaire : 154/157 lignes).
//     `undefined` et `''` sont traités comme "non saisi" par prudence.
//   - "saisi" = un `number` exprimé en POURCENTAGE entier (ex. 20 pour 20%).
//     ATTENTION : 0 est un taux SAISI VALIDE (exonéré explicite), à NE PAS
//     confondre avec "non saisi". On ne le devine donc pas.
// On accepte aussi un taux saisi exprimé en fraction (≤ 1, ex. 0.2) par
// robustesse, et les strings numériques ("20", "20%").

/**
 * Parse le taux_tva SAISI d'une ligne. Distingue "saisi" (number/numérique,
 * 0 compris) de "non saisi" (null / undefined / '' / non numérique).
 *
 * @param {*} rawTaux  valeur brute de item.taux_tva
 * @returns {{saisi: boolean, rate: number}} rate = fraction (0.2 = 20%) si saisi
 */
function parseSaisiTaux(rawTaux) {
  if (rawTaux == null) return { saisi: false, rate: 0 }; // null OU undefined
  if (typeof rawTaux === 'string') {
    const s = rawTaux.trim().replace('%', '').replace(',', '.');
    if (s === '') return { saisi: false, rate: 0 };
    const n = Number(s);
    if (!isFinite(n)) return { saisi: false, rate: 0 };
    return { saisi: true, rate: n > 1 ? n / 100 : n };
  }
  if (typeof rawTaux === 'number') {
    if (!isFinite(rawTaux)) return { saisi: false, rate: 0 };
    // Stocké en pourcentage entier (20) ou en fraction (0.2) — on accepte les deux.
    return { saisi: true, rate: rawTaux > 1 ? rawTaux / 100 : rawTaux };
  }
  return { saisi: false, rate: 0 };
}

/**
 * Taux de TVA d'une ligne — v5, TAUX SAISI UNIQUEMENT (zéro devinette).
 *   1. taux_tva SAISI en base (number/numérique, 0 compris) → utilisé TEL QUEL.
 *   2. sinon (null/absent) → NON DÉTERMINÉ. On NE devine PLUS : rate = null,
 *      source = 'non_determine'. La ligne n'aura NI taux NI TVA exportés ("—").
 *
 * @param {Object} item  ligne de facture (article/designation, taux_tva)
 * @returns {{rate: (number|null), source: 'saisi'|'non_determine'}} rate = fraction (0.2 = 20%) ou null si non saisi
 */
function resolveTauxLigne(item) {
  const it = item || {};
  const parsed = parseSaisiTaux(it.taux_tva);
  if (parsed.saisi) {
    return { rate: parsed.rate, source: 'saisi' };
  }
  return { rate: null, source: 'non_determine' };
}

// ============================================================================
// LINE BUILDER (with per-facture VAT reconciliation)
// ============================================================================

/**
 * @typedef {Object} FactureLine
 * @property {string} designation
 * @property {number} quantite
 * @property {number} prix_unitaire
 * @property {number} montant_ht
 * @property {number} taux_tva        VAT rate applied to the line (fraction, 0.2 = 20%)
 * @property {number} montant_tva
 * @property {number} montant_ttc
 * @property {boolean} reconciled      false if the facture's per-line VAT could not
 *                                     be reconciled with the base (TTC − HT) → flagged.
 * @property {'saisi'|'non_determine'} taux_source  origine du taux (v5).
 */

/**
 * Libellés des états TVA (v5) — exportés tels quels dans la colonne
 * "Anomalie TVA" du récap.
 *
 * - ANOMALIE_TVA_B : vraie anomalie comptable. TOUTES les lignes ont un taux
 *   SAISI mais Σ(HT×taux) ≠ (TTC−HT) → la saisie ligne est incohérente avec le
 *   total facture (à vérifier en saisie).
 * - INFO_TVA_NON_SAISIE : INFORMATIF, PAS une anomalie. ≥ 1 ligne sans taux
 *   saisi → on ne peut pas ventiler la TVA par ligne, mais le total facture
 *   (TTC−HT) reste exact.
 */
const ANOMALIE_TVA_B = 'Incohérence saisie : Σ TVA lignes ≠ TVA facture';
const INFO_TVA_NON_SAISIE = 'TVA par ligne non saisie';

/**
 * Epsilon de réconciliation TVA : on tolère le bruit d'arrondi proportionnel au
 * nombre de lignes (chaque arrondi au centime peut dévier de ±0,005).
 * @param {number} nbLignes
 * @returns {number}
 */
function reconciliationEpsilon(nbLignes) {
  return Math.max(0.02, 0.005 * (Number(nbLignes) || 0));
}

/**
 * Construit les lignes d'une facture, avec TVA PAR LIGNE — v5 (TAUX SAISI
 * UNIQUEMENT, zéro devinette).
 *
 * SOURCE DE VÉRITÉ de la TVA facture = (TTC − HT) en base (jamais reconstruite).
 *
 * Pour chaque item :
 *   - montant_ht = item.montant_ht, sinon quantite × prix_unitaire
 *   - taux_ligne = parseSaisiTaux(taux_tva) si saisi (0 inclus), sinon null
 *     (NON DÉTERMINÉ — on ne devine plus). source = 'saisi' | 'non_determine'.
 *   - tva_ligne  = round(montant_ht × taux_ligne, 2) si saisi, sinon null ("—").
 *
 * TROIS ÉTATS (colonne "Anomalie TVA" du récap) :
 *   - CAS 1, toutes lignes SAISIES :
 *       · Σ(HT×taux_saisi) == tvaBase (epsilon) → RÉCONCILIÉ (anomalieType null,
 *         label vide). Le résidu d'arrondi est logé sur la dernière ligne pour
 *         que Σ tva_lignes === tvaBase au centime exact.
 *       · Σ != tvaBase → FLAG "Incohérence saisie" (anomalieType 'B').
 *   - CAS 2, ≥ 1 ligne SANS taux saisi (null) :
 *       · on NE PEUT PAS ventiler la TVA par ligne → INFORMATIF
 *         "TVA par ligne non saisie" (anomalieType 'info'). Ce n'est PAS une
 *         anomalie comptable : le total facture (TTC−HT) reste exact. Les lignes
 *         null portent taux_tva = null et montant_tva = null ("—"). Aucune
 *         répartition n'est inventée. reconciled = false (pour signaler que le
 *         détail n'est pas réconcilié), mais le label distingue clairement
 *         l'informatif de la vraie anomalie B.
 *
 * Sans items → ligne unique "(non détaillé)" : la TVA totale facture est connue
 * (TTC−HT) mais on ne dispose d'aucun taux saisi par ligne → état INFORMATIF
 * "TVA par ligne non saisie", taux/TVA ligne = null.
 *
 * @param {Object} facture
 * @returns {{lines: FactureLine[], reconciled: boolean, tvaBase: number, tvaClassee: number, ecartTva: number, hasTaxable: boolean, isMultiTaux: boolean, hasUndeterminedLine: boolean, allSaisi: boolean, anomalieType: ('B'|'info'|null), anomalieLabel: string}}
 */
function buildFactureLines(facture) {
  const fac = facture || {};
  const totalHt = fxRound2(fac.total_ht);
  const totalTtcRaw = fac.total_ttc != null
    ? fxRound2(fac.total_ttc)
    : fxRound2(totalHt + fxRound2(fac.total_tva));
  // TVA = source de vérité = (TTC − HT) en base.
  const tvaBase = fxRound2(totalTtcRaw - totalHt);
  const items = Array.isArray(fac.items) ? fac.items : [];

  // Sans items → ligne unique de repli. Aucun taux saisi par ligne disponible →
  // état INFORMATIF "TVA par ligne non saisie" (on NE devine NI taux NI TVA).
  if (items.length === 0) {
    const line = {
      designation: '(non détaillé)',
      quantite: 0,
      prix_unitaire: 0,
      montant_ht: totalHt,
      taux_tva: null,
      montant_tva: null,
      montant_ttc: null,
      reconciled: false,
      taux_source: 'non_determine',
    };
    return {
      lines: [line], reconciled: false, tvaBase, tvaClassee: 0,
      ecartTva: 0, hasTaxable: false, isMultiTaux: false,
      hasUndeterminedLine: true, allSaisi: false,
      anomalieType: 'info', anomalieLabel: INFO_TVA_NON_SAISIE,
    };
  }

  const lines = items.map((it) => {
    const qty = parseFloat(it.quantite) || 0;
    const pu = parseFloat(it.prix_unitaire) || 0;
    const mht = it.montant_ht != null && it.montant_ht !== ''
      ? fxRound2(it.montant_ht)
      : fxRound2(qty * pu);
    const designation = it.article || it.designation || '';
    const { rate, source } = resolveTauxLigne(it); // v5 : saisi → sinon null
    const saisi = source === 'saisi';
    const mtva = saisi ? fxRound2(mht * rate) : null;
    return {
      designation,
      quantite: qty,
      prix_unitaire: pu,
      montant_ht: mht,
      taux_tva: saisi ? rate : null,
      montant_tva: mtva,
      montant_ttc: saisi ? fxRound2(mht + mtva) : null,
      reconciled: true,
      taux_source: source,
    };
  });

  const hasUndeterminedLine = lines.some((l) => l.taux_source === 'non_determine');
  const allSaisi = !hasUndeterminedLine;

  // CAS 2 — ≥ 1 ligne sans taux saisi : INFORMATIF, pas de ventilation.
  // On NE force PAS Σ tva_lignes = tvaBase (on n'a pas de quoi ventiler). Le
  // total facture reste exact via le récap (TTC−HT). Les lignes null restent "—".
  if (hasUndeterminedLine) {
    const tvaClassee = fxRound2(
      lines.reduce((s, l) => s + (l.montant_tva || 0), 0)
    );
    lines.forEach((l) => { l.reconciled = false; });
    return {
      lines, reconciled: false, tvaBase, tvaClassee,
      ecartTva: fxRound2(tvaClassee - tvaBase),
      hasTaxable: lines.some((l) => l.taux_tva > 0),
      isMultiTaux: false,
      hasUndeterminedLine: true, allSaisi: false,
      anomalieType: 'info', anomalieLabel: INFO_TVA_NON_SAISIE,
    };
  }

  // CAS 1 — toutes les lignes ont un taux SAISI.
  const tvaClassee = fxRound2(lines.reduce((s, l) => s + l.montant_tva, 0));
  const ecartTva = fxRound2(tvaClassee - tvaBase);
  const eps = reconciliationEpsilon(lines.length);
  const reconciled = Math.abs(ecartTva) <= eps;

  const hasTaxable = lines.some((l) => l.taux_tva > 0);
  const hasExonere = lines.some((l) => l.taux_tva === 0);
  const isMultiTaux = hasTaxable && hasExonere;

  // Indice de la dernière ligne taxable (cible privilégiée du résidu) ; à défaut
  // la dernière ligne tout court.
  let targetIdx = lines.length - 1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].taux_tva > 0) { targetIdx = i; break; }
  }

  // Réconciliation (CAS 1 uniquement) : forcer Σ tva_lignes === tvaBase au
  // centime exact. Toutes les lignes ayant un taux saisi, la ventilation est
  // fiable ; on loge le seul résidu d'arrondi (réconcilié) ou l'écart complet
  // (anomalie B, total facture préservé).
  const residual = fxRound2(tvaBase - tvaClassee);
  if (residual !== 0) {
    const target = lines[targetIdx];
    target.montant_tva = fxRound2(target.montant_tva + residual);
    target.montant_ttc = fxRound2(target.montant_ht + target.montant_tva);
  }

  let anomalieType = null;
  let anomalieLabel = '';
  if (!reconciled) {
    lines.forEach((l) => { l.reconciled = false; });
    // Tout saisi mais Σ ≠ (TTC−HT) → anomalie de DONNÉE source (cas B).
    anomalieType = 'B';
    anomalieLabel = ANOMALIE_TVA_B;
  }

  return {
    lines, reconciled, tvaBase, tvaClassee, ecartTva, hasTaxable, isMultiTaux,
    hasUndeterminedLine: false, allSaisi: true, anomalieType, anomalieLabel,
  };
}

// ============================================================================
// RECAP SHEET — construction des lignes (pure, testable)
// ============================================================================

/**
 * Index des colonnes du récap (alignés sur recapHeader côté app.jsx /
 * gen-script). SOURCE DE VÉRITÉ partagée pour éviter tout décalage.
 *   0 N° Interne · 1 N° Facture · 2 BDC · 3 Fournisseur · 4 Date
 *   5 Total HT · 6 TVA · 7 Total TTC · 8 Écarts · 9 Anomalie TVA · 10 Statut
 */
const RECAP_COL = Object.freeze({
  NUM_INTERNE: 0, NUM_FACTURE: 1, BDC: 2, FOURNISSEUR: 3, DATE: 4,
  TOTAL_HT: 5, TVA: 6, TOTAL_TTC: 7, ECARTS: 8, ANOMALIE: 9, STATUT: 10,
});

/** Nombre de colonnes du récap. */
const RECAP_NB_COLS = 11;

/**
 * Construit les lignes du bloc "Récapitulatif par statut" (+ TOTAL général)
 * sous forme de descripteurs de cellules NEUTRES (indépendants de SheetJS) :
 *   - { kind: 'txt', v: string }
 *   - { kind: 'num', v: number }
 *   - { kind: 'cnt', v: number }   (entier sans format monnaie)
 * Chaque ligne fait EXACTEMENT RECAP_NB_COLS colonnes. "Nombre" est aligné sous
 * la colonne TVA (idx 6) et le montant sous la colonne Total TTC (idx 7), pour
 * NE PAS déborder sur la colonne Fournisseur (idx 3) — bug corrigé v5fix.
 *
 * @param {Array<Object>} scoped  factures exportées
 * @param {Object} statusLabels   map payment_status → libellé
 * @returns {Array<Array<{kind:string, v:*}>>}
 */
function buildRecapStatutRows(scoped, statusLabels) {
  const list = Array.isArray(scoped) ? scoped : [];
  const labels = statusLabels || {};
  const tcell = (v) => ({ kind: 'txt', v: v == null ? '' : String(v) });
  const ncell = (v) => ({ kind: 'num', v: Number(v) || 0 });
  const ccell = (v) => ({ kind: 'cnt', v: Number(v) || 0 });
  const row = (label, count, ttc) => {
    const r = new Array(RECAP_NB_COLS).fill(null).map(() => tcell(''));
    r[RECAP_COL.NUM_INTERNE] = tcell(label);
    if (count != null) r[RECAP_COL.TVA] = ccell(count);
    if (ttc != null) r[RECAP_COL.TOTAL_TTC] = ncell(ttc);
    return r;
  };
  const rows = [];
  // En-tête du bloc : "Nombre" sous TVA, "Total TTC" sous Total TTC.
  const header = row('Récapitulatif par statut', null, null);
  header[RECAP_COL.TVA] = tcell('Nombre');
  header[RECAP_COL.TOTAL_TTC] = tcell('Total TTC');
  rows.push(header);
  const STATUTS = ['non_payee', 'en_validation', 'validee_achats', 'validee_finance', 'validee_dg', 'payee'];
  STATUTS.forEach((st) => {
    const sub = list.filter((f) => f.payment_status === st);
    if (sub.length) {
      rows.push(row(labels[st] || st, sub.length, sub.reduce((s, f) => s + (Number(f.total_ttc) || 0), 0)));
    }
  });
  const totalTtc = list.reduce((s, f) => s + (Number(f.total_ttc) || 0), 0);
  rows.push(row('Total général', list.length, totalTtc));
  return rows;
}

// ============================================================================
// EXPORT API
// ============================================================================

const __factureExportApi = {
  // constants
  STANDARD_TVA_RATES, TVA_SNAP_EPS, CAMPAIGN_START_MONTH,
  TAXABLE_TVA_RATE, TAXABLE_PRODUCT_PATTERNS,
  ANOMALIE_TVA_B, INFO_TVA_NON_SAISIE,
  // helpers
  fxRound2, parseFactureDate, campaignBounds, isWithinPeriod, campaignYearOf, listAvailableCampaigns, reconciliationEpsilon,
  // [code mort — référence historique, NON utilisé depuis v5] devinette mot-clé
  normalizeDesignation, matchProduitTaxable, deriveTauxLigne,
  // TVA par ligne — v5 : taux SAISI uniquement
  parseSaisiTaux, resolveTauxLigne,
  // core
  deriveTauxTva, buildFactureLines,
  // récap sheet (pur, testable) — alignement colonnes
  RECAP_COL, RECAP_NB_COLS, buildRecapStatutRows,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __factureExportApi;
if (typeof window !== 'undefined') window.FactureExportUtils = __factureExportApi;
