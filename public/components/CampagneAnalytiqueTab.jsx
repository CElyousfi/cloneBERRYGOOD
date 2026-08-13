/*
 * CampagneAnalytiqueTab.jsx — Campagne analytique (MO + Engrais + Pesticides)
 *
 * 3 sub-tabs : Main Oeuvre | Engrais | Pesticides
 * 4 culture filters : Toutes | Framboise | Myrtille | Avocatier
 *
 * Sources :
 *   GET /api/pointage-rh?action=campagne-analytique-detail  (MO)
 *   GET /api/pointage-rh?action=campagne-conso-parcelle     (Engrais/Pesticides)
 *
 * Pattern UMD — expose window.CampagneAnalytiqueTab
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;

  /* ------------------------------------------------------------------ */
  /* Palette                                                              */
  /* ------------------------------------------------------------------ */
  var C = {
    berry:    '#c0392b',
    green:    '#1D9E75',
    blue:     '#2563eb',
    gray:     '#888780',
    surface:  '#ffffff',
    surface2: '#f5f4ef',
    surface3: '#ebeae3',
    border:   'rgba(0,0,0,0.10)',
    text:     '#1c1c1a',
    textSec:  '#5f5e5a',
  };

  /* ------------------------------------------------------------------ */
  /* Icônes familles (copié de ParcellesReferentielTab pour cohérence)   */
  /* ------------------------------------------------------------------ */
  var FAMILLE_ICONS = {
    'Travaux du sol':        'fa-trowel',
    'Ferti-irrigation':      'fa-droplet',
    'Plantation':            'fa-seedling',
    'Mise en valeur':        'fa-hammer',
    'Entretien structure':   'fa-screwdriver-wrench',
    'Traitement phyto':      'fa-spray-can',
    'Tuteurage & palissage': 'fa-grip-lines-vertical',
    'Taille':                'fa-scissors',
    'Arrachage':             'fa-shovel',
    'Services généraux':     'fa-people-group',
    'Récolte':               'fa-basket-shopping',
  };

  /**
   * Identité visuelle des cultures dans la vue Pivot analytique — MÊMES
   * couleurs et icônes que le panneau Affectation Analytique de l'écran
   * Quinzaine, pour qu'un utilisateur reconnaisse la même grille d'un écran à
   * l'autre.
   */
  var CAT_CULTURES_DEF = [
    { culture: 'Framboise', color: '#8B2252', icon: 'fa-seedling' },
    { culture: 'Myrtille',  color: '#3498DB', icon: 'fa-circle-dot' },
    { culture: 'Avocatier', color: '#2D8B4E', icon: 'fa-tree' },
  ];

  /* ------------------------------------------------------------------ */
  /* Formatage                                                            */
  /* ------------------------------------------------------------------ */
  function fmtDH(v) {
    if (!v || v === 0) return '—';
    return Math.round(v).toLocaleString('fr-MA');
  }

  function fmtJH(v) {
    if (!v || v === 0) return '—';
    return (Math.round(v * 10) / 10).toLocaleString('fr-MA');
  }

  function fmtHa(v) {
    if (!v || v === 0) return '—';
    return parseFloat(v).toFixed(2);
  }

  /**
   * Superficie affichée en locale fr ('2,40 ha' / '—'). Même format que
   * l'en-tête des feuilles Excel (source unique : CampagneExportUtils.haLabel),
   * avec un repli local si le module n'est pas chargé. fmtHa est laissé
   * inchangé : il sert aussi aux colonnes Ha des tableaux.
   */
  function fmtHaLabel(v) {
    var CEU = window.CampagneExportUtils;
    if (CEU && typeof CEU.haLabel === 'function') return CEU.haLabel(v);
    if (!v || v <= 0) return '—';
    return parseFloat(v).toFixed(2).replace('.', ',') + ' ha';
  }

  function fmtDHPerHa(cout, ha) {
    if (!ha || ha === 0 || !cout) return '—';
    return Math.round(cout / ha).toLocaleString('fr-MA');
  }

  function fmtQty(v) {
    if (!v || v === 0) return '—';
    return (Math.round(v * 100) / 100).toLocaleString('fr-MA');
  }

  /* ------------------------------------------------------------------ */
  /* Culture / nom / superficie — référentiel Smart Berry                 */
  /* ------------------------------------------------------------------ */

  /**
   * Culture d'une parcelle depuis le référentiel SB (window.CultureUtils).
   * Renvoie null si le module n'est pas chargé (garde défensive : on ne
   * filtre alors rien plutôt que de vider l'écran).
   */
  function cultureOf(label, sbMap) {
    var CU = window.CultureUtils;
    if (!CU || typeof CU.resolveCulture !== 'function') return null;
    return CU.resolveCulture({ label: label }, sbMap);
  }

  /** Prédicat du filtre Culture de l'écran ('Toutes' = pas de filtre). */
  function matchCulture(label, cultureFilter, sbMap) {
    if (!cultureFilter || cultureFilter === 'Toutes') return true;
    var c = cultureOf(label, sbMap);
    if (c === null) return true;
    return c === cultureFilter;
  }

  /** Nom Smart Berry d'une parcelle, repli sur le libellé BEE ONE. */
  function sbNom(label, sbMap) {
    if (typeof window.sbParcelleNom === 'function') {
      var n = window.sbParcelleNom(label);
      if (n && n !== '—' && n !== label) return n;
    }
    var key = String(label || '').toUpperCase().trim();
    var entry = sbMap && sbMap[key];
    if (entry && entry.nom_sb) return entry.nom_sb;
    return label || '—';
  }

  /** Superficie (ha) d'une parcelle : global app.jsx, puis sbMap, puis haByRef. */
  function sbHa(label, sbMap, haByRef) {
    var key = String(label || '').toUpperCase().trim();
    var v = 0;
    if (typeof window.sbParcelleHa === 'function') v = window.sbParcelleHa(label) || 0;
    if (!v && sbMap && sbMap[key] && sbMap[key].ha > 0) v = sbMap[key].ha;
    if (!v && haByRef && haByRef[key] > 0) v = haByRef[key];
    return v || 0;
  }

  /**
   * Indexe la réponse de `campagne-budget-list` par libellé BEE ONE. PURE.
   *
   * Clé normalisée `trim().toUpperCase()` — la MÊME normalisation que sbMap /
   * sbHa / sbNom : c'est la jointure entre les budgets saisis et les libellés
   * BEE ONE des lignes de pointage. Une normalisation différente ici ferait
   * silencieusement rater tous les budgets (colonnes vides, sans erreur).
   *
   * @param {Array<{label_bee_one?: string, budgets?: Object}>} list
   * @returns {Object<string, Object<string, number>>} LABEL_MAJ → famille → JH/Ha
   */
  function CAT_budgetsByLabel(list) {
    var out = {};
    (list || []).forEach(function (b) {
      var key = String((b && b.label_bee_one) || '').trim().toUpperCase();
      if (!key) return;
      out[key] = (b && b.budgets) || {};
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Helpers de calcul pivot                                              */
  /* ------------------------------------------------------------------ */
  function buildHaView(rows, haByRef) {
    var byParcelle = {};
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var key = r.refParcelle || r.parcelle;
      if (!byParcelle[key]) {
        var haKey = (r.parcelle || r.refParcelle || '').toUpperCase();
        byParcelle[key] = {
          parcelle: r.parcelle,
          refParcelle: r.refParcelle,
          ferme: r.ferme,
          ha: haByRef[haKey] || 0,
          byFamille: {},
          total: { jh: 0, cout: 0 },
        };
      }
      var fam = r.famille;
      if (!byParcelle[key].byFamille[fam]) byParcelle[key].byFamille[fam] = { jh: 0, cout: 0 };
      byParcelle[key].byFamille[fam].jh  += r.jh;
      byParcelle[key].byFamille[fam].cout += r.cout;
      byParcelle[key].total.jh  += r.jh;
      byParcelle[key].total.cout += r.cout;
    }
    return Object.values(byParcelle).sort(function (a, b) { return b.total.cout - a.total.cout; });
  }

  function buildVarieteView(rows, parcelle, periodes) {
    var filtered = rows.filter(function (r) {
      return r.parcelle === parcelle || r.refParcelle === parcelle;
    });
    var byOp = {};
    for (var i = 0; i < filtered.length; i++) {
      var r = filtered[i];
      var key = r.famille + '||' + r.operation;
      if (!byOp[key]) {
        byOp[key] = {
          famille: r.famille,
          code: r.code,
          operation: r.operation,
          byPeriode: {},
          total: { jh: 0, cout: 0 },
        };
      }
      if (!byOp[key].byPeriode[r.periode]) byOp[key].byPeriode[r.periode] = { jh: 0, cout: 0 };
      byOp[key].byPeriode[r.periode].jh  += r.jh;
      byOp[key].byPeriode[r.periode].cout += r.cout;
      byOp[key].total.jh  += r.jh;
      byOp[key].total.cout += r.cout;
    }
    return Object.values(byOp).sort(function (a, b) {
      var fc = a.famille.localeCompare(b.famille);
      return fc !== 0 ? fc : a.operation.localeCompare(b.operation);
    });
  }

  /**
   * Mappe les lignes de `campagne-analytique-detail` vers la forme attendue par
   * AnalytiqueUtils.buildAnalytiquePivotByFamille. PURE (sbMap/haByRef injectés).
   *
   * Le seul écart entre les deux sources est le NOM des champs — les valeurs
   * (jh, cout) sont reprises telles quelles, sans recalcul :
   *   campagne-analytique-detail        →  AnalytiqueRow (public/lib/analytiqueUtils.js)
   *   ────────────────────────────────     ──────────────────────────────────────────
   *   code    (ex. 'GB09')              →  operationGroupe   (code GB, clé du pivot)
   *   famille (libellé BEE ONE résolu)  →  operationFamille  (repli si code absent)
   *   operation                         →  operation         (lignes du mode Détail)
   *   parcelle || refParcelle           →  parcelle          (clé de colonne)
   *   —                                 →  ha  = sbHa(label, sbMap, haByRef)
   *
   * La clé de colonne reste le LIBELLÉ BEE ONE (pas le nom Smart Berry) : c'est
   * la clé de jointure du référentiel (sbHa/sbNom/culture), et l'affichage passe
   * par la prop `parcelleLabel` de la grille. `nbOuv` est conservé pour la
   * pop-up de détail.
   *
   * Les filtres de l'écran sont appliqués ICI, en amont du pivot : filtrer après
   * coup laisserait des colonnes de parcelles vides dans la grille.
   *
   * @param {Array<Object>} rows            data.rows de campagne-analytique-detail
   * @param {Object} sbMap                  référentiel SB indexé LABEL_MAJ → entrée
   * @param {Object} haByRef                data.haByRef (repli Ha)
   * @param {{farmFilter?: string, cultureFilter?: string}} [opts]
   * @returns {Array<Object>} lignes prêtes pour buildAnalytiquePivotByFamille
   */
  function CAT_pivotRows(rows, sbMap, haByRef, opts) {
    var farmFilter = (opts && opts.farmFilter) || null;
    var cultureFilter = (opts && opts.cultureFilter) || null;
    var out = [];
    (rows || []).forEach(function (r) {
      var label = r.parcelle || r.refParcelle;
      if (!label) return;
      if (farmFilter && r.ferme !== farmFilter) return;
      if (!matchCulture(label, cultureFilter, sbMap)) return;
      out.push({
        parcelle: label,
        ferme: r.ferme,
        ha: sbHa(label, sbMap, haByRef),
        jh: r.jh || 0,
        cout: r.cout || 0,
        nbOuv: r.nbOuv || 0,
        operation: r.operation,
        operationGroupe: r.code,
        operationFamille: r.famille,
      });
    });
    return out;
  }

  /**
   * Regroupe les lignes mappées par culture (référentiel SB prioritaire, cf.
   * cultureOf). PURE. Retourne la liste ordonnée des cultures présentes avec
   * leurs lignes — l'ordre suit CAT_CULTURES_DEF, les cultures inconnues du
   * référentiel visuel sont ajoutées à la fin plutôt que perdues.
   *
   * @param {Array<Object>} pivotRows
   * @param {Object} sbMap
   * @returns {Array<{culture: string, color: string, icon: string, rows: Array<Object>}>}
   */
  function CAT_byCulture(pivotRows, sbMap) {
    var groups = {};
    (pivotRows || []).forEach(function (r) {
      var c = cultureOf(r.parcelle, sbMap) || 'Framboise';
      if (!groups[c]) groups[c] = [];
      groups[c].push(r);
    });
    var out = [];
    CAT_CULTURES_DEF.forEach(function (def) {
      if (groups[def.culture] && groups[def.culture].length) {
        out.push({ culture: def.culture, color: def.color, icon: def.icon, rows: groups[def.culture] });
      }
    });
    Object.keys(groups).forEach(function (c) {
      if (out.some(function (o) { return o.culture === c; })) return;
      out.push({ culture: c, color: C.gray, icon: 'fa-leaf', rows: groups[c] });
    });
    return out;
  }

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
  function buildCultureWorkbook(culture, data, farmFilter, sbMap, budgetsByLabel) {
    var CEU = window.CampagneExportUtils;
    var rows = (data && data.rows) || [];
    var periodes = (data && data.periodes) || [];
    var haByRef = (data && data.haByRef) || {};
    var budgets = budgetsByLabel || {};

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
      var budParcelle = budgets[String(label || '').toUpperCase().trim()] || {};
      synthese.push({
        nomSb: nom,
        label: label,
        ferme: seen[label].ferme,
        ha: ha,
        totalJh: totalJh,
        budgets: budParcelle,
        jhByFamille: jhByFamille,
      });
      var params = {
        nomSb: nom,
        ha: ha,
        culture: culture,
        campagne: (data && data.campagne) || '',
        periodes: periodes,
        opRows: opRows,
        famillesOrdered: (data && data.famillesOrdered) || [],
        budgets: budParcelle,
      };
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
  // index.html. ExcelJS expose window.ExcelJS — global distinct de window.XLSX,
  // les deux cohabitent (vérifié par smoke-load des deux bundles ensemble).
  var EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
  var excelJsPromise = null;

  /** Charge ExcelJS une seule fois ; rejette si le CDN est injoignable. */
  function loadExcelJS() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    if (excelJsPromise) return excelJsPromise;
    excelJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = EXCELJS_URL;
      s.async = true;
      s.onload = function () {
        if (window.ExcelJS) { resolve(window.ExcelJS); return; }
        // Même traitement que onerror : sans reset, le repli deviendrait
        // définitif jusqu'au rechargement de la page.
        excelJsPromise = null;
        reject(new Error('ExcelJS chargé mais window.ExcelJS absent'));
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
    var CEU = window.CampagneExportUtils;
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
    var CEU = window.CampagneExportUtils;
    if (window.XLSX) {
      var wb = window.XLSX.utils.book_new();
      wbData.sheets.forEach(function (s) {
        var ws = window.XLSX.utils.aoa_to_sheet(s.aoa);
        // Largeurs de colonnes : seule mise en forme honorée par SheetJS
        // community (les styles de cellule et les volets figés sont ignorés).
        if (s.cols) ws['!cols'] = s.cols;
        // Format de pourcentage (`z`) sur la colonne « % Consommé » : la
        // cellule porte un RATIO, la lire sans format donnerait « 0,75 » là où
        // il faut lire « 75 % ». Les formats numériques, contrairement aux
        // styles, sont écrits par le build community.
        CEU.percentColumns(s.rows).forEach(function (col) {
          s.aoa.forEach(function (r, ri) {
            var addr = window.XLSX.utils.encode_cell({ c: col - 1, r: ri });
            var cell = ws[addr];
            if (!cell || cell.t !== 'n') return;
            var fmt = CEU.percentFmtFor(cell.v);
            if (fmt) cell.z = fmt;
          });
        });
        window.XLSX.utils.book_append_sheet(wb, ws, s.name);
      });
      window.XLSX.writeFile(wb, wbData.fileName + '.xlsx');
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
  function exportCulture(culture, data, farmFilter, sbMap, budgetsByLabel) {
    if (!window.CampagneExportUtils) return Promise.resolve();
    var wbData = buildCultureWorkbook(culture, data, farmFilter, sbMap, budgetsByLabel);
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

  /* ------------------------------------------------------------------ */
  /* Sous-composant : Vue Affectation par Ha                              */
  /* ------------------------------------------------------------------ */
  function HaView(props) {
    var data = props.data;
    var farmFilter = props.farmFilter;
    var cultureFilter = props.cultureFilter;
    var sbMap = props.sbMap || {};
    var metric = props.metric; // 'cout' | 'jh'
    var setMetric = props.setMetric;

    var rows = useMemo(function () {
      return buildHaView(data.rows, data.haByRef);
    }, [data]);

    // Familles actives (cout > 0 dans tout le dataset)
    var activeFamilles = useMemo(function () {
      var famSet = {};
      for (var i = 0; i < rows.length; i++) {
        var bf = rows[i].byFamille;
        Object.keys(bf).forEach(function (f) {
          if (bf[f].cout > 0) famSet[f] = true;
        });
      }
      // Conserver l'ordre du référentiel
      var ordered = (data.famillesOrdered || []).filter(function (f) { return famSet[f]; });
      // Ajouter les familles non reconnues dans le référentiel
      Object.keys(famSet).forEach(function (f) {
        if (ordered.indexOf(f) === -1) ordered.push(f);
      });
      return ordered;
    }, [rows, data.famillesOrdered]);

    // Filtrer par ferme puis par culture
    var filteredRows = useMemo(function () {
      var r = rows;
      if (farmFilter) r = r.filter(function (row) { return row.ferme === farmFilter; });
      r = r.filter(function (row) {
        return matchCulture(row.parcelle || row.refParcelle, cultureFilter, sbMap);
      });
      return r;
    }, [rows, farmFilter, cultureFilter, sbMap]);

    // Totaux colonnes
    var colTotals = useMemo(function () {
      var t = { byFamille: {}, total: { jh: 0, cout: 0 } };
      filteredRows.forEach(function (r) {
        activeFamilles.forEach(function (f) {
          if (!t.byFamille[f]) t.byFamille[f] = { jh: 0, cout: 0 };
          var cell = r.byFamille[f];
          if (cell) {
            t.byFamille[f].jh  += cell.jh;
            t.byFamille[f].cout += cell.cout;
          }
        });
        t.total.jh  += r.total.jh;
        t.total.cout += r.total.cout;
      });
      return t;
    }, [filteredRows, activeFamilles]);

    var thStyle = {
      padding: '8px 10px',
      borderBottom: '2px solid ' + C.border,
      background: C.surface2,
      fontSize: '12px',
      fontWeight: 600,
      color: C.textSec,
      whiteSpace: 'nowrap',
      textAlign: 'right',
    };
    var thFirstStyle = Object.assign({}, thStyle, { textAlign: 'left' });
    var tdStyle = {
      padding: '7px 10px',
      borderBottom: '1px solid ' + C.border,
      fontSize: '13px',
      color: C.text,
      textAlign: 'right',
      whiteSpace: 'nowrap',
    };
    var tdFirstStyle = Object.assign({}, tdStyle, { textAlign: 'left', fontWeight: 500 });
    var tdDashStyle = Object.assign({}, tdStyle, { color: C.textSec });
    var totalRowStyle = {
      background: C.berry,
      color: '#fff',
    };
    var totalCellStyle = {
      padding: '8px 10px',
      fontSize: '13px',
      fontWeight: 700,
      textAlign: 'right',
      whiteSpace: 'nowrap',
      color: '#fff',
    };

    return React.createElement('div', null,
      // Barre de contrôle (métrique)
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }
      },
        React.createElement('span', { style: { fontSize: '13px', color: C.textSec, marginRight: '4px' } }, 'Afficher :'),
        ['cout', 'jh'].map(function (m) {
          var label = m === 'cout' ? 'Coût DH' : 'Journées-Homme';
          return React.createElement('button', {
            key: m,
            onClick: function () { setMetric(m); },
            style: {
              padding: '5px 14px',
              border: '1.5px solid ' + (metric === m ? C.berry : C.border),
              borderRadius: '16px',
              background: metric === m ? C.berry : C.surface,
              color: metric === m ? '#fff' : C.text,
              fontSize: '12px',
              fontWeight: metric === m ? 700 : 400,
              cursor: 'pointer',
            }
          }, label);
        })
      ),
      // Tableau
      filteredRows.length === 0
        ? React.createElement('div', {
            style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' }
          }, 'Aucune donnée pour cette sélection.')
        : React.createElement('div', { style: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' } },
            React.createElement('table', {
              style: { minWidth: '600px', borderCollapse: 'collapse', fontSize: '13px' }
            },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', { style: thFirstStyle }, 'Parcelle'),
                  React.createElement('th', { style: thStyle }, 'Ferme'),
                  React.createElement('th', { style: thStyle }, 'Ha'),
                  activeFamilles.map(function (f) {
                    var icon = FAMILLE_ICONS[f];
                    return React.createElement('th', { key: f, style: thStyle, title: f },
                      icon
                        ? React.createElement('span', null,
                            React.createElement('i', { className: 'fa-solid ' + icon, style: { marginRight: '4px' } }),
                            f
                          )
                        : f
                    );
                  }),
                  React.createElement('th', { style: thStyle }, 'Total DH'),
                  React.createElement('th', { style: thStyle }, 'DH/Ha')
                )
              ),
              React.createElement('tbody', null,
                filteredRows.map(function (row, idx) {
                  return React.createElement('tr', {
                    key: row.refParcelle || row.parcelle,
                    style: { background: idx % 2 === 0 ? C.surface : C.surface2 }
                  },
                    React.createElement('td', {
                      style: tdFirstStyle,
                      title: row.parcelle || row.refParcelle,
                    }, sbNom(row.parcelle || row.refParcelle, sbMap)),
                    React.createElement('td', { style: tdStyle }, row.ferme || '—'),
                    React.createElement('td', { style: tdStyle }, fmtHa(row.ha)),
                    activeFamilles.map(function (f) {
                      var cell = row.byFamille[f];
                      var val = cell ? (metric === 'cout' ? cell.cout : cell.jh) : 0;
                      if (!val || val === 0) return React.createElement('td', { key: f, style: tdDashStyle }, '—');
                      return React.createElement('td', { key: f, style: tdStyle },
                        metric === 'cout' ? fmtDH(val) : fmtJH(val)
                      );
                    }),
                    React.createElement('td', { style: Object.assign({}, tdStyle, { fontWeight: 700 }) },
                      fmtDH(row.total.cout)
                    ),
                    React.createElement('td', { style: tdStyle },
                      fmtDHPerHa(row.total.cout, row.ha)
                    )
                  );
                }),
                // Ligne de total
                React.createElement('tr', { style: totalRowStyle },
                  React.createElement('td', { style: Object.assign({}, totalCellStyle, { textAlign: 'left' }) }, 'TOTAL'),
                  React.createElement('td', { style: totalCellStyle }, ''),
                  React.createElement('td', { style: totalCellStyle }, ''),
                  activeFamilles.map(function (f) {
                    var cell = colTotals.byFamille[f];
                    var val = cell ? (metric === 'cout' ? cell.cout : cell.jh) : 0;
                    return React.createElement('td', { key: f, style: totalCellStyle },
                      val ? (metric === 'cout' ? fmtDH(val) : fmtJH(val)) : '—'
                    );
                  }),
                  React.createElement('td', { style: totalCellStyle }, fmtDH(colTotals.total.cout)),
                  React.createElement('td', { style: totalCellStyle }, '')
                )
              )
            )
          )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Sous-composant : Vue Par Variété / Quinzaine                        */
  /* ------------------------------------------------------------------ */
  function VarieteView(props) {
    var data = props.data;
    var farmFilter = props.farmFilter;
    var cultureFilter = props.cultureFilter;
    var sbMap = props.sbMap || {};
    var budgetsByLabel = props.budgetsByLabel || {};
    var selectedParcelle = props.selectedParcelle;
    var setSelectedParcelle = props.setSelectedParcelle;
    var metric = props.metric;
    var setMetric = props.setMetric;

    // Culture dont l'export est en cours (ExcelJS chargé à la demande) — null
    // quand aucun export ne tourne.
    var _exporting = useState(null);
    var exporting = _exporting[0]; var setExporting = _exporting[1];

    // Liste distincte des parcelles (filtrée par farmFilter + cultureFilter).
    // `value` = libellé BEE ONE brut (clé de jointure de buildVarieteView),
    // affichage = nom Smart Berry ; tri sur le libellé affiché.
    var parcelles = useMemo(function () {
      var seen = {};
      var list = [];
      (data.rows || []).forEach(function (r) {
        var key = r.parcelle || r.refParcelle;
        if (!key || seen[key]) return;
        if (farmFilter && r.ferme !== farmFilter) return;
        if (!matchCulture(key, cultureFilter, sbMap)) return;
        seen[key] = true;
        list.push({ value: key, label: sbNom(key, sbMap) });
      });
      return list.sort(function (a, b) { return a.label.localeCompare(b.label); });
    }, [data, farmFilter, cultureFilter, sbMap]);

    // Superficie de la parcelle sélectionnée
    var selectedHa = useMemo(function () {
      if (!selectedParcelle) return 0;
      return sbHa(selectedParcelle, sbMap, data.haByRef);
    }, [selectedParcelle, sbMap, data]);

    // Quinzaines de la campagne présentes dans les données
    var periodes = data.periodes || [];

    // Lignes du pivot pour la parcelle sélectionnée
    var opRows = useMemo(function () {
      if (!selectedParcelle) return [];
      return buildVarieteView(data.rows, selectedParcelle, periodes);
    }, [data, selectedParcelle, periodes]);

    // Groupes par famille
    var familles = useMemo(function () {
      var order = data.famillesOrdered || [];
      var seen = {};
      opRows.forEach(function (r) { seen[r.famille] = true; });
      var ordered = order.filter(function (f) { return seen[f]; });
      Object.keys(seen).forEach(function (f) {
        if (ordered.indexOf(f) === -1) ordered.push(f);
      });
      return ordered;
    }, [opRows, data.famillesOrdered]);

    // Totaux généraux par période
    var grandTotals = useMemo(function () {
      var byP = {};
      var total = { jh: 0, cout: 0 };
      opRows.forEach(function (r) {
        periodes.forEach(function (p) {
          if (!byP[p]) byP[p] = { jh: 0, cout: 0 };
          var cell = r.byPeriode[p];
          if (cell) { byP[p].jh += cell.jh; byP[p].cout += cell.cout; }
        });
        total.jh  += r.total.jh;
        total.cout += r.total.cout;
      });
      return { byP: byP, total: total };
    }, [opRows, periodes]);

    var thStyle = {
      padding: '8px 10px',
      borderBottom: '2px solid ' + C.border,
      background: C.surface2,
      fontSize: '12px',
      fontWeight: 600,
      color: C.textSec,
      whiteSpace: 'nowrap',
      textAlign: 'right',
    };
    var thFirstStyle = Object.assign({}, thStyle, { textAlign: 'left', minWidth: '200px' });
    var tdStyle = {
      padding: '7px 10px',
      borderBottom: '1px solid ' + C.border,
      fontSize: '13px',
      color: C.text,
      textAlign: 'right',
      whiteSpace: 'nowrap',
    };
    var tdFirstStyle = Object.assign({}, tdStyle, { textAlign: 'left' });
    var tdDashStyle = Object.assign({}, tdStyle, { color: C.textSec });

    function renderVal(cell) {
      if (!cell) return React.createElement('td', { style: tdDashStyle }, '—');
      var v = metric === 'cout' ? cell.cout : cell.jh;
      if (!v || v === 0) return React.createElement('td', { style: tdDashStyle }, '—');
      return React.createElement('td', { style: tdStyle }, metric === 'cout' ? fmtDH(v) : fmtJH(v));
    }

    return React.createElement('div', null,
      // Barre de contrôle
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }
      },
        React.createElement('label', { style: { fontSize: '13px', color: C.textSec } }, 'Parcelle :'),
        React.createElement('select', {
          value: selectedParcelle,
          onChange: function (e) { setSelectedParcelle(e.target.value); },
          style: {
            padding: '6px 10px',
            borderRadius: '6px',
            border: '1.5px solid ' + C.border,
            fontSize: '13px',
            minWidth: '180px',
          }
        },
          React.createElement('option', { value: '' }, '— Choisir une parcelle —'),
          parcelles.map(function (p) {
            return React.createElement('option', { key: p.value, value: p.value }, p.label);
          })
        ),
        selectedParcelle
          ? React.createElement('span', { style: { fontSize: '13px', color: C.textSec } },
              'Superficie : ' + fmtHaLabel(selectedHa)
            )
          : null,
        React.createElement('span', { style: { marginLeft: '8px' } }),
        ['jh', 'cout'].map(function (m) {
          var label = m === 'cout' ? 'Coût DH' : 'JH';
          return React.createElement('button', {
            key: m,
            onClick: function () { setMetric(m); },
            style: {
              padding: '5px 14px',
              border: '1.5px solid ' + (metric === m ? C.berry : C.border),
              borderRadius: '16px',
              background: metric === m ? C.berry : C.surface,
              color: metric === m ? '#fff' : C.text,
              fontSize: '12px',
              fontWeight: metric === m ? 700 : 400,
              cursor: 'pointer',
            }
          }, label);
        }),
        // Exports Excel — toutes les parcelles de la culture (indépendants du
        // filtre Culture et de la parcelle sélectionnée), périmètre farmFilter.
        ['Framboise', 'Myrtille'].map(function (cult) {
          var busy = exporting === cult;
          var disabled = exporting !== null;
          return React.createElement('button', {
            key: 'export-' + cult,
            disabled: disabled,
            onClick: function () {
              if (exporting !== null) return;
              setExporting(cult);
              // Promise.resolve().then(…) : si exportCulture jette de façon
              // SYNCHRONE, l'erreur devient un rejet capturé et les boutons
              // sont réactivés — sinon ils resteraient grisés « Génération… »
              // jusqu'au remontage de l'onglet.
              Promise.resolve()
                .then(function () {
                  return exportCulture(cult, data, farmFilter, sbMap, budgetsByLabel);
                })
                .catch(function (e) {
                  if (window.console) console.error('[Campagne] Export ' + cult + ' échoué :', e);
                })
                .then(function () { setExporting(null); });
            },
            title: 'Exporter toutes les parcelles ' + cult + ' (une feuille par parcelle)',
            style: {
              padding: '5px 14px',
              border: '1.5px solid ' + C.green,
              borderRadius: '16px',
              background: C.surface,
              color: C.green,
              fontSize: '12px',
              fontWeight: 600,
              cursor: disabled ? 'wait' : 'pointer',
              opacity: disabled && !busy ? 0.5 : 1,
            }
          },
            React.createElement('i', {
              className: busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-excel',
              style: { marginRight: '6px' },
            }),
            busy ? 'Génération…' : 'Export ' + cult
          );
        })
      ),
      // Contenu
      !selectedParcelle
        ? React.createElement('div', {
            style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' }
          }, 'Sélectionner une parcelle pour afficher le pivot quinzaines.')
        : opRows.length === 0
          ? React.createElement('div', {
              style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' }
            }, 'Aucune donnée pour cette parcelle.')
          : React.createElement('div', { style: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' } },
              React.createElement('table', {
                style: { minWidth: '600px', borderCollapse: 'collapse', fontSize: '12px' }
              },
                React.createElement('thead', null,
                  React.createElement('tr', null,
                    React.createElement('th', { style: thFirstStyle }, 'Famille / Opération'),
                    periodes.map(function (p) {
                      return React.createElement('th', { key: p, style: thStyle }, p);
                    }),
                    React.createElement('th', { style: thStyle }, 'Total')
                  )
                ),
                React.createElement('tbody', null,
                  familles.map(function (famille) {
                    var famRows = opRows.filter(function (r) { return r.famille === famille; });
                    if (famRows.length === 0) return null;
                    // Total famille
                    var famTotal = { byP: {}, total: { jh: 0, cout: 0 } };
                    famRows.forEach(function (r) {
                      periodes.forEach(function (p) {
                        if (!famTotal.byP[p]) famTotal.byP[p] = { jh: 0, cout: 0 };
                        var cell = r.byPeriode[p];
                        if (cell) { famTotal.byP[p].jh += cell.jh; famTotal.byP[p].cout += cell.cout; }
                      });
                      famTotal.total.jh  += r.total.jh;
                      famTotal.total.cout += r.total.cout;
                    });
                    var icon = FAMILLE_ICONS[famille];
                    var elems = [];
                    // Header famille
                    elems.push(React.createElement('tr', {
                      key: 'fam-' + famille,
                      style: { background: '#ebeae3' }
                    },
                      React.createElement('td', {
                        colSpan: periodes.length + 2,
                        style: {
                          padding: '6px 10px',
                          fontWeight: 700,
                          fontSize: '12px',
                          color: C.textSec,
                        }
                      },
                        icon ? React.createElement('i', { className: 'fa-solid ' + icon, style: { marginRight: '6px' } }) : null,
                        famille
                      )
                    ));
                    // Lignes opérations
                    famRows.forEach(function (r, ri) {
                      elems.push(React.createElement('tr', {
                        key: 'op-' + famille + '-' + ri,
                        style: { background: ri % 2 === 0 ? C.surface : C.surface2 }
                      },
                        React.createElement('td', { style: Object.assign({}, tdFirstStyle, { paddingLeft: '24px' }) }, r.operation),
                        periodes.map(function (p) {
                          return React.createElement(React.Fragment, { key: p }, renderVal(r.byPeriode[p]));
                        }),
                        React.createElement('td', {
                          style: Object.assign({}, tdStyle, { fontWeight: 600 })
                        },
                          metric === 'cout' ? fmtDH(r.total.cout) : fmtJH(r.total.jh)
                        )
                      ));
                    });
                    // Ligne total famille
                    elems.push(React.createElement('tr', {
                      key: 'famtotal-' + famille,
                      style: { background: '#d4d3cc' }
                    },
                      React.createElement('td', {
                        style: Object.assign({}, tdFirstStyle, { fontWeight: 700, paddingLeft: '16px' })
                      }, 'Total ' + famille),
                      periodes.map(function (p) {
                        var cell = famTotal.byP[p];
                        var v = cell ? (metric === 'cout' ? cell.cout : cell.jh) : 0;
                        return React.createElement('td', { key: p, style: Object.assign({}, tdStyle, { fontWeight: 700 }) },
                          v ? (metric === 'cout' ? fmtDH(v) : fmtJH(v)) : '—'
                        );
                      }),
                      React.createElement('td', {
                        style: Object.assign({}, tdStyle, { fontWeight: 700 })
                      },
                        metric === 'cout' ? fmtDH(famTotal.total.cout) : fmtJH(famTotal.total.jh)
                      )
                    ));
                    return elems;
                  }),
                  // Total général
                  React.createElement('tr', {
                    style: { background: C.berry }
                  },
                    React.createElement('td', {
                      style: { padding: '8px 10px', fontWeight: 700, fontSize: '13px', color: '#fff', textAlign: 'left' }
                    }, 'TOTAL GÉNÉRAL'),
                    periodes.map(function (p) {
                      var cell = grandTotals.byP[p];
                      var v = cell ? (metric === 'cout' ? cell.cout : cell.jh) : 0;
                      return React.createElement('td', {
                        key: p,
                        style: { padding: '8px 10px', fontWeight: 700, fontSize: '13px', color: '#fff', textAlign: 'right' }
                      }, v ? (metric === 'cout' ? fmtDH(v) : fmtJH(v)) : '—');
                    }),
                    React.createElement('td', {
                      style: { padding: '8px 10px', fontWeight: 700, fontSize: '13px', color: '#fff', textAlign: 'right' }
                    },
                      metric === 'cout' ? fmtDH(grandTotals.total.cout) : fmtJH(grandTotals.total.jh)
                    )
                  )
                )
              )
            )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Sous-composant : Vue Pivot analytique (grille partagée)              */
  /* ------------------------------------------------------------------ */

  /** Pastille de bascule — même gabarit que les autres bascules de l'écran. */
  function CAT_pillStyle(active) {
    return {
      padding: '5px 14px',
      border: '1.5px solid ' + (active ? C.berry : C.border),
      borderRadius: '16px',
      background: active ? C.berry : C.surface,
      color: active ? '#fff' : C.text,
      fontSize: '12px',
      fontWeight: active ? 700 : 400,
      cursor: 'pointer',
    };
  }

  /** Groupe de bascules `[[valeur, libellé], …]`. */
  function CAT_pills(options, current, onPick, keyPrefix) {
    return options.map(function (opt) {
      return React.createElement('button', {
        key: keyPrefix + opt[0],
        onClick: function () { onPick(opt[0]); },
        style: CAT_pillStyle(current === opt[0]),
      }, opt[1]);
    });
  }

  /**
   * Pop-up de détail d'une cellule de la grille : opérations fines de la
   * famille sur la parcelle. Mêmes colonnes que la pop-up de l'écran Quinzaine
   * (Ouvriers / JH / JH par Ha / Coût / DH par Ha) — la colonne Ouvriers
   * consomme `nbOuv`, désormais renvoyé par `campagne-analytique-detail`.
   */
  function CAT_DetailPopup(props) {
    var cell = props.cell;
    var onClose = props.onClose;
    var ha = cell.ha || 0;
    var byOp = {};
    (cell.detailRows || []).forEach(function (r) {
      var k = r.operation || '—';
      if (!byOp[k]) byOp[k] = { operation: k, jh: 0, cout: 0, nbOuv: 0 };
      byOp[k].jh += r.jh || 0;
      byOp[k].cout += r.cout || 0;
      byOp[k].nbOuv += r.nbOuv || 0;
    });
    var opRows = Object.keys(byOp).map(function (k) { return byOp[k]; })
      .sort(function (a, b) { return b.jh - a.jh; });
    var totals = opRows.reduce(function (t, r) {
      t.jh += r.jh; t.cout += r.cout; t.nbOuv += r.nbOuv; return t;
    }, { jh: 0, cout: 0, nbOuv: 0 });

    function perHa(v) { return ha > 0 ? (Math.round(v / ha * 10) / 10).toLocaleString('fr-MA') : '—'; }
    function jhTxt(v) { return (Math.round(v * 10) / 10).toFixed(1); }
    function dhTxt(v) { return Math.round(v).toLocaleString('fr-MA'); }

    var th = { padding: '6px 10px', textAlign: 'right', fontSize: '11px', color: C.textSec, borderBottom: '1px solid ' + C.border };
    var thL = Object.assign({}, th, { textAlign: 'left' });
    var td = { padding: '6px 10px', textAlign: 'right', fontSize: '12px' };
    var tdL = Object.assign({}, td, { textAlign: 'left', fontWeight: 500 });
    var tdT = Object.assign({}, td, { fontWeight: 700 });

    return React.createElement('div', {
      style: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)',
        zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' },
      onClick: onClose,
    },
      React.createElement('div', {
        style: { background: '#fff', borderRadius: '16px', maxWidth: '680px', width: '100%',
          maxHeight: '80vh', overflow: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' },
        onClick: function (e) { e.stopPropagation(); },
      },
        React.createElement('div', {
          style: { padding: '16px 20px', background: C.berry, borderRadius: '16px 16px 0 0', color: '#fff',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: '15px', fontWeight: 700 } }, cell.parcelleLabel || cell.parcelle),
            React.createElement('div', { style: { fontSize: '11px', opacity: 0.85, marginTop: '2px' } },
              (cell.operationFamille || '') + ' · ' + (ha > 0 ? fmtHaLabel(ha) : 'Ha inconnu'))
          ),
          React.createElement('button', {
            onClick: onClose,
            style: { background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', fontSize: '16px',
              cursor: 'pointer', borderRadius: '8px', width: '32px', height: '32px' },
          }, React.createElement('i', { className: 'fa-solid fa-xmark' }))
        ),
        React.createElement('div', { style: { padding: '16px 20px' } },
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            React.createElement('thead', null,
              React.createElement('tr', null,
                React.createElement('th', { style: thL }, 'Opération'),
                React.createElement('th', { style: th }, 'Ouvriers'),
                React.createElement('th', { style: th }, 'JH'),
                React.createElement('th', { style: th }, 'JH / Ha'),
                React.createElement('th', { style: th }, 'Coût (DH)'),
                React.createElement('th', { style: th }, 'DH / Ha')
              )
            ),
            React.createElement('tbody', null,
              opRows.map(function (r, i) {
                return React.createElement('tr', { key: i, style: { background: i % 2 === 0 ? C.surface : C.surface2 } },
                  React.createElement('td', { style: tdL }, r.operation),
                  React.createElement('td', { style: td }, r.nbOuv),
                  React.createElement('td', { style: td }, jhTxt(r.jh)),
                  React.createElement('td', { style: td }, perHa(r.jh)),
                  React.createElement('td', { style: td }, dhTxt(r.cout)),
                  React.createElement('td', { style: td }, ha > 0 ? dhTxt(r.cout / ha) : '—')
                );
              })
            ),
            React.createElement('tfoot', null,
              React.createElement('tr', { style: { background: C.surface3 } },
                React.createElement('td', { style: Object.assign({}, tdT, { textAlign: 'left' }) }, 'TOTAL'),
                React.createElement('td', { style: tdT }, totals.nbOuv),
                React.createElement('td', { style: tdT }, jhTxt(totals.jh)),
                React.createElement('td', { style: tdT }, perHa(totals.jh)),
                React.createElement('td', { style: tdT }, dhTxt(totals.cout)),
                React.createElement('td', { style: tdT }, ha > 0 ? dhTxt(totals.cout / ha) : '—')
              )
            )
          )
        )
      )
    );
  }

  /**
   * Vue « Pivot analytique » : la MÊME grille que l'écran Quinzaine
   * (window.PivotAnalytiqueGrid), alimentée par les lignes de la campagne.
   * Lignes = groupe M.O → famille (code GB) → opération, colonnes = parcelles
   * avec leur Ha, une grille par culture.
   *
   * Cette vue ne calcule RIEN elle-même : le pivot vient de
   * AnalytiqueUtils.buildAnalytiquePivotByFamille (lib partagée, inchangée) et
   * la présentation de PivotAnalytiqueGrid. Elle ne fait que mapper les
   * champs (CAT_pivotRows) et traduire ses bascules en séries `metrics`.
   *
   * Bascules : JH ↔ Coût DH (état partagé avec les autres vues MO, prop
   * `metric`), Ha ↔ Total et Récap ↔ Détail (locaux à la vue).
   */
  function PivotView(props) {
    var data = props.data || {};
    var sbMap = props.sbMap || {};
    var metric = props.metric;          // 'cout' | 'jh'
    var setMetric = props.setMetric;

    var _totalMode = useState(false);
    var totalMode = _totalMode[0]; var setTotalMode = _totalMode[1];

    var _detailMode = useState(false);
    var detailMode = _detailMode[0]; var setDetailMode = _detailMode[1];

    var _detailCell = useState(null);
    var detailCell = _detailCell[0]; var setDetailCell = _detailCell[1];

    var Grid = window.PivotAnalytiqueGrid;
    var AU = window.AnalytiqueUtils;

    var groups = useMemo(function () {
      var rows = CAT_pivotRows(data.rows, sbMap, data.haByRef || {}, {
        farmFilter: props.farmFilter,
        cultureFilter: props.cultureFilter,
      });
      return CAT_byCulture(rows, sbMap);
    }, [data, sbMap, props.farmFilter, props.cultureFilter]);

    var isJh = metric === 'jh';
    var metrics = [{
      key: isJh ? 'jh' : 'cout',
      unit: isJh ? (totalMode ? 'JH' : 'JH/Ha') : (totalMode ? 'DH' : 'DH/Ha'),
      // Le pivot stocke des TOTAUX par cellule ; seul `display` bouge avec la
      // bascule Ha/Total. Le budget du lot suivant arrivera, lui, en
      // `basis: 'perHa'` — d'où le sens de conversion porté par série.
      basis: 'total',
      display: totalMode ? 'total' : 'perHa',
      format: isJh
        ? function (v) { return (Math.round(v * 10) / 10).toFixed(1); }
        : function (v) { return Math.round(v).toLocaleString('fr-MA'); },
      summary: isJh
        ? function (t) { return Math.round(t).toLocaleString('fr-MA') + ' JH total'; }
        : function (t) { return Math.round(t).toLocaleString('fr-MA') + ' DH'; },
    }];

    // Garde anti-crash : une référence à un global absent fait planter TOUT le
    // rendu React (mémoire projet « tab bare global ref »).
    if (!Grid || !AU || typeof AU.buildAnalytiquePivotByFamille !== 'function') {
      return React.createElement('div', {
        style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' },
      }, 'Grille analytique indisponible (module non chargé).');
    }

    return React.createElement('div', null,
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' },
      },
        React.createElement('span', { style: { fontSize: '13px', color: C.textSec, marginRight: '4px' } }, 'Afficher :'),
        CAT_pills([['jh', 'JH'], ['cout', 'Coût DH']], metric, setMetric, 'm-'),
        React.createElement('span', { style: { width: '8px' } }),
        CAT_pills([['ha', 'Par Ha'], ['total', 'Total']], totalMode ? 'total' : 'ha',
          function (v) { setTotalMode(v === 'total'); }, 't-'),
        React.createElement('span', { style: { width: '8px' } }),
        CAT_pills([['recap', 'Récap'], ['detail', 'Détail']], detailMode ? 'detail' : 'recap',
          function (v) { setDetailMode(v === 'detail'); }, 'd-')
      ),
      detailCell
        ? React.createElement(CAT_DetailPopup, { cell: detailCell, onClose: function () { setDetailCell(null); } })
        : null,
      groups.length === 0
        ? React.createElement('div', {
            style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' },
          }, 'Aucune donnée pour cette sélection.')
        : groups.map(function (g) {
            var pivot = AU.buildAnalytiquePivotByFamille(g.rows, { detail: detailMode });
            if (!pivot.groupedRows || pivot.groupedRows.length === 0) return null;
            return React.createElement(Grid, {
              key: g.culture,
              parcelles: pivot.parcelles,
              groupedRows: pivot.groupedRows,
              metrics: metrics,
              color: g.color,
              title: g.culture,
              icon: g.icon,
              parcelleLabel: function (k) { return sbNom(k, sbMap); },
              onCellClick: function (c) {
                setDetailCell(Object.assign({ parcelleLabel: sbNom(c.parcelle, sbMap) }, c));
              },
            });
          })
    );
  }

  /* ------------------------------------------------------------------ */
  /* Sous-composant : Vue Conso (Engrais / Pesticides)                   */
  /* ------------------------------------------------------------------ */
  function ConsoView(props) {
    var consoData = props.consoData;
    var subTab = props.subTab; // 'engrais' | 'pesticides'
    var farmFilter = props.farmFilter;
    var cultureFilter = props.cultureFilter;
    var sbMap = props.sbMap || {};

    var _metric = useState('perha');
    var metric = _metric[0]; var setMetric = _metric[1];

    // Parcelles filtrées
    var parcelles = useMemo(function () {
      if (!consoData) return [];
      return (consoData.parcelles || []).filter(function (p) {
        if (farmFilter && p.ferme !== farmFilter) return false;
        if (!matchCulture(p.parcelle, cultureFilter, sbMap)) return false;
        return true;
      });
    }, [consoData, farmFilter, cultureFilter, sbMap]);

    // Articles dynamiques selon le sub-tab
    var articles = useMemo(function () {
      var seen = {};
      var list = [];
      parcelles.forEach(function (p) {
        var items = subTab === 'engrais' ? (p.engrais || []) : (p.pesticides || []);
        items.forEach(function (item) {
          if (!seen[item.article]) {
            seen[item.article] = { unite: item.unite };
            list.push(item.article);
          }
        });
      });
      return list.sort();
    }, [parcelles, subTab]);

    var thStyle = {
      padding: '8px 10px',
      borderBottom: '2px solid ' + C.border,
      background: C.surface2,
      fontSize: '12px',
      fontWeight: 600,
      color: C.textSec,
      whiteSpace: 'nowrap',
      textAlign: 'right',
    };
    var thFirstStyle = Object.assign({}, thStyle, { textAlign: 'left' });
    var tdStyle = {
      padding: '7px 10px',
      borderBottom: '1px solid ' + C.border,
      fontSize: '13px',
      color: C.text,
      textAlign: 'right',
      whiteSpace: 'nowrap',
    };
    var tdFirstStyle = Object.assign({}, tdStyle, { textAlign: 'left', fontWeight: 500 });
    var tdDashStyle = Object.assign({}, tdStyle, { color: C.textSec });
    var totalCellStyle = {
      padding: '8px 10px',
      fontSize: '13px',
      fontWeight: 700,
      textAlign: 'right',
      whiteSpace: 'nowrap',
      color: '#fff',
    };

    // Totaux colonnes
    var colTotals = useMemo(function () {
      var byArticle = {};
      var totalDH = 0;
      parcelles.forEach(function (p) {
        var items = subTab === 'engrais' ? (p.engrais || []) : (p.pesticides || []);
        var ha = p.ha || 0;
        items.forEach(function (item) {
          if (!byArticle[item.article]) byArticle[item.article] = { qty: 0, cout: 0 };
          byArticle[item.article].qty += item.qty || 0;
          byArticle[item.article].cout += item.coutTotal || 0;
        });
        var total = subTab === 'engrais' ? (p.totalEngraisCout || 0) : (p.totalPesticidesCout || 0);
        totalDH += total;
      });
      return { byArticle: byArticle, totalDH: totalDH };
    }, [parcelles, subTab]);

    // Ha total (pour DH/Ha colonne totaux)
    var totalHa = useMemo(function () {
      return parcelles.reduce(function (sum, p) { return sum + (p.ha || 0); }, 0);
    }, [parcelles]);

    return React.createElement('div', null,
      // Barre de contrôle (métrique)
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }
      },
        React.createElement('span', { style: { fontSize: '13px', color: C.textSec, marginRight: '4px' } }, 'Afficher :'),
        ['perha', 'total'].map(function (m) {
          var label = m === 'perha' ? 'Par Ha' : 'Total';
          return React.createElement('button', {
            key: m,
            onClick: function () { setMetric(m); },
            style: {
              padding: '5px 14px',
              border: '1.5px solid ' + (metric === m ? C.berry : C.border),
              borderRadius: '16px',
              background: metric === m ? C.berry : C.surface,
              color: metric === m ? '#fff' : C.text,
              fontSize: '12px',
              fontWeight: metric === m ? 700 : 400,
              cursor: 'pointer',
            }
          }, label);
        })
      ),
      parcelles.length === 0
        ? React.createElement('div', {
            style: { padding: '40px', textAlign: 'center', color: C.textSec, fontSize: '14px' }
          }, 'Aucune donnée pour cette sélection.')
        : React.createElement('div', { style: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', width: '100%' } },
            React.createElement('table', {
              style: { minWidth: '600px', borderCollapse: 'collapse', fontSize: '13px' }
            },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  React.createElement('th', { style: thFirstStyle }, 'Parcelle'),
                  React.createElement('th', { style: thStyle }, 'Ferme'),
                  React.createElement('th', { style: thStyle }, 'Ha'),
                  articles.map(function (art) {
                    // Trouver l'unité dans les données
                    var unite = '';
                    for (var pi = 0; pi < parcelles.length; pi++) {
                      var items = subTab === 'engrais' ? (parcelles[pi].engrais || []) : (parcelles[pi].pesticides || []);
                      for (var ii = 0; ii < items.length; ii++) {
                        if (items[ii].article === art) { unite = items[ii].unite || ''; break; }
                      }
                      if (unite) break;
                    }
                    return React.createElement('th', { key: art, style: thStyle },
                      art + (unite ? ' (' + unite + ')' : '')
                    );
                  }),
                  React.createElement('th', { style: thStyle }, 'Total DH'),
                  React.createElement('th', { style: thStyle }, 'DH/Ha')
                )
              ),
              React.createElement('tbody', null,
                parcelles.map(function (p, idx) {
                  var itemMap = {};
                  var items = subTab === 'engrais' ? (p.engrais || []) : (p.pesticides || []);
                  items.forEach(function (item) { itemMap[item.article] = item; });
                  var totalParcelle = subTab === 'engrais' ? (p.totalEngraisCout || 0) : (p.totalPesticidesCout || 0);
                  return React.createElement('tr', {
                    key: p.parcelle,
                    style: { background: idx % 2 === 0 ? C.surface : C.surface2 }
                  },
                    React.createElement('td', { style: tdFirstStyle }, p.parcelle),
                    React.createElement('td', { style: tdStyle }, p.ferme || '—'),
                    React.createElement('td', { style: tdStyle }, fmtHa(p.ha)),
                    articles.map(function (art) {
                      var item = itemMap[art];
                      if (!item || !item.qty) return React.createElement('td', { key: art, style: tdDashStyle }, '—');
                      if (metric === 'perha') {
                        var ha = p.ha || 0;
                        if (!ha) return React.createElement('td', { key: art, style: tdDashStyle }, '—');
                        return React.createElement('td', { key: art, style: tdStyle },
                          fmtQty(item.qty / ha)
                        );
                      }
                      return React.createElement('td', { key: art, style: tdStyle }, fmtQty(item.qty));
                    }),
                    React.createElement('td', { style: Object.assign({}, tdStyle, { fontWeight: 700 }) },
                      fmtDH(totalParcelle)
                    ),
                    React.createElement('td', { style: tdStyle },
                      fmtDHPerHa(totalParcelle, p.ha)
                    )
                  );
                }),
                // Ligne de total
                React.createElement('tr', { style: { background: C.berry } },
                  React.createElement('td', { style: Object.assign({}, totalCellStyle, { textAlign: 'left' }) }, 'TOTAL'),
                  React.createElement('td', { style: totalCellStyle }, ''),
                  React.createElement('td', { style: totalCellStyle }, fmtHa(totalHa)),
                  articles.map(function (art) {
                    var cell = colTotals.byArticle[art];
                    if (!cell || !cell.qty) return React.createElement('td', { key: art, style: totalCellStyle }, '—');
                    if (metric === 'perha') {
                      return React.createElement('td', { key: art, style: totalCellStyle },
                        totalHa ? fmtQty(cell.qty / totalHa) : '—'
                      );
                    }
                    return React.createElement('td', { key: art, style: totalCellStyle }, fmtQty(cell.qty));
                  }),
                  React.createElement('td', { style: totalCellStyle }, fmtDH(colTotals.totalDH)),
                  React.createElement('td', { style: totalCellStyle },
                    fmtDHPerHa(colTotals.totalDH, totalHa)
                  )
                )
              )
            )
          )
    );
  }

  /* ------------------------------------------------------------------ */
  /* Composant principal                                                  */
  /* ------------------------------------------------------------------ */
  function CampagneAnalytiqueTab(props) {
    var farmFilter = props.farmFilter || null;

    var _subTab = useState('mo');
    var subTab = _subTab[0]; var setSubTab = _subTab[1];

    var _view = useState('ha');
    var view = _view[0]; var setView = _view[1];

    var _cultureFilter = useState('Toutes');
    var cultureFilter = _cultureFilter[0]; var setCultureFilter = _cultureFilter[1];

    var _data = useState(null);
    var data = _data[0]; var setData = _data[1];

    var _loading = useState(true);
    var loading = _loading[0]; var setLoading = _loading[1];

    var _err = useState(null);
    var err = _err[0]; var setErr = _err[1];

    var _selectedParcelle = useState('');
    var selectedParcelle = _selectedParcelle[0]; var setSelectedParcelle = _selectedParcelle[1];

    // Métrique partagée entre les 2 vues MO
    var _metric = useState('cout');
    var metric = _metric[0]; var setMetric = _metric[1];

    // Données conso (lazy — chargées à la première activation engrais/pesticides)
    var _consoData = useState(null);
    var consoData = _consoData[0]; var setConsoData = _consoData[1];

    var _consoLoading = useState(false);
    var consoLoading = _consoLoading[0]; var setConsoLoading = _consoLoading[1];

    var _consoErr = useState(null);
    var consoErr = _consoErr[0]; var setConsoErr = _consoErr[1];

    // Suivi du premier chargement conso
    var _consoFetched = useState(false);
    var consoFetched = _consoFetched[0]; var setConsoFetched = _consoFetched[1];

    // Référentiel parcelles Smart Berry (culture_sb, nom_sb, ha) — en state :
    // window.SB_PARCELLE_REF est peuplé de façon asynchrone par app.jsx sans
    // re-render, il ne sert donc que de valeur initiale.
    var _sbMap = useState(window.SB_PARCELLE_REF || {});
    var sbMap = _sbMap[0]; var setSbMap = _sbMap[1];

    // Budgets JH/Ha de la campagne courante : { LABEL_BEE_ONE_MAJ: { famille:
    // jhParHa } }. Alimente les colonnes de suivi budgétaire de l'export Excel.
    // Un échec de chargement n'est PAS bloquant : l'export part sans budget
    // (colonnes vides), exactement comme avant toute saisie.
    var _budgets = useState({});
    var budgetsByLabel = _budgets[0]; var setBudgetsByLabel = _budgets[1];

    // Rechargé à CHAQUE retour sur le sous-onglet « Main Oeuvre » (d'où part
    // l'export), et pas seulement au montage : sinon un budget saisi dans le
    // sous-onglet Budget puis exporté sans recharger la page produirait un
    // fichier périmé, silencieusement.
    useEffect(function () {
      if (subTab !== 'mo') return;
      var cancelled = false;
      fetch('/api/pointage-rh?action=campagne-budget-list')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (cancelled || !d || !d.success) return;
          setBudgetsByLabel(CAT_budgetsByLabel(d.budgets || []));
        })
        .catch(function () {});
      return function () { cancelled = true; };
    }, [subTab]);

    useEffect(function () {
      fetch('/api/pointage-rh?action=sb-referentiel-list')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.success) return;
          var map = {};
          (d.parcelles || []).forEach(function (p) {
            map[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
          });
          window.SB_PARCELLE_REF = map;
          setSbMap(map);
        })
        .catch(function () {});
    }, []);

    useEffect(function () {
      setLoading(true);
      setErr(null);
      fetch('/api/pointage-rh?action=campagne-analytique-detail')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.success) {
            setData(d);
          } else {
            setErr((d && d.error) || 'Erreur lors du chargement.');
          }
        })
        .catch(function (e) { setErr(e.message || 'Erreur réseau.'); })
        .finally(function () { setLoading(false); });
    }, []);

    // Chargement conso (paresseux — uniquement à la première transition vers engrais/pesticides)
    useEffect(function () {
      // 'budget' n'utilise PAS campagne-conso-parcelle (saisie, pas conso) :
      // l'exclure évite un fetch inutile à l'ouverture de l'onglet.
      if (subTab === 'mo' || subTab === 'budget' || consoFetched) return;
      setConsoFetched(true);
      setConsoLoading(true);
      setConsoErr(null);
      fetch('/api/pointage-rh?action=campagne-conso-parcelle')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.success) {
            setConsoData(d);
          } else {
            setConsoErr((d && d.error) || 'Erreur lors du chargement de la consommation.');
          }
        })
        .catch(function (e) { setConsoErr(e.message || 'Erreur réseau.'); })
        .finally(function () { setConsoLoading(false); });
    }, [subTab]);

    // Styles communs
    var containerStyle = {
      padding: '16px',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)',
    };

    var toggleBtnStyle = function (active) {
      return {
        padding: '8px 20px',
        border: '1.5px solid ' + (active ? C.berry : C.border),
        borderRadius: '20px',
        background: active ? C.berry : C.surface,
        color: active ? '#fff' : C.text,
        fontSize: '13px',
        fontWeight: active ? 700 : 400,
        cursor: 'pointer',
        transition: 'all .15s',
      };
    };

    if (loading) {
      return React.createElement('div', {
        style: Object.assign({}, containerStyle, { display: 'flex', alignItems: 'center', gap: '10px', color: C.textSec })
      },
        React.createElement('i', { className: 'fa-solid fa-spinner fa-spin' }),
        'Chargement de la campagne analytique…'
      );
    }

    if (err) {
      return React.createElement('div', {
        style: Object.assign({}, containerStyle, { color: '#c0392b', padding: '24px' })
      },
        React.createElement('i', { className: 'fa-solid fa-triangle-exclamation', style: { marginRight: '8px' } }),
        err
      );
    }

    if (!data) {
      return React.createElement('div', { style: containerStyle }, 'Aucune donnée disponible.');
    }

    // Sous-tabs definition
    // 'budget' n'est proposé que si le composant est réellement chargé : une
    // référence nue à un global absent crashe GLOBALEMENT (piège projet
    // « tab bare global ref »), on garde donc l'onglet ET son rendu.
    var subTabs = [
      { id: 'mo',         label: 'Main Oeuvre',  icon: 'fa-person-digging' },
      { id: 'engrais',    label: 'Engrais',       icon: 'fa-flask' },
      { id: 'pesticides', label: 'Pesticides',    icon: 'fa-spray-can' },
    ];
    if (window.CampagneBudgetTab) {
      subTabs.push({ id: 'budget', label: 'Budget', icon: 'fa-bullseye' });
    }

    var cultures = ['Toutes', 'Framboise', 'Myrtille', 'Avocatier'];

    return React.createElement('div', { style: containerStyle },
      // En-tête : info campagne
      React.createElement('div', { style: { marginBottom: '12px' } },
        React.createElement('p', {
          style: { margin: 0, fontSize: '13px', color: C.textSec }
        }, 'Campagne ' + data.campagne + ' — ' + (data.rows || []).length + ' lignes MO')
      ),

      // Ligne 1 : Sub-tabs (MO | Engrais | Pesticides) + toggle vue (si MO)
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '12px' }
      },
        // Sub-tab buttons
        React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
          subTabs.map(function (st) {
            return React.createElement('button', {
              key: st.id,
              onClick: function () { setSubTab(st.id); },
              style: toggleBtnStyle(subTab === st.id),
            },
              React.createElement('i', { className: 'fa-solid ' + st.icon, style: { marginRight: '6px' } }),
              st.label
            );
          })
        ),
        // Vue toggle (uniquement en MO)
        subTab === 'mo'
          ? React.createElement('div', { style: { display: 'flex', gap: '8px' } },
              React.createElement('button', {
                onClick: function () { setView('ha'); },
                style: toggleBtnStyle(view === 'ha'),
              },
                React.createElement('i', { className: 'fa-solid fa-chart-bar', style: { marginRight: '6px' } }),
                'Affectation par Ha'
              ),
              React.createElement('button', {
                onClick: function () { setView('variete'); },
                style: toggleBtnStyle(view === 'variete'),
              },
                React.createElement('i', { className: 'fa-solid fa-table', style: { marginRight: '6px' } }),
                'Par Variété / Quinzaine'
              ),
              // Vue AJOUTÉE (LOT 2b) : la grille de l'écran Quinzaine, sans
              // rien retirer des deux vues existantes — leur suppression
              // éventuelle est une décision produit, pas un effet de bord.
              React.createElement('button', {
                onClick: function () { setView('pivot'); },
                style: toggleBtnStyle(view === 'pivot'),
              },
                React.createElement('i', { className: 'fa-solid fa-table-cells-large', style: { marginRight: '6px' } }),
                'Pivot analytique'
              )
            )
          : null
      ),

      // Ligne 2 : Filtre culture (masqué sur 'budget' : la saisie porte sur UNE
      // parcelle choisie explicitement, un filtre culture sans effet mentirait).
      subTab !== 'budget' && React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }
      },
        React.createElement('span', { style: { fontSize: '13px', color: C.textSec, marginRight: '4px' } }, 'Culture :'),
        cultures.map(function (c) {
          return React.createElement('button', {
            key: c,
            onClick: function () { setCultureFilter(c); },
            style: {
              padding: '5px 14px',
              border: '1.5px solid ' + (cultureFilter === c ? C.berry : C.border),
              borderRadius: '16px',
              background: cultureFilter === c ? C.berry : C.surface,
              color: cultureFilter === c ? '#fff' : C.text,
              fontSize: '12px',
              fontWeight: cultureFilter === c ? 700 : 400,
              cursor: 'pointer',
            }
          }, c);
        })
      ),

      // Contenu
      subTab === 'budget'
        ? (window.CampagneBudgetTab
            ? React.createElement(window.CampagneBudgetTab, { userRole: props.userRole })
            : null)
      : subTab === 'mo'
        ? (view === 'pivot'
            ? React.createElement(PivotView, {
                data: data,
                farmFilter: farmFilter,
                cultureFilter: cultureFilter,
                sbMap: sbMap,
                metric: metric,
                setMetric: setMetric,
              })
          : view === 'ha'
            ? React.createElement(HaView, {
                data: data,
                farmFilter: farmFilter,
                cultureFilter: cultureFilter,
                sbMap: sbMap,
                metric: metric,
                setMetric: setMetric,
              })
            : React.createElement(VarieteView, {
                data: data,
                farmFilter: farmFilter,
                cultureFilter: cultureFilter,
                sbMap: sbMap,
                budgetsByLabel: budgetsByLabel,
                selectedParcelle: selectedParcelle,
                setSelectedParcelle: setSelectedParcelle,
                metric: metric,
                setMetric: setMetric,
              })
          )
        : (consoLoading
            ? React.createElement('div', {
                style: { display: 'flex', alignItems: 'center', gap: '10px', color: C.textSec, padding: '24px' }
              },
                React.createElement('i', { className: 'fa-solid fa-spinner fa-spin' }),
                'Chargement de la consommation…'
              )
            : consoErr
              ? React.createElement('div', {
                  style: { color: '#c0392b', padding: '24px' }
                },
                  React.createElement('i', { className: 'fa-solid fa-triangle-exclamation', style: { marginRight: '8px' } }),
                  consoErr
                )
              : React.createElement(ConsoView, {
                  consoData: consoData,
                  subTab: subTab,
                  farmFilter: farmFilter,
                  cultureFilter: cultureFilter,
                  sbMap: sbMap,
                })
          )
    );
  }

  window.CampagneAnalytiqueTab = CampagneAnalytiqueTab;
  // Exposés pour les tests unitaires (node:test + vm), comme CampagneBudgetTab.
  CampagneAnalytiqueTab.budgetsByLabel = CAT_budgetsByLabel;
  CampagneAnalytiqueTab.buildCultureWorkbook = buildCultureWorkbook;
  CampagneAnalytiqueTab.pivotRows = CAT_pivotRows;
  CampagneAnalytiqueTab.byCulture = CAT_byCulture;
  CampagneAnalytiqueTab.PivotView = PivotView;

})();
