const test = require('node:test');
const assert = require('node:assert/strict');

const { recommendNextPulse, analyseReadings } = require('..');
const { reading, station } = require('./fixtures');

function pulse(overrides) {
  return {
    drainPct: 22,
    ecDelta: 0.1,
    isHighDrain: false,
    isLowDrain: false,
    isLateDayPulse: false,
    heure: '10:00',
    minutesFromMidnight: 600,
    ...overrides,
  };
}
function summary(overrides) {
  return {
    date: '2026-05-02', parcelle: 'P1', ferme: 'F5', parcelleLabel: 'X',
    totalInputMl: 400, totalDrainMl: 90, totalDrainPct: 22.5,
    avgEcPts: 1.8, avgEcDrain: 1.95, avgPhPts: 6, avgPhDrain: 5.8,
    pulseCount: 4, highDrainPulseCount: 0, lowDrainPulseCount: 0,
    irrigationCutoffTime: '10:00',
    drainTrend: null, diagnosis: 'optimal', diagnosisReasons: [],
    pulses: [pulse({ heure: '08:00' }), pulse({ heure: '09:00' }), pulse({ heure: '10:00' })],
    ...overrides,
  };
}

test('null/empty summary → generic "Pulse enregistré"', () => {
  const r = recommendNextPulse(null);
  assert.equal(r.status, 'ok');
  assert.equal(r.headline, 'Pulse enregistré');
  assert.equal(r.todayKpis, null);
});

test('balanced day → status ok', () => {
  const r = recommendNextPulse(summary());
  assert.equal(r.status, 'ok');
  assert.match(r.headline, /Pulse OK/);
  assert.equal(r.todayKpis.pulseCount, 3);
  assert.match(r.nextAction.label, /Continuer/);
});

test('critical drain on last pulse → stop / -2 min', () => {
  const last = pulse({ heure: '11:00', drainPct: 42, isHighDrain: true });
  const r = recommendNextPulse(summary({ pulses: [pulse(), last], totalDrainPct: 38 }));
  assert.equal(r.status, 'critical');
  assert.match(r.nextAction.label, /-2 min/);
  assert.equal(r.whenNext.minIntervalMin, 90);
});

test('high drain (>30%) → reduce -1 min', () => {
  const last = pulse({ heure: '11:00', drainPct: 33, isHighDrain: true });
  const r = recommendNextPulse(summary({ pulses: [pulse(), last] }));
  assert.equal(r.status, 'warning');
  assert.match(r.nextAction.label, /-1 min/);
});

test('low drain (<15%) → increase +1 min', () => {
  const last = pulse({ heure: '11:00', drainPct: 8, isLowDrain: true });
  const r = recommendNextPulse(summary({ pulses: [pulse(), last] }));
  assert.equal(r.status, 'warning');
  assert.match(r.nextAction.label, /\+1 min/);
});

test('high EC delta + sub-target drainage → salt watch', () => {
  const last = pulse({ heure: '11:00', drainPct: 18, ecDelta: 0.6 });
  const r = recommendNextPulse(summary({ pulses: [last], totalDrainPct: 18 }));
  assert.equal(r.status, 'info');
  assert.match(r.headline, /saline/);
});

test('late-day pulse with saturated substrate → STOP today', () => {
  const last = pulse({ heure: '17:30', minutesFromMidnight: 17.5 * 60, drainPct: 28, isLateDayPulse: true });
  const r = recommendNextPulse(summary({ pulses: [last], totalDrainPct: 28 }));
  assert.equal(r.status, 'critical');
  assert.match(r.nextAction.label, /Arr.ter/);
  assert.equal(r.whenNext.minIntervalMin, null);
});

test('heat-wave forecast → keep duration, fractionate', () => {
  const r = recommendNextPulse(summary(), { tmax: 35, humidity: 50, eto: 6 });
  assert.equal(r.status, 'info');
  assert.match(r.nextAction.label, /fractionne/);
});

test('end-to-end via analyseReadings + recommendNextPulse', () => {
  const raws = [
    reading({ heure: '08:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 22)] }),
    reading({ heure: '10:00', points: [station(1.8, 6.0, 100)], drainage: [station(2.0, 5.9, 35)] }),
  ];
  const { summaries } = analyseReadings(raws);
  const r = recommendNextPulse(summaries[0]);
  assert.equal(r.status, 'warning');
  assert.match(r.nextAction.label, /-1 min/);
  assert.ok(r.todayKpis.pulseCount === 2);
});
