'use strict';

// Tests de RENDU de la modale « Scanner des Bons de Consommation »
// (src/modules/magasin/MagBCScanModal.jsx).
//
// Même harnais que tests/unit/affectationAnalytiqueTable.test.js : faux
// `window`, React stubé, JSX babélisé à la volée (pas de DOM, pas de RTL —
// limitation documentée du repo).
//
// Ce que ces tests verrouillent (les 3 défauts à ne PAS reproduire du flux
// « Bons d'Apport ») :
//   1. le compteur « Bon X / N » suit réellement l'index courant ;
//   2. le garde-fou d'enregistrement (aucune parcelle en texte libre) ;
//   3. l'absence de fermeture au clic sur le fond (régression caa39fe/b5d2ff1).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');
const { loadComponent } = require('./_esm');

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
const S = { lotLieu: 0, queue: 1, currentIdx: 2, processing: 3, saving: 4, createdCount: 5, analyse: 6 };

function load(stateOverrides, spy, opts) {
  const o = opts || {};
  const sandbox = {
    window: {},
    // Les attentes de reprise (backoff) sont instantanées en test : on retient
    // seulement les délais demandés, pour vérifier qu'ils croissent.
    setTimeout: function (fn, ms) {
      if (spy) spy.waits = (spy.waits || []).concat([ms]);
      return setImmediate(fn);
    },
    // `fetch` espionné : sans réponse déclarée il reste pendant (aucun effet de
    // bord dans les tests de rendu pur).
    fetch: function (url, init) {
      if (spy) spy.fetches.push({ url, init });
      if (/action=create-bc/.test(url) && o.createBcResponse) {
        return Promise.resolve({ json: () => Promise.resolve(o.createBcResponse) });
      }
      if (/action=scan-bc/.test(url) && o.scanHandler) {
        return o.scanHandler(url, init);
      }
      if (/action=scan-bc/.test(url) && o.scanResponse) {
        return Promise.resolve({ json: () => Promise.resolve(o.scanResponse) });
      }
      if (/save-bc-scan-parcelle-alias/.test(url)) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true, count: 1 }) });
      }
      if (/list-bc-scan-parcelle-aliases/.test(url)) {
        return Promise.resolve({ json: () => Promise.resolve(o.parcelleAliasesResponse
          || { success: true, aliases: {} }) });
      }
      if (/save-bc-scan-alias/.test(url)) {
        return Promise.resolve({ json: () => Promise.resolve({ success: true }) });
      }
      return new Promise(function () {});
    },
    confirm: function (msg) { if (spy) spy.confirms = (spy.confirms || []).concat([msg]); return o.confirm !== false; },
    alert: function (msg) { if (spy) spy.alerts = (spy.alerts || []).concat([msg]); },
    FileReader: function () {},
    Date,
    Math,
    Set,
    JSON,
    parseFloat,
    document: { createElement: () => ({ style: {}, appendChild() {} }), body: { appendChild() {} } },
  };
  Object.assign(sandbox.window, o.window || {});
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
    // Les refs sont exposées au spy pour pouvoir simuler ce que fait un RENDU
    // réel : resynchroniser queueRef (spy.refs[0], 1er useRef du composant) sur
    // la file courante — c'est ainsi que des photos ajoutées en cours de lot
    // deviennent visibles des workers.
    useRef: function (initial) {
      const ref = { current: initial };
      if (spy) spy.refs = (spy.refs || []).concat([ref]);
      return ref;
    },
  };
  vm.createContext(sandbox);
  return loadComponent('src/modules/magasin/MagBCScanModal.jsx', sandbox).MagBCScanModal;
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
function findAll(node, pred) { return walk(node).filter((n) => n && n.props && pred(n)); }
/** Texte rendu, séparateurs de nœuds aplatis — lisible comme à l'écran. */
function flatText(node) { return textOf(node).replace(/\s*\|\s*/g, ' ').replace(/\s+/g, ' ').trim(); }

// --------------------------------------------------------------- fixtures

const ARTICLES = [
  { id: 'a1', nom: 'UREE 46', unite: 'kg' },
  { id: 'a2', nom: 'MAP', unite: 'kg' },
];
const REF_PARCELLES = [
  { label: 'F1-P01', ref: 'R1', culture: 'Framboise', ferme: 'F1' },
  { label: 'F5-P02', ref: 'R2', culture: 'Myrtille', ferme: 'F5' },
];

