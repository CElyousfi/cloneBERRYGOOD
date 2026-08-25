// @ts-check
/**
 * Finance domain — public barrel.
 * Exports pure business logic + repository interface.
 * Repository (Firestore vs Postgres) is injected by index.js orchestrator.
 */
'use strict';
const invoiceWorkflow = require('./invoiceWorkflow');
const caisseLogic = require('./caisseLogic');
const liquidationCalc = require('./liquidationCalc');
const repository = require('./repository');

module.exports = { ...invoiceWorkflow, ...caisseLogic, ...liquidationCalc, repository };
