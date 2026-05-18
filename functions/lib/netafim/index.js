// @ts-check
'use strict';

/**
 * Netafim GrowSphere V3 — public barrel + sync orchestrator for BAHIA.
 *
 * Pipeline:
 *   getConfig → getAccessToken → fetchAllPages(irrigationLogs)
 *             → mapNetafimItemToReading → upsertReadings + parcelles registry
 *
 * All I/O is injected so the orchestrator is testable end-to-end with
 * fakes (fake db, fake fetch, fake clock).
 */

const auth = require('./auth');
const client = require('./client');
const config = require('./config');
const dataAccess = require('./dataAccess');
const endpoints = require('./endpoints');
const mapper = require('./mapper');
const pagination = require('./pagination');
const parcelles = require('./parcelles');
const rateLimiter = require('./rateLimiter');

const NETAFIM_WINDOW_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * @param {Object} args
 * @param {*} args.db                        Firestore instance
 * @param {typeof fetch} [args.fetch]
 * @param {() => Promise<import('./types').NetafimConfig | null>} [args.getConfig]
 * @param {() => Promise<import('./types').NetafimToken>} [args.getAccessToken]
 * @param {Date|string} [args.dateFrom]      defaults to (dateTo - 25h) — 1h overlap
 * @param {Date|string} [args.dateTo]        defaults to now
 * @param {string} [args.generatedBy]
 * @param {boolean} [args.dryRun]            skip Firestore writes
 * @returns {Promise<{
 *   ok: boolean,
 *   skipped?: 'disabled'|'quota',
 *   pagesFetched: number,
 *   itemsFetched: number,
 *   readingsWritten: number,
 *   parcellesWritten: number,
 *   rowCount: number,
 *   pageCount: number,
 *   dateFrom: string,
 *   dateTo: string,
 *   error?: string
 * }>}
 */
async function syncBahia(args) {
  if (!args || !args.db) throw new Error('syncBahia: db is required');
  const { db } = args;
  const fetchImpl = args.fetch || fetch;
  const getConfig = args.getConfig || config.makeGetConfig(db);
  const getAccessToken = args.getAccessToken || auth.makeGetAccessToken({ getConfig, fetch: fetchImpl });

  const cfg = await getConfig();
  if (!cfg || !cfg.enabled) {
    return {
      ok: true,
      skipped: 'disabled',
      pagesFetched: 0,
      itemsFetched: 0,
      readingsWritten: 0,
      parcellesWritten: 0,
      rowCount: 0,
      pageCount: 0,
      dateFrom: '',
      dateTo: '',
    };
  }

  const now = Date.now();
  const dateTo = args.dateTo ? new Date(args.dateTo) : new Date(now);
  const requestedFrom = args.dateFrom ? new Date(args.dateFrom) : new Date(dateTo.getTime() - 25 * 60 * 60 * 1000);
  // Enforce Netafim's 7-day window to avoid the systematic 404.
  const earliestAllowed = new Date(dateTo.getTime() - NETAFIM_WINDOW_MAX_MS);
  const dateFrom = requestedFrom < earliestAllowed ? earliestAllowed : requestedFrom;

  // Quota guard — read cursor first, refuse early if the daily cap is hit.
  const cursor = await dataAccess.readSyncCursor(db);
  const limit = Number.isFinite(cfg.daily_call_limit) ? Number(cfg.daily_call_limit) : 25;
  if (rateLimiter.tryConsume(cursor, limit, now).allowed === false) {
    return {
      ok: false,
      skipped: 'quota',
      pagesFetched: 0,
      itemsFetched: 0,
      readingsWritten: 0,
      parcellesWritten: 0,
      rowCount: 0,
      pageCount: 0,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      error: 'Netafim daily call quota reached',
    };
  }

  /** @type {{callsToday:number, callsResetDate:string}} */
  let quotaState = { callsToday: cursor.callsToday, callsResetDate: cursor.callsResetDate || rateLimiter.todayKey(now) };

  /**
   * Consume one quota unit before each upstream call (token mint and
   * each pagination page). Throws when the cap is hit mid-pagination.
   */
  function consumeOne() {
    const r = rateLimiter.tryConsume(quotaState, limit, Date.now());
    if (!r.allowed) throw new Error('Netafim daily call quota reached mid-sync');
    quotaState = r.next;
  }

  try {
    consumeOne();
    const token = await getAccessToken();

    const items = [];
    const drained = await pagination.fetchAllPages(async (pageNumber) => {
      consumeOne();
      const page = await endpoints.fetchIrrigationLogsPage({
        token: token.token,
        dateFrom,
        dateTo,
        pageNumber,
        baseUrl: cfg.base_url,
        fetch: fetchImpl,
      });
      return page;
    });
    for (const it of drained.items) items.push(it);

    const writeNow = Date.now();
    const entries = [];
    for (const it of items) {
      const mapped = mapper.mapNetafimItemToReading(it, { now: writeNow });
      if (mapped) entries.push(mapped);
    }
    const parcelleUpserts = parcelles.buildParcelleUpserts(items, { now: writeNow });

    let readingsWritten = 0;
    let parcellesWritten = 0;
    if (!args.dryRun) {
      const r = await dataAccess.upsertReadings(db, entries);
      readingsWritten = r.written;
      const p = await parcelles.persistParcelles(db, parcelleUpserts);
      parcellesWritten = p.written;
      await dataAccess.writeSyncCursor(db, {
        lastRunAt: writeNow,
        lastDateTo: dateTo.toISOString(),
        callsToday: quotaState.callsToday,
        callsResetDate: quotaState.callsResetDate,
        lastError: null,
      });
    }

    return {
      ok: true,
      pagesFetched: drained.pagesFetched,
      itemsFetched: items.length,
      readingsWritten,
      parcellesWritten,
      rowCount: drained.rowCount,
      pageCount: drained.pageCount,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
    };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    if (!args.dryRun) {
      try {
        await dataAccess.writeSyncCursor(db, {
          lastRunAt: Date.now(),
          callsToday: quotaState.callsToday,
          callsResetDate: quotaState.callsResetDate,
          lastError: msg.slice(0, 500),
        });
      } catch (_) { /* swallow secondary failure */ }
    }
    return {
      ok: false,
      pagesFetched: 0,
      itemsFetched: 0,
      readingsWritten: 0,
      parcellesWritten: 0,
      rowCount: 0,
      pageCount: 0,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      error: msg,
    };
  }
}

module.exports = {
  // orchestrator
  syncBahia,
  NETAFIM_WINDOW_MAX_MS,
  // re-exports for direct consumption / tests
  ...auth,
  ...client,
  ...config,
  ...dataAccess,
  ...endpoints,
  ...mapper,
  ...pagination,
  ...parcelles,
  ...rateLimiter,
};
