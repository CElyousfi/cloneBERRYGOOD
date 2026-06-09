'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { validateBugReport, MAX_DESCRIPTION } = require('../../functions/lib/bugReports/validateBugReport');

test('rejette un corps non-objet', () => {
  assert.strictEqual(validateBugReport(null).valid, false);
  assert.strictEqual(validateBugReport(undefined).valid, false);
  assert.strictEqual(validateBugReport('x').valid, false);
});

test('rejette une description vide ou whitespace', () => {
  assert.strictEqual(validateBugReport({}).valid, false);
  assert.strictEqual(validateBugReport({ description: '' }).valid, false);
  assert.strictEqual(validateBugReport({ description: '   ' }).valid, false);
});

test('accepte une description simple sans photo', () => {
  const r = validateBugReport({ description: 'Bouton cassé sur Pointage' });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.hasPhoto, false);
  assert.strictEqual(r.description, 'Bouton cassé sur Pointage');
});

test('trim la description', () => {
  const r = validateBugReport({ description: '  écran blanc  ' });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.description, 'écran blanc');
});

test('rejette une description trop longue', () => {
  const r = validateBugReport({ description: 'a'.repeat(MAX_DESCRIPTION + 1) });
  assert.strictEqual(r.valid, false);
});

test('accepte une photo base64 valide', () => {
  const r = validateBugReport({ description: 'ok', photoBase64: 'AAAA' });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.hasPhoto, true);
});

test('rejette une photoBase64 non-string', () => {
  const r = validateBugReport({ description: 'ok', photoBase64: 123 });
  assert.strictEqual(r.valid, false);
});

test('rejette une photo trop volumineuse', () => {
  const r = validateBugReport({ description: 'ok', photoBase64: 'a'.repeat(8 * 1024 * 1024) });
  assert.strictEqual(r.valid, false);
});

test('photoBase64 vide est traité comme absence de photo', () => {
  const r = validateBugReport({ description: 'ok', photoBase64: '' });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.hasPhoto, false);
});
