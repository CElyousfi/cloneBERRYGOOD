'use strict';

/**
 * Garde anti-divergence du seuil « Alerte Forte Chaleur ».
 *
 * Le seuil est DUPLIQUÉ entre l'écran Météo (public/app.jsx, bloc `alertes`)
 * et la notification WhatsApp (functions/lib/meteo/meteoAlertes.js) : le
 * backend ne peut pas require('../public/…') — Firebase ne déploie que
 * `functions/`, l'import ferait planter toutes les Cloud Functions au
 * chargement. Les deux valeurs doivent donc rester manuellement alignées.
 *
 * Le bloc d'alertes de app.jsx n'est ni exporté ni posé sur `window` : il n'est
 * pas appelable depuis node:test (monolithe chargé par Babel dans le
 * navigateur). On teste donc la SOURCE, seule vérification possible sans
 * bundler — c'est assumé, et ça suffit à faire échouer la QA si un seul des
 * deux côtés bouge.
 *
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { SEUILS } = require(path.join(ROOT, 'functions/lib/meteo/meteoAlertes.js'));

const APP_JSX = fs.readFileSync(path.join(ROOT, 'public/app.jsx'), 'utf8');

/** Ligne du bloc `alertes` qui pousse l'alerte chaleur. */
function ligneAlerteChaleur() {
  const lines = APP_JSX.split('\n');
  const idx = lines.findIndex((l) => l.includes("titre: 'Alerte Forte Chaleur'"));
  assert.notEqual(idx, -1, 'ligne « Alerte Forte Chaleur » introuvable dans public/app.jsx');
  return lines[idx];
}

test('seuil chaleur : public/app.jsx est aligné sur SEUILS.chaleur (backend)', () => {
  const ligne = ligneAlerteChaleur();
  const comparaisons = ligne.match(/p\.tMax >= (\d+(?:\.\d+)?)/g) || [];
  assert.equal(comparaisons.length, 2,
    'la ligne doit contenir 2 comparaisons `p.tMax >= …` (détection + liste des jours)');
  comparaisons.forEach((c) => {
    const valeur = Number(c.replace('p.tMax >= ', ''));
    assert.equal(valeur, SEUILS.chaleur,
      'seuil chaleur divergent : ' + valeur + ' à l\'écran vs ' + SEUILS.chaleur +
      ' dans functions/lib/meteo/meteoAlertes.js — les deux DOIVENT bouger ensemble');
  });
});

test('seuil chaleur : la valeur figée est bien 35 °C', () => {
  // Décision Omar du 2026-08-18 (32 → 35 °C), appliquée des deux côtés.
  assert.equal(SEUILS.chaleur, 35);
});

test('les autres seuils de l\'écran ne bougent pas (vent 25, pluie 10)', () => {
  // Vent et pluie sont eux aussi dupliqués : mêmes valeurs des deux côtés.
  assert.equal(SEUILS.vent, 25);
  assert.equal(SEUILS.pluie, 10);
  assert.match(APP_JSX, /p\.vent >= 25;.*titre: 'Vent Fort'/);
  assert.match(APP_JSX, /p\.precip >= 10;.*titre: 'Pluie Importante'/);
});
