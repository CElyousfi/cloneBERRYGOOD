/**
 * Productivity Report module — constants partagées.
 */

const DRISCOLL_GROWER_CODES = Object.freeze({
  F1: '172',
  F5: '195',
});

const FARMS = Object.freeze(['F1', 'F5']);

const CATEGORIES = Object.freeze(['raspberry', 'blackberry', 'strawberry', 'blueberry']);

const TOP25_PERCENTILE = 0.75;

module.exports = {
  DRISCOLL_GROWER_CODES,
  FARMS,
  CATEGORIES,
  TOP25_PERCENTILE,
};
