'use strict';

/*
 * magBCUniteConversion.test.js — câblage FRONT de la conversion d'unité dans
 * l'écran de saisie d'un bon de consommation.
 *
 * ── CE QUI EST VERROUILLÉ ICI ──────────────────────────────────────────────
 *  1. le sélecteur d'unité n'est PLUS LIBRE : pour un article connu, il ne
 *     propose que l'unité de stock et, si elle existe, l'unité de
 *     consommation. C'est le choix libre qui a produit les 87 lignes déduites
 *     dans la mauvaise unité ;
 *  2. la quantité réellement déduite du stock est MONTRÉE à la saisie
 *     (5 L d'acide nitrique = 6,6 KG) ;
 *  3. une ligne non convertible est SIGNALÉE en nommant l'article et les DEUX
 *     unités — et n'est jamais bloquée (décision d'Omar) ;
 *  4. l'unité envoyée au serveur est celle AFFICHÉE dans le sélecteur ;
 *  5. la fenêtre « Renseigner la conversion » n'envoie que les DEUX champs de
 *     conversion : un champ de plus ferait refuser toute la requête au
 *     magasinier (garde serveur).
 *
 * Même harnais que bcDoublonFrontWiring.test.js : faux `window`, React stubé,
 * JSX babélisé à la volée (pas de DOM, pas de RTL — limitation du repo).
 *
 * Fixtures = les conversions réelles données par Omar.
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

const SRC_TAB = babelise('public/components/MagBCTab.jsx');
const SRC_CONV = babelise('public/components/ArticleConversionFields.jsx');

const CampagneUtils = require('../../public/lib/campagneUtils.js');
const UniteConsoUtils = require('../../public/lib/uniteConsoUtils.js');

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

/** Index des useState de MagBCTab, dans l'ordre de déclaration. */
const S = {
  bcs: 0, loading: 1, showForm: 2, showScan: 3, stocks: 4, catalogueArticles: 5,
  showCreateArticle: 6, newArticle: 7, creatingArt: 8, createArticleLineIdx: 9,
  parcelles: 10, refParcelles: 11, sbRefMap: 12, parcelleGroupes: 13, form: 14,
  scanFileBC: 15, scanPreviewBC: 16, bcCampagne: 17, bcCulture: 18, query: 19,
  filterSource: 20, dateFrom: 21, dateTo: 22, sortField: 23, sortDir: 24,
  detailBc: 25, editDateBc: 26, editDateValue: 27, editDateSaving: 28, editDateError: 29,
  doublonBc: 30, deleteBc: 31, deleteMotif: 32, deleteSaving: 33, deleteError: 34,
  deleteConfirmBc: 35, deleteNumeroSaisi: 36,
  conversionArticle: 37, conversionForm: 38, conversionSaving: 39, conversionError: 40,
};

