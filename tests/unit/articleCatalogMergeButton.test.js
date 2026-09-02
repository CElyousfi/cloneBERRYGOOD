'use strict';

/*
 * Bouton « Fusionner doublons » de Stock › Articles (public/app.jsx).
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────
 * Le bouton était conditionné à `currentProfile === 'achats'`. Personne
 * n'utilise ce profil : côté écran, l'outil de fusion n'existait tout
 * simplement pas, et les ~105 paires de doublons du catalogue sont restées
 * avec leurs prix dispersés entre fiches jumelles.
 *
 * ── CE QUI EST RÉELLEMENT TESTÉ ────────────────────────────────────────────
 * Pas un miroir recopié (il dériverait en silence), mais le SOURCE de
 * `public/app.jsx` : la déclaration du drapeau ET le bloc JSX du bouton sont
 * EXTRAITS du fichier, babélisés, puis RENDUS pour trois profils. Le monolithe
 * n'est pas requérable (React CDN, 53 k lignes) — cette extraction est le seul
 * moyen d'exercer le vrai code sans le dupliquer.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - bouton affiché à tous les profils (drapeau à `true`, ou retrait du
 *    `{drapeau && (` autour du bouton → l'extraction échoue) ;
 *  - retour à `achats` seul → le cas `dg` tombe.
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

/** Déclaration du drapeau, sous le commentaire de section. */
function extraireDeclaration() {
  const m = SRC.match(/\/\/ --- Fusion de doublons ---\s*\n\s*(const (\w+) = ([^\n;]+);)/);
  assert.ok(m, 'déclaration du drapeau de fusion introuvable dans public/app.jsx');
  return { ligne: m[1], nom: m[2], expression: m[3] };
}

/**
 * Bloc JSX du bouton, garde comprise. Si le bouton n'est plus enveloppé dans
 * un `{<drapeau> && (`, ce match échoue — c'est voulu : un bouton rendu sans
 * condition serait visible de TOUS les profils, y compris le magasinier.
 */
function extraireBloc() {
  const re = /\{(\w+) && \(\s*\n\s*<button onClick=\{loadDuplicates\}/;
  const m = SRC.match(re);
  assert.ok(m, 'le bouton « Fusionner doublons » n’est plus gardé par un drapeau de profil');
  const debut = m.index;
  const iFin = SRC.indexOf('</button>', debut);
  assert.notEqual(iFin, -1, 'fin du bouton introuvable');
  const iBloc = SRC.indexOf(')}', iFin);
  assert.notEqual(iBloc, -1, 'fermeture de la garde introuvable');
  const jsx = SRC.slice(debut, iBloc + 2);
  assert.match(jsx, /Fusionner doublons/, 'le bloc extrait n’est pas celui du bouton de fusion');
  return { jsx, nomGarde: m[1] };
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

/** Rend le bloc EXTRAIT pour un profil donné et renvoie les boutons de fusion. */
function rendrePourProfil(profil) {
  const decl = extraireDeclaration();
  const bloc = extraireBloc();
  assert.strictEqual(
    bloc.nomGarde,
    decl.nom,
    'le bouton doit être gardé par le drapeau déclaré juste au-dessus (' + decl.nom + ')'
  );
  const source = 'window.__rendreFusion = function (currentProfile) {\n'
    + '  var loadDuplicates = function () {};\n'
    + '  ' + decl.ligne + '\n'
    + '  return (<div>' + bloc.jsx + '</div>);\n'
    + '};\n';
  const code = babel.transformSync(source, {
    presets: [require.resolve('@babel/preset-react')],
    filename: 'extrait-app.jsx', babelrc: false, configFile: false,
  }).code;
  const sandbox = { window: {}, console };
  sandbox.window.React = { createElement, Fragment: 'Fragment' };
  sandbox.React = sandbox.window.React;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  const tree = sandbox.window.__rendreFusion(profil);
  return collect(tree, (n) => n.type === 'button' && /Fusionner doublons/.test(textOf(n)));
}

// ── tests ──────────────────────────────────────────────────────────────────

test('dg — le bouton « Fusionner doublons » est RENDU (c’est tout l’objet du ticket)', () => {
  assert.strictEqual(rendrePourProfil('dg').length, 1, 'le DG doit voir le bouton de fusion');
});

test('achats — le bouton reste rendu (capacité historique, non retirée)', () => {
  assert.strictEqual(rendrePourProfil('achats').length, 1);
});

test('magasinier — AUCUN bouton de fusion', () => {
  // Montrer un bouton qui rendra 403 est pire que ne rien montrer : le serveur
  // refuse ce profil (peutFusionnerArticles), l'écran doit dire la même chose.
  assert.strictEqual(rendrePourProfil('magasinier').length, 0);
});

test('les autres profils non plus', () => {
  for (const p of ['finance', 'chef_f1', 'rh', 'audit_interne', '', null, undefined]) {
    assert.strictEqual(rendrePourProfil(p).length, 0, 'profil ' + String(p));
  }
});

test('le clic déclenche bien le chargement des doublons', () => {
  // Sans cela, le bouton pourrait être visible ET inerte : le test de présence
  // passerait pour une raison sans rapport avec l'usage réel.
  const [btn] = rendrePourProfil('dg');
  assert.strictEqual(typeof btn.props.onClick, 'function');
});

test('l’écran et le serveur autorisent EXACTEMENT la même population', () => {
  // Une divergence produirait soit un bouton qui rend 403, soit une capacité
  // serveur invisible — c'est-à-dire précisément le bug de ce ticket.
  const { peutFusionnerArticles } = require('../../functions/lib/stockRoles');
  for (const p of ['dg', 'achats', 'magasinier', 'finance', 'chef_f1', '', null, undefined]) {
    assert.strictEqual(
      rendrePourProfil(p).length === 1,
      peutFusionnerArticles(p).ok,
      'divergence écran/serveur sur le profil ' + String(p)
    );
  }
});
