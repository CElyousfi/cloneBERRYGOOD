'use strict';

const test = require('node:test');
const assert = require('node:assert');
const PaieUtils = require('../../public/lib/paieUtils.js');

const {
  PAIE_BAREMES_DEFAULT,
  trouverPalierAnciennete,
  calculerPaieOuvrier,
  resolveSmagForDate,
  computeWorkerPaie,
} = PaieUtils;

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------
// trouverPalierAnciennete — each bracket
// ---------------------------------------------------------------------------
test('trouverPalierAnciennete: below first threshold → no prime', () => {
  const r = trouverPalierAnciennete(0, PAIE_BAREMES_DEFAULT.paliers);
  assert.strictEqual(r.pourcentage, 0);
  assert.strictEqual(r.palier, '—');
});

test('trouverPalierAnciennete: ≥ 2 ans (624j) → 5%', () => {
  const r = trouverPalierAnciennete(624, PAIE_BAREMES_DEFAULT.paliers);
  assert.strictEqual(r.pourcentage, 5);
  assert.strictEqual(r.palier, '≥ 2 ans');
});

test('trouverPalierAnciennete: ≥ 5 ans (1560j) → 10%', () => {
  const r = trouverPalierAnciennete(1560, PAIE_BAREMES_DEFAULT.paliers);
  assert.strictEqual(r.pourcentage, 10);
});

test('trouverPalierAnciennete: ≥ 10 ans (3120j) → 15%', () => {
  const r = trouverPalierAnciennete(3120, PAIE_BAREMES_DEFAULT.paliers);
  assert.strictEqual(r.pourcentage, 15);
});

test('trouverPalierAnciennete: between brackets picks lower bracket', () => {
  const r = trouverPalierAnciennete(1000, PAIE_BAREMES_DEFAULT.paliers);
  assert.strictEqual(r.pourcentage, 5);
});

// ---------------------------------------------------------------------------
// calculerPaieOuvrier — declared / non-declared (unchanged behaviour)
// ---------------------------------------------------------------------------
test('calculerPaieOuvrier: non-declared → net = SMAG net × jours, no charges', () => {
  const r = calculerPaieOuvrier({ declare: false, joursTravailles: 10, anciennete: 5000, baremes: PAIE_BAREMES_DEFAULT });
  assert.ok(close(r.net, 82.61 * 10));
  assert.strictEqual(r.brut, r.net);
  assert.strictEqual(r.chargesPatronales, 0);
  assert.strictEqual(r.cotisationsSalariales, 0);
  assert.strictEqual(r.prime, 0);
  assert.ok(close(r.coutEmployeur, 82.61 * 10));
});

test('calculerPaieOuvrier: declared no seniority', () => {
  const r = calculerPaieOuvrier({ declare: true, joursTravailles: 26, anciennete: 0, baremes: PAIE_BAREMES_DEFAULT });
  const brutBase = 88.58 * 26;
  assert.ok(close(r.brut, brutBase));
  assert.ok(close(r.prime, 0));
  assert.ok(close(r.cotisationsSalariales, brutBase * 0.0674));
  assert.ok(close(r.chargesPatronales, brutBase * 0.26));
  assert.ok(close(r.net, brutBase - brutBase * 0.0674));
  assert.ok(close(r.coutEmployeur, brutBase + brutBase * 0.26));
});

test('calculerPaieOuvrier: declared with 10% seniority prime', () => {
  const r = calculerPaieOuvrier({ declare: true, joursTravailles: 26, anciennete: 1560, baremes: PAIE_BAREMES_DEFAULT });
  const brutBase = 88.58 * 26;
  const prime = brutBase * 0.10;
  assert.ok(close(r.prime, prime));
  assert.ok(close(r.brut, brutBase + prime));
});

