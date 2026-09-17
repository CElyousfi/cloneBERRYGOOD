'use strict';

/*
 * Catégorie d'article = liste FERMÉE (Stock › Articles, création ET édition).
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────
 * Le champ était un texte libre : le catalogue porte `Engrais` ET `engrais`,
 * `Pesticides` ET `PESTICIDES` ET `pesticides`, `phyto`, `PHYTO-SANITAIRE`,
 * `IMMOBILISATION` et `IMMOBILISATIONS`. Une faute de frappe créait une
 * catégorie de plus et sortait l'article des deux onglets de consommation.
 *
 * ── LE TEST QUI COMPTE ─────────────────────────────────────────────────────
 * Une liste fermée qui « corrige » silencieusement une valeur existante serait
 * une catastrophe muette : ouvrir une fiche `pesticides` et cliquer
 * « Enregistrer » sans toucher au champ ne doit RIEN changer — sur 326 fiches.
 * Le `<select>` doit donc porter une option pour la valeur d'origine, telle
 * quelle. C'est l'objet de `rendre()` ci-dessous, qui EXTRAIT le champ du
 * source de prod (public/app.jsx) plutôt que de le recopier : un miroir
 * dériverait sans faire rougir personne.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - ne pas injecter la valeur hors liste (le select retomberait sur sa
 *    première option et réécrirait la catégorie au premier enregistrement) ;
 *  - comparer sans tenir compte de la casse (`engrais` -> `Engrais`) ;
 *  - remettre un `<input list=` / `<datalist` sur la catégorie ;
 *  - faire diverger la liste de la création et celle de l'édition.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');
// La fiche article vit dans l'onglet Catalogue (achats).
const SRC = require('./_sources').moduleSource('achats/AchatsCatalogueTab.jsx');
const LIB = 'src/modules/shared/lib/articleCategories.js';
const { loadEsm } = require('./_esm');

const { CATEGORIES_ARTICLE, optionsCategorie, SUFFIXE_HORS_LISTE, LABEL_VIDE } = loadEsm(LIB);
const { familleBucket } = require('../../functions/lib/valorisation/consoValorisation');

// ── 1. la liste canonique ──────────────────────────────────────────────────

test('les deux familles qui comptent sont proposées, et EN TÊTE', () => {
  // `familleBucket` ne sait classer que ces deux-là : ce sont elles qui
  // commandent les écrans de consommation. Proposer une orthographe qu'il ne
  // reconnaît pas rendrait le classement inopérant — tout l'objet du ticket.
  assert.strictEqual(CATEGORIES_ARTICLE[0], 'Engrais');
  assert.strictEqual(CATEGORIES_ARTICLE[1], 'Pesticides');
  assert.strictEqual(familleBucket('Engrais'), 'engrais');
  assert.strictEqual(familleBucket('Pesticides'), 'pesticide');
});

test('« autre » (minuscule, forme réelle) ferme la liste', () => {
  assert.strictEqual(CATEGORIES_ARTICLE[CATEGORIES_ARTICLE.length - 1], 'autre');
});

// ── 1bis. LE CONTRAT : chaque libellé EXISTE DÉJÀ en base ──────────────────
//
// Formes DOMINANTES relevées sur les 1125 fiches actives (2026-08-27), avec
// leur nombre de fiches. Ce tableau est le CONTRAT : proposer un libellé qui
// n'existe pas encore, c'est fabriquer une orthographe de plus — exactement le
// désordre que la liste fermée est censée arrêter.
//
// Une première version « embellissait » 10 de ces libellés (`Immobilisation`
// au lieu de `IMMOBILISATION`, `Autre` au lieu de `autre`, `Matériel` au lieu
// de `materiel`…). Choisir délibérément l'option proposée aurait alors créé
// une 25e variante à côté des 134 fiches existantes.
const FORMES_DOMINANTES = [
  ['Engrais', 299],
  ['Pesticides', 274],
  ['Achats consommés de matières et fournitures', 164],
  ['IMMOBILISATION', 134],
  ['Fournitures entr. et rép.', 22],
  ['Frais généraux', 19],
  ['Charges Externes', 7],
  ['charges personnel', 6],
  ['Carburants et lubrifiants', 5],
  ['Emballage', 4],
  ['PRODUIT BIO', 4],
  ['materiel', 3],
  ['Pièces de rechange', 2],
  ['Energies', 2],
  ['Petit Outillage', 1],
  ['Semences', 1],
  ['PEPINIERE', 1],
  ['BRISE VENT', 1],
  ['DESINFECTION SOL', 1],
  ['autre', 44],
];

test('CONTRAT — chaque libellé proposé est une forme qui EXISTE DÉJÀ en base', () => {
  // Aucune exception : les 20 libellés sont portés par au moins une fiche.
  // Si ce test rougit, c'est que quelqu'un a « embelli » un libellé — et donc
  // que l'écran s'apprête à créer une orthographe supplémentaire.
  const attendus = FORMES_DOMINANTES.map((f) => f[0]);
  assert.deepStrictEqual(
    CATEGORIES_ARTICLE,
    attendus,
    'la liste doit être, à l’octet près, les formes dominantes relevées en base'
  );
  for (const [libelle, fiches] of FORMES_DOMINANTES) {
    assert.ok(fiches >= 1, libelle + ' : un libellé proposé sans aucune fiche est une invention');
  }
});

test('CONTRAT — les orthographes MINORITAIRES ne sont pas proposées', () => {
  // Ce sont de vraies anomalies. Les proposer les banaliserait ; les laisser
  // hors liste les fait apparaître « (valeur actuelle) », donc REPÉRABLES.
  const anomalies = [
    ['engrais', 67], ['pesticides', 41], ['PESTICIDES', 1], ['IMMOBILISATIONS', 11],
    ['phyto', 8], ['PHYTO-SANITAIRE', 2], ['emballage', 1],
  ];
  for (const [variante] of anomalies) {
    assert.ok(
      !CATEGORIES_ARTICLE.includes(variante),
      variante + ' est une anomalie à normaliser, pas une option à proposer'
    );
    assert.strictEqual(optionsCategorie(variante).find((o) => o.value === variante).horsListe, true);
  }
  // Effet attendu et mesurable : ~136 fiches marquées « (valeur actuelle) »
  // (67+41+1+11+8+2+1 = 131 anomalies + 5 fiches sans catégorie), contre 335
  // avec les libellés embellis.
  const total = anomalies.reduce((n, a) => n + a[1], 0);
  assert.strictEqual(total, 131, 'décompte des anomalies attendu');
});

test('la liste couvre les familles réelles du catalogue, pas seulement engrais/pesticides', () => {
  // La majorité des 1125 fiches est autre chose (électropompes, immobilisations,
  // frais généraux…) : réduire la liste aux deux familles de conso forcerait à
  // ranger une immobilisation dans « autre ».
  for (const attendue of [
    'Achats consommés de matières et fournitures', 'IMMOBILISATION', 'Frais généraux',
    'Charges Externes', 'charges personnel', 'Emballage', 'Carburants et lubrifiants',
    'PRODUIT BIO', 'materiel', 'Pièces de rechange', 'Energies', 'Petit Outillage',
    'Semences', 'PEPINIERE', 'BRISE VENT', 'DESINFECTION SOL', 'Fournitures entr. et rép.',
  ]) {
    assert.ok(CATEGORIES_ARTICLE.includes(attendue), 'catégorie manquante : ' + attendue);
  }
  assert.ok(CATEGORIES_ARTICLE.length >= 20, 'liste trop courte : ' + CATEGORIES_ARTICLE.length);
  assert.strictEqual(new Set(CATEGORIES_ARTICLE).size, CATEGORIES_ARTICLE.length, 'doublon dans la liste');
});

// ── 2. l'invariant anti-réécriture, au niveau du module pur ────────────────

test('une valeur HORS LISTE est proposée telle quelle, et signalée', () => {
  for (const v of ['phyto', 'PHYTO-SANITAIRE', 'IMMOBILISATIONS', 'engrais', 'pesticides', 'n’importe quoi']) {
    const opts = optionsCategorie(v);
    const o = opts.find((x) => x.value === v);
    assert.ok(o, 'aucune option pour la valeur actuelle « ' + v +' »');
    assert.strictEqual(o.horsListe, true);
    assert.ok(o.label.endsWith(SUFFIXE_HORS_LISTE), 'la valeur à normaliser doit être visible');
  }
});

test('la comparaison est EXACTE : `engrais` n’est pas `Engrais`', () => {
  // Une comparaison insensible à la casse basculerait 366 fiches `engrais` en
  // `Engrais` et 326 `pesticides` en `Pesticides` au premier enregistrement,
  // sans que personne n'ait touché au champ. C'est la faute à ne pas commettre.
  const opts = optionsCategorie('engrais');
  assert.ok(opts.some((o) => o.value === 'engrais' && o.horsListe));
  assert.ok(opts.some((o) => o.value === 'Engrais' && !o.horsListe));
});

test('une catégorie canonique n’ajoute AUCUNE option', () => {
  assert.strictEqual(optionsCategorie('Engrais').length, CATEGORIES_ARTICLE.length + 1);
  assert.strictEqual(optionsCategorie('').length, CATEGORIES_ARTICLE.length + 1);
  assert.strictEqual(optionsCategorie(null).length, CATEGORIES_ARTICLE.length + 1);
  assert.strictEqual(optionsCategorie('')[0].label, LABEL_VIDE);
  assert.strictEqual(optionsCategorie('')[0].value, '');
});

// ── 3. le champ RÉEL de public/app.jsx ─────────────────────────────────────

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
  return { type, props: p, children: flat };
}

function collect(node, pred, out) {
  const acc = out || [];
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, pred, acc)); return acc; }
  if (pred(node)) acc.push(node);
  (node.children || []).forEach((c) => collect(c, pred, acc));
  return acc;
}

/** Le `<div>` du champ Catégorie, extrait VERBATIM de public/app.jsx. */
function extraireChamp() {
  const marqueur = '<label style={labelStyle}>Catégorie</label>';
  const i = SRC.indexOf(marqueur);
  assert.notEqual(i, -1, 'champ Catégorie introuvable dans public/app.jsx');
  const debut = SRC.lastIndexOf('<div>', i);
  assert.notEqual(debut, -1, 'ouverture du champ introuvable');
  const fin = SRC.indexOf('</div>', i);
  assert.notEqual(fin, -1, 'fermeture du champ introuvable');
  return SRC.slice(debut, fin + 6);
}

