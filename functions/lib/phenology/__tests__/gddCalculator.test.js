const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateDailyGdd } = require('../gddCalculator');

const STD = { tBase: 5, tCap: 30 };

// Reproduction du calcul legacy (functions/index.js:2023-2027) — utilisé pour
// les tests de comparaison. NE PAS importer le legacy directement (il vit
// dans le monolithe index.js et n'est pas exportable).
function legacyCalcGdd(tmax, tmin, tbase = 5, tupper = 30) {
  const tmaxCap = Math.min(tmax, tupper);
  const tminCap = Math.min(tmin, tupper); // ← bug: cape aussi tmin
  return Math.max(0, (tmaxCap + tminCap) / 2 - tbase);
}

test('calculateDailyGdd #1: standard day (tMin=12, tMax=28) → 15.0', () => {
  const r = calculateDailyGdd({ tMin: 12, tMax: 28, ...STD });
  assert.equal(r.gddDay, 15);
  assert.equal(r.tMaxCapped, 28);
  assert.equal(r.tMinUsed, 12);
});

test('calculateDailyGdd #2: tMax > tCap → tMaxCapped applied (tMin=15, tMax=35) → 17.5', () => {
  const r = calculateDailyGdd({ tMin: 15, tMax: 35, ...STD });
  assert.equal(r.gddDay, 17.5);
  assert.equal(r.tMaxCapped, 30);
});

test('calculateDailyGdd #3: frost day (tMin=-2, tMax=10) → clamped to 0 (no negative GDD)', () => {
  const r = calculateDailyGdd({ tMin: -2, tMax: 10, ...STD });
  // moyenne = (10 + -2)/2 = 4 ; 4 - 5 = -1 ; clamped to 0
  assert.equal(r.gddDay, 0);
});

test('calculateDailyGdd #4: heatwave (tMin=20, tMax=40) → tMax capped at 30 → 20', () => {
  const r = calculateDailyGdd({ tMin: 20, tMax: 40, ...STD });
  // (30 + 20)/2 - 5 = 20
  assert.equal(r.gddDay, 20);
  assert.equal(r.tMaxCapped, 30);
});

test('calculateDailyGdd #5: tMin > tCap (extreme heat) — DIVERGES from legacy (proves bug fix)', () => {
  // Cas extrême canicule : tMin=32, tMax=38, tCap=30
  // Doc phenology-tables.md §1 : T_min N'est PAS capé.
  //   → (min(38,30) + 32)/2 - 5 = (30 + 32)/2 - 5 = 31 - 5 = 26
  // Legacy bugué : cape aussi T_min.
  //   → (30 + 30)/2 - 5 = 25
  const newImpl = calculateDailyGdd({ tMin: 32, tMax: 38, ...STD });
  const legacy = legacyCalcGdd(38, 32);

  assert.equal(newImpl.gddDay, 26, 'new impl follows phenology-tables.md §1 spec');
  assert.equal(legacy, 25, 'legacy double-cap produces 25');
  assert.notEqual(newImpl.gddDay, legacy, 'divergence proves the double-cap bug fix');
  assert.equal(newImpl.tMinUsed, 32, 'tMin preserved (not capped)');
});

test('calculateDailyGdd #5b (AJ2): standard cases CONVERGE with legacy when tMin <= tCap', () => {
  // Sur les cas standard où tMin <= tCap, les deux implémentations doivent
  // produire le même résultat (preuve qu'on n'a pas cassé la migration).
  const cases = [
    { tMin: 12, tMax: 28 },
    { tMin: 15, tMax: 35 },
    { tMin: -2, tMax: 10 },
    { tMin: 20, tMax: 40 },
    { tMin: 5, tMax: 25 },
    { tMin: 8, tMax: 22 },
  ];
  for (const c of cases) {
    const newImpl = calculateDailyGdd({ ...c, ...STD }).gddDay;
    const legacy = legacyCalcGdd(c.tMax, c.tMin);
    assert.equal(newImpl, legacy, `convergence expected for tMin=${c.tMin}, tMax=${c.tMax}`);
  }
});

test('calculateDailyGdd #6: tMax = tBase exactly → 0', () => {
  const r = calculateDailyGdd({ tMin: 5, tMax: 5, ...STD });
  // (5 + 5)/2 - 5 = 0
  assert.equal(r.gddDay, 0);
});

test('calculateDailyGdd #7: float precision (tMin=12.5, tMax=27.3)', () => {
  const r = calculateDailyGdd({ tMin: 12.5, tMax: 27.3, ...STD });
  // (27.3 + 12.5)/2 - 5 = 19.9 - 5 = 14.9
  // Tolérance float : assert.ok proche
  assert.ok(Math.abs(r.gddDay - 14.9) < 1e-9, `expected ~14.9, got ${r.gddDay}`);
});

test('calculateDailyGdd #8: tMin > tMax (corrupted input) → throws RangeError', () => {
  assert.throws(
    () => calculateDailyGdd({ tMin: 20, tMax: 10, ...STD }),
    /tMin .* > tMax/
  );
});

test('calculateDailyGdd #9: missing param → throws TypeError', () => {
  assert.throws(
    () => calculateDailyGdd({ tMin: 12, tMax: 28, tBase: 5 }), // tCap missing
    TypeError
  );
  assert.throws(
    () => calculateDailyGdd({ tMin: 12, tMax: NaN, ...STD }),
    TypeError
  );
  assert.throws(
    () => calculateDailyGdd(),
    TypeError
  );
});

test('calculateDailyGdd #10: custom tBase/tCap (other crops) → respected', () => {
  // Tomate type : tBase=10, tCap=35
  const r = calculateDailyGdd({ tMin: 14, tMax: 32, tBase: 10, tCap: 35 });
  // (32 + 14)/2 - 10 = 23 - 10 = 13
  assert.equal(r.gddDay, 13);
  assert.equal(r.tMaxCapped, 32);

  // Et avec tMax > tCap personnalisé
  const r2 = calculateDailyGdd({ tMin: 14, tMax: 40, tBase: 10, tCap: 35 });
  assert.equal(r2.tMaxCapped, 35);
  assert.equal(r2.gddDay, (35 + 14) / 2 - 10);
});

test('calculateDailyGdd: tBase >= tCap → throws RangeError (config invalid)', () => {
  assert.throws(
    () => calculateDailyGdd({ tMin: 12, tMax: 28, tBase: 30, tCap: 30 }),
    RangeError
  );
});
