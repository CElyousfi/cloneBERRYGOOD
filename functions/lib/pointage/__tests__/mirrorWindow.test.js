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

// ---------------------------------------------------------------------------
// Bug report Omar 2026-08-06 (crash après clic "Sync BEE ONE" en prod) :
// couvre le chemin RÉEL de rebuildPointageMetaFromMirror() sur un jeu de
// données volumineux/réaliste, PAS les fixtures minimalistes ci-dessus.
// Plusieurs campagnes de tailles très différentes (24 quinzaines vs 3),
// beaucoup de matricules/lignes par jour, plusieurs jours par quinzaine,
// des lignes malformées réalistes (Periode_paie manquant, DateStr null,
// doublons exacts). Doit produire une structure cohérente SANS EXCEPTION.
// ---------------------------------------------------------------------------
test('buildPeriodeMapFromDailyDocs: jeu de données volumineux réaliste (3 campagnes de tailles très différentes) → aucune exception', () => {
  const dailyDocs = [];

  // Campagne 2024-2025 : 24 quinzaines complètes, ~15 jours chacune, ~40 lignes/jour.
  // Campagne 2025-2026 : 24 quinzaines complètes (même volume).
  // Campagne 2026-2027 (COURANTE, en cours) : seulement 3 quinzaines (peu de données).
  const campagnes = [
    { anneeDebut: 2024, quinzaines: 24 },
    { anneeDebut: 2025, quinzaines: 24 },
    { anneeDebut: 2026, quinzaines: 3 },
  ];

  function addDaysIso(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00.000Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  for (const camp of campagnes) {
    // 1er juillet de l'année de début = premier jour de la campagne.
    let cursor = `${camp.anneeDebut}-07-01`;
    for (let q = 1; q <= camp.quinzaines; q++) {
      const label = `Quinzaine ${String(q).padStart(2, '0')}`;
      for (let j = 0; j < 15; j++) {
        const dateStr = addDaysIso(cursor, j);
        const rows = [];
        for (let m = 0; m < 40; m++) {
          rows.push({
            Periode_paie: label,
            DateStr: dateStr,
            Personnel_Matricule: `M${camp.anneeDebut}-${m}`,
          });
        }
        // Lignes malformées réalistes intercalées : Periode_paie vide/absent,
        // DateStr null, doublon exact — ne doivent jamais faire planter le groupement.
        rows.push({ Periode_paie: '', DateStr: dateStr });
        rows.push({ Periode_paie: label, DateStr: null });
        rows.push({ Periode_paie: label, DateStr: undefined });
        rows.push(null);
        rows.push({});
        rows.push({ Periode_paie: label, DateStr: dateStr }); // doublon exact (dédupliqué par Set)
        dailyDocs.push({ id: dateStr, rows });
      }
      cursor = addDaysIso(cursor, 15);
    }
  }

  assert.doesNotThrow(() => {
    const { periodeMap, periodeCampagne } = buildPeriodeMapFromDailyDocs(dailyDocs, campagneOf);

    // 24 + 24 + 3 quinzaines au total, mais "Quinzaine 01".."Quinzaine 03" sont
    // en collision entre les 3 campagnes → désambiguïsation : 2 occurrences
    // suffixées par numéro en collision (les 2 plus anciennes), 1 (la plus
    // récente, 2026-2027) garde le label brut. Les numéros 04-24 n'existent que
    // dans les 2 anciennes campagnes → pas de collision, pas de suffixe.
    for (let q = 1; q <= 3; q++) {
      const label = `Quinzaine ${String(q).padStart(2, '0')}`;
      assert.ok(periodeMap[label], `${label} (campagne la plus récente) doit exister sans suffixe`);
      assert.strictEqual(periodeCampagne[label], '2026-2027');
      assert.ok(periodeMap[`${label} (2025-2026)`], `${label} (2025-2026) doit être désambiguïsée`);
      assert.ok(periodeMap[`${label} (2024-2025)`], `${label} (2024-2025) doit être désambiguïsée`);
    }
    for (let q = 4; q <= 24; q++) {
      const label = `Quinzaine ${String(q).padStart(2, '0')}`;
      // Pas de collision sur ces numéros (absents de 2026-2027) → label brut = campagne la plus récente PARMI les 2 qui le portent (2025-2026).
      assert.strictEqual(periodeCampagne[label], '2025-2026');
      assert.ok(periodeMap[`${label} (2024-2025)`]);
    }

    // Aucune date malformée (null/undefined/vide) n'a fuité dans les dates de sortie.
    for (const dates of Object.values(periodeMap)) {
      for (const d of dates) assert.strictEqual(typeof d, 'string');
    }
  });
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
