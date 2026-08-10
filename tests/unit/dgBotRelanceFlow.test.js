'use strict';

/**
 * Tests d'ORCHESTRATION de handleDgMessage (functions/dgBot.js) sur la relance BdC.
 *
 * Les tests de dgBotRelance.test.js couvrent les décisions pures ; ici on vérifie
 * l'invariant qu'elles ne peuvent pas prouver seules :
 *
 *   une intention de relance est consommée au message SUIVANT, quel qu'il soit,
 *   Y COMPRIS quand un autre mécanisme (confirmation forecast) capte ce message.
 *
 * Sans ça, un « oui » adressé au forecast laisse l'intention vivante et le « ok »
 * suivant part en rappel WhatsApp réel chez un chef de ferme.
 *
 * Firestore / WhatsApp / agent / forecast / service de rappel sont stubés dans le
 * require-cache AVANT le require de dgBot (technique de bdcReminderService.test.js).
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FN_DIR = path.join(__dirname, '..', '..', 'functions');
const PHONE = '212600000000';
const USER = { uid: 'u1', profileId: 'dg', displayName: 'Omar', email: 'omar@berrygood.ma' };
const SESSION_TTL_MS = 30 * 60 * 1000;

// ── État observable des stubs ────────────────────────────────────────────────
const sessions = new Map();
const sent = [];
const reminders = [];
const asked = [];
const savedForecasts = [];
let agentResponse = null;

function stub(request, exportsObj) {
  const resolved = require.resolve(request, { paths: [FN_DIR] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

stub('./config/firebase', {
  db: {
    collection(name) {
      assert.equal(name, 'whatsapp_sessions');
      return {
        doc(id) {
          return {
            get: async () => ({ exists: sessions.has(id), data: () => sessions.get(id) }),
            set: async (value) => { sessions.set(id, value); },
          };
        },
      };
    },
  },
});
stub('./whatsappService', {
  sendTextMessage: async (phone, text) => { sent.push(text); },
  downloadMedia: async () => ({ error: 'stub' }),
});
stub('./dgAgent', {
  ask: async (args) => { asked.push(args); return agentResponse; },
});
stub('./forecastService', {
  saveForecast: async (fruitCode, year, weeks) => { savedForecasts.push({ fruitCode, year, weeks }); return { success: true }; },
});
stub('./bdcReminderService', {
  remindBdcCore: async (payload) => {
    reminders.push(payload);
    return { success: true, profiles: ['chef_f1'], duration: '2 jours' };
  },
});

const { handleDgMessage } = require(path.join(FN_DIR, 'dgBot.js'));

// ── Helpers ──────────────────────────────────────────────────────────────────
function seedSession(data) {
  const now = Date.now();
  sessions.set(PHONE, {
    phone: PHONE, profileId: 'dg', data,
    updatedAt: now, expiresAt: now + SESSION_TTL_MS,
  });
}

function pendingRelance() {
  return { id: 'bdc-id-1', numero: 'BDC-2026-0142', profiles: ['chef_f1'], by: { profileId: 'dg', name: 'Omar' }, at: Date.now() };
}

function pendingForecast() {
  return {
    fruitCode: 'RASP', year: 2026,
    weeks: [{ week: 12, minMad: 40, maxMad: 45, year: 2026 }],
    sourceImageUrl: 'https://example/slide.png', at: Date.now(),
  };
}

function text(body) {
  return { type: 'text', text: { body } };
}

function storedData() {
  return (sessions.get(PHONE) || {}).data || {};
}

beforeEach(() => {
  sessions.clear();
  sent.length = 0;
  reminders.length = 0;
  asked.length = 0;
  savedForecasts.length = 0;
  agentResponse = { success: true, reply: 'Réponse agent.', history: [], relanceIntent: null };
});

// ── Test 1 — le « oui » tardif ───────────────────────────────────────────────

test('un « oui » APRÈS un message intermédiaire n\'envoie AUCUN rappel', async () => {
  seedSession({ history: [], pendingRelance: pendingRelance() });

  // Message intermédiaire : l'intention doit être consommée + annulation annoncée.
  await handleDgMessage(PHONE, USER, text('et la récolte de lundi ?'));
  assert.equal(reminders.length, 0, 'aucun rappel sur le message intermédiaire');
  assert.equal(storedData().pendingRelance, undefined, 'intention effacée de la session');
  assert.ok(sent.some((m) => /BDC-2026-0142/.test(m) && /annul/i.test(m)), 'annulation annoncée');

  // Le « oui » tardif ne trouve plus rien à confirmer.
  await handleDgMessage(PHONE, USER, text('oui'));
  assert.equal(reminders.length, 0, 'AUCUN rappel envoyé par le « oui » tardif');
});

// ── Test 2 — coexistence forecast + relance ──────────────────────────────────

test('« OUI » avec un forecast ET une relance en attente : forecast traité, relance annulée', async () => {
  seedSession({ history: [], pendingForecast: pendingForecast(), pendingRelance: pendingRelance() });

  await handleDgMessage(PHONE, USER, text('OUI'));

  // Le forecast garde la priorité (comportement historique inchangé).
  assert.equal(savedForecasts.length, 1, 'le forecast est enregistré');
  assert.ok(sent.some((m) => /Forecast/.test(m)), 'confirmation forecast envoyée');

  // Et surtout : la relance ne survit pas, et son annulation est annoncée.
  assert.equal(reminders.length, 0, 'aucun rappel envoyé par ce « OUI »');
  assert.equal(storedData().pendingRelance, undefined, 'aucune intention de relance ne survit');
  assert.ok(sent.some((m) => /BDC-2026-0142/.test(m) && /annul/i.test(m)), 'annulation de la relance annoncée');

  // Le message de courtoisie suivant ne doit RIEN déclencher.
  await handleDgMessage(PHONE, USER, text('ok'));
  assert.equal(reminders.length, 0, 'aucun rappel différé');
});

// ── Test 3 — le chemin nominal reste vivant ──────────────────────────────────

test('confirmation nominale : « oui » sur une relance seule déclenche l\'envoi une fois', async () => {
  seedSession({ history: [], pendingRelance: pendingRelance() });

  await handleDgMessage(PHONE, USER, text('oui'));

  assert.equal(reminders.length, 1);
  assert.deepEqual(reminders[0], {
    id: 'bdc-id-1',
    by: { profileId: 'dg', name: 'Omar' },
    via: 'whatsapp',
  });
  assert.equal(storedData().pendingRelance, undefined, 'intention consommée après envoi');
  assert.ok(sent.some((m) => /Rappel/.test(m) && /BDC-2026-0142/.test(m)));

  // Un second « oui » ne rejoue pas l'envoi.
  await handleDgMessage(PHONE, USER, text('oui'));
  assert.equal(reminders.length, 1, 'pas de double envoi');
});

// ── Test 4 — texte vide ──────────────────────────────────────────────────────

test('message texte vide : l\'intention est consommée et l\'annulation annoncée', async () => {
  seedSession({ history: [], pendingRelance: pendingRelance() });

  await handleDgMessage(PHONE, USER, text('   '));

  assert.equal(reminders.length, 0);
  assert.equal(storedData().pendingRelance, undefined, 'intention consommée');
  assert.ok(sent.some((m) => /BDC-2026-0142/.test(m) && /annul/i.test(m)), 'annulation annoncée');
});

// ── Test 5 — nouvelle intention posée par l'agent ────────────────────────────

test('l\'agent arme une intention : horodatée en session, aucun envoi immédiat', async () => {
  agentResponse = {
    success: true,
    reply: 'Je confirme la relance de BDC-2026-0199 ?',
    history: [],
    relanceIntent: { id: 'bdc-id-2', numero: 'BDC-2026-0199', profiles: ['dg'], by: { profileId: 'dg' } },
  };

  await handleDgMessage(PHONE, USER, text('relance BDC-2026-0199'));

  assert.equal(reminders.length, 0, 'le tour qui arme n\'envoie jamais');
  const stored = storedData().pendingRelance;
  assert.equal(stored.numero, 'BDC-2026-0199');
  assert.ok(typeof stored.at === 'number' && stored.at > 0, 'intention horodatée');
  assert.equal(asked[0].user, USER, 'identité propagée à l\'agent');
});

// ── Test 6 — remplacement d'une intention par une autre ──────────────────────

test('seconde demande sur un autre BdC : remplacement annoncé, ancienne intention perdue', async () => {
  seedSession({ history: [], pendingRelance: pendingRelance() });
  agentResponse = {
    success: true,
    reply: 'Je confirme la relance de BDC-2026-0199 ?',
    history: [],
    relanceIntent: { id: 'bdc-id-2', numero: 'BDC-2026-0199', profiles: ['dg'], by: { profileId: 'dg' } },
  };

  await handleDgMessage(PHONE, USER, text('relance plutôt BDC-2026-0199'));

  assert.equal(reminders.length, 0);
  assert.equal(storedData().pendingRelance.numero, 'BDC-2026-0199');
  assert.ok(
    sent.some((m) => /BDC-2026-0142/.test(m) && /BDC-2026-0199/.test(m) && /annul/i.test(m)),
    'remplacement annoncé avec les deux numéros'
  );
});
