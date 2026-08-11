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
  for (const c of children) {
    if (Array.isArray(c)) flat.push(...c);
    else if (c != null && c !== false) flat.push(c);
  }
  const p = props || {};
  return { type, key: p.key, props: p, children: flat };
}

/**
 * @param {Array<*>} [stateOverrides] valeurs successives de useState DANS
 *   L'ORDRE DES APPELS : [rows, familles, budgetsByLabel, campagne, selected,
 *   values, loading, err, saving, msg, tick]. `undefined` = garder l'initial.
 */
function load(stateOverrides) {
  const sandbox = { window: {}, fetch: function () { return new Promise(function () {}); } };
  let call = 0;
  sandbox.window.React = {
    createElement,
    Fragment: 'Fragment',
    useState: function (initial) {
      const override = (stateOverrides || [])[call++];
      return [override === undefined ? initial : override, function () {}];
    },
    useEffect: function () {},
    useMemo: function (fn) { return fn(); },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.CampagneBudgetTab;
}

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

test('rendu — sans parcelle sélectionnée, invite au choix et pas de tableau', () => {
  const Comp = load([ROWS, FAMILLES, {}, '2026-2027', '', {}, false]);
  const tree = Comp({ userRole: 'dg' });
  assert.ok(textOf(tree).includes('Sélectionner une parcelle pour saisir son budget.'));
  assert.strictEqual(walk(tree).filter(function (n) { return n.type === 'table'; }).length, 0);
});
