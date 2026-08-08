/**
 * bdcReceptionUtils.js — Pure helper for computing per-article delivery
 * (réception BDC) data: reçu / reliquat / statut, from a BDC's items and
 * its delivery_notes (BL).
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/bdcReceptionUtils.js"> → exposes
 *     window.BdcReceptionUtils
 *   - In node:test via require('./bdcReceptionUtils.js') → exposes
 *     module.exports
 *
 * Extracted from AchatsBDCTab.getDeliveryData (public/app.jsx, Sprint BDC
 * réception) so the same logic can be reused by MagBdcReceptionTab (plafond
 * de réception par article) and MagBonsCommandeTab (popup lecture seule
 * reçu/reliquat) without duplication.
 *
 * @typedef {Object} BdcItem
 * @property {string} [article]
 * @property {number|string} [quantite]
 * @property {string} [unite]
 *
 * @typedef {Object} BlItem
 * @property {string} [article]
 * @property {number} [quantite_recue]
 *
 * @typedef {Object} Bl
 * @property {BlItem[]} [items]
 *
 * @typedef {Object} DeliveryDataRow
 * @property {string} article
 * @property {string} unite
 * @property {number} qCmd
 * @property {number} qLiv
 * @property {number} reste
 * @property {number} pct
 * @property {'livre'|'partiel'|'en_attente'} statut
 */
// @ts-check
'use strict';

// IIFE d'isolation : tout le corps du module vit dans cette fonction pour
// qu'AUCUN identifiant top-level (computeDeliveryData, __api, …) ne fuie
// dans le scope lexical global partagé par les <script> classiques de
// public/lib/. Sans ça, `const __api` entre en collision avec
// caisseUtils.js → erreur "Identifier '__api' has already been declared"
// au boot → React #200 en cascade (cf. incident commit 1754a64, et son
// premier fix dans encaissementsCanevas.js). Les exports passent par
// window/module en fin d'IIFE. TOUT nouveau fichier public/lib/ doit
// suivre ce même pattern.
(function () {

/**
 * Calcule, pour chaque article d'un BDC, la quantité commandée, reçue
 * (somme des BL existants) et le reliquat (reste à recevoir).
 *
 * @param {BdcItem[]} bdcItems
 * @param {Bl[]} bls
 * @returns {DeliveryDataRow[]}
 */
function computeDeliveryData(bdcItems, bls) {
  const received = {};
  (bls || []).forEach((bl) => (bl.items || []).forEach((it) => {
    received[it.article] = (received[it.article] || 0) + (it.quantite_recue || 0);
  }));
  return (bdcItems || []).map((it) => {
    const qCmd = parseFloat(it.quantite) || 0;
    const qLiv = received[it.article] || 0;
    const reste = Math.max(0, Math.round((qCmd - qLiv) * 100) / 100);
    const pct = qCmd > 0 ? Math.min(100, Math.round((qLiv / qCmd) * 100)) : 0;
    const statut = pct >= 100 ? 'livre' : pct > 0 ? 'partiel' : 'en_attente';
    return { article: it.article, unite: it.unite || 'kg', qCmd, qLiv, reste, pct, statut };
  });
}

// ============================================================================
// UMD-style export (browser global + CommonJS for node:test)
// ============================================================================

const __api = {
  computeDeliveryData,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __api;
if (typeof window !== 'undefined') window.BdcReceptionUtils = __api;

})();
