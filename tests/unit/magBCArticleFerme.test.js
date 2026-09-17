'use strict';

/*
 * magBCArticleFerme.test.js — le champ « Article » du bon de consommation en
 * SÉLECTION FERMÉE.
 *
 * Demande d'Omar : « on passe l'article du bon de consommation en liste
 * déroulante avec champ de sélection en tapant le nom. Comme ça on règle le
 * problème. » L'ancien `<input list>` + `<datalist>` ressemblait à une liste
 * déroulante et acceptait n'importe quelle saisie.
 *
 * ── CE QUI EST VERROUILLÉ ICI ──────────────────────────────────────────────
 *  1. un bon dont une ligne n'est PAS au catalogue n'est jamais envoyé ;
 *  2. le magasinier garde une ISSUE : « Demander la création au DG » reste
 *     atteignable quand ce qu'il tape ne correspond à rien. C'est le point le
 *     plus important — sans lui, la fermeture l'enferme devant une marchandise
 *     qu'il a physiquement en main ;
 *  3. un libellé AMBIGU (2+ fiches actives) n'ouvre PAS la création — le
 *     remède est une fusion — et bloque quand même l'envoi ;
 *  4. le refus SERVEUR reste en place : ce filtre le rend rare, il ne le
 *     remplace pas.
 *
 * Même harnais que magBCUniteConversion.test.js : faux `window`, React stubé,
 * JSX babélisé à la volée (pas de DOM, pas de RTL — limitation du repo).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadComponent } = require('./_esm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');

function babelise(rel) {
  return babel.transformSync(
    fs.readFileSync(path.join(ROOT, rel), 'utf8'),
    { presets: [require.resolve('@babel/preset-react')], filename: path.basename(rel), babelrc: false, configFile: false }
  ).code;
}


const CampagneUtils = require('./_esm').loadEsm('src/modules/shared/lib/campagneUtils.js');
const UniteConsoUtils = require('./_esm').loadEsm('src/modules/shared/lib/uniteConsoUtils.js');
const ArticleSelect = require('./_esm').loadEsm('src/modules/shared/lib/articleSelect.js');

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
};

function load(stateOverrides, spy) {
  const sandbox = {
    window: {
      useStockLocations: () => ({ magasins: ['F1', 'F5'] }),
      cachedFetch: () => new Promise(function () {}),
      CampagneUtils,
      UniteConsoUtils,
      ArticleSelect,
      setTimeout,
    },
    // ⚠️ Le faux `fetch` RÉSOUT toujours, contrairement au harnais des autres
    // fichiers (qui rend `new Promise(function () {})` quand aucune réponse
    // n'est en file). Ici on teste des mutants qui LÈVENT la garde de
    // soumission : le bon part alors pour de bon, l'`await` du test ne se
    // résout jamais, et la suite se met à PENDRE au lieu de rougir. Un mutant
    // qui fait pendre la suite n'est pas tué — il n'est même pas jugé.
    fetch: function (url, init) {
      if (spy) spy.fetches.push({ url, init });
      const body = (spy && spy.responses && spy.responses.length)
        ? spy.responses.shift()
        : { success: false, error: 'réponse non prévue par le test' };
      return Promise.resolve({ json: () => Promise.resolve(body) });
    },
    alert: function (msg) { if (spy) spy.alerts.push(msg); },
    confirm: function () { return true; },
    setTimeout, Date, Math, Set, JSON, parseFloat, String, Number, isFinite, Object, Array,
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
    useRef: function (initial) { const ref = { current: initial }; if (spy) spy.refs.push(ref); return ref; },
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
function findAll(node, pred) { return walk(node).filter((n) => n && n.props && pred(n)); }
function byText(tree, label) {
  return findAll(tree, (n) => n.children && n.children.some((c) => typeof c === 'string' && c.indexOf(label) >= 0))[0];
}
function textesDe(tree) {
  return walk(tree)
    .flatMap((n) => (n.children || []).filter((c) => typeof c === 'string').map(String))
    .join(' | ');
}
function newSpy(responses) {
  return { fetches: [], sets: [], effects: [], refs: [], alerts: [], responses: responses || [] };
}

/** Catalogue RÉEL : deux fiches actives « OPAL » = le cas ambigu de production. */
const CATALOGUE = [
  // Le cas d'Omar, avec les vrais libellés du catalogue de production.
  { id: 'SULF_AMM', nom: "Sulfate d'ammoniaque", unite: 'KG', active: true },
  { id: 'SULF_FE', nom: 'Sulfate de fer', unite: 'KG', active: true },
  { id: 'SULF_CU', nom: 'Sulfate de Cuivre', unite: 'KG', active: true },
  { id: 'KELPAK', nom: 'KELPAK', unite: 'L', active: true },
  { id: 'Ref-Eng0056', nom: 'Rhizo amine', unite: 'KG', active: true },
  { id: 'Ref-Eng0052', nom: 'OPAL', unite: 'L', active: true },
  { id: 'Ref-Eng0177', nom: 'Opal', unite: 'L', active: true },
];

