const { avgPositive, sumPositive, groupBy } = require('./utils');
const { DEFAULT_THRESHOLDS } = require('./thresholds');
const { diagnoseDailySummary } = require('./diagnose');
const { dailyRadiationTotal, integrateRadiation } = require('./radiationStrategy');

/**
 * Build the 24-element cumulative array of indoor radiation (J/cm²)
 * delivered hour by hour. Index h holds the cumulative total at the END
 * of hour h (i.e. at h+1:00). Used for the F2 "RadSum cumulé" chart.
 *
 * @param {Array<number|null>} hourlyW
 * @param {number} sunriseMin
 * @param {number} transmittance
 * @returns {number[]}              24 elements, monotone non-decreasing
 */
function buildHourlyRadCumulative(hourlyW, sunriseMin, transmittance) {
  const cumul = new Array(24).fill(0);
  if (!Array.isArray(hourlyW) || hourlyW.length === 0) return cumul;
  let acc = 0;
  for (let h = 0; h < 24; h++) {
    const fromMin = Math.max(sunriseMin || 0, h * 60);
    const toMin = (h + 1) * 60;
    if (toMin > fromMin) {
      acc += integrateRadiation(hourlyW, fromMin, toMin) * transmittance;
    }
    cumul[h] = Math.round(acc * 100) / 100;
  }
  return cumul;
}

/**
 * Linear regression of drainPct vs hours-of-day across a day's pulses.
 * Tells us whether the substrate is progressively saturating ("matin OK,
 * après-midi explose") rather than a flat-but-high pattern.
 *
 * @param {import('./types').EnrichedIrrigationEvent[]} pulses
 * @param {import('./types').IrrigationThresholds} thr
 * @returns {{slopePctPerHour: number, startPct: number, endPct: number, firstHighDrainTime: string|null, samples: number}|null}
 */
function computeDrainTrend(pulses, thr) {
  if (!Array.isArray(pulses)) return null;
  const points = pulses.filter(p =>
    p.drainPct != null && Number.isFinite(p.drainPct) &&
    p.minutesFromMidnight != null && Number.isFinite(p.minutesFromMidnight)
  );
  if (points.length < thr.minPulsesForTrend) return null;

  const xs = points.map(p => p.minutesFromMidnight / 60);
  const ys = points.map(p => p.drainPct);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) * (xs[i] - meanX);
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  const startPct = slope * xs[0] + intercept;
  const endPct = slope * xs[n - 1] + intercept;
  const firstHigh = points.find(p => p.drainPct > thr.highDrainPct);
  return {
    slopePctPerHour: Math.round(slope * 1000) / 1000,
    startPct: Math.round(startPct * 100) / 100,
    endPct: Math.round(endPct * 100) / 100,
    firstHighDrainTime: firstHigh ? firstHigh.heure : null,
    samples: n,
  };
}

/**
 * Aggregate enriched events into one DailyIrrigationSummary per
 * (date, parcelle). Pure function.
 *
 * @param {import('./types').EnrichedIrrigationEvent[]} enriched
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @param {Record<string, {sunriseMin?: number, sunsetMin?: number, hourlyRadiation?: Array<number|null>}>} [weatherByDate]
 * @param {Record<string, {greenhouseType?: string}>} [parcelleMetaById]
 * @param {Object} [opts]
 * @param {string} [opts.todayDate]    "YYYY-MM-DD" of "today" (server local Africa/Casablanca)
 * @param {number} [opts.nowMin]       minutes-from-midnight of "now" in local time (0..1439)
 * @returns {import('./types').DailyIrrigationSummary[]}
 */
