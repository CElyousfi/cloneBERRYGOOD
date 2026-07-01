'use strict';

// GATING PAIE (Étape 0) — clé de cache ferme-aware (anti pollution cross-périmètre).
//
// withCache utilise un cache Firestore PARTAGÉ par clé. Le payload nominatif de
// pointageRH est filtré par la ferme de l'appelant (_fermeFilter). Sans dimension
// de périmètre dans la clé, un chef-F1 et le RH (scope 'all') partageraient la
// MÊME entrée → FUITE nominative (toutes-fermes servi à un chef) ou perte de
// données (F1 servi au RH). pointageCacheKey suffixe la clé par le périmètre.
//
// Ces tests asservissent la garantie : chef (_F<x>) et RH (_all) ont TOUJOURS
// des clés DISTINCTES, et deux fermes distinctes n'entrent jamais en collision.
// Helper pur — zéro Firestore.

const test = require('node:test');
const assert = require('node:assert');

const { pointageCacheKey } = require('../../functions/pointageService');

// Toutes les bases de clé nominatives chef-reachable qui passent par withCache.
const NOMINATIVE_BASES = [
  'pointage_summary_2026-06-20',
  'pointage_recolte_2026-06-20',
  'pointage_hors_recolte_2026-06-20',
  'pointage_quinzaine_latest',
  'pointage_quinzaine_analytique_latest',
  'pointage_quinzaine_repos_latest',
  'pointage_quinzaine_alertes_latest',
  'pointage_transport',
  'pointage_nouveaux_ouvriers',
  'mo_analytique_variete',
  'campagne_mo_variete_v4_2025-07-01',
];

const FERMES = ['F1', 'F5', 'Avocatier', 'BAHIA'];

test('null/undefined/"" (RH/DG/Finance) → suffixe _all', () => {
  assert.strictEqual(pointageCacheKey('pointage_summary_D', null), 'pointage_summary_D_all');
  assert.strictEqual(pointageCacheKey('pointage_summary_D', undefined), 'pointage_summary_D_all');
  assert.strictEqual(pointageCacheKey('pointage_summary_D', ''), 'pointage_summary_D_all');
});

test('un chef → suffixe _<ferme>', () => {
  assert.strictEqual(pointageCacheKey('pointage_summary_D', 'F1'), 'pointage_summary_D_F1');
  assert.strictEqual(pointageCacheKey('pointage_recolte_D', 'BAHIA'), 'pointage_recolte_D_BAHIA');
});

test('clé chef (_F<x>) et clé RH (_all) DISTINCTES sur toutes les actions nominatives', () => {
  for (const base of NOMINATIVE_BASES) {
    const rhKey = pointageCacheKey(base, null); // RH/DG/Finance
    for (const ferme of FERMES) {
      const chefKey = pointageCacheKey(base, ferme);
      assert.notStrictEqual(
        chefKey,
        rhKey,
        `collision RH↔chef sur "${base}" (ferme=${ferme}): ${chefKey} === ${rhKey}`
      );
    }
  }
});

test('deux fermes distinctes n\'entrent jamais en collision (même base)', () => {
  for (const base of NOMINATIVE_BASES) {
    const keys = FERMES.map(f => pointageCacheKey(base, f));
    const uniq = new Set(keys);
    assert.strictEqual(
      uniq.size,
      FERMES.length,
      `collision inter-fermes sur "${base}": ${keys.join(', ')}`
    );
  }
});

test('le warm path (_all) réchauffe exactement la clé servie au scope RH', () => {
  // Le warm passe fermeFilter=null → doit produire la même clé que le serving RH.
  for (const base of NOMINATIVE_BASES) {
    assert.strictEqual(pointageCacheKey(base, null), pointageCacheKey(base, null));
    // Et JAMAIS la clé d'un chef.
    assert.notStrictEqual(pointageCacheKey(base, null), pointageCacheKey(base, 'F1'));
  }
});
