'use strict';

/**
 * Item 1 — Validation automatique des fournisseurs (Achats).
 * Couvre les 6 règles obligatoires + cas tout valide + 1 cas invalide par champ.
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../functions/lib/suppliers/supplierValidation.js');

/** Jeu de champs entièrement valide, à muter par cas. */
function validFields() {
  return {
    nom: 'BAHIA AGRICOLE SARL',
    adresse: 'Zone industrielle, Ksar El Kbir',
    identifiant_fiscal: '4967185',
    ice: '001454414000011',
    contact_nom: 'Ahmed Berrada',
    tel: '0612345678',
  };
}

test('cas tout valide -> { valid: true, errors: {} }', () => {
  const r = V.validateSupplier(validFields());
  assert.equal(r.valid, true);
  assert.deepEqual(r.errors, {});
});

// --- Règle 1 : nom (raison sociale) ---
test('nom vide -> invalide', () => {
  assert.equal(V.isNonEmpty('  '), false);
  const r = V.validateSupplier({ ...validFields(), nom: '   ' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.nom);
});

// --- Règle 2 : adresse ---
test('adresse vide -> invalide', () => {
  const r = V.validateSupplier({ ...validFields(), adresse: '' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.adresse);
});

// --- Règle 3 : identifiant_fiscal (7 a 8 chiffres) ---
test('IF : 7 et 8 chiffres valides, espaces tolérés', () => {
  assert.equal(V.isValidIf('1234567'), true);
  assert.equal(V.isValidIf('12345678'), true);
  assert.equal(V.isValidIf('123 4567'), true);
});

test('IF invalide : trop court / trop long / non numérique', () => {
  assert.equal(V.isValidIf('123456'), false);
  assert.equal(V.isValidIf('123456789'), false);
  assert.equal(V.isValidIf('12A4567'), false);
  const r = V.validateSupplier({ ...validFields(), identifiant_fiscal: '12' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.identifiant_fiscal);
});

// --- Règle 4 : ice (15 chiffres) ---
test('ICE : exactement 15 chiffres, espaces tolérés', () => {
  assert.equal(V.isValidIce('001454414000011'), true);
  assert.equal(V.isValidIce('0014 5441 4000 011'), true);
  assert.equal(V.isValidIce('00145441400001'), false); // 14
  assert.equal(V.isValidIce('0014544140000111'), false); // 16
});

test('ICE invalide -> errors.ice', () => {
  const r = V.validateSupplier({ ...validFields(), ice: '123' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.ice);
});

// --- Règle 5 : contact_nom ---
test('contact_nom vide -> invalide', () => {
  const r = V.validateSupplier({ ...validFields(), contact_nom: '   ' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.contact_nom);
});

// --- Règle 6 : tel (MA, 10 chiffres commençant par 0) ---
test('tel : formats MA valides (espaces, points, tirets tolérés)', () => {
  assert.equal(V.isValidPhone('0612345678'), true);
  assert.equal(V.isValidPhone('06 12 34 56 78'), true);
  assert.equal(V.isValidPhone('06.12.34.56.78'), true);
  assert.equal(V.isValidPhone('06-12-34-56-78'), true);
});

test('tel invalide : ne commence pas par 0 / mauvaise longueur', () => {
  assert.equal(V.isValidPhone('612345678'), false);
  assert.equal(V.isValidPhone('061234567'), false); // 9
  assert.equal(V.isValidPhone('06123456789'), false); // 11
  assert.equal(V.isValidPhone('+212612345678'), false);
  const r = V.validateSupplier({ ...validFields(), tel: '612345678' });
  assert.equal(r.valid, false);
  assert.ok(r.errors.tel);
});

// --- errors ne contient QUE les champs en échec ---
test('errors ne liste que les champs en échec', () => {
  const r = V.validateSupplier({ ...validFields(), tel: 'xxx', ice: 'yyy' });
  assert.equal(r.valid, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['ice', 'tel']);
});

// --- robustesse : entrée vide / null ---
test('entrée vide -> les 6 champs en erreur', () => {
  const r = V.validateSupplier({});
  assert.equal(r.valid, false);
  assert.deepEqual(
    Object.keys(r.errors).sort(),
    ['adresse', 'contact_nom', 'ice', 'identifiant_fiscal', 'nom', 'tel'],
  );
  const r2 = V.validateSupplier(null);
  assert.equal(r2.valid, false);
});
