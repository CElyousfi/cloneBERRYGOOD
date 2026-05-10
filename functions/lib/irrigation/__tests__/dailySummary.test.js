const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeReadings } = require('../normalize');
const { enrichEvents } = require('../enrich');
const { buildDailySummaries } = require('../dailySummary');
const { reading } = require('./fixtures');

test('buildDailySummaries: aggregates one summary per (date, parcelle)', () => {
  const raws = [
    reading({ date: '2026-05-01', parcelle: 'P1', heure: '08:00' }),
    reading({ date: '2026-05-01', parcelle: 'P1', heure: '10:00' }),
    reading({ date: '2026-05-01', parcelle: 'P2', heure: '08:00' }),
    reading({ date: '2026-05-02', parcelle: 'P1', heure: '08:00' }),
  ];
  const summaries = buildDailySummaries(enrichEvents(normalizeReadings(raws)));
  assert.equal(summaries.length, 3);
  const p1May01 = summaries.find(s => s.parcelle === 'P1' && s.date === '2026-05-01');
  assert.equal(p1May01.pulseCount, 2);
});

test('buildDailySummaries: irrigationCutoffTime is the latest known heure', () => {
  const raws = [
    reading({ heure: '08:00' }),
    reading({ heure: '12:00' }),
    reading({ heure: '17:30' }),
    reading({ heure: null }),
  ];
  const [summary] = buildDailySummaries(enrichEvents(normalizeReadings(raws)));
  assert.equal(summary.irrigationCutoffTime, '17:30');
});

test('buildDailySummaries: counts high/low drain pulses correctly (excluding 1st pulse)', () => {
  // First pulse is excluded from low-drain count (Driscoll Rule 4: first
  // morning drip is expected to have minimal/no drain — tracked separately).
  const raws = [
    reading({ heure: '08:00', points: [{ ec: 1.8, ph: 6, volume: 100 }], drainage: [{ ec: 2, ph: 5.9, volume: 2 }] }),  // 2%  first (excluded)
    reading({ heure: '09:00', points: [{ ec: 1.8, ph: 6, volume: 100 }], drainage: [{ ec: 2, ph: 5.9, volume: 5 }] }),  // 5%  low
    reading({ heure: '10:00', points: [{ ec: 1.8, ph: 6, volume: 100 }], drainage: [{ ec: 2, ph: 5.9, volume: 10 }] }), // 10% low
    reading({ heure: '12:00', points: [{ ec: 1.8, ph: 6, volume: 100 }], drainage: [{ ec: 2, ph: 5.9, volume: 22 }] }), // 22% ok
    reading({ heure: '15:00', points: [{ ec: 1.8, ph: 6, volume: 100 }], drainage: [{ ec: 2, ph: 5.9, volume: 33 }] }), // 33% high
  ];
  const [summary] = buildDailySummaries(enrichEvents(normalizeReadings(raws)));
  assert.equal(summary.lowDrainPulseCount, 2);
  assert.equal(summary.highDrainPulseCount, 1);
  assert.equal(summary.pulseCount, 5);
});

test('buildDailySummaries: handles null/empty input safely', () => {
  assert.deepEqual(buildDailySummaries([]), []);
  assert.deepEqual(buildDailySummaries(null), []);
});

// ---- F1/F2 RadSum visibility fields ----

// RadSum is now sourced from FarmRoad indoor sensors keyed by greenhouseType.
// The parcelle 'C2-S8-COR' resolves to greenhouseType 'tunnel' via PARCELLE_META.
const META_TUNNEL = { 'C2-S8-COR': { greenhouseType: 'tunnel' } };

test('buildDailySummaries: radSumSoFarJPerCm2 = dailyRadJPerCm2 for past days', () => {
  const hourly = new Array(24).fill(0);
  for (let h = 6; h < 18; h++) hourly[h] = 500;
  const weatherByDate = {
    '2026-04-30': { date: '2026-04-30', sunriseMin: 6 * 60, sunsetMin: 18 * 60 },
  };
  const indoorRadByGhType = { tunnel: { '2026-04-30': hourly }, canarienne: {} };
  const raws = [reading({ date: '2026-04-30', heure: '08:00' })];
  const enriched = enrichEvents(normalizeReadings(raws), undefined, weatherByDate, META_TUNNEL, indoorRadByGhType);
  const [s] = buildDailySummaries(enriched, undefined, weatherByDate, META_TUNNEL, {}, indoorRadByGhType);
  assert.equal(s.radSumSoFarJPerCm2, s.dailyRadJPerCm2);
  assert.ok(s.dailyRadJPerCm2 > 0);
});

