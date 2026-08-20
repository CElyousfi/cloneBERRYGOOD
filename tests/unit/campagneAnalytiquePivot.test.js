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
  // Frontière du 1er juillet (source unique du « budget idéal »). Omissible :
  // sans ce module, la part de campagne écoulée est INDÉTERMINABLE et la 4e
  // sous-colonne ne doit pas être proposée — jamais une colonne de « — ».
  if (!deps || deps.campagneUtils !== false) {
    vm.runInContext(read('public/lib/campagneUtils.js'), sandbox);
  }
  // Kilos (ligne « Kg / JH » du bloc récolte). Omissible : sans ce module, la
  // grille doit rendre son pied habituel, sans ligne de cadence — un <script>
  // manquant ne fait pas tomber la récolte.
  if (!deps || deps.production !== false) {
    vm.runInContext(read('public/lib/campagneProduction.js'), sandbox);
  }
  // Rapprochement pointage ↔ grille. Omissible : sans ce module, le panneau de
  // contrôle ne doit pas s'afficher (et surtout pas afficher un écart nul, qui
  // se lirait « tout est rapproché »).
  if (!deps || deps.rapprochement !== false) {
    vm.runInContext(read('public/lib/campagneRapprochement.js'), sandbox);
  }
  if (withBudget) {
    vm.runInContext(read('public/lib/campagneBudgetPivot.js'), sandbox);
    // Porteur de la RÈGLE MÉTIER (familleTotal / splitOpKey), injectée dans le
    // builder par PivotView.
    vm.runInContext(transform('public/components/CampagneBudgetTab.jsx'), sandbox);
    // Les deux restes (LOT 3a). Omissible : sans ce module, la grille doit
    // retomber sur Réalisé + Budget, jamais afficher deux colonnes de « — ».
    if (!deps || deps.rythme !== false) {
      vm.runInContext(read('public/lib/campagneRythme.js'), sandbox);
    }
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
  // Libellé au format EXACT servi par le backend (`${startYear}/${startYear+1}`,
  // functions/pointageService.js) — avec un SLASH, pas un tiret. Un tiret ici
  // rendrait la fixture irréaliste : c'est ce qui avait laissé passer en QA une
  // 4e sous-colonne « Budget idéal » morte en prod (partEcoulee → null).
  campagne: '2026/2027',
  // Quinzaines de la campagne telles que renvoyées par l'API : elles couvrent
  // TOUTES les parcelles, pas seulement les lignes de ce jeu d'essai — d'où 4
  // quinzaines écoulées (donc 20 restantes) pour des lignes qui n'en occupent
  // que deux. Q04 est EN COURS : la fenêtre du rythme s'arrête à Q03, et il
  // faut 3 quinzaines COMPLÈTES pour projeter — on est pile au seuil.
  periodes: ['Q01', 'Q02', 'Q03', 'Q04'],
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

// ⚠️ COLONNE TOTAL : ABSENTE HORS PLEIN ÉCRAN sur cet écran (cf. `showTotal` de
// la grille), et absente aussi en plein écran à UNE SEULE série. Elle ne revient
// qu'en plein écran multi-séries, éclatée en sous-colonnes (bloc « plein écran »
// en fin de fichier). Conséquence sur les tests ci-dessous, tous rendus hors
// plein écran : plus aucun TOTAL DE LIGNE ni GRAND TOTAL à lire — les totaux de
// COLONNE (pied de tableau) restent, et le comportement des deux autres est
// verrouillé côté grille (tests/unit/pivotAnalytiqueGrid.test.js, mode showTotal
// par défaut) et côté écran Quinzaine (affectationAnalytiqueTable.test.js).

test('grille — une table par bloc, colonnes = parcelles nommées SB avec leur Ha', () => {
  const tree = render();
  // Framboise = hors récolte + récolte ; Myrtille n'a que de la récolte, donc
  // un seul bloc (pas de tableau principal vide au-dessus).
  assert.strictEqual(tables(tree).length, 3, 'Framboise ×2 + Myrtille');
  assert.deepStrictEqual(headers(tables(tree)[0]),
    ['Opération', 'S5 MARAVILLA | 2 Ha', 'S1 CORINA | 4 Ha']);
});

test('grille — aucune colonne Total HORS plein écran', () => {
  const tree = render();
  tables(tree).forEach((t) => {
    assert.strictEqual(headers(t).indexOf('Total'), -1, 'en-tête');
    assert.ok(!headers(t).some((h) => /^TOTAL\b/.test(h)), 'en-tête éclaté');
    // Le bandeau de groupe couvre le libellé + les colonnes de parcelles, et
    // RIEN de plus : un +2 hérité décalerait tout le tableau en silence.
    const bandeau = (bodyRows(t)[0].children || []).filter((c) => c.type === 'td');
    assert.strictEqual(bandeau.length, 1);
    const largeurLigne = (bodyRows(t)[1].children || []).filter((c) => c.type === 'td').length;
    assert.strictEqual(bandeau[0].props.colSpan, largeurLigne);
    assert.strictEqual(footRow(t).children.filter((c) => c.type === 'td').length, largeurLigne);
  });
  // Framboise : 2 parcelles × 1 série + le libellé.
  assert.strictEqual(
    (bodyRows(tables(tree)[0])[0].children || []).filter((c) => c.type === 'td')[0].props.colSpan,
    3
  );
});

test('grille — lignes groupées groupe > famille (code GB)', () => {
  const grilles = tables(render());
  const rows = bodyRows(grilles[0]);
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Taille']);
  // La récolte n'a pas disparu : elle a son bloc, sous le tableau principal.
  assert.deepStrictEqual(bodyRows(grilles[1]).map((r) => textOf(r).split(' | ')[0]),
    ['M.O Récolte', 'Récolte']);
  // La ligne famille porte son code GB à côté du libellé.
  assert.ok(textOf(rows[1]).indexOf('GB09') >= 0);
});

test('grille — mode Détail : les opérations fines s\'insèrent SOUS leur famille', () => {
  const grilles = tables(render(null, [false, true, null]));
  assert.deepStrictEqual(bodyRows(grilles[0]).map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Taille', 'Taille longue', 'Taille courte']);
  assert.deepStrictEqual(bodyRows(grilles[1]).map((r) => textOf(r).split(' | ')[0]),
    ['M.O Récolte', 'Récolte', 'Cueillette']);
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
  // Et ces valeurs communes sont bien les sommes brutes, pas des doublons.
  // Le tableau principal est HORS RÉCOLTE : sur MARAVILLA il reste la Taille
  // (4 500 + 1 500 = 6 000 DH), la Récolte (3 000) est passée dans son bloc ;
  // CORINA n'a que de la récolte, sa colonne est donc vide ici.
  assert.deepStrictEqual(foot([true, true, null], { metric: 'cout' }),
    ['TOTAL', nb(6000) + ' | DH', '— | DH']);
  // …et la récolte se retrouve, intacte, dans le second bloc.
  const footRecolte = (states) => cells(footRow(tables(render({ metric: 'cout' }, states))[1]));
  assert.deepStrictEqual(footRecolte([true, false, null]),
    ['TOTAL RÉCOLTE', nb(3000) + ' | DH', nb(2400) + ' | DH']);
});

test('recoupement — en Total DH, la grille affiche les sommes brutes de l\'API', () => {
  // Témoins calculés directement sur DATA.rows : ce sont EXACTEMENT les
  // « Total DH » par parcelle qu'affichait l'ancienne vue tabulaire.
  const maravilla = sumRaw('cout', (r) => r.parcelle === 'F1- S5 MARAVILLA'); // 9000
  const corina = sumRaw('cout', (r) => r.parcelle === 'F5- S1 CORINA');       // 2400
  assert.deepStrictEqual([maravilla, corina, maravilla + corina], [9000, 2400, 11400]);

  const tree = render({ metric: 'cout' }, [true, false, null]);
  const dh = (v) => v.toLocaleString('fr-MA') + ' | DH';
  // Les deux blocs REUNIS redonnent les totaux de l'API, colonne par colonne :
  // MARAVILLA 6 000 (hors récolte) + 3 000 (récolte) = 9 000 ; CORINA 0 + 2 400.
  assert.deepStrictEqual(cells(footRow(tables(tree)[0])), ['TOTAL', dh(6000), '— | DH']);
  assert.deepStrictEqual(cells(footRow(tables(tree)[1])),
    ['TOTAL RÉCOLTE', dh(3000), dh(corina)]);

  // Détail par famille : Taille 4500+1500 dans le principal, Récolte 3000 dans
  // son bloc.
  assert.strictEqual(cells(bodyRows(tables(tree)[0])[1])[1], dh(6000));
  assert.strictEqual(cells(bodyRows(tables(tree)[1])[1])[1], dh(3000));
});

test('recoupement — en JH par Ha, chaque cellule est le total divisé par le Ha', () => {
  const grilles = tables(render({ metric: 'jh' }));
  // Taille sur MARAVILLA : (30 + 10) JH / 2 Ha = 20.0. Pas de Taille sur CORINA :
  // cellule VIDE (« — » sans unité), pas un zéro — la grille distingue les deux.
  assert.deepStrictEqual(cells(bodyRows(grilles[0])[1]).slice(1, 3), ['20.0 | JH/Ha', '—']);
  // Récolte, dans son bloc : 20 JH / 2 Ha = 10.0 et 12 / 4 = 3.0.
  assert.deepStrictEqual(cells(bodyRows(grilles[1])[1]).slice(1, 3),
    ['10.0 | JH/Ha', '3.0 | JH/Ha']);
  // Pied du tableau principal : MARAVILLA 40 JH / 2 Ha = 20.0 (la récolte est
  // sortie) ; CORINA n'a rien hors récolte.
  assert.deepStrictEqual(cells(footRow(grilles[0])), ['TOTAL', '20.0 | JH/Ha', '— | JH/Ha']);
  assert.deepStrictEqual(cells(footRow(grilles[1])),
    ['TOTAL RÉCOLTE', '10.0 | JH/Ha', '3.0 | JH/Ha']);
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

// ------------------------------ budget en SOUS-COLONNES (Réalisé / Budget / %)
//
// ⚠️ « Reste budg. » et « Reste rythme » (LOT 3a) ont QUITTÉ la grille : trois
// sous-colonnes par parcelle, pas cinq (9 parcelles × 5 = 45 colonnes). Le
// module public/lib/campagneRythme.js et le champ `classe_rythme` restent en
// place — seul leur affichage ici est retiré ; leur propre couverture est dans
// tests/unit/campagneRythme.test.js.
//
// Les sous-colonnes ajoutées au réalisé. Budgets
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

// Classes de rythme du référentiel (`classe_rythme`). Ferti-irrigation est
// volontairement MIXTE — c'est le cas réel : irrigation continue et
// installation GAG saisonnière cohabitent sous GB02.
const REF_OPS = [
  { code: 'GB09', operation: 'Taille longue', classe_rythme: 'saisonnier' },
  { code: 'GB09', operation: 'Taille courte', classe_rythme: 'saisonnier' },
  { code: 'GB08', operation: 'Cueillette', classe_rythme: 'recolte' },
  { code: 'GB02', operation: 'Irrigation & fertigation', classe_rythme: 'continu' },
  { code: 'GB02', operation: 'Installation GAG', classe_rythme: 'saisonnier' },
];

function renderBudget(props, states) {
  return render(Object.assign({
    budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS, refOperations: REF_OPS,
  }, props || {}), states, TabBudget);
}

// Une cellule métier occupe 3 <td> : [Réalisé, Budget, % consommé]. Indices
// dans `cells(tr)` : 0 = libellé, 1..3 = MARAVILLA, 4..6 = CORINA. Il n'y a
// plus rien après : la colonne Total a quitté cet écran.
const MARAVILLA_SC = [1, 4];
const CORINA_SC = [4, 7];
function sousCellule(tr, borne) { return cells(tr).slice(borne[0], borne[1]); }

test('sous-colonnes — réalisé, budget et % consommé côte à côte (JH par Ha)', () => {
  const grilles = tables(renderBudget());
  const rows = bodyRows(grilles[0]);
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Ferti-irrigation', 'Taille']);
  const rowsRecolte = bodyRows(grilles[1]);
  assert.deepStrictEqual(rowsRecolte.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Récolte', 'Récolte']);

  // En-tête à deux niveaux : la parcelle couvre ses 3 sous-colonnes, dont les
  // libellés ne sont plus répétés dans chaque cellule.
  const trs = walk(section(tables(renderBudget())[0], 'thead')).filter((n) => n.type === 'tr');
  assert.strictEqual(trs.length, 2);
  assert.deepStrictEqual((trs[0].children || []).filter((c) => c.type === 'th').map(textOf),
    ['Opération', 'S5 MARAVILLA | 2 Ha', 'S1 CORINA | 4 Ha']);
  assert.deepStrictEqual((trs[1].children || []).filter((c) => c.type === 'th').map(textOf),
    ['Réalisé | JH/Ha', 'Budget | JH/Ha', '% consommé',
      'Réalisé | JH/Ha', 'Budget | JH/Ha', '% consommé']);

  // Taille : 40 JH / 2 Ha = 20.0 réalisé pour 15.0 budgétés → 40/30 = 133,3 %
  // consommé. CORINA n'a ni réalisé ni budget en Taille : trois « — ».
  assert.deepStrictEqual(sousCellule(rows[2], MARAVILLA_SC), ['20.0', '15.0', '133.3 %']);
  assert.deepStrictEqual(sousCellule(rows[2], CORINA_SC), ['—', '—', '—']);

  // Récolte : le budget vient des OPÉRATIONS (8), pas du niveau famille (12) →
  // 20 JH pour 16 budgétés = 125,0 %. CORINA est réalisée mais non budgétée :
  // ni budget ni taux, jamais 0 %.
  assert.deepStrictEqual(sousCellule(rowsRecolte[1], MARAVILLA_SC), ['10.0', '8.0', '125.0 %']);
  assert.deepStrictEqual(sousCellule(rowsRecolte[1], CORINA_SC), ['3.0', '—', '—']);
});

test('sous-colonnes — famille budgétée jamais travaillée : 0 % consommé, pas « — »', () => {
  // Sans cette ligne, 2 JH/Ha × 4 Ha = 8 JH de budget non consommé seraient
  // parfaitement invisibles. Le taux, lui, vaut bien 0 % : le dénominateur
  // existe (contrairement aux cellules sans budget, qui affichent « — »).
  const rows = bodyRows(tables(renderBudget())[0]);
  assert.deepStrictEqual(sousCellule(rows[1], MARAVILLA_SC), ['—', '—', '—']);
  assert.deepStrictEqual(sousCellule(rows[1], CORINA_SC), ['0.0', '2.0', '0.0 %']);
});

test('sous-colonnes — un taux ne se somme pas : totaux pondérés', () => {
  // Le piège de la série ratio : sommer les pourcentages donnerait 258,3 % sur
  // la ligne Taille + Récolte, et une moyenne simple 129,2 %. Le seul total
  // juste additionne numérateurs et dénominateurs séparément.
  const foot = cells(footRow(tables(renderBudget())[0]));
  // Tableau principal, HORS récolte. MARAVILLA : 40 JH réalisés (Taille) pour
  // 30 budgétés = 133,3 % — soit 20.0 et 15.0 rapportés aux 2 Ha.
  assert.deepStrictEqual(foot.slice(1, 4), ['20.0', '15.0', '133.3 %']);
  // CORINA : seule la Ferti est budgétée (8 JH), jamais travaillée → 0 %.
  assert.deepStrictEqual(foot.slice(4, 7), ['0.0', '2.0', '0.0 %']);
  // Le pied s'arrête là : le grand total (60 / 54 = 111,1 %) vivait dans la
  // colonne Total, retirée de cet écran. La pondération des ratios reste
  // vérifiée ci-dessus (130,4 % agrège deux lignes) et, pour le grand total,
  // par tests/unit/pivotAnalytiqueGrid.test.js.
  assert.strictEqual(foot.length, 7);
});

test('taux — le suffixe « % » et l\'italique PARTOUT où le taux est rendu', () => {
  // Sans suffixe, « 51.6 » coincé entre deux colonnes de JH se lit comme un
  // troisième volume. Le « % » vient du FORMAT de la valeur, pas de `unit` :
  // c'est ce qui le fait apparaître aussi dans les trois agrégats, là où `unit`
  // n'aurait touché que les cellules (et aurait donné « % consommé % » dans la
  // colonne Total).
  const tree = tables(renderBudget())[0];
  const rows = bodyRows(tree);
  const foot = footRow(tree);
  // Le <span> du taux dans un <td> donné (le seul à porter fontStyle italic).
  const taux = (tr, i) => walk((tr.children || []).filter((c) => c.type === 'td')[i])
    .filter((n) => n.type === 'span' && n.props.style && n.props.style.fontStyle === 'italic');

  // Les deux endroits qui restent sur cet écran : la cellule et le total de
  // COLONNE (pied). Le total de ligne et le grand total vivaient dans la
  // colonne Total, retirée ici — ils restent couverts par
  // tests/unit/pivotAnalytiqueGrid.test.js.
  assert.deepStrictEqual(taux(rows[2], 3).map(textOf), ['133.3 %'], 'cellule');
  assert.deepStrictEqual(taux(foot, 3).map(textOf), ['133.3 %'], 'total de colonne');

  // L'italique porte sur la VALEUR, jamais sur l'en-tête de sous-colonne.
  const th = walk(section(tree, 'thead'))
    .filter((n) => n.type === 'th' && textOf(n) === '% consommé')[0];
  assert.strictEqual((th.props.style || {}).fontStyle, undefined);
  // …et le libellé de l'en-tête ne double PAS l'unité (« % consommé % »).
  assert.strictEqual(textOf(th), '% consommé');

  // Les colonnes de VOLUME restent nues : c'est le contraste qui fait lire.
  assert.deepStrictEqual(taux(rows[2], 1), []);
  assert.deepStrictEqual(taux(rows[2], 2), []);
});

test('sous-colonnes — dépassement (> 100 %) signalé en rouge, sans plafonnement', () => {
  const rows = bodyRows(tables(renderBudget())[0]);
  // Rouges UNIQUEMENT : le « — » des valeurs absentes est lui aussi un <span>.
  const rouges = (tr, i) => walk((tr.children || []).filter((c) => c.type === 'td')[i])
    .filter((n) => n.type === 'span' && n.props.style && n.props.style.color === '#c0392b');
  // Taille sur MARAVILLA : 133,3 % → la sous-colonne du taux est rouge.
  assert.deepStrictEqual(rouges(rows[2], 3).map(textOf), ['133.3 %']);
  // …et elle SEULE : réalisé et budget restent neutres.
  assert.deepStrictEqual(rouges(rows[2], 1), []);
  assert.deepStrictEqual(rouges(rows[2], 2), []);
  // Ferti sur CORINA : 0 % → rien de rouge.
  assert.deepStrictEqual(rouges(rows[1], 6), []);
});

test('sous-colonnes — en mode Total, seul le taux ne bouge pas (il est invariant)', () => {
  const rows = bodyRows(tables(renderBudget(null, [true, false, null]))[0]);
  // Budget en JH/Ha × 2 Ha = 30 JH, réalisé 40 JH — et toujours 133,3 %.
  assert.deepStrictEqual(sousCellule(rows[2], MARAVILLA_SC), ['40.0', '30.0', '133.3 %']);
  // Pied de tableau, par colonne : MARAVILLA 60 JH réalisés pour 46 budgétés
  // (30 en Taille + 16 en Récolte, périmètre budgété) = 130,4 % ; CORINA 12 JH
  // réalisés, 8 budgétés en Ferti jamais travaillée → 0 %.
  const foot = cells(footRow(tables(renderBudget(null, [true, false, null]))[0]));
  // Hors récolte : MARAVILLA 40 JH pour 30 budgétés ; CORINA rien de réalisé,
  // 8 JH budgétés en Ferti.
  assert.deepStrictEqual(foot.slice(1, 7), ['40.0', '30.0', '133.3 %', '0.0', '8.0', '0.0 %']);
});

test('budget — culture sans aucun budget : grille inchangée, une seule série', () => {
  // Cas nominal de l'avocatier (jamais budgété) : deux lignes de « — » dans
  // chaque cellule n'apprendraient rien à personne.
  // Myrtille : que de la récolte, donc un seul bloc — le 3e (Framboise en a 2).
  const myrtille = bodyRows(tables(renderBudget())[2]);
  // Une seule parcelle, une seule série, et plus de colonne Total : une seule
  // cellule de valeur, au balisage empilé historique (unité dans la cellule).
  assert.deepStrictEqual(cells(myrtille[1]).slice(1), ['3.0 | JH/Ha']);
});

test('budget — métrique Coût DH : aucune série budget (le budget est en JH/Ha)', () => {
  const grilles = tables(renderBudget({ metric: 'cout' }, [true, false, null]));
  // MÊMES LIGNES qu'en JH — y compris les familles budgétées jamais
  // travaillées (Ferti). C'est ce qui fait exister le bloc récolte en Coût DH :
  // sans elles, une récolte pas encore commencée n'a aucune ligne, et son
  // tableau disparaissait alors qu'il est là en JH.
  assert.deepStrictEqual(bodyRows(grilles[0]).map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Ferti-irrigation', 'Taille']);
  assert.deepStrictEqual(bodyRows(grilles[1]).map((r) => textOf(r).split(' | ')[0]),
    ['M.O Récolte', 'Récolte']);
  assert.strictEqual(cells(bodyRows(grilles[0])[2])[1], nb(6000) + ' | DH');
  // …mais AUCUNE sous-colonne de budget : un budget saisi en JH/Ha n'a pas de
  // traduction en dirhams. Une seule valeur par cellule.
  assert.strictEqual(cells(bodyRows(grilles[0])[2]).length, 3, 'libellé + 2 parcelles');
});

test('budget — mode Détail : le budget descend à la maille opération', () => {
  const grilles = tables(renderBudget(null, [false, true, null]));
  const rows = bodyRows(grilles[0]);
  assert.deepStrictEqual(rows.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Ferti-irrigation', 'Taille', 'Taille longue', 'Taille courte']);
  const rowsRecolte = bodyRows(grilles[1]);
  assert.deepStrictEqual(rowsRecolte.map((r) => textOf(r).split(' | ')[0]),
    ['M.O Récolte', 'Récolte', 'Cueillette']);
  // L'opération budgétée porte son budget, et son taux de consommation.
  assert.deepStrictEqual(sousCellule(rowsRecolte[2], MARAVILLA_SC), ['10.0', '8.0', '125.0 %']);
  // …et les opérations d'une famille budgétée AU NIVEAU FAMILLE n'héritent de
  // rien : le budget de Taille reste sur sa ligne famille, il n'est pas
  // réparti au jugé entre « Taille longue » et « Taille courte » — donc aucun
  // taux non plus (pas de budget sur la ligne = pas de dénominateur).
  assert.deepStrictEqual(sousCellule(rows[3], MARAVILLA_SC), ['15.0', '—', '—']);
});

test('budget — colonne entièrement non budgétée : totaux « — », jamais 0.0', () => {
  // Seule la Taille de MARAVILLA est budgétée. La colonne CORINA (aucune
  // famille budgétée) doit donc dire « — », pas « 0.0 » — qui se lirait
  // « budget nul, dépassement total » puis « pile dans le budget ».
  // (Le total de LIGNE, même règle, vivait dans la colonne Total retirée ici :
  // il reste couvert par tests/unit/pivotAnalytiqueGrid.test.js.)
  const foot = cells(footRow(tables(renderBudget(
    { budgetsByLabel: { 'F1- S5 MARAVILLA': { 'Taille': 15 } }, opBudgetsByLabel: {} },
    [true, false, null]
  ))[0]));
  // Tableau principal, hors récolte : MARAVILLA 40 JH pour 30 budgétés ;
  // CORINA n'a rien hors récolte et rien de budgété → trois « — ».
  assert.deepStrictEqual(foot, [
    'TOTAL',
    '40.0', '30.0', '133.3 %',
    '—', '—', '—',
  ]);
});

test('budget — le PÉRIMÈTRE BUDGÉTÉ reste énoncé sous la grille', () => {
  // Un taux de 133 % sur une ligne dont la moitié des familles n'est pas
  // budgétée se lit comme une erreur de calcul si le périmètre n'est pas dit.
  // Il l'était à deux endroits : la légende sous la grille et le `title` de
  // l'en-tête Total. Cette colonne ayant quitté l'écran, la LÉGENDE devient le
  // seul porteur — elle ne peut donc pas disparaître avec elle.
  const tree = renderBudget();
  assert.match(textOf(tree), /périmètre budgété uniquement/);
  assert.match(textOf(tree), /« % consommé » = Réalisé \/ Budget sur ce seul périmètre/);
  assert.strictEqual(walk(section(tables(tree)[0], 'thead'))
    .filter((n) => n.type === 'th' && textOf(n) === 'Total').length, 0);
  // Culture sans budget (Myrtille) : ni légende ni title — rien à expliquer.
  assert.strictEqual(textOf(renderBudget({ cultureFilter: 'Myrtille' }))
    .indexOf('périmètre budgété'), -1);
});

test('budget — campagneRythme absent : la grille annuelle est inchangée', () => {
  // Les séries de projection ont quitté la grille : ce module n'est plus lu que
  // pour l'avancement de la campagne. Son absence ne doit donc plus rien
  // retirer aux trois sous-colonnes.
  const TabSansRythme = loadTab({ budget: true, rythme: false });
  const rows = bodyRows(tables(render({
    budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS, refOperations: REF_OPS,
  }, null, TabSansRythme))[0]);
  assert.deepStrictEqual(sousCellule(rows[2], MARAVILLA_SC), ['20.0', '15.0', '133.3 %']);
});

test('budget — une cellule créée par le seul budget n\'ouvre pas de pop-up vide', () => {
  // Ferti-irrigation sur CORINA : aucun pointage, donc aucun détail à afficher.
  const rows = bodyRows(tables(renderBudget())[0]);
  const tds = (rows[1].children || []).filter((c) => c.type === 'td');
  assert.strictEqual(tds[2].props.onClick, undefined);
  // La cellule réalisée voisine, elle, reste cliquable.
  assert.strictEqual(typeof (bodyRows(tables(renderBudget())[0])[2].children || [])
    .filter((c) => c.type === 'td')[1].props.onClick, 'function');
});

test('budget — module non chargé : réalisé seul, jamais de grille cassée', () => {
  // `Tab` est chargé SANS campagneBudgetPivot ni CampagneBudgetTab.
  const grilles = tables(render({ budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS }));
  assert.deepStrictEqual(bodyRows(grilles[0]).map((r) => textOf(r).split(' | ')[0]),
    ['M.O Hors récolte', 'Taille']);
  // La récolte reste servie dans son bloc : dégrader le budget ne doit pas
  // faire disparaître des lignes de réalisé.
  assert.deepStrictEqual(bodyRows(grilles[1]).map((r) => textOf(r).split(' | ')[0]),
    ['M.O Récolte', 'Récolte']);
  assert.deepStrictEqual(cells(bodyRows(grilles[0])[1]).slice(1, 3), ['20.0 | JH/Ha', '—']);
});

// ---------------------------------------------------------------- plein écran
//
// États injectés par POSITION : [totalMode, detailMode, detailCell,
// vueQuinzaine, quinzaineSel, fullscreen, cultureIdx].
//
// L'état vit ICI (et non chez le parent comme dans AffectationAnalytiqueTable) :
// CampagneAnalytiqueTab ne repasse par ses early-returns qu'au montage, il ne
// démonte donc pas PivotView en cours d'usage.

/** Boutons portant une icône Font Awesome donnée (fa-expand, fa-chevron-left…). */
function boutons(tree, icone) {
  return walk(tree).filter((n) => n.type === 'button'
    && walk(n).some((c) => c.type === 'i' && (c.props.className || '').indexOf(icone) >= 0));
}

test('plein écran — un bouton par grille de culture, qui ouvre CETTE culture', () => {
  const tree = render();
  const btns = boutons(tree, 'fa-expand');
  assert.strictEqual(btns.length, 2, 'un bouton par grille (Framboise, Myrtille)');
  // Hors plein écran, aucun carrousel : les deux grilles sont déjà affichées.
  assert.strictEqual(boutons(tree, 'fa-chevron-right').length, 0);

  // Clic sur le bouton de la 2e grille : c'est la MYRTILLE qui s'ouvre, pas
  // « la première culture ».
  setterCalls = [];
  btns[1].props.onClick();
  assert.deepStrictEqual(plain(setterCalls), [1, true], '[setCultureIdx(1), setFullscreen(true)]');
});

test('plein écran — une seule culture affichée, sur un overlay, avec le carrousel', () => {
  const tree = render(null, [false, false, null, false, '', true, 1]);
  // La Myrtille de la fixture n'a QUE de la récolte : un seul bloc, le sien —
  // surtout pas un tableau principal vide au-dessus (cf. `aPrincipal`).
  assert.strictEqual(tables(tree).length, 1, 'la culture choisie, et elle seule');
  assert.ok(textOf(tables(tree)[0]).indexOf('S9 BLUE') >= 0, 'Myrtille');
  assert.match(textOf(tree), /Myrtille — récolte/);
  // Overlay plein écran.
  assert.strictEqual(tree.props.style.position, 'fixed');
  assert.strictEqual(tree.props.style.zIndex, 9999);
  // Carrousel : deux chevrons + une pastille par culture.
  assert.strictEqual(boutons(tree, 'fa-chevron-left').length, 1);
  assert.strictEqual(boutons(tree, 'fa-chevron-right').length, 1);
  // Le bouton de la grille bascule en « quitter ».
  assert.strictEqual(boutons(tree, 'fa-expand').length, 0);
  const sortie = boutons(tree, 'fa-compress');
  assert.strictEqual(sortie.length, 1);
  setterCalls = [];
  sortie[0].props.onClick();
  assert.deepStrictEqual(plain(setterCalls), [false], 'setFullscreen(false)');
});

test('plein écran — les chevrons bouclent sur la liste des cultures', () => {
  // Sur la dernière culture (index 1 sur 2) : « suivant » revient à 0.
  const derniere = render(null, [false, false, null, false, '', true, 1]);
  setterCalls = [];
  boutons(derniere, 'fa-chevron-right')[0].props.onClick();
  assert.deepStrictEqual(plain(setterCalls), [0]);

  // Sur la première : « précédent » va à la dernière.
  const premiere = render(null, [false, false, null, false, '', true, 0]);
  setterCalls = [];
  boutons(premiere, 'fa-chevron-left')[0].props.onClick();
  assert.deepStrictEqual(plain(setterCalls), [1]);
});

test('plein écran — un index hors bornes retombe sur la 1re grille, pas sur du vide', () => {
  // Cas réel : on ouvre l'Avocatier en plein écran puis le filtre Culture
  // réduit la liste. Un index périmé afficherait un écran blanc.
  const tree = render(null, [false, false, null, false, '', true, 7]);
  // Framboise : deux blocs depuis que la récolte est sortie du tableau
  // principal (hors récolte + récolte), et non ceux d'une autre culture.
  assert.strictEqual(tables(tree).length, 2);
  assert.ok(textOf(tables(tree)[0]).indexOf('S5 MARAVILLA') >= 0, 'Framboise');
  // La parcelle de Myrtille, elle, n'est nulle part (seul son nom apparaît, sur
  // la pastille du carrousel).
  assert.strictEqual(textOf(tables(tree)[0]).indexOf('S9 BLUE'), -1);
});

test('plein écran — hors plein écran, aucun overlay et toutes les grilles', () => {
  const tree = render();
  assert.strictEqual(tree.props.style, null);
  // Framboise (hors récolte + récolte) + Myrtille (récolte seule) : la récolte
  // est visible hors plein écran aussi.
  assert.strictEqual(tables(tree).length, 3);
});

// ── Colonne TOTAL : plein écran ET plusieurs séries, jamais autrement ────────
//
// Hors plein écran, plusieurs cultures sont empilées sur une largeur contrainte
// et la colonne manquerait de place. À UNE SEULE série (JH ou Coût seul), elle
// n'ajouterait qu'une colonne à un tableau déjà lisible. Elle ne revient donc
// qu'en plein écran multi-séries — et là, éclatée comme le reste de la grille.

/** L'en-tête de niveau 1 de la colonne Total (« TOTAL | <x> Ha »), ou undefined. */
function theadTotal(table) {
  return walk(section(table, 'thead'))
    .filter((n) => n.type === 'th' && /^TOTAL\b/.test(textOf(n)))[0];
}

test('Total — plein écran à UNE SEULE série : toujours aucune colonne Total', () => {
  // Framboise sans budget : la grille n'a qu'une série (Réalisé JH/Ha).
  const table = tables(render(null, [false, false, null, false, '', true, 0]))[0];
  assert.strictEqual(theadTotal(table), undefined, 'en-tête');
  assert.strictEqual(headers(table).indexOf('Total'), -1, 'en-tête historique');
  // Largeur : le libellé + 2 parcelles × 1 série, et rien de plus.
  const largeur = (bodyRows(table)[1].children || []).filter((c) => c.type === 'td').length;
  assert.strictEqual(largeur, 3);
  // Bandeau de section CHIFFRÉ en plein écran : il n'a plus de colSpan, il
  // occupe exactement les mêmes colonnes qu'une ligne famille.
  const bandeau = (bodyRows(table)[0].children || []).filter((c) => c.type === 'td');
  assert.strictEqual(bandeau[0].props.colSpan, undefined);
  assert.strictEqual(bandeau.length, largeur, 'bandeau aligné sur les lignes');
});

// En plein écran s'ajoute la colonne TOTAL — trois séries de plus à droite des
// parcelles. Le « budget idéal », lui, n'est PAS une colonne : c'est un repère
// de page (cf. plus bas), la même valeur pour toutes les lignes.
const TOTAL_SC = [7, 10];

test('Total — plein écran multi-séries : une sous-colonne par indicateur, à droite', () => {
  const table = tables(renderBudget(null, [false, false, null, false, '', true, 0]))[0];
  // En-tête de niveau 1 : la surface totale de la culture (2 + 4 Ha).
  assert.strictEqual(textOf(theadTotal(table)), 'TOTAL | 6 Ha');
  assert.strictEqual(theadTotal(table).props.colSpan, 3);
  // Non sticky : la colonne défile avec le tableau.
  assert.strictEqual(theadTotal(table).props.style.position, undefined);
  // Niveau 2 : les mêmes quatre séries que sous une parcelle.
  const trs = walk(section(table, 'thead')).filter((n) => n.type === 'tr');
  const niveau2 = (trs[1].children || []).filter((c) => c.type === 'th').map(textOf);
  assert.strictEqual(niveau2.length, (2 + 1) * 3, '(2 parcelles + Total) × 3 séries');
  assert.deepStrictEqual(niveau2.slice(6),
    ['Réalisé | JH/Ha', 'Budget | JH/Ha', '% consommé']);

  // Ligne famille : libellé + 2 parcelles × 3 + les 3 sous-colonnes du Total,
  // et le bandeau de groupe occupe exactement les mêmes colonnes.
  const taille = (bodyRows(table)[2].children || []).filter((c) => c.type === 'td');
  assert.strictEqual(taille.length, 1 + (2 + 1) * 3);
  const bandeau = (bodyRows(table)[0].children || []).filter((c) => c.type === 'td');
  assert.strictEqual(bandeau[0].props.colSpan, undefined, 'bandeau chiffré');
  assert.strictEqual(bandeau.length, taille.length);
  // Aucune sous-colonne collée à droite.
  taille.slice(7).forEach((td, i) => {
    assert.strictEqual(td.props.style.position, undefined, 'sous-colonne ' + i);
  });
  // Taille : 40 JH réalisés (MARAVILLA seule) et 30 JH budgétés (15 × 2 Ha),
  // rapportés aux 6 Ha de la CULTURE — c'est le sens d'un total de ligne « par
  // Ha » : 40/6 = 6.7 et 30/6 = 5.0. Le taux, lui, est invariant : 40/30.
  assert.deepStrictEqual(cells(bodyRows(table)[2]).slice(7, 10), ['6.7', '5.0', '133.3 %']);
  // Grand total du pied — la RÉCOLTE N'Y EST PLUS (elle a son propre bloc en
  // dessous) : 40 JH réalisés / 6 Ha = 6.7 ; budget 30 (Taille) + 8 (Ferti
  // CORINA) = 38 / 6 = 6.3 ; taux 40/38 = 105,3 %. C'est tout l'objet de la
  // séparation : avec la Récolte dedans, ce taux tombait à 111 % d'un budget
  // gonflé par une saison pas encore commencée.
  assert.deepStrictEqual(cells(footRow(table)).slice(7, 10), ['6.7', '6.3', '105.3 %']);
});

test('récolte — un bloc à part, avec les MÊMES colonnes que le tableau principal', () => {
  const tree = renderBudget(null, [false, false, null, false, '', true, 0]);
  const grilles = tables(tree);
  assert.strictEqual(grilles.length, 2, 'hors récolte + récolte');
  const principal = grilles[0];
  const recolte = grilles[1];
  // Le tableau principal ne contient plus une seule ligne de récolte…
  assert.strictEqual(textOf(principal).indexOf('Récolte'), -1);
  // …et le bloc du dessous ne contient QUE ça.
  assert.match(textOf(recolte), /Récolte/);
  assert.strictEqual(textOf(recolte).indexOf('Taille'), -1);
  // Mêmes parcelles, mêmes séries : les deux blocs se lisent en vis-à-vis.
  assert.deepStrictEqual(headers(recolte), headers(principal));
  // Et le lecteur sait POURQUOI il y a deux blocs (la légende est sous la
  // table, pas dedans).
  assert.match(textOf(tree), /Récolte présentée à part/);
  // Le bandeau de section porte les mêmes chiffres que la seule famille qu'il
  // coiffe — c'est la garantie qu'un bandeau ne peut pas mentir sur ses lignes.
  assert.deepStrictEqual(cells(bodyRows(recolte)[0]).slice(1, 5),
    cells(bodyRows(recolte)[1]).slice(1, 5));
});

test('Total — plein écran multi-séries : la colonne reste APRÈS les parcelles', () => {
  // `_pag_paint` repère les sous-colonnes d'une cellule depuis la GAUCHE : une
  // colonne Total glissée avant les parcelles décalerait tout le survol.
  const table = tables(renderBudget(null, [false, false, null, false, '', true, 0]))[0];
  // Sous-colonnes de MARAVILLA (1..3) et de CORINA (4..6), inchangées : le
  // Total vient APRÈS elles, jamais avant.
  assert.deepStrictEqual(sousCellule(bodyRows(table)[2], MARAVILLA_SC),
    ['20.0', '15.0', '133.3 %']);
  assert.deepStrictEqual(sousCellule(bodyRows(table)[2], CORINA_SC), ['—', '—', '—']);
});

// ------------------------------------------------- BUDGET IDÉAL (repère de page)
//
// Part de la campagne écoulée à ce jour. La valeur dépend de la DATE DU JOUR :
// les tests n'en vérifient que la forme et les invariants, jamais un nombre
// figé qui périmerait demain.

const PCT = /^\d+\.\d %$/;

test('budget idéal — un repère en haut de page, et AUCUNE colonne', () => {
  const tree = renderBudget(null, [false, false, null, false, '', true, 0]);
  // Le libellé et sa valeur, une seule fois dans tout l'écran.
  assert.match(textOf(tree), /% Budget idéal à ce jour/);
  const valeurs = textOf(tree).split(' | ').filter((t) => PCT.test(t));
  assert.ok(valeurs.length > 0, 'une valeur en pourcentage');
  // …et pas une seule sous-colonne : la grille garde ses trois séries.
  tables(tree).forEach((table) => {
    assert.strictEqual(textOf(table).indexOf('Budget idéal'), -1);
    const trs = walk(section(table, 'thead')).filter((n) => n.type === 'tr');
    const niveau2 = (trs[1].children || []).filter((c) => c.type === 'th').map(textOf);
    assert.strictEqual(niveau2.length, (2 + 1) * 3);
  });
});

test('budget idéal — le repère est là AUSSI hors plein écran', () => {
  // Il ne coûte aucune largeur de colonne : rien ne justifie de le réserver au
  // plein écran, contrairement à la colonne Total.
  assert.match(textOf(renderBudget()), /% Budget idéal à ce jour/);
});

test('budget idéal — le décompte de jours accompagne le pourcentage', () => {
  const tree = renderBudget(null, [false, false, null, false, '', true, 0]);
  assert.match(textOf(tree), /\d+ j \/ 365/);
  // La légende de la grille, elle, ne parle plus que du périmètre budgété.
  assert.match(textOf(tree), /périmètre budgété uniquement/);
});

test('budget idéal — campagne illisible : aucun repère, jamais un 0 % trompeur', () => {
  const tree = renderBudget(
    { data: Object.assign({}, DATA, { campagne: 'n/a' }) },
    [false, false, null, false, '', true, 0]
  );
  assert.strictEqual(textOf(tree).indexOf('% Budget idéal à ce jour'), -1);
});

test('budget idéal — CampagneUtils absent : écran inchangé, jamais cassé', () => {
  // La frontière du 1er juillet n'a qu'UNE source ; sans elle, pas de repère.
  const TabSansCU = loadTab({ budget: true, campagneUtils: false });
  const tree = render({
    budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS, refOperations: REF_OPS,
  }, [false, false, null, false, '', true, 0], TabSansCU);
  assert.strictEqual(textOf(tree).indexOf('% Budget idéal à ce jour'), -1);
  assert.deepStrictEqual(sousCellule(bodyRows(tables(tree)[0])[2], MARAVILLA_SC),
    ['20.0', '15.0', '133.3 %']);
});

test('grille — sélection vide : message, jamais une table fantôme', () => {
  const tree = render({ cultureFilter: 'Avocatier' });
  assert.strictEqual(tables(tree).length, 0);
  assert.ok(textOf(tree).indexOf('Aucune donnée pour cette sélection.') >= 0);
});

// ------------------------------------------------- CADENCE DE RÉCOLTE (Kg/JH)
//
// Ligne de pied du bloc récolte : des kilos rapportés à des journées-homme. Ce
// n'est ni une série (la grille les agrège) ni une ligne famille (elle entrerait
// dans le total) — d'où `piedsSupplementaires`.

const BONS_RECOLTE = [
  // « Parcelle / Bloc » du bon = intitulé de la colonne (cas réel, cf.
  // campagneProduction.test.js). 360 kg pour 20 JH de récolte = 18.0 kg/JH,
  // soit EXACTEMENT le barème framboise → 100 %.
  { poidsLot: 360, dateISO: '2026-07-15', typeVente: 'Export', designation: 'F1- S5 MARAVILLA' },
];

test('cadence — Kg/JH en pied du bloc récolte, en regard du barème de la culture', () => {
  const grilles = tables(renderBudget({ bons: BONS_RECOLTE }));
  const piedRows = walk(section(grilles[1], 'tfoot')).filter((n) => n.type === 'tr');
  assert.strictEqual(piedRows.length, 2, 'TOTAL RÉCOLTE + la cadence');
  assert.strictEqual(cells(piedRows[0])[0], 'TOTAL RÉCOLTE',
    'un second « TOTAL » se lirait comme le total général de l\'écran');
  const cadence = cells(piedRows[1]);
  assert.strictEqual(cadence[0], 'Kg / JH');
  // MARAVILLA : 360 kg / 20 JH = 18.0, barème framboise 18.0 → 100,0 %.
  assert.deepStrictEqual(cadence.slice(1, 4), ['18.0', '18.0', '100.0 %']);
  // CORINA : de la récolte pointée (12 JH) mais aucun kilo rattaché → le barème
  // reste affiché, la cadence non. Un 0.0 accuserait l'équipe d'un défaut de
  // rattachement des bons.
  assert.deepStrictEqual(cadence.slice(4, 7), ['—', '18.0', '—']);
});

test('cadence — au-delà du barème, le taux n\'est PAS une alerte', () => {
  // Le « % consommé » d'un budget vire au rouge au-delà de 100 % : on a dépensé
  // plus que prévu. Ici c'est l'inverse — dépasser le barème, c'est récolter
  // plus vite. Le rouge y serait un contresens.
  const grilles = tables(renderBudget({
    bons: [Object.assign({}, BONS_RECOLTE[0], { poidsLot: 400 })],
  }));
  const cadence = walk(section(grilles[1], 'tfoot')).filter((n) => n.type === 'tr')[1];
  const spans = walk(cadence).filter((n) => n.type === 'span' && n.props.style);
  const rouges = spans.filter((n) => n.props.style.color === '#c0392b');
  assert.strictEqual(rouges.length, 0, 'jamais de rouge sur une bonne nouvelle');
  // 400 / 20 = 20 kg/JH pour un barème de 18 → 111,1 %, en vert.
  const verts = spans.filter((n) => n.props.style.color === '#2e7d32').map(textOf);
  assert.ok(verts.indexOf('111.1 %') >= 0, 'cadence au-dessus du barème, en vert');
});

test('cadence — aucun bon : le pied du bloc récolte reste seul', () => {
  // Début de campagne (le cas d'aujourd'hui) : pas de kilos, donc pas de ligne
  // de cadence inventée sous le total.
  const grilles = tables(renderBudget({ bons: [] }));
  const piedRows = walk(section(grilles[1], 'tfoot')).filter((n) => n.type === 'tr');
  assert.strictEqual(piedRows.length, 2, 'la ligne existe, avec le barème…');
  assert.deepStrictEqual(cells(piedRows[1]).slice(1, 4), ['—', '18.0', '—']);
  // …et sans le module de calcul, elle disparaît purement et simplement.
  const TabSansProd = loadTab({ production: false, budget: true });
  const sansProd = tables(render({
    bons: [], budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS, refOperations: REF_OPS,
  }, null, TabSansProd))[1];
  assert.strictEqual(
    walk(section(sansProd, 'tfoot')).filter((n) => n.type === 'tr').length, 1);
});

test('récolte — son bloc est là AUSSI hors plein écran et en Coût DH', () => {
  // Sortir la récolte change le sens du TOTAL (il devient le total HORS
  // récolte) : ce sens ne peut dépendre ni du bouton plein écran, ni de la
  // bascule JH / Coût DH.
  [{}, { metric: 'cout' }].forEach((props) => {
    const grilles = tables(render(props));
    assert.strictEqual(grilles.length, 3, JSON.stringify(props));
    assert.match(textOf(grilles[1]), /Récolte/);
    assert.strictEqual(cells(footRow(grilles[1]))[0], 'TOTAL RÉCOLTE');
  });
});

test('rendement — en Coût DH, l\'indicateur devient DH / kg (pas la cadence)', () => {
  // Une cadence en kg/JH sous une colonne de dirhams n'a aucun sens : en Coût
  // DH, la question n'est plus « à quelle vitesse récolte-t-on ? » mais
  // « combien nous coûte ce kilo ? ».
  const grilles = tables(render({ metric: 'cout', bons: BONS_RECOLTE }));
  const piedRows = walk(section(grilles[1], 'tfoot')).filter((n) => n.type === 'tr');
  assert.strictEqual(piedRows.length, 2);
  assert.strictEqual(cells(piedRows[0])[0], 'TOTAL RÉCOLTE');
  const ligne = cells(piedRows[1]);
  assert.strictEqual(ligne[0], 'DH / kg');
  // MARAVILLA : 3 000 DH de récolte pour 360 kg rattachés = 8,33 DH/kg.
  assert.strictEqual(ligne[1], '8,33');
  // CORINA : de la récolte (2 400 DH) mais aucun kilo rattaché → « — », jamais
  // un 0 (ni gratuit, ni infiniment cher).
  assert.strictEqual(ligne[2], '—');
});

// ─────────────────────────────────── COÛT OUVRIER CHARGÉ (budget en dirhams)
//
// Le budget est saisi en JH/Ha. En Coût DH il est valorisé au coût CHARGÉ d'une
// journée d'ouvrier (brut + CNSS patronale + transport), servi par l'action
// backend `campagne-cout-ouvrier`.

const COUT_OUVRIER = {
  success: true, campagne: '2026/2027', coutMoyenJour: 200, jours: 1200,
  ouvriers: 80, quinzaines: 3, coutTotal: 240000, partDeclares: 0.75,
  detail: {
    base: 118000, primeFonction: 9000, primeAnciennete: 5000, heuresSup: 2000,
    feries: 3000, chargesPatronales: 26000, cotisationsSalariales: 9100,
    transport: 36000, recolte: 30000, traitement: 4000,
    conditionnement: 4000, chargement: 3000,
  },
  // 240 000 de coût total pour 118 000 de base : un dirham de salaire de base
  // en coûte 2,034 à l'entreprise, primes et charges comprises.
  facteurCharge: 240000 / 118000,
};

test('coût ouvrier — en Coût DH, le budget est valorisé au coût chargé', () => {
  const grilles = tables(renderBudget(
    { metric: 'cout', coutOuvrier: COUT_OUVRIER }, [true, false, null]
  ));
  const trs = walk(section(grilles[0], 'thead')).filter((n) => n.type === 'tr');
  const niveau2 = (trs[1].children || []).filter((c) => c.type === 'th').map(textOf);
  // « Coût CHARGÉ » et non « Coût » : la colonne ne montre plus la base nue de
  // BEE ONE, et le libellé doit le dire.
  assert.deepStrictEqual(niveau2.slice(0, 3), ['Coût chargé | DH', 'Budget | DH', '% consommé']);

  // Taille sur MARAVILLA : budget 15 JH/Ha × 2 Ha × 200 DH = 6 000 DH.
  // Réalisé BEE ONE 6 000 DH, MAJORÉ du facteur de charge (×2,034) = 12 203.
  // Le taux passe donc à 203,4 % — et c'est le point : sans majoration il
  // affichait 100 % alors que la dépense réelle double le budget.
  const facteur = COUT_OUVRIER.facteurCharge;
  const taille = cells(bodyRows(grilles[0])[2]);
  assert.deepStrictEqual(taille.slice(1, 3), [nb(Math.round(6000 * facteur)), nb(6000)]);
  assert.strictEqual(taille[3], (Math.round(facteur * 1000) / 10).toFixed(1) + ' %');

  // Le taux en DH doit valoir celui en JH : même effort, même budget.
  const enJh = cells(bodyRows(tables(renderBudget({ coutOuvrier: COUT_OUVRIER },
    [true, false, null]))[0])[2]);
  assert.notStrictEqual(enJh[3], undefined);
});

test('coût ouvrier — indisponible : aucun budget en DH, jamais un budget nul', () => {
  // Un budget à 0 afficherait « dépassement infini » sur chaque ligne.
  [null, { success: true, coutMoyenJour: null }, { success: true, coutMoyenJour: 0 }]
    .forEach((cout) => {
      const table = tables(renderBudget({ metric: 'cout', coutOuvrier: cout }, [true, false, null]))[0];
      const trs = walk(section(table, 'thead')).filter((n) => n.type === 'tr');
      assert.strictEqual(trs.length, 1, 'une seule ligne d\'en-tête = une seule série');
      assert.strictEqual(textOf(table).indexOf('Budget'), -1);
    });
});

test('coût ouvrier — le repère de page annonce le chiffre et son détail', () => {
  const tree = renderBudget({ metric: 'cout', coutOuvrier: COUT_OUVRIER }, [true, false, null]);
  assert.match(textOf(tree), /Coût ouvrier chargé/);
  assert.match(textOf(tree), new RegExp(nb(200) + ' DH'));
  // Le détail est en infobulle : afficher un coût sans permettre de le
  // contester, c'est demander de le croire sur parole.
  const badge = walk(tree).filter((n) => n.props && typeof n.props.title === 'string'
    && n.props.title.indexOf('Coût CHARGÉ') >= 0);
  assert.strictEqual(badge.length, 1);
  const aide = badge[0].props.title;
  // Chaque terme de la formule validée est nommé, dans l'ordre : un coût moyen
  // sans sa décomposition ne se conteste pas, il se croit.
  ['base BEE ONE', 'prime de fonction', 'ancienneté', 'heures sup', 'jours fériés',
    'patronales', 'CNSS + AMO salariales', 'transport', 'récolte', 'traitement',
    'conditionnement', 'chargement']
    .forEach((terme) => assert.ok(aide.indexOf(terme) >= 0, 'terme manquant : ' + terme));
  assert.match(aide, /journées pointées/);
  assert.match(aide, /Hors pointage divers/);
  // Un terme à zéro ne s'affiche pas : une ligne « récolte 0 DH » hors saison
  // ferait croire à une prime perdue.
  const sansRecolte = renderBudget({ metric: 'cout', coutOuvrier: Object.assign({}, COUT_OUVRIER,
    { detail: Object.assign({}, COUT_OUVRIER.detail, { recolte: 0 }) }) }, [true, false, null]);
  const aide2 = walk(sansRecolte).filter((n) => n.props && typeof n.props.title === 'string'
    && n.props.title.indexOf('Coût CHARGÉ') >= 0)[0].props.title;
  assert.strictEqual(aide2.indexOf('· récolte'), -1);
});

test('coût ouvrier — en JH, le budget reste en JH (aucune valorisation)', () => {
  const table = tables(renderBudget({ coutOuvrier: COUT_OUVRIER }))[0];
  const trs = walk(section(table, 'thead')).filter((n) => n.type === 'tr');
  const niveau2 = (trs[1].children || []).filter((c) => c.type === 'th').map(textOf);
  assert.deepStrictEqual(niveau2.slice(0, 3),
    ['Réalisé | JH/Ha', 'Budget | JH/Ha', '% consommé']);
});

test('rapprochement — le panneau affiche l\'écart entre pointage et grille', () => {
  // Contrôle de couverture : la grille agrège PAR PARCELLE, le coût ouvrier
  // part du pointage brut. L'écart mesure ce que la grille ne voit pas.
  const cout = Object.assign({}, COUT_OUVRIER, {
    parQuinzaine: [
      { periode: 'Quinzaine 01', jours: 100, base: 10000, primes: 3000, charges: 2000, coutTotal: 15000 },
    ],
  });
  const tree = render({ coutOuvrier: cout });
  assert.match(textOf(tree), /Rapprochement pointage ↔ grille/);
  assert.match(textOf(tree), /Quinzaine 01/);
  // Le pointage annonce 10 000 de base ; la grille (fixture) en montre bien
  // moins → l'écart doit être affiché, pas masqué.
  assert.match(textOf(tree), /écart total/);
});

test('rapprochement — absent en plein écran, et sans données de coût', () => {
  // En plein écran on vient lire une culture, pas auditer un périmètre.
  const plein = render({ coutOuvrier: Object.assign({}, COUT_OUVRIER, {
    parQuinzaine: [{ periode: 'Q01', jours: 1, base: 100, primes: 0, charges: 0, coutTotal: 100 }],
  }) }, [false, false, null, false, '', true, 0]);
  assert.strictEqual(textOf(plein).indexOf('Rapprochement pointage'), -1);
  // Et sans détail par quinzaine, aucun panneau : rien à rapprocher.
  assert.strictEqual(textOf(render({ coutOuvrier: COUT_OUVRIER }))
    .indexOf('Rapprochement pointage'), -1);
  // Module absent : pas de panneau non plus. Un écart affiché à zéro faute de
  // calcul se lirait « tout est rapproché » — le pire des messages.
  const TabSansRap = loadTab({ rapprochement: false });
  const sansRap = render({ coutOuvrier: Object.assign({}, COUT_OUVRIER, {
    parQuinzaine: [{ periode: 'Q01', jours: 1, base: 100, primes: 0, charges: 0, coutTotal: 100 }],
  }) }, null, TabSansRap);
  assert.strictEqual(textOf(sansRap).indexOf('Rapprochement pointage'), -1);
});