// ---------------------------------------------------------------------------
// resolveSmagForDate
// ---------------------------------------------------------------------------
test('resolveSmagForDate: no history → flat fields', () => {
  const r = resolveSmagForDate(PAIE_BAREMES_DEFAULT, '2026-06-01');
  assert.strictEqual(r.smagBrutJournalier, 88.58);
  assert.strictEqual(r.smagNetJournalier, 82.61);
});

test('resolveSmagForDate: no dateISO → flat fields even with history', () => {
  const baremes = { ...PAIE_BAREMES_DEFAULT, smagHistory: [{ dateFrom: '2026-01-01', smagBrutJournalier: 90, smagNetJournalier: 84 }] };
  const r = resolveSmagForDate(baremes, undefined);
  assert.strictEqual(r.smagBrutJournalier, 88.58);
});

test('resolveSmagForDate: history picks most recent <= date', () => {
  const baremes = {
    ...PAIE_BAREMES_DEFAULT,
    smagHistory: [
      { dateFrom: '2025-01-01', smagBrutJournalier: 80, smagNetJournalier: 74 },
      { dateFrom: '2026-01-01', smagBrutJournalier: 90, smagNetJournalier: 84 },
      { dateFrom: '2026-06-01', smagBrutJournalier: 97.44, smagNetJournalier: 90 },
    ],
  };
  assert.strictEqual(resolveSmagForDate(baremes, '2026-06-08').smagBrutJournalier, 97.44);
  assert.strictEqual(resolveSmagForDate(baremes, '2026-03-15').smagBrutJournalier, 90);
  assert.strictEqual(resolveSmagForDate(baremes, '2025-06-01').smagBrutJournalier, 80);
});

test('resolveSmagForDate: date before first entry → flat fallback', () => {
  const baremes = {
    ...PAIE_BAREMES_DEFAULT,
    smagHistory: [{ dateFrom: '2026-01-01', smagBrutJournalier: 90, smagNetJournalier: 84 }],
  };
  const r = resolveSmagForDate(baremes, '2025-06-01');
  assert.strictEqual(r.smagBrutJournalier, 88.58);
});

// ---------------------------------------------------------------------------
// computeWorkerPaie
// ---------------------------------------------------------------------------
test('computeWorkerPaie: declared, prime fonction is taxed (subject to charges)', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 10, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 20, primeTransport: 0,
  });
  const smagBaseTotal = 88.58 * 10;
  const primeFonction = 20 * 10;
  const brut = smagBaseTotal + primeFonction;
  assert.ok(close(r.smagBaseTotal, smagBaseTotal));
  assert.ok(close(r.primeFonction, primeFonction));
  assert.ok(close(r.brut, brut));
  // charges computed on brut INCLUDING prime de fonction
  assert.ok(close(r.cotisationsSalariales, brut * 0.0674));
  assert.ok(close(r.chargesPatronales, brut * 0.26));
  assert.ok(close(r.net, brut - brut * 0.0674));
  assert.ok(close(r.coutEmployeur, brut + brut * 0.26));
});

test('computeWorkerPaie: prime transport is NOT taxed (added to net & cost only)', () => {
  const withT = computeWorkerPaie({
    declare: true, joursTravailles: 10, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 0, primeTransport: 30,
  });
  const noT = computeWorkerPaie({
    declare: true, joursTravailles: 10, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 0, primeTransport: 0,
  });
  // brut & charges unchanged by transport
  assert.ok(close(withT.brut, noT.brut));
  assert.ok(close(withT.chargesPatronales, noT.chargesPatronales));
  assert.ok(close(withT.cotisationsSalariales, noT.cotisationsSalariales));
  // net & cost increased by exactly the transport amount
  assert.ok(close(withT.net, noT.net + 30));
  assert.ok(close(withT.coutEmployeur, noT.coutEmployeur + 30));
  assert.strictEqual(withT.primeTransport, 30);
});

