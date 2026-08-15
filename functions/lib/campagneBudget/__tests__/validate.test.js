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
  opKey,
  splitOpKey,
  familleDuCode,
  indexOperations,
  canonicalizeOperationKeys,
  operationLabel,
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

/**
 * Référentiel des triplets (code, famille, opération) — forme de
 * `referentielOperationsConnues(loadReferentielTaches())`, famille RÉSOLUE DEPUIS
 * LE CODE. Les codes sont ceux du référentiel réel.
 */
const OPERATIONS = [
  { code: 'GB09', famille: 'Taille', operation: 'Taille de formation' },
  { code: 'GB09', famille: 'Taille', operation: 'Taille d\'hiver' },
  { code: 'GB02', famille: 'Ferti-irrigation', operation: 'Nettoyage goutteurs' },
  { code: 'GB02', famille: 'Ferti-irrigation', operation: 'Fertigation' },
  { code: 'GB05', famille: 'Entretien structure', operation: 'Réparation filets' },
]

/** Clés canoniques du référentiel de test — lisibilité des assertions. */
const K = {
  hiver: 'GB09::Taille d\'hiver',
  formation: 'GB09::Taille de formation',
  fertigation: 'GB02::Fertigation',
  goutteurs: 'GB02::Nettoyage goutteurs',
  filets: 'GB05::Réparation filets',
}

/**
 * Cas RÉEL du référentiel : « Nettoyage » existe sous DEUX codes, avec deux
 * familles distinctes. C'est la raison d'être de la clé (code, opération).
 */
const OPERATIONS_NETTOYAGE = [
  { code: 'GB05', famille: 'Entretien structure', operation: 'Nettoyage' },
  { code: 'GB11', famille: 'Service générale', operation: 'Nettoyage' },
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

test('MAX_JH_PAR_HA — calibré sur les données réelles, pas sur une intuition', () => {
  // 1800 JH/Ha = famille « Récolte » framboise (MIA, YASMINE) dans le budget de
  // campagne d'Omar, ~73 % du budget de la parcelle. C'est une valeur LÉGITIME :
  // l'ancien plafond de 1000 refusait 3 parcelles sur 9 à l'import.
  assert.deepStrictEqual(parseBudgetValue(1800), { ok: true, value: 1800 })
  assert.deepStrictEqual(parseBudgetValue(1500), { ok: true, value: 1500 })
  // 18000 = la faute de frappe classique (un zéro de trop sur 1800) : refusée.
  assert.strictEqual(parseBudgetValue(18000).ok, false)
  assert.strictEqual(MAX_JH_PAR_HA, 5000)
})

test('le message d\'erreur cite la borne COURANTE, jamais une valeur figée', () => {
  const verdict = parseBudgetValue(MAX_JH_PAR_HA + 1)
  assert.strictEqual(verdict.ok, false)
  assert.strictEqual(verdict.error, 'Budget JH/Ha hors limite (max ' + MAX_JH_PAR_HA + ')')
  assert.match(verdict.error, /max 5000/)
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
    { code: ' gb09 ', famille: ' Taille ', operation: ' Taille d\'hiver ' },
    { famille: 'Taille', operation: '' },
    { famille: '', operation: 'X' },
    null,
    'pas un objet',
  ])
  // Deux entrées de lookup (clé canonique + alias hérité), une seule opération.
  assert.strictEqual(Object.keys(idx).length, 2)
  const entree = { famille: 'Taille', operation: 'Taille d\'hiver', code: 'GB09', key: K.hiver }
  Object.values(idx).forEach((v) => assert.deepStrictEqual(v, entree))
})

test('indexOperations — sans référentiel : index vide (l\'appelant fail-close)', () => {
  assert.deepStrictEqual(indexOperations(null), {})
  assert.deepStrictEqual(indexOperations([]), {})
})

