'use strict';

/**
 * Unit tests for functions/lib/stock/valuationPMP.js
 * Run with: npm run test:unit
 *
 * Couvre parsePrice, normalizePrice, resolveAcquisitionPrice, computePMP.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SOURCE_PRIORITY,
  parsePrice,
  normalizePrice,
  resolveAcquisitionPrice,
  computePMP,
} = require('../../functions/lib/stock/valuationPMP');

// ---------- parsePrice ----------
test('parsePrice — nombre direct', () => {
  assert.equal(parsePrice(2708.33), 2708.33);
  assert.equal(parsePrice(0), 0);
});

test('parsePrice — double virgule "2,708,33" → 2708.33', () => {
  assert.equal(parsePrice('2,708,33'), 2708.33);
});

test('parsePrice — virgule millier + point "2,120.00" → 2120', () => {
  assert.equal(parsePrice('2,120.00'), 2120);
});

test('parsePrice — virgule décimale simple "2,7" → 2.7', () => {
  assert.equal(parsePrice('2,7'), 2.7);
});

test('parsePrice — suffixe " DH"', () => {
  assert.equal(parsePrice('89,25 DH'), 89.25);
  assert.equal(parsePrice('100 DH'), 100);
});

test('parsePrice — "PERIMI" → 0', () => {
  assert.equal(parsePrice('PERIMI'), 0);
  assert.equal(parsePrice('Périmé'), 0);
});

test('parsePrice — texte non numérique → null', () => {
  assert.equal(parsePrice('besoin prix facture'), null);
});

test('parsePrice — vide / null → null', () => {
  assert.equal(parsePrice(''), null);
  assert.equal(parsePrice('   '), null);
  assert.equal(parsePrice(null), null);
  assert.equal(parsePrice(undefined), null);
});

// ---------- normalizePrice ----------
test('normalizePrice — ÷1000 si ratio > 100 (prix/tonne)', () => {
  // SULFATE DE MAGNESIE : 2708.33 ancré sur 2.7
  const r = normalizePrice(2708.33, 2.7);
  assert.equal(r.action, 'div1000');
  assert.ok(Math.abs(r.value - 2.70833) < 1e-6);
});

test('normalizePrice — suspect si 10 < ratio <= 100, non auto-corrigé', () => {
  const r = normalizePrice(50, 2.7); // ratio ~18.5
  assert.equal(r.action, 'suspect');
  assert.equal(r.suspect, true);
  assert.equal(r.value, 50); // valeur conservée, juste signalée
});

test('normalizePrice — keep si ratio <= 10', () => {
  const r = normalizePrice(3, 2.7);
  assert.equal(r.action, 'keep');
  assert.equal(r.value, 3);
});

test('normalizePrice — keep si ancre absente ou nulle', () => {
  assert.equal(normalizePrice(2708.33, 0).action, 'keep');
  assert.equal(normalizePrice(2708.33).action, 'keep');
  assert.equal(normalizePrice(2708.33, 0).value, 2708.33);
});

// ---------- resolveAcquisitionPrice ----------
test('resolveAcquisitionPrice — priorité bon_commande > bon_entree > inventaire', () => {
  const r = resolveAcquisitionPrice(
    { inventaire: 2.7, bon_entree: 2.9, bon_commande: 3.1 },
    2.7
  );
  assert.equal(r.source, 'bon_commande');
  assert.equal(r.value, 3.1);
});

test('resolveAcquisitionPrice — descend si source prioritaire illisible', () => {
  const r = resolveAcquisitionPrice(
    { bon_entree: 'besoin prix facture', inventaire: 2.7 },
    2.7
  );
  assert.equal(r.source, 'inventaire');
  assert.equal(r.value, 2.7);
});

test('resolveAcquisitionPrice — normalise la source retenue (bon_entree /tonne)', () => {
  const r = resolveAcquisitionPrice({ bon_entree: '2,708,33' }, 2.7);
  assert.equal(r.source, 'bon_entree');
  assert.equal(r.action, 'div1000');
  assert.ok(Math.abs(r.value - 2.70833) < 1e-6);
});

test('resolveAcquisitionPrice — aucune source lisible → null', () => {
  assert.equal(resolveAcquisitionPrice({ bon_entree: '' }, 2.7).value, null);
  assert.equal(resolveAcquisitionPrice({}, 2.7).source, null);
  assert.equal(resolveAcquisitionPrice(null).value, null);
});

test('SOURCE_PRIORITY — ordre attendu', () => {
  assert.deepEqual(SOURCE_PRIORITY, ['facture', 'bon_commande', 'bon_entree', 'inventaire']);
});

// ---------- computePMP ----------
test('computePMP — moyenne pondérée correcte', () => {
  // 100 @ 2 (inventaire) + 50 @ 5 (bon_entree) = (200 + 250) / 150 = 3
  const out = computePMP([
    { qty: 100, pricesBySource: { inventaire: 2 }, anchor: 2 },
    { qty: 50, pricesBySource: { bon_entree: 5 }, anchor: 2 },
  ]);
  assert.equal(out.qtyTotal, 150);
  assert.equal(out.valueTotal, 450);
  assert.equal(out.pmp, 3);
  assert.equal(out.sourceBreakdown.inventaire, 1);
  assert.equal(out.sourceBreakdown.bon_entree, 1);
});

test('computePMP — ignore les acquisitions sans prix résolu', () => {
  const out = computePMP([
    { qty: 100, pricesBySource: { inventaire: 2 }, anchor: 2 },
    { qty: 999, pricesBySource: { bon_entree: 'besoin prix facture' }, anchor: 2 },
    { qty: 50, pricesBySource: {}, anchor: 2 },
  ]);
  assert.equal(out.qtyTotal, 100);
  assert.equal(out.pmp, 2);
  assert.equal(out.ignored, 2);
});

test('computePMP — ignore qty nulle/négative', () => {
  const out = computePMP([
    { qty: 0, pricesBySource: { inventaire: 2 }, anchor: 2 },
    { qty: 10, pricesBySource: { inventaire: 4 }, anchor: 4 },
  ]);
  assert.equal(out.qtyTotal, 10);
  assert.equal(out.pmp, 4);
  assert.equal(out.ignored, 1);
});

test('computePMP — normalise les prix /tonne avant pondération', () => {
  // 1000 @ "2,708,33" /tonne (→2.70833) + 200 @ 2.7
  const out = computePMP([
    { qty: 1000, pricesBySource: { bon_entree: '2,708,33' }, anchor: 2.7 },
    { qty: 200, pricesBySource: { bon_entree: 2.7 }, anchor: 2.7 },
  ]);
  assert.equal(out.qtyTotal, 1200);
  assert.ok(Math.abs(out.pmp - 2.7069) < 1e-3); // ≈ 2.7, pas 770
  assert.equal(out.suspects.length, 0);
});

test('computePMP — remonte les suspects (ratio 10–100)', () => {
  const out = computePMP([
    { qty: 100, pricesBySource: { bon_entree: 50 }, anchor: 2.7 },
  ]);
  assert.equal(out.suspects.length, 1);
  assert.equal(out.suspects[0].source, 'bon_entree');
  assert.equal(out.pmp, 50);
});

test('computePMP — liste vide → pmp null', () => {
  const out = computePMP([]);
  assert.equal(out.pmp, null);
  assert.equal(out.qtyTotal, 0);
});
