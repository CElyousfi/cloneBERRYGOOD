'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  quinzaineNum,
  buildPeriodeCampagne,
  sortPeriodesByCampagne,
  defaultPeriodeForCampagne,
} = require('../../functions/lib/pointage/campagnePeriodes.js');
const { campagneOf, campagneCourante } = require('./_esm').loadEsm('src/modules/shared/lib/campagneUtils.js');

// ---------------------------------------------------------------------------
// quinzaineNum
// ---------------------------------------------------------------------------
test('quinzaineNum extrait le numéro', () => {
  assert.strictEqual(quinzaineNum('Quinzaine 24'), 24);
  assert.strictEqual(quinzaineNum('Quinzaine 01'), 1);
  assert.strictEqual(quinzaineNum('n/a'), 0);
  assert.strictEqual(quinzaineNum(null), 0);
});

// ---------------------------------------------------------------------------
// buildPeriodeCampagne — campagne = campagneOf(min des dates)
// ---------------------------------------------------------------------------
test('buildPeriodeCampagne dérive la campagne de la date la plus ancienne', () => {
  const periodeMap = {
    'Quinzaine 24': ['2026-06-16', '2026-06-30'], // juin → 2025-2026
    'Quinzaine 01': ['2026-07-01', '2026-07-15'], // juillet → 2026-2027
  };
  const pc = buildPeriodeCampagne(periodeMap, campagneOf);
  assert.strictEqual(pc['Quinzaine 24'], '2025-2026');
  assert.strictEqual(pc['Quinzaine 01'], '2026-2027');
});

test('buildPeriodeCampagne ignore les quinzaines sans date', () => {
  const pc = buildPeriodeCampagne({ 'Quinzaine 09': [] }, campagneOf);
  assert.deepStrictEqual(pc, {});
});

test('buildPeriodeCampagne tolère un periodeMap null', () => {
  assert.deepStrictEqual(buildPeriodeCampagne(null, campagneOf), {});
});

// ---------------------------------------------------------------------------
// sortPeriodesByCampagne — (campagne DESC, numéro DESC) — LE bug corrigé
// ---------------------------------------------------------------------------
test('tri campagne-aware : Q01 juillet (2026-2027) passe AVANT Q24 juin (2025-2026)', () => {
  const periodeMap = {
    'Quinzaine 24': ['2026-06-16'],
    'Quinzaine 23': ['2026-06-01'],
    'Quinzaine 01': ['2026-07-01'],
    'Quinzaine 02': ['2026-07-16'],
  };
  const pc = buildPeriodeCampagne(periodeMap, campagneOf);
  const sorted = sortPeriodesByCampagne(Object.keys(periodeMap), pc);
  // Campagne 2026-2027 en tête (numéro DESC), puis 2025-2026 (numéro DESC).
  assert.deepStrictEqual(sorted, [
    'Quinzaine 02', // 2026-2027, num 2
    'Quinzaine 01', // 2026-2027, num 1
    'Quinzaine 24', // 2025-2026, num 24
    'Quinzaine 23', // 2025-2026, num 23
  ]);
});

test('tri : ancien comportement (numéro DESC) aurait mis Q24 en tête → régression évitée', () => {
  const periodeMap = { 'Quinzaine 24': ['2026-06-16'], 'Quinzaine 01': ['2026-07-01'] };
  const pc = buildPeriodeCampagne(periodeMap, campagneOf);
  const sorted = sortPeriodesByCampagne(['Quinzaine 24', 'Quinzaine 01'], pc);
  assert.strictEqual(sorted[0], 'Quinzaine 01'); // campagne la plus récente d'abord
});

test('tri : les quinzaines sans campagne connue sont reléguées en fin', () => {
  const pc = { 'Quinzaine 05': '2026-2027' }; // Q06 non mappée
  const sorted = sortPeriodesByCampagne(['Quinzaine 06', 'Quinzaine 05'], pc);
  assert.deepStrictEqual(sorted, ['Quinzaine 05', 'Quinzaine 06']);
});

test('sortPeriodesByCampagne ne mute pas l’entrée', () => {
  const input = ['Quinzaine 01', 'Quinzaine 02'];
  const copy = input.slice();
  sortPeriodesByCampagne(input, {});
  assert.deepStrictEqual(input, copy);
});

// ---------------------------------------------------------------------------
// defaultPeriodeForCampagne — défaut = 1re quinzaine de la campagne courante
// ---------------------------------------------------------------------------
test('défaut = plus grand numéro de la campagne courante', () => {
  const periodeMap = {
    'Quinzaine 02': ['2026-07-16'], // 2026-2027
    'Quinzaine 01': ['2026-07-01'], // 2026-2027
    'Quinzaine 24': ['2026-06-16'], // 2025-2026
  };
  const pc = buildPeriodeCampagne(periodeMap, campagneOf);
  const periodes = sortPeriodesByCampagne(Object.keys(periodeMap), pc);
  const def = defaultPeriodeForCampagne(periodes, pc, '2026-2027');
  assert.strictEqual(def, 'Quinzaine 02');
});

test('défaut : campagne courante absente de la liste → fallback 1re de la liste triée', () => {
  const periodeMap = { 'Quinzaine 24': ['2026-06-16'], 'Quinzaine 23': ['2026-06-01'] };
  const pc = buildPeriodeCampagne(periodeMap, campagneOf);
  const periodes = sortPeriodesByCampagne(Object.keys(periodeMap), pc);
  // Campagne courante 2026-2027 sans quinzaine → fallback la 1re (Q24)
  const def = defaultPeriodeForCampagne(periodes, pc, '2026-2027');
  assert.strictEqual(def, 'Quinzaine 24');
});

test('défaut : liste vide → undefined (aucun crash)', () => {
  assert.strictEqual(defaultPeriodeForCampagne([], {}, '2026-2027'), undefined);
});

test('défaut : periodeCampagne absent (transitoire) → fallback 1re de la liste', () => {
  const periodes = ['Quinzaine 03', 'Quinzaine 02'];
  const def = defaultPeriodeForCampagne(periodes, {}, campagneCourante());
  assert.strictEqual(def, 'Quinzaine 03');
});
