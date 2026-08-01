// @ts-check
/**
 * meteoblueProxy.js — Pure orchestrator for Meteoblue "outdoor" packages
 * (weather + spray window), used behind a server-side Firestore cache
 * (see functions/index.js — exports.meteoblue) so N users/tabs share a
 * single real Meteoblue call per 4h TTL window instead of one per tab.
 *
 * DI pattern (cf. functions/lib/phenology/outdoorWeatherFallback.js):
 * no direct Firestore/network access here, deps.fetchJson injected by the
 * caller. Pas de transformation métier ici — la forme JSON retournée par
 * fetchWeather/fetchSpray est identique à ce que Meteoblue renvoie
 * aujourd'hui, consommée telle quelle par transformMeteoblueData /
 * transformSprayData côté frontend (public/app.jsx), inchangées.
 */

const METEOBLUE_BASE_URL = "https://my.meteoblue.com/packages";

/**
 * @typedef {Object} MeteoblueDeps
 * @property {(url: string) => Promise<object|null>} fetchJson
 *   HTTP GET → JSON parsed. Resolves null on any error (timeout, non-2xx,
 *   malformed body). Caller injects (e.g. wraps https.get or fetch).
 * @property {string} apiKey Meteoblue API key.
 */

/**
 * Round a coordinate to 2 decimals — regroups farms sharing the same
 * physical location (F1-F5, BAHIA, Avocatier all sit at lat=35.08/lon=-6.14)
 * onto a single cache doc instead of one per farm key.
 *
 * @param {number} n
 * @returns {number}
 */
function roundCoord(n) {
  return Math.round(n * 100) / 100;
}

/**
 * @param {{lat:number, lon:number, altitude:number}} coords
 * @param {string} apiKey
 * @returns {string}
 */
function buildWeatherBasicUrl({ lat, lon, altitude }, apiKey) {
  return METEOBLUE_BASE_URL + "/basic-day_agro-day_basic-1h?apikey=" + apiKey +
    "&lat=" + lat + "&lon=" + lon + "&asl=" + altitude + "&format=json";
}

/**
 * @param {{lat:number, lon:number, altitude:number}} coords
 * @param {string} apiKey
 * @returns {string}
 */
function buildWeatherAgroUrl({ lat, lon, altitude }, apiKey) {
  return METEOBLUE_BASE_URL + "/agro-1h?apikey=" + apiKey +
    "&lat=" + lat + "&lon=" + lon + "&asl=" + altitude + "&format=json";
}

/**
 * @param {{lat:number, lon:number, altitude:number}} coords
 * @param {string} apiKey
 * @returns {string}
 */
function buildSprayUrl({ lat, lon, altitude }, apiKey) {
  return METEOBLUE_BASE_URL + "/agromodelspray-1h?apikey=" + apiKey +
    "&lat=" + lat + "&lon=" + lon + "&asl=" + altitude + "&format=json";
}

/**
 * Replicates the legacy frontend `fetchMeteoblueData` logic: fetch the
 * basic-day_agro-day_basic-1h package, then best-effort merge shortwave
 * radiation + evapotranspiration from agro-1h onto data_1h. A failure on
 * the agro package is silent (rest of the tab keeps working with daily
 * ETo / no hourly radiation) — only a failure on the basic package returns
 * null.
 *
 * @param {{lat:number, lon:number, altitude:number}} coords
 * @param {MeteoblueDeps} deps
 * @returns {Promise<object|null>}
 */
async function fetchWeather({ lat, lon, altitude }, deps) {
  if (!deps || typeof deps.fetchJson !== "function" || typeof deps.apiKey !== "string") {
    throw new TypeError("fetchWeather: deps.fetchJson(url) and deps.apiKey required");
  }
  const basicUrl = buildWeatherBasicUrl({ lat, lon, altitude }, deps.apiKey);
  let data;
  try {
    data = await deps.fetchJson(basicUrl);
  } catch (err) {
    console.warn("meteoblueProxy.fetchWeather: basic fetch threw", err.message);
    data = null;
  }
  if (!data) return null;

  const agroUrl = buildWeatherAgroUrl({ lat, lon, altitude }, deps.apiKey);
  try {
    const extra = await deps.fetchJson(agroUrl);
    if (extra && extra.data_1h) {
      data.data_1h = Object.assign({}, data.data_1h || {}, {
        shortwave_radiation: extra.data_1h.shortwave_radiation || extra.data_1h.shortwaveradiation,
        evapotranspiration: extra.data_1h.evapotranspiration,
      });
    }
  } catch (err) {
    console.info("meteoblueProxy.fetchWeather: agro-1h fetch failed, fallback:", err && err.message);
  }
  return data;
}

/**
 * Replicates the legacy frontend `fetchSprayData` logic: fetch the
 * agromodelspray-1h package as-is.
 *
 * @param {{lat:number, lon:number, altitude:number}} coords
 * @param {MeteoblueDeps} deps
 * @returns {Promise<object|null>}
 */
async function fetchSpray({ lat, lon, altitude }, deps) {
  if (!deps || typeof deps.fetchJson !== "function" || typeof deps.apiKey !== "string") {
    throw new TypeError("fetchSpray: deps.fetchJson(url) and deps.apiKey required");
  }
  const url = buildSprayUrl({ lat, lon, altitude }, deps.apiKey);
  let data;
  try {
    data = await deps.fetchJson(url);
  } catch (err) {
    console.warn("meteoblueProxy.fetchSpray: fetch threw", err.message);
    data = null;
  }
  return data || null;
}

module.exports = {
  roundCoord,
  buildWeatherBasicUrl,
  buildWeatherAgroUrl,
  buildSprayUrl,
  fetchWeather,
  fetchSpray,
};
