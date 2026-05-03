/**
 * gddCalculator.js — Daily Growing Degree Days (pure function).
 *
 * Source : phenology-tables.md §1
 *
 * Formule officielle :
 *   T_max_capped = min(T_max, T_cap)
 *   GDD_jour     = max(0, ((T_max_capped + T_min) / 2) - T_base)
 *
 * Note : T_min n'est PAS capé par T_cap. Si T_min > T_cap (canicule extrême
 * théorique), T_min reste utilisé tel quel. Le legacy functions/index.js:2025
 * cape les deux côtés — ce module corrige ce bug et la divergence est
 * volontairement prouvée par le test #5 (tMin > tCap) du suite associée.
 *
 * Aucun I/O. Aucune dépendance Firebase. Testable sans émulateur.
 */

/**
 * @typedef {import('./types').GddDailyResult} GddDailyResult
 */

/**
 * Calcule le GDD du jour selon la méthode des moyennes capées Driscoll's.
 *
 * @param {Object} params
 * @param {number} params.tMin     T° min de la journée sous abri (°C)
 * @param {number} params.tMax     T° max de la journée sous abri (°C)
 * @param {number} params.tBase    T° de base de la culture (°C, std framboisier 5)
 * @param {number} params.tCap     T° plafond (°C, std framboisier 30)
 * @returns {GddDailyResult}
 * @throws {TypeError} si un paramètre numérique est manquant ou non fini
 * @throws {RangeError} si tMin > tMax (donnée corrompue)
 */
function calculateDailyGdd({ tMin, tMax, tBase, tCap } = {}) {
  for (const [name, value] of [['tMin', tMin], ['tMax', tMax], ['tBase', tBase], ['tCap', tCap]]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(`calculateDailyGdd: param "${name}" must be a finite number, got ${value}`);
    }
  }
  if (tMin > tMax) {
    throw new RangeError(`calculateDailyGdd: tMin (${tMin}) > tMax (${tMax}) — corrupted input`);
  }
  if (tBase >= tCap) {
    throw new RangeError(`calculateDailyGdd: tBase (${tBase}) must be < tCap (${tCap})`);
  }

  const tMaxCapped = Math.min(tMax, tCap);
  const gddDay = Math.max(0, (tMaxCapped + tMin) / 2 - tBase);

  return {
    gddDay,
    tMaxCapped,
    tMinUsed: tMin,
  };
}

module.exports = {
  calculateDailyGdd,
};
