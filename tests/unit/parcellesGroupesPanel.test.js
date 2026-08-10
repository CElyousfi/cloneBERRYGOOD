'use strict';

// Charge le composant IIFE (public/components/ParcellesGroupesPanel.jsx) dans un
// faux `window` (React stubé) et inspecte l'arbre rendu. Même technique que
// tests/unit/quinzaineCampagneSelect.test.js : pas de DOM, pas de RTL (limitation
// documentée du repo), mais React.createElement renvoie un arbre inspectable.
//
// Objet du test : la `key` du formulaire de groupe. Sans elle, cliquer « Éditer »
// sur un groupe B pendant l'édition d'un groupe A faisait réutiliser l'instance
// par React ; `selected` (initialisé au seul montage) restait celui de A et
// « Sauver » écrivait les membres de A dans le groupe B → CORRUPTION DE DONNÉES.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(type, props, ...children) {
  const flat = [];
  for (const c of children) {
    if (Array.isArray(c)) flat.push(...c);
    else if (c != null) flat.push(c);
  }
  const p = props || {};
  return { type, key: p.key, props: p, children: flat };
}

/**
 * Charge le composant avec un React stubé. `stateOverrides` pilote les valeurs
 * successives de useState DANS L'ORDRE DES APPELS de ParcellesGroupesPanel :
 * [groupes, loading, err, formState, tick]. `undefined` = garder l'initial.
 */
function renderPanel(props, stateOverrides) {
  const sandbox = { window: {}, module: { exports: {} } };
  let call = 0;
  sandbox.window.React = {
    createElement,
    useState: function (initial) {
      const override = (stateOverrides || [])[call++];
      return [override === undefined ? initial : override, function () {}];
    },
    useEffect: function () {},
  };
  vm.createContext(sandbox);
  const src = fs.readFileSync(
    path.join(__dirname, '../../public/components/ParcellesGroupesPanel.jsx'),
    'utf8'
  );
  vm.runInContext(src, sandbox);
  return sandbox.window.ParcellesGroupesPanel(props);
}

const GROUPE_A = { id: 'GRP-A', label: 'Groupe A', membres: [{ label: 'P1', ha: 1 }] };
const GROUPE_B = { id: 'GRP-B', label: 'Groupe B', membres: [{ label: 'P2', ha: 2 }] };

const BASE_PROPS = {
  rows: [{ label: 'P1' }, { label: 'P2' }],
  sbMap: { P1: { ha: 1 }, P2: { ha: 2 } },
  canEdit: true,
};

/** Le formulaire est le seul enfant de type fonction quand formState est truthy. */
function formElement(tree) {
  return tree.children.find(function (c) {
    return c && typeof c.type === 'function';
  });
}

/** Rend le panneau avec un formState donné et renvoie la key du formulaire. */
function formKeyFor(formState) {
  // [groupes, loading, err, formState, tick]
  const tree = renderPanel(BASE_PROPS, [[GROUPE_A, GROUPE_B], false, null, formState, 0]);
  const form = formElement(tree);
  assert.ok(form, 'formulaire de groupe absent de l\'arbre rendu');
  return form.key;
}

test('formulaire de groupe : key présente et non vide', () => {
  const key = formKeyFor(GROUPE_A);
  assert.ok(key, 'key manquante → React réutilise l\'instance et son état selected');
});

test('A → B : la key change (remontage forcé, pas de fuite des membres de A vers B)', () => {
  assert.notStrictEqual(formKeyFor(GROUPE_A), formKeyFor(GROUPE_B));
});

test('édition → nouveau, et nouveau → édition : la key change dans les deux sens', () => {
  const kA = formKeyFor(GROUPE_A);
  const kNew = formKeyFor('new');
  const kB = formKeyFor(GROUPE_B);
  assert.notStrictEqual(kA, kNew, 'édition → nouveau');
  assert.notStrictEqual(kNew, kB, 'nouveau → édition');
});

test('la key est stable pour une même cible (pas de remontage parasite)', () => {
  assert.strictEqual(formKeyFor(GROUPE_A), formKeyFor(GROUPE_A));
});

test('la key reste distincte si deux groupes partagent le même libellé', () => {
  const jumeau = { id: 'GRP-C', label: 'Groupe A', membres: [] };
  assert.notStrictEqual(formKeyFor(GROUPE_A), formKeyFor(jumeau));
});
