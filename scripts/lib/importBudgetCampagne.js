'use strict'
// @ts-check

/**
 * Import du budget de main d'œuvre (JH/Ha) depuis le fichier Excel d'Omar —
 * LOGIQUE PURE.
 *
 * Sert `scripts/import-budget-campagne.js`, qui n'est qu'une coquille
 * d'entrée/sortie (lecture xlsx, affichage, appels réseau). Aucune dépendance
 * Firestore ni réseau ici : les lignes du classeur entrent par argument, le
 * plan d'import sort en valeur. Testable avec `node:test`
 * (tests/unit/importBudgetCampagne.test.js).
 *
 * SOURCE : « BUDGET BERRYGOOD CAMPAGNE 2026-2027.xlsx », premier onglet
 * (`M.O PAR TACHE `). Chemin passé en argument au script — le fichier n'est PAS
 * committé (donnée métier).
 *
 * FORME DU CLASSEUR (index 0-based, vérifiée sur le fichier réel) :
 *   ligne 0-1 : titres ;
 *   ligne 2   : en-têtes de colonnes (col. 0 « GROUPE/ RUBRIQUES », col. 1
 *               « FAMILLE », col. 2 « Nature Opération », puis une colonne par
 *               parcelle) ;
 *   ligne 3   : TOTAL GÉNÉRAL par parcelle (col. 0/1/2 vides) — ignoré, il ne
 *               correspond à aucune famille ;
 *   ensuite   : une alternance de BLOCS. Un bloc s'ouvre sur une ligne de TOTAL
 *               DE FAMILLE (col. 0 remplie, col. 1 et 2 vides) et se poursuit
 *               par ses lignes de DÉTAIL (col. 1 = famille, col. 2 = opération).
 *
 * POURQUOI DES BLOCS ET PAS UN PARSING DU LIBELLÉ DE TOTAL : le libellé de la
 * ligne de total (« M.O Opérationnel Hors récolte  / ENTRETIEN CULTURE ») n'est
 * pas le nom de la famille — il faudrait une deuxième table d'alias, à
 * maintenir. La famille d'un total est celle de ses lignes de détail : c'est
 * structurel, donc juste par construction.
 *
 * DEUX BLOCS PEUVENT VISER LA MÊME FAMILLE : « 10. Entretien cultures »
 * n'existe pas dans le référentiel de l'app, ses opérations vivent sous
 * « Entretien structure » (GB05). Les deux blocs sont donc FUSIONNÉS, et leurs
 * totaux additionnés pour le contrôle de cohérence.
 *
 * DÉCISION FAMILLE vs OPÉRATION (miroir EXACT de la saisie manuelle,
 * `CBT_buildSavePayload` dans public/components/CampagneBudgetTab.jsx) :
 *  - une famille qui porte au moins une opération > 0 est écrite AU NIVEAU
 *    OPÉRATION, et sa valeur de famille est envoyée à 0 (= effacée) ;
 *  - une famille dont toutes les opérations sont vides (cas réel : « Récolte »,
 *    1800 JH/Ha, et « Service générale ») est écrite AU NIVEAU FAMILLE, avec la
 *    valeur de sa ligne de total.
 * Les deux niveaux ne sont JAMAIS renseignés ensemble : `familleTotal`
 * (functions/lib/campagneBudget/validate.js) fait gagner les opérations, une
 * valeur de famille cohabitante serait un fantôme — et déclencherait la
 * « neutralisation » signalée par le backend à chaque save.
 *
 * LE DRY-RUN DOIT ANNONCER CE QUI SE PRODUIRA, pas un plan théorique. Deux
 * garanties, toutes deux pures et testées :
 *  - `preValidatePlan` rejoue CHAQUE payload dans `validateBudgetSave` (la
 *    validation du backend, à l'identique) et bloque `--apply` en TOUT-OU-RIEN
 *    dès qu'une seule parcelle est refusée — jamais d'état partiel ;
 *  - `buildDiff` rejoue le MERGE du backend contre l'état lu en base pour dire
 *    ce qui sera écrasé, supprimé, conservé — `budgets[famille] = 0` supprime
 *    définitivement une valeur existante, et une opération saisie à la main
 *    absente du fichier survit et s'ajoute au total.
 */

const campagneBudget = require('../../functions/lib/campagneBudget/validate')

const {
  opKey,
  normLabel,
  validateBudgetSave,
  mergeBudgets,
  mergeBudgetsOperations,
  canonicalizeOperationKeys,
  familleTotal,
} = campagneBudget

/**
 * Colonne du fichier → label EXACT de `sb_parcelle_referentiel`.
 * Mapping VALIDÉ PAR OMAR (2026-08-12) — ne pas déduire, ne pas élargir.
 * Note « YASMINE » : une seule parcelle, `F5 YAZMIN MT` ; `S10 YAZMIN cut back`
 * est volontairement HORS périmètre.
 * Les 5 colonnes myrtille portent déjà le label du référentiel à l'identique.
 * @type {Object<string, string>}
 */
const PARCELLE_PAR_COLONNE = {
  'MARAVILLA MD': 'F1- S5 MARAVILLA MD',
  'MARAVILLA LONG CANE': 'F1-S6.S7 MARAVILLA MOTTE',
  MIA: 'F5- MYA S9',
  YASMINE: 'F5 YAZMIN MT',
  'F5- CASCADE -S13': 'F5- CASCADE -S13',
  'BREEZE MYRTILLE S8-2': 'BREEZE MYRTILLE S8-2',
  'CASCADE MYRTILLE S8-1': 'CASCADE MYRTILLE S8-1',
  'F5 CORINA myrtille S8-3': 'F5 CORINA myrtille S8-3',
  'F5 -BREEZE- S14': 'F5 -BREEZE- S14',
}

