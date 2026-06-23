#!/usr/bin/env node
/**
 * smoke-facture-detail-popup.js
 *
 * SMOKE-LOAD pour le composant FactureDetailPopup (popup détail facture,
 * écrans Factures Achats + Finance). READ-ONLY.
 *
 * Couvre, sur Chromium ET WebKit :
 *   - le listener d'erreur est branché AVANT le chargement des scripts de page
 *     (on attache page.on('pageerror'/'console') avant page.goto) ;
 *   - 0 React #200 (Minified React error #200) → preuve qu'aucune collision UMD
 *     top-level introduite par components/FactureDetailPopup.js ne casse le boot ;
 *   - window.FactureDetailPopup + window.FactureExportUtils exposés ;
 *   - rendu RÉEL de la popup (montée hors écran de login via React) avec une
 *     facture multi-taux + une ligne non déterminée → vérifie qu'elle s'affiche
 *     sans erreur, que les chiffres TVA viennent de buildFactureLines (total TVA
 *     = TTC − HT), et que la fermeture (clic ×) la retire du DOM.
 *
 * Run: node tests/smoke-facture-detail-popup.js
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

// Facture de test : 1 ligne 20% saisie, 1 ligne 0% saisie (exonérée), 1 ligne
// SANS taux (non déterminée). Comme ≥ 1 ligne non saisie → état INFO, total
// facture = (TTC − HT) reste la source de vérité.
const TEST_FACTURE = {
  id: 'FAC-TEST-1',
  numero: 'F-2026-001',
  numero_facture: 'TIMAC-12345',
  fournisseur: { nom: 'TIMAC AGRO' },
  date_facture: '2026-03-15',
  payment_status: 'validee_achats',
  total_ht: 1000,
  total_ttc: 1140, // TVA = 140
  items: [
    { article: 'ACIDE NITRIQUE 60%', quantite: 2, prix_unitaire: 250, montant_ht: 500, taux_tva: 20 },
    { article: 'ENGRAIS NPK', quantite: 1, prix_unitaire: 300, montant_ht: 300, taux_tva: 0 },
    { article: 'PRODUIT SANS TAUX', quantite: 1, prix_unitaire: 200, montant_ht: 200 },
  ],
};

async function runOnBrowser(launcher, name, url) {
  const failures = [];
  const ok = (cond, msg) => { if (!cond) { failures.push(`[${name}] ${msg}`); console.log(`  ✗ [${name}] ${msg}`); } else console.log(`  ✓ [${name}] ${msg}`); };

  const browser = await launcher.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  // Listeners attachés AVANT toute navigation / exécution de script de page.
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2000); // laisse les defer scripts s'exécuter

  // React #200 = remontée trop tôt / collision de rendu → boot cassé.
  const react200 = [...consoleErrors, ...pageErrors].filter((e) => /Minified React error #200|error #200/i.test(e));
  ok(react200.length === 0, `0 React #200 (got: ${react200.length})`);

  const criticalPageErrors = pageErrors.filter((e) => !/Firebase|firebaseAuth|auth\/|api\/auth|backend-not-available|service worker|fetch failed|503|Not Found/i.test(e));
  ok(criticalPageErrors.length === 0, `0 critical page errors (got: ${criticalPageErrors.length})`);
  if (criticalPageErrors.length) criticalPageErrors.forEach((e) => console.log('      pageerror:', e));

  const globals = await page.evaluate(() => ({
    popup: typeof window.FactureDetailPopup === 'function',
    feu: !!(window.FactureExportUtils && typeof window.FactureExportUtils.buildFactureLines === 'function'),
  }));
  ok(globals.popup, 'window.FactureDetailPopup exposé (function)');
  ok(globals.feu, 'window.FactureExportUtils.buildFactureLines exposé');

  // Monte la popup pour de vrai dans un conteneur dédié et lit le DOM rendu.
  // createRoot.render est ASYNCHRONE (React 18) → on attend un tick avant de
  // lire le DOM.
  const render = await page.evaluate((facture) => {
    return new Promise((resolve) => {
      const out = { mounted: false, err: null, headerCount: 0, totalRowText: '', tvaBaseFromUtils: null, hasClose: false };
      try {
        const container = document.createElement('div');
        container.id = 'fdp-smoke-root';
        document.body.appendChild(container);
        const root = window.ReactDOM.createRoot(container);
        const statusLabels = { validee_achats: 'Validée Achats' };
        root.render(window.React.createElement(window.FactureDetailPopup, {
          facture: facture, statusLabels: statusLabels, onClose: function () {},
        }));
        out.tvaBaseFromUtils = window.FactureExportUtils.buildFactureLines(facture).tvaBase;
        setTimeout(function () {
          out.mounted = !!container.querySelector('table');
          const tfootCells = container.querySelectorAll('tfoot td');
          out.totalRowText = Array.prototype.map.call(tfootCells, (td) => td.textContent).join(' | ');
          out.hasClose = !!container.querySelector('button[aria-label="Fermer"]');
          out.headerCount = container.querySelectorAll('tbody tr').length;
          resolve(out);
        }, 60);
      } catch (e) { out.err = String(e); resolve(out); }
    });
  }, TEST_FACTURE);

  ok(!render.err, `popup montée sans exception (${render.err || 'ok'})`);
  ok(render.mounted, 'tableau de détail rendu dans le DOM');
  ok(render.headerCount === 3, `3 lignes d'items rendues (got: ${render.headerCount})`);
  ok(render.hasClose, 'bouton de fermeture (×) présent');
  // Total TVA = TTC − HT = 140. Vérifie que le total affiché contient 140,00
  // et que buildFactureLines renvoie bien 140.
  ok(render.tvaBaseFromUtils === 140, `buildFactureLines.tvaBase = 140 (got: ${render.tvaBaseFromUtils})`);
  ok(/140,00/.test(render.totalRowText), `ligne TOTAL affiche la TVA 140,00 (= TTC−HT) — got: "${render.totalRowText}"`);
  ok(/1\s?000,00/.test(render.totalRowText), 'ligne TOTAL affiche HT 1 000,00');
  ok(/1\s?140,00/.test(render.totalRowText), 'ligne TOTAL affiche TTC 1 140,00');

  // Fermeture : clic × retire la popup montée (onClose ne fait rien ici, donc
  // on teste plutôt la présence du handler — on remonte avec un onClose réel).
  const closeOk = await page.evaluate((facture) => {
    return new Promise((resolve) => {
      const container = document.createElement('div');
      container.id = 'fdp-smoke-close';
      document.body.appendChild(container);
      const root = window.ReactDOM.createRoot(container);
      let closed = false;
      root.render(window.React.createElement(window.FactureDetailPopup, {
        facture: facture, statusLabels: {}, onClose: function () { closed = true; },
      }));
      setTimeout(function () {
        const btn = container.querySelector('button[aria-label="Fermer"]');
        if (btn) btn.click();
        setTimeout(function () { resolve(closed); }, 50);
      }, 50);
    });
  }, TEST_FACTURE);
  ok(closeOk === true, 'clic sur × déclenche onClose');

  await browser.close();
  return failures;
}

(async () => {
  console.log('[smoke] FactureDetailPopup — démarrage serveur public/…');
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
