'use strict';

/**
 * Unit tests for public/lib/meteoCalc.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../public/lib/meteoCalc.js');

function approx(actual, expected, eps) {
  if (Math.abs(actual - expected) > (eps || 1e-3)) {
    assert.fail('expected ' + expected + ' ± ' + (eps || 1e-3) + ', got ' + actual);
  }
}

test('saturationVaporPressure: T=25 → ≈ 3.169 kPa', () => {
  approx(M.saturationVaporPressure(25), 3.169, 0.01);
});

test('vpdAt: T=25, RH=50 → ≈ 1.585 kPa', () => {
  approx(M.vpdAt(25, 50), 1.585, 0.01);
});

test('vpdAt: RH=100 → 0', () => {
  approx(M.vpdAt(20, 100), 0, 1e-9);
});

test('vpdAt: handles null/NaN inputs → 0', () => {
  assert.equal(M.vpdAt(null, 50), 0);
  assert.equal(M.vpdAt(20, null), 0);
  assert.equal(M.vpdAt(NaN, 50), 0);
});

test('computeHourlyVPD: parallel arrays', () => {
  const out = M.computeHourlyVPD([10, 20, 30], [80, 60, 40]);
  assert.equal(out.length, 3);
  approx(out[0], M.vpdAt(10, 80));
  approx(out[1], M.vpdAt(20, 60));
  approx(out[2], M.vpdAt(30, 40));
});

test('computeHourlyVPD: truncates to shorter input', () => {
  const out = M.computeHourlyVPD([10, 20, 30], [80, 60]);
  assert.equal(out.length, 2);
});

test('computeHourlyVPD: empty / non-array → []', () => {
  assert.deepEqual(M.computeHourlyVPD([], []), []);
  assert.deepEqual(M.computeHourlyVPD(null, null), []);
});

test('computeCumRadiation: monotone non-decreasing, conversion 0.36', () => {
  // Constant 100 W/m² for 3 h → cumulative [36, 72, 108] J/cm²
  const out = M.computeCumRadiation([100, 100, 100]);
  approx(out[0], 36);
  approx(out[1], 72);
  approx(out[2], 108);
});

test('computeCumRadiation: night zeros do not regress', () => {
  const out = M.computeCumRadiation([0, 0, 200, 400, 0, 0]);
  assert.equal(out[0], 0);
  assert.equal(out[1], 0);
  approx(out[2], 72);
  approx(out[3], 72 + 144);
  approx(out[4], 72 + 144);
  approx(out[5], 72 + 144);
});

test('computeCumRadiation: ignores negative noise', () => {
  const out = M.computeCumRadiation([-5, 100]);
  assert.equal(out[0], 0);
  approx(out[1], 36);
});

test('peakIndex: returns the argmax', () => {
  const r = M.peakIndex([1, 5, 3, 5, 2]);
  assert.equal(r.idx, 1);
  assert.equal(r.val, 5);
});

test('peakIndex: empty → idx=-1', () => {
  const r = M.peakIndex([]);
  assert.equal(r.idx, -1);
  assert.equal(r.val, null);
});
