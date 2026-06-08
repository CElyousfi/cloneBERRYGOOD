const test = require('node:test');
const assert = require('node:assert/strict');

const { runDailyPhenologyJob, __internals } = require('../dailyPhenologyJob');
const { MARAVILLA_FLORICANE, sineDay } = require('./fixtures');

const DATE = '2026-05-19';
const PLOT_PILOT = {
  id: 'ML-T-LAR-01',
  shelter: { type: 'tunnel' },
  location: { latitude: 35.08, longitude: -6.14 },
  sensors: { farmroad: { stationId: 'farmroad_tunnel_main', deviceId: '210506960' } },
  phenology: {
    enabled: true,
    variety: 'maravilla',
    cycleType: 'floricane',
    parToRadiationRatio: 0.46,
    precocityCoefficient: 1.0,
    customStageThresholds: null,
    currentStage: 'F0',
    gddCumul: 0,
    daysInStage: 0,
  },
};

const STATION_TUNNEL = {
  stationId: 'farmroad_tunnel_main',
  type: 'tunnel',
  deviceId: '210506960',
  status: 'active',
};

function makeJobDeps({
  plots = [PLOT_PILOT],
  station = STATION_TUNNEL,
  envOverride = null,
  previousDaily = null,
  loggerCollect = false,
  resolveStationThrows = false,
  writeThrows = false,
} = {}) {
  const writes = [];
  const logs = [];
  return {
    deps: {
      listEnabledPlots: async () => plots,
      resolveStation: async () => {
        if (resolveStationThrows) throw new Error('resolveStation boom');
        return station;
      },
      fetchRadiationDaily: async () => envOverride || {
        tMin: 14, tMax: 28,
        samples: sineDay({ count: 96, peakPar: 1000 }),
        dataQuality: 'good',
        dataSources: {
          temperature: { source: 'farmroad', stationId: 'farmroad_tunnel_main', quality: 'good' },
          radiation: { source: 'farmroad', stationId: 'farmroad_tunnel_main', sensor: 'both', quality: 'good' },
        },
      },
      loadReference: async () => MARAVILLA_FLORICANE,
      readPhenologyDaily: async () => previousDaily,
      writePhenologyDaily: async (plotId, date, computed) => {
        if (writeThrows) throw new Error('Firestore down');
        writes.push({ plotId, date, computed });
        const previousStage = computed.previousStage;
        const transitionDetected = previousStage != null && previousStage !== computed.currentStage.code;
        const daysInStage = transitionDetected ? 1 : (computed.previousDaysInStage || 0) + 1;
        return { written: true, transitionDetected, daysInStage };
      },
      logger: (msg) => { if (loggerCollect) logs.push(msg); },
    },
    writes,
    logs,
  };
}

// =====================================================================

test('job #1: happy path 1 plot → processed=1, failed=0, write OK', async () => {
  const { deps, writes } = makeJobDeps();
  const r = await runDailyPhenologyJob(DATE, deps);
  assert.equal(r.processed, 1);
  assert.equal(r.failed, 0);
  assert.equal(r.plots[0].status, 'ok');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].plotId, 'ML-T-LAR-01');
  assert.equal(writes[0].date, DATE);
  // First day (no previousDaily) → cumul = day
  const c = writes[0].computed;
  assert.ok(c.gddCumul > 0);
  assert.equal(c.previousStage, 'F0', 'previousStage falls back to plot.phenology.currentStage on first run');
  assert.equal(c.dataQuality, 'good');
});

test('job #2: plot phenology.enabled=false → skipped (not in results)', async () => {
  const disabledPlot = { ...PLOT_PILOT, phenology: { ...PLOT_PILOT.phenology, enabled: false } };
  // listEnabledPlots already filters — we pass empty
  const { deps } = makeJobDeps({ plots: [] });
  const r = await runDailyPhenologyJob(DATE, deps);
  assert.equal(r.processed, 0);
  assert.equal(r.failed, 0);
  assert.equal(r.plots.length, 0);
});

test('job #3: dataQuality=good → phenology_daily written normally + correct fields', async () => {
  const { deps, writes } = makeJobDeps();
  await runDailyPhenologyJob(DATE, deps);
  const c = writes[0].computed;
  assert.equal(c.dataQuality, 'good');
  assert.ok(c.gddDay > 0);
  assert.ok(c.radsumDay > 0);
  assert.ok(c.dliDay > 0);
  assert.ok(c.irrigationRecipe != null);
  assert.ok(c.dliVsTarget != null);
});

