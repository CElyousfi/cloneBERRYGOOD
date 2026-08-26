'use strict';
// @ts-check

/**
 * consoBons — point d'entrée du module « consommation depuis les bons Smart
 * Berry ». Voir bonsToConsoRows.js pour le contexte de la bascule BEE ONE →
 * `consumption_vouchers` (ticket sb/conso-campagne-bons).
 */

const { adaptBonsToConsoRows, categorieOf, quantiteOf } = require('./bonsToConsoRows');
const { aggregateConsoParcelle } = require('./aggregateParcelle');
const { fermeDeParcelle, resolveFermeInconnue } = require('./fermeConso');
const { fetchBonsConsommation, fetchReferentielParcelles } = require('./fetchBons');

module.exports = {
  adaptBonsToConsoRows,
  categorieOf,
  quantiteOf,
  aggregateConsoParcelle,
  fermeDeParcelle,
  resolveFermeInconnue,
  fetchBonsConsommation,
  fetchReferentielParcelles,
};
