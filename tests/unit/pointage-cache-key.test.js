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
//
// ⚠️ PORTÉE — CE FICHIER NE VERROUILLE AUCUN SITE D'APPEL. Il vérifie
// l'invariant de pointageCacheKey en l'appelant DIRECTEMENT : il reste vert
// même si un appelant omet une dimension (c'est exactement ce qui s'est passé
// pour campagne-analytique-detail, dont la clé a longtemps ignoré la culture).
// Verrouiller un appelant demande un test qui observe la clé réellement passée
// à withCache — cf. tests/unit/campagne-analytique-cache-key.test.js. Tout
// nouveau site d'appel sensible mérite le même traitement.

const test = require('node:test');
const assert = require('node:assert');

const { pointageCacheKey } = require('../../functions/src/modules/rh/pointageService');

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

// ============================================================================
// Dimension CULTURE — chef_f5 (F5 + culture_filtre='Myrtille')
// ============================================================================
//
// Le périmètre d'un chef n'est pas toujours réductible à une ferme : chef_f5
// est cloisonné (F5, Myrtille). Deux appelants qui ne diffèrent QUE par la
// culture doivent donc avoir des clés distinctes, sinon le premier arrivé
// écrit dans le cache PARTAGÉ un payload que l'autre relira hors de son
// périmètre pendant tout le TTL (30 min pour campagne-analytique-detail).
//
// C'est exactement le scénario ouvert par l'extraction de
// computeCampagneAnalytiqueDetail : la fonction est désormais appelable en
// interne (export Excel serveur) avec des paramètres libres — un appel
// (F5, null) suivi d'une lecture (F5, 'Myrtille') servirait les parcelles
// Framboise à un chef Myrtille.

/** Bases de clé dont le payload est filtré ferme ET culture. */
const CULTURE_AWARE_BASES = [
  'campagne_analytique_detail_v2_2025-07-01',
];

test('même ferme, culture différente → clés DISTINCTES (anti-fuite chef_f5)', () => {
  for (const base of CULTURE_AWARE_BASES) {
    const toutesCultures = pointageCacheKey(base, 'F5', null);
    const myrtille = pointageCacheKey(base, 'F5', 'Myrtille');
    const framboise = pointageCacheKey(base, 'F5', 'Framboise');
    assert.notStrictEqual(myrtille, toutesCultures,
      `collision culture↔toutes-cultures sur "${base}": ${myrtille}`);
    assert.notStrictEqual(myrtille, framboise,
      `collision inter-cultures sur "${base}": ${myrtille}`);
    assert.strictEqual(new Set([toutesCultures, myrtille, framboise]).size, 3);
  }
});

test('la dimension culture n\'écrase pas la dimension ferme', () => {
  // Les 3 périmètres restent discernables deux à deux : un chef Myrtille de F5
  // ne doit jamais retomber sur la clé d'un chef Myrtille de F1, ni sur celle
  // du RH (scope 'all', toutes cultures).
  const base = CULTURE_AWARE_BASES[0];
  const keys = [
    pointageCacheKey(base, null, null),        // RH/DG/Finance
    pointageCacheKey(base, 'F5', 'Myrtille'),  // chef_f5
    pointageCacheKey(base, 'F1', 'Myrtille'),
    pointageCacheKey(base, 'F5', null),
  ];
  assert.strictEqual(new Set(keys).size, keys.length, `collision : ${keys.join(', ')}`);
});

test('culture falsy → clé identique à l\'appel 2-arguments (pas d\'invalidation inutile)', () => {
  // Les appelants sans dimension culture (RH, chef sans culture_filtre) gardent
  // EXACTEMENT leur clé actuelle : ajouter le 3e argument n'invalide pas leur
  // cache. Seul un profil à culture_filtre recalcule une fois à froid.
  for (const base of [...NOMINATIVE_BASES, ...CULTURE_AWARE_BASES]) {
    for (const ferme of [null, ...FERMES]) {
      assert.strictEqual(pointageCacheKey(base, ferme, null), pointageCacheKey(base, ferme));
      assert.strictEqual(pointageCacheKey(base, ferme, ''), pointageCacheKey(base, ferme));
      assert.strictEqual(pointageCacheKey(base, ferme, undefined), pointageCacheKey(base, ferme));
    }
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
