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
// l'ordre des `metrics` — colonne TOTAL COMPRISE depuis le lot « Total en plein
// écran » : elle suit la même découpe, et n'est plus sticky. Le mode empilé ne
// subsiste qu'à UNE seule série (rendu historique de l'écran Quinzaine).

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
/**
 * L'en-tête de la colonne Total, où qu'il soit dans l'arbre : « Total » en
 * rendu historique, « TOTAL | <x> Ha » en sous-colonnes (même forme qu'un
 * en-tête de parcelle : titre + surface).
 */
function totalTh(tree) {
  return headerThs(tree).filter(function (n) { return /^(Total|TOTAL)\b/.test(textOf(n)); })[0];
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
  // Éclaté en sous-colonnes lui aussi, une par série.
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(7, 10), ['5.0', '4.7', '+0.3']);
});

test('metrics — en mode Total les trois séries suivent, sans règle codée en dur', () => {
  const tree = render(troisSeries('total'));
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(1, 7),
    ['10.0', '12.0', '-2.0', '20.0', '16.0', '+4.0']);
  assert.deepStrictEqual(cells(footRow(tree)),
    ['TOTAL', '10.0', '12.0', '-2.0', '20.0', '16.0', '+4.0',
      '30.0', '28.0', '+2.0']);
});

test('sous-colonnes — en-tête à DEUX niveaux : parcelle puis série', () => {
  const tree = render(troisSeries('perHa'));
  const trs = walk(section(tree, 'thead')).filter((n) => n.type === 'tr');
  assert.strictEqual(trs.length, 2);

  // Niveau 1 : libellé (rowSpan 2), une parcelle par colSpan de 3, puis le
  // TOTAL — éclaté lui aussi, donc un colSpan de 3 et sa surface en sous-titre.
  const niveau1 = (trs[0].children || []).filter((c) => c.type === 'th');
  assert.deepStrictEqual(niveau1.map(textOf),
    ['Opération', 'P2 | 2 Ha', 'P4 | 4 Ha', 'TOTAL | 6 Ha']);
  assert.strictEqual(niveau1[0].props.rowSpan, 2);
  assert.strictEqual(niveau1[1].props.colSpan, 3);
  assert.strictEqual(niveau1[2].props.colSpan, 3);
  assert.strictEqual(niveau1[3].props.colSpan, 3);
  assert.strictEqual(niveau1[3].props.rowSpan, undefined);
  // Non sticky : elle défile avec le tableau (cf. en-tête du composant).
  assert.strictEqual(niveau1[3].props.style.position, undefined);

  // Niveau 2 : le `label` de chaque série, une fois par parcelle PUIS sous le
  // Total — et plus jamais répété dans les cellules.
  const niveau2 = (trs[1].children || []).filter((c) => c.type === 'th');
  assert.deepStrictEqual(niveau2.map(textOf), [
    'Réalisé | JH/Ha', 'Budget | JH/Ha', 'Écart | JH/Ha',
    'Réalisé | JH/Ha', 'Budget | JH/Ha', 'Écart | JH/Ha',
    'Réalisé | JH/Ha', 'Budget | JH/Ha', 'Écart | JH/Ha',
  ]);
  // (2 parcelles + le Total) × 3 séries.
  assert.strictEqual(niveau2.length, (2 + 1) * 3);
  // Les clés doivent distinguer les sous-colonnes d'une même parcelle, sinon
  // React les collisionne en silence.
  assert.strictEqual(new Set(niveau2.map((n) => n.key)).size, 9);
});

