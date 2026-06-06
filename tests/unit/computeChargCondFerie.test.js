'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeChargCond } = require('../../functions/pointageService');

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
