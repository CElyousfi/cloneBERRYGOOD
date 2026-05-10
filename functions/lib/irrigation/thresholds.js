/**
 * Configurable thresholds driving signals & recommendations.
 * Defaults reflect Driscoll-style myrtille-in-pot baselines used by the team.
 * Override per call via getThresholds({ ... }) or per culture/variete later.
 */

/** @type {import('./types').IrrigationThresholds} */
const DEFAULT_THRESHOLDS = Object.freeze({
  lowDrainPct: 15,
  targetDrainMinPct: 15,
  targetDrainMaxPct: 25,
  highDrainPct: 30,
  severeHighDrainPct: 35,
  ecDeltaHigh: 0.4,
  phDrainHigh: 5.5,
  lateDayHour: 15,
  phMin: 5.0,
  phMax: 6.5,
  ecRatioHigh: 1.5,
  consecutiveHighDrainCount: 2,
  consecutiveLowDrainCount: 2,
  // Intra-day drainage trend
  drainTrendRisingPctPerHour: 1.5,    // slope >= this = rising trend
  minPulsesForTrend: 3,                // need at least N pulses to compute
  // Cross-day (period-level) trends
  ecDrainDriftMsCm: 0.4,               // total EC drain rise across the period
  sustainedOverDrainDays: 3,           // consecutive over-drain days to flag
  sustainedLowDrainDays: 3,
  drainInstabilityPct: 10,             // stddev (pp) above which we flag instability
  minDaysForPeriodTrend: 3,            // need at least N daily summaries
  // Weather-conditioned recommendations
  weatherHeatTmax: 32,                 // °C — heat-stress threshold
  weatherHighEto: 5.0,                 // mm/j — ETo demand threshold
  weatherRainMm: 5.0,                  // mm — significant precipitation
  weatherDryHumidity: 30,              // % — dry-air stress threshold
  // Driscoll's "Golden Rules" — drip patterning
  firstDripMaxDrainPct: 5,             // first morning drip should NOT drain (Rule 4)
  noRunoffAllDayMaxPct: 2,             // a pulse below this counts as "no runoff"
  noRunoffMinPulses: 3,                // need ≥ N pulses before flagging "no runoff at all"
  // Late-day cutoff — fallback if sunset unknown (Rule 1)
  sunsetCutoffOffsetMin: 120,          // stop irrigating sunsetMin - 120 min
  // Radiation-driven strategy (Driscoll Rule 6 — clustering)
  radTargetJPerCm2: {                  // target J/cm² accumulated per pulse
    Myrtille: 130,
    Framboise: 100,
    default: 120,
  },
  radTooEarlyRatio: 0.6,               // pulse fired before 60% of target J/cm² → too early
  radTooLateRatio: 1.8,                // pulse fired after 180% of target → too late
  // Outdoor → indoor radiation transmittance, per greenhouse type
  radTransmittanceByGreenhouseType: {
    tunnel: 0.65,                      // plastic tunnel — typical Driscoll baseline
    canarienne: 0.50,                  // canary-style greenhouse (wood + plastic + whitewash)
    open: 1.0,                         // plein champ
    default: 0.60,
  },
  radTunnelTransmittance: 0.6,         // legacy fallback — kept for back-compat
  lowRadDayJPerCm2: 800,               // low-radiation day total threshold (cloudy)
});

/**
 * Merge overrides on top of defaults. Always returns a fresh frozen object
 * to keep callers honest.
 * @param {Partial<import('./types').IrrigationThresholds>} [overrides]
 * @returns {import('./types').IrrigationThresholds}
 */
function getThresholds(overrides) {
  if (!overrides || typeof overrides !== 'object') return DEFAULT_THRESHOLDS;
  return Object.freeze({ ...DEFAULT_THRESHOLDS, ...overrides });
}

module.exports = { DEFAULT_THRESHOLDS, getThresholds };
