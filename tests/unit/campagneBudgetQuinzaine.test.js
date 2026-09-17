'use strict';

// BUDGET DE LA QUINZAINE EN COURS (LOT 3b) — logique pure + rendu.
//
// Couvre :
//  1. src/modules/shared/lib/campagneBudgetQuinzaine.js (clés, options, report, décoration,
//     ratio de consommation) ;
//  2. la NON-DIVERGENCE des trois miroirs imposés par « le backend ne peut pas
//     requérir public/ » : quinzaineKey (front/back) et resolveCulture
//     (src/modules/shared/lib/cultureUtils.js vs functions/lib/campagneBudget/culture.js) ;
//  3. la série RATIO de PivotAnalytiqueGrid : un pourcentage ne doit JAMAIS être
//     sommé dans les totaux ;
//  4. la saisie (CampagneBudgetTab) : payload, gating avocatier, report en un
//     clic, confirmation avant suppression.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');

const { loadEsm, loadComponent } = require('./_esm');
const CBQ = loadEsm('src/modules/shared/lib/campagneBudgetQuinzaine.js');
const backendBudget = require('../../functions/lib/campagneBudget/validate');
const backendCulture = require('../../functions/lib/campagneBudget/culture');
const frontCulture = loadEsm('src/modules/shared/lib/cultureUtils.js');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function transform(rel) {
  const file = path.join(ROOT, rel);
  return babel.transformSync(fs.readFileSync(file, 'utf8'), {
    presets: [require.resolve('@babel/preset-react')],
    filename: file, babelrc: false, configFile: false,
  }).code;
}

function plain(v) { return JSON.parse(JSON.stringify(v)); }

// ===========================================================================
// 1. MIROIRS — deux implémentations, un seul comportement
// ===========================================================================

test('miroir — quinzaineKey front et back rendent la MÊME clé sur tout le corpus', () => {
  const corpus = [
    'Q07', 'q07', 'Q7', 'Quinzaine 7', 'Quinzaine 07', ' quinzaine  24 ', 7, '7', '24',
    '2026-2027', 'Période 3 bis', 'Q0', 'Q100', '', null, undefined, true, {}, 'Quinzaine',
  ];
  corpus.forEach((v) => {
    assert.strictEqual(CBQ.quinzaineKey(v), backendBudget.quinzaineKey(v),
      'divergence sur ' + JSON.stringify(v));
  });
});

test('miroir — resolveCulture front et back : les 17 libellés RÉELS, même verdict', () => {
  // Libellés de production. 14 sur 15 des parcelles budgétées n'ont PAS de
  // `culture_sb` : c'est le repli sur le libellé qui tranche, et il doit être
  // identique des deux côtés — sinon le serveur refuserait (ou laisserait
  // passer) un budget que l'écran propose (ou masque).
  const LABELS = [
    'F5- CASCADE -S13', 'F5- CORINA -S11', 'F5- BREEZE -S12', 'F1- MARAVILLA -S05',
    'F1- ADELITA -S02', 'F1- YAZMIN -S03', 'F1- REYNA -S04', 'S12 - YAZMIN EXTENSION',
    'AVOCAT F5', 'F2 - HAAS', 'F3 -HAAS', 'F4 -HAAS', 'F6-HAAS', 'F2 - ZUTANO',
    'F4 -FUERTE', 'BAHIA - S1', 'MYRTILLE EXTENSION',
  ];
  const SB_MAP = {
    'S12 - YAZMIN EXTENSION': { culture_sb: 'Framboise', nom_sb: 'MYRTILLE EXTENSION' },
    'BAHIA - S1': { culture_sb: 'Myrtille' },
  };
  LABELS.forEach((label) => {
    const a = frontCulture.resolveCulture({ label }, SB_MAP);
    const b = backendCulture.resolveCulture({ label }, SB_MAP);
    assert.strictEqual(a, b, 'divergence sur ' + label);
  });
});

