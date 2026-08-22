/*
 * lecturePaieExcel.parite.test.js — la copie backend NE DOIT PAS diverger.
 *
 * `functions/lib/paie/lecturePaieExcel.js` est une copie de
 * `public/lib/lecturePaieExcel.js`, imposée par le déploiement : Firebase ne
 * publie que `functions/`, et un `require('../../public/…')` fait crasher
 * TOUTES les Cloud Functions du fichier au chargement, sans qu'aucun test local
 * ne le voie (mémoire projet `backend-jamais-require-public`).
 *
 * La comparaison est OCTET POUR OCTET. C'est possible — et bien plus fort qu'une
 * batterie de cas — parce que le module n'a AUCUNE dépendance : il prend des
 * grilles de cellules et rend des nombres. Une liste de cas ne couvre que les
 * branches auxquelles on a pensé ; une comparaison de texte couvre aussi les
 * autres.
 *
 * S'il tombe : recopier la source. La vérité reste `public/lib/`.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const BACK = path.join(__dirname, '../lecturePaieExcel.js');
const FRONT = path.join(__dirname, '../../../../public/lib/lecturePaieExcel.js');

test('la copie backend est identique à la source, octet pour octet', () => {
  const back = fs.readFileSync(BACK, 'utf8');
  const front = fs.readFileSync(FRONT, 'utf8');
  if (back !== front) {
    // Message actionnable : sans le premier écart, on relit 300 lignes à la main.
    const bl = back.split('\n');
    const fl = front.split('\n');
    let i = 0;
    while (i < Math.max(bl.length, fl.length) && bl[i] === fl[i]) i++;
    assert.fail('Divergence ligne ' + (i + 1) + '\n'
      + '  public/   : ' + (fl[i] === undefined ? '<fin de fichier>' : fl[i]) + '\n'
      + '  functions/: ' + (bl[i] === undefined ? '<fin de fichier>' : bl[i]) + '\n'
      + 'Recopier public/lib/lecturePaieExcel.js vers functions/lib/paie/.');
  }
  assert.strictEqual(back, front);
});

test('la copie backend se charge sous Node et expose la même API', () => {
  // Le fichier porte un export `window` : il doit rester inoffensif sous Node,
  // où `window` n'existe pas. Un `window.X = …` nu ferait crasher le require —
  // donc la Cloud Function — au chargement.
  const mod = require(BACK);
  assert.deepStrictEqual(Object.keys(mod).sort(), [
    'agregerOuvriers', 'cleMatricule', 'colonne', 'estLigneTotal', 'estNombre',
    'lireFeuilleOuvriers', 'lireTransport', 'normaliserLibelle', 'periodeDeGrille',
    'postesExcel', 'trouverEnTete',
  ]);
});
