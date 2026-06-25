/**
 * scanClientUpload.js — Frontend orchestrator for the CLIENT-DIRECT upload of a
 * scan/attachment (factures + BL + BDC).
 *
 * Loaded as a classic <script src="lib/scanClientUpload.js"> (shares global
 * scope). Exposes a SINGLE unique global: window.ScanClientUpload (anti-collision
 * UMD, cf. React #200 boot crashes). All internal identifiers are locals inside
 * the IIFE.
 *
 * Flow (the file NEVER transits through the Cloud Function → no 10 MB limit):
 *   1. uploadDirect(file, entityType): uploads the File DIRECTLY to Firebase
 *      Storage via the compat SDK at scans/<folder>/<ts>_<safeFilename>.
 *   2. recordAttachment(...): POSTs metadata to /api/stock?action=upload-attachment
 *      (with the Firebase Auth bearer token). The CF writes scan_url/scan_path/…
 *      on the target doc and returns a V4 signed read URL.
 *   3. uploadAndRecord(...): convenience wrapper that chains both.
 *
 * Depends on:
 *   - window.firebase (storage compat SDK) — checked at call time.
 *   - window.firebaseAuth (for the bearer token).
 *   - window.ScanAttachmentUtils (pure path/entity helpers).
 *
 * 2026-06 — initial creation (brique scan unifiée, client-direct upload).
 */
(function () {
  'use strict';

  var SCU_Utils = (typeof window !== 'undefined' && window.ScanAttachmentUtils) || null;

  /**
   * True if the Firebase Storage compat SDK is available.
   * @returns {boolean}
   */
  function isStorageAvailable() {
    return !!(typeof window !== 'undefined' && window.firebase && typeof window.firebase.storage === 'function');
  }

  /**
   * Uploads a File/Blob directly to Firebase Storage.
   * @param {File} file
   * @param {string} entityType - invoices | delivery_notes | purchase_orders
   * @returns {Promise<{ scan_path: string, filename: string }>}
   */
  function uploadDirect(file, entityType) {
    if (!SCU_Utils) return Promise.reject(new Error('ScanAttachmentUtils indisponible'));
    if (!isStorageAvailable()) return Promise.reject(new Error('SDK Firebase Storage non chargé'));
    if (!file) return Promise.reject(new Error('Aucun fichier'));
    if (!SCU_Utils.isValidEntityType(entityType)) return Promise.reject(new Error('entity_type invalide'));

    var filename = file.name || 'scan.pdf';
    var scanPath = SCU_Utils.buildScanPath(entityType, filename, Date.now());
    var ref = window.firebase.storage().ref().child(scanPath);
    return ref.put(file).then(function () {
      return { scan_path: scanPath, filename: filename };
    });
  }

  /**
   * Records the uploaded attachment metadata on the target doc via the CF.
   * @param {Object} args
   * @param {string} args.entity_type
   * @param {string} args.entity_id
   * @param {string} args.scan_path
   * @param {string} args.filename
   * @param {Object} [args.uploaded_by] - { name, profileId }
   * @returns {Promise<{ success: boolean, scan_url?: string, scan_path?: string, error?: string }>}
   */
  function recordAttachment(args) {
    args = args || {};
    var getToken = (typeof window !== 'undefined' && window.firebaseAuth && window.firebaseAuth.currentUser)
      ? window.firebaseAuth.currentUser.getIdToken()
      : Promise.resolve(null);
    return getToken.then(function (token) {
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      return fetch('/api/stock?action=upload-attachment', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          entity_type: args.entity_type,
          entity_id: args.entity_id,
          scan_path: args.scan_path,
          filename: args.filename,
          uploaded_by: args.uploaded_by || {},
        }),
      }).then(function (r) { return r.json(); });
    });
  }

  /**
   * Full flow: upload the file directly, then record the metadata.
   * @param {Object} args
   * @param {File} args.file
   * @param {string} args.entity_type
   * @param {string} args.entity_id
   * @param {Object} [args.uploaded_by]
   * @returns {Promise<{ success: boolean, scan_url?: string, scan_path?: string, error?: string }>}
   */
  function uploadAndRecord(args) {
    args = args || {};
    return uploadDirect(args.file, args.entity_type).then(function (up) {
      return recordAttachment({
        entity_type: args.entity_type,
        entity_id: args.entity_id,
        scan_path: up.scan_path,
        filename: up.filename,
        uploaded_by: args.uploaded_by,
      });
    });
  }

  /**
   * Fetches a fresh V4 signed read URL for an existing attachment.
   * @param {string} entityType
   * @param {string} entityId
   * @returns {Promise<string|null>}
   */
  function getAttachmentUrl(entityType, entityId) {
    var getToken = (typeof window !== 'undefined' && window.firebaseAuth && window.firebaseAuth.currentUser)
      ? window.firebaseAuth.currentUser.getIdToken()
      : Promise.resolve(null);
    return getToken.then(function (token) {
      var headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var url = '/api/stock?action=get-attachment-url&entity_type=' + encodeURIComponent(entityType) +
        '&entity_id=' + encodeURIComponent(entityId);
      return fetch(url, { headers: headers }).then(function (r) { return r.json(); }).then(function (j) {
        return (j && j.success) ? (j.scan_url || null) : null;
      });
    });
  }

  var __scanClientUploadApi = {
    isStorageAvailable: isStorageAvailable,
    uploadDirect: uploadDirect,
    recordAttachment: recordAttachment,
    uploadAndRecord: uploadAndRecord,
    getAttachmentUrl: getAttachmentUrl,
  };

  if (typeof window !== 'undefined') window.ScanClientUpload = __scanClientUploadApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = __scanClientUploadApi;
})();
