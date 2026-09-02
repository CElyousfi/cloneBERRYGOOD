'use strict';
// @ts-check

/**
 * Module pur — impact d'une transaction de caisse sur `solde_actuel`.
 *
 * Source de vérité UNIQUE de la formule appliquée à la validation
 * (`validate-transaction`) et annulée à la dévalidation (`update-transaction`
 * sur un bon déjà validé).
 *
 * ⚠️ Ne PAS confondre avec les recalculs globaux de solde qui existent ailleurs
 * dans `functions/index.js` (`bulk-import-transactions`,
 * `_computeRapprochementTotals`) : ceux-là ignorent `paie` et `transport`.
 * Cette divergence est historique et hors périmètre — raison pour laquelle le
 * solde ne doit être ajusté QUE par delta, jamais recalculé globalement.
 *
 * Aucune écriture Firestore, aucune I/O.
 */

/** Types qui créditent la caisse. @type {ReadonlyArray<string>} */
const TYPES_ENTREE = ['alimentation', 'transfer_in'];

/** Types qui débitent la caisse. @type {ReadonlyArray<string>} */
const TYPES_SORTIE = ['depense', 'sortie', 'transfer_out', 'paie', 'transport'];

/**
 * Types qu'un utilisateur peut saisir puis modifier via l'UI de caisse.
 * Exclut les transferts (générés par paire via `create-transfer`) et les
 * mouvements de compte client (`vente` / `encaissement`, écrits uniquement
 * par `apply-encaissements`).
 * @type {ReadonlyArray<string>}
 */
const TYPES_EDITABLES = ['alimentation', 'depense', 'sortie', 'paie', 'transport'];

/**
 * Delta appliqué à `solde_actuel` quand la transaction passe à `valide`.
 *
 * @param {{type?: string, montant?: number|string}} tx Transaction (ou sous-ensemble).
 * @returns {number} Delta signé. `0` si le type est inconnu ou le montant absent/invalide.
 */
function computeSoldeDelta(tx) {
  if (!tx) return 0;
  const montant = Number(tx.montant);
  if (!Number.isFinite(montant)) return 0;
  if (TYPES_ENTREE.indexOf(String(tx.type)) !== -1) return montant;
  if (TYPES_SORTIE.indexOf(String(tx.type)) !== -1) return -montant;
  return 0;
}

/**
 * Le type est-il modifiable via `update-transaction` ?
 * @param {string} [type]
 * @returns {boolean}
 */
function isTypeEditable(type) {
  return TYPES_EDITABLES.indexOf(String(type)) !== -1;
}

module.exports = { computeSoldeDelta, isTypeEditable, TYPES_ENTREE, TYPES_SORTIE, TYPES_EDITABLES }
