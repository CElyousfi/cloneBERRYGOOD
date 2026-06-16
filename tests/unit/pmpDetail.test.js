'use strict';

/**
 * Unit tests for functions/lib/stock/pmpDetail.js
 * Run with: npm run test:unit
 *
 * Couvre : canon, canonUnite, isTonne, normalizeFactureLine, dominantUnite,
 * computeFacturePMP (PMP facturé pondéré + cohérence d'unité + normalisation Tonne→KG).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canon,
  canonUnite,
  isTonne,
  normalizeFactureLine,
  dominantUnite,
  computeFacturePMP,
} = require('../../functions/lib/stock/pmpDetail');

// ---------- canon ----------
test('canon — MAJUSCULE, trim, espaces, suffixe unité retiré', () => {
  assert.equal(canon('  acide phosphorique  '), 'ACIDE PHOSPHORIQUE');
  assert.equal(canon('Acide Phosphorique (L)'), 'ACIDE PHOSPHORIQUE');
  assert.equal(canon('NITRATE   POTASSIUM (KG)'), 'NITRATE POTASSIUM');
  assert.equal(canon(null), '');
});

// ---------- canonUnite ----------
test('canonUnite — Tonne et variantes → KG', () => {
  assert.equal(canonUnite('T'), 'KG');
  assert.equal(canonUnite('tonne'), 'KG');
  assert.equal(canonUnite('TONNES'), 'KG');
  assert.equal(canonUnite('kgs'), 'KG');
  assert.equal(canonUnite('Litre'), 'L');
  assert.equal(canonUnite('u'), 'UNITE');
  assert.equal(canonUnite(''), '');
});

// ---------- isTonne ----------
test('isTonne', () => {
  assert.equal(isTonne('T'), true);
  assert.equal(isTonne('TONNE'), true);
  assert.equal(isTonne('KG'), false);
  assert.equal(isTonne('L'), false);
});

// ---------- normalizeFactureLine ----------
test('normalizeFactureLine — KG conservé tel quel', () => {
  const n = normalizeFactureLine({ quantite: 100, unite: 'KG', prix_unitaire: 12 });
  assert.equal(n.qte, 100);
  assert.equal(n.prix_unitaire, 12);
  assert.equal(n.unite_norm, 'KG');
});

test('normalizeFactureLine — Tonne→KG : qté ×1000, PU ÷1000', () => {
  const n = normalizeFactureLine({ quantite: 2, unite: 'T', prix_unitaire: 5000 });
  assert.equal(n.qte, 2000); // 2 t → 2000 kg
  assert.equal(n.prix_unitaire, 5); // 5000 DH/t → 5 DH/kg
  assert.equal(n.unite_norm, 'KG');
  assert.equal(n.unite_origine, 'T');
});

test('normalizeFactureLine — valeurs absentes → 0', () => {
  const n = normalizeFactureLine({ unite: 'L' });
  assert.equal(n.qte, 0);
  assert.equal(n.prix_unitaire, 0);
  assert.equal(n.unite_norm, 'L');
});

// ---------- dominantUnite ----------
test('dominantUnite — unité majoritaire en quantité', () => {
  const lines = [
    { qte: 10, unite_norm: 'L' },
    { qte: 200, unite_norm: 'KG' },
    { qte: 5, unite_norm: 'L' },
  ];
  assert.equal(dominantUnite(lines), 'KG');
});

test('dominantUnite — ignore unité vide', () => {
  const lines = [{ qte: 999, unite_norm: '' }, { qte: 3, unite_norm: 'L' }];
  assert.equal(dominantUnite(lines), 'L');
});

// ---------- computeFacturePMP ----------
test('computeFacturePMP — unité cohérente KG : PMP pondéré direct', () => {
  const lines = [
    { numero_facture: 'F1', date_facture: '2025-07-01', article: 'X', quantite: 100, unite: 'KG', prix_unitaire: 10 },
    { numero_facture: 'F2', date_facture: '2025-07-05', article: 'X', quantite: 300, unite: 'KG', prix_unitaire: 14 },
  ];
  const r = computeFacturePMP(lines, 'KG');
  assert.equal(r.coherence_unite, 'ok');
  assert.equal(r.unite_dominante, 'KG');
  // (100*10 + 300*14) / 400 = (1000 + 4200)/400 = 13
  assert.equal(r.pmp_pondere, 13);
  assert.equal(r.note, null);
  assert.equal(r.lignes.length, 2);
  assert.equal(r.lignes[0].coherente, true);
});

test('computeFacturePMP — Tonne normalisée puis PMP en DH/kg', () => {
  const lines = [
    { numero_facture: 'F1', date_facture: '2025-07-01', article: 'X', quantite: 1, unite: 'T', prix_unitaire: 3000 },
  ];
  const r = computeFacturePMP(lines, 'KG');
  assert.equal(r.coherence_unite, 'ok');
  assert.equal(r.unite_dominante, 'KG');
  // 1 t → 1000 kg @ 3 DH/kg → PMP = 3
  assert.equal(r.pmp_pondere, 3);
  assert.equal(r.lignes[0].qte, 1000);
  assert.equal(r.lignes[0].prix_unitaire, 3);
});

test('computeFacturePMP — unité divergente (facture KG, stock L) : aucune densité fabriquée', () => {
  const lines = [
    { numero_facture: 'F1', date_facture: '2025-07-01', article: 'X', quantite: 50, unite: 'KG', prix_unitaire: 8 },
  ];
  const r = computeFacturePMP(lines, 'L');
  assert.equal(r.coherence_unite, 'divergente');
  assert.equal(r.pmp_pondere, null);
  assert.match(r.note, /conversion densité requise/i);
  assert.equal(r.lignes[0].coherente, false);
});

test('computeFacturePMP — aucune facture', () => {
  const r = computeFacturePMP([], 'KG');
  assert.equal(r.lignes.length, 0);
  assert.equal(r.pmp_pondere, null);
  assert.equal(r.coherence_unite, 'inconnue');
});

test('computeFacturePMP — unité stock absente → inconnue', () => {
  const lines = [{ numero_facture: 'F1', quantite: 10, unite: 'KG', prix_unitaire: 5 }];
  const r = computeFacturePMP(lines, '');
  assert.equal(r.coherence_unite, 'inconnue');
  assert.equal(r.pmp_pondere, null);
});

test('computeFacturePMP — PMP ignore lignes incohérentes même si unité dominante OK', () => {
  // dominante = KG (cohérent stock), mais une ligne L doit être exclue du PMP
  const lines = [
    { numero_facture: 'F1', quantite: 100, unite: 'KG', prix_unitaire: 10 },
    { numero_facture: 'F2', quantite: 1, unite: 'L', prix_unitaire: 999 },
  ];
  const r = computeFacturePMP(lines, 'KG');
  assert.equal(r.coherence_unite, 'ok');
  assert.equal(r.pmp_pondere, 10); // seule la ligne KG compte
  assert.equal(r.lignes.find((l) => l.unite === 'L').coherente, false);
});
