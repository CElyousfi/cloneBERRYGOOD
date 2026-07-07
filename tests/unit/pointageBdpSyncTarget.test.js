'use strict';

// Tests du paramètre `target` de syncPointageFromProd (functions/pointageBdpSync.js).
//
// Objectif P3 : prouver que
//   - target='test' (défaut) écrit UNIQUEMENT dans sql_mirror_pointage_bdp_test
//     et NE reconstruit PAS le meta/workers live (témoin-only, inchangé).
//   - target='live' écrit dans le mirror LIVE sql_mirror_pointage + reconstruit
//     le meta + workers, borné aux dates de la plage (upsert, aucune suppression).
//
// La fonction crée son pool SQL et charge ses configs en interne. Pour rester
// hermétique (pas de SQL réel, pas d'init Firebase Admin réseau), on STUB dans le
// require-cache : mssql, ./config/firebase, ./config/sqlConfigProd, mapBdpRow et
// ./sqlSyncService AVANT de require le module testé.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const FN_DIR = path.join(__dirname, '..', '..', 'functions');

// ── Fake Firestore minimal : enregistre les writes par collection/doc ────────
function makeFakeFirestore() {
  const writes = {}; // { collectionName: { docId: data } }
  function collection(name) {
    if (!writes[name]) writes[name] = {};
    return {
      doc(id) {
        return {
          id,
          set(data) {
            writes[name][id] = data;
            return Promise.resolve();
          },
        };
      },
    };
  }
  function batch() {
    const pending = [];
    return {
      set(ref, data) {
        pending.push([ref, data]);
      },
      commit() {
        for (const [ref, data] of pending) writes[ref._col][ref.id] = data;
        pending.length = 0;
        return Promise.resolve();
      },
    };
  }
  // batch.set utilise ref._col ; on augmente collection().doc() pour le fournir.
  const origCollection = collection;
  function collectionWithCol(name) {
    const c = origCollection(name);
    const origDoc = c.doc;
    c.doc = function (id) {
      const d = origDoc(id);
      d._col = name;
      return d;
    };
    return c;
  }
  return { collection: collectionWithCol, batch, __writes: writes };
}

// ── Injection de stubs dans le require-cache ─────────────────────────────────
const rebuildCalls = { meta: 0, workers: 0 };

function stub(request, exportsObj) {
  const resolved = require.resolve(request, { paths: [FN_DIR] });
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: exportsObj,
  };
  return resolved;
}

// mssql : pool factice renvoyant N lignes brutes selon la requête.
let FAKE_ROWS = [];
const fakeMssql = {
  connect: async () => ({
    request() {
      const req = {
        input() { return req; },
        async query(q) {
          // GRAIN_DIAG_SQL contient "nb_ouvriers" ; RECONSTRUCTION_SQL non.
          if (/nb_ouvriers/.test(q)) return { recordset: [] };
          return { recordset: FAKE_ROWS };
        },
      };
      return req;
    },
  }),
};

// admin.firestore.FieldValue.serverTimestamp()
const fakeAdmin = {
  firestore: { FieldValue: { serverTimestamp: () => '__ts__' } },
};

stub('mssql', fakeMssql);
stub('./config/firebase', { admin: fakeAdmin, db: makeFakeFirestore() });
stub('./config/sqlConfigProd', {});
stub('./lib/pointageBdp/mapBdpRow', {
  // mapping identité minimal : garde DateStr + Personnel_Matricule + Periode_paie.
  mapBdpRowToContract: (raw) => ({
    DateStr: raw.DateStr,
    Personnel_Matricule: raw.Personnel_Matricule,
    Personnel_Nom: raw.Personnel_Nom,
    Periode_paie: raw.Periode_paie,
  }),
});
stub('./sqlSyncService', {
  rebuildPointageMetaFromMirror: async () => { rebuildCalls.meta++; },
  rebuildPointageWorkersFromMirror: async () => { rebuildCalls.workers++; },
});

const { syncPointageFromProd } = require(path.join(FN_DIR, 'pointageBdpSync.js'));

