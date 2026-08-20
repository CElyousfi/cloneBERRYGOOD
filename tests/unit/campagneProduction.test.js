/*
 * campagneProduction.test.js — la production en kg de l'écran Campagne.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *  1. un bon qu'aucun bloc ne reconnaît ne DISPARAÎT pas (il ressort en
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

const CP = require(path.join(__dirname, '../../public/lib/campagneProduction.js'));

const BLOCS = [
  { id: 'C2-S1S4-GC', variete: 'Maravilla', sousVariete: 'Green Cane', ferme: 'F1',
    ha: 4, culture: 'Framboise', nbPlants: 0, designations: ['MARAVILLA GG F1'] },
  { id: 'C2-S8-COR', variete: 'Corina', sousVariete: null, ferme: 'F5',
    ha: 2.5, culture: 'Myrtille', nbPlants: 8250, designations: ['CORINA MYRTILLE S8', 'F5 CORINA'] },
];
// Sep-Déc = cycle 1, Jan-Juin = cycle 2 (règle de app.jsx, injectée).
const cycleOf = (d) => { const m = new Date(d).getMonth(); return (m >= 8 && m <= 11) ? 1 : 2; };

function bon(over) {
  return Object.assign({
    poidsLot: 100, date: '2026-03-10', dateISO: '2026-03-10',
    typeVente: 'Export', designation: 'MARAVILLA GG F1',
  }, over || {});
}

test('agregeBlocs — rapproche par désignation DÉCLARÉE, casse et espaces neutralisés', () => {
  const out = CP.agregeBlocs({
    bons: [bon(), bon({ designation: '  maravilla   gg f1 ' }), bon({ designation: 'F5 CORINA', poidsLot: 50 })],
    blocs: BLOCS, cycle: 2, cycleOf,
  });
  assert.strictEqual(out.lignes.length, 2);
  assert.deepStrictEqual(out.lignes.map((l) => [l.label, l.kg, l.bons]), [
    ['Maravilla Green Cane', 200, 2],   // trié par kg décroissant
    ['Corina', 50, 1],
  ]);
  assert.strictEqual(out.kgNonRattaches, 0);
});

test('agregeBlocs — un bon non rattaché n\'est PAS jeté en silence', () => {
  const out = CP.agregeBlocs({
    bons: [bon(), bon({ designation: 'NOUVEAU BLOC INCONNU', poidsLot: 42 })],
    blocs: BLOCS, cycle: 2, cycleOf,
  });
  assert.strictEqual(out.kgNonRattaches, 42);
  assert.strictEqual(out.bonsNonRattaches, 1);
  assert.strictEqual(out.kgTotal, 142, 'le total compte TOUT ce qui est passé au filtre');
  assert.strictEqual(out.lignes.reduce((s, l) => s + l.kg, 0), 100);
});

test('agregeBlocs — filtres de périmètre : type de vente, cycle', () => {
  const bons = [
    bon(),                                              // export, cycle 2
    bon({ typeVente: 'Marché Local', poidsLot: 999 }),  // exclu
    bon({ date: '2025-10-10', dateISO: '2025-10-10', poidsLot: 777 }), // cycle 1, exclu
    bon({ poidsLot: 0 }),                               // poids nul, exclu
  ];
  const out = CP.agregeBlocs({ bons, blocs: BLOCS, cycle: 2, cycleOf });
  assert.strictEqual(out.kgTotal, 100);
  // Sans filtre de type de vente, le marché local revient.
  assert.strictEqual(CP.agregeBlocs({ bons, blocs: BLOCS, cycle: 2, cycleOf, typeVente: '' }).kgTotal, 1099);
});

test('agregeBlocs — fenêtre de campagne : bornes incluses, date illisible écartée', () => {
  const bons = [
    bon({ dateISO: '2026-07-01', poidsLot: 10 }),   // borne basse incluse
    bon({ dateISO: '2026-06-30', poidsLot: 20 }),   // campagne précédente
    bon({ dateISO: '2026-08-20', poidsLot: 30 }),   // borne haute incluse
    bon({ dateISO: '', date: 'n/a', poidsLot: 40 }),
  ];
  const out = CP.agregeBlocs({ bons, blocs: BLOCS, debut: '2026-07-01', fin: '2026-08-20' });
  assert.strictEqual(out.kgTotal, 40, '10 + 30');
});

test('agregeBlocs — aucun filtre temporel : rien, plutôt qu\'un total de tout l\'historique', () => {
  const out = CP.agregeBlocs({ bons: [bon()], blocs: BLOCS });
  assert.deepStrictEqual(out, { lignes: [], kgNonRattaches: 0, bonsNonRattaches: 0, kgTotal: 0 });
});

test('rendements — kg/Ha et kg/plant, `null` quand le dénominateur est inconnu', () => {
  assert.deepStrictEqual(CP.rendements({ kg: 1000, ha: 4, nbPlants: 0 }),
    { kgHa: 250, kgPlant: null }, 'framboise : pas de comptage en plants');
  assert.deepStrictEqual(CP.rendements({ kg: 8250, ha: 2.5, nbPlants: 8250 }),
    { kgHa: 3300, kgPlant: 1 });
  assert.deepStrictEqual(CP.rendements({ kg: 100, ha: 0, nbPlants: 0 }),
    { kgHa: null, kgPlant: null }, 'jamais une division par zéro');
});

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

test('agregeBlocs — PURE : les bons et les blocs d\'entrée ne sont pas mutés', () => {
  const bons = [bon()];
  const blocs = JSON.parse(JSON.stringify(BLOCS));
  const avantBons = JSON.parse(JSON.stringify(bons));
  const avantBlocs = JSON.parse(JSON.stringify(blocs));
  CP.agregeBlocs({ bons, blocs, cycle: 2, cycleOf });
  assert.deepStrictEqual(bons, avantBons);
  assert.deepStrictEqual(blocs, avantBlocs);
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
