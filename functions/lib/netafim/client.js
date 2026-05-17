// @ts-check
'use strict';

/**
 * Thin HTTP wrapper around Netafim's POST endpoints. Maps HTTP statuses
 * to typed errors so callers can branch on intent (no data vs. quota vs.
 * server). All API calls in this module pass through here so the rate
 * limiter and error handling stay centralized.
 *
 * Netafim status semantics (per V3 doc):
 *   200 OK
 *   401 Unauthorized        → token expired / invalid
 *   404 Not Found           → no data for window OR > 7 days back
 *   422 Unprocessable       → request body invalid
 *   500 Server error        → upstream issue
 */

class NetafimError extends Error {
  /** @param {string} message @param {string} kind @param {number} [status] @param {any} [body] */
  constructor(message, kind, status, body) {
    super(message);
    this.name = 'NetafimError';
    this.kind = kind;
    this.status = status || 0;
    this.body = body;
  }
}

const KIND = {
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  NO_DATA: 'NO_DATA',
  PROCESSING: 'PROCESSING',
  SERVER: 'SERVER',
  UNKNOWN: 'UNKNOWN',
};

function classify(status) {
  switch (status) {
    case 401: return KIND.TOKEN_EXPIRED;
    case 404: return KIND.NO_DATA;
    case 422: return KIND.PROCESSING;
    case 500: return KIND.SERVER;
    default:  return KIND.UNKNOWN;
  }
}

/**
 * @param {Object} args
 * @param {string} args.url
 * @param {string} args.token
 * @param {Object} args.body
 * @param {typeof fetch} [args.fetch]
 * @returns {Promise<any>}
 */
async function postJson(args) {
  const { url, token, body } = args;
  const fetchImpl = args.fetch || fetch;
  if (!url) throw new Error('postJson: url is required');
  if (!token) throw new Error('postJson: token is required');

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const raw = await res.text();
  /** @type {any} */ let parsed = null;
  if (raw) { try { parsed = JSON.parse(raw); } catch (_) { parsed = { raw }; } }

  if (!res.ok) {
    const msg = (parsed && (parsed.message || parsed.error)) || ('HTTP ' + res.status);
    throw new NetafimError(String(msg), classify(res.status), res.status, parsed);
  }
  return parsed;
}

module.exports = {
  NetafimError,
  KIND,
  classify,
  postJson,
};
