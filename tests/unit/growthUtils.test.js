'use strict';

/**
 * Unit tests for public/lib/growthUtils.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../public/lib/growthUtils.js');

// Minimal fixture mirroring the real PARCELLES_CULTURALES shape.
const PARCELLES = [
  { id: 'C1-S7S3-MOTTE', variete: 'Maravilla', sousVariete: 'Long Cane', ferme: 'F1', culture: 'Framboise' },
  { id: 'C1-S2S5-MOW', variete: 'Yazmin', sousVariete: 'Mow Down', ferme: 'F1', culture: 'Framboise' },
  { id: 'C1-S9-REY', variete: 'Reyna', sousVariete: null, ferme: 'F5', culture: 'Framboise' },
  { id: 'C1-S8-COR', variete: 'Corina', sousVariete: null, ferme: 'F5', culture: 'Myrtille' },
  { id: 'AVO-F2', variete: 'Avocat', sousVariete: null, ferme: 'F2', culture: 'Avocatier' },
];

// ---------------------------------------------------------------------------
// framboiseParcelles
// ---------------------------------------------------------------------------

test('framboiseParcelles excludes non-framboise cultures', () => {
  const out = G.framboiseParcelles(PARCELLES);
  assert.equal(out.length, 3);
  const ids = out.map(p => p.id);
  assert.ok(!ids.includes('C1-S8-COR')); // Myrtille excluded
  assert.ok(!ids.includes('AVO-F2'));    // Avocatier excluded
});

test('framboiseParcelles normalizes entries with readable label', () => {
  const out = G.framboiseParcelles(PARCELLES);
  const mara = out.find(p => p.id === 'C1-S7S3-MOTTE');
  assert.equal(mara.label, 'Maravilla Long Cane F1');
  assert.equal(mara.variete, 'Maravilla');
  assert.equal(mara.sousVariete, 'Long Cane');
  assert.equal(mara.ferme, 'F1');
});

test('framboiseParcelles label falls back when no variete (uses id)', () => {
  const out = G.framboiseParcelles([{ id: 'X1', culture: 'Framboise' }]);
  assert.equal(out[0].label, 'X1');
});

test('framboiseParcelles filters by variété when provided', () => {
  const out = G.framboiseParcelles(PARCELLES, 'Yazmin');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'C1-S2S5-MOW');
});

test('framboiseParcelles ignores filter when value is Toutes', () => {
  const out = G.framboiseParcelles(PARCELLES, 'Toutes');
  assert.equal(out.length, 3);
});

test('framboiseParcelles sorts by variété then label', () => {
  const out = G.framboiseParcelles(PARCELLES);
  assert.deepEqual(out.map(p => p.variete), ['Maravilla', 'Reyna', 'Yazmin']);
});

test('framboiseParcelles handles non-array input', () => {
  assert.deepEqual(G.framboiseParcelles(null), []);
  assert.deepEqual(G.framboiseParcelles(undefined), []);
});

// ---------------------------------------------------------------------------
// varietesFramboise
// ---------------------------------------------------------------------------

test('varietesFramboise returns distinct sorted framboise varieties only', () => {
  const out = G.varietesFramboise(PARCELLES);
  assert.deepEqual(out, ['Maravilla', 'Reyna', 'Yazmin']);
  assert.ok(!out.includes('Corina')); // Myrtille
  assert.ok(!out.includes('Avocat')); // Avocatier
});

test('varietesFramboise dedupes repeated varieties', () => {
  const dup = PARCELLES.concat([{ id: 'C2', variete: 'Maravilla', culture: 'Framboise' }]);
  const out = G.varietesFramboise(dup);
  assert.equal(out.filter(v => v === 'Maravilla').length, 1);
});

// ---------------------------------------------------------------------------
// normalizeCheckpoints
// ---------------------------------------------------------------------------

test('normalizeCheckpoints trims, drops empties, dedupes keeping order', () => {
  const out = G.normalizeCheckpoints([' Entrée ', 'Milieu', 'Entrée', '', '   ', 'Fond']);
  assert.deepEqual(out, ['Entrée', 'Milieu', 'Fond']);
});

test('normalizeCheckpoints handles non-array input', () => {
  assert.deepEqual(G.normalizeCheckpoints(null), []);
});

// ---------------------------------------------------------------------------
// buildGrowthSeries
// ---------------------------------------------------------------------------

test('buildGrowthSeries pivots multi-point multi-date sorted by date asc', () => {
  const meas = [
    { date: '2026-06-05', checkpoint: 'Entrée', length_cm: 50, created_at: 1 },
    { date: '2026-06-01', checkpoint: 'Entrée', length_cm: 30, created_at: 1 },
    { date: '2026-06-01', checkpoint: 'Fond', length_cm: 35, created_at: 1 },
    { date: '2026-06-05', checkpoint: 'Fond', length_cm: 55, created_at: 1 },
  ];
  const { rows, dataKeys } = G.buildGrowthSeries(meas, ['Entrée', 'Fond']);
  assert.deepEqual(rows.map(r => r.date), ['2026-06-01', '2026-06-05']);
  assert.equal(rows[0]['Entrée'], 30);
  assert.equal(rows[0]['Fond'], 35);
  assert.equal(rows[1]['Entrée'], 50);
  assert.equal(rows[1]['Fond'], 55);
  assert.deepEqual(dataKeys, ['Entrée', 'Fond']);
});

test('buildGrowthSeries duplicate date+checkpoint keeps most recent created_at', () => {
  const meas = [
    { date: '2026-06-01', checkpoint: 'Entrée', length_cm: 30, created_at: 100 },
    { date: '2026-06-01', checkpoint: 'Entrée', length_cm: 99, created_at: 200 },
  ];
  const { rows } = G.buildGrowthSeries(meas, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]['Entrée'], 99);
});

test('buildGrowthSeries ignores rows without valid date or length', () => {
  const meas = [
    { date: 'bad', checkpoint: 'Entrée', length_cm: 30, created_at: 1 },
    { date: '2026-06-01', checkpoint: 'Entrée', length_cm: -5, created_at: 1 },
    { date: '2026-06-01', checkpoint: 'Entrée', length_cm: 'abc', created_at: 1 },
    { date: '2026-06-01', checkpoint: '', length_cm: 30, created_at: 1 },
    { date: '2026-06-02', checkpoint: 'Entrée', length_cm: 40, created_at: 1 },
  ];
  const { rows } = G.buildGrowthSeries(meas, []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-06-02');
});

test('buildGrowthSeries empty input yields empty series', () => {
  const out = G.buildGrowthSeries([], []);
  assert.deepEqual(out.rows, []);
  assert.deepEqual(out.dataKeys, []);
  assert.deepEqual(G.buildGrowthSeries(null).rows, []);
});

test('buildGrowthSeries dataKeys prefers configured order then extras', () => {
  const meas = [
    { date: '2026-06-01', checkpoint: 'ExtraPoint', length_cm: 10, created_at: 1 },
    { date: '2026-06-01', checkpoint: 'Fond', length_cm: 20, created_at: 1 },
    { date: '2026-06-01', checkpoint: 'Entrée', length_cm: 30, created_at: 1 },
  ];
  const { dataKeys } = G.buildGrowthSeries(meas, ['Entrée', 'Fond']);
  assert.deepEqual(dataKeys, ['Entrée', 'Fond', 'ExtraPoint']);
});

// ---------------------------------------------------------------------------
// validateMeasurement
// ---------------------------------------------------------------------------

const VALID = { parcelle_id: 'C1-S7S3-MOTTE', checkpoint: 'Entrée', date: '2026-06-01', length_cm: 42 };

test('validateMeasurement accepts a valid payload', () => {
  assert.deepEqual(G.validateMeasurement(VALID), { valid: true });
});

test('validateMeasurement accepts numeric string length', () => {
  assert.deepEqual(G.validateMeasurement({ ...VALID, length_cm: '42.5' }), { valid: true });
});

test('validateMeasurement rejects missing parcelle', () => {
  const r = G.validateMeasurement({ ...VALID, parcelle_id: '' });
  assert.equal(r.valid, false);
  assert.match(r.error, /Parcelle/);
});

test('validateMeasurement rejects missing checkpoint', () => {
  const r = G.validateMeasurement({ ...VALID, checkpoint: '  ' });
  assert.equal(r.valid, false);
  assert.match(r.error, /Point de contrôle/);
});

test('validateMeasurement rejects bad date format', () => {
  const r = G.validateMeasurement({ ...VALID, date: '01/06/2026' });
  assert.equal(r.valid, false);
  assert.match(r.error, /Date/);
});

test('validateMeasurement rejects non-positive / non-finite length', () => {
  assert.equal(G.validateMeasurement({ ...VALID, length_cm: 0 }).valid, false);
  assert.equal(G.validateMeasurement({ ...VALID, length_cm: -3 }).valid, false);
  assert.equal(G.validateMeasurement({ ...VALID, length_cm: 'x' }).valid, false);
});

test('validateMeasurement rejects length >= 1000', () => {
  const r = G.validateMeasurement({ ...VALID, length_cm: 1000 });
  assert.equal(r.valid, false);
  assert.match(r.error, /trop grande/);
});

test('validateMeasurement handles undefined input', () => {
  assert.equal(G.validateMeasurement(undefined).valid, false);
});