function load(stateOverrides, spy) {
  const sandbox = {
    window: {
      useStockLocations: () => ({ magasins: ['F1', 'F5'] }),
      cachedFetch: () => new Promise(function () {}),
      CampagneUtils,
      UniteConsoUtils,
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
    String,
    Number,
    isFinite,
    Object,
    Array,
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
  vm.runInContext(SRC_CONV, sandbox);
  vm.runInContext(SRC_TAB, sandbox);
  return { MagBCTab: sandbox.window.MagBCTab, ArticleConversionFields: sandbox.window.ArticleConversionFields };
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
function byText(tree, label) {
  return findAll(tree, (n) => n.children && n.children.some((c) => typeof c === 'string' && c.indexOf(label) >= 0))[0];
}
function newSpy(responses) {
  return { fetches: [], sets: [], effects: [], refs: [], alerts: [], responses: responses || [] };
}

/** Fiches catalogue RÉELLES (conversions données par Omar). */
const CATALOGUE = [
  { id: 'a1', nom: 'Acide Nitrique', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.32 },
  { id: 'a2', nom: 'Acide Sulfurique', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.75 },
  { id: 'a3', nom: 'UREE 46', unite: 'KG' },
  { id: 'a4', nom: 'M-K-P', unite: 'L' },
];

function ligne(over) {
  return Object.assign({ article: '', quantite: '', unite: 'kg', parcelle: 'F1-P01', parcelle_ref: 'R1', culture: 'Framboise', ferme: 'F1', groupe_id: '' }, over || {});
}
function formAvec(items) {
  return { date: '2026-08-29', lieu_source_type: 'magasin', lieu_source_id: 'F1', items };
}

function render(profile, extraStates, spy) {
  const states = Object.assign(
    { [S.loading]: false, [S.bcs]: [], [S.catalogueArticles]: CATALOGUE },
    extraStates || {}
  );
  const { MagBCTab } = load(states, spy);
  return MagBCTab({ type: 'engrais', currentProfile: profile, profileData: { name: 'Test' } });
}

/** Les <select> d'unité, repérés par leur classe dédiée. */
function selectsUnite(tree) {
  return findAll(tree, (n) => n.type === 'select' && n.props.className === 'bc-unite-select');
}
function optionsDe(select) { return select.children.map((o) => o.props.value); }

// ── 1. LE SÉLECTEUR D'UNITÉ N'EST PLUS LIBRE ───────────────────────────────

test('article avec conversion — le sélecteur propose l\'unité de stock ET celle de consommation, rien d\'autre', () => {
  const tree = render('magasinier', {
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'Acide Nitrique', quantite: '5', unite: 'L' })]),
  }, newSpy());
  const sel = selectsUnite(tree)[0];
  assert.ok(sel, 'sélecteur d\'unité présent');
  assert.deepEqual(optionsDe(sel), ['KG', 'L']);
  // Les unités « libres » d'avant ne doivent plus apparaître.
  for (const interdite of ['carton', 'sac', 'bidon', 'unité']) {
    assert.equal(optionsDe(sel).indexOf(interdite), -1, interdite + ' ne doit plus être proposé');
  }
});

test('article SANS unité de consommation — une seule unité proposée', () => {
  const tree = render('magasinier', {
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'UREE 46', quantite: '10', unite: 'kg' })]),
  }, newSpy());
  assert.deepEqual(optionsDe(selectsUnite(tree)[0]), ['KG']);
});

test('article INCONNU du catalogue — la liste générique reste, sinon la ligne devient insaisissable', () => {
  const tree = render('magasinier', {
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'GENAKTIS', quantite: '3', unite: 'L' })]),
  }, newSpy());
  const opts = optionsDe(selectsUnite(tree)[0]);
  assert.ok(opts.length > 2, 'on ne sait rien de cet article : on ne restreint pas');
  assert.ok(opts.indexOf('L') >= 0);
});

// ── 2. CE QUI SERA DÉDUIT EST MONTRÉ ───────────────────────────────────────

test('5 L d\'Acide Nitrique — l\'écran annonce 6.6 KG déduits du stock', () => {
  const tree = render('magasinier', {
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'Acide Nitrique', quantite: '5', unite: 'L' })]),
  }, newSpy());
  const txt = flatText(tree);
  assert.match(txt, /6\.6 KG déduits du stock/);
  // Le facteur inversé donnerait 3,79 : il ne doit apparaître nulle part.
  assert.doesNotMatch(txt, /3\.78|3\.79/);
});

test('unités identiques — aucun équivalent affiché (rien n\'est converti)', () => {
  const tree = render('magasinier', {
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'UREE 46', quantite: '10', unite: 'kg' })]),
  }, newSpy());
  assert.doesNotMatch(flatText(tree), /déduits du stock/);
});

// ── 3. LE FILET : SIGNALER, PAS BLOQUER ────────────────────────────────────

test('ligne non convertible — signalée en NOMMANT l\'article et les deux unités', () => {
  const tree = render('magasinier', {
    [S.showForm]: true,
    // M-K-P : stock en L, saisi en kg, aucune conversion sur la fiche (cas réel,
    // 5 lignes en production).
    [S.form]: formAvec([ligne({ article: 'M-K-P', quantite: '5', unite: 'kg' })]),
  }, newSpy());
  const txt = flatText(tree);
  assert.match(txt, /Saisi en kg, stock tenu en L/);
  assert.match(txt, /déduite telle quelle/);
  // Le bouton de création reste actif : on ne bloque pas.
  assert.ok(byText(tree, 'Creer le bon'));
});

