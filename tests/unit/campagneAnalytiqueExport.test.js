'use strict';

// Jointure BUDGETS ↔ EXPORT de l'écran Campagne analytique.
//
// Les calculs vivent dans les helpers purs (campagneExportUtils, testés à part).
// Ce fichier couvre le seul point où le composant peut se tromper en silence :
// la CLÉ de jointure entre les budgets saisis (label BEE ONE) et les parcelles
// de l'export. Une normalisation divergente ne lève aucune erreur — elle vide
// simplement les colonnes de budget.
//
// Le composant est un IIFE chargé dans un faux `window` (vm), même technique
// que tests/unit/campagneBudgetTab.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * Ramène une valeur produite DANS le sandbox vm vers le realm des tests :
 * sans ça, deepStrictEqual échoue sur l'identité des prototypes (Array/Object
 * du vm ≠ ceux du test) alors que les structures sont identiques.
 */
function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');
}

/**
 * Charge le composant dans un faux `window`.
 *
 * `withBudgetRules` reproduit la présence (ou non) des <script> qui portent la
 * règle métier du budget et le référentiel analytique : sans eux, l'export doit
 * dégrader vers le seul niveau famille — jamais planter, jamais deviner.
 */
function loadTab(withBudgetRules) {
  const sandbox = { window: {}, console, document: undefined };
  sandbox.window.React = {
    createElement: function () { return null; },
    useState: function (v) { return [v, function () {}]; },
    useEffect: function () {},
    useMemo: function (fn) { return fn(); },
  };
  vm.createContext(sandbox);
  // Dépendances UMD réelles (pas de stub) : la normalisation de clé testée ici
  // est précisément celle qu'elles imposent.
  vm.runInContext(read('public/lib/cultureUtils.js'), sandbox);
  vm.runInContext(read('public/lib/campagneExportUtils.js'), sandbox);
  if (withBudgetRules) {
    vm.runInContext(read('public/lib/analytiqueUtils.js'), sandbox);
    const file = path.join(__dirname, '../..', 'public/components/CampagneBudgetTab.jsx');
    vm.runInContext(require('@babel/core').transformSync(fs.readFileSync(file, 'utf8'), {
      presets: [require.resolve('@babel/preset-react')],
      filename: file, babelrc: false, configFile: false,
    }).code, sandbox);
  }
  vm.runInContext(read('public/components/CampagneAnalytiqueTab.jsx'), sandbox);
  return sandbox.window.CampagneAnalytiqueTab;
}

const Tab = loadTab();
/** Le même composant, avec la règle métier du budget chargée (comme en prod). */
const TabRules = loadTab(true);

/** Jeu de données minimal : une parcelle Framboise, 2 ha, 30 JH de Taille. */
const DATA = {
  campagne: '2026-2027',
  periodes: ['Q01'],
  famillesOrdered: ['Taille'],
  haByRef: { 'F1- S5 MARAVILLA': 2 },
  rows: [{
    parcelle: 'F1- S5 MARAVILLA',
    refParcelle: 'F1- S5 MARAVILLA',
    ferme: 'F1',
    famille: 'Taille',
    operation: 'Taille longue',
    periode: 'Q01',
    jh: 30,
    cout: 4500,
  }],
};

const SB_MAP = { 'F1- S5 MARAVILLA': { culture_sb: 'Framboise', nom_sb: 'S5 MARAVILLA', ha: 2 } };

/** Les 4 dernières cellules (colonnes budgétaires) de la ligne TOTAL_FAMILLE. */
function famBudgetCells(wb) {
  const sheet = wb.sheets[1]; // 0 = Synthèse, 1 = la parcelle
  const row = sheet.rows.filter((r) => r.kind === 'total-famille')[0];
  return plain(row.cells.slice(-4));
}

test('budgetsByLabel — clé trim + MAJUSCULES, entrées sans label ignorées', () => {
  const map = plain(Tab.budgetsByLabel([
    { label_bee_one: '  f1- s5 maravilla  ', budgets: { Taille: 15 } },
    { label_bee_one: '', budgets: { Taille: 99 } },
    { budgets: { Taille: 99 } },
    { label_bee_one: 'F5- S1 CORINA' },
  ]));
  assert.deepStrictEqual(Object.keys(map).sort(), ['F1- S5 MARAVILLA', 'F5- S1 CORINA']);
  assert.deepStrictEqual(map['F1- S5 MARAVILLA'], { Taille: 15 });
  assert.deepStrictEqual(map['F5- S1 CORINA'], {}, 'budgets absents → objet vide');
});

test('budgetsByLabel — liste vide / absente → map vide, aucun throw', () => {
  assert.deepStrictEqual(plain(Tab.budgetsByLabel([])), {});
  assert.deepStrictEqual(plain(Tab.budgetsByLabel(null)), {});
  assert.deepStrictEqual(plain(Tab.budgetsByLabel(undefined)), {});
});

