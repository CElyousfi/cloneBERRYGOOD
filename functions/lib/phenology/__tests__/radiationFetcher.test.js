const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchRadiationDaily, __internals } = require('../radiationFetcher');

const LARACHE = { latitude: 35.08, longitude: -6.14 };
const DATE = '2026-05-15';
const STATION = {
  stationId: 'farmroad_tunnel_main',
  type: 'tunnel',
  deviceId: '210506960',
  status: 'active',
};

// ─── Cache builder helpers ─────────────────────────────────────────────

function buildDeviceWithSlots({ deviceId, parSlots, radSlots, tempMin, tempMax }) {
  return {
    deviceId,
    measurements: {
      ...(tempMin != null || tempMax != null ? { TEMPERATURE_INSIDE: { min: tempMin, max: tempMax, avg: (tempMin + tempMax) / 2 } } : {}),
      ...(parSlots ? { PAR_INTENSITY: { avg: 500, count: parSlots.length } } : {}),
      ...(radSlots ? { RADIATION_INTENSITY_INSIDE: { avg: 250, count: radSlots.length } } : {}),
    },
    timeseries: {
      ...(parSlots ? { PAR_INTENSITY: parSlots.map((avg, i) => ({ slot: i, hour: `${String(Math.floor(i*0.25)).padStart(2,'0')}:${String((i*15)%60).padStart(2,'0')}`, avg })) } : {}),
      ...(radSlots ? { RADIATION_INTENSITY_INSIDE: radSlots.map((avg, i) => ({ slot: i, hour: `${String(Math.floor(i*0.25)).padStart(2,'0')}:${String((i*15)%60).padStart(2,'0')}`, avg })) } : {}),
    },
  };
}

function makeFarmroadCache(devices) {
  return { devices, totalMeasurements: devices.reduce((n, d) => n + Object.values(d.measurements).reduce((s, m) => s + (m.count || 0), 0), 0) };
}

function makeDeps({ farmroadCache = undefined, meteo = undefined, meteoThrows = false } = {}) {
  const warns = [];
  return {
    deps: {
      readFarmroadCache: async () => farmroadCache,
      fetchOutdoorDaily: async () => {
        if (meteoThrows) throw new Error('ETIMEDOUT');
        return meteo;
      },
      logWarn: (msg, ctx) => { warns.push({ msg, ctx }); },
    },
    warns,
  };
}

// Helpers to build slot arrays of specific densities
function dense96Slots(value = 100) { return Array.from({ length: 96 }, () => value); }
function nSparseSlots(n, value = 100) { return Array.from({ length: 96 }, (_, i) => i < n ? value : undefined).filter(v => v !== undefined); }
// Slots actually need slot indices; build slot objects directly when count != 96
function buildSparseSlots(count, value = 100) {
  return Array.from({ length: count }, (_, i) => ({ slot: i, hour: `${String(Math.floor(i*0.25)).padStart(2,'0')}:${String((i*15)%60).padStart(2,'0')}`, avg: value }));
}
function buildSparseDevice({ deviceId = '210506960', count, tempMin = 14, tempMax = 28 } = {}) {
  return {
    deviceId,
    measurements: {
      TEMPERATURE_INSIDE: { min: tempMin, max: tempMax, avg: (tempMin + tempMax) / 2 },
      PAR_INTENSITY: { avg: 500, count: count * 3 },
      RADIATION_INTENSITY_INSIDE: { avg: 250, count: count * 3 },
    },
    timeseries: {
      PAR_INTENSITY: buildSparseSlots(count, 800),
      RADIATION_INTENSITY_INSIDE: buildSparseSlots(count, 400),
    },
  };
}

// =====================================================================

test('radiation #1: happy path FarmRoad 96 slots → dataQuality="good", 96 samples', async () => {
  const device = buildSparseDevice({ count: 96 });
  const { deps } = makeDeps({ farmroadCache: makeFarmroadCache([device]) });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);

  assert.equal(r.dataQuality, 'good');
  assert.equal(r.samples.length, 96);
  assert.equal(r.tMin, 14);
  assert.equal(r.tMax, 28);
  assert.equal(r.dataSources.temperature.source, 'farmroad');
  assert.equal(r.dataSources.radiation.source, 'farmroad');
  assert.equal(r.dataSources.radiation.sensor, 'both');
  assert.equal(r.dataSources.radiation.stationId, 'farmroad_tunnel_main');
});

test('radiation #2: FarmRoad partial 60/96 → dataQuality="partial"', async () => {
  const device = buildSparseDevice({ count: 60 });
  const { deps } = makeDeps({ farmroadCache: makeFarmroadCache([device]) });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);

  assert.equal(r.dataQuality, 'partial');
  assert.equal(r.samples.length, 60);
  assert.equal(r.dataSources.radiation.quality, 'partial');
});

