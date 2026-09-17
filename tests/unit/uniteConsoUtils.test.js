'use strict';

/*
 * uniteConsoUtils.test.js — copie FRONT de la conversion d'unité de
 * consommation, et surtout : ÉGALITÉ DE COMPORTEMENT avec la copie backend.
 *
 * La duplication public/lib ↔ functions/lib est volontaire (le backend ne peut
 * pas require('../public/…') : Firebase ne déploie que functions/). Le risque
 * n'est donc pas la duplication, c'est la DÉRIVE : une correction posée d'un
 * seul côté ferait diverger l'aperçu montré au magasinier de la déduction
 * réellement appliquée au stock. Ce fichier fait passer les MÊMES cas dans les
 * deux copies et exige le même résultat.
 *
 * Fixtures = les cinq conversions réelles données par Omar (équivalences de
 * contenant → densité), qui couvrent 72 des 87 lignes divergentes mesurées.
 */

const test = require('node:test');
const assert = require('node:assert');

const FRONT = require('./_esm').loadEsm('src/modules/shared/lib/uniteConsoUtils.js');
const BACK = require('../../functions/lib/uniteConso/index.js');

const FICHES = [
  { nom: 'Acide Sulfurique', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.75 },
  { nom: 'Acide Nitrique', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.32 },
  { nom: 'Acide Phosphorique', unite: 'Kg', unite_consommation: 'L', stock_par_unite_consommation: 1.6 },
  { nom: 'Rhizo Humus', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 25 / 24 },
  { nom: 'Rhizo amine', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 20 / 18 },
  { nom: 'UREE 46', unite: 'KG' },
  { nom: 'M-K-P', unite: 'L' },
  { nom: 'PRIORITOP', unite: 'L', unite_consommation: 'kg', stock_par_unite_consommation: '0' },
  // ── FICHES HOMONYMES ─────────────────────────────────────────────────────
  // Le catalogue porte ~105 paires de jumelles. La règle d'ambiguïté est la
  // SEULE règle fail-closed non triviale du module : sans homonyme dans ces
  // fixtures, la comparaison front↔back ne l'atteint jamais, et les deux
  // copies peuvent diverger dessus en silence — l'écran annoncerait une
  // conversion que le serveur n'applique pas.
  // Paire EN DÉSACCORD (facteurs différents) → doit rendre l'article ambigu.
  { nom: 'Acide Chlorhydrique', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.18 },
  { nom: 'acide chlorhydrique', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.4 },
  // Paire D'ACCORD (même conversion, casse différente) → une seule fiche utile.
  { nom: 'Rhizo Force', unite: 'KG', unite_consommation: 'L', stock_par_unite_consommation: 1.05 },
  { nom: 'RHIZO FORCE', unite: 'kg', unite_consommation: 'l', stock_par_unite_consommation: 1.05 },
  // Paire en désaccord sur l'UNITÉ DE STOCK seule (même facteur absent).
  { nom: 'Bore', unite: 'KG' },
  { nom: 'BORE', unite: 'L' },
];

/** Cas de saisie balayant conversion, égalité d'unité et fail-closed. */
const SAISIES = [
  { article: 'Acide Nitrique', quantite: 5, unite: 'L' },
  { article: 'Acide Nitrique', quantite: 25, unite: 'L' },
  { article: 'Acide Nitrique', quantite: 33, unite: 'KG' },
  { article: 'Acide Sulfurique', quantite: 20, unite: 'L' },
  { article: 'Acide Phosphorique', quantite: 20, unite: 'l' },
  { article: 'Rhizo Humus', quantite: 24, unite: 'L' },
  { article: 'Rhizo amine', quantite: 18, unite: 'L' },
  { article: 'UREE 46', quantite: 10, unite: 'kg' },
  { article: 'M-K-P', quantite: 5, unite: 'kg' },
  { article: 'PRIORITOP', quantite: 2, unite: 'kg' },
  { article: 'GENAKTIS', quantite: 3, unite: 'L' },
  { article: 'Acide Nitrique', quantite: 'abc', unite: 'L' },
  { article: 'Acide Nitrique', quantite: '2,5', unite: 'L' },
  { article: 'Acide Chlorhydrique', quantite: 10, unite: 'L' },
  { article: 'acide chlorhydrique', quantite: 10, unite: 'KG' },
  { article: 'Rhizo Force', quantite: 10, unite: 'L' },
  { article: 'RHIZO FORCE', quantite: 10, unite: 'l' },
  { article: 'Bore', quantite: 4, unite: 'KG' },
];

