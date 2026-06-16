'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimacInvoiceText } = require('../../functions/emailService');

// Fixtures are plain-text extracts (as produced by pdf-parse) pasted inline.
// The 134 source PDFs are NOT in the repo, so these tests stay self-contained.

const HEADER = [
  'SOCIETE BERRY GOOD FARMS SARL\tFACTURE',
  '04789 23/01/2026 148865 AUTRES VENTES CONVENTIONNELS',
  'Code client Date Fac N° ATC',
  'Mode de règlement : Chèque',
  'Date échéance : 23/05/2026',
  'N° ICE : 002106859000069',
  'Article Désignation Quantité / Unité Rem Prix unitaire Montant',
  'BL N° :',
  'B.Cde N° : 126574',
  'Du : 23/01/2026',
  'Du : 21/01/2026',
  '132253-7',
].join('\n');

function build(articleLines, tvaLines, net) {
  return [
    HEADER,
    ...articleLines,
    "Régime TVA : Exonération de la TVA en vertu de l'article 8.5",
    'Mt TVA\tTaux\tBase\tCode Mt TTC',
    ...tvaLines,
    `${net}\tNet à Payer :`,
  ].join('\n');
}

test('ligne simple KG : code, qty, unite, PU, montant', () => {
  const text = build(
    ['0020 NITRATE DE CHAUX 25KG 1750,000 Kg 4,800 8 400,00'],
    ['8.400,00 0.00% 0.00\tC1 8.400,00'],
    '8 400,00'
  );
  const r = parseTimacInvoiceText(text);
  assert.equal(r.lignes.length, 1);
  const l = r.lignes[0];
  assert.equal(l.code_article, '0020');
  assert.equal(l.designation, 'NITRATE DE CHAUX 25KG');
  assert.equal(l.quantite, 1750);
  assert.equal(l.unite, 'Kg');
  assert.equal(l.prix_unitaire, 4.8);
  assert.equal(l.montant, 8400);
  assert.equal(r.reconciliation.ok, true);
});

test('ligne Tonne avec PU à 3 décimales (2 708,331)', () => {
  const text = build(
    ['0340 SULFATE DE MAGNESIE 16 % X 25 KG 1,750 Tonne 2 708,331 4 739,58'],
    ['4.739,58 0.00% 0.00\tC1 4.739,58'],
    '4 739,58'
  );
  const r = parseTimacInvoiceText(text);
  const l = r.lignes[0];
  assert.equal(l.quantite, 1.75);
  assert.equal(l.unite, 'Tonne');
  assert.equal(l.prix_unitaire, 2708.331);
  assert.equal(l.montant, 4739.58);
  assert.equal(r.reconciliation.ok, true);
});

test('designation multi-lignes (BIOACTYL enroulé)', () => {
  // The article line wraps: code + start of designation, then continuation,
  // then qty/unit/PU/montant on a later line.
  const text = build(
    [
      '0116 BIOACTYL SUPERBE 8.10.22 50KG (engrais',
      'solide)',
      '4,100 Tonne 7 905,000 32 410,50',
    ],
    ['32.410,50 0.00% 0.00\tC1 32.410,50'],
    '32 410,50'
  );
  const r = parseTimacInvoiceText(text);
  assert.equal(r.lignes.length, 1);
  const l = r.lignes[0];
  assert.equal(l.code_article, '0116');
  assert.equal(l.designation, 'BIOACTYL SUPERBE 8.10.22 50KG (engrais solide)');
  assert.equal(l.quantite, 4.1);
  assert.equal(l.unite, 'Tonne');
  assert.equal(l.prix_unitaire, 7905);
  assert.equal(l.montant, 32410.5);
  assert.equal(r.reconciliation.ok, true);
});

