'use strict';

/**
 * Unit tests for functions/lib/productionEstimation.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../functions/lib/productionEstimation.js');
const { BUDGET_BGF } = require('../../functions/lib/budgetBgf.js');

// ---------------------------------------------------------------------------
// applyVarietyMapping
// ---------------------------------------------------------------------------

test('applyVarietyMapping: returns original when no batch number', () => {
  assert.equal(P.applyVarietyMapping({}, '', 'Maravilla'), 'Maravilla');
  assert.equal(P.applyVarietyMapping({}, null, 'Maravilla'), 'Maravilla');
});

test('applyVarietyMapping: returns mapped variety from 4-char code', () => {
  const m = { '172-R010': 'Maravilla Green Cane' };
  assert.equal(P.applyVarietyMapping(m, 'BGF172-R0103', 'Original'), 'Maravilla Green Cane');
});

test('applyVarietyMapping: falls back to 3-char legacy code', () => {
  const m = { '172-R01': 'Yazmin Bi Cycle' };
  assert.equal(P.applyVarietyMapping(m, 'BGF172-R0103', 'Original'), 'Yazmin Bi Cycle');
});

test('applyVarietyMapping: falls back to original when no mapping', () => {
  assert.equal(P.applyVarietyMapping({}, 'BGF172-R0103', 'Maravilla'), 'Maravilla');
});

// ---------------------------------------------------------------------------
// parseExpDateISO
// ---------------------------------------------------------------------------

test('parseExpDateISO: MM/DD/YYYY (Driscoll) → YYYY-MM-DD', () => {
  // 05/15/2026 = May 15, 2026
  assert.equal(P.parseExpDateISO('05/15/2026'), '2026-05-15');
  // 09/29/2025 = September 29 — proves the parser is MM/DD (29 invalid as month)
  assert.equal(P.parseExpDateISO('09/29/2025'), '2025-09-29');
});

test('parseExpDateISO: ISO string passes through (first 10 chars)', () => {
  assert.equal(P.parseExpDateISO('2026-05-15T12:00:00'), '2026-05-15');
});

test('parseExpDateISO: empty/garbage → ""', () => {
  assert.equal(P.parseExpDateISO(''), '');
  assert.equal(P.parseExpDateISO('garbage'), '');
});

// ---------------------------------------------------------------------------
// normalizeBon
// ---------------------------------------------------------------------------

test('normalizeBon: maps Driscoll typeVente to Export', () => {
  const b = P.normalizeBon({
    designation: 'MARAVILLA GG F1', poidsLot: '500', date: '2026-05-10',
    typeVente: "Driscoll's", status: 'valide',
  });
  assert.equal(b.typeVente, 'Export');
  assert.equal(b.variety, 'Maravilla Green Cane');
  assert.equal(b.kg, 500);
  assert.equal(b.cycle, 2);
  assert.equal(b.culture, 'Framboise');
});

test('normalizeBon: maps ECRT to Marché Local', () => {
  const b = P.normalizeBon({
    designation: 'F5 CORINA', poidsLot: '100', date: '2026-05-10',
    typeVente: 'ECRT',
  });
  assert.equal(b.typeVente, 'Marché Local');
  assert.equal(b.variety, 'Corina');
  assert.equal(b.culture, 'Myrtille');
});

test('normalizeBon: filters rejected bons', () => {
  assert.equal(P.normalizeBon({ designation: 'X', poidsLot: 100, status: 'rejete_qualite' }), null);
  assert.equal(P.normalizeBon({ designation: 'X', poidsLot: 100, status: 'rejete_chef' }), null);
});

test('normalizeBon: filters DECHET/PLASTIQUE/etc', () => {
  assert.equal(P.normalizeBon({ designation: 'CARTON VIDE', poidsLot: 50 }), null);
  assert.equal(P.normalizeBon({ designation: 'PALETTE BOIS', poidsLot: 30 }), null);
  assert.equal(P.normalizeBon({ designation: 'Foobar DECHET', poidsLot: 10 }), null);
});

test('normalizeBon: filters kg <= 0', () => {
  assert.equal(P.normalizeBon({ designation: 'MARAVILLA', poidsLot: 0 }), null);
  assert.equal(P.normalizeBon({ designation: 'MARAVILLA', poidsLot: '-5' }), null);
});

// ---------------------------------------------------------------------------
// buildMappedWithEstimation
// ---------------------------------------------------------------------------

const today = '2026-05-16';

test('buildMappedWithEstimation: no expeditions returns mapped only', () => {
  const bons = [
    { designation: 'MARAVILLA GG F1', poidsLot: 1000, date: '2026-05-10', typeVente: 'EXP' },
  ];
  const out = P.buildMappedWithEstimation({ bons, expeditions: [], asOfDate: today });
  assert.equal(out.length, 1);
  assert.equal(out[0].variety, 'Maravilla Green Cane');
  assert.equal(out[0]._isEstimation, undefined);
});

test('buildMappedWithEstimation: expedition AFTER last bon adds synthetic', () => {
  const bons = [
    { designation: 'MARAVILLA GG F1', poidsLot: 1000, date: '2026-05-10', typeVente: 'EXP' },
  ];
  const expeditions = [
    { date: '05/15/2026', batchNumber: 'BGF172-R0103', batchWeight: '500', variety: 'Maravilla GC' },
  ];
  const out = P.buildMappedWithEstimation({ bons, expeditions, asOfDate: today });
  assert.equal(out.length, 2);
  const synth = out.find(b => b._isEstimation);
  assert.equal(synth.variety, 'Maravilla Green Cane');
  assert.equal(synth.kg, 500);
  assert.equal(synth.typeVente, 'Export');
  assert.equal(synth.dateISO, '2026-05-15');
});

test('buildMappedWithEstimation: expedition BEFORE last bon is ignored', () => {
  const bons = [
    { designation: 'MARAVILLA GG F1', poidsLot: 1000, date: '2026-05-15', typeVente: 'EXP' },
  ];
  const expeditions = [
    { date: '05/10/2026', batchNumber: 'BGF172-R0103', batchWeight: '500', variety: 'Maravilla GC' },
  ];
  const out = P.buildMappedWithEstimation({ bons, expeditions, asOfDate: today });
  assert.equal(out.length, 1);
  assert.equal(out.find(b => b._isEstimation), undefined);
});

test('buildMappedWithEstimation: skips REJECT and Annulée expeditions', () => {
  const bons = [{ designation: 'MARAVILLA GG F1', poidsLot: 1000, date: '2026-05-10', typeVente: 'EXP' }];
  const expeditions = [
    { date: '05/15/2026', batchNumber: 'B1', batchWeight: '200', variety: 'Maravilla GC', overallResult: 'REJECT' },
    { date: '05/15/2026', batchNumber: 'B2', batchWeight: '300', variety: 'Maravilla GC', status: 'Annulée par le client' },
    { date: '05/15/2026', batchNumber: 'B3', batchWeight: '400', variety: 'Maravilla GC' },
  ];
  const out = P.buildMappedWithEstimation({ bons, expeditions, asOfDate: today });
  const synth = out.filter(b => b._isEstimation);
  assert.equal(synth.length, 1);
  assert.equal(synth[0].kg, 400);
});

test('buildMappedWithEstimation: dedupes expeditions by batchNumber', () => {
  const bons = [{ designation: 'MARAVILLA GG F1', poidsLot: 1000, date: '2026-05-10', typeVente: 'EXP' }];
  const expeditions = [
    { date: '05/15/2026', batchNumber: 'SAME', batchWeight: '500', variety: 'Maravilla GC' },
    { date: '05/15/2026', batchNumber: 'SAME', batchWeight: '500', variety: 'Maravilla GC' },
  ];
  const out = P.buildMappedWithEstimation({ bons, expeditions, asOfDate: today });
  assert.equal(out.filter(b => b._isEstimation).length, 1);
});

test('buildMappedWithEstimation: skips expedition dated > asOfDate', () => {
  const bons = [{ designation: 'MARAVILLA GG F1', poidsLot: 1000, date: '2026-05-10', typeVente: 'EXP' }];
  const expeditions = [
    { date: '05/20/2026', batchNumber: 'B1', batchWeight: '500', variety: 'Maravilla GC' },
  ];
  const out = P.buildMappedWithEstimation({ bons, expeditions, asOfDate: '2026-05-15' });
  assert.equal(out.filter(b => b._isEstimation).length, 0);
});

test('buildMappedWithEstimation: ghost PFQ expedition (source=email no receiptId no variety) skipped', () => {
  const bons = [{ designation: 'MARAVILLA GG F1', poidsLot: 1000, date: '2026-05-10', typeVente: 'EXP' }];
  const expeditions = [
    { date: '05/15/2026', batchNumber: 'B1', batchWeight: '500', source: 'email' },
  ];
  const out = P.buildMappedWithEstimation({ bons, expeditions, asOfDate: today });
  assert.equal(out.filter(b => b._isEstimation).length, 0);
});

test('buildMappedWithEstimation: variety mapping override via batchNumber', () => {
  const bons = [{ designation: 'F5 CORINA', poidsLot: 200, date: '2026-05-10', typeVente: 'EXP' }];
  const expeditions = [
    { date: '05/15/2026', batchNumber: 'BGF195-R5010', batchWeight: '300', variety: 'WRONG' },
  ];
  const varietyMapping = { '195-R501': 'Corina' };
  const out = P.buildMappedWithEstimation({ bons, expeditions, varietyMapping, asOfDate: today });
  const synth = out.find(b => b._isEstimation);
  assert.equal(synth.variety, 'Corina');
});

test('buildMappedWithEstimation: asOfDate filters bons too', () => {
  const bons = [
    { designation: 'MARAVILLA GG F1', poidsLot: 1000, date: '2026-05-10', typeVente: 'EXP' },
    { designation: 'MARAVILLA GG F1', poidsLot: 500, date: '2026-05-20', typeVente: 'EXP' },
  ];
  const out = P.buildMappedWithEstimation({ bons, expeditions: [], asOfDate: '2026-05-15' });
  assert.equal(out.length, 1);
  assert.equal(out[0].kg, 1000);
});

// ---------------------------------------------------------------------------
// computeCycle2Stats
// ---------------------------------------------------------------------------

test('computeCycle2Stats: returns all 6 varieties (zero filled when absent)', () => {
  const stats = P.computeCycle2Stats([]);
  assert.equal(stats.length, 6);
  assert.deepEqual(stats.map(s => s.variety), P.CYCLE2_VARIETIES);
  stats.forEach(s => assert.equal(s.kgExport, 0));
});

test('computeCycle2Stats: aggregates kgExport and kgLocal per variety', () => {
  const mapped = [
    { variety: 'Maravilla Green Cane', cycle: 2, typeVente: 'Export',       kg: 5000 },
    { variety: 'Maravilla Green Cane', cycle: 2, typeVente: 'Export',       kg: 3000 },
    { variety: 'Maravilla Green Cane', cycle: 2, typeVente: 'Marché Local', kg: 1000 },
    { variety: 'Corina',                cycle: 2, typeVente: 'Export',       kg: 2000 },
  ];
  const stats = P.computeCycle2Stats(mapped);
  const mar = stats.find(s => s.variety === 'Maravilla Green Cane');
  assert.equal(mar.kgExport, 8000);
  assert.equal(mar.kgLocal, 1000);
  assert.equal(mar.pctLocal, '11.1');
  const cor = stats.find(s => s.variety === 'Corina');
  assert.equal(cor.kgExport, 2000);
});

test('computeCycle2Stats: T/Ha for Framboise', () => {
  // Maravilla Green Cane cycle 2: ha = 4.0 (from parcellesCulturales)
  // Budget total = 13000
  // 12 000 kg / 4 Ha = 3 T/Ha → 3000 / 13000 * 100 = 23%
  const mapped = [
    { variety: 'Maravilla Green Cane', cycle: 2, typeVente: 'Export', kg: 12000 },
  ];
  const stats = P.computeCycle2Stats(mapped);
  const mar = stats.find(s => s.variety === 'Maravilla Green Cane');
  assert.equal(mar.ha, 4.0);
  assert.equal(mar.rendement, '3.00');
  assert.equal(mar.rendementLabel, 'T/Ha');
  assert.equal(mar.tonnageExport, '12.00');
  assert.equal(mar.pctBudget, '23');
});

test('computeCycle2Stats: Kg/Pl for Myrtille (kg/plant >= 1)', () => {
  // Corina cycle 2 myrtille: plants = 8250
  // 16500 kg / 8250 plants = 2 Kg/Pl
  // ha=2.5, budget total = 13200 → 16500/2.5 = 6600 → 6600/13200*100 = 50%
  const mapped = [
    { variety: 'Corina', cycle: 2, typeVente: 'Export', kg: 16500 },
  ];
  const stats = P.computeCycle2Stats(mapped);
  const cor = stats.find(s => s.variety === 'Corina');
  assert.equal(cor.plants, 8250);
  assert.equal(cor.rendement, '2.00');
  assert.equal(cor.rendementLabel, 'Kg/Pl');
  assert.equal(cor.pctBudget, '50');
});

test('computeCycle2Stats: g/Pl for Myrtille when kg/plant < 1', () => {
  const mapped = [
    { variety: 'Corina', cycle: 2, typeVente: 'Export', kg: 4125 }, // 4125/8250 = 0.5
  ];
  const stats = P.computeCycle2Stats(mapped);
  const cor = stats.find(s => s.variety === 'Corina');
  assert.equal(cor.rendement, '500');
  assert.equal(cor.rendementLabel, 'g/Pl');
});

test('computeCycle2Stats: ignores cycle 1 entries', () => {
  const mapped = [
    { variety: 'Maravilla Green Cane', cycle: 1, typeVente: 'Export', kg: 5000 },
  ];
  const stats = P.computeCycle2Stats(mapped);
  assert.equal(stats.find(s => s.variety === 'Maravilla Green Cane').kgExport, 0);
});

test('computeCycle2Stats: ignores varieties outside CYCLE2_VARIETIES', () => {
  const mapped = [
    { variety: 'Reyna', cycle: 2, typeVente: 'Export', kg: 5000 },
  ];
  const stats = P.computeCycle2Stats(mapped);
  // All 6 still returned, but zero
  stats.forEach(s => assert.equal(s.kgExport, 0));
});

// ---------------------------------------------------------------------------
// formatCycle2Section
// ---------------------------------------------------------------------------

test('formatCycle2Section: contains both sections and all 6 varieties', () => {
  const stats = P.computeCycle2Stats([
    { variety: 'Maravilla Green Cane', cycle: 2, typeVente: 'Export', kg: 12000 },
    { variety: 'Corina',                cycle: 2, typeVente: 'Export', kg: 16500 },
  ]);
  const msg = P.formatCycle2Section(stats);
  assert.match(msg, /Estimation Cycle 2/);
  assert.match(msg, /🍇 \*Framboise\*/);
  assert.match(msg, /🫐 \*Myrtille\*/);
  P.CYCLE2_VARIETIES.forEach(v => assert.match(msg, new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));
});

