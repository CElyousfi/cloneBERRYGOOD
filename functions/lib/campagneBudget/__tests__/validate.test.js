'use strict'
// @ts-check

const test = require('node:test')
const assert = require('node:assert')

const {
  MAX_JH_PAR_HA,
  MAX_OPERATIONS,
  normCampagne,
  normLabel,
  budgetDocId,
  indexOperations,
  purgeAutorisee,
  parseBudgetValue,
  validateBudgetSave,
  mergeBudgets,
  mergeBudgetsOperations,
  familleTotal,
  purgeFamillesInconnues,
  purgeOperationsInconnues,
  writeBudgetInTransaction,
} = require('../validate')

const FAMILLES = ['Ferti-irrigation', 'Entretien structure', 'Taille', 'Tuteurage & palissage']
const LABELS = ['F5- CASCADE -S13', 'F1- ROUGE -S01']

/** Référentiel des couples (famille, opération) — forme de `loadReferentielTaches().ops`. */
const OPERATIONS = [
  { famille: 'Taille', operation: 'Taille de formation' },
  { famille: 'Taille', operation: 'Taille d\'hiver' },
  { famille: 'Ferti-irrigation', operation: 'Nettoyage goutteurs' },
  { famille: 'Ferti-irrigation', operation: 'Fertigation' },
  { famille: 'Entretien structure', operation: 'Réparation filets' },
]

function base(overrides) {
  return Object.assign(
    {
      campagne: '2026-2027',
      label_bee_one: 'F5- CASCADE -S13',
      budgets: { 'Taille': 2 },
      famillesConnues: FAMILLES,
      operationsConnues: OPERATIONS,
      labelsConnus: LABELS,
    },
    overrides || {}
  )
}

// ---------------------------------------------------------------- normCampagne

test('normCampagne — accepte tiret et slash, refuse les années non consécutives', () => {
  assert.strictEqual(normCampagne('2026-2027'), '2026-2027')
  assert.strictEqual(normCampagne(' 2026/2027 '), '2026-2027')
  assert.strictEqual(normCampagne('2026-2028'), '')
  assert.strictEqual(normCampagne('2026'), '')
  assert.strictEqual(normCampagne(null), '')
  assert.strictEqual(normCampagne(undefined), '')
})

test('normLabel — même normalisation que sb_parcelle_referentiel', () => {
  assert.strictEqual(normLabel('  f5- cascade -s13 '), 'F5- CASCADE -S13')
  assert.strictEqual(normLabel(null), '')
})

// ----------------------------------------------------------------- budgetDocId

test('budgetDocId — clé campagne + label, refuse le slash', () => {
  assert.strictEqual(budgetDocId('2026/2027', ' f5- cascade -s13 '), '2026-2027__F5- CASCADE -S13')
  assert.strictEqual(budgetDocId('2026-2027', 'S13/S14'), '')
  assert.strictEqual(budgetDocId('2026-2028', 'S13'), '')
  assert.strictEqual(budgetDocId('2026-2027', '   '), '')
})

test('budgetDocId — deux campagnes = deux documents distincts (limite corrigée)', () => {
  assert.notStrictEqual(
    budgetDocId('2025-2026', 'F5- CASCADE -S13'),
    budgetDocId('2026-2027', 'F5- CASCADE -S13')
  )
})

// ------------------------------------------------------------ parseBudgetValue

test('parseBudgetValue — vide = 0, virgule FR admise, arrondi 2 décimales', () => {
  assert.deepStrictEqual(parseBudgetValue(''), { ok: true, value: 0 })
  assert.deepStrictEqual(parseBudgetValue(null), { ok: true, value: 0 })
  assert.deepStrictEqual(parseBudgetValue('3,5'), { ok: true, value: 3.5 })
  assert.deepStrictEqual(parseBudgetValue(1.234), { ok: true, value: 1.23 })
})

test('parseBudgetValue — rejette négatif, non numérique, hors limite, booléen', () => {
  assert.strictEqual(parseBudgetValue(-1).ok, false)
  assert.strictEqual(parseBudgetValue('abc').ok, false)
  assert.strictEqual(parseBudgetValue(MAX_JH_PAR_HA + 1).ok, false)
  assert.strictEqual(parseBudgetValue(true).ok, false)
  assert.strictEqual(parseBudgetValue(Infinity).ok, false)
})

test('parseBudgetValue — parsing STRICT : pas de queue non numérique (action POST-able)', () => {
  // parseFloat('3abc') vaut 3 : refusé ici, sinon un POST manuel écrit 3.
  assert.strictEqual(parseBudgetValue('3abc').ok, false)
  assert.strictEqual(parseBudgetValue('3 4').ok, false)
  assert.strictEqual(parseBudgetValue('1e3').ok, false)
  assert.strictEqual(parseBudgetValue('0x10').ok, false)
  assert.strictEqual(parseBudgetValue({}).ok, false)
  assert.strictEqual(parseBudgetValue([2]).ok, false)
  // …mais les formes légitimes passent toujours.
  assert.deepStrictEqual(parseBudgetValue(' 2.50 '), { ok: true, value: 2.5 })
  assert.deepStrictEqual(parseBudgetValue('.5'), { ok: true, value: 0.5 })
})

