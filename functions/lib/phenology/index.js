/**
 * Phenology Engine — public barrel.
 *
 * Pipeline (composable):
 *   raw radiation samples → estimateMissingRadiation → calculateDailyRadsum → evaluateDliVsTarget
 *   tMin, tMax            → calculateDailyGdd
 *   gddCumul, reference   → resolveStage → getIrrigationRecipe
 *
 * All transforms are pure. Firestore I/O lives in scripts/seed*.js (Sprint 1)
 * and lib/phenology/jobs/* (Sprint 2+) — never inside this barrel's modules.
 *
 * Source of truth: phenology-tables.md, kpi-tables.md, brief-claude-code-addendum-v2.1.md.
 */

const gddCalculator = require('./gddCalculator');
const radsumCalculator = require('./radsumCalculator');
const stageResolver = require('./stageResolver');
const irrigationRecipe = require('./irrigationRecipe');

module.exports = {
  // GDD
  calculateDailyGdd: gddCalculator.calculateDailyGdd,

  // RADSUM / DLI
  calculateDailyRadsum: radsumCalculator.calculateDailyRadsum,
  estimateMissingRadiation: radsumCalculator.estimateMissingRadiation,
  evaluateDliVsTarget: radsumCalculator.evaluateDliVsTarget,

  // Stage resolution
  resolveStage: stageResolver.resolveStage,

  // Irrigation recipe
  getIrrigationRecipe: irrigationRecipe.getIrrigationRecipe,
};
