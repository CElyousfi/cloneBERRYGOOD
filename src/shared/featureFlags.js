// @ts-check
/**
 * Feature Flags — centralized feature flag management.
 *
 * Priority (highest to lowest):
 *   1. URL param: ?flag_FEATURE_NAME=true  (dev/QA override)
 *   2. localStorage: smartberry_flag_FEATURE_NAME
 *   3. Remote config from Firestore app_settings/feature_flags (cached 5min)
 *   4. Default value defined here
 *
 * Usage:
 *   import { isEnabled } from '@shared/featureFlags';
 *   if (isEnabled('FINANCE_READ_POSTGRES')) { ... }
 *
 * @module shared/featureFlags
 */

/** @type {Record<string, boolean>} Default values for all feature flags */
const FLAG_DEFAULTS = {
  /** Step 3: Finance writes go to both Firestore AND Postgres */
  FINANCE_DUAL_WRITE: false,
  /** Step 3: Finance reads come from Postgres (not Firestore) */
  FINANCE_READ_POSTGRES: false,
  /** Step 4: Qualité writes go to both Firestore AND Postgres */
  QUALITE_DUAL_WRITE: false,
  /** Step 4: Qualité reads come from Postgres (not Firestore) */
  QUALITE_READ_POSTGRES: false,
  /** Step 1: Use new modular frontend (src/features/) instead of monolith */
  MODULAR_FRONTEND: false,
};

/** @type {Record<string, boolean>} Remote config cache */
let _remoteCache = {};
let _remoteCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if a feature flag is enabled.
 *
 * @param {keyof typeof FLAG_DEFAULTS} flagName
 * @returns {boolean}
 */
export function isEnabled(flagName) {
  // 1. URL param override (dev/QA)
  if (typeof window !== 'undefined' && window.location) {
    const param = new URLSearchParams(window.location.search).get(`flag_${flagName}`);
    if (param === 'true') return true;
    if (param === 'false') return false;
  }

  // 2. localStorage override
  try {
    const stored = localStorage.getItem(`smartberry_flag_${flagName}`);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch (_) { /* localStorage may be unavailable */ }

  // 3. Remote config (cached)
  if (flagName in _remoteCache) {
    return _remoteCache[flagName];
  }

  // 4. Default
  return FLAG_DEFAULTS[flagName] ?? false;
}

/**
 * Update remote config cache from Firestore.
 * Call this once on app load after Firestore is initialized.
 *
 * @param {Record<string, boolean>} remoteFlags - Flags from Firestore app_settings/feature_flags
 */
export function updateRemoteFlags(remoteFlags) {
  _remoteCache = { ..._remoteCache, ...remoteFlags };
  _remoteCacheTime = Date.now();
}

/**
 * Set a flag locally (persists to localStorage). Used for dev/QA.
 *
 * @param {keyof typeof FLAG_DEFAULTS} flagName
 * @param {boolean} value
 */
export function setFlag(flagName, value) {
  try {
    localStorage.setItem(`smartberry_flag_${flagName}`, String(value));
  } catch (_) { /* ignore */ }
}

/**
 * Get all flag states for debugging.
 *
 * @returns {Record<string, boolean>}
 */
export function getAllFlags() {
  return Object.fromEntries(
    Object.keys(FLAG_DEFAULTS).map(k => [k, isEnabled(/** @type {any} */ (k))])
  );
}
