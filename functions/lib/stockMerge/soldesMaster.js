'use strict'
// @ts-check

/**
 * Module pur — SOLDES DE STOCK D'UNE FICHE MAÎTRE, au moment d'une fusion.
 *
 * ── LE DÉFAUT QU'IL FERME ─────────────────────────────────────────────────
 * `merge-articles` cherchait les soldes existants du maître par
 * `normalizeArticleName(article_ref) === normalizeArticleName(master_ref)`,
 * où `master_ref` est un docId (« Ref-Eng0052 »). Or la majorité des soldes de
 * production sont rangés sous le NOM de l'article (« Acide Phosphorique ») :
 * la recherche ne trouvait rien, l'aperçu annonçait « maître 0 », et
 * l'écriture reconstruisait l'identifiant canonique
 * `${lieu_type}_${lieu_id}_${master_ref}` — donc un SECOND document à côté de
 * celui qui existait déjà. Deux soldes au même endroit pour le même article,
 * et aucun des deux ne donne le bon chiffre.
 *
 * ── CE QUE CE MODULE DÉCIDE ───────────────────────────────────────────────
 * 1. APPARTENANCE — un solde est « du maître » si son `article_ref` normalisé
 *    vaut le docId du maître OU son nom. La normalisation est celle du reste
 *    du dépôt (`normalizeArticleName`).
 * 2. PRIORITÉ — cette appartenance PRIME sur l'appartenance à un doublon.
 *    Les membres d'un groupe de doublons partagent, par construction, le même
 *    nom normalisé : un solde rangé sous ce nom matche les deux camps. Le
 *    traiter en doublon revient à le supprimer pour le recréer ailleurs ;
 *    le traiter en maître revient à l'incrémenter sur place. Le second est
 *    strictement meilleur : une écriture de moins, et aucun document créé.
 * 3. CIBLE D'ÉCRITURE, par lieu, dans cet ordre :
 *      a. le solde dont `article_ref` EST le docId du maître ;
 *      b. sinon celui dont le docId est l'identifiant canonique
 *         `${lieu_type}_${lieu_id}_${master_ref}` ;
 *      c. sinon — maître DÉJÀ fragmenté, cas de production — le plus petit
 *         docId lexicographiquement. Déterministe, jamais « au hasard » :
 *         deux appels successifs visent le même document.
 *    Les fragments NON retenus sont laissés INTACTS et comptés
 *    (`fragments`) : les réunir est une réparation de données, elle appartient
 *    à `scripts/reunir-soldes-fragmentes.js` — lecture d'abord, journalisée,
 *    réversible. Une fusion ne supprime jamais un solde du maître.
 * 4. SOLDE COURANT — `total` est la somme de TOUS les fragments du maître au
 *    lieu, pas seulement celui de la cible : c'est le solde que l'utilisateur
 *    lit, et c'est donc ce que l'aperçu doit annoncer.
 *
 * Aucune dépendance Firestore : 100 % pur, testable unitairement.
 */

const { normalizeArticleName } = require('./articleMerge')

/**
 * @typedef {Object} SoldeBrut
 * @property {string} docId Identifiant du document `stock_balances`.
 * @property {*} [article_ref] Clé d'article portée par le solde (docId OU nom).
 * @property {*} [lieu_type]
 * @property {*} [lieu_id]
 * @property {*} [balance]
 * @property {*} [unite]
 */

/**
 * @typedef {Object} SoldesLieu
 * @property {string} lieu_type
 * @property {string} lieu_id
 * @property {SoldeBrut[]} docs Tous les soldes du maître à ce lieu.
 * @property {number} total Somme des soldes (arrondie au centième).
 * @property {(SoldeBrut|null)} cible Document à incrémenter.
 * @property {number} fragments Nombre de documents (>1 = déjà fragmenté).
 */

/**
 * Identifiant canonique d'un solde — FORMULE HISTORIQUE, inchangée.
 * On ne la corrige pas : la changer réétiquetterait tout l'inventaire.
 * @param {*} lieuType @param {*} lieuId @param {*} articleRef
 * @returns {string}
 */
