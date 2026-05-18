// @ts-check
'use strict';

/**
 * Transform a raw Netafim irrigationLogs item into a doc that the
 * existing irrigation pipeline (functions/lib/irrigation/*) can consume.
 *
 * Design decisions:
 *  - `ferme` is hardcoded to "BAHIA": Netafim's farmId is implicit via
 *    the client_id, and this integration is BAHIA-only for now.
 *  - `parcelle` = `valve.irriBlockId` (stable Netafim id). The human
 *    label travels in `parcelleLabel`.
 *  - We mint a single `points[0]` from `averageEC`, `averagePH` and
 *    `valve.irriQtyInLiter`. There are no manual drainage stations on
 *    the controller → `drainage: []`.
 *  - The full raw item is preserved under `meta.netafim` for debugging
 *    and any future enrichment.
 *  - The deterministic doc id is built by `buildDocId` so re-runs of the
 *    sync upsert in place (no duplicates).
 */

const FERME = 'BAHIA';
const SOURCE = 'netafim-cron';
const DOC_ID_PREFIX = 'netafim__';

/**
 * @param {string|null|undefined} id
 * @returns {string|null}
 */
function buildDocId(id) {
  if (id === null || id === undefined) return null;
  const s = String(id).trim();
  if (!s) return null;
  return DOC_ID_PREFIX + s;
}

/**
 * Parse Netafim's `date` field (ISO-like with TZ) into a "YYYY-MM-DD"
 * string in Africa/Casablanca local time. The controller emits local
 * timestamps with offsets (e.g. "2024-07-01T00:00:00+03:00") — using
 * Date()'s native parsing then reformatting in local Morocco TZ keeps
 * the downstream date column aligned with manually-entered F1/F5 rows.
 *
 * @param {string|null|undefined} iso
 * @returns {string|null}
 */
function toLocalDate(iso) {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return null;
  // sv-SE locale yields "YYYY-MM-DD HH:mm:ss"; we take the date half.
  try {
    const fmt = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Africa/Casablanca',
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    return fmt.format(new Date(t));
  } catch (_) {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/**
 * Extract "HH:mm" from Netafim's `startTime` ("HH:mm:ss") with a fallback
 * to deriving it from `startTimestamp` in Africa/Casablanca local time.
 *
 * @param {string|null|undefined} startTime
 * @param {string|null|undefined} startTimestamp
 * @returns {string|null}
 */
function toLocalHour(startTime, startTimestamp) {
  if (typeof startTime === 'string' && /^\d{1,2}:\d{2}/.test(startTime)) {
    return startTime.slice(0, 5);
  }
  if (!startTimestamp) return null;
  const t = Date.parse(String(startTimestamp));
  if (!Number.isFinite(t)) return null;
  try {
    const fmt = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Africa/Casablanca',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    return fmt.format(new Date(t));
  } catch (_) {
    return null;
  }
}

/**
 * "HH:mm:ss" -> minutes (rounded). Returns null on bad input.
 * @param {string|null|undefined} hms
 * @returns {number|null}
 */
function durationToMinutes(hms) {
  if (!hms) return null;
  const m = String(hms).match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mn = parseInt(m[2], 10);
  const s = m[3] ? parseInt(m[3], 10) : 0;
  if (!Number.isFinite(h) || !Number.isFinite(mn)) return null;
  return Math.round(h * 60 + mn + s / 60);
}

function toFiniteNumberOrNull(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a Netafim numeric to null when missing OR exactly zero (sensor not equipped). */
function nullIfZero(v) {
  const n = toFiniteNumberOrNull(v);
  if (n === null) return null;
  return n === 0 ? null : n;
}

function toEpochMs(iso) {
  if (!iso) return null;
  const t = Date.parse(String(iso));
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {import('./types').NetafimIrrigationLog} item
 * @param {Object} [opts]
 * @param {number} [opts.now]   epoch ms; defaults to Date.now()
 * @returns {{ docId: string, data: import('./types').BahiaIrrigationReading } | null}
 */
function mapNetafimItemToReading(item, opts) {
  if (!item || typeof item !== 'object') return null;
  const docId = buildDocId(item.id);
  if (!docId) return null;

  const valve = item.valve || {};
  const now = (opts && Number.isFinite(opts.now)) ? Number(opts.now) : Date.now();

  const volumeL = toFiniteNumberOrNull(valve.irriQtyInLiter);
  const ec = nullIfZero(item.averageEC);
  const ph = nullIfZero(item.averagePH);

  /** @type {import('./types').BahiaIrrigationReading} */
  const data = {
    ferme: FERME,
    date: toLocalDate(item.date || item.startTimestamp || null) || '',
    heure: toLocalHour(item.startTime, item.startTimestamp),
    parcelle: valve.irriBlockId ? String(valve.irriBlockId) : null,
    parcelleLabel: valve.irriBlockName ? String(valve.irriBlockName) : null,
    valveName: valve.vlvName ? String(valve.vlvName) : null,
    shiftNumber: toFiniteNumberOrNull(valve.shiftNumber),
    duree: durationToMinutes(valve.irriTime),
    volumeM3: toFiniteNumberOrNull(valve.irriQtyInM3),
    flowM3h: toFiniteNumberOrNull(valve.flowInM3h),
    programName: item.prgName ? String(item.prgName) : null,
    programUuid: item.programUuid ? String(item.programUuid) : null,
    netafimId: String(item.id),
    startTimestamp: toEpochMs(item.startTimestamp),
    points: [{ ec: ec, ph: ph, volume: volumeL }],
    drainage: [],
    meta: {
      netafim: {
        farmId: item.farmId || null,
        thingId: item.thingId || null,
        deviceUuid: item.deviceUuid || null,
        channelId: valve.channelId || null,
        ioId: valve.ioId || null,
        mainlineId: valve.mainlineId || null,
        completed: item.completed === true || item.completed === 'true' || item.completed === 'True',
        logMessageProcessedUtc: item.logMessageProcessedUtc || null,
      },
    },
    createdAt: now,
    updatedAt: now,
    createdBy: SOURCE,
  };

  if (!data.date) return null; // Firestore index requires a date
  return { docId, data };
}

module.exports = {
  FERME,
  SOURCE,
  DOC_ID_PREFIX,
  buildDocId,
  toLocalDate,
  toLocalHour,
  durationToMinutes,
  mapNetafimItemToReading,
};
