const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeReading, normalizeReadings } = require('../normalize');
const { reading, scenarioMissingData } = require('./fixtures');

test('normalizeReading: averages EC/pH and sums volumes across stations', () => {
  const raw = reading({
    points: [
      { ec: 1.8, ph: 6.0, volume: 100 },
      { ec: 2.0, ph: 6.2, volume: 110 },
    ],
    drainage: [
      { ec: 2.0, ph: 5.8, volume: 20 },
      { ec: 2.2, ph: 5.9, volume: 25 },
    ],
  });
  const ev = normalizeReading(raw);
  assert.equal(ev.ecPts, 1.9);
  assert.equal(ev.phPts, 6.1);
  assert.equal(ev.volumePtsMl, 210);
  assert.equal(ev.ecDrain, 2.1);
  assert.equal(ev.volumeDrainMl, 45);
  assert.equal(ev.stationCount, 2);
});

test('normalizeReading: returns null fields when no positive values', () => {
  const ev = normalizeReading(reading({ points: [{ ec: 0, ph: 0, volume: 0 }], drainage: [] }));
  assert.equal(ev.ecPts, null);
  assert.equal(ev.phPts, null);
  assert.equal(ev.volumePtsMl, null);
  assert.equal(ev.ecDrain, null);
});

test('normalizeReading: null/undefined input returns null', () => {
  assert.equal(normalizeReading(null), null);
  assert.equal(normalizeReading(undefined), null);
  assert.equal(normalizeReading('not an object'), null);
});

test('normalizeReadings: filters out unparseable / missing-key items', () => {
  const events = normalizeReadings(scenarioMissingData);
  // Items kept: must have date AND parcelle
  for (const e of events) {
    assert.ok(e.date, 'date must be present');
    assert.ok(e.parcelle, 'parcelle must be present');
  }
  // No throws on empty / null / undefined / bad strings
  assert.doesNotThrow(() => normalizeReadings([]));
  assert.doesNotThrow(() => normalizeReadings(null));
  assert.doesNotThrow(() => normalizeReadings(undefined));
});

test('normalizeReading: tolerates string numbers', () => {
  const ev = normalizeReading(reading({
    points: [{ ec: '1.85', ph: '6.05', volume: '120' }],
    drainage: [{ ec: '2.10', ph: '5.85', volume: '25' }],
  }));
  assert.ok(Math.abs(ev.ecPts - 1.85) < 1e-9);
  assert.equal(ev.volumePtsMl, 120);
});
