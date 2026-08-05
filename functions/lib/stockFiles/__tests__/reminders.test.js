'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeMissingFarms,
  buildReminderText,
  buildEscalationText,
  createStockFileReminders,
} = require('../reminders');
const { COLLECTION, emptySubmissionDoc } = require('../recordSubmission');

// ── Pure helpers ────────────────────────────────────────────────────────

test('computeMissingFarms: both missing on an empty doc', () => {
  assert.deepEqual(computeMissingFarms(emptySubmissionDoc('2026-08-05')), ['berry_good', 'bahia']);
});

test('computeMissingFarms: only bahia missing', () => {
  const doc = { berry_good: { submitted: true }, bahia: { submitted: false } };
  assert.deepEqual(computeMissingFarms(doc), ['bahia']);
});

test('computeMissingFarms: none missing', () => {
  const doc = { berry_good: { submitted: true }, bahia: { submitted: true } };
  assert.deepEqual(computeMissingFarms(doc), []);
});

test('computeMissingFarms: tolerates null/undefined doc', () => {
  assert.deepEqual(computeMissingFarms(null), ['berry_good', 'bahia']);
  assert.deepEqual(computeMissingFarms(undefined), ['berry_good', 'bahia']);
});

test('buildReminderText: includes slot and farm label', () => {
  const t = buildReminderText('16h', 'Berry Good');
  assert.match(t, /16h/);
  assert.match(t, /Berry Good/);
});

test('buildEscalationText: joins multiple missing farms with "et"', () => {
  const t = buildEscalationText(['Berry Good', 'Bahia']);
  assert.match(t, /Berry Good et Bahia/);
});

// ── Orchestration (sendReminder) via stub deps ──────────────────────────

function makeFakeDb(initialDocs) {
  const store = new Map(Object.entries(initialDocs || {}));
  return {
    _store: store,
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              const data = store.get(id);
              return { exists: !!data, data: () => data };
            },
            async set(payload, opts) {
              const merge = opts && opts.merge;
              const current = store.get(id) || {};
              if (!merge) { store.set(id, payload); return; }
              const next = { ...current };
              for (const [k, v] of Object.entries(payload)) {
                if (v && typeof v === 'object' && !Array.isArray(v) && current[k] && typeof current[k] === 'object') {
                  next[k] = { ...current[k], ...v };
                } else {
                  next[k] = v;
                }
              }
              store.set(id, next);
            },
          };
        },
      };
    },
  };
}

function makeFakeWhatsapp(recipientsByProfile) {
  const sent = [];
  return {
    sent,
    resolveRecipientsForProfile: async (profileId) => (recipientsByProfile[profileId] || []),
    sendTemplateMessage: async (phone, templateName, bodyParams) => {
      sent.push({ phone, templateName, bodyParams });
      return { success: true };
    },
    toSingleLine: (s) => String(s).replace(/\s+/g, ' ').trim(),
  };
}

test('sendReminder: sends one template per missing farm to magasinier recipients, marks reminders_sent', async () => {
  const db = makeFakeDb();
  const whatsapp = makeFakeWhatsapp({ magasinier: [{ phone: '+212600000001' }] });
  const reminders = createStockFileReminders({ db, whatsapp, serverTimestamp: () => 'TS', now: () => new Date('2026-08-05T15:00:00Z') });

  const out = await reminders.sendReminder('16h');

  assert.equal(out.success, true);
  assert.deepEqual(out.missing.sort(), ['bahia', 'berry_good']);
  assert.equal(out.escalated, false);
  assert.equal(whatsapp.sent.length, 2); // 1 par ferme manquante
  assert.ok(whatsapp.sent.every((m) => m.templateName === 'general_alert'));

  const stored = db._store.get(out.date);
  assert.equal(stored.reminders_sent['16h'], true);
  assert.equal(stored.missing_alert_sent_at, undefined);
});