test('buildCultureWorkbook — le budget de la parcelle atteint la feuille', () => {
  const budgets = Tab.budgetsByLabel([
    { label_bee_one: 'F1- S5 MARAVILLA', budgets: { Taille: 20 } },
  ]);
  const wb = Tab.buildCultureWorkbook('Framboise', DATA, null, SB_MAP, budgets);
  // 20 JH/ha × 2 ha = 40 JH budgétés, 30 réalisés → 75 %, 5 JH/ha, 10 JH
  assert.deepStrictEqual(famBudgetCells(wb), [20, 0.75, 5, 10]);
  // …et la ligne de la parcelle dans la Synthèse porte les mêmes valeurs
  const dataRow = wb.sheets[0].rows.filter((r) => r.kind === 'data')[0];
  assert.deepStrictEqual(plain(dataRow.cells.slice(-4)), [20, 0.75, 5, 10]);
});

test('buildCultureWorkbook — jointure insensible à la casse et aux espaces', () => {
  const budgets = Tab.budgetsByLabel([
    { label_bee_one: ' f1- s5 maravilla ', budgets: { Taille: 20 } },
  ]);
  const wb = Tab.buildCultureWorkbook('Framboise', DATA, null, SB_MAP, budgets);
  assert.deepStrictEqual(famBudgetCells(wb), [20, 0.75, 5, 10]);
});

test('buildCultureWorkbook — aucun budget chargé → colonnes vides (cas nominal)', () => {
  [undefined, {}, { 'AUTRE PARCELLE': { Taille: 20 } }].forEach((budgets) => {
    const wb = Tab.buildCultureWorkbook('Framboise', DATA, null, SB_MAP, budgets);
    assert.deepStrictEqual(famBudgetCells(wb), ['', '', '', ''], JSON.stringify(budgets));
  });
});

test('buildCultureWorkbook — largeurs de colonnes alignées sur l\'en-tête', () => {
  const wb = Tab.buildCultureWorkbook('Framboise', DATA, null, SB_MAP, {});
  wb.sheets.forEach((s) => {
    const header = s.rows.filter((r) => r.kind === 'col-header')[0];
    assert.strictEqual(s.cols.length, header.cells.length, s.name);
  });
});

// Régression QA LOT 2 : la Synthèse ne peut comparer à périmètre égal que si le
// composant lui fournit les JH PAR FAMILLE. Ce test verrouille ce câblage —
// sans lui, un `jhByFamille` oublié repasserait en dépassement fantôme sans
// qu'aucun test de helper pur ne bronche.
const DATA_2_FAMILLES = Object.assign({}, DATA, {
  famillesOrdered: ['Travaux du sol', 'Taille'],
  rows: [
    Object.assign({}, DATA.rows[0], { famille: 'Travaux du sol', operation: 'Grattage', jh: 30 }),
    Object.assign({}, DATA.rows[0], { jh: 15 }),   // Taille, 15 JH
  ],
});

test('buildCultureWorkbook — JH d\'une famille NON budgétée hors du % consommé', () => {
  const budgets = Tab.budgetsByLabel([
    { label_bee_one: 'F1- S5 MARAVILLA', budgets: { Taille: 10 } },  // Travaux du sol : rien
  ]);
  const wb = Tab.buildCultureWorkbook('Framboise', DATA_2_FAMILLES, null, SB_MAP, budgets);
  // Taille : 10 JH/ha × 2 ha = 20 JH budgétés, 15 réalisés → 75 %
  const dataRow = wb.sheets[0].rows.filter((r) => r.kind === 'data')[0];
  assert.deepStrictEqual(plain(dataRow.cells.slice(-4)), [10, 0.75, 2.5, 5]);
  assert.strictEqual(dataRow.cells[4], 45, 'le volume de JH reste complet');
  // …identique sur la feuille parcelle, et surtout pas 45/20 = 225 %
  const tot = wb.sheets[1].rows.filter((r) => r.kind === 'total-general')[0];
  assert.deepStrictEqual(plain(tot.cells.slice(-4)), [10, 0.75, 2.5, 5]);
});

// ============================================================================
// Budget à la maille OPÉRATION (`budgets_operations`)
// ============================================================================
//
// Même jeu de données, mais les lignes portent leur code BEE ONE : c'est lui
// qui fait le pont entre le budget (keyé par nom de famille du référentiel) et
// les lignes de l'export (famille BEE ONE résolue).

const DATA_CODE = Object.assign({}, DATA, {
  rows: [Object.assign({}, DATA.rows[0], { code: 'GB09' })],
});