test('avocatier — les 7 parcelles réelles sont résolues Avocatier, sans culture_sb', () => {
  // La liste exacte de l'énoncé du lot : aucune ne doit être proposée à la
  // saisie, et le serveur doit refuser une écriture forgée dessus.
  ['AVOCAT F5', 'F2 - HAAS', 'F3 -HAAS', 'F4 -HAAS', 'F6-HAAS', 'F2 - ZUTANO', 'F4 -FUERTE']
    .forEach((label) => {
      assert.strictEqual(backendCulture.resolveCulture({ label }, {}), 'Avocatier', label);
      assert.strictEqual(
        backendBudget.CULTURES_BUDGET_QUINZAINE.indexOf(
          backendCulture.resolveCulture({ label }, {})), -1, label);
    });
});

// ===========================================================================
// 2. LIB PURE
// ===========================================================================

test('optionsFromPeriodes — dédupliquées, triées de la plus récente à la plus ancienne', () => {
  const out = CBQ.optionsFromPeriodes(['Quinzaine 01', 'Quinzaine 03', 'Quinzaine 02',
    'Quinzaine 03', 'bruit']);
  assert.deepStrictEqual(out.map((o) => o.key), ['Q03', 'Q02', 'Q01']);
  assert.deepStrictEqual(out[0], { key: 'Q03', num: 3, label: 'Quinzaine 03' });
  assert.deepStrictEqual(CBQ.optionsFromPeriodes(null), []);
});

test('quinzaineCourante — dérivée de quinzainesInfo, jamais d\'un calendrier local', () => {
  // `ecoulees` = dernière quinzaine VUE dans les periodes = celle qu'on pointe.
  assert.strictEqual(CBQ.quinzaineCourante({ ecoulees: 4 }), 'Q04');
  assert.strictEqual(CBQ.quinzaineCourante({ ecoulees: 0 }), '');
  assert.strictEqual(CBQ.quinzaineCourante(null), '');
});

test('quinzainePrecedente — la précédente RÉELLE, pas num − 1 en aveugle', () => {
  // Q03 n'a aucun pointage : elle n'existe pas dans les periodes. Proposer
  // « reporter Q03 » donnerait un report vide sans rien expliquer.
  const opts = CBQ.optionsFromPeriodes(['Quinzaine 01', 'Quinzaine 02', 'Quinzaine 04']);
  assert.strictEqual(CBQ.quinzainePrecedente('Q04', opts), 'Q02');
  assert.strictEqual(CBQ.quinzainePrecedente('Q01', opts), '');
  assert.strictEqual(CBQ.quinzainePrecedente('', opts), '');
});

test('quinzainesByLabel — indexé LABEL_MAJ, clés canonisées, champ absent = {}', () => {
  const out = CBQ.quinzainesByLabel([
    { label_bee_one: ' f5- cascade -s13 ', budgets_quinzaine: { 'Quinzaine 7': { Taille: 1 } } },
    // Document antérieur au lot : aucun champ. Doit rester lisible (aucune
    // migration), simplement vide.
    { label_bee_one: 'F1- ROUGE -S01' },
    { label_bee_one: '', budgets_quinzaine: { Q07: { Taille: 9 } } },
  ]);
  assert.deepStrictEqual(plain(out), {
    'F5- CASCADE -S13': { Q07: { Taille: 1 } },
    'F1- ROUGE -S01': {},
  });
});

test('trancheQuinzaine — la maille attendue par l\'indexeur du budget annuel', () => {
  const parLabel = {
    'A': { Q07: { Taille: 1 }, Q08: { Taille: 2 } },
    'B': { Q08: { Taille: 3 } },
  };
  assert.deepStrictEqual(plain(CBQ.trancheQuinzaine(parLabel, 'Q07')), { A: { Taille: 1 } });
  assert.deepStrictEqual(plain(CBQ.trancheQuinzaine(parLabel, 'Quinzaine 8')),
    { A: { Taille: 2 }, B: { Taille: 3 } });
  assert.deepStrictEqual(plain(CBQ.trancheQuinzaine(parLabel, 'bruit')), {});
});

