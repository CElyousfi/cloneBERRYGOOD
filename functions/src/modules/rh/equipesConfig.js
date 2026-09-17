/**
 * equipesConfig.js — Team prefix → name mapping.
 *
 * Mirrors transportConfig in public/app.jsx (~line 2093). Used as fallback
 * when Firestore `transport_config` collection is empty (current state).
 */

const EQUIPES = [
  { prefix: 'MM', equipe: 'Boucharen',  caporal: 'El Mghitni Moustapha' },
  { prefix: 'AY', equipe: 'Chelihat',   caporal: 'Taiti Ayoub' },
  { prefix: 'HT', equipe: 'El Bachir',  caporal: 'El Seghire Bachir' },
  { prefix: 'HA', equipe: 'El Hafi',    caporal: 'El Hafi Mustapha' },
  { prefix: 'KR', equipe: 'Farid',      caporal: 'El Koumiry Farid' },
  { prefix: 'NA', equipe: 'Larache',    caporal: 'Larache Ayoube' },
  { prefix: 'JA', equipe: 'Ksr Femme',  caporal: 'Belhadi Ahmed 2' },
  { prefix: 'AZ', equipe: 'Chahdi',     caporal: 'Chahdi Bouslham' },
  { prefix: 'CC', equipe: 'Zeouada',    caporal: 'Sekitoui Ahmed' },
  { prefix: 'CA', equipe: 'Ragragui',   caporal: 'Ragragui Brahim' },
  { prefix: 'RE', equipe: 'Dechira',    caporal: 'El Aydi Ayoub' },
  { prefix: 'NV', equipe: 'NV',         caporal: 'El Aydi Ayoub' },
  { prefix: 'LG', equipe: 'Largo' },
];

const EQUIPE_NAME_BY_PREFIX = {};
EQUIPES.forEach(e => { EQUIPE_NAME_BY_PREFIX[e.prefix.toUpperCase()] = e.equipe; });

/**
 * Resolve team name for a matricule prefix. Tries Firestore `transport_config`
 * first, falls back to the hardcoded mapping.
 * Cached 10 min in memory.
 */
let _cache = null;
let _cacheAt = 0;
const TTL = 10 * 60 * 1000;

async function getTeamNameMap(db) {
  if (_cache && Date.now() - _cacheAt < TTL) return _cache;
  const map = { ...EQUIPE_NAME_BY_PREFIX };
  try {
    const snap = await db.collection('transport_config').get();
    snap.forEach(doc => {
      const x = doc.data() || {};
      const name = x.equipe || x.nomEquipe;
      if (name) map[doc.id.toUpperCase()] = name;
    });
  } catch (e) {
    console.warn('transport_config fetch failed, using hardcoded:', e.message);
  }
  _cache = map;
  _cacheAt = Date.now();
  return _cache;
}

module.exports = { EQUIPES, EQUIPE_NAME_BY_PREFIX, getTeamNameMap };
