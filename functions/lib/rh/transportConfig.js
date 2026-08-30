function getEqPrefix(matricule, knownPrefixes) {
  if (!matricule || typeof matricule !== 'string') return null;
  const m = matricule.trim().toUpperCase();
  if (!m) return null;

  if (knownPrefixes && Array.isArray(knownPrefixes)) {
    const p2 = m.substring(0, 2);
    if (knownPrefixes.includes(p2)) return p2;
  }

  if (m.startsWith('HAFI') || m.startsWith('HA')) return 'HA';
  if (m.startsWith('DD')) return 'NV';

  return null;
}

function computeTransportQuinzaine(rows, opts) {
  const o = opts || {};
  const periode = o.periode;
  const transportEquipes = Array.isArray(o.transportEquipes) ? o.transportEquipes : [];
  const coutMap = o.coutMap || {};
  const ferme = o.ferme != null ? o.ferme : null;
  const matchSub = typeof o.matchSub === 'function' ? o.matchSub : null;
  const knownPrefixes = transportEquipes.map(t => t && t.prefix);

  const scoped = (Array.isArray(rows) ? rows : []).filter(r => {
    if (!r || r.periode !== periode) return false;
    if (ferme && r.ferme !== ferme) return false;
    if (matchSub && !matchSub(r)) return false;
    return true;
  });

  const dailyByEquipe = {};
  scoped.forEach(r => {
    const eq = getEqPrefix(r.matricule, knownPrefixes);
    if (!eq) return;
    const d = r.jour;
    if (!dailyByEquipe[d]) dailyByEquipe[d] = {};
    if (!dailyByEquipe[d][eq]) dailyByEquipe[d][eq] = new Set();
    dailyByEquipe[d][eq].add(r.matricule);
  });

  let total = 0;
  let totalWorkers = 0;
  const eqMap = {};
  for (const t of transportEquipes) eqMap[t.prefix] = { prefix: t.prefix, total: 0, totalWorkers: 0 };
  const allDates = Object.keys(dailyByEquipe).sort();

  for (const d of allDates) {
    for (const eq of Object.keys(dailyByEquipe[d])) {
      const cnt = dailyByEquipe[d][eq].size;
      const cost = coutMap[eq] || 0;
      const amt = cnt * cost;
      if (!eqMap[eq]) eqMap[eq] = { prefix: eq, total: 0, totalWorkers: 0 };
      eqMap[eq].total += amt;
      eqMap[eq].totalWorkers += cnt;
      total += amt;
      totalWorkers += cnt;
    }
  }

  return {
    total,
    totalWorkers,
    dates: allDates,
    byEquipe: Object.values(eqMap)
  };
}

function getTransportFee(ferme, distance) {
  return distance * 1.5;
}

module.exports = {
  getEqPrefix,
  computeTransportQuinzaine,
  getTransportFee
};
