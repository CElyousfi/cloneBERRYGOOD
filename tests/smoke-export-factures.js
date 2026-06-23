#!/usr/bin/env node
/**
 * smoke-export-factures.js
 *
 * Smoke-load du lot "Export Factures v5" (TVA par ligne = taux SAISI uniquement).
 *
 * Objectif PRINCIPAL : prouver l'ABSENCE de collision UMD au boot.
 *   - public/lib/*.js sont chargés en <script> classiques → scope global PARTAGÉ.
 *     Une collision top-level crash le boot (React #200). require() (node:test)
 *     ne détecte PAS ce cas (scope isolé) → un vrai navigateur est obligatoire.
 *
 * Ce que ça couvre :
 *   - Sert public/ via un serveur HTTP local (port libre).
 *   - Écoute window error / pageerror AVANT navigation.
 *   - Charge la SPA dans Chromium PUIS WebKit.
 *   - Vérifie 0 erreur de boot, pas de React #200 (Minified React error #200).
 *   - Vérifie window.FactureExportUtils exposé avec la surface attendue.
 *   - Exerce deriveTauxLigne / matchProduitTaxable / buildFactureLines dans le
 *     navigateur (mono-taux 0%, mono-taux 20%, multi-taux, anomalie flaggée).
 *
 * Run: node tests/smoke-export-factures.js
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

const IGNORE = /Firebase|firebaseAuth|auth\/|api\/auth|backend-not-available|service worker|fetch failed|503|Not Found|404|net::ERR/i;

async function runOn(launcher, name, url) {
  const failures = [];
  const ok = (cond, msg) => { if (!cond) failures.push(`[${name}] ${msg}`); else console.log(`  ✓ [${name}] ${msg}`); };

  const browser = await launcher.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const critConsole = consoleErrors.filter((e) => !IGNORE.test(e));
  const critPage = pageErrors.filter((e) => !IGNORE.test(e));

  ok(critPage.length === 0, `0 page errors (got ${critPage.length})`);
  critPage.forEach((e) => console.log('    pageerror:', e));
  ok(critConsole.length === 0, `0 critical console errors (got ${critConsole.length})`);
  critConsole.forEach((e) => console.log('    console:', e));

  // React #200 = collision UMD typique au boot.
  const react200 = [...consoleErrors, ...pageErrors].some((e) => /Minified React error #200|error #200/.test(e));
  ok(!react200, 'no React #200 (no UMD collision at boot)');

  // FactureExportUtils exposé + surface attendue (v5).
  const shape = await page.evaluate(() => {
    const u = window.FactureExportUtils;
    if (!u) return { present: false };
    return {
      present: true,
      fns: ['buildFactureLines', 'campaignBounds', 'isWithinPeriod', 'parseFactureDate',
        'reconciliationEpsilon', 'parseSaisiTaux', 'resolveTauxLigne',
        'buildRecapStatutRows'].every((f) => typeof u[f] === 'function'),
      infoLabel: u.INFO_TVA_NON_SAISIE,
      anomalieB: u.ANOMALIE_TVA_B,
      noAnomalieA: typeof u.ANOMALIE_TVA_A === 'undefined',
      // v5fix — bloc statut aligné : montant sous Total TTC (idx 7), jamais
      // sur Fournisseur (idx 3).
      recapAligned: (() => {
        const rows = u.buildRecapStatutRows(
          [{ total_ttc: 1200, payment_status: 'payee' }],
          { payee: 'Payée' }
        );
        const last = rows[rows.length - 1];
        return last.length === u.RECAP_NB_COLS &&
          last[u.RECAP_COL.FOURNISSEUR].v === '' &&
          last[u.RECAP_COL.TOTAL_TTC].v === 1200;
      })(),
    };
  });
  ok(shape.present, 'window.FactureExportUtils exposed');
  ok(shape.fns, 'FactureExportUtils — toutes les fonctions publiques présentes');
  ok(shape.infoLabel === 'TVA par ligne non saisie', 'INFO_TVA_NON_SAISIE exposé (label informatif)');
  ok(typeof shape.anomalieB === 'string', 'ANOMALIE_TVA_B exposé (vraie anomalie)');
  ok(shape.noAnomalieA, 'ANOMALIE_TVA_A retiré (devinette mot-clé abandonnée)');
  ok(shape.recapAligned, 'buildRecapStatutRows — bloc statut aligné (montant sous Total TTC, rien sur Fournisseur)');

  // v5 — résolution du taux ligne : SAISI uniquement, sinon non déterminé.
  const resolve = await page.evaluate(() => {
    const u = window.FactureExportUtils;
    return {
      saisi20: u.resolveTauxLigne({ article: 'X', taux_tva: 20 }),
      saisi0: u.resolveTauxLigne({ article: 'X', taux_tva: 0 }),
      nullNitrique: u.resolveTauxLigne({ article: 'acide nitrique 60%', taux_tva: null }),
      absent: u.resolveTauxLigne({ article: 'Engrais NPK' }),
    };
  });
  ok(resolve.saisi20.rate === 0.2 && resolve.saisi20.source === 'saisi',
    'resolveTauxLigne — taux saisi 20% utilisé tel quel (navigateur)');
  ok(resolve.saisi0.rate === 0 && resolve.saisi0.source === 'saisi',
    'resolveTauxLigne — taux saisi 0% (exonéré) respecté (navigateur)');
  ok(resolve.nullNitrique.rate === null && resolve.nullNitrique.source === 'non_determine',
    'resolveTauxLigne — ex-acide sans taux saisi → NON DÉTERMINÉ, PLUS de devinette 20% (navigateur)');
  ok(resolve.absent.rate === null && resolve.absent.source === 'non_determine',
    'resolveTauxLigne — taux absent → non déterminé (navigateur)');

  // buildFactureLines — 3 états v5.
  const build = await page.evaluate(() => {
    const u = window.FactureExportUtils;
    const sum = (r) => Math.round(r.lines.reduce((s, l) => s + (l.montant_tva || 0), 0) * 100) / 100;
    // CAS 1a : tout saisi qui colle → réconcilié.
    const reconc = u.buildFactureLines({
      total_ht: 1800, total_tva: 200, total_ttc: 2000,
      items: [{ article: 'Engrais', montant_ht: 800, taux_tva: 0 }, { article: 'Acide', montant_ht: 1000, taux_tva: 20 }],
    });
    // CAS 1b : tout saisi mais Σ ≠ base → "Incohérence saisie" (B).
    const b = u.buildFactureLines({
      total_ht: 1000, total_tva: 350, total_ttc: 1350,
      items: [{ article: 'X', montant_ht: 500, taux_tva: 20 }, { article: 'Y', montant_ht: 500, taux_tva: 20 }],
    });
    // CAS 2 : ≥1 ligne sans taux saisi → INFO "TVA par ligne non saisie".
    const info = u.buildFactureLines({
      total_ht: 1000, total_tva: 200, total_ttc: 1200,
      items: [{ article: 'acide nitrique 60%', montant_ht: 1000, taux_tva: null }],
    });
    return {
      reconcOk: reconc.reconciled && reconc.anomalieType === null && sum(reconc) === 200,
      bType: b.anomalieType, bSum: sum(b), bLabel: b.anomalieLabel,
      infoType: info.anomalieType, infoLabel: info.anomalieLabel,
      infoTaux: info.lines[0].taux_tva, infoTva: info.lines[0].montant_tva,
      infoSource: info.lines[0].taux_source, infoTvaBase: info.tvaBase,
    };
  });
  ok(build.reconcOk, 'CAS 1a — tout saisi qui colle → réconcilié, Σtva=TTC−HT (navigateur)');
  ok(build.bType === 'B' && build.bSum === 350 && build.bLabel === shape.anomalieB,
    'CAS 1b — tout saisi, Σ≠base → "Incohérence saisie" (B), total préservé (navigateur)');
  ok(build.infoType === 'info' && build.infoLabel === 'TVA par ligne non saisie',
    'CAS 2 — ≥1 ligne null → INFO "TVA par ligne non saisie" (navigateur)');
  ok(build.infoTaux === null && build.infoTva === null && build.infoSource === 'non_determine',
    'CAS 2 — ligne null : taux/TVA = null ("—"), PAS de devinette (navigateur)');
  ok(build.infoTvaBase === 200, 'CAS 2 — total facture (TTC−HT) reste exact (navigateur)');

  await browser.close();
  return failures;
}

(async () => {
  console.log('[smoke] Serveur HTTP local pour public/…');
  const { server, url } = await startServer();
  console.log('[smoke] URL', url);

  let allFailures = [];
  for (const [launcher, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
    console.log(`[smoke] Lancement ${name}…`);
    try {
      const f = await runOn(launcher, name, url);
      allFailures = allFailures.concat(f);
    } catch (e) {
      allFailures.push(`[${name}] crash: ${String(e)}`);
    }
  }

  server.close();

  if (allFailures.length) {
    console.error('\n[smoke] ÉCHEC:');
    allFailures.forEach((f) => console.error('  ✗', f));
    process.exit(1);
  }
  console.log('\n[smoke] OK — boot propre, pas de collision UMD, API exposée.');
  process.exit(0);
})();
