/**
 * Productivity Report — pure ranking + enrichment logic.
 *
 * Input: treatments parsed from PDF (rough shape from Claude or regex).
 * Output: treatments enriched with f1/f5 ranks, percentile, top25 thresholds.
 *
 * Pure functions. No I/O, no side effects. Tested in __tests__/ranker.test.js.
 */

const { DRISCOLL_GROWER_CODES, TOP25_PERCENTILE } = require('./constants');

/**
 * Compute the threshold value at the given percentile (0..1) from sorted
 * yields (descending). For top 25%, pass 0.75 — returns the yield at the
 * 75th percentile (i.e. the value above which the top 25% of growers fall).
 *
 * Uses linear interpolation between adjacent values.
 *
 * @param {number[]} yieldsDesc - yields sorted descending
 * @param {number} percentile - 0..1
 * @returns {number|null}
 */
function percentileThreshold(yieldsDesc, percentile) {
  if (!Array.isArray(yieldsDesc) || yieldsDesc.length === 0) return null;
  if (yieldsDesc.length === 1) return yieldsDesc[0];

  // For "top 25%" with N growers, threshold = value at index floor(N * 0.25).
  // Example: N=20, top 25% = top 5 growers, threshold = yield at index 4 (5th).
  // We use rank-based: rank/N <= (1 - percentile) → in top.
  const cutoffIndex = Math.max(0, Math.floor(yieldsDesc.length * (1 - percentile)) - 1);
  return yieldsDesc[cutoffIndex];
}

/**
 * Enrich one treatment with rank stats for F1 (172) and F5 (195).
 *
 * @param {{
 *   title: string,
 *   category?: string,
 *   unit?: string,
 *   average?: number|null,
 *   growers: Array<{ code: string, yield: number, plantingWeek?: number|null }>
 * }} treatment
 * @returns enriched treatment with added: totalGrowers, top25Threshold, f1, f5
 */
function enrichTreatment(treatment) {
  const growers = Array.isArray(treatment.growers) ? treatment.growers.slice() : [];

  // Filter out null/NaN yields and the synthetic "Average" entry if present.
  const valid = growers.filter(g =>
    g && typeof g.code === 'string' &&
    !/^(average|avg|moyenne|avr)$/i.test(g.code.trim()) &&
    Number.isFinite(Number(g.yield))
  ).map(g => ({
    code: String(g.code).trim(),
    yield: Number(g.yield),
    plantingWeek: Number.isFinite(Number(g.plantingWeek)) ? Number(g.plantingWeek) : null,
  }));

  // Sort descending by yield.
  valid.sort((a, b) => b.yield - a.yield);

  const totalGrowers = valid.length;
  const yieldsDesc = valid.map(g => g.yield);
  const top25Threshold = percentileThreshold(yieldsDesc, TOP25_PERCENTILE);

  const buildFarmStats = (code) => {
    const idx = valid.findIndex(g => g.code === code);
    if (idx === -1) return null;
    const g = valid[idx];
    const rank = idx + 1;
    const avg = Number.isFinite(Number(treatment.average)) ? Number(treatment.average) : null;
    const vsAveragePct = avg && avg > 0 ? ((g.yield - avg) / avg) * 100 : null;
    const vsTop25Pct = top25Threshold && top25Threshold > 0
      ? ((g.yield - top25Threshold) / top25Threshold) * 100
      : null;
    const inTop25 = totalGrowers > 0 ? (rank / totalGrowers) <= 0.25 : false;
    return {
      code: g.code,
      yield: g.yield,
      plantingWeek: g.plantingWeek,
      rank,
      rankTotal: totalGrowers,
      vsAveragePct: vsAveragePct === null ? null : Math.round(vsAveragePct * 10) / 10,
      vsTop25Pct: vsTop25Pct === null ? null : Math.round(vsTop25Pct * 10) / 10,
      inTop25,
    };
  };

  return {
    title: treatment.title,
    category: treatment.category || null,
    unit: treatment.unit || null,
    average: Number.isFinite(Number(treatment.average)) ? Number(treatment.average) : null,
    totalGrowers,
    top25Threshold,
    growers: valid,
    f1: buildFarmStats(DRISCOLL_GROWER_CODES.F1),
    f5: buildFarmStats(DRISCOLL_GROWER_CODES.F5),
  };
}

/**
 * Enrich a list of treatments.
 *
 * @param {Array} treatments
 * @returns {Array} enriched treatments
 */
function enrichTreatments(treatments) {
  if (!Array.isArray(treatments)) return [];
  return treatments.map(enrichTreatment);
}

/**
 * Build summary KPIs across all treatments where F1 or F5 is present.
 *
 * @param {Array} enrichedTreatments
 * @returns {{
 *   f1: { present: number, inTop25: number, avgRank: number|null, avgRankTotal: number|null },
 *   f5: { present: number, inTop25: number, avgRank: number|null, avgRankTotal: number|null }
 * }}
 */
function buildFarmSummary(enrichedTreatments) {
  const farms = { f1: { present: 0, inTop25: 0, ranks: [], totals: [] },
                  f5: { present: 0, inTop25: 0, ranks: [], totals: [] } };
  for (const t of enrichedTreatments || []) {
    for (const key of ['f1', 'f5']) {
      const stats = t[key];
      if (!stats) continue;
      farms[key].present++;
      if (stats.inTop25) farms[key].inTop25++;
      farms[key].ranks.push(stats.rank);
      farms[key].totals.push(stats.rankTotal);
    }
  }
  const avg = (arr) => arr.length === 0 ? null : Math.round((arr.reduce((s, x) => s + x, 0) / arr.length) * 10) / 10;
  return {
    f1: { present: farms.f1.present, inTop25: farms.f1.inTop25, avgRank: avg(farms.f1.ranks), avgRankTotal: avg(farms.f1.totals) },
    f5: { present: farms.f5.present, inTop25: farms.f5.inTop25, avgRank: avg(farms.f5.ranks), avgRankTotal: avg(farms.f5.totals) },
  };
}

module.exports = {
  percentileThreshold,
  enrichTreatment,
  enrichTreatments,
  buildFarmSummary,
};
