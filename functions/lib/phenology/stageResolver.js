/**
 * stageResolver.js — Resolve current phenology stage from cumulative GDD.
 *
 * Source : phenology-tables.md §4-8
 *
 * Pure function. Aucun I/O.
 *
 * Logique :
 *   - Chaque stade a un seuil bas `gddMin` (et un `gddMax` qui = gddMin du suivant).
 *   - Coefficient précocité : multiplie tous les seuils (ex Jasmin 0.92 → S1 atteint à 138 GDD au lieu de 150).
 *   - customStageThresholds : override absolu (NON multiplié par le coefficient) — utile
 *     pour qu'une parcelle calibrée saison 1 ait ses propres seuils sans toucher la référence.
 *   - Si gddCumul >= effectiveMin du dernier stade → renvoie le dernier stade (end-of-cycle).
 *   - Si gddCumul < effectiveMin du premier stade → renvoie le premier stade (cas défensif,
 *     ne devrait pas arriver car le premier stade a typiquement gddMin=0).
 */

/**
 * @typedef {import('./types').PhenologyStage} PhenologyStage
 * @typedef {import('./types').PhenologyReference} PhenologyReference
 */

/**
 * @typedef {Object} ResolveStageOptions
 * @property {number} [precocityCoefficient]   Override le coef de la référence (Maravilla=1.00, Jasmin=0.92).
 *                                              Si omis, utilise reference.precocityCoefficient (défaut 1).
 * @property {Object<string, number>} [customStageThresholds]  Override absolu des gddMin par code stade.
 *                                              Ex { S1: 145, S2: 380 }. NON multiplié par le coefficient.
 */

/**
 * Détermine le stade phénologique courant à partir du GDD cumulé.
 *
 * @param {number} gddCumul                 °Cd cumulés depuis plantation/débourrement
 * @param {PhenologyReference} reference    Document phenology_references/{varietyId}_{cycleType}
 * @param {ResolveStageOptions} [options]
 * @returns {PhenologyStage}
 * @throws {TypeError} si gddCumul n'est pas un nombre fini
 * @throws {RangeError} si gddCumul < 0, reference invalide, ou coefficient invalide
 */
function resolveStage(gddCumul, reference, options = {}) {
  if (typeof gddCumul !== 'number' || !Number.isFinite(gddCumul)) {
    throw new TypeError(`resolveStage: gddCumul must be a finite number, got ${gddCumul}`);
  }
  if (gddCumul < 0) {
    throw new RangeError(`resolveStage: gddCumul must be >= 0, got ${gddCumul}`);
  }
  if (!reference || typeof reference !== 'object' || !Array.isArray(reference.stages) || reference.stages.length === 0) {
    throw new RangeError('resolveStage: reference must be an object with a non-empty stages[] array');
  }

  const opts = options || {};
  const coefRaw = opts.precocityCoefficient ?? reference.precocityCoefficient ?? 1;
  if (typeof coefRaw !== 'number' || !Number.isFinite(coefRaw) || coefRaw <= 0) {
    throw new RangeError(`resolveStage: precocityCoefficient must be a positive finite number, got ${coefRaw}`);
  }
  const coef = coefRaw;
  const overrides = opts.customStageThresholds || {};

  // Compute effective lower bound per stage (override > reference × coef), sort ascending.
  const enriched = reference.stages
    .map((stage) => {
      const has = Object.prototype.hasOwnProperty.call(overrides, stage.code);
      const overrideVal = has ? overrides[stage.code] : null;
      if (has && (typeof overrideVal !== 'number' || !Number.isFinite(overrideVal) || overrideVal < 0)) {
        throw new RangeError(`resolveStage: customStageThresholds.${stage.code} must be a non-negative finite number`);
      }
      const effectiveMin = has ? overrideVal : stage.gddMin * coef;
      return { stage, effectiveMin };
    })
    .sort((a, b) => a.effectiveMin - b.effectiveMin);

  // Walk in ascending order; pick the last stage whose effectiveMin <= gddCumul.
  let resolved = enriched[0].stage;
  for (const item of enriched) {
    if (gddCumul >= item.effectiveMin) {
      resolved = item.stage;
    } else {
      break;
    }
  }
  return resolved;
}

module.exports = {
  resolveStage,
};
