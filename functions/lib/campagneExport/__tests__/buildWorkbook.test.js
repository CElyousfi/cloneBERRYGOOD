'use strict';

/**
 * buildWorkbook.test.js — description PURE du classeur (aucun ExcelJS ici).
 *
 * Vérifie que le port serveur de `buildCultureWorkbook` produit la même
 * structure que l'écran : sélection des parcelles par culture ET par périmètre,
 * ordre alphabétique du nom Smart Berry, une feuille par parcelle, jointure des
 * budgets sur le libellé BEE ONE normalisé.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  buildCultureWorkbook, buildVarieteView, sbNom, sbHa, refKey, cultureOf,
} = require('../buildWorkbook');
const CEU = require('../campagneExportUtils');
const { DATA, SB_MAP, BUDGETS, OP_BUDGETS, TODAY } = require('./fixtures');

function build(over) {
  return buildCultureWorkbook(Object.assign({
    culture: 'Framboise',
    data: DATA,
    sbMap: SB_MAP,
    budgetsByLabel: BUDGETS,
    today: TODAY,
  }, over || {}));
}

/** Même classeur, budget descendu à la maille OPÉRATION (cf. OP_BUDGETS). */
function buildOps(over) {
  return build(Object.assign({ opBudgetsByLabel: OP_BUDGETS }, over || {}));
}

function rowsOfKind(sheet, kind) {
  return sheet.rows.filter((r) => r.kind === kind);
}

// ============================================================================
// Sélection des parcelles
// ============================================================================

test('feuilles = Synthèse + une par parcelle de la culture', () => {
  const wb = build();
  assert.deepStrictEqual(wb.sheets.map((s) => s.name), ['Synthèse', 'BAHIA 4', 'MYRTILLE EXTENSION']);
});

test('la culture vient de culture_sb, JAMAIS de nom_sb', () => {
  // 'MYRTILLE EXTENSION' est une parcelle de FRAMBOISE (piège prod réel).
  const wb = build();
  assert.ok(wb.sheets.some((s) => s.name === 'MYRTILLE EXTENSION'));
  const myrtille = build({ culture: 'Myrtille' });
  assert.deepStrictEqual(myrtille.sheets.map((s) => s.name), ['Synthèse', 'BLEUET NORD']);
});

test('fermeFilter restreint le périmètre (défense en profondeur)', () => {
  const wb = build({ fermeFilter: 'F1' });
  assert.deepStrictEqual(wb.sheets.map((s) => s.name), ['Synthèse', 'MYRTILLE EXTENSION']);
});

test('culture sans parcelle → seule la feuille Synthèse', () => {
  const wb = build({ culture: 'Avocatier' });
  assert.strictEqual(wb.sheets.length, 1);
  assert.strictEqual(wb.sheets[0].name, 'Synthèse');
  // Aucune ligne de données ni de total : uniquement l'en-tête de colonnes.
  assert.strictEqual(rowsOfKind(wb.sheets[0], CEU.ROW_KIND.DATA).length, 0);
  assert.strictEqual(rowsOfKind(wb.sheets[0], CEU.ROW_KIND.TOTAL_GENERAL).length, 0);
});

test('nom de fichier déterministe (date injectée)', () => {
  assert.strictEqual(build().fileName, 'Campagne_Framboise_2026-08-12');
});

// ============================================================================
// Contenu de la Synthèse
// ============================================================================

test('Synthèse — une ligne par parcelle, triée par nom Smart Berry', () => {
  const synth = build().sheets[0];
  const data = rowsOfKind(synth, CEU.ROW_KIND.DATA);
  assert.deepStrictEqual(data.map((r) => r.cells[0]), ['BAHIA 4', 'MYRTILLE EXTENSION']);
  // [nomSb, label, ferme, ha, totalJh, jh/ha, budget/ha, %, jh/ha restant, jh restant]
  assert.deepStrictEqual(data[1].cells.slice(0, 6),
    ['MYRTILLE EXTENSION', 'S12 YAZMIN', 'F1', 2, 45, 22.5]);
  // Parcelle sans superficie connue : ratio vide, jamais Infinity/NaN.
  assert.deepStrictEqual(data[0].cells.slice(0, 6), ['BAHIA 4', 'B4 ADELITA', 'BAHIA', '', 8, '']);
});

