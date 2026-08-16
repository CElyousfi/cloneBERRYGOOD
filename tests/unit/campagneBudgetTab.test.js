'use strict';

// Charge le composant IIFE (public/components/CampagneBudgetTab.jsx) dans un
// faux `window` (React stubé) — même technique que
// tests/unit/parcellesGroupesPanel.test.js : pas de DOM, pas de RTL (limitation
// documentée du repo), mais React.createElement renvoie un arbre inspectable.
//
// Couvre : les helpers PURS (familles depuis le référentiel, indexation des
// budgets, body du save, total JH) et la règle d'accès de l'écran — un profil
// non autorisé ne doit PAS voir le bouton « Enregistrer ».

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Miroir backend de la règle de total de famille — importé pour vérifier que
// les deux implémentations ne divergent PAS (le backend ne peut pas requérir
// public/, la duplication est imposée ; c'est donc au test de la surveiller).
const backendBudget = require('../../functions/lib/campagneBudget/validate');

const SRC = fs.readFileSync(
  path.join(__dirname, '../../public/components/CampagneBudgetTab.jsx'),
  'utf8'
);

/**
 * Ramène une valeur produite DANS le sandbox vm vers le realm des tests.
 * Sans ça, deepStrictEqual échoue sur l'identité des prototypes (Object/Array
 * du contexte vm ≠ ceux du test), alors que les structures sont identiques.
 */
function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

function createElement(type, props, ...children) {
  const flat = [];
  // Aplatissement RÉCURSIF : depuis la descente au niveau opération, un
  // `familles.map()` renvoie un TABLEAU de lignes (famille + ses opérations),
  // donc des tableaux imbriqués. React les aplatit ; le harnais doit le faire
  // aussi, sinon les lignes d'opération sont invisibles dans les assertions.
  const push = (c) => {
    if (Array.isArray(c)) c.forEach(push);
    else if (c != null && c !== false) flat.push(c);
  };
  children.forEach(push);
  const p = props || {};
  return { type, key: p.key, props: p, children: flat };
}

/**
 * @param {Array<*>} [stateOverrides] valeurs successives de useState DANS
 *   L'ORDRE DES APPELS : [rows, familles, budgetsByLabel, campagne, selected,
 *   values, loading, err, saving, msg, tick, opsByFamille, opBudgetsByLabel,
 *   opValues, openFamilles, confirmList, quinzOptions, quinzCourante, quinzSel,
 *   quinzByLabel, quinzValues, confirmQuinz, portee, varieteSel, cultureSel,
 *   confirmFanout, fanoutResults, touched]. `undefined` = garder l'initial.
 *   ⚠️ Table `S` ci-dessous = source de vérité des index. Tout nouveau
 *   `useState` du composant est APPENDU à la fin, jamais inséré.
 * @param {Object} [spy]
 * @param {Object} [extraWindow] globales posées dans le faux `window` AVANT le
 *   chargement du composant — `CultureUtils` (module <script> séparé en prod)
 *   et `SB_PARCELLE_REF` (référentiel SB). Absents : le composant doit rester
 *   fonctionnel, c'est le cas par défaut des tests historiques.
 */
