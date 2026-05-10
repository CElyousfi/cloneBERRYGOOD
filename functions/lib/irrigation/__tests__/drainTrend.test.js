const test = require('node:test');
const assert = require('node:assert/strict');

const { analyseReadings, buildRecommendations, computeDrainTrend, DEFAULT_THRESHOLDS } = require('..');
const {
  scenarioOverDrainAfternoon,
  scenarioFlatDrain,
  scenarioFallingDrain,
  scenarioOptimal,
} = require('./fixtures');

function singleSummary(raws) {
  const { summaries } = analyseReadings(raws);
  assert.equal(summaries.length, 1);
  return summaries[0];
}

test('computeDrainTrend: positive slope on rising drain', () => {
  const summary = singleSummary(scenarioOverDrainAfternoon);
  assert.ok(summary.drainTrend, 'drainTrend should be computed');
  assert.ok(summary.drainTrend.slopePctPerHour > 1.5,
    `slope should exceed threshold, got ${summary.drainTrend.slopePctPerHour}`);
  assert.ok(summary.drainTrend.endPct > summary.drainTrend.startPct);
  assert.ok(summary.drainTrend.firstHighDrainTime, 'firstHighDrainTime should be set');
});

test('computeDrainTrend: ~zero slope on flat drain', () => {
  const summary = singleSummary(scenarioFlatDrain);
  assert.ok(summary.drainTrend);
  assert.ok(Math.abs(summary.drainTrend.slopePctPerHour) < 0.5,
    `flat drain should give near-zero slope, got ${summary.drainTrend.slopePctPerHour}`);
});

test('computeDrainTrend: negative slope on falling drain', () => {
  const summary = singleSummary(scenarioFallingDrain);
  assert.ok(summary.drainTrend);
  assert.ok(summary.drainTrend.slopePctPerHour < 0,
    `falling drain should give negative slope, got ${summary.drainTrend.slopePctPerHour}`);
});

test('DRAIN_TREND_RISING fires on rising afternoon scenario', () => {
  const summary = singleSummary(scenarioOverDrainAfternoon);
  const recos = buildRecommendations(summary);
  const codes = recos.map(r => r.code);
  assert.ok(codes.includes('DRAIN_TREND_RISING'),
    `expected DRAIN_TREND_RISING, got: ${codes.join(',')}`);
  const trendReco = recos.find(r => r.code === 'DRAIN_TREND_RISING');
  assert.match(trendReco.suggestedAction, /pulse de \d{1,2}:\d{2}/,
    'action should name the cutoff time');
});

test('DRAIN_TREND_RISING does NOT fire on flat drain', () => {
  const summary = singleSummary(scenarioFlatDrain);
  const recos = buildRecommendations(summary);
  assert.ok(!recos.map(r => r.code).includes('DRAIN_TREND_RISING'));
});

test('DRAIN_TREND_RISING does NOT fire on falling drain', () => {
  const summary = singleSummary(scenarioFallingDrain);
  const recos = buildRecommendations(summary);
  assert.ok(!recos.map(r => r.code).includes('DRAIN_TREND_RISING'));
});

test('computeDrainTrend: returns null when too few pulses', () => {
  const trend = computeDrainTrend(
    [
      { drainPct: 20, minutesFromMidnight: 8 * 60 },
      { drainPct: 25, minutesFromMidnight: 12 * 60 },
    ],
    DEFAULT_THRESHOLDS,
  );
  assert.equal(trend, null);
});

test('computeDrainTrend: skips pulses with null drainPct/minutes', () => {
  const trend = computeDrainTrend(
    [
      { drainPct: null, minutesFromMidnight: 8 * 60 },
      { drainPct: 20, minutesFromMidnight: null },
      { drainPct: 22, minutesFromMidnight: 8 * 60 },
      { drainPct: 28, minutesFromMidnight: 12 * 60 },
      { drainPct: 35, minutesFromMidnight: 16 * 60 },
    ],
    DEFAULT_THRESHOLDS,
  );
  assert.ok(trend);
  assert.equal(trend.samples, 3);
});

test('balanced day still has zero/near-zero trend, no rising reco', () => {
  const summary = singleSummary(scenarioOptimal);
  const recos = buildRecommendations(summary);
  assert.ok(!recos.map(r => r.code).includes('DRAIN_TREND_RISING'));
});
