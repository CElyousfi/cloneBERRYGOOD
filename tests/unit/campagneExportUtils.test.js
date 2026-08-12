'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  SHEET_MAX,
  ROW_KIND,
  PERCENT_HEADER,
  haLabel,
  numFmtFor,
  percentFmtFor,
  percentColumns,
  sumBudget,
  budgetCells,
  safeSheetName,
  buildSyntheseRows,
  buildSyntheseAoA,
  syntheseSheetCols,
  buildParcelleSheetRows,
  buildParcelleSheetAoA,
  parcelleSheetCols,
} = require('../../public/lib/campagneExportUtils.js');

// ============================================================================
// haLabel — superficie AFFICHÉE, locale fr (écran + en-tête Excel)
// ============================================================================
test('haLabel — virgule décimale, 2 décimales, suffixe ha', () => {
  assert.strictEqual(haLabel(2.4), '2,40 ha');
  assert.strictEqual(haLabel(0.5), '0,50 ha');
  assert.strictEqual(haLabel(12), '12,00 ha');
});

test('haLabel — superficie inconnue/nulle/négative → tiret', () => {
  assert.strictEqual(haLabel(0), '—');
  assert.strictEqual(haLabel(null), '—');
  assert.strictEqual(haLabel(undefined), '—');
  assert.strictEqual(haLabel(-1), '—');
  assert.strictEqual(haLabel('abc'), '—');
});

// ============================================================================
// safeSheetName — nettoyage, troncature, déduplication
// ============================================================================
test('safeSheetName — nom court conservé tel quel', () => {
  assert.strictEqual(safeSheetName('F1- S5 MARAVILLA', 1, {}), 'F1- S5 MARAVILLA');
});

test('safeSheetName — caractères interdits Excel remplacés', () => {
  assert.strictEqual(safeSheetName('F1:S5/S6\\S7?[x]*', 1, {}), 'F1 S5 S6 S7 x');
});

test('safeSheetName — tronque à 31 caractères', () => {
  const nom = 'F1-S6.S7 MARAVILLA MOTTE PLANTATION 2024';
  const out = safeSheetName(nom, 1, {});
  assert.strictEqual(out.length, SHEET_MAX);
  assert.strictEqual(out, nom.slice(0, SHEET_MAX));
});

test('safeSheetName — collision après troncature suffixée ~2, ~3', () => {
  const used = {};
  const a = 'F1-S6.S7 MARAVILLA MOTTE PLANTATION A';
  const b = 'F1-S6.S7 MARAVILLA MOTTE PLANTATION B';
  const c = 'F1-S6.S7 MARAVILLA MOTTE PLANTATION C';
  const n1 = safeSheetName(a, 1, used);
  const n2 = safeSheetName(b, 2, used);
  const n3 = safeSheetName(c, 3, used);
  assert.strictEqual(n1, a.slice(0, SHEET_MAX));
  assert.ok(n2.endsWith('~2'), 'n2 doit être suffixé ~2, reçu ' + n2);
  assert.ok(n3.endsWith('~3'), 'n3 doit être suffixé ~3, reçu ' + n3);
  assert.ok(n2.length <= SHEET_MAX && n3.length <= SHEET_MAX);
  assert.strictEqual(new Set([n1, n2, n3]).size, 3);
});

test('safeSheetName — collision insensible à la casse', () => {
  const used = {};
  assert.strictEqual(safeSheetName('Parcelle A', 1, used), 'Parcelle A');
  assert.strictEqual(safeSheetName('PARCELLE A', 2, used), 'PARCELLE A~2');
});

test('safeSheetName — dictionnaire partagé : une parcelle « Synthèse » est renommée', () => {
  // Le classeur réserve d'abord le nom de la feuille de synthèse ; une parcelle
  // homonyme doit être suffixée, sinon XLSX.book_append_sheet lève (nom pris).
  const used = {};
  assert.strictEqual(safeSheetName('Synthèse', 0, used), 'Synthèse');
  assert.strictEqual(safeSheetName('Synthèse', 1, used), 'Synthèse~2');
});

test('safeSheetName — nom vide ou non-string → repli sur l\'index', () => {
  assert.strictEqual(safeSheetName('', 4, {}), 'Feuille 4');
  assert.strictEqual(safeSheetName(null, 2, {}), 'Feuille 2');
  assert.strictEqual(safeSheetName('///', 7, {}), 'Feuille 7');
});

// ============================================================================
// buildSyntheseAoA — JH uniquement (aucune colonne DH)
// ============================================================================
test('buildSyntheseAoA — en-tête + une ligne par parcelle, JH seul', () => {
  const aoa = buildSyntheseAoA([
    { nomSb: 'S5 MARAVILLA', label: 'F1- S5 MARAVILLA MD', ferme: 'F1', ha: 2.4, totalJh: 28.35 },
    { nomSb: '', label: 'F5- S1 CORINA', ferme: 'F5', ha: 0, totalJh: 0 },
  ]);
  assert.deepStrictEqual(aoa[0], [
    'Parcelle', 'Libellé BEE ONE', 'Ferme', 'Superficie (ha)', 'Total JH', 'Total JH / Ha',
    'Budget par Ha', '% Consommé', 'JH par Ha restant', 'Total JH Restant',
  ]);
  // 28,35 JH / 2,4 ha = 11,8125 → 11,81 ; aucun budget saisi → 4 cellules vides
  assert.deepStrictEqual(aoa[1],
    ['S5 MARAVILLA', 'F1- S5 MARAVILLA MD', 'F1', 2.4, 28.35, 11.81, '', '', '', '']);
  // ha = 0 → superficie, JH et JH/Ha vides (aucune division par zéro)
  assert.deepStrictEqual(aoa[2], ['F5- S1 CORINA', 'F5- S1 CORINA', 'F5', '', '', '', '', '', '', '']);
  // ligne de total finale
  assert.deepStrictEqual(aoa[3], ['TOTAL (2 parcelles)', '', '', 2.4, 28.35, 11.81, '', '', '', '']);
});

