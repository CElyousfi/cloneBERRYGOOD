/**
 * irrigationRecipe.js — Lookup the irrigation recipe for a given phenology stage.
 *
 * Source : phenology-tables.md §5-8 (recettes EC apport / pH / % drainage par stade).
 *
 * Pure function. Aucun I/O.
 *
 * ────────────────────────────────────────────────────────────────────────
 * TODO Sprint 4-5 — Articulation avec functions/lib/irrigation/
 * ────────────────────────────────────────────────────────────────────────
 * En V1, ce module est strictement DÉCOUPLÉ de lib/irrigation/. Aucun
 * appel croisé. Sémantique :
 *   - lib/phenology/irrigationRecipe = prescriptif par stade (cible théorique)
 *   - lib/irrigation/                = réactif sur saisies réelles (diagnostic)
 *
 * Architecture cible (à designer Sprint 4-5) : lib/irrigation/ pourra
 * consommer en lecture la recette du stade actuel pour ses comparaisons
 * "réel saisi vs prescriptif". L'inverse n'est pas prévu.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Note : pour les variétés Driscoll's V1 (Maravilla, Jasmin), les paramètres
 * irrigation sont identiques. Le coefficient précocité de la variété ne
 * s'applique PAS à la recette (qui est environnement-driven, pas variété-driven).
 */

/**
 * @typedef {import('./types').PhenologyReference} PhenologyReference
 * @typedef {import('./types').IrrigationRecipe} IrrigationRecipe
 */

/**
 * Renvoie la recette d'irrigation prescrite pour un stade donné.
 * L'objet renvoyé est gelé (Object.freeze) pour garantir l'immutabilité.
 *
 * @param {string} stageCode             "S0", …, "S8", "F0", …, "F7"
 * @param {PhenologyReference} reference Document phenology_references/{varietyId}_{cycleType}
 * @returns {IrrigationRecipe} objet frozen
 * @throws {TypeError} si arguments manquants/invalides
 * @throws {RangeError} si stageCode introuvable dans la référence ou recipe absente
 */
function getIrrigationRecipe(stageCode, reference) {
  if (typeof stageCode !== 'string' || stageCode.length === 0) {
    throw new TypeError(`getIrrigationRecipe: stageCode must be a non-empty string, got ${stageCode}`);
  }
  if (!reference || typeof reference !== 'object' || !Array.isArray(reference.stages)) {
    throw new TypeError('getIrrigationRecipe: reference must be a PhenologyReference with stages[]');
  }
  if (reference.stages.length === 0) {
    throw new RangeError('getIrrigationRecipe: reference.stages is empty');
  }

  const stage = reference.stages.find((s) => s && s.code === stageCode);
  if (!stage) {
    const known = reference.stages.map((s) => s && s.code).join(', ');
    throw new RangeError(`getIrrigationRecipe: stage "${stageCode}" not found in reference (known: ${known})`);
  }
  if (!stage.irrigation || typeof stage.irrigation !== 'object') {
    throw new RangeError(`getIrrigationRecipe: stage "${stageCode}" has no irrigation recipe`);
  }

  // Shallow copy + freeze. The IrrigationRecipe is a flat object of numbers,
  // so a shallow freeze is sufficient to prevent mutation by callers.
  return Object.freeze(Object.assign({}, stage.irrigation));
}

module.exports = {
  getIrrigationRecipe,
};