test('unité de consommation déclarée mais facteur MANQUANT — le cas que le filet doit attraper', () => {
  // C'est le chemin réel : la fiche dit « on dose en L », personne n'a encore
  // donné la densité. Le sélecteur propose donc bien les deux unités, et la
  // ligne saisie en L est signalée au lieu d'être convertie au petit bonheur.
  const spy = newSpy();
  const { MagBCTab } = load({
    [S.loading]: false, [S.bcs]: [],
    [S.catalogueArticles]: [{ id: 'a9', nom: 'PRIORITOP', unite: 'KG', unite_consommation: 'L' }],
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'PRIORITOP', quantite: '5', unite: 'L' })]),
  }, spy);
  const tree = MagBCTab({ type: 'engrais', currentProfile: 'magasinier', profileData: { name: 'Test' } });
  assert.deepEqual(optionsDe(selectsUnite(tree)[0]), ['KG', 'L']);
  const txt = flatText(tree);
  assert.match(txt, /Saisi en L, stock tenu en KG/);
  assert.doesNotMatch(txt, /déduits du stock/, 'aucune conversion ne doit être annoncée sans facteur');
  assert.ok(byText(tree, 'Renseigner la conversion'));
});

test('ligne non convertible — le magasinier peut renseigner la conversion sur-le-champ', async () => {
  const spy = newSpy();
  const tree = render('magasinier', {
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'M-K-P', quantite: '5', unite: 'kg' })]),
  }, spy);
  const btn = byText(tree, 'Renseigner la conversion');
  assert.ok(btn, 'bouton présent pour le magasinier');
  await btn.props.onClick();
  const set = spy.sets.filter((s) => s.index === S.conversionArticle).pop();
  assert.ok(set && set.value, 'la fenêtre de conversion s\'ouvre');
  assert.equal(set.value.nom, 'M-K-P');
  assert.equal(set.value.unite_stock, 'L');
  assert.deepEqual(set.value.ids, ['a4']);
});

test('un rôle sans droit d\'écriture catalogue ne voit pas le bouton (le serveur rendrait 403)', () => {
  for (const profil of ['chef_f1', 'finance', 'rh']) {
    const tree = render(profil, {
      [S.showForm]: true,
      [S.form]: formAvec([ligne({ article: 'M-K-P', quantite: '5', unite: 'kg' })]),
    }, newSpy());
    assert.equal(byText(tree, 'Renseigner la conversion'), undefined, profil);
    // …mais le SIGNALEMENT, lui, reste visible pour tout le monde.
    assert.match(flatText(tree), /stock tenu en L/, profil);
  }
});

test('création réussie — les lignes non converties du serveur sont dites au magasinier', async () => {
  const spy = newSpy([{
    success: true, numero: 'BC-0100',
    lignes_non_convertibles: [{ article: 'M-K-P', quantite: 5, unite_saisie: 'kg', unite_stock: 'L', motif: 'facteur_absent' }],
  }]);
  const tree = render('magasinier', {
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'M-K-P', quantite: '5', unite: 'kg' })]),
  }, spy);
  await byText(tree, 'Creer le bon').props.onClick();
  const msg = spy.alerts.join(' ');
  assert.match(msg, /BC-0100/);
  assert.match(msg, /M-K-P/);
  assert.match(msg, /kg/);
  assert.match(msg, /stock tenu en L/);
});

// ── 4. CE QUI EST ENVOYÉ = CE QUI EST AFFICHÉ ──────────────────────────────

test('l\'unité envoyée est celle du sélecteur, même si le brouillon dit « l » minuscule', async () => {
  const spy = newSpy([{ success: true, numero: 'BC-0101' }]);
  const tree = render('magasinier', {
    [S.showForm]: true,
    // Brouillon restauré avec une casse d'unité différente de la fiche.
    [S.form]: formAvec([ligne({ article: 'Acide Nitrique', quantite: '5', unite: 'l' })]),
  }, spy);
  // L'écran, lui, affiche l'unité de la fiche…
  assert.equal(selectsUnite(tree)[0].props.value, 'L');
  await byText(tree, 'Creer le bon').props.onClick();
  const post = spy.fetches.find((f) => /action=create-bc/.test(f.url));
  const body = JSON.parse(post.init.body);
  assert.equal(body.items[0].unite, 'L', 'l\'écran et l\'envoi doivent dire la même chose');
  assert.equal(body.items[0].quantite, '5', 'la quantité SAISIE est envoyée : la conversion est faite serveur');
});

