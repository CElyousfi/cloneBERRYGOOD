'use strict';

/**
 * campagneExportBackend.test.js — vérifie les COPIES BACKEND
 * (functions/lib/campagneExport/campagneExportUtils.js et cultureUtils.js).
 *
 * Ces copies existent car le package déployé des Cloud Functions n'embarque QUE
 * functions/ ; le backend ne doit JAMAIS require('../public/lib/...') (throw
 * "Cannot find module .../public/..." au runtime → TOUTES les CF tombent au
 * chargement). Le test vit ici, à la racine, parce que lui SEUL a le droit de
 * charger les deux arbres à la fois — cf. tests/unit/campagneUtilsBackend.test.js.
 *
 * HISTORIQUE — l'ordre de merge imposé est LEVÉ : les colonnes de suivi
 * budgétaire (LOT 2, puis les budgets d'OPÉRATION de la PR #264) sont
 * désormais sur `main` côté front. Le test n'a donc plus à se contenter de
 * vérifier la PRÉSENCE du bloc budgétaire côté backend : il exige la parité
 * STRICTE (deepStrictEqual) sur l'intégralité des lignes, colonnes budgétaires
 * comprises. `FRONT_HAS_BUDGET` reste asserté explicitement — si le front
 * régressait, le test tomberait rouge au lieu de se dégrader en silence.
 *
 * ⚠️ CE QUE LA PARITÉ NE PROUVE PAS TOUTE SEULE. `buildParcelleBudgetIndex`
 * n'agit que si on lui injecte la règle métier (`familleTotal`/`splitOpKey`) et
 * le référentiel analytique (`resolveGbCode`/`opKey`) : sans eux il DÉGRADE
 * silencieusement, et deux copies dégradées sont parfaitement « à parité » avec
 * quatre colonnes vides. Les fixtures ci-dessous injectent donc ces modules et
 * assertent d'abord que les colonnes sont REMPLIES (`GARDE ANTI-DÉGRADATION`),
 * avant de comparer les deux copies.
 *
 * La chaîne d'équivalence de bout en bout est refermée en trois maillons :
 *   1. ici — les deux copies de campagneExportUtils, à injections égales ;
 *   2. ici — les deux copies d'analytiqueUtils (surface + resolveGbCode/opKey) ;
 *   3. tests/unit/campagneBudgetTab.test.js — le miroir front
 *      `CampagneBudgetTab` vs la source de vérité backend
 *      `functions/lib/campagneBudget/validate.js` (familleTotal, opKey,
 *      splitOpKey sur corpus partagé). C'est ce maillon-là qui autorise le
 *      backend à injecter `validate.js` là où le navigateur injecte son miroir.
 */

const test = require('node:test');
const assert = require('node:assert');

const back = require('../../functions/lib/campagneExport/campagneExportUtils.js');
const front = require('../../public/lib/campagneExportUtils.js');
const backCulture = require('../../functions/lib/campagneExport/cultureUtils.js');
const frontCulture = require('../../public/lib/cultureUtils.js');
const backAnalytique = require('../../functions/lib/campagneExport/analytiqueUtils.js');
const frontAnalytique = require('../../public/lib/analytiqueUtils.js');
// Règle métier du budget : SOURCE DE VÉRITÉ backend, celle que le serveur
// injecte réellement dans buildParcelleBudgetIndex.
const budgetRules = require('../../functions/lib/campagneBudget/validate.js');

/** Le front de ce worktree porte-t-il les colonnes budgétaires ? */
const FRONT_HAS_BUDGET = typeof front.PERCENT_HEADER === 'string';

/** Nombre de colonnes budgétaires. */
const NB_BUDGET_COLS = 4;

// ============================================================================
// Fixtures partagées
// ============================================================================

