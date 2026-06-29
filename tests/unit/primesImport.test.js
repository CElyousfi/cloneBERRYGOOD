'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMatricule, buildImportPreview } = require('../../functions/lib/primes/primesImport.js');

// ---------------------------------------------------------------------------
// normalizeMatricule
// ---------------------------------------------------------------------------
test('normalizeMatricule extrait la clé numérique', () => {
  assert.equal(normalizeMatricule('DD10502'), '10502');
  assert.equal(normalizeMatricule('NA3439'), '3439');
  assert.equal(normalizeMatricule('10502'), '10502');
  assert.equal(normalizeMatricule(10502), '10502');
});

test('normalizeMatricule gère null/undefined/vide', () => {
  assert.equal(normalizeMatricule(null), '');
  assert.equal(normalizeMatricule(undefined), '');
  assert.equal(normalizeMatricule(''), '');
  assert.equal(normalizeMatricule('ABC'), '');
});

// ---------------------------------------------------------------------------
// buildImportPreview — toCreate / toUpdate
// ---------------------------------------------------------------------------
test('classe toCreate (absent) et toUpdate (présent)', () => {
  const rows = [
    { matricule: '10502', montant: 20 },
    { matricule: '3439', montant: 15 },
  ];
  const registry = ['10502'];
  const p = buildImportPreview(rows, registry);
  assert.equal(p.toUpdate.length, 1);
  assert.equal(p.toUpdate[0].matricule, '10502');
  assert.equal(p.toUpdate[0].montant, 20);
  assert.equal(p.toCreate.length, 1);
  assert.equal(p.toCreate[0].matricule, '3439');
  assert.equal(p.unmatched.length, 0);
  assert.equal(p.collisions.length, 0);
});

test('normalise les matricules alpha-préfixés avant matching', () => {
  const rows = [{ matricule: 'DD10502', montant: 30 }];
  const registry = ['10502'];
  const p = buildImportPreview(rows, registry);
  assert.equal(p.toUpdate.length, 1);
  assert.equal(p.toUpdate[0].matricule, '10502');
  assert.equal(p.toUpdate[0].raw, 'DD10502');
});

// ---------------------------------------------------------------------------
// unmatched
// ---------------------------------------------------------------------------
test('unmatched = matricule illisible (vide après normalisation)', () => {
  const rows = [{ matricule: 'ABC', montant: 10 }, { matricule: '', montant: 5 }];
  const p = buildImportPreview(rows, []);
  assert.equal(p.unmatched.length, 2);
  assert.equal(p.toCreate.length, 0);
});

// ---------------------------------------------------------------------------
// COLLISION numKey
// ---------------------------------------------------------------------------
test('COLLISION : DD10502 + 10502 → même 10502, listée et exclue', () => {
  const rows = [
    { matricule: 'DD10502', montant: 30 },
    { matricule: '10502', montant: 20 },
  ];
  const p = buildImportPreview(rows, []);
  assert.equal(p.collisions.length, 1);
  assert.equal(p.collisions[0].matricule, '10502');
  assert.deepEqual(p.collisions[0].raws.sort(), ['10502', 'DD10502']);
  // Lignes ambiguës exclues de toCreate/toUpdate.
  assert.equal(p.toCreate.length, 0);
  assert.equal(p.toUpdate.length, 0);
});

test('COLLISION : DD10502 + XX10502 (deux alphas) → même 10502', () => {
  const rows = [
    { matricule: 'DD10502', montant: 30 },
    { matricule: 'XX10502', montant: 25 },
  ];
  const p = buildImportPreview(rows, []);
  assert.equal(p.collisions.length, 1);
  assert.equal(p.collisions[0].matricule, '10502');
});

test('même raw répété 2x N EST PAS une collision (raws distincts requis)', () => {
  const rows = [
    { matricule: '10502', montant: 30 },
    { matricule: '10502', montant: 30 },
  ];
  const p = buildImportPreview(rows, []);
  assert.equal(p.collisions.length, 0);
  // Une seule entrée numérique → toCreate (non ambiguë).
  assert.equal(p.toCreate.length, 2);
});

test('rows non-array → preview vide', () => {
  const p = buildImportPreview(null, ['10502']);
  assert.deepEqual(p.toCreate, []);
  assert.deepEqual(p.toUpdate, []);
  assert.deepEqual(p.unmatched, []);
  assert.deepEqual(p.collisions, []);
});
