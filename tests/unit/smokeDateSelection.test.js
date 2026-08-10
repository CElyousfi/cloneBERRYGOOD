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

/** Date du jour telle que le module la calcule (locale), pour bâtir les cas. */
const TODAY = todayStr();
const veille = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const p = v => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

test('todayStr: format YYYY-MM-DD, mois et jour sur 2 chiffres', () => {
  assert.match(TODAY, /^\d{4}-\d{2}-\d{2}$/);
});

// Ces assertions portent sur des PROPRIÉTÉS et non sur une date précise : la
// veille est un dimanche un lundi sur sept, et la sélection préfère alors une
// journée ouvrée. Figer la date rendrait le test faux un jour par semaine.
test('pickStableDate: ignore la journée en cours et prend une journée terminée', () => {
  const r = pickStableDate([{ date: TODAY }, { date: veille }, { date: '2026-01-01' }]);
  assert.notEqual(r.date, TODAY, 'la journée en cours ne doit jamais être choisie');
  assert.ok(r.date < TODAY, 'la date retenue doit être antérieure à aujourd\'hui');
  assert.equal(r.relaxed, false, 'une journée terminée ne doit PAS être relâchée');
});

test('pickStableDate: sans journée en cours, retient une journée ouvrée terminée', () => {
  const r = pickStableDate([{ date: veille }, { date: '2026-01-01' }]);
  assert.ok(r.date < TODAY);
  assert.equal(isTestedDayWorkday(r.date), true, 'une journée ouvrée est préférée');
  assert.equal(r.relaxed, false);
});

test('pickStableDate: SEULEMENT la journée en cours → repli relâché', () => {
  const r = pickStableDate([{ date: TODAY }]);
  assert.equal(r.date, TODAY);
  assert.equal(r.relaxed, true, 'faute de journée terminée, on relâche');
  assert.match(r.reason, /aucune journée terminée/i);
});

test('pickStableDate: liste vide ou absente → pas de date, suite ignorée en aval', () => {
  for (const entree of [[], null, undefined]) {
    const r = pickStableDate(entree);
    assert.equal(r.date, null, `attendu null pour ${JSON.stringify(entree)}`);
  }
});

test('pickStableDate: entrées malformées ignorées sans planter', () => {
  const r = pickStableDate([null, {}, { date: '' }, { date: veille }, { date: '2026-01-01' }]);
  assert.ok(r.date && r.date < TODAY, 'une date exploitable doit être retenue');
  assert.equal(r.relaxed, false);
});

// Cas du LUNDI : sans cette préférence, on évaluerait le dimanche — seuils de
// charge relâchés et suite 4 sautée, donc un smoke faible un jour sur six.
test('pickStableDate: saute le dimanche pour garder une journée ouvrée', () => {
  const r = pickStableDate([
    { date: '2026-08-10' }, // lundi (en cours si on est ce jour-là)
    { date: '2026-08-09' }, // dimanche
    { date: '2026-08-08' }, // samedi, ouvré au Maroc
  ]);
  assert.notEqual(r.date, '2026-08-09', 'le dimanche ne doit pas être choisi');
  assert.equal(r.relaxed, false);
  assert.equal(isTestedDayWorkday(r.date), true, 'la date retenue doit être ouvrée');
});

test('pickStableDate: aucune journée ouvrée terminée → retombe sur la plus récente', () => {
  const r = pickStableDate([{ date: '2026-08-09' }]); // dimanche seul
  assert.equal(r.date, '2026-08-09');
  assert.equal(r.relaxed, false, 'journée terminée : pas de relâchement au titre de la complétude');
  assert.match(r.reason, /non ouvrée/i);
});

test('pickStableDate: une date FUTURE n\'est pas prise pour une journée terminée', () => {
  const futur = '2099-01-01';
  const r = pickStableDate([{ date: futur }, { date: TODAY }, { date: veille }]);
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
    const r = pickStableDate([{ date: TODAY }, { date: veille }]);
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
    const r = pickStableDate([{ date: TODAY }, { date: veille }]);
    assert.equal(r.date, TODAY);
    assert.equal(r.relaxed, true);
  } finally {
    if (avant === undefined) delete process.env.SMOKE_TEST_DATE;
    else process.env.SMOKE_TEST_DATE = avant;
  }
});
