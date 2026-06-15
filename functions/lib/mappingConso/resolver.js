'use strict'
// @ts-check

/**
 * Resolver pur du module « Mapping parcelles de consommation ».
 *
 * Aucune dépendance Firestore : toutes les données entrent par argument (DI).
 * Le resolver route les charges de stock vers le CPC selon le statut du
 * mapping de campagne de chaque parcelle de consommation.
 *
 * RÉALIGNEMENT PARCELLE_TO_CPC (2026-06, décision DG) :
 *  - La dimension parcelle→CPC existe DÉJÀ dans la dimension Stock
 *    (functions/lib/stockCaneva/mappings.js → PARCELLE_TO_CPC). Le resolver NE
 *    la duplique PAS : il reçoit en DI un `cpcResolver`
 *      (cibleSysteme:string) => { cpc_code, variete, ferme } | null
 *    (en prod = lookup PARCELLE_TO_CPC ; en test = fixture injectable).
 *  - L'agrégation se fait par `cpc_code` (dimension analytique unique).
 *  - Si une ligne porte une `repartition` 1:N, le montant est éclaté par pct,
 *    chaque part résolue indépendamment via cpcResolver. La SOMME des parts
 *    == montant au centime (dernière part = montant − Σ précédentes : zéro fuite).
 *  - Si cpcResolver(cible) === null (cible inconnue du canevas) → la charge (ou
 *    la part) tombe en `nonResolu`. On NE fabrique JAMAIS un cpc_code.
 *
 * Statuts :
 *  - COVERED (atteint le CPC)      : matched | alias_valide | creee
 *  - NON TRANCHÉ (exclu du CPC)    : alias_propose | a_creer | hors_propose
 *                                    + mapping ABSENT
 *  - hors_confirme                 : RÉSOLU mais EXCLU du CPC (hors-périmètre)
 *
 * Invariant de CONSERVATION (gate QA) :
 *   totalCpc + horsPerimetre + nonResolu === totalSorties (au centime près),
 *   répartitions 1:N incluses (Σ des parts == charge d'origine).
 */

// Source unique de vérité campagne (année fiscale Juillet→Juin) : module partagé
// front+back public/lib/campagneUtils.js. Factorise l'ancien `campagneOf` inline.
const { campagneOf } = require('../../../public/lib/campagneUtils')

const COVERED = new Set(['matched', 'alias_valide', 'creee'])
const NON_TRANCHE = new Set(['alias_propose', 'a_creer', 'hors_propose'])
const HORS_PERIMETRE = new Set(['hors_confirme'])

/**
 * @param {*} mov mouvement de stock
 * @returns {boolean} vrai si c'est une consommation parcelle exploitable.
 */
function isConsommationParcelle(mov) {
  if (!mov || mov.type !== 'consommation') return false
  const dest = mov.lieu_destination
  return !!(dest && dest.type === 'parcelle' && dest.id != null && dest.id !== '')
}

/**
 * Somme des montants TTC des items d'un mouvement (fallback 0 si absent).
 * @param {*} mov
 * @returns {number}
 */
function montantOf(mov) {
  const items = (mov && mov.items) || []
  let total = 0
  for (const it of items) {
    const m = it && typeof it.montant_ttc === 'number' ? it.montant_ttc : 0
    total += m
  }
  return total
}

