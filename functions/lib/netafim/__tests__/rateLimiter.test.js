'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { tryConsume, todayKey } = require('../rateLimiter');

test('todayKey: returns YYYY-MM-DD in Africa/Casablanca', () => {
  // 2026-05-16 00:30 UTC = 2026-05-16 01:30 in Africa/Casablanca
  const k = todayKey(Date.parse('2026-05-16T00:30:00Z'));
  assert.equal(k, '2026-05-16');
});

test('tryConsume: fresh day resets the counter', () => {
  const r = tryConsume({ callsToday: 25, callsResetDate: '2026-05-15' }, 25, Date.parse('2026-05-16T10:00:00Z'));
  assert.equal(r.allowed, true);
  assert.equal(r.next.callsToday, 1);
  assert.equal(r.next.callsResetDate, '2026-05-16');
});

test('tryConsume: increments same-day counter', () => {
  const today = todayKey(Date.now());
  const r = tryConsume({ callsToday: 3, callsResetDate: today }, 25);
  assert.equal(r.allowed, true);
  assert.equal(r.next.callsToday, 4);
});

test('tryConsume: refuses past the limit', () => {
  const today = todayKey(Date.now());
  const r = tryConsume({ callsToday: 25, callsResetDate: today }, 25);
  assert.equal(r.allowed, false);
  assert.equal(r.next.callsToday, 25);
});

test('tryConsume: handles missing cursor gracefully', () => {
  const r = tryConsume(null, 25);
  assert.equal(r.allowed, true);
  assert.equal(r.next.callsToday, 1);
});
