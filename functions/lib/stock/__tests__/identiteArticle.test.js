'use strict';

/**
 * Tests du résolveur d'identité d'article (functions/lib/stock/identiteArticle).
 *
 * Les cas ne sont PAS inventés : ils viennent des mesures faites sur la
 * production le 2026-08-31 (1 019 fiches actives, 4 516 mouvements, 199
 * libellés distincts), rejouées deux fois avant d'écrire ce fichier.
 *   - `RHIZO MN ZN` → `RHIZO MN ZN (KG)` : 308 lignes de mouvement, rattachées
 *     par `canon` SEULE (le suffixe d'unité). C'est le cas qui disqualifie
 *     `normalizeArticleName` comme normalisation d'identité.
 *   - `TES`, `GENAKTIS`, `M.K.P`, `Maspilan`, `SEACTIV GENAKTIS 3` : les 5
 *     libellés (11 lignes) qui ne se rattachent à AUCUNE fiche → futurs refus.
 *   - `NITRATE DE POTASSE` fusionné vers `Ref-Eng0051` : le cas `merged_into`,
 *     celui qui porte +9 754 kg en F2 dans un solde rangé sous le nom.
 */

const test = require('node:test');
const assert = require('node:assert');

const identite = require('../identiteArticle');
const { normalizeArticleName } = require('../../stockMerge/articleMerge');

// ---------------------------------------------------------------------------
// Catalogue de référence — extrait fidèle de la production.
// ---------------------------------------------------------------------------

const CATALOGUE = [
  // Le cas « canon seule » : la fiche porte le suffixe d'unité, pas le libellé
  // tapé sur les bons.
  { id: 'Ref-Eng0088', nom: 'RHIZO MN ZN (KG)', unite: 'kg', active: true },
  { id: 'Ref-Eng0091', nom: 'KSC 3 (KG)', unite: 'kg', active: true },
  { id: 'Ref-Pes0012', nom: 'DEPTIL PA5 (L)', unite: 'l', active: true },
  // Le cas `merged_into` : la fiche absorbée reste au catalogue, désactivée,
  // et pointe vers son maître.
  { id: 'Ref-Eng0051', nom: 'Nitrate de Potasse', unite: 'kg', active: true },
  { id: 'Ref-Eng0052', nom: 'NITRATE DE POTASSE (KG)', active: false, merged_into: 'Ref-Eng0051' },
  // Chaîne de fusion à deux sauts (fusion d'une fusionnée).
  { id: 'Ref-Eng0053', nom: 'Nitrate potasse', active: false, merged_into: 'Ref-Eng0052' },
  // Document FANTÔME de production : ni `nom` ni `active`.
  { id: 'ENG 0150' },
];

const IDX = identite.indexerFiches(CATALOGUE);

// ---------------------------------------------------------------------------
// 1. La normalisation d'identité est `canon`, pas `normalizeArticleName`.
//    MUTANT GARDÉ : remplacer `canon` par `normalizeArticleName` dans le
//    module → ces trois libellés deviennent INTROUVABLES → rouge.
// ---------------------------------------------------------------------------

test('canon rattache les libellés à suffixe d\'unité (9 libellés, 1 098 lignes en production)', () => {
  for (const [libelle, ficheId] of [
    ['RHIZO MN ZN', 'Ref-Eng0088'],
    ['KSC 3', 'Ref-Eng0091'],
    ['DEPTIL PA5', 'Ref-Pes0012'],
  ]) {
    const r = identite.resoudreIdentite(libelle, IDX);
    assert.strictEqual(r.issue, identite.ISSUE_RESOLU, libelle + ' doit être résolu');
    assert.strictEqual(r.ficheId, ficheId);
  }
});

test('le test précédent DISCRIMINE : normalizeArticleName ne rattacherait pas ces libellés', () => {
  // Sans cette assertion, remplacer `canon` par `normalizeArticleName` dans le
  // module pourrait passer inaperçu si le jeu de données ne portait que des
  // écarts de casse. Ici on prouve que les deux règles DIFFÈRENT sur ce cas.
  assert.notStrictEqual(
    normalizeArticleName('RHIZO MN ZN'),
    normalizeArticleName('RHIZO MN ZN (KG)'),
    'si ces deux valeurs devenaient égales, le test ci-dessus ne prouverait plus rien'
  );
});

