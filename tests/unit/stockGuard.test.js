'use strict';

/**
 * Unit tests for functions/lib/stock/stockGuard.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkStockAvailability } = require('../../functions/lib/stock/stockGuard.js');

function mov(type, items) {
  return { type: type, items: items };
}

// --- sortie OK ---
test('sortie avec stock suffisant → allowed', () => {
  const r = checkStockAvailability(
    mov('sortie', [{ article_ref: 'A1', article_nom: 'Gants', quantite: 5 }]),
    { A1: 10 }
  );
  assert.equal(r.allowed, true);
  assert.equal(r.error, undefined);
});

// --- sortie KO ---
test('sortie avec 1 article insuffisant → bloqué, message complet', () => {
  const r = checkStockAvailability(
    mov('sortie', [{ article_ref: 'A1', article_nom: 'Gants', quantite: 12 }]),
    { A1: 10 }
  );
  assert.equal(r.allowed, false);
  assert.match(r.error, /Gants/);
  assert.match(r.error, /10 disponible/);
  assert.match(r.error, /12 demandé/);
  assert.equal(r.offending.length, 1);
  assert.equal(r.offending[0].article_ref, 'A1');
  assert.equal(r.offending[0].disponible, 10);
  assert.equal(r.offending[0].demande, 12);
});

// --- transfert KO ---
test('transfert insuffisant → bloqué', () => {
  const r = checkStockAvailability(
    mov('transfert', [{ article_ref: 'A1', article_nom: 'Gants', quantite: 3 }]),
    { A1: 1 }
  );
  assert.equal(r.allowed, false);
  assert.match(r.error, /Stock insuffisant/);
});

// --- reception exemptée ---
test('réception insuffisante → allowed (exemptée)', () => {
  const r = checkStockAvailability(
    mov('reception', [{ article_ref: 'A1', article_nom: 'Gants', quantite: 999 }]),
    { A1: 0 }
  );
  assert.equal(r.allowed, true);
});

// --- consommation hors périmètre ---
test('consommation insuffisante → allowed (hors périmètre)', () => {
  const r = checkStockAvailability(
    mov('consommation', [{ article_ref: 'A1', article_nom: 'Gants', quantite: 999 }]),
    { A1: 0 }
  );
  assert.equal(r.allowed, true);
});

// --- quantité 0 / négative ignorée ---
test('article quantité 0 → ignoré', () => {
  const r = checkStockAvailability(
    mov('sortie', [{ article_ref: 'A1', article_nom: 'Gants', quantite: 0 }]),
    { A1: 0 }
  );
  assert.equal(r.allowed, true);
});

test('article quantité négative → ignoré', () => {
  const r = checkStockAvailability(
    mov('sortie', [{ article_ref: 'A1', article_nom: 'Gants', quantite: -5 }]),
    { A1: 0 }
  );
  assert.equal(r.allowed, true);
});

// --- article absent des soldes (disponible=0) ---
test('article absent des soldes, demandé >0 → bloqué', () => {
  const r = checkStockAvailability(
    mov('sortie', [{ article_ref: 'INCONNU', article_nom: 'Mystère', quantite: 1 }]),
    {}
  );
  assert.equal(r.allowed, false);
  assert.match(r.error, /Mystère/);
  assert.match(r.error, /0 disponible/);
});

// --- plusieurs articles, une seule infraction ---
test('plusieurs articles, un seul en infraction → bloqué, message ne cite que l\'infraction', () => {
  const r = checkStockAvailability(
    mov('sortie', [
      { article_ref: 'A1', article_nom: 'Gants', quantite: 2 },
      { article_ref: 'A2', article_nom: 'Sécateurs', quantite: 8 },
    ]),
    { A1: 10, A2: 3 }
  );
  assert.equal(r.allowed, false);
  assert.equal(r.offending.length, 1);
  assert.equal(r.offending[0].article_ref, 'A2');
  assert.match(r.error, /Sécateurs/);
  assert.doesNotMatch(r.error, /Gants/);
});

// --- plusieurs infractions jointes par ' ; ' ---
test('plusieurs infractions → message joint par " ; "', () => {
  const r = checkStockAvailability(
    mov('sortie', [
      { article_ref: 'A1', article_nom: 'Gants', quantite: 20 },
      { article_ref: 'A2', article_nom: 'Sécateurs', quantite: 8 },
    ]),
    { A1: 10, A2: 3 }
  );
  assert.equal(r.allowed, false);
  assert.equal(r.offending.length, 2);
  assert.match(r.error, / ; /);
});

// --- quantite string parsée ---
test('quantite fournie en string → parsée', () => {
  const r = checkStockAvailability(
    mov('sortie', [{ article_ref: 'A1', article_nom: 'Gants', quantite: '7' }]),
    { A1: 5 }
  );
  assert.equal(r.allowed, false);
  assert.equal(r.offending[0].demande, 7);
});

// --- fallback nom = ref quand article_nom absent ---
test('article_nom absent → message utilise article_ref', () => {
  const r = checkStockAvailability(
    mov('sortie', [{ article_ref: 'A1', quantite: 9 }]),
    { A1: 1 }
  );
  assert.equal(r.allowed, false);
  assert.match(r.error, /A1/);
});

// --- opts.guardedTypes surcharge ---
test('opts.guardedTypes permet de garder consommation', () => {
  const r = checkStockAvailability(
    mov('consommation', [{ article_ref: 'A1', article_nom: 'Gants', quantite: 5 }]),
    { A1: 1 },
    { guardedTypes: ['consommation'] }
  );
  assert.equal(r.allowed, false);
});
