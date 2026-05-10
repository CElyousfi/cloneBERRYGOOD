/**
 * Radiation-driven irrigation strategy.
 *
 * Substrate-crop best practice (Priva/Hoogendoorn/Driscoll): trigger pulses
 * based on accumulated radiation since the last pulse, not on a fixed clock.
 * Cloudy day → fewer pulses; sunny day → more pulses; auto-adapting.
 *
 * All inputs are pre-computed by the enrichment layer (radSum per pulse).
 * Helpers here just integrate W/m² over time and predict next pulse.
 */

const { DEFAULT_THRESHOLDS } = require('./thresholds');

/**
 * Get the per-pulse target in J/cm² for a culture.
 * @param {string|null} culture
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @returns {number}
 */
function getRadiationTarget(culture, thresholds) {
  const thr = thresholds || DEFAULT_THRESHOLDS;
  const table = thr.radTargetJPerCm2 || {};
  if (culture && table[culture] != null) return table[culture];
  return table.default != null ? table.default : 120;
}

/**
 * Integrate hourly radiation (W/m²) between two minutes-of-day, returning J/cm².
 *
 * Conversion: 1 W/m² × 1 sec = 1 J/m² ; 1 J/m² = 0.0001 J/cm² → wPerM2 × seconds × 1e-4 = J/cm²
 *
 * @param {Array<number|null>} hourlyW   24-element array, value at index h is mean W/m² for [h, h+1)
 * @param {number} fromMin               minutes from midnight (inclusive)
 * @param {number} toMin                 minutes from midnight (exclusive)
 * @returns {number}                     J/cm²
 */
function integrateRadiation(hourlyW, fromMin, toMin) {
  if (!Array.isArray(hourlyW) || hourlyW.length === 0) return 0;
  if (!Number.isFinite(fromMin) || !Number.isFinite(toMin) || toMin <= fromMin) return 0;
  let total = 0;
  const fromH = Math.floor(fromMin / 60);
  const toH = Math.min(23, Math.floor((toMin - 1) / 60));
  for (let h = fromH; h <= toH; h++) {
    const w = hourlyW[h];
    if (!Number.isFinite(w) || w <= 0) continue;
    const overlapStart = Math.max(fromMin, h * 60);
    const overlapEnd = Math.min(toMin, (h + 1) * 60);
    const overlapMin = Math.max(0, overlapEnd - overlapStart);
    if (overlapMin === 0) continue;
    // wPerM2 × seconds × 1e-4 = J/cm²
    total += w * (overlapMin * 60) * 1e-4;
  }
  return Math.round(total * 100) / 100;
}

/**
 * Predict when the next pulse will hit a target J/cm² accumulation, given
 * an hourly forecast.
 *
 * @param {Array<number|null>} hourlyW
 * @param {number} fromMin                 starting minute (last pulse time)
 * @param {number} targetJ                 desired J/cm² to accumulate
 * @returns {{etaMin: number|null, etaTime: string|null, totalJ: number}}
 */
function predictNextPulseTime(hourlyW, fromMin, targetJ) {
  if (!Array.isArray(hourlyW) || hourlyW.length === 0 || !Number.isFinite(fromMin) || !Number.isFinite(targetJ)) {
    return { etaMin: null, etaTime: null, totalJ: 0 };
  }
  let acc = 0;
  // Walk minute by minute (cheap, 1440 max). Stop at end of day.
  for (let m = Math.max(0, Math.floor(fromMin)); m < 24 * 60; m++) {
    const h = Math.floor(m / 60);
    const w = hourlyW[h];
    if (Number.isFinite(w) && w > 0) {
      // J/cm² accumulated in 1 minute = w × 60 × 1e-4
      acc += w * 60 * 1e-4;
    }
    if (acc >= targetJ) {
      const hh = Math.floor(m / 60);
      const mm = m % 60;
      return {
        etaMin: m,
        etaTime: String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'),
        totalJ: Math.round(acc * 100) / 100,
      };
    }
  }
  return { etaMin: null, etaTime: null, totalJ: Math.round(acc * 100) / 100 };
}

