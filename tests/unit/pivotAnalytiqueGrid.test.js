'use strict';

// Tests de la grille de présentation public/components/PivotAnalytiqueGrid.jsx.
//
// L'iso-comportement du panneau Affectation Analytique est couvert ailleurs
// (tests/unit/affectationAnalytiqueTable.test.js, écrit AVANT l'extraction).
// CE fichier couvre ce que la grille sait faire EN PLUS : plusieurs séries, et
// le sens de conversion par série (`basis` = ce que vaut la valeur brute,
// `display` = ce qu'on affiche). C'est le point dur du chantier : le réalisé est
// un total par cellule, le budget est déjà en JH/Ha — la conversion s'inverse
// selon la série.
//
// ⚠️ Depuis le lot « sous-colonnes », plusieurs séries ⇒ une COLONNE par série
// sous l'en-tête de la parcelle (et non plus un empilement dans une cellule
// unique). Les assertions ci-dessous lisent donc K <td> par parcelle, dans
// l'ordre des `metrics` — sauf dans la colonne Total, seule colonne où les
// séries restent empilées (elle est sticky-right, cf. le composant).

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
function tds(tr) { return (tr.children || []).filter(function (c) { return c && c.type === 'td'; }); }
/** <th> de l'en-tête, tous niveaux confondus (1er <tr> puis 2e). */
function headerThs(tree) {
  return walk(section(tree, 'thead')).filter(function (n) { return n.type === 'th'; });
}
/** L'en-tête de la colonne Total, où qu'il soit dans l'arbre. */
function totalTh(tree) {
  return headerThs(tree).filter(function (n) { return textOf(n) === 'Total'; })[0];
}

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
  // 2 séries × 2 parcelles = 4 sous-colonnes : réalisé divisé par le Ha,
  // budget affiché brut, dans les deux colonnes.
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1, 5),
    ['5.0', '6.0', '5.0', '4.0']);
});

test('metrics — trois séries réalisé / budget / écart en sous-colonnes', () => {
  const tree = render(troisSeries('perHa'));
  // P2 : réalisé 5.0, budget 6.0, écart (10 − 6×2) / 2 = −1.0 (sous-consommé).
  // P4 : réalisé 5.0, budget 4.0, écart (20 − 4×4) / 4 = +1.0 (dépassement).
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1, 7),
    ['5.0', '6.0', '-1.0', '5.0', '4.0', '+1.0']);
  // Total de ligne : réalisé 30/6 = 5.0 ; budget (12+16)/6 = 4.67 ; écart 2/6 = 0.3.
  // Seule colonne où les séries restent EMPILÉES, libellé compris.
  assert.strictEqual(cells(bodyRows(tree)[1])[7],
    '5.0 | Réalisé JH/Ha | 4.7 | Budget JH/Ha | +0.3 | Écart JH/Ha');
});

test('metrics — en mode Total les trois séries suivent, sans règle codée en dur', () => {
  const tree = render(troisSeries('total'));
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1, 7),
    ['10.0', '12.0', '-2.0', '20.0', '16.0', '+4.0']);
  assert.deepStrictEqual(cells(footRow(tree)),
    ['TOTAL', '10.0', '12.0', '-2.0', '20.0', '16.0', '+4.0',
      '30.0 | Réalisé JH | 28.0 | Budget JH | +2.0 | Écart JH']);
});

test('sous-colonnes — en-tête à DEUX niveaux : parcelle puis série', () => {
  const tree = render(troisSeries('perHa'));
  const trs = walk(section(tree, 'thead')).filter((n) => n.type === 'tr');
  assert.strictEqual(trs.length, 2);

  // Niveau 1 : libellé (rowSpan 2), une parcelle par colSpan de 3, Total
  // (rowSpan 2) — la colonne Total n'est JAMAIS éclatée (sticky-right).
  const niveau1 = (trs[0].children || []).filter((c) => c.type === 'th');
  assert.deepStrictEqual(niveau1.map(textOf), ['Opération', 'P2 | 2 Ha', 'P4 | 4 Ha', 'Total']);
  assert.strictEqual(niveau1[0].props.rowSpan, 2);
  assert.strictEqual(niveau1[1].props.colSpan, 3);
  assert.strictEqual(niveau1[2].props.colSpan, 3);
  assert.strictEqual(niveau1[3].props.rowSpan, 2);

  // Niveau 2 : le `label` de chaque série, une fois par parcelle — et plus
  // jamais répété dans les cellules.
  const niveau2 = (trs[1].children || []).filter((c) => c.type === 'th');
  assert.deepStrictEqual(niveau2.map(textOf), [
    'Réalisé | JH/Ha', 'Budget | JH/Ha', 'Écart | JH/Ha',
    'Réalisé | JH/Ha', 'Budget | JH/Ha', 'Écart | JH/Ha',
  ]);
  // Les clés doivent distinguer les sous-colonnes d'une même parcelle, sinon
  // React les collisionne en silence.
  assert.strictEqual(new Set(niveau2.map((n) => n.key)).size, 6);
});

