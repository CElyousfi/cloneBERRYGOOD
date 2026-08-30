// @ts-check
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { computeNextStatus, canValidate } = require('../invoiceWorkflow');

describe('invoiceWorkflow', () => {
  describe('computeNextStatus', () => {
    test('achats: en_validation → validee_achats', () => {
      const r = computeNextStatus('en_validation', 'achats');
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.nextStatus, 'validee_achats');
    });
    test('finance: validee_achats → validee_finance', () => {
      const r = computeNextStatus('validee_achats', 'finance');
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.nextStatus, 'validee_finance');
    });
    test('dg: validee_finance → validee_dg', () => {
      const r = computeNextStatus('validee_finance', 'dg');
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.nextStatus, 'validee_dg');
    });
    test('wrong status returns error', () => {
      const r = computeNextStatus('non_payee', 'finance');
      assert.equal(r.ok, false);
    });
    test('unknown role returns error', () => {
      const r = computeNextStatus('en_validation', 'rh');
      assert.equal(r.ok, false);
    });
  });
  describe('canValidate', () => {
    test('finance can validate validee_achats', () => {
      assert.equal(canValidate('validee_achats', 'finance'), true);
    });
    test('finance cannot validate non_payee', () => {
      assert.equal(canValidate('non_payee', 'finance'), false);
    });
  });
});
