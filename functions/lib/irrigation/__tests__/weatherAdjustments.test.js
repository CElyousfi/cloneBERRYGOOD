const test = require('node:test');
const assert = require('node:assert/strict');

const { buildWeatherRecommendations, getThresholds } = require('..');

function summary(diagnosis) {
  return { diagnosis, date: '2026-05-02', parcelle: 'P1', ferme: 'F5' };
}

test('null weather → no recos', () => {
  assert.deepEqual(buildWeatherRecommendations(null, null), []);
  assert.deepEqual(buildWeatherRecommendations(undefined, summary('optimal')), []);
});

test('mild weather → no recos', () => {
  const w = { tmax: 24, tmin: 14, humidity: 65, precip: 0, eto: 3.5 };
  const recos = buildWeatherRecommendations(w, summary('optimal'));
  assert.deepEqual(recos, []);
});

test('WEATHER_HEAT_BOOST fires when tmax >= 32', () => {
  const w = { tmax: 34, humidity: 50, eto: 4, precip: 0 };
  const recos = buildWeatherRecommendations(w, summary('optimal'));
  const reco = recos.find(r => r.code === 'WEATHER_HEAT_BOOST');
  assert.ok(reco);
  assert.equal(reco.level, 'warning');
});

test('WEATHER_HEAT_BOOST escalates to critical when under-drain', () => {
  const w = { tmax: 35, humidity: 50, eto: 4, precip: 0 };
  const recos = buildWeatherRecommendations(w, summary('under-drain'));
  const reco = recos.find(r => r.code === 'WEATHER_HEAT_BOOST');
  assert.equal(reco.level, 'critical');
  assert.match(reco.message, /drainage déjà insuffisant/);
});

test('HIGH_ETO_FORECAST fires when eto >= 5', () => {
  const w = { tmax: 28, humidity: 55, eto: 6.2, precip: 0 };
  const recos = buildWeatherRecommendations(w, summary('optimal'));
  const reco = recos.find(r => r.code === 'HIGH_ETO_FORECAST');
  assert.ok(reco);
  assert.match(reco.suggestedAction, /\+\d+ %/);
});

test('RAIN_FORECAST_REDUCE fires when precip >= 5', () => {
  const w = { tmax: 22, humidity: 80, eto: 2, precip: 12 };
  const recos = buildWeatherRecommendations(w, summary('optimal'));
  const reco = recos.find(r => r.code === 'RAIN_FORECAST_REDUCE');
  assert.ok(reco);
  assert.equal(reco.level, 'info');
});

test('RAIN + over-drain → bumped to warning', () => {
  const w = { tmax: 22, humidity: 80, eto: 2, precip: 12 };
  const recos = buildWeatherRecommendations(w, summary('over-drain'));
  const reco = recos.find(r => r.code === 'RAIN_FORECAST_REDUCE');
  assert.equal(reco.level, 'warning');
});

test('DRY_AIR_STRESS fires when humidity <= 30', () => {
  const w = { tmax: 28, humidity: 25, eto: 4, precip: 0 };
  const recos = buildWeatherRecommendations(w, summary('optimal'));
  const reco = recos.find(r => r.code === 'DRY_AIR_STRESS');
  assert.ok(reco);
});

test('multiple rules can co-fire and are sorted by severity', () => {
  // Heatwave + high ETo + dry air, on under-drained parcelle
  const w = { tmax: 36, humidity: 22, eto: 7, precip: 0 };
  const recos = buildWeatherRecommendations(w, summary('under-drain'));
  assert.ok(recos.length >= 3);
  // First should be critical (heat + under-drain)
  assert.equal(recos[0].level, 'critical');
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  for (let i = 1; i < recos.length; i++) {
    assert.ok(order[recos[i - 1].level] <= order[recos[i].level]);
  }
});

test('threshold override raises bar', () => {
  const w = { tmax: 33, humidity: 50, eto: 4, precip: 0 };
  const strict = getThresholds({ weatherHeatTmax: 38 });
  const recos = buildWeatherRecommendations(w, summary('optimal'), strict);
  assert.ok(!recos.some(r => r.code === 'WEATHER_HEAT_BOOST'));
});

test('non-numeric weather fields are ignored', () => {
  const w = { tmax: null, humidity: 'high', eto: undefined, precip: NaN };
  const recos = buildWeatherRecommendations(w, summary('optimal'));
  assert.deepEqual(recos, []);
});
