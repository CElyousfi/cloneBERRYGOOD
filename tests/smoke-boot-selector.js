/**
 * smoke-boot-selector — le sélecteur d'entrée de public/index.html, dans un
 * vrai navigateur.
 *
 * Les tests unitaires couvrent l'arbitrage (public/lib/featureFlags.js), pas le
 * câblage : ils ne disent rien de l'ORDRE d'exécution des balises, qui est
 * précisément ce qui casse quand on écrit une balise d'entrée depuis du script.
 * Une balise insérée dynamiquement s'exécute hors de la file `defer` et peut
 * partir avant les lib/ dont l'entrée dépend — un défaut invisible en Node.
 *
 * Ce smoke sert public/ en local et vérifie les trois chemins :
 *   A. défaut          → app.js (le monolithe), aucune requête modulaire
 *   B. ?modular=1      → app.modular.js, rendu obtenu, marqueur de boot purgé
 *   C. marqueur present→ repli automatique sur le monolithe, marqueur consommé
 *
 * Usage : node tests/smoke-boot-selector.js
 * Navigateur : $CHROMIUM_PATH, sinon /usr/bin/chromium.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const p = require('path');
const { chromium } = require('playwright');

const ROOT = p.resolve(__dirname, '..');
const PUB = p.join(ROOT, 'public');

/**
 * Choix du navigateur, dans cet ordre : $CHROMIUM_PATH, puis le chromium
 * système (poste de dev), puis celui que Playwright a installé (CI). Sans ce
 * dernier repli, le smoke ne tournerait que là où /usr/bin/chromium existe.
 */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (fs.existsSync('/usr/bin/chromium')) return '/usr/bin/chromium';
  return undefined; // Playwright utilise son propre binaire
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    let file = p.join(PUB, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // Rewrite SPA : tout chemin inconnu rend index.html (cf. firebase.json).
      file = p.join(PUB, 'index.html');
    }
    res.writeHead(200, { 'Content-Type': MIME[p.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Charge une URL et rend ce que la page a demandé + son état de rendu. */
async function boot(browser, url, seed) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const requested = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/\/app\.js(\?|$)/.test(u)) requested.push('app.js');
    if (/\/app\.modular\.js(\?|$)/.test(u)) requested.push('app.modular.js');
  });
  if (seed) {
    // Le drapeau doit exister AVANT le premier chargement du document.
    await ctx.addInitScript(([k, v]) => {
      try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ }
    }, seed);
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // La disparition du splash atteste que React a monté l'application.
  let rendered = false;
  try {
    await page.waitForFunction(() => !document.getElementById('splash-screen'), { timeout: 25000 });
    rendered = true;
  } catch (e) { rendered = false; }
  const storage = await page.evaluate(() => ({
    flag: window.localStorage.getItem('sb_flag_modular_frontend'),
    pending: window.localStorage.getItem('sb_modular_boot_pending'),
  }));
  await ctx.close();
  return { requested, rendered, storage };
}

(async () => {
  if (!fs.existsSync(p.join(PUB, 'app.modular.js'))) {
    console.error('🛑 public/app.modular.js absent — lance `npm run build` d\'abord.');
    process.exit(1);
  }
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: chromiumPath(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const failures = [];
  const check = (name, cond, detail) => {
    console.log(`${cond ? '✅' : '🔴'} ${name}${cond ? '' : ' — ' + detail}`);
    if (!cond) failures.push(name);
  };

  try {
    // A. Défaut : le frontend MODULAIRE, et rien du monolithe.
    const a = await boot(browser, base + '/');
    check('A/ défaut → app.modular.js demandé', a.requested.includes('app.modular.js'), JSON.stringify(a.requested));
    check('A/ défaut → monolithe jamais demandé', !a.requested.includes('app.js'), JSON.stringify(a.requested));
    check('A/ défaut → interface rendue', a.rendered, 'splash toujours présent : le bundle modulaire ne monte pas');
    check('A/ défaut → marqueur de boot purgé après rendu', !a.storage.pending, String(a.storage.pending));

    // B. ?modular=0 : l'échappatoire manuelle vers le monolithe.
    const b = await boot(browser, base + '/?modular=0');
    check('B/ ?modular=0 → app.js demandé', b.requested.includes('app.js'), JSON.stringify(b.requested));
    check('B/ ?modular=0 → modulaire jamais demandé', !b.requested.includes('app.modular.js'), JSON.stringify(b.requested));
    check('B/ ?modular=0 → interface rendue', b.rendered, 'splash toujours présent');
    check('B/ ?modular=0 → choix mémorisé pour les navigations suivantes', b.storage.flag === '0', String(b.storage.flag));

    // C. Garde-fou : un boot modulaire jamais confirmé ramène au monolithe, et
    //    le repli COLLE — sinon le défaut modulaire reprendrait la main au
    //    chargement suivant, et l'utilisateur alternerait indéfiniment.
    const c = await boot(browser, base + '/', ['sb_modular_boot_pending', '1699999999999']);
    check('C/ marqueur d\'échec → repli sur app.js', c.requested.includes('app.js'), JSON.stringify(c.requested));
    check('C/ marqueur d\'échec → modulaire non retenté', !c.requested.includes('app.modular.js'), JSON.stringify(c.requested));
    check('C/ marqueur consommé', !c.storage.pending, String(c.storage.pending));
    check('C/ repli persisté en cache (pas d\'alternance au rechargement)', c.storage.flag === '0', String(c.storage.flag));
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures.length ? `\n🔴 ${failures.length} échec(s)` : '\n✅ sélecteur d\'entrée conforme');
  process.exit(failures.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