test('sous-colonnes — le bandeau de groupe couvre TOUTES les sous-colonnes', () => {
  // Le piège du lot : `colSpan` est le seul endroit qui dépend du nombre de
  // colonnes. Laissé à `parcelles.length + 2`, le tableau se désaligne sans
  // qu'aucune erreur ne soit levée.
  const trois = tds(bodyRows(render(troisSeries('perHa')))[0]);
  assert.strictEqual(trois.length, 1);
  assert.strictEqual(trois[0].props.colSpan, 2 * 3 + 2, '2 parcelles × 3 séries + libellé + Total');

  // Une seule série : le colSpan historique, inchangé.
  const une = tds(bodyRows(render([{ key: 'jh', unit: 'JH', basis: 'total',
    display: 'total', format: un }]))[0]);
  assert.strictEqual(une[0].props.colSpan, 2 + 2);
});

test('sous-colonnes — une seule série : AUCUN éclatement (rendu historique)', () => {
  const tree = render([{ key: 'jh', label: 'Réalisé', unit: 'JH/Ha', basis: 'total',
    display: 'perHa', format: un }]);
  // Un seul <tr> d'en-tête, un <td> par parcelle, unité dans la cellule.
  assert.strictEqual(walk(section(tree, 'thead')).filter((n) => n.type === 'tr').length, 1);
  assert.strictEqual(headerThs(tree).length, 4);
  assert.strictEqual(tds(bodyRows(tree)[1]).length, 4);
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1),
    ['5.0 | JH/Ha', '5.0 | JH/Ha', '5.0 | JH/Ha']);
});

test('sous-colonnes — clic sur la SEULE sous-colonne du réalisé, survol sur toute la cellule', () => {
  const vus = [];
  const tree = render(troisSeries('perHa'), { onCellClick: (c) => vus.push(c) });
  const ligne = tds(bodyRows(tree)[1]);
  // Sous-colonnes de P2 : indices 1, 2, 3 (0 = libellé).
  assert.strictEqual(typeof ligne[1].props.onClick, 'function');
  assert.strictEqual(ligne[1].props.style.cursor, 'pointer');
  // Deux zones cliquables de plus pour le MÊME détail n'apporteraient rien.
  assert.strictEqual(ligne[2].props.onClick, undefined);
  assert.strictEqual(ligne[3].props.onClick, undefined);
  assert.strictEqual(ligne[2].props.style.cursor, undefined);
  ligne[1].props.onClick();
  assert.strictEqual(vus.length, 1);
  assert.strictEqual(vus[0].parcelle, 'P2');

  // Le survol, lui, est porté par les TROIS sous-cellules et les colore toutes
  // les trois — un survol qui n'en colorerait qu'une ferait lire trois cellules.
  const faux = [{ style: {} }, { style: {} }, { style: {} }, { style: {} }, { style: {} }];
  const evt = (i) => ({ currentTarget: { parentNode: { children: faux } } });
  [1, 2, 3].forEach((i) => {
    assert.strictEqual(typeof ligne[i].props.onMouseEnter, 'function', 'sous-colonne ' + i);
    faux.forEach((f) => { f.style.background = ''; });
    ligne[i].props.onMouseEnter(evt(i));
    assert.deepStrictEqual(faux.map((f) => f.style.background),
      ['', '#fdf4f8', '#fdf4f8', '#fdf4f8', '']);
    ligne[i].props.onMouseLeave(evt(i));
    assert.deepStrictEqual(faux.map((f) => f.style.background), ['', '', '', '', '']);
  });
});