/** Rend le champ extrait pour une catégorie de fiche donnée. */
function rendre(categorieFiche) {
  const jsx = extraireChamp();
  const source = 'window.__rendreChamp = function (form) {\n'
    + '  var setForm = function () {};\n'
    + '  var fieldStyle = {}; var labelStyle = {};\n'
    // Volontairement pollué : si le champ retombait sur les catégories LUES
    // dans les fiches (l'ancien datalist), ces valeurs sales apparaîtraient.
    + '  var allCats = [\'engrais\', \'phyto\', \'ZZZ SALE\'];\n'
    + '  return (' + jsx + ');\n'
    + '};\n';
  const code = babel.transformSync(source, {
    presets: [require.resolve('@babel/preset-react')],
    filename: 'extrait-app.jsx', babelrc: false, configFile: false,
  }).code;
  const sandbox = { window: {}, console };
  sandbox.window.React = { createElement, Fragment: 'Fragment' };
  sandbox.React = sandbox.window.React;
  vm.createContext(sandbox);
  sandbox.ArticleCategories = loadEsm(LIB, { sandbox }); // le VRAI module, importé par la fiche
  vm.runInContext(code, sandbox);
  const tree = sandbox.window.__rendreChamp({ categorie: categorieFiche });
  const [select] = collect(tree, (n) => n.type === 'select');
  assert.ok(select, 'le champ Catégorie doit être un <select> fermé');
  const options = collect(tree, (n) => n.type === 'option');
  return { select, options, valeurs: options.map((o) => o.props.value) };
}