// --------------------------------------------------------- validateBudgetSave

test('validateBudgetSave — cas nominal', () => {
  const v = validateBudgetSave(base({ budgets: { 'Taille': '2,5', 'Ferti-irrigation': 3 } }))
  assert.strictEqual(v.ok, true)
  assert.strictEqual(v.docId, '2026-2027__F5- CASCADE -S13')
  assert.strictEqual(v.campagne, '2026-2027')
  assert.strictEqual(v.label, 'F5- CASCADE -S13')
  assert.deepStrictEqual(v.budgets, { 'Taille': 2.5, 'Ferti-irrigation': 3 })
})

test('validateBudgetSave — famille reconnue quelle que soit la casse, renvoyée canonique', () => {
  const v = validateBudgetSave(base({ budgets: { 'taille': 1 } }))
  assert.strictEqual(v.ok, true)
  assert.deepStrictEqual(v.budgets, { 'Taille': 1 })
})

test('validateBudgetSave — refuse une famille hors référentiel', () => {
  const v = validateBudgetSave(base({ budgets: { 'Récolte': 1 } }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /Famille d'opération inconnue/)
})

test('validateBudgetSave — refuse une parcelle hors référentiel', () => {
  const v = validateBudgetSave(base({ label_bee_one: 'F9- INCONNUE' }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /Parcelle inconnue du référentiel/)
})

test('validateBudgetSave — fail-closed si référentiel familles ou parcelles vide', () => {
  assert.strictEqual(validateBudgetSave(base({ famillesConnues: [] })).ok, false)
  assert.strictEqual(validateBudgetSave(base({ labelsConnus: [] })).ok, false)
})

test('validateBudgetSave — refuse campagne, label, budgets invalides', () => {
  assert.strictEqual(validateBudgetSave(base({ campagne: '2026' })).ok, false)
  assert.strictEqual(validateBudgetSave(base({ label_bee_one: '' })).ok, false)
  assert.strictEqual(validateBudgetSave(base({ budgets: null })).ok, false)
  assert.strictEqual(validateBudgetSave(base({ budgets: [] })).ok, false)
  assert.strictEqual(validateBudgetSave(base({ budgets: {} })).ok, false)
  assert.strictEqual(validateBudgetSave(base({ budgets: { 'Taille': -3 } })).ok, false)
  assert.strictEqual(validateBudgetSave(undefined).ok, false)
})

test('validateBudgetSave — refuse un doublon de famille (casse différente)', () => {
  const v = validateBudgetSave(base({ budgets: { 'Taille': 1, 'taille': 2 } }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /doublon/)
})

test('validateBudgetSave — trop de familles', () => {
  const familles = []
  const budgets = {}
  for (let i = 0; i < 60; i++) {
    familles.push('F' + i)
    budgets['F' + i] = 1
  }
  const v = validateBudgetSave(base({ budgets, famillesConnues: familles }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /Trop de familles/)
})

// ------------------------------------------------------------------ mergeBudgets

test('mergeBudgets — l\'entrant écrase, le reste est conservé', () => {
  const out = mergeBudgets({ 'Taille': 1, 'Ferti-irrigation': 2 }, { 'Taille': 5 })
  assert.deepStrictEqual(out, { 'Taille': 5, 'Ferti-irrigation': 2 })
})

test('mergeBudgets — 0 supprime la famille, ne l\'écrit pas', () => {
  const out = mergeBudgets({ 'Taille': 1, 'Ferti-irrigation': 2 }, { 'Taille': 0 })
  assert.deepStrictEqual(out, { 'Ferti-irrigation': 2 })
  assert.deepStrictEqual(mergeBudgets(null, { 'Taille': 0 }), {})
})

test('mergeBudgets — ne mute aucun argument et ignore l\'existant corrompu', () => {
  const existing = { 'Taille': 1, 'Bruit': 'abc', 'Zero': 0 }
  const incoming = { 'Ferti-irrigation': 2 }
  const out = mergeBudgets(existing, incoming)
  assert.deepStrictEqual(out, { 'Taille': 1, 'Ferti-irrigation': 2 })
  assert.deepStrictEqual(existing, { 'Taille': 1, 'Bruit': 'abc', 'Zero': 0 })
  assert.deepStrictEqual(incoming, { 'Ferti-irrigation': 2 })
})

test('mergeBudgets — existant absent ou non-objet', () => {
  assert.deepStrictEqual(mergeBudgets(undefined, { 'Taille': 3 }), { 'Taille': 3 })
  assert.deepStrictEqual(mergeBudgets(/** @type {*} */ ([1, 2]), { 'Taille': 3 }), { 'Taille': 3 })
})

// --------------------------------------------------- purgeFamillesInconnues

test('purgeFamillesInconnues — retire les familles hors référentiel courant', () => {
  const r = purgeFamillesInconnues({ 'Taille': 1, 'Ancienne famille': 4 }, FAMILLES)
  assert.deepStrictEqual(r.budgets, { 'Taille': 1 })
  assert.deepStrictEqual(r.purgees, ['Ancienne famille'])
})

test('purgeFamillesInconnues — référentiel vide/absent = AUCUNE purge (fail-safe)', () => {
  const b = { 'Taille': 1, 'X': 2 }
  assert.deepStrictEqual(purgeFamillesInconnues(b, []).budgets, b)
  assert.deepStrictEqual(purgeFamillesInconnues(b, null).budgets, b)
  assert.deepStrictEqual(purgeFamillesInconnues(b, undefined).purgees, [])
})

// ------------------------------------------------- writeBudgetInTransaction
//
// L'émulateur Firestore n'est pas disponible ici (Java absent) : on injecte une
// fausse transaction qui CAPTURE (data, options) du `set`. C'est le chemin qui
// portait le bug — un `{merge:true}` construit son masque sur les FEUILLES,
// donc une famille retirée de la map survivait en base.

function fakeTx(existingData) {
  const calls = []
  return {
    calls,
    tx: {
      get: async () => ({
        exists: existingData !== null && existingData !== undefined,
        data: () => existingData,
      }),
      set: (ref, data, options) => calls.push({ ref, data, options }),
    },
  }
}

const WRITE_ARGS = {
  campagne: '2026-2027',
  label: 'F5- CASCADE -S13',
  budgets: {},
  budgets_operations: {},
  famillesConnues: FAMILLES,
  operationsConnues: OPERATIONS,
  uid: 'uid-1',
  profileId: 'dg',
  serverTimestamp: '__TS__',
}

test('writeBudgetInTransaction — supprimer UNE famille l\'efface réellement en base', async () => {
  const f = fakeTx({ budgets: { 'Taille': 1, 'Ferti-irrigation': 2 } })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' },
    Object.assign({}, WRITE_ARGS, { budgets: { 'Taille': 0 } }))

  assert.strictEqual(f.calls.length, 1)
  const call = f.calls[0]
  // La map écrite ne contient PLUS Taille…
  assert.deepStrictEqual(call.data.budgets, { 'Ferti-irrigation': 2 })
  // …et surtout le masque de champs porte `budgets` ENTIER : sans ça, la
  // valeur 1 de Taille resterait en base (bug corrigé).
  assert.notStrictEqual(call.options && call.options.merge, true)
  assert.ok(Array.isArray(call.options.mergeFields))
  assert.ok(call.options.mergeFields.includes('budgets'))
  assert.deepStrictEqual(out.budgets, { 'Ferti-irrigation': 2 })
})

test('writeBudgetInTransaction — les familles absentes du body sont conservées', async () => {
  const f = fakeTx({ budgets: { 'Taille': 1, 'Ferti-irrigation': 2 } })
  await writeBudgetInTransaction(f.tx, { id: 'doc' },
    Object.assign({}, WRITE_ARGS, { budgets: { 'Taille': 5 } }))
  assert.deepStrictEqual(f.calls[0].data.budgets, { 'Taille': 5, 'Ferti-irrigation': 2 })
})

test('writeBudgetInTransaction — document absent = création complète', async () => {
  const f = fakeTx(null)
  await writeBudgetInTransaction(f.tx, { id: 'doc' },
    Object.assign({}, WRITE_ARGS, { budgets: { 'Taille': 3 } }))
  const data = f.calls[0].data
  assert.deepStrictEqual(data.budgets, { 'Taille': 3 })
  assert.strictEqual(data.campagne, '2026-2027')
  assert.strictEqual(data.label_bee_one, 'F5- CASCADE -S13')
  assert.deepStrictEqual(data.updated_by, { uid: 'uid-1', profileId: 'dg' })
  assert.strictEqual(data.updated_at, '__TS__')
  // Tous les champs écrits sont dans le masque (aucune écriture silencieuse).
  for (const k of Object.keys(data)) {
    assert.ok(f.calls[0].options.mergeFields.includes(k), 'champ hors masque : ' + k)
  }
})

test('writeBudgetInTransaction — tout effacer écrit une map vide', async () => {
  const f = fakeTx({ budgets: { 'Taille': 1 } })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' },
    Object.assign({}, WRITE_ARGS, { budgets: { 'Taille': 0 } }))
  assert.deepStrictEqual(f.calls[0].data.budgets, {})
  assert.deepStrictEqual(out.budgets, {})
})

test('writeBudgetInTransaction — purge les familles hors référentiel et les signale', async () => {
  const f = fakeTx({ budgets: { 'Taille': 1, 'Famille supprimée': 9 } })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' },
    Object.assign({}, WRITE_ARGS, { budgets: { 'Taille': 2 } }))
  assert.deepStrictEqual(f.calls[0].data.budgets, { 'Taille': 2 })
  assert.deepStrictEqual(out.purgees, ['Famille supprimée'])
})

test('writeBudgetInTransaction — supporte un snapshot dont `exists` est une fonction', async () => {
  const calls = []
  const tx = {
    get: async () => ({ exists: () => true, data: () => ({ budgets: { 'Taille': 4 } }) }),
    set: (ref, data, options) => calls.push({ data, options }),
  }
  await writeBudgetInTransaction(tx, { id: 'doc' },
    Object.assign({}, WRITE_ARGS, { budgets: { 'Ferti-irrigation': 1 } }))
  assert.deepStrictEqual(calls[0].data.budgets, { 'Taille': 4, 'Ferti-irrigation': 1 })
})

// =====================================================================
// NIVEAU OPÉRATION (budgets_operations) — le budget descend de la famille
// à l'opération, SANS migration : `budgets` reste la valeur de repli.
// =====================================================================

// ------------------------------------------------------------ indexOperations

test('indexOperations — indexe les couples, ignore le bruit', () => {
  const idx = indexOperations([
    { famille: ' Taille ', operation: ' Taille d\'hiver ' },
    { famille: 'Taille', operation: '' },
    { famille: '', operation: 'X' },
    null,
    'pas un objet',
  ])
  assert.strictEqual(Object.keys(idx).length, 1)
  assert.deepStrictEqual(Object.values(idx)[0], { famille: 'Taille', operation: 'Taille d\'hiver' })
})

test('indexOperations — sans référentiel : index vide (l\'appelant fail-close)', () => {
  assert.deepStrictEqual(indexOperations(null), {})
  assert.deepStrictEqual(indexOperations([]), {})
})

// ------------------------------------------- validateBudgetSave (opérations)

test('validateBudgetSave — accepte un budget par opération, casse canonisée', () => {
  const v = validateBudgetSave(base({
    budgets: {},
    budgets_operations: { 'taille': { 'TAILLE D\'HIVER': '1,5', 'Taille de formation': 2 } },
  }))
  assert.strictEqual(v.ok, true)
  assert.deepStrictEqual(v.budgets, {})
  assert.deepStrictEqual(v.budgets_operations, {
    'Taille': { 'Taille d\'hiver': 1.5, 'Taille de formation': 2 },
  })
})

test('validateBudgetSave — les deux niveaux cohabitent dans un même save', () => {
  const v = validateBudgetSave(base({
    // « Service générale » d'Omar : famille sans détail par opération.
    budgets: { 'Entretien structure': 4 },
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 1 } },
  }))
  assert.strictEqual(v.ok, true)
  assert.deepStrictEqual(v.budgets, { 'Entretien structure': 4 })
  assert.deepStrictEqual(v.budgets_operations, { 'Taille': { 'Taille d\'hiver': 1 } })
})

