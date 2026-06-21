/**
 * Smoke-load réel (sous-lot 4.4) — vue compte-client + retrait menu legacy.
 *
 * Vérifie sur le PREVIEW :
 *   1. #root monté (childElementCount > 0) + 0 erreur console/page.
 *      (Les erreurs Firebase auth, attendues sans creds, sont filtrées.)
 *   2. Le bundle app.js contient le nouveau sous-onglet caisse
 *      « Comptes Clients » (id caisse_comptes_clients) + le composant
 *      CaisseComptesClientsSub.
 *   3. Le menu legacy « Marché Local / Situation Clients » (fin_marche_local)
 *      n'est plus une entrée de nav (aucun `{ id: 'fin_marche_local', ... }`).
 *
 * Usage:
 *   BASE_URL=https://...preview... node tests/smoke-comptes-clients.js
 */

const { chromium } = require('playwright');

const BASE_URL = process.env.BASE_URL || 'https://berrygood-farms-dashboard.web.app';

const IGNORE_RE = /Firebase|firebaseAuth|auth\/|api\/auth|backend-not-available|service worker|fetch failed|503|Not Found|404|net::ERR/i;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleErrors = [];
  const pageErrors = [];

  // addInitScript AVANT les scripts de page : capture les erreurs très tôt.
  await page.addInitScript(() => {
    window.__SMOKE_ERRORS__ = [];
    window.addEventListener('error', (e) => {
      window.__SMOKE_ERRORS__.push(String((e && e.message) || e));
    }, true);
    window.addEventListener('unhandledrejection', (e) => {
      window.__SMOKE_ERRORS__.push('unhandledrejection: ' + String((e && e.reason && e.reason.message) || (e && e.reason) || e));
    }, true);
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (!IGNORE_RE.test(t)) consoleErrors.push(t);
    }
  });
  page.on('pageerror', (err) => {
    const t = String(err && err.message || err);
    if (!IGNORE_RE.test(t)) pageErrors.push(t);
  });

  let failed = false;
  const log = (ok, name, detail) => {
    console.log(`  ${ok ? 'OK ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) failed = true;
  };

  console.log(`Smoke-load comptes clients sur ${BASE_URL}`);

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(2500);

  // 1. #root monté
  const rootChildren = await page.evaluate(() => {
    const r = document.getElementById('root');
    return r ? r.childElementCount : -1;
  });
  log(rootChildren > 0, '#root monté (childElementCount > 0)', 'children=' + rootChildren);

  // 1b. Erreurs early (addInitScript) + console + pageerror (filtrées)
  const earlyErrors = (await page.evaluate(() => window.__SMOKE_ERRORS__ || []))
    .filter((e) => !IGNORE_RE.test(e));
  log(earlyErrors.length === 0, 'Aucune erreur early (window error/rejection)', earlyErrors.join(' | '));
  log(consoleErrors.length === 0, 'Aucune erreur console', consoleErrors.join(' | '));
  log(pageErrors.length === 0, 'Aucune erreur page (pageerror)', pageErrors.join(' | '));

  // 2 & 3 : inspection du bundle servi par le preview.
  const bundle = await page.evaluate(async () => {
    const res = await fetch('/app.js', { cache: 'no-store' });
    return res.text();
  });

  log(bundle.includes("'caisse_comptes_clients'"), 'Sous-onglet caisse_comptes_clients présent dans le bundle');
  log(bundle.includes('CaisseComptesClientsSub'), 'Composant CaisseComptesClientsSub présent dans le bundle');
  log(bundle.includes('Comptes Clients'), 'Libellé « Comptes Clients » présent');

  // L'entrée de nav legacy ne doit plus exister : aucun objet nav `{ id: 'fin_marche_local' ...`
  const navLegacy = /id:\s*['"]fin_marche_local['"]\s*,\s*label/.test(bundle);
  log(!navLegacy, "Entrée de menu legacy fin_marche_local (id+label) ABSENTE du nav");

  await browser.close();

  console.log(failed ? '\nRESULTAT: ECHEC' : '\nRESULTAT: SUCCES');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('Smoke crash:', e);
  process.exit(1);
});
