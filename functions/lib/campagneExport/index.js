/**
 * campagneExport — génération SERVEUR du classeur Excel « Campagne analytique ».
 *
 * Point d'entrée du module. Produit, à partir du payload de l'action
 * `campagne-analytique-detail`, le MÊME classeur que le navigateur (feuille
 * Synthèse + une feuille par parcelle, colonnes JH / Total JH par Ha et les 4
 * colonnes de suivi budgétaire, mise en forme comprise), sous forme de Buffer.
 *
 * Le module est PUR au sens Firestore : il ne lit rien, tout lui est injecté
 * (payload, référentiel parcelle, budgets, périmètre). Le chargement des
 * données reste à l'appelant — `computeCampagneAnalytiqueDetail` et le
 * référentiel côté functions/src/modules/rh/pointageService.js.
 *
 * Il n'expose AUCUNE Cloud Function : c'est un module interne, appelé par
 * l'existant. (Une function créée après la bascule WIF naîtrait sans variables
 * d'environnement — cf. docs/deploy-wif-prod.md §8.)
 */
// @ts-check
'use strict';

const campagneExportUtils = require('./campagneExportUtils');
const cultureUtils = require('./cultureUtils');
const analytiqueUtils = require('./analytiqueUtils');
const buildWorkbook = require('./buildWorkbook');
const renderXlsx = require('./renderXlsx');

/**
 * Chaîne complète : description du classeur → Buffer .xlsx.
 *
 * @param {*} params cf. buildWorkbook.buildCultureWorkbook
 *   ({ culture, data, fermeFilter, sbMap, budgetsByLabel, opBudgetsByLabel,
 *     today })
 * @param {*} [deps] { ExcelJS, now } — injection pour les tests
 * @returns {Promise<{fileName:string, buffer:Buffer, nbFeuilles:number}>}
 *   `fileName` inclut l'extension `.xlsx` (le front l'ajoute au moment du
 *   téléchargement ; côté serveur on renvoie le nom final).
 */
async function generateCampagneWorkbook(params, deps) {
  const wbData = buildWorkbook.buildCultureWorkbook(params);
  const buffer = await renderXlsx.renderWorkbookBuffer(wbData, deps);
  return {
    fileName: wbData.fileName + '.xlsx',
    buffer: buffer,
    nbFeuilles: wbData.sheets.length,
  };
}

module.exports = {
  campagneExportUtils,
  cultureUtils,
  analytiqueUtils,
  buildCultureWorkbook: buildWorkbook.buildCultureWorkbook,
  buildVarieteView: buildWorkbook.buildVarieteView,
  renderWorkbookBuffer: renderXlsx.renderWorkbookBuffer,
  generateCampagneWorkbook,
};
