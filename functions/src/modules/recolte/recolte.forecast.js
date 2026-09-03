/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

// `sql` est un singleton paresseux de shared/core : acces par l'objet de module
// (__core.sql) pour lire la valeur COURANTE, jamais une copie figee a null.
const __core = require("../../shared/core");

const { USE_MIRROR, aggregateSerreData, db_firestore, functions, getCueilletteRows, getMeteoLaouamra, refreshFarmroadCache, requireAuth, setCors, sqlConfig, withCache} = require("../../shared/core");

async function fetchMeteoblueForecast() {
  const https = require("https");
  const url = `https://my.meteoblue.com/packages/basic-day_agro-day_basic-1h?apikey=${METEOBLUE_API_KEY}&lat=${FORECAST_FARM.lat}&lon=${FORECAST_FARM.lon}&asl=${FORECAST_FARM.asl}&format=json`;
  return new Promise((resolve) => {
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (c) => { data += c; });
      resp.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

// Default indoor transfer coefficients (will be learned)
const DEFAULT_MODEL = {
  canarienne: {
    temp_offset: 5.0,    // T_indoor = T_outdoor + offset
    temp_scale: 0.85,    // T_indoor_range = T_outdoor_range * scale
    hr_offset: 15,       // HR_indoor = HR_outdoor + offset (more humid inside)
    hr_cap: 99,
    co2_base: 2200,      // Base CO2 (ppm) — canarienne has higher CO2
    co2_temp_factor: 30, // CO2 increases with temperature
    par_transmittance: 0.65, // PAR inside = PAR outside * transmittance
    vpd_scale: 0.7,      // VPD dampened inside
    radiation_transmittance: 0.60, // Radiation indoor = outdoor * transmittance
    substrate_base: 55,       // Base substrate moisture %
    substrate_temp_factor: -0.3, // Substrate drops as temp rises
    pressure_offset: 0.0,    // Pressure indoor ≈ outdoor
  },
  tunnel: {
    temp_offset: 4.0,
    temp_scale: 0.9,
    hr_offset: 12,
    hr_cap: 99,
    co2_base: 1200,
    co2_temp_factor: 15,
    par_transmittance: 0.55,
    vpd_scale: 0.75,
    radiation_transmittance: 0.50,
    substrate_base: 58,
    substrate_temp_factor: -0.25,
    pressure_offset: 0.0,
  }
};

// Calculate VPD from temperature and humidity
function calcVPD(temp, hr) {
  const esat = 0.6108 * Math.exp((17.27 * temp) / (temp + 237.3));
  return Math.max(0, esat * (1 - hr / 100));
}

// Calculate dew point from temperature and humidity (Magnus formula)
function calcDewpoint(temp, hr) {
  if (hr <= 0) return temp - 20;
  const gamma = (17.27 * temp) / (237.3 + temp) + Math.log(hr / 100);
  return Math.round((237.3 * gamma) / (17.27 - gamma) * 10) / 10;
}

// Predict indoor conditions from outdoor forecast (daily)
function predictIndoor(outdoor, model) {
  const tAvgOut = (outdoor.tmax + outdoor.tmin) / 2;
  const tRangeOut = outdoor.tmax - outdoor.tmin;

  const tAvgIn = tAvgOut + model.temp_offset;
  const tRangeIn = tRangeOut * model.temp_scale;
  const tMax = Math.round((tAvgIn + tRangeIn / 2) * 10) / 10;
  const tMin = Math.round((tAvgIn - tRangeIn / 2) * 10) / 10;

  const hr = Math.min(model.hr_cap || 99, Math.round(outdoor.humidity + model.hr_offset));
  const co2 = Math.round(model.co2_base + model.co2_temp_factor * (tAvgIn - 20));
  const par = outdoor.radiation ? Math.round(outdoor.radiation * model.par_transmittance * 10) / 10 : null;
  const vpd = Math.round(calcVPD((tMax + tMin) / 2, hr) * model.vpd_scale * 100) / 100;
  const radiation = outdoor.radiation != null ? Math.round(outdoor.radiation * (model.radiation_transmittance || 0.6) * 10) / 10 : null;
  const substrate = Math.round(((model.substrate_base || 55) + (model.substrate_temp_factor || -0.3) * (tAvgIn - 20)) * 10) / 10;
  const dewpoint = calcDewpoint(tAvgIn, hr);
  const pressure = outdoor.pressure != null ? Math.round((outdoor.pressure + (model.pressure_offset || 0)) * 10) / 10 : null;

  return { tMax, tMin, tAvg: Math.round(tAvgIn * 10) / 10, hr, co2, par, vpd, radiation, substrate, dewpoint, pressure };
}

// Predict indoor conditions from outdoor forecast (hourly — single hour)
function predictIndoorHourly(hourOutdoor, model) {
  const tOut = hourOutdoor.temperature;
  const tempIndoor = Math.round((tOut + model.temp_offset) * 10) / 10;
  const hrIndoor = Math.min(model.hr_cap || 99, Math.round((hourOutdoor.relativehumidity || 70) + model.hr_offset));
  const co2 = Math.round(model.co2_base + model.co2_temp_factor * (tempIndoor - 20));
  const swRad = hourOutdoor.shortwave_radiation || 0;
  const par = Math.round(swRad * model.par_transmittance * 4.57 * 0.001 * 100) / 100; // W/m² → µmol/m²/s approx
  const radiation = Math.round(swRad * (model.radiation_transmittance || 0.6) * 10) / 10;
  const vpd = Math.round(calcVPD(tempIndoor, hrIndoor) * model.vpd_scale * 100) / 100;
  const dewpoint = calcDewpoint(tempIndoor, hrIndoor);
  const substrate = Math.round(((model.substrate_base || 55) + (model.substrate_temp_factor || -0.3) * (tempIndoor - 20)) * 10) / 10;
  const pressure = hourOutdoor.sealevelpressure != null ? Math.round((hourOutdoor.sealevelpressure + (model.pressure_offset || 0)) * 10) / 10 : null;

  return { time: hourOutdoor.time, temp: tempIndoor, hr: hrIndoor, co2, par, radiation, vpd, dewpoint, substrate, pressure };
}

// Update model coefficients using EMA (exponential moving average)
function updateModelCoeffs(currentModel, predicted, actual, alpha) {
  const a = alpha || 0.15; // learning rate
  const updated = { ...currentModel };

  // Learn temp_offset from actual vs outdoor
  if (actual.tMax != null && predicted._outdoorTmax != null) {
    const actualOffset = ((actual.tMax + actual.tMin) / 2) - ((predicted._outdoorTmax + predicted._outdoorTmin) / 2);
    updated.temp_offset = Math.round((currentModel.temp_offset * (1 - a) + actualOffset * a) * 100) / 100;
  }

  // Learn HR offset
  if (actual.hr != null && predicted._outdoorHr != null) {
    const actualHrOffset = actual.hr - predicted._outdoorHr;
    updated.hr_offset = Math.round((currentModel.hr_offset * (1 - a) + actualHrOffset * a) * 100) / 100;
  }

  // Learn temp_scale from range ratio
  if (actual.tMax != null && actual.tMin != null && predicted._outdoorTmax != null) {
    const actualRange = actual.tMax - actual.tMin;
    const outdoorRange = predicted._outdoorTmax - predicted._outdoorTmin;
    if (outdoorRange > 2) {
      const actualScale = actualRange / outdoorRange;
      updated.temp_scale = Math.round((currentModel.temp_scale * (1 - a) + actualScale * a) * 100) / 100;
      updated.temp_scale = Math.max(0.3, Math.min(1.5, updated.temp_scale));
    }
  }

  // Learn radiation_transmittance
  if (actual.radiation != null && predicted._outdoorRadiation != null && predicted._outdoorRadiation > 0) {
    const actualRadTrans = actual.radiation / predicted._outdoorRadiation;
    updated.radiation_transmittance = Math.round((currentModel.radiation_transmittance * (1 - a) + actualRadTrans * a) * 100) / 100;
    updated.radiation_transmittance = Math.max(0.1, Math.min(0.95, updated.radiation_transmittance));
  }

  // Learn substrate_base from actual substrate
  if (actual.substrat != null) {
    const actualBase = actual.substrat - (currentModel.substrate_temp_factor || -0.3) * (((actual.tMax || 25) + (actual.tMin || 15)) / 2 - 20);
    updated.substrate_base = Math.round((currentModel.substrate_base * (1 - a) + actualBase * a) * 100) / 100;
    updated.substrate_base = Math.max(20, Math.min(95, updated.substrate_base));
  }

  // Learn pressure_offset
  if (actual.pressure != null && predicted._outdoorPressure != null) {
    const actualPressOffset = actual.pressure - predicted._outdoorPressure;
    updated.pressure_offset = Math.round(((currentModel.pressure_offset || 0) * (1 - a) + actualPressOffset * a) * 100) / 100;
  }

  return updated;
}

// Compute accuracy metrics
function computeAccuracy(predicted, actual) {
  const errors = {};
  const addError = (key, pVal, aVal) => {
    if (pVal == null || aVal == null) return;
    errors[key + '_error'] = Math.round((pVal - aVal) * 10) / 10;
    errors[key + '_pct'] = aVal !== 0 ? Math.round(Math.abs(errors[key + '_error'] / aVal) * 1000) / 10 : 0;
  };
  addError('tMax', predicted.tMax, actual.tMax);
  addError('tMin', predicted.tMin, actual.tMin);
  addError('hr', predicted.hr, actual.hr);
  addError('co2', predicted.co2, actual.co2);
  addError('vpd', predicted.vpd, actual.vpd);
  addError('par', predicted.par, actual.par);
  addError('radiation', predicted.radiation, actual.radiation);
  addError('substrate', predicted.substrate, actual.substrat);
  addError('dewpoint', predicted.dewpoint, actual.dewpoint);
  addError('pressure', predicted.pressure, actual.pressure);
  // MAPE global (core params only: tMax, tMin, hr — same as before for consistency)
  const pcts = [errors.tMax_pct, errors.tMin_pct, errors.hr_pct].filter(v => v != null);
  errors.mape = pcts.length > 0 ? Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length * 10) / 10 : null;
  return errors;
}

// Main scheduled function: runs daily at 21:00
exports.indoorForecastRefresh = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .pubsub.schedule("0 21 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    console.log("[IndoorForecast] Daily refresh for " + todayStr);

    try {
      // 1) Fetch MeteoBlue forecast
      const meteoRaw = await fetchMeteoblueForecast();
      if (!meteoRaw || !meteoRaw.data_day) {
        console.error("[IndoorForecast] MeteoBlue fetch failed");
        return null;
      }

      // 2) Store raw MeteoBlue forecast
      const dayData = meteoRaw.data_day;
      const forecastDays = (dayData.time || []).map((dateStr, i) => ({
        date: dateStr,
        tmax: dayData.temperature_max ? dayData.temperature_max[i] : null,
        tmin: dayData.temperature_min ? dayData.temperature_min[i] : null,
        humidity: dayData.relativehumidity_mean ? dayData.relativehumidity_mean[i] : null,
        vent: dayData.windspeed_max ? dayData.windspeed_max[i] : null,
        precip: dayData.precipitation ? dayData.precipitation[i] : null,
        eto: dayData.evapotranspiration ? dayData.evapotranspiration[i] : null,
        radiation: dayData.shortwave_radiation_sum ? dayData.shortwave_radiation_sum[i] : null,
        uv: dayData.uvindex ? dayData.uvindex[i] : null,
      }));

      // Parse hourly data (data_1h)
      const hourlyRaw = meteoRaw.data_1h || {};
      const hourlyTimes = hourlyRaw.time || [];
      const hourlyData = hourlyTimes.map((t, i) => ({
        time: t,
        date: t ? t.slice(0, 10) : null,
        temperature: hourlyRaw.temperature ? hourlyRaw.temperature[i] : null,
        relativehumidity: hourlyRaw.relativehumidity ? hourlyRaw.relativehumidity[i] : null,
        windspeed: hourlyRaw.windspeed ? hourlyRaw.windspeed[i] : null,
        shortwave_radiation: hourlyRaw.shortwave_radiation ? hourlyRaw.shortwave_radiation[i] : null,
        sealevelpressure: hourlyRaw.sealevelpressure ? hourlyRaw.sealevelpressure[i] : null,
      }));
      // Group hourly data by date
      const hourlyByDate = {};
      for (const h of hourlyData) {
        if (!h.date) continue;
        if (!hourlyByDate[h.date]) hourlyByDate[h.date] = [];
        hourlyByDate[h.date].push(h);
      }

      // Store in meteo_history
      await db_firestore.collection("meteo_history").doc(todayStr).set({
        fetchedAt: todayStr,
        forecast: forecastDays,
        hourlyForecast: hourlyData,
        _cachedAt: Date.now()
      });

      // 3) Get today's actual FarmRoad data for calibration
      const farmroadData = await refreshFarmroadCache(todayStr, null);
      const devices = (farmroadData && farmroadData.devices) || [];

      // Identify Canarienne / Tunnel via explicit deviceId mapping
      const { FARMROAD_DEVICE_BY_GH_TYPE } = require('../../../lib/irrigation/parcelleMeta');
      const byDeviceId = Object.fromEntries(
        devices.map(d => [String(d.deviceId || d.id || ''), d])
      );
      console.log('farmroadRefresh: devices found =', Object.keys(byDeviceId), 'expected =', JSON.stringify(FARMROAD_DEVICE_BY_GH_TYPE));

      // Helper: extract device actuals (daily + hourly)
      const extractActual = (d) => {
        const m = d.measurements || {};
        const ts = d.timeseries || {};
        const daily = {
          tMax: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.max : null,
          tMin: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.min : null,
          tAvg: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.avg : null,
          hr: m.RH_INSIDE ? m.RH_INSIDE.avg : null,
          co2: m.CO2_LEVEL ? m.CO2_LEVEL.avg : null,
          vpd: m.ESTIMATED_VPD_INSIDE ? m.ESTIMATED_VPD_INSIDE.avg : null,
          substrat: m.SUBSTRATE_MOISTURE_CONTENT ? m.SUBSTRATE_MOISTURE_CONTENT.avg : null,
          par: m.PAR_INTENSITY ? m.PAR_INTENSITY.avg : null,
          radiation: m.RADIATION_INTENSITY_INSIDE ? m.RADIATION_INTENSITY_INSIDE.avg : null,
          dewpoint: m.DEWPOINT_INSIDE ? m.DEWPOINT_INSIDE.avg : null,
          pressure: m.BAROMETRIC_PRESSURE_INSIDE ? m.BAROMETRIC_PRESSURE_INSIDE.avg : null,
        };
        // Aggregate 15-min timeseries → hourly
        const hourly = [];
        const hourBuckets = {};
        const params = ['TEMPERATURE_INSIDE', 'RH_INSIDE', 'CO2_LEVEL', 'PAR_INTENSITY', 'RADIATION_INTENSITY_INSIDE', 'ESTIMATED_VPD_INSIDE', 'DEWPOINT_INSIDE', 'SUBSTRATE_MOISTURE_CONTENT', 'BAROMETRIC_PRESSURE_INSIDE'];
        for (const p of params) {
          if (!ts[p]) continue;
          for (const slot of ts[p]) {
            const hh = slot.hour ? slot.hour.slice(0, 2) : null;
            if (hh == null) continue;
            if (!hourBuckets[hh]) hourBuckets[hh] = {};
            if (!hourBuckets[hh][p]) hourBuckets[hh][p] = [];
            hourBuckets[hh][p].push(slot.avg);
          }
        }
        const paramMap = { TEMPERATURE_INSIDE: 'temp', RH_INSIDE: 'hr', CO2_LEVEL: 'co2', PAR_INTENSITY: 'par', RADIATION_INTENSITY_INSIDE: 'radiation', ESTIMATED_VPD_INSIDE: 'vpd', DEWPOINT_INSIDE: 'dewpoint', SUBSTRATE_MOISTURE_CONTENT: 'substrate', BAROMETRIC_PRESSURE_INSIDE: 'pressure' };
        for (const hh of Object.keys(hourBuckets).sort()) {
          const entry = { hour: hh + ':00' };
          for (const [frKey, outKey] of Object.entries(paramMap)) {
            const vals = hourBuckets[hh][frKey];
            if (vals && vals.length > 0) entry[outKey] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100) / 100;
          }
          hourly.push(entry);
        }
        return { ...daily, hourly };
      };

      const actualByType = {};
      for (const [ghType, deviceId] of Object.entries(FARMROAD_DEVICE_BY_GH_TYPE)) {
        const d = byDeviceId[String(deviceId)];
        if (d) actualByType[ghType] = extractActual(d);
      }

      // Store FarmRoad actual in history
      await db_firestore.collection("farmroad_history").doc(todayStr).set({
        date: todayStr,
        canarienne: actualByType.canarienne || null,
        tunnel: actualByType.tunnel || null,
        _cachedAt: Date.now()
      });

      // 4) Load current model coefficients
      const modelDoc = await db_firestore.collection("forecast_model").doc("current").get();
      let model = modelDoc.exists ? modelDoc.data() : { canarienne: { ...DEFAULT_MODEL.canarienne }, tunnel: { ...DEFAULT_MODEL.tunnel }, version: 0 };

      // 5) Calibrate: compare yesterday's prediction (if exists) with today's actuals
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const yesterdayForecastDoc = await db_firestore.collection("indoor_forecasts").doc(yesterdayStr).get();
      const yesterdayActualDoc = await db_firestore.collection("farmroad_history").doc(yesterdayStr).get();

      let accuracyData = {};
      if (yesterdayForecastDoc.exists && yesterdayActualDoc.exists) {
        const yForecast = yesterdayForecastDoc.data();
        const yActual = yesterdayActualDoc.data();

        // Find yesterday's J+1 prediction (which was for today — but we check yesterday's own prediction)
        // Actually we want to compare: the prediction that was made FOR yesterday with yesterday's actual
        for (const type of ["canarienne", "tunnel"]) {
          if (yForecast[type] && yActual[type]) {
            // Find the prediction entry for yesterday's date
            const predForYesterday = (yForecast[type] || []).find(p => p.date === yesterdayStr);
            if (predForYesterday && yActual[type]) {
              const acc = computeAccuracy(predForYesterday, yActual[type]);
              accuracyData[type] = acc;

              // Update model with learned corrections
              const predWithOutdoor = { ...predForYesterday };
              // Find outdoor data for yesterday
              const yMeteo = await db_firestore.collection("meteo_history").doc(yesterdayStr).get();
              if (yMeteo.exists) {
                const yFc = (yMeteo.data().forecast || []).find(f => f.date === yesterdayStr);
                if (yFc) {
                  predWithOutdoor._outdoorTmax = yFc.tmax;
                  predWithOutdoor._outdoorTmin = yFc.tmin;
                  predWithOutdoor._outdoorHr = yFc.humidity;
                  predWithOutdoor._outdoorRadiation = yFc.radiation;
                  // Compute avg outdoor pressure from hourly data
                  const yHourly = yMeteo.data().hourlyForecast || [];
                  const yDayHours = yHourly.filter(h => h.date === yesterdayStr && h.sealevelpressure != null);
                  if (yDayHours.length > 0) {
                    predWithOutdoor._outdoorPressure = Math.round(yDayHours.reduce((s, h) => s + h.sealevelpressure, 0) / yDayHours.length * 10) / 10;
                  }
                }
              }
              model[type] = updateModelCoeffs(model[type], predWithOutdoor, yActual[type], 0.15);
            }
          }
        }
      }

      // Save accuracy
      if (Object.keys(accuracyData).length > 0) {
        await db_firestore.collection("forecast_accuracy").doc(yesterdayStr).set({
          date: yesterdayStr,
          ...accuracyData,
          _cachedAt: Date.now()
        });
      }

      // 6) Generate indoor forecasts for J+1 to J+5
      const todayOutdoor = forecastDays.find(f => f.date === todayStr);
      const futureDays = forecastDays.filter(f => f.date > todayStr).slice(0, 5);

      const predictions = { canarienne: [], tunnel: [] };

      // Also predict for today (for display)
      const allDaysToPredict = todayOutdoor ? [todayOutdoor, ...futureDays] : futureDays;

      for (const day of allDaysToPredict) {
        for (const type of ["canarienne", "tunnel"]) {
          const pred = predictIndoor(day, model[type]);
          // Generate hourly predictions for this day
          const dayHourly = (hourlyByDate[day.date] || []).map(h => predictIndoorHourly(h, model[type]));
          predictions[type].push({
            date: day.date,
            ...pred,
            hourly: dayHourly,
            outdoor: { tmax: day.tmax, tmin: day.tmin, humidity: day.humidity, eto: day.eto, precip: day.precip, radiation: day.radiation }
          });
        }
      }

      // 7) Save indoor forecast
      await db_firestore.collection("indoor_forecasts").doc(todayStr).set({
        date: todayStr,
        canarienne: predictions.canarienne,
        tunnel: predictions.tunnel,
        model: { canarienne: model.canarienne, tunnel: model.tunnel },
        _cachedAt: Date.now()
      });

      // 8) Save updated model
      model.version = (model.version || 0) + 1;
      model.lastUpdated = todayStr;
      await db_firestore.collection("forecast_model").doc("current").set(model);

      console.log("[IndoorForecast] Done. Model v" + model.version + ". Predictions for " + predictions.canarienne.length + " days.");
    } catch (err) {
      console.error("[IndoorForecast] Error:", err);
    }
    return null;
  });

