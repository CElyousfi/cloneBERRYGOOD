'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  joinUrl,
  toIso,
  fetchIrrigationLogsPage,
  fetchAccumulationEventsPage,
  PATH_IRRIGATION_LOGS,
  PATH_ACCUMULATION_EVENTS,
} = require('../endpoints');

function jsonRes(status, bodyObj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(bodyObj); },
  };
}

test('joinUrl: handles trailing/leading slashes', () => {
  assert.equal(joinUrl('https://x.io', '/p'), 'https://x.io/p');
  assert.equal(joinUrl('https://x.io/', '/p'), 'https://x.io/p');
  assert.equal(joinUrl('https://x.io', 'p'), 'https://x.io/p');
});

test('toIso: round-trips Date and string', () => {
  assert.equal(toIso(new Date('2024-07-01T08:00:00Z')), '2024-07-01T08:00:00.000Z');
  assert.equal(toIso('2024-07-01T08:00:00Z'), '2024-07-01T08:00:00.000Z');
});

test('fetchIrrigationLogsPage: posts to the documented path with correct body', async () => {
  let seen = null;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return jsonRes(200, { items: [] }); };
  await fetchIrrigationLogsPage({
    token: 'TKN',
    dateFrom: '2024-07-01T00:00:00Z',
    dateTo: '2024-07-08T00:00:00Z',
    pageNumber: 1,
    baseUrl: 'https://apim.netafim.com',
    fetch: fetchImpl,
  });
  assert.equal(seen.url, 'https://apim.netafim.com' + PATH_IRRIGATION_LOGS);
  assert.equal(seen.opts.headers.Authorization, 'Bearer TKN');
  const body = JSON.parse(seen.opts.body);
  assert.equal(body.startTimestampFrom, '2024-07-01T00:00:00.000Z');
  assert.equal(body.startTimestampTo, '2024-07-08T00:00:00.000Z');
  assert.equal(body.pageNumber, 1);
});

test('fetchAccumulationEventsPage: posts to the accumulation path', async () => {
  let seen = null;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return jsonRes(200, { items: [] }); };
  await fetchAccumulationEventsPage({
    token: 'TKN',
    dateFrom: '2024-07-01T00:00:00Z',
    dateTo: '2024-07-02T00:00:00Z',
    pageNumber: 2,
    baseUrl: 'https://apim.netafim.com/',
    fetch: fetchImpl,
  });
  assert.equal(seen.url, 'https://apim.netafim.com' + PATH_ACCUMULATION_EVENTS);
  assert.equal(JSON.parse(seen.opts.body).pageNumber, 2);
});
