'use strict';

const test = require('node:test');
const assert = require('node:assert');
const QuinzaineUtils = require('../../public/lib/quinzaineUtils.js');

const { getEqPrefix, computeTransportQuinzaine } = QuinzaineUtils;

// Prefixes in play for the tests (a subset of the real transportConfig).
const KNOWN = ['MM', 'HT', 'CC', 'NV'];

// ---------------------------------------------------------------------------
// getEqPrefix — single deterministic behaviour
// ---------------------------------------------------------------------------
test('getEqPrefix: known 2-char prefix → that prefix', () => {
  assert.strictEqual(getEqPrefix('MM1234', KNOWN), 'MM');
  assert.strictEqual(getEqPrefix('HT10921', KNOWN), 'HT');
  assert.strictEqual(getEqPrefix('CC77', KNOWN), 'CC');
});

test('getEqPrefix: case-insensitive + trims', () => {
  assert.strictEqual(getEqPrefix('  ht10921  ', KNOWN), 'HT');
});

test('getEqPrefix: HAFI / HA → HA (El Hafi rule)', () => {
  // 'HA' is NOT in KNOWN here, so it must resolve via the explicit HAFI/HA rule.
  assert.strictEqual(getEqPrefix('HAFI0007', KNOWN), 'HA');
  assert.strictEqual(getEqPrefix('HA123', KNOWN), 'HA');
});

test('getEqPrefix: DD → NV (the 240 DH edge case)', () => {
  // DD-prefixed matricules are the NV equipe and MUST be counted, identically on both
  // screens. This is the crux of the 240 DH divergence bug.
  assert.strictEqual(getEqPrefix('DD0001', KNOWN), 'NV');
  assert.strictEqual(getEqPrefix('DD9999', KNOWN), 'NV');
});

test('getEqPrefix: known prefix wins over HAFI/DD ordering', () => {
  // 'NV' is a known prefix → returned directly (not a DD case, but confirms step 2 wins).
  assert.strictEqual(getEqPrefix('NV0001', KNOWN), 'NV');
});

test('getEqPrefix: unknown matricule → null (ignored, deterministic)', () => {
  assert.strictEqual(getEqPrefix('ZZ0001', KNOWN), null);
  assert.strictEqual(getEqPrefix('QQ42', KNOWN), null);
});

test('getEqPrefix: empty/falsy matricule → null', () => {
  assert.strictEqual(getEqPrefix('', KNOWN), null);
  assert.strictEqual(getEqPrefix(null, KNOWN), null);
  assert.strictEqual(getEqPrefix(undefined, KNOWN), null);
  assert.strictEqual(getEqPrefix('   ', KNOWN), null);
});

test('getEqPrefix: no knownPrefixes → falls through to HAFI/DD rules only', () => {
  assert.strictEqual(getEqPrefix('MM1234', []), null); // MM not known, not HAFI/DD
  assert.strictEqual(getEqPrefix('DD1', []), 'NV');
  assert.strictEqual(getEqPrefix('HA1', undefined), 'HA');
});

// ---------------------------------------------------------------------------
// computeTransportQuinzaine — core rule (no hardcoded totals)
// ---------------------------------------------------------------------------
const EQUIPES = [
  { prefix: 'MM' },
  { prefix: 'HT' },
  { prefix: 'NV' },
];
const COUT = { MM: 25, HT: 30, NV: 30 };

test('computeTransportQuinzaine: dedup workers per (jour, equipe)', () => {
  const rows = [
    // MM, jour J1: two DISTINCT workers → counts 2
    { matricule: 'MM01', jour: 'J1', periode: 'Q1' },
    { matricule: 'MM02', jour: 'J1', periode: 'Q1' },
    // MM01 appears AGAIN on J1 (another operation line) → still counts once
    { matricule: 'MM01', jour: 'J1', periode: 'Q1' },
    // MM01 on J2 → distinct day → +1
    { matricule: 'MM01', jour: 'J2', periode: 'Q1' },
  ];
  const r = computeTransportQuinzaine(rows, { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT });
  // J1: 2 workers × 25 = 50 ; J2: 1 worker × 25 = 25 → 75
  assert.strictEqual(r.total, 75);
  assert.strictEqual(r.totalWorkers, 3);
  assert.deepStrictEqual(r.dates, ['J1', 'J2']);
});

test('computeTransportQuinzaine: filters by periode', () => {
  const rows = [
    { matricule: 'HT01', jour: 'J1', periode: 'Q1' },
    { matricule: 'HT02', jour: 'J1', periode: 'Q2' }, // other quinzaine → excluded
  ];
  const r = computeTransportQuinzaine(rows, { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT });
  assert.strictEqual(r.total, 30); // 1 × 30
  assert.strictEqual(r.totalWorkers, 1);
});

