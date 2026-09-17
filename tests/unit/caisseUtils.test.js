'use strict';

/**
 * Unit tests for src/modules/shared/lib/caisseUtils.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const U = require('./_esm').loadEsm('src/modules/shared/lib/caisseUtils.js');

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


// ============================================================================
// Sprint 2 — detectAnomaliesBatch (5 nouvelles règles cross-dataset)
// ============================================================================

// Helper for batch tests — assign unique ids and references when not provided.
function tx2(overrides) {
  const base = tx(overrides);
  if (!overrides || !overrides.id) base.id = `tx-batch-${Math.random().toString(36).slice(2, 8)}`;
  if (!overrides || !overrides.reference) base.reference = `REF-${base.id}`;
  return base;
}

// Reference date for Sprint 2 batch tests
const BATCH_NOW = new Date('2026-05-15T12:00:00Z');

// Helper — collect anomaly codes for a given tx id from a batch result Map.
function codesFor(map, txId) {
  const arr = map.get(txId);
  return arr ? arr.map(a => a.code) : [];
}

test('detectAnomaliesBatch — existe et retourne une Map', () => {
  assert.equal(typeof U.detectAnomaliesBatch, 'function');
  const r = U.detectAnomaliesBatch([], BATCH_NOW);
  assert.ok(r instanceof Map);
  assert.equal(r.size, 0);
});

test('detectAnomaliesBatch — input non-array → Map vide', () => {
  assert.equal(U.detectAnomaliesBatch(null, BATCH_NOW).size, 0);
  assert.equal(U.detectAnomaliesBatch(undefined, BATCH_NOW).size, 0);
});

test('detectAnomaliesBatch — tx propre n\'apparaît PAS dans la Map (absence = clean)', () => {
  const r = U.detectAnomaliesBatch([tx2()], BATCH_NOW);
  assert.equal(r.size, 0);
});

test('detectAnomaliesBatch — clé Map = tx.id || tx.reference', () => {
  // tx avec id explicite → clé = id
  const txWithId = tx2({ id: 'my-id', reference: 'my-ref', description: 'X', code_analytique: '' });
  const r1 = U.detectAnomaliesBatch([txWithId], BATCH_NOW);
  assert.ok(r1.has('my-id'));

  // tx sans id (id supprimé) → clé = reference
  const noId = tx2({ reference: 'only-ref', description: 'X', code_analytique: '' });
  delete noId.id;
  const r2 = U.detectAnomaliesBatch([noId], BATCH_NOW);
  assert.ok(r2.has('only-ref'));
});

test('detectAnomaliesBatch — combine Sprint 1 + Sprint 2 dans le bon ordre', () => {
  // Tx qui déclenche :
  //   S1: MONTANT_INHABITUEL (montant=99999), ANALYTIQUE_VIDE (code_analytique='')
  //   S2: DESCRIPTION_GENERIQUE (description='avance')
  // Note : aucun mot générique (avance, achat, paiement, divers, frais) ne fait
  // < 5 chars, donc DESCRIPTION_COURTE et DESCRIPTION_GENERIQUE sont mutuellement
  // exclusives dans le set de règles actuel.
  const t = tx2({ id: 'multi', montant: 99999, description: 'avance', code_analytique: '' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  const codes = codesFor(r, 'multi');
  // Sprint 1 attendues
  assert.ok(codes.indexOf(U.ANOMALY_CODES.MONTANT_INHABITUEL) >= 0);
  assert.ok(codes.indexOf(U.ANOMALY_CODES.ANALYTIQUE_VIDE) >= 0);
  // Sprint 2 attendue
  assert.ok(codes.indexOf(U.ANOMALY_CODES.DESCRIPTION_GENERIQUE) >= 0);
  // Order: tous les codes Sprint 1 présents précèdent tous les codes Sprint 2 présents
  const sprint1Codes = [U.ANOMALY_CODES.DATE_ABERRANTE, U.ANOMALY_CODES.MONTANT_INHABITUEL, U.ANOMALY_CODES.DESCRIPTION_COURTE, U.ANOMALY_CODES.ANALYTIQUE_VIDE];
  const sprint2Codes = [U.ANOMALY_CODES.DOUBLON_PROBABLE, U.ANOMALY_CODES.MONTANT_ATYPIQUE, U.ANOMALY_CODES.DESCRIPTION_GENERIQUE, U.ANOMALY_CODES.BENEFICIAIRE_IMPRECIS, U.ANOMALY_CODES.INCOHERENCE_CAISSE_ANALYTIQUE];
  const presentS1 = sprint1Codes.map(c => codes.indexOf(c)).filter(i => i >= 0);
  const presentS2 = sprint2Codes.map(c => codes.indexOf(c)).filter(i => i >= 0);
  const lastS1Idx = presentS1.length > 0 ? Math.max(...presentS1) : -1;
  const firstS2Idx = presentS2.length > 0 ? Math.min(...presentS2) : Infinity;
  assert.ok(lastS1Idx < firstS2Idx, `Sprint 1 codes (last @${lastS1Idx}) must precede Sprint 2 codes (first @${firstS2Idx})`);
});


// ---- Rule DOUBLON_PROBABLE ----

test('DOUBLON_PROBABLE — 2 tx identiques même jour → les deux flaggées', () => {
  const a = tx2({ id: 'a', reference: 'A', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const b = tx2({ id: 'b', reference: 'B', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const r = U.detectAnomaliesBatch([a, b], BATCH_NOW);
  assert.ok(codesFor(r, 'a').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE) >= 0);
  assert.ok(codesFor(r, 'b').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE) >= 0);
  // Message contient la référence de l'autre tx
  const msgA = r.get('a').find(x => x.code === U.ANOMALY_CODES.DOUBLON_PROBABLE).message;
  const msgB = r.get('b').find(x => x.code === U.ANOMALY_CODES.DOUBLON_PROBABLE).message;
  assert.match(msgA, /B/);
  assert.match(msgB, /A/);
});

test('DOUBLON_PROBABLE — descriptions similaires (Levenshtein < 3 sur premiers 20 chars)', () => {
  // "Achat gasoil tracteur" vs "Achat gasoll tracteur" → 1 substitution sur les 20 premiers → match
  const a = tx2({ id: 'a', reference: 'A', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const b = tx2({ id: 'b', reference: 'B', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoll tracteur' });
  const r = U.detectAnomaliesBatch([a, b], BATCH_NOW);
  assert.ok(codesFor(r, 'a').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE) >= 0);
});

test('DOUBLON_PROBABLE — descriptions trop différentes → pas flaggées', () => {
  const a = tx2({ id: 'a', reference: 'A', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const b = tx2({ id: 'b', reference: 'B', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Reparation voiture XYZ' });
  const r = U.detectAnomaliesBatch([a, b], BATCH_NOW);
  assert.equal(codesFor(r, 'a').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE), -1);
  assert.equal(codesFor(r, 'b').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE), -1);
});

test('DOUBLON_PROBABLE — caisses différentes → pas flaggées', () => {
  const a = tx2({ id: 'a', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const b = tx2({ id: 'b', caisse_id: 'c2', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const r = U.detectAnomaliesBatch([a, b], BATCH_NOW);
  assert.equal(codesFor(r, 'a').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE), -1);
});

test('DOUBLON_PROBABLE — montants différents → pas flaggées', () => {
  const a = tx2({ id: 'a', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const b = tx2({ id: 'b', caisse_id: 'c1', montant: 501, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const r = U.detectAnomaliesBatch([a, b], BATCH_NOW);
  assert.equal(codesFor(r, 'a').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE), -1);
});

test('DOUBLON_PROBABLE — écart date > 1 jour → pas flaggées', () => {
  const a = tx2({ id: 'a', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const b = tx2({ id: 'b', caisse_id: 'c1', montant: 500, date: '2026-05-12', description: 'Achat gasoil tracteur' });
  const r = U.detectAnomaliesBatch([a, b], BATCH_NOW);
  assert.equal(codesFor(r, 'a').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE), -1);
});

test('DOUBLON_PROBABLE — écart date = 1 jour → flaggées (bornes inclusives)', () => {
  const a = tx2({ id: 'a', reference: 'A', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const b = tx2({ id: 'b', reference: 'B', caisse_id: 'c1', montant: 500, date: '2026-05-11', description: 'Achat gasoil tracteur' });
  const r = U.detectAnomaliesBatch([a, b], BATCH_NOW);
  assert.ok(codesFor(r, 'a').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE) >= 0);
  assert.ok(codesFor(r, 'b').indexOf(U.ANOMALY_CODES.DOUBLON_PROBABLE) >= 0);
});

test('DOUBLON_PROBABLE — cluster de 3 doublons → chaque tx a 2 messages doublons', () => {
  const a = tx2({ id: 'a', reference: 'A', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const b = tx2({ id: 'b', reference: 'B', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const c = tx2({ id: 'c', reference: 'C', caisse_id: 'c1', montant: 500, date: '2026-05-10', description: 'Achat gasoil tracteur' });
  const r = U.detectAnomaliesBatch([a, b, c], BATCH_NOW);
  const doublonsA = (r.get('a') || []).filter(x => x.code === U.ANOMALY_CODES.DOUBLON_PROBABLE);
  const doublonsB = (r.get('b') || []).filter(x => x.code === U.ANOMALY_CODES.DOUBLON_PROBABLE);
  const doublonsC = (r.get('c') || []).filter(x => x.code === U.ANOMALY_CODES.DOUBLON_PROBABLE);
  assert.equal(doublonsA.length, 2, 'a should reference b and c');
  assert.equal(doublonsB.length, 2, 'b should reference a and c');
  assert.equal(doublonsC.length, 2, 'c should reference a and b');
});


// ---- Rule MONTANT_ATYPIQUE ----

test('MONTANT_ATYPIQUE — moyenne 1000, tx 5000 → flaggée (> 3× moyenne)', () => {
  const ana = 'Exploitation Ferme - Gasoil';
  // Echantillon "normal" : 3 tx à 1000, 1500, 500 → moyenne ≈ 1000
  const samples = [
    tx2({ id: 's1', code_analytique: ana, montant: 1000, date: '2026-05-01' }),
    tx2({ id: 's2', code_analytique: ana, montant: 1500, date: '2026-05-02' }),
    tx2({ id: 's3', code_analytique: ana, montant: 500,  date: '2026-05-03' }),
  ];
  const outlier = tx2({ id: 'big', code_analytique: ana, montant: 5000, date: '2026-05-10' });
  const r = U.detectAnomaliesBatch([...samples, outlier], BATCH_NOW);
  assert.ok(codesFor(r, 'big').indexOf(U.ANOMALY_CODES.MONTANT_ATYPIQUE) >= 0);
  // Les échantillons "normaux" ne sont pas flaggés
  assert.equal(codesFor(r, 's1').indexOf(U.ANOMALY_CODES.MONTANT_ATYPIQUE), -1);
});

test('MONTANT_ATYPIQUE — tx à 2500 (< 3× moyenne 1000) → pas flaggée', () => {
  const ana = 'Exploitation';
  const list = [
    tx2({ id: 's1', code_analytique: ana, montant: 1000, date: '2026-05-01' }),
    tx2({ id: 's2', code_analytique: ana, montant: 1500, date: '2026-05-02' }),
    tx2({ id: 's3', code_analytique: ana, montant: 500,  date: '2026-05-03' }),
    tx2({ id: 'mid', code_analytique: ana, montant: 2500, date: '2026-05-10' }),
  ];
  const r = U.detectAnomaliesBatch(list, BATCH_NOW);
  assert.equal(codesFor(r, 'mid').indexOf(U.ANOMALY_CODES.MONTANT_ATYPIQUE), -1);
});

test('MONTANT_ATYPIQUE — échantillon < 3 tx → skip (pas assez de données)', () => {
  const ana = 'Rare';
  const list = [
    tx2({ id: 's1', code_analytique: ana, montant: 100, date: '2026-05-01' }),
    tx2({ id: 'big', code_analytique: ana, montant: 99999, date: '2026-05-10' }),
  ];
  const r = U.detectAnomaliesBatch(list, BATCH_NOW);
  // Pas de MONTANT_ATYPIQUE (échantillon trop petit). MONTANT_INHABITUEL S1
  // peut tirer mais c'est une autre règle.
  assert.equal(codesFor(r, 'big').indexOf(U.ANOMALY_CODES.MONTANT_ATYPIQUE), -1);
});

test('MONTANT_ATYPIQUE — analytiques différents → moyennes indépendantes', () => {
  const list = [
    tx2({ id: 'a1', code_analytique: 'A', montant: 100, date: '2026-05-01' }),
    tx2({ id: 'a2', code_analytique: 'A', montant: 100, date: '2026-05-02' }),
    tx2({ id: 'a3', code_analytique: 'A', montant: 100, date: '2026-05-03' }),
    // Pour analytique B la moyenne sera élevée → tx B n'est pas atypique
    tx2({ id: 'b1', code_analytique: 'B', montant: 10000, date: '2026-05-01' }),
    tx2({ id: 'b2', code_analytique: 'B', montant: 12000, date: '2026-05-02' }),
    tx2({ id: 'b3', code_analytique: 'B', montant: 11000, date: '2026-05-03' }),
    tx2({ id: 'b4', code_analytique: 'B', montant: 13000, date: '2026-05-10' }), // ~moyenne
  ];
  const r = U.detectAnomaliesBatch(list, BATCH_NOW);
  // b4 (13000) n'est PAS atypique (moy B ≈ 11000, < 3×)
  assert.equal(codesFor(r, 'b4').indexOf(U.ANOMALY_CODES.MONTANT_ATYPIQUE), -1);
});

test('MONTANT_ATYPIQUE — fenêtre 90j basée sur maxDate du dataset', () => {
  const ana = 'X';
  // maxDate = 2026-05-10 → fenêtre = 2026-02-09 → 2026-05-10
  const list = [
    // OUT of window (avant maxDate-90j)
    tx2({ id: 'old1', code_analytique: ana, montant: 99999, date: '2025-01-01' }),
    tx2({ id: 'old2', code_analytique: ana, montant: 99999, date: '2025-01-02' }),
    // IN window
    tx2({ id: 's1', code_analytique: ana, montant: 100, date: '2026-05-01' }),
    tx2({ id: 's2', code_analytique: ana, montant: 100, date: '2026-05-02' }),
    tx2({ id: 's3', code_analytique: ana, montant: 100, date: '2026-05-03' }),
    tx2({ id: 'big', code_analytique: ana, montant: 500, date: '2026-05-10' }),
  ];
  const r = U.detectAnomaliesBatch(list, BATCH_NOW);
  // big (500) >> 3× moyenne in-window (100) → flaggée
  // si la fenêtre n'était pas appliquée, la moyenne inclurait 99999 et big ne serait pas flaggée
  assert.ok(codesFor(r, 'big').indexOf(U.ANOMALY_CODES.MONTANT_ATYPIQUE) >= 0);
});


// ---- Rule DESCRIPTION_GENERIQUE ----

test('DESCRIPTION_GENERIQUE — mots seuls flaggés', () => {
  const cases = ['avance', 'achat', 'paiement', 'divers', 'frais', 'AVANCE', 'Achat'];
  for (const desc of cases) {
    const t = tx2({ id: `g-${desc}`, description: desc });
    const r = U.detectAnomaliesBatch([t], BATCH_NOW);
    assert.ok(codesFor(r, `g-${desc}`).indexOf(U.ANOMALY_CODES.DESCRIPTION_GENERIQUE) >= 0, `"${desc}" should be flagged`);
  }
});

test('DESCRIPTION_GENERIQUE — mot suivi d\'autre chose → pas flaggé', () => {
  const cases = ['Achat de gasoil', 'Paiement Mr Ayoub', 'Avance Ayoub', 'Frais bancaires'];
  for (const desc of cases) {
    const t = tx2({ id: `ng-${desc}`, description: desc });
    const r = U.detectAnomaliesBatch([t], BATCH_NOW);
    assert.equal(codesFor(r, `ng-${desc}`).indexOf(U.ANOMALY_CODES.DESCRIPTION_GENERIQUE), -1, `"${desc}" should NOT be flagged`);
  }
});

test('DESCRIPTION_GENERIQUE — espaces seuls autour du mot → flaggé (regex tolère \\s*)', () => {
  const t = tx2({ id: 'g-spaces', description: '  Avance  ' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  assert.ok(codesFor(r, 'g-spaces').indexOf(U.ANOMALY_CODES.DESCRIPTION_GENERIQUE) >= 0);
});


// ---- Rule BENEFICIAIRE_IMPRECIS ----

test('BENEFICIAIRE_IMPRECIS — "AVANCE" + nom > 3 lettres capitalisé → pas flaggé', () => {
  const t = tx2({ id: 'ok1', description: 'AVANCE AYOUB' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  assert.equal(codesFor(r, 'ok1').indexOf(U.ANOMALY_CODES.BENEFICIAIRE_IMPRECIS), -1);
});

test('BENEFICIAIRE_IMPRECIS — "PAIEMENT" + nom > 3 lettres capitalisé → pas flaggé', () => {
  const t = tx2({ id: 'ok2', description: 'PAIEMENT Mohamed Hamdouche' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  assert.equal(codesFor(r, 'ok2').indexOf(U.ANOMALY_CODES.BENEFICIAIRE_IMPRECIS), -1);
});

test('BENEFICIAIRE_IMPRECIS — "AVANCE" + tout minuscule après → flaggé', () => {
  const t = tx2({ id: 'ko1', description: 'AVANCE pour quelque chose' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  assert.ok(codesFor(r, 'ko1').indexOf(U.ANOMALY_CODES.BENEFICIAIRE_IMPRECIS) >= 0);
});

test('BENEFICIAIRE_IMPRECIS — "AVANCE" + capitalisé mais ≤ 3 lettres → flaggé', () => {
  const t = tx2({ id: 'ko2', description: 'AVANCE Sur Truc' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  // "Sur" = 3 chars (pas > 3), "Truc" → 4 chars capitalisé : pas flaggé
  // Modifions pour cibler : "AVANCE Sur OK"
  const t2 = tx2({ id: 'ko3', description: 'AVANCE Sur OK' });
  const r2 = U.detectAnomaliesBatch([t2], BATCH_NOW);
  assert.ok(codesFor(r2, 'ko3').indexOf(U.ANOMALY_CODES.BENEFICIAIRE_IMPRECIS) >= 0);
});

test('BENEFICIAIRE_IMPRECIS — description ne commence pas par avance/paiement → pas flaggé', () => {
  const t = tx2({ id: 'np', description: 'Achat de gasoil' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  assert.equal(codesFor(r, 'np').indexOf(U.ANOMALY_CODES.BENEFICIAIRE_IMPRECIS), -1);
});


// ---- Rule INCOHERENCE_CAISSE_ANALYTIQUE ----

test('INCOHERENCE_CAISSE_ANALYTIQUE — caisse Bahia, analytique sans Bahia → flaggé', () => {
  const t = tx2({ id: 'i1', caisse_id: 'caisse_depenses_bahia', code_analytique: 'Exploitation Ferme - Gasoil' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  assert.ok(codesFor(r, 'i1').indexOf(U.ANOMALY_CODES.INCOHERENCE_CAISSE_ANALYTIQUE) >= 0);
});

test('INCOHERENCE_CAISSE_ANALYTIQUE — caisse Bahia, analytique BAHIA → pas flaggé', () => {
  const t = tx2({ id: 'i2', caisse_id: 'caisse_depenses_bahia', code_analytique: 'BAHIA - B6' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  assert.equal(codesFor(r, 'i2').indexOf(U.ANOMALY_CODES.INCOHERENCE_CAISSE_ANALYTIQUE), -1);
});

test('INCOHERENCE_CAISSE_ANALYTIQUE — caisse non-Bahia → pas flaggé (règle ne s\'applique pas)', () => {
  const t = tx2({ id: 'i3', caisse_id: 'caisse_depenses', code_analytique: 'Exploitation Ferme - Gasoil' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  assert.equal(codesFor(r, 'i3').indexOf(U.ANOMALY_CODES.INCOHERENCE_CAISSE_ANALYTIQUE), -1);
});

test('INCOHERENCE_CAISSE_ANALYTIQUE — transferts skipés (transfer_in / transfer_out)', () => {
  const tin  = tx2({ id: 'tin',  caisse_id: 'caisse_depenses_bahia', type: 'transfer_in',  code_analytique: 'X' });
  const tout = tx2({ id: 'tout', caisse_id: 'caisse_depenses_bahia', type: 'transfer_out', code_analytique: 'X' });
  const r = U.detectAnomaliesBatch([tin, tout], BATCH_NOW);
  assert.equal(codesFor(r, 'tin').indexOf(U.ANOMALY_CODES.INCOHERENCE_CAISSE_ANALYTIQUE), -1);
  assert.equal(codesFor(r, 'tout').indexOf(U.ANOMALY_CODES.INCOHERENCE_CAISSE_ANALYTIQUE), -1);
});

test('INCOHERENCE_CAISSE_ANALYTIQUE — analytique vide → skip (couvert par ANALYTIQUE_VIDE S1)', () => {
  const t = tx2({ id: 'iv', caisse_id: 'caisse_depenses_bahia', code_analytique: '' });
  const r = U.detectAnomaliesBatch([t], BATCH_NOW);
  // ANALYTIQUE_VIDE (S1) attendu, INCOHERENCE_CAISSE_ANALYTIQUE non
  assert.ok(codesFor(r, 'iv').indexOf(U.ANOMALY_CODES.ANALYTIQUE_VIDE) >= 0);
  assert.equal(codesFor(r, 'iv').indexOf(U.ANOMALY_CODES.INCOHERENCE_CAISSE_ANALYTIQUE), -1);
});


// ---- Perf ----

test('detectAnomaliesBatch — perf < 500ms sur 5000 tx', () => {
  // Génère un dataset réaliste : 5000 tx réparties sur 6 caisses, 15 analytiques,
  // dates étalées sur 180 jours, montants log-normaux.
  const caisses = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  const analytiques = Array.from({ length: 15 }, (_, i) => `Ana-${i}`);
  const descs = ['Achat gasoil tracteur', 'Paiement Mohamed', 'Reparation voiture', 'Avance Ayoub', 'Fournitures bureau'];
  const list = [];
  for (let i = 0; i < 5000; i++) {
    const day = Math.floor(Math.random() * 180);
    const d = new Date('2026-05-10'); d.setDate(d.getDate() - day);
    list.push({
      id: `perf-${i}`,
      reference: `R-${i}`,
      caisse_id: caisses[i % caisses.length],
      type: i % 7 === 0 ? 'alimentation' : 'depense',
      montant: Math.round(100 + Math.random() * 5000),
      date: d.toISOString().slice(0, 10),
      description: descs[i % descs.length] + ' ' + i,
      code_analytique: analytiques[i % analytiques.length],
      status: 'valide',
    });
  }
  const t0 = Date.now();
  const r = U.detectAnomaliesBatch(list, BATCH_NOW);
  const elapsed = Date.now() - t0;
  console.log(`    [perf] detectAnomaliesBatch on 5000 tx: ${elapsed}ms (Map size=${r.size})`);
  assert.ok(elapsed < 500, `detectAnomaliesBatch took ${elapsed}ms (>500ms budget)`);
});

// --- Axes analytiques (ferme / campagne / culture / parcelle) ---------------

test('searchTransactions — recherche par ferme, culture et parcelle', () => {
  const txs = [
    { reference: 'R1', ferme: 'F5', campagne: '2026-2027', culture: 'Myrtille', parcelle: 'F5 CORINA myrtille S8-3' },
    { reference: 'R2', ferme: 'F1', campagne: '2026-2027', culture: 'Framboise', parcelle: 'GENERAL' },
    { reference: 'R3' },
  ];
  const refs = (q) => U.searchTransactions(txs, q).map((t) => t.reference);
  assert.deepStrictEqual(refs('F5'), ['R1']);
  assert.deepStrictEqual(refs('myrtille'), ['R1']);
  assert.deepStrictEqual(refs('GENERAL'), ['R2']);
  assert.deepStrictEqual(refs('2026-2027'), ['R1', 'R2']);
  assert.deepStrictEqual(refs('corina S8-3'), ['R1']);
});

test('searchTransactions — un bon sans axes analytiques ne plante pas', () => {
  const txs = [{ reference: 'R3', description: 'Gasoil' }];
  assert.deepStrictEqual(U.searchTransactions(txs, 'gasoil').map((t) => t.reference), ['R3']);
  assert.deepStrictEqual(U.searchTransactions(txs, 'F5'), []);
});

// --- filterByAxes / distinctAxeValues ---------------------------------------

const AXES_TXS = [
  { reference: 'R1', ferme: 'F5', culture: 'Myrtille',  parcelle: 'F5 CORINA myrtille S8-3', code_analytique: 'IRRIG' },
  { reference: 'R2', ferme: 'F5', culture: 'Myrtille',  parcelle: 'BREEZE MYRTILLE S8-2',    code_analytique: 'IRRIG' },
  { reference: 'R3', ferme: 'F1', culture: 'Framboise', parcelle: 'GENERAL',                 code_analytique: 'CARB'  },
  { reference: 'R4', ferme: '',   culture: '',          parcelle: '',                        code_analytique: ''      },
  { reference: 'R5' },
];
const axesRefs = (f) => U.filterByAxes(AXES_TXS, f).map((t) => t.reference);

test('filterByAxes — aucun filtre actif → tout passe', () => {
  assert.deepStrictEqual(axesRefs({}).length, 5);
  assert.deepStrictEqual(axesRefs(null).length, 5);
  assert.deepStrictEqual(axesRefs({ ferme: '', culture: null, parcelle: undefined }).length, 5);
});

test('filterByAxes — un critère', () => {
  assert.deepStrictEqual(axesRefs({ ferme: 'F5' }), ['R1', 'R2']);
  assert.deepStrictEqual(axesRefs({ culture: 'Framboise' }), ['R3']);
  assert.deepStrictEqual(axesRefs({ parcelle: 'GENERAL' }), ['R3']);
  assert.deepStrictEqual(axesRefs({ code_analytique: 'IRRIG' }), ['R1', 'R2']);
});

test('filterByAxes — critères cumulés (ET logique)', () => {
  assert.deepStrictEqual(axesRefs({ ferme: 'F5', parcelle: 'BREEZE MYRTILLE S8-2' }), ['R2']);
  assert.deepStrictEqual(axesRefs({ ferme: 'F5', culture: 'Framboise' }), []);
});

test('filterByAxes — __VIDE__ isole les bons non affectés', () => {
  assert.deepStrictEqual(axesRefs({ ferme: U.AXE_NON_RENSEIGNE }), ['R4', 'R5']);
  assert.deepStrictEqual(axesRefs({ parcelle: U.AXE_NON_RENSEIGNE }), ['R4', 'R5']);
  assert.deepStrictEqual(axesRefs({ ferme: U.AXE_NON_RENSEIGNE, culture: 'Myrtille' }), []);
});

test('filterByAxes — comparaison stricte, tolérante aux espaces', () => {
  assert.deepStrictEqual(axesRefs({ ferme: ' F5 ' }), ['R1', 'R2']);
  assert.deepStrictEqual(axesRefs({ ferme: 'f5' }), []);        // pas de casse implicite
  assert.deepStrictEqual(axesRefs({ ferme: 'F' }), []);         // pas de correspondance partielle
});

test('filterByAxes — entrées invalides ne plantent pas', () => {
  assert.deepStrictEqual(U.filterByAxes(null, { ferme: 'F5' }), []);
  assert.deepStrictEqual(U.filterByAxes([null, undefined], { ferme: 'F5' }), []);
});

test('filterByAxes — retourne toujours un nouveau tableau', () => {
  const out = U.filterByAxes(AXES_TXS, {});
  assert.notStrictEqual(out, AXES_TXS);
  assert.strictEqual(out.length, AXES_TXS.length);
});

test('distinctAxeValues — valeurs présentes, triées, sans les vides', () => {
  assert.deepStrictEqual(U.distinctAxeValues(AXES_TXS, 'ferme'), ['F1', 'F5']);
  assert.deepStrictEqual(U.distinctAxeValues(AXES_TXS, 'culture'), ['Framboise', 'Myrtille']);
  assert.deepStrictEqual(U.distinctAxeValues(AXES_TXS, 'parcelle'),
    ['BREEZE MYRTILLE S8-2', 'F5 CORINA myrtille S8-3', 'GENERAL']);
  assert.deepStrictEqual(U.distinctAxeValues(AXES_TXS, 'code_analytique'), ['CARB', 'IRRIG']);
});

test('distinctAxeValues — entrées invalides → tableau vide', () => {
  assert.deepStrictEqual(U.distinctAxeValues(null, 'ferme'), []);
  assert.deepStrictEqual(U.distinctAxeValues(AXES_TXS, ''), []);
  assert.deepStrictEqual(U.distinctAxeValues([{ ferme: '   ' }], 'ferme'), []);
});
