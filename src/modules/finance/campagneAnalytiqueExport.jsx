/*
 * campagneAnalytiqueExport.jsx — export Excel de l'écran Campagne : classeur
 * par culture (buildCultureWorkbook), chargement paresseux d'ExcelJS depuis
 * le CDN, rendu stylé (styles, bordures, volets figés) et repli SheetJS / CSV
 * sans styles.
 *
 * Extrait de CampagneAnalytiqueTab.jsx (déplacement de code, sans modification).
 */

import * as AnalytiqueUtils from '../shared/lib/analytiqueUtils.js';
import * as CampagneExportUtils from '../shared/lib/campagneExportUtils.js';
import { CampagneBudgetTab } from './CampagneBudgetTab.jsx';
import { C, FAMILLE_ICONS, CAT_CULTURE_INCONNUE, fmtDH, fmtJH, fmtHa, fmtHaLabel, fmtDHPerHa, fmtQty, cultureOf, matchCulture, sbNom, sbHa, CAT_budgetsByLabel, CAT_opBudgetsByLabel, buildVarieteView, CAT_pivotRows, CAT_byCulture } from './campagneAnalytiqueHelpers.jsx';

/* ------------------------------------------------------------------ */
/* Export Excel — une feuille Synthèse + une feuille par parcelle       */
/* ------------------------------------------------------------------ */

/**
 * Construit les feuilles du classeur d'une culture. Indépendant du filtre
 * Culture de l'écran et de la parcelle sélectionnée, mais respecte le
 * farmFilter (périmètre du profil chef).
 * Retourne { fileName, sheets: [{ name, rows, aoa, cols }] } :
 *   - `rows` = lignes typées (ROW_KIND) consommées par le rendu ExcelJS ;
 *   - `aoa`  = les mêmes lignes aplaties, pour le repli SheetJS puis CSV ;
 *   - `cols` = largeurs de colonnes, honorées par les deux moteurs.
 */
