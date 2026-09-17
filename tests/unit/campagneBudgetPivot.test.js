'use strict';

// Superposition du BUDGET sur le pivot analytique de l'écran Campagne (LOT 2c) —
// src/modules/shared/lib/campagneBudgetPivot.js.
//
// Ce que ce fichier protège, dans l'ordre des choses qui cassent en silence :
//   1. la RÈGLE MÉTIER : « les opérations écrasent la famille, jamais
//      d'addition ». Elle n'est pas réimplémentée ici, elle est INJECTÉE
//      (`familleTotal`) — et le même scénario est rejoué avec l'implémentation
//      BACKEND et avec son miroir front, pour qu'une divergence se voie ;
//   2. les deux JOINTURES muettes : parcelle (label BEE ONE normalisé) et
//      famille (nom du référentiel → code GB, via AnalytiqueUtils.resolveGbCode) ;
//   3. le cas NOMINAL « aucun budget saisi » : cellule ABSENTE, jamais 0 ;
//   4. le Ha inconnu (F2 - ZUTANO en production) : budget lisible en JH/Ha,
//      écart non calculable ;
//   5. les lignes AJOUTÉES (famille/opération budgétée jamais travaillée) et
//      leur position canonique — un budget non consommé doit rester visible ;
//   6. la NON-RÉGRESSION du réalisé : mêmes clés, même ordre, mêmes valeurs.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '../..');

const CBP = require('./_esm').loadEsm('src/modules/shared/lib/campagneBudgetPivot.js');
const AU = require('./_esm').loadEsm('src/modules/shared/lib/analytiqueUtils.js');
const backend = require(path.join(ROOT, 'functions/lib/campagneBudget/validate.js'));

/** Miroir FRONT de la règle métier — celui qui tourne réellement en prod. */
const front = (function () {
  const sandbox = { window: { React: { createElement: function () {} } }, console };
  vm.createContext(sandbox);
  const file = path.join(ROOT, 'public/components/CampagneBudgetTab.jsx');
  const code = require('@babel/core').transformSync(fs.readFileSync(file, 'utf8'), {
    presets: [require.resolve('@babel/preset-react')],
    filename: file, babelrc: false, configFile: false,
  }).code;
  vm.runInContext(code, sandbox);
  return sandbox.window.CampagneBudgetTab;
})();

const REGLES = {
  backend: { familleTotal: backend.familleTotal, splitOpKey: backend.splitOpKey },
  front: { familleTotal: front.familleTotal, splitOpKey: front.splitOpKey },
};

// ------------------------------------------------------------------ fixtures
//
// Trois parcelles : P2 (2 Ha), P4 (4 Ha) et P0 (Ha INCONNU, comme « F2 - ZUTANO »).
//   RÉALISÉ  P2 : Taille 30 JH, Récolte 20 JH
//            P4 : Récolte 20 JH
//            P0 : Taille 7 JH
//   BUDGET   P2 : Taille 5 JH/Ha (niveau famille)
//                 Ferti-irrigation 3 JH/Ha (niveau opération, JAMAIS travaillée)
//            P4 : Récolte 4 JH/Ha
//            P0 : Taille 2 JH/Ha
//   P4 n'a AUCUN budget de Taille : c'est le cas nominal « pas de budget ».

const ROWS = [
  { parcelle: 'P2', ha: 2, jh: 30, cout: 4500, operation: 'Taille longue',
    operationGroupe: 'GB09', operationFamille: 'Taille' },
  { parcelle: 'P2', ha: 2, jh: 20, cout: 3000, operation: 'Cueillette',
    operationGroupe: 'GB08', operationFamille: 'Récolte' },
  { parcelle: 'P4', ha: 4, jh: 20, cout: 4000, operation: 'Cueillette',
    operationGroupe: 'GB08', operationFamille: 'Récolte' },
  { parcelle: 'P0', ha: 0, jh: 7, cout: 900, operation: 'Taille longue',
    operationGroupe: 'GB09', operationFamille: 'Taille' },
];

