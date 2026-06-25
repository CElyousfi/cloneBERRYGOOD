'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  isValidEntityType,
  collectionForEntity,
  folderForEntity,
  extOf,
  sanitizeFilename,
  buildScanPath,
  isScanPathForEntity,
  validateUploadAttachmentParams,
} = require('../../public/lib/scanAttachmentUtils.js');

test('isValidEntityType accepts the 3 canonical types only', () => {
  assert.strictEqual(isValidEntityType('invoices'), true);
  assert.strictEqual(isValidEntityType('delivery_notes'), true);
  assert.strictEqual(isValidEntityType('purchase_orders'), true);
  assert.strictEqual(isValidEntityType('factures'), false);
  assert.strictEqual(isValidEntityType(''), false);
  assert.strictEqual(isValidEntityType(undefined), false);
  assert.strictEqual(isValidEntityType('__proto__'), false);
});

test('collectionForEntity maps to Firestore collections', () => {
  assert.strictEqual(collectionForEntity('invoices'), 'invoices');
  assert.strictEqual(collectionForEntity('delivery_notes'), 'delivery_notes');
  assert.strictEqual(collectionForEntity('purchase_orders'), 'purchase_orders');
  assert.strictEqual(collectionForEntity('bogus'), null);
});

test('folderForEntity maps to storage folders', () => {
  assert.strictEqual(folderForEntity('invoices'), 'invoices');
  assert.strictEqual(folderForEntity('delivery_notes'), 'delivery_notes');
  assert.strictEqual(folderForEntity('purchase_orders'), 'purchase_orders');
  assert.strictEqual(folderForEntity('x'), null);
});

test('extOf returns lowercase extension, default pdf', () => {
  assert.strictEqual(extOf('facture.PDF'), 'pdf');
  assert.strictEqual(extOf('photo.JPG'), 'jpg');
  assert.strictEqual(extOf('noext'), 'pdf');
  assert.strictEqual(extOf(''), 'pdf');
  assert.strictEqual(extOf(undefined), 'pdf');
});

test('sanitizeFilename strips unicode/spaces/paths', () => {
  assert.strictEqual(sanitizeFilename('Facture été 2026.pdf'), 'Facture_t_2026.pdf');
  assert.strictEqual(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.strictEqual(sanitizeFilename('a/b/c.png'), 'c.png');
  assert.strictEqual(sanitizeFilename(''), 'scan.pdf');
  assert.strictEqual(sanitizeFilename(undefined), 'scan.pdf');
  assert.strictEqual(sanitizeFilename('clean-name_1.jpg'), 'clean-name_1.jpg');
});

test('buildScanPath builds scans/<folder>/<ts>_<file>', () => {
  assert.strictEqual(
    buildScanPath('invoices', 'fac.pdf', 1700000000000),
    'scans/invoices/1700000000000_fac.pdf'
  );
  assert.strictEqual(
    buildScanPath('delivery_notes', 'bl.jpg', 1700000000000),
    'scans/delivery_notes/1700000000000_bl.jpg'
  );
  assert.strictEqual(
    buildScanPath('purchase_orders', 'bon de commande.pdf', 1700000000000),
    'scans/purchase_orders/1700000000000_bon_de_commande.pdf'
  );
});

test('buildScanPath throws on bad entity_type', () => {
  assert.throws(() => buildScanPath('nope', 'x.pdf', 1), /entity_type invalide/);
});

test('buildScanPath uses Date.now() when ts omitted', () => {
  const p = buildScanPath('invoices', 'a.pdf');
  assert.match(p, /^scans\/invoices\/\d+_a\.pdf$/);
});

test('isScanPathForEntity validates namespace + rejects traversal', () => {
  assert.strictEqual(isScanPathForEntity('invoices', 'scans/invoices/123_a.pdf'), true);
  assert.strictEqual(isScanPathForEntity('invoices', 'scans/delivery_notes/123_a.pdf'), false);
  assert.strictEqual(isScanPathForEntity('invoices', 'scans/invoices/'), false);
  assert.strictEqual(isScanPathForEntity('invoices', 'scans/invoices/../bdc_pdfs/x'), false);
  assert.strictEqual(isScanPathForEntity('purchase_orders', 'scans/purchase_orders/9_b.png'), true);
  assert.strictEqual(isScanPathForEntity('bogus', 'scans/bogus/x'), false);
});

test('validateUploadAttachmentParams happy path', () => {
  const r = validateUploadAttachmentParams({
    entity_type: 'invoices',
    entity_id: 'doc123',
    scan_path: 'scans/invoices/1_a.pdf',
    filename: 'a.pdf',
  });
  assert.deepStrictEqual(r, { valid: true });
});

test('validateUploadAttachmentParams rejects bad entity_type', () => {
  const r = validateUploadAttachmentParams({ entity_type: 'x', entity_id: 'd', scan_path: 'scans/x/1_a.pdf' });
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /entity_type/);
});

test('validateUploadAttachmentParams requires entity_id', () => {
  const r = validateUploadAttachmentParams({ entity_type: 'invoices', entity_id: '', scan_path: 'scans/invoices/1_a.pdf' });
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /entity_id/);
});

test('validateUploadAttachmentParams requires scan_path', () => {
  const r = validateUploadAttachmentParams({ entity_type: 'invoices', entity_id: 'd', scan_path: '' });
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /scan_path requis/);
});

test('validateUploadAttachmentParams rejects path outside namespace', () => {
  const r = validateUploadAttachmentParams({
    entity_type: 'invoices',
    entity_id: 'd',
    scan_path: 'scans/delivery_notes/1_a.pdf',
  });
  assert.strictEqual(r.valid, false);
  assert.match(r.error, /namespace/);
});