test('les deux copies rendent EXACTEMENT le même verdict sur chaque cas', () => {
  const idxF = FRONT.indexerArticles(FICHES);
  const idxB = BACK.indexerArticles(FICHES);
  for (const s of SAISIES) {
    const vF = FRONT.convertirQuantite(s, FRONT.trouverArticle(idxF, s.article));
    const vB = BACK.convertirQuantite(s, BACK.trouverArticle(idxB, s.article));
    assert.deepEqual(vF, vB, JSON.stringify(s));
  }
});

test('les deux copies proposent les mêmes unités et la même phrase', () => {
  for (const f of FICHES) {
    assert.deepEqual(FRONT.unitesSaisissables(f), BACK.unitesSaisissables(f), f.nom);
    assert.equal(FRONT.phraseConversion(f), BACK.phraseConversion(f), f.nom);
  }
});

test('les deux copies signalent les mêmes lignes non convertibles', () => {
  const resF = FRONT.analyserLignes(SAISIES, FRONT.indexerArticles(FICHES));
  const resB = BACK.analyserLignes(SAISIES, BACK.indexerArticles(FICHES));
  assert.deepEqual(resF.non_convertibles, resB.non_convertibles);
  // Le filet doit rester non vide sur ces fixtures, sinon le test ci-dessus
  // passerait « au vert » en ne comparant que deux listes vides.
  assert.ok(resF.non_convertibles.length >= 4, 'les cas fail-closed doivent bien être signalés');
});

test('les deux copies indexent les fiches HOMONYMES à l\'identique', () => {
  // La comparaison porte sur l'INDEX lui-même, pas seulement sur des verdicts :
  // une divergence de la règle d'ambiguïté (« garder la première fiche » d'un
  // côté, « refuser » de l'autre) doit rougir ici, même si aucun cas de saisie
  // ne l'atteint. C'est le trou qu'une mutation front-seule avait traversé.
  const idxF = FRONT.indexerArticles(FICHES);
  const idxB = BACK.indexerArticles(FICHES);
  assert.deepEqual(Object.keys(idxF).sort(), Object.keys(idxB).sort());
  for (const k of Object.keys(idxF)) assert.deepEqual(idxF[k], idxB[k], k);

  for (const nom of ['Acide Chlorhydrique', 'acide CHLORHYDRIQUE', 'Bore']) {
    assert.equal(FRONT.trouverArticle(idxF, nom), null, nom + ' : jumelles en désaccord → aucune fiche élue');
    assert.equal(BACK.trouverArticle(idxB, nom), null, nom);
    assert.equal(FRONT.estAmbigu(idxF, nom), true, nom);
    assert.equal(BACK.estAmbigu(idxB, nom), true, nom);
  }
  // …et deux jumelles D'ACCORD restent exploitables (sinon la règle
  // fail-closed condamnerait la moitié du catalogue).
  const force = FRONT.trouverArticle(idxF, 'rhizo force');
  assert.ok(force, 'des jumelles d\'accord ne doivent pas rendre l\'article ambigu');
  assert.deepEqual(force, BACK.trouverArticle(idxB, 'rhizo force'));
  assert.equal(FRONT.estAmbigu(idxF, 'Rhizo Force'), false);
  assert.equal(FRONT.convertirQuantite({ article: 'Rhizo Force', quantite: 10, unite: 'L' }, force).quantite_stock, 10.5);
  // Un article ABSENT n'est pas « ambigu » : les deux cas se disent
  // différemment à l'écran, ils ne doivent pas se confondre.
  assert.equal(FRONT.estAmbigu(idxF, 'GENAKTIS'), false);
  assert.equal(BACK.estAmbigu(idxB, 'GENAKTIS'), false);
});

test('copie FRONT — le test de référence : 5 L d\'Acide Nitrique déduisent 6,6 KG', () => {
  const fiche = FICHES[1];
  const v = FRONT.convertirQuantite({ article: 'Acide Nitrique', quantite: 5, unite: 'L' }, fiche);
  assert.equal(v.quantite_stock, 6.6);
  assert.equal(v.unite_stock, 'KG');
  assert.equal(FRONT.phraseConversion(fiche), '1 L = 1.32 KG');
});

test('copie FRONT — le module ES exporte son API (sinon le sélecteur d\'unité est inerte)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../src/modules/shared/lib/uniteConsoUtils.js'), 'utf8');
  assert.match(src, /^export \{ [^}]*\bconvertirQuantite\b/m, 'export ES nommé attendu');
  assert.doesNotMatch(src, /window\.UniteConsoUtils|module\.exports/, 'plus de shim UMD');
});
