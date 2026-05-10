/**
 * Firestore access layer for the irrigation domain. Pure I/O — no domain
 * logic lives here. Caller injects a Firestore-compatible `db` (admin or
 * client SDK) so this module stays unit-testable with a fake.
 */

const READINGS_COLLECTION = 'irrigation_readings';
const SNAPSHOTS_COLLECTION = 'irrigation_intelligence_snapshots';

/**
 * Fetch raw readings within a date range for a given farm. Optionally
 * filter by `parcelle` in-memory (Firestore would otherwise need a
 * composite index on (ferme, parcelle, date)).
 *
 * @param {*} db                              Firestore instance
 * @param {Object} args
 * @param {string} args.ferme                "F1" | "F5"
 * @param {string} args.dateFrom             "YYYY-MM-DD"
 * @param {string} args.dateTo               "YYYY-MM-DD"
 * @param {string|null} [args.parcelle]
 * @returns {Promise<import('./types').RawIrrigationReading[]>}
 */
async function fetchIrrigationReadings(db, args) {
  if (!db) throw new Error('fetchIrrigationReadings: db is required');
  const { ferme, dateFrom, dateTo, parcelle = null } = args || {};
  if (!ferme) throw new Error('fetchIrrigationReadings: ferme is required');

  let q = db.collection(READINGS_COLLECTION).where('ferme', '==', ferme);
  if (dateFrom) q = q.where('date', '>=', dateFrom);
  if (dateTo) q = q.where('date', '<=', dateTo);
  q = q.orderBy('date', 'desc').orderBy('createdAt', 'desc');

  const snap = await q.get();
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (parcelle) docs = docs.filter(d => d.parcelle === parcelle);
  return docs;
}

/**
 * Persist a daily-summary snapshot. Uses a deterministic doc id so the
 * scheduler can be re-run idempotently for the same day.
 *
 * @param {*} db
 * @param {import('./types').DailyIrrigationSummary} summary
 * @param {Object} [meta]
 * @param {string} [meta.generatedBy]
 * @param {Object} [meta.weather]
 * @returns {Promise<{id: string}>}
 */
async function saveSnapshot(db, summary, meta) {
  if (!db) throw new Error('saveSnapshot: db is required');
  if (!summary || !summary.date || !summary.parcelle || !summary.ferme) {
    throw new Error('saveSnapshot: summary must include date, parcelle, ferme');
  }
  const id = `${summary.ferme}__${summary.date}__${summary.parcelle}`;
  const doc = {
    id,
    date: summary.date,
    ferme: summary.ferme,
    parcelle: summary.parcelle,
    parcelleLabel: summary.parcelleLabel || null,
    kpis: {
      totalInputMl: summary.totalInputMl,
      totalDrainMl: summary.totalDrainMl,
      totalDrainPct: summary.totalDrainPct,
      avgEcPts: summary.avgEcPts,
      avgEcDrain: summary.avgEcDrain,
      avgPhPts: summary.avgPhPts,
      avgPhDrain: summary.avgPhDrain,
      pulseCount: summary.pulseCount,
      highDrainPulseCount: summary.highDrainPulseCount,
      lowDrainPulseCount: summary.lowDrainPulseCount,
      irrigationCutoffTime: summary.irrigationCutoffTime,
    },
    diagnosis: summary.diagnosis,
    diagnosisReasons: summary.diagnosisReasons,
    weather: (meta && meta.weather) || null,
    generatedAt: Date.now(),
    generatedBy: (meta && meta.generatedBy) || 'manual',
  };
  await db.collection(SNAPSHOTS_COLLECTION).doc(id).set(doc, { merge: true });
  return { id };
}

/**
 * Read snapshots back for trend / period-over-period analysis.
 * @param {*} db
 * @param {Object} args
 * @param {string} args.ferme
 * @param {string} args.dateFrom
 * @param {string} args.dateTo
 * @param {string|null} [args.parcelle]
 * @returns {Promise<Array<Object>>}
 */
async function fetchSnapshots(db, args) {
  if (!db) throw new Error('fetchSnapshots: db is required');
  const { ferme, dateFrom, dateTo, parcelle = null } = args || {};
  let q = db.collection(SNAPSHOTS_COLLECTION).where('ferme', '==', ferme);
  if (dateFrom) q = q.where('date', '>=', dateFrom);
  if (dateTo) q = q.where('date', '<=', dateTo);
  q = q.orderBy('date', 'desc');
  const snap = await q.get();
  let docs = snap.docs.map(d => d.data());
  if (parcelle) docs = docs.filter(d => d.parcelle === parcelle);
  return docs;
}

module.exports = {
  READINGS_COLLECTION,
  SNAPSHOTS_COLLECTION,
  fetchIrrigationReadings,
  saveSnapshot,
  fetchSnapshots,
};
