'use strict';

// PRT_initialHaVal / PRT_buildSavePayload — logique pure de la ligne
// d'édition « Parcelles & Référentiel MO » (PRT_EditRow), chargée via `vm`
// depuis src/modules/agronomie/ParcellesReferentielTab.jsx (même
// technique que tests/unit/parcellesReferentielFilter.test.js : pas de DOM,
// pas de RTL disponible sur ce monolithe).
//
// Objet des tests :
// a) haVal — fix bug « Sauver » : un save sans Ha jamais édité ne doit plus
//    échouer silencieusement à la validation.
// b) culture_sb — fix QA « À CORRIGER » : le payload envoyé au backend ne
//    doit contenir `culture_sb` QUE si l'utilisateur a effectivement
//    modifié le dropdown Culture (cultureTouched), jamais de façon
//    inconditionnelle.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadComponent } = require('./_esm');

function loadModule() {
  const sandbox = { window: { React: { createElement: function () {}, useState: function () {}, useEffect: function () {}, useMemo: function () {} } } };
  return loadComponent('src/modules/agronomie/ParcellesReferentielTab.jsx', sandbox).ParcellesReferentielTab;
}

const PRT = loadModule();
const initialHaVal = PRT.initialHaVal;
const buildSavePayload = PRT.buildSavePayload;

// ---- a) initialHaVal ---------------------------------------------------

test('initialHaVal : sbEntry.ha défini (non nul, non 0) → conservé tel quel', () => {
  assert.strictEqual(initialHaVal({ ha: 2.5 }, { sup: 9 }), '2.5');
});

test('initialHaVal : sbEntry.ha === 0 → conservé (0), pas de fallback sur r.sup', () => {
  // Cas explicitement cité par le fix : Ha=0 est une valeur légitime du
  // référentiel SB, ne doit pas être traité comme "absent".
  assert.strictEqual(initialHaVal({ ha: 0 }, { sup: 9 }), '0');
});

test('initialHaVal : pas de sbEntry → fallback sur r.sup (surface BEE ONE)', () => {
  assert.strictEqual(initialHaVal(null, { sup: 4.2 }), '4.2');
  assert.strictEqual(initialHaVal(undefined, { sup: '4.2' }), '4.2');
});

test('initialHaVal : sbEntry sans ha (undefined/vide) → fallback sur r.sup', () => {
  assert.strictEqual(initialHaVal({}, { sup: 3 }), '3');
  assert.strictEqual(initialHaVal({ ha: null }, { sup: 3 }), '3');
  assert.strictEqual(initialHaVal({ ha: '' }, { sup: 3 }), '3');
});

test('initialHaVal : ni sbEntry.ha ni r.sup exploitables → chaîne vide (pas de crash)', () => {
  assert.strictEqual(initialHaVal(null, {}), '');
  assert.strictEqual(initialHaVal(null, { sup: 'abc' }), '');
  assert.strictEqual(initialHaVal(null, null), '');
});

// ---- b) buildSavePayload -------------------------------------------------

test('buildSavePayload : culture NON touchée → culture_sb absent du payload', () => {
  // NB : objet renvoyé depuis le realm `vm` → comparer les clés/valeurs
  // individuellement, pas deepStrictEqual (échoue cross-realm, cf. commentaire
  // équivalent dans parcellesReferentielFilter.test.js).
  const payload = buildSavePayload({
    label: 'S02 KWANZA F1', nomVal: 'Nom édité', haNum: 1.5,
    cultureVal: 'Framboise', cultureTouched: false,
  });
  assert.strictEqual(payload.label_bee_one, 'S02 KWANZA F1');
  assert.strictEqual(payload.nom_sb, 'Nom édité');
  assert.strictEqual(payload.ha, 1.5);
  assert.strictEqual(Object.keys(payload).length, 3);
  assert.ok(!('culture_sb' in payload), 'culture_sb ne doit pas être envoyé');
});

test('buildSavePayload : culture touchée → culture_sb inclus', () => {
  const payload = buildSavePayload({
    label: 'S02 KWANZA F1', nomVal: 'Nom édité', haNum: 1.5,
    cultureVal: 'Myrtille', cultureTouched: true,
  });
  assert.strictEqual(payload.label_bee_one, 'S02 KWANZA F1');
  assert.strictEqual(payload.nom_sb, 'Nom édité');
  assert.strictEqual(payload.ha, 1.5);
  assert.strictEqual(payload.culture_sb, 'Myrtille');
  assert.strictEqual(Object.keys(payload).length, 4);
});

test('buildSavePayload : save du Ha seul (nom vide) sans toucher la culture → toujours pas de culture_sb', () => {
  const payload = buildSavePayload({
    label: 'S10 YAZMIN CUT BACK F5', nomVal: '', haNum: 0,
    cultureVal: 'Avocatier', cultureTouched: false,
  });
  assert.ok(!('culture_sb' in payload));
  assert.strictEqual(payload.ha, 0);
});

test('buildSavePayload : nom_sb toujours trim()', () => {
  const payload = buildSavePayload({
    label: 'X', nomVal: '  Nom avec espaces  ', haNum: 1,
    cultureVal: 'Framboise', cultureTouched: false,
  });
  assert.strictEqual(payload.nom_sb, 'Nom avec espaces');
});
