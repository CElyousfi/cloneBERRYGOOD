'use strict';
// @ts-check

/**
 * Module pur — plan de validation en masse de bons de caisse.
 *
 * Décide QUELS bons d'une sélection sont réellement validables, et de combien
 * chaque caisse doit bouger. Aucune écriture : le handler HTTP applique le plan
 * dans une transaction Firestore.
 *
 * Raison d'être : `validate-transactions-batch` passait les bons à 'valide'
 * sans jamais toucher `solde_actuel`, contrairement à la validation unitaire.
 * Le solde système ne correspondait donc plus au solde physique de la caisse,
 * et une dévalidation ultérieure soustrayait un delta jamais ajouté.
 *
 * Aucune écriture Firestore, aucune I/O.
 */

const { computeSoldeDelta } = require('./soldeDelta');

/**
 * @typedef {Object} BatchEntry
 * @property {string} id        Identifiant du document.
 * @property {Object|null} data Données du bon, `null` si le document n'existe pas.
 *
 * @typedef {Object} BatchError
 * @property {string} id
 * @property {string} reason  `not_found` | `statut_non_soumis` | `caisse_absente`
 * @property {string} [status]
 *
 * @typedef {Object} BatchPlan
 * @property {string[]} eligibles                Ids des bons à passer à 'valide'.
 * @property {Object<string, number>} deltaParCaisse Delta cumulé par caisse_id.
 * @property {BatchError[]} errors               Bons écartés, avec la raison.
 */

/**
 * Construit le plan de validation.
 *
 * Seul un bon au statut `soumis` se valide — même garde que la validation
 * unitaire. Sans elle, le batch pouvait « valider » un brouillon, ou
 * re-valider un bon déjà validé et créditer la caisse deux fois.
 *
 * @param {BatchEntry[]} entries
 * @returns {BatchPlan}
 */
function planBatchValidation(entries) {
  /** @type {BatchPlan} */
  const plan = { eligibles: [], deltaParCaisse: {}, errors: [] };
  if (!Array.isArray(entries)) return plan;

  for (const entry of entries) {
    if (!entry) continue;
    const id = entry.id;
    const data = entry.data;
    if (!data) { plan.errors.push({ id, reason: 'not_found' }); continue; }
    if (data.status !== 'soumis') {
      plan.errors.push({ id, reason: 'statut_non_soumis', status: String(data.status || '') });
      continue;
    }
    if (!data.caisse_id) { plan.errors.push({ id, reason: 'caisse_absente' }); continue; }
    plan.eligibles.push(id);
    const cur = plan.deltaParCaisse[data.caisse_id] || 0;
    plan.deltaParCaisse[data.caisse_id] = cur + computeSoldeDelta(data);
  }
  return plan;
}

/**
 * Nouveau solde d'une caisse après application d'un delta, arrondi au centime.
 *
 * @param {number} [soldeActuel]
 * @param {number} [delta]
 * @returns {number}
 */
function applyDelta(soldeActuel, delta) {
  const base = Number(soldeActuel) || 0;
  const d = Number(delta) || 0;
  return Math.round((base + d) * 100) / 100;
}

module.exports = { planBatchValidation, applyDelta }
