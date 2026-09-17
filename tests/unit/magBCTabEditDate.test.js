'use strict';

// Tests de RENDU de la modification de la DATE d'un bon de consommation
// (public/components/MagBCTab.jsx, ticket sb/bc-modifier-date).
//
// Même harnais que tests/unit/magBCScanModal.test.js : faux `window`, React
// stubé, JSX babélisé à la volée (pas de DOM, pas de RTL — limitation
// documentée du repo).
//
// Ce qui est verrouillé ici :
//   1. le bouton de modification n'existe QUE pour le profil magasinier ;
//   2. il n'apparaît pas sur les lignes virtuelles (mov_…) ni sur les imports ;
//   3. l'avertissement de changement de campagne s'affiche quand il faut, et
//      PAS quand la campagne ne change pas ;
//   4. la confirmation POSTe bien `update-bc-date` avec {bc_id, date} ;
//   5. l'erreur serveur est affichée telle quelle.

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

const CampagneUtils = require('./_esm').loadEsm('src/modules/shared/lib/campagneUtils.js');

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
  bcs: 0, loading: 1, showForm: 2, showScan: 3, stocks: 4, catalogueArticles: 5,
  showCreateArticle: 6, newArticle: 7, creatingArt: 8, createArticleLineIdx: 9,
  parcelles: 10, refParcelles: 11, sbRefMap: 12, parcelleGroupes: 13, form: 14,
  scanFileBC: 15, scanPreviewBC: 16, bcCampagne: 17, bcCulture: 18, query: 19,
  filterSource: 20, dateFrom: 21, dateTo: 22, sortField: 23, sortDir: 24,
  detailBc: 25, editDateBc: 26, editDateValue: 27, editDateSaving: 28, editDateError: 29,
};

