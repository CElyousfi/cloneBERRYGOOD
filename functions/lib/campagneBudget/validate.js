'use strict'
// @ts-check

/**
 * Budget JH/Ha par parcelle × famille d'opération — logique PURE.
 *
 * Sert les actions `campagne-budget-list` / `campagne-budget-save` de
 * functions/pointageService.js. Aucune dépendance Firestore : le référentiel
 * des familles et la liste des labels connus entrent par argument (DI), comme
 * functions/lib/parcelleGroupes/.
 *
 * MODÈLE DE DONNÉES (collection `sb_campagne_budget_jh`) :
 *   docId  = `${campagne}__${LABEL_BEE_ONE_MAJUSCULE}`  (ex. '2026-2027__F5- CASCADE -S13')
 *   champs = {
 *     campagne: '2026-2027',
 *     label_bee_one: 'F5- CASCADE -S13',   // libellé source, non normalisé
 *     budgets: { 'Ferti-irrigation': 3.5, 'Taille': 1.2 },  // JH par Ha
 *     updated_by: { uid, profileId },
 *     updated_at: serverTimestamp(),
 *   }
 *
 * Pourquoi la campagne DANS la clé : `sb_parcelle_referentiel` est clé par le
 * seul label, ce qui rend impossible une valeur propre à une campagne. Un
 * budget change d'une campagne à l'autre — on ne reproduit pas cette limite.
 *
 * Règles de validation :
 *  - campagne au format 'AAAA-BBBB' avec BBBB = AAAA + 1 ;
 *  - label non vide, présent dans les labels connus (source :
 *    `sb_parcelle_referentiel`), sans '/' (interdit dans un docId Firestore) ;
 *  - familles : uniquement des familles du référentiel des tâches
 *    (`referentiel_taches`), jamais une liste figée en dur ;
 *  - valeurs : nombres finis, >= 0, <= MAX_JH_PAR_HA ; virgule décimale
 *    acceptée (saisie FR) ; arrondies à 2 décimales.
 *  - un budget à 0 n'est pas stocké : 0 = « pas de budget défini » (cf.
 *    mergeBudgets), c'est le moyen d'effacer une ligne sans action dédiée.
 */

/** Libellé de campagne 'AAAA-BBBB'. */
const __cb_CAMPAGNE_RE = /^(\d{4})-(\d{4})$/

/** Garde-fou : au-delà, c'est une faute de frappe, pas un budget. */
const MAX_JH_PAR_HA = 1000

/** Garde-fou : nombre de familles acceptées dans un seul save. */
const MAX_FAMILLES = 50

/**
 * Normalise un libellé de campagne. Accepte 'AAAA-BBBB' et 'AAAA/BBBB'
 * (l'écran Campagne affiche la seconde forme) — sortie toujours avec un tiret.
 *
 * @param {*} campagne
 * @returns {string} '' si invalide (année de fin != année de début + 1 incluse).
 */
function normCampagne(campagne) {
  const raw = String(campagne == null ? '' : campagne).trim().replace('/', '-')
  const m = raw.match(__cb_CAMPAGNE_RE)
  if (!m) return ''
  const start = parseInt(m[1], 10)
  const end = parseInt(m[2], 10)
  if (end !== start + 1) return ''
  return `${start}-${end}`
}

/**
 * Clé de parcelle — même normalisation que `sb_parcelle_referentiel`
 * (label BEE ONE trimé en MAJUSCULES).
 *
 * @param {*} label
 * @returns {string}
 */
function normLabel(label) {
  return String(label == null ? '' : label).trim().toUpperCase()
}

/**
 * Identifiant de document Firestore d'un budget.
 *
 * @param {*} campagne
 * @param {*} label
 * @returns {string} '' si campagne ou label invalide (dont label contenant '/',
 *   interdit dans un docId Firestore).
 */
function budgetDocId(campagne, label) {
  const c = normCampagne(campagne)
  const l = normLabel(label)
  if (!c || !l) return ''
  if (l.indexOf('/') !== -1) return ''
  return `${c}__${l}`
}

/**
 * @typedef {Object} ParsedBudget
 * @property {boolean} ok
 * @property {number} [value] valeur arrondie à 2 décimales.
 * @property {string} [error]
 */

/**
 * Parse une valeur de budget JH/Ha saisie (nombre ou chaîne, virgule FR admise).
 * Une valeur vide/null vaut 0 (= budget non défini), jamais une erreur : c'est
 * l'état normal d'un champ que l'utilisateur n'a pas rempli.
 *
 * @param {*} raw
 * @returns {ParsedBudget}
 */
function parseBudgetValue(raw) {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: 0 }
  if (typeof raw === 'boolean') return { ok: false, error: 'Valeur de budget invalide' }
  const num = typeof raw === 'number' ? raw : parseFloat(String(raw).trim().replace(',', '.'))
  if (typeof num !== 'number' || !isFinite(num)) return { ok: false, error: 'Valeur de budget invalide' }
  if (num < 0) return { ok: false, error: 'Le budget JH/Ha ne peut pas être négatif' }
  if (num > MAX_JH_PAR_HA) {
    return { ok: false, error: 'Budget JH/Ha hors limite (max ' + MAX_JH_PAR_HA + ')' }
  }
  return { ok: true, value: Math.round(num * 100) / 100 }
}

