// @ts-check
'use strict';

/**
 * @typedef {Object} LiquidationRow
 * @property {string} ferme
 * @property {string} variete
 * @property {string} quinzaine
 * @property {number} quantite
 * @property {number} prix_unitaire
 * @property {number} [expected_total]
 */

/**
 * @typedef {Object} LiquidationAggregate
 * @property {number} totalQuantite
 * @property {number} totalValeur
 * @property {number} ecartTotal
 */

/**
 * Compute the total value for a single liquidation row.
 * @param {LiquidationRow} row
 * @returns {number}
 */
function computeRowValue(row) {
  return (row.quantite || 0) * (row.prix_unitaire || 0);
}

/**
 * Compute the écart (difference) between the expected total and the actual computed total.
 * @param {LiquidationRow} row
 * @returns {number}
 */
function computeRowEcart(row) {
  const actual = computeRowValue(row);
  const expected = row.expected_total || 0;
  return expected - actual;
}

/**
 * Aggregate liquidations by a grouping key (e.g., ferme, variete, quinzaine).
 * @param {LiquidationRow[]} rows
 * @param {(row: LiquidationRow) => string} keyFn
 * @returns {Record<string, LiquidationAggregate>}
 */
function aggregateLiquidations(rows, keyFn) {
  /** @type {Record<string, LiquidationAggregate>} */
  const result = {};

  for (const row of rows) {
    const key = keyFn(row);
    if (!result[key]) {
      result[key] = { totalQuantite: 0, totalValeur: 0, ecartTotal: 0 };
    }
    result[key].totalQuantite += (row.quantite || 0);
    result[key].totalValeur += computeRowValue(row);
    result[key].ecartTotal += computeRowEcart(row);
  }

  return result;
}

module.exports = { computeRowValue, computeRowEcart, aggregateLiquidations };