function load(stateOverrides, spy, extraWindow) {
  const sandbox = {
    window: Object.assign({}, extraWindow || {}),
    // `fetch` compté : c'est la preuve qu'un save a — ou n'a pas — été déclenché.
    fetch: function (url, init) {
      if (spy && spy.fetches) spy.fetches.push({ url: url, init: init });
      return new Promise(function () {});
    },
  };
  let call = 0;
  sandbox.window.React = {
    createElement,
    Fragment: 'Fragment',
    useState: function (initial) {
      const index = call++;
      const override = (stateOverrides || [])[index];
      return [override === undefined ? initial : override, function (v) {
        if (spy) spy.sets.push({ index: index, value: v });
      }];
    },
    useEffect: function (fn, deps) {
      if (spy) spy.effects.push({ fn: fn, deps: deps });
    },
    useMemo: function (fn) { return fn(); },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.CampagneBudgetTab;
}

/** Index des useState de CampagneBudgetTab, dans l'ordre des appels. */
const S = {
  rows: 0, familles: 1, budgetsByLabel: 2, campagne: 3, selected: 4,
  values: 5, loading: 6, err: 7, saving: 8, msg: 9, tick: 10,
  opsByFamille: 11, opBudgetsByLabel: 12, opValues: 13, openFamilles: 14,
  confirmList: 15,
  // Budget de QUINZAINE.
  quinzOptions: 16, quinzCourante: 17, quinzSel: 18, quinzByLabel: 19,
  quinzValues: 20, confirmQuinz: 21,
  // PORTÉE de saisie. `confirmFanout` / `fanoutResults` sont déclarés dans le
  // composant pour figer l'ordre, consommés au lot fan-out.
  portee: 22, varieteSel: 23, cultureSel: 24, confirmFanout: 25, fanoutResults: 26,
  touched: 27,
};

/** Aplatit l'arbre rendu en liste de nœuds. */
function walk(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach(function (c) { walk(c, out); });
  return out;
}

function textOf(node) {
  return walk(node)
    .flatMap(function (n) { return (n.children || []).filter(function (c) { return typeof c === 'string'; }); })
    .join(' | ');
}

const CBT = load();

// ------------------------------------------------------------ famillesFromOps

/** Table code → famille, telle que servie par `referentiel-taches-list`. */
const FAMILLES_PAR_CODE = {
  GB02: 'Ferti-irrigation',
  GB05: 'Entretien structure',
  GB09: 'Taille',
  GB11: 'Service générale',
};

/**
 * Référentiel de test, forme de `referentiel-taches-list`. « Nettoyage » y
 * figure DEUX fois, sous GB05 et sous GB11 — cas réel du référentiel d'Omar.
 */
const REF_OPS = [
  { code: 'GB02', famille: 'Ferti-irrigation', operation: 'Fertigation', ordre: 1 },
  { code: 'GB05', famille: 'Entretien structure', operation: 'Nettoyage', ordre: 2 },
  { code: 'GB09', famille: 'Taille', operation: 'Taille d\'hiver', ordre: 3 },
  { code: 'GB11', famille: 'Service générale', operation: 'Nettoyage', ordre: 4 },
];

test('famillesFromOps — dédupliqué, trié par ordre du référentiel', () => {
  const ops = [
    { code: 'GB09', famille: 'Taille', ordre: 3 },
    { code: 'GB02', famille: 'Ferti-irrigation', ordre: 1 },
    { code: 'GB09', famille: 'Taille', ordre: 4 },
    { code: 'GB05', famille: 'Entretien structure', ordre: 2 },
  ];
  assert.deepStrictEqual(plain(CBT.famillesFromOps(ops, FAMILLES_PAR_CODE)), [
    'Ferti-irrigation', 'Entretien structure', 'Taille',
  ]);
});

test('famillesFromOps — la famille vient du CODE, pas du champ de la fiche', () => {
  // Le tableau Campagne impute les JH via _refMap[code].famille : une fiche dont
  // le champ `famille` diverge (faute de frappe, import partiel) produirait sinon
  // une ligne de budget que le réalisé n'alimenterait jamais.
  const ops = [{ code: 'GB05', famille: 'Entretien Structure ', ordre: 1 }];
  assert.deepStrictEqual(plain(CBT.famillesFromOps(ops, FAMILLES_PAR_CODE)),
    ['Entretien structure']);
  // Sans table de résolution (backend antérieur) : repli sur la fiche.
  assert.deepStrictEqual(plain(CBT.famillesFromOps(ops, {})), ['Entretien Structure']);
});

test('famillesFromOps — tolère vide, null et familles blanches', () => {
  assert.deepStrictEqual(plain(CBT.famillesFromOps(null, FAMILLES_PAR_CODE)), []);
  assert.deepStrictEqual(plain(CBT.famillesFromOps([{ famille: '  ' }, {}], {})), []);
});

// ------------------------------------------------------------ budgetsByLabel

test('budgetsByLabel — indexé par label en MAJUSCULES trimé', () => {
  const map = CBT.budgetsByLabel([
    { label_bee_one: ' f5- cascade -s13 ', budgets: { Taille: 2 } },
    { label_bee_one: '', budgets: { Taille: 9 } },
  ]);
  assert.deepStrictEqual(plain(map), { 'F5- CASCADE -S13': { Taille: 2 } });
});

// ----------------------------------------------------------- buildSavePayload

test('buildSavePayload — envoie TOUTES les familles affichées, vide = 0', () => {
  const r = CBT.buildSavePayload({
    campagne: '2026-2027',
    label: 'F5- CASCADE -S13',
    familles: ['Taille', 'Ferti-irrigation', 'Entretien structure'],
    values: { 'Taille': '2,5', 'Ferti-irrigation': '' },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(plain(r.payload), {
    campagne: '2026-2027',
    label_bee_one: 'F5- CASCADE -S13',
    // Ferti-irrigation vidé → 0 → le backend supprime la ligne (pas d'action
    // de suppression dédiée) ; Entretien structure jamais saisi → 0 aussi.
    budgets: { 'Taille': 2.5, 'Ferti-irrigation': 0, 'Entretien structure': 0 },
    budgets_operations: {},
  });
});

test('buildSavePayload — envoie le détail par opération, vide = 0', () => {
  const r = CBT.buildSavePayload({
    campagne: '2026-2027',
    label: 'P1',
    familles: ['Taille'],
    opsByFamille: { 'Taille': ['Taille d\'hiver', 'Taille de formation'] },
    values: {},
    opValues: { 'Taille': { 'Taille d\'hiver': '1,5' } },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(plain(r.payload.budgets_operations), {
    'Taille': { 'Taille d\'hiver': 1.5, 'Taille de formation': 0 },
  });
});

test('buildSavePayload — une famille détaillée voit sa valeur de famille neutralisée', () => {
  // Sinon l'ancienne valeur de famille (saisie avant la descente au niveau
  // opération) resterait en base et ressortirait après effacement des opérations.
  const r = CBT.buildSavePayload({
    campagne: '2026-2027',
    label: 'P1',
    familles: ['Taille', 'Service générale'],
    opsByFamille: { 'Taille': ['Taille d\'hiver'], 'Service générale': ['Gardiennage'] },
    values: { 'Taille': '9', 'Service générale': '12,5' },
    opValues: { 'Taille': { 'Taille d\'hiver': '2' } },
  });
  assert.strictEqual(r.ok, true);
  // Taille : détaillée → famille remise à 0. Service générale : aucune
  // opération budgétée → la valeur de famille est conservée (cas d'Omar).
  assert.deepStrictEqual(plain(r.payload.budgets), { 'Taille': 0, 'Service générale': 12.5 });
  assert.deepStrictEqual(plain(r.payload.budgets_operations), {
    'Taille': { 'Taille d\'hiver': 2 },
    'Service générale': { 'Gardiennage': 0 },
  });
});

test('buildSavePayload — refuse une valeur d\'opération invalide, message situé', () => {
  const bad = CBT.buildSavePayload({
    campagne: '2026-2027', label: 'P1', familles: ['Taille'],
    opsByFamille: { 'Taille': ['Taille d\'hiver'] },
    values: {}, opValues: { 'Taille': { 'Taille d\'hiver': 'abc' } },
  });
  assert.strictEqual(bad.ok, false);
  assert.match(String(bad.error), /Taille — Taille d'hiver/);
  const neg = CBT.buildSavePayload({
    campagne: '2026-2027', label: 'P1', familles: ['Taille'],
    opsByFamille: { 'Taille': ['Taille d\'hiver'] },
    values: {}, opValues: { 'Taille': { 'Taille d\'hiver': '-1' } },
  });
  assert.strictEqual(neg.ok, false);
});

test('buildSavePayload — envoie les CLÉS (code, opération), message d\'erreur situé par code', () => {
  const r = CBT.buildSavePayload({
    campagne: '2026-2027',
    label: 'P1',
    familles: ['Entretien structure', 'Service générale'],
    opsByFamille: {
      'Entretien structure': ['GB05::Nettoyage'],
      'Service générale': ['GB11::Nettoyage'],
    },
    values: {},
    opValues: {
      'Entretien structure': { 'GB05::Nettoyage': '3' },
      'Service générale': { 'GB11::Nettoyage': '8' },
    },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(plain(r.payload.budgets_operations), {
    'Entretien structure': { 'GB05::Nettoyage': 3 },
    'Service générale': { 'GB11::Nettoyage': 8 },
  });

  const bad = CBT.buildSavePayload({
    campagne: '2026-2027', label: 'P1', familles: ['Entretien structure'],
    opsByFamille: { 'Entretien structure': ['GB05::Nettoyage'] },
    values: {}, opValues: { 'Entretien structure': { 'GB05::Nettoyage': 'abc' } },
  });
  assert.strictEqual(bad.ok, false);
  // Le message doit désigner LAQUELLE des deux opérations « Nettoyage ».
  assert.match(String(bad.error), /Entretien structure — Nettoyage \(GB05\)/);
});

// -------------------------------------------------------------- opsByFamille

test('opsByFamille — groupé par famille, ordre du référentiel, dédupliqué', () => {
  const ops = [
    { code: 'GB09', famille: 'Taille', operation: 'B', ordre: 2 },
    { code: 'GB09', famille: 'Taille', operation: 'A', ordre: 1 },
    { code: 'GB09', famille: 'Taille', operation: 'A', ordre: 3 },
    { code: 'GB02', famille: 'Ferti-irrigation', operation: 'C', ordre: 4 },
    { code: '', famille: '', operation: 'X', ordre: 5 },
    { code: 'GB09', famille: 'Taille', operation: '', ordre: 6 },
  ];
  assert.deepStrictEqual(plain(CBT.opsByFamille(ops, FAMILLES_PAR_CODE)), {
    'Taille': ['GB09::A', 'GB09::B'],
    'Ferti-irrigation': ['GB02::C'],
  });
  assert.deepStrictEqual(plain(CBT.opsByFamille(null, FAMILLES_PAR_CODE)), {});
});

test('opsByFamille — MÊME libellé sous DEUX codes : deux lignes, deux budgets', () => {
  // « Nettoyage » GB05 (Entretien structure) et GB11 (Service générale). Keyer
  // par le libellé seul en perdait une ; keyer par (code, opération) les sépare,
  // exactement comme le tableau Campagne sépare les JH réalisés.
  const byFamille = plain(CBT.opsByFamille(REF_OPS, FAMILLES_PAR_CODE));
  assert.deepStrictEqual(byFamille['Entretien structure'], ['GB05::Nettoyage']);
  assert.deepStrictEqual(byFamille['Service générale'], ['GB11::Nettoyage']);

  // Deux budgets INDÉPENDANTS : la valeur de l'un ne fuit pas dans l'autre.
  const opValues = {
    'Entretien structure': { 'GB05::Nettoyage': '3' },
    'Service générale': { 'GB11::Nettoyage': '8' },
  };
  assert.strictEqual(CBT.familleTotal('Entretien structure', {}, opValues).total, 3);
  assert.strictEqual(CBT.familleTotal('Service générale', {}, opValues).total, 8);
});

test('opsByFamille — deux codes dans la MÊME famille ne se dédupliquent plus', () => {
  // GB03/LB03 partagent la famille « plantation » au référentiel réel. Avec la
  // clé (famille, opération), la seconde opération disparaissait de l'écran.
  const ops = [
    { code: 'GB03', famille: 'plantation', operation: 'Plantation', ordre: 1 },
    { code: 'LB03', famille: 'plantation', operation: 'Plantation', ordre: 2 },
  ];
  assert.deepStrictEqual(
    plain(CBT.opsByFamille(ops, { GB03: 'plantation', LB03: 'plantation' })),
    { 'plantation': ['GB03::Plantation', 'LB03::Plantation'] }
  );
});

// --------------------------------------------------------- operationsByLabel

test('operationsByLabel — indexé par label, document historique = map vide', () => {
  const map = CBT.operationsByLabel([
    { label_bee_one: ' p1 ', budgets_operations: { 'Taille': { 'A': 1 } } },
    // Document du lot précédent : pas de champ budgets_operations, lu tel quel.
    { label_bee_one: 'P2', budgets: { 'Taille': 3 } },
    { label_bee_one: '' },
  ]);
  assert.deepStrictEqual(plain(map), { 'P1': { 'Taille': { 'A': 1 } }, 'P2': {} });
});

// --------------------------------------------------------------- familleTotal

test('familleTotal — somme des opérations si la famille en porte', () => {
  assert.deepStrictEqual(
    plain(CBT.familleTotal('Taille', { 'Taille': '99' }, { 'Taille': { 'A': '1,25', 'B': '2,5' } })),
    { total: 3.75, source: 'operations' }
  );
});

test('familleTotal — sinon la valeur de famille (cas « Service générale »)', () => {
  assert.deepStrictEqual(
    plain(CBT.familleTotal('Service générale', { 'Service générale': '12,5' }, {})),
    { total: 12.5, source: 'famille' }
  );
  // Document historique : aucune map d'opérations du tout.
  assert.deepStrictEqual(
    plain(CBT.familleTotal('Taille', { 'Taille': 3 }, undefined)),
    { total: 3, source: 'famille' }
  );
  // Opérations toutes vides → repli sur la famille.
  assert.deepStrictEqual(
    plain(CBT.familleTotal('Taille', { 'Taille': 4 }, { 'Taille': { 'A': '', 'B': '0' } })),
    { total: 4, source: 'famille' }
  );
});

test('familleTotal — rien de saisi', () => {
  assert.deepStrictEqual(plain(CBT.familleTotal('Taille', {}, {})), { total: 0, source: 'aucun' });
  assert.deepStrictEqual(plain(CBT.familleTotal('Taille', { 'Taille': 'abc' }, {})),
    { total: 0, source: 'aucun' });
});

test('familleTotal — bascule DANS LES DEUX SENS entre famille et opérations', () => {
  // Cas réel « Récolte » : 1800 JH/Ha au niveau famille, 11 opérations vides.
  const values = { 'Récolte': '1800' };
  const vides = { 'Récolte': { 'Cueillette': '', 'Pesée': '' } };
  assert.deepStrictEqual(plain(CBT.familleTotal('Récolte', values, vides)),
    { total: 1800, source: 'famille' });

  // → on renseigne UNE opération : le total bascule sur les opérations.
  const une = { 'Récolte': { 'Cueillette': '12', 'Pesée': '' } };
  assert.deepStrictEqual(plain(CBT.familleTotal('Récolte', values, une)),
    { total: 12, source: 'operations' });

  // → on l'efface : le total redescend sur la valeur de famille.
  assert.deepStrictEqual(
    plain(CBT.familleTotal('Récolte', values, { 'Récolte': { 'Cueillette': '0', 'Pesée': '' } })),
    { total: 1800, source: 'famille' }
  );
});

test('familleTotal — cas MIXTE : les opérations gagnent, jamais d\'addition', () => {
  // « Arrachage » : total de famille saisi ET 8 opérations sur 9 renseignées.
  const r = CBT.familleTotal('Arrachage', { 'Arrachage': '100' },
    { 'Arrachage': { 'A': '3', 'B': '4', 'C': '' } });
  assert.deepStrictEqual(plain(r), { total: 7, source: 'operations' });
  assert.notStrictEqual(r.total, 107, 'les deux niveaux ne s\'additionnent jamais');
});

// ------------------- équivalence des deux miroirs de familleTotal (M1)
//
// La règle de total existe DEUX fois : functions/lib/campagneBudget/validate.js
// (`familleTotal`) et le composant (`CBT_familleTotal`). Le backend ne peut pas
// requérir public/ (CLAUDE.md), la duplication est donc imposée — mais rien ne
// détectait une dérive, et le miroir backend est dormant jusqu'au lot export :
// la divergence n'apparaîtrait qu'à sa mise en service. Corpus PARTAGÉ, rejoué
// contre les deux, égalité stricte exigée.

const CORPUS_FAMILLE_TOTAL = [
  // [libellé, famille, budgets, budgetsOperations]
  ['rien', 'F', {}, {}],
  ['famille seule', 'F', { F: 3 }, {}],
  ['famille seule, document legacy sans map opérations', 'F', { F: 3 }, undefined],
  ['famille seule, maps nulles', 'F', null, null],
  ['opérations seules', 'F', {}, { F: { A: 1, B: 2 } }],
  ['mixte : opérations prioritaires', 'F', { F: 100 }, { F: { A: 3, B: 4 } }],
  ['opérations toutes nulles → repli famille', 'F', { F: 4 }, { F: { A: 0, B: '' } }],
  ['opérations négatives ignorées', 'F', { F: 4 }, { F: { A: -2 } }],
  ['chaînes FR', 'F', { F: '2,5' }, { F: { A: '1,1', B: '2,2' } }],
  ['valeur famille non numérique', 'F', { F: 'abc' }, {}],
  ['valeur opération non numérique', 'F', { F: 2 }, { F: { A: 'abc' } }],
  ['arrondi 2 décimales', 'F', {}, { F: { A: 0.005, B: 0.005 } }],
  ['famille absente des deux maps', 'F', { G: 5 }, { G: { A: 1 } }],
  ['famille null', null, { F: 1 }, {}],
  ['map opérations de la famille = tableau', 'F', { F: 7 }, { F: [1, 2] }],
  ['map opérations de la famille = scalaire', 'F', { F: 7 }, { F: 5 }],
  ['map opérations de la famille = null', 'F', { F: 7 }, { F: null }],
  ['budgets = tableau', 'F', [1, 2], { F: { A: 1 } }],
  ['« Récolte » : 1800 au niveau famille, 11 opérations vides', 'Récolte',
    { 'Récolte': 1800 }, { 'Récolte': { A: '', B: '', C: '' } }],
  ['« Récolte » : une opération renseignée', 'Récolte',
    { 'Récolte': 1800 }, { 'Récolte': { A: 12, B: '', C: '' } }],
];

test('familleTotal — front et back donnent le MÊME résultat sur corpus partagé', () => {
  CORPUS_FAMILLE_TOTAL.forEach(function (cas) {
    const [libelle, famille, budgets, ops] = cas;
    const front = plain(CBT.familleTotal(famille, budgets, ops));
    const back = backendBudget.familleTotal(famille, budgets, ops);
    assert.deepStrictEqual(front, back, 'divergence front/back — cas : ' + libelle);
  });
});

test('familleTotal — le corpus partagé couvre bien les trois sources', () => {
  // Garde-fou du garde-fou : un corpus qui n'exercerait qu'une branche
  // laisserait passer une dérive sur les autres.
  const sources = new Set(CORPUS_FAMILLE_TOTAL.map(function (cas) {
    return backendBudget.familleTotal(cas[1], cas[2], cas[3]).source;
  }));
  assert.deepStrictEqual([...sources].sort(), ['aucun', 'famille', 'operations']);
});

// ------------------- équivalence des miroirs de la CLÉ (code, opération)
//
// `opKey` / `splitOpKey` / `familleDuCode` existent DEUX fois (composant +
// functions/lib/campagneBudget/validate.js). Une dérive rendrait le budget
// illisible par le backend — clés écrites d'un côté, cherchées de l'autre.
// Corpus PARTAGÉ, égalité stricte exigée.

const CORPUS_OP_KEY = [
  ['nominal', 'GB05', 'Nettoyage'],
  ['casse et espaces', ' gb05 ', ' Nettoyage '],
  ['sans code (document antérieur)', '', 'Nettoyage'],
  ['code null', null, 'Nettoyage'],
  ['code non conforme (un libellé de famille)', 'Entretien structure', 'Nettoyage'],
  ['libellé vide', 'GB05', ''],
  ['libellé contenant le séparateur', 'GB05', 'Sortie :: retour'],
  ['tout absent', null, null],
];

test('opKey — front et back donnent la MÊME clé sur corpus partagé', () => {
  CORPUS_OP_KEY.forEach(function (cas) {
    const [libelle, code, operation] = cas;
    assert.strictEqual(CBT.opKey(code, operation), backendBudget.opKey(code, operation),
      'divergence front/back — cas : ' + libelle);
  });
});

test('splitOpKey — front et back décomposent à l\'identique', () => {
  const cles = ['GB05::Nettoyage', 'Nettoyage', 'Sortie :: retour', '::X', '', null,
    'GB05::', 'gb05::Nettoyage'];
  cles.forEach(function (k) {
    assert.deepStrictEqual(plain(CBT.splitOpKey(k)), backendBudget.splitOpKey(k),
      'divergence front/back — clé : ' + String(k));
  });
});

test('familleDuCode — front et back résolvent la MÊME famille', () => {
  const map = { GB05: { famille: 'Entretien structure' }, GB11: 'Service générale' };
  const cas = [
    ['GB05', 'Entretien Structure', map],
    ['GB11', 'Autre', map],
    ['GB99', ' Récolte ', map],
    ['', 'Récolte', map],
    ['GB05', 'X', null],
    [null, null, map],
    ['GB05', 'X', []],
  ];
  cas.forEach(function (c) {
    assert.strictEqual(
      CBT.familleDuCode(c[0], c[1], c[2]),
      backendBudget.familleDuCode(c[0], c[1], c[2]),
      'divergence front/back — code : ' + String(c[0])
    );
  });
});

test('operationLabel — le code est affiché quand la clé en porte un', () => {
  assert.strictEqual(CBT.operationLabel('GB05::Nettoyage'), 'Nettoyage (GB05)');
  assert.strictEqual(CBT.operationLabel('Nettoyage'), 'Nettoyage');
});

// ---------------------------------------------------- famillesNeutralisees

test('famillesNeutralisees — liste les valeurs de famille qui vont être remplacées', () => {
  const r = CBT.famillesNeutralisees({
    familles: ['Récolte', 'Arrachage', 'Service générale', 'Taille'],
    values: { 'Récolte': '1800', 'Arrachage': '100', 'Service générale': '12', 'Taille': '' },
    opValues: {
      'Récolte': { 'Cueillette': '12' },   // mixte → neutralisée
      'Arrachage': { 'A': '', 'B': '' },   // aucune opération → intacte
      'Service générale': {},              // aucune opération → intacte
      'Taille': { 'A': '3' },              // pas de valeur famille → rien à perdre
    },
  });
  assert.deepStrictEqual(plain(r), [{ famille: 'Récolte', valeur: 1800, total: 12 }]);
});

test('famillesNeutralisees — une famille REPLIÉE, jamais éditée, est bien listée', () => {
  // Cas central : le save est global à la parcelle. « Récolte » est repliée
  // (elle n'apparaît pas à l'écran), l'utilisateur enregistre pour « Taille »,
  // et la valeur de Récolte tombe. Sans cette liste, il ne peut pas le savoir.
  const r = CBT.famillesNeutralisees({
    familles: ['Taille', 'Récolte'],
    values: { 'Taille': '', 'Récolte': '1800' },
    opValues: { 'Taille': { 'A': '2' }, 'Récolte': { 'Cueillette': '5' } },
  });
  assert.deepStrictEqual(plain(r), [{ famille: 'Récolte', valeur: 1800, total: 5 }]);
});

test('famillesNeutralisees — rien à confirmer dans le cas nominal', () => {
  assert.deepStrictEqual(plain(CBT.famillesNeutralisees({
    familles: ['Récolte'],
    values: { 'Récolte': '1800' },
    opValues: { 'Récolte': { 'Cueillette': '', 'Pesée': '' } },
  })), []);
  assert.deepStrictEqual(plain(CBT.famillesNeutralisees({})), []);
});

test('buildSavePayload — cas MIXTE : la valeur de famille est neutralisée en base', () => {
  const r = CBT.buildSavePayload({
    campagne: '2026-2027', label: 'P1',
    familles: ['Arrachage', 'Récolte'],
    opsByFamille: { 'Arrachage': ['A', 'B'], 'Récolte': ['Cueillette'] },
    values: { 'Arrachage': '100', 'Récolte': '1800' },
    opValues: { 'Arrachage': { 'A': '3', 'B': '4' }, 'Récolte': { 'Cueillette': '' } },
  });
  assert.strictEqual(r.ok, true);
  // Arrachage détaillé → 0 ; Récolte sans opération renseignée → 1800 conservé.
  assert.deepStrictEqual(plain(r.payload.budgets), { 'Arrachage': 0, 'Récolte': 1800 });
  assert.deepStrictEqual(plain(r.payload.budgets_operations), {
    'Arrachage': { 'A': 3, 'B': 4 },
    'Récolte': { 'Cueillette': 0 },
  });
});

test('buildSavePayload — refuse campagne/parcelle manquante et valeur invalide', () => {
  const base = { campagne: '2026-2027', label: 'P1', familles: ['Taille'], values: {} };
  assert.strictEqual(CBT.buildSavePayload(Object.assign({}, base, { campagne: '' })).ok, false);
  assert.strictEqual(CBT.buildSavePayload(Object.assign({}, base, { label: '' })).ok, false);
  assert.strictEqual(CBT.buildSavePayload(Object.assign({}, base, { familles: [] })).ok, false);
  const bad = CBT.buildSavePayload(Object.assign({}, base, { values: { Taille: 'abc' } }));
  assert.strictEqual(bad.ok, false);
  assert.match(String(bad.error), /Valeur invalide/);
  assert.strictEqual(CBT.buildSavePayload(Object.assign({}, base, { values: { Taille: '-2' } })).ok, false);
});

// ---------------------------------------------------------------- saveMessage

test('saveMessage — sans purge : message de succès inchangé', () => {
  assert.deepStrictEqual(plain(CBT.saveMessage({ success: true })),
    { type: 'ok', text: 'Budget enregistré' });
  assert.deepStrictEqual(plain(CBT.saveMessage({ familles_purgees: [] })),
    { type: 'ok', text: 'Budget enregistré' });
  // Réponse absente ou champ non conforme → jamais de mention de purge.
  assert.strictEqual(CBT.saveMessage(null).purge, undefined);
  assert.strictEqual(CBT.saveMessage({ familles_purgees: 'Taille' }).purge, undefined);
  assert.strictEqual(CBT.saveMessage({ familles_purgees: ['', '  '] }).purge, undefined);
});

test('saveMessage — avec purge : suppression annoncée, accord singulier/pluriel', () => {
  const un = CBT.saveMessage({ familles_purgees: ['Ancienne famille'] });
  assert.strictEqual(un.type, 'ok');
  assert.strictEqual(un.purge, true);
  assert.strictEqual(un.text,
    'Budget enregistré — 1 famille obsolète retirée : Ancienne famille');

  const deux = CBT.saveMessage({ familles_purgees: ['Famille A', ' Famille B '] });
  assert.strictEqual(deux.text,
    'Budget enregistré — 2 familles obsolètes retirées : Famille A, Famille B');
});

test('saveMessage — les valeurs de famille remplacées sont rapportées après le save', () => {
  // Seule source fiable de ce qui a RÉELLEMENT été remplacé (familles hors
  // écran comprises) : la réponse du backend.
  const un = CBT.saveMessage({
    familles_neutralisees: [{ famille: 'Récolte', valeur_precedente: 1800 }],
  });
  assert.strictEqual(un.type, 'ok');
  assert.strictEqual(un.purge, true, 'doit passer en ambre, pas en succès neutre');
  assert.strictEqual(un.text,
    'Budget enregistré — 1 valeur de famille remplacée par le détail des opérations : Récolte (1800)');

  const deux = CBT.saveMessage({
    familles_neutralisees: [
      { famille: 'Récolte', valeur_precedente: 1800 },
      { famille: 'Arrachage', valeur_precedente: 100 },
    ],
  });
  assert.strictEqual(deux.text,
    'Budget enregistré — 2 valeurs de famille remplacées par le détail des opérations :'
    + ' Récolte (1800), Arrachage (100)');

  // Bruit ignoré, jamais de fausse alerte.
  assert.strictEqual(CBT.saveMessage({ familles_neutralisees: [] }).purge, undefined);
  assert.strictEqual(CBT.saveMessage({ familles_neutralisees: 'Récolte' }).purge, undefined);
  assert.strictEqual(CBT.saveMessage({ familles_neutralisees: [{ famille: '  ' }, null] }).purge,
    undefined);
});

test('saveMessage — purge reportée : annoncée comme telle, rien n\'a été supprimé', () => {
  const m = CBT.saveMessage({ purge_differee: 4 });
  assert.strictEqual(m.purge, true);
  assert.match(String(m.text), /nettoyage de 4 entrées obsolètes reporté/);
  assert.match(String(m.text), /rien n'a été supprimé/);
  assert.strictEqual(CBT.saveMessage({ purge_differee: 0 }).purge, undefined);
});

test('saveMessage — les trois effets de bord se cumulent dans un seul message', () => {
  const m = CBT.saveMessage({
    familles_neutralisees: [{ famille: 'Récolte', valeur_precedente: 1800 }],
    familles_purgees: ['Ancienne famille'],
    operations_purgees: ['Taille — Op X'],
  });
  assert.ok(m.text.includes('Récolte (1800)'));
  assert.ok(m.text.includes('Ancienne famille'));
  assert.ok(m.text.includes('Taille — Op X'));
});

test('saveMessage — les opérations purgées sont annoncées elles aussi', () => {
  const ops = CBT.saveMessage({ operations_purgees: ['Taille — Op X'] });
  assert.strictEqual(ops.purge, true);
  assert.strictEqual(ops.text, 'Budget enregistré — 1 opération obsolète retirée : Taille — Op X');

  const deux = CBT.saveMessage({
    familles_purgees: ['Famille A'],
    operations_purgees: ['Taille — Op X', 'Taille — Op Y'],
  });
  assert.strictEqual(deux.text,
    'Budget enregistré — 1 famille obsolète retirée : Famille A'
    + ' ; 2 opérations obsolètes retirées : Taille — Op X, Taille — Op Y');
  assert.strictEqual(CBT.saveMessage({ operations_purgees: [] }).purge, undefined);
});

// ------------------------------------------------------------------- totalJH

test('totalJH — JH/Ha × Ha, arrondi 2 décimales, 0 si donnée absente', () => {
  assert.strictEqual(CBT.totalJH('2,5', 4), 10);
  assert.strictEqual(CBT.totalJH(1.234, 3), 3.7);
  assert.strictEqual(CBT.totalJH('', 3), 0);
  assert.strictEqual(CBT.totalJH(2, null), 0);
});

// ------------------------------------------------------ parcelleAffichable
//
// Masquage de l'avocatier : décision d'INTERFACE (aucun gate serveur, aucune
// purge). Le composant est ici chargé AVEC `window.CultureUtils`, comme en prod
// (module <script> séparé).

const CULTURE_UTILS = require('../../public/lib/cultureUtils.js');
const CBT_CU = load(undefined, undefined, { CultureUtils: CULTURE_UTILS });

test('cultureRow — résolue par culture_sb en priorité, repli sur le libellé', () => {
  // culture_sb (donnée saisie à la main) fait autorité…
  assert.strictEqual(
    CBT_CU.cultureRow({ label: 'F2 ZUTANO' }, { 'F2 ZUTANO': { culture_sb: 'Framboise' } }),
    'Framboise'
  );
  // …et à défaut, repli heuristique sur le libellé (jamais normCulture seul).
  assert.strictEqual(CBT_CU.cultureRow({ label: 'F2 ZUTANO' }, {}), 'Avocatier');
});

test('parcelleAffichable — masquée par le REPLI sur le libellé (« F2 ZUTANO »)', () => {
  // Cas réel : 14 des 17 libellés n'ont pas de culture_sb. Sans le repli,
  // l'avocatier resterait proposé.
  assert.strictEqual(
    CBT_CU.parcelleAffichable({ label: 'F2 ZUTANO', culture: '' }, {}),
    false
  );
});

test('parcelleAffichable — masquée par culture_sb, même sur un libellé de framboise', () => {
  assert.strictEqual(
    CBT_CU.parcelleAffichable(
      { label: 'S12 - MARAVILLA', culture: 'Framboise' },
      { 'S12 - MARAVILLA': { culture_sb: 'Avocatier' } }
    ),
    false
  );
});

test('parcelleAffichable — culture_sb qui contredit un libellé suspect GAGNE', () => {
  // La donnée humaine bat l'heuristique : une parcelle nommée « F2 ZUTANO » mais
  // déclarée Framboise au référentiel reste saisissable.
  assert.strictEqual(
    CBT_CU.parcelleAffichable(
      { label: 'F2 ZUTANO' },
      { 'F2 ZUTANO': { culture_sb: 'Framboise' } }
    ),
    true
  );
});

test('parcelleAffichable — culture INCONNUE reste visible (liste d\'exclusion, fail-open)', () => {
  assert.strictEqual(
    CBT_CU.parcelleAffichable({ label: 'P9' }, { P9: { culture_sb: 'Pitaya' } }),
    true
  );
  assert.deepStrictEqual(plain(CBT_CU.CULTURES_MASQUEES), ['Avocatier']);
});

test('parcelleAffichable — sans CultureUtils chargé, rien n\'est masqué', () => {
  // Le module est un <script> séparé : un 404 ne doit pas faire disparaître des
  // parcelles de l'écran de saisie.
  assert.strictEqual(CBT.cultureRow({ label: 'F2 ZUTANO' }, {}), '');
  assert.strictEqual(CBT.parcelleAffichable({ label: 'F2 ZUTANO' }, {}), true);
  assert.strictEqual(CBT.parcelleAffichable(null, null), true);
});

// ------------------------------------------------------------------- portée
//
// Helpers de PORTÉE (Parcelle / Variété / Culture). Le stockage reste par
// parcelle : la portée ne sert qu'à saisir une grille une fois et à l'écrire
// sur les N parcelles cibles.

/** Parcelles de campagne, forme de `parcelles-campagne-list` (champ `variete`). */
const ROWS_PORTEE = [
  { label: 'S13 - CORINA', culture: 'Myrtille', variete: 'Corina' },
  { label: 'S8 - CORINA', culture: 'Myrtille', variete: ' corina ' },
  { label: 'S14 - CASCADE', culture: 'Myrtille', variete: 'Cascade' },
  { label: 'S12 - MARAVILLA', culture: 'Framboise', variete: 'Maravilla' },
  // Variété absente : saisissable en portée Parcelle, comptée en Culture, mais
  // JAMAIS proposée comme bucket de variété.
  { label: 'S9 - REYNA', culture: 'Framboise', variete: '' },
];

test('varieteKey — clé composite CULTURE||VARIETE, normalisée', () => {
  assert.strictEqual(
    CBT_CU.varieteKey({ label: 'S8 - CORINA', culture: 'Myrtille', variete: ' co  rina ' }, {}),
    'Myrtille||CO RINA'
  );
  // Chaque bucket est mono-culture : c'est la culture qui gate le masquage et
  // l'applicabilité du budget de quinzaine.
  assert.strictEqual(
    CBT_CU.varieteKey({ label: 'S12 - MARAVILLA', culture: 'Framboise', variete: 'Maravilla' }, {}),
    'Framboise||MARAVILLA'
  );
  // Variété absente → pas de bucket.
  assert.strictEqual(CBT_CU.varieteKey({ label: 'S9', culture: 'Framboise' }, {}), '');
  assert.strictEqual(CBT_CU.varieteKey(null, null), '');
});

test('porteeOptions — buckets de variété, variété VIDE exclue mais comptée en culture', () => {
  const r = plain(CBT_CU.porteeOptions({ rows: ROWS_PORTEE, sbMap: {} }));
  assert.deepStrictEqual(r.varietes, [
    { key: 'Framboise||MARAVILLA', label: 'Framboise / MARAVILLA', culture: 'Framboise', variete: 'MARAVILLA', nb: 1 },
    { key: 'Myrtille||CASCADE', label: 'Myrtille / CASCADE', culture: 'Myrtille', variete: 'CASCADE', nb: 1 },
    { key: 'Myrtille||CORINA', label: 'Myrtille / CORINA', culture: 'Myrtille', variete: 'CORINA', nb: 2 },
  ]);
  // « S9 - REYNA » n'apparaît dans AUCUN bucket de variété…
  assert.ok(!r.varietes.some(function (v) { return v.variete === ''; }));
  // …mais compte bien dans sa culture (2 framboises, 3 myrtilles).
  assert.deepStrictEqual(r.cultures, [
    { key: 'Framboise', label: 'Framboise', nb: 2 },
    { key: 'Myrtille', label: 'Myrtille', nb: 3 },
  ]);
});

test('porteeOptions — dédup sur le label en MAJUSCULES, ordre indépendant des lignes', () => {
  const doublon = ROWS_PORTEE.concat([
    { label: 's13 - corina', culture: 'Myrtille', variete: 'Corina' },
  ]);
  const r = plain(CBT_CU.porteeOptions({ rows: doublon.slice().reverse(), sbMap: {} }));
  const corina = r.varietes.filter(function (v) { return v.key === 'Myrtille||CORINA'; })[0];
  assert.strictEqual(corina.nb, 2, 'une parcelle listée deux fois ne compte qu\'une');
  assert.deepStrictEqual(r.cultures.map(function (c) { return c.key; }), ['Framboise', 'Myrtille']);
  assert.deepStrictEqual(plain(CBT_CU.porteeOptions({})), { varietes: [], cultures: [] });
});

test('porteeOptions — une culture masquée n\'est jamais un bucket proposable', () => {
  const r = plain(CBT_CU.porteeOptions({
    rows: ROWS_PORTEE.concat([{ label: 'F2 ZUTANO', culture: '', variete: 'Zutano' }]),
    sbMap: {},
  }));
  assert.ok(!r.cultures.some(function (c) { return c.key === 'Avocatier'; }));
  assert.ok(!r.varietes.some(function (v) { return v.culture === 'Avocatier'; }));
});

test('targetLabels — portée Parcelle : la seule parcelle sélectionnée', () => {
  assert.deepStrictEqual(
    plain(CBT_CU.targetLabels({ portee: 'parcelle', label: 'S13 - CORINA', rows: ROWS_PORTEE })),
    ['S13 - CORINA']
  );
  assert.deepStrictEqual(plain(CBT_CU.targetLabels({ portee: 'parcelle', label: '' })), []);
  // Portée inconnue : aucune cible, jamais un repli silencieux sur tout.
  assert.deepStrictEqual(plain(CBT_CU.targetLabels({ portee: 'tout', rows: ROWS_PORTEE })), []);
  assert.deepStrictEqual(plain(CBT_CU.targetLabels({ portee: 'variete', rows: ROWS_PORTEE })), []);
});

test('targetLabels — portée Variété : le SEUL bucket, labels bruts, ordre déterministe', () => {
  const attendu = ['S13 - CORINA', 'S8 - CORINA'];
  assert.deepStrictEqual(plain(CBT_CU.targetLabels({
    portee: 'variete', cible: 'Myrtille||CORINA', rows: ROWS_PORTEE, sbMap: {},
  })), attendu);
  // Même résultat quel que soit l'ordre d'arrivée des lignes.
  assert.deepStrictEqual(plain(CBT_CU.targetLabels({
    portee: 'variete', cible: 'Myrtille||CORINA', rows: ROWS_PORTEE.slice().reverse(), sbMap: {},
  })), attendu);
});

test('targetLabels — portée Culture : toute la culture, dédupliquée', () => {
  assert.deepStrictEqual(plain(CBT_CU.targetLabels({
    portee: 'culture', cible: 'Myrtille',
    rows: ROWS_PORTEE.concat([{ label: 's13 - corina', culture: 'Myrtille', variete: 'Corina' }]),
    sbMap: {},
  })), ['S13 - CORINA', 'S14 - CASCADE', 'S8 - CORINA']);
  // Une parcelle sans variété entre bien dans la cible de sa culture.
  assert.deepStrictEqual(plain(CBT_CU.targetLabels({
    portee: 'culture', cible: 'Framboise', rows: ROWS_PORTEE, sbMap: {},
  })), ['S12 - MARAVILLA', 'S9 - REYNA']);
});

test('targetLabels — une culture masquée ne peut pas devenir une cible d\'écriture', () => {
  // Double garde : même si l'appelant passe des lignes NON masquées.
  assert.deepStrictEqual(plain(CBT_CU.targetLabels({
    portee: 'culture', cible: 'Avocatier',
    rows: [{ label: 'F2 ZUTANO', culture: '', variete: 'Zutano' }], sbMap: {},
  })), []);
});

// ------------------------------------------------------------ valeursCommunes

const FAMILLES_CIBLE = ['Taille', 'Récolte'];
const OPS_CIBLE = { 'Taille': ['GB09::Taille d\'hiver'] };

test('valeursCommunes — concordance parfaite : la grille est pré-remplie', () => {
  const r = plain(CBT_CU.valeursCommunes({
    labels: ['S13 - CORINA', 'S8 - CORINA'],
    familles: FAMILLES_CIBLE,
    opsByFamille: OPS_CIBLE,
    budgetsByLabel: {
      'S13 - CORINA': { 'Récolte': 1800 },
      'S8 - CORINA': { 'Récolte': 1800 },
    },
    opBudgetsByLabel: {
      'S13 - CORINA': { 'Taille': { 'GB09::Taille d\'hiver': 4 } },
      'S8 - CORINA': { 'Taille': { 'GB09::Taille d\'hiver': 4 } },
    },
  }));
  // Convention existante du composant : un 0 s'affiche vide.
  assert.deepStrictEqual(r.values, { 'Taille': '', 'Récolte': '1800' });
  assert.deepStrictEqual(r.opValues, { 'Taille': { 'GB09::Taille d\'hiver': '4' }, 'Récolte': {} });
  assert.deepStrictEqual(r.divergentes, {});
  assert.deepStrictEqual(r.divergentesOps, {});
});

test('valeursCommunes — une cible SANS document est une DIVERGENCE, pas un accord', () => {
  // LE test anti-effacement silencieux : « 4 sur deux parcelles, absent sur la
  // troisième » ne doit JAMAIS pré-remplir 4 et réécrire 4 partout sans le dire.
  const r = plain(CBT_CU.valeursCommunes({
    labels: ['A', 'B', 'C'],
    familles: ['Récolte'],
    budgetsByLabel: { A: { 'Récolte': 4 }, B: { 'Récolte': 4 } },
  }));
  assert.strictEqual(r.values['Récolte'], '', 'jamais de pré-remplissage sur une divergence');
  assert.deepStrictEqual(r.divergentes['Récolte'], { nb: 2, min: 0, max: 4 });
});

test('valeursCommunes — le champ vide a DEUX causes, seul `divergentes` les sépare', () => {
  // Tout à 0 (ou absent partout) : vide SANS divergence.
  const zero = plain(CBT_CU.valeursCommunes({
    labels: ['A', 'B'], familles: ['Récolte'], budgetsByLabel: {},
  }));
  assert.strictEqual(zero.values['Récolte'], '');
  assert.deepStrictEqual(zero.divergentes, {}, 'aucune divergence : les deux sont à 0');
  // Aucune cible : rien à pré-remplir, rien à signaler.
  const vide = plain(CBT_CU.valeursCommunes({ labels: [], familles: ['Récolte'] }));
  assert.strictEqual(vide.values['Récolte'], '');
  assert.deepStrictEqual(vide.divergentes, {});
});

test('valeursCommunes — min/max/nb sur plusieurs valeurs distinctes', () => {
  const r = plain(CBT_CU.valeursCommunes({
    labels: ['A', 'B', 'C', 'D'],
    familles: ['Récolte'],
    budgetsByLabel: {
      A: { 'Récolte': 580 }, B: { 'Récolte': 690 },
      C: { 'Récolte': 690 }, D: { 'Récolte': 600 },
    },
  }));
  assert.deepStrictEqual(r.divergentes['Récolte'], { nb: 3, min: 580, max: 690 });
});

test('valeursCommunes — une divergence d\'OPÉRATION est indépendante de la famille', () => {
  const r = plain(CBT_CU.valeursCommunes({
    labels: ['A', 'B'],
    familles: FAMILLES_CIBLE,
    opsByFamille: OPS_CIBLE,
    // Niveau famille : parfaitement d'accord…
    budgetsByLabel: { A: { 'Récolte': 1800 }, B: { 'Récolte': 1800 } },
    // …mais l'opération diverge.
    opBudgetsByLabel: {
      A: { 'Taille': { 'GB09::Taille d\'hiver': 4 } },
      B: { 'Taille': { 'GB09::Taille d\'hiver': 6 } },
    },
  }));
  assert.deepStrictEqual(r.divergentes, {}, 'la famille reste en accord');
  assert.deepStrictEqual(r.divergentesOps, {
    'Taille': { 'GB09::Taille d\'hiver': { nb: 2, min: 4, max: 6 } },
  });
  assert.strictEqual(r.opValues['Taille']['GB09::Taille d\'hiver'], '');
});

test('valeursCommunes — labels indexés en MAJUSCULES, casse du label indifférente', () => {
  const r = plain(CBT_CU.valeursCommunes({
    labels: [' s13 - corina '],
    familles: ['Récolte'],
    budgetsByLabel: { 'S13 - CORINA': { 'Récolte': 12 } },
  }));
  assert.strictEqual(r.values['Récolte'], '12');
});

// -------------------------------------------------------------- surfaceCible

test('surfaceCible — Σ ha, labels sans Ha listés, haOf INJECTÉ', () => {
  const appels = [];
  const haOf = function (label) {
    appels.push(label);
    return { A: 2.5, B: 1.25, C: 0 }[label];
  };
  const r = plain(CBT_CU.surfaceCible(['A', 'B', 'C', 'D'], haOf));
  assert.deepStrictEqual(r, { ha: 3.75, sansHa: ['C', 'D'], nb: 4 });
  assert.deepStrictEqual(appels, ['A', 'B', 'C', 'D'], 'la fonction injectée est bien utilisée');
});

test('surfaceCible — tolère une liste vide et un haOf absent', () => {
  assert.deepStrictEqual(plain(CBT_CU.surfaceCible([], function () { return 3; })),
    { ha: 0, sansHa: [], nb: 0 });
  assert.deepStrictEqual(plain(CBT_CU.surfaceCible(['A'], null)),
    { ha: 0, sansHa: ['A'], nb: 1 });
  // Valeur non finie / non numérique → parcelle « sans Ha », jamais un NaN.
  assert.deepStrictEqual(plain(CBT_CU.surfaceCible(['A', 'B'], function (l) {
    return l === 'A' ? Infinity : 'abc';
  })), { ha: 0, sansHa: ['A', 'B'], nb: 2 });
});

// -------------------------------------------------------------------- rendu

const ROWS = [{ label: 'F5- CASCADE -S13', culture: 'Myrtille' }];
const FAMILLES = ['Taille', 'Ferti-irrigation'];
// [rows, familles, budgetsByLabel, campagne, selected, values, loading, err, …]
const STATE = [ROWS, FAMILLES, {}, '2026-2027', 'F5- CASCADE -S13', { Taille: '2' }, false];

test('rendu — un profil non autorisé n\'a PAS de bouton Enregistrer', () => {
  const Comp = load(STATE);
  const tree = Comp({ userRole: 'chef' });
  const txt = textOf(tree);
  assert.ok(txt.includes('Budget JH / Ha'), 'titre attendu');
  assert.ok(!txt.includes('Enregistrer'), 'aucun bouton de sauvegarde attendu');
  assert.ok(txt.includes('Saisie réservée aux profils DG/RH.'));
  // Aucun champ éditable non plus.
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'input'; }).length, 0);
});

test('rendu — DG voit le bouton Enregistrer et un champ par famille', () => {
  const Comp = load(STATE);
  const tree = Comp({ userRole: 'dg' });
  assert.ok(textOf(tree).includes('Enregistrer'));
  assert.strictEqual(
    walk(tree).filter(function (n) { return n.type === 'input'; }).length,
    FAMILLES.length
  );
});

test('rendu — le message de succès n\'est effacé QUE par un changement de parcelle', () => {
  // Régression : l'effet qui remet msg à null dépendait aussi de
  // `budgetsByLabel`, que le save met à jour → « Budget enregistré » était
  // effacé dans le même rendu (React 18 batche) et n'était JAMAIS visible.
  const spy = { effects: [], sets: [] };
  const Comp = load(STATE, spy);
  Comp({ userRole: 'dg' });

  const msgEffects = spy.effects.filter(function (e) {
    spy.sets.length = 0;
    try { e.fn(); } catch (err) { /* effets async (fetch stubé) ignorés */ }
    return spy.sets.some(function (s) { return s.index === S.msg && s.value === null; });
  });
  assert.strictEqual(msgEffects.length, 1, 'un seul effet doit effacer le message');
  assert.deepStrictEqual(
    plain(msgEffects[0].deps),
    [STATE[S.selected]],
    'l\'effet ne doit dépendre QUE de la parcelle sélectionnée'
  );
});

test('rendu — la purge est affichée et signalée visuellement', () => {
  const msg = CBT.saveMessage({ familles_purgees: ['Ancienne famille'] });
  const withMsg = STATE.slice();
  withMsg[S.msg] = msg;
  const tree = load(withMsg)({ userRole: 'dg' });

  assert.ok(textOf(tree).includes('1 famille obsolète retirée : Ancienne famille'));
  // Une suppression de données ne doit pas passer pour un simple succès vert.
  const icons = walk(tree).filter(function (n) {
    return n.type === 'i' && String(n.props.className).includes('fa-triangle-exclamation');
  });
  assert.strictEqual(icons.length, 1, 'icône d\'avertissement attendue');
  assert.strictEqual(
    walk(tree).filter(function (n) {
      return n.type === 'i' && String(n.props.className).includes('fa-circle-check');
    }).length,
    0,
    'pas d\'icône de succès neutre quand des données ont été supprimées'
  );
});

test('rendu — succès sans purge : icône de succès, aucun avertissement', () => {
  const withMsg = STATE.slice();
  withMsg[S.msg] = CBT.saveMessage({ success: true });
  const tree = load(withMsg)({ userRole: 'dg' });
  const txt = textOf(tree);
  assert.ok(txt.includes('Budget enregistré'));
  assert.ok(!txt.includes('obsolète'));
  assert.strictEqual(
    walk(tree).filter(function (n) {
      return n.type === 'i' && String(n.props.className).includes('fa-circle-check');
    }).length,
    1
  );
});

// --------------------------------------------- rendu : masquage de l'avocatier

/** Parcelles réelles : une myrtille, une framboise, deux avocatier. */
const ROWS_AVEC_AVOCATIER = [
  { label: 'F5- CASCADE -S13', culture: 'Myrtille' },
  { label: 'S12 - MARAVILLA', culture: 'Framboise' },
  { label: 'F2 ZUTANO', culture: '' },
  { label: 'F2 HASS', culture: 'Avocat' },
];

test('rendu — aucune option avocatier dans le sélecteur de parcelle', () => {
  const s = STATE.slice();
  s[S.rows] = ROWS_AVEC_AVOCATIER;
  const tree = load(s, undefined, { CultureUtils: CULTURE_UTILS })({ userRole: 'dg' });
  const opts = walk(tree).filter(function (n) { return n.type === 'option'; });
  // 1 placeholder + les 2 seules parcelles budgétables en JH/Ha.
  assert.strictEqual(opts.length, 3);
  const valeurs = opts.map(function (n) { return n.props.value; });
  assert.deepStrictEqual(valeurs, ['', 'F5- CASCADE -S13', 'S12 - MARAVILLA']);
  const txt = textOf(tree);
  assert.ok(!txt.includes('ZUTANO'), 'aucune parcelle avocatier proposée');
  assert.ok(!txt.includes('HASS'));
});

test('rendu — une sélection devenue non proposable est désélectionnée', () => {
  // Cas réel : `culture_sb` corrigée en cours de session, ou sélection héritée.
  const s = STATE.slice();
  s[S.rows] = ROWS_AVEC_AVOCATIER;
  s[S.selected] = 'F2 ZUTANO';
  const spy = { effects: [], sets: [], fetches: [] };
  load(s, spy, { CultureUtils: CULTURE_UTILS })({ userRole: 'dg' });

  const resets = spy.effects.filter(function (e) {
    spy.sets.length = 0;
    try { e.fn(); } catch (err) { /* effets async (fetch stubé) ignorés */ }
    return spy.sets.some(function (x) { return x.index === S.selected && x.value === ''; });
  });
  assert.strictEqual(resets.length, 1, 'un effet doit vider la sélection masquée');

  // …et une parcelle bien proposable n'est JAMAIS désélectionnée.
  const ok = STATE.slice();
  ok[S.rows] = ROWS_AVEC_AVOCATIER;
  const spy2 = { effects: [], sets: [], fetches: [] };
  load(ok, spy2, { CultureUtils: CULTURE_UTILS })({ userRole: 'dg' });
  const resets2 = spy2.effects.filter(function (e) {
    spy2.sets.length = 0;
    try { e.fn(); } catch (err) { /* idem */ }
    return spy2.sets.some(function (x) { return x.index === S.selected; });
  });
  assert.strictEqual(resets2.length, 0);
});

test('rendu — sans parcelle sélectionnée, invite au choix et pas de tableau', () => {
  const Comp = load([ROWS, FAMILLES, {}, '2026-2027', '', {}, false]);
  const tree = Comp({ userRole: 'dg' });
  assert.ok(textOf(tree).includes('Sélectionner une parcelle pour saisir son budget.'));
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'table'; }).length, 0);
});

// ------------------------------------------------- rendu : niveau opération

const OPS_BY_FAMILLE = {
  'Taille': ['GB09::Taille d\'hiver', 'GB09::Taille de formation'],
  'Ferti-irrigation': ['GB02::Fertigation'],
};

/** État de base avec le référentiel des opérations chargé. */
function stateOps(overrides) {
  const s = [ROWS, FAMILLES, {}, '2026-2027', 'F5- CASCADE -S13', {}, false,
    undefined, undefined, undefined, undefined, OPS_BY_FAMILLE, {}, {}, {}, null];
  Object.keys(overrides || {}).forEach(function (k) { s[S[k]] = overrides[k]; });
  return s;
}

test('rendu — familles repliées par défaut : une seule ligne par famille', () => {
  // 108 opérations à plat rendraient l'écran inutilisable : tout est replié.
  const tree = load(stateOps())({ userRole: 'dg' });
  const txt = textOf(tree);
  assert.ok(txt.includes('Taille'));
  assert.ok(!txt.includes('Taille d\'hiver'), 'aucune opération visible repliée');
  // Un champ « famille » par famille, aucun champ d'opération.
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'input'; }).length,
    FAMILLES.length);
  assert.ok(txt.includes('2 op.'), 'nombre d\'opérations annoncé sur la ligne famille');
});

