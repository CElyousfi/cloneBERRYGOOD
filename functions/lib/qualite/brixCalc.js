// @ts-check

function computeBrixAverage(readings) {
  if (!readings || readings.length === 0) return 0;
  const sum = readings.reduce((a, b) => a + b, 0);
  return sum / readings.length;
}

function isBrixCompliant(brix, minBrix) {
  return brix >= minBrix;
}

function computeBrixStats(readings) {
  if (!readings || readings.length === 0) {
    return { avg: 0, min: 0, max: 0, stdDev: 0, compliantPct: 0 };
  }
  let min = readings[0], max = readings[0], sum = 0, compliantCount = 0;
  for (const r of readings) {
    if (r < min) min = r;
    if (r > max) max = r;
    sum += r;
    if (isBrixCompliant(r, 10)) compliantCount++; // Default 10 if not provided
  }
  const avg = sum / readings.length;
  let varianceSum = 0;
  for (const r of readings) {
    varianceSum += Math.pow(r - avg, 2);
  }
  const stdDev = Math.sqrt(varianceSum / readings.length);
  return { avg, min, max, stdDev, compliantPct: compliantCount / readings.length };
}

module.exports = {
  computeBrixAverage, isBrixCompliant, computeBrixStats
};
