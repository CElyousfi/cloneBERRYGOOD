'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { canManagePrimes, forbiddenReason } = require('../../functions/lib/primes/primesAccess.js');

// ---------------------------------------------------------------------------
// canManagePrimes — LE TEST SÉCURITÉ
// ---------------------------------------------------------------------------
test('rh autorisé', () => {
  assert.equal(canManagePrimes({ profileId: 'rh' }), true);
});

test('dg autorisé', () => {
  assert.equal(canManagePrimes({ profileId: 'dg' }), true);
});

test('admin (role système) autorisé même sans profileId rh/dg', () => {
  assert.equal(canManagePrimes({ profileId: 'achats', role: 'admin' }), true);
  assert.equal(canManagePrimes({ role: 'admin' }), true);
});

test('caporal_f1 refusé', () => {
  assert.equal(canManagePrimes({ profileId: 'caporal_f1' }), false);
});

test('chef_f1 refusé', () => {
  assert.equal(canManagePrimes({ profileId: 'chef_f1' }), false);
});

test('magasinier refusé', () => {
  assert.equal(canManagePrimes({ profileId: 'magasinier' }), false);
});

test('achats (saisie caisse) refusé sur primes', () => {
  assert.equal(canManagePrimes({ profileId: 'achats' }), false);
});

test('finance refusé sur primes (rh/dg only)', () => {
  assert.equal(canManagePrimes({ profileId: 'finance' }), false);
});

test('profileId inconnu refusé', () => {
  assert.equal(canManagePrimes({ profileId: 'zzz' }), false);
});

test('identité vide / null / undefined refusée', () => {
  assert.equal(canManagePrimes(null), false);
  assert.equal(canManagePrimes(undefined), false);
  assert.equal(canManagePrimes({}), false);
  assert.equal(canManagePrimes({ profileId: '' }), false);
});

test('clés prototype refusées (pas de pollution)', () => {
  assert.equal(canManagePrimes({ profileId: '__proto__' }), false);
  assert.equal(canManagePrimes({ profileId: 'constructor' }), false);
  assert.equal(canManagePrimes({ profileId: 'hasOwnProperty' }), false);
});

test('role non-string ignoré (pas d élévation)', () => {
  assert.equal(canManagePrimes({ profileId: 'caporal_f1', role: { admin: true } }), false);
  assert.equal(canManagePrimes({ profileId: 'caporal_f1', role: 1 }), false);
});

test('forbiddenReason renvoie un message générique', () => {
  assert.equal(forbiddenReason(), 'Accès non autorisé');
});
