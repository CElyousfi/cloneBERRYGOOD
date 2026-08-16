'use strict';

/**
 * campagne-analytique-cache-key.test.js — verrou du SITE D'APPEL.
 *
 * Ce que ce test couvre, et que tests/unit/pointage-cache-key.test.js NE couvre
 * PAS : les tests du helper `pointageCacheKey` vérifient son invariant (trois
 * périmètres → trois clés), mais ils l'appellent DIRECTEMENT. Ils resteraient
 * verts si `computeCampagneAnalytiqueDetail` cessait de lui passer
 * `cultureFilter` — c'était précisément le bug. Un test d'helper ne verrouille
 * pas un site d'appel.
 *
 * On observe donc la clé RÉELLEMENT passée à `withCache` : le middleware de
 * cache est remplacé par un espion AVANT le chargement de pointageService (qui
 * déstructure `withCache` au require), et on appelle la vraie fonction.
 * Retirer le 3e argument au site d'appel rend ce fichier ROUGE.
 *
 * Pourquoi c'est un enjeu de sécurité et pas de perf : `withCache` écrit dans
 * un cache Firestore PARTAGÉ par clé. Deux périmètres qui ne diffèrent que par
 * la culture (chef_f5 = F5 + culture_filtre='Myrtille' vs un appel interne
 * F5 toutes cultures) partageraient la même entrée → le second lit le payload
 * du premier, hors de son périmètre, pendant tout le TTL (30 min).
 *
 * Aucune lecture Firestore réelle : le cache est espionné (le calcul n'est
 * jamais exécuté) et `db.collection` est stubbé pour le warm du référentiel.
 */

const test = require('node:test');
const assert = require('node:assert');

// ---------------------------------------------------------------------------
// Harnais — l'ORDRE des require est significatif.
// ---------------------------------------------------------------------------

// 1. Neutraliser les lectures Firestore (warmRefTaches → referentiel_taches).
//    `db` est l'instance partagée : la méthode surchargée ici est celle que
//    voient pointageService ET le middleware de cache.
const { db } = require('../../functions/config/firebase');
db.collection = function () {
  return {
    get: async () => ({ forEach() {} }),
    doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }),
  };
};

// 2. Espionner withCache AVANT le chargement de pointageService, qui fait
//    `const { withCache } = require("./middleware/cache")` : la déstructuration
//    fige la référence au moment du require.
const cacheMiddleware = require('../../functions/middleware/cache');
/** @type {string[]} clés observées, dans l'ordre des appels. */
const seenKeys = [];
cacheMiddleware.withCache = async function (cacheKey) {
  seenKeys.push(cacheKey);
  // Le calcul (fetchFn) n'est VOLONTAIREMENT pas exécuté : on teste la clé,
  // pas le payload — et surtout on ne touche ni au mirror ni à Firestore.
  return { success: true, __stubbedByTest: true };
};

// 3. Charger la cible.
const { computeCampagneAnalytiqueDetail } = require('../../functions/pointageService');

/** Début de la campagne courante — même règle que la fonction sous test. */
function campagneStart(now) {
  const d = now || new Date();
  const y = d.getFullYear();
  return `${d.getMonth() >= 6 ? y : y - 1}-07-01`;
}

// v2 : la base porte le bump de la réponse enrichie de `nbOuv` (cf.
// tests/unit/campagneAnalytiqueDetailNbOuv.test.js). Les trois dimensions de
// périmètre s'ajoutent APRÈS la base, elles sont orthogonales au versionnage.
const BASE = `campagne_analytique_detail_v2_${campagneStart()}`;

/** Appelle la vraie fonction et renvoie la clé qu'elle a passée à withCache. */
async function keyFor(fermeFilter, cultureFilter) {
  seenKeys.length = 0;
  await computeCampagneAnalytiqueDetail(fermeFilter, cultureFilter);
  assert.strictEqual(seenKeys.length, 1, 'withCache doit être appelé exactement une fois');
  return seenKeys[0];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('le site d’appel passe les TROIS dimensions (base, ferme, culture)', async () => {
  assert.strictEqual(await keyFor('F5', 'Myrtille'), `${BASE}_F5_myrtille`);
});

test('même ferme, culture différente → clés distinctes (REGRESSION GUARD)', async () => {
  // ⚠️ C'est CE test qui tombe rouge si `cultureFilter` disparaît des arguments
  // de pointageCacheKey dans computeCampagneAnalytiqueDetail : les deux appels
  // produiraient alors la même clé `…_F5`, et le payload toutes-cultures serait
  // servi au chef Myrtille.
  const toutesCultures = await keyFor('F5', null);
  const myrtille = await keyFor('F5', 'Myrtille');
  assert.notStrictEqual(myrtille, toutesCultures,
    `fuite de périmètre : (F5, null) et (F5, Myrtille) partagent la clé ${myrtille}`);
});

test('la dimension ferme reste passée (REGRESSION GUARD)', async () => {
  // Symétrique du précédent : garde le 2e argument, historique, sous surveillance.
  const rh = await keyFor(null, null);
  const chef = await keyFor('F5', null);
  assert.notStrictEqual(chef, rh, `fuite de périmètre : RH et chef F5 partagent la clé ${chef}`);
  assert.strictEqual(rh, `${BASE}_all`);
});

test('les quatre périmètres réalistes sont deux à deux distincts', async () => {
  const keys = [
    await keyFor(null, null),          // RH / DG / Finance
    await keyFor('F5', 'Myrtille'),    // chef_f5
    await keyFor('F1', 'Myrtille'),
    await keyFor('F5', null),          // appel interne (export serveur)
  ];
  assert.strictEqual(new Set(keys).size, keys.length, `collision : ${keys.join(', ')}`);
});

test('sans périmètre (défaut) → clé globale _all', async () => {
  // Les appelants historiques sans culture_filtre gardent EXACTEMENT leur clé :
  // ajouter la 3e dimension n'invalide aucun cache existant.
  assert.strictEqual(await keyFor(), `${BASE}_all`);
});