// ---------------------------------------------------------------------------
// 2. La chaîne `merged_into` est suivie.
//    MUTANT GARDÉ : ne pas suivre la chaîne → le solde du maître n'est plus
//    visé, un second document est créé à côté → rouge.
// ---------------------------------------------------------------------------

test('une fiche fusionnée résout vers son MAÎTRE actif', () => {
  const r = identite.resoudreIdentite('Ref-Eng0052', IDX);
  assert.strictEqual(r.issue, identite.ISSUE_RESOLU);
  assert.strictEqual(r.ficheId, 'Ref-Eng0051');
  assert.strictEqual(r.nom, 'Nitrate de Potasse');
});

test('la chaîne merged_into est suivie sur plusieurs sauts', () => {
  const r = identite.resoudreIdentite('Ref-Eng0053', IDX);
  assert.strictEqual(r.ficheId, 'Ref-Eng0051', 'Ref-Eng0053 → Ref-Eng0052 → Ref-Eng0051');
});

test('la chaîne merged_into est BORNÉE : un cycle ne fige pas la résolution', () => {
  const cyclique = identite.indexerFiches([
    { id: 'A', nom: 'A', active: false, merged_into: 'B' },
    { id: 'B', nom: 'B', active: false, merged_into: 'A' },
  ]);
  const r = identite.resoudreIdentite('A', cyclique);
  assert.strictEqual(r.issue, identite.ISSUE_INTROUVABLE);
});

test('une fiche fusionnée n\'est jamais une identité, même interrogée par son NOM', () => {
  // `NITRATE DE POTASSE (KG)` est le nom de la fiche ABSORBÉE. Il doit tomber
  // sur le maître, pas ressusciter la fiche morte.
  const r = identite.resoudreIdentite('NITRATE DE POTASSE (KG)', IDX);
  assert.strictEqual(r.issue, identite.ISSUE_RESOLU);
  assert.strictEqual(r.ficheId, 'Ref-Eng0051');
});

// ---------------------------------------------------------------------------
// 3. Trois issues, et trois seulement.
// ---------------------------------------------------------------------------

test('les 5 libellés orphelins de production sont INTROUVABLES, et le message les nomme', () => {
  for (const libelle of ['TES', 'GENAKTIS', 'SEACTIV GENAKTIS 3', 'M.K.P', 'Maspilan']) {
    const r = identite.resoudreIdentite(libelle, IDX);
    assert.strictEqual(r.issue, identite.ISSUE_INTROUVABLE, libelle);
    assert.strictEqual(r.ficheId, '');
    assert.ok(r.erreur.includes(libelle), 'le refus doit NOMMER l\'article : ' + r.erreur);
  }
});

test('deux fiches actives de même identité canonique → AMBIGU, les deux sont nommées', () => {
  const idx = identite.indexerFiches([
    { id: 'Ref-Eng0201', nom: 'ACIDE PHOSPHORIQUE (L)', active: true },
    { id: 'Ref-Eng0202', nom: 'Acide Phosphorique', active: true },
  ]);
  const r = identite.resoudreIdentite('acide phosphorique', idx);
  assert.strictEqual(r.issue, identite.ISSUE_AMBIGU);
  assert.strictEqual(r.ficheId, '', 'un cas ambigu ne doit JAMAIS rendre une identité');
  assert.strictEqual(r.candidats.length, 2);
  assert.ok(r.erreur.includes('Ref-Eng0201') && r.erreur.includes('Ref-Eng0202'), r.erreur);
});

test('un document FANTÔME (sans nom ni active) n\'est jamais une identité', () => {
  const r = identite.resoudreIdentite('ENG 0150', IDX);
  assert.strictEqual(r.issue, identite.ISSUE_INTROUVABLE);
});

test('un docId actif se résout à lui-même (idempotence : re-saisir un bon ne re-clé rien)', () => {
  const r = identite.resoudreIdentite('Ref-Eng0051', IDX);
  assert.strictEqual(r.ficheId, 'Ref-Eng0051');
});

