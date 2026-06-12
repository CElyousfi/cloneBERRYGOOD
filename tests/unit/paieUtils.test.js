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
// calculerPaieOuvrier — modèle validé Omar 2026-06 :
//   SMAG base = BRUT pour TOUS ; aucune retenue salariale (cotis = 0) ;
//   net = brut + primes ; CNSS patronale seulement sur coût employeur déclaré.
// ---------------------------------------------------------------------------
test('calculerPaieOuvrier: non-déclaré → base BRUT × jours, 0 retenue, net = brut, pas de CNSS', () => {
  const r = calculerPaieOuvrier({ declare: false, joursTravailles: 10, anciennete: 5000, baremes: PAIE_BAREMES_DEFAULT });
  const brutBase = 88.58 * 10;
  assert.ok(close(r.brut, brutBase));
  assert.ok(close(r.net, brutBase));
  assert.strictEqual(r.brut, r.net);
  assert.strictEqual(r.chargesPatronales, 0);
  assert.strictEqual(r.cotisationsSalariales, 0);
  assert.strictEqual(r.prime, 0);
  assert.ok(close(r.coutEmployeur, brutBase));
});

test('calculerPaieOuvrier: déclaré sans ancienneté → net = brut (0 retenue), coût = brut + CNSS patronale', () => {
  const r = calculerPaieOuvrier({ declare: true, joursTravailles: 26, anciennete: 0, baremes: PAIE_BAREMES_DEFAULT });
  const brutBase = 88.58 * 26;
  assert.ok(close(r.brut, brutBase));
  assert.ok(close(r.prime, 0));
  assert.strictEqual(r.cotisationsSalariales, 0);
  assert.ok(close(r.chargesPatronales, brutBase * 0.26));
  assert.ok(close(r.net, brutBase));
  assert.ok(close(r.coutEmployeur, brutBase + brutBase * 0.26));
});

test('calculerPaieOuvrier: déclaré avec prime ancienneté 10% → net = brut, coût = brut + CNSS', () => {
  const r = calculerPaieOuvrier({ declare: true, joursTravailles: 26, anciennete: 1560, baremes: PAIE_BAREMES_DEFAULT });
  const brutBase = 88.58 * 26;
  const prime = brutBase * 0.10;
  const brut = brutBase + prime;
  assert.ok(close(r.prime, prime));
  assert.ok(close(r.brut, brut));
  assert.strictEqual(r.cotisationsSalariales, 0);
  assert.ok(close(r.net, brut));
  assert.ok(close(r.coutEmployeur, brut + brut * 0.26));
});

test('calculerPaieOuvrier: comparatif déclaré vs non-déclaré — même base brut, même net, seul le coût employeur diffère (CNSS patronale)', () => {
  // anciennete 0 → pas de prime, donc base brut strictement identique des deux côtés.
  const nonDecl = calculerPaieOuvrier({ declare: false, joursTravailles: 26, anciennete: 0, baremes: PAIE_BAREMES_DEFAULT });
  const decl = calculerPaieOuvrier({ declare: true, joursTravailles: 26, anciennete: 0, baremes: PAIE_BAREMES_DEFAULT });
  // Même base brut et même net ouvrier.
  assert.ok(close(nonDecl.brut, decl.brut));
  assert.ok(close(nonDecl.net, decl.net));
  // Aucune retenue salariale d'un côté comme de l'autre.
  assert.strictEqual(nonDecl.cotisationsSalariales, 0);
  assert.strictEqual(decl.cotisationsSalariales, 0);
  // Seul le coût employeur diffère, exactement de la CNSS patronale.
  assert.strictEqual(nonDecl.chargesPatronales, 0);
  assert.ok(close(decl.chargesPatronales, decl.brut * 0.26));
  assert.ok(close(decl.coutEmployeur - nonDecl.coutEmployeur, decl.brut * 0.26));
});

// calculerPaieOuvrier — prime de fonction (primeFonctionJour), rétro-compatible.
test('calculerPaieOuvrier: param primeFonctionJour absent → comportement strictement inchangé', () => {
  const sans = calculerPaieOuvrier({ declare: true, joursTravailles: 26, anciennete: 1560, baremes: PAIE_BAREMES_DEFAULT });
  const zero = calculerPaieOuvrier({ declare: true, joursTravailles: 26, anciennete: 1560, baremes: PAIE_BAREMES_DEFAULT, primeFonctionJour: 0 });
  assert.deepStrictEqual(zero, sans);
});

