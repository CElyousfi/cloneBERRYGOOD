/**
 * Light-weight tests against a fake Firestore. We're not testing Firestore
 * itself — we're testing that the data layer wires queries correctly and
 * passes through the right filters/orderings.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchIrrigationReadings,
  saveSnapshot,
  fetchSnapshots,
  READINGS_COLLECTION,
  SNAPSHOTS_COLLECTION,
} = require('../dataAccess');

function fakeDb(initialDocs) {
  const store = {
    [READINGS_COLLECTION]: (initialDocs && initialDocs[READINGS_COLLECTION]) || [],
    [SNAPSHOTS_COLLECTION]: (initialDocs && initialDocs[SNAPSHOTS_COLLECTION]) || [],
  };
  const calls = [];
  function makeQuery(coll, filters, orders) {
    return {
      where(field, op, val) {
        return makeQuery(coll, [...filters, { field, op, val }], orders);
      },
      orderBy(field, dir) {
        return makeQuery(coll, filters, [...orders, { field, dir: dir || 'asc' }]);
      },
      async get() {
        calls.push({ coll, filters, orders });
        let docs = store[coll].filter(d => filters.every(f => {
          const v = d[f.field];
          switch (f.op) {
            case '==': return v === f.val;
            case '>=': return v >= f.val;
            case '<=': return v <= f.val;
            default: return false;
          }
        }));
        // Composite sort across all orderBy clauses (Firestore semantics)
        docs = docs.slice().sort((a, b) => {
          for (const o of orders) {
            const av = a[o.field], bv = b[o.field];
            if (av < bv) return o.dir === 'desc' ? 1 : -1;
            if (av > bv) return o.dir === 'desc' ? -1 : 1;
          }
          return 0;
        });
        return { docs: docs.map(d => ({ id: d.id, data: () => d })) };
      },
    };
  }
  return {
    _calls: calls,
    _store: store,
    collection(coll) {
      return {
        ...makeQuery(coll, [], []),
        doc(id) {
          return {
            async set(data, opts) {
              const idx = store[coll].findIndex(d => d.id === id);
              const next = { ...(idx >= 0 && opts && opts.merge ? store[coll][idx] : {}), ...data, id };
              if (idx >= 0) store[coll][idx] = next; else store[coll].push(next);
              return null;
            },
          };
        },
      };
    },
  };
}

test('fetchIrrigationReadings: filters by ferme + date range, orders desc', async () => {
  const db = fakeDb({
    [READINGS_COLLECTION]: [
      { id: 'a', ferme: 'F5', date: '2026-04-30', createdAt: 3, parcelle: 'P1' },
      { id: 'b', ferme: 'F5', date: '2026-05-01', createdAt: 2, parcelle: 'P1' },
      { id: 'c', ferme: 'F1', date: '2026-05-01', createdAt: 1, parcelle: 'P2' },
      { id: 'd', ferme: 'F5', date: '2026-04-15', createdAt: 0, parcelle: 'P1' },
    ],
  });
  const docs = await fetchIrrigationReadings(db, {
    ferme: 'F5', dateFrom: '2026-04-20', dateTo: '2026-05-15',
  });
  const ids = docs.map(d => d.id);
  assert.deepEqual(ids, ['b', 'a']);
});

test('fetchIrrigationReadings: in-memory parcelle filter', async () => {
  const db = fakeDb({
    [READINGS_COLLECTION]: [
      { id: 'a', ferme: 'F5', date: '2026-05-01', createdAt: 1, parcelle: 'P1' },
      { id: 'b', ferme: 'F5', date: '2026-05-01', createdAt: 2, parcelle: 'P2' },
    ],
  });
  const docs = await fetchIrrigationReadings(db, {
    ferme: 'F5', dateFrom: '2026-05-01', dateTo: '2026-05-01', parcelle: 'P2',
  });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].id, 'b');
});

test('fetchIrrigationReadings: throws when ferme missing', async () => {
  const db = fakeDb();
  await assert.rejects(() => fetchIrrigationReadings(db, {}));
});

test('saveSnapshot: deterministic id and idempotent', async () => {
  const db = fakeDb();
  const summary = {
    date: '2026-05-01', ferme: 'F5', parcelle: 'C2-S8-COR',
    parcelleLabel: 'Corina', totalInputMl: 600, totalDrainMl: 120,
    totalDrainPct: 20, avgEcPts: 1.8, avgEcDrain: 1.95, avgPhPts: 6,
    avgPhDrain: 5.8, pulseCount: 5, highDrainPulseCount: 0,
    lowDrainPulseCount: 0, irrigationCutoffTime: '13:30',
    diagnosis: 'optimal', diagnosisReasons: [], pulses: [],
  };
  const r1 = await saveSnapshot(db, summary);
  const r2 = await saveSnapshot(db, summary);
  assert.equal(r1.id, 'F5__2026-05-01__C2-S8-COR');
  assert.equal(r1.id, r2.id);
  assert.equal(db._store[SNAPSHOTS_COLLECTION].length, 1, 'idempotent merge');
});

test('saveSnapshot: refuses summaries missing ferme/date/parcelle', async () => {
  const db = fakeDb();
  await assert.rejects(() => saveSnapshot(db, { date: '2026-05-01', parcelle: 'P1' }));
  await assert.rejects(() => saveSnapshot(db, null));
});

test('fetchSnapshots: range query against snapshots collection', async () => {
  const db = fakeDb({
    [SNAPSHOTS_COLLECTION]: [
      { id: '1', ferme: 'F5', date: '2026-05-01', parcelle: 'P1' },
      { id: '2', ferme: 'F5', date: '2026-04-30', parcelle: 'P1' },
      { id: '3', ferme: 'F1', date: '2026-05-01', parcelle: 'P2' },
    ],
  });
  const out = await fetchSnapshots(db, { ferme: 'F5', dateFrom: '2026-04-01', dateTo: '2026-05-31' });
  assert.equal(out.length, 2);
});
