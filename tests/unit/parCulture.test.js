'use strict';

/**
 * parCulture.test.js — Agrégation par culture pour la quinzaine.
 *
 * Propriété clé : Σ(parCulture[i].cout) === Σ(rows[j].Cout)
 * Si ce test passe, la somme Framboise + Myrtille + Avocat === total RH dans l'UI.
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildParCulture } = require('../../functions/src/modules/rh/pointageService.js');

// Fixtures : jeux de rows multi-ferme multi-culture
const ROWS_MIXED = [
  { Parcelle_Culturale: 'Yazmin S1',      Ref_parcelle: 'F1-001', Nombre_Jr: 1, Cout: 100, Operation_Famille: '7. Hors Récolte' },
  { Parcelle_Culturale: 'Corina S8',      Ref_parcelle: 'F5-001', Nombre_Jr: 2, Cout: 200, Operation_Famille: '7. Hors Récolte' },
  { Parcelle_Culturale: 'Parcelle avocat',Ref_parcelle: 'F2-01',  Nombre_Jr: 3, Cout: 300, Operation_Famille: '7. Hors Récolte' },
  { Parcelle_Culturale: 'Maravilla S4',   Ref_parcelle: 'F5-002', Nombre_Jr: 1, Cout: 50,  Operation_Famille: '8. Récolte' },
];

test('parCulture: somme Framboise + Myrtille + Avocat === totalCout et totalJournees', () => {
  const parCulture = buildParCulture(ROWS_MIXED);
  const totalCout = ROWS_MIXED.reduce(function(s, r) { return s + r.Cout; }, 0);
  const totalJH   = ROWS_MIXED.reduce(function(s, r) { return s + r.Nombre_Jr; }, 0);

  const sumCout = parCulture.reduce(function(s, c) { return s + c.cout; }, 0);
  const sumJH   = parCulture.reduce(function(s, c) { return s + c.journees; }, 0);

  assert.equal(sumCout, totalCout, 'somme cultures cout == total cout (' + totalCout + ')');
  assert.equal(sumJH,   totalJH,   'somme cultures JH == total JH (' + totalJH + ')');
});

test('parCulture: Framboise inclut F1 ET parcelles Framboise de F5 (Maravilla S4)', () => {
  const rows = [
    { Parcelle_Culturale: 'Yazmin S1',   Ref_parcelle: 'F1-001', Nombre_Jr: 2, Cout: 200, Operation_Famille: '7. Hors Récolte' },
    { Parcelle_Culturale: 'Maravilla S4',Ref_parcelle: 'F5-002', Nombre_Jr: 1, Cout: 100, Operation_Famille: '7. Hors Récolte' },
  ];
  const parCulture = buildParCulture(rows);
  const fb = parCulture.find(function(c) { return c.culture === 'Framboise'; });
  assert.ok(fb, 'Framboise présent dans parCulture');
  assert.equal(fb.cout,     300, 'F1 Yazmin (200) + F5 Maravilla (100) = 300');
  assert.equal(fb.journees, 3,   '2+1 = 3 JH Framboise');
});

test('parCulture: Myrtille uniquement S8 (Corina)', () => {
  const rows = [
    { Parcelle_Culturale: 'Corina S8', Ref_parcelle: 'F5-001', Nombre_Jr: 5, Cout: 500, Operation_Famille: '7. Hors Récolte' },
  ];
  const parCulture = buildParCulture(rows);
  const myr = parCulture.find(function(c) { return c.culture === 'Myrtille'; });
  assert.ok(myr, 'Myrtille présent');
  assert.equal(myr.cout, 500);
  assert.equal(parCulture.find(function(c) { return c.culture === 'Framboise'; }), undefined, 'pas de Framboise');
});

test('parCulture: Avocatier → culture Avocat (via ferme)', () => {
  const rows = [
    { Parcelle_Culturale: 'Parcelle avocat', Ref_parcelle: 'F2-01', Nombre_Jr: 4, Cout: 400, Operation_Famille: '7. Hors Récolte' },
  ];
  const parCulture = buildParCulture(rows);
  const avo = parCulture.find(function(c) { return c.culture === 'Avocat'; });
  assert.ok(avo, 'Avocat présent');
  assert.equal(avo.cout, 400);
});

test('parCulture: rows vides ou null → tableau vide', () => {
  assert.deepEqual(buildParCulture([]),   []);
  assert.deepEqual(buildParCulture(null), []);
});

test('parCulture: classifyType correct — Récolte vs Hors Récolte vs Postes', () => {
  const rows = [
    { Parcelle_Culturale: 'Yazmin S1', Ref_parcelle: 'F1-001', Nombre_Jr: 2, Cout: 100, Operation_Famille: '8. Récolte' },
    { Parcelle_Culturale: 'Yazmin S1', Ref_parcelle: 'F1-001', Nombre_Jr: 3, Cout: 150, Operation_Famille: '11. Postes fixes' },
    { Parcelle_Culturale: 'Yazmin S1', Ref_parcelle: 'F1-001', Nombre_Jr: 5, Cout: 200, Operation_Famille: '7. Hors Récolte' },
  ];
  const parCulture = buildParCulture(rows);
  const fb = parCulture.find(function(c) { return c.culture === 'Framboise'; });
  assert.ok(fb);
  assert.equal(fb.recolte,     2, 'recolte = 2 JH');
  assert.equal(fb.postesFixes, 3, 'postesFixes = 3 JH');
  assert.equal(fb.horsRecolte, 5, 'horsRecolte = 5 JH');
  assert.equal(fb.cout,       450, 'cout total = 450');
});