// ------------------------------------------- clé (code, opération) — le cœur
//
// Le tableau Campagne ne lit JAMAIS la famille de la fiche : il la déduit du
// code GB de la ligne de pointage (resolveFamily → _refMap[code].famille). La
// clé du budget doit donc être (code, opération), sinon rien ne garantit qu'un
// budget rejoigne les JH réalisés.

test('opKey / splitOpKey — aller-retour, et tolérance aux clés sans code', () => {
  assert.strictEqual(opKey('gb05', ' Nettoyage '), 'GB05::Nettoyage')
  assert.deepStrictEqual(splitOpKey('GB05::Nettoyage'), { code: 'GB05', operation: 'Nettoyage' })
  // Document antérieur à l'alignement : la clé se réduit au libellé.
  assert.strictEqual(opKey('', 'Nettoyage'), 'Nettoyage')
  assert.strictEqual(opKey(null, 'Nettoyage'), 'Nettoyage')
  assert.deepStrictEqual(splitOpKey('Nettoyage'), { code: '', operation: 'Nettoyage' })
  // Un libellé qui contiendrait le séparateur n'est PAS pris pour un code.
  assert.strictEqual(opKey('Entretien structure', 'Nettoyage'), 'Nettoyage')
  assert.deepStrictEqual(splitOpKey('Sortie :: retour'), { code: '', operation: 'Sortie :: retour' })
  assert.deepStrictEqual(splitOpKey(null), { code: '', operation: '' })
})

test('familleDuCode — la famille vient du CODE, la fiche n\'est qu\'un repli', () => {
  const map = { GB05: { famille: 'Entretien structure' }, GB11: 'Service générale' }
  // Fiche divergente (faute de frappe, import partiel) : le code tranche —
  // sans quoi le budget partirait sous une famille que le réalisé n'alimente pas.
  assert.strictEqual(familleDuCode('GB05', 'Entretien Structure', map), 'Entretien structure')
  assert.strictEqual(familleDuCode('GB11', 'Autre', map), 'Service générale')
  // Code inconnu de la table → repli sur la fiche, jamais de famille vide.
  assert.strictEqual(familleDuCode('GB99', ' Récolte ', map), 'Récolte')
  assert.strictEqual(familleDuCode('', 'Récolte', map), 'Récolte')
  assert.strictEqual(familleDuCode('GB05', 'X', null), 'X')
  assert.strictEqual(familleDuCode(null, null, map), '')
})

/**
 * Clé de lookup de l'index — miroir de `__cb_opKey` (non exporté). Séparateur
 * = caractère NUL : un séparateur imprimable rendrait ('A B', 'C') et
 * ('A', 'B C') indiscernables.
 */
function lk(famille, key) {
  return String(famille).trim().toUpperCase() + '\u0000' + String(key).trim().toUpperCase()
}

test('indexOperations — MÊME opération sous DEUX codes : deux entrées distinctes', () => {
  const idx = indexOperations(OPERATIONS_NETTOYAGE)
  assert.strictEqual(idx[lk('Entretien structure', 'GB05::Nettoyage')].key, 'GB05::Nettoyage')
  assert.strictEqual(idx[lk('Service générale', 'GB11::Nettoyage')].key, 'GB11::Nettoyage')
  // Les deux alias hérités existent : ils sont non ambigus DANS LEUR famille.
  assert.strictEqual(idx[lk('Entretien structure', 'Nettoyage')].key, 'GB05::Nettoyage')
  assert.strictEqual(idx[lk('Service générale', 'Nettoyage')].key, 'GB11::Nettoyage')
})

test('indexOperations — alias hérité AMBIGU (deux codes, même famille) : retiré', () => {
  // Cas que la clé (famille, opération) rendait indistinguable : ici on refuse
  // de deviner, la clé nue ne désigne plus rien.
  const idx = indexOperations([
    { code: 'GB03', famille: 'plantation', operation: 'Plantation' },
    { code: 'LB03', famille: 'plantation', operation: 'Plantation' },
  ])
  assert.strictEqual(idx[lk('plantation', 'Plantation')], undefined)
  assert.strictEqual(idx[lk('plantation', 'GB03::Plantation')].key, 'GB03::Plantation')
  assert.strictEqual(idx[lk('plantation', 'LB03::Plantation')].key, 'LB03::Plantation')
})

