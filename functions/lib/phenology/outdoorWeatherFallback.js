/**
 * outdoorWeatherFallback.js — Open-Meteo daily summary fallback.
 *
 * Source : Open-Meteo API (gratuit, sans clé)
 *   https://api.open-meteo.com/v1/forecast?...&daily=...&start_date=YYYY-MM-DD&end_date=...
 *
 * Note terminologique : le brief addendum-v2.1 et phenology-tables.md
 * mentionnent "Meteoblue". Le legacy et Sprint 2 utilisent en réalité
 * Open-Meteo (équivalent fonctionnel, gratuit, sans clé). Cf. mémoire
 * project_phenology_sprint2_design.md.
 *
 * Pure orchestrator, DI pour le HTTP fetch. Cache mémoire process-level
 * par (date, lat, lon) pour éviter refetch en cas de boucle multi-plot
 * sur même localisation.
 */

/**
 * @typedef {Object} OutdoorDailyResult
 * @property {string} date           "YYYY-MM-DD"
 * @property {number|null} tMin      °C
 * @property {number|null} tMax      °C
 * @property {number|null} humidity  %
 * @property {number|null} eto       mm/j
 * @property {number|null} radiationMjM2  MJ/m²/j (shortwave_radiation_sum)
 * @property {"openmeteo"} source
 */

/**
 * @typedef {Object} OutdoorWeatherDeps
 * @property {(url: string) => Promise<object|null>} fetchJson
 *   HTTP GET → JSON parsed. Resolves null on any error (timeout, 5xx,
 *   malformed body). Caller injects (e.g. wraps https.get).
 */

const BASE_URL = "https://api.open-meteo.com/v1/forecast";
const DAILY_FIELDS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "relative_humidity_2m_mean",
  "et0_fao_evapotranspiration",
  "shortwave_radiation_sum",
].join(",");

const _cache = new Map();
function _key(date, lat, lon) {
  return `${date}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
}

function _buildUrl(lat, lon, date) {
  return `${BASE_URL}?latitude=${lat}&longitude=${lon}&daily=${DAILY_FIELDS}` +
    `&timezone=Africa/Casablanca&start_date=${date}&end_date=${date}`;
}

function _mapResponse(date, j) {
  if (!j || !j.daily || !Array.isArray(j.daily.time) || j.daily.time.length === 0) return null;
  return {
    date,
    tMax: j.daily.temperature_2m_max ? j.daily.temperature_2m_max[0] : null,
    tMin: j.daily.temperature_2m_min ? j.daily.temperature_2m_min[0] : null,
    humidity: j.daily.relative_humidity_2m_mean ? j.daily.relative_humidity_2m_mean[0] : null,
    eto: j.daily.et0_fao_evapotranspiration ? j.daily.et0_fao_evapotranspiration[0] : null,
    radiationMjM2: j.daily.shortwave_radiation_sum ? j.daily.shortwave_radiation_sum[0] : null,
    source: "openmeteo",
  };
}

/**
 * Fetch Open-Meteo daily summary for a (lat, lon, date) point.
 * Returns null on any error (caller decides fallback).
 *
 * @param {{latitude:number, longitude:number, date:string}} params
 * @param {OutdoorWeatherDeps} deps
 * @returns {Promise<OutdoorDailyResult|null>}
 */
async function fetchOutdoorDaily({ latitude, longitude, date }, deps) {
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new TypeError("fetchOutdoorDaily: latitude/longitude must be finite numbers");
  }
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError("fetchOutdoorDaily: date must be YYYY-MM-DD string");
  }
  if (!deps || typeof deps.fetchJson !== "function") {
    throw new TypeError("fetchOutdoorDaily: deps.fetchJson(url) function required");
  }

  const cacheKey = _key(date, latitude, longitude);
  if (_cache.has(cacheKey)) return _cache.get(cacheKey);

  const url = _buildUrl(latitude, longitude, date);
  let payload;
  try {
    payload = await deps.fetchJson(url);
  } catch (err) {
    console.warn("fetchOutdoorDaily: fetch threw", err.message);
    payload = null;
  }
  const result = _mapResponse(date, payload);
  _cache.set(cacheKey, result);
  return result;
}

function clearOutdoorCache() {
  _cache.clear();
}

module.exports = {
  fetchOutdoorDaily,
  clearOutdoorCache,
  // Exposed for unit-testing helpers
  __internals: { _buildUrl, _mapResponse, BASE_URL, DAILY_FIELDS },
};