function buildCultureWorkbook(culture, data, farmFilter, sbMap, budgetsByLabel, opBudgetsByLabel) {
  var CEU = CampagneExportUtils;
  var rows = (data && data.rows) || [];
  var periodes = (data && data.periodes) || [];
  var haByRef = (data && data.haByRef) || {};
  var budgets = budgetsByLabel || {};
  var opBudgets = opBudgetsByLabel || {};
  // Règle métier du budget + référentiel analytique, INJECTÉS dans les helpers
  // purs (qui n'ont pas le droit de lire `window`). Modules absents → l'index
  // dégrade vers le seul niveau famille, exactement comme avant ce lot.
  var budgetRules = CampagneBudgetTab;
  var analytique = AnalytiqueUtils;

  // Parcelles de la culture (distinctes, ordre alphabétique du nom SB)
  var seen = {};
  var labels = [];
  rows.forEach(function (r) {
    var label = r.parcelle || r.refParcelle;
    if (!label || seen[label]) return;
    if (farmFilter && r.ferme !== farmFilter) return;
    if (cultureOf(label, sbMap) !== culture) return;
    seen[label] = { ferme: r.ferme };
    labels.push(label);
  });
  labels.sort(function (a, b) { return sbNom(a, sbMap).localeCompare(sbNom(b, sbMap)); });

  var synthese = [];
  var sheets = [];
  // Dictionnaire de noms de feuille PARTAGÉ : la Synthèse réserve son nom en
  // premier, sinon une parcelle nommée « Synthèse » ferait échouer
  // book_append_sheet (nom déjà pris) et planterait l'export.
  var used = {};
  var syntheseName = CEU.safeSheetName('Synthèse', 0, used);
  labels.forEach(function (label, i) {
    var opRows = buildVarieteView(rows, label, periodes);
    var totalJh = 0;
    // JH par famille : le suivi budgétaire compare à PÉRIMÈTRE ÉGAL — sans ce
    // détail, la Synthèse imputerait au budget les JH de familles non
    // budgétées (dépassement fantôme, cf. régression QA LOT 2).
    var jhByFamille = {};
    opRows.forEach(function (r) {
      totalJh += r.total.jh;
      if (!r.famille) return;
      jhByFamille[r.famille] = (jhByFamille[r.famille] || 0) + (r.total.jh || 0);
    });
    var ha = sbHa(label, sbMap, haByRef);
    var nom = sbNom(label, sbMap);
    // Budgets JH/Ha de la parcelle : jointure sur le libellé BEE ONE
    // normalisé, EXACTEMENT comme sbMap/sbHa (trim + majuscules) — toute
    // autre normalisation ferait silencieusement rater la jointure.
    var budKey = String(label || '').toUpperCase().trim();
    var budParcelle = budgets[budKey] || {};
    // Détail par opération : MÊME clé, même normalisation — une divergence
    // ici ne lève rien, elle vide simplement les colonnes.
    var opBudParcelle = opBudgets[budKey] || {};
    var params = {
      nomSb: nom,
      ha: ha,
      culture: culture,
      campagne: (data && data.campagne) || '',
      periodes: periodes,
      opRows: opRows,
      famillesOrdered: (data && data.famillesOrdered) || [],
      budgets: budParcelle,
      budgetsOperations: opBudParcelle,
      budgetRules: budgetRules,
      analytique: analytique,
    };
    // La Synthèse reçoit les budgets EFFECTIFS par famille (règle
    // `familleTotal` appliquée), pas la saisie brute : sinon une parcelle
    // budgétée à la maille opération sortirait remplie sur sa feuille et vide
    // sur la Synthèse.
    var budgetIndex = CEU.buildParcelleBudgetIndex({
      budgets: budParcelle,
      budgetsOperations: opBudParcelle,
      budgetRules: budgetRules,
      analytique: analytique,
    });
    synthese.push({
      nomSb: nom,
      label: label,
      ferme: seen[label].ferme,
      ha: ha,
      totalJh: totalJh,
      budgets: budgetIndex.resolveFamilles(opRows, params.famillesOrdered).scope,
      jhByFamille: jhByFamille,
    });
    sheets.push({
      name: CEU.safeSheetName(nom, i + 1, used),
      rows: CEU.buildParcelleSheetRows(params),
      aoa: CEU.buildParcelleSheetAoA(params),
      cols: CEU.parcelleSheetCols(periodes.length),
    });
  });

  return {
    fileName: 'Campagne_' + culture + '_' + new Date().toISOString().slice(0, 10),
    sheets: [{
      name: syntheseName,
      rows: CEU.buildSyntheseRows(synthese),
      aoa: CEU.buildSyntheseAoA(synthese),
      cols: CEU.syntheseSheetCols(),
    }].concat(sheets),
  };
}

/* ---- ExcelJS : chargement PARESSEUX au premier clic ---------------- */

// Version FIGÉE (jamais @latest) sur jsDelivr, domaine déjà utilisé par
// index.html. ExcelJS expose ExcelJS — global distinct de XLSX,
// les deux cohabitent (vérifié par smoke-load des deux bundles ensemble).
var EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
var excelJsPromise = null;

/** Charge ExcelJS une seule fois ; rejette si le CDN est injoignable. */
function loadExcelJS() {
  if (typeof ExcelJS !== 'undefined' && ExcelJS) return Promise.resolve(ExcelJS);
  if (excelJsPromise) return excelJsPromise;
  excelJsPromise = new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = EXCELJS_URL;
    s.async = true;
    s.onload = function () {
      if (typeof ExcelJS !== 'undefined' && ExcelJS) { resolve(ExcelJS); return; }
      // Même traitement que onerror : sans reset, le repli deviendrait
      // définitif jusqu'au rechargement de la page.
      excelJsPromise = null;
      reject(new Error('ExcelJS chargé mais la globale ExcelJS est absente'));
    };
    s.onerror = function () {
      // On oublie la promesse rejetée pour qu'un 2e clic puisse réessayer.
      excelJsPromise = null;
      reject(new Error('CDN ExcelJS injoignable'));
    };
    document.head.appendChild(s);
  });
  return excelJsPromise;
}

