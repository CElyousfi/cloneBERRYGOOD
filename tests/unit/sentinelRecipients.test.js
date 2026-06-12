'use strict';

// Tests pour filterSentinelRecipients() — filtrage/projection des destinataires
// WhatsApp pour l'endpoint /api/sentinel-recipients (projet bgf-sentinel).
// Sémantique de champs alignée sur resolveRecipientsForProfile (whatsappService.js).

const { test } = require('node:test');
const assert = require('node:assert');
const { filterSentinelRecipients } = require('../../functions/lib/sentinel/sentinelRecipients.js');

test('user complet retenu et projeté sur 3 champs', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: true, disabled: false, whatsappPhone: '+212600000000', ferme: 'F5', profileId: 'chef', name: 'X', email: 'x@y.z', uid: 'abc' },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { ferme: 'F5', whatsappPhone: '+212600000000', profileId: 'chef' });
});

test('whatsappEnabled false exclu', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: false, whatsappPhone: '+212600000000', profileId: 'chef' },
  ]);
  assert.equal(out.length, 0);
});

test('whatsappEnabled absent exclu (doit être strictement true)', () => {
  const out = filterSentinelRecipients([
    { whatsappPhone: '+212600000000', profileId: 'chef' },
  ]);
  assert.equal(out.length, 0);
});

test('disabled true exclu', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: true, disabled: true, whatsappPhone: '+212600000000', profileId: 'chef' },
  ]);
  assert.equal(out.length, 0);
});

test('whatsappPhone vide exclu', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: true, whatsappPhone: '', profileId: 'chef' },
    { whatsappEnabled: true, profileId: 'chef' },
  ]);
  assert.equal(out.length, 0);
});

test('ferme absent/vide/null -> null', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: true, whatsappPhone: '+212600000001', profileId: 'dg' },
    { whatsappEnabled: true, whatsappPhone: '+212600000002', profileId: 'dg', ferme: '' },
    { whatsappEnabled: true, whatsappPhone: '+212600000003', profileId: 'dg', ferme: null },
  ]);
  assert.equal(out.length, 3);
  out.forEach((r) => assert.strictEqual(r.ferme, null));
});

test('whatsappPhone normalisé E.164 : local 0612345678 -> +212612345678', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: true, whatsappPhone: '0612345678', ferme: 'F5', profileId: 'chef' },
  ]);
  assert.equal(out.length, 1);
  assert.strictEqual(out[0].whatsappPhone, '+212612345678');
});

test('whatsappPhone normalisé E.164 : 00212612345678 -> +212612345678', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: true, whatsappPhone: '00212612345678', ferme: 'F5', profileId: 'chef' },
  ]);
  assert.equal(out.length, 1);
  assert.strictEqual(out[0].whatsappPhone, '+212612345678');
});

test('whatsappPhone invalide -> recipient exclu', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: true, whatsappPhone: 'abc', profileId: 'chef' },
    { whatsappEnabled: true, whatsappPhone: '123', profileId: 'chef' },
  ]);
  assert.equal(out.length, 0);
});

test('profileId absent -> null en sortie (user conservé)', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: true, whatsappPhone: '+212612345678', ferme: 'F5' },
  ]);
  assert.equal(out.length, 1);
  assert.strictEqual(out[0].profileId, null);
});

test('aucun PII dans la sortie (uniquement ferme, whatsappPhone, profileId)', () => {
  const out = filterSentinelRecipients([
    { whatsappEnabled: true, whatsappPhone: '+212611111111', ferme: 'F1', profileId: 'chef', name: 'Alice', email: 'a@b.c', uid: 'u123', displayName: 'Alice' },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(Object.keys(out[0]).sort(), ['ferme', 'profileId', 'whatsappPhone']);
});

test('entrée invalide gérée (non-array -> [], éléments null ignorés)', () => {
  assert.deepEqual(filterSentinelRecipients(null), []);
  assert.deepEqual(filterSentinelRecipients(undefined), []);
  const out = filterSentinelRecipients([null, undefined, { whatsappEnabled: true, whatsappPhone: '+212600000009', profileId: 'dg' }]);
  assert.equal(out.length, 1);
});
