/**
 * Configuration figée du rapport Campagne hebdomadaire : horaire du cron et
 * matrice de diffusion. Ces constantes sont consommées telles quelles par
 * functions/index.js — une dérive silencieuse enverrait le rapport le mauvais
 * jour, ou aux mauvaises personnes.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CRON_CONFIG, HTTP_CONFIG, AUDIENCE, TEMPLATE_NAME, ALERT_TEMPLATE_NAME, XLSX_MIME,
  TRIGGER_PROFILES, CONFIRM_SEND,
} = require('../index');

test('CRON_CONFIG : lundi 16h00 Africa/Casablanca, europe-west1', () => {
  // 5 champs cron : minute heure jour-du-mois mois jour-de-semaine (1 = lundi)
  assert.equal(CRON_CONFIG.schedule, '0 16 * * 1');
  const [minute, heure, jourMois, mois, jourSemaine] = CRON_CONFIG.schedule.split(' ');
  assert.equal(minute, '0');
  assert.equal(heure, '16');
  assert.equal(jourMois, '*');
  assert.equal(mois, '*');
  assert.equal(jourSemaine, '1', 'lundi');

  assert.equal(CRON_CONFIG.timeZone, 'Africa/Casablanca');
  assert.equal(CRON_CONFIG.region, 'europe-west1');
  assert.equal(CRON_CONFIG.timeoutSeconds, 540);
  assert.equal(CRON_CONFIG.memory, '1GB');
});

test('CRON_CONFIG est gelé (une mutation accidentelle changerait l\'horaire)', () => {
  assert.ok(Object.isFrozen(CRON_CONFIG));
  try { CRON_CONFIG.schedule = '0 0 * * *'; } catch (_) { /* strict mode */ }
  assert.equal(CRON_CONFIG.schedule, '0 16 * * 1');
});

test('HTTP_CONFIG : même région et même enveloppe que le cron', () => {
  assert.equal(HTTP_CONFIG.region, CRON_CONFIG.region);
  assert.equal(HTTP_CONFIG.timeoutSeconds, 540);
  assert.equal(HTTP_CONFIG.memory, '1GB');
  assert.ok(Object.isFrozen(HTTP_CONFIG));
});

test('AUDIENCE = la matrice validée par Omar, et rien d\'autre', () => {
  assert.deepEqual(Object.keys(AUDIENCE), ['Framboise', 'Myrtille']);
  assert.deepEqual(AUDIENCE.Framboise.slice(), ['chef_f1', 'dg', 'dt', 'rh']);
  assert.deepEqual(AUDIENCE.Myrtille.slice(), ['chef_f5', 'dg', 'dt', 'rh']);

  // Cloisonnement des chefs : chef_f1 ne reçoit QUE Framboise, chef_f5 QUE Myrtille.
  assert.ok(!AUDIENCE.Framboise.includes('chef_f5'));
  assert.ok(!AUDIENCE.Myrtille.includes('chef_f1'));

  // dg / dt / rh dans les deux cultures → 2 messages chacun.
  ['dg', 'dt', 'rh'].forEach((p) => {
    assert.ok(AUDIENCE.Framboise.includes(p), p + ' doit recevoir Framboise');
    assert.ok(AUDIENCE.Myrtille.includes(p), p + ' doit recevoir Myrtille');
  });

  assert.ok(Object.isFrozen(AUDIENCE));
  assert.ok(Object.isFrozen(AUDIENCE.Framboise));
});

test('gate du trigger : dirigeants seulement, et envoi confirmé explicitement', () => {
  assert.deepEqual(TRIGGER_PROFILES.slice(), ['dg', 'dt']);
  assert.ok(Object.isFrozen(TRIGGER_PROFILES));
  // Aucun profil opérationnel ne doit pouvoir déclencher un envoi ni
  // télécharger le classeur d'exploitation.
  ['chef_f1', 'rh', 'magasinier', 'achats', 'ouvrier'].forEach((p) => {
    assert.ok(TRIGGER_PROFILES.indexOf(p) === -1, p + ' ne doit pas être autorisé');
  });
  assert.equal(CONFIRM_SEND, 'SEND');
});

test('template dédié + MIME xlsx', () => {
  assert.equal(TEMPLATE_NAME, 'campagne_rapport_hebdo');
  assert.equal(ALERT_TEMPLATE_NAME, 'general_alert');
  assert.equal(XLSX_MIME, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
