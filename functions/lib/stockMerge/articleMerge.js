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

/**
 * Normalise une CATÉGORIE d'article pour l'enregistrement.
 * Le catalogue portait deux conventions concurrentes (`Engrais` / `engrais`)
 * selon le chemin d'import : c'est CETTE divergence qui a produit deux docId
 * pour un même article. On fige une seule convention à l'écriture.
 * ⚠️ N'est JAMAIS appliquée au calcul du docId (cf. resolveArticleTarget) :
 * changer la formule d'identifiant recréerait une vague de doublons.
 * @param {*} categorie Valeur brute.
 * @param {string} [defaut] Valeur si vide (défaut : 'autre').
 * @returns {string} Catégorie normalisée (minuscules, espaces réduits).
 */
function normalizeCategorie(categorie, defaut) {
  const fallback = defaut === undefined ? 'autre' : defaut
  if (categorie == null) return fallback
  const s = String(categorie).toLowerCase().replace(/\s+/g, ' ').trim()
  return s || fallback
}

/**
 * @typedef {Object} ArticleIndex
 * @property {Set<string>} byId Identifiants des fiches ACTIVES.
 * @property {Set<string>} allIds Identifiants de TOUTES les fiches, actives ou non.
 * @property {Map<string,string>} byName Nom normalisé -> id de la fiche active.
 * @property {Map<string,string>} mergedInto id -> id du master (fiches fusionnées).
 */

/**
 * Construit, EN UN SEUL PASSAGE, l'index de résolution d'une fiche article.
 *
 * Périmètre : `byId` et `byName` ne contiennent QUE les fiches actives — une
 * fiche désactivée par une fusion ne doit jamais être ressuscitée par un
 * import. `mergedInto` garde la redirection doublon -> master pour rattraper
 * les lignes d'import qui portent encore l'ancien identifiant.
 *
 * `allIds` contient TOUS les identifiants, actifs ou non. Il ne sert PAS à la
 * résolution : il sert à l'appelant pour distinguer « ce document n'existe
 * pas » (→ `set`) de « ce document existe mais est inactif » (→ `update`, car
 * un `set` REMPLACE le document et ferait perdre `prix_pmp`, `nb_achats` et
 * `created_at`). Cas réel : une fiche désactivée par `validate-delete-article`
 * n'a ni `merged_into` ni jumelle active — aucun des deux replis ne la voit.
 *
 * Collision de nom (doublons encore présents en base, avant fusion) : on
 * retient l'id le plus petit lexicographiquement. Choix arbitraire mais
 * DÉTERMINISTE : deux imports successifs convergent sur la même fiche au lieu
 * d'en créer une troisième.
 *
 * @param {Array<{id?: string, nom?: string, active?: boolean, merged_into?: string}>} docs
 * @returns {ArticleIndex}
 */
function buildArticleIndex(docs) {
  /** @type {Set<string>} */
  const byId = new Set()
  /** @type {Set<string>} */
  const allIds = new Set()
  /** @type {Map<string,string>} */
  const byName = new Map()
  /** @type {Map<string,string>} */
  const mergedInto = new Map()
  for (const d of Array.isArray(docs) ? docs : []) {
    if (!d || !d.id) continue
    const id = String(d.id)
    allIds.add(id)
    if (d.merged_into) mergedInto.set(id, String(d.merged_into))
    if (d.active === false) continue
    byId.add(id)
    const norm = normalizeArticleName(d.nom)
    if (!norm) continue
    const prev = byName.get(norm)
    if (prev === undefined || id < prev) byName.set(norm, id)
  }
  return { byId, allIds, byName, mergedInto }
}

/**
 * Décide la fiche cible d'une ligne d'import / de création.
 *
 * ⚠️ `docId` est l'identifiant calculé par la formule HISTORIQUE, inchangée.
 * On ne corrige pas la formule (cela réétiquetterait tout le catalogue) : on
 * corrige la RÉSOLUTION, en cherchant d'abord une fiche active de même nom
 * normalisé. C'est la même normalisation que la détection de doublons
 * (`normalizeArticleName`), donc « ce qui serait détecté comme doublon » et
 * « ce qui est fusionné à l'écriture » sont exactement la même chose.
 *
 * Ordre : id actif -> nom normalisé actif -> redirection merged_into -> création.
 *
 * @param {ArticleIndex} idx
 * @param {string} docId Identifiant historique calculé pour cette ligne.
 * @param {*} nom Libellé de l'article.
 * @returns {{id: string, isNew: boolean, matchedBy: ('id'|'nom'|'merged_into'|'none')}}
 */
function resolveArticleTarget(idx, docId, nom) {
  const byId = idx && idx.byId instanceof Set ? idx.byId : new Set()
  const byName = idx && idx.byName instanceof Map ? idx.byName : new Map()
  const mergedInto = idx && idx.mergedInto instanceof Map ? idx.mergedInto : new Map()
  const id = docId == null ? '' : String(docId)
  if (id && byId.has(id)) return { id, isNew: false, matchedBy: 'id' }
  const norm = normalizeArticleName(nom)
  if (norm && byName.has(norm)) {
    return { id: String(byName.get(norm)), isNew: false, matchedBy: 'nom' }
  }
  if (id && mergedInto.has(id)) {
    const master = String(mergedInto.get(id))
    if (byId.has(master)) return { id: master, isNew: false, matchedBy: 'merged_into' }
  }
  return { id, isNew: true, matchedBy: 'none' }
}

/**
 * Enregistre dans l'index une fiche créée PENDANT la boucle d'import.
 * Sans cela, deux lignes du même fichier ne différant que par la casse de la
 * catégorie produiraient deux docId — donc deux fiches — dans le même import.
 * Premier arrivé, premier servi (la fiche qu'on vient réellement de créer).
 * @param {ArticleIndex} idx Index muté en place.
 * @param {string} id
 * @param {*} nom
 * @returns {ArticleIndex} le même index.
 */
function rememberArticle(idx, id, nom) {
  if (!idx || !(idx.byId instanceof Set) || !(idx.byName instanceof Map)) return idx
  if (!id) return idx
  const sid = String(id)
  idx.byId.add(sid)
  if (idx.allIds instanceof Set) idx.allIds.add(sid)
  const norm = normalizeArticleName(nom)
  if (norm && !idx.byName.has(norm)) idx.byName.set(norm, sid)
  return idx
}

module.exports = {
  normalizeArticleName,
  normalizeCategorie,
  groupDuplicates,
  buildArticleIndex,
  resolveArticleTarget,
  rememberArticle,
  isMovementOpen,
  isBdcOpen,
  BDC_CLOSED_STATUSES,
}