test('validateBudgetSave — `budgets` absent est admis si des opérations sont saisies', () => {
  const src = base({ budgets_operations: { 'Taille': { 'Taille d\'hiver': 1 } } })
  delete src.budgets
  const v = validateBudgetSave(src)
  assert.strictEqual(v.ok, true)
  assert.deepStrictEqual(v.budgets, {})
})

test('validateBudgetSave — refuse une opération hors référentiel', () => {
  const v = validateBudgetSave(base({
    budgets: {}, budgets_operations: { 'Taille': { 'Opération fantôme': 1 } },
  }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /Opération inconnue du référentiel/)
})

test('validateBudgetSave — refuse une opération rattachée à la MAUVAISE famille', () => {
  // 'Fertigation' existe, mais sous Ferti-irrigation : la valider sous Taille
  // rendrait le total de famille faux.
  const v = validateBudgetSave(base({
    budgets: {}, budgets_operations: { 'Taille': { 'Fertigation': 1 } },
  }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /Opération inconnue du référentiel/)
})

test('validateBudgetSave — fail-closed si le référentiel des opérations est indisponible', () => {
  for (const ops of [[], null, undefined]) {
    const v = validateBudgetSave(base({
      budgets: {},
      budgets_operations: { 'Taille': { 'Taille d\'hiver': 1 } },
      operationsConnues: ops,
    }))
    assert.strictEqual(v.ok, false)
    assert.match(String(v.error), /Référentiel des opérations indisponible/)
  }
})

test('validateBudgetSave — référentiel opérations absent SANS opération saisie : toléré', () => {
  // Un save purement « niveau famille » (documents du lot précédent) ne doit
  // pas devenir impossible parce que le référentiel des opérations manque.
  const v = validateBudgetSave(base({ operationsConnues: [], budgets_operations: {} }))
  assert.strictEqual(v.ok, true)
})

test('validateBudgetSave — refuse une valeur d\'opération invalide, message situé', () => {
  const v = validateBudgetSave(base({
    budgets: {}, budgets_operations: { 'Taille': { 'Taille d\'hiver': 'abc' } },
  }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /Taille — Taille d'hiver/)
})

test('validateBudgetSave — refuse une famille d\'opérations non-objet, et un doublon d\'opération', () => {
  assert.strictEqual(validateBudgetSave(base({
    budgets: {}, budgets_operations: { 'Taille': 3 },
  })).ok, false)
  assert.strictEqual(validateBudgetSave(base({
    budgets: {}, budgets_operations: [],
  })).ok, false)
  const dup = validateBudgetSave(base({
    budgets: {}, budgets_operations: { 'Taille': { 'Taille d\'hiver': 1, 'TAILLE D\'HIVER': 2 } },
  }))
  assert.strictEqual(dup.ok, false)
  assert.match(String(dup.error), /doublon/)
})

test('validateBudgetSave — refuse une famille inconnue au niveau opération', () => {
  const v = validateBudgetSave(base({
    budgets: {}, budgets_operations: { 'Récolte': { 'Cueillette': 1 } },
  }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /Famille d'opération inconnue/)
})

test('validateBudgetSave — plafond du nombre d\'opérations', () => {
  const famillesConnues = []
  const operationsConnues = []
  const budgets_operations = {}
  for (let f = 0; f < 40; f++) {
    const famille = 'F' + f
    famillesConnues.push(famille)
    budgets_operations[famille] = {}
    for (let o = 0; o < 20; o++) {
      const operation = 'O' + o
      operationsConnues.push({ famille, operation })
      budgets_operations[famille][operation] = 1
    }
  }
  assert.ok(40 * 20 > MAX_OPERATIONS)
  const v = validateBudgetSave(base({
    budgets: {}, budgets_operations, famillesConnues, operationsConnues,
  }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /Trop d'opérations/)
})

test('validateBudgetSave — aucun budget des deux niveaux = refus', () => {
  assert.strictEqual(validateBudgetSave(base({ budgets: {}, budgets_operations: {} })).ok, false)
})

// --------------------------------------------------- mergeBudgetsOperations

test('mergeBudgetsOperations — l\'entrant écrase l\'opération, le reste survit', () => {
  const out = mergeBudgetsOperations(
    { 'Taille': { 'A': 1, 'B': 2 }, 'Ferti-irrigation': { 'C': 3 } },
    { 'Taille': { 'A': 5 } }
  )
  assert.deepStrictEqual(out, { 'Taille': { 'A': 5, 'B': 2 }, 'Ferti-irrigation': { 'C': 3 } })
})

test('mergeBudgetsOperations — 0 supprime l\'opération, la famille vidée disparaît', () => {
  const out = mergeBudgetsOperations({ 'Taille': { 'A': 1, 'B': 2 } }, { 'Taille': { 'A': 0 } })
  assert.deepStrictEqual(out, { 'Taille': { 'B': 2 } })
  assert.deepStrictEqual(
    mergeBudgetsOperations({ 'Taille': { 'A': 1 } }, { 'Taille': { 'A': 0 } }),
    {}
  )
})

test('mergeBudgetsOperations — ne mute rien et ignore l\'existant corrompu', () => {
  const existing = { 'Taille': { 'A': 1, 'Bruit': 'abc', 'Zero': 0 }, 'Vide': {}, 'Nul': null }
  const incoming = { 'Ferti-irrigation': { 'C': 2 } }
  const out = mergeBudgetsOperations(existing, incoming)
  assert.deepStrictEqual(out, { 'Taille': { 'A': 1 }, 'Ferti-irrigation': { 'C': 2 } })
  assert.deepStrictEqual(existing.Taille, { 'A': 1, 'Bruit': 'abc', 'Zero': 0 })
  assert.deepStrictEqual(incoming, { 'Ferti-irrigation': { 'C': 2 } })
})

test('mergeBudgetsOperations — existant absent ou non-objet', () => {
  assert.deepStrictEqual(mergeBudgetsOperations(undefined, { 'T': { 'A': 1 } }), { 'T': { 'A': 1 } })
  assert.deepStrictEqual(
    mergeBudgetsOperations(/** @type {*} */ ([1]), { 'T': { 'A': 1 } }),
    { 'T': { 'A': 1 } }
  )
})

// --------------------------------------------------------------- familleTotal
//
// CŒUR MÉTIER : somme des opérations si la famille en porte, sinon la valeur
// saisie au niveau famille. Jamais les deux.

test('familleTotal — famille SANS opération : la valeur de famille fait foi', () => {
  // Cas « Service générale » du fichier d'Omar.
  const r = familleTotal('Service générale', { 'Service générale': 12.5 }, {})
  assert.deepStrictEqual(r, { total: 12.5, source: 'famille' })
})

test('familleTotal — famille AVEC opérations : somme des opérations', () => {
  const r = familleTotal('Taille', { 'Taille': 99 }, { 'Taille': { 'A': 1.25, 'B': 2.5 } })
  // La valeur de famille (99) est IGNORÉE : jamais d'addition des deux niveaux.
  assert.deepStrictEqual(r, { total: 3.75, source: 'operations' })
})

test('familleTotal — document historique niveau famille seul (aucune migration)', () => {
  // Document écrit par le lot précédent : pas de champ budgets_operations.
  const r = familleTotal('Taille', { 'Taille': 3 }, undefined)
  assert.deepStrictEqual(r, { total: 3, source: 'famille' })
})

test('familleTotal — opérations toutes nulles : repli sur la famille', () => {
  const r = familleTotal('Taille', { 'Taille': 4 }, { 'Taille': { 'A': 0, 'B': 0 } })
  assert.deepStrictEqual(r, { total: 4, source: 'famille' })
})

test('familleTotal — rien de saisi', () => {
  assert.deepStrictEqual(familleTotal('Taille', {}, {}), { total: 0, source: 'aucun' })
  assert.deepStrictEqual(familleTotal(null, null, null), { total: 0, source: 'aucun' })
  assert.deepStrictEqual(familleTotal('Taille', { 'Taille': 'abc' }, {}), { total: 0, source: 'aucun' })
})

test('familleTotal — bascule DANS LES DEUX SENS (cas réel « Récolte »)', () => {
  // 1800 JH/Ha au niveau famille, 11 opérations au référentiel, aucune saisie.
  const budgets = { 'Récolte': 1800 }
  assert.deepStrictEqual(familleTotal('Récolte', budgets, { 'Récolte': {} }),
    { total: 1800, source: 'famille' })
  // On renseigne une opération → bascule sur les opérations.
  assert.deepStrictEqual(familleTotal('Récolte', budgets, { 'Récolte': { 'Cueillette': 12 } }),
    { total: 12, source: 'operations' })
  // On l'efface → retour à la valeur de famille.
  assert.deepStrictEqual(familleTotal('Récolte', budgets, { 'Récolte': { 'Cueillette': 0 } }),
    { total: 1800, source: 'famille' })
})

test('familleTotal — cas MIXTE : opérations prioritaires, jamais d\'addition', () => {
  const r = familleTotal('Arrachage', { 'Arrachage': 100 }, { 'Arrachage': { 'A': 3, 'B': 4 } })
  assert.deepStrictEqual(r, { total: 7, source: 'operations' })
  assert.notStrictEqual(r.total, 107)
})

test('familleTotal — valeurs saisies en chaîne FR, arrondi 2 décimales', () => {
  assert.deepStrictEqual(
    familleTotal('Taille', {}, { 'Taille': { 'A': '1,1', 'B': '2,2' } }),
    { total: 3.3, source: 'operations' }
  )
  assert.deepStrictEqual(familleTotal('Taille', { 'Taille': '2,5' }, {}), { total: 2.5, source: 'famille' })
})

// ------------------------------------------------- purgeOperationsInconnues

test('purgeOperationsInconnues — retire les couples hors référentiel', () => {
  const r = purgeOperationsInconnues(
    { 'Taille': { 'Taille d\'hiver': 1, 'Opération supprimée': 2 } },
    OPERATIONS
  )
  assert.deepStrictEqual(r.budgets_operations, { 'Taille': { 'Taille d\'hiver': 1 } })
  assert.deepStrictEqual(r.purgees, ['Taille — Opération supprimée'])
})

test('purgeOperationsInconnues — famille entièrement obsolète : famille retirée', () => {
  const r = purgeOperationsInconnues({ 'Ancienne famille': { 'X': 1 } }, OPERATIONS)
  assert.deepStrictEqual(r.budgets_operations, {})
  assert.deepStrictEqual(r.purgees, ['Ancienne famille — X'])
})

test('purgeOperationsInconnues — référentiel vide/absent = AUCUNE purge (fail-safe)', () => {
  const b = { 'Taille': { 'X': 1 } }
  assert.deepStrictEqual(purgeOperationsInconnues(b, []).budgets_operations, b)
  assert.deepStrictEqual(purgeOperationsInconnues(b, null).purgees, [])
})

// ---------------------------- writeBudgetInTransaction (niveau opération)

test('writeBudgetInTransaction — supprimer UNE opération l\'efface réellement en base', async () => {
  const f = fakeTx({
    budgets: {},
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 1, 'Taille de formation': 2 } },
  })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 0 } },
  }))

  assert.strictEqual(f.calls.length, 1)
  const call = f.calls[0]
  assert.deepStrictEqual(call.data.budgets_operations, { 'Taille': { 'Taille de formation': 2 } })
  // Le masque doit porter la RACINE `budgets_operations`. Avec {merge:true} (ou
  // un mergeFields au chemin `budgets_operations.Taille."Taille d'hiver"`), la
  // valeur 1 survivrait en base : c'est le bug du lot précédent, transposé à
  // une map de maps.
  assert.notStrictEqual(call.options && call.options.merge, true)
  assert.ok(call.options.mergeFields.includes('budgets_operations'))
  assert.ok(
    !call.options.mergeFields.some((p) => String(p).indexOf('budgets_operations.') === 0),
    'aucun chemin descendant sous budgets_operations'
  )
  assert.deepStrictEqual(out.budgets_operations, { 'Taille': { 'Taille de formation': 2 } })
})

test('writeBudgetInTransaction — un doc niveau famille reste intact quand on ajoute des opérations', async () => {
  // Donnée déjà en PROD (lot précédent) : aucune migration, rien n'est perdu.
  const f = fakeTx({ budgets: { 'Entretien structure': 4, 'Taille': 9 } })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 1 } },
  }))
  assert.deepStrictEqual(out.budgets, { 'Entretien structure': 4, 'Taille': 9 })
  assert.deepStrictEqual(out.budgets_operations, { 'Taille': { 'Taille d\'hiver': 1 } })
  // …et la règle de total tranche : Taille = 1 (opérations), Entretien = 4.
  assert.strictEqual(familleTotal('Taille', out.budgets, out.budgets_operations).total, 1)
  assert.strictEqual(familleTotal('Entretien structure', out.budgets, out.budgets_operations).total, 4)
})

