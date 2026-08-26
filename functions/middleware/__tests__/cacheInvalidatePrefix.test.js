'use strict';

// invalidateCachePrefix — purge des entrées `api_cache` par PRÉFIXE de clé.
//
// POURQUOI CE TEST EXISTE
// -----------------------
// La réponse de `campagne-conso-parcelle` est cachée 30 min et y résout la
// catégorie engrais/pesticide à la LECTURE. Classer un article change donc
// cette réponse — mais sans purge, l'écran resservirait l'ancienne pendant une
// demi-heure : on classe, on recharge, RIEN ne change, et la fonctionnalité
// paraît cassée sans la moindre erreur.
//
// Le risque réel n'est pas « ça plante », c'est « la purge tape à côté » :
//   - purger la seule clé exacte (`…_all`) laisserait les périmètres chefs
//     (`…_f1`, `…_f1_framboise`) sur une réponse périmée ;
//   - une borne haute mal posée purgerait TOUTE la collection `api_cache`
//     (tous les écrans repartent à froid), ou rien du tout.
// Ce sont les deux bords que ce fichier tient.
//
// LIMITE ASSUMÉE, DITE FRANCHEMENT : l'émulateur Firestore ne tourne pas sur
// cette machine (aucun runtime Java), et l'interdiction de toucher la prod est
// absolue. Firestore est donc remplacé par un DOUBLE en mémoire qui implémente
// le filtre `documentId()` par comparaison de chaînes — exactement la sémantique
// que Firestore applique aux identifiants de document. Ce test prouve que les
// BORNES de la requête sont justes ; il ne prouve pas que Firestore répond comme
// on le croit. C'est la partie qui reste à vérifier sur un vrai backend.

const test = require('node:test');
const assert = require('node:assert');

// ------------------------------------------------------- double Firestore

/** Documents en mémoire : id -> data. */
let store = new Map();
/** Nombre de commits de batch (pour vérifier le tronçonnage). */
let commits = 0;

function makeDocRef(id) {
  return {
    id,
    get: async () => ({
      exists: store.has(id),
      data: () => store.get(id),
    }),
    set: async (d) => { store.set(id, d); },
    delete: async () => { store.delete(id); },
  };
}

/**
 * Requête sur les identifiants de document : accumule les contraintes puis les
 * applique par comparaison de chaînes (sémantique Firestore pour documentId()).
 */
function makeQuery(constraints) {
  return {
    where(field, op, value) {
      assert.strictEqual(field, 'DOCUMENT_ID', 'le filtre doit porter sur documentId()');
      return makeQuery(constraints.concat([{ op, value }]));
    },
    async get() {
      const ids = [...store.keys()].filter((id) => constraints.every((c) => {
        if (c.op === '>=') return id >= c.value;
        if (c.op === '<') return id < c.value;
        throw new Error('opérateur non simulé: ' + c.op);
      })).sort();
      return {
        empty: ids.length === 0,
        docs: ids.map((id) => ({ id, ref: makeDocRef(id) })),
      };
    },
  };
}

const fakeDb = {
  collection(name) {
    assert.strictEqual(name, 'api_cache');
    return Object.assign(makeQuery([]), { doc: makeDocRef });
  },
  batch() {
    const ops = [];
    return {
      delete(ref) { ops.push(ref); },
      async commit() { commits += 1; for (const r of ops) await r.delete(); },
    };
  },
};

const fakeAdmin = { firestore: { FieldPath: { documentId: () => 'DOCUMENT_ID' } } };

// Injection AVANT le chargement de cache.js : le module lit `db`/`admin` à
// l'import (monolithe sans DI, cf. TODO_REFACTO.md).
const firebasePath = require.resolve('../../config/firebase');
require.cache[firebasePath] = {
  id: firebasePath,
  filename: firebasePath,
  loaded: true,
  exports: { db: fakeDb, admin: fakeAdmin, bucket: null },
};

