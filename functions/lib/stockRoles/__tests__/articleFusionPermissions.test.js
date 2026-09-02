'use strict';

/**
 * Règle de rôle pour la FUSION de fiches en doublon
 * (`suggest-article-duplicates` / `merge-articles`) : `achats` OU `dg`.
 *
 * POURQUOI CE FICHIER EXISTE : la garde était écrite en dur sur `achats` dans
 * le monolithe. Or personne n'utilise ce profil au quotidien — le DG, oui.
 * Résultat : l'outil de fusion était livré, testé, fonctionnel… et
 * inexécutable en production. Les ~105 paires de doublons du catalogue sont
 * restées, avec leurs prix dispersés entre fiches jumelles (MILBEKNOCK : PMP
 * 1320 DH sur l'une, 0 sur celle que le magasinier saisit).
 *
 * MUTATIONS QUI DOIVENT FAIRE ROUGIR CE FICHIER :
 *  - retirer la garde (tout rôle autorisé) ;
 *  - retirer `dg` de la règle (retour à `achats` seul).
 */

const test = require('node:test');
const assert = require('node:assert');

const { peutFusionnerArticles, peutModifierArticle, REFUS } = require('../articlePermissions');

test('dg → AUTORISÉ à fusionner (c’est tout l’objet du ticket)', () => {
  const v = peutFusionnerArticles('dg');
  assert.strictEqual(v.ok, true, v.raison);
  assert.strictEqual(v.raison, '');
});

test('achats → AUTORISÉ à fusionner (capacité historique, non retirée)', () => {
  assert.strictEqual(peutFusionnerArticles('achats').ok, true);
});

test('tout autre rôle → REFUSÉ', () => {
  for (const role of ['magasinier', 'finance', 'chef_f1', 'rh', 'audit_interne', '', null, undefined, 42, {}]) {
    const v = peutFusionnerArticles(role);
    assert.strictEqual(v.ok, false, 'rôle ' + String(role) + ' ne doit pas fusionner');
    assert.strictEqual(v.raison, REFUS);
  }
});

test('le verdict ne dépend QUE du rôle — aucun autre paramètre', () => {
  // Une garde qui prendrait un second argument (les refs à fusionner, un mode
  // preview/execute…) pourrait se remettre à trier sans qu'on le voie ici.
  assert.strictEqual(peutFusionnerArticles.length, 1, 'signature attendue : (role)');
});

test('même population que l’écriture au catalogue, pour les DEUX bords', () => {
  // Fusionner, c'est écrire au catalogue : le master absorbe prix et soldes,
  // les doublons deviennent des pierres tombales. Aucun profil ne doit pouvoir
  // fusionner sans pouvoir éditer, ni l'inverse. La délégation garantit que
  // les deux droits ne divergent pas PAR ACCIDENT.
  for (const role of ['dg', 'achats', 'magasinier', 'finance', '', null, undefined]) {
    assert.strictEqual(
      peutFusionnerArticles(role).ok,
      peutModifierArticle(role).ok,
      'divergence sur le profil ' + String(role)
    );
  }
});

test('le message de refus nomme les DEUX profils autorisés', () => {
  // L'ancien message (« Seul le responsable achats peut fusionner des
  // articles ») était faux dès lors que le DG passe — et un message faux a
  // déjà induit en erreur sur ce chantier.
  assert.match(REFUS, /achats/);
  assert.match(REFUS, /DG/);
});
