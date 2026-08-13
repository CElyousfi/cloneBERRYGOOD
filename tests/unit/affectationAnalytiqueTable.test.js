'use strict';

// Tests de RENDU du panneau « Affectation Analytique » (onglet Quinzaine).
//
// Écrits AVANT l'extraction de la grille dans PivotAnalytiqueGrid (LOT 2a) :
// ce sont eux, et eux seuls, qui prouvent que l'extraction est iso-comportement.
// Ils ne doivent PAS être modifiés par le refactor — s'ils changent, la preuve
// disparaît.
//
// Technique : même harnais que tests/unit/campagneBudgetTab.test.js (faux
// `window`, React stubé, pas de DOM ni de RTL — limitation documentée du repo),
// à deux différences près, imposées par le composant testé :
//   1. le fichier est en JSX → babélisé à la volée (@babel/preset-react), comme
//      le fait scripts/build-frontend.js ;
//   2. `createElement` fait un rendu PROFOND (il APPELLE les composants
//      fonction). Sans ça, une grille extraite dans un composant enfant ne
//      serait qu'un nœud opaque et les assertions sur les lignes deviendraient
//      aveugles au moment précis où elles doivent surveiller le refactor.
// La lib de pivot (public/lib/analytiqueUtils.js) est chargée POUR DE VRAI dans
// le sandbox : le pivot n'est pas stubé, les lignes testées sont celles de prod.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');

function readJsx(rel) {
  const file = path.join(ROOT, rel);
  return babel.transformSync(fs.readFileSync(file, 'utf8'), {
    presets: [require.resolve('@babel/preset-react')],
    filename: file,
    babelrc: false,
    configFile: false,
  }).code;
}

/** Aplatit récursivement les enfants, comme React. */
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
  // Rendu PROFOND des composants fonction (cf. en-tête). Un type non-fonction
  // (balise DOM, composant absent du sandbox comme QuinzaineCampagneSelect)
  // reste un nœud inspectable.
  if (typeof type === 'function') {
    if (flat.length) p.children = flat.length === 1 ? flat[0] : flat;
    return type(p);
  }
  return { type, key: p.key, props: p, children: flat };
}

/**
 * Charge le panneau (et ses dépendances) dans un sandbox neuf.
 * @returns {{Comp: Function, win: Object}}
 */
function load() {
  const sandbox = { window: {}, console: console };
  sandbox.window.React = { createElement, Fragment: 'Fragment' };
  vm.createContext(sandbox);

  // Lib de pivot RÉELLE — pose window.AnalytiqueUtils (UMD, `module` absent ici).
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/lib/analytiqueUtils.js'), 'utf8'), sandbox);

  // Dépendances que le panneau lit sur window (elles vivent dans app.jsx).
  sandbox.window.PARCELLES_CULTURALES = [];
  sandbox.window.sbParcelleHa = function () { return 0; };
  sandbox.window.deriveSubFerme = function () { return ''; };

  // Grille de présentation extraite (LOT 2a). Chargée SI PRÉSENTE : ces tests
  // ont été écrits et rendus verts AVANT l'extraction, contre le panneau
  // monolithique — c'est ce qui en fait une preuve d'iso-comportement.
  const grille = path.join(ROOT, 'public/components/PivotAnalytiqueGrid.jsx');
  if (fs.existsSync(grille)) vm.runInContext(readJsx('public/components/PivotAnalytiqueGrid.jsx'), sandbox);

  vm.runInContext(readJsx('public/components/AffectationAnalytiqueTable.jsx'), sandbox);
  return { Comp: sandbox.window.AffectationAnalytiqueTable, win: sandbox.window };
}

// ---------------------------------------------------------------- données

// Deux parcelles Framboise (Ha connu), deux familles de deux groupes MO
// différents. Chiffres choisis pour que TOUTES les valeurs attendues restent
// sous 1000 : au-delà, toLocaleString('fr-FR') insère une espace dont le
// codet varie selon l'ICU de Node, et l'assertion devient instable.
const P5 = 'F1-S5 MARAVILLA';
const P6 = 'F1-S6 MARAVILLA';

