'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  buildDisambiguatedPeriodeMap,
  splitCompositeLabel,
  filterRowsByExactDates,
  buildPeriodeCampagne,
  sortPeriodesByCampagne,
} = require('../campagnePeriodes');
const { campagneOf } = require('../../mappingConso/campagneUtils');

// ---------------------------------------------------------------------------
// splitCompositeLabel
// ---------------------------------------------------------------------------

test('splitCompositeLabel: label simple -> non composite, rawLabel = label', () => {
  const r = splitCompositeLabel('Quinzaine 15');
  assert.deepStrictEqual(r, { rawLabel: 'Quinzaine 15', campagne: null, isComposite: false });
});

test('splitCompositeLabel: label composite -> extrait le label brut et la campagne', () => {
  const r = splitCompositeLabel('Quinzaine 15 (2024-2025)');
  assert.deepStrictEqual(r, { rawLabel: 'Quinzaine 15', campagne: '2024-2025', isComposite: true });
});

test('splitCompositeLabel: label vide/nullish -> ne plante pas', () => {
  assert.deepStrictEqual(splitCompositeLabel(''), { rawLabel: '', campagne: null, isComposite: false });
  assert.deepStrictEqual(splitCompositeLabel(undefined), { rawLabel: '', campagne: null, isComposite: false });
});

// ---------------------------------------------------------------------------
// filterRowsByExactDates
// ---------------------------------------------------------------------------

test('filterRowsByExactDates: ne garde que les rows dont DateStr est dans la liste', () => {
  const rows = [{ DateStr: '2026-01-10' }, { DateStr: '2025-01-10' }, { DateStr: '2026-01-11' }];
  const out = filterRowsByExactDates(rows, ['2026-01-10', '2026-01-11']);
  assert.deepStrictEqual(out, [{ DateStr: '2026-01-10' }, { DateStr: '2026-01-11' }]);
});

test('filterRowsByExactDates: dates absente/non-array -> no-op (retourne rows tel quel)', () => {
  const rows = [{ DateStr: '2026-01-10' }];
  assert.deepStrictEqual(filterRowsByExactDates(rows, undefined), rows);
  assert.deepStrictEqual(filterRowsByExactDates(rows, null), rows);
});

// ---------------------------------------------------------------------------
// buildDisambiguatedPeriodeMap — cas nominal (non-régression)
// ---------------------------------------------------------------------------

test('buildDisambiguatedPeriodeMap: 1 seule campagne par label -> sortie identique au comportement historique', () => {
  const entries = [
    { label: 'Quinzaine 17', date: '2026-03-01' },
    { label: 'Quinzaine 17', date: '2026-03-02' },
    { label: 'Quinzaine 18', date: '2026-03-15' },
  ];
  const { periodeMap, periodeCampagne } = buildDisambiguatedPeriodeMap(entries, campagneOf);
  assert.deepStrictEqual(periodeMap, {
    'Quinzaine 17': ['2026-03-01', '2026-03-02'],
    'Quinzaine 18': ['2026-03-15'],
  });
  assert.deepStrictEqual(periodeCampagne, {
    'Quinzaine 17': '2025-2026',
    'Quinzaine 18': '2025-2026',
  });
});

test('buildDisambiguatedPeriodeMap: entrées vides/invalides ignorées, jamais de crash', () => {
  const entries = [null, { label: '', date: '2026-01-01' }, { label: 'Quinzaine 1', date: '' }, undefined];
  const { periodeMap, periodeCampagne } = buildDisambiguatedPeriodeMap(entries, campagneOf);
  assert.deepStrictEqual(periodeMap, {});
  assert.deepStrictEqual(periodeCampagne, {});
});

// ---------------------------------------------------------------------------
// buildDisambiguatedPeriodeMap — cas collision (LE bug réel signalé par Omar)
// ---------------------------------------------------------------------------

test('buildDisambiguatedPeriodeMap: collision 2 campagnes (< 400 jours d’écart) -> désambiguïsation, aucune fusion', () => {
  // Campagne 2024-2025 : "Quinzaine 15" ~ janvier 2025.
  // Campagne 2025-2026 : "Quinzaine 15" ~ janvier 2026 (< 400 jours plus tard, cas réel).
  const entries = [
    { label: 'Quinzaine 15', date: '2025-01-10' },
    { label: 'Quinzaine 15', date: '2025-01-11' },
    { label: 'Quinzaine 15', date: '2026-01-10' },
    { label: 'Quinzaine 15', date: '2026-01-11' },
    // Un label non ambigu doit rester inchangé à côté du label en collision.
    { label: 'Quinzaine 16', date: '2026-01-24' },
  ];
  const { periodeMap, periodeCampagne } = buildDisambiguatedPeriodeMap(entries, campagneOf);

  // La campagne la plus RÉCENTE garde le label tel quel (compat rétroactive maximale).
  assert.deepStrictEqual(periodeMap['Quinzaine 15'], ['2026-01-10', '2026-01-11']);
  assert.strictEqual(periodeCampagne['Quinzaine 15'], '2025-2026');

  // L'ANCIENNE campagne est désambiguïsée avec un suffixe " (AAAA-BBBB)".
  assert.deepStrictEqual(periodeMap['Quinzaine 15 (2024-2025)'], ['2025-01-10', '2025-01-11']);
  assert.strictEqual(periodeCampagne['Quinzaine 15 (2024-2025)'], '2024-2025');

  // Label non ambigu inchangé.
  assert.deepStrictEqual(periodeMap['Quinzaine 16'], ['2026-01-24']);
  assert.strictEqual(periodeCampagne['Quinzaine 16'], '2025-2026');

  // Exactement 3 clés en sortie (2 + 1), aucune clé fantôme.
  assert.strictEqual(Object.keys(periodeMap).length, 3);

  // Jeux de dates strictement disjoints entre les deux occurrences du même numéro.
  const a = new Set(periodeMap['Quinzaine 15']);
  const b = new Set(periodeMap['Quinzaine 15 (2024-2025)']);
  for (const d of a) assert.ok(!b.has(d), `date ${d} ne doit pas être dans les deux jeux`);
});