/**
 * Familles du fichier qui portent un autre nom dans le référentiel de l'app.
 * `10. Entretien cultures` n'existe PAS comme famille : ses opérations
 * (Désherbage Manuelle, Ebourgeonnage, Effeuillage) sont rattachées à GB05
 * « Entretien structure ». Validé par Omar — ne pas créer la famille manquante.
 * Clé = libellé du fichier normalisé (cf. normText).
 * @type {Object<string, string>}
 */
const ALIAS_FAMILLES = {
  '10. entretien cultures': 'Entretien structure',
}

/**
 * Variantes d'écriture d'une opération : libellé du FICHIER → libellé du
 * RÉFÉRENTIEL. 8 correspondances validées par Omar (2026-08-12).
 * Clé = libellé du fichier normalisé (cf. normText) ; la valeur est comparée au
 * référentiel elle aussi normalisée, donc les espaces de fin du référentiel
 * (« Evacuation bois taille ») n'ont pas à être reproduits ici.
 * @type {Object<string, string>}
 */
const ALIAS_OPERATIONS = {
  'coupe cutback /md': 'Coupe Cutback',
  'distribution et remplissage pots& ligne continue': 'Distribution et remplissage ligne continue',
  'responsable irrigation/stationaire': 'Responsable irrigation',
  'installation filet couvre sol ( couture y compris)': 'Installation filet couvre sol',
  'evacuation bois taille /cahrg - déch': 'Evacuation bois taille',
  'ramassage bois de taille / vers pistes': 'Ramassage bois de taille',
  lessivage: 'Lessivage pots',
  'grattage,nvlm': 'Grattage',
}

/**
 * Opérations présentes dans le budget d'Omar et ABSENTES de
 * `referentiel_taches` : à CRÉER (jamais à supprimer — le référentiel alimente
 * les écrans de pointage, retirer une opération casserait l'affichage des
 * pointages historiques).
 * @type {Array<{code: string, groupe: string, famille: string, operation: string}>}
 */
const OPERATIONS_A_CREER = [
  { code: 'GB11', groupe: 'M.O Service générale', famille: 'Service générale', operation: 'Aide caporal' },
  { code: 'GB11', groupe: 'M.O Service générale', famille: 'Service générale', operation: 'Caporal' },
  { code: 'GB11', groupe: 'M.O Service générale', famille: 'Service générale', operation: 'Nettoyage ferme' },
]

/** Index de l'en-tête de colonnes dans l'onglet budget (0-based). */
const LIGNE_ENTETES = 2

/** Première ligne de données (la ligne 3 est le total général). */
const PREMIERE_LIGNE_DONNEES = 3

/**
 * Normalise un libellé pour comparaison : espaces compactés, casse ignorée.
 * Les accents sont CONSERVÉS (le référentiel et le budget les écrivent
 * pareillement — les retirer créerait des collisions gratuites).
 *
 * @param {*} s
 * @returns {string}
 */
function normText(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Séparateur des clés d'index (famille, opération) — jamais persisté. Caractère
 * de contrôle, comme `__cb_SEP` dans functions/lib/campagneBudget/validate.js :
 * un séparateur imprimable rendrait ('A B', 'C') et ('A', 'B C') indiscernables.
 */
const CLE_SEP = '\u0000'

/**
 * Clé d'index d'un couple (famille, opération), insensible à la casse et aux
 * espaces parasites. PURE.
 *
 * @param {*} famille
 * @param {*} operation
 * @returns {string}
 */
function cleOperation(famille, operation) {
  return normText(famille) + CLE_SEP + normText(operation)
}

/**
 * Valeur numérique d'une cellule de budget. PURE.
 *
 * @param {*} raw
 * @returns {{ok: boolean, value: number}} `ok:false` = cellule non numérique
 *   (hors vide, qui vaut 0).
 */
function parseCell(raw) {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: 0 }
  if (typeof raw === 'number') {
    if (!isFinite(raw)) return { ok: false, value: 0 }
    return { ok: true, value: Math.round(raw * 100) / 100 }
  }
  const s = String(raw).trim().replace(',', '.')
  if (s === '') return { ok: true, value: 0 }
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return { ok: false, value: 0 }
  const n = parseFloat(s)
  if (!isFinite(n)) return { ok: false, value: 0 }
  return { ok: true, value: Math.round(n * 100) / 100 }
}

/**
 * @typedef {Object} RefOperation
 * @property {string} code code GB/LB.
 * @property {string} famille famille RÉSOLUE DEPUIS LE CODE, trimée.
 * @property {string} operation libellé du référentiel, trimé.
 * @property {string} key clé canonique persistée `CODE::Libellé`.
 */

/**
 * Indexe le référentiel des tâches, EXACTEMENT comme le backend le fait
 * (`referentielOperationsConnues` + `familleDuCode`, functions/pointageService.js) :
 * la famille d'une opération est celle que son CODE résout (première fiche
 * rencontrée pour ce code, trimée), jamais le champ `famille` de la fiche.
 * Sans cette règle, on écrirait un budget sous une famille que le réalisé ne
 * rejoindrait jamais.
 *
 * @param {Array<{code?: *, groupe?: *, famille?: *, operation?: *}>} fiches
 * @returns {{operations: Array<RefOperation>, parFamille: Object<string, string>,
 *   parCle: Object<string, RefOperation>}} `parFamille` : famille normalisée →
 *   orthographe canonique ; `parCle` : clé `cleOperation(famille, opération)` →
 *   opération.
 */
