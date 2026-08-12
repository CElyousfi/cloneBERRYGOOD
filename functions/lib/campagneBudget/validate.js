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
 *     budgets: { 'Ferti-irrigation': 3.5, 'Taille': 1.2 },  // JH/Ha AU NIVEAU FAMILLE
 *     budgets_operations: {                                 // JH/Ha PAR OPÉRATION
 *       'Ferti-irrigation': { 'Nettoyage goutteurs': 0.8, 'Fertigation': 2.7 },
 *     },
 *     updated_by: { uid, profileId },
 *     updated_at: serverTimestamp(),
 *   }
 *
 * COEXISTENCE DES DEUX NIVEAUX (aucune migration) : `budgets` est CONSERVÉ tel
 * quel. Les documents écrits par le lot précédent (niveau famille uniquement)
 * restent lisibles et exploitables sans être touchés — `budgets_operations` est
 * simplement absent, donc `{}`. Cas métier réel : dans le budget d'Omar, la
 * famille « Service générale » n'a QU'un total de famille, sans détail par
 * opération — le niveau famille n'est donc pas une compatibilité héritée mais
 * un mode de saisie de plein droit.
 *
 * RÈGLE DE TOTAL D'UNE FAMILLE (`familleTotal`, PURE) : somme de ses opérations
 * si elle en porte au moins une > 0, SINON la valeur saisie au niveau famille.
 * Les deux ne s'additionnent jamais (pas de double comptage).
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
 *  - opérations : uniquement des COUPLES (famille, opération) du même
 *    référentiel — une opération rattachée à une autre famille est refusée ;
 *  - valeurs : nombres finis, >= 0, <= MAX_JH_PAR_HA ; virgule décimale
 *    acceptée (saisie FR) ; arrondies à 2 décimales.
 *  - un budget à 0 n'est pas stocké : 0 = « pas de budget défini » (cf.
 *    mergeBudgets), c'est le moyen d'effacer une ligne sans action dédiée.
 */

/** Libellé de campagne 'AAAA-BBBB'. */
const __cb_CAMPAGNE_RE = /^(\d{4})-(\d{4})$/

/** Nombre décimal strict (pas de '3abc', pas de '1e3', pas d'espaces internes). */
const __cb_NUMERIC_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/** Garde-fou : au-delà, c'est une faute de frappe, pas un budget. */
const MAX_JH_PAR_HA = 1000

/** Garde-fou : nombre de familles acceptées dans un seul save. */
const MAX_FAMILLES = 50

/**
 * Garde-fou : nombre d'opérations acceptées dans un seul save, toutes familles
 * confondues. Le référentiel d'Omar en compte 108 — on laisse une marge large
 * sans autoriser un payload arbitraire.
 */
const MAX_OPERATIONS = 500

/**
 * Part maximale des entrées existantes qu'une purge automatique a le droit de
 * supprimer d'un coup (au-delà d'UNE entrée).
 *
 * POURQUOI : le fail-safe « référentiel vide = aucune purge » ne couvre que la
 * panne franche. Un référentiel PARTIELLEMENT dégradé (non vide mais amputé —
 * lecture Firestore incomplète, import de `referentiel_taches` à moitié
 * appliqué) passe la garde et supprime définitivement, au premier save, tout ce
 * qui manque. La surface est passée de ~11 familles à ~108 opérations : le coût
 * d'une purge erronée a été multiplié par dix.
 *
 * SEUIL RETENU — un tiers, avec un plancher de 1 entrée :
 *  - une purge légitime est un ÉVÉNEMENT DE RÉFÉRENTIEL isolé (une opération
 *    renommée, une famille supprimée) : elle porte sur une ou deux entrées,
 *    jamais sur un tiers du budget d'une parcelle ;
 *  - le plancher de 1 garde le cas « le document n'a qu'une ou deux entrées,
 *    dont une obsolète » nettoyable (1 sur 2 = 50 %, au-dessus du ratio) ;
 *  - au-delà, on ne SUPPRIME pas : la purge est REPORTÉE (les entrées restent
 *    en base) et signalée à l'appelant. Un vrai grand ménage de référentiel se
 *    fera alors en plusieurs saves, ou par une opération dédiée validée — pas
 *    par effet de bord d'une saisie.
 * Décision volontairement conservatrice : une purge reportée coûte un budget
 * fantôme de plus, une purge erronée coûte une saisie perdue.
 */