test('operationLabel — le code est affiché quand la clé en porte un', () => {
  assert.strictEqual(operationLabel('Entretien structure', 'GB05::Nettoyage'),
    'Entretien structure — Nettoyage (GB05)')
  assert.strictEqual(operationLabel('Service générale', 'GB11::Nettoyage'),
    'Service générale — Nettoyage (GB11)')
  // Clé héritée : libellé seul, aucun code inventé.
  assert.strictEqual(operationLabel('Taille', 'Taille d\'hiver'), 'Taille — Taille d\'hiver')
})

// -------------------------------------------------- canonicalizeOperationKeys

test('canonicalizeOperationKeys — une clé héritée est ramenée à sa forme canonique', () => {
  assert.deepStrictEqual(
    canonicalizeOperationKeys({ 'Taille': { 'Taille d\'hiver': 1.5 } }, OPERATIONS),
    { 'Taille': { [K.hiver]: 1.5 } }
  )
})

test('canonicalizeOperationKeys — deux formes de la MÊME opération : la canonique gagne', () => {
  // Sans ça, familleTotal compterait deux fois la même opération.
  const out = canonicalizeOperationKeys(
    { 'Taille': { 'Taille d\'hiver': 1, [K.hiver]: 4 } }, OPERATIONS)
  assert.deepStrictEqual(out, { 'Taille': { [K.hiver]: 4 } })
  assert.strictEqual(familleTotal('Taille', {}, out).total, 4)
})

test('canonicalizeOperationKeys — clé inconnue laissée telle quelle, 0 conservé', () => {
  // Le sort d'une clé inconnue appartient à la purge (et à son garde-fou), pas
  // à cette fonction ; un 0 signifie « supprimer » et doit atteindre le merge.
  assert.deepStrictEqual(
    canonicalizeOperationKeys({ 'Taille': { 'Fantôme': 2, [K.hiver]: 0 } }, OPERATIONS),
    { 'Taille': { 'Fantôme': 2, [K.hiver]: 0 } }
  )
})

test('canonicalizeOperationKeys — sans référentiel : aucune conversion, aucune perte', () => {
  const src = { 'Taille': { 'Taille d\'hiver': 1, 'Zero': 0 } }
  assert.deepStrictEqual(canonicalizeOperationKeys(src, []), src)
  assert.deepStrictEqual(canonicalizeOperationKeys(src, null), src)
  assert.deepStrictEqual(canonicalizeOperationKeys(null, OPERATIONS), {})
  assert.deepStrictEqual(canonicalizeOperationKeys({ 'Taille': 3 }, OPERATIONS), {})
})

// ------------------------------------------- validateBudgetSave (opérations)

test('validateBudgetSave — accepte un budget par opération, clés canonisées', () => {
  const v = validateBudgetSave(base({
    budgets: {},
    // Formes acceptées en entrée : clé canonique, clé héritée, casse quelconque.
    // Sortie TOUJOURS canonique `CODE::Libellé`.
    budgets_operations: { 'taille': { 'GB09::TAILLE D\'HIVER': '1,5', 'Taille de formation': 2 } },
  }))
  assert.strictEqual(v.ok, true)
  assert.deepStrictEqual(v.budgets, {})
  assert.deepStrictEqual(v.budgets_operations, {
    'Taille': { [K.hiver]: 1.5, [K.formation]: 2 },
  })
})

