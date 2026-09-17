/**
 * bdcWorkflow.js — Pure helpers for Bon de Commande (BdC) routing.
 *
 * Backend mirrors this file at functions/lib/bdc/workflow.js (byte-identical).
 * If you edit one, edit the other. Build sentinel in scripts/build-frontend.js
 * checks the public copy contains DIRECT_DG_FARMS.
 *
 * Business rules:
 *   - 2026-05: for fermes without a chef de ferme, BdC submission skips the
 *     chef validation step and goes directly to DG.
 *   - 2026-05-28: BdC mutualisés multi-fermes (ferme === 'Toutes') routent
 *     également directement au DG — aucun chef ne peut être désigné comme
 *     valideur unique pour une commande couvrant toutes les fermes. La
 *     ventilation par ferme + validation séquentielle multi-chef sont prévues
 *     pour un sprint ultérieur (cf. ROADMAP).
 */
// @ts-check

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Fermes / cibles dont les BdC sautent l'étape Chef de Ferme :
 *   - 6 fermes historiques sans chef (Avocatier, F2, F3, F4, F6, BAHIA) →
 *     bypass_reason = 'no_chef_de_ferme'.
 *   - 'Toutes' = BdC mutualisé multi-fermes (aucun chef unique compétent) →
 *     bypass_reason = 'multi_ferme_dg_only'.
 * chef_avo est rattaché à Avocatier + F2 + F3 + F4 + F6 + BAHIA mais n'est
 * pas un point de passage pour les BdC (décision business 2026-05).
 */
const DIRECT_DG_FARMS = ['Avocatier', 'F2', 'F3', 'F4', 'F6', 'BAHIA', 'Toutes'];

const DIRECT_DG_FARMS_NORMALIZED = new Set(
  DIRECT_DG_FARMS.map(function (s) { return s.toUpperCase(); })
);

/**
 * Mapping ferme → profileId du Chef de Ferme compétent pour la validation BdC.
 * Seules F1 (Framboise) et F5 (Myrtille) ont un chef qui valide les BdC —
 * les autres fermes sont dans DIRECT_DG_FARMS et ne passent jamais ici.
 */
const CHEF_PROFILE_BY_FERME = { F1: 'chef_f1', F5: 'chef_f5' };

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
 * Distingue les BdC mutualisés (Toutes) des fermes mono-sans-chef pour
 * faciliter l'audit et la migration future vers le workflow multi-chef.
 *
 * @param {string} ferme
 * @returns {string | null}
 */
function bypassReason(ferme) {
  if (requiresChefValidation(ferme)) return null;
  const norm = ferme.trim().toUpperCase();
  return norm === 'TOUTES' ? 'multi_ferme_dg_only' : 'no_chef_de_ferme';
}

/**
 * Résout le profileId du Chef de Ferme compétent pour une ferme donnée.
 *
 * @param {string} ferme
 * @returns {string | null}
 */
function chefProfileForFerme(ferme) {
  if (!ferme || typeof ferme !== 'string') return null;
  return CHEF_PROFILE_BY_FERME[ferme.trim().toUpperCase()] || null;
}

export { DIRECT_DG_FARMS, requiresChefValidation, nextStatusOnSubmit, bypassReason, chefProfileForFerme };
