'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPrimeUpdate } = require('../../functions/lib/primes/primeHistory.js');

const ACTOR = { uid: 'u1', profileId: 'rh', name: 'RH Test' };

test('historisation conserve l ancienne valeur + effectiveFrom + actor', () => {
  const current = { primeFonctionJournaliere: 10, prime_history: [] };
  const upd = buildPrimeUpdate({
    current, montant: 25, effectiveFrom: '2026-07-01', actor: ACTOR, now: 1000,
  });
  assert.equal(upd.primeFonctionJournaliere, 25);
  assert.equal(upd.prime_effectiveFrom, '2026-07-01');
  assert.equal(upd.prime_history.length, 1);
  const e = upd.prime_history[0];
  assert.equal(e.montant, 25);
  assert.equal(e.previousMontant, 10);
  assert.equal(e.effectiveFrom, '2026-07-01');
  assert.deepEqual(e.changedBy, ACTOR);
  assert.equal(e.changedAt, 1000);
  assert.deepEqual(upd.updatedBy, ACTOR);
  assert.equal(upd.updatedAt, 1000);
});

test('append : conserve l historique antérieur (jamais d écrasement)', () => {
  const current = {
    primeFonctionJournaliere: 25,
    prime_history: [{ montant: 25, previousMontant: 10, effectiveFrom: '2026-07-01', changedBy: ACTOR, changedAt: 1000 }],
  };
  const upd = buildPrimeUpdate({
    current, montant: 30, effectiveFrom: '2026-08-01', actor: ACTOR, now: 2000,
  });
  assert.equal(upd.prime_history.length, 2);
  assert.equal(upd.prime_history[0].montant, 25);
  assert.equal(upd.prime_history[1].montant, 30);
  assert.equal(upd.prime_history[1].previousMontant, 25);
});

test('doc nouveau (current null) → previousMontant 0', () => {
  const upd = buildPrimeUpdate({
    current: null, montant: 12, effectiveFrom: '2026-07-01', actor: ACTOR, now: 500,
  });
  assert.equal(upd.prime_history.length, 1);
  assert.equal(upd.prime_history[0].previousMontant, 0);
  assert.equal(upd.primeFonctionJournaliere, 12);
});

test('actor est sanitisé en chaînes (jamais d objet arbitraire)', () => {
  const upd = buildPrimeUpdate({
    current: {}, montant: 5, effectiveFrom: '2026-07-01',
    actor: { uid: 'u2', profileId: 'dg', name: 'X', extra: 'IGNORED' }, now: 1,
  });
  assert.deepEqual(upd.updatedBy, { uid: 'u2', profileId: 'dg', name: 'X' });
  assert.equal(upd.updatedBy.extra, undefined);
});
