#!/usr/bin/env node
/**
 * smoke-factures-campagne.js
 *
 * SMOKE-LOAD pour le filtre CAMPAGNE sur l'écran Factures (Achats + Finance).
 * READ-ONLY.
 *
 * Couvre, sur Chromium ET WebKit :
 *   - listeners d'erreur branchés AVANT le chargement des scripts de page ;
 *   - 0 React #200 (preuve qu'aucune collision UMD top-level ne casse le boot) ;
 *   - window.FactureExportUtils.listAvailableCampaigns + isWithinPeriod exposés ;
 *   - dérivation des campagnes disponibles à partir d'un jeu de dates réelles ;
 *   - filtrage par campagne (la sélection d'une campagne réduit bien la liste,
 *     bornes juillet→juin inclusives), en réutilisant le helper pur exposé.
 *
 * Run: node tests/smoke-factures-campagne.js
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

// Jeu de dates couvrant 3 campagnes : 24-25, 25-26, 26-27.
const DATES = [
  '15/06/2025', // campagne 2024-2025
  '15/08/2025', // campagne 2025-2026
  '2025-12-01', // campagne 2025-2026
  '30/06/2026', // campagne 2025-2026 (borne inclusive juin)
  '01/07/2026', // campagne 2026-2027 (borne inclusive juillet)
  '',           // illisible → ignorée
];

async function runOnBrowser(launcher, name, url) {
  const failures = [];
  const ok = (cond, msg) => { if (!cond) { failures.push(`[${name}] ${msg}`); console.log(`  ✗ [${name}] ${msg}`); } else console.log(`  ✓ [${name}] ${msg}`); };

  const browser = await launcher.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const react200 = [...consoleErrors, ...pageErrors].filter((e) => /Minified React error #200|error #200/i.test(e));
  ok(react200.length === 0, `0 React #200 (got: ${react200.length})`);

  const criticalPageErrors = pageErrors.filter((e) => !/Firebase|firebaseAuth|auth\/|api\/auth|backend-not-available|service worker|fetch failed|503|Not Found/i.test(e));
  ok(criticalPageErrors.length === 0, `0 critical page errors (got: ${criticalPageErrors.length})`);
  if (criticalPageErrors.length) criticalPageErrors.forEach((e) => console.log('      pageerror:', e));

  const globals = await page.evaluate(() => ({
    feu: !!(window.FactureExportUtils && typeof window.FactureExportUtils.listAvailableCampaigns === 'function'),
    iwp: !!(window.FactureExportUtils && typeof window.FactureExportUtils.isWithinPeriod === 'function'),
  }));
  ok(globals.feu, 'window.FactureExportUtils.listAvailableCampaigns exposé');
  ok(globals.iwp, 'window.FactureExportUtils.isWithinPeriod exposé');

  // Dérivation + filtrage via le helper pur exposé, exactement comme le fait l'UI.
  const result = await page.evaluate((dates) => {
    const FE = window.FactureExportUtils;
    const camps = FE.listAvailableCampaigns(dates);
    const count2526 = dates.filter((d) => {
      const c = camps.find((c) => c.year === 2025);
      return c && FE.isWithinPeriod(d, c.bounds.start, c.bounds.end);
    }).length;
    return { years: camps.map((c) => c.year), labels: camps.map((c) => c.label), count2526, total: dates.filter(Boolean).length };
  }, DATES);

  ok(JSON.stringify(result.years) === JSON.stringify([2026, 2025, 2024]), `campagnes dérivées triées desc [2026,2025,2024] (got: ${JSON.stringify(result.years)})`);
  ok(result.labels[1] === 'Campagne 2025-2026', `libellé campagne 25-26 (got: ${result.labels[1]})`);
  // 3 dates dans 25-26 (15/08/2025, 2025-12-01, 30/06/2026). La sélection réduit la liste.
  ok(result.count2526 === 3, `filtre Campagne 2025-2026 → 3 dates (got: ${result.count2526})`);
  ok(result.count2526 < result.total, `le filtre réduit bien la liste (${result.count2526} < ${result.total})`);

  await browser.close();
  return failures;
}

(async () => {
  console.log('[smoke] Factures filtre campagne — démarrage serveur public/…');
  const { server, url } = await startServer();
  console.log('[smoke] Servi sur', url);

  let allFailures = [];
  for (const [launcher, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
    console.log(`\n[smoke] === ${name} ===`);
    try {
      const f = await runOnBrowser(launcher, name, url);
      allFailures = allFailures.concat(f);
    } catch (e) {
      console.error(`[smoke] ${name} a planté:`, e);
      allFailures.push(`[${name}] crash: ${String(e)}`);
    }
  }

  server.close();

  if (allFailures.length) {
    console.error(`\n[smoke] ÉCHEC — ${allFailures.length} assertion(s):`);
    allFailures.forEach((f) => console.error('  -', f));
    process.exit(1);
  }
  console.log('\n[smoke] OK — toutes les assertions passent (chromium + webkit).');
})();
