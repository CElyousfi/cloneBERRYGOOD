/**
 * Irrigation Intelligence — public barrel.
 *
 * Pipeline (composable):
 *   raw readings -> normalizeReadings -> enrichEvents -> buildDailySummaries
 *                -> buildRecommendations / buildFeatureRows
 *
 * All transforms are pure. I/O lives in dataAccess.js and is injected.
 */

const thresholds = require('./thresholds');
const utils = require('./utils');
const normalize = require('./normalize');
const enrich = require('./enrich');
const dailySummary = require('./dailySummary');
const diagnose = require('./diagnose');
const recommendations = require('./recommendations');
const crossDayTrends = require('./crossDayTrends');
const weatherAdjustments = require('./weatherAdjustments');
const nextPulse = require('./nextPulse');
const radiationStrategy = require('./radiationStrategy');
const parcelleMeta = require('./parcelleMeta');
const featureRow = require('./featureRow');
const dataAccess = require('./dataAccess');

/**
 * One-shot convenience: raw -> summaries+recos. Use this from a Cloud
 * Function or from the client when you don't need the intermediate stages.
 *
 * @param {import('./types').RawIrrigationReading[]} rawReadings
 * @param {Partial<import('./types').IrrigationThresholds>} [thresholdOverrides]
 * @returns {{
 *   events: import('./types').IrrigationEvent[],
 *   enriched: import('./types').EnrichedIrrigationEvent[],
 *   summaries: import('./types').DailyIrrigationSummary[],
 *   recommendationsByKey: Record<string, import('./types').IrrigationRecommendation[]>
 * }}
 */
function analyseReadings(rawReadings, thresholdOverrides, weatherForecast, options) {
  const thr = thresholds.getThresholds(thresholdOverrides);
  const opts = options || {};
  // weatherByDate: map of "YYYY-MM-DD" → { sunriseMin, sunsetMin, hourlyRadiation }
  const weatherByDate = opts.weatherByDate || null;
  // parcelleMetaById: map of parcelleId → { culture, ... }
  const parcelleMetaById = opts.parcelleMetaById || {};
  // indoorRadByGhType: { canarienne: { date: hourlyRad[24] }, tunnel: {...} }
  const indoorRadByGhType = opts.indoorRadByGhType || null;
  // todayDate / nowMin: server clock converted to Africa/Casablanca local time
  const todayDate = opts.todayDate || null;
  const nowMin = Number.isFinite(opts.nowMin) ? opts.nowMin : null;

  const events = normalize.normalizeReadings(rawReadings);
  const enriched = enrich.enrichEvents(events, thr, weatherByDate, parcelleMetaById, indoorRadByGhType);
  const summaries = dailySummary.buildDailySummaries(enriched, thr, weatherByDate, parcelleMetaById, { todayDate, nowMin }, indoorRadByGhType);

  /** @type {Record<string, import('./types').IrrigationRecommendation[]>} */
  const recoByKey = {};
  /** @type {Record<string, import('./types').IrrigationRecommendation[]>} */
  const radRecoByKey = {};
  for (const s of summaries) {
    const key = `${s.parcelle}__${s.date}`;
    const meta = parcelleMetaById[s.parcelle];
    recoByKey[key] = recommendations.buildRecommendations(s, thr, meta);
    const radRecos = radiationStrategy.buildRadiationRecommendations(s, meta, thr);
    if (radRecos.length > 0) radRecoByKey[key] = radRecos;
  }

  // Per-pulse advice trail — replays "what would have been told to the
  // stationnaire" at each pulse. Bounded cost: O(pulses²) per parcelle/day.
  /** @type {Record<string, Array<Object>>} */
  const pulseTrailByKey = {};
  for (const s of summaries) {
    const key = `${s.parcelle}__${s.date}`;
    const meta = parcelleMetaById[s.parcelle];
    const wToday = weatherByDate ? weatherByDate[s.date] : null;
    // Subset-summary builder — runs the daily-summary engine on a slice
    const subsetBuilder = (pulses) => {
      const subs = dailySummary.buildDailySummaries(pulses, thr, weatherByDate, parcelleMetaById, undefined, indoorRadByGhType);
      return subs[0] || null;
    };
    pulseTrailByKey[key] = nextPulse.recommendPulseTrail(s, wToday, thr, meta, subsetBuilder);
  }

  // Period-level (cross-day) analysis: group summaries by parcelle, then
  // compute trends + recommendations for each.
  /** @type {Record<string, import('./types').PeriodTrends>} */
  const periodTrendsByParcelle = {};
  /** @type {Record<string, import('./types').IrrigationRecommendation[]>} */
  const periodRecsByParcelle = {};
  const byParc = {};
  for (const s of summaries) {
    (byParc[s.parcelle] = byParc[s.parcelle] || []).push(s);
  }
  for (const parc of Object.keys(byParc)) {
    const trends = crossDayTrends.detectCrossDayTrends(byParc[parc], thr);
    if (trends) {
      periodTrendsByParcelle[parc] = trends;
      periodRecsByParcelle[parc] = crossDayTrends.buildPeriodRecommendations(trends, thr);
    }
  }

  // Weather-conditioned recos (forward-looking, per parcelle).
  // Uses today's forecast + each parcelle's most recent summary for context.
  /** @type {Record<string, import('./types').IrrigationRecommendation[]>} */
  const weatherRecsByParcelle = {};
  let weatherToday = null;
  if (Array.isArray(weatherForecast) && weatherForecast.length > 0) {
    weatherToday = weatherForecast[0];
    for (const parc of Object.keys(byParc)) {
      const recent = byParc[parc][0]; // summaries are pre-sorted desc
      const wRecos = weatherAdjustments.buildWeatherRecommendations(weatherToday, recent, thr);
      if (wRecos.length > 0) weatherRecsByParcelle[parc] = wRecos;
    }
  }

  return {
    events,
    enriched,
    summaries,
    recommendationsByKey: recoByKey,
    radiationRecommendationsByKey: radRecoByKey,
    pulseTrailByKey,
    periodTrendsByParcelle,
    periodRecommendationsByParcelle: periodRecsByParcelle,
    weatherForecast: weatherForecast || null,
    weatherToday,
    weatherRecommendationsByParcelle: weatherRecsByParcelle,
  };
}

module.exports = {
  ...thresholds,
  ...utils,
  ...normalize,
  ...enrich,
  ...dailySummary,
  ...diagnose,
  ...recommendations,
  ...crossDayTrends,
  ...weatherAdjustments,
  ...nextPulse,
  ...radiationStrategy,
  ...parcelleMeta,
  ...featureRow,
  ...dataAccess,
  analyseReadings,
};
