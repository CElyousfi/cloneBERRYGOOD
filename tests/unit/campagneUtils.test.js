'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  campagneOf,
  debutCampagne,
  finCampagne,
  campagneDeCharge,
  phaseDeCharge,
} = require('../../public/lib/campagneUtils.js');

// ============================================================================
// campagneOf — frontière 1er juillet (spec §10)
// ============================================================================
test('campagneOf — frontière fiscale juillet→juin', () => {
  assert.strictEqual(campagneOf('2025-07-01'), '2025-2026'); // 1er jour campagne
  assert.strictEqual(campagneOf('2026-06-30'), '2025-2026'); // dernier jour campagne
  assert.strictEqual(campagneOf('2025-06-30'), '2024-2025'); // veille du 1er juillet
  assert.strictEqual(campagneOf('2026-07-01'), '2026-2027'); // bascule campagne suivante
});

test('campagneOf — dates non ISO / garbage → null', () => {
  assert.strictEqual(campagneOf(''), null);
  assert.strictEqual(campagneOf('2026/07/01'), null);
  assert.strictEqual(campagneOf('2026-7-1'), null);
  assert.strictEqual(campagneOf('not-a-date'), null);
  assert.strictEqual(campagneOf(null), null);
  assert.strictEqual(campagneOf(undefined), null);
  assert.strictEqual(campagneOf(20260701), null);
});

// ============================================================================
// debutCampagne / finCampagne
// ============================================================================
test('debutCampagne — 1er juillet de l année de début', () => {
  assert.strictEqual(debutCampagne('2026-2027'), '2026-07-01');
  assert.strictEqual(debutCampagne('2025-2026'), '2025-07-01');
});

test('finCampagne — 30 juin de l année de fin', () => {
  assert.strictEqual(finCampagne('2026-2027'), '2027-06-30');
  assert.strictEqual(finCampagne('2025-2026'), '2026-06-30');
});

test('debutCampagne / finCampagne — libellé invalide → null', () => {
  assert.strictEqual(debutCampagne('2026'), null);
  assert.strictEqual(finCampagne('2026/2027'), null);
  assert.strictEqual(debutCampagne(null), null);
  assert.strictEqual(finCampagne(undefined), null);
});

// ============================================================================
// campagneDeCharge — cutoff tire le début, fin reste 30 juin cible (spec §12)
// Cas DG MIA : cutoff_date 2026-05-01, cible 2026-2027
// ============================================================================
test('campagneDeCharge MIA — avant le cutoff → dérivation standard', () => {
  // 2026-04-01 < cutoff (2026-05-01) → pas tiré vers la cible
  assert.strictEqual(
    campagneDeCharge({ date: '2026-04-01', cutoff_date: '2026-05-01', campagne_cible: '2026-2027' }),
    '2025-2026'
  );
});

test('campagneDeCharge MIA — entre cutoff et fin cible → campagne cible', () => {
  // 2026-06-01 : >= cutoff et <= 2027-06-30 → tiré vers 2026-2027 (avant le 1/7 normalement 2025-2026)
  assert.strictEqual(
    campagneDeCharge({ date: '2026-06-01', cutoff_date: '2026-05-01', campagne_cible: '2026-2027' }),
    '2026-2027'
  );
  // 2027-01-15 : dans la cible naturellement ET dans la fenêtre → 2026-2027
  assert.strictEqual(
    campagneDeCharge({ date: '2027-01-15', cutoff_date: '2026-05-01', campagne_cible: '2026-2027' }),
    '2026-2027'
  );
});

test('campagneDeCharge MIA — APRÈS la fin de la cible → dérivation standard (cas tordu)', () => {
  // 2027-07-10 > finCampagne(2026-2027)=2027-06-30 → la fenêtre ne couvre plus → campagneOf
  assert.strictEqual(
    campagneDeCharge({ date: '2027-07-10', cutoff_date: '2026-05-01', campagne_cible: '2026-2027' }),
    '2027-2028'
  );
});

test('campagneDeCharge — bornes inclusives (cutoff et fin)', () => {
  // date == cutoff → cible
  assert.strictEqual(
    campagneDeCharge({ date: '2026-05-01', cutoff_date: '2026-05-01', campagne_cible: '2026-2027' }),
    '2026-2027'
  );
  // date == finCampagne(cible) → cible
  assert.strictEqual(
    campagneDeCharge({ date: '2027-06-30', cutoff_date: '2026-05-01', campagne_cible: '2026-2027' }),
    '2026-2027'
  );
});

test('campagneDeCharge — sans cutoff → identique à campagneOf', () => {
  assert.strictEqual(campagneDeCharge({ date: '2026-04-01' }), '2025-2026');
  assert.strictEqual(campagneDeCharge({ date: '2026-07-01' }), '2026-2027');
  // cutoff sans cible → ignoré
  assert.strictEqual(campagneDeCharge({ date: '2026-06-01', cutoff_date: '2026-05-01' }), '2025-2026');
});

test('campagneDeCharge — date invalide → null', () => {
  assert.strictEqual(campagneDeCharge({ date: 'nope', cutoff_date: '2026-05-01', campagne_cible: '2026-2027' }), null);
  assert.strictEqual(campagneDeCharge({}), null);
  assert.strictEqual(campagneDeCharge(null), null);
});

// ============================================================================
// phaseDeCharge — bascule primocane→floricane (spec §11)
// ============================================================================
test('phaseDeCharge — bascule 2027-01-01', () => {
  assert.strictEqual(phaseDeCharge({ date: '2026-12-31', bascule_date: '2027-01-01' }), 'primocane');
  assert.strictEqual(phaseDeCharge({ date: '2027-01-01', bascule_date: '2027-01-01' }), 'floricane');
  assert.strictEqual(phaseDeCharge({ date: '2027-03-15', bascule_date: '2027-01-01' }), 'floricane');
});

test('phaseDeCharge — sans bascule → unique', () => {
  assert.strictEqual(phaseDeCharge({ date: '2026-12-31' }), 'unique');
  assert.strictEqual(phaseDeCharge({ date: '2027-01-01', bascule_date: '' }), 'unique');
  assert.strictEqual(phaseDeCharge({ date: '2027-01-01', bascule_date: 'garbage' }), 'unique');
});

test('phaseDeCharge — date invalide → null', () => {
  assert.strictEqual(phaseDeCharge({ date: 'nope', bascule_date: '2027-01-01' }), null);
  assert.strictEqual(phaseDeCharge({}), null);
  assert.strictEqual(phaseDeCharge(null), null);
});