const PARCELLES = [
  {
    nomSb: 'S12 - YAZMIN', label: 'S12 YAZMIN', ferme: 'F1', ha: 2, totalJh: 45,
    budgets: { 'Récolte': 10 }, jhByFamille: { 'Récolte': 15, 'Travaux du sol': 30 },
  },
  { nomSb: 'F2 ZUTANO', label: 'F2 ZUTANO', ferme: 'BAHIA', ha: 0, totalJh: 12 },
  { nomSb: 'MYRTILLE EXT', label: 'S3 CORINA', ferme: 'F5', ha: 1.5, totalJh: 0 },
];

/** Lignes d'opération d'une feuille parcelle (2 familles, 2 quinzaines). */
const OP_ROWS = [
  {
    famille: 'Travaux du sol', operation: 'Désherbage', code: 'GB01',
    byPeriode: { 'Quinzaine 1': { jh: 30, cout: 3000 } }, total: { jh: 30, cout: 3000 },
  },
  {
    famille: 'Récolte', operation: 'Cueillette', code: 'GB08',
    byPeriode: { 'Quinzaine 2': { jh: 15, cout: 1500 } }, total: { jh: 15, cout: 1500 },
  },
  {
    famille: 'Récolte', operation: 'Tri', code: 'GB08',
    byPeriode: { 'Quinzaine 2': { jh: 5, cout: 500 } }, total: { jh: 5, cout: 500 },
  },
];

const PARCELLE_PARAMS = {
  nomSb: 'S12 - YAZMIN',
  ha: 2,
  culture: 'Framboise',
  campagne: '2025/2026',
  periodes: ['Quinzaine 1', 'Quinzaine 2'],
  famillesOrdered: ['Travaux du sol', 'Récolte'],
  budgets: { 'Récolte': 10 },
  opRows: OP_ROWS,
};

/**
 * Mêmes paramètres, mais budget saisi à la maille OPÉRATION — le cas que la
 * PR #264 a corrigé et que le miroir backend doit reproduire.
 *
 * `Récolte` porte 6 + 3 JH/ha d'opérations : la RÈGLE MÉTIER `familleTotal` dit
 * que le total de famille vaut 9 (les opérations ÉCRASENT la famille), pas 19
 * (jamais la somme des deux niveaux) — c'est l'invariant que la parité doit
 * transporter à l'identique des deux côtés.
 */
const PARCELLE_PARAMS_OPS = Object.assign({}, PARCELLE_PARAMS, {
  budgets: { 'Récolte': 10, 'Travaux du sol': 4 },
  budgetsOperations: {
    'Récolte': { 'GB08::Cueillette': 6, 'GB08::Tri': 3 },
  },
  budgetRules: budgetRules,
  analytique: frontAnalytique,
});

/** Cellules budgétaires (les 4 dernières) d'une ligne. */
function budgetCellsOf(cells) {
  return cells.slice(cells.length - NB_BUDGET_COLS);
}

/** Première ligne d'un `kind` donné. */
function firstOfKind(rows, kind) {
  return rows.filter((r) => r.kind === kind)[0];
}

// ============================================================================
// Surface d'API
// ============================================================================

test('backend campagneExportUtils — toute la surface front est présente', () => {
  Object.keys(front).forEach((k) => {
    assert.ok(k in back, `export manquant côté backend : ${k}`);
    assert.strictEqual(typeof back[k], typeof front[k], `type divergent : ${k}`);
  });
});

test('backend campagneExportUtils — bloc budgétaire (version finale) exposé', () => {
  // Ces exports viennent du LOT 2 : la copie backend DOIT les porter, que la
  // branche front soit mergée ou non.
  ['PERCENT_HEADER', 'percentFmtFor', 'percentColumns', 'sumBudget', 'budgetScope', 'budgetCells']
    .forEach((k) => assert.ok(k in back, `export budgétaire manquant : ${k}`));
  assert.strictEqual(back.PERCENT_HEADER, '% Consommé');
  assert.strictEqual(back.ROW_KIND.NOTE, 'note');
});

// ============================================================================
// Parité des helpers scalaires (inchangés par le LOT 2)
// ============================================================================

test('parité front/backend — haLabel', () => {
  [2, 2.4, 0, -1, null, undefined, 'x', 1.005].forEach((v) => {
    assert.strictEqual(back.haLabel(v), front.haLabel(v), `haLabel(${v})`);
  });
});

