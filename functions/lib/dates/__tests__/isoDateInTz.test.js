'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isoDateInTz, isoDateCasablanca, CASABLANCA_TZ } = require('../isoDateInTz');

test('isoDateInTz: rend YYYY-MM-DD, pas le motif de la locale du process', () => {
  const d = new Date('2026-08-15T12:00:00Z');
  assert.equal(isoDateInTz(d, 'UTC'), '2026-08-15');
  assert.equal(isoDateInTz(d, CASABLANCA_TZ), '2026-08-15');
});

test('isoDateInTz: le fuseau décide du jour, pas UTC', () => {
  // 23h30 UTC = 00h30 le lendemain à Casablanca (UTC+1 hors Ramadan).
  const veille = new Date('2026-08-15T23:30:00Z');
  assert.equal(isoDateInTz(veille, 'UTC'), '2026-08-15');
  assert.equal(isoDateCasablanca(veille), '2026-08-16');

  // Pendant le Ramadan le Maroc repasse à UTC+0 : pas de bascule à 23h30.
  const ramadan = new Date('2026-03-01T23:30:00Z');
  assert.equal(isoDateCasablanca(ramadan), '2026-03-01');
});

test('isoDateInTz: accepte un timestamp, défaut UTC, défaut maintenant', () => {
  const t = Date.parse('2026-01-02T03:04:05Z');
  assert.equal(isoDateInTz(t, 'UTC'), '2026-01-02');
  assert.equal(isoDateInTz(t), '2026-01-02'); // fuseau par défaut = UTC
  assert.match(isoDateInTz(), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(isoDateCasablanca(), /^\d{4}-\d{2}-\d{2}$/);
});

test('isoDateInTz: instant invalide → RangeError (comme toISOString)', () => {
  assert.throws(() => isoDateInTz(new Date('nope'), 'UTC'), RangeError);
  assert.throws(() => isoDateInTz(NaN, 'UTC'), RangeError);
});

test('isoDateInTz: indépendant de la locale par défaut du process', () => {
  // Le bug d'origine : `Intl.DateTimeFormat('en-CA').format()` rend "08/15/2026"
  // sur ICU 72 (CLDR 42). Le helper ne doit jamais laisser passer un motif US.
  const d = new Date('2026-08-15T12:00:00Z');
  for (const tz of ['UTC', CASABLANCA_TZ, 'America/New_York', 'Asia/Tokyo']) {
    assert.match(isoDateInTz(d, tz), /^\d{4}-\d{2}-\d{2}$/, `motif non ISO pour ${tz}`);
  }
});
