// @ts-check
'use strict';

/**
 * Firestore I/O for the Netafim integration. Reuses the existing
 * `irrigation_readings` collection so BAHIA shows up alongside F1/F5
 * everywhere the rest of the app already reads from. Adds a small
 * `config/netafim_sync` cursor doc for the cron's quota guard.
 */

const READINGS_COLLECTION = 'irrigation_readings';
const CURSOR_COLLECTION = 'config';
const CURSOR_DOC = 'netafim_sync';

/**
 * Idempotently upsert a list of mapper outputs into `irrigation_readings`.
 *
 * @param {*} db
 * @param {Array<{docId: string, data: import('./types').BahiaIrrigationReading}>} entries
 * @returns {Promise<{written: number}>}
 */
async function upsertReadings(db, entries) {
  if (!db) throw new Error('upsertReadings: db is required');
  if (!Array.isArray(entries) || entries.length === 0) return { written: 0 };
  let written = 0;
  // Firestore batches max out at 500 ops; cap at 400 to leave headroom (
  // same convention as `caisseManagement` per CLAUDE.md).
  const CHUNK = 400;
  for (let i = 0; i < entries.length; i += CHUNK) {
    const slice = entries.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const e of slice) {
      const ref = db.collection(READINGS_COLLECTION).doc(e.docId);
      batch.set(ref, e.data, { merge: true });
    }
    await batch.commit();
    written += slice.length;
  }
  return { written };
}

/**
 * Read the sync cursor (last run, daily call counter). Returns a default
 * shape when missing so callers don't need to null-check.
 *
 * @param {*} db
 * @returns {Promise<{
 *   lastRunAt: number|null,
 *   lastDateTo: string|null,
 *   callsToday: number,
 *   callsResetDate: string|null,
 *   lastError: string|null
 * }>}
 */
async function readSyncCursor(db) {
  if (!db) throw new Error('readSyncCursor: db is required');
  const snap = await db.collection(CURSOR_COLLECTION).doc(CURSOR_DOC).get();
  if (!snap.exists) {
    return { lastRunAt: null, lastDateTo: null, callsToday: 0, callsResetDate: null, lastError: null };
  }
  const d = snap.data() || {};
  return {
    lastRunAt: typeof d.lastRunAt === 'number' ? d.lastRunAt : null,
    lastDateTo: typeof d.lastDateTo === 'string' ? d.lastDateTo : null,
    callsToday: Number.isFinite(d.callsToday) ? d.callsToday : 0,
    callsResetDate: typeof d.callsResetDate === 'string' ? d.callsResetDate : null,
    lastError: typeof d.lastError === 'string' ? d.lastError : null,
  };
}

/**
 * Merge-update the sync cursor.
 *
 * @param {*} db
 * @param {Partial<{lastRunAt:number,lastDateTo:string,callsToday:number,callsResetDate:string,lastError:string|null}>} patch
 */
async function writeSyncCursor(db, patch) {
  if (!db) throw new Error('writeSyncCursor: db is required');
  await db.collection(CURSOR_COLLECTION).doc(CURSOR_DOC).set(patch || {}, { merge: true });
}

module.exports = {
  READINGS_COLLECTION,
  CURSOR_COLLECTION,
  CURSOR_DOC,
  upsertReadings,
  readSyncCursor,
  writeSyncCursor,
};
