'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseLiquidationSummaryText } = require('../../functions/emailService');

// Sample text extracted from a real Driscoll's Myrtille liquidation PDF (W13 2026).
const BLUE_W13_TEXT = `LIQUIDATION Berry Good Farms SARL BLUE W 13
Date: 2026-04-27
Semaine: 13
Periode: 21/03/26 27/03/26
Numéro de liquidation: APIV-000085487
Total en Kg Base DED BLUE ADVANCE FRUIT Adjustment DEX LOAN Straw Plants Montant
2,775.00 189,012.31 23,859.28 119,080.47 - - - 46,072.57
0.00 0.00 0.00 0.00 0.00 0.00 46,072.57`;

// Synthetic raspberry text matching the older Framboise layout used in prod.
const RASP_TEXT = `LIQUIDATION Berry Good Farms SARL RASP W 12
Periode: 14/03/26 20/03/26
Numéro de liquidation: APIV-000084999
Total in Kg Base Fruit Advance DED Rasp Crop Advance DEX Adjustment PKG deduction Net Payable
3,226.50 231,656.27 0.00 14,500.00 50,000.00 - 0.00 166,156.27`;

// Raspberry-layout variant where column 4 header is "Plant Deduction" instead of "DED Rasp".
const RASP_PLANT_DED_TEXT = `LIQUIDATION Berry Good Farms SARL RASP W 11
Periode: 07/03/26 13/03/26
Numéro de liquidation: APIV-000084500
Total in Kg Base Fruit Advance Plant Deduction Crop Advance DEX Adjustment PKG deduction Net Payable
1,000.00 70,000.00 5,000.00 12,000.00 0.00 - 0.00 53,000.00`;

test('parseLiquidationSummaryText — Myrtille (Blue) layout W13', () => {
  const r = parseLiquidationSummaryText(BLUE_W13_TEXT);
  assert.ok(r, 'result not null');
  assert.strictEqual(r.liquidationNumber, 'APIV-000085487');
  assert.strictEqual(r.period, '21/03/26 - 27/03/26');
  assert.deepStrictEqual(r.summary, {
    totalKg: 2775,
    base: 189012.31,
    fruitAdvance: 119080.47,
    dedRasp: 0,
    dedPlants: 23859.28,
    cropAdvance: 0,
    dexAdjustment: 0,
    pkgDeduction: 0,
    netPayable: 46072.57,
  });
});

test('parseLiquidationSummaryText — Raspberry (Rasp) layout', () => {
  const r = parseLiquidationSummaryText(RASP_TEXT);
  assert.ok(r);
  assert.strictEqual(r.liquidationNumber, 'APIV-000084999');
  assert.deepStrictEqual(r.summary, {
    totalKg: 3226.5,
    base: 231656.27,
    fruitAdvance: 0,
    dedRasp: 14500,
    dedPlants: 0,
    cropAdvance: 50000,
    dexAdjustment: 0,
    pkgDeduction: 0,
    netPayable: 166156.27,
  });
});

test('parseLiquidationSummaryText — Raspberry "Plant Deduction" variant', () => {
  const r = parseLiquidationSummaryText(RASP_PLANT_DED_TEXT);
  assert.ok(r);
  assert.strictEqual(r.liquidationNumber, 'APIV-000084500');
  assert.deepStrictEqual(r.summary, {
    totalKg: 1000,
    base: 70000,
    fruitAdvance: 5000,
    dedRasp: 0,
    dedPlants: 12000,
    cropAdvance: 0,
    dexAdjustment: 0,
    pkgDeduction: 0,
    netPayable: 53000,
  });
});

test('parseLiquidationSummaryText — empty text returns null', () => {
  assert.strictEqual(parseLiquidationSummaryText(''), null);
  assert.strictEqual(parseLiquidationSummaryText(null), null);
});

test('parseLiquidationSummaryText — APIV without table still returns metadata', () => {
  const r = parseLiquidationSummaryText('Numéro de liquidation: APIV-000099999\nNo table here.');
  assert.ok(r);
  assert.strictEqual(r.liquidationNumber, 'APIV-000099999');
  assert.deepStrictEqual(r.summary, {});
});
