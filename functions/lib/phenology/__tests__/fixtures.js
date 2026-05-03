/**
 * Shared test fixtures for phenology module tests.
 *
 * Generators for synthetic radiation samples (sine-wave PAR/Radiation profiles)
 * to validate radsumCalculator without depending on real FarmRoad data.
 */

const DAY_START = Date.UTC(2026, 4, 1, 0, 0, 0); // 2026-05-01T00:00Z (epoch ms)

/**
 * Generate N samples evenly spaced over 24h with PAR following a sinusoidal
 * profile (peaks at noon, 0 outside [sunriseHour, sunsetHour]).
 *
 * Daily PAR integral for sin profile from sunrise to sunset, peak Pmax:
 *   ∫ Pmax × sin(π × (h - sunrise) / daylight) dh from sunrise to sunset
 *   = Pmax × daylight × (2/π)  µmol·hr/m²·s
 * Convert to mol/m²/j : × 3600 / 1e6 = × 0.0036
 * → DLI ≈ Pmax × daylight × 2 × 0.0036 / π ≈ Pmax × daylight × 0.002292
 *
 * Examples:
 *   peakPar=1000, daylight=12h → DLI ≈ 27.5 mol/m²/j  (sunny)
 *   peakPar=400,  daylight=12h → DLI ≈ 11.0 mol/m²/j  (cloudy)
 *
 * @param {Object} opts
 * @param {number} [opts.count=288]            Number of samples (288 = 5 min/24h)
 * @param {number} [opts.peakPar=1000]         Peak PAR µmol/m²/s at noon
 * @param {number} [opts.sunriseHour=6]
 * @param {number} [opts.sunsetHour=18]
 * @param {number} [opts.dayStartMs=DAY_START] Epoch ms of midnight start
 * @param {boolean} [opts.includeRadiation=true]  Compute radiationWm2 from PAR
 * @param {number} [opts.parToRadRatio=0.46]
 * @returns {import('../types').RadiationSample[]}
 */
function sineDay({
  count = 288,
  peakPar = 1000,
  sunriseHour = 6,
  sunsetHour = 18,
  dayStartMs = DAY_START,
  includeRadiation = true,
  parToRadRatio = 0.46,
} = {}) {
  const daylight = sunsetHour - sunriseHour;
  const stepMs = (24 * 3600 * 1000) / count;
  const W_PAR_TO_UMOL = 4.57;
  const samples = [];
  for (let i = 0; i < count; i++) {
    const ms = dayStartMs + i * stepMs;
    const hour = (ms - dayStartMs) / 3600000;
    let par = 0;
    if (hour >= sunriseHour && hour <= sunsetHour) {
      par = peakPar * Math.sin((Math.PI * (hour - sunriseHour)) / daylight);
    }
    const sample = { timestamp: ms, parUmolM2s: par };
    if (includeRadiation) {
      // PAR (µmol/m²/s) → W/m² PAR (÷ 4.57) → W/m² total (÷ ratio)
      sample.radiationWm2 = (par / W_PAR_TO_UMOL) / parToRadRatio;
    }
    samples.push(sample);
  }
  return samples;
}

/**
 * Build samples at fixed times with explicit PAR values (for trapezoidal
 * integration verification by hand).
 *
 * @param {Array<{tMin:number, par:number}>} entries  tMin = minutes from dayStart
 * @param {number} [dayStartMs=DAY_START]
 */
function customSamples(entries, dayStartMs = DAY_START) {
  return entries.map(({ tMin, par, rad }) => {
    const sample = { timestamp: dayStartMs + tMin * 60 * 1000 };
    if (par != null) sample.parUmolM2s = par;
    if (rad != null) sample.radiationWm2 = rad;
    return sample;
  });
}

module.exports = {
  DAY_START,
  sineDay,
  customSamples,
};