test('buildDisambiguatedPeriodeMap: collision à 3 campagnes -> seule la plus récente garde le label brut', () => {
  const entries = [
    { label: 'Quinzaine 05', date: '2023-09-01' }, // 2023-2024
    { label: 'Quinzaine 05', date: '2024-09-01' }, // 2024-2025
    { label: 'Quinzaine 05', date: '2025-09-01' }, // 2025-2026 (la plus récente)
  ];
  const { periodeMap, periodeCampagne } = buildDisambiguatedPeriodeMap(entries, campagneOf);
  assert.deepStrictEqual(Object.keys(periodeMap).sort(), [
    'Quinzaine 05',
    'Quinzaine 05 (2023-2024)',
    'Quinzaine 05 (2024-2025)',
  ]);
  assert.strictEqual(periodeCampagne['Quinzaine 05'], '2025-2026');
  assert.strictEqual(periodeCampagne['Quinzaine 05 (2023-2024)'], '2023-2024');
  assert.strictEqual(periodeCampagne['Quinzaine 05 (2024-2025)'], '2024-2025');
});

// ---------------------------------------------------------------------------
// Résolution de requête (point 3 du fix) : filtrer par dates exactes après un
// matching par label brut, pour ne jamais laisser fuiter les lignes d'une
// autre campagne partageant le même numéro de quinzaine.
// ---------------------------------------------------------------------------

test('résolution de requête: matcher par label brut PUIS filtrer par dates exactes -> jeux disjoints', () => {
  const entries = [
    { label: 'Quinzaine 15', date: '2025-01-10' },
    { label: 'Quinzaine 15', date: '2026-01-10' },
  ];
  const { periodeMap } = buildDisambiguatedPeriodeMap(entries, campagneOf);

  // Simule des "lignes SQL/mirror" candidates matchées par LABEL BRUT seul (donc
  // ambiguës — mélangent les deux campagnes, comme le ferait une requête SQL
  // WHERE Periode_paie = 'Quinzaine 15' sans filtre de date).
  const candidateRowsFromRawLabelMatch = [
    { Personnel_Matricule: 'A', DateStr: '2025-01-10' }, // vieille campagne
    { Personnel_Matricule: 'B', DateStr: '2026-01-10' }, // campagne courante
  ];

  // Demande de la quinzaine ANCIENNE désambiguïsée -> extraction du label brut...
  const { rawLabel, isComposite } = splitCompositeLabel('Quinzaine 15 (2024-2025)');
  assert.strictEqual(rawLabel, 'Quinzaine 15');
  assert.ok(isComposite);

  // ...puis filtrage par la liste de dates EXACTE issue de periodeMap[label composite].
  const oldCampagneRows = filterRowsByExactDates(candidateRowsFromRawLabelMatch, periodeMap['Quinzaine 15 (2024-2025)']);
  assert.deepStrictEqual(oldCampagneRows, [{ Personnel_Matricule: 'A', DateStr: '2025-01-10' }]);

  // Demande de la quinzaine COURANTE (label plain, non composite) -> pas de filtre nécessaire,
  // mais si on l'applique quand même (garde-fou), le résultat reste correct.
  const currentRows = filterRowsByExactDates(candidateRowsFromRawLabelMatch, periodeMap['Quinzaine 15']);
  assert.deepStrictEqual(currentRows, [{ Personnel_Matricule: 'B', DateStr: '2026-01-10' }]);

  // Les deux jeux de résultats sont bien disjoints.
  assert.strictEqual(
    oldCampagneRows.some((r) => currentRows.includes(r)),
    false
  );
});

// ---------------------------------------------------------------------------
// Garder les tests existants sur buildPeriodeCampagne / sortPeriodesByCampagne
// (comportement legacy, toujours utilisé en fallback à la volée dans
// pointageService.js quand meta.periodeCampagne est absent du meta Firestore).
// ---------------------------------------------------------------------------

test('buildPeriodeCampagne: legacy, toujours fonctionnel pour un periodeMap déjà désambiguïsé', () => {
  const periodeMap = {
    'Quinzaine 15': ['2026-01-10', '2026-01-11'],
    'Quinzaine 15 (2024-2025)': ['2025-01-10', '2025-01-11'],
  };
  const periodeCampagne = buildPeriodeCampagne(periodeMap, campagneOf);
  assert.strictEqual(periodeCampagne['Quinzaine 15'], '2025-2026');
  assert.strictEqual(periodeCampagne['Quinzaine 15 (2024-2025)'], '2024-2025');
});

test('sortPeriodesByCampagne: labels composites triés comme des chaînes opaques (pas de parsing de format)', () => {
  const periodeCampagne = {
    'Quinzaine 15': '2025-2026',
    'Quinzaine 15 (2024-2025)': '2024-2025',
    'Quinzaine 16': '2025-2026',
  };
  const sorted = sortPeriodesByCampagne(Object.keys(periodeCampagne), periodeCampagne);
  // Campagne DESC puis numéro DESC : 2025-2026 (16 puis 15) avant 2024-2025.
  assert.deepStrictEqual(sorted, ['Quinzaine 16', 'Quinzaine 15', 'Quinzaine 15 (2024-2025)']);
});
