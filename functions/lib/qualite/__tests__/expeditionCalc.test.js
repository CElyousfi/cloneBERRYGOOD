const test = require('node:test');
const assert = require('node:assert');
const { computeNetWeight, computeLoadFillRate, computeExpeditionTotals } = require('../expeditionCalc');

test('computeNetWeight', () => {
  assert.strictEqual(computeNetWeight(100, 10), 90);
  assert.strictEqual(computeNetWeight(10, 100), 0);
});

test('computeLoadFillRate', () => {
  assert.strictEqual(computeLoadFillRate(50, 100), 0.5);
  assert.strictEqual(computeLoadFillRate(50, 0), 0);
});

test('computeExpeditionTotals', () => {
  const exp = [
    { brut: 100, tare: 10 },
    { brut: 200, tare: 20 }
  ];
  const totals = computeExpeditionTotals(exp);
  assert.strictEqual(totals.totalBrut, 300);
  assert.strictEqual(totals.totalTare, 30);
  assert.strictEqual(totals.totalNet, 270);
  assert.strictEqual(totals.nbExpeditions, 2);
});