test('sendReminder: skips a farm already submitted', async () => {
  const date = '2026-08-05';
  const db = makeFakeDb({ [date]: { berry_good: { submitted: true }, bahia: { submitted: false } } });
  const whatsapp = makeFakeWhatsapp({ magasinier: [{ phone: '+212600000001' }] });
  const reminders = createStockFileReminders({ db, whatsapp, now: () => new Date(date + 'T15:00:00Z') });

  const out = await reminders.sendReminder('17h');
  assert.deepEqual(out.missing, ['bahia']);
  assert.equal(whatsapp.sent.length, 1);
  assert.match(whatsapp.sent[0].bodyParams[0], /Bahia/);
});

test('sendReminder: no-op WhatsApp send when nothing is missing, still marks reminders_sent', async () => {
  const date = '2026-08-05';
  const db = makeFakeDb({ [date]: { berry_good: { submitted: true }, bahia: { submitted: true } } });
  const whatsapp = makeFakeWhatsapp({ magasinier: [{ phone: '+212600000001' }] });
  const reminders = createStockFileReminders({ db, whatsapp, now: () => new Date(date + 'T16:00:00Z') });

  const out = await reminders.sendReminder('16h');
  assert.deepEqual(out.missing, []);
  assert.equal(whatsapp.sent.length, 0);
  assert.equal(db._store.get(date).reminders_sent['16h'], true);
});

test('sendReminder: 18h escalates to dg when a farm is still missing, sets missing_alert_sent_at', async () => {
  const date = '2026-08-05';
  const db = makeFakeDb({ [date]: { berry_good: { submitted: true }, bahia: { submitted: false } } });
  const whatsapp = makeFakeWhatsapp({
    magasinier: [{ phone: '+212600000001' }],
    dg: [{ phone: '+212600000099' }],
  });
  const reminders = createStockFileReminders({ db, whatsapp, serverTimestamp: () => 'TS18', now: () => new Date(date + 'T18:00:00Z') });

  const out = await reminders.sendReminder('18h', { escalateToDg: true });

  assert.equal(out.escalated, true);
  const dgMsgs = whatsapp.sent.filter((m) => m.phone === '+212600000099');
  assert.equal(dgMsgs.length, 1);
  assert.match(dgMsgs[0].bodyParams[0], /Bahia/);

  const stored = db._store.get(date);
  assert.equal(stored.missing_alert_sent_at, 'TS18');
  assert.equal(stored.reminders_sent['18h'], true);
});

test('sendReminder: 18h does NOT escalate when nothing is missing', async () => {
  const date = '2026-08-05';
  const db = makeFakeDb({ [date]: { berry_good: { submitted: true }, bahia: { submitted: true } } });
  const whatsapp = makeFakeWhatsapp({ dg: [{ phone: '+212600000099' }] });
  const reminders = createStockFileReminders({ db, whatsapp, now: () => new Date(date + 'T18:00:00Z') });

  const out = await reminders.sendReminder('18h', { escalateToDg: true });
  assert.equal(out.escalated, false);
  assert.equal(whatsapp.sent.length, 0);
  assert.equal(db._store.get(date).missing_alert_sent_at, undefined);
});

test('sendReminder: logs an explicit error and does not throw when no magasinier recipient is configured', async () => {
  const date = '2026-08-05';
  const db = makeFakeDb();
  const whatsapp = makeFakeWhatsapp({}); // no recipients anywhere
  const reminders = createStockFileReminders({ db, whatsapp, now: () => new Date(date + 'T16:00:00Z') });

  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const out = await reminders.sendReminder('16h');
    assert.equal(out.success, true);
    assert.ok(logs.some((l) => l.includes('Aucun destinataire') && l.includes('magasinier')));
  } finally {
    console.error = originalError;
  }
});

test('sendReminder: catches an internal error, returns success:false, never throws', async () => {
  const whatsapp = makeFakeWhatsapp({});
  const brokenDb = { collection() { return { doc() { return { get: async () => { throw new Error('boom'); } }; } }; } };
  const reminders = createStockFileReminders({ db: brokenDb, whatsapp });

  const out = await reminders.sendReminder('16h');
  assert.equal(out.success, false);
  assert.match(out.error, /boom/);
});

test('createStockFileReminders: throws synchronously if deps are missing', () => {
  assert.throws(() => createStockFileReminders({ whatsapp: {} }), /db requis/);
  assert.throws(() => createStockFileReminders({ db: {} }), /whatsapp requis/);
});
