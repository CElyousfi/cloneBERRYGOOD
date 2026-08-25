// @ts-check
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { isIncoming, isOutgoing, computeTotals, computeSoldeActuel } = require('../caisseLogic');

describe('caisseLogic', () => {
  describe('isIncoming / isOutgoing', () => {
    test('alimentation is incoming', () => {
      assert.equal(isIncoming('alimentation'), true);
      assert.equal(isOutgoing('alimentation'), false);
    });
    test('depense is outgoing', () => {
      assert.equal(isIncoming('depense'), false);
      assert.equal(isOutgoing('depense'), true);
    });
  });

  describe('computeTotals', () => {
    test('computes totals correctly', () => {
      const txs = [
        { type: 'alimentation', montant: 100 },
        { type: 'depense', montant: 40 },
        { type: 'transfer_in', montant: 50 },
        { type: 'sortie', montant: 20 },
        { type: 'unknown', montant: 500 }
      ];
      const result = computeTotals(txs);
      assert.equal(result.totalIn, 150);
      assert.equal(result.totalOut, 60);
    });
  });

  describe('computeSoldeActuel', () => {
    test('computes correct running balance', () => {
      const txs = [
        { type: 'alimentation', montant: 100 },
        { type: 'depense', montant: 40 }
      ];
      const balance = computeSoldeActuel(1000, txs);
      assert.equal(balance, 1060); // 1000 + 100 - 40
    });
  });
});