test('rendu — famille dépliée : une ligne et un champ par opération', () => {
  const tree = load(stateOps({ openFamilles: { 'Taille': true } }))({ userRole: 'dg' });
  const txt = textOf(tree);
  // Le LIBELLÉ est affiché, jamais la clé brute `GB09::Taille d'hiver`.
  assert.ok(txt.includes('Taille d\'hiver'));
  assert.ok(!txt.includes('GB09::'), 'la clé technique ne doit pas fuir à l\'écran');
  assert.ok(txt.includes('Taille de formation'));
  assert.ok(!txt.includes('Fertigation'), 'les autres familles restent repliées');
  // 2 champs famille + 2 champs opération de Taille.
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'input'; }).length,
    FAMILLES.length + 2);
});

test('rendu — chaque opération porte SON code, et deux codes = deux lignes', () => {
  // Sans le code affiché, les deux « Nettoyage » (GB05 Entretien structure /
  // GB11 Service générale) seraient deux lignes d'apparence identique — et
  // impossible de savoir laquelle rejoint quels JH réalisés.
  const tree = load(stateOps({
    familles: ['Entretien structure', 'Service générale'],
    opsByFamille: {
      'Entretien structure': ['GB05::Nettoyage'],
      'Service générale': ['GB11::Nettoyage'],
    },
    opValues: {
      'Entretien structure': { 'GB05::Nettoyage': '3' },
      'Service générale': { 'GB11::Nettoyage': '8' },
    },
    openFamilles: { 'Entretien structure': true, 'Service générale': true },
  }))({ userRole: 'dg' });

  const txt = textOf(tree);
  assert.ok(txt.includes('GB05'), 'code de la première ligne affiché');
  assert.ok(txt.includes('GB11'), 'code de la seconde ligne affiché');

  // Deux champs d'opération, chacun lié à SA clé : aucune valeur ne fuit.
  const inputs = walk(tree).filter(function (n) { return n.type === 'input'; });
  const valeurs = inputs.map(function (n) { return n.props.value; }).filter(Boolean);
  assert.deepStrictEqual(valeurs, ['3', '8']);
});

