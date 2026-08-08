'use strict';

/**
 * Unit tests for public/lib/bdcReceptionUtils.js — computeDeliveryData().
 * Run with: npm run test:unit
 *
 * Extrait de AchatsBDCTab.getDeliveryData (public/app.jsx) pour être réutilisé
 * par MagBdcReceptionTab (plafond de réception) et MagBonsCommandeTab (popup
 * lecture seule reçu/reliquat). Ces tests verrouillent le comportement exact
 * (arrondis, statuts, gestion des cas vides) avant/après extraction.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDeliveryData } = require('../../public/lib/bdcReceptionUtils.js');

test('computeDeliveryData: reproduit BDC-2026-0142 — 100 commandés, 30+25 reçus → reste 45, statut partiel', () => {
  const bdcItems = [{ article: 'TES', quantite: 100, unite: 'ml' }];
  const bls = [
    { items: [{ article: 'TES', quantite_recue: 30 }] },
    { items: [{ article: 'TES', quantite_recue: 25 }] },
  ];
  const result = computeDeliveryData(bdcItems, bls);
  assert.deepEqual(result, [{ article: 'TES', unite: 'ml', qCmd: 100, qLiv: 55, reste: 45, pct: 55, statut: 'partiel' }]);
});

test('computeDeliveryData: aucun BL → reste = quantité commandée, statut en_attente', () => {
  const bdcItems = [{ article: 'A', quantite: 10, unite: 'kg' }];
  const result = computeDeliveryData(bdcItems, []);
  assert.deepEqual(result, [{ article: 'A', unite: 'kg', qCmd: 10, qLiv: 0, reste: 10, pct: 0, statut: 'en_attente' }]);
});

test('computeDeliveryData: article entièrement livré → reste 0, statut livre, pct plafonné à 100', () => {
  const bdcItems = [{ article: 'A', quantite: 10, unite: 'kg' }];
  const bls = [{ items: [{ article: 'A', quantite_recue: 12 }] }]; // sur-livré côté data historique
  const result = computeDeliveryData(bdcItems, bls);
  assert.equal(result[0].reste, 0);
  assert.equal(result[0].statut, 'livre');
  assert.equal(result[0].pct, 100);
});

test('computeDeliveryData: BDC multi-articles — un article soldé, un autre partiel', () => {
  const bdcItems = [
    { article: 'A', quantite: 10, unite: 'kg' },
    { article: 'B', quantite: 20, unite: 'kg' },
  ];
  const bls = [{ items: [{ article: 'A', quantite_recue: 10 }, { article: 'B', quantite_recue: 5 }] }];
  const result = computeDeliveryData(bdcItems, bls);
  const byArticle = Object.fromEntries(result.map((r) => [r.article, r]));
  assert.equal(byArticle.A.reste, 0);
  assert.equal(byArticle.A.statut, 'livre');
  assert.equal(byArticle.B.reste, 15);
  assert.equal(byArticle.B.statut, 'partiel');
});

test('computeDeliveryData: bdcItems/bls vides ou undefined → pas de crash', () => {
  assert.deepEqual(computeDeliveryData([], []), []);
  assert.deepEqual(computeDeliveryData(undefined, undefined), []);
  assert.deepEqual(computeDeliveryData([{ article: 'A', quantite: 5 }], undefined), [
    { article: 'A', unite: 'kg', qCmd: 5, qLiv: 0, reste: 5, pct: 0, statut: 'en_attente' },
  ]);
});
