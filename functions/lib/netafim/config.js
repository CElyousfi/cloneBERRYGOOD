// @ts-check
'use strict';

/**
 * Reads `config/netafim` from Firestore with a 5-minute in-memory cache.
 * Mirrors the pattern used by `functions/whatsappService.js`.
 *
 * Doc shape (seeded manually via Firebase console):
 *   {
 *     enabled: true,
 *     client_id: "...",
 *     client_secret: "...",
 *     base_url: "https://apim.netafim.com",
 *     token_url: "https://apim.netafim.com/oauth2/token",
 *     daily_call_limit: 25,
 *     farm_label: "BAHIA"
 *   }
 *
 * Credentials are NEVER committed; the doc is created out-of-band.
 */

const CONFIG_COLLECTION = 'config';
const CONFIG_DOC = 'netafim';
const CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULTS = {
  base_url: 'https://apim.netafim.com',
  token_url: 'https://apim.netafim.com/oauth2/token',
  daily_call_limit: 25,
  farm_label: 'BAHIA',
};

/**
 * Build a getConfig function bound to a Firestore instance. Returning a
 * factory keeps the module pure and testable (no module-global state
 * shared across consumers / tests).
 *
 * @param {*} db  Firestore instance
 * @returns {() => Promise<import('./types').NetafimConfig | null>}
 */
function makeGetConfig(db) {
  if (!db) throw new Error('makeGetConfig: db is required');
  let cache = null;
  let cacheAt = 0;
  return async function getConfig() {
    if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
    const snap = await db.collection(CONFIG_COLLECTION).doc(CONFIG_DOC).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    cache = { ...DEFAULTS, ...data };
    cacheAt = Date.now();
    return cache;
  };
}

/**
 * Resets the module-level cache held by a getConfig closure. Not
 * exposed publicly — closures hold their own state — but kept here
 * for documentation. Tests construct fresh getConfig via makeGetConfig.
 */

module.exports = {
  CONFIG_COLLECTION,
  CONFIG_DOC,
  CACHE_TTL_MS,
  DEFAULTS,
  makeGetConfig,
};