test('formatCycle2Section: rendered line includes Budget + Local + Export', () => {
  const stats = P.computeCycle2Stats([
    { variety: 'Maravilla Green Cane', cycle: 2, typeVente: 'Export', kg: 12000 },
  ]);
  const msg = P.formatCycle2Section(stats);
  assert.match(msg, /Maravilla Green Cane.*3\.00 T\/Ha/s);
  assert.match(msg, /Budget: 23%/);
  assert.match(msg, /Local: 0\.0%/);
  assert.match(msg, /Export: 12\.00 T/);
});

test('formatCycle2Section: includes plant count for Myrtille', () => {
  const stats = P.computeCycle2Stats([
    { variety: 'Corina', cycle: 2, typeVente: 'Export', kg: 16500 },
  ]);
  const msg = P.formatCycle2Section(stats);
  // Corina has 8250 plants (cycle 1 + cycle 2 both with 8250 each = 16500)
  // getPlants(Corina,null,2) reduces over cycle 2 → 8250
  assert.match(msg, /8[\s ]?250 pl\./);
});

// ---------------------------------------------------------------------------
// BUDGET_BGF has all 6 cycle-2 varieties
// ---------------------------------------------------------------------------

test('BUDGET_BGF: contains all 6 cycle-2 varieties', () => {
  P.CYCLE2_VARIETIES.forEach(v => {
    assert.ok(BUDGET_BGF[v], `Missing budget for ${v}`);
    assert.ok(BUDGET_BGF[v].total > 0, `Zero budget for ${v}`);
  });
});

