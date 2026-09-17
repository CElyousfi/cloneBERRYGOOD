'use strict';

/**
 * Tests de functions/src/modules/magasin/bdcReminderService.js (remindBdcCore) — I/O du rappel BDC.
 *
 * Le service require ./config/firebase (init Firebase Admin) et
 * ./notificationDispatcher (envoi WhatsApp) au chargement. Pour rester
 * hermétique, on STUB ces deux modules dans le require-cache AVANT de require le
 * service — même technique que tests/unit/pointageBdpSyncTarget.test.js.
 *
 * Objectif : prouver la non-régression du refactor LOT 3 (extraction de l'action
 * HTTP remind-bdc), en particulier la forme exacte de l'objet passé à
 * dispatchNotification (paramètres du template Meta `bdc_reminder`).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FN_DIR = path.join(__dirname, '..', '..', 'functions');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ── Fake Firestore : un seul document purchase_orders, writes enregistrés ─────
const store = { doc: null, exists: true, updates: [] };

function makeFakeDb() {
  return {
    collection(name) {
      assert.equal(name, 'purchase_orders');
      return {
        doc(id) {
          return {
            id,
            get: async () => ({
              exists: store.exists,
              data: () => store.doc,
            }),
            update: async (data) => {
              store.updates.push(data);
            },
          };
        },
      };
    },
  };
}

// ── Stubs require-cache ──────────────────────────────────────────────────────
const dispatched = [];

// Résultat renvoyé par le faux dispatchNotification. Par défaut : 1 destinataire
// WhatsApp atteint (chemin nominal). Les tests le surchargent via seed().
let dispatchResult = null;

function defaultDispatchResult() {
  return {
    whatsapp: { sent: 1, failed: 0, recipients: 1 },
    in_app: { attempted: true, created: true },
  };
}

function stub(request, exportsObj) {
  const resolved = require.resolve(request, { paths: [FN_DIR] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

stub('./config/firebase', { db: makeFakeDb() });
stub('./src/modules/admin/notificationDispatcher', {
  dispatchNotification: async (payload) => {
    dispatched.push(payload);
    return dispatchResult;
  },
});

const { remindBdcCore } = require(path.join(FN_DIR, 'src/modules/magasin/bdcReminderService.js'));

function seed(bdc, opts) {
  store.doc = bdc;
  store.exists = !(opts && opts.missing);
  store.updates.length = 0;
  dispatched.length = 0;
  dispatchResult = (opts && opts.dispatchResult) || defaultDispatchResult();
}

// ── Cas d'erreur ─────────────────────────────────────────────────────────────

test('remindBdcCore — id manquant → 400 "ID requis"', async () => {
  seed({});
  assert.deepEqual(await remindBdcCore({}), { success: false, statusCode: 400, error: 'ID requis' });
  assert.equal(dispatched.length, 0);
});

test('remindBdcCore — BDC introuvable → 404 "BDC non trouvé"', async () => {
  seed(null, { missing: true });
  assert.deepEqual(await remindBdcCore({ id: 'BDC1' }), {
    success: false,
    statusCode: 404,
    error: 'BDC non trouvé',
  });
  assert.equal(dispatched.length, 0);
});

test('remindBdcCore — statut non relançable → 400 avec le statut dans le message', async () => {
  seed({ status: 'brouillon' });
  const r = await remindBdcCore({ id: 'BDC1' });
  assert.deepEqual(r, {
    success: false,
    statusCode: 400,
    error: 'Aucun rappel possible dans le statut "brouillon"',
  });
  assert.equal(dispatched.length, 0);
  assert.equal(store.updates.length, 0);
});

test('remindBdcCore — cooldown actif → 400 avec les heures restantes, aucun envoi', async () => {
  seed({ status: 'en_attente_dg', last_reminded_at: Date.now() - 1 * HOUR });
  const r = await remindBdcCore({ id: 'BDC1' });
  assert.equal(r.success, false);
  assert.equal(r.statusCode, 400);
  assert.equal(r.error, 'Rappel déjà envoyé récemment. Patientez encore 3h avant un nouveau rappel.');
  assert.equal(dispatched.length, 0);
  assert.equal(store.updates.length, 0);
});

test('remindBdcCore — 2e appel consécutif refusé par le cooldown (1er OK)', async () => {
  seed({ status: 'en_attente_dg', numero: 'BDC-2026-001', updated_at: Date.now() - 3 * DAY });
  const first = await remindBdcCore({ id: 'BDC1' });
  assert.equal(first.success, true);

  // Le 2e appel relit le doc mis à jour : on rejoue l'update sur le fixture.
  store.doc = Object.assign({}, store.doc, store.updates[0]);
  const second = await remindBdcCore({ id: 'BDC1' });
  assert.equal(second.success, false);
  assert.equal(second.statusCode, 400);
  assert.match(second.error, /^Rappel déjà envoyé récemment\. Patientez encore 4h avant un nouveau rappel\.$/);
  assert.equal(dispatched.length, 1, 'un seul envoi WhatsApp');
});

// ── Cas nominal : payload de notification + écritures ─────────────────────────

test('remindBdcCore — payload dispatchNotification inchangé (template bdc_reminder)', async () => {
  seed({
    status: 'en_attente_chef',
    ferme: 'F1',
    numero: 'BDC-2026-007',
    total_ttc: 1200,
    updated_at: Date.now() - 3 * DAY,
  });
  const r = await remindBdcCore({ id: 'BDC7' });
  assert.deepEqual(r, { success: true, profiles: ['chef_f1'], duration: '3 jours' });

  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0], {
    type: 'bdc_reminder',
    profiles: ['chef_f1'],
    ferme: 'F1',
    data: {
      numero: 'BDC-2026-007',
      montant: '1200 MAD',
      duration: '3 jours',
      message: 'Rappel: BDC BDC-2026-007 en attente depuis 3 jours',
    },
    relatedDoc: 'purchase_orders/BDC7',
  });
});

test('remindBdcCore — sans numero ni total_ttc : fallback id et tiret cadratin', async () => {
  seed({ status: 'en_attente_dg', updated_at: Date.now() - 5 * HOUR });
  const r = await remindBdcCore({ id: 'BDC9' });
  assert.equal(r.success, true);
  assert.equal(dispatched[0].data.numero, 'BDC9');
  assert.equal(dispatched[0].data.montant, '—');
  assert.equal(dispatched[0].data.duration, '5 heures');
  assert.equal(dispatched[0].ferme, null);
});

test('remindBdcCore — écrit history / last_reminded_at / reminder_count', async () => {
  const by = { uid: 'u1', profileId: 'achats', name: 'Achats' };
  seed({
    status: 'valide_dg',
    mode_paiement: 'virement_bancaire',
    numero: 'BDC-2026-010',
    updated_at: Date.now() - 2 * DAY,
    reminder_count: 2,
    history: [{ action: 'creation' }],
  });
  const before = Date.now();
  const r = await remindBdcCore({ id: 'BDC10', by });
  assert.deepEqual(r, { success: true, profiles: ['finance'], duration: '2 jours' });

  assert.equal(store.updates.length, 1);
  const up = store.updates[0];
  assert.equal(up.reminder_count, 3);
  assert.ok(up.last_reminded_at >= before && up.last_reminded_at <= Date.now());
  assert.equal(up.history.length, 2, 'history existant préservé');
  const entry = up.history[1];
  assert.equal(entry.action, 'rappel');
  assert.deepEqual(entry.by, by);
  assert.equal(entry.at, up.last_reminded_at);
  assert.equal(entry.comment, 'Rappel envoyé à finance (en attente depuis 2 jours)');
  assert.equal(entry.via, 'dashboard');
});

test('remindBdcCore — by absent → {} ; via explicite tracé dans history', async () => {
  seed({ status: 'virement_signe', numero: 'BDC-2026-011', updated_at: Date.now() - 1 * DAY });
  const r = await remindBdcCore({ id: 'BDC11', via: 'whatsapp' });
  assert.deepEqual(r, { success: true, profiles: ['achats'], duration: '1 jour' });
  const entry = store.updates[0].history[0];
  assert.deepEqual(entry.by, {});
  assert.equal(entry.via, 'whatsapp');
  assert.equal(entry.comment, 'Rappel envoyé à achats (en attente depuis 1 jour)');
});

test('remindBdcCore — sans updated_at ni created_at → durée plancher "1 heure"', async () => {
  seed({ status: 'virement_lance', numero: 'BDC-2026-012' });
  const r = await remindBdcCore({ id: 'BDC12' });
  assert.deepEqual(r, { success: true, profiles: ['dg'], duration: '1 heure' });
});

// ── LOT 3bis : la décision porte sur les humains WhatsApp atteints ───────────
// Invariant : `whatsapp.sent === 0` → refus, et AUCUNE écriture (pas de
// last_reminded_at, pas de reminder_count, pas d'history) → cooldown non armé.

function waResult(sent, failed, recipients, inApp) {
  return {
    whatsapp: { sent, failed, recipients },
    in_app: inApp || { attempted: true, created: true },
  };
}

test('remindBdcCore — aucun destinataire (ferme sans chef) → refus, aucune écriture', async () => {
  seed(
    { status: 'en_attente_chef', ferme: 'F3', numero: 'BDC-2026-020', updated_at: Date.now() - 2 * DAY, reminder_count: 4 },
    { dispatchResult: waResult(0, 0, 0) }
  );
  const r = await remindBdcCore({ id: 'BDC20' });
  assert.deepEqual(r, {
    success: false,
    statusCode: 400,
    error: 'Rappel non envoyé : aucun destinataire — vérifiez la ferme du BDC.',
  });
  assert.equal(dispatched.length, 1, 'la tentative d\'envoi a bien eu lieu');
  assert.equal(store.updates.length, 0, 'ni last_reminded_at, ni reminder_count, ni history');
});

test('remindBdcCore — tous les envois WhatsApp échouent → refus "réessayez", aucune écriture', async () => {
  seed(
    { status: 'en_attente_dg', numero: 'BDC-2026-021', updated_at: Date.now() - 2 * DAY },
    { dispatchResult: waResult(0, 3, 3) }
  );
  const r = await remindBdcCore({ id: 'BDC21' });
  assert.deepEqual(r, {
    success: false,
    statusCode: 400,
    error: "Rappel non envoyé : l'envoi a échoué, réessayez.",
  });
  assert.equal(store.updates.length, 0);
});

test('remindBdcCore — envoi partiel (1 sur 3) → succès et cooldown armé', async () => {
  seed(
    { status: 'en_attente_dg', numero: 'BDC-2026-022', updated_at: Date.now() - 2 * DAY, reminder_count: 1 },
    { dispatchResult: waResult(1, 2, 3) }
  );
  const r = await remindBdcCore({ id: 'BDC22' });
  assert.deepEqual(r, { success: true, profiles: ['dg'], duration: '2 jours' });
  assert.equal(store.updates.length, 1);
  assert.equal(store.updates[0].reminder_count, 2);
  assert.ok(store.updates[0].last_reminded_at, 'cooldown armé');
});

test('remindBdcCore — alerte in-app écrite à vide + 0 destinataire WhatsApp → refus quand même', async () => {
  // Piège du ticket : createInAppAlert écrit son document `alerts` même avec
  // profiles: [] et "réussit". Si la décision s'appuyait sur l'agrégat des
  // canaux, ce cas donnerait sent=1 et armerait le cooldown sans que personne
  // ne soit prévenu. La décision doit ignorer `in_app`.
  seed(
    { status: 'en_attente_chef', ferme: 'F9', numero: 'BDC-2026-023', updated_at: Date.now() - 2 * DAY },
    { dispatchResult: waResult(0, 0, 0, { attempted: true, created: true }) }
  );
  const r = await remindBdcCore({ id: 'BDC23' });
  assert.equal(r.success, false, 'in_app.created=true ne doit JAMAIS valoir notification');
  assert.equal(r.statusCode, 400);
  assert.equal(r.error, 'Rappel non envoyé : aucun destinataire — vérifiez la ferme du BDC.');
  assert.equal(store.updates.length, 0);
});

test('remindBdcCore — après un refus : reminder_count inchangé et relance immédiate acceptée', async () => {
  // Preuve d'ÉTAT (pas de libellé) : le cooldown 4h n'a pas été armé.
  seed(
    { status: 'en_attente_chef', ferme: 'F1', numero: 'BDC-2026-024', updated_at: Date.now() - 2 * DAY, reminder_count: 7 },
    { dispatchResult: waResult(0, 0, 0) }
  );
  const refused = await remindBdcCore({ id: 'BDC24' });
  assert.equal(refused.success, false);
  assert.equal(store.updates.length, 0);
  assert.equal(store.doc.reminder_count, 7, 'reminder_count inchangé');
  assert.equal(store.doc.last_reminded_at, undefined, 'cooldown non armé');

  // Ferme corrigée / token WhatsApp rétabli : la relance immédiate passe.
  dispatchResult = waResult(1, 0, 1);
  const retry = await remindBdcCore({ id: 'BDC24' });
  assert.equal(retry.success, true, 'aucun cooldown ne bloque la relance');
  assert.equal(store.updates.length, 1);
  assert.equal(store.updates[0].reminder_count, 8);
  assert.equal(store.updates[0].history.length, 1, 'une seule entrée history : le refus n\'en a pas écrit');
});

test('remindBdcCore — dispatcher muet (retour undefined) → refus prudent + console.error explicite', async () => {
  // Le fallback fail-closed est indiscernable d'un vrai zéro destinataire côté
  // utilisateur : le mode de panne doit au moins être visible dans les logs CF.
  seed({ status: 'en_attente_dg', numero: 'BDC-2026-025', updated_at: Date.now() - 2 * DAY });
  dispatchResult = undefined; // ancien contrat : dispatchNotification ne retournait rien

  const logged = [];
  const originalError = console.error;
  console.error = (msg) => logged.push(String(msg));
  let r;
  try {
    r = await remindBdcCore({ id: 'BDC25' });
  } finally {
    console.error = originalError;
  }

  assert.equal(r.success, false);
  assert.equal(store.updates.length, 0);
  assert.equal(logged.length, 1, 'le contrat rompu est tracé');
  assert.match(logged[0], /BDC25/);
  assert.match(logged[0], /dispatchNotification/);
});