test('validateBudgetSave — MÊME libellé sous DEUX codes : deux budgets distincts', () => {
  // « Nettoyage » existe en GB05 (Entretien structure) ET en GB11 (Service
  // générale). Le tableau Campagne impute les JH selon le code de la ligne de
  // pointage : les deux budgets ne doivent JAMAIS se confondre.
  const v = validateBudgetSave({
    campagne: '2026-2027',
    label_bee_one: 'F5- CASCADE -S13',
    budgets: {},
    budgets_operations: {
      'Entretien structure': { 'GB05::Nettoyage': 3 },
      'Service générale': { 'GB11::Nettoyage': 8 },
    },
    famillesConnues: ['Entretien structure', 'Service générale'],
    operationsConnues: OPERATIONS_NETTOYAGE,
    labelsConnus: LABELS,
  })
  assert.strictEqual(v.ok, true)
  assert.deepStrictEqual(v.budgets_operations, {
    'Entretien structure': { 'GB05::Nettoyage': 3 },
    'Service générale': { 'GB11::Nettoyage': 8 },
  })
  assert.strictEqual(familleTotal('Entretien structure', {}, v.budgets_operations).total, 3)
  assert.strictEqual(familleTotal('Service générale', {}, v.budgets_operations).total, 8)
})

test('validateBudgetSave — un code n\'ouvre pas les opérations d\'un autre code', () => {
  // GB11::Nettoyage sous « Entretien structure » : le couple n'existe pas.
  const v = validateBudgetSave({
    campagne: '2026-2027',
    label_bee_one: 'F5- CASCADE -S13',
    budgets: {},
    budgets_operations: { 'Entretien structure': { 'GB11::Nettoyage': 3 } },
    famillesConnues: ['Entretien structure', 'Service générale'],
    operationsConnues: OPERATIONS_NETTOYAGE,
    labelsConnus: LABELS,
  })
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /Opération inconnue du référentiel/)
})

test('validateBudgetSave — clé héritée ET clé canonique de la même opération = doublon', () => {
  // Les deux désignent la même chose : accepter les deux ferait écraser
  // silencieusement l'une par l'autre.
  const v = validateBudgetSave(base({
    budgets: {},
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 1, [K.hiver]: 2 } },
  }))
  assert.strictEqual(v.ok, false)
  assert.match(String(v.error), /doublon/)
})

test('validateBudgetSave — les deux niveaux cohabitent dans un même save', () => {
  const v = validateBudgetSave(base({
    // « Service générale » d'Omar : famille sans détail par opération.
    budgets: { 'Entretien structure': 4 },
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 1 } },
  }))
  assert.strictEqual(v.ok, true)
  assert.deepStrictEqual(v.budgets, { 'Entretien structure': 4 })
  assert.deepStrictEqual(v.budgets_operations, { 'Taille': { [K.hiver]: 1 } })
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
    budgets_operations: { 'Taille': { [K.hiver]: 1, [K.formation]: 2 } },
  })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets_operations: { 'Taille': { [K.hiver]: 0 } },
  }))

  assert.strictEqual(f.calls.length, 1)
  const call = f.calls[0]
  assert.deepStrictEqual(call.data.budgets_operations, { 'Taille': { [K.formation]: 2 } })
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
  assert.deepStrictEqual(out.budgets_operations, { 'Taille': { [K.formation]: 2 } })
})

test('writeBudgetInTransaction — un doc niveau famille reste intact quand on ajoute des opérations', async () => {
  // Donnée déjà en PROD (lot précédent) : aucune migration, rien n'est perdu.
  // C'est EXACTEMENT la forme du seul document existant (`budgets` seul).
  const f = fakeTx({ budgets: { 'Entretien structure': 4, 'Taille': 9 } })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets_operations: { 'Taille': { [K.hiver]: 1 } },
  }))
  assert.deepStrictEqual(out.budgets, { 'Entretien structure': 4, 'Taille': 9 })
  assert.deepStrictEqual(out.budgets_operations, { 'Taille': { [K.hiver]: 1 } })
  // …et la règle de total tranche : Taille = 1 (opérations), Entretien = 4.
  assert.strictEqual(familleTotal('Taille', out.budgets, out.budgets_operations).total, 1)
  assert.strictEqual(familleTotal('Entretien structure', out.budgets, out.budgets_operations).total, 4)
})