function ligne(over) {
  return Object.assign({ article: '', quantite: '', unite: 'kg', parcelle: 'F1-P01', parcelle_ref: 'R1', culture: 'Framboise', ferme: 'F1', groupe_id: '' }, over || {});
}
function formAvec(items) {
  return { date: '2026-08-29', lieu_source_type: 'magasin', lieu_source_id: 'F1', items };
}
function render(profile, items, spy) {
  const MagBCTab = load({
    [S.loading]: false, [S.bcs]: [], [S.catalogueArticles]: CATALOGUE,
    [S.showForm]: true, [S.form]: formAvec(items),
    [S.stocks]: [{ article: 'KELPAK', stock: 999 }, { article: 'Rhizo amine', stock: 999 }, { article: 'OPAL', stock: 999 }],
  }, spy);
  return MagBCTab({ type: 'engrais', currentProfile: profile, profileData: { name: 'Test' } });
}
const appelsCreateBc = (spy) => spy.fetches.filter((f) => String(f.url).indexOf('action=create-bc') >= 0);

// ── 1. LE CHAMP N'EST PLUS LIBRE ──────────────────────────────────────────

test('MUTANT « champ redevenu libre » : un article hors catalogue n\'est PAS envoyé', async () => {
  const spy = newSpy();
  const tree = render('magasinier', [ligne({ article: 'ACIDE SULFURIQUE', quantite: '5' })], spy);
  await byText(tree, 'Creer le bon').props.onClick();
  assert.equal(appelsCreateBc(spy).length, 0, 'le bon ne doit pas partir');
  assert.equal(spy.alerts.length, 1);
  assert.ok(spy.alerts[0].includes('ACIDE SULFURIQUE'), 'l\'alerte doit NOMMER la ligne fautive');
  assert.ok(spy.alerts[0].includes('liste déroulante'), 'et dire quoi faire');
});

test('un article RÉEL du catalogue part normalement', async () => {
  const spy = newSpy([{ success: true, numero: 'BC-2026-0001' }]);
  const tree = render('magasinier', [ligne({ article: 'KELPAK', quantite: '5' })], spy);
  await byText(tree, 'Creer le bon').props.onClick();
  assert.equal(appelsCreateBc(spy).length, 1, 'la fermeture ne doit pas gêner une saisie normale');
});

test('une ligne fautive parmi des lignes valides bloque le bon ENTIER', async () => {
  const spy = newSpy();
  const tree = render('magasinier', [
    ligne({ article: 'KELPAK', quantite: '5' }),
    ligne({ article: 'PRODUIT INVENTE', quantite: '2' }),
  ], spy);
  await byText(tree, 'Creer le bon').props.onClick();
  assert.equal(appelsCreateBc(spy).length, 0,
    'envoyer la moitié du bon laisserait un solde incohérent');
});

test('le champ n\'est plus une datalist, et le combo reçoit l\'index du catalogue', () => {
  const tree = render('magasinier', [ligne({ article: '', quantite: '' })], newSpy());
  assert.equal(findAll(tree, (n) => n.type === 'datalist').length, 0);
  assert.equal(findAll(tree, (n) => n.props && n.props.list).length, 0);
  const champ = findAll(tree, (n) => n.props && n.props.placeholder === 'Article')[0];
  assert.ok(champ, 'le champ Article doit exister');
});

