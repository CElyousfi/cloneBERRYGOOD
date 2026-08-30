const test = require('node:test');
const assert = require('node:assert');
const { validateBdcTransition, canChefValidate, canDgValidate, computeBdcTotal, isBdcExpired } = require('../bdcStateValidation');

test('validateBdcTransition', () => {
  assert.strictEqual(validateBdcTransition('brouillon', 'en_attente_validation', 'user').ok, true);
  assert.strictEqual(validateBdcTransition('en_attente_validation', 'valide_chef', 'chef').ok, true);
  assert.strictEqual(validateBdcTransition('en_attente_validation', 'valide_chef', 'user').ok, false);
});

test('canChefValidate', () => {
  assert.strictEqual(canChefValidate({ status: 'en_attente_validation' }, { role: 'chef' }), true);
  assert.strictEqual(canChefValidate({ status: 'brouillon' }, { role: 'chef' }), false);
});

test('canDgValidate', () => {
  assert.strictEqual(canDgValidate({ status: 'valide_chef' }, { role: 'dg' }), true);
});

test('computeBdcTotal', () => {
  const lines = [{ qty: 2, prixUnitaire: 10 }, { qty: 1, prixUnitaire: 5 }];
  assert.strictEqual(computeBdcTotal(lines), 25);
});

test('isBdcExpired', () => {
  const now = Date.now();
  const oldDate = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(isBdcExpired({ dateCreation: oldDate }, 5), true);
  assert.strictEqual(isBdcExpired({ dateCreation: oldDate }, 15), false);
});
