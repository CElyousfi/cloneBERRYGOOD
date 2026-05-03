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

// =====================================================================
// Phenology references (minimal fixtures for stageResolver / irrigationRecipe tests)
// Real seed for Firestore lives in scripts/seedPhenologyReferences.js (T7).
// =====================================================================

/**
 * Minimal Maravilla primocane reference, values from phenology-tables.md §5.
 */
const MARAVILLA_PRIMOCANE = {
  varietyId: 'maravilla',
  cycleType: 'primocane',
  displayName: 'Maravilla — Primocane',
  tBase: 5,
  tCap: 30,
  precocityCoefficient: 1.0,
  stages: [
    { code: 'S0', name: 'Reprise / enracinement', gddMin: 0, gddMax: 150,
      irrigation: { ec_min: 1.2, ec_max: 1.4, ph_min: 5.6, ph_max: 5.8, drainage_pct_target: 12, drainage_pct_min: 10, drainage_pct_max: 15 },
      dli: { target_min: 8, target_max: 15, critical_min: 5, critical_max: 20, unit: 'mol/m²/j' } },
    { code: 'S1', name: 'Croissance végétative initiale', gddMin: 150, gddMax: 400,
      irrigation: { ec_min: 1.4, ec_max: 1.6, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 18, drainage_pct_min: 15, drainage_pct_max: 20 },
      dli: { target_min: 10, target_max: 18, critical_min: 6, critical_max: 25, unit: 'mol/m²/j' } },
    { code: 'S2', name: 'Croissance végétative active', gddMin: 400, gddMax: 800,
      irrigation: { ec_min: 1.6, ec_max: 1.8, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 22, drainage_pct_min: 20, drainage_pct_max: 25 },
      dli: { target_min: 15, target_max: 22, critical_min: 10, critical_max: 30, unit: 'mol/m²/j' } },
    { code: 'S3', name: 'Initiation florale', gddMin: 800, gddMax: 1100,
      irrigation: { ec_min: 1.8, ec_max: 2.0, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 28, drainage_pct_min: 25, drainage_pct_max: 30 },
      dli: { target_min: 18, target_max: 25, critical_min: 12, critical_max: 32, unit: 'mol/m²/j' } },
    { code: 'S4', name: 'Floraison', gddMin: 1100, gddMax: 1400, criticalStage: true,
      irrigation: { ec_min: 2.0, ec_max: 2.2, ph_min: 5.5, ph_max: 5.7, drainage_pct_target: 30, drainage_pct_min: 28, drainage_pct_max: 33 },
      dli: { target_min: 20, target_max: 28, critical_min: 15, critical_max: 35, unit: 'mol/m²/j' } },
    { code: 'S5', name: 'Nouaison / grossissement', gddMin: 1400, gddMax: 1700,
      irrigation: { ec_min: 2.0, ec_max: 2.2, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 32, drainage_pct_min: 30, drainage_pct_max: 35 },
      dli: { target_min: 20, target_max: 30, critical_min: 15, critical_max: 38, unit: 'mol/m²/j' } },
    { code: 'S6', name: 'Véraison / maturation', gddMin: 1700, gddMax: 2000,
      irrigation: { ec_min: 2.2, ec_max: 2.4, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 37, drainage_pct_min: 35, drainage_pct_max: 40 },
      dli: { target_min: 22, target_max: 30, critical_min: 16, critical_max: 40, unit: 'mol/m²/j' } },
    { code: 'S7', name: 'Pleine récolte', gddMin: 2000, gddMax: 3500,
      irrigation: { ec_min: 2.2, ec_max: 2.4, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 40, drainage_pct_min: 35, drainage_pct_max: 45 },
      dli: { target_min: 22, target_max: 30, critical_min: 16, critical_max: 40, unit: 'mol/m²/j' } },
    { code: 'S8', name: 'Fin de cycle', gddMin: 3500, gddMax: 9999,
      irrigation: { ec_min: 1.6, ec_max: 1.8, ph_min: 5.6, ph_max: 5.8, drainage_pct_target: 22, drainage_pct_min: 20, drainage_pct_max: 25 },
      dli: { target_min: 15, target_max: 25, critical_min: 8, critical_max: 35, unit: 'mol/m²/j' } },
  ],
  metadata: { version: '1.1.0', lastUpdated: '2026-05-03', source: 'fixtures', calibrationStatus: 'baseline' },
};

/**
 * Minimal Maravilla floricane reference, values from phenology-tables.md §6.
 */
