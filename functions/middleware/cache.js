/**
 * cache.js — Firestore-backed cache with TTL for API responses.
 *
 * Usage:
 *   const { withCache } = require("./middleware/cache");
 *   const data = await withCache("my-key", 5 * 60 * 1000, async () => fetchExpensiveData());
 */

const { db } = require("../config/firebase");

function safeCacheKey(cacheKey) {
  return cacheKey.replace(/[\/\.\s#\[\]*]/g, "_").slice(0, 200);
}

async function withCache(cacheKey, ttlMs, fetchFn, shouldCache) {
  const safeKey = safeCacheKey(cacheKey);
  const docRef = db.collection("api_cache").doc(safeKey);
  // On conserve la dernière valeur cachée (même expirée) pour pouvoir s'y rabattre
  // si la recompute renvoie une réponse DÉGRADÉE (cf. shouldCache).
  let stalePayload = null;
  try {
    const snap = await docRef.get();
    if (snap.exists) {
      const d = snap.data();
      if (d._payload) { try { stalePayload = JSON.parse(d._payload); } catch (e) { stalePayload = null; } }
      if (Date.now() - (d._cachedAt || 0) < ttlMs) {
        const result = stalePayload || d;
        result.cached = true;
        return result;
      }
    }
  } catch (e) { /* cache miss, continue */ }
  const result = await fetchFn();
  // shouldCache(result) optionnel : la réponse est-elle saine (vs dégradée, ex: enrichissement échoué) ?
  const ok = typeof shouldCache !== "function" || shouldCache(result);
  if (ok) {
    docRef.set({ _payload: JSON.stringify(result), _cachedAt: Date.now() }).catch(() => {});
    return result;
  }
  // Réponse DÉGRADÉE : ne pas la cacher ET ne pas la servir si on a une dernière
  // valeur cachée SAINE — on sert le stale-good (évite, ex., un graphe Coût Récolte
  // vide quand l'enrichissement kg de recolte-equipes échoue ponctuellement).
  if (stalePayload && (typeof shouldCache !== "function" || shouldCache(stalePayload))) {
    stalePayload.cached = true;
    stalePayload.staleGoodFallback = true;
    return stalePayload;
  }
  return result;
}

async function invalidateCache(cacheKey) {
  const safeKey = safeCacheKey(cacheKey);
  await db.collection("api_cache").doc(safeKey).delete().catch(() => {});
}

module.exports = { withCache, invalidateCache };
