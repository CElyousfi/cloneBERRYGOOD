'use strict';

// Tests de la grille de présentation public/components/PivotAnalytiqueGrid.jsx.
//
// L'iso-comportement du panneau Affectation Analytique est couvert ailleurs
// (tests/unit/affectationAnalytiqueTable.test.js, écrit AVANT l'extraction).
// CE fichier couvre ce que la grille sait faire EN PLUS, et qui n'a pas encore
// d'appelant : plusieurs séries par cellule, et le sens de conversion par série
// (`basis` = ce que vaut la valeur brute, `display` = ce qu'on affiche). C'est
// le point dur du chantier : le réalisé est un total par cellule, le budget est
// déjà en JH/Ha — la conversion s'inverse selon la série.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');

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

const Grid = (function () {
  const file = path.join(ROOT, 'public/components/PivotAnalytiqueGrid.jsx');
  const code = babel.transformSync(fs.readFileSync(file, 'utf8'), {
    presets: [require.resolve('@babel/preset-react')],
    filename: file, babelrc: false, configFile: false,
  }).code;
  const sandbox = { window: { React: { createElement: createElement, Fragment: 'Fragment' } } };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.window.PivotAnalytiqueGrid;
})();

// ---------------------------------------------------------------- helpers

function walk(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach(function (c) { walk(c, out); });
  return out;
}

function textOf(node) {
  return walk(node)
    .flatMap(function (n) {
      return (n.children || []).filter(function (c) { return typeof c === 'string' || typeof c === 'number'; });
    })
    .map(String)
    .join(' | ');
}

function section(tree, tag) { return walk(tree).filter(function (n) { return n.type === tag; })[0]; }
function bodyRows(tree) { return walk(section(tree, 'tbody')).filter(function (n) { return n.type === 'tr'; }); }
function footRow(tree) { return walk(section(tree, 'tfoot')).filter(function (n) { return n.type === 'tr'; })[0]; }
function cells(tr) { return (tr.children || []).filter(function (c) { return c && c.type === 'td'; }).map(textOf); }

// ---------------------------------------------------------------- données
//
// Deux parcelles, 2 Ha et 4 Ha. Une seule famille, dont le RÉALISÉ vaut 10 JH
// sur P2 et 20 JH sur P4 — soit 5 JH/Ha partout. Le BUDGET est saisi en JH/Ha :
// 6 sur P2 (= 12 JH) et 4 sur P4 (= 16 JH).

const PARCELLES = [['P2', 2], ['P4', 4]];
// Forme d'une cellule de buildAnalytiquePivotByFamille : { jh, cout, ha,
// detailRows }. `budget` est la série que le chantier y ajoutera.
const PIVOT = { P2: { jh: 10, cout: 300, ha: 2, budget: 6 },
  P4: { jh: 20, cout: 800, ha: 4, budget: 4 } };
const GROUPED = [
  { type: 'groupe', key: 'G', label: 'M.O HORS RÉCOLTE', pivot: PIVOT },
  { type: 'famille', key: 'GB09', label: 'Taille', pivot: PIVOT },
];

const un = function (v) { return (Math.round(v * 10) / 10).toFixed(1); };
const signe = function (v) { return (v > 0 ? '+' : '') + un(v); };

/** Les 3 séries visées par le chantier, en affichage `display`. */
function troisSeries(display) {
  return [
    { key: 'jh', label: 'Réalisé', unit: display === 'perHa' ? 'JH/Ha' : 'JH',
      basis: 'total', display: display, format: un,
      summary: function (t) { return Math.round(t) + ' JH total'; } },
    { key: 'budget', label: 'Budget', unit: display === 'perHa' ? 'JH/Ha' : 'JH',
      basis: 'perHa', display: display, format: un },
    { label: 'Écart', unit: display === 'perHa' ? 'JH/Ha' : 'JH',
      get: function (c) { return (c.jh || 0) - (c.budget || 0) * (c.ha || 0); },
      basis: 'total', display: display, format: signe },
  ];
}

