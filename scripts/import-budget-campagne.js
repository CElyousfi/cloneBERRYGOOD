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
 *
 * Le chemin du budget est TOUJOURS un argument : le fichier est une donnée
 * métier, il n'est pas committé et n'a pas de place en dur dans le repo.
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
 */

const fs = require('fs')
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

/**
 * @typedef {Object} Options
 * @property {string} budget
 * @property {string} referentiel
 * @property {string} campagne
 * @property {string} baseUrl
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

  if (!o.apply) {
    console.log('')
    console.log('DRY-RUN : rien n\'a été écrit. Relancer avec --apply après validation.')
    return
  }

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
  const token = await authenticate()
  let ok = 0
  let ko = 0
  for (const p of plan.parcelles) {
    const payload = lib.buildSavePayload(plan, p)
    const res = await fetch(o.baseUrl + '/api/pointage-rh?action=campagne-budget-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({ success: false, error: 'réponse illisible' }))
    if (!res.ok || !json.success) {
      ko++
      console.log('  ÉCHEC ' + p.label + ' : ' + (json.error || res.status))
      continue
    }
    ok++
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
  console.log('=== APPLY TERMINÉ === ' + ok + ' parcelle(s) écrite(s), ' + ko + ' échec(s).')
  if (ko > 0) process.exit(1)
}

if (require.main === module) {
  run().catch((err) => {
    console.error('ERREUR :', err && err.message ? err.message : err)
    process.exit(1)
  })
}

module.exports = { parseArgs, parseReferentielRows }