/**
 * @typedef {Object} ValidationBudget
 * @property {boolean} ok
 * @property {string} [error] message utilisateur (français).
 * @property {string} [docId]
 * @property {string} [campagne]
 * @property {string} [label] label BEE ONE tel que connu du référentiel.
 * @property {Object<string, number>} [budgets] familles → JH/Ha (0 conservés
 *   ici : c'est mergeBudgets qui décide de la suppression).
 */

/**
 * Valide un `campagne-budget-save`.
 *
 * @param {Object} input
 * @param {*} input.campagne libellé de campagne.
 * @param {*} input.label_bee_one label BEE ONE de la parcelle.
 * @param {*} input.budgets map famille → JH/Ha.
 * @param {Array<string>} input.famillesConnues familles du référentiel tâches.
 * @param {Array<string>} input.labelsConnus labels du référentiel parcelles.
 * @returns {ValidationBudget}
 */
function validateBudgetSave(input) {
  const src = input || {}

  const campagne = normCampagne(src.campagne)
  if (!campagne) return { ok: false, error: 'Campagne invalide (format attendu : 2026-2027)' }

  const label = normLabel(src.label_bee_one)
  if (!label) return { ok: false, error: 'Parcelle requise' }

  // Fail-closed : sans référentiel des familles (Firestore indisponible), on
  // n'a AUCUN moyen de valider une famille → on refuse plutôt que d'écrire
  // n'importe quelle clé dans la map.
  const familles = Array.isArray(src.famillesConnues) ? src.famillesConnues : []
  if (familles.length === 0) {
    return { ok: false, error: 'Référentiel des familles d\'opération indisponible' }
  }
  /** @type {Object<string, string>} */
  const familleByKey = {}
  for (const f of familles) {
    const k = String(f == null ? '' : f).trim()
    if (k) familleByKey[k.toUpperCase()] = k
  }

  const labels = Array.isArray(src.labelsConnus) ? src.labelsConnus : []
  if (labels.length === 0) {
    return { ok: false, error: 'Référentiel des parcelles indisponible' }
  }
  /** @type {Object<string, string>} */
  const labelByKey = {}
  for (const l of labels) {
    const k = normLabel(l)
    if (k) labelByKey[k] = String(l).trim()
  }
  if (!labelByKey[label]) {
    return {
      ok: false,
      error:
        'Parcelle inconnue du référentiel : « ' +
        String(src.label_bee_one).trim() +
        ' » — la créer dans Parcelles & Référentiel avant de saisir un budget',
    }
  }

  const docId = budgetDocId(campagne, label)
  if (!docId) return { ok: false, error: 'Libellé de parcelle invalide' }

  const rawBudgets = src.budgets
  if (rawBudgets === null || typeof rawBudgets !== 'object' || Array.isArray(rawBudgets)) {
    return { ok: false, error: 'Budgets invalides' }
  }
  const entries = Object.keys(rawBudgets)
  if (entries.length === 0) return { ok: false, error: 'Aucun budget à enregistrer' }
  if (entries.length > MAX_FAMILLES) {
    return { ok: false, error: 'Trop de familles dans un seul enregistrement' }
  }

  /** @type {Object<string, number>} */
  const budgets = {}
  for (const rawFamille of entries) {
    const canon = familleByKey[String(rawFamille).trim().toUpperCase()]
    if (!canon) {
      return { ok: false, error: 'Famille d\'opération inconnue : « ' + rawFamille + ' »' }
    }
    if (Object.prototype.hasOwnProperty.call(budgets, canon)) {
      return { ok: false, error: 'Famille en doublon : « ' + canon + ' »' }
    }
    const parsed = parseBudgetValue(rawBudgets[rawFamille])
    if (!parsed.ok) {
      return { ok: false, error: parsed.error + ' (' + canon + ')' }
    }
    budgets[canon] = /** @type {number} */ (parsed.value)
  }

  return { ok: true, docId, campagne, label: labelByKey[label], budgets }
}

/**
 * Fusionne un budget existant avec les valeurs entrantes.
 *
 * Sémantique : l'entrant est autoritaire sur les familles qu'il porte, les
 * autres familles déjà en base sont conservées (un écran qui n'affiche qu'une
 * partie des familles ne doit pas effacer le reste). Une valeur 0 SUPPRIME la
 * famille — « pas de budget » ne se distingue pas de « budget nul » côté
 * calcul de consommation, autant ne pas stocker de bruit.
 *
 * @param {Object<string, *>|null|undefined} existing
 * @param {Object<string, number>} incoming
 * @returns {Object<string, number>} nouvelle map (aucun argument muté).
 */
function mergeBudgets(existing, incoming) {
  /** @type {Object<string, number>} */
  const out = {}
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  for (const k of Object.keys(base)) {
    const n = parseFloat(String(base[k]))
    if (isFinite(n) && n > 0) out[k] = n
  }
  for (const k of Object.keys(incoming || {})) {
    const n = incoming[k]
    if (isFinite(n) && n > 0) out[k] = n
    else delete out[k]
  }
  return out
}

module.exports = {
  MAX_JH_PAR_HA,
  MAX_FAMILLES,
  normCampagne,
  normLabel,
  budgetDocId,
  parseBudgetValue,
  validateBudgetSave,
  mergeBudgets,
}
