const test = require('node:test');
const assert = require('node:assert/strict');

const { getIrrigationRecipe } = require('../irrigationRecipe');
const { MARAVILLA_PRIMOCANE, MARAVILLA_FLORICANE, JASMIN_PRIMOCANE } = require('./fixtures');

test('recipe #1: (S4, maravilla_primo) → EC 2.0-2.2, pH 5.5-5.7, drainage 30%', () => {
  const r = getIrrigationRecipe('S4', MARAVILLA_PRIMOCANE);
  assert.equal(r.ec_min, 2.0);
  assert.equal(r.ec_max, 2.2);
  assert.equal(r.ph_min, 5.5);
  assert.equal(r.ph_max, 5.7);
  assert.equal(r.drainage_pct_target, 30);
  assert.equal(r.drainage_pct_min, 28);
  assert.equal(r.drainage_pct_max, 33);
});

test('recipe #2: (F3, maravilla_floricane) → equivalent S4 (same EC/pH/drainage)', () => {
  const f3 = getIrrigationRecipe('F3', MARAVILLA_FLORICANE);
  const s4 = getIrrigationRecipe('S4', MARAVILLA_PRIMOCANE);
  // Per phenology-tables.md §6.1, F3 = floraison floricane uses same recipe as S4 floraison primocane
  assert.equal(f3.ec_min, s4.ec_min);
  assert.equal(f3.ec_max, s4.ec_max);
  assert.equal(f3.ph_min, s4.ph_min);
  assert.equal(f3.ph_max, s4.ph_max);
  assert.equal(f3.drainage_pct_target, s4.drainage_pct_target);
});

test('recipe #3: (S4, jasmin_primo) → same EC/pH (Driscoll varieties share irrigation params)', () => {
  const jas = getIrrigationRecipe('S4', JASMIN_PRIMOCANE);
  const mar = getIrrigationRecipe('S4', MARAVILLA_PRIMOCANE);
  // phenology-tables.md §4: "Les paramètres irrigation restent identiques entre variétés Driscoll's"
  assert.deepEqual({ ...jas }, { ...mar });
});

test('recipe #4: (S0) → reprise (EC 1.2-1.4, drainage 12%)', () => {
  const r = getIrrigationRecipe('S0', MARAVILLA_PRIMOCANE);
  assert.equal(r.ec_min, 1.2);
  assert.equal(r.ec_max, 1.4);
  assert.equal(r.drainage_pct_target, 12);
  assert.equal(r.drainage_pct_min, 10);
});

test('recipe #5: (S8) → sevrage (EC 1.6-1.8, drainage 22%)', () => {
  const r = getIrrigationRecipe('S8', MARAVILLA_PRIMOCANE);
  assert.equal(r.ec_min, 1.6);
  assert.equal(r.ec_max, 1.8);
  assert.equal(r.drainage_pct_target, 22);
});

test('recipe #6: unknown stageCode → throws RangeError with known stages list', () => {
  assert.throws(
    () => getIrrigationRecipe('S99', MARAVILLA_PRIMOCANE),
    /stage "S99" not found/
  );
  // Cross-cycle confusion: F3 is invalid on a primocane reference
  assert.throws(
    () => getIrrigationRecipe('F3', MARAVILLA_PRIMOCANE),
    /stage "F3" not found/
  );
});

test('recipe #7: reference with no stages or invalid → throws', () => {
  assert.throws(() => getIrrigationRecipe('S4', null), TypeError);
  assert.throws(() => getIrrigationRecipe('S4', {}), TypeError);
  assert.throws(() => getIrrigationRecipe('S4', { stages: [] }), RangeError);
  // Stage exists but has no irrigation
  const bad = { stages: [{ code: 'S4' }] };
  assert.throws(() => getIrrigationRecipe('S4', bad), /no irrigation recipe/);
});

test('recipe #8: returned object is frozen (immutable)', () => {
  'use strict';
  const r = getIrrigationRecipe('S4', MARAVILLA_PRIMOCANE);
  assert.equal(Object.isFrozen(r), true);
  // In strict mode mutating a frozen object throws. We test the *outcome*
  // (no mutation) rather than the throw, which is more robust across modes.
  try { r.ec_min = 99; } catch (_) { /* ignore */ }
  assert.equal(r.ec_min, 2.0, 'frozen object value must not change after assignment attempt');
  // Original reference must NOT be affected (shallow copy guarantee)
  assert.equal(MARAVILLA_PRIMOCANE.stages.find((s) => s.code === 'S4').irrigation.ec_min, 2.0);
});

test('recipe: empty stageCode or non-string → throws TypeError', () => {
  assert.throws(() => getIrrigationRecipe('', MARAVILLA_PRIMOCANE), TypeError);
  assert.throws(() => getIrrigationRecipe(null, MARAVILLA_PRIMOCANE), TypeError);
  assert.throws(() => getIrrigationRecipe(42, MARAVILLA_PRIMOCANE), TypeError);
});
