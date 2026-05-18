// @ts-check
'use strict';

/**
 * Single-page fetchers for the two GrowSphere V3 endpoints we use.
 *
 *   POST <base>/irrigationv3/irrigationlogs-pagination-prod
 *   POST <base>/irrigationv3/accumulationevents-pagination-prod
 *
 * Body: { startTimestampFrom, startTimestampTo, pageNumber }
 *   - startTimestamp* are ISO strings (Z).
 *   - Netafim enforces a max 7-day window; 404 is returned for wider ranges.
 *
 * farmId is implicit via the client_id used to mint the token (per the
 * Netafim onboarding doc, section "Customer Enterprise ID").
 */

const { postJson } = require('./client');

const PATH_IRRIGATION_LOGS = '/irrigationv3/irrigationlogs-pagination-prod';
const PATH_ACCUMULATION_EVENTS = '/irrigationv3/accumulationevents-pagination-prod';

/**
 * @param {string} baseUrl
 * @param {string} path
 * @returns {string}
 */
function joinUrl(baseUrl, path) {
  if (!baseUrl) throw new Error('joinUrl: baseUrl is required');
  const trimmed = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith('/') ? path : '/' + path;
  return trimmed + suffix;
}

/**
 * @param {Date|string} d
 * @returns {string} ISO with Z
 */
function toIso(d) {
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'string') return new Date(d).toISOString();
  throw new Error('toIso: expected Date or string');
}

/**
 * @param {Object} args
 * @param {string} args.token
 * @param {Date|string} args.dateFrom
 * @param {Date|string} args.dateTo
 * @param {number} args.pageNumber
 * @param {string} args.baseUrl
 * @param {typeof fetch} [args.fetch]
 * @returns {Promise<import('./types').NetafimPage>}
 */
async function fetchIrrigationLogsPage(args) {
  const { token, dateFrom, dateTo, pageNumber, baseUrl } = args;
  return postJson({
    url: joinUrl(baseUrl, PATH_IRRIGATION_LOGS),
    token,
    body: {
      startTimestampFrom: toIso(dateFrom),
      startTimestampTo: toIso(dateTo),
      pageNumber,
    },
    fetch: args.fetch,
  });
}

/**
 * @param {Object} args
 * @param {string} args.token
 * @param {Date|string} args.dateFrom
 * @param {Date|string} args.dateTo
 * @param {number} args.pageNumber
 * @param {string} args.baseUrl
 * @param {typeof fetch} [args.fetch]
 * @returns {Promise<import('./types').NetafimPage>}
 */
async function fetchAccumulationEventsPage(args) {
  const { token, dateFrom, dateTo, pageNumber, baseUrl } = args;
  return postJson({
    url: joinUrl(baseUrl, PATH_ACCUMULATION_EVENTS),
    token,
    body: {
      startTimestampFrom: toIso(dateFrom),
      startTimestampTo: toIso(dateTo),
      pageNumber,
    },
    fetch: args.fetch,
  });
}

module.exports = {
  PATH_IRRIGATION_LOGS,
  PATH_ACCUMULATION_EVENTS,
  joinUrl,
  toIso,
  fetchIrrigationLogsPage,
  fetchAccumulationEventsPage,
};
