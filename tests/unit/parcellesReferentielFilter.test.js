'use strict';

// PRT_filterRows — filtre de la barre de recherche de l'écran
// « Parcelles & Référentiel MO ». Helper PUR, chargé via `vm` depuis l'IIFE
// src/modules/agronomie/ParcellesReferentielTab.jsx (même technique que
// tests/unit/parcellesGroupesPanel.test.js : pas de DOM, pas de RTL).
//
// Objet du test : la recherche doit aussi porter sur le NOM SMART BERRY
// (sbMap[label].nom_sb), qui est le nom réellement AFFICHÉ quand il existe.
// Avant le correctif, taper « MYRTILLE EXTENSION » ne trouvait rien alors que
// c'est ce que l'utilisateur lit à l'écran.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadComponent } = require('./_esm');

function loadFilterRows() {
  const sandbox = { window: { React: { createElement: function () {}, useState: function () {}, useEffect: function () {}, useMemo: function () {} } } };
  return loadComponent('src/modules/agronomie/ParcellesReferentielTab.jsx', sandbox).ParcellesReferentielTab.filterRows;
}

const filterRows = loadFilterRows();

// Cas réel prod : le doc BEE ONE porte un nom SB différent.
const YAZMIN = { ref: '0037', label: 'S10 YAZMIN CUT BACK F5', culture: 'Myrtille', ferme: 'F5', variete: 'Corina' };
const KWANZA = { ref: '0012', label: 'S02 KWANZA F1', culture: 'Framboise', ferme: 'F1', variete: 'Kwanza' };
const SANS_SB = { ref: '0099', label: 'S99 ADELITA F1', culture: 'Framboise', ferme: 'F1', variete: 'Adelita' };

const ROWS = [YAZMIN, KWANZA, SANS_SB];

// Clés = libellé BEE ONE en MAJUSCULES trimé (même résolution que PGP_displayName).
const SB_MAP = {
  'S10 YAZMIN CUT BACK F5': { nom_sb: 'F5 - MYRTILLE EXTENSION', ha: 2.5 },
  'S02 KWANZA F1': { nom_sb: '', ha: 1 },
};

const labels = (rows) => rows.map((r) => r.ref);

test('recherche vide → toutes les lignes', () => {
  assert.deepStrictEqual(labels(filterRows(ROWS, '', SB_MAP)), ['0037', '0012', '0099']);
  assert.deepStrictEqual(labels(filterRows(ROWS, null, SB_MAP)), ['0037', '0012', '0099']);
});

test('recherche sur le nom Smart Berry trouve la parcelle', () => {
  assert.deepStrictEqual(labels(filterRows(ROWS, 'MYRTILLE EXTENSION', SB_MAP)), ['0037']);
});

test('le libellé BEE ONE reste cherché (non-régression)', () => {
  assert.deepStrictEqual(labels(filterRows(ROWS, 'YAZMIN', SB_MAP)), ['0037']);
  assert.deepStrictEqual(labels(filterRows(ROWS, 'CUT BACK', SB_MAP)), ['0037']);
});

test('culture / ferme / variété restent cherchées (non-régression)', () => {
  assert.deepStrictEqual(labels(filterRows(ROWS, 'framboise', SB_MAP)), ['0012', '0099']);
  assert.deepStrictEqual(labels(filterRows(ROWS, 'F1', SB_MAP)), ['0012', '0099']);
  assert.deepStrictEqual(labels(filterRows(ROWS, 'adelita', SB_MAP)), ['0099']);
});

test('casse et espaces internes indifférents sur le nom SB', () => {
  assert.deepStrictEqual(labels(filterRows(ROWS, 'myrtille extension', SB_MAP)), ['0037']);
  assert.deepStrictEqual(labels(filterRows(ROWS, 'F5 - MyRtIlLe', SB_MAP)), ['0037']);
});

test('nom SB entouré d\'espaces dans la donnée : trouvé quand même', () => {
  const map = { 'S02 KWANZA F1': { nom_sb: '  F1 - PARCELLE NORD  ' } };
  assert.deepStrictEqual(labels(filterRows(ROWS, 'PARCELLE NORD', map)), ['0012']);
});

test('nom_sb vide / blanc / absent ne fait jamais matcher', () => {
  const map = {
    'S10 YAZMIN CUT BACK F5': { nom_sb: '   ' },
    'S02 KWANZA F1': { nom_sb: '' },
    'S99 ADELITA F1': { ha: 3 },
  };
  // une recherche d'espaces ne doit pas ramener les lignes à nom_sb blanc
  assert.deepStrictEqual(labels(filterRows(ROWS, '   ', map)), []);
  // et la recherche normale sur le libellé fonctionne toujours
  assert.deepStrictEqual(labels(filterRows(ROWS, 'KWANZA', map)), ['0012']);
});

test('sbMap absent ou clé inconnue : pas de crash, filtre BEE ONE seul', () => {
  assert.deepStrictEqual(labels(filterRows(ROWS, 'YAZMIN')), ['0037']);
  assert.deepStrictEqual(labels(filterRows(ROWS, 'MYRTILLE EXTENSION')), []);
  assert.deepStrictEqual(labels(filterRows(ROWS, 'YAZMIN', {})), ['0037']);
  assert.deepStrictEqual(labels(filterRows(ROWS, 'YAZMIN', null)), ['0037']);
});

test('nom_sb non-string (nombre) ne jette pas', () => {
  const map = { 'S02 KWANZA F1': { nom_sb: 2026 } };
  assert.deepStrictEqual(labels(filterRows(ROWS, '2026', map)), ['0012']);
});

test('lignes vides / champs manquants : pas de crash', () => {
  // NB : les tableaux renvoyés viennent du realm `vm` → comparer les longueurs,
  // pas d'égalité stricte de prototype (deepStrictEqual échoue cross-realm).
  assert.strictEqual(filterRows(null, 'X', SB_MAP).length, 0);
  assert.strictEqual(filterRows([{}], 'X', SB_MAP).length, 0);
});
