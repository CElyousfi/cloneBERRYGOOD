'use strict';

/**
 * Unit tests for the Comptes Clients Marché Local helpers (sous-lot 4.4).
 * Pure read-only aggregation: vendu / encaissé / reste dû per client.
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('./_esm').loadEsm('src/modules/shared/lib/caisseUtils.js');

test('isCompteClientCaisse — detects by compte_client_ id prefix', () => {
  assert.equal(U.isCompteClientCaisse({ id: 'compte_client_mustapha_chafik_a' }), true);
  assert.equal(U.isCompteClientCaisse({ id: 'compte_client_fruit_congel_du_nord' }), true);
});

test('isCompteClientCaisse — detects by kind field (forward compat)', () => {
  assert.equal(U.isCompteClientCaisse({ id: 'whatever', kind: 'compte_client_marche_local' }), true);
});

test('isCompteClientCaisse — rejects non-client caisses', () => {
  assert.equal(U.isCompteClientCaisse({ id: 'caisse_depenses' }), false);
  assert.equal(U.isCompteClientCaisse({ id: 'caisse_marche_local_f1' }), false);
  assert.equal(U.isCompteClientCaisse(null), false);
  assert.equal(U.isCompteClientCaisse(undefined), false);
  assert.equal(U.isCompteClientCaisse({}), false);
});

test('computeCompteClientTotals — vendu / encaissé / reste dû', () => {
  const txs = [
    { type: 'vente', montant: 1000 },
    { type: 'vente', montant: 500 },
    { type: 'encaissement', montant: 300 },
    { type: 'depense', montant: 999 }, // ignored
    { type: 'alimentation', montant: 999 }, // ignored
  ];
  const r = U.computeCompteClientTotals(txs);
  assert.equal(r.totalVendu, 1500);
  assert.equal(r.totalEncaisse, 300);
  assert.equal(r.resteDu, 1200);
  assert.equal(r.nbVentes, 2);
  assert.equal(r.nbEncaissements, 1);
});

test('computeCompteClientTotals — no encaissements yet => resteDu == totalVendu', () => {
  const txs = [
    { type: 'vente', montant: 2000 },
    { type: 'vente', montant: 750 },
  ];
  const r = U.computeCompteClientTotals(txs);
  assert.equal(r.totalVendu, 2750);
  assert.equal(r.totalEncaisse, 0);
  assert.equal(r.resteDu, 2750);
});

test('computeCompteClientTotals — empty / invalid input is safe', () => {
  assert.deepEqual(U.computeCompteClientTotals([]), {
    totalVendu: 0, totalEncaisse: 0, resteDu: 0, nbVentes: 0, nbEncaissements: 0,
  });
  assert.deepEqual(U.computeCompteClientTotals(null), {
    totalVendu: 0, totalEncaisse: 0, resteDu: 0, nbVentes: 0, nbEncaissements: 0,
  });
});

test('computeCompteClientTotals — coerces non-numeric montant to 0', () => {
  const r = U.computeCompteClientTotals([
    { type: 'vente', montant: '1000' },
    { type: 'vente', montant: undefined },
    { type: 'encaissement', montant: null },
  ]);
  assert.equal(r.totalVendu, 1000);
  assert.equal(r.totalEncaisse, 0);
  assert.equal(r.resteDu, 1000);
});
