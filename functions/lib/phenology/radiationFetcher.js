/**
 * radiationFetcher.js — Sprint 2 module clé.
 *
 * Cascade FarmRoad → Open-Meteo synthetic profile, retourne un objet
 * directement consommable par les modules Sprint 1
 * (`calculateDailyGdd`, `calculateDailyRadsum`).
 *
 * Cascade (cf. cadrage A5, stricte, jamais mixte) :
 *   1. Try FarmRoad cache (deps.readFarmroadCache(date))
 *      - Filter devices by station.deviceId
 *      - Convert timeseries 15-min slots → RadiationSample[] (1 sample/slot
 *        centered at HH:MM + 7m30s — cf. cadrage A1, midpoint rule donne
 *        une moyenne non biaisée à la trapezoidal integration aval)
 *      - Quality scoring on slot coverage :
 *           ≥ 87/96 (90 %) → 'good'  → use as-is
 *           48-86/96 (50-89 %) → 'partial' → use as-is
 *           < 48/96 → trigger fallback
 *   2. If FarmRoad fails or sparse → deps.fetchOutdoorDaily({lat,lon,date})
 *      - Build 96 synthetic RadiationSample[] with sinusoidal profile
 *        between sunrise (default 06:00) and sunset (default 18:00) ;
 *        peak at noon (cf. cadrage A3) — formule Carew/Privé standard
 *      - dataQuality = 'fallback'
 *   3. If Open-Meteo also fails → return empty samples + dataQuality = 'unavailable'
 *
 * Pure orchestrator, DI explicite. Aucun appel direct Firestore/HTTP.
 *
 * Source terminologie : project_phenology_sprint2_design.md (Open-Meteo,
 * pas Meteoblue malgré le brief addendum-v2.1).
 */

/**
 * @typedef {import('./types').RadiationSample} RadiationSample
 * @typedef {import('./types').DataQuality} DataQuality
 */

/**
 * @typedef {Object} RadiationDailyResult
 * @property {number|null} tMin
 * @property {number|null} tMax
 * @property {RadiationSample[]} samples
 * @property {DataQuality} dataQuality
 * @property {Object} dataSources
 * @property {Object} dataSources.temperature {source, stationId, quality}
 * @property {Object} dataSources.radiation {source, stationId, sensor, quality}
 */

/**
 * @typedef {Object} RadiationFetcherDeps
 * @property {(date: string) => Promise<object|null>} readFarmroadCache
 *   Returns farmroad_cache/{date} doc data, or null if absent.
 * @property {({latitude:number, longitude:number, date:string}) => Promise<object|null>} fetchOutdoorDaily
 *   Pre-wired Open-Meteo fetcher (typically `outdoorWeatherFallback.fetchOutdoorDaily`
 *   pre-bound with its own deps).
 * @property {(msg: string, ctx?: object) => void} [logWarn]
 */

// =====================================================================
// Constantes (cf. cadrage A4)
// =====================================================================

/** Slots 15-min/jour attendus du cache FarmRoad */
const FARMROAD_SLOTS_EXPECTED = 96;
/** ≥ 90 % slots → 'good' */
const QUALITY_GOOD_THRESHOLD = 87;
/** ≥ 50 % slots → 'partial' (sinon bascule fallback) */
const QUALITY_PARTIAL_THRESHOLD = 48;

/** Durée d'un slot FarmRoad (15 min en ms) */
const SLOT_DURATION_MS = 15 * 60 * 1000;
/** Offset au centre du slot (7 min 30 s en ms) — midpoint rule */
const SLOT_CENTER_OFFSET_MS = 7.5 * 60 * 1000;

/**
 * Synthèse Open-Meteo (cf. cadrage A3) : profil sinusoïdal entre sunrise
 * et sunset. Sprint 2 utilise des heures FIXES (06:00–18:00, soit 12 h
 * d'éclairement) — approximation acceptable pour Larache au printemps
 * (±30 min réels selon mois). Raffiner Sprint 3+ avec calcul astronomique
 * lat/date si précision insuffisante.
 */
const DEFAULT_SUNRISE_HOUR = 6;
const DEFAULT_SUNSET_HOUR = 18;

/** Conversion PAR µmol/m²/s ↔ W/m² PAR — physique solaire standard */
const W_PAR_TO_UMOL = 4.57;
/** Ratio par défaut PAR / Radiation totale (lumière solaire) — phenology-tables.md §2.2 */
const PAR_TO_RAD_RATIO_DEFAULT = 0.46;

// =====================================================================
// Helpers internes
// =====================================================================

function _dateToDayStartMs(date) {
  // Parse YYYY-MM-DD assuming UTC midnight (cohérent avec sineDay fixture Sprint 1)
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    0, 0, 0
  );
}

