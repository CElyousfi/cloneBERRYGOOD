/*
 * campagneParcelleQuinzaine.test.js — ventilation d'une parcelle dans le temps.
 *
 * La grille Campagne montre une parcelle en UNE colonne : le cumul de la
 * campagne. Ce module fait pivoter les mêmes lignes sur l'axe des quinzaines.
 * Ce qu'il protège :
 *   1. le FILTRE de parcelle — une ligne d'une autre parcelle qui passe rend le
 *      détail plus gros que la colonne dont il sort, sans rien lever ;
 *   2. le RÉ-ÉTIQUETAGE `periode` → `parcelle`, seul mécanisme du pivot ;
 *   3. le `ha` CONSTANT par colonne : une quinzaine n'a pas de surface propre,
 *      et c'est ce qui rend « JH/Ha » lisible quinzaine par quinzaine.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const M = require(path.join(__dirname, '../../public/lib/campagneParcelleQuinzaine.js'));

const ROWS = [
  { parcelle: 'F1- S5 MARAVILLA MD', periode: 'Quinzaine 01', famille: 'Ferti-irrigation', code: 'GB02', operation: 'Arrosage', jh: 12, cout: 1200, nbOuv: 4 },
  { parcelle: 'F1- S5 MARAVILLA MD', periode: 'Quinzaine 02', famille: 'Ferti-irrigation', code: 'GB02', operation: 'Arrosage', jh: 8, cout: 800, nbOuv: 3 },
  { parcelle: 'F1- S5 MARAVILLA MD', periode: 'Quinzaine 02', famille: 'Taille', code: 'GB09', operation: 'Taille', jh: 5, cout: 500, nbOuv: 2 },
  // Une AUTRE parcelle : ne doit jamais entrer dans le détail de la première.
  { parcelle: 'F5 YAZMIN MT', periode: 'Quinzaine 01', famille: 'Taille', code: 'GB09', operation: 'Taille', jh: 99, cout: 9900, nbOuv: 30 },
];

test('lignesParQuinzaine — ne garde que la parcelle demandée', () => {
  const out = M.lignesParQuinzaine(ROWS, 'F1- S5 MARAVILLA MD', 1.25);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out.reduce((s, r) => s + r.jh, 0), 25);
  assert.strictEqual(out.reduce((s, r) => s + r.cout, 0), 2500);
});

test('lignesParQuinzaine — la QUINZAINE prend la place de la parcelle', () => {
  const out = M.lignesParQuinzaine(ROWS, 'F1- S5 MARAVILLA MD', 1.25);
  assert.deepStrictEqual(out.map((r) => r.parcelle),
    ['Quinzaine 01', 'Quinzaine 02', 'Quinzaine 02']);
  // Les champs du pivot partagé sont là, sous leurs noms attendus : sans eux
  // toutes les lignes tomberaient dans « AUTRE » sans rien lever.
  assert.strictEqual(out[0].operationGroupe, 'GB02');
  assert.strictEqual(out[0].operationFamille, 'Ferti-irrigation');
});

test('lignesParQuinzaine — le Ha est celui de la PARCELLE, identique partout', () => {
  const out = M.lignesParQuinzaine(ROWS, 'F1- S5 MARAVILLA MD', 1.25);
  assert.ok(out.every((r) => r.ha === 1.25));
  // Surface inconnue → 0, jamais une valeur de secours : « JH/Ha » doit
  // afficher « — », pas un ratio calculé sur une surface inventée.
  const sansHa = M.lignesParQuinzaine(ROWS, 'F1- S5 MARAVILLA MD', 0);
  assert.ok(sansHa.every((r) => r.ha === 0));
});

test('lignesParQuinzaine — parcelle absente ou vide → aucune ligne', () => {
  assert.deepStrictEqual(M.lignesParQuinzaine(ROWS, 'PARCELLE FANTÔME', 1), []);
  assert.deepStrictEqual(M.lignesParQuinzaine(ROWS, '', 1), []);
  assert.deepStrictEqual(M.lignesParQuinzaine(null, 'F5 YAZMIN MT', 1), []);
});

test('periodesDe — les quinzaines VUES, triées, sans colonne vide', () => {
  assert.deepStrictEqual(M.periodesDe(ROWS, 'F1- S5 MARAVILLA MD'),
    ['Quinzaine 01', 'Quinzaine 02']);
  // La seconde parcelle n'a été travaillée qu'une quinzaine : elle n'hérite pas
  // des colonnes de la première.
  assert.deepStrictEqual(M.periodesDe(ROWS, 'F5 YAZMIN MT'), ['Quinzaine 01']);
});