function indexReferentiel(fiches) {
  const list = Array.isArray(fiches) ? fiches : []
  /** @type {Object<string, string>} code → famille (première fiche, trimée) */
  const familleParCode = {}
  for (const f of list) {
    if (!f) continue
    const code = String(f.code == null ? '' : f.code).trim()
    const famille = String(f.famille == null ? '' : f.famille).trim()
    if (code && famille && !familleParCode[code]) familleParCode[code] = famille
  }
  /** @type {Array<RefOperation>} */
  const operations = []
  /** @type {Object<string, string>} */
  const parFamille = {}
  /** @type {Object<string, RefOperation>} */
  const parCle = {}
  for (const f of list) {
    if (!f) continue
    const code = String(f.code == null ? '' : f.code).trim()
    const operation = String(f.operation == null ? '' : f.operation).trim()
    const famille = (code && familleParCode[code]) || String(f.famille == null ? '' : f.famille).trim()
    if (!famille || !operation) continue
    const entry = { code, famille, operation, key: opKey(code, operation) }
    operations.push(entry)
    if (!parFamille[normText(famille)]) parFamille[normText(famille)] = famille
    const k = cleOperation(famille, operation)
    if (!parCle[k]) parCle[k] = entry
  }
  return { operations, parFamille, parCle }
}

/**
 * @typedef {Object} ColonneParcelle
 * @property {number} index index de colonne dans le classeur.
 * @property {string} entete libellé d'en-tête tel qu'écrit dans le fichier.
 * @property {string} label label BEE ONE cible (référentiel parcelles).
 */

/**
 * Résout les colonnes de parcelles depuis la ligne d'en-têtes. PURE.
 *
 * Le rapprochement se fait sur le LIBELLÉ d'en-tête, pas sur un index figé :
 * une colonne insérée dans le fichier ne doit pas décaler silencieusement tout
 * l'import vers la mauvaise parcelle.
 *
 * @param {Array<*>} entetes ligne d'en-têtes du classeur.
 * @returns {{colonnes: Array<ColonneParcelle>, ignorees: Array<{index: number,
 *   entete: string, raison: string}>}}
 */
function resolveColonnes(entetes) {
  const row = Array.isArray(entetes) ? entetes : []
  /** @type {Array<ColonneParcelle>} */
  const colonnes = []
  /** @type {Array<{index: number, entete: string, raison: string}>} */
  const ignorees = []
  /** @type {Object<string, string>} en-tête normalisé → label */
  const index = {}
  for (const k of Object.keys(PARCELLE_PAR_COLONNE)) index[normText(k)] = PARCELLE_PAR_COLONNE[k]
  /** @type {Object<string, number>} */
  const dejaVu = {}
  for (let i = 3; i < row.length; i++) {
    const entete = String(row[i] == null ? '' : row[i]).trim()
    if (!entete) {
      ignorees.push({ index: i, entete: '', raison: 'colonne sans en-tête (séparateur)' })
      continue
    }
    const label = index[normText(entete)]
    if (!label) {
      ignorees.push({ index: i, entete, raison: 'colonne hors mapping validé' })
      continue
    }
    if (dejaVu[label] !== undefined) {
      ignorees.push({
        index: i,
        entete,
        raison: 'colonne en doublon (déjà vue en position ' + dejaVu[label] + ')',
      })
      continue
    }
    dejaVu[label] = i
    colonnes.push({ index: i, entete, label })
  }
  return { colonnes, ignorees }
}

/**
 * @typedef {Object} LigneBudget
 * @property {number} ligne index 0-based dans le classeur (pour les messages).
 * @property {string} libelle libellé de la colonne 2 (opération) ou 0 (total).
 * @property {Object<string, number>} valeurs label de parcelle → JH/Ha.
 * @property {Array<string>} erreurs cellules non numériques.
 */

/**
 * @typedef {Object} BlocBudget
 * @property {string} familleFichier libellé de famille lu en colonne 1.
 * @property {LigneBudget|null} total ligne de total de famille du bloc.
 * @property {Array<LigneBudget>} operations lignes de détail.
 */

/**
 * Découpe l'onglet budget en blocs (total de famille + ses opérations). PURE.
 *
 * @param {Array<Array<*>>} rows lignes brutes du classeur (header:1).
 * @param {Array<ColonneParcelle>} colonnes
 * @returns {{blocs: Array<BlocBudget>, totalGeneral: LigneBudget|null,
 *   ignorees: Array<{ligne: number, raison: string, detail: string}>}}
 */
