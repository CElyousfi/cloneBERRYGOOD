'use strict'
// @ts-check

const test = require('node:test')
const assert = require('node:assert')

const {
  computeSeedPlan,
  normLabel,
  RAISON_DEJA_SB,
  RAISON_SANS_SURFACE,
  SOURCE_BEE_ONE,
} = require('../seedHa')

/** Parcelles telles que renvoyées par parcelles-campagne-list. */
const ROWS = [
  { label: 'F5- CASCADE -S13', sup: 2 },
  { label: 'F5 -BREEZE- S14', sup: 1 },
  { label: 'F1- ROUGE -S01', sup: 1.5 },
  { label: 'F1- ROUGE -S02', sup: 0 }, // aucune surface BEE ONE
]

/** Surfaces BR_Parcelle (source authoritative). */
const SUP = {
  'F5- CASCADE -S13': 2,
  'F5 -BREEZE- S14': 1,
  'F1- ROUGE -S01': 1.5,
}

function byLabel(list) {
  const m = {}
  list.forEach((e) => {
    m[e.label] = e
  })
  return m
}

test('normLabel — uppercase + trim', () => {
  assert.strictEqual(normLabel('  f5- cascade -s13 '), 'F5- CASCADE -S13')
  assert.strictEqual(normLabel(null), '')
  assert.strictEqual(normLabel(undefined), '')
})

test('computeSeedPlan — liste vide → plan vide', () => {
  const plan = computeSeedPlan({ rows: [], sbMap: {}, supMap: {} })
  assert.deepStrictEqual(plan, { toCreate: [], skipped: [] })
  // Entrée totalement absente : ne doit pas jeter.
  assert.deepStrictEqual(computeSeedPlan({}), { toCreate: [], skipped: [] })
})

test('computeSeedPlan — cas nominal : seule la parcelle sans Ha SB est créée', () => {
  const sbMap = { 'F5- CASCADE -S13': { ha: 2.4, nom_sb: 'Cascade Sud' } }
  const plan = computeSeedPlan({ rows: ROWS, sbMap, supMap: SUP })

  assert.deepStrictEqual(
    plan.toCreate,
    [
      { label: 'F5 -BREEZE- S14', ha: 1, source: SOURCE_BEE_ONE },
      { label: 'F1- ROUGE -S01', ha: 1.5, source: SOURCE_BEE_ONE },
    ],
    'seules les parcelles sans Ha SB et avec surface BEE ONE sont créées'
  )

  const skipped = byLabel(plan.skipped)
  assert.strictEqual(skipped['F5- CASCADE -S13'].raison, RAISON_DEJA_SB)
  assert.strictEqual(skipped['F1- ROUGE -S02'].raison, RAISON_SANS_SURFACE)
  assert.strictEqual(plan.skipped.length, 2)
})

test('computeSeedPlan — IDEMPOTENCE : rejouer le plan ne réécrit rien', () => {
  const sbMap = {}
  const plan1 = computeSeedPlan({ rows: ROWS, sbMap, supMap: SUP })
  assert.strictEqual(plan1.toCreate.length, 3)

  // Simule l'écriture du 1er passage dans sb_parcelle_referentiel.
  plan1.toCreate.forEach((c) => {
    sbMap[normLabel(c.label)] = { label_bee_one: c.label, ha: c.ha, seeded_from: c.source }
  })

  const plan2 = computeSeedPlan({ rows: ROWS, sbMap, supMap: SUP })
  assert.deepStrictEqual(plan2.toCreate, [], '2e passage : plus rien à créer')
  assert.strictEqual(plan2.skipped.length, 4)
  assert.strictEqual(
    plan2.skipped.filter((s) => s.raison === RAISON_DEJA_SB).length,
    3,
    'les 3 parcelles seedées sont désormais protégées par deja_sb'
  )
})

test('computeSeedPlan — un Ha SB nul/absent/invalide ne protège pas la parcelle', () => {
  const sbMap = {
    'F5- CASCADE -S13': { ha: 0 },
    'F5 -BREEZE- S14': { nom_sb: 'Breeze Nord' }, // nom saisi, pas de Ha
    'F1- ROUGE -S01': { ha: 'n/a' },
  }
  const plan = computeSeedPlan({ rows: ROWS, sbMap, supMap: SUP })
  assert.deepStrictEqual(
    plan.toCreate.map((c) => c.label),
    ['F5- CASCADE -S13', 'F5 -BREEZE- S14', 'F1- ROUGE -S01']
  )
})

test('computeSeedPlan — nom_sb préservé : jamais présent dans le plan', () => {
  const sbMap = { 'F5 -BREEZE- S14': { nom_sb: 'Breeze Nord', ha: 0 } }
  const plan = computeSeedPlan({ rows: ROWS, sbMap, supMap: SUP })
  const entry = plan.toCreate.find((c) => c.label === 'F5 -BREEZE- S14')
  assert.ok(entry, 'la parcelle est bien à créer (Ha nul)')
  assert.deepStrictEqual(
    Object.keys(entry).sort(),
    ['ha', 'label', 'source'],
    'le plan ne porte que label/ha/source → l écriture merge ne touche pas nom_sb'
  )
  assert.strictEqual(entry.nom_sb, undefined)
})

test('computeSeedPlan — parcelle sans surface source : rien créé', () => {
  const plan = computeSeedPlan({
    rows: [{ label: 'F1- ROUGE -S02' }, { label: 'F1- ROUGE -S03', sup: -2 }],
    sbMap: {},
    supMap: {},
  })
  assert.deepStrictEqual(plan.toCreate, [])
  assert.deepStrictEqual(plan.skipped, [
    { label: 'F1- ROUGE -S02', raison: RAISON_SANS_SURFACE },
    { label: 'F1- ROUGE -S03', raison: RAISON_SANS_SURFACE },
  ])
})

test('computeSeedPlan — casse et espaces : matching et déduplication', () => {
  const plan = computeSeedPlan({
    rows: [
      { label: '  f5- cascade -s13  ' },
      { label: 'F5- CASCADE -S13' }, // doublon (autre campagne)
      { label: ' f5 -breeze- s14 ' },
      { label: '   ' }, // ligne sans label → ignorée silencieusement
    ],
    sbMap: { '  f5 -breeze- s14 ': { ha: 1.2 } },
    supMap: { 'F5- CASCADE -S13': 2 },
  })
  assert.deepStrictEqual(plan.toCreate, [{ label: 'f5- cascade -s13', ha: 2, source: SOURCE_BEE_ONE }])
  assert.deepStrictEqual(plan.skipped, [{ label: 'f5 -breeze- s14', raison: RAISON_DEJA_SB }])
})

test('computeSeedPlan — supMap prime sur row.sup, fallback row.sup si absente', () => {
  const plan = computeSeedPlan({
    rows: [
      { label: 'A', sup: 9 },
      { label: 'B', sup: 3 },
    ],
    sbMap: {},
    supMap: { A: 2 },
  })
  assert.deepStrictEqual(plan.toCreate, [
    { label: 'A', ha: 2, source: SOURCE_BEE_ONE },
    { label: 'B', ha: 3, source: SOURCE_BEE_ONE },
  ])
})