test('buildSyntheseAoA — TOTAL JH/Ha = moyenne PONDÉRÉE (ΣJH / Σha)', () => {
  const aoa = buildSyntheseAoA([
    { nomSb: 'Petite', label: 'Petite', ferme: 'F1', ha: 0.2, totalJh: 10 },  // 50 JH/ha
    { nomSb: 'Grande', label: 'Grande', ferme: 'F1', ha: 8, totalJh: 40 },    //  5 JH/ha
  ]);
  assert.strictEqual(aoa[1][5], 50);
  assert.strictEqual(aoa[2][5], 5);
  // ΣJH = 50, Σha = 8,2 → 6,1 (et surtout PAS (50+5)/2 = 27,5)
  assert.strictEqual(aoa[3][5], 6.1);
});

// Décision produit : une parcelle sans superficie connue est exclue des DEUX
// sommes du ratio (numérateur ET dénominateur). Garder ses JH au numérateur
// gonflerait le JH/ha global — faux, et faux dans le sens qui inquiète.
test('buildSyntheseAoA — parcelle sans ha : exclue du ratio (numérateur ET dénominateur)', () => {
  const aoa = buildSyntheseAoA([
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 2, totalJh: 10 },
    { nomSb: 'B', label: 'B', ferme: 'F1', ha: null, totalJh: 6 },
  ]);
  assert.strictEqual(aoa[2][5], '', 'la parcelle sans ha n\'a pas de ratio');
  // Total JH = 16 : le VOLUME ne perd rien, même sans superficie
  assert.strictEqual(aoa[3][4], 16);
  // Ratio = 10 JH / 2 ha = 5 — surtout PAS 16/2 = 8
  assert.strictEqual(aoa[3][5], 5);
});

test('buildSyntheseAoA — ha = 0 ou négatif traité comme inconnu dans le ratio', () => {
  const aoa = buildSyntheseAoA([
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 4, totalJh: 20 },
    { nomSb: 'B', label: 'B', ferme: 'F1', ha: 0, totalJh: 9 },
    { nomSb: 'C', label: 'C', ferme: 'F1', ha: -1, totalJh: 7 },
  ]);
  assert.strictEqual(aoa[4][4], 36);      // Total JH = 20 + 9 + 7
  assert.strictEqual(aoa[4][5], 5);       // ratio = 20 / 4
});

test('buildSyntheseAoA — aucune parcelle avec superficie → ratio vide, pas de division par zéro', () => {
  const aoa = buildSyntheseAoA([
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 0, totalJh: 10 },
    { nomSb: 'B', label: 'B', ferme: 'F1', ha: null, totalJh: 6 },
  ]);
  assert.strictEqual(aoa[3][3], '');      // Σha nulle → superficie vide
  assert.strictEqual(aoa[3][4], 16);      // le total de JH reste complet
  assert.strictEqual(aoa[3][5], '');      // ni Infinity ni NaN
});

test('buildSyntheseRows — lignes typées (en-tête, données, total)', () => {
  const rows = buildSyntheseRows([
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 1, totalJh: 5 },
  ]);
  assert.deepStrictEqual(rows.map((r) => r.kind), [
    ROW_KIND.COL_HEADER, ROW_KIND.DATA, ROW_KIND.TOTAL_GENERAL, ROW_KIND.NOTE,
  ]);
  assert.deepStrictEqual(rows[2].cells, ['TOTAL (1 parcelle)', '', '', 1, 5, 5, '', '', '', '']);
});

test('buildSyntheseRows/AoA — mêmes cellules (une seule source de données)', () => {
  const parcelles = [{ nomSb: 'A', label: 'A', ferme: 'F1', ha: 1, totalJh: 5 }];
  assert.deepStrictEqual(
    buildSyntheseAoA(parcelles),
    buildSyntheseRows(parcelles).map((r) => r.cells)
  );
});

test('buildSyntheseAoA — aucune colonne DH ni DH/ha', () => {
  const aoa = buildSyntheseAoA([
    { nomSb: 'P', label: 'P', ferme: 'F1', ha: 2, totalJh: 10, totalCout: 9999 },
  ]);
  assert.strictEqual(aoa[0].length, 10);
  assert.ok(!aoa[0].some((h) => /DH/.test(h)));
  assert.ok(!aoa[1].includes(9999), 'le coût ne doit plus apparaître');
});

test('buildSyntheseAoA — liste vide/absente → en-tête seul, sans ligne de total', () => {
  assert.strictEqual(buildSyntheseAoA([]).length, 1);
  assert.strictEqual(buildSyntheseAoA(null).length, 1);
});

// ============================================================================
// Largeurs de colonnes (ws['!cols'] — seule mise en forme écrite par SheetJS
// community : styles de cellule et volets figés y sont ignorés)
// ============================================================================
const BUDGET_WCH = [14, 13, 17, 16];

test('syntheseSheetCols — 10 largeurs, colonnes parcelle larges', () => {
  const cols = syntheseSheetCols();
  assert.strictEqual(cols.length, 10);
  assert.deepStrictEqual(cols.map((c) => c.wch), [32, 32, 10, 14, 12, 14].concat(BUDGET_WCH));
});

test('parcelleSheetCols — colonne A large, une colonne par quinzaine, + Total + JH/Ha + budget', () => {
  assert.deepStrictEqual(parcelleSheetCols(3).map((c) => c.wch), [42, 14, 14, 14, 12, 14].concat(BUDGET_WCH));
  assert.deepStrictEqual(parcelleSheetCols(0).map((c) => c.wch), [42, 12, 14].concat(BUDGET_WCH));
  assert.deepStrictEqual(parcelleSheetCols(null).map((c) => c.wch), [42, 12, 14].concat(BUDGET_WCH));
});

