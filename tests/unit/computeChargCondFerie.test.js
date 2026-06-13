'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeChargCond, halfKey, buildHalfToPeriode, resolveHolidayPeriode } = require('../../functions/pointageService');

// Deux ouvriers actifs dans la quinzaine Q1, plus un jour de production le 2026-06-01
// (sert d'ancrage dateToPeriode pour rattacher les fériés à la période).
function rows() {
  // Jour de production le 2026-06-05 → ancre Q1 à portée (±3 j) des fériés du 06/07.
  return [
    { Personnel_Matricule: 'A1', Personnel_Nom: 'OUVRIER UN', DateStr: '2026-06-05', Periode_paie: 'Q1', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    { Personnel_Matricule: 'A2', Personnel_Nom: 'OUVRIER DEUX', DateStr: '2026-06-05', Periode_paie: 'Q1', Cout: 120, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
  ];
}

test('Aïd 2 jours → la prime ne compte QUE le 1er jour (2e jour ignoré)', () => {
  const holidays = [
    { date: '2026-06-06', label: 'Aïd Al Adha', type: 'islamique', status: 'confirme' },
    { date: '2026-06-07', label: 'Aïd Al Adha (2e jour)', type: 'islamique', status: 'confirme' },
  ];
  const { jourFerieDetail } = computeChargCond(rows(), holidays);
  // Chaque ouvrier ne doit avoir qu'1 jour sup (le 1er jour), pas 2.
  assert.equal(jourFerieDetail.length, 2);
  for (const w of jourFerieDetail) {
    assert.equal(w.jh, 1, `ouvrier ${w.matricule} devrait avoir 1 jour sup`);
    assert.equal(w.details.length, 1);
    assert.equal(w.details[0].label, 'Aïd Al Adha');
  }
});

test('compteurPrime:false exclut une entrée du crédit de prime', () => {
  const holidays = [
    { date: '2026-06-06', label: 'Aïd Al Adha', type: 'islamique', status: 'confirme' },
    { date: '2026-06-08', label: 'Journée spéciale', type: 'fixe', status: 'fixe', compteurPrime: false },
  ];
  const { jourFerieDetail } = computeChargCond(rows(), holidays);
  for (const w of jourFerieDetail) {
    assert.equal(w.jh, 1);
    assert.equal(w.details[0].label, 'Aïd Al Adha');
  }
});

test('un férié fixe unique compte 1 jour par ouvrier actif', () => {
  const holidays = [{ date: '2026-06-06', label: 'Test Férié', type: 'fixe', status: 'fixe' }];
  const { jourFerieDetail } = computeChargCond(rows(), holidays);
  assert.equal(jourFerieDetail.length, 2);
  assert.ok(jourFerieDetail.every(w => w.jh === 1));
});

// =============================================
// Rattachement par quinzaine calendaire (1–15 / 16–fin)
// =============================================

test('halfKey: 1–15 → H1, 16–fin → H2', () => {
  assert.equal(halfKey('2026-06-01'), '2026-06-H1');
  assert.equal(halfKey('2026-06-15'), '2026-06-H1');
  assert.equal(halfKey('2026-06-16'), '2026-06-H2');
  assert.equal(halfKey('2026-06-31'), '2026-06-H2');
});

test('buildHalfToPeriode: regroupe les dates par demi-mois calendaire', () => {
  const dateToPeriode = {
    '2026-06-10': 'Quinzaine 23',
    '2026-06-14': 'Quinzaine 23',
    '2026-06-20': 'Quinzaine 24',
  };
  const half = buildHalfToPeriode(dateToPeriode);
  assert.equal(half['2026-06-H1'], 'Quinzaine 23');
  assert.equal(half['2026-06-H2'], 'Quinzaine 24');
});

test('férié du 16 juin (H2) NON rattaché si seule la H1 a des données — cœur du bug DG', () => {
  const dateToPeriode = { '2026-06-10': 'Quinzaine 23', '2026-06-14': 'Quinzaine 23' };
  const half = buildHalfToPeriode(dateToPeriode);
  // Le 16 juin est en H2 ; aucune donnée H2 → undefined (pas rattaché à Q23).
  assert.equal(resolveHolidayPeriode(half, '2026-06-16'), undefined);
});

test('férié du 16 juin → Quinzaine 24 dès que la H2 a des données', () => {
  const dateToPeriode = {
    '2026-06-10': 'Quinzaine 23',
    '2026-06-14': 'Quinzaine 23',
    '2026-06-20': 'Quinzaine 24',
  };
  const half = buildHalfToPeriode(dateToPeriode);
  assert.equal(resolveHolidayPeriode(half, '2026-06-16'), 'Quinzaine 24');
});

test('férié du 12 juin (H1) → Quinzaine 23', () => {
  const dateToPeriode = { '2026-06-10': 'Quinzaine 23', '2026-06-14': 'Quinzaine 23' };
  const half = buildHalfToPeriode(dateToPeriode);
  assert.equal(resolveHolidayPeriode(half, '2026-06-12'), 'Quinzaine 23');
});

test('férié du 1er juillet sans données → undefined', () => {
  const dateToPeriode = { '2026-06-10': 'Quinzaine 23', '2026-06-20': 'Quinzaine 24' };
  const half = buildHalfToPeriode(dateToPeriode);
  assert.equal(resolveHolidayPeriode(half, '2026-07-01'), undefined);
});

test('computeChargCond: férié 16 juin non crédité tant que la Q24 n\'a pas de données', () => {
  // Données uniquement en H1 (Q23). Férié le 16 juin (H2).
  const r = [
    { Personnel_Matricule: 'A1', Personnel_Nom: 'OUVRIER UN', DateStr: '2026-06-14', Periode_paie: 'Q23', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
  ];
  const holidays = [{ date: '2026-06-16', label: '1er Moharram', type: 'islamique', status: 'confirme' }];
  const { jourFerieDetail } = computeChargCond(r, holidays);
  assert.equal(jourFerieDetail.length, 0);
});

test('computeChargCond: férié 16 juin crédité à la Q24 quand la H2 a des données', () => {
  const r = [
    { Personnel_Matricule: 'A1', Personnel_Nom: 'OUVRIER UN', DateStr: '2026-06-20', Periode_paie: 'Q24', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
  ];
  const holidays = [{ date: '2026-06-16', label: '1er Moharram', type: 'islamique', status: 'confirme' }];
  const { jourFerieDetail } = computeChargCond(r, holidays);
  assert.equal(jourFerieDetail.length, 1);
  assert.equal(jourFerieDetail[0].periode, 'Q24');
  assert.equal(jourFerieDetail[0].details[0].date, '2026-06-16');
});