test('writeBudgetInTransaction — création : les deux maps sont écrites et masquées', async () => {
  const f = fakeTx(null)
  await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets: { 'Entretien structure': 4 },
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 1 } },
  }))
  const call = f.calls[0]
  assert.deepStrictEqual(call.data.budgets, { 'Entretien structure': 4 })
  assert.deepStrictEqual(call.data.budgets_operations, { 'Taille': { 'Taille d\'hiver': 1 } })
  for (const k of Object.keys(call.data)) {
    assert.ok(call.options.mergeFields.includes(k), 'champ hors masque : ' + k)
  }
})

// ------------------------------- garde-fou proportionnel de purge (M2)

test('purgeAutorisee — une entrée toujours purgeable, au-delà un tiers maximum', () => {
  assert.strictEqual(purgeAutorisee(1, 1), true, 'plancher : 1 sur 1')
  assert.strictEqual(purgeAutorisee(1, 2), true)
  assert.strictEqual(purgeAutorisee(2, 6), true, '2 sur 6 = un tiers')
  assert.strictEqual(purgeAutorisee(3, 6), false, '3 sur 6 = la moitié')
  assert.strictEqual(purgeAutorisee(40, 108), false)
  assert.strictEqual(purgeAutorisee(36, 108), true)
})

test('purgeOperationsInconnues — référentiel PARTIELLEMENT dégradé : purge reportée', () => {
  // 6 opérations en base, un référentiel amputé n'en connaît plus que 2 : ce
  // n'est pas un renommage, c'est une lecture incomplète. On ne supprime rien.
  const budgetsOps = {
    'Taille': { 'A': 1, 'B': 2, 'C': 3 },
    'Ferti-irrigation': { 'D': 4, 'E': 5, 'F': 6 },
  }
  const referentielAmpute = [
    { famille: 'Taille', operation: 'A' },
    { famille: 'Ferti-irrigation', operation: 'D' },
  ]
  const r = purgeOperationsInconnues(budgetsOps, referentielAmpute)
  assert.deepStrictEqual(r.purgees, [], 'aucune suppression')
  assert.deepStrictEqual(r.budgets_operations, budgetsOps, 'les 6 opérations survivent')
  assert.strictEqual(r.purge_differee, 4, 'ampleur de la purge évitée, remontée')
})

