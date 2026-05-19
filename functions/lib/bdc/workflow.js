/**
 * bdcWorkflow.js — Pure helpers for Bon de Commande (BdC) routing.
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/bdcWorkflow.js"> → exposes window.BdcWorkflow
 *   - In node:test via require('./bdcWorkflow.js') → exposes module.exports
 *
 * Backend mirrors this file at functions/lib/bdc/workflow.js (byte-identical).
 * If you edit one, edit the other. Build sentinel in scripts/build-frontend.js
 * checks the public copy contains DIRECT_DG_FARMS.
 *
 * Business rule (2026-05): for fermes without a chef de ferme, BdC submission
 * skips the chef validation step and goes directly to DG.
 */
// @ts-check
'use strict';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Fermes that have no chef de ferme — BdC for these fermes go directly to DG.
 * chef_avo is rattaché à Avocatier + F2 + F3 + F4 + F6 + BAHIA mais
 * n'est pas un point de passage pour les BdC (décision business 2026-05).
 */
const DIRECT_DG_FARMS = ['Avocatier', 'F2', 'F3', 'F4', 'F6', 'BAHIA'];

const DIRECT_DG_FARMS_NORMALIZED = new Set(
  DIRECT_DG_FARMS.map(function (s) { return s.toUpperCase(); })
);

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Returns true if a BdC for this ferme must pass through the chef de ferme.
 * Case-insensitive and whitespace-tolerant. Fail-safe: unknown/invalid input
 * returns true (keep the chef step rather than silently bypass).
 *
 * @param {string} ferme
 * @returns {boolean}
 */
function requiresChefValidation(ferme) {
  if (!ferme || typeof ferme !== 'string') return true;
  return !DIRECT_DG_FARMS_NORMALIZED.has(ferme.trim().toUpperCase());
}

/**
 * Target status for submit-bdc based on the ferme.
 *
 * @param {string} ferme
 * @returns {'en_attente_chef' | 'en_attente_dg'}
 */
function nextStatusOnSubmit(ferme) {
  return requiresChefValidation(ferme) ? 'en_attente_chef' : 'en_attente_dg';
}

/**
 * Reason code stored in history when the chef step is skipped.
 *
 * @param {string} ferme
 * @returns {string | null}
 */
function bypassReason(ferme) {
  return requiresChefValidation(ferme) ? null : 'no_chef_de_ferme';
}

// ============================================================================
// UMD-style export (browser global + CommonJS for node:test / backend)
// ============================================================================

const __bdcWorkflowApi = {
  DIRECT_DG_FARMS,
  requiresChefValidation,
  nextStatusOnSubmit,
  bypassReason,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __bdcWorkflowApi;
if (typeof window !== 'undefined') window.BdcWorkflow = __bdcWorkflowApi;
