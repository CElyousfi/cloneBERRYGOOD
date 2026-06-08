'use strict';

/**
 * Fusion d'articles en doublon — tests purs.
 * Couvre normalizeArticleName, groupDuplicates, isMovementOpen, isBdcOpen.
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../functions/lib/stockMerge/articleMerge.js');

test('normalizeArticleName: minuscules + trim + accents + espaces multiples', () => {
  assert.equal(M.normalizeArticleName('  Acide   Phosphorique  '), 'acide phosphorique');
  assert.equal(M.normalizeArticleName('ACIDE PHOSPHORIQUE'), 'acide phosphorique');
  assert.equal(M.normalizeArticleName('Élément Numéro Ç'), 'element numero c');
  assert.equal(M.normalizeArticleName('Engrais\tNPK\n12'), 'engrais npk 12');
});

test('normalizeArticleName: valeurs nulles / non-string -> chaîne vide ou string', () => {
  assert.equal(M.normalizeArticleName(null), '');
  assert.equal(M.normalizeArticleName(undefined), '');
  assert.equal(M.normalizeArticleName(''), '');
  assert.equal(M.normalizeArticleName(123), '123');
});

test('groupDuplicates: regroupe par nom normalisé, >=2 seulement', () => {
  const articles = [
    { reference: 'A1', nom: 'Acide Phosphorique', categorie: 'Engrais', unite: 'L', active: true },
    { reference: 'A2', nom: 'ACIDE  PHOSPHORIQUE', categorie: 'engrais', unite: 'L', active: true },
    { reference: 'B1', nom: 'Sac plastique', active: true },
  ];
  const groups = M.groupDuplicates(articles);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].normalized, 'acide phosphorique');
  assert.equal(groups[0].articles.length, 2);
  assert.deepEqual(groups[0].articles.map((a) => a.reference).sort(), ['A1', 'A2']);
});

test('groupDuplicates: ignore active=false et noms vides', () => {
  const articles = [
    { reference: 'A1', nom: 'Gants', active: true },
    { reference: 'A2', nom: 'GANTS', active: false },
    { reference: 'A3', nom: '   ', active: true },
    { reference: 'A4', nom: 'GANTS', active: true },
  ];
  const groups = M.groupDuplicates(articles);
  // A2 inactif exclu -> A1+A4 = doublon
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].articles.map((a) => a.reference).sort(), ['A1', 'A4']);
});

test('groupDuplicates: entrée vide / non-array -> []', () => {
  assert.deepEqual(M.groupDuplicates([]), []);
  assert.deepEqual(M.groupDuplicates(null), []);
  assert.deepEqual(M.groupDuplicates(undefined), []);
});

test('isMovementOpen: reception/sortie ouverts seulement avant valide_chef', () => {
  assert.equal(M.isMovementOpen({ type: 'reception', status: 'valide_mag' }), true);
  assert.equal(M.isMovementOpen({ type: 'reception', status: 'valide_achats' }), true);
  assert.equal(M.isMovementOpen({ type: 'sortie', status: 'valide_mag' }), true);
  assert.equal(M.isMovementOpen({ type: 'reception', status: 'valide_chef' }), false);
  assert.equal(M.isMovementOpen({ type: 'reception', status: 'rejete' }), false);
});

test('isMovementOpen: transfert/consommation jamais ouverts (impact immédiat)', () => {
  assert.equal(M.isMovementOpen({ type: 'transfert', status: 'valide_chef' }), false);
  assert.equal(M.isMovementOpen({ type: 'consommation', status: 'valide_chef' }), false);
  assert.equal(M.isMovementOpen(null), false);
});

test('réassignation: une clé doublon avec accents/double-espace matche la valeur normalisée', () => {
  // Le set des clés doublon est construit avec normalizeArticleName (comme la détection).
  // Un item référençant le doublon avec accents ou espaces différents doit matcher.
  const doublonNom = 'Acide  Phosphorique'; // double espace
  const key = M.normalizeArticleName(doublonNom);
  const doublonKeysNorm = new Set([key]);
  const itemMatches = (v) => doublonKeysNorm.has(M.normalizeArticleName(v));

  // item avec accents + simple espace + casse différente -> doit matcher la même clé
  assert.equal(itemMatches('acidé phosphorique'), true);
  assert.equal(itemMatches('ACIDE   PHOSPHORIQUE'), true);
  assert.equal(itemMatches('  Acide Phosphorique  '), true);
  // item hors groupe -> ne matche pas
  assert.equal(itemMatches('Acide Nitrique'), false);
});

test('réassignation: clé construite depuis ref ET nom, vide ignorée', () => {
  const doublonKeysNorm = new Set([
    M.normalizeArticleName('REF-Çà'),
    M.normalizeArticleName('Gants  Nitrile'),
  ]);
  doublonKeysNorm.delete('');
  const itemMatches = (v) => doublonKeysNorm.has(M.normalizeArticleName(v));
  assert.equal(itemMatches('ref-ca'), true); // ref normalisée
  assert.equal(itemMatches('GANTS NITRILE'), true); // nom normalisé
  assert.equal(itemMatches(''), false); // vide jamais matché
  assert.equal(itemMatches(null), false);
});

test('isBdcOpen: clôturés non réassignables, autres ouverts', () => {
  assert.equal(M.isBdcOpen({ status: 'brouillon' }), true);
  assert.equal(M.isBdcOpen({ status: 'rejete' }), true);
  assert.equal(M.isBdcOpen({ status: 'en_attente_chef' }), true);
  assert.equal(M.isBdcOpen({ status: 'en_attente_dg' }), true);
  assert.equal(M.isBdcOpen({ status: 'envoye' }), false);
  assert.equal(M.isBdcOpen({ status: 'valide_dg' }), false);
  assert.equal(M.isBdcOpen({ status: 'annule' }), false);
});
