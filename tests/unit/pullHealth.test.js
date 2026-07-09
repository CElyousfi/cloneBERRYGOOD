'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
  computePullHealth,
  decidePullAlert,
  buildPullMessage,
} = require('../../functions/lib/pointage/pullHealth');

const NOW = new Date('2026-07-08T10:00:00Z');

// ---------------------------------------------------------------------------
// computePullHealth
// ---------------------------------------------------------------------------

test('pull_failing: consecutiveFailures >= 2 déclenche l\'alerte', () => {
  const h = computePullHealth({
    consecutiveFailures: 2,
    mirrorMaxDate: '2026-07-07',
    bdpMaxDate: '2026-07-07',
    now: NOW,
  });
  assert.strictEqual(h.alert, true);
  assert.strictEqual(h.kind, 'pull_failing');
  assert.strictEqual(h.consecutiveFailures, 2);
});

test('pull_failing prioritaire même avec un lag présent', () => {
  const h = computePullHealth({
    consecutiveFailures: 3,
    mirrorMaxDate: '2026-07-01',
    bdpMaxDate: '2026-07-07',
    now: NOW,
  });
  assert.strictEqual(h.kind, 'pull_failing');
});

test('consecutiveFailures = 1 ne déclenche PAS pull_failing', () => {
  const h = computePullHealth({
    consecutiveFailures: 1,
    mirrorMaxDate: '2026-07-07',
    bdpMaxDate: '2026-07-07',
    now: NOW,
  });
  assert.strictEqual(h.alert, false);
  assert.strictEqual(h.kind, null);
});

test('renfort: probeSqlFailed + cf=1 déclenche pull_failing (sonde SQL injoignable)', () => {
  const h = computePullHealth({
    consecutiveFailures: 1,
    mirrorMaxDate: null,
    bdpMaxDate: null,
    probeSqlFailed: true,
    now: NOW,
  });
  assert.strictEqual(h.alert, true);
  assert.strictEqual(h.kind, 'pull_failing');
  assert.match(h.reason, /sonde SQL injoignable/);
});

test('pas de faux positif: probeSqlFailed + cf=0 ne déclenche RIEN', () => {
  const h = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: null,
    bdpMaxDate: null,
    probeSqlFailed: true,
    now: NOW,
  });
  assert.strictEqual(h.alert, false);
  assert.strictEqual(h.kind, null);
});

test('SQL down (bdpMaxDate null) + cf>=2 → pull_failing quand même', () => {
  const h = computePullHealth({
    consecutiveFailures: 18,
    mirrorMaxDate: '2026-07-07',
    bdpMaxDate: null, // BDP illisible car SQL down
    probeSqlFailed: true,
    now: NOW,
  });
  assert.strictEqual(h.alert, true);
  assert.strictEqual(h.kind, 'pull_failing');
  assert.strictEqual(h.consecutiveFailures, 18);
});

test('mirror_lag: lag > 24h déclenche l\'alerte', () => {
  const h = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: '2026-07-04', // BDP - 3 jours
    bdpMaxDate: '2026-07-07',
    now: NOW,
  });
  assert.strictEqual(h.alert, true);
  assert.strictEqual(h.kind, 'mirror_lag');
  assert.strictEqual(h.lagHours, 72);
});

test('pas d\'alerte: lag exactement 24h (borne stricte)', () => {
  const h = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: '2026-07-06',
    bdpMaxDate: '2026-07-07',
    now: NOW,
  });
  assert.strictEqual(h.alert, false);
  assert.strictEqual(h.kind, null);
});

test('pas d\'alerte: mirror == bdp (weekend-safe, lag 0)', () => {
  const h = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: '2026-07-05',
    bdpMaxDate: '2026-07-05',
    now: NOW,
  });
  assert.strictEqual(h.alert, false);
  assert.strictEqual(h.lagHours, 0);
});

test('pas d\'alerte: données manquantes (dates null)', () => {
  const h = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: null,
    bdpMaxDate: null,
    now: NOW,
  });
  assert.strictEqual(h.alert, false);
  assert.strictEqual(h.kind, null);
});

test('pas d\'alerte: consecutiveFailures illisible ET dates illisibles', () => {
  const h = computePullHealth({
    consecutiveFailures: undefined,
    mirrorMaxDate: 'pas-une-date',
    bdpMaxDate: undefined,
    now: NOW,
  });
  assert.strictEqual(h.alert, false);
});

