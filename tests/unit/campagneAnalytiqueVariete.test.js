'use strict';

// Grille écran de la vue « Par Variété / Quinzaine » (VarieteView) — les 5
// colonnes de droite : « Total JH / Ha » + les 4 du suivi budgétaire.
//
// Ce que ce fichier protège :
//   1. l'INVARIANT « grille écran == feuille Excel » : les deux rendus partent
//      des MÊMES helpers purs (CEU.budgetCells / CEU.perHa / l'index budget) et
//      doivent afficher les mêmes chiffres — c'est toute la raison d'être du
//      lot, deux implémentations divergeraient au premier changement de règle ;
//   2. le mode « Coût DH » : le budget n'existe qu'en JH/Ha, les 5 colonnes ne
//      sont PAS rendues (et le colSpan des en-têtes de famille suit) ;
//   3. la règle cardinale : pas de budget ou pas de superficie → « — », jamais
//      0, jamais 100 %, jamais NaN.
//
// Le composant est chargé dans un faux `window` (vm) avec un React minimal :
// createElement rend un arbre inspectable sans react-dom (même technique que
// tests/unit/campagneAnalytiquePivot.test.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const { loadEsm } = require('./_esm');

const ROOT = path.join(__dirname, '../..');

// ------------------------------------------------------------- faux React

function flatten(children) {
  const out = [];
  const push = (c) => {
    if (Array.isArray(c)) c.forEach(push);
    else if (c != null && c !== false) out.push(c);
  };
  children.forEach(push);
  return out;
}

function createElement(type, props, ...children) {
  const flat = flatten(children);
  const p = Object.assign({}, props || {});
  if (typeof type === 'function') {
    if (flat.length) p.children = flat.length === 1 ? flat[0] : flat;
    return type(p);
  }
  return { type, key: p.key, props: p, children: flat };
}

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function transform(rel) {
  const file = path.join(ROOT, rel);
  return babel.transformSync(fs.readFileSync(file, 'utf8'), {
    presets: [require.resolve('@babel/preset-react')],
    filename: file, babelrc: false, configFile: false,
  }).code;
}

/**
 * Charge le composant. `withRules` = présence des <script> qui portent la règle
 * métier du budget et le référentiel analytique ; sans eux la grille doit
 * dégrader (aucun budget d'opération), jamais planter.
 */
function loadTab(withRules) {
  const sandbox = { window: {}, console, document: undefined };
  sandbox.window.React = {
    createElement,
    Fragment: 'Fragment',
    useState: function (v) { return [v, function () {}]; },
    useEffect: function () {},
    useMemo: function (fn) { return fn(); },
  };
  vm.createContext(sandbox);
  sandbox.window.CultureUtils = loadEsm('src/modules/shared/lib/cultureUtils.js', { sandbox: sandbox });
  sandbox.window.AnalytiqueUtils = loadEsm('src/modules/shared/lib/analytiqueUtils.js', { sandbox: sandbox });
  sandbox.window.CampagneExportUtils = loadEsm('src/modules/shared/lib/campagneExportUtils.js', { sandbox: sandbox });
  if (withRules !== false) {
    vm.runInContext(transform('public/components/CampagneBudgetTab.jsx'), sandbox);
  }
  vm.runInContext(transform('public/components/PivotAnalytiqueGrid.jsx'), sandbox);
  vm.runInContext(read('public/components/CampagneAnalytiqueTab.jsx'), sandbox);
  return sandbox.window.CampagneAnalytiqueTab;
}

const Tab = loadTab();

// -------------------------------------------------------------- fixtures
//
// Une parcelle de 2 ha : Taille 30 JH (2 opérations, GB09), Récolte 15 JH
// (GB08, NON budgétée). Budget saisi à la seule maille OPÉRATION — le cas qui
// sortait vide avant ce lot.

const PARCELLE = 'F1- S5 MARAVILLA';
const SB_MAP = { 'F1- S5 MARAVILLA': { culture_sb: 'Framboise', nom_sb: 'S5 MARAVILLA', ha: 2 } };

const DATA = {
  campagne: '2026-2027',
  periodes: ['Q01', 'Q02'],
  famillesOrdered: ['Taille', 'Récolte'],
  haByRef: {},
  rows: [
    { parcelle: PARCELLE, refParcelle: PARCELLE, ferme: 'F1', periode: 'Q01',
      famille: 'Taille', code: 'GB09', operation: 'Taille longue', jh: 20, cout: 3000 },
    { parcelle: PARCELLE, refParcelle: PARCELLE, ferme: 'F1', periode: 'Q02',
      famille: 'Taille', code: 'GB09', operation: 'Taille courte', jh: 10, cout: 1500 },
    { parcelle: PARCELLE, refParcelle: PARCELLE, ferme: 'F1', periode: 'Q01',
      famille: 'Récolte', code: 'GB08', operation: 'Cueillette', jh: 15, cout: 2250 },
  ],
};