// Le rendu ExcelJS dérive la largeur des bandeaux de `cols.length` : si les
// largeurs et l'en-tête divergent, le bandeau s'arrête avant la dernière
// colonne (ou déborde).
test('cols — autant de largeurs que de colonnes d\'en-tête (les deux feuilles)', () => {
  assert.strictEqual(syntheseSheetCols().length, buildSyntheseRows([])[0].cells.length);
  [0, 1, 3, 26].forEach((nb) => {
    const periodes = Array.from({ length: nb }, (_, i) => 'Q' + i);
    const rows = buildParcelleSheetRows({ nomSb: 'X', ha: 1, periodes, opRows: [] });
    const header = rows.find((r) => r.kind === ROW_KIND.COL_HEADER);
    assert.strictEqual(parcelleSheetCols(nb).length, header.cells.length, 'nb=' + nb);
  });
});

// ============================================================================
// buildParcelleSheetAoA
// ============================================================================
const OP_ROWS = [
  {
    famille: 'Travaux du sol',
    operation: 'Grattage',
    byPeriode: { Q01: { jh: 28, cout: 4200 } },
    total: { jh: 28, cout: 4200 },
  },
  {
    famille: 'Travaux du sol',
    operation: 'Binage',
    byPeriode: { Q02: { jh: 2, cout: 300 } },
    total: { jh: 2, cout: 300 },
  },
  {
    famille: 'Récolte',
    operation: 'Cueillette',
    byPeriode: { Q01: { jh: 10, cout: 1500 }, Q02: { jh: 5, cout: 750 } },
    total: { jh: 15, cout: 2250 },
  },
];

function sheet() {
  return buildParcelleSheetAoA({
    nomSb: 'S5 MARAVILLA',
    ha: 2.4,
    culture: 'Framboise',
    campagne: '2026/2027',
    periodes: ['Q01', 'Q02'],
    opRows: OP_ROWS,
    famillesOrdered: ['Travaux du sol', 'Récolte'],
  });
}

test('buildParcelleSheetAoA — en-tête : libellé en A, valeur en B (2 cellules)', () => {
  const aoa = sheet();
  assert.deepStrictEqual(aoa[0], ['Parcelle :', 'S5 MARAVILLA']);
  assert.deepStrictEqual(aoa[1], ['Superficie :', '2,40 ha']);
  assert.deepStrictEqual(aoa[2], ['Culture :', 'Framboise']);
  assert.deepStrictEqual(aoa[3], ['Campagne :', '2026/2027']);
  assert.deepStrictEqual(aoa[4], []);
});

test('buildParcelleSheetAoA — une seule colonne par quinzaine (JH), pas de DH', () => {
  const aoa = sheet();
  assert.deepStrictEqual(aoa[5], [
    'Famille / Opération', 'Q01', 'Q02', 'Total JH', 'Total JH / Ha',
    'Budget par Ha', '% Consommé', 'JH par Ha restant', 'Total JH Restant',
  ]);
  // aucune valeur de coût dans toute la feuille
  const flat = aoa.reduce((acc, r) => acc.concat(r), []);
  [4200, 300, 1500, 750, 2250, 4500, 5700, 6750].forEach((cout) => {
    assert.ok(!flat.includes(cout), 'le coût ' + cout + ' ne doit plus figurer dans l\'export');
  });
});

test('buildParcelleSheetAoA — superficie inconnue → « — »', () => {
  const aoa = buildParcelleSheetAoA({ nomSb: 'X', ha: 0, periodes: [], opRows: [] });
  assert.deepStrictEqual(aoa[1], ['Superficie :', '—']);
});

test('buildParcelleSheetAoA — familles : titre, opérations indentées, total, ligne vide', () => {
  const aoa = sheet();
  const labels = aoa.slice(6).map(function (r) { return r[0]; });
  assert.deepStrictEqual(labels, [
    'Travaux du sol', '    Grattage', '    Binage', 'Total Travaux du sol', undefined,
    'Récolte', '    Cueillette', 'Total Récolte', undefined,
    'TOTAL GÉNÉRAL',
    // Mention de périmètre : ici aucune famille budgétée sur les 2 présentes.
    'Colonnes budget : périmètre des familles budgétées (0/2). Les colonnes JH couvrent l\'ensemble.',
  ]);
});

test('buildParcelleSheetAoA — valeurs numériques brutes, cellule vide si 0', () => {
  const aoa = sheet();
  assert.deepStrictEqual(aoa[6], ['Travaux du sol']);
  // dernière colonne = JH / ha (2,4 ha) : 28/2,4 = 11,67 ; 2/2,4 = 0,83
  assert.deepStrictEqual(aoa[7], ['    Grattage', 28, '', 28, 11.67, '', '', '', '']);
  assert.deepStrictEqual(aoa[8], ['    Binage', '', 2, 2, 0.83, '', '', '', '']);
});

test('buildParcelleSheetAoA — colonne JH/Ha vide quand la superficie est inconnue', () => {
  const aoa = buildParcelleSheetAoA({
    nomSb: 'X', ha: 0, periodes: ['Q01'], opRows: OP_ROWS,
    famillesOrdered: ['Travaux du sol', 'Récolte'],
  });
  const jhPerHaCol = aoa[5].indexOf('Total JH / Ha');
  aoa.slice(6).forEach((r) => {
    if (r.length > 1) assert.strictEqual(r[jhPerHaCol], '', 'ligne ' + r[0]);
  });
  // aucune valeur non finie nulle part (ni Infinity ni NaN)
  aoa.reduce((acc, r) => acc.concat(r), []).forEach((c) => {
    assert.ok(typeof c !== 'number' || isFinite(c), 'valeur non finie : ' + c);
  });
});

test('buildParcelleSheetAoA — JH/Ha absent des lignes META / BLANK / FAMILLE', () => {
  const aoa = sheet();
  assert.strictEqual(aoa[0].length, 2);   // META
  assert.strictEqual(aoa[4].length, 0);   // BLANK
  assert.strictEqual(aoa[6].length, 1);   // FAMILLE
});