test('parité front/backend — numFmtFor', () => {
  [6, 6.5, 11.81, 0, -3.25, NaN, Infinity, '12', null].forEach((v) => {
    assert.strictEqual(back.numFmtFor(v), front.numFmtFor(v), `numFmtFor(${v})`);
  });
});

test('parité front/backend — safeSheetName (dictionnaires indépendants)', () => {
  const noms = ['Synthèse', 'S12/YAZMIN', '', 'A'.repeat(40), 'A'.repeat(40), 'Synthèse'];
  const usedB = {};
  const usedF = {};
  noms.forEach((n, i) => {
    assert.strictEqual(
      back.safeSheetName(n, i, usedB),
      front.safeSheetName(n, i, usedF),
      `safeSheetName(${n})`
    );
  });
});

// ============================================================================
// Parité des constructeurs de lignes
// ============================================================================

test('le front porte bien les colonnes budgétaires (sinon parité en trompe-l’œil)', () => {
  // Garde de l'hypothèse du fichier : si le front les perdait, tous les
  // deepStrictEqual ci-dessous compareraient deux versions dégradées.
  assert.ok(FRONT_HAS_BUDGET, 'le front a perdu le bloc budgétaire');
  assert.strictEqual(front.BUDGET_HEADER.length, NB_BUDGET_COLS);
  assert.deepStrictEqual(back.BUDGET_HEADER, front.BUDGET_HEADER);
});

test('parité front/backend — buildSyntheseRows', () => {
  assert.deepStrictEqual(back.buildSyntheseRows(PARCELLES), front.buildSyntheseRows(PARCELLES));
});

test('parité front/backend — buildParcelleSheetRows', () => {
  assert.deepStrictEqual(
    back.buildParcelleSheetRows(PARCELLE_PARAMS),
    front.buildParcelleSheetRows(PARCELLE_PARAMS)
  );
});

test('parité front/backend — buildParcelleSheetAoA (indentation des opérations)', () => {
  assert.deepStrictEqual(
    back.buildParcelleSheetAoA(PARCELLE_PARAMS),
    front.buildParcelleSheetAoA(PARCELLE_PARAMS)
  );
});

test('parité front/backend — largeurs de colonnes', () => {
  assert.deepStrictEqual(back.syntheseSheetCols(), front.syntheseSheetCols());
  [0, 1, 5].forEach((n) => {
    assert.deepStrictEqual(back.parcelleSheetCols(n), front.parcelleSheetCols(n), `cols(${n})`);
  });
});

// ============================================================================
// COMPORTEMENT des colonnes de budget d'OPÉRATION (PR #264)
// ----------------------------------------------------------------------------
// Sans ces cas, la parité ne dirait rien de plus que « les deux copies portent
// 4 colonnes » : deux index dégradés produisent quatre cellules vides des deux
// côtés, et le test resterait vert alors que le classeur envoyé par WhatsApp
// sortirait sans budget.
// ============================================================================

test('GARDE ANTI-DÉGRADATION — l’index budget backend s’arme réellement', () => {
  const idx = back.buildParcelleBudgetIndex({
    budgets: PARCELLE_PARAMS_OPS.budgets,
    budgetsOperations: PARCELLE_PARAMS_OPS.budgetsOperations,
    budgetRules: budgetRules,
    analytique: backAnalytique,
  });
  assert.strictEqual(idx.hasRules, true,
    'règle métier ou référentiel non reconnus : l’index dégrade et vide les colonnes');
  // RÈGLE MÉTIER : les opérations ÉCRASENT la famille (6 + 3 = 9), jamais 10 ni 19.
  assert.strictEqual(idx.famille('Récolte', 'GB08'), 9);
  assert.strictEqual(idx.operation('GB08', 'Cueillette', 'Récolte'), 6);
  assert.strictEqual(idx.operation('GB08', 'Tri', 'Récolte'), 3);
  // Famille budgétée au seul niveau famille : inchangée.
  assert.strictEqual(idx.famille('Travaux du sol', 'GB01'), 4);
  assert.strictEqual(idx.operation('GB01', 'Désherbage', 'Travaux du sol'), 0);
});