const BUDGETS = {
  P2: { Taille: 5 },
  P4: { 'Récolte': 4 },
  P0: { Taille: 2 },
};
const OP_BUDGETS = {
  P2: { 'Ferti-irrigation': { 'GB02::Fertigation': 3 } },
};

function pivot(detail) {
  return AU.buildAnalytiquePivotByFamille(ROWS, { detail: !!detail });
}

function build(opts) {
  const o = opts || {};
  const p = pivot(o.detail);
  return CBP.buildBudgetPivot({
    groupedRows: p.groupedRows,
    parcelles: p.parcelles,
    budgetsByLabel: o.budgetsByLabel === undefined ? BUDGETS : o.budgetsByLabel,
    opBudgetsByLabel: o.opBudgetsByLabel === undefined ? OP_BUDGETS : o.opBudgetsByLabel,
    analytique: AU,
    budgetRules: o.budgetRules || REGLES.front,
    detail: o.detail,
  });
}

/** [type, clé, libellé] de chaque ligne — la signature d'ordre du pivot. */
function signature(rows) {
  return rows.map((r) => [r.type, r.key, r.label]);
}

function cell(rows, key, parcelle) {
  const row = rows.filter((r) => r.key === key)[0];
  return row && row.pivot[parcelle];
}

// -------------------------------------------------------------------- tests

test('règle métier — les opérations ÉCRASENT la famille, jamais la somme', () => {
  // Ferti-irrigation : 10 au niveau famille ET 3 + 1 au niveau opération.
  // Le total attendu est 4 (les opérations), surtout pas 14.
  const out = build({
    budgetsByLabel: { P2: { 'Ferti-irrigation': 10 } },
    opBudgetsByLabel: {
      P2: { 'Ferti-irrigation': { 'GB02::Fertigation': 3, 'GB02::Nettoyage goutteurs': 1 } },
    },
  });
  assert.strictEqual(cell(out.groupedRows, 'GB02', 'P2').budget, 4);
});

test('règle métier — backend et miroir front donnent le MÊME budget', () => {
  // Les deux implémentations de `familleTotal` sont indépendantes (le backend ne
  // peut pas requérir public/). Le builder ne doit dépendre d'aucune des deux.
  const parBackend = build({ detail: true, budgetRules: REGLES.backend });
  const parFront = build({ detail: true, budgetRules: REGLES.front });
  assert.deepStrictEqual(
    parBackend.groupedRows.map((r) => [r.key, JSON.stringify(r.pivot)]),
    parFront.groupedRows.map((r) => [r.key, JSON.stringify(r.pivot)])
  );
});

test('jointure famille — nom du référentiel → code GB du pivot (jamais une table parallèle)', () => {
  // « Service générale » (référentiel budget) et « Services généraux » (libellé
  // du pivot) sont le MÊME GB11 : c'est resolveGbCode qui fait le pont.
  const out = build({ budgetsByLabel: { P2: { 'Service générale': 6 } }, opBudgetsByLabel: {} });
  const ligne = out.groupedRows.filter((r) => r.key === 'GB11')[0];
  assert.ok(ligne, 'une ligne GB11 est créée');
  assert.strictEqual(ligne.label, 'Services généraux');
  assert.strictEqual(ligne.pivot.P2.budget, 6);
});

test('jointure parcelle — label BEE ONE normalisé (trim + majuscules)', () => {
  const p = pivot(false);
  const out = CBP.buildBudgetPivot({
    groupedRows: p.groupedRows,
    parcelles: [['f2 - zutano', 3]],
    budgetsByLabel: { 'F2 - ZUTANO': { Taille: 9 } },
    opBudgetsByLabel: {},
    analytique: AU,
    budgetRules: REGLES.front,
  });
  assert.strictEqual(cell(out.groupedRows, 'GB09', 'f2 - zutano').budget, 9);
});

