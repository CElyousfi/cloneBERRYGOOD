'use strict'
// @ts-check

/**
 * Module pur — CHOIX DE LA FICHE MAÎTRE dans un groupe d'articles en doublon.
 *
 * SOURCE DE VÉRITÉ UNIQUE, partagée par les deux chemins de fusion :
 *   - la pop-up « Fusionner des articles en doublon » (Stock › Articles), via
 *     `articleMerge.groupDuplicates` puis l'action `suggest-article-duplicates` ;
 *   - le script de fusion EN MASSE `scripts/merge-article-duplicates.js`, via
 *     `scripts/lib/articleMasterPick.js` qui n'est plus qu'un ré-export.
 * Les deux chemins DOIVENT choisir la même fiche : sinon Omar fusionne 40
 * groupes à l'écran, lance le script pour le reste, et obtient des décisions
 * contradictoires. Verrouillé par tests/unit/articleMasterPick.test.js.
 *
 * ── POURQUOI ──────────────────────────────────────────────────────────────
 * La pop-up présélectionnait `articles[0]`, c'est-à-dire un ordre d'itération
 * Firestore. Or `merge-articles` ne transfère NI `prix_pmp`, NI `prix_ht`, NI
 * `nb_achats` du doublon vers le maître : retenir la fiche sans prix laisse un
 * article actif NON VALORISABLE (cas réels : VERTIMEC, APOLLO 50 SC,
 * MILBEKNOCK, PRIORI TOP).
 *
 * ── LA CASCADE, À PRIORITÉ EXPLICITE ──────────────────────────────────────
 * Chaque niveau n'est consulté QUE si le précédent n'a rien vu du tout :
 *
 *   1. exactement UNE fiche avec `prix_pmp > 0`                  -> c'est elle
 *   2. sinon, si AUCUNE fiche n'a de `prix_pmp` :
 *      exactement UNE avec `prix_ht > 0`                         -> c'est elle
 *   3. sinon, si AUCUNE fiche n'a ni `prix_pmp` ni `prix_ht` :
 *      exactement UNE avec `nb_achats > 0`                       -> c'est elle
 *   4. sinon : ON NE TRANCHE PAS.
 *
 * ⚠️ Le PMP n'est PAS au même niveau que le prix HT, et ce n'est pas un détail :
 * la valorisation de la consommation lit `prix_pmp` UNIQUEMENT
 * (`functions/index.js`, action `conso-valorisee`) — aucun repli sur
 * `prix_ht`. Une fiche qui ne porte qu'un prix HT n'est donc PAS valorisée.
 * Traiter les deux champs au même niveau (« a un prix ») rendrait indécidable
 * le groupe « une fiche avec PMP contre une fiche avec HT », alors que la
 * réponse est évidente : garder celle qui fait fonctionner la valorisation.
 * Le cas ne se présente sur aucun des 105 groupes actuels — c'est un piège
 * pour demain, fermé aujourd'hui.
 *
 * ── MESURE SUR LES 105 GROUPES DE PRODUCTION ──────────────────────────────
 * 78 groupes tranchés par un prix (niveaux 1 et 2), 27 par `nb_achats`
 * (niveau 3), 0 indécidable. Aucune règle visuelle ne remplace ce calcul :
 * « garder la fiche dont la catégorie porte une majuscule » vaut pour 78
 * groupes et se trompe sur les 27 autres (MALATHION, GIB 3, KELPAK, VERTIMEC,
 * KSC I/II/III/V, …).
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * Hors de la cascade, `decidable` vaut `false` et AUCUN maître n'est proposé.
 * Pas de repli sur `articles[0]` : un arbitrage muet sur une donnée de prix
 * vaut moins qu'un écran qui demande à l'humain de trancher.
 *
 * Aucune dépendance Firestore/IO : 100% pur, testable unitairement.
 */

/** Niveau 1 : la fiche porteuse du PMP (le seul prix que lit la valorisation). */
const REGLE_PMP = 'prix_pmp'
/** Niveau 2 : la fiche porteuse d'un prix HT, à défaut de tout PMP. */
const REGLE_PRIX_HT = 'prix_ht'
/** Niveau 3 : la fiche porteuse de l'historique d'achats. */
const REGLE_NB_ACHATS = 'nb_achats'