const SAMPLE_ROWS = [
  { DateStr: '2026-07-01', Personnel_Matricule: 'M1', Personnel_Nom: 'A', Periode_paie: 'Quinzaine 24' },
  { DateStr: '2026-07-01', Personnel_Matricule: 'M2', Personnel_Nom: 'B', Periode_paie: 'Quinzaine 24' },
  { DateStr: '2026-07-02', Personnel_Matricule: 'M1', Personnel_Nom: 'A', Periode_paie: 'Quinzaine 24' },
];

test("target='test' (défaut) : écrit dans le témoin, PAS de meta rebuild", async () => {
  FAKE_ROWS = SAMPLE_ROWS;
  rebuildCalls.meta = 0; rebuildCalls.workers = 0;
  const fs = makeFakeFirestore();
  const res = await syncPointageFromProd(fs, { from: '2026-07-01', to: '2026-07-02' });

  assert.equal(res.success, true);
  assert.equal(res.target, 'test');
  assert.equal(res.jours, 2);
  assert.equal(res.lignes, 3);
  assert.equal(res.meta_rebuilt, false);
  // Écrit UNIQUEMENT dans la collection témoin.
  assert.ok(fs.__writes['sql_mirror_pointage_bdp_test']['2026-07-01']);
  assert.ok(fs.__writes['sql_mirror_pointage_bdp_test']['2026-07-02']);
  assert.equal(fs.__writes['sql_mirror_pointage_bdp_test']['2026-07-01'].source, 'bdp_reconstruction_temoin');
  // Ne touche JAMAIS le mirror live.
  assert.equal(fs.__writes['sql_mirror_pointage'], undefined);
  // Ne reconstruit PAS le meta/workers.
  assert.equal(rebuildCalls.meta, 0);
  assert.equal(rebuildCalls.workers, 0);
});

test("target='live' : écrit dans le mirror LIVE + reconstruit meta + workers", async () => {
  FAKE_ROWS = SAMPLE_ROWS;
  rebuildCalls.meta = 0; rebuildCalls.workers = 0;
  const fs = makeFakeFirestore();
  const res = await syncPointageFromProd(fs, { from: '2026-07-01', to: '2026-07-02', target: 'live' });

  assert.equal(res.success, true);
  assert.equal(res.target, 'live');
  assert.equal(res.jours, 2);
  assert.equal(res.meta_rebuilt, true);
  // Écrit dans le mirror LIVE (upsert des dates de la plage uniquement).
  assert.ok(fs.__writes['sql_mirror_pointage']['2026-07-01']);
  assert.ok(fs.__writes['sql_mirror_pointage']['2026-07-02']);
  assert.equal(fs.__writes['sql_mirror_pointage']['2026-07-01'].source, 'bdp_reconstruction_live');
  // Seules les dates de la plage sont écrites (pas de date hors plage).
  const liveDateKeys = Object.keys(fs.__writes['sql_mirror_pointage']).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
  assert.deepEqual(liveDateKeys.sort(), ['2026-07-01', '2026-07-02']);
  // meta + workers reconstruits exactement une fois.
  assert.equal(rebuildCalls.meta, 1);
  assert.equal(rebuildCalls.workers, 1);
});

test("garde-fou 0-ligne : aucune écriture date, pas de meta rebuild (les 2 cibles)", async () => {
  FAKE_ROWS = [];
  rebuildCalls.meta = 0; rebuildCalls.workers = 0;
  const fs = makeFakeFirestore();
  const res = await syncPointageFromProd(fs, { from: '2026-07-01', to: '2026-07-02', target: 'live' });

  assert.equal(res.success, true);
  assert.equal(res.empty, true);
  assert.equal(res.jours, 0);
  assert.equal(res.meta_rebuilt, false);
  // Aucun doc de date écrit dans le mirror live.
  assert.equal(fs.__writes['sql_mirror_pointage'], undefined);
  // Pas de reconstruction meta/workers sur une fenêtre vide.
  assert.equal(rebuildCalls.meta, 0);
  assert.equal(rebuildCalls.workers, 0);
  // _status écrit dans le témoin (jamais dans le live).
  assert.ok(fs.__writes['sql_mirror_pointage_bdp_test']['_status']);
});
