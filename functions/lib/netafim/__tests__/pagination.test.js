'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchAllPages, HARD_PAGE_CAP } = require('../pagination');
const { NetafimError, KIND } = require('../client');
const { netafimPage } = require('./fixtures');

test('fetchAllPages: single page case', async () => {
  let calls = 0;
  const out = await fetchAllPages(async (n) => {
    calls++;
    assert.equal(n, 1);
    return netafimPage({ items: [{ id: 'a' }, { id: 'b' }], pageNumber: 1, pageCount: 1 });
  });
  assert.equal(calls, 1);
  assert.equal(out.items.length, 2);
  assert.equal(out.pagesFetched, 1);
  assert.equal(out.pageCount, 1);
});

test('fetchAllPages: walks all pages sequentially', async () => {
  const pages = [
    netafimPage({ items: [{ id: '1' }, { id: '2' }], pageNumber: 1, pageCount: 3 }),
    netafimPage({ items: [{ id: '3' }, { id: '4' }], pageNumber: 2, pageCount: 3 }),
    netafimPage({ items: [{ id: '5' }],             pageNumber: 3, pageCount: 3 }),
  ];
  const seen = [];
  const out = await fetchAllPages(async (n) => {
    seen.push(n);
    return pages[n - 1];
  });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(out.items.length, 5);
  assert.equal(out.pagesFetched, 3);
});

test('fetchAllPages: 404 on page 1 → empty success (no data)', async () => {
  const out = await fetchAllPages(async () => {
    throw new NetafimError('no data', KIND.NO_DATA, 404);
  });
  assert.deepEqual(out.items, []);
  assert.equal(out.rowCount, 0);
  assert.equal(out.pageCount, 0);
  assert.equal(out.pagesFetched, 1);
});

test('fetchAllPages: 404 mid-pagination still throws', async () => {
  let n = 0;
  await assert.rejects(() => fetchAllPages(async () => {
    n++;
    if (n === 1) return netafimPage({ items: [{ id: 'a' }], pageNumber: 1, pageCount: 3 });
    throw new NetafimError('no data', KIND.NO_DATA, 404);
  }));
});

test('fetchAllPages: onPageFetched fires once per page with meta', async () => {
  const meta = [];
  await fetchAllPages(
    async (n) => netafimPage({ items: [{ id: n }], pageNumber: n, pageCount: 2 }),
    { onPageFetched: (m) => meta.push(m) },
  );
  assert.deepEqual(meta, [
    { pageNumber: 1, pageCount: 2, items: 1 },
    { pageNumber: 2, pageCount: 2, items: 1 },
  ]);
});

test('fetchAllPages: respects maxPages cap', async () => {
  const out = await fetchAllPages(
    async (n) => netafimPage({ items: [{ id: n }], pageNumber: n, pageCount: 10 }),
    { maxPages: 2 },
  );
  assert.equal(out.pagesFetched, 2);
  assert.equal(out.items.length, 2);
});

test('HARD_PAGE_CAP is reasonable', () => {
  assert.ok(HARD_PAGE_CAP >= 10);
  assert.ok(HARD_PAGE_CAP <= 200);
});
