/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): _trimLSCacheIfNeeded */
import { CACHE_MAX_ENTRIES } from './CACHE_MAX_ENTRIES.jsx';

function _trimLSCacheIfNeeded() {
            try {
                var keys = Object.keys(localStorage).filter(function(k) { return k.startsWith('cache_'); });
                if (keys.length <= CACHE_MAX_ENTRIES) return;
                // Remove oldest entries (sort by stored ts, drop the tail)
                var entries = keys.map(function(k) {
                    try { return { k: k, ts: JSON.parse(localStorage.getItem(k)).ts || 0 }; } catch(e) { return { k: k, ts: 0 }; }
                });
                entries.sort(function(a, b) { return a.ts - b.ts; });
                entries.slice(0, entries.length - CACHE_MAX_ENTRIES).forEach(function(e) { localStorage.removeItem(e.k); });
            } catch(e) {}
        }

export { _trimLSCacheIfNeeded };