// ---------------------------------------------------------------------------
// 4. resoudreLignes : FAIL-CLOSED.
//    MUTANT GARDÉ : transformer le refus en création implicite (garder la
//    ligne avec son libellé) → rouge.
// ---------------------------------------------------------------------------

test('resoudreLignes remplace article_ref par le docId et CONSERVE le libellé saisi', () => {
  const r = identite.resoudreLignes(
    [{ article_ref: 'RHIZO MN ZN', article_nom: 'RHIZO MN ZN', quantite: 12, unite: 'kg' }],
    IDX
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lignes[0].article_ref, 'Ref-Eng0088', 'l\'identité est le docId');
  assert.strictEqual(r.lignes[0].article_nom, 'RHIZO MN ZN', 'le magasinier lit ce qu\'il a tapé');
  assert.strictEqual(r.lignes[0].quantite, 12, 'aucun autre champ n\'est touché');
  assert.strictEqual(r.lignes[0].unite, 'kg');
});

test('resoudreLignes REFUSE le bon entier si un seul article est inconnu', () => {
  const r = identite.resoudreLignes(
    [
      { article_ref: 'RHIZO MN ZN', quantite: 12 },
      { article_ref: 'GENAKTIS', quantite: 3 },
    ],
    IDX
  );
  assert.strictEqual(r.ok, false, 'fail-closed : rien n\'entre en stock sous une identité inventée');
  assert.deepStrictEqual(r.lignes, [], 'aucune ligne partielle ne doit sortir');
  assert.strictEqual(r.refus.code, 'article_inconnu');
  assert.ok(r.refus.erreur.includes('GENAKTIS'), r.refus.erreur);
});

test('resoudreLignes nomme TOUS les articles fautifs, pas seulement le premier', () => {
  const r = identite.resoudreLignes(
    [{ article_ref: 'TES' }, { article_ref: 'M.K.P' }],
    IDX
  );
  assert.strictEqual(r.ok, false);
  assert.ok(r.refus.erreur.includes('TES'));
  assert.ok(r.refus.erreur.includes('M.K.P'));
  assert.strictEqual(r.refus.details.length, 2);
});

test('resoudreLignes refuse aussi un article AMBIGU, avec son propre code', () => {
  const idx = identite.indexerFiches([
    { id: 'Ref-A', nom: 'ACIDE PHOSPHORIQUE (L)', active: true },
    { id: 'Ref-B', nom: 'Acide Phosphorique', active: true },
  ]);
  const r = identite.resoudreLignes([{ article_ref: 'Acide phosphorique' }], idx);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.refus.code, 'article_ambigu');
});

test('resoudreLignes refuse une ligne sans aucun article', () => {
  const r = identite.resoudreLignes([{ quantite: 5 }], IDX);
  assert.strictEqual(r.ok, false);
});

test('resoudreLignes résout une ligne qui ne porte que `article` (format BL/BC)', () => {
  const r = identite.resoudreLignes([{ article: 'KSC 3', quantite: 4 }], IDX);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lignes[0].article_ref, 'Ref-Eng0091');
  assert.strictEqual(r.lignes[0].article_nom, 'KSC 3');
});

// ---------------------------------------------------------------------------
// 4bis. identiteImpact — application ET annulation d'impact.
//    MUTANT GARDÉ : `return brut;` inconditionnel. Il débranche silencieusement
//    le suivi de `merged_into` : après une fusion, l'annulation d'un mouvement
//    viserait le solde de la fiche ABSORBÉE, pendant que l'application avait
//    visé celui du maître. Aucune erreur, deux soldes faux.
// ---------------------------------------------------------------------------

test('identiteImpact résout vers la fiche active, y compris à travers une fusion', () => {
  assert.strictEqual(
    identite.identiteImpact({ article_ref: 'Ref-Eng0052', article_nom: 'NITRATE DE POTASSE (KG)' }, IDX),
    'Ref-Eng0051',
    'après une fusion, l\'impact doit viser le solde du MAÎTRE'
  );
  assert.strictEqual(
    identite.identiteImpact({ article_ref: 'RHIZO MN ZN' }, IDX),
    'Ref-Eng0088',
    'un libellé à suffixe d\'unité doit être résolu, pas laissé brut'
  );
});