function parseBlocs(rows, colonnes) {
  const src = Array.isArray(rows) ? rows : []
  const cols = Array.isArray(colonnes) ? colonnes : []
  /** @type {Array<BlocBudget>} */
  const blocs = []
  /** @type {Array<{ligne: number, raison: string, detail: string}>} */
  const ignorees = []
  /** @type {LigneBudget|null} */
  let totalGeneral = null
  /** @type {BlocBudget|null} */
  let courant = null

  /**
   * @param {Array<*>} row
   * @param {number} i
   * @param {string} libelle
   * @returns {LigneBudget}
   */
  function lireValeurs(row, i, libelle) {
    /** @type {Object<string, number>} */
    const valeurs = {}
    /** @type {Array<string>} */
    const erreurs = []
    for (const c of cols) {
      const parsed = parseCell(row[c.index])
      if (!parsed.ok) {
        erreurs.push(c.label + ' : « ' + String(row[c.index]) + ' »')
        continue
      }
      valeurs[c.label] = parsed.value
    }
    return { ligne: i, libelle, valeurs, erreurs }
  }

  for (let i = PREMIERE_LIGNE_DONNEES; i < src.length; i++) {
    const row = Array.isArray(src[i]) ? src[i] : []
    const c0 = String(row[0] == null ? '' : row[0]).trim()
    const c1 = String(row[1] == null ? '' : row[1]).trim()
    const c2 = String(row[2] == null ? '' : row[2]).trim()

    if (!c0 && !c1 && !c2) {
      // Ligne 3 = total général de la parcelle : il ne correspond à aucune
      // famille, on ne l'importe pas (il sert de contrôle de cohérence).
      const ligne = lireValeurs(row, i, 'TOTAL GÉNÉRAL')
      const aDesValeurs = Object.keys(ligne.valeurs).some((k) => ligne.valeurs[k] > 0)
      if (aDesValeurs && !totalGeneral) totalGeneral = ligne
      ignorees.push({
        ligne: i,
        raison: aDesValeurs ? 'total général (contrôle uniquement)' : 'ligne vide',
        detail: '',
      })
      continue
    }

    if (c0 && !c1 && !c2) {
      courant = { familleFichier: '', total: lireValeurs(row, i, c0), operations: [] }
      blocs.push(courant)
      continue
    }

    if (c1 && c2) {
      if (!courant) {
        // Ligne de détail hors bloc : sans total de famille en amont, on ne
        // saurait pas quoi faire d'une famille sans opération renseignée.
        courant = { familleFichier: '', total: null, operations: [] }
        blocs.push(courant)
      }
      if (!courant.familleFichier) courant.familleFichier = c1
      else if (normText(courant.familleFichier) !== normText(c1)) {
        ignorees.push({
          ligne: i,
          raison: 'famille incohérente dans le bloc « ' + courant.familleFichier + ' »',
          detail: c1 + ' — ' + c2,
        })
        continue
      }
      courant.operations.push(lireValeurs(row, i, c2))
      continue
    }

    ignorees.push({ ligne: i, raison: 'ligne non exploitable', detail: [c0, c1, c2].join(' | ') })
  }

  return { blocs, totalGeneral, ignorees }
}

/**
 * @typedef {Object} PlanFamille
 * @property {string} famille famille canonique du référentiel.
 * @property {'operations'|'famille'} source niveau réellement écrit.
 * @property {number} total JH/Ha total de la famille.
 * @property {Array<{key: string, operation: string, libelle_fichier: string,
 *   valeur: number}>} operations entrées écrites au niveau opération.
 * @property {number} total_fichier somme des lignes de total du/des bloc(s).
 * @property {number} ecart total - total_fichier (contrôle de cohérence).
 */

/**
 * @typedef {Object} PlanParcelle
 * @property {string} label label BEE ONE.
 * @property {string} colonne en-tête de colonne d'origine.
 * @property {Object<string, number>} budgets payload niveau famille.
 * @property {Object<string, Object<string, number>>} budgets_operations payload
 *   niveau opération.
 * @property {Array<PlanFamille>} familles détail lisible.
 * @property {number} nb_valeurs nombre de valeurs > 0 réellement écrites.
 * @property {number} total_jh_ha somme des totaux de famille.
 * @property {number|null} total_fichier total général lu dans le fichier.
 * @property {number} ecart_total total_jh_ha - total_fichier.
 */

/**
 * @typedef {Object} PlanImport
 * @property {string} campagne
 * @property {Array<PlanParcelle>} parcelles
 * @property {Array<{index: number, entete: string, raison: string}>} colonnes_ignorees
 * @property {Array<{ligne: number, raison: string, detail: string}>} lignes_ignorees
 * @property {Array<{famille: string, operation: string, ligne: number,
 *   raison: string, valeurs_non_nulles: number}>} operations_ignorees
 * @property {Array<{famille: string, ligne: number, raison: string}>} familles_ignorees
 * @property {Array<{code: string, groupe: string, famille: string, operation: string}>}
 *   referentiel_a_creer opérations manquantes à ajouter (item 5 du lot).
 */

/**
 * Construit le plan d'import complet. PURE — c'est le cœur testable du lot.
 *
 * @param {Object} args
 * @param {Array<Array<*>>} args.budgetRows lignes de l'onglet « M.O PAR TACHE ».
 * @param {Array<{code?: *, groupe?: *, famille?: *, operation?: *}>} args.referentiel
 *   fiches de `referentiel_taches`.
 * @param {string} args.campagne libellé de campagne ('2026-2027').
 * @returns {PlanImport}
 */
