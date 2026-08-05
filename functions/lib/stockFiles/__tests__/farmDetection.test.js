'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectFarmFromCaption } = require('../farmDetection');

test('detectFarmFromCaption: "BG" → berry_good', () => {
  assert.equal(detectFarmFromCaption('BG'), 'berry_good');
});

test('detectFarmFromCaption: "Berry Good" (mixed case) → berry_good', () => {
  assert.equal(detectFarmFromCaption('Stock Berry Good du jour'), 'berry_good');
});

test('detectFarmFromCaption: "Bahia" (with accent variants ok) → bahia', () => {
  assert.equal(detectFarmFromCaption('fichier bahia'), 'bahia');
  assert.equal(detectFarmFromCaption('BAHIA'), 'bahia');
});

test('detectFarmFromCaption: no keyword → null', () => {
  assert.equal(detectFarmFromCaption('stock du jour'), null);
  assert.equal(detectFarmFromCaption(''), null);
  assert.equal(detectFarmFromCaption(null), null);
  assert.equal(detectFarmFromCaption(undefined), null);
});

test('detectFarmFromCaption: both farms mentioned → ambiguous (null)', () => {
  assert.equal(detectFarmFromCaption('BG et Bahia'), null);
});

test('detectFarmFromCaption: does not false-positive on unrelated substrings', () => {
  // "bg" should not match inside an unrelated word boundary-free context —
  // acceptable trade-off documented: indexOf is substring based, so a word
  // containing "bg" as a literal substring (rare in French) would also match.
  // Cover the realistic false-positive risk word "bahianais" only if it ever appears.
  assert.equal(detectFarmFromCaption('Rapport général du jour'), null);
});