/**
 * Aggregate full-day radiation (J/cm²) from sunrise to sunset.
 * @param {Array<number|null>} hourlyW
 * @param {number} sunriseMin
 * @param {number} sunsetMin
 * @returns {number}
 */
function dailyRadiationTotal(hourlyW, sunriseMin, sunsetMin) {
  return integrateRadiation(hourlyW, sunriseMin || 0, sunsetMin || 24 * 60);
}

/**
 * Build radiation-based recommendations for a daily summary.
 * Skips silently if the summary lacks RadSum enrichment (no weather data).
 *
 * Rules:
 *   PULSE_TOO_EARLY                — last pulse fired with RadSum < 60% of target
 *   PULSE_TOO_LATE                 — last pulse fired with RadSum > 180% of target
 *   LOW_RAD_DAY_OVER_IRRIGATED     — total radiation low + many pulses
 *
 * @param {import('./types').DailyIrrigationSummary} summary
 * @param {Object} [parcelleMeta]   { culture }
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @returns {import('./types').IrrigationRecommendation[]}
 */
function buildRadiationRecommendations(summary, parcelleMeta, thresholds) {
  const thr = thresholds || DEFAULT_THRESHOLDS;
  if (!summary || !Array.isArray(summary.pulses) || summary.pulses.length === 0) return [];
  const culture = (parcelleMeta && parcelleMeta.culture) || null;
  const target = getRadiationTarget(culture, thr);
  /** @type {import('./types').IrrigationRecommendation[]} */
  const recos = [];

  // Last pulse signal — most actionable for next decision
  const lastPulse = summary.pulses[summary.pulses.length - 1];
  if (Number.isFinite(lastPulse.radSumSincePreviousPulse) && lastPulse.radSumSincePreviousPulse > 0) {
    const ratio = lastPulse.radSumSincePreviousPulse / target;
    if (ratio < thr.radTooEarlyRatio) {
      recos.push({
        level: 'warning',
        code: 'PULSE_TOO_EARLY',
        title: 'Pulse trop fréquent pour la radiation reçue',
        message: `RadSum ${lastPulse.radSumSincePreviousPulse.toFixed(0)} J/cm² (cible ${target} pour ${culture || 'cette culture'})`,
        rationale: 'La plante n\'a pas eu le temps de transpirer assez : substrat trop arrosé, racines en manque d\'air.',
        suggestedAction: `Espace davantage les pulses : attends d'avoir cumulé au moins ${Math.round(target * 0.8)} J/cm² avant le suivant.`,
      });
    } else if (ratio > thr.radTooLateRatio) {
      recos.push({
        level: 'warning',
        code: 'PULSE_TOO_LATE',
        title: 'Pulse tardif — plante probablement en stress',
        message: `RadSum ${lastPulse.radSumSincePreviousPulse.toFixed(0)} J/cm² (cible ${target})`,
        rationale: 'La plante a transpiré beaucoup avant ce pulse : déficit hydrique probable, fermeture stomatique.',
        suggestedAction: `Rapproche les pulses : déclenche autour de ${target} J/cm² au lieu d'attendre.`,
      });
    }
  }

  // Low-radiation day check (cloudy) — over-irrigation risk
  if (summary.dailyRadJPerCm2 != null && summary.dailyRadJPerCm2 < thr.lowRadDayJPerCm2 && summary.pulseCount >= 6) {
    recos.push({
      level: 'info',
      code: 'LOW_RAD_DAY_OVER_IRRIGATED',
      title: 'Jour à faible radiation — programme inchangé',
      message: `Radiation journalière ${summary.dailyRadJPerCm2.toFixed(0)} J/cm² (faible) avec ${summary.pulseCount} pulses`,
      rationale: 'Jour gris : la plante consomme moins. Garder le programme du beau temps mène à de la surirrigation systémique.',
      suggestedAction: 'Réduis le nombre de pulses de 20–30 % les jours nuageux.',
    });
  }

  return recos;
}

module.exports = {
  getRadiationTarget,
  integrateRadiation,
  predictNextPulseTime,
  dailyRadiationTotal,
  buildRadiationRecommendations,
};
