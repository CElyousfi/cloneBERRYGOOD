const { parseHeure, groupBy } = require('./utils');
const { DEFAULT_THRESHOLDS } = require('./thresholds');
const { integrateRadiation } = require('./radiationStrategy');

/**
 * Compute the effective late-day cutoff for a given date, in minutes from
 * midnight. Falls back to the static threshold when sunset is unknown.
 * @param {Object|null} dayContext   { sunsetMin?, sunriseMin? }
 * @param {import('./types').IrrigationThresholds} thr
 * @returns {number}
 */
function effectiveLateDayMin(dayContext, thr) {
  if (dayContext && Number.isFinite(dayContext.sunsetMin)) {
    // Driscoll Rule 1 — finish 1-3h before sunset (we use 2h as middle ground)
    return Math.max(13 * 60, dayContext.sunsetMin - thr.sunsetCutoffOffsetMin);
  }
  return thr.lateDayHour * 60;
}

/**
 * Enrich each event with derived signals computed within its
 * (parcelle, date) cohort: cumulative volumes, time deltas, drain ratios,
 * EC delta, lateness flags, RadSum-since-previous-pulse. Pure function.
 *
 * Sort within a day is by `heure` ascending; events without `heure` are
 * placed at the end and yield null time-based features.
 *
 * @param {import('./types').IrrigationEvent[]} events
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @param {Record<string, {sunriseMin?: number, sunsetMin?: number, hourlyRadiation?: Array<number|null>}>} [weatherByDate]
 * @param {Record<string, {greenhouseType?: string}>} [parcelleMetaById]   per-parcelle metadata for transmittance
 * @returns {import('./types').EnrichedIrrigationEvent[]}
 */
function enrichEvents(events, thresholds, weatherByDate, parcelleMetaById, indoorRadByGhType) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const thr = thresholds || DEFAULT_THRESHOLDS;

  const groups = groupBy(events, e => `${e.parcelle || '?'}__${e.date || '?'}`);
  /** @type {import('./types').EnrichedIrrigationEvent[]} */
  const out = [];

  for (const key of Object.keys(groups)) {
    const sorted = groups[key].slice().sort((a, b) => {
      const ma = parseHeure(a.heure);
      const mb = parseHeure(b.heure);
      if (ma === null && mb === null) return 0;
      if (ma === null) return 1;   // unknown heure → end
      if (mb === null) return -1;
      return ma - mb;
    });

    const sample = sorted[0];
    const dayContext = weatherByDate ? weatherByDate[sample.date] : null;
    const effLateMin = effectiveLateDayMin(dayContext, thr);
    const sunriseMin = dayContext && Number.isFinite(dayContext.sunriseMin) ? dayContext.sunriseMin : 6 * 60;
    const meta = parcelleMetaById ? parcelleMetaById[sample.parcelle] : null;
    const ghType = meta && meta.greenhouseType;
    // FarmRoad indoor radiation (no Open-Meteo fallback). When unavailable,
    // radSumSincePreviousPulse = null.
    const indoorHourly = ghType && indoorRadByGhType && indoorRadByGhType[ghType]
      ? (indoorRadByGhType[ghType][sample.date] || null)
      : null;
    const hourlyRad = indoorHourly;
    const radTransmittance = 1;

    let cumIn = 0;
    let cumDr = 0;
    let prevMin = null;

    for (const e of sorted) {
      const minutesFromMidnight = parseHeure(e.heure);
      const timeSincePreviousPulseMin =
        prevMin !== null && minutesFromMidnight !== null
          ? minutesFromMidnight - prevMin
          : null;

      const inMl = Number.isFinite(e.volumePtsMl) && e.volumePtsMl > 0 ? e.volumePtsMl : 0;
      const drMl = Number.isFinite(e.volumeDrainMl) && e.volumeDrainMl > 0 ? e.volumeDrainMl : 0;
      cumIn += inMl;
      cumDr += drMl;

      const drainPct = inMl > 0 && drMl > 0 ? (drMl / inMl) * 100 : null;
      const cumulativeDrainPct = cumIn > 0 ? (cumDr / cumIn) * 100 : null;
      const ecDelta =
        Number.isFinite(e.ecDrain) && Number.isFinite(e.ecPts)
          ? e.ecDrain - e.ecPts
          : null;

      const isHighDrain = drainPct !== null && drainPct > thr.highDrainPct;
      const isLowDrain = drainPct !== null && drainPct < thr.lowDrainPct;
      const isLateDayPulse = minutesFromMidnight !== null && minutesFromMidnight >= effLateMin;

      // RadSum since previous pulse (or since sunrise for the first one),
      // sourced from the FarmRoad sensor for this greenhouse type. Already
      // an indoor measurement → no transmittance applied.
      let radSumSincePreviousPulse = null;
      if (hourlyRad && minutesFromMidnight !== null) {
        const fromMin = prevMin !== null ? prevMin : sunriseMin;
        const indoorJ = integrateRadiation(hourlyRad, fromMin, minutesFromMidnight);
        radSumSincePreviousPulse = Math.round(indoorJ * radTransmittance * 100) / 100;
      }

      out.push({
        ...e,
        minutesFromMidnight,
        timeSincePreviousPulseMin,
        cumulativeInputMl: cumIn,
        cumulativeDrainMl: cumDr,
        cumulativeDrainPct,
        drainPct,
        ecDelta,
        isHighDrain,
        isLowDrain,
        isLateDayPulse,
        effectiveLateDayMin: effLateMin,
        radSumSincePreviousPulse,
      });

      if (minutesFromMidnight !== null) prevMin = minutesFromMidnight;
    }
  }

  return out;
}

module.exports = { enrichEvents, effectiveLateDayMin };
