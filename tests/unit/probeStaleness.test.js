'use strict';

/**
 * P1 pipeline pointage — détection de staleness + ré-alerte débounce.
 * Run: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../functions/lib/probeStaleness/probeStaleness.js');

// Repères : 2026-07-03 est un VENDREDI (jour ouvré).
//           2026-07-04 samedi, 2026-07-05 dimanche, 2026-07-06 lundi.
const FRIDAY = new Date('2026-07-03T09:00:00Z');
const MONDAY = new Date('2026-07-06T09:00:00Z');

// ── computeStaleness ─────────────────────────────────────────────────────────

test('computeStaleness — donnée fraîche (max = hier ouvré) → pas d\'alerte', () => {
  // vendredi, dernier jour ouvré attendu = jeudi 2026-07-02
  const r = S.computeStaleness({ maxDate: '2026-07-02', totalRows: 5375, now: FRIDAY });
  assert.equal(r.stale, false);
  assert.equal(r.condition, null);
  assert.equal(r.expectedWorkingDay, '2026-07-02');
});

test('computeStaleness — donnée du jour même → pas d\'alerte', () => {
  const r = S.computeStaleness({ maxDate: '2026-07-03', totalRows: 5375, now: FRIDAY });
  assert.equal(r.stale, false);
});

test('computeStaleness — donnée périmée un jour ouvré → alerte frozen', () => {
  // vendredi, max figé au 25 juin → périmé
  const r = S.computeStaleness({ maxDate: '2026-06-25', totalRows: 5375, now: FRIDAY });
  assert.equal(r.stale, true);
  assert.equal(r.condition, 'frozen');
  assert.equal(r.dataAgeDays, 8);
  assert.equal(r.expectedWorkingDay, '2026-07-02');
});

test('computeStaleness — week-end toléré : lundi matin, donnée de vendredi → pas d\'alerte', () => {
  // lundi 06/07, dernier jour ouvré attendu = vendredi 03/07 (samedi/dimanche sautés)
  const r = S.computeStaleness({ maxDate: '2026-07-03', totalRows: 5375, now: MONDAY });
  assert.equal(r.stale, false);
  assert.equal(r.expectedWorkingDay, '2026-07-03');
});

test('computeStaleness — férié toléré : vendredi férié, jeudi attendu', () => {
  // rendre jeudi 02/07 férié → dernier ouvré attendu = mercredi 01/07
  const r = S.computeStaleness({
    maxDate: '2026-07-01', totalRows: 5375, now: FRIDAY, holidays: ['2026-07-02'],
  });
  assert.equal(r.stale, false);
  assert.equal(r.expectedWorkingDay, '2026-07-01');
});

test('computeStaleness — table vide → alerte empty (même si récente)', () => {
  const r = S.computeStaleness({ maxDate: '2026-07-02', totalRows: 0, now: FRIDAY });
  assert.equal(r.stale, true);
  assert.equal(r.condition, 'empty');
});

test('computeStaleness — max illisible mais non-vide → alerte frozen', () => {
  const r = S.computeStaleness({ maxDate: null, totalRows: 5375, now: FRIDAY });
  assert.equal(r.stale, true);
  assert.equal(r.condition, 'frozen');
});

test('computeStaleness — accepte un objet Date', () => {
  const r = S.computeStaleness({ maxDate: new Date('2026-06-25T00:00:00Z'), totalRows: 5375, now: FRIDAY });
  assert.equal(r.stale, true);
  assert.equal(r.maxDate, '2026-06-25');
});

// ── decideAlert (débounce ré-alerte) ────────────────────────────────────────

const staleFrozen = { stale: true, condition: 'frozen', maxDate: '2026-06-25', dataAgeDays: 8 };
const fresh = { stale: false, condition: null, maxDate: '2026-07-02', dataAgeDays: 1 };

test('decideAlert — première détection → alerte', () => {
  const d = S.decideAlert(staleFrozen, null, FRIDAY);
  assert.equal(d.shouldSend, true);
  assert.equal(d.kind, 'alert');
  assert.equal(d.nextState.stillStale, true);
  assert.equal(d.nextState.lastAlertAt, FRIDAY.toISOString());
});

test('decideAlert — pas de ré-alerte avant 24h', () => {
  const state = { stillStale: true, condition: 'frozen', lastAlertAt: '2026-07-03T00:00:00.000Z' };
  const only12hLater = new Date('2026-07-03T12:00:00Z');
  const d = S.decideAlert(staleFrozen, state, only12hLater);
  assert.equal(d.shouldSend, false);
  assert.equal(d.kind, null);
  // lastAlertAt inchangé
  assert.equal(d.nextState.lastAlertAt, '2026-07-03T00:00:00.000Z');
});

test('decideAlert — ré-alerte (reminder) après 24h', () => {
  const state = { stillStale: true, condition: 'frozen', lastAlertAt: '2026-07-02T09:00:00.000Z' };
  const d = S.decideAlert(staleFrozen, state, FRIDAY);
  assert.equal(d.shouldSend, true);
  assert.equal(d.kind, 'reminder');
  assert.equal(d.nextState.lastAlertAt, FRIDAY.toISOString());
});

test('decideAlert — changement de condition → alerte immédiate', () => {
  const state = { stillStale: true, condition: 'frozen', lastAlertAt: FRIDAY.toISOString() };
  const staleEmpty = { stale: true, condition: 'empty' };
  const d = S.decideAlert(staleEmpty, state, new Date('2026-07-03T10:00:00Z'));
  assert.equal(d.shouldSend, true);
  assert.equal(d.kind, 'alert');
});

test('decideAlert — retour à la normale → message de résolution', () => {
  const state = { stillStale: true, condition: 'frozen', lastAlertAt: '2026-07-02T09:00:00.000Z' };
  const d = S.decideAlert(fresh, state, FRIDAY);
  assert.equal(d.shouldSend, true);
  assert.equal(d.kind, 'resolved');
  assert.equal(d.nextState.stillStale, false);
});

test('decideAlert — frais et aucune alerte active → rien', () => {
  const d = S.decideAlert(fresh, { stillStale: false }, FRIDAY);
  assert.equal(d.shouldSend, false);
  assert.equal(d.kind, null);
});