test('Total éclaté — une sous-colonne par série, non sticky, et la somme juste', () => {
  const tree = render(troisSeries('total'));
  const ligne = tds(bodyRows(tree)[1]);
  // 1 libellé + 2 parcelles × 3 séries + 3 sous-colonnes de Total.
  assert.strictEqual(ligne.length, 1 + (2 + 1) * 3);
  const total = ligne.slice(7);
  // Aucune sous-colonne collée à droite : plusieurs colonnes sticky
  // exigeraient un `right` en pixels par sous-colonne, donc des largeurs fixes.
  total.forEach((td, i) => {
    assert.strictEqual(td.props.style.position, undefined, 'sous-colonne ' + i);
    assert.strictEqual(td.props.style.right, undefined, 'sous-colonne ' + i);
  });
  // Le total de ligne est bien la somme des parcelles, série par série :
  // réalisé 10 + 20, budget 12 + 16, écart −2 + 4.
  assert.deepStrictEqual(total.map(textOf), ['30.0', '28.0', '+2.0']);
  assert.deepStrictEqual(ligne.slice(1, 7).map(textOf),
    ['10.0', '12.0', '-2.0', '20.0', '16.0', '+4.0']);
  // Le pied porte le grand total sur les mêmes sous-colonnes.
  assert.deepStrictEqual(tds(footRow(tree)).slice(7).map(textOf), ['30.0', '28.0', '+2.0']);
});

test('sous-colonnes — le bandeau de groupe couvre TOUTES les sous-colonnes', () => {
  // Le piège du lot : `colSpan` est le seul endroit qui dépend du nombre de
  // colonnes. Laissé à `parcelles.length + 2`, le tableau se désaligne sans
  // qu'aucune erreur ne soit levée.
  const trois = tds(bodyRows(render(troisSeries('perHa')))[0]);
  assert.strictEqual(trois.length, 1);
  assert.strictEqual(trois[0].props.colSpan, 2 * 3 + 1 + 3,
    '2 parcelles × 3 séries + libellé + les 3 sous-colonnes du Total');

  // Une seule série : le colSpan historique, inchangé.
  const une = tds(bodyRows(render([{ key: 'jh', unit: 'JH', basis: 'total',
    display: 'total', format: un }]))[0]);
  assert.strictEqual(une[0].props.colSpan, 2 + 2);
});

test('showTotal:false — la colonne Total disparaît PARTOUT, et le colSpan suit', () => {
  // Le piège du lot : le bandeau de groupe compte la colonne de libellé ET la
  // colonne Total. Sans Total, c'est +1 et non +2 — oublié, tout le tableau se
  // décale sans qu'aucune erreur ne soit levée.
  const tree = render(troisSeries('perHa'), { showTotal: false });

  // En-tête : plus aucun <th> « Total », ni au niveau 1 ni au niveau 2.
  const trs = walk(section(tree, 'thead')).filter((n) => n.type === 'tr');
  assert.deepStrictEqual((trs[0].children || []).filter((c) => c.type === 'th').map(textOf),
    ['Opération', 'P2 | 2 Ha', 'P4 | 4 Ha']);
  assert.strictEqual(totalTh(tree), undefined);

  // Corps : libellé + 2 parcelles × 3 séries, et RIEN de plus.
  assert.deepStrictEqual(cells(bodyRows(tree)[1]),
    ['Taille | GB09', '5.0', '6.0', '-1.0', '5.0', '4.0', '+1.0']);
  // Pied : idem, plus de grand total empilé.
  assert.deepStrictEqual(cells(footRow(tree)),
    ['TOTAL', '5.0', '6.0', '-1.0', '5.0', '4.0', '+1.0']);

  // colSpan du bandeau : 2 parcelles × 3 séries + la seule colonne de libellé.
  const bandeau = tds(bodyRows(tree)[0]);
  assert.strictEqual(bandeau.length, 1);
  assert.strictEqual(bandeau[0].props.colSpan, 2 * 3 + 1,
    '2 parcelles × 3 séries + libellé, SANS Total');
});

