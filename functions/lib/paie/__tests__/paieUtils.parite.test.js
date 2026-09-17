/*
 * paieUtils.parite.test.js — la copie backend NE DOIT PAS diverger de l'originale.
 *
 * `functions/lib/paie/paieUtils.js` est une copie de `src/modules/shared/lib/paieUtils.js`,
 * imposée par le déploiement (Firebase ne publie que `functions/`, un require
 * vers `public/` fait crasher toutes les Cloud Functions au load).
 *
 * Une copie qui dérive est PIRE que pas de copie : l'écran Paie et l'écran
 * Campagne afficheraient deux coûts différents pour le même ouvrier, sans que
 * rien ne le signale. Ce test compare les DEUX modules sur une batterie de cas
 * couvrant les branches du modèle — déclaré / non déclaré, ancienneté, prime de
 * fonction, heures sup, transport, SMAG daté.
 *
 * S'il tombe : reporter la modification dans les DEUX fichiers, la source de
 * vérité restant `src/modules/shared/lib/paieUtils.js`.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const BACK = require(path.join(__dirname, '../paieUtils.js'));
// Module ES (src/package.json : "type": "module") — require(esm) est natif
// depuis Node 20.19 / 22.12 (pas de top-level await dans le module).
const FRONT = require(path.join(__dirname, '../../../../src/modules/shared/lib/paieUtils.js'));

/** Cas de calcul balayant les branches du modèle. */
const CAS = [
  { nom: 'déclaré, sans ancienneté', declare: true, joursTravailles: 12, anciennete: 0 },
  { nom: 'déclaré, ancienneté longue', declare: true, joursTravailles: 15, anciennete: 900 },
  { nom: 'déclaré + prime de fonction', declare: true, joursTravailles: 15, anciennete: 400, primeFonctionJour: 20 },
  { nom: 'déclaré + heures sup', declare: true, joursTravailles: 14, anciennete: 100, hs25: 6, hs50: 3, hs100: 1 },
  { nom: 'déclaré + transport + récolte', declare: true, joursTravailles: 13, anciennete: 200, primeTransport: 150, primeRecolte: 320 },
  { nom: 'NON déclaré (ni CNSS ni ancienneté)', declare: false, joursTravailles: 12, anciennete: 900 },
  { nom: 'non déclaré + prime + HS', declare: false, joursTravailles: 10, anciennete: 0, primeFonctionJour: 15, hs25: 4 },
  { nom: 'zéro jour pointé', declare: true, joursTravailles: 0, anciennete: 300 },
  { nom: 'SMAG daté (date ancienne)', declare: true, joursTravailles: 15, anciennete: 50, dateISO: '2024-03-15' },
  { nom: 'SMAG daté (date récente)', declare: true, joursTravailles: 15, anciennete: 50, dateISO: '2026-08-15' },
];

test('parité — computeWorkerPaie rend EXACTEMENT la même chose des deux côtés', () => {
  CAS.forEach((cas) => {
    const args = Object.assign({ baremes: {} }, cas);
    delete args.nom;
    assert.deepStrictEqual(BACK.computeWorkerPaie(args), FRONT.computeWorkerPaie(args), cas.nom);
  });
});

test('parité — les barèmes par défaut sont identiques', () => {
  // Un taux de charges patronales qui diverge, c'est 19 % d'écart sur le coût
  // employeur — l'erreur la plus coûteuse que ce fichier puisse laisser passer.
  assert.deepStrictEqual(BACK.PAIE_BAREMES_DEFAULT, FRONT.PAIE_BAREMES_DEFAULT);
});

test('parité — paliers d\'ancienneté et SMAG daté', () => {
  const baremes = BACK.PAIE_BAREMES_DEFAULT;
  [0, 1, 100, 365, 730, 1095, 5000].forEach((jours) => {
    assert.deepStrictEqual(
      BACK.trouverPalierAnciennete(jours, baremes.paliers),
      FRONT.trouverPalierAnciennete(jours, baremes.paliers),
      'palier à ' + jours + ' jours'
    );
  });
  ['2023-01-01', '2025-06-30', '2026-08-20', ''].forEach((d) => {
    assert.deepStrictEqual(
      BACK.resolveSmagForDate(baremes, d),
      FRONT.resolveSmagForDate(baremes, d),
      'SMAG au ' + (d || '(sans date)')
    );
  });
});

test('parité — computePayslip (l\'autre porte d\'entrée du modèle)', () => {
  CAS.forEach((cas) => {
    const args = {
      declare: cas.declare,
      smagBrut: 100, smagNet: 90,
      jT: cas.joursTravailles, jF: 1,
      ancienneteTaux: 0.05,
      primeFonctionJour: cas.primeFonctionJour || 0,
      primesOptionnelles: cas.primeRecolte || 0,
      baremes: {},
    };
    assert.deepStrictEqual(BACK.computePayslip(args), FRONT.computePayslip(args), cas.nom);
  });
});