/**
 * Lit un champ numérique STRICTEMENT POSITIF, ou null.
 * Une valeur à 0, négative ou non numérique n'est pas une donnée : c'est une
 * absence. La retenir ferait gagner une fiche « valorisée à zéro » contre la
 * vraie fiche.
 * @param {*} valeur
 * @returns {number|null}
 */
function nombrePositif(valeur) {
  const n = parseFloat(valeur)
  if (!isFinite(n) || n <= 0) return null
  return n
}

/**
 * Le PMP d'une fiche, ou null. SEUL prix lu par la valorisation.
 * @param {*} article
 * @returns {number|null}
 */
function pmpArticle(article) {
  if (!article) return null
  return nombrePositif(article.prix_pmp)
}

/**
 * Le prix HT d'une fiche, ou null. NE valorise PAS la consommation.
 * @param {*} article
 * @returns {number|null}
 */
function prixHtArticle(article) {
  if (!article) return null
  return nombrePositif(article.prix_ht)
}

/**
 * @typedef {Object} PrixArticle
 * @property {number} valeur Montant strictement positif.
 * @property {('prix_pmp'|'prix_ht')} champ Champ d'où vient le montant.
 * @property {string} libelle 'PMP' | 'prix HT' — pour l'affichage.
 */

/**
 * Le prix AFFICHABLE d'une fiche : PMP en priorité, sinon prix HT.
 * ⚠️ Helper d'AFFICHAGE. Le choix du maître, lui, ne met jamais les deux
 * champs au même niveau (cf. `choisirMaster`).
 * @param {*} article
 * @returns {PrixArticle|null}
 */
function prixArticle(article) {
  const pmp = pmpArticle(article)
  if (pmp !== null) return { valeur: pmp, champ: 'prix_pmp', libelle: 'PMP' }
  const ht = prixHtArticle(article)
  if (ht !== null) return { valeur: ht, champ: 'prix_ht', libelle: 'prix HT' }
  return null
}

/**
 * Le nombre d'achats d'une fiche (0 si absent / non numérique / négatif).
 * @param {*} article
 * @returns {number}
 */
function nbAchatsArticle(article) {
  if (!article) return 0
  const n = nombrePositif(article.nb_achats)
  return n === null ? 0 : n
}

/**
 * Formate un montant en dirhams, à la française (virgule décimale).
 * @param {number} valeur
 * @returns {string}
 */
function formatDh(valeur) {
  return valeur.toFixed(2).replace('.', ',') + ' DH'
}

/**
 * CLÉ DE FUSION d'une fiche : son docId, et rien d'autre.
 *
 * ⚠️ Le champ `reference` N'EST PAS une clé d'adressage. `merge-articles`
 * résout ses deux paramètres par `collection("articles_catalog").doc(<clé>)` —
 * donc par docId. L'invariant `docId == reference` est verrouillé pour
 * l'AVENIR (articleCatalogWiring), mais 92 fiches de production le violent
 * DÉJÀ, dont 5 dans les 105 groupes de doublons : « azo pro » (ref
 * `ENG 0149` / docId `ENG0149`), « bio actyl », « co actyl h », « ksc 7 perla »
 * et « magical ». Pire, 5 documents FANTÔMES existent aux références espacées
 * (`ENG 0150`, `ENG 0952`, `eng 1245`, `eng 456`, `enr 14`), sans `nom` et
 * sans champ `active` : adresser par `reference` y fait atterrir la fusion,
 * qui écrase les libellés de BDC et de mouvements avec une chaîne vide pendant
 * que la vraie fiche reste active.
 *
 * Le repli sur `reference` ne sert qu'aux appelants qui n'ont pas le docId
 * sous la main (fixtures de test) ; tout chemin de production passe `id`.
 *
 * @param {*} a
 * @returns {string}
 */
function cleDocument(a) {
  if (!a) return ''
  if (a.id != null && String(a.id)) return String(a.id)
  if (a.reference != null && String(a.reference)) return String(a.reference)
  return ''
}

/**
 * @typedef {Object} SuggestionMaster
 * @property {boolean} decidable La cascade a-t-elle tranché ?
 * @property {(string|null)} master_ref docId retenu (null si non tranché) — clé
 *   d'adressage de `merge-articles`, JAMAIS le champ `reference`.
 * @property {*} master Fiche retenue (null si non tranché).
 * @property {Array<*>} doublons Fiches à absorber (vide si non tranché).
 * @property {(string|null)} regle 'prix_pmp' | 'prix_ht' | 'nb_achats' | null.
 * @property {string} raison Phrase française affichable telle quelle.
 */

