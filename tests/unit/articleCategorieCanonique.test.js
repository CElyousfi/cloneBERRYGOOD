'use strict';

/**
 * articleCategorieCanonique.test.js — la catégorie ÉCRITE au catalogue est le
 * libellé CANONIQUE.
 *
 * Trois choses sont prouvées ici :
 *  1. la règle pure (casse, synonymes, inconnu conservé, vide conservé) ;
 *  2. l'ABSENCE DE DIVERGENCE entre la liste backend
 *     (functions/lib/stockMerge/articleCategories.js) et la liste frontend
 *     (src/modules/shared/lib/articleCategories.js) — le backend ne peut pas requérir
 *     `public/`, la copie est donc verrouillée par un test, pas par un import ;
 *  3. le REJEU D'UN IMPORT : rejouer l'import sur une fiche existante ne crée
 *     AUCUNE fiche et pose le libellé canonique. C'est ce test qui répond à la
 *     question « le réimport du 30/06 va-t-il recréer `engrais` ? ».
 *
 * ── CE QUE CE FICHIER NE PROUVE PAS ────────────────────────────────────────
 * Les tests « REJEU » rejouent une COPIE de la boucle d'import, pas le handler
 * `import-articles-sql` lui-même : le monolithe `functions/index.js` n'est pas
 * requérable en test (Firebase Admin s'initialise au chargement) et il n'y a
 * pas d'emulator dans cette suite.
 *
 * Conséquence mesurée, à dire franchement : insérer `delete data.categorie;`
 * juste avant l'écriture de l'import SQL laisse ce fichier ENTIÈREMENT VERT.
 * L'import n'écrirait plus aucune catégorie, la ligne
 * `categorie: articleCategories.categorieCanonique(row.categorie)` serait
 * toujours là, et rien ici ne s'en apercevrait.
 *
 * Ce filet prouve donc DEUX choses, et deux seulement : (a) la formule du
 * docId est inchangée, donc un réimport ré-adresse les fiches existantes ;
 * (b) la règle de catégorie rend bien le libellé canonique. Il NE prouve PAS
 * que le handler écrit ce qu'il calcule. Cette dernière propriété est tenue —
 * partiellement — par les gardes structurelles de
 * tests/unit/articleCatalogWiring.test.js, qui lisent le source. Une preuve
 * réelle demanderait un test contre l'emulator Firestore : c'est un chantier
 * en soi, hors périmètre de ce lot, et sciemment non fait.
 *
 * Chaque test de cette suite a été vu ROUGE sous sa mutation puis VERT après
 * annulation (cf. compte rendu du ticket sb/categorie-canonique-import).
 *
 * Run: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const BACK = require('../../functions/lib/stockMerge/articleCategories.js');
const FRONT = require('./_esm').loadEsm('src/modules/shared/lib/articleCategories.js');
const articleMerge = require('../../functions/lib/stockMerge/articleMerge.js');

const { categorieCanonique, estCategorieCanonique, CATEGORIES_ARTICLE } = BACK;

// ───────────────────────────────────────────────────────────────────────────
// 1. LA RÈGLE PURE
// ───────────────────────────────────────────────────────────────────────────

test('casse : une valeur reconnue rend TOUJOURS le libellé canonique', () => {
  assert.equal(categorieCanonique('engrais'), 'Engrais');
  assert.equal(categorieCanonique('ENGRAIS'), 'Engrais');
  assert.equal(categorieCanonique('Engrais'), 'Engrais');
  assert.equal(categorieCanonique('pesticides'), 'Pesticides');
  assert.equal(categorieCanonique('PESTICIDES'), 'Pesticides');
  // Les libellés « laids » de la base sont canoniques : on ne les embellit pas.
  assert.equal(categorieCanonique('Immobilisation'), 'IMMOBILISATION');
  assert.equal(categorieCanonique('Autre'), 'autre');
  assert.equal(categorieCanonique('MATERIEL'), 'materiel');
  assert.equal(categorieCanonique('petit outillage'), 'Petit Outillage');
  // Espaces parasites et bords : du bruit de saisie, jamais une information.
  assert.equal(categorieCanonique('  PESTICIDES  '), 'Pesticides');
  assert.equal(categorieCanonique('Petit   Outillage'), 'Petit Outillage');
});

test('chaque libellé canonique est reconnu et rendu à l’identique', () => {
  for (const libelle of CATEGORIES_ARTICLE) {
    assert.equal(categorieCanonique(libelle), libelle, libelle);
    assert.equal(categorieCanonique(libelle.toLowerCase()), libelle, libelle + ' (minuscules)');
    assert.equal(categorieCanonique(libelle.toUpperCase()), libelle, libelle + ' (capitales)');
  }
});

test('synonymes : phyto / PHYTO-SANITAIRE / pesticide → Pesticides, IMMOBILISATIONS → IMMOBILISATION', () => {
  assert.equal(categorieCanonique('phyto'), 'Pesticides');
  assert.equal(categorieCanonique('Phyto'), 'Pesticides');
  assert.equal(categorieCanonique('PHYTO-SANITAIRE'), 'Pesticides');
  assert.equal(categorieCanonique('phyto-sanitaire'), 'Pesticides');
  assert.equal(categorieCanonique('Phytosanitaire'), 'Pesticides');
  // Valeur envoyée par le bandeau « à classer » de l'écran Campagne.
  assert.equal(categorieCanonique('pesticide'), 'Pesticides');
  assert.equal(categorieCanonique('IMMOBILISATIONS'), 'IMMOBILISATION');
  assert.equal(categorieCanonique('immobilisations'), 'IMMOBILISATION');
  // `emballage` (1 fiche) n'est PAS un synonyme : c'est la même valeur à la
  // casse près, donc la règle 1 suffit.
  assert.equal(categorieCanonique('emballage'), 'Emballage');
});

test('valeur INCONNUE : conservée telle quelle, jamais forcée sur un défaut', () => {
  // Inventer une catégorie est pire que d'en garder une inconnue : la valeur
  // bizarre doit rester visible à l'écran (« (valeur actuelle) »).
  assert.equal(categorieCanonique('Divers'), 'Divers');
  assert.equal(categorieCanonique('amendement'), 'amendement');
  assert.equal(categorieCanonique('CATEGORIE INEDITE 42'), 'CATEGORIE INEDITE 42');
  // …et surtout pas de repli sur `autre` (le patron « zéro par défaut »).
  assert.notEqual(categorieCanonique('Divers'), 'autre');
  assert.equal(estCategorieCanonique(categorieCanonique('Divers')), false);
});

test('valeur VIDE : reste vide, jamais noyée dans `autre`', () => {
  // 5 fiches de production n'ont pas de catégorie : elles doivent rester
  // repérables comme telles.
  assert.equal(categorieCanonique(''), '');
  assert.equal(categorieCanonique('   '), '');
  assert.equal(categorieCanonique(null), '');
  assert.equal(categorieCanonique(undefined), '');
  assert.notEqual(categorieCanonique(''), 'autre');
  assert.notEqual(categorieCanonique(null), 'autre');
});

test('entrées dégénérées : aucun crash, aucune valeur non-string en sortie', () => {
  assert.equal(categorieCanonique(0), '0');
  assert.equal(categorieCanonique(false), 'false');
  assert.equal(typeof categorieCanonique({}), 'string');
  assert.equal(categorieCanonique(['Engrais']), 'Engrais');
});

test('idempotence : normaliser deux fois ne change plus rien', () => {
  const echantillon = CATEGORIES_ARTICLE.concat([
    'engrais', 'pesticides', 'IMMOBILISATIONS', 'phyto', 'PHYTO-SANITAIRE',
    'emballage', 'PESTICIDES', '', 'Divers',
  ]);
  for (const v of echantillon) {
    const une = categorieCanonique(v);
    assert.equal(categorieCanonique(une), une, 'idempotence sur ' + JSON.stringify(v));
  }
});

test('estCategorieCanonique : comparaison EXACTE, casse comprise', () => {
  assert.equal(estCategorieCanonique('Engrais'), true);
  assert.equal(estCategorieCanonique('engrais'), false);
  assert.equal(estCategorieCanonique(''), false);
  assert.equal(estCategorieCanonique(null), false);
});

// ───────────────────────────────────────────────────────────────────────────
// 2. ANTI-DIVERGENCE backend / frontend
// ───────────────────────────────────────────────────────────────────────────
//
// Le backend NE PEUT PAS requérir src/ : Firebase ne déploie que
// functions/, et un `require('../public/…')` ferait échouer le chargement du
// module — TOUTES les Cloud Functions tomberaient, sans qu'aucun test local ne
// le voie (le fichier existe en local). La copie est donc inévitable ; ce test
// est ce qui l'empêche de dériver.

test('ANTI-DIVERGENCE : la liste backend est identique à src/modules/shared/lib, à l’octet près', () => {
  assert.deepEqual(
    BACK.CATEGORIES_ARTICLE,
    FRONT.CATEGORIES_ARTICLE,
    'functions/lib/stockMerge/articleCategories.js a divergé de src/modules/shared/lib/articleCategories.js — '
      + 'les deux listes doivent être modifiées ENSEMBLE (ordre et casse compris).'
  );
  // Même longueur, mêmes libellés, MÊME ORDRE : deepEqual couvre les trois,
  // mais on nomme l'invariant de cardinalité pour que l'échec soit lisible.
  assert.equal(BACK.CATEGORIES_ARTICLE.length, FRONT.CATEGORIES_ARTICLE.length);
});

test('ANTI-DIVERGENCE : ce que le `<select>` propose est canonique côté backend', () => {
  // Contrepartie exécutable : chaque option de la fiche article traverse la
  // règle backend sans être modifiée. Sinon enregistrer une fiche depuis la
  // liste FERMÉE créerait une variante — exactement ce qu'on ferme ici.
  for (const opt of FRONT.optionsCategorie('')) {
    if (opt.value === '') continue;
    assert.equal(categorieCanonique(opt.value), opt.value, 'option « ' + opt.value + ' »');
    assert.equal(estCategorieCanonique(opt.value), true);
  }
});

test('ANTI-DIVERGENCE : les 53 orthographes hors liste de la prod convergent', () => {
  // Mesuré le 2026-08-28 sur les 1019 fiches `active === true` de production
  // (lecture seule, API REST paginée) : 7 orthographes hors liste, 53 fiches.
  //
  // ⚠️ Aucune entrée vide ici, et c'est VOLONTAIRE. Les 5 documents du
  // catalogue sans champ `categorie` (`ENG 0150`, `ENG 0952`, `eng 1245`,
  // `eng 456`, `enr 14`) NE SONT PAS des fiches article : ils n'ont ni `nom`,
  // ni `active`, ni `source`, seulement `prix_ht`/`prix_ttc`/`updated_at`. Ce
  // sont les 5 documents FANTÔMES déjà connus, et ils ne sont pas le sujet de
  // ce lot. Le comportement « une valeur vide reste vide » est couvert par son
  // propre test ci-dessus, sur la valeur d'ENTRÉE — pas sur ces documents-là.
  const MESURE_PROD = {
    engrais: 18,
    pesticides: 12,
    IMMOBILISATIONS: 11,
    phyto: 8,
    'PHYTO-SANITAIRE': 2,
    emballage: 1,
    PESTICIDES: 1,
  };
  assert.equal(Object.values(MESURE_PROD).reduce((a, b) => a + b, 0), 53);

  let corrigees = 0;
  for (const [orthographe, n] of Object.entries(MESURE_PROD)) {
    const apres = categorieCanonique(orthographe);
    // AUCUNE de ces valeurs n'est déjà canonique — c'est la prémisse.
    assert.equal(estCategorieCanonique(orthographe), false, orthographe + ' devrait être hors liste');
    assert.equal(estCategorieCanonique(apres), true, orthographe + ' → ' + apres);
    assert.notEqual(apres, '', orthographe + ' ne doit pas être vidée');
    corrigees += n;
  }
  assert.equal(corrigees, 53, 'les 53 fiches deviennent canoniques au réimport');
});

// ───────────────────────────────────────────────────────────────────────────
// 3. REJEU D'IMPORT — le 30/06 ne recrée rien, et pose le libellé canonique
// ───────────────────────────────────────────────────────────────────────────

/** Formule d'identifiant HISTORIQUE — catégorie BRUTE, délibérément. */
function docIdHistorique(nom, categorie) {
  return Buffer.from(nom + '|' + (categorie || ''))
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 50);
}

