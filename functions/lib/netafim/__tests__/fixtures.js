// @ts-check
'use strict';

/**
 * Shared fixtures for Netafim tests. Conforms to the schema described in
 * "Connect to Growsphere API V3" (Aug 2024).
 */

/**
 * Make a Netafim irrigationLogs item with overridable fields.
 * @param {Partial<import('../types').NetafimIrrigationLog & {valve: Partial<import('../types').NetafimValve>}>} [overrides]
 */
function netafimItem(overrides) {
  const o = overrides || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(o, k);
  const defaultValve = {
    vlvName: 'Olive1',
    vlvIoId: '4-1-1',
    channelId: '4-1-1',
    ioId: '5ec85721-faf3-4ce5-e4d0-08dc7557399a',
    irriBlockId: 'a16ba43c-deb7-42df-9ce9-4bb00f550f62',
    irriBlockName: 'Olive1',
    shiftNumber: 1,
    irriTime: '00:05:58',
    irriQtyInLiter: 1200,
    irriQtyInM3: 1.2,
    irriQtyInGallon: 0,
    irriDepthInMm: 0,
    flowInGPM: 0,
    flowInM3h: 12.5,
    mainlineId: '4',
  };
  // When the caller passes `valve: {}` or `valve: { ... }` we replace the
  // whole valve object so they can clear fields by omission. Use
  // `valveOverride` to merge instead.
  const valve = has('valve') ? (o.valve || {}) : defaultValve;
  return {
    id: has('id') ? o.id : '3212',
    farmId: has('farmId') ? o.farmId : 'prod-nb10200',
    thingId: has('thingId') ? o.thingId : 'urn:nb:msg:program:log',
    logMessageProcessedUtc: has('logMessageProcessedUtc') ? o.logMessageProcessedUtc : '2024-07-01T05:06:23.000000+03:00',
    deviceUuid: has('deviceUuid') ? o.deviceUuid : 'e0b89eda-459a-428c-97ee-76b663a6cbdb',
    programUuid: has('programUuid') ? o.programUuid : 'e0b89eda-459a-428c-97ee-76b663a6cbdb-PID31',
    prgName: has('prgName') ? o.prgName : 'olive',
    date: has('date') ? o.date : '2024-07-01T00:00:00.000000+03:00',
    startTime: has('startTime') ? o.startTime : '08:00:03',
    startTimestamp: has('startTimestamp') ? o.startTimestamp : '2024-07-01T08:00:03.000000+00:00',
    completed: has('completed') ? o.completed : 'false',
    averageEC: has('averageEC') ? o.averageEC : 1.85,
    averagePH: has('averagePH') ? o.averagePH : 6.1,
    valve,
  };
}

/**
 * Build a paginated Netafim response.
 * @param {Object} args
 * @param {Array<any>} args.items
 * @param {number} [args.pageNumber]
 * @param {number} [args.pageCount]
 * @param {number} [args.pageSize]
 */
function netafimPage(args) {
  const a = args || /** @type {any} */ ({});
  const items = Array.isArray(a.items) ? a.items : [];
  return {
    pageNumber: Number.isFinite(a.pageNumber) ? a.pageNumber : 1,
    pageSize: Number.isFinite(a.pageSize) ? a.pageSize : 25,
    rowCount: items.length,
    pageCount: Number.isFinite(a.pageCount) ? a.pageCount : 1,
    items,
  };
}

/**
 * Minimal fake Firestore — same shape as `dataAccess.test.js` in the
 * irrigation module. Supports collection().doc().get()/set(), batch
 * with set(), and where()/orderBy()/get() queries.
 */
function fakeDb(initialDocs) {
  const store = /** @type {Record<string, Array<any>>} */ ({});
  for (const [coll, docs] of Object.entries(initialDocs || {})) {
    store[coll] = (docs || []).slice();
  }
  function makeQuery(coll, filters, orders) {
    return {
      where(field, op, val) { return makeQuery(coll, [...filters, { field, op, val }], orders); },
      orderBy(field, dir) { return makeQuery(coll, filters, [...orders, { field, dir: dir || 'asc' }]); },
      async get() {
        const all = store[coll] || [];
        let docs = all.filter(d => filters.every(f => {
          const v = d[f.field];
          switch (f.op) {
            case '==': return v === f.val;
            case '>=': return v >= f.val;
            case '<=': return v <= f.val;
            default: return false;
          }
        }));
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
  function docRef(coll, id) {
    if (!store[coll]) store[coll] = [];
    return {
      async get() {
        const found = store[coll].find(d => d.id === id);
        return {
          exists: Boolean(found),
          data: () => (found ? { ...found } : null),
        };
      },
      async set(data, opts) {
        const idx = store[coll].findIndex(d => d.id === id);
        const next = { ...(idx >= 0 && opts && opts.merge ? store[coll][idx] : {}), ...data, id };
        if (idx >= 0) store[coll][idx] = next; else store[coll].push(next);
        return null;
      },
    };
  }
  return {
    _store: store,
    collection(coll) {
      return {
        ...makeQuery(coll, [], []),
        doc(id) { return docRef(coll, id); },
      };
    },
    batch() {
      const ops = [];
      return {
        set(ref, data, opts) { ops.push({ ref, data, opts }); },
        async commit() {
          for (const op of ops) await op.ref.set(op.data, op.opts);
        },
      };
    },
  };
}

module.exports = {
  netafimItem,
  netafimPage,
  fakeDb,
};
