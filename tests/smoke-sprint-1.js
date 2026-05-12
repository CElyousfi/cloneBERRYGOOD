#!/usr/bin/env node
/**
 * smoke-sprint-1.js
 *
 * Sprint 1 smoke test for the "Transactions" screen ergonomics features.
 *
 * What this covers:
 *   - Serves public/ via a simple HTTP server on a free port
 *   - Loads the SPA in Playwright (Chromium)
 *   - Asserts no critical JS error during the initial load
 *   - Asserts that window.CaisseUtils is exposed with the expected API surface
 *   - Asserts that the search/filter helpers behave correctly in the browser
 *   - Takes a screenshot of whatever state the SPA reaches (login screen if
 *     no auth is performed)
 *
 * What this does NOT cover (documented limitation):
 *   - Navigating into the authenticated "Transactions" view (requires real
 *     Firebase credentials; would expose secrets in CI logs / screenshots).
 *   - End-to-end interaction with the new chips/footer/search inside the
 *     Caisse module. Those need a logged-in session and will be tested
 *     manually before merge, or in a future CI setup with test creds.
 *
 * Run: node tests/smoke-sprint-1.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const SCREENSHOT = path.resolve(__dirname, '..', 'docs', 'sprint-1-smoke.png');

function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.ico':  'image/x-icon',
  })[ext] || 'application/octet-stream';
}

function startServer(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let url = req.url.split('?')[0];
      if (url === '/' || url.endsWith('/')) url += 'index.html';
      // Block /api/* (no backend in smoke test) → returns 503 so the SPA can
      // handle the failure gracefully without throwing in the global handler.
      if (url.startsWith('/api/')) {
        res.statusCode = 503;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: false, error: 'backend-not-available-in-smoke-test' }));
        return;
      }
      const file = path.join(PUBLIC_DIR, url);
      if (!file.startsWith(PUBLIC_DIR)) { res.statusCode = 400; res.end('bad path'); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.statusCode = 404; res.end('not found'); return; }
        res.setHeader('content-type', mimeFor(file));
        res.setHeader('cache-control', 'no-store');
        res.end(data);
      });
    });
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

(async () => {
  const failures = [];
  function assert(cond, msg) { if (!cond) failures.push(msg); else console.log('  ✓', msg); }

  console.log('[smoke] Starting local HTTP server for public/…');
  const { server, url } = await startServer();
  console.log('[smoke] Serving at', url);

  console.log('[smoke] Launching Chromium…');
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  console.log('[smoke] Navigating…');
  await page.goto(url, { waitUntil: 'load' });
  // Give defer scripts time to execute (caisseUtils.js + app.js)
  await page.waitForTimeout(2000);

  // Assertion 1 — no page-level JS errors during load
  // (Note: filter Firebase auth errors which are expected without creds.)
  const criticalConsoleErrors = consoleErrors.filter((e) => {
    return !/Firebase|firebaseAuth|auth\/|api\/auth|backend-not-available|service worker|fetch failed|503|Not Found|404/i.test(e);
  });
  const criticalPageErrors = pageErrors.filter((e) => {
    return !/Firebase|firebaseAuth|auth\/|api\/auth|backend-not-available|service worker|fetch failed|503|Not Found/i.test(e);
  });
  assert(criticalPageErrors.length === 0, `0 page errors (got: ${criticalPageErrors.length})`);
  if (criticalPageErrors.length > 0) criticalPageErrors.forEach((e) => console.log('    pageerror:', e));
  assert(criticalConsoleErrors.length === 0, `0 critical console errors (got: ${criticalConsoleErrors.length})`);
  if (criticalConsoleErrors.length > 0) criticalConsoleErrors.forEach((e) => console.log('    console:', e));

  // Assertion 2 — window.CaisseUtils exposed with expected shape
  const apiShape = await page.evaluate(() => {
    if (!window.CaisseUtils) return { present: false };
    const u = window.CaisseUtils;
    return {
      present: true,
      hasDetect:     typeof u.detectCaisseAnomalies === 'function',
      hasTotals:     typeof u.computeTotals === 'function',
      hasPeriod:     typeof u.quickPeriodToDateRange === 'function',
      hasSearch:     typeof u.searchTransactions === 'function',
      hasFilterType: typeof u.filterByQuickType === 'function',
      anomalyCodes:  u.ANOMALY_CODES,
      periods:       u.QUICK_PERIODS,
      types:         u.QUICK_TYPES,
    };
  });
  assert(apiShape.present, 'window.CaisseUtils exposed');
  assert(apiShape.hasDetect && apiShape.hasTotals && apiShape.hasPeriod && apiShape.hasSearch && apiShape.hasFilterType,
    'All 5 public functions present (detect, totals, period, search, filterType)');
  assert(apiShape.anomalyCodes && apiShape.anomalyCodes.DATE_ABERRANTE === 'DATE_ABERRANTE',
    'ANOMALY_CODES constants exposed');
  assert(Array.isArray(apiShape.periods) && apiShape.periods.length === 5, 'QUICK_PERIODS = 5 entries');
  assert(Array.isArray(apiShape.types) && apiShape.types.length === 4, 'QUICK_TYPES = 4 entries');

  // Assertion 3 — sanity: detectCaisseAnomalies works in browser
  const browserDetect = await page.evaluate(() => {
    return window.CaisseUtils.detectCaisseAnomalies(
      { date: '2055-08-14', montant: 99999, description: 'X', code_analytique: 'BGF - BGF' },
      new Date('2026-05-15T12:00:00')
    );
  });
  assert(Array.isArray(browserDetect) && browserDetect.length === 4,
    'detectCaisseAnomalies returns 4 anomalies for a fully bad tx in browser');

  // Assertion 4 — searchTransactions handles French comma decimal in browser
  const browserSearch = await page.evaluate(() => {
    return window.CaisseUtils.searchTransactions(
      [{ description: 'Achat', montant: -500 }, { description: 'Autre', montant: 100 }],
      '500,00'
    ).length;
  });
  assert(browserSearch === 1, 'searchTransactions matches "500,00" against montant=-500 in browser');

  // Screenshot for the PR
  fs.mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  console.log('[smoke] Screenshot →', SCREENSHOT);

  await browser.close();
  server.close();

  console.log('\n[smoke] Summary:');
  if (failures.length === 0) {
    console.log('  ALL CHECKS PASSED ✓');
    process.exit(0);
  } else {
    console.log('  FAILURES:');
    failures.forEach((f) => console.log('   ✗', f));
    process.exit(1);
  }
})().catch((err) => {
  console.error('[smoke] Fatal:', err);
  process.exit(2);
});
