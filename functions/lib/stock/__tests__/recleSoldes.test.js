'use strict';

const test = require('node:test');
const assert = require('node:assert');

const recle = require('../recleSoldes');
const identite = require('../identiteArticle');
const reunionSoldes = require('../../stockMerge/reunionSoldes');

/** Catalogue minimal : 3 fiches actives + 1 fusionnée. */
const CATALOGUE = [
  { id: 'IMP-019', nom: 'NITRETE DE POTASSE', active: true },
  { id: 'IMP-005', nom: 'AZO PRO 31', active: true },
  { id: 'IMP-001', nom: 'ACIDE SULFRIQUE', active: true },
  { id: 'IMP-900', nom: 'AZO PRO 31 ANCIEN', active: false, merged_into: 'IMP-005' },
];

const S = (docId, article_ref, balance, extra) =>
  Object.assign({ docId, article_ref, lieu_type: 'magasin', lieu_id: 'F2', balance, unite: 'kg' }, extra || {});

// ── L'EFFET ATTENDU, cas par cas ────────────────────────────────────────────

test('déjà canonique — aucun déplacement, aucune suppression', () => {
  const p = recle.planifierRecle([S('magasin_F2_IMP-019', 'IMP-019', 100)], CATALOGUE);
  assert.strictEqual(p.deplacements.length, 0);
  assert.strictEqual(p.reunions.length, 0);
  assert.strictEqual(p.deja_canoniques.length, 1);
  assert.deepStrictEqual(p.deja_canoniques[0].supprimes, []);
});

test('libellé brut sans cible existante — DÉPLACEMENT, solde conservé à l\'unité près', () => {
  const p = recle.planifierRecle(
    [S('magasin_F2_NITRETE_DE_POTASSE', 'NITRETE DE POTASSE', 9754)],
    CATALOGUE
  );
  assert.strictEqual(p.deplacements.length, 1);
  const c = p.deplacements[0];
  assert.strictEqual(c.conserve, 'magasin_F2_IMP-019');
  assert.deepStrictEqual(c.supprimes, ['magasin_F2_NITRETE_DE_POTASSE']);
  assert.strictEqual(c.total, 9754);
  const cible = recle.documentCible(c.docs[0], { ficheId: c.article_id, nom: c.article_nom });
  assert.strictEqual(cible.balance, 9754, 'un déplacement ne recalcule rien');
  assert.strictEqual(cible.article_ref, 'IMP-019', 'l\'identité devient le docId de la fiche');
});

test('déplacement — article_nom garde le libellé lu, il ne devient pas le nom de fiche', () => {
  const cible = recle.documentCible(
    S('magasin_F2_X', 'NITRETE DE POTASSE', 10, { article_nom: 'Nitrate de potasse (sac)' }),
    { ficheId: 'IMP-019', nom: 'NITRETE DE POTASSE' }
  );
  assert.strictEqual(cible.article_nom, 'Nitrate de potasse (sac)');
});

test('la cible existe déjà — RÉUNION : on SOMME, on ne choisit pas', () => {
  const p = recle.planifierRecle(
    [S('magasin_F2_AZO_PRO_31', 'AZO PRO 31', 3770), S('magasin_F2_IMP-005', 'IMP-005', 230)],
    CATALOGUE
  );
  assert.strictEqual(p.reunions.length, 1);
  const c = p.reunions[0];
  assert.strictEqual(c.conserve, 'magasin_F2_IMP-005');
  assert.strictEqual(c.total, 4000, 'le total est la SOMME des fragments');
  assert.strictEqual(recle.incrementConserve(c), 3770, 'incrément = somme des ABSORBÉS');
  assert.deepStrictEqual(c.supprimes, ['magasin_F2_AZO_PRO_31']);
});

test('réunion — le total n\'est jamais le plus gros fragment ni le premier', () => {
  const p = recle.planifierRecle(
    [S('magasin_F2_IMP-001', 'IMP-001', 1000), S('magasin_F2_ACIDE_SULFRIQUE', 'ACIDE SULFRIQUE (L)', 2420)],
    CATALOGUE
  );
  const c = p.reunions[0];
  assert.strictEqual(c.total, 3420);
  assert.notStrictEqual(c.total, 2420);
  assert.notStrictEqual(c.total, 1000);
});

