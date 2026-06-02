// @ts-check
'use strict';

/**
 * forecastConfirmation.js — pure parser for the WhatsApp forecast-upload
 * confirmation step.
 *
 * After the DG bot extracts a Driscoll's slide it asks the user to confirm
 * before persisting. This maps the user's free-text reply to an intent.
 * No I/O, no Firebase — unit-testable in isolation.
 */

/** Tokens that mean "save it". @type {string[]} */
const CONFIRM = [
  'oui', 'ouais', 'ok', 'okay', 'yes', 'y', 'valider', 'valide',
  'enregistrer', 'enregistre', 'confirmer', 'confirme', 'go', 'vasy', 'daccord',
];

/** Tokens that mean "discard it". @type {string[]} */
const CANCEL = [
  'non', 'no', 'n', 'annuler', 'annule', 'stop', 'cancel', 'abandonner', 'abandon',
];

/**
 * Lowercase, strip accents and punctuation, collapse whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/['’`]/g, '') // drop apostrophes so "d'accord" → "daccord"
    .replace(/[^a-z0-9\s]/g, ' ') // drop remaining punctuation & emoji
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Map a user reply to a forecast-confirmation intent.
 * Only short replies are treated as confirm/cancel — a longer message is a
 * real question and should fall through to the agent ('unknown').
 * @param {string} text — raw user reply
 * @returns {'confirm'|'cancel'|'unknown'}
 */
function parseForecastConfirmation(text) {
  const raw = String(text || '');
  // Thumbs-up / check → confirm ; thumbs-down / cross → cancel.
  if (/[\u{1F44D}✅]/u.test(raw)) return 'confirm';
  if (/[\u{1F44E}❌]/u.test(raw)) return 'cancel';

  const norm = normalize(raw);
  if (!norm) return 'unknown';

  const words = norm.split(' ');
  if (words.length > 4) return 'unknown';

  const hasConfirm = words.some((w) => CONFIRM.includes(w));
  const hasCancel = words.some((w) => CANCEL.includes(w));
  if (hasConfirm && !hasCancel) return 'confirm';
  if (hasCancel && !hasConfirm) return 'cancel';
  return 'unknown';
}

module.exports = { parseForecastConfirmation }
