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
