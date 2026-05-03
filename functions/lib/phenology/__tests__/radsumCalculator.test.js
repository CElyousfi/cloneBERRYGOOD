const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateDailyRadsum,
  estimateMissingRadiation,
  evaluateDliVsTarget,
  __internals,
} = require('../radsumCalculator');
const { sineDay, customSamples, DAY_START } = require('./fixtures');

// =====================================================================
// calculateDailyRadsum
// =====================================================================

test('radsum #1: sunny day (288 samples sine, peakPAR=1000) → DLI ~25-30 mol/m²', () => {
  const samples = sineDay({ count: 288, peakPar: 1000 });
  const r = calculateDailyRadsum(samples);
  assert.ok(r.dliMolM2 > 25 && r.dliMolM2 < 30, `expected 25-30, got ${r.dliMolM2.toFixed(2)}`);
  assert.equal(r.dataQuality, 'good');
  assert.equal(r.samplesUsed, 288);
  assert.equal(r.samplesExpected, 288);
  // RADSUM derived: peak rad ~476 W/m² → ~13 MJ/m²
  assert.ok(r.radsumMjM2 > 11 && r.radsumMjM2 < 15, `expected 11-15, got ${r.radsumMjM2.toFixed(2)}`);
});

test('radsum #2: cloudy day (288 samples, peakPAR=400) → DLI ~10-12', () => {
  const samples = sineDay({ count: 288, peakPar: 400 });
  const r = calculateDailyRadsum(samples);
  assert.ok(r.dliMolM2 > 10 && r.dliMolM2 < 12, `expected 10-12, got ${r.dliMolM2.toFixed(2)}`);
  assert.equal(r.dataQuality, 'good');
});

test('radsum #3: gaps (200 samples) → quality "partial"', () => {
  const samples = sineDay({ count: 200, peakPar: 1000 });
  const r = calculateDailyRadsum(samples);
  assert.equal(r.dataQuality, 'partial');
  assert.equal(r.samplesUsed, 200);
});

test('radsum #4: very few samples (50) → quality "interpolated"', () => {
  const samples = sineDay({ count: 50, peakPar: 1000 });
  const r = calculateDailyRadsum(samples);
  assert.equal(r.dataQuality, 'interpolated');
  assert.equal(r.samplesUsed, 50);
});

test('radsum #5: PAR-only samples → estimateMissingRadiation fills radiationWm2 BEFORE integration', () => {
  // Simulate PAR-only stream
  const parOnly = sineDay({ count: 288, peakPar: 1000, includeRadiation: false });
  // Sanity: original samples have no radiationWm2
  assert.equal(parOnly[100].radiationWm2, undefined);
  // Apply estimation
  const enriched = estimateMissingRadiation(parOnly, 0.46);
  assert.ok(typeof enriched[100].radiationWm2 === 'number', 'estimation populated radiationWm2');
  // RADSUM should now match the sunny day (radiation derived from PAR)
  const r = calculateDailyRadsum(enriched);
  assert.ok(r.radsumMjM2 > 11 && r.radsumMjM2 < 15, `radsum from estimated rad should be ~13 MJ, got ${r.radsumMjM2.toFixed(2)}`);
  assert.ok(r.dliMolM2 > 25 && r.dliMolM2 < 30);
});

test('radsum #6: Radiation-only samples → estimateMissingRadiation fills parUmolM2s', () => {
  // Build radiation-only by stripping par from sineDay output
  const samples = sineDay({ count: 288, peakPar: 1000 }).map((s) => ({
    timestamp: s.timestamp,
    radiationWm2: s.radiationWm2,
  }));
  const enriched = estimateMissingRadiation(samples, 0.46);
  assert.ok(typeof enriched[100].parUmolM2s === 'number', 'estimation populated parUmolM2s');
  const r = calculateDailyRadsum(enriched);
  assert.ok(r.dliMolM2 > 25 && r.dliMolM2 < 30, `DLI from estimated PAR should be ~27, got ${r.dliMolM2.toFixed(2)}`);
});