test('buildParcelleSheetAoA — JH/Ha est un NOMBRE arrondi à 2 décimales', () => {
  const aoa = buildParcelleSheetAoA({
    nomSb: 'X', ha: 3, periodes: ['Q01'],
    opRows: [{ famille: 'Récolte', operation: 'C', byPeriode: { Q01: { jh: 1 } }, total: { jh: 1 } }],
    famillesOrdered: ['Récolte'],
  });
  const v = aoa[7][3]; // dernière colonne de la ligne opération : libellé, Q01, Total, JH/Ha
  assert.strictEqual(typeof v, 'number');
  assert.strictEqual(v, 0.33); // 1/3 arrondi, jamais 0.3333333333333333
});

test('buildParcelleSheetAoA — totaux famille et total général', () => {
  const aoa = sheet();
  assert.deepStrictEqual(aoa[9], ['Total Travaux du sol', 28, 2, 30, 12.5, '', '', '', '']);
  assert.deepStrictEqual(aoa[10], []);
  assert.deepStrictEqual(aoa[12], ['    Cueillette', 10, 5, 15, 6.25, '', '', '', '']);
  assert.deepStrictEqual(aoa[13], ['Total Récolte', 10, 5, 15, 6.25, '', '', '', '']);
  assert.deepStrictEqual(aoa[15], ['TOTAL GÉNÉRAL', 38, 7, 45, 18.75, '', '', '', '']);
});

test('buildParcelleSheetAoA — famille hors référentiel ajoutée à la fin', () => {
  const aoa = buildParcelleSheetAoA({
    nomSb: 'X',
    periodes: ['Q01'],
    opRows: [
      { famille: 'Inconnue', operation: 'Op X', byPeriode: { Q01: { jh: 1, cout: 10 } }, total: { jh: 1, cout: 10 } },
      { famille: 'Récolte', operation: 'Cueillette', byPeriode: { Q01: { jh: 2, cout: 20 } }, total: { jh: 2, cout: 20 } },
    ],
    famillesOrdered: ['Récolte'],
  });
  const labels = aoa.slice(6).map(function (r) { return r[0]; });
  assert.deepStrictEqual(labels, [
    'Récolte', '    Cueillette', 'Total Récolte', undefined,
    'Inconnue', '    Op X', 'Total Inconnue', undefined,
    'TOTAL GÉNÉRAL',
    'Colonnes budget : périmètre des familles budgétées (0/2). Les colonnes JH couvrent l\'ensemble.',
  ]);
});

test('buildParcelleSheetAoA — aucune ligne → en-tête + TOTAL GÉNÉRAL vide', () => {
  const aoa = buildParcelleSheetAoA({ nomSb: 'X', periodes: ['Q01'], opRows: [], famillesOrdered: [] });
  assert.strictEqual(aoa.length, 7);
  assert.deepStrictEqual(aoa[6], ['TOTAL GÉNÉRAL', '', '', '', '', '', '', '']);
});

// ============================================================================
// buildParcelleSheetRows — contrat de typage des lignes consommé par ExcelJS
// ============================================================================
test('buildParcelleSheetRows — kinds dans l\'ordre attendu', () => {
  const rows = buildParcelleSheetRows({
    nomSb: 'S5 MARAVILLA', ha: 2.4, culture: 'Framboise', campagne: '2026/2027',
    periodes: ['Q01', 'Q02'], opRows: OP_ROWS, famillesOrdered: ['Travaux du sol', 'Récolte'],
  });
  assert.deepStrictEqual(rows.map((r) => r.kind), [
    ROW_KIND.META, ROW_KIND.META, ROW_KIND.META, ROW_KIND.META, ROW_KIND.BLANK,
    ROW_KIND.COL_HEADER,
    ROW_KIND.FAMILLE, ROW_KIND.OPERATION, ROW_KIND.OPERATION, ROW_KIND.TOTAL_FAMILLE, ROW_KIND.BLANK,
    ROW_KIND.FAMILLE, ROW_KIND.OPERATION, ROW_KIND.TOTAL_FAMILLE, ROW_KIND.BLANK,
    ROW_KIND.TOTAL_GENERAL, ROW_KIND.NOTE,
  ]);
});

test('buildParcelleSheetRows — libellé d\'opération NON indenté (indent = rendu)', () => {
  const rows = buildParcelleSheetRows({
    periodes: ['Q01'],
    opRows: [{ famille: 'Récolte', operation: 'Cueillette', byPeriode: { Q01: { jh: 2 } }, total: { jh: 2 } }],
    famillesOrdered: ['Récolte'],
  });
  const op = rows.find((r) => r.kind === ROW_KIND.OPERATION);
  assert.strictEqual(op.cells[0], 'Cueillette');
  // …et l'AoA (SheetJS/CSV) porte bien l'indentation par espaces
  const aoa = buildParcelleSheetAoA({
    periodes: ['Q01'],
    opRows: [{ famille: 'Récolte', operation: 'Cueillette', byPeriode: { Q01: { jh: 2 } }, total: { jh: 2 } }],
    famillesOrdered: ['Récolte'],
  });
  assert.strictEqual(aoa[7][0], '    Cueillette');
});

test('buildParcelleSheetRows/AoA — mêmes valeurs numériques', () => {
  const params = {
    nomSb: 'X', periodes: ['Q01', 'Q02'], opRows: OP_ROWS,
    famillesOrdered: ['Travaux du sol', 'Récolte'],
  };
  const fromRows = buildParcelleSheetRows(params).map((r) => r.cells.slice(1));
  const fromAoa = buildParcelleSheetAoA(params).map((r) => r.slice(1));
  assert.deepStrictEqual(fromAoa, fromRows);
});