test('rendu — une clé héritée (sans code) n\'affiche aucun badge inventé', () => {
  const tree = load(stateOps({
    familles: ['Récolte'],
    opsByFamille: { 'Récolte': ['Cueillette'] },
    openFamilles: { 'Récolte': true },
  }))({ userRole: 'dg' });
  assert.ok(textOf(tree).includes('Cueillette'));
  assert.ok(!textOf(tree).includes('::'));
});

test('rendu — total de famille CALCULÉ dès qu\'une opération est saisie (non éditable)', () => {
  const tree = load(stateOps({
    openFamilles: { 'Taille': true },
    opValues: { 'Taille': { 'GB09::Taille d\'hiver': '1,5', 'GB09::Taille de formation': '2' } },
  }))({ userRole: 'dg' });
  // Le champ famille de Taille a disparu : seul reste celui de Ferti-irrigation
  // (sans opération budgétée), plus les 2 champs d'opération.
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'input'; }).length, 1 + 2);
  // 1,5 + 2 = 3.50 affiché en total de famille.
  assert.ok(textOf(tree).includes('3.50'));
});

test('rendu — famille sans opération saisie : total de famille éditable (cas Service générale)', () => {
  const tree = load(stateOps({
    familles: ['Service générale'],
    opsByFamille: { 'Service générale': ['Gardiennage'] },
    values: { 'Service générale': '12,5' },
    openFamilles: { 'Service générale': true },
  }))({ userRole: 'dg' });
  const inputs = walk(tree).filter(function (n) { return n.type === 'input'; });
  // 1 champ famille (encore éditable) + 1 champ opération.
  assert.strictEqual(inputs.length, 2);
  assert.strictEqual(inputs[0].props.value, '12,5');
});

