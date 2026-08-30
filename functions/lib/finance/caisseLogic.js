// @ts-check
'use strict';

/**
 * @typedef {Object} CaisseTransaction
 * @property {string} type - e.g., 'alimentation', 'transfer_in', 'depense', 'sortie', 'transfer_out'
 * @property {number} montant - The transaction amount
 * @property {string} [status] - The transaction status, e.g., 'valide'
 */

/**
 * Determine if a transaction type represents an incoming amount.
 * @param {string} type
 * @returns {boolean}
 */
function isIncoming(type) {
  return type === 'alimentation' || type === 'transfer_in';
}

/**
 * Determine if a transaction type represents an outgoing amount.
 * @param {string} type
 * @returns {boolean}
 */
function isOutgoing(type) {
  return type === 'depense' || type === 'sortie' || type === 'transfer_out';
}

/**
 * Compute the total incoming and outgoing amounts for a list of transactions.
 * Pure function — no DB access.
 *
 * @param {CaisseTransaction[]} transactions
 * @returns {{ totalIn: number, totalOut: number }}
 */
function computeTotals(transactions) {
  let totalIn = 0;
  let totalOut = 0;
  for (const tx of transactions) {
    if (isIncoming(tx.type)) {
      totalIn += (tx.montant || 0);
    } else if (isOutgoing(tx.type)) {
      totalOut += (tx.montant || 0);
    }
  }
  return { totalIn, totalOut };
}

/**
 * Compute the current balance of a caisse given its initial balance and validated transactions.
 * Pure function — no DB access.
 *
 * @param {number} soldeInitial - The initial balance
 * @param {CaisseTransaction[]} transactions - The list of transactions
 * @returns {number} The current balance (solde actuel)
 */
function computeSoldeActuel(soldeInitial, transactions) {
  const { totalIn, totalOut } = computeTotals(transactions);
  return soldeInitial + totalIn - totalOut;
}

module.exports = { isIncoming, isOutgoing, computeTotals, computeSoldeActuel };
