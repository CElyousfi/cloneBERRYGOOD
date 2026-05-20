const test = require('node:test');
const assert = require('node:assert/strict');

const { writePhenologyDaily } = require('../phenologyDailyWriter');

const BASE_DATA = {
  gddDay: 15.0,
  gddCumul: 15.0,
  radsumDay: 12.5,
  radsumCumul: 12.5,
  dliDay: 26.3,
  dliCumul: 26.3,
  currentStage: { code: 'F0', name: 'Débourrement', criticalStage: false },
  previousStage: null,         // premier jour
  previousDaysInStage: 0,
  tMin: 14, tMax: 28, tMaxCapped: 28,
  radiationMaxWm2: 1017, parMaxUmolM2s: 2138,
  irrigationRecipe: { ec_min: 1.2, ec_max: 1.4, ph_min: 5.6, ph_max: 5.8, drainage_pct_target: 12, drainage_pct_min: 10, drainage_pct_max: 15 },
  dliVsTarget: { status: 'above_critical', stageMin: 8, stageMax: 15 },
  dataQuality: 'good',
  dataSources: {
    temperature: { source: 'farmroad', stationId: 'farmroad_tunnel_main', quality: 'good' },
    radiation: { source: 'farmroad', stationId: 'farmroad_tunnel_main', sensor: 'both', quality: 'good' },
  },
  computedAt: 1779185000000,
};

function makeDeps() {
  const writes = [];
  const updates = [];
  return {
    deps: {
      writeDoc: async (plotId, date, doc) => { writes.push({ plotId, date, doc }); },
      updatePlotPhenologyState: async (plotId, partial) => { updates.push({ plotId, partial }); },
    },
    writes,
    updates,
  };
}

test('writer #1: first day (previousStage=null) → daysInStage=1, no transition', async () => {
  const { deps, writes, updates } = makeDeps();
  const r = await writePhenologyDaily('ML-T-LAR-01', '2026-05-19', BASE_DATA, deps);

  assert.equal(r.written, true);
  assert.equal(r.transitionDetected, false);
  assert.equal(r.daysInStage, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].doc.daysInStage, 1);
  assert.equal(writes[0].doc.stageTransition, null);
  assert.equal(updates[0].partial['phenology.daysInStage'], 1);
});

test('writer #2: N+1 same stage → daysInStage += 1, no transition', async () => {
  const { deps, writes } = makeDeps();
  const data = { ...BASE_DATA, previousStage: 'F0', previousDaysInStage: 12, currentStage: { code: 'F0', name: 'Débourrement' } };
  const r = await writePhenologyDaily('ML-T-LAR-01', '2026-05-19', data, deps);

  assert.equal(r.transitionDetected, false);
  assert.equal(r.daysInStage, 13);
  assert.equal(writes[0].doc.daysInStage, 13);
});

test('writer #3: stage transition F2 → F3 (critical) → daysInStage reset to 1 + log', async () => {
  const { deps, writes, updates } = makeDeps();
  const data = {
    ...BASE_DATA,
    previousStage: 'F2',
    previousDaysInStage: 8,
    currentStage: { code: 'F3', name: 'Floraison', criticalStage: true },
  };
  const r = await writePhenologyDaily('ML-T-LAR-01', '2026-05-19', data, deps);

  assert.equal(r.transitionDetected, true);
  assert.equal(r.daysInStage, 1);
  assert.deepEqual(writes[0].doc.stageTransition, { from: 'F2', to: 'F3', criticalStage: true });
  assert.equal(updates[0].partial['phenology.currentStage'], 'F3');
});

test('writer #4: re-run same date → overwrite simple (2nd call overwrites 1st)', async () => {
  const { deps, writes } = makeDeps();
  await writePhenologyDaily('ML-T-LAR-01', '2026-05-19', BASE_DATA, deps);
  await writePhenologyDaily('ML-T-LAR-01', '2026-05-19', { ...BASE_DATA, gddDay: 18, gddCumul: 33 }, deps);

  // 2 writes recorded — caller (Firestore) will overwrite on same docId
  assert.equal(writes.length, 2);
  assert.equal(writes[0].doc.gddDay, 15);
  assert.equal(writes[1].doc.gddDay, 18);
  assert.equal(writes[1].doc.gddCumul, 33);
});

test('writer #5: writeDoc throws → error propagated', async () => {
  const deps = {
    writeDoc: async () => { throw new Error('Firestore down'); },
    updatePlotPhenologyState: async () => {},
  };
  await assert.rejects(() => writePhenologyDaily('ML-T-LAR-01', '2026-05-19', BASE_DATA, deps), /Firestore down/);
});

test('writer #6: input validation', async () => {
  const { deps } = makeDeps();
  await assert.rejects(() => writePhenologyDaily('', '2026-05-19', BASE_DATA, deps), TypeError);
  await assert.rejects(() => writePhenologyDaily('P1', 'bad-date', BASE_DATA, deps), TypeError);
  await assert.rejects(() => writePhenologyDaily('P1', '2026-05-19', null, deps), TypeError);
  await assert.rejects(() => writePhenologyDaily('P1', '2026-05-19', { ...BASE_DATA, currentStage: {} }, deps), TypeError);
  await assert.rejects(() => writePhenologyDaily('P1', '2026-05-19', { ...BASE_DATA, dataQuality: null }, deps), TypeError);
  await assert.rejects(() => writePhenologyDaily('P1', '2026-05-19', BASE_DATA, {}), TypeError);
});

test('writer: full doc schema matches B2 spec', async () => {
  const { deps, writes } = makeDeps();
  await writePhenologyDaily('ML-T-LAR-01', '2026-05-19', BASE_DATA, deps);
  const doc = writes[0].doc;
  const requiredKeys = [
    'date', 'dataSources', 'tMin', 'tMax', 'tMaxCapped',
    'radiationMaxWm2', 'parMaxUmolM2s',
    'gddDay', 'radsumDayMjM2', 'dliDayMolM2',
    'gddCumul', 'radsumCumulMjM2', 'dliCumulMolM2',
    'stage', 'daysInStage', 'irrigationRecipe', 'dliVsTarget',
    'dataQuality', 'stageTransition', 'computedAt', '_meta',
  ];
  for (const key of requiredKeys) {
    assert.ok(key in doc, `doc must contain field "${key}"`);
  }
  assert.equal(doc.stage.code, 'F0');
  assert.equal(doc._meta.jobVersion, 'sprint2-v1');
});

test('writer: dataQuality=unavailable → gddDayLast=0 in plot update (preserves cumul)', async () => {
  const { deps, updates } = makeDeps();
  const data = {
    ...BASE_DATA,
    gddDay: null, radsumDay: null, dliDay: null,
    dataQuality: 'unavailable',
  };
  await writePhenologyDaily('ML-T-LAR-01', '2026-05-19', data, deps);
  assert.equal(updates[0].partial['phenology.gddDayLast'], 0, 'gddDayLast falls back to 0 when null');
  assert.equal(updates[0].partial['phenology.radsumDayLast'], 0);
});