function buildImportPlan(args) {
  const a = args || {}
  const campagne = String(a.campagne == null ? '' : a.campagne).trim()
  const ref = indexReferentiel(a.referentiel)
  const { colonnes, ignorees: colonnesIgnorees } = resolveColonnes(
    (Array.isArray(a.budgetRows) ? a.budgetRows : [])[LIGNE_ENTETES]
  )
  const { blocs, totalGeneral, ignorees: lignesIgnorees } = parseBlocs(a.budgetRows, colonnes)

  /** @type {Array<{famille: string, operation: string, ligne: number, raison: string, valeurs_non_nulles: number}>} */
  const operationsIgnorees = []
  /** @type {Array<{famille: string, ligne: number, raison: string}>} */
  const famillesIgnorees = []

  // Regroupement des blocs par famille CANONIQUE (deux blocs peuvent viser la
  // même famille — cf. « 10. Entretien cultures » → « Entretien structure »).
  /** @type {Object<string, {famille: string, totaux: Array<LigneBudget>,
   *   operations: Array<{ref: RefOperation, ligne: LigneBudget}>}>} */
  const parFamille = {}
  /** @type {Array<string>} ordre d'apparition */
  const ordreFamilles = []

  for (const bloc of blocs) {
    const brut = bloc.familleFichier
    if (!brut) {
      if (bloc.total) {
        famillesIgnorees.push({
          famille: bloc.total.libelle,
          ligne: bloc.total.ligne,
          raison: 'total de famille sans aucune ligne de détail — famille indéterminable',
        })
      }
      continue
    }
    const cible = ALIAS_FAMILLES[normText(brut)] || brut
    const canon = ref.parFamille[normText(cible)]
    if (!canon) {
      famillesIgnorees.push({
        famille: brut,
        ligne: bloc.total ? bloc.total.ligne : (bloc.operations[0] || { ligne: -1 }).ligne,
        raison: 'famille absente du référentiel des tâches',
      })
      continue
    }
    if (!parFamille[canon]) {
      parFamille[canon] = { famille: canon, totaux: [], operations: [] }
      ordreFamilles.push(canon)
    }
    if (bloc.total) parFamille[canon].totaux.push(bloc.total)
    for (const ligne of bloc.operations) {
      const cibleOp = ALIAS_OPERATIONS[normText(ligne.libelle)] || ligne.libelle
      const hit = ref.parCle[cleOperation(canon, cibleOp)]
      if (!hit) {
        operationsIgnorees.push({
          famille: canon,
          operation: ligne.libelle,
          ligne: ligne.ligne,
          raison: 'opération absente du référentiel des tâches (famille ' + canon + ')',
          valeurs_non_nulles: Object.keys(ligne.valeurs).filter((k) => ligne.valeurs[k] > 0).length,
        })
        continue
      }
      parFamille[canon].operations.push({ ref: hit, ligne })
    }
  }

  /** @type {Array<PlanParcelle>} */
  const parcelles = []
  for (const col of colonnes) {
    /** @type {Object<string, number>} */
    const budgets = {}
    /** @type {Object<string, Object<string, number>>} */
    const budgetsOperations = {}
    /** @type {Array<PlanFamille>} */
    const familles = []
    let nbValeurs = 0
    let totalJh = 0

    for (const nom of ordreFamilles) {
      const g = parFamille[nom]
      /** @type {Array<{key: string, operation: string, libelle_fichier: string, valeur: number}>} */
      const ops = []
      let somme = 0
      for (const o of g.operations) {
        const v = o.ligne.valeurs[col.label]
        if (!(typeof v === 'number' && v > 0)) continue
        ops.push({
          key: o.ref.key,
          operation: o.ref.operation,
          libelle_fichier: o.ligne.libelle,
          valeur: v,
        })
        somme += v
      }
      let totalFichier = 0
      for (const t of g.totaux) {
        const v = t.valeurs[col.label]
        if (typeof v === 'number' && isFinite(v)) totalFichier += v
      }
      totalFichier = Math.round(totalFichier * 100) / 100

      if (ops.length > 0) {
        // Famille détaillée : niveau opération, valeur de famille à 0 (miroir de
        // la saisie manuelle — sinon un total de famille fantôme survivrait).
        somme = Math.round(somme * 100) / 100
        budgets[nom] = 0
        /** @type {Object<string, number>} */
        const map = {}
        for (const o of ops) map[o.key] = o.valeur
        budgetsOperations[nom] = map
        familles.push({
          famille: nom,
          source: 'operations',
          total: somme,
          operations: ops,
          total_fichier: totalFichier,
          ecart: Math.round((somme - totalFichier) * 100) / 100,
        })
        nbValeurs += ops.length
        totalJh += somme
        continue
      }

      if (totalFichier > 0) {
        // Aucune opération renseignée (Récolte, Service générale) : le total de
        // famille EST le budget. Coexistence prévue par le modèle de stockage.
        budgets[nom] = totalFichier
        familles.push({
          famille: nom,
          source: 'famille',
          total: totalFichier,
          operations: [],
          total_fichier: totalFichier,
          ecart: 0,
        })
        nbValeurs += 1
        totalJh += totalFichier
      }
    }

    totalJh = Math.round(totalJh * 100) / 100
    const totalFichierParcelle =
      totalGeneral && typeof totalGeneral.valeurs[col.label] === 'number'
        ? totalGeneral.valeurs[col.label]
        : null
    parcelles.push({
      label: col.label,
      colonne: col.entete,
      budgets,
      budgets_operations: budgetsOperations,
      familles,
      nb_valeurs: nbValeurs,
      total_jh_ha: totalJh,
      total_fichier: totalFichierParcelle,
      ecart_total:
        totalFichierParcelle === null ? 0 : Math.round((totalJh - totalFichierParcelle) * 100) / 100,
    })
  }

  // Les 3 opérations à créer sont une CONSTANTE validée par Omar, pas une
  // déduction : on ne restitue que celles réellement absentes du référentiel
  // fourni (relancer le script après création ne les repropose pas).
  const referentielACreer = OPERATIONS_A_CREER.filter(
    (o) => !ref.parCle[cleOperation(o.famille, o.operation)]
  )

  return {
    campagne,
    parcelles,
    colonnes_ignorees: colonnesIgnorees,
    lignes_ignorees: lignesIgnorees,
    operations_ignorees: operationsIgnorees,
    familles_ignorees: famillesIgnorees,
    referentiel_a_creer: referentielACreer,
  }
}

/**
 * Payload `campagne-budget-save` d'une parcelle du plan. PURE.
 *
 * IDEMPOTENCE : le payload ne dépend que du fichier source. Le backend fusionne
 * (`mergeBudgets`) — relancer l'import réécrit exactement les mêmes valeurs, ne
 * duplique rien, et laisse intactes les familles/opérations absentes du fichier.
 *
 * @param {PlanImport} plan
 * @param {PlanParcelle} parcelle
 * @returns {{campagne: string, label_bee_one: string,
 *   budgets: Object<string, number>,
 *   budgets_operations: Object<string, Object<string, number>>}}
 */
