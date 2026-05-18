// @ts-check
'use strict';

/**
 * OAuth 2.0 client_credentials flow against Netafim's token endpoint.
 *
 * Netafim issues tokens valid for ~3600s and they cannot be refreshed.
 * We cache the token in-process and force a renewal at TTL minus a 5-min
 * safety margin so a long-running CF doesn't fire a request with a
 * just-expired bearer.
 *
 * Per Netafim doc, when `Client Authentication = "Send client credentials
 * in body"`, the body is `grant_type=client_credentials&client_id=...&
 * client_secret=...` with content-type `application/x-www-form-urlencoded`.
 */

const TOKEN_TTL_SAFETY_MS = 5 * 60 * 1000; // renew 5 min before nominal expiry
const FALLBACK_TTL_MS = 60 * 60 * 1000;    // 60 min per Netafim docs

/**
 * Build a token getter bound to a config getter + fetch impl. Closure
 * holds the cached token; callers share the closure to share the cache.
 *
 * @param {Object} deps
 * @param {() => Promise<import('./types').NetafimConfig | null>} deps.getConfig
 * @param {typeof fetch} [deps.fetch]
 * @param {() => number} [deps.now]
 * @returns {() => Promise<import('./types').NetafimToken>}
 */
function makeGetAccessToken(deps) {
  if (!deps || typeof deps.getConfig !== 'function') {
    throw new Error('makeGetAccessToken: deps.getConfig is required');
  }
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || Date.now;
  let cached = /** @type {import('./types').NetafimToken | null} */ (null);

  return async function getAccessToken() {
    if (cached && cached.expiresAt - TOKEN_TTL_SAFETY_MS > now()) {
      return cached;
    }
    const config = await deps.getConfig();
    if (!config) throw new Error('Netafim config missing (config/netafim)');
    if (!config.client_id || !config.client_secret) {
      throw new Error('Netafim config: client_id / client_secret missing');
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.client_id,
      client_secret: config.client_secret,
    }).toString();

    const res = await fetchImpl(config.token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error('Netafim token request failed (' + res.status + '): ' + raw.slice(0, 300));
    }
    /** @type {any} */
    let payload;
    try { payload = JSON.parse(raw); } catch (_) {
      throw new Error('Netafim token response is not JSON: ' + raw.slice(0, 200));
    }
    const access = payload.access_token || payload.accessToken;
    if (!access) throw new Error('Netafim token response missing access_token');
    const expiresInMs = Number.isFinite(payload.expires_in)
      ? Number(payload.expires_in) * 1000
      : FALLBACK_TTL_MS;
    cached = { token: access, expiresAt: now() + expiresInMs };
    return cached;
  };
}

module.exports = {
  TOKEN_TTL_SAFETY_MS,
  FALLBACK_TTL_MS,
  makeGetAccessToken,
};
