'use strict';

/*
 * Pop-up « Fusionner des articles en doublon » — CHOIX DU MASTER (public/app.jsx).
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────
 * La pop-up n'affichait ni prix ni nombre d'achats, et présélectionnait
 * `g.articles[0]` — c'est-à-dire un ordre d'itération Firestore. Or
 * `merge-articles` ne transfère NI `prix_pmp`, NI `prix_ht`, NI `nb_achats`
 * du doublon vers le maître : un maître choisi au hasard laisse un article
 * actif NON VALORISABLE (VERTIMEC, APOLLO 50 SC, MILBEKNOCK, PRIORI TOP).
 *
 * ── CE QUI EST RÉELLEMENT TESTÉ ────────────────────────────────────────────
 * Pas un miroir recopié (il dériverait en silence) mais le SOURCE de
 * `public/app.jsx` : `loadDuplicates` et le bloc JSX du groupe sont EXTRAITS
 * du fichier, babélisés, puis EXÉCUTÉS. Le monolithe n'est pas requérable
 * (React CDN, 53 k lignes) — même stratégie que articleCatalogMergeButton.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - retour à `g.articles[0]` comme présélection ;
 *  - fail-closed retiré (un groupe indécidable retombe sur une fiche) ;
 *  - prix ou nombre d'achats retirés de l'affichage.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const babel = require('@babel/core');

const ROOT = path.join(__dirname, '../..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/app.jsx'), 'utf8');

// ── extraction depuis le source de prod ────────────────────────────────────

/**
 * Bloc délimité par une ligne d'ouverture et sa ligne de fermeture DE MÊME
 * INDENTATION. Le comptage d'accolades serait piégé par les apostrophes du
 * texte JSX (« l'article ») ; l'indentation, elle, est vérifiable.
 */
function extraireBloc(ouverture, fermeture) {
  const lignes = SRC.split('\n');
  const iDebut = lignes.findIndex((l) => l.trim() === ouverture);
  assert.notEqual(iDebut, -1, 'ligne d’ouverture introuvable : ' + ouverture);
  const indent = lignes[iDebut].match(/^\s*/)[0];
  let iFin = -1;
  for (let i = iDebut + 1; i < lignes.length; i++) {
    if (lignes[i] === indent + fermeture) { iFin = i; break; }
  }
  assert.notEqual(iFin, -1, 'ligne de fermeture introuvable : ' + fermeture);
  return lignes.slice(iDebut, iFin + 1).join('\n');
}

function extraireLoadDuplicates() {
  return extraireBloc('const loadDuplicates = () => {', '};');
}

function extraireBlocGroupe() {
  const bloc = extraireBloc('{mergeGroups.map(group => {', '})}');
  assert.match(bloc, /group\.articles\.map/, 'le bloc extrait n’est pas celui des groupes');
  return bloc;
}

function babeliser(source) {
  return babel.transformSync(source, {
    presets: [require.resolve('@babel/preset-react')],
    filename: 'extrait-app.jsx',
    babelrc: false,
    configFile: false,
  }).code;
}

// ── faux React (pas de RTL dans ce repo : pas de bundler) ──────────────────

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

function textOf(node) {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return (node.children || []).map(textOf).join('');
}

// ── exécution de loadDuplicates avec un faux serveur ───────────────────────

/**
 * Rejoue `loadDuplicates` du source contre une réponse serveur donnée.
 * @param {Array<*>} groups groupes tels que renvoyés par suggest-article-duplicates
 * @returns {Promise<{masters: Object, groups: Array<*>, url: string}>}
 */