test('writeBudgetInTransaction — création : les deux maps sont écrites et masquées', async () => {
  const f = fakeTx(null)
  await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets: { 'Entretien structure': 4 },
    budgets_operations: { 'Taille': { [K.hiver]: 1 } },
  }))
  const call = f.calls[0]
  assert.deepStrictEqual(call.data.budgets, { 'Entretien structure': 4 })
  assert.deepStrictEqual(call.data.budgets_operations, { 'Taille': { [K.hiver]: 1 } })
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
    // Document ANTÉRIEUR à l'alignement : clés sans code. Elles sont ramenées à
    // leur forme canonique, PAS purgées — aucune migration, aucune perte.
    budgets_operations: { 'Taille': { 'Taille d\'hiver': 1, 'Op supprimée': 7 } },
  })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets_operations: { 'Taille': { [K.formation]: 2 } },
  }))
  assert.deepStrictEqual(out.purgees, ['Ancienne famille'])
  assert.deepStrictEqual(out.operations_purgees, ['Taille — Op supprimée'])
  assert.deepStrictEqual(f.calls[0].data.budgets_operations, {
    'Taille': { [K.hiver]: 1, [K.formation]: 2 },
  })
})

// =============================================================================
// BUDGET DE QUINZAINE (LOT 3b) — engagement court terme, maille famille.
// Orthogonal au budget annuel : AUCUNE contrainte de somme n'est testée ici
// parce qu'il n'y en a pas, et il ne doit pas y en avoir (l'écart entre la somme
// des quinzaines et le budget annuel est une information, pas une erreur).
// =============================================================================

const {
  MAX_QUINZAINES,
  CULTURES_BUDGET_QUINZAINE,
  quinzaineKey,
  quinzaineNum,
  mergeBudgetsQuinzaine,
  purgeQuinzainesInconnues,
  quinzainesSupprimees,
} = require('../validate')

// ------------------------------------------------------------- quinzaineKey

test('quinzaineKey — les trois formes qui circulent donnent la MÊME clé', () => {
  // Clé persistée, libellé d'affichage des `periodes`, numéro nu.
  assert.strictEqual(quinzaineKey('Q07'), 'Q07')
  assert.strictEqual(quinzaineKey('Quinzaine 7'), 'Q07')
  assert.strictEqual(quinzaineKey('Quinzaine 07'), 'Q07')
  assert.strictEqual(quinzaineKey(' quinzaine  24 '), 'Q24')
  assert.strictEqual(quinzaineKey(7), 'Q07')
  assert.strictEqual(quinzaineKey('24'), 'Q24')
  assert.strictEqual(quinzaineNum('Quinzaine 7'), 7)
  assert.strictEqual(quinzaineNum('n\'importe quoi'), 0)
})

test('quinzaineKey — STRICTE : jamais « le dernier nombre de la chaîne »', () => {
  // Un libellé de campagne finit par un nombre à deux chiffres : une clé de
  // document ne se devine pas, sinon '2026-2027' deviendrait la quinzaine 27.
  assert.strictEqual(quinzaineKey('2026-2027'), '')
  assert.strictEqual(quinzaineKey('Période 3 bis'), '')
  assert.strictEqual(quinzaineKey('Q0'), '')
  assert.strictEqual(quinzaineKey('Q100'), '')
  assert.strictEqual(quinzaineKey(''), '')
  assert.strictEqual(quinzaineKey(null), '')
  assert.strictEqual(quinzaineKey(true), '')
})

// -------------------------------------------------- validateBudgetSave (quinz.)