const MARAVILLA_FLORICANE = {
  varietyId: 'maravilla',
  cycleType: 'floricane',
  displayName: 'Maravilla — Floricane',
  tBase: 5,
  tCap: 30,
  precocityCoefficient: 1.0,
  stages: [
    { code: 'F0', name: 'Débourrement', gddMin: 0, gddMax: 150,
      irrigation: { ec_min: 1.2, ec_max: 1.4, ph_min: 5.6, ph_max: 5.8, drainage_pct_target: 12, drainage_pct_min: 10, drainage_pct_max: 15 },
      dli: { target_min: 8, target_max: 15, critical_min: 5, critical_max: 20, unit: 'mol/m²/j' } },
    { code: 'F1', name: 'Croissance latérale', gddMin: 150, gddMax: 450,
      irrigation: { ec_min: 1.6, ec_max: 1.8, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 22, drainage_pct_min: 20, drainage_pct_max: 25 },
      dli: { target_min: 12, target_max: 22, critical_min: 8, critical_max: 28, unit: 'mol/m²/j' } },
    { code: 'F2', name: 'Boutons floraux', gddMin: 450, gddMax: 700,
      irrigation: { ec_min: 1.8, ec_max: 2.0, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 28, drainage_pct_min: 25, drainage_pct_max: 30 },
      dli: { target_min: 18, target_max: 25, critical_min: 12, critical_max: 32, unit: 'mol/m²/j' } },
    { code: 'F3', name: 'Floraison', gddMin: 700, gddMax: 1000, criticalStage: true,
      irrigation: { ec_min: 2.0, ec_max: 2.2, ph_min: 5.5, ph_max: 5.7, drainage_pct_target: 30, drainage_pct_min: 28, drainage_pct_max: 33 },
      dli: { target_min: 20, target_max: 28, critical_min: 15, critical_max: 35, unit: 'mol/m²/j' } },
    { code: 'F4', name: 'Nouaison / grossissement', gddMin: 1000, gddMax: 1300,
      irrigation: { ec_min: 2.0, ec_max: 2.2, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 32, drainage_pct_min: 30, drainage_pct_max: 35 },
      dli: { target_min: 20, target_max: 30, critical_min: 15, critical_max: 38, unit: 'mol/m²/j' } },
    { code: 'F5', name: 'Véraison / maturation', gddMin: 1300, gddMax: 1600,
      irrigation: { ec_min: 2.2, ec_max: 2.4, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 37, drainage_pct_min: 35, drainage_pct_max: 40 },
      dli: { target_min: 22, target_max: 30, critical_min: 16, critical_max: 40, unit: 'mol/m²/j' } },
    { code: 'F6', name: 'Pleine récolte', gddMin: 1600, gddMax: 2400,
      irrigation: { ec_min: 2.2, ec_max: 2.4, ph_min: 5.5, ph_max: 5.8, drainage_pct_target: 40, drainage_pct_min: 35, drainage_pct_max: 45 },
      dli: { target_min: 22, target_max: 30, critical_min: 16, critical_max: 40, unit: 'mol/m²/j' } },
    { code: 'F7', name: 'Fin de récolte', gddMin: 2400, gddMax: 9999,
      irrigation: { ec_min: 1.6, ec_max: 1.8, ph_min: 5.6, ph_max: 5.8, drainage_pct_target: 22, drainage_pct_min: 20, drainage_pct_max: 25 },
      dli: { target_min: 15, target_max: 25, critical_min: 8, critical_max: 35, unit: 'mol/m²/j' } },
  ],
  metadata: { version: '1.1.0', lastUpdated: '2026-05-03', source: 'fixtures', calibrationStatus: 'baseline' },
};

/**
 * Minimal Jasmin primocane reference (precocityCoefficient 0.92 vs Maravilla).
 * Same stage structure, only the precocity differs. Values from phenology-tables.md §7
 * (already pre-multiplied by 0.92, but we store the BASE values here and let the resolver
 *  apply the coefficient — that's how the real seed will work).
 *
 * Note: To keep the fixture useful for testing the coefficient application,
 * we deliberately store gddMin values BEFORE coefficient (same as Maravilla)
 * with precocityCoefficient = 0.92. The resolver applies the coef internally.
 */
const JASMIN_PRIMOCANE = {
  ...MARAVILLA_PRIMOCANE,
  varietyId: 'jasmin',
  displayName: 'Jasmin — Primocane',
  precocityCoefficient: 0.92,
};

module.exports = {
  DAY_START,
  sineDay,
  customSamples,
  MARAVILLA_PRIMOCANE,
  MARAVILLA_FLORICANE,
  JASMIN_PRIMOCANE,
};