/**
 * Construit une réponse « non tranché » (fail-closed).
 * @param {string} raison
 * @returns {SuggestionMaster}
 */
function indecidable(raison) {
  return { decidable: false, master_ref: null, master: null, doublons: [], regle: null, raison }
}

/**
 * Construit une réponse tranchée, ou un refus si la fiche n'a pas de clé.
 * @param {Array<*>} liste @param {*} master @param {string} regle @param {string} raison
 * @returns {SuggestionMaster}
 */
function tranche(liste, master, regle, raison) {
  const ref = cleDocument(master)
  if (!ref) {
    return indecidable(
      'la fiche désignée par la règle n\'a pas d\'identifiant exploitable — à choisir manuellement'
    )
  }
  return {
    decidable: true,
    master_ref: ref,
    master,
    doublons: liste.filter((a) => a !== master),
    regle,
    raison,
  }
}

/**
 * Choisit la fiche maître à PRÉSÉLECTIONNER dans un groupe de doublons.
 * @param {Array<*>} articles Fiches du groupe (>= 2 attendues).
 * @returns {SuggestionMaster}
 */
function choisirMaster(articles) {
  const liste = Array.isArray(articles) ? articles.filter(Boolean) : []
  if (liste.length < 2) {
    return indecidable('groupe de moins de 2 fiches — rien à fusionner')
  }

  const avecPmp = liste.filter((a) => pmpArticle(a) !== null)
  const avecHt = liste.filter((a) => prixHtArticle(a) !== null)
  const avecAchats = liste.filter((a) => nbAchatsArticle(a) > 0)

  // ── Niveau 1 — le PMP, seul prix lu par la valorisation.
  if (avecPmp.length === 1) {
    const master = avecPmp[0]
    const pmp = /** @type {number} */ (pmpArticle(master))
    return tranche(liste, master, REGLE_PMP, 'seule fiche à porter un PMP — ' + formatDh(pmp))
  }
  if (avecPmp.length > 1) {
    // Plusieurs PMP : les niveaux suivants ne sont PAS consultés. Trancher sur
    // un prix HT ou un historique d'achats reviendrait à choisir une fiche
    // contre un PMP concurrent — c'est un arbitrage de prix, donc humain.
    return indecidable(
      avecPmp.length + ' fiches portent un PMP — à choisir manuellement (arbitrage de prix)'
    )
  }

  // ── Niveau 2 — AUCUN PMP nulle part : le prix HT départage.
  if (avecHt.length === 1) {
    const master = avecHt[0]
    const ht = /** @type {number} */ (prixHtArticle(master))
    return tranche(
      liste,
      master,
      REGLE_PRIX_HT,
      'aucune fiche ne porte de PMP ; seule fiche à porter un prix HT — ' +
        formatDh(ht) +
        ' (attention : sans PMP, cet article n\'est valorisé ni avant ni après la fusion)'
    )
  }
  if (avecHt.length > 1) {
    return indecidable(
      'aucune fiche ne porte de PMP, et ' +
        avecHt.length +
        ' fiches portent un prix HT — à choisir manuellement (arbitrage de prix)'
    )
  }

  // ── Niveau 3 — aucun prix d'aucune sorte : l'historique d'achats départage.
  if (avecAchats.length === 1) {
    const master = avecAchats[0]
    const n = nbAchatsArticle(master)
    return tranche(
      liste,
      master,
      REGLE_NB_ACHATS,
      'aucune fiche ne porte de prix ; seule fiche avec un historique d\'achats (' +
        n +
        ' achat' +
        (n > 1 ? 's' : '') +
        ')'
    )
  }
  if (avecAchats.length > 1) {
    return indecidable(
      avecAchats.length + ' fiches portent un historique d\'achats — à choisir manuellement'
    )
  }
  return indecidable(
    'aucune fiche ne porte de prix ni d\'historique d\'achats — à choisir manuellement'
  )
}

module.exports = {
  choisirMaster,
  pmpArticle,
  prixHtArticle,
  prixArticle,
  nbAchatsArticle,
  formatDh,
  cleDocument,
  REGLE_PMP,
  REGLE_PRIX_HT,
  REGLE_NB_ACHATS,
}