test('Synthèse — suivi budgétaire comparé à PÉRIMÈTRE ÉGAL (75 %, pas 225 %)', () => {
  const synth = build().sheets[0];
  const ligne = rowsOfKind(synth, CEU.ROW_KIND.DATA)[1];
  // budget/ha = 10, ratio = 15 JH réalisés sur Récolte / (10 × 2 ha) = 0,75
  assert.deepStrictEqual(ligne.cells.slice(6), [10, 0.75, 2.5, 5]);
});

test('Synthèse — la NOTE annonce le périmètre budgété', () => {
  const notes = rowsOfKind(build().sheets[0], CEU.ROW_KIND.NOTE);
  assert.strictEqual(notes.length, 1);
  assert.match(notes[0].cells[0], /périmètre des parcelles budgétées à superficie connue \(1\/2\)/);
});

// ============================================================================
// Contenu d'une feuille parcelle
// ============================================================================

test('feuille parcelle — en-tête méta + colonnes + total général', () => {
  const ws = build().sheets[2];
  const meta = rowsOfKind(ws, CEU.ROW_KIND.META);
  assert.deepStrictEqual(meta.map((r) => r.cells), [
    ['Parcelle :', 'MYRTILLE EXTENSION'],
    ['Superficie :', '2,00 ha'],
    ['Culture :', 'Framboise'],
    ['Campagne :', '2025/2026'],
  ]);
  const header = rowsOfKind(ws, CEU.ROW_KIND.COL_HEADER)[0].cells;
  assert.deepStrictEqual(header, [
    'Famille / Opération', 'Quinzaine 1', 'Quinzaine 2', 'Total JH', 'Total JH / Ha',
    'Budget par Ha', '% Consommé', 'JH par Ha restant', 'Total JH Restant',
  ]);
  assert.strictEqual(ws.cols.length, header.length);
  const total = rowsOfKind(ws, CEU.ROW_KIND.TOTAL_GENERAL)[0].cells;
  assert.deepStrictEqual(total, ['TOTAL GÉNÉRAL', 30, 15, 45, 22.5, 10, 0.75, 2.5, 5]);
});

test('feuille parcelle — budget par famille : seule la famille budgétée est remplie', () => {
  const ws = build().sheets[2];
  const totFam = rowsOfKind(ws, CEU.ROW_KIND.TOTAL_FAMILLE);
  const byLabel = {};
  totFam.forEach((r) => { byLabel[r.cells[0]] = r.cells; });
  assert.deepStrictEqual(byLabel['Total Récolte'].slice(5), [10, 0.75, 2.5, 5]);
  assert.deepStrictEqual(byLabel['Total Travaux du sol'].slice(5), ['', '', '', '']);
});

test('feuille parcelle — les opérations ne portent aucun budget (maille famille)', () => {
  const ops = rowsOfKind(build().sheets[2], CEU.ROW_KIND.OPERATION);
  assert.ok(ops.length > 0);
  ops.forEach((r) => assert.deepStrictEqual(r.cells.slice(5), ['', '', '', '']));
});

// ============================================================================
// Budgets d'OPÉRATION (`budgets_operations`) — la correction PR #264 portée au
// serveur. Sans eux, ces quatre colonnes sortiraient VIDES dans le classeur
// envoyé par WhatsApp alors que l'écran, lui, les remplit.
// ============================================================================

test('feuille parcelle — une ligne d’opération budgétée est REMPLIE', () => {
  const ops = rowsOfKind(buildOps().sheets[2], CEU.ROW_KIND.OPERATION);
  const byLabel = {};
  ops.forEach((r) => { byLabel[r.cells[0]] = r.cells; });
  // 7 JH/ha × 2 ha = 14 JH budgétés pour 15 réalisés → 107,14 %, restants
  // NÉGATIFS : le dépassement n'est jamais plafonné.
  assert.deepStrictEqual(byLabel['Cueillette'].slice(5), [7, 1.0714, -0.5, -1]);
  // Les opérations d'une famille NON budgétée à cette maille restent vides.
  assert.deepStrictEqual(byLabel['Désherbage'].slice(5), ['', '', '', '']);
});

