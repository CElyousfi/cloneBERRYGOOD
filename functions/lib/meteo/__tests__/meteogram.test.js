/**
 * meteogram — le module ne dessine rien : sa seule responsabilité est de
 * demander la BONNE image (unités explicites) et de ne JAMAIS laisser passer
 * autre chose qu'un vrai PNG. Meteoblue a déjà servi au projet des HTTP 200
 * creux (cf. meteoblueProxy.isValidWeatherPayload) : une page d'erreur HTML
 * uploadée comme header d'un template WhatsApp partirait à tous les chefs.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  METEOGRAM_BASE_URL,
  PNG_MIME,
  PNG_SIGNATURE,
  MIN_PNG_BYTES,
  DEFAULT_TIMEOUT_MS,
  buildMeteogramUrl,
  isValidPng,
  withTimeout,
  fetchMeteogram,
} = require('../meteogram');

const COORDS = { lat: 35.08, lon: -6.14, altitude: 49 };
const KEY = 'TESTKEY';

/** PNG synthétique valide : signature + assez d'octets. */
function fakePng(bytes) {
  const total = bytes === undefined ? MIN_PNG_BYTES + 100 : bytes;
  return Buffer.concat([
    PNG_SIGNATURE,
    Buffer.alloc(Math.max(0, total - PNG_SIGNATURE.length), 7),
  ]);
}

/** Capture les console.warn d'un appel. */
async function captureWarns(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => { lines.push(a.join(' ')); };
  try {
    const result = await fn();
    return { result, lines };
  } finally {
    console.warn = orig;
  }
}

test('buildMeteogramUrl : point demandé + unités TOUJOURS explicites', () => {
  const url = buildMeteogramUrl(COORDS, KEY);
  assert.ok(url.startsWith(METEOGRAM_BASE_URL + '?'), 'endpoint meteogram_agro');
  assert.ok(url.includes('apikey=TESTKEY'));
  assert.ok(url.includes('lat=35.08'));
  assert.ok(url.includes('lon=-6.14'));
  assert.ok(url.includes('asl=49'));
  // Sans ces trois paramètres, Meteoblue peut servir °F / mph / inch.
  assert.ok(url.includes('temperature=C'), 'unité de température');
  assert.ok(url.includes('windspeed=kmh'), 'unité de vent');
  assert.ok(url.includes('precipitationamount=mm'), 'unité de pluie');
});

test('buildMeteogramUrl : unités surchargeables, jamais absentes', () => {
  const url = buildMeteogramUrl(COORDS, KEY, { temperature: 'F', windspeed: 'mph' });
  assert.ok(url.includes('temperature=F'));
  assert.ok(url.includes('windspeed=mph'));
  assert.ok(url.includes('precipitationamount=mm'), 'défaut conservé pour le reste');
  // Une surcharge vide retombe sur le défaut plutôt que de produire « =& ».
  const vide = buildMeteogramUrl(COORDS, KEY, { temperature: '' });
  assert.ok(vide.includes('temperature=C'));
});

test('PNG_MIME est celui attendu par uploadMedia', () => {
  assert.equal(PNG_MIME, 'image/png');
});

test('isValidPng : accepte un PNG plausible, rejette tout le reste', () => {
  assert.equal(isValidPng(fakePng()), true);
  assert.equal(isValidPng(Buffer.alloc(0)), false, 'buffer vide');
  assert.equal(isValidPng(fakePng(MIN_PNG_BYTES - 1)), false, 'PNG trop court = placeholder');
  assert.equal(isValidPng(Buffer.from('<!DOCTYPE html><html>error</html>'.repeat(200))), false, 'page HTML');
  assert.equal(isValidPng(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(4000)])), false, 'autre format');
  assert.equal(isValidPng(null), false);
  assert.equal(isValidPng(undefined), false);
  assert.equal(isValidPng('pas un buffer'), false);
});

test('fetchMeteogram : PNG valide → buffer rendu tel quel (licence ND)', async () => {
  const png = fakePng();
  let vue = null;
  const out = await fetchMeteogram(COORDS, {
    fetchBuffer: async (url) => { vue = url; return png; },
    apiKey: KEY,
  });
  assert.ok(Buffer.isBuffer(out));
  assert.equal(out.length, png.length, 'aucun octet retiré ni ajouté');
  assert.ok(out.equals(png), 'image transmise TELLE QUELLE (CC BY-ND)');
  assert.equal(vue, buildMeteogramUrl(COORDS, KEY));
});

test('fetchMeteogram : page HTML servie en 200 → null, et ça se voit dans les logs', async () => {
  const { result, lines } = await captureWarns(() => fetchMeteogram(COORDS, {
    fetchBuffer: async () => Buffer.from('<!DOCTYPE html><h1>Invalid API key</h1>'),
    apiKey: KEY,
  }));
  assert.equal(result, null);
  assert.ok(lines.some((l) => /non PNG ou creuse/.test(l)), 'dégradation journalisée');
});

test('fetchMeteogram : buffer vide ou creux → null', async () => {
  for (const corps of [Buffer.alloc(0), fakePng(MIN_PNG_BYTES - 10), null]) {
    const { result } = await captureWarns(() => fetchMeteogram(COORDS, {
      fetchBuffer: async () => corps,
      apiKey: KEY,
    }));
    assert.equal(result, null);
  }
});

