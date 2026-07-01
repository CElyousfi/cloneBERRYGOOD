'use strict';

/**
 * paieAccess.test.js — Gating paie (Étape 0), décisions PURES.
 *
 * Vérifie la barrière serveur sur :
 *  - la sous-traitance nominative (pointage_divers) : canAccessDivers
 *  - les agrégats pointage RH nominatifs : resolvePointageRHAccess
 *
 * Combiné avec resolvePerimetre (accessControl) qui impose le périmètre ferme
 * serveur. On teste la chaîne resolvePerimetre → décision, pour dg/finance/rh
 * (all), chef (sa ferme), caporal/magasinier/autres (refusés).
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const AC = require('../../functions/lib/valorisation/accessControl.js');
const { canAccessDivers, resolvePointageRHAccess } = require('../../functions/lib/auth/paieAccess.js');
const { filterMirrorRowsByFerme } = require('../../functions/pointageService.js');

// Helper : périmètre pour un profil donné (rôle système 'user' par défaut).
function perim(profileId, opts) {
  const o = opts || {};
  return AC.resolvePerimetre({ profileId, role: o.role || 'user', ferme: o.ferme }, o.ferme_demandee);
}

// ============ DIVERS (sous-traitance nominative, PAS de ferme) ============

test('DIVERS: dg → accès autorisé', () => {
  assert.equal(canAccessDivers(perim('dg')), true);
});

test('DIVERS: finance → accès autorisé', () => {
  assert.equal(canAccessDivers(perim('finance')), true);
});

test('DIVERS: rh → accès autorisé (matrice RH)', () => {
  assert.equal(canAccessDivers(perim('rh')), true);
});

test('DIVERS: admin système → accès autorisé', () => {
  assert.equal(canAccessDivers(perim('magasinier', { role: 'admin' })), true);
});

test('SÉCURITÉ DIVERS: chef_f1 → REFUSÉ (divers non cloisonnable par ferme)', () => {
  const p = perim('chef_f1');
  assert.equal(p.autorise, true); // chef est autorisé sur SON périmètre ferme…
  assert.notEqual(p.perimetre_ferme, 'all'); // …mais pas 'all'
  assert.equal(canAccessDivers(p), false); // donc refusé sur le divers
});

test('SÉCURITÉ DIVERS: chef_bahia → REFUSÉ', () => {
  assert.equal(canAccessDivers(perim('chef_bahia')), false);
});

test('SÉCURITÉ DIVERS: caporal_f1 → REFUSÉ', () => {
  assert.equal(canAccessDivers(perim('caporal_f1')), false);
});

test('SÉCURITÉ DIVERS: magasinier → REFUSÉ', () => {
  assert.equal(canAccessDivers(perim('magasinier')), false);
});

test('SÉCURITÉ DIVERS: profil vide / null / non autorisé → REFUSÉ', () => {
  assert.equal(canAccessDivers(perim('')), false);
  assert.equal(canAccessDivers(null), false);
  assert.equal(canAccessDivers(undefined), false);
  assert.equal(canAccessDivers({ autorise: false, perimetre_ferme: '' }), false);
});

test('SÉCURITÉ DIVERS: un perim autorisé mais ferme spécifique → REFUSÉ', () => {
  // même forgé, seul perimetre_ferme === 'all' passe.
  assert.equal(canAccessDivers({ autorise: true, perimetre_ferme: 'F1' }), false);
});

// ============ POINTAGE RH (agrégats nominatifs) ============

test('POINTAGE RH: dg → autorisé, toutes fermes (fermeFilter null)', () => {
  const a = resolvePointageRHAccess(perim('dg'));
  assert.equal(a.allowed, true);
  assert.equal(a.fermeFilter, null);
});

test('POINTAGE RH: finance → toutes fermes', () => {
  const a = resolvePointageRHAccess(perim('finance'));
  assert.equal(a.allowed, true);
  assert.equal(a.fermeFilter, null);
});

test('POINTAGE RH: rh → toutes fermes (matrice RH)', () => {
  const a = resolvePointageRHAccess(perim('rh'));
  assert.equal(a.allowed, true);
  assert.equal(a.fermeFilter, null);
});

test('POINTAGE RH: admin → toutes fermes', () => {
  const a = resolvePointageRHAccess(perim('magasinier', { role: 'admin' }));
  assert.equal(a.allowed, true);
  assert.equal(a.fermeFilter, null);
});

test('SÉCURITÉ POINTAGE RH: chef_f1 → autorisé, filtré F1 (jamais all)', () => {
  const a = resolvePointageRHAccess(perim('chef_f1', { ferme_demandee: 'F5' }));
  assert.equal(a.allowed, true);
  assert.equal(a.fermeFilter, 'F1'); // param ?ferme=F5 ignoré
});

test('SÉCURITÉ POINTAGE RH: chef_bahia → filtré BAHIA', () => {
  const a = resolvePointageRHAccess(perim('chef_bahia'));
  assert.equal(a.allowed, true);
  assert.equal(a.fermeFilter, 'BAHIA');
});

test('SÉCURITÉ POINTAGE RH: chef sans ferme résolue → REFUSÉ (403, PAS passthrough)', () => {
  // chef_f3 sans table CHEF_PROFILE_FERME ni users.ferme → perimetre_ferme ''.
  // Un fermeFilter '' serait FALSY → passthrough TOUTES fermes côté handler
  // (fuite nominative cross-ferme). On refuse donc explicitement (403).
  const a = resolvePointageRHAccess(perim('chef_f3'));
  assert.equal(a.allowed, false);
  assert.equal(a.fermeFilter, null);
});

test('SÉCURITÉ POINTAGE RH: chef_agronomie (profileId réel, sans ferme) → REFUSÉ (403)', () => {
  // isChefProfile matche chef_agronomie/chef_production/chef_da/chef_de sans ferme.
  // Ces profils ne doivent JAMAIS obtenir le nominatif paie cross-ferme.
  for (const pid of ['chef_agronomie', 'chef_production', 'chef_da', 'chef_de']) {
    const a = resolvePointageRHAccess(perim(pid));
    assert.equal(a.allowed, false, `${pid} doit être refusé`);
    assert.equal(a.fermeFilter, null, `${pid} ne doit pas produire de filtre`);
  }
});

test('SÉCURITÉ POINTAGE RH: chef sans ferme via users.ferme vide → REFUSÉ (403)', () => {
  // chef_f3 avec users.ferme = '' ou espaces → perimetre_ferme '' → 403.
  assert.equal(resolvePointageRHAccess(perim('chef_f3', { ferme: '' })).allowed, false);
  assert.equal(resolvePointageRHAccess(perim('chef_f3', { ferme: '   ' })).allowed, false);
});

test('SÉCURITÉ POINTAGE RH: chef avec users.ferme résolue (repli) → autorisé, filtré', () => {
  // chef hors table mais avec users.ferme non vide → filtre sur cette ferme (repli légitime).
  const a = resolvePointageRHAccess(perim('chef_zone', { ferme: 'F1' }));
  assert.equal(a.allowed, true);
  assert.equal(a.fermeFilter, 'F1');
});

test('SÉCURITÉ POINTAGE RH: aucun fermeFilter FALSY (autre que null) ne peut sortir', () => {
  // Défense-en-profondeur : le seul cas allowed:true avec fermeFilter falsy autorisé
  // est fermeFilter === null (full-access). Un '' / undefined / 0 forgé → refusé.
  for (const bad of ['', '   ']) {
    const a = resolvePointageRHAccess({ autorise: true, perimetre_ferme: bad });
    assert.equal(a.allowed, false);
  }
  // Le SEUL falsy autorisé est null, et UNIQUEMENT via perimetre_ferme 'all'.
  const full = resolvePointageRHAccess({ autorise: true, perimetre_ferme: 'all' });
  assert.equal(full.allowed, true);
  assert.equal(full.fermeFilter, null);
});

test('SÉCURITÉ POINTAGE RH: caporal_f1 → REFUSÉ (403)', () => {
  const a = resolvePointageRHAccess(perim('caporal_f1'));
  assert.equal(a.allowed, false);
});

test('SÉCURITÉ POINTAGE RH: magasinier → REFUSÉ', () => {
  assert.equal(resolvePointageRHAccess(perim('magasinier')).allowed, false);
});

test('SÉCURITÉ POINTAGE RH: profil vide / null → REFUSÉ', () => {
  assert.equal(resolvePointageRHAccess(perim('')).allowed, false);
  assert.equal(resolvePointageRHAccess(null).allowed, false);
  assert.equal(resolvePointageRHAccess({ autorise: false }).allowed, false);
});

// ==== INTÉGRATION CHAÎNE COMPLÈTE (resolvePerimetre → access → filtrage) ====
// Reproduit le comportement du handler pointageService (l.1599, l.1785) :
//   _fermeFilter = access.fermeFilter ; filterMirrorRowsByFerme(rows, _fermeFilter)
// pour prouver qu'un fermeFilter invalide/vide ne renvoie JAMAIS toutes les fermes.

// Lignes multi-fermes (Ref_parcelle → deriveFerme).
const MIXED_ROWS = [
  { Ref_parcelle: 'F1-A', Personnel_Matricule: 'M1' },
  { Ref_parcelle: 'F5-B', Personnel_Matricule: 'M2' },
  { Ref_parcelle: 'BAHIA-01', Personnel_Matricule: 'M3' },
  { Ref_parcelle: 'F2-C', Personnel_Matricule: 'M4' }, // Avocatier
];

test('INTÉGRATION: chef sans ferme (chef_agronomie) → 403, aucun passthrough possible', () => {
  const p = perim('chef_agronomie'); // isChefProfile true, ferme non résolue
  const access = resolvePointageRHAccess(p);
  // La barrière refuse AVANT tout accès aux lignes : pas de fermeFilter falsy.
  assert.equal(access.allowed, false);
  // Le handler renverrait 403 et n'appellerait jamais filterMirrorRowsByFerme.
  // Défense-en-profondeur : même si on tentait, fermeFilter=null NE DOIT venir
  // QUE d'un full-access, jamais d'un chef → prouvé par allowed:false.
});

test('INTÉGRATION: full-access (dg) → fermeFilter null → passthrough LÉGITIME toutes fermes', () => {
  const access = resolvePointageRHAccess(perim('dg'));
  assert.equal(access.allowed, true);
  assert.equal(access.fermeFilter, null);
  const rows = filterMirrorRowsByFerme(MIXED_ROWS, access.fermeFilter);
  assert.equal(rows.length, 4); // toutes fermes, comportement inchangé
});

test('INTÉGRATION: chef résolu (chef_f1) → filtre F1 → seulement SA ferme', () => {
  const access = resolvePointageRHAccess(perim('chef_f1'));
  assert.equal(access.allowed, true);
  assert.equal(access.fermeFilter, 'F1');
  const rows = filterMirrorRowsByFerme(MIXED_ROWS, access.fermeFilter);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Personnel_Matricule, 'M1');
});

test('INTÉGRATION: chef_bahia → filtre BAHIA → seulement BAHIA (pas les 3 autres)', () => {
  const access = resolvePointageRHAccess(perim('chef_bahia'));
  const rows = filterMirrorRowsByFerme(MIXED_ROWS, access.fermeFilter);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].Personnel_Matricule, 'M3');
});

test('SÉCURITÉ: aucun profileId chef ne peut produire un fermeFilter falsy autorisé', () => {
  // Balaye des chefs cassés (sans ferme) ET des chefs résolus : le seul allowed:true
  // avec fermeFilter falsy autorisé est null, réservé au full-access.
  const brokenChefs = ['chef_agronomie', 'chef_production', 'chef_da', 'chef_de', 'chef_f3', 'chef_'];
  for (const pid of brokenChefs) {
    const access = resolvePointageRHAccess(perim(pid));
    if (access.allowed) {
      // si autorisé, le filtre DOIT être une ferme non vide (jamais falsy)
      assert.ok(typeof access.fermeFilter === 'string' && access.fermeFilter.trim() !== '',
        `${pid}: autorisé mais fermeFilter falsy = FUITE`);
    }
  }
});
