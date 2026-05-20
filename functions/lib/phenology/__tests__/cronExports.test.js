/**
 * P3 mini-tests — vérifient que la configuration cron et le wiring HTTP
 * de T7 sont conformes à la spec Sprint 2.
 *
 * Stratégie : on teste les constantes (CRON_CONFIG, HTTP_CONFIG) qui
 * sont la source de vérité consommée par functions/index.js, et le
 * `buildHttpHandler` qui isole la logique testable du wiring Firebase.
 *
 * Vérification de la connexion réelle dans functions/index.js = revue
 * de diff au CP-4 + smoke test deploy au CP-5.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { CRON_CONFIG, HTTP_CONFIG, buildHttpHandler } = require('../dailyPhenologyJob');

// ─────────────────────────────────────────────────────────────────────
// Test A — pubsub.schedule config
// ─────────────────────────────────────────────────────────────────────

test('P3-A: CRON_CONFIG.schedule = "0 23 * * *" + timeZone Africa/Casablanca + region europe-west1', () => {
  assert.equal(CRON_CONFIG.schedule, '0 23 * * *', 'cron expression matches spec');
  assert.equal(CRON_CONFIG.timeZone, 'Africa/Casablanca', 'timezone matches gddNightlyJob legacy for cohabitation');
  assert.equal(CRON_CONFIG.region, 'europe-west1', 'region matches Firebase Functions deployment');
  assert.equal(CRON_CONFIG.memorySize, '512MB');
  assert.equal(CRON_CONFIG.timeoutSeconds, 540);

  // Frozen (defensive — accidental mutation in production code would silently change cron schedule)
  // Note: assignment to frozen object is silently ignored in non-strict mode (no throw),
  // so we verify the value is unchanged rather than asserting a throw.
  assert.ok(Object.isFrozen(CRON_CONFIG), 'CRON_CONFIG must be Object.freeze()d');
  try { CRON_CONFIG.schedule = '0 0 * * *'; } catch (_) { /* ignore strict-mode throw if any */ }
  assert.equal(CRON_CONFIG.schedule, '0 23 * * *', 'value unchanged after mutation attempt');
});

// ─────────────────────────────────────────────────────────────────────
// Test B — HTTP handler with requireAuth gating
// ─────────────────────────────────────────────────────────────────────

function makeReqRes({ method = 'GET', query = {} } = {}) {
  const res = {
    statusCode: 200,
    sentBody: null,
    sentText: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.sentBody = body; return this; },
    send(text) { this.sentText = text; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
  const req = { method, query };
  return { req, res };
}

test('P3-B: HTTP_CONFIG exposes rewritePath /api/run-daily-phenology-job-now', () => {
  assert.equal(HTTP_CONFIG.rewritePath, '/api/run-daily-phenology-job-now');
  assert.equal(HTTP_CONFIG.region, 'europe-west1');
});

test('P3-B: handler short-circuits when requireAuth returns null (no auth → no runJob)', async () => {
  let runJobCalled = false;
  const handler = buildHttpHandler({
    requireAuth: async (req, res) => { res.status(401).json({ error: 'unauth' }); return null; },
    runJob: async () => { runJobCalled = true; return {}; },
  });
  const { req, res } = makeReqRes();
  await handler(req, res);
  assert.equal(runJobCalled, false, 'runJob must NOT be called when auth fails');
  assert.equal(res.statusCode, 401);
});

test('P3-B: handler calls runJob when auth succeeds, defaults date to today', async () => {
  let calledWith = null;
  const handler = buildHttpHandler({
    requireAuth: async () => ({ uid: 'user1' }),
    runJob: async (date) => { calledWith = date; return { date, processed: 1, failed: 0, plots: [] }; },
    todayISO: () => '2026-05-20',
  });
  const { req, res } = makeReqRes({ query: {} });
  await handler(req, res);
  assert.equal(calledWith, '2026-05-20');
  assert.equal(res.statusCode, 200);
  assert.equal(res.sentBody.success, true);
  assert.equal(res.sentBody.date, '2026-05-20');
  assert.equal(res.sentBody.warning, undefined, 'no warning when date = today');
});

test('P3-B: handler accepts ?date= override and warns when not today (P4 cascade caveat)', async () => {
  const handler = buildHttpHandler({
    requireAuth: async () => ({ uid: 'user1' }),
    runJob: async (date) => ({ date, processed: 1, failed: 0, plots: [] }),
    todayISO: () => '2026-05-20',
  });
  const { req, res } = makeReqRes({ query: { date: '2026-05-15' } });
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.sentBody.date, '2026-05-15');
  assert.ok(res.sentBody.warning && res.sentBody.warning.includes('Replayed 2026-05-15'));
  assert.ok(res.sentBody.warning.includes('cascade=true'));
});

test('P3-B: handler returns 400 on invalid date format', async () => {
  const handler = buildHttpHandler({
    requireAuth: async () => ({ uid: 'user1' }),
    runJob: async () => ({}),
  });
  const { req, res } = makeReqRes({ query: { date: 'not-a-date' } });
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.sentBody.success, false);
});

test('P3-B: handler returns 500 if runJob throws', async () => {
  const handler = buildHttpHandler({
    requireAuth: async () => ({ uid: 'user1' }),
    runJob: async () => { throw new Error('Firestore is down'); },
    todayISO: () => '2026-05-20',
  });
  const { req, res } = makeReqRes();
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.sentBody.success, false);
  assert.ok(/Firestore is down/.test(res.sentBody.error));
});

test('P3-B: handler responds 204 on OPTIONS (CORS preflight)', async () => {
  const handler = buildHttpHandler({
    requireAuth: async () => { throw new Error('auth should NOT be invoked on OPTIONS'); },
    runJob: async () => ({}),
  });
  const { req, res } = makeReqRes({ method: 'OPTIONS' });
  await handler(req, res);
  assert.equal(res.statusCode, 204);
});

test('P3-B: buildHttpHandler input validation', () => {
  assert.throws(() => buildHttpHandler(null), TypeError);
  assert.throws(() => buildHttpHandler({}), TypeError);
  assert.throws(() => buildHttpHandler({ requireAuth: () => {} }), TypeError);
});
