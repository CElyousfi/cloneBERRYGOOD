'use strict';
// @ts-check

/**
 * allowedMime.js — Allowlist MIME dédiée aux fichiers stock (onglet
 * magasinier + bot WhatsApp `magasinierBot.js`).
 *
 * MISE À JOUR 2026-08-05 (confirmé par Omar) : les fichiers stock réels sont
 * des classeurs Excel (.xlsx/.xls) ou CSV — PAS des PDF/image. On garde
 * cependant PDF/JPEG/PNG/WEBP/HEIC en secours (photo d'un relevé papier).
 *
 * Ne PAS étendre `ALLOWED_ATTACHMENT_MIME` (functions/lib/stock/scanAttachment.js)
 * — cette constante est partagée avec les scans BDC/factures/BL, qui doivent
 * rester PDF/image uniquement (spec docs/spec-collecte-stock-magasinier.md §4.1).
 */

/**
 * MIME types acceptés pour un fichier stock déposé par le magasinier.
 * @type {Record<string, true>}
 */
const STOCK_FILE_ALLOWED_MIME = {
  // Classeurs Excel / CSV — format réel des fichiers stock (prioritaire).
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': true, // .xlsx
  'application/vnd.ms-excel': true, // .xls (et .csv exporté depuis Excel Windows)
  'text/csv': true,
  'application/csv': true,
  // Secours : photo du relevé papier.
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
  'image/heic': true,
};

/**
 * Message d'aide listant les formats acceptés, utilisé dans les réponses
 * d'erreur (app + WhatsApp) — cohérent avec `STOCK_FILE_ALLOWED_MIME`.
 * @type {string}
 */
const STOCK_FILE_ALLOWED_FORMATS_LABEL = 'Excel (.xlsx/.xls), CSV, PDF ou image (JPG/PNG/WEBP/HEIC)';

module.exports = {
  STOCK_FILE_ALLOWED_MIME,
  STOCK_FILE_ALLOWED_FORMATS_LABEL,
};
