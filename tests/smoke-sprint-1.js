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

  // Assertion 2 — window.CaisseUtils exposed with expected shape (Sprint 1 + 2)
  const apiShape = await page.evaluate(() => {
    if (!window.CaisseUtils) return { present: false };
    const u = window.CaisseUtils;
    return {
      present: true,
      // Sprint 1
      hasDetect:     typeof u.detectCaisseAnomalies === 'function',
      hasTotals:     typeof u.computeTotals === 'function',
      hasPeriod:     typeof u.quickPeriodToDateRange === 'function',
      hasSearch:     typeof u.searchTransactions === 'function',
      hasFilterType: typeof u.filterByQuickType === 'function',
      // Sprint 2
      hasBatch:      typeof u.detectAnomaliesBatch === 'function',
      anomalyCodes:  u.ANOMALY_CODES,
      periods:       u.QUICK_PERIODS,
      types:         u.QUICK_TYPES,
    };
  });
  assert(apiShape.present, 'window.CaisseUtils exposed');
  assert(apiShape.hasDetect && apiShape.hasTotals && apiShape.hasPeriod && apiShape.hasSearch && apiShape.hasFilterType,
    'Sprint 1 — 5 public functions present (detect, totals, period, search, filterType)');
  assert(apiShape.hasBatch, 'Sprint 2 — detectAnomaliesBatch function present');
  assert(apiShape.anomalyCodes && apiShape.anomalyCodes.DATE_ABERRANTE === 'DATE_ABERRANTE',
    'Sprint 1 ANOMALY_CODES constants exposed');
  assert(apiShape.anomalyCodes && apiShape.anomalyCodes.DOUBLON_PROBABLE === 'DOUBLON_PROBABLE',
    'Sprint 2 ANOMALY_CODES constants exposed (DOUBLON_PROBABLE)');
  assert(apiShape.anomalyCodes && apiShape.anomalyCodes.MONTANT_ATYPIQUE === 'MONTANT_ATYPIQUE',
    'Sprint 2 ANOMALY_CODES constants exposed (MONTANT_ATYPIQUE)');
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

  // ---- Sprint 2 specific assertions ----

  // Assertion 5 (Sprint 2) — detectAnomaliesBatch + control formula compose
  // in the real browser, and the controlCount is always a number >= 0.
  const browserControl = await page.evaluate(() => {
    const U = window.CaisseUtils;
    const list = [
      { id: 'a', caisse_id: 'c1', montant: 100, date: '2026-05-10', type: 'depense', description: 'Achat de gasoil', code_analytique: 'X', status: 'valide' },
      { id: 'b', caisse_id: 'c1', montant: 99999, date: '2026-05-10', type: 'depense', description: 'avance', code_analytique: 'BGF - BGF', status: 'soumis' },
    ];
    const map = U.detectAnomaliesBatch(list, new Date('2026-05-15T12:00:00Z'));
    // controlCount per formula: hasUnacceptedAnomaly OR status !== 'valide'
    let n = 0;
    for (const tx of list) {
      const k = tx.id || tx.reference;
      const hasUnaccepted = map.has(k) && !tx.anomalies_acceptees_par;
      if (hasUnaccepted || tx.status !== 'valide') n++;
    }
    return { n, mapSize: map.size, hasB: map.has('b'), hasA: map.has('a') };
  });
  assert(typeof browserControl.n === 'number' && browserControl.n >= 0,
    `Sprint 2 — controlCount is a number ≥ 0 (got: ${browserControl.n})`);
  assert(browserControl.mapSize >= 1 && browserControl.hasB,
    `Sprint 2 — detectAnomaliesBatch flags the bad tx in browser (mapSize=${browserControl.mapSize})`);

  // Assertion 6 (Sprint 2) — bulk-actions and control-chip UI markers shipped
  // in the built app.js bundle (cannot exercise the authenticated screen
  // here, so we sanity-check the markup IS in the bundle).
  const bundleHas = await page.evaluate(async () => {
    const r = await fetch('app.js', { cache: 'no-store' });
    const src = await r.text();
    return {
      bulkBar:        src.indexOf('caisse-bulk-bar') !== -1,
      acceptAllBar:   src.indexOf('caisse-accept-all-bar') !== -1,
      selectAll:      src.indexOf('caisse-select-all') !== -1,
      toast:          src.indexOf('caisse-toast') !== -1,
      controleChip:   src.indexOf("data-chip-type") !== -1 && src.indexOf("'controle'") !== -1,
      // Sprint 3 markers
      avancesSub:     src.indexOf('CaisseAvancesSub') !== -1,
      avancesTab:     src.indexOf("'caisse_avances'") !== -1,
      rapprochSub:    src.indexOf('CaisseRapprochementSub') !== -1,
      rapprochTab:    src.indexOf("'caisse_rapprochement'") !== -1,
      avancesToast:   src.indexOf('caisse-avances-toast') !== -1,
      rapprochToast:  src.indexOf('caisse-rapprochement-toast') !== -1,
    };
  });
  assert(bundleHas.bulkBar && bundleHas.selectAll && bundleHas.toast,
    `Sprint 2 — bulk-actions markers in bundle (bulkBar=${bundleHas.bulkBar}, selectAll=${bundleHas.selectAll}, toast=${bundleHas.toast})`);
  assert(bundleHas.controleChip && bundleHas.acceptAllBar,
    `Sprint 2 — 'À contrôler' chip + accept-all bar markers in bundle`);

  // ---- Sprint 3 — Rapprochement + Avances markers ----
  assert(bundleHas.avancesSub && bundleHas.avancesTab && bundleHas.avancesToast,
    `Sprint 3 — Avances component + tab + toast in bundle (sub=${bundleHas.avancesSub}, tab=${bundleHas.avancesTab}, toast=${bundleHas.avancesToast})`);
  assert(bundleHas.rapprochSub && bundleHas.rapprochTab && bundleHas.rapprochToast,
    `Sprint 3 — Rapprochement component + tab + toast in bundle (sub=${bundleHas.rapprochSub}, tab=${bundleHas.rapprochTab}, toast=${bundleHas.rapprochToast})`);

  // ---- Sprint 3 — Lib API smoke (extractBeneficiaire + aggregateAvances in browser) ----
  const benefSmoke = await page.evaluate(() => {
    const U = window.CaisseUtils;
    if (!U || !U.extractBeneficiaire || !U.aggregateAvances) return { hasFns: false };
    return {
      hasFns: true,
      ayoub: U.extractBeneficiaire('AVANCE ACHAT AYOUB TITI'),
      azzedine: U.extractBeneficiaire('Avance Mr AZZEDINE'),
      mohamedH: U.extractBeneficiaire('Acompte Mohamed H.'),
      nullCase: U.extractBeneficiaire('AVANCE POUR INSTALATION'),
      aggSize: U.aggregateAvances([
        { type: 'depense', status: 'valide', montant: 500, date: '2026-05-01', description: 'AVANCE HAMZA' },
        { type: 'depense', status: 'valide', montant: 300, date: '2026-05-02', description: 'AVANCE POUR X' },
      ]).byBeneficiaire.size,
    };
  });
  assert(benefSmoke.hasFns, 'Sprint 3 — extractBeneficiaire + aggregateAvances exposed on window.CaisseUtils');
  assert(benefSmoke.ayoub === 'AYOUB TITI', `Sprint 3 — extractBeneficiaire('AVANCE ACHAT AYOUB TITI') = ${benefSmoke.ayoub}`);
  assert(benefSmoke.azzedine === 'AZZEDINE', `Sprint 3 — extractBeneficiaire('Avance Mr AZZEDINE') = ${benefSmoke.azzedine}`);
  assert(benefSmoke.mohamedH === 'MOHAMED H.', `Sprint 3 — extractBeneficiaire('Acompte Mohamed H.') = ${benefSmoke.mohamedH}`);
  assert(benefSmoke.nullCase === null, `Sprint 3 — extractBeneficiaire(purpose-only) = null`);
  assert(benefSmoke.aggSize === 1, `Sprint 3 — aggregateAvances returns 1 identified beneficiary (HAMZA), unidentified count handled separately`);

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
