/**
 * paieDataCache.js — In-memory (module-level) cache for the Paie tab's heavy
 * Firestore reads, with a short TTL.
 *
 * WHY: PaieTab is unmounted/remounted every time the user opens the "Paie" tab
 * (renderTab returns null when the tab is inactive → all useEffect re-run on each
 * open). Each open re-fetched, from the Firestore SDK:
 *   - ouvriers_registry (~1636 docs),
 *   - app_settings/paie_import_meta,
 *   - sql_mirror_pointage over [minBaselineDate, periodEnd].
 * On WebKit/Safari (slower SDK + constrained main thread) this took >120s.
 *
 * This module memoises those reads behind a TTL so re-opening the tab within the
 * window reuses already-parsed data instead of re-hitting Firestore. It changes
 * NOTHING about the values: the same docs are returned, just from a cache. The
 * loader functions (passed in by the caller) are only invoked on a cache miss.
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/paieDataCache.js"> → window.PaieDataCache
 *   - In node:test via require('./paieDataCache.js') → module.exports
 *
 * No DOM, no direct Firestore, no network: the caller injects the async loader.
 *
 * IMPORTANT global-name discipline (anti-boot-crash, issues #75/#77): this module
 * exposes EXACTLY ONE global, `window.PaieDataCache`, and the unique internal name
 * `__paieDataCacheApi`. Never reuse `__api` (collides → React boot crash).
 */
// @ts-check
'use strict';

(function () {

  /** Default time-to-live for cached entries, in milliseconds (5 minutes). */
  var DEFAULT_TTL_MS = 5 * 60 * 1000;

  /**
   * @typedef {{ value: any, ts: number }} CacheEntry
   */

  /** @type {Object<string, CacheEntry>} */
  var store = {};

  /**
   * Build the cache key for the dated pointage range.
   * @param {string} minDate — 'YYYY-MM-DD' lower bound (inclusive).
   * @param {string} maxDate — 'YYYY-MM-DD' upper bound (inclusive).
   * @returns {string}
   */
  function pointageKey(minDate, maxDate) {
    return 'pointage:' + String(minDate || '') + '..' + String(maxDate || '');
  }

  /**
   * Return a cached value if present and not expired, else undefined.
   * @param {string} key
   * @param {number} [ttlMs]
   * @param {number} [now] - injectable clock for tests.
   * @returns {any|undefined}
   */
  function peek(key, ttlMs, now) {
    var ttl = typeof ttlMs === 'number' ? ttlMs : DEFAULT_TTL_MS;
    var t = typeof now === 'number' ? now : Date.now();
    var entry = store[key];
    if (entry && (t - entry.ts) < ttl) return entry.value;
    return undefined;
  }

  /**
   * Store a value under a key with the current timestamp.
   * @param {string} key
   * @param {any} value
   * @param {number} [now] - injectable clock for tests.
   * @returns {any} the stored value (for chaining).
   */
  function set(key, value, now) {
    store[key] = { value: value, ts: typeof now === 'number' ? now : Date.now() };
    return value;
  }

  /**
   * Get-or-load: return the cached value if fresh, otherwise call `loader()`
   * (an async function), cache its result, and return it. On loader error the
   * cache is left untouched and the error propagates.
   *
   * NOTE: concurrent calls for the same key are de-duplicated — the in-flight
   * promise is cached so a second caller awaits the same load instead of firing
   * a duplicate Firestore read (this is what removes the double init/period
   * effect cost on mount).
   *
   * @param {string} key
   * @param {() => Promise<any>} loader
   * @param {{ ttlMs?: number, now?: number }} [opts]
   * @returns {Promise<any>}
   */
  function getOrLoad(key, loader, opts) {
    opts = opts || {};
    var cached = peek(key, opts.ttlMs, opts.now);
    if (cached !== undefined) return Promise.resolve(cached);
    var entry = store[key];
    // In-flight de-dup: a pending promise is stored as the value.
    if (entry && entry.value && typeof entry.value.then === 'function') {
      return entry.value;
    }
    var p = Promise.resolve()
      .then(loader)
      .then(function (result) {
        set(key, result, opts.now);
        return result;
      })
      .catch(function (err) {
        // Drop the in-flight placeholder so a retry can re-load.
        if (store[key] && store[key].value === p) delete store[key];
        throw err;
      });
    // Park the in-flight promise so concurrent callers reuse it.
    store[key] = { value: p, ts: typeof opts.now === 'number' ? opts.now : Date.now() };
    return p;
  }

  /**
   * Invalidate one key (exact) or, if a prefix is given, all keys starting with it.
   * Called after writes (toggleDeclare, prime de fonction, imports) so the next
   * open reflects the mutation rather than a stale cache.
   * @param {string} [prefix] - if omitted, clears everything.
   */
  function invalidate(prefix) {
    if (!prefix) { store = {}; return; }
    Object.keys(store).forEach(function (k) {
      if (k === prefix || k.indexOf(prefix) === 0) delete store[k];
    });
  }

  var __paieDataCacheApi = {
    DEFAULT_TTL_MS: DEFAULT_TTL_MS,
    pointageKey: pointageKey,
    peek: peek,
    set: set,
    getOrLoad: getOrLoad,
    invalidate: invalidate,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __paieDataCacheApi;
  if (typeof window !== 'undefined') window.PaieDataCache = __paieDataCacheApi;

})();
