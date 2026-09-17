'use strict';

/**
 * Unit tests for functions/src/modules/recolte/recolteWhatsAppNotifier.js
 * Run with: npm run test:unit
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../../functions/src/modules/recolte/recolteWhatsAppNotifier.js');

test('aggregateByVariete groups, rounds and sorts desc', () => {
  const rows = [
    { matricule: 'A', variete: 'Maravilla', totalKg: 100.34 },
    { matricule: 'B', variete: 'Maravilla', totalKg: 50.16 },
    { matricule: 'C', variete: 'Sensation', totalKg: 200 },
    { matricule: 'D', variete: '', totalKg: 5 },
  ];
  const result = N.aggregateByVariete(rows);
  assert.deepEqual(result, [
    { variete: 'Sensation', totalKg: 200 },
    { variete: 'Maravilla', totalKg: 150.5 },
    { variete: 'Inconnu', totalKg: 5 },
  ]);
});

test('aggregateByVariete handles empty/null', () => {
  assert.deepEqual(N.aggregateByVariete([]), []);
  assert.deepEqual(N.aggregateByVariete(null), []);
});

test('shouldNotify: first notif of the day fires at threshold', () => {
  const r = N.shouldNotify({ afterKg: 120, lastNotifiedKg: null, date: '2026-05-14', lastNotifiedDate: null });
  assert.equal(r.notify, true);
  assert.equal(r.deltaKg, 120);
});

test('shouldNotify: first notif of the day blocked below threshold', () => {
  const r = N.shouldNotify({ afterKg: 80, lastNotifiedKg: null, date: '2026-05-14', lastNotifiedDate: null });
  assert.equal(r.notify, false);
  assert.equal(r.reason, 'below-threshold');
});

test('shouldNotify: delta vs last notif crosses threshold', () => {
  const r = N.shouldNotify({ afterKg: 250, lastNotifiedKg: 120, date: '2026-05-14', lastNotifiedDate: '2026-05-14' });
  assert.equal(r.notify, true);
  assert.equal(r.deltaKg, 130);
});

test('shouldNotify: delta below threshold blocks', () => {
  const r = N.shouldNotify({ afterKg: 200, lastNotifiedKg: 120, date: '2026-05-14', lastNotifiedDate: '2026-05-14' });
  assert.equal(r.notify, false);
  assert.equal(r.deltaKg, 80);
});

test('shouldNotify: previous notif was a different date → baseline resets to 0', () => {
  const r = N.shouldNotify({ afterKg: 150, lastNotifiedKg: 500, date: '2026-05-14', lastNotifiedDate: '2026-05-13' });
  assert.equal(r.notify, true);
  assert.equal(r.deltaKg, 150);
});

test('shouldNotify: zero or invalid total skipped', () => {
  assert.equal(N.shouldNotify({ afterKg: 0, lastNotifiedKg: null, date: '2026-05-14', lastNotifiedDate: null }).notify, false);
  assert.equal(N.shouldNotify({ afterKg: NaN, lastNotifiedKg: null, date: '2026-05-14', lastNotifiedDate: null }).notify, false);
});

test('shouldNotify: custom threshold honored', () => {
  const r = N.shouldNotify({ afterKg: 60, lastNotifiedKg: null, date: '2026-05-14', lastNotifiedDate: null, threshold: 50 });
  assert.equal(r.notify, true);
});

test('formatDateShort: YYYY-MM-DD → DD/MM', () => {
  assert.equal(N.formatDateShort('2026-05-14'), '14/05');
  assert.equal(N.formatDateShort('garbage'), 'garbage');
});

test('formatMessage: contains header, total, delta, varieties', () => {
  const msg = N.formatMessage({
    date: '2026-05-14',
    totalKg: 2340.5,
    deltaKg: 180,
    byVariete: [
      { variete: 'Maravilla', totalKg: 1200 },
      { variete: 'Sensation', totalKg: 740 },
      { variete: 'Cascade', totalKg: 400.5 },
    ],
    syncedAtMs: null,
  });
  assert.match(msg, /Récolte 14\/05/);
  assert.match(msg, /Total :/);
  assert.match(msg, /\+/); // positive delta marker
  assert.match(msg, /Maravilla/);
  assert.match(msg, /Sensation/);
  assert.match(msg, /Cascade/);
});

test('formatMessage: caps at 6 varieties', () => {
  const byVariete = Array.from({ length: 10 }, (_, i) => ({ variete: 'V' + i, totalKg: 100 - i }));
  const msg = N.formatMessage({ date: '2026-05-14', totalKg: 1000, deltaKg: 100, byVariete });
  assert.match(msg, /• V0 /);
  assert.match(msg, /• V5 /);
  assert.equal(/• V6 /.test(msg), false);
});

test('todayCasablanca: returns YYYY-MM-DD string', () => {
  const d = N.todayCasablanca(new Date('2026-05-14T23:30:00Z'));
  // Casablanca = UTC+1 → 2026-05-15
  assert.equal(d, '2026-05-15');
});

test('todayCasablanca: morning Casablanca', () => {
  const d = N.todayCasablanca(new Date('2026-05-14T08:00:00Z'));
  assert.equal(d, '2026-05-14');
});

// ---------------------------------------------------------------------------
// handleProdRecolteWrite — integration of the decision logic with mock deps.
// ---------------------------------------------------------------------------

function mockChange({ before = null, after = null, dateParam = N.todayCasablanca() } = {}) {
  return {
    change: {
      before: { exists: !!before, data: () => before || {} },
      after: { exists: !!after, data: () => after || {} },
    },
    context: { params: { date: dateParam } },
  };
}

function mockDeps({ stateDoc = null, sendResults = [{ success: true }] } = {}) {
  const writes = [];
  const sends = [];
  const db = {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: !!stateDoc, data: () => stateDoc }),
        set: async (data) => { writes.push(data); },
      }),
    }),
  };
  let sendIdx = 0;
  const whatsapp = {
    resolveRecipientsForProfile: async () => [{ phone: '+212600000001', profileId: 'dg', displayName: 'DG' }],
    toSingleLine: (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim(),
    sendTemplateMessage: async (to, template, params) => {
      sends.push({ to, template, text: (params && params[0]) || '' });
      return sendResults[Math.min(sendIdx++, sendResults.length - 1)];
    },
  };
  const admin = { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } };
  return { deps: { db, whatsapp, admin }, writes, sends };
}

test('handleProdRecolteWrite: skips meta docs', async () => {
  const { deps } = mockDeps();
  const { change, context } = mockChange({ after: { totalKg: 500 }, dateParam: '_status' });
  const r = await N.handleProdRecolteWrite(deps, change, context);
  assert.equal(r.skipped, 'meta-doc');
});

test('handleProdRecolteWrite: skips dates other than today', async () => {
  const { deps } = mockDeps();
  const { change, context } = mockChange({ after: { totalKg: 500 }, dateParam: '2020-01-01' });
  const r = await N.handleProdRecolteWrite(deps, change, context);
  assert.equal(r.skipped, 'not-today');
});

test('handleProdRecolteWrite: sends WhatsApp when crossing threshold', async () => {
  const today = N.todayCasablanca();
  const { deps, writes, sends } = mockDeps({ stateDoc: null });
  const { change, context } = mockChange({
    before: { totalKg: 0 },
    after: { totalKg: 250, rows: [{ variete: 'Maravilla', totalKg: 250 }] },
    dateParam: today,
  });
  const r = await N.handleProdRecolteWrite(deps, change, context);
  assert.equal(r.sent, 1);
  assert.equal(r.deltaKg, 250);
  assert.equal(sends.length, 1);
  assert.match(sends[0].text, /Maravilla/);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].lastNotifiedTotalKg, 250);
});

test('handleProdRecolteWrite: skips when delta below threshold', async () => {
  const today = N.todayCasablanca();
  const { deps, sends } = mockDeps({ stateDoc: { date: today, lastNotifiedTotalKg: 500 } });
  const { change, context } = mockChange({
    before: { totalKg: 500 },
    after: { totalKg: 560, rows: [] },
    dateParam: today,
  });
  const r = await N.handleProdRecolteWrite(deps, change, context);
  assert.equal(r.skipped, 'below-threshold');
  assert.equal(sends.length, 0);
});

test('handleProdRecolteWrite: does not persist state if all sends fail', async () => {
  const today = N.todayCasablanca();
  const { deps, writes } = mockDeps({ sendResults: [{ success: false }] });
  const { change, context } = mockChange({
    before: { totalKg: 0 },
    after: { totalKg: 200, rows: [{ variete: 'X', totalKg: 200 }] },
    dateParam: today,
  });
  const r = await N.handleProdRecolteWrite(deps, change, context);
  assert.equal(r.sent, 0);
  assert.equal(writes.length, 0);
});

test('handleProdRecolteWrite: skips when no DG recipients', async () => {
  const today = N.todayCasablanca();
  const deps = {
    db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => null }), set: async () => {} }) }) },
    whatsapp: { resolveRecipientsForProfile: async () => [], toSingleLine: (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim(), sendTemplateMessage: async () => ({ success: true }) },
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'TS' } } },
  };
  const { change, context } = mockChange({
    before: { totalKg: 0 },
    after: { totalKg: 500, rows: [] },
    dateParam: today,
  });
  const r = await N.handleProdRecolteWrite(deps, change, context);
  assert.equal(r.skipped, 'no-dg-recipients');
});
