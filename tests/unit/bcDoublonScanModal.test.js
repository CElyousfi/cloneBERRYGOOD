'use strict';

/*
 * bcDoublonScanModal.test.js — câblage de la garde anti-doublon dans le modal
 * de SCAN (public/components/MagBCScanModal.jsx).
 *
 * C'est le chemin par lequel les 2 doublons de production sont arrivés : deux
 * soumissions du même scan, à 23 et 29 secondes d'intervalle. Le refus doit
 * donc y être lisible ET franchissable, sinon le magasinier reste bloqué sur
 * un « Erreur: … » qui ne nomme même pas le bon fautif.
 *
 * Même harnais que magBCScanModal.test.js, plus le composant partagé
 * BCDoublonDialog chargé dans le même sandbox (comme le fait le navigateur).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');
function babelise(rel) {
  return babel.transformSync(
    fs.readFileSync(path.join(ROOT, rel), 'utf8'),
    { presets: [require.resolve('@babel/preset-react')], filename: path.basename(rel), babelrc: false, configFile: false }
  ).code;
}
const SRC = babelise('public/components/MagBCScanModal.jsx');
const SRC_DIALOG = babelise('public/components/BCDoublonDialog.jsx');

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

/** États dans l'ordre des useState du composant. */
const S = { lotLieu: 0, queue: 1, currentIdx: 2, processing: 3, saving: 4, createdCount: 5, analyse: 6, doublonScan: 7 };

