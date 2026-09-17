'use strict';

/**
 * Tests de la copie FRONTEND du split au prorata des Ha.
 *
 * ⚠️ FIXTURES PARTAGÉES avec la copie backend :
 * `functions/lib/parcelleGroupes/__tests__/split.test.js` utilise EXACTEMENT
 * les mêmes cas. Le dernier test compare en plus les deux copies chiffre à
 * chiffre — c'est le garde-fou de la duplication volontaire (le backend ne
 * peut pas require('../public/…')).
 */

const test = require('node:test');
const assert = require('node:assert');

const PGU = require('./_esm').loadEsm('src/modules/shared/lib/parcelleGroupUtils.js');
const backend = require('../../functions/lib/parcelleGroupes/split.js');

// ---------------------------------------------------------------------------
// FIXTURES (identiques côté backend)
// ---------------------------------------------------------------------------

/** Cas de référence Omar : S13 2.00 Ha + S14 1.00 Ha. */
const GRP_S13_S14 = [
  { label: 'F5- CASCADE -S13', ha: 2 },
  { label: 'F5 -BREEZE- S14', ha: 1 },
];

/** Cas d'arrondi : 1.30 Ha + 2.00 Ha. */
const GRP_1_3_2_0 = [
  { label: 'A', ha: 1.3 },
  { label: 'B', ha: 2 },
];

/** Cas non divisible : 3 parcelles égales. */
const GRP_TIERS = [
  { label: 'A', ha: 1 },
  { label: 'B', ha: 1 },
  { label: 'C', ha: 1 },
];

test('UMD — expose window.ParcelleGroupUtils et module.exports', () => {
  assert.strictEqual(typeof PGU.splitQuantite, 'function');
  assert.strictEqual(typeof PGU.computeParts, 'function');
  assert.strictEqual(typeof PGU.formatApercu, 'function');
});

test('computeParts — pourcentages proportionnels aux Ha', () => {
  assert.deepStrictEqual(PGU.computeParts(GRP_S13_S14), [
    { label: 'F5- CASCADE -S13', ha: 2, pct: 66.7 },
    { label: 'F5 -BREEZE- S14', ha: 1, pct: 33.3 },
  ]);
});

test('splitQuantite — 30 kg sur 2.00/1.00 Ha → 20/10 exact', () => {
  const parts = PGU.splitQuantite(30, GRP_S13_S14);
  assert.deepStrictEqual(parts, [
    { label: 'F5- CASCADE -S13', quantite: 20 },
    { label: 'F5 -BREEZE- S14', quantite: 10 },
  ]);
  assert.strictEqual(parts.reduce((s, p) => s + p.quantite, 0), 30);
});

test('splitQuantite — 10 sur 1.30/2.00 Ha : conservation exacte', () => {
  const parts = PGU.splitQuantite(10, GRP_1_3_2_0);
  assert.deepStrictEqual(parts, [
    { label: 'A', quantite: 3.939 },
    { label: 'B', quantite: 6.061 },
  ]);
  assert.strictEqual(parts[0].quantite + parts[1].quantite, 10);
});

test('splitQuantite — quantité non divisible (10/3) : Σ === quantité', () => {
  const parts = PGU.splitQuantite(10, GRP_TIERS);
  assert.deepStrictEqual(parts.map((p) => p.quantite), [3.333, 3.333, 3.334]);
  assert.strictEqual(parts.reduce((s, p) => s + p.quantite, 0), 10);
});

test('splitQuantite — groupe à 1 membre : passthrough de la quantité', () => {
  assert.deepStrictEqual(PGU.splitQuantite(7.5, [{ label: 'SOLO', ha: 4.2 }]), [
    { label: 'SOLO', quantite: 7.5 },
  ]);
});

test('splitQuantite — membre sans Ha SB → erreur nommant la parcelle', () => {
  assert.throws(() => PGU.splitQuantite(10, [{ label: 'A', ha: 2 }, { label: 'B', ha: 0 }]), /« B »/);
});

test('formatApercu — texte lisible sous la ligne d\'article', () => {
  assert.strictEqual(
    PGU.formatApercu(30, GRP_S13_S14, 'kg'),
    'F5- CASCADE -S13 20 kg · F5 -BREEZE- S14 10 kg'
  );
  assert.strictEqual(PGU.formatApercu('10', GRP_1_3_2_0, 'L'), 'A 3.939 L · B 6.061 L');
});

test('formatApercu — quantité vide/nulle ou groupe invalide → chaîne vide', () => {
  assert.strictEqual(PGU.formatApercu('', GRP_S13_S14, 'kg'), '');
  assert.strictEqual(PGU.formatApercu(0, GRP_S13_S14, 'kg'), '');
  assert.strictEqual(PGU.formatApercu(-5, GRP_S13_S14, 'kg'), '');
  assert.strictEqual(PGU.formatApercu(10, [{ label: 'A', ha: 0 }, { label: 'B', ha: 1 }], 'kg'), '');
});

test('PARITÉ front/back — les deux copies donnent exactement les mêmes chiffres', () => {
  const cas = [
    [30, GRP_S13_S14],
    [10, GRP_1_3_2_0],
    [10, GRP_TIERS],
    [7.5, [{ label: 'SOLO', ha: 4.2 }]],
    [0.001, GRP_TIERS],
    [1234.567, GRP_1_3_2_0],
  ];
  for (const [q, membres] of cas) {
    assert.deepStrictEqual(
      PGU.splitQuantite(q, membres),
      backend.splitQuantite(q, membres),
      'divergence front/back pour q=' + q
    );
    assert.deepStrictEqual(PGU.computeParts(membres), backend.computeParts(membres));
  }
});