function render(metrics, overrides) {
  return Grid(Object.assign({
    parcelles: PARCELLES, groupedRows: GROUPED, metrics: metrics,
    color: '#8B2252', title: 'Framboise', icon: 'fa-seedling',
  }, overrides || {}));
}

// ------------------------------------------------------------------ tests

test('metrics — une série `basis: perHa` est affichée telle quelle en mode par Ha', () => {
  const tree = render([{ key: 'budget', unit: 'JH/Ha', basis: 'perHa', display: 'perHa', format: un }]);
  // Aucune division : 6 et 4 sont DÉJÀ des JH/Ha.
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1),
    ['6.0 | JH/Ha', '4.0 | JH/Ha', '4.7 | JH/Ha']);
  // Le total de ligne, lui, repasse par les totaux : (6×2 + 4×4) / 6 Ha = 4.67.
});

test('metrics — la même série en mode Total est MULTIPLIÉE par le Ha', () => {
  const tree = render([{ key: 'budget', unit: 'JH', basis: 'perHa', display: 'total', format: un }]);
  // 6 JH/Ha × 2 Ha = 12 ; 4 × 4 = 16 ; total 28.
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1), ['12.0 | JH', '16.0 | JH', '28.0 | JH']);
  assert.deepStrictEqual(cells(footRow(tree)), ['TOTAL', '12.0 | JH', '16.0 | JH', '28.0 | JH']);
});

test('metrics — le sens de la conversion est PAR SÉRIE, pas global', () => {
  // Le cœur du lot : dans le MÊME rendu, le réalisé est divisé par le Ha et le
  // budget ne l'est pas. Un `_fmt` global ne peut pas exprimer ça.
  const tree = render([
    { key: 'jh', label: 'Réalisé', unit: 'JH/Ha', basis: 'total', display: 'perHa', format: un },
    { key: 'budget', label: 'Budget', unit: 'JH/Ha', basis: 'perHa', display: 'perHa', format: un },
  ]);
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1, 3), [
    '5.0 | Réalisé JH/Ha | 6.0 | Budget JH/Ha',   // 10 JH / 2 Ha, budget brut
    '5.0 | Réalisé JH/Ha | 4.0 | Budget JH/Ha',   // 20 JH / 4 Ha, budget brut
  ]);
});

test('metrics — trois séries réalisé / budget / écart dans une seule cellule', () => {
  const tree = render(troisSeries('perHa'));
  // P2 : réalisé 5.0, budget 6.0, écart (10 − 6×2) / 2 = −1.0 (sous-consommé).
  // P4 : réalisé 5.0, budget 4.0, écart (20 − 4×4) / 4 = +1.0 (dépassement).
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1, 3), [
    '5.0 | Réalisé JH/Ha | 6.0 | Budget JH/Ha | -1.0 | Écart JH/Ha',
    '5.0 | Réalisé JH/Ha | 4.0 | Budget JH/Ha | +1.0 | Écart JH/Ha',
  ]);
  // Total de ligne : réalisé 30/6 = 5.0 ; budget (12+16)/6 = 4.67 ; écart 2/6 = 0.3.
  assert.strictEqual(cells(bodyRows(tree)[1])[3],
    '5.0 | Réalisé JH/Ha | 4.7 | Budget JH/Ha | +0.3 | Écart JH/Ha');
});

test('metrics — en mode Total les trois séries suivent, sans règle codée en dur', () => {
  const tree = render(troisSeries('total'));
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1, 3), [
    '10.0 | Réalisé JH | 12.0 | Budget JH | -2.0 | Écart JH',
    '20.0 | Réalisé JH | 16.0 | Budget JH | +4.0 | Écart JH',
  ]);
  assert.deepStrictEqual(cells(footRow(tree)),
    ['TOTAL', '10.0 | Réalisé JH | 12.0 | Budget JH | -2.0 | Écart JH',
      '20.0 | Réalisé JH | 16.0 | Budget JH | +4.0 | Écart JH',
      '30.0 | Réalisé JH | 28.0 | Budget JH | +2.0 | Écart JH']);
});

