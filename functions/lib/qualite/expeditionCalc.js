// @ts-check

function computeNetWeight(brut, tare) {
  return Math.max(0, brut - tare);
}

function computeLoadFillRate(netWeight, capacite) {
  if (!capacite || capacite <= 0) return 0;
  return netWeight / capacite;
}

function computeExpeditionTotals(expeditions) {
  let totalBrut = 0, totalTare = 0, totalNet = 0;
  for (const exp of expeditions) {
    const brut = exp.brut || 0;
    const tare = exp.tare || 0;
    totalBrut += brut;
    totalTare += tare;
    totalNet += computeNetWeight(brut, tare);
  }
  return { totalBrut, totalTare, totalNet, nbExpeditions: expeditions.length };
}

module.exports = {
  computeNetWeight, computeLoadFillRate, computeExpeditionTotals
};
