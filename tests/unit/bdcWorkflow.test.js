'use strict';

/**
 * Unit tests for public/lib/bdcWorkflow.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../public/lib/bdcWorkflow.js');

test('DIRECT_DG_FARMS contains the 6 farms without chef de ferme', () => {
  assert.deepEqual(W.DIRECT_DG_FARMS, ['Avocatier', 'F2', 'F3', 'F4', 'F6', 'BAHIA']);
});

test('requiresChefValidation — farms WITH a chef de ferme', () => {
  assert.equal(W.requiresChefValidation('F1'), true);
  assert.equal(W.requiresChefValidation('F5'), true);
});

test('requiresChefValidation — DIRECT_DG_FARMS skip the chef step', () => {
  for (const farm of ['Avocatier', 'F2', 'F3', 'F4', 'F6', 'BAHIA']) {
    assert.equal(W.requiresChefValidation(farm), false, `expected ${farm} to bypass chef`);
  }
});

test('requiresChefValidation is case-insensitive and trims whitespace', () => {
  assert.equal(W.requiresChefValidation('bahia'), false);
  assert.equal(W.requiresChefValidation(' AVOCATIER '), false);
  assert.equal(W.requiresChefValidation('f3'), false);
  assert.equal(W.requiresChefValidation('  F6  '), false);
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
});

test('bypassReason is set only when chef is skipped', () => {
  assert.equal(W.bypassReason('F1'), null);
  assert.equal(W.bypassReason('F5'), null);
  assert.equal(W.bypassReason('F3'), 'no_chef_de_ferme');
  assert.equal(W.bypassReason('Avocatier'), 'no_chef_de_ferme');
  assert.equal(W.bypassReason('BAHIA'), 'no_chef_de_ferme');
});
