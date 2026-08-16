/**
 * fixtures.js — jeu de données partagé par les tests du module campagneExport.
 *
 * Reproduit la forme EXACTE du payload de l'action `campagne-analytique-detail`
 * et du référentiel Smart Berry. Le scénario est celui de la régression QA du
 * LOT 2 (comparaison budgétaire à périmètre égal) : une parcelle de 2 ha avec
 * « Travaux du sol » NON budgété (30 JH) et « Récolte » budgété 10 JH/ha
 * (15 JH réalisés) → 75 % consommé, jamais 225 %.
 */
'use strict';

/** Payload campagne-analytique-detail (3 parcelles, 2 quinzaines). */
const DATA = {
  success: true,
  campagne: '2025/2026',
  periodes: ['Quinzaine 1', 'Quinzaine 2'],
  famillesOrdered: ['Travaux du sol', 'Récolte', 'Taille'],
  haByRef: { 'S12 YAZMIN': 2, 'S3 CORINA': 1.5, 'F2 ZUTANO': 3 },
  rows: [
    {
      parcelle: 'S12 YAZMIN', refParcelle: 'R12', ferme: 'F1', periode: 'Quinzaine 1',
      operation: 'Désherbage', groupe: '', famille: 'Travaux du sol', code: 'T01',
      jh: 30, cout: 3000,
    },
    {
      parcelle: 'S12 YAZMIN', refParcelle: 'R12', ferme: 'F1', periode: 'Quinzaine 2',
      operation: 'Cueillette', groupe: '', famille: 'Récolte', code: 'R01',
      jh: 15, cout: 1500,
    },
    {
      parcelle: 'S12 YAZMIN', refParcelle: 'R12', ferme: 'F1', periode: 'Quinzaine 1',
      operation: 'Cueillette', groupe: '', famille: 'Récolte', code: 'R01',
      jh: 0, cout: 0,
    },
    // Parcelle framboise d'une AUTRE ferme (test du fermeFilter).
    {
      parcelle: 'B4 ADELITA', refParcelle: 'R44', ferme: 'BAHIA', periode: 'Quinzaine 1',
      operation: 'Taille sèche', groupe: '', famille: 'Taille', code: 'X01',
      jh: 8, cout: 800,
    },
    // Parcelle myrtille : hors culture 'Framboise'.
    {
      parcelle: 'S3 CORINA', refParcelle: 'R03', ferme: 'F5', periode: 'Quinzaine 2',
      operation: 'Palissage', groupe: '', famille: 'Travaux du sol', code: 'T05',
      jh: 4, cout: 400,
    },
  ],
};

/**
 * Référentiel Smart Berry. Note le piège prod volontaire : 'S12 YAZMIN' est
 * NOMMÉE « MYRTILLE EXTENSION » mais sa culture_sb est Framboise.
 */
const SB_MAP = {
  'S12 YAZMIN': { nom_sb: 'MYRTILLE EXTENSION', culture_sb: 'Framboise', ha: 2 },
  'S3 CORINA': { nom_sb: 'BLEUET NORD', culture_sb: 'Myrtille', ha: 1.5 },
  'B4 ADELITA': { nom_sb: 'BAHIA 4', culture_sb: 'Framboise', ha: 0 },
};

/** Budgets JH/Ha par parcelle × famille (écran Campagne › Budget). */
const BUDGETS = {
  'S12 YAZMIN': { 'Récolte': 10 },
};

/**
 * Budgets JH/Ha par parcelle × famille × OPÉRATION (`budgets_operations`).
 *
 * Clé d'opération : `CODE::Libellé`, la forme canonique persistée par
 * `campagneBudget.opKey`. Le code est un code GB du référentiel, jamais le code
 * BEE ONE porté par les lignes de pointage (ici 'R01') : c'est
 * `AnalytiqueUtils.resolveGbCode` qui rapproche les deux espaces de noms.
 *
 * RÈGLE MÉTIER en jeu (`familleTotal`) : « Récolte » vaut donc 7 JH/ha (les
 * opérations ÉCRASENT le 10 saisi au niveau famille), jamais 17.
 */
const OP_BUDGETS = {
  'S12 YAZMIN': { 'Récolte': { 'GB08::Cueillette': 7 } },
};

/** Date figée : le nom de fichier doit être déterministe. */
const TODAY = new Date('2026-08-12T09:00:00.000Z');

module.exports = { DATA, SB_MAP, BUDGETS, OP_BUDGETS, TODAY };
