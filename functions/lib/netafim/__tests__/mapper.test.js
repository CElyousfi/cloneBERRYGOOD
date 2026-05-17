'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mapNetafimItemToReading,
  buildDocId,
  durationToMinutes,
  toLocalDate,
  toLocalHour,
  DOC_ID_PREFIX,
  FERME,
} = require('../mapper');
const { netafimItem } = require('./fixtures');

test('buildDocId: prefixes Netafim id; null on empty', () => {
  assert.equal(buildDocId('3212'), DOC_ID_PREFIX + '3212');
  assert.equal(buildDocId(null), null);
  assert.equal(buildDocId(''), null);
  assert.equal(buildDocId('  '), null);
});

test('durationToMinutes: parses HH:mm:ss', () => {
  assert.equal(durationToMinutes('00:05:58'), 6);
  assert.equal(durationToMinutes('01:30:00'), 90);
  assert.equal(durationToMinutes('00:00:00'), 0);
  assert.equal(durationToMinutes(null), null);
  assert.equal(durationToMinutes('garbage'), null);
});

test('toLocalDate: shifts to Africa/Casablanca local day', () => {
  // 2024-07-01 23:30 UTC = 2024-07-02 00:30 in Africa/Casablanca (UTC+1)
  assert.equal(toLocalDate('2024-07-01T23:30:00Z'), '2024-07-02');
  // Netafim emits offset-bearing strings; round-trip the date intact
  assert.equal(toLocalDate('2024-07-01T00:00:00.000000+03:00'), '2024-06-30');
});

test('toLocalHour: uses startTime when valid, else derives from timestamp', () => {
  assert.equal(toLocalHour('08:00:03', null), '08:00');
  assert.equal(toLocalHour(null, '2024-07-01T08:00:00.000000+00:00'), '09:00'); // UTC+1
  assert.equal(toLocalHour(null, null), null);
});

test('mapNetafimItemToReading: full mapping of canonical PDF sample', () => {
  const out = mapNetafimItemToReading(netafimItem(), { now: 1700000000000 });
  assert.ok(out);
  assert.equal(out.docId, DOC_ID_PREFIX + '3212');
  const d = out.data;
  assert.equal(d.ferme, FERME);
  assert.equal(d.date, '2024-06-30'); // PDF date is in +03:00 → 2024-06-30 in Africa/Casablanca
  assert.equal(d.heure, '08:00');
  assert.equal(d.parcelle, 'a16ba43c-deb7-42df-9ce9-4bb00f550f62');
  assert.equal(d.parcelleLabel, 'Olive1');
  assert.equal(d.valveName, 'Olive1');
  assert.equal(d.shiftNumber, 1);
  assert.equal(d.duree, 6);
  assert.equal(d.volumeM3, 1.2);
  assert.equal(d.flowM3h, 12.5);
  assert.equal(d.programName, 'olive');
  assert.equal(d.netafimId, '3212');
  assert.deepEqual(d.drainage, []);
  assert.equal(d.points.length, 1);
  assert.equal(d.points[0].volume, 1200);
  assert.equal(d.points[0].ec, 1.85);
  assert.equal(d.points[0].ph, 6.1);
  assert.equal(d.createdAt, 1700000000000);
  assert.equal(d.updatedAt, 1700000000000);
  assert.equal(d.createdBy, 'netafim-cron');
  assert.equal(d.meta.netafim.farmId, 'prod-nb10200');
});

test('mapNetafimItemToReading: averageEC/PH = 0 → null (sensor absent)', () => {
  const out = mapNetafimItemToReading(netafimItem({ averageEC: 0, averagePH: 0 }));
  assert.equal(out.data.points[0].ec, null);
  assert.equal(out.data.points[0].ph, null);
});

test('mapNetafimItemToReading: missing id → null (cannot be persisted)', () => {
  assert.equal(mapNetafimItemToReading(netafimItem({ id: '' })), null);
  assert.equal(mapNetafimItemToReading(null), null);
  assert.equal(mapNetafimItemToReading('not an object'), null);
});

test('mapNetafimItemToReading: tolerates missing valve fields', () => {
  const out = mapNetafimItemToReading(netafimItem({ valve: {} }));
  assert.ok(out);
  assert.equal(out.data.parcelle, null);
  assert.equal(out.data.parcelleLabel, null);
  assert.equal(out.data.duree, null);
  assert.equal(out.data.points[0].volume, null);
});

test('mapNetafimItemToReading: returns null when date cannot be derived', () => {
  const out = mapNetafimItemToReading(netafimItem({ date: null, startTimestamp: null }));
  assert.equal(out, null);
});

test('mapNetafimItemToReading: completed coerced from string/boolean', () => {
  assert.equal(mapNetafimItemToReading(netafimItem({ completed: 'true'  })).data.meta.netafim.completed, true);
  assert.equal(mapNetafimItemToReading(netafimItem({ completed: true     })).data.meta.netafim.completed, true);
  assert.equal(mapNetafimItemToReading(netafimItem({ completed: 'false' })).data.meta.netafim.completed, false);
});