const MAX_PURGE_RATIO = 1 / 3

/**
 * La purge est-elle d'une ampleur plausible ? PURE.
 *
 * @param {number} nbPurgees
 * @param {number} nbTotal nombre d'entrées AVANT purge.
 * @returns {boolean}
 */
function purgeAutorisee(nbPurgees, nbTotal) {
  if (nbPurgees <= 1) return true
  return nbPurgees <= nbTotal * MAX_PURGE_RATIO
}

/**
 * Séparateur de clé d'index (famille, opération) — jamais persisté. Caractère
 * de contrôle : un séparateur imprimable rendrait ('A B', 'C') et ('A', 'B C')
 * indiscernables.
 */
const __cb_SEP = '\u0000'

/**
 * Clé d'index d'un couple (famille, opération), insensible à la casse.
 * @param {*} famille
 * @param {*} operation
 * @returns {string}
 */
function __cb_opKey(famille, operation) {
  return (
    String(famille == null ? '' : famille).trim().toUpperCase() +
    __cb_SEP +
    String(operation == null ? '' : operation).trim().toUpperCase()
  )
}

/**
 * Indexe le référentiel des opérations par couple (famille, opération).
 *
 * @param {Array<{famille?: *, operation?: *}>|null|undefined} operationsConnues
 * @returns {Object<string, {famille: string, operation: string}>} vide si le
 *   référentiel est absent (l'appelant décide alors du fail-closed).
 */
function indexOperations(operationsConnues) {
  /** @type {Object<string, {famille: string, operation: string}>} */
  const out = {}
  const list = Array.isArray(operationsConnues) ? operationsConnues : []
  for (const o of list) {
    if (!o || typeof o !== 'object') continue
    const famille = String(o.famille == null ? '' : o.famille).trim()
    const operation = String(o.operation == null ? '' : o.operation).trim()
    if (!famille || !operation) continue
    const k = __cb_opKey(famille, operation)
    if (!out[k]) out[k] = { famille, operation }
  }
  return out
}

/**
 * Libellé lisible d'un couple purgé — sert les messages utilisateur.
 * @param {string} famille
 * @param {string} operation
 * @returns {string}
 */
function operationLabel(famille, operation) {
  return famille + ' — ' + operation
}

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
  let num
  if (typeof raw === 'number') {
    num = raw
  } else if (typeof raw === 'string') {
    // parseFloat('3abc') vaut 3 : trop permissif pour une action POST-able à la
    // main. On exige un nombre décimal ENTIER de bout en bout.
    const s = raw.trim().replace(',', '.')
    if (!__cb_NUMERIC_RE.test(s)) return { ok: false, error: 'Valeur de budget invalide' }
    num = parseFloat(s)
  } else {
    return { ok: false, error: 'Valeur de budget invalide' }
  }
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
 * @property {Object<string, Object<string, number>>} [budgets_operations]
 *   famille → opération → JH/Ha (0 conservés, cf. mergeBudgetsOperations).
 */