async function chargerDoublons(groups) {
  const source =
    'window.__load = function (groups, sink) {\n' +
    '  var currentProfile = "dg";\n' +
    '  var setShowMerge = function () {};\n' +
    '  var setMergeLoading = function () {};\n' +
    '  var setMergePreview = function () {};\n' +
    '  var setMergeGroups = function (g) { sink.groups = g; };\n' +
    '  var setMergeMasters = function (m) { sink.masters = m; };\n' +
    // État de la fusion EN MASSE : `loadDuplicates` doit le remettre à zéro à
    // chaque rechargement, sinon un lot chiffré resterait exécutable sur des
    // groupes qui n'existent plus.
    '  var setMergeSelection = function (s) { sink.selection = s; };\n' +
    '  var setMergeApercu = function (a) { sink.apercu = a; };\n' +
    '  var setMergeProgress = function (p) { sink.progress = p; };\n' +
    '  var setMergeRapport = function (r) { sink.rapport = r; };\n' +
    '  var alert = function (m) { sink.alert = m; };\n' +
    '  var fetch = function (url) {\n' +
    '    sink.url = url;\n' +
    '    return Promise.resolve({ json: function () { return Promise.resolve({ success: true, groups: groups }); } });\n' +
    '  };\n' +
    extraireLoadDuplicates() + '\n' +
    '  return loadDuplicates();\n' +
    '};\n';
  const sandbox = { window: {}, console, Promise, encodeURIComponent };
  vm.createContext(sandbox);
  vm.runInContext(babeliser(source), sandbox);
  const sink = {};
  sandbox.window.__load(groups, sink);
  // La chaîne .then/.finally se résout en microtâches.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  // Les objets nés dans le contexte vm ont un autre Object.prototype :
  // on les ramène dans ce réalm pour que deepStrictEqual compare la VALEUR.
  return {
    masters: JSON.parse(JSON.stringify(sink.masters === undefined ? null : sink.masters)),
    groups: sink.groups ? Array.from(sink.groups) : sink.groups,
    url: sink.url,
    alert: sink.alert,
  };
}

// ── exécution de previewMerge / executeMerge avec un faux serveur ──────────

/**
 * Rejoue `previewMerge` ou `executeMerge` du source et capture ce qui part
 * RÉELLEMENT au serveur. C'est le seul moyen de voir si l'écran adresse par
 * docId ou par le champ `reference`.
 * @param {('previewMerge'|'executeMerge')} nom
 * @param {*} group @param {Object} masters @param {boolean} confirme
 * @returns {Promise<{corps: *, alerte: string, confirme: string}>}
 */
async function lancerFusion(nom, group, masters, confirme) {
  const bloc = extraireBloc('const ' + nom + ' = (group) => {', '};');
  const source =
    'window.__fusion = function (group, mergeMasters, sink, confirme) {\n' +
    '  var setMergeBusy = function () {};\n' +
    '  var setMergePreview = function () {};\n' +
    '  var load = function () {};\n' +
    '  var loadDuplicates = function () {};\n' +
    '  var actor = function () { return { uid: "dg" }; };\n' +
    '  var alert = function (m) { sink.alerte = m; };\n' +
    '  var confirm = function (m) { sink.confirme = m; return confirme; };\n' +
    '  var fetch = function (url, opts) {\n' +
    '    sink.url = url;\n' +
    '    sink.corps = JSON.parse(opts.body);\n' +
    '    return Promise.resolve({ json: function () { return Promise.resolve({ success: true, preview: {}, counts: {} }); } });\n' +
    '  };\n' +
    bloc + '\n' +
    '  return ' + nom + '(group);\n' +
    '};\n';
  const sandbox = { window: {}, console, Promise, JSON };
  vm.createContext(sandbox);
  vm.runInContext(babeliser(source), sandbox);
  const sink = {};
  sandbox.window.__fusion(group, masters || {}, sink, confirme !== false);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return {
    corps: sink.corps ? JSON.parse(JSON.stringify(sink.corps)) : null,
    alerte: sink.alerte,
    confirme: sink.confirme,
  };
}

// ── rendu du bloc d'un groupe ──────────────────────────────────────────────

/**
 * Rend le bloc JSX EXTRAIT pour un groupe et une présélection donnés.
 * @param {*} group @param {Object} masters normalized -> master_ref
 */