const ROWS = [
  { parcelle: P5, ferme: 'F1', refParcelle: 'r5', haRef: 2, operationGroupe: 'GB09',
    operationFamille: 'Taille', operation: 'Taille d\'hiver', jh: 6, cout: 180, nbOuv: 3 },
  { parcelle: P5, ferme: 'F1', refParcelle: 'r5', haRef: 2, operationGroupe: 'GB09',
    operationFamille: 'Taille', operation: 'Taille de formation', jh: 4, cout: 120, nbOuv: 2 },
  { parcelle: P6, ferme: 'F1', refParcelle: 'r6', haRef: 4, operationGroupe: 'GB09',
    operationFamille: 'Taille', operation: 'Taille d\'hiver', jh: 20, cout: 800, nbOuv: 8 },
  { parcelle: P5, ferme: 'F1', refParcelle: 'r5', haRef: 2, operationGroupe: 'GB11',
    operationFamille: 'Services généraux', operation: 'Gardiennage', jh: 5, cout: 100, nbOuv: 1 },
];

function makeProps(overrides) {
  const spy = { calls: [] };
  const setter = (name) => (v) => spy.calls.push({ name: name, value: v });
  const base = {
    analytiqueData: ROWS,
    apiData: { periodes: ['Quinzaine 01'], periodeCampagne: { 'Quinzaine 01': '2026-2027' } },
    selectedPeriode: 'Quinzaine 01',
    farmFilter: '',
    avoSubFilter: '',
    empCostReady: false,
    fullscreen: false, setFullscreen: setter('setFullscreen'),
    cultureIdx: 0, setCultureIdx: setter('setCultureIdx'),
    totalMode: false, setTotalMode: setter('setTotalMode'),
    view: 'jh', setView: setter('setView'),
    detailCell: null, setDetailCell: setter('setDetailCell'),
    detailMode: false, setDetailMode: setter('setDetailMode'),
    scopeMode: 'quinzaine', setScopeMode: setter('setScopeMode'),
    scopeValue: '', setScopeValue: setter('setScopeValue'),
    scopeData: null, setScopeData: setter('setScopeData'),
    scopeLoading: false, setScopeLoading: setter('setScopeLoading'),
    _spy: spy,
  };
  return Object.assign(base, overrides || {});
}

function render(overrides) {
  const props = makeProps(overrides);
  return { tree: load().Comp(props), spy: props._spy };
}

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

/**
 * Texte CONCATÉNÉ, sans séparateur : pour les libellés que le JSX découpe en
 * plusieurs morceaux (`{n} parcelle{n > 1 ? 's' : ''}`), que `textOf` séparerait.
 */
function flatText(node) {
  return walk(node)
    .flatMap(function (n) {
      return (n.children || []).filter(function (c) { return typeof c === 'string' || typeof c === 'number'; });
    })
    .map(String)
    .join('');
}

/** Tables de pivot (la pop-up de détail, elle, porte className `data-table`). */
function pivotTables(tree) {
  return walk(tree).filter(function (n) {
    return n.type === 'table' && n.props.style && n.props.style.borderCollapse === 'collapse';
  });
}

function sectionOf(tree, tag) {
  return walk(tree).filter(function (n) { return n.type === tag; });
}

/** Lignes du <tbody> de la première table de pivot. */
function bodyRows(tree) {
  const tbody = sectionOf(pivotTables(tree)[0], 'tbody')[0];
  return walk(tbody).filter(function (n) { return n.type === 'tr'; });
}

/** Textes des cellules d'une ligne. */
function cells(tr) {
  return (tr.children || []).filter(function (c) { return c && c.type === 'td'; }).map(textOf);
}

/** Textes des en-têtes de colonne. */
function headers(tree) {
  const thead = sectionOf(pivotTables(tree)[0], 'thead')[0];
  return walk(thead).filter(function (n) { return n.type === 'th'; }).map(textOf);
}

function footRow(tree) {
  const tfoot = sectionOf(pivotTables(tree)[0], 'tfoot')[0];
  return walk(tfoot).filter(function (n) { return n.type === 'tr'; })[0];
}

// ------------------------------------------------------------------ tests

