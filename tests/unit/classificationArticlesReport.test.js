'use strict';

/**
 * classificationArticlesReport.test.js — Chemin complet du rapport de
 * classification, de la liste de bons au texte affiché.
 *
 * On teste `analyser` + `render`, c'est-à-dire EXACTEMENT ce que la CLI
 * exécute : tester le module pur seul ne suffirait pas — une fonctionnalité
 * peut être testée dans le module et inatteignable depuis la ligne de commande
 * (défaut déjà rencontré sur scan-precision-report).
 *
 * Aucune lecture Firestore : `lire()` n'est jamais appelée ici.
 */

const test = require('node:test');
const assert = require('node:assert');

const { parseArgs, analyser, render } = require('../../scripts/classification-articles-report');

const ARTICLES = [
  { nom: 'BENEVIA', categorie: 'Pesticides', active: true },
  { nom: 'Ammonitrate', categorie: 'Engrais', active: true },
  { nom: 'EXTREME', categorie: 'autre', active: true },
  { nom: 'PRIORITOP', categorie: 'Engrais', active: true },
  { nom: 'PRIORI TOP', categorie: 'Pesticides', active: true },
];

const BONS = [
  {
    id: 'b1', numero: 'BC-1', type: 'engrais', cpc_categorie: 'Engrais', date: '2026-08-10',
    items: [
      { article: 'BENEVIA', quantite: 2, unite: 'l', parcelle: 'F1 S1' },
      { article: 'Ammonitrate', quantite: 50, unite: 'kg', parcelle: 'F1 S1' },
      { article: 'EXTREME', quantite: 10, unite: 'kg', parcelle: 'F1 S1' },
      { article: 'EXTREME', quantite: 7.5, unite: 'kg', parcelle: 'F1 S2' },
      { article: 'GENAKTIS', quantite: 8, unite: 'L', parcelle: 'F1 S1' },
      { article: 'PRIORI-TOP', quantite: 3, unite: 'l', parcelle: 'F1 S1' },
    ],
  },
];

test('parseArgs lit les filtres et --json', () => {
  assert.deepStrictEqual(
    parseArgs(['--json', '--campagne', '2026-2027', '--depuis', '2026-07-01', '--jusqu-a', '2027-06-30']),
    { json: true, campagne: '2026-2027', depuis: '2026-07-01', jusquA: '2027-06-30' }
  );
  assert.deepStrictEqual(parseArgs([]), { json: false, campagne: '', depuis: '', jusquA: '' });
});

test('analyser sépare les trois causes et compte les lignes', () => {
  const r = analyser(BONS, ARTICLES, {});
  assert.strictEqual(r.lignes, 6);
  assert.deepStrictEqual(r.familles, { engrais: 1, pesticide: 1, autre: 4 });

  const parArticle = {};
  r.articles_a_classer.forEach((a) => { parArticle[a.article] = a; });
  assert.deepStrictEqual(Object.keys(parArticle).sort(), ['EXTREME', 'GENAKTIS', 'PRIORI-TOP']);
  assert.strictEqual(parArticle.EXTREME.cause, 'catégorie catalogue hors familles');
  assert.strictEqual(parArticle.EXTREME.lignes, 2);
  assert.strictEqual(parArticle.EXTREME.quantite, 17.5);
  assert.strictEqual(parArticle.GENAKTIS.cause, 'absent du catalogue');
  assert.strictEqual(parArticle['PRIORI-TOP'].cause, 'clé ambiguë (2 familles)');
  assert.deepStrictEqual(r.cles_ambigues, ['prioritop']);
  // Aucun doublon de NOM dans cette fixture : la liste byName reste vide.
  assert.deepStrictEqual(r.noms_ambigus, []);
});

test('analyser liste AUSSI les ambiguïtés de nom (doublon franc au catalogue)', () => {
  // Deux fiches ACTIVES, même nom normalisé, DEUX familles : c'est le cas qui
  // rendait une correction d'Omar invisible (il re-catégorise une fiche,
  // l'autre reste en `autre`, l'article reste « à classer »). 0 cas en prod
  // aujourd'hui, mais ~105 doublons connus au catalogue.
  const articles = ARTICLES.concat([{ nom: 'extreme', categorie: 'Engrais', active: true }]);
  const r = analyser(BONS, articles, {});
  assert.deepStrictEqual(r.noms_ambigus, ['extreme']);

  // Et l'article reste à classer, avec la cause « ambiguë » — pas « hors familles ».
  const extreme = r.articles_a_classer.filter((a) => a.article === 'EXTREME')[0];
  assert.ok(extreme, 'EXTREME doit rester à classer malgré la fiche Engrais');
  assert.strictEqual(extreme.cause, 'clé ambiguë (2 familles)');

  const txt = render(r, {});
  assert.ok(txt.indexOf('noms identiques') !== -1, 'la section noms identiques doit exister');
  assert.match(txt, /noms identiques[\s\S]*- extreme/, 'le nom ambigu doit être listé');
});

test('analyser respecte le filtre de campagne', () => {
  const r = analyser(BONS, ARTICLES, { campagne: '2025-2026' });
  assert.strictEqual(r.lignes, 0);
  assert.deepStrictEqual(r.articles_a_classer, []);
});

test('render nomme chaque article à classer et sa cause', () => {
  const txt = render(analyser(BONS, ARTICLES, {}), {});
  assert.ok(txt.indexOf('GENAKTIS') !== -1);
  assert.ok(txt.indexOf('absent du catalogue') !== -1);
  assert.ok(txt.indexOf('clé ambiguë') !== -1);
  assert.ok(txt.indexOf('prioritop') !== -1);
});

test('render sur un périmètre vide ne se lit pas comme « tout est bien classé »', () => {
  const txt = render(analyser([], ARTICLES, {}), {});
  assert.ok(txt.indexOf('Aucune ligne sur ce périmètre') !== -1);
  assert.ok(txt.indexOf('▶ ARTICLES À CLASSER') === -1, 'aucun tableau trompeur');
});

// FILET TEXTUEL FAIBLE, pas une garantie : c'est une recherche de sous-chaîne
// sur le source, qu'un `.set (`, un `db[method](…)` ou un require dynamique
// contournerait sans être vu. Il attrape l'ajout distrait d'un `.update(`, rien
// de plus — ne pas le lire comme une preuve que le script est read-only.
test('le script ne contient aucune écriture Firestore', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require.resolve('../../scripts/classification-articles-report'), 'utf8');
  for (const interdit of ['.set(', '.update(', '.delete(', '.add(', '.batch(']) {
    assert.strictEqual(src.indexOf(interdit), -1, 'écriture interdite trouvée : ' + interdit);
  }
});
