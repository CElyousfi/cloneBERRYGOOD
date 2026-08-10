'use strict'
// @ts-check

const test = require('node:test')
const assert = require('node:assert')

const { slugGroupeLabel, validateGroupeSave } = require('../validate')

const HA = {
  'F5- CASCADE -S13': 2,
  'F5 -BREEZE- S14': 1,
  'F1- ROUGE -S01': 1.5,
  'F1- ROUGE -S02': 0, // Ha SB non saisi
}

const GROUPES = [
  {
    id: 'GRP-S13-S14-BREEZE-CASCADE',
    label: 'S13/S14 BREEZE/CASCADE',
    membres: ['F5- CASCADE -S13', 'F5 -BREEZE- S14'],
    actif: true,
  },
]

test('slugGroupeLabel — docId déterministe sans caractère interdit', () => {
  assert.strictEqual(slugGroupeLabel('S13/S14 BREEZE/CASCADE'), 'GRP-S13-S14-BREEZE-CASCADE')
  assert.strictEqual(slugGroupeLabel('  --- '), '')
  assert.strictEqual(slugGroupeLabel(''), '')
})

test('validateGroupeSave — cas nominal', () => {
  const v = validateGroupeSave({
    label: '  Nouveau groupe F1 ',
    membres: ['F5- CASCADE -S13 '],
    haByLabel: HA,
    groupes: [],
  })
  assert.strictEqual(v.ok, false) // 1 seul membre
  const v2 = validateGroupeSave({
    label: 'Nouveau groupe F1',
    membres: ['F5- CASCADE -S13', 'F1- ROUGE -S01'],
    haByLabel: HA,
    groupes: [],
  })
  assert.deepStrictEqual(v2, {
    ok: true,
    docId: 'GRP-NOUVEAU-GROUPE-F1',
    label: 'Nouveau groupe F1',
    membres: ['F5- CASCADE -S13', 'F1- ROUGE -S01'],
  })
})

test('validateGroupeSave — nom vide refusé', () => {
  const v = validateGroupeSave({ label: '   ', membres: ['A', 'B'], haByLabel: HA, groupes: [] })
  assert.match(v.error, /Nom du groupe requis/)
})

test('validateGroupeSave — moins de 2 membres refusé', () => {
  const v = validateGroupeSave({ label: 'G', membres: ['F5- CASCADE -S13'], haByLabel: HA, groupes: [] })
  assert.match(v.error, /au moins 2 parcelles/)
})

test('validateGroupeSave — membre en doublon refusé', () => {
  const v = validateGroupeSave({
    label: 'G',
    membres: ['F5- CASCADE -S13', 'f5- cascade -s13'],
    haByLabel: HA,
    groupes: [],
  })
  assert.match(v.error, /doublon/)
})

test('validateGroupeSave — membre sans Ha SB refusé (pas de fallback BEE ONE)', () => {
  const v = validateGroupeSave({
    label: 'G',
    membres: ['F1- ROUGE -S01', 'F1- ROUGE -S02'],
    haByLabel: HA,
    groupes: [],
  })
  assert.match(v.error, /Ha Smart Berry manquant pour « F1- ROUGE -S02 »/)
})

test('validateGroupeSave — membre inconnu du référentiel refusé', () => {
  const v = validateGroupeSave({
    label: 'G',
    membres: ['F1- ROUGE -S01', 'PARCELLE-FANTOME'],
    haByLabel: HA,
    groupes: [],
  })
  assert.match(v.error, /PARCELLE-FANTOME/)
})

test('validateGroupeSave — création sur un nom déjà pris refusée (pas d\'écrasement)', () => {
  const v = validateGroupeSave({
    label: 's13/s14 breeze/cascade', // même slug que le groupe existant
    membres: ['F1- ROUGE -S01', 'F5 -BREEZE- S14'],
    haByLabel: HA,
    groupes: GROUPES,
  })
  assert.match(v.error, /existe déjà/)
})

test('validateGroupeSave — renommer un groupe avec le nom d\'un autre refusé', () => {
  const v = validateGroupeSave({
    id: 'GRP-AUTRE',
    label: 'S13/S14 BREEZE/CASCADE',
    membres: ['F1- ROUGE -S01', 'F5- CASCADE -S13'],
    haByLabel: HA,
    groupes: GROUPES,
  })
  assert.match(v.error, /existe déjà/)
})

test('validateGroupeSave — appartenance exclusive : membre déjà dans un autre groupe', () => {
  const v = validateGroupeSave({
    label: 'Autre groupe',
    membres: ['F5- CASCADE -S13', 'F1- ROUGE -S01'],
    haByLabel: HA,
    groupes: GROUPES,
  })
  assert.match(v.error, /« F5- CASCADE -S13 » appartient déjà au groupe « S13\/S14 BREEZE\/CASCADE »/)
})

test('validateGroupeSave — groupe INACTIF ne bloque pas (soft delete)', () => {
  const v = validateGroupeSave({
    label: 'Autre groupe',
    membres: ['F5- CASCADE -S13', 'F1- ROUGE -S01'],
    haByLabel: HA,
    groupes: [Object.assign({}, GROUPES[0], { actif: false })],
  })
  assert.strictEqual(v.ok, true)
})

test('validateGroupeSave — édition du même groupe : pas d\'auto-conflit', () => {
  const v = validateGroupeSave({
    id: 'GRP-S13-S14-BREEZE-CASCADE',
    label: 'S13/S14 BREEZE/CASCADE',
    membres: ['F5- CASCADE -S13', 'F5 -BREEZE- S14', 'F1- ROUGE -S01'],
    haByLabel: HA,
    groupes: GROUPES,
  })
  assert.strictEqual(v.ok, true)
  assert.strictEqual(v.docId, 'GRP-S13-S14-BREEZE-CASCADE')
})

test('validateGroupeSave — pas de limite sur le nombre de groupes', () => {
  const many = []
  for (let i = 0; i < 50; i++) {
    many.push({ id: 'GRP-' + i, label: 'G' + i, membres: ['X' + i, 'Y' + i], actif: true })
  }
  const v = validateGroupeSave({
    label: 'Encore un',
    membres: ['F5- CASCADE -S13', 'F1- ROUGE -S01'],
    haByLabel: HA,
    groupes: many,
  })
  assert.strictEqual(v.ok, true)
})
