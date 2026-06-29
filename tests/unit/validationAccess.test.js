'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  genericRoleFor,
  fermeForCaporalProfile,
  authorizeValidationAction,
} = require('../../functions/lib/validation/validationAccess');

// ---------------------------------------------------------------------------
// SCÉNARIOS DE NON-RÉGRESSION DG (validés par le DG) — explicitement nommés
// ---------------------------------------------------------------------------

test('NON-RÉGRESSION DG — caporal usurpe dg → 403 (unlock paie verrouillée refusé)', () => {
  const dec = authorizeValidationAction({
    callerProfile: 'caporal_f1',
    action: 'unlock',
    ferme: 'F1',
    locked: true,
    rejected: false,
  });
  assert.strictEqual(dec.allowed, false);
  assert.strictEqual(dec.role, 'caporal');
});

test('NON-RÉGRESSION DG — dg unlock paie validée → 200 (autorisé)', () => {
  const dec = authorizeValidationAction({
    callerProfile: 'dg',
    action: 'unlock',
    ferme: 'F1',
    locked: true,
    rejected: false,
  });
  assert.strictEqual(dec.allowed, true);
  assert.strictEqual(dec.role, 'dg');
});

test('NON-RÉGRESSION DG — chef sur mauvaise ferme → 403, bonne ferme → 200', () => {
  const wrong = authorizeValidationAction({
    callerProfile: 'chef_f1',
    action: 'validate',
    ferme: 'F5',
  });
  assert.strictEqual(wrong.allowed, false);
  assert.strictEqual(wrong.role, 'chef');

  const right = authorizeValidationAction({
    callerProfile: 'chef_f1',
    action: 'validate',
    ferme: 'F1',
  });
  assert.strictEqual(right.allowed, true);
  assert.strictEqual(right.role, 'chef');
});

// ---------------------------------------------------------------------------
// genericRoleFor
// ---------------------------------------------------------------------------

test('genericRoleFor — rh/dg/caporal_x/chef_x', () => {
  assert.strictEqual(genericRoleFor('rh'), 'rh');
  assert.strictEqual(genericRoleFor('dg'), 'dg');
  assert.strictEqual(genericRoleFor('caporal_f1'), 'caporal');
  assert.strictEqual(genericRoleFor('caporal_avo'), 'caporal');
  assert.strictEqual(genericRoleFor('chef_f5'), 'chef');
  assert.strictEqual(genericRoleFor('chef_bahia'), 'chef');
});

test('genericRoleFor — profils inconnus / non habilités → null', () => {
  assert.strictEqual(genericRoleFor('magasinier'), null);
  assert.strictEqual(genericRoleFor('achats'), null);
  assert.strictEqual(genericRoleFor('inconnu'), null);
  assert.strictEqual(genericRoleFor(''), null);
  assert.strictEqual(genericRoleFor(null), null);
  assert.strictEqual(genericRoleFor(undefined), null);
  assert.strictEqual(genericRoleFor(42), null);
});

test('genericRoleFor — clés de prototype rejetées', () => {
  assert.strictEqual(genericRoleFor('constructor'), null);
  assert.strictEqual(genericRoleFor('__proto__'), null);
  assert.strictEqual(genericRoleFor('hasOwnProperty'), null);
  assert.strictEqual(genericRoleFor('toString'), null);
});

// ---------------------------------------------------------------------------
// fermeForCaporalProfile
// ---------------------------------------------------------------------------

test('fermeForCaporalProfile — mapping connu', () => {
  assert.strictEqual(fermeForCaporalProfile('caporal_f1'), 'F1');
  assert.strictEqual(fermeForCaporalProfile('caporal_f5'), 'F5');
  assert.strictEqual(fermeForCaporalProfile('caporal_avo'), 'Avocatier');
});

test('fermeForCaporalProfile — inconnu / prototype → null', () => {
  assert.strictEqual(fermeForCaporalProfile('caporal_xx'), null);
  assert.strictEqual(fermeForCaporalProfile('chef_f1'), null);
  assert.strictEqual(fermeForCaporalProfile('rh'), null);
  assert.strictEqual(fermeForCaporalProfile('__proto__'), null);
  assert.strictEqual(fermeForCaporalProfile('constructor'), null);
  assert.strictEqual(fermeForCaporalProfile(null), null);
  assert.strictEqual(fermeForCaporalProfile(123), null);
});

