const test = require('node:test');
const assert = require('node:assert/strict');

const { isAllowedOrigin } = require('../cors');

test('isAllowedOrigin: prod web.app → true', () => {
  assert.equal(isAllowedOrigin('https://berrygood-farms-dashboard.web.app'), true);
});

test('isAllowedOrigin: prod firebaseapp.com → true', () => {
  assert.equal(isAllowedOrigin('https://berrygood-farms-dashboard.firebaseapp.com'), true);
});

test('isAllowedOrigin: preview channel web.app → true', () => {
  assert.equal(isAllowedOrigin('https://berrygood-farms-dashboard--qa-meteoblue-abc123.web.app'), true);
});

test('isAllowedOrigin: preview channel firebaseapp.com → true', () => {
  assert.equal(isAllowedOrigin('https://berrygood-farms-dashboard--qa-test-xyz789.firebaseapp.com'), true);
});

test('isAllowedOrigin: localhost:8088 → true', () => {
  assert.equal(isAllowedOrigin('http://localhost:8088'), true);
});

test('isAllowedOrigin: localhost:5000 → true', () => {
  assert.equal(isAllowedOrigin('http://localhost:5000'), true);
});

test('isAllowedOrigin: arbitrary origin → false', () => {
  assert.equal(isAllowedOrigin('https://evil.com'), false);
});

test('isAllowedOrigin: spoofed subdomain (suffix match attempt) → false', () => {
  assert.equal(isAllowedOrigin('https://berrygood-farms-dashboard.web.app.evil.com'), false);
  assert.equal(isAllowedOrigin('https://berrygood-farms-dashboard.evil.com'), false);
  assert.equal(isAllowedOrigin('https://evilberrygood-farms-dashboard.web.app'), false);
});

test('isAllowedOrigin: no origin (undefined/null/empty) → false', () => {
  assert.equal(isAllowedOrigin(undefined), false);
  assert.equal(isAllowedOrigin(null), false);
  assert.equal(isAllowedOrigin(''), false);
});