/**
 * Rejoue la boucle d'`import-articles-sql` (résolution + écriture) sur un
 * catalogue en mémoire. Reproduit fidèlement l'ordre du handler : docId brut →
 * resolveArticleTarget → écriture de `categorie: categorieCanonique(...)` →
 * rememberArticle.
 * @param {Array<{id:string,nom:string,categorie:string,active?:boolean}>} catalogue muté en place
 * @param {Array<{nom:string,categorie:string}>} lignes
 * @returns {{crees:number, majs:number}}
 */
function rejouerImport(catalogue, lignes) {
  const idx = articleMerge.buildArticleIndex(catalogue);
  let crees = 0;
  let majs = 0;
  for (const ligne of lignes) {
    const nom = (ligne.nom || '').trim();
    if (!nom) continue;
    const docId = docIdHistorique(nom, ligne.categorie);
    const target = articleMerge.resolveArticleTarget(idx, docId, nom);
    const categorie = categorieCanonique(ligne.categorie);
    const existant = catalogue.find((d) => d.id === target.id);
    if (existant) {
      existant.categorie = categorie;
      existant.nom = nom;
      majs++;
    } else {
      catalogue.push({ id: target.id, nom, categorie, active: true });
      crees++;
    }
    if (target.isNew) articleMerge.rememberArticle(idx, target.id, nom);
  }
  return { crees, majs };
}