function buildSavePayload(plan, parcelle) {
  return {
    campagne: plan.campagne,
    label_bee_one: parcelle.label,
    budgets: parcelle.budgets,
    budgets_operations: parcelle.budgets_operations,
  }
}

/**
 * @typedef {Object} PreValidation
 * @property {boolean} ok VRAI seulement si les N payloads sont valides.
 * @property {Array<{label: string, ok: boolean, error?: string}>} resultats
 * @property {boolean} labels_verifies faux = l'existence des parcelles dans
 *   `sb_parcelle_referentiel` n'a PAS pu être contrôlée (référentiel parcelles
 *   non fourni).
 * @property {number} nb_invalides
 */

/**
 * Rejoue CHAQUE payload du plan dans `validateBudgetSave` — la validation
 * EXACTE du backend — avant la moindre écriture. PURE.
 *
 * POURQUOI TOUT-OU-RIEN : la boucle d'écriture traite les parcelles une par
 * une. Sans ce contrôle en amont, un payload refusé au milieu du lot (borne
 * `MAX_JH_PAR_HA` dépassée, parcelle absente du référentiel…) laisserait la
 * campagne dans un état PARTIEL — une partie des parcelles écrites, l'autre
 * non, sans reprise possible. Le dry-run doit annoncer un résultat qui se
 * produira réellement : on refuse donc `--apply` dès qu'UNE parcelle est
 * invalide.
 *
 * @param {Object} args
 * @param {PlanImport} args.plan
 * @param {Array<{code?: *, groupe?: *, famille?: *, operation?: *}>} args.referentiel
 *   fiches de `referentiel_taches`.
 * @param {Array<string>} [args.labelsConnus] labels de
 *   `sb_parcelle_referentiel`. ABSENT = l'existence des parcelles n'est pas
 *   vérifiée (les labels du plan sont alors utilisés pour ne pas bloquer sur le
 *   fail-closed du backend) — signalé par `labels_verifies: false`.
 * @returns {PreValidation}
 */
function preValidatePlan(args) {
  const a = args || {}
  const plan = a.plan || { parcelles: [], campagne: '' }
  const ref = indexReferentiel(a.referentiel)
  const operationsConnues = ref.operations.map((o) => ({
    code: o.code,
    famille: o.famille,
    operation: o.operation,
  }))
  const famillesConnues = []
  for (const o of operationsConnues) {
    if (famillesConnues.indexOf(o.famille) === -1) famillesConnues.push(o.famille)
  }
  const labelsFournis = Array.isArray(a.labelsConnus) && a.labelsConnus.length > 0
  const labelsConnus = labelsFournis
    ? a.labelsConnus
    : plan.parcelles.map((p) => p.label)

  /** @type {Array<{label: string, ok: boolean, error?: string}>} */
  const resultats = []
  for (const p of plan.parcelles) {
    const payload = buildSavePayload(plan, p)
    const verdict = validateBudgetSave({
      campagne: payload.campagne,
      label_bee_one: payload.label_bee_one,
      budgets: payload.budgets,
      budgets_operations: payload.budgets_operations,
      famillesConnues,
      operationsConnues,
      labelsConnus,
    })
    resultats.push({ label: p.label, ok: !!verdict.ok, error: verdict.ok ? undefined : verdict.error })
  }
  const nbInvalides = resultats.filter((r) => !r.ok).length
  return {
    ok: nbInvalides === 0,
    resultats,
    labels_verifies: labelsFournis,
    nb_invalides: nbInvalides,
  }
}

/**
 * @typedef {Object} DiffEntree
 * @property {string} famille
 * @property {string} [operation] clé `CODE::Libellé` (absent = niveau famille).
 * @property {number} avant
 * @property {number} apres
 * @property {'ajoutee'|'ecrasee'|'identique'|'supprimee'|'conservee_hors_fichier'} etat
 */

/**
 * @typedef {Object} DiffParcelle
 * @property {string} label
 * @property {boolean} existe un document de budget existe déjà.
 * @property {Array<DiffEntree>} entrees
 * @property {number} total_avant
 * @property {number} total_apres
 * @property {number} total_plan total annoncé par le plan (fichier seul).
 * @property {number} ecart_conserve total_apres - total_plan : écart dû aux
 *   entrées saisies à la main, absentes du fichier, que le merge CONSERVE.
 */

/**
 * Diff avant/après d'un import, en rejouant EXACTEMENT le merge du backend
 * (`mergeBudgets` / `mergeBudgetsOperations` / `canonicalizeOperationKeys`).
 * PURE.
 *
 * POURQUOI : le rapport de plan décrit ce que le FICHIER contient, pas l'état
 * final du document. Deux effets invisibles sans diff :
 *  - `budgets[famille] = 0` SUPPRIME définitivement une valeur de famille déjà
 *    en base (règle de `mergeBudgets`) — une saisie manuelle peut être perdue ;
 *  - une opération saisie à la main et ABSENTE du fichier est CONSERVÉE par le
 *    merge et s'ajoute au total de sa famille : le document final peut donc
 *    dépasser le total annoncé par le plan (`ecart_conserve`).
 *
 * @param {Object} args
 * @param {PlanImport} args.plan
 * @param {Array<{label_bee_one?: *, budgets?: *, budgets_operations?: *}>} [args.existants]
 *   documents renvoyés par `campagne-budget-list` (lecture seule).
 * @param {Array<{code?: *, groupe?: *, famille?: *, operation?: *}>} [args.referentiel]
 *   nécessaire pour canoniser les clés héritées, comme le fait le backend.
 * @returns {Array<DiffParcelle>}
 */
