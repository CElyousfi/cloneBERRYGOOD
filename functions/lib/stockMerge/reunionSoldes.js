'use strict'
// @ts-check

/**
 * Module pur — RÉUNION DES SOLDES FRAGMENTÉS d'un même article à un même lieu.
 *
 * ── LE CAS RÉPARÉ ─────────────────────────────────────────────────────────
 * Un même article porte DEUX documents `stock_balances` au même lieu : l'un
 * rangé sous son NOM (« Acide Phosphorique »), l'autre sous le docId de sa
 * fiche (« Ref-Eng0052 »). Aucune quantité n'est perdue — la somme est juste —
 * mais l'inventaire affiche deux lignes et tout écran qui lit l'une des deux
 * affiche un solde faux. Mesuré en production le 2026-08-30 : 29 cas, 58
 * documents, tous à exactement deux fragments.
 *
 * ── CE QUE CE MODULE FAIT, ET NE FAIT PAS ─────────────────────────────────
 * Il PLANIFIE : quels documents parlent du même article au même lieu, lequel
 * conserver, lesquels supprimer, quelle somme doit rester. Il n'écrit rien et
 * ne connaît pas Firestore. L'écriture, son journal d'audit et son arrêt à la
 * première anomalie vivent dans `scripts/reunir-soldes-fragmentes.js`.
 *
 * ── RÈGLE DE CONSERVATION ─────────────────────────────────────────────────
 * La MÊME que celle de la fusion corrigée (`soldesMaster.choisirSoldeCible`) :
 * on garde le document que `merge-articles` viserait désormais. Une seule
 * règle dans le dépôt, donc la réparation et la fusion ne peuvent pas diverger.
 * Vérifiée sur les 29 cas de production : chacun a EXACTEMENT un document au
 * docId de la fiche active — 0 cas sans, 0 cas avec plusieurs. La cascade
 * tranche donc sans ambiguïté, et les replis (identifiant canonique, puis plus
 * petit docId) ne servent qu'à rester déterministe si la base change.
 *
 * ── FAIL-CLOSED SUR LES UNITÉS ────────────────────────────────────────────
 * Deux fragments d'unités différentes (l vs kg) ne se somment PAS : additionner
 * des litres à des kilos fabriquerait un chiffre faux, plus difficile à
 * détecter que deux lignes. Ces cas sont SIGNALÉS et jamais exécutés — ils se
 * tranchent à la main, article par article.
 */

const { normalizeArticleName } = require('./articleMerge')
const { choisirSoldeCible } = require('./soldesMaster')

/**
 * @typedef {Object} SoldeBrut
 * @property {string} docId
 * @property {*} [article_ref] @property {*} [lieu_type] @property {*} [lieu_id]
 * @property {*} [balance] @property {*} [unite]
 */

/**
 * @typedef {Object} FicheArticle
 * @property {string} id docId au catalogue.
 * @property {*} [nom] @property {*} [active] @property {*} [merged_into]
 */

/**
 * @typedef {Object} CasFragmente
 * @property {string} article_id @property {string} article_nom
 * @property {string} lieu_type @property {string} lieu_id
 * @property {SoldeBrut[]} docs Fragments, triés par docId.
 * @property {number} total Somme des fragments (au centième).
 * @property {string} conserve docId du document conservé.
 * @property {string[]} supprimes docId des documents absorbés.
 * @property {string[]} anomalies Motifs empêchant l'exécution (vide = exécutable).
 */

/** @param {number} n @returns {number} */
function centime(n) {
  return Math.round(n * 100) / 100
}

/**
 * Unité d'un solde, comparable (casse et espaces neutralisés). Vide = inconnue,
 * jamais une anomalie : beaucoup de soldes anciens n'en portent pas.
 * @param {*} u @returns {string}
 */
function uniteComparable(u) {
  return u == null ? '' : String(u).trim().toLowerCase()
}

/**
 * Index de résolution : docId -> fiche, nom normalisé -> fiche ACTIVE.
 * @param {FicheArticle[]} articles
 * @returns {{parId: Map<string,FicheArticle>, parNom: Map<string,FicheArticle>}}
 */
function indexerCatalogue(articles) {
  /** @type {Map<string,FicheArticle>} */
  const parId = new Map()
  /** @type {Map<string,FicheArticle>} */
  const parNom = new Map()
  for (const a of Array.isArray(articles) ? articles : []) {
    if (!a || !a.id) continue
    parId.set(String(a.id), a)
  }
  for (const a of parId.values()) {
    if (a.active !== true) continue
    const n = normalizeArticleName(a.nom)
    if (!n) continue
    const prev = parNom.get(n)
    // Doublons encore présents : on retient l'id le plus petit — déterministe,
    // même convention que buildArticleIndex.
    if (prev === undefined || String(a.id) < String(prev.id)) parNom.set(n, a)
  }
  return { parId, parNom }
}

