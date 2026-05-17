// @ts-check
'use strict';

/**
 * BAHIA parcelle registry — populated by discovery as items flow in
 * from Netafim. Lets the UI list available parcelles for BAHIA without
 * hardcoding them in `public/app.jsx`, and gives a human-editable
 * surface if/when ops wants to enrich (ha, culture, cycle, etc.).
 *
 * Doc shape (in `netafim_parcelles_bahia`):
 *   { id, label, firstSeenAt, lastSeenAt, valves: [vlvName, ...], lastValveId }
 */

const COLLECTION = 'netafim_parcelles_bahia';

/**
 * Group a flat list of Netafim items by irriBlockId and emit the
 * minimal payloads needed to upsert the registry. Pure function — no
 * I/O — so it's straightforward to unit-test.
 *
 * @param {Array<import('./types').NetafimIrrigationLog>} items
 * @param {Object} [opts]
 * @param {number} [opts.now]
 * @returns {Array<{id: string, label: string|null, valves: string[], lastValveId: string|null, lastSeenAt: number}>}
 */
function buildParcelleUpserts(items, opts) {
  const now = (opts && Number.isFinite(opts.now)) ? Number(opts.now) : Date.now();
  /** @type {Record<string, {id:string,label:string|null,valves:Set<string>,lastValveId:string|null,lastSeenAt:number}>} */
  const byId = {};
  for (const it of items || []) {
    const valve = it && it.valve;
    if (!valve || !valve.irriBlockId) continue;
    const id = String(valve.irriBlockId);
    const slot = byId[id] || (byId[id] = {
      id,
      label: valve.irriBlockName ? String(valve.irriBlockName) : null,
      valves: new Set(),
      lastValveId: null,
      lastSeenAt: 0,
    });
    if (valve.vlvName) slot.valves.add(String(valve.vlvName));
    if (valve.vlvIoId) slot.lastValveId = String(valve.vlvIoId);
    // Most recent label wins (rare, but irriBlockName can be renamed)
    if (valve.irriBlockName) slot.label = String(valve.irriBlockName);
    slot.lastSeenAt = now;
  }
  return Object.values(byId).map(s => ({
    id: s.id,
    label: s.label,
    valves: Array.from(s.valves).sort(),
    lastValveId: s.lastValveId,
    lastSeenAt: s.lastSeenAt,
  }));
}

/**
 * Persist parcelle upserts. Uses `merge: true` so we never overwrite
 * fields edited by ops (ha, culture, cycle…). `firstSeenAt` is only
 * written on creation.
 *
 * @param {*} db
 * @param {ReturnType<typeof buildParcelleUpserts>} upserts
 * @returns {Promise<{written: number}>}
 */
async function persistParcelles(db, upserts) {
  if (!db) throw new Error('persistParcelles: db is required');
  if (!Array.isArray(upserts) || upserts.length === 0) return { written: 0 };
  let written = 0;
  for (const u of upserts) {
    const ref = db.collection(COLLECTION).doc(u.id);
    const snap = await ref.get();
    const payload = {
      id: u.id,
      label: u.label,
      valves: u.valves,
      lastValveId: u.lastValveId,
      lastSeenAt: u.lastSeenAt,
      ferme: 'BAHIA',
    };
    if (!snap.exists) {
      payload.firstSeenAt = u.lastSeenAt;
    }
    await ref.set(payload, { merge: true });
    written++;
  }
  return { written };
}

module.exports = {
  COLLECTION,
  buildParcelleUpserts,
  persistParcelles,
};
