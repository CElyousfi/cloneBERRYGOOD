'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { postJson, NetafimError, KIND, classify } = require('../client');

function res(status, bodyObj) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return bodyObj === undefined ? '' : JSON.stringify(bodyObj); },
  };
}

test('postJson: returns parsed body on 200', async () => {
  const fetchImpl = async () => res(200, { items: [], pageCount: 1 });
  const out = await postJson({ url: 'http://x', token: 'T', body: { a: 1 }, fetch: fetchImpl });
  assert.deepEqual(out, { items: [], pageCount: 1 });
});

test('postJson: sends Bearer auth + JSON content-type', async () => {
  let seen = null;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return res(200, {}); };
  await postJson({ url: 'http://x', token: 'TKN', body: { a: 1 }, fetch: fetchImpl });
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers.Authorization, 'Bearer TKN');
  assert.equal(seen.opts.headers['Content-Type'], 'application/json');
  assert.equal(seen.opts.body, JSON.stringify({ a: 1 }));
});

test('postJson: throws NetafimError TOKEN_EXPIRED on 401', async () => {
  const fetchImpl = async () => res(401, { error: 'Access to this API has been disallowed' });
  await assert.rejects(
    () => postJson({ url: 'http://x', token: 'T', body: {}, fetch: fetchImpl }),
    (err) => err instanceof NetafimError && err.kind === KIND.TOKEN_EXPIRED && err.status === 401,
  );
});

test('postJson: throws NetafimError NO_DATA on 404', async () => {
  const fetchImpl = async () => res(404, { message: 'Start timestamp should be less than ...' });
  await assert.rejects(
    () => postJson({ url: 'http://x', token: 'T', body: {}, fetch: fetchImpl }),
    (err) => err.kind === KIND.NO_DATA && err.status === 404,
  );
});

test('postJson: throws PROCESSING on 422', async () => {
  const fetchImpl = async () => res(422, { message: 'bad' });
  await assert.rejects(
    () => postJson({ url: 'http://x', token: 'T', body: {}, fetch: fetchImpl }),
    (err) => err.kind === KIND.PROCESSING,
  );
});

test('postJson: throws SERVER on 500', async () => {
  const fetchImpl = async () => res(500, { message: 'boom' });
  await assert.rejects(
    () => postJson({ url: 'http://x', token: 'T', body: {}, fetch: fetchImpl }),
    (err) => err.kind === KIND.SERVER,
  );
});

test('postJson: requires url + token', async () => {
  await assert.rejects(() => postJson({ token: 'T', body: {}, fetch: async () => res(200, {}) }), /url/);
  await assert.rejects(() => postJson({ url: 'http://x', body: {}, fetch: async () => res(200, {}) }), /token/);
});

test('classify: covers documented statuses', () => {
  assert.equal(classify(401), KIND.TOKEN_EXPIRED);
  assert.equal(classify(404), KIND.NO_DATA);
  assert.equal(classify(422), KIND.PROCESSING);
  assert.equal(classify(500), KIND.SERVER);
  assert.equal(classify(418), KIND.UNKNOWN);
});
