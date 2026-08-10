'use strict'
// @ts-check

/**
 * Initialisation (« seed ») des Ha MANQUANTS du référentiel Smart Berry
 * (`sb_parcelle_referentiel`) depuis les surfaces BEE ONE (BR_Parcelle,
 * `Sup_Parcelle_Culturale`).
 *
 * Pourquoi : le prorata des « groupes de parcelles » lit UNIQUEMENT
 * `sb_parcelle_referentiel.ha` (cf. functions/lib/parcelleGroupes/split.js).
 * Une parcelle sans Ha SB est donc inéligible aux groupes, alors même que le
 * tableau affiche une surface — qui vient en réalité de BEE ONE. On initialise
 * donc UNE FOIS le référentiel avec la surface BEE ONE, puis le prorata
 * continue de lire uniquement Smart Berry (règle produit inchangée). Le Ha
 * reste corrigeable à la main via le bouton « Éditer » du référentiel.
 *
 * Fonction PURE, aucune dépendance Firestore : toutes les données entrent par
 * argument (DI), comme functions/lib/irrigation/.
 *
 * Invariants (testés dans __tests__/seedHa.test.js) :
 *  - PÉRIMÈTRE = LE TABLEAU AFFICHÉ : le plan porte exactement sur les labels
 *    fournis (les parcelles de la campagne sélectionnée à l'écran), jamais sur
 *    une découverte serveur toutes campagnes confondues — sinon la simulation
 *    annonce des parcelles qu'Omar ne voit pas dans le tableau.
 *  - SURFACES RÉSOLUES SERVEUR : le client n'envoie que des labels ; aucune
 *    valeur de `ha` d'origine cliente n'est jamais retenue.
 *  - IDEMPOTENCE : une parcelle qui a déjà `ha > 0` côté SB n'est JAMAIS
 *    touchée (`skipped` raison `deja_sb`) → rejouer l'action ne réécrit rien.
 *  - Pas d'invention de surface : sans surface BEE ONE connue (> 0), on ne
 *    crée rien (`skipped` raison `sans_surface_source`).
 *  - `nom_sb` n'est jamais dans le plan → l'écriture se fait en `{merge:true}`
 *    sur les seuls champs Ha/traçabilité, un nom SB déjà saisi est préservé.
 *  - Déduplication par label normalisé (uppercase + trim), comme partout dans
 *    ce référentiel (doc id = label uppercase).
 */

/** Raison d'exclusion : la parcelle a déjà un Ha Smart Berry > 0. */
const RAISON_DEJA_SB = 'deja_sb'
/** Raison d'exclusion : aucune surface BEE ONE connue (absente ou <= 0). */
const RAISON_SANS_SURFACE = 'sans_surface_source'
/** Valeur du champ `seeded_from` / `source` : surface d'origine BEE ONE. */
const SOURCE_BEE_ONE = 'bee_one'

/**
 * Clé de normalisation d'un label de parcelle (identique à l'id de document
 * de `sb_parcelle_referentiel`).
 *
 * @param {*} label
 * @returns {string}
 */
function normLabel(label) {
  return String(label == null ? '' : label)
    .trim()
    .toUpperCase()
}

/**
 * Nombre positif fini, 0 sinon (tolère les strings type '1.25').
 *
 * @param {*} val
 * @returns {number}
 */
function toPositiveNumber(val) {
  const n = typeof val === 'number' ? val : parseFloat(String(val == null ? '' : val).replace(',', '.'))
  return isFinite(n) && n > 0 ? n : 0
}

/**
 * Indexe une map label → valeur sur les labels NORMALISÉS.
 * (les maps d'entrée sont indexées sur le label brut trimé côté BEE ONE, et
 * sur le label uppercase côté Smart Berry — on unifie.)
 *
 * @param {Object<string, *>|null|undefined} map
 * @returns {Object<string, *>}
 */
function indexByNormLabel(map) {
  const out = {}
  for (const k of Object.keys(map || {})) {
    const key = normLabel(k)
    if (key && out[key] === undefined) out[key] = map[k]
  }
  return out
}

/**
 * Nombre maximum de labels acceptés en une passe (garde-fou d'entrée : le
 * référentiel réel compte quelques dizaines de parcelles par campagne).
 */
const MAX_LABELS = 500

/**
 * @typedef {Object} SanitizedLabels
 * @property {boolean} ok
 * @property {string} [error] message d'erreur si `ok` est faux.
 * @property {Array<string>} labels labels trimés, dédupliqués (vide si !ok).
 */

/**
 * Valide et normalise la liste de labels fournie par le CLIENT (les parcelles
 * du tableau affiché). Le client n'envoie QUE des labels : aucune surface, donc
 * aucune valeur de `ha` d'origine cliente ne peut atteindre Firestore.
 *
 * @param {*} input valeur brute du body (attendu : tableau de strings).
 * @returns {SanitizedLabels}
 */