test('accepte les objets Date et Timestamp-like', () => {
  const ts = { toDate: () => new Date('2026-07-07T00:00:00Z') };
  const h = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: new Date('2026-07-03T00:00:00Z'),
    bdpMaxDate: ts,
    now: NOW,
  });
  assert.strictEqual(h.kind, 'mirror_lag');
  assert.strictEqual(h.lagHours, 96);
});

// ---------------------------------------------------------------------------
// decidePullAlert — débounce
// ---------------------------------------------------------------------------

test('première détection → shouldSend alert', () => {
  const health = computePullHealth({ consecutiveFailures: 2, now: NOW });
  const d = decidePullAlert(health, null, NOW, 24);
  assert.strictEqual(d.shouldSend, true);
  assert.strictEqual(d.kind, 'alert');
  assert.strictEqual(d.nextState.stillAlerting, true);
});

test('débounce: 2e run < 24h → pas de renvoi', () => {
  const health = computePullHealth({ consecutiveFailures: 2, now: NOW });
  const first = decidePullAlert(health, null, NOW, 24);
  const later = new Date(NOW.getTime() + 3 * 3600000); // +3h
  const second = decidePullAlert(health, first.nextState, later, 24);
  assert.strictEqual(second.shouldSend, false);
  assert.strictEqual(second.kind, null);
});

test('débounce: run > 24h → rappel', () => {
  const health = computePullHealth({ consecutiveFailures: 2, now: NOW });
  const first = decidePullAlert(health, null, NOW, 24);
  const later = new Date(NOW.getTime() + 25 * 3600000);
  const second = decidePullAlert(health, first.nextState, later, 24);
  assert.strictEqual(second.shouldSend, true);
  assert.strictEqual(second.kind, 'reminder');
});

test('changement de kind → alerte immédiate', () => {
  const failing = computePullHealth({ consecutiveFailures: 2, now: NOW });
  const first = decidePullAlert(failing, null, NOW, 24);
  const lag = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: '2026-07-04',
    bdpMaxDate: '2026-07-07',
    now: NOW,
  });
  const later = new Date(NOW.getTime() + 1 * 3600000); // +1h < débounce
  const second = decidePullAlert(lag, first.nextState, later, 24);
  assert.strictEqual(second.shouldSend, true);
  assert.strictEqual(second.kind, 'alert');
});

test('retour au vert alors qu\'une alerte était active → resolved', () => {
  const health = computePullHealth({ consecutiveFailures: 2, now: NOW });
  const first = decidePullAlert(health, null, NOW, 24);
  const healthy = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: '2026-07-07',
    bdpMaxDate: '2026-07-07',
    now: NOW,
  });
  const d = decidePullAlert(healthy, first.nextState, NOW, 24);
  assert.strictEqual(d.shouldSend, true);
  assert.strictEqual(d.kind, 'resolved');
  assert.strictEqual(d.nextState.stillAlerting, false);
});

test('sain sans alerte antérieure → rien', () => {
  const healthy = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: '2026-07-07',
    bdpMaxDate: '2026-07-07',
    now: NOW,
  });
  const d = decidePullAlert(healthy, null, NOW, 24);
  assert.strictEqual(d.shouldSend, false);
  assert.strictEqual(d.kind, null);
});

// ---------------------------------------------------------------------------
// buildPullMessage — single line
// ---------------------------------------------------------------------------

test('message pull_failing: single-line, sans \\n', () => {
  const health = computePullHealth({ consecutiveFailures: 4, now: NOW });
  const msg = buildPullMessage('alert', health, { lastSuccessLabel: '07/07 08:05' });
  assert.match(msg, /pull pointage en panne/);
  assert.match(msg, /4 fois/);
  assert.ok(!/\s{2,}/.test(msg));
  assert.ok(!msg.includes('\n'));
});

test('message mirror_lag: single-line avec lagHours', () => {
  const health = computePullHealth({
    consecutiveFailures: 0,
    mirrorMaxDate: '2026-07-04',
    bdpMaxDate: '2026-07-07',
    now: NOW,
  });
  const msg = buildPullMessage('alert', health);
  assert.match(msg, /mirror pointage en retard de 72h/);
  assert.ok(!msg.includes('\n'));
});

test('message resolved', () => {
  const msg = buildPullMessage('resolved', { alert: false, kind: null });
  assert.match(msg, /Pull pointage rétabli/);
});

test('message reminder ajoute le rappel', () => {
  const health = computePullHealth({ consecutiveFailures: 2, now: NOW });
  const msg = buildPullMessage('reminder', health, { lastSuccessLabel: '06/07' });
  assert.match(msg, /RAPPEL/);
});
