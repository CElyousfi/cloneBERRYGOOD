/**
 * cache.js — Firestore-backed cache with TTL for API responses.
 *
 * Usage:
 *   const { withCache } = require("./middleware/cache");
 *   const data = await withCache("my-key", 5 * 60 * 1000, async () => fetchExpensiveData());
 */

const { db } = require("../config/firebase");

async function withCache(cacheKey, ttlMs, fetchFn) {
  const safeKey = cacheKey.replace(/[\/\.\s#\[\]*]/g, "_").slice(0, 200);
  const docRef = db.collection("api_cache").doc(safeKey);
  try {
    const snap = await docRef.get();
    if (snap.exists) {
      const d = snap.data();
      if (Date.now() - (d._cachedAt || 0) < ttlMs) {
        const result = d._payload ? JSON.parse(d._payload) : d;
        result.cached = true;
        return result;
      }
    }
  } catch (e) { /* cache miss, continue */ }
  const result = await fetchFn();
  docRef.set({ _payload: JSON.stringify(result), _cachedAt: Date.now() }).catch(() => {});
  return result;
}

module.exports = { withCache };
