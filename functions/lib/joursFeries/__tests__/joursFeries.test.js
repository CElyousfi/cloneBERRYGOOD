'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyNager, mergeHolidays, runSyncJoursFeries,
  addDaysIso, daysBetween, baseLabel, isSecondDay,
} = require('../joursFeries');

// ── Helpers ───────────────────────────────────────────────────────────────
test('addDaysIso ajoute des jours en gérant le passage de mois', () => {
  assert.equal(addDaysIso('2026-06-30', 1), '2026-07-01');
  assert.equal(addDaysIso('2026-06-06', -1), '2026-06-05');
});

test('daysBetween calcule le delta en jours', () => {
  assert.equal(daysBetween('2026-06-06', '2026-06-08'), 2);
  assert.equal(daysBetween('2026-06-08', '2026-06-06'), -2);
  assert.equal(daysBetween('2026-06-06', '2026-06-06'), 0);
});

test('baseLabel / isSecondDay gèrent le suffixe (2e jour)', () => {
  assert.equal(baseLabel('Aïd Al Adha (2e jour)'), 'Aïd Al Adha');
  assert.equal(baseLabel('Aïd Al Fitr'), 'Aïd Al Fitr');
  assert.equal(isSecondDay('Aïd Al Adha (2e jour)'), true);
  assert.equal(isSecondDay('Aïd Al Adha'), false);
});

// ── classifyNager ───────────────────────────────────────────────────────────
test('classifyNager mappe les fêtes islamiques anglaises → libellé fr', () => {
  assert.deepEqual(classifyNager({ name: 'Eid al-Fitr' }), { label: 'Aïd Al Fitr', type: 'islamique' });
  assert.deepEqual(classifyNager({ name: 'Eid al-Adha' }), { label: 'Aïd Al Adha', type: 'islamique' });
  assert.deepEqual(classifyNager({ name: 'Islamic New Year' }), { label: '1er Moharram', type: 'islamique' });
  assert.deepEqual(classifyNager({ name: "Prophet's Birthday" }), { label: 'Aïd Al Mawlid', type: 'islamique' });
});

test('classifyNager traite les fêtes civiles comme fixe (libellé local)', () => {
  assert.deepEqual(classifyNager({ name: 'Labour Day', localName: 'Fête du Travail' }),
    { label: 'Fête du Travail', type: 'fixe' });
});

// ── mergeHolidays ───────────────────────────────────────────────────────────
const baseExisting = () => ([
  { date: '2026-05-01', label: 'Fête du Travail', type: 'fixe', status: 'fixe', source: 'seed', manualOverride: false },
  { date: '2026-06-06', label: 'Aïd Al Adha', type: 'islamique', status: 'estime', source: 'seed', manualOverride: false },
  { date: '2026-06-07', label: 'Aïd Al Adha (2e jour)', type: 'islamique', status: 'estime', source: 'seed', manualOverride: false },
]);

test('islamique imminent (≤horizon) → status confirme + notif', () => {
  const api = [{ date: '2026-06-06', name: 'Eid al-Adha' }];
  const { holidays, notifications, changed } = mergeHolidays(baseExisting(), api,
    { todayIso: '2026-06-05', nowIso: '2026-06-05T05:00:00Z' });
  assert.equal(changed, true);
  const adha = holidays.find(h => h.label === 'Aïd Al Adha');
  assert.equal(adha.status, 'confirme');
  assert.equal(adha.source, 'api');
  // 2e jour dérivé = base + 1
  const adha2 = holidays.find(h => h.label === 'Aïd Al Adha (2e jour)');
  assert.equal(adha2.date, '2026-06-07');
  assert.equal(adha2.status, 'confirme');
  // notif déclenchée (imminent + confirmé)
  assert.ok(notifications.some(n => n.label === 'Aïd Al Adha' && n.confirmed));
});

test('islamique lointain (>horizon) reste estime, pas de notif', () => {
  const api = [{ date: '2026-06-06', name: 'Eid al-Adha' }];
  const { holidays, notifications, changed } = mergeHolidays(baseExisting(), api,
    { todayIso: '2026-05-01', nowIso: '2026-05-01T05:00:00Z' });
  // pas de changement de date (même 2026-06-06) ni de statut (déjà estime) → rien
  const adha = holidays.find(h => h.label === 'Aïd Al Adha');
  assert.equal(adha.status, 'estime');
  assert.equal(notifications.length, 0);
  assert.equal(changed, false);
});

