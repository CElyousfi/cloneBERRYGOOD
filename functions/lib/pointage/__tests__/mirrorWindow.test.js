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

test('buildPeriodeMapFromDailyDocs: regroupe par Periode_paie, dates triees (cas nominal, 1 campagne)', () => {
  const docs = [
    { id: '2026-03-02', rows: [{ Periode_paie: 'Quinzaine 17', DateStr: '2026-03-02' }] },
    { id: '2026-03-01', rows: [{ Periode_paie: 'Quinzaine 17', DateStr: '2026-03-01' }] },
    { id: '2026-03-15', rows: [{ Periode_paie: 'Quinzaine 18', DateStr: '2026-03-15' }] },
  ];
  const { periodeMap, periodeCampagne } = buildPeriodeMapFromDailyDocs(docs, campagneOf);
  assert.deepStrictEqual(periodeMap['Quinzaine 17'], ['2026-03-01', '2026-03-02']);
  assert.deepStrictEqual(periodeMap['Quinzaine 18'], ['2026-03-15']);
  // 1 seule campagne par label -> sortie identique au comportement pré-fix (pas de suffixe).
  assert.strictEqual(periodeCampagne['Quinzaine 17'], '2025-2026');
  assert.strictEqual(periodeCampagne['Quinzaine 18'], '2025-2026');
  assert.strictEqual(Object.keys(periodeMap).length, 2, 'aucun label composite créé quand il n’y a pas de collision');
});

test('buildPeriodeMapFromDailyDocs: ligne sans Periode_paie ignoree', () => {
  const docs = [{ id: '2026-03-02', rows: [{ Periode_paie: '', DateStr: '2026-03-02' }] }];
  const { periodeMap } = buildPeriodeMapFromDailyDocs(docs, campagneOf);
  assert.deepStrictEqual(periodeMap, {});
});

// ---------------------------------------------------------------------------
// Régression du bug réel : "Quinzaine 15" à "Quinzaine 24" affichées sous le
// libellé de campagne "2025-2026" alors qu'une partie de ces dates appartient
// en réalité à la campagne PRÉCÉDENTE ("2024-2025"), à cause d'un scan mirror
// sans fenêtre qui fusionnait les deux campagnes sous la même clé de label.
//
// Fix racine (2026-08) : le grouping est désormais campagne-aware PAR
// CONSTRUCTION (buildDisambiguatedPeriodeMap) — la fusion ne se produit plus
// JAMAIS, même sans fenêtre de 400 jours (qui reste néanmoins en place comme
// filet secondaire pour les tout vieux daily docs).
// ---------------------------------------------------------------------------
test('régression: deux campagnes partageant le même numéro de quinzaine ne fusionnent jamais, même sans fenêtre', () => {
  // Campagne 2024-2025 (juillet 2024 -> juin 2025) : "Quinzaine 15" ~ janvier 2025.
  const oldCampagneDocs = [
    { id: '2025-01-10', rows: [{ Periode_paie: 'Quinzaine 15', DateStr: '2025-01-10' }] },
    { id: '2025-01-11', rows: [{ Periode_paie: 'Quinzaine 15', DateStr: '2025-01-11' }] },
  ];

  // Campagne 2025-2026 (juillet 2025 -> juin 2026) : "Quinzaine 15" ~ janvier 2026.
  // Cas réel signalé par Omar : les deux campagnes sont à quelques mois d'écart,
  // largement < 400 jours — la fenêtre seule ne peut jamais les séparer.
  const newCampagneDocs = [
    { id: '2026-01-10', rows: [{ Periode_paie: 'Quinzaine 15', DateStr: '2026-01-10' }] },
    { id: '2026-01-11', rows: [{ Periode_paie: 'Quinzaine 15', DateStr: '2026-01-11' }] },
  ];

  const allDocs = [...oldCampagneDocs, ...newCampagneDocs];

  // Scan SANS fenêtre (unbounded) : la fusion n'a plus lieu du tout, par construction.
  const { periodeMap, periodeCampagne } = buildPeriodeMapFromDailyDocs(allDocs, campagneOf);

  // La campagne la plus RÉCENTE garde le label tel quel.
  assert.deepStrictEqual(periodeMap['Quinzaine 15'], ['2026-01-10', '2026-01-11']);
  assert.strictEqual(periodeCampagne['Quinzaine 15'], '2025-2026');

  // L'ancienne campagne reçoit un label désambiguïsé, jamais mélangé avec la nouvelle.
  assert.deepStrictEqual(periodeMap['Quinzaine 15 (2024-2025)'], ['2025-01-10', '2025-01-11']);
  assert.strictEqual(periodeCampagne['Quinzaine 15 (2024-2025)'], '2024-2025');

  // Aucune fuite croisée : les dates de chaque clé appartiennent à une seule campagne.
  assert.strictEqual(new Set([...periodeMap['Quinzaine 15'], ...periodeMap['Quinzaine 15 (2024-2025)']]).size, 4);
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
