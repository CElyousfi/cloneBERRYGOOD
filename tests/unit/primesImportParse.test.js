'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const P = require('./_esm').loadEsm('src/modules/shared/lib/primesImportParse.js');

// --- normHeader ---------------------------------------------------------
test('normHeader: lower + accents + trim + collapse spaces', () => {
  assert.strictEqual(P.normHeader('  Prime   dh  Brut '), 'prime dh brut');
  assert.strictEqual(P.normHeader('MATRICULE'), 'matricule');
  assert.strictEqual(P.normHeader('Personnél'), 'personnel');
  assert.strictEqual(P.normHeader('  MTR '), 'mtr');
  assert.strictEqual(P.normHeader(null), '');
  assert.strictEqual(P.normHeader(123), '123');
});

// --- findHeaderRow ------------------------------------------------------
test('findHeaderRow: skips title/blank rows, finds MTR/Prime dh Brut on row 4', () => {
  const aoa = [
    ['ETAT DES PRIMES MAGASIN', '', '', ''],         // row 0 title
    ['', '', '', ''],                                  // row 1 blank
    ['Mois: Juin 2026', '', '', ''],                   // row 2
    ['MTR', 'Personnel', 'Prime dh Brut', 'POSTE'],    // row 3 header
    ['1001', 'Ali', '500', 'Magasinier'],              // row 4 data
  ];
  const r = P.findHeaderRow(aoa);
  assert.strictEqual(r.headerIndex, 3);
  assert.strictEqual(r.colMatricule, 0);
  assert.strictEqual(r.colPrime, 2);
});

test('findHeaderRow: returns -1 when no matricule header', () => {
  const aoa = [['Nom', 'Poste', 'Salaire'], ['Ali', 'Mag', '500']];
  const r = P.findHeaderRow(aoa);
  assert.strictEqual(r.headerIndex, -1);
  assert.strictEqual(r.colMatricule, null);
});

// --- extractPrimesRows --------------------------------------------------
test('extractPrimesRows: native magasin format (title, blanks, MTR/Prime dh Brut row 4)', () => {
  const aoa = [
    [],                                                          // row 0 empty
    ['ETAT PRIMES — MAGASIN BGF', '', '', ''],                   // row 1 merged title
    ['', '', '', ''],                                            // row 2 blank
    ['MTR', 'Personnel', 'Prime dh Brut', 'POSTE'],             // row 3 header
    ['1001', 'Ali', '500', 'Magasinier'],                       // row 4
    ['1002', 'Sara', '750.50', 'Chef'],                         // row 5
    ['1003', 'Karim', '', 'Aide'],                              // row 6 montant vide -> 0
  ];
  const res = P.extractPrimesRows(aoa);
  assert.strictEqual(res.error, undefined);
  assert.strictEqual(res.headerIndex, 3);
  assert.deepStrictEqual(res.rows, [
    { matricule: '1001', montant: 500 },
    { matricule: '1002', montant: 750.5 },
    { matricule: '1003', montant: 0 },
  ]);
});

test('extractPrimesRows: clean format Matricule/Prime on row 1', () => {
  const aoa = [
    ['Matricule', 'Prime'],
    ['2001', '300'],
    ['2002', '450'],
  ];
  const res = P.extractPrimesRows(aoa);
  assert.deepStrictEqual(res.rows, [
    { matricule: '2001', montant: 300 },
    { matricule: '2002', montant: 450 },
  ]);
});

test('extractPrimesRows: Montant alias and casing matricule/MATRICULE', () => {
  const aoa1 = [['matricule', 'Montant'], ['3001', '120']];
  assert.deepStrictEqual(P.extractPrimesRows(aoa1).rows, [{ matricule: '3001', montant: 120 }]);
  const aoa2 = [['MATRICULE', 'PRIME'], ['3002', '99']];
  assert.deepStrictEqual(P.extractPrimesRows(aoa2).rows, [{ matricule: '3002', montant: 99 }]);
});

test('extractPrimesRows: header introuvable -> error, rows vide', () => {
  const aoa = [['Nom', 'Salaire'], ['Ali', '500']];
  const res = P.extractPrimesRows(aoa);
  assert.strictEqual(res.headerIndex, -1);
  assert.deepStrictEqual(res.rows, []);
  assert.match(res.error, /En-tête Matricule introuvable/);
});

test('extractPrimesRows: blank rows and empty matricule are ignored', () => {
  const aoa = [
    ['MTR', 'Prime dh Brut'],
    ['4001', '200'],
    ['', '999'],          // matricule vide -> ignoré
    [],                   // ligne vide -> ignorée
    ['  ', '50'],         // espaces seulement -> ignoré
    ['4002', '300'],
  ];
  const res = P.extractPrimesRows(aoa);
  assert.deepStrictEqual(res.rows, [
    { matricule: '4001', montant: 200 },
    { matricule: '4002', montant: 300 },
  ]);
});
