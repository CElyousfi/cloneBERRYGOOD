/* Module: shared | Déclaration(s): cachedFetch */
import { CACHE_TTL } from './CACHE_TTL.jsx';
import { _apiCache } from './_apiCache.jsx';
import { _purgeLSCache } from './_purgeLSCache.jsx';
import { _trimLSCacheIfNeeded } from './_trimLSCacheIfNeeded.jsx';

function cachedFetch(url) {
            const now = Date.now();
            // 1. Memory cache hit (< 5 min)
            if (_apiCache[url] && (now - _apiCache[url].ts < CACHE_TTL)) {
                return Promise.resolve(_apiCache[url].data);
            }
            // 2. localStorage cache hit (< 5 min)
            try {
                const stored = localStorage.getItem('cache_' + url);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (now - parsed.ts < CACHE_TTL) {
                        _apiCache[url] = { data: parsed.data, ts: parsed.ts };
                        return Promise.resolve(parsed.data);
                    }
                }
            } catch(e) {}
            // 3. Cache miss or expired — fetch fresh from network
            return fetch(url).then(r => r.json()).then(data => {
                _apiCache[url] = { data, ts: Date.now() };
                try {
                    _trimLSCacheIfNeeded();
                    localStorage.setItem('cache_' + url, JSON.stringify({ data, ts: Date.now() }));
                } catch(e) {
                    // Quota exceeded — purge all cache_ entries then retry once
                    try {
                        _purgeLSCache();
                        localStorage.setItem('cache_' + url, JSON.stringify({ data, ts: Date.now() }));
                    } catch(e2) {}
                }
                return data;
            });
        }

export { cachedFetch };
