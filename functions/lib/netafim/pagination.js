// @ts-check
'use strict';

/**
 * Drains a paginated GrowSphere V3 endpoint by walking pageNumber 1..N
 * sequentially (the API has no cursor; rowCount/pageCount are reported
 * on the first response).
 *
 * Each page fetch counts against the daily quota, so we expose an
 * `onPageFetched` hook for the caller's rate limiter / cursor doc.
 */

const { NetafimError, KIND } = require('./client');

const HARD_PAGE_CAP = 50; // defensive ceiling: BAHIA daily volume is far below

/**
 * @param {(pageNumber: number) => Promise<import('./types').NetafimPage>} fetchPageFn
 * @param {Object} [opts]
 * @param {number} [opts.maxPages]
 * @param {(meta: {pageNumber: number, pageCount: number, items: number}) => void} [opts.onPageFetched]
 * @returns {Promise<{items: Array<any>, pagesFetched: number, rowCount: number, pageCount: number}>}
 */
async function fetchAllPages(fetchPageFn, opts) {
  if (typeof fetchPageFn !== 'function') {
    throw new Error('fetchAllPages: fetchPageFn must be a function');
  }
  const options = opts || {};
  const cap = Number.isFinite(options.maxPages) ? Math.max(1, options.maxPages) : HARD_PAGE_CAP;
  const onPageFetched = options.onPageFetched || (() => {});

  /** @type {Array<any>} */
  const items = [];
  let pagesFetched = 0;
  let pageCount = 1;
  let rowCount = 0;
  let pageNumber = 1;

  while (pageNumber <= pageCount && pagesFetched < cap) {
    let page;
    try {
      page = await fetchPageFn(pageNumber);
    } catch (err) {
      // 404 on the first page = "no data in window" — treat as empty success.
      if (pageNumber === 1 && err instanceof NetafimError && err.kind === KIND.NO_DATA) {
        return { items: [], pagesFetched: 1, rowCount: 0, pageCount: 0 };
      }
      throw err;
    }
    pagesFetched++;
    if (page && Array.isArray(page.items)) {
      for (const it of page.items) items.push(it);
    }
    if (page && Number.isFinite(page.pageCount)) pageCount = page.pageCount;
    if (page && Number.isFinite(page.rowCount)) rowCount = page.rowCount;
    onPageFetched({
      pageNumber,
      pageCount,
      items: page && Array.isArray(page.items) ? page.items.length : 0,
    });
    pageNumber++;
  }

  return { items, pagesFetched, rowCount, pageCount };
}

module.exports = {
  HARD_PAGE_CAP,
  fetchAllPages,
};
