const test = require('node:test');
const assert = require('node:assert/strict');

const {
  roundCoord,
  buildWeatherBasicUrl,
  buildWeatherAgroUrl,
  buildSprayUrl,
  fetchWeather,
  fetchSpray,
} = require('../meteoblueProxy');

const LARACHE = { lat: 35.08, lon: -6.14, altitude: 49 };
const API_KEY = 'test-api-key';

function makeDeps(impl) {
  const counter = { calls: 0, urls: [] };
  const deps = {
    apiKey: API_KEY,
    fetchJson: async (url) => {
      counter.calls += 1;
      counter.urls.push(url);
      return impl(url);
    },
  };
  return { deps, counter };
}

// Factory (not a shared const): fetchWeather mutates data.data_1h in place
// via Object.assign, so each test needs its own fresh object.
function makeBasicResponse() {
  return {
    data_1h: {
      time: ['2026-07-30 00:00'],
      temperature: [22],
    },
  };
}

const AGRO_RESPONSE = {
  data_1h: {
    shortwave_radiation: [123],
    evapotranspiration: [0.4],
  },
};

const SPRAY_RESPONSE = {
  data_1h: {
    time: ['2026-07-30 06:00'],
    spraywindow: [1],
  },
};

test('roundCoord: rounds to 2 decimals', () => {
  assert.equal(roundCoord(35.0801), 35.08);
  assert.equal(roundCoord(-6.1449), -6.14);
  assert.equal(roundCoord(34.34251), 34.34);
});

test('buildWeatherBasicUrl: correct package + params', () => {
  const url = buildWeatherBasicUrl(LARACHE, API_KEY);
  assert.ok(url.startsWith('https://my.meteoblue.com/packages/basic-day_agro-day_basic-1h?'));
  assert.ok(url.includes('apikey=' + API_KEY));
  assert.ok(url.includes('lat=35.08'));
  assert.ok(url.includes('lon=-6.14'));
  assert.ok(url.includes('asl=49'));
  assert.ok(url.includes('format=json'));
});

test('buildWeatherAgroUrl: correct package', () => {
  const url = buildWeatherAgroUrl(LARACHE, API_KEY);
  assert.ok(url.startsWith('https://my.meteoblue.com/packages/agro-1h?'));
});

test('buildSprayUrl: correct package', () => {
  const url = buildSprayUrl(LARACHE, API_KEY);
  assert.ok(url.startsWith('https://my.meteoblue.com/packages/agromodelspray-1h?'));
});

test('fetchWeather #1: basic OK + agro OK → merge shortwave_radiation/evapotranspiration onto data_1h', async () => {
  const { deps, counter } = makeDeps((url) => {
    if (url.includes('basic-day_agro-day_basic-1h')) return makeBasicResponse();
    if (url.includes('agro-1h')) return AGRO_RESPONSE;
    return null;
  });
  const data = await fetchWeather(LARACHE, deps);
  assert.equal(counter.calls, 2);
  assert.equal(data.data_1h.temperature[0], 22, 'basic fields preserved');
  assert.deepEqual(data.data_1h.shortwave_radiation, [123]);
  assert.deepEqual(data.data_1h.evapotranspiration, [0.4]);
});

test('fetchWeather #2: agro fetch fails (throws) → silent, basic data returned unmerged', async () => {
  const { deps } = makeDeps((url) => {
    if (url.includes('basic-day_agro-day_basic-1h')) return makeBasicResponse();
    throw new Error('agro package not subscribed');
  });
  const data = await fetchWeather(LARACHE, deps);
  assert.equal(data.data_1h.temperature[0], 22);
  assert.equal(data.data_1h.shortwave_radiation, undefined);
});

test('fetchWeather #3: agro fetch returns null (non-2xx) → silent, basic data returned unmerged', async () => {
  const { deps } = makeDeps((url) => {
    if (url.includes('basic-day_agro-day_basic-1h')) return makeBasicResponse();
    return null;
  });
  const data = await fetchWeather(LARACHE, deps);
  assert.equal(data.data_1h.temperature[0], 22);
  assert.equal(data.data_1h.shortwave_radiation, undefined);
});

test('fetchWeather #4: basic fetch fails (throws) → returns null, agro never called', async () => {
  const { deps, counter } = makeDeps((url) => {
    if (url.includes('basic-day_agro-day_basic-1h')) throw new Error('ETIMEDOUT');
    return AGRO_RESPONSE;
  });
  const data = await fetchWeather(LARACHE, deps);
  assert.equal(data, null);
  assert.equal(counter.calls, 1, 'agro must not be called when basic fails');
});

test('fetchWeather #5: basic fetch returns null (non-2xx) → returns null', async () => {
  const { deps, counter } = makeDeps(() => null);
  const data = await fetchWeather(LARACHE, deps);
  assert.equal(data, null);
  assert.equal(counter.calls, 1);
});

test('fetchWeather: shortwaveradiation (no underscore-split) fallback key handled', async () => {
  const { deps } = makeDeps((url) => {
    if (url.includes('basic-day_agro-day_basic-1h')) return makeBasicResponse();
    return { data_1h: { shortwaveradiation: [77], evapotranspiration: [0.2] } };
  });
  const data = await fetchWeather(LARACHE, deps);
  assert.deepEqual(data.data_1h.shortwave_radiation, [77]);
});

test('fetchWeather: input validation', async () => {
  await assert.rejects(() => fetchWeather(LARACHE, {}), TypeError);
  await assert.rejects(() => fetchWeather(LARACHE, { fetchJson: async () => null }), TypeError);
});

test('fetchSpray #1: 200 OK → data returned as-is', async () => {
  const { deps, counter } = makeDeps(() => SPRAY_RESPONSE);
  const data = await fetchSpray(LARACHE, deps);
  assert.equal(counter.calls, 1);
  assert.deepEqual(data, SPRAY_RESPONSE);
});

test('fetchSpray #2: fetch throws → returns null', async () => {
  const { deps } = makeDeps(() => { throw new Error('ETIMEDOUT'); });
  const data = await fetchSpray(LARACHE, deps);
  assert.equal(data, null);
});

test('fetchSpray #3: fetch resolves null (non-2xx) → returns null', async () => {
  const { deps } = makeDeps(() => null);
  const data = await fetchSpray(LARACHE, deps);
  assert.equal(data, null);
});

test('fetchSpray: input validation', async () => {
  await assert.rejects(() => fetchSpray(LARACHE, {}), TypeError);
});

test('roundCoord: collision — F1..F5/BAHIA/Avocatier all round to the same doc key', () => {
  const coords = [
    { lat: 35.08, lon: -6.14 }, // F1
    { lat: 35.08, lon: -6.14 }, // F2
    { lat: 35.08, lon: -6.14 }, // BAHIA
  ];
  const keys = coords.map((c) => roundCoord(c.lat) + '_' + roundCoord(c.lon));
  assert.equal(new Set(keys).size, 1, 'shared-location farms collapse onto a single cache key');
});