test('buildParcelleSheetAoA — paramètres absents tolérés, aucun throw', () => {
  const aoa = buildParcelleSheetAoA(null);
  assert.deepStrictEqual(aoa[0], ['Parcelle :', '']);
  assert.deepStrictEqual(aoa[1], ['Superficie :', '—']);
  assert.deepStrictEqual(aoa[5], [
    'Famille / Opération', 'Total JH', 'Total JH / Ha',
    'Budget par Ha', '% Consommé', 'JH par Ha restant', 'Total JH Restant',
  ]);
});

// ============================================================================
// numFmtFor — format numérique Excel choisi valeur par valeur
//
// Le format unique `#,##0.##` laissait un séparateur décimal traîner sur les
// entiers (« 6. », « 12. », « 28. » dans le fichier livré).
// ============================================================================
test('numFmtFor — entier → aucun séparateur décimal', () => {
  assert.strictEqual(numFmtFor(6), '#,##0');
  assert.strictEqual(numFmtFor(0), '#,##0');
  assert.strictEqual(numFmtFor(1234), '#,##0');
  assert.strictEqual(numFmtFor(-12), '#,##0');
});

test('numFmtFor — décimal → autant de décimales que la valeur en porte (2 max)', () => {
  assert.strictEqual(numFmtFor(6.5), '#,##0.0');
  assert.strictEqual(numFmtFor(2.1), '#,##0.0');       // pas d'artefact flottant
  assert.strictEqual(numFmtFor(11.81), '#,##0.00');
  assert.strictEqual(numFmtFor(-0.83), '#,##0.00');
  assert.strictEqual(numFmtFor(1 / 3), '#,##0.00');    // garde-fou d'arrondi
});

// Rendu RÉEL du format : SSF est le moteur de formatage de SheetJS (dépendance
// du projet), qui applique les mêmes codes de format qu'Excel. C'est lui qui
// reproduit le bug d'origine : SSF.format('#,##0.##', 6) === '6.'.
test('numFmtFor — texte affiché : pas de séparateur décimal traînant', () => {
  const SSF = require('xlsx').SSF;
  assert.strictEqual(SSF.format('#,##0.##', 6), '6.', 'le bug d\'origine doit bien être reproduit');
  [
    [6, '6'],
    [12, '12'],
    [28, '28'],
    [1234, '1,234'],
    [6.5, '6.5'],
    [11.81, '11.81'],
    [0.83, '0.83'],
  ].forEach(([v, expected]) => {
    const shown = SSF.format(numFmtFor(v), v);
    assert.strictEqual(shown, expected, v + ' → ' + shown);
    assert.ok(!/[.,]$/.test(shown), 'séparateur traînant sur ' + shown);
  });
});

test('numFmtFor — non-nombre ou valeur non finie → aucun format', () => {
  assert.strictEqual(numFmtFor(''), null);
  assert.strictEqual(numFmtFor('12'), null);
  assert.strictEqual(numFmtFor(null), null);
  assert.strictEqual(numFmtFor(undefined), null);
  assert.strictEqual(numFmtFor(Infinity), null);
  assert.strictEqual(numFmtFor(NaN), null);
});

// ============================================================================
// Suivi budgétaire — sumBudget / budgetCells
//
// Contrat produit : SANS budget saisi (le cas NOMINAL au démarrage) ou SANS
// superficie connue, les 4 colonnes sont VIDES. Jamais 0, jamais 100 %, jamais
// ∞, jamais NaN — un export rempli de 0 laisserait croire à un dépassement.
// ============================================================================
test('sumBudget — somme les familles, ignore 0 / négatif / non numérique', () => {
  assert.strictEqual(sumBudget({ Taille: 10, Récolte: 5.5 }), 15.5);
  assert.strictEqual(sumBudget({ Taille: 10, Récolte: 0, Arrachage: -3, X: 'abc' }), 10);
  assert.strictEqual(sumBudget({}), 0);
  assert.strictEqual(sumBudget(null), 0);
  assert.strictEqual(sumBudget(undefined), 0);
});

test('budgetCells — cas nominal : 12 JH/ha sur 2 ha, 6 JH réalisés', () => {
  // budget total = 24 JH ; consommé = 6/24 = 25 % ; restant = 18 JH, 9 JH/ha
  assert.deepStrictEqual(budgetCells(12, 2, 6), [12, 0.25, 9, 18]);
});

test('budgetCells — budget absent, nul ou négatif → 4 cellules vides', () => {
  [undefined, null, 0, '', -5, 'abc', NaN].forEach((b) => {
    assert.deepStrictEqual(budgetCells(b, 2, 6), ['', '', '', ''], 'budget=' + b);
  });
});

test('budgetCells — superficie inconnue, nulle ou négative → 4 cellules vides', () => {
  [undefined, null, 0, '', -1, 'abc'].forEach((ha) => {
    assert.deepStrictEqual(budgetCells(12, ha, 6), ['', '', '', ''], 'ha=' + ha);
  });
});

test('budgetCells — aucune valeur non finie ne peut sortir (ni ∞ ni NaN)', () => {
  [[12, 0, 6], [0, 2, 6], [Infinity, 2, 6], [12, Infinity, 6], [12, 2, Infinity]]
    .forEach((args) => {
      budgetCells(args[0], args[1], args[2]).forEach((c) => {
        assert.ok(c === '' || (typeof c === 'number' && isFinite(c)),
          'cellule non finie pour ' + JSON.stringify(args) + ' : ' + c);
      });
    });
});

test('budgetCells — 0 JH réalisé : 0 %, budget entièrement restant (et NON vide)', () => {
  // Le 0 est ici une information (« rien de consommé »), pas une case blanche.
  assert.deepStrictEqual(budgetCells(10, 3, 0), [10, 0, 10, 30]);
  assert.deepStrictEqual(budgetCells(10, 3, null), [10, 0, 10, 30]);
});