test('aucun budget saisi — la cellule n\'a PAS de champ budget (jamais 0)', () => {
  const out = build();
  // P4 est travaillée en Récolte et budgétée en Récolte, mais pas en Taille.
  const taille = out.groupedRows.filter((r) => r.key === 'GB09')[0];
  assert.strictEqual(taille.pivot.P4, undefined, 'aucune cellule inventée');
  // Récolte sur P2 : réalisée (20 JH) mais NON budgétée → cellule sans budget.
  const recolteP2 = cell(out.groupedRows, 'GB08', 'P2');
  assert.strictEqual(recolteP2.jh, 20);
  assert.ok(!('budget' in recolteP2), 'pas de champ budget, pas un 0');
  assert.strictEqual(CBP.ecartCell(recolteP2), null);
});

test('aucun budget du tout — lignes du réalisé INCHANGÉES et hasBudget = false', () => {
  const p = pivot(true);
  const out = build({ detail: true, budgetsByLabel: {}, opBudgetsByLabel: {} });
  assert.strictEqual(out.hasBudget, false);
  assert.deepStrictEqual(signature(out.groupedRows), signature(p.groupedRows));
  assert.deepStrictEqual(
    out.groupedRows.map((r) => JSON.stringify(r.pivot)),
    p.groupedRows.map((r) => JSON.stringify(r.pivot))
  );
});

test('Ha inconnu — le budget reste lisible en JH/Ha, l\'écart est incalculable', () => {
  const out = build();
  const p0 = cell(out.groupedRows, 'GB09', 'P0');
  assert.strictEqual(p0.budget, 2);
  assert.strictEqual(p0.ha, 0);
  // 7 JH réalisés, 2 JH/Ha budgétés, superficie inconnue → aucun écart possible.
  // Surtout pas « +7 » (qui prendrait le budget pour zéro).
  assert.strictEqual(CBP.ecartCell(p0), null);
});

test('écart — dépassement et sous-consommation, sans plafonnement ni NaN', () => {
  const out = build();
  // P2 Taille : 30 JH réalisés, 5 JH/Ha × 2 Ha = 10 JH budgétés → +20 (×3).
  assert.strictEqual(CBP.ecartCell(cell(out.groupedRows, 'GB09', 'P2')), 20);
  // P4 Récolte : 20 JH réalisés, 4 × 4 = 16 → +4.
  assert.strictEqual(CBP.ecartCell(cell(out.groupedRows, 'GB08', 'P4')), 4);
  // Sous-consommation : 4 JH réalisés sur 10 budgétés → −6.
  assert.strictEqual(CBP.ecartCell({ jh: 4, ha: 2, budget: 5 }), -6);
  // Valeurs aberrantes : jamais NaN, jamais ±∞.
  [{ jh: 5, ha: 2 }, { jh: 5, ha: 0, budget: 3 }, { jh: 5, ha: 2, budget: 0 },
    { jh: 5, ha: 2, budget: 'abc' }, null].forEach((c) => {
    assert.strictEqual(CBP.ecartCell(c), null);
  });
});

test('famille budgétée jamais travaillée — ligne AJOUTÉE à sa place canonique', () => {
  const out = build();
  // Ferti-irrigation (GB02) n'a AUCUN réalisé : sans cette ligne, un budget
  // entièrement non consommé serait invisible. Elle s'insère AVANT Taille
  // (GB02 < GB09), dans le groupe M.O Hors récolte, sans déplacer l'existant.
  assert.deepStrictEqual(signature(out.groupedRows), [
    ['groupe', 'M.O Hors récolte', 'M.O Hors récolte'],
    ['famille', 'GB02', 'Ferti-irrigation'],
    ['famille', 'GB09', 'Taille'],
    ['groupe', 'M.O Récolte', 'M.O Récolte'],
    ['famille', 'GB08', 'Récolte'],
  ]);
  const ajoutee = cell(out.groupedRows, 'GB02', 'P2');
  assert.deepStrictEqual(
    [ajoutee.jh, ajoutee.cout, ajoutee.ha, ajoutee.budget, ajoutee.detailRows],
    [0, 0, 2, 3, []]
  );
  assert.strictEqual(CBP.ecartCell(ajoutee), -6);   // 0 réalisé − 3 × 2 Ha
});

