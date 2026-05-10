const { parseHeure } = require('./utils');

/**
 * Convert a daily summary into a flat feature row suitable for a future
 * predictive model. Joins optional weather features. Pure function.
 *
 * Field naming:
 *   f_*       — input feature
 *   label_*   — supervised target candidate
 *
 * @param {import('./types').DailyIrrigationSummary} summary
 * @param {Object} [weather]   optional Meteoblue-shaped record for the day
 * @param {number} [weather.eto]
 * @param {number} [weather.tMax]
 * @param {number} [weather.tMin]
 * @param {number} [weather.humidity]
 * @param {number} [weather.precip]
 * @returns {import('./types').IrrigationFeatureRow|null}
 */
function buildFeatureRow(summary, weather) {
  if (!summary || !summary.date || !summary.parcelle) return null;

  const ecDelta =
    Number.isFinite(summary.avgEcDrain) && Number.isFinite(summary.avgEcPts)
      ? summary.avgEcDrain - summary.avgEcPts
      : null;

  return {
    date: summary.date,
    parcelle: summary.parcelle,
    ferme: summary.ferme,
    f_total_input_ml: summary.totalInputMl ?? null,
    f_total_drain_ml: summary.totalDrainMl ?? null,
    f_drain_pct: summary.totalDrainPct,
    f_ec_pts: summary.avgEcPts,
    f_ec_drain: summary.avgEcDrain,
    f_ec_delta: ecDelta,
    f_ph_pts: summary.avgPhPts,
    f_ph_drain: summary.avgPhDrain,
    f_pulse_count: summary.pulseCount,
    f_high_drain_count: summary.highDrainPulseCount,
    f_low_drain_count: summary.lowDrainPulseCount,
    f_cutoff_min: parseHeure(summary.irrigationCutoffTime),
    f_eto: weather && Number.isFinite(weather.eto) ? weather.eto : null,
    f_t_max: weather && Number.isFinite(weather.tMax) ? weather.tMax : null,
    f_t_min: weather && Number.isFinite(weather.tMin) ? weather.tMin : null,
    f_humidity: weather && Number.isFinite(weather.humidity) ? weather.humidity : null,
    f_precip: weather && Number.isFinite(weather.precip) ? weather.precip : null,
    label_diagnosis: summary.diagnosis,
  };
}

/**
 * Bulk variant. `weatherByDate` keys are "YYYY-MM-DD".
 * @param {import('./types').DailyIrrigationSummary[]} summaries
 * @param {Record<string, object>} [weatherByDate]
 * @returns {import('./types').IrrigationFeatureRow[]}
 */
function buildFeatureRows(summaries, weatherByDate) {
  if (!Array.isArray(summaries)) return [];
  return summaries
    .map(s => buildFeatureRow(s, weatherByDate ? weatherByDate[s.date] : undefined))
    .filter(Boolean);
}

module.exports = { buildFeatureRow, buildFeatureRows };
