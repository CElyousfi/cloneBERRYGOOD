'use strict'
// @ts-check

/**
 * Module pur — Fusion d'articles en doublon (catalogue stock).
 * Source de vérité pour : normalisation de nom + détection des groupes de doublons.
 * Aucune dépendance Firestore/IO : 100% pur, testable unitairement.
 *
 * Décision métier : deux articles `active=true` sont candidats doublons s'ils
 * partagent le MÊME nom normalisé (minuscules + trim + espaces multiples réduits
 * + accents/diacritiques retirés). L'utilisateur valide chaque fusion manuellement.
 */

/**
 * @typedef {Object} CatalogArticle
 * @property {string} reference Référence (= docId du catalogue, clé naturelle).
 * @property {string} nom Libellé de l'article.
 * @property {string} [categorie]
 * @property {string} [unite]
 * @property {boolean} [active]
 */

/**
 * @typedef {Object} DuplicateGroup
 * @property {string} normalized Nom normalisé partagé par le groupe.
 * @property {CatalogArticle[]} articles Articles partageant ce nom normalisé (>=2).
 */

/**
 * Normalise un nom d'article pour la détection de doublons.
 * - minuscules
 * - trim
 * - accents / diacritiques retirés (NFD)
 * - espaces multiples réduits à un seul
 * @param {*} nom Valeur brute.
 * @returns {string} Nom normalisé (vide si null/undefined/non-string).
 */
function normalizeArticleName(nom) {
  if (nom == null) return ''
  const s = String(nom)
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques (combining marks)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Regroupe les articles `active=true` partageant le même nom normalisé.
 * Ne renvoie QUE les groupes de >=2 articles (vrais candidats doublons).
 * @param {CatalogArticle[]} articles Liste d'articles du catalogue.
 * @returns {DuplicateGroup[]} Groupes triés par nom normalisé.
 */
function groupDuplicates(articles) {
  const list = Array.isArray(articles) ? articles : []
  /** @type {Map<string, CatalogArticle[]>} */
  const map = new Map()
  for (const a of list) {
    if (!a || a.active === false) continue
    const norm = normalizeArticleName(a.nom)
    if (!norm) continue
    if (!map.has(norm)) map.set(norm, [])
    map.get(norm).push({
      reference: a.reference,
      nom: a.nom,
      categorie: a.categorie || '',
      unite: a.unite || '',
    })
  }
  /** @type {DuplicateGroup[]} */
  const groups = []
  for (const [normalized, arr] of map.entries()) {
    if (arr.length >= 2) groups.push({ normalized, articles: arr })
  }
  groups.sort((a, b) => a.normalized.localeCompare(b.normalized, 'fr'))
  return groups
}

/**
 * Indique si un mouvement de stock est OUVERT (réassignable) ou clôturé/validé.
 * Un mouvement reception/sortie est OUVERT tant qu'il n'est pas `valide_chef`
 * (son impact stock n'est PAS encore appliqué). Les transfert/consommation sont
 * créés directement en `valide_chef` (impact immédiat) -> jamais ouverts.
 * Un mouvement `rejete` n'est jamais réassigné (trace d'origine).
 * @param {{type?: string, status?: string}} mov
 * @returns {boolean} true si le mouvement est ouvert et réassignable.
 */
function isMovementOpen(mov) {
  if (!mov) return false
  const status = mov.status
  const type = mov.type
  if (status === 'rejete') return false
  const needsMulti = type === 'reception' || type === 'sortie'
  if (!needsMulti) return false // transfert/consommation : impact déjà appliqué
  return status === 'valide_mag' || status === 'valide_achats'
}

/**
 * Statuts de BDC (purchase_orders) considérés CLÔTURÉS/historiques (non réassignables).
 * Tout autre statut est considéré OUVERT (brouillon, rejeté, en attente de validation).
 */
const BDC_CLOSED_STATUSES = ['envoye', 'valide_dg', 'virement_lance', 'virement_signe', 'annule']

/**
 * Indique si un BDC est OUVERT (réassignable) ou clôturé/envoyé.
 * Décision métier : on ne réassigne QUE les BDC non clôturés ; une fois envoyé
 * au fournisseur / validé DG, le BDC garde sa trace d'origine (DOUBLON).
 * @param {{status?: string}} bdc
 * @returns {boolean}
 */
function isBdcOpen(bdc) {
  if (!bdc) return false
  return !BDC_CLOSED_STATUSES.includes(bdc.status)
}

module.exports = {
  normalizeArticleName,
  groupDuplicates,
  isMovementOpen,
  isBdcOpen,
  BDC_CLOSED_STATUSES,
}