/**
 * Valide un `campagne-budget-save`.
 *
 * Les deux niveaux sont acceptés ensemble ou séparément : un save peut ne
 * porter que des familles (cas « Service générale », ou document historique du
 * lot précédent), que des opérations, ou les deux. Au moins un des deux doit
 * être non vide.
 *
 * @param {Object} input
 * @param {*} input.campagne libellé de campagne.
 * @param {*} input.label_bee_one label BEE ONE de la parcelle.
 * @param {*} [input.budgets] map famille → JH/Ha.
 * @param {*} [input.budgets_operations] map famille → (opération → JH/Ha).
 * @param {Array<string>} input.famillesConnues familles du référentiel tâches.
 * @param {Array<{famille?: *, operation?: *}>} [input.operationsConnues] couples
 *   (famille, opération) du référentiel tâches — requis dès qu'une opération
 *   est saisie (fail-closed).
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

  // Niveau FAMILLE — `undefined` admis depuis l'ajout du niveau opération : un
  // client peut n'envoyer que le détail par opération.
  const rawBudgets = src.budgets === undefined ? {} : src.budgets
  if (rawBudgets === null || typeof rawBudgets !== 'object' || Array.isArray(rawBudgets)) {
    return { ok: false, error: 'Budgets invalides' }
  }
  const entries = Object.keys(rawBudgets)
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

  // Niveau OPÉRATION.
  const rawOps = src.budgets_operations === undefined ? {} : src.budgets_operations
  if (rawOps === null || typeof rawOps !== 'object' || Array.isArray(rawOps)) {
    return { ok: false, error: 'Budgets par opération invalides' }
  }
  const familleOpsEntries = Object.keys(rawOps)
  if (familleOpsEntries.length > MAX_FAMILLES) {
    return { ok: false, error: 'Trop de familles dans un seul enregistrement' }
  }
  const opsIndex = indexOperations(src.operationsConnues)
  /** @type {Object<string, Object<string, number>>} */
  const budgetsOperations = {}
  let nbOperations = 0
  for (const rawFamille of familleOpsEntries) {
    const canonFamille = familleByKey[String(rawFamille).trim().toUpperCase()]
    if (!canonFamille) {
      return { ok: false, error: 'Famille d\'opération inconnue : « ' + rawFamille + ' »' }
    }
    if (Object.prototype.hasOwnProperty.call(budgetsOperations, canonFamille)) {
      return { ok: false, error: 'Famille en doublon : « ' + canonFamille + ' »' }
    }
    const rawFamilleOps = rawOps[rawFamille]
    if (rawFamilleOps === null || typeof rawFamilleOps !== 'object' || Array.isArray(rawFamilleOps)) {
      return { ok: false, error: 'Budgets par opération invalides (' + canonFamille + ')' }
    }
    /** @type {Object<string, number>} */
    const famBudgets = {}
    for (const rawOperation of Object.keys(rawFamilleOps)) {
      // Fail-closed : sans référentiel des opérations, aucune validation
      // possible → on refuse plutôt que d'écrire une clé arbitraire.
      if (Object.keys(opsIndex).length === 0) {
        return { ok: false, error: 'Référentiel des opérations indisponible' }
      }
      nbOperations += 1
      if (nbOperations > MAX_OPERATIONS) {
        return { ok: false, error: 'Trop d\'opérations dans un seul enregistrement' }
      }
      const hit = opsIndex[__cb_opKey(canonFamille, rawOperation)]
      if (!hit) {
        return {
          ok: false,
          error: 'Opération inconnue du référentiel : « ' + rawOperation
            + ' » (' + canonFamille + ')',
        }
      }
      if (Object.prototype.hasOwnProperty.call(famBudgets, hit.operation)) {
        return { ok: false, error: 'Opération en doublon : « ' + hit.operation + ' »' }
      }
      const parsedOp = parseBudgetValue(rawFamilleOps[rawOperation])
      if (!parsedOp.ok) {
        return { ok: false, error: parsedOp.error + ' (' + operationLabel(canonFamille, hit.operation) + ')' }
      }
      famBudgets[hit.operation] = /** @type {number} */ (parsedOp.value)
    }
    budgetsOperations[canonFamille] = famBudgets
  }

  if (entries.length === 0 && familleOpsEntries.length === 0) {
    return { ok: false, error: 'Aucun budget à enregistrer' }
  }

  return {
    ok: true,
    docId,
    campagne,
    label: labelByKey[label],
    budgets,
    budgets_operations: budgetsOperations,
  }
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

/**
 * Fusionne les budgets PAR OPÉRATION, même sémantique que `mergeBudgets` mais
 * sur deux niveaux : l'entrant est autoritaire sur les couples (famille,
 * opération) qu'il porte, les autres sont conservés. Une valeur 0 supprime
 * l'opération ; une famille dont il ne reste aucune opération est retirée
 * (jamais de map vide stockée).
 *
 * @param {Object<string, *>|null|undefined} existing
 * @param {Object<string, Object<string, number>>} incoming
 * @returns {Object<string, Object<string, number>>} nouvelle map (aucun
 *   argument muté).
 */