test('REJEU : un import sur une fiche existante ne crée RIEN et pose le canonique', () => {
  // Fiche telle qu'elle est en production : docId né d'une catégorie brute
  // `Engrais`, mais champ `categorie` posé en minuscules par l'import.
  const idExistant = docIdHistorique('Acide Phosphorique', 'Engrais');
  const catalogue = [
    { id: idExistant, nom: 'Acide Phosphorique', categorie: 'engrais', active: true },
  ];

  const r = rejouerImport(catalogue, [{ nom: 'Acide Phosphorique', categorie: 'Engrais' }]);

  assert.equal(r.crees, 0, 'aucune fiche créée');
  assert.equal(r.majs, 1);
  assert.equal(catalogue.length, 1, 'le catalogue ne grossit pas');
  assert.equal(catalogue[0].id, idExistant, 'la MÊME fiche est adressée (docId inchangé)');
  assert.equal(catalogue[0].categorie, 'Engrais', 'le libellé canonique est posé');
  assert.equal(estCategorieCanonique(catalogue[0].categorie), true);
});

test('REJEU : la source renvoie `engrais`, la fiche devient malgré tout `Engrais`', () => {
  // Le cas qui compte vraiment : c'est la SOURCE SQL qui porte la minuscule.
  // Sans normalisation à l'écriture, le 30/06 réécrirait `engrais`.
  const catalogue = [
    { id: docIdHistorique('MAP', 'engrais'), nom: 'MAP', categorie: 'Engrais', active: true },
  ];
  rejouerImport(catalogue, [{ nom: 'MAP', categorie: 'engrais' }]);
  assert.equal(catalogue.length, 1);
  assert.equal(catalogue[0].categorie, 'Engrais');
});

