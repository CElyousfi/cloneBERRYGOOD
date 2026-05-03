const test = require('node:test');
const assert = require('node:assert/strict');

// AJ1 — verify the barrel exposes every public API of the phenology module.
// If a new function is added to a sub-module, it MUST be re-exported by the
// barrel and added to the EXPECTED list below.

const phenology = require('../index.js');

const EXPECTED_FUNCTIONS = [
  'calculateDailyGdd',
  'calculateDailyRadsum',
  'estimateMissingRadiation',
  'evaluateDliVsTarget',
  'resolveStage',
  'getIrrigationRecipe',
];

test('barrel: all expected public functions are exposed', () => {
  for (const name of EXPECTED_FUNCTIONS) {
    assert.equal(typeof phenology[name], 'function', `barrel missing function "${name}"`);
  }
});

test('barrel: no extra unexpected exports (catch silent additions)', () => {
  const exported = Object.keys(phenology);
  const unexpected = exported.filter((k) => !EXPECTED_FUNCTIONS.includes(k));
  assert.deepEqual(
    unexpected,
    [],
    `unexpected barrel exports: ${unexpected.join(', ')} — update EXPECTED_FUNCTIONS or remove`
  );
});

test('barrel: smoke test end-to-end pipeline (gdd → resolveStage → getIrrigationRecipe)', () => {
  const { MARAVILLA_FLORICANE } = require('./fixtures');

  // Day 1: T_min=12, T_max=28 → GDD = 15
  const day = phenology.calculateDailyGdd({ tMin: 12, tMax: 28, tBase: 5, tCap: 30 });
  assert.equal(day.gddDay, 15);

  // After 50 days at 15 GDD/day → cumul ~750 → F3 (Floraison floricane, gddMin 700)
  const cumul = day.gddDay * 50;
  const stage = phenology.resolveStage(cumul, MARAVILLA_FLORICANE);
  assert.equal(stage.code, 'F3');
  assert.equal(stage.criticalStage, true);

  // Recipe for F3
  const recipe = phenology.getIrrigationRecipe(stage.code, MARAVILLA_FLORICANE);
  assert.equal(recipe.ec_min, 2.0);
  assert.equal(recipe.ec_max, 2.2);
  assert.equal(Object.isFrozen(recipe), true);
});