function mergeBudgetsOperations(existing, incoming) {
  /** @type {Object<string, Object<string, number>>} */
  const out = {}
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  for (const famille of Object.keys(base)) {
    const merged = mergeBudgets(base[famille], {})
    if (Object.keys(merged).length > 0) out[famille] = merged
  }
  const inc = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {}
  for (const famille of Object.keys(inc)) {
    const merged = mergeBudgets(out[famille], inc[famille] || {})
    if (Object.keys(merged).length > 0) out[famille] = merged
    else delete out[famille]
  }
  return out
}

/**
 * Total JH/Ha d'une famille — RÈGLE MÉTIER CENTRALE, PURE.
 *
 * Somme des opérations de la famille si elle en porte au moins une > 0 ; sinon
 * la valeur saisie au niveau famille. Les deux niveaux ne s'additionnent
 * JAMAIS : le niveau famille est un total de repli, pas un complément (sans
 * quoi la famille « Service générale », saisie au seul niveau famille, serait
 * comptée deux fois le jour où on lui ajoute une opération).
 *
 * @param {*} famille
 * @param {Object<string, *>|null|undefined} budgets map niveau famille.
 * @param {Object<string, *>|null|undefined} budgetsOperations map niveau opération.
 * @returns {{total: number, source: 'operations'|'famille'|'aucun'}} total
 *   arrondi à 2 décimales.
 */
function familleTotal(famille, budgets, budgetsOperations) {
  const key = String(famille == null ? '' : famille)
  const ops =
    budgetsOperations && typeof budgetsOperations === 'object' ? budgetsOperations[key] : null
  let somme = 0
  if (ops && typeof ops === 'object' && !Array.isArray(ops)) {
    for (const op of Object.keys(ops)) {
      const n = parseFloat(String(ops[op]).replace(',', '.'))
      if (isFinite(n) && n > 0) somme += n
    }
  }
  if (somme > 0) return { total: Math.round(somme * 100) / 100, source: 'operations' }
  const brut = budgets && typeof budgets === 'object' ? budgets[key] : null
  const n = parseFloat(String(brut == null ? '' : brut).replace(',', '.'))
  if (isFinite(n) && n > 0) return { total: Math.round(n * 100) / 100, source: 'famille' }
  return { total: 0, source: 'aucun' }
}

/**
 * Retire d'une map de budgets par opération les couples (famille, opération)
 * absents du référentiel courant. Même décision que `purgeFamillesInconnues`
 * (purge à l'écriture, fail-safe si le référentiel est vide).
 *
 * @param {Object<string, Object<string, number>>} budgetsOperations
 * @param {Array<{famille?: *, operation?: *}>|null|undefined} operationsConnues
 *   liste vide/absente = aucune purge.
 * @returns {{budgets_operations: Object<string, Object<string, number>>,
 *   purgees: Array<string>, purge_differee?: number}} `purgees` = libellés
 *   « Famille — Opération » ; `purge_differee` = nombre d'entrées épargnées par
 *   le garde-fou proportionnel (cf. MAX_PURGE_RATIO).
 */
function purgeOperationsInconnues(budgetsOperations, operationsConnues) {
  const src =
    budgetsOperations && typeof budgetsOperations === 'object' && !Array.isArray(budgetsOperations)
      ? budgetsOperations
      : {}
  const index = indexOperations(operationsConnues)
  if (Object.keys(index).length === 0) {
    return { budgets_operations: mergeBudgetsOperations(src, {}), purgees: [] }
  }
  /** @type {Object<string, Object<string, number>>} */
  const out = {}
  /** @type {Array<string>} */
  const purgees = []
  for (const famille of Object.keys(src)) {
    const ops = src[famille]
    if (!ops || typeof ops !== 'object' || Array.isArray(ops)) continue
    /** @type {Object<string, number>} */
    const kept = {}
    for (const operation of Object.keys(ops)) {
      if (index[__cb_opKey(famille, operation)]) kept[operation] = ops[operation]
      else purgees.push(operationLabel(famille, operation))
    }
    if (Object.keys(kept).length > 0) out[famille] = kept
  }
  let nbTotal = 0
  for (const famille of Object.keys(src)) {
    const ops = src[famille]
    if (ops && typeof ops === 'object' && !Array.isArray(ops)) nbTotal += Object.keys(ops).length
  }
  // Purge d'ampleur invraisemblable → référentiel probablement dégradé : on ne
  // supprime rien (cf. MAX_PURGE_RATIO).
  if (!purgeAutorisee(purgees.length, nbTotal)) {
    return {
      budgets_operations: mergeBudgetsOperations(src, {}),
      purgees: [],
      purge_differee: purgees.length,
    }
  }
  return { budgets_operations: out, purgees, purge_differee: 0 }
}