test('REJEU : deux passes complètes ne créent rien la seconde fois', () => {
  const lignes = [
    { nom: 'Acide Phosphorique', categorie: 'Engrais' },
    { nom: 'ACIDE  PHOSPHORIQUE', categorie: 'engrais' },
    { nom: 'BENEVIA', categorie: 'phyto' },
    { nom: 'Bidon 20L', categorie: '' },
    { nom: 'Tracteur', categorie: 'IMMOBILISATIONS' },
  ];
  const catalogue = [];
  const p1 = rejouerImport(catalogue, lignes);
  assert.equal(p1.crees, 4, '1re passe : 4 fiches (les deux Acide Phosphorique convergent)');
  const p2 = rejouerImport(catalogue, lignes);
  assert.equal(p2.crees, 0, '2e passe : AUCUNE création');
  assert.equal(catalogue.length, 4);

  const parNom = {};
  catalogue.forEach((d) => { parNom[articleMerge.normalizeArticleName(d.nom)] = d.categorie; });
  assert.equal(parNom['acide phosphorique'], 'Engrais');
  assert.equal(parNom.benevia, 'Pesticides', 'le synonyme `phyto` est résolu');
  assert.equal(parNom.tracteur, 'IMMOBILISATION');
  assert.equal(parNom["bidon 20l"], '', 'la fiche sans catégorie reste sans catégorie');
});

test('REJEU : une catégorie inconnue traverse l’import sans être réécrite', () => {
  const catalogue = [];
  rejouerImport(catalogue, [{ nom: 'Produit X', categorie: 'Amendement organique' }]);
  assert.equal(catalogue[0].categorie, 'Amendement organique');
  rejouerImport(catalogue, [{ nom: 'Produit X', categorie: 'Amendement organique' }]);
  assert.equal(catalogue.length, 1, 'et le rejeu ne la duplique pas');
  assert.equal(catalogue[0].categorie, 'Amendement organique');
});
