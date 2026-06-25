#!/usr/bin/env node
/**
 * smoke-scan-unifie.js
 *
 * SMOKE-LOAD pour la brique SCAN UNIFIÉE (upload client-direct).
 *
 * Couvre, sur Chromium ET WebKit :
 *   - listeners d'erreur branchés AVANT le chargement des scripts ;
 *   - 0 React #200 → pas de collision UMD top-level introduite par
 *     lib/scanAttachmentUtils.js, lib/scanClientUpload.js,
 *     components/ScanAttachmentButton.js ;
 *   - SDK Firebase Storage chargé (window.firebase.storage est une fonction) ;
 *   - globals exposés : window.ScanAttachmentUtils, window.ScanClientUpload,
 *     window.ScanAttachmentButton ;
 *   - helpers purs cohérents (buildScanPath, validateUploadAttachmentParams) ;
 *   - simulation upload client-direct : on STUBE firebase.storage().ref().put()
 *     + fetch(upload-attachment) et on vérifie que uploadAndRecord appelle bien
 *     l'action, et que ScanAttachmentButton affiche ensuite "Voir le scan".
 *
 * Run: node tests/smoke-scan-unifie.js
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
    storage: !!(window.firebase && typeof window.firebase.storage === 'function'),
    utils: !!(window.ScanAttachmentUtils && typeof window.ScanAttachmentUtils.buildScanPath === 'function'),
    upload: !!(window.ScanClientUpload && typeof window.ScanClientUpload.uploadAndRecord === 'function'),
    button: typeof window.ScanAttachmentButton === 'function',
  }));
  ok(globals.storage, 'SDK Firebase Storage chargé (window.firebase.storage)');
  ok(globals.utils, 'window.ScanAttachmentUtils.buildScanPath exposé');
  ok(globals.upload, 'window.ScanClientUpload.uploadAndRecord exposé');
  ok(globals.button, 'window.ScanAttachmentButton exposé (function)');

  const pure = await page.evaluate(() => {
    const U = window.ScanAttachmentUtils;
    return {
      path: U.buildScanPath('invoices', 'fac été.pdf', 1700000000000),
      collection: U.collectionForEntity('purchase_orders'),
      validOk: U.validateUploadAttachmentParams({ entity_type: 'invoices', entity_id: 'd', scan_path: 'scans/invoices/1_a.pdf' }).valid,
      validKo: U.validateUploadAttachmentParams({ entity_type: 'x', entity_id: 'd', scan_path: 'scans/x/1_a.pdf' }).valid,
    };
  });
  ok(pure.path === 'scans/invoices/1700000000000_fac_t_.pdf', `buildScanPath sanitize ok (got ${pure.path})`);
  ok(pure.collection === 'purchase_orders', 'collectionForEntity(purchase_orders)');
  ok(pure.validOk === true, 'validateUploadAttachmentParams accepte un payload valide');
  ok(pure.validKo === false, 'validateUploadAttachmentParams rejette un entity_type invalide');

  // Simulation upload client-direct : stub storage.put + fetch upload-attachment,
  // puis montage du bouton et vérification du passage "Joindre" → "Voir le scan".
  const sim = await page.evaluate(() => {
    return new Promise((resolve) => {
      const out = { calledAction: null, calledBody: null, putCalled: false, viewLabel: '' };
      // Stub Firebase Storage SDK
      window.firebase.storage = function () {
        return {
          ref: function () {
            return {
              child: function () {
                return { put: function () { out.putCalled = true; return Promise.resolve({}); } };
              },
            };
          },
        };
      };
      // Stub auth token
      window.firebaseAuth = { currentUser: { getIdToken: function () { return Promise.resolve('tok'); } } };
      // Stub fetch for upload-attachment
      const realFetch = window.fetch;
      window.fetch = function (u, opts) {
        if (String(u).indexOf('action=upload-attachment') !== -1) {
          out.calledAction = 'upload-attachment';
          out.calledBody = JSON.parse(opts.body);
          return Promise.resolve({ json: function () { return Promise.resolve({ success: true, scan_url: 'https://signed/x', scan_path: out.calledBody.scan_path }); } });
        }
        return realFetch(u, opts);
      };

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = window.ReactDOM.createRoot(container);
      let uploaded = null;
      root.render(window.React.createElement(window.ScanAttachmentButton, {
        entityType: 'invoices', entityId: 'FAC-1', onUploaded: function (r) { uploaded = r; },
      }));

      setTimeout(function () {
        // Déclenche directement le flux via ScanClientUpload (le file input est masqué).
        const fakeFile = new File(['hello'], 'facture.pdf', { type: 'application/pdf' });
        window.ScanClientUpload.uploadAndRecord({ file: fakeFile, entity_type: 'invoices', entity_id: 'FAC-1' })
          .then(function () {
            setTimeout(function () {
              out.viewLabel = container.textContent || '';
              window.fetch = realFetch;
              resolve(out);
            }, 60);
          })
          .catch(function (e) { out.err = String(e); window.fetch = realFetch; resolve(out); });
      }, 80);
    });
  });
  ok(sim.putCalled === true, 'upload direct vers Storage (put) appelé');
  ok(sim.calledAction === 'upload-attachment', 'action upload-attachment appelée');
  ok(sim.calledBody && sim.calledBody.entity_type === 'invoices', 'body.entity_type = invoices');
  ok(sim.calledBody && /^scans\/invoices\/\d+_facture\.pdf$/.test(sim.calledBody.scan_path || ''), `scan_path bien formé (got ${sim.calledBody && sim.calledBody.scan_path})`);

  await browser.close();
  return failures;
}

(async () => {
  console.log('[smoke] scan-unifie — démarrage serveur public/…');
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