test('opBudgetsByLabel — clé trim + MAJUSCULES, champ absent → map vide', () => {
  const map = plain(Tab.opBudgetsByLabel([
    { label_bee_one: '  f1- s5 maravilla  ', budgets_operations: { Taille: { 'GB09::Taille longue': 15 } } },
    { label_bee_one: 'F5- S1 CORINA' },   // document antérieur : pas de champ
    { budgets_operations: { Taille: {} } },
  ]));
  assert.deepStrictEqual(Object.keys(map).sort(), ['F1- S5 MARAVILLA', 'F5- S1 CORINA']);
  assert.deepStrictEqual(map['F1- S5 MARAVILLA'], { Taille: { 'GB09::Taille longue': 15 } });
  assert.deepStrictEqual(map['F5- S1 CORINA'], {}, 'aucune migration nécessaire');
});

test('buildCultureWorkbook — budget d\'opération : ligne OPERATION, Total famille et Synthèse', () => {
  const opBudgets = TabRules.opBudgetsByLabel([
    { label_bee_one: 'F1- S5 MARAVILLA', budgets_operations: { Taille: { 'GB09::Taille longue': 20 } } },
  ]);
  const wb = TabRules.buildCultureWorkbook('Framboise', DATA_CODE, null, SB_MAP, {}, opBudgets);
  // 20 JH/ha × 2 ha = 40 JH budgétés, 30 réalisés → 75 %, 5 JH/ha, 10 JH.
  const op = wb.sheets[1].rows.filter((r) => r.kind === 'operation')[0];
  assert.deepStrictEqual(plain(op.cells.slice(-4)), [20, 0.75, 5, 10]);
  // La famille n'a AUCUNE valeur de niveau famille : c'est le cas qui sortait
  // vide avant ce lot.
  assert.deepStrictEqual(famBudgetCells(wb), [20, 0.75, 5, 10]);
  const tot = wb.sheets[1].rows.filter((r) => r.kind === 'total-general')[0];
  assert.deepStrictEqual(plain(tot.cells.slice(-4)), [20, 0.75, 5, 10]);
  // …et la Synthèse porte EXACTEMENT les mêmes chiffres (budget effectif, pas
  // la saisie brute).
  const dataRow = wb.sheets[0].rows.filter((r) => r.kind === 'data')[0];
  assert.deepStrictEqual(plain(dataRow.cells.slice(-4)), [20, 0.75, 5, 10]);
});

test('buildCultureWorkbook — famille ET opération : l\'opération l\'emporte, jamais la somme', () => {
  const budgets = TabRules.budgetsByLabel([
    { label_bee_one: 'F1- S5 MARAVILLA', budgets: { Taille: 50 } },
  ]);
  const opBudgets = TabRules.opBudgetsByLabel([
    { label_bee_one: 'F1- S5 MARAVILLA', budgets_operations: { Taille: { 'GB09::Taille longue': 20 } } },
  ]);
  const wb = TabRules.buildCultureWorkbook('Framboise', DATA_CODE, null, SB_MAP, budgets, opBudgets);
  assert.deepStrictEqual(famBudgetCells(wb), [20, 0.75, 5, 10], 'ni 50, ni 70');
});

test('buildCultureWorkbook — modules du budget absents : dégradation, pas de crash', () => {
  const opBudgets = Tab.opBudgetsByLabel([
    { label_bee_one: 'F1- S5 MARAVILLA', budgets_operations: { Taille: { 'GB09::Taille longue': 20 } } },
  ]);
  const wb = Tab.buildCultureWorkbook('Framboise', DATA_CODE, null, SB_MAP, {}, opBudgets);
  // Sans la règle métier injectée, le détail par opération n'est pas exploité :
  // colonnes vides, exactement comme avant ce lot — jamais un budget deviné.
  assert.deepStrictEqual(famBudgetCells(wb), ['', '', '', '']);
  const op = wb.sheets[1].rows.filter((r) => r.kind === 'operation')[0];
  assert.deepStrictEqual(plain(op.cells.slice(-4)), ['', '', '', '']);
});

test('buildCultureWorkbook — mention de périmètre présente sur les deux feuilles', () => {
  const budgets = Tab.budgetsByLabel([
    { label_bee_one: 'F1- S5 MARAVILLA', budgets: { Taille: 10 } },
  ]);
  const wb = Tab.buildCultureWorkbook('Framboise', DATA_2_FAMILLES, null, SB_MAP, budgets);
  const synthNote = wb.sheets[0].rows.filter((r) => r.kind === 'note')[0];
  assert.ok(synthNote.cells[0].indexOf('parcelles budgétées à superficie connue (1/1)') !== -1,
    synthNote.cells[0]);
  const parcNote = wb.sheets[1].rows.filter((r) => r.kind === 'note')[0];
  assert.ok(parcNote.cells[0].indexOf('familles budgétées (1/2)') !== -1, parcNote.cells[0]);
});