test('rendu — structure : ligne groupe, lignes famille avec leur code GB', () => {
  const { tree } = render();
  const rows = bodyRows(tree);

  // 2 groupes MO alimentés × (1 en-tête + 1 famille).
  assert.strictEqual(rows.length, 4);

  // Ligne groupe : une seule cellule qui couvre toute la largeur (2 parcelles
  // + colonne Opération + colonne Total).
  const groupe = rows[0];
  const groupeTds = (groupe.children || []).filter(function (c) { return c.type === 'td'; });
  assert.strictEqual(groupeTds.length, 1);
  assert.strictEqual(groupeTds[0].props.colSpan, 4);
  assert.ok(textOf(groupe).includes('M.O Hors récolte'));
  assert.ok(textOf(groupe).includes('30 JH total'), 'total du groupe annoncé dans l\'en-tête');

  // Ligne famille : libellé + code GB en exposant.
  assert.ok(textOf(rows[1]).includes('Taille'));
  assert.ok(textOf(rows[1]).includes('GB09'));

  assert.ok(textOf(rows[2]).includes('M.O Service générale'));
  assert.ok(textOf(rows[3]).includes('Services généraux'));
  assert.ok(textOf(rows[3]).includes('GB11'));
});

test('rendu — colonnes : une par parcelle avec son Ha, plus la colonne Total', () => {
  const { tree } = render();
  assert.deepStrictEqual(headers(tree), [
    'Opération',
    P5 + ' | 2 Ha',
    P6 + ' | 4 Ha',
    'Total',
  ]);
  // Le bandeau de culture annonce le compte de parcelles et le Ha cumulé.
  assert.ok(flatText(tree).includes('2 parcelles · 6.00 Ha total'));
});

test('rendu — mode par Ha (défaut) : JH divisés par le Ha de la colonne', () => {
  const { tree } = render();
  const rows = bodyRows(tree);
  // Taille : 10 JH / 2 Ha = 5.0 ; 20 JH / 4 Ha = 5.0 ; total 30 JH / 6 Ha = 5.0.
  assert.deepStrictEqual(cells(rows[1]).slice(1), ['5.0 | JH/Ha', '5.0 | JH/Ha', '5.0 | JH/Ha']);
  // Services généraux : uniquement sur P5 → P6 vide.
  assert.deepStrictEqual(cells(rows[3]).slice(1), ['2.5 | JH/Ha', '—', '0.8 | JH/Ha']);
});

test('rendu — bascule Total : les valeurs brutes, unité sans « /Ha »', () => {
  const { tree } = render({ totalMode: true });
  const rows = bodyRows(tree);
  assert.deepStrictEqual(cells(rows[1]).slice(1), ['10.0 | JH', '20.0 | JH', '30.0 | JH']);
  assert.deepStrictEqual(cells(rows[3]).slice(1), ['5.0 | JH', '—', '5.0 | JH']);
  assert.ok(flatText(tree).includes('Affectation Analytique — Total · Famille'));
});

test('rendu — bascule Coût : DH par Ha, libellé de bascule selon empCostReady', () => {
  const { tree } = render({ view: 'cout' });
  const rows = bodyRows(tree);
  // Taille : 300 DH / 2 Ha = 150 ; 800 / 4 = 200 ; 1100 / 6 = 183.
  assert.deepStrictEqual(cells(rows[1]).slice(1), ['150 | DH/Ha', '200 | DH/Ha', '183 | DH/Ha']);
  assert.ok(textOf(tree).includes('Coût BEE ONE / Ha'), 'coût BEE ONE quand la map emp. n\'est pas prête');

  const pret = render({ view: 'cout', empCostReady: true });
  assert.ok(textOf(pret.tree).includes('Coût emp. / Ha'));
  assert.deepStrictEqual(cells(bodyRows(pret.tree)[1]).slice(1),
    ['150 | DH emp./Ha', '200 | DH emp./Ha', '183 | DH emp./Ha']);
});

test('rendu — pied de tableau : somme des seules lignes famille', () => {
  const { tree } = render({ totalMode: true });
  // P5 : 10 (Taille) + 5 (Services généraux) = 15 ; P6 : 20 ; total 35.
  // Les lignes groupe portent les mêmes JH : les compter doublerait le pied.
  assert.deepStrictEqual(cells(footRow(tree)),
    ['TOTAL', '15.0 | JH', '20.0 | JH', '35.0 | JH']);

  const parHa = render();
  assert.deepStrictEqual(cells(footRow(parHa.tree)),
    ['TOTAL', '7.5 | JH/Ha', '5.0 | JH/Ha', '5.8 | JH/Ha']);
});