const BASE_PROPS = {
  type: 'engrais',
  catalogueArticles: ARTICLES,
  getStock: (a) => (a === 'UREE 46' ? 100 : 0),
  catalogUnit: (a) => (ARTICLES.find((x) => x.nom === a) || {}).unite || null,
  refForCampagne: REF_PARCELLES,
  parcelles: [],
  parcelleGroupes: [],
  parcelleNom: (l) => l,
  parcelleCulture: (l, fb) => fb || '',
  metaForParcelle: () => ({ culture: '', ferme: '' }),
  useConsoSelector: true,
  MAGASINS: ['F1', 'F5'],
  STATIONS: ['Station F1'],
  currentProfile: 'magasinier',
  profileData: { name: 'Magasinier Test' },
  onClose: () => {},
  onCreated: () => {},
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

// --------------------------------------------------------------- tests

test('zone de dépôt affichée quand la file est vide', () => {
  const Modal = load();
  const tree = Modal(BASE_PROPS);
  assert.match(textOf(tree), /Glissez vos photos de bons ici/);
});

test('la modale ne se ferme JAMAIS au clic sur le fond', () => {
  const Modal = load();
  const tree = Modal(BASE_PROPS);
  const overlay = findAll(tree, (n) => n.props.className === 'modal-overlay')[0];
  assert.ok(overlay, 'overlay présent');
  assert.strictEqual(overlay.props.onClick, undefined);
});

test('compteur « Bon X / N » — suit réellement l\'index courant', () => {
  const queue = [entry({ id: 'e1' }), entry({ id: 'e2' }), entry({ id: 'e3' })];
  assert.match(flatText(load([undefined, queue, 0])(BASE_PROPS)), /Bon 1 \/ 3/);
  assert.match(flatText(load([undefined, queue, 1])(BASE_PROPS)), /Bon 2 \/ 3/);
  assert.match(flatText(load([undefined, queue, 2])(BASE_PROPS)), /Bon 3 \/ 3/);
});

test('navigation — Précédent désactivé sur le 1er, Suivant sur le dernier', () => {
  const queue = [entry({ id: 'e1' }), entry({ id: 'e2' })];
  const first = load([undefined, queue, 0])(BASE_PROPS);
  const btns0 = findAll(first, (n) => n.type === 'button' && /Précédent|Suivant/.test(textOf(n)));
  assert.strictEqual(btns0.find((b) => /Précédent/.test(textOf(b))).props.disabled, true);
  assert.strictEqual(btns0.find((b) => /Suivant/.test(textOf(b))).props.disabled, false);
  const last = load([undefined, queue, 1])(BASE_PROPS);
  const btns1 = findAll(last, (n) => n.type === 'button' && /Précédent|Suivant/.test(textOf(n)));
  assert.strictEqual(btns1.find((b) => /Précédent/.test(textOf(b))).props.disabled, false);
  assert.strictEqual(btns1.find((b) => /Suivant/.test(textOf(b))).props.disabled, true);
});

test('bon complet — bouton « Enregistrer ce bon » actif', () => {
  const tree = load([undefined, [entry()], 0])(BASE_PROPS);
  const btn = findAll(tree, (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  assert.ok(btn, 'bouton présent');
  assert.strictEqual(btn.props.disabled, false);
  assert.doesNotMatch(textOf(tree), /Impossible d'enregistrer/);
});

test('garde-fou — 2 lignes sans parcelle : bouton désactivé + message chiffré', () => {
  const e = entry({ items: [
    line({ parcelle: '', parcelle_ref: '', parcelle_status: 'unmatched' }),
    line({ parcelle: '', parcelle_ref: '', parcelle_status: 'unmatched' }),
    line(),
  ] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  const btn = findAll(tree, (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  assert.strictEqual(btn.props.disabled, true);
  assert.match(textOf(tree), /2 lignes sans parcelle/);
});

test('garde-fou — une parcelle hors référentiel ne compte PAS comme valide', () => {
  const e = entry({ items: [line({ parcelle: 'PARCELLE INCONNUE', parcelle_status: 'probable' })] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  assert.match(textOf(tree), /1 ligne sans parcelle/);
});

test('garde-fou — article hors catalogue bloque l\'enregistrement', () => {
  const e = entry({ items: [line({ article: '', article_status: 'unmatched' })] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  const btn = findAll(tree, (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  assert.strictEqual(btn.props.disabled, true);
  assert.match(textOf(tree), /1 ligne sans article du catalogue/);
  assert.match(textOf(tree), /à choisir/);
});

test('garde-fou — quantité manquante bloque l\'enregistrement', () => {
  const e = entry({ items: [line({ quantite: '' })] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  assert.match(textOf(tree), /1 ligne sans quantité/);
});

// Un alias vient d'UNE seule correction du magasinier et n'est révisable nulle
// part : il ne doit JAMAIS s'afficher au même niveau de confiance qu'un match
// exact du catalogue (sinon une mauvaise sélection devient permanente et
// invisible).
test('statut « alias » — affiché en orange « mémorisé — à vérifier », pas en vert', () => {
  const e = entry({ items: [line({ article_status: 'alias' })] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  assert.match(flatText(tree), /mémorisé — à vérifier/);
  const dot = findAll(tree, (n) => n.type === 'span' && /mémorisé/.test(textOf(n)))[0];
  assert.strictEqual(dot.props.style.color, '#e65100');
  // Une seule pastille verte reste sur la ligne : celle de la PARCELLE (exact).
  // L'article, lui, n'en a plus.
  assert.strictEqual(findAll(tree, (n) => n.props.title === 'Reconnu au référentiel').length, 1);
});

test('statut « exact » — garde le ✅ vert', () => {
  const tree = load([undefined, [entry()], 0])(BASE_PROPS);
  // Article ET parcelle en `exact` → deux pastilles vertes.
  const dots = findAll(tree, (n) => n.type === 'span' && n.props.title === 'Reconnu au référentiel');
  assert.strictEqual(dots.length, 2);
  assert.ok(dots.every((d) => d.props.style.color === '#2e7d32'));
});

test('statut « alias » — article_alias_count affiché en info-bulle quand il est là', () => {
  const e = entry({ items: [line({ article_status: 'alias', article_alias_count: 3 })] });
  const dot = findAll(load([undefined, [e], 0])(BASE_PROPS), (n) => n.type === 'span' && /mémorisé/.test(textOf(n)))[0];
  assert.match(dot.props.title, /mémorisé 3 fois/);
});

test('statut « alias » — article_alias_count absent : aucun compteur inventé', () => {
  const e = entry({ items: [line({ article_status: 'alias' })] });
  const dot = findAll(load([undefined, [e], 0])(BASE_PROPS), (n) => n.type === 'span' && /mémorisé/.test(textOf(n)))[0];
  assert.doesNotMatch(dot.props.title, /fois/);
});

// Le garde-fou doit coller EXACTEMENT à ce que le select propose : sinon le
// magasinier voit un select vide alors que le bouton d'enregistrement est actif.
test('mode conso — une parcelle hors campagne courante est non résolue', () => {
  const props = Object.assign({}, BASE_PROPS, {
    useConsoSelector: true,
    parcelles: [{ Parcelle_Physique: 'F1-HORS-CAMPAGNE', Culture: 'Framboise', Ferme: 'F1' }],
  });
  const e = entry({ items: [line({ parcelle: 'F1-HORS-CAMPAGNE', parcelle_status: 'exact' })] });
  const tree = load([undefined, [e], 0])(props);
  assert.match(flatText(tree), /1 ligne sans parcelle/);
  const btn = findAll(tree, (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  assert.strictEqual(btn.props.disabled, true);
});

test('hors mode conso — la parcelle du référentiel général redevient valide', () => {
  const props = Object.assign({}, BASE_PROPS, {
    useConsoSelector: false,
    parcelles: [{ Parcelle_Physique: 'F1-HORS-CAMPAGNE', Culture: 'Framboise', Ferme: 'F1' }],
  });
  const e = entry({ items: [line({ parcelle: 'F1-HORS-CAMPAGNE', parcelle_status: 'exact' })] });
  const tree = load([undefined, [e], 0])(props);
  assert.doesNotMatch(flatText(tree), /sans parcelle/);
});

test('suggestions du scan — candidats sélectionnables remontés en tête du select', () => {
  const e = entry({ items: [line({ parcelle: '', parcelle_status: 'unmatched', parcelle_candidats: ['F5-P02', 'INCONNUE'] })] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  const grp = findAll(tree, (n) => n.type === 'optgroup' && n.props.label === 'Suggestions du scan')[0];
  assert.ok(grp, 'optgroup de suggestions présent');
  // Le candidat hors liste affichable n'est pas proposé.
  assert.deepStrictEqual(grp.children.map((o) => o.props.value), ['F5-P02']);
});

test('suggestions du scan — aucun optgroup quand il n\'y a pas de candidat', () => {
  const tree = load([undefined, [entry()], 0])(BASE_PROPS);
  assert.strictEqual(findAll(tree, (n) => n.type === 'optgroup' && n.props.label === 'Suggestions du scan').length, 0);
});

// ------------------------------------------------------- lignes barrées

// Une ligne jugée rayée par l'IA ne doit JAMAIS disparaître en silence : que la
// détection soit juste ou fausse, le magasinier doit voir ce qui est écrit sur
// le papier et décider lui-même (bon F1 0005671, ligne « MAP 7,2 kg »).
test('ligne barrée — affichée avec sa quantité et une mention explicite', () => {
  const e = entry({ items: [line(), line({ article_lu: 'MAP', article: 'MAP', quantite: '7.2', barre: true })] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  const txt = flatText(tree);
  assert.match(txt, /MAP/);
  assert.match(txt, /barrée sur le papier/);
  assert.match(txt, /1 ligne barrée sur le papier, non enregistrée/);
  // La quantité lue reste affichée dans son champ.
  const qte = findAll(tree, (n) => n.type === 'input' && n.props.type === 'number' && n.props.value === '7.2');
  assert.strictEqual(qte.length, 1);
});

test('ligne barrée — ne bloque pas le bouton même si article et parcelle manquent', () => {
  const e = entry({ items: [line(), line({ article_lu: 'MAP', article: '', parcelle: '', quantite: '', barre: true })] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  const btn = findAll(tree, (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  assert.strictEqual(btn.props.disabled, false);
  assert.doesNotMatch(flatText(tree), /Impossible d'enregistrer/);
});

test('ligne barrée RÉINTÉGRÉE — redevient soumise au garde-fou', () => {
  const e = entry({ items: [line(), line({ article_lu: 'MAP', article: '', parcelle: '', quantite: '', barre: true, reintegre: true })] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  const btn = findAll(tree, (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  assert.strictEqual(btn.props.disabled, true);
  const txt = flatText(tree);
  assert.match(txt, /1 ligne sans article du catalogue/);
  assert.match(txt, /1 ligne sans parcelle/);
  // Plus comptée comme exclue.
  assert.doesNotMatch(txt, /non enregistrée/);
});

test('ligne barrée — la case à cocher bascule dans les deux sens', () => {
  const spy = { fetches: [], sets: [], effects: [] };
  const e = entry({ items: [line({ barre: true })] });
  const tree = load([undefined, [e], 0], spy)(BASE_PROPS);
  const box = findAll(tree, (n) => n.type === 'input' && n.props.type === 'checkbox')[0];
  assert.ok(box, 'case à cocher présente');
  assert.strictEqual(box.props.checked, false);
  box.props.onChange({ target: { checked: true } });
  let queue = [e];
  spy.sets.filter((s) => typeof s.value === 'function').forEach((u) => { queue = u.value(queue); });
  assert.strictEqual(queue[0].items[0].reintegre, true);
  // Et l'inverse : re-exclure une ligne réintégrée.
  const e2 = entry({ items: [line({ barre: true, reintegre: true })] });
  const spy2 = { fetches: [], sets: [], effects: [] };
  const tree2 = load([undefined, [e2], 0], spy2)(BASE_PROPS);
  const box2 = findAll(tree2, (n) => n.type === 'input' && n.props.type === 'checkbox')[0];
  assert.strictEqual(box2.props.checked, true);
  box2.props.onChange({ target: { checked: false } });
  let queue2 = [e2];
  spy2.sets.filter((s) => typeof s.value === 'function').forEach((u) => { queue2 = u.value(queue2); });
  assert.strictEqual(queue2[0].items[0].reintegre, false);
});

test('ligne barrée — absente du body create-bc, présente une fois réintégrée', async () => {
  const barree = line({ article_lu: 'MAP', article: 'MAP', quantite: '7.2', barre: true });
  const spy = { fetches: [], sets: [], effects: [] };
  const e = entry({ items: [line(), barree] });
  const btn = findAll(load([undefined, [e], 0], spy, { createBcResponse: { success: true, numero: 'BC-1' } })(BASE_PROPS),
    (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  await btn.props.onClick();
  const body = JSON.parse(spy.fetches.find((f) => /action=create-bc/.test(f.url)).init.body);
  assert.deepStrictEqual(body.items.map((i) => i.article), ['UREE 46']);

  const spy2 = { fetches: [], sets: [], effects: [] };
  const e2 = entry({ items: [line(), Object.assign({}, barree, { reintegre: true })] });
  const btn2 = findAll(load([undefined, [e2], 0], spy2, { createBcResponse: { success: true, numero: 'BC-2' } })(BASE_PROPS),
    (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  await btn2.props.onClick();
  const body2 = JSON.parse(spy2.fetches.find((f) => /action=create-bc/.test(f.url)).init.body);
  assert.deepStrictEqual(body2.items.map((i) => i.article), ['UREE 46', 'MAP']);
});

test('champ `barre` absent de la réponse — comportement strictement inchangé', async () => {
  const e = await analyseOneItem({
    article_lu: 'UREE', article: 'UREE 46', article_status: 'exact',
    parcelle_lue: 'marvilla S-3', parcelle: '', quantite: 5, unite: 'kg',
  });
  assert.strictEqual(e.items[0].barre, false);
  assert.strictEqual(e.items[0].reintegre, false);
  const tree = load([undefined, [e], 0])(PROD_PROPS);
  assert.doesNotMatch(flatText(tree), /barrée sur le papier/);
  assert.strictEqual(findAll(tree, (n) => n.type === 'input' && n.props.type === 'checkbox').length, 0);
});

test('champ `barre: true` dans la réponse — la ligne arrive exclue mais visible', async () => {
  const e = await analyseOneItem({
    article_lu: 'MAP', article: '', parcelle_lue: 'marvilla S-3', quantite: 7.2, unite: 'kg', barre: true,
  });
  assert.strictEqual(e.items[0].barre, true);
  assert.strictEqual(e.items[0].reintegre, false);
  const tree = load([undefined, [e], 0])(PROD_PROPS);
  assert.match(flatText(tree), /barrée sur le papier/);
});

test('un bon enregistré reste dans la file, en lecture seule', () => {
  const e = entry({ status: 'saved', numero: 'BC-2026-001' });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  assert.match(textOf(tree), /Bon enregistré/);
  assert.match(textOf(tree), /BC-2026-001/);
  assert.strictEqual(findAll(tree, (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n))).length, 0);
  // Tous les champs du bon sauvegardé sont désactivés.
  const selects = findAll(tree, (n) => n.type === 'select' && n.props.disabled !== undefined);
  assert.ok(selects.length > 0);
  assert.ok(selects.every((s) => s.props.disabled === true), 'tous les selects du bon sauvegardé sont disabled');
});

test('libellé lu affiché en lecture seule avec son en-tête de pile', () => {
  const tree = load([undefined, [entry()], 0])(BASE_PROPS);
  const txt = textOf(tree);
  assert.match(txt, /UREE/);
  assert.match(txt, /pile :/);
});

test('statuts d\'analyse — vignettes en attente / erreur visibles', () => {
  const queue = [
    entry({ id: 'e1', status: 'pending', items: [] }),
    entry({ id: 'e2', status: 'error', error: 'Analyse impossible', items: [] }),
  ];
  const tree = load([undefined, queue, 1, false])(BASE_PROPS);
  assert.match(flatText(tree), /Erreur : Analyse impossible/);
  assert.match(flatText(tree), /Réessayer/);
});

test('lot terminé — récapitulatif des bons créés', () => {
  const queue = [entry({ status: 'saved', numero: 'BC-1' }), entry({ id: 'e2', status: 'saved', numero: 'BC-2' })];
  const tree = load([undefined, queue, 0, false, false, 2])(BASE_PROPS);
  const txt = textOf(tree);
  assert.match(txt, /Lot terminé/);
  assert.match(txt, /BC-1, BC-2/);
});

test('enregistrement — payload create-bc identique à la saisie manuelle + scan_url et ref_bon_physique', async () => {
  const spy = { fetches: [], sets: [], effects: [] };
  const Modal = load([undefined, [entry()], 0], spy, { createBcResponse: { success: true, numero: 'BC-2026-009' } });
  const tree = Modal(BASE_PROPS);
  const btn = findAll(tree, (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  await btn.props.onClick();
  const call = spy.fetches.find((f) => /action=create-bc/.test(f.url));
  assert.ok(call, 'create-bc appelé');
  const body = JSON.parse(call.init.body);
  assert.strictEqual(body.type, 'engrais');
  assert.strictEqual(body.date, '2026-08-20');
  assert.deepStrictEqual(body.lieu_source, { type: 'magasin', id: 'F1' });
  assert.deepStrictEqual(body.items, [{
    article: 'UREE 46', quantite: '10', unite: 'kg', parcelle: 'F1-P01',
    parcelle_ref: 'R1', culture: 'Framboise', ferme: 'F1', groupe_id: '',
  }]);
  assert.strictEqual(body.scan_url, 'https://scan/1.jpg');
  assert.strictEqual(body.ref_bon_physique, 'BC-77');
  assert.strictEqual(body.motif, 'Fertigation');
  assert.deepStrictEqual(body.created_by, { profileId: 'magasinier', name: 'Magasinier Test' });
  assert.deepStrictEqual(body.authorized_by, { profileId: 'magasinier', name: 'Magasinier Test' });
  // Article non corrigé → aucun alias appris.
  assert.strictEqual(spy.fetches.some((f) => /save-bc-scan-alias/.test(f.url)), false);
});

test('enregistrement — motif vide : envoyé en chaîne vide (champ optionnel)', async () => {
  const spy = { fetches: [], sets: [], effects: [] };
  const e = entry({ header: Object.assign({}, entry().header, { motif: '' }) });
  const Modal = load([undefined, [e], 0], spy, { createBcResponse: { success: true, numero: 'BC-1' } });
  const btn = findAll(Modal(BASE_PROPS), (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  await btn.props.onClick();
  const body = JSON.parse(spy.fetches.find((f) => /action=create-bc/.test(f.url)).init.body);
  assert.strictEqual(body.motif, '');
});

test('enregistrement — un article corrigé par l\'utilisateur apprend un alias', async () => {
  const spy = { fetches: [], sets: [], effects: [] };
  const e = entry({ items: [line({ article: 'MAP', article_initial: 'UREE 46', article_lu: 'UREE' })] });
  const Modal = load([undefined, [e], 0], spy, { createBcResponse: { success: true, numero: 'BC-1' } });
  const btn = findAll(Modal(BASE_PROPS), (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  await btn.props.onClick();
  const alias = spy.fetches.find((f) => /save-bc-scan-alias/.test(f.url));
  assert.ok(alias, 'alias enregistré');
  assert.deepStrictEqual(JSON.parse(alias.init.body), {
    libelle_lu: 'UREE', article_nom: 'MAP',
    created_by: { profileId: 'magasinier', name: 'Magasinier Test' },
  });
});

// --------------------------------------------- rapprochement parcelle (front)

/** Les 9 parcelles réellement proposées en prod, en mode conso. */
const PROD_OPTIONS = [
  'S3 - MARAVILLA MOTTE F1', 'S5 -YAZMIN MOW DOWN F1', 'S9 - REYNA F5',
  'S2 -YAZMIN MOW DOWN F1', 'S2.S3.S5.S6.S7 maravilla logn can F1',
  'F2 - HAAS', 'F3 -HAAS', 'F4 -HAAS', 'F5 CORINA myrtille',
];
const PROD_PROPS = Object.assign({}, BASE_PROPS, {
  useConsoSelector: true,
  refForCampagne: PROD_OPTIONS.map((label) => ({ label, ref: 'R-' + label, culture: '', ferme: '' })),
});

/**
 * Joue l'effet d'analyse sur UNE image et renvoie l'entrée de file résultante.
 * Le backend renvoie volontairement `parcelle: ''` / `unmatched` : c'est le
 * calcul FRONT qui doit produire la proposition.
 */
async function analyseOneItem(rawItem, props, extraWindow, opts) {
  const spy = { fetches: [], sets: [], effects: [] };
  const pending = entry({ status: 'pending', items: [] });
  const win = Object.assign({
    BcScanMatch: require('./_esm').loadEsm('src/modules/shared/lib/bcScanMatch.js'),
    ImageDownscale: { downscaleToDataUrl: () => Promise.resolve('data:image/jpeg;base64,AA') },
  }, extraWindow || {});
  const Modal = load([undefined, [pending], 0], spy, Object.assign({
    window: win,
    scanResponse: { success: true, scan_url: 'https://scan/1.jpg', analysis: { numero_bon: 'BC-9' }, items: [rawItem] },
  }, opts || {}));
  Modal(props || PROD_PROPS);
  // Chargement des alias de parcelle (2e effet) : joué AVANT l'analyse, comme au
  // montage réel de la modale. L'ordre des effets est verrouillé par ce test.
  if (spy.effects[1]) {
    spy.effects[1].fn();
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  }
  const analyse = spy.effects[0];
  // L'effet lance une IIFE async et rend la main tout de suite : on laisse la
  // boucle d'analyse se dérouler avant de lire les mises à jour de file.
  analyse.fn();
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  // Dernier updater setQueue posant le statut 'done'.
  const updaters = spy.sets.filter((s) => typeof s.value === 'function');
  let queue = [pending];
  updaters.forEach((u) => { queue = u.value(queue); });
  return queue[0];
}

test('parcelle — « yasmin niyas S-9 » : le front décide, le backend est ignoré', async () => {
  const e = await analyseOneItem({
    article_lu: 'UREE', article: 'UREE 46', article_status: 'exact',
    parcelle_lue: 'yasmin niyas S-9', parcelle: '', parcelle_status: 'unmatched',
    quantite: 5, unite: 'kg', pile: 'A',
  });
  assert.strictEqual(e.status, 'done');
  // Veto de variété (garde 2, alignée sur le backend) → non résolu, mais la
  // parcelle du secteur reste proposée en suggestion.
  assert.strictEqual(e.items[0].parcelle, '');
  assert.strictEqual(e.items[0].parcelle_status, 'unmatched');
  assert.deepStrictEqual(e.items[0].parcelle_candidats, ['S9 - REYNA F5']);
});

test('parcelle — « marvilla S-3 » pré-remplit la parcelle mono-secteur', async () => {
  const e = await analyseOneItem({
    article_lu: 'UREE', article: 'UREE 46', article_status: 'exact',
    parcelle_lue: 'marvilla S-3', parcelle: '', parcelle_status: 'unmatched',
    quantite: 5, unite: 'kg',
  });
  assert.strictEqual(e.items[0].parcelle, 'S3 - MARAVILLA MOTTE F1');
  assert.strictEqual(e.items[0].parcelle_status, 'exact');
  // La résolution pose aussi la référence, comme la saisie manuelle.
  assert.strictEqual(e.items[0].parcelle_ref, 'R-S3 - MARAVILLA MOTTE F1');
});

test('parcelle — « marvilla S-5 » ne pré-remplit RIEN (groupe de 5 + variété opposée)', async () => {
  const e = await analyseOneItem({
    article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'marvilla S-5', parcelle: '', quantite: 5,
  });
  assert.strictEqual(e.items[0].parcelle, '');
  assert.strictEqual(e.items[0].parcelle_status, 'unmatched');
  assert.deepStrictEqual(e.items[0].parcelle_candidats.slice().sort(),
    ['S2.S3.S5.S6.S7 maravilla logn can F1', 'S5 -YAZMIN MOW DOWN F1']);
});

test('parcelle — une proposition backend hors select n\'est jamais reprise', async () => {
  const e = await analyseOneItem({
    article_lu: 'UREE', article: 'UREE 46',
    // Le backend proposait ses propres libellés (autre génération) : ignorés.
    parcelle_lue: 'M.T.L S-8', parcelle: 'F1- S5 MARAVILLA MD', parcelle_status: 'exact',
    quantite: 5,
  });
  assert.strictEqual(e.items[0].parcelle, '');
  assert.strictEqual(e.items[0].parcelle_status, 'unmatched');
});

test('parcelle — le signal culture traverse les props (« M.T.L S-13 » → CASCADE)', async () => {
  // La modale doit fournir des options exploitables par CultureUtils (libellé +
  // nom affiché + culture). On rend CultureUtils disponible comme dans le
  // navigateur, où lib/cultureUtils.js est chargée avant lib/bcScanMatch.js.
  const saved = global.window;
  global.window = { CultureUtils: require('./_esm').loadEsm('src/modules/shared/lib/cultureUtils.js') };
  try {
    const props = Object.assign({}, BASE_PROPS, {
      useConsoSelector: true,
      refForCampagne: [
        { label: 'F5- CASCADE -S13', ref: 'R1', culture: '', ferme: 'F5' },
        { label: 'S13 - YAZMIN MOW DOWN F5', ref: 'R2', culture: '', ferme: 'F5' },
      ],
    });
    const e = await analyseOneItem({
      article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'M.T.L S-13', parcelle: '', quantite: 5,
    }, props);
    assert.strictEqual(e.items[0].parcelle, 'F5- CASCADE -S13');
    assert.strictEqual(e.items[0].parcelle_status, 'probable');
    assert.strictEqual(e.items[0].parcelle_ref, 'R1');
  } finally {
    global.window = saved;
  }
});

// ------------------------------------ alias de parcelle mémorisés (lot A)
//
// « M.T.L S-8 » est l'en-tête réel qui coûte 8 lignes de saisie sur les 7 bons de
// référence : la liste porte S8-1, S8-2 et S8-3, jamais un « S8 » simple, donc la
// cascade ne peut structurellement pas trancher. Une fois le magasinier passé, la
// décision doit être rejouée aux scans suivants.

const CAMPAGNE = '2026-2027';
const PROD_PROPS_CAMP = Object.assign({}, PROD_PROPS, { campagne: CAMPAGNE });
const ALIAS_S8 = { 'm.t.l s-8': { parcelle: 'S9 - REYNA F5', count: 3, campagne: CAMPAGNE } };

test('alias parcelle — chargés UNE fois à l\'ouverture, filtrés par campagne', async () => {
  const spy = { fetches: [], sets: [], effects: [] };
  const Modal = load([undefined, [], 0], spy, { parcelleAliasesResponse: { success: true, aliases: ALIAS_S8 } });
  Modal(PROD_PROPS_CAMP);
  spy.effects[1].fn();
  await new Promise((r) => setImmediate(r));
  const call = spy.fetches.find((f) => /list-bc-scan-parcelle-aliases/.test(f.url));
  assert.ok(call, 'les alias sont chargés');
  assert.match(call.url, /campagne=2026-2027/);
  // Une seule requête : jamais un chargement par bon.
  assert.strictEqual(spy.fetches.filter((f) => /list-bc-scan-parcelle-aliases/.test(f.url)).length, 1);
});

test('alias parcelle — sans campagne, aucun chargement (la clé serait incomplète)', () => {
  const spy = { fetches: [], sets: [], effects: [] };
  load([undefined, [], 0], spy)(PROD_PROPS);
  spy.effects[1].fn();
  assert.strictEqual(spy.fetches.some((f) => /list-bc-scan-parcelle-aliases/.test(f.url)), false);
});

test('alias parcelle — un en-tête déjà tranché est pré-rempli en statut `alias`', async () => {
  const e = await analyseOneItem(
    { article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'M.T.L S-8', parcelle: '', quantite: 5 },
    PROD_PROPS_CAMP, null, { parcelleAliasesResponse: { success: true, aliases: ALIAS_S8 } });
  assert.strictEqual(e.items[0].parcelle, 'S9 - REYNA F5');
  assert.strictEqual(e.items[0].parcelle_status, 'alias');
  assert.strictEqual(e.items[0].parcelle_alias_count, 3);
  // La résolution pose aussi la référence, comme une sélection manuelle.
  assert.strictEqual(e.items[0].parcelle_ref, 'R-S9 - REYNA F5');
});

test('alias parcelle — sans alias, le MÊME en-tête reste à saisir', async () => {
  const e = await analyseOneItem(
    { article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'M.T.L S-8', parcelle: '', quantite: 5 },
    PROD_PROPS_CAMP);
  assert.strictEqual(e.items[0].parcelle, '');
  assert.strictEqual(e.items[0].parcelle_status, 'unmatched');
});

// R1 — un alias appris sur une autre campagne imputerait la consommation à une
// parcelle qui n'est plus en culture.
test('alias parcelle — un alias d\'une AUTRE campagne n\'est jamais appliqué', async () => {
  const vieux = { 'm.t.l s-8': { parcelle: 'S9 - REYNA F5', count: 9, campagne: '2025-2026' } };
  const e = await analyseOneItem(
    { article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'M.T.L S-8', parcelle: '', quantite: 5 },
    PROD_PROPS_CAMP, null, { parcelleAliasesResponse: { success: true, aliases: vieux } });
  assert.strictEqual(e.items[0].parcelle, '');
  assert.strictEqual(e.items[0].parcelle_status, 'unmatched');
});

// Règle produit n°1 : aucune valeur non sélectionnable ne doit pouvoir être posée.
test('alias parcelle — un alias hors du select est ignoré, sans bloquer la cascade', async () => {
  const perime = { 'marvilla s-3': { parcelle: 'PARCELLE RETIREE', count: 4, campagne: CAMPAGNE } };
  const e = await analyseOneItem(
    { article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'marvilla S-3', parcelle: '', quantite: 5 },
    PROD_PROPS_CAMP, null, { parcelleAliasesResponse: { success: true, aliases: perime } });
  assert.strictEqual(e.items[0].parcelle, 'S3 - MARAVILLA MOTTE F1');
  assert.strictEqual(e.items[0].parcelle_status, 'exact');
});

test('alias parcelle — chargement en échec : aucune proposition inventée, aucun crash', async () => {
  const e = await analyseOneItem(
    { article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'M.T.L S-8', parcelle: '', quantite: 5 },
    PROD_PROPS_CAMP, null, { parcelleAliasesResponse: { success: false, error: 'Réservé au profil magasinier' } });
  assert.strictEqual(e.status, 'done');
  assert.strictEqual(e.items[0].parcelle, '');
  assert.strictEqual(e.items[0].parcelle_status, 'unmatched');
});

// Un alias vient d'UNE seule sélection du magasinier : même arbitrage que pour
// les articles, ⚠️ orange, jamais ✅ vert.
test('alias parcelle — affiché en orange « mémorisé — à vérifier », jamais en vert', () => {
  const e = entry({ items: [line({ parcelle_status: 'alias', parcelle_alias_count: 2, article_status: 'exact' })] });
  const tree = load([undefined, [e], 0])(BASE_PROPS);
  assert.match(flatText(tree), /mémorisé — à vérifier/);
  const dot = findAll(tree, (n) => n.type === 'span' && /mémorisé/.test(textOf(n)))[0];
  assert.strictEqual(dot.props.style.color, '#e65100');
  assert.match(dot.props.title, /la parcelle est la bonne/);
  assert.match(dot.props.title, /mémorisé 2 fois/);
  // Seul l'article garde sa pastille verte.
  assert.strictEqual(findAll(tree, (n) => n.props.title === 'Reconnu au référentiel').length, 1);
});

test('alias parcelle — l\'info-bulle de l\'ARTICLE reste inchangée', () => {
  const e = entry({ items: [line({ article_status: 'alias', article_alias_count: 5 })] });
  const dot = findAll(load([undefined, [e], 0])(BASE_PROPS), (n) => n.type === 'span' && /mémorisé/.test(textOf(n)))[0];
  assert.match(dot.props.title, /l'article est le bon/);
});

// ---- écriture de l'alias à l'enregistrement du bon ----

/** Enregistre un bon et rend les corps envoyés à save-bc-scan-parcelle-alias. */
async function aliasesEcrits(items, props) {
  const spy = { fetches: [], sets: [], effects: [] };
  const e = entry({ items });
  const Modal = load([undefined, [e], 0], spy, { createBcResponse: { success: true, numero: 'BC-1' } });
  const btn = findAll(Modal(props || Object.assign({}, BASE_PROPS, { campagne: CAMPAGNE })),
    (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  await btn.props.onClick();
  return spy.fetches.filter((f) => /save-bc-scan-parcelle-alias/.test(f.url))
    .map((f) => JSON.parse(f.init.body));
}

test('écriture alias — une parcelle CORRIGÉE est mémorisée, avec sa campagne', async () => {
  const corps = await aliasesEcrits([line({
    parcelle_lue: 'M.T.L S-8', parcelle: 'F5-P02', parcelle_initial: 'F1-P01', parcelle_ref: 'R2',
  })]);
  assert.deepStrictEqual(corps, [{
    entete_lu: 'M.T.L S-8',
    parcelle: 'F5-P02',
    campagne: CAMPAGNE,
    created_by: { profileId: 'magasinier', name: 'Magasinier Test' },
  }]);
});

// Le nom Smart Berry n'est qu'un HABILLAGE d'affichage : la valeur enregistrée
// dans le bon est le libellé BEE ONE, et c'est lui qui doit être mémorisé —
// sinon un renommage côté référentiel invaliderait tous les alias appris.
test('écriture alias — le LIBELLÉ BEE ONE est mémorisé, jamais le nom Smart Berry', async () => {
  const props = Object.assign({}, BASE_PROPS, {
    campagne: CAMPAGNE,
    parcelleNom: (l) => 'Nom SB de ' + l, // ce que voit l'utilisateur dans le select
  });
  const corps = await aliasesEcrits(
    [line({ parcelle_lue: 'M.T.L S-8', parcelle: 'F5-P02', parcelle_initial: '' })], props);
  assert.strictEqual(corps.length, 1);
  assert.strictEqual(corps[0].parcelle, 'F5-P02');
  assert.doesNotMatch(corps[0].parcelle, /Nom SB/);
});

test('écriture alias — une parcelle CHOISIE sur une proposition absente est mémorisée', async () => {
  const corps = await aliasesEcrits([line({ parcelle_lue: 'M.T.L S-8', parcelle: 'F1-P01', parcelle_initial: '' })]);
  assert.strictEqual(corps.length, 1);
  assert.strictEqual(corps[0].parcelle, 'F1-P01');
});

test('écriture alias — une proposition ACCEPTÉE telle quelle n\'écrit rien', async () => {
  const corps = await aliasesEcrits([line({ parcelle_lue: 'marvilla S-3', parcelle: 'F1-P01', parcelle_initial: 'F1-P01' })]);
  assert.deepStrictEqual(corps, []);
});

// R6 — rien à apprendre d'un en-tête illisible, et une clé vide polluerait la
// collection pour toutes les piles sans en-tête.
test('écriture alias — en-tête vide : JAMAIS mémorisé', async () => {
  for (const lue of ['', '   ']) {
    const corps = await aliasesEcrits([line({ parcelle_lue: lue, parcelle: 'F5-P02', parcelle_initial: '' })]);
    assert.deepStrictEqual(corps, [], JSON.stringify(lue));
  }
});

test('écriture alias — sans campagne, aucune écriture (la clé serait incomplète)', async () => {
  const corps = await aliasesEcrits(
    [line({ parcelle_lue: 'M.T.L S-8', parcelle: 'F5-P02', parcelle_initial: '' })],
    BASE_PROPS);
  assert.deepStrictEqual(corps, []);
});

// Un groupe n'est pas un libellé de parcelle : mémorisé, il reviendrait comme
// une valeur absente du select, donc ignorée — autant ne rien écrire.
// Le libellé du groupe est volontairement CELUI d'une parcelle sélectionnable :
// sans le contrôle explicite sur `groupe_id`, l'alias serait écrit et rejouerait
// une parcelle unique là où le magasinier avait choisi un groupe.
test('écriture alias — un GROUPE de parcelles n\'est jamais mémorisé', async () => {
  const corps = await aliasesEcrits([line({
    parcelle_lue: 'M.T.L S-8', parcelle: 'F1-P01', parcelle_initial: '', groupe_id: 'g1',
  })]);
  assert.deepStrictEqual(corps, []);
});

test('écriture alias — une ligne BARRÉE non réintégrée n\'apprend rien', async () => {
  const corps = await aliasesEcrits([
    line({ parcelle_initial: 'F1-P01' }),
    line({ parcelle_lue: 'M.T.L S-8', parcelle: 'F5-P02', parcelle_initial: '', barre: true }),
  ]);
  assert.deepStrictEqual(corps, []);
});

// Cycle COMPLET (analyse -> enregistrement), le seul qui traverse
// `parcelle_initial` telle qu'elle est réellement posée par le rapprochement :
// une proposition de la cascade acceptée sans y toucher ne doit RIEN mémoriser,
// sinon la collection se remplit de « corrections » que personne n'a faites.
test('écriture alias — cycle complet : une proposition acceptée n\'apprend rien', async () => {
  const analysee = await analyseOneItem(
    { article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'marvilla S-3', parcelle: '', quantite: 5 },
    PROD_PROPS_CAMP);
  assert.strictEqual(analysee.items[0].parcelle, 'S3 - MARAVILLA MOTTE F1');
  const spy = { fetches: [], sets: [], effects: [] };
  const pret = Object.assign({}, analysee, { status: 'done' });
  const btn = findAll(load([undefined, [pret], 0], spy, { createBcResponse: { success: true, numero: 'BC-1' } })(PROD_PROPS_CAMP),
    (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  await btn.props.onClick();
  assert.strictEqual(spy.fetches.some((f) => /save-bc-scan-parcelle-alias/.test(f.url)), false);
});

test('écriture alias — cycle complet : une parcelle corrigée après analyse est mémorisée', async () => {
  const analysee = await analyseOneItem(
    { article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'marvilla S-3', parcelle: '', quantite: 5 },
    PROD_PROPS_CAMP);
  // Le magasinier corrige : exactement ce que fait changeParcelle.
  const corrige = Object.assign({}, analysee, {
    status: 'done',
    items: analysee.items.map((it) => Object.assign({}, it, { parcelle: 'S9 - REYNA F5', parcelle_ref: 'R-S9 - REYNA F5' })),
  });
  const spy = { fetches: [], sets: [], effects: [] };
  const btn = findAll(load([undefined, [corrige], 0], spy, { createBcResponse: { success: true, numero: 'BC-1' } })(PROD_PROPS_CAMP),
    (n) => n.type === 'button' && /Enregistrer ce bon/.test(textOf(n)))[0];
  await btn.props.onClick();
  const body = JSON.parse(spy.fetches.find((f) => /save-bc-scan-parcelle-alias/.test(f.url)).init.body);
  assert.strictEqual(body.entete_lu, 'marvilla S-3');
  assert.strictEqual(body.parcelle, 'S9 - REYNA F5');
  assert.strictEqual(body.campagne, CAMPAGNE);
});

test('écriture alias — plusieurs lignes corrigées : un appel par en-tête tranché', async () => {
  const corps = await aliasesEcrits([
    line({ parcelle_lue: 'M.T.L S-8', parcelle: 'F5-P02', parcelle_initial: '' }),
    line({ parcelle_lue: 'M.T.L S-13-14', parcelle: 'F1-P01', parcelle_initial: '' }),
    line({ parcelle_lue: 'marvilla S-3', parcelle: 'F1-P01', parcelle_initial: 'F1-P01' }),
  ]);
  assert.deepStrictEqual(corps.map((c) => c.entete_lu), ['M.T.L S-8', 'M.T.L S-13-14']);
});

// ------------------------------------------- analyse concurrente (plafond 3)

/** Rend la main pendant `n` tours de boucle — simule une latence réseau. */
function afterTicks(n) {
  let p = Promise.resolve();
  for (let i = 0; i < n; i++) p = p.then(() => new Promise((r) => setImmediate(r)));
  return p;
}

function pendingEntry(i) {
  return entry({
    id: 'p' + i, file: { name: 'bon' + i + '.jpg' }, preview: 'blob:' + i,
    status: 'pending', scan_url: '', items: [],
  });
}

const SCAN_ITEM = {
  article_lu: 'UREE', article: 'UREE 46', article_status: 'exact',
  parcelle_lue: '', quantite: 5, unite: 'kg',
};
/** Réponse HTTP de succès (pas de `status` → traitée comme 200, comme fetch). */
function scanOk(idx) {
  return { json: () => Promise.resolve({ success: true, scan_url: 'https://scan/' + idx + '.jpg', analysis: { numero_bon: 'BC-' + idx }, items: [SCAN_ITEM] }) };
}
/** 429 avec en-tête `retry-after` optionnel. */
function scan429(retryAfter) {
  return { status: 429, headers: { get: (h) => (h === 'retry-after' ? (retryAfter || null) : null) } };
}
/** Refus métier du backend : 200 + `{success:false}` → JAMAIS réessayé. */
function scanRefus(message) {
  return { json: () => Promise.resolve({ success: false, error: message }) };
}

/**
 * Joue l'effet d'analyse sur un lot de `n` photos en attente.
 * `handler(idx, attempt)` renvoie la réponse de la photo `idx` à sa `attempt`-ième
 * tentative (ou `{ networkError: 'msg' }` pour faire échouer le fetch lui-même).
 * Mesure le PIC de requêtes scan-bc simultanément en vol.
 */
async function runLot(n, handler, opts) {
  const o = opts || {};
  const spy = { fetches: [], sets: [], effects: [], waits: [], refs: [] };
  const initial = [];
  for (let i = 0; i < n; i++) initial.push(pendingEntry(i));
  const flight = { now: 0, peak: 0 };
  const attempts = {};
  const ticksFor = o.ticksFor || (() => 3);

  const scanHandler = (url, init) => {
    const idx = Number(String(JSON.parse(init.body).filename).replace(/\D/g, ''));
    attempts[idx] = (attempts[idx] || 0) + 1;
    const attempt = attempts[idx];
    flight.now += 1;
    if (flight.now > flight.peak) flight.peak = flight.now;
    // Point d'injection : permet au test d'ajouter des photos EN COURS de lot.
    if (o.onScan) o.onScan(idx, attempt, spy);
    return afterTicks(ticksFor(idx)).then(() => {
      flight.now -= 1;
      const res = handler(idx, attempt);
      if (res && res.networkError) return Promise.reject(new Error(res.networkError));
      return res;
    });
  };

  const Modal = load([undefined, initial, 0], spy, {
    window: { ImageDownscale: { downscaleToDataUrl: () => Promise.resolve('data:image/jpeg;base64,AA') } },
    scanHandler,
  });
  Modal(BASE_PROPS);
  spy.effects[0].fn();
  for (let i = 0; i < 600; i++) await new Promise((r) => setImmediate(r));

  const updaters = spy.sets.filter((s) => typeof s.value === 'function').map((s) => s.value);
  let queue = initial;
  updaters.forEach((u) => { queue = u(queue); });
  return { spy, queue, updaters, initial, peak: flight.peak, attempts, progress: progressOf(spy) };
}

/** Séquence « fait/total » réellement poussée dans l'état de progression. */
function progressOf(spy) {
  return spy.sets.filter((s) => s.index === S.analyse).map((s) => s.value.done + '/' + s.value.total);
}

test('concurrence — 7 photos : jamais plus de 3 analyses en vol, aucune perdue', async () => {
  const r = await runLot(7, (idx) => scanOk(idx));
  assert.strictEqual(r.peak, 3, 'pic de concurrence mesuré');
  assert.strictEqual(r.queue.length, 7);
  assert.ok(r.queue.every((q) => q.status === 'done'), 'toutes les photos analysées');
  // Une seule requête par photo, aucune photo analysée deux fois (le piège
  // d'une file partagée par 3 workers).
  assert.strictEqual(r.spy.fetches.filter((f) => /action=scan-bc/.test(f.url)).length, 7);
  assert.deepStrictEqual(Object.keys(r.attempts).map(Number).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(Object.values(r.attempts).every((a) => a === 1));
});

test('concurrence — l\'ordre d\'affichage reste celui du dépôt, pas des réponses', async () => {
  // Les dernières photos répondent le plus vite : l'ordre d'arrivée est
  // strictement inversé par rapport au dépôt.
  const r = await runLot(6, (idx) => scanOk(idx), { ticksFor: (idx) => 2 + (6 - idx) * 2 });
  assert.deepStrictEqual(r.queue.map((q) => q.file.name),
    ['bon0.jpg', 'bon1.jpg', 'bon2.jpg', 'bon3.jpg', 'bon4.jpg', 'bon5.jpg']);
  // Chaque entrée porte bien SON résultat (pas de croisement).
  assert.deepStrictEqual(r.queue.map((q) => q.scan_url),
    [0, 1, 2, 3, 4, 5].map((i) => 'https://scan/' + i + '.jpg'));
  assert.ok(r.queue.every((q) => q.status === 'done'));
  assert.ok(r.peak <= 3, 'plafond respecté : ' + r.peak);
});

test('429 ponctuel — reprise automatique puis succès, file cohérente', async () => {
  const r = await runLot(3, (idx, attempt) => ((idx === 1 && attempt === 1) ? scan429() : scanOk(idx)));
  assert.strictEqual(r.attempts[1], 2, 'la photo 1 a été rejouée une fois');
  assert.ok(r.queue.every((q) => q.status === 'done'), 'toutes les photos finissent analysées');
  assert.strictEqual(r.queue[1].error, '');
  assert.strictEqual(r.queue[1].scan_url, 'https://scan/1.jpg');
  // Une seule attente de reprise, d'au moins la base de backoff.
  assert.strictEqual(r.spy.waits.length, 1);
  assert.ok(r.spy.waits[0] >= 1000, 'attente ≥ 1 s : ' + r.spy.waits[0]);
});

test('429 persistant — la vignette passe en erreur, le reste du lot aboutit', async () => {
  const r = await runLot(4, (idx) => (idx === 2 ? scan429() : scanOk(idx)));
  assert.strictEqual(r.attempts[2], 3, '3 tentatives au total, pas plus');
  assert.strictEqual(r.queue[2].status, 'error');
  assert.match(r.queue[2].error, /429/);
  // Aucune photo perdue : les 3 autres sont analysées.
  assert.deepStrictEqual(r.queue.map((q) => q.status), ['done', 'done', 'error', 'done']);
  // Attente croissante : le 2e délai double le 1er (jitter borné à 400 ms).
  assert.strictEqual(r.spy.waits.length, 2);
  assert.ok(r.spy.waits[0] >= 1000 && r.spy.waits[0] < 1400, 'backoff 1 : ' + r.spy.waits[0]);
  assert.ok(r.spy.waits[1] >= 2000 && r.spy.waits[1] < 2400, 'backoff 2 : ' + r.spy.waits[1]);
});

test('429 avec `retry-after` — l\'en-tête serveur prime sur le backoff local', async () => {
  const r = await runLot(1, (idx, attempt) => (attempt === 1 ? scan429('7') : scanOk(idx)));
  assert.strictEqual(r.queue[0].status, 'done');
  assert.strictEqual(r.spy.waits.length, 1);
  assert.ok(r.spy.waits[0] >= 7000, 'retry-after: 7 respecté (' + r.spy.waits[0] + ')');
});

test('refus définitif du backend (success:false) — JAMAIS réessayé', async () => {
  const r = await runLot(3, (idx) => (idx === 0 ? scanRefus('Les PDF ne sont pas supportés') : scanOk(idx)));
  assert.strictEqual(r.attempts[0], 1, 'un seul appel : un PDF le restera au 3e essai');
  assert.strictEqual(r.queue[0].status, 'error');
  assert.strictEqual(r.queue[0].error, 'Les PDF ne sont pas supportés');
  assert.strictEqual(r.spy.waits.length, 0, 'aucune attente de reprise');
  assert.deepStrictEqual(r.queue.map((q) => q.status), ['error', 'done', 'done']);
});

test('erreur réseau transitoire — rejouée comme un 429', async () => {
  const r = await runLot(2, (idx, attempt) => ((idx === 0 && attempt === 1) ? { networkError: 'Failed to fetch' } : scanOk(idx)));
  assert.strictEqual(r.attempts[0], 2);
  assert.ok(r.queue.every((q) => q.status === 'done'));
});

// LE piège de la parallélisation (et le défaut historique du flux « Bons
// d'Apport ») : un worker qui termine réécrit une copie figée de la file et
// efface la correction que le magasinier vient de saisir sur un autre bon.
test('édition utilisateur pendant l\'analyse d\'autres photos — jamais écrasée', async () => {
  const r = await runLot(4, (idx) => scanOk(idx), { ticksFor: (idx) => 2 + idx * 4 });
  let queue = r.initial;
  let injected = false;
  r.updaters.forEach((u) => {
    queue = u(queue);
    if (!injected && queue[0].status === 'done' && queue.some((q) => q.status === 'processing')) {
      injected = true;
      // Exactement ce que fait patchItem : setQueue(prev => …) ciblé par id.
      queue = queue.map((q) => (q.id === 'p0'
        ? { ...q, items: q.items.map((it, i) => (i === 0 ? { ...it, quantite: '42', article: 'MAP' } : it)) }
        : q));
    }
  });
  assert.ok(injected, 'une édition a bien été injectée pendant que le lot tournait');
  assert.strictEqual(queue[0].items[0].quantite, '42');
  assert.strictEqual(queue[0].items[0].article, 'MAP');
  // Et les autres photos ont quand même abouti.
  assert.ok(queue.every((q) => q.status === 'done'));
});

// Le compteur est SOUS LES YEUX du magasinier : sa séquence ne doit dépendre
// que du lot, jamais de l'ordonnancement des rendus React. Une version qui
// relit queueRef (miroir resynchronisé au rendu seulement) produit
// « 0/5 → 1/6 → 2/7 → … » : le total dérive à chaque image terminée.
test('progression — séquence exacte sur un lot de 5, total figé', async () => {
  const r = await runLot(5, (idx) => scanOk(idx));
  assert.deepStrictEqual(r.progress, ['0/5', '1/5', '2/5', '3/5', '4/5', '5/5', '0/0']);
});

test('progression — le total reste figé même avec des réponses désordonnées', async () => {
  const r = await runLot(5, (idx) => scanOk(idx), { ticksFor: (idx) => 2 + (5 - idx) * 3 });
  assert.deepStrictEqual(r.progress, ['0/5', '1/5', '2/5', '3/5', '4/5', '5/5', '0/0']);
});

test('progression — une photo en erreur compte quand même dans l\'avancement', async () => {
  const r = await runLot(3, (idx) => (idx === 1 ? scanRefus('PDF non supporté') : scanOk(idx)));
  assert.deepStrictEqual(r.progress, ['0/3', '1/3', '2/3', '3/3', '0/0']);
});

// Des photos ajoutées PENDANT le lot doivent rejoindre le compteur (le total
// monte) au lieu de le faire déborder (done > total) ou d'être ignorées.
test('progression — 2 photos ajoutées pendant un lot de 3 rejoignent le compteur', async () => {
  let injected = false;
  const r = await runLot(3, (idx) => scanOk(idx), {
    onScan: (idx, attempt, spy) => {
      if (injected) return;
      injected = true;
      // Ce que fait un vrai rendu après handleFiles : queueRef (1er useRef du
      // composant) est resynchronisé sur la file, photos ajoutées comprises.
      const queueRef = spy.refs[0];
      queueRef.current = queueRef.current.concat([pendingEntry(3), pendingEntry(4)]);
    },
  });
  assert.ok(injected, 'les photos ont bien été ajoutées en cours de lot');
  // Séquence mesurée : 0/3 → 1/3 → 2/4 → 3/5 → 4/5 → 5/5 → 0/0. On n'épingle
  // pas ce littéral (il dépend de l'entrelacement des workers) mais les
  // INVARIANTS qu'il illustre, vérifiés plus bas.
  // Les 5 photos sont analysées, une fois chacune.
  assert.deepStrictEqual(Object.keys(r.attempts).map(Number).sort((a, b) => a - b), [0, 1, 2, 3, 4]);
  assert.ok(Object.values(r.attempts).every((a) => a === 1));
  // Le total part de 3 puis monte à 5 quand les nouvelles photos sont réservées.
  assert.strictEqual(r.progress[0], '0/3');
  assert.ok(r.progress.some((p) => Number(p.split('/')[1]) > 3),
    'le total monte en cours de lot : ' + r.progress.join(' → '));
  assert.strictEqual(r.progress[r.progress.length - 2], '5/5', 'le lot se termine sur 5/5');
  assert.strictEqual(r.progress[r.progress.length - 1], '0/0', 'remise à zéro en fin de lot');
  const pairs = r.progress.slice(0, -1).map((p) => p.split('/').map(Number));
  // `done` avance de 1 en 1, `total` ne décroît jamais, et `done` ne dépasse
  // JAMAIS `total` (le débordement qu'on veut interdire).
  pairs.forEach(([done, total], i) => {
    assert.strictEqual(done, i, 'done incrémente de 1 : ' + r.progress.join(' → '));
    assert.ok(done <= total, 'done ≤ total : ' + r.progress.join(' → '));
    if (i > 0) assert.ok(total >= pairs[i - 1][1], 'total ne décroît pas : ' + r.progress.join(' → '));
  });
});

test('progression du lot affichée pendant l\'analyse', () => {
  const queue = [entry({ id: 'e1', status: 'processing', items: [] }), entry({ id: 'e2', status: 'pending', items: [] })];
  const tree = load([undefined, queue, 0, true, false, 0, { done: 2, total: 5 }])(BASE_PROPS);
  assert.match(flatText(tree), /Analyse 2\/5/);
  assert.match(flatText(tree), /3 en parallèle/);
});

test('progression — repli sur le libellé générique si le total est inconnu', () => {
  const queue = [entry({ id: 'e1', status: 'processing', items: [] })];
  const tree = load([undefined, queue, 0, true, false, 0, { done: 0, total: 0 }])(BASE_PROPS);
  assert.match(flatText(tree), /Analyse en cours…/);
});

test('le module ne publie rien sur window', () => {
  const sandbox = { window: { React: { createElement, useState: () => [], useEffect: () => {}, useRef: () => ({}) } } };
  const mod = loadComponent('src/modules/magasin/MagBCScanModal.jsx', sandbox);
  assert.deepStrictEqual(Object.keys(mod), ['MagBCScanModal']);
  assert.deepStrictEqual(Object.keys(sandbox.window), ['React']);
});