test('job #4: dataQuality=fallback (Open-Meteo) → cumul incremented, source tagged', async () => {
  const { deps, writes } = makeJobDeps({
    envOverride: {
      tMin: 12, tMax: 26,
      samples: sineDay({ count: 96, peakPar: 700 }),
      dataQuality: 'fallback',
      dataSources: {
        temperature: { source: 'openmeteo', stationId: null, quality: 'fallback' },
        radiation: { source: 'openmeteo', stationId: null, sensor: 'radiation', quality: 'fallback' },
      },
    },
    previousDaily: { gddCumul: 200, radsumCumulMjM2: 150, dliCumulMolM2: 300, stage: { code: 'F1' }, daysInStage: 5 },
  });
  await runDailyPhenologyJob(DATE, deps);
  const c = writes[0].computed;
  assert.equal(c.dataQuality, 'fallback');
  assert.ok(c.gddCumul > 200, 'cumul incremented from 200 baseline');
  assert.equal(c.dataSources.temperature.source, 'openmeteo');
});

test('job #5: dataQuality=unavailable → placeholder doc, gddDay=null, cumul preserved, WARN log grep-friendly', async () => {
  const { deps, writes, logs } = makeJobDeps({
    envOverride: {
      tMin: null, tMax: null,
      samples: [],
      dataQuality: 'unavailable',
      dataSources: {
        temperature: { source: null, stationId: null, quality: 'unavailable' },
        radiation: { source: null, stationId: null, sensor: null, quality: 'unavailable' },
      },
    },
    previousDaily: { gddCumul: 350, radsumCumulMjM2: 220, dliCumulMolM2: 450, stage: { code: 'F2' }, daysInStage: 3 },
    loggerCollect: true,
  });
  const r = await runDailyPhenologyJob(DATE, deps);
  assert.equal(r.plots[0].dataQuality, 'unavailable');
  const c = writes[0].computed;
  assert.equal(c.gddDay, null);
  assert.equal(c.gddCumul, 350, 'cumul preserved from previous');
  assert.equal(c.radsumCumul, 220);
  assert.equal(c.dliCumul, 450);
  assert.equal(c.currentStage.code, 'F2', 'stage preserved from previous');

  // WARN log grep-friendly: 'WARN: both FarmRoad and Open-Meteo down'
  const warn = logs.find(l => l.includes('WARN: both'));
  assert.ok(warn, 'WARN log expected (grep "WARN: both" in Cloud Functions logs)');
  assert.ok(warn.includes('dataQuality=UNAVAILABLE'));
  assert.ok(warn.includes('gddCumul=350(preserved)'));
});

test('job #6: stage transition detected → flagged, log structured', async () => {
  // Previous F2 with high gddCumul; today brings us into F3 (anthesis, criticalStage)
  // MARAVILLA_FLORICANE: F2 gddMin=450, F3 gddMin=700
  // Set previous cumul at 695, today gddDay ~15 → 710 → F3
  const { deps, writes, logs } = makeJobDeps({
    previousDaily: { gddCumul: 695, radsumCumulMjM2: 400, dliCumulMolM2: 800, stage: { code: 'F2' }, daysInStage: 14 },
    loggerCollect: true,
  });
  await runDailyPhenologyJob(DATE, deps);
  const c = writes[0].computed;
  assert.equal(c.previousStage, 'F2');
  assert.equal(c.currentStage.code, 'F3');
  assert.equal(c.currentStage.criticalStage, true);
  assert.ok(logs.some(l => l.includes('transition=true')), 'transition logged');
});

test('job #7: error on plot X → plot Y continues (failed=1, processed=1)', async () => {
  const plotA = { ...PLOT_PILOT, id: 'PLOT-A' };
  const plotB = { ...PLOT_PILOT, id: 'PLOT-B' };
  let firstCall = true;
  const deps = {
    listEnabledPlots: async () => [plotA, plotB],
    resolveStation: async (plot) => {
      if (plot.id === 'PLOT-A') throw new Error('PLOT-A station resolve failed');
      return STATION_TUNNEL;
    },
    fetchRadiationDaily: async () => ({
      tMin: 14, tMax: 28, samples: sineDay({ count: 96, peakPar: 1000 }), dataQuality: 'good',
      dataSources: { temperature: { source: 'farmroad', stationId: 'X', quality: 'good' }, radiation: { source: 'farmroad', stationId: 'X', sensor: 'both', quality: 'good' } },
    }),
    loadReference: async () => MARAVILLA_FLORICANE,
    readPhenologyDaily: async () => null,
    writePhenologyDaily: async () => ({ written: true, transitionDetected: false, daysInStage: 1 }),
    logger: () => {},
  };
  const r = await runDailyPhenologyJob(DATE, deps);
  assert.equal(r.processed, 1);
  assert.equal(r.failed, 1);
  assert.equal(r.plots.find(p => p.plotId === 'PLOT-A').status, 'error');
  assert.equal(r.plots.find(p => p.plotId === 'PLOT-B').status, 'ok');
});

