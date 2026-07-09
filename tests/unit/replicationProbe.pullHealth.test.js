'use strict';

/**
 * replicationProbe.pullHealth.test.js — LE test qui manquait.
 *
 * Prouve que le check pull-health (mode-b) s'exécute ET alerte MÊME quand la
 * lecture SQL de la sonde échoue (serveur down), scénario le plus grave (18
 * échecs / 15h de gel constatés SANS alerte avant ce fix).
 *
 * ── Mécanisme d'injection d'une VRAIE panne de connexion ──
 * `runReplicationProbe(deps)` accepte des dépendances injectables. On force
 * `getPoolProd` à THROW une erreur de connexion réaliste
 * (`Failed to connect to 105.145.33.128:1433 ...`), exactement comme mssql le
 * fait quand le serveur est injoignable. On injecte aussi :
 *   - `db` : un faux Firestore en mémoire qui répond
 *     sql_sync_status/latest.consecutiveFailures = 18 (état réel de gel) ;
 *   - `whatsapp` : un faux service qui CAPTURE les appels sendTemplateMessage.
 * Puis on asserte qu'une alerte general_alert est bien partie MALGRÉ l'échec SQL.
 *
 * Aucun SQL vivant, aucun Firestore réel : tout est injecté → test déterministe.
 */

const test = require('node:test');
const assert = require('node:assert');

const svc = require('../../functions/sqlSyncService');

const NOW = new Date('2026-07-09T10:00:00Z');

// --- Faux Firestore minimal (collection/doc/get/set) piloté par une map. ---
function makeFakeFirestore(docs) {
  // docs: { 'coll/id': {data} | null }  (null => n'existe pas)
  const writes = [];
  return {
    writes,
    collection(coll) {
      return {
        doc(id) {
          const key = coll + '/' + id;
          return {
            async get() {
              const data = Object.prototype.hasOwnProperty.call(docs, key) ? docs[key] : null;
              return {
                exists: data != null,
                data: () => data,
              };
            },
            async set(payload, opts) {
              writes.push({ key, payload, opts: opts || null });
              docs[key] = Object.assign({}, docs[key], payload);
            },
          };
        },
      };
    },
  };
}

// --- Faux service WhatsApp qui capture les envois. ---
function makeFakeWhatsapp(recipients) {
  const sends = [];
  return {
    sends,
    async resolveRecipientsForProfile() {
      return recipients;
    },
    async sendTemplateMessage(phone, template, params) {
      sends.push({ phone, template, params });
      return { success: true };
    },
  };
}

// --- Erreur de connexion mssql réaliste (serveur injoignable). ---
function connectionError() {
  const e = new Error('Failed to connect to 105.145.33.128:1433 - Could not connect (sequence)');
  e.code = 'ESOCKET';
  return e;
}

// ---------------------------------------------------------------------------
// LE cas critique : SQL down + consecutiveFailures=18 → alerte DOIT partir.
// ---------------------------------------------------------------------------
test('SQL down (getPoolProd throw) + consecutiveFailures=18 → alerte pull_failing envoyée', async () => {
  const fs = makeFakeFirestore({
    'sql_sync_status/latest': { consecutiveFailures: 18, lastSuccessAt: '2026-07-08T18:05:00Z' },
    'sql_mirror_pointage_meta/config': { availableDates: ['2026-07-07'] },
    'replication_probe_state/pull_health': null, // première détection
  });
  const wa = makeFakeWhatsapp([{ phone: '212600000000' }]);

  let pullHealthCalled = false;
  const evalPullHealthSpy = async (probeData, now, opts, deps) => {
    pullHealthCalled = true;
    // On appelle la VRAIE fonction pour prouver le bout-en-bout (Firestore + envoi).
    return svc.evaluateAndAlertPullHealth(probeData, now, opts, deps);
  };

  await svc.runReplicationProbe({
    now: NOW,
    getPool: async () => { throw connectionError(); },
    getPoolProd: async () => { throw connectionError(); },
    db: fs,
    whatsapp: wa,
    evaluateAndAlertPullHealth: evalPullHealthSpy,
    // staleness NE doit PAS tourner (dépend de la lecture SQL réussie).
    evaluateAndAlertStaleness: async () => {
      throw new Error('evaluateAndAlertStaleness ne doit pas être appelé quand SQL est down');
    },
  });

  assert.strictEqual(pullHealthCalled, true, 'evaluateAndAlertPullHealth DOIT être appelé malgré SQL down');
  assert.strictEqual(wa.sends.length, 1, 'une alerte WhatsApp doit partir');
  assert.strictEqual(wa.sends[0].template, 'general_alert');
  assert.match(wa.sends[0].params[0], /pull pointage en panne/);
  assert.match(wa.sends[0].params[0], /18 fois/);
});

// ---------------------------------------------------------------------------
// Pas de faux positif : SQL down MAIS consecutiveFailures=0 → aucune alerte.
// ---------------------------------------------------------------------------
test('SQL down + consecutiveFailures=0 → PAS d\'alerte (pas de faux positif)', async () => {
  const fs = makeFakeFirestore({
    'sql_sync_status/latest': { consecutiveFailures: 0, lastSuccessAt: '2026-07-09T09:05:00Z' },
    'sql_mirror_pointage_meta/config': { availableDates: ['2026-07-08'] },
    'replication_probe_state/pull_health': null,
  });
  const wa = makeFakeWhatsapp([{ phone: '212600000000' }]);

  await svc.runReplicationProbe({
    now: NOW,
    getPool: async () => { throw connectionError(); },
    getPoolProd: async () => { throw connectionError(); },
    db: fs,
    whatsapp: wa,
    evaluateAndAlertStaleness: async () => { throw new Error('ne doit pas tourner'); },
  });

  assert.strictEqual(wa.sends.length, 0, 'aucune alerte ne doit partir si consecutiveFailures=0');
});

// ---------------------------------------------------------------------------
// evaluateAndAlertPullHealth avec probeData null ne throw jamais.
// ---------------------------------------------------------------------------
test('evaluateAndAlertPullHealth(probeData=null) ne throw pas', async () => {
  const fs = makeFakeFirestore({
    'sql_sync_status/latest': { consecutiveFailures: 5 },
    'sql_mirror_pointage_meta/config': { availableDates: ['2026-07-06'] },
    'replication_probe_state/pull_health': null,
  });
  const wa = makeFakeWhatsapp([{ phone: '212600000000' }]);

  await assert.doesNotReject(async () => {
    await svc.evaluateAndAlertPullHealth(null, NOW, { probeSqlFailed: true }, { db: fs, whatsapp: wa });
  });
  assert.strictEqual(wa.sends.length, 1);
});