test('deux libellés distincts vers une cible ABSENTE — réunion, cible créée', () => {
  const p = recle.planifierRecle(
    [S('magasin_F2_AZO_PRO_31', 'AZO PRO 31', 10), S('magasin_F2_AZO_PRO_31_KG', 'AZO PRO 31 (KG)', 5)],
    CATALOGUE
  );
  assert.strictEqual(p.reunions.length, 1);
  assert.strictEqual(p.reunions[0].conserve, 'magasin_F2_IMP-005');
  assert.strictEqual(p.reunions[0].total, 15);
  assert.strictEqual(recle.incrementConserve(p.reunions[0]), 15, 'aucun fragment n\'est déjà sur la cible');
});

test('chaîne merged_into suivie — le solde de la fiche absorbée rejoint le maître', () => {
  const p = recle.planifierRecle([S('magasin_F2_IMP-900', 'IMP-900', 42)], CATALOGUE);
  assert.strictEqual(p.deplacements.length, 1);
  assert.strictEqual(p.deplacements[0].conserve, 'magasin_F2_IMP-005');
});

// ── FAIL-CLOSED SUR LES UNITÉS ──────────────────────────────────────────────

test('unités divergentes — BLOQUÉ, jamais sommé', () => {
  const p = recle.planifierRecle(
    [
      S('magasin_F2_AZO_PRO_31', 'AZO PRO 31', 10, { unite: 'l' }),
      S('magasin_F2_IMP-005', 'IMP-005', 5, { unite: 'kg' }),
    ],
    CATALOGUE
  );
  assert.strictEqual(p.reunions.length, 0, 'un cas à unités divergentes n\'est JAMAIS exécutable');
  assert.strictEqual(p.bloques.length, 1);
  assert.match(p.bloques[0].anomalies[0], /unités divergentes/);
});

test('unité absente d\'un côté — ce n\'est pas une divergence', () => {
  assert.deepStrictEqual(recle.anomaliesUnites([{ unite: 'kg' }, { unite: '' }, {}]), []);
  assert.deepStrictEqual(recle.anomaliesUnites([{ unite: 'KG' }, { unite: ' kg ' }]), []);
});

test('ACCORD CROISÉ — recleSoldes et reunionSoldes bloquent les MÊMES unités', () => {
  // Les deux modules doivent refuser exactement les mêmes cas : si l'un se
  // relâche, la re-clé sommerait ce que la réunion refuse (ou l'inverse).
  const jeux = [
    [{ unite: 'kg' }, { unite: 'l' }],
    [{ unite: 'kg' }, { unite: 'kg' }],
    [{ unite: '' }, { unite: 'kg' }],
    [{ unite: 'L' }, { unite: 'l' }],
    [{ unite: 'kg' }, { unite: 'l' }, { unite: 'g' }],
  ];
  for (const docs of jeux) {
    const soldes = docs.map((d, i) =>
      S('magasin_F2_frag' + i, i === 0 ? 'AZO PRO 31' : 'IMP-005', 1, { unite: d.unite })
    );
    const monRefus = recle.anomaliesUnites(soldes).length > 0;
    const sonPlan = reunionSoldes.planifierReunion(soldes, CATALOGUE);
    const sonRefus = sonPlan.cas.length > 0 && sonPlan.cas[0].anomalies.length > 0;
    assert.strictEqual(
      monRefus,
      sonRefus,
      'désaccord de fail-closed sur ' + JSON.stringify(docs.map((d) => d.unite))
    );
  }
});

// ── ORPHELINS ───────────────────────────────────────────────────────────────

test('libellé sans fiche — ORPHELIN laissé en place, jamais supprimé', () => {
  const p = recle.planifierRecle([S('magasin_F2_TES', 'TES', 6)], CATALOGUE);
  assert.strictEqual(p.orphelins.length, 1);
  assert.deepStrictEqual(p.orphelins[0].supprimes, [], 'un orphelin n\'est JAMAIS supprimé');
  assert.strictEqual(p.orphelins[0].conserve, 'magasin_F2_TES', 'il reste sous sa clé actuelle');
  assert.strictEqual(p.deplacements.length, 0);
  assert.strictEqual(p.reunions.length, 0);
});

test('identité ambiguë — orphelin, pas un choix arbitraire', () => {
  const cat = CATALOGUE.concat([{ id: 'IMP-777', nom: 'azo  pro 31', active: true }]);
  const p = recle.planifierRecle([S('magasin_F2_AZO_PRO_31', 'AZO PRO 31', 10)], cat);
  assert.strictEqual(p.orphelins.length, 1);
  assert.match(p.orphelins[0].anomalies[0], /fiches actives/);
  assert.strictEqual(p.deplacements.length, 0);
});