function sanitizeLabels(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, error: 'labels requis (liste des parcelles affichées)', labels: [] }
  }
  if (input.length > MAX_LABELS) {
    return { ok: false, error: 'Trop de parcelles (max ' + MAX_LABELS + ')', labels: [] }
  }
  const out = []
  const seen = {}
  for (const raw of input) {
    if (typeof raw !== 'string') {
      return { ok: false, error: 'labels doit être une liste de chaînes', labels: [] }
    }
    const trimmed = raw.trim()
    const key = normLabel(trimmed)
    if (!key || seen[key]) continue
    seen[key] = true
    out.push(trimmed)
  }
  if (out.length === 0) {
    return { ok: false, error: 'Aucun label exploitable', labels: [] }
  }
  return { ok: true, labels: out }
}

/**
 * @typedef {Object} SeedCreate
 * @property {string} label libellé BEE ONE trimé (valeur de `label_bee_one`).
 * @property {number} ha surface à écrire dans `sb_parcelle_referentiel.ha`.
 * @property {string} source toujours `'bee_one'`.
 */

/**
 * @typedef {Object} SeedSkipped
 * @property {string} label
 * @property {string} raison `'deja_sb'` | `'sans_surface_source'`
 */

/**
 * Calcule le plan de seed : quelles parcelles recevront un Ha, lesquelles sont
 * ignorées et pourquoi. Ne fait AUCUNE écriture.
 *
 * PÉRIMÈTRE = `labels`, c'est-à-dire EXACTEMENT les parcelles du tableau
 * affiché à l'écran (campagne sélectionnée). Aucune découverte de parcelles
 * n'est faite ici : rien ne peut entrer dans le plan qui ne soit pas dans
 * `labels` (invariant verrouillé par un test).
 *
 * COHÉRENCE AVEC L'AFFICHAGE : la colonne Ha du tableau affiche
 * `sb.ha > 0 ? sb.ha : r.sup`, où `r.sup` provient de la MÊME carte de surfaces
 * BR_Parcelle que `supMap` (action parcelles-campagne-list → `fetchBrParcelleSupMap`).
 * Comme le plan écarte par construction les parcelles ayant déjà `sb.ha > 0`, la
 * valeur proposée vaut donc exactement le `r.sup` affiché. Il n'existe
 * volontairement AUCUN repli sur une surface transmise par le client : une
 * parcelle absente de `supMap` est exclue (`sans_surface_source`) plutôt que
 * seedée avec une valeur qui ne serait pas celle validée à l'écran.
 *
 * Les labels vides sont ignorés silencieusement ; les doublons sont
 * dédupliqués (la première occurrence gagne).
 *
 * @param {Object} input
 * @param {Array<string>} [input.labels] labels des parcelles AFFICHÉES.
 * @param {Object<string, {ha?:number|string}>} [input.sbMap] référentiel SB
 *   existant, indexé par label (normalisé ou non).
 * @param {Object<string, number|string>} [input.supMap] surfaces BEE ONE
 *   (BR_Parcelle), indexées par label (normalisé ou non).
 * @returns {{toCreate: Array<SeedCreate>, skipped: Array<SeedSkipped>}}
 */
function computeSeedPlan(input) {
  const labels = (input && input.labels) || []
  const sbByKey = indexByNormLabel(input && input.sbMap)
  const supByKey = indexByNormLabel(input && input.supMap)

  /** @type {Array<SeedCreate>} */
  const toCreate = []
  /** @type {Array<SeedSkipped>} */
  const skipped = []
  /** @type {Object<string, boolean>} */
  const seen = {}

  for (const raw of labels) {
    const rawLabel = raw == null ? '' : String(raw).trim()
    const key = normLabel(rawLabel)
    if (!key || seen[key]) continue
    seen[key] = true

    const sbEntry = sbByKey[key]
    if (toPositiveNumber(sbEntry && sbEntry.ha) > 0) {
      skipped.push({ label: rawLabel, raison: RAISON_DEJA_SB })
      continue
    }

    // Surface BEE ONE résolue par le SERVEUR uniquement (BR_Parcelle).
    const ha = toPositiveNumber(supByKey[key])
    if (!(ha > 0)) {
      skipped.push({ label: rawLabel, raison: RAISON_SANS_SURFACE })
      continue
    }

    toCreate.push({ label: rawLabel, ha: ha, source: SOURCE_BEE_ONE })
  }

  return { toCreate, skipped }
}

module.exports = {
  MAX_LABELS,
  RAISON_DEJA_SB,
  RAISON_SANS_SURFACE,
  SOURCE_BEE_ONE,
  normLabel,
  sanitizeLabels,
  computeSeedPlan,
}
