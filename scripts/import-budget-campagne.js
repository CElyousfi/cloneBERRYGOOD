'use strict'
// @ts-check

/**
 * Import du budget de main d'œuvre (JH/Ha) de la campagne depuis le classeur
 * Excel d'Omar — COQUILLE D'ENTRÉE/SORTIE.
 *
 * Toute la logique (parsing, mapping, alias, décision famille vs opération) est
 * dans `scripts/lib/importBudgetCampagne.js`, pure et testée
 * (tests/unit/importBudgetCampagne.test.js). Ce fichier ne fait que : lire les
 * fichiers, afficher le rapport, et — sur `--apply` seulement — appeler l'API.
 *
 * DRY-RUN PAR DÉFAUT. Sans `--apply`, rien n'est écrit nulle part.
 *
 * USAGE
 *   node scripts/import-budget-campagne.js <chemin-du-budget.xlsx> [options]
 *
 *   --campagne <AAAA-BBBB>   défaut : 2026-2027
 *   --referentiel <fichier>  référentiel des opérations utilisé pour le plan
 *                            (défaut : docs/CAMPAGNE 2026 _REFERENTIEL_…xlsx,
 *                            le classeur qui a servi à seeder `referentiel_taches`)
 *   --verbose                détaille chaque opération dans le rapport
 *   --apply                  ÉCRIT RÉELLEMENT (sinon simulation)
 *   --base-url <url>         défaut : https://berrygood-farms-dashboard.web.app
 *   --backup-dir <dossier>   défaut : ~/sb-import-backups (HORS dépôt)
 *
 * Le chemin du budget est TOUJOURS un argument : le fichier est une donnée
 * métier, il n'est pas committé et n'a pas de place en dur dans le repo.
 *
 * SÉQUENCE (identique en dry-run et en apply, seule la dernière étape diffère) :
 *   1. plan hors ligne depuis le classeur ;
 *   2. authentification (compte DG/RH) — AVANT toute écriture, y compris celle
 *      du référentiel : des identifiants absents ne doivent pas laisser
 *      derrière eux 3 documents créés en prod pour rien ;
 *   3. LECTURES seules : `sb-referentiel-list` (labels autorisés) et
 *      `campagne-budget-list` (état existant) ;
 *   4. PRÉ-VALIDATION TOUT-OU-RIEN : chaque payload passe par
 *      `validateBudgetSave`. Une seule parcelle refusée → on s'arrête, rien
 *      n'est écrit (sinon le lot partirait en écriture partielle sans reprise) ;
 *   5. DIFF avant/après : ce qui sera écrasé, supprimé, conservé ;
 *   6. `--apply` seulement : backup horodaté → création des opérations de
 *      référentiel → écriture des budgets.
 * Sans identifiants, le dry-run reste utilisable mais DÉGRADÉ (bornes et
 * format vérifiés, existence des parcelles et diff impossibles) — et il le dit.
 *
 * ÉCRITURES (`--apply`), deux natures distinctes, rapportées séparément :
 *  1. Les budgets passent par l'action `campagne-budget-save`
 *     (POST /api/pointage-rh) — JAMAIS d'écriture Firestore directe : on
 *     traverse exactement les mêmes contrôles que la saisie manuelle
 *     (rôle DG/RH/admin, référentiels fail-closed, transaction, purge).
 *     Authentification : identifiants d'un compte DG/RH dans
 *     `SB_IMPORT_EMAIL` / `SB_IMPORT_PASSWORD` (ou `QA_TEST_EMAIL` /
 *     `QA_TEST_PASSWORD`), échangés contre un ID token Firebase.
 *  2. Les 3 opérations manquantes de `referentiel_taches` sont écrites via
 *     firebase-admin (ADC). ⚠️ EXCEPTION ASSUMÉE ET SIGNALÉE : il n'existe
 *     AUCUNE Cloud Function d'écriture sur `referentiel_taches` — la collection
 *     est peuplée par un seed admin (scripts/seeds/import-referentiel-taches.js).
 *     Créer une action dédiée serait hors périmètre de ce lot. Aucune
 *     suppression n'est faite : uniquement des créations de documents absents.
 *     Note : le plan est calculé AVANT cette création, donc ces 3 opérations ne
 *     reçoivent aucun budget à cet import — elles sont vides partout dans le
 *     fichier d'Omar, c'est voulu.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const PROJECT_DIR = path.resolve(__dirname, '..')
const XLSX = require(path.join(PROJECT_DIR, 'node_modules/xlsx'))
const lib = require('./lib/importBudgetCampagne')

const REFERENTIEL_PAR_DEFAUT = path.join(
  PROJECT_DIR,
  'docs/CAMPAGNE 2026 _REFERENTIEL_ OPERATIONS  MAJ AVRIL.26.xlsx'
)
const BASE_URL_PAR_DEFAUT = 'https://berrygood-farms-dashboard.web.app'
const CAMPAGNE_PAR_DEFAUT = '2026-2027'
/** Backup HORS dépôt : une sauvegarde committée serait une fuite de données. */
const BACKUP_DIR_PAR_DEFAUT = path.join(os.homedir(), 'sb-import-backups')

