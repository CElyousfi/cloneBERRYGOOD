'use strict';

/**
 * Sélection de la date évaluée par le smoke post-déploiement.
 *
 * Enjeu : le smoke évaluait `dates[0]`, qui devient la journée EN COURS dès que
 * la synchro du matin la fait apparaître (~09h05 UTC). Les contrôles qui
 * présupposent une journée complète passaient alors au rouge chaque matin.
 *
 * Le correctif ancre ces contrôles sur la dernière journée TERMINÉE plutôt que
 * de les dégrader en avertissement — le smoke ne tourne qu'après un déploiement,
 * donc un relâchement permanent les aurait rendus muets en pratique.
 *
 * Ces tests verrouillent la règle de sélection, qui est la partie subtile.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { todayStr, pickStableDate, isTestedDayWorkday } = require('../smoke-test.js');

// Le module charge `.env` à l'import, et le shell peut lui-même porter la
// variable : sans ce reset, les tests qui ne la pilotent pas eux-mêmes en
// héritent et échouent (vérifié : SMOKE_TEST_DATE=… → 5 échecs sur 8).
delete process.env.SMOKE_TEST_DATE;

// Dates FIXES, et `today` INJECTÉ dans pickStableDate. Une version antérieure
// figeait `TODAY = todayStr()` à l'import et laissait pickStableDate le
// recalculer à l'appel : au passage de minuit entre les deux, la date figée
// devenait une « journée terminée » et un test échouait, une seule fois, jamais
// reproductible. Un flake nocturne coûte plus cher qu'il n'y paraît — il apprend
// à ignorer un rouge.
//
// 2026-08-10 est un lundi, 08-09 un dimanche, 08-08 un samedi (ouvré au Maroc).
const TODAY = '2026-08-10';
const veille = '2026-08-09';
const samedi = '2026-08-08';

test('todayStr: format YYYY-MM-DD, mois et jour sur 2 chiffres', () => {
  assert.match(todayStr(), /^\d{4}-\d{2}-\d{2}$/);
});

// Assertions sur des PROPRIÉTÉS plutôt que sur une date précise : ce qui est
// verrouillé ici, c'est « jamais la journée en cours, jamais relâché », pas le
// choix exact — celui-ci est couvert par les tests dédiés plus bas.
test('pickStableDate: ignore la journée en cours et prend une journée terminée', () => {
  const r = pickStableDate([{ date: TODAY }, { date: veille }, { date: '2026-01-01' }], TODAY);
  assert.notEqual(r.date, TODAY, 'la journée en cours ne doit jamais être choisie');
  assert.ok(r.date < TODAY, 'la date retenue doit être antérieure à aujourd\'hui');
  assert.equal(r.relaxed, false, 'une journée terminée ne doit PAS être relâchée');
});

test('pickStableDate: sans journée en cours, retient une journée ouvrée terminée', () => {
  const r = pickStableDate([{ date: veille }, { date: '2026-01-01' }], TODAY);
  assert.ok(r.date < TODAY);
  assert.equal(isTestedDayWorkday(r.date), true, 'une journée ouvrée est préférée');
  assert.equal(r.relaxed, false);
});

test('pickStableDate: SEULEMENT la journée en cours → repli relâché', () => {
  const r = pickStableDate([{ date: TODAY }], TODAY);
  assert.equal(r.date, TODAY);
  assert.equal(r.relaxed, true, 'faute de journée terminée, on relâche');
  assert.match(r.reason, /aucune journée terminée/i);
});

test('pickStableDate: liste vide ou absente → pas de date, suite ignorée en aval', () => {
  for (const entree of [[], null, undefined]) {
    const r = pickStableDate(entree, TODAY);
    assert.equal(r.date, null, `attendu null pour ${JSON.stringify(entree)}`);
  }
});

test('pickStableDate: entrées malformées ignorées sans planter', () => {
  const r = pickStableDate([null, {}, { date: '' }, { date: veille }, { date: '2026-01-01' }], TODAY);
  assert.ok(r.date && r.date < TODAY, 'une date exploitable doit être retenue');
  assert.equal(r.relaxed, false);
});

// Cas du LUNDI : sans cette préférence, on évaluerait le dimanche — seuils de
// charge relâchés et suite 4 sautée, donc un smoke faible un jour sur six.
test('pickStableDate: saute le dimanche pour garder une journée ouvrée', () => {
  const r = pickStableDate([
    { date: TODAY },   // lundi, journée en cours
    { date: veille },  // dimanche
    { date: samedi },  // samedi, ouvré au Maroc
  ], TODAY);
  assert.equal(r.date, samedi, 'on saute le dimanche pour tester le samedi');
  assert.equal(r.relaxed, false);
  assert.equal(isTestedDayWorkday(r.date), true, 'la date retenue doit être ouvrée');
});

test('pickStableDate: aucune journée ouvrée terminée → retombe sur la plus récente', () => {
  const r = pickStableDate([{ date: '2026-08-09' }], TODAY); // dimanche seul
  assert.equal(r.date, '2026-08-09');
  assert.equal(r.relaxed, false, 'journée terminée : pas de relâchement au titre de la complétude');
  assert.match(r.reason, /non ouvrée/i);
});

test('pickStableDate: une date FUTURE n\'est pas prise pour une journée terminée', () => {
  const futur = '2099-01-01';
  const r = pickStableDate([{ date: futur }, { date: TODAY }, { date: veille }], TODAY);
  assert.equal(r.date, veille, 'une date future serait testée quasi vide → faux rouge');
});

// isTestedDayWorkday porte sur le jour ÉVALUÉ, pas sur le jour d'exécution :
// un déploiement le lundi teste le dimanche, et appliquer les seuils du jour
// ouvré à un jour chômé recréerait le rouge structurel, décalé au lundi.
test('isTestedDayWorkday: dimanche = non ouvré, quel que soit le jour d\'exécution', () => {
  assert.equal(isTestedDayWorkday('2026-08-09'), false, '2026-08-09 est un dimanche');
  assert.equal(isTestedDayWorkday('2026-08-10'), true, '2026-08-10 est un lundi');
  assert.equal(isTestedDayWorkday('2026-08-08'), true, '2026-08-08 est un samedi (ouvré au Maroc)');
});

test('SMOKE_TEST_DATE: une date passée force le mode strict (diagnostic)', () => {
  const avant = process.env.SMOKE_TEST_DATE;
  process.env.SMOKE_TEST_DATE = '2026-07-15';
  try {
    const r = pickStableDate([{ date: TODAY }, { date: veille }], TODAY);
    assert.equal(r.date, '2026-07-15');
    assert.equal(r.relaxed, false, 'une date passée forcée reste testée strictement');
  } finally {
    if (avant === undefined) delete process.env.SMOKE_TEST_DATE;
    else process.env.SMOKE_TEST_DATE = avant;
  }
});

test('SMOKE_TEST_DATE: viser aujourd\'hui explicitement relâche', () => {
  const avant = process.env.SMOKE_TEST_DATE;
  process.env.SMOKE_TEST_DATE = TODAY;
  try {
    const r = pickStableDate([{ date: TODAY }, { date: veille }], TODAY);
    assert.equal(r.date, TODAY);
    assert.equal(r.relaxed, true);
  } finally {
    if (avant === undefined) delete process.env.SMOKE_TEST_DATE;
    else process.env.SMOKE_TEST_DATE = avant;
  }
});
