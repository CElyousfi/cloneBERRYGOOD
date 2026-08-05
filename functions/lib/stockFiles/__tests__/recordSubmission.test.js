'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isValidFarm,
  todayInCasablanca,
  addDaysStr,
  emptySubmissionDoc,
  recordSubmission,
} = require('../recordSubmission');

/**
 * Minimal fake Firestore: one doc collection keyed by id, tracks a merge-set
 * history so tests can assert on the exact payload written.
 */
function makeFakeDb(initialDocs) {
  const store = new Map(Object.entries(initialDocs || {}));
  const writes = [];
  return {
    _store: store,
    _writes: writes,
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              const data = store.get(id);
              return {
                exists: !!data,
                data: () => data,
              };
            },
            async set(payload, opts) {
              writes.push({ id, payload, opts });
              const merge = opts && opts.merge;
              const current = store.get(id) || {};
              if (!merge) {
                store.set(id, payload);
                return;
              }
              // Shallow+1-level deep merge (mirrors Firestore merge semantics
              // for the nested farm objects used by recordSubmission).
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

test('isValidFarm: accepts only berry_good|bahia', () => {
  assert.equal(isValidFarm('berry_good'), true);
  assert.equal(isValidFarm('bahia'), true);
  assert.equal(isValidFarm('F1'), false);
  assert.equal(isValidFarm(''), false);
  assert.equal(isValidFarm(undefined), false);
});

test('todayInCasablanca: returns YYYY-MM-DD in Africa/Casablanca', () => {
  // 2026-05-16 23:30 UTC = 2026-05-17 00:30 in Africa/Casablanca (UTC+1)
  const d = todayInCasablanca(new Date('2026-05-16T23:30:00Z'));
  assert.equal(d, '2026-05-17');
});

test('addDaysStr: shifts a YYYY-MM-DD date by N days (negative allowed)', () => {
  assert.equal(addDaysStr('2026-08-05', -1), '2026-08-04');
  assert.equal(addDaysStr('2026-08-05', 1), '2026-08-06');
  assert.equal(addDaysStr('2026-01-01', -1), '2025-12-31');
});

test('emptySubmissionDoc: both farms unsubmitted, reminders untriggered', () => {
  const doc = emptySubmissionDoc('2026-08-05');
  assert.equal(doc.berry_good.submitted, false);
  assert.equal(doc.bahia.submitted, false);
  assert.deepEqual(doc.reminders_sent, { '16h': false, '17h': false, '18h': false });
  assert.equal(doc.missing_alert_sent_at, null);
});

test('recordSubmission: rejects invalid date', async () => {
  const db = makeFakeDb();
  const out = await recordSubmission({ db }, { date: '05-08-2026', farm: 'berry_good', storagePath: 'x' });
  assert.equal(out.success, false);
  assert.match(out.error, /date/);
});

test('recordSubmission: rejects invalid farm', async () => {
  const db = makeFakeDb();
  const out = await recordSubmission({ db }, { date: '2026-08-05', farm: 'F1', storagePath: 'x' });
  assert.equal(out.success, false);
  assert.match(out.error, /farm/);
});

test('recordSubmission: rejects missing storagePath', async () => {
  const db = makeFakeDb();
  const out = await recordSubmission({ db }, { date: '2026-08-05', farm: 'berry_good', storagePath: '' });
  assert.equal(out.success, false);
  assert.match(out.error, /storagePath/);
});

test('recordSubmission: first write of the day sets created_at + the farm state', async () => {
  const db = makeFakeDb();
  const out = await recordSubmission(
    { db, serverTimestamp: () => 'TS1' },
    {
      date: '2026-08-05',
      farm: 'berry_good',
      storagePath: 'stock_files/2026-08-05/berry_good_1.pdf',
      filename: 'stock_bg.pdf',
      submittedBy: { uid: 'u1', name: 'Mag', email: 'mag@x.ma', source: 'app' },
    }
  );
  assert.equal(out.success, true);
  assert.equal(out.submitted_at, 'TS1');

  const stored = db._store.get('2026-08-05');
  assert.equal(stored.created_at, 'TS1');
  assert.equal(stored.updated_at, 'TS1');
  assert.equal(stored.berry_good.submitted, true);
  assert.equal(stored.berry_good.file_path, 'stock_files/2026-08-05/berry_good_1.pdf');
  assert.equal(stored.berry_good.file_name, 'stock_bg.pdf');
  assert.deepEqual(stored.berry_good.submitted_by, { uid: 'u1', name: 'Mag', email: 'mag@x.ma', source: 'app' });
  assert.equal(stored.bahia, undefined); // not touched
});

test('recordSubmission: second farm submission the same day does NOT overwrite the first farm, no created_at rewrite', async () => {
  const db = makeFakeDb({
    '2026-08-05': {
      created_at: 'TS0',
      updated_at: 'TS0',
      berry_good: { submitted: true, submitted_at: 'TS0', submitted_by: { uid: 'u1' }, file_path: 'p1', file_name: 'f1' },
    },
  });
  const out = await recordSubmission(
    { db, serverTimestamp: () => 'TS2' },
    { date: '2026-08-05', farm: 'bahia', storagePath: 'stock_files/2026-08-05/bahia_1.pdf', filename: 'bahia.pdf', submittedBy: { uid: 'u2', source: 'whatsapp' } }
  );
  assert.equal(out.success, true);

  const stored = db._store.get('2026-08-05');
  assert.equal(stored.created_at, 'TS0'); // untouched — doc already existed
  assert.equal(stored.updated_at, 'TS2');
  assert.equal(stored.berry_good.submitted, true); // untouched by the bahia write
  assert.equal(stored.berry_good.file_path, 'p1');
  assert.equal(stored.bahia.submitted, true);
  assert.equal(stored.bahia.submitted_by.source, 'whatsapp');
});

test('recordSubmission: re-submission the same day overwrites (no multi-version history, spec §7)', async () => {
  const db = makeFakeDb({
    '2026-08-05': {
      created_at: 'TS0',
      berry_good: { submitted: true, submitted_at: 'TS0', submitted_by: { uid: 'u1' }, file_path: 'old.pdf', file_name: 'old.pdf' },
    },
  });
  await recordSubmission(
    { db, serverTimestamp: () => 'TS3' },
    { date: '2026-08-05', farm: 'berry_good', storagePath: 'stock_files/2026-08-05/berry_good_2.pdf', filename: 'new.pdf', submittedBy: { uid: 'u3' } }
  );
  const stored = db._store.get('2026-08-05');
  assert.equal(stored.berry_good.file_path, 'stock_files/2026-08-05/berry_good_2.pdf');
  assert.equal(stored.berry_good.file_name, 'new.pdf');
  assert.equal(stored.berry_good.submitted_by.uid, 'u3');
});

test('recordSubmission: defaults submitted_by.source to "app" when not "whatsapp"', async () => {
  const db = makeFakeDb();
  await recordSubmission(
    { db, serverTimestamp: () => 'TS4' },
    { date: '2026-08-05', farm: 'bahia', storagePath: 'p', submittedBy: {} }
  );
  const stored = db._store.get('2026-08-05');
  assert.equal(stored.bahia.submitted_by.source, 'app');
});
