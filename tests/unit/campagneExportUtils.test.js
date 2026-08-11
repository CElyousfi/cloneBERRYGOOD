'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  SHEET_MAX,
  haLabel,
  safeSheetName,
  buildSyntheseAoA,
  buildParcelleSheetAoA,
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
// buildSyntheseAoA
// ============================================================================
test('buildSyntheseAoA — en-tête + une ligne par parcelle, DH/ha calculé', () => {
  const aoa = buildSyntheseAoA([
    { nomSb: 'S5 MARAVILLA', label: 'F1- S5 MARAVILLA MD', ferme: 'F1', ha: 2.4, totalJh: 28.35, totalCout: 24000 },
    { nomSb: '', label: 'F5- S1 CORINA', ferme: 'F5', ha: 0, totalJh: 0, totalCout: 0 },
  ]);
  assert.deepStrictEqual(aoa[0], [
    'Parcelle', 'Libellé BEE ONE', 'Ferme', 'Superficie (ha)', 'Total JH', 'Total DH', 'DH/ha',
  ]);
  assert.deepStrictEqual(aoa[1], ['S5 MARAVILLA', 'F1- S5 MARAVILLA MD', 'F1', 2.4, 28.35, 24000, 10000]);
  // ha = 0 → superficie, JH, DH vides et pas de DH/ha (division impossible)
  assert.deepStrictEqual(aoa[2], ['F5- S1 CORINA', 'F5- S1 CORINA', 'F5', '', '', '', '']);
});

test('buildSyntheseAoA — liste vide/absente → en-tête seul', () => {
  assert.strictEqual(buildSyntheseAoA([]).length, 1);
  assert.strictEqual(buildSyntheseAoA(null).length, 1);
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

test('buildParcelleSheetAoA — en-tête parcelle, superficie, culture, campagne', () => {
  const aoa = sheet();
  assert.deepStrictEqual(aoa[0], ['Parcelle : S5 MARAVILLA', 'Superficie : 2,40 ha']);
  assert.deepStrictEqual(aoa[1], ['Culture : Framboise', 'Campagne : 2026/2027']);
  assert.deepStrictEqual(aoa[2], []);
  assert.deepStrictEqual(aoa[3], ['Famille / Opération', 'Q01 JH', 'Q01 DH', 'Q02 JH', 'Q02 DH', 'Total JH', 'Total DH']);
});

test('buildParcelleSheetAoA — superficie inconnue → « — »', () => {
  const aoa = buildParcelleSheetAoA({ nomSb: 'X', ha: 0, periodes: [], opRows: [] });
  assert.deepStrictEqual(aoa[0], ['Parcelle : X', 'Superficie : —']);
});

test('buildParcelleSheetAoA — lignes opérations groupées par famille, ordre du référentiel', () => {
  const aoa = sheet();
  const labels = aoa.slice(4).map(function (r) { return r[0]; });
  assert.deepStrictEqual(labels, [
    'Grattage', 'Binage', 'Total Travaux du sol',
    'Cueillette', 'Total Récolte',
    'TOTAL GÉNÉRAL',
  ]);
});

test('buildParcelleSheetAoA — valeurs numériques brutes, cellule vide si 0', () => {
  const aoa = sheet();
  assert.deepStrictEqual(aoa[4], ['Grattage', 28, 4200, '', '', 28, 4200]);
  assert.deepStrictEqual(aoa[5], ['Binage', '', '', 2, 300, 2, 300]);
});

test('buildParcelleSheetAoA — totaux famille et total général', () => {
  const aoa = sheet();
  assert.deepStrictEqual(aoa[6], ['Total Travaux du sol', 28, 4200, 2, 300, 30, 4500]);
  assert.deepStrictEqual(aoa[7], ['Cueillette', 10, 1500, 5, 750, 15, 2250]);
  assert.deepStrictEqual(aoa[8], ['Total Récolte', 10, 1500, 5, 750, 15, 2250]);
  assert.deepStrictEqual(aoa[9], ['TOTAL GÉNÉRAL', 38, 5700, 7, 1050, 45, 6750]);
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
  const labels = aoa.slice(4).map(function (r) { return r[0]; });
  assert.deepStrictEqual(labels, ['Cueillette', 'Total Récolte', 'Op X', 'Total Inconnue', 'TOTAL GÉNÉRAL']);
});

test('buildParcelleSheetAoA — aucune ligne → en-tête + TOTAL GÉNÉRAL vide', () => {
  const aoa = buildParcelleSheetAoA({ nomSb: 'X', periodes: ['Q01'], opRows: [], famillesOrdered: [] });
  assert.strictEqual(aoa.length, 5);
  assert.deepStrictEqual(aoa[4], ['TOTAL GÉNÉRAL', '', '', '', '']);
});

test('buildParcelleSheetAoA — paramètres absents tolérés, aucun throw', () => {
  const aoa = buildParcelleSheetAoA(null);
  assert.deepStrictEqual(aoa[0], ['Parcelle : ', 'Superficie : —']);
  assert.deepStrictEqual(aoa[3], ['Famille / Opération', 'Total JH', 'Total DH']);
});
