'use strict';

// Tests de RENDU de la DATE DE SAISIE dans la pop-up de détail d'un bon de
// consommation (public/components/MagBCTab.jsx, ticket sb/bc-date-saisie).
//
// Contexte : la ligne existait déjà mais ne s'affichait JAMAIS, car `fmtTs` ne
// savait pas lire le format réellement stocké — created_at est un nombre de
// MILLISECONDES epoch (valeur mesurée en production : 1787672414121), et la
// fonction retombait sur `return null`, ce qui masque la ligne (infoRow rend
// null quand value == null).
//
// Ce qui est verrouillé ici :
//   1. un created_at numérique en millisecondes affiche une date lisible ;
//   2. le libellé est « Saisi le » (vocabulaire d'Omar), pas « Créé le » ;
//   3. un horodatage en SECONDES est reconnu et rendu à la même date ;
//   4. une valeur numérique aberrante (0, NaN, an 58000, 1970) est MASQUÉE —
//      jamais un « Invalid Date » ni une date absurde à l'écran ;
//   5. non-régression : chaîne et horodatage Firestore { seconds } marchent.
//
// Même harnais que tests/unit/magBCTabEditDate.test.js : faux `window`, React
// stubé, JSX babélisé à la volée (pas de DOM, pas de RTL — limitation
// documentée du repo).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');
const SRC = babel.transformSync(
  fs.readFileSync(path.join(ROOT, 'public/components/MagBCTab.jsx'), 'utf8'),
  { presets: [require.resolve('@babel/preset-react')], filename: 'MagBCTab.jsx', babelrc: false, configFile: false }
).code;

const CampagneUtils = require('../../public/lib/campagneUtils.js');

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

/** Index des useState du composant, dans l'ordre de déclaration. */
const S = {
  bcs: 0, loading: 1, detailBc: 25,
};

function load(stateOverrides) {
  const sandbox = {
    window: {
      useStockLocations: () => ({ magasins: ['F1', 'F5'] }),
      cachedFetch: () => new Promise(function () {}),
      CampagneUtils,
    },
    fetch: function () { return new Promise(function () {}); },
    alert: function () {},
    confirm: function () { return true; },
    setTimeout,
    Date,
    Math,
    Set,
    JSON,
    parseFloat,
    XLSX: {},
    document: { createElement: () => ({ style: {}, appendChild() {} }), body: { appendChild() {} } },
  };
  let call = 0;
  sandbox.window.React = {
    createElement,
    Fragment: 'Fragment',
    useState: function (initial) {
      const index = call++;
      const override = (stateOverrides || {})[index];
      const value = override === undefined
        ? (typeof initial === 'function' ? initial() : initial)
        : override;
      return [value, function () {}];
    },
    useEffect: function () {},
    useRef: function (initial) { return { current: initial }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.MagBCTab;
}

function walk(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => walk(c, out));
  return out;
}
function textOf(node) {
  return walk(node)
    .flatMap((n) => (n.children || []).filter((c) => typeof c === 'string' || typeof c === 'number').map(String))
    .join(' ');
}
function flatText(node) { return textOf(node).replace(/\s+/g, ' ').trim(); }

// --------------------------------------------------------------- fixtures

// Valeur RÉELLE mesurée en production sur un bc.created_at.
const CREATED_AT_MS = 1787672414121;
const EXPECTED = new Date(CREATED_AT_MS).toLocaleString('fr-FR');

const BC = { id: 'bc1', numero: 'BC-0001', date: '2026-07-14', items: [], created_by: { name: 'Ali' } };

/** Rend la pop-up de détail pour un bon dont created_at vaut `createdAt`. */
function renderDetail(createdAt) {
  const bc = Object.assign({}, BC);
  if (createdAt !== undefined) bc.created_at = createdAt;
  const MagBCTab = load({ [S.loading]: false, [S.bcs]: [bc], [S.detailBc]: bc });
  return flatText(MagBCTab({ type: 'engrais', currentProfile: 'magasinier', profileData: { name: 'Test' } }));
}

// ------------------------------------------------------- le test qui compte

test('date de saisie — un created_at en millisecondes s\'affiche dans la pop-up', () => {
  const txt = renderDetail(CREATED_AT_MS);
  assert.match(txt, /Saisi le/);
  assert.ok(txt.includes(EXPECTED), 'date attendue « ' + EXPECTED + ' » absente de : ' + txt);
  assert.doesNotMatch(txt, /Invalid Date/);
});

test('date de saisie — le libellé est « Saisi le », pas « Créé le »', () => {
  const txt = renderDetail(CREATED_AT_MS);
  assert.match(txt, /Saisi le/);
  assert.doesNotMatch(txt, /Créé le/);
  // On n'a pas cassé la ligne voisine « Créé par ».
  assert.match(txt, /Créé par/);
});

// --------------------------------------------------------------- unités

test('date de saisie — un horodatage en SECONDES rend la même date qu\'en ms', () => {
  const txt = renderDetail(Math.floor(CREATED_AT_MS / 1000));
  assert.ok(txt.includes(new Date(Math.floor(CREATED_AT_MS / 1000) * 1000).toLocaleString('fr-FR')));
  assert.doesNotMatch(txt, /Invalid Date/);
});

test('date de saisie — valeurs numériques aberrantes MASQUÉES, jamais « Invalid Date »', () => {
  const aberrantes = [
    0,                    // absent / non renseigné
    NaN,                  // calcul raté en amont
    -1787672414121,       // négatif
    Infinity,
    12345,                // ni ms ni s plausibles → 1970 dans les deux unités
    1787672414121000,     // microsecondes → an 58000 en ms, an 58000 en s aussi
  ];
  for (const v of aberrantes) {
    const txt = renderDetail(v);
    assert.doesNotMatch(txt, /Invalid Date/, 'valeur ' + String(v));
    assert.doesNotMatch(txt, /Saisi le/, 'valeur ' + String(v) + ' ne doit pas afficher de ligne');
    assert.doesNotMatch(txt, /1970|58000/, 'valeur ' + String(v));
  }
});

test('date de saisie — ligne absente quand created_at n\'existe pas', () => {
  assert.doesNotMatch(renderDetail(undefined), /Saisi le/);
});

// ------------------------------------------------------------ non-régression

test('date de saisie — les formats déjà supportés continuent de marcher', () => {
  // Horodatage Firestore côté client.
  const fs1 = renderDetail({ seconds: Math.floor(CREATED_AT_MS / 1000) });
  assert.match(fs1, /Saisi le/);
  assert.doesNotMatch(fs1, /Invalid Date/);
  // Horodatage Firestore sérialisé par une Cloud Function.
  const fs2 = renderDetail({ _seconds: Math.floor(CREATED_AT_MS / 1000) });
  assert.match(fs2, /Saisi le/);
  // Chaîne ISO.
  const iso = renderDetail('2026-07-14T09:20:14.121Z');
  assert.match(iso, /Saisi le/);
  assert.doesNotMatch(iso, /Invalid Date/);
  // Chaîne courte : rendue telle quelle.
  assert.match(renderDetail('2026-07-14'), /2026-07-14/);
});
