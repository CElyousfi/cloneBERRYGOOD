'use strict';

/**
 * Contrôle d'accès conso valorisée (« Engrais & Pesticides ») — tests purs.
 *
 * C'EST LE TEST SÉCURITÉ : le périmètre ferme est imposé serveur. Couvre :
 *  - dg → all
 *  - finance → all (+ filtre optionnel ?ferme=)
 *  - chef_f1 qui demande F5 → FORCÉ F1 (jamais F5)
 *  - magasinier → non autorisé
 *  - role inconnu / vide → non autorisé
 *  - admin → all
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const AC = require('../../functions/lib/valorisation/accessControl.js');

test('dg → autorisé, toutes fermes', () => {
  const r = AC.resolvePerimetre({ profileId: 'dg', role: 'user' }, undefined);
  assert.equal(r.autorise, true);
  assert.equal(r.perimetre_ferme, 'all');
  assert.equal(r.ferme_filtre, null);
});

test('finance → autorisé, toutes fermes par défaut', () => {
  const r = AC.resolvePerimetre({ profileId: 'finance', role: 'user' }, 'all');
  assert.equal(r.autorise, true);
  assert.equal(r.perimetre_ferme, 'all');
  assert.equal(r.ferme_filtre, null);
});

test('rh → autorisé, toutes fermes (matrice RH voit tout le nominatif)', () => {
  const r = AC.resolvePerimetre({ profileId: 'rh', role: 'user' }, undefined);
  assert.equal(r.autorise, true);
  assert.equal(r.perimetre_ferme, 'all');
  assert.equal(r.ferme_filtre, null);
});

test('rh → filtre optionnel ?ferme=F1 respecté (comme dg/finance)', () => {
  const r = AC.resolvePerimetre({ profileId: 'rh', role: 'user' }, 'F1');
  assert.equal(r.autorise, true);
  assert.equal(r.perimetre_ferme, 'F1');
  assert.equal(r.ferme_filtre, 'F1');
});

test('finance → filtre optionnel ?ferme=F5 respecté', () => {
  const r = AC.resolvePerimetre({ profileId: 'finance', role: 'user' }, 'F5');
  assert.equal(r.autorise, true);
  assert.equal(r.perimetre_ferme, 'F5');
  assert.equal(r.ferme_filtre, 'F5');
});

test('SÉCURITÉ: chef_f1 → accès culture Framboise toutes fermes (param ferme ignoré)', () => {
  const r = AC.resolvePerimetre({ profileId: 'chef_f1', role: 'user' }, 'F5');
  assert.equal(r.autorise, true);
  assert.equal(r.perimetre_ferme, 'all');
  assert.equal(r.ferme_filtre, null);
  assert.equal(r.culture_filtre, 'Framboise');
});

test('chef_f5 → sa ferme F5 (param ferme ignoré)', () => {
  const r = AC.resolvePerimetre({ profileId: 'chef_f5', role: 'user' }, 'F1');
  assert.equal(r.perimetre_ferme, 'F5');
  assert.equal(r.ferme_filtre, 'F5');
});

test('chef_avo → Avocatier, chef_bahia → BAHIA', () => {
  assert.equal(AC.resolvePerimetre({ profileId: 'chef_avo', role: 'user' }, null).perimetre_ferme, 'Avocatier');
  assert.equal(AC.resolvePerimetre({ profileId: 'chef_bahia', role: 'user' }, null).perimetre_ferme, 'BAHIA');
});

test('chef inconnu (profileId chef_xxx sans table) → repli sur users.ferme', () => {
  const r = AC.resolvePerimetre({ profileId: 'chef_f3', role: 'user', ferme: 'F3' }, 'F5');
  assert.equal(r.autorise, true);
  assert.equal(r.perimetre_ferme, 'F3');
  assert.equal(r.ferme_filtre, 'F3');
});

test('chef sans ferme résolue → périmètre vide (aucune ligne)', () => {
  const r = AC.resolvePerimetre({ profileId: 'chef_f3', role: 'user' }, 'F5');
  assert.equal(r.autorise, true);
  assert.equal(r.perimetre_ferme, '');
  assert.equal(r.ferme_filtre, '__none__');
});

test('SÉCURITÉ: magasinier → non autorisé', () => {
  const r = AC.resolvePerimetre({ profileId: 'magasinier', role: 'user' }, 'F1');
  assert.equal(r.autorise, false);
  assert.equal(r.error, 'Accès non autorisé');
});

test('achats → non autorisé', () => {
  assert.equal(AC.resolvePerimetre({ profileId: 'achats', role: 'user' }, null).autorise, false);
});

test('caporal_f1 → non autorisé', () => {
  assert.equal(AC.resolvePerimetre({ profileId: 'caporal_f1', role: 'user' }, null).autorise, false);
});

test('agronomie → non autorisé', () => {
  assert.equal(AC.resolvePerimetre({ profileId: 'agronomie', role: 'user' }, null).autorise, false);
});

test('role inconnu / vide → non autorisé', () => {
  assert.equal(AC.resolvePerimetre({ profileId: '', role: 'user' }, null).autorise, false);
  assert.equal(AC.resolvePerimetre({}, null).autorise, false);
  assert.equal(AC.resolvePerimetre(null, null).autorise, false);
});

// --- Durcissement: pas d'escalade via clés héritées du prototype Object ---

test('SÉCURITÉ: profileId "constructor" → non autorisé (pas all)', () => {
  const r = AC.resolvePerimetre({ profileId: 'constructor', role: 'user' }, 'all');
  assert.equal(r.autorise, false);
  assert.notEqual(r.perimetre_ferme, 'all');
});

test('SÉCURITÉ: profileId "__proto__" → non autorisé', () => {
  const r = AC.resolvePerimetre({ profileId: '__proto__', role: 'user' }, 'all');
  assert.equal(r.autorise, false);
  assert.notEqual(r.perimetre_ferme, 'all');
});

test('SÉCURITÉ: profileId "hasOwnProperty" → non autorisé', () => {
  const r = AC.resolvePerimetre({ profileId: 'hasOwnProperty', role: 'user' }, 'all');
  assert.equal(r.autorise, false);
});

test('SÉCURITÉ: profileId "toString" / "valueOf" → non autorisé', () => {
  assert.equal(AC.resolvePerimetre({ profileId: 'toString', role: 'user' }, 'all').autorise, false);
  assert.equal(AC.resolvePerimetre({ profileId: 'valueOf', role: 'user' }, 'all').autorise, false);
});

test('SÉCURITÉ: profileId non-string (null, {}, ["dg"]) → non autorisé', () => {
  assert.equal(AC.resolvePerimetre({ profileId: null, role: 'user' }, 'all').autorise, false);
  assert.equal(AC.resolvePerimetre({ profileId: {}, role: 'user' }, 'all').autorise, false);
  assert.equal(AC.resolvePerimetre({ profileId: ['dg'], role: 'user' }, 'all').autorise, false);
});

test('fermeDemandee non-string (objet/array) pour un dg → all, pas d\'erreur', () => {
  const robj = AC.resolvePerimetre({ profileId: 'dg', role: 'user' }, { ferme: 'F5' });
  assert.equal(robj.autorise, true);
  assert.equal(robj.perimetre_ferme, 'all');
  assert.equal(robj.ferme_filtre, null);
  assert.equal(robj.error, undefined);
  const rarr = AC.resolvePerimetre({ profileId: 'dg', role: 'user' }, ['F5']);
  assert.equal(rarr.autorise, true);
  assert.equal(rarr.perimetre_ferme, 'all');
  assert.equal(rarr.ferme_filtre, null);
});

// --- Non-fuite inter-fermes : le filtre appliqué == le périmètre annoncé ---
// (régression bug « Chef F1 voit toutes les fermes » : la cause était frontend,
//  mais on verrouille ici l'invariant backend qui garantit le cloisonnement.)

test('SÉCURITÉ: chef_f1 → culture_filtre Framboise, ferme_filtre null (param ferme ignoré)', () => {
  const r = AC.resolvePerimetre({ profileId: 'chef_f1', role: 'user' }, 'Avocatier');
  assert.equal(r.perimetre_ferme, 'all');
  assert.equal(r.ferme_filtre, null);
  assert.equal(r.culture_filtre, 'Framboise');
  // Seules les parcelles Framboise sont accessibles (via culture_filtre, pas via ferme_filtre)
  assert.notEqual(r.culture_filtre, 'Myrtille');
});

test('SÉCURITÉ: chef_avo demandant F1 → reste Avocatier (param ignoré)', () => {
  const r = AC.resolvePerimetre({ profileId: 'chef_avo', role: 'user' }, 'F1');
  assert.equal(r.perimetre_ferme, 'Avocatier');
  assert.equal(r.ferme_filtre, 'Avocatier');
});

test('INVARIANT: chefs à base ferme → ferme_filtre === perimetre_ferme (pas all)', () => {
  ['chef_f5', 'chef_avo', 'chef_bahia'].forEach((pid) => {
    const r = AC.resolvePerimetre({ profileId: pid, role: 'user' }, 'F5');
    assert.equal(r.autorise, true);
    assert.equal(r.ferme_filtre, r.perimetre_ferme,
      pid + ' : le filtre doit être exactement le périmètre annoncé');
    assert.notEqual(r.perimetre_ferme, 'all');
  });
});

test('INVARIANT: chef_f1 → accès culture-only (ferme_filtre null, culture_filtre Framboise)', () => {
  const r = AC.resolvePerimetre({ profileId: 'chef_f1', role: 'user' }, 'F5');
  assert.equal(r.autorise, true);
  assert.equal(r.perimetre_ferme, 'all');
  assert.equal(r.ferme_filtre, null);
  assert.equal(r.culture_filtre, 'Framboise');
});

test('admin système → autorisé, toutes fermes', () => {
  const r = AC.resolvePerimetre({ profileId: 'magasinier', role: 'admin' }, null);
  assert.equal(r.autorise, true);
  assert.equal(r.role, 'admin');
  assert.equal(r.perimetre_ferme, 'all');
});
