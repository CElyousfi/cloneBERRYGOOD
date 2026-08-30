const test = require('node:test');
const assert = require('node:assert');
const { computeDefectRate, classifyQuality, isBelowThreshold, computeInspectionSummary } = require('../inspectionRules');

test('computeDefectRate', () => {
  assert.strictEqual(computeDefectRate({ totalSamples: 100, defects: 5 }), 0.05);
  assert.strictEqual(computeDefectRate({ totalSamples: 0 }), 0);
  assert.strictEqual(computeDefectRate(null), 0);
});

test('classifyQuality', () => {
  assert.strictEqual(classifyQuality(0.04), 'A');
  assert.strictEqual(classifyQuality(0.08), 'B');
  assert.strictEqual(classifyQuality(0.15), 'C');
  assert.strictEqual(classifyQuality(0.25), 'reject');
});

test('isBelowThreshold', () => {
  assert.strictEqual(isBelowThreshold(0.05, 0.1), true);
  assert.strictEqual(isBelowThreshold(0.15, 0.1), false);
});

test('computeInspectionSummary', () => {
  const insp = [
    { totalSamples: 100, defects: 4 },
    { totalSamples: 100, defects: 8 },
    { totalSamples: 100, defects: 25 }
  ];
  const summary = computeInspectionSummary(insp);
  assert.strictEqual(summary.total, 3);
  assert.strictEqual(summary.passed, 2);
  assert.strictEqual(summary.failed, 1);
  assert.strictEqual(summary.avgDefectRate.toFixed(4), '0.1233');
});
