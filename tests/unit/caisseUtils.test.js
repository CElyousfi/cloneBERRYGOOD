'use strict';

/**
 * Unit tests for public/lib/caisseUtils.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../public/lib/caisseUtils.js');

// Fixed reference date used across tests.
const NOW = new Date('2026-05-15T12:00:00Z');

// Helper to build a minimal valid tx.
function tx(overrides) {
  return Object.assign({
    id: 'tx1',
    caisse_id: 'caisse_depenses',
    type: 'depense',
    montant: 100,
    date: '2026-05-10',
    description: 'Achat de gasoil',
    reference: 'REF-001',
    code_analytique: 'FRAMBOISE - Ferme 01',
    fournisseur: 'TOTAL',
    saisie_by: { name: 'Achraf' },
    status: 'valide',
  }, overrides || {});
}

// ============================================================================
// detectCaisseAnomalies
// ============================================================================

test('detectCaisseAnomalies — transaction saine ne renvoie aucune anomalie', () => {
  const result = U.detectCaisseAnomalies(tx(), NOW);
  assert.deepEqual(result, []);
});

test('detectCaisseAnomalies — input non-objet renvoie []', () => {
  assert.deepEqual(U.detectCaisseAnomalies(null, NOW), []);
  assert.deepEqual(U.detectCaisseAnomalies(undefined, NOW), []);
  assert.deepEqual(U.detectCaisseAnomalies('foo', NOW), []);
});

test('detectCaisseAnomalies — Rule 1 DATE_ABERRANTE (futur > now+1j)', () => {
  const r = U.detectCaisseAnomalies(tx({ date: '2055-08-14' }), NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, U.ANOMALY_CODES.DATE_ABERRANTE);
  assert.match(r[0].message, /2055-08-14/);
});

test('detectCaisseAnomalies — Rule 1 DATE_ABERRANTE (passé < now-2ans)', () => {
  const r = U.detectCaisseAnomalies(tx({ date: '2020-01-01' }), NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, U.ANOMALY_CODES.DATE_ABERRANTE);
});

test('detectCaisseAnomalies — Rule 1 — frontières exactes', () => {
  // now + 1 jour exactement → OK (limite inclusive)
  const okFuture = U.detectCaisseAnomalies(tx({ date: '2026-05-16' }), NOW);
  assert.equal(okFuture.length, 0);
  // now − 2 ans exactement → OK
  const okPast = U.detectCaisseAnomalies(tx({ date: '2024-05-15' }), NOW);
  assert.equal(okPast.length, 0);
  // now + 2 jours → KO
  const koFuture = U.detectCaisseAnomalies(tx({ date: '2026-05-17' }), NOW);
  assert.equal(koFuture.length, 1);
  assert.equal(koFuture[0].code, U.ANOMALY_CODES.DATE_ABERRANTE);
});

test('detectCaisseAnomalies — Rule 1 — date invalide est ignorée (pas de faux positif)', () => {
  const r = U.detectCaisseAnomalies(tx({ date: 'pas-une-date' }), NOW);
  // La règle date n'attire pas, mais aucune autre règle non plus.
  assert.equal(r.filter(a => a.code === U.ANOMALY_CODES.DATE_ABERRANTE).length, 0);
});

test('detectCaisseAnomalies — Rule 2 MONTANT_INHABITUEL', () => {
  assert.equal(U.detectCaisseAnomalies(tx({ montant: 50001 }), NOW).length, 1);
  assert.equal(U.detectCaisseAnomalies(tx({ montant: -50001 }), NOW).length, 1);
  // Frontière exacte non flaggée
  assert.equal(U.detectCaisseAnomalies(tx({ montant: 50000 }), NOW).length, 0);
  assert.equal(U.detectCaisseAnomalies(tx({ montant: -50000 }), NOW).length, 0);
});

test('detectCaisseAnomalies — Rule 3 DESCRIPTION_COURTE — couverture exhaustive', () => {
  // null → DESCRIPTION_COURTE (length 0 < 5)
  let r = U.detectCaisseAnomalies(tx({ description: null }), NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, U.ANOMALY_CODES.DESCRIPTION_COURTE);

  // undefined → DESCRIPTION_COURTE
  r = U.detectCaisseAnomalies(tx({ description: undefined }), NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, U.ANOMALY_CODES.DESCRIPTION_COURTE);

  // "" → DESCRIPTION_COURTE
  r = U.detectCaisseAnomalies(tx({ description: '' }), NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, U.ANOMALY_CODES.DESCRIPTION_COURTE);

  // "    " (espaces seuls, trim → "") → DESCRIPTION_COURTE
  r = U.detectCaisseAnomalies(tx({ description: '    ' }), NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, U.ANOMALY_CODES.DESCRIPTION_COURTE);

  // "AVAN" (4 chars) → DESCRIPTION_COURTE
  r = U.detectCaisseAnomalies(tx({ description: 'AVAN' }), NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, U.ANOMALY_CODES.DESCRIPTION_COURTE);

  // "GASOIL" (6 chars) → pas d'anomalie
  r = U.detectCaisseAnomalies(tx({ description: 'GASOIL' }), NOW);
  assert.equal(r.length, 0);
});

test('detectCaisseAnomalies — Rule 4 ANALYTIQUE_VIDE', () => {
  // Vide
  let r = U.detectCaisseAnomalies(tx({ code_analytique: '' }), NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, U.ANOMALY_CODES.ANALYTIQUE_VIDE);

  // Placeholder "BGF - BGF"
  r = U.detectCaisseAnomalies(tx({ code_analytique: 'BGF - BGF' }), NOW);
  assert.equal(r.length, 1);
  assert.equal(r[0].code, U.ANOMALY_CODES.ANALYTIQUE_VIDE);

  // null / undefined
  r = U.detectCaisseAnomalies(tx({ code_analytique: null }), NOW);
  assert.equal(r.length, 1);
  r = U.detectCaisseAnomalies(tx({ code_analytique: undefined }), NOW);
  assert.equal(r.length, 1);

  // Valeur réelle → OK
  r = U.detectCaisseAnomalies(tx({ code_analytique: 'AVOCAT - Ferme 06' }), NOW);
  assert.equal(r.length, 0);
});

test('detectCaisseAnomalies — règles cumulées et ordre déterministe (1,2,3,4)', () => {
  const r = U.detectCaisseAnomalies(tx({
    date: '2055-08-14',     // R1
    montant: 99999,         // R2
    description: 'X',       // R3
    code_analytique: '',    // R4
  }), NOW);
  assert.equal(r.length, 4);
  assert.equal(r[0].code, U.ANOMALY_CODES.DATE_ABERRANTE);
  assert.equal(r[1].code, U.ANOMALY_CODES.MONTANT_INHABITUEL);
  assert.equal(r[2].code, U.ANOMALY_CODES.DESCRIPTION_COURTE);
  assert.equal(r[3].code, U.ANOMALY_CODES.ANALYTIQUE_VIDE);
});

// ============================================================================
// computeTotals
// ============================================================================

test('computeTotals — liste vide → tout à 0', () => {
  const t = U.computeTotals([]);
  assert.equal(t.count, 0);
  assert.equal(t.totalDepensesOp, 0);
  assert.equal(t.totalRecettes, 0);
  assert.equal(t.totalTransfers, 0);
  assert.equal(t.soldeNet, 0);
});

test('computeTotals — input non-array → tout à 0', () => {
  assert.deepEqual(U.computeTotals(null), { count: 0, totalDepensesOp: 0, totalRecettes: 0, totalTransfers: 0, soldeNet: 0 });
  assert.deepEqual(U.computeTotals(undefined), { count: 0, totalDepensesOp: 0, totalRecettes: 0, totalTransfers: 0, soldeNet: 0 });
});

test('computeTotals — sépare depenses_op, recettes, transferts et calcule solde net', () => {
  const list = [
    tx({ type: 'alimentation', montant: 1000 }),
    tx({ type: 'depense', montant: 300 }),
    tx({ type: 'sortie', montant: 200 }),
    tx({ type: 'transfer_in', montant: 500 }),
    tx({ type: 'transfer_out', montant: 100 }),
  ];
  const t = U.computeTotals(list);
  assert.equal(t.count, 5);
  assert.equal(t.totalDepensesOp, 500);            // 300 + 200
  assert.equal(t.totalRecettes, 1000);             // alimentation
  assert.equal(t.totalTransfers, 400);             // 500 in − 100 out
  assert.equal(t.soldeNet, 1000 + 500 - 300 - 200 - 100); // 900
});

test('computeTotals — transferts algébriques proches de 0 en multi-caisses', () => {
  // Un transfer_in dans la caisse A et transfer_out dans la caisse B, montant identique
  const list = [
    tx({ caisse_id: 'A', type: 'transfer_in', montant: 700 }),
    tx({ caisse_id: 'B', type: 'transfer_out', montant: 700 }),
  ];
  const t = U.computeTotals(list);
  assert.equal(t.totalTransfers, 0);
  // Solde net du flux global aussi à 0
  assert.equal(t.soldeNet, 0);
});

test('computeTotals — montants invalides ignorés', () => {
  const list = [
    tx({ type: 'alimentation', montant: 100 }),
    tx({ type: 'depense', montant: 'NaN-string' }),
    tx({ type: 'depense', montant: null }),
    tx({ type: 'depense', montant: undefined }),
  ];
  const t = U.computeTotals(list);
  assert.equal(t.count, 4);                // count = len(input), pas filtré
  assert.equal(t.totalDepensesOp, 0);
  assert.equal(t.totalRecettes, 100);
});

// ============================================================================
// quickPeriodToDateRange
// ============================================================================

test("quickPeriodToDateRange — 'all' retourne strictement null", () => {
  const r = U.quickPeriodToDateRange('all', NOW);
  assert.strictEqual(r, null);
});

test("quickPeriodToDateRange — période inconnue ou vide → null", () => {
  assert.strictEqual(U.quickPeriodToDateRange('', NOW), null);
  assert.strictEqual(U.quickPeriodToDateRange(undefined, NOW), null);
  assert.strictEqual(U.quickPeriodToDateRange('blabla', NOW), null);
});

test("quickPeriodToDateRange — 'today'", () => {
  const r = U.quickPeriodToDateRange('today', NOW);
  // NOW = 2026-05-15 UTC midi → local "2026-05-15" sur la quasi-totalité du globe
  // Test robuste: from === to (un seul jour)
  assert.equal(typeof r.from, 'string');
  assert.equal(r.from, r.to);
  assert.match(r.from, /^\d{4}-\d{2}-\d{2}$/);
});

test("quickPeriodToDateRange — 'last7' couvre 7 jours inclusifs", () => {
  const r = U.quickPeriodToDateRange('last7', NOW);
  const from = new Date(r.from); const to = new Date(r.to);
  const diffDays = Math.round((to - from) / 86400000);
  assert.equal(diffDays, 6); // 7 jours inclusifs (J−6 → J)
});

test("quickPeriodToDateRange — 'thisMonth' commence au 1er", () => {
  const r = U.quickPeriodToDateRange('thisMonth', NOW);
  assert.match(r.from, /^\d{4}-\d{2}-01$/);
});

test("quickPeriodToDateRange — 'lastMonth' couvre tout le mois précédent", () => {
  const r = U.quickPeriodToDateRange('lastMonth', new Date('2026-05-15T12:00:00'));
  assert.equal(r.from, '2026-04-01');
  assert.equal(r.to, '2026-04-30');
});

test("quickPeriodToDateRange — 'lastMonth' depuis janvier → décembre n−1", () => {
  const r = U.quickPeriodToDateRange('lastMonth', new Date('2026-01-15T12:00:00'));
  assert.equal(r.from, '2025-12-01');
  assert.equal(r.to, '2025-12-31');
});

// ============================================================================
// searchTransactions
// ============================================================================

test('searchTransactions — query vide → input inchangé (copie)', () => {
  const list = [tx(), tx({ id: 'tx2' })];
  const r = U.searchTransactions(list, '');
  assert.equal(r.length, 2);
  assert.notStrictEqual(r, list); // copie, pas référence
});

test('searchTransactions — input non-array → []', () => {
  assert.deepEqual(U.searchTransactions(null, 'foo'), []);
  assert.deepEqual(U.searchTransactions(undefined, 'foo'), []);
});

test('searchTransactions — insensible à la casse', () => {
  const r = U.searchTransactions([tx({ description: 'Achat de Gasoil' })], 'gasoil');
  assert.equal(r.length, 1);
});

test('searchTransactions — insensible aux accents', () => {
  const r = U.searchTransactions([tx({ description: 'Réparation Émincé' })], 'reparation eminc');
  assert.equal(r.length, 1);
});

test('searchTransactions — match sur référence', () => {
  const r = U.searchTransactions([tx({ reference: 'IMPORT-BAHIA-452' })], 'bahia-452');
  assert.equal(r.length, 1);
});

test('searchTransactions — match sur code analytique', () => {
  const r = U.searchTransactions([tx({ code_analytique: 'AVOCAT - Ferme 06' })], 'ferme 06');
  assert.equal(r.length, 1);
});

test('searchTransactions — match sur fournisseur', () => {
  const r = U.searchTransactions([tx({ fournisseur: 'Droguerie LAOUAMRA' })], 'laouamra');
  assert.equal(r.length, 1);
});

test('searchTransactions — match sur saisie_by.name', () => {
  const r = U.searchTransactions([tx({ saisie_by: { name: 'Achraf EL INAK' } })], 'achraf');
  assert.equal(r.length, 1);
});

test('searchTransactions — montant avec virgule décimale ("500,00") matche montant=500 et -500', () => {
  const r1 = U.searchTransactions([tx({ montant: 500 })], '500,00');
  assert.equal(r1.length, 1);
  const r2 = U.searchTransactions([tx({ montant: -500 })], '500,00');
  assert.equal(r2.length, 1);
  // Equivalent avec point : doit aussi matcher
  const r3 = U.searchTransactions([tx({ montant: 500 })], '500.00');
  assert.equal(r3.length, 1);
});

test('searchTransactions — AND-sémantique multi-tokens', () => {
  const list = [
    tx({ description: 'Achat gasoil',     fournisseur: 'TOTAL' }),
    tx({ description: 'Achat papeterie',  fournisseur: 'Librairie AYA' }),
    tx({ description: 'Réparation auto',  fournisseur: 'TOTAL' }),
  ];
  // "gasoil total" doit matcher uniquement la 1ère
  const r = U.searchTransactions(list, 'gasoil total');
  assert.equal(r.length, 1);
  assert.equal(r[0].description, 'Achat gasoil');
});

test('searchTransactions — espaces seuls = vide', () => {
  const r = U.searchTransactions([tx()], '   ');
  assert.equal(r.length, 1); // input retourné inchangé
});

// ============================================================================
// filterByQuickType
// ============================================================================

test("filterByQuickType — 'all' retourne tout (copie)", () => {
  const list = [tx(), tx({ id: 'tx2' })];
  const r = U.filterByQuickType(list, 'all');
  assert.equal(r.length, 2);
  assert.notStrictEqual(r, list);
});

test("filterByQuickType — 'depenses' garde uniquement depense+sortie", () => {
  const list = [
    tx({ type: 'depense' }), tx({ type: 'sortie' }),
    tx({ type: 'alimentation' }), tx({ type: 'transfer_in' }), tx({ type: 'transfer_out' }),
  ];
  const r = U.filterByQuickType(list, 'depenses');
  assert.equal(r.length, 2);
  assert.ok(r.every(t => t.type === 'depense' || t.type === 'sortie'));
});

test("filterByQuickType — 'recettes' garde uniquement alimentation (pas transfer_in)", () => {
  const list = [
    tx({ type: 'alimentation' }), tx({ type: 'transfer_in' }), tx({ type: 'depense' }),
  ];
  const r = U.filterByQuickType(list, 'recettes');
  assert.equal(r.length, 1);
  assert.equal(r[0].type, 'alimentation');
});

test("filterByQuickType — 'transferts' garde uniquement les 2 types de transfert", () => {
  const list = [
    tx({ type: 'alimentation' }), tx({ type: 'transfer_in' }),
    tx({ type: 'transfer_out' }), tx({ type: 'depense' }),
  ];
  const r = U.filterByQuickType(list, 'transferts');
  assert.equal(r.length, 2);
  assert.ok(r.every(t => t.type === 'transfer_in' || t.type === 'transfer_out'));
});

test("filterByQuickType — type inconnu → tout retourné inchangé", () => {
  const list = [tx()];
  const r = U.filterByQuickType(list, 'blabla');
  assert.equal(r.length, 1);
});