/**
 * @typedef {Object} Options
 * @property {string} budget
 * @property {string} referentiel
 * @property {string} campagne
 * @property {string} baseUrl
 * @property {string} backupDir
 * @property {boolean} apply
 * @property {boolean} verbose
 */

/**
 * @param {Array<string>} argv
 * @returns {{ok: boolean, error?: string, options?: Options}}
 */
function parseArgs(argv) {
  /** @type {Options} */
  const o = {
    budget: '',
    referentiel: REFERENTIEL_PAR_DEFAUT,
    campagne: CAMPAGNE_PAR_DEFAUT,
    baseUrl: BASE_URL_PAR_DEFAUT,
    backupDir: BACKUP_DIR_PAR_DEFAUT,
    apply: false,
    verbose: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') o.apply = true
    else if (a === '--verbose') o.verbose = true
    else if (a === '--campagne') o.campagne = String(argv[++i] || '')
    else if (a === '--referentiel') o.referentiel = String(argv[++i] || '')
    else if (a === '--base-url') o.baseUrl = String(argv[++i] || '')
    else if (a === '--backup-dir') o.backupDir = String(argv[++i] || '')
    else if (a.startsWith('--')) return { ok: false, error: 'Option inconnue : ' + a }
    else if (!o.budget) o.budget = a
    else return { ok: false, error: 'Argument en trop : ' + a }
  }
  if (!o.budget) {
    return { ok: false, error: 'Chemin du fichier budget requis (argument positionnel)' }
  }
  return { ok: true, options: o }
}

/**
 * Lignes brutes du premier onglet d'un classeur.
 * @param {string} file
 * @returns {{rows: Array<Array<*>>, sheet: string}}
 */
function readSheet(file) {
  if (!fs.existsSync(file)) throw new Error('Fichier introuvable : ' + file)
  const wb = XLSX.readFile(file)
  const sheet = wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: '', raw: true })
  return { rows, sheet }
}

/**
 * Fiches du référentiel depuis son classeur (ligne 0 titre, ligne 1 en-têtes).
 * @param {Array<Array<*>>} rows
 * @returns {Array<{code: string, groupe: string, famille: string, operation: string}>}
 */
function parseReferentielRows(rows) {
  return rows
    .slice(2)
    .filter((r) => r && r[0] && r[3])
    .map((r) => ({
      code: String(r[0]).trim(),
      groupe: String(r[1] || '').trim(),
      famille: String(r[2] || '').trim(),
      operation: String(r[3]).trim(),
    }))
}

/** @returns {boolean} des identifiants sont-ils disponibles ? */
function hasCredentials() {
  return !!(
    (process.env.SB_IMPORT_EMAIL || process.env.QA_TEST_EMAIL) &&
    (process.env.SB_IMPORT_PASSWORD || process.env.QA_TEST_PASSWORD)
  )
}

/**
 * ID token Firebase d'un compte DG/RH (identifiants par variables
 * d'environnement — jamais en dur, jamais committés).
 * @returns {Promise<string>}
 */
