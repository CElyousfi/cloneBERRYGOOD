/**
 * inventaireUtils.js — Pure helpers for the Inventaire (Magasinier) screen.
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/inventaireUtils.js"> → window.InventaireUtils
 *   - In node:test via require('./inventaireUtils.js') → module.exports
 *
 * All functions are pure (no DOM, no network, no Firestore). They power the
 * footer TOTAL row (per-unit quantity subtotals + monetary total) and the export
 * Excel, and the chronological ledger cumul of the "Détail des mouvements" popup.
 *
 * 2026-06 — initial creation (feat/inventaire-export-total).
 */
// @ts-check
'use strict';

/**
 * Round to 2 decimals (banker-agnostic, suffices for stock quantities/money).
 * @param {number} n
 * @returns {number}
 */
function inv_round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Computes the footer totals over the *currently displayed* rows:
 *   - prix_total_sum: sum of positive prix_total (monetary, common unit DH).
 *   - qte_par_unite: subtotals of `balance` grouped by `unite` (never a mixed sum).
 *   - count: number of rows.
 *
 * @param {Array<{unite?: string, balance?: number, prix_total?: number}>} rows
 * @returns {{count: number, prix_total_sum: number, qte_par_unite: Object<string, number>}}
 */
function computeInventaireTotals(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const qteParUnite = {};
  let prixTotalSum = 0;
  for (const r of list) {
    const unite = (r && r.unite ? String(r.unite) : '—').trim() || '—';
    const bal = Number(r && r.balance) || 0;
    qteParUnite[unite] = inv_round2((qteParUnite[unite] || 0) + bal);
    const pt = Number(r && r.prix_total) || 0;
    if (pt > 0) prixTotalSum += pt;
  }
  return {
    count: list.length,
    prix_total_sum: inv_round2(prixTotalSum),
    qte_par_unite: qteParUnite,
  };
}

/**
 * Formats the per-unit subtotals as a compact human string, e.g.
 *   "KG : 10 030,6 · L : 14 300,4". Units sorted alphabetically for stability.
 *
 * @param {Object<string, number>} qteParUnite
 * @param {string} [locale]
 * @returns {string}
 */
function formatQteParUnite(qteParUnite, locale) {
  const loc = locale || 'fr-FR';
  const keys = Object.keys(qteParUnite || {}).sort();
  if (keys.length === 0) return '—';
  return keys
    .map((u) => u + ' : ' + Number(qteParUnite[u] || 0).toLocaleString(loc, { maximumFractionDigits: 2 }))
    .join(' · ');
}

/**
 * Bounds a chronological ledger of signed movements to a max date (inclusive)
 * and recomputes the running balance over the bounded subset. The backend
 * cumul_apres includes movements AFTER the inventory date, so it cannot be
 * reused — we recompute from scratch.
 *
 * @param {Array<{date?: string, quantite?: number}>} entries - sorted asc by date upstream
 * @param {string|null} maxDate - 'YYYY-MM-DD' inclusive bound, or null for no bound
 * @returns {{rows: Array, solde_final: number}}
 */
function boundedLedger(entries, maxDate) {
  const list = Array.isArray(entries) ? entries : [];
  let running = 0;
  const rows = [];
  for (const e of list) {
    if (maxDate && e && e.date && String(e.date) > maxDate) continue;
    const q = inv_round2(Number(e && e.quantite) || 0);
    running = inv_round2(running + q);
    rows.push(Object.assign({}, e, { quantite: q, solde_courant: running }));
  }
  return { rows, solde_final: rows.length ? rows[rows.length - 1].solde_courant : 0 };
}

// ============================================================================
// UMD-style export (browser global + CommonJS for node:test)
// Unique internal name (cf. crash #75: top-level const collision in global scope).
// ============================================================================

const inventaireUtilsApi = {
  computeInventaireTotals,
  formatQteParUnite,
  boundedLedger,
};

if (typeof module !== 'undefined' && module.exports) module.exports = inventaireUtilsApi;
if (typeof window !== 'undefined') window.InventaireUtils = inventaireUtilsApi;
