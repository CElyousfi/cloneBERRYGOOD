const test = require('node:test');
const assert = require('node:assert');
const { normalizeFournisseurName, computeFournisseurBalance, detectDuplicateFournisseur } = require('../fournisseurUtils');

test('normalizeFournisseurName', () => {
  assert.strictEqual(normalizeFournisseurName('  Acme   Corp '), 'ACME CORP');
});

test('computeFournisseurBalance', () => {
  const factures = [{ montant: 100 }, { montant: 50 }];
  const paiements = [{ montant: 120 }];
  assert.strictEqual(computeFournisseurBalance(factures, paiements), 30);
});

test('detectDuplicateFournisseur', () => {
  const fs = [{ id: '1', name: 'Acme Corp' }, { id: '2', name: 'Other' }];
  assert.strictEqual(detectDuplicateFournisseur(fs, 'acme corp'), '1');
  assert.strictEqual(detectDuplicateFournisseur(fs, 'new corp'), null);
});
