'use strict';

// Bandeau « articles à classer » de Campagne › Campagne analytique : contrôle
// de classement Engrais / Pesticide en face de chaque article.
//
// CE QUE CE FICHIER GARDE :
//  1. le contrôle n'est proposé QU'aux profils qui peuvent réellement écrire —
//     montrer un bouton qui rendra 403 est pire que ne rien montrer ;
//  2. un article SANS fiche catalogue n'a PAS de contrôle (il n'y a rien à
//     mettre à jour : l'action rendrait 404) — il reçoit une mention ;
//  3. le clic appelle bien l'action serveur avec {article, categorie}, puis
//     RECHARGE la conso (`onClassed`). Sans ce rechargement, l'article resterait
//     affiché « à classer » et la correction paraîtrait sans effet.
//
// Le composant est chargé dans un faux `window` (vm) avec un React minimal :
// createElement invoque directement les composants fonction, ce qui donne un
// arbre inspectable sans react-dom. Même technique que
// tests/unit/campagneAnalytiquePivot.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');
const { loadEsm } = require('./_esm');

const ROOT = path.join(__dirname, '../..');

// ------------------------------------------------------------- faux React

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

/** États injectés au prochain rendu, dans l'ORDRE des useState du composant. */
let stateQueue = [];

function useState(init) {
  const v = stateQueue.length ? stateQueue.shift() : init;
  return [v, function () { /* setters ignorés : on n'inspecte qu'un rendu */ }];
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function transform(rel) {
  const file = path.join(ROOT, rel);
  return babel.transformSync(fs.readFileSync(file, 'utf8'), {
    presets: [require.resolve('@babel/preset-react')],
    filename: file, babelrc: false, configFile: false,
  }).code;
}

/**
 * Charge le composant. `stubs.fetch` / `stubs.firebase` permettent d'observer
 * l'appel réseau déclenché par un clic.
 */
function loadTab(stubs) {
  const s = stubs || {};
  const sandbox = { window: {}, console, document: undefined };
  sandbox.window.React = {
    createElement,
    Fragment: 'Fragment',
    useState,
    useEffect: function () {},
    useMemo: function (fn) { return fn(); },
  };
  if (s.fetch) sandbox.fetch = s.fetch;
  if (s.firebase) sandbox.firebase = s.firebase;
  vm.createContext(sandbox);
  sandbox.window.CultureUtils = loadEsm('src/modules/shared/lib/cultureUtils.js', { sandbox: sandbox });
  sandbox.window.AnalytiqueUtils = loadEsm('src/modules/shared/lib/analytiqueUtils.js', { sandbox: sandbox });
  sandbox.window.CampagneUtils = loadEsm('src/modules/shared/lib/campagneUtils.js', { sandbox: sandbox });
  sandbox.window.CampagneProduction = loadEsm('src/modules/shared/lib/campagneProduction.js', { sandbox: sandbox });
  sandbox.window.CampagneRapprochement = loadEsm('src/modules/shared/lib/campagneRapprochement.js', { sandbox: sandbox });
  sandbox.window.CampagneParcelleQuinzaine = loadEsm('src/modules/shared/lib/campagneParcelleQuinzaine.js', { sandbox: sandbox });
  vm.runInContext(transform('public/components/PivotAnalytiqueGrid.jsx'), sandbox);
  vm.runInContext(read('public/components/CampagneAnalytiqueTab.jsx'), sandbox);
  return sandbox.window.CampagneAnalytiqueTab;
}

// -------------------------------------------------------------- fixtures

// 3 articles à classer : deux avec fiche (catégorie présente mais hors des deux
// familles), un SANS fiche — le cas GENAKTIS / Maspilan.
const CONSO_DATA = {
  success: true,
  campagne: '2026/2027',
  articles_a_classer: [
    { article: 'EXTREME', categorie_actuelle: 'divers', lignes: 4, quantite: 120, unite: 'L' },
    { article: 'HUMOCAL', categorie_actuelle: 'amendement', lignes: 2, quantite: 50, unite: 'kg' },
    { article: 'GENAKTIS', categorie_actuelle: 'absent du catalogue', lignes: 1, quantite: 5, unite: 'L' },
  ],
  parcelles: [],
};

/** Parcourt l'arbre rendu et renvoie tous les nœuds vérifiant `pred`. */
function collect(node, pred, out) {
  const acc = out || [];
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, pred, acc));
    return acc;
  }
  if (pred(node)) acc.push(node);
  (node.children || []).forEach((c) => collect(c, pred, acc));
  return acc;
}

/** Texte concaténé d'un sous-arbre. */
function textOf(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children || []).map(textOf).join('');
}

/** Rend ConsoView avec les props données (états à leur valeur initiale). */
function renderConso(Tab, props) {
  stateQueue = [];
  return createElement(Tab.ConsoView, Object.assign({
    consoData: CONSO_DATA,
    subTab: 'engrais',
    farmFilter: null,
    cultureFilter: 'Toutes',
    sbMap: {},
  }, props || {}));
}

