/**
 * Cross-day (period-level) signals computed across a list of
 * DailyIrrigationSummary entries for a single parcelle.
 *
 * All functions are pure. The caller groups summaries by parcelle.
 */

const { DEFAULT_THRESHOLDS } = require('./thresholds');

/**
 * Days between two ISO date strings (YYYY-MM-DD), assuming UTC midnight.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function dayDiff(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

/**
 * Linear regression of (dayOffset, value), where dayOffset is days from
 * the earliest summary. Pulses with null/NaN values are skipped.
 *
 * Returns slope in (value-units / day) and intercept, or null if < 2 pts.
 * @param {Array<{date: string, value: number|null}>} pts
 * @returns {{slope: number, intercept: number, samples: number}|null}
 */
function regressByDay(pts) {
  const valid = pts.filter(p => p.value != null && Number.isFinite(p.value));
  if (valid.length < 2) return null;
  const dayZero = valid[0].date;
  const xs = valid.map(p => dayDiff(dayZero, p.date));
  const ys = valid.map(p => p.value);
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
  return { slope, intercept, samples: n };
}

/**
 * Longest run of consecutive calendar days satisfying a predicate.
 * Gaps in the dataset (missing days) reset the streak.
 *
 * @param {import('./types').DailyIrrigationSummary[]} sortedAsc  pre-sorted ascending by date
 * @param {(s: import('./types').DailyIrrigationSummary) => boolean} predicate
 * @returns {{length: number, dateFrom: string|null, dateTo: string|null}}
 */
function longestConsecutiveStreak(sortedAsc, predicate) {
  let max = 0, cur = 0;
  let maxFrom = null, maxTo = null, curFrom = null;
  let lastDate = null;
  for (const s of sortedAsc) {
    const consecutive = lastDate ? dayDiff(lastDate, s.date) === 1 : false;
    if (predicate(s)) {
      if (consecutive && cur > 0) {
        cur++;
      } else {
        cur = 1;
        curFrom = s.date;
      }
      if (cur > max) {
        max = cur;
        maxFrom = curFrom;
        maxTo = s.date;
      }
    } else {
      cur = 0;
      curFrom = null;
    }
    lastDate = s.date;
  }
  return { length: max, dateFrom: maxFrom, dateTo: maxTo };
}

/**
 * Standard deviation of an array (population, not sample). null if < 2 pts.
 * @param {Array<number|null>} arr
 * @returns {number|null}
 */
function stddev(arr) {
  const valid = arr.filter(v => v != null && Number.isFinite(v));
  if (valid.length < 2) return null;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((a, b) => a + (b - mean) * (b - mean), 0) / valid.length;
  return Math.sqrt(variance);
}

/**
 * Detect cross-day trends across a single parcelle's summaries.
 * Returns null if not enough data points for any meaningful trend.
 *
 * @param {import('./types').DailyIrrigationSummary[]} summaries
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @returns {import('./types').PeriodTrends|null}
 */
function detectCrossDayTrends(summaries, thresholds) {
  if (!Array.isArray(summaries) || summaries.length === 0) return null;
  const thr = thresholds || DEFAULT_THRESHOLDS;
  if (summaries.length < thr.minDaysForPeriodTrend) {
    // Still return shape so UI can show "insufficient data" if it wants
    return null;
  }

  // Sort ascending by date
  const sorted = [...summaries].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

  const ecDrainReg = regressByDay(sorted.map(s => ({ date: s.date, value: s.avgEcDrain })));
  const ecApportReg = regressByDay(sorted.map(s => ({ date: s.date, value: s.avgEcPts })));
  const drainPctReg = regressByDay(sorted.map(s => ({ date: s.date, value: s.totalDrainPct })));
  const phDrainReg = regressByDay(sorted.map(s => ({ date: s.date, value: s.avgPhDrain })));

  // Total drift = slope × span in days
  const spanDays = dayDiff(sorted[0].date, sorted[sorted.length - 1].date);

  const ecDrainDrift = ecDrainReg ? +(ecDrainReg.slope * spanDays).toFixed(3) : null;
  const ecApportDrift = ecApportReg ? +(ecApportReg.slope * spanDays).toFixed(3) : null;
  const drainPctDrift = drainPctReg ? +(drainPctReg.slope * spanDays).toFixed(2) : null;
  const phDrainDrift = phDrainReg ? +(phDrainReg.slope * spanDays).toFixed(3) : null;

  const overDrain = longestConsecutiveStreak(
    sorted,
    s => s.diagnosis === 'over-drain' || s.diagnosis === 'critical',
  );
  const underDrain = longestConsecutiveStreak(sorted, s => s.diagnosis === 'under-drain');

  const drainStddev = stddev(sorted.map(s => s.totalDrainPct));
  const ecDrainStddev = stddev(sorted.map(s => s.avgEcDrain));
  const phDrainStddev = stddev(sorted.map(s => s.avgPhDrain));

  return {
    days: sorted.length,
    spanDays,
    dateFrom: sorted[0].date,
    dateTo: sorted[sorted.length - 1].date,
    ecDrainSlopePerDay: ecDrainReg ? +ecDrainReg.slope.toFixed(4) : null,
    ecApportSlopePerDay: ecApportReg ? +ecApportReg.slope.toFixed(4) : null,
    drainPctSlopePerDay: drainPctReg ? +drainPctReg.slope.toFixed(3) : null,
    phDrainSlopePerDay: phDrainReg ? +phDrainReg.slope.toFixed(4) : null,
    ecDrainDrift,
    ecApportDrift,
    drainPctDrift,
    phDrainDrift,
    overDrainStreak: overDrain,
    underDrainStreak: underDrain,
    drainStddev: drainStddev != null ? +drainStddev.toFixed(2) : null,
    ecDrainStddev: ecDrainStddev != null ? +ecDrainStddev.toFixed(3) : null,
    phDrainStddev: phDrainStddev != null ? +phDrainStddev.toFixed(3) : null,
  };
}