function _slotCenterMs(dayStartMs, slot) {
  return dayStartMs + slot * SLOT_DURATION_MS + SLOT_CENTER_OFFSET_MS;
}

function _qualityFromSlotCount(slots) {
  if (slots >= QUALITY_GOOD_THRESHOLD) return 'good';
  if (slots >= QUALITY_PARTIAL_THRESHOLD) return 'partial';
  return null; // déclenche fallback
}

function _detectSensor(device) {
  const m = device.measurements || {};
  const hasPar = !!m.PAR_INTENSITY;
  const hasRad = !!m.RADIATION_INTENSITY_INSIDE;
  if (hasPar && hasRad) return 'both';
  if (hasPar) return 'par';
  if (hasRad) return 'radiation';
  return null;
}

/**
 * Convertit les timeseries d'un device FarmRoad en RadiationSample[].
 * Chaque slot 15-min produit 1 sample avec timestamp au CENTRE du bucket
 * (cadrage A1 — midpoint rule, évite le biais systématique de "début"
 * vers le slot précédent).
 */
function _deviceTimeseriesToSamples(device, dayStartMs) {
  const ts = device.timeseries || {};
  const parSlots = ts.PAR_INTENSITY || [];
  const radSlots = ts.RADIATION_INTENSITY_INSIDE || [];

  const bySlot = new Map();
  for (const s of parSlots) {
    if (typeof s.slot !== 'number') continue;
    bySlot.set(s.slot, { timestamp: _slotCenterMs(dayStartMs, s.slot), parUmolM2s: s.avg });
  }
  for (const s of radSlots) {
    if (typeof s.slot !== 'number') continue;
    const existing = bySlot.get(s.slot) || { timestamp: _slotCenterMs(dayStartMs, s.slot) };
    existing.radiationWm2 = s.avg;
    bySlot.set(s.slot, existing);
  }
  return Array.from(bySlot.values()).sort((a, b) => a.timestamp - b.timestamp);
}

async function _tryFarmroad({ station, date }, deps) {
  if (!station || !station.deviceId) return null;
  const cache = await deps.readFarmroadCache(date);
  if (!cache || !Array.isArray(cache.devices)) return null;
  const device = cache.devices.find((d) => String(d.deviceId) === String(station.deviceId));
  if (!device) return null;

  const m = device.measurements || {};
  const tMin = m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.min : null;
  const tMax = m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.max : null;

  const dayStartMs = _dateToDayStartMs(date);
  const samples = _deviceTimeseriesToSamples(device, dayStartMs);
  const quality = _qualityFromSlotCount(samples.length);
  if (!quality) return null; // < 50 % → bascule fallback

  return {
    tMin, tMax, samples, quality,
    sensor: _detectSensor(device) || 'both',
  };
}

/**
 * Construit 96 RadiationSample[] depuis un Open-Meteo daily summary.
 *
 * Profil sinusoïdal (cf. cadrage A3) :
 *   W(t) = W_max × sin(π × (t - sunrise) / dayLength)   pour t ∈ [sunrise, sunset]
 *   W(t) = 0                                              sinon
 *
 * Calibration W_max pour que ∫W(t)dt = radiationMjM2 × 1e6 (W·s) :
 *   ∫₀^π sin(x) dx = 2  →  ∫_sunrise^sunset W(t) dt = W_max × dayLength_seconds × 2/π
 *   donc W_max = radiationMjM2 × 1e6 × π / (2 × dayLength × 3600)
 *
 * PAR dérivé de la radiation totale via le ratio parcelle :
 *   PAR_µmol = radiation_W × parToRadiationRatio × W_PAR_TO_UMOL
 *   (équivalent à `estimateMissingRadiation` Sprint 1 mais appliqué nativement)
 */
function _buildSyntheticSamples(meteo, date, parToRadiationRatio) {
  if (meteo.radiationMjM2 == null || meteo.radiationMjM2 < 0) {
    return []; // pas de radiation → pas de samples (le caller verra samples=[])
  }
  const sunrise = DEFAULT_SUNRISE_HOUR;
  const sunset = DEFAULT_SUNSET_HOUR;
  const dayLength = sunset - sunrise; // heures
  const radiationWs = meteo.radiationMjM2 * 1e6;
  const wMax = (radiationWs * Math.PI) / (2 * dayLength * 3600);

  const dayStartMs = _dateToDayStartMs(date);
  const samples = [];
  for (let slot = 0; slot < FARMROAD_SLOTS_EXPECTED; slot++) {
    const timestamp = _slotCenterMs(dayStartMs, slot);
    const hour = slot * 0.25 + 0.125; // centre du slot (0.125 = 7m30s/60)
    let radiationWm2 = 0;
    if (hour >= sunrise && hour <= sunset) {
      radiationWm2 = wMax * Math.sin((Math.PI * (hour - sunrise)) / dayLength);
    }
    const parUmolM2s = radiationWm2 * parToRadiationRatio * W_PAR_TO_UMOL;
    samples.push({ timestamp, radiationWm2, parUmolM2s });
  }
  return samples;
}

