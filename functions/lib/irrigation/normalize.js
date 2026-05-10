const { avgPositive, sumPositive, toNumber } = require('./utils');

/**
 * Normalize a raw `irrigation_readings` document into the canonical
 * IrrigationEvent shape. One reading -> one event (stations averaged/summed).
 * Resilient to: null doc, missing arrays, non-numeric strings, partial fields.
 *
 * @param {import('./types').RawIrrigationReading|null|undefined} raw
 * @returns {import('./types').IrrigationEvent|null}
 */
function normalizeReading(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const points = Array.isArray(raw.points) ? raw.points : [];
  const drainage = Array.isArray(raw.drainage) ? raw.drainage : [];

  const ptsEc = points.map(p => p && toNumber(p.ec));
  const ptsPh = points.map(p => p && toNumber(p.ph));
  const ptsVol = points.map(p => p && toNumber(p.volume));
  const drEc = drainage.map(p => p && toNumber(p.ec));
  const drPh = drainage.map(p => p && toNumber(p.ph));
  const drVol = drainage.map(p => p && toNumber(p.volume));

  return {
    id: raw.id || null,
    date: typeof raw.date === 'string' ? raw.date : null,
    ferme: typeof raw.ferme === 'string' ? raw.ferme : null,
    parcelle: typeof raw.parcelle === 'string' ? raw.parcelle : null,
    parcelleLabel: typeof raw.parcelleLabel === 'string' ? raw.parcelleLabel : null,
    heure: typeof raw.heure === 'string' ? raw.heure : null,
    dureeMin: toNumber(raw.duree) || 0,
    ecPts: avgPositive(ptsEc),
    phPts: avgPositive(ptsPh),
    volumePtsMl: sumPositive(ptsVol),
    ecDrain: avgPositive(drEc),
    phDrain: avgPositive(drPh),
    volumeDrainMl: sumPositive(drVol),
    stationCount: Math.max(points.length, drainage.length),
    source: typeof raw.source === 'string' ? raw.source : 'manual',
    createdAt: toNumber(raw.createdAt),
  };
}

/**
 * Normalize a list of raw readings, dropping nulls and unparseable entries.
 * @param {import('./types').RawIrrigationReading[]} rawList
 * @returns {import('./types').IrrigationEvent[]}
 */
function normalizeReadings(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const r of rawList) {
    const n = normalizeReading(r);
    if (n && n.date && n.parcelle) out.push(n);
  }
  return out;
}

module.exports = { normalizeReading, normalizeReadings };