test('Total famille — les opérations ÉCRASENT la famille (7, jamais 10 ni 17)', () => {
  const totFam = rowsOfKind(buildOps().sheets[2], CEU.ROW_KIND.TOTAL_FAMILLE);
  const byLabel = {};
  totFam.forEach((r) => { byLabel[r.cells[0]] = r.cells; });
  // Règle métier `familleTotal` : sans elle on lirait 10 (saisie de famille).
  assert.strictEqual(byLabel['Total Récolte'][5], 7);
});

test('TOTAL GÉNÉRAL et Synthèse voient le MÊME budget effectif', () => {
  const wb = buildOps();
  const total = rowsOfKind(wb.sheets[2], CEU.ROW_KIND.TOTAL_GENERAL)[0].cells;
  const ligneSynth = rowsOfKind(wb.sheets[0], CEU.ROW_KIND.DATA)[1];
  assert.strictEqual(total[5], 7);
  // La Synthèse reçoit `resolveFamilles(...).scope`, pas la saisie brute : lire
  // `budgets[famille]` la ferait diverger (10) de sa propre feuille (7).
  assert.deepStrictEqual(ligneSynth.cells.slice(6), total.slice(5));
});

test('sans budgets_operations — comportement STRICTEMENT inchangé', () => {
  // Non-régression : le champ est additif, un appelant qui ne le passe pas doit
  // obtenir exactement le classeur d'avant.
  assert.deepStrictEqual(build().sheets, buildOps({ opBudgetsByLabel: {} }).sheets);
});

test('feuille parcelle — familles dans l’ordre du référentiel', () => {
  const fams = rowsOfKind(build().sheets[2], CEU.ROW_KIND.FAMILLE).map((r) => r.cells[0]);
  assert.deepStrictEqual(fams, ['Travaux du sol', 'Récolte']);
});

test('AoA de repli — mêmes valeurs, opérations indentées', () => {
  const ws = build().sheets[2];
  assert.strictEqual(ws.aoa.length, ws.rows.length);
  ws.rows.forEach((r, i) => {
    if (r.kind !== CEU.ROW_KIND.OPERATION) {
      assert.deepStrictEqual(ws.aoa[i], r.cells);
      return;
    }
    assert.strictEqual(ws.aoa[i][0], '    ' + r.cells[0]);
    assert.deepStrictEqual(ws.aoa[i].slice(1), r.cells.slice(1));
  });
});

// ============================================================================
// Helpers
// ============================================================================

test('refKey — normalisation de jointure (trim + majuscules)', () => {
  assert.strictEqual(refKey('  s12 yazmin '), 'S12 YAZMIN');
  assert.strictEqual(refKey(null), '');
});

test('budgets joints même si le label du payload n’est pas normalisé', () => {
  const data = JSON.parse(JSON.stringify(DATA));
  data.rows.forEach((r) => { if (r.parcelle === 'S12 YAZMIN') r.parcelle = ' s12 yazmin '; });
  const ws = build({ data }).sheets.filter((s) => s.name !== 'Synthèse');
  const parcelle = ws.filter((s) => s.name === 'MYRTILLE EXTENSION')[0];
  const total = parcelle.rows.filter((r) => r.kind === CEU.ROW_KIND.TOTAL_GENERAL)[0];
  assert.strictEqual(total.cells[6], 0.75, 'le budget doit rester joint');
});

test('sbNom / sbHa — repli sur le libellé BEE ONE puis sur haByRef', () => {
  assert.strictEqual(sbNom('INCONNUE', SB_MAP), 'INCONNUE');
  assert.strictEqual(sbNom('', SB_MAP), '—');
  assert.strictEqual(sbHa('B4 ADELITA', SB_MAP, DATA.haByRef), 0);
  assert.strictEqual(sbHa('F2 ZUTANO', SB_MAP, DATA.haByRef), 3, 'repli haByRef');
  assert.strictEqual(sbHa('INCONNUE', SB_MAP, DATA.haByRef), 0);
});

