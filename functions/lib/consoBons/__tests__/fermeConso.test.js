'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { fermeDeParcelle, resolveFermeInconnue } = require('../fermeConso');

// ---------------------------------------------------------------------------
// Les 19 libellés RÉELS de `consumption_vouchers` (prod, 2026-08-26).
// Ce tableau est le contrat : chacun DOIT être résolu, sinon un chef se
// retrouve devant un écran vide.
// ---------------------------------------------------------------------------

const LIBELLES_REELS = [
  ['AVOCAT F5', 'Avocatier'],
  ['BREEZE MYRTILLE S8-2', 'F5'],
  ['CASCADE MYRTILLE S8-1', 'F5'],
  ['F1- S5 MARAVILLA MD', 'F1'],
  ['F1-S6.S7 MARAVILLA MOTTE', 'F1'],
  ['F2 - HAAS', 'Avocatier'],
  ['F3 -HAAS', 'Avocatier'],
  ['F4 -HAAS', 'Avocatier'],
  ['F5 -BREEZE- S14', 'F5'],
  ['F5 CORINA myrtille', 'F5'],
  ['F5 CORINA myrtille S8-3', 'F5'],
  ['F5 YAZMIN MT', 'F5'],
  ['F5- CASCADE -S13', 'F5'],
  ['F5- MYA S9', 'F5'],
  ['S2 -YAZMIN MOW DOWN F1', 'F1'],
  ['S2.S3.S5.S6.S7 maravilla logn can F1', 'F1'],
  ['S3 - MARAVILLA MOTTE F1', 'F1'],
  ['S5 -YAZMIN MOW DOWN F1', 'F1'],
  ['S9 - REYNA F5', 'F5'],
];

test('les 19 libellés réels des bons sont TOUS résolus', () => {
  const nonResolus = LIBELLES_REELS.filter(([l]) => fermeDeParcelle(l) === null).map(([l]) => l);
  assert.deepStrictEqual(nonResolus, [], 'aucun libellé réel ne doit rester indéterminé');
});

test('chaque libellé réel est rattaché à la BONNE ferme', () => {
  for (const [label, attendu] of LIBELLES_REELS) {
    assert.strictEqual(fermeDeParcelle(label), attendu, label);
  }
});

// ---------------------------------------------------------------------------
// Les deux familles que chacune des règles d'origine ratait
// ---------------------------------------------------------------------------

test('famille HAAS sans « AVOCAT » : rattachée à Avocatier (chef_avo ne voit plus un écran vide)', () => {
  // `resolveFermeFromParcelle` seule renvoyait INCONNU sur ces trois libellés.
  assert.strictEqual(fermeDeParcelle('F2 - HAAS'), 'Avocatier');
  assert.strictEqual(fermeDeParcelle('F3 -HAAS'), 'Avocatier');
  assert.strictEqual(fermeDeParcelle('F4 -HAAS'), 'Avocatier');
  assert.strictEqual(fermeDeParcelle('F6-HAAS'), 'Avocatier');
});

test('famille myrtille sans token de ferme : rattachée par SECTEUR (chef_f5 récupère ses S8)', () => {
  // `deriveFermeFromParcelle` seule renvoyait null sur ces deux libellés.
  assert.strictEqual(fermeDeParcelle('BREEZE MYRTILLE S8-2'), 'F5');
  assert.strictEqual(fermeDeParcelle('CASCADE MYRTILLE S8-1'), 'F5');
});

test('règle de secteur : S1-S7 -> F1, S8-S14 -> F5', () => {
  assert.strictEqual(fermeDeParcelle('MARAVILLA S1'), 'F1');
  assert.strictEqual(fermeDeParcelle('MARAVILLA S7'), 'F1');
  assert.strictEqual(fermeDeParcelle('CORINA S8'), 'F5');
  assert.strictEqual(fermeDeParcelle('CORINA S14'), 'F5');
});

test('secteur hors plage connue : non résolu (jamais de rattachement inventé)', () => {
  assert.strictEqual(fermeDeParcelle('PARCELLE S15'), null);
  assert.strictEqual(fermeDeParcelle('PARCELLE S99'), null);
});

// ---------------------------------------------------------------------------
// Arbitrage AVOCAT F5 — divergence assumée
// ---------------------------------------------------------------------------

test('AVOCAT F5 : arbitré Avocatier, pas F5 (le token avocat prime)', () => {
  assert.strictEqual(fermeDeParcelle('AVOCAT F5'), 'Avocatier');
  assert.strictEqual(fermeDeParcelle('Avocat AVOCAT F6 AVOCAT'), 'Avocatier');
  assert.strictEqual(fermeDeParcelle('F2 - HAAS'), 'Avocatier');
});

test("l'arbitrage avocat ne déborde pas sur une parcelle sans mot-clé avocat", () => {
  assert.strictEqual(fermeDeParcelle('F5 CORINA myrtille'), 'F5');
  assert.strictEqual(fermeDeParcelle('F1- S5 MARAVILLA MD'), 'F1');
});

// ---------------------------------------------------------------------------
// BAHIA et fermes sans chef
// ---------------------------------------------------------------------------

test('BAHIA reconnu', () => {
  assert.strictEqual(fermeDeParcelle('EL BAHIA P2'), 'BAHIA');
  assert.strictEqual(fermeDeParcelle('bahia secteur 3'), 'BAHIA');
});

test('F2/F3/F4/F6 sans avocat : dérivés tels quels (aucun chef ne les matchera)', () => {
  assert.strictEqual(fermeDeParcelle('F2 S20'), 'F2');
  assert.strictEqual(fermeDeParcelle('F6 PARCELLE'), 'F6');
});

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

test('entrée vide / non-string / illisible : null, jamais un rattachement par défaut', () => {
  for (const v of ['', '   ', null, undefined, 42, {}, [], 'PARCELLE SANS INDICE']) {
    assert.strictEqual(fermeDeParcelle(v), null, 'valeur ' + JSON.stringify(v));
  }
});

// ---------------------------------------------------------------------------
// resolveFermeInconnue — remontée à l'écran
// ---------------------------------------------------------------------------

test('resolveFermeInconnue : ne liste QUE les libellés indéterminables, dédoublonnés et triés', () => {
  const out = resolveFermeInconnue([
    'F1- S5 MARAVILLA MD',
    'ZZZ INCONNUE',
    'AAA INCONNUE',
    'ZZZ INCONNUE',
    'BREEZE MYRTILLE S8-2',
  ]);
  assert.deepStrictEqual(out, ['AAA INCONNUE', 'ZZZ INCONNUE']);
});

test('resolveFermeInconnue : rien à signaler sur les libellés réels', () => {
  assert.deepStrictEqual(resolveFermeInconnue(LIBELLES_REELS.map(([l]) => l)), []);
});

test('resolveFermeInconnue : entrées vides ignorées, entrée dégénérée tolérée', () => {
  assert.deepStrictEqual(resolveFermeInconnue(['', '  ', null, undefined]), []);
  assert.deepStrictEqual(resolveFermeInconnue(null), []);
  assert.deepStrictEqual(resolveFermeInconnue('pas un tableau'), []);
});

test('resolveFermeInconnue : le libellé est trimé avant test et avant remontée', () => {
  assert.deepStrictEqual(resolveFermeInconnue(['  ZZZ INCONNUE  ']), ['ZZZ INCONNUE']);
  assert.deepStrictEqual(resolveFermeInconnue(['  F1 S1  ']), []);
});
