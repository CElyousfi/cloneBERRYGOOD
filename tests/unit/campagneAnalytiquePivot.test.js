'use strict';

// Vue « Pivot analytique » de l'écran Campagne (LOT 2b) : branchement des
// lignes de `campagne-analytique-detail` sur la grille partagée
// public/components/PivotAnalytiqueGrid.jsx.
//
// Ce que ce fichier protège :
//   1. le MAPPING de champs (code → operationGroupe, famille → operationFamille,
//      jointure du Ha) — une erreur ici ne lève rien, elle range toutes les
//      lignes dans « AUTRE » ou vide les colonnes ;
//   2. le RECOUPEMENT des chiffres : les totaux affichés par la grille doivent
//      être EXACTEMENT les sommes des lignes brutes de l'API, parcelle par
//      parcelle (les mêmes que la vue « Affectation par Ha » historique) ;
//   3. la résolution de culture par le référentiel SB (`culture_sb`) et NON par
//      regex sur le libellé — piège corrigé récemment : « F5- S1 CORINA » porte
//      un mot-clé myrtille mais est déclarée Framboise au référentiel.
//
// Le composant et la grille sont chargés dans un faux `window` (vm), avec un
// React minimal : createElement invoque directement les composants fonction, ce
// qui donne un arbre inspectable sans react-dom (même technique que
// tests/unit/pivotAnalytiqueGrid.test.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

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

// États injectés au prochain rendu, dans l'ORDRE des useState de PivotView :
// [totalMode, detailMode, detailCell]. Vide = valeur initiale du composant.
let stateQueue = [];
// Valeurs passées aux setters pendant le rendu (clic sur une cellule…).
let setterCalls = [];

