/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';


const functions = require("firebase-functions");
const { admin, db: db_firestore, bucket } = require("../../config/firebase");
const sqlConfig = require("../../config/sqlConfig");
const { setCors } = require("../../middleware/cors");
const { withCache, invalidateCachePrefix: invalidateApiCachePrefix } = require("../../middleware/cache");
const { verifyAuth, requireAuth } = require("../../middleware/requireAuth");
const { dispatchNotification } = require("../../notificationDispatcher");
const { isoDateInTz } = require("../../lib/dates/isoDateInTz");
const { resolveCallerRole, resolveCallerProfile } = require("../../lib/auth/resolveRole");
const consoAccessControl = require("../../lib/valorisation/accessControl");
const { deriveFermeFromParcelle } = require("../../lib/valorisation/fermeParcelle");
// Consommation depuis les BONS Smart Berry (`consumption_vouchers`) — la source
// BEE ONE `sql_mirror_consommation` est tarie depuis avril 2026.
const scanAttachment = require("../../lib/stock/scanAttachment");
const demandeCreationArticle = require("../../lib/stock/demandeCreationArticle");
const whatsappService = require("../../whatsappService");
const { getConsommationRows, getCueilletteRows, getPointageRowsForDate, getPointageRowsForDateRange, getSyncStatus, getPointageMeta } = require("../../firestoreDataService");
const USE_MIRROR = process.env.USE_FIRESTORE_MIRROR !== "false";

// Cache mémoire (scope module) de l'index grand-livre de TOUS les articles.
// Justification du cache mémoire (vs withCache Firestore) : l'index complet
// dépasse facilement la limite 1 Mo d'un doc api_cache (4000 mouvements x N
// articles). Le scan complet stock_movements (~3,4 s) est fait UNE fois puis
// servi à tous les articles pendant le TTL. Invalidation = TTL (5 min) ;
// pas d'invalidation explicite sur write → acceptable (cf. ticket perf).
const syncService = require("../../sqlSyncService");
const prodSync = require("../../prodSyncService");

// BDP introspection (diagnostic READ-ONLY temporaire — protégé par ADMIN_SECRET)
let sql = null;
let pool = null;
async function getPool() {
  if (!sql) sql = require("mssql");
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}
function getSql() {
  if (!sql) sql = require("mssql");
  return sql;
}

// CORS helper imported from ./middleware/cors

// =============================================
// API 1: Programme Fertigation par parcelle/semaine
// =============================================
// --- Shared helper: structure consommation rows into parcelle → week → day → product ---
const COLLECTION = "avancement_culture";

function farmroadFetch(path) {
  const https = require("https");
  const apiKey = process.env.FARMROAD_API_KEY;
  const baseUrl = "https://developer.farmroad.io/api";
  return new Promise((resolve, reject) => {
    const url = baseUrl + path;
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: { "x-api-key": apiKey },
    };
    https.request(options, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        // Reject on HTTP error status to avoid silently swallowing 401/403/5xx
        // (without this, an auth error body parses fine but missing pagination
        // keys → farmroadFetchAllPages logs "0 items" and the job degrades silently)
        if (resp.statusCode < 200 || resp.statusCode >= 400) {
          return reject(new Error("FarmRoad HTTP " + resp.statusCode + " on " + path + ": " + data.slice(0, 200)));
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("Invalid JSON from FarmRoad: " + data.slice(0, 200))); }
      });
    }).on("error", reject).end();
  });
}