test('realiseQuinzaine — somme SEULEMENT les lignes de la quinzaine visée', () => {
  const cell = {
    jh: 60,
    detailRows: [
      { periode: 'Quinzaine 03', jh: 10 },
      { periode: 'Quinzaine 04', jh: 25 },
      { periode: 'Quinzaine 04', jh: 5 },
      { periode: 'Quinzaine 05', jh: 20 },
    ],
  };
  assert.strictEqual(CBQ.realiseQuinzaine(cell, 4), 30);
  // Aucune ligne sur cette quinzaine = un VRAI zéro (la cellule existe), pas une
  // absence de mesure : c'est 0 % consommé, information capitale.
  assert.strictEqual(CBQ.realiseQuinzaine(cell, 6), 0);
  assert.strictEqual(CBQ.realiseQuinzaine(null, 4), 0);
});

// ---------------------------------------------------------------- décoration

/** Deux familles, deux parcelles, avec le détail par période. */
const PARCELLES = [['P1', 2], ['P2', 5]];

function rowsFixture() {
  return [
    { type: 'groupe', key: 'M.O Hors récolte', label: 'M.O Hors récolte', pivot: {} },
    {
      type: 'famille', key: 'GB09', label: 'Taille',
      pivot: {
        P1: { jh: 40, cout: 0, ha: 2, detailRows: [
          { periode: 'Quinzaine 03', jh: 30 }, { periode: 'Quinzaine 04', jh: 10 }] },
        P2: { jh: 15, cout: 0, ha: 5, detailRows: [{ periode: 'Quinzaine 04', jh: 15 }] },
      },
    },
    {
      type: 'operation', key: 'GB09::TAILLE', label: 'Taille longue', familleKey: 'GB09',
      pivot: { P1: { jh: 40, cout: 0, ha: 2, detailRows: [{ periode: 'Quinzaine 04', jh: 10 }] } },
    },
  ];
}

/** Index de budget de quinzaine, forme de CampagneBudgetPivot.indexBudgets. */
const BUDGET_INDEX = { familles: { GB09: { label: 'Taille', cells: { P1: 4, P2: 1 } } } };

test('decoreQuinzaine — réalisé de la quinzaine et engagement, sans muter la source', () => {
  const src = rowsFixture();
  const out = CBQ.decoreQuinzaine({
    groupedRows: src, parcelles: PARCELLES, num: 4, budgetIndex: BUDGET_INDEX,
  });
  const fam = out.groupedRows[1];
  assert.strictEqual(fam.pivot.P1.jhQuinzaine, 10);
  assert.strictEqual(fam.pivot.P1.budgetQuinzaine, 4);
  assert.strictEqual(fam.pivot.P2.jhQuinzaine, 15);
  assert.strictEqual(out.hasBudget, true);
  // Ligne opération : le réalisé de la quinzaine est décoré, l'engagement NON
  // (il se saisit au niveau famille — inventer une répartition serait faux).
  assert.strictEqual(out.groupedRows[2].pivot.P1.jhQuinzaine, 10);
  assert.strictEqual(out.groupedRows[2].pivot.P1.budgetQuinzaine, undefined);
  // Les lignes groupe sont laissées telles quelles, et rien n'est muté.
  assert.strictEqual(out.groupedRows[0], src[0]);
  assert.strictEqual(src[1].pivot.P1.jhQuinzaine, undefined);
});

test('decoreQuinzaine — une parcelle ENGAGÉE mais jamais travaillée reste visible', () => {
  const rows = [{ type: 'famille', key: 'GB09', label: 'Taille', pivot: {} }];
  const out = CBQ.decoreQuinzaine({
    groupedRows: rows, parcelles: PARCELLES, num: 4,
    budgetIndex: { familles: { GB09: { cells: { P2: 3 } } } },
  });
  // Cellule créée de toutes pièces : 0 JH consommé sur 3 JH/Ha engagés — c'est
  // précisément le cas qu'on vient surveiller.
  assert.deepStrictEqual(plain(out.groupedRows[0].pivot.P2),
    { jh: 0, cout: 0, ha: 5, detailRows: [], jhQuinzaine: 0, budgetQuinzaine: 3 });
});