test('backend — les lignes OPÉRATION sortent REMPLIES quand le budget est à cette maille', () => {
  const rows = back.buildParcelleSheetRows(PARCELLE_PARAMS_OPS);
  const ops = rows.filter((r) => r.kind === back.ROW_KIND.OPERATION);
  const cueillette = ops.filter((r) => String(r.cells[0]).indexOf('Cueillette') !== -1)[0];
  assert.ok(cueillette, 'ligne Cueillette absente');
  // 6 JH/ha × 2 ha = 12 JH budgétés, 15 réalisés → 125 %, restants NÉGATIFS
  // (le dépassement n'est jamais plafonné).
  assert.deepStrictEqual(budgetCellsOf(cueillette.cells), [6, 1.25, -1.5, -3]);
  // Ligne d'une famille budgétée au seul niveau famille → 4 cellules VIDES,
  // jamais 0 ni 100 % (l'alignement des colonnes est conservé).
  const desherbage = ops.filter((r) => String(r.cells[0]).indexOf('Désherbage') !== -1)[0];
  assert.deepStrictEqual(budgetCellsOf(desherbage.cells), ['', '', '', '']);
});

test('backend — le Total famille applique familleTotal, pas la saisie brute', () => {
  const rows = back.buildParcelleSheetRows(PARCELLE_PARAMS_OPS);
  const totaux = rows.filter((r) => r.kind === back.ROW_KIND.TOTAL_FAMILLE);
  const recolte = totaux.filter((r) => String(r.cells[0]).indexOf('Récolte') !== -1)[0];
  // 9 JH/ha (opérations) × 2 ha = 18 JH ; 20 JH réalisés → 111,11 %.
  // Lire `budgets['Récolte']` (10) donnerait 100 % : c'est le bug de #264.
  assert.strictEqual(budgetCellsOf(recolte.cells)[0], 9);
});

test('parité front/backend — budgets d’OPÉRATION (rows, AoA)', () => {
  // Injections IDENTIQUES des deux côtés : ce test isole la seule divergence
  // possible, celle des deux copies de campagneExportUtils.
  assert.deepStrictEqual(
    back.buildParcelleSheetRows(PARCELLE_PARAMS_OPS),
    front.buildParcelleSheetRows(PARCELLE_PARAMS_OPS)
  );
  assert.deepStrictEqual(
    back.buildParcelleSheetAoA(PARCELLE_PARAMS_OPS),
    front.buildParcelleSheetAoA(PARCELLE_PARAMS_OPS)
  );
});

test('parité front/backend — buildParcelleBudgetIndex (famille, opération, périmètre)', () => {
  const args = {
    budgets: PARCELLE_PARAMS_OPS.budgets,
    budgetsOperations: PARCELLE_PARAMS_OPS.budgetsOperations,
    budgetRules: budgetRules,
    analytique: frontAnalytique,
  };
  const b = back.buildParcelleBudgetIndex(args);
  const f = front.buildParcelleBudgetIndex(args);
  assert.strictEqual(b.hasRules, f.hasRules);
  [['Récolte', 'GB08'], ['Travaux du sol', 'GB01'], ['Inconnue', null]].forEach((c) => {
    assert.strictEqual(b.famille(c[0], c[1]), f.famille(c[0], c[1]), `famille(${c[0]})`);
  });
  [['GB08', 'Cueillette', 'Récolte'], ['GB08', 'Tri', 'Récolte'],
    ['GB01', 'Désherbage', 'Travaux du sol'], ['GB08', 'Inconnue', 'Récolte']].forEach((c) => {
    assert.strictEqual(b.operation(c[0], c[1], c[2]), f.operation(c[0], c[1], c[2]),
      `operation(${c.join(', ')})`);
  });
  assert.deepStrictEqual(
    b.resolveFamilles(OP_ROWS, PARCELLE_PARAMS.famillesOrdered),
    f.resolveFamilles(OP_ROWS, PARCELLE_PARAMS.famillesOrdered)
  );
});

