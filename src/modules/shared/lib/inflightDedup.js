/**
 * inflightDedup.js — Pure helper to deduplicate concurrent async calls by key.
 *
 * Purpose: when several callers request the SAME key while a fetch is still in
 * flight, they all await the SAME promise instead of each launching their own
 * network request. The registry entry is cleared once the promise settles, so a
 * later call (e.g. after the TTL cache expired) re-executes the underlying fn.
 *
 * It does NOT cache resolved values — TTL caching stays at the call site.
 * On rejection the entry is cleared too, so a failed call is never "stuck"
 * (allowing a later retry). No DOM, no network, no Firestore.
 */
// @ts-check

/**
 * Reuse an in-flight promise for a given key, or start one via fn().
 *
 * @param {Object<string, Promise<*>>} registry mutable map keyed by `key`
 * @param {string} key dedup key (e.g. a cache key)
 * @param {() => Promise<*>} fn factory launching the underlying async work
 * @returns {Promise<*>} the shared promise for that key
 */
function dedupInflight(registry, key, fn) {
    if (registry[key]) return registry[key];
    var p;
    try {
        p = Promise.resolve(fn());
    } catch (e) {
        // fn threw synchronously — surface it without poisoning the registry
        return Promise.reject(e);
    }
    var cleanup = function () { delete registry[key]; };
    // Clear the entry on settle (success OR failure) so we never cache a
    // result here and never get stuck on a dead in-flight entry.
    p.then(cleanup, cleanup);
    registry[key] = p;
    return p;
}

export { dedupInflight };
