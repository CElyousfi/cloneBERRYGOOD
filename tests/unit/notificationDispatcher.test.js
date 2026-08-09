'use strict';

/**
 * Tests de functions/notificationDispatcher.js — valeur de retour du dispatcher.
 *
 * Le module require ./config/firebase et ./whatsappService au chargement : on les
 * STUB dans le require-cache AVANT de require le dispatcher (même technique que
 * tests/unit/bdcReminderService.test.js).
 *
 * Objectif LOT 3bis : prouver que `sendWhatsAppToProfiles` retourne TOUJOURS un
 * objet {sent, failed, recipients} sur ses trois sorties (zéro destinataire,
 * chemin nominal, catch global), et que `dispatchNotification` expose le compte
 * WhatsApp (décisionnel) séparément du canal in-app (informatif).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FN_DIR = path.join(__dirname, '..', '..', 'functions');

// ── Faux Firestore ───────────────────────────────────────────────────────────
// Deux collections acceptées : `alerts` (in-app) et `whatsapp_logs` (annotation
// du log quand `relatedDoc` est fourni). NE PAS assert sur le nom ici : cet
// accès a lieu DANS le try de sendWhatsAppToProfiles, donc un throw serait avalé
// par le catch global et se manifesterait par un `sent: 0` inexplicable.
const alerts = [];
const fakeDb = {
  collection(name) {
    if (name === 'alerts') {
      return { add: async (doc) => { alerts.push(doc); return { id: `alert${alerts.length}` }; } };
    }
    if (name === 'whatsapp_logs') {
      // Log introuvable → le code saute l'update, sans lever.
      return { where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) };
    }
    throw new Error(`collection inattendue dans ce test : ${name}`);
  },
};

// ── Faux whatsappService pilotable ───────────────────────────────────────────
const wa = {
  recipients: [],       // destinataires renvoyés par resolveRecipientsForProfile
  resolveThrows: false, // simule une panne de résolution (→ catch global)
  sendResults: [],      // succès/échec, consommés dans l'ordre d'appel
  sentPhones: [],
};

function stub(request, exportsObj) {
  const resolved = require.resolve(request, { paths: [FN_DIR] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

stub('./config/firebase', { db: fakeDb });
stub('./whatsappService', {
  resolveRecipientsForProfile: async () => {
    if (wa.resolveThrows) throw new Error('resolve KO');
    return wa.recipients;
  },
  sendTemplateMessage: async (phone) => {
    wa.sentPhones.push(phone);
    const ok = wa.sendResults.shift();
    return ok ? { success: true, waMessageId: `wamid.${phone}` } : { success: false, error: 'token expired' };
  },
});

const { dispatchNotification } = require(path.join(FN_DIR, 'notificationDispatcher.js'));

function reset(opts) {
  alerts.length = 0;
  wa.sentPhones.length = 0;
  wa.recipients = (opts && opts.recipients) || [];
  wa.resolveThrows = !!(opts && opts.resolveThrows);
  wa.sendResults = (opts && opts.sendResults) || [];
}

function dispatch() {
  return dispatchNotification({
    type: 'bdc_reminder',
    profiles: ['chef_f1'],
    ferme: 'F1',
    data: { numero: 'BDC-1', montant: '100 MAD', duration: '2 jours', message: 'Rappel BDC-1' },
  });
}

// ── Sortie 1/3 : aucun destinataire résolu ──────────────────────────────────

test('dispatchNotification — zéro destinataire → whatsapp.sent = 0 (et non undefined)', async () => {
  reset({ recipients: [] });
  const r = await dispatch();
  assert.deepEqual(r.whatsapp, { sent: 0, failed: 0, recipients: 0 });
  assert.equal(wa.sentPhones.length, 0, 'aucun envoi tenté');
  // L'alerte in-app est bien écrite malgré tout : elle ne prouve rien.
  assert.equal(r.in_app.created, true);
  assert.equal(alerts.length, 1);
});

// ── Sortie 2/3 : chemin nominal ─────────────────────────────────────────────

test('dispatchNotification — tous les envois passent → sent = nombre de destinataires', async () => {
  reset({
    recipients: [{ phone: '212600000001', profileId: 'chef_f1' }, { phone: '212600000002', profileId: 'chef_f1' }],
    sendResults: [true, true],
  });
  const r = await dispatch();
  assert.deepEqual(r.whatsapp, { sent: 2, failed: 0, recipients: 2 });
});

test('dispatchNotification — envoi partiel → sent compte les seuls destinataires atteints', async () => {
  reset({
    recipients: [
      { phone: '212600000001', profileId: 'chef_f1' },
      { phone: '212600000002', profileId: 'chef_f1' },
      { phone: '212600000003', profileId: 'chef_f1' },
    ],
    sendResults: [false, true, false],
  });
  const r = await dispatch();
  assert.deepEqual(r.whatsapp, { sent: 1, failed: 2, recipients: 3 });
});

test('dispatchNotification — tous les envois échouent → sent = 0 mais recipients > 0', async () => {
  reset({
    recipients: [{ phone: '212600000001', profileId: 'chef_f1' }],
    sendResults: [false],
  });
  const r = await dispatch();
  assert.deepEqual(r.whatsapp, { sent: 0, failed: 1, recipients: 1 });
});

test('dispatchNotification — avec relatedDoc : le log whatsapp_logs est annoté sans casser le compte', async () => {
  reset({ recipients: [{ phone: '212600000001', profileId: 'chef_f1' }], sendResults: [true] });
  const r = await dispatchNotification({
    type: 'bdc_reminder',
    profiles: ['chef_f1'],
    ferme: 'F1',
    data: { numero: 'BDC-1', montant: '100 MAD', duration: '2 jours', message: 'Rappel BDC-1' },
    relatedDoc: 'purchase_orders/BDC1',
  });
  assert.deepEqual(r.whatsapp, { sent: 1, failed: 0, recipients: 1 });
});

test('dispatchNotification — doublons de téléphone dédoublonnés avant envoi', async () => {
  reset({
    recipients: [{ phone: '212600000001', profileId: 'chef_f1' }, { phone: '212600000001', profileId: 'dg' }],
    sendResults: [true, true],
  });
  const r = await dispatch();
  assert.deepEqual(r.whatsapp, { sent: 1, failed: 0, recipients: 1 });
  assert.equal(wa.sentPhones.length, 1);
});

// ── Sortie 3/3 : catch global ───────────────────────────────────────────────

test('dispatchNotification — erreur de résolution → whatsapp.sent = 0 (objet, pas undefined)', async () => {
  reset({ resolveThrows: true });
  const r = await dispatch();
  assert.deepEqual(r.whatsapp, { sent: 0, failed: 0, recipients: 0 });
});

// ── Canal WhatsApp inactif ──────────────────────────────────────────────────

test('dispatchNotification — canal in_app seul → whatsapp.sent = 0, in_app informatif', async () => {
  reset({ recipients: [{ phone: '212600000001', profileId: 'dg' }], sendResults: [true] });
  const r = await dispatchNotification({
    type: 'bdc_reminder',
    profiles: ['dg'],
    data: { message: 'Rappel BDC-1' },
    channels: ['in_app'],
  });
  assert.deepEqual(r.whatsapp, { sent: 0, failed: 0, recipients: 0 });
  assert.deepEqual(r.in_app, { attempted: true, created: true });
  assert.equal(wa.sentPhones.length, 0);
});

test('dispatchNotification — type inconnu de TEMPLATE_MAP → aucun envoi WhatsApp', async () => {
  reset({ recipients: [{ phone: '212600000001', profileId: 'dg' }], sendResults: [true] });
  const r = await dispatchNotification({
    type: 'type_inexistant',
    profiles: ['dg'],
    data: { message: 'coucou' },
  });
  assert.deepEqual(r.whatsapp, { sent: 0, failed: 0, recipients: 0 });
  assert.equal(wa.sentPhones.length, 0);
});