function buildDailySummaries(enriched, thresholds, weatherByDate, parcelleMetaById, opts, indoorRadByGhType) {
  if (!Array.isArray(enriched) || enriched.length === 0) return [];
  const thr = thresholds || DEFAULT_THRESHOLDS;

  const groups = groupBy(enriched, e => `${e.parcelle || '?'}__${e.date || '?'}`);
  const out = [];

  for (const key of Object.keys(groups)) {
    const pulses = groups[key].slice().sort((a, b) => {
      const ma = a.minutesFromMidnight;
      const mb = b.minutesFromMidnight;
      if (ma === null && mb === null) return 0;
      if (ma === null) return 1;
      if (mb === null) return -1;
      return ma - mb;
    });

    const totalInput = sumPositive(pulses.map(p => p.volumePtsMl)) || 0;
    const totalDrain = sumPositive(pulses.map(p => p.volumeDrainMl)) || 0;
    const totalDrainPct = totalInput > 0 && totalDrain > 0 ? (totalDrain / totalInput) * 100 : null;

    const avgEcPts = avgPositive(pulses.map(p => p.ecPts));
    const avgEcDrain = avgPositive(pulses.map(p => p.ecDrain));
    const avgPhPts = avgPositive(pulses.map(p => p.phPts));
    const avgPhDrain = avgPositive(pulses.map(p => p.phDrain));

    const pulseCount = pulses.length;
    const highDrainPulseCount = pulses.filter(p => p.isHighDrain).length;
    // Exclude the first pulse from low-drain count: Driscoll Rule 4 says
    // the first morning drip is *expected* to have minimal/no drain. R13
    // tracks the first-pulse signal separately.
    const lowDrainPulseCount = pulses.slice(1).filter(p => p.isLowDrain).length;

    // Last pulse with a known time
    const lastTimed = [...pulses].reverse().find(p => p.heure);
    const irrigationCutoffTime = lastTimed ? lastTimed.heure : null;

    const drainTrend = computeDrainTrend(pulses, thr);

    // Driscoll Rule 4: first morning drip should NOT drain (substrate dried back overnight)
    const firstPulse = pulses[0];
    const lastPulse = pulses[pulses.length - 1];
    const firstPulseDrainPct = firstPulse && firstPulse.drainPct != null ? firstPulse.drainPct : null;
    const firstPulseDrained = firstPulseDrainPct != null && firstPulseDrainPct > thr.firstDripMaxDrainPct;
    // Driscoll Rule 3 strict: at least one pulse should produce some run-off
    const noRunoffAllDay = pulseCount >= thr.noRunoffMinPulses
      && pulses.every(p => p.drainPct == null || p.drainPct < thr.noRunoffAllDayMaxPct);
    // Driscoll Rule 3: last pulse should NOT have huge run-off
    const lastPulseDrainPct = lastPulse && lastPulse.drainPct != null ? lastPulse.drainPct : null;

    // Resolve radiation source: FarmRoad indoor (preferred) per greenhouse
    // type, no fallback to Open-Meteo. Sunrise/sunset always from weatherByDate.
    const dayContext = weatherByDate ? weatherByDate[pulses[0].date] : null;
    const meta = parcelleMetaById ? parcelleMetaById[pulses[0].parcelle] : null;
    const ghType = meta && meta.greenhouseType;
    const indoorHourly = ghType && indoorRadByGhType && indoorRadByGhType[ghType]
      ? (indoorRadByGhType[ghType][pulses[0].date] || null)
      : null;
    const radSource = indoorHourly;            // null when no FarmRoad data
    const radTransmittance = 1;                // indoor is already inside the greenhouse
    const sunriseMin = (dayContext && Number.isFinite(dayContext.sunriseMin)) ? dayContext.sunriseMin : 6 * 60;
    const sunsetMin = (dayContext && Number.isFinite(dayContext.sunsetMin)) ? dayContext.sunsetMin : 19 * 60;
    const dailyRadJPerCm2 = Array.isArray(radSource)
      ? Math.round(dailyRadiationTotal(radSource, sunriseMin, sunsetMin) * radTransmittance * 100) / 100
      : null;

    const isToday = opts && opts.todayDate && pulses[0].date === opts.todayDate;
    const nowMinClamped = isToday && Number.isFinite(opts.nowMin)
      ? Math.min(opts.nowMin, sunsetMin)
      : null;
    let radSumSoFarJPerCm2 = null;
    if (Array.isArray(radSource)) {
      if (isToday && nowMinClamped !== null) {
        const upTo = Math.max(sunriseMin, nowMinClamped);
        radSumSoFarJPerCm2 = Math.round(integrateRadiation(radSource, sunriseMin, upTo) * radTransmittance * 100) / 100;
      } else {
        radSumSoFarJPerCm2 = dailyRadJPerCm2;
      }
    }
    const hourlyRadSumCumulative = Array.isArray(radSource)
      ? buildHourlyRadCumulative(radSource, sunriseMin, radTransmittance)
      : null;

    const stats = {
      totalDrainPct,
      avgEcPts,
      avgEcDrain,
      avgPhPts,
      avgPhDrain,
      pulseCount,
      highDrainPulseCount,
      lowDrainPulseCount,
      pulses,
      drainTrend,
      firstPulseDrainPct,
      firstPulseDrained,
      noRunoffAllDay,
      lastPulseDrainPct,
    };
    const { diagnosis, reasons } = diagnoseDailySummary(stats, thr);

    out.push({
      date: pulses[0].date,
      parcelle: pulses[0].parcelle,
      ferme: pulses[0].ferme,
      parcelleLabel: pulses[0].parcelleLabel,
      totalInputMl: totalInput,
      totalDrainMl: totalDrain,
      totalDrainPct,
      avgEcPts,
      avgEcDrain,
      avgPhPts,
      avgPhDrain,
      pulseCount,
      highDrainPulseCount,
      lowDrainPulseCount,
      irrigationCutoffTime,
      drainTrend,
      firstPulseDrainPct,
      firstPulseDrained,
      noRunoffAllDay,
      lastPulseDrainPct,
      dailyRadJPerCm2,
      radSumSoFarJPerCm2,
      hourlyRadSumCumulative,
      diagnosis,
      diagnosisReasons: reasons,
      pulses,
    });
  }

  // Stable ordering: by date desc, then parcelle asc
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.parcelle.localeCompare(b.parcelle)));
  return out;
}

module.exports = { buildDailySummaries, computeDrainTrend, buildHourlyRadCumulative };
