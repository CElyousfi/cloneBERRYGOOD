'use strict'
// @ts-check

/**
 * Module pur — choix de la FICHE MAÎTRE dans un groupe d'articles en doublon.
 *
 * Mesuré sur les 105 paires réelles de `articles_catalog` (cf. plan du ticket
 * sb/fusion-articles-doublons) : les deux règles ci-dessous les tranchent
 * TOUTES, et aucune paire ne porte deux PMP divergents.
 *
 *   1. une seule fiche du groupe porte un `prix_pmp`  -> c'est elle  (52 paires)
 *   2. sinon, une seule a `nb_achats > 0`             -> c'est elle  (53 paires)
 *
 * Pourquoi cet ordre : `conso-valorisee` (functions/index.js) retient
 * silencieusement le PMP le plus élevé en cas de collision de nom. Conserver la
 * fiche PORTEUSE du PMP est donc aussi ce qui garde la valorisation stable
 * après fusion.
 *
 * Hors de ces deux cas, la fonction NE TRANCHE PAS : elle rend `decided:false`
 * avec la raison. Le script d'orchestration refuse alors d'exécuter — un
 * arbitrage muet sur une donnée de prix n'a pas sa place dans un traitement de
 * masse.
 *
 * Aucune dépendance Firestore/IO : 100% pur, testable unitairement.
 */

/** Règle 1 : la fiche porteuse du PMP. */
const RULE_PMP = 'prix_pmp'
/** Règle 2 : la fiche porteuse de l'historique d'achats. */
const RULE_NB_ACHATS = 'nb_achats'

/**
 * Le PMP d'une fiche, ou null s'il est absent / non numérique / nul.
 * Un `prix_pmp` à 0 n'est pas un PMP : c'est une absence de valorisation.
 * @param {*} article
 * @returns {number|null}
 */
function pmpOf(article) {
  if (!article) return null
  const p = parseFloat(article.prix_pmp)
  if (!isFinite(p) || p <= 0) return null
  return p
}

/**
 * Le nombre d'achats d'une fiche (0 si absent / non numérique / négatif).
 * @param {*} article
 * @returns {number}
 */
function nbAchatsOf(article) {
  if (!article) return 0
  const n = parseFloat(article.nb_achats)
  if (!isFinite(n) || n <= 0) return 0
  return n
}

/**
 * @typedef {Object} MasterPick
 * @property {boolean} decided La règle a-t-elle tranché ?
 * @property {(string|null)} rule 'prix_pmp' | 'nb_achats' | null.
 * @property {*} master Fiche retenue (null si non tranché).
 * @property {Array<*>} doublons Fiches à absorber (vide si non tranché).
 * @property {string} reason Phrase explicative, destinée au rapport.
 * @property {boolean} pmp_divergent Plusieurs PMP différents dans le groupe.
 */

/**
 * Choisit la fiche maître d'un groupe de doublons.
 * @param {Array<*>} articles Fiches du groupe (>=2 attendues).
 * @returns {MasterPick}
 */
function pickMaster(articles) {
  const list = Array.isArray(articles) ? articles.filter(Boolean) : []
  if (list.length < 2) {
    return {
      decided: false,
      rule: null,
      master: null,
      doublons: [],
      reason: 'groupe de moins de 2 fiches — rien à fusionner',
      pmp_divergent: false,
    }
  }

  const avecPmp = list.filter((a) => pmpOf(a) !== null)
  const pmpDistincts = new Set(avecPmp.map((a) => pmpOf(a)))
  const pmpDivergent = pmpDistincts.size > 1

  // Règle 1 — une SEULE fiche porte un PMP.
  if (avecPmp.length === 1) {
    const master = avecPmp[0]
    return {
      decided: true,
      rule: RULE_PMP,
      master,
      doublons: list.filter((a) => a !== master),
      reason: 'seule fiche porteuse d\'un PMP (' + pmpOf(master) + ')',
      pmp_divergent: false,
    }
  }

  // Règle 2 — aucune (ou plusieurs) fiche(s) avec PMP, mais une SEULE avec des achats.
  const avecAchats = list.filter((a) => nbAchatsOf(a) > 0)
  if (avecPmp.length === 0 && avecAchats.length === 1) {
    const master = avecAchats[0]
    return {
      decided: true,
      rule: RULE_NB_ACHATS,
      master,
      doublons: list.filter((a) => a !== master),
      reason:
        'aucune fiche ne porte de PMP ; seule fiche avec un historique d\'achats (' +
        nbAchatsOf(master) +
        ')',
      pmp_divergent: false,
    }
  }

  // Non tranché — on décrit précisément pourquoi, pour que l'arbitrage humain
  // n'ait pas à relire les données.
  let reason
  if (avecPmp.length > 1) {
    reason = pmpDivergent
      ? avecPmp.length + ' fiches portent un PMP, et ces PMP DIVERGENT — arbitrage de prix requis'
      : avecPmp.length + ' fiches portent le même PMP — la règle 1 ne départage pas'
  } else if (avecAchats.length === 0) {
    reason = 'aucune fiche ne porte ni PMP ni historique d\'achats'
  } else {
    reason = avecAchats.length + ' fiches portent un historique d\'achats — la règle 2 ne départage pas'
  }
  return {
    decided: false,
    rule: null,
    master: null,
    doublons: [],
    reason,
    pmp_divergent: pmpDivergent,
  }
}

module.exports = { pickMaster, pmpOf, nbAchatsOf, RULE_PMP, RULE_NB_ACHATS }