test('rendu — famille budgétée au seul total, opérations vides : cas nominal (Récolte)', () => {
  // 11 opérations au référentiel, aucune renseignée → le total de famille reste
  // saisissable et fait foi. C'est ~73 % du budget d'Omar : rien ne doit forcer
  // une saisie par opération.
  const tree = load(stateOps({
    familles: ['Récolte'],
    opsByFamille: { 'Récolte': ['Cueillette', 'Pesée'] },
    values: { 'Récolte': '1800' },
    opValues: { 'Récolte': { 'Cueillette': '', 'Pesée': '' } },
    openFamilles: { 'Récolte': true },
  }))({ userRole: 'dg' });
  const inputs = walk(tree).filter(function (n) { return n.type === 'input'; });
  assert.strictEqual(inputs.length, 3, '1 champ famille éditable + 2 champs opération');
  assert.strictEqual(inputs[0].props.value, '1800');
  // Aucun avertissement d'écrasement : rien n'est perdu dans cet état.
  assert.strictEqual(walk(tree).filter(function (n) {
    return n.type === 'i' && String(n.props.className).includes('fa-triangle-exclamation');
  }).length, 0);
});

test('rendu — cas MIXTE : l\'écrasement est annoncé EN TEXTE, pas dans un title', () => {
  const tree = load(stateOps({
    familles: ['Récolte'],
    opsByFamille: { 'Récolte': ['Cueillette', 'Pesée'] },
    values: { 'Récolte': '1800' },
    opValues: { 'Récolte': { 'Cueillette': '12', 'Pesée': '' } },
  }))({ userRole: 'dg' });
  const txt = textOf(tree);
  // Le badge doit être LISIBLE sans survol (validation au téléphone) et porter
  // la valeur menacée — la cellule de total, elle, affiche déjà les opérations.
  assert.ok(txt.includes('famille 1800 → remplacée par les opérations'),
    'badge texte attendu, pas un title');
  assert.strictEqual(walk(tree).filter(function (n) {
    return n.type === 'i' && String(n.props.className).includes('fa-triangle-exclamation');
  }).length, 1, 'pictogramme d\'avertissement attendu');
  // Le total affiché est celui des opérations, pas 1800 et pas 1812.
  assert.ok(txt.includes('12.00'));
  assert.ok(!txt.includes('1812'));
});

