'use strict';
// @ts-check

/**
 * budgetBgf.js — Mirror of frontend BUDGET_BGF_DEFAULT (public/app.jsx:2154).
 *
 * Only the `total` (kg/ha target for the full cycle) is kept here;
 * the per-week `distribution` array is irrelevant for the WhatsApp recap.
 *
 * If these defaults change in the frontend, update this file in lockstep.
 */

/** @type {Record<string, { total: number }>} */
const BUDGET_BGF = {
  'Maravilla Green Cane': { total: 13000 },
  'Maravilla Long Cane':  { total: 18000 },
  'Yazmin Bi Cycle':      { total: 10000 },
  'Corina':               { total: 13200 },
  'Breeze':               { total: 13500 },
  'Cascade':              { total: 16760 },
};

module.exports = { BUDGET_BGF };
