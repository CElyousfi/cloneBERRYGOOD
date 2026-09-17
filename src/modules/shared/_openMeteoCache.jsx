/* Module: shared | Déclaration(s): _openMeteoCache */


// ===================== OPEN-METEO (fallback "Hier") =====================
        // Meteoblue's packages only expose today+forward, so yesterday's hourly series
        // is unavailable. Open-Meteo is free, key-less and CORS-open: with past_days=1
        // it returns yesterday's hourly data. We map it to the SAME entry schema as
        // transformMeteoblueData's horaire24ParJour[dateISO] so MeteoPrevisionExterieure
        // can consume it unchanged (computeHourlyVPD / computeCumRadiation read tempRaw,
        // humidityRaw, radiation, eto, hour).
        const _openMeteoCache = new Map();

export { _openMeteoCache };