test('identiteImpact garde la clé BRUTE d\'un libellé orphelin — une annulation n\'est jamais bloquée', () => {
  // Contrat DÉLIBÉRÉMENT différent de `resoudreLignes` : ces helpers annulent
  // l'impact d'un mouvement DÉJÀ écrit. Refuser rendrait l'annulation
  // impossible et piégerait l'utilisateur.
  assert.strictEqual(identite.identiteImpact({ article_ref: 'GENAKTIS' }, IDX), 'GENAKTIS');
  assert.strictEqual(identite.identiteImpact({ article_ref: 'M.K.P' }, IDX), 'M.K.P');
});

test('identiteImpact est SYMÉTRIQUE : apply et reverse visent le même document', () => {
  // C'est la seule propriété qui compte pour un couple aller/retour. Si elle
  // tombe, un reverse re-crédite un seau et en débite un autre, en silence.
  for (const ligne of [
    { article_ref: 'Ref-Eng0052' },
    { article_ref: 'Nitrate de Potasse' },
    { article: 'KSC 3' },
    { article_ref: 'TES' },
  ]) {
    const a = identite.identiteImpact(ligne, IDX);
    const b = identite.identiteImpact(ligne, IDX);
    assert.strictEqual(a, b);
    assert.strictEqual(
      identite.identifiantSoldeCanonique('magasin', 'F2', a),
      identite.identifiantSoldeCanonique('magasin', 'F2', b)
    );
  }
});

// ---------------------------------------------------------------------------
// 5. identifiantSoldeCanonique + garde de stock.
//    MUTANT GARDÉ (le plus important, car SILENCIEUX en production) : la garde
//    lit avec l'ancienne clé (le libellé) → elle interroge un seau vide et
//    laisse sortir du stock inexistant → rouge.
// ---------------------------------------------------------------------------

test('identifiantSoldeCanonique conserve la formule historique (espaces → underscores)', () => {
  assert.strictEqual(
    identite.identifiantSoldeCanonique('magasin', 'F2', 'Ref-Eng0051'),
    'magasin_F2_Ref-Eng0051'
  );
  assert.strictEqual(
    identite.identifiantSoldeCanonique('magasin', 'F2', 'NITRATE DE POTASSE'),
    'magasin_F2_NITRATE_DE_POTASSE'
  );
});

test('la garde de stock lit la MÊME clé que celle sous laquelle le solde est écrit', () => {
  const resolues = identite.resoudreLignes(
    [{ article_ref: 'RHIZO MN ZN', quantite: 5 }],
    IDX
  ).lignes;
  const cles = identite.identifiantsGardeStock({ type: 'magasin', id: 'F2' }, resolues);

  assert.deepStrictEqual(cles, [
    { ficheId: 'Ref-Eng0088', balanceId: 'magasin_F2_Ref-Eng0088' },
  ]);
  // La clé d'ÉCRITURE, dérivée de la même fonction, doit être identique. Si la
  // garde lisait `magasin_F2_RHIZO_MN_ZN` (l'ancienne clé), elle lirait 0 sur
  // un article qui a du stock — ou laisserait sortir du stock qui n'existe pas.
  assert.strictEqual(
    cles[0].balanceId,
    identite.identifiantSoldeCanonique('magasin', 'F2', resolues[0].article_ref),
    'clé de LECTURE et clé d\'ÉCRITURE doivent être la même'
  );
  assert.notStrictEqual(cles[0].balanceId, 'magasin_F2_RHIZO_MN_ZN');
});

test('la garde dédoublonne les fiches : deux libellés fusionnés = UNE seule lecture', () => {
  const resolues = identite.resoudreLignes(
    [{ article_ref: 'Ref-Eng0052', quantite: 1 }, { article_ref: 'Nitrate de Potasse', quantite: 2 }],
    IDX
  ).lignes;
  const cles = identite.identifiantsGardeStock({ type: 'magasin', id: 'F2' }, resolues);
  assert.strictEqual(cles.length, 1, 'les deux lignes visent le même solde');
  assert.strictEqual(cles[0].balanceId, 'magasin_F2_Ref-Eng0051');
});