/** Boutons de classement du bandeau (libellé Engrais / Pesticide). */
function classBoutons(tree) {
  return collect(tree, (n) => n.type === 'button' && /^(Engrais|Pesticide|…)$/.test(textOf(n)));
}

// ---------------------------------------------------------------- tests

test('peutClasser : achats et dg seulement', () => {
  const Tab = loadTab();
  assert.strictEqual(Tab.peutClasser('dg'), true);
  assert.strictEqual(Tab.peutClasser('achats'), true);
  for (const r of ['magasinier', 'chef_f1', 'finance', 'rh', '', null, undefined]) {
    assert.strictEqual(Tab.peutClasser(r), false, 'profil ' + String(r));
  }
});

test('DG : un contrôle Engrais/Pesticide en face de CHAQUE article ayant une fiche', () => {
  const Tab = loadTab();
  const tree = renderConso(Tab, { userRole: 'dg' });
  const btns = classBoutons(tree);
  // 2 articles avec fiche × 2 boutons. GENAKTIS (sans fiche) n'en a AUCUN.
  assert.strictEqual(
    btns.length,
    4,
    'attendu 2 boutons (Engrais/Pesticide) pour chacun des 2 articles ayant une fiche'
  );
  const titres = btns.map((b) => b.props.title).sort();
  assert.deepStrictEqual(titres, [
    'Classer « EXTREME » en engrais',
    'Classer « EXTREME » en pesticide',
    'Classer « HUMOCAL » en engrais',
    'Classer « HUMOCAL » en pesticide',
  ]);
  assert.ok(
    !titres.some((t) => t.indexOf('GENAKTIS') !== -1),
    'un article absent du catalogue ne doit PAS avoir de contrôle : l\'action rendrait 404'
  );
});

test('article absent du catalogue : mention expliquant qu\'il faut créer la fiche', () => {
  const Tab = loadTab();
  const tree = renderConso(Tab, { userRole: 'dg' });
  const texte = textOf(tree);
  assert.match(
    texte,
    /créez d'abord sa fiche dans Stock › Articles/,
    'le bandeau doit dire quoi faire pour un article sans fiche, pas le laisser sans issue'
  );
});

test('profil sans droit : AUCUN contrôle (pas de bouton qui rendra 403)', () => {
  const Tab = loadTab();
  for (const role of ['magasinier', 'chef_f1', undefined]) {
    const tree = renderConso(Tab, { userRole: role });
    assert.strictEqual(
      classBoutons(tree).length,
      0,
      'profil ' + String(role) + ' ne doit voir aucun bouton de classement'
    );
  }
});

test('clic « Engrais » : POST classer-article {article, categorie} puis RECHARGEMENT de la conso', async () => {
  const appels = [];
  const fetchStub = function (url, opts) {
    appels.push({ url, opts });
    return Promise.resolve({
      json: function () {
        return Promise.resolve({ success: true, fiches_mises_a_jour: 2 });
      },
    });
  };
  const firebaseStub = {
    auth: function () {
      return { currentUser: { getIdToken: function () { return Promise.resolve('TOKEN'); } } };
    },
  };
  const Tab = loadTab({ fetch: fetchStub, firebase: firebaseStub });

  let recharge = 0;
  const tree = renderConso(Tab, {
    userRole: 'dg',
    onClassed: function () { recharge += 1; },
  });
  const btn = classBoutons(tree).find((b) => b.props.title === 'Classer « EXTREME » en engrais');
  assert.ok(btn, 'bouton Engrais de EXTREME introuvable');

  btn.props.onClick();
  // Laisse se résoudre la chaîne de promesses (getIdToken → fetch → json).
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  assert.strictEqual(appels.length, 1, 'un seul appel réseau attendu');
  assert.match(appels[0].url, /\/api\/stock\?action=classer-article/);
  assert.strictEqual(appels[0].opts.method, 'POST');
  assert.strictEqual(appels[0].opts.headers.Authorization, 'Bearer TOKEN');
  assert.deepStrictEqual(
    JSON.parse(appels[0].opts.body),
    { article: 'EXTREME', categorie: 'engrais' },
    'le corps doit porter le NOM de l\'article (le bandeau ne connaît pas d\'identifiant de fiche)'
  );
  assert.strictEqual(
    recharge,
    1,
    'la conso doit être RECHARGÉE après un classement réussi : sans cela l\'article reste '
      + 'affiché « à classer » et la correction paraît sans effet'
  );
});

test('le compte rendu affiche le NOMBRE de fiches mises à jour', () => {
  const Tab = loadTab();
  // 3e useState de ConsoView = classMsg (après metric, classing).
  stateQueue = ['perha', '', { article: 'EXTREME', fiches: 2, erreur: '' }];
  const tree = createElement(Tab.ConsoView, {
    consoData: CONSO_DATA, subTab: 'engrais', farmFilter: null,
    cultureFilter: 'Toutes', sbMap: {}, userRole: 'dg',
  });
  assert.match(
    textOf(tree),
    /EXTREME classé — 2 fiches mises à jour/,
    'le nombre de fiches doit être affiché : un nom porte souvent deux fiches (doublons)'
  );
});
