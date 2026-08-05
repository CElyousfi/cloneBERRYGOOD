'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { STOCK_FILE_ALLOWED_MIME, STOCK_FILE_ALLOWED_FORMATS_LABEL } = require('../allowedMime');
const { ALLOWED_ATTACHMENT_MIME } = require('../../stock/scanAttachment');

test('STOCK_FILE_ALLOWED_MIME includes xlsx/xls/csv MIME types', () => {
  assert.equal(STOCK_FILE_ALLOWED_MIME['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], true);
  assert.equal(STOCK_FILE_ALLOWED_MIME['application/vnd.ms-excel'], true);
  assert.equal(STOCK_FILE_ALLOWED_MIME['text/csv'], true);
  assert.equal(STOCK_FILE_ALLOWED_MIME['application/csv'], true);
});

test('STOCK_FILE_ALLOWED_MIME still includes the default PDF/image fallback set', () => {
  Object.keys(ALLOWED_ATTACHMENT_MIME).forEach((mime) => {
    assert.equal(STOCK_FILE_ALLOWED_MIME[mime], true, mime + ' should still be allowed for stock files');
  });
});

test('STOCK_FILE_ALLOWED_MIME does not mutate/extend the shared default allowlist', () => {
  // ALLOWED_ATTACHMENT_MIME (shared with BDC/factures/BL scans) must stay
  // PDF/image only — the stock-file allowlist is a SEPARATE object.
  assert.equal(ALLOWED_ATTACHMENT_MIME['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], undefined);
  assert.equal(ALLOWED_ATTACHMENT_MIME['text/csv'], undefined);
});

test('STOCK_FILE_ALLOWED_FORMATS_LABEL is a non-empty descriptive string', () => {
  assert.equal(typeof STOCK_FILE_ALLOWED_FORMATS_LABEL, 'string');
  assert.match(STOCK_FILE_ALLOWED_FORMATS_LABEL, /Excel/);
  assert.match(STOCK_FILE_ALLOWED_FORMATS_LABEL, /CSV/);
});