// ---------------------------------------------------------------------------
// authorizeValidationAction — validate
// ---------------------------------------------------------------------------

test('validate — rh autorisé sur toutes fermes + DIVERS', () => {
  for (const f of ['F1', 'F5', 'Avocatier', 'DIVERS']) {
    assert.strictEqual(authorizeValidationAction({ callerProfile: 'rh', action: 'validate', ferme: f }).allowed, true);
  }
});

test('validate — dg autorisé sur toutes fermes + DIVERS', () => {
  for (const f of ['F1', 'F5', 'Avocatier', 'DIVERS']) {
    const dec = authorizeValidationAction({ callerProfile: 'dg', action: 'validate', ferme: f });
    assert.strictEqual(dec.allowed, true);
    assert.strictEqual(dec.role, 'dg');
  }
});

test('validate — caporal limité à sa ferme', () => {
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'caporal_f5', action: 'validate', ferme: 'F5' }).allowed, true);
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'caporal_f5', action: 'validate', ferme: 'F1' }).allowed, false);
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'caporal_f5', action: 'validate', ferme: 'DIVERS' }).allowed, false);
});

test('validate — profil non habilité → 403', () => {
  const dec = authorizeValidationAction({ callerProfile: 'magasinier', action: 'validate', ferme: 'F1' });
  assert.strictEqual(dec.allowed, false);
  assert.strictEqual(dec.role, null);
  assert.strictEqual(dec.reason, 'Profil non habilité');
});

// ---------------------------------------------------------------------------
// authorizeValidationAction — reject
// ---------------------------------------------------------------------------

test('reject — seul caporal/chef sur leur ferme', () => {
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'caporal_f1', action: 'reject', ferme: 'F1' }).allowed, true);
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'caporal_f1', action: 'reject', ferme: 'F5' }).allowed, false);
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'chef_f5', action: 'reject', ferme: 'F5' }).allowed, true);
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'chef_f5', action: 'reject', ferme: 'F1' }).allowed, false);
});

test('reject — rh/dg ne peuvent pas rejeter (comportement existant préservé)', () => {
  const rh = authorizeValidationAction({ callerProfile: 'rh', action: 'reject', ferme: 'F1' });
  assert.strictEqual(rh.allowed, false);
  const dg = authorizeValidationAction({ callerProfile: 'dg', action: 'reject', ferme: 'F1' });
  assert.strictEqual(dg.allowed, false);
});

// ---------------------------------------------------------------------------
// authorizeValidationAction — unlock
// ---------------------------------------------------------------------------

test('unlock — paie verrouillée non rejetée : seul dg', () => {
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'dg', action: 'unlock', ferme: 'F1', locked: true, rejected: false }).allowed, true);
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'rh', action: 'unlock', ferme: 'F1', locked: true, rejected: false }).allowed, false);
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'caporal_f1', action: 'unlock', ferme: 'F1', locked: true, rejected: false }).allowed, false);
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'chef_f1', action: 'unlock', ferme: 'F1', locked: true, rejected: false }).allowed, false);
});

test('unlock — non verrouillé : rh autorisé (comportement existant)', () => {
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'rh', action: 'unlock', ferme: 'F1', locked: false, rejected: false }).allowed, true);
});

test('unlock — déjà rejeté : rh autorisé même si locked drapeau résiduel', () => {
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'rh', action: 'unlock', ferme: 'F1', locked: true, rejected: true }).allowed, true);
});

test('unlock — profil non habilité → 403', () => {
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'magasinier', action: 'unlock', ferme: 'F1', locked: false, rejected: false }).allowed, false);
});

test('action inconnue → refus', () => {
  assert.strictEqual(authorizeValidationAction({ callerProfile: 'dg', action: 'delete', ferme: 'F1' }).allowed, false);
});
