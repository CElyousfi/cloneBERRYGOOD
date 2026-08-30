const test = require('node:test');
const assert = require('node:assert');
const { matchBonToReception, computeRapprochementSummary } = require('../rapprochementCalc');

test('matchBonToReception', () => {
  const bon = { id: '1', qty: 10 };
  const rec = [{ bonId: '1', qty: 6 }, { bonId: '2', qty: 4 }];
  const res = matchBonToReception(bon, rec);
  assert.strictEqual(res.matched, true);
  assert.strictEqual(res.ecart, 4);
});

test('computeRapprochementSummary', () => {
  const bons = [{ id: '1', qty: 10 }, { id: '2', qty: 5 }];
  const rec = [{ bonId: '1', qty: 10 }];
  const summary = computeRapprochementSummary(bons, rec);
  assert.strictEqual(summary.matched, 1);
  assert.strictEqual(summary.unmatched, 1);
  assert.strictEqual(summary.totalEcart, 5);
});
