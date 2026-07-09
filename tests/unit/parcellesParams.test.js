'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  aggregateParcellesFromMirror,
  mergeReferentiel,
  isValidCampagneLabel,
} = require('../../functions/lib/pointage/parcellesParams');

// deriveFerme factice : simule le contrat (ref F5* → 'F5', ref F1* → 'F1', sinon 'Autre').
function fakeDeriveFerme(ref) {
  const r = ref == null ? '' : String(ref).trim();
  if (r.startsWith('F5')) return 'F5';
  if (r.startsWith('F1')) return 'F1';
  return 'Autre';
}

test('aggregateParcellesFromMirror — parcelles distinctes triées, first-non-empty', () => {
  const rows = [
    { Ref_parcelle: 'F5-01', Parcelle_Culturale: 'F5 YAZMIN MT', Variete: 'Yazmin', Culture: 'Framboise', DateStr: '2026-07-02' },
    { Ref_parcelle: 'F5-01', Parcelle_Culturale: 'F5 YAZMIN MT', Variete: '', Culture: '', DateStr: '2026-07-03' },
    { Ref_parcelle: 'F1-09', Parcelle_Culturale: 'F1 CORINA', Variete: 'Corina', Culture: 'Myrtille', DateStr: '2026-07-02' },
  ];
  const out = aggregateParcellesFromMirror(rows, fakeDeriveFerme, '2026-2027');
  assert.strictEqual(out.length, 2);
  // tri par ref croissant : F1-09 avant F5-01
  assert.strictEqual(out[0].ref, 'F1-09');
  assert.strictEqual(out[0].ferme, 'F1');
  assert.strictEqual(out[1].ref, 'F5-01');
  assert.strictEqual(out[1].label, 'F5 YAZMIN MT');
  assert.strictEqual(out[1].variete, 'Yazmin');
  assert.strictEqual(out[1].culture, 'Framboise');
  assert.strictEqual(out[1].statut, 'active');
});

test('aggregateParcellesFromMirror — ignore les lignes sans ref exploitable', () => {
  const rows = [
    { Ref_parcelle: '', Parcelle_Culturale: 'Sans ref', DateStr: '2026-07-02' },
    { Ref_parcelle: null, Parcelle_Culturale: 'Null ref', DateStr: '2026-07-02' },
    { Ref_parcelle: '  ', Parcelle_Culturale: 'Blank ref', DateStr: '2026-07-02' },
    { Ref_parcelle: 'F5-02', Parcelle_Culturale: 'F5 X', DateStr: '2026-07-02' },
  ];
  const out = aggregateParcellesFromMirror(rows, fakeDeriveFerme, '2026-2027');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].ref, 'F5-02');
});

test('aggregateParcellesFromMirror — entrées vides / non-array → []', () => {
  assert.deepStrictEqual(aggregateParcellesFromMirror([], fakeDeriveFerme, '2026-2027'), []);
  assert.deepStrictEqual(aggregateParcellesFromMirror(null, fakeDeriveFerme, '2026-2027'), []);
  assert.deepStrictEqual(aggregateParcellesFromMirror(undefined, fakeDeriveFerme, '2026-2027'), []);
});

test('mergeReferentiel — référentiel VIDE → surface manquante, campagne_assignee = dérivée', () => {
  const parcelles = [
    { ref: 'F5-01', label: 'F5 YAZMIN MT', ferme: 'F5', culture: 'Framboise', variete: 'Yazmin', statut: 'active' },
  ];
  const out = mergeReferentiel(parcelles, new Map(), '2026-2027');
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].surface_ha, null);
  assert.strictEqual(out[0].surface_source, 'manquante');
  assert.strictEqual(out[0].campagne_derivee, '2026-2027');
  assert.strictEqual(out[0].campagne_assignee, '2026-2027');
});

test('mergeReferentiel — surface BEE ONE présente → beeone', () => {
  const parcelles = [{ ref: 'F5-01', label: 'L', ferme: 'F5', culture: 'C', variete: 'V', statut: 'active' }];
  const refByKey = new Map([
    ['2026-2027__F5-01', { surface_ha: 1.9 }],
  ]);
  const out = mergeReferentiel(parcelles, refByKey, '2026-2027');
  assert.strictEqual(out[0].surface_ha, 1.9);
  assert.strictEqual(out[0].surface_source, 'beeone');
});

test('mergeReferentiel — surface_ha non numérique / NaN → manquante (pas de fallback)', () => {
  const parcelles = [{ ref: 'A', label: 'L', ferme: 'F1', culture: '', variete: '', statut: 'active' }];
  for (const bad of [{ surface_ha: 'oups' }, { surface_ha: NaN }, { surface_ha: null }, {}]) {
    const out = mergeReferentiel(parcelles, new Map([['2026-2027__A', bad]]), '2026-2027');
    assert.strictEqual(out[0].surface_ha, null);
    assert.strictEqual(out[0].surface_source, 'manquante');
  }
});

test('mergeReferentiel — override campagne_assignee manuel prime sur la dérivée', () => {
  const parcelles = [{ ref: 'B', label: 'L', ferme: 'F1', culture: '', variete: '', statut: 'active' }];
  const refByKey = new Map([['2026-2027__B', { campagne_assignee: '2027-2028' }]]);
  const out = mergeReferentiel(parcelles, refByKey, '2026-2027');
  assert.strictEqual(out[0].campagne_derivee, '2026-2027');
  assert.strictEqual(out[0].campagne_assignee, '2027-2028');
});

test('isValidCampagneLabel — bornes cohérentes', () => {
  assert.strictEqual(isValidCampagneLabel('2026-2027'), true);
  assert.strictEqual(isValidCampagneLabel('2025-2026'), true);
  assert.strictEqual(isValidCampagneLabel('2026-2028'), false); // pas +1
  assert.strictEqual(isValidCampagneLabel('2026'), false);
  assert.strictEqual(isValidCampagneLabel(''), false);
  assert.strictEqual(isValidCampagneLabel(null), false);
  assert.strictEqual(isValidCampagneLabel('abcd-efgh'), false);
});
