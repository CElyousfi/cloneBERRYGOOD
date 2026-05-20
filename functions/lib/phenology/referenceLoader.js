/**
 * referenceLoader.js — Load PhenologyReference docs from Firestore with
 * a process-level memory cache.
 *
 * Source : phenology_references/{varietyId}_{cycleType}
 *
 * Pure orchestrator with explicit DI for the Firestore reader. Aucun appel
 * direct à firebase-admin — testable sans émulateur.
 */

/**
 * @typedef {import('./types').PhenologyReference} PhenologyReference
 * @typedef {import('./types').VarietyId} VarietyId
 * @typedef {import('./types').CycleType} CycleType
 */

/**
 * @typedef {Object} ReferenceLoaderDeps
 * @property {(docId: string) => Promise<PhenologyReference|null>} readReferenceDoc
 *   Reader injecté qui prend le docId `${varietyId}_${cycleType}` et renvoie
 *   le doc data ou null si non trouvé.
 */

const COLLECTION = "phenology_references";

// Cache mémoire process-level. Cloud Functions garde le process chaud
// quelques minutes entre invocations → bénéfice net sur runs successifs.
// Reset-able via clearReferenceCache() pour les tests.
const _cache = new Map();

function _key(varietyId, cycleType) {
  return `${varietyId}_${cycleType}`;
}

function _validateReference(ref, docId) {
  if (!ref || typeof ref !== "object") {
    throw new Error(`referenceLoader: doc ${docId} missing or not an object`);
  }
  if (!Array.isArray(ref.stages) || ref.stages.length === 0) {
    throw new RangeError(`referenceLoader: doc ${docId} has no stages[] array`);
  }
  if (typeof ref.tBase !== "number" || typeof ref.tCap !== "number") {
    throw new RangeError(`referenceLoader: doc ${docId} missing tBase/tCap`);
  }
  return ref;
}

/**
 * Charge un PhenologyReference depuis Firestore (avec cache mémoire).
 *
 * @param {VarietyId} varietyId
 * @param {CycleType} cycleType
 * @param {ReferenceLoaderDeps} deps
 * @returns {Promise<PhenologyReference>}
 * @throws {Error} si le doc n'existe pas
 * @throws {RangeError} si le doc est malformé (stages absents, tBase/tCap manquants)
 */
async function loadReference(varietyId, cycleType, deps) {
  if (typeof varietyId !== "string" || !varietyId) {
    throw new TypeError(`loadReference: varietyId required, got ${varietyId}`);
  }
  if (typeof cycleType !== "string" || !cycleType) {
    throw new TypeError(`loadReference: cycleType required, got ${cycleType}`);
  }
  if (!deps || typeof deps.readReferenceDoc !== "function") {
    throw new TypeError("loadReference: deps.readReferenceDoc(docId) function required");
  }
  const key = _key(varietyId, cycleType);
  if (_cache.has(key)) return _cache.get(key);

  const docId = key;
  const raw = await deps.readReferenceDoc(docId);
  const ref = _validateReference(raw, docId);
  _cache.set(key, ref);
  return ref;
}

/** Réinitialise le cache mémoire (utile pour les tests). */
function clearReferenceCache() {
  _cache.clear();
}

module.exports = {
  loadReference,
  clearReferenceCache,
  COLLECTION,
};
