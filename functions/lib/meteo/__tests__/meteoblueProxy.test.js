const test = require('node:test');
const assert = require('node:assert/strict');

const {
  roundCoord,
  buildWeatherBasicUrl,
  buildWeatherAgroUrl,
  buildSprayUrl,
  isValidWeatherPayload,
  isValidSprayPayload,
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
    data_day: {
      time: ['2026-07-30'],
    },
    data_1h: {
      time: ['2026-07-30 00:00'],
      temperature: [22],
    },
  };
}

// "Hollow" HTTP 200 body, as Meteoblue can return when the account quota is
// exceeded — no usable data_1h/data_day, but not a network/4xx failure.
function makeHollowWeatherResponse() {
  return { data_day: { time: [] }, data_1h: { time: [] } };
}

function makeHollowSprayResponse() {
  return { data_1h: { spraywindow: [] } };
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

test('fetchWeather #6: basic fetch returns hollow HTTP 200 (quota exceeded) → returns null', async () => {
  const { deps, counter } = makeDeps((url) => {
    if (url.includes('basic-day_agro-day_basic-1h')) return makeHollowWeatherResponse();
    return AGRO_RESPONSE;
  });
  const data = await fetchWeather(LARACHE, deps);
  assert.equal(data, null, 'hollow payload must be treated as a miss, not cached');
});

test('fetchWeather #7: agro OK but neither shortwave_radiation/shortwaveradiation nor evapotranspiration present → no undefined key introduced (regression: Firestore rejects undefined values)', async () => {
  const { deps } = makeDeps((url) => {
    if (url.includes('basic-day_agro-day_basic-1h')) return makeBasicResponse();
    if (url.includes('agro-1h')) return { data_1h: { time: ['2026-07-30 00:00'] } };
    return null;
  });
  const data = await fetchWeather(LARACHE, deps);
  assert.equal(data.data_1h.temperature[0], 22, 'basic fields preserved');
  assert.ok(!('shortwave_radiation' in data.data_1h), 'shortwave_radiation key must not be introduced when unresolved');
  assert.ok(!('evapotranspiration' in data.data_1h), 'evapotranspiration key must not be introduced when unresolved');
  Object.keys(data.data_1h).forEach((key) => {
    assert.notEqual(data.data_1h[key], undefined, `data_1h.${key} must not be undefined (Firestore write would throw)`);
  });
  assert.equal(JSON.stringify(data).includes('undefined'), false);
});

test('fetchWeather #8: agro OK with shortwave_radiation present but evapotranspiration absent → only evapotranspiration omitted', async () => {
  const { deps } = makeDeps((url) => {
    if (url.includes('basic-day_agro-day_basic-1h')) return makeBasicResponse();
    if (url.includes('agro-1h')) return { data_1h: { shortwave_radiation: [99] } };
    return null;
  });
  const data = await fetchWeather(LARACHE, deps);
  assert.deepEqual(data.data_1h.shortwave_radiation, [99], 'present field kept');
  assert.ok(!('evapotranspiration' in data.data_1h), 'missing field omitted, not set to undefined');
});

test('fetchWeather #9: agro OK with evapotranspiration present but shortwave/shortwaveradiation absent → only shortwave_radiation omitted', async () => {
  const { deps } = makeDeps((url) => {
    if (url.includes('basic-day_agro-day_basic-1h')) return makeBasicResponse();
    if (url.includes('agro-1h')) return { data_1h: { evapotranspiration: [0.6] } };
    return null;
  });
  const data = await fetchWeather(LARACHE, deps);
  assert.deepEqual(data.data_1h.evapotranspiration, [0.6], 'present field kept');
  assert.ok(!('shortwave_radiation' in data.data_1h), 'missing field omitted, not set to undefined');
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

test('fetchSpray #4: hollow HTTP 200 (quota exceeded, empty spraywindow) → returns null', async () => {
  const { deps } = makeDeps(() => makeHollowSprayResponse());
  const data = await fetchSpray(LARACHE, deps);
  assert.equal(data, null, 'hollow payload must be treated as a miss, not cached');
});

test('isValidWeatherPayload: valid basic response → true', () => {
  assert.equal(isValidWeatherPayload(makeBasicResponse()), true);
});

test('isValidWeatherPayload: hollow (empty data_day.time and data_1h.time) → false', () => {
  assert.equal(isValidWeatherPayload(makeHollowWeatherResponse()), false);
});

test('isValidWeatherPayload: missing data_day → false', () => {
  assert.equal(isValidWeatherPayload({ data_1h: { time: ['2026-07-30 00:00'] } }), false);
});

test('isValidWeatherPayload: missing data_1h → false', () => {
  assert.equal(isValidWeatherPayload({ data_day: { time: ['2026-07-30'] } }), false);
});

test('isValidWeatherPayload: data_day.time not an array → false', () => {
  assert.equal(isValidWeatherPayload({ data_day: { time: 'nope' }, data_1h: { time: ['x'] } }), false);
});

test('isValidWeatherPayload: null/undefined/non-object → false', () => {
  assert.equal(isValidWeatherPayload(null), false);
  assert.equal(isValidWeatherPayload(undefined), false);
  assert.equal(isValidWeatherPayload('string'), false);
  assert.equal(isValidWeatherPayload(42), false);
});

test('isValidSprayPayload: valid spray response → true', () => {
  assert.equal(isValidSprayPayload(SPRAY_RESPONSE), true);
});

test('isValidSprayPayload: hollow (empty spraywindow) → false', () => {
  assert.equal(isValidSprayPayload(makeHollowSprayResponse()), false);
});

test('isValidSprayPayload: missing data_1h → false', () => {
  assert.equal(isValidSprayPayload({}), false);
});

test('isValidSprayPayload: null → false', () => {
  assert.equal(isValidSprayPayload(null), false);
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