test('radiation #3: FarmRoad sparse 30/96 (< 50%) → triggers fallback Open-Meteo', async () => {
  const device = buildSparseDevice({ count: 30 });
  const { deps, warns } = makeDeps({
    farmroadCache: makeFarmroadCache([device]),
    meteo: { date: DATE, tMin: 14, tMax: 28, radiationMjM2: 22, source: 'openmeteo' },
  });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);

  assert.equal(r.dataQuality, 'fallback', 'sparse FarmRoad bascule vers Open-Meteo');
  assert.equal(r.samples.length, 96, 'synthetic 96 samples from Open-Meteo');
  assert.equal(r.dataSources.radiation.source, 'openmeteo');
  assert.ok(warns.some(w => /fallback/i.test(w.msg)), 'logWarn appelé sur bascule');
});

test('radiation #4: FarmRoad empty (cache exists, device not found) → fallback Open-Meteo', async () => {
  const { deps } = makeDeps({
    farmroadCache: makeFarmroadCache([buildSparseDevice({ deviceId: 'OTHER_DEVICE', count: 96 })]),
    meteo: { date: DATE, tMin: 12, tMax: 26, radiationMjM2: 18, source: 'openmeteo' },
  });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);

  assert.equal(r.dataQuality, 'fallback');
  assert.equal(r.tMin, 12);
  assert.equal(r.tMax, 26);
  assert.equal(r.dataSources.temperature.source, 'openmeteo');
});

test('radiation #5: Open-Meteo fallback OK → synthetic samples + dataSources.source="openmeteo"', async () => {
  const { deps } = makeDeps({
    farmroadCache: null,
    meteo: { date: DATE, tMin: 10, tMax: 24, radiationMjM2: 20, source: 'openmeteo' },
  });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);

  assert.equal(r.dataQuality, 'fallback');
  assert.equal(r.dataSources.temperature.source, 'openmeteo');
  assert.equal(r.dataSources.radiation.source, 'openmeteo');
  assert.equal(r.dataSources.radiation.sensor, 'radiation');
  assert.equal(r.samples.length, 96);
  // Daylight samples have radiationWm2 > 0, night samples = 0
  const daylightSamples = r.samples.filter(s => s.radiationWm2 > 0);
  const nightSamples = r.samples.filter(s => s.radiationWm2 === 0);
  assert.ok(daylightSamples.length > 40 && daylightSamples.length <= 48, 'roughly 12h of daylight');
  assert.ok(nightSamples.length > 40, 'roughly 12h of night with 0');
});

test('radiation #6: FarmRoad AND Open-Meteo both down → dataQuality="unavailable", samples=[]', async () => {
  const { deps } = makeDeps({ farmroadCache: null, meteo: null });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);

  assert.equal(r.dataQuality, 'unavailable');
  assert.equal(r.samples.length, 0);
  assert.equal(r.tMin, null);
  assert.equal(r.tMax, null);
  assert.equal(r.dataSources.temperature.source, null);
  assert.equal(r.dataSources.radiation.source, null);
});

test('radiation #7: slot → sample timestamp at CENTER of bucket (7m30s offset)', async () => {
  const device = buildSparseDevice({ count: 96 });
  const { deps } = makeDeps({ farmroadCache: makeFarmroadCache([device]) });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);

  const dayStartMs = Date.UTC(2026, 4, 15, 0, 0, 0); // 2026-05-15 00:00 UTC
  // Slot 0 center = 00:07:30
  assert.equal(r.samples[0].timestamp, dayStartMs + 7.5 * 60 * 1000);
  // Slot 1 center = 00:22:30
  assert.equal(r.samples[1].timestamp, dayStartMs + 22.5 * 60 * 1000);
  // Slot 48 center = 12:07:30 (noon-ish)
  assert.equal(r.samples[48].timestamp, dayStartMs + (48 * 15 + 7.5) * 60 * 1000);
  // Slot 95 center = 23:52:30
  assert.equal(r.samples[95].timestamp, dayStartMs + (95 * 15 + 7.5) * 60 * 1000);
});

test('radiation #8: MJ→W formula validated by HAND CALC (28 MJ/m²/j, 12h daylight → avg ~648 W/m²)', async () => {
  const { deps } = makeDeps({
    farmroadCache: null,
    meteo: { date: DATE, tMin: 14, tMax: 28, radiationMjM2: 28, source: 'openmeteo' },
  });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);

  // Expected: 28 × 1e6 / (12 × 3600) = 648.148 W/m² average over daylight period
  const expectedAvg = 28 * 1e6 / (12 * 3600);

  const daylightSamples = r.samples.filter(s => s.radiationWm2 > 0);
  const avgDaytime = daylightSamples.reduce((sum, s) => sum + s.radiationWm2, 0) / daylightSamples.length;

  console.log(`[radiation #8] Hand calc: 28 × 1e6 / (12 × 3600) = ${expectedAvg.toFixed(2)} W/m²`);
  console.log(`[radiation #8] Module output (mean of ${daylightSamples.length} daylight samples) = ${avgDaytime.toFixed(2)} W/m²`);

  // Sin-profile sampled at slot centers: discrete mean ≈ 2/π × W_max ≈ 648 within < 1%
  assert.ok(
    Math.abs(avgDaytime - expectedAvg) / expectedAvg < 0.01,
    `expected ~${expectedAvg.toFixed(2)}, got ${avgDaytime.toFixed(2)} — diff ${((avgDaytime - expectedAvg)/expectedAvg*100).toFixed(2)}%`
  );
});

