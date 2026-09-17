'use strict';

// Tests de RENDU de la DOUBLE CONFIRMATION de suppression d'un bon de
// consommation (src/modules/magasin/MagBCTab.jsx, ticket sb/bc-suppr-magasinier).
//
// Même harnais que tests/unit/bcDoublonFrontWiring.test.js : faux `window`,
// React stubé, JSX babélisé à la volée (pas de DOM, pas de RTL — limitation
// documentée du repo).
//
// CE QUI EST VERROUILLÉ ICI :
//   1. le magasinier ne supprime JAMAIS en une seule étape — valider le motif
//      n'émet aucune requête, cela ouvre une seconde fenêtre ;
//   2. `achats`/`dg` gardent le parcours d'origine : la seconde étape ne leur
//      est PAS imposée (elle transformerait un droit existant en corvée) ;
//   3. la seconde étape exige de RETAPER le numéro exactement — le bouton reste
//      inactif sur une saisie vide, partielle, de casse différente ou entourée
//      d'espaces (une comparaison laxiste viderait le geste de son sens) ;
//   4. la seconde étape REDIT l'effet : le bon disparaît, les quantités
//      reviennent en stock, et combien de lignes sont concernées ;
//   5. AUCUN drapeau de confirmation n'est envoyé au serveur : la protection
//      est ergonomique, un drapeau client serait usurpable.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadComponent } = require('./_esm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');

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
  return loadComponent('src/modules/magasin/MagBCTab.jsx', sandbox).MagBCTab;
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

/**
 * Sous-arbre de la SECONDE fenêtre uniquement.
 *
 * Indispensable : les deux fenêtres sont rendues en même temps (la première
 * reste montée sous la seconde), et la première annonce DÉJÀ l'effet stock.
 * Chercher « reviennent en stock » dans l'arbre entier laissait donc passer
 * une seconde étape muette sur les conséquences — mutation vérifiée.
 */
function fenetreConfirmation(tree) {
  const fenetres = findAll(tree, (n) => n.props.className === 'modal-content')
    .filter((n) => /Confirmer la suppression/.test(flatText(n)));
  assert.equal(fenetres.length, 1, 'une seule seconde fenêtre attendue');
  return fenetres[0];
}

// --------------------------------------------------------------- fixtures

const BC = {
  id: 'bc1', numero: 'BC-2026-0050', date: '2026-08-20',
  items: [
    { article: 'UREE 46', quantite: 10, unite: 'kg', parcelle: 'F1-P01' },
    { article: 'MAP', quantite: 4, unite: 'kg', parcelle: 'F1-P02' },
  ],
  created_by: { name: 'Ali' },
};

function render(profile, extraStates, spy) {
  const states = Object.assign({ [S.loading]: false, [S.bcs]: [BC] }, extraStates || {});
  const MagBCTab = load(states, spy);
  return MagBCTab({ type: 'engrais', currentProfile: profile, profileData: { name: 'Test' } });
}

/** État « étape 1 remplie » : fenêtre ouverte, motif valide. */
const ETAPE1 = { [S.deleteBc]: BC, [S.deleteMotif]: 'doublon de BC-2026-0049' };

// ── 1. LE MAGASINIER NE SUPPRIME PAS EN UNE ÉTAPE ──────────────────────────

// Réponse servie SI une requête part alors qu'elle ne devrait pas. Sans elle,
// le faux `fetch` rend une promesse jamais résolue : un mutant qui supprimerait
// la seconde étape FIGERAIT la suite au lieu de la faire échouer — un test qui
// pend ne prouve rien, et le compter comme « tué » serait un faux vert.
const REPONSE_INATTENDUE = [{ success: false, error: 'requête non attendue' }];

test('magasinier — valider l\'étape 1 n\'envoie RIEN, cela ouvre la seconde confirmation', async () => {
  const spy = newSpy(REPONSE_INATTENDUE.slice());
  const tree = render('magasinier', ETAPE1, spy);
  const btn = byText(tree, 'Supprimer ce bon');
  assert.ok(btn, 'bouton d\'étape 1 présent');
  assert.equal(btn.props.disabled, false, 'motif valide : le bouton doit être actif');
  await btn.props.onClick();

  assert.equal(
    spy.fetches.some((f) => /action=delete-bc/.test(f.url)), false,
    'aucune requête de suppression ne doit partir à l\'étape 1'
  );
  const ouverture = spy.sets.filter((s) => s.index === S.deleteConfirmBc).pop();
  assert.ok(ouverture, 'la seconde fenêtre doit s\'ouvrir');
  assert.equal(ouverture.value, BC);
});

