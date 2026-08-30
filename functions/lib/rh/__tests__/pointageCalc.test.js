const test = require('node:test');
const assert = require('node:assert');
const { computePresenceJours, computeHeuresSup } = require('../pointageCalc');

test('computePresenceJours', () => {
  const pts = [{jour: 'J1'}, {jour: 'J1'}, {jour: 'J2'}];
  assert.strictEqual(computePresenceJours(pts), 2);
});
