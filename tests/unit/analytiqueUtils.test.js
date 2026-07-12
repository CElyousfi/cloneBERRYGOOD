'use strict';

const test = require('node:test');
const assert = require('node:assert');
const AnalytiqueUtils = require('../../public/lib/analytiqueUtils.js');

const { opLabel, opKey, buildAnalytiquePivot } = AnalytiqueUtils;

// ---------------------------------------------------------------------------
// opLabel — préfixe numérique BEE ONE retiré
// ---------------------------------------------------------------------------
test('opLabel: retire le préfixe numérique et trim', () => {
  assert.strictEqual(opLabel('8. Récolte'), 'Récolte');
  assert.strictEqual(opLabel('11. Postes fixes'), 'Postes fixes');
  assert.strictEqual(opLabel('  Taille  '), 'Taille');
  assert.strictEqual(opLabel(''), '');
  assert.strictEqual(opLabel(null), '');
  assert.strictEqual(opLabel(undefined), '');
});

// ---------------------------------------------------------------------------
// opKey — normalisation mécanique (casse, tirets, espaces, préfixe)
// ---------------------------------------------------------------------------
test('opKey: variantes de casse convergent', () => {
  assert.strictEqual(opKey('Entretien Structure'), opKey('Entretien structure'));
  assert.strictEqual(opKey('PALISSAGE'), opKey('Palissage'));
});

test('opKey: tirets/underscores équivalents aux espaces', () => {
  assert.strictEqual(opKey('Ferti-irrigation'), opKey('Ferti Irrigation'));
  assert.strictEqual(opKey('Ferti_irrigation'), opKey('ferti  irrigation'));
});

test('opKey: préfixe numérique ignoré', () => {
  assert.strictEqual(opKey('8. Récolte'), opKey('Récolte'));
});

test('opKey: libellés métier réellement différents restent distincts', () => {
  assert.notStrictEqual(opKey('PALISSAGE'), opKey('Tuteurage & palissage'));
  assert.notStrictEqual(opKey('Traitement'), opKey('Traitement phyto/Désherbage'));
});

// ---------------------------------------------------------------------------
// buildAnalytiquePivot
// ---------------------------------------------------------------------------
const row = (parcelle, ha, operationFamille, jh, cout) => ({ parcelle, ha, operationFamille, jh, cout });

test('pivot: agrège jh/cout par (famille, parcelle)', () => {
  const { parcelles, operations, pivot } = buildAnalytiquePivot([
    row('P1', 2, 'Taille', 3, 300),
    row('P1', 2, 'Taille', 1, 100),
    row('P2', 4, 'Taille', 5, 500),
  ]);
  assert.deepStrictEqual(parcelles, [['P1', 2], ['P2', 4]]);
  assert.strictEqual(operations.length, 1);
  const key = operations[0].key;
  assert.strictEqual(operations[0].label, 'Taille');
  assert.strictEqual(pivot[key]['P1'].jh, 4);
  assert.strictEqual(pivot[key]['P1'].cout, 400);
  assert.strictEqual(pivot[key]['P1'].detailRows.length, 2);
  assert.strictEqual(pivot[key]['P2'].jh, 5);
});

test('pivot: fusionne les doublons de famille (casse + tirets)', () => {
  const { operations, pivot } = buildAnalytiquePivot([
    row('P1', 2, 'Entretien Structure', 3, 300),
    row('P1', 2, 'Entretien structure', 2, 200),
    row('P2', 4, 'Ferti-irrigation', 1, 100),
    row('P2', 4, 'Ferti Irrigation', 1, 150),
  ]);
  assert.strictEqual(operations.length, 2);
  const entretien = operations.find(o => o.key === opKey('Entretien Structure'));
  assert.ok(entretien);
  assert.strictEqual(pivot[entretien.key]['P1'].jh, 5);
  assert.strictEqual(pivot[entretien.key]['P1'].cout, 500);
  const ferti = operations.find(o => o.key === opKey('Ferti-irrigation'));
  assert.ok(ferti);
  assert.strictEqual(pivot[ferti.key]['P2'].jh, 2);
  assert.strictEqual(pivot[ferti.key]['P2'].cout, 250);
});

test('pivot: familles métier différentes NON fusionnées', () => {
  const { operations } = buildAnalytiquePivot([
    row('P1', 2, 'PALISSAGE', 1, 100),
    row('P1', 2, 'Tuteurage & palissage', 1, 100),
  ]);
  assert.strictEqual(operations.length, 2);
});

test('pivot: une ligne ha=0 n\'écrase pas la surface connue de la parcelle', () => {
  const { parcelles } = buildAnalytiquePivot([
    row('P1', 1.9, 'Taille', 1, 100),
    row('P1', 0, 'Récolte', 2, 200),
  ]);
  assert.deepStrictEqual(parcelles, [['P1', 1.9]]);
});

test('pivot: la surface arrive sur une ligne ultérieure → retenue quand même', () => {
  const { parcelles, operations, pivot } = buildAnalytiquePivot([
    row('P1', 0, 'Taille', 1, 100),
    row('P1', 1.9, 'Taille', 1, 100),
  ]);
  assert.deepStrictEqual(parcelles, [['P1', 1.9]]);
  assert.strictEqual(pivot[operations[0].key]['P1'].ha, 1.9);
});

test('pivot: famille sans aucun JH > 0 exclue', () => {
  const { operations } = buildAnalytiquePivot([
    row('P1', 2, 'Taille', 0, 0),
    row('P1', 2, 'Récolte', 3, 300),
  ]);
  assert.strictEqual(operations.length, 1);
  assert.strictEqual(operations[0].label, 'Récolte');
});

test('pivot: ordre des familles = tri sur libellé brut (préfixes numériques BEE ONE)', () => {
  const { operations } = buildAnalytiquePivot([
    row('P1', 2, '11. Postes fixes', 1, 100),
    row('P1', 2, '2. Taille', 1, 100),
  ]);
  assert.deepStrictEqual(operations.map(o => o.label), ['Postes fixes', 'Taille']);
});

test('pivot: entrée vide/absente → structures vides', () => {
  assert.deepStrictEqual(buildAnalytiquePivot([]), { parcelles: [], operations: [], pivot: {} });
  assert.deepStrictEqual(buildAnalytiquePivot(null), { parcelles: [], operations: [], pivot: {} });
});
