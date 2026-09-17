'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  scanFournisseurLabel,
  scanTtc,
  scanBdcMatche,
} = require('./_esm').loadEsm('src/modules/shared/lib/scanHistoryDisplay.js');

// --- scanFournisseurLabel -------------------------------------------------

test('scanFournisseurLabel: SCAN-IA object shape takes priority', () => {
  const s = { analysis: { fournisseur: { nom: 'OCP SA', ice: '123' } } };
  assert.strictEqual(scanFournisseurLabel(s), 'OCP SA');
});

test('scanFournisseurLabel: TIMAC backfill string shape', () => {
  const s = { analysis: { fournisseur: 'TIMAC AGRO MAROC' } };
  assert.strictEqual(scanFournisseurLabel(s), 'TIMAC AGRO MAROC');
});

test('scanFournisseurLabel: falls back to top-level fournisseur object', () => {
  const s = { analysis: {}, fournisseur: { nom: 'Fallback SARL' } };
  assert.strictEqual(scanFournisseurLabel(s), 'Fallback SARL');
});

test('scanFournisseurLabel: object shape wins even if a top-level string exists', () => {
  const s = { analysis: { fournisseur: { nom: 'Primary' } }, fournisseur: { nom: 'Other' } };
  assert.strictEqual(scanFournisseurLabel(s), 'Primary');
});

test('scanFournisseurLabel: empty/missing returns dash', () => {
  assert.strictEqual(scanFournisseurLabel({}), '—');
  assert.strictEqual(scanFournisseurLabel({ analysis: { fournisseur: '   ' } }), '—');
  assert.strictEqual(scanFournisseurLabel(null), '—');
});

// --- scanTtc --------------------------------------------------------------

test('scanTtc: SCAN-IA total_ttc takes priority', () => {
  assert.strictEqual(scanTtc({ analysis: { total_ttc: 1234.5 } }), 1234.5);
});

test('scanTtc: TIMAC net_a_payer fallback', () => {
  assert.strictEqual(scanTtc({ analysis: { net_a_payer: 987.65 } }), 987.65);
});

test('scanTtc: total_ttc wins over net_a_payer when both present', () => {
  assert.strictEqual(scanTtc({ analysis: { total_ttc: 100, net_a_payer: 200 } }), 100);
});

test('scanTtc: top-level total_ttc fallback', () => {
  assert.strictEqual(scanTtc({ analysis: {}, total_ttc: 50 }), 50);
});

test('scanTtc: numeric string is coerced', () => {
  assert.strictEqual(scanTtc({ analysis: { net_a_payer: '4200.00' } }), 4200);
});

test('scanTtc: zero is a valid value (not treated as missing)', () => {
  assert.strictEqual(scanTtc({ analysis: { total_ttc: 0 } }), 0);
});

test('scanTtc: missing / non-numeric returns null', () => {
  assert.strictEqual(scanTtc({}), null);
  assert.strictEqual(scanTtc({ analysis: {} }), null);
  assert.strictEqual(scanTtc({ analysis: { net_a_payer: 'abc' } }), null);
  assert.strictEqual(scanTtc(null), null);
});

// --- scanBdcMatche --------------------------------------------------------

test('scanBdcMatche: SCAN-IA matched_bdc_numero takes priority', () => {
  assert.strictEqual(scanBdcMatche({ matched_bdc_numero: 'BDC-001' }), 'BDC-001');
});

test('scanBdcMatche: TIMAC bdc_numero fallback', () => {
  assert.strictEqual(scanBdcMatche({ bdc_numero: 'BDC-TIMAC-09' }), 'BDC-TIMAC-09');
});

test('scanBdcMatche: matched_bdc.numero fallback', () => {
  assert.strictEqual(scanBdcMatche({ matched_bdc: { numero: 'BDC-OBJ' } }), 'BDC-OBJ');
});

test('scanBdcMatche: matched_bdc_numero wins over bdc_numero', () => {
  assert.strictEqual(scanBdcMatche({ matched_bdc_numero: 'A', bdc_numero: 'B' }), 'A');
});

test('scanBdcMatche: absent returns dash', () => {
  assert.strictEqual(scanBdcMatche({}), '—');
  assert.strictEqual(scanBdcMatche(null), '—');
});
