// @ts-check

function computeEcartVolume(attendu, reel) {
  return attendu - reel;
}

function computeEcartPct(attendu, reel) {
  if (attendu === 0) return 0;
  return (attendu - reel) / attendu;
}

function classifyEcart(ecartPct) {
  const abs = Math.abs(ecartPct);
  if (abs <= 0.02) return 'normal';
  if (abs <= 0.05) return 'attention';
  return 'critique';
}

function aggregateEcarts(ecarts) {
  let totalEcart = 0, sumPct = 0, maxEcart = 0;
  const anomalies = [];
  for (const ecart of ecarts) {
    const attendu = ecart.attendu || 0;
    const reel = ecart.reel || 0;
    const volume = Math.abs(computeEcartVolume(attendu, reel));
    const pct = computeEcartPct(attendu, reel);
    totalEcart += volume;
    sumPct += pct;
    if (volume > maxEcart) maxEcart = volume;
    if (classifyEcart(pct) === 'critique') anomalies.push(ecart);
  }
  return {
    totalEcart, avgEcartPct: ecarts.length > 0 ? sumPct / ecarts.length : 0,
    maxEcart, anomalies
  };
}

module.exports = {
  computeEcartVolume, computeEcartPct, classifyEcart, aggregateEcarts
};
