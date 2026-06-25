'use strict';
// @ts-check

/**
 * scanAttachment.js — Backend helpers for the UNIFIED scan/attachment flow
 * (factures + BL + BDC), client-direct upload model.
 *
 * Responsibilities (impure, but isolated here):
 *   - generateSignedUrl(bucket, path): V4 signed read URL (fixes cause C — no
 *     public ACL; 403 on display). Falls back to the gs://-style public URL
 *     only if signing is unavailable (best effort).
 *   - extractPdfText(buffer): pdf-parse v2 API (fixes cause B — pdfParse(buffer)
 *     is no longer a function; v2 = new PDFParse({data}).getText()).
 *
 * The PURE mapping/validation logic lives in
 * ../../public/lib/scanAttachmentUtils.js (shared with the frontend + node:test).
 */

const path = require('path');

// Pure helpers shared with the frontend (UMD module).
const utils = require(path.join(__dirname, '../../../public/lib/scanAttachmentUtils.js'));

/** Default validity window for signed read URLs (7 days). */
const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generates a V4 signed read URL for an object already present in the bucket.
 * @param {import('@google-cloud/storage').Bucket} bucket
 * @param {string} scanPath - object path inside the bucket.
 * @param {number} [ttlMs] - validity window in ms (default 7 days).
 * @returns {Promise<string|null>} the signed URL, or null on failure.
 */
async function generateSignedUrl(bucket, scanPath, ttlMs) {
  if (!bucket || !scanPath) return null;
  try {
    const [url] = await bucket.file(scanPath).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + (ttlMs || SIGNED_URL_TTL_MS),
    });
    return url;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('generateSignedUrl error for', scanPath, e && e.message);
    return null;
  }
}

/**
 * Extracts text from a PDF buffer using the pdf-parse v2 API.
 * Returns '' on any failure (callers fall back to sending the doc to Claude).
 * @param {Buffer} buffer
 * @returns {Promise<string>}
 */
async function extractPdfText(buffer) {
  if (!buffer || !buffer.length) return '';
  try {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    if (parser.destroy) {
      try { await parser.destroy(); } catch (_) { /* ignore */ }
    }
    return (result && result.text) || '';
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('extractPdfText (pdf-parse v2) error:', e && e.message);
    return '';
  }
}

/**
 * Downloads an object from the bucket and returns it as a Buffer (used to feed
 * the AI analysis from Storage instead of the client base64 payload).
 * @param {import('@google-cloud/storage').Bucket} bucket
 * @param {string} scanPath
 * @returns {Promise<Buffer|null>}
 */
async function downloadBuffer(bucket, scanPath) {
  if (!bucket || !scanPath) return null;
  try {
    const [buf] = await bucket.file(scanPath).download();
    return buf;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('downloadBuffer error for', scanPath, e && e.message);
    return null;
  }
}

module.exports = {
  SIGNED_URL_TTL_MS,
  generateSignedUrl,
  extractPdfText,
  downloadBuffer,
  // re-export pure utils for convenience
  utils,
};
