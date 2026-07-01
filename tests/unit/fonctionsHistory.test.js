'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildFonctionUpdate } = require('../../functions/lib/fonctions/fonctionsHistory.js');

const ACTOR = { uid: 'u1', profileId: 'rh', name: 'RH Test' };

test('classement initial : pose fonction_id + 1re entrée historique (previous null)', () => {
  const upd = buildFonctionUpdate({
    current: null, fonctionId: 'caporal', actor: ACTOR, now: 1000,
  });
  assert.equal(upd.unset, false);
  assert.equal(upd.fonction_id, 'caporal');
  assert.equal(upd.fonction_history.length, 1);
  const e = upd.fonction_history[0];
  assert.equal(e.fonction_id, 'caporal');
  assert.equal(e.previousFonctionId, null);
  assert.deepEqual(e.changedBy, ACTOR);
  assert.equal(e.changedAt, 1000);
  assert.deepEqual(upd.fonction_by, ACTOR);
  assert.equal(upd.fonction_updated_at, 1000);
  assert.equal(upd.updatedAt, 1000);
});

test('changement de fonction : previousFonctionId = fonction courante', () => {
  const current = { fonction_id: 'ouvrier', fonction_history: [] };
  const upd = buildFonctionUpdate({
    current, fonctionId: 'caporal', actor: ACTOR, now: 2000,
  });
  assert.equal(upd.fonction_id, 'caporal');
  const e = upd.fonction_history[0];
  assert.equal(e.fonction_id, 'caporal');
  assert.equal(e.previousFonctionId, 'ouvrier');
});

test('append NON destructif : conserve l historique antérieur', () => {
  const current = {
    fonction_id: 'ouvrier',
    fonction_history: [
      { fonction_id: 'ouvrier', previousFonctionId: null, changedBy: ACTOR, changedAt: 500 },
    ],
  };
  const upd = buildFonctionUpdate({
    current, fonctionId: 'caporal', actor: ACTOR, now: 3000,
  });
  assert.equal(upd.fonction_history.length, 2);
  assert.equal(upd.fonction_history[0].changedAt, 500);
  assert.equal(upd.fonction_history[1].fonction_id, 'caporal');
  assert.equal(upd.fonction_history[1].previousFonctionId, 'ouvrier');
});

test('déclassement (fonctionId null) : unset=true, fonction_id ABSENT de l update', () => {
  const current = { fonction_id: 'caporal', fonction_history: [] };
  const upd = buildFonctionUpdate({
    current, fonctionId: null, actor: ACTOR, now: 4000,
  });
  assert.equal(upd.unset, true);
  assert.equal(Object.prototype.hasOwnProperty.call(upd, 'fonction_id'), false);
  const e = upd.fonction_history[0];
  assert.equal(e.fonction_id, null);
  assert.equal(e.previousFonctionId, 'caporal');
});

test('déclassement (fonctionId chaîne vide) : traité comme unset', () => {
  const current = { fonction_id: 'caporal', fonction_history: [] };
  const upd = buildFonctionUpdate({
    current, fonctionId: '   ', actor: ACTOR, now: 5000,
  });
  assert.equal(upd.unset, true);
  assert.equal(Object.prototype.hasOwnProperty.call(upd, 'fonction_id'), false);
});

test('actor normalisé même si champs manquants', () => {
  const upd = buildFonctionUpdate({
    current: null, fonctionId: 'ouvrier', actor: { uid: 'x' }, now: 6000,
  });
  assert.deepEqual(upd.fonction_by, { uid: 'x', profileId: '', name: '' });
});
