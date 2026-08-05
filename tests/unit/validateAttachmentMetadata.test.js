'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  validateAttachmentMetadata,
  MAX_ATTACHMENT_BYTES,
} = require('../../functions/lib/stock/scanAttachment.js');
const { STOCK_FILE_ALLOWED_MIME } = require('../../functions/lib/stockFiles/allowedMime.js');

const MB = 1024 * 1024;

test('accepts a PDF below 25 MB', () => {
  const r = validateAttachmentMetadata({ size: 2 * MB, contentType: 'application/pdf' });
  assert.strictEqual(r.valid, true);
});

test('accepts the allowed image MIME types below 25 MB', () => {
  ['image/jpeg', 'image/png', 'image/webp', 'image/heic'].forEach((ct) => {
    const r = validateAttachmentMetadata({ size: 1 * MB, contentType: ct });
    assert.strictEqual(r.valid, true, ct + ' should be accepted');
  });
});

test('accepts a contentType with charset/params suffix', () => {
  const r = validateAttachmentMetadata({ size: 1 * MB, contentType: 'application/pdf; charset=binary' });
  assert.strictEqual(r.valid, true);
});

test('accepts size given as a numeric string (Storage metadata returns strings)', () => {
  const r = validateAttachmentMetadata({ size: String(3 * MB), contentType: 'image/png' });
  assert.strictEqual(r.valid, true);
});

test('rejects a file at or above 25 MB', () => {
  const r = validateAttachmentMetadata({ size: MAX_ATTACHMENT_BYTES, contentType: 'application/pdf' });
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /25 Mo/);
});

test('rejects a disallowed MIME type', () => {
  const r = validateAttachmentMetadata({ size: 1 * MB, contentType: 'application/octet-stream' });
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /non autorisé/);
});

test('rejects gif (not in the allowed set even if image)', () => {
  const r = validateAttachmentMetadata({ size: 1 * MB, contentType: 'image/gif' });
  assert.strictEqual(r.valid, false);
});

test('rejects missing / indeterminate size', () => {
  assert.strictEqual(validateAttachmentMetadata({ contentType: 'application/pdf' }).valid, false);
  assert.strictEqual(validateAttachmentMetadata({ size: 0, contentType: 'application/pdf' }).valid, false);
  assert.strictEqual(validateAttachmentMetadata({ size: 'abc', contentType: 'application/pdf' }).valid, false);
});

test('rejects missing contentType', () => {
  const r = validateAttachmentMetadata({ size: 1 * MB });
  assert.strictEqual(r.valid, false);
});

test('handles null / undefined input without throwing', () => {
  assert.strictEqual(validateAttachmentMetadata(null).valid, false);
  assert.strictEqual(validateAttachmentMetadata(undefined).valid, false);
});

test('default allowlist still rejects xlsx (non-regression: BDC/factures/BL scans stay PDF/image only)', () => {
  const r = validateAttachmentMetadata({
    size: 1 * MB,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /non autorisé/);
});

test('custom allowlist (STOCK_FILE_ALLOWED_MIME) accepts xlsx/xls/csv', () => {
  const cases = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
    'application/vnd.ms-excel', // xls / csv (Windows)
    'text/csv',
    'application/csv',
  ];
  cases.forEach((ct) => {
    const r = validateAttachmentMetadata({ size: 1 * MB, contentType: ct }, STOCK_FILE_ALLOWED_MIME);
    assert.strictEqual(r.valid, true, ct + ' should be accepted with STOCK_FILE_ALLOWED_MIME');
  });
});

test('custom allowlist (STOCK_FILE_ALLOWED_MIME) still accepts PDF/image fallback formats', () => {
  ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'].forEach((ct) => {
    const r = validateAttachmentMetadata({ size: 1 * MB, contentType: ct }, STOCK_FILE_ALLOWED_MIME);
    assert.strictEqual(r.valid, true, ct + ' should be accepted with STOCK_FILE_ALLOWED_MIME');
  });
});

test('custom allowlist (STOCK_FILE_ALLOWED_MIME) rejects a type outside the list', () => {
  const r = validateAttachmentMetadata({ size: 1 * MB, contentType: 'application/octet-stream' }, STOCK_FILE_ALLOWED_MIME);
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /non autorisé/);
});

test('custom allowlist error message does not claim "PDF ou image uniquement" (misleading for stock files)', () => {
  const r = validateAttachmentMetadata({ size: 1 * MB, contentType: 'application/octet-stream' }, STOCK_FILE_ALLOWED_MIME);
  assert.strictEqual(r.valid, false);
  assert.doesNotMatch(r.error, /PDF ou image uniquement/);
});
