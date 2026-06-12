'use strict';

// @ts-check

/**
 * Pure helpers for the admin side of bug reports (Phase B).
 * Aucune I/O — testables en isolation (node:test).
 */

// Statuts cibles autorisés pour une transition manuelle (vue admin).
// 'nouveau' (par défaut à la création), 'qualified' (posé par le triage IA),
// et 'new' (alias toléré historiquement) ne sont PAS des cibles manuelles.
const BUG_STATUSES = ['nouveau', 'en_cours', 'resolu'];

// Statuts pouvant exister sur un doc et donc filtrables côté liste admin.
// Inclut 'qualified' (posé automatiquement par le trigger de triage IA).
const FILTERABLE_STATUSES = ['nouveau', 'qualified', 'en_cours', 'resolu'];

// Profils autorisés à consulter / modifier les signalements (vue admin).
// resp RH = profil 'rh' dans cette codebase (cf. NAV_ITEMS_RH).
const ADMIN_PROFILES = ['dg', 'rh'];

/**
 * Vérifie qu'un statut cible est valide.
 * @param {any} status
 * @returns {boolean}
 */
function isValidStatus(status) {
  return typeof status === 'string' && BUG_STATUSES.indexOf(status) >= 0;
}

/**
 * Vérifie qu'un statut peut servir de filtre côté liste admin
 * (inclut 'qualified', posé par le triage IA).
 * @param {any} status
 * @returns {boolean}
 */
function isFilterableStatus(status) {
  return typeof status === 'string' && FILTERABLE_STATUSES.indexOf(status) >= 0;
}

/**
 * Vérifie qu'un profileId a accès à la vue admin des bugs.
 * @param {any} profileId
 * @returns {boolean}
 */
function isAdminProfile(profileId) {
  return typeof profileId === 'string' && ADMIN_PROFILES.indexOf(profileId) >= 0;
}

/**
 * Valide une demande de changement de statut.
 * @param {{id?: any, status?: any}} body
 * @returns {{valid: boolean, error?: string, id?: string, status?: string}}
 */
function validateStatusUpdate(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Corps de requête invalide' };
  }
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) {
    return { valid: false, error: "L'identifiant du signalement est obligatoire" };
  }
  if (!isValidStatus(body.status)) {
    return { valid: false, error: 'Statut invalide (attendu : ' + BUG_STATUSES.join(', ') + ')' };
  }
  return { valid: true, id: id, status: body.status };
}

/**
 * Trie une liste de signalements par created_at décroissant (plus récent en premier).
 * Tolère created_at en Firestore Timestamp (toMillis), Date, number ou absent.
 * @param {Array<Object>} reports
 * @returns {Array<Object>}
 */
function sortReportsByCreatedDesc(reports) {
  if (!Array.isArray(reports)) return [];
  const toMillis = (r) => {
    const c = r && r.created_at;
    if (!c) return 0;
    if (typeof c.toMillis === 'function') return c.toMillis();
    if (c instanceof Date) return c.getTime();
    if (typeof c === 'number') return c;
    if (typeof c.seconds === 'number') return c.seconds * 1000;
    return 0;
  };
  return reports.slice().sort((a, b) => toMillis(b) - toMillis(a));
}

module.exports = {
  BUG_STATUSES,
  FILTERABLE_STATUSES,
  ADMIN_PROFILES,
  isValidStatus,
  isFilterableStatus,
  isAdminProfile,
  validateStatusUpdate,
  sortReportsByCreatedDesc,
}
