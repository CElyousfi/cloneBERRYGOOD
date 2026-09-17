/**
 * scanAttachmentUtils.js — Pure helpers for the UNIFIED scan/attachment feature
 * (factures + BL + BDC), client-direct upload model.
 *
 * All functions are PURE (no DOM, no network, no Firestore, no Storage). They
 * implement the cross-cutting logic shared by the frontend uploader and the
 * `upload-attachment` Cloud Function action:
 *   - entity_type ∈ { invoices, delivery_notes, purchase_orders } → Firestore
 *     collection + storage sub-folder.
 *   - construction of the storage path scans/<folder>/<ts>_<safeFilename>.
 *   - validation of the upload-attachment request params.
 *
 * 2026-06 — initial creation (brique scan unifiée, client-direct upload).
 */
// @ts-check

// ============================================================================
// CONSTANTS / MAPPINGS
// ============================================================================

/**
 * Canonical entity types accepted by the unified attachment flow.
 * Each maps to its Firestore collection and its storage sub-folder.
 * @type {Record<string, { collection: string, folder: string }>}
 */
const ENTITY_MAP = {
  invoices: { collection: 'invoices', folder: 'invoices' },
  delivery_notes: { collection: 'delivery_notes', folder: 'delivery_notes' },
  purchase_orders: { collection: 'purchase_orders', folder: 'purchase_orders' },
};

/** Allowed file extensions for a scanned attachment. */
const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'];

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Returns true if `entity_type` is one of the canonical accepted values.
 * @param {string} entityType
 * @returns {boolean}
 */
function isValidEntityType(entityType) {
  return typeof entityType === 'string' && Object.prototype.hasOwnProperty.call(ENTITY_MAP, entityType);
}

/**
 * Maps an entity_type to its Firestore collection name, or null if unknown.
 * @param {string} entityType
 * @returns {string|null}
 */
function collectionForEntity(entityType) {
  return isValidEntityType(entityType) ? ENTITY_MAP[entityType].collection : null;
}

/**
 * Maps an entity_type to its storage sub-folder name, or null if unknown.
 * @param {string} entityType
 * @returns {string|null}
 */
function folderForEntity(entityType) {
  return isValidEntityType(entityType) ? ENTITY_MAP[entityType].folder : null;
}

/**
 * Lowercase extension of a filename (without the dot), defaulting to 'pdf'.
 * @param {string} filename
 * @returns {string}
 */
function extOf(filename) {
  if (typeof filename !== 'string' || filename.indexOf('.') === -1) return '';
  const ext = filename.split('.').pop().toLowerCase().trim();
  return ext;
}

/**
 * Maps a filename extension to its canonical MIME type. Used CLIENT-SIDE to set
 * an explicit contentType at upload time (file.type is empty / octet-stream on
 * mobile), so the stored object carries a reliable contentType that the Cloud
 * Function can enforce against. Unknown extensions fall back to octet-stream
 * (which the CF then rejects).
 * @param {string} filename
 * @returns {string}
 */
function mimeFromFilename(filename) {
  switch (extOf(filename)) {
    case 'pdf': return 'application/pdf';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'webp': return 'image/webp';
    case 'heic': return 'image/heic';
    default: return 'application/octet-stream';
  }
}

/**
 * Sanitizes a filename for use inside a storage path: keeps only ASCII
 * alphanumerics, dot, dash and underscore; collapses everything else to '_'.
 * Empty / non-string input falls back to 'scan.pdf'.
 * @param {string} filename
 * @returns {string}
 */
function sanitizeFilename(filename) {
  if (typeof filename !== 'string' || !filename.trim()) return 'scan.pdf';
  // strip any directory components first (defense against path traversal)
  const base = filename.replace(/^.*[\\/]/, '');
  const safe = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/_+/g, '_');
  return safe || 'scan.pdf';
}

/**
 * Builds the canonical storage path for an attachment:
 *   scans/<folder>/<timestamp>_<safeFilename>
 * @param {string} entityType - one of ENTITY_MAP keys.
 * @param {string} filename - original filename (may contain unicode/spaces).
 * @param {number} [timestamp] - epoch ms; defaults to Date.now().
 * @returns {string} the storage path.
 * @throws {Error} if entityType is unknown.
 */
function buildScanPath(entityType, filename, timestamp) {
  const folder = folderForEntity(entityType);
  if (!folder) throw new Error('entity_type invalide: ' + entityType);
  const ts = typeof timestamp === 'number' && isFinite(timestamp) ? timestamp : Date.now();
  return 'scans/' + folder + '/' + ts + '_' + sanitizeFilename(filename);
}

/**
 * Validates that a given storage path belongs to the scans/<folder>/ namespace
 * for the declared entity_type. Guards the CF against arbitrary path writes
 * coming from a (possibly tampered) client.
 * @param {string} entityType
 * @param {string} scanPath
 * @returns {boolean}
 */
function isScanPathForEntity(entityType, scanPath) {
  const folder = folderForEntity(entityType);
  if (!folder || typeof scanPath !== 'string') return false;
  const prefix = 'scans/' + folder + '/';
  return scanPath.indexOf(prefix) === 0 && scanPath.length > prefix.length && scanPath.indexOf('..') === -1;
}

/**
 * Validates the params of an `upload-attachment` request.
 * @param {{entity_type?: string, entity_id?: string, scan_path?: string, filename?: string}} params
 * @returns {{ valid: boolean, error?: string }}
 */
function validateUploadAttachmentParams(params) {
  const p = params || {};
  if (!isValidEntityType(p.entity_type)) {
    return { valid: false, error: 'entity_type invalide (attendu: invoices | delivery_notes | purchase_orders)' };
  }
  if (typeof p.entity_id !== 'string' || !p.entity_id.trim()) {
    return { valid: false, error: 'entity_id requis' };
  }
  if (typeof p.scan_path !== 'string' || !p.scan_path.trim()) {
    return { valid: false, error: 'scan_path requis' };
  }
  if (!isScanPathForEntity(p.entity_type, p.scan_path)) {
    return { valid: false, error: 'scan_path hors du namespace scans/' + folderForEntity(p.entity_type) + '/' };
  }
  return { valid: true };
}

// ============================================================================
// EXPORT API
// ============================================================================

export { ENTITY_MAP, ALLOWED_EXTENSIONS, isValidEntityType, collectionForEntity, folderForEntity, extOf, mimeFromFilename, sanitizeFilename, buildScanPath, isScanPathForEntity, validateUploadAttachmentParams };
