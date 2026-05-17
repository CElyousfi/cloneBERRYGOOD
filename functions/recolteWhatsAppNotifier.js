'use strict';
// @ts-check

/**
 * recolteWhatsAppNotifier.js
 *
 * Sends a WhatsApp recap to DG users when the daily harvest total
 * (prod_tracabilite_recolte/{date}.totalKg) changes by at least
 * THRESHOLD_KG since the last notification.
 *
 * State is stored in prod_tracabilite_recolte/_notify_state to avoid
 * duplicate notifications when the prodSync re-writes the same doc.
 */

const THRESHOLD_KG = 100;
const STATE_DOC_ID = '_notify_state';
const STATUS_DOC_ID = '_status';

/**
 * Aggregate worker rows by variety (descending kg).
 * @param {Array<{variete?: string, totalKg?: number}>} rows
 * @returns {Array<{variete: string, totalKg: number}>}
 */
function aggregateByVariete(rows) {
  const map = {};
  for (const r of rows || []) {
    const v = (r.variete || '').trim() || 'Inconnu';
    map[v] = (map[v] || 0) + (r.totalKg || 0);
  }
  return Object.entries(map)
    .map(([variete, totalKg]) => ({ variete, totalKg: Math.round(totalKg * 10) / 10 }))
    .sort((a, b) => b.totalKg - a.totalKg);
}

/**
 * Decide whether a notification should be sent.
 * Fires when the absolute delta vs last notified total exceeds threshold.
 * If no previous notification for the date, fires as soon as total >= threshold.
 *
 * @param {object} opts
 * @param {number} opts.afterKg
 * @param {number|null} opts.lastNotifiedKg
 * @param {string} opts.date
 * @param {string|null} opts.lastNotifiedDate
 * @param {number} [opts.threshold=THRESHOLD_KG]
 * @returns {{ notify: boolean, deltaKg: number, reason: string }}
 */
function shouldNotify({ afterKg, lastNotifiedKg, date, lastNotifiedDate, threshold = THRESHOLD_KG }) {
  if (!Number.isFinite(afterKg) || afterKg <= 0) {
    return { notify: false, deltaKg: 0, reason: 'no-total' };
  }
  // Different date than last notification → baseline is 0.
  const baseline = lastNotifiedDate === date && Number.isFinite(lastNotifiedKg) ? lastNotifiedKg : 0;
  const delta = afterKg - baseline;
  if (delta >= threshold) {
    return { notify: true, deltaKg: Math.round(delta * 10) / 10, reason: 'threshold-crossed' };
  }
  return { notify: false, deltaKg: Math.round(delta * 10) / 10, reason: 'below-threshold' };
}

/**
 * Format YYYY-MM-DD → DD/MM.
 * @param {string} date
 */
function formatDateShort(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return date;
  return `${m[3]}/${m[2]}`;
}

/**
 * Build the WhatsApp text message.
 * @param {object} opts
 * @param {string} opts.date           - YYYY-MM-DD
 * @param {number} opts.totalKg
 * @param {number} opts.deltaKg
 * @param {Array<{variete: string, totalKg: number}>} opts.byVariete
 * @param {number|null} [opts.syncedAtMs]
 * @param {string} [opts.tz='Africa/Casablanca']
 * @returns {string}
 */
function formatMessage({ date, totalKg, deltaKg, byVariete, syncedAtMs, tz = 'Africa/Casablanca' }) {
  const lines = [];
  lines.push(`🍓 Récolte ${formatDateShort(date)} — mise à jour`);
  const totalRounded = Math.round(totalKg * 10) / 10;
  const deltaSign = deltaKg >= 0 ? '+' : '';
  lines.push(`Total : ${formatKg(totalRounded)} (${deltaSign}${formatKg(deltaKg)} depuis dernière notif)`);
  for (const v of byVariete.slice(0, 6)) {
    lines.push(`• ${v.variete} : ${formatKg(v.totalKg)}`);
  }
  if (syncedAtMs) {
    const hhmm = new Date(syncedAtMs).toLocaleTimeString('fr-FR', {
      hour: '2-digit', minute: '2-digit', timeZone: tz,
    });
    lines.push(`Sync : ${hhmm}`);
  }
  return lines.join('\n');
}