// ── 2. L'ISSUE DU MAGASINIER — LE POINT LE PLUS IMPORTANT ─────────────────

test('MUTANT « issue supprimée » : « Demander la création au DG » reste ATTEIGNABLE', () => {
  // Le magasinier a la marchandise en main. Si le champ n'accepte plus que
  // l'existant ET que le bouton disparaît, il est bloqué sans recours.
  const tree = render('magasinier', [ligne({ article: 'ACIDE SULFURIQUE', quantite: '5' })], newSpy());
  const bouton = byText(tree, 'Demander la création au DG');
  assert.ok(bouton, 'sans ce bouton, la sélection fermée enferme le magasinier');
  assert.equal(bouton.props.disabled, false);
});

test('Achats / DG gardent leur bouton « Créer » sur un article hors catalogue', () => {
  for (const profil of ['achats', 'dg']) {
    const tree = render(profil, [ligne({ article: 'ACIDE SULFURIQUE', quantite: '5' })], newSpy());
    assert.ok(byText(tree, 'Créer «'), profil + ' doit pouvoir créer la fiche lui-même');
  }
});

test('aucune issue proposée sur un article qui EXISTE (rien à créer)', () => {
  const tree = render('magasinier', [ligne({ article: 'KELPAK', quantite: '5' })], newSpy());
  assert.equal(byText(tree, 'Demander la création au DG'), undefined);
  assert.equal(byText(tree, 'Créer «'), undefined);
});

test('ligne vierge : aucune erreur, aucun bouton — on ne harcèle pas la saisie', () => {
  const tree = render('magasinier', [ligne({ article: '', quantite: '' })], newSpy());
  assert.equal(byText(tree, 'Demander la création au DG'), undefined);
  assert.ok(!textesDe(tree).includes('n\'est pas au catalogue'));
});

// ── 3. AMBIGUÏTÉ : ni création, ni validation ─────────────────────────────

test('MUTANT « choix ambigu accepté » : OPAL bloque l\'envoi et nomme les deux fiches', async () => {
  const spy = newSpy();
  const tree = render('magasinier', [ligne({ article: 'OPAL', quantite: '5' })], spy);
  await byText(tree, 'Creer le bon').props.onClick();
  assert.equal(appelsCreateBc(spy).length, 0, 'le serveur refuserait de toute façon (article_ambigu)');
  assert.ok(spy.alerts[0].includes('Ref-Eng0052') && spy.alerts[0].includes('Ref-Eng0177'),
    'le magasinier doit savoir QUELLES fiches sont en cause');
  assert.ok(spy.alerts[0].includes('Fusionnez'));
});

test('un libellé AMBIGU n\'ouvre PAS la création : le remède est une fusion', () => {
  // Créer une TROISIÈME fiche aggraverait exactement le défaut du catalogue —
  // même arbitrage que `demandeCreationArticle.libellesADemander` côté serveur.
  const tree = render('magasinier', [ligne({ article: 'OPAL', quantite: '5' })], newSpy());
  assert.equal(byText(tree, 'Demander la création au DG'), undefined);
  for (const profil of ['achats', 'dg']) {
    const t2 = render(profil, [ligne({ article: 'OPAL', quantite: '5' })], newSpy());
    assert.equal(byText(t2, 'Créer «'), undefined, profil);
  }
  // …et l'ambiguïté est DITE, pas tue.
  assert.ok(textesDe(tree).includes('Fusionnez'), 'l\'écran doit expliquer le blocage');
});

// ── 4. LE SERVEUR RESTE L'AUTORITÉ ────────────────────────────────────────

