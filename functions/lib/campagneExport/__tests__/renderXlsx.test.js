'use strict';

/**
 * renderXlsx.test.js — PREUVE PAR RELECTURE.
 *
 * On ne se contente pas de vérifier qu'un buffer est produit : le buffer est
 * RELU par ExcelJS et on assert le contenu ET la mise en forme (bandeaux,
 * gras, bordures, volets figés, formats numériques, alerte de dépassement).
 * C'est la seule façon de prouver que le fichier serveur est bien celui que le
 * navigateur produisait — un classeur qui s'écrit sans erreur peut très bien
 * être vide ou sans styles (cas vécu avec SheetJS, qui ignore les styles).
 */

const test = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');

const { generateCampagneWorkbook, buildCultureWorkbook, renderWorkbookBuffer } = require('../index');
const { DATA, SB_MAP, BUDGETS, TODAY } = require('./fixtures');

const PARAMS = {
  culture: 'Framboise',
  data: DATA,
  sbMap: SB_MAP,
  budgetsByLabel: BUDGETS,
  today: TODAY,
};

/** Génère puis RELIT le classeur : renvoie { buffer, wb } (ExcelJS.Workbook). */
async function roundTrip(params) {
  const out = await generateCampagneWorkbook(params || PARAMS);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out.buffer);
  return { out: out, wb: wb };
}

/** Valeurs d'une ligne relue (index base 1 côté ExcelJS). */
function cellsOf(ws, rowIdx, nb) {
  const row = ws.getRow(rowIdx);
  const out = [];
  for (let c = 1; c <= nb; c += 1) {
    const v = row.getCell(c).value;
    out.push(v === null || v === undefined ? '' : v);
  }
  return out;
}

/** Première ligne dont la colonne A vaut `label`. */
function findRow(ws, label) {
  let found = 0;
  ws.eachRow((row, i) => {
    if (!found && String(row.getCell(1).value || '') === label) found = i;
  });
  assert.ok(found, `ligne « ${label} » introuvable`);
  return found;
}

// ============================================================================
// Buffer
// ============================================================================

