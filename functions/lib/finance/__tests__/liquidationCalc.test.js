// @ts-check
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeRowValue, computeRowEcart, aggregateLiquidations } = require('../liquidationCalc');

describe('liquidationCalc', () => {
  describe('computeRowValue', () => {
    test('computes quantity x price', () => {
      assert.equal(computeRowValue({ ferme: 'F1', variete: 'V1', quinzaine: 'Q1', quantite: 10, prix_unitaire: 5 }), 50);
    });
    test('handles missing values', () => {
      assert.equal(computeRowValue({ ferme: 'F1', variete: 'V1', quinzaine: 'Q1', quantite: 10, prix_unitaire: 0 }), 0);
    });
  });

  describe('computeRowEcart', () => {
    test('computes expected minus actual', () => {
      assert.equal(computeRowEcart({ ferme: 'F1', variete: 'V1', quinzaine: 'Q1', quantite: 10, prix_unitaire: 5, expected_total: 60 }), 10);
    });
  });

  describe('aggregateLiquidations', () => {
    test('aggregates correctly by key', () => {
      const rows = [
        { ferme: 'F1', variete: 'V1', quinzaine: 'Q1', quantite: 10, prix_unitaire: 5, expected_total: 60 },
        { ferme: 'F1', variete: 'V1', quinzaine: 'Q1', quantite: 20, prix_unitaire: 5, expected_total: 100 },
        { ferme: 'F2', variete: 'V2', quinzaine: 'Q1', quantite: 5, prix_unitaire: 10, expected_total: 50 }
      ];

      const agg = aggregateLiquidations(rows, r => `${r.ferme}-${r.variete}`);

      assert.ok(agg['F1-V1']);
      assert.equal(agg['F1-V1'].totalQuantite, 30);
      assert.equal(agg['F1-V1'].totalValeur, 150);
      assert.equal(agg['F1-V1'].ecartTotal, 10); // 160 - 150 = 10

      assert.ok(agg['F2-V2']);
      assert.equal(agg['F2-V2'].totalQuantite, 5);
      assert.equal(agg['F2-V2'].totalValeur, 50);
      assert.equal(agg['F2-V2'].ecartTotal, 0);
    });
  });
});