/**
 * Retire d'une map de budgets les familles absentes du référentiel courant.
 *
 * DÉCISION (documentée) : purge À L'ÉCRITURE. Une famille supprimée/renommée
 * dans `referentiel_taches` n'est plus affichée par l'écran de saisie, donc
 * plus jamais effaçable par l'utilisateur, tout en continuant d'être réécrite
 * à chaque save et de peser dans les futurs calculs de consommation (LOT 2).
 * On préfère la nettoyer au prochain enregistrement de la parcelle plutôt que
 * de laisser un budget fantôme. La purge ne se déclenche QUE lors d'un save
 * explicite sur cette parcelle (jamais en masse, jamais en lecture), et le
 * référentiel des familles est déjà exigé non vide en amont
 * (`validateBudgetSave`) — donc jamais de purge totale sur un référentiel
 * momentanément indisponible.
 *
 * DEUXIÈME GARDE-FOU : la purge est aussi REPORTÉE si son ampleur est
 * invraisemblable (cf. MAX_PURGE_RATIO) — le référentiel est alors
 * probablement dégradé, pas réellement amputé.
 *
 * @param {Object<string, number>} budgets
 * @param {Array<string>|null|undefined} famillesConnues liste vide/absente =
 *   aucune purge (fail-safe : on ne supprime rien sans référentiel).
 * @returns {{budgets: Object<string, number>, purgees: Array<string>,
 *   purge_differee?: number}} `purge_differee` = nombre d'entrées qui AURAIENT
 *   été supprimées si le garde-fou n'avait pas bloqué (0 = purge appliquée).
 */
function purgeFamillesInconnues(budgets, famillesConnues) {
  const src = budgets && typeof budgets === 'object' ? budgets : {}
  const familles = Array.isArray(famillesConnues) ? famillesConnues : []
  if (familles.length === 0) return { budgets: Object.assign({}, src), purgees: [] }
  /** @type {Object<string, boolean>} */
  const known = {}
  for (const f of familles) {
    const k = String(f == null ? '' : f).trim().toUpperCase()
    if (k) known[k] = true
  }
  /** @type {Object<string, number>} */
  const out = {}
  const purgees = []
  for (const k of Object.keys(src)) {
    if (known[String(k).trim().toUpperCase()]) out[k] = src[k]
    else purgees.push(k)
  }
  // Même garde-fou proportionnel qu'au niveau opération (cf. MAX_PURGE_RATIO).
  if (!purgeAutorisee(purgees.length, Object.keys(src).length)) {
    return { budgets: Object.assign({}, src), purgees: [], purge_differee: purgees.length }
  }
  return { budgets: out, purgees, purge_differee: 0 }
}

