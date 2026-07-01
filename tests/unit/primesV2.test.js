'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const V = require('../../public/lib/primesV2.js');

// --- searchWorkers -----------------------------------------------------

const REGISTRY = [
  { docId: '001', matricule: '001', nom: 'Ahmed Benali', prime: 0 },
  { docId: '002', matricule: '002', nom: 'Fatima Zahra', prime: 12.5 },
  { docId: '003', matricule: '003', nom: 'Ãhmed Cherkaoui', prime: 0 },
  { docId: '150', matricule: '150', nom: '', prime: 0 },
];

test('searchWorkers: empty query returns nothing (no accidental full dump)', () => {
  assert.deepStrictEqual(V.searchWorkers(REGISTRY, ''), []);
  assert.deepStrictEqual(V.searchWorkers(REGISTRY, '   '), []);
  assert.deepStrictEqual(V.searchWorkers(REGISTRY, null), []);
});

test('searchWorkers: finds by matricule INCLUDING workers at prime 0', () => {
  const res = V.searchWorkers(REGISTRY, '001');
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].matricule, '001');
  assert.strictEqual(res[0].prime, 0); // prime 0 not filtered out
});

test('searchWorkers: finds by nom, case + accent insensitive', () => {
  const res = V.searchWorkers(REGISTRY, 'ahmed');
  const noms = res.map((r) => r.nom).sort();
  assert.deepStrictEqual(noms, ['Ahmed Benali', 'Ãhmed Cherkaoui']);
});

test('searchWorkers: matricule substring matches multiple', () => {
  const res = V.searchWorkers(REGISTRY, '0');
  assert.ok(res.length >= 3);
});

test('searchWorkers: respects limit', () => {
  const big = [];
  for (let i = 0; i < 100; i++) big.push({ docId: String(i), matricule: String(i), nom: 'X', prime: 0 });
  const res = V.searchWorkers(big, 'X', 10);
  assert.strictEqual(res.length, 10);
});

test('searchWorkers: falls back to matricule when docId missing', () => {
  const res = V.searchWorkers([{ matricule: '999', nom: 'Test', prime: 5 }], '999');
  assert.strictEqual(res[0].docId, '999');
});

// --- buildHistoryView --------------------------------------------------

test('buildHistoryView: absent/empty history returns []', () => {
  assert.deepStrictEqual(V.buildHistoryView(undefined), []);
  assert.deepStrictEqual(V.buildHistoryView(null), []);
  assert.deepStrictEqual(V.buildHistoryView([]), []);
});

test('buildHistoryView: sorted by changedAt DESCENDING', () => {
  const h = [
    { montant: 10, previousMontant: 0, effectiveFrom: '2026-01-01', changedBy: { name: 'A' }, changedAt: 1000 },
    { montant: 20, previousMontant: 10, effectiveFrom: '2026-02-01', changedBy: { name: 'B' }, changedAt: 3000 },
    { montant: 15, previousMontant: 20, effectiveFrom: '2026-03-01', changedBy: { name: 'C' }, changedAt: 2000 },
  ];
  const v = V.buildHistoryView(h);
  assert.deepStrictEqual(v.map((e) => e.changedAt), [3000, 2000, 1000]);
  assert.strictEqual(v[0].montant, 20);
  assert.strictEqual(v[0].previousMontant, 10);
});

test('buildHistoryView: does not mutate input', () => {
  const h = [
    { montant: 1, changedAt: 100 },
    { montant: 2, changedAt: 200 },
  ];
  V.buildHistoryView(h);
  assert.strictEqual(h[0].montant, 1); // original order untouched
});

test('buildHistoryView: author falls back name → profileId → dash', () => {
  const v = V.buildHistoryView([
    { changedAt: 3, changedBy: { name: 'Nom RH', profileId: 'rh' } },
    { changedAt: 2, changedBy: { profileId: 'dg' } },
    { changedAt: 1, changedBy: {} },
  ]);
  assert.strictEqual(v[0].author, 'Nom RH');
  assert.strictEqual(v[1].author, 'dg');
  assert.strictEqual(v[2].author, '—');
});

test('buildHistoryView: coerces numbers, handles missing changedAt', () => {
  const v = V.buildHistoryView([{ montant: '25', previousMontant: '10', effectiveFrom: '2026-07-01' }]);
  assert.strictEqual(v[0].montant, 25);
  assert.strictEqual(v[0].previousMontant, 10);
  assert.strictEqual(v[0].changedAt, null);
});
