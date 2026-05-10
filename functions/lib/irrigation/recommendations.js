const { DEFAULT_THRESHOLDS } = require('./thresholds');
const { getPulseVolumeTarget } = require('./parcelleMeta');

/**
 * Build actionable recommendations from a DailyIrrigationSummary.
 *
 * Rules (V1, all explainable):
 *   R1  REDUCE_NEXT_PULSE        — repeated high-drain pulses (≥ N)
 *   R2  REDUCE_NEXT_PULSE_HARD   — total drain critical (>severe threshold)
 *   R3  INCREASE_INPUT           — repeated low-drain pulses (≥ N)
 *   R4  SALT_ACCUMULATION_RISK   — ΔEC > ecDeltaHigh AND drainage faible
 *   R5  STOP_EARLIER             — late-day pulse(s) with high drainage
 *   R6  PH_DRAIN_HIGH            — avg pH drain > phMax
 *   R7  PH_DRAIN_LOW             — avg pH drain < phMin
 *   R0  OPTIMAL                  — none of the above
 *
 * Returned recos are sorted highest level first (critical→ok).
 *
 * @param {import('./types').DailyIrrigationSummary} summary
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @param {Object} [parcelleMeta]   { culture, potVolumeL, substrate, variete }
 * @returns {import('./types').IrrigationRecommendation[]}
 */
