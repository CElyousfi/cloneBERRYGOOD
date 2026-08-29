'use strict';

/*
 * articleConversionPermissions.test.js — le magasinier peut renseigner la
 * conversion d'unité d'un article, et RIEN D'AUTRE.
 *
 * ── CE QUI EST VERROUILLÉ ICI ──────────────────────────────────────────────
 *  1. `achats` et `dg` gardent l'accès COMPLET, sans aucun bridage par champ.
 *     C'est la leçon du commentaire d'en-tête d'articlePermissions.js : brider
 *     le DG par champ lui rendrait un 403 sur une action qui marchait la
 *     veille, l'écran Stock › Articles envoyant toujours les 11 champs ;
 *  2. le magasinier passe UNIQUEMENT sur `unite_consommation` et
 *     `stock_par_unite_consommation` ;
 *  3. un magasinier qui joint UN SEUL autre champ (prix_ht, nom, catégorie…)
 *     est refusé EN BLOC — pas d'écriture partielle ;
 *  4. la décision se prend sur le CONTENU RÉEL de `updates`, jamais sur une
 *     déclaration du client ;
 *  5. tout autre rôle reste refusé, y compris sur les champs de conversion.
 */

const test = require('node:test');
const assert = require('node:assert');

const stockRoles = require('../index');

const CONVERSION = { unite_consommation: 'L', stock_par_unite_consommation: 1.32 };

// ── 1. LES DROITS EXISTANTS SONT INTACTS ───────────────────────────────────

test('achats et dg gardent l\'accès COMPLET (formulaire entier, 11 champs)', () => {
  const formulaireEntier = {
    nom: 'Acide Nitrique', reference: 'ART-1', reference_technique: '', unite: 'KG',
    prix_ht: 12, taux_tva: 20, prix_ttc: 14.4, categorie: 'Engrais',
    sous_categorie: '', type: 'Stockable', multi_ferme: false,
  };
  for (const role of ['achats', 'dg']) {
    assert.equal(stockRoles.peutModifierChampsArticle(role, formulaireEntier).ok, true, role);
    assert.equal(stockRoles.peutModifierChampsArticle(role, CONVERSION).ok, true, role);
    // Même sans `updates` exploitable : leur droit ne dépend pas du contenu.
    assert.equal(stockRoles.peutModifierChampsArticle(role, {}).ok, true, role);
    assert.equal(stockRoles.peutModifierChampsArticle(role, null).ok, true, role);
  }
});

// ── 2. LE DROIT NOUVEAU DU MAGASINIER ──────────────────────────────────────

test('magasinier — les deux champs de conversion sont acceptés', () => {
  assert.equal(stockRoles.peutModifierChampsArticle('magasinier', CONVERSION).ok, true);
  assert.equal(stockRoles.peutModifierChampsArticle('magasinier', { unite_consommation: 'L' }).ok, true);
  assert.equal(stockRoles.peutModifierChampsArticle('magasinier', { stock_par_unite_consommation: 1.75 }).ok, true);
});

test('magasinier — un champ hors conversion fait échouer TOUTE la requête', () => {
  const interdits = [
    { prix_ht: 0 }, { nom: 'autre' }, { unite: 'L' }, { categorie: 'Engrais' },
    { reference: 'ART-9' }, { active: false }, { taux_tva: 0 }, { multi_ferme: true },
  ];
  for (const champ of interdits) {
    const nom = Object.keys(champ)[0];
    // Seul.
    const seul = stockRoles.peutModifierChampsArticle('magasinier', champ);
    assert.equal(seul.ok, false, nom + ' seul');
    // ET mêlé à une conversion légitime : c'est le cas dangereux, celui du
    // client qui « accompagne » sa conversion d'un prix à zéro.
    const mele = stockRoles.peutModifierChampsArticle('magasinier', Object.assign({}, CONVERSION, champ));
    assert.equal(mele.ok, false, nom + ' mêlé à la conversion');
    assert.match(mele.raison, new RegExp(nom), 'le refus doit NOMMER le champ fautif');
  }
});

test('magasinier — `unite` (unité de STOCK) reste interdite, malgré la ressemblance', () => {
  // Piège de nommage : `unite` et `unite_consommation` ne diffèrent que par un
  // suffixe. Changer l'unité de STOCK réécrirait la base de tous les soldes.
  assert.equal(stockRoles.peutModifierChampsArticle('magasinier', { unite: 'L' }).ok, false);
  assert.equal(stockRoles.peutModifierChampsArticle('magasinier', { unite_consommation: 'L' }).ok, true);
});

test('magasinier — un updates vide n\'ouvre rien', () => {
  for (const vide of [{}, null, undefined, [], 'unite_consommation', 42]) {
    assert.equal(stockRoles.peutModifierChampsArticle('magasinier', vide).ok, false, JSON.stringify(vide));
  }
});

test('magasinier — une clé à `undefined` ne compte pas comme un champ écrit', () => {
  // Le monolithe ignore déjà les clés `undefined` en construisant l'écriture :
  // les compter ici refuserait une requête qui n'écrit rien de plus.
  const u = { unite_consommation: 'L', stock_par_unite_consommation: 1.32, prix_ht: undefined };
  assert.equal(stockRoles.peutModifierChampsArticle('magasinier', u).ok, true);
  assert.deepEqual(stockRoles.champsDemandes(u), ['unite_consommation', 'stock_par_unite_consommation']);
});

// ── 3. LES AUTRES RÔLES ────────────────────────────────────────────────────

test('tout autre rôle reste refusé, même sur les champs de conversion', () => {
  for (const role of ['chef_f1', 'finance', 'rh', 'agronomie', '', null, undefined, 'MAGASINIER']) {
    const v = stockRoles.peutModifierChampsArticle(role, CONVERSION);
    assert.equal(v.ok, false, String(role));
    assert.match(v.raison, /Réservé au responsable achats ou au DG/, String(role));
  }
});

test('la règle historique `peutModifierArticle` n\'a pas bougé', () => {
  // Le nouveau droit passe par une fonction DÉDIÉE : la garde d'origine, qui
  // protège encore classer-article et merge-articles, reste `achats|dg` seuls.
  assert.equal(stockRoles.peutModifierArticle('magasinier').ok, false);
  assert.equal(stockRoles.peutModifierArticle('achats').ok, true);
  assert.equal(stockRoles.peutModifierArticle('dg').ok, true);
});

test('la liste des champs ouverts est explicite et limitée à deux', () => {
  assert.deepEqual(stockRoles.CHAMPS_CONVERSION_UNITE, ['unite_consommation', 'stock_par_unite_consommation']);
});
