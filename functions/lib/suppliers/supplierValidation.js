'use strict'
// @ts-check

/**
 * Module pur de validation des fournisseurs (Achats).
 * Source de vérité backend pour la validation automatique à la création/modification.
 * Aucune dépendance Firestore/IO : 100% pur, testable unitairement.
 */

/**
 * @typedef {Object} SupplierFields
 * @property {string} [nom] Raison sociale.
 * @property {string} [adresse] Adresse du siège social.
 * @property {string} [identifiant_fiscal] Identifiant Fiscal (IF).
 * @property {string} [ice] Identifiant Commun de l'Entreprise (ICE).
 * @property {string} [contact_nom] Nom du contact.
 * @property {string} [tel] Téléphone (format MA).
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid `true` si tous les champs obligatoires sont valides.
 * @property {Object.<string, string>} errors Map champ -> message FR, ne contient QUE les champs en échec.
 */

/**
 * Normalise une valeur en chaîne trimée.
 * @param {*} v Valeur brute.
 * @returns {string} Chaîne trimée (vide si null/undefined).
 */
function asTrimmedString(v) {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/**
 * Indique si une chaîne est non vide après trim.
 * @param {*} v Valeur brute.
 * @returns {boolean}
 */
function isNonEmpty(v) {
  return asTrimmedString(v).length > 0
}

/**
 * Normalise un IF : supprime tous les espaces.
 * @param {*} v Valeur brute.
 * @returns {string}
 */
function normalizeIf(v) {
  return asTrimmedString(v).replace(/\s+/g, '')
}

/**
 * Normalise un ICE : supprime tous les espaces.
 * @param {*} v Valeur brute.
 * @returns {string}
 */
function normalizeIce(v) {
  return asTrimmedString(v).replace(/\s+/g, '')
}

/**
 * Normalise un téléphone : supprime espaces, points et tirets.
 * @param {*} v Valeur brute.
 * @returns {string}
 */
function normalizePhone(v) {
  return asTrimmedString(v).replace(/[\s.\-]/g, '')
}

/**
 * Valide un IF : 7 à 8 chiffres après normalisation.
 * @param {*} v Valeur brute.
 * @returns {boolean}
 */
function isValidIf(v) {
  return /^\d{7,8}$/.test(normalizeIf(v))
}

/**
 * Valide un ICE : exactement 15 chiffres après normalisation.
 * @param {*} v Valeur brute.
 * @returns {boolean}
 */
function isValidIce(v) {
  return /^\d{15}$/.test(normalizeIce(v))
}

/**
 * Valide un téléphone MA : exactement 10 chiffres commençant par 0 après normalisation.
 * @param {*} v Valeur brute.
 * @returns {boolean}
 */
function isValidPhone(v) {
  return /^0\d{9}$/.test(normalizePhone(v))
}

/**
 * Valide les 6 champs obligatoires d'un fournisseur.
 * Ne renvoie dans `errors` que les champs en échec, avec un message FR par champ.
 * @param {SupplierFields} fields Champs du fournisseur (état résultant pour un update).
 * @returns {ValidationResult}
 */
function validateSupplier(fields) {
  const f = fields || {}
  /** @type {Object.<string, string>} */
  const errors = {}

  if (!isNonEmpty(f.nom)) {
    errors.nom = 'Raison sociale obligatoire.'
  }
  if (!isNonEmpty(f.adresse)) {
    errors.adresse = 'Adresse du siège social obligatoire.'
  }
  if (!isValidIf(f.identifiant_fiscal)) {
    errors.identifiant_fiscal = 'Identifiant Fiscal invalide : 7 à 8 chiffres attendus.'
  }
  if (!isValidIce(f.ice)) {
    errors.ice = 'ICE invalide : 15 chiffres attendus.'
  }
  if (!isNonEmpty(f.contact_nom)) {
    errors.contact_nom = 'Nom de contact obligatoire.'
  }
  if (!isValidPhone(f.tel)) {
    errors.tel = 'Téléphone invalide : 10 chiffres commençant par 0 attendus.'
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

module.exports = {
  validateSupplier,
  normalizeIf,
  normalizeIce,
  normalizePhone,
  isValidIf,
  isValidIce,
  isValidPhone,
  isNonEmpty,
}
