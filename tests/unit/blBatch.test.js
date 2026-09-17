'use strict';

/**
 * Unit tests for functions/lib/bdc/blBatch.js.
 * Run with: npm run test:unit
 *
 * Le module porte le chargement PAR LOTS des BL du tool
 * `get_bdc_non_receptionnes` (functions/src/modules/admin/dgAgent.js). Ce qui est testé ici :
 * le découpage respecte la limite dure Firestore (30 valeurs par clause `in`)
 * et le regroupement reproduit à l'identique l'ancienne boucle « une requête
 * par BdC » — chaque BdC demandé reçoit ses BL, un BdC sans BL reçoit un
 * tableau vide, un BL soft-deleted ne compte nulle part.
 * Aucun accès Firestore ici : ids et BL injectés.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { IN_MAX_VALUES, chunkIds, groupBlsByBdcId } = require('../../functions/lib/bdc/blBatch.js');

/** @param {number} n @returns {Array<string>} ids synthétiques bdc-1..bdc-n */
function ids(n) {
  return Array.from({ length: n }, (_, i) => `bdc-${i + 1}`);
}

// ============================================================================
// IN_MAX_VALUES — limite dure Firestore, pas un réglage
// ============================================================================

test('IN_MAX_VALUES vaut 30 (limite dure de la clause Firestore `in`)', () => {
  assert.equal(IN_MAX_VALUES, 30);
});

// ============================================================================
// chunkIds
// ============================================================================

test('chunkIds: 0 id → aucun lot (donc aucune requête, `in` avec [] lève)', () => {
  assert.deepEqual(chunkIds([]), []);
  assert.deepEqual(chunkIds(undefined), []);
});

test('chunkIds: 1 id → un seul lot d\'un id', () => {
  assert.deepEqual(chunkIds(['bdc-1']), [['bdc-1']]);
});

test('chunkIds: exactement 30 ids → un seul lot plein, pas de lot vide en trop', () => {
  const chunks = chunkIds(ids(30));
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 30);
});

test('chunkIds: 31 ids → deux lots (30 + 1), aucun lot au-dessus de la limite', () => {
  const chunks = chunkIds(ids(31));
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, 30);
  assert.deepEqual(chunks[1], ['bdc-31']);
  for (const c of chunks) assert.ok(c.length <= IN_MAX_VALUES);
});

test('chunkIds: 283 ids (volume prod mesuré) → 10 lots, tous les ids une seule fois', () => {
  const source = ids(283);
  const chunks = chunkIds(source);
  assert.equal(chunks.length, 10);
  assert.deepEqual(chunks.flat(), source);
  for (const c of chunks) assert.ok(c.length <= IN_MAX_VALUES);
});

test('chunkIds: taille explicite respectée', () => {
  assert.deepEqual(chunkIds(['a', 'b', 'c'], 2), [['a', 'b'], ['c']]);
});

// ============================================================================
// groupBlsByBdcId
// ============================================================================

test('groupBlsByBdcId: chaque BdC demandé reçoit ses propres BL', () => {
  const table = groupBlsByBdcId(['bdc-1', 'bdc-2'], [
    { bdc_id: 'bdc-1', numero: 'BL-1' },
    { bdc_id: 'bdc-2', numero: 'BL-2' },
    { bdc_id: 'bdc-1', numero: 'BL-3' },
  ]);
  assert.deepEqual(table['bdc-1'].map(b => b.numero), ['BL-1', 'BL-3']);
  assert.deepEqual(table['bdc-2'].map(b => b.numero), ['BL-2']);
});

test('groupBlsByBdcId: BdC sans BL → tableau vide, jamais undefined', () => {
  const table = groupBlsByBdcId(['bdc-1', 'bdc-2'], [{ bdc_id: 'bdc-1', numero: 'BL-1' }]);
  assert.deepEqual(table['bdc-2'], []);
  assert.ok(Object.prototype.hasOwnProperty.call(table, 'bdc-2'));
});

test('groupBlsByBdcId: BL soft-deleted exclu (il masquerait un BdC non réceptionné)', () => {
  const table = groupBlsByBdcId(['bdc-1'], [
    { bdc_id: 'bdc-1', numero: 'BL-1' },
    { bdc_id: 'bdc-1', numero: 'BL-2', deleted: true },
  ]);
  assert.deepEqual(table['bdc-1'].map(b => b.numero), ['BL-1']);
});

test('groupBlsByBdcId: BL sans champ `deleted` = BL vivant (le champ n\'est posé qu\'à la suppression)', () => {
  const table = groupBlsByBdcId(['bdc-1'], [{ bdc_id: 'bdc-1', numero: 'BL-1' }]);
  assert.equal(table['bdc-1'].length, 1);
});

test('groupBlsByBdcId: BL d\'un BdC non demandé ignoré, jamais rattaché ailleurs', () => {
  const table = groupBlsByBdcId(['bdc-1'], [
    { bdc_id: 'bdc-9', numero: 'BL-X' },
    { bdc_id: 'bdc-1', numero: 'BL-1' },
  ]);
  assert.deepEqual(Object.keys(table), ['bdc-1']);
  assert.deepEqual(table['bdc-1'].map(b => b.numero), ['BL-1']);
});

test('groupBlsByBdcId: BL sans bdc_id ignoré', () => {
  const table = groupBlsByBdcId(['bdc-1'], [{ numero: 'BL-orphelin' }, null]);
  assert.deepEqual(table['bdc-1'], []);
});

test('groupBlsByBdcId: 0 id → table vide', () => {
  assert.deepEqual(groupBlsByBdcId([], [{ bdc_id: 'bdc-1' }]), {});
});