test('sous-colonnes — une cellule ABSENTE occupe quand même ses K colonnes', () => {
  // Sans ça, les colonnes se décalent d'une ligne à l'autre — et le survol,
  // qui repère ses voisines par position, colorerait la mauvaise parcelle.
  const grouped = [{ type: 'famille', key: 'GB09', label: 'Taille',
    pivot: { P2: { jh: 10, ha: 2, budget: 6 } } }];
  const ligne = tds(bodyRows(render(troisSeries('perHa'), { groupedRows: grouped }))[0]);
  assert.strictEqual(ligne.length, 1 + 2 * 3 + 1);
  ligne.forEach((td) => assert.strictEqual(td.props.colSpan, undefined));
  assert.deepStrictEqual(cells(bodyRows(render(troisSeries('perHa'),
    { groupedRows: grouped }))[0]).slice(4, 7), ['—', '—', '—']);
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
  assert.deepStrictEqual(cells(bodyRows(parHa)[0]).slice(1, 3), ['—', '3.0']);

  // En Total, c'est l'inverse : le réalisé est brut, le budget n'est pas
  // convertible sans le Ha.
  const total = render([
    { key: 'jh', label: 'Réalisé', unit: 'JH', basis: 'total', display: 'total', format: un },
    { key: 'budget', label: 'Budget', unit: 'JH', basis: 'perHa', display: 'total', format: un },
  ], { parcelles: parcelles, groupedRows: grouped });
  assert.deepStrictEqual(cells(bodyRows(total)[0]).slice(1, 3), ['7.0', '—']);
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
  assert.deepStrictEqual(cells(bodyRows(tree)[0]).slice(1, 7),
    ['5.0', '6.0', '-1.0', '5.0', '—', '—']);
  // Une valeur absente ne pèse rien dans les agrégats : le budget total est
  // celui du PÉRIMÈTRE BUDGÉTÉ (12 JH / 6 Ha = 2.0), et l'écart aussi
  // (−2 JH / 6 Ha = −0.3). Le réalisé, lui, reste complet (30 JH / 6 Ha).
  assert.strictEqual(cells(bodyRows(tree)[0])[7],
    '5.0 | Réalisé JH/Ha | 2.0 | Budget JH/Ha | -0.3 | Écart JH/Ha');
});

test('agrégats — ligne et colonne ENTIÈREMENT non budgétées : « — », jamais 0.0', () => {
  // Le piège corrigé : le « — » de chaque cellule redevenait « 0.0 » dans le
  // total, qui se lit « budget nul donc dépassement total » (série budget) et
  // « pile dans le budget » (série écart). Cas COURANT : le budget est saisi
  // progressivement, la Récolte n'est en général pas budgétée.
  //   P2 (2 Ha) budgétée en Taille seulement ; P4 (4 Ha) jamais budgétée.
  const parcelles = [['P2', 2], ['P4', 4]];
  const grouped = [
    { type: 'famille', key: 'GB09', label: 'Taille',
      pivot: { P2: { jh: 10, ha: 2, budget: 6 }, P4: { jh: 20, ha: 4 } } },
    { type: 'famille', key: 'GB08', label: 'Récolte',
      pivot: { P2: { jh: 8, ha: 2 }, P4: { jh: 12, ha: 4 } } },
  ];
  const ecart = function (c) {
    return c.budget > 0 && c.ha > 0 ? (c.jh || 0) - c.budget * c.ha : null;
  };
  const metrics = [
    { key: 'jh', label: 'Réalisé', unit: 'JH', basis: 'total', display: 'total', format: un },
    { key: 'budget', label: 'Budget', unit: 'JH', basis: 'perHa', display: 'total', format: un },
    { label: 'Écart', unit: 'JH', get: ecart, basis: 'total', display: 'total', format: signe },
  ];
  const tree = render(metrics, { parcelles: parcelles, groupedRows: grouped });

  // LIGNE entièrement non budgétée (Récolte) : total de ligne « — » sur budget
  // et écart, mais le réalisé reste complet.
  assert.strictEqual(cells(bodyRows(tree)[1])[7],
    '20.0 | Réalisé JH | — | Budget JH | — | Écart JH');
  // LIGNE partiellement budgétée (Taille) : périmètre budgété, inchangé.
  assert.strictEqual(cells(bodyRows(tree)[0])[7],
    '30.0 | Réalisé JH | 12.0 | Budget JH | -2.0 | Écart JH');
  // COLONNE entièrement non budgétée (P4) : idem au pied de tableau.
  assert.deepStrictEqual(cells(footRow(tree)), [
    'TOTAL',
    '18.0', '12.0', '-2.0',
    '32.0', '—', '—',
    '50.0 | Réalisé JH | 12.0 | Budget JH | -2.0 | Écart JH',
  ]);
});

