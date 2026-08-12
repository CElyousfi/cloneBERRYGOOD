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
 *   opValues, openFamilles]. `undefined` = garder l'initial.
 */
function load(stateOverrides, spy) {
  const sandbox = {
    window: {},
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

test('famillesFromOps — dédupliqué, trié par ordre du référentiel', () => {
  const ops = [
    { famille: 'Taille', ordre: 3 },
    { famille: 'Ferti-irrigation', ordre: 1 },
    { famille: 'Taille', ordre: 4 },
    { famille: 'Entretien structure', ordre: 2 },
  ];
  assert.deepStrictEqual(plain(CBT.famillesFromOps(ops)), [
    'Ferti-irrigation', 'Entretien structure', 'Taille',
  ]);
});

test('famillesFromOps — tolère vide, null et familles blanches', () => {
  assert.deepStrictEqual(plain(CBT.famillesFromOps(null)), []);
  assert.deepStrictEqual(plain(CBT.famillesFromOps([{ famille: '  ' }, {}])), []);
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

// -------------------------------------------------------------- opsByFamille

test('opsByFamille — groupé par famille, ordre du référentiel, dédupliqué', () => {
  const ops = [
    { famille: 'Taille', operation: 'B', ordre: 2 },
    { famille: 'Taille', operation: 'A', ordre: 1 },
    { famille: 'Taille', operation: 'A', ordre: 3 },
    { famille: 'Ferti-irrigation', operation: 'C', ordre: 4 },
    { famille: '', operation: 'X', ordre: 5 },
    { famille: 'Taille', operation: '', ordre: 6 },
  ];
  assert.deepStrictEqual(plain(CBT.opsByFamille(ops)), {
    'Taille': ['A', 'B'],
    'Ferti-irrigation': ['C'],
  });
  assert.deepStrictEqual(plain(CBT.opsByFamille(null)), {});
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

test('rendu — sans parcelle sélectionnée, invite au choix et pas de tableau', () => {
  const Comp = load([ROWS, FAMILLES, {}, '2026-2027', '', {}, false]);
  const tree = Comp({ userRole: 'dg' });
  assert.ok(textOf(tree).includes('Sélectionner une parcelle pour saisir son budget.'));
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'table'; }).length, 0);
});

// ------------------------------------------------- rendu : niveau opération

const OPS_BY_FAMILLE = {
  'Taille': ['Taille d\'hiver', 'Taille de formation'],
  'Ferti-irrigation': ['Fertigation'],
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
  assert.ok(txt.includes('Taille d\'hiver'));
  assert.ok(txt.includes('Taille de formation'));
  assert.ok(!txt.includes('Fertigation'), 'les autres familles restent repliées');
  // 2 champs famille + 2 champs opération de Taille.
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'input'; }).length,
    FAMILLES.length + 2);
});

test('rendu — total de famille CALCULÉ dès qu\'une opération est saisie (non éditable)', () => {
  const tree = load(stateOps({
    openFamilles: { 'Taille': true },
    opValues: { 'Taille': { 'Taille d\'hiver': '1,5', 'Taille de formation': '2' } },
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
  assert.deepStrictEqual(plain(resets[0].deps), ['F5- CASCADE -S13', 0],
    'invalidée par la parcelle sélectionnée ET par tick (Rafraîchir)');
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

test('rendu — lecture seule : aucun champ, mais les opérations dépliées restent lisibles', () => {
  const tree = load(stateOps({
    openFamilles: { 'Taille': true },
    opValues: { 'Taille': { 'Taille d\'hiver': '1,5' } },
  }))({ userRole: 'chef' });
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'input'; }).length, 0);
  const txt = textOf(tree);
  assert.ok(txt.includes('Taille d\'hiver'));
  assert.ok(txt.includes('1,5'));
  assert.ok(txt.includes('Saisie réservée aux profils DG/RH.'));
});
