'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  upsertReadings,
  readSyncCursor,
  writeSyncCursor,
  READINGS_COLLECTION,
  CURSOR_COLLECTION,
  CURSOR_DOC,
} = require('../dataAccess');
const { fakeDb } = require('./fixtures');

test('upsertReadings: writes each entry with merge:true', async () => {
  const db = fakeDb({});
  const r = await upsertReadings(db, [
    { docId: 'netafim__1', data: { ferme: 'BAHIA', date: '2024-07-01', netafimId: '1' } },
    { docId: 'netafim__2', data: { ferme: 'BAHIA', date: '2024-07-01', netafimId: '2' } },
  ]);
  assert.equal(r.written, 2);
  const stored = db._store[READINGS_COLLECTION];
  assert.equal(stored.length, 2);
  assert.ok(stored.find(d => d.id === 'netafim__1'));
});

test('upsertReadings: re-running the same entries does not duplicate', async () => {
  const db = fakeDb({});
  const entry = { docId: 'netafim__1', data: { ferme: 'BAHIA', date: '2024-07-01', netafimId: '1' } };
  await upsertReadings(db, [entry]);
  await upsertReadings(db, [entry]);
  assert.equal(db._store[READINGS_COLLECTION].length, 1);
});

test('upsertReadings: no-ops on empty', async () => {
  const db = fakeDb({});
  assert.deepEqual(await upsertReadings(db, []), { written: 0 });
});

test('readSyncCursor: returns defaults when missing', async () => {
  const db = fakeDb({});
  const c = await readSyncCursor(db);
  assert.deepEqual(c, { lastRunAt: null, lastDateTo: null, callsToday: 0, callsResetDate: null, lastError: null });
});

test('readSyncCursor: parses persisted state', async () => {
  const db = fakeDb({
    [CURSOR_COLLECTION]: [{ id: CURSOR_DOC, callsToday: 12, callsResetDate: '2026-05-16', lastRunAt: 1700, lastError: 'oops' }],
  });
  const c = await readSyncCursor(db);
  assert.equal(c.callsToday, 12);
  assert.equal(c.callsResetDate, '2026-05-16');
  assert.equal(c.lastRunAt, 1700);
  assert.equal(c.lastError, 'oops');
});

test('writeSyncCursor: merges patch onto the cursor doc', async () => {
  const db = fakeDb({});
  await writeSyncCursor(db, { callsToday: 5, callsResetDate: '2026-05-16' });
  await writeSyncCursor(db, { lastRunAt: 1700 });
  const stored = db._store[CURSOR_COLLECTION].find(d => d.id === CURSOR_DOC);
  assert.equal(stored.callsToday, 5);
  assert.equal(stored.lastRunAt, 1700);
});