test('aucun orphelin n\'apparaît dans les listes exécutables', () => {
  const p = recle.planifierRecle(
    [S('magasin_F2_TES', 'TES', 6), S('magasin_F2_NITRETE_DE_POTASSE', 'NITRETE DE POTASSE', 1)],
    CATALOGUE
  );
  const executables = p.deplacements.concat(p.reunions);
  for (const c of executables) assert.notStrictEqual(c.issue, recle.ISSUE_ORPHELIN);
  assert.strictEqual(executables.length, 1);
});

// ── LA NORMALISATION EST `canon`, PAS `normalizeArticleName` ────────────────

test('le suffixe d\'unité est retiré — c\'est ce que `canon` fait et pas `normalizeArticleName`', () => {
  const p = recle.planifierRecle([S('magasin_F2_ACIDE_SULFRIQUE_L', 'ACIDE SULFRIQUE (L)', 3420)], CATALOGUE);
  assert.strictEqual(
    p.deplacements.length,
    1,
    '« ACIDE SULFRIQUE (L) » doit se rattacher à la fiche « ACIDE SULFRIQUE »'
  );
  assert.strictEqual(p.deplacements[0].conserve, 'magasin_F2_IMP-001');
  assert.strictEqual(p.orphelins.length, 0);
});

test('la résolution est bien celle de identiteArticle (même issue, même fiche)', () => {
  const idx = identite.indexerFiches(CATALOGUE);
  const r = identite.resoudreIdentite('AZO PRO 31 (KG)', idx);
  assert.strictEqual(r.issue, identite.ISSUE_RESOLU);
  const p = recle.planifierRecle([S('magasin_F2_AZO_PRO_31_KG', 'AZO PRO 31 (KG)', 1)], CATALOGUE);
  assert.strictEqual(p.deplacements[0].article_id, r.ficheId);
});

// ── LIEUX ───────────────────────────────────────────────────────────────────

test('deux lieux différents ne se réunissent pas', () => {
  const p = recle.planifierRecle(
    [
      S('magasin_F2_AZO_PRO_31', 'AZO PRO 31', 10),
      S('externe_BAHIA_AZO_PRO_31', 'AZO PRO 31', 2500, { lieu_type: 'externe', lieu_id: 'BAHIA' }),
    ],
    CATALOGUE
  );
  assert.strictEqual(p.reunions.length, 0);
  assert.strictEqual(p.deplacements.length, 2);
  const cibles = p.deplacements.map((c) => c.conserve).sort();
  assert.deepStrictEqual(cibles, ['externe_BAHIA_IMP-005', 'magasin_F2_IMP-005']);
});

test('la clé cible vient de identifiantSoldeCanonique, pas d\'une formule recopiée', () => {
  const p = recle.planifierRecle(
    [S('magasin_F 2_x', 'NITRETE DE POTASSE', 1, { lieu_id: 'F 2' })],
    CATALOGUE
  );
  assert.strictEqual(
    p.deplacements[0].conserve,
    identite.identifiantSoldeCanonique('magasin', 'F 2', 'IMP-019')
  );
});

// ── ROBUSTESSE ──────────────────────────────────────────────────────────────

test('entrées vides / absurdes — aucun plan, aucune exception', () => {
  for (const args of [[null, null], [[], []], [undefined, CATALOGUE], [[{}], CATALOGUE]]) {
    const p = recle.planifierRecle(args[0], args[1]);
    assert.strictEqual(p.deplacements.length, 0);
    assert.strictEqual(p.reunions.length, 0);
  }
});

test('comptage global cohérent', () => {
  const soldes = [
    S('magasin_F2_IMP-019', 'IMP-019', 1),
    S('magasin_F2_NITRETE_DE_POTASSE', 'NITRETE DE POTASSE', 2),
    S('magasin_F2_AZO_PRO_31', 'AZO PRO 31', 3),
    S('magasin_F2_TES', 'TES', 4),
  ];
  const p = recle.planifierRecle(soldes, CATALOGUE);
  assert.strictEqual(p.total_documents, 4);
  // IMP-019 + son libellé se réunissent ; AZO PRO 31 se déplace ; TES orphelin.
  assert.strictEqual(p.reunions.length, 1);
  assert.strictEqual(p.deplacements.length, 1);
  assert.strictEqual(p.orphelins.length, 1);
  assert.strictEqual(p.deja_canoniques.length, 0);
});
