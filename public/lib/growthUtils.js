/**
 * growthUtils.js — Pure helpers for the "Suivi Croissance Framboise" screen.
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/growthUtils.js"> → exposes window.GrowthUtils
 *   - In node:test via require('./growthUtils.js') → exposes module.exports
 *
 * All functions are pure (no DOM, no network, no Firestore).
 *
 * Item « Suivi croissance framboise (points de contrôle) » — 2026-06.
 */
// @ts-check
'use strict';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Culture value (in PARCELLES_CULTURALES) tracked by this screen. */
const FRAMBOISE_CULTURE = 'Framboise';

/** Sentinel value for "all variétés" in the UI filter. */
const ALL_VARIETES = 'Toutes';

/** Date format accepted for measurements (ISO calendar date). */
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Hard upper bound (cm) above which a cane length is considered a typo. */
const MAX_LENGTH_CM = 1000;

// ============================================================================
// PARCELLES
// ============================================================================

/**
 * Builds a human-readable label for a framboise parcelle entry.
 * Prefers variete + sousVariete + ferme; falls back to id.
 * @param {{id?: string, variete?: string, sousVariete?: string|null, ferme?: string}} pc
 * @returns {string}
 */
function parcelleLabel(pc) {
  if (!pc) return '';
  const parts = [];
  if (pc.variete) parts.push(String(pc.variete).trim());
  if (pc.sousVariete) parts.push(String(pc.sousVariete).trim());
  if (pc.ferme) parts.push(String(pc.ferme).trim());
  const label = parts.join(' ').trim();
  return label || (pc.id ? String(pc.id) : '');
}

/**
 * Filters PARCELLES_CULTURALES down to framboise entries, optionally by variété,
 * and normalizes each to { id, label, variete, sousVariete, ferme }.
 * Sorted by variété then label.
 * @param {Array<Object>} parcellesCulturales
 * @param {string} [varieteFilter] — if provided and !== 'Toutes', keep only this variété
 * @returns {Array<{id: string, label: string, variete: string, sousVariete: (string|null), ferme: string}>}
 */
function framboiseParcelles(parcellesCulturales, varieteFilter) {
  if (!Array.isArray(parcellesCulturales)) return [];
  const wantVariete = varieteFilter && varieteFilter !== ALL_VARIETES ? varieteFilter : null;
  const out = [];
  parcellesCulturales.forEach(pc => {
    if (!pc || pc.culture !== FRAMBOISE_CULTURE) return;
    if (wantVariete && pc.variete !== wantVariete) return;
    out.push({
      id: pc.id ? String(pc.id) : '',
      label: parcelleLabel(pc),
      variete: pc.variete || '',
      sousVariete: pc.sousVariete != null ? pc.sousVariete : null,
      ferme: pc.ferme || '',
    });
  });
  out.sort((a, b) => {
    if (a.variete !== b.variete) return a.variete < b.variete ? -1 : 1;
    if (a.label !== b.label) return a.label < b.label ? -1 : 1;
    return 0;
  });
  return out;
}

/**
 * Distinct framboise variétés actually present in PARCELLES_CULTURALES, sorted.
 * No hard-coded list (avoids the Yazmin/Yasmin spelling trap).
 * @param {Array<Object>} parcellesCulturales
 * @returns {Array<string>}
 */
function varietesFramboise(parcellesCulturales) {
  if (!Array.isArray(parcellesCulturales)) return [];
  const set = new Set();
  parcellesCulturales.forEach(pc => {
    if (pc && pc.culture === FRAMBOISE_CULTURE && pc.variete) set.add(String(pc.variete));
  });
  return Array.from(set).sort();
}

// ============================================================================
// CHECKPOINTS
// ============================================================================

/**
 * Normalizes a list of checkpoint names: trim, drop empties, dedupe (keep order).
 * @param {Array<string>} arr
 * @returns {Array<string>}
 */
function normalizeCheckpoints(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  arr.forEach(raw => {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) return;
    if (seen.has(name)) return;
    seen.add(name);
    out.push(name);
  });
  return out;
}

// ============================================================================
// SERIES
// ============================================================================

/**
 * Parses a value into a finite positive cane length (cm) or null.
 * @param {*} v
 * @returns {number|null}
 */