test('calculerPaieOuvrier: déclaré ancienneté 10% AVEC prime fonction → brut = (smag + prime)×jours × 1.10', () => {
  const primeFonctionJour = 20;
  const r = calculerPaieOuvrier({ declare: true, joursTravailles: 26, anciennete: 1560, baremes: PAIE_BAREMES_DEFAULT, primeFonctionJour });
  const base = (88.58 + primeFonctionJour) * 26;
  const prime = base * 0.10;
  const brut = base + prime;
  assert.ok(close(r.brut, brut));
  assert.ok(close(r.brut, base * 1.10));
  assert.ok(close(r.prime, prime));
  assert.ok(close(r.net, brut));
  assert.ok(close(r.coutEmployeur, brut + brut * 0.26));
});

test('calculerPaieOuvrier: non-déclaré AVEC prime fonction → brut = net = (smag + prime)×jours, pas d\'ancienneté ni CNSS', () => {
  const primeFonctionJour = 15;
  const r = calculerPaieOuvrier({ declare: false, joursTravailles: 10, anciennete: 5000, baremes: PAIE_BAREMES_DEFAULT, primeFonctionJour });
  const base = (88.58 + primeFonctionJour) * 10;
  assert.ok(close(r.brut, base));
  assert.ok(close(r.net, base));
  assert.strictEqual(r.prime, 0);
  assert.strictEqual(r.chargesPatronales, 0);
  assert.strictEqual(r.cotisationsSalariales, 0);
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
test('computeWorkerPaie: declared, prime fonction dans le brut, CNSS patronale sur brut, AUCUNE retenue salariale', () => {
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
  // Aucune retenue salariale (modèle Omar 2026-06)
  assert.strictEqual(r.cotisationsSalariales, 0);
  // CNSS patronale calculée sur le brut INCLUANT prime de fonction
  assert.ok(close(r.chargesPatronales, brut * 0.26));
  // Net ouvrier = brut (pas de retenue), CNSS patronale uniquement dans le coût employeur
  assert.ok(close(r.net, brut));
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
  assert.strictEqual(withT.cotisationsSalariales, 0);
  assert.strictEqual(noT.cotisationsSalariales, 0);
  // net & cost increased by exactly the transport amount
  assert.ok(close(withT.net, noT.net + 30));
  assert.ok(close(withT.coutEmployeur, noT.coutEmployeur + 30));
  assert.strictEqual(withT.primeTransport, 30);
});

test('computeWorkerPaie: non-declared utilise SMAG BRUT, no charges, still pays primes', () => {
  const r = computeWorkerPaie({
    declare: false, joursTravailles: 10, anciennete: 5000,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 5, primeTransport: 30,
  });
  const smagBaseTotal = 88.58 * 10; // BRUT, plus le net
  const primeFonction = 5 * 10;
  assert.strictEqual(r.statutDeclare, false);
  assert.ok(close(r.smagBaseJour, 88.58));
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

test('computeWorkerPaie: declared with seniority + prime fonction + transport combined (prime fonction dans la base ancienneté)', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 26, anciennete: 1560,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 10, primeTransport: 30,
  });
  const smagBaseTotal = 88.58 * 26;
  const primeFonction = 10 * 26;
  // Modèle Omar 2026-06 : la prime de fonction entre dans la base AVANT l'ancienneté.
  const baseAnc = smagBaseTotal + primeFonction;
  const primeAnc = baseAnc * 0.10;
  const brut = baseAnc + primeAnc;
  assert.ok(close(r.primeAnciennete, primeAnc));
  assert.ok(close(r.primeFonction, primeFonction));
  assert.ok(close(r.brut, brut));
  assert.strictEqual(r.anciennetePourcent, 10);
  assert.ok(close(r.coutEmployeur, brut + brut * 0.26 + 30));
});

test('computeWorkerPaie: prime fonction × (1 + ancienneté%) — l\'ancienneté s\'applique AUSSI sur la prime de fonction', () => {
  // Avec ancienneté 5% (≥624 j), la prime ancienneté = (SMAG base + prime fonction) × 5%.
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 10, anciennete: 700,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 20, primeTransport: 0,
  });
  const smagBaseTotal = 88.58 * 10;
  const primeFonction = 20 * 10;
  const baseAnc = smagBaseTotal + primeFonction;
  const primeAnc = baseAnc * 0.05;
  assert.strictEqual(r.anciennetePourcent, 5);
  assert.ok(close(r.primeFonction, primeFonction));
  // primeAnciennete = (smagBase + primeFonction) × pct, PAS smagBase × pct.
  assert.ok(close(r.primeAnciennete, primeAnc));
  // La part d'ancienneté incrémentale due à la prime de fonction = primeFonction × pct.
  assert.ok(close(r.primeAnciennete - smagBaseTotal * 0.05, primeFonction * 0.05));
  assert.ok(close(r.brut, baseAnc + primeAnc));
  assert.ok(close(r.coutEmployeur, r.brut * 1.26));
});

