'use strict';

/**
 * Unit tests for src/modules/shared/lib/inventaireUtils.js
 * Run with: npm run test:unit
 *
 * Couvre : sous-totaux quantité PAR UNITÉ (jamais de somme mélangée), total
 * monétaire commun (DH), et le cumul du ledger borné à la date d'inventaire.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeInventaireTotals, formatQteParUnite, boundedLedger } = require('./_esm').loadEsm('src/modules/shared/lib/inventaireUtils.js');

test('computeInventaireTotals: sous-totaux par unité + total DH', () => {
  const rows = [
    { unite: 'KG', balance: 10000.6, prix_total: 5000 },
    { unite: 'L', balance: 14300.4, prix_total: 2000 },
    { unite: 'KG', balance: 30, prix_total: 100 },
    { unite: 'KG', balance: -5, prix_total: 0 }, // prix_total nul ou négatif exclu du monétaire
  ];
  const t = computeInventaireTotals(rows);
  assert.equal(t.count, 4);
  assert.equal(t.qte_par_unite.KG, 10025.6);
  assert.equal(t.qte_par_unite.L, 14300.4);
  assert.equal(t.prix_total_sum, 7100);
});

test('computeInventaireTotals: unité manquante regroupée sous —', () => {
  const t = computeInventaireTotals([{ balance: 3, prix_total: 0 }, { unite: '', balance: 2, prix_total: 0 }]);
  assert.equal(t.qte_par_unite['—'], 5);
});

test('computeInventaireTotals: liste vide', () => {
  const t = computeInventaireTotals([]);
  assert.equal(t.count, 0);
  assert.equal(t.prix_total_sum, 0);
  assert.deepEqual(t.qte_par_unite, {});
});

test('formatQteParUnite: format compact trié et normalisé', () => {
  const out = formatQteParUnite({ L: 14300.4, KG: 10025.6 });
  const normalized = out.replace(/\s/g, ' ');
  assert.equal(normalized, 'KG : 10 025,6 · L : 14 300,4');
});

test('formatQteParUnite: vide → tiret', () => {
  assert.equal(formatQteParUnite({}), '—');
});

test('boundedLedger: borne date incluse + cumul finit sur le solde', () => {
  const entries = [
    { date: '2026-01-10', quantite: 100 },
    { date: '2026-02-15', quantite: -30 },
    { date: '2026-03-20', quantite: 50 },
    { date: '2026-04-01', quantite: 999 }, // postérieur, exclu
  ];
  const r = boundedLedger(entries, '2026-03-20');
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].solde_courant, 100);
  assert.equal(r.rows[1].solde_courant, 70);
  assert.equal(r.rows[2].solde_courant, 120);
  assert.equal(r.solde_final, 120);
});

test('boundedLedger: sans borne → tout inclus', () => {
  const entries = [{ date: '2026-01-10', quantite: 10 }, { date: '2026-05-01', quantite: 5 }];
  const r = boundedLedger(entries, null);
  assert.equal(r.rows.length, 2);
  assert.equal(r.solde_final, 15);
});

test('boundedLedger: vide', () => {
  const r = boundedLedger([], '2026-03-20');
  assert.equal(r.rows.length, 0);
  assert.equal(r.solde_final, 0);
});