test('parité front/backend — index DÉGRADÉ (sans règle ni référentiel)', () => {
  // Le repli historique doit être identique des deux côtés : budget de famille
  // lu par son nom exact, aucune ligne d'opération budgétée. Jamais un budget
  // deviné parce qu'un module manque.
  const args = { budgets: { 'Récolte': 10 }, budgetsOperations: { 'Récolte': { 'GB08::Tri': 3 } } };
  const b = back.buildParcelleBudgetIndex(args);
  const f = front.buildParcelleBudgetIndex(args);
  assert.strictEqual(b.hasRules, false);
  assert.strictEqual(f.hasRules, false);
  assert.strictEqual(b.famille('Récolte'), f.famille('Récolte'));
  assert.strictEqual(b.operation('GB08', 'Tri', 'Récolte'), f.operation('GB08', 'Tri', 'Récolte'));
  assert.deepStrictEqual(
    b.resolveFamilles(OP_ROWS, PARCELLE_PARAMS.famillesOrdered),
    f.resolveFamilles(OP_ROWS, PARCELLE_PARAMS.famillesOrdered)
  );
});

test('parité front/backend — Synthèse alimentée par les budgets EFFECTIFS', () => {
  // Ce que fait buildCultureWorkbook des deux côtés : la Synthèse reçoit
  // `resolveFamilles(...).scope`, pas la saisie brute.
  function syntheseOf(mod, analytique) {
    const idx = mod.buildParcelleBudgetIndex({
      budgets: PARCELLE_PARAMS_OPS.budgets,
      budgetsOperations: PARCELLE_PARAMS_OPS.budgetsOperations,
      budgetRules: budgetRules,
      analytique: analytique,
    });
    return mod.buildSyntheseRows([{
      nomSb: 'S12 - YAZMIN', label: 'S12 YAZMIN', ferme: 'F1', ha: 2, totalJh: 50,
      budgets: idx.resolveFamilles(OP_ROWS, PARCELLE_PARAMS.famillesOrdered).scope,
      jhByFamille: { 'Récolte': 20, 'Travaux du sol': 30 },
    }]);
  }
  const b = syntheseOf(back, backAnalytique);
  assert.deepStrictEqual(b, syntheseOf(front, frontAnalytique));
  // Et les colonnes sont bien RENSEIGNÉES : budget effectif 9 + 4 = 13 JH/ha.
  const data = firstOfKind(b, back.ROW_KIND.DATA);
  assert.strictEqual(budgetCellsOf(data.cells)[0], 13);
});

test('backend — largeurs de colonnes alignées sur la ligne COL_HEADER', () => {
  // Contrat du renderer : la largeur des bandeaux pleine largeur vient de
  // cols.length. Un décalage donnerait un aplat tronqué.
  const rows = back.buildParcelleSheetRows(PARCELLE_PARAMS);
  const header = rows.filter((r) => r.kind === back.ROW_KIND.COL_HEADER)[0];
  assert.strictEqual(back.parcelleSheetCols(PARCELLE_PARAMS.periodes.length).length,
    header.cells.length);
  const sRows = back.buildSyntheseRows(PARCELLES);
  const sHeader = sRows.filter((r) => r.kind === back.ROW_KIND.COL_HEADER)[0];
  assert.strictEqual(back.syntheseSheetCols().length, sHeader.cells.length);
});

// ============================================================================
// analytiqueUtils — copie backend. C'est l'INJECTION que le serveur passe à
// buildParcelleBudgetIndex : si sa résolution de code GB dévie de celle du
// navigateur, la jointure budget↔réalisé rate SANS ERREUR et les colonnes
// sortent vides côté serveur seulement.
// ============================================================================