test('decoreQuinzaine — aucun engagement : hasBudget faux (la vue ne s\'ouvre pas)', () => {
  const out = CBQ.decoreQuinzaine({
    groupedRows: rowsFixture(), parcelles: PARCELLES, num: 4, budgetIndex: null,
  });
  assert.strictEqual(out.hasBudget, false);
});

// --------------------------------------------------------------------- ratio

test('pctPartsCellule — numérateur et dénominateur SÉPARÉS, jamais un ratio pré-divisé', () => {
  assert.deepStrictEqual(
    CBQ.pctPartsCellule({ jhQuinzaine: 10, budgetQuinzaine: 4, ha: 2 }), { num: 10, den: 8 });
  // Aucun engagement, ou Ha inconnu → indéterminable. Un 0 % se lirait « rien
  // consommé » là où il n'y a simplement rien d'engagé.
  assert.strictEqual(CBQ.pctPartsCellule({ jhQuinzaine: 10, ha: 2 }), null);
  assert.strictEqual(CBQ.pctPartsCellule({ jhQuinzaine: 10, budgetQuinzaine: 4 }), null);
  assert.strictEqual(CBQ.pctPartsCellule(null), null);
});

test('resteQuinzaineCellule — négatif = engagement dépassé, jamais plafonné', () => {
  assert.strictEqual(CBQ.resteQuinzaineCellule({ jhQuinzaine: 10, budgetQuinzaine: 4, ha: 2 }), -2);
  assert.strictEqual(CBQ.resteQuinzaineCellule({ jhQuinzaine: 2, budgetQuinzaine: 4, ha: 2 }), 6);
  assert.strictEqual(CBQ.resteQuinzaineCellule({ jhQuinzaine: 2 }), null);
});

test('noteQuinzaine — dit que l\'engagement N\'EST PAS une tranche du budget annuel', () => {
  const txt = CBQ.noteQuinzaine({ label: 'Quinzaine 04', key: 'Q04' }, true);
  assert.match(txt, /Quinzaine 04/);
  assert.match(txt, /en cours/);
  assert.match(txt, /indépendant du budget annuel/);
  assert.match(CBQ.noteQuinzaine({ key: 'Q03' }, false), /passée/);
});

// ===========================================================================
// 3. GRILLE — la série ratio ne s'additionne pas
// ===========================================================================

function loadGrid() {
  const nodes = [];
  const sandbox = { window: {}, console };
  sandbox.window.React = {
    createElement: function (type, props, ...children) {
      const flat = [];
      const push = (c) => {
        if (Array.isArray(c)) c.forEach(push);
        else if (c != null && c !== false) flat.push(c);
      };
      children.forEach(push);
      const node = { type, key: (props || {}).key, props: props || {}, children: flat };
      nodes.push(node);
      return node;
    },
  };
  vm.createContext(sandbox);
  return loadComponent('src/modules/finance/PivotAnalytiqueGrid.jsx', sandbox).PivotAnalytiqueGrid;
}

const Grid = loadGrid();

function walk(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => walk(c, out));
  return out;
}
function textOf(node) {
  return walk(node)
    .flatMap((n) => (n.children || []).filter((c) => typeof c === 'string' || typeof c === 'number'))
    .map(String).join(' | ');
}
function section(tree, tag) { return walk(tree).filter((n) => n.type === tag)[0]; }
function footCells(tree) {
  const tr = walk(section(tree, 'tfoot')).filter((n) => n.type === 'tr')[0];
  return (tr.children || []).filter((c) => c && c.type === 'td').map(textOf);
}
function bodyCells(tree, i) {
  const tr = walk(section(tree, 'tbody')).filter((n) => n.type === 'tr')[i];
  return (tr.children || []).filter((c) => c && c.type === 'td').map(textOf);
}

