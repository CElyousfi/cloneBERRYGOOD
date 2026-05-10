/**
 * Per-parcelle agronomic metadata used by the irrigation engine.
 *
 * Source of truth for pot volume + substrate. Mirrors what's in
 * `PARCELLES_CULTURALES` on the frontend (public/app.jsx) — keep in sync
 * when adding new parcelles. Soil-grown parcelles have `potVolumeL: null`
 * so volume-based rules skip them safely.
 *
 * Driscoll volume targets per cycle (% of pot):
 *   Strawbs / Blueberries (Myrtille):    1–2 % cible, alert < 0.5 % ou > 3 %
 *   Raspberries / Blackberries (Framboise): 2–4 % cible, alert < 1 % ou > 5 %
 */

/**
 * `greenhouseType`: 'tunnel' | 'canarienne' | 'open'
 *   tunnel     → plastic tunnel, transmittance ~0.65
 *   canarienne → canary-style greenhouse, transmittance ~0.50
 *   open       → plein champ
 *
 * IMPORTANT — defaults below are placeholders set to 'tunnel'. Confirm
 * actual mapping with the team and adjust per parcelle. FarmRoad has 2
 * sensors (one per type) — once the real-time hook is in, this drives
 * which sensor's data feeds each parcelle's RadSum.
 *
 * @type {Record<string, {culture: string, variete: string, ferme: string, potVolumeL: number|null, substrate: string, greenhouseType: string}>}
 */
const PARCELLE_META = {
  // F1 — Maravilla en pot 7L coco (Framboise) — sous tunnel par défaut
  'C1-S7S3-MOTTE':  { culture: 'Framboise', variete: 'Maravilla', ferme: 'F1', potVolumeL: 7,   substrate: 'coco', greenhouseType: 'tunnel' },
  'C1-S1S4-MOW':    { culture: 'Framboise', variete: 'Maravilla', ferme: 'F1', potVolumeL: 7,   substrate: 'coco', greenhouseType: 'tunnel' },
  'C2-S1S4-GC':     { culture: 'Framboise', variete: 'Maravilla', ferme: 'F1', potVolumeL: 7,   substrate: 'coco', greenhouseType: 'tunnel' },
  'C2-S2357-LC':    { culture: 'Framboise', variete: 'Maravilla', ferme: 'F1', potVolumeL: 7,   substrate: 'coco', greenhouseType: 'tunnel' },

  // F1 / F5 — Yazmin EN SOL (no pot) — sous tunnel par défaut
  'C1-S2S5-MOW':    { culture: 'Framboise', variete: 'Yazmin',    ferme: 'F1', potVolumeL: null, substrate: 'soil', greenhouseType: 'tunnel' },
  'C1-S10-MOTTE':   { culture: 'Framboise', variete: 'Yazmin',    ferme: 'F5', potVolumeL: null, substrate: 'soil', greenhouseType: 'tunnel' },
  'C1-S13-MOW':     { culture: 'Framboise', variete: 'Yazmin',    ferme: 'F5', potVolumeL: null, substrate: 'soil', greenhouseType: 'tunnel' },
  'C2-S10-CB':      { culture: 'Framboise', variete: 'Yazmin',    ferme: 'F5', potVolumeL: null, substrate: 'soil', greenhouseType: 'tunnel' },
  'C2-S13-MOW':     { culture: 'Framboise', variete: 'Yazmin',    ferme: 'F5', potVolumeL: null, substrate: 'soil', greenhouseType: 'tunnel' },

  // F5 — Reyna (Framboise) — supposé en sol par défaut, à confirmer
  'C1-S9-REY':      { culture: 'Framboise', variete: 'Reyna',     ferme: 'F5', potVolumeL: null, substrate: 'soil', greenhouseType: 'tunnel' },
  'C2-S9-REY':      { culture: 'Framboise', variete: 'Reyna',     ferme: 'F5', potVolumeL: null, substrate: 'soil', greenhouseType: 'tunnel' },

  // F5 — Myrtilles en pot 30L (mix coco/perlite/tourbe) — TYPE SERRE À CONFIRMER (tunnel ou canarienne ?)
  'C1-S8-COR':      { culture: 'Myrtille', variete: 'Corina',    ferme: 'F5', potVolumeL: 30, substrate: 'coco-perlite-tourbe', greenhouseType: 'tunnel' },
  'C2-S8-COR':      { culture: 'Myrtille', variete: 'Corina',    ferme: 'F5', potVolumeL: 30, substrate: 'coco-perlite-tourbe', greenhouseType: 'tunnel' },
  'C2-S8-BRZ':      { culture: 'Myrtille', variete: 'Breeze',    ferme: 'F5', potVolumeL: 30, substrate: 'coco-perlite-tourbe', greenhouseType: 'tunnel' },
  'C2-S8-CAS':      { culture: 'Myrtille', variete: 'Cascade',   ferme: 'F5', potVolumeL: 30, substrate: 'coco-perlite-tourbe', greenhouseType: 'tunnel' },
  'C2-NP-BRZ':      { culture: 'Myrtille', variete: 'Breeze',    ferme: 'F5', potVolumeL: 30, substrate: 'coco-perlite-tourbe', greenhouseType: 'tunnel' },
  'C2-NP-CAS':      { culture: 'Myrtille', variete: 'Cascade',   ferme: 'F5', potVolumeL: 30, substrate: 'coco-perlite-tourbe', greenhouseType: 'tunnel' },
};