test('metrics — le nom de la série n\'apparaît QUE s\'il y en a plusieurs', () => {
  // Sinon le balisage historique du panneau quinzaine (une seule série)
  // divergerait — c'est ce qui interdit d'afficher le label systématiquement.
  const seule = render([{ key: 'jh', label: 'Réalisé', unit: 'JH/Ha', basis: 'total',
    display: 'perHa', format: un }]);
  assert.strictEqual(cells(bodyRows(seule)[1])[1], '5.0 | JH/Ha');
});

test('metrics — Ha inconnu : « — » quand la conversion en dépend, valeur sinon', () => {
  const parcelles = [['P0', 0]];
  const grouped = [{ type: 'famille', key: 'GB09', label: 'Taille',
    pivot: { P0: { jh: 7, budget: 3 } } }];

  // Réalisé (total) affiché par Ha → indéterminable. Budget (déjà par Ha)
  // affiché par Ha → parfaitement lisible, le Ha n'entre pas dans le calcul.
  const parHa = render([
    { key: 'jh', label: 'Réalisé', unit: 'JH/Ha', basis: 'total', display: 'perHa', format: un },
    { key: 'budget', label: 'Budget', unit: 'JH/Ha', basis: 'perHa', display: 'perHa', format: un },
  ], { parcelles: parcelles, groupedRows: grouped });
  assert.strictEqual(cells(bodyRows(parHa)[0])[1], '— | Réalisé JH/Ha | 3.0 | Budget JH/Ha');

  // En Total, c'est l'inverse : le réalisé est brut, le budget n'est pas
  // convertible sans le Ha.
  const total = render([
    { key: 'jh', label: 'Réalisé', unit: 'JH', basis: 'total', display: 'total', format: un },
    { key: 'budget', label: 'Budget', unit: 'JH', basis: 'perHa', display: 'total', format: un },
  ], { parcelles: parcelles, groupedRows: grouped });
  assert.strictEqual(cells(bodyRows(total)[0])[1], '7.0 | Réalisé JH | — | Budget JH');
});

test('metrics — valeur ABSENTE : « — », jamais 0 (cas nominal « pas de budget »)', () => {
  // Le cœur du LOT 2c : la plupart des parcelles n'ont AUCUN budget saisi. Un 0
  // affiché à côté du réalisé se lirait « budget nul », donc dépassement total ;
  // et un écart à 0 se lirait « pile dans le budget ». Les deux sont faux.
  const parcelles = [['P2', 2], ['P4', 4]];
  const grouped = [{ type: 'famille', key: 'GB09', label: 'Taille',
    // P4 est travaillée mais PAS budgétée : pas de champ `budget`.
    pivot: { P2: { jh: 10, ha: 2, budget: 6 }, P4: { jh: 20, ha: 4 } } }];
  const ecart = function (c) {
    return c.budget > 0 && c.ha > 0 ? (c.jh || 0) - c.budget * c.ha : null;
  };
  const tree = render([
    { key: 'jh', label: 'Réalisé', unit: 'JH/Ha', basis: 'total', display: 'perHa', format: un },
    { key: 'budget', label: 'Budget', unit: 'JH/Ha', basis: 'perHa', display: 'perHa', format: un },
    { label: 'Écart', unit: 'JH/Ha', get: ecart, basis: 'total', display: 'perHa', format: signe },
  ], { parcelles: parcelles, groupedRows: grouped });
  assert.deepStrictEqual(cells(bodyRows(tree)[0]).slice(1, 3), [
    '5.0 | Réalisé JH/Ha | 6.0 | Budget JH/Ha | -1.0 | Écart JH/Ha',
    '5.0 | Réalisé JH/Ha | — | Budget JH/Ha | — | Écart JH/Ha',
  ]);
  // Une valeur absente ne pèse rien dans les agrégats : le budget total est
  // celui du PÉRIMÈTRE BUDGÉTÉ (12 JH / 6 Ha = 2.0), et l'écart aussi
  // (−2 JH / 6 Ha = −0.3). Le réalisé, lui, reste complet (30 JH / 6 Ha).
  assert.strictEqual(cells(bodyRows(tree)[0])[3],
    '5.0 | Réalisé JH/Ha | 2.0 | Budget JH/Ha | -0.3 | Écart JH/Ha');
});

