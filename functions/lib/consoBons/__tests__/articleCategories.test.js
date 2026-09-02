'use strict';

/**
 * articleCategories.test.js — La catégorie d'une ligne de consommation vient de
 * l'ARTICLE (catalogue), plus du bon.
 *
 * Chaque test de cette suite a été vu ROUGE sous sa mutation, puis VERT après
 * annulation (cf. compte rendu du ticket sb/conso-categorie-article) : un test
 * vert qu'on n'a jamais vu échouer ne prouve rien.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  adaptBonsToConsoRows,
  buildArticleCategoryIndex,
  lookupArticleCategorie,
  alnumArticleKey,
} = require('../bonsToConsoRows');
const { aggregateConsoParcelle, articlesAClasser } = require('../aggregateParcelle');

// ---------------------------------------------------------------------------
// Fixtures — libellés RÉELS du catalogue de production.
// ---------------------------------------------------------------------------

const CATALOGUE = [
  { nom: 'BENEVIA', categorie: 'Pesticides', active: true },
  { nom: 'Ammonitrate', categorie: 'Engrais', active: true },
  { nom: 'MAP', categorie: 'Engrais', active: true },
  { nom: 'EXTREME', categorie: 'autre', active: true },
  { nom: 'M-K-P', categorie: 'Engrais', active: true },
  // Clé alphanumérique AMBIGUË, mesurée en prod : deux fiches, deux familles.
  { nom: 'PRIORITOP', categorie: 'Engrais', active: true },
  { nom: 'PRIORI TOP', categorie: 'Pesticides', active: true },
  // Fiche DÉSACTIVÉE : ne doit jamais servir de source de vérité.
  { nom: 'DESACTIVE', categorie: 'Pesticides', active: false },
];

const INDEX = buildArticleCategoryIndex(CATALOGUE);

function bon(over) {
  return Object.assign(
    {
      id: 'b1',
      numero: 'BC-2026-0048',
      // Le bon est déclaré ENGRAIS : c'est exactement le cas de production
      // (48 bons /48 en `type: engrais`).
      type: 'engrais',
      cpc_categorie: 'Engrais',
      date: '2026-08-10',
      items: [],
    },
    over
  );
}

function item(article, over) {
  return Object.assign({ article, quantite: 10, unite: 'kg', parcelle: 'F1 S1' }, over);
}

const ADAPT = { campagne: '2026-2027', catByArticle: INDEX };

// ---------------------------------------------------------------------------
// LE BUG : BENEVIA est un pesticide, sur un bon déclaré « engrais »
// ---------------------------------------------------------------------------

test('un bon type:engrais contenant BENEVIA classe BENEVIA en PESTICIDE', () => {
  const rows = adaptBonsToConsoRows(
    [bon({ items: [item('BENEVIA', { quantite: 2, unite: 'l' }), item('Ammonitrate', { quantite: 50 })] })],
    ADAPT
  );
  const byArticle = {};
  rows.forEach((r) => { byArticle[r.Article] = r.Article_Categorie; });
  assert.deepStrictEqual(byArticle, { BENEVIA: 'Pesticides', Ammonitrate: 'Engrais' });

  // ... et l'écran Campagne le range bien dans la colonne Pesticides.
  const out = aggregateConsoParcelle(rows, {});
  assert.deepStrictEqual(out[0].pesticides.map((a) => a.article), ['BENEVIA']);
  assert.deepStrictEqual(out[0].engrais.map((a) => a.article), ['Ammonitrate']);
});

test('un même bon mélange les deux familles (cas BC-2026-0048)', () => {
  const rows = adaptBonsToConsoRows(
    [bon({ items: [item('BENEVIA'), item('MAP'), item('Ammonitrate')] })],
    ADAPT
  );
  const out = aggregateConsoParcelle(rows, {});
  assert.strictEqual(out[0].engrais.length, 2);
  assert.strictEqual(out[0].pesticides.length, 1);
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED : absent du catalogue, clé ambiguë, fiche désactivée
// ---------------------------------------------------------------------------

test('article ABSENT du catalogue -> « à classer », JAMAIS engrais', () => {
  const rows = adaptBonsToConsoRows([bon({ items: [item('GENAKTIS', { quantite: 8, unite: 'L' })] })], ADAPT);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].Article_Categorie, '', "pas de repli sur la catégorie du bon");

  const out = aggregateConsoParcelle(rows, {});
  assert.deepStrictEqual(out[0].engrais, []);
  assert.deepStrictEqual(out[0].pesticides, []);
  assert.deepStrictEqual(out[0].aClasser.map((a) => a.article), ['GENAKTIS']);

  assert.deepStrictEqual(articlesAClasser(rows), [
    { article: 'GENAKTIS', categorie_actuelle: 'absent du catalogue', lignes: 1, quantite: 8, unite: 'L' },
  ]);
});

test('clé alphanumérique AMBIGUË : ne tranche jamais (PRIORITOP / PRIORI TOP)', () => {
  // Le catalogue porte les deux fiches, dans deux familles. La clé
  // alphanumérique 'prioritop' est donc ambiguë : elle ne doit rien décider.
  assert.strictEqual(alnumArticleKey('PRIORI TOP'), 'prioritop');
  assert.strictEqual(alnumArticleKey('PRIORITOP'), 'prioritop');
  assert.strictEqual(INDEX.byAlnum.prioritop.ambigu, true);

  // Un libellé qui n'existe QUE via la clé ambiguë part « à classer ».
  const lu = lookupArticleCategorie('PRIORI-TOP', INDEX);
  assert.deepStrictEqual(lu, { categorie: '', statut: 'ambigu' });

  const rows = adaptBonsToConsoRows([bon({ items: [item('PRIORI-TOP', { quantite: 3, unite: 'l' })] })], ADAPT);
  assert.strictEqual(rows[0].Article_Categorie, '');
  const out = aggregateConsoParcelle(rows, {});
  assert.deepStrictEqual(out[0].aClasser.map((a) => a.article), ['PRIORI-TOP']);
});

test("une correspondance EXACTE prime sur l'ambiguïté de la clé alphanumérique", () => {
  // 'PRIORITOP' a une fiche exacte : elle tranche, même si la clé
  // alphanumérique est ambiguë. Fail-closed ne veut pas dire aveugle.
  assert.deepStrictEqual(lookupArticleCategorie('PRIORITOP', INDEX), { categorie: 'Engrais', statut: 'exact' });
  assert.deepStrictEqual(lookupArticleCategorie('priori top', INDEX), { categorie: 'Pesticides', statut: 'exact' });
});

test('clé alphanumérique : M.K.P retrouve la fiche M-K-P', () => {
  assert.deepStrictEqual(lookupArticleCategorie('M.K.P', INDEX), { categorie: 'Engrais', statut: 'alnum' });
  assert.deepStrictEqual(lookupArticleCategorie('MKP', INDEX), { categorie: 'Engrais', statut: 'alnum' });
});

test('une fiche DÉSACTIVÉE n’entre pas dans l’index', () => {
  assert.deepStrictEqual(lookupArticleCategorie('DESACTIVE', INDEX), { categorie: '', statut: 'absent' });
});

test('deux fiches de MÊME famille ne rendent pas la clé ambiguë', () => {
  const idx = buildArticleCategoryIndex([
    { nom: 'UREE 46', categorie: 'Engrais' },
    { nom: 'uree 46', categorie: 'engrais' },
  ]);
  assert.strictEqual(lookupArticleCategorie('UREE 46', idx).categorie, 'Engrais');
});

test('normalisation : accents, casse et espaces multiples', () => {
  const idx = buildArticleCategoryIndex([{ nom: 'Nitrate  de Calcium', categorie: 'Engrais' }]);
  assert.strictEqual(lookupArticleCategorie('NITRATE DE CALCIUM', idx).categorie, 'Engrais');
  assert.strictEqual(lookupArticleCategorie('nitrate de câlcium', idx).categorie, 'Engrais');
});

test('entrées dégénérées : index vide, aucun crash', () => {
  assert.deepStrictEqual(buildArticleCategoryIndex(null), { byName: {}, byAlnum: {} });
  assert.deepStrictEqual(buildArticleCategoryIndex([null, 3, {}, { nom: '   ' }]), { byName: {}, byAlnum: {} });
  assert.deepStrictEqual(lookupArticleCategorie('X'), { categorie: '', statut: 'absent' });
  assert.deepStrictEqual(lookupArticleCategorie('', INDEX), { categorie: '', statut: 'absent' });
});

// ---------------------------------------------------------------------------
// Rétrocompatibilité : sans index injecté, l'ancien comportement subsiste
// ---------------------------------------------------------------------------

test("sans catByArticle : la catégorie reste celle du BON (appelant historique)", () => {
  const rows = adaptBonsToConsoRows([bon({ items: [item('BENEVIA')] })], { campagne: '2026-2027' });
  assert.strictEqual(rows[0].Article_Categorie, 'Engrais');
});

// ---------------------------------------------------------------------------
// Récapitulatif global
// ---------------------------------------------------------------------------

test('articlesAClasser distingue « mal classé » de « absent du catalogue »', () => {
  const rows = adaptBonsToConsoRows(
    [bon({ items: [
      item('EXTREME', { quantite: 10, unite: 'kg' }),
      item('EXTREME', { quantite: 7.5, unite: 'kg', parcelle: 'F1 S2' }),
      item('GENAKTIS', { quantite: 8, unite: 'L' }),
      item('MAP', { quantite: 100 }),
    ] })],
    ADAPT
  );
  assert.deepStrictEqual(articlesAClasser(rows), [
    { article: 'EXTREME', categorie_actuelle: 'autre', lignes: 2, quantite: 17.5, unite: 'kg' },
    { article: 'GENAKTIS', categorie_actuelle: 'absent du catalogue', lignes: 1, quantite: 8, unite: 'L' },
  ]);
});

test('articlesAClasser se calcule AVANT tout filtrage de périmètre', () => {
  // Le piège que `parcelles_ferme_indeterminee` documente déjà : calculé après
  // le filtre ferme, le récapitulatif serait vide pour le seul profil concerné.
  const rows = adaptBonsToConsoRows(
    [bon({ items: [item('GENAKTIS', { quantite: 8, unite: 'L', parcelle: 'F5 S8-1' })] })],
    ADAPT
  );
  const chefF1 = aggregateConsoParcelle(rows, {
    deriveFerme: (p) => (String(p).indexOf('F1') === 0 ? 'F1' : 'F5'),
    fermeFilter: 'F1',
  });
  assert.deepStrictEqual(chefF1, [], 'la parcelle F5 est bien hors périmètre du chef F1');
  assert.strictEqual(articlesAClasser(rows).length, 1, 'le récapitulatif, lui, reste visible');
});
