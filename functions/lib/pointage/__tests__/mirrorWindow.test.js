'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  REBUILD_WINDOW_DAYS,
  computeWindowCutoffId,
  filterDateIdsWithinWindow,
  buildPeriodeMapFromDailyDocs,
} = require('../mirrorWindow');
const { campagneOf } = require('../../mappingConso/campagneUtils');
const { buildPeriodeCampagne } = require('../campagnePeriodes');

test('REBUILD_WINDOW_DAYS couvre une campagne complete (~365j) avec marge', () => {
  assert.ok(REBUILD_WINDOW_DAYS >= 365, 'la fenetre doit couvrir au moins une campagne complete');
  assert.ok(REBUILD_WINDOW_DAYS < 730, 'la fenetre ne doit pas englober deux campagnes completes');
});

test('computeWindowCutoffId: cutoff = now - windowDays', () => {
  const cutoff = computeWindowCutoffId('2026-08-05', 400);
  // 400 jours avant le 2026-08-05
  assert.strictEqual(cutoff, '2025-07-01');
});

test('filterDateIdsWithinWindow: garde uniquement les dates >= cutoff', () => {
  const ids = ['2023-01-01', '2025-06-01', '2026-01-15', '2026-08-01'];
  const out = filterDateIdsWithinWindow(ids, '2026-08-05', 400);
  // cutoff = 2026-08-05 - 400j = 2025-07-01 -> exclut 2023-01-01 et 2025-06-01
  assert.deepStrictEqual(out, ['2026-01-15', '2026-08-01']);
});

test('filterDateIdsWithinWindow: liste vide -> liste vide', () => {
  assert.deepStrictEqual(filterDateIdsWithinWindow([], '2026-08-05', 400), []);
});

test('buildPeriodeMapFromDailyDocs: regroupe par Periode_paie, dates triees', () => {
  const docs = [
    { id: '2026-03-02', rows: [{ Periode_paie: 'Quinzaine 17', DateStr: '2026-03-02' }] },
    { id: '2026-03-01', rows: [{ Periode_paie: 'Quinzaine 17', DateStr: '2026-03-01' }] },
    { id: '2026-03-15', rows: [{ Periode_paie: 'Quinzaine 18', DateStr: '2026-03-15' }] },
  ];
  const periodeMap = buildPeriodeMapFromDailyDocs(docs);
  assert.deepStrictEqual(periodeMap['Quinzaine 17'], ['2026-03-01', '2026-03-02']);
  assert.deepStrictEqual(periodeMap['Quinzaine 18'], ['2026-03-15']);
});

test('buildPeriodeMapFromDailyDocs: ligne sans Periode_paie ignoree', () => {
  const docs = [{ id: '2026-03-02', rows: [{ Periode_paie: '', DateStr: '2026-03-02' }] }];
  const periodeMap = buildPeriodeMapFromDailyDocs(docs);
  assert.deepStrictEqual(periodeMap, {});
});

// ---------------------------------------------------------------------------
// Régression du bug réel : "Quinzaine 15" à "Quinzaine 24" affichées sous le
// libellé de campagne "2025-2026" alors qu'une partie de ces dates appartient
// en réalité à la campagne PRÉCÉDENTE ("2024-2025"), à cause d'un scan mirror
// sans fenêtre qui fusionnait les deux campagnes sous la même clé de label.
// ---------------------------------------------------------------------------
test('régression: deux campagnes partageant le même numéro de quinzaine ne fusionnent plus après la fenêtre', () => {
  const now = '2026-08-05'; // ancrage "aujourd'hui" pour le test

  // Campagne 2024-2025 (juillet 2024 -> juin 2025) : "Quinzaine 15" ~ janvier 2025.
  // Bien au-delà de la fenêtre de 400 jours avant `now` (2026-08-05 - 400j = 2025-07-01).
  const oldCampagneDocs = [
    { id: '2025-01-10', rows: [{ Periode_paie: 'Quinzaine 15', DateStr: '2025-01-10' }] },
    { id: '2025-01-11', rows: [{ Periode_paie: 'Quinzaine 15', DateStr: '2025-01-11' }] },
  ];

  // Campagne 2025-2026 (juillet 2025 -> juin 2026) : "Quinzaine 15" ~ janvier 2026.
  // Dans la fenêtre de 400 jours avant `now`.
  const newCampagneDocs = [
    { id: '2026-01-10', rows: [{ Periode_paie: 'Quinzaine 15', DateStr: '2026-01-10' }] },
    { id: '2026-01-11', rows: [{ Periode_paie: 'Quinzaine 15', DateStr: '2026-01-11' }] },
  ];

  const allDocs = [...oldCampagneDocs, ...newCampagneDocs];
  const allDateIds = allDocs.map((d) => d.id);

  // AVANT le fix (scan sans fenêtre) : les deux campagnes fusionnent sous la
  // même clé "Quinzaine 15" -> campagne dérivée de la date la PLUS ANCIENNE
  // (2025-01-10) -> "2024-2025", alors que les dates de 2026 y sont incluses.
  const unboundedPeriodeMap = buildPeriodeMapFromDailyDocs(allDocs);
  assert.deepStrictEqual(unboundedPeriodeMap['Quinzaine 15'], [
    '2025-01-10',
    '2025-01-11',
    '2026-01-10',
    '2026-01-11',
  ]);
  const unboundedCampagne = buildPeriodeCampagne(unboundedPeriodeMap, campagneOf);
  assert.strictEqual(unboundedCampagne['Quinzaine 15'], '2024-2025', 'confirme le bug: mal-attribution sans fenêtre');

  // APRÈS le fix : filtrer les dateIds par fenêtre glissante AVANT de construire
  // le periodeMap élimine entièrement les dates de la campagne 2024-2025.
  const windowedDateIds = filterDateIdsWithinWindow(allDateIds, now, 400);
  const windowedDocs = allDocs.filter((d) => windowedDateIds.includes(d.id));
  const windowedPeriodeMap = buildPeriodeMapFromDailyDocs(windowedDocs);

  assert.deepStrictEqual(windowedPeriodeMap['Quinzaine 15'], ['2026-01-10', '2026-01-11']);
  const windowedCampagne = buildPeriodeCampagne(windowedPeriodeMap, campagneOf);
  assert.strictEqual(windowedCampagne['Quinzaine 15'], '2025-2026', 'la quinzaine est désormais attribuée à la bonne campagne');
});

test('régression: la campagne EN COURS reste entièrement visible (pas de coupe de quinzaines récentes)', () => {
  const now = '2026-08-05';
  // Quinzaines couvrant toute la campagne 2025-2026 (juillet 2025 -> juin 2026).
  const docs = [
    { id: '2025-07-05', rows: [{ Periode_paie: 'Quinzaine 01', DateStr: '2025-07-05' }] },
    { id: '2026-06-20', rows: [{ Periode_paie: 'Quinzaine 24', DateStr: '2026-06-20' }] },
  ];
  const dateIds = docs.map((d) => d.id);
  const windowed = filterDateIdsWithinWindow(dateIds, now, 400);
  assert.deepStrictEqual(windowed.sort(), dateIds.sort(), 'toutes les dates de la campagne en cours doivent rester dans la fenêtre');
});