test('computeWorkerPaie: non-declared uses SMAG net, no charges, still pays primes', () => {
  const r = computeWorkerPaie({
    declare: false, joursTravailles: 10, anciennete: 5000,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 5, primeTransport: 30,
  });
  const smagBaseTotal = 82.61 * 10;
  const primeFonction = 5 * 10;
  assert.strictEqual(r.statutDeclare, false);
  assert.ok(close(r.smagBaseTotal, smagBaseTotal));
  assert.strictEqual(r.chargesPatronales, 0);
  assert.strictEqual(r.cotisationsSalariales, 0);
  assert.strictEqual(r.primeAnciennete, 0);
  assert.ok(close(r.brut, smagBaseTotal + primeFonction));
  assert.ok(close(r.net, smagBaseTotal + primeFonction + 30));
  assert.ok(close(r.coutEmployeur, r.net));
});

test('computeWorkerPaie: dated SMAG applied via smagHistory', () => {
  const baremes = {
    ...PAIE_BAREMES_DEFAULT,
    smagHistory: [{ dateFrom: '2026-06-01', smagBrutJournalier: 97.44, smagNetJournalier: 90 }],
  };
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 1, anciennete: 0,
    baremes, dateISO: '2026-06-08', primeFonctionJour: 0, primeTransport: 0,
  });
  assert.ok(close(r.smagBaseJour, 97.44));
  assert.ok(close(r.brut, 97.44));
});

test('computeWorkerPaie: declared with seniority + prime fonction + transport combined', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 26, anciennete: 1560,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 10, primeTransport: 30,
  });
  const smagBaseTotal = 88.58 * 26;
  const primeAnc = smagBaseTotal * 0.10;
  const primeFonction = 10 * 26;
  const brut = smagBaseTotal + primeAnc + primeFonction;
  assert.ok(close(r.primeAnciennete, primeAnc));
  assert.ok(close(r.brut, brut));
  assert.strictEqual(r.anciennetePourcent, 10);
  assert.ok(close(r.coutEmployeur, brut + brut * 0.26 + 30));
});

test('computeWorkerPaie: empty/defensive args → no throw, zeros', () => {
  const r = computeWorkerPaie({});
  assert.strictEqual(r.brut, 0);
  assert.strictEqual(r.net, 0);
  assert.strictEqual(r.coutEmployeur, 0);
});

// ---------------------------------------------------------------------------
// computeWorkerPaie — heures supplémentaires (HS) + coût total employeur
// ---------------------------------------------------------------------------
// SMAG brut journalier par défaut = 88.58 ; heuresNormalesParJour = 8.
// → tauxHoraire (déclaré) = 88.58 / 8 = 11.0725 DH/h.
const TAUX_H_DECLARE = 88.58 / 8;

test('computeWorkerPaie: montant HS 25% seul (×1.25)', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 0, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01', hs25: 4,
  });
  assert.ok(close(r.heuresSup.tauxHoraire, TAUX_H_DECLARE));
  assert.ok(close(r.heuresSup.montant, 4 * TAUX_H_DECLARE * 1.25));
  assert.ok(close(r.brut, 4 * TAUX_H_DECLARE * 1.25));
});

test('computeWorkerPaie: montant HS 50% seul (×1.5)', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 0, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01', hs50: 3,
  });
  assert.ok(close(r.heuresSup.montant, 3 * TAUX_H_DECLARE * 1.5));
});

test('computeWorkerPaie: montant HS 100% seul (×2)', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 0, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01', hs100: 2,
  });
  assert.ok(close(r.heuresSup.montant, 2 * TAUX_H_DECLARE * 2));
});

test('computeWorkerPaie: montant HS combiné (25+50+100)', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 0, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01', hs25: 2, hs50: 1, hs100: 1,
  });
  const expected = 2 * TAUX_H_DECLARE * 1.25 + 1 * TAUX_H_DECLARE * 1.5 + 1 * TAUX_H_DECLARE * 2;
  assert.ok(close(r.heuresSup.montant, expected));
  assert.strictEqual(r.heuresSup.h25, 2);
  assert.strictEqual(r.heuresSup.h50, 1);
  assert.strictEqual(r.heuresSup.h100, 1);
});