/**
 * Explicit FarmRoad device → greenhouse type mapping. Replaces the previous
 * CO₂-based heuristic (which silently inverted if one sensor drifted).
 * Source of truth for routing per-parcelle RadSum to the correct sensor.
 */
const FARMROAD_DEVICE_BY_GH_TYPE = {
  canarienne: '210506929',
  tunnel:     '210506960',
  // 'open' → no indoor sensor; RadSum will be null
};

function getFarmroadDeviceId(greenhouseType) {
  return FARMROAD_DEVICE_BY_GH_TYPE[greenhouseType] || null;
}

/**
 * Resolve outdoor → indoor transmittance for a given greenhouse type.
 * @param {string|null} greenhouseType
 * @param {import('./types').IrrigationThresholds} thresholds
 * @returns {number}
 */
function getTransmittance(greenhouseType, thresholds) {
  const table = (thresholds && thresholds.radTransmittanceByGreenhouseType) || {};
  if (greenhouseType && Number.isFinite(table[greenhouseType])) return table[greenhouseType];
  if (Number.isFinite(table.default)) return table.default;
  return (thresholds && thresholds.radTunnelTransmittance) || 0.6;
}

/**
 * Driscoll volume targets per pulse (% of pot volume).
 * @type {Record<string, {lowPct: number, highPct: number, warnLowPct: number, warnHighPct: number}>}
 */
const PULSE_VOLUME_TARGETS = {
  Myrtille:  { lowPct: 1, highPct: 2, warnLowPct: 0.5, warnHighPct: 3 },
  Framboise: { lowPct: 2, highPct: 4, warnLowPct: 1,   warnHighPct: 5 },
  default:   { lowPct: 1, highPct: 2, warnLowPct: 0.5, warnHighPct: 3 },
};

function getParcelleMeta(id) {
  return PARCELLE_META[id] || null;
}

function getPulseVolumeTarget(culture) {
  return PULSE_VOLUME_TARGETS[culture] || PULSE_VOLUME_TARGETS.default;
}

/**
 * Given a list of parcelle ids, return a map id → meta (omitting unknowns).
 * @param {string[]} ids
 * @returns {Record<string, Object>}
 */
function buildParcelleMetaById(ids) {
  const out = {};
  if (!Array.isArray(ids)) return out;
  for (const id of ids) {
    const m = PARCELLE_META[id];
    if (m) out[id] = m;
  }
  return out;
}

/**
 * Load metadata from Firestore collection `parcelle_irrigation_meta`,
 * falling back to the hardcoded PARCELLE_META for missing entries.
 *
 * Cache: 5 min in-process. Lets the team edit greenhouseType / potVolumeL
 * directly from Firebase Console without a redeploy.
 *
 * @param {*} db                                   Firestore instance
 * @param {string[]} ids                           parcelle ids to fetch
 * @returns {Promise<Record<string, Object>>}
 */
const FIRESTORE_COLLECTION = 'parcelle_irrigation_meta';
const _cache = { data: null, fetchedAt: 0, ttlMs: 5 * 60 * 1000 };

async function loadParcelleMetaFromFirestore(db, ids) {
  if (!db) return buildParcelleMetaById(ids);
  const now = Date.now();
  if (!_cache.data || now - _cache.fetchedAt > _cache.ttlMs) {
    try {
      const snap = await db.collection(FIRESTORE_COLLECTION).get();
      const fromDb = {};
      snap.docs.forEach(d => { fromDb[d.id] = d.data(); });
      _cache.data = fromDb;
      _cache.fetchedAt = now;
    } catch (e) {
      // Firestore unreachable → use static fallback
      _cache.data = {};
      _cache.fetchedAt = now;
    }
  }
  const out = {};
  if (!Array.isArray(ids)) return out;
  for (const id of ids) {
    out[id] = _cache.data[id] || PARCELLE_META[id] || null;
    if (!out[id]) delete out[id];
  }
  return out;
}

/** Force-refresh of the in-process cache. Useful after admin edits. */
function clearParcelleMetaCache() {
  _cache.data = null;
  _cache.fetchedAt = 0;
}

module.exports = {
  PARCELLE_META,
  PULSE_VOLUME_TARGETS,
  FARMROAD_DEVICE_BY_GH_TYPE,
  FIRESTORE_COLLECTION,
  getParcelleMeta,
  getPulseVolumeTarget,
  getTransmittance,
  getFarmroadDeviceId,
  buildParcelleMetaById,
  loadParcelleMetaFromFirestore,
  clearParcelleMetaCache,
};
