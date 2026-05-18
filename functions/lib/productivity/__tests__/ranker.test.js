/**
 * Ranker tests — uses real W18 data from
 * "Grower Productivity report Moulay YTD (2025-2026) W18.pdf".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichTreatment, enrichTreatments, buildFarmSummary, percentileThreshold } = require('../ranker');

// === FIXTURE: Maravilla TP Substrate (Primocane) — page 6 of W18 PDF ===
// 19 growers + Average. F1 (172) is LAST (rank 19/19).
const MARAVILLA_TP_SUB_PRIMO = {
  title: 'Maravilla TP Substrate (Primocane)',
  category: 'raspberry',
  unit: 'kg/ha',
  average: 11650,
  growers: [
    { code: '193', yield: 15224, plantingWeek: 18 },
    { code: '193', yield: 15025, plantingWeek: 17 },
    { code: '152', yield: 14869, plantingWeek: 18 },
    { code: '728', yield: 14471, plantingWeek: 18 },
    { code: '193', yield: 13691, plantingWeek: 19 },
    { code: '728', yield: 13048, plantingWeek: 19 },
    { code: '154', yield: 12591, plantingWeek: 20 },
    { code: '152', yield: 12577, plantingWeek: 19 },
    { code: 'Average', yield: 11650, plantingWeek: 0 },
    { code: '152', yield: 11531, plantingWeek: 20 },
    { code: '725', yield: 11082, plantingWeek: 19 },
    { code: '2014', yield: 10899, plantingWeek: 19 },
    { code: '766', yield: 10623, plantingWeek: 18 },
    { code: '180', yield: 10378, plantingWeek: 20 },
    { code: '152', yield: 9951, plantingWeek: 17 },
    { code: '151', yield: 9836, plantingWeek: 17 },
    { code: '152', yield: 9695, plantingWeek: 16 },
    { code: '151', yield: 9309, plantingWeek: 18 },
    { code: '151', yield: 9006, plantingWeek: 19 },
    { code: '172', yield: 5999, plantingWeek: 20 }, // F1 - dead last
  ],
};

// === FIXTURE: Yazmin TP Soil Cut Back (Floricane) — F5 above average ===
const YAZMIN_TP_SOIL_CB = {
  title: 'Yazmin TP Soil Cut Back (Floricane)',
  category: 'raspberry',
  unit: 'kg/ha',
  average: 2786,
  growers: [
    { code: '157', yield: 7907, plantingWeek: 51 },
    { code: '2057', yield: 6712, plantingWeek: 51 },
    { code: '132', yield: 6131, plantingWeek: 52 },
    { code: '2055', yield: 6113, plantingWeek: 51 },
    { code: '128', yield: 4938, plantingWeek: 51 },
    { code: '2026', yield: 4678, plantingWeek: 51 },
    { code: '134', yield: 4573, plantingWeek: 50 },
    { code: '143', yield: 4295, plantingWeek: 51 },
    { code: '723', yield: 3468, plantingWeek: 51 },
    { code: '874', yield: 3402, plantingWeek: 51 },
    { code: '195', yield: 3397, plantingWeek: 51 }, // F5 - just above avg
    { code: '181', yield: 3272, plantingWeek: 51 },
    { code: 'AVR', yield: 2786, plantingWeek: 0 },
  ],
};

// === FIXTURE: Maravilla Substrate Green cane — F1 last of 2 (3 with avg) ===
const MARAVILLA_GREEN = {
  title: 'Maravilla Substrate Green cane',
  category: 'raspberry',
  unit: 'kg/ha',
  average: 12391,
  growers: [
    { code: '193', yield: 16354, plantingWeek: 46 },
    { code: 'Average', yield: 12391, plantingWeek: 0 },
    { code: '172', yield: 8786, plantingWeek: 46 }, // F1 - 2/2
  ],
};

test('percentileThreshold: empty/single inputs', () => {
  assert.equal(percentileThreshold([], 0.75), null);
  assert.equal(percentileThreshold([100], 0.75), 100);
});

test('percentileThreshold: 20 sorted descending values → top 25% threshold = 5th element', () => {
  const yields = Array.from({ length: 20 }, (_, i) => 100 - i); // 100, 99, ..., 81
  // floor(20 * 0.25) - 1 = 5 - 1 = 4 → yield at index 4 = 96
  assert.equal(percentileThreshold(yields, 0.75), 96);
});

test('enrichTreatment: F1 (172) ranks dead last in Maravilla TP Substrate Primocane (W18)', () => {
  const enriched = enrichTreatment(MARAVILLA_TP_SUB_PRIMO);
  assert.equal(enriched.totalGrowers, 19, 'Average excluded from count');
  assert.ok(enriched.f1, 'F1 found');
  assert.equal(enriched.f1.code, '172');
  assert.equal(enriched.f1.yield, 5999);
  assert.equal(enriched.f1.rank, 19);
  assert.equal(enriched.f1.rankTotal, 19);
  assert.equal(enriched.f1.inTop25, false, 'F1 NOT in top 25%');
  assert.ok(enriched.f1.vsAveragePct < -40, 'F1 well below avg');
  assert.equal(enriched.f5, null, 'F5 absent from this treatment');
});

test('enrichTreatment: top25Threshold computed correctly (19 growers → 4th best = top25 cutoff)', () => {
  const enriched = enrichTreatment(MARAVILLA_TP_SUB_PRIMO);
  // With 19 growers and top 25% rule (rank/19 ≤ 0.25 → rank ≤ 4.75 → rank ≤ 4),
  // the cutoff yield is the 4th best = 14471. Anyone yielding >= 14471 is in top 25%.
  assert.equal(enriched.top25Threshold, 14471);
});

test('enrichTreatment: F5 (195) above average in Yazmin TP Soil Cut Back', () => {
  const enriched = enrichTreatment(YAZMIN_TP_SOIL_CB);
  assert.ok(enriched.f5);
  assert.equal(enriched.f5.code, '195');
  assert.equal(enriched.f5.yield, 3397);
  assert.ok(enriched.f5.vsAveragePct > 0, 'F5 above avg');
  assert.equal(enriched.f1, null, 'F1 absent');
});

test('enrichTreatment: 2-grower treatment (Maravilla Green) — F1 ranks 2/2', () => {
  const enriched = enrichTreatment(MARAVILLA_GREEN);
  assert.equal(enriched.totalGrowers, 2);
  assert.equal(enriched.f1.rank, 2);
  assert.equal(enriched.f1.rankTotal, 2);
  assert.equal(enriched.f1.inTop25, false);
});

test('enrichTreatment: excludes Average / AVG / AVR / Moyenne synonyms', () => {
  const t = enrichTreatment({
    title: 'Test',
    average: 100,
    growers: [
      { code: '193', yield: 200 },
      { code: 'Average', yield: 100 },
      { code: 'AVG', yield: 100 },
      { code: 'AVR', yield: 100 },
      { code: 'Moyenne', yield: 100 },
      { code: '172', yield: 50 },
    ],
  });
  assert.equal(t.totalGrowers, 2, 'Only 2 real growers');
});

test('buildFarmSummary: aggregates F1/F5 stats across treatments', () => {
  const enriched = enrichTreatments([MARAVILLA_TP_SUB_PRIMO, YAZMIN_TP_SOIL_CB, MARAVILLA_GREEN]);
  const summary = buildFarmSummary(enriched);
  assert.equal(summary.f1.present, 2, 'F1 in 2 treatments (Primo + Green)');
  assert.equal(summary.f1.inTop25, 0, 'F1 in 0 top25');
  assert.equal(summary.f5.present, 1, 'F5 in 1 treatment (Cut Back)');
});