test('radsum #7: empty input → 0 / 0 / interpolated (no crash)', () => {
  const r = calculateDailyRadsum([]);
  assert.equal(r.radsumMjM2, 0);
  assert.equal(r.dliMolM2, 0);
  assert.equal(r.dataQuality, 'interpolated');
  assert.equal(r.samplesUsed, 0);
  // Null/undefined input also tolerated
  assert.doesNotThrow(() => calculateDailyRadsum(null));
  assert.doesNotThrow(() => calculateDailyRadsum(undefined));
});

test('radsum #8: unsorted samples → internal sort, integration correct', () => {
  const sorted = sineDay({ count: 288, peakPar: 1000 });
  const shuffled = [...sorted].reverse(); // worst case: fully reversed
  const rSorted = calculateDailyRadsum(sorted);
  const rShuffled = calculateDailyRadsum(shuffled);
  // Should produce identical results (within float epsilon)
  assert.ok(Math.abs(rSorted.dliMolM2 - rShuffled.dliMolM2) < 1e-9);
  assert.ok(Math.abs(rSorted.radsumMjM2 - rShuffled.radsumMjM2) < 1e-9);
});

test('radsum #9: negative values (defective sensor) → filtered out', () => {
  const samples = sineDay({ count: 288, peakPar: 1000 });
  // Inject -50 W/m² on every other night sample
  const corrupted = samples.map((s, i) => {
    if (i < 50 && i % 2 === 0) return { ...s, radiationWm2: -50, parUmolM2s: -10 };
    return s;
  });
  const r = calculateDailyRadsum(corrupted);
  // The negative samples are dropped (both rad and par null after filter, no other field)
  assert.equal(r.samplesUsed, 288 - 25, 'negative-only samples dropped (25 of them)');
  // Result still in sunny range
  assert.ok(r.dliMolM2 > 25 && r.dliMolM2 < 30);
});

test('radsum #10: aberrant high values (5000 W/m²) → clamped to MAX_RADIATION_WM2', () => {
  // 4 samples 5min apart, all aberrant rad, PAR normal
  const samples = customSamples([
    { tMin: 720, par: 1500, rad: 5000 },     // noon
    { tMin: 725, par: 1500, rad: 5000 },
    { tMin: 730, par: 1500, rad: 5000 },
    { tMin: 735, par: 1500, rad: 5000 },
  ]);
  const r = calculateDailyRadsum(samples);
  // Each interval = 5 min × 1500 W/m² (clamped) = 1500 × 300 s = 450 000 W·s/m²
  // 3 intervals × 450 000 = 1 350 000 W·s/m² = 1.35 MJ/m²
  assert.ok(Math.abs(r.radsumMjM2 - 1.35) < 1e-6, `expected 1.35 MJ from clamped values, got ${r.radsumMjM2}`);
  assert.equal(__internals.MAX_RADIATION_WM2, 1500); // sanity on constant
});

test('radsum #11: invalid timestamps (NaN, undefined) → ignored without crash', () => {
  const samples = [
    { timestamp: NaN, parUmolM2s: 500, radiationWm2: 200 },
    { timestamp: undefined, parUmolM2s: 600, radiationWm2: 250 },
    { timestamp: 'not-a-date', parUmolM2s: 700 },
    { timestamp: DAY_START + 12 * 3600 * 1000, parUmolM2s: 1000, radiationWm2: 476 },
    { timestamp: DAY_START + 12 * 3600 * 1000 + 5 * 60 * 1000, parUmolM2s: 1000, radiationWm2: 476 },
  ];
  const r = calculateDailyRadsum(samples);
  // Only 2 valid samples → quality "interpolated"
  assert.equal(r.samplesUsed, 2);
  assert.equal(r.dataQuality, 'interpolated');
});

test('radsum #12: trapezoidal integration validated vs hand calculation (4 samples)', () => {
  // 4 samples, 5 min apart (300 s each interval), PAR = 100, 200, 300, 400 µmol/m²/s
  // 3 intervals:
  //   I1: (100+200)/2 × 300 = 150 × 300 = 45 000 µmol·s/m²
  //   I2: (200+300)/2 × 300 = 250 × 300 = 75 000
  //   I3: (300+400)/2 × 300 = 350 × 300 = 105 000
  // Total = 225 000 µmol·s/m² = 0.000225 mol/m² (DLI very low because just 15 min)
  const samples = customSamples([
    { tMin: 600, par: 100 },  // 10:00
    { tMin: 605, par: 200 },
    { tMin: 610, par: 300 },
    { tMin: 615, par: 400 },
  ]);
  const r = calculateDailyRadsum(samples);
  const expectedDli = 225000 / 1_000_000; // = 0.000225 mol/m²
  assert.ok(Math.abs(r.dliMolM2 - expectedDli) < 1e-9, `expected ${expectedDli}, got ${r.dliMolM2}`);
});

