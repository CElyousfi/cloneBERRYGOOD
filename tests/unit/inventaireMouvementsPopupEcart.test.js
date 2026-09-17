'use strict';

/*
 * inventaireMouvementsPopupEcart.test.js
 *
 * ── POURQUOI ───────────────────────────────────────────────────────────────
 * Quand le grand livre ne rend AUCUN mouvement, la pop-up court-circuitait sur
 * « Aucun mouvement pour cet article au lieu F2 » et masquait l'écart pourtant
 * déjà calculé. Le magasinier voyait 10 852,8 kg sur sa ligne d'inventaire et un
 * écran vide en face : il en concluait que son stock était faux. Il ne l'est
 * pas — c'est son détail qui manque (stock d'ouverture écrit directement dans
 * stock_balances, sans écriture en face dans stock_movements).
 *
 * Le composant est rendu POUR DE VRAI (source babélisé dans un sandbox vm),
 * comme le fait le navigateur.
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - retour au simple « Aucun mouvement … » quand la liste est vide ;
 *  - phrase de provenance rendue inconditionnellement (même solde nul) ;
 *  - vocabulaire d'erreur (« incohérence », « erreur ») au lieu de la provenance.
 */

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
function walk(node, out) {
  out = out || [];
  if (!node || typeof node !== 'object') return out;
  out.push(node);
  (node.children || []).forEach((c) => walk(c, out));
  return out;
}
function flatText(node) {
  return walk(node)
    .flatMap((n) => (n.children || []).filter((c) => typeof c === 'string' || typeof c === 'number').map(String))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Charge le composant et le rend avec l'état `state` (retour de l'API déjà
 * résolu : on court-circuite le useState/useEffect comme le fait le harnais des
 * autres tests de composants).
 */
function rendre(props, state) {
  const sandbox = {
    window: {},
    Date, Math, JSON, parseFloat, isFinite, encodeURIComponent, console,
    fetch: function () { return new Promise(function () {}); },
  };
  sandbox.window.React = {
    createElement,
    useState: function () { return [state, function () {}]; },
    useEffect: function () {},
  };
  vm.createContext(sandbox);
  const Popup = loadComponent('src/modules/magasin/InventaireMouvementsPopup.jsx', sandbox).InventaireMouvementsPopup;
  assert.ok(Popup, 'window.InventaireMouvementsPopup non exposé');
  return Popup(props);
}

const VIDE = { loading: false, error: null, data: { success: true, article: { ref: 'ACIDE PHOSPHORIQUE', nom: 'ACIDE PHOSPHORIQUE', unite: 'kg' }, entries: [] } };

const PROPS = {
  article: 'ACIDE PHOSPHORIQUE',
  article_nom: 'ACIDE PHOSPHORIQUE',
  lieu_id: 'F2',
  unite: 'kg',
  dateInventaire: '2026-08-30',
  soldeAttendu: 10852.8,
  onClose: function () {},
};

test('liste vide + solde : l’écran dit le solde et D’OÙ il vient', () => {
  const texte = flatText(rendre(PROPS, VIDE));
  assert.match(texte, /Aucun mouvement pour cet article au lieu F2/);
  // Le solde de la ligne d'inventaire est rappelé, avec son unité.
  assert.match(texte, /10\s?852,80 kg en stock/, 'le solde doit être rappelé quand la liste est vide');
  assert.match(texte, /aucun mouvement enregistré/);
  assert.match(texte, /provient de l’inventaire d’ouverture, non détaillé dans le grand livre/);
});

test('la formulation ne traite jamais le solde d’erreur ni d’incohérence', () => {
  const texte = flatText(rendre(PROPS, VIDE));
  assert.doesNotMatch(texte, /erreur/i, 'le solde est juste : ne pas parler d’erreur');
  assert.doesNotMatch(texte, /incohéren/i);
  assert.doesNotMatch(texte, /faux|anomalie/i);
});

test('liste vide SANS solde : aucune phrase de provenance fabriquée', () => {
  const texte = flatText(rendre(Object.assign({}, PROPS, { soldeAttendu: 0 }), VIDE));
  assert.match(texte, /Aucun mouvement pour cet article/);
  assert.doesNotMatch(texte, /inventaire d’ouverture/, 'rien à expliquer quand le solde est nul');
});

test('liste vide, solde NÉGATIF : aucune provenance affirmée', () => {
  // Un inventaire d'ouverture ne produit JAMAIS un solde négatif. Affirmer
  // « −9 000 kg proviennent de l'inventaire d'ouverture » est une affirmation
  // fausse — pire qu'un écran vide. Cas réels : ligne en rupture (balance <= 0,
  // comptée par app.jsx) et soldes négatifs de lieu `fournisseur` produits par
  // get-balances-at-date, que rien ne filtre à l'affichage.
  const texte = flatText(rendre(Object.assign({}, PROPS, { soldeAttendu: -9000 }), VIDE));
  assert.match(texte, /Aucun mouvement pour cet article au lieu F2/);
  assert.doesNotMatch(texte, /inventaire d’ouverture/, 'pas de provenance sur un solde négatif');
  assert.doesNotMatch(texte, /en stock/, 'ne pas annoncer un stock négatif comme un stock');
});

test('liste vide, solde inconnu (prop absente) : pas de phrase', () => {
  const props = Object.assign({}, PROPS);
  delete props.soldeAttendu;
  const texte = flatText(rendre(props, VIDE));
  assert.doesNotMatch(texte, /inventaire d’ouverture/);
});

test('avec mouvements : le tableau et le pied de page restent inchangés', () => {
  const state = {
    loading: false, error: null,
    data: {
      success: true,
      article: { ref: 'ACIDE PHOSPHORIQUE', nom: 'ACIDE PHOSPHORIQUE', unite: 'kg' },
      entries: [
        { date: '2026-01-01', numero: 'BR-100', type: 'reception', lieu_id: 'F2', lieu_type: 'magasin', sens: 'entree', quantite: 1000, unite: 'kg' },
        { date: '2026-02-01', numero: 'BR-101', type: 'reception', lieu_id: 'F2', lieu_type: 'magasin', sens: 'entree', quantite: 852.8, unite: 'kg' },
      ],
    },
  };
  const texte = flatText(rendre(PROPS, state));
  assert.match(texte, /2 mouvement\(s\)/);
  assert.match(texte, /Solde final : 1\s?852,80 kg/);
  // cumul 1852,8 vs solde attendu 10852,8 → écart affiché comme avant.
  assert.match(texte, /écart inventaire −?-?9\s?000,00/);
  assert.doesNotMatch(texte, /inventaire d’ouverture/, 'la phrase de provenance est réservée à la liste vide');
});
