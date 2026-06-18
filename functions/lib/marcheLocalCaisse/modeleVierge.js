'use strict';
// @ts-check

/**
 * Générateur de MODÈLE VIERGE du canevas « ENCAISSEMENTS » (compte client Marché Local).
 *
 * Dérive UNIQUEMENT du schéma déclaratif (ENCAISSEMENTS_SCHEMA). Zéro dérive :
 * modifier le schéma change automatiquement le modèle généré.
 *
 * Aucune écriture Firestore. Pas d'I/O implicite : `buildModeleWorkbook` retourne un
 * workbook XLSX en mémoire ; c'est à l'appelant de l'écrire s'il le souhaite.
 *
 * @typedef {import('./encaissements.js').EncaissementsSchema} EncaissementsSchema
 * @typedef {import('./encaissements.js').ClientRef} ClientRef
 */

const XLSX = require('xlsx');

/**
 * Construit la structure AOA (array of arrays) du modèle :
 *   - ligne 1 : en-têtes (schema.columns[].header) dans l'ordre.
 *   - ligne 2 : exemple réaliste (sera grisé dans le workbook).
 *
 * @param {EncaissementsSchema} schema
 * @param {{clients: ClientRef[]}} deps
 * @returns {Array<Array<string>>}
 */
function buildModeleAoA(schema, deps) {
  const clients = (deps && deps.clients) || [];
  const headers = schema.columns.map((c) => c.header);

  const firstClientNom = clients.length ? clients[0].nom : 'Nom du client';

  const example = schema.columns.map((col) => {
    switch (col.key) {
      case 'client':
        return firstClientNom;
      case 'date':
        return '15/06/2026';
      case 'montant':
        return '27 445,00';
      case 'mode':
        return (col.options && col.options[0]) || 'Espèces';
      case 'reference':
        return 'CHQ-000123';
      case 'motif':
        return 'Acompte sur livraisons framboise';
      default:
        return '';
    }
  });

  return [headers, example];
}

/**
 * Construit un workbook XLSX (en mémoire) du modèle vierge.
 *
 * LIMITE CONNUE (SheetJS community 0.18.5) : l'écriture de validations de données
 * (listes déroulantes via `!dataValidation`) n'est PAS supportée — la propriété
 * n'est pas sérialisée à l'écriture. Le modèle inclut donc : en-têtes, ligne
 * d'exemple, largeurs de colonnes (`!cols`), et les listes autorisées documentées
 * via `meta` (à câbler côté front à l'intégration). On expose néanmoins les listes
 * dans `wb.MarcheLocal` pour le front.
 *
 * @param {EncaissementsSchema} schema
 * @param {{clients: ClientRef[]}} deps
 * @returns {Object} workbook XLSX
 */
function buildModeleWorkbook(schema, deps) {
  const clients = (deps && deps.clients) || [];
  const aoa = buildModeleAoA(schema, deps);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Largeurs de colonnes proportionnelles aux en-têtes / exemples.
  ws['!cols'] = schema.columns.map((col) => {
    const headerLen = col.header.length;
    const wch = Math.max(14, Math.min(40, headerLen + 6));
    return { wch };
  });

  // Listes de validation (NON sérialisées par SheetJS 0.18.5 — exposées pour le front).
  const clientOptions = clients.map((c) => c.nom);
  const modeCol = schema.columns.find((c) => c.key === 'mode');
  const modeOptions = (modeCol && modeCol.options) || [];

  const validations = {
    client: clientOptions,
    mode: modeOptions,
  };
  // Tentative best-effort : poser !dataValidation (ignoré à l'écriture par 0.18.5).
  ws['!dataValidation'] = [
    { sqref: 'A2:A1000', type: 'list', formulae: [clientOptions.join(',')] },
    { sqref: 'D2:D1000', type: 'list', formulae: [modeOptions.join(',')] },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, schema.sheet);

  // Métadonnées exploitables côté front pour recréer les dropdowns.
  wb.MarcheLocal = {
    schemaId: schema.id,
    sheet: schema.sheet,
    headers: schema.columns.map((c) => c.header),
    validations,
  };

  return wb;
}

module.exports = {
  buildModeleAoA,
  buildModeleWorkbook,
};