async function authenticate() {
  const email = process.env.SB_IMPORT_EMAIL || process.env.QA_TEST_EMAIL
  const password = process.env.SB_IMPORT_PASSWORD || process.env.QA_TEST_PASSWORD
  if (!email || !password) {
    throw new Error(
      'SB_IMPORT_EMAIL / SB_IMPORT_PASSWORD absents — un compte DG/RH est requis pour --apply'
    )
  }
  const html = fs.readFileSync(path.join(PROJECT_DIR, 'public/index.html'), 'utf8')
  const m = html.match(/apiKey:\s*"([^"]+)"/)
  if (!m) throw new Error('apiKey Firebase introuvable dans public/index.html')
  const res = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + m[1],
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  )
  const json = await res.json()
  if (!res.ok || !json.idToken) {
    throw new Error('Authentification échouée : ' + ((json.error && json.error.message) || res.status))
  }
  return json.idToken
}

/**
 * Appel GET authentifié à l'API (LECTURE SEULE).
 *
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} query ex. 'action=campagne-budget-list&campagne=2026-2027'
 * @returns {Promise<*>}
 */
async function apiGet(baseUrl, token, query) {
  const res = await fetch(baseUrl + '/api/pointage-rh?' + query, {
    headers: { Authorization: 'Bearer ' + token },
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || !json || !json.success) {
    throw new Error(
      'Lecture « ' + query + ' » échouée : ' + ((json && json.error) || res.status)
    )
  }
  return json
}

/**
 * Sauvegarde des documents de budget CONCERNÉS, avant la première écriture.
 * Fichier horodaté, HORS dépôt.
 *
 * @param {string} dir
 * @param {string} campagne
 * @param {Array<*>} documents documents existants des parcelles du plan.
 * @returns {string} chemin du fichier écrit.
 */
function writeBackup(dir, campagne, documents) {
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = path.join(dir, 'sb_campagne_budget_jh-' + campagne + '-' + stamp + '.json')
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        collection: 'sb_campagne_budget_jh',
        campagne,
        exporte_le: new Date().toISOString(),
        nb_documents: documents.length,
        documents,
      },
      null,
      2
    )
  )
  return file
}

/**
 * Crée les opérations manquantes de `referentiel_taches` (jamais de
 * suppression, jamais d'écrasement d'un document existant).
 *
 * @param {Array<{code: string, groupe: string, famille: string, operation: string}>} aCreer
 * @returns {Promise<Array<{id: string, cree: boolean, raison?: string}>>}
 */
async function createReferentielOperations(aCreer) {
  const admin = require(path.join(PROJECT_DIR, 'functions/node_modules/firebase-admin'))
  if (!admin.apps.length) admin.initializeApp({ projectId: 'berrygood-farms-dashboard' })
  const db = admin.firestore()
  const snap = await db.collection('referentiel_taches').get()
  let maxOrdre = 0
  snap.forEach((doc) => {
    const n = parseInt(String((doc.data() || {}).ordre), 10)
    if (isFinite(n) && n > maxOrdre) maxOrdre = n
  })
  /** @type {Array<{id: string, cree: boolean, raison?: string}>} */
  const out = []
  for (let i = 0; i < aCreer.length; i++) {
    const o = aCreer[i]
    // Même schéma d'identifiant que scripts/seeds/import-referentiel-taches.js.
    const id =
      o.code + '_' + o.operation.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().slice(0, 80)
    const ref = db.collection('referentiel_taches').doc(id)
    const existing = await ref.get()
    if (existing.exists) {
      out.push({ id, cree: false, raison: 'document déjà présent' })
      continue
    }
    await ref.set({
      code: o.code,
      groupe: o.groupe,
      famille: o.famille,
      operation: o.operation,
      ordre: maxOrdre + 1 + i,
      actif: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
    })
    out.push({ id, cree: true })
  }
  return out
}

