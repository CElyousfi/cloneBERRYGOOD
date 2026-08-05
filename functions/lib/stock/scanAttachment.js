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
 * The PURE mapping/validation logic lives in ./scanAttachmentUtils.js — a
 * BACKEND COPY of public/lib/scanAttachmentUtils.js. Le backend ne dépend JAMAIS
 * de public/ : le package déployé n'embarque que functions/, donc un require vers
 * public/ throw "Cannot find module" au runtime et casse toutes les fonctions.
 * Duplication assumée (UMD front + CommonJS back), logique pure identique.
 */

// Pure helpers — backend-local copy (see scanAttachmentUtils.js header).
const utils = require('./scanAttachmentUtils');

/** Default validity window for signed read URLs (7 days). */
const SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum accepted attachment size (bytes). */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * MIME types accepted for a scanned attachment. Server-side source of truth:
 * the size/MIME constraints were removed from the Storage rules (unreliable on
 * resumable/mobile uploads) and are now enforced HERE against the real object
 * metadata read back from the bucket.
 * @type {Record<string, true>}
 */
const ALLOWED_ATTACHMENT_MIME = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
  'image/heic': true,
};

/**
 * Human-readable label for the default allowlist, used in the rejection
 * message. Callers passing a custom `allowedMime` (e.g. stock files, which
 * also accept Excel/CSV) get a generic message instead — see
 * `describeAllowedMimeError`.
 */
const DEFAULT_MIME_ERROR_SUFFIX = ' (PDF ou image uniquement)';

/**
 * PURE validation of an uploaded object's metadata (size + contentType).
 * Called by the upload-attachment action AFTER reading the object metadata from
 * Storage, BEFORE writing any link on the target doc. A rejected object is then
 * deleted by the caller so no orphan object/link survives.
 * @param {{size?: number|string, contentType?: string}} meta
 * @param {Record<string, true>} [allowedMime] - MIME allowlist to enforce.
 *   Defaults to `ALLOWED_ATTACHMENT_MIME` (PDF/JPEG/PNG/WEBP/HEIC) — the
 *   contract for every existing caller (BDC/factures/BL scans) is unchanged.
 *   Pass a different allowlist (e.g. `stockFiles`' `STOCK_FILE_ALLOWED_MIME`)
 *   to accept other formats without touching the shared default.
 * @returns {{ valid: boolean, error?: string }}
 */
function validateAttachmentMetadata(meta, allowedMime) {
  const m = meta || {};
  const size = typeof m.size === 'string' ? parseInt(m.size, 10) : m.size;
  if (typeof size !== 'number' || !isFinite(size) || size <= 0) {
    return { valid: false, error: 'Fichier refusé: taille du fichier indéterminée' };
  }
  if (size >= MAX_ATTACHMENT_BYTES) {
    return { valid: false, error: 'Fichier refusé: taille supérieure à 25 Mo' };
  }
  const allowlist = allowedMime || ALLOWED_ATTACHMENT_MIME;
  const isDefaultAllowlist = allowlist === ALLOWED_ATTACHMENT_MIME;
  const contentType = typeof m.contentType === 'string' ? m.contentType.split(';')[0].trim().toLowerCase() : '';
  if (!allowlist[contentType]) {
    const suffix = isDefaultAllowlist ? DEFAULT_MIME_ERROR_SUFFIX : '';
    return { valid: false, error: 'Fichier refusé: type de fichier non autorisé' + suffix };
  }
  return { valid: true };
}

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
  MAX_ATTACHMENT_BYTES,
  ALLOWED_ATTACHMENT_MIME,
  validateAttachmentMetadata,
  generateSignedUrl,
  extractPdfText,
  downloadBuffer,
  // re-export pure utils for convenience
  utils,
};