test('metrics — une valeur non finie est indéterminable, jamais affichée', () => {
  // Filet anti-NaN/∞ : une division par un Ha nul en amont ne doit pas remonter
  // « NaN » ni « Infinity » dans une cellule.
  const grouped = [{ type: 'famille', key: 'GB09', label: 'Taille',
    pivot: { P2: { jh: 10, ha: 2 } } }];
  const tree = render([
    { label: 'Bancal', unit: 'JH', get: function () { return 0 / 0; },
      basis: 'total', display: 'total', format: un },
    { label: 'Infini', unit: 'JH', get: function () { return 1 / 0; },
      basis: 'total', display: 'total', format: un },
  ], { parcelles: [['P2', 2]], groupedRows: grouped });
  assert.strictEqual(cells(bodyRows(tree)[0])[1], '— | Bancal JH | — | Infini JH');
  assert.strictEqual(cells(bodyRows(tree)[0])[2], '0.0 | Bancal JH | 0.0 | Infini JH');
});

test('metrics — le bandeau de groupe ne résume que la PREMIÈRE série', () => {
  const tree = render(troisSeries('perHa'));
  // Le total brut du groupe (30 JH), pas le budget ni l'écart.
  assert.ok(textOf(bodyRows(tree)[0]).includes('30 JH total'));
  // Une série sans `summary` n'écrit rien.
  const muet = render([{ key: 'budget', unit: 'JH/Ha', basis: 'perHa', display: 'perHa', format: un }]);
  assert.strictEqual(textOf(bodyRows(muet)[0]), 'M.O HORS RÉCOLTE');
});

test('grille — cellules non cliquables sans onCellClick, cliquables avec', () => {
  const inerte = render(troisSeries('perHa'));
  const td = (bodyRows(inerte)[1].children || []).filter(function (c) { return c.type === 'td'; })[1];
  assert.strictEqual(td.props.onClick, undefined);
  assert.strictEqual(td.props.style.cursor, undefined);

  const vus = [];
  const actif = render(troisSeries('perHa'), { onCellClick: function (c) { vus.push(c); } });
  const clic = (bodyRows(actif)[1].children || []).filter(function (c) { return c.type === 'td'; })[1];
  clic.props.onClick();
  assert.strictEqual(vus.length, 1);
  // deepStrictEqual est inutilisable : l'objet naît dans le sandbox vm, son
  // prototype n'est pas celui du realm de test.
  assert.strictEqual(vus[0].parcelle, 'P2');
  assert.strictEqual(vus[0].operationFamille, 'Taille');
  assert.strictEqual(vus[0].ha, 2);
});

test('grille — libellé de parcelle et de première colonne paramétrables', () => {
  const tree = render(troisSeries('perHa'), {
    parcelleLabel: function (k) { return 'Parcelle ' + k; },
    firstColumnLabel: 'Poste',
  });
  const ths = walk(section(tree, 'thead')).filter(function (n) { return n.type === 'th'; });
  assert.deepStrictEqual(ths.map(textOf),
    ['Poste', 'Parcelle P2 | 2 Ha', 'Parcelle P4 | 4 Ha', 'Total']);
});

test('grille — sans metrics, la série `jh` par défaut évite un rendu vide', () => {
  const tree = render(undefined);
  assert.ok(cells(bodyRows(tree)[1])[1].indexOf('10') === 0);
});