function baseQ(overrides) {
  return base(Object.assign({ budgets: {}, culture: 'Framboise' }, overrides || {}))
}

test('validateBudgetSave — budget de quinzaine : clés canonisées, familles validées', () => {
  const r = validateBudgetSave(baseQ({
    budgets_quinzaine: { 'Quinzaine 7': { 'Taille': '1,5' }, 'Q08': { 'Taille': 2 } },
  }))
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.budgets_quinzaine, {
    Q07: { 'Taille': 1.5 },
    Q08: { 'Taille': 2 },
  })
})

test('validateBudgetSave — un budget de quinzaine SEUL suffit', () => {
  // Le save peut ne porter que l'engagement court terme : le budget annuel n'est
  // pas re-transmis à chaque quinzaine.
  const r = validateBudgetSave(baseQ({
    budgets: undefined,
    budgets_operations: undefined,
    budgets_quinzaine: { Q07: { 'Taille': 1 } },
  }))
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.budgets, {})
})

test('validateBudgetSave — quinzaine illisible, doublon, famille inconnue : refus', () => {
  assert.match(
    String(validateBudgetSave(baseQ({ budgets_quinzaine: { 'Semaine 3': { 'Taille': 1 } } })).error),
    /Quinzaine invalide/
  )
  assert.match(
    String(validateBudgetSave(baseQ({
      budgets_quinzaine: { 'Q07': { 'Taille': 1 }, 'Quinzaine 7': { 'Taille': 2 } },
    })).error),
    /Quinzaine en doublon/
  )
  assert.match(
    String(validateBudgetSave(baseQ({ budgets_quinzaine: { Q07: { 'Inventée': 1 } } })).error),
    /Famille d'opération inconnue/
  )
  assert.match(
    String(validateBudgetSave(baseQ({ budgets_quinzaine: { Q07: { 'Taille': -1 } } })).error),
    /négatif/
  )
  assert.match(
    String(validateBudgetSave(baseQ({ budgets_quinzaine: { Q07: [1, 2] } })).error),
    /Budgets de quinzaine invalides/
  )
  assert.match(
    String(validateBudgetSave(baseQ({ budgets_quinzaine: [] })).error),
    /Budgets de quinzaine invalides/
  )
})

test('validateBudgetSave — plafond de quinzaines par enregistrement', () => {
  const trop = {}
  for (let i = 0; i < MAX_QUINZAINES + 1; i += 1) trop['Q' + (i + 1)] = { 'Taille': 1 }
  assert.match(String(validateBudgetSave(baseQ({ budgets_quinzaine: trop })).error), /Trop de quinzaines/)
})

// ---------------------------------------------------- gating AVOCATIER (serveur)

test('validateBudgetSave — avocatier : budget de quinzaine REFUSÉ, même forgé', () => {
  const r = validateBudgetSave(baseQ({
    culture: 'Avocatier',
    budgets_quinzaine: { Q07: { 'Taille': 1 } },
  }))
  assert.strictEqual(r.ok, false)
  assert.match(String(r.error), /Avocatier/)
})

test('validateBudgetSave — culture non résolue : refus fail-closed', () => {
  const r = validateBudgetSave(baseQ({ culture: '', budgets_quinzaine: { Q07: { 'Taille': 1 } } }))
  assert.strictEqual(r.ok, false)
  assert.match(String(r.error), /Culture de la parcelle indéterminée/)
})

test('validateBudgetSave — le budget ANNUEL reste ouvert à l\'avocatier', () => {
  // Périmètre du lot : le gating porte sur le budget de quinzaine. Refuser aussi
  // le budget annuel serait un changement de comportement sur 473 valeurs déjà
  // en production.
  const r = validateBudgetSave(base({ culture: 'Avocatier', budgets: { 'Taille': 2 } }))
  assert.strictEqual(r.ok, true)
})