test('le champ est un <select> FERMÉ — plus aucun input list / datalist', () => {
  const jsx = extraireChamp();
  assert.doesNotMatch(jsx, /<input\s+list=/, 'le texte libre est ce qui a produit les 24 orthographes');
  assert.doesNotMatch(jsx, /datalist/i);
  assert.match(jsx, /<select /);
  // La liste vient du module partagé, pas d'un tableau recopié dans app.jsx.
  assert.match(jsx, /ArticleCategories\.optionsCategorie\(form\.categorie\)/);
});

test('une fiche `phyto` rend un select SÉLECTIONNÉ sur `phyto`', () => {
  // LE test du ticket : sans injection de la valeur hors liste, le select
  // retomberait sur sa première option et réécrirait la catégorie au premier
  // enregistrement, sans que personne n'ait touché au champ.
  const r = rendre('phyto');
  assert.strictEqual(r.select.props.value, 'phyto', 'la valeur d’origine doit rester sélectionnée');
  assert.ok(r.valeurs.includes('phyto'), 'la liste doit contenir la valeur d’origine');
});

test('idem pour IMMOBILISATIONS, engrais, pesticides — aucune valeur réécrite', () => {
  for (const v of ['IMMOBILISATIONS', 'engrais', 'pesticides', 'PHYTO-SANITAIRE']) {
    const r = rendre(v);
    assert.strictEqual(r.select.props.value, v, 'valeur réécrite pour « ' + v + ' »');
    assert.ok(r.valeurs.includes(v));
  }
});