function load(stateOverrides, spy, opts) {
  const o = opts || {};
  const sandbox = {
    window: {},
    setTimeout: function (fn) { return setImmediate(fn); },
    fetch: function (url, init) {
      if (spy) spy.fetches.push({ url, init });
      if (/action=create-bc/.test(url)) {
        const body = o.createBcResponses && o.createBcResponses.length
          ? o.createBcResponses.shift()
          : o.createBcResponse;
        if (body) return Promise.resolve({ json: () => Promise.resolve(body) });
      }
      if (/save-bc-scan/.test(url) || /list-bc-scan/.test(url)) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, aliases: {} }) });
      }
      return new Promise(function () {});
    },
    confirm: function (msg) { if (spy) spy.confirms = (spy.confirms || []).concat([msg]); return true; },
    alert: function (msg) { if (spy) spy.alerts = (spy.alerts || []).concat([msg]); },
    FileReader: function () {},
    Date, Math, Set, JSON, parseFloat,
    document: { createElement: () => ({ style: {}, appendChild() {} }), body: { appendChild() {} } },
  };
  let call = 0;
  sandbox.window.React = {
    createElement,
    Fragment: 'Fragment',
    useState: function (initial) {
      const index = call++;
      const override = (stateOverrides || [])[index];
      return [override === undefined ? initial : override, function (v) { if (spy) spy.sets.push({ index, value: v }); }];
    },
    useEffect: function (fn, deps) { if (spy) spy.effects.push({ fn, deps }); },
    useRef: function (initial) {
      const ref = { current: initial };
      if (spy) spy.refs = (spy.refs || []).concat([ref]);
      return ref;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC_DIALOG, sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.MagBCScanModal;
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
    .join(' | ');
}
function flatText(node) { return textOf(node).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function findAll(node, pred) { return walk(node).filter((n) => n && n.props && pred(n)); }
function btnByText(tree, label) {
  return findAll(tree, (n) => n.type === 'button' && new RegExp(label).test(textOf(n)))[0];
}
function newSpy() { return { fetches: [], sets: [], effects: [], refs: [], alerts: [] }; }

const ARTICLES = [{ id: 'a1', nom: 'UREE 46', unite: 'kg' }];
const BASE_PROPS = {
  type: 'engrais',
  catalogueArticles: ARTICLES,
  getStock: () => 100,
  catalogUnit: () => 'kg',
  refForCampagne: [{ label: 'F1-P01', ref: 'R1', culture: 'Framboise', ferme: 'F1' }],
  parcelles: [], parcelleGroupes: [],
  parcelleNom: (l) => l,
  parcelleCulture: (l, fb) => fb || '',
  metaForParcelle: () => ({ culture: '', ferme: '' }),
  useConsoSelector: true,
  MAGASINS: ['F1', 'F5'], STATIONS: ['Station F1'],
  currentProfile: 'magasinier',
  profileData: { name: 'Magasinier Test' },
  onClose: () => {}, onCreated: () => {},
};
function line(over) {
  return Object.assign({
    article_lu: 'UREE', pile: 'A', article: 'UREE 46', article_initial: 'UREE 46',
    article_status: 'exact', parcelle_lue: 'P01', parcelle_status: 'exact',
    parcelle_candidats: [], quantite: '10', unite: 'kg',
    parcelle: 'F1-P01', parcelle_ref: 'R1', culture: 'Framboise', ferme: 'F1', groupe_id: '',
    barre: false, reintegre: false,
  }, over || {});
}
function entry(over) {
  return Object.assign({
    id: 'e1', file: { name: 'bon1.jpg' }, preview: 'blob:1', status: 'done',
    scan_url: 'https://scan/1.jpg', error: '',
    header: { date: '2026-08-20', ref_bon_physique: 'BC-77', motif: 'Fertigation', remarques: '', lieu_source_type: 'magasin', lieu_source_id: 'F1' },
    items: [line()],
  }, over || {});
}

const REFUS_409 = {
  success: false,
  error: 'Doublon : ce scan a déjà servi à créer le bon BC-2026-0032. Vérifiez ce bon avant de créer celui-ci.',
  doublon: { motif: 'scan_identique', bon_id: 'id32', bon_numero: 'BC-2026-0032' },
};

test('scan — un 409 doublon ouvre la fenêtre, sans alert brut', async () => {
  const spy = newSpy();
  const Modal = load([undefined, [entry()], 0], spy, { createBcResponse: REFUS_409 });
  const tree = Modal(BASE_PROPS);
  await btnByText(tree, 'Enregistrer ce bon').props.onClick();

  const set = spy.sets.filter((s) => s.index === S.doublonScan).pop();
  assert.ok(set && set.value, 'fenêtre de doublon ouverte');
  assert.equal(set.value.bon_numero, 'BC-2026-0032');
  assert.equal((spy.alerts || []).length, 0, 'aucun alert brut sur un doublon');
  // Le bon n'est PAS marqué enregistré : rien n'a été créé.
  assert.equal(spy.sets.some((s) => s.index === S.queue), false);
});

test('scan — la fenêtre affiche le numéro du bon existant', () => {
  const Modal = load([undefined, [entry()], 0, false, false, 0, undefined, {
    motif: 'scan_identique', bon_numero: 'BC-2026-0032', message: REFUS_409.error, entry: entry(), items: [line()],
  }], newSpy());
  const txt = flatText(Modal(BASE_PROPS));
  assert.match(txt, /BC-2026-0032/);
  assert.match(txt, /Créer quand même ce bon/);
});

test('scan — création normale : force_doublon N\'EST PAS envoyé', async () => {
  const spy = newSpy();
  const Modal = load([undefined, [entry()], 0], spy, { createBcResponse: { success: true, numero: 'BC-0100' } });
  await btnByText(Modal(BASE_PROPS), 'Enregistrer ce bon').props.onClick();
  const post = spy.fetches.find((f) => /action=create-bc/.test(f.url));
  const body = JSON.parse(post.init.body);
  assert.equal('force_doublon' in body, false);
});

test('scan — « Créer quand même ce bon » renvoie create-bc AVEC force_doublon', async () => {
  const spy = newSpy();
  const e = entry();
  const Modal = load([undefined, [e], 0, false, false, 0, undefined, {
    motif: 'scan_identique', bon_numero: 'BC-2026-0032', message: REFUS_409.error, entry: e, items: [line()],
  }], spy, { createBcResponse: { success: true, numero: 'BC-0101' } });
  const tree = Modal(BASE_PROPS);
  await btnByText(tree, 'Créer quand même ce bon').props.onClick();

  const post = spy.fetches.find((f) => /action=create-bc/.test(f.url));
  assert.ok(post, 'appel create-bc émis');
  const body = JSON.parse(post.init.body);
  assert.equal(body.force_doublon, true, 'le forçage DOIT envoyer le drapeau');
  // L'envoi rejoué est bien celui qui avait été refusé (scan compris).
  assert.equal(body.scan_url, 'https://scan/1.jpg');
  assert.equal(body.items.length, 1);
  // Et le bon est cette fois marqué enregistré.
  assert.ok(spy.sets.some((s) => s.index === S.queue));
});

test('scan — un refus NON doublon reste un alert classique', async () => {
  const spy = newSpy();
  const Modal = load([undefined, [entry()], 0], spy, { createBcResponse: { success: false, error: 'Type invalide' } });
  await btnByText(Modal(BASE_PROPS), 'Enregistrer ce bon').props.onClick();
  assert.ok((spy.alerts || []).some((a) => /Type invalide/.test(a)));
  assert.equal(spy.sets.some((s) => s.index === S.doublonScan && s.value), false);
});