function rendreGroupe(group, masters) {
  const source =
    'window.__rendre = function (mergeGroups, mergeMasters) {\n' +
    '  var mergePreview = null;\n' +
    '  var mergeBusy = false;\n' +
    '  var setMergeMasters = function () {};\n' +
    '  var setMergePreview = function () {};\n' +
    '  var previewMerge = function () {};\n' +
    '  var executeMerge = function () {};\n' +
    // Fusion en masse : la case à cocher du groupe lit la logique pure.
    '  var mergeSelection = {};\n' +
    '  var basculerSelection = function () {};\n' +
    '  var FM = window.FusionMasse;\n' +
    '  return (<div>' + extraireBlocGroupe() + '</div>);\n' +
    '};\n';
  const sandbox = { window: {}, console, isFinite, parseFloat };
  sandbox.window.FusionMasse = require('../../public/lib/fusionMasse.js');
  sandbox.window.React = { createElement, Fragment: 'Fragment' };
  sandbox.React = sandbox.window.React;
  vm.createContext(sandbox);
  vm.runInContext(babeliser(source), sandbox);
  return sandbox.window.__rendre([group], masters || {});
}

/** Les <label> de choix (une par fiche du groupe). */
function lignesFiches(tree) {
  return collect(tree, (n) => n.type === 'label');
}

/** Le radio d'une ligne. */
function radioDe(ligne) {
  return collect(ligne, (n) => n.type === 'input' && n.props.type === 'radio')[0];
}

// ── fixtures ───────────────────────────────────────────────────────────────

// ⚠️ `id` (docId) et `reference` DIVERGENT dans toutes les fixtures, comme sur
// les 92 fiches de production concernées : un fixture où les deux coïncident
// ne verrait pas l'écran adresser la mauvaise clé.
const GROUPE_DECIDABLE = {
  normalized: 'vertimec',
  master_suggere: 'AVEC_PRIX',
  decidable: true,
  raison: 'seule fiche à porter un PMP — 38,25 DH',
  articles: [
    { id: 'SANS_PRIX', reference: 'SANS PRIX', nom: 'Vertimec', categorie: 'phyto', unite: 'L', prix_pmp: null, prix_ht: null, nb_achats: 0 },
    { id: 'AVEC_PRIX', reference: 'AVEC PRIX', nom: 'VERTIMEC', categorie: 'Phyto', unite: 'L', prix_pmp: 38.25, prix_ht: 40, nb_achats: 6 },
  ],
};

const GROUPE_INDECIDABLE = {
  normalized: 'gib 3',
  master_suggere: null,
  decidable: false,
  raison: 'aucune fiche ne porte de prix ni d\'historique d\'achats — à choisir manuellement',
  articles: [
    { id: 'PREMIERE', reference: 'PREMIERE', nom: 'GIB 3', categorie: 'Phyto', unite: 'L', prix_pmp: null, prix_ht: null, nb_achats: null },
    { id: 'SECONDE', reference: 'SECONDE', nom: 'gib 3', categorie: 'phyto', unite: 'L', prix_pmp: null, prix_ht: null, nb_achats: null },
  ],
};

/**
 * Cas « magical », mesuré en production : la vraie fiche a le docId `ENG0150`
 * et le champ `reference` « ENG 0150 » (espacé) ; un document FANTÔME sans nom
 * ni `active`, ne portant qu'un prix_ht, existe à `ENG 0150`. Adresser la
 * fusion par `reference` l'exécute sur le fantôme : libellés de BDC et de
 * mouvements vidés, vraie fiche laissée active.
 */
const GROUPE_MAGICAL = {
  normalized: 'magical',
  master_suggere: 'ENG0150',
  decidable: true,
  raison: 'seule fiche à porter un PMP — 107,95 DH',
  articles: [
    { id: 'ENG0151', reference: 'ENG 0151', nom: 'Magical', categorie: 'engrais', unite: 'L', prix_pmp: null, prix_ht: null, nb_achats: 5 },
    { id: 'ENG0150', reference: 'ENG 0150', nom: 'MAGICAL', categorie: 'Engrais', unite: 'L', prix_pmp: 107.95, prix_ht: null, nb_achats: 0 },
  ],
};

// ── 1. PRÉSÉLECTION ────────────────────────────────────────────────────────

