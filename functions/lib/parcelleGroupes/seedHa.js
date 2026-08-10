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
 * @typedef {Object} SeedRow
 * @property {string} label libellé BEE ONE (Parcelle_Culturale).
 * @property {number} [sup] surface BEE ONE portée par la ligne (fallback si la
 *   parcelle est absente de `supMap`).
 */

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
 * Les lignes sans label exploitable sont ignorées silencieusement (ce ne sont
 * pas des parcelles). Les doublons de label (une parcelle présente dans les
 * deux campagnes) sont dédupliqués : la première occurrence gagne.
 *
 * @param {Object} input
 * @param {Array<SeedRow>} [input.rows] parcelles candidates (toutes campagnes).
 * @param {Object<string, {ha?:number|string}>} [input.sbMap] référentiel SB
 *   existant, indexé par label (normalisé ou non).
 * @param {Object<string, number|string>} [input.supMap] surfaces BEE ONE
 *   (BR_Parcelle), indexées par label (normalisé ou non).
 * @returns {{toCreate: Array<SeedCreate>, skipped: Array<SeedSkipped>}}
 */
function computeSeedPlan(input) {
  const rows = (input && input.rows) || []
  const sbByKey = indexByNormLabel(input && input.sbMap)
  const supByKey = indexByNormLabel(input && input.supMap)

  /** @type {Array<SeedCreate>} */
  const toCreate = []
  /** @type {Array<SeedSkipped>} */
  const skipped = []
  /** @type {Object<string, boolean>} */
  const seen = {}

  for (const row of rows) {
    const rawLabel = row && row.label != null ? String(row.label).trim() : ''
    const key = normLabel(rawLabel)
    if (!key || seen[key]) continue
    seen[key] = true

    const sbEntry = sbByKey[key]
    if (toPositiveNumber(sbEntry && sbEntry.ha) > 0) {
      skipped.push({ label: rawLabel, raison: RAISON_DEJA_SB })
      continue
    }

    // Surface BEE ONE : la map BR_Parcelle prime (source authoritative,
    // résiliente), la valeur portée par la ligne sert de repli.
    const ha = toPositiveNumber(supByKey[key]) || toPositiveNumber(row && row.sup)
    if (!(ha > 0)) {
      skipped.push({ label: rawLabel, raison: RAISON_SANS_SURFACE })
      continue
    }

    toCreate.push({ label: rawLabel, ha: ha, source: SOURCE_BEE_ONE })
  }

  return { toCreate, skipped }
}

module.exports = {
  RAISON_DEJA_SB,
  RAISON_SANS_SURFACE,
  SOURCE_BEE_ONE,
  normLabel,
  computeSeedPlan,
}
