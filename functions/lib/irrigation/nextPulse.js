/**
 * Operator-facing "next-pulse" recommendation.
 *
 * Designed for the stationnaire who just saved a pulse and needs ONE clear
 * action: continue / wait longer / shorter / longer / stop. Returns:
 *   - status              "ok" | "info" | "warning" | "critical"
 *   - headline            single sentence to lead with
 *   - todayKpis           running totals + drain pct so far
 *   - nextAction          { label, detail }
 *   - whenNext            { minIntervalMin, suggestedTime, label }
 *
 * Pure function. The decision tree below is intentionally short and
 * mutually exclusive — the operator never sees more than one suggestion.
 */

const { DEFAULT_THRESHOLDS } = require('./thresholds');
const { getRadiationTarget, predictNextPulseTime } = require('./radiationStrategy');
const { getTransmittance } = require('./parcelleMeta');

/**
 * @param {import('./types').DailyIrrigationSummary|null} todaysSummary
 * @param {Object|null} weatherToday
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @returns {{
 *   status: "ok"|"info"|"warning"|"critical",
 *   headline: string,
 *   todayKpis: Object|null,
 *   nextAction: { label: string, detail: string },
 *   whenNext: { minIntervalMin: number|null, suggestedTime: string|null, label: string }
 * }}
 */
function recommendNextPulse(todaysSummary, weatherToday, thresholds, parcelleMeta) {
  const thr = thresholds || DEFAULT_THRESHOLDS;

  // Build a radiation-based "when next" hint when hourly forecast is available
  const buildWhenNext = (fromMin, defaultLabel, defaultMinInterval) => {
    if (weatherToday && Array.isArray(weatherToday.hourlyRadiation) && Number.isFinite(fromMin)) {
      const culture = (parcelleMeta && parcelleMeta.culture) || null;
      const target = getRadiationTarget(culture, thr);
      const transmittance = getTransmittance(parcelleMeta && parcelleMeta.greenhouseType, thr);
      const indoorTarget = target / Math.max(0.1, transmittance);
      const eta = predictNextPulseTime(weatherToday.hourlyRadiation, fromMin, indoorTarget);
      if (eta.etaTime) {
        const etaMinFromNow = Math.max(0, eta.etaMin - fromMin);
        return {
          minIntervalMin: etaMinFromNow,
          suggestedTime: eta.etaTime,
          label: `Prochain pulse vers ${eta.etaTime} (cible ${target} J/cm² accumulés)`,
        };
      }
    }
    return { minIntervalMin: defaultMinInterval, suggestedTime: null, label: defaultLabel };
  };

  if (!todaysSummary || !todaysSummary.pulses || todaysSummary.pulses.length === 0) {
    return {
      status: 'ok',
      headline: 'Pulse enregistré',
      todayKpis: null,
      nextAction: { label: 'Continuer le programme', detail: '' },
      whenNext: { minIntervalMin: 60, suggestedTime: null, label: 'Suivre le planning habituel' },
    };
  }

  const pulses = todaysSummary.pulses;
  const lastPulse = pulses[pulses.length - 1];
  const drainPct = todaysSummary.totalDrainPct;
  const lastDrain = lastPulse.drainPct;
  const ecDelta = lastPulse.ecDelta;

  const todayKpis = {
    pulseCount: pulses.length,
    cumulInputMl: todaysSummary.totalInputMl || 0,
    cumulDrainMl: todaysSummary.totalDrainMl || 0,
    drainPct: drainPct,
    avgEcPts: todaysSummary.avgEcPts,
    avgEcDrain: todaysSummary.avgEcDrain,
    avgPhPts: todaysSummary.avgPhPts,
    avgPhDrain: todaysSummary.avgPhDrain,
    lastPulseTime: lastPulse.heure,
  };

  // 1) Late-day stop: post-cutoff pulse with already-saturated substrate
  if (lastPulse.isLateDayPulse && drainPct != null && drainPct >= thr.targetDrainMaxPct) {
    return {
      status: 'critical',
      headline: 'Stop — plus d\'irrigation aujourd\'hui',
      todayKpis,
      nextAction: {
        label: 'Arrêter pour aujourd\'hui',
        detail: `Drainage cumulé ${drainPct.toFixed(0)} % après ${thr.lateDayHour} h — substrat saturé pour la nuit.`,
      },
      whenNext: { minIntervalMin: null, suggestedTime: null, label: 'Reprendre demain matin' },
    };
  }

  // 2) Critical drain on last pulse
  if (Number.isFinite(lastDrain) && lastDrain > thr.severeHighDrainPct) {
    return {
      status: 'critical',
      headline: 'Drainage critique sur ce pulse',
      todayKpis,
      nextAction: {
        label: 'Réduire durée -2 min',
        detail: `Pulse à ${lastDrain.toFixed(0)} % (>${thr.severeHighDrainPct} %) — gaspillage majeur, lessivage des nutriments.`,
      },
      whenNext: { minIntervalMin: 90, suggestedTime: null, label: 'Attendre au moins 90 min avant le prochain pulse' },
    };
  }

  // 3) High drain (>30%)
  if (lastPulse.isHighDrain) {
    return {
      status: 'warning',
      headline: 'Drainage élevé',
      todayKpis,
      nextAction: {
        label: 'Réduire durée -1 min au prochain pulse',
        detail: `Pulse à ${lastDrain.toFixed(0)} % (cible ${thr.targetDrainMinPct}–${thr.targetDrainMaxPct} %).`,
      },
      whenNext: { minIntervalMin: 60, suggestedTime: null, label: 'Attendre 60 min minimum' },
    };
  }

  // 4) Low drain (<15%)
  if (lastPulse.isLowDrain) {
    return {
      status: 'warning',
      headline: 'Drainage insuffisant',
      todayKpis,
      nextAction: {
        label: 'Augmenter durée +1 min au prochain pulse',
        detail: `Pulse à ${lastDrain.toFixed(0)} % — substrat pas assez lessivé, risque d'accumulation saline.`,
      },
      whenNext: { minIntervalMin: 45, suggestedTime: null, label: 'Prochain pulse dans ~45 min' },
    };
  }

  // 5) Salt accumulation signal (ΔEC high while drainage acceptable but not generous)
  if (
    Number.isFinite(ecDelta) && ecDelta > thr.ecDeltaHigh &&
    drainPct != null && drainPct < thr.targetDrainMaxPct
  ) {
    return {
      status: 'info',
      headline: 'Accumulation saline à surveiller',
      todayKpis,
      nextAction: {
        label: 'Surveille EC drain au prochain pulse',
        detail: `ΔEC ${ecDelta.toFixed(2)} mS/cm — sels qui montent. Si ça persiste, augmente le drainage.`,
      },
      whenNext: { minIntervalMin: 60, suggestedTime: null, label: 'Prochain pulse dans 1 h' },
    };
  }

  // 6) Late-day pulse but drainage controlled → just remind to stop soon
  if (lastPulse.isLateDayPulse) {
    return {
      status: 'info',
      headline: 'Pulse OK — fin de journée',
      todayKpis,
      nextAction: {
        label: 'Garde la durée actuelle',
        detail: `Pulse à ${lastDrain != null ? lastDrain.toFixed(0) + ' %' : '—'}, après ${thr.lateDayHour} h. Évite d'irriguer trop tard.`,
      },
      whenNext: {
        minIntervalMin: 60, suggestedTime: null,
        label: `Au plus 1 pulse de plus avant ${thr.lateDayHour + 2}h`,
      },
    };
  }

  // 7) Heat-wave forecast — keep duration but advise extra pulse
  if (weatherToday && Number.isFinite(weatherToday.tmax) && weatherToday.tmax >= thr.weatherHeatTmax) {
    return {
      status: 'info',
      headline: 'Pulse OK — chaleur prévue',
      todayKpis,
      nextAction: {
        label: 'Garde la durée, fractionne',
        detail: `T° max ${weatherToday.tmax.toFixed(0)} °C — un pulse de plus avant ${thr.lateDayHour} h aide à tenir.`,
      },
      whenNext: buildWhenNext(lastPulse.minutesFromMidnight, 'Prochain pulse dans 45 min', 45),
    };
  }

  // 8) Default: pulse OK — use radiation-based timing if available
  return {
    status: 'ok',
    headline: 'Pulse OK',
    todayKpis,
    nextAction: {
      label: 'Continuer le programme',
      detail: drainPct != null
        ? `Drainage cumulé ${drainPct.toFixed(0)} % — dans la cible ${thr.targetDrainMinPct}–${thr.targetDrainMaxPct} %.`
        : 'Continue selon le planning.',
    },
    whenNext: buildWhenNext(lastPulse.minutesFromMidnight, 'Prochain pulse dans 1 h', 60),
  };
}

