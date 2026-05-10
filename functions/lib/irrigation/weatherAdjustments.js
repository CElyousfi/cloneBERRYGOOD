/**
 * Weather-conditioned recommendations.
 *
 * Inputs are forward-looking: a forecast object for *today* (or the next
 * action day) plus the most recent DailyIrrigationSummary so we can adapt
 * urgency to current substrate state. Pure function — caller fetches the
 * weather and does the wiring.
 *
 * Forecast shape (matches `fetchMeteoForecast7d` in functions/index.js):
 *   { date, tmax, tmin, humidity, wind, precip, eto, radiation }
 */

const { DEFAULT_THRESHOLDS } = require('./thresholds');

/**
 * Rules (V1):
 *   W1  WEATHER_HEAT_BOOST       — tmax ≥ heatTmax
 *   W2  HIGH_ETO_FORECAST        — eto ≥ highEto
 *   W3  RAIN_FORECAST_REDUCE     — precip ≥ rainMm
 *   W4  DRY_AIR_STRESS           — humidity ≤ dryHumidity
 *
 * Severity is bumped one level when current diagnosis is already adverse:
 *   - heat or dry air + under-drain   → critical
 *   - rain                + over-drain → info (don't compound the problem)
 *
 * @param {Object|null} weather                today's (or next) forecast row
 * @param {import('./types').DailyIrrigationSummary|null} recentSummary
 * @param {import('./types').IrrigationThresholds} [thresholds]
 * @returns {import('./types').IrrigationRecommendation[]}
 */
function buildWeatherRecommendations(weather, recentSummary, thresholds) {
  if (!weather) return [];
  const thr = thresholds || DEFAULT_THRESHOLDS;
  const diag = recentSummary && recentSummary.diagnosis;

  /** @type {import('./types').IrrigationRecommendation[]} */
  const recos = [];

  // W1 — heat
  if (Number.isFinite(weather.tmax) && weather.tmax >= thr.weatherHeatTmax) {
    const compounded = diag === 'under-drain';
    recos.push({
      level: compounded ? 'critical' : 'warning',
      code: 'WEATHER_HEAT_BOOST',
      title: 'Forte chaleur prévue',
      message: `T° max ${weather.tmax.toFixed(0)}°C${compounded ? ' + drainage déjà insuffisant' : ''}`,
      rationale: 'Demande évapotranspiratoire élevée — risque de stress hydrique racinaire, particulièrement aux heures chaudes.',
      suggestedAction: compounded
        ? `Priorité haute : augmente l'apport +20 % ET ajoute un pulse de soulagement entre 13 h et ${thr.lateDayHour} h.`
        : `Augmente l'apport de +10 à 15 % et fractionne (un pulse supplémentaire avant ${thr.lateDayHour} h).`,
    });
  }

  // W2 — high ETo
  if (Number.isFinite(weather.eto) && weather.eto >= thr.weatherHighEto) {
    const overshoot = weather.eto - thr.weatherHighEto;
    const boostPct = Math.round(Math.min(20, 5 + overshoot * 5));
    recos.push({
      level: 'warning',
      code: 'HIGH_ETO_FORECAST',
      title: 'Demande hydrique élevée',
      message: `ETo prévue ${weather.eto.toFixed(1)} mm/j (seuil ${thr.weatherHighEto})`,
      rationale: 'L\'évapotranspiration de référence est haute — la plante consomme plus que d\'habitude.',
      suggestedAction: `Augmente le volume total apporté de +${boostPct} % aujourd'hui pour compenser.`,
    });
  }

  // W3 — rain (UI must remind: tunnel vs plein champ)
  if (Number.isFinite(weather.precip) && weather.precip >= thr.weatherRainMm) {
    const overDrained = diag === 'over-drain' || diag === 'critical';
    recos.push({
      level: overDrained ? 'warning' : 'info',
      code: 'RAIN_FORECAST_REDUCE',
      title: 'Pluie prévue',
      message: `${weather.precip.toFixed(1)} mm prévus${overDrained ? ' — drainage déjà élevé' : ''}`,
      rationale: 'En plein champ, la pluie réduit le besoin direct. Sous tunnel, l\'effet est très limité (humidité de l\'air seulement).',
      suggestedAction: overDrained
        ? 'Plein champ : supprime 1 pulse aujourd\'hui. Tunnel : réduis -10 à -15 % par sécurité.'
        : 'Plein champ : réduis -30 à -50 % ou supprime 1 pulse. Tunnel : ne pas modifier.',
    });
  }

  // W4 — dry air
  if (Number.isFinite(weather.humidity) && weather.humidity <= thr.weatherDryHumidity) {
    const compounded = diag === 'under-drain';
    recos.push({
      level: compounded ? 'warning' : 'info',
      code: 'DRY_AIR_STRESS',
      title: 'Air très sec',
      message: `Humidité prévue ${Math.round(weather.humidity)} %`,
      rationale: 'Stress hydrique aérien, transpiration accélérée — la fréquence d\'irrigation compte plus que le volume.',
      suggestedAction: 'Fractionne en pulses plus courts mais plus rapprochés (intervalle -30 %). Vérifie la brumisation si disponible.',
    });
  }

  // Severity sort
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  recos.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  return recos;
}

module.exports = { buildWeatherRecommendations };