function parseLength(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n) || n <= 0 || n >= MAX_LENGTH_CM) return null;
  return n;
}

/**
 * Pivots raw measurements into a chart-ready series: one row per date,
 * one column per checkpoint. Duplicate (date + checkpoint) keeps the most
 * recent (max created_at). Rows without a valid date or length are ignored.
 *
 * @param {Array<{date?: string, checkpoint?: string, length_cm?: (number|string), created_at?: number}>} measurements
 * @param {Array<string>} [checkpoints] — configured checkpoints to union into dataKeys
 * @returns {{rows: Array<Object>, dataKeys: Array<string>}}
 */
function buildGrowthSeries(measurements, checkpoints) {
  const list = Array.isArray(measurements) ? measurements : [];
  // dateMap: date -> checkpoint -> { length, createdAt }
  const dateMap = new Map();
  const presentCheckpoints = new Set();

  list.forEach(m => {
    if (!m || typeof m.date !== 'string' || !DATE_REGEX.test(m.date)) return;
    const checkpoint = typeof m.checkpoint === 'string' ? m.checkpoint.trim() : '';
    if (!checkpoint) return;
    const length = parseLength(m.length_cm);
    if (length === null) return;
    const createdAt = Number.isFinite(m.created_at) ? Number(m.created_at) : 0;

    if (!dateMap.has(m.date)) dateMap.set(m.date, new Map());
    const cpMap = dateMap.get(m.date);
    const prev = cpMap.get(checkpoint);
    if (!prev || createdAt >= prev.createdAt) {
      cpMap.set(checkpoint, { length, createdAt });
    }
    presentCheckpoints.add(checkpoint);
  });

  const dates = Array.from(dateMap.keys()).sort();
  const rows = dates.map(date => {
    const row = { date };
    const cpMap = dateMap.get(date);
    cpMap.forEach((val, cp) => { row[cp] = val.length; });
    return row;
  });

  // dataKeys = union of configured checkpoints (that order first) + any extra present.
  const configured = normalizeCheckpoints(Array.isArray(checkpoints) ? checkpoints : []);
  const dataKeys = [];
  const added = new Set();
  configured.forEach(cp => {
    if (presentCheckpoints.has(cp) && !added.has(cp)) { dataKeys.push(cp); added.add(cp); }
  });
  Array.from(presentCheckpoints).sort().forEach(cp => {
    if (!added.has(cp)) { dataKeys.push(cp); added.add(cp); }
  });

  return { rows, dataKeys };
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates a measurement payload before submission.
 * @param {{parcelle_id?: string, checkpoint?: string, date?: string, length_cm?: (number|string)}} m
 * @returns {{valid: boolean, error?: string}}
 */
function validateMeasurement(m) {
  const obj = m || {};
  if (!obj.parcelle_id || !String(obj.parcelle_id).trim()) {
    return { valid: false, error: 'Parcelle manquante.' };
  }
  if (!obj.checkpoint || !String(obj.checkpoint).trim()) {
    return { valid: false, error: 'Point de contrôle manquant.' };
  }
  if (typeof obj.date !== 'string' || !DATE_REGEX.test(obj.date)) {
    return { valid: false, error: 'Date invalide (format attendu AAAA-MM-JJ).' };
  }
  const n = typeof obj.length_cm === 'number' ? obj.length_cm : parseFloat(obj.length_cm);
  if (!Number.isFinite(n) || n <= 0) {
    return { valid: false, error: 'Longueur invalide (doit être un nombre supérieur à 0).' };
  }
  if (n >= MAX_LENGTH_CM) {
    return { valid: false, error: 'Longueur trop grande (doit être inférieure à 1000 cm).' };
  }
  return { valid: true };
}

// ============================================================================
// UMD-style export (browser global + CommonJS for node:test)
// ============================================================================

const __growthUtilsApi = {
  // constants
  FRAMBOISE_CULTURE, ALL_VARIETES, MAX_LENGTH_CM,
  // functions
  framboiseParcelles, varietesFramboise, buildGrowthSeries,
  validateMeasurement, normalizeCheckpoints,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __growthUtilsApi
if (typeof window !== 'undefined') window.GrowthUtils = __growthUtilsApi