/**
 * Build a trail of "what advice would have been given" at each pulse of
 * the day. Lets the responsable irrigation see the conseils stream that
 * the stationnaire received as pulses came in.
 *
 * @param {import('./types').DailyIrrigationSummary} summary
 * @param {Object|null} weatherToday
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @param {Object} [parcelleMeta]
 * @param {(pulses: import('./types').EnrichedIrrigationEvent[]) => import('./types').DailyIrrigationSummary} buildSubsetSummary
 * @returns {Array<{pulseIndex: number, heure: string|null, drainPct: number|null, radSum: number|null, advice: Object}>}
 */
function recommendPulseTrail(summary, weatherToday, thresholds, parcelleMeta, buildSubsetSummary) {
  if (!summary || !Array.isArray(summary.pulses) || summary.pulses.length === 0) return [];
  if (typeof buildSubsetSummary !== 'function') return [];
  const trail = [];
  for (let i = 0; i < summary.pulses.length; i++) {
    const subset = summary.pulses.slice(0, i + 1);
    const subSummary = buildSubsetSummary(subset);
    if (!subSummary) continue;
    const advice = recommendNextPulse(subSummary, weatherToday, thresholds, parcelleMeta);
    const last = subset[subset.length - 1];
    trail.push({
      pulseIndex: i,
      heure: last.heure,
      drainPct: last.drainPct,
      radSum: last.radSumSincePreviousPulse,
      advice: {
        status: advice.status,
        headline: advice.headline,
        actionLabel: advice.nextAction && advice.nextAction.label,
        actionDetail: advice.nextAction && advice.nextAction.detail,
        whenLabel: advice.whenNext && advice.whenNext.label,
      },
    });
  }
  return trail;
}

module.exports = { recommendNextPulse, recommendPulseTrail };