test('parité front/backend — analytiqueUtils : surface identique', () => {
  assert.deepStrictEqual(
    Object.keys(backAnalytique).sort(), Object.keys(frontAnalytique).sort()
  );
  assert.deepStrictEqual(backAnalytique.GB_ORDER, frontAnalytique.GB_ORDER);
  assert.deepStrictEqual(backAnalytique.GB_GROUPE_MAP, frontAnalytique.GB_GROUPE_MAP);
});

test('parité front/backend — analytiqueUtils : resolveGbCode / opKey / opLabel', () => {
  const cas = [
    ['GB08', 'Récolte'], ['gb08 ', null], [null, '8. Récolte'],
    [null, 'Services généraux'], [null, 'Service générale'], [null, 'Service general'],
    [null, 'Ferti-irrigation'], [null, 'Ferti Irrigation'], [null, 'Entretien Structure'],
    ['R01', 'Récolte'], ['XX', 'Inconnue'], [null, null], ['', ''],
    [null, 'Tuteurage & palissage GB07'],
  ];
  cas.forEach((c) => {
    assert.strictEqual(
      backAnalytique.resolveGbCode(c[0], c[1]), frontAnalytique.resolveGbCode(c[0], c[1]),
      `resolveGbCode(${c[0]}, ${c[1]})`
    );
    assert.strictEqual(
      backAnalytique.resolveGroupeFamille(c[0], c[1]),
      frontAnalytique.resolveGroupeFamille(c[0], c[1]),
      `resolveGroupeFamille(${c[0]}, ${c[1]})`
    );
  });
  ['Cueillette', '8. Récolte', 'Ferti-irrigation', '  Tri  ', 'Entretien_structure', '', null]
    .forEach((v) => {
      assert.strictEqual(backAnalytique.opKey(v), frontAnalytique.opKey(v), `opKey(${v})`);
      assert.strictEqual(backAnalytique.opLabel(v), frontAnalytique.opLabel(v), `opLabel(${v})`);
    });
});

// ============================================================================
// cultureUtils — copie backend, parité STRICTE (aucun changement en cours)
// ============================================================================

test('parité front/backend — cultureUtils : surface identique', () => {
  assert.deepStrictEqual(Object.keys(backCulture).sort(), Object.keys(frontCulture).sort());
  assert.deepStrictEqual(backCulture.CULTURES, frontCulture.CULTURES);
});

test('parité front/backend — cultureUtils : normCulture / resolveCulture / matchesCulture', () => {
  const sbMap = {
    'S12 YAZMIN': { culture_sb: 'Framboise', nom_sb: 'MYRTILLE EXTENSION' },
    'S3 CORINA': {},
  };
  const cas = [
    { label: 'S12 YAZMIN' },
    { label: 'S3 CORINA' },
    { label: 'F2 ZUTANO' },
    { label: 'PARCELLE X', culture: 'BLUEBERRY' },
    { Parcelle_Physique: 'BREEDER' },
    null,
    {},
  ];
  cas.forEach((p) => {
    assert.strictEqual(
      backCulture.resolveCulture(p, sbMap), frontCulture.resolveCulture(p, sbMap),
      `resolveCulture(${JSON.stringify(p)})`
    );
    ['', 'Framboise', 'Myrtille', 'Avocatier'].forEach((f) => {
      assert.strictEqual(
        backCulture.matchesCulture(p, f, sbMap), frontCulture.matchesCulture(p, f, sbMap),
        `matchesCulture(${JSON.stringify(p)}, ${f})`
      );
    });
  });
  ['MYRTILLE', 'HASS', 'ZUTANO', '', null, 'BREEDER'].forEach((v) => {
    assert.strictEqual(backCulture.normCulture(v), frontCulture.normCulture(v), `normCulture(${v})`);
  });
});

test('backend cultureUtils — nom_sb n’est JAMAIS une source de culture', () => {
  // Piège prod : 'S12 - YAZMIN' (framboise) est nommée 'MYRTILLE EXTENSION'.
  const sbMap = { 'S12 YAZMIN': { nom_sb: 'MYRTILLE EXTENSION' } };
  assert.strictEqual(backCulture.resolveCulture({ label: 'S12 YAZMIN' }, sbMap), 'Framboise');
});
