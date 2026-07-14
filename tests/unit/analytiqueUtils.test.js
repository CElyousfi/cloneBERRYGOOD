'use strict';

const test = require('node:test');
const assert = require('node:assert');
const AnalytiqueUtils = require('../../public/lib/analytiqueUtils.js');

const { opLabel, opKey, buildAnalytiquePivot, resolveGroupeFamille, buildAnalytiquePivotByFamille } = AnalytiqueUtils;

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

// ---------------------------------------------------------------------------
// resolveGroupeFamille
// ---------------------------------------------------------------------------
test('resolveGroupeFamille: code GB connu → famille parente', () => {
  assert.strictEqual(resolveGroupeFamille('GB01', '1. Travaux du sol GB01'), 'M.O Hors récolte');
  assert.strictEqual(resolveGroupeFamille('GB08', '8. Récolte GB08'), 'M.O Récolte');
  assert.strictEqual(resolveGroupeFamille('GB09', '9. Service générale GB09'), 'M.O Service générale');
  assert.strictEqual(resolveGroupeFamille('GB11', '11. Postes fixes GB11'), 'M.O Service générale');
});

test('resolveGroupeFamille: code avec casse/espaces variantes → normalisé', () => {
  assert.strictEqual(resolveGroupeFamille('gb08 ', '8. Récolte'), 'M.O Récolte');
  assert.strictEqual(resolveGroupeFamille('  GB02  ', '2. Taille'), 'M.O Hors récolte');
});

test('resolveGroupeFamille: fallback si code inconnu → retire suffixe GBxx du libellé', () => {
  // Données archivées sans operationGroupe (champ vide) mais libellé avec suffixe GB
  assert.strictEqual(resolveGroupeFamille('', 'Travaux du sol GB01'), 'Travaux du sol');
  assert.strictEqual(resolveGroupeFamille(null, 'Irrigation GB03'), 'Irrigation');
});

test('resolveGroupeFamille: fallback si libellé sans suffixe GB → retourne le libellé tel quel', () => {
  assert.strictEqual(resolveGroupeFamille('', 'Divers'), 'Divers');
  assert.strictEqual(resolveGroupeFamille(null, null), 'Autre');
});

// ---------------------------------------------------------------------------
// buildAnalytiquePivotByFamille
// ---------------------------------------------------------------------------
const rowFam = (parcelle, ha, operationFamille, jh, cout, operationGroupe) =>
  ({ parcelle, ha, operationFamille, jh, cout, operationGroupe: operationGroupe || '' });

test('pivotByFamille: groupe par famille parente (GB code)', () => {
  const { operations, pivot } = buildAnalytiquePivotByFamille([
    rowFam('P1', 2, '1. Travaux du sol GB01', 3, 300, 'GB01'),
    rowFam('P1', 2, '2. Taille GB02', 2, 200, 'GB02'),
    rowFam('P1', 2, '8. Récolte GB08', 5, 500, 'GB08'),
  ]);
  // GB01 et GB02 → 'M.O Hors récolte', GB08 → 'M.O Récolte'
  assert.strictEqual(operations.length, 2);
  const horsRecolte = operations.find(o => o.key === 'M.O Hors récolte');
  assert.ok(horsRecolte, 'M.O Hors récolte doit exister');
  assert.strictEqual(pivot['M.O Hors récolte']['P1'].jh, 5);
  assert.strictEqual(pivot['M.O Hors récolte']['P1'].cout, 500);
  const recolte = operations.find(o => o.key === 'M.O Récolte');
  assert.ok(recolte, 'M.O Récolte doit exister');
  assert.strictEqual(pivot['M.O Récolte']['P1'].jh, 5);
});

test('pivotByFamille: plusieurs parcelles → pivot correct', () => {
  const { parcelles, pivot } = buildAnalytiquePivotByFamille([
    rowFam('P1', 1.5, 'Taille GB02', 3, 300, 'GB02'),
    rowFam('P2', 3.0, 'Taille GB02', 2, 200, 'GB02'),
  ]);
  assert.strictEqual(parcelles.length, 2);
  assert.strictEqual(pivot['M.O Hors récolte']['P1'].jh, 3);
  assert.strictEqual(pivot['M.O Hors récolte']['P2'].jh, 2);
});

test('pivotByFamille: famille sans JH > 0 exclue', () => {
  const { operations } = buildAnalytiquePivotByFamille([
    rowFam('P1', 2, 'Taille GB02', 0, 0, 'GB02'),
    rowFam('P1', 2, 'Récolte GB08', 3, 300, 'GB08'),
  ]);
  assert.strictEqual(operations.length, 1);
  assert.strictEqual(operations[0].key, 'M.O Récolte');
});

test('pivotByFamille: fallback données sans operationGroupe (archives)', () => {
  // operationGroupe absent → resolveGroupeFamille retire le suffixe GB du libellé
  const { operations } = buildAnalytiquePivotByFamille([
    rowFam('P1', 2, 'Entretien structure GB03', 2, 200, ''),
    rowFam('P1', 2, 'Ferti irrigation GB03', 1, 100, ''),
  ]);
  // Les deux sous-familles convergent sur le fallback (même suffixe GB03 retiré différemment)
  // L'important est que ça ne crash pas et que les familles sont des strings non vides
  assert.ok(operations.length > 0);
  operations.forEach(o => assert.ok(typeof o.key === 'string' && o.key.length > 0));
});

test('pivotByFamille: entrée vide/nulle → structures vides', () => {
  assert.deepStrictEqual(buildAnalytiquePivotByFamille([]), { parcelles: [], operations: [], pivot: {} });
  assert.deepStrictEqual(buildAnalytiquePivotByFamille(null), { parcelles: [], operations: [], pivot: {} });
});
