/*
 * lecturePaieExcel.parite.test.js — la copie backend NE DOIT PAS diverger.
 *
 * `functions/lib/paie/lecturePaieExcel.js` est une copie de
 * `src/modules/shared/lib/lecturePaieExcel.js`, imposée par le déploiement :
 * Firebase ne publie que `functions/`, et un `require('../../src/…')` fait
 * crasher TOUTES les Cloud Functions du fichier au chargement, sans qu'aucun
 * test local ne le voie (mémoire projet `backend-jamais-require-public`).
 *
 * La source frontend est un module ES, la copie backend un module CommonJS :
 * les deux fichiers ne peuvent plus être identiques octet pour octet. La
 * comparaison porte donc sur le CODE de chaque fonction exportée
 * (`Function.prototype.toString`, espaces normalisés) — bien plus fort qu'une
 * batterie de cas : un token qui change d'un côté fait tomber le test, y
 * compris dans une branche à laquelle on n'a pas pensé.
 *
 * S'il tombe : recopier le corps des fonctions. La vérité reste
 * `src/modules/shared/lib/lecturePaieExcel.js`.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const BACK = require(path.join(__dirname, '../lecturePaieExcel.js'));
// Module ES (src/package.json : "type": "module") — require(esm) est natif
// depuis Node 20.19 / 22.12 (pas de top-level await dans le module).
const FRONT = require(path.join(__dirname, '../../../../src/modules/shared/lib/lecturePaieExcel.js'));

const API = [
  'agregerOuvriers', 'cleMatricule', 'colonne', 'estLigneTotal', 'estNombre',
  'lireDivers', 'lireFeuilleOuvriers', 'lireTransport', 'normaliserLibelle',
  'periodeDeGrille', 'postesExcel', 'trouverEnTete',
];

/** Source d'une fonction, espaces et retours à la ligne normalisés. */
const normalise = (fn) => String(fn).replace(/\s+/g, ' ').trim();

test('la copie backend se charge sous Node et expose la même API que la source', () => {
  assert.deepStrictEqual(Object.keys(BACK).sort(), API);
  assert.deepStrictEqual(Object.keys(FRONT).sort(), API);
});

test('chaque fonction de la copie backend a le MÊME code que la source', () => {
  for (const k of API) {
    if (typeof FRONT[k] === 'function') {
      assert.strictEqual(typeof BACK[k], 'function', k + ' : fonction attendue côté backend');
      assert.strictEqual(normalise(BACK[k]), normalise(FRONT[k]),
        'Divergence dans ' + k + ' — recopier src/modules/shared/lib/lecturePaieExcel.js vers functions/lib/paie/.');
    } else {
      assert.deepStrictEqual(BACK[k], FRONT[k], 'Divergence sur la constante ' + k);
    }
  }
});