function buildRecommendations(summary, thresholds, parcelleMeta) {
  const thr = thresholds || DEFAULT_THRESHOLDS;
  if (!summary || typeof summary !== 'object') return [];

  /** @type {import('./types').IrrigationRecommendation[]} */
  const recos = [];

  const {
    totalDrainPct,
    avgEcPts,
    avgEcDrain,
    avgPhDrain,
    highDrainPulseCount,
    lowDrainPulseCount,
    pulses,
    pulseCount,
  } = summary;

  // R2 — critical over-drain takes precedence
  if (totalDrainPct !== null && totalDrainPct > thr.severeHighDrainPct) {
    recos.push({
      level: 'critical',
      code: 'REDUCE_NEXT_PULSE_HARD',
      title: 'Drainage critique — réduire fortement',
      message: `Drainage total ${totalDrainPct.toFixed(1)}% (>${thr.severeHighDrainPct}%)`,
      rationale:
        'Drainage très excessif : gaspillage d\'eau majeur, lessivage des nutriments, possible asphyxie racinaire.',
      suggestedAction: 'Réduire le prochain pulse de 25–35% ou raccourcir significativement la durée. Vérifier la programmation.',
    });
  } else if (highDrainPulseCount >= thr.consecutiveHighDrainCount) {
    // R1 — repeated high-drain
    recos.push({
      level: 'warning',
      code: 'REDUCE_NEXT_PULSE',
      title: 'Réduire le prochain pulse',
      message: `${highDrainPulseCount} pulses avec drainage > ${thr.highDrainPct}%`,
      rationale: 'Drainage répétitivement élevé — gaspillage et lessivage progressif des sels nutritifs.',
      suggestedAction: 'Réduire le volume du prochain pulse de 10–20% ou raccourcir la durée de 1–2 minutes.',
    });
  }

  // R3 — repeated low-drain
  if (lowDrainPulseCount >= thr.consecutiveLowDrainCount) {
    recos.push({
      level: 'warning',
      code: 'INCREASE_INPUT',
      title: 'Augmenter l\'apport',
      message: `${lowDrainPulseCount} pulses avec drainage < ${thr.lowDrainPct}%`,
      rationale: 'Drainage insuffisant — risque de stress hydrique et d\'accumulation saline dans le substrat.',
      suggestedAction: 'Augmenter le volume ou la durée des prochains pulses de 10–15% pour atteindre ' +
        `${thr.targetDrainMinPct}–${thr.targetDrainMaxPct}% de drainage.`,
    });
  }

  // R4 — salt accumulation risk
  const ecDelta =
    Number.isFinite(avgEcDrain) && Number.isFinite(avgEcPts) ? avgEcDrain - avgEcPts : null;
  if (
    ecDelta !== null &&
    ecDelta > thr.ecDeltaHigh &&
    totalDrainPct !== null &&
    totalDrainPct < thr.targetDrainMaxPct
  ) {
    recos.push({
      level: 'warning',
      code: 'SALT_ACCUMULATION_RISK',
      title: 'Risque d\'accumulation saline',
      message: `ΔEC ${ecDelta.toFixed(2)} mS/cm avec drainage ${totalDrainPct.toFixed(1)}%`,
      rationale: 'EC du drainage nettement supérieure à l\'apport tandis que le drainage reste faible : les sels s\'accumulent dans le pot.',
      suggestedAction: `Augmenter le drainage à ${thr.targetDrainMinPct}–${thr.targetDrainMaxPct}% pour lessiver le substrat.`,
    });
  }

  // R20 / R21 — pulse volume vs container size (Driscoll Rule 5)
  // Skips silently for soil-grown parcelles (potVolumeL is null) or when
  // we don't know the parcelle.
  if (parcelleMeta && Number.isFinite(parcelleMeta.potVolumeL) && parcelleMeta.potVolumeL > 0
      && Number.isFinite(summary.totalInputMl) && summary.pulseCount > 0) {
    const avgPulseMl = summary.totalInputMl / summary.pulseCount;
    const potMl = parcelleMeta.potVolumeL * 1000;
    const pulsePct = (avgPulseMl / potMl) * 100;
    const target = getPulseVolumeTarget(parcelleMeta.culture);
    if (pulsePct > target.warnHighPct) {
      recos.push({
        level: 'warning',
        code: 'PULSE_VOLUME_TOO_HIGH',
        title: 'Volume par pulse trop élevé',
        message: `${avgPulseMl.toFixed(0)} mL/pulse = ${pulsePct.toFixed(1)} % du pot ${parcelleMeta.potVolumeL} L (cible ${target.lowPct}–${target.highPct} %)`,
        rationale: `Driscoll : pour ${parcelleMeta.culture}, viser ${target.lowPct}–${target.highPct} % du volume pot par cycle. Au-delà de ${target.warnHighPct} %, gaspillage et lessivage.`,
        suggestedAction: `Réduis la durée du pulse pour viser ${Math.round(potMl * target.lowPct / 100)}–${Math.round(potMl * target.highPct / 100)} mL/pulse. Au lieu d'un gros pulse, fractionne en plusieurs petits.`,
      });
    } else if (pulsePct < target.warnLowPct && parcelleMeta.potVolumeL >= 5) {
      recos.push({
        level: 'info',
        code: 'PULSE_VOLUME_TOO_LOW',
        title: 'Volume par pulse trop faible',
        message: `${avgPulseMl.toFixed(0)} mL/pulse = ${pulsePct.toFixed(1)} % du pot ${parcelleMeta.potVolumeL} L (cible ${target.lowPct}–${target.highPct} %)`,
        rationale: `Pulse trop petit pour mouiller toute la motte — risque de zones sèches dans le substrat (Driscoll Rule 5).`,
        suggestedAction: `Augmente la durée du pulse pour viser ${Math.round(potMl * target.lowPct / 100)}–${Math.round(potMl * target.highPct / 100)} mL/pulse minimum.`,
      });
    }
  }

  // R13 — first morning drip drained (Driscoll Rule 4)
  if (summary.firstPulseDrained) {
    recos.push({
      level: 'warning',
      code: 'FIRST_DRIP_RUNOFF',
      title: 'Premier pulse a drainé — anormal',
      message: `1er pulse à ${summary.firstPulseDrainPct.toFixed(0)} % de drainage (cible 0)`,
      rationale: 'Le premier pulse du matin ne devrait pas drainer : soit il a été déclenché trop tôt, soit la consigne d\'hier était trop généreuse (substrat encore saturé au réveil).',
      suggestedAction: 'Décale le 1er pulse de 30-60 min plus tard ET/OU réduis le volume total de la journée précédente. Le drainage doit démarrer au 2e pulse, pas au 1er.',
    });
  }

  // R14 — no run-off at all (Driscoll Rule 3 strict)
  if (summary.noRunoffAllDay) {
    recos.push({
      level: 'warning',
      code: 'NO_DRIP_RUNOFF_AT_ALL',
      title: 'Aucun pulse n\'a drainé sur la journée',
      message: `${summary.pulseCount} pulses, drainage cumulé ${summary.totalDrainPct != null ? summary.totalDrainPct.toFixed(0) : 0} %`,
      rationale: 'Sans drainage, les sels s\'accumulent et certaines zones du substrat restent sèches. Chaque pulse doit produire un peu de run-off (2-30 %).',
      suggestedAction: 'Augmente la durée des pulses (+30 % à +50 %) jusqu\'à voir apparaître au moins 5-10 % de drainage.',
    });
  }

  // R8 — intra-day rising drainage trend (substrate saturating over the day)
  // More actionable than R1 because it can name the time at which to ease off.
  const trend = summary.drainTrend;
  if (
    trend &&
    trend.slopePctPerHour >= thr.drainTrendRisingPctPerHour &&
    trend.endPct >= thr.highDrainPct
  ) {
    const fromTime = trend.firstHighDrainTime;
    recos.push({
      level: 'warning',
      code: 'DRAIN_TREND_RISING',
      title: 'Drainage en hausse sur la journée',
      message: `Drainage prédit ${trend.startPct.toFixed(0)}% → ${trend.endPct.toFixed(0)}% (+${trend.slopePctPerHour.toFixed(1)} pp/h)`,
      rationale: 'Substrat progressivement saturé : matin OK, dérive l\'après-midi. Réduire uniformément masquerait que le matin est correct.',
      suggestedAction: fromTime
        ? `Garde le programme du matin. Réduis -10 à -15% à partir du pulse de ${fromTime}.`
        : 'Garde le programme du matin. Réduis -10 à -15% sur les pulses de l\'après-midi.',
    });
  }

  // R5 — late-day high drain
  const lateHigh = (Array.isArray(pulses) ? pulses : []).filter(p => p.isLateDayPulse && p.isHighDrain);
  if (lateHigh.length > 0) {
    recos.push({
      level: 'warning',
      code: 'STOP_EARLIER',
      title: 'Arrêter plus tôt en fin de journée',
      message: `${lateHigh.length} pulse(s) tardif(s) avec drainage élevé`,
      rationale: 'Surirrigation après ' + thr.lateDayHour + 'h : substrat saturé toute la nuit, risque pour la racine.',
      suggestedAction: `Décaler ou supprimer les derniers pulses, viser une fin d\'irrigation avant ${thr.lateDayHour}h00.`,
    });
  }

  // R6 / R7 — pH excursions
  if (Number.isFinite(avgPhDrain)) {
    if (avgPhDrain > thr.phMax) {
      recos.push({
        level: 'info',
        code: 'PH_DRAIN_HIGH',
        title: 'pH drainage élevé',
        message: `pH drain ${avgPhDrain.toFixed(2)} (>${thr.phMax})`,
        rationale: 'Substrat alcalin — micro-nutriments (Fe, Mn) moins disponibles.',
        suggestedAction: 'Augmenter légèrement l\'acide dans la solution nutritive.',
      });
    } else if (avgPhDrain < thr.phMin) {
      recos.push({
        level: 'info',
        code: 'PH_DRAIN_LOW',
        title: 'pH drainage acide',
        message: `pH drain ${avgPhDrain.toFixed(2)} (<${thr.phMin})`,
        rationale: 'Substrat trop acide — risque de toxicité Al/Mn.',
        suggestedAction: 'Réduire l\'acide ou utiliser une base ponctuelle.',
      });
    }
  }

  // R0 — fallback OK
  if (recos.length === 0 && pulseCount > 0) {
    recos.push({
      level: 'ok',
      code: 'OPTIMAL',
      title: 'Paramètres optimaux',
      message: 'Aucune anomalie détectée',
      rationale: 'Drainage, EC et pH dans les plages cibles.',
      suggestedAction: 'Continuer le programme actuel.',
    });
  }

  // Sort: critical -> warning -> info -> ok
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  recos.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  return recos;
}

module.exports = { buildRecommendations };