/**
 * Deux parcelles très inégales : P1 consomme 50 % d'un petit engagement, P2
 * 100 % d'un gros. La moyenne des pourcentages (75 %) et le vrai taux global
 * (95,5 %) diffèrent — c'est le piège que la série ratio doit éviter.
 */
const RATIO_ROWS = [{
  type: 'famille', key: 'GB09', label: 'Taille',
  pivot: {
    P1: { jh: 1, ha: 2, detailRows: [], jhQuinzaine: 1, budgetQuinzaine: 1 },   // 1 / 2   = 50 %
    P2: { jh: 20, ha: 5, detailRows: [], jhQuinzaine: 20, budgetQuinzaine: 4 }, // 20 / 20 = 100 %
  },
}];

const RATIO_METRIC = {
  label: 'Consommé', unit: '%',
  ratio: { parts: CBQ.pctPartsCellule },
  format: (v) => (Math.round(v * 1000) / 10).toFixed(1),
};

test('grille ratio — la cellule affiche le taux de la cellule', () => {
  const tree = Grid({ parcelles: PARCELLES, groupedRows: RATIO_ROWS, metrics: [RATIO_METRIC] });
  const cells = bodyCells(tree, 0);
  assert.ok(cells[1].indexOf('50.0') >= 0, cells[1]);
  assert.ok(cells[2].indexOf('100.0') >= 0, cells[2]);
});

test('grille ratio — le TOTAL de ligne pondère, il ne somme ni ne moyenne', () => {
  const tree = Grid({ parcelles: PARCELLES, groupedRows: RATIO_ROWS, metrics: [RATIO_METRIC] });
  const total = bodyCells(tree, 0)[3];
  // (1 + 20) / (2 + 20) = 95,5 %. Une somme donnerait 150 %, une moyenne 75 %.
  assert.ok(total.indexOf('95.5') >= 0, total);
  assert.ok(total.indexOf('150') < 0 && total.indexOf('75.0') < 0, total);
});

test('grille ratio — totaux de colonne et grand total pondérés eux aussi', () => {
  const tree = Grid({ parcelles: PARCELLES, groupedRows: RATIO_ROWS, metrics: [RATIO_METRIC] });
  const foot = footCells(tree);
  assert.ok(foot[1].indexOf('50.0') >= 0, foot[1]);
  assert.ok(foot[2].indexOf('100.0') >= 0, foot[2]);
  assert.ok(foot[3].indexOf('95.5') >= 0, foot[3]);
});

test('grille ratio — sans dénominateur, « — » partout, jamais 0 %', () => {
  const rows = [{
    type: 'famille', key: 'GB09', label: 'Taille',
    pivot: { P1: { jh: 5, ha: 2, jhQuinzaine: 5 }, P2: { jh: 0, ha: 5, jhQuinzaine: 0 } },
  }];
  const tree = Grid({ parcelles: PARCELLES, groupedRows: rows, metrics: [RATIO_METRIC] });
  // Le libellé d'unité reste affiché sous le tiret : c'est le balisage normal.
  assert.deepStrictEqual(bodyCells(tree, 0).slice(1), ['— | %', '— | %', '— | %']);
  assert.deepStrictEqual(footCells(tree).slice(1), ['— | %', '— | %', '— | %']);
});

test('grille ratio — cohabite avec des séries ordinaires sans les perturber', () => {
  const metrics = [
    { key: 'jhQuinzaine', label: 'Réalisé quinz.', unit: 'JH', basis: 'total',
      display: 'total', format: (v) => v.toFixed(1) },
    { key: 'budgetQuinzaine', label: 'Engagé quinz.', unit: 'JH', basis: 'perHa',
      display: 'total', format: (v) => v.toFixed(1) },
    RATIO_METRIC,
  ];
  const tree = Grid({ parcelles: PARCELLES, groupedRows: RATIO_ROWS, metrics });
  // 3 séries × 2 parcelles = 6 sous-colonnes, puis la colonne Total — éclatée
  // elle aussi en une sous-colonne par série (indices 7 à 9).
  // Réalisé 21 JH, engagé 22 JH, 95,5 % — les trois séries du total de ligne.
  assert.deepStrictEqual(bodyCells(tree, 0).slice(7, 10), ['21.0', '22.0', '95.5']);
  // Et dans le corps, une sous-colonne par série : le libellé n'est plus répété.
  assert.deepStrictEqual(bodyCells(tree, 0).slice(1, 7),
    ['1.0', '2.0', '50.0', '20.0', '20.0', '100.0']);
});