test('rendu — confirmation : liste les familles neutralisées, y compris repliées', () => {
  const confirmList = [
    { famille: 'Récolte', valeur: 1800, total: 12 },
    { famille: 'Arrachage', valeur: 100, total: 7 },
  ];
  const tree = load(stateOps({ confirmList: confirmList }))({ userRole: 'dg' });
  const txt = textOf(tree);
  assert.ok(txt.includes('2 valeurs de famille vont être remplacées par le détail'
    + ' de leurs opérations :'));
  assert.ok(txt.includes('Récolte : 1800 JH/Ha → 12 JH/Ha'));
  assert.ok(txt.includes('Arrachage : 100 JH/Ha → 7 JH/Ha'));
  assert.ok(txt.includes('Confirmer et enregistrer'));
  assert.ok(txt.includes('Annuler'));
});

test('rendu — pas de confirmation quand rien n\'est neutralisé', () => {
  const txt = textOf(load(stateOps())({ userRole: 'dg' }));
  assert.ok(!txt.includes('Confirmer et enregistrer'));
});

test('rendu — la confirmation n\'est jamais proposée en lecture seule', () => {
  const tree = load(stateOps({
    confirmList: [{ famille: 'Récolte', valeur: 1800, total: 12 }],
  }))({ userRole: 'chef' });
  assert.ok(!textOf(tree).includes('Confirmer et enregistrer'));
});

/** Bouton dont le libellé exact est `label`. */
function buttonWith(tree, label) {
  return walk(tree).find(function (n) {
    return n.type === 'button' && (n.children || []).indexOf(label) !== -1;
  });
}

test('rendu — « Enregistrer » n\'écrit RIEN tant que la neutralisation n\'est pas confirmée', () => {
  const spy = { effects: [], sets: [], fetches: [] };
  const tree = load(stateOps({
    familles: ['Récolte'],
    opsByFamille: { 'Récolte': ['Cueillette'] },
    values: { 'Récolte': '1800' },
    opValues: { 'Récolte': { 'Cueillette': '12' } },
  }), spy)({ userRole: 'dg' });

  buttonWith(tree, 'Enregistrer').props.onClick();

  assert.strictEqual(spy.fetches.length, 0, 'aucun appel réseau avant confirmation');
  const poses = spy.sets.filter(function (s) { return s.index === S.confirmList; });
  assert.strictEqual(poses.length, 1);
  assert.deepStrictEqual(plain(poses[0].value),
    [{ famille: 'Récolte', valeur: 1800, total: 12 }]);
});

test('rendu — « Confirmer et enregistrer » déclenche bien le save', () => {
  const spy = { effects: [], sets: [], fetches: [] };
  const tree = load(stateOps({
    familles: ['Récolte'],
    opsByFamille: { 'Récolte': ['Cueillette'] },
    values: { 'Récolte': '1800' },
    opValues: { 'Récolte': { 'Cueillette': '12' } },
    confirmList: [{ famille: 'Récolte', valeur: 1800, total: 12 }],
  }), spy)({ userRole: 'dg' });

  buttonWith(tree, 'Confirmer et enregistrer').props.onClick();

  assert.strictEqual(spy.fetches.length, 1, 'le save part une fois confirmé');
  assert.match(String(spy.fetches[0].url), /action=campagne-budget-save/);
  const body = JSON.parse(spy.fetches[0].init.body);
  // La valeur de famille part bien à 0 (remplacée par le détail).
  assert.strictEqual(body.budgets['Récolte'], 0);
  assert.deepStrictEqual(body.budgets_operations['Récolte'], { 'Cueillette': 12 });
});

test('rendu — un changement de parcelle (ou un Rafraîchir) ferme la confirmation', () => {
  // Sans ça : confirmation posée sur la parcelle A, on change de parcelle, le
  // panneau reste affiché avec les chiffres de A et « Confirmer » écrit B.
  const spy = { effects: [], sets: [], fetches: [] };
  load(stateOps({ confirmList: [{ famille: 'Récolte', valeur: 1800, total: 12 }] }), spy)(
    { userRole: 'dg' });

  const resets = spy.effects.filter(function (e) {
    spy.sets.length = 0;
    try { e.fn(); } catch (err) { /* effets async (fetch stubé) ignorés */ }
    return spy.sets.some(function (s) { return s.index === S.confirmList && s.value === null; });
  });
  assert.strictEqual(resets.length, 1, 'un effet doit invalider la confirmation');
  // La QUINZAINE éditée entre dans les dépendances au même titre : le panneau
  // afficherait sinon les engagements de la quinzaine A pendant que l'écriture
  // porterait sur la B.
  assert.deepStrictEqual(plain(resets[0].deps), ['F5- CASCADE -S13', 0, ''],
    'invalidée par la parcelle sélectionnée, par tick (Rafraîchir) ET par la quinzaine');
});