/**
 * Build period-level recommendations from cross-day trends.
 * Rules (V1, all explainable):
 *   R9  EC_DRIFT_UP_PERIOD     — EC drain rose by ≥ ecDrainDriftMsCm over period
 *   R10 SUSTAINED_OVER_DRAIN   — N+ consecutive over-drain days
 *   R11 SUSTAINED_LOW_DRAIN    — N+ consecutive under-drain days
 *   R12 DRAIN_INSTABILITY      — drain stddev ≥ drainInstabilityPct
 *
 * @param {import('./types').PeriodTrends|null} trends
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @returns {import('./types').IrrigationRecommendation[]}
 */
function buildPeriodRecommendations(trends, thresholds) {
  if (!trends) return [];
  const thr = thresholds || DEFAULT_THRESHOLDS;
  /** @type {import('./types').IrrigationRecommendation[]} */
  const recos = [];

  // R9 — EC drain drift up
  if (trends.ecDrainDrift != null && trends.ecDrainDrift >= thr.ecDrainDriftMsCm) {
    recos.push({
      level: 'warning',
      code: 'EC_DRIFT_UP_PERIOD',
      title: `Dérive EC drain sur ${trends.days} jours`,
      message: `EC drain monte de +${trends.ecDrainDrift.toFixed(2)} mS/cm sur la période`,
      rationale: 'Accumulation saline progressive — le programme actuel ne lessive pas assez. Ce signal lent passe inaperçu en analyse jour par jour.',
      suggestedAction: `Augmente le drainage cible à ${thr.targetDrainMaxPct}-30 % pendant 3-5 jours pour relaver le substrat, puis reviens au programme normal et surveille EC drain.`,
    });
  }

  // R10 — Sustained over-drain
  if (trends.overDrainStreak && trends.overDrainStreak.length >= thr.sustainedOverDrainDays) {
    const od = trends.overDrainStreak;
    recos.push({
      level: 'warning',
      code: 'SUSTAINED_OVER_DRAIN',
      title: 'Surdrainage prolongé',
      message: `${od.length} jours consécutifs en surdrainage (${od.dateFrom} → ${od.dateTo})`,
      rationale: 'Pas un incident ponctuel : la programmation actuelle est structurellement trop généreuse.',
      suggestedAction: `Réduis la durée standard de pulse de 10-15 % en base, puis ajuste finement. Cible : ${thr.targetDrainMinPct}-${thr.targetDrainMaxPct} %.`,
    });
  }

  // R11 — Sustained low-drain
  if (trends.underDrainStreak && trends.underDrainStreak.length >= thr.sustainedLowDrainDays) {
    const ud = trends.underDrainStreak;
    recos.push({
      level: 'warning',
      code: 'SUSTAINED_LOW_DRAIN',
      title: 'Drainage insuffisant prolongé',
      message: `${ud.length} jours consécutifs en sous-drainage (${ud.dateFrom} → ${ud.dateTo})`,
      rationale: 'Risque cumulé d\'accumulation saline et de stress hydrique du système racinaire.',
      suggestedAction: `Augmente la durée de pulse de 15-20 % jusqu'à atteindre ${thr.targetDrainMinPct}-${thr.targetDrainMaxPct} % de drainage. Surveille EC drain en parallèle.`,
    });
  }

  // R12 — Drain instability
  if (trends.drainStddev != null && trends.drainStddev >= thr.drainInstabilityPct) {
    recos.push({
      level: 'info',
      code: 'DRAIN_INSTABILITY',
      title: 'Drainage instable d\'un jour à l\'autre',
      message: `Écart-type ${trends.drainStddev.toFixed(1)} pp sur ${trends.days} jours`,
      rationale: 'Le programme oscille trop : difficile d\'optimiser tant que la base n\'est pas stable.',
      suggestedAction: 'Stabilise d\'abord (mêmes horaires, mêmes durées chaque jour) avant de chercher l\'optimum.',
    });
  }

  // Sort: critical -> warning -> info -> ok
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  recos.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  return recos;
}

module.exports = {
  detectCrossDayTrends,
  buildPeriodRecommendations,
  // exported for tests
  dayDiff,
  longestConsecutiveStreak,
  stddev,
  regressByDay,
};