test('computeWorkerPaie: ancienneté 0 → prime fonction ajoutée telle quelle (pas multipliée)', () => {
  const r = computeWorkerPaie({
    declare: true, joursTravailles: 10, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01',
    primeFonctionJour: 20, primeTransport: 0,
  });
  const smagBaseTotal = 88.58 * 10;
  const primeFonction = 20 * 10;
  assert.strictEqual(r.anciennetePourcent, 0);
  assert.strictEqual(r.primeAnciennete, 0);
  // brut = SMAG base + prime fonction (aucune majoration ancienneté).
  assert.ok(close(r.brut, smagBaseTotal + primeFonction));
  assert.ok(close(r.primeFonction, primeFonction));
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
  // CNSS patronale calculée sur le brut majoré des HS ; aucune retenue salariale
  assert.ok(close(withHS.chargesPatronales, withHS.brut * 0.26));
  assert.strictEqual(withHS.cotisationsSalariales, 0);
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
  assert.strictEqual(withExtras.cotisationsSalariales, 0);
  assert.strictEqual(base.cotisationsSalariales, 0);
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

test('computeWorkerPaie: non-déclaré → HS au taux SMAG BRUT, 0 charge', () => {
  const r = computeWorkerPaie({
    declare: false, joursTravailles: 0, anciennete: 0,
    baremes: PAIE_BAREMES_DEFAULT, dateISO: '2026-06-01', hs100: 2,
  });
  // Non-déclaré payé sur le brut → HS valorisées sur le brut (modèle Omar 2026-06)
  assert.ok(close(r.heuresSup.tauxHoraire, TAUX_H_DECLARE));
  assert.ok(close(r.heuresSup.montant, 2 * TAUX_H_DECLARE * 2));
  assert.ok(close(r.brut, 2 * TAUX_H_DECLARE * 2));
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
  const primeFonction = 10 * 26;
  // Prime de fonction incluse dans la base ancienneté (modèle Omar 2026-06).
  const baseAnc = smagBaseTotal + primeFonction;
  const primeAnc = baseAnc * 0.10;
  const brut = baseAnc + primeAnc;
  // HS nuls → brut sans majoration HS
  assert.strictEqual(r.heuresSup.montant, 0);
  assert.ok(close(r.brut, brut));
  assert.strictEqual(r.primeRecolte, 0);
  // coût total = brut + charges + transport (pas de récolte)
  assert.ok(close(r.coutTotalEmployeur, brut + brut * 0.26 + 30));
});

// ---------------------------------------------------------------------------
// computeWorkerPaie — comparatif déclaré vs non-déclaré (modèle Omar 2026-06)
// Même SMAG brut configuré → smagBaseJour identique ; net identique à primes
// égales ; seul coutTotalEmployeur diffère, de la CNSS patronale.
// ---------------------------------------------------------------------------
test('computeWorkerPaie: déclaré vs non-déclaré — même base brut, même net, seul coût employeur diffère (CNSS patronale)', () => {
  const baremes = {
    ...PAIE_BAREMES_DEFAULT,
    smagHistory: [{ dateFrom: '2026-06-01', smagBrutJournalier: 97.44, smagNetJournalier: 83 }],
  };
  const common = {
    joursTravailles: 26, anciennete: 0, // 0 ancienneté → pas de prime, comparaison à primes égales
    baremes, dateISO: '2026-06-08',
    primeFonctionJour: 10, primeTransport: 30,
  };
  const dec = computeWorkerPaie({ ...common, declare: true });
  const non = computeWorkerPaie({ ...common, declare: false });

  // SMAG base journalier = BRUT (97,44) pour les deux, jamais le net (83)
  assert.ok(close(dec.smagBaseJour, 97.44));
  assert.ok(close(non.smagBaseJour, 97.44));
  assert.ok(close(dec.smagBaseJour, non.smagBaseJour));

  // Aucune retenue salariale pour personne
  assert.strictEqual(dec.cotisationsSalariales, 0);
  assert.strictEqual(non.cotisationsSalariales, 0);

  // À primes égales (ancienneté 0), brut et net identiques
  assert.ok(close(dec.brut, non.brut));
  assert.ok(close(dec.net, non.net));

  // Net = brut + transport (récolte=0) pour les deux
  assert.ok(close(dec.net, dec.brut + 30));
  assert.ok(close(non.net, non.brut + 30));

  // Seul le déclaré porte la CNSS patronale → seul son coût employeur la contient
  assert.ok(dec.chargesPatronales > 0);
  assert.strictEqual(non.chargesPatronales, 0);
  assert.ok(close(dec.chargesPatronales, dec.brut * 0.26));

  // Le coût employeur diffère exactement de la CNSS patronale
  assert.ok(close(dec.coutTotalEmployeur - non.coutTotalEmployeur, dec.chargesPatronales));
  assert.ok(close(non.coutTotalEmployeur, non.net));
});