test('budgetCells — dépassement > 100 % affiché tel quel, restants négatifs', () => {
  // budget 24 JH, 30 réalisés → 125 %, -3 JH/ha, -6 JH
  assert.deepStrictEqual(budgetCells(12, 2, 30), [12, 1.25, -3, -6]);
});

test('budgetCells — % Consommé est un RATIO (0,4567), pas 45,67', () => {
  const cells = budgetCells(10, 1, 4.567);
  assert.strictEqual(cells[1], 0.4567);
  assert.ok(cells[1] < 1, 'un format Excel « 0% » multiplie déjà par 100');
});

test('budgetCells — ratio arrondi à 4 décimales (2 décimales en %)', () => {
  // 1 / 3 = 0,3333333… → 0,3333 (33,33 %)
  assert.strictEqual(budgetCells(1, 3, 1)[1], 0.3333);
});

// ============================================================================
// percentFmtFor / percentColumns — format Excel de la colonne « % Consommé »
// ============================================================================
test('percentFmtFor — décimales exactes de la valeur AFFICHÉE (en %)', () => {
  assert.strictEqual(percentFmtFor(0.25), '0%');      // 25 %
  assert.strictEqual(percentFmtFor(1), '0%');         // 100 %
  assert.strictEqual(percentFmtFor(0.125), '0.0%');   // 12,5 %
  assert.strictEqual(percentFmtFor(0.4567), '0.00%'); // 45,67 %
  assert.strictEqual(percentFmtFor(0), '0%');
});

test('percentFmtFor — non-nombre ou valeur non finie → aucun format', () => {
  [null, undefined, '', '0.25', Infinity, NaN].forEach((v) => {
    assert.strictEqual(percentFmtFor(v), null, 'valeur ' + v);
  });
});

test('percentFmtFor — rendu réel (SSF) : le ratio devient un pourcentage', () => {
  const SSF = require('xlsx').SSF;
  [[0.25, '25%'], [1.25, '125%'], [0.4567, '45.67%'], [0, '0%'], [-0.05, '-5%']]
    .forEach(([v, expected]) => {
      assert.strictEqual(SSF.format(percentFmtFor(v), v), expected, String(v));
    });
});

test('percentColumns — index (base 1) repéré par l\'en-tête, pas en dur', () => {
  const synth = buildSyntheseRows([]);
  assert.deepStrictEqual(percentColumns(synth), [8]);
  assert.strictEqual(synth[0].cells[7], PERCENT_HEADER);
  const parc = buildParcelleSheetRows({ nomSb: 'X', ha: 1, periodes: ['Q01', 'Q02'], opRows: [] });
  assert.deepStrictEqual(percentColumns(parc), [7]);
  assert.strictEqual(percentColumns([]).length, 0);
  assert.strictEqual(percentColumns(null).length, 0);
});

// ============================================================================
// Feuille parcelle — colonnes budgétaires
// ============================================================================
const BUD_PARAMS = {
  nomSb: 'S5 MARAVILLA',
  ha: 2,
  culture: 'Framboise',
  campagne: '2026/2027',
  periodes: ['Q01', 'Q02'],
  opRows: OP_ROWS,               // Travaux du sol : 30 JH ; Récolte : 15 JH
  famillesOrdered: ['Travaux du sol', 'Récolte'],
  budgets: { 'Travaux du sol': 20, 'Récolte': 10, 'Taille': 5 },
};

test('feuille parcelle — budget porté par TOTAL_FAMILLE, jamais par les OPERATION', () => {
  const rows = buildParcelleSheetRows(BUD_PARAMS);
  rows.filter((r) => r.kind === ROW_KIND.OPERATION).forEach((r) => {
    assert.deepStrictEqual(r.cells.slice(-4), ['', '', '', ''], 'op ' + r.cells[0]);
  });
  const fam = rows.filter((r) => r.kind === ROW_KIND.TOTAL_FAMILLE);
  // Travaux du sol : budget 20 JH/ha × 2 ha = 40 JH ; réalisé 30 → 75 %,
  // restant 5 JH/ha et 10 JH.
  assert.deepStrictEqual(fam[0].cells.slice(-4), [20, 0.75, 5, 10]);
  // Récolte : 10 × 2 = 20 JH ; réalisé 15 → 75 %, 2,5 JH/ha, 5 JH.
  assert.deepStrictEqual(fam[1].cells.slice(-4), [10, 0.75, 2.5, 5]);
});

test('feuille parcelle — TOTAL GÉNÉRAL : tous les budgets, JH des seules familles budgétées', () => {
  const rows = buildParcelleSheetRows(BUD_PARAMS);
  const tot = rows.filter((r) => r.kind === ROW_KIND.TOTAL_GENERAL)[0];
  // Σ budgets = 20 + 10 + 5 = 35 JH/ha (« Taille » est budgétée mais pas encore
  // travaillée : pas de ligne dans la feuille, son budget compte quand même)
  // → 70 JH budgétés sur 2 ha. Les deux familles travaillées (Travaux du sol
  // 30 JH, Récolte 15 JH) sont budgétées, donc toutes deux au numérateur : 45 JH
  // → 64,29 %, restant 12,5 JH/ha et 25 JH.
  assert.deepStrictEqual(tot.cells.slice(-4), [35, 0.6429, 12.5, 25]);
  // Périmètre : 3 familles budgétées sur 3 connues (2 travaillées + Taille).
  const note = rows.filter((r) => r.kind === ROW_KIND.NOTE)[0];
  assert.strictEqual(note.cells[0],
    'Colonnes budget : périmètre des familles budgétées (3/3). Les colonnes JH couvrent l\'ensemble.');
});

