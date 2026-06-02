'use strict';

/**
 * Unit tests for functions/lib/forecastConfirmation.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseForecastConfirmation } = require('../../functions/lib/forecastConfirmation.js');

test('confirms on plain "oui" and variants', () => {
  for (const t of ['oui', 'OUI', 'Oui', 'ouais', 'ok', 'Okay', 'yes', 'go']) {
    assert.equal(parseForecastConfirmation(t), 'confirm', `"${t}" should confirm`);
  }
});

test('confirms on action verbs', () => {
  for (const t of ['valider', 'valide', 'enregistrer', 'enregistre', 'confirme']) {
    assert.equal(parseForecastConfirmation(t), 'confirm', `"${t}" should confirm`);
  }
});

test('confirms on accented / punctuated short replies', () => {
  assert.equal(parseForecastConfirmation('oui !'), 'confirm');
  assert.equal(parseForecastConfirmation("oui c'est bon"), 'confirm');
  assert.equal(parseForecastConfirmation("d'accord"), 'confirm');
});

test('cancels on "non" and variants', () => {
  for (const t of ['non', 'NON', 'no', 'annuler', 'annule', 'stop', 'cancel']) {
    assert.equal(parseForecastConfirmation(t), 'cancel', `"${t}" should cancel`);
  }
});

test('emoji thumbs / check map to intents', () => {
  assert.equal(parseForecastConfirmation('👍'), 'confirm');
  assert.equal(parseForecastConfirmation('✅ ok'), 'confirm');
  assert.equal(parseForecastConfirmation('👎'), 'cancel');
  assert.equal(parseForecastConfirmation('❌'), 'cancel');
});

test('long messages fall through to the agent', () => {
  assert.equal(
    parseForecastConfirmation('oui mais avant dis-moi le prix de la semaine 22'),
    'unknown'
  );
  assert.equal(parseForecastConfirmation('quel est le forecast myrtille ?'), 'unknown');
});

test('empty / ambiguous / mixed input is unknown', () => {
  assert.equal(parseForecastConfirmation(''), 'unknown');
  assert.equal(parseForecastConfirmation(null), 'unknown');
  assert.equal(parseForecastConfirmation(undefined), 'unknown');
  assert.equal(parseForecastConfirmation('   '), 'unknown');
  assert.equal(parseForecastConfirmation('bonjour'), 'unknown');
  assert.equal(parseForecastConfirmation('oui non'), 'unknown');
});
