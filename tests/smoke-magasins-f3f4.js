#!/usr/bin/env node
/**
 * smoke-magasins-f3f4.js
 *
 * Smoke-load réel (Chromium + WebKit) pour feat/magasins-f3f4-alignement.
 *
 * Couvre :
 *   - Sert public/ via un serveur HTTP local, STUBBE /api/stock?action=get-locations
 *     pour renvoyer 6 magasins (F1..F6) → prouve la dérivation côté hook.
 *   - Charge la SPA, vérifie 0 erreur page critique (pas de React #200, pas de
 *     collision UMD : le nouveau lib useStockLocations.js ne casse pas le boot).
 *   - Vérifie window.useStockLocations + window.StockLocationsLib exposés.
 *   - PREUVE DU WIRING : appelle la dérivation pure du hook contre le payload
 *     stubé (6 magasins) et vérifie que la liste exposée contient F3 ET F4.
 *     C'est exactement la liste consommée par les 6 dropdowns
 *     (réception / sortie / conso / transfert), qui font tous
 *     `MAGASINS.map(m => <option>)`.
 *
 * Limitation documentée : atteindre les tabs Magasinier authentifiés exige de
 * vraies creds Firebase (exposerait des secrets). Le wiring dropdown est donc
 * prouvé au niveau de la dérivation (même source que le .map des <option>),
 * pas par un clic dans l'UF connectée.
 *
 * Run: node tests/smoke-magasins-f3f4.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const STUB_LOCATIONS = {
  magasins: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'],
  stations: ['Station F1', 'Station F2', 'Station F3', 'Station F4', 'Station F5', 'Station F6'],
  parcelles: { F1: ['S1 Maravilla'], F5: ['S8 Corina'] },
};

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
      const query = req.url.split('?')[1] || '';
      if (url === '/' || url.endsWith('/')) url += 'index.html';

      // STUB get-locations → 6 magasins (preuve de dérivation F3/F4).
      if (url === '/api/stock' && /action=get-locations/.test(query)) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ success: true, locations: STUB_LOCATIONS }));
        return;
      }
      // Tout autre /api/* → 503 (pas de backend en smoke).
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

  // 1 — boot sain : pas de React #200, pas de collision UMD.
  const criticalPageErrors = pageErrors.filter((e) =>
    !/Firebase|firebaseAuth|auth\/|api\/auth|backend-not-available|service worker|fetch failed|503|Not Found/i.test(e));
  assert(criticalPageErrors.length === 0, `0 page error critique (got ${criticalPageErrors.length})`);
  criticalPageErrors.forEach((e) => console.log('    pageerror:', e));

  const react200 = pageErrors.concat(consoleErrors).filter((e) => /Minified React error #200|Invariant Violation: #200/.test(e));
  assert(react200.length === 0, '0 React #200 (Maximum update / boot crash)');

  // 2 — hook exposé sans collision globale.
  const exposed = await page.evaluate(() => ({
    hook: typeof window.useStockLocations === 'function',
    lib: !!window.StockLocationsLib && typeof window.StockLocationsLib.deriveStockLocations === 'function',
    fallback: window.StockLocationsLib && window.StockLocationsLib.USL_FALLBACK_MAGASINS,
  }));
  assert(exposed.hook, 'window.useStockLocations exposé (fonction)');
  assert(exposed.lib, 'window.StockLocationsLib.deriveStockLocations exposé');
  assert(Array.isArray(exposed.fallback) && exposed.fallback.join(',') === 'F1,F2,F5,F6',
    'fallback = F1,F2,F5,F6 (1er render sûr)');

  // 3 — PREUVE WIRING : dérivation contre le payload stubé → F3 ET F4 présents.
  // C'est la liste exacte que les 6 dropdowns passent à `.map(m => <option>)`.
  const derived = await page.evaluate(async () => {
    const json = await fetch('/api/stock?action=get-locations').then((r) => r.json());
    const out = window.StockLocationsLib.deriveStockLocations(json.locations, false);
    return out.magasins;
  });
  assert(Array.isArray(derived) && derived.includes('F3'), `dropdowns dérivent F3 (got [${derived}])`);
  assert(Array.isArray(derived) && derived.includes('F4'), `dropdowns dérivent F4 (got [${derived}])`);
  assert(derived.join(',') === 'F1,F2,F3,F4,F5,F6', 'liste complète F1..F6 dérivée du stub');

  await browser.close();
  return failures;
}

(async () => {
  console.log('[smoke-f3f4] Démarrage serveur HTTP local public/ (stub get-locations = 6 magasins)…');
  const { server, url } = await startServer();
  console.log('[smoke-f3f4] Servi sur', url);

  const { chromium, webkit } = require('playwright');
  let allFailures = [];
  try {
    allFailures = allFailures.concat(await runOne('chromium', chromium, url));
    allFailures = allFailures.concat(await runOne('webkit', webkit, url));
  } finally {
    server.close();
  }

  if (allFailures.length) {
    console.error('\n[smoke-f3f4] ÉCHEC :');
    allFailures.forEach((f) => console.error('  ✗', f));
    process.exit(1);
  }
  console.log('\n[smoke-f3f4] OK — boot sain, hook exposé, F3/F4 dérivés sur Chromium + WebKit.');
})();
