const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getRadiationTarget,
  integrateRadiation,
  predictNextPulseTime,
  buildRadiationRecommendations,
  analyseReadings,
  enrichEvents,
  normalizeReadings,
  buildDailySummaries,
  DEFAULT_THRESHOLDS,
} = require('..');
const { reading, station } = require('./fixtures');

// ---- helpers ----

test('getRadiationTarget: per-culture lookup with fallback', () => {
  assert.equal(getRadiationTarget('Myrtille'), 130);
  assert.equal(getRadiationTarget('Framboise'), 100);
  assert.equal(getRadiationTarget('UnknownCrop'), 120);
  assert.equal(getRadiationTarget(null), 120);
});

test('integrateRadiation: full hour at 600 W/m² = 216 J/cm²', () => {
  // 600 W/m² × 3600 s = 2,160,000 J/m² ; ÷ 10000 cm²/m² → 216 J/cm²
  const hourly = new Array(24).fill(0);
  hourly[12] = 600;
  const j = integrateRadiation(hourly, 12 * 60, 13 * 60);
  assert.ok(Math.abs(j - 216) < 0.5, `expected ~216, got ${j}`);
});

test('integrateRadiation: 30-min window at 600 W/m² = 108 J/cm²', () => {
  const hourly = new Array(24).fill(0);
  hourly[12] = 600;
  const j = integrateRadiation(hourly, 12 * 60, 12 * 60 + 30);
  assert.ok(Math.abs(j - 108) < 0.5, `expected ~108, got ${j}`);
});

test('integrateRadiation: zero on empty/invalid inputs', () => {
  assert.equal(integrateRadiation(null, 0, 60), 0);
  assert.equal(integrateRadiation([], 0, 60), 0);
  assert.equal(integrateRadiation(new Array(24).fill(0), 100, 50), 0);
});

test('predictNextPulseTime: ETA scales inversely with radiation rate', () => {
  // Constant 500 W/m² all afternoon → 180 J/cm² per hour
  const hourly = new Array(24).fill(0);
  for (let h = 12; h < 18; h++) hourly[h] = 500;
  // Need 360 J/cm² → ~2h
  const r = predictNextPulseTime(hourly, 12 * 60, 360);
  assert.ok(r.etaTime !== null);
  // Should be ~14:00 (allow ±2 min for minute-quantization)
  assert.ok(r.etaMin >= 12 * 60 + 118 && r.etaMin <= 12 * 60 + 122,
    `expected ~14:00 (etaMin around 838-842), got ${r.etaTime} (etaMin=${r.etaMin})`);
});

test('predictNextPulseTime: returns null when target unreachable', () => {
  const hourly = new Array(24).fill(0); // no sun
  const r = predictNextPulseTime(hourly, 12 * 60, 100);
  assert.equal(r.etaTime, null);
});

// ---- end-to-end ----

test('enrichEvents: computes radSumSincePreviousPulse from FarmRoad indoor data (transmittance=1)', () => {
  const hourly = new Array(24).fill(0);
  for (let h = 6; h < 18; h++) hourly[h] = 500; // 12 sunlit hours, indoor W/m²
  const weatherByDate = {
    '2026-05-02': { date: '2026-05-02', sunriseMin: 6 * 60, sunsetMin: 18 * 60 },
  };
  const indoorRadByGhType = { tunnel: { '2026-05-02': hourly }, canarienne: {} };
  const meta = { 'C2-S8-COR': { greenhouseType: 'tunnel' } };
  const raws = [
    reading({ date: '2026-05-02', heure: '08:00', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 5)] }),
    reading({ date: '2026-05-02', heure: '10:00', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 18)] }),
  ];
  const enriched = enrichEvents(normalizeReadings(raws), DEFAULT_THRESHOLDS, weatherByDate, meta, indoorRadByGhType);
  // First pulse: 06:00 → 08:00 = 2h × 500 W/m² × 1.0 (indoor) = 360 J/cm²
  assert.ok(enriched[0].radSumSincePreviousPulse > 355 && enriched[0].radSumSincePreviousPulse < 365,
    `first pulse RadSum unexpected: ${enriched[0].radSumSincePreviousPulse}`);
  // Second pulse: 08:00 → 10:00 = same window = 360 J/cm²
  assert.ok(enriched[1].radSumSincePreviousPulse > 355 && enriched[1].radSumSincePreviousPulse < 365);
});