/**
 * Écrit un budget dans une transaction Firestore. `tx` et `docRef` sont
 * injectés (DI) → testable sans émulateur (indisponible ici : Java absent).
 *
 * POURQUOI PAS `set(…, { merge: true })` : le masque de champs d'un
 * `set(merge:true)` est construit à partir des FEUILLES de l'objet
 * (@google-cloud/firestore `DocumentMask.fromObject` → `extractFieldPaths`
 * récurse dans les maps). Le masque contient donc `budgets.<famille encore
 * présente>` mais PAS les familles retirées : leur ancienne valeur SURVIT en
 * base. Bug d'autant plus traître que le cas « tout effacer » fonctionne (map
 * vide → le chemin `budgets` entier est poussé).
 * SOLUTION RETENUE : `mergeFields` avec `budgets` listé explicitement → le
 * masque contient le chemin `budgets`, la map est remplacée EN ENTIER, tout en
 * laissant intact un éventuel champ futur non listé (ce qu'un `set()` sans
 * option écraserait).
 * `budgets_operations` (map de maps) est exposé au MÊME piège, en pire : un
 * `{merge:true}` produirait des chemins `budgets_operations.<famille>.<op>` et
 * ferait survivre toute opération retirée. Le champ est donc listé lui aussi
 * dans `mergeFields`, à la racine et à la racine SEULEMENT.
 *
 * @param {{get: Function, set: Function}} tx transaction Firestore.
 * @param {Object} docRef référence du document budget.
 * @param {Object} args
 * @param {string} args.campagne
 * @param {string} args.label
 * @param {Object<string, number>} args.budgets valeurs validées entrantes
 *   (niveau famille).
 * @param {Object<string, Object<string, number>>} [args.budgets_operations]
 *   valeurs validées entrantes (niveau opération).
 * @param {Array<string>} [args.famillesConnues] référentiel courant (purge).
 * @param {Array<{famille?: *, operation?: *}>} [args.operationsConnues]
 *   référentiel courant des opérations (purge).
 * @param {string|null} args.uid
 * @param {string} args.profileId
 * @param {*} args.serverTimestamp valeur d'horodatage serveur (injectée).
 * @returns {Promise<{budgets: Object<string, number>,
 *   budgets_operations: Object<string, Object<string, number>>,
 *   purgees: Array<string>, operations_purgees: Array<string>,
 *   familles_neutralisees: Array<{famille: string, valeur_precedente: number}>,
 *   purge_differee: number}>}
 */
async function writeBudgetInTransaction(tx, docRef, args) {
  const a = args || {}
  const snap = await tx.get(docRef)
  const exists = snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists)
  const data = exists ? (snap.data() || {}) : {}
  const avant = mergeBudgets(data.budgets || null, {})
  const merged = mergeBudgets(data.budgets || null, a.budgets || {})
  const purged = purgeFamillesInconnues(merged, a.famillesConnues)
  const mergedOps = mergeBudgetsOperations(
    data.budgets_operations || null,
    a.budgets_operations || {}
  )
  const purgedOps = purgeOperationsInconnues(mergedOps, a.operationsConnues)

  // NEUTRALISATIONS : une valeur de famille qui existait, qui disparaît, et
  // dont la famille porte désormais un détail par opération. C'est une perte de
  // saisie légitime (le total bascule sur les opérations, cf. familleTotal) mais
  // JAMAIS anodine — « Récolte » vaut 1800 JH/Ha, ~73 % du budget. On la
  // remonte à l'appelant pour qu'elle soit affichée, comme les purges.
  /** @type {Array<{famille: string, valeur_precedente: number}>} */
  const neutralisees = []
  for (const f of Object.keys(avant)) {
    if (purged.budgets[f] > 0) continue
    const ops = purgedOps.budgets_operations[f]
    if (!ops || Object.keys(ops).length === 0) continue
    neutralisees.push({ famille: f, valeur_precedente: avant[f] })
  }
  tx.set(
    docRef,
    {
      campagne: a.campagne,
      label_bee_one: a.label,
      budgets: purged.budgets,
      budgets_operations: purgedOps.budgets_operations,
      updated_by: { uid: a.uid == null ? null : a.uid, profileId: a.profileId },
      updated_at: a.serverTimestamp,
    },
    // `budgets` et `budgets_operations` listés → maps remplacées en entier
    // (cf. commentaire ci-dessus).
    {
      mergeFields: [
        'campagne',
        'label_bee_one',
        'budgets',
        'budgets_operations',
        'updated_by',
        'updated_at',
      ],
    }
  )
  return {
    budgets: purged.budgets,
    budgets_operations: purgedOps.budgets_operations,
    purgees: purged.purgees,
    operations_purgees: purgedOps.purgees,
    familles_neutralisees: neutralisees,
    purge_differee: (purged.purge_differee || 0) + (purgedOps.purge_differee || 0),
  }
}

module.exports = {
  MAX_JH_PAR_HA,
  MAX_FAMILLES,
  MAX_OPERATIONS,
  MAX_PURGE_RATIO,
  purgeAutorisee,
  normCampagne,
  normLabel,
  budgetDocId,
  indexOperations,
  operationLabel,
  parseBudgetValue,
  validateBudgetSave,
  mergeBudgets,
  mergeBudgetsOperations,
  familleTotal,
  purgeFamillesInconnues,
  purgeOperationsInconnues,
  writeBudgetInTransaction,
}
