const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRecommendations } = require('../recommendations');
const { getThresholds } = require('../thresholds');

function summary(overrides) {
  return {
    date: '2026-05-01',
    parcelle: 'P1',
    ferme: 'F5',
    parcelleLabel: 'X',
    totalInputMl: 600,
    totalDrainMl: 120,
    totalDrainPct: 20,
    avgEcPts: 1.8,
    avgEcDrain: 1.95,
    avgPhPts: 6.0,
    avgPhDrain: 5.8,
    pulseCount: 5,
    highDrainPulseCount: 0,
    lowDrainPulseCount: 0,
    irrigationCutoffTime: '13:30',
    diagnosis: 'optimal',
    diagnosisReasons: [],
    pulses: [],
    ...overrides,
  };
}

test('REDUCE_NEXT_PULSE_HARD beats REDUCE_NEXT_PULSE on critical drain', () => {
  const recos = buildRecommendations(summary({
    totalDrainPct: 38,
    highDrainPulseCount: 4,
  }));
  const codes = recos.map(r => r.code);
  assert.ok(codes.includes('REDUCE_NEXT_PULSE_HARD'));
  assert.ok(!codes.includes('REDUCE_NEXT_PULSE'),
    'soft reduce should not co-exist with hard reduce');
  assert.equal(recos[0].level, 'critical', 'critical reco sorted first');
});

test('INCREASE_INPUT fires when low-drain pulses repeated', () => {
  const recos = buildRecommendations(summary({
    totalDrainPct: 8,
    lowDrainPulseCount: 3,
  }));
  assert.ok(recos.map(r => r.code).includes('INCREASE_INPUT'));
});

test('SALT_ACCUMULATION_RISK requires both ΔEC>0.4 AND drain<targetMax', () => {
  // High delta, normal drainage → no salt risk
  const recosNormal = buildRecommendations(summary({
    totalDrainPct: 26,
    avgEcPts: 1.8,
    avgEcDrain: 2.5,
  }));
  assert.ok(!recosNormal.map(r => r.code).includes('SALT_ACCUMULATION_RISK'));

  // High delta, low drainage → salt risk
  const recosRisk = buildRecommendations(summary({
    totalDrainPct: 12,
    avgEcPts: 1.8,
    avgEcDrain: 2.5,
    lowDrainPulseCount: 3,
  }));
  assert.ok(recosRisk.map(r => r.code).includes('SALT_ACCUMULATION_RISK'));
});

test('STOP_EARLIER fires when any late-day pulse has high drain', () => {
  const recos = buildRecommendations(summary({
    pulses: [
      { isLateDayPulse: true, isHighDrain: true },
      { isLateDayPulse: false, isHighDrain: false },
    ],
  }));
  assert.ok(recos.map(r => r.code).includes('STOP_EARLIER'));
});

test('PH_DRAIN_HIGH / PH_DRAIN_LOW respect thresholds and override', () => {
  const recosHigh = buildRecommendations(summary({ avgPhDrain: 7.0 }));
  assert.ok(recosHigh.map(r => r.code).includes('PH_DRAIN_HIGH'));

  const recosLow = buildRecommendations(summary({ avgPhDrain: 4.5 }));
  assert.ok(recosLow.map(r => r.code).includes('PH_DRAIN_LOW'));

  // Override threshold: phMax=7.5 -> 7.0 should NOT trigger
  const overridden = buildRecommendations(summary({ avgPhDrain: 7.0 }), getThresholds({ phMax: 7.5 }));
  assert.ok(!overridden.map(r => r.code).includes('PH_DRAIN_HIGH'));
});

test('OPTIMAL fallback only when nothing else fires', () => {
  const recos = buildRecommendations(summary());
  assert.equal(recos.length, 1);
  assert.equal(recos[0].code, 'OPTIMAL');
});

test('null / undefined / empty summary does not crash', () => {
  assert.deepEqual(buildRecommendations(null), []);
  assert.deepEqual(buildRecommendations(undefined), []);
  // Empty summary: no pulses → no OPTIMAL reco either
  const out = buildRecommendations({});
  assert.ok(Array.isArray(out));
});

test('recommendations sorted by severity', () => {
  const recos = buildRecommendations(summary({
    totalDrainPct: 38,
    highDrainPulseCount: 3,
    avgPhDrain: 7.0,
    pulses: [{ isLateDayPulse: true, isHighDrain: true }],
  }));
  const levels = recos.map(r => r.level);
  for (let i = 1; i < levels.length; i++) {
    const order = { critical: 0, warning: 1, info: 2, ok: 3 };
    assert.ok(order[levels[i - 1]] <= order[levels[i]],
      `out of order: ${levels.join(',')}`);
  }
});
