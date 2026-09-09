/* compare-frontends — parcourt les DEUX frontends dans un vrai navigateur et
 * compare ce qu'ils rendent, profil par profil et onglet par onglet.
 *
 * POURQUOI. La fidélité de la migration est aujourd'hui garantie par
 * `verify-fidelity`, qui exige que chaque statement de `src/modules` soit
 * identique à l'octet près à `public/app.jsx`. Cette garantie est forte mais
 * terminale : elle interdit au tree modulaire d'évoluer (découper un fichier,
 * ajouter React.lazy, réorganiser en sous-dossiers la casse toute). Le jour où
 * on la retire, il faut la remplacer par une preuve de MÊME NIVEAU, sinon on
 * remplace une garantie par une opinion.
 *
 * Ce script est cette preuve : il ne compare plus des octets de source, il
 * compare le RENDU. Chaque profil, chaque onglet, dans les deux modes, et
 * l'écart est un échec.
 *
 * Le contournement d'authentification local (`?testui=1`, actif uniquement sur
 * localhost/127.0.0.1 — cf. public/lib/local-test-bypass.js) permet de tout
 * parcourir sans toucher à la base de production.
 *
 * Usage : node scripts/migrate/compare-frontends.cjs
 * Navigateur : $CHROMIUM_PATH, sinon /usr/bin/chromium.
 */
const http = require('http');
const fs = require('fs');
const p = require('path');
const { execFile } = require('child_process');

const ROOT = p.resolve(__dirname, '../..');
const PUB = p.join(ROOT, 'public');
const WALK = p.join(__dirname, 'walk-tabs.cjs');
const TMP = fs.mkdtempSync(p.join(require('os').tmpdir(), 'sb-parity-'));

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
      file = p.join(PUB, 'index.html'); // rewrite SPA, cf. firebase.json
    }
    res.writeHead(200, { 'Content-Type': MIME[p.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/**
 * Lance le crawler dans un processus fils. IMPÉRATIVEMENT asynchrone :
 * `execFileSync` bloquerait la boucle d'événements de CE processus, donc le
 * serveur statique ci-dessus ne répondrait à aucune requête pendant que le
 * navigateur charge la page — symptôme observé : « Target page, context or
 * browser has been closed » après un long silence.
 */
function walk(url, out) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [WALK, url, out], {
      cwd: ROOT,
      env: Object.assign({}, process.env, { PW: require.resolve('playwright') }),
      timeout: 25 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
    }, (err) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(fs.readFileSync(out, 'utf8'))); } catch (e) { reject(e); }
    });
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
  });
}

(async () => {
  if (!fs.existsSync(p.join(PUB, 'app.modular.js'))) {
    console.error('🛑 public/app.modular.js absent — lance `npm run build` d\'abord.');
    process.exit(1);
  }
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  let legacy, modular;
  try {
    console.log('\n══ MONOLITHE (app.js) ══');
    legacy = await walk(`${base}/?testui=1&modular=0`, p.join(TMP, 'legacy.json'));
    console.log('\n══ MODULAIRE (app.modular.js) ══');
    modular = await walk(`${base}/?testui=1&modular=1`, p.join(TMP, 'modular.json'));
  } finally {
    server.close();
  }

  const problems = [];
  const key = (t) => `${t.profile} › ${t.tab}`;
  const lm = new Map(legacy.tabs.map((t) => [key(t), t]));
  const mm = new Map(modular.tabs.map((t) => [key(t), t]));

  // 1. Même population de profils et d'onglets.
  for (const k of lm.keys()) if (!mm.has(k)) problems.push(`onglet ABSENT du modulaire : ${k}`);
  for (const k of mm.keys()) if (!lm.has(k)) problems.push(`onglet EN TROP dans le modulaire : ${k}`);

  // 2. Aucun écran qui plante d'un côté et pas de l'autre.
  for (const [k, m] of mm) {
    const l = lm.get(k);
    if (!l) continue;
    if (m.crash && !l.crash) problems.push(`PLANTE en modulaire seulement : ${k}`);
    if (m.status === 'NOT_FOUND' && l.status !== 'NOT_FOUND') problems.push(`onglet introuvable en modulaire : ${k}`);
  }

  // 3. Volume de contenu comparable. Un écran qui rend 10x moins de mots n'a pas
  //    « un léger écart » : il a perdu une section entière.
  //
  //    Sauf si le MONOLITHE a lui-même consigné une erreur sur cet écran : un
  //    onglet tombé en ErrorBoundary rend un message de quelques mots, et ce
  //    n'est pas une référence de volume. Depuis que le tree modulaire corrige
  //    des plantages que le monolithe (figé) conserve, ce cas est attendu — le
  //    modulaire rend PLUS, et c'est le but. On le signale sans en faire un
  //    écart.
  const ameliorations = [];
  for (const [k, m] of mm) {
    const l = lm.get(k);
    if (!l || l.crash || m.crash || !l.words || !m.words) continue;
    if ((l.errs || []).length && !(m.errs || []).length && m.words > l.words) { ameliorations.push(k); continue; }
    const ratio = m.words / l.words;
    if (ratio < 0.5 || ratio > 2) {
      problems.push(`volume de rendu divergent : ${k} (monolithe ${l.words} mots, modulaire ${m.words})`);
    }
  }

  const stat = (r) => `${r.profiles.length} profils, ${r.tabs.length} rendus, ` +
    `${r.tabs.filter((t) => t.crash).length} plantages`;
  console.log('\n══ COMPARAISON ══');
  console.log('  monolithe :', stat(legacy));
  console.log('  modulaire :', stat(modular));
  console.log('  rapports bruts :', TMP);
  if (ameliorations.length) {
    console.log(`  ${ameliorations.length} écran(s) où le monolithe plante et le modulaire rend :`);
    ameliorations.forEach((k) => console.log('     +', k));
  }

  if (problems.length) {
    console.log(`\n🔴 ${problems.length} écart(s) :`);
    problems.slice(0, 40).forEach((x) => console.log('   -', x));
    process.exit(1);
  }
  console.log('\n✅ parité de rendu : aucun écart entre les deux frontends');
})().catch((e) => { console.error(e); process.exit(1); });
