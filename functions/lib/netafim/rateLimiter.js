// @ts-check
'use strict';

/**
 * Daily quota guard. Netafim enforces a hard cap of 30 calls/day per
 * client; abusive bursts trigger a 5-hour soft-ban. We keep our own
 * counter in `config/netafim_sync.callsToday` and refuse calls past the
 * configured limit (default 25, leaving margin).
 *
 * The counter is reset whenever `callsResetDate` differs from today
 * (Africa/Casablanca). All increments are routed through `tryConsume`.
 */

function todayKey(now) {
  const t = Number.isFinite(now) ? Number(now) : Date.now();
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Africa/Casablanca',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(t));
  } catch (_) {
    return new Date(t).toISOString().slice(0, 10);
  }
}

/**
 * Compute the next quota state for a "consume 1 call" request. Returns
 * `{ allowed: false }` when the cap is reached so callers can short-circuit.
 *
 * @param {{callsToday:number, callsResetDate:string|null}} cursor
 * @param {number} limit
 * @param {number} [nowMs]
 * @returns {{ allowed: boolean, next: {callsToday:number, callsResetDate:string} }}
 */
function tryConsume(cursor, limit, nowMs) {
  const today = todayKey(nowMs);
  const sameDay = cursor && cursor.callsResetDate === today;
  const current = sameDay ? Math.max(0, cursor.callsToday | 0) : 0;
  if (current >= limit) {
    return { allowed: false, next: { callsToday: current, callsResetDate: today } };
  }
  return { allowed: true, next: { callsToday: current + 1, callsResetDate: today } };
}

module.exports = {
  todayKey,
  tryConsume,
};