test('purgeOperationsInconnues — purge d\'ampleur plausible : toujours appliquée', () => {
  const r = purgeOperationsInconnues(
    { 'Taille': { 'Taille d\'hiver': 1, 'Obsolete': 2, 'Taille de formation': 3 } },
    OPERATIONS
  )
  assert.deepStrictEqual(r.purgees, ['Taille — Obsolete'])
  assert.strictEqual(r.purge_differee, 0)
})

test('purgeFamillesInconnues — même garde-fou proportionnel au niveau famille', () => {
  const budgets = { 'Taille': 1, 'Ferti-irrigation': 2, 'Entretien structure': 3, 'X': 4 }
  // Référentiel amputé : 3 des 4 familles deviendraient inconnues.
  const r = purgeFamillesInconnues(budgets, ['Taille'])
  assert.deepStrictEqual(r.purgees, [])
  assert.deepStrictEqual(r.budgets, budgets)
  assert.strictEqual(r.purge_differee, 3)
})

// ----------------------------- rapport des neutralisations (cas mixte)

test('writeBudgetInTransaction — la valeur de famille remplacée est REMONTÉE', async () => {
  // Récolte valait 1800 au niveau famille ; le save ajoute une opération et
  // remet la famille à 0 (payload du front). La perte doit être signalée.
  const f = fakeTx({ budgets: { 'Taille': 1800 }, budgets_operations: {} })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets: { 'Taille': 0 },
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 12 } },
  }))
  assert.deepStrictEqual(out.familles_neutralisees, [
    { famille: 'Taille', valeur_precedente: 1800 },
  ])
  assert.deepStrictEqual(out.budgets, {})
  assert.strictEqual(familleTotal('Taille', out.budgets, out.budgets_operations).total, 12)
})

