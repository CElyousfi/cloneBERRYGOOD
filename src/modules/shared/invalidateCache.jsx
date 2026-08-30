/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: shared | Déclaration(s): invalidateCache */
import { _apiCache } from './_apiCache.jsx';

function invalidateCache(urlPattern) {
            // Clear memory cache
            Object.keys(_apiCache).forEach(k => {
                if (!urlPattern || k.includes(urlPattern)) delete _apiCache[k];
            });
            // Clear ALL localStorage cache entries (not just known keys)
            try {
                Object.keys(localStorage).forEach(k => {
                    if (k.startsWith('cache_') && (!urlPattern || k.includes(urlPattern))) localStorage.removeItem(k);
                });
            } catch(e) {}
        }

export { invalidateCache };