test('radiation #9: sinusoidal profile preserves total radiation (∫samples × 900s ≈ 28 MJ × 1e6)', async () => {
  const { deps } = makeDeps({
    farmroadCache: null,
    meteo: { date: DATE, tMin: 14, tMax: 28, radiationMjM2: 28, source: 'openmeteo' },
  });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);

  // Midpoint rule integral: sum(W_i) × Δt   where Δt = 900s for 15-min slots
  const integralWs = r.samples.reduce((sum, s) => sum + s.radiationWm2, 0) * 900;
  const expectedWs = 28 * 1e6;

  console.log(`[radiation #9] Integral = ${(integralWs/1e6).toFixed(3)} MJ/m² (expected 28.000)`);

  assert.ok(
    Math.abs(integralWs - expectedWs) / expectedWs < 0.01,
    `expected ${expectedWs} W·s, got ${integralWs} — diff ${((integralWs - expectedWs)/expectedWs*100).toFixed(2)}%`
  );
});

test('radiation #10: quality thresholds boundary (87→good, 86→partial, 48→partial, 47→fallback)', async () => {
  // 87 → good
  let d = buildSparseDevice({ count: 87 });
  let { deps: deps1 } = makeDeps({ farmroadCache: makeFarmroadCache([d]), meteo: null });
  let r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps1);
  assert.equal(r.dataQuality, 'good');

  // 86 → partial
  d = buildSparseDevice({ count: 86 });
  let { deps: deps2 } = makeDeps({ farmroadCache: makeFarmroadCache([d]), meteo: null });
  r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps2);
  assert.equal(r.dataQuality, 'partial');

  // 48 → partial (boundary inclusive)
  d = buildSparseDevice({ count: 48 });
  let { deps: deps3 } = makeDeps({ farmroadCache: makeFarmroadCache([d]), meteo: null });
  r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps3);
  assert.equal(r.dataQuality, 'partial');

  // 47 → bascule fallback (no meteo here → unavailable)
  d = buildSparseDevice({ count: 47 });
  let { deps: deps4 } = makeDeps({ farmroadCache: makeFarmroadCache([d]), meteo: null });
  r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps4);
  assert.equal(r.dataQuality, 'unavailable');
});

test('radiation #11: cache miss (readFarmroadCache returns null) → fallback (no throw)', async () => {
  const { deps } = makeDeps({
    farmroadCache: null,
    meteo: { date: DATE, tMin: 14, tMax: 28, radiationMjM2: 20, source: 'openmeteo' },
  });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);
  assert.equal(r.dataQuality, 'fallback');
});

test('radiation #12: input validation (bad date, missing plotLocation, missing deps)', async () => {
  const dummy = { readFarmroadCache: async () => null, fetchOutdoorDaily: async () => null };
  await assert.rejects(() => fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: 'bad' }, dummy), TypeError);
  await assert.rejects(() => fetchRadiationDaily({ station: STATION, plotLocation: { latitude: 'x' }, date: DATE }, dummy), TypeError);
  await assert.rejects(() => fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, {}), TypeError);
  await assert.rejects(() => fetchRadiationDaily(null, dummy), TypeError);
});

// ─── Bonus tests ───────────────────────────────────────────────────────

test('radiation: station=null → directly fallback to Open-Meteo', async () => {
  const { deps } = makeDeps({
    farmroadCache: makeFarmroadCache([buildSparseDevice({ count: 96 })]),
    meteo: { date: DATE, tMin: 14, tMax: 28, radiationMjM2: 18, source: 'openmeteo' },
  });
  const r = await fetchRadiationDaily({ station: null, plotLocation: LARACHE, date: DATE }, deps);
  assert.equal(r.dataQuality, 'fallback');
});

test('radiation: Open-Meteo throws → caught, returns unavailable', async () => {
  const { deps } = makeDeps({ farmroadCache: null, meteoThrows: true });
  const r = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE }, deps);
  assert.equal(r.dataQuality, 'unavailable');
});

test('radiation: custom parToRadiationRatio plumbed to synthetic PAR', async () => {
  const { deps } = makeDeps({
    farmroadCache: null,
    meteo: { date: DATE, tMin: 14, tMax: 28, radiationMjM2: 28, source: 'openmeteo' },
  });
  const r1 = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE, parToRadiationRatio: 0.46 }, deps);
  const r2 = await fetchRadiationDaily({ station: STATION, plotLocation: LARACHE, date: DATE, parToRadiationRatio: 0.50 }, deps);
  // Same radiation, different ratio → PAR differs proportionally at noon
  const noon1 = r1.samples[48].parUmolM2s;
  const noon2 = r2.samples[48].parUmolM2s;
  assert.ok(noon2 > noon1, 'higher ratio → higher PAR at same radiation');
  // Ratio of PAR ≈ ratio of ratios
  assert.ok(Math.abs((noon2 / noon1) - (0.50 / 0.46)) < 0.01);
});