test('job #8: input validation', async () => {
  const dummy = {
    listEnabledPlots: async () => [], resolveStation: async () => null,
    fetchRadiationDaily: async () => null, loadReference: async () => null,
    readPhenologyDaily: async () => null, writePhenologyDaily: async () => null,
  };
  await assert.rejects(() => runDailyPhenologyJob('bad', dummy), TypeError);
  await assert.rejects(() => runDailyPhenologyJob(DATE, {}), TypeError);
  await assert.rejects(() => runDailyPhenologyJob(DATE, { ...dummy, listEnabledPlots: undefined }), TypeError);
});

// ─── Bonus ─────────────────────────────────────────────────────────────

test('job: _previousDayString helper', () => {
  assert.equal(__internals._previousDayString('2026-05-19'), '2026-05-18');
  assert.equal(__internals._previousDayString('2026-01-01'), '2025-12-31');
  assert.equal(__internals._previousDayString('2026-03-01'), '2026-02-28');
});

test('job: full E2E smoke — pilot plot floricane, no previous, sunny day → cumul = day, stage F0', async () => {
  const { deps, writes } = makeJobDeps();
  const r = await runDailyPhenologyJob(DATE, deps);
  const c = writes[0].computed;

  // GDD: sineDay tMin=14, tMax=28 → calculateDailyGdd = (28+14)/2 - 5 = 16
  // But our env uses tMin=14, tMax=28 from default. ref.tBase=5, tCap=30
  // gddDay = (28+14)/2 - 5 = 16
  assert.equal(c.gddDay, 16);
  assert.equal(c.gddCumul, 16, 'first day cumul = day');
  // Stage F0 (gddMin=0, gddMax=150), cumul=16 → still F0
  assert.equal(c.currentStage.code, 'F0');
  // DLI from sunny sine → ~27 mol/m²
  assert.ok(c.dliDay > 20 && c.dliDay < 35);
  // No transition (first run)
  assert.equal(r.plots[0].transitionDetected, false);
});

// ─── Fix Sprint 2 : plot.location défensif ────────────────────────────────

test('job: plot sans location → fallback sur station.location (processed)', async () => {
  const plotNoLoc = { ...PLOT_PILOT };
  delete plotNoLoc.location;
  const stationWithLoc = { ...STATION_TUNNEL, location: { latitude: 35.08, longitude: -6.14 } };
  let capturedPlotLocation = null;
  const { deps, writes } = makeJobDeps({ plots: [plotNoLoc], station: stationWithLoc });
  // intercepter le plotLocation passé à fetchRadiationDaily
  const origFetch = deps.fetchRadiationDaily;
  deps.fetchRadiationDaily = async (args) => {
    capturedPlotLocation = args.plotLocation;
    return origFetch(args);
  };
  const r = await runDailyPhenologyJob(DATE, deps);
  assert.equal(r.processed, 1);
  assert.equal(r.skipped, 0);
  assert.equal(r.plots[0].status, 'ok');
  assert.deepEqual(capturedPlotLocation, { latitude: 35.08, longitude: -6.14 });
  assert.equal(writes.length, 1);
});

test('job: ni plot.location ni station.location → skipped proprement (pas de crash)', async () => {
  const plotNoLoc = { ...PLOT_PILOT };
  delete plotNoLoc.location;
  // STATION_TUNNEL n'a pas de location
  const { deps, writes } = makeJobDeps({ plots: [plotNoLoc], station: STATION_TUNNEL });
  const r = await runDailyPhenologyJob(DATE, deps);
  assert.equal(r.processed, 0);
  assert.equal(r.failed, 0);
  assert.equal(r.skipped, 1);
  assert.equal(r.plots[0].status, 'skipped');
  assert.equal(r.plots[0].reason, 'no_location');
  assert.equal(writes.length, 0, 'aucune écriture phenology_daily quand skip');
});