// ── 5. LA FENÊTRE DE CONVERSION N'ÉCRIT QUE DEUX CHAMPS ────────────────────

const CONV_OUVERTE = { nom: 'M-K-P', unite_stock: 'L', ids: ['a4'] };

test('enregistrer une conversion — POST update-article avec EXACTEMENT les deux champs', async () => {
  const spy = newSpy([{ success: true }, { success: true, articles: CATALOGUE }]);
  const tree = render('magasinier', {
    [S.conversionArticle]: CONV_OUVERTE,
    [S.conversionForm]: { unite_consommation: 'KG', stock_par_unite_consommation: '0,8' },
  }, spy);
  const btn = byText(tree, 'Enregistrer la conversion');
  assert.ok(btn);
  await btn.props.onClick();

  const post = spy.fetches.find((f) => /action=update-article/.test(f.url));
  assert.ok(post, 'appel update-article émis');
  const body = JSON.parse(post.init.body);
  assert.equal(body.id, 'a4');
  assert.deepEqual(Object.keys(body.updates).sort(), ['stock_par_unite_consommation', 'unite_consommation']);
  // La virgule décimale est lue comme un nombre, pas envoyée comme chaîne.
  assert.equal(body.updates.stock_par_unite_consommation, 0.8);
  assert.equal(body.updates.unite_consommation, 'KG');
});

test('unité de consommation sans facteur — refusée AVANT l\'envoi, rien n\'est écrit', async () => {
  const spy = newSpy([{ success: true }]);
  const tree = render('magasinier', {
    [S.conversionArticle]: CONV_OUVERTE,
    [S.conversionForm]: { unite_consommation: 'KG', stock_par_unite_consommation: '' },
  }, spy);
  await byText(tree, 'Enregistrer la conversion').props.onClick();
  assert.equal(spy.fetches.some((f) => /action=update-article/.test(f.url)), false, 'aucune écriture');
  const err = spy.sets.filter((s) => s.index === S.conversionError).pop();
  assert.ok(err && /1 KG en L/.test(err.value), 'le refus explique le sens attendu du nombre');
});

test('un facteur nul ou négatif est refusé comme un facteur absent', async () => {
  for (const f of ['0', '-1', 'abc']) {
    const spy = newSpy([{ success: true }]);
    const tree = render('magasinier', {
      [S.conversionArticle]: CONV_OUVERTE,
      [S.conversionForm]: { unite_consommation: 'KG', stock_par_unite_consommation: f },
    }, spy);
    await byText(tree, 'Enregistrer la conversion').props.onClick();
    assert.equal(spy.fetches.some((x) => /action=update-article/.test(x.url)), false, 'facteur ' + f);
  }
});

test('refus serveur — message affiché TEL QUEL, la fenêtre reste ouverte', async () => {
  const spy = newSpy([{ success: false, error: 'Le magasinier ne peut renseigner que l\'unité de consommation et sa conversion' }]);
  const tree = render('magasinier', {
    [S.conversionArticle]: CONV_OUVERTE,
    [S.conversionForm]: { unite_consommation: 'KG', stock_par_unite_consommation: '0,8' },
  }, spy);
  await byText(tree, 'Enregistrer la conversion').props.onClick();
  const err = spy.sets.filter((s) => s.index === S.conversionError).pop();
  assert.ok(err);
  assert.match(err.value, /ne peut renseigner que/);
  assert.equal(spy.sets.some((s) => s.index === S.conversionArticle && s.value === null), false, 'la fenêtre ne se ferme pas sur un refus');
});

// ── 6. LA PHRASE, SEULE FORMULATION NON AMBIGUË DU FACTEUR ─────────────────

