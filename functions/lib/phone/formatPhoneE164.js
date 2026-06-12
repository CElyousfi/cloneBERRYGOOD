'use strict';
// @ts-check

/**
 * Normalize a Moroccan phone number to E.164 format (+212...).
 * Handles: 06xx, 07xx, +212xx, 212xx, 00212xx
 *
 * Pure module (no Firebase / no I/O) so it can be reused from both the
 * WhatsApp service and pure unit-tested helpers.
 *
 * @param {string|null|undefined} phone
 * @returns {string|null} E.164 string (e.g. "+2126...") or null if invalid.
 */
function formatPhoneE164(phone) {
  if (!phone) return null;
  // Strip whitespace, separators, et caractères Unicode invisibles
  // (zero-width U+200B-U+200D, BIDI marks U+200E-U+200F + U+202A-U+202E,
  // Arabic letter mark U+061C, word joiner U+2060, BOM U+FEFF) qu'iOS/macOS
  // ou claviers arabes injectent autour des numéros copiés-collés.
  let cleaned = phone.replace(/[\s\-.()؜​-‏‪-‮⁠﻿]/g, "");
  // Remove leading 00
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  // Add + if starts with 212
  if (cleaned.startsWith("212") && !cleaned.startsWith("+")) cleaned = "+" + cleaned;
  // Convert local 0x to +212x
  if (cleaned.startsWith("0") && !cleaned.startsWith("+")) {
    cleaned = "+212" + cleaned.slice(1);
  }
  // Validate basic format
  if (!cleaned.startsWith("+212") || cleaned.length < 13) return null;
  return cleaned;
}

module.exports = { formatPhoneE164 };
