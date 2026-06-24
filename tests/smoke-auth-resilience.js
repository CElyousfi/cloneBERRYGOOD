#!/usr/bin/env node
/**
 * smoke-auth-resilience.js
 *
 * CRITICAL smoke (high blast radius): exercises the boot/auth flow touched by
 * the fix/auth-resilience item. Runs on BOTH Chromium AND WebKit.
 *
 * What this PROVES (per browser engine):
 *   1. App BOOTS — no React #200, no UMD global collision, #root renders.
 *      window.AuthResilience pure helpers are exposed and behave.
 *   2. LOGIN NON-REGRESSION — when no Firebase user is signed in, the app shows
 *      the LoginScreen (input[type=password] present). A REAL disconnect must
 *      always reach login.
 *   3. RESILIENCE — with a stubbed signed-in Firebase user AND a `me` endpoint
 *      that FAILS transiently (503), the app does NOT fall back to LoginScreen:
 *      it stays in the app using a cached profile and shows the "Reconnexion en
 *      cours…" banner.
 *   4. me OK — with a stubbed signed-in user and a `me` returning success, the
 *      app enters normally (no login screen, no reconnecting banner).
 *   5. checkVersion SOFT — when app-version.txt advertises a new version, the
 *      app shows the "Nouvelle version" toast and does NOT auto-reload.
 *
 * HOW the stubbing works (no real Firebase creds, no secrets):
 *   - We override window.firebaseAuth via addInitScript BEFORE app.js runs, so
 *     onAuthStateChanged is driven by the test. firebase.initializeApp may set
 *     firebaseAuth in index.html; our init script reassigns it afterwards via a
 *     getter guard.
 *   - The local HTTP server answers /api/auth?action=me with a status chosen by
 *     a query/header set per scenario.
 *
 * What this does NOT cover (documented):
 *   - Real email/password login against real Firebase (would need creds/secrets).
 *   - Real Identity Platform session behaviour. The transient-failure path is
 *     simulated, which is exactly the bug class this item fixes.
 *
 * Run: node tests/smoke-auth-resilience.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, webkit } = require('playwright');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const SHOT_DIR = path.resolve(__dirname, '..', 'docs');

// Mutable scenario state shared with the HTTP server.
const serverState = {
  meMode: 'fail', // 'fail' (503) | 'ok' | 'disabled'
  appVersion: '20260415b', // value returned by /app-version.txt
};

function mimeFor(p) {
  const ext = path.extname(p).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  })[ext] || 'application/octet-stream';
}

function startServer(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let url = req.url.split('?')[0];
      if (url === '/' || url.endsWith('/')) url += 'index.html';

      // /app-version.txt — controllable for the soft-checkVersion scenario.
      if (url === '/app-version.txt') {
        res.setHeader('content-type', 'text/plain');
        res.setHeader('cache-control', 'no-store');
        res.end(serverState.appVersion);
        return;
      }

      // /api/auth?action=me — controllable per scenario.
      if (url === '/api/auth') {
        res.setHeader('content-type', 'application/json');
        res.setHeader('cache-control', 'no-store');
        if (serverState.meMode === 'fail') {
          res.statusCode = 503;
          res.end(JSON.stringify({ success: false, error: 'transient' }));
        } else if (serverState.meMode === 'disabled') {
          res.statusCode = 200;
          res.end(JSON.stringify({ success: false, disabled: true, error: 'Compte désactivé' }));
        } else {
          res.statusCode = 200;
          res.end(JSON.stringify({ success: true, user: { uid: 'smoke-uid', profileId: 'finance', displayName: 'Smoke', role: 'admin' } }));
        }
        return;
      }

      // Any other /api/* → 503 (no backend in smoke).
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
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// Init script injected before any page script: installs a controllable fake
// firebaseAuth. The test drives onAuthStateChanged via window.__smokeAuth.
const INIT_SCRIPT = `
(function () {
  var listeners = [];
  var currentUser = window.__SMOKE_INITIAL_USER || null;
  var fake = {
    get currentUser() { return currentUser; },
    onAuthStateChanged: function (cb) {
      listeners.push(cb);
      // Fire asynchronously like the real SDK.
      setTimeout(function () { try { cb(currentUser); } catch (e) {} }, 0);
      return function () { var i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
    },
    signOut: function () {
      currentUser = null;
      listeners.forEach(function (cb) { try { cb(null); } catch (e) {} });
      return Promise.resolve();
    },
    signInWithEmailAndPassword: function () { return Promise.reject(new Error('smoke: not supported')); },
  };
  window.__smokeAuth = {
    setUser: function (u) {
      currentUser = u;
      listeners.forEach(function (cb) { try { cb(u); } catch (e) {} });
    },
  };
  // Real fake user shape: only getIdToken is used by the app.
  if (currentUser && typeof currentUser.getIdToken !== 'function') {
    currentUser.getIdToken = function () { return Promise.resolve('smoke-token'); };
  }
  // Reassign firebaseAuth after index.html's firebase.initializeApp ran.
  Object.defineProperty(window, 'firebaseAuth', {
    configurable: true,
    get: function () { return fake; },
    set: function () { /* ignore index.html assignment */ },
  });
})();
`;

async function runEngine(engine, name, port) {
  const url = `http://127.0.0.1:${port}`;
  const failures = [];
  const ok = (cond, msg) => { if (!cond) failures.push(`[${name}] ${msg}`); else console.log(`  ✓ [${name}] ${msg}`); };

  const browser = await engine.launch();

  // ---------- Scenario A: no user → LOGIN (non-regression) ----------
  serverState.meMode = 'fail';
  serverState.appVersion = '20260415b';
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.addInitScript(INIT_SCRIPT);
    await page.evaluate(() => {}); // no-op
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(2500);

    const critical = pageErrors.filter((e) => !/Firebase|firebaseAuth|auth\/|api\/auth|503|404|service worker|fetch failed|backend-not-available/i.test(e));
    ok(critical.length === 0, `boots with 0 critical page errors (no React #200 / collision) [got ${critical.length}]`);
    if (critical.length) critical.forEach((e) => console.log('    pageerror:', e));

    const arShape = await page.evaluate(() => {
      const A = window.AuthResilience;
      if (!A) return { present: false };
      return {
        present: true,
        login: A.decideAuthState({ authUser: null }).action,
        retry: A.decideAuthState({ authUser: { uid: 'x' }, meResult: { ok: false }, cachedProfile: { uid: 'x' } }).action,
        ver: A.isNewAppVersion('a', 'b'),
      };
    });
    ok(arShape.present, 'window.AuthResilience exposed');
    ok(arShape.login === 'login' && arShape.retry === 'retry' && arShape.ver === true, 'AuthResilience pure helpers behave in browser');

    const hasPassword = await page.locator('input[type=password]').count();
    ok(hasPassword > 0, 'NON-REGRESSION login: LoginScreen shown when no Firebase user (password field present)');

    await page.screenshot({ path: path.join(SHOT_DIR, `auth-resilience-${name}-A-login.png`), fullPage: true });
    await ctx.close();
  }

  // ---------- Scenario B: signed-in user + me FAILS + cached profile → stay in app + banner ----------
  serverState.meMode = 'fail';
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    // Pre-seed a cached profile + a signed-in user BEFORE app boots.
    await page.addInitScript(`window.__SMOKE_INITIAL_USER = { uid: 'smoke-uid', getIdToken: function(){ return Promise.resolve('smoke-token'); } };`);
    await page.addInitScript(`try { localStorage.setItem('cachedUserProfile', JSON.stringify({ uid: 'smoke-uid', profileId: 'finance', displayName: 'Cached User', role: 'admin' })); } catch(e){}`);
    await page.addInitScript(INIT_SCRIPT);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const passwordCount = await page.locator('input[type=password]').count();
    ok(passwordCount === 0, 'RESILIENCE: app does NOT fall back to login when me fails but Firebase connected + cache present');
    ok(/Reconnexion en cours/i.test(bodyText), 'RESILIENCE: "Reconnexion en cours…" banner shown');

    const critical = pageErrors.filter((e) => !/Firebase|firebaseAuth|auth\/|api\/auth|503|404|service worker|fetch failed|backend-not-available/i.test(e));
    ok(critical.length === 0, `resilience path: 0 critical page errors [got ${critical.length}]`);
    if (critical.length) critical.forEach((e) => console.log('    pageerror:', e));

    await page.screenshot({ path: path.join(SHOT_DIR, `auth-resilience-${name}-B-reconnecting.png`), fullPage: true });
    await ctx.close();
  }

  // ---------- Scenario C: signed-in user + me OK → app enters, no banner ----------
  serverState.meMode = 'ok';
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(`window.__SMOKE_INITIAL_USER = { uid: 'smoke-uid', getIdToken: function(){ return Promise.resolve('smoke-token'); } };`);
    await page.addInitScript(INIT_SCRIPT);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const bodyText = await page.evaluate(() => document.body.innerText || '');
    const passwordCount = await page.locator('input[type=password]').count();
    ok(passwordCount === 0, 'me OK: no login screen (authenticated)');
    ok(!/Reconnexion en cours/i.test(bodyText), 'me OK: no reconnecting banner');

    await page.screenshot({ path: path.join(SHOT_DIR, `auth-resilience-${name}-C-app.png`), fullPage: true });
    await ctx.close();
  }

  // ---------- Scenario D: checkVersion SOFT — new version → toast, no auto-reload ----------
  serverState.meMode = 'fail';
  serverState.appVersion = '99999999z'; // different from baked APP_VERSION
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let navigated = 0;
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigated++; });
    await page.addInitScript(INIT_SCRIPT);
    await page.goto(url, { waitUntil: 'load' });
    const navAfterLoad = navigated;
    // Wait for the toast text to appear (checkVersion fetch + event + React render).
    // WebKit can be slower than Chromium here, so poll up to 8s instead of a fixed wait.
    let toastShown = false;
    try {
      await page.locator('text=/Nouvelle version disponible/i').first().waitFor({ timeout: 8000 });
      toastShown = true;
    } catch (e) { toastShown = false; }
    ok(toastShown, 'checkVersion SOFT: "Nouvelle version" toast shown');
    ok(navigated === navAfterLoad, `checkVersion SOFT: NO automatic reload (navigations stable: ${navigated})`);

    await page.screenshot({ path: path.join(SHOT_DIR, `auth-resilience-${name}-D-version-toast.png`), fullPage: true });
    await ctx.close();
  }

  await browser.close();
  return failures;
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  console.log('[smoke-auth] Starting local HTTP server…');
  const { server, port } = await startServer();
  console.log('[smoke-auth] Serving at http://127.0.0.1:' + port);

  let allFailures = [];
  for (const [engine, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
    console.log(`\n[smoke-auth] === ${name} ===`);
    try {
      const f = await runEngine(engine, name, port);
      allFailures = allFailures.concat(f);
    } catch (e) {
      allFailures.push(`[${name}] FATAL: ${e && e.stack ? e.stack : e}`);
    }
  }

  server.close();

  console.log('\n[smoke-auth] Summary:');
  if (allFailures.length === 0) {
    console.log('  ALL GREEN — boot + login non-regression + resilience + soft checkVersion (chromium & webkit)');
    process.exit(0);
  } else {
    allFailures.forEach((f) => console.log('  ✗', f));
    process.exit(1);
  }
})().catch((e) => { console.error(e); process.exit(1); });