// ===========================================================================
// 4. SAISIE — CampagneBudgetTab
// ===========================================================================

const CBT = (function () {
  const sandbox = { window: {}, fetch: function () { return new Promise(function () {}); } };
  sandbox.window.React = {
    createElement: function () { return null; },
    Fragment: 'Fragment',
    useState: function (i) { return [i, function () {}]; },
    useEffect: function () {},
    useMemo: function (fn) { return fn(); },
  };
  vm.createContext(sandbox);
  sandbox.window.CultureUtils = loadEsm('src/modules/shared/lib/cultureUtils.js', { sandbox: sandbox });
  return loadComponent('src/modules/finance/CampagneBudgetTab.jsx', sandbox).CampagneBudgetTab;
})();

test('saisie — quinzaineApplicable : framboise et myrtille oui, avocatier et inconnu non', () => {
  assert.strictEqual(CBT.quinzaineApplicable('Framboise'), true);
  assert.strictEqual(CBT.quinzaineApplicable('Myrtille'), true);
  assert.strictEqual(CBT.quinzaineApplicable('Avocatier'), false);
  // Fail-closed, comme le serveur : pas de culture, pas d'engagement.
  assert.strictEqual(CBT.quinzaineApplicable(''), false);
  assert.strictEqual(CBT.quinzaineApplicable(null), false);
});

test('saisie — les cultures autorisées sont les MÊMES des deux côtés', () => {
  assert.deepStrictEqual(
    plain(CBT.CULTURES_QUINZAINE).slice().sort(),
    backendBudget.CULTURES_BUDGET_QUINZAINE.slice().sort()
  );
});

test('saisie — payload : la quinzaine éditée SEULE, toutes les familles, vides à 0', () => {
  const r = CBT.buildSavePayload({
    campagne: '2026-2027', label: 'F5- CASCADE -S13',
    familles: ['Taille', 'Récolte'],
    values: { Taille: '2' },
    quinzaine: 'Q07',
    quinzValues: { Taille: '0,5' },
  });
  assert.strictEqual(r.ok, true);
  // Une seule quinzaine : le backend est autoritaire sur celles qu'il reçoit et
  // conserve les autres — envoyer tout le reste risquerait de les écraser.
  assert.deepStrictEqual(plain(r.payload.budgets_quinzaine), {
    Q07: { Taille: 0.5, 'Récolte': 0 },
  });
});