/* ---- Rendu ExcelJS (styles, bordures, volets figés) ---------------- */

var XL = {
  berry:      'FFC0392B',
  berryLight: 'FFF7E3E1',
  grayLight:  'FFEBEAE3',
  white:      'FFFFFFFF',
  textSec:    'FF5F5E5A',
  border:     'FFD8D6CF',
  // Dépassement de budget (> 100 % consommé) — rouge/rose « Incorrect »
  // d'Excel, lisible aussi en niveaux de gris à l'impression.
  badText:    'FF9C0006',
  badFill:    'FFFFC7CE',
};

function xlFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb } };
}

/**
 * Applique un style sur TOUTE la largeur de la feuille (1..nbCols), y compris
 * les cellules vides : `row.eachCell` s'arrête à la dernière cellule
 * renseignée, ce qui donnait un aplat limité à la colonne A sur les lignes
 * ne portant qu'un libellé (famille, total…) au lieu d'un bandeau.
 */
function styleFullWidth(row, nbCols, fn) {
  for (var c = 1; c <= nbCols; c += 1) fn(row.getCell(c));
}

/** Applique le style correspondant au `kind` d'une ligne. */
function styleRow(row, kind, K, nbCols) {
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
    // Mention de périmètre : discrète (italique, gris), jamais un bandeau —
    // elle informe sans concurrencer les totaux.
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

/** Écrit le classeur stylé avec ExcelJS et déclenche le téléchargement. */
function writeWithExcelJS(ExcelJS, wbData) {
  var CEU = CampagneExportUtils;
  var K = CEU.ROW_KIND;
  var wb = new ExcelJS.Workbook();
  wb.creator = 'Smart Berry';
  wb.created = new Date();

  wbData.sheets.forEach(function (s) {
    var ws = wb.addWorksheet(s.name);
    if (s.cols) {
      ws.columns = s.cols.map(function (c) { return { width: c.wch }; });
    }
    // Largeur de la feuille : les largeurs de colonnes font foi, avec un
    // garde-fou sur la ligne la plus longue (feuille sans `cols`).
    var nbCols = (s.cols && s.cols.length) || 0;
    s.rows.forEach(function (r) {
      if (r.cells.length > nbCols) nbCols = r.cells.length;
    });
    var headerRowIndex = 0;
    // Colonne(s) « % Consommé » repérées par leur EN-TÊTE (jamais un index en
    // dur) : elles portent un RATIO, à afficher avec un format de pourcentage
    // — c'est le code de format qui multiplie par 100.
    var pctCols = {};
    CEU.percentColumns(s.rows).forEach(function (c) { pctCols[c] = true; });
    s.rows.forEach(function (r, i) {
      var row = ws.addRow(r.cells);
      if (r.kind === K.COL_HEADER) headerRowIndex = i + 1;
      styleRow(row, r.kind, K, nbCols);
      // Nombres : alignés à droite, format lisible (séparateur de milliers).
      // Le format est choisi VALEUR PAR VALEUR (CEU.numFmtFor) : un format
      // unique `#,##0.##` laisse un séparateur décimal traîner sur les
      // entiers (« 6. », « 12. »).
      row.eachCell({ includeEmpty: false }, function (cell, col) {
        if (col === 1) return;
        if (pctCols[col] && r.kind !== K.COL_HEADER) {
          var pfmt = CEU.percentFmtFor(cell.value);
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
        var fmt = CEU.numFmtFor(cell.value);
        if (fmt) {
          cell.alignment = { horizontal: 'right' };
          cell.numFmt = fmt;
        }
      });
    });
    // Volets figés sous l'en-tête de colonnes (ignoré par SheetJS community).
    if (headerRowIndex) {
      ws.views = [{ state: 'frozen', xSplit: 1, ySplit: headerRowIndex }];
    }
  });

  return wb.xlsx.writeBuffer().then(function (buf) {
    downloadBlob(new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }), wbData.fileName + '.xlsx');
  });
}