test('la présélection est le master SUGGÉRÉ, pas la première fiche du tableau', async () => {
  const sink = await chargerDoublons([GROUPE_DECIDABLE]);
  assert.deepStrictEqual(sink.masters, { vertimec: 'AVEC_PRIX' });
  // Le bug d'origine : `g.articles[0].reference`. La fixture met exprès la
  // fiche SANS prix en première position — si le repli revenait, c'est elle
  // qui serait présélectionnée, et l'article deviendrait non valorisable.
  assert.notStrictEqual(sink.masters.vertimec, GROUPE_DECIDABLE.articles[0].id);
  assert.notStrictEqual(sink.masters.vertimec, GROUPE_DECIDABLE.articles[0].reference);
});

test('groupe INDÉCIDABLE : aucune présélection (fail-closed)', async () => {
  const sink = await chargerDoublons([GROUPE_INDECIDABLE]);
  assert.deepStrictEqual(sink.masters, {}, 'aucun maître ne doit être proposé');
  assert.strictEqual(sink.masters['gib 3'], undefined);
});

test('un groupe indécidable ne contamine pas les groupes décidables', async () => {
  const sink = await chargerDoublons([GROUPE_INDECIDABLE, GROUPE_DECIDABLE]);
  assert.deepStrictEqual(sink.masters, { vertimec: 'AVEC_PRIX' });
  assert.strictEqual((sink.groups || []).length, 2, 'les deux groupes restent affichés');
});

test('`decidable:false` suffit à interdire la présélection, même avec un master_suggere', () => {
  // Garde-fou de cohérence : si un jour le serveur renvoyait les deux, l'écran
  // doit suivre le drapeau, pas la référence.
  return chargerDoublons([
    Object.assign({}, GROUPE_INDECIDABLE, { master_suggere: 'PREMIERE' }),
  ]).then((sink) => {
    assert.deepStrictEqual(sink.masters, {});
  });
});

test('loadDuplicates interroge bien l’action de suggestion', async () => {
  const sink = await chargerDoublons([]);
  assert.match(sink.url, /action=suggest-article-duplicates/);
});

// ── 2. AFFICHAGE DES DONNÉES DE DÉCISION ───────────────────────────────────

test('le PRIX de chaque fiche est affiché (PMP prioritaire), ou un tiret', () => {
  const tree = rendreGroupe(GROUPE_DECIDABLE, { vertimec: 'AVEC_PRIX' });
  const [sansPrix, avecPrix] = lignesFiches(tree);
  // 38,25 = le PMP, pas le prix HT (40) : afficher le mauvais montant
  // conduirait Omar à valider un choix sur une donnée fausse.
  assert.match(textOf(avecPrix), /38,25 DH/);
  assert.doesNotMatch(textOf(avecPrix), /40,00 DH/);
  assert.match(textOf(sansPrix), /—\s*DH/, 'une fiche sans prix doit afficher un tiret');
});

test('le repli prix HT est affiché quand il n’y a pas de PMP', () => {
  const g = {
    normalized: 'x', decidable: true, master_suggere: 'B', raison: 'r',
    articles: [
      { reference: 'A', nom: 'X', prix_pmp: null, prix_ht: null, nb_achats: 0 },
      { reference: 'B', nom: 'X', prix_pmp: 0, prix_ht: 12.5, nb_achats: 0 },
    ],
  };
  const [, b] = lignesFiches(rendreGroupe(g, { x: 'B' }));
  assert.match(textOf(b), /12,50 DH/);
  assert.match(textOf(b), /HT/);
});

test('le NOMBRE D’ACHATS de chaque fiche est affiché', () => {
  const tree = rendreGroupe(GROUPE_DECIDABLE, { vertimec: 'AVEC_PRIX' });
  const [sansPrix, avecPrix] = lignesFiches(tree);
  assert.match(textOf(avecPrix), /6 achats/);
  assert.match(textOf(sansPrix), /0 achat/);
});

test('la RAISON de la suggestion est affichée à l’écran', () => {
  const tree = rendreGroupe(GROUPE_DECIDABLE, { vertimec: 'AVEC_PRIX' });
  const texte = textOf(tree);
  assert.ok(
    texte.includes(GROUPE_DECIDABLE.raison),
    'la raison du serveur doit être affichée telle quelle : ' + texte
  );
  assert.match(texte, /AVEC_PRIX/);
});