test('showTotal — colSpan du bandeau juste dans les TROIS cas de largeur', () => {
  // Table de vérité complète : le colSpan doit valoir exactement le nombre de
  // <td>/<th> d'une ligne du corps, mode par mode. Un décalage ne lève rien.
  // Largeur = parcelles × K + 1, plus K si (showTotal && multi), plus 1 si
  // (showTotal && une seule série).
  const colSpanDe = (metrics, showTotal) => tds(bodyRows(render(metrics,
    { showTotal: showTotal }))[0])[0].props.colSpan;
  const largeurDe = (metrics, showTotal) => tds(bodyRows(render(metrics,
    { showTotal: showTotal }))[1]).length;
  const une = [{ key: 'jh', unit: 'JH', basis: 'total', display: 'total', format: un }];

  [[une, true, 2 + 1 + 1], [une, false, 2 + 1],
    [troisSeries('perHa'), true, 2 * 3 + 1 + 3], [troisSeries('perHa'), false, 2 * 3 + 1],
  ].forEach(([metrics, showTotal, attendu]) => {
    const cas = (metrics.length === 1 ? '1 série' : '3 séries')
      + (showTotal ? ' avec Total' : ' sans Total');
    assert.strictEqual(colSpanDe(metrics, showTotal), attendu, 'colSpan ' + cas);
    // …et surtout : le colSpan est ÉGAL à la largeur réelle de la ligne.
    assert.strictEqual(largeurDe(metrics, showTotal), attendu, 'largeur ' + cas);
  });
});

test('showTotal — par DÉFAUT la colonne Total reste là (écran Quinzaine)', () => {
  // Non-régression du panneau Affectation Analytique, qui ne passe pas la prop.
  // À une seule série, c'est LA colonne unique historique : sticky-right, et un
  // libellé « Total » sans sous-titre.
  const une = render([{ key: 'jh', unit: 'JH', basis: 'total', display: 'total', format: un }]);
  assert.strictEqual(textOf(totalTh(une)), 'Total');
  assert.strictEqual(totalTh(une).props.style.position, 'sticky');
  assert.strictEqual(totalTh(une).props.style.right, 0);
  // À plusieurs séries, elle est là aussi, éclatée.
  const tree = render(troisSeries('perHa'));
  assert.strictEqual(textOf(totalTh(tree)), 'TOTAL | 6 Ha');
  assert.strictEqual(tds(bodyRows(tree)[0])[0].props.colSpan, 2 * 3 + 1 + 3);
  // `showTotal: true` explicite = même chose.
  assert.strictEqual(textOf(totalTh(render(troisSeries('perHa'), { showTotal: true }))),
    'TOTAL | 6 Ha');
});

test('showTotal:false — la légende `note` reste sous la grille (plus d\'en-tête Total)', () => {
  // La note énonce le PÉRIMÈTRE des séries : elle ne peut pas disparaître avec
  // la colonne qui la portait en `title`.
  const tree = render(troisSeries('perHa'), { showTotal: false, note: 'Périmètre budgété' });
  assert.ok(textOf(tree).indexOf('Périmètre budgété') >= 0);
});

test('densité — lignes resserrées en sous-colonnes, INCHANGÉES à une seule série', () => {
  // La hauteur d'un <tr> est celle de sa cellule la plus haute : le padding doit
  // être réduit sur la colonne de libellé aussi, sinon rien ne se resserre.
  const dense = render(troisSeries('perHa'), {
    groupedRows: [
      { type: 'groupe', key: 'G', label: 'GROUPE', pivot: PIVOT },
      { type: 'famille', key: 'GB09', label: 'Taille', pivot: PIVOT },
      { type: 'operation', key: 'GB09::op', label: 'Taille longue', pivot: PIVOT },
    ],
  });
  const pad = (tr, i) => tds(tr)[i].props.style.padding;
  assert.strictEqual(pad(bodyRows(dense)[0], 0), '5px 12px', 'bandeau de groupe');
  assert.strictEqual(pad(bodyRows(dense)[1], 0), '4px 12px', 'libellé famille');
  assert.strictEqual(pad(bodyRows(dense)[1], 1), '4px 8px', 'cellule famille');
  assert.strictEqual(pad(bodyRows(dense)[2], 0), '3px 12px 3px 32px', 'libellé opération');
  assert.strictEqual(pad(bodyRows(dense)[2], 1), '3px 8px', 'cellule opération');
  assert.strictEqual(pad(footRow(dense), 1), '5px 8px', 'pied');
  assert.strictEqual(section(dense, 'table').props.style.lineHeight, 1.25);

  // Une seule série (écran Quinzaine) : l'espacement d'origine, à l'octet près,
  // et pas même une propriété `lineHeight` ajoutée au style du <table>.
  const large = render([{ key: 'jh', unit: 'JH', basis: 'total', display: 'total', format: un }], {
    groupedRows: [
      { type: 'groupe', key: 'G', label: 'GROUPE', pivot: PIVOT },
      { type: 'famille', key: 'GB09', label: 'Taille', pivot: PIVOT },
      { type: 'operation', key: 'GB09::op', label: 'Taille longue', pivot: PIVOT },
    ],
  });
  assert.strictEqual(pad(bodyRows(large)[0], 0), '8px 14px');
  assert.strictEqual(pad(bodyRows(large)[1], 0), '9px 14px');
  assert.strictEqual(pad(bodyRows(large)[1], 1), '8px 10px');
  assert.strictEqual(pad(bodyRows(large)[2], 0), '6px 14px 6px 44px');
  assert.strictEqual(pad(bodyRows(large)[2], 1), '6px 10px');
  assert.strictEqual(pad(footRow(large), 1), '8px 10px');
  assert.strictEqual('lineHeight' in section(large, 'table').props.style, false);
});