// RÉGRESSION (QA LOT 2) : le TOTAL comparait un numérateur exhaustif à un
// dénominateur partiel → dépassement fantôme. Périmètre égal des deux côtés.
test('feuille parcelle — famille NON budgétée : ses JH ne consomment pas le budget des autres', () => {
  const rows = buildParcelleSheetRows({
    nomSb: 'X', ha: 2, periodes: ['Q01'],
    opRows: [
      { famille: 'Travaux du sol', operation: 'Grattage', byPeriode: { Q01: { jh: 30 } }, total: { jh: 30 } },
      { famille: 'Récolte', operation: 'Cueillette', byPeriode: { Q01: { jh: 15 } }, total: { jh: 15 } },
    ],
    famillesOrdered: ['Travaux du sol', 'Récolte'],
    budgets: { 'Récolte': 10 },   // Travaux du sol : AUCUN budget
  });
  const fam = rows.filter((r) => r.kind === ROW_KIND.TOTAL_FAMILLE);
  assert.deepStrictEqual(fam[0].cells.slice(-4), ['', '', '', ''], 'Travaux du sol non budgétée');
  // Récolte : 10 × 2 = 20 JH budgétés, 15 réalisés → 75 %
  assert.deepStrictEqual(fam[1].cells.slice(-4), [10, 0.75, 2.5, 5]);
  // TOTAL : MÊME 75 % — et surtout PAS 45/20 = 225 % (le bug corrigé), qui
  // s'affichait en rouge alors qu'aucune ligne visible ne dépassait.
  const tot = rows.filter((r) => r.kind === ROW_KIND.TOTAL_GENERAL)[0];
  assert.deepStrictEqual(tot.cells.slice(-4), [10, 0.75, 2.5, 5]);
  // …et le volume de JH reste complet (30 + 15), lui.
  assert.strictEqual(tot.cells[2], 45);
  // La mention de périmètre annonce 1 famille budgétée sur 2.
  const note = rows.filter((r) => r.kind === ROW_KIND.NOTE)[0];
  assert.strictEqual(note.cells[0],
    'Colonnes budget : périmètre des familles budgétées (1/2). Les colonnes JH couvrent l\'ensemble.');
});

test('feuille parcelle — aucun budget saisi : colonnes vides partout (cas nominal)', () => {
  const rows = buildParcelleSheetRows(Object.assign({}, BUD_PARAMS, { budgets: undefined }));
  rows.forEach((r) => {
    if (r.kind === ROW_KIND.COL_HEADER || r.cells.length < 5) return;
    assert.deepStrictEqual(r.cells.slice(-4), ['', '', '', ''], 'ligne ' + r.cells[0]);
  });
});

test('feuille parcelle — budget saisi mais superficie inconnue → colonnes vides', () => {
  const rows = buildParcelleSheetRows(Object.assign({}, BUD_PARAMS, { ha: 0 }));
  rows.forEach((r) => {
    if (r.kind === ROW_KIND.COL_HEADER || r.cells.length < 5) return;
    assert.deepStrictEqual(r.cells.slice(-4), ['', '', '', ''], 'ligne ' + r.cells[0]);
  });
});

test('feuille parcelle — budget d\'une famille à 0 = pas de budget → vide', () => {
  const rows = buildParcelleSheetRows(Object.assign({}, BUD_PARAMS, {
    budgets: { 'Travaux du sol': 0, 'Récolte': 10 },
  }));
  const fam = rows.filter((r) => r.kind === ROW_KIND.TOTAL_FAMILLE);
  assert.deepStrictEqual(fam[0].cells.slice(-4), ['', '', '', '']);
  assert.deepStrictEqual(fam[1].cells.slice(-4), [10, 0.75, 2.5, 5]);
  // TOTAL GÉNÉRAL : budget 10 × 2 = 20 JH, et au numérateur les SEULS JH de
  // Récolte (15) — les 30 JH de Travaux du sol, dont le budget à 0 vaut « pas
  // de budget », sont hors périmètre. 15/20 = 75 %, identique à la ligne
  // Récolte. L'ancienne règle imputait 45 JH à ce budget → 225 % en rouge.
  const tot = rows.filter((r) => r.kind === ROW_KIND.TOTAL_GENERAL)[0];
  assert.deepStrictEqual(tot.cells.slice(-4), [10, 0.75, 2.5, 5]);
  assert.strictEqual(tot.cells[3], 45, 'le volume de JH reste complet');
  const note = rows.filter((r) => r.kind === ROW_KIND.NOTE)[0];
  assert.strictEqual(note.cells[0],
    'Colonnes budget : périmètre des familles budgétées (1/2). Les colonnes JH couvrent l\'ensemble.');
});

test('feuille parcelle — dépassement famille > 100 % non plafonné', () => {
  const rows = buildParcelleSheetRows(Object.assign({}, BUD_PARAMS, {
    budgets: { 'Travaux du sol': 10 },   // 20 JH budgétés, 30 réalisés
  }));
  const fam = rows.filter((r) => r.kind === ROW_KIND.TOTAL_FAMILLE)[0];
  assert.deepStrictEqual(fam.cells.slice(-4), [10, 1.5, -5, -10]);
});

test('feuille parcelle — AoA identique aux lignes typées (budget compris)', () => {
  const fromRows = buildParcelleSheetRows(BUD_PARAMS).map((r) => r.cells.slice(1));
  const fromAoa = buildParcelleSheetAoA(BUD_PARAMS).map((r) => r.slice(1));
  assert.deepStrictEqual(fromAoa, fromRows);
});

// ============================================================================
// Feuille Synthèse — colonnes budgétaires agrégées par parcelle
// ============================================================================
test('synthèse — budget d\'une parcelle = Σ des budgets de ses familles', () => {
  const aoa = buildSyntheseAoA([{
    nomSb: 'A', label: 'A', ferme: 'F1', ha: 2, totalJh: 30,
    budgets: { Taille: 8, 'Récolte': 12 },
    jhByFamille: { Taille: 10, 'Récolte': 20 },
  }]);
  // Σ budgets = 20 JH/ha × 2 ha = 40 JH ; 30 JH sur familles budgétées → 75 %,
  // 5 JH/ha et 10 JH restants.
  assert.deepStrictEqual(aoa[1].slice(-4), [20, 0.75, 5, 10]);
  assert.deepStrictEqual(aoa[2].slice(-4), [20, 0.75, 5, 10]);
});