// ---------------------------------------------------------------------------
// sumExportKgForDocs — KPI Transport fruits / kg exporté
// ---------------------------------------------------------------------------

test('sumExportKgForDocs: sums only Export-canonical typeVente', () => {
  const docs = [
    { typeVente: 'EXP', poidsLot: 100 },
    { typeVente: "Driscoll's", poidsLot: 50 },
    { typeVente: 'Export', poidsLot: 25 },
    { typeVente: 'ECRT', poidsLot: 999 },        // Marché Local → exclu
    { typeVente: 'Autre', poidsLot: 999 },        // exclu
  ];
  assert.equal(P.sumExportKgForDocs(docs), 175);
});

test('sumExportKgForDocs: missing/invalid poidsLot counts as 0', () => {
  const docs = [
    { typeVente: 'EXP' },                          // pas de poidsLot
    { typeVente: 'EXP', poidsLot: null },
    { typeVente: 'EXP', poidsLot: 'abc' },
    { typeVente: 'EXP', poidsLot: -10 },           // négatif ignoré
    { typeVente: 'EXP', poidsLot: '40.5' },        // string numérique OK
  ];
  assert.equal(P.sumExportKgForDocs(docs), 40.5);
});

test('sumExportKgForDocs: excludes rejected bons', () => {
  const docs = [
    { typeVente: 'EXP', poidsLot: 100, status: 'rejete_qualite' },
    { typeVente: 'EXP', poidsLot: 30, status: 'rejete_chef' },
    { typeVente: 'EXP', poidsLot: 70, status: 'valide' },
  ];
  assert.equal(P.sumExportKgForDocs(docs), 70);
});

test('sumExportKgForDocs: non-array / empty → 0', () => {
  assert.equal(P.sumExportKgForDocs(null), 0);
  assert.equal(P.sumExportKgForDocs(undefined), 0);
  assert.equal(P.sumExportKgForDocs([]), 0);
  assert.equal(P.sumExportKgForDocs([null, undefined]), 0);
});

test('canonicalTypeVente: maps aliases', () => {
  assert.equal(P.canonicalTypeVente('EXP'), 'Export');
  assert.equal(P.canonicalTypeVente("Driscoll's"), 'Export');
  assert.equal(P.canonicalTypeVente('Export'), 'Export');
  assert.equal(P.canonicalTypeVente('ECRT'), 'Marché Local');
  assert.equal(P.canonicalTypeVente(''), '');
  assert.equal(P.canonicalTypeVente(undefined), '');
});