test('le formulaire de conversion affiche la phrase « 1 <conso> = X <stock> »', () => {
  const tree = render('magasinier', {
    [S.conversionArticle]: { nom: 'Acide Nitrique', unite_stock: 'KG', ids: ['a1'] },
    [S.conversionForm]: { unite_consommation: 'L', stock_par_unite_consommation: '1,32' },
  }, newSpy());
  const txt = flatText(tree);
  assert.match(txt, /1 L =/, 'le sens du facteur doit être écrit, pas déduit');
  assert.match(txt, /KG/);
  // Vérification chiffrée montrée à l'utilisateur : 5 L → 6.6 KG.
  assert.match(txt, /Consommer 5 L déduira 6\.6 KG/);
});

test('sans unité de consommation, aucun champ de facteur n\'est proposé', () => {
  const tree = render('magasinier', {
    [S.conversionArticle]: { nom: 'UREE 46', unite_stock: 'KG', ids: ['a3'] },
    [S.conversionForm]: { unite_consommation: '', stock_par_unite_consommation: '' },
  }, newSpy());
  assert.doesNotMatch(flatText(tree), /1 {2}=/);
});

// ── 7. FICHES JUMELLES : L'ÉCRAN DOIT VOIR CE QUE LE SERVEUR VOIT ─────────

/**
 * Le cas réel : deux fiches au nom STRICTEMENT IDENTIQUE, en désaccord sur la
 * conversion. La casse identique n'est pas un détail de fixture — c'est la
 * forme exacte des ~105 paires du catalogue (le docId est calculé sur la
 * catégorie BRUTE, deux casses de catégorie fabriquent deux fiches sous le
 * MÊME nom). Et c'est la seule forme que le dédoublonnage historique
 * (`seen.has(a.nom)`, égalité stricte) faisait disparaître de l'écran : avec
 * deux orthographes différentes, le bug ne se reproduit pas.
 */
const JUMELLES = [
  { id: 'j1', nom: 'Acide Chlorhydrique', categorie: 'Engrais', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.18 },
  { id: 'j2', nom: 'Acide Chlorhydrique', categorie: 'engrais', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.4 },
];

test('jumelles en désaccord — l\'écran n\'annonce AUCUNE conversion (comme le serveur)', () => {
  // RÉGRESSION MESURÉE : la liste d'articles était dédoublonnée par nom AVANT
  // d'être indexée. Le front ne voyait qu'une fiche, affichait « = 11.8 KG
  // déduits », pendant que le serveur — qui lit toutes les fiches actives —
  // détectait l'ambiguïté et retirait 10 L d'un stock tenu en kilos.
  const { MagBCTab } = load({
    [S.loading]: false, [S.bcs]: [],
    [S.catalogueArticles]: JUMELLES,
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'Acide Chlorhydrique', quantite: '10', unite: 'L' })]),
  }, newSpy());
  const tree = MagBCTab({ type: 'engrais', currentProfile: 'magasinier', profileData: { name: 'Test' } });
  const txt = flatText(tree);
  assert.doesNotMatch(txt, /déduits du stock/, 'aucune conversion ne doit être promise sur un article ambigu');
  assert.doesNotMatch(txt, /11\.8/);
  // …et le magasinier apprend POURQUOI : des jumelles, pas un article absent.
  assert.match(txt, /Plusieurs fiches .+ en désaccord sur la conversion/);
  assert.doesNotMatch(txt, /absent du catalogue/);
});

test('réparer une conversion vise TOUTES les fiches du nom, pas seulement la première', async () => {
  // Ne corriger qu'une jumelle laisse le désaccord — donc l'article ambigu,
  // donc toujours pas converti : l'écran de réparation ne réparerait rien.
  const spy = newSpy();
  const { MagBCTab } = load({
    [S.loading]: false, [S.bcs]: [],
    [S.catalogueArticles]: JUMELLES,
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: 'Acide Chlorhydrique', quantite: '10', unite: 'L' })]),
  }, spy);
  const tree = MagBCTab({ type: 'engrais', currentProfile: 'magasinier', profileData: { name: 'Test' } });
  await byText(tree, 'Renseigner la conversion').props.onClick();
  const set = spy.sets.filter((s) => s.index === S.conversionArticle).pop();
  assert.ok(set && set.value);
  assert.deepEqual(set.value.ids, ['j1', 'j2'], 'les DEUX fiches doivent être corrigées');
});

