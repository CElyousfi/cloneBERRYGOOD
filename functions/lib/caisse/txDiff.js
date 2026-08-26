'use strict';
// @ts-check

/**
 * Module pur — diff avant/après d'une transaction de caisse, pour l'historique.
 *
 * L'entrée `history` d'une modification doit dire CE QUI a changé, pas
 * seulement qu'une modification a eu lieu. Les pièces jointes sont résumées
 * par un compte : jamais de base64 dans l'historique.
 *
 * Aucune écriture Firestore, aucune I/O.
 */

/** Champs comparés, dans l'ordre d'affichage. @type {ReadonlyArray<string>} */
const CHAMPS_SUIVIS = [
  'date', 'montant', 'type', 'caisse_id',
  'code_analytique', 'description', 'matricule', 'beneficiaire_nom',
];

/** Champs traités comme des nombres (comparaison numérique, pas textuelle). */
const CHAMPS_NUMERIQUES = ['montant'];

/**
 * Normalise une valeur avant comparaison : `undefined`/`null` → `''`,
 * trim des chaînes, `Number` pour les champs numériques.
 *
 * @param {string} field
 * @param {*} value
 * @returns {string|number}
 */
function normalize(field, value) {
  if (CHAMPS_NUMERIQUES.indexOf(field) !== -1) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

/**
 * @typedef {Object} Change
 * @property {string} field
 * @property {string|number} from
 * @property {string|number} to
 */

/**
 * Liste des champs réellement modifiés entre `before` et `after`.
 *
 * `after` est un patch partiel : un champ absent de `after` est considéré
 * inchangé (et non « vidé »).
 *
 * @param {Object} before Document Firestore existant.
 * @param {Object} after  Patch appliqué (sous-ensemble de champs).
 * @returns {Change[]} Vide si rien n'a changé.
 */
function computeChanges(before, after) {
  /** @type {Change[]} */
  const changes = [];
  const b = before || {};
  const a = after || {};

  for (const field of CHAMPS_SUIVIS) {
    if (!Object.prototype.hasOwnProperty.call(a, field)) continue;
    const from = normalize(field, b[field]);
    const to = normalize(field, a[field]);
    if (from !== to) changes.push({ field, from, to });
  }

  // Pièces jointes : compte uniquement, jamais le contenu.
  if (Object.prototype.hasOwnProperty.call(a, 'files')) {
    const from = Array.isArray(b.files) ? b.files.length : 0;
    const to = Array.isArray(a.files) ? a.files.length : 0;
    if (from !== to) changes.push({ field: 'files', from, to });
  }

  return changes;
}

module.exports = { computeChanges, CHAMPS_SUIVIS }