// =====================================================================
// API publique
// =====================================================================

/**
 * Récupère les données environnementales du jour pour une parcelle
 * (température + samples de radiation), avec cascade FarmRoad → Open-Meteo
 * → unavailable.
 *
 * @param {Object} params
 * @param {Object|null} params.station                    FarmroadStation (ou null → fallback direct)
 * @param {{latitude:number, longitude:number}} params.plotLocation
 * @param {string} params.date                            "YYYY-MM-DD"
 * @param {number} [params.parToRadiationRatio=0.46]
 * @param {RadiationFetcherDeps} deps
 * @returns {Promise<RadiationDailyResult>}
 */
async function fetchRadiationDaily(params, deps) {
  if (!params || typeof params !== 'object') {
    throw new TypeError('fetchRadiationDaily: params object required');
  }
  const { station, plotLocation, date } = params;
  const parToRadiationRatio = (typeof params.parToRadiationRatio === 'number' && params.parToRadiationRatio > 0)
    ? params.parToRadiationRatio
    : PAR_TO_RAD_RATIO_DEFAULT;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError('fetchRadiationDaily: date must be YYYY-MM-DD');
  }
  if (!plotLocation || typeof plotLocation.latitude !== 'number' || typeof plotLocation.longitude !== 'number') {
    throw new TypeError('fetchRadiationDaily: plotLocation.{latitude,longitude} numbers required');
  }
  if (!deps || typeof deps.readFarmroadCache !== 'function' || typeof deps.fetchOutdoorDaily !== 'function') {
    throw new TypeError('fetchRadiationDaily: deps.readFarmroadCache + deps.fetchOutdoorDaily required');
  }
  const logWarn = deps.logWarn || ((msg, ctx) => console.warn(msg, ctx || ''));

  // ── 1. FarmRoad
  const farmroad = await _tryFarmroad({ station, date }, deps);
  if (farmroad) {
    const stationId = station ? station.stationId : null;
    return {
      tMin: farmroad.tMin,
      tMax: farmroad.tMax,
      samples: farmroad.samples,
      dataQuality: farmroad.quality,
      dataSources: {
        temperature: { source: 'farmroad', stationId, quality: farmroad.quality },
        radiation: { source: 'farmroad', stationId, sensor: farmroad.sensor, quality: farmroad.quality },
      },
    };
  }

  // ── 2. Open-Meteo fallback
  logWarn('fetchRadiationDaily: FarmRoad unavailable or sparse → Open-Meteo fallback', {
    date,
    stationId: station ? station.stationId : null,
  });
  let meteo = null;
  try {
    meteo = await deps.fetchOutdoorDaily({
      latitude: plotLocation.latitude,
      longitude: plotLocation.longitude,
      date,
    });
  } catch (err) {
    logWarn('fetchRadiationDaily: Open-Meteo threw', { err: err.message });
    meteo = null;
  }

  // ── 3. Both failed
  if (!meteo) {
    return {
      tMin: null, tMax: null, samples: [],
      dataQuality: 'unavailable',
      dataSources: {
        temperature: { source: null, stationId: null, quality: 'unavailable' },
        radiation: { source: null, stationId: null, sensor: null, quality: 'unavailable' },
      },
    };
  }

  const samples = _buildSyntheticSamples(meteo, date, parToRadiationRatio);
  return {
    tMin: meteo.tMin,
    tMax: meteo.tMax,
    samples,
    dataQuality: 'fallback',
    dataSources: {
      temperature: { source: 'openmeteo', stationId: null, quality: 'fallback' },
      radiation: { source: 'openmeteo', stationId: null, sensor: 'radiation', quality: 'fallback' },
    },
  };
}

module.exports = {
  fetchRadiationDaily,
  __internals: {
    FARMROAD_SLOTS_EXPECTED,
    QUALITY_GOOD_THRESHOLD,
    QUALITY_PARTIAL_THRESHOLD,
    SLOT_DURATION_MS,
    SLOT_CENTER_OFFSET_MS,
    DEFAULT_SUNRISE_HOUR,
    DEFAULT_SUNSET_HOUR,
    W_PAR_TO_UMOL,
    PAR_TO_RAD_RATIO_DEFAULT,
    _buildSyntheticSamples,
    _slotCenterMs,
    _dateToDayStartMs,
  },
};