// HTTP endpoint for indoor forecast
exports.indoorForecast = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const wantHourly = req.query.hourly === 'true';
      console.log("[IndoorForecast] API call — todayStr=" + todayStr + " wantHourly=" + wantHourly);

      // Get latest forecast
      const forecastDoc = await db_firestore.collection("indoor_forecasts").doc(todayStr).get();
      let forecast = forecastDoc.exists ? forecastDoc.data() : null;
      console.log("[IndoorForecast] Doc exists=" + forecastDoc.exists + (forecast ? " canarienne.length=" + (forecast.canarienne || []).length + " firstHourly=" + ((forecast.canarienne && forecast.canarienne[0] && forecast.canarienne[0].hourly) ? forecast.canarienne[0].hourly.length : "none") : ""));

      // Check if hourly data is missing but requested — need to regenerate
      const needsHourly = wantHourly && forecast && Array.isArray(forecast.canarienne) && forecast.canarienne.length > 0 && !forecast.canarienne[0].hourly;
      if (needsHourly) { console.log("[IndoorForecast] needsHourly=true, forcing regeneration"); forecast = null; }

      // If no forecast for today, generate on-the-fly
      if (!forecast) {
        console.log("[IndoorForecast] Generating on-the-fly...");
        const meteoRaw = await fetchMeteoblueForecast();
        console.log("[IndoorForecast] MeteoBlue: data_day=" + !!(meteoRaw && meteoRaw.data_day) + " data_1h_times=" + ((meteoRaw && meteoRaw.data_1h && meteoRaw.data_1h.time) ? meteoRaw.data_1h.time.length : 0));
        if (meteoRaw && meteoRaw.data_day) {
          const dayData = meteoRaw.data_day;
          const forecastDays = (dayData.time || []).map((dateStr, i) => ({
            date: dateStr,
            tmax: dayData.temperature_max ? dayData.temperature_max[i] : null,
            tmin: dayData.temperature_min ? dayData.temperature_min[i] : null,
            humidity: dayData.relativehumidity_mean ? dayData.relativehumidity_mean[i] : null,
            eto: dayData.evapotranspiration ? dayData.evapotranspiration[i] : null,
            precip: dayData.precipitation ? dayData.precipitation[i] : null,
            radiation: dayData.shortwave_radiation_sum ? dayData.shortwave_radiation_sum[i] : null,
          }));
          // Parse hourly for on-the-fly
          const hRaw = meteoRaw.data_1h || {};
          const hTimes = hRaw.time || [];
          const hData = hTimes.map((t, i) => ({
            time: t, date: t ? t.slice(0, 10) : null,
            temperature: hRaw.temperature ? hRaw.temperature[i] : null,
            relativehumidity: hRaw.relativehumidity ? hRaw.relativehumidity[i] : null,
            shortwave_radiation: hRaw.shortwave_radiation ? hRaw.shortwave_radiation[i] : null,
            sealevelpressure: hRaw.sealevelpressure ? hRaw.sealevelpressure[i] : null,
          }));
          const hByDate = {};
          for (const h of hData) { if (h.date) { if (!hByDate[h.date]) hByDate[h.date] = []; hByDate[h.date].push(h); } }

          const modelDoc = await db_firestore.collection("forecast_model").doc("current").get();
          const model = modelDoc.exists ? modelDoc.data() : DEFAULT_MODEL;

          const predictions = { canarienne: [], tunnel: [] };
          for (const day of forecastDays) {
            for (const type of ["canarienne", "tunnel"]) {
              const pred = predictIndoor(day, model[type] || DEFAULT_MODEL[type]);
              const dayHourly = (hByDate[day.date] || []).map(h => predictIndoorHourly(h, model[type] || DEFAULT_MODEL[type]));
              predictions[type].push({
                date: day.date, ...pred, hourly: dayHourly,
                outdoor: { tmax: day.tmax, tmin: day.tmin, humidity: day.humidity, eto: day.eto, precip: day.precip, radiation: day.radiation }
              });
            }
          }
          forecast = { date: todayStr, canarienne: predictions.canarienne, tunnel: predictions.tunnel, model: { canarienne: model.canarienne || DEFAULT_MODEL.canarienne, tunnel: model.tunnel || DEFAULT_MODEL.tunnel }, _cachedAt: Date.now(), live: true };
          console.log("[IndoorForecast] Generated: canarienne=" + predictions.canarienne.length + " dates=" + predictions.canarienne.map(p => p.date).join(",") + " hourly[0]=" + (predictions.canarienne[0] && predictions.canarienne[0].hourly ? predictions.canarienne[0].hourly.length : 0));
        } else {
          console.log("[IndoorForecast] MeteoBlue failed or no data_day");
        }
      }

      // Get accuracy history (last 14 days)
      const accSnap = await db_firestore.collection("forecast_accuracy").orderBy("date", "desc").limit(14).get();
      const accuracyHistory = [];
      accSnap.forEach(doc => accuracyHistory.push(doc.data()));

      // Get today's actual FarmRoad for comparison (extended params + optional hourly)
      const farmroadData = await refreshFarmroadCache(todayStr, null);
      const devices = (farmroadData && farmroadData.devices) || [];
      const { FARMROAD_DEVICE_BY_GH_TYPE: FR_MAP_API } = require('../../../lib/irrigation/parcelleMeta');
      const byDeviceIdAPI = Object.fromEntries(
        devices.map(d => [String(d.deviceId || d.id || ''), d])
      );

      const extractActualAPI = (d) => {
        const m = d.measurements || {};
        const ts = d.timeseries || {};
        const daily = {
          tMax: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.max : null,
          tMin: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.min : null,
          hr: m.RH_INSIDE ? m.RH_INSIDE.avg : null,
          co2: m.CO2_LEVEL ? m.CO2_LEVEL.avg : null,
          vpd: m.ESTIMATED_VPD_INSIDE ? m.ESTIMATED_VPD_INSIDE.avg : null,
          par: m.PAR_INTENSITY ? m.PAR_INTENSITY.avg : null,
          radiation: m.RADIATION_INTENSITY_INSIDE ? m.RADIATION_INTENSITY_INSIDE.avg : null,
          dewpoint: m.DEWPOINT_INSIDE ? m.DEWPOINT_INSIDE.avg : null,
          substrate: m.SUBSTRATE_MOISTURE_CONTENT ? m.SUBSTRATE_MOISTURE_CONTENT.avg : null,
          pressure: m.BAROMETRIC_PRESSURE_INSIDE ? m.BAROMETRIC_PRESSURE_INSIDE.avg : null,
        };
        if (!wantHourly) return daily;
        const hourBuckets = {};
        const params = ['TEMPERATURE_INSIDE', 'RH_INSIDE', 'CO2_LEVEL', 'PAR_INTENSITY', 'RADIATION_INTENSITY_INSIDE', 'ESTIMATED_VPD_INSIDE', 'DEWPOINT_INSIDE', 'SUBSTRATE_MOISTURE_CONTENT', 'BAROMETRIC_PRESSURE_INSIDE'];
        const paramMap = { TEMPERATURE_INSIDE: 'temp', RH_INSIDE: 'hr', CO2_LEVEL: 'co2', PAR_INTENSITY: 'par', RADIATION_INTENSITY_INSIDE: 'radiation', ESTIMATED_VPD_INSIDE: 'vpd', DEWPOINT_INSIDE: 'dewpoint', SUBSTRATE_MOISTURE_CONTENT: 'substrate', BAROMETRIC_PRESSURE_INSIDE: 'pressure' };
        for (const p of params) {
          if (!ts[p]) continue;
          for (const slot of ts[p]) {
            const hh = slot.hour ? slot.hour.slice(0, 2) : null;
            if (hh == null) continue;
            if (!hourBuckets[hh]) hourBuckets[hh] = {};
            if (!hourBuckets[hh][p]) hourBuckets[hh][p] = [];
            hourBuckets[hh][p].push(slot.avg);
          }
        }
        const hourly = [];
        for (const hh of Object.keys(hourBuckets).sort()) {
          const entry = { hour: hh + ':00' };
          for (const [frKey, outKey] of Object.entries(paramMap)) {
            const vals = hourBuckets[hh][frKey];
            if (vals && vals.length > 0) entry[outKey] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100) / 100;
          }
          hourly.push(entry);
        }
        return { ...daily, hourly };
      };

      const todayActual = {};
      for (const [ghType, deviceId] of Object.entries(FR_MAP_API)) {
        const d = byDeviceIdAPI[String(deviceId)];
        if (d) todayActual[ghType] = extractActualAPI(d);
      }

      // Strip hourly from forecast if not requested (backward compat)
      let forecastOut = forecast;
      if (!wantHourly && forecast) {
        forecastOut = { ...forecast };
        for (const type of ["canarienne", "tunnel"]) {
          if (Array.isArray(forecastOut[type])) {
            forecastOut[type] = forecastOut[type].map(p => { const { hourly, ...rest } = p; return rest; });
          }
        }
      }

      // Compute global MAPE from history
      let globalMape = null;
      const mapes = accuracyHistory.map(a => {
        const cm = a.canarienne ? a.canarienne.mape : null;
        const tm = a.tunnel ? a.tunnel.mape : null;
        return [cm, tm].filter(v => v != null);
      }).flat();
      if (mapes.length > 0) {
        globalMape = Math.round(mapes.reduce((s, v) => s + v, 0) / mapes.length * 10) / 10;
      }

      res.json({
        success: true,
        forecast: forecastOut,
        todayActual: todayActual,
        accuracyHistory: accuracyHistory,
        globalMape: globalMape,
        modelVersion: forecast ? (forecast.model ? forecast.model.version : 0) : 0
      });
    } catch (err) {
      console.error("[IndoorForecast] API error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// GDD & IMC — Indice de Maturation Composite
// Maravilla Long Cane | Larache | J0 = 29 mars 2026
// =============================================

function computeWeatherFactor(serreData, gddRef) {
  if (!serreData) return { GDD: 0, facteur_HR: 1, facteur_PAR: 1, gddRatio: 1, weatherFactor: 1, rawFactor: 1 };
  const T_avg = (serreData.T_max_serre + serreData.T_min_serre) / 2;
  const GDD = Math.max(0, T_avg - 7);

  // Facteur humidité — attenuated (±5% max)
  const hr = serreData.HR_moyenne || 80;
  let facteur_HR = 1.0;
  if (hr < 75) facteur_HR = 1.03;
  else if (hr <= 85) facteur_HR = 1.00;
  else if (hr <= 92) facteur_HR = 0.97;
  else facteur_HR = 0.93;

  // Facteur PAR — attenuated (±5% max)
  const par = serreData.PAR_sum || 10;
  let facteur_PAR = 1.0;
  if (par > 15) facteur_PAR = 1.05;
  else if (par >= 8) facteur_PAR = 1.00;
  else facteur_PAR = 0.95;

  // GDD ratio — damped toward 1.0 (50% dampening)
  const rawGddRatio = gddRef > 0 ? GDD / gddRef : 1;
  const gddRatio = 1 + (rawGddRatio - 1) * 0.5; // dampened

  const rawFactor = gddRatio * facteur_HR * facteur_PAR;
  // Clamp total weather factor to [0.85, 1.15]
  const weatherFactor = Math.max(0.85, Math.min(1.15, rawFactor));

  return {
    GDD: Math.round(GDD * 100) / 100,
    facteur_HR, facteur_PAR,
    gddRatio: Math.round(gddRatio * 100) / 100,
    rawFactor: Math.round(rawFactor * 1000) / 1000,
    weatherFactor: Math.round(weatherFactor * 1000) / 1000,
  };
}

// Legacy alias for backward compat with explanation builder
function computeMaturationCoeff(serreData, gddRef) {
  const wf = computeWeatherFactor(serreData, gddRef);
  return { GDD: wf.GDD, facteur_HR: wf.facteur_HR, facteur_PAR: wf.facteur_PAR, gddRatio: wf.gddRatio, rawCoeff: wf.rawFactor, coeff: wf.weatherFactor };
}

// Auto-calibration: EMA of prediction error ratio, clamped to [-0.3, +0.3]
// Compares past predictions stored in Firestore to actual SQL harvest
async function computeCalibrationOffset(harvestActuals, todayStr, todayIsComplete) {
  let calibrationOffset = 0;
  try {
    const predsSnap = await db_firestore.collection("farms").doc("larache").collection("harvest_predictions")
      .orderBy("date", "desc").limit(10).get();
    let emaOffset = 0;
    const alpha = 0.3;
    let count = 0;
    for (const doc of predsSnap.docs) {
      const pred = doc.data();
      const d = pred.date;
      // Only calibrate on complete days
      if (d >= todayStr && !(d === todayStr && todayIsComplete)) continue;
      const actual = harvestActuals[d];
      if (actual && pred.predicted_kg && actual.total > 0 && pred.predicted_kg > 0) {
        const errorRatio = (actual.total - pred.predicted_kg) / actual.total;
        emaOffset = alpha * errorRatio + (1 - alpha) * emaOffset;
        count++;
      }
    }
    if (count > 0) calibrationOffset = Math.max(-0.3, Math.min(0.3, emaOffset));
  } catch (e) { /* use 0 */ }
  return calibrationOffset;
}

// Helper: Generate alerts from serre data and weather forecast
function generateAlerts(serreData, weatherForecast) {
  const alerts = [];
  if (!serreData) return alerts;

  // Alert 1: Botrytis — HR > 90% pendant 3h consécutives
  const hourlyHR = serreData.hourlyHR || {};
  const hours = Object.keys(hourlyHR).map(Number).sort((a, b) => a - b);
  let consecutiveHigh = 0;
  for (const h of hours) {
    const hrArr = hourlyHR[h];
    if (!Array.isArray(hrArr) || hrArr.length === 0) continue;
    const avgHR = hrArr.reduce((s, v) => s + v, 0) / hrArr.length;
    if (avgHR > 90) {
      consecutiveHigh++;
      if (consecutiveHigh >= 3) {
        alerts.push({ type: "botrytis", severity: "warning", icon: "fa-droplet", message: "Risque botrytis — HR serre > 90% pendant 3h+ — aérer tunnels" });
        break;
      }
    } else {
      consecutiveHigh = 0;
    }
  }

  // Alert 2: Coup de chaleur — T° serre > 28°C en journée
  if (serreData.T_max_serre > 28) {
    alerts.push({ type: "chaleur", severity: "danger", icon: "fa-temperature-high", message: "Coup de chaleur — T° serre " + serreData.T_max_serre + "°C — récolter tôt demain" });
  }

  // Alert 3: Pluie J+1 > 10mm
  if (weatherForecast && weatherForecast.daily) {
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const idx = (weatherForecast.daily.time || []).indexOf(tomorrowStr);
    if (idx >= 0 && weatherForecast.daily.precipitation_sum[idx] > 10) {
      alerts.push({ type: "pluie", severity: "warning", icon: "fa-cloud-rain", message: "Pluie prévue J+1 (" + weatherForecast.daily.precipitation_sum[idx] + "mm) — anticiper récolte cet après-midi" });
    }
  }

  return alerts;
}

// =============================================
// API: Harvest Weather — Open-Meteo Laouamra
// =============================================
exports.harvestWeather = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const data = await withCache("harvest_weather_laouamra", 3 * 3600 * 1000, async () => {
        const meteo = await getMeteoLaouamra();
        if (!meteo || !meteo.daily) throw new Error("Open-Meteo indisponible");
        // Also store in farms/larache/weather_forecast
        db_firestore.collection("farms").doc("larache").collection("weather_forecast").doc("current").set({
          ...meteo.daily,
          _cachedAt: Date.now(),
        }).catch(() => {});
        return meteo;
      });
      res.json({ success: true, ...data });
    } catch (err) {
      console.error("Erreur harvestWeather:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Harvest Prediction — Main endpoint
// =============================================
exports.harvestPrediction = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const todayStr = new Date().toISOString().slice(0, 10);

      // 1) Fetch harvest from BR_Cueillette (Firestore mirror or SQL fallback)
      const varietyFilter = req.query.variete || null;
      const HISTORY_DAYS = 14;
      const harvestActuals = {};
      const allVarieties = new Set();
      try {
        const startDate = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
        let cueilletteData;
        if (USE_MIRROR) {
          cueilletteData = await getCueilletteRows(startDate, todayStr);
          cueilletteData = cueilletteData
            .filter(r => r.Operation_Famille === "8. Récolte")
            .filter(r => !varietyFilter || (r.Variete || "").includes(varietyFilter))
            .map(r => ({ dateStr: r.DateStr, Variete: r.Variete, totalKg: r.Poids_total_kg || 0 }));
        } else {
          const pool = await __core.sql.connect(sqlConfig);
          const varietyClause = varietyFilter ? ` AND Variete LIKE N'%${varietyFilter.replace(/'/g, "''")}%'` : "";
          const result = await pool.request().query(`
            SELECT CONVERT(varchar(10), Periode_Date, 23) AS dateStr, Variete,
                   SUM(Poids_total_kg) AS totalKg, SUM(Nbre_Caisse) AS totalCaisses
            FROM BR_Cueillette
            WHERE CONVERT(date, Periode_Date) >= '${startDate}' AND Operation_Famille = N'8. Récolte'${varietyClause}
            GROUP BY CONVERT(varchar(10), Periode_Date, 23), Variete
            ORDER BY dateStr DESC, totalKg DESC`);
          cueilletteData = (result.recordset || []).map(r => ({ dateStr: r.dateStr, Variete: r.Variete, totalKg: r.totalKg || 0 }));
        }
        for (const r of cueilletteData) {
          const ds = r.dateStr;
          const vName = (r.Variete || "Autre").trim();
          if (!harvestActuals[ds]) harvestActuals[ds] = { total: 0, byVariety: {} };
          const kg = Math.round((r.totalKg || 0) * 10) / 10;
          harvestActuals[ds].total += kg;
          harvestActuals[ds].byVariety[vName] = (harvestActuals[ds].byVariety[vName] || 0) + kg;
          if (kg > 0) allVarieties.add(vName);
        }
      } catch (sqlErr) {
        console.error("Harvest data error:", sqlErr.message);
      }

      // 2) Aggregate serre data for last 10 days + today (enough for GDD ref + recent training)
      const serreDataByDate = {};
      const serrePromises = [];
      for (let i = 0; i < 11; i++) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toISOString().slice(0, 10);
        serrePromises.push(aggregateSerreData(dateStr).then(data => { if (data) serreDataByDate[dateStr] = data; }));
      }
      await Promise.all(serrePromises);

      // 3) Compute GDD reference (7-day moving average)
      const gddValues = [];
      for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toISOString().slice(0, 10);
        const sd = serreDataByDate[dateStr];
        if (sd) {
          const gdd = Math.max(0, ((sd.T_max_serre + sd.T_min_serre) / 2) - 7);
          gddValues.push(gdd);
        }
      }
      const gddRef = gddValues.length > 0 ? gddValues.reduce((s, v) => s + v, 0) / gddValues.length : 8.0;

      // 4) Weather forecast + calibration offset (EMA)
      const nowHour = new Date().getHours();
      const todayIsComplete = nowHour >= 20;
      const weatherForecast = await getMeteoLaouamra();
      const calibrationOffset = await computeCalibrationOffset(harvestActuals, todayStr, todayIsComplete);

      // 5) Compute coefficients (simple discrete model + calibration)
      const todaySerre = serreDataByDate[todayStr];
      const coeffToday = computeMaturationCoeff(todaySerre, gddRef);
      // Apply calibration: adjusted coeff = raw × (1 + offset)
      coeffToday.coeff = Math.round(coeffToday.rawCoeff * (1 + calibrationOffset) * 1000) / 1000;

      // For J+1, J+2, J+3: use Open-Meteo forecast + delta +4°C for serre simulation
      const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const dayAfterStr = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      const j3Str = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      let coeffTomorrow = { GDD: 0, facteur_HR: 1, facteur_PAR: 1, coeff: 1, rawCoeff: 1 };
      let coeffDayAfter = { GDD: 0, facteur_HR: 1, facteur_PAR: 1, coeff: 1, rawCoeff: 1 };
      let coeffJ3 = { GDD: 0, facteur_HR: 1, facteur_PAR: 1, coeff: 1, rawCoeff: 1 };

      // Helper to build serre estimate from Open-Meteo forecast index
      function serreFromForecast(wf, idx) {
        return {
          T_max_serre: wf.temperature_2m_max[idx] + 4,
          T_min_serre: wf.temperature_2m_min[idx] + 4,
          HR_moyenne: wf.relative_humidity_2m_max[idx] || 80,
          PAR_sum: wf.sunshine_duration[idx] ? Math.round((wf.sunshine_duration[idx] / 3600) * 1.2 * 100) / 100 : 10,
        };
      }

      if (weatherForecast && weatherForecast.daily) {
        const wf = weatherForecast.daily;
        const applyCalib = (c) => { c.coeff = Math.round(c.rawCoeff * (1 + calibrationOffset) * 1000) / 1000; return c; };

        const idxTom = (wf.time || []).indexOf(tomorrowStr);
        if (idxTom >= 0) coeffTomorrow = applyCalib(computeMaturationCoeff(serreFromForecast(wf, idxTom), gddRef));

        const idxDA = (wf.time || []).indexOf(dayAfterStr);
        if (idxDA >= 0) coeffDayAfter = applyCalib(computeMaturationCoeff(serreFromForecast(wf, idxDA), gddRef));

        const idxJ3 = (wf.time || []).indexOf(j3Str);
        if (idxJ3 >= 0) coeffJ3 = applyCalib(computeMaturationCoeff(serreFromForecast(wf, idxJ3), gddRef));
      }

      // 6) Find most recent COMPLETE actual harvest
      // Today's data is partial (expeditions arrive throughout the day) — only final after 20h
      const completeDates = Object.keys(harvestActuals)
        .filter(d => d < todayStr || (d === todayStr && todayIsComplete))
        .sort().reverse();
      const lastActualDate = completeDates[0] || null;
      const lastActualKg = lastActualDate ? harvestActuals[lastActualDate].total : null;
      // Also expose today's partial data separately for display
      const todayPartial = (!todayIsComplete && harvestActuals[todayStr]) ? harvestActuals[todayStr] : null;

      // 7) NEW MODEL — Moving average base + day-of-week pattern + attenuated weather
      // Step A: Compute 5-day moving average as stable baseline
      const recentComplete = completeDates.slice(0, 7).map(d => ({ date: d, kg: harvestActuals[d].total, dow: new Date(d + "T12:00:00Z").getDay() }));
      const ma5Values = recentComplete.slice(0, 5).map(r => r.kg);
      const ma5 = ma5Values.length > 0 ? ma5Values.reduce((s, v) => s + v, 0) / ma5Values.length : null;

      // Step B: Day-of-week factor — detect if certain days consistently differ
      // Group all actuals by day-of-week, compute ratio to overall mean
      const dowTotals = {}; // { 0: [kg, kg], 1: [...], ... }
      const allCompleteKgs = [];
      for (const d of completeDates.slice(0, 14)) {
        const kg = harvestActuals[d].total;
        const dow = new Date(d + "T12:00:00Z").getDay();
        if (!dowTotals[dow]) dowTotals[dow] = [];
        dowTotals[dow].push(kg);
        allCompleteKgs.push(kg);
      }
      const overallMean = allCompleteKgs.length > 0 ? allCompleteKgs.reduce((s, v) => s + v, 0) / allCompleteKgs.length : 1;
      // Compute day-of-week factor, dampened and clamped to [0.85, 1.15]
      function getDowFactor(targetDate) {
        const dow = new Date(targetDate + "T12:00:00Z").getDay();
        if (!dowTotals[dow] || dowTotals[dow].length < 2 || overallMean <= 0) return 1.0;
        const dowMean = dowTotals[dow].reduce((s, v) => s + v, 0) / dowTotals[dow].length;
        const rawRatio = dowMean / overallMean;
        // Dampen: move only 50% toward observed ratio
        return Math.max(0.85, Math.min(1.15, 1 + (rawRatio - 1) * 0.5));
      }

      // Step C: Per-variety predictions — MA5 per variety × dowFactor × weatherFactor
      // Build per-variety history: { "MARAVILLA GC": { "2026-03-23": 500, ... }, ... }
      const varietyHistory = {};
      for (const d of completeDates) {
        const bv = harvestActuals[d].byVariety || {};
        for (const [v, kg] of Object.entries(bv)) {
          if (!varietyHistory[v]) varietyHistory[v] = {};
          varietyHistory[v][d] = kg;
        }
      }

      // Compute MA5 per variety
      function getVarietyMA5(variety) {
        const vh = varietyHistory[variety];
        if (!vh) return 0;
        const dates = Object.keys(vh).sort().reverse().slice(0, 5);
        if (dates.length === 0) return 0;
        return dates.reduce((s, d) => s + vh[d], 0) / dates.length;
      }

      // Predict per variety for a given date and weather coeff
      function predictByVariety(targetDate, weatherCoeff) {
        const byVariety = {};
        let total = 0;
        for (const v of allVarieties) {
          const vma5 = getVarietyMA5(v);
          if (vma5 <= 0) continue;
          const pred = Math.round(vma5 * getDowFactor(targetDate) * weatherCoeff);
          byVariety[v] = pred;
          total += pred;
        }
        return { total, byVariety };
      }

      let predTodayKg = null, predTomorrowKg = null, predJ2Kg = null, predJ3Kg = null;
      let predTodayByVar = {}, predTomorrowByVar = {}, predJ2ByVar = {}, predJ3ByVar = {};

      if (ma5) {
        if (todayIsComplete && harvestActuals[todayStr]) {
          predTodayKg = harvestActuals[todayStr].total;
          predTodayByVar = harvestActuals[todayStr].byVariety || {};
        } else {
          const p = predictByVariety(todayStr, coeffToday.coeff);
          predTodayKg = p.total; predTodayByVar = p.byVariety;
        }
        const pTom = predictByVariety(tomorrowStr, coeffTomorrow.coeff);
        predTomorrowKg = pTom.total; predTomorrowByVar = pTom.byVariety;
        const pJ2 = predictByVariety(dayAfterStr, coeffDayAfter.coeff);
        predJ2Kg = pJ2.total; predJ2ByVar = pJ2.byVariety;
        const pJ3 = predictByVariety(j3Str, coeffJ3.coeff);
        predJ3Kg = pJ3.total; predJ3ByVar = pJ3.byVariety;
      }

      // 8) Retroactive predictions: MA5 base × dowFactor × weatherFactor (same logic as live)
      const retroPredictions = {};
      const sortedActualDates = Object.keys(harvestActuals)
        .filter(d => d < todayStr || (d === todayStr && todayIsComplete))
        .sort();
      for (let i = 0; i < sortedActualDates.length; i++) {
        const currDate = sortedActualDates[i];
        // Compute MA5 from the 5 complete days before currDate
        const priorDates = sortedActualDates.filter(d => d < currDate).slice(-5);
        if (priorDates.length < 2) continue; // need at least 2 days of history
        const retroMA5 = priorDates.reduce((s, d) => s + harvestActuals[d].total, 0) / priorDates.length;
        const sd = serreDataByDate[currDate];
        const retroWeather = sd ? computeWeatherFactor(sd, gddRef) : { weatherFactor: 1 };
        const retroDow = getDowFactor(currDate);
        retroPredictions[currDate] = Math.round(retroMA5 * retroDow * retroWeather.weatherFactor);
      }

      // 9) Alerts
      const alerts = generateAlerts(todaySerre, weatherForecast);

      // 10) Confidence score based on MAPE of retro-predictions (real accuracy measure)
      let mapeSum = 0, mapeCount = 0;
      for (const d of sortedActualDates) {
        if (retroPredictions[d] && harvestActuals[d]) {
          const actual = harvestActuals[d].total;
          const pred = retroPredictions[d];
          if (actual > 0) { mapeSum += Math.abs(pred - actual) / actual; mapeCount++; }
        }
      }
      const mape = mapeCount > 0 ? mapeSum / mapeCount : 0.5;
      const daysSinceActual = lastActualDate ? Math.round((Date.now() - new Date(lastActualDate).getTime()) / 86400000) : 7;
      const confidence = Math.max(0.3, Math.min(0.95, 1.0 - mape - daysSinceActual * 0.02));

      // 10b) Build correlation table (last 14 days with data)
      const correlationTable = [];
      for (let i = 0; i < Math.min(14, sortedActualDates.length); i++) {
        const dateStr = sortedActualDates[sortedActualDates.length - 1 - i];
        const actual = harvestActuals[dateStr].total;
        const predicted = retroPredictions[dateStr] || null;
        const sd = serreDataByDate[dateStr];
        const errPct = (actual > 0 && predicted) ? Math.round(((predicted - actual) / actual) * 100) : null;
        correlationTable.push({
          date: dateStr,
          actual_kg: actual,
          predicted_kg: predicted,
          error_pct: errPct,
          T_min: sd ? sd.T_min_serre : null,
          T_max: sd ? sd.T_max_serre : null,
          HR: sd ? sd.HR_moyenne : null,
          PAR: sd ? sd.PAR_sum : null,
          GDD: sd ? Math.round(Math.max(0, ((sd.T_max_serre + sd.T_min_serre) / 2) - 7) * 100) / 100 : null,
        });
      }

      // 11) Build 7-day history with serre data
      const history = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toISOString().slice(0, 10);
        const dayLabel = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
        const isComplete = dateStr < todayStr || (dateStr === todayStr && todayIsComplete);
        const hasData = harvestActuals[dateStr];
        const sd = serreDataByDate[dateStr];
        history.push({
          date: dateStr,
          label: dayLabel,
          actual: (hasData && isComplete) ? hasData.total : null,
          actualByVariety: (hasData && isComplete) ? hasData.byVariety : null,
          partial: (hasData && !isComplete) ? hasData.total : null,
          partialByVariety: (hasData && !isComplete) ? hasData.byVariety : null,
          predicted: retroPredictions[dateStr] || (dateStr === todayStr ? predTodayKg : null),
          serre: sd ? {
            T_max: sd.T_max_serre, T_min: sd.T_min_serre,
            HR: sd.HR_moyenne, PAR: sd.PAR_sum,
            GDD: Math.round(Math.max(0, ((sd.T_max_serre + sd.T_min_serre) / 2) - 7) * 100) / 100,
          } : null,
        });
      }
      // Compute error % for history entries that have both actual and predicted
      for (const h of history) {
        if (h.actual && h.predicted) {
          h.error = Math.round(((h.predicted - h.actual) / h.actual) * 100);
        }
      }

      // 12) Weather summary for J+1 / J+2
      let weatherJ1 = null, weatherJ2 = null, weatherJ3 = null;
      if (weatherForecast && weatherForecast.daily) {
        const wf = weatherForecast.daily;
        const makeWeather = (dateStr) => { const idx = (wf.time || []).indexOf(dateStr); return idx >= 0 ? { date: dateStr, T_max: wf.temperature_2m_max[idx], T_min: wf.temperature_2m_min[idx], precipitation: wf.precipitation_sum[idx], humidity: wf.relative_humidity_2m_max[idx] } : null; };
        weatherJ1 = makeWeather(tomorrowStr);
        weatherJ2 = makeWeather(dayAfterStr);
        weatherJ3 = makeWeather(j3Str);
      }

      // 13) Current serre readings
      const serreCurrent = todaySerre ? {
        temperature: todaySerre.T_max_serre,
        humidity: todaySerre.HR_moyenne,
        PAR: todaySerre.PAR_sum,
        RAD: todaySerre.RAD_sum,
        source: todaySerre.source,
      } : null;

      // 14) Generate explanation text for today's and tomorrow's predictions
      function buildExplanation(coeff, _serreData, label, baseKg, predKg) {
        if (!coeff || !predKg || !baseKg) return null;
        const reasons = [];
        const direction = predKg > baseKg ? "supérieure" : predKg < baseKg ? "inférieure" : "stable par rapport";
        reasons.push("base = moyenne mobile 5 jours (" + Math.round(baseKg) + " kg)");

        // GDD effect
        if (coeff.gddRatio > 1.1) reasons.push("accumulation thermique élevée (GDD ratio " + coeff.gddRatio + "x) — les températures chaudes des jours précédents accélèrent la maturation");
        else if (coeff.gddRatio < 0.9) reasons.push("accumulation thermique faible (GDD ratio " + coeff.gddRatio + "x) — températures basses ralentissent la maturation");

        // HR effect
        if (coeff.facteur_HR < 1) {
          if (coeff.facteur_HR <= 0.93) reasons.push("humidité très élevée (>92%) — risque botrytis, léger ajustement (facteur " + coeff.facteur_HR + ")");
          else if (coeff.facteur_HR <= 0.97) reasons.push("humidité élevée (85-92%) — ajustement modéré (facteur " + coeff.facteur_HR + ")");
        } else if (coeff.facteur_HR > 1) {
          reasons.push("humidité optimale (<75%) — conditions favorables (facteur " + coeff.facteur_HR + ")");
        }

        // PAR effect
        if (coeff.facteur_PAR > 1.02) reasons.push("fort ensoleillement — maturation accélérée (facteur " + coeff.facteur_PAR + ")");
        else if (coeff.facteur_PAR < 0.98) reasons.push("faible ensoleillement — maturation ralentie (facteur " + coeff.facteur_PAR + ")");

        if (reasons.length <= 1) reasons.push("conditions climatiques proches de la moyenne des 7 derniers jours");

        const summary = "Production " + label + " estimée " + direction + " à la moyenne 5j (" + predKg + " kg vs " + Math.round(baseKg) + " kg) :";
        return { summary, reasons, coefficient: coeff.coeff };
      }

      const explanationToday = buildExplanation(coeffToday, todaySerre, "aujourd'hui", ma5, predTodayKg);
      const explanationTomorrow = buildExplanation(coeffTomorrow, null, "demain (J+1)", ma5, predTomorrowKg);
      const explanationJ2 = buildExplanation(coeffDayAfter, null, "J+2", ma5, predJ2Kg);
      const explanationJ3 = buildExplanation(coeffJ3, null, "J+3", ma5, predJ3Kg);

      // 15) Store today's prediction for future calibration
      const predDoc = {
        date: todayStr,
        predicted_kg: predTodayKg,
        actual_kg: harvestActuals[todayStr] ? harvestActuals[todayStr].total : null,
        coefficients: coeffToday,
        ma5: ma5 ? Math.round(ma5) : null,
        confidence: Math.round(confidence * 100) / 100,
        _cachedAt: Date.now(),
      };
      db_firestore.collection("farms").doc("larache").collection("harvest_predictions").doc(todayStr).set(predDoc).catch(() => {});

      res.json({
        success: true,
        varietyFilter: varietyFilter || "TOUTES",
        varieties: [...allVarieties],
        today: todayStr,
        todayIsComplete,
        lastActual: lastActualDate ? { date: lastActualDate, kg: lastActualKg, byVariety: harvestActuals[lastActualDate].byVariety } : null,
        todayPartial: todayPartial ? { kg: todayPartial.total, byVariety: todayPartial.byVariety } : null,
        prediction: {
          today: { date: todayStr, kg: predTodayKg, byVariety: predTodayByVar, coefficients: coeffToday, isActual: todayIsComplete && !!harvestActuals[todayStr], explanation: explanationToday },
          tomorrow: { date: tomorrowStr, kg: predTomorrowKg, byVariety: predTomorrowByVar, coefficients: coeffTomorrow, explanation: explanationTomorrow },
          j2: { date: dayAfterStr, kg: predJ2Kg, byVariety: predJ2ByVar, coefficients: coeffDayAfter, explanation: explanationJ2 },
          j3: { date: j3Str, kg: predJ3Kg, byVariety: predJ3ByVar, coefficients: coeffJ3, explanation: explanationJ3 },
        },
        history,
        alerts,
        confidence: Math.round(confidence * 100) / 100,
        mape: Math.round(mape * 1000) / 1000,
        gddRef: Math.round(gddRef * 100) / 100,
        calibrationOffset: Math.round(calibrationOffset * 1000) / 1000,
        ma5: ma5 ? Math.round(ma5) : null,
        correlationTable,
        serreCurrent,
        weatherJ1,
        weatherJ2,
        weatherJ3,
      });
    } catch (err) {
      console.error("Erreur harvestPrediction:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Upload Écarts Excel — parse and store in Firestore
// =============================================
exports.uploadEcarts = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });
    try {
      const XLSX = require("xlsx");
      // Parse base64 body (file sent as base64 from frontend)
      const base64Data = req.body.file;
      if (!base64Data) return res.status(400).json({ success: false, error: "No file data" });

      const buffer = Buffer.from(base64Data, "base64");
      const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      // Find header row (look for "Semaine" or "Date" column)
      let headerIdx = -1;
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        const r = rows[i];
        if (r && r.some(c => String(c || "").toLowerCase().includes("semaine"))) { headerIdx = i; break; }
      }
      if (headerIdx < 0) return res.status(400).json({ success: false, error: "Format Excel non reconnu — colonne 'Semaine' introuvable" });

      const headers = rows[headerIdx].map(h => String(h || "").trim());
      const dateCol = headers.findIndex(h => h.toLowerCase().includes("date"));
      const desCol = headers.findIndex(h => h.toLowerCase().includes("signation") || h.toLowerCase().includes("designation"));
      const qtyCol = headers.findIndex(h => h.toLowerCase().includes("quantit") || h.toLowerCase().includes("kg"));
      if (dateCol < 0 || qtyCol < 0) return res.status(400).json({ success: false, error: "Colonnes Date/Quantité introuvables" });

      // Aggregate by date and variety
      const byDate = {}; // { "2026-03-12": { total: 232, byVariety: { "MARAVILLA GG F1": 120, ... } } }
      let totalRows = 0;
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[dateCol] || !r[qtyCol]) continue;
        let dateVal = r[dateCol];
        let dateStr;
        if (dateVal instanceof Date) {
          dateStr = dateVal.toISOString().slice(0, 10);
        } else {
          dateStr = String(dateVal).slice(0, 10);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        const qty = parseFloat(r[qtyCol]) || 0;
        if (qty <= 0) continue;
        const designation = String(r[desCol] || "Autre").trim();

        // Determine variety from designation
        let variety = "Autre";
        const desUp = designation.toUpperCase();
        if (desUp.includes("MARAVILLA")) variety = "MARAVILLA";
        else if (desUp.includes("YAZMIN")) variety = "YAZMIN";
        else if (desUp.includes("REYNA")) variety = "REYNA";
        else if (desUp.includes("MYRTILLE") || desUp.includes("CORINA") || desUp.includes("BREEZE")) variety = "MYRTILLE";

        if (!byDate[dateStr]) byDate[dateStr] = { total: 0, byVariety: {} };
        byDate[dateStr].total += qty;
        byDate[dateStr].byVariety[variety] = (byDate[dateStr].byVariety[variety] || 0) + qty;
        totalRows++;
      }

      // Store in Firestore: farms/larache/ecarts_data/{date}
      const batch = db_firestore.batch();
      const ecartsColl = db_firestore.collection("farms").doc("larache").collection("ecarts_data");
      const dates = Object.keys(byDate);
      for (const d of dates) {
        const doc = ecartsColl.doc(d);
        batch.set(doc, {
          date: d,
          total: Math.round(byDate[d].total * 10) / 10,
          byVariety: Object.fromEntries(Object.entries(byDate[d].byVariety).map(([k, v]) => [k, Math.round(v * 10) / 10])),
          _uploadedAt: Date.now(),
        });
      }
      await batch.commit();

      res.json({
        success: true,
        message: `${totalRows} lignes importées, ${dates.length} jours, ${Math.round(Object.values(byDate).reduce((s, d) => s + d.total, 0))} kg total`,
        dateRange: { from: dates.sort()[0], to: dates.sort().reverse()[0] },
        totalDays: dates.length,
        totalKg: Math.round(Object.values(byDate).reduce((s, d) => s + d.total, 0) * 10) / 10,
      });
    } catch (err) {
      console.error("Erreur uploadEcarts:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// Email Analysis Functions (from emailService.js)
// =============================================

// =============================================
// Productivity Reports — scheduled IMAP scan (15 min)
// Picks up new Driscoll's "Grower productivity report" emails near-realtime.
// =============================================
exports.ecarts = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const action = req.query.action || req.body?.action || "list";

    try {
      // --- LIST PESAGES ---
      if (action === "list") {
        const limit = parseInt(req.query.limit || "200");
        const snap = await db_firestore
          .collection("ecarts_pesages")
          .orderBy("createdAt", "desc")
          .limit(limit)
          .get();
        const pesages = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, pesages });
      }

      // --- CREATE PESAGE ---
      if (action === "create" && req.method === "POST") {
        const { date, ferme, variete, culture, kgExport, kgLocal, defauts, operateur } = req.body;
        if (!ferme || !variete || kgExport === undefined || kgLocal === undefined) {
          return res.status(400).json({ success: false, error: "Champs requis: ferme, variete, kgExport, kgLocal" });
        }
        const docRef = await db_firestore.collection("ecarts_pesages").add({
          date: date || new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }),
          ferme,
          variete,
          culture: culture || "",
          kgExport: parseFloat(kgExport) || 0,
          kgLocal: parseFloat(kgLocal) || 0,
          defauts: defauts || {},
          operateur: operateur || "FatimZahra",
          photoId: null,
          createdAt: Date.now(),
        });
        return res.json({ success: true, id: docRef.id });
      }

      // --- UPDATE PESAGE ---
      if (action === "update" && req.method === "POST") {
        const { id, ...updates } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        await db_firestore.collection("ecarts_pesages").doc(id).update({
          ...updates,
          updatedAt: Date.now(),
        });
        return res.json({ success: true });
      }

      // --- DELETE PESAGE ---
      if (action === "delete" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        await db_firestore.collection("ecarts_pesages").doc(id).delete();
        return res.json({ success: true });
      }

      // --- GET CONFIG (defauts list) ---
      if (action === "config") {
        const snap = await db_firestore.collection("ecarts_config").doc("defauts").get();
        if (snap.exists) {
          return res.json({ success: true, config: snap.data() });
        }
        // Default config
        const defaultConfig = {
          defauts: ["Rouille", "Thrips", "Fruit cassé", "Surmaturité", "Fruit mou", "Botrytis", "Calibre insuffisant"],
        };
        await db_firestore.collection("ecarts_config").doc("defauts").set(defaultConfig);
        return res.json({ success: true, config: defaultConfig });
      }

      // --- SAVE CONFIG ---
      if (action === "save-config" && req.method === "POST") {
        const { defauts } = req.body;
        if (!Array.isArray(defauts)) return res.status(400).json({ success: false, error: "defauts doit être un tableau" });
        await db_firestore.collection("ecarts_config").doc("defauts").set({ defauts, updatedAt: Date.now() });
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur Ecarts:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// Validation Pointage (Visa RH → Caporal → Chef)
// =============================================