test('writeBudgetInTransaction — une famille NON éditée est signalée elle aussi', async () => {
  // Le save est global à la parcelle : une famille devenue mixte hors écran
  // est neutralisée par le même enregistrement. C'est exactement le cas que
  // l'utilisateur ne peut pas voir — il DOIT donc le lire dans la réponse.
  const f = fakeTx({
    budgets: { 'Taille': 1800, 'Ferti-irrigation': 40 },
    budgets_operations: { 'Ferti-irrigation': { 'Fertigation': 3 } },
  })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    // Le front n'édite que Taille, mais renvoie tout : Ferti-irrigation, déjà
    // détaillée en base, voit sa valeur de famille tomber.
    budgets: { 'Taille': 0, 'Ferti-irrigation': 0 },
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 12 } },
  }))
  assert.deepStrictEqual(
    out.familles_neutralisees.map((n) => n.famille).sort(),
    ['Ferti-irrigation', 'Taille']
  )
})

test('writeBudgetInTransaction — purge REPORTÉE : pas de fausse neutralisation annoncée', async () => {
  // Référentiel amputé : les 3 opérations de « Taille » sont toutes devenues
  // « inconnues », la purge est reportée (elles restent en base). La valeur de
  // famille tombe, mais il n'y a AUCUN détail légitime pour la remplacer :
  // annoncer une neutralisation serait un faux signal.
  const f = fakeTx({
    budgets: { 'Taille': 1800, 'Ferti-irrigation': 40 },
    budgets_operations: {
      'Taille': { 'Obsolete1': 1, 'Obsolete2': 2, 'Obsolete3': 3 },
      'Ferti-irrigation': { 'Fertigation': 5 },
    },
  })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets: { 'Taille': 0, 'Ferti-irrigation': 0 },
  }))
  assert.ok(out.purge_differee > 0, 'la purge doit bien être reportée')
  // Ferti-irrigation a un vrai détail au référentiel → neutralisation réelle.
  assert.deepStrictEqual(out.familles_neutralisees,
    [{ famille: 'Ferti-irrigation', valeur_precedente: 40 }])
  // Les opérations obsolètes de Taille survivent en base (rien n'est supprimé).
  assert.deepStrictEqual(f.calls[0].data.budgets_operations['Taille'],
    { 'Obsolete1': 1, 'Obsolete2': 2, 'Obsolete3': 3 })
})

