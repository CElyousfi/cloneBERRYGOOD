/**
 * farmroadStationResolver.js — Resolve a FarmroadStation for a plot.
 *
 * Source : farmroad_stations/{stationId}
 *
 * Priorité de résolution :
 *   1. plot.sensors.farmroad.stationId explicite → lookup direct
 *   2. Fallback : station where type === plot.shelter.type AND isDefaultForType === true
 *   3. Aucun match → null (log warn, caller décide fallback)
 *
 * DI pour Firestore I/O. Pure logic testable sans émulateur.
 */

/**
 * @typedef {Object} FarmroadStation
 * @property {string} stationId
 * @property {string} displayName
 * @property {"canarienne"|"tunnel"|"multispan"|"open_field"} type
 * @property {string} deviceId
 * @property {"active"|"maintenance"|"offline"} status
 * @property {boolean} isDefaultForType
 * ... (cf. seed schema)
 */

/**
 * @typedef {Object} FarmroadStationResolverDeps
 * @property {(stationId: string) => Promise<FarmroadStation|null>} readStationById
 * @property {(shelterType: string) => Promise<FarmroadStation[]>} listStationsByType
 * @property {(msg: string, ctx?: object) => void} [logWarn] optional
 */

/**
 * Résout la station FarmRoad d'une parcelle.
 *
 * @param {object} plot              Plot doc (sensors.farmroad.stationId, shelter.type)
 * @param {FarmroadStationResolverDeps} deps
 * @returns {Promise<FarmroadStation|null>}
 */
async function resolveStation(plot, deps) {
  if (!plot || typeof plot !== "object") {
    throw new TypeError("resolveStation: plot object required");
  }
  if (!deps || typeof deps.readStationById !== "function" || typeof deps.listStationsByType !== "function") {
    throw new TypeError("resolveStation: deps.readStationById + deps.listStationsByType required");
  }
  const logWarn = deps.logWarn || ((msg, ctx) => console.warn(msg, ctx || ""));

  const explicitId = plot.sensors && plot.sensors.farmroad && plot.sensors.farmroad.stationId;
  if (explicitId) {
    const station = await deps.readStationById(explicitId);
    if (station) return station;
    logWarn("resolveStation: explicit stationId not found", { plotId: plot.id, stationId: explicitId });
  }

  const shelterType = plot.shelter && plot.shelter.type;
  if (!shelterType) {
    logWarn("resolveStation: plot has no shelter.type, cannot fallback", { plotId: plot.id });
    return null;
  }

  const candidates = await deps.listStationsByType(shelterType);
  if (!Array.isArray(candidates) || candidates.length === 0) {
    logWarn("resolveStation: no station matches shelter type", { plotId: plot.id, shelterType });
    return null;
  }

  // Priority: isDefaultForType === true first, then deterministic ordering by stationId.
  const sorted = candidates.slice().sort((a, b) => {
    const aDefault = a.isDefaultForType ? 0 : 1;
    const bDefault = b.isDefaultForType ? 0 : 1;
    if (aDefault !== bDefault) return aDefault - bDefault;
    return String(a.stationId).localeCompare(String(b.stationId));
  });
  return sorted[0];
}

module.exports = {
  resolveStation,
};
