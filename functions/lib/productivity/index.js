/**
 * Productivity Report — public barrel.
 *
 * Pipeline:
 *   pdfBuffer → parseProductivityPdf (pdf-parse + Claude)
 *             → enrichTreatments (rank/percentile/top25 for F1+F5)
 *             → buildFarmSummary (overview KPIs)
 *             → Firestore write
 */

const constants = require('./constants');
const ranker = require('./ranker');
const pdfParser = require('./pdfParser');
const refetchPipeline = require('./refetchPipeline');

module.exports = {
  ...constants,
  ...ranker,
  ...pdfParser,
  ...refetchPipeline,
};
