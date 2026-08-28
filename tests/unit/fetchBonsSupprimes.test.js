/*
 * fetchBonsSupprimes.test.js — un bon de consommation supprimé (`delete-bc`)
 * doit sortir des analyses de consommation.
 *
 * Enjeu : `delete-bc` ANNULE l'impact stock des mouvements du bon. Si l'analyse
 * (coût/Ha, campagne) continuait de lire le bon, l'inventaire et l'analytique
 * diraient deux choses différentes — sans qu'aucune erreur ne se déclenche.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { fetchBonsConsommation } = require('../../functions/lib/consoBons/fetchBons');

/** Firestore minimal injecté : une collection, des documents. */
function fakeDb(docs) {
  return {
    collection(name) {
      assert.equal(name, 'consumption_vouchers');
      return { get: async () => ({ docs: docs.map((d) => ({ id: d.id, data: () => d.data })) }) };
    },
  };
}

test('fetchBonsConsommation — exclut les bons soft-deleted', async () => {
  const db = fakeDb([
    { id: 'a', data: { numero: 'BC-2026-0032', items: [] } },
    { id: 'b', data: { numero: 'BC-2026-0033', items: [], deleted: true } },
  ]);
  const bons = await fetchBonsConsommation(db);
  assert.deepEqual(bons.map((b) => b.numero), ['BC-2026-0032']);
});

test('fetchBonsConsommation — un bon sans champ `deleted` est conservé', async () => {
  const db = fakeDb([
    { id: 'a', data: { numero: 'BC-1' } },
    { id: 'b', data: { numero: 'BC-2', deleted: false } },
  ]);
  const bons = await fetchBonsConsommation(db);
  assert.deepEqual(bons.map((b) => b.numero), ['BC-1', 'BC-2']);
});