test('buildDailySummaries: radSumSoFarJPerCm2 < dailyRadJPerCm2 mid-day', () => {
  const hourly = new Array(24).fill(0);
  for (let h = 6; h < 18; h++) hourly[h] = 500;
  const weatherByDate = {
    '2026-05-03': { date: '2026-05-03', sunriseMin: 6 * 60, sunsetMin: 18 * 60 },
  };
  const indoorRadByGhType = { tunnel: { '2026-05-03': hourly }, canarienne: {} };
  const raws = [reading({ date: '2026-05-03', heure: '08:00' })];
  const enriched = enrichEvents(normalizeReadings(raws), undefined, weatherByDate, META_TUNNEL, indoorRadByGhType);
  const [s] = buildDailySummaries(enriched, undefined, weatherByDate, META_TUNNEL, {
    todayDate: '2026-05-03', nowMin: 12 * 60,
  }, indoorRadByGhType);
  assert.ok(s.radSumSoFarJPerCm2 < s.dailyRadJPerCm2,
    `expected so-far (${s.radSumSoFarJPerCm2}) < daily (${s.dailyRadJPerCm2})`);
  const ratio = s.radSumSoFarJPerCm2 / s.dailyRadJPerCm2;
  assert.ok(ratio > 0.4 && ratio < 0.6, `expected ratio ~0.5, got ${ratio.toFixed(3)}`);
});

test('buildDailySummaries: hourlyRadSumCumulative is monotone non-decreasing', () => {
  const hourly = new Array(24).fill(0);
  for (let h = 6; h < 18; h++) hourly[h] = 500;
  const weatherByDate = {
    '2026-05-03': { date: '2026-05-03', sunriseMin: 6 * 60, sunsetMin: 18 * 60 },
  };
  const indoorRadByGhType = { tunnel: { '2026-05-03': hourly }, canarienne: {} };
  const raws = [reading({ date: '2026-05-03', heure: '08:00' })];
  const enriched = enrichEvents(normalizeReadings(raws), undefined, weatherByDate, META_TUNNEL, indoorRadByGhType);
  const [s] = buildDailySummaries(enriched, undefined, weatherByDate, META_TUNNEL, undefined, indoorRadByGhType);
  assert.ok(Array.isArray(s.hourlyRadSumCumulative));
  assert.equal(s.hourlyRadSumCumulative.length, 24);
  for (let i = 1; i < 24; i++) {
    assert.ok(s.hourlyRadSumCumulative[i] >= s.hourlyRadSumCumulative[i - 1],
      `non-monotone at h=${i}: ${s.hourlyRadSumCumulative[i - 1]} → ${s.hourlyRadSumCumulative[i]}`);
  }
  const last = s.hourlyRadSumCumulative[23];
  assert.ok(Math.abs(last - s.dailyRadJPerCm2) < 1,
    `last cumulative (${last}) should match daily (${s.dailyRadJPerCm2})`);
});

test('buildDailySummaries: RadSum fields are null when no FarmRoad data', () => {
  const raws = [reading({ heure: '08:00' })];
  const enriched = enrichEvents(normalizeReadings(raws));
  const [s] = buildDailySummaries(enriched);
  assert.equal(s.hourlyRadSumCumulative, null);
  assert.equal(s.radSumSoFarJPerCm2, null);
  assert.equal(s.dailyRadJPerCm2, null);
});

test('buildDailySummaries: no fallback to Open-Meteo — RadSum stays null without FarmRoad data', () => {
  const hourly = new Array(24).fill(0);
  for (let h = 6; h < 18; h++) hourly[h] = 500;
  // weatherByDate has hourlyRadiation but indoorRadByGhType does NOT — must NOT fall back.
  const weatherByDate = {
    '2026-05-03': { date: '2026-05-03', sunriseMin: 6 * 60, sunsetMin: 18 * 60, hourlyRadiation: hourly },
  };
  const raws = [reading({ date: '2026-05-03', heure: '08:00' })];
  const enriched = enrichEvents(normalizeReadings(raws), undefined, weatherByDate, META_TUNNEL, null);
  const [s] = buildDailySummaries(enriched, undefined, weatherByDate, META_TUNNEL, undefined, null);
  assert.equal(s.dailyRadJPerCm2, null, 'must not use Open-Meteo as fallback');
  assert.equal(s.radSumSoFarJPerCm2, null);
  assert.equal(s.hourlyRadSumCumulative, null);
});
