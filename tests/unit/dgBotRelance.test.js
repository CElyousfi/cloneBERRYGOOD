'use strict';

/**
 * Tests des décisions PURES de la relance BdC depuis WhatsApp (functions/dgBot.js) :
 *   - normalizeRelanceReply : vocabulaire FERMÉ de confirmation, tout le reste annule ;
 *   - resolvePendingRelance : machine à états (valide / expirée / consommée) ;
 *   - buildRelanceNotice    : annulation jamais silencieuse, remplacement annoncé.
 *
 * dgBot require Firebase Admin, WhatsApp, l'agent, forecast et le service de
 * rappel au chargement. On les STUB dans le require-cache AVANT de require le
 * module — même technique que tests/unit/bdcReminderService.test.js. Aucune de
 * ces dépendances n'est appelée ici : les fonctions testées n'ont aucun I/O.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FN_DIR = path.join(__dirname, '..', '..', 'functions');

function stub(request, exportsObj) {
  const resolved = require.resolve(request, { paths: [FN_DIR] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

stub('./config/firebase', { db: {} });
stub('./whatsappService', { sendTextMessage: async () => {}, downloadMedia: async () => ({}) });
stub('./dgAgent', { ask: async () => ({ success: false, error: 'stub' }) });
stub('./forecastService', {});
stub('./bdcReminderService', { remindBdcCore: async () => ({ success: false, error: 'stub' }) });

const {
  normalizeRelanceReply,
  resolvePendingRelance,
  buildRelanceNotice,
  PENDING_RELANCE_TTL_MS,
} = require(path.join(FN_DIR, 'dgBot.js'));

const T0 = 1_800_000_000_000;
const pendingA = { id: 'abc', numero: 'BDC-2026-0142', at: T0 };

// ── normalizeRelanceReply ────────────────────────────────────────────────────

test('TTL de la relance = 5 minutes', () => {
  assert.equal(PENDING_RELANCE_TTL_MS, 5 * 60 * 1000);
});

test('normalize: chaque variante du vocabulaire fermé confirme', () => {
  for (const t of ['oui', 'ok', 'confirme', 'vas y', 'go']) {
    assert.equal(normalizeRelanceReply(t), 'confirme', `"${t}" doit confirmer`);
  }
});

test('normalize: casse, accents, ponctuation et espaces superflus ignorés', () => {
  for (const t of ['OUI', 'Oui !', '  ok  ', 'OK.', 'confirmé', 'Confirmé !', 'vas-y', 'Vas-y !', 'GO', 'vas   y']) {
    assert.equal(normalizeRelanceReply(t), 'confirme', `"${t}" doit confirmer`);
  }
});

test('normalize: tout le reste est "autre" (défaut = non-envoi)', () => {
  const nonConfirmations = [
    'non',
    'peut-être',
    'oui mais attends',
    'ok pour demain',
    'c\'est qui le bloqueur ?',
    'et la récolte du jour ?',
    'annule',
    '',
    null,
    undefined,
    '👍',
  ];
  for (const t of nonConfirmations) {
    assert.equal(normalizeRelanceReply(t), 'autre', `${JSON.stringify(t)} ne doit PAS confirmer`);
  }
});

// ── resolvePendingRelance : machine à états ──────────────────────────────────

test('état: aucune intention en attente → "none"', () => {
  assert.equal(resolvePendingRelance(null, 'oui', T0).outcome, 'none');
  assert.equal(resolvePendingRelance(undefined, 'oui', T0).outcome, 'none');
});

test('état: confirmation valide dans le délai → "confirm"', () => {
  assert.equal(resolvePendingRelance(pendingA, 'oui', T0 + 1000).outcome, 'confirm');
});

test('état: réponse ambiguë → "cancel" (jamais d\'envoi)', () => {
  assert.equal(resolvePendingRelance(pendingA, 'peut-être', T0 + 1000).outcome, 'cancel');
  assert.equal(resolvePendingRelance(pendingA, 'et la météo demain ?', T0 + 1000).outcome, 'cancel');
});

test('état: bornes d\'expiration à 5 min (juste avant / pile / juste après)', () => {
  assert.equal(resolvePendingRelance(pendingA, 'oui', T0 + PENDING_RELANCE_TTL_MS - 1).outcome, 'confirm');
  assert.equal(resolvePendingRelance(pendingA, 'oui', T0 + PENDING_RELANCE_TTL_MS).outcome, 'confirm');
  assert.equal(resolvePendingRelance(pendingA, 'oui', T0 + PENDING_RELANCE_TTL_MS + 1).outcome, 'expired');
});

test('état: intention sans horodatage → traitée comme expirée (fail-closed)', () => {
  assert.equal(resolvePendingRelance({ id: 'abc', numero: 'BDC-1' }, 'oui', T0).outcome, 'expired');
});

test('LE cas qui compte : un "oui" APRÈS un message intermédiaire n\'envoie rien', () => {
  // Tour 1 — le DG demande une relance : intention posée.
  let pending = { id: 'abc', numero: 'BDC-2026-0142', at: T0 };

  // Tour 2 — message intermédiaire : l'intention est CONSOMMÉE (annulée).
  const t2 = resolvePendingRelance(pending, 'et la récolte de lundi ?', T0 + 10_000);
  assert.equal(t2.outcome, 'cancel');
  assert.ok(buildRelanceNotice(t2.outcome, pending, null), 'annulation annoncée');
  pending = null; // dgBot vide toujours pendingRelance après consommation

  // Tour 3 — le "oui" tardif ne trouve plus rien à confirmer.
  assert.equal(resolvePendingRelance(pending, 'oui', T0 + 20_000).outcome, 'none');
});

// ── buildRelanceNotice ───────────────────────────────────────────────────────

test('notice: annulation faute de confirmation, annoncée avec le numéro', () => {
  const notice = buildRelanceNotice('cancel', pendingA, null);
  assert.match(notice, /BDC-2026-0142/);
  assert.match(notice, /annul/i);
  assert.match(notice, /aucun rappel n'a été envoyé/i);
});

test('notice: expiration annoncée, jamais silencieuse', () => {
  const notice = buildRelanceNotice('expired', pendingA, null);
  assert.match(notice, /BDC-2026-0142/);
  assert.match(notice, /expir/i);
});

test('notice: seconde demande sur un AUTRE BdC → remplacement annoncé', () => {
  const notice = buildRelanceNotice('cancel', pendingA, { numero: 'BDC-2026-0199' });
  assert.match(notice, /BDC-2026-0142/);
  assert.match(notice, /BDC-2026-0199/);
  assert.match(notice, /annul/i);
});

test('notice: seconde demande sur le MÊME BdC → simple re-confirmation, pas d\'annulation', () => {
  assert.equal(buildRelanceNotice('cancel', pendingA, { numero: 'BDC-2026-0142' }), null);
  assert.equal(buildRelanceNotice('expired', pendingA, { numero: 'BDC-2026-0142' }), null);
});

test('notice: rien à annoncer sans intention, ni sur confirmation', () => {
  assert.equal(buildRelanceNotice('none', null, null), null);
  assert.equal(buildRelanceNotice('confirm', pendingA, null), null);
});
