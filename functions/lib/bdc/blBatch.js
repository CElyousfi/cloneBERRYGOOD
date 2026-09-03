/**
 * blBatch.js — Helpers purs pour le chargement PAR LOTS des bons de livraison
 * rattachés à une liste de BdC (functions/dgAgent.js, tool
 * `get_bdc_non_receptionnes`).
 *
 * Module backend uniquement, SANS accès Firestore : le découpage des ids et le
 * regroupement des BL par `bdc_id` sont des fonctions pures, donc testables
 * (tests/unit/blBatch.test.js) sans emulator.
 *
 * Deux invariants portés par ce module :
 *   - `IN_MAX_VALUES = 30` est une LIMITE DURE de Firestore, pas un réglage :
 *     une clause `where(..., 'in', [...])` à 31 valeurs échoue avec
 *     `3 INVALID_ARGUMENT: 'IN' supports up to 30 comparison values.`
 *   - le filtre du soft-delete reste EN MÉMOIRE (`!bl.deleted`). Il ne doit
 *     JAMAIS devenir un `where('deleted', '==', false)` : Firestore ne renvoie
 *     pas les documents dépourvus du champ interrogé, or le champ `deleted`
 *     n'est posé QU'À la suppression (functions/index.js) — la requête
 *     exclurait donc exactement les BL vivants qu'on veut compter.
 */
// @ts-check
'use strict';

/** Nombre maximum de valeurs acceptées par une clause Firestore `in`. */
const IN_MAX_VALUES = 30;

/**
 * Découpe une liste d'ids en lots de `size` au maximum.
 * Une liste vide ne produit AUCUN lot : `in` avec un tableau vide lève côté
 * Firestore, donc l'appelant ne doit lancer aucune requête dans ce cas.
 *
 * @param {Array<string>} ids
 * @param {number} [size] - défaut IN_MAX_VALUES (30, limite dure Firestore).
 * @returns {Array<Array<string>>}
 */
function chunkIds(ids, size) {
  const max = size || IN_MAX_VALUES;
  const out = [];
  const list = ids || [];
  for (let i = 0; i < list.length; i += max) {
    out.push(list.slice(i, i + max));
  }
  return out;
}

/**
 * Regroupe des BL par `bdc_id`, en reproduisant exactement ce que faisait la
 * boucle « une requête par BdC » :
 *   - CHAQUE id demandé reçoit une entrée, même sans aucun BL (tableau vide,
 *     jamais `undefined`) ;
 *   - un BL soft-deleted est écarté (il ne compte nulle part dans le reliquat,
 *     sinon il masquerait un BdC non réceptionné) ;
 *   - un BL dont le `bdc_id` n'est pas dans `ids` est ignoré, jamais rattaché
 *     à un autre BdC.
 *
 * @param {Array<string>} ids — ids des BdC demandés.
 * @param {Array<{bdc_id?: string, deleted?: boolean}>} bls — BL bruts lus.
 * @returns {Record<string, Array<object>>}
 */
function groupBlsByBdcId(ids, bls) {
  /** @type {Record<string, Array<object>>} */
  const table = {};
  for (const id of ids || []) table[id] = [];
  for (const bl of bls || []) {
    if (!bl || bl.deleted) continue;
    const key = bl.bdc_id;
    if (!key || !Object.prototype.hasOwnProperty.call(table, key)) continue;
    table[key].push(bl);
  }
  return table;
}

module.exports = { IN_MAX_VALUES, chunkIds, groupBlsByBdcId };
