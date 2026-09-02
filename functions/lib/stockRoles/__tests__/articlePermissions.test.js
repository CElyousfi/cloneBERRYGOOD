'use strict';

/**
 * Règle de rôle pour l'écriture sur `articles_catalog` : `achats` OU `dg`,
 * accès COMPLET pour les deux. Tout autre rôle refusé.
 *
 * ⚠️ CE QUE CES TESTS NE DOIVENT SURTOUT PAS AFFIRMER : que le `dg` serait
 * bridé à un sous-ensemble de champs. Une version antérieure de ce ticket l'a
 * fait, sur la foi d'une lecture erronée du monolithe (le message d'erreur
 * disait « Réservé au responsable achats » alors que la condition laissait
 * passer le `dg`). Cela aurait cassé Stock › Articles pour le DG, dont le
 * formulaire envoie TOUJOURS les 11 champs. Un test qui verrouille une
 * restriction inexistante est un test qui verrouille un bug.
 *
 * La mutation « retirer la garde » (autoriser tout rôle) doit rendre ce fichier
 * ROUGE.
 */

const test = require('node:test');
const assert = require('node:assert');

const { peutModifierArticle, REFUS } = require('../articlePermissions');

test('dg → AUTORISÉ, accès complet (c\'est le comportement historique)', () => {
  const v = peutModifierArticle('dg');
  assert.strictEqual(v.ok, true, v.raison);
  assert.strictEqual(v.raison, '');
});

test('achats → AUTORISÉ, accès complet', () => {
  assert.strictEqual(peutModifierArticle('achats').ok, true);
});

test('le verdict ne dépend QUE du rôle : aucun champ n\'est refusé à dg ni à achats', () => {
  // Garde anti-régression du bridage écarté : la fonction ne prend pas
  // d'objet `updates` et ne peut donc pas se remettre à trier les champs sans
  // qu'on le voie ici. Le formulaire de Stock › Articles envoie les 11 champs
  // d'un bloc — un tri les ferait tous tomber en 403.
  assert.strictEqual(peutModifierArticle.length, 1, 'signature attendue : (role)');
  for (const role of ['dg', 'achats']) {
    assert.strictEqual(peutModifierArticle(role).ok, true, 'profil ' + role);
  }
});

test('tout autre rôle → REFUSÉ', () => {
  for (const role of ['magasinier', 'chef_f1', 'finance', 'rh', 'audit_interne', '', null, undefined, 42, {}]) {
    const v = peutModifierArticle(role);
    assert.strictEqual(v.ok, false, 'rôle ' + String(role) + ' ne doit pas écrire au catalogue');
    assert.strictEqual(v.raison, REFUS);
  }
});

test('le message de refus nomme les DEUX profils autorisés', () => {
  // L'ancien message (« Réservé au responsable achats ») était faux : le DG
  // passait. C'est ce mensonge qui a fait croire à une garde plus stricte
  // qu'elle ne l'était, et a failli coûter au DG une capacité existante.
  assert.match(REFUS, /achats/);
  assert.match(REFUS, /DG/, 'le DG est autorisé : le message ne doit plus le passer sous silence');
});
