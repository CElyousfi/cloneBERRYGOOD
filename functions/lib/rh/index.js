const quinzaineUtils = require('./quinzaineUtils');
const pointageCalc = require('./pointageCalc');
const transportConfig = require('./transportConfig');

module.exports = {
  ...quinzaineUtils,
  ...pointageCalc,
  ...transportConfig,
};
