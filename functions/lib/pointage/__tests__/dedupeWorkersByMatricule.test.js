'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { dedupeWorkersByMatricule } = require('../dedupeWorkersByMatricule');

test('regroupe un ouvrier multi-parcelles en 1 ligne (count distinct)', () => {
  const rows = [
    { matricule: 'NA001', nom: 'Ali', quantite: 10, heures: 4, cout: 50, parcelle: 'P1', variete: 'Maravilla' },
    { matricule: 'NA001', nom: 'Ali', quantite: 6, heures: 3, cout: 30, parcelle: 'P2', variete: 'Maravilla' },
    { matricule: 'NA002', nom: 'Sara', quantite: 8, heures: 5, cout: 60, parcelle: 'P1', variete: 'Maravilla' },
  ];
  const out = dedupeWorkersByMatricule(rows);
  assert.strictEqual(out.length, 2);
  const ali = out.find((w) => w.matricule === 'NA001');
  // Somme heures/cout/quantite conservée (rien perdu)
  assert.strictEqual(ali.heures, 7);
  assert.strictEqual(ali.cout, 80);
  assert.strictEqual(ali.quantite, 16);
  // Champs descriptifs = 1re occurrence
  assert.strictEqual(ali.parcelle, 'P1');
});

test('somme totale heures/cout/quantite identique avant/apres dedup', () => {
  const rows = [
    { matricule: 'na001', quantite: 10, heures: 4, cout: 50 },
    { matricule: 'NA001', quantite: 6, heures: 3, cout: 30 },
    { matricule: 'RE010', quantite: 8, heures: 5, cout: 60 },
  ];
  const sum = (arr, k) => arr.reduce((s, r) => s + (r[k] || 0), 0);
  const out = dedupeWorkersByMatricule(rows);
  assert.strictEqual(sum(out, 'heures'), sum(rows, 'heures'));
  assert.strictEqual(sum(out, 'cout'), sum(rows, 'cout'));
  assert.strictEqual(sum(out, 'quantite'), sum(rows, 'quantite'));
  // Clé insensible à la casse + trim
  assert.strictEqual(out.length, 2);
});

test('idempotent : re-dedup ne change rien', () => {
  const rows = [
    { matricule: 'NA001', quantite: 10, heures: 4, cout: 50 },
    { matricule: 'NA001', quantite: 6, heures: 3, cout: 30 },
  ];
  const once = dedupeWorkersByMatricule(rows);
  const twice = dedupeWorkersByMatricule(once);
  assert.deepStrictEqual(twice, once);
});

test('lignes sans matricule conservees telles quelles', () => {
  const rows = [
    { matricule: '', nom: 'Inconnu', cout: 5 },
    { matricule: 'NA001', cout: 10 },
    { matricule: '   ', nom: 'Autre', cout: 7 },
  ];
  const out = dedupeWorkersByMatricule(rows);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out.reduce((s, r) => s + (r.cout || 0), 0), 22);
});

test('liste vide ou non-array', () => {
  assert.deepStrictEqual(dedupeWorkersByMatricule([]), []);
  assert.deepStrictEqual(dedupeWorkersByMatricule(null), []);
  assert.deepStrictEqual(dedupeWorkersByMatricule(undefined), []);
});
