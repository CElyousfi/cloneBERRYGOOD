'use strict';

// Tests pour deriveFerme() — classification ferme à partir de Ref_parcelle /
// Parcelle_Culturale (pointage/quinzaine). BAHIA est une ferme à part entière
// (cf. profil chef_bahia) et doit primer sur la détection Avocatier.

const { test } = require('node:test');
const assert = require('node:assert');
const { deriveFerme } = require('../../functions/pointageService.js');

test('BAHIA détecté via Ref_parcelle', () => {
  assert.equal(deriveFerme('BAHIA-01', ''), 'BAHIA');
});

test('BAHIA détecté via Parcelle_Culturale (prime sur Avocatier)', () => {
  assert.equal(deriveFerme('', 'Avocat Bahia P1'), 'BAHIA');
});

test('BAHIA insensible à la casse', () => {
  assert.equal(deriveFerme('bahia z', ''), 'BAHIA');
});

test('F1 inchangé', () => {
  assert.equal(deriveFerme('F1-S1', ''), 'F1');
});

test('F5 inchangé', () => {
  assert.equal(deriveFerme('F5-01', ''), 'F5');
});

test('Avocatier (non-BAHIA) inchangé', () => {
  assert.equal(deriveFerme('F2-01', ''), 'Avocatier');
});

test('Parcelle avocat sans BAHIA reste Avocatier', () => {
  assert.equal(deriveFerme('', 'Avocat Larache'), 'Avocatier');
});

test('Inconnu => Autre', () => {
  assert.equal(deriveFerme('ZZZ-99', 'inconnu'), 'Autre');
});
