/*
 * campagneRapprochement.test.js — le contrôle qui compare les deux chemins.
 *
 * L'écran Campagne agrège le pointage PAR PARCELLE : une ligne dont la parcelle
 * ou la culture ne se résout pas n'y entre pas. Le coût ouvrier, lui, part du
 * pointage BRUT. L'écart entre les deux mesure exactement ce que la grille ne
 * voit pas — un trou qui ne se signale jamais tout seul, parce qu'un total plus
 * petit reste un total plausible.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const R = require(path.join(__dirname, '../../public/lib/campagneRapprochement.js'));

test('baseParQuinzaine — somme les coûts de la grille par période', () => {
  const rows = [
    { periode: 'Quinzaine 01', cout: 1000 },
    { periode: 'Quinzaine 01', cout: 500 },
    { periode: 'Quinzaine 02', cout: 700 },
    // Lignes inexploitables : ignorées, jamais comptées à zéro dans une
    // période fantôme.
    { periode: '', cout: 999 },
    { periode: 'Quinzaine 03' },
    null,
  ];
  assert.deepStrictEqual(R.baseParQuinzaine(rows),
    { 'Quinzaine 01': 1500, 'Quinzaine 02': 700 });
});

test('rapprocher — écart nul quand la grille couvre tout le pointage', () => {
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Quinzaine 01', jours: 100, base: 9744, primes: 3000, charges: 2500, coutTotal: 15244 },
    ],
    rows: [{ periode: 'Quinzaine 01', cout: 9744 }],
  });
  assert.strictEqual(out.ecart, 0);
  assert.strictEqual(out.ecartPct, 0);
  assert.strictEqual(out.lignes[0].coutCharge, 15244);
});

test('rapprocher — l\'écart mesure le pointage que la grille ne rattache pas', () => {
  // 9 744 DH pointés, 8 744 seulement rattachés à une parcelle : 1 000 DH de
  // travail réel manquent à l'écran Campagne. C'est précisément ce que ce
  // contrôle doit rendre visible.
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Quinzaine 01', jours: 100, base: 9744, primes: 0, charges: 0, coutTotal: 9744 },
    ],
    rows: [{ periode: 'Quinzaine 01', cout: 8744 }],
  });
  assert.strictEqual(out.lignes[0].grille, 8744);
  assert.strictEqual(out.lignes[0].pointage, 9744);
  assert.strictEqual(out.lignes[0].ecart, 1000);
  assert.strictEqual(Math.round(out.lignes[0].ecartPct * 10000) / 10000, 0.1026);
});

test('rapprocher — une quinzaine absente de la grille ressort en écart total', () => {
  // Le cas dangereux : aucune ligne côté grille. Sans ce contrôle, la quinzaine
  // disparaîtrait sans laisser de trace.
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Quinzaine 07', jours: 50, base: 5000, primes: 0, charges: 0, coutTotal: 5000 },
    ],
    rows: [],
  });
  assert.strictEqual(out.lignes[0].grille, 0);
  assert.strictEqual(out.lignes[0].ecart, 5000);
  assert.strictEqual(out.lignes[0].ecartPct, 1);
});

test('rapprocher — quinzaine sans pointage : `null`, jamais « 0 % rapproché »', () => {
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Quinzaine 09', jours: 0, base: 0, primes: 0, charges: 0, coutTotal: 0 },
    ],
    rows: [],
  });
  assert.strictEqual(out.lignes[0].ecartPct, null);
  assert.strictEqual(out.ecartPct, null);
});

test('rapprocher — les totaux sont la somme des quinzaines', () => {
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Q1', jours: 10, base: 1000, primes: 100, charges: 200, coutTotal: 1300 },
      { periode: 'Q2', jours: 20, base: 2000, primes: 200, charges: 400, coutTotal: 2600 },
    ],
    rows: [{ periode: 'Q1', cout: 900 }, { periode: 'Q2', cout: 2000 }],
  });
  assert.strictEqual(out.totalPointage, 3000);
  assert.strictEqual(out.totalGrille, 2900);
  assert.strictEqual(out.ecart, 100);
  assert.strictEqual(out.lignes.length, 2);
});