test('fetchMeteogram : erreur réseau → null, jamais de throw', async () => {
  const { result, lines } = await captureWarns(() => fetchMeteogram(COORDS, {
    fetchBuffer: async () => { throw new Error('ECONNRESET'); },
    apiKey: KEY,
  }));
  assert.equal(result, null);
  assert.ok(lines.some((l) => /échec réseau/.test(l) && /ECONNRESET/.test(l)));
});

test('fetchMeteogram : un fetch qui ne répond jamais est coupé par le timeout', async () => {
  const t0 = Date.now();
  const { result, lines } = await captureWarns(() => fetchMeteogram(COORDS, {
    fetchBuffer: () => new Promise(() => {}), // ne se résout jamais
    apiKey: KEY,
    timeoutMs: 40,
  }));
  assert.equal(result, null);
  assert.ok(Date.now() - t0 < 2000, 'le job ne doit pas rester bloqué');
  assert.ok(lines.some((l) => /timeout après 40 ms/.test(l)));
});

test('fetchMeteogram : timeout par défaut borné, jamais infini', () => {
  assert.ok(DEFAULT_TIMEOUT_MS > 0 && DEFAULT_TIMEOUT_MS <= 20000);
});

test('fetchMeteogram : deps incomplètes = erreur de programmation, pas de silence', async () => {
  await assert.rejects(() => fetchMeteogram(COORDS, /** @type {*} */ ({ apiKey: KEY })), TypeError);
  await assert.rejects(
    () => fetchMeteogram(COORDS, /** @type {*} */ ({ fetchBuffer: async () => null })), TypeError);
  await assert.rejects(() => fetchMeteogram(COORDS, /** @type {*} */ (null)), TypeError);
});

// ─────────────────────────────────────────────────────────────────────────────
// Régression PR #275 — le timeout doit se déclencher même si RIEN d'autre ne
// tient la boucle d'événements.
// ─────────────────────────────────────────────────────────────────────────────

test('withTimeout : le timer est nettoyé sur TOUS les chemins (succès, erreur, timeout)', async () => {
  // Un timer non nettoyé retiendrait le process d'une Cloud Function. C'est ce
  // nettoyage systématique qui rend l'`unref()` inutile — et l'`unref()` était
  // précisément ce qui rendait le timeout non fiable.
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  let created = 0;
  let cleared = 0;
  global.setTimeout = function() { created++; return realSet.apply(null, arguments); };
  global.clearTimeout = function() { cleared++; return realClear.apply(null, arguments); };
  try {
    assert.equal(await withTimeout(Promise.resolve('ok'), 5000), 'ok');
    await assert.rejects(() => withTimeout(Promise.reject(new Error('boom')), 5000), /boom/);
    await assert.rejects(() => withTimeout(new Promise(() => {}), 20), /timeout après 20 ms/);
  } finally {
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }
  assert.ok(created >= 3, 'un timer par appel');
  assert.equal(cleared, created, 'autant de clearTimeout que de setTimeout');
});

test('withTimeout : un timer unref\'é rendrait le garde-fou inopérant (régression)', () => {
  // Preuve du MÉCANISME de la panne CI, en une ligne : une boucle qui n'a plus
  // qu'un timer unref'é se vide, et le timer ne se déclenche jamais.
  const { execFileSync } = require('node:child_process');
  const out = execFileSync(process.execPath, ['-e', [
    "const t = setTimeout(() => console.log('FIRED'), 10);",
    't.unref();',
    'new Promise(() => {});',
    "process.on('exit', () => console.log('DRAINED'));",
  ].join('\n')], { encoding: 'utf8' });
  assert.match(out, /DRAINED/);
  assert.doesNotMatch(out, /FIRED/,
    'un timer unref\'é ne se déclenche pas quand la boucle se vide — d\'où le fix');
});

test('fetchMeteogram : le timeout coupe même dans un process SANS rien d\'autre à faire', () => {
  // Reproduction exacte du rouge CI (Node 20 : « Promise resolution is still
  // pending but the event loop has already resolved »), dans un process neuf où
  // le seul travail en cours est le fetch qui ne répond jamais. Le lancer en
  // sous-process rend le test indépendant du runner de tests et de sa version.
  const { execFileSync } = require('node:child_process');
  const path = require('node:path');
  const modulePath = path.join(__dirname, '..', 'meteogram.js');
  const out = execFileSync(process.execPath, ['-e', [
    'const m = require(' + JSON.stringify(modulePath) + ');',
    'console.warn = () => {};',
    'm.fetchMeteogram({ lat: 1, lon: 2, altitude: 3 }, {',
    '  fetchBuffer: () => new Promise(() => {}),',
    "  apiKey: 'k', timeoutMs: 30,",
    "}).then((v) => console.log('SETTLED', JSON.stringify(v)));",
  ].join('\n')], { encoding: 'utf8', timeout: 10000 });
  assert.match(out, /SETTLED null/,
    'la promesse DOIT se régler à null — sans le fix, le process sort sans jamais la régler');
});
