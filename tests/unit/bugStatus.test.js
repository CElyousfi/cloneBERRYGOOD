'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  BUG_STATUSES,
  isValidStatus,
  isAdminProfile,
  validateStatusUpdate,
  sortReportsByCreatedDesc,
} = require('../../functions/lib/bugReports/bugStatus');

test('BUG_STATUSES contient exactement les 3 statuts attendus', () => {
  assert.deepStrictEqual(BUG_STATUSES, ['nouveau', 'en_cours', 'resolu']);
});

test('isValidStatus accepte les statuts connus', () => {
  assert.strictEqual(isValidStatus('nouveau'), true);
  assert.strictEqual(isValidStatus('en_cours'), true);
  assert.strictEqual(isValidStatus('resolu'), true);
});

test('isValidStatus rejette les statuts inconnus / non-string', () => {
  assert.strictEqual(isValidStatus('fini'), false);
  assert.strictEqual(isValidStatus(''), false);
  assert.strictEqual(isValidStatus(null), false);
  assert.strictEqual(isValidStatus(42), false);
});

test('isAdminProfile autorise dg et rh uniquement', () => {
  assert.strictEqual(isAdminProfile('dg'), true);
  assert.strictEqual(isAdminProfile('rh'), true);
  assert.strictEqual(isAdminProfile('achats'), false);
  assert.strictEqual(isAdminProfile('chef_f1'), false);
  assert.strictEqual(isAdminProfile(null), false);
  assert.strictEqual(isAdminProfile(undefined), false);
});

test('validateStatusUpdate rejette un corps invalide', () => {
  assert.strictEqual(validateStatusUpdate(null).valid, false);
  assert.strictEqual(validateStatusUpdate('x').valid, false);
});

test('validateStatusUpdate exige un id non vide', () => {
  assert.strictEqual(validateStatusUpdate({ status: 'nouveau' }).valid, false);
  assert.strictEqual(validateStatusUpdate({ id: '   ', status: 'nouveau' }).valid, false);
});

test('validateStatusUpdate exige un statut valide', () => {
  assert.strictEqual(validateStatusUpdate({ id: 'abc', status: 'wat' }).valid, false);
  assert.strictEqual(validateStatusUpdate({ id: 'abc' }).valid, false);
});

test('validateStatusUpdate accepte et trim un id valide', () => {
  const r = validateStatusUpdate({ id: '  abc123  ', status: 'en_cours' });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.id, 'abc123');
  assert.strictEqual(r.status, 'en_cours');
});

test('sortReportsByCreatedDesc trie par created_at desc (Firestore Timestamp)', () => {
  const reports = [
    { id: 'a', created_at: { toMillis: () => 100 } },
    { id: 'b', created_at: { toMillis: () => 300 } },
    { id: 'c', created_at: { toMillis: () => 200 } },
  ];
  const sorted = sortReportsByCreatedDesc(reports);
  assert.deepStrictEqual(sorted.map((r) => r.id), ['b', 'c', 'a']);
});

test('sortReportsByCreatedDesc tolère Date, number, seconds et absence', () => {
  const reports = [
    { id: 'date', created_at: new Date(50) },
    { id: 'num', created_at: 400 },
    { id: 'sec', created_at: { seconds: 1 } }, // 1000 ms
    { id: 'none' },
  ];
  const sorted = sortReportsByCreatedDesc(reports);
  // num=400 > sec=1000ms ? non : sec=1000 > num=400 > date=50 > none=0
  assert.deepStrictEqual(sorted.map((r) => r.id), ['sec', 'num', 'date', 'none']);
});

test('sortReportsByCreatedDesc ne mute pas le tableau source', () => {
  const reports = [
    { id: 'a', created_at: 1 },
    { id: 'b', created_at: 2 },
  ];
  const copy = reports.slice();
  sortReportsByCreatedDesc(reports);
  assert.deepStrictEqual(reports, copy);
});

test('sortReportsByCreatedDesc retourne [] pour entrée non-array', () => {
  assert.deepStrictEqual(sortReportsByCreatedDesc(null), []);
  assert.deepStrictEqual(sortReportsByCreatedDesc(undefined), []);
});