async function run() {
  const parsed = parseArgs(process.argv.slice(2))
  if (!parsed.ok || !parsed.options) {
    console.error('ERREUR : ' + parsed.error)
    console.error('Usage : node scripts/import-budget-campagne.js <budget.xlsx> [--campagne AAAA-BBBB]')
    console.error('        [--referentiel <fichier>] [--verbose] [--apply] [--base-url <url>]')
    console.error('        [--backup-dir <dossier>]')
    process.exit(1)
    return
  }
  const o = parsed.options

  const budget = readSheet(o.budget)
  const referentiel = readSheet(o.referentiel)
  console.log('Budget      : ' + o.budget + '  (onglet « ' + budget.sheet + ' », ' + budget.rows.length + ' lignes)')
  console.log('Référentiel : ' + o.referentiel + '  (onglet « ' + referentiel.sheet + ' »)')
  console.log('Campagne    : ' + o.campagne)
  console.log('Mode        : ' + (o.apply ? '*** APPLY — ÉCRITURE RÉELLE ***' : 'DRY-RUN (aucune écriture)'))
  console.log('')

  const plan = lib.buildImportPlan({
    budgetRows: budget.rows,
    referentiel: parseReferentielRows(referentiel.rows),
    campagne: o.campagne,
  })
  console.log(lib.formatDryRunReport(plan, { verbose: o.verbose }).join('\n'))
  console.log('')

  const totalValeurs = plan.parcelles.reduce((s, p) => s + p.nb_valeurs, 0)
  console.log(
    '=== RÉSUMÉ === ' +
      plan.parcelles.length +
      ' parcelle(s), ' +
      totalValeurs +
      ' valeur(s), ' +
      plan.referentiel_a_creer.length +
      ' opération(s) de référentiel à créer.'
  )

  // ── Authentification AVANT toute écriture (y compris celle du référentiel) :
  // des identifiants absents ne doivent pas laisser 3 documents créés pour rien.
  // En dry-run, elle n'est tentée que si des identifiants existent : sans eux le
  // rapport reste utilisable, mais DÉGRADÉ, et il l'annonce.
  const fiches = parseReferentielRows(referentiel.rows)
  /** @type {string|null} */
  let token = null
  /** @type {Array<string>|undefined} */
  let labelsConnus
  /** @type {Array<*>} */
  let existants = []
  if (o.apply || hasCredentials()) {
    token = await authenticate()
    const refParcelles = await apiGet(o.baseUrl, token, 'action=sb-referentiel-list')
    labelsConnus = (refParcelles.parcelles || [])
      .map((p) => String((p && (p.label_bee_one || p.id)) || '').trim())
      .filter(Boolean)
    const budgets = await apiGet(
      o.baseUrl,
      token,
      'action=campagne-budget-list&campagne=' + encodeURIComponent(o.campagne)
    )
    const labelsDuPlan = {}
    for (const p of plan.parcelles) p.label && (labelsDuPlan[p.label.trim().toUpperCase()] = true)
    existants = (budgets.budgets || []).filter(
      (d) => d && labelsDuPlan[String(d.label_bee_one || '').trim().toUpperCase()]
    )
    console.log('Lecture     : ' + labelsConnus.length + ' parcelle(s) au référentiel, '
      + existants.length + ' budget(s) déjà enregistré(s) sur le périmètre.')
    console.log('')
  }

  // ── PRÉ-VALIDATION TOUT-OU-RIEN, avant la moindre écriture.
  // `exigerLabels` sous --apply : un référentiel de parcelles illisible bloque
  // le lot au lieu de retomber silencieusement sur les labels du fichier.
  const pre = lib.preValidatePlan({
    plan,
    referentiel: fiches,
    labelsConnus,
    exigerLabels: o.apply,
  })
  console.log(lib.formatPreValidation(pre).join('\n'))
  console.log('')

  if (token) {
    console.log(lib.formatDiff(lib.buildDiff({ plan, existants, referentiel: fiches })).join('\n'))
    console.log('')
  } else {
    console.log('=== DIFF AVANT / APRÈS ===')
    console.log('  ⚠ non calculé : sans identifiants, l\'état existant n\'est pas lisible.')
    console.log('    Ce dry-run ne peut donc PAS dire ce qui sera écrasé ou supprimé.')
    console.log('')
  }

  if (!pre.ok) {
    console.error('APPLY BLOQUÉ : ' + pre.nb_invalides + ' parcelle(s) refusée(s) par la validation')
    console.error('backend. Rien n\'a été écrit — corriger la source avant de relancer.')
    process.exit(1)
    return
  }

  if (!o.apply) {
    console.log('DRY-RUN : rien n\'a été écrit. Relancer avec --apply après validation.')
    return
  }

  console.log('--- BACKUP avant écriture ---')
  const backup = writeBackup(o.backupDir, o.campagne, existants)
  console.log('  ' + existants.length + ' document(s) sauvegardé(s) → ' + backup)

  console.log('')
  console.log('--- ÉCRITURE 1/2 : référentiel des opérations (firebase-admin) ---')
  if (plan.referentiel_a_creer.length === 0) {
    console.log('  rien à créer.')
  } else {
    const res = await createReferentielOperations(plan.referentiel_a_creer)
    for (const r of res) {
      console.log('  ' + (r.cree ? 'CRÉÉ  ' : 'IGNORÉ') + ' ' + r.id + (r.raison ? ' — ' + r.raison : ''))
    }
  }

  console.log('')
  console.log('--- ÉCRITURE 2/2 : budgets via campagne-budget-save ---')
  // ARRÊT À LA PREMIÈRE ERREUR. Poursuivre après un refus (référentiel Firestore
  // divergent du classeur local, functions pas encore déployées…) accumulerait
  // exactement l'état partiel que la pré-validation cherche à éviter. On stoppe,
  // on liste ce qui est déjà écrit, et on rappelle où est le backup.
  /** @type {Array<string>} */
  const ecrites = []
  for (const p of plan.parcelles) {
    const payload = lib.buildSavePayload(plan, p)
    const res = await fetch(o.baseUrl + '/api/pointage-rh?action=campagne-budget-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({ success: false, error: 'réponse illisible' }))
    if (!res.ok || !json.success) {
      console.error('  ÉCHEC ' + p.label + ' : ' + (json.error || res.status))
      console.error('')
      console.error('=== ARRÊT IMMÉDIAT — ÉTAT PARTIEL ===')
      console.error(
        '  ' + ecrites.length + ' parcelle(s) DÉJÀ ÉCRITE(S) : ' +
          (ecrites.length ? ecrites.join(', ') : '(aucune)')
      )
      console.error('  ' + (plan.parcelles.length - ecrites.length) + ' parcelle(s) NON écrite(s), à partir de ' + p.label + '.')
      console.error('  Backup de l\'état antérieur : ' + backup)
      console.error('  Pour revenir en arrière, restaurer les documents de ce fichier ;')
      console.error('  pour reprendre, corriger la cause puis relancer (le script est idempotent).')
      process.exit(1)
      return
    }
    ecrites.push(p.label)
    const effets = []
    if ((json.familles_purgees || []).length) effets.push('familles purgées : ' + json.familles_purgees.join(', '))
    if ((json.operations_purgees || []).length) effets.push('opérations purgées : ' + json.operations_purgees.join(', '))
    if ((json.familles_neutralisees || []).length) {
      effets.push(
        'familles neutralisées : ' +
          json.familles_neutralisees.map((f) => f.famille + ' (était ' + f.valeur_precedente + ')').join(', ')
      )
    }
    if (json.purge_differee) effets.push('purge différée : ' + json.purge_differee)
    console.log('  OK    ' + p.label + ' — ' + p.nb_valeurs + ' valeur(s)' + (effets.length ? ' · ' + effets.join(' · ') : ''))
  }
  console.log('')
  console.log('=== APPLY TERMINÉ === ' + ecrites.length + ' parcelle(s) écrite(s), 0 échec.')
  console.log('Backup de l\'état antérieur conservé : ' + backup)
}

if (require.main === module) {
  run().catch((err) => {
    console.error('ERREUR :', err && err.message ? err.message : err)
    process.exit(1)
  })
}

module.exports = { parseArgs, parseReferentielRows }
