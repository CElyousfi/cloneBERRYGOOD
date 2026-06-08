'use strict';

/**
 * Impact stock d'un mouvement — tests purs.
 * Couvre isImpactApplied : réplique de la condition « impact posé en live »
 * appliquée par applyStockImpact dans functions/index.js.
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { isImpactApplied } = require('../../functions/lib/stock/movementImpact.js');

test('sortie valide_chef -> true (auto-validé à la création)', () => {
  assert.equal(isImpactApplied({ type: 'sortie', status: 'valide_chef' }), true);
});

test('transfert valide_chef -> true (auto-validé à la création)', () => {
  assert.equal(isImpactApplied({ type: 'transfert', status: 'valide_chef' }), true);
});

test('consommation valide_chef -> true (auto-validé à la création)', () => {
  assert.equal(isImpactApplied({ type: 'consommation', status: 'valide_chef' }), true);
});

test('réception en_attente_achats -> false (pas encore validée Achats)', () => {
  assert.equal(isImpactApplied({ type: 'reception', status: 'en_attente_achats' }), false);
});

test('réception valide_mag -> false (statut intermédiaire, pas d\'impact)', () => {
  assert.equal(isImpactApplied({ type: 'reception', status: 'valide_mag' }), false);
});

test('réception valide_chef -> true (statut final après validation Achats)', () => {
  assert.equal(isImpactApplied({ type: 'reception', status: 'valide_chef' }), true);
});

test('rejete -> false (jamais d\'impact)', () => {
  assert.equal(isImpactApplied({ type: 'reception', status: 'rejete' }), false);
  assert.equal(isImpactApplied({ type: 'sortie', status: 'rejete' }), false);
});

test('soft-deleted (deleted:true) -> false même si status valide_chef', () => {
  assert.equal(isImpactApplied({ type: 'sortie', status: 'valide_chef', deleted: true }), false);
});

test('soft-deleted (status supprime) -> false', () => {
  assert.equal(isImpactApplied({ type: 'sortie', status: 'supprime' }), false);
});

test('type/status manquants -> false (défensif)', () => {
  assert.equal(isImpactApplied({}), false);
  assert.equal(isImpactApplied(null), false);
  assert.equal(isImpactApplied(undefined), false);
  assert.equal(isImpactApplied({ type: 'sortie' }), false);
  assert.equal(isImpactApplied({ status: 'valide_chef' }), true);
});

test('réception valide_achats -> false (réception non finale : impact seulement en valide_chef)', () => {
  assert.equal(isImpactApplied({ type: 'reception', status: 'valide_achats' }), false);
});

test('transfert valide_mag -> true (import CANEVA : statut impactant)', () => {
  assert.equal(isImpactApplied({ type: 'transfert', status: 'valide_mag' }), true);
});

test('consommation valide_mag -> true (import CANEVA : statut impactant)', () => {
  assert.equal(isImpactApplied({ type: 'consommation', status: 'valide_mag' }), true);
});

test('sortie valide_mag -> true (import CANEVA : statut impactant)', () => {
  assert.equal(isImpactApplied({ type: 'sortie', status: 'valide_mag' }), true);
});

test('consommation valide_achats -> true (chemin legacy : statut impactant)', () => {
  assert.equal(isImpactApplied({ type: 'consommation', status: 'valide_achats' }), true);
});

test('transfert valide_achats -> true (chemin legacy : statut impactant)', () => {
  assert.equal(isImpactApplied({ type: 'transfert', status: 'valide_achats' }), true);
});