test('l\'enregistrement écrit la même conversion sur chaque fiche jumelle', async () => {
  const spy = newSpy([{ success: true }, { success: true }, { success: true, articles: JUMELLES }]);
  const tree = render('magasinier', {
    [S.catalogueArticles]: JUMELLES,
    [S.conversionArticle]: { nom: 'Acide Chlorhydrique', unite_stock: 'KG', ids: ['j1', 'j2'] },
    [S.conversionForm]: { unite_consommation: 'L', stock_par_unite_consommation: '1,18' },
  }, spy);
  await byText(tree, 'Enregistrer la conversion').props.onClick();
  const posts = spy.fetches.filter((f) => /action=update-article/.test(f.url));
  assert.equal(posts.length, 2, 'une écriture par fiche jumelle');
  assert.deepEqual(posts.map((p) => JSON.parse(p.init.body).id), ['j1', 'j2']);
  for (const p of posts) {
    assert.equal(JSON.parse(p.init.body).updates.stock_par_unite_consommation, 1.18);
  }
});

/**
 * Bloc englobant d'une position dans le source : on remonte `niveaux`
 * accolades ouvrantes depuis `idx`, puis on redescend jusqu'à la fermante
 * correspondante. Trois niveaux suffisent à couvrir, sur les trois sites
 * visés, tout le `useEffect(...)` ou tout le corps de la fonction `async` qui
 * pose la liste — donc tout endroit où un dédoublonnage pourrait être glissé
 * entre la réponse HTTP et l'appel au setter.
 */
function blocAutour(src, idx, niveaux) {
  let debut = idx;
  for (let n = 0; n < (niveaux || 3); n++) {
    let profondeur = 0;
    let i = debut - 1;
    for (; i >= 0; i--) {
      if (src[i] === '}') profondeur++;
      else if (src[i] === '{') {
        if (profondeur === 0) break;
        profondeur--;
      }
    }
    assert.ok(i >= 0, 'accolade englobante introuvable (niveau ' + n + ')');
    debut = i;
  }
  let profondeur = 0;
  let fin = debut;
  for (; fin < src.length; fin++) {
    if (src[fin] === '{') profondeur++;
    else if (src[fin] === '}') { profondeur--; if (profondeur === 0) break; }
  }
  return src.slice(debut, fin + 1);
}

test('LA SOURCE de la liste : les trois chargements posent la liste COMPLÈTE', () => {
  //
  // ── ASSERTION DE SOURCE, ET POURQUOI ELLE EXISTE ──────────────────────────
  // Tous les autres tests de ce fichier injectent `catalogueArticles` DIRECTEMENT
  // dans l'état (spy de hooks) : ils vérifient les CONSOMMATEURS de la liste,
  // jamais sa SOURCE. Remettre le dédoublonnage par nom là où la liste est
  // CHARGÉE — c'est-à-dire, au caractère près, le défaut mesuré (« = 6,6 KG
  // déduits » à l'écran, 5 L retirés d'un stock en kilos côté serveur) — leur
  // reste donc parfaitement invisible : ils repartiraient tous au vert.
  //
  // Le mécanisme qui fabrique les jumelles est intact (le docId du catalogue se
  // calcule sur la catégorie BRUTE : « Engrais » et « engrais » créent deux
  // fiches sous le même nom). Le prochain import à casse différente en recrée
  // une ; sans ce test, le bug revient sans que rien ne bronche.
  //
  // ⚠️ CE QU'ELLE NE PROUVE PAS : c'est une lecture de TEXTE, pas un
  // comportement. Elle ne dit rien d'un dédoublonnage écrit autrement
  // (`filter((a,i,t)=>t.findIndex(…)===i`, un `Map` par nom, un helper importé),
  // ni d'un filtrage fait côté serveur. Elle ferme la porte au retour du code
  // EXACT qui a produit le défaut, pas à toutes les façons de le réintroduire.
  //
  // Le contrôle est BORNÉ AU BLOC de chaque chargement, jamais au fichier
  // entier : le dédoublonnage d'affichage (`catalogueArticlesAffichage`) est
  // légitime et doit pouvoir évoluer sans faire rougir ce test.
  const src = fs.readFileSync(path.join(ROOT, 'public/components/MagBCTab.jsx'), 'utf8');
  const sites = [];
  for (let i = src.indexOf('setCatalogueArticles('); i !== -1; i = src.indexOf('setCatalogueArticles(', i + 1)) sites.push(i);
  // Trois chargements : initial, après création d'article, après enregistrement
  // d'une conversion. Un quatrième apparaîtrait ici sans être couvert.
  assert.equal(sites.length, 3, 'nombre de chargements de la liste inattendu — couvrir le nouveau');

  for (const idx of sites) {
    const bloc = blocAutour(src, idx, 3);
    assert.doesNotMatch(
      bloc,
      /seen\.has\(a\.nom\)/,
      'la liste chargée ne doit PAS être dédoublonnée par nom : le front redeviendrait '
        + 'aveugle aux fiches jumelles, et annoncerait une conversion que le serveur n\'applique pas.'
    );
    // …et ce qui est posé est bien la réponse BRUTE du serveur, pas une
    // variante filtrée en amont.
    assert.match(
      bloc,
      /setCatalogueArticles\((?:j|listJ)\.articles\s*\|\|\s*\[\]\)/,
      'la liste posée doit être la réponse complète de list-articles'
    );
  }
});