function identifiantSoldeCanonique(lieuType, lieuId, articleRef) {
  return `${lieuType}_${lieuId}_${articleRef}`.replace(/\s+/g, '_')
}

/**
 * Clés normalisées sous lesquelles un solde du maître peut être rangé.
 * @param {*} masterRef docId de la fiche maître.
 * @param {*} masterNom Libellé de la fiche maître.
 * @returns {Set<string>} clés normalisées, jamais vides.
 */
function clesMaster(masterRef, masterNom) {
  const cles = new Set()
  cles.add(normalizeArticleName(masterRef))
  cles.add(normalizeArticleName(masterNom))
  cles.delete('')
  return cles
}

/**
 * Ce solde appartient-il au maître ?
 * @param {*} articleRef Clé d'article portée par le solde.
 * @param {Set<string>} cles Sortie de `clesMaster`.
 * @returns {boolean}
 */
function estSoldeDuMaster(articleRef, cles) {
  if (!(cles instanceof Set) || cles.size === 0) return false
  const n = normalizeArticleName(articleRef)
  if (!n) return false
  return cles.has(n)
}

/**
 * Choisit le document à incrémenter parmi les soldes du maître à UN lieu.
 * Cascade documentée en tête de fichier (docId -> identifiant canonique ->
 * plus petit docId). Ne renvoie null que si la liste est vide.
 * @param {SoldeBrut[]} docs @param {*} masterRef
 * @param {*} lieuType @param {*} lieuId
 * @returns {(SoldeBrut|null)}
 */
function choisirSoldeCible(docs, masterRef, lieuType, lieuId) {
  const liste = (Array.isArray(docs) ? docs : []).slice()
  if (!liste.length) return null
  liste.sort((a, b) => String(a.docId).localeCompare(String(b.docId)))
  const refNorm = normalizeArticleName(masterRef)
  const parDocId = liste.filter((d) => normalizeArticleName(d.article_ref) === refNorm)
  if (parDocId.length) return parDocId[0]
  const canonique = identifiantSoldeCanonique(lieuType, lieuId, masterRef)
  const parIdentifiant = liste.filter((d) => String(d.docId) === canonique)
  if (parIdentifiant.length) return parIdentifiant[0]
  return liste[0]
}

/**
 * Indexe les soldes du maître par lieu.
 *
 * ⚠️ L'appelant ne passe QUE des soldes du maître (`estSoldeDuMaster`) : le
 * module ne refiltre pas, pour que la priorité maître/doublon soit décidée à
 * un seul endroit, dans l'appelant, et visible.
 *
 * @param {SoldeBrut[]} soldes
 * @param {*} masterRef @param {*} masterNom
 * @returns {Object<string, SoldesLieu>} clé `${lieu_type}|${lieu_id}`.
 */
function indexerSoldesMaster(soldes, masterRef, masterNom) {
  void masterNom // l'appartenance est décidée en amont ; signature explicite
  /** @type {Object<string, SoldesLieu>} */
  const parLieu = {}
  for (const s of Array.isArray(soldes) ? soldes : []) {
    if (!s || !s.docId) continue
    const lieuType = s.lieu_type == null ? '' : String(s.lieu_type)
    const lieuId = s.lieu_id == null ? '' : String(s.lieu_id)
    const key = `${lieuType}|${lieuId}`
    if (!parLieu[key]) {
      parLieu[key] = { lieu_type: lieuType, lieu_id: lieuId, docs: [], total: 0, cible: null, fragments: 0 }
    }
    parLieu[key].docs.push(s)
  }
  for (const key of Object.keys(parLieu)) {
    const e = parLieu[key]
    const somme = e.docs.reduce((n, d) => n + (Number(d.balance) || 0), 0)
    e.total = Math.round(somme * 100) / 100
    e.fragments = e.docs.length
    e.cible = choisirSoldeCible(e.docs, masterRef, e.lieu_type, e.lieu_id)
  }
  return parLieu
}

module.exports = {
  identifiantSoldeCanonique,
  clesMaster,
  estSoldeDuMaster,
  choisirSoldeCible,
  indexerSoldesMaster,
}
