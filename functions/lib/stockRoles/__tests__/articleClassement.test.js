'use strict';

/**
 * Sélection des fiches à reclasser depuis un NOM d'article.
 *
 * Ce que ces tests gardent : le piège des DOUBLONS. Le catalogue porte ~105
 * paires de fiches actives de même nom normalisé ; n'en reclasser qu'une rend
 * la clé AMBIGUË en amont (`lookupArticleCategorie`) et l'article RESTE « à
 * classer » — la correction paraît sans effet.
 *
 * La mutation « ne renvoyer que la première fiche trouvée » (`return [out[0]]`
 * / `break` après le premier match) doit rendre ce fichier ROUGE.
 */

const test = require('node:test');
const assert = require('node:assert');

const { fichesAClasserParNom, referencesAClasserParNom } = require('../articleClassement');

const CATALOGUE = [
  { id: 'ART-1', nom: 'EXTREME', categorie: 'divers', active: true },
  { id: 'ART-2', nom: 'Extrême ', categorie: '', active: true }, // même nom normalisé
  { id: 'ART-3', nom: 'BENEVIA', categorie: 'pesticide', active: true },
  { id: 'ART-4', nom: 'EXTREME', categorie: 'engrais', active: false }, // désactivée
];

test('un nom porté par DEUX fiches actives les renvoie TOUTES LES DEUX', () => {
  const refs = referencesAClasserParNom(CATALOGUE, 'EXTREME');
  assert.strictEqual(
    refs.length,
    2,
    'les 2 fiches actives de même nom normalisé doivent être reclassées : '
      + 'en oublier une rend la clé ambiguë et l\'article reste « à classer »'
  );
  assert.deepStrictEqual(refs.sort(), ['ART-1', 'ART-2']);
});

test('la normalisation couvre casse, accents et espaces (même règle que la détection de doublons)', () => {
  assert.deepStrictEqual(referencesAClasserParNom(CATALOGUE, '  extreme ').sort(), ['ART-1', 'ART-2']);
  assert.deepStrictEqual(referencesAClasserParNom(CATALOGUE, 'Extrême').sort(), ['ART-1', 'ART-2']);
});

test('les fiches INACTIVES sont exclues (une fiche fusionnée n\'est pas une source de vérité)', () => {
  const refs = referencesAClasserParNom(CATALOGUE, 'EXTREME');
  assert.ok(!refs.includes('ART-4'), 'ART-4 est active:false, elle ne doit pas être ressuscitée');
});

test('un nom inexistant au catalogue ne renvoie RIEN (aucune création implicite)', () => {
  assert.deepStrictEqual(referencesAClasserParNom(CATALOGUE, 'GENAKTIS'), []);
  assert.deepStrictEqual(referencesAClasserParNom(CATALOGUE, 'Maspilan'), []);
});

test('entrées dégénérées : nom vide, docs absents, doc sans id', () => {
  assert.deepStrictEqual(referencesAClasserParNom(CATALOGUE, ''), []);
  assert.deepStrictEqual(referencesAClasserParNom(CATALOGUE, null), []);
  assert.deepStrictEqual(referencesAClasserParNom(null, 'EXTREME'), []);
  assert.deepStrictEqual(referencesAClasserParNom([{ nom: 'EXTREME', active: true }], 'EXTREME'), []);
});

test('fichesAClasserParNom renvoie les documents complets (catégorie actuelle lisible)', () => {
  const fiches = fichesAClasserParNom(CATALOGUE, 'BENEVIA');
  assert.strictEqual(fiches.length, 1);
  assert.strictEqual(fiches[0].categorie, 'pesticide');
});
