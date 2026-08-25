'use strict';

// Tests de RENDU de la modale « Scanner des Bons de Consommation »
// (public/components/MagBCScanModal.jsx).
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
const SRC = babel.transformSync(
  fs.readFileSync(path.join(ROOT, 'public/components/MagBCScanModal.jsx'), 'utf8'),
  { presets: [require.resolve('@babel/preset-react')], filename: 'MagBCScanModal.jsx', babelrc: false, configFile: false }
).code;

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
const S = { lotLieu: 0, queue: 1, currentIdx: 2, processing: 3, saving: 4, createdCount: 5 };

function load(stateOverrides, spy, opts) {
  const o = opts || {};
  const sandbox = {
    window: {},
    // `fetch` espionné : sans réponse déclarée il reste pendant (aucun effet de
    // bord dans les tests de rendu pur).
    fetch: function (url, init) {
      if (spy) spy.fetches.push({ url, init });
      if (/action=create-bc/.test(url) && o.createBcResponse) {
        return Promise.resolve({ json: () => Promise.resolve(o.createBcResponse) });
      }
      if (/action=scan-bc/.test(url) && o.scanResponse) {
        return Promise.resolve({ json: () => Promise.resolve(o.scanResponse) });
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
    useRef: function (initial) { return { current: initial }; },
  };
  vm.createContext(sandbox);
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
async function analyseOneItem(rawItem, props, extraWindow) {
  const spy = { fetches: [], sets: [], effects: [] };
  const pending = entry({ status: 'pending', items: [] });
  const win = Object.assign({
    BcScanMatch: require('../../public/lib/bcScanMatch.js'),
    ImageDownscale: { downscaleToDataUrl: () => Promise.resolve('data:image/jpeg;base64,AA') },
  }, extraWindow || {});
  const Modal = load([undefined, [pending], 0], spy, {
    window: win,
    scanResponse: { success: true, scan_url: 'https://scan/1.jpg', analysis: { numero_bon: 'BC-9' }, items: [rawItem] },
  });
  Modal(props || PROD_PROPS);
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
  global.window = { CultureUtils: require('../../public/lib/cultureUtils.js') };
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

test('parcelle — window.BcScanMatch absent : aucune proposition, aucun crash', async () => {
  const e = await analyseOneItem({
    article_lu: 'UREE', article: 'UREE 46', parcelle_lue: 'marvilla S-3', parcelle: '', quantite: 5,
  }, PROD_PROPS, { BcScanMatch: undefined });
  assert.strictEqual(e.status, 'done');
  assert.strictEqual(e.items[0].parcelle, '');
  assert.strictEqual(e.items[0].parcelle_status, 'unmatched');
  // (length, pas deepStrictEqual : le tableau vide naît dans le realm du vm.)
  assert.strictEqual(e.items[0].parcelle_candidats.length, 0);
});

test('un seul global exposé par le fichier', () => {
  const sandbox = { window: { React: { createElement, useState: () => [], useEffect: () => {}, useRef: () => ({}) } } };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  assert.deepStrictEqual(Object.keys(sandbox.window).filter((k) => k !== 'React'), ['MagBCScanModal']);
});
