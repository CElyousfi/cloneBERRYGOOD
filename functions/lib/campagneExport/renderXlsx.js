/**
 * renderXlsx.js — Rendu ExcelJS du classeur « Campagne » côté SERVEUR.
 *
 * Port serveur de `writeWithExcelJS` / `styleRow`
 * (public/components/CampagneAnalytiqueTab.jsx) : mêmes couleurs, même gras,
 * mêmes bordures, mêmes volets figés, mêmes formats numériques et même mise en
 * évidence des dépassements de budget. Le navigateur charge ExcelJS 4.4.0
 * depuis le CDN ; le backend utilise la MÊME version, figée dans
 * functions/package.json — un écart de version ferait diverger la mise en forme.
 *
 * Différence assumée avec le front : ici on ne télécharge rien, on renvoie le
 * BUFFER du classeur (`workbook.xlsx.writeBuffer()`), jamais un fichier disque —
 * le système de fichiers d'une Cloud Function est éphémère et en lecture seule
 * hors /tmp.
 *
 * ExcelJS est injectable (paramètre `deps.ExcelJS`) pour rester testable sans
 * toucher au require, mais le défaut est bien la dépendance déclarée.
 */
// @ts-check
'use strict';

const CEU = require('./campagneExportUtils');

/** Palette du classeur — copie conforme de `XL` (CampagneAnalytiqueTab.jsx). */
const XL = {
  berry: 'FFC0392B',
  berryLight: 'FFF7E3E1',
  grayLight: 'FFEBEAE3',
  white: 'FFFFFFFF',
  textSec: 'FF5F5E5A',
  border: 'FFD8D6CF',
  // Dépassement de budget (> 100 % consommé) — rouge/rose « Incorrect » d'Excel,
  // lisible aussi en niveaux de gris à l'impression.
  badText: 'FF9C0006',
  badFill: 'FFFFC7CE',
};

/**
 * Remplissage plein d'une couleur ARGB.
 * @param {string} argb
 * @returns {*}
 */
function xlFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } };
}

/**
 * Applique un style sur TOUTE la largeur de la feuille (1..nbCols), y compris
 * les cellules vides : `row.eachCell` s'arrête à la dernière cellule
 * renseignée, ce qui donnerait un aplat limité à la colonne A sur les lignes ne
 * portant qu'un libellé (famille, total…) au lieu d'un bandeau.
 * @param {*} row
 * @param {number} nbCols
 * @param {(cell: any) => void} fn
 */
function styleFullWidth(row, nbCols, fn) {
  for (let c = 1; c <= nbCols; c += 1) fn(row.getCell(c));
}

/**
 * Applique le style correspondant au `kind` d'une ligne.
 * @param {*} row      ligne ExcelJS
 * @param {string} kind valeur de CEU.ROW_KIND
 * @param {number} nbCols largeur de la feuille
 */
function styleRow(row, kind, nbCols) {
  const K = CEU.ROW_KIND;
  if (kind === K.META) {
    row.getCell(1).font = { bold: true, color: { argb: XL.textSec } };
    return;
  }
  if (kind === K.COL_HEADER) {
    row.font = { bold: true, color: { argb: XL.white } };
    styleFullWidth(row, nbCols, function (cell) {
      cell.font = { bold: true, color: { argb: XL.white } };
      cell.fill = xlFill(XL.berry);
    });
    return;
  }
  if (kind === K.FAMILLE) {
    row.font = { bold: true };
    styleFullWidth(row, nbCols, function (cell) {
      cell.font = { bold: true };
      cell.fill = xlFill(XL.grayLight);
    });
    return;
  }
  if (kind === K.OPERATION) {
    // Indentation NATIVE Excel (pas d'espaces en dur) : alignement propre et
    // libellé toujours recherchable tel quel.
    row.getCell(1).alignment = { indent: 1 };
    return;
  }
  if (kind === K.NOTE) {
    // Mention de périmètre : discrète (italique, gris), jamais un bandeau.
    row.getCell(1).font = { italic: true, size: 9, color: { argb: XL.textSec } };
    return;
  }
  if (kind === K.TOTAL_FAMILLE) {
    row.font = { bold: true };
    styleFullWidth(row, nbCols, function (cell) {
      cell.font = { bold: true };
      cell.border = { top: { style: 'thin', color: { argb: XL.border } } };
    });
    return;
  }
  if (kind === K.TOTAL_GENERAL) {
    row.font = { bold: true };
    styleFullWidth(row, nbCols, function (cell) {
      cell.font = { bold: true };
      cell.fill = xlFill(XL.berryLight);
      cell.border = { top: { style: 'medium', color: { argb: XL.berry } } };
    });
  }
}

