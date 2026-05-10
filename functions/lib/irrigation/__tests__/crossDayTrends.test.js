const test = require('node:test');
const assert = require('node:assert/strict');

const {
  detectCrossDayTrends,
  buildPeriodRecommendations,
  dayDiff,
  longestConsecutiveStreak,
  stddev,
  regressByDay,
  DEFAULT_THRESHOLDS,
  getThresholds,
} = require('..');

function summary(date, overrides) {
  return {
    date,
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
    drainTrend: null,
    pulses: [],
    ...overrides,
  };
}

// ---------------- helpers ----------------

test('dayDiff: counts whole days between ISO dates', () => {
  assert.equal(dayDiff('2026-05-01', '2026-05-02'), 1);
  assert.equal(dayDiff('2026-05-01', '2026-05-08'), 7);
  assert.equal(dayDiff('2026-05-01', '2026-05-01'), 0);
  assert.equal(dayDiff('2026-05-08', '2026-05-01'), -7);
});

test('regressByDay: positive slope on rising values', () => {
  const r = regressByDay([
    { date: '2026-05-01', value: 1.8 },
    { date: '2026-05-02', value: 1.9 },
    { date: '2026-05-03', value: 2.0 },
    { date: '2026-05-04', value: 2.2 },
  ]);
  assert.ok(r);
  assert.ok(r.slope > 0);
  assert.equal(r.samples, 4);
});

test('regressByDay: skips null values', () => {
  const r = regressByDay([
    { date: '2026-05-01', value: null },
    { date: '2026-05-02', value: 2.0 },
    { date: '2026-05-03', value: 2.2 },
    { date: '2026-05-04', value: 2.4 },
  ]);
  assert.ok(r);
  assert.equal(r.samples, 3);
});

test('regressByDay: returns null with < 2 valid points', () => {
  assert.equal(regressByDay([{ date: '2026-05-01', value: 1.8 }]), null);
  assert.equal(regressByDay([]), null);
  assert.equal(regressByDay([{ date: '2026-05-01', value: null }]), null);
});

test('longestConsecutiveStreak: only counts adjacent calendar days', () => {
  const summaries = [
    summary('2026-05-01', { diagnosis: 'over-drain' }),
    summary('2026-05-02', { diagnosis: 'over-drain' }),
    // gap on 2026-05-03
    summary('2026-05-04', { diagnosis: 'over-drain' }),
    summary('2026-05-05', { diagnosis: 'over-drain' }),
    summary('2026-05-06', { diagnosis: 'over-drain' }),
  ];
  const r = longestConsecutiveStreak(summaries, s => s.diagnosis === 'over-drain');
  assert.equal(r.length, 3);
  assert.equal(r.dateFrom, '2026-05-04');
  assert.equal(r.dateTo, '2026-05-06');
});

test('longestConsecutiveStreak: predicate misses break the streak', () => {
  const summaries = [
    summary('2026-05-01', { diagnosis: 'over-drain' }),
    summary('2026-05-02', { diagnosis: 'over-drain' }),
    summary('2026-05-03', { diagnosis: 'optimal' }),
    summary('2026-05-04', { diagnosis: 'over-drain' }),
  ];
  const r = longestConsecutiveStreak(summaries, s => s.diagnosis === 'over-drain');
  assert.equal(r.length, 2);
});

test('stddev: zero on identical values', () => {
  assert.equal(stddev([20, 20, 20, 20]), 0);
});

test('stddev: positive on varied values', () => {
  const v = stddev([10, 15, 20, 25, 30]);
  assert.ok(v > 0);
});

test('stddev: null when insufficient data', () => {
  assert.equal(stddev([20]), null);
  assert.equal(stddev([null, null]), null);
});

// ---------------- detectCrossDayTrends ----------------

test('detectCrossDayTrends: returns null below minDaysForPeriodTrend', () => {
  const t = detectCrossDayTrends([summary('2026-05-01'), summary('2026-05-02')]);
  assert.equal(t, null);
});

test('detectCrossDayTrends: rising EC drain over 7 days', () => {
  const summaries = Array.from({ length: 7 }, (_, i) => summary(
    '2026-05-' + String(i + 1).padStart(2, '0'),
    { avgEcDrain: 1.8 + i * 0.08 },  // 1.8 → 2.28
  ));
  const t = detectCrossDayTrends(summaries);
  assert.ok(t);
  assert.ok(t.ecDrainDrift > 0.4, `expected drift > 0.4, got ${t.ecDrainDrift}`);
  assert.equal(t.days, 7);
  assert.equal(t.spanDays, 6);
});

