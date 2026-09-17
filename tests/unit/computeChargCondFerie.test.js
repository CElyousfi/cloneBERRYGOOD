'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeChargCond, halfKey, buildHalfToPeriode, resolveHolidayPeriode, findJourAvant, findJourApres } = require('../../functions/src/modules/rh/pointageService');

// Deux ouvriers actifs dans la quinzaine Q1, avec une présence encadrante (avant ET
// après) autour des fériés testés — requis par la règle "présence réelle le jour J"
// (docs/spec-jour-ferie-fix.md §3). Toutes les dates sont dans le passé (2026-06,
// antérieur à la date courante réelle) pour ne pas dépendre du jour d'exécution des tests.
function rows() {
  return [
    { Personnel_Matricule: 'A1', Personnel_Nom: 'OUVRIER UN', DateStr: '2026-06-05', Periode_paie: 'Q1', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    { Personnel_Matricule: 'A2', Personnel_Nom: 'OUVRIER DEUX', DateStr: '2026-06-05', Periode_paie: 'Q1', Cout: 120, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    { Personnel_Matricule: 'A1', Personnel_Nom: 'OUVRIER UN', DateStr: '2026-06-07', Periode_paie: 'Q1', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    { Personnel_Matricule: 'A2', Personnel_Nom: 'OUVRIER DEUX', DateStr: '2026-06-07', Periode_paie: 'Q1', Cout: 120, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
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
  // A1 a une présence encadrante autour du férié (2026-06-14 avant, 2026-06-20 après —
  // le jour avant peut tomber dans une autre quinzaine calendaire, cf. spec §3.4).
  const r = [
    { Personnel_Matricule: 'A1', Personnel_Nom: 'OUVRIER UN', DateStr: '2026-06-14', Periode_paie: 'Q23', Cout: 90, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    { Personnel_Matricule: 'A1', Personnel_Nom: 'OUVRIER UN', DateStr: '2026-06-20', Periode_paie: 'Q24', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
  ];
  const holidays = [{ date: '2026-06-16', label: '1er Moharram', type: 'islamique', status: 'confirme' }];
  const { jourFerieDetail } = computeChargCond(r, holidays);
  assert.equal(jourFerieDetail.length, 1);
  assert.equal(jourFerieDetail[0].periode, 'Q24');
  assert.equal(jourFerieDetail[0].details[0].date, '2026-06-16');
  assert.equal(jourFerieDetail[0].details[0].raison, 'Présent avant/après le jour férié');
});

// =============================================
// Éligibilité "présence réelle le jour J" (fix bug crédit forfaitaire — docs/spec-jour-ferie-fix.md)
// =============================================
// Toutes les dates ci-dessous sont dans le passé (2020) pour garantir un résultat stable
// quelle que soit la date réelle d'exécution des tests (filtre temporel §3.1).

test('férié futur (loin dans l\'avenir) exclu — aucun ouvrier crédité', () => {
  const r = [
    { Personnel_Matricule: 'F1', Personnel_Nom: 'OUVRIER FUTUR', DateStr: '2020-07-19', Periode_paie: 'QF', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    { Personnel_Matricule: 'F1', Personnel_Nom: 'OUVRIER FUTUR', DateStr: '2099-12-30', Periode_paie: 'QF2', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
  ];
  const holidays = [{ date: '2099-12-31', label: 'Férié très lointain', type: 'fixe', status: 'confirme' }];
  const { jourFerieDetail } = computeChargCond(r, holidays);
  assert.equal(jourFerieDetail.length, 0);
});

test('cas A/B/C/D du spec §4 — présence réelle autour du férié', () => {
  const holidayDate = '2020-07-20';
  const jourAvant = '2020-07-19';
  const jourApres = '2020-07-21';
  const r = [
    // A — présent avant ET après (pas le jour férié lui-même) → crédité
    { Personnel_Matricule: 'A', Personnel_Nom: 'OUVRIER A', DateStr: jourAvant, Periode_paie: 'QX', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    { Personnel_Matricule: 'A', Personnel_Nom: 'OUVRIER A', DateStr: jourApres, Periode_paie: 'QX', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    // B — a travaillé le jour férié lui-même → crédité
    { Personnel_Matricule: 'B', Personnel_Nom: 'OUVRIER B', DateStr: jourAvant, Periode_paie: 'QX', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    { Personnel_Matricule: 'B', Personnel_Nom: 'OUVRIER B', DateStr: holidayDate, Periode_paie: 'QX', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    // C — présent avant seulement, absent après → non crédité
    { Personnel_Matricule: 'C', Personnel_Nom: 'OUVRIER C', DateStr: jourAvant, Periode_paie: 'QX', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
    // D — nouvel ouvrier, premier pointage après le férié seulement → non crédité
    { Personnel_Matricule: 'D', Personnel_Nom: 'OUVRIER D', DateStr: jourApres, Periode_paie: 'QX', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
  ];
  const holidays = [{ date: holidayDate, label: 'Férié Test Encadrant', type: 'fixe', status: 'confirme' }];
  const { jourFerieDetail } = computeChargCond(r, holidays);

  const byMat = Object.fromEntries(jourFerieDetail.map(w => [w.matricule, w]));
  assert.ok(byMat.A, 'A devrait être crédité (présence encadrante)');
  assert.equal(byMat.A.details[0].raison, 'Présent avant/après le jour férié');
  assert.ok(byMat.B, 'B devrait être crédité (a travaillé le jour férié)');
  assert.equal(byMat.B.details[0].raison, 'Travaillé le jour férié');
  assert.equal(byMat.C, undefined, 'C ne devrait PAS être crédité (absent après le férié)');
  assert.equal(byMat.D, undefined, 'D ne devrait PAS être crédité (pas de présence avant)');
  assert.equal(jourFerieDetail.length, 2);
});

test('cas E du spec §4 — comportement actuel bugué (1 seul pointage loin du férié) ne doit plus être crédité', () => {
  // Un seul pointage dans la quinzaine calendaire du férié, sans lien avec sa date précise.
  // Avant le fix : crédité par forfait ("actif quelque part dans la quinzaine").
  // Après le fix : non crédité (pas de présence encadrante ni travail le jour férié).
  const r = [
    { Personnel_Matricule: 'E', Personnel_Nom: 'OUVRIER E', DateStr: '2020-07-16', Periode_paie: 'QX', Cout: 100, Operation_Famille: '8. Récolte', Operation: 'Cueillette', Ref_parcelle: 'F1', Parcelle_Culturale: '' },
  ];
  const holidays = [{ date: '2020-07-20', label: 'Férié Test Bug Actuel', type: 'fixe', status: 'confirme' }];
  const { jourFerieDetail } = computeChargCond(r, holidays);
  assert.equal(jourFerieDetail.length, 0);
});

// =============================================
// findJourAvant / findJourApres
// =============================================

test('findJourAvant: dernier jour travaillé strictement avant la date donnée', () => {
  const jours = ['2020-07-10', '2020-07-19', '2020-07-25'];
  assert.equal(findJourAvant(jours, '2020-07-20'), '2020-07-19');
  assert.equal(findJourAvant(jours, '2020-07-10'), undefined); // rien avant le premier
  assert.equal(findJourAvant(jours, '2020-07-30'), '2020-07-25');
});

test('findJourApres: premier jour travaillé strictement après la date donnée', () => {
  const jours = ['2020-07-10', '2020-07-19', '2020-07-25'];
  assert.equal(findJourApres(jours, '2020-07-20'), '2020-07-25');
  assert.equal(findJourApres(jours, '2020-07-25'), undefined); // rien après le dernier
  assert.equal(findJourApres(jours, '2020-07-01'), '2020-07-10');
});
