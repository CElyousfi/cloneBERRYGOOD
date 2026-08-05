#!/usr/bin/env node
/**
 * smoke-stock-files.js
 *
 * Smoke-load réel (Chromium + WebKit) pour feat/collecte-stock-magasinier
 * (docs/spec-collecte-stock-magasinier.md).
 *
 * Couvre :
 *   - Sert public/ via un serveur HTTP local (bundle app.js identique à celui
 *     déployé sur le preview qa-stock-files).
 *   - Charge la SPA, vérifie 0 erreur page critique (pas de React #200, pas de
 *     collision UMD globale — le nouveau composant MagStockFilesTab.jsx ne
 *     casse pas le boot).
 *   - Vérifie window.MagStockFilesTab exposé (seul global posé, IIFE).
 *
 * Limitation documentée (même limite que tests/smoke-magasins-f3f4.js et
 * tests/smoke-sprint-1.js) : atteindre l'onglet "Soumission Fichier Stock"
 * réellement authentifié (profil magasinier) exige de vraies creds Firebase,
 * qu'on n'expose pas dans un smoke test. Ce test prouve le boot sain et le
 * wiring global ; la QA visuelle authentifiée (dropzones, tableau, upload
 * réel) se fait manuellement sur le preview par Omar.
 *
 * Run: node tests/smoke-stock-files.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ico': 'image/x-icon',
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

async function runOne(engineName, launcher, url) {
  const failures = [];
  const assert = (cond, msg) => { if (!cond) failures.push(`[${engineName}] ${msg}`); else console.log(`  ✓ [${engineName}] ${msg}`); };

  const browser = await launcher.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const criticalPageErrors = pageErrors.filter((e) =>
    !/Firebase|firebaseAuth|auth\/|api\/auth|backend-not-available|service worker|fetch failed|503|Not Found/i.test(e));
  assert(criticalPageErrors.length === 0, `0 page error critique (got ${criticalPageErrors.length})`);
  criticalPageErrors.forEach((e) => console.log('    pageerror:', e));

  const react200 = pageErrors.concat(consoleErrors).filter((e) => /Minified React error #200|Invariant Violation: #200/.test(e));
  assert(react200.length === 0, '0 React #200 (Maximum update / boot crash)');

  const exposed = await page.evaluate(() => ({
    comp: typeof window.MagStockFilesTab === 'function',
  }));
  assert(exposed.comp, 'window.MagStockFilesTab exposé (fonction, seul global posé)');

  await browser.close();
  return failures;
}

(async () => {
  console.log('[smoke-stock-files] Démarrage serveur HTTP local public/…');
  const { server, url } = await startServer();
  console.log('[smoke-stock-files] Servi sur', url);

  const { chromium, webkit } = require('playwright');
  let allFailures = [];
  try {
    allFailures = allFailures.concat(await runOne('chromium', chromium, url));
    allFailures = allFailures.concat(await runOne('webkit', webkit, url));
  } finally {
    server.close();
  }

  if (allFailures.length) {
    console.error('\n[smoke-stock-files] ÉCHEC :');
    allFailures.forEach((f) => console.error('  ✗', f));
    process.exit(1);
  }
  console.log('\n[smoke-stock-files] OK — boot sain, window.MagStockFilesTab exposé sur Chromium + WebKit.');
})();