/** Arrondi centimes pour neutraliser le bruit flottant. */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Éclate un montant selon une répartition [{cible, pct}, ...] en garantissant
 * Σ(parts) === montant au centime (la DERNIÈRE part absorbe l'arrondi).
 *
 * @param {number} montant
 * @param {Array<{cible:string, pct:number}>} repartition
 * @returns {Array<{cible:string, montant:number}>}
 */
function splitMontant(montant, repartition) {
  const out = []
  let cumul = 0
  for (let i = 0; i < repartition.length; i++) {
    const part = repartition[i]
    let m
    if (i === repartition.length - 1) {
      // Dernière part = reste exact → zéro fuite d'arrondi.
      m = round2(montant - cumul)
    } else {
      m = round2((montant * part.pct) / 100)
      cumul = round2(cumul + m)
    }
    out.push({ cible: part.cible, montant: m })
  }
  return out
}

/**
 * Agrège le nombre de mouvements de consommation par libellé de parcelle de
 * consommation, pour une campagne donnée.
 *
 * @param {Array<*>} mouvements
 * @param {string} campagne
 * @returns {Object<string, number>} { [libelle]: count }
 */
function aggregatePointages(mouvements, campagne) {
  /** @type {Object<string, number>} */
  const counts = {}
  for (const mov of mouvements || []) {
    if (!isConsommationParcelle(mov)) continue
    if (campagneOf(mov.date) !== campagne) continue
    const libelle = mov.lieu_destination.id
    counts[libelle] = (counts[libelle] || 0) + 1
  }
  return counts
}

/**
 * Wrapper PROD : construit un cpcResolver branché sur la dimension Stock réelle.
 * Importe PARCELLE_TO_CPC depuis ../stockCaneva/mappings (pas de duplication).
 * Retourne `(cible) => PARCELLE_TO_CPC[cible] || null`. La pureté testable de
 * `resolveCharges` reste préservée : ce wrapper est OPTIONNEL et n'est pas
 * appelé par les tests (qui injectent leur propre fixture).
 *
 * @returns {(cible:string)=>({cpc_code:string, variete:string, ferme:string}|null)}
 */
function makeCpcResolverFromCaneva() {
  const { PARCELLE_TO_CPC } = require('../stockCaneva/mappings')
  return function (cible) {
    if (cible == null) return null
    return PARCELLE_TO_CPC[cible] || null
  }
}

/**
 * Résout les charges de stock vers le CPC.
 *
 * @param {Object} args
 * @param {Array<*>} args.mouvements            mouvements de stock bruts
 * @param {Object<string, *>} args.mappingByParcelle  mapping de campagne indexé
 *        par libellé de parcelle de consommation ; chaque entrée porte au moins
 *        { statut, cible_parcelle_culturale, repartition? }.
 * @param {string} args.campagne
 * @param {(cible:string)=>({cpc_code:string, variete?:string, ferme?:string}|null)} args.cpcResolver
 *        DI : résout une cible système → CPC. Null si cible inconnue du canevas.
 * @returns {{
 *   cpc: Array<{cpc_code:string, variete:string|null, montant:number}>,
 *   totalCpc:number, horsPerimetre:number, nonResolu:number, totalSorties:number
 * }}
 */
function resolveCharges(args) {
  const mouvements = (args && args.mouvements) || []
  const mappingByParcelle = (args && args.mappingByParcelle) || {}
  const campagne = args && args.campagne
  const cpcResolver =
    (args && args.cpcResolver) ||
    function () {
      return null
    }

  /** @type {Map<string, {cpc_code:string, variete:string|null, montant:number}>} */
  const cpcMap = new Map()
  let horsPerimetre = 0
  let nonResolu = 0
  let totalSorties = 0

  /** Agrège une part (montant déjà éclaté) sur une cible système. */
  function routePart(cible, montant) {
    const cpc = cible != null ? cpcResolver(cible) : null
    if (!cpc || cpc.cpc_code == null) {
      // Cible inconnue du canevas → on ne fabrique pas de cpc.
      nonResolu = round2(nonResolu + montant)
      return
    }
    const key = cpc.cpc_code
    const prev = cpcMap.get(key)
    if (prev) {
      prev.montant = round2(prev.montant + montant)
    } else {
      cpcMap.set(key, {
        cpc_code: cpc.cpc_code,
        variete: cpc.variete != null ? cpc.variete : null,
        montant: round2(montant),
      })
    }
  }

  for (const mov of mouvements) {
    if (!isConsommationParcelle(mov)) continue
    if (campagneOf(mov.date) !== campagne) continue

    const montant = montantOf(mov)
    totalSorties = round2(totalSorties + montant)

    const libelle = mov.lieu_destination.id
    const mapping = mappingByParcelle[libelle]
    const statut = mapping && mapping.statut

    if (statut && COVERED.has(statut)) {
      const repartition =
        mapping && Array.isArray(mapping.repartition) && mapping.repartition.length
          ? mapping.repartition
          : null
      if (repartition) {
        // 1:N — éclatement par pct (Σ parts == montant au centime).
        const parts = splitMontant(montant, repartition)
        for (const p of parts) routePart(p.cible, p.montant)
      } else {
        const cible =
          mapping.cible_parcelle_culturale != null
            ? mapping.cible_parcelle_culturale
            : null
        routePart(cible, montant)
      }
    } else if (statut && HORS_PERIMETRE.has(statut)) {
      horsPerimetre = round2(horsPerimetre + montant)
    } else {
      // statut non tranché (alias_propose | a_creer | hors_propose) OU
      // mapping absent → non résolu, n'atteint PAS le CPC.
      nonResolu = round2(nonResolu + montant)
    }
  }

  const cpc = Array.from(cpcMap.values()).map((e) => ({
    cpc_code: e.cpc_code,
    variete: e.variete,
    montant: round2(e.montant),
  }))
  const totalCpc = round2(cpc.reduce((s, e) => s + e.montant, 0))

  return {
    cpc: cpc,
    totalCpc: totalCpc,
    horsPerimetre: round2(horsPerimetre),
    nonResolu: round2(nonResolu),
    totalSorties: round2(totalSorties),
  }
}

module.exports = {
  COVERED,
  NON_TRANCHE,
  HORS_PERIMETRE,
  campagneOf,
  aggregatePointages,
  splitMontant,
  makeCpcResolverFromCaneva,
  resolveCharges,
}