// RÉGRESSION (QA LOT 2) : même bug que sur la feuille parcelle, côté Synthèse.
test('synthèse — les JH d\'une famille non budgétée ne consomment pas le budget', () => {
  const aoa = buildSyntheseAoA([{
    nomSb: 'A', label: 'A', ferme: 'F1', ha: 2, totalJh: 45,
    budgets: { 'Récolte': 10 },                              // Travaux du sol : rien
    jhByFamille: { 'Travaux du sol': 30, 'Récolte': 15 },
  }]);
  // Périmètre budgété : Récolte seule → 20 JH budgétés, 15 réalisés = 75 %.
  // Surtout PAS 45/20 = 225 % (le bug corrigé).
  assert.deepStrictEqual(aoa[1].slice(-4), [10, 0.75, 2.5, 5]);
  assert.strictEqual(aoa[1][4], 45, 'le volume de JH reste complet');
  assert.deepStrictEqual(aoa[2].slice(-4), [10, 0.75, 2.5, 5], 'TOTAL cohérent avec la ligne');
});

test('synthèse — aucun budget saisi : colonnes vides sur les parcelles ET le TOTAL', () => {
  const rows = buildSyntheseRows([
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 2, totalJh: 30, jhByFamille: { Taille: 30 } },
    { nomSb: 'B', label: 'B', ferme: 'F1', ha: 3, totalJh: 10, budgets: {} },
  ]);
  rows.filter((r) => r.kind === ROW_KIND.DATA || r.kind === ROW_KIND.TOTAL_GENERAL)
    .forEach((r) => assert.deepStrictEqual(r.cells.slice(-4), ['', '', '', ''], r.cells[0]));
  // La mention de périmètre le dit explicitement : 0 parcelle budgétée sur 2.
  const note = rows.filter((r) => r.kind === ROW_KIND.NOTE)[0];
  assert.strictEqual(note.cells[0],
    'Colonnes budget : périmètre des parcelles budgétées à superficie connue (0/2). '
    + 'Les colonnes JH couvrent l\'ensemble.');
});

test('synthèse — TOTAL : parcelles sans superficie exclues des sommes budgétaires', () => {
  const rows = buildSyntheseRows([
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 2, totalJh: 30, budgets: { Taille: 20 }, jhByFamille: { Taille: 30 } },
    { nomSb: 'B', label: 'B', ferme: 'F1', ha: null, totalJh: 50, budgets: { Taille: 20 }, jhByFamille: { Taille: 50 } },
  ]);
  const aoa = rows.map((r) => r.cells);
  assert.deepStrictEqual(aoa[2].slice(-4), ['', '', '', ''], 'B n\'a pas de ha connu');
  // TOTAL : seule A compte → 40 JH budgétés, 30 réalisés (les 50 JH de B, dont
  // la surface est inconnue, ne consomment pas le budget de A)
  assert.deepStrictEqual(aoa[3].slice(-4), [20, 0.75, 5, 10]);
  assert.strictEqual(aoa[3][4], 80, 'le TOTAL des JH reste complet (volume)');
  assert.strictEqual(rows[4].kind, ROW_KIND.NOTE);
  assert.ok(rows[4].cells[0].indexOf('(1/2)') !== -1, rows[4].cells[0]);
});

test('synthèse — TOTAL : parcelles non budgétées exclues, budget par ha PONDÉRÉ', () => {
  const rows = buildSyntheseRows([
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 1, totalJh: 5, budgets: { Taille: 10 }, jhByFamille: { Taille: 5 } },   // 10 JH
    { nomSb: 'B', label: 'B', ferme: 'F1', ha: 3, totalJh: 60, budgets: { Taille: 30 }, jhByFamille: { Taille: 60 } }, // 90 JH
    { nomSb: 'C', label: 'C', ferme: 'F1', ha: 5, totalJh: 40, jhByFamille: { Taille: 40 } },                          // hors budget
  ]);
  const total = rows.filter((r) => r.kind === ROW_KIND.TOTAL_GENERAL)[0].cells;
  // Σ budget = 100 JH sur 4 ha budgétés → 25 JH/ha (pondéré, PAS (10+30)/2 = 20)
  // consommé = 65 JH sur 100 → 65 % ; restant 8,75 JH/ha et 35 JH
  assert.deepStrictEqual(total.slice(-4), [25, 0.65, 8.75, 35]);
  assert.strictEqual(total[4], 105, 'le TOTAL des JH inclut la parcelle non budgétée');
  const note = rows.filter((r) => r.kind === ROW_KIND.NOTE)[0];
  assert.ok(note.cells[0].indexOf('(2/3)') !== -1, note.cells[0]);
});

test('synthèse — dépassement > 100 % remonté au TOTAL', () => {
  const aoa = buildSyntheseAoA([{
    nomSb: 'A', label: 'A', ferme: 'F1', ha: 2, totalJh: 60,
    budgets: { Taille: 20 }, jhByFamille: { Taille: 60 },
  }]);
  // 40 JH budgétés, 60 réalisés sur la famille budgétée → 150 %, -10 JH/ha, -20 JH
  assert.deepStrictEqual(aoa[1].slice(-4), [20, 1.5, -10, -20]);
  assert.deepStrictEqual(aoa[2].slice(-4), [20, 1.5, -10, -20]);
});

test('synthèse — Rows et AoA portent les mêmes cellules budgétaires', () => {
  const parcelles = [
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 2, totalJh: 30, budgets: { Taille: 20 } },
  ];
  assert.deepStrictEqual(
    buildSyntheseAoA(parcelles),
    buildSyntheseRows(parcelles).map((r) => r.cells)
  );
});
