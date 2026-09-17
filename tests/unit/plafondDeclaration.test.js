/*
 * plafondDeclaration.test.js
 *
 * Un ouvrier déclaré ne peut voir déclarer qu'un nombre limité de journées par
 * quinzaine ; au-delà, il est payé hors CNSS. Se tromper de plafond ne fait pas
 * planter l'application : cela déplace des journées d'un régime à l'autre, donc
 * des charges — et le total reste plausible.
 *
 * Les cas ci-dessous reprennent les trois quinzaines réelles de la campagne
 * 2026/2027, où le plafond a été mesuré directement dans les fichiers de paie.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const P = require('./_esm').loadEsm('src/modules/shared/lib/plafondDeclaration.js');

test('le plafond des TROIS quinzaines réelles est retrouvé', () => {
  // Mesuré dans les fichiers : le maximum de journées travaillées sur la feuille
  // POINTAGE vaut 13, 14 et 13. La règle « jours calendaires − dimanches » les
  // reproduit toutes les trois.
  assert.strictEqual(P.plafondQuinzaine('2026-07-08'), 13); // 01–15/07, 15 j
  assert.strictEqual(P.plafondQuinzaine('2026-07-20'), 14); // 16–31/07, 16 j
  assert.strictEqual(P.plafondQuinzaine('2026-08-05'), 13); // 01–15/08, 15 j
});

test('« 13 » N\'EST PAS une constante — une quinzaine de 16 jours en donne 14', () => {
  // Le coder en dur donnerait un plafond faux sur une quinzaine sur deux, et
  // sortirait de la CNSS une journée que la paie y déclare — pour 25 ouvriers
  // sur la seule quinzaine du 16–31/07.
  assert.notStrictEqual(P.plafondQuinzaine('2026-07-20'), 13);
});

test('bornesQuinzaine — 1er au 15, ou 16 à la FIN du mois', () => {
  assert.deepStrictEqual(P.bornesQuinzaine('2026-07-01'), { debut: '2026-07-01', fin: '2026-07-15' });
  assert.deepStrictEqual(P.bornesQuinzaine('2026-07-15'), { debut: '2026-07-01', fin: '2026-07-15' });
  assert.deepStrictEqual(P.bornesQuinzaine('2026-07-16'), { debut: '2026-07-16', fin: '2026-07-31' });
  // 30 jours, et février — la fin de mois est calculée, jamais tabulée.
  assert.deepStrictEqual(P.bornesQuinzaine('2026-06-20'), { debut: '2026-06-16', fin: '2026-06-30' });
  assert.deepStrictEqual(P.bornesQuinzaine('2026-02-20'), { debut: '2026-02-16', fin: '2026-02-28' });
  // Année bissextile : 29 jours, sans règle écrite à la main.
  assert.deepStrictEqual(P.bornesQuinzaine('2028-02-20'), { debut: '2028-02-16', fin: '2028-02-29' });
});

test('bornesQuinzaine — une date illisible rend `null`, jamais des bornes inventées', () => {
  // Des bornes inventées produiraient un plafond crédible et faux.
  ['', null, '2026-7-8', 'Quinzaine 01', '2026-13-01'].forEach((d) => {
    assert.strictEqual(P.bornesQuinzaine(d), null, String(d));
  });
});

test('les DIMANCHES sont les seuls jours retirés', () => {
  // Une semaine pleine : 7 jours − 1 dimanche = 6.
  assert.strictEqual(P.plafondSurPeriode('2026-07-06', '2026-07-12'), 6);
  // Un seul dimanche.
  assert.strictEqual(P.plafondSurPeriode('2026-07-05', '2026-07-05'), 0);
  // Un seul lundi.
  assert.strictEqual(P.plafondSurPeriode('2026-07-06', '2026-07-06'), 1);
});

test('plafondSurPeriode — bornes inversées ou illisibles : 0', () => {
  assert.strictEqual(P.plafondSurPeriode('2026-07-15', '2026-07-01'), 0);
  assert.strictEqual(P.plafondSurPeriode('n\'importe quoi', '2026-07-01'), 0);
});

test('repartir — au-delà du plafond, les journées sortent de la CNSS', () => {
  // Le cas réel du matricule 198 : 15 journées travaillées, 13 déclarées, 2 hors.
  assert.deepStrictEqual(P.repartir(15, 13), { declares: 13, horsPlafond: 2 });
  assert.deepStrictEqual(P.repartir(14, 13), { declares: 13, horsPlafond: 1 });
});

test('repartir — sous le plafond, RIEN ne sort', () => {
  assert.deepStrictEqual(P.repartir(10, 13), { declares: 10, horsPlafond: 0 });
  assert.deepStrictEqual(P.repartir(13, 13), { declares: 13, horsPlafond: 0 });
  assert.deepStrictEqual(P.repartir(0, 13), { declares: 0, horsPlafond: 0 });
});

test('repartir — plafond INCONNU : on ne coupe rien', () => {
  // Inventer une coupure serait pire que l'absence de plafond : elle sortirait
  // des journées de la CNSS sans aucune preuve. Le comportement d'avant est
  // conservé tant que le plafond n'est pas établi.
  assert.deepStrictEqual(P.repartir(15, 0), { declares: 15, horsPlafond: 0 });
  assert.deepStrictEqual(P.repartir(15, -1), { declares: 15, horsPlafond: 0 });
});