function useState(init) {
  const v = stateQueue.length ? stateQueue.shift() : init;
  return [v, function (nv) { setterCalls.push(nv); }];
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function transform(rel) {
  const file = path.join(ROOT, rel);
  return babel.transformSync(fs.readFileSync(file, 'utf8'), {
    presets: [require.resolve('@babel/preset-react')],
    filename: file, babelrc: false, configFile: false,
  }).code;
}

/**
 * Charge le composant dans un faux `window`. `deps` permet d'OMETTRE une
 * dépendance UMD pour vérifier le comportement dégradé (un <script> qui n'a pas
 * chargé est un cas réel : CDN lent, 404 après un déploiement partiel).
 */
function loadTab(deps) {
  const withCulture = !deps || deps.cultureUtils !== false;
  // Modules du budget (LOT 2c) : chargés à la demande, pour pouvoir vérifier
  // AUSSI le comportement sans eux — un <script> manquant doit dégrader vers le
  // réalisé seul, jamais faire tomber la grille.
  const withBudget = !!(deps && deps.budget);
  const sandbox = { window: {}, console, document: undefined };
  sandbox.window.React = {
    createElement,
    Fragment: 'Fragment',
    useState,
    useEffect: function () {},
    useMemo: function (fn) { return fn(); },
  };
  vm.createContext(sandbox);
  // Dépendances RÉELLES (pas de stub) : le pivot et la résolution de culture
  // testés ici sont précisément ceux de la prod.
  if (withCulture) vm.runInContext(read('public/lib/cultureUtils.js'), sandbox);
  vm.runInContext(read('public/lib/analytiqueUtils.js'), sandbox);
  if (withBudget) {
    vm.runInContext(read('public/lib/campagneBudgetPivot.js'), sandbox);
    // Porteur de la RÈGLE MÉTIER (familleTotal / splitOpKey), injectée dans le
    // builder par PivotView.
    vm.runInContext(transform('public/components/CampagneBudgetTab.jsx'), sandbox);
  }
  vm.runInContext(transform('public/components/PivotAnalytiqueGrid.jsx'), sandbox);
  vm.runInContext(read('public/components/CampagneAnalytiqueTab.jsx'), sandbox);
  return sandbox.window.CampagneAnalytiqueTab;
}

const Tab = loadTab();

// -------------------------------------------------------------- fixtures
//
// Deux parcelles Framboise (2 Ha et 4 Ha) + une Myrtille (5 Ha).
// « F5- S1 CORINA » est le piège : CORINA déclenche la regex myrtille, mais le
// référentiel SB la déclare Framboise — c'est le référentiel qui doit gagner.

const DATA = {
  campagne: '2026-2027',
  haByRef: { 'F5- S9 BLUE': 5 },
  rows: [
    { parcelle: 'F1- S5 MARAVILLA', refParcelle: 'F1S5', ferme: 'F1', periode: 'Q01',
      operation: '9. Taille longue', famille: 'Taille', code: 'GB09', jh: 30, cout: 4500, nbOuv: 5 },
    { parcelle: 'F1- S5 MARAVILLA', refParcelle: 'F1S5', ferme: 'F1', periode: 'Q02',
      operation: 'Taille courte', famille: 'Taille', code: 'GB09', jh: 10, cout: 1500, nbOuv: 3 },
    { parcelle: 'F1- S5 MARAVILLA', refParcelle: 'F1S5', ferme: 'F1', periode: 'Q01',
      operation: 'Cueillette', famille: 'Récolte', code: 'GB08', jh: 20, cout: 3000, nbOuv: 8 },
    { parcelle: 'F5- S1 CORINA', refParcelle: 'F5S1', ferme: 'F5', periode: 'Q01',
      operation: 'Cueillette', famille: 'Récolte', code: 'GB08', jh: 12, cout: 2400, nbOuv: 4 },
    { parcelle: 'F5- S9 BLUE', refParcelle: 'F5S9', ferme: 'F5', periode: 'Q01',
      operation: 'Cueillette', famille: 'Récolte', code: 'GB08', jh: 15, cout: 3750, nbOuv: 6 },
  ],
};

const SB_MAP = {
  'F1- S5 MARAVILLA': { culture_sb: 'Framboise', nom_sb: 'S5 MARAVILLA', ha: 2 },
  'F5- S1 CORINA':    { culture_sb: 'Framboise', nom_sb: 'S1 CORINA', ha: 4 },
  // Ha ABSENT du référentiel : doit être repris de data.haByRef.
  'F5- S9 BLUE':      { culture_sb: 'Myrtille', nom_sb: 'S9 BLUE' },
};

// --------------------------------------------------------------- helpers

/**
 * Ramène une valeur produite DANS le sandbox vm vers le realm des tests :
 * sans ça, deepStrictEqual échoue sur l'identité des prototypes (Array/Object
 * du vm ≠ ceux du test) alors que les structures sont identiques.
 */
function plain(v) { return JSON.parse(JSON.stringify(v)); }

/** Séparateur de milliers : celui de la locale, comme le composant. */
function nb(v) { return v.toLocaleString('fr-MA'); }

function walk(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach(function (c) { walk(c, out); });
  return out;
}

function textOf(node) {
  return walk(node)
    .flatMap((n) => (n.children || []).filter((c) => typeof c === 'string' || typeof c === 'number'))
    .map(String)
    .join(' | ');
}

/** Les <table> de l'arbre, une par culture affichée. */
function tables(tree) { return walk(tree).filter((n) => n.type === 'table'); }
function section(tree, tag) { return walk(tree).filter((n) => n.type === tag)[0]; }
function bodyRows(tree) { return walk(section(tree, 'tbody')).filter((n) => n.type === 'tr'); }
function footRow(tree) { return walk(section(tree, 'tfoot')).filter((n) => n.type === 'tr')[0]; }
function cells(tr) { return (tr.children || []).filter((c) => c && c.type === 'td').map(textOf); }
function headers(tree) { return walk(section(tree, 'thead')).filter((n) => n.type === 'th').map(textOf); }

/**
 * Rend la vue. `states` = [totalMode, detailMode, detailCell] injectés dans
 * l'ordre des useState du composant.
 */
function render(props, states, TabRef) {
  stateQueue = (states || []).slice();
  setterCalls = [];
  return (TabRef || Tab).PivotView(Object.assign({
    data: DATA, sbMap: SB_MAP, metric: 'jh', setMetric: function () {},
  }, props || {}));
}

/** Somme brute d'un champ sur les lignes de l'API — le témoin du recoupement. */
function sumRaw(field, predicate) {
  return DATA.rows.filter(predicate).reduce((s, r) => s + r[field], 0);
}

// ----------------------------------------------------------------- tests

test('mapping — code → operationGroupe, famille → operationFamille, Ha joint', () => {
  const rows = plain(Tab.pivotRows(DATA.rows, SB_MAP, DATA.haByRef));
  assert.strictEqual(rows.length, 5);
  assert.deepStrictEqual(
    rows.map((r) => [r.parcelle, r.operationGroupe, r.operationFamille, r.ha, r.jh, r.cout, r.nbOuv]),
    [
      ['F1- S5 MARAVILLA', 'GB09', 'Taille', 2, 30, 4500, 5],
      ['F1- S5 MARAVILLA', 'GB09', 'Taille', 2, 10, 1500, 3],
      ['F1- S5 MARAVILLA', 'GB08', 'Récolte', 2, 20, 3000, 8],
      ['F5- S1 CORINA', 'GB08', 'Récolte', 4, 12, 2400, 4],
      // Ha absent de sbMap → repris de haByRef (clé MAJUSCULES/trim).
      ['F5- S9 BLUE', 'GB08', 'Récolte', 5, 15, 3750, 6],
    ]
  );
  // `operation` est conservé : c'est la ligne fine du mode Détail et de la pop-up.
  assert.strictEqual(rows[0].operation, '9. Taille longue');
});

test('mapping — les filtres ferme et culture s\'appliquent AVANT le pivot', () => {
  assert.deepStrictEqual(
    plain(Tab.pivotRows(DATA.rows, SB_MAP, DATA.haByRef, { farmFilter: 'F5' })).map((r) => r.parcelle),
    ['F5- S1 CORINA', 'F5- S9 BLUE']
  );
  assert.deepStrictEqual(
    plain(Tab.pivotRows(DATA.rows, SB_MAP, DATA.haByRef, { cultureFilter: 'Myrtille' })).map((r) => r.parcelle),
    ['F5- S9 BLUE']
  );
  // 'Toutes' n'est pas une culture : le filtre laisse tout passer.
  assert.strictEqual(Tab.pivotRows(DATA.rows, SB_MAP, DATA.haByRef, { cultureFilter: 'Toutes' }).length, 5);
});

test('culture — le référentiel SB prime sur la regex du libellé', () => {
  const groups = plain(Tab.byCulture(Tab.pivotRows(DATA.rows, SB_MAP, DATA.haByRef), SB_MAP));
  assert.deepStrictEqual(groups.map((g) => g.culture), ['Framboise', 'Myrtille']);
  // « F5- S1 CORINA » contient un mot-clé myrtille : classée Framboise malgré tout.
  assert.deepStrictEqual(
    groups[0].rows.map((r) => r.parcelle).filter((v, i, a) => a.indexOf(v) === i),
    ['F1- S5 MARAVILLA', 'F5- S1 CORINA']
  );
  assert.deepStrictEqual(groups[1].rows.map((r) => r.parcelle), ['F5- S9 BLUE']);
});

test('grille — une table par culture, colonnes = parcelles nommées SB avec leur Ha', () => {
  const tree = render();
  assert.strictEqual(tables(tree).length, 2, 'Framboise + Myrtille');
  assert.deepStrictEqual(headers(tables(tree)[0]),
    ['Opération', 'S5 MARAVILLA | 2 Ha', 'S1 CORINA | 4 Ha', 'Total']);
});

test('grille — lignes groupées groupe > famille (code GB)', () => {
  const rows = bodyRows(tables(render())[0]);
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Taille', 'M.O Récolte', 'Récolte']);
  // La ligne famille porte son code GB à côté du libellé.
  assert.ok(textOf(rows[1]).indexOf('GB09') >= 0);
});

test('grille — mode Détail : les opérations fines s\'insèrent SOUS leur famille', () => {
  const rows = bodyRows(tables(render(null, [false, true, null]))[0]);
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Taille', 'Taille longue', 'Taille courte', 'M.O Récolte', 'Récolte', 'Cueillette']);
});

test('recoupement — Récap et Détail affichent le MÊME pied de tableau', () => {
  // Le piège classique du mode Détail : les lignes opération rejouent les JH de
  // leur famille. Si elles étaient typées 'famille', le pied doublerait — sans
  // que rien ne le signale. Verrouillé ici, en JH/Ha ET en Total DH.
  const foot = (states, props) => cells(footRow(tables(render(props, states))[0]));
  assert.deepStrictEqual(foot([false, true, null]), foot([false, false, null]));
  assert.deepStrictEqual(
    foot([true, true, null], { metric: 'cout' }),
    foot([true, false, null], { metric: 'cout' })
  );
  // Et cette valeur commune est bien la somme brute, pas un doublon.
  assert.strictEqual(foot([true, true, null], { metric: 'cout' }).pop(), nb(11400) + ' | DH');
});

test('recoupement — en Total DH, la grille affiche les sommes brutes de l\'API', () => {
  // Témoins calculés directement sur DATA.rows : ce sont EXACTEMENT les
  // « Total DH » par parcelle qu'affichait l'ancienne vue tabulaire.
  const maravilla = sumRaw('cout', (r) => r.parcelle === 'F1- S5 MARAVILLA'); // 9000
  const corina = sumRaw('cout', (r) => r.parcelle === 'F5- S1 CORINA');       // 2400
  assert.deepStrictEqual([maravilla, corina, maravilla + corina], [9000, 2400, 11400]);

  const tree = render({ metric: 'cout' }, [true, false, null]);
  const dh = (v) => v.toLocaleString('fr-MA') + ' | DH';
  assert.deepStrictEqual(cells(footRow(tables(tree)[0])),
    ['TOTAL', dh(maravilla), dh(corina), dh(maravilla + corina)]);

  // Détail par famille sur la même parcelle : Taille 4500+1500, Récolte 3000.
  const rows = bodyRows(tables(tree)[0]);
  assert.strictEqual(cells(rows[1])[1], dh(6000));
  assert.strictEqual(cells(rows[3])[1], dh(3000));
});

test('recoupement — en JH par Ha, chaque cellule est le total divisé par le Ha', () => {
  const rows = bodyRows(tables(render({ metric: 'jh' }))[0]);
  // Taille sur MARAVILLA : (30 + 10) JH / 2 Ha = 20.0. Pas de Taille sur CORINA :
  // cellule VIDE (« — » sans unité), pas un zéro — la grille distingue les deux.
  assert.deepStrictEqual(cells(rows[1]).slice(1, 3), ['20.0 | JH/Ha', '—']);
  assert.deepStrictEqual(cells(rows[3]).slice(1, 3), ['10.0 | JH/Ha', '3.0 | JH/Ha']);
  // Total général : (60 + 12) JH / 6 Ha = 12.0.
  assert.strictEqual(cells(footRow(tables(render({ metric: 'jh' }))[0])).pop(), '12.0 | JH/Ha');
});

test('famille à code GB inconnu — rangée sous AUTRE, et comptée dans le total', () => {
  const data = {
    haByRef: {},
    rows: [
      { parcelle: 'F1- S5 MARAVILLA', ferme: 'F1', operation: 'Bricolage divers',
        famille: 'Bricolage', code: 'GB99', jh: 4, cout: 600, nbOuv: 1 },
      { parcelle: 'F1- S5 MARAVILLA', ferme: 'F1', operation: 'Taille longue',
        famille: 'Taille', code: 'GB09', jh: 6, cout: 900, nbOuv: 2 },
    ],
  };
  const tree = render({ data: data, metric: 'cout' }, [true, false, null]);
  const rows = bodyRows(tables(tree)[0]);
  // Le libellé BEE ONE est conservé, le code affiché est 'AUTRE' — la ligne
  // n'est ni perdue, ni fondue dans une famille voisine.
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ').slice(0, 2)), [
    ['M.O Hors récolte', nb(900) + ' DH'],
    ['Taille', 'GB09'],
    ['M.O Service générale', nb(600) + ' DH'],
    ['Bricolage', 'AUTRE'],
  ]);
  // 900 + 600 : la famille AUTRE entre bien dans le total général.
  assert.strictEqual(cells(footRow(tables(tree)[0])).pop(), nb(1500) + ' | DH');
});