test('génère un Buffer .xlsx (jamais un fichier disque)', async () => {
  const out = await generateCampagneWorkbook(PARAMS);
  assert.ok(Buffer.isBuffer(out.buffer), 'doit être un Buffer');
  assert.ok(out.buffer.length > 5000, 'buffer suspicieusement petit');
  // Signature ZIP (OOXML) : PK\x03\x04.
  assert.deepStrictEqual([...out.buffer.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  assert.strictEqual(out.fileName, 'Campagne_Framboise_2026-08-12.xlsx');
  assert.strictEqual(out.nbFeuilles, 3);
});

// ============================================================================
// Contenu relu
// ============================================================================

test('relecture — feuilles attendues, dans l’ordre', async () => {
  const { wb } = await roundTrip();
  assert.deepStrictEqual(wb.worksheets.map((w) => w.name),
    ['Synthèse', 'BAHIA 4', 'MYRTILLE EXTENSION']);
});

test('relecture — Synthèse : en-tête, ligne de données, TOTAL', async () => {
  const { wb } = await roundTrip();
  const ws = wb.getWorksheet('Synthèse');
  assert.deepStrictEqual(cellsOf(ws, 1, 10), [
    'Parcelle', 'Libellé BEE ONE', 'Ferme', 'Superficie (ha)', 'Total JH',
    'Total JH / Ha', 'Budget par Ha', '% Consommé', 'JH par Ha restant', 'Total JH Restant',
  ]);
  const ligne = findRow(ws, 'MYRTILLE EXTENSION');
  assert.deepStrictEqual(cellsOf(ws, ligne, 10),
    ['MYRTILLE EXTENSION', 'S12 YAZMIN', 'F1', 2, 45, 22.5, 10, 0.75, 2.5, 5]);
  const total = findRow(ws, 'TOTAL (2 parcelles)');
  // Total JH = 53 (volume EXHAUSTIF, BAHIA 4 comprise) mais Total JH / Ha =
  // 45 / 2 = 22,5 : BAHIA 4 est sans superficie connue, donc exclue du RATIO au
  // numérateur COMME au dénominateur (sinon le ratio serait gonflé).
  assert.deepStrictEqual(cellsOf(ws, total, 6), ['TOTAL (2 parcelles)', '', '', 2, 53, 22.5]);
});

test('relecture — feuille parcelle : méta, total général, budget par famille', async () => {
  const { wb } = await roundTrip();
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  assert.deepStrictEqual(cellsOf(ws, 1, 2), ['Parcelle :', 'MYRTILLE EXTENSION']);
  assert.deepStrictEqual(cellsOf(ws, 2, 2), ['Superficie :', '2,00 ha']);
  assert.deepStrictEqual(cellsOf(ws, 4, 2), ['Campagne :', '2025/2026']);
  assert.deepStrictEqual(cellsOf(ws, findRow(ws, 'TOTAL GÉNÉRAL'), 9),
    ['TOTAL GÉNÉRAL', 30, 15, 45, 22.5, 10, 0.75, 2.5, 5]);
  assert.deepStrictEqual(cellsOf(ws, findRow(ws, 'Total Récolte'), 9),
    ['Total Récolte', '', 15, 15, 7.5, 10, 0.75, 2.5, 5]);
  // Famille sans budget : les 4 colonnes restent vides (jamais 0 ni 100 %).
  assert.deepStrictEqual(cellsOf(ws, findRow(ws, 'Total Travaux du sol'), 9),
    ['Total Travaux du sol', 30, '', 30, 15, '', '', '', '']);
});

test('relecture — la NOTE de périmètre est bien écrite', async () => {
  const { wb } = await roundTrip();
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  let note = null;
  ws.eachRow((row) => {
    const v = String(row.getCell(1).value || '');
    if (v.indexOf('Colonnes budget') === 0) note = { v: v, font: row.getCell(1).font };
  });
  assert.ok(note, 'NOTE absente du fichier');
  assert.match(note.v, /familles budgétées \(1\/2\)/);
  assert.strictEqual(note.font.italic, true, 'la NOTE doit rester discrète (italique)');
});

// ============================================================================
// Mise en forme relue
// ============================================================================

test('relecture — bandeau d’en-tête berry sur TOUTE la largeur', async () => {
  const { wb } = await roundTrip();
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  const idx = findRow(ws, 'Famille / Opération');
  for (let c = 1; c <= 9; c += 1) {
    const cell = ws.getRow(idx).getCell(c);
    assert.strictEqual(cell.font.bold, true, `col ${c} doit être en gras`);
    assert.strictEqual(cell.font.color.argb, 'FFFFFFFF', `col ${c} texte blanc`);
    assert.strictEqual(cell.fill.fgColor.argb, 'FFC0392B', `col ${c} fond berry`);
  }
});

test('relecture — TOTAL GÉNÉRAL : aplat clair + bordure medium sur toute la largeur', async () => {
  const { wb } = await roundTrip();
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  const idx = findRow(ws, 'TOTAL GÉNÉRAL');
  for (let c = 1; c <= 9; c += 1) {
    const cell = ws.getRow(idx).getCell(c);
    assert.strictEqual(cell.font.bold, true);
    assert.strictEqual(cell.fill.fgColor.argb, 'FFF7E3E1');
    assert.strictEqual(cell.border.top.style, 'medium');
  }
});

test('relecture — ligne FAMILLE grisée, opérations indentées', async () => {
  const { wb } = await roundTrip();
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  const fam = ws.getRow(findRow(ws, 'Récolte'));
  assert.strictEqual(fam.getCell(1).fill.fgColor.argb, 'FFEBEAE3');
  assert.strictEqual(fam.getCell(9).fill.fgColor.argb, 'FFEBEAE3', 'bandeau pleine largeur');
  const op = ws.getRow(findRow(ws, 'Cueillette'));
  assert.strictEqual(op.getCell(1).alignment.indent, 1);
  // Indentation NATIVE : le libellé reste recherchable tel quel (pas d'espaces).
  assert.strictEqual(op.getCell(1).value, 'Cueillette');
});

test('relecture — volets figés sous l’en-tête de colonnes', async () => {
  const { wb } = await roundTrip();
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  const view = ws.views[0];
  assert.strictEqual(view.state, 'frozen');
  assert.strictEqual(view.xSplit, 1);
  assert.strictEqual(view.ySplit, findRow(ws, 'Famille / Opération'));
  const synth = wb.getWorksheet('Synthèse');
  assert.strictEqual(synth.views[0].ySplit, 1);
});

test('relecture — largeurs de colonnes conservées', async () => {
  const { wb } = await roundTrip();
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  assert.strictEqual(ws.getColumn(1).width, 42);
  assert.strictEqual(ws.getColumn(2).width, 14);
  assert.strictEqual(ws.getColumn(9).width, 16);
});

test('relecture — formats numériques choisis valeur par valeur', async () => {
  const { wb } = await roundTrip();
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  const total = ws.getRow(findRow(ws, 'TOTAL GÉNÉRAL'));
  assert.strictEqual(total.getCell(4).numFmt, '#,##0', '45 → entier');
  assert.strictEqual(total.getCell(5).numFmt, '#,##0.0', '22,5 → une décimale');
  // Colonne 7 = « % Consommé » sur une feuille parcelle à 2 quinzaines.
  assert.strictEqual(total.getCell(7).numFmt, '0%', '0,75 → « 75 % »');
  assert.strictEqual(total.getCell(4).alignment.horizontal, 'right');
  // La colonne A n'est jamais formatée comme un nombre.
  assert.strictEqual(total.getCell(1).numFmt, undefined);
});

test('relecture — dépassement de budget signalé (rouge), jamais plafonné', async () => {
  // Récolte : budget 10 JH/ha sur 2 ha = 20 JH, 45 JH consommés → 225 %.
  const budgets = { 'S12 YAZMIN': { 'Récolte': 10, 'Travaux du sol': 0 } };
  const data = JSON.parse(JSON.stringify(DATA));
  data.rows.forEach((r) => { if (r.famille === 'Travaux du sol') r.famille = 'Récolte'; });
  const { wb } = await roundTrip(Object.assign({}, PARAMS, { data, budgetsByLabel: budgets }));
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  const cell = ws.getRow(findRow(ws, 'TOTAL GÉNÉRAL')).getCell(7);
  assert.strictEqual(cell.value, 2.25, 'la valeur exacte est conservée');
  assert.strictEqual(cell.numFmt, '0%');
  assert.strictEqual(cell.font.color.argb, 'FF9C0006');
  assert.strictEqual(cell.fill.fgColor.argb, 'FFFFC7CE');
});

test('relecture — sans budget, les 4 colonnes restent VIDES (cas nominal)', async () => {
  const { wb } = await roundTrip(Object.assign({}, PARAMS, { budgetsByLabel: {} }));
  const ws = wb.getWorksheet('MYRTILLE EXTENSION');
  assert.deepStrictEqual(cellsOf(ws, findRow(ws, 'TOTAL GÉNÉRAL'), 9),
    ['TOTAL GÉNÉRAL', 30, 15, 45, 22.5, '', '', '', '']);
});

test('classeur d’une culture sans parcelle — buffer valide, feuille Synthèse seule', async () => {
  const { out, wb } = await roundTrip(Object.assign({}, PARAMS, { culture: 'Avocatier' }));
  assert.ok(Buffer.isBuffer(out.buffer));
  assert.deepStrictEqual(wb.worksheets.map((w) => w.name), ['Synthèse']);
});

test('renderWorkbookBuffer accepte une description déjà construite', async () => {
  const wbData = buildCultureWorkbook(PARAMS);
  const buf = await renderWorkbookBuffer(wbData);
  assert.ok(Buffer.isBuffer(buf) && buf.length > 5000);
});
