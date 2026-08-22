/*
 * campagneRapprochement.test.js — le contrôle qui compare les deux chemins.
 *
 * L'écran Campagne agrège le pointage PAR PARCELLE : une ligne dont la parcelle
 * ou la culture ne se résout pas n'y entre pas. L'écran Quinzaine, lui, part du
 * pointage BRUT. L'écart entre les deux mesure exactement ce que la grille ne
 * voit pas — un trou qui ne se signale jamais tout seul, parce qu'un total plus
 * petit reste un total plausible.
 *
 * Les deux côtés portent le COÛT CHARGÉ, plus la base BEE ONE : rapprocher deux
 * écrans sur un chiffre qu'aucun des deux n'affiche validerait une couverture
 * sans jamais contrôler le montant qu'on lit.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const R = require(path.join(__dirname, '../../public/lib/campagneRapprochement.js'));

test('chargeParQuinzaine — somme le coût chargé et les JH sans taux par période', () => {
  const rows = [
    { periode: 'Quinzaine 01', coutCharge: 1000, jhSansTaux: 2 },
    { periode: 'Quinzaine 01', coutCharge: 500, jhSansTaux: 0 },
    { periode: 'Quinzaine 02', coutCharge: 700 },
    // Lignes inexploitables : ignorées, jamais comptées à zéro dans une
    // période fantôme.
    { periode: '', coutCharge: 999 },
    null,
  ];
  assert.deepStrictEqual(R.chargeParQuinzaine(rows), {
    'Quinzaine 01': { cout: 1500, jhSansTaux: 2 },
    'Quinzaine 02': { cout: 700, jhSansTaux: 0 },
  });
});

test('chargeParQuinzaine — une période SANS coût existe quand même', () => {
  // Une quinzaine dont AUCUNE ligne n'a de taux vaut 0 DH, pas « absente ».
  // La distinction compte : absente, elle ressortirait en écart total sans
  // qu'on sache si le travail manque ou seulement son prix.
  assert.deepStrictEqual(
    R.chargeParQuinzaine([{ periode: 'Quinzaine 03', jhSansTaux: 12 }]),
    { 'Quinzaine 03': { cout: 0, jhSansTaux: 12 } }
  );
});

test('rapprocher — écart nul quand la grille porte tout le coût chargé', () => {
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Quinzaine 01', jours: 100, base: 9744, primes: 3000, charges: 2500, coutTotal: 15244 },
    ],
    rows: [{ periode: 'Quinzaine 01', coutCharge: 15244 }],
    snapshots: { 'Quinzaine 01': { coutEmployeur: 15244 } },
  });
  assert.strictEqual(out.ecart, 0);
  assert.strictEqual(out.ecartPct, 0);
  assert.strictEqual(out.lignes[0].quinzaine, 15244);
});

test('rapprocher — la BASE BEE ONE n\'entre plus dans le rapprochement', () => {
  // Garde-fou de la règle produit : le coût BEE ONE ne doit plus décider de
  // rien. Ici `base` et `cout` sont grotesques ; le résultat ne bouge pas.
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Q1', jours: 10, base: 999999, primes: 100, charges: 200, coutTotal: 1300 },
    ],
    rows: [{ periode: 'Q1', cout: 888888, coutCharge: 1300 }],
    snapshots: { Q1: { coutEmployeur: 1300 } },
  });
  assert.strictEqual(out.lignes[0].grille, 1300);
  assert.strictEqual(out.lignes[0].quinzaine, 1300);
  assert.strictEqual(out.ecart, 0);
});

test('rapprocher — l\'écart mesure le coût que la grille ne rattache pas', () => {
  // 15 244 DH de coût chargé, 13 244 seulement rattachés à une parcelle :
  // 2 000 DH de travail réel manquent à l'écran Campagne.
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Quinzaine 01', jours: 100, base: 9744, primes: 3000, charges: 2500, coutTotal: 15244 },
    ],
    rows: [{ periode: 'Quinzaine 01', coutCharge: 13244 }],
    snapshots: { 'Quinzaine 01': { coutEmployeur: 15244 } },
  });
  assert.strictEqual(out.lignes[0].grille, 13244);
  assert.strictEqual(out.lignes[0].quinzaine, 15244);
  assert.strictEqual(out.lignes[0].ecart, 2000);
  assert.strictEqual(Math.round(out.lignes[0].ecartPct * 10000) / 10000, 0.1312);
});

test('rapprocher — les JH sans taux remontent, ligne à ligne et au total', () => {
  // Le cas qui explique un écart sans qu'aucun total ne paraisse anormal :
  // des ouvriers pointés mais sans fiche de paie comptent en volume, à coût nul.
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Q1', jours: 10, coutTotal: 1300 },
      { periode: 'Q2', jours: 20, coutTotal: 2600 },
    ],
    rows: [
      { periode: 'Q1', coutCharge: 1200, jhSansTaux: 3 },
      { periode: 'Q2', coutCharge: 2600, jhSansTaux: 0 },
    ],
    snapshots: { Q1: { coutEmployeur: 1300 }, Q2: { coutEmployeur: 2600 } },
  });
  assert.strictEqual(out.lignes[0].jhSansTaux, 3);
  assert.strictEqual(out.lignes[1].jhSansTaux, 0);
  assert.strictEqual(out.totalJhSansTaux, 3);
});

test('rapprocher — une quinzaine absente de la grille ressort en écart total', () => {
  // Le cas dangereux : aucune ligne côté grille. Sans ce contrôle, la quinzaine
  // disparaîtrait sans laisser de trace.
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Quinzaine 07', jours: 50, base: 5000, primes: 0, charges: 0, coutTotal: 5000 },
    ],
    rows: [],
    snapshots: { 'Quinzaine 07': { coutEmployeur: 5000 } },
  });
  assert.strictEqual(out.lignes[0].grille, 0);
  assert.strictEqual(out.lignes[0].ecart, 5000);
  assert.strictEqual(out.lignes[0].ecartPct, 1);
});

test('rapprocher — quinzaine sans coût : `null`, jamais « 0 % rapproché »', () => {
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Quinzaine 09', jours: 0, base: 0, primes: 0, charges: 0, coutTotal: 0 },
    ],
    rows: [],
    snapshots: {},
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
    rows: [{ periode: 'Q1', coutCharge: 1200 }, { periode: 'Q2', coutCharge: 2600 }],
    snapshots: { Q1: { coutEmployeur: 1300 }, Q2: { coutEmployeur: 2600 } },
  });
  assert.strictEqual(out.totalQuinzaine, 3900);
  assert.strictEqual(out.totalGrille, 3800);
  assert.strictEqual(out.ecart, 100);
  assert.strictEqual(out.lignes.length, 2);
});

test('rapprocher — la décomposition permet d\'isoler un poste manquant', () => {
  // « À 114 DH/JH, il manque sûrement un composant : transport, primes fixes,
  // ancienneté… » — le tableau doit permettre de le lire, donc `primes` et
  // `charges` doivent survivre au rapprochement, et le salaire s'en déduire.
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Q1', jours: 10, primes: 300, charges: 250, coutTotal: 1550 },
    ],
    rows: [{ periode: 'Q1', coutCharge: 1550 }],
    snapshots: { Q1: { coutEmployeur: 1550 } },
  });
  const l = out.lignes[0];
  assert.strictEqual(l.primes, 300);
  assert.strictEqual(l.charges, 250);
  assert.strictEqual(l.quinzaine - l.primes - l.charges, 1000);
});

test('rapprocher — la ventilation par poste est servie telle quelle', () => {
  // Le tableau principal dit COMBIEN manque ; la ventilation dit OÙ. Un poste
  // à zéro sur toute la campagne — le transport, en l'occurrence — désigne une
  // donnée qui n'arrive pas, pas un poste réellement vide.
  const postes = { transport: 0, recolte: 4200, primeFonction: 900 };
  const out = R.rapprocher({
    parQuinzaine: [{ periode: 'Q1', coutTotal: 1300, postes }],
    rows: [{ periode: 'Q1', coutCharge: 1300 }],
    snapshots: { Q1: { coutEmployeur: 1300 } },
  });
  assert.deepStrictEqual(out.lignes[0].postes, postes);
});

test('rapprocher — sans ventilation, `postes` vaut null et non un objet vide', () => {
  // Un `{}` se rendrait comme une ventilation intégralement à zéro : douze
  // postes manquants au lieu d'une information absente.
  const out = R.rapprocher({
    parQuinzaine: [{ periode: 'Q1', coutTotal: 1300 }],
    rows: [{ periode: 'Q1', coutCharge: 1300 }],
    snapshots: { Q1: { coutEmployeur: 1300 } },
  });
  assert.strictEqual(out.lignes[0].postes, null);
});

test('rapprocher — SANS instantané : `null`, jamais un repli sur le calcul local', () => {
  // Le cœur de la bascule. `coutTotal` est l'AUTRE implémentation — celle que le
  // rapprochement est censé contrôler. S'en servir de référence par défaut
  // ferait passer un écart nul pour une preuve, alors qu'il ne prouverait
  // qu'une chose : le calcul est égal à lui-même.
  const out = R.rapprocher({
    parQuinzaine: [{ periode: 'Q1', coutTotal: 168071 }],
    rows: [{ periode: 'Q1', coutCharge: 168071 }],
    snapshots: {},
  });
  assert.strictEqual(out.lignes[0].quinzaine, null);
  assert.strictEqual(out.lignes[0].ecart, null);
  assert.strictEqual(out.lignes[0].ecartPct, null);
  assert.deepStrictEqual(out.sansSnapshot, ['Q1']);
});

test('rapprocher — un instantané à 0 est traité comme absent', () => {
  // Zéro n'est pas une mesure : c'est un écran qui n'avait pas fini de charger.
  const out = R.rapprocher({
    parQuinzaine: [{ periode: 'Q1', coutTotal: 1300 }],
    rows: [{ periode: 'Q1', coutCharge: 1300 }],
    snapshots: { Q1: { coutEmployeur: 0 } },
  });
  assert.strictEqual(out.lignes[0].quinzaine, null);
});

test('rapprocher — le total ignore les quinzaines sans instantané', () => {
  // Additionner une grille dont la référence manque gonflerait l'écart d'un
  // montant qui n'a jamais été mesuré — un écart inventé, et impossible à
  // rapprocher de quoi que ce soit.
  const out = R.rapprocher({
    parQuinzaine: [
      { periode: 'Q1', coutTotal: 1300 },
      { periode: 'Q2', coutTotal: 2600 },
    ],
    rows: [
      { periode: 'Q1', coutCharge: 1200 },
      { periode: 'Q2', coutCharge: 2500 },
    ],
    snapshots: { Q1: { coutEmployeur: 1300 } },
  });
  // Q2 n'est comparée ni au numérateur ni au dénominateur.
  assert.strictEqual(out.totalQuinzaine, 1300);
  assert.strictEqual(out.totalGrilleComparable, 1200);
  assert.strictEqual(out.ecart, 100);
  // `totalGrille` reste la somme COMPLÈTE : les deux chiffres ont chacun leur
  // usage, les confondre est ce qui produirait la soustraction impossible.
  assert.strictEqual(out.totalGrille, 3700);
  assert.deepStrictEqual(out.sansSnapshot, ['Q2']);
});

test('rapprocher — le NET À PAYER est servi à côté, jamais à la place du coût', () => {
  // Confusion constatée en usage : 187 737 (net à payer) comparé à un coût
  // chargé, d'où un écart inventé. Les deux diffèrent des charges sociales et
  // de la sous-traitance. Les afficher côte à côte est le seul moyen fiable de
  // ne pas les confondre — mais le rapprochement, lui, ne porte QUE sur le coût.
  const out = R.rapprocher({
    parQuinzaine: [{ periode: 'Q1', coutTotal: 0 }],
    rows: [{ periode: 'Q1', coutCharge: 194516 }],
    snapshots: { Q1: { coutEmployeur: 202528, netAPayer: 187737 } },
  });
  assert.strictEqual(out.lignes[0].quinzaine, 202528);
  assert.strictEqual(out.lignes[0].netQuinzaine, 187737);
  // L'écart se calcule sur le COÛT, pas sur le net.
  assert.strictEqual(out.lignes[0].ecart, 202528 - 194516);
});

test('rapprocher — net à payer absent : `null`, pas 0', () => {
  const out = R.rapprocher({
    parQuinzaine: [{ periode: 'Q1', coutTotal: 0 }],
    rows: [{ periode: 'Q1', coutCharge: 100 }],
    snapshots: { Q1: { coutEmployeur: 200 } },
  });
  assert.strictEqual(out.lignes[0].netQuinzaine, null);
});