function buildDiff(args) {
  const a = args || {}
  const plan = a.plan || { parcelles: [], campagne: '' }
  const refOps = indexReferentiel(a.referentiel).operations
  /** @type {Object<string, *>} */
  const parLabel = {}
  for (const d of Array.isArray(a.existants) ? a.existants : []) {
    if (!d) continue
    const k = normLabel(d.label_bee_one)
    if (k) parLabel[k] = d
  }

  /**
   * Somme des totaux de famille d'un document (règle `familleTotal` : les
   * opérations l'emportent sur la valeur de famille, jamais les deux).
   * @param {Object<string, *>} budgets
   * @param {Object<string, *>} ops
   * @returns {number}
   */
  function totalDoc(budgets, ops) {
    /** @type {Object<string, boolean>} */
    const vues = {}
    for (const f of Object.keys(budgets)) vues[f] = true
    for (const f of Object.keys(ops)) vues[f] = true
    let somme = 0
    for (const f of Object.keys(vues)) somme += familleTotal(f, budgets, ops).total
    return Math.round(somme * 100) / 100
  }

  /**
   * @param {number} avant
   * @param {number} apres
   * @param {boolean} dansLeFichier
   * @returns {DiffEntree['etat']|null} null = 0 → 0, rien à signaler.
   */
  function etatDe(avant, apres, dansLeFichier) {
    if (avant > 0 && apres === 0) return 'supprimee'
    if (avant === 0 && apres > 0) return 'ajoutee'
    if (avant > 0 && apres > 0) {
      if (!dansLeFichier) return 'conservee_hors_fichier'
      return avant === apres ? 'identique' : 'ecrasee'
    }
    return null
  }

  /** @type {Array<DiffParcelle>} */
  const out = []
  for (const p of plan.parcelles) {
    const doc = parLabel[normLabel(p.label)] || null
    const avantBudgets = mergeBudgets(doc && doc.budgets, {})
    const avantOps = mergeBudgetsOperations(
      canonicalizeOperationKeys(doc && doc.budgets_operations, refOps),
      {}
    )
    const entrantOps = canonicalizeOperationKeys(p.budgets_operations, refOps)
    const apresBudgets = mergeBudgets(avantBudgets, p.budgets)
    const apresOps = mergeBudgetsOperations(avantOps, entrantOps)

    /** @type {Array<DiffEntree>} */
    const entrees = []

    /** @type {Object<string, boolean>} */
    const famillesVues = {}
    for (const f of Object.keys(avantBudgets)) famillesVues[f] = true
    for (const f of Object.keys(p.budgets)) famillesVues[f] = true
    for (const f of Object.keys(famillesVues)) {
      const avant = avantBudgets[f] > 0 ? avantBudgets[f] : 0
      const apres = apresBudgets[f] > 0 ? apresBudgets[f] : 0
      const dansLeFichier = Object.prototype.hasOwnProperty.call(p.budgets, f)
      const etat = etatDe(avant, apres, dansLeFichier)
      if (etat) entrees.push({ famille: f, avant, apres, etat })
    }

    /** @type {Object<string, boolean>} */
    const famillesOps = {}
    for (const f of Object.keys(avantOps)) famillesOps[f] = true
    for (const f of Object.keys(entrantOps)) famillesOps[f] = true
    for (const f of Object.keys(famillesOps)) {
      const av = avantOps[f] || {}
      const en = entrantOps[f] || {}
      const ap = apresOps[f] || {}
      /** @type {Object<string, boolean>} */
      const cles = {}
      for (const k of Object.keys(av)) cles[k] = true
      for (const k of Object.keys(en)) cles[k] = true
      for (const k of Object.keys(cles)) {
        const avant = av[k] > 0 ? av[k] : 0
        const apres = ap[k] > 0 ? ap[k] : 0
        const dansLeFichier = Object.prototype.hasOwnProperty.call(en, k)
        const etat = etatDe(avant, apres, dansLeFichier)
        if (etat) entrees.push({ famille: f, operation: k, avant, apres, etat })
      }
    }

    const totalApres = totalDoc(apresBudgets, apresOps)
    out.push({
      label: p.label,
      existe: !!doc,
      entrees,
      total_avant: totalDoc(avantBudgets, avantOps),
      total_apres: totalApres,
      total_plan: p.total_jh_ha,
      ecart_conserve: Math.round((totalApres - p.total_jh_ha) * 100) / 100,
    })
  }
  return out
}

/**
 * Rapport de pré-validation. PURE.
 * @param {PreValidation} pre
 * @returns {Array<string>}
 */
function formatPreValidation(pre) {
  /** @type {Array<string>} */
  const out = []
  out.push('=== PRÉ-VALIDATION (validateBudgetSave, la validation du backend) ===')
  if (!pre.labels_verifies) {
    out.push(
      '  ⚠ référentiel des parcelles NON consulté : l\'existence des labels dans'
    )
    out.push('    sb_parcelle_referentiel n\'est PAS vérifiée par ce dry-run.')
  }
  for (const r of pre.resultats) {
    out.push('  ' + (r.ok ? 'OK      ' : 'REFUSÉ  ') + r.label + (r.ok ? '' : ' — ' + r.error))
  }
  if (pre.ok) {
    out.push('  → les ' + pre.resultats.length + ' parcelles passent la validation backend.')
  } else {
    out.push(
      '  → ' +
        pre.nb_invalides +
        ' parcelle(s) REFUSÉE(S) : --apply est bloqué (tout-ou-rien), aucune écriture.'
    )
  }
  return out
}

/**
 * Rapport de diff avant/après. PURE.
 * @param {Array<DiffParcelle>} diff
 * @returns {Array<string>}
 */
