const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchOutdoorDaily, clearOutdoorCache, __internals } = require('../outdoorWeatherFallback');

const LARACHE = { latitude: 35.08, longitude: -6.14 };

function makeDeps(impl, counter) {
  counter.calls = 0;
  counter.lastUrl = null;
  return {
    fetchJson: async (url) => {
      counter.calls += 1;
      counter.lastUrl = url;
      return impl(url);
    },
  };
}

const FULL_RESPONSE = {
  daily: {
    time: ['2026-05-15'],
    temperature_2m_max: [28.4],
    temperature_2m_min: [14.2],
    relative_humidity_2m_mean: [62],
    et0_fao_evapotranspiration: [5.1],
    shortwave_radiation_sum: [26.8],
  },
};

test('outdoor #1: Open-Meteo 200 OK with full daily → fields mapped correctly', async () => {
  clearOutdoorCache();
  const c = {};
  const deps = makeDeps(() => FULL_RESPONSE, c);
  const r = await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-15' }, deps);
  assert.equal(r.date, '2026-05-15');
  assert.equal(r.tMax, 28.4);
  assert.equal(r.tMin, 14.2);
  assert.equal(r.humidity, 62);
  assert.equal(r.eto, 5.1);
  assert.equal(r.radiationMjM2, 26.8);
  assert.equal(r.source, 'openmeteo');
  assert.equal(c.calls, 1);
});

test('outdoor #2: Partial response (some null fields) → null propagated, no crash', async () => {
  clearOutdoorCache();
  const c = {};
  const deps = makeDeps(() => ({
    daily: {
      time: ['2026-05-15'],
      temperature_2m_max: [28.4],
      temperature_2m_min: [14.2],
      // humidity / eto / radiation absent
    },
  }), c);
  const r = await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-15' }, deps);
  assert.equal(r.tMax, 28.4);
  assert.equal(r.humidity, null);
  assert.equal(r.eto, null);
  assert.equal(r.radiationMjM2, null);
});

test('outdoor #3: Open-Meteo 5xx (deps returns null) → fetchOutdoorDaily returns null', async () => {
  clearOutdoorCache();
  const c = {};
  const deps = makeDeps(() => null, c);
  const r = await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-15' }, deps);
  assert.equal(r, null);
});

test('outdoor #4: Open-Meteo timeout (deps throws) → returns null + does not propagate', async () => {
  clearOutdoorCache();
  const c = {};
  const deps = makeDeps(() => { throw new Error('ETIMEDOUT'); }, c);
  const r = await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-15' }, deps);
  assert.equal(r, null);
});

test('outdoor #5: malformed JSON (missing daily.time) → returns null', async () => {
  clearOutdoorCache();
  const c = {};
  const deps = makeDeps(() => ({ error: 'something' }), c);
  const r = await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-15' }, deps);
  assert.equal(r, null);
});

test('outdoor #6: cache hit on same (date, lat, lon) → no HTTP call', async () => {
  clearOutdoorCache();
  const c = {};
  const deps = makeDeps(() => FULL_RESPONSE, c);
  await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-15' }, deps);
  await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-15' }, deps);
  await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-15' }, deps);
  assert.equal(c.calls, 1, 'only one HTTP call across 3 invocations');
  // Different date → new call
  await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-16' }, deps);
  assert.equal(c.calls, 2);
});

test('outdoor #7: radiationMjM2 unit check (Open-Meteo gives MJ/m²/j) → passed through', async () => {
  clearOutdoorCache();
  const c = {};
  const deps = makeDeps(() => ({
    daily: {
      time: ['2026-05-15'],
      temperature_2m_max: [25],
      temperature_2m_min: [12],
      relative_humidity_2m_mean: [70],
      et0_fao_evapotranspiration: [4],
      shortwave_radiation_sum: [22.5], // typical Mediterranean spring day ~ 22-28 MJ/m²
    },
  }), c);
  const r = await fetchOutdoorDaily({ ...LARACHE, date: '2026-05-15' }, deps);
  assert.equal(r.radiationMjM2, 22.5);
  // Sanity: 22.5 MJ/m²/j on 12h daylight ≈ 520 W/m² average — physical range
  assert.ok(r.radiationMjM2 > 5 && r.radiationMjM2 < 35, 'within plausible physical range');
});

test('outdoor: URL builder includes correct params', () => {
  const url = __internals._buildUrl(35.08, -6.14, '2026-05-15');
  assert.ok(url.includes('latitude=35.08'));
  assert.ok(url.includes('longitude=-6.14'));
  assert.ok(url.includes('start_date=2026-05-15'));
  assert.ok(url.includes('end_date=2026-05-15'));
  assert.ok(url.includes('timezone=Africa/Casablanca'));
  assert.ok(url.includes('temperature_2m_max'));
  assert.ok(url.includes('shortwave_radiation_sum'));
});

test('outdoor: input validation', async () => {
  const deps = { fetchJson: async () => null };
  await assert.rejects(() => fetchOutdoorDaily({ latitude: NaN, longitude: 0, date: '2026-05-15' }, deps), TypeError);
  await assert.rejects(() => fetchOutdoorDaily({ latitude: 0, longitude: 0, date: 'bad' }, deps), TypeError);
  await assert.rejects(() => fetchOutdoorDaily({ latitude: 0, longitude: 0, date: '2026-05-15' }, {}), TypeError);
});
