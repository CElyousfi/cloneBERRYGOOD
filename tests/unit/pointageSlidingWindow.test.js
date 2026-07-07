'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../functions/lib/pointage/slidingWindow.js');

test('computePointageWindow — fenêtre 7 jours inclusive par défaut', () => {
  // 2026-07-07 10:00 UTC → Casablanca (UTC+1 en été) = 2026-07-07
  const now = new Date('2026-07-07T10:00:00.000Z');
  const w = W.computePointageWindow(now);
  assert.equal(w.to, '2026-07-07');
  assert.equal(w.from, '2026-07-01'); // to - 6
  assert.equal(w.windowDays, 7);
});

test('computePointageWindow — bascule de jour en heure locale Casablanca', () => {
  // 23:30 UTC un 6 juillet → Casablanca (UTC+1) = déjà le 7 juillet 00:30
  const now = new Date('2026-07-06T23:30:00.000Z');
  const w = W.computePointageWindow(now);
  assert.equal(w.to, '2026-07-07');
  assert.equal(w.from, '2026-07-01');
});

test('computePointageWindow — traverse un changement de mois', () => {
  const now = new Date('2026-08-02T12:00:00.000Z');
  const w = W.computePointageWindow(now);
  assert.equal(w.to, '2026-08-02');
  assert.equal(w.from, '2026-07-27'); // to - 6 (retour en juillet)
});

test('computePointageWindow — windowDays personnalisable', () => {
  const now = new Date('2026-07-07T10:00:00.000Z');
  const w = W.computePointageWindow(now, 3);
  assert.equal(w.to, '2026-07-07');
  assert.equal(w.from, '2026-07-05'); // to - 2
  assert.equal(w.windowDays, 3);
});

test('computePointageWindow — windowDays invalide retombe sur 7', () => {
  const now = new Date('2026-07-07T10:00:00.000Z');
  assert.equal(W.computePointageWindow(now, 0).windowDays, 7);
  assert.equal(W.computePointageWindow(now, -5).windowDays, 7);
  assert.equal(W.computePointageWindow(now, undefined).windowDays, 7);
});

test('todayInCasablanca — format YYYY-MM-DD', () => {
  const s = W.todayInCasablanca(new Date('2026-07-07T10:00:00.000Z'));
  assert.match(s, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(s, '2026-07-07');
});

test('addDaysStr — arithmétique correcte', () => {
  assert.equal(W.addDaysStr('2026-07-01', 6), '2026-07-07');
  assert.equal(W.addDaysStr('2026-07-01', -1), '2026-06-30');
  assert.equal(W.addDaysStr('2026-03-01', -1), '2026-02-28');
});
