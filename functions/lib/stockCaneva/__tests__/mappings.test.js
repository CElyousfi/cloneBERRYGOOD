'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildLieu, normalizeFerme } = require('../mappings')

test('buildLieu: BAHIA (et EL BAHIA) est un MAGASIN, pas un externe', () => {
  // Régression sb/magasin-bahia : classé 'externe' à l'import, le stock BAHIA
  // n'apparaissait dans aucun dropdown de destination.
  assert.deepEqual(buildLieu('EL BAHIA'), { type: 'magasin', id: 'BAHIA' })
  assert.deepEqual(buildLieu('BAHIA'), { type: 'magasin', id: 'BAHIA' })
  assert.deepEqual(buildLieu('  el bahia '), { type: 'magasin', id: 'BAHIA' })
})

test('buildLieu: fermes F-0N normalisées en magasin FN', () => {
  assert.deepEqual(buildLieu('F-01'), { type: 'magasin', id: 'F1' })
  assert.deepEqual(buildLieu('F-1'), { type: 'magasin', id: 'F1' })
  assert.deepEqual(buildLieu('F6'), { type: 'magasin', id: 'F6' })
})

test('buildLieu: tout le reste reste une parcelle (libellé brut conservé)', () => {
  assert.deepEqual(buildLieu('S3 MARAVILLA MOTTE F1'), { type: 'parcelle', id: 'S3 MARAVILLA MOTTE F1' })
  assert.deepEqual(buildLieu(' S9 REYNA F5 '), { type: 'parcelle', id: 'S9 REYNA F5' })
})

test('buildLieu: valeur vide → null', () => {
  assert.equal(buildLieu(''), null)
  assert.equal(buildLieu(null), null)
  assert.equal(buildLieu(undefined), null)
})

test('normalizeFerme: EL BAHIA → BAHIA, F-0N → FN', () => {
  assert.equal(normalizeFerme('EL BAHIA'), 'BAHIA')
  assert.equal(normalizeFerme('F-05'), 'F5')
  assert.equal(normalizeFerme(''), '')
})