test('purgeOperationsInconnues — expose la vue « référentiel seul » dans tous les cas', () => {
  const src = { 'Taille': { 'Taille d\'hiver': 1, 'Obsolete': 2 } }
  // Purge appliquée : les deux vues coïncident.
  const applique = purgeOperationsInconnues(src, OPERATIONS)
  assert.deepStrictEqual(applique.budgets_operations_connues, applique.budgets_operations)
  // Sans référentiel : aucune supposition, les deux vues coïncident aussi.
  const sansRef = purgeOperationsInconnues(src, [])
  assert.deepStrictEqual(sansRef.budgets_operations_connues, sansRef.budgets_operations)
})

test('writeBudgetInTransaction — une suppression SANS opération n\'est pas une neutralisation', async () => {
  // L'utilisateur vide simplement le champ d'une famille : c'est une
  // suppression volontaire et lisible, pas un effet de bord à signaler.
  const f = fakeTx({ budgets: { 'Taille': 5 } })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' },
    Object.assign({}, WRITE_ARGS, { budgets: { 'Taille': 0 } }))
  assert.deepStrictEqual(out.familles_neutralisees, [])
})

test('writeBudgetInTransaction — purge les opérations obsolètes et les signale', async () => {
  const f = fakeTx({
    budgets: { 'Ancienne famille': 3 },
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 1, 'Op supprimée': 7 } },
  })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets_operations: { 'Taille': { 'Taille de formation': 2 } },
  }))
  assert.deepStrictEqual(out.purgees, ['Ancienne famille'])
  assert.deepStrictEqual(out.operations_purgees, ['Taille — Op supprimée'])
  assert.deepStrictEqual(f.calls[0].data.budgets_operations, {
    'Taille': { 'Taille d\'hiver': 1, 'Taille de formation': 2 },
  })
})