function formatKg(n) {
  const rounded = Math.round(n * 10) / 10;
  // 1 234,5 kg
  return rounded.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' kg';
}

/**
 * Return today's date in YYYY-MM-DD for Africa/Casablanca.
 * @param {Date} [now]
 * @returns {string}
 */
function todayCasablanca(now = new Date()) {
  // Casablanca is UTC+1 year-round (no DST since 2018).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Casablanca',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

/**
 * Main handler — call from a Firestore onWrite trigger on
 * prod_tracabilite_recolte/{date}.
 *
 * @param {object} deps
 * @param {object} deps.db                       Firestore instance
 * @param {object} deps.whatsapp                 whatsappService module
 * @param {object} deps.admin                    firebase-admin module (for FieldValue)
 * @param {(key: string) => Promise<void>} [deps.invalidateCache]  Optional API-cache invalidator
 * @param {object} change                        Firestore Change object
 * @param {object} context                       Functions context (params.date)
 * @returns {Promise<{skipped?: string, sent?: number, deltaKg?: number}>}
 */
async function handleProdRecolteWrite(deps, change, context) {
  const { db, whatsapp, admin, invalidateCache } = deps;
  const date = context.params && context.params.date;

  if (!date || date === STATUS_DOC_ID || date === STATE_DOC_ID) {
    return { skipped: 'meta-doc' };
  }
  if (!change.after.exists) {
    return { skipped: 'deleted' };
  }

  // Invalidate the API cache for this date so the Récolte tab reflects the new
  // scan data on the next fetch — the client listener will trigger that fetch.
  if (typeof invalidateCache === 'function') {
    try { await invalidateCache(`pointage_recolte_${date}`); }
    catch (e) { console.warn('[recolteWhatsAppNotifier] invalidateCache failed:', e.message); }
  }

  const today = todayCasablanca();
  if (date !== today) {
    return { skipped: 'not-today' };
  }
  const after = change.after.data() || {};
  const before = change.before.exists ? (change.before.data() || {}) : {};

  const afterKg = Number(after.totalKg) || 0;
  const beforeKg = Number(before.totalKg) || 0;
  if (afterKg === beforeKg) {
    return { skipped: 'no-total-change' };
  }

  // Load previous notification state.
  const stateRef = db.collection('prod_tracabilite_recolte').doc(STATE_DOC_ID);
  const stateSnap = await stateRef.get();
  const state = stateSnap.exists ? (stateSnap.data() || {}) : {};
  const lastNotifiedKg = state.date === date ? Number(state.lastNotifiedTotalKg) : null;
  const lastNotifiedDate = state.date || null;

  const decision = shouldNotify({
    afterKg, lastNotifiedKg, date, lastNotifiedDate,
  });
  if (!decision.notify) {
    return { skipped: decision.reason, deltaKg: decision.deltaKg };
  }

  // Resolve DG recipients.
  const recipients = await whatsapp.resolveRecipientsForProfile('dg', null);
  if (!recipients.length) {
    return { skipped: 'no-dg-recipients' };
  }

  const byVariete = aggregateByVariete(after.rows || []);
  const syncedAtMs = after.syncedAt && typeof after.syncedAt.toMillis === 'function'
    ? after.syncedAt.toMillis() : null;

  const message = formatMessage({
    date, totalKg: afterKg, deltaKg: decision.deltaKg, byVariete, syncedAtMs,
  });

  const results = await Promise.allSettled(
    recipients.map(r => whatsapp.sendTextMessage(r.phone, message))
  );
  const sent = results.filter(r => r.status === 'fulfilled' && r.value && r.value.success).length;

  // Persist state only if at least one message went through.
  if (sent > 0) {
    await stateRef.set({
      date,
      lastNotifiedTotalKg: Math.round(afterKg * 10) / 10,
      lastNotifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      deltaKg: decision.deltaKg,
      recipientsCount: sent,
    });
  } else {
    console.warn('[recolteWhatsAppNotifier] All sends failed for date=' + date);
  }

  return { sent, deltaKg: decision.deltaKg };
}

module.exports = {
  THRESHOLD_KG,
  aggregateByVariete,
  shouldNotify,
  formatMessage,
  formatDateShort,
  todayCasablanca,
  handleProdRecolteWrite,
}