/**
 * Fiche ACTIVE à laquelle un solde se rattache, ou null.
 * Ordre : docId -> nom normalisé -> redirection `merged_into` (chaînée, bornée).
 * @param {*} articleRef
 * @param {{parId: Map<string,FicheArticle>, parNom: Map<string,FicheArticle>}} idx
 * @returns {(FicheArticle|null)}
 */
function ficheDuSolde(articleRef, idx) {
  const ref = articleRef == null ? '' : String(articleRef)
  let fiche = idx.parId.get(ref) || null
  if (fiche && fiche.active === true) return fiche
  const parNom = idx.parNom.get(normalizeArticleName(ref))
  if (parNom) return parNom
  // fiche connue mais inactive : suivre la fusion, au plus 5 sauts
  let garde = 0
  while (fiche && fiche.active !== true && fiche.merged_into && garde++ < 5) {
    fiche = idx.parId.get(String(fiche.merged_into)) || null
  }
  return fiche && fiche.active === true ? fiche : null
}

/**
 * Planifie la réunion des soldes fragmentés.
 *
 * @param {SoldeBrut[]} soldes TOUS les documents `stock_balances`.
 * @param {FicheArticle[]} articles TOUT le catalogue (actif ou non).
 * @returns {{cas: CasFragmente[], non_resolus: SoldeBrut[]}}
 */
function planifierReunion(soldes, articles) {
  const idx = indexerCatalogue(articles)
  /** @type {Map<string, {fiche: FicheArticle, lieu_type: string, lieu_id: string, docs: SoldeBrut[]}>} */
  const parCle = new Map()
  /** @type {SoldeBrut[]} */
  const nonResolus = []

  for (const s of Array.isArray(soldes) ? soldes : []) {
    if (!s || !s.docId) continue
    const fiche = ficheDuSolde(s.article_ref, idx)
    if (!fiche) {
      nonResolus.push(s)
      continue
    }
    const lieuType = s.lieu_type == null ? '' : String(s.lieu_type)
    const lieuId = s.lieu_id == null ? '' : String(s.lieu_id)
    const cle = `${lieuType}|${lieuId}|${fiche.id}`
    if (!parCle.has(cle)) parCle.set(cle, { fiche, lieu_type: lieuType, lieu_id: lieuId, docs: [] })
    parCle.get(cle).docs.push(s)
  }

  /** @type {CasFragmente[]} */
  const cas = []
  for (const g of parCle.values()) {
    if (g.docs.length < 2) continue
    const docs = g.docs.slice().sort((a, b) => String(a.docId).localeCompare(String(b.docId)))
    const cible = choisirSoldeCible(docs, g.fiche.id, g.lieu_type, g.lieu_id)
    const anomalies = []
    const unites = new Set(docs.map((d) => uniteComparable(d.unite)).filter((u) => u !== ''))
    if (unites.size > 1) {
      anomalies.push(
        'unités divergentes (' + Array.from(unites).join(' / ') +
          ') — sommer reviendrait à additionner des grandeurs différentes'
      )
    }
    cas.push({
      article_id: String(g.fiche.id),
      article_nom: g.fiche.nom == null ? '' : String(g.fiche.nom),
      lieu_type: g.lieu_type,
      lieu_id: g.lieu_id,
      docs,
      total: centime(docs.reduce((n, d) => n + (Number(d.balance) || 0), 0)),
      conserve: String(cible.docId),
      supprimes: docs.map((d) => String(d.docId)).filter((id) => id !== String(cible.docId)),
      anomalies,
    })
  }
  cas.sort((a, b) => (a.article_nom + a.lieu_id).localeCompare(b.article_nom + b.lieu_id, 'fr'))
  return { cas, non_resolus: nonResolus }
}

/**
 * Cas RÉELLEMENT exécutables : ceux sans anomalie.
 * @param {CasFragmente[]} cas @returns {CasFragmente[]}
 */
function casExecutables(cas) {
  return (Array.isArray(cas) ? cas : []).filter((c) => c.anomalies.length === 0)
}

/**
 * Incrément à appliquer au document conservé : la somme des fragments absorbés.
 * Relatif, jamais absolu — une validation de mouvement concurrente ne doit pas
 * être écrasée (même raison que dans `merge-articles`).
 * @param {CasFragmente} c @returns {number}
 */
function incrementConserve(c) {
  const absorbes = c.docs.filter((d) => String(d.docId) !== c.conserve)
  return centime(absorbes.reduce((n, d) => n + (Number(d.balance) || 0), 0))
}

module.exports = {
  planifierReunion,
  casExecutables,
  incrementConserve,
  indexerCatalogue,
  ficheDuSolde,
}