test('groupe INDÉCIDABLE : message d’arbitrage, aucun radio coché', () => {
  const tree = rendreGroupe(GROUPE_INDECIDABLE, {});
  const texte = textOf(tree);
  assert.ok(texte.includes(GROUPE_INDECIDABLE.raison), 'la raison du refus doit être affichée');
  assert.match(texte, /Choisissez vous-même/);
  for (const ligne of lignesFiches(tree)) {
    assert.strictEqual(radioDe(ligne).props.checked, false, 'aucune fiche présélectionnée');
  }
});

test('sans docId servi et sans présélection, AUCUN radio n’est coché', () => {
  // Réponse d'un serveur plus ancien (ou cache) : `id` absent partout. Sans la
  // garde `!!masterRef`, `undefined === undefined` cocherait TOUTES les lignes,
  // et le groupe indécidable aurait l'air arbitré.
  const g = {
    normalized: 'x', decidable: false, master_suggere: null, raison: 'aucune donnée — à choisir manuellement',
    articles: [
      { reference: 'A', nom: 'X', prix_pmp: null, prix_ht: null, nb_achats: null },
      { reference: 'B', nom: 'X', prix_pmp: null, prix_ht: null, nb_achats: null },
    ],
  };
  const lignes = lignesFiches(rendreGroupe(g, {}));
  assert.strictEqual(lignes.length, 2);
  for (const ligne of lignes) {
    assert.strictEqual(radioDe(ligne).props.checked, false, 'aucune ligne ne doit être cochée');
  }
  assert.doesNotMatch(textOf(lignes[0]), /MASTER/);
});

test('le radio coché est celui du master, les autres non', () => {
  const lignes = lignesFiches(rendreGroupe(GROUPE_DECIDABLE, { vertimec: 'AVEC_PRIX' }));
  assert.strictEqual(radioDe(lignes[0]).props.checked, false);
  assert.strictEqual(radioDe(lignes[1]).props.checked, true);
  assert.match(textOf(lignes[1]), /MASTER/);
});

test('Omar garde la main : chaque fiche reste sélectionnable', () => {
  const lignes = lignesFiches(rendreGroupe(GROUPE_DECIDABLE, { vertimec: 'AVEC_PRIX' }));
  for (const ligne of lignes) {
    assert.strictEqual(typeof radioDe(ligne).props.onChange, 'function');
  }
});

test('une fiche NON retenue qui porte un prix ou des achats est signalée', () => {
  // Ne devrait pas arriver d'après la mesure sur les 105 groupes — mais si ça
  // arrive, la donnée doit se VOIR plutôt que se perdre en silence.
  const lignes = lignesFiches(rendreGroupe(GROUPE_DECIDABLE, { vertimec: 'SANS_PRIX' }));
  const nonRetenue = lignes[1]; // AVEC_PRIX, devenue doublon
  assert.match(textOf(nonRetenue), /perdus/, 'la perte de prix/achats doit être signalée');
  const anodine = lignes[0];
  assert.doesNotMatch(textOf(anodine), /perdus/);
});

test('chaque moitié de l’alerte compte : prix SEUL et achats SEULS', () => {
  // La fixture précédente donne au doublon un prix ET des achats : chaque
  // moitié du `||` couvrait l'autre, et supprimer l'une restait vert.
  const g = {
    normalized: 'x', decidable: true, master_suggere: 'MASTER', raison: 'r',
    articles: [
      { id: 'MASTER', reference: 'M', nom: 'X', prix_pmp: 5, prix_ht: null, nb_achats: 2 },
      { id: 'ACHATS_SEULS', reference: 'A', nom: 'X', prix_pmp: null, prix_ht: null, nb_achats: 3 },
      { id: 'PRIX_SEUL', reference: 'P', nom: 'X', prix_pmp: null, prix_ht: 12, nb_achats: 0 },
      { id: 'RIEN', reference: 'R', nom: 'X', prix_pmp: null, prix_ht: null, nb_achats: 0 },
    ],
  };
  const [master, achatsSeuls, prixSeul, rien] = lignesFiches(rendreGroupe(g, { x: 'MASTER' }));
  assert.match(textOf(achatsSeuls), /perdus/, 'un doublon avec des achats SEULS doit alerter');
  assert.match(textOf(prixSeul), /perdus/, 'un doublon avec un prix SEUL doit alerter');
  assert.doesNotMatch(textOf(rien), /perdus/, 'un doublon sans donnée n’alerte pas');
  assert.doesNotMatch(textOf(master), /perdus/, 'le master ne perd rien');
});