test('MUTANT « refus serveur affaibli » : create-bc refuse toujours de son côté', () => {
  // ⚠️ PÉRIMÈTRE DE CETTE PR. Le sélecteur fermé est livrable SEUL : il ne
  // dépend d'aucun changement serveur. La garde qui fait foi est celle qui est
  // DÉJÀ EN PRODUCTION — le refus fail-closed d'IDENTITÉ posé par le lot #362.
  // Le scan de bon (MagBCScanModal) et les appels directs à l'API n'empruntent
  // pas ce champ : fermer le sélecteur rend ce refus RARE, il ne le remplace
  // pas, et l'affaiblir au prétexte que le front filtre serait une régression.
  //
  // Le GEL D'UNITÉ (`uniteConso.figee`) appartient à l'AUTRE PR et n'est
  // volontairement pas asserté ici : l'exiger rendrait ce lot non livrable
  // seul — exactement ce que la séparation cherche à éviter.
  const SRC = require('../helpers/backendSource').backendSource();
  const debut = SRC.indexOf('if (action === "create-bc" && req.method === "POST")');
  const fin = SRC.indexOf('// ========== MODIFICATION DE LA DATE', debut);
  const bloc = SRC.slice(debut, fin).split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  assert.ok(/identiteArticle\.resoudreLignes\(/.test(bloc), 'le refus d\'identité doit rester');
  assert.ok(/if \(!bcResolution\.ok\)[\s\S]{0,600}res\.status\(400\)/.test(bloc));
});

test('le front délègue au module pur, il ne compare aucun libellé lui-même', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/modules/magasin/MagBCTab.jsx'), 'utf8');
  const code = src.split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  assert.ok(/AS\.lignesInvalides\(validItems, articleIndex\)/.test(code),
    'la garde de soumission doit venir du module pur');
  // La comparaison maison qui gardait le bouton de création est retirée : elle
  // divergeait de `canon` (elle ignorait le suffixe d'unité et les espaces).
  assert.ok(!/catalogueArticles\.some\(a => a\.nom\.toLowerCase\(\) === v\.toLowerCase\(\)\)/.test(code),
    'une comparaison de libellés écrite ici rouvrirait deux règles concurrentes');
  assert.ok(/verdictArticle\(v\)/.test(code), 'le bouton d\'issue doit dériver du verdict');
});

// ── LE CAS D'OMAR, à l'écran ───────────────────────────────────────────────

test('MUTANT « création proposée sur une frappe partielle » — LE CAS D\'OMAR', () => {
  // « Il doit afficher les suggestions des articles avec dropdown. Aujourd'hui
  // il suggère d'ajouter pour tous, même pour articles existants. »
  const tree = render('magasinier', [ligne({ article: 'sulfate', quantite: '5' })], newSpy());
  assert.equal(
    byText(tree, 'Demander la création au DG'), undefined,
    'trois « Sulfate … » existent au catalogue : proposer la création est le défaut remonté par Omar'
  );
  // …et la ligne n'est pas peinte en rouge : le magasinier est en train de taper.
  const champ = findAll(tree, (n) => n.props && n.props.placeholder === 'Article')[0];
  assert.ok(champ, 'champ Article introuvable');
  assert.ok(
    !/2px solid #e74c3c/.test(JSON.stringify(champ.props.style || {})),
    'une frappe partielle qui a des résultats ne doit pas être signalée en erreur'
  );
});

test('LE CAS D\'OMAR — Achats/DG non plus ne voient pas « Créer » sur une frappe partielle', () => {
  for (const profil of ['achats', 'dg']) {
    const tree = render(profil, [ligne({ article: 'sulfate', quantite: '5' })], newSpy());
    assert.equal(byText(tree, 'Créer «'), undefined, profil);
  }
});

test('la création reste proposée quand RIEN ne correspond', () => {
  // L'issue du magasinier ne doit pas disparaître au passage : c'est
  // exactement l'équilibre que ce correctif doit tenir.
  const tree = render('magasinier', [ligne({ article: 'ZZQX-INEXISTANT', quantite: '5' })], newSpy());
  assert.ok(byText(tree, 'Demander la création au DG'), 'là, le bouton DOIT être là');
});

test('une frappe partielle bloque quand même l\'envoi du bon', async () => {
  const spy = newSpy();
  const tree = render('magasinier', [ligne({ article: 'sulfate', quantite: '5' })], spy);
  await byText(tree, 'Creer le bon').props.onClick();
  assert.equal(appelsCreateBc(spy).length, 0, '« sulfate » n\'est pas un article');
  assert.ok(spy.alerts[0].includes('choisissez-en un dans la liste'), spy.alerts[0]);
});

