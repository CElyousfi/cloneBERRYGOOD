const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStage } = require('../stageResolver');
const { MARAVILLA_PRIMOCANE, MARAVILLA_FLORICANE, JASMIN_PRIMOCANE } = require('./fixtures');

test('stage #1: gddCumul=0 (Maravilla primo) → S0', () => {
  const s = resolveStage(0, MARAVILLA_PRIMOCANE);
  assert.equal(s.code, 'S0');
});

test('stage #2: gddCumul=149 (just below S1=150) → S0', () => {
  const s = resolveStage(149, MARAVILLA_PRIMOCANE);
  assert.equal(s.code, 'S0');
});

test('stage #3: gddCumul=150 (exact threshold, inclusive) → S1', () => {
  const s = resolveStage(150, MARAVILLA_PRIMOCANE);
  assert.equal(s.code, 'S1');
});

test('stage #4: gddCumul=2500 (in S7 [2000-3500]) → S7', () => {
  const s = resolveStage(2500, MARAVILLA_PRIMOCANE);
  assert.equal(s.code, 'S7');
});

test('stage #5: gddCumul=10000 (beyond S8 lower bound) → S8 (end-of-cycle)', () => {
  const s = resolveStage(10000, MARAVILLA_PRIMOCANE);
  assert.equal(s.code, 'S8');
});

test('stage #6: precocityCoefficient=0.92 (Jasmin) → S1 reached at 138 GDD (instead of 150)', () => {
  // 150 × 0.92 = 138
  // The fixture JASMIN_PRIMOCANE has its own precocityCoefficient=0.92, no need to override.
  const sBefore = resolveStage(137.99, JASMIN_PRIMOCANE);
  assert.equal(sBefore.code, 'S0');
  const sAt = resolveStage(138, JASMIN_PRIMOCANE);
  assert.equal(sAt.code, 'S1');
  // Compared to Maravilla at 138 GDD → still S0
  const sMar = resolveStage(138, MARAVILLA_PRIMOCANE);
  assert.equal(sMar.code, 'S0');
});

test('stage #6b: explicit precocityCoefficient option overrides reference value', () => {
  // Use Maravilla reference (coef=1.0) but force coef=0.92 via options
  const s = resolveStage(138, MARAVILLA_PRIMOCANE, { precocityCoefficient: 0.92 });
  assert.equal(s.code, 'S1', 'option should override reference precocityCoefficient');
});

test('stage #7: customStageThresholds={S1:145} → priority over ref+coef (NOT multiplied by coef)', () => {
  // With override S1=145 (absolute), even on Jasmin (coef 0.92), S1 is reached at 145, not 138.
  const sBefore = resolveStage(144.99, JASMIN_PRIMOCANE, { customStageThresholds: { S1: 145 } });
  assert.equal(sBefore.code, 'S0');
  const sAt = resolveStage(145, JASMIN_PRIMOCANE, { customStageThresholds: { S1: 145 } });
  assert.equal(sAt.code, 'S1');
  // And Maravilla without override at gddCumul=145 → still S0 (since S1 normally at 150)
  const sMarNoOverride = resolveStage(145, MARAVILLA_PRIMOCANE);
  assert.equal(sMarNoOverride.code, 'S0');
});

test('stage #8: invalid reference → throws RangeError', () => {
  assert.throws(() => resolveStage(0, null), RangeError);
  assert.throws(() => resolveStage(0, {}), RangeError);
  assert.throws(() => resolveStage(0, { stages: [] }), RangeError);
  assert.throws(() => resolveStage(0, { stages: 'not array' }), RangeError);
});

test('stage #9: floricane cycle → returns F0-F7 codes', () => {
  assert.equal(resolveStage(0, MARAVILLA_FLORICANE).code, 'F0');
  assert.equal(resolveStage(150, MARAVILLA_FLORICANE).code, 'F1');
  assert.equal(resolveStage(700, MARAVILLA_FLORICANE).code, 'F3');
  assert.equal(resolveStage(700, MARAVILLA_FLORICANE).criticalStage, true, 'F3 is critical (floraison)');
  assert.equal(resolveStage(5000, MARAVILLA_FLORICANE).code, 'F7');
});

test('stage #10: precocityCoefficient defaults to reference value when option omitted', () => {
  // Maravilla reference precocityCoefficient = 1.0 → at 150 we cross to S1
  assert.equal(resolveStage(150, MARAVILLA_PRIMOCANE).code, 'S1');
  // Jasmin reference precocityCoefficient = 0.92 → at 138 we cross to S1
  assert.equal(resolveStage(138, JASMIN_PRIMOCANE).code, 'S1');
});

test('stage: gddCumul < 0 → throws RangeError', () => {
  assert.throws(() => resolveStage(-1, MARAVILLA_PRIMOCANE), RangeError);
});

test('stage: gddCumul = NaN → throws TypeError', () => {
  assert.throws(() => resolveStage(NaN, MARAVILLA_PRIMOCANE), TypeError);
  assert.throws(() => resolveStage('100', MARAVILLA_PRIMOCANE), TypeError);
  assert.throws(() => resolveStage(undefined, MARAVILLA_PRIMOCANE), TypeError);
});

test('stage: invalid precocityCoefficient → throws RangeError', () => {
  assert.throws(() => resolveStage(100, MARAVILLA_PRIMOCANE, { precocityCoefficient: 0 }), RangeError);
  assert.throws(() => resolveStage(100, MARAVILLA_PRIMOCANE, { precocityCoefficient: -0.5 }), RangeError);
  assert.throws(() => resolveStage(100, MARAVILLA_PRIMOCANE, { precocityCoefficient: NaN }), RangeError);
});

test('stage: invalid customStageThresholds value → throws RangeError', () => {
  assert.throws(() => resolveStage(100, MARAVILLA_PRIMOCANE, { customStageThresholds: { S1: 'abc' } }), RangeError);
  assert.throws(() => resolveStage(100, MARAVILLA_PRIMOCANE, { customStageThresholds: { S1: -10 } }), RangeError);
});