const { withCache, invalidateCachePrefix } = require('../cache');
const { CONSO_PARCELLE_CACHE_PREFIX } = require('../../lib/consoBons/cacheKeys');

const PREFIX = CONSO_PARCELLE_CACHE_PREFIX + '2026-2027';
// Les 4 périmètres tels que les produit `pointageCacheKey`.
const CIBLES = [PREFIX + '_all', PREFIX + '_f1', PREFIX + '_f1_framboise', PREFIX + '_bahia'];
// Voisins qui doivent SURVIVRE : autre campagne, autre action.
const VOISINS = [
  CONSO_PARCELLE_CACHE_PREFIX + '2025-2026_all',
  'campagne_mo_variete_v4_2026-2027_all',
];

function seed() {
  store = new Map();
  commits = 0;
  for (const k of CIBLES.concat(VOISINS)) {
    store.set(k, { _payload: JSON.stringify({ marque: k }), _cachedAt: Date.now() });
  }
}

// ---------------------------------------------------------------- tests

test('la purge supprime TOUS les périmètres du préfixe, et EUX SEULS', async () => {
  seed();
  const n = await invalidateCachePrefix(PREFIX);
  assert.strictEqual(n, CIBLES.length, 'les 4 entrées de périmètre doivent être purgées');
  for (const k of CIBLES) {
    assert.ok(!store.has(k), 'périmètre non purgé : ' + k
      + ' — un chef resterait 30 min sur une réponse où l\'article est encore « à classer »');
  }
  for (const k of VOISINS) {
    assert.ok(store.has(k), 'entrée purgée à tort : ' + k
      + ' — la purge doit être BORNÉE au préfixe, pas vider api_cache');
  }
});

test('après purge, withCache RECALCULE au lieu de resservir l\'ancienne réponse', async () => {
  seed();
  let recalculs = 0;
  const fetchFn = async () => { recalculs += 1; return { marque: 'RECALCUL' }; };

  const avant = await withCache(PREFIX + '_all', 30 * 60 * 1000, fetchFn);
  assert.strictEqual(recalculs, 0, 'entrée fraîche : le cache doit servir sans recalculer');
  assert.strictEqual(avant.marque, PREFIX + '_all', 'c\'est bien la valeur CACHÉE qui est servie');
  assert.strictEqual(avant.cached, true);

  await invalidateCachePrefix(PREFIX);

  const apres = await withCache(PREFIX + '_all', 30 * 60 * 1000, fetchFn);
  assert.strictEqual(recalculs, 1, 'après purge, la réponse doit être RECALCULÉE');
  assert.strictEqual(apres.marque, 'RECALCUL');
  assert.notStrictEqual(apres.cached, true);
});

test('préfixe sans correspondance : 0 suppression, aucun dégât', async () => {
  seed();
  const n = await invalidateCachePrefix('campagne_conso_parcelle_v9_2026-2027');
  assert.strictEqual(n, 0);
  assert.strictEqual(store.size, CIBLES.length + VOISINS.length);
});

test('préfixe vide : refus net (ne JAMAIS vider toute la collection)', async () => {
  seed();
  assert.strictEqual(await invalidateCachePrefix(''), 0);
  assert.strictEqual(await invalidateCachePrefix(null), 0);
  assert.strictEqual(await invalidateCachePrefix(undefined), 0);
  assert.strictEqual(store.size, CIBLES.length + VOISINS.length, 'aucune entrée ne doit disparaître');
});

test('au-delà de 400 entrées, la purge est tronçonnée (limite Firestore 500/batch)', async () => {
  store = new Map();
  commits = 0;
  for (let i = 0; i < 850; i += 1) {
    store.set(PREFIX + '_p' + String(i).padStart(4, '0'), { _cachedAt: Date.now() });
  }
  const n = await invalidateCachePrefix(PREFIX);
  assert.strictEqual(n, 850);
  assert.strictEqual(store.size, 0);
  assert.strictEqual(commits, 3, '850 suppressions = 3 batches de 400 max');
});
