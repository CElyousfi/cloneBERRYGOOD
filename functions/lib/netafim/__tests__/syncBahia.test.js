'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { syncBahia } = require('../');
const { READINGS_COLLECTION, CURSOR_COLLECTION, CURSOR_DOC } = require('../dataAccess');
const { COLLECTION: PARCELLES_COLLECTION } = require('../parcelles');
const { netafimItem, netafimPage, fakeDb } = require('./fixtures');

function configDoc(over) {
  return Object.assign({
    enabled: true,
    client_id: 'ID',
    client_secret: 'SECRET',
    base_url: 'https://apim.netafim.com',
    token_url: 'https://apim.netafim.com/oauth2/token',
    daily_call_limit: 25,
    farm_label: 'BAHIA',
  }, over || {});
}

function jsonRes(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}

/**
 * Build a fake fetch impl that routes by URL: token URL returns OAuth
 * response; pagination URL returns the queued pages in order.
 */
function makeUpstream(pages) {
  const calls = [];
  let pageIdx = 0;
  return {
    calls,
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      if (String(url).endsWith('/oauth2/token')) {
        return jsonRes(200, { access_token: 'TKN', expires_in: 3600 });
      }
      if (pageIdx < pages.length) return jsonRes(200, pages[pageIdx++]);
      return jsonRes(200, netafimPage({ items: [], pageNumber: pageIdx + 1, pageCount: pageIdx }));
    },
  };
}

test('syncBahia: skips when config disabled', async () => {
  const db = fakeDb({ [CURSOR_COLLECTION]: [{ id: 'netafim', enabled: false }] });
  const out = await syncBahia({ db, getConfig: async () => configDoc({ enabled: false }), fetch: async () => jsonRes(200, {}) });
  assert.equal(out.skipped, 'disabled');
  assert.equal(out.ok, true);
});

test('syncBahia: full happy path — writes readings + parcelles + cursor', async () => {
  const items = [
    netafimItem({ id: '10', valve: { irriBlockId: 'B1', irriBlockName: 'Bloc 1', vlvName: 'V1' } }),
    netafimItem({ id: '11', valve: { irriBlockId: 'B1', irriBlockName: 'Bloc 1', vlvName: 'V2' } }),
    netafimItem({ id: '12', valve: { irriBlockId: 'B2', irriBlockName: 'Bloc 2', vlvName: 'V3' } }),
  ];
  const pages = [netafimPage({ items, pageNumber: 1, pageCount: 1 })];
  const upstream = makeUpstream(pages);
  const db = fakeDb({});
  const out = await syncBahia({
    db,
    getConfig: async () => configDoc(),
    fetch: upstream.fetch,
    dateFrom: '2026-05-15T00:00:00Z',
    dateTo: '2026-05-16T00:00:00Z',
  });
  assert.equal(out.ok, true);
  assert.equal(out.itemsFetched, 3);
  assert.equal(out.readingsWritten, 3);
  assert.equal(out.parcellesWritten, 2);
  assert.equal(db._store[READINGS_COLLECTION].length, 3);
  assert.equal(db._store[PARCELLES_COLLECTION].length, 2);
  const cursor = db._store[CURSOR_COLLECTION].find(d => d.id === CURSOR_DOC);
  assert.ok(cursor.callsToday >= 2); // 1 token + ≥1 page
  assert.equal(cursor.lastError, null);
});

test('syncBahia: refuses when quota already exhausted', async () => {
  const { todayKey } = require('../rateLimiter');
  const today = todayKey(Date.now());
  const db = fakeDb({
    [CURSOR_COLLECTION]: [{ id: CURSOR_DOC, callsToday: 25, callsResetDate: today }],
  });
  const upstream = makeUpstream([netafimPage({ items: [], pageCount: 1 })]);
  const out = await syncBahia({
    db,
    getConfig: async () => configDoc(),
    fetch: upstream.fetch,
    dateFrom: '2026-05-15T00:00:00Z',
    dateTo: '2026-05-16T00:00:00Z',
  });
  assert.equal(out.skipped, 'quota');
  assert.equal(out.ok, false);
  assert.equal(upstream.calls.length, 0);
});

test('syncBahia: 404 on first page = empty success (no data window)', async () => {
  let calls = 0;
  const upstream = {
    fetch: async (url) => {
      calls++;
      if (String(url).endsWith('/oauth2/token')) {
        return jsonRes(200, { access_token: 'TKN', expires_in: 3600 });
      }
      return jsonRes(404, { message: 'Start timestamp ...' });
    },
  };
  const db = fakeDb({});
  const out = await syncBahia({
    db,
    getConfig: async () => configDoc(),
    fetch: upstream.fetch,
    dateFrom: '2026-05-15T00:00:00Z',
    dateTo: '2026-05-16T00:00:00Z',
  });
  assert.equal(out.ok, true);
  assert.equal(out.itemsFetched, 0);
  assert.equal(out.readingsWritten, 0);
  assert.ok(calls >= 2); // token + 1 page
});

test('syncBahia: dryRun does not write anything', async () => {
  const items = [netafimItem({ id: '99' })];
  const upstream = makeUpstream([netafimPage({ items, pageCount: 1 })]);
  const db = fakeDb({});
  const out = await syncBahia({
    db,
    getConfig: async () => configDoc(),
    fetch: upstream.fetch,
    dateFrom: '2026-05-15T00:00:00Z',
    dateTo: '2026-05-16T00:00:00Z',
    dryRun: true,
  });
  assert.equal(out.ok, true);
  assert.equal(out.itemsFetched, 1);
  assert.equal(out.readingsWritten, 0);
  assert.equal((db._store[READINGS_COLLECTION] || []).length, 0);
  assert.equal((db._store[PARCELLES_COLLECTION] || []).length, 0);
});

test('syncBahia: clamps dateFrom to 7-day window', async () => {
  let seenBody = null;
  const upstream = {
    fetch: async (url, opts) => {
      if (String(url).endsWith('/oauth2/token')) {
        return jsonRes(200, { access_token: 'TKN', expires_in: 3600 });
      }
      seenBody = JSON.parse(opts.body);
      return jsonRes(200, netafimPage({ items: [], pageCount: 1 }));
    },
  };
  const db = fakeDb({});
  const dateTo = new Date('2026-05-16T12:00:00Z');
  const dateFrom = new Date(dateTo.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days back
  const out = await syncBahia({
    db,
    getConfig: async () => configDoc(),
    fetch: upstream.fetch,
    dateFrom,
    dateTo,
  });
  assert.equal(out.ok, true);
  const expectedEarliest = new Date(dateTo.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(seenBody.startTimestampFrom, expectedEarliest);
});
