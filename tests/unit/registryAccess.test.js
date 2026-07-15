'use strict';

/**
 * registryAccess.test.js — Projections PURES du registre ouvrier par périmètre
 * (Étape 1 sécurité paie — get-registry).
 *
 * Vérifie :
 *  - scope 'all' (RH/DG/Finance/admin) → TOUS les champs de chaque doc ;
 *  - scope chef → champs RÉDUITS uniquement + filtrage par set de matricules
 *    autorisés (F1 ne voit QUE ses matricules) ;
 *  - pont matricule alpha↔numérique (mirror 'DD10502' ↔ registry '10502') ;
 *  - fail-closed : matricule 'Autre'/vide exclu, set vide → aucun doc.
 * Combiné (intégration) avec resolvePerimetre + resolvePointageRHAccess pour
 * prouver la chaîne : caporal → refusé, chef → filtré, dg → tout.
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const RA = require('../../functions/lib/auth/registryAccess.js');
const AC = require('../../functions/lib/valorisation/accessControl.js');
const { resolvePointageRHAccess } = require('../../functions/lib/auth/paieAccess.js');

// Docs registry bruts (data() + __id = docId numérique).
const DOCS = [
  {
    __id: '10502', matricule: '10502', nom: 'ALPHA', poste: 'Ouvrier',
    declare: true, declareSource: 'import', baselineJours: 120, baselineDate: '2025-01-01',
    primeFonctionJournaliere: 15, prime_effectiveFrom: '2025-06-01',
    prime_history: [{ montant: 10, at: 1 }], fonction_id: 'chef-equipe',
    fonction_history: [{ id: 'x' }], updatedBy: { uid: 'u1' }, updatedAt: 123,
  },
  {
    __id: '20777', matricule: '20777', nom: 'BETA', poste: 'Caporal',
    declare: false, baselineJours: 0, baselineDate: '',
    primeFonctionJournaliere: 0, prime_effectiveFrom: '',
    prime_history: [], fonction_id: '', updatedBy: { uid: 'u2' }, updatedAt: 456,
  },
  {
    __id: '30001', matricule: '30001', nom: 'GAMMA',
    primeFonctionJournaliere: 8, prime_effectiveFrom: '2025-05-01',
    prime_history: [{ montant: 8 }], declareSource: 'manual',
    updatedBy: { uid: 'u3' },
  },
];

function perim(profileId, opts) {
  const o = opts || {};
  return AC.resolvePerimetre({ profileId, role: o.role || 'user', ferme: o.ferme }, o.ferme_demandee);
}

// ============ SCOPE FULL ('all') — RH/DG/Finance/admin ============

test('FULL: renvoie TOUS les docs avec TOUS les champs (tel quel)', () => {
  const out = RA.projectRegistryFull(DOCS);
  assert.equal(out.length, 3);
  const a = out.find(d => d.matricule === '10502');
  // Tous les champs sensibles présents pour le scope full.
  assert.equal(a.prime_history.length, 1);
  assert.ok(a.fonction_history);
  assert.ok(a.updatedBy);
  assert.equal(a.declareSource, 'import');
  assert.equal(a.poste, 'Ouvrier');
  assert.equal(a.baselineJours, 120);
});

test('FULL: __id retiré, matricule garanti (repli docId)', () => {
  const out = RA.projectRegistryFull([{ __id: '99', nom: 'X' }]);
  assert.equal(out[0].__id, undefined);
  assert.equal(out[0].matricule, '99');
});

test('FULL: entrée vide/null → liste vide (défense)', () => {
  assert.deepEqual(RA.projectRegistryFull(null), []);
  assert.deepEqual(RA.projectRegistryFull(undefined), []);
});

// ============ SCOPE CHEF — champs réduits + filtrage matricules ============

test('CHEF: ne garde QUE les matricules du set + champs réduits', () => {
  // F1 a pointé 10502 uniquement (set numérique normalisé).
  const allowed = new Set(['10502']);
  const out = RA.projectRegistryForChef(DOCS, allowed);
  assert.equal(out.length, 1);
  assert.equal(out[0].matricule, '10502');
});

test('SÉCURITÉ CHEF: AUCUN champ sensible de paie (history/updatedBy/declareSource)', () => {
  const out = RA.projectRegistryForChef(DOCS, new Set(['10502']));
  const d = out[0];
  assert.equal(d.prime_history, undefined);
  assert.equal(d.fonction_history, undefined);
  assert.equal(d.updatedBy, undefined);
  assert.equal(d.declareSource, undefined);
  assert.equal(d.poste, undefined); // poste non exposé aux chefs
  // Champs réduits légitimes présents.
  assert.equal(d.nom, 'ALPHA');
  assert.equal(d.declare, true);
  assert.equal(d.baselineJours, 120);
  assert.equal(d.primeFonctionJournaliere, 15);
  assert.equal(d.prime_effectiveFrom, '2025-06-01');
  assert.equal(d.fonction_id, 'chef-equipe');
});

test('SÉCURITÉ CHEF: F1 (10502) ne voit PAS les matricules d\'une autre ferme', () => {
  // Set F1 = {10502}. Les docs 20777/30001 (autres fermes) sont exclus.
  const out = RA.projectRegistryForChef(DOCS, new Set(['10502']));
  assert.equal(out.some(d => d.matricule === '20777'), false);
  assert.equal(out.some(d => d.matricule === '30001'), false);
});

test('SÉCURITÉ CHEF: set vide → AUCUN doc (fail-closed)', () => {
  assert.deepEqual(RA.projectRegistryForChef(DOCS, new Set()), []);
  assert.deepEqual(RA.projectRegistryForChef(DOCS, null), []);
});

// ============ PONT MATRICULE alpha ↔ numérique ============

test('PONT: set mirror alpha-préfixé (DD10502) normalisé matche registry numérique (10502)', () => {
  // Le set brut vient du mirror : 'DD10502'. normalizeAllowedSet → '10502'.
  const normalized = RA.normalizeAllowedSet(new Set(['DD10502', 'AB20777']));
  assert.equal(normalized.has('10502'), true);
  assert.equal(normalized.has('20777'), true);
  const out = RA.projectRegistryForChef(DOCS, normalized);
  const mats = out.map(d => d.matricule).sort();
  assert.deepEqual(mats, ['10502', '20777']);
});

test('PONT: normalizeAllowedSet exclut Autre / vide / non-numérique (fail-closed)', () => {
  const normalized = RA.normalizeAllowedSet(['Autre', '', 'XYZ', '  ', 'DD10502']);
  assert.equal(normalized.size, 1);
  assert.equal(normalized.has('10502'), true);
});

test('PONT: normalizeAllowedSet accepte array ou Set, null → set vide', () => {
  assert.equal(RA.normalizeAllowedSet(null).size, 0);
  assert.equal(RA.normalizeAllowedSet(['DD1']).size, 1);
  assert.equal(RA.normalizeAllowedSet(new Set(['DD1'])).size, 1);
});

test('normalizeMatriculeNum: DD10502 → 10502, Autre → \'\'', () => {
  assert.equal(RA.normalizeMatriculeNum('DD10502'), '10502');
  assert.equal(RA.normalizeMatriculeNum('10502'), '10502');
  assert.equal(RA.normalizeMatriculeNum('Autre'), '');
  assert.equal(RA.normalizeMatriculeNum(null), '');
});

// ============ INTÉGRATION — chaîne resolvePerimetre → accès → projection ============

test('INTÉGRATION: dg (scope all) → autorisé, fermeFilter null → projection FULL', () => {
  const access = resolvePointageRHAccess(perim('dg'));
  assert.equal(access.allowed, true);
  assert.equal(access.fermeFilter, null);
  // fermeFilter null → handler fait projectRegistryFull.
  const out = RA.projectRegistryFull(DOCS);
  assert.equal(out.length, 3);
});

test('INTÉGRATION: chef_f1 → autorisé, filtre culture Framboise (fermeFilter null) → projection CHEF réduite', () => {
  const access = resolvePointageRHAccess(perim('chef_f1'));
  assert.equal(access.allowed, true);
  // chef_f1 = accès culture-only (Framboise, F1+F5) → perimetre_ferme='all' → fermeFilter null
  // Le handler dérive le set de matricules via culture_filtre (pas via ferme)
  assert.equal(access.fermeFilter, null);
  // Handler dérive le set Framboise depuis le mirror puis normalise. Simulé ici.
  const setFramboise = RA.normalizeAllowedSet(new Set(['DD10502']));
  const out = RA.projectRegistryForChef(DOCS, setFramboise);
  assert.equal(out.length, 1);
  assert.equal(out[0].prime_history, undefined); // jamais d'historique pour un chef
});

test('SÉCURITÉ INTÉGRATION: caporal_f1 → REFUSÉ (403, jamais de projection)', () => {
  const access = resolvePointageRHAccess(perim('caporal_f1'));
  assert.equal(access.allowed, false);
  // Le handler renvoie 403 AVANT toute lecture/projection du registre.
});

test('SÉCURITÉ INTÉGRATION: magasinier → REFUSÉ', () => {
  assert.equal(resolvePointageRHAccess(perim('magasinier')).allowed, false);
});
