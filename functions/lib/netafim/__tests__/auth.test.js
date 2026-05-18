'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeGetAccessToken, TOKEN_TTL_SAFETY_MS } = require('../auth');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}

function makeFakeFetch(impl) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return impl(calls.length, url, opts);
  };
  fn.calls = calls;
  return fn;
}

function cfg(over) {
  return Object.assign({
    enabled: true,
    client_id: 'ID',
    client_secret: 'SECRET',
    base_url: 'https://apim.netafim.com',
    token_url: 'https://apim.netafim.com/oauth2/token',
  }, over || {});
}

test('getAccessToken: mints once, caches until near expiry', async () => {
  let nowMs = 1_000_000;
  const fetchImpl = makeFakeFetch(() => jsonResponse(200, { access_token: 'TKN', expires_in: 3600 }));
  const getConfig = async () => cfg();
  const get = makeGetAccessToken({ getConfig, fetch: fetchImpl, now: () => nowMs });

  const t1 = await get();
  assert.equal(t1.token, 'TKN');
  assert.equal(fetchImpl.calls.length, 1);

  // 10 min later, still cached
  nowMs += 10 * 60 * 1000;
  const t2 = await get();
  assert.equal(t2.token, 'TKN');
  assert.equal(fetchImpl.calls.length, 1);

  // 56 min later (1 min before nominal expiry, inside safety margin) → renew
  nowMs += 46 * 60 * 1000;
  await get();
  assert.equal(fetchImpl.calls.length, 2);
});

test('getAccessToken: posts client_credentials as form-urlencoded', async () => {
  const fetchImpl = makeFakeFetch(() => jsonResponse(200, { access_token: 'X', expires_in: 60 }));
  const get = makeGetAccessToken({ getConfig: async () => cfg(), fetch: fetchImpl, now: () => 0 });
  await get();
  const sent = fetchImpl.calls[0];
  assert.equal(sent.opts.method, 'POST');
  assert.equal(sent.opts.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.match(sent.opts.body, /grant_type=client_credentials/);
  assert.match(sent.opts.body, /client_id=ID/);
  assert.match(sent.opts.body, /client_secret=SECRET/);
});

test('getAccessToken: throws on missing config', async () => {
  const get = makeGetAccessToken({ getConfig: async () => null, fetch: async () => jsonResponse(200, {}), now: () => 0 });
  await assert.rejects(() => get(), /config missing/);
});

test('getAccessToken: throws on missing credentials', async () => {
  const get = makeGetAccessToken({
    getConfig: async () => ({ enabled: true, token_url: 'x' }),
    fetch: async () => jsonResponse(200, {}),
    now: () => 0,
  });
  await assert.rejects(() => get(), /client_id/);
});

test('getAccessToken: surfaces server error with status', async () => {
  const fetchImpl = makeFakeFetch(() => jsonResponse(500, { error: 'boom' }));
  const get = makeGetAccessToken({ getConfig: async () => cfg(), fetch: fetchImpl, now: () => 0 });
  await assert.rejects(() => get(), /token request failed \(500\)/);
});

test('TOKEN_TTL_SAFETY_MS is a sensible 5-minute buffer', () => {
  assert.equal(TOKEN_TTL_SAFETY_MS, 5 * 60 * 1000);
});