test('la liste de suggestions, elle, reste dédoublonnée (affichage seulement)', () => {
  const { MagBCTab } = load({
    [S.loading]: false, [S.bcs]: [],
    [S.catalogueArticles]: JUMELLES.concat([{ id: 'j3', nom: 'UREE 46', unite: 'KG' }]),
    [S.showForm]: true,
    [S.form]: formAvec([ligne({ article: '', quantite: '', unite: 'kg' })]),
  }, newSpy());
  const tree = MagBCTab({ type: 'engrais', currentProfile: 'magasinier', profileData: { name: 'Test' } });
  const datalist = findAll(tree, (n) => n.type === 'datalist')[0];
  assert.ok(datalist);
  const noms = datalist.children.map((o) => o.props.value);
  // Les deux jumelles portent le MÊME nom : une seule doit être proposée,
  // sinon le magasinier choisit entre deux lignes rigoureusement identiques.
  assert.deepEqual(noms, ['Acide Chlorhydrique', 'UREE 46']);
});

// ── 8. LA FICHE ARTICLE (Stock › Articles, dans le monolithe) ──────────────

test('la fiche article édite les deux champs, via le MÊME composant partagé', () => {
  // app.jsx n'est pas rendable ici (monolithe de 53 k lignes) : on confronte le
  // source à ses invariants. Sans ces trois points, achats/dg n'ont aucun moyen
  // de saisir la conversion, et le magasinier reste seul à pouvoir la donner.
  const src = fs.readFileSync(path.join(ROOT, 'public/app.jsx'), 'utf8');
  assert.match(src, /<window\.ArticleConversionFields/, 'formulaire de fiche article non câblé');
  assert.match(src, /uniteConsommation=\{form\.unite_consommation\}/);
  assert.match(src, /facteur=\{form\.stock_par_unite_consommation\}/);
  // La fiche ouverte doit CHARGER les valeurs existantes, sinon rouvrir une
  // fiche déjà renseignée l'effacerait au premier enregistrement.
  assert.match(src, /unite_consommation:a\.unite_consommation\|\|''/);
  assert.match(src, /stock_par_unite_consommation:\(a\.stock_par_unite_consommation===null\|\|a\.stock_par_unite_consommation===undefined\)\?''/);
});

test('les scripts sont chargés par index.html, et le lib AVANT ses consommateurs', () => {
  // Un composant construit et déployé mais jamais chargé répond 200 et reste
  // muet : `window.X` est undefined, sans la moindre erreur (cas réel du
  // 2026-08-26 sur CaisseDetailPopup).
  const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const iLib = html.indexOf('lib/uniteConsoUtils.js');
  const iComp = html.indexOf('components/ArticleConversionFields.js');
  const iTab = html.indexOf('components/MagBCTab.js');
  assert.ok(iLib > -1, 'lib/uniteConsoUtils.js absent d\'index.html');
  assert.ok(iComp > -1, 'components/ArticleConversionFields.js absent d\'index.html');
  assert.ok(iLib < iComp && iLib < iTab, 'le lib doit être chargé avant ses consommateurs');
});
