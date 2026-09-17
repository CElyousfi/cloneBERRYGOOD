/* Module: technique | Déclaration(s): fetchOpenMeteoHourly */
import { _openMeteoCache } from '../shared/_openMeteoCache.jsx';
import { OPEN_METEO_CACHE_TTL } from './OPEN_METEO_CACHE_TTL.jsx';
import { meteoFermes } from './meteoFermes.jsx';

// 30 min

        async function fetchOpenMeteoHourly(fermeKey, dateISO) {
            const ferme = meteoFermes[fermeKey];
            if (!ferme) return null;
            const cacheKey = fermeKey + '_' + dateISO;
            const cached = _openMeteoCache.get(cacheKey);
            if (cached && (Date.now() - cached.ts) < OPEN_METEO_CACHE_TTL) return cached.data;
            const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + ferme.lat + '&longitude=' + ferme.lon +
                '&hourly=temperature_2m,relative_humidity_2m,shortwave_radiation,et0_fao_evapotranspiration' +
                '&past_days=1&forecast_days=1&timezone=Africa%2FCasablanca';
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error('API error ' + res.status);
                const data = await res.json();
                const h = data && data.hourly;
                if (!h || !h.time) return null;
                const out = [];
                h.time.forEach(function(t, i) {
                    // t looks like "2026-06-07T00:00"
                    var parts = t.split('T');
                    if (parts[0] !== dateISO) return;
                    var hour = parseInt(parts[1], 10);
                    var rawTemp = h.temperature_2m ? Number(h.temperature_2m[i]) : 0;
                    var rawRH = h.relative_humidity_2m ? Number(h.relative_humidity_2m[i]) : 50;
                    var rawSW = h.shortwave_radiation ? Number(h.shortwave_radiation[i]) : 0;
                    var rawEto = h.et0_fao_evapotranspiration ? Number(h.et0_fao_evapotranspiration[i]) : 0;
                    out.push({
                        heure: String(hour).padStart(2, '0') + ':00',
                        hour: hour,
                        temp: Math.round(rawTemp),
                        tempRaw: rawTemp,
                        humidity: Math.round(rawRH),
                        humidityRaw: rawRH,
                        vent: 0,
                        precip: 0,
                        radiation: rawSW,
                        eto: rawEto,
                        icon: hour < 7 || hour > 19 ? 'fa-moon' : 'fa-sun',
                        condition: '',
                        feltTemp: Math.round(rawTemp),
                    });
                });
                if (!out.length) return null;
                _openMeteoCache.set(cacheKey, { data: out, ts: Date.now() });
                return out;
            } catch(e) {
                console.warn('Open-Meteo API error for ' + fermeKey + ' ' + dateISO + ':', e);
                return null;
            }
        }

export { fetchOpenMeteoHourly };
