/**
 * receptionGuard.js — Pure validation helpers for BdC delivery-note (BL)
 * creation (action "create-bl" in functions/index.js).
 *
 * Backend-only module (no browser mirror needed — this guard only runs
 * server-side inside the create-bl Cloud Function handler).
 *
 * Business rule (BDC-2026-0142, fixed 2026-08-08): a BdC can be received in
 * several partial deliveries (several BL over time). Each article has a
 * "reliquat" (remaining quantity = ordered − already received across all
 * existing BL). A new BL must never push an article's cumulative received
 * quantity past what was ordered — validated PER ARTICLE, not just via the
 * BdC-level `delivery_status` flag (which only distinguishes
 * non_livre/partiel/complet and does not prevent over-receiving an article
 * while the BdC is still "partiel" overall).
 */
// @ts-check
'use strict';

const RELIQUAT_EPSILON = 0.01;

/**
 * @typedef {{ article?: string, quantite?: number|string }} BdcItem
 * @typedef {{ items?: Array<{ article?: string, quantite_recue?: number }> }} ExistingBl
 * @typedef {{ article?: string, quantite_recue?: number|string }} IncomingItem
 * @typedef {{ status: number, error: string }} GuardRejection
 */

/**
 * Aggregates quantities already received per article across existing BL.
 *
 * @param {ExistingBl[]} existingBls - delivery_notes already created for this BdC.
 * @returns {Record<string, number>}
 */
function computeReceivedByArticle(existingBls) {
  const received = {};
  (existingBls || []).forEach((bl) => (bl.items || []).forEach((it) => {
    received[it.article] = (received[it.article] || 0) + (it.quantite_recue || 0);
  }));
  return received;
}

/**
 * Aggregates ordered quantities per article from the BdC items.
 *
 * @param {BdcItem[]} bdcItems - `bdc.items` from the purchase_orders doc.
 * @returns {Record<string, number>}
 */
function computeOrderedByArticle(bdcItems) {
  const ordered = {};
  (bdcItems || []).forEach((it) => { ordered[it.article] = (ordered[it.article] || 0) + (parseFloat(it.quantite) || 0); });
  return ordered;
}

/**
 * Validates that none of the incoming BL items exceeds its remaining
 * reliquat (ordered − already received via existing BL), per article.
 *
 * @param {BdcItem[]} bdcItems - `bdc.items` from the purchase_orders doc.
 * @param {ExistingBl[]} existingBls - delivery_notes already created for this BdC.
 * @param {IncomingItem[]} incomingItems - items of the BL being created.
 * @returns {GuardRejection | null} null if the reception is allowed, otherwise
 *   a `{status, error}` object describing the rejection.
 */
function validateReliquat(bdcItems, existingBls, incomingItems) {
  const received = computeReceivedByArticle(existingBls);
  const ordered = computeOrderedByArticle(bdcItems);

  for (const it of incomingItems || []) {
    const article = it.article || '';
    const quantiteRecue = parseFloat(it.quantite_recue) || 0;
    if (quantiteRecue <= 0) continue;
    const dejaRecu = received[article] || 0;
    const commande = ordered[article] || 0;
    const reliquat = commande - dejaRecu;
    if (quantiteRecue > reliquat + RELIQUAT_EPSILON) {
      return {
        status: 400,
        error: `Quantité reçue supérieure au reliquat pour ${article} (reliquat: ${Math.max(0, Math.round(reliquat * 100) / 100)})`,
      };
    }
  }
  return null;
}

/**
 * Derives the BdC-level `delivery_status` from per-article ordered/received
 * quantities.
 *
 * @param {Record<string, number>} ordered - ordered quantity per article.
 * @param {Record<string, number>} received - received quantity per article.
 * @returns {"complet"|"partiel"|"non_livre"}
 */
function deriveDeliveryStatus(ordered, received) {
  const allDelivered = Object.keys(ordered).every((art) => (received[art] || 0) >= ordered[art]);
  const anyDelivered = Object.values(received).some((v) => v > 0);
  return allDelivered ? "complet" : anyDelivered ? "partiel" : "non_livre";
}

module.exports = { validateReliquat, computeReceivedByArticle, computeOrderedByArticle, deriveDeliveryStatus, RELIQUAT_EPSILON };
