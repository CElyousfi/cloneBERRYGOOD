'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  SHEET_MAX,
  ROW_KIND,
  haLabel,
  numFmtFor,
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
  ]);
  // 28,35 JH / 2,4 ha = 11,8125 → 11,81
  assert.deepStrictEqual(aoa[1], ['S5 MARAVILLA', 'F1- S5 MARAVILLA MD', 'F1', 2.4, 28.35, 11.81]);
  // ha = 0 → superficie, JH et JH/Ha vides (aucune division par zéro)
  assert.deepStrictEqual(aoa[2], ['F5- S1 CORINA', 'F5- S1 CORINA', 'F5', '', '', '']);
  // ligne de total finale
  assert.deepStrictEqual(aoa[3], ['TOTAL (2 parcelles)', '', '', 2.4, 28.35, 11.81]);
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

test('buildSyntheseAoA — ha manquant sur une parcelle : exclu du ratio, pas du total', () => {
  const aoa = buildSyntheseAoA([
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 2, totalJh: 10 },
    { nomSb: 'B', label: 'B', ferme: 'F1', ha: null, totalJh: 6 },
  ]);
  assert.strictEqual(aoa[2][5], '');
  // Σha = 2 (B n'apporte aucune superficie), ΣJH = 16 → 8
  assert.strictEqual(aoa[3][5], 8);
});

test('buildSyntheseRows — lignes typées (en-tête, données, total)', () => {
  const rows = buildSyntheseRows([
    { nomSb: 'A', label: 'A', ferme: 'F1', ha: 1, totalJh: 5 },
  ]);
  assert.deepStrictEqual(rows.map((r) => r.kind), [
    ROW_KIND.COL_HEADER, ROW_KIND.DATA, ROW_KIND.TOTAL_GENERAL,
  ]);
  assert.deepStrictEqual(rows[2].cells, ['TOTAL (1 parcelle)', '', '', 1, 5, 5]);
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
  assert.strictEqual(aoa[0].length, 6);
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
test('syntheseSheetCols — 6 largeurs, colonnes parcelle larges', () => {
  const cols = syntheseSheetCols();
  assert.strictEqual(cols.length, 6);
  assert.deepStrictEqual(cols.map((c) => c.wch), [32, 32, 10, 14, 12, 14]);
});

test('parcelleSheetCols — colonne A large, une colonne par quinzaine, + Total + JH/Ha', () => {
  assert.deepStrictEqual(parcelleSheetCols(3).map((c) => c.wch), [42, 14, 14, 14, 12, 14]);
  assert.deepStrictEqual(parcelleSheetCols(0).map((c) => c.wch), [42, 12, 14]);
  assert.deepStrictEqual(parcelleSheetCols(null).map((c) => c.wch), [42, 12, 14]);
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
  assert.deepStrictEqual(aoa[5], ['Famille / Opération', 'Q01', 'Q02', 'Total JH', 'Total JH / Ha']);
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
  ]);
});

test('buildParcelleSheetAoA — valeurs numériques brutes, cellule vide si 0', () => {
  const aoa = sheet();
  assert.deepStrictEqual(aoa[6], ['Travaux du sol']);
  // dernière colonne = JH / ha (2,4 ha) : 28/2,4 = 11,67 ; 2/2,4 = 0,83
  assert.deepStrictEqual(aoa[7], ['    Grattage', 28, '', 28, 11.67]);
  assert.deepStrictEqual(aoa[8], ['    Binage', '', 2, 2, 0.83]);
});

test('buildParcelleSheetAoA — colonne JH/Ha vide quand la superficie est inconnue', () => {
  const aoa = buildParcelleSheetAoA({
    nomSb: 'X', ha: 0, periodes: ['Q01'], opRows: OP_ROWS,
    famillesOrdered: ['Travaux du sol', 'Récolte'],
  });
  aoa.slice(6).forEach((r) => {
    if (r.length > 1) assert.strictEqual(r[r.length - 1], '', 'ligne ' + r[0]);
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
  assert.deepStrictEqual(aoa[9], ['Total Travaux du sol', 28, 2, 30, 12.5]);
  assert.deepStrictEqual(aoa[10], []);
  assert.deepStrictEqual(aoa[12], ['    Cueillette', 10, 5, 15, 6.25]);
  assert.deepStrictEqual(aoa[13], ['Total Récolte', 10, 5, 15, 6.25]);
  assert.deepStrictEqual(aoa[15], ['TOTAL GÉNÉRAL', 38, 7, 45, 18.75]);
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
  ]);
});

test('buildParcelleSheetAoA — aucune ligne → en-tête + TOTAL GÉNÉRAL vide', () => {
  const aoa = buildParcelleSheetAoA({ nomSb: 'X', periodes: ['Q01'], opRows: [], famillesOrdered: [] });
  assert.strictEqual(aoa.length, 7);
  assert.deepStrictEqual(aoa[6], ['TOTAL GÉNÉRAL', '', '', '']);
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
    ROW_KIND.TOTAL_GENERAL,
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
  assert.deepStrictEqual(aoa[5], ['Famille / Opération', 'Total JH', 'Total JH / Ha']);
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
