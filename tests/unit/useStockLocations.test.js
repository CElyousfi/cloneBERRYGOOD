'use strict';

/**
 * Unit tests for src/modules/shared/lib/useStockLocations.js — pure derivation only
 * (deriveStockLocations). Le hook React lui-même n'est pas testable sans DOM ;
 * la logique de fallback / dérivation, si.
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveStockLocations, USL_FALLBACK_MAGASINS } = require('./_esm').loadEsm('src/modules/shared/lib/useStockLocations.js');

test('locations null (pas encore reçu) → fallback magasins F1/F2/F5/F6, loading vrai', () => {
  const r = deriveStockLocations(null, true);
  assert.deepEqual(r.magasins, ['F1', 'F2', 'F5', 'F6']);
  assert.deepEqual(r.magasins, USL_FALLBACK_MAGASINS);
  assert.deepEqual(r.stations, []);
  assert.deepEqual(r.parcelles, {});
  assert.equal(r.loading, true);
});

test('config avec 6 magasins (F1..F6) → expose F3 ET F4', () => {
  const r = deriveStockLocations({ magasins: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] }, false);
  assert.deepEqual(r.magasins, ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
  assert.equal(r.magasins.includes('F3'), true);
  assert.equal(r.magasins.includes('F4'), true);
  assert.equal(r.loading, false);
});

test('magasins vide → retombe sur le fallback (jamais une liste vide)', () => {
  const r = deriveStockLocations({ magasins: [] }, false);
  assert.deepEqual(r.magasins, ['F1', 'F2', 'F5', 'F6']);
});

test('stations et parcelles transmises telles quelles', () => {
  const r = deriveStockLocations(
    { magasins: ['F1'], stations: ['Station F1'], parcelles: { F1: ['S1'] } },
    false
  );
  assert.deepEqual(r.stations, ['Station F1']);
  assert.deepEqual(r.parcelles, { F1: ['S1'] });
});

test('parcelles invalide (tableau) → objet vide', () => {
  const r = deriveStockLocations({ magasins: ['F1'], parcelles: ['x'] }, false);
  assert.deepEqual(r.parcelles, {});
});