test('qté+unité collées (50,000Litre)', () => {
  const text = build(
    ['0063 SEACTIV ALPHA 10L (Biostimulant folaire) 50,000Litre 102,000 5 100,00'],
    ['5.100,00 0.00% 0.00\tC1 5.100,00'],
    '5 100,00'
  );
  const r = parseTimacInvoiceText(text);
  const l = r.lignes[0];
  assert.equal(l.code_article, '0063');
  assert.equal(l.quantite, 50);
  assert.match(l.unite, /Litre/i);
  assert.equal(l.prix_unitaire, 102);
  assert.equal(l.montant, 5100);
  assert.equal(r.reconciliation.ok, true);
});

test('en-tête complet + multi-BL', () => {
  const text = HEADER
    .replace('132253-7', '132253-7 132254-1')
    + '\n0020 NITRATE DE CHAUX 25KG 100,000 Kg 5,000 500,00'
    + '\nMt TVA\tTaux\tBase\tCode Mt TTC'
    + '\n500,00 0.00% 0.00\tC1 500,00'
    + '\n500,00\tNet à Payer :';
  const r = parseTimacInvoiceText(text);
  assert.equal(r.fournisseur, 'TIMAC AGRO MAROC');
  assert.equal(r.code_client, '04789');
  assert.equal(r.num_facture, '148865');
  assert.equal(r.date_facture, '23/01/2026');
  assert.equal(r.num_bcde, '126574');
  assert.equal(r.date_bcde, '23/01/2026');
  assert.equal(r.date_bl, '21/01/2026');
  assert.equal(r.ice, '002106859000069');
  assert.equal(r.date_echeance, '23/05/2026');
  assert.equal(r.net_a_payer, 500);
  assert.deepEqual(r.bls, ['132253-7', '132254-1']);
  assert.equal(r.num_bl, '132253-7');
});

test('réconciliation C1 (exonéré) + C2 (20%) : total_ht = somme des bases HT', () => {
  const text = build(
    [
      '0344 ACIDE PHOSPHORIQUE 32Kg 800,000 KG 8,583 6 866,40',
      '0020 NITRATE DE CHAUX 25KG 1750,000 Kg 4,800 8 400,00',
      '0340 SULFATE DE MAGNESIE 16 % X 25 KG 1,750 Tonne 2 708,331 4 739,58',
    ],
    [
      '11.605,98 20.00% 2,321.20\tC2 13.927,18',
      '8.400,00 0.00% 0.00\tC1 8.400,00',
    ],
    '24 727,38'
  );
  const r = parseTimacInvoiceText(text);
  assert.equal(r.lignes.length, 3);
  const somme = 6866.4 + 8400 + 4739.58; // 20005.98
  assert.equal(r.reconciliation.somme_lignes, Math.round(somme * 100) / 100);
  // total_ht = 1st number of each Cx line: 11 605,98 (C2) + 8 400,00 (C1)
  assert.equal(r.total_ht, 20005.98);
  assert.equal(r.reconciliation.ok, true);
  assert.equal(r.reconciliation.ecart, 0);
  // TVA at 20% on the C2 base
  assert.equal(r.total_tva, Math.round(11605.98 * 0.2 * 100) / 100);
});

test('réconciliation KO -> ok=false et écart non nul', () => {
  // total_ht (C1=1000) ne correspond pas à la somme des lignes (500)
  const text = build(
    ['0020 NITRATE DE CHAUX 25KG 100,000 Kg 5,000 500,00'],
    ['1.000,00 0.00% 0.00\tC1 1.000,00'],
    '1 000,00'
  );
  const r = parseTimacInvoiceText(text);
  assert.equal(r.reconciliation.ok, false);
  assert.equal(r.reconciliation.somme_lignes, 500);
  assert.equal(r.total_ht, 1000);
  assert.equal(r.reconciliation.ecart, -500);
});

test('parseTimacInvoiceText robuste sur entrée vide', () => {
  const r = parseTimacInvoiceText('');
  assert.equal(r.fournisseur, 'TIMAC AGRO MAROC');
  assert.equal(r.lignes.length, 0);
  assert.equal(r.reconciliation.ok, false);
});
