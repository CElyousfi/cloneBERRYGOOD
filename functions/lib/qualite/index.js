// @ts-check
const inspectionRules = require('./inspectionRules');
const expeditionCalc = require('./expeditionCalc');
const ecartAnalysis = require('./ecartAnalysis');
const brixCalc = require('./brixCalc');

module.exports = {
  ...inspectionRules,
  ...expeditionCalc,
  ...ecartAnalysis,
  ...brixCalc
};