test('radsum #12b: gap > 30 min between samples → interval skipped', () => {
  // 3 samples : 10:00, 10:05 (5 min gap OK), 11:00 (55 min gap SKIPPED)
  const samples = customSamples([
    { tMin: 600, par: 100 },
    { tMin: 605, par: 200 },
    { tMin: 660, par: 300 }, // gap 55 min from prev → skipped
  ]);
  const r = calculateDailyRadsum(samples);
  // Only the 5-min interval contributes:
  //   (100+200)/2 × 300 s = 45 000 µmol·s/m² = 4.5e-5 mol/m²
  const expected = 45000 / 1_000_000;
  assert.ok(Math.abs(r.dliMolM2 - expected) < 1e-9, `expected ${expected}, got ${r.dliMolM2}`);
});

// =====================================================================
// evaluateDliVsTarget
// =====================================================================

const DLI_S4 = { target_min: 20, target_max: 28, critical_min: 15, critical_max: 35 };

test('radsum #13: evaluateDliVsTarget below_critical (dli=10 in S4)', () => {
  const r = evaluateDliVsTarget(10, DLI_S4);
  assert.equal(r.status, 'below_critical');
  assert.equal(r.stageMin, 20);
  assert.equal(r.stageMax, 28);
});

test('radsum #14: evaluateDliVsTarget in_target (dli=24 in S4)', () => {
  const r = evaluateDliVsTarget(24, DLI_S4);
  assert.equal(r.status, 'in_target');
});

test('radsum #15: evaluateDliVsTarget above_critical (dli=40 in S4)', () => {
  const r = evaluateDliVsTarget(40, DLI_S4);
  assert.equal(r.status, 'above_critical');
});

test('radsum #15b: evaluateDliVsTarget below_target and above_target boundaries', () => {
  assert.equal(evaluateDliVsTarget(18, DLI_S4).status, 'below_target');     // 15 <= 18 < 20
  assert.equal(evaluateDliVsTarget(15, DLI_S4).status, 'below_target');     // boundary inclusive
  assert.equal(evaluateDliVsTarget(20, DLI_S4).status, 'in_target');         // exact target_min
  assert.equal(evaluateDliVsTarget(28, DLI_S4).status, 'in_target');         // exact target_max
  assert.equal(evaluateDliVsTarget(28.01, DLI_S4).status, 'above_target');
  assert.equal(evaluateDliVsTarget(35, DLI_S4).status, 'above_target');     // exact critical_max
  assert.equal(evaluateDliVsTarget(35.01, DLI_S4).status, 'above_critical');
});

test('radsum #15c: evaluateDliVsTarget input validation', () => {
  assert.throws(() => evaluateDliVsTarget(NaN, DLI_S4), TypeError);
  assert.throws(() => evaluateDliVsTarget(20, null), TypeError);
  assert.throws(() => evaluateDliVsTarget(20, { target_min: 'x' }), TypeError);
  assert.throws(
    () => evaluateDliVsTarget(20, { target_min: 30, target_max: 20, critical_min: 10, critical_max: 40 }),
    RangeError
  );
});

// =====================================================================
// estimateMissingRadiation — input validation
// =====================================================================

test('radsum: estimateMissingRadiation invalid ratio → throws', () => {
  assert.throws(() => estimateMissingRadiation([], 0), RangeError);
  assert.throws(() => estimateMissingRadiation([], -1), RangeError);
  assert.throws(() => estimateMissingRadiation([], NaN), RangeError);
});

test('radsum: estimateMissingRadiation preserves both fields when both present', () => {
  const orig = [{ timestamp: DAY_START, parUmolM2s: 1000, radiationWm2: 500 }];
  const enriched = estimateMissingRadiation(orig, 0.46);
  assert.equal(enriched[0].parUmolM2s, 1000, 'PAR untouched');
  assert.equal(enriched[0].radiationWm2, 500, 'Radiation untouched (priority to real measurement)');
});
