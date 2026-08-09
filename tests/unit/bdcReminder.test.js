'use strict';

/**
 * Unit tests for functions/lib/bdc/reminder.js (logique pure du rappel BDC).
 * Aucune connexion Firestore ni WhatsApp — fixtures en mémoire uniquement.
 * Run with: npm run test:unit
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../functions/lib/bdc/reminder.js');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ── Table de ciblage statut → profils ────────────────────────────────────────

test('resolveReminderTargets — en_attente_chef cible le chef de la ferme + ferme', () => {
  assert.deepEqual(R.resolveReminderTargets({ status: 'en_attente_chef', ferme: 'F1' }), {
    profiles: ['chef_f1'],
    ferme: 'F1',
  });
  assert.deepEqual(R.resolveReminderTargets({ status: 'en_attente_chef', ferme: 'F5' }), {
    profiles: ['chef_f5'],
    ferme: 'F5',
  });
});

test('resolveReminderTargets — en_attente_chef sans chef connu → profils vides (filter Boolean)', () => {
  const r = R.resolveReminderTargets({ status: 'en_attente_chef', ferme: 'BAHIA' });
  assert.deepEqual(r.profiles, []);
  assert.equal(r.ferme, 'BAHIA');
});

test('resolveReminderTargets — en_attente_dg → dg', () => {
  assert.deepEqual(R.resolveReminderTargets({ status: 'en_attente_dg' }), {
    profiles: ['dg'],
    ferme: null,
  });
});

test('resolveReminderTargets — valide_dg + mode virement → finance', () => {
  for (const mode of ['comptant_virement', 'virement_bancaire']) {
    assert.deepEqual(R.resolveReminderTargets({ status: 'valide_dg', mode_paiement: mode }), {
      profiles: ['finance'],
      ferme: null,
    });
  }
});

test('resolveReminderTargets — valide_dg hors virement → achats', () => {
  assert.deepEqual(R.resolveReminderTargets({ status: 'valide_dg', mode_paiement: 'cheque' }), {
    profiles: ['achats'],
    ferme: null,
  });
  assert.deepEqual(R.resolveReminderTargets({ status: 'valide_dg' }), {
    profiles: ['achats'],
    ferme: null,
  });
});

test('resolveReminderTargets — virement_lance → dg, virement_signe → achats', () => {
  assert.deepEqual(R.resolveReminderTargets({ status: 'virement_lance' }), { profiles: ['dg'], ferme: null });
  assert.deepEqual(R.resolveReminderTargets({ status: 'virement_signe' }), { profiles: ['achats'], ferme: null });
});

test('resolveReminderTargets — statut non relançable → null', () => {
  for (const status of ['brouillon', 'rejete', 'envoye', 'recu', undefined, '']) {
    assert.equal(R.resolveReminderTargets({ status }), null, `statut ${status}`);
  }
});

// ── Cooldown 4 h ─────────────────────────────────────────────────────────────

test('reminderCooldown — jamais relancé (0 / absent) → non bloqué', () => {
  const now = 10 * DAY;
  assert.equal(R.reminderCooldown(0, now).blocked, false);
  assert.equal(R.reminderCooldown(undefined, now).blocked, false);
  assert.equal(R.reminderCooldown(null, now).blocked, false);
});

test('reminderCooldown — bloqué < 4 h avec les heures restantes arrondies au supérieur', () => {
  const now = 10 * DAY;
  assert.deepEqual(R.reminderCooldown(now - 1 * HOUR, now), { blocked: true, hoursLeft: 3 });
  assert.deepEqual(R.reminderCooldown(now - 30 * 60 * 1000, now), { blocked: true, hoursLeft: 4 });
  assert.equal(R.reminderCooldown(now - 3.5 * HOUR, now).hoursLeft, 1);
});

test('reminderCooldown — exactement 4 h écoulées → non bloqué', () => {
  const now = 10 * DAY;
  assert.equal(R.reminderCooldown(now - R.REMINDER_COOLDOWN_MS, now).blocked, false);
  assert.equal(R.reminderCooldown(now - 5 * HOUR, now).blocked, false);
});

// ── Durée d'attente lisible ──────────────────────────────────────────────────

test('formatWaitingDuration — heures : singulier / pluriel / plancher à 1 heure', () => {
  const now = 10 * DAY;
  assert.equal(R.formatWaitingDuration(now, now), '1 heure'); // 0 h → plancher
  assert.equal(R.formatWaitingDuration(now - 1 * HOUR, now), '1 heure');
  assert.equal(R.formatWaitingDuration(now - 2 * HOUR, now), '2 heures');
  assert.equal(R.formatWaitingDuration(now - 23 * HOUR, now), '23 heures');
});

test('formatWaitingDuration — jours dès 24 h : singulier / pluriel', () => {
  const now = 10 * DAY;
  assert.equal(R.formatWaitingDuration(now - 1 * DAY, now), '1 jour');
  assert.equal(R.formatWaitingDuration(now - 47 * HOUR, now), '1 jour');
  assert.equal(R.formatWaitingDuration(now - 2 * DAY, now), '2 jours');
  assert.equal(R.formatWaitingDuration(now - 12 * DAY, now), '12 jours');
});