// ── CATALOGUE NON CHARGÉ — le contre-exemple du terrain ───────────────────
// Magasinier sur téléphone, 3G qui saute : `list-articles` (1 019 fiches) part
// en timeout, et son `.catch(()=>{})` avale l'échec. `catalogueArticles` reste
// vide, l'index est vide, TOUT devient `inconnu` — et un article qui EXISTE se
// voit refuser, avec un message invitant à en demander la création.
//
// C'est le pire cas possible pour ce lot : un article saisissable HIER,
// impossible aujourd'hui, et seulement en réseau dégradé — c'est-à-dire sur le
// terrain, là où personne ne le reproduira.
//
// Règle : catalogue inconnu ⇒ on ne filtre pas. Le serveur refuse déjà en
// fail-closed (#362, en production). Le filtre rend le refus rare, il ne le
// remplace pas — et il ne doit surtout pas en inventer.

function renderSansCatalogue(items, spy) {
  const MagBCTab = load({
    [S.loading]: false, [S.bcs]: [],
    [S.catalogueArticles]: [], // list-articles a échoué, ou n'est pas revenu
    [S.showForm]: true, [S.form]: formAvec(items),
    [S.stocks]: [],
  }, spy);
  return MagBCTab({ type: 'engrais', currentProfile: 'magasinier', profileData: { name: 'Test' } });
}

test('MUTANT « garde sans test de non-vacuité » : catalogue non chargé, le bon PART', async () => {
  const spy = newSpy([{ success: true, numero: 'BC-2026-0001' }]);
  const tree = renderSansCatalogue([ligne({ article: 'KELPAK', quantite: '5' })], spy);
  await byText(tree, 'Creer le bon').props.onClick();
  assert.equal(
    appelsCreateBc(spy).length, 1,
    'KELPAK existe au catalogue : le refuser parce que la liste n\'a pas chargé '
    + 'ferait demander la création d\'un article déjà présent'
  );
  // Le chemin de succès alerte (« Bon … créé ») : ce qu'on vérifie est
  // l'absence d'une alerte de REFUS, pas l'absence de toute alerte.
  assert.ok(
    !spy.alerts.some((a) => String(a).includes('ne peut pas être enregistré')),
    'aucun refus ne doit être prononcé sur un catalogue non lu : ' + JSON.stringify(spy.alerts)
  );
});

test('catalogue non chargé : aucune ligne n\'est marquée en erreur à l\'écran', () => {
  const tree = renderSansCatalogue([ligne({ article: 'KELPAK', quantite: '5' })], newSpy());
  assert.equal(
    byText(tree, 'Demander la création au DG'), undefined,
    'proposer la création d\'un article existant est exactement le piège à éviter'
  );
  const champ = findAll(tree, (n) => n.props && n.props.placeholder === 'Article')[0];
  assert.ok(
    !/2px solid #e74c3c/.test(JSON.stringify((champ && champ.props.style) || {})),
    'aucune bordure rouge sur un catalogue qu\'on n\'a pas pu lire'
  );
});

test('catalogue non chargé : le magasinier est PRÉVENU que le contrôle est levé', () => {
  // Le `.catch(()=>{})` rend la panne invisible : un catalogue vide est
  // indiscernable d'un catalogue réellement vide. On le dit, discrètement.
  const tree = renderSansCatalogue([ligne({ article: '', quantite: '' })], newSpy());
  assert.ok(
    textesDe(tree).includes('Liste des articles indisponible'),
    'un vide silencieux est ce qui rend la panne introuvable sur le terrain'
  );
});

test('catalogue CHARGÉ : le filtre reprend tous ses droits', async () => {
  // La garde de non-vacuité ne doit pas devenir une porte dérobée permanente.
  const spy = newSpy();
  const tree = render('magasinier', [ligne({ article: 'PRODUIT-INEXISTANT', quantite: '5' })], spy);
  await byText(tree, 'Creer le bon').props.onClick();
  assert.equal(appelsCreateBc(spy).length, 0);
});
