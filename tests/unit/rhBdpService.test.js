'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { mapPersonnelRows } = require('../../functions/rhBdpService');

// ── mapPersonnelRows ──────────────────────────────────────────────────────────

test('mapPersonnelRows — cas nominal : CIN et CNSS présents', () => {
  const rows = [
    { Mat: 'BGF0001', Nom: 'HAFIDI', Prenom: 'YOUNESS', CIN: 'DA74333', CNSS: '155065489' },
  ];
  const data = mapPersonnelRows(rows);
  assert.deepStrictEqual(data['BGF0001'], {
    cin: 'DA74333',
    cnss: '155065489',
    nom: 'HAFIDI',
    prenom: 'YOUNESS',
  });
});

test('mapPersonnelRows — CNSS null retourne null (pas de CNSS pour tous)', () => {
  const rows = [
    { Mat: 'BGF0002', Nom: 'LAKHLIFI', Prenom: 'LAILA', CIN: 'D726055', CNSS: null },
  ];
  const data = mapPersonnelRows(rows);
  assert.strictEqual(data['BGF0002'].cnss, null);
  assert.strictEqual(data['BGF0002'].cin, 'D726055');
});

test('mapPersonnelRows — CIN et CNSS tous les deux null', () => {
  const rows = [
    { Mat: 'BGF0003', Nom: 'TEST', Prenom: 'USER', CIN: null, CNSS: null },
  ];
  const data = mapPersonnelRows(rows);
  assert.strictEqual(data['BGF0003'].cin, null);
  assert.strictEqual(data['BGF0003'].cnss, null);
});

test('mapPersonnelRows — ligne avec Mat vide ignorée', () => {
  const rows = [
    { Mat: '', Nom: 'FANTOME', Prenom: 'X', CIN: 'A123', CNSS: '999' },
    { Mat: '  ', Nom: 'ESPACES', Prenom: 'Y', CIN: 'B456', CNSS: '888' },
    { Mat: 'BGF0010', Nom: 'REEL', Prenom: 'Z', CIN: 'C789', CNSS: '777' },
  ];
  const data = mapPersonnelRows(rows);
  assert.strictEqual(Object.keys(data).length, 1);
  assert.ok(data['BGF0010']);
});

test('mapPersonnelRows — trim des espaces dans les valeurs', () => {
  const rows = [
    { Mat: '  BGF0020  ', Nom: '  DUPONT  ', Prenom: '  JEAN  ', CIN: '  X123  ', CNSS: '  456  ' },
  ];
  const data = mapPersonnelRows(rows);
  // Mat trimmé → clé 'BGF0020'
  assert.ok(data['BGF0020']);
  assert.strictEqual(data['BGF0020'].cin, 'X123');
  assert.strictEqual(data['BGF0020'].cnss, '456');
  assert.strictEqual(data['BGF0020'].nom, 'DUPONT');
  assert.strictEqual(data['BGF0020'].prenom, 'JEAN');
});

test('mapPersonnelRows — tableau vide retourne objet vide', () => {
  const data = mapPersonnelRows([]);
  assert.deepStrictEqual(data, {});
});

test('mapPersonnelRows — plusieurs lignes, clés distinctes', () => {
  const rows = [
    { Mat: 'BGF0001', Nom: 'A', Prenom: 'B', CIN: 'C1', CNSS: 'S1' },
    { Mat: 'BGF0002', Nom: 'D', Prenom: 'E', CIN: 'C2', CNSS: null },
    { Mat: 'BGF0003', Nom: 'F', Prenom: 'G', CIN: null, CNSS: 'S3' },
  ];
  const data = mapPersonnelRows(rows);
  assert.strictEqual(Object.keys(data).length, 3);
  assert.strictEqual(data['BGF0001'].cin, 'C1');
  assert.strictEqual(data['BGF0002'].cnss, null);
  assert.strictEqual(data['BGF0003'].cin, null);
  assert.strictEqual(data['BGF0003'].cnss, 'S3');
});

test('mapPersonnelRows — CIN chaîne vide traité comme null', () => {
  // '' est falsy → doit être retourné comme null
  const rows = [
    { Mat: 'BGF0030', Nom: 'TEST', Prenom: 'VIDE', CIN: '', CNSS: '' },
  ];
  const data = mapPersonnelRows(rows);
  assert.strictEqual(data['BGF0030'].cin, null);
  assert.strictEqual(data['BGF0030'].cnss, null);
});
