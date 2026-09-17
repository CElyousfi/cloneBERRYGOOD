/*
 * campagneProduction.test.js — la production en kg de l'écran Campagne.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *  1. un bon qu'aucune parcelle ne reçoit ne DISPARAÎT pas (il ressort en
 *     `kgNonRattaches`) — une production qui baisse et un rapprochement qui
 *     casse se ressemblent trop à l'écran ;
 *  2. un dénominateur absent donne `null`, jamais 0 ni l'infini — « récolte pas
 *     commencée » et « récolte improductive » sont deux états opposés ;
 *  3. l'effort de récolte ne compte QUE les lignes famille (les bandeaux de
 *     groupe et les lignes opération rejouent les mêmes JH).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const CP = require('./_esm').loadEsm('src/modules/shared/lib/campagneProduction.js');






test('vitesseRecolte — `null` sans récolte pointée, JAMAIS 0 ni l\'infini', () => {
  // Le cas COURANT en début de campagne : des kilos, aucune récolte pointée.
  assert.deepStrictEqual(CP.vitesseRecolte({ kg: 5000, jh: 0, cout: 0 }),
    { kgParJh: null, kgParDh: null, dhParKg: null });
  // Et l'inverse : de la récolte pointée, pas encore de kilos → 0 kg/JH, qui est
  // une information vraie (on a travaillé sans rien ramener), pas un « — ».
  assert.deepStrictEqual(CP.vitesseRecolte({ kg: 0, jh: 10, cout: 1000 }),
    { kgParJh: 0, kgParDh: 0, dhParKg: null });
});

test('vitesseRecolte — kg/JH, kg/DH et le DH/kg qui en est l\'inverse exact', () => {
  const v = CP.vitesseRecolte({ kg: 6000, jh: 50, cout: 12000 });
  assert.strictEqual(v.kgParJh, 120);
  assert.strictEqual(v.kgParDh, 0.5);
  assert.strictEqual(v.dhParKg, 2);
  assert.strictEqual(Math.round(v.kgParDh * v.dhParKg * 1e6) / 1e6, 1, 'inverses exacts');
});

test('effortRecolte — ne somme QUE les lignes famille (jamais groupe ni opération)', () => {
  const rows = [
    { type: 'groupe', key: 'M.O Récolte', pivot: { P1: { jh: 30, cout: 3000 } } },
    { type: 'famille', key: 'GB08', pivot: { P1: { jh: 20, cout: 2000 }, P2: { jh: 10, cout: 1000 } } },
    { type: 'operation', key: 'GB08::CUEILLETTE', pivot: { P1: { jh: 20, cout: 2000 } } },
  ];
  // 30 JH, pas 80 : le bandeau et la ligne opération rejouent la même famille.
  assert.deepStrictEqual(CP.effortRecolte(rows), { jh: 30, cout: 3000 });
  assert.deepStrictEqual(CP.effortRecolte([]), { jh: 0, cout: 0 });
  assert.deepStrictEqual(CP.effortRecolte(null), { jh: 0, cout: 0 });
});

test('kgParParcelle — le champ « Parcelle / Bloc » du bon rejoint la colonne de la grille', () => {
  // Cas RÉEL (bon n° 8865, capture du 20/08/2026) : le bon d'apport imprime
  // « Parcelle / Bloc : BREEZE MYRTILLE S8-2 », et c'est mot pour mot
  // l'intitulé de la colonne côté référentiel parcelle. C'est ce rapprochement
  // qui fait apparaître la cadence kg/JH parcelle par parcelle.
  const cles = ['BREEZE MYRTILLE S8-2', 'CASCADE MYRTILLE S8-1'];
  const out = CP.kgParParcelle({
    bons: [
      { poidsLot: 135, dateISO: '2026-07-10', typeVente: 'Export', designation: 'BREEZE MYRTILLE S8-2' },
      { poidsLot: 40, dateISO: '2026-07-11', typeVente: 'Export', blocLabel: 'cascade  myrtille s8-1' },
      { poidsLot: 7, dateISO: '2026-07-12', typeVente: 'Export', designation: 'PARCELLE INCONNUE' },
    ],
    blocIds: [], cles, debut: '2026-07-01',
  });
  assert.deepStrictEqual(out.parParcelle,
    { 'BREEZE MYRTILLE S8-2': 135, 'CASCADE MYRTILLE S8-1': 40 });
  assert.strictEqual(out.kgNonRattaches, 7, 'jamais jeté en silence');
});

test('kgParParcelle — le BLOC ID du DQR prime sur la désignation', () => {
  // Le DQR porte le BLOC ID : c'est la source la plus sûre, elle passe devant
  // le libellé imprimé (qui peut être ressaisi à la main).
  const out = CP.kgParParcelle({
    bons: [{ poidsLot: 50, dateISO: '2026-07-10', typeVente: 'Export',
      bloc: 'BLOC-172-MAR', designation: 'F5- MYA S9' }],
    blocIds: [{ id: 'BLOC-172-MAR', parcelle: 'F1- S5 MARAVILLA MD' }],
    cles: ['F1- S5 MARAVILLA MD', 'F5- MYA S9'], debut: '2026-07-01',
  });
  assert.deepStrictEqual(out.parParcelle, { 'F1- S5 MARAVILLA MD': 50 });
});