/**
 * Construit le classeur ExcelJS (non sérialisé) depuis la description produite
 * par buildCultureWorkbook.
 *
 * @param {*} wbData { fileName, sheets: [{ name, rows, cols }] }
 * @param {*} [deps] { ExcelJS } — injection pour les tests
 * @returns {*} instance ExcelJS.Workbook
 */
function buildExcelWorkbook(wbData, deps) {
  const ExcelJS = (deps && deps.ExcelJS) || require('exceljs');
  const K = CEU.ROW_KIND;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Berry';
  wb.created = (deps && deps.now) || new Date();

  ((wbData && wbData.sheets) || []).forEach(function (s) {
    const ws = wb.addWorksheet(s.name);
    if (s.cols) {
      ws.columns = s.cols.map(function (c) { return { width: c.wch }; });
    }
    // Largeur de la feuille : les largeurs de colonnes font foi, avec un
    // garde-fou sur la ligne la plus longue (feuille sans `cols`).
    let nbCols = (s.cols && s.cols.length) || 0;
    (s.rows || []).forEach(function (r) {
      if (r.cells.length > nbCols) nbCols = r.cells.length;
    });
    let headerRowIndex = 0;
    // Colonne(s) « % Consommé » repérées par leur EN-TÊTE (jamais un index en
    // dur) : elles portent un RATIO, à afficher avec un format de pourcentage —
    // c'est le code de format qui multiplie par 100.
    const pctCols = {};
    CEU.percentColumns(s.rows).forEach(function (c) { pctCols[c] = true; });

    (s.rows || []).forEach(function (r, i) {
      const row = ws.addRow(r.cells);
      if (r.kind === K.COL_HEADER) headerRowIndex = i + 1;
      styleRow(row, r.kind, nbCols);
      // Nombres : alignés à droite, format choisi VALEUR PAR VALEUR
      // (CEU.numFmtFor) — un format unique `#,##0.##` laisse un séparateur
      // décimal traîner sur les entiers (« 6. », « 12. »).
      row.eachCell({ includeEmpty: false }, function (cell, col) {
        if (col === 1) return;
        if (pctCols[col] && r.kind !== K.COL_HEADER) {
          const pfmt = CEU.percentFmtFor(cell.value);
          if (!pfmt) return;
          cell.alignment = { horizontal: 'right' };
          cell.numFmt = pfmt;
          // Dépassement : signalé, JAMAIS plafonné (la valeur reste exacte).
          if (cell.value > 1) {
            cell.font = { bold: true, color: { argb: XL.badText } };
            cell.fill = xlFill(XL.badFill);
          }
          return;
        }
        const fmt = CEU.numFmtFor(cell.value);
        if (fmt) {
          cell.alignment = { horizontal: 'right' };
          cell.numFmt = fmt;
        }
      });
    });
    // Volets figés sous l'en-tête de colonnes.
    if (headerRowIndex) {
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRowIndex }];
    }
  });

  return wb;
}

/**
 * Sérialise le classeur en Buffer .xlsx. Aucune écriture disque.
 *
 * @param {*} wbData sortie de buildCultureWorkbook
 * @param {*} [deps] { ExcelJS, now }
 * @returns {Promise<Buffer>}
 */
async function renderWorkbookBuffer(wbData, deps) {
  const wb = buildExcelWorkbook(wbData, deps);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

module.exports = {
  XL,
  xlFill,
  styleFullWidth,
  styleRow,
  buildExcelWorkbook,
  renderWorkbookBuffer,
};
