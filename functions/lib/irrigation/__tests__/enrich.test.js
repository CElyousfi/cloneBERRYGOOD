const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeReadings } = require('../normalize');
const { enrichEvents } = require('../enrich');
const { reading } = require('./fixtures');

test('enrichEvents: cumulative volumes & drainPct per pulse', () => {
  const raws = [
    reading({ heure: '08:00', points: [{ ec: 1.8, ph: 6.0, volume: 100 }], drainage: [{ ec: 2.0, ph: 5.9, volume: 20 }] }),
    reading({ heure: '10:00', points: [{ ec: 1.8, ph: 6.0, volume: 100 }], drainage: [{ ec: 2.0, ph: 5.9, volume: 30 }] }),
  ];
  const events = normalizeReadings(raws);
  const enr = enrichEvents(events);
  assert.equal(enr.length, 2);

  assert.equal(enr[0].cumulativeInputMl, 100);
  assert.equal(enr[0].cumulativeDrainMl, 20);
  assert.equal(enr[0].drainPct, 20);
  assert.equal(enr[0].timeSincePreviousPulseMin, null);

  assert.equal(enr[1].cumulativeInputMl, 200);
  assert.equal(enr[1].cumulativeDrainMl, 50);
  assert.equal(enr[1].drainPct, 30);
  assert.equal(enr[1].cumulativeDrainPct, 25);
  assert.equal(enr[1].timeSincePreviousPulseMin, 120);
});

test('enrichEvents: ecDelta computed when both sides positive', () => {
  const raws = [reading({ points: [{ ec: 1.8, ph: 6.0, volume: 100 }], drainage: [{ ec: 2.5, ph: 5.8, volume: 20 }] })];
  const enr = enrichEvents(normalizeReadings(raws));
  assert.ok(Math.abs(enr[0].ecDelta - 0.7) < 1e-9);
});

test('enrichEvents: late-day flag flips at lateDayHour boundary', () => {
  const raws = [
    reading({ heure: '14:59' }),
    reading({ heure: '15:00' }),
    reading({ heure: '17:00' }),
  ];
  const enr = enrichEvents(normalizeReadings(raws));
  // sorted ascending by heure
  assert.equal(enr[0].isLateDayPulse, false);
  assert.equal(enr[1].isLateDayPulse, true);
  assert.equal(enr[2].isLateDayPulse, true);
});

test('enrichEvents: events with no heure are placed last with null time features', () => {
  const raws = [
    reading({ heure: '10:00' }),
    reading({ heure: null }),
    reading({ heure: '08:00' }),
  ];
  const enr = enrichEvents(normalizeReadings(raws));
  assert.equal(enr[0].heure, '08:00');
  assert.equal(enr[1].heure, '10:00');
  assert.equal(enr[2].heure, null);
  assert.equal(enr[2].minutesFromMidnight, null);
});

test('enrichEvents: groups by (parcelle, date), no cross-contamination', () => {
  const raws = [
    reading({ parcelle: 'P1', heure: '08:00' }),
    reading({ parcelle: 'P2', heure: '08:30' }),
    reading({ parcelle: 'P1', heure: '10:00' }),
  ];
  const enr = enrichEvents(normalizeReadings(raws));
  const p1 = enr.filter(e => e.parcelle === 'P1');
  const p2 = enr.filter(e => e.parcelle === 'P2');
  assert.equal(p2[0].cumulativeInputMl, 100);
  // P1 second pulse must see P1 first cumulative (100), not P2's
  assert.equal(p1[1].cumulativeInputMl, 200);
});

test('enrichEvents: empty / null input returns empty array', () => {
  assert.deepEqual(enrichEvents([]), []);
  assert.deepEqual(enrichEvents(null), []);
  assert.deepEqual(enrichEvents(undefined), []);
});