test('saisie — sans quinzaine éditée, le champ n\'est PAS envoyé', () => {
  // Une map vide effacerait l'engagement en base : « je ne saisis rien » ne doit
  // pas se traduire par « supprime tout ».
  const r = CBT.buildSavePayload({
    campagne: '2026-2027', label: 'F5- CASCADE -S13', familles: ['Taille'],
    values: { Taille: '2' },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual('budgets_quinzaine' in r.payload, false);
});

test('saisie — une valeur de quinzaine invalide arrête le save avec un message situé', () => {
  const r = CBT.buildSavePayload({
    campagne: '2026-2027', label: 'F5- CASCADE -S13', familles: ['Taille'],
    values: {}, quinzaine: 'Q07', quinzValues: { Taille: 'abc' },
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /quinzaine invalide.*Taille/i);
});

test('saisie — quinzainesSupprimees : ce qui était engagé et ne l\'est plus', () => {
  const out = CBT.quinzainesSupprimees({
    familles: ['Taille', 'Récolte', 'Plantation'],
    enregistrees: { Taille: 2, 'Récolte': 5 },
    values: { Taille: '', 'Récolte': '3', Plantation: '1' },
  });
  assert.deepStrictEqual(plain(out), [{ famille: 'Taille', valeur: 2 }]);
  assert.deepStrictEqual(plain(CBT.quinzainesSupprimees({ familles: ['Taille'] })), []);
});

test('saisie — le rapport post-save nomme les engagements supprimés ET purgés', () => {
  const m = CBT.saveMessage({
    quinzaines_supprimees: [{ quinzaine: 'Q07', famille: 'Taille', valeur_precedente: 2 }],
    quinzaines_purgees: ['Q07 — Ancienne famille'],
  });
  assert.strictEqual(m.type, 'ok');
  assert.strictEqual(m.purge, true);   // ambre : ça a supprimé des données
  assert.match(m.text, /engagement de quinzaine supprimé : Q07 Taille \(2\)/);
  assert.match(m.text, /engagement de quinzaine obsolète retiré : Q07 — Ancienne famille/);
});

test('saisie — un save sans effet de bord reste un simple « Budget enregistré »', () => {
  assert.deepStrictEqual(
    plain(CBT.saveMessage({ quinzaines_supprimees: [], quinzaines_purgees: [] })),
    { type: 'ok', text: 'Budget enregistré' }
  );
});

// ===========================================================================
// 5. RENDU DE LA VUE QUINZAINE (CampagneAnalytiqueTab.PivotView)
// ===========================================================================
//
// Même technique que tests/unit/campagneAnalytiquePivot.test.js : dépendances
// RÉELLES (pivot, budget, culture), états injectés par position.

let pivotStateQueue = [];

function loadPivotTab() {
  const sandbox = { window: {}, console, document: undefined };
  sandbox.window.React = {
    createElement: function (type, props, ...children) {
      const flat = [];
      const push = (c) => {
        if (Array.isArray(c)) c.forEach(push);
        else if (c != null && c !== false) flat.push(c);
      };
      children.forEach(push);
      const p = Object.assign({}, props || {});
      if (typeof type === 'function') {
        if (flat.length) p.children = flat.length === 1 ? flat[0] : flat;
        return type(p);
      }
      return { type, key: p.key, props: p, children: flat };
    },
    Fragment: 'Fragment',
    useState: function (init) {
      const v = pivotStateQueue.length ? pivotStateQueue.shift() : init;
      return [v, function () {}];
    },
    useEffect: function () {},
    useMemo: function (fn) { return fn(); },
  };
  vm.createContext(sandbox);
  sandbox.window.CultureUtils = loadEsm('src/modules/shared/lib/cultureUtils.js', { sandbox: sandbox });
  sandbox.window.AnalytiqueUtils = loadEsm('src/modules/shared/lib/analytiqueUtils.js', { sandbox: sandbox });
  sandbox.window.CampagneBudgetPivot = loadEsm('src/modules/shared/lib/campagneBudgetPivot.js', { sandbox: sandbox });
  sandbox.window.CampagneRythme = loadEsm('src/modules/shared/lib/campagneRythme.js', { sandbox: sandbox });
  sandbox.window.CampagneBudgetQuinzaine = loadEsm('src/modules/shared/lib/campagneBudgetQuinzaine.js', { sandbox: sandbox });
  return loadComponent('src/modules/finance/CampagneAnalytiqueTab.jsx', sandbox).CampagneAnalytiqueTab;
}

const PivotTab = loadPivotTab();

/** Une parcelle Framboise de 2 Ha, deux quinzaines pointées. */
const PV_DATA = {
  campagne: '2026-2027',
  periodes: ['Quinzaine 03', 'Quinzaine 04'],
  haByRef: {},
  rows: [
    { parcelle: 'F1- S5 MARAVILLA', refParcelle: 'F1S5', ferme: 'F1', periode: 'Quinzaine 03',
      operation: 'Taille longue', famille: 'Taille', code: 'GB09', jh: 30, cout: 4500, nbOuv: 5 },
    { parcelle: 'F1- S5 MARAVILLA', refParcelle: 'F1S5', ferme: 'F1', periode: 'Quinzaine 04',
      operation: 'Taille longue', famille: 'Taille', code: 'GB09', jh: 6, cout: 900, nbOuv: 2 },
  ],
};
const PV_SB = { 'F1- S5 MARAVILLA': { culture_sb: 'Framboise', nom_sb: 'S5 MARAVILLA', ha: 2 } };
// 4 JH/Ha engagés sur Q04 → 8 JH ; 6 JH réalisés → 75 % consommé.
const PV_QUINZ = { 'F1- S5 MARAVILLA': { Q04: { Taille: 4 }, Q03: { Taille: 20 } } };

function renderPivot(props, states) {
  pivotStateQueue = (states || []).slice();
  return PivotTab.PivotView(Object.assign({
    data: PV_DATA, sbMap: PV_SB, metric: 'jh', setMetric: function () {},
    budgetsByLabel: {}, opBudgetsByLabel: {}, quinzainesByLabel: PV_QUINZ,
    refOperations: [],
  }, props || {}));
}

test('vue quinzaine — la bascule est proposée, la vue annuelle reste le défaut', () => {
  const tree = renderPivot();
  const txt = textOf(tree);
  assert.ok(txt.indexOf('Quinzaine') >= 0, 'la bascule Annuel/Quinzaine doit être proposée');
  // Défaut = annuel : la cellule ne porte pas encore les séries de quinzaine.
  assert.ok(textOf(section(tree, 'tbody')).indexOf('Engagé quinz.') < 0);
});

test('vue quinzaine — trois sous-colonnes : réalisé de la quinzaine, engagé, % consommé', () => {
  // [totalMode, detailMode, detailCell, vueQuinzaine, quinzaineSel]
  const tree = renderPivot(null, [false, false, null, true, '']);
  const cells = bodyCells(tree, 1);   // 0 = bandeau groupe, 1 = ligne famille
  // Une seule parcelle : sous-colonnes 1..3, puis la colonne Total.
  // Réalisé de Q04 = 6 JH sur 2 Ha = 3.0 JH/Ha (et NON les 36 JH cumulés).
  assert.deepStrictEqual(cells.slice(1, 4), ['3.0', '4.0', '75.0 %']);
  // Les libellés de série sont passés en EN-TÊTE, ils ne sont plus répétés dans
  // la cellule — c'est tout l'objet du lot.
  const trs = walk(section(tree, 'thead')).filter((n) => n.type === 'tr');
  assert.deepStrictEqual((trs[1].children || []).filter((c) => c.type === 'th').map(textOf),
    ['Réalisé quinz. | JH/Ha', 'Engagé quinz. | JH/Ha', '% consommé']);
});

test('vue quinzaine — la légende dit que l\'engagement n\'est pas le budget annuel', () => {
  const tree = renderPivot(null, [false, false, null, true, '']);
  assert.match(textOf(tree), /indépendant du budget annuel/);
});

test('vue quinzaine — une quinzaine PASSÉE reste consultable', () => {
  // Q03 : 30 JH réalisés sur 2 Ha = 15 JH/Ha, 20 JH/Ha engagés → 75 % aussi,
  // mais sur des chiffres différents : c'est bien la quinzaine choisie qui est lue.
  const tree = renderPivot(null, [false, false, null, true, 'Q03']);
  assert.deepStrictEqual(bodyCells(tree, 1).slice(1, 4), ['15.0', '20.0', '75.0 %']);
});

test('vue quinzaine — aucun engagement : pas de bascule, la vue annuelle tient', () => {
  const tree = renderPivot({ quinzainesByLabel: {} }, [false, false, null, true, '']);
  const cellule = bodyCells(tree, 1)[1];
  assert.ok(cellule.indexOf('Engagé quinz.') < 0, cellule);
  // Repli sur la vue annuelle, série unique : le RÉALISÉ CUMULÉ de la campagne
  // (36 JH sur 2 Ha), et le libellé de série n'est pas affiché — balisage
  // historique d'une grille à une seule série.
  assert.strictEqual(cellule, '18.0 | JH/Ha');
});
