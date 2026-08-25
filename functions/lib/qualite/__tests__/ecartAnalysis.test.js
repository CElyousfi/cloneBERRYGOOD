const test = require('node:test');
const assert = require('node:assert');
const { computeEcartVolume, computeEcartPct, classifyEcart, aggregateEcarts } = require('../ecartAnalysis');

test('computeEcartVolume', () => {
  assert.strictEqual(computeEcartVolume(100, 90), 10);
});

test('computeEcartPct', () => {
  assert.strictEqual(computeEcartPct(100, 90), 0.1);
  assert.strictEqual(computeEcartPct(0, 90), 0);
});

test('classifyEcart', () => {
  assert.strictEqual(classifyEcart(0.01), 'normal');
  assert.strictEqual(classifyEcart(0.04), 'attention');
  assert.strictEqual(classifyEcart(0.1), 'critique');
});

test('aggregateEcarts', () => {
  const ecarts = [
    { attendu: 100, reel: 99 },
    { attendu: 100, reel: 50 }
  ];
  const agg = aggregateEcarts(ecarts);
  assert.strictEqual(agg.totalEcart, 51);
  assert.strictEqual(agg.avgEcartPct, 0.255);
  assert.strictEqual(agg.maxEcart, 50);
  assert.strictEqual(agg.anomalies.length, 1);
});
