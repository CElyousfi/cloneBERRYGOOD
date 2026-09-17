'use strict'
// @ts-check

/**
 * Validation PURE d'une création/édition de groupe de parcelles
 * (action `sb-groupe-save` de functions/src/modules/rh/pointageService.js).
 *
 * Aucune dépendance Firestore : les données du référentiel et des groupes
 * existants entrent par argument (DI), comme functions/lib/irrigation/.
 *
 * Règles (décisions produit validées) :
 *  - nom non vide et unique parmi les groupes ACTIFS ;
 *  - au moins 2 membres, sans doublon ;
 *  - chaque membre présent dans `sb_parcelle_referentiel` avec un `ha` > 0
 *    (base du prorata : pas de fallback sur la surface BEE ONE) ;
 *  - appartenance EXCLUSIVE : un membre ne peut pas être déjà dans un autre
 *    groupe actif.
 * Le nombre de groupes n'est PAS limité.
 */

/**
 * Slug d'un libellé de groupe → docId Firestore (déterministe, sans '/').
 * @param {string} label
 * @returns {string} '' si le label ne produit aucun caractère exploitable.
 */
function slugGroupeLabel(label) {
  const base = String(label == null ? '' : label)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base ? 'GRP-' + base : ''
}

/**
 * @typedef {Object} GroupeExistant
 * @property {string} id
 * @property {string} [label]
 * @property {Array<string>} [membres]
 * @property {boolean} [actif]
 */

/**
 * @typedef {Object} ValidationGroupe
 * @property {boolean} ok
 * @property {string} [error] message utilisateur (français), nommant la
 *   parcelle et le groupe en conflit le cas échéant.
 * @property {string} [docId]
 * @property {string} [label]
 * @property {Array<string>} [membres]
 */

/**
 * @param {Object} input
 * @param {string} [input.id] docId existant (édition) — sinon dérivé du label.
 * @param {string} input.label
 * @param {Array<string>} input.membres labels BEE ONE.
 * @param {Object<string, number>} input.haByLabel Ha SB indexés par label EN
 *   MAJUSCULES (source : sb_parcelle_referentiel).
 * @param {Array<GroupeExistant>} input.groupes groupes déjà en base.
 * @returns {ValidationGroupe}
 */
function validateGroupeSave(input) {
  const src = input || {}
  const label = typeof src.label === 'string' ? src.label.trim() : ''
  if (!label) return { ok: false, error: 'Nom du groupe requis' }

  const membres = (Array.isArray(src.membres) ? src.membres : [])
    .map(function (m) { return typeof m === 'string' ? m.trim() : '' })
    .filter(Boolean)
  if (membres.length < 2) {
    return { ok: false, error: 'Un groupe doit contenir au moins 2 parcelles' }
  }

  /** @type {Object<string, boolean>} */
  const seen = {}
  for (const m of membres) {
    const k = m.toUpperCase()
    if (seen[k]) return { ok: false, error: 'Parcelle en doublon dans le groupe : ' + m }
    seen[k] = true
  }

  const docId = typeof src.id === 'string' && src.id.trim() ? src.id.trim() : slugGroupeLabel(label)
  if (!docId) return { ok: false, error: 'Nom du groupe invalide' }

  const haByLabel = src.haByLabel || {}
  for (const m of membres) {
    if (!(haByLabel[m.toUpperCase()] > 0)) {
      return {
        ok: false,
        error:
          'Ha Smart Berry manquant pour « ' +
          m +
          ' » — saisir le Ha dans Parcelles & Référentiel avant de l\'ajouter à un groupe',
      }
    }
  }

  const isEdition = typeof src.id === 'string' && src.id.trim() !== ''
  for (const g of src.groupes || []) {
    if (!g) continue
    if (g.id === docId) {
      // Création (pas d'id fourni) sur un docId déjà pris par un groupe actif :
      // ce serait un écrasement silencieux → refus explicite.
      if (!isEdition && g.actif !== false) {
        return { ok: false, error: 'Un groupe nommé « ' + (g.label || g.id) + ' » existe déjà' }
      }
      continue
    }
    if (g.actif === false) continue
    if (String(g.label || '').trim().toUpperCase() === label.toUpperCase()) {
      return { ok: false, error: 'Un groupe nommé « ' + g.label + ' » existe déjà' }
    }
    for (const m of membres) {
      const already = (g.membres || []).some(function (x) {
        return String(x || '').trim().toUpperCase() === m.toUpperCase()
      })
      if (already) {
        return {
          ok: false,
          error: 'La parcelle « ' + m + ' » appartient déjà au groupe « ' + (g.label || g.id) + ' »',
        }
      }
    }
  }

  return { ok: true, docId: docId, label: label, membres: membres }
}

module.exports = { slugGroupeLabel, validateGroupeSave }
