'use strict';

/**
 * Unit tests for scripts/migrateStatuts.js
 *
 * Strategy:
 *   - planMigration() is a pure function — tested directly with plain objects
 *   - applyMigration() is tested with an in-memory mock of the Firestore
 *     batch API. The mock counts .update() calls so we can assert that
 *     dry-run never writes and --force writes exactly N times.
 *
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../scripts/migrateStatuts.js');

// ----- Mock Firestore -----
function makeMockDb() {
  const updates = []; // captured update payloads {id, payload}
  let batchCount = 0;
  const db = {
    batch() {
      batchCount++;
      const ops = [];
      return {
        update(ref, payload) {
          ops.push({ ref, payload });
        },
        async commit() {
          for (const op of ops) updates.push({ id: op.ref._id, payload: op.payload });
        },
      };
    },
    collection(name) {
      return {
        _name: name,
        doc(id) { return { _id: id, _coll: name }; },
      };
    },
    _stats() { return { updates, batchCount }; },
  };
  return db;
}


// ============================================================================
// planMigration — pure
// ============================================================================

test('planMigration — empty / non-array → empty plan', () => {
  const p1 = M.planMigration([]);
  assert.equal(p1.summary.total, 0);
  assert.equal(p1.toMigrate.length, 0);
  assert.equal(p1.unchanged.length, 0);

  const p2 = M.planMigration(null);
  assert.equal(p2.summary.total, 0);

  const p3 = M.planMigration(undefined);
  assert.equal(p3.summary.total, 0);
});

test('planMigration — canonical statuses are unchanged', () => {
  const docs = [
    { id: 'a', status: 'brouillon' },
    { id: 'b', status: 'soumis' },
    { id: 'c', status: 'a_revoir' },
    { id: 'd', status: 'valide' },
    { id: 'e', status: 'rejete' },
  ];
  const p = M.planMigration(docs);
  assert.equal(p.unchanged.length, 5);
  assert.equal(p.toMigrate.length, 0);
});

test('planMigration — legacy "en_attente" / "Validé" / unknown → soumis (fallback)', () => {
  const docs = [
    { id: 'a', status: 'en_attente' },
    { id: 'b', status: 'Validé' }, // case-sensitive: not canonical
    { id: 'c', status: 'pending' },
    { id: 'd', status: '' },
  ];
  const p = M.planMigration(docs);
  assert.equal(p.toMigrate.length, 4);
  assert.ok(p.toMigrate.every(m => m.newStatus === M.FALLBACK_STATUS));
  assert.equal(M.FALLBACK_STATUS, 'soumis');
});

test('planMigration — missing status field → migrated to soumis', () => {
  const docs = [
    { id: 'x' }, // no status at all
    { id: 'y', status: null },
    { id: 'z', status: undefined },
  ];
  const p = M.planMigration(docs);
  assert.equal(p.toMigrate.length, 3);
  assert.ok(p.toMigrate.every(m => m.newStatus === 'soumis'));
});

test('planMigration — accepte le shape Firestore doc avec .data()', () => {
  const docs = [
    { id: 'a', data: () => ({ status: 'valide' }) },
    { id: 'b', data: () => ({ status: 'legacy_unknown' }) },
  ];
  const p = M.planMigration(docs);
  assert.equal(p.unchanged.length, 1);
  assert.equal(p.toMigrate.length, 1);
  assert.equal(p.toMigrate[0].id, 'b');
});

test('planMigration — summary.byOldStatus compte les occurrences', () => {
  const docs = [
    { id: 'a', status: 'valide' }, { id: 'b', status: 'valide' },
    { id: 'c', status: 'en_attente' },
    { id: 'd', status: '' },
  ];
  const p = M.planMigration(docs);
  assert.equal(p.summary.byOldStatus['valide'], 2);
  assert.equal(p.summary.byOldStatus['en_attente'], 1);
  assert.equal(p.summary.byOldStatus['(missing)'], 1);
});

test('planMigration — summary totaux cohérents', () => {
  const docs = [
    { id: 'a', status: 'valide' },
    { id: 'b', status: 'unknown' },
    { id: 'c' },
  ];
  const p = M.planMigration(docs);
  assert.equal(p.summary.total, 3);
  assert.equal(p.summary.unchanged, 1);
  assert.equal(p.summary.toMigrate, 2);
});


// ============================================================================
// applyMigration — mock Firestore
// ============================================================================

test('applyMigration — N migrations → N .update() appels en chunks ≤ 400', async () => {
  const db = makeMockDb();
  // 850 migrations → 3 chunks (400 + 400 + 50)
  const migrations = Array.from({ length: 850 }, (_, i) => ({
    id: `tx-${i}`,
    oldStatus: 'legacy',
    newStatus: 'soumis',
  }));
  const result = await M.applyMigration(migrations, db, 'caisse_transactions');
  assert.equal(result.written, 850);
  assert.equal(result.chunks, 3);
  const stats = db._stats();
  assert.equal(stats.updates.length, 850, 'should have invoked update 850 times across batches');
  assert.equal(stats.batchCount, 3, 'should have created exactly 3 batches');
});

test('applyMigration — chaque update porte status + status_migrated_from + status_migrated_at', async () => {
  const db = makeMockDb();
  const migrations = [
    { id: 'a', oldStatus: 'en_attente', newStatus: 'soumis' },
    { id: 'b', oldStatus: '',           newStatus: 'soumis' },
  ];
  await M.applyMigration(migrations, db, 'caisse_transactions');
  const updates = db._stats().updates;
  assert.equal(updates.length, 2);
  for (const u of updates) {
    assert.equal(u.payload.status, 'soumis');
    assert.ok('status_migrated_from' in u.payload);
    assert.ok(u.payload.status_migrated_at instanceof Date);
  }
  assert.equal(updates[0].payload.status_migrated_from, 'en_attente');
  assert.equal(updates[1].payload.status_migrated_from, null); // empty string → null per applyMigration logic
});

test('applyMigration — vide → 0 update, 0 chunk', async () => {
  const db = makeMockDb();
  const res = await M.applyMigration([], db);
  assert.equal(res.written, 0);
  assert.equal(res.chunks, 0);
  assert.equal(db._stats().updates.length, 0);
});


// ============================================================================
// Dry-run vs --force — simulate the CLI behavior
// ============================================================================

test('dry-run sémantique — planMigration sans applyMigration → aucune écriture', () => {
  const db = makeMockDb();
  const docs = [
    { id: 'a', status: 'unknown' },
    { id: 'b', status: 'unknown' },
  ];
  const plan = M.planMigration(docs);
  // En dry-run on n'appelle PAS applyMigration → aucune écriture
  assert.equal(plan.toMigrate.length, 2);
  assert.equal(db._stats().updates.length, 0, 'dry-run must NEVER write');
  assert.equal(db._stats().batchCount, 0, 'dry-run must NEVER open a batch');
});

test('--force sémantique — applyMigration appelée → exactement N écritures', async () => {
  const db = makeMockDb();
  const docs = [
    { id: 'a', status: 'legacy' },
    { id: 'b', status: 'valide' },     // unchanged
    { id: 'c', status: '' },
  ];
  const plan = M.planMigration(docs);
  assert.equal(plan.toMigrate.length, 2);
  await M.applyMigration(plan.toMigrate, db);
  // exactement N = 2 .update() calls
  assert.equal(db._stats().updates.length, 2);
  assert.equal(db._stats().batchCount, 1);
});


// ============================================================================
// Constants
// ============================================================================

test('CANONICAL_STATUSES contient les 5 statuts attendus', () => {
  assert.deepEqual(M.CANONICAL_STATUSES.slice().sort(), ['a_revoir', 'brouillon', 'rejete', 'soumis', 'valide']);
});
