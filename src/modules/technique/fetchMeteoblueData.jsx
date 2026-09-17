/* Module: technique | Déclaration(s): fetchMeteoblueData */
import { _dedupInflight } from '../shared/_dedupInflight.jsx';
import { _meteoblueCache } from '../shared/_meteoblueCache.jsx';
import { _meteoblueInflight } from '../shared/_meteoblueInflight.jsx';
import { METEO_CACHE_TTL } from './METEO_CACHE_TTL.jsx';
import { meteoFermes } from './meteoFermes.jsx';

async function fetchMeteoblueData(fermeKey) {
            const ferme = meteoFermes[fermeKey];
            if (!ferme) return null;
            const cacheKey = ferme.lat + '_' + ferme.lon + '_' + ferme.altitude + '_basic';
            const cached = _meteoblueCache[cacheKey];
            if (cached && (Date.now() - cached.ts) < METEO_CACHE_TTL) return cached.data;
            return _dedupInflight(_meteoblueInflight, cacheKey, async function() {
                const url = '/api/meteoblue?lat=' + ferme.lat + '&lon=' + ferme.lon + '&altitude=' + ferme.altitude + '&package=weather';
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error('API error ' + res.status);
                    const payload = await res.json();
                    if (!payload || !payload.success) throw new Error(payload && payload.error || 'meteoblue proxy error');
                    const data = payload.data;
                    _meteoblueCache[cacheKey] = { data, ts: Date.now() };
                    return data;
                } catch(e) {
                    console.warn('Meteoblue API error for ' + fermeKey + ':', e);
                    return null;
                }
            });
        }

export { fetchMeteoblueData };