test('rendu — mode Détail : les opérations fines sous leur famille, pied inchangé', () => {
  const { tree } = render({ detailMode: true });
  const rows = bodyRows(tree);
  const txt = rows.map(textOf);

  // groupe, Taille, ses 2 opérations, groupe, Services généraux, son opération.
  assert.strictEqual(rows.length, 7);
  assert.ok(txt[2].includes('Taille d\'hiver'), 'opération la plus lourde en premier');
  assert.ok(txt[2].includes('↳'));
  assert.ok(txt[3].includes('Taille de formation'));
  assert.ok(txt[6].includes('Gardiennage'));
  // Taille d'hiver : 6 JH / 2 Ha = 3.0 ; 20 / 4 = 5.0 ; 26 / 6 = 4.3.
  assert.deepStrictEqual(cells(rows[2]).slice(1), ['3.0 | JH/Ha', '5.0 | JH/Ha', '4.3 | JH/Ha']);
  // Le pied ne bouge pas : les lignes opération ne sont pas de type famille.
  assert.deepStrictEqual(cells(footRow(tree)),
    ['TOTAL', '7.5 | JH/Ha', '5.0 | JH/Ha', '5.8 | JH/Ha']);
  assert.ok(textOf(tree).includes('Détail opérations'));
});

test('rendu — clic sur une cellule : ouvre le détail de (parcelle, famille) avec son Ha', () => {
  const { tree, spy } = render();
  const cellule = (bodyRows(tree)[1].children || []).filter(function (c) { return c.type === 'td'; })[1];
  cellule.props.onClick();

  const ouverture = spy.calls.filter(function (c) { return c.name === 'setDetailCell'; });
  assert.strictEqual(ouverture.length, 1);
  assert.strictEqual(ouverture[0].value.parcelle, P5);
  assert.strictEqual(ouverture[0].value.operationFamille, 'Taille');
  assert.strictEqual(ouverture[0].value.ha, 2);
  assert.strictEqual(ouverture[0].value.detailRows.length, 2, 'les lignes brutes de la cellule');
});

test('rendu — Ha inconnu : « Ha ? » en en-tête et cellule barrée en mode par Ha', () => {
  const sansHa = ROWS.concat([{
    parcelle: 'F1-S9 MARAVILLA', ferme: 'F1', refParcelle: 'r9', haRef: 0,
    operationGroupe: 'GB09', operationFamille: 'Taille', operation: 'Taille d\'hiver',
    jh: 7, cout: 70, nbOuv: 1,
  }]);
  const { tree } = render({ analytiqueData: sansHa });
  assert.ok(headers(tree).some(function (h) { return h.includes('Ha ?'); }));
  // Par Ha : indéterminable → tiret (l'unité, elle, reste affichée). En Total :
  // la valeur brute reste lisible.
  assert.strictEqual(cells(bodyRows(tree)[1])[3], '— | JH/Ha');
  const total = render({ analytiqueData: sansHa, totalMode: true });
  assert.strictEqual(cells(bodyRows(total.tree)[1])[3], '7.0 | JH');
});

test('rendu — aucune donnée : ni tableau ni bascules', () => {
  const { tree } = render({ analytiqueData: [] });
  assert.strictEqual(pivotTables(tree).length, 0);
  assert.strictEqual(textOf(tree), '');
});

test('rendu — une table par culture présente, avec son en-tête coloré', () => {
  const avecMyrtille = ROWS.concat([{
    parcelle: 'F5-S13 MYRTILLE', ferme: 'F5', refParcelle: 'm13', haRef: 3,
    operationGroupe: 'GB02', operationFamille: 'Ferti-irrigation', operation: 'Fertigation',
    jh: 9, cout: 90, nbOuv: 2,
  }]);
  const { tree } = render({ analytiqueData: avecMyrtille });
  assert.strictEqual(pivotTables(tree).length, 2, 'Framboise et Myrtille');
  const txt = flatText(tree);
  assert.ok(txt.includes('Framboise'));
  assert.ok(txt.includes('Myrtille'));
  assert.ok(txt.includes('1 parcelle · 3.00 Ha total'),
    'singulier pour la culture à une seule parcelle');
});

test('rendu — le filtre ferme global s\'applique avant le pivot', () => {
  const { tree } = render({ farmFilter: 'F1' });
  assert.strictEqual(headers(tree).length, 4, 'les 2 parcelles F1 restent');
  const horsF1 = render({ farmFilter: 'F2' });
  assert.strictEqual(pivotTables(horsF1.tree).length, 0);
});
