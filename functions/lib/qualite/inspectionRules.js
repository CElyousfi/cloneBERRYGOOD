// @ts-check

function computeDefectRate(inspection) {
  if (!inspection || !inspection.totalSamples || inspection.totalSamples === 0) return 0;
  return (inspection.defects || 0) / inspection.totalSamples;
}

function classifyQuality(defectRate) {
  if (defectRate <= 0.05) return 'A';
  if (defectRate <= 0.10) return 'B';
  if (defectRate <= 0.20) return 'C';
  return 'reject';
}

function isBelowThreshold(defectRate, threshold) {
  return defectRate < threshold;
}

function computeInspectionSummary(inspections) {
  let total = 0, passed = 0, failed = 0, totalDefectRate = 0;
  for (const insp of inspections) {
    total++;
    const rate = computeDefectRate(insp);
    totalDefectRate += rate;
    const classification = classifyQuality(rate);
    if (classification === 'reject') failed++;
    else passed++;
  }
  return {
    total, passed, failed, avgDefectRate: total > 0 ? totalDefectRate / total : 0
  };
}

module.exports = {
  computeDefectRate, classifyQuality, isBelowThreshold, computeInspectionSummary
};
