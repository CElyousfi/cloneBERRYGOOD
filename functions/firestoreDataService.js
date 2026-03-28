/**
 * firestoreDataService.js
 *
 * Read-only module to fetch data from Firestore mirror collections
 * (populated by sqlSyncService.js).
 *
 * All functions return plain JS arrays/objects — same shape as SQL recordsets.
 */

const admin = require("firebase-admin");
const db_firestore = admin.firestore();

// =============================================
// BR_Consommation — from sql_mirror_consommation/{YYYY-MM}
// =============================================

/**
 * Get consommation rows with optional filters.
 * @param {Object} filters
 * @param {string} [filters.categorie] - 'Engrais' or 'Pesticides'
 * @param {string} [filters.parcelle]
 * @param {string} [filters.culture]
 * @param {string} [filters.ferme]
 * @param {string} [filters.weekStart] - YYYY-MM-DD
 * @param {string} [filters.weekEnd] - YYYY-MM-DD
 * @returns {Promise<Array>} filtered rows
 */
async function getConsommationRows(filters = {}) {
  const snapshot = await db_firestore.collection("sql_mirror_consommation").get();
  let allRows = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.rows) allRows = allRows.concat(data.rows);
  }

  // Apply filters
  if (filters.categorie) {
    allRows = allRows.filter(r => r.Article_Categorie === filters.categorie);
  }
  if (filters.parcelle) {
    allRows = allRows.filter(r => r.Parcelle_Culturale === filters.parcelle);
  }
  if (filters.culture) {
    allRows = allRows.filter(r => r.Culture === filters.culture);
  }
  if (filters.ferme) {
    allRows = allRows.filter(r => r.Ferme === filters.ferme);
  }
  if (filters.weekStart) {
    allRows = allRows.filter(r => r.Date >= filters.weekStart);
  }
  if (filters.weekEnd) {
    allRows = allRows.filter(r => r.Date <= filters.weekEnd);
  }

  return allRows;
}

// =============================================
// BR_Pointage — from sql_mirror_pointage/{YYYY-MM-DD}
// =============================================

/**
 * Get pointage rows for a specific date.
 * @param {string} dateStr - YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function getPointageRowsForDate(dateStr) {
  const doc = await db_firestore.collection("sql_mirror_pointage").doc(dateStr).get();
  if (!doc.exists) return [];
  return doc.data().rows || [];
}

/**
 * Get pointage rows for a date range.
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function getPointageRowsForDateRange(startDate, endDate) {
  const meta = await getPointageMeta();
  if (!meta || !meta.availableDates) return [];

  const dates = meta.availableDates.filter(d => d >= startDate && d <= endDate);
  const allRows = [];
  // Fetch in parallel, batches of 10
  for (let i = 0; i < dates.length; i += 10) {
    const batch = dates.slice(i, i + 10);
    const results = await Promise.all(batch.map(d => getPointageRowsForDate(d)));
    for (const rows of results) allRows.push(...rows);
  }
  return allRows;
}

/**
 * Get pointage rows for a specific quinzaine/periode.
 * @param {string} periode - e.g. "Quinzaine 17"
 * @returns {Promise<Array>}
 */
async function getPointageRowsForPeriode(periode) {
  const meta = await getPointageMeta();
  if (!meta || !meta.periodeMap || !meta.periodeMap[periode]) return [];

  const dates = meta.periodeMap[periode];
  const allRows = [];
  for (let i = 0; i < dates.length; i += 10) {
    const batch = dates.slice(i, i + 10);
    const results = await Promise.all(batch.map(d => getPointageRowsForDate(d)));
    for (const rows of results) allRows.push(...rows);
  }
  return allRows;
}

/**
 * Get pointage meta (periodes, periodeMap, availableDates).
 * @returns {Promise<Object|null>}
 */
async function getPointageMeta() {
  const doc = await db_firestore.collection("sql_mirror_pointage_meta").doc("config").get();
  if (!doc.exists) return null;
  return doc.data();
}

/**
 * Get all available pointage dates.
 * @param {number} [limit] - max number of dates to return
 * @returns {Promise<Array<string>>}
 */
async function getAvailableDates(limit) {
  const meta = await getPointageMeta();
  if (!meta || !meta.availableDates) return [];
  const dates = meta.availableDates; // already sorted desc
  return limit ? dates.slice(0, limit) : dates;
}

/**
 * Get worker history by matricule.
 * @param {string} matricule
 * @returns {Promise<Array>}
 */
async function getWorkerHistory(matricule) {
  const doc = await db_firestore.collection("sql_mirror_pointage_workers").doc(matricule).get();
  if (!doc.exists) return [];
  return doc.data().rows || [];
}

// =============================================
// BR_Cueillette — from sql_mirror_cueillette/{YYYY-MM-DD}
// =============================================

/**
 * Get cueillette rows for a date range.
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 * @returns {Promise<Array>}
 */
async function getCueilletteRows(startDate, endDate) {
  // List all cueillette docs and filter by date range
  const snapshot = await db_firestore.collection("sql_mirror_cueillette")
    .where(admin.firestore.FieldPath.documentId(), ">=", startDate)
    .where(admin.firestore.FieldPath.documentId(), "<=", endDate)
    .get();

  let allRows = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.rows) allRows = allRows.concat(data.rows);
  }
  return allRows;
}

// =============================================
// Sync Status
// =============================================

/**
 * Get the latest sync status.
 * @returns {Promise<Object|null>}
 */
async function getSyncStatus() {
  const doc = await db_firestore.collection("sql_sync_status").doc("latest").get();
  if (!doc.exists) return null;
  const data = doc.data();
  // Compute data age
  if (data.lastSuccessAt) {
    const successTime = data.lastSuccessAt.toDate ? data.lastSuccessAt.toDate() : new Date(data.lastSuccessAt);
    data.dataAgeMs = Date.now() - successTime.getTime();
    data.dataAge = formatAge(data.dataAgeMs);
  }
  return data;
}

function formatAge(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}min`;
}

module.exports = {
  getConsommationRows,
  getPointageRowsForDate,
  getPointageRowsForDateRange,
  getPointageRowsForPeriode,
  getPointageMeta,
  getAvailableDates,
  getWorkerHistory,
  getCueilletteRows,
  getSyncStatus,
};
