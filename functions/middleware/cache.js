/**
 * cache.js — Firestore-backed cache with TTL for API responses.
 *
 * Usage:
 *   const { withCache } = require("./middleware/cache");
 *   const data = await withCache("my-key", 5 * 60 * 1000, async () => fetchExpensiveData());
 */

const { db, admin } = require("../config/firebase");

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

/**
 * Invalide TOUTES les entrées de cache dont la clé commence par `prefix`.
 *
 * Pourquoi un préfixe et pas une clé : les réponses ferme-aware sont cachées
 * une fois PAR PÉRIMÈTRE (`pointageCacheKey` suffixe `_all`, `_f1`,
 * `_f1_framboise`…). Après une correction de donnée, supprimer la seule entrée
 * `_all` laisserait les chefs sur une réponse périmée — et énumérer les
 * périmètres connus serait un fail-open : le jour où un périmètre s'ajoute, son
 * cache survivrait en silence.
 *
 * Balayage par plage d'identifiants de document (`documentId() >= prefix` et
 * `< prefix + \uf8ff`), donc borné au préfixe : jamais un `.get()` sur toute
 * la collection `api_cache`.
 *
 * Best-effort, comme `invalidateCache` : un échec de purge ne doit pas faire
 * échouer l'écriture métier qui l'a déclenchée (le cache expirera de lui-même).
 *
 * @param {string} prefix préfixe de clé (avant passage par safeCacheKey).
 * @returns {Promise<number>} nombre d'entrées supprimées (0 en cas d'échec).
 */
async function invalidateCachePrefix(prefix) {
  const safePrefix = safeCacheKey(String(prefix || ""));
  if (!safePrefix) return 0;
  try {
    const snap = await db
      .collection("api_cache")
      .where(admin.firestore.FieldPath.documentId(), ">=", safePrefix)
      .where(admin.firestore.FieldPath.documentId(), "<", safePrefix + "\uf8ff")
      .get();
    if (snap.empty) return 0;
    // Chunks de 400 : limite Firestore de 500 écritures/batch, marge de 100
    // (convention du repo).
    const docs = snap.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = db.batch();
      docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    return docs.length;
  } catch (e) {
    console.error("[cache] invalidateCachePrefix échec:", e.message);
    return 0;
  }
}

module.exports = { withCache, invalidateCache, invalidateCachePrefix };