test('computeWorkerPaie: HS incluses dans le brut → charges sur brut+HS', () => {
  const withHS = computeWorkerPaie({
    declare: true, joursTravailles: 10, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01', hs25: 4,
  });
  const noHS = computeWorkerPaie({
    declare: true, joursTravailles: 10, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
  });
  const montantHS = 4 * TAUX_H_DECLARE * 1.25;
  assert.ok(close(withHS.brut, noHS.brut + montantHS));
  // charges patronales ET salariales calculées sur le brut majoré des HS
  assert.ok(close(withHS.chargesPatronales, withHS.brut * 0.26));
  assert.ok(close(withHS.cotisationsSalariales, withHS.brut * 0.0674));
  assert.ok(withHS.chargesPatronales > noHS.chargesPatronales);
});

test('computeWorkerPaie: transport hors brut (charges inchangées) + récolte hors brut', () => {
  const base = computeWorkerPaie({
    declare: true, joursTravailles: 10, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
  });
  const withExtras = computeWorkerPaie({
    declare: true, joursTravailles: 10, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeTransport: 30, primeRecolte: 50,
  });
  // brut & charges strictement inchangés par transport + récolte
  assert.ok(close(withExtras.brut, base.brut));
  assert.ok(close(withExtras.chargesPatronales, base.chargesPatronales));
  assert.ok(close(withExtras.cotisationsSalariales, base.cotisationsSalariales));
  assert.strictEqual(withExtras.primeRecolte, 50);
  // net & coût employeur augmentés de transport + récolte
  assert.ok(close(withExtras.net, base.net + 30 + 50));
});

test('computeWorkerPaie: coutTotalEmployeur = brut + charges + transport + récolte', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 26, anciennete: 1560,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 10, primeTransport: 30, hs25: 4, primeRecolte: 50,
  });
  const expected = r.brut + r.chargesPatronales + 30 + 50;
  assert.ok(close(r.coutTotalEmployeur, expected));
  assert.ok(close(r.coutEmployeur, r.coutTotalEmployeur));
});

test('computeWorkerPaie: non-déclaré → HS au taux SMAG net, 0 charge', () => {
  const r = computeWorkerPaie({
    declare: false, joursTravailles: 0, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01', hs100: 2,
  });
  const tauxNet = 82.61 / 8;
  assert.ok(close(r.heuresSup.tauxHoraire, tauxNet));
  assert.ok(close(r.heuresSup.montant, 2 * tauxNet * 2));
  assert.ok(close(r.brut, 2 * tauxNet * 2));
  assert.strictEqual(r.chargesPatronales, 0);
  assert.strictEqual(r.cotisationsSalariales, 0);
});

test('computeWorkerPaie: heuresNormalesParJour configurable', () => {
  const baremes = { ...PAIE_BAREMES_DEFAULT, heuresNormalesParJour: 10 };
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 0, anciennete: 0,
    baremes, dateISO: '2026-06-01', hs25: 4,
  });
  const taux10 = 88.58 / 10;
  assert.ok(close(r.heuresSup.tauxHoraire, taux10));
  assert.ok(close(r.heuresSup.montant, 4 * taux10 * 1.25));
});

test('computeWorkerPaie: rétrocompat — hs/récolte absents → comportement Phase 1', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 26, anciennete: 1560,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 10, primeTransport: 30,
  });
  const smagBaseTotal = 88.58 * 26;
  const primeAnc = smagBaseTotal * 0.10;
  const primeFonction = 10 * 26;
  const brut = smagBaseTotal + primeAnc + primeFonction;
  // HS nuls → brut identique à Phase 1
  assert.strictEqual(r.heuresSup.montant, 0);
  assert.ok(close(r.brut, brut));
  assert.strictEqual(r.primeRecolte, 0);
  // coût total = brut + charges + transport (pas de récolte)
  assert.ok(close(r.coutTotalEmployeur, brut + brut * 0.26 + 30));
});