test('famille budgétée dans un groupe M.O absent — le groupe est créé', () => {
  const out = build({
    budgetsByLabel: { P2: { 'Service générale': 6 } },
    opBudgetsByLabel: {},
  });
  assert.deepStrictEqual(signature(out.groupedRows).map((s) => s[2]), [
    'M.O Hors récolte', 'Taille',
    'M.O Récolte', 'Récolte',
    'M.O Service générale', 'Services généraux',
  ]);
});

test('mode Détail — opération budgétée jamais travaillée, sous sa famille', () => {
  const out = build({ detail: true });
  assert.deepStrictEqual(signature(out.groupedRows), [
    ['groupe', 'M.O Hors récolte', 'M.O Hors récolte'],
    ['famille', 'GB02', 'Ferti-irrigation'],
    ['operation', 'GB02::FERTIGATION', 'Fertigation'],
    ['famille', 'GB09', 'Taille'],
    ['operation', 'GB09::TAILLE LONGUE', 'Taille longue'],
    ['groupe', 'M.O Récolte', 'M.O Récolte'],
    ['famille', 'GB08', 'Récolte'],
    ['operation', 'GB08::CUEILLETTE', 'Cueillette'],
  ]);
  assert.strictEqual(cell(out.groupedRows, 'GB02::FERTIGATION', 'P2').budget, 3);
  // Budget saisi au niveau FAMILLE : la ligne opération n'en hérite pas (sinon
  // le même budget serait affiché deux fois à deux mailles différentes).
  const op = cell(out.groupedRows, 'GB09::TAILLE LONGUE', 'P2');
  assert.ok(!('budget' in op));
});

test('mode Récap — aucune ligne opération, même avec un budget par opération', () => {
  const out = build({ detail: false });
  assert.strictEqual(out.groupedRows.filter((r) => r.type === 'operation').length, 0);
});

test('le réalisé n\'est jamais altéré — valeurs et lignes source intactes', () => {
  const p = pivot(true);
  const avant = JSON.stringify(p.groupedRows.map((r) => r.pivot));
  const out = CBP.buildBudgetPivot({
    groupedRows: p.groupedRows, parcelles: p.parcelles,
    budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS,
    analytique: AU, budgetRules: REGLES.front, detail: true,
  });
  // Aucune mutation des cellules d'origine (elles servent aussi à la pop-up).
  assert.strictEqual(JSON.stringify(p.groupedRows.map((r) => r.pivot)), avant);
  // Et les JH restent ceux du pivot, budget ou pas.
  assert.strictEqual(cell(out.groupedRows, 'GB09', 'P2').jh, 30);
  assert.strictEqual(cell(out.groupedRows, 'GB08', 'P4').jh, 20);
});

test('module de règle absent — réalisé seul, jamais un budget deviné', () => {
  const p = pivot(false);
  const out = CBP.buildBudgetPivot({
    groupedRows: p.groupedRows, parcelles: p.parcelles,
    budgetsByLabel: BUDGETS, opBudgetsByLabel: OP_BUDGETS,
    analytique: AU, budgetRules: null,
  });
  assert.strictEqual(out.hasBudget, false);
  assert.strictEqual(out.groupedRows, p.groupedRows);
});

test('budget à 0 — « pas de budget défini », aucune cellule (convention backend)', () => {
  const out = build({ budgetsByLabel: { P2: { Taille: 0 } }, opBudgetsByLabel: {} });
  assert.strictEqual(out.hasBudget, false);
  assert.ok(!('budget' in cell(out.groupedRows, 'GB09', 'P2')));
});
