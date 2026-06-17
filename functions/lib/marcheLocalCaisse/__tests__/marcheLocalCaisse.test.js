'use strict';
// @ts-check

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  slugifyClient,
  deriveRecettes,
  aggregateByClient,
  grandTotal,
} = require('../index.js');

const ML = 'Marché Local';

// ---------------------------------------------------------------------------
// A. Tests SYNTHÉTIQUES
// ---------------------------------------------------------------------------

test('1 BA, 2 clients -> 2 recettes (clés distinctes)', () => {
  const lines = [
    { bonApport: 'BA1', client: 'Client A', blocFerme: 'F1', poidsLot: 10, totalDH: 100, typeVente: ML },
    { bonApport: 'BA1', client: 'Client B', blocFerme: 'F1', poidsLot: 20, totalDH: 200, typeVente: ML },
  ];
  const recettes = deriveRecettes(lines);
  assert.equal(recettes.length, 2);
  const keys = new Set(recettes.map((r) => r.idempotency_key));
  assert.equal(keys.size, 2);
});

test('1 BA, 2 fermes (F1+F5), même client -> 1 recette fusionnée', () => {
  const lines = [
    { bonApport: 'BA2', client: 'Client A', blocFerme: 'F1', poidsLot: 10, totalDH: 100, typeVente: ML },
    { bonApport: 'BA2', client: 'Client A', blocFerme: 'F5', poidsLot: 30, totalDH: 250, typeVente: ML },
  ];
  const recettes = deriveRecettes(lines);
  assert.equal(recettes.length, 1);
  const r = recettes[0];
  assert.deepEqual(r.fermes, ['F1', 'F5']);
  assert.equal(r.montant, 350);
  assert.equal(r.kg, 40);
  assert.equal(r.nb_lignes, 2);
});

test('client présent uniquement comme 2e ligne d un BA partagé -> capté', () => {
  const lines = [
    { bonApport: 'BA3', client: 'Client A', blocFerme: 'F1', poidsLot: 10, totalDH: 100, typeVente: ML },
    { bonApport: 'BA3', client: 'Client B', blocFerme: 'F1', poidsLot: 5, totalDH: 60, typeVente: ML },
  ];
  const recettes = deriveRecettes(lines);
  const clientB = recettes.find((r) => r.client_id === slugifyClient('Client B'));
  assert.ok(clientB, 'Client B doit avoir sa propre recette');
  assert.equal(clientB.montant, 60);
  assert.equal(clientB.source_ba, 'BA3');
});

test('lignes typeVente !== Marché Local -> ignorées', () => {
  const lines = [
    { bonApport: 'BA4', client: 'Client A', blocFerme: 'F1', poidsLot: 10, totalDH: 100, typeVente: ML },
    { bonApport: 'BA4', client: 'Client A', blocFerme: 'F1', poidsLot: 99, totalDH: 999, typeVente: 'Export' },
  ];
  const recettes = deriveRecettes(lines);
  assert.equal(recettes.length, 1);
  assert.equal(recettes[0].montant, 100);
  assert.equal(recettes[0].nb_lignes, 1);
});

test('slugifyClient : 5 noms réels -> 5 slugs distincts + idempotent', () => {
  const names = [
    'MUSTAPHA CHAFIK A',
    'Mr MONAIM LOCAL',
    'IRAQI MOHAMED',
    'Hamdouch Omar',
    'Fruit congel du nord',
  ];
  const slugs = names.map(slugifyClient);
  assert.equal(new Set(slugs).size, 5);
  // idempotence : slug(slug(x)) === slug(x)
  for (const s of slugs) {
    assert.equal(slugifyClient(s), s);
  }
});

// ---------------------------------------------------------------------------
// B. Tests SNAPSHOT
// ---------------------------------------------------------------------------

const snapshotPath = path.join(__dirname, 'fixtures', 'ml_snapshot.json');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));

test('snapshot : 823 lignes source', () => {
  assert.equal(snapshot.length, 823);
});

test('snapshot : grandTotal === 545298.28', () => {
  const recettes = deriveRecettes(snapshot);
  assert.ok(Math.abs(grandTotal(recettes) - 545298.28) < 0.01);
});

test('snapshot : aggregateByClient -> 5 clients, Hamdouch Omar debit 4410', () => {
  const recettes = deriveRecettes(snapshot);
  const aggs = aggregateByClient(recettes);
  assert.equal(aggs.length, 5);
  const hamdouch = aggs.find((a) => a.client_id === slugifyClient('Hamdouch Omar'));
  assert.ok(hamdouch, 'Hamdouch Omar présent');
  assert.ok(Math.abs(hamdouch.debit - 4410) < 0.01, `debit attendu 4410, obtenu ${hamdouch.debit}`);
});

test('snapshot : 485 recettes au total', () => {
  const recettes = deriveRecettes(snapshot);
  assert.equal(recettes.length, 485);
});

test('snapshot : 69 BA multi-clients', () => {
  /** @type {Map<string, Set<string>>} */
  const byBa = new Map();
  for (const l of snapshot) {
    if (l.typeVente !== ML) continue;
    if (!byBa.has(l.bonApport)) byBa.set(l.bonApport, new Set());
    byBa.get(l.bonApport).add(slugifyClient(l.client));
  }
  let multi = 0;
  for (const set of byBa.values()) if (set.size > 1) multi += 1;
  assert.equal(multi, 69);
});

test('snapshot : 70 BA multi-fermes', () => {
  /** @type {Map<string, Set<string>>} */
  const byBa = new Map();
  for (const l of snapshot) {
    if (l.typeVente !== ML) continue;
    if (!byBa.has(l.bonApport)) byBa.set(l.bonApport, new Set());
    if (l.blocFerme != null && l.blocFerme !== '') byBa.get(l.bonApport).add(l.blocFerme);
  }
  let multi = 0;
  for (const set of byBa.values()) if (set.size > 1) multi += 1;
  assert.equal(multi, 70);
});