// ============================================================================
// Superficie — 3 niveaux, alignés sur le navigateur (`window.sbParcelleHa`).
// C'est le « point ouvert » que la PR #251 laissait : sans le 2ᵉ niveau, une
// parcelle sans `ha` au référentiel SB mais connue de BEE ONE sortait à 0 côté
// serveur, et avec elle « / Ha » et les 4 colonnes de budget.
// ============================================================================

test('sbHa — 3ᵉ argument : la surface BEE ONE prend le relais du référentiel SB', () => {
  const sup = { 'B4 ADELITA': 4, 'S12 YAZMIN': 99 };
  assert.strictEqual(sbHa('B4 ADELITA', SB_MAP, DATA.haByRef, sup), 4, 'repli BEE ONE');
  // PRIORITÉ : le référentiel Smart Berry reste maître (2 ha, pas 99).
  assert.strictEqual(sbHa('S12 YAZMIN', SB_MAP, DATA.haByRef, sup), 2);
  // Jointure sur la clé normalisée, comme partout ailleurs.
  assert.strictEqual(sbHa(' b4 adelita ', SB_MAP, DATA.haByRef, sup), 4);
  // Inconnue des trois niveaux → 0, jamais une surface devinée.
  assert.strictEqual(sbHa('INCONNUE', SB_MAP, DATA.haByRef, sup), 0);
  // Valeur non exploitable → on ne la retient pas.
  assert.strictEqual(sbHa('B4 ADELITA', SB_MAP, DATA.haByRef, { 'B4 ADELITA': 0 }), 0);
});

test('classeur — supByLabel débloque « / Ha » ET les 4 colonnes de budget', () => {
  const wb = build({
    supByLabel: { 'B4 ADELITA': 4 },
    budgetsByLabel: { 'B4 ADELITA': { 'Taille': 5 } },
  });
  const ws = wb.sheets.filter((s) => s.name === 'BAHIA 4')[0];
  const total = ws.rows.filter((r) => r.kind === CEU.ROW_KIND.TOTAL_GENERAL)[0].cells;
  // 8 JH / 4 ha = 2 JH/ha ; budget 5 JH/ha × 4 ha = 20 JH → 40 % consommé.
  assert.deepStrictEqual(total.slice(3), [8, 2, 5, 0.4, 3, 12]);
  // Sans la surface BEE ONE : superficie 0 → six cellules vides (l'état d'avant).
  const sans = build({ budgetsByLabel: { 'B4 ADELITA': { 'Taille': 5 } } });
  const totalSans = sans.sheets.filter((s) => s.name === 'BAHIA 4')[0]
    .rows.filter((r) => r.kind === CEU.ROW_KIND.TOTAL_GENERAL)[0].cells;
  assert.deepStrictEqual(totalSans.slice(3), [8, '', '', '', '', '']);
});

test('classeur — la Synthèse porte la même superficie que la feuille', () => {
  const wb = build({ supByLabel: { 'B4 ADELITA': 4 } });
  const ligne = wb.sheets[0].rows
    .filter((r) => r.kind === CEU.ROW_KIND.DATA)
    .filter((r) => r.cells[0] === 'BAHIA 4')[0];
  assert.strictEqual(ligne.cells[3], 4);
  assert.strictEqual(ligne.cells[5], 2, 'Total JH / Ha = 8 / 4');
});

test('cultureOf — repli heuristique quand le référentiel est muet', () => {
  assert.strictEqual(cultureOf('F2 ZUTANO', SB_MAP), 'Avocatier');
  assert.strictEqual(cultureOf('S3 CORINA', {}), 'Myrtille');
});

test('buildVarieteView — agrège par (famille, opération) et trie', () => {
  const view = buildVarieteView(DATA.rows, 'S12 YAZMIN');
  assert.deepStrictEqual(view.map((r) => r.operation), ['Cueillette', 'Désherbage']);
  assert.strictEqual(view[0].total.jh, 15);
  assert.strictEqual(view[0].byPeriode['Quinzaine 2'].jh, 15);
});

test('entrées vides — aucun throw, classeur minimal', () => {
  const wb = buildCultureWorkbook({ culture: 'Framboise', today: TODAY });
  assert.strictEqual(wb.sheets.length, 1);
  assert.strictEqual(wb.sheets[0].rows.length, 1); // en-tête seul
});
