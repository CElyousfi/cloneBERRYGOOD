'use strict';

// @ts-check

/**
 * Pure validation for the bug-report submit payload.
 * Aucune I/O — testable en isolation (node:test).
 */

const MAX_DESCRIPTION = 5000;
// ~7 Mo de base64 ≈ 5 Mo de binaire. Garde-fou contre les payloads géants.
const MAX_PHOTO_BASE64_CHARS = 7 * 1024 * 1024;

/**
 * @param {{description?: any, photoBase64?: any}} body
 * @returns {{valid: boolean, error?: string, description?: string, hasPhoto?: boolean}}
 */
function validateBugReport(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Corps de requête invalide' };
  }

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) {
    return { valid: false, error: 'La description est obligatoire' };
  }
  if (description.length > MAX_DESCRIPTION) {
    return { valid: false, error: 'Description trop longue (max ' + MAX_DESCRIPTION + ' caractères)' };
  }

  const photoBase64 = body.photoBase64;
  let hasPhoto = false;
  if (photoBase64 !== undefined && photoBase64 !== null && photoBase64 !== '') {
    if (typeof photoBase64 !== 'string') {
      return { valid: false, error: 'photoBase64 doit être une chaîne' };
    }
    if (photoBase64.length > MAX_PHOTO_BASE64_CHARS) {
      return { valid: false, error: 'Image trop volumineuse' };
    }
    hasPhoto = true;
  }

  return { valid: true, description: description, hasPhoto: hasPhoto };
}

module.exports = { validateBugReport, MAX_DESCRIPTION, MAX_PHOTO_BASE64_CHARS }
