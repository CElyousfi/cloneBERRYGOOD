'use strict';

/**
 * Unit tests for src/modules/shared/lib/stockMovementGuard.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('./_esm').loadEsm('src/modules/shared/lib/stockMovementGuard.js');

const creator = { profileId: 'magasinier', name: 'Mag', userId: '' };
const other = { profileId: 'chef_f1', name: 'Chef', userId: '' };

function appMovement(overrides) {
  return Object.assign(
    {
      numero: 'BR-2026-001',
      type: 'reception',
      status: 'valide_mag',
      created_by: { profileId: 'magasinier', name: 'Mag', userId: '' },
    },
    overrides || {}
  );
}

// --- isImportedMovement ---

test('isImportedMovement — true when import_source present', () => {
  assert.equal(G.isImportedMovement({ import_source: 'CANEVA_STOCK_BGF' }), true);
});

test('isImportedMovement — true when created_by.userId is import_caneva', () => {
  assert.equal(G.isImportedMovement({ created_by: { userId: 'import_caneva' } }), true);
});

test('isImportedMovement — true when numero starts with IMP-', () => {
  assert.equal(G.isImportedMovement({ numero: 'IMP-123' }), true);
});

test('isImportedMovement — false for an app movement', () => {
  assert.equal(G.isImportedMovement(appMovement()), false);
});

// --- isValidatedMovement ---

test('isValidatedMovement — only valide_chef counts as validated', () => {
  assert.equal(G.isValidatedMovement(appMovement({ status: 'valide_chef' })), true);
  assert.equal(G.isValidatedMovement(appMovement({ status: 'valide_mag' })), false);
  assert.equal(G.isValidatedMovement(appMovement({ status: 'valide_achats' })), false);
  assert.equal(G.isValidatedMovement(appMovement({ status: 'rejete' })), false);
});

// --- isDeletedMovement ---

test('isDeletedMovement — deleted flag or supprime status', () => {
  assert.equal(G.isDeletedMovement(appMovement({ deleted: true })), true);
  assert.equal(G.isDeletedMovement(appMovement({ status: 'supprime' })), true);
  assert.equal(G.isDeletedMovement(appMovement()), false);
});

// --- isCreator ---

test('isCreator — matches on profileId when userId empty (app reality)', () => {
  assert.equal(G.isCreator(appMovement(), creator), true);
  assert.equal(G.isCreator(appMovement(), other), false);
});

test('isCreator — matches on userId when both populated and non-empty', () => {
  const m = appMovement({ created_by: { profileId: 'magasinier', userId: 'uid-AAA' } });
  assert.equal(G.isCreator(m, { profileId: 'someoneelse', userId: 'uid-AAA' }), true);
  assert.equal(G.isCreator(m, { profileId: 'magasinier', userId: 'uid-BBB' }), false);
});

test('isCreator — never matches the import_caneva pseudo-uid via uid path', () => {
  const m = appMovement({ created_by: { profileId: 'x', userId: 'import_caneva' } });
  assert.equal(G.isCreator(m, { profileId: 'x', userId: 'import_caneva' }), false);
});

test('isCreator — false when requester/profileId missing', () => {
  assert.equal(G.isCreator(appMovement(), {}), false);
  assert.equal(G.isCreator(appMovement(), null), false);
  assert.equal(G.isCreator(null, creator), false);
});

// --- evaluateMutable / canEdit / canDelete ---

test('evaluateMutable — creator + app + non-validé → allowed', () => {
  const r = G.evaluateMutable(appMovement(), creator);
  assert.deepEqual(r, { allowed: true, reason: null });
  assert.equal(G.canEditMovement(appMovement(), creator), true);
  assert.equal(G.canDeleteMovement(appMovement(), creator), true);
});

test('evaluateMutable — not creator → refused', () => {
  assert.deepEqual(G.evaluateMutable(appMovement(), other), { allowed: false, reason: 'not_creator' });
});

// Nouveau schéma : created_by.userId peuplé avec l'uid réel du token à la création.
// Le contrôle créateur passe alors par l'uid (identité réelle), pas le profileId.
test('evaluateMutable — created_by.userId peuplé : même uid (profil différent) → autorisé', () => {
  const m = appMovement({ created_by: { profileId: 'magasinier', name: 'Mag', userId: 'uid-REAL-AAA' } });
  // demandeur d'un AUTRE profil mais MÊME uid → c'est bien le créateur
  const r = G.evaluateMutable(m, { profileId: 'chef_f1', userId: 'uid-REAL-AAA' });
  assert.deepEqual(r, { allowed: true, reason: null });
});

test('evaluateMutable — created_by.userId peuplé : uid différent (même profil) → refusé', () => {
  const m = appMovement({ created_by: { profileId: 'magasinier', name: 'Mag', userId: 'uid-REAL-AAA' } });
  // même profil mais autre uid → PAS le créateur (contrôle par uid après le fix backend)
  const r = G.evaluateMutable(m, { profileId: 'magasinier', userId: 'uid-REAL-BBB' });
  assert.deepEqual(r, { allowed: false, reason: 'not_creator' });
});

test('evaluateMutable — legacy created_by.userId vide : repli sur profileId (rétro-compat)', () => {
  const m = appMovement({ created_by: { profileId: 'magasinier', name: 'Mag', userId: '' } });
  assert.deepEqual(G.evaluateMutable(m, { profileId: 'magasinier', userId: 'uid-X' }), { allowed: true, reason: null });
  assert.deepEqual(G.evaluateMutable(m, { profileId: 'chef_f1', userId: 'uid-X' }), { allowed: false, reason: 'not_creator' });
});

test('evaluateMutable — imported → refused even for matching profile', () => {
  const m = appMovement({ import_source: 'CANEVA_STOCK_BGF', created_by: { profileId: 'magasinier' } });
  assert.deepEqual(G.evaluateMutable(m, creator), { allowed: false, reason: 'imported' });
});

test('evaluateMutable — validated → refused', () => {
  const m = appMovement({ status: 'valide_chef' });
  assert.deepEqual(G.evaluateMutable(m, creator), { allowed: false, reason: 'validated' });
});

test('evaluateMutable — already deleted → refused', () => {
  const m = appMovement({ deleted: true });
  assert.deepEqual(G.evaluateMutable(m, creator), { allowed: false, reason: 'deleted' });
});

test('evaluateMutable — null movement → not_found', () => {
  assert.deepEqual(G.evaluateMutable(null, creator), { allowed: false, reason: 'not_found' });
});

test('canEdit === canDelete (same rule) across cases', () => {
  const cases = [
    appMovement(),
    appMovement({ status: 'valide_chef' }),
    appMovement({ import_source: 'CANEVA_STOCK_BGF' }),
    appMovement({ deleted: true }),
  ];
  for (const m of cases) {
    assert.equal(G.canEditMovement(m, creator), G.canDeleteMovement(m, creator));
  }
});

// --- admin delete (Achats/DG) ---

const achats = { profileId: 'achats', userId: 'uid-A' };
const dg = { profileId: 'dg', userId: 'uid-D' };

test('isAdminDeleter — true for achats and dg only', () => {
  assert.equal(G.isAdminDeleter(achats), true);
  assert.equal(G.isAdminDeleter(dg), true);
  assert.equal(G.isAdminDeleter({ profileId: 'magasinier' }), false);
  assert.equal(G.isAdminDeleter({ profileId: 'chef_f1' }), false);
  assert.equal(G.isAdminDeleter(null), false);
});

test('evaluateAdminDelete — saisi app validé non-créateur → allowed (pas de restriction)', () => {
  const m = appMovement({ status: 'valide_chef', created_by: { profileId: 'magasinier' } });
  assert.deepEqual(G.evaluateAdminDelete(m, achats), { allowed: true, reason: null });
  assert.deepEqual(G.evaluateAdminDelete(m, dg), { allowed: true, reason: null });
  assert.equal(G.canAdminDeleteMovement(m, achats), true);
});

test('evaluateAdminDelete — bon importé GRAND_LIVRE → refusé (garde-fou absolu)', () => {
  const m = appMovement({ import_source: 'GRAND_LIVRE' });
  assert.deepEqual(G.evaluateAdminDelete(m, achats), { allowed: false, reason: 'imported' });
  assert.deepEqual(G.evaluateAdminDelete(m, dg), { allowed: false, reason: 'imported' });
  assert.equal(G.canAdminDeleteMovement(m, dg), false);
});

test('evaluateAdminDelete — bon importé CANEVA / IMP- → aussi refusé', () => {
  assert.deepEqual(G.evaluateAdminDelete(appMovement({ created_by: { userId: 'import_caneva' } }), achats), { allowed: false, reason: 'imported' });
  assert.deepEqual(G.evaluateAdminDelete(appMovement({ numero: 'IMP-9' }), achats), { allowed: false, reason: 'imported' });
});

test('evaluateAdminDelete — déjà supprimé → deleted', () => {
  assert.deepEqual(G.evaluateAdminDelete(appMovement({ deleted: true }), achats), { allowed: false, reason: 'deleted' });
});

test('evaluateAdminDelete — non-admin → not_admin', () => {
  assert.deepEqual(G.evaluateAdminDelete(appMovement(), creator), { allowed: false, reason: 'not_admin' });
});

test('evaluateAdminDelete — null movement → not_found', () => {
  assert.deepEqual(G.evaluateAdminDelete(null, achats), { allowed: false, reason: 'not_found' });
});

// --- refusalMessage ---

test('refusalMessage — returns a non-empty FR string per reason', () => {
  for (const reason of ['not_found', 'imported', 'validated', 'deleted', 'not_creator', 'not_admin', 'whatever']) {
    assert.equal(typeof G.refusalMessage(reason), 'string');
    assert.ok(G.refusalMessage(reason).length > 0);
  }
});