const OP_BUDGETS = {
  'F1- S5 MARAVILLA': { Taille: { 'GB09::Taille longue': 12, 'GB09::Taille courte': 3 } },
};

// -------------------------------------------------------------- utilitaires

function walk(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach(function (c) { walk(c, out); });
  return out;
}

function textOf(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return walk(node)
    .flatMap((n) => (n.children || []).filter((c) => typeof c === 'string' || typeof c === 'number'))
    .map(String)
    .join(' | ');
}

function section(tree, tag) { return walk(tree).filter((n) => n.type === tag)[0]; }
function headers(tree) { return walk(section(tree, 'thead')).filter((n) => n.type === 'th').map(textOf); }
function bodyRows(tree) { return walk(section(tree, 'tbody')).filter((n) => n.type === 'tr'); }
function cells(tr) { return (tr.children || []).filter((c) => c && c.type === 'td').map(textOf); }
/** Ligne dont la première cellule porte ce libellé. */
function rowLabelled(tree, label) {
  return bodyRows(tree).filter((tr) => cells(tr)[0] === label)[0];
}

function render(props, TabRef) {
  return (TabRef || Tab).VarieteView(Object.assign({
    data: DATA,
    sbMap: SB_MAP,
    budgetsByLabel: {},
    opBudgetsByLabel: OP_BUDGETS,
    selectedParcelle: PARCELLE,
    setSelectedParcelle: function () {},
    metric: 'jh',
    setMetric: function () {},
  }, props || {}));
}

/**
 * Ramène une valeur produite DANS le sandbox vm vers le realm des tests :
 * sans ça, deepStrictEqual échoue sur l'identité des prototypes.
 */
function plain(v) { return JSON.parse(JSON.stringify(v)); }

/**
 * Les 4 cellules budgétaires d'une ligne de la FEUILLE EXCEL, pour la même
 * parcelle et les mêmes budgets — le témoin de l'invariant.
 * `label` = libellé de la colonne A (les opérations sont triées par libellé,
 * comme à l'écran : les deux vues partagent buildVarieteView).
 */
function exportBudgetCells(label, TabRef) {
  const wb = (TabRef || Tab).buildCultureWorkbook(
    'Framboise', DATA, null, SB_MAP, {}, OP_BUDGETS
  );
  const row = wb.sheets[1].rows.filter((r) => r.cells[0] === label)[0];
  return plain(row.cells.slice(-4));
}

// ------------------------------------------------------------------ tests

test('grille — les 5 colonnes de droite sont rendues en mode JH', () => {
  assert.deepStrictEqual(headers(render()), [
    'Famille / Opération', 'Q01', 'Q02', 'Total',
    'Total JH / Ha', 'Budget par Ha', '% Consommé', 'JH par Ha restant', 'Total JH Restant',
  ]);
});

test('grille — mode « Coût DH » : aucune colonne budgétaire (le budget est en JH/Ha)', () => {
  const tree = render({ metric: 'cout' });
  assert.deepStrictEqual(headers(tree), ['Famille / Opération', 'Q01', 'Q02', 'Total']);
  bodyRows(tree).forEach((tr) => {
    const n = cells(tr).length;
    assert.ok(n <= 4, 'ligne à ' + n + ' cellules : ' + cells(tr)[0]);
  });
});

test('grille — colSpan de l\'en-tête de famille = nombre réel de colonnes', () => {
  const famHeader = (tree) => bodyRows(tree)
    .map((tr) => (tr.children || []).filter((c) => c && c.props && c.props.colSpan)[0])
    .filter(Boolean)[0];
  // 1 libellé + 2 quinzaines + 1 Total + 5 colonnes de droite
  assert.strictEqual(famHeader(render()).props.colSpan, 9);
  assert.strictEqual(famHeader(render({ metric: 'cout' })).props.colSpan, 4);
});

test('grille — ligne OPERATION budgétée : mêmes chiffres que la feuille Excel', () => {
  const tree = render();
  // 12 JH/ha × 2 ha = 24 JH budgétés, 20 réalisés → 83,3 %, 2 JH/ha, 4 JH.
  assert.deepStrictEqual(cells(rowLabelled(tree, 'Taille longue')).slice(-5),
    ['10', '12', '83,3 %', '2', '4']);
  // INVARIANT : la feuille Excel porte le même budget, le même ratio et les
  // mêmes restes (au format brut, non localisé).
  assert.deepStrictEqual(exportBudgetCells('Taille longue'), [12, 0.8333, 2, 4]);
});