test('CULTURES_BUDGET_QUINZAINE — framboise et myrtille, jamais avocatier', () => {
  assert.deepStrictEqual(CULTURES_BUDGET_QUINZAINE.slice().sort(), ['Framboise', 'Myrtille'])
})

// ----------------------------------------------------- mergeBudgetsQuinzaine

test('mergeBudgetsQuinzaine — l\'entrant est autoritaire, les AUTRES quinzaines survivent', () => {
  const existing = { Q07: { 'Taille': 1, 'Ferti-irrigation': 2 }, Q08: { 'Taille': 3 } }
  const out = mergeBudgetsQuinzaine(existing, { Q07: { 'Taille': 5 } })
  assert.deepStrictEqual(out, {
    Q07: { 'Taille': 5, 'Ferti-irrigation': 2 },
    Q08: { 'Taille': 3 },
  })
  // Aucun argument muté.
  assert.deepStrictEqual(existing.Q07, { 'Taille': 1, 'Ferti-irrigation': 2 })
})

test('mergeBudgetsQuinzaine — 0 supprime la famille, une quinzaine vidée disparaît', () => {
  const out = mergeBudgetsQuinzaine({ Q07: { 'Taille': 1 }, Q08: { 'Taille': 2 } },
    { Q07: { 'Taille': 0 } })
  assert.deepStrictEqual(out, { Q08: { 'Taille': 2 } })
})

test('mergeBudgetsQuinzaine — canonise les clés en base, écarte l\'illisible', () => {
  const out = mergeBudgetsQuinzaine({ 'Quinzaine 7': { 'Taille': 1 }, 'zzz': { 'Taille': 9 } }, {})
  assert.deepStrictEqual(out, { Q07: { 'Taille': 1 } })
})

// -------------------------------------------------- purgeQuinzainesInconnues

test('purgeQuinzainesInconnues — retire les familles hors référentiel, les signale', () => {
  const r = purgeQuinzainesInconnues({
    Q07: { 'Taille': 1, 'Ferti-irrigation': 2, 'Entretien structure': 1 },
    Q08: { 'Ancienne': 4 },
  }, FAMILLES)
  assert.deepStrictEqual(r.budgets_quinzaine, {
    Q07: { 'Taille': 1, 'Ferti-irrigation': 2, 'Entretien structure': 1 },
  })
  assert.deepStrictEqual(r.purgees, ['Q08 — Ancienne'])
})

test('purgeQuinzainesInconnues — référentiel vide = aucune purge (fail-safe)', () => {
  const b = { Q07: { 'X': 1 } }
  assert.deepStrictEqual(purgeQuinzainesInconnues(b, []).budgets_quinzaine, b)
  assert.deepStrictEqual(purgeQuinzainesInconnues(b, null).purgees, [])
})

test('purgeQuinzainesInconnues — garde-fou proportionnel compté sur TOUTES les quinzaines', () => {
  // Une famille retirée du référentiel touche chaque quinzaine : jugée quinzaine
  // par quinzaine, chaque purge passerait pour un cas isolé (≤ 1 entrée) et le
  // garde-fou ne se déclencherait jamais.
  const src = {
    Q07: { 'Taille': 1, 'Ancienne': 1 },
    Q08: { 'Taille': 1, 'Ancienne': 1 },
    Q09: { 'Taille': 1, 'Ancienne': 1 },
  }
  const r = purgeQuinzainesInconnues(src, FAMILLES)
  assert.deepStrictEqual(r.purgees, [])
  assert.strictEqual(r.purge_differee, 3)
  assert.deepStrictEqual(r.budgets_quinzaine, src)
})

// ------------------------------------------------------- quinzainesSupprimees