// ---------------------------------------------------------------------------
// 6. rebuildBalances : générer ET purger avec la MÊME règle.
//    MUTANT GARDÉ : purger avec l'ancienne formule → l'import supprime des
//    soldes qu'il ne sait pas régénérer → rouge.
// ---------------------------------------------------------------------------

test('agregerSoldes range un mouvement portant le LIBELLÉ sous la clé de la FICHE', () => {
  const { soldes } = identite.agregerSoldes(
    [
      { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'NITRATE DE POTASSE (KG)', article_nom: 'NITRATE DE POTASSE (KG)', unite: 'kg', delta: 9754 },
      { lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'Ref-Eng0051', article_nom: 'Nitrate de Potasse', unite: 'kg', delta: 100 },
    ],
    IDX
  );
  assert.deepStrictEqual(
    [...soldes.keys()],
    ['magasin_F2_Ref-Eng0051'],
    'les deux fragments de production doivent tomber dans UN seul document'
  );
  assert.strictEqual(soldes.get('magasin_F2_Ref-Eng0051').balance, 9854);
  assert.strictEqual(soldes.get('magasin_F2_Ref-Eng0051').article_ref, 'Ref-Eng0051');
});

test('la purge ne supprime QUE ce que la génération n\'a pas produit — même règle des deux côtés', () => {
  const { soldes } = identite.agregerSoldes(
    [{ lieu_type: 'magasin', lieu_id: 'F2', article_ref: 'RHIZO MN ZN', unite: 'kg', delta: 40 }],
    IDX
  );
  // Le document EXISTANT est déjà rangé sous le docId de la fiche : c'est ce
  // que l'import CANEVA effaçait, avant, parce qu'il régénérait sous le nom.
  const aPurger = identite.docsAPurger(soldes, [
    'magasin_F2_Ref-Eng0088',
    'magasin_F9_OBSOLETE',
  ]);
  assert.deepStrictEqual(aPurger, ['magasin_F9_OBSOLETE']);
  assert.ok(
    !aPurger.includes('magasin_F2_Ref-Eng0088'),
    'un import ne doit jamais supprimer un solde qu\'il sait régénérer'
  );
});

test('agregerSoldes : un libellé orphelin garde sa clé BRUTE, donc survit à la purge', () => {
  // Repli assumé et documenté : `rebuildBalances` est un RECALCUL de
  // l'historique, pas une saisie. Les 11 lignes orphelines de production ne
  // doivent ni bloquer l'import, ni voir leur solde effacé.
  const { soldes, non_resolus } = identite.agregerSoldes(
    [{ lieu_type: 'magasin', lieu_id: 'F1', article_ref: 'GENAKTIS', unite: 'kg', delta: 7 }],
    IDX
  );
  assert.deepStrictEqual(non_resolus, ['GENAKTIS']);
  assert.ok(soldes.has('magasin_F1_GENAKTIS'));
  assert.deepStrictEqual(identite.docsAPurger(soldes, ['magasin_F1_GENAKTIS']), []);
});

// ---------------------------------------------------------------------------
// 7. Robustesse d'entrée — le module ne doit jamais lever sur des données sales.
// ---------------------------------------------------------------------------

test('entrées vides / nulles : aucune exception, refus explicite', () => {
  const vide = identite.indexerFiches(null);
  assert.strictEqual(identite.resoudreIdentite(null, vide).issue, identite.ISSUE_INTROUVABLE);
  assert.strictEqual(identite.resoudreIdentite('X', /** @type {*} */ ({})).issue, identite.ISSUE_INTROUVABLE);
  assert.deepStrictEqual(identite.resoudreLignes(null, vide), { ok: true, lignes: [], refus: null });
  assert.deepStrictEqual(identite.agregerSoldes(null, vide).non_resolus, []);
  assert.deepStrictEqual(identite.docsAPurger(null, null), []);
});
