'use strict';

/*
 * bcDoublonFrontWiring.test.js — câblage FRONT de la garde anti-doublon et de
 * la suppression d'un bon de consommation.
 *
 * ── CE QUI EST VERROUILLÉ ICI ──────────────────────────────────────────────
 *  1. un 409 de `create-bc` ouvre la fenêtre de doublon (pas un `alert` brut),
 *     et cette fenêtre NOMME le bon existant ;
 *  2. le bouton de forçage envoie réellement `force_doublon` — et ce drapeau
 *     n'est PAS envoyé sur une création normale, sinon la garde serveur ne
 *     bloquerait plus jamais rien ;
 *  3. le forçage est DÉLIBÉRÉ : il n'est ni le bouton d'accent, ni celui qui
 *     reçoit l'autofocus, et son libellé dit ce qu'il fait ;
 *  4. le bouton de suppression n'existe que pour `achats` et `dg` ;
 *  5. le motif de suppression est exigé AVANT l'envoi (bouton désactivé), et la
 *     fenêtre annonce que les quantités reviennent en stock.
 *
 * Même harnais que magBCTabEditDate.test.js : faux `window`, React stubé, JSX
 * babélisé à la volée (pas de DOM, pas de RTL — limitation documentée du repo).
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
const SRC_DIALOG = babelise('public/components/BCDoublonDialog.jsx');

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
  // La fenêtre de doublon est un composant PARTAGÉ, chargé en <script> séparé :
  // on le charge dans le même sandbox, exactement comme le navigateur.
  vm.runInContext(SRC_DIALOG, sandbox);
  vm.runInContext(SRC_TAB, sandbox);
  return { MagBCTab: sandbox.window.MagBCTab, BCDoublonDialog: sandbox.window.BCDoublonDialog };
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

const BCS = [
  { id: 'bc1', numero: 'BC-0001', date: '2026-08-20', items: [{ article: 'UREE 46', quantite: 10, unite: 'kg', parcelle: 'F1-P01' }], created_by: { name: 'Ali' } },
  { id: 'mov_9', numero: 'BCS-0009', date: '2026-08-19', items: [{ article: 'MAP', quantite: 5, unite: 'kg', parcelle: 'F5-P02' }], created_by: {} },
  { id: 'bc3', numero: 'IMP-0003', date: '2026-08-18', items: [{ article: 'MAP', quantite: 2, unite: 'kg', parcelle: 'F5-P02' }], created_by: { userId: 'import_caneva' } },
];

const FORM = {
  date: '2026-08-25', lieu_source_type: 'magasin', lieu_source_id: 'F1',
  items: [{ article: 'UREE 46', quantite: '10', unite: 'kg', parcelle: 'F1-P01', parcelle_ref: 'R1', culture: 'Framboise', ferme: 'F1', groupe_id: '' }],
};

function render(profile, extraStates, spy) {
  const states = Object.assign({ [S.loading]: false, [S.bcs]: BCS }, extraStates || {});
  const { MagBCTab } = load(states, spy);
  return MagBCTab({ type: 'engrais', currentProfile: profile, profileData: { name: 'Test' } });
}

const DOUBLON_SCAN = {
  motif: 'scan_identique', bon_id: 'id32', bon_numero: 'BC-2026-0032',
  message: 'Doublon : ce scan a déjà servi à créer le bon BC-2026-0032. Vérifiez ce bon avant de créer celui-ci.',
  items: FORM.items, scan_url: 'https://s/a.jpg',
};

// ── 1. LE REFUS EST LISIBLE ────────────────────────────────────────────────

test('409 — la fenêtre NOMME le bon existant par elle-même, sans dépendre du message serveur', () => {
  // Doublon SANS `message` : si le numéro n'apparaît que parce que le texte
  // serveur le contient, la fenêtre ne nomme rien par elle-même — un serveur
  // plus laconique laisserait le magasinier deviner.
  const sansMessage = { motif: 'scan_identique', bon_id: 'id32', bon_numero: 'BC-2026-0032' };
  const tree = render('magasinier', { [S.doublonBc]: sansMessage }, newSpy());
  assert.match(flatText(tree), /BC-2026-0032/, 'le numéro doit venir de la fenêtre elle-même');
});

test('409 — la fenêtre de doublon s\'ouvre et NOMME le bon existant', () => {
  const tree = render('magasinier', { [S.doublonBc]: DOUBLON_SCAN }, newSpy());
  const txt = flatText(tree);
  assert.match(txt, /BC-2026-0032/, 'le numéro du bon existant doit être affiché');
  assert.match(txt, /déjà été enregistré/);
  // Le motif est expliqué en clair, pas laissé au code serveur brut.
  assert.match(txt, /même photo/i);
  assert.doesNotMatch(txt, /scan_identique/, 'le code serveur brut ne doit pas fuiter à l\'écran');
});

test('409 — le motif « contenu » a sa propre explication', () => {
  const tree = render('magasinier', {
    [S.doublonBc]: { motif: 'contenu_identique', bon_numero: 'BC-2026-0039', message: 'Doublon probable : le bon BC-2026-0039 …' },
  }, newSpy());
  const txt = flatText(tree);
  assert.match(txt, /BC-2026-0039/);
  assert.match(txt, /mêmes articles/i);
  assert.doesNotMatch(txt, /même photo/i);
});

test('409 — un refus SANS doublon reste un message d\'erreur classique', async () => {
  const spy = newSpy([{ success: false, error: 'Parcelle requise pour chaque article' }]);
  const tree = render('magasinier', { [S.showForm]: true, [S.form]: FORM }, spy);
  const creer = byText(tree, 'Creer le bon');
  assert.ok(creer, 'bouton de création présent');
  await creer.props.onClick();
  assert.ok(spy.alerts.some((a) => /Parcelle requise/.test(a)), 'erreur non-doublon affichée telle quelle');
  assert.equal(spy.sets.some((s) => s.index === S.doublonBc && s.value), false, 'aucune fenêtre de doublon');
});

test('409 doublon — la fenêtre est ouverte au lieu d\'un alert brut', async () => {
  const spy = newSpy([{ success: false, error: 'Doublon : … BC-2026-0032.', doublon: { motif: 'scan_identique', bon_id: 'id32', bon_numero: 'BC-2026-0032' } }]);
  const tree = render('magasinier', { [S.showForm]: true, [S.form]: FORM }, spy);
  await byText(tree, 'Creer le bon').props.onClick();
  const set = spy.sets.filter((s) => s.index === S.doublonBc).pop();
  assert.ok(set && set.value, 'la fenêtre de doublon est ouverte');
  assert.equal(set.value.bon_numero, 'BC-2026-0032');
  assert.equal(spy.alerts.length, 0, 'aucun alert brut sur un doublon');
});

// ── 2. LE FORÇAGE ENVOIE LE DRAPEAU ────────────────────────────────────────

test('création normale — force_doublon N\'EST PAS envoyé', async () => {
  const spy = newSpy([{ success: true, numero: 'BC-0100' }]);
  const tree = render('magasinier', { [S.showForm]: true, [S.form]: FORM }, spy);
  await byText(tree, 'Creer le bon').props.onClick();
  const post = spy.fetches.find((f) => /action=create-bc/.test(f.url));
  assert.ok(post);
  const body = JSON.parse(post.init.body);
  assert.equal('force_doublon' in body, false, 'envoyé en permanence, le drapeau neutraliserait la garde');
});

test('« Créer quand même ce bon » — renvoie create-bc AVEC force_doublon', async () => {
  const spy = newSpy([{ success: true, numero: 'BC-0101' }]);
  const tree = render('magasinier', { [S.showForm]: true, [S.form]: FORM, [S.doublonBc]: DOUBLON_SCAN }, spy);
  const forceBtn = byText(tree, 'Créer quand même ce bon');
  assert.ok(forceBtn, 'bouton de forçage présent');
  await forceBtn.props.onClick();

  const post = spy.fetches.find((f) => /action=create-bc/.test(f.url));
  assert.ok(post, 'appel create-bc émis');
  const body = JSON.parse(post.init.body);
  assert.equal(body.force_doublon, true, 'le forçage DOIT envoyer le drapeau');
  // On rejoue l'envoi mémorisé, pas une re-dérivation.
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].article, 'UREE 46');
  // Succès : la fenêtre se ferme et la liste est rechargée.
  assert.ok(spy.sets.some((s) => s.index === S.doublonBc && s.value === null));
});

test('« Annuler » — aucun appel, la création est abandonnée', async () => {
  const spy = newSpy();
  const tree = render('magasinier', { [S.doublonBc]: DOUBLON_SCAN }, spy);
  // Sélection par LIBELLÉ, pas par autoFocus : sinon un jour où le focus
  // basculerait sur le forçage, ce test cliquerait « créer quand même » en
  // croyant annuler.
  const annuler = byText(tree, 'Annuler');
  assert.ok(annuler, 'bouton d\'abandon présent');
  await annuler.props.onClick();
  assert.equal(spy.fetches.some((f) => /action=create-bc/.test(f.url)), false);
  assert.ok(spy.sets.some((s) => s.index === S.doublonBc && s.value === null));
});

// ── 3. LE FORÇAGE EST DÉLIBÉRÉ ─────────────────────────────────────────────

test('le forçage n\'est ni le bouton d\'accent ni l\'autofocus', () => {
  const tree = render('magasinier', { [S.doublonBc]: DOUBLON_SCAN }, newSpy());
  const forceBtn = byText(tree, 'Créer quand même ce bon');
  const annuler = byText(tree, 'Annuler');
  // Le forçage n'attrape pas le focus (donc pas déclenché par Entrée)…
  assert.notEqual(forceBtn.props.autoFocus, true);
  // …et il n'y a QU'UN seul autofocus dans la fenêtre : c'est celui d'« Annuler ».
  const focused = findAll(tree, (n) => n.props.autoFocus === true);
  assert.equal(focused.length, 1);
  assert.equal(focused[0], annuler);
  // …et ce n'est pas lui qui porte le style d'accent plein.
  assert.equal(/var\(--berry\)|background: *#e74c3c/.test(String(forceBtn.props.style.background)), false);
  assert.match(String(annuler.props.style.background), /var\(--berry\)/);
  // Son libellé dit ce qu'il fait — jamais un « OK ».
  assert.match(flatText(tree), /Créer quand même ce bon/);
});

// ── 4. SUPPRESSION : VISIBILITÉ PAR RÔLE ───────────────────────────────────

function deleteButtons(tree) { return findAll(tree, (n) => n.props.title === 'Supprimer le bon'); }

test('bouton « Supprimer » — visible pour magasinier, achats et dg', () => {
  // Le magasinier a été AJOUTÉ le 2026-08-29 : il repère son doublon avant
  // tout le monde. Sa double confirmation est testée dans
  // tests/unit/magBCSuppressionDoubleConfirm.test.js.
  for (const profil of ['magasinier', 'achats', 'dg']) {
    const tree = render(profil, null, newSpy());
    // bc1 seulement : mov_9 est une ligne virtuelle, IMP-0003 un import.
    assert.equal(deleteButtons(tree).length, 1, 'profil ' + profil);
  }
});

test('bouton « Supprimer » — ABSENT pour tout autre rôle (le serveur rendrait 403)', () => {
  for (const profil of ['chef_f1', 'finance', 'rh', '']) {
    const tree = render(profil, null, newSpy());
    assert.equal(deleteButtons(tree).length, 0, 'profil ' + profil);
  }
});

// ── 5. SUPPRESSION : MOTIF ET EFFET STOCK ──────────────────────────────────

test('fenêtre de suppression — annonce que les quantités reviennent en stock', () => {
  const tree = render('dg', { [S.deleteBc]: BCS[0] }, newSpy());
  const txt = flatText(tree);
  assert.match(txt, /BC-0001/);
  assert.match(txt, /reviennent en stock/);
  assert.match(txt, /Motif de la suppression/);
});

test('motif vide ou trop court — bouton DÉSACTIVÉ, aucune requête possible', () => {
  for (const motif of ['', '   ', 'ok']) {
    const tree = render('dg', { [S.deleteBc]: BCS[0], [S.deleteMotif]: motif }, newSpy());
    const btn = byText(tree, 'Supprimer ce bon');
    assert.ok(btn);
    assert.equal(btn.props.disabled, true, 'motif ' + JSON.stringify(motif));
  }
});

test('motif renseigné — POST delete-bc avec bc_id et motif trimé', async () => {
  const spy = newSpy([{ success: true, movements_reversed: 2 }]);
  const tree = render('dg', { [S.deleteBc]: BCS[0], [S.deleteMotif]: '  doublon de BC-2026-0032 ' }, spy);
  const btn = byText(tree, 'Supprimer ce bon');
  assert.equal(btn.props.disabled, false);
  await btn.props.onClick();

  const post = spy.fetches.find((f) => /action=delete-bc/.test(f.url));
  assert.ok(post, 'appel delete-bc émis');
  assert.equal(post.init.method, 'POST');
  assert.deepEqual(JSON.parse(post.init.body), { bc_id: 'bc1', motif: 'doublon de BC-2026-0032' });
  // Succès : la fenêtre se ferme ET la liste est rechargée, sinon le bon
  // supprimé reste affiché et l'utilisateur croit à un échec.
  assert.ok(spy.sets.some((s) => s.index === S.deleteBc && s.value === null));
  assert.ok(spy.fetches.some((f) => /action=list-bc(&|$)/.test(f.url)), 'liste rechargée');
});

test('refus serveur — message affiché TEL QUEL, la fenêtre reste ouverte', async () => {
  const spy = newSpy([{ success: false, error: 'Réservé au responsable achats ou au DG' }]);
  const tree = render('dg', { [S.deleteBc]: BCS[0], [S.deleteMotif]: 'doublon' }, spy);
  await byText(tree, 'Supprimer ce bon').props.onClick();
  const err = spy.sets.filter((s) => s.index === S.deleteError).pop();
  assert.ok(err);
  assert.match(err.value, /Réservé au responsable achats ou au DG/);
  assert.equal(spy.sets.some((s) => s.index === S.deleteBc && s.value === null), false);
});
