'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildParcelleUpserts, persistParcelles, COLLECTION } = require('../parcelles');
const { netafimItem, fakeDb } = require('./fixtures');

test('buildParcelleUpserts: groups items by irriBlockId, collects valves', () => {
  const items = [
    netafimItem({ id: '1', valve: { irriBlockId: 'B1', irriBlockName: 'Bloc 1', vlvName: 'V1' } }),
    netafimItem({ id: '2', valve: { irriBlockId: 'B1', irriBlockName: 'Bloc 1', vlvName: 'V2' } }),
    netafimItem({ id: '3', valve: { irriBlockId: 'B2', irriBlockName: 'Bloc 2', vlvName: 'V3' } }),
  ];
  const out = buildParcelleUpserts(items, { now: 1700 });
  assert.equal(out.length, 2);
  const b1 = out.find(o => o.id === 'B1');
  assert.deepEqual(b1.valves, ['V1', 'V2']);
  assert.equal(b1.label, 'Bloc 1');
  assert.equal(b1.lastSeenAt, 1700);
  const b2 = out.find(o => o.id === 'B2');
  assert.deepEqual(b2.valves, ['V3']);
});

test('buildParcelleUpserts: skips items without irriBlockId', () => {
  const items = [
    netafimItem({ id: '1', valve: { irriBlockId: null } }),
    netafimItem({ id: '2', valve: { irriBlockId: undefined } }),
  ];
  assert.deepEqual(buildParcelleUpserts(items), []);
});

test('buildParcelleUpserts: most recent label wins', () => {
  const items = [
    netafimItem({ id: '1', valve: { irriBlockId: 'B', irriBlockName: 'Old name' } }),
    netafimItem({ id: '2', valve: { irriBlockId: 'B', irriBlockName: 'New name' } }),
  ];
  const out = buildParcelleUpserts(items);
  assert.equal(out[0].label, 'New name');
});

test('persistParcelles: writes new docs with firstSeenAt set', async () => {
  const db = fakeDb({});
  const r = await persistParcelles(db, [
    { id: 'B1', label: 'Bloc 1', valves: ['V1'], lastValveId: '4-1-1', lastSeenAt: 1700 },
  ]);
  assert.equal(r.written, 1);
  const stored = db._store[COLLECTION][0];
  assert.equal(stored.id, 'B1');
  assert.equal(stored.firstSeenAt, 1700);
  assert.equal(stored.lastSeenAt, 1700);
  assert.equal(stored.ferme, 'BAHIA');
});

test('persistParcelles: existing docs are merged (firstSeenAt preserved, lastSeenAt updated)', async () => {
  const db = fakeDb({
    [COLLECTION]: [{ id: 'B1', label: 'Old', valves: ['V0'], firstSeenAt: 100, lastSeenAt: 100, ferme: 'BAHIA' }],
  });
  await persistParcelles(db, [
    { id: 'B1', label: 'New', valves: ['V1'], lastValveId: null, lastSeenAt: 999 },
  ]);
  const stored = db._store[COLLECTION].find(d => d.id === 'B1');
  assert.equal(stored.firstSeenAt, 100);
  assert.equal(stored.lastSeenAt, 999);
  assert.equal(stored.label, 'New');
  assert.deepEqual(stored.valves, ['V1']);
});

test('persistParcelles: no-ops on empty', async () => {
  const db = fakeDb({});
  assert.deepEqual(await persistParcelles(db, []), { written: 0 });
  assert.deepEqual(await persistParcelles(db, null), { written: 0 });
});
