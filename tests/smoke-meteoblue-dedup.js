#!/usr/bin/env node
/**
 * smoke-meteoblue-dedup.js
 *
 * Smoke test for the meteoblue in-flight dedup fix (fix/meteoblue-inflight-dedup).
 *
 * What this covers:
 *   - Serves public/ over HTTP and boots the SPA in Chromium AND WebKit.
 *   - Asserts a clean boot: no React #200 (Minified React error), no UMD global
 *     collision (top-level redeclare crashes), 0 critical page/console errors.
 *   - Asserts window.InflightDedup.dedupInflight is exposed (helper loaded).
 *   - PROVES the dedup: stubs window.fetch to count calls to my.meteoblue.com,
 *     then fires 2 CONCURRENT dedupInflight calls on the SAME key wrapping a
 *     real fetch → exactly 1 network call instead of 2. Then proves a post-
 *     resolution call re-executes (no value caching in the helper).
 *
 * What this does NOT cover (documented limitation):
 *   - fetchMeteoblueData / fetchSprayData are inner functions of app.jsx (not on
 *     window), so they cannot be called directly from the page. The dedup
 *     mechanism they now use IS the window.InflightDedup.dedupInflight helper,
 *     which is exercised here against a counting fetch stub. The wiring of that
 *     helper into both functions is covered by reading the build + the unit test
 *     suite (tests/unit/inflightDedup.test.js).
 *
 * Run: node tests/smoke-meteoblue-dedup.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

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

async function runOn(browserType, name, url) {
  const failures = [];
  function assert(cond, msg) { if (!cond) { failures.push(`[${name}] ${msg}`); console.log('  ✗', msg); } else console.log('  ✓', msg); }

  console.log(`\n[smoke:${name}] Launching…`);
  const browser = await browserType.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  // Boot must be clean: no React #200, no UMD collision crash.
  const react200 = [...consoleErrors, ...pageErrors].filter((e) => /Minified React error #200|error #200/i.test(e));
  const umdCollision = pageErrors.filter((e) => /has already been declared|Identifier .* has already|redeclar/i.test(e));
  assert(react200.length === 0, `0 React #200 errors (got ${react200.length})`);
  assert(umdCollision.length === 0, `0 UMD global collision crashes (got ${umdCollision.length})`);

  const criticalPageErrors = pageErrors.filter((e) =>
    !/Firebase|firebaseAuth|auth\/|api\/auth|backend-not-available|service worker|fetch failed|503|Not Found|404/i.test(e));
  assert(criticalPageErrors.length === 0, `0 critical page errors (got ${criticalPageErrors.length})`);
  if (criticalPageErrors.length) criticalPageErrors.forEach((e) => console.log('    pageerror:', e));

  // Helper exposed.
  const hasHelper = await page.evaluate(() =>
    !!(window.InflightDedup && typeof window.InflightDedup.dedupInflight === 'function'));
  assert(hasHelper, 'window.InflightDedup.dedupInflight exposed');

  // PROOF: 2 concurrent same-key calls wrapping a real fetch to my.meteoblue.com
  // → exactly 1 network call. Then a 3rd call after resolution re-fetches.
  const proof = await page.evaluate(async () => {
    const dedup = window.InflightDedup.dedupInflight;
    let meteoCalls = 0;
    const realFetch = window.fetch;
    window.fetch = function(u) {
      const s = String(u);
      if (s.indexOf('my.meteoblue.com') !== -1) {
        meteoCalls += 1;
        // Resolve to a fake-but-shaped response without hitting the network.
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data_1h: {} }) });
      }
      return realFetch.apply(window, arguments);
    };
    try {
      const registry = {};
      const key = '35.08_-6.14_49_basic';
      const job = () => window.fetch('https://my.meteoblue.com/packages/basic-day?lat=35.08&lon=-6.14')
        .then((r) => r.json());

      // Two concurrent callers, same key.
      const [a, b] = await Promise.all([dedup(registry, key, job), dedup(registry, key, job)]);
      const concurrentCalls = meteoCalls;

      // After settle the registry must be clear and a fresh call re-fetches.
      await dedup(registry, key, job);
      const afterCalls = meteoCalls;

      return { concurrentCalls, afterCalls, sameResult: a !== null && b !== null };
    } finally {
      window.fetch = realFetch;
    }
  });
  assert(proof.concurrentCalls === 1,
    `2 concurrent same-key calls → 1 meteoblue fetch (got ${proof.concurrentCalls})`);
  assert(proof.afterCalls === 2,
    `post-resolution call re-fetches, no value caching in helper (total ${proof.afterCalls})`);

  await browser.close();
  return failures;
}

(async () => {
  console.log('[smoke] Starting local HTTP server for public/…');
  const { server, url } = await startServer();
  console.log('[smoke] Serving at', url);

  let allFailures = [];
  try {
    allFailures = allFailures.concat(await runOn(chromium, 'chromium', url));
    allFailures = allFailures.concat(await runOn(webkit, 'webkit', url));
  } finally {
    server.close();
  }

  console.log('');
  if (allFailures.length) {
    console.error('[smoke] FAILED:');
    allFailures.forEach((f) => console.error('  -', f));
    process.exit(1);
  }
  console.log('[smoke] PASS — boot clean (no #200 / no UMD collision) + dedup proven on chromium & webkit.');
})();
