'use strict'
// @ts-check

/**
 * Tests du split au prorata des Ha (groupes de parcelles).
 *
 * ⚠️ FIXTURES PARTAGÉES avec la copie frontend :
 * `tests/unit/parcelleGroupUtils.test.js` utilise EXACTEMENT les mêmes cas.
 * Toute modification ici doit être répercutée là-bas (les deux copies du
 * helper doivent rester d'accord au chiffre près).
 */

const test = require('node:test')
const assert = require('node:assert')

const { computeParts, splitQuantite, expandItems, totalHa } = require('../split')

// ---------------------------------------------------------------------------
// FIXTURES (identiques côté frontend)
// ---------------------------------------------------------------------------

/** Cas de référence Omar : S13 2.00 Ha + S14 1.00 Ha. */
const GRP_S13_S14 = [
  { label: 'F5- CASCADE -S13', ha: 2 },
  { label: 'F5 -BREEZE- S14', ha: 1 },
]

/** Cas d'arrondi : 1.30 Ha + 2.00 Ha. */
const GRP_1_3_2_0 = [
  { label: 'A', ha: 1.3 },
  { label: 'B', ha: 2 },
]

/** Cas non divisible : 3 parcelles égales. */
const GRP_TIERS = [
  { label: 'A', ha: 1 },
  { label: 'B', ha: 1 },
  { label: 'C', ha: 1 },
]

test('computeParts — pourcentages proportionnels aux Ha', () => {
  const parts = computeParts(GRP_S13_S14)
  assert.deepStrictEqual(parts, [
    { label: 'F5- CASCADE -S13', ha: 2, pct: 66.7 },
    { label: 'F5 -BREEZE- S14', ha: 1, pct: 33.3 },
  ])
})

test('splitQuantite — 30 kg sur 2.00/1.00 Ha → 20/10 exact', () => {
  const parts = splitQuantite(30, GRP_S13_S14)
  assert.deepStrictEqual(parts, [
    { label: 'F5- CASCADE -S13', quantite: 20 },
    { label: 'F5 -BREEZE- S14', quantite: 10 },
  ])
  assert.strictEqual(
    parts.reduce((s, p) => s + p.quantite, 0),
    30
  )
})

test('splitQuantite — 10 sur 1.30/2.00 Ha : conservation exacte', () => {
  const parts = splitQuantite(10, GRP_1_3_2_0)
  // 10 * 1.3 / 3.3 = 3.939… → 3.939 ; la dernière part absorbe le reste.
  assert.deepStrictEqual(parts, [
    { label: 'A', quantite: 3.939 },
    { label: 'B', quantite: 6.061 },
  ])
  assert.strictEqual(parts[0].quantite + parts[1].quantite, 10)
})

test('splitQuantite — quantité non divisible (10/3) : Σ === quantité', () => {
  const parts = splitQuantite(10, GRP_TIERS)
  assert.deepStrictEqual(parts.map((p) => p.quantite), [3.333, 3.333, 3.334])
  assert.strictEqual(
    parts.reduce((s, p) => s + p.quantite, 0),
    10
  )
})

test('splitQuantite — groupe à 1 membre : passthrough de la quantité', () => {
  const parts = splitQuantite(7.5, [{ label: 'SOLO', ha: 4.2 }])
  assert.deepStrictEqual(parts, [{ label: 'SOLO', quantite: 7.5 }])
})

test('splitQuantite — quantité 0 → parts nulles, pas d\'erreur', () => {
  assert.deepStrictEqual(splitQuantite(0, GRP_S13_S14), [
    { label: 'F5- CASCADE -S13', quantite: 0 },
    { label: 'F5 -BREEZE- S14', quantite: 0 },
  ])
})

test('totalHa — membre sans Ha SB → erreur nommant la parcelle', () => {
  assert.throws(
    () => totalHa([{ label: 'A', ha: 2 }, { label: 'SANS-HA', ha: 0 }]),
    /SANS-HA/
  )
  assert.throws(() => totalHa([{ label: 'A', ha: 2 }, { label: 'B' }]), /« B »/)
})

test('totalHa — liste vide → erreur explicite', () => {
  assert.throws(() => totalHa([]), /sans membre/)
})

test('expandItems — item sans groupe_id : strictement inchangé', () => {
  const items = [{ article: 'Nitrate', quantite: 12, parcelle: 'P1', culture: 'Myrtille' }]
  const out = expandItems(items, {})
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0], items[0])
})

test('expandItems — item sur groupe : N lignes de parcelles réelles', () => {
  const groupes = {
    g1: {
      id: 'g1',
      label: 'S13/S14 BREEZE/CASCADE',
      membres: [
        { label: 'F5- CASCADE -S13', ha: 2, ref: 'R13', culture: 'Myrtille', ferme: 'F5' },
        { label: 'F5 -BREEZE- S14', ha: 1, ref: 'R14', culture: 'Myrtille', ferme: 'F5' },
      ],
    },
  }
  const out = expandItems(
    [{ article: 'Nitrate de Calcium', quantite: 30, unite: 'kg', parcelle: 'S13/S14 BREEZE/CASCADE', groupe_id: 'g1' }],
    groupes
  )
  assert.strictEqual(out.length, 2)
  assert.deepStrictEqual(out.map((i) => i.parcelle), ['F5- CASCADE -S13', 'F5 -BREEZE- S14'])
  assert.deepStrictEqual(out.map((i) => i.quantite), [20, 10])
  assert.deepStrictEqual(out.map((i) => i.parcelle_ref), ['R13', 'R14'])
  assert.strictEqual(out[0].groupe_id, 'g1')
  assert.strictEqual(out[0].groupe_label, 'S13/S14 BREEZE/CASCADE')
  assert.strictEqual(out[0].article, 'Nitrate de Calcium')
  assert.strictEqual(out[0].unite, 'kg')
})

test('expandItems — conservation de la quantité totale, lignes mixtes', () => {
  const groupes = {
    g1: { id: 'g1', label: 'G1', membres: GRP_TIERS },
  }
  const out = expandItems(
    [
      { article: 'X', quantite: 10, groupe_id: 'g1' },
      { article: 'Y', quantite: 5, parcelle: 'P9' },
    ],
    groupes
  )
  assert.strictEqual(out.length, 4)
  const totalX = out.filter((i) => i.article === 'X').reduce((s, i) => s + i.quantite, 0)
  assert.strictEqual(totalX, 10)
  assert.strictEqual(out[3].parcelle, 'P9')
})

test('expandItems — groupe inconnu → erreur explicite', () => {
  assert.throws(
    () => expandItems([{ article: 'X', quantite: 1, groupe_id: 'ghost' }], {}),
    /Groupe de parcelles inconnu ou inactif : ghost/
  )
})

test('expandItems — membre sans Ha → erreur nommant la parcelle', () => {
  const groupes = {
    g1: { id: 'g1', label: 'G1', membres: [{ label: 'A', ha: 2 }, { label: 'B', ha: 0 }] },
  }
  assert.throws(() => expandItems([{ quantite: 10, groupe_id: 'g1' }], groupes), /« B »/)
})
