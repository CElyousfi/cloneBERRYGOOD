const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveStation } = require('../farmroadStationResolver');

const TUNNEL_MAIN = {
  stationId: 'farmroad_tunnel_main',
  type: 'tunnel',
  deviceId: '210506960',
  status: 'active',
  isDefaultForType: true,
};
const CANARIENNE_MAIN = {
  stationId: 'farmroad_canarienne_main',
  type: 'canarienne',
  deviceId: '210506929',
  status: 'active',
  isDefaultForType: true,
};
const TUNNEL_SECONDARY = {
  stationId: 'farmroad_tunnel_secondary',
  type: 'tunnel',
  deviceId: '210506999',
  status: 'active',
  isDefaultForType: false,
};

let warnLog = [];
function makeDeps({ byId = {}, byType = {} } = {}) {
  warnLog = [];
  return {
    readStationById: async (id) => byId[id] || null,
    listStationsByType: async (t) => byType[t] || [],
    logWarn: (msg, ctx) => { warnLog.push({ msg, ctx }); },
  };
}
const anyWarn = (re) => warnLog.some(w => re.test(w.msg));

test('station #1: explicit plot.sensors.farmroad.stationId → returns that station', async () => {
  const plot = { id: 'ML-T-LAR-01', shelter: { type: 'tunnel' }, sensors: { farmroad: { stationId: 'farmroad_tunnel_main' } } };
  const deps = makeDeps({ byId: { farmroad_tunnel_main: TUNNEL_MAIN } });
  const r = await resolveStation(plot, deps);
  assert.equal(r.stationId, 'farmroad_tunnel_main');
});

test('station #2: explicit stationId not found → returns null + logs warn', async () => {
  const plot = { id: 'P1', shelter: { type: 'tunnel' }, sensors: { farmroad: { stationId: 'ghost_station' } } };
  const deps = makeDeps({ byId: {}, byType: {} });
  const r = await resolveStation(plot, deps);
  assert.equal(r, null);
  assert.ok(anyWarn(/not found/), 'at least one warn matches "not found" — collected: ' + JSON.stringify(warnLog));
});

test('station #3: no explicit stationId → fallback by shelter type returns matching default', async () => {
  const plot = { id: 'P2', shelter: { type: 'tunnel' }, sensors: { farmroad: {} } };
  const deps = makeDeps({ byType: { tunnel: [TUNNEL_MAIN] } });
  const r = await resolveStation(plot, deps);
  assert.equal(r.stationId, 'farmroad_tunnel_main');
});

test('station #4: multiple matches → priority isDefaultForType=true, then deterministic stationId order', async () => {
  const plot = { id: 'P3', shelter: { type: 'tunnel' }, sensors: {} };
  const deps = makeDeps({ byType: { tunnel: [TUNNEL_SECONDARY, TUNNEL_MAIN] } });
  const r = await resolveStation(plot, deps);
  assert.equal(r.stationId, 'farmroad_tunnel_main', 'default wins over non-default');

  // Tie-break: 2 defaults → lowest stationId
  const TUNNEL_ALT = { ...TUNNEL_MAIN, stationId: 'farmroad_tunnel_alt' };
  const deps2 = makeDeps({ byType: { tunnel: [TUNNEL_MAIN, TUNNEL_ALT] } });
  const r2 = await resolveStation(plot, deps2);
  assert.equal(r2.stationId, 'farmroad_tunnel_alt', 'alphabetical order on tie');
});

test('station #5: station with status="offline" → still returned (caller decides fallback)', async () => {
  const offline = { ...TUNNEL_MAIN, status: 'offline' };
  const plot = { id: 'P4', shelter: { type: 'tunnel' }, sensors: { farmroad: { stationId: 'farmroad_tunnel_main' } } };
  const deps = makeDeps({ byId: { farmroad_tunnel_main: offline } });
  const r = await resolveStation(plot, deps);
  assert.equal(r.status, 'offline');
  assert.equal(r.stationId, 'farmroad_tunnel_main');
});

test('station #6: no matching station at all → returns null gracefully', async () => {
  const plot = { id: 'P5', shelter: { type: 'canarienne' }, sensors: {} };
  const deps = makeDeps({ byType: { canarienne: [] } });
  const r = await resolveStation(plot, deps);
  assert.equal(r, null);
  assert.ok(anyWarn(/no station matches/));
});

test('station: no shelter.type → null + warn', async () => {
  const plot = { id: 'P6', shelter: {}, sensors: {} };
  const deps = makeDeps();
  const r = await resolveStation(plot, deps);
  assert.equal(r, null);
  assert.ok(anyWarn(/no shelter\.type/));
});

test('station: input validation', async () => {
  await assert.rejects(() => resolveStation(null, makeDeps()), TypeError);
  await assert.rejects(() => resolveStation({}, {}), TypeError);
});
