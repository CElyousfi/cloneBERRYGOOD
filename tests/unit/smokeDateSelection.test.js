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

const { todayStr, pickStableDate } = require('../smoke-test.js');

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

test('pickStableDate: ignore la journée en cours et prend la dernière terminée', () => {
  const r = pickStableDate([{ date: TODAY }, { date: veille }, { date: '2026-01-01' }]);
  assert.equal(r.date, veille);
  assert.equal(r.relaxed, false, 'une journée terminée ne doit PAS être relâchée');
});

test('pickStableDate: aucune journée en cours → prend simplement la plus récente', () => {
  const r = pickStableDate([{ date: veille }, { date: '2026-01-01' }]);
  assert.equal(r.date, veille);
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
  const r = pickStableDate([null, {}, { date: '' }, { date: veille }]);
  assert.equal(r.date, veille);
  assert.equal(r.relaxed, false);
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