test('achats / dg — la seconde étape ne leur est PAS imposée, l\'envoi est direct', async () => {
  for (const profil of ['achats', 'dg']) {
    const spy = newSpy([{ success: true, movements_reversed: 2 }]);
    const tree = render(profil, ETAPE1, spy);
    await byText(tree, 'Supprimer ce bon').props.onClick();

    const post = spy.fetches.find((f) => /action=delete-bc/.test(f.url));
    assert.ok(post, 'profil ' + profil + ' : la suppression doit partir immédiatement');
    assert.deepEqual(JSON.parse(post.init.body), { bc_id: 'bc1', motif: 'doublon de BC-2026-0049' });
    assert.equal(
      spy.sets.some((s) => s.index === S.deleteConfirmBc && s.value === BC), false,
      'profil ' + profil + ' : aucune seconde fenêtre ne doit s\'ouvrir'
    );
  }
});

test('magasinier — motif encore invalide : ni requête, ni seconde fenêtre', async () => {
  for (const motif of ['', '   ', 'ok']) {
    const spy = newSpy(REPONSE_INATTENDUE.slice());
    const tree = render('magasinier', { [S.deleteBc]: BC, [S.deleteMotif]: motif }, spy);
    const btn = byText(tree, 'Supprimer ce bon');
    assert.equal(btn.props.disabled, true, 'motif ' + JSON.stringify(motif));
    await btn.props.onClick();
    assert.equal(spy.fetches.some((f) => /action=delete-bc/.test(f.url)), false);
    assert.equal(spy.sets.some((s) => s.index === S.deleteConfirmBc && s.value === BC), false);
  }
});

// ── 2. LA SECONDE FENÊTRE REDIT CE QUI VA SE PASSER ────────────────────────

test('seconde étape — nomme le bon, annonce l\'effet stock et le nombre de lignes', () => {
  const tree = render('magasinier', Object.assign({}, ETAPE1, { [S.deleteConfirmBc]: BC }), newSpy());
  // Texte de la SECONDE fenêtre SEULE — cf. fenetreConfirmation().
  const txt = flatText(fenetreConfirmation(tree));
  assert.match(txt, /BC-2026-0050/);
  assert.match(txt, /disparaître de la liste/);
  // L'effet stock DOIT être redit ICI : la première fenêtre a pu être lue
  // distraitement, c'est justement ce que la seconde étape corrige.
  assert.match(txt, /reviennent en stock/);
  assert.match(txt, /2 lignes/);
  assert.match(txt, /Retapez le numéro du bon/);
});

test('seconde étape — le singulier est respecté sur un bon à une seule ligne', () => {
  const unique = Object.assign({}, BC, { items: [BC.items[0]] });
  const tree = render('magasinier', { [S.deleteBc]: unique, [S.deleteMotif]: 'doublon', [S.deleteConfirmBc]: unique }, newSpy());
  const txt = flatText(fenetreConfirmation(tree));
  assert.match(txt, /1 ligne/);
  assert.doesNotMatch(txt, /1 lignes/);
});

// ── 3. LE GESTE EST DÉLIBÉRÉ : LE NUMÉRO EXACT, OU RIEN ────────────────────

function boutonFinal(tree) { return byText(tree, 'Supprimer définitivement'); }

function renderEtape2(numeroSaisi, spy) {
  return render('magasinier', Object.assign({}, ETAPE1, {
    [S.deleteConfirmBc]: BC,
    [S.deleteNumeroSaisi]: numeroSaisi,
  }), spy || newSpy());
}

test('seconde étape — bouton INACTIF tant que le numéro retapé ne correspond pas', () => {
  const saisies = [
    '',                 // rien
    'BC',               // partiel
    'BC-2026-005',      // presque
    'BC-2026-0051',     // un autre bon
    'BC-2026-00500',    // suffixé
  ];
  for (const saisie of saisies) {
    const btn = boutonFinal(renderEtape2(saisie));
    assert.ok(btn, 'bouton présent pour ' + JSON.stringify(saisie));
    assert.equal(btn.props.disabled, true, 'saisie ' + JSON.stringify(saisie));
  }
});

