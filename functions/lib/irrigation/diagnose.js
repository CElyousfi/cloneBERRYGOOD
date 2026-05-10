const { DEFAULT_THRESHOLDS } = require('./thresholds');

/**
 * Diagnose a daily summary. Returns one of: optimal | under-drain |
 * over-drain | critical | unknown, plus a list of machine-coded reasons.
 *
 * Severity ladder (most severe wins):
 *   1. critical        — total drain > severeHighDrainPct
 *   2. over-drain      — total drain > highDrainPct OR repeated high pulses
 *   3. under-drain     — total drain < lowDrainPct OR repeated low pulses
 *   4. optimal         — drain in [target min, target max] AND no salt drift
 *   5. unknown         — insufficient data (no measurable drain)
 *
 * Salt-drift, late-day high drain, pH excursions are emitted as reasons
 * but do not by themselves change the diagnosis label — recommendations.js
 * picks them up separately.
 *
 * @param {Object} stats
 * @param {number|null} stats.totalDrainPct
 * @param {number|null} stats.avgEcPts
 * @param {number|null} stats.avgEcDrain
 * @param {number|null} stats.avgPhPts
 * @param {number|null} stats.avgPhDrain
 * @param {number} stats.pulseCount
 * @param {number} stats.highDrainPulseCount
 * @param {number} stats.lowDrainPulseCount
 * @param {import('./types').EnrichedIrrigationEvent[]} stats.pulses
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @returns {{diagnosis: import('./types').Diagnosis, reasons: import('./types').DiagnosisReason[]}}
 */
function diagnoseDailySummary(stats, thresholds) {
  const thr = thresholds || DEFAULT_THRESHOLDS;
  /** @type {import('./types').DiagnosisReason[]} */
  const reasons = [];
  /** @type {import('./types').Diagnosis} */
  let diagnosis = 'unknown';

  const {
    totalDrainPct,
    avgEcPts,
    avgEcDrain,
    avgPhDrain,
    pulseCount,
    highDrainPulseCount,
    lowDrainPulseCount,
    pulses,
    drainTrend,
  } = stats;

  // Drainage axis
  if (totalDrainPct !== null && Number.isFinite(totalDrainPct)) {
    if (totalDrainPct > thr.severeHighDrainPct) {
      diagnosis = 'critical';
      reasons.push({
        code: 'OVER_DRAIN_SEVERE',
        message: `Drainage critique ${totalDrainPct.toFixed(1)}% (>${thr.severeHighDrainPct}%)`,
      });
    } else if (totalDrainPct > thr.highDrainPct || highDrainPulseCount >= thr.consecutiveHighDrainCount) {
      diagnosis = 'over-drain';
      reasons.push({
        code: 'OVER_DRAIN',
        message: `Drainage élevé ${totalDrainPct.toFixed(1)}% — ${highDrainPulseCount} pulse(s) > ${thr.highDrainPct}%`,
      });
    } else if (totalDrainPct < thr.lowDrainPct || lowDrainPulseCount >= thr.consecutiveLowDrainCount) {
      diagnosis = 'under-drain';
      reasons.push({
        code: 'UNDER_DRAIN',
        message: `Drainage insuffisant ${totalDrainPct.toFixed(1)}% (<${thr.lowDrainPct}%)`,
      });
    } else if (totalDrainPct >= thr.targetDrainMinPct && totalDrainPct <= thr.targetDrainMaxPct) {
      diagnosis = 'optimal';
    } else {
      diagnosis = 'optimal';
    }
  }

  // Salt-accumulation signal — independent of drainage label
  const ecDelta =
    Number.isFinite(avgEcDrain) && Number.isFinite(avgEcPts) ? avgEcDrain - avgEcPts : null;
  if (
    ecDelta !== null &&
    ecDelta > thr.ecDeltaHigh &&
    totalDrainPct !== null &&
    totalDrainPct < thr.targetDrainMaxPct
  ) {
    reasons.push({
      code: 'SALT_DRIFT',
      message: `ΔEC ${ecDelta.toFixed(2)} mS/cm avec drainage ${totalDrainPct.toFixed(1)}%`,
    });
    if (diagnosis === 'optimal') diagnosis = 'under-drain';
  }

  // Intra-day rising trend (substrate progressively saturating)
  if (
    drainTrend &&
    drainTrend.slopePctPerHour >= thr.drainTrendRisingPctPerHour &&
    drainTrend.endPct >= thr.highDrainPct
  ) {
    reasons.push({
      code: 'DRAIN_TREND_RISING',
      message: `Drainage en hausse ${drainTrend.startPct.toFixed(0)}% → ${drainTrend.endPct.toFixed(0)}% (+${drainTrend.slopePctPerHour.toFixed(1)}/h)`,
    });
  }

  // Late-day high drain
  const lateHighDrain = (Array.isArray(pulses) ? pulses : []).filter(
    p => p.isLateDayPulse && p.isHighDrain,
  );
  if (lateHighDrain.length > 0) {
    reasons.push({
      code: 'LATE_DAY_OVER_DRAIN',
      message: `${lateHighDrain.length} pulse(s) tardif(s) (≥${thr.lateDayHour}h) avec drainage élevé`,
    });
  }

  // pH band
  if (Number.isFinite(avgPhDrain)) {
    if (avgPhDrain < thr.phMin) {
      reasons.push({
        code: 'PH_DRAIN_LOW',
        message: `pH drainage acide ${avgPhDrain.toFixed(2)} (<${thr.phMin})`,
      });
    } else if (avgPhDrain > thr.phMax) {
      reasons.push({
        code: 'PH_DRAIN_HIGH',
        message: `pH drainage alcalin ${avgPhDrain.toFixed(2)} (>${thr.phMax})`,
      });
    }
  }

  // Insufficient data fallback
  if (diagnosis === 'unknown' && pulseCount === 0) {
    reasons.push({ code: 'NO_DATA', message: 'Aucune lecture sur la journée' });
  }

  return { diagnosis, reasons };
}

module.exports = { diagnoseDailySummary };
