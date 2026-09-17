'use strict';

/**
 * Unit tests for src/modules/shared/lib/bdcWorkflow.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./_esm').loadEsm('src/modules/shared/lib/bdcWorkflow.js');

test('DIRECT_DG_FARMS contains the 6 farms without chef de ferme + Toutes (multi-ferme)', () => {
  assert.deepEqual(W.DIRECT_DG_FARMS, ['Avocatier', 'F2', 'F3', 'F4', 'F6', 'BAHIA', 'Toutes']);
});

test('requiresChefValidation — farms WITH a chef de ferme', () => {
  assert.equal(W.requiresChefValidation('F1'), true);
  assert.equal(W.requiresChefValidation('F5'), true);
});

test('requiresChefValidation — DIRECT_DG_FARMS skip the chef step', () => {
  for (const farm of ['Avocatier', 'F2', 'F3', 'F4', 'F6', 'BAHIA', 'Toutes']) {
    assert.equal(W.requiresChefValidation(farm), false, `expected ${farm} to bypass chef`);
  }
});

test('requiresChefValidation is case-insensitive and trims whitespace', () => {
  assert.equal(W.requiresChefValidation('bahia'), false);
  assert.equal(W.requiresChefValidation(' AVOCATIER '), false);
  assert.equal(W.requiresChefValidation('f3'), false);
  assert.equal(W.requiresChefValidation('  F6  '), false);
  assert.equal(W.requiresChefValidation('toutes'), false);
  assert.equal(W.requiresChefValidation('TOUTES'), false);
  assert.equal(W.requiresChefValidation('  Toutes  '), false);
});

test('requiresChefValidation fail-safe on invalid input', () => {
  assert.equal(W.requiresChefValidation(''), true);
  assert.equal(W.requiresChefValidation(null), true);
  assert.equal(W.requiresChefValidation(undefined), true);
  // @ts-ignore — intentional bad type
  assert.equal(W.requiresChefValidation(42), true);
  assert.equal(W.requiresChefValidation('UNKNOWN_FARM'), true);
});

test('nextStatusOnSubmit returns the correct status per ferme', () => {
  assert.equal(W.nextStatusOnSubmit('F1'), 'en_attente_chef');
  assert.equal(W.nextStatusOnSubmit('F5'), 'en_attente_chef');
  assert.equal(W.nextStatusOnSubmit('F3'), 'en_attente_dg');
  assert.equal(W.nextStatusOnSubmit('BAHIA'), 'en_attente_dg');
  assert.equal(W.nextStatusOnSubmit('Avocatier'), 'en_attente_dg');
  assert.equal(W.nextStatusOnSubmit('Toutes'), 'en_attente_dg');
});

test('bypassReason is set only when chef is skipped', () => {
  assert.equal(W.bypassReason('F1'), null);
  assert.equal(W.bypassReason('F5'), null);
  assert.equal(W.bypassReason('F3'), 'no_chef_de_ferme');
  assert.equal(W.bypassReason('Avocatier'), 'no_chef_de_ferme');
  assert.equal(W.bypassReason('BAHIA'), 'no_chef_de_ferme');
});

test('bypassReason distingue BdC mutualisé (Toutes) des fermes mono-sans-chef', () => {
  assert.equal(W.bypassReason('Toutes'), 'multi_ferme_dg_only');
  assert.equal(W.bypassReason('toutes'), 'multi_ferme_dg_only');
  assert.equal(W.bypassReason('  TOUTES  '), 'multi_ferme_dg_only');
});

test('chefProfileForFerme resolves the correct profileId for F1 and F5', () => {
  assert.equal(W.chefProfileForFerme('F1'), 'chef_f1');
  assert.equal(W.chefProfileForFerme('F5'), 'chef_f5');
});

test('chefProfileForFerme returns null for farms without a chef de ferme', () => {
  assert.equal(W.chefProfileForFerme('Avocatier'), null);
});

test('chefProfileForFerme fail-safe on invalid input', () => {
  assert.equal(W.chefProfileForFerme(''), null);
  assert.equal(W.chefProfileForFerme(null), null);
});