/* ---- Repli SheetJS / CSV (sans styles) ----------------------------- */

function downloadBlob(blob, fileName) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = fileName;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Repli quand ExcelJS n'a pas pu être chargé : fichier SANS mise en forme. */
function writeWithoutStyles(wbData) {
  var CEU = CampagneExportUtils;
  if (typeof XLSX !== 'undefined') {
    var wb = XLSX.utils.book_new();
    wbData.sheets.forEach(function (s) {
      var ws = XLSX.utils.aoa_to_sheet(s.aoa);
      // Largeurs de colonnes : seule mise en forme honorée par SheetJS
      // community (les styles de cellule et les volets figés sont ignorés).
      if (s.cols) ws['!cols'] = s.cols;
      // Format de pourcentage (`z`) sur la colonne « % Consommé » : la
      // cellule porte un RATIO, la lire sans format donnerait « 0,75 » là où
      // il faut lire « 75 % ». Les formats numériques, contrairement aux
      // styles, sont écrits par le build community.
      CEU.percentColumns(s.rows).forEach(function (col) {
        s.aoa.forEach(function (r, ri) {
          var addr = XLSX.utils.encode_cell({ c: col - 1, r: ri });
          var cell = ws[addr];
          if (!cell || cell.t !== 'n') return;
          var fmt = CEU.percentFmtFor(cell.v);
          if (fmt) cell.z = fmt;
        });
      });
      XLSX.utils.book_append_sheet(wb, ws, s.name);
    });
    XLSX.writeFile(wb, wbData.fileName + '.xlsx');
    return;
  }

  // Dernier repli : CSV de la feuille Synthèse si SheetJS est absent aussi.
  // Le CSV ne porte AUCUN format : la cellule de pourcentage y sort en ratio
  // brut (0,75). Sous un en-tête « % Consommé » ça se lirait « 0,75 % » — on
  // renomme donc l'en-tête (et LUI SEUL, les valeurs restent identiques à
  // celles des autres rendus).
  var syntheseSheet = wbData.sheets[0];
  var pctCols = CEU.percentColumns(syntheseSheet.rows);
  var csv = syntheseSheet.aoa.map(function (r, ri) {
    var cells = r;
    if (ri === 0 && pctCols.length) {
      cells = r.slice();
      pctCols.forEach(function (col) {
        if (cells[col - 1] === CEU.PERCENT_HEADER) cells[col - 1] = CEU.PERCENT_HEADER + ' (ratio)';
      });
    }
    return cells.map(function (c) {
      var s = String(c == null ? '' : c);
      return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';');
  }).join('\n');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), wbData.fileName + '.csv');
}

/**
 * Export d'une culture. Charge ExcelJS à la demande pour un fichier stylé ;
 * si le CDN est injoignable, retombe sur l'export SheetJS (sans styles)
 * plutôt que d'échouer. Retourne toujours une Promise résolue.
 */
function exportCulture(culture, data, farmFilter, sbMap, budgetsByLabel, opBudgetsByLabel) {
  if (!CampagneExportUtils) return Promise.resolve();
  var wbData = buildCultureWorkbook(
    culture, data, farmFilter, sbMap, budgetsByLabel, opBudgetsByLabel
  );
  if (wbData.sheets.length <= 1) {
    window.alert('Aucune parcelle ' + culture + ' dans le périmètre.');
    return Promise.resolve();
  }

  return loadExcelJS()
    .then(function (ExcelJS) { return writeWithExcelJS(ExcelJS, wbData); })
    .catch(function (e) {
      if (window.console) {
        console.warn('[Campagne] Export stylé indisponible (' + (e && e.message) + ') — repli sans mise en forme.');
      }
      writeWithoutStyles(wbData);
    });
}

export { buildCultureWorkbook, EXCELJS_URL, excelJsPromise, loadExcelJS, XL, xlFill, styleFullWidth, styleRow, writeWithExcelJS, downloadBlob, writeWithoutStyles, exportCulture };