// Helper: Download a URL and return its text content
function downloadUrl(url) {
  const https = require("https");
  return new Promise((resolve, reject) => {
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

// Helper: Fetch all pages from a paginated FarmRoad endpoint
async function farmroadFetchAllPages(basePath, contentKey) {
  const key = contentKey || "content";
  let allItems = [];
  let page = 0;
  const MAX_PAGES = 20;
  while (page < MAX_PAGES) {
    const sep = basePath.includes("?") ? "&" : "?";
    const data = await farmroadFetch(basePath + sep + "page=" + page);
    const items = data[key] || [];
    allItems = allItems.concat(items);
    console.log("FarmRoad pagination: " + basePath.split("?")[0] + " page=" + page + ", got " + items.length + " items, totalPages=" + data.totalPages + ", last=" + data.last);
    if (data.last === true || data.last === undefined || page + 1 >= (data.totalPages || 1)) break;
    page++;
  }
  return allItems;
}

// =============================================
// FarmRoad — Shared fetch & cache logic
// =============================================
const FARMROAD_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min for today

// Compute agronomic KPIs from a device's 15-min timeseries.
// Slot duration = 900s = 0.25h. Photoperiod separation: PAR > 50 µmol = day.
function computeFarmroadKPIs(timeseries, gddJour) {
  const SLOT_SEC = 900;
  const SLOT_HRS = 0.25;
  const ts = timeseries || {};
  const par = ts.PAR_INTENSITY || [];
  const rad = ts.RADIATION_INTENSITY_INSIDE || [];
  const temp = ts.TEMPERATURE_INSIDE || [];
  const rh = ts.RH_INSIDE || [];
  const vpd = ts.ESTIMATED_VPD_INSIDE || [];
  const dew = ts.DEWPOINT_INSIDE || [];
  const co2 = ts.CO2_LEVEL || [];

  const parBySlot = {};
  par.forEach(s => { if (s && s.slot != null) parBySlot[s.slot] = s.avg || 0; });
  const isDay = slot => (parBySlot[slot] || 0) > 50;

  // ---- Lumière ----
  let dliMicromol = 0, radJ = 0, hPARutile = 0, hPARsat = 0;
  par.forEach(s => {
    if (s.avg == null) return;
    dliMicromol += s.avg * SLOT_SEC;
    if (s.avg > 200) hPARutile += SLOT_HRS;
    if (s.avg > 800) hPARsat += SLOT_HRS;
  });
  const dli = dliMicromol / 1e6; // mol/m²/d
  rad.forEach(s => { if (s.avg != null) radJ += s.avg * SLOT_SEC; });
  const radum = radJ / 1e6; // MJ/m²/d

  // ---- Thermique ----
  let tDaySum = 0, tDayN = 0, tNightSum = 0, tNightN = 0;
  let tMin = Infinity, tMax = -Infinity;
  let hStressChaud = 0, hStressFroid = 0, hChill = 0;
  temp.forEach(s => {
    if (s.avg == null) return;
    if (isDay(s.slot)) { tDaySum += s.avg; tDayN++; } else { tNightSum += s.avg; tNightN++; }
    if (s.min != null && s.min < tMin) tMin = s.min;
    if (s.max != null && s.max > tMax) tMax = s.max;
    if (s.avg > 30) hStressChaud += SLOT_HRS;
    if (s.avg < 5) hStressFroid += SLOT_HRS;
    if (s.avg < 7) hChill += SLOT_HRS;
  });
  const tDay = tDayN > 0 ? tDaySum / tDayN : null;
  const tNight = tNightN > 0 ? tNightSum / tNightN : null;
  const dif = (tDay != null && tNight != null) ? tDay - tNight : null;
  const ampl24 = (tMin !== Infinity && tMax !== -Infinity) ? tMax - tMin : null;

  // ---- Hydrique / VPD ----
  let vpdDaySum = 0, vpdDayN = 0, vpdNightSum = 0, vpdNightN = 0;
  let hStressVPDHaut = 0, hStressVPDBas = 0;
  vpd.forEach(s => {
    if (s.avg == null) return;
    if (isDay(s.slot)) { vpdDaySum += s.avg; vpdDayN++; } else { vpdNightSum += s.avg; vpdNightN++; }
    if (s.avg > 1.5) hStressVPDHaut += SLOT_HRS;
    if (isDay(s.slot) && s.avg < 0.4) hStressVPDBas += SLOT_HRS;
  });
  const vpdJour = vpdDayN > 0 ? vpdDaySum / vpdDayN : null;
  const vpdNuit = vpdNightN > 0 ? vpdNightSum / vpdNightN : null;

  // ---- Phyto: heures de mouillage (T - Tdew < 2°C) ----
  const tBySlot = {}, dewBySlot = {};
  temp.forEach(s => { if (s && s.slot != null) tBySlot[s.slot] = s.avg; });
  dew.forEach(s => { if (s && s.slot != null) dewBySlot[s.slot] = s.avg; });
  let hMouillage = 0;
  Object.keys(tBySlot).forEach(k => {
    const t = tBySlot[k], d = dewBySlot[k];
    if (t != null && d != null && (t - d) < 2) hMouillage += SLOT_HRS;
  });
  let hHRsat = 0, hHR85 = 0, hTopt = 0;
  rh.forEach(s => {
    if (s.avg == null) return;
    if (s.avg > 90) hHRsat += SLOT_HRS;
    if (s.avg > 85) hHR85 += SLOT_HRS;
  });
  temp.forEach(s => { if (s.avg != null && s.avg >= 15 && s.avg <= 25) hTopt += SLOT_HRS; });
  // Index Botrytis 0-100: 40% mouillage (cap 8h), 30% T° optimale (cap 12h), 30% HR>85 (cap 12h)
  const indexBotrytis = Math.round(
    40 * Math.min(hMouillage / 8, 1) +
    30 * Math.min(hTopt / 12, 1) +
    30 * Math.min(hHR85 / 12, 1)
  );

  // ---- CO2 ----
  let hCO2sub = 0;
  let co2DaySum = 0, co2DayN = 0, co2NightSum = 0, co2NightN = 0;
  co2.forEach(s => {
    if (s.avg == null) return;
    if (isDay(s.slot)) { co2DaySum += s.avg; co2DayN++; } else { co2NightSum += s.avg; co2NightN++; }
    const parSlot = parBySlot[s.slot] || 0;
    if (parSlot > 200 && s.avg < 400) hCO2sub += SLOT_HRS;
  });
  const co2Jour = co2DayN > 0 ? co2DaySum / co2DayN : null;
  const co2Nuit = co2NightN > 0 ? co2NightSum / co2NightN : null;

  // ---- Composites ----
  const ptq = (gddJour != null && gddJour > 0 && dli > 0) ? dli / gddJour : null;
  // ETP capteur (Stanghellini simplifié, vent nul, λ=2.45 MJ/kg):
  // ETP_mm/j ≈ (0.288 × RADUM + 0.288 × VPD_jour) / 2.45
  const etpCapteur = (radum > 0 && vpdJour != null)
    ? (0.288 * radum + 0.288 * vpdJour) / 2.45
    : null;

  const r2 = v => v == null ? null : Math.round(v * 100) / 100;
  const r1 = v => v == null ? null : Math.round(v * 10) / 10;
  const r0 = v => v == null ? null : Math.round(v);
  return {
    dli: r2(dli), radum: r2(radum), hPARutile: r1(hPARutile), hPARsat: r1(hPARsat),
    dif: r1(dif), tDay: r1(tDay), tNight: r1(tNight),
    hStressChaud: r1(hStressChaud), hStressFroid: r1(hStressFroid), hChill: r1(hChill), ampl24: r1(ampl24),
    vpdJour: r2(vpdJour), vpdNuit: r2(vpdNuit), hStressVPDHaut: r1(hStressVPDHaut), hStressVPDBas: r1(hStressVPDBas),
    hMouillage: r1(hMouillage), hHRsat: r1(hHRsat), indexBotrytis,
    hCO2sub: r1(hCO2sub), co2Jour: r0(co2Jour), co2Nuit: r0(co2Nuit),
    ptq: r2(ptq), etpCapteur: r2(etpCapteur),
    gddJour: r2(gddJour),
  };
}

async function refreshFarmroadCache(dateParam, farmIdFilter) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const isPastDay = dateParam < todayStr;

  // Helper: load daily GDD (same value for all devices since 1 GDD/day for the farm)
  const fetchGddJour = async () => {
    try {
      const gddDoc = await db_firestore.collection("gdd_tracking").doc(dateParam).get();
      return gddDoc.exists ? (gddDoc.data().gdd_jour || null) : null;
    } catch (e) { return null; }
  };

  // 1) Check Firestore cache
  const cacheRef = db_firestore.collection("farmroad_cache").doc(dateParam);
  const cached = await cacheRef.get();
  if (cached.exists) {
    const cData = cached.data();
    const cacheAge = Date.now() - (cData._cachedAt || 0);
    if (isPastDay || cacheAge < FARMROAD_CACHE_TTL_MS) {
      console.log("FarmRoad cache hit for " + dateParam + (isPastDay ? " (past)" : " (today, age " + Math.round(cacheAge / 1000) + "s)"));
      // Backfill KPIs on legacy cache entries (computed on-the-fly, not persisted)
      let cachedDevices = cData.devices || [];
      const needsKpiBackfill = cachedDevices.some(d => !d.kpis);
      if (needsKpiBackfill) {
        const gddJour = await fetchGddJour();
        cachedDevices = cachedDevices.map(d => d.kpis ? d : Object.assign({}, d, { kpis: computeFarmroadKPIs(d.timeseries, gddJour) }));
      }
      return { success: true, farms: cData.farms, devices: cachedDevices, date: dateParam, lastUpdate: cData.lastUpdate, totalMeasurements: cData.totalMeasurements, cached: true };
    }
  }

  // 2) Fetch farms structure (all pages)
  const farms = await farmroadFetchAllPages("/farms", "content");

  // 3) Calculate time range
  const dayStart = new Date(dateParam + "T00:00:00Z");
  const dayEnd = new Date(dateParam + "T23:59:59Z");
  const now = new Date();
  const effectiveEnd = dayEnd > now ? now : dayEnd;
  const totalHours = Math.ceil((effectiveEnd - dayStart) / 3600000);

  if (totalHours <= 0) {
    return { success: true, farms: Array.isArray(farms) ? farms : [], devices: [], date: dateParam, totalMeasurements: 0 };
  }

  // 4) Fetch ALL hours in parallel (no batching — faster)
  const allMeasurements = [];
  const hourPromises = [];
  for (let h = 0; h < totalHours; h++) {
    const startMs = dayStart.getTime() + h * 3600000;
    const endMs = Math.min(startMs + 3600000, effectiveEnd.getTime());
    const startTime = new Date(startMs).toISOString();
    const endTime = new Date(endMs).toISOString();
    hourPromises.push(
      farmroadFetchAllPages("/measurements?startTime=" + encodeURIComponent(startTime) + "&endTime=" + encodeURIComponent(endTime), "presignedDownloadUrlData")
        .then(async (allUrlData) => {
          const urls = allUrlData.map((d) => d.downloadUrl).filter(Boolean);
          const downloads = await Promise.all(urls.map((u) => downloadUrl(u).catch(() => "")));
          const results = [];
          for (const text of downloads) {
            for (const line of text.split("\n")) {
              if (!line.trim()) continue;
              try {
                const m = JSON.parse(line);
                if (!farmIdFilter || m.farm_id === farmIdFilter) {
                  // Assign 15-min slot based on measurement timestamp
                  const mTime = new Date(m.time || m.timestamp || startTime);
                  const minutesSinceDayStart = (mTime.getTime() - dayStart.getTime()) / 60000;
                  m._slot = Math.floor(minutesSinceDayStart / 15); // 0, 1, 2, ... (96 slots per day)
                  results.push(m);
                }
              } catch (e) { /* skip */ }
            }
          }
          return results;
        })
        .catch((err) => { console.error("FarmRoad hour " + h + " error:", err.message); return []; })
    );
  }
  const allResults = await Promise.all(hourPromises);
  for (const arr of allResults) allMeasurements.push(...arr);

  // Log device summary for debugging
  const deviceIds = [...new Set(allMeasurements.map(m => m.device_identifier || String(m.compartment_id)))];
  console.log("FarmRoad: " + allMeasurements.length + " measurements across " + deviceIds.length + " devices: " + deviceIds.join(", "));

  // 5) Aggregate by device (15-min slots)
  const agg = {};
  const slotData = {};
  const deviceMeta = {};

  for (const m of allMeasurements) {
    const devId = m.device_identifier || String(m.compartment_id) || "unknown";
    const type = m.measurement_type;
    const val = m.measurement_value;
    const slot = m._slot;

    if (!deviceMeta[devId]) deviceMeta[devId] = { compartment_id: m.compartment_id, sector_id: m.sector_id, farm_id: m.farm_id, types: {} };
    deviceMeta[devId].types[type] = true;

    if (!agg[devId]) agg[devId] = {};
    if (!agg[devId][type]) agg[devId][type] = { sum: 0, min: Infinity, max: -Infinity, last: null, lastTime: 0, unit: m.measurement_unit, count: 0 };
    const a = agg[devId][type];
    a.sum += val; a.count++;
    if (val < a.min) a.min = val;
    if (val > a.max) a.max = val;
    if (m.time > a.lastTime) { a.last = val; a.lastTime = m.time; }

    if (!slotData[devId]) slotData[devId] = {};
    if (!slotData[devId][type]) slotData[devId][type] = {};
    if (!slotData[devId][type][slot]) slotData[devId][type][slot] = { sum: 0, min: Infinity, max: -Infinity, count: 0 };
    const s = slotData[devId][type][slot];
    s.sum += val; s.count++;
    if (val < s.min) s.min = val;
    if (val > s.max) s.max = val;
  }

  // 6) Format devices (with KPIs)
  const gddJour = await fetchGddJour();
  const devices = Object.keys(agg).map((devId) => {
    const meta = deviceMeta[devId] || {};
    const hasSubstrate = !!meta.types["SUBSTRATE_MOISTURE_CONTENT"];
    const measObj = {};
    for (const type of Object.keys(agg[devId])) {
      const a = agg[devId][type];
      measObj[type] = { avg: Math.round((a.sum / a.count) * 100) / 100, min: Math.round(a.min * 100) / 100, max: Math.round(a.max * 100) / 100, last: a.last, unit: a.unit, count: a.count };
    }
    const tsObj = {};
    if (slotData[devId]) {
      for (const type of Object.keys(slotData[devId])) {
        const slots = slotData[devId][type];
        tsObj[type] = Object.keys(slots).map(Number).sort((a, b) => a - b).map((sl) => {
          const s = slots[sl];
          const totalMin = sl * 15;
          const hh = Math.floor(totalMin / 60);
          const mm = totalMin % 60;
          const label = hh + ':' + (mm < 10 ? '0' + mm : mm);
          return { hour: label, slot: sl, avg: Math.round((s.sum / s.count) * 100) / 100, min: Math.round(s.min * 100) / 100, max: Math.round(s.max * 100) / 100 };
        });
      }
    }
    const kpis = computeFarmroadKPIs(tsObj, gddJour);
    return { deviceId: devId, compartmentId: meta.compartment_id, sectorId: meta.sector_id, farmId: meta.farm_id, hasSubstrate, measurements: measObj, timeseries: tsObj, kpis };
  });

  const response = {
    success: true,
    farms: Array.isArray(farms) ? farms : [],
    devices,
    date: dateParam,
    lastUpdate: new Date().toISOString(),
    totalMeasurements: allMeasurements.length,
  };

  // 7) Cache in Firestore
  if (devices.length > 0) {
    await cacheRef.set(Object.assign({}, response, { _cachedAt: Date.now() })).catch((e) => console.error("Cache write error:", e.message));
  }

  return response;
}

// =============================================
// FarmRoad — Scheduled refresh every 15 minutes
// =============================================
const FORECAST_FARM = { lat: 35.08, lon: -6.14, asl: 49 };

// Fetch MeteoBlue 7-day forecast (daily + hourly)
const GDD_CONFIG = {
  J0: "2026-03-29",
  VARIETE: "Maravilla Long Cane",
  SERRE: "tunnel_larache",
  TBASE: 5,
  TUPPER: 30,
  GDD_CIBLE: 300, // milieu fourchette 250–350
};

// =============================================
// METEO OUTDOOR — farm coordinates for Open-Meteo
// =============================================
const METEO_FERMES = {
  F1:  { lat: 35.08, lon: -6.14 },
  F5:  { lat: 35.08, lon: -6.14 },
  F6:  { lat: 34.3425, lon: -6.5503 },
};

// Fetch outdoor weather from Open-Meteo including ETo
function calcGDD(tmax, tmin, tbase = GDD_CONFIG.TBASE, tupper = GDD_CONFIG.TUPPER) {
  const tmaxCap = Math.min(tmax, tupper);
  const tminCap = Math.min(tmin, tupper);
  return Math.max(0, (tmaxCap + tminCap) / 2 - tbase);
}

// --- Facteurs normalisés (0 à 1) ---
function normGDD(gddCumule, cible = GDD_CONFIG.GDD_CIBLE) {
  return Math.min(gddCumule / cible, 1);
}

function normDIF(tmax, tmin) {
  const dif = tmax - tmin;
  if (dif <= 0) return 0;
  if (dif <= 12) return dif / 12;
  if (dif <= 18) return 1;
  return Math.max(0, 1 - (dif - 18) / 10);
}

function normDLI(dli) {
  if (!dli) return 0.8; // valeur par défaut Larache printemps
  if (dli < 12) return dli / 12;
  if (dli <= 25) return 1;
  return Math.max(0.6, 1 - (dli - 25) / 30);
}

// --- Facteurs de stress ---
function calcVPDFromTH(tair, hr) {
  const esat = 0.6108 * Math.exp((17.27 * tair) / (tair + 237.3));
  return esat * (1 - hr / 100);
}

function stressVPD(vpd) {
  if (vpd <= 1.2) return 0;
  if (vpd <= 2.0) return (vpd - 1.2) / 0.8;
  return 1;
}

function stressTemperature(tmax) {
  if (tmax <= 28) return 0;
  if (tmax <= 32) return (tmax - 28) / 4;
  return 1;
}

// --- Pondérations IMC ---
const POIDS_IMC = {
  alpha: 0.50,   // GDD — moteur principal
  beta: 0.20,    // DIF — qualité sucre/couleur
  gamma: 0.15,   // DLI — photosynthèse
  delta: 0.10,   // stress VPD
  epsilon: 0.05, // stress chaleur
};

function calcIMC({ gddCumule, tmax, tmin, hr, dli }) {
  const vpd = calcVPDFromTH((tmax + tmin) / 2, hr);
  const composante_positive =
    POIDS_IMC.alpha * normGDD(gddCumule) +
    POIDS_IMC.beta * normDIF(tmax, tmin) +
    POIDS_IMC.gamma * normDLI(dli);
  const composante_stress =
    POIDS_IMC.delta * stressVPD(vpd) +
    POIDS_IMC.epsilon * stressTemperature(tmax);
  const imc = Math.max(0, Math.min(1, composante_positive - composante_stress));
  return {
    imc: parseFloat(imc.toFixed(3)),
    pourcentage: Math.round(imc * 100),
    vpd: parseFloat(vpd.toFixed(2)),
    stressVPD: parseFloat(stressVPD(vpd).toFixed(2)),
    stressThermal: parseFloat(stressTemperature(tmax).toFixed(2)),
    alerte: imc >= 0.85 ? "RECOLTE_IMMINENTE" :
            imc >= 0.70 ? "SURVEILLER_J3" :
            imc >= 0.50 ? "EN_COURS" : "PRECOCE",
  };
}

// Helper: local date string in Africa/Casablanca timezone
function localDateStr(date) {
  const d = date || new Date();
  // Use Intl to get Casablanca date reliably
  return isoDateInTz(d, 'Africa/Casablanca'); // returns YYYY-MM-DD
}

// Core GDD computation for a given date string
function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += x[i]; sumY += y[i]; }
  const meanX = sumX / n, meanY = sumY / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX, dy = y[i] - meanY;
    num += dx * dy; denX += dx * dx; denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function laggedCorrelation(production, indicator, maxLag = 5) {
  let bestR = 0, bestLag = 0;
  for (let lag = 0; lag <= maxLag; lag++) {
    // production[i] correlated with indicator[i - lag]
    const prodSlice = production.slice(lag);
    const indSlice = indicator.slice(0, indicator.length - lag);
    const n = Math.min(prodSlice.length, indSlice.length);
    if (n < 5) continue;
    const r = pearsonCorrelation(prodSlice.slice(0, n), indSlice.slice(0, n));
    if (Math.abs(r) > Math.abs(bestR)) { bestR = r; bestLag = lag; }
  }
  const absR = Math.abs(bestR);
  const interpretation = absR >= 0.7 ? "Forte" : absR >= 0.4 ? "Modérée" : absR >= 0.2 ? "Faible" : "Non significative";
  return { r: Math.round(bestR * 100) / 100, lag_optimal: bestLag, interpretation };
}

// Normalise Parcelle_Culturale → nom d'affichage avec sous-variété
// (miroir simplifié de normalizeParcelle() dans app.jsx)
async function getMeteoLaouamra() {
  const https = require("https");
  return new Promise((resolve) => {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=35.08&longitude=-6.14&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration,relative_humidity_2m_max&timezone=Africa/Casablanca&forecast_days=7";
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

// Helper: Aggregate FarmRoad serre data for a date, fallback to Open-Meteo + delta
async function aggregateSerreData(dateStr) {
  // Check Firestore cache first
  const cacheRef = db_firestore.collection("farms").doc("larache").collection("serre_data").doc(dateStr);
  const cached = await cacheRef.get();
  const todayStr = localDateStr();
  const isPast = dateStr < todayStr;
  if (cached.exists) {
    const d = cached.data();
    if (isPast || (Date.now() - (d._cachedAt || 0)) < FARMROAD_CACHE_TTL_MS) return d;
  }

  // Try FarmRoad
  try {
    const farmroadCacheRef = db_firestore.collection("farmroad_cache").doc(dateStr);
    let farmroadData = null;
    const snap = await farmroadCacheRef.get();
    if (snap.exists) {
      farmroadData = snap.data();
    } else {
      // Fetch live — reuse the same logic as the farmroad endpoint
      await farmroadFetch("/farms?page=0"); // validate API connectivity
      const dayStart = new Date(dateStr + "T00:00:00Z");
      const dayEnd = new Date(dateStr + "T23:59:59Z");
      const now = new Date();
      const effectiveEnd = dayEnd > now ? now : dayEnd;
      const totalHours = Math.ceil((effectiveEnd - dayStart) / 3600000);
      if (totalHours > 0) {
        const allMeasurements = [];
        const hourPromises = [];
        for (let h = 0; h < totalHours; h++) {
          const startMs = dayStart.getTime() + h * 3600000;
          const endMs = Math.min(startMs + 3600000, effectiveEnd.getTime());
          hourPromises.push(
            farmroadFetchAllPages("/measurements?startTime=" + encodeURIComponent(new Date(startMs).toISOString()) + "&endTime=" + encodeURIComponent(new Date(endMs).toISOString()), "presignedDownloadUrlData")
              .then(async (allUrlData) => {
                const urls = allUrlData.map((d) => d.downloadUrl).filter(Boolean);
                const downloads = await Promise.all(urls.map((u) => downloadUrl(u).catch(() => "")));
                const results = [];
                for (const text of downloads) {
                  for (const line of text.split("\n")) {
                    if (!line.trim()) continue;
                    try { results.push(JSON.parse(line)); } catch (e) { /* skip */ }
                  }
                }
                return results;
              }).catch(() => [])
          );
        }
        const allResults = await Promise.all(hourPromises);
        for (const arr of allResults) allMeasurements.push(...arr);
        farmroadData = { measurements: allMeasurements };
      }
    }

    if (farmroadData) {
      // Extract from cached farmroad data (devices array) or raw measurements
      let T_max = -Infinity, T_min = Infinity, HR_sum = 0, HR_count = 0, PAR_sum = 0, PAR_count = 0, RAD_sum = 0, RAD_count = 0;
      let hourlyHR = {};

      if (farmroadData.devices) {
        // From cached farmroad response — only use greenhouse device (hasSubstrate=true)
        const serreDevices = farmroadData.devices.filter(d => d.hasSubstrate);
        const devicesToUse = serreDevices.length > 0 ? serreDevices : farmroadData.devices;
        for (const dev of devicesToUse) {
          const m = dev.measurements || {};
          if (m.TEMPERATURE_INSIDE) {
            if (m.TEMPERATURE_INSIDE.max > T_max) T_max = m.TEMPERATURE_INSIDE.max;
            if (m.TEMPERATURE_INSIDE.min < T_min) T_min = m.TEMPERATURE_INSIDE.min;
          }
          if (m.RH_INSIDE) { HR_sum += m.RH_INSIDE.avg; HR_count++; }
          if (m.PAR_INTENSITY) { PAR_sum += m.PAR_INTENSITY.avg * m.PAR_INTENSITY.count; PAR_count += m.PAR_INTENSITY.count; }
          if (m.RADIATION_INTENSITY_INSIDE) { RAD_sum += m.RADIATION_INTENSITY_INSIDE.avg * m.RADIATION_INTENSITY_INSIDE.count; RAD_count += m.RADIATION_INTENSITY_INSIDE.count; }
          // Hourly HR for alerts
          const ts = dev.timeseries || {};
          if (ts.RH_INSIDE) {
            for (const h of ts.RH_INSIDE) {
              if (!hourlyHR[h.hour]) hourlyHR[h.hour] = [];
              hourlyHR[h.hour].push(h.avg);
            }
          }
        }
      } else if (farmroadData.measurements) {
        // From raw measurements
        for (const m of farmroadData.measurements) {
          const val = m.measurement_value;
          if (m.measurement_type === "TEMPERATURE_INSIDE") { if (val > T_max) T_max = val; if (val < T_min) T_min = val; }
          if (m.measurement_type === "RH_INSIDE") { HR_sum += val; HR_count++; }
          if (m.measurement_type === "PAR_INTENSITY") { PAR_sum += val; PAR_count++; }
          if (m.measurement_type === "RADIATION_INTENSITY_INSIDE") { RAD_sum += val; RAD_count++; }
        }
      }

      if (T_max > -Infinity && T_min < Infinity) {
        // PAR: convert from µmol/m²/s average to mol/m²/day (avg × seconds_in_day / 1e6)
        const PAR_avg = PAR_count > 0 ? PAR_sum / PAR_count : 0;
        const PAR_mol = PAR_avg * 3600 * 12 / 1e6; // ~12h daylight
        const result = {
          date: dateStr,
          T_max_serre: Math.round(T_max * 100) / 100,
          T_min_serre: Math.round(T_min * 100) / 100,
          HR_moyenne: HR_count > 0 ? Math.round((HR_sum / HR_count) * 100) / 100 : null,
          PAR_sum: Math.round(PAR_mol * 100) / 100,
          RAD_sum: RAD_count > 0 ? Math.round((RAD_sum / RAD_count) * 100) / 100 : null,
          hourlyHR,
          source: "farmroad",
          _cachedAt: Date.now(),
        };
        cacheRef.set(result).catch(() => {});
        return result;
      }
    }
  } catch (e) {
    console.error("FarmRoad aggregation error for " + dateStr + ":", e.message);
  }

  // Fallback: Open-Meteo + delta T° +4°C
  const meteo = await getMeteoLaouamra();
  if (meteo && meteo.daily) {
    const idx = (meteo.daily.time || []).indexOf(dateStr);
    if (idx >= 0) {
      const d = meteo.daily;
      const result = {
        date: dateStr,
        T_max_serre: d.temperature_2m_max[idx] + 4,
        T_min_serre: d.temperature_2m_min[idx] + 4,
        HR_moyenne: d.relative_humidity_2m_max[idx] || 80,
        PAR_sum: d.sunshine_duration[idx] ? Math.round((d.sunshine_duration[idx] / 3600) * 1.2 * 100) / 100 : 10,
        RAD_sum: null,
        hourlyHR: {},
        source: "openmeteo_fallback",
        _cachedAt: Date.now(),
      };
      cacheRef.set(result).catch(() => {});
      return result;
    }
  }
  return null;
}

// Helper: Compute weather adjustment factor (attenuated — ±15% max)
// Weather modulates around 1.0, never dominates the prediction
const phenology = require("../../lib/phenology");

module.exports = { COLLECTION, FARMROAD_CACHE_TTL_MS, FORECAST_FARM, GDD_CONFIG, METEO_FERMES, POIDS_IMC, USE_MIRROR, admin, aggregateSerreData, bucket, calcGDD, calcIMC, calcVPDFromTH, computeFarmroadKPIs, consoAccessControl, db_firestore, demandeCreationArticle, deriveFermeFromParcelle, dispatchNotification, downloadUrl, farmroadFetch, farmroadFetchAllPages, functions, getConsommationRows, getCueilletteRows, getMeteoLaouamra, getPointageMeta, getPointageRowsForDate, getPointageRowsForDateRange, getPool, getSql, getSyncStatus, invalidateApiCachePrefix, laggedCorrelation, localDateStr, normDIF, normDLI, normGDD, pearsonCorrelation, phenology, prodSync, refreshFarmroadCache, requireAuth, resolveCallerProfile, resolveCallerRole, scanAttachment, setCors, sqlConfig, stressTemperature, stressVPD, syncService, verifyAuth, whatsappService, withCache };

// `sql` et `pool` sont des singletons PARESSEUX, reassignes par getPool()/getSql().
// Exposes en getters : une destructuration figerait la valeur (null) et la
// reassignation resterait invisible au module appelant.
Object.defineProperty(module.exports, 'sql', { get: () => sql, enumerable: true });
Object.defineProperty(module.exports, 'pool', { get: () => pool, enumerable: true });
