'use strict';

/**
 * Tests du tool `relancer_bdc` (functions/dgAgent.js).
 *
 * Le point structurant vérifié ici : le tool N'ENVOIE JAMAIS. Il pré-contrôle
 * (statut relançable + cooldown 4 h) et dépose son intention dans le contexte
 * d'invocation ; un refus ne pose AUCUNE intention. L'envoi (remindBdcCore)
 * appartient à dgBot, après confirmation explicite.
 *
 * Firestore est stubé dans le require-cache (même technique que
 * tests/unit/bdcReminderService.test.js) : un seul document purchase_orders.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const FN_DIR = path.join(__dirname, '..', '..', 'functions');
const HOUR = 60 * 60 * 1000;

const store = { docs: [] };

function makeFakeDb() {
  return {
    collection(name) {
      assert.equal(name, 'purchase_orders');
      const q = {
        where: () => q,
        limit: () => q,
        get: async () => ({
          empty: store.docs.length === 0,
          docs: store.docs.map((d) => ({ id: d.id, data: () => d.data })),
        }),
      };
      return q;
    },
  };
}

function stub(request, exportsObj) {
  const resolved = require.resolve(request, { paths: [FN_DIR] });
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: exportsObj };
}

stub('./config/firebase', { db: makeFakeDb() });
stub('./firestoreDataService', { getSyncStatus: async () => ({}) });
stub('./forecastService', { getForecast: async () => null });

const { TOOL_HANDLERS } = require(path.join(FN_DIR, 'dgAgent.js'));
const relancer = TOOL_HANDLERS.relancer_bdc;

function seed(data) {
  store.docs = [{ id: 'bdc-id-1', data: Object.assign({ numero: 'BDC-2026-0142' }, data) }];
}

test('BdC introuvable → erreur, aucune intention', async () => {
  store.docs = [];
  const ctx = { user: null, relanceIntent: null };
  const out = await relancer({ numero: 'BDC-2026-9999' }, ctx);
  assert.match(out.error, /Aucun BdC/);
  assert.equal(ctx.relanceIntent, null);
});

test('numero manquant → erreur, aucune intention', async () => {
  const ctx = { user: null, relanceIntent: null };
  const out = await relancer({ numero: '   ' }, ctx);
  assert.match(out.error, /numero requis/);
  assert.equal(ctx.relanceIntent, null);
});

test('statut non relançable → refus immédiat, aucune intention', async () => {
  seed({ status: 'brouillon' });
  const ctx = { user: null, relanceIntent: null };
  const out = await relancer({ numero: 'BDC-2026-0142' }, ctx);
  assert.equal(out.relancable, false);
  assert.match(out.error, /Aucun rappel possible/);
  assert.equal(ctx.relanceIntent, null);
});

test('cooldown 4 h actif → refus immédiat, aucune intention', async () => {
  seed({ status: 'en_attente_dg', last_reminded_at: Date.now() - HOUR });
  const ctx = { user: null, relanceIntent: null };
  const out = await relancer({ numero: 'BDC-2026-0142' }, ctx);
  assert.equal(out.relancable, false);
  assert.match(out.error, /Patientez encore/);
  assert.equal(ctx.relanceIntent, null);
});

test('ferme sans chef (aucun destinataire) → refus, aucune intention', async () => {
  seed({ status: 'en_attente_chef', ferme: 'FERME-INCONNUE' });
  const ctx = { user: null, relanceIntent: null };
  const out = await relancer({ numero: 'BDC-2026-0142' }, ctx);
  assert.equal(out.relancable, false);
  assert.match(out.error, /destinataire/);
  assert.equal(ctx.relanceIntent, null);
});

test('BdC relançable → intention déposée dans ctx, RIEN envoyé', async () => {
  seed({ status: 'en_attente_dg', fournisseur: { nom: 'AGRIMATCO' }, ferme: 'F1', last_reminded_at: Date.now() - 5 * HOUR });
  const ctx = {
    user: { uid: 'u1', profileId: 'dg', displayName: 'Omar', email: 'omar@berrygood.ma' },
    relanceIntent: null,
  };
  const out = await relancer({ numero: 'BDC-2026-0142' }, ctx);

  assert.equal(out.relancable, true);
  assert.equal(out.confirmationRequise, true);
  assert.deepEqual(out.destinataires, ['dg']);
  assert.equal(out.error, undefined);

  assert.deepEqual(ctx.relanceIntent, {
    id: 'bdc-id-1',
    numero: 'BDC-2026-0142',
    fournisseur: 'AGRIMATCO',
    ferme: 'F1',
    profiles: ['dg'],
    by: { uid: 'u1', profileId: 'dg', name: 'Omar', email: 'omar@berrygood.ma' },
  });
});

test('deux relances dans le MÊME tour : une seule armée, l\'écrasée est tracée', async () => {
  const ctx = { user: null, relanceIntent: null, relanceDiscarded: [] };

  store.docs = [{ id: 'bdc-id-1', data: { numero: 'BDC-2026-0142', status: 'en_attente_dg', last_reminded_at: 0 } }];
  await relancer({ numero: 'BDC-2026-0142' }, ctx);

  store.docs = [{ id: 'bdc-id-2', data: { numero: 'BDC-2026-0199', status: 'en_attente_dg', last_reminded_at: 0 } }];
  await relancer({ numero: 'BDC-2026-0199' }, ctx);

  assert.equal(ctx.relanceIntent.numero, 'BDC-2026-0199', 'seule la dernière est armée');
  assert.deepEqual(ctx.relanceDiscarded, ['BDC-2026-0142'], 'l\'écrasée est annoncée, pas perdue');
});

test('réarmer le MÊME BdC dans un tour est idempotent (rien à annoncer)', async () => {
  const ctx = { user: null, relanceIntent: null, relanceDiscarded: [] };
  seed({ status: 'en_attente_dg', last_reminded_at: 0 });
  await relancer({ numero: 'BDC-2026-0142' }, ctx);
  await relancer({ numero: 'BDC-2026-0142' }, ctx);
  assert.equal(ctx.relanceIntent.numero, 'BDC-2026-0142');
  assert.deepEqual(ctx.relanceDiscarded, []);
});

test('sans contexte d\'invocation → pas de relance armée', async () => {
  seed({ status: 'en_attente_dg', last_reminded_at: 0 });
  const out = await relancer({ numero: 'BDC-2026-0142' }, undefined);
  assert.match(out.error, /Contexte d'invocation/);
});
