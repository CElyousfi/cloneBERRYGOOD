'use strict';

/**
 * Le référentiel Smart Berry doit être rechargé APRÈS connexion.
 *
 * bootstrap.jsx appelle sbLoad() au boot, avant toute session : la requête part
 * sans jeton et reçoit 401 (sb-referentiel-list est exemptée du 403 de profil,
 * pas de l'authentification). L'échec est avalé. Si rien ne rejoue l'appel une
 * fois l'utilisateur connecté, window.SB_PARCELLE_REF reste vide toute la
 * session — libellés BEE ONE bruts partout, parcelles à culture divergente
 * invisibles sous un filtre Culture (cas du bon de consommation).
 *
 * Test de câblage sur la source, comme les autres tests de ce dossier : on
 * vérifie que l'appel vit bien DANS la branche `if (user)` du listener d'auth,
 * pas ailleurs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/modules/shared/App.jsx'), 'utf8');

test('App.jsx importe sbLoad', () => {
  assert.match(src, /import \{ sbLoad \} from '\.\/sbLoad\.jsx';/);
});

test('sbLoad() est rejoué dans la branche connectée de onAuthStateChanged', () => {
  const i = src.indexOf('firebaseAuth.onAuthStateChanged(async (user) => {');
  assert.ok(i > 0, 'listener onAuthStateChanged introuvable');
  const ifUser = src.indexOf('if (user) {', i);
  const elseBranch = src.indexOf('} else {', ifUser);
  assert.ok(ifUser > 0 && elseBranch > ifUser, 'structure if (user) / else introuvable');
  const branche = src.slice(ifUser, elseBranch);
  assert.match(branche, /\bsbLoad\(\);/, 'sbLoad() absent de la branche if (user)');
});

test("sbLoad() n'est PAS appelé dans la branche déconnexion", () => {
  const i = src.indexOf('firebaseAuth.onAuthStateChanged(async (user) => {');
  const elseBranch = src.indexOf('} else {', i);
  const fin = src.indexOf('setAuthLoading(false);', elseBranch);
  assert.doesNotMatch(src.slice(elseBranch, fin), /\bsbLoad\(/);
});