test('une fiche SANS catégorie reste sans catégorie', () => {
  const r = rendre('');
  assert.strictEqual(r.select.props.value, '');
  assert.ok(r.valeurs.includes(''));
  const r2 = rendre(undefined);
  assert.strictEqual(r2.select.props.value, '', 'une catégorie absente ne doit pas devenir « Engrais »');
});

test('une fiche canonique voit sa valeur sélectionnée sans option parasite', () => {
  const r = rendre('Engrais');
  assert.strictEqual(r.select.props.value, 'Engrais');
  assert.ok(!r.options.some((o) => String(o.props.children).includes(SUFFIXE_HORS_LISTE)));
  // Les catégories LUES dans les fiches n'alimentent plus le champ : `ZZZ SALE`
  // (injecté dans allCats par le harnais) ne doit pas apparaître.
  assert.ok(!r.valeurs.includes('ZZZ SALE'), 'le champ ne doit plus se nourrir des valeurs existantes');
});

test('les options proposées sont EXACTEMENT celles du module partagé', () => {
  const r = rendre('phyto');
  assert.deepStrictEqual(r.valeurs, optionsCategorie('phyto').map((o) => o.value));
});

// ── 4. création et édition : UNE seule liste ───────────────────────────────

test('création et édition partagent le MÊME champ (une seule source)', () => {
  // Deux listes en dur, c'est la garantie qu'elles divergeront. Les deux
  // formulaires doivent passer par `renderFormFields`.
  const iDef = SRC.indexOf('const renderFormFields = (form, setForm, isEdit)');
  assert.notEqual(iDef, -1, 'renderFormFields introuvable');
  const appels = SRC.match(/renderFormFields\((editForm, setEditForm, true|createForm, setCreateForm, false)\)/g) || [];
  assert.strictEqual(appels.length, 2, 'édition ET création doivent appeler renderFormFields');
  // …et il n'existe qu'UN champ Catégorie dans tout le composant catalogue.
  const iFin = SRC.indexOf('renderFormFields(createForm, setCreateForm, false)');
  assert.ok(iFin > iDef, 'appel de création après la définition');
  const scope = SRC.slice(iDef, iFin);
  assert.strictEqual(
    (scope.match(/>Catégorie<\/label>/g) || []).length,
    1,
    'un seul champ Catégorie : un second serait une liste qui diverge'
  );
});

// ── 5. LA CHAÎNE COMPLÈTE : openDetail -> select -> handleUpdate -> serveur ──
//
// La règle « aucune valeur n'est changée en douce » tient à QUATRE maillons.
// Trois vivent dans app.jsx (openDetail qui remplit le formulaire, le `value`
// du select, handleUpdate qui envoie), le quatrième dans update-article
// (qui n'a pas le droit de normaliser). Un ticket futur pouvait en casser un
// sans faire rougir personne : on rejoue donc la séquence RÉELLE.

/** Extrait une fonction verbatim de public/app.jsx. */
function extraireFonction(entete, finLigne) {
  const i = SRC.indexOf(entete);
  assert.notEqual(i, -1, entete + ' introuvable dans public/app.jsx');
  const j = SRC.indexOf(finLigne, i);
  assert.notEqual(j, -1, 'fin de ' + entete + ' introuvable');
  return SRC.slice(i, j + finLigne.length);
}