test('quinzainesSupprimees — ce qui existait et n\'existe plus, rien d\'autre', () => {
  const out = quinzainesSupprimees(
    { Q07: { 'Taille': 2, 'Ferti-irrigation': 1 }, Q08: { 'Taille': 3 } },
    { Q07: { 'Taille': 2 } }
  )
  assert.deepStrictEqual(out, [
    { quinzaine: 'Q07', famille: 'Ferti-irrigation', valeur_precedente: 1 },
    { quinzaine: 'Q08', famille: 'Taille', valeur_precedente: 3 },
  ])
  assert.deepStrictEqual(quinzainesSupprimees({ Q07: { 'Taille': 1 } }, { Q07: { 'Taille': 1 } }), [])
})

// -------------------------------------- writeBudgetInTransaction (quinzaine)

test('writeBudgetInTransaction — PIÈGE mergeFields : la racine budgets_quinzaine y est', async () => {
  // Le cœur du lot. Avec `{merge:true}` (ou un mergeFields nommant
  // `budgets_quinzaine.Q07`), le masque serait construit sur les FEUILLES : la
  // famille effacée survivrait en base et l'écran afficherait un succès mensonger.
  const f = fakeTx({ budgets_quinzaine: { Q07: { 'Taille': 1, 'Ferti-irrigation': 2 } } })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets_quinzaine: { Q07: { 'Taille': 0 } },
  }))
  const call = f.calls[0]
  assert.notStrictEqual(call.options && call.options.merge, true)
  assert.ok(call.options.mergeFields.includes('budgets_quinzaine'))
  // …à la RACINE et à la racine seulement.
  assert.ok(!call.options.mergeFields.some((p) => String(p).startsWith('budgets_quinzaine.')))
  assert.deepStrictEqual(call.data.budgets_quinzaine, { Q07: { 'Ferti-irrigation': 2 } })
  assert.deepStrictEqual(out.budgets_quinzaine, { Q07: { 'Ferti-irrigation': 2 } })
  // La suppression est RAPPORTÉE, jamais silencieuse.
  assert.deepStrictEqual(out.quinzaines_supprimees, [
    { quinzaine: 'Q07', famille: 'Taille', valeur_precedente: 1 },
  ])
})

test('writeBudgetInTransaction — vider une quinzaine ENTIÈRE l\'efface réellement', async () => {
  const f = fakeTx({ budgets_quinzaine: { Q07: { 'Taille': 1 }, Q08: { 'Taille': 2 } } })
  await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets_quinzaine: { Q07: { 'Taille': 0 } },
  }))
  assert.deepStrictEqual(f.calls[0].data.budgets_quinzaine, { Q08: { 'Taille': 2 } })
})

test('writeBudgetInTransaction — document SANS budgets_quinzaine : aucune migration', async () => {
  // Les 473 valeurs déjà en production vivent dans des documents sans ce champ.
  // Un save qui n'en porte pas ne doit pas en inventer un, ni toucher au reste.
  const f = fakeTx({ budgets: { 'Taille': 1 } })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' },
    Object.assign({}, WRITE_ARGS, { budgets: { 'Ferti-irrigation': 2 } }))
  assert.deepStrictEqual(f.calls[0].data.budgets_quinzaine, {})
  assert.deepStrictEqual(f.calls[0].data.budgets, { 'Taille': 1, 'Ferti-irrigation': 2 })
  assert.deepStrictEqual(out.quinzaines_supprimees, [])
})

test('writeBudgetInTransaction — quinzaine et budget annuel n\'interfèrent PAS', async () => {
  const f = fakeTx({ budgets: { 'Taille': 100 } })
  const out = await writeBudgetInTransaction(f.tx, { id: 'doc' }, Object.assign({}, WRITE_ARGS, {
    budgets_quinzaine: { Q07: { 'Taille': 3 } },
  }))
  // Somme des quinzaines très inférieure au budget annuel : c'est légitime, rien
  // n'est rééquilibré ni signalé.
  assert.deepStrictEqual(out.budgets, { 'Taille': 100 })
  assert.deepStrictEqual(out.budgets_quinzaine, { Q07: { 'Taille': 3 } })
})
