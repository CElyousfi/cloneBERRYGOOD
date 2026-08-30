const test = require('node:test');
const assert = require('node:assert');
const { computeBrixAverage, isBrixCompliant, computeBrixStats } = require('../brixCalc');

test('computeBrixAverage', () => {
  assert.strictEqual(computeBrixAverage([10, 12, 14]), 12);
  assert.strictEqual(computeBrixAverage([]), 0);
});

test('isBrixCompliant', () => {
  assert.strictEqual(isBrixCompliant(12, 10), true);
  assert.strictEqual(isBrixCompliant(9, 10), false);
});

test('computeBrixStats', () => {
  const stats = computeBrixStats([8, 10, 12]);
  assert.strictEqual(stats.avg, 10);
  assert.strictEqual(stats.min, 8);
  assert.strictEqual(stats.max, 12);
  assert.strictEqual(stats.compliantPct.toFixed(2), '0.67');
});