test('agrégats — un 0 RENSEIGNÉ reste 0.0 (non-régression panneau Quinzaine)', () => {
  // Toutes les cellules du pivot Quinzaine portent des `jh`/`cout` numériques :
  // aucun total ne doit basculer en « — », et une ligne légitimement à zéro doit
  // continuer d'afficher 0.0 — sans quoi le fix ci-dessus casserait l'écran
  // Affectation Analytique.
  const grouped = [
    { type: 'groupe', key: 'G', label: 'M.O HORS RÉCOLTE',
      pivot: { P2: { jh: 0, cout: 0, ha: 2, detailRows: [] } } },
    { type: 'famille', key: 'GB09', label: 'Taille',
      pivot: { P2: { jh: 0, cout: 0, ha: 2, detailRows: [] } } },
  ];
  const tree = render([{ key: 'jh', unit: 'JH', basis: 'total', display: 'total', format: un,
    summary: function (t) { return Math.round(t) + ' JH total'; } }],
  { parcelles: [['P2', 2]], groupedRows: grouped });
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1), ['0.0 | JH', '0.0 | JH']);
  assert.deepStrictEqual(cells(footRow(tree)), ['TOTAL', '0.0 | JH', '0.0 | JH']);
  // Le bandeau de groupe résume aussi ce zéro (il est déterminé, lui).
  assert.ok(textOf(bodyRows(tree)[0]).includes('0 JH total'));
});

test('agrégats — grille dont AUCUNE cellule n\'est renseignée : pas de « NaN »', () => {
  const grouped = [
    { type: 'groupe', key: 'G', label: 'GROUPE', pivot: { P2: { jh: 1, ha: 2 } } },
    { type: 'famille', key: 'GB09', label: 'Taille', pivot: { P2: { jh: 1, ha: 2 } } },
  ];
  const tree = render([{ key: 'budget', label: 'Budget', unit: 'JH/Ha', basis: 'perHa',
    display: 'perHa', format: un, summary: function (t) { return t + ' JH'; } }],
  { parcelles: [['P2', 2]], groupedRows: grouped });
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1), ['— | JH/Ha', '— | JH/Ha']);
  assert.deepStrictEqual(cells(footRow(tree)), ['TOTAL', '— | JH/Ha', '— | JH/Ha']);
  // Bandeau de groupe : aucune mention plutôt qu'un « NaN JH ».
  assert.strictEqual(textOf(bodyRows(tree)[0]), 'GROUPE');
});

test('grille — une cellule sans detailRows n\'est jamais cliquable (pop-up vide)', () => {
  // Cellule née d'un BUDGET sans aucun pointage : il n'y a rien à détailler.
  const grouped = [{ type: 'famille', key: 'GB02', label: 'Ferti-irrigation',
    pivot: { P2: { jh: 0, cout: 0, ha: 2, budget: 3, detailRows: [] },
      P4: { jh: 8, cout: 100, ha: 4, detailRows: [{ jh: 8 }] },
      // `detailRows` ABSENT : contrat historique, la cellule reste cliquable.
      P6: { jh: 3, cout: 50, ha: 6 } } }];
  const tree = render([{ key: 'jh', unit: 'JH', basis: 'total', display: 'total', format: un }],
    { parcelles: [['P2', 2], ['P4', 4], ['P6', 6]], groupedRows: grouped,
      onCellClick: function () {} });
  const tds = (bodyRows(tree)[0].children || []).filter(function (c) { return c.type === 'td'; });
  assert.strictEqual(tds[1].props.onClick, undefined, 'cellule budget seule : inerte');
  assert.strictEqual(tds[1].props.style.cursor, undefined);
  assert.strictEqual(typeof tds[2].props.onClick, 'function', 'cellule réalisée : cliquable');
  assert.strictEqual(typeof tds[3].props.onClick, 'function', 'detailRows absent : cliquable');
});

test('grille — `note` : légende sous la grille et title sur l\'en-tête Total', () => {
  const tree = render(troisSeries('perHa'), { note: 'Périmètre budgété uniquement' });
  assert.ok(textOf(tree).indexOf('Périmètre budgété uniquement') >= 0);
  assert.strictEqual(totalTh(tree).props.title, 'Périmètre budgété uniquement');
  // Sans `note`, aucun bruit ajouté (et pas de title vide).
  assert.strictEqual(totalTh(render(troisSeries('perHa'))).props.title, undefined);
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
  assert.deepStrictEqual(cells(bodyRows(tree)[0]).slice(1, 3), ['—', '—']);
  // Aucune cellule renseignée → le total ne vaut pas 0, il n'existe pas.
  assert.strictEqual(cells(bodyRows(tree)[0])[3], '— | Bancal JH | — | Infini JH');
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
  const trs = walk(section(tree, 'thead')).filter(function (n) { return n.type === 'tr'; });
  assert.deepStrictEqual((trs[0].children || []).filter((c) => c.type === 'th').map(textOf),
    ['Poste', 'Parcelle P2 | 2 Ha', 'Parcelle P4 | 4 Ha', 'Total']);
});

test('grille — sans metrics, la série `jh` par défaut évite un rendu vide', () => {
  const tree = render(undefined);
  assert.ok(cells(bodyRows(tree)[1])[1].indexOf('10') === 0);
});
