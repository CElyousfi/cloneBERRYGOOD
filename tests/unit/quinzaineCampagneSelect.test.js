'use strict';

// Charge le composant IIFE (public/components/QuinzaineCampagneSelect.jsx) dans un
// faux `window` (React.createElement stubé) pour tester ses helpers purs de
// groupement/tri par campagne + le FALLBACK gracieux (periodeCampagne absent).
// Le composant n'a besoin d'AUCUN DOM : createElement renvoie un arbre inspectable.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadEsm } = require('./_esm');

// Stub minimal de React.createElement → { type, props, children }.
function createElement(type, props, ...children) {
  const flat = [];
  for (const c of children) {
    if (Array.isArray(c)) flat.push(...c);
    else if (c != null) flat.push(c);
  }
  const p = props || {};
  return { type, key: p.key, props: p, children: flat };
}

// Charge campagneUtils (publié sur window.CampagneUtils) puis le composant, dans un
// même contexte VM partageant `window` (comme les <script> du navigateur).
function loadComponent() {
  const sandbox = { window: {}, module: { exports: {} } };
  sandbox.window.React = { createElement };
  vm.createContext(sandbox);

  sandbox.window.CampagneUtils = loadEsm('src/modules/shared/lib/campagneUtils.js', { sandbox });

  // Le .jsx contient de la JSX ? Non — le composant utilise React.createElement,
  // donc il est exécutable tel quel sans Babel.
  const compSrc = fs.readFileSync(
    path.join(__dirname, '../../public/components/QuinzaineCampagneSelect.jsx'),
    'utf8'
  );
  vm.runInContext(compSrc, sandbox);
  return sandbox.window.QuinzaineCampagneSelect;
}

const QCS = loadComponent();

// Récupère les valeurs des <option> dans l'ordre de rendu (à plat, groupes inclus).
function optionValues(select) {
  const vals = [];
  for (const child of select.children) {
    if (child.type === 'optgroup') {
      for (const opt of child.children) vals.push(opt.props.value);
    } else if (child.type === 'option') {
      vals.push(child.props.value);
    }
  }
  return vals;
}

test('rend un seul optgroup, celui de la campagne courante (la plus récente)', () => {
  // Depuis 2450a88 (fix(quinzaine): limiter le sélecteur à la campagne courante
  // uniquement) : QCS_group().slice(0, 1) — les campagnes plus anciennes ne sont
  // plus affichées du tout (décision produit, pas un bug). Voir QCS_group() dans
  // QuinzaineCampagneSelect.jsx pour la logique de tri/groupement encore
  // multi-campagne (utile si ce filtre est un jour assoupli).
  const el = QCS({
    periodes: ['Quinzaine 24', 'Quinzaine 01', 'Quinzaine 02'],
    periodeCampagne: {
      'Quinzaine 24': '2025-2026',
      'Quinzaine 01': '2026-2027',
      'Quinzaine 02': '2026-2027',
    },
    value: 'Quinzaine 01',
    onChange: () => {},
  });
  const groups = el.children.filter((c) => c.type === 'optgroup');
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].props.label, '2026-2027'); // campagne courante uniquement
  assert.deepStrictEqual(optionValues(el), ['Quinzaine 02', 'Quinzaine 01']);
});

test('keys uniques campagne|periode (fin des collisions React)', () => {
  const el = QCS({
    periodes: ['Quinzaine 01', 'Quinzaine 01b'],
    periodeCampagne: { 'Quinzaine 01': '2026-2027', 'Quinzaine 01b': '2025-2026' },
    value: '',
  });
  const keys = [];
  for (const g of el.children) for (const o of g.children) keys.push(o.key);
  assert.strictEqual(new Set(keys).size, keys.length);
});

test('FALLBACK : periodeCampagne absent + periodeDates fourni → dérive campagne client, campagne courante uniquement', () => {
  const el = QCS({
    periodes: ['Quinzaine 24', 'Quinzaine 01'],
    periodeDates: {
      'Quinzaine 24': ['2026-06-16'],
      'Quinzaine 01': ['2026-07-01'],
    },
    value: '',
  });
  const groups = el.children.filter((c) => c.type === 'optgroup');
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].props.label, '2026-2027');
  assert.deepStrictEqual(optionValues(el), ['Quinzaine 01']);
});

test('FALLBACK LISTE PLATE : ni periodeCampagne ni periodeDates → tri numéro DESC, pas de crash', () => {
  const el = QCS({
    periodes: ['Quinzaine 01', 'Quinzaine 24', 'Quinzaine 12'],
    value: '',
  });
  // Aucun optgroup, options à plat triées numéro DESC.
  assert.strictEqual(el.children.filter((c) => c.type === 'optgroup').length, 0);
  assert.deepStrictEqual(optionValues(el), [
    'Quinzaine 24',
    'Quinzaine 12',
    'Quinzaine 01',
  ]);
});

test('option vide (includeEmpty) rendue en tête', () => {
  const el = QCS({
    periodes: ['Quinzaine 01'],
    periodeCampagne: { 'Quinzaine 01': '2026-2027' },
    includeEmpty: true,
    label: 'Dernière quinzaine',
    value: '',
  });
  assert.strictEqual(el.children[0].type, 'option');
  assert.strictEqual(el.children[0].props.value, '');
  assert.strictEqual(el.children[0].children[0], 'Dernière quinzaine');
});

test('onChange reçoit la valeur (pas l’event)', () => {
  let got = null;
  const el = QCS({
    periodes: ['Quinzaine 01'],
    periodeCampagne: { 'Quinzaine 01': '2026-2027' },
    value: '',
    onChange: (v) => { got = v; },
  });
  el.props.onChange({ target: { value: 'Quinzaine 01' } });
  assert.strictEqual(got, 'Quinzaine 01');
});

test('periodes vide → select sans option, aucun crash', () => {
  const el = QCS({ periodes: [], value: '' });
  assert.strictEqual(el.type, 'select');
  assert.deepStrictEqual(el.children, []);
});
