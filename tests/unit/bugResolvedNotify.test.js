'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  shouldNotifyResolved,
  buildResolvedMessage,
  shortId,
} = require('../../functions/lib/triage/bugTriage');

// --- shouldNotifyResolved ---------------------------------------------------

test('shouldNotifyResolved : transition qualified -> resolved déclenche', () => {
  assert.strictEqual(
    shouldNotifyResolved({ status: 'qualified' }, { status: 'resolved' }),
    true
  );
});

test('shouldNotifyResolved : transition nouveau -> resolved déclenche', () => {
  assert.strictEqual(
    shouldNotifyResolved({ status: 'nouveau' }, { status: 'resolved' }),
    true
  );
});

test('shouldNotifyResolved : déjà resolved -> resolved ne re-notifie pas (idempotence)', () => {
  assert.strictEqual(
    shouldNotifyResolved({ status: 'resolved' }, { status: 'resolved' }),
    false
  );
});

test('shouldNotifyResolved : update vers un autre statut ne déclenche pas (ex. triage qualified)', () => {
  assert.strictEqual(
    shouldNotifyResolved({ status: 'nouveau' }, { status: 'qualified' }),
    false
  );
});

test('shouldNotifyResolved : update sans changement de statut ne déclenche pas', () => {
  assert.strictEqual(
    shouldNotifyResolved({ status: 'qualified' }, { status: 'qualified' }),
    false
  );
});

test('shouldNotifyResolved : tolère before/after partiels', () => {
  assert.strictEqual(shouldNotifyResolved({}, { status: 'resolved' }), true);
  assert.strictEqual(shouldNotifyResolved(null, { status: 'resolved' }), true);
  assert.strictEqual(shouldNotifyResolved({ status: 'resolved' }, {}), false);
  assert.strictEqual(shouldNotifyResolved({ status: 'nouveau' }, null), false);
});

// --- buildResolvedMessage ---------------------------------------------------

test('buildResolvedMessage : utilise summary en priorité', () => {
  const msg = buildResolvedMessage(
    { summary: 'Crash export paie', description: 'desc longue' },
    'abcd1234'
  );
  assert.match(msg, /^✅ Votre signalement #abcd1234 a été corrigé et déployé\.\n/);
  assert.match(msg, /Crash export paie\. Merci pour votre retour !$/);
  assert.ok(!msg.includes('desc longue'));
});

test('buildResolvedMessage : fallback sur description si pas de summary', () => {
  const msg = buildResolvedMessage(
    { description: 'Le bouton valider ne répond pas' },
    'ef567890'
  );
  assert.match(msg, /#ef567890/);
  assert.match(msg, /Le bouton valider ne répond pas\. Merci pour votre retour !$/);
});

test('buildResolvedMessage : reste bien formé sans summary ni description', () => {
  const msg = buildResolvedMessage({}, 'deadbeef');
  assert.strictEqual(
    msg,
    '✅ Votre signalement #deadbeef a été corrigé et déployé.\n. Merci pour votre retour !'
  );
});

test('buildResolvedMessage : idCourt dérivé de shortId est cohérent', () => {
  const fullId = 'AbCdEfGh12345678';
  const msg = buildResolvedMessage({ summary: 'x' }, shortId(fullId));
  assert.match(msg, /#AbCdEfGh/);
});