// ── 3. ADRESSAGE : docId, jamais le champ `reference` ──────────────────────

test('la présélection porte le docId, pas la référence espacée (cas « magical »)', async () => {
  const sink = await chargerDoublons([GROUPE_MAGICAL]);
  assert.deepStrictEqual(sink.masters, { magical: 'ENG0150' });
  // « ENG 0150 » est un document FANTÔME réel, sans nom ni `active`.
  assert.notStrictEqual(sink.masters.magical, 'ENG 0150');
});

test('previewMerge envoie les docId — master ET doublons', async () => {
  const r = await lancerFusion('previewMerge', GROUPE_MAGICAL, { magical: 'ENG0150' });
  assert.strictEqual(r.corps.master_ref, 'ENG0150');
  assert.deepStrictEqual(r.corps.doublon_refs, ['ENG0151']);
  assert.strictEqual(r.corps.mode, 'preview');
  // Aucune référence espacée ne doit partir : le serveur résout par .doc().
  const envoye = [r.corps.master_ref].concat(r.corps.doublon_refs);
  for (const ref of envoye) {
    assert.doesNotMatch(ref, /\s/, 'référence espacée envoyée au serveur : ' + ref);
  }
});

test('executeMerge envoie les mêmes docId que previewMerge', async () => {
  // Une divergence entre les deux ferait valider une fusion puis en exécuter
  // une autre — la prévisualisation ne prouverait plus rien.
  const p = await lancerFusion('previewMerge', GROUPE_MAGICAL, { magical: 'ENG0150' });
  const e = await lancerFusion('executeMerge', GROUPE_MAGICAL, { magical: 'ENG0150' });
  assert.strictEqual(e.corps.master_ref, p.corps.master_ref);
  assert.deepStrictEqual(e.corps.doublon_refs, p.corps.doublon_refs);
  assert.strictEqual(e.corps.mode, 'execute');
});

test('le doublon envoyé est le docId de l’AUTRE fiche, jamais celui du master', async () => {
  const r = await lancerFusion('previewMerge', GROUPE_DECIDABLE, { vertimec: 'AVEC_PRIX' });
  assert.deepStrictEqual(r.corps.doublon_refs, ['SANS_PRIX']);
  assert.strictEqual(r.corps.doublon_refs.includes(r.corps.master_ref), false);
});

// ── 4. GARDES : rien ne part sans master ───────────────────────────────────

test('previewMerge REFUSE de partir sans master (groupe indécidable)', async () => {
  const r = await lancerFusion('previewMerge', GROUPE_INDECIDABLE, {});
  assert.strictEqual(r.corps, null, 'aucun appel serveur ne doit partir');
  assert.match(r.alerte, /Sélectionnez un master/);
});

test('executeMerge REFUSE de partir sans master, AVANT le confirm()', async () => {
  // Depuis le fail-closed, masterRef undefined est un état légitime : sans
  // garde, le confirm() annoncerait « fusion dans « undefined » ».
  const r = await lancerFusion('executeMerge', GROUPE_INDECIDABLE, {});
  assert.strictEqual(r.corps, null, 'aucun appel serveur ne doit partir');
  assert.strictEqual(r.confirme, undefined, 'aucune confirmation ne doit être demandée');
  assert.match(r.alerte, /Sélectionnez un master/);
});

test('executeMerge ne part pas si Omar annule la confirmation', async () => {
  const r = await lancerFusion('executeMerge', GROUPE_MAGICAL, { magical: 'ENG0150' }, false);
  assert.strictEqual(r.corps, null);
  assert.match(r.confirme, /Confirmer la fusion/);
});