test('enrichEvents: radSumSincePreviousPulse is null without FarmRoad data (no Open-Meteo fallback)', () => {
  const hourly = new Array(24).fill(0);
  for (let h = 6; h < 18; h++) hourly[h] = 500;
  // weatherByDate has hourlyRadiation but indoorRadByGhType is null/missing → must not fall back
  const weatherByDate = {
    '2026-05-02': { date: '2026-05-02', sunriseMin: 6 * 60, sunsetMin: 18 * 60, hourlyRadiation: hourly },
  };
  const meta = { 'C2-S8-COR': { greenhouseType: 'tunnel' } };
  const raws = [
    reading({ date: '2026-05-02', heure: '08:00', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 5)] }),
  ];
  const enriched = enrichEvents(normalizeReadings(raws), DEFAULT_THRESHOLDS, weatherByDate, meta, null);
  assert.equal(enriched[0].radSumSincePreviousPulse, null);
});

test('enrichEvents: dynamic late-day cutoff from sunset', () => {
  const weatherByDate = {
    '2026-05-02': { date: '2026-05-02', sunriseMin: 6 * 60, sunsetMin: 19 * 60 + 30, hourlyRadiation: new Array(24).fill(0) },
  };
  // Sunset 19:30, cutoff = sunset - 2h = 17:30 (overrides static 15:00)
  const raws = [
    reading({ date: '2026-05-02', heure: '15:00' }),
    reading({ date: '2026-05-02', heure: '17:30' }),
    reading({ date: '2026-05-02', heure: '18:00' }),
  ];
  const enriched = enrichEvents(normalizeReadings(raws), DEFAULT_THRESHOLDS, weatherByDate);
  assert.equal(enriched[0].isLateDayPulse, false, '15:00 should NOT be late (cutoff 17:30 in summer)');
  assert.equal(enriched[1].isLateDayPulse, true);
  assert.equal(enriched[2].isLateDayPulse, true);
});

test('PULSE_TOO_EARLY fires when RadSum << target', () => {
  const hourly = new Array(24).fill(0);
  for (let h = 6; h < 18; h++) hourly[h] = 100; // low indoor rad
  const weatherByDate = {
    '2026-05-02': { date: '2026-05-02', sunriseMin: 6 * 60, sunsetMin: 18 * 60 },
  };
  const indoorRadByGhType = { tunnel: { '2026-05-02': hourly }, canarienne: {} };
  const parcelleMetaById = { 'C2-S8-COR': { greenhouseType: 'tunnel' } };
  // Pulses every 30 min — too frequent for the radiation level
  const raws = [
    reading({ date: '2026-05-02', heure: '09:00', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 18)] }),
    reading({ date: '2026-05-02', heure: '09:30', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 18)] }),
  ];
  const { summaries } = analyseReadings(raws, undefined, undefined, { weatherByDate, parcelleMetaById, indoorRadByGhType });
  const recos = buildRadiationRecommendations(summaries[0], { culture: 'Myrtille' });
  assert.ok(recos.map(r => r.code).includes('PULSE_TOO_EARLY'),
    `expected PULSE_TOO_EARLY, got ${JSON.stringify(recos.map(r => r.code))}`);
});

test('LOW_RAD_DAY_OVER_IRRIGATED fires on cloudy day with many pulses', () => {
  const hourly = new Array(24).fill(0);
  for (let h = 6; h < 18; h++) hourly[h] = 50; // very cloudy: 12h × 50 W/m² × 1.0 indoor → 216 J/cm²
  const weatherByDate = {
    '2026-05-02': { date: '2026-05-02', sunriseMin: 6 * 60, sunsetMin: 18 * 60 },
  };
  const indoorRadByGhType = { tunnel: { '2026-05-02': hourly }, canarienne: {} };
  const parcelleMetaById = { 'C2-S8-COR': { greenhouseType: 'tunnel' } };
  const raws = [];
  for (let h = 7; h < 14; h++) {
    raws.push(reading({ date: '2026-05-02', heure: String(h).padStart(2, '0') + ':00', points: [station(1.8, 6, 100)], drainage: [station(2, 5.9, 18)] }));
  }
  const { summaries } = analyseReadings(raws, undefined, undefined, { weatherByDate, parcelleMetaById, indoorRadByGhType });
  const recos = buildRadiationRecommendations(summaries[0]);
  assert.ok(recos.map(r => r.code).includes('LOW_RAD_DAY_OVER_IRRIGATED'),
    `expected LOW_RAD_DAY_OVER_IRRIGATED, got ${JSON.stringify(recos.map(r => r.code))}`);
});