function load(stateOverrides, spy) {
  const sandbox = {
    window: {
      useStockLocations: () => ({ magasins: ['F1', 'F5'] }),
      cachedFetch: () => new Promise(function () {}),
      CampagneUtils,
    },
    fetch: function (url, init) {
      if (spy) spy.fetches.push({ url, init });
      if (spy && spy.responses && spy.responses[0] !== undefined) {
        const body = spy.responses.shift();
        return Promise.resolve({ json: () => Promise.resolve(body) });
      }
      return new Promise(function () {});
    },
    alert: function (msg) { if (spy) spy.alerts.push(msg); },
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
      return [value, function (v) { if (spy) spy.sets.push({ index, value: v }); }];
    },
    useEffect: function (fn, deps) { if (spy) spy.effects.push({ fn, deps }); },
    useRef: function (initial) {
      const ref = { current: initial };
      if (spy) spy.refs.push(ref);
      return ref;
    },
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
function findAll(node, pred) { return walk(node).filter((n) => n && n.props && pred(n)); }
function editButtons(tree) { return findAll(tree, (n) => n.props.title === 'Modifier la date du bon'); }

function newSpy(responses) {
  return { fetches: [], sets: [], effects: [], refs: [], alerts: [], responses: responses || [] };
}

// --------------------------------------------------------------- fixtures

const BCS = [
  { id: 'bc1', numero: 'BC-0001', date: '2026-08-20', items: [{ article: 'UREE 46', quantite: 10, unite: 'kg', parcelle: 'F1-P01' }], created_by: { name: 'Ali' } },
  { id: 'mov_9', numero: 'BCS-0009', date: '2026-08-19', items: [{ article: 'MAP', quantite: 5, unite: 'kg', parcelle: 'F5-P02' }], created_by: {} },
  { id: 'bc3', numero: 'IMP-0003', date: '2026-08-18', items: [{ article: 'MAP', quantite: 2, unite: 'kg', parcelle: 'F5-P02' }], created_by: { userId: 'import_caneva' } },
];

function render(profile, extraStates, spy) {
  const states = Object.assign({ [S.loading]: false, [S.bcs]: BCS }, extraStates || {});
  const MagBCTab = load(states, spy);
  return MagBCTab({ type: 'engrais', currentProfile: profile, profileData: { name: 'Test' } });
}

// ------------------------------------------------------- visibilité bouton

test('bouton « Modifier la date » — visible pour le magasinier, un par bon éditable', () => {
  const tree = render('magasinier', null, newSpy());
  const btns = editButtons(tree);
  // bc1 seulement : la ligne virtuelle mov_9 n'a pas de document à modifier,
  // et IMP-0003 est un import.
  assert.equal(btns.length, 1);
});

test('bouton « Modifier la date » — ABSENT pour un profil non magasinier', () => {
  for (const profil of ['dg', 'achats', 'chef_f1', '']) {
    const tree = render(profil, null, newSpy());
    assert.equal(editButtons(tree).length, 0, 'profil ' + profil);
  }
});

// ------------------------------------------------------------ avertissement

test('avertissement de campagne — affiché quand la date fait changer de campagne', () => {
  const tree = render('magasinier', {
    [S.editDateBc]: BCS[0],       // date 2026-08-20 → campagne 2026-2027
    [S.editDateValue]: '2026-06-30', // → campagne 2025-2026
  }, newSpy());
  const txt = flatText(tree);
  assert.match(txt, /change de campagne/);
  assert.match(txt, /2026-2027 → 2025-2026/);
});

test('avertissement de campagne — affiché aussi dans le sens inverse', () => {
  const tree = render('magasinier', {
    [S.editDateBc]: { id: 'bc9', numero: 'BC-9', date: '2026-06-30', items: [] },
    [S.editDateValue]: '2026-07-01',
  }, newSpy());
  assert.match(flatText(tree), /2025-2026 → 2026-2027/);
});

test('avertissement de campagne — ABSENT quand la campagne ne change pas', () => {
  const same = render('magasinier', { [S.editDateBc]: BCS[0], [S.editDateValue]: '2026-12-31' }, newSpy());
  assert.doesNotMatch(flatText(same), /change de campagne/);
  // Date identique à l'existante : pas d'avertissement non plus.
  const identical = render('magasinier', { [S.editDateBc]: BCS[0], [S.editDateValue]: '2026-08-20' }, newSpy());
  assert.doesNotMatch(flatText(identical), /change de campagne/);
  // Date vide (pas encore saisie) : pas d'avertissement fantôme.
  const empty = render('magasinier', { [S.editDateBc]: BCS[0], [S.editDateValue]: '' }, newSpy());
  assert.doesNotMatch(flatText(empty), /change de campagne/);
});

test('fenêtre de modification — rappelle le bon et sa date actuelle', () => {
  const tree = render('magasinier', { [S.editDateBc]: BCS[0], [S.editDateValue]: '2026-08-20' }, newSpy());
  const txt = flatText(tree);
  assert.match(txt, /Modifier la date/);
  assert.match(txt, /BC-0001/);
  assert.match(txt, /2026-08-20/);
  assert.match(txt, /Seule la date est modifiée/);
});

// -------------------------------------------------------------- soumission

test('confirmation — POST update-bc-date avec bc_id et date', async () => {
  const spy = newSpy([{ success: true, movements_updated: 2 }]);
  const tree = render('magasinier', { [S.editDateBc]: BCS[0], [S.editDateValue]: '2026-08-10' }, spy);
  const confirmBtn = findAll(tree, (n) => n.children && n.children.indexOf('Confirmer la date') >= 0)[0];
  assert.ok(confirmBtn, 'bouton de confirmation présent');
  await confirmBtn.props.onClick();

  const post = spy.fetches.find((f) => /action=update-bc-date/.test(f.url));
  assert.ok(post, 'appel update-bc-date émis');
  assert.equal(post.init.method, 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { bc_id: 'bc1', date: '2026-08-10' });
  // Succès : la fenêtre se ferme (editDateBc remis à null)…
  assert.ok(spy.sets.some((s) => s.index === S.editDateBc && s.value === null));
  // …ET la liste est rechargée (loadBcs), sinon l'écran garde l'ancienne date
  // affichée alors que la base a changé — l'utilisateur croit l'échec.
  assert.ok(spy.fetches.some((f) => /action=list-bc(&|$)/.test(f.url)), 'liste rechargée après succès');
});

test('refus serveur — le message est affiché TEL QUEL, la fenêtre reste ouverte', async () => {
  const spy = newSpy([{ success: false, error: 'Date future refusée : une consommation ne peut pas être postérieure à aujourd\'hui' }]);
  const tree = render('magasinier', { [S.editDateBc]: BCS[0], [S.editDateValue]: '2030-01-01' }, spy);
  const confirmBtn = findAll(tree, (n) => n.children && n.children.indexOf('Confirmer la date') >= 0)[0];
  await confirmBtn.props.onClick();

  const errSet = spy.sets.filter((s) => s.index === S.editDateError).pop();
  assert.ok(errSet);
  assert.match(errSet.value, /Date future refusée/);
  // Aucune fermeture de fenêtre sur refus.
  assert.equal(spy.sets.some((s) => s.index === S.editDateBc && s.value === null), false);
});

test('message d\'erreur — rendu quand editDateError est posé', () => {
  const tree = render('magasinier', {
    [S.editDateBc]: BCS[0], [S.editDateValue]: '2026-08-10', [S.editDateError]: 'Bon de consommation introuvable',
  }, newSpy());
  assert.match(flatText(tree), /Bon de consommation introuvable/);
});