test('detectCrossDayTrends: longest over-drain streak', () => {
  const summaries = [
    summary('2026-05-01', { diagnosis: 'optimal' }),
    summary('2026-05-02', { diagnosis: 'over-drain' }),
    summary('2026-05-03', { diagnosis: 'over-drain' }),
    summary('2026-05-04', { diagnosis: 'critical' }),
    summary('2026-05-05', { diagnosis: 'over-drain' }),
    summary('2026-05-06', { diagnosis: 'optimal' }),
    summary('2026-05-07', { diagnosis: 'over-drain' }),
  ];
  const t = detectCrossDayTrends(summaries);
  assert.equal(t.overDrainStreak.length, 4);
  assert.equal(t.overDrainStreak.dateFrom, '2026-05-02');
  assert.equal(t.overDrainStreak.dateTo, '2026-05-05');
});

// ---------------- recommendations ----------------

test('EC_DRIFT_UP_PERIOD fires when EC drain drifts up significantly', () => {
  const summaries = Array.from({ length: 7 }, (_, i) => summary(
    '2026-05-' + String(i + 1).padStart(2, '0'),
    { avgEcDrain: 1.8 + i * 0.08 },
  ));
  const recos = buildPeriodRecommendations(detectCrossDayTrends(summaries));
  assert.ok(recos.map(r => r.code).includes('EC_DRIFT_UP_PERIOD'));
});

test('EC_DRIFT_UP_PERIOD does NOT fire on stable EC', () => {
  const summaries = Array.from({ length: 7 }, (_, i) => summary(
    '2026-05-' + String(i + 1).padStart(2, '0'),
    { avgEcDrain: 1.95 },  // flat
  ));
  const recos = buildPeriodRecommendations(detectCrossDayTrends(summaries));
  assert.ok(!recos.map(r => r.code).includes('EC_DRIFT_UP_PERIOD'));
});

test('SUSTAINED_OVER_DRAIN fires on 5 consecutive over-drain days', () => {
  const summaries = Array.from({ length: 5 }, (_, i) => summary(
    '2026-05-' + String(i + 1).padStart(2, '0'),
    { diagnosis: 'over-drain', totalDrainPct: 33 },
  ));
  const recos = buildPeriodRecommendations(detectCrossDayTrends(summaries));
  const reco = recos.find(r => r.code === 'SUSTAINED_OVER_DRAIN');
  assert.ok(reco);
  assert.match(reco.message, /5 jours consécutifs/);
});

test('SUSTAINED_LOW_DRAIN fires on consecutive under-drain days', () => {
  const summaries = Array.from({ length: 4 }, (_, i) => summary(
    '2026-05-' + String(i + 1).padStart(2, '0'),
    { diagnosis: 'under-drain', totalDrainPct: 8 },
  ));
  const recos = buildPeriodRecommendations(detectCrossDayTrends(summaries));
  assert.ok(recos.map(r => r.code).includes('SUSTAINED_LOW_DRAIN'));
});

test('DRAIN_INSTABILITY fires when drain varies wildly', () => {
  const drains = [10, 35, 8, 32, 12, 30, 9];
  const summaries = drains.map((d, i) => summary(
    '2026-05-' + String(i + 1).padStart(2, '0'),
    { totalDrainPct: d },
  ));
  const recos = buildPeriodRecommendations(detectCrossDayTrends(summaries));
  assert.ok(recos.map(r => r.code).includes('DRAIN_INSTABILITY'));
});

test('Stable optimal period yields no period recos', () => {
  const summaries = Array.from({ length: 7 }, (_, i) => summary(
    '2026-05-' + String(i + 1).padStart(2, '0'),
    { diagnosis: 'optimal', totalDrainPct: 22, avgEcDrain: 1.95 },
  ));
  const recos = buildPeriodRecommendations(detectCrossDayTrends(summaries));
  assert.deepEqual(recos, []);
});

test('Threshold override changes behavior', () => {
  const summaries = Array.from({ length: 4 }, (_, i) => summary(
    '2026-05-' + String(i + 1).padStart(2, '0'),
    { diagnosis: 'over-drain' },
  ));
  const trends = detectCrossDayTrends(summaries);
  // Default sustainedOverDrainDays = 3 → fires
  assert.ok(buildPeriodRecommendations(trends).map(r => r.code).includes('SUSTAINED_OVER_DRAIN'));
  // Override to 10 → doesn't fire
  const strict = getThresholds({ sustainedOverDrainDays: 10 });
  assert.ok(!buildPeriodRecommendations(trends, strict).map(r => r.code).includes('SUSTAINED_OVER_DRAIN'));
});

test('null trends → empty recos, no crash', () => {
  assert.deepEqual(buildPeriodRecommendations(null), []);
  assert.deepEqual(buildPeriodRecommendations(undefined), []);
});