/** Rejoue « j'ouvre la fiche, je ne touche à rien, j'enregistre ». */
function rejouerChaine(fiche) {
  const source = 'window.__chaine = function (fiche) {\n'
    + '  var editForm = null, envoye = null;\n'
    + '  var setEditForm = function (v) { editForm = v; };\n'
    + '  var setSelectedArticle = function () {}, setEditMode = function () {}, setSaving = function () {};\n'
    + '  var closeDetail = function () {}, load = function () {};\n'
    + '  var selectedArticle = { id: fiche.reference }, currentProfile = \'dg\', profileData = {};\n'
    + '  var chain = { then: function () { return chain; }, catch: function () { return chain; }, finally: function () { return chain; } };\n'
    + '  var fetch = function (url, opts) { envoye = { url: url, body: JSON.parse(opts.body) }; return chain; };\n'
    + '  ' + extraireFonction('const openDetail = (a) =>', '}); };') + '\n'
    + '  ' + extraireFonction('const handleUpdate = () => {', '.finally(()=>setSaving(false));\n            };') + '\n'
    + '  openDetail(fiche);\n'      // maillon 1
    + '  handleUpdate();\n'          // maillon 3 (maillon 2 = le select, testé ci-dessous)
    + '  return { editForm: editForm, envoye: envoye };\n'
    + '};\n';
  const sandbox = { window: {}, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return sandbox.window.__chaine(fiche);
}

test('CHAÎNE — ouvrir une fiche et enregistrer sans y toucher n’envoie RIEN de modifié', () => {
  // Les 12 orthographes réellement présentes en base.
  const orthographes = [
    'Engrais', 'engrais', 'Pesticides', 'pesticides', 'PESTICIDES', 'phyto',
    'PHYTO-SANITAIRE', 'IMMOBILISATION', 'IMMOBILISATIONS', 'autre', 'Emballage', 'emballage', '',
  ];
  for (const cat of orthographes) {
    const fiche = { reference: 'REF1', nom: 'X', categorie: cat, unite: 'U' };
    const r = rejouerChaine(fiche);
    // Maillon 1 — openDetail recopie la catégorie telle quelle.
    assert.strictEqual(r.editForm.categorie, cat, 'openDetail a altéré « ' + cat + ' »');
    // Maillon 2 — le select affiche cette valeur (option dédiée si hors liste).
    assert.strictEqual(rendre(cat).select.props.value, cat, 'le select a altéré « ' + cat + ' »');
    // Maillon 3 — handleUpdate envoie cette valeur au serveur, sans y toucher.
    assert.strictEqual(r.envoye.url, '/api/stock?action=update-article');
    assert.strictEqual(r.envoye.body.updates.categorie, cat, 'handleUpdate a altéré « ' + cat + ' »');
  }
});

test('CHAÎNE — maillon 4 : update-article n’a pas le droit de normaliser la catégorie', () => {
  // `create-article` normalise (minuscules) — comportement préexistant, hors
  // périmètre. `update-article`, lui, écrit la valeur telle qu'elle arrive :
  // y ajouter `normalizeCategorie` réécrirait 335 fiches au premier
  // enregistrement, sans que rien ne le montre à l'écran.
  const src = require('../helpers/backendSource').backendSource();
  const debut = src.indexOf('if (action === "update-article"');
  const fin = src.indexOf('if (action === "', debut + 10);
  assert.ok(debut > -1 && fin > debut, 'handler update-article introuvable');
  const h = src.slice(debut, fin);
  assert.match(h, /const allowed = \[[^\]]*"categorie"/, 'la catégorie doit rester modifiable');
  assert.doesNotMatch(h, /normalizeCategorie/, 'update-article ne doit PAS normaliser la casse');
  assert.doesNotMatch(h, /categorie[^\n]*toLowerCase/);
});

test('le module est importé par la fiche article (sinon le select serait vide)', () => {
  assert.match(SRC, /^import \* as ArticleCategories from '\.\.\/shared\/lib\/articleCategories\.js';/m);
});