test('grille — dépassement > 100 % affiché tel quel (restes négatifs)', () => {
  // Taille courte : 3 JH/ha × 2 ha = 6 JH budgétés, 10 réalisés → 166,7 %.
  assert.deepStrictEqual(cells(rowLabelled(render(), 'Taille courte')).slice(-5),
    ['5', '3', '166,7 %', '-2', '-4']);
});

test('grille — opération d\'une famille NON budgétée : « — », jamais 0 ni 100 %', () => {
  const cueillette = cells(rowLabelled(render(), 'Cueillette')).slice(-5);
  // Le JH/Ha reste calculable (15 JH / 2 ha), les 4 colonnes budget non.
  assert.deepStrictEqual(cueillette, ['7,5', '—', '—', '—', '—']);
  assert.deepStrictEqual(exportBudgetCells('Cueillette'), ['', '', '', '']);
});

test('grille — Total famille : budget effectif (Σ des opérations), idem Excel', () => {
  const tree = render();
  // 12 + 3 = 15 JH/ha × 2 ha = 30 JH budgétés, 30 réalisés → 100 %.
  assert.deepStrictEqual(cells(rowLabelled(tree, 'Total Taille')).slice(-5),
    ['15', '15', '100 %', '0', '0']);
  assert.deepStrictEqual(cells(rowLabelled(tree, 'Total Récolte')).slice(-5),
    ['7,5', '—', '—', '—', '—']);
  assert.deepStrictEqual(exportBudgetCells('Total Taille'), [15, 1, 0, 0]);
  assert.deepStrictEqual(exportBudgetCells('Total Récolte'), ['', '', '', '']);
});

test('grille — TOTAL GÉNÉRAL à périmètre égal + mention de périmètre', () => {
  const tree = render();
  // Périmètre budgété = Taille seule : 30 JH budgétés, 30 réalisés → 100 %.
  // Le « Total JH / Ha », lui, reste exhaustif (45 JH / 2 ha = 22,5).
  assert.deepStrictEqual(cells(rowLabelled(tree, 'TOTAL GÉNÉRAL')).slice(-5),
    ['22,5', '15', '100 %', '0', '0']);
  assert.deepStrictEqual(exportBudgetCells('TOTAL GÉNÉRAL'), [15, 1, 0, 0]);
  // Même libellé de périmètre que sous le tableau Excel.
  const note = 'Colonnes budget : périmètre des familles budgétées (1/2). '
    + 'Les colonnes JH couvrent l\'ensemble.';
  assert.ok(walk(tree).some((n) => textOf(n) === note), 'mention de périmètre absente');
  const wb = Tab.buildCultureWorkbook('Framboise', DATA, null, SB_MAP, {}, OP_BUDGETS);
  assert.strictEqual(wb.sheets[1].rows.filter((r) => r.kind === 'note')[0].cells[0], note);
});

test('grille — aucun budget chargé : colonnes présentes mais vides, aucun crash', () => {
  const tree = render({ opBudgetsByLabel: {}, budgetsByLabel: {} });
  assert.strictEqual(headers(tree).length, 9);
  assert.deepStrictEqual(cells(rowLabelled(tree, 'Taille longue')).slice(-4),
    ['—', '—', '—', '—']);
  assert.deepStrictEqual(cells(rowLabelled(tree, 'TOTAL GÉNÉRAL')).slice(-4),
    ['—', '—', '—', '—']);
});

test('grille — superficie inconnue : 4 colonnes vides (ni ∞ ni NaN)', () => {
  const tree = render({ sbMap: {} });   // ni sbMap ni haByRef → Ha = 0
  cells(rowLabelled(tree, 'Taille longue')).slice(-5).forEach((c) => {
    assert.strictEqual(c, '—');
  });
});

test('grille — règle métier absente : dégradation vers le seul niveau famille', () => {
  const TabSansRegle = loadTab(false);
  const tree = render({}, TabSansRegle);
  // Le détail par opération n'est pas exploité (pas de familleTotal injectable),
  // mais la grille rend ses colonnes et ne plante pas.
  assert.strictEqual(headers(tree).length, 9);
  assert.deepStrictEqual(cells(rowLabelled(tree, 'Taille longue')).slice(-4),
    ['—', '—', '—', '—']);
  // Le budget de NIVEAU famille, lui, reste lu comme avant ce lot.
  const avecFamille = render({
    opBudgetsByLabel: {}, budgetsByLabel: { 'F1- S5 MARAVILLA': { Taille: 20 } },
  }, TabSansRegle);
  assert.deepStrictEqual(cells(rowLabelled(avecFamille, 'Total Taille')).slice(-4),
    ['20', '75 %', '5', '10']);
});