test('rendu — une confirmation PÉRIMÉE n\'écrit rien (bretelles)', () => {
  // Ceinture (reset par effet) doublée d'une revalidation : ce qui a été
  // confirmé doit être exactement ce qui va être écrit.
  const spy = { effects: [], sets: [], fetches: [] };
  const tree = load(stateOps({
    familles: ['Récolte'],
    opsByFamille: { 'Récolte': ['Cueillette'] },
    // Saisie courante : Récolte 1800 → 12…
    values: { 'Récolte': '1800' },
    opValues: { 'Récolte': { 'Cueillette': '12' } },
    // …mais la confirmation affichée porte sur un AUTRE état (parcelle A).
    confirmList: [{ famille: 'Arrachage', valeur: 100, total: 7 }],
  }), spy)({ userRole: 'dg' });

  buttonWith(tree, 'Confirmer et enregistrer').props.onClick();

  assert.strictEqual(spy.fetches.length, 0, 'aucune écriture sur une confirmation périmée');
  // La confirmation est reposée sur l'état RÉEL, et l'utilisateur est prévenu.
  const poses = spy.sets.filter(function (s) { return s.index === S.confirmList; });
  assert.deepStrictEqual(plain(poses[poses.length - 1].value),
    [{ famille: 'Récolte', valeur: 1800, total: 12 }]);
  const msgs = spy.sets.filter(function (s) { return s.index === S.msg && s.value; });
  assert.match(String(msgs[msgs.length - 1].value.text), /La saisie a changé depuis la confirmation/);
});

test('memeNeutralisations — égalité stricte, insensible à l\'ordre', () => {
  const a = [{ famille: 'A', valeur: 1, total: 2 }, { famille: 'B', valeur: 3, total: 4 }];
  const b = [{ famille: 'B', valeur: 3, total: 4 }, { famille: 'A', valeur: 1, total: 2 }];
  assert.strictEqual(CBT.memeNeutralisations(a, b), true);
  assert.strictEqual(CBT.memeNeutralisations(a, a.slice(0, 1)), false);
  assert.strictEqual(CBT.memeNeutralisations(a, [{ famille: 'A', valeur: 9, total: 2 },
    { famille: 'B', valeur: 3, total: 4 }]), false, 'une valeur différente = liste différente');
  assert.strictEqual(CBT.memeNeutralisations(null, []), true);
  assert.strictEqual(CBT.memeNeutralisations(null, a), false);
});

test('rendu — un save sans neutralisation part directement, sans confirmation', () => {
  const spy = { effects: [], sets: [], fetches: [] };
  const tree = load(stateOps({
    familles: ['Récolte'],
    opsByFamille: { 'Récolte': ['Cueillette'] },
    values: { 'Récolte': '1800' },
    opValues: { 'Récolte': { 'Cueillette': '' } },
  }), spy)({ userRole: 'dg' });

  buttonWith(tree, 'Enregistrer').props.onClick();

  assert.strictEqual(spy.fetches.length, 1);
  assert.strictEqual(JSON.parse(spy.fetches[0].init.body).budgets['Récolte'], 1800);
});

test('rendu — rapport post-save : les familles neutralisées s\'affichent en ambre', () => {
  const withMsg = stateOps();
  withMsg[S.msg] = CBT.saveMessage({
    familles_neutralisees: [{ famille: 'Récolte', valeur_precedente: 1800 }],
  });
  const tree = load(withMsg)({ userRole: 'dg' });
  assert.ok(textOf(tree).includes('1 valeur de famille remplacée par le détail des opérations'
    + ' : Récolte (1800)'));
  // Ambre + triangle, jamais le vert « succès neutre ».
  assert.strictEqual(walk(tree).filter(function (n) {
    return n.type === 'i' && String(n.props.className).includes('fa-circle-check');
  }).length, 0);
  assert.strictEqual(walk(tree).filter(function (n) {
    return n.type === 'i' && String(n.props.className).includes('fa-triangle-exclamation');
  }).length, 1);
});

// ------------------------------------------------- rendu : PORTÉE de saisie

/** `window` de prod pour les tests de portée : modules + helpers globaux. */
const WIN_PORTEE = {
  CultureUtils: CULTURE_UTILS,
  // S13 fait 2 ha, S8 n'a pas de Ha saisi (cas réel du référentiel).
  sbParcelleHa: function (label) { return label === 'S13 - CORINA' ? 2 : 0; },
  sbParcelleNom: function (label) { return label; },
};

/** État de base en portée VARIÉTÉ sur le bucket Myrtille / CORINA. */
function statePortee(overrides) {
  const s = [];
  s[S.rows] = ROWS_PORTEE;
  s[S.familles] = FAMILLES_CIBLE;
  s[S.campagne] = '2026-2027';
  s[S.loading] = false;
  s[S.opsByFamille] = OPS_CIBLE;
  s[S.portee] = 'variete';
  s[S.varieteSel] = 'Myrtille||CORINA';
  Object.keys(overrides || {}).forEach(function (k) { s[S[k]] = overrides[k]; });
  return s;
}

/** Valeurs successives posées par les effets sur un state donné. */
function effectSets(spy, index) {
  const out = [];
  spy.effects.forEach(function (e) {
    spy.sets.length = 0;
    try { e.fn(); } catch (err) { /* effets async (fetch stubé) ignorés */ }
    spy.sets.forEach(function (s) { if (s.index === index) out.push(s.value); });
  });
  return out;
}

test('rendu — le sélecteur de portée est présent, y compris en LECTURE SEULE', () => {
  // Consulter le budget d'une variété est légitime : seul « Enregistrer » saute.
  const txt = textOf(load(statePortee({ portee: 'parcelle' }), undefined, WIN_PORTEE)(
    { userRole: 'chef' }));
  assert.ok(txt.includes('Parcelle'));
  assert.ok(txt.includes('Variété'));
  assert.ok(txt.includes('Culture'));
  assert.ok(!txt.includes('Enregistrer'));
});

test('rendu — portée Variété : le select propose les buckets et leur nombre de parcelles', () => {
  const tree = load(statePortee({ varieteSel: '' }), undefined, WIN_PORTEE)({ userRole: 'dg' });
  const opts = walk(tree).filter(function (n) { return n.type === 'option'; });
  assert.deepStrictEqual(opts.map(function (o) { return o.props.value; }),
    ['', 'Framboise||MARAVILLA', 'Myrtille||CASCADE', 'Myrtille||CORINA']);
  const txt = textOf(tree);
  assert.ok(txt.includes('Myrtille / CORINA (2 parcelles)'));
  assert.ok(txt.includes('Myrtille / CASCADE (1 parcelle)'));
  // Aucune cible choisie → pas de grille, et une invite explicite.
  assert.ok(txt.includes('Choisir une variété pour saisir son budget.'));
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'table'; }).length, 0);
});

test('rendu — entête de portée : nombre de parcelles, surface, parcelles sans Ha', () => {
  const txt = textOf(load(statePortee(), undefined, WIN_PORTEE)({ userRole: 'dg' }));
  assert.ok(txt.includes('Portée : Myrtille / CORINA'));
  assert.ok(txt.includes('2 parcelles'));
  // Σ ha = 2.00 (S8 n'a pas de Ha) — et on DIT ce que ça implique.
  assert.ok(txt.includes('2.00 ha'));
  assert.ok(txt.includes('1 sans Ha : S8 - CORINA'));
  assert.ok(txt.includes('leur Total JH n\'est pas compté, leur budget l\'est'));
  // Le champ d'engagement disparaît : ne jamais le laisser sans explication.
  assert.ok(txt.includes('Engagement quinzaine : saisie par parcelle uniquement.'));
});

test('rendu — portée multiple : ni colonne « Engagé », ni champ de quinzaine', () => {
  const s = statePortee({
    quinzOptions: [{ key: 'Q07', label: 'Quinzaine 07' }],
    quinzCourante: 'Q07',
  });
  const multi = load(s, undefined, WIN_PORTEE)({ userRole: 'dg' });
  assert.ok(!textOf(multi).includes('Engagé'));
  // …alors que la MÊME campagne en portée Parcelle la propose toujours.
  const parcelle = statePortee({
    portee: 'parcelle', selected: 'S13 - CORINA',
    quinzOptions: [{ key: 'Q07', label: 'Quinzaine 07' }], quinzCourante: 'Q07',
  });
  assert.ok(textOf(load(parcelle, undefined, WIN_PORTEE)({ userRole: 'dg' }))
    .includes('Engagé Quinzaine 07 JH / Ha'));
});

test('rendu — portée multiple : le badge de culture vient du BUCKET', () => {
  // `selectedRow` est null en portée multiple : sans dérivation depuis le bucket,
  // le badge disparaîtrait et le gating quinzaine recevrait ''.
  const txt = textOf(load(statePortee(), undefined, WIN_PORTEE)({ userRole: 'dg' }));
  assert.ok(txt.includes('Myrtille'));
  const parCulture = textOf(load(statePortee({ portee: 'culture', cultureSel: 'Framboise' }),
    undefined, WIN_PORTEE)({ userRole: 'dg' }));
  assert.ok(parCulture.includes('Portée : Framboise'));
});

test('rendu — pré-remplissage : UNE seule source de setValues, la valeur commune', () => {
  const spy = { effects: [], sets: [], fetches: [] };
  load(statePortee({
    budgetsByLabel: {
      'S13 - CORINA': { 'Récolte': 1800 },
      'S8 - CORINA': { 'Récolte': 1800 },
    },
  }), spy, WIN_PORTEE)({ userRole: 'dg' });

  const poses = effectSets(spy, S.values);
  assert.strictEqual(poses.length, 1, 'deux effets en course sur les mêmes champs = interdit');
  assert.deepStrictEqual(plain(poses[0]), { 'Taille': '', 'Récolte': '1800' });
});

test('rendu — divergence entre parcelles cibles : annoncée EN TEXTE sur la ligne', () => {
  const tree = load(statePortee({
    budgetsByLabel: {
      'S13 - CORINA': { 'Récolte': 1800 },
      'S8 - CORINA': { 'Récolte': 580 },
    },
  }), undefined, WIN_PORTEE)({ userRole: 'dg' });
  const txt = textOf(tree);
  // Lisible sans survol (validation au téléphone), avec l'amplitude réelle.
  assert.ok(txt.includes('2 valeurs différentes (580 → 1800) — non modifiée à l\'enregistrement'),
    'badge texte de divergence attendu');
  assert.strictEqual(walk(tree).filter(function (n) {
    return n.type === 'i' && String(n.props.className).includes('fa-triangle-exclamation');
  }).length, 1);
});

test('rendu — divergence au niveau OPÉRATION, famille en accord', () => {
  const txt = textOf(load(statePortee({
    openFamilles: { 'Taille': true },
    opBudgetsByLabel: {
      'S13 - CORINA': { 'Taille': { 'GB09::Taille d\'hiver': 4 } },
      'S8 - CORINA': { 'Taille': { 'GB09::Taille d\'hiver': 6 } },
    },
  }), undefined, WIN_PORTEE)({ userRole: 'dg' }));
  assert.ok(txt.includes('2 valeurs différentes (4 → 6) — non modifiée à l\'enregistrement'));
});

test('rendu — portée Parcelle : le chemin historique est INCHANGÉ', () => {
  // Critère de non-régression du lot : aucun entête de portée, aucun badge de
  // divergence, l'invite d'origine, et le save part sur la parcelle seule.
  const spy = { effects: [], sets: [], fetches: [] };
  const tree = load(statePortee({
    portee: 'parcelle', selected: 'S13 - CORINA', values: { 'Récolte': '1800' },
  }), spy, WIN_PORTEE)({ userRole: 'dg' });
  const txt = textOf(tree);
  assert.ok(!txt.includes('Portée : '));
  assert.ok(!txt.includes('valeurs différentes'));
  buttonWith(tree, 'Enregistrer').props.onClick();
  assert.strictEqual(spy.fetches.length, 1);
  assert.strictEqual(JSON.parse(spy.fetches[0].init.body).label_bee_one, 'S13 - CORINA');
});