test('seconde étape — la comparaison est STRICTE : ni casse ignorée, ni espaces tolérés', () => {
  // Une comparaison laxiste (toLowerCase / trim) laisserait passer un geste
  // machinal : c'est exactement ce que la seconde étape doit empêcher.
  const laxistes = ['bc-2026-0050', 'Bc-2026-0050', ' BC-2026-0050', 'BC-2026-0050 ', ' BC-2026-0050 '];
  for (const saisie of laxistes) {
    const btn = boutonFinal(renderEtape2(saisie));
    assert.equal(btn.props.disabled, true, 'saisie ' + JSON.stringify(saisie) + ' ne doit PAS activer le bouton');
  }
});

test('seconde étape — un bon SANS numéro ne peut pas être confirmé à vide', () => {
  // '' === '' serait vrai : le bouton s'activerait tout seul, sans aucun geste.
  const sansNumero = Object.assign({}, BC, { numero: '' });
  const tree = render('magasinier', {
    [S.deleteBc]: sansNumero, [S.deleteMotif]: 'doublon',
    [S.deleteConfirmBc]: sansNumero, [S.deleteNumeroSaisi]: '',
  }, newSpy());
  assert.equal(boutonFinal(tree).props.disabled, true);
});

test('seconde étape — numéro exact : le bouton s\'active et POSTe delete-bc', async () => {
  const spy = newSpy([{ success: true, movements_reversed: 2 }]);
  const tree = renderEtape2('BC-2026-0050', spy);
  const btn = boutonFinal(tree);
  assert.equal(btn.props.disabled, false);
  await btn.props.onClick();

  const post = spy.fetches.find((f) => /action=delete-bc/.test(f.url));
  assert.ok(post, 'appel delete-bc émis');
  assert.equal(post.init.method, 'POST');
  // Le corps ne contient QUE bc_id et motif : la double confirmation est une
  // protection d'interface, elle n'a aucun équivalent envoyé au serveur.
  assert.deepEqual(JSON.parse(post.init.body), { bc_id: 'bc1', motif: 'doublon de BC-2026-0049' });
  // Succès : les DEUX fenêtres se ferment et la liste est rechargée, sinon le
  // bon supprimé reste affiché et le magasinier croit à un échec.
  assert.ok(spy.sets.some((s) => s.index === S.deleteConfirmBc && s.value === null));
  assert.ok(spy.sets.some((s) => s.index === S.deleteBc && s.value === null));
  assert.ok(spy.fetches.some((f) => /action=list-bc(&|$)/.test(f.url)), 'liste rechargée');
});

test('seconde étape — aucun drapeau de confirmation n\'est envoyé au serveur', async () => {
  const spy = newSpy([{ success: true }]);
  const tree = renderEtape2('BC-2026-0050', spy);
  await boutonFinal(tree).props.onClick();
  const post = spy.fetches.find((f) => /action=delete-bc/.test(f.url));
  const corps = JSON.parse(post.init.body);
  assert.deepEqual(Object.keys(corps).sort(), ['bc_id', 'motif']);
  assert.doesNotMatch(post.init.body, /confirm/i);
});

// ── 4. REFUS SERVEUR ───────────────────────────────────────────────────────

test('seconde étape — refus serveur : message TEL QUEL, la fenêtre reste ouverte', async () => {
  const spy = newSpy([{ success: false, error: 'Bon déjà supprimé' }]);
  const tree = renderEtape2('BC-2026-0050', spy);
  await boutonFinal(tree).props.onClick();

  const err = spy.sets.filter((s) => s.index === S.deleteError).pop();
  assert.ok(err);
  assert.match(err.value, /Bon déjà supprimé/);
  assert.equal(spy.sets.some((s) => s.index === S.deleteConfirmBc && s.value === null), false);
  assert.equal(spy.sets.some((s) => s.index === S.deleteBc && s.value === null), false);
});

test('seconde étape — le message d\'erreur y est rendu (pas seulement sous la fenêtre)', () => {
  const tree = render('magasinier', Object.assign({}, ETAPE1, {
    [S.deleteConfirmBc]: BC, [S.deleteNumeroSaisi]: 'BC-2026-0050',
    [S.deleteError]: 'Bon de consommation introuvable',
  }), newSpy());
  assert.match(flatText(tree), /Bon de consommation introuvable/);
});