function formatDiff(diff) {
  /** @type {Array<string>} */
  const out = []
  out.push('=== DIFF AVANT / APRÈS (état réel des documents) ===')
  for (const d of diff) {
    if (!d.existe) {
      out.push('  ' + d.label + ' : aucun budget existant — création, rien n\'est écrasé.')
      continue
    }
    const supprimees = d.entrees.filter((e) => e.etat === 'supprimee')
    const ecrasees = d.entrees.filter((e) => e.etat === 'ecrasee')
    const conservees = d.entrees.filter((e) => e.etat === 'conservee_hors_fichier')
    const identiques = d.entrees.filter((e) => e.etat === 'identique')
    const ajoutees = d.entrees.filter((e) => e.etat === 'ajoutee')
    out.push(
      '  ' +
        d.label +
        ' : ' +
        d.total_avant +
        ' → ' +
        d.total_apres +
        ' JH/Ha  (plan : ' +
        d.total_plan +
        (d.ecart_conserve === 0 ? '' : ', ÉCART ' + d.ecart_conserve + ' dû aux entrées conservées') +
        ')'
    )
    out.push(
      '      ' +
        ajoutees.length +
        ' ajoutée(s), ' +
        ecrasees.length +
        ' écrasée(s), ' +
        supprimees.length +
        ' SUPPRIMÉE(S), ' +
        conservees.length +
        ' conservée(s) hors fichier, ' +
        identiques.length +
        ' identique(s)'
    )
    for (const e of supprimees.concat(ecrasees, conservees)) {
      const nom = e.famille + (e.operation ? ' — ' + e.operation : ' [famille]')
      out.push('      · ' + e.etat.toUpperCase() + ' ' + nom + ' : ' + e.avant + ' → ' + e.apres)
    }
  }
  return out
}

/**
 * Rapport de dry-run lisible, parcelle par parcelle. PURE (retourne des
 * lignes, n'écrit rien).
 *
 * @param {PlanImport} plan
 * @param {{verbose?: boolean}} [options] `verbose` : détaille chaque opération.
 * @returns {Array<string>}
 */
function formatDryRunReport(plan, options) {
  const opts = options || {}
  /** @type {Array<string>} */
  const out = []
  out.push('=== PLAN D\'IMPORT — campagne ' + plan.campagne + ' ===')
  out.push('')

  for (const p of plan.parcelles) {
    out.push('--- ' + p.label + '   (colonne « ' + p.colonne + ' »)')
    out.push(
      '    ' +
        p.nb_valeurs +
        ' valeur(s) à écrire · total ' +
        p.total_jh_ha +
        ' JH/Ha' +
        (p.total_fichier === null
          ? ''
          : ' · total fichier ' +
            p.total_fichier +
            (p.ecart_total === 0 ? ' (écart 0)' : ' (ÉCART ' + p.ecart_total + ')'))
    )
    for (const f of p.familles) {
      if (f.source === 'famille') {
        out.push('    [famille]    ' + f.famille + ' = ' + f.total + ' JH/Ha  (aucune opération renseignée)')
        continue
      }
      out.push(
        '    [opérations] ' +
          f.famille +
          ' = ' +
          f.total +
          ' JH/Ha sur ' +
          f.operations.length +
          ' opération(s)' +
          (f.ecart === 0 ? '' : '  ⚠ écart ' + f.ecart + ' vs total fichier ' + f.total_fichier) +
          '  · valeur de famille remise à 0'
      )
      if (!opts.verbose) continue
      for (const o of f.operations) {
        out.push(
          '                   · ' +
            o.key +
            ' = ' +
            o.valeur +
            (normText(o.libelle_fichier) === normText(o.operation)
              ? ''
              : '   (fichier : « ' + o.libelle_fichier + ' »)')
        )
      }
    }
    out.push('')
  }

  out.push('=== IGNORÉ ===')
  if (plan.colonnes_ignorees.length === 0) out.push('  (aucune colonne ignorée)')
  for (const c of plan.colonnes_ignorees) {
    out.push('  colonne ' + c.index + ' « ' + c.entete + ' » : ' + c.raison)
  }
  for (const f of plan.familles_ignorees) {
    out.push('  ligne ' + (f.ligne + 1) + ' famille « ' + f.famille + ' » : ' + f.raison)
  }
  for (const o of plan.operations_ignorees) {
    out.push(
      '  ligne ' +
        (o.ligne + 1) +
        ' opération « ' +
        o.operation +
        ' » : ' +
        o.raison +
        ' — ' +
        (o.valeurs_non_nulles === 0
          ? 'aucune valeur > 0, sans effet'
          : o.valeurs_non_nulles + ' valeur(s) > 0 PERDUE(S)')
    )
  }
  for (const l of plan.lignes_ignorees) {
    if (l.raison === 'ligne vide') continue
    out.push('  ligne ' + (l.ligne + 1) + ' : ' + l.raison + (l.detail ? ' — ' + l.detail : ''))
  }
  out.push('')

  out.push('=== RÉFÉRENTIEL — opérations à créer ===')
  if (plan.referentiel_a_creer.length === 0) out.push('  (aucune — le référentiel est déjà complet)')
  for (const o of plan.referentiel_a_creer) {
    out.push('  + ' + o.code + ' · ' + o.famille + ' · ' + o.operation)
  }
  return out
}

module.exports = {
  PARCELLE_PAR_COLONNE,
  ALIAS_FAMILLES,
  ALIAS_OPERATIONS,
  OPERATIONS_A_CREER,
  LIGNE_ENTETES,
  PREMIERE_LIGNE_DONNEES,
  normText,
  cleOperation,
  parseCell,
  indexReferentiel,
  resolveColonnes,
  parseBlocs,
  buildImportPlan,
  buildSavePayload,
  preValidatePlan,
  buildDiff,
  formatDryRunReport,
  formatPreValidation,
  formatDiff,
}
