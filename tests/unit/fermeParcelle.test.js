'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { deriveFermeFromParcelle } = require('../../functions/lib/valorisation/fermeParcelle');

test('F1 — libellés de production framboise/myrtille', () => {
  assert.strictEqual(deriveFermeFromParcelle('S3 - MARAVILLA MOTTE F1'), 'F1');
  assert.strictEqual(deriveFermeFromParcelle('S7 -MARAVILLA MOTTE F1'), 'F1');
  assert.strictEqual(deriveFermeFromParcelle('S1/S4 Maravilla mow down F1'), 'F1');
  assert.strictEqual(deriveFermeFromParcelle('S2.S3.S5.S6.S7 maravilla logn can F1'), 'F1');
});

test('F5 — token F5 en suffixe ou en préfixe', () => {
  assert.strictEqual(deriveFermeFromParcelle('S10 - YAZMIN MOTTE F5'), 'F5');
  assert.strictEqual(deriveFermeFromParcelle('S9 - REYNA F5'), 'F5');
  assert.strictEqual(deriveFermeFromParcelle('F5 CORINA myrtille'), 'F5');
  assert.strictEqual(deriveFermeFromParcelle('F5 BREEZE'), 'F5');
  assert.strictEqual(deriveFermeFromParcelle('S10 YAZMIN cut back F5'), 'F5');
});

test('HAAS → Avocatier, MÊME avec un token F2/F4/F6 dans le libellé', () => {
  assert.strictEqual(deriveFermeFromParcelle('F2 - HAAS'), 'Avocatier');
  assert.strictEqual(deriveFermeFromParcelle('F3 -HAAS'), 'Avocatier');
  assert.strictEqual(deriveFermeFromParcelle('F4 -HAAS'), 'Avocatier');
  assert.strictEqual(deriveFermeFromParcelle('F6-HAAS'), 'Avocatier');
});

test('AVOCAT → Avocatier, prime sur un token F5/F6', () => {
  assert.strictEqual(deriveFermeFromParcelle('Parcelle avocat AVOCAT'), 'Avocatier');
  assert.strictEqual(deriveFermeFromParcelle('Avocat AVOCAT F6 AVOCAT'), 'Avocatier');
  assert.strictEqual(deriveFermeFromParcelle('AVOCAT F5'), 'Avocatier');
});

test('BAHIA', () => {
  assert.strictEqual(deriveFermeFromParcelle('EL BAHIA'), 'BAHIA');
});

test('F-06 → F6 (séparateur + zéros de tête)', () => {
  assert.strictEqual(deriveFermeFromParcelle('Σ AVOCAT F-06'), 'Avocatier'); // AVOCAT prime
  assert.strictEqual(deriveFermeFromParcelle('Parcelle F-06'), 'F6');
  assert.strictEqual(deriveFermeFromParcelle('Bloc F 1'), 'F1');
});

test('Ambigu / sans token ferme → null (FAIL-CLOSED)', () => {
  assert.strictEqual(deriveFermeFromParcelle('CASCADE MYRTILLE S8-1'), null);
  assert.strictEqual(deriveFermeFromParcelle('BREEZE MYRTILLE S8-2'), null);
  assert.strictEqual(deriveFermeFromParcelle('S9'), null);
  assert.strictEqual(deriveFermeFromParcelle('S9 - REYNA'), null);
});

test('Entrées non-string ou vides → null', () => {
  assert.strictEqual(deriveFermeFromParcelle(null), null);
  assert.strictEqual(deriveFermeFromParcelle(undefined), null);
  assert.strictEqual(deriveFermeFromParcelle(123), null);
  assert.strictEqual(deriveFermeFromParcelle({}), null);
  assert.strictEqual(deriveFermeFromParcelle('   '), null);
});

test('Pas de faux positif : un nombre comme S7 ne déclenche pas Fx', () => {
  // « S8-1 » contient un 8 mais pas de token F ; ne doit pas matcher.
  assert.strictEqual(deriveFermeFromParcelle('CASCADE MYRTILLE S8-1'), null);
});
