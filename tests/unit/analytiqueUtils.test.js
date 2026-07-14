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
test('resolveGroupeFamille: code GB connu → libellé famille (niveau intermédiaire)', () => {
  assert.strictEqual(resolveGroupeFamille('GB01', '1. Travaux du sol GB01'), 'Travaux du sol');
  assert.strictEqual(resolveGroupeFamille('GB08', '8. Récolte GB08'), 'Récolte');
  assert.strictEqual(resolveGroupeFamille('GB09', '9. Taille GB09'), 'Taille');
  assert.strictEqual(resolveGroupeFamille('GB11', '11. Services généraux GB11'), 'Services généraux');
  assert.strictEqual(resolveGroupeFamille('GB02', '2. Ferti-irrigation GB02'), 'Ferti-irrigation');
});

test('resolveGroupeFamille: code avec casse/espaces variantes → normalisé', () => {
  assert.strictEqual(resolveGroupeFamille('gb08 ', '8. Récolte'), 'Récolte');
  assert.strictEqual(resolveGroupeFamille('  GB02  ', '2. Ferti-irrigation'), 'Ferti-irrigation');
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
// buildAnalytiquePivotByFamille — format hiérarchique (groupedRows)
// ---------------------------------------------------------------------------
const rowFam = (parcelle, ha, operationFamille, jh, cout, operationGroupe) =>
  ({ parcelle, ha, operationFamille, jh, cout, operationGroupe: operationGroupe || '' });

test('pivotByFamille: retourne groupedRows (pas operations/pivot)', () => {
  const result = buildAnalytiquePivotByFamille([
    rowFam('P1', 2, '1. Travaux du sol', 3, 300, 'GB01'),
    rowFam('P1', 2, '8. Récolte', 5, 500, 'GB08'),
  ]);
  assert.ok(Array.isArray(result.groupedRows), 'groupedRows doit être un tableau');
  assert.ok(!result.operations, 'operations ne doit pas être présent en mode famille');
  assert.ok(!result.pivot, 'pivot ne doit pas être présent en mode famille');
});

test('pivotByFamille: lignes groupe + famille (types corrects, pas de operation)', () => {
  const { groupedRows } = buildAnalytiquePivotByFamille([
    rowFam('P1', 2, '1. Travaux du sol', 3, 300, 'GB01'),
    rowFam('P1', 2, '2. Ferti-irrigation', 2, 200, 'GB02'),
    rowFam('P1', 2, '8. Récolte', 5, 500, 'GB08'),
  ]);
  // Pas de rows de type 'operation' dans le mode Famille
  assert.ok(!groupedRows.some(r => r.type === 'operation'), 'pas de type operation');
  // Rows groupe et famille uniquement
  groupedRows.forEach(r => assert.ok(r.type === 'groupe' || r.type === 'famille'));
  // 3 familles distinctes (GB01, GB02, GB08)
  const famRows = groupedRows.filter(r => r.type === 'famille');
  assert.strictEqual(famRows.length, 3);
  const famGB01 = famRows.find(r => r.key === 'GB01');
  assert.ok(famGB01, 'ligne famille GB01 doit exister');
  assert.strictEqual(famGB01.label, 'Travaux du sol');
  assert.strictEqual(famGB01.groupeKey, 'M.O Hors récolte', 'GB01 appartient à M.O Hors récolte');
  // Chaque famille est précédée de son groupe
  const idxFam = groupedRows.indexOf(famGB01);
  assert.ok(idxFam > 0, 'famille GB01 a une ligne avant elle');
  assert.strictEqual(groupedRows[idxFam - 1].type, 'groupe', 'ligne précédente est un groupe');
});

test('pivotByFamille: pivot famille agrège JH/coût de toutes les ops de la famille', () => {
  // GB01 a deux opérations : Travaux du sol (jh=3) + Cover cropage (jh=2) → total P1 = 5
  const { groupedRows } = buildAnalytiquePivotByFamille([
    rowFam('P1', 2, 'Travaux du sol', 3, 300, 'GB01'),
    rowFam('P1', 2, 'Cover cropage', 2, 200, 'GB01'),
    rowFam('P1', 2, 'Récolte', 5, 500, 'GB08'),
  ]);
  const famGB01 = groupedRows.find(r => r.type === 'famille' && r.key === 'GB01');
  assert.ok(famGB01);
  assert.strictEqual(famGB01.pivot['P1'].jh, 5);
  assert.strictEqual(famGB01.pivot['P1'].cout, 500);
});

test('pivotByFamille: plusieurs parcelles → pivot correct', () => {
  const { parcelles, groupedRows } = buildAnalytiquePivotByFamille([
    rowFam('P1', 1.5, 'Taille', 3, 300, 'GB02'),
    rowFam('P2', 3.0, 'Taille', 2, 200, 'GB02'),
  ]);
  assert.strictEqual(parcelles.length, 2);
  const famGB02 = groupedRows.find(r => r.type === 'famille' && r.key === 'GB02');
  assert.ok(famGB02);
  assert.strictEqual(famGB02.pivot['P1'].jh, 3);
  assert.strictEqual(famGB02.pivot['P2'].jh, 2);
});

test('pivotByFamille: familles sans JH > 0 toujours présentes (changement intentionnel : la ligne famille sert d\'en-tête)', () => {
  // Comportement post-refactor : toutes les familles apparaissent même avec jh=0
  // (le filtrage des lignes vides est à la charge du rendu si nécessaire)
  const { groupedRows } = buildAnalytiquePivotByFamille([
    rowFam('P1', 2, 'Taille', 0, 0, 'GB02'),
    rowFam('P1', 2, 'Récolte', 3, 300, 'GB08'),
  ]);
  const famRows = groupedRows.filter(r => r.type === 'famille');
  assert.ok(famRows.length >= 1, 'Au moins la famille GB08 doit être présente');
  const famGB08 = famRows.find(r => r.key === 'GB08');
  assert.ok(famGB08, 'famille GB08 (Récolte) doit exister');
  assert.strictEqual(famGB08.pivot['P1'].jh, 3);
});

test('pivotByFamille: fallback données sans operationGroupe (archives)', () => {
  // operationGroupe absent → code AUTRE, label depuis opLabel(operationFamille)
  const { groupedRows } = buildAnalytiquePivotByFamille([
    rowFam('P1', 2, 'Entretien structure', 2, 200, ''),
    rowFam('P1', 2, 'Ferti irrigation', 1, 100, ''),
  ]);
  // Toutes les lignes tombent dans 'AUTRE' (groupedRows a 1 famille + 2 ops)
  assert.ok(groupedRows.length > 0, 'ne doit pas crasher');
  groupedRows.forEach(r => assert.ok(typeof r.key === 'string' && r.key.length > 0));
});

test('pivotByFamille: entrée vide/nulle → structures vides', () => {
  assert.deepStrictEqual(buildAnalytiquePivotByFamille([]), { parcelles: [], groupedRows: [] });
  assert.deepStrictEqual(buildAnalytiquePivotByFamille(null), { parcelles: [], groupedRows: [] });
});
