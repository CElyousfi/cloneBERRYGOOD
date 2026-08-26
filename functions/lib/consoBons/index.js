'use strict';
// @ts-check

/**
 * consoBons — point d'entrée du module « consommation depuis les bons Smart
 * Berry ». Voir bonsToConsoRows.js pour le contexte de la bascule BEE ONE →
 * `consumption_vouchers` (ticket sb/conso-campagne-bons).
 */

const {
  adaptBonsToConsoRows,
  categorieOf,
  quantiteOf,
  alnumArticleKey,
  buildArticleCategoryIndex,
  lookupArticleCategorie,
} = require('./bonsToConsoRows');
const { aggregateConsoParcelle, articlesAClasser } = require('./aggregateParcelle');
const { fermeDeParcelle, resolveFermeInconnue } = require('./fermeConso');
const {
  fetchBonsConsommation,
  fetchReferentielParcelles,
  fetchArticleCategories,
} = require('./fetchBons');

module.exports = {
  adaptBonsToConsoRows,
  categorieOf,
  quantiteOf,
  alnumArticleKey,
  buildArticleCategoryIndex,
  lookupArticleCategorie,
  aggregateConsoParcelle,
  articlesAClasser,
  fermeDeParcelle,
  resolveFermeInconnue,
  fetchBonsConsommation,
  fetchReferentielParcelles,
  fetchArticleCategories,
};
