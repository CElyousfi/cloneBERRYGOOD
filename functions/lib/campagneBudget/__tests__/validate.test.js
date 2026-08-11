'use strict'
// @ts-check

const test = require('node:test')
const assert = require('node:assert')

const {
  MAX_JH_PAR_HA,
  normCampagne,
  normLabel,
  budgetDocId,
  parseBudgetValue,
  validateBudgetSave,
  mergeBudgets,
} = require('../validate')

const FAMILLES = ['Ferti-irrigation', 'Entretien structure', 'Taille', 'Tuteurage & palissage']
const LABELS = ['F5- CASCADE -S13', 'F1- ROUGE -S01']

function base(overrides) {
  return Object.assign(
    {
      campagne: '2026-2027',
      label_bee_one: 'F5- CASCADE -S13',
      budgets: { 'Taille': 2 },
      famillesConnues: FAMILLES,
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