test('computeTransportQuinzaine: equipe with no pointage counts 0', () => {
  const rows = [
    { matricule: 'MM01', jour: 'J1', periode: 'Q1' },
    // no HT, no NV rows at all
  ];
  const r = computeTransportQuinzaine(rows, { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT });
  assert.strictEqual(r.total, 25);
  const ht = r.byEquipe.find(e => e.prefix === 'HT');
  const nv = r.byEquipe.find(e => e.prefix === 'NV');
  assert.strictEqual(ht.total, 0);
  assert.strictEqual(ht.totalWorkers, 0);
  assert.strictEqual(nv.total, 0);
});

test('computeTransportQuinzaine: filters by ferme', () => {
  const rows = [
    { matricule: 'MM01', jour: 'J1', periode: 'Q1', ferme: 'F1' },
    { matricule: 'MM02', jour: 'J1', periode: 'Q1', ferme: 'F5' },
  ];
  const rAll = computeTransportQuinzaine(rows, { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT });
  assert.strictEqual(rAll.total, 50); // both fermes

  const rF1 = computeTransportQuinzaine(rows, { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT, ferme: 'F1' });
  assert.strictEqual(rF1.total, 25); // only F1
  assert.strictEqual(rF1.totalWorkers, 1);
});

test('computeTransportQuinzaine: filters by matchSub predicate', () => {
  const rows = [
    { matricule: 'MM01', jour: 'J1', periode: 'Q1', parcelle: 'A' },
    { matricule: 'MM02', jour: 'J1', periode: 'Q1', parcelle: 'B' },
  ];
  const matchSub = (r) => r.parcelle === 'A';
  const r = computeTransportQuinzaine(rows, { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT, matchSub });
  assert.strictEqual(r.total, 25); // only parcelle A
  assert.strictEqual(r.totalWorkers, 1);
});

test('computeTransportQuinzaine: the 240 DH edge case — DD/NV counted identically', () => {
  // 8 distinct DD-prefixed workers on one day, NV tarif 30 → 8 × 30 = 240.
  // The OLD Primes getEqPrefix returned null for these (NV not in its `known` set as
  // matched by p2 'DD'), dropping the 240 DH. The unified getEqPrefix maps DD → NV, so
  // both screens now count them.
  const rows = [];
  for (let i = 1; i <= 8; i++) {
    rows.push({ matricule: 'DD000' + i, jour: 'J1', periode: 'Q1' });
  }
  const r = computeTransportQuinzaine(rows, { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT });
  assert.strictEqual(r.total, 240);
  const nv = r.byEquipe.find(e => e.prefix === 'NV');
  assert.strictEqual(nv.totalWorkers, 8);
  assert.strictEqual(nv.total, 240);
});

test('computeTransportQuinzaine: unknown matricules never inflate the total', () => {
  const rows = [
    { matricule: 'MM01', jour: 'J1', periode: 'Q1' },
    { matricule: 'ZZ99', jour: 'J1', periode: 'Q1' }, // unmappable → ignored
    { matricule: '', jour: 'J1', periode: 'Q1' },     // empty → ignored
  ];
  const r = computeTransportQuinzaine(rows, { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT });
  assert.strictEqual(r.total, 25); // only MM01
  assert.strictEqual(r.totalWorkers, 1);
});

test('computeTransportQuinzaine: convergence — same rows/scope → same total both screens', () => {
  // Simulates the two screens: same rows, same periode, same scope → identical result.
  const rows = [
    { matricule: 'MM01', jour: 'J1', periode: 'Q1' },
    { matricule: 'HT01', jour: 'J1', periode: 'Q1' },
    { matricule: 'DD01', jour: 'J1', periode: 'Q1' }, // NV via DD rule
  ];
  const opts = { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT };
  const quinz = computeTransportQuinzaine(rows, opts);
  const primes = computeTransportQuinzaine(rows, opts);
  assert.strictEqual(quinz.total, primes.total);
  assert.strictEqual(quinz.total, 25 + 30 + 30); // MM + HT + NV
});

test('computeTransportQuinzaine: empty rows → 0, no throw', () => {
  const r = computeTransportQuinzaine([], { periode: 'Q1', transportEquipes: EQUIPES, coutMap: COUT });
  assert.strictEqual(r.total, 0);
  assert.strictEqual(r.totalWorkers, 0);
  assert.deepStrictEqual(r.dates, []);
});
