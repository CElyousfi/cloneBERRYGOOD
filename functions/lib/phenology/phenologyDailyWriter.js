/**
 * phenologyDailyWriter.js — T5
 *
 * Écrit le doc Firestore `plots/{plotId}/phenology_daily/{date}` au schéma
 * brief addendum-v2.1 §1.3 + met à jour les états courants dans
 * `plots/{plotId}.phenology.*`.
 *
 * Pure writer. Pas de calculs — toute la logique de cumul/stage/recipe
 * est faite en amont par `dailyPhenologyJob` (T6). T5 ne fait que :
 *   - détecter une transition de stage en comparant currentStage vs previousStage
 *   - calculer daysInStage (reset à 1 si transition, sinon previous + 1)
 *   - construire le doc complet selon le schéma B2
 *   - écrire (overwrite simple — décision Sprint 2 P2)
 *   - mettre à jour les états courants du plot
 *
 * Pattern DI strict pour Firestore I/O.
 */

/**
 * @typedef {import('./types').DataQuality} DataQuality
 * @typedef {import('./types').IrrigationRecipe} IrrigationRecipe
 * @typedef {import('./types').DliStatus} DliStatus
 */

/**
 * @typedef {Object} ComputedData
 * Tous les calculs déjà faits par T6. T5 ne recalcule rien.
 *
 * @property {number|null} gddDay
 * @property {number} gddCumul
 * @property {number|null} radsumDay
 * @property {number} radsumCumul
 * @property {number|null} dliDay
 * @property {number} dliCumul
 * @property {{code:string, name?:string, criticalStage?:boolean}} currentStage
 * @property {string|null} previousStage          code du stage J-1 (null si premier run)
 * @property {number} previousDaysInStage          0 si premier run
 * @property {number|null} tMin
 * @property {number|null} tMax
 * @property {number|null} [tMaxCapped]
 * @property {number|null} [radiationMaxWm2]
 * @property {number|null} [parMaxUmolM2s]
 * @property {IrrigationRecipe|null} [irrigationRecipe]
 * @property {DliStatus|null} [dliVsTarget]
 * @property {DataQuality} dataQuality
 * @property {Object} dataSources
 * @property {number} [computedAt]               epoch ms (default Date.now)
 * @property {Object} [_meta]                     jobVersion, mode
 */

/**
 * @typedef {Object} PhenologyDailyWriterDeps
 * @property {(plotId:string, date:string, doc:object) => Promise<void>} writeDoc
 *   Écrit/overwrite `plots/{plotId}/phenology_daily/{date}`.
 * @property {(plotId:string, partialPhenology:object) => Promise<void>} updatePlotPhenologyState
 *   Merge-update `plots/{plotId}.phenology.*` avec les champs fournis.
 */

/**
 * Écrit phenology_daily/{plotId}/{date} et met à jour plot.phenology.*.
 *
 * @param {string} plotId
 * @param {string} date                  "YYYY-MM-DD"
 * @param {ComputedData} computedData
 * @param {PhenologyDailyWriterDeps} deps
 * @returns {Promise<{written:boolean, transitionDetected:boolean, daysInStage:number}>}
 */
async function writePhenologyDaily(plotId, date, computedData, deps) {
  // Validation
  if (typeof plotId !== "string" || !plotId) {
    throw new TypeError("writePhenologyDaily: plotId required");
  }
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError("writePhenologyDaily: date must be YYYY-MM-DD");
  }
  if (!computedData || typeof computedData !== "object") {
    throw new TypeError("writePhenologyDaily: computedData required");
  }
  if (!computedData.currentStage || typeof computedData.currentStage.code !== "string") {
    throw new TypeError("writePhenologyDaily: computedData.currentStage.code required");
  }
  if (!computedData.dataQuality) {
    throw new TypeError("writePhenologyDaily: computedData.dataQuality required");
  }
  if (!computedData.dataSources) {
    throw new TypeError("writePhenologyDaily: computedData.dataSources required");
  }
  if (!deps || typeof deps.writeDoc !== "function" || typeof deps.updatePlotPhenologyState !== "function") {
    throw new TypeError("writePhenologyDaily: deps.writeDoc + deps.updatePlotPhenologyState required");
  }

  // Détection transition + daysInStage
  const previousStage = computedData.previousStage || null;
  const previousDaysInStage = typeof computedData.previousDaysInStage === "number" ? computedData.previousDaysInStage : 0;
  const transitionDetected = previousStage != null && previousStage !== computedData.currentStage.code;
  const daysInStage = transitionDetected ? 1 : previousDaysInStage + 1;

  if (transitionDetected) {
    console.log(`[phenology] Stage transition detected: plot=${plotId} ${previousStage} → ${computedData.currentStage.code}${computedData.currentStage.criticalStage ? " (CRITICAL)" : ""}`);
  }

  // Build doc selon schéma B2
  const computedAt = computedData.computedAt || Date.now();
  const doc = {
    date,
    dataSources: computedData.dataSources,
    tMin: computedData.tMin,
    tMax: computedData.tMax,
    tMaxCapped: computedData.tMaxCapped != null ? computedData.tMaxCapped : null,
    radiationMaxWm2: computedData.radiationMaxWm2 != null ? computedData.radiationMaxWm2 : null,
    parMaxUmolM2s: computedData.parMaxUmolM2s != null ? computedData.parMaxUmolM2s : null,
    gddDay: computedData.gddDay,
    radsumDayMjM2: computedData.radsumDay,
    dliDayMolM2: computedData.dliDay,
    gddCumul: computedData.gddCumul,
    radsumCumulMjM2: computedData.radsumCumul,
    dliCumulMolM2: computedData.dliCumul,
    stage: {
      code: computedData.currentStage.code,
      name: computedData.currentStage.name || null,
      criticalStage: !!computedData.currentStage.criticalStage,
    },
    daysInStage,
    irrigationRecipe: computedData.irrigationRecipe || null,
    dliVsTarget: computedData.dliVsTarget || null,
    dataQuality: computedData.dataQuality,
    stageTransition: transitionDetected
      ? { from: previousStage, to: computedData.currentStage.code, criticalStage: !!computedData.currentStage.criticalStage }
      : null,
    computedAt,
    _meta: computedData._meta || { jobVersion: "sprint2-v1", mode: "production" },
  };

  // Écriture (overwrite simple — décision Sprint 2 P2)
  await deps.writeDoc(plotId, date, doc);

  // Mise à jour plot.phenology.*
  // NB: on n'updates pas currentStage si dataQuality='unavailable' ET gddDay=null,
  // car on garde la valeur précédente (cf. décision T6 — pas de progression sans data).
  // Sinon (data ok ou fallback), on met à jour normalement.
  const plotStateUpdate = {
    "phenology.currentStage": computedData.currentStage.code,
    "phenology.gddCumul": computedData.gddCumul,
    "phenology.gddDayLast": computedData.gddDay != null ? computedData.gddDay : 0,
    "phenology.radsumCumul": computedData.radsumCumul,
    "phenology.radsumDayLast": computedData.radsumDay != null ? computedData.radsumDay : 0,
    "phenology.dliCumul": computedData.dliCumul,
    "phenology.dliDayLast": computedData.dliDay != null ? computedData.dliDay : 0,
    "phenology.daysInStage": daysInStage,
    "phenology.lastCalculation": computedAt,
  };

  await deps.updatePlotPhenologyState(plotId, plotStateUpdate);

  return { written: true, transitionDetected, daysInStage };
}

module.exports = {
  writePhenologyDaily,
};