test('rendu — portée multiple : AUCUNE écriture possible avant le lot fan-out', () => {
  // État intermédiaire assumé : `handleSave` n'écrirait que sur `selected` avec
  // la grille commune de N parcelles. Le bouton est donc absent tant que le
  // fan-out (payload partiel + envoi multi-labels) n'est pas livré.
  // ⚠️ À remplacer au lot fan-out par « ne fetch rien avant confirmation ».
  const tree = load(statePortee({ selected: 'S13 - CORINA' }), undefined, WIN_PORTEE)(
    { userRole: 'dg' });
  assert.strictEqual(buttonWith(tree, 'Enregistrer'), undefined);
  assert.ok(textOf(tree).includes('L\'enregistrement en portée multiple arrive avec le lot suivant.'));
});

// ------------------------------------------------------- buildFanoutPayload
//
// Portée multiple : SEULES les familles touchées sont envoyées. Ce qui n'est pas
// dans le payload est conservé en base par `mergeBudgets` (backend) — c'est ce
// qui permet de promettre « une ligne divergente non retouchée n'est pas
// modifiée ». Sémantique OPPOSÉE à buildSavePayload, qui efface le vide.

const FANOUT_BASE = {
  campagne: '2026-2027',
  labels: ['S13 - CORINA', 'S8 - CORINA'],
  familles: ['Taille', 'Récolte'],
  opsByFamille: { 'Taille': ['GB09::Taille d\'hiver', 'GB09::Taille de formation'] },
};

test('buildFanoutPayload — une famille NON touchée est ABSENTE du payload', () => {
  // LE test du lot : envoyer une famille non saisie l'écraserait à 0 sur les N
  // parcelles cibles, sans que personne ne l'ait demandé.
  const r = CBT.buildFanoutPayload(Object.assign({}, FANOUT_BASE, {
    values: { 'Taille': '', 'Récolte': '1800' },
    touched: { 'Récolte': true },
  }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(plain(r.payload.budgets), { 'Récolte': 1800 });
  assert.strictEqual('Taille' in r.payload.budgets, false, 'Taille n\'a pas été touchée');
  assert.deepStrictEqual(plain(r.payload.budgets_operations), {});
  assert.deepStrictEqual(plain(r.famillesEnvoyees), ['Récolte']);
});

test('buildFanoutPayload — une famille touchée part ENTIÈRE, avec toutes ses opérations', () => {
  // Unité d'envoi = la famille : envoyer un champ isolé rouvrirait le bug de
  // l'ancienne valeur de famille survivante en base.
  const r = CBT.buildFanoutPayload(Object.assign({}, FANOUT_BASE, {
    values: { 'Taille': '' },
    opValues: { 'Taille': { 'GB09::Taille d\'hiver': '4' } },
    touched: { 'Taille': true },
  }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(plain(r.payload.budgets_operations), {
    'Taille': { 'GB09::Taille d\'hiver': 4, 'GB09::Taille de formation': 0 },
  });
  // Invariant des deux niveaux, identique à buildSavePayload : famille détaillée
  // → sa valeur de famille part à 0.
  assert.deepStrictEqual(plain(r.payload.budgets), { 'Taille': 0 });
  assert.strictEqual('Récolte' in r.payload.budgets, false);
});

test('buildFanoutPayload — le payload porte `labels` ET `label_bee_one`, jamais la quinzaine', () => {
  const r = CBT.buildFanoutPayload(Object.assign({}, FANOUT_BASE, {
    values: { 'Récolte': '1800' }, touched: { 'Récolte': true },
  }));
  // `labels` = fan-out ; `label_bee_one` = garde-fou de la fenêtre de skew de
  // déploiement (un backend pas encore à jour écrit une parcelle, il ne crashe pas).
  assert.deepStrictEqual(plain(r.payload.labels), ['S13 - CORINA', 'S8 - CORINA']);
  assert.strictEqual(r.payload.label_bee_one, 'S13 - CORINA');
  // L'engagement de quinzaine se saisit parcelle par parcelle : jamais ici.
  assert.strictEqual('budgets_quinzaine' in r.payload, false);
});

test('buildFanoutPayload — famille touchée avec une DIVERGENCE non résolue : REFUS', () => {
  // Sans ce refus, la famille partirait entière et le champ divergent laissé
  // vide serait envoyé à 0 — la valeur qu'on venait de promettre de ne pas
  // toucher.
  const r = CBT.buildFanoutPayload(Object.assign({}, FANOUT_BASE, {
    familles: ['Récolte'],
    opsByFamille: {},
    values: { 'Récolte': '' },
    touched: { 'Récolte': true },
    divergentes: { 'Récolte': { nb: 3, min: 580, max: 1800 } },
  }));
  assert.strictEqual(r.ok, false);
  assert.match(String(r.error), /« Récolte » a 3 valeurs différentes selon les parcelles/);
  assert.match(String(r.error), /saisis cette valeur, ou repasse en portée Parcelle/);
});

test('buildFanoutPayload — divergence non résolue au niveau OPÉRATION : REFUS situé', () => {
  const r = CBT.buildFanoutPayload(Object.assign({}, FANOUT_BASE, {
    values: { 'Taille': '' },
    opValues: { 'Taille': { 'GB09::Taille de formation': '2' } },
    touched: { 'Taille': true },
    divergentesOps: { 'Taille': { 'GB09::Taille d\'hiver': { nb: 2, min: 4, max: 6 } } },
  }));
  assert.strictEqual(r.ok, false);
  // Le message doit désigner LAQUELLE des opérations (code compris).
  assert.match(String(r.error), /« Taille — Taille d'hiver \(GB09\) » a 2 valeurs différentes/);
});

test('buildFanoutPayload — une divergence RÉSOLUE (valeur saisie) ne bloque plus', () => {
  const r = CBT.buildFanoutPayload(Object.assign({}, FANOUT_BASE, {
    familles: ['Récolte'], opsByFamille: {},
    values: { 'Récolte': '1500' },
    touched: { 'Récolte': true },
    divergentes: { 'Récolte': { nb: 3, min: 580, max: 1800 } },
  }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(plain(r.payload.budgets), { 'Récolte': 1500 });
});

test('buildFanoutPayload — une divergence de FAMILLE ne bloque pas si le détail est saisi', () => {
  // La valeur de famille part à 0 de toute façon (invariant des deux niveaux) :
  // c'est un geste explicite de l'utilisateur, pas un effacement silencieux.
  const r = CBT.buildFanoutPayload(Object.assign({}, FANOUT_BASE, {
    values: { 'Taille': '' },
    opValues: { 'Taille': { 'GB09::Taille d\'hiver': '4', 'GB09::Taille de formation': '1' } },
    touched: { 'Taille': true },
    divergentes: { 'Taille': { nb: 2, min: 3, max: 9 } },
  }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.payload.budgets['Taille'], 0);
});

test('buildFanoutPayload — refuse campagne, cibles ou saisie manquantes, et valeur invalide', () => {
  const ok = Object.assign({}, FANOUT_BASE, {
    values: { 'Récolte': '1800' }, touched: { 'Récolte': true },
  });
  assert.strictEqual(CBT.buildFanoutPayload(Object.assign({}, ok, { campagne: '' })).ok, false);
  assert.strictEqual(CBT.buildFanoutPayload(Object.assign({}, ok, { labels: [] })).ok, false);
  assert.strictEqual(CBT.buildFanoutPayload(Object.assign({}, ok, { labels: ['', '  '] })).ok, false);
  assert.strictEqual(CBT.buildFanoutPayload(Object.assign({}, ok, { familles: [] })).ok, false);
  // Rien de touché : il n'y a rien à propager, et surtout rien à effacer.
  const rien = CBT.buildFanoutPayload(Object.assign({}, ok, { touched: {} }));
  assert.strictEqual(rien.ok, false);
  assert.match(String(rien.error), /Aucune valeur saisie/);
  const bad = CBT.buildFanoutPayload(Object.assign({}, ok, { values: { 'Récolte': 'abc' } }));
  assert.strictEqual(bad.ok, false);
  assert.match(String(bad.error), /Valeur invalide pour « Récolte »/);
  assert.strictEqual(
    CBT.buildFanoutPayload(Object.assign({}, ok, { values: { 'Récolte': '-2' } })).ok, false);
});

test('buildFanoutPayload — les deux constructeurs de payload ne disent PAS la même chose', () => {
  // Garde-fou anti-confusion : sur la MÊME saisie, l'un efface la famille non
  // saisie (vide → 0), l'autre ne la mentionne pas.
  const commun = {
    campagne: '2026-2027', familles: ['Taille', 'Récolte'],
    values: { 'Taille': '', 'Récolte': '1800' },
  };
  const parcelle = CBT.buildSavePayload(Object.assign({ label: 'S13 - CORINA' }, commun));
  const fanout = CBT.buildFanoutPayload(Object.assign({
    labels: ['S13 - CORINA'], touched: { 'Récolte': true },
  }, commun));
  assert.strictEqual(parcelle.payload.budgets['Taille'], 0, 'portée Parcelle : efface');
  assert.strictEqual('Taille' in fanout.payload.budgets, false, 'portée multiple : se taît');
});

// ------------------------------------------------------- rendu : champs touchés

test('rendu — saisir une famille la marque comme TOUCHÉE (unité d\'envoi)', () => {
  const spy = { effects: [], sets: [], fetches: [] };
  const tree = load(statePortee(), spy, WIN_PORTEE)({ userRole: 'dg' });
  const inputs = walk(tree).filter(function (n) { return n.type === 'input'; });
  spy.sets.length = 0;
  inputs[0].props.onChange({ target: { value: '1800' } });
  const poses = spy.sets.filter(function (s) { return s.index === S.touched; });
  assert.strictEqual(poses.length, 1);
  // Le setter reçoit une fonction de mise à jour : on l'applique pour vérifier.
  assert.deepStrictEqual(plain(poses[0].value({})), { 'Taille': true });
});

test('rendu — saisir une OPÉRATION marque SA FAMILLE comme touchée', () => {
  const spy = { effects: [], sets: [], fetches: [] };
  const tree = load(statePortee({ openFamilles: { 'Taille': true } }), spy, WIN_PORTEE)(
    { userRole: 'dg' });
  const inputs = walk(tree).filter(function (n) { return n.type === 'input'; });
  spy.sets.length = 0;
  // Ordre des champs : Taille (famille), son unique opération, puis Récolte.
  inputs[1].props.onChange({ target: { value: '4' } });
  const poses = spy.sets.filter(function (s) { return s.index === S.touched; });
  assert.strictEqual(poses.length, 1);
  assert.deepStrictEqual(plain(poses[0].value({})), { 'Taille': true });
});

test('rendu — le suivi des champs touchés est remis à zéro par portée / cible / tick', () => {
  // Garder « Récolte touchée » après un changement de cible propagerait à la
  // variété B une saisie faite pour la A.
  const spy = { effects: [], sets: [], fetches: [] };
  load(statePortee(), spy, WIN_PORTEE)({ userRole: 'dg' });
  const resets = spy.effects.filter(function (e) {
    spy.sets.length = 0;
    try { e.fn(); } catch (err) { /* effets async ignorés */ }
    return spy.sets.some(function (s) {
      return s.index === S.touched && Object.keys(s.value || {}).length === 0;
    });
  });
  assert.strictEqual(resets.length, 1);
  assert.deepStrictEqual(plain(resets[0].deps), ['variete', 'Myrtille||CORINA', 0],
    'invalidé par la portée, la cible ET le rafraîchissement');
});

test('rendu — lecture seule : aucun champ, mais les opérations dépliées restent lisibles', () => {
  const tree = load(stateOps({
    openFamilles: { 'Taille': true },
    opValues: { 'Taille': { 'GB09::Taille d\'hiver': '1,5' } },
  }))({ userRole: 'chef' });
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'input'; }).length, 0);
  const txt = textOf(tree);
  assert.ok(txt.includes('Taille d\'hiver'));
  assert.ok(txt.includes('1,5'));
  assert.ok(txt.includes('Saisie réservée aux profils DG/RH.'));
});
