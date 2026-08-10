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

// ---------------------------------------------------------------------------
// Nom affiché : nom Smart Berry, repli sur le libellé BEE ONE.
// Cas réel : le doc `S10 YAZMIN CUT BACK F5` porte nom_sb « F5 - MYRTILLE
// EXTENSION ». Le tableau du dessus affiche le nom SB ; le panneau affichait le
// libellé BEE ONE → deux noms pour la même parcelle sur le même écran.
// L'identité technique (clé serveur, coche, Ha, %) reste le libellé BEE ONE.
// ---------------------------------------------------------------------------

const BEE_ONE = 'S10 YAZMIN CUT BACK F5';
const NOM_SB = 'F5 - MYRTILLE EXTENSION';

/** Toutes les chaînes de l'arbre, à plat. */
function texts(node, out) {
  out = out || [];
  if (node == null || node === false || node === true) return out;
  if (Array.isArray(node)) { node.forEach(function (n) { texts(n, out); }); return out; }
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (node.children) node.children.forEach(function (n) { texts(n, out); });
  return out;
}

/** Tous les éléments d'un type donné dans l'arbre. */
function findAll(node, type, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(function (n) { findAll(n, type, out); }); return out; }
  if (node.type === type) out.push(node);
  if (node.children) node.children.forEach(function (n) { findAll(n, type, out); });
  return out;
}

/** Rend le panneau PUIS le formulaire enfant (le stub n'invoque pas les composants). */
function renderForm(props, formState, groupes) {
  const tree = renderPanel(props, [groupes || [], false, null, formState, 0]);
  const form = formElement(tree);
  assert.ok(form, 'formulaire absent');
  return form.type(form.props);
}

test('cases à cocher : affichent le nom Smart Berry, pas le libellé BEE ONE', () => {
  const t = texts(renderForm({
    rows: [{ label: BEE_ONE }],
    sbMap: { [BEE_ONE]: { ha: 1.9, nom_sb: NOM_SB } },
    canEdit: true,
  }, 'new'));
  assert.ok(t.indexOf(NOM_SB) !== -1, 'nom Smart Berry absent des cases à cocher');
  assert.ok(t.indexOf(BEE_ONE) === -1, 'le libellé BEE ONE ne doit plus être affiché');
});

test('repli : sans nom_sb (absent, vide, espaces) on affiche le libellé BEE ONE', () => {
  [{ ha: 1.9 }, { ha: 1.9, nom_sb: '' }, { ha: 1.9, nom_sb: '   ' }, undefined].forEach(function (entry) {
    const sbMap = {};
    if (entry) sbMap[BEE_ONE] = entry;
    const t = texts(renderForm({ rows: [{ label: BEE_ONE }], sbMap: sbMap, canEdit: true }, 'new'));
    assert.ok(t.indexOf(BEE_ONE) !== -1, 'repli manquant pour ' + JSON.stringify(entry));
  });
});

test('résolution insensible à la casse et aux espaces du libellé', () => {
  const t = texts(renderForm({
    rows: [{ label: '  s10 yazmin cut back f5 ' }],
    sbMap: { [BEE_ONE]: { ha: 1.9, nom_sb: NOM_SB } },
    canEdit: true,
  }, 'new'));
  assert.ok(t.indexOf(NOM_SB) !== -1, 'clé sbMap non résolue quand la casse diffère');
});

test('membres d\'un groupe existant : nom Smart Berry affiché', () => {
  const groupe = { id: 'G1', label: 'Groupe X', membres: [{ label: BEE_ONE, ha: 1.9 }], parts: [] };
  const tree = renderPanel({
    rows: [{ label: BEE_ONE }],
    sbMap: { [BEE_ONE]: { ha: 1.9, nom_sb: NOM_SB } },
    canEdit: true,
  }, [[groupe], false, null, null, 0]);
  const t = texts(tree);
  assert.ok(t.indexOf(NOM_SB) !== -1, 'nom Smart Berry absent de la liste des membres');
  assert.ok(t.indexOf(BEE_ONE) === -1, 'libellé BEE ONE encore affiché dans les membres');
});

test('IDENTITÉ : la coche reste indexée sur le libellé BEE ONE, pas sur le nom SB', () => {
  // Édition d'un groupe dont le membre porte un nom SB : la case doit être
  // cochée, ce qui prouve que `selected` (issu de membres[].label, BEE ONE)
  // matche encore `r.label` malgré le changement d'affichage.
  const groupe = { id: 'G1', label: 'Groupe X', membres: [{ label: BEE_ONE, ha: 1.9 }] };
  const tree = renderForm({
    rows: [{ label: BEE_ONE }],
    sbMap: { [BEE_ONE]: { ha: 1.9, nom_sb: NOM_SB } },
    canEdit: true,
  }, groupe, [groupe]);
  const inputs = findAll(tree, 'input').filter(function (e) { return e.props.type === 'checkbox'; });
  assert.strictEqual(inputs.length, 1);
  assert.strictEqual(inputs[0].props.checked, true, 'la coche ne suit plus le libellé BEE ONE');
});

test('IDENTITÉ : appartenance exclusive toujours résolue sur le libellé BEE ONE', () => {
  const groupe = { id: 'G1', label: 'Groupe X', membres: [{ label: BEE_ONE, ha: 1.9 }] };
  const t = texts(renderForm({
    rows: [{ label: BEE_ONE }],
    sbMap: { [BEE_ONE]: { ha: 1.9, nom_sb: NOM_SB } },
    canEdit: true,
  }, 'new', [groupe]));
  assert.ok(
    t.some(function (s) { return s.indexOf('déjà dans Groupe X') !== -1; }),
    'le verrou d\'appartenance exclusive ne matche plus'
  );
});
