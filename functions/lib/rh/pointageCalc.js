function computePresenceJours(pointages) {
  const uniqueDays = new Set(pointages.map(p => p.jour));
  return uniqueDays.size;
}

function computeHeuresSup(pointages, baseHeures = 8) {
  let total = 0;
  for (const p of pointages) {
    const hours = p.heures || 0;
    if (hours > baseHeures) {
      total += (hours - baseHeures);
    }
  }
  return total;
}

function detectAnomalie(pointage) {
  if (!pointage.jour) return "Missing jour";
  if (!pointage.matricule) return "Missing matricule";
  return null;
}

function aggregateByWorker(pointages) {
  const map = {};
  for (const p of pointages) {
    const mat = p.matricule;
    if (!map[mat]) {
      map[mat] = { jours: 0, heuresSup: 0, anomalies: [] };
    }
    const anom = detectAnomalie(p);
    if (anom) map[mat].anomalies.push(anom);
    map[mat].jours += 1; // Assuming 1 entry = 1 jour for simplicity, or we can use Set logic
  }
  return map;
}

module.exports = {
  computePresenceJours,
  computeHeuresSup,
  detectAnomalie,
  aggregateByWorker
};