test('décalage de date depuis l\'API → date mise à jour + notif si imminent', () => {
  const api = [{ date: '2026-06-07', name: 'Eid al-Adha' }]; // décalé +1 vs estimation
  const { holidays, notifications } = mergeHolidays(baseExisting(), api,
    { todayIso: '2026-06-06', nowIso: '2026-06-06T05:00:00Z' });
  const adha = holidays.find(h => h.label === 'Aïd Al Adha');
  assert.equal(adha.date, '2026-06-07');
  const adha2 = holidays.find(h => h.label === 'Aïd Al Adha (2e jour)');
  assert.equal(adha2.date, '2026-06-08');
  assert.ok(notifications.some(n => n.dateChanged && n.label === 'Aïd Al Adha'));
});

test('manualOverride RH n\'est jamais écrasé par l\'API', () => {
  const existing = baseExisting();
  existing[1] = { date: '2026-06-09', label: 'Aïd Al Adha', type: 'islamique', status: 'confirme', source: 'rh', manualOverride: true };
  existing[2] = { date: '2026-06-10', label: 'Aïd Al Adha (2e jour)', type: 'islamique', status: 'confirme', source: 'rh', manualOverride: true };
  const api = [{ date: '2026-06-06', name: 'Eid al-Adha' }];
  const { holidays, changed } = mergeHolidays(existing, api,
    { todayIso: '2026-06-05', nowIso: '2026-06-05T05:00:00Z' });
  const adha = holidays.find(h => h.label === 'Aïd Al Adha');
  assert.equal(adha.date, '2026-06-09'); // override RH préservé
  assert.equal(adha.source, 'rh');
  assert.equal(changed, false);
});

test('nouveau férié civique API absent → ajouté en status fixe', () => {
  const api = [{ date: '2026-11-18', name: 'Independence Day', localName: "Fête de l'Indépendance" }];
  const { holidays, changed } = mergeHolidays(baseExisting(), api,
    { todayIso: '2026-06-05', nowIso: '2026-06-05T05:00:00Z' });
  assert.equal(changed, true);
  const indep = holidays.find(h => h.date === '2026-11-18');
  assert.ok(indep);
  assert.equal(indep.type, 'fixe');
  assert.equal(indep.status, 'fixe');
  assert.equal(indep.source, 'api');
});

test('résultat trié par date croissante', () => {
  const api = [{ date: '2026-01-01', name: 'New Year', localName: 'Nouvel An' }];
  const { holidays } = mergeHolidays(baseExisting(), api,
    { todayIso: '2026-06-05', nowIso: '2026-06-05T05:00:00Z' });
  const dates = holidays.map(h => h.date);
  assert.deepEqual(dates, [...dates].sort());
});

// ── runSyncJoursFeries (DI) ─────────────────────────────────────────────────
test('runSyncJoursFeries fusionne, écrit si changé et notifie', async () => {
  let saved = null; const notified = [];
  const deps = {
    fetchHolidays: async () => [{ date: '2026-06-06', name: 'Eid al-Adha' }],
    getExisting: async () => ({ holidays: baseExisting() }),
    saveDoc: async (doc) => { saved = doc; },
    notify: async (n) => { notified.push(n); },
    nowIso: () => '2026-06-05T05:00:00Z',
    logger: () => {},
  };
  const r = await runSyncJoursFeries('2026-06-05', deps);
  assert.equal(r.changed, true);
  assert.ok(saved);
  assert.equal(saved.syncSource, 'api');
  assert.ok(saved.holidays.find(h => h.label === 'Aïd Al Adha').status === 'confirme');
  assert.ok(r.notified >= 1);
});

test('runSyncJoursFeries n\'écrit pas si API vide (pas d\'écrasement)', async () => {
  let saved = null;
  const deps = {
    fetchHolidays: async () => [],
    getExisting: async () => ({ holidays: baseExisting() }),
    saveDoc: async (doc) => { saved = doc; },
    nowIso: () => '2026-06-05T05:00:00Z',
    logger: () => {},
  };
  const r = await runSyncJoursFeries('2026-06-05', deps);
  assert.equal(r.changed, false);
  assert.equal(saved, null);
});

test('runSyncJoursFeries n\'écrit pas quand aucun changement', async () => {
  let saved = null;
  const deps = {
    fetchHolidays: async () => [{ date: '2026-06-06', name: 'Eid al-Adha' }],
    getExisting: async () => ({ holidays: baseExisting() }),
    saveDoc: async (doc) => { saved = doc; },
    nowIso: () => '2026-05-01T05:00:00Z', // lointain → reste estime, pas de changement
    logger: () => {},
  };
  const r = await runSyncJoursFeries('2026-05-01', deps);
  assert.equal(r.changed, false);
  assert.equal(saved, null);
});