test('module manquant — message d\'erreur explicite, jamais une grille qui ment', () => {
  // CultureUtils absent : sans garde, toutes les parcelles retombaient sur
  // 'Framboise' et une grille titrée Framboise affichait des myrtilles.
  const TabSansCulture = loadTab({ cultureUtils: false });
  const tree = render(null, null, TabSansCulture);
  assert.strictEqual(tables(tree).length, 0, 'aucune grille rendue');
  assert.match(textOf(tree), /Affectation par Ha indisponible/);

  // Ceinture de sécurité de la fonction pure elle-même : le groupe est nommé,
  // pas silencieusement rebaptisé Framboise.
  const groups = plain(TabSansCulture.byCulture(
    TabSansCulture.pivotRows(DATA.rows, SB_MAP, DATA.haByRef), SB_MAP));
  assert.deepStrictEqual(groups.map((g) => g.culture), [TabSansCulture.CULTURE_INCONNUE]);
  assert.strictEqual(TabSansCulture.CULTURE_INCONNUE, 'Culture non résolue');
});

test('pop-up — le clic sur une cellule ouvre le détail, colonne Présences alimentée', () => {
  const tree = render();
  const td = (bodyRows(tables(tree)[0])[1].children || []).filter((c) => c.type === 'td')[1];
  td.props.onClick();
  assert.strictEqual(setterCalls.length, 1);
  const cell = setterCalls[0];
  assert.strictEqual(cell.parcelle, 'F1- S5 MARAVILLA');
  assert.strictEqual(cell.parcelleLabel, 'S5 MARAVILLA');
  assert.strictEqual(cell.operationFamille, 'Taille');

  // Rendu avec la pop-up ouverte : les deux opérations de Taille, leurs nbOuv,
  // et le total (5 + 3 ouvriers, 40 JH, 6000 DH).
  const ouvert = render(null, [false, false, cell]);
  const popup = tables(ouvert)[0];
  // « Présences » et non « Ouvriers » : la colonne cumule des présences
  // journalières sur toute la campagne (un ouvrier venu 10 jours pèse 10).
  assert.deepStrictEqual(headers(popup),
    ['Opération', 'Présences', 'JH', 'JH / Ha', 'Coût (DH)', 'DH / Ha']);
  const thPresences = walk(popup).filter((n) => n.type === 'th')[1];
  assert.match(thPresences.props.title, /Ce n'est pas un effectif/);
  assert.deepStrictEqual(bodyRows(popup).map(cells), [
    ['9. Taille longue', '5', '30.0', '15', nb(4500), nb(2250)],
    ['Taille courte', '3', '10.0', '5', nb(1500), nb(750)],
  ]);
  assert.deepStrictEqual(cells(footRow(popup)), ['TOTAL', '8', '40.0', '20', nb(6000), nb(3000)]);
});

// ------------------------------------------------- budget & écart (LOT 2c)
//
// Les séries Budget et Écart superposées au réalisé DANS la cellule. Budgets
// choisis pour couvrir les quatre cas du lot en un seul rendu :
//   MARAVILLA (2 Ha) Taille   : budget FAMILLE 15 JH/Ha → 30 JH pour 40 réalisés
//                               (dépassement) ;
//   MARAVILLA        Récolte  : budget par OPÉRATION 8 JH/Ha → 16 JH pour 20
//                               réalisés (la règle « opérations écrasent la
//                               famille » : 12 au niveau famille est ignoré) ;
//   CORINA (4 Ha)    Ferti    : budgétée, JAMAIS travaillée → ligne ajoutée ;
//   CORINA           Récolte  : réalisée, NON budgétée → « — », jamais 0 ;
//   BLUE (Myrtille)           : aucun budget → grille à une seule série.

const TabBudget = loadTab({ budget: true });

const BUDGETS = {
  'F1- S5 MARAVILLA': { 'Taille': 15, 'Récolte': 12 },
  'F5- S1 CORINA': { 'Ferti-irrigation': 2 },
};
const OP_BUDGETS = {
  'F1- S5 MARAVILLA': { 'Récolte': { 'GB08::Cueillette': 8 } },
};

function renderBudget(props, states) {
  return render(Object.assign({
    budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS,
  }, props || {}), states, TabBudget);
}

test('budget — réalisé, budget et écart dans la MÊME cellule (JH par Ha)', () => {
  const rows = bodyRows(tables(renderBudget())[0]);
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Ferti-irrigation', 'Taille', 'M.O Récolte', 'Récolte']);

  // Taille : 40 JH / 2 Ha = 20.0 réalisé, 15.0 budgété → écart (40 − 30) / 2 = +5.0.
  // CORINA n'a ni réalisé ni budget en Taille : cellule vide, pas trois « — ».
  assert.deepStrictEqual(cells(rows[2]).slice(1, 3),
    ['20.0 | Réalisé JH/Ha | 15.0 | Budget JH/Ha | +5.0 | Écart JH/Ha', '—']);

  // Récolte : le budget vient des OPÉRATIONS (8), pas du niveau famille (12) —
  // et surtout pas de leur somme. CORINA est réalisée mais non budgétée.
  assert.deepStrictEqual(cells(rows[4]).slice(1, 3), [
    '10.0 | Réalisé JH/Ha | 8.0 | Budget JH/Ha | +2.0 | Écart JH/Ha',
    '3.0 | Réalisé JH/Ha | — | Budget JH/Ha | — | Écart JH/Ha',
  ]);
});

test('budget — famille budgétée jamais travaillée : ligne visible, réalisé à 0', () => {
  // Sans cette ligne, 2 JH/Ha × 4 Ha = 8 JH de budget non consommé seraient
  // parfaitement invisibles à l'écran.
  const rows = bodyRows(tables(renderBudget())[0]);
  assert.deepStrictEqual(cells(rows[1]).slice(1, 3),
    ['—', '0.0 | Réalisé JH/Ha | 2.0 | Budget JH/Ha | -2.0 | Écart JH/Ha']);
});

test('budget — dépassement signalé en rouge, sous-consommation neutre', () => {
  const rows = bodyRows(tables(renderBudget())[0]);
  const spans = (tr, i) => walk((tr.children || []).filter((c) => c.type === 'td')[i])
    .filter((n) => n.type === 'span');
  // Taille sur MARAVILLA : +5.0 → rouge.
  const depassement = spans(rows[2], 1);
  assert.strictEqual(depassement.length, 1);
  assert.strictEqual(textOf(depassement[0]), '+5.0');
  assert.strictEqual(depassement[0].props.style.color, '#c0392b');
  // Ferti sur CORINA : −2.0 → aucun span coloré.
  assert.strictEqual(spans(rows[1], 2).length, 0);
});

test('budget — en mode Total, les trois séries suivent la bascule', () => {
  const rows = bodyRows(tables(renderBudget(null, [true, false, null]))[0]);
  // Budget en JH/Ha × 2 Ha = 30 JH, réalisé 40 JH, écart +10 JH.
  assert.strictEqual(cells(rows[2])[1],
    '40.0 | Réalisé JH | 30.0 | Budget JH | +10.0 | Écart JH');
  // Pied de tableau : budget à PÉRIMÈTRE BUDGÉTÉ (30 + 16 + 8 = 54 JH), écart
  // sur ce même périmètre (+10 + 4 − 8 = +6). Le réalisé, lui, reste complet.
  assert.strictEqual(cells(footRow(tables(renderBudget(null, [true, false, null]))[0])).pop(),
    '72.0 | Réalisé JH | 54.0 | Budget JH | +6.0 | Écart JH');
});

test('budget — culture sans aucun budget : grille inchangée, une seule série', () => {
  // Cas nominal de l'avocatier (jamais budgété) : deux lignes de « — » dans
  // chaque cellule n'apprendraient rien à personne.
  const myrtille = bodyRows(tables(renderBudget())[1]);
  assert.deepStrictEqual(cells(myrtille[1]).slice(1), ['3.0 | JH/Ha', '3.0 | JH/Ha']);
});

test('budget — métrique Coût DH : aucune série budget (le budget est en JH/Ha)', () => {
  const rows = bodyRows(tables(renderBudget({ metric: 'cout' }, [true, false, null]))[0]);
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Taille', 'M.O Récolte', 'Récolte']);
  assert.strictEqual(cells(rows[1])[1], nb(6000) + ' | DH');
});

test('budget — mode Détail : le budget descend à la maille opération', () => {
  const rows = bodyRows(tables(renderBudget(null, [false, true, null]))[0]);
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Ferti-irrigation', 'Taille', 'Taille longue', 'Taille courte',
      'M.O Récolte', 'Récolte', 'Cueillette']);
  // L'opération budgétée porte son budget…
  assert.strictEqual(cells(rows[7])[1],
    '10.0 | Réalisé JH/Ha | 8.0 | Budget JH/Ha | +2.0 | Écart JH/Ha');
  // …et les opérations d'une famille budgétée AU NIVEAU FAMILLE n'héritent de
  // rien : le budget de Taille reste sur sa ligne famille, il n'est pas
  // réparti au jugé entre « Taille longue » et « Taille courte ».
  assert.strictEqual(cells(rows[3])[1], '15.0 | Réalisé JH/Ha | — | Budget JH/Ha | — | Écart JH/Ha');
});

test('budget — module non chargé : réalisé seul, jamais de grille cassée', () => {
  // `Tab` est chargé SANS campagneBudgetPivot ni CampagneBudgetTab.
  const rows = bodyRows(tables(render({ budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS }))[0]);
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Taille', 'M.O Récolte', 'Récolte']);
  assert.deepStrictEqual(cells(rows[1]).slice(1, 3), ['20.0 | JH/Ha', '—']);
});

test('grille — sélection vide : message, jamais une table fantôme', () => {
  const tree = render({ cultureFilter: 'Avocatier' });
  assert.strictEqual(tables(tree).length, 0);
  assert.ok(textOf(tree).indexOf('Aucune donnée pour cette sélection.') >= 0);
});