test('showTotal:false — le survol peint toujours la BONNE cellule', () => {
  // _pag_paint repère ses voisines par position depuis la GAUCHE (1 = colonne
  // de libellé) : la disparition de la dernière colonne ne doit rien décaler.
  const tree = render(troisSeries('perHa'), { showTotal: false, onCellClick: () => {} });
  const ligne = tds(bodyRows(tree)[1]);
  // P4 = sous-colonnes 4, 5, 6.
  const faux = [];
  for (let i = 0; i < 7; i += 1) faux.push({ style: { background: '' } });
  ligne[5].props.onMouseEnter({ currentTarget: { parentNode: { children: faux } } });
  assert.deepStrictEqual(faux.map((f) => f.style.background),
    ['', '', '', '', '#fdf4f8', '#fdf4f8', '#fdf4f8']);
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

test('sous-colonnes — trait de fin de parcelle sur TOUTES les lignes, aucun entre séries', () => {
  // Éclatée en 3, une parcelle n'est plus repérable sans un trait qui la ferme.
  // Il reprend le séparateur de la colonne de libellé (2px, couleur de la
  // culture) ; interrompu sur une seule ligne, l'œil perd la colonne.
  const TRAIT = '2px solid #8B2252';
  const tree = render(troisSeries('perHa'), {
    // Une parcelle sans cellule : son trait doit courir malgré tout.
    groupedRows: [
      { type: 'groupe', key: 'G', label: 'GROUPE', pivot: PIVOT },
      { type: 'famille', key: 'GB09', label: 'Taille',
        pivot: { P2: { jh: 10, cout: 300, ha: 2, budget: 6 } } },
      { type: 'operation', key: 'GB09::op', label: 'Taille longue',
        pivot: { P2: { jh: 10, cout: 300, ha: 2, budget: 6 } } },
    ],
  });
  const trs = walk(section(tree, 'thead')).filter((n) => n.type === 'tr');
  const bords = (cellules) => cellules.map((c) => c.props.style.borderRight);

  // En-tête niveau 1 : le trait ferme chaque parcelle (colonnes de libellé et
  // Total exclues — elles ont leur propre séparateur).
  const niveau1 = (trs[0].children || []).filter((c) => c.type === 'th');
  assert.deepStrictEqual(bords(niveau1.slice(1, 3)), [TRAIT, TRAIT]);
  // En-tête niveau 2, ligne famille, ligne opération, pied : même découpe —
  // trait sur la 3e sous-colonne, rien entre les sous-colonnes d'une parcelle.
  const attendu = ['none', 'none', TRAIT, 'none', 'none', TRAIT];
  const niveau2 = (trs[1].children || []).filter((c) => c.type === 'th');
  assert.deepStrictEqual(bords(niveau2), attendu.concat(['none', 'none', TRAIT]));
  // Le Total, lui, est détaché de la dernière parcelle par un trait à GAUCHE,
  // posé une seule fois — et sur tous les niveaux de ligne.
  assert.deepStrictEqual(niveau2.slice(6).map((c) => c.props.style.borderLeft),
    [TRAIT, 'none', 'none']);
  assert.strictEqual(niveau1[3].props.style.borderLeft, TRAIT);
  [1, 2].forEach((i) => {
    assert.deepStrictEqual(tds(bodyRows(tree)[i]).slice(7).map((c) => c.props.style.borderLeft),
      [TRAIT, 'none', 'none'], 'ligne ' + i);
  });
  assert.deepStrictEqual(tds(footRow(tree)).slice(7).map((c) => c.props.style.borderLeft),
    [TRAIT, 'none', 'none'], 'pied');
  assert.deepStrictEqual(bords(tds(bodyRows(tree)[1]).slice(1, 7)), attendu, 'ligne famille');
  assert.deepStrictEqual(bords(tds(bodyRows(tree)[2]).slice(1, 7)), attendu, 'ligne opération');
  assert.deepStrictEqual(bords(tds(footRow(tree)).slice(1, 7)), attendu, 'pied');
});

test('sous-colonnes — une seule série : AUCUN trait de parcelle ajouté (rendu historique)', () => {
  const tree = render([{ key: 'jh', unit: 'JH', basis: 'total', display: 'total', format: un }]);
  const th = (walk(section(tree, 'thead')).filter((n) => n.type === 'th'))[1];
  assert.strictEqual(th.props.style.borderRight, '1px solid var(--gray-100)');
  assert.strictEqual(tds(bodyRows(tree)[1])[1].props.style.borderRight, '1px solid #f5edf4');
  assert.strictEqual(tds(footRow(tree))[1].props.style.borderRight, '1px solid var(--gray-100)');
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
  assert.strictEqual(ligne.length, 1 + 2 * 3 + 3);
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
  assert.deepStrictEqual(cells(bodyRows(tree)[0]).slice(7, 10), ['5.0', '2.0', '-0.3']);
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
  assert.deepStrictEqual(cells(bodyRows(tree)[1]).slice(7, 10), ['20.0', '—', '—']);
  // LIGNE partiellement budgétée (Taille) : périmètre budgété, inchangé.
  assert.deepStrictEqual(cells(bodyRows(tree)[0]).slice(7, 10), ['30.0', '12.0', '-2.0']);
  // COLONNE entièrement non budgétée (P4) : idem au pied de tableau.
  assert.deepStrictEqual(cells(footRow(tree)), [
    'TOTAL',
    '18.0', '12.0', '-2.0',
    '32.0', '—', '—',
    '50.0', '12.0', '-2.0',
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
  assert.deepStrictEqual(cells(bodyRows(tree)[0]).slice(3, 5), ['—', '—']);
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
    ['Poste', 'Parcelle P2 | 2 Ha', 'Parcelle P4 | 4 Ha', 'TOTAL | 6 Ha']);
});

test('grille — sans metrics, la série `jh` par défaut évite un rendu vide', () => {
  const tree = render(undefined);
  assert.ok(cells(bodyRows(tree)[1])[1].indexOf('10') === 0);
});

// ── Totaux DANS le bandeau de section (`chiffresGroupe`) ────────────────────
// Opt-in : sans la prop, le bandeau reste le `colSpan` unique de l'écran
// Quinzaine, en production. C'est la première assertion ci-dessous, et c'est la
// plus importante des trois.

test('bandeau de section — sans la prop, le colSpan d\'origine, intact', () => {
  const tree = render(troisSeries('perHa'));
  const bandeau = tds(bodyRows(tree)[0]);
  assert.strictEqual(bandeau.length, 1, 'une seule cellule, comme avant');
  // parcelles × séries + libellé + la largeur de la colonne Total (présente par
  // défaut, c'est le cas de l'écran Quinzaine).
  assert.strictEqual(bandeau[0].props.colSpan, 2 * 3 + 1 + 3);
  assert.match(textOf(bandeau[0]), /M\.O HORS RÉCOLTE/);
});

test('bandeau de section — chiffré, il occupe exactement les colonnes des lignes', () => {
  const tree = render(troisSeries('perHa'), { chiffresGroupe: true });
  const bandeau = tds(bodyRows(tree)[0]);
  const famille = tds(bodyRows(tree)[1]);
  assert.strictEqual(bandeau[0].props.colSpan, undefined, 'plus de colSpan');
  assert.strictEqual(bandeau.length, famille.length,
    'un décalage ici décale TOUT le tableau, silencieusement');
  // Le résumé textuel de la section survit dans la cellule de libellé.
  assert.match(textOf(bandeau[0]), /M\.O HORS RÉCOLTE \| 30 JH total/);
});

test('bandeau de section — ses chiffres sont la somme de SES familles', () => {
  const tree = render(troisSeries('perHa'), { chiffresGroupe: true, showTotal: true });
  // Une seule famille sous le bandeau : il doit afficher exactement ses valeurs.
  // C'est la garantie qu'un bandeau ne peut pas mentir sur les lignes qu'il
  // coiffe — il est calculé à partir d'elles, jamais depuis `row.pivot`.
  assert.deepStrictEqual(cells(bodyRows(tree)[0]).slice(1), cells(bodyRows(tree)[1]).slice(1));
  // …et il vaut donc aussi le pied, puisqu'il n'y a qu'une section.
  assert.deepStrictEqual(cells(bodyRows(tree)[0]).slice(1), cells(footRow(tree)).slice(1));
});

test('bandeau de section — une famille NON budgétée ne devient pas un budget nul', () => {
  // Le pivot d'une ligne groupe ne porte NI budget NI pctIdeal : si le bandeau
  // le lisait au lieu d'agréger ses familles, tout le budget passerait à « — ».
  const tree = render(troisSeries('perHa'), {
    chiffresGroupe: true,
    groupedRows: [
      { type: 'groupe', key: 'G', label: 'M.O HORS RÉCOLTE', pivot: {} },
      { type: 'famille', key: 'GB09', label: 'Taille', pivot: PIVOT },
    ],
  });
  assert.deepStrictEqual(cells(bodyRows(tree)[0]).slice(1), cells(bodyRows(tree)[1]).slice(1));
});

test('bandeau de section — une série ratio y est agrégée num/den, jamais moyennée', () => {
  const taux = [{ key: 'jh', label: 'Réalisé', unit: 'JH', basis: 'total', display: 'total', format: un },
    { label: '% consommé', ratio: { parts: function (c) {
      return c && c.budget ? { num: c.jh, den: c.budget * c.ha } : null;
    } }, format: function (v) { return (Math.round(v * 1000) / 10).toFixed(1) + ' %'; } }];
  const tree = render(taux, { chiffresGroupe: true, showTotal: true });
  // P2 : 10/(6×2) = 83.3 % ; P4 : 20/(4×4) = 125.0 % ; total (10+20)/(12+16) =
  // 107.1 % — et NON la moyenne des deux taux (104.2 %) ni leur somme.
  assert.deepStrictEqual(cells(bodyRows(tree)[0]), ['M.O HORS RÉCOLTE', '10.0', '83.3 %', '20.0', '125.0 %', '30.0', '107.1 %']);
});

// ── Largeurs déterministes (`largeursFixes`) ────────────────────────────────
// L'écran Campagne empile DEUX grilles par culture (hors récolte / récolte) :
// sans largeurs déclarées, chacune se dimensionne sur son propre contenu et les
// colonnes ne tombent plus en face. Opt-in : le panneau Quinzaine, en
// production, garde son dimensionnement automatique.

function thLibelle(tree) { return walk(section(tree, 'thead')).filter((n) => n.type === 'th')[0]; }

test('largeurs — sans la prop, aucune largeur déclarée (rendu Quinzaine intact)', () => {
  const tree = render(troisSeries('perHa'));
  const table = walk(tree).filter((n) => n.type === 'table')[0];
  assert.strictEqual((table.props.style || {}).tableLayout, undefined);
  assert.strictEqual((table.props.style || {}).minWidth, undefined);
  assert.strictEqual((thLibelle(tree).props.style || {}).width, undefined);
});

test('largeurs — avec la prop, mêmes largeurs à UNE ou PLUSIEURS séries', () => {
  // C'est tout l'objet : la grille du haut est en 3 séries, celle du bas peut
  // n'en avoir qu'une (Coût DH) — leur colonne de libellé doit rester la même.
  const multi = render(troisSeries('perHa'), { largeursFixes: true, showTotal: false });
  const mono = render([troisSeries('perHa')[0]], { largeursFixes: true, showTotal: false });
  const tableMulti = walk(multi).filter((n) => n.type === 'table')[0];
  const tableMono = walk(mono).filter((n) => n.type === 'table')[0];
  assert.strictEqual(tableMulti.props.style.tableLayout, 'fixed');
  assert.strictEqual(tableMono.props.style.tableLayout, 'fixed', 'AUSSI en série unique');
  assert.strictEqual(thLibelle(multi).props.style.width, thLibelle(mono).props.style.width);
  // La largeur totale suit le nombre de colonnes de parcelles, pas le contenu.
  assert.strictEqual(tableMulti.props.style.minWidth, 200 + 2 * (3 * 78));
  assert.strictEqual(tableMono.props.style.minWidth, 200 + 2 * 110);
});

test('défilement — deux grilles d\'un même groupe coulissent ensemble', () => {
  const tree = render(troisSeries('perHa'), { largeursFixes: true, scrollGroup: 'g1' });
  // Le conteneur de défilement porte le groupe et écoute le scroll.
  const conteneur = walk(tree).filter((n) => n.props && n.props['data-scroll-group'] === 'g1');
  assert.strictEqual(conteneur.length, 1);
  assert.strictEqual(typeof conteneur[0].props.onScroll, 'function');
  // Sans la prop : aucun groupe, aucun écouteur — c'est le cas de l'écran
  // Quinzaine, dont le défilement reste indépendant.
  const sansGroupe = render(troisSeries('perHa'));
  const div = walk(sansGroupe).filter((n) => n.type === 'div'
    && n.props && n.props.style && n.props.style.overflowX === 'auto')[0];
  assert.strictEqual(div.props['data-scroll-group'], undefined);
  assert.strictEqual(div.props.onScroll, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// En-têtes cliquables et surface du TOTAL
// ─────────────────────────────────────────────────────────────────────────────

/** L'en-tête de niveau 1 d'une parcelle (celui qui porte son libellé). */
function parcelleTh(tree, cle) {
  return headerThs(tree).filter(function (n) { return textOf(n).indexOf(cle) === 0; })[0];
}

test('onParcelleClick — absent, les en-têtes restent inertes', () => {
  const th = parcelleTh(render(troisSeries('perHa')), 'P2');
  assert.strictEqual(th.props.onClick, undefined);
  assert.strictEqual(th.props.style.cursor, undefined);
});

test('onParcelleClick — présent, l\'en-tête rend SA parcelle et SON Ha', () => {
  const vus = [];
  const tree = render(troisSeries('perHa'), {
    onParcelleClick: function (cle, ha) { vus.push([cle, ha]); },
  });
  parcelleTh(tree, 'P2').props.onClick();
  parcelleTh(tree, 'P4').props.onClick();
  // Chaque en-tête doit fermer sur SA colonne : une fermeture partagée dans la
  // boucle ouvrirait toujours la dernière parcelle, sans rien lever.
  assert.deepStrictEqual(vus, [['P2', 2], ['P4', 4]]);
  assert.strictEqual(parcelleTh(tree, 'P2').props.style.cursor, 'pointer');
});

test('totalHa — par défaut, la somme des colonnes', () => {
  // 2 Ha + 4 Ha : l'en-tête du Total annonce 6 Ha.
  assert.match(textOf(totalTh(render(troisSeries('perHa')))), /6 Ha/);
});

test('totalHa — surchargeable quand les colonnes partagent la même surface', () => {
  // Grille « une parcelle, quinzaine par quinzaine » : chaque colonne porte la
  // MÊME surface. Sommer les colonnes donnerait 4 × la parcelle sur 4
  // quinzaines — et diviserait par 4 tous les « JH/Ha » du Total.
  const tree = render(troisSeries('perHa'), { totalHa: 2 });
  assert.match(textOf(totalTh(tree)), /2 Ha/);
  // Le total en JH/Ha suit la surface annoncée : 30 JH réalisés / 2 Ha = 15,0.
  const totalRealise = tds(bodyRows(tree)[1]).slice(-3)[0];
  assert.strictEqual(textOf(totalRealise).trim(), '15.0');
});
