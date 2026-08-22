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
    berry: '#c0392b',
    green: '#1D9E75',
    blue: '#2563eb',
    gray: '#888780',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    surface3: '#ebeae3',
    border: 'rgba(0,0,0,0.10)',
    text: '#1c1c1a',
    textSec: '#5f5e5a'
  };

  /* ------------------------------------------------------------------ */
  /* Icônes familles (copié de ParcellesReferentielTab pour cohérence)   */
  /* ------------------------------------------------------------------ */
  var FAMILLE_ICONS = {
    'Travaux du sol': 'fa-trowel',
    'Ferti-irrigation': 'fa-droplet',
    'Plantation': 'fa-seedling',
    'Mise en valeur': 'fa-hammer',
    'Entretien structure': 'fa-screwdriver-wrench',
    'Traitement phyto': 'fa-spray-can',
    'Tuteurage & palissage': 'fa-grip-lines-vertical',
    'Taille': 'fa-scissors',
    'Arrachage': 'fa-shovel',
    'Services généraux': 'fa-people-group',
    'Récolte': 'fa-basket-shopping'
  };

  /**
   * Identité visuelle des cultures dans la vue Pivot analytique — MÊMES
   * couleurs et icônes que le panneau Affectation Analytique de l'écran
   * Quinzaine, pour qu'un utilisateur reconnaisse la même grille d'un écran à
   * l'autre.
   */
  var CAT_CULTURES_DEF = [{
    culture: 'Framboise',
    color: '#8B2252',
    icon: 'fa-seedling'
  }, {
    culture: 'Myrtille',
    color: '#3498DB',
    icon: 'fa-circle-dot'
  }, {
    culture: 'Avocatier',
    color: '#2D8B4E',
    icon: 'fa-tree'
  }];

  /** Titre du groupe quand la culture n'a PAS pu être résolue (cf. CAT_byCulture). */
  var CAT_CULTURE_INCONNUE = 'Culture non résolue';

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
    return CU.resolveCulture({
      label: label
    }, sbMap);
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
      var key = String(b && b.label_bee_one || '').trim().toUpperCase();
      if (!key) return;
      out[key] = b && b.budgets || {};
    });
    return out;
  }

  /**
   * Idem pour les budgets PAR OPÉRATION (`budgets_operations`). PURE.
   *
   * Séparé de CAT_budgetsByLabel, comme côté saisie (CampagneBudgetTab) : un
   * document écrit avant la descente au niveau opération n'a pas ce champ et
   * doit rester lisible tel quel (→ map vide, aucune migration).
   *
   * @param {Array<{label_bee_one?: string, budgets_operations?: Object}>} list
   * @returns {Object<string, Object<string, Object<string, number>>>}
   *   LABEL_MAJ → famille → `CODE::Libellé` → JH/Ha
   */
  function CAT_opBudgetsByLabel(list) {
    var out = {};
    (list || []).forEach(function (b) {
      var key = String(b && b.label_bee_one || '').trim().toUpperCase();
      if (!key) return;
      out[key] = b && b.budgets_operations || {};
    });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Helpers de calcul pivot                                              */
  /* ------------------------------------------------------------------ */
  // `buildHaView` (agrégation parcelle × famille de l'ancienne vue tabulaire)
  // est SUPPRIMÉ : la vue « Affectation par Ha » est désormais rendue par la
  // grille partagée (PivotView + AnalytiqueUtils.buildAnalytiquePivotByFamille),
  // qui agrège la même chose. Aucun autre appelant (vérifié dans tout le repo).

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
          total: {
            jh: 0,
            cout: 0
          }
        };
      }
      if (!byOp[key].byPeriode[r.periode]) byOp[key].byPeriode[r.periode] = {
        jh: 0,
        cout: 0
      };
      byOp[key].byPeriode[r.periode].jh += r.jh;
      byOp[key].byPeriode[r.periode].cout += r.cout;
      byOp[key].total.jh += r.jh;
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
   * ⚠️ VENTILATION DIFFÉRENTE DE L'ANCIENNE VUE TABULAIRE (attendu, pas un bug).
   * `buildHaView` regroupait sur `refParcelle || parcelle`, cette grille sur
   * `parcelle || refParcelle`. Or plusieurs libellés culturaux partagent un même
   * Ref_parcelle en production — relevé exhaustivement sur la campagne
   * 2026-2027 (44 journées, 4 328 lignes de sql_mirror_pointage, 2026-08-13) :
   *   F5 → « CASCADE MYRTILLE S8-1 », « BREEZE MYRTILLE S8-2 »,
   *        « F5 CORINA myrtille S8-3 », « AVOCAT F5 »
   *   F2 → « F2 - HAAS », « F2 - ZUTANO »
   *   F4 → « F4 -HAAS », « F4 -FUERTE »
   * L'ancienne vue en faisait UNE ligne (« F5 » mélangeait donc trois parcelles
   * de myrtille ET l'avocatier, avec le Ha d'un seul libellé au dénominateur du
   * DH/Ha) ; la grille en fait autant de colonnes, chacune avec SON Ha et SA
   * culture. Les totaux généraux sont identiques, la ventilation est plus fine.
   * Aucun libellé ne porte deux Ref_parcelle (0 cas), donc rien n'est éclaté à
   * tort dans l'autre sens.
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
    var farmFilter = opts && opts.farmFilter || null;
    var cultureFilter = opts && opts.cultureFilter || null;
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
        coutCharge: r.coutCharge || 0,
        nbOuv: r.nbOuv || 0,
        // Quinzaine de la ligne : recopiée telle quelle, uniquement pour que la
        // moyenne mobile du « reste au rythme » (CampagneRythme) la retrouve
        // dans les `detailRows` des cellules. Le pivot ne s'en sert pas.
        periode: r.periode,
        operation: r.operation,
        operationGroupe: r.code,
        operationFamille: r.famille
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
   * ⚠️ Culture NON RÉSOLUE (module CultureUtils absent) → groupe explicite
   * `CAT_CULTURE_INCONNUE`, JAMAIS un repli sur 'Framboise' : une grille titrée
   * « Framboise » remplie de myrtilles est un mensonge silencieux, que personne
   * ne peut détecter en lisant l'écran. L'appelant (PivotView) intercepte le cas
   * en amont avec un message d'erreur ; ce groupe est la ceinture de sécurité
   * pour tout autre appelant.
   *
   * @param {Array<Object>} pivotRows
   * @param {Object} sbMap
   * @returns {Array<{culture: string, color: string, icon: string, rows: Array<Object>}>}
   */
  function CAT_byCulture(pivotRows, sbMap) {
    var groups = {};
    (pivotRows || []).forEach(function (r) {
      var c = cultureOf(r.parcelle, sbMap) || CAT_CULTURE_INCONNUE;
      if (!groups[c]) groups[c] = [];
      groups[c].push(r);
    });
    var out = [];
    CAT_CULTURES_DEF.forEach(function (def) {
      if (groups[def.culture] && groups[def.culture].length) {
        out.push({
          culture: def.culture,
          color: def.color,
          icon: def.icon,
          rows: groups[def.culture]
        });
      }
    });
    Object.keys(groups).forEach(function (c) {
      if (out.some(function (o) {
        return o.culture === c;
      })) return;
      out.push({
        culture: c,
        color: C.gray,
        icon: 'fa-leaf',
        rows: groups[c]
      });
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
  function buildCultureWorkbook(culture, data, farmFilter, sbMap, budgetsByLabel, opBudgetsByLabel) {
    var CEU = window.CampagneExportUtils;
    var rows = data && data.rows || [];
    var periodes = data && data.periodes || [];
    var haByRef = data && data.haByRef || {};
    var budgets = budgetsByLabel || {};
    var opBudgets = opBudgetsByLabel || {};
    // Règle métier du budget + référentiel analytique, INJECTÉS dans les helpers
    // purs (qui n'ont pas le droit de lire `window`). Modules absents → l'index
    // dégrade vers le seul niveau famille, exactement comme avant ce lot.
    var budgetRules = window.CampagneBudgetTab;
    var analytique = window.AnalytiqueUtils;

    // Parcelles de la culture (distinctes, ordre alphabétique du nom SB)
    var seen = {};
    var labels = [];
    rows.forEach(function (r) {
      var label = r.parcelle || r.refParcelle;
      if (!label || seen[label]) return;
      if (farmFilter && r.ferme !== farmFilter) return;
      if (cultureOf(label, sbMap) !== culture) return;
      seen[label] = {
        ferme: r.ferme
      };
      labels.push(label);
    });
    labels.sort(function (a, b) {
      return sbNom(a, sbMap).localeCompare(sbNom(b, sbMap));
    });
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
        campagne: data && data.campagne || '',
        periodes: periodes,
        opRows: opRows,
        famillesOrdered: data && data.famillesOrdered || [],
        budgets: budParcelle,
        budgetsOperations: opBudParcelle,
        budgetRules: budgetRules,
        analytique: analytique
      };
      // La Synthèse reçoit les budgets EFFECTIFS par famille (règle
      // `familleTotal` appliquée), pas la saisie brute : sinon une parcelle
      // budgétée à la maille opération sortirait remplie sur sa feuille et vide
      // sur la Synthèse.
      var budgetIndex = CEU.buildParcelleBudgetIndex({
        budgets: budParcelle,
        budgetsOperations: opBudParcelle,
        budgetRules: budgetRules,
        analytique: analytique
      });
      synthese.push({
        nomSb: nom,
        label: label,
        ferme: seen[label].ferme,
        ha: ha,
        totalJh: totalJh,
        budgets: budgetIndex.resolveFamilles(opRows, params.famillesOrdered).scope,
        jhByFamille: jhByFamille
      });
      sheets.push({
        name: CEU.safeSheetName(nom, i + 1, used),
        rows: CEU.buildParcelleSheetRows(params),
        aoa: CEU.buildParcelleSheetAoA(params),
        cols: CEU.parcelleSheetCols(periodes.length)
      });
    });
    return {
      fileName: 'Campagne_' + culture + '_' + new Date().toISOString().slice(0, 10),
      sheets: [{
        name: syntheseName,
        rows: CEU.buildSyntheseRows(synthese),
        aoa: CEU.buildSyntheseAoA(synthese),
        cols: CEU.syntheseSheetCols()
      }].concat(sheets)
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
        if (window.ExcelJS) {
          resolve(window.ExcelJS);
          return;
        }
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
    berry: 'FFC0392B',
    berryLight: 'FFF7E3E1',
    grayLight: 'FFEBEAE3',
    white: 'FFFFFFFF',
    textSec: 'FF5F5E5A',
    border: 'FFD8D6CF',
    // Dépassement de budget (> 100 % consommé) — rouge/rose « Incorrect »
    // d'Excel, lisible aussi en niveaux de gris à l'impression.
    badText: 'FF9C0006',
    badFill: 'FFFFC7CE'
  };
  function xlFill(argb) {
    return {
      type: 'pattern',
      pattern: 'solid',
      fgColor: {
        argb: argb
      }
    };
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
      row.getCell(1).font = {
        bold: true,
        color: {
          argb: XL.textSec
        }
      };
      return;
    }
    if (kind === K.COL_HEADER) {
      row.font = {
        bold: true,
        color: {
          argb: XL.white
        }
      };
      styleFullWidth(row, nbCols, function (cell) {
        cell.font = {
          bold: true,
          color: {
            argb: XL.white
          }
        };
        cell.fill = xlFill(XL.berry);
      });
      return;
    }
    if (kind === K.FAMILLE) {
      row.font = {
        bold: true
      };
      styleFullWidth(row, nbCols, function (cell) {
        cell.font = {
          bold: true
        };
        cell.fill = xlFill(XL.grayLight);
      });
      return;
    }
    if (kind === K.OPERATION) {
      // Indentation NATIVE Excel (pas d'espaces en dur) : alignement propre et
      // libellé toujours recherchable tel quel.
      row.getCell(1).alignment = {
        indent: 1
      };
      return;
    }
    if (kind === K.NOTE) {
      // Mention de périmètre : discrète (italique, gris), jamais un bandeau —
      // elle informe sans concurrencer les totaux.
      row.getCell(1).font = {
        italic: true,
        size: 9,
        color: {
          argb: XL.textSec
        }
      };
      return;
    }
    if (kind === K.TOTAL_FAMILLE) {
      row.font = {
        bold: true
      };
      styleFullWidth(row, nbCols, function (cell) {
        cell.font = {
          bold: true
        };
        cell.border = {
          top: {
            style: 'thin',
            color: {
              argb: XL.border
            }
          }
        };
      });
      return;
    }
    if (kind === K.TOTAL_GENERAL) {
      row.font = {
        bold: true
      };
      styleFullWidth(row, nbCols, function (cell) {
        cell.font = {
          bold: true
        };
        cell.fill = xlFill(XL.berryLight);
        cell.border = {
          top: {
            style: 'medium',
            color: {
              argb: XL.berry
            }
          }
        };
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
        ws.columns = s.cols.map(function (c) {
          return {
            width: c.wch
          };
        });
      }
      // Largeur de la feuille : les largeurs de colonnes font foi, avec un
      // garde-fou sur la ligne la plus longue (feuille sans `cols`).
      var nbCols = s.cols && s.cols.length || 0;
      s.rows.forEach(function (r) {
        if (r.cells.length > nbCols) nbCols = r.cells.length;
      });
      var headerRowIndex = 0;
      // Colonne(s) « % Consommé » repérées par leur EN-TÊTE (jamais un index en
      // dur) : elles portent un RATIO, à afficher avec un format de pourcentage
      // — c'est le code de format qui multiplie par 100.
      var pctCols = {};
      CEU.percentColumns(s.rows).forEach(function (c) {
        pctCols[c] = true;
      });
      s.rows.forEach(function (r, i) {
        var row = ws.addRow(r.cells);
        if (r.kind === K.COL_HEADER) headerRowIndex = i + 1;
        styleRow(row, r.kind, K, nbCols);
        // Nombres : alignés à droite, format lisible (séparateur de milliers).
        // Le format est choisi VALEUR PAR VALEUR (CEU.numFmtFor) : un format
        // unique `#,##0.##` laisse un séparateur décimal traîner sur les
        // entiers (« 6. », « 12. »).
        row.eachCell({
          includeEmpty: false
        }, function (cell, col) {
          if (col === 1) return;
          if (pctCols[col] && r.kind !== K.COL_HEADER) {
            var pfmt = CEU.percentFmtFor(cell.value);
            if (!pfmt) return;
            cell.alignment = {
              horizontal: 'right'
            };
            cell.numFmt = pfmt;
            // Dépassement : signalé, JAMAIS plafonné (la valeur reste exacte).
            if (cell.value > 1) {
              cell.font = {
                bold: true,
                color: {
                  argb: XL.badText
                }
              };
              cell.fill = xlFill(XL.badFill);
            }
            return;
          }
          var fmt = CEU.numFmtFor(cell.value);
          if (fmt) {
            cell.alignment = {
              horizontal: 'right'
            };
            cell.numFmt = fmt;
          }
        });
      });
      // Volets figés sous l'en-tête de colonnes (ignoré par SheetJS community).
      if (headerRowIndex) {
        ws.views = [{
          state: 'frozen',
          xSplit: 1,
          ySplit: headerRowIndex
        }];
      }
    });
    return wb.xlsx.writeBuffer().then(function (buf) {
      downloadBlob(new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }), wbData.fileName + '.xlsx');
    });
  }

  /* ---- Repli SheetJS / CSV (sans styles) ----------------------------- */

  function downloadBlob(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
            var addr = window.XLSX.utils.encode_cell({
              c: col - 1,
              r: ri
            });
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
    downloadBlob(new Blob(['﻿' + csv], {
      type: 'text/csv;charset=utf-8;'
    }), wbData.fileName + '.csv');
  }

  /**
   * Export d'une culture. Charge ExcelJS à la demande pour un fichier stylé ;
   * si le CDN est injoignable, retombe sur l'export SheetJS (sans styles)
   * plutôt que d'échouer. Retourne toujours une Promise résolue.
   */
  function exportCulture(culture, data, farmFilter, sbMap, budgetsByLabel, opBudgetsByLabel) {
    if (!window.CampagneExportUtils) return Promise.resolve();
    var wbData = buildCultureWorkbook(culture, data, farmFilter, sbMap, budgetsByLabel, opBudgetsByLabel);
    if (wbData.sheets.length <= 1) {
      window.alert('Aucune parcelle ' + culture + ' dans le périmètre.');
      return Promise.resolve();
    }
    return loadExcelJS().then(function (ExcelJS) {
      return writeWithExcelJS(ExcelJS, wbData);
    }).catch(function (e) {
      if (window.console) {
        console.warn('[Campagne] Export stylé indisponible (' + (e && e.message) + ') — repli sans mise en forme.');
      }
      writeWithoutStyles(wbData);
    });
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
    var opBudgetsByLabel = props.opBudgetsByLabel || {};
    var selectedParcelle = props.selectedParcelle;
    var setSelectedParcelle = props.setSelectedParcelle;
    var metric = props.metric;
    var setMetric = props.setMetric;

    // Culture dont l'export est en cours (ExcelJS chargé à la demande) — null
    // quand aucun export ne tourne.
    var _exporting = useState(null);
    var exporting = _exporting[0];
    var setExporting = _exporting[1];

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
        list.push({
          value: key,
          label: sbNom(key, sbMap)
        });
      });
      return list.sort(function (a, b) {
        return a.label.localeCompare(b.label);
      });
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
      opRows.forEach(function (r) {
        seen[r.famille] = true;
      });
      var ordered = order.filter(function (f) {
        return seen[f];
      });
      Object.keys(seen).forEach(function (f) {
        if (ordered.indexOf(f) === -1) ordered.push(f);
      });
      return ordered;
    }, [opRows, data.famillesOrdered]);

    // Totaux généraux par période
    var grandTotals = useMemo(function () {
      var byP = {};
      var total = {
        jh: 0,
        cout: 0
      };
      opRows.forEach(function (r) {
        periodes.forEach(function (p) {
          if (!byP[p]) byP[p] = {
            jh: 0,
            cout: 0
          };
          var cell = r.byPeriode[p];
          if (cell) {
            byP[p].jh += cell.jh;
            byP[p].cout += cell.cout;
          }
        });
        total.jh += r.total.jh;
        total.cout += r.total.cout;
      });
      return {
        byP: byP,
        total: total
      };
    }, [opRows, periodes]);

    // ---- Suivi budgétaire : MÊMES helpers purs que la feuille Excel ---------
    //
    // Rien n'est recalculé ici. La grille écran et l'export doivent afficher les
    // MÊMES chiffres : deux implémentations divergeraient au premier changement
    // de règle. Le composant ne fait qu'INJECTER (règle métier + référentiel) et
    // formater.
    //
    // Le budget n'existe qu'en JH/Ha : en mode « Coût DH » les 5 colonnes ne
    // sont pas rendues du tout (une conversion en dirhams serait une invention).
    var CEU = window.CampagneExportUtils;
    var showBudget = metric === 'jh' && !!(CEU && CEU.buildParcelleBudgetIndex);
    var budgetIndex = useMemo(function () {
      if (!CEU || typeof CEU.buildParcelleBudgetIndex !== 'function') return null;
      // MÊME clé de jointure que l'export et que sbMap : toute autre
      // normalisation raterait tous les budgets, en silence.
      var key = String(selectedParcelle || '').toUpperCase().trim();
      return CEU.buildParcelleBudgetIndex({
        budgets: budgetsByLabel[key] || {},
        budgetsOperations: opBudgetsByLabel[key] || {},
        budgetRules: window.CampagneBudgetTab,
        analytique: window.AnalytiqueUtils
      });
    }, [selectedParcelle, budgetsByLabel, opBudgetsByLabel]);

    // Budgets effectifs par famille + périmètre du TOTAL GÉNÉRAL, résolus en un
    // passage — exactement l'appel que fait buildParcelleSheetRows.
    var budgetFamilles = useMemo(function () {
      if (!budgetIndex) return {
        parFamille: {},
        scope: {}
      };
      return budgetIndex.resolveFamilles(opRows, data.famillesOrdered);
    }, [budgetIndex, opRows, data.famillesOrdered]);
    var budgetScope = useMemo(function () {
      if (!budgetIndex || !CEU) return null;
      var jhByFamille = {};
      opRows.forEach(function (r) {
        if (!r.famille) return;
        jhByFamille[r.famille] = (jhByFamille[r.famille] || 0) + (r.total.jh || 0);
      });
      return CEU.budgetScope(budgetFamilles.scope, jhByFamille);
    }, [budgetIndex, budgetFamilles, opRows]);
    var thStyle = {
      padding: '8px 10px',
      borderBottom: '2px solid ' + C.border,
      background: C.surface2,
      fontSize: '12px',
      fontWeight: 600,
      color: C.textSec,
      whiteSpace: 'nowrap',
      textAlign: 'right'
    };
    var thFirstStyle = Object.assign({}, thStyle, {
      textAlign: 'left',
      minWidth: '200px'
    });
    var tdStyle = {
      padding: '7px 10px',
      borderBottom: '1px solid ' + C.border,
      fontSize: '13px',
      color: C.text,
      textAlign: 'right',
      whiteSpace: 'nowrap'
    };
    var tdFirstStyle = Object.assign({}, tdStyle, {
      textAlign: 'left'
    });
    var tdDashStyle = Object.assign({}, tdStyle, {
      color: C.textSec
    });
    function renderVal(cell) {
      if (!cell) return React.createElement('td', {
        style: tdDashStyle
      }, '—');
      var v = metric === 'cout' ? cell.cout : cell.jh;
      if (!v || v === 0) return React.createElement('td', {
        style: tdDashStyle
      }, '—');
      return React.createElement('td', {
        style: tdStyle
      }, metric === 'cout' ? fmtDH(v) : fmtJH(v));
    }

    /**
     * Nombre d'une colonne budgétaire. CONSERVE le zéro (contrairement à fmtJH) :
     * « 0 JH restant » est une information, pas une case vide.
     */
    function fmtBudgetNum(v) {
      return (Math.round(v * 10) / 10).toLocaleString('fr-MA');
    }

    /**
     * Les 5 cellules de droite d'une ligne : « Total JH / Ha » puis les 4 du
     * suivi budgétaire, calculées par les helpers de l'export (CEU.perHa /
     * CEU.budgetCells) — jamais recodées ici.
     *
     * Cellule vide (pas de budget, superficie inconnue) → « — », convention de
     * la table : jamais 0, jamais 100 %. Au-delà de 100 % consommé, même signal
     * que l'export : rouge, sans plafonnement.
     *
     * `jh` (consommé du PÉRIMÈTRE BUDGÉTÉ) et `jhTotal` (volume exhaustif de la
     * ligne) diffèrent sur le TOTAL GÉNÉRAL : la colonne « Total JH / Ha » ne
     * perd aucun JH, les colonnes budgétaires comparent à périmètre égal.
     *
     * @param {{budget:*, jh:number, jhTotal?:number, base:Object, keyPrefix:string}} o
     */
    function budgetTds(o) {
      var base = o.base;
      var jh = o.jh;
      var jhTotal = o.jhTotal === undefined ? jh : o.jhTotal;
      var out = [React.createElement('td', {
        key: o.keyPrefix + '-perha',
        style: base
      }, function () {
        var v = CEU.perHa(jhTotal, selectedHa);
        return v === '' ? '—' : fmtBudgetNum(v);
      }())];
      var keyPrefix = o.keyPrefix;
      CEU.budgetCells(o.budget, selectedHa, jh).forEach(function (c, i) {
        if (c === '') {
          out.push(React.createElement('td', {
            key: keyPrefix + '-b' + i,
            style: Object.assign({}, base, {
              color: base.color || C.textSec
            })
          }, '—'));
          return;
        }
        if (i === 1) {
          var pct = Math.round(c * 1000) / 10;
          out.push(React.createElement('td', {
            key: keyPrefix + '-b' + i,
            style: Object.assign({}, base, pct > 100 ? {
              color: C.berry
            } : null)
          }, fmtBudgetNum(pct) + ' %'));
          return;
        }
        out.push(React.createElement('td', {
          key: keyPrefix + '-b' + i,
          style: base
        }, fmtBudgetNum(c)));
      });
      return out;
    }
    return React.createElement('div', null,
    // Barre de contrôle
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '16px',
        flexWrap: 'wrap'
      }
    }, React.createElement('label', {
      style: {
        fontSize: '13px',
        color: C.textSec
      }
    }, 'Parcelle :'), React.createElement('select', {
      value: selectedParcelle,
      onChange: function (e) {
        setSelectedParcelle(e.target.value);
      },
      style: {
        padding: '6px 10px',
        borderRadius: '6px',
        border: '1.5px solid ' + C.border,
        fontSize: '13px',
        minWidth: '180px'
      }
    }, React.createElement('option', {
      value: ''
    }, '— Choisir une parcelle —'), parcelles.map(function (p) {
      return React.createElement('option', {
        key: p.value,
        value: p.value
      }, p.label);
    })), selectedParcelle ? React.createElement('span', {
      style: {
        fontSize: '13px',
        color: C.textSec
      }
    }, 'Superficie : ' + fmtHaLabel(selectedHa)) : null, React.createElement('span', {
      style: {
        marginLeft: '8px'
      }
    }), ['jh', 'cout'].map(function (m) {
      var label = m === 'cout' ? 'Coût DH' : 'JH';
      return React.createElement('button', {
        key: m,
        onClick: function () {
          setMetric(m);
        },
        style: {
          padding: '5px 14px',
          border: '1.5px solid ' + (metric === m ? C.berry : C.border),
          borderRadius: '16px',
          background: metric === m ? C.berry : C.surface,
          color: metric === m ? '#fff' : C.text,
          fontSize: '12px',
          fontWeight: metric === m ? 700 : 400,
          cursor: 'pointer'
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
          Promise.resolve().then(function () {
            return exportCulture(cult, data, farmFilter, sbMap, budgetsByLabel, opBudgetsByLabel);
          }).catch(function (e) {
            if (window.console) console.error('[Campagne] Export ' + cult + ' échoué :', e);
          }).then(function () {
            setExporting(null);
          });
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
          opacity: disabled && !busy ? 0.5 : 1
        }
      }, React.createElement('i', {
        className: busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-excel',
        style: {
          marginRight: '6px'
        }
      }), busy ? 'Génération…' : 'Export ' + cult);
    })),
    // Contenu
    !selectedParcelle ? React.createElement('div', {
      style: {
        padding: '40px',
        textAlign: 'center',
        color: C.textSec,
        fontSize: '14px'
      }
    }, 'Sélectionner une parcelle pour afficher le pivot quinzaines.') : opRows.length === 0 ? React.createElement('div', {
      style: {
        padding: '40px',
        textAlign: 'center',
        color: C.textSec,
        fontSize: '14px'
      }
    }, 'Aucune donnée pour cette parcelle.') : React.createElement('div', {
      style: {
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        width: '100%'
      }
    }, React.createElement('table', {
      style: {
        minWidth: '600px',
        borderCollapse: 'collapse',
        fontSize: '12px'
      }
    }, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', {
      style: thFirstStyle
    }, 'Famille / Opération'), periodes.map(function (p) {
      return React.createElement('th', {
        key: p,
        style: thStyle
      }, p);
    }), React.createElement('th', {
      style: thStyle
    }, 'Total'),
    // Colonnes de suivi budgétaire — libellés repris de l'export
    // (source unique : un libellé dupliqué finirait par diverger).
    showBudget ? [React.createElement('th', {
      key: 'perha',
      style: thStyle
    }, 'Total JH / Ha')].concat(CEU.BUDGET_HEADER.map(function (h) {
      return React.createElement('th', {
        key: h,
        style: thStyle
      }, h);
    })) : null)), React.createElement('tbody', null, familles.map(function (famille) {
      var famRows = opRows.filter(function (r) {
        return r.famille === famille;
      });
      if (famRows.length === 0) return null;
      // Total famille
      var famTotal = {
        byP: {},
        total: {
          jh: 0,
          cout: 0
        }
      };
      famRows.forEach(function (r) {
        periodes.forEach(function (p) {
          if (!famTotal.byP[p]) famTotal.byP[p] = {
            jh: 0,
            cout: 0
          };
          var cell = r.byPeriode[p];
          if (cell) {
            famTotal.byP[p].jh += cell.jh;
            famTotal.byP[p].cout += cell.cout;
          }
        });
        famTotal.total.jh += r.total.jh;
        famTotal.total.cout += r.total.cout;
      });
      var icon = FAMILLE_ICONS[famille];
      var elems = [];
      // Header famille
      elems.push(React.createElement('tr', {
        key: 'fam-' + famille,
        style: {
          background: '#ebeae3'
        }
      }, React.createElement('td', {
        // Libellé + quinzaines + Total (+ les 5 colonnes de
        // droite quand elles sont rendues).
        colSpan: periodes.length + 2 + (showBudget ? 5 : 0),
        style: {
          padding: '6px 10px',
          fontWeight: 700,
          fontSize: '12px',
          color: C.textSec
        }
      }, icon ? React.createElement('i', {
        className: 'fa-solid ' + icon,
        style: {
          marginRight: '6px'
        }
      }) : null, famille)));
      // Lignes opérations
      famRows.forEach(function (r, ri) {
        elems.push(React.createElement('tr', {
          key: 'op-' + famille + '-' + ri,
          style: {
            background: ri % 2 === 0 ? C.surface : C.surface2
          }
        }, React.createElement('td', {
          style: Object.assign({}, tdFirstStyle, {
            paddingLeft: '24px'
          })
        }, r.operation), periodes.map(function (p) {
          return React.createElement(React.Fragment, {
            key: p
          }, renderVal(r.byPeriode[p]));
        }), React.createElement('td', {
          style: Object.assign({}, tdStyle, {
            fontWeight: 600
          })
        }, metric === 'cout' ? fmtDH(r.total.cout) : fmtJH(r.total.jh)), showBudget ? budgetTds({
          budget: budgetIndex.operation(r.code, r.operation, r.famille),
          jh: r.total.jh,
          base: tdStyle,
          keyPrefix: 'op-' + famille + '-' + ri
        }) : null));
      });
      // Ligne total famille
      elems.push(React.createElement('tr', {
        key: 'famtotal-' + famille,
        style: {
          background: '#d4d3cc'
        }
      }, React.createElement('td', {
        style: Object.assign({}, tdFirstStyle, {
          fontWeight: 700,
          paddingLeft: '16px'
        })
      }, 'Total ' + famille), periodes.map(function (p) {
        var cell = famTotal.byP[p];
        var v = cell ? metric === 'cout' ? cell.cout : cell.jh : 0;
        return React.createElement('td', {
          key: p,
          style: Object.assign({}, tdStyle, {
            fontWeight: 700
          })
        }, v ? metric === 'cout' ? fmtDH(v) : fmtJH(v) : '—');
      }), React.createElement('td', {
        style: Object.assign({}, tdStyle, {
          fontWeight: 700
        })
      }, metric === 'cout' ? fmtDH(famTotal.total.cout) : fmtJH(famTotal.total.jh)), showBudget ? budgetTds({
        budget: budgetFamilles.parFamille[famille],
        jh: famTotal.total.jh,
        base: Object.assign({}, tdStyle, {
          fontWeight: 700
        }),
        keyPrefix: 'famtotal-' + famille
      }) : null));
      return elems;
    }),
    // Total général
    React.createElement('tr', {
      style: {
        background: C.berry
      }
    }, React.createElement('td', {
      style: {
        padding: '8px 10px',
        fontWeight: 700,
        fontSize: '13px',
        color: '#fff',
        textAlign: 'left'
      }
    }, 'TOTAL GÉNÉRAL'), periodes.map(function (p) {
      var cell = grandTotals.byP[p];
      var v = cell ? metric === 'cout' ? cell.cout : cell.jh : 0;
      return React.createElement('td', {
        key: p,
        style: {
          padding: '8px 10px',
          fontWeight: 700,
          fontSize: '13px',
          color: '#fff',
          textAlign: 'right'
        }
      }, v ? metric === 'cout' ? fmtDH(v) : fmtJH(v) : '—');
    }), React.createElement('td', {
      style: {
        padding: '8px 10px',
        fontWeight: 700,
        fontSize: '13px',
        color: '#fff',
        textAlign: 'right'
      }
    }, metric === 'cout' ? fmtDH(grandTotals.total.cout) : fmtJH(grandTotals.total.jh)),
    // Suivi budgétaire du TOTAL : comparaison à PÉRIMÈTRE ÉGAL
    // (budgetScope), identique à la feuille Excel — les JH d'une
    // famille non budgétée ne consomment aucun budget.
    showBudget && budgetScope ? budgetTds({
      budget: budgetScope.budget,
      jh: budgetScope.jh,
      jhTotal: grandTotals.total.jh,
      base: {
        padding: '8px 10px',
        fontWeight: 700,
        fontSize: '13px',
        color: '#fff',
        textAlign: 'right'
      },
      keyPrefix: 'total-general'
    }) : null))),
    // Mention de périmètre — MÊME libellé que sous le tableau Excel.
    showBudget && budgetScope && budgetScope.nFamilles > 0 ? React.createElement('div', {
      style: {
        marginTop: '8px',
        fontSize: '11px',
        color: C.textSec,
        fontStyle: 'italic'
      }
    }, CEU.scopeNote(budgetScope.nBudgetees, budgetScope.nFamilles, 'familles budgétées')) : null));
  }

  /* ------------------------------------------------------------------ */
  /* Sous-composant : Vue Pivot analytique (grille partagée)              */
  /* ------------------------------------------------------------------ */

  /**
   * Termes {num, den} du « % consommé » ANNUEL d'une cellule de la grille.
   * PURE. Mêmes garde-fous que CampagneBudgetQuinzaine.pctPartsCellule, sur les
   * champs de la vue annuelle : réalisé cumulé (`jh`, un TOTAL) sur budget
   * (`budget`, saisi en JH/Ha → × Ha pour redevenir un total).
   *
   * `null` = taux sans objet (aucun budget saisi, superficie inconnue) : la
   * cellule affiche « — », JAMAIS 0 % — qui se lirait « rien de consommé ».
   *
   * Sert de `ratio.parts` : la grille somme séparément numérateur et
   * dénominateur avant de diviser. Une série ordinaire afficherait une SOMME DE
   * POURCENTAGES en total de ligne et en pied de colonne.
   *
   * @param {{jh?: number, budget?: number, ha?: number}|null|undefined} cell
   * @returns {{num: number, den: number}|null}
   */
  function CAT_pctPartsAnnuel(cell) {
    if (!cell) return null;
    var budget = Number(cell.budget);
    if (!isFinite(budget) || !(budget > 0)) return null;
    var ha = Number(cell.ha);
    if (!isFinite(ha) || !(ha > 0)) return null;
    var jh = Number(cell.jh);
    return {
      num: isFinite(jh) ? jh : 0,
      den: budget * ha
    };
  }

  /**
   * Sépare les lignes du pivot en DEUX jeux : la Récolte d'un côté, tout le
   * reste de l'autre. PURE (aucune ligne recopiée ni mutée : on ne fait que
   * répartir les références).
   *
   * Pourquoi sortir la Récolte du tableau : son budget (1 800 JH/Ha sur
   * certaines parcelles) est consommé à 0 % tant que la saison n'a pas
   * commencé. Laissé dans la même grille, il écrase le TOTAL — « 14.7 %
   * consommé » sur une campagne dont l'effort hors récolte est déjà à 60 %. Une
   * fois la Récolte sortie, le TOTAL du tableau principal EST le total hors
   * récolte, sans ligne supplémentaire à calculer.
   *
   * Le découpage suit l'ordre de lecture : un bandeau `type: 'groupe'` ouvre
   * une section, les lignes qui suivent lui appartiennent jusqu'au bandeau
   * suivant. Une ligne orpheline (aucun bandeau avant elle) reste dans le jeu
   * principal — jamais silencieusement perdue.
   *
   * @param {Array<Object>} rows lignes du pivot, dans l'ordre.
   * @param {string} groupeRecolte nom du groupe Récolte (référentiel).
   * @returns {{principal: Array<Object>, recolte: Array<Object>}}
   */
  function CAT_partitionRecolte(rows, groupeRecolte) {
    var principal = [];
    var recolte = [];
    var cible = principal;
    (rows || []).forEach(function (r) {
      if (!r) return;
      if (r.type === 'groupe') cible = r.key === groupeRecolte ? recolte : principal;
      cible.push(r);
    });
    return {
      principal: principal,
      recolte: recolte
    };
  }

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
      cursor: 'pointer'
    };
  }

  /** Groupe de bascules `[[valeur, libellé], …]`. */
  function CAT_pills(options, current, onPick, keyPrefix) {
    return options.map(function (opt) {
      return React.createElement('button', {
        key: keyPrefix + opt[0],
        onClick: function () {
          onPick(opt[0]);
        },
        style: CAT_pillStyle(current === opt[0])
      }, opt[1]);
    });
  }

  /**
   * Pop-up de détail d'une cellule de la grille : opérations fines de la
   * famille sur la parcelle.
   *
   * La colonne s'appelle « Présences » et NON « Ouvriers » (comme sur l'écran
   * Quinzaine) : `campagne-analytique-detail` agrège jour par jour, donc
   * `nbOuv` compte les ouvriers distincts D'UNE JOURNÉE. Additionné sur toute
   * la campagne, il vaut un cumul de présences — un ouvrier venu 10 jours pèse
   * 10. Le lire « Ouvriers » ferait croire à un effectif.
   */
  function CAT_DetailPopup(props) {
    var cell = props.cell;
    var onClose = props.onClose;
    var ha = cell.ha || 0;
    var byOp = {};
    (cell.detailRows || []).forEach(function (r) {
      var k = r.operation || '—';
      if (!byOp[k]) byOp[k] = {
        operation: k,
        jh: 0,
        cout: 0,
        nbOuv: 0
      };
      byOp[k].jh += r.jh || 0;
      byOp[k].cout += r.cout || 0;
      byOp[k].nbOuv += r.nbOuv || 0;
    });
    var opRows = Object.keys(byOp).map(function (k) {
      return byOp[k];
    }).sort(function (a, b) {
      return b.jh - a.jh;
    });
    var totals = opRows.reduce(function (t, r) {
      t.jh += r.jh;
      t.cout += r.cout;
      t.nbOuv += r.nbOuv;
      return t;
    }, {
      jh: 0,
      cout: 0,
      nbOuv: 0
    });
    function perHa(v) {
      return ha > 0 ? (Math.round(v / ha * 10) / 10).toLocaleString('fr-MA') : '—';
    }
    function jhTxt(v) {
      return (Math.round(v * 10) / 10).toFixed(1);
    }
    function dhTxt(v) {
      return Math.round(v).toLocaleString('fr-MA');
    }
    var th = {
      padding: '6px 10px',
      textAlign: 'right',
      fontSize: '11px',
      color: C.textSec,
      borderBottom: '1px solid ' + C.border
    };
    var thL = Object.assign({}, th, {
      textAlign: 'left'
    });
    var td = {
      padding: '6px 10px',
      textAlign: 'right',
      fontSize: '12px'
    };
    var tdL = Object.assign({}, td, {
      textAlign: 'left',
      fontWeight: 500
    });
    var tdT = Object.assign({}, td, {
      fontWeight: 700
    });
    return React.createElement('div', {
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 10001,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      },
      onClick: onClose
    }, React.createElement('div', {
      style: {
        background: '#fff',
        borderRadius: '16px',
        maxWidth: '680px',
        width: '100%',
        maxHeight: '80vh',
        overflow: 'auto',
        boxShadow: '0 24px 64px rgba(0,0,0,0.35)'
      },
      onClick: function (e) {
        e.stopPropagation();
      }
    }, React.createElement('div', {
      style: {
        padding: '16px 20px',
        background: C.berry,
        borderRadius: '16px 16px 0 0',
        color: '#fff',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }
    }, React.createElement('div', null, React.createElement('div', {
      style: {
        fontSize: '15px',
        fontWeight: 700
      }
    }, cell.parcelleLabel || cell.parcelle), React.createElement('div', {
      style: {
        fontSize: '11px',
        opacity: 0.85,
        marginTop: '2px'
      }
    }, (cell.operationFamille || '') + ' · ' + (ha > 0 ? fmtHaLabel(ha) : 'Ha inconnu'))), React.createElement('button', {
      onClick: onClose,
      style: {
        background: 'rgba(255,255,255,0.2)',
        border: 'none',
        color: '#fff',
        fontSize: '16px',
        cursor: 'pointer',
        borderRadius: '8px',
        width: '32px',
        height: '32px'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-xmark'
    }))), React.createElement('div', {
      style: {
        padding: '16px 20px'
      }
    }, React.createElement('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse'
      }
    }, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', {
      style: thL
    }, 'Opération'), React.createElement('th', {
      style: th,
      title: 'Cumul des présences sur la campagne : un ouvrier présent 10 jours compte 10. Ce n\'est pas un effectif.'
    }, 'Présences'), React.createElement('th', {
      style: th
    }, 'JH'), React.createElement('th', {
      style: th
    }, 'JH / Ha'), React.createElement('th', {
      style: th
    }, 'Coût (DH)'), React.createElement('th', {
      style: th
    }, 'DH / Ha'))), React.createElement('tbody', null, opRows.map(function (r, i) {
      return React.createElement('tr', {
        key: i,
        style: {
          background: i % 2 === 0 ? C.surface : C.surface2
        }
      }, React.createElement('td', {
        style: tdL
      }, r.operation), React.createElement('td', {
        style: td
      }, r.nbOuv), React.createElement('td', {
        style: td
      }, jhTxt(r.jh)), React.createElement('td', {
        style: td
      }, perHa(r.jh)), React.createElement('td', {
        style: td
      }, dhTxt(r.cout)), React.createElement('td', {
        style: td
      }, ha > 0 ? dhTxt(r.cout / ha) : '—'));
    })), React.createElement('tfoot', null, React.createElement('tr', {
      style: {
        background: C.surface3
      }
    }, React.createElement('td', {
      style: Object.assign({}, tdT, {
        textAlign: 'left'
      })
    }, 'TOTAL'), React.createElement('td', {
      style: tdT
    }, totals.nbOuv), React.createElement('td', {
      style: tdT
    }, jhTxt(totals.jh)), React.createElement('td', {
      style: tdT
    }, perHa(totals.jh)), React.createElement('td', {
      style: tdT
    }, dhTxt(totals.cout)), React.createElement('td', {
      style: tdT
    }, ha > 0 ? dhTxt(totals.cout / ha) : '—')))))));
  }

  /**
   * Vue « Pivot analytique » : la MÊME grille que l'écran Quinzaine
   * (window.PivotAnalytiqueGrid), alimentée par les lignes de la campagne.
   * Lignes = groupe M.O → famille (code GB) → opération, colonnes = parcelles
   * avec leur Ha, une grille par culture.
   *
   * Cette vue ne calcule RIEN elle-même : le pivot vient de
   * AnalytiqueUtils.buildAnalytiquePivotByFamille (lib partagée, inchangée), la
   * superposition du budget de CampagneBudgetPivot.buildBudgetPivot (qui
   * applique la règle métier `familleTotal`), et la présentation de
   * PivotAnalytiqueGrid. Elle ne fait que mapper les champs (CAT_pivotRows) et
   * traduire ses bascules en séries `metrics`.
   *
   * Bascules : JH ↔ Coût DH (état partagé avec les autres vues MO, prop
   * `metric`), Ha ↔ Total et Récap ↔ Détail (locaux à la vue).
   *
   * ── BUDGET ET % CONSOMMÉ ──────────────────────────────────────────────────
   * Deux SOUS-COLONNES s'ajoutent au réalisé sous chaque parcelle (Budget et
   * % consommé), seulement quand :
   *   - la métrique est JH : le budget est saisi en JH/Ha, il n'a aucune
   *     traduction en DH — afficher un « budget » sous un coût serait faux ;
   *   - la culture affichée porte au moins un budget : sinon la grille se
   *     remplirait de deux lignes de « — » (état nominal de l'avocatier).
   * Le budget est en JH/Ha (`basis: 'perHa'`), le réalisé en JH total
   * (`basis: 'total'`) : la conversion est portée PAR SÉRIE par la grille, elle
   * n'est jamais faite ici — et ses agrégats reconvertissent en total avant de
   * sommer (sommer des JH/Ha entre parcelles n'aurait aucun sens).
   */
  function PivotView(props) {
    var data = props.data || {};
    var sbMap = props.sbMap || {};
    var metric = props.metric; // 'cout' | 'jh'
    var setMetric = props.setMetric;
    var _totalMode = useState(false);
    var totalMode = _totalMode[0];
    var setTotalMode = _totalMode[1];
    var _detailMode = useState(false);
    var detailMode = _detailMode[0];
    var setDetailMode = _detailMode[1];
    var _detailCell = useState(null);
    var detailCell = _detailCell[0];
    var setDetailCell = _detailCell[1];

    // États de la VUE QUINZAINE — ajoutés APRÈS les précédents à dessein :
    // l'ordre des useState est l'index de state de React, le décaler renumérote
    // tout (et casse le harnais de test qui injecte les états par position).
    var _vueQuinzaine = useState(false);
    var vueQuinzaine = _vueQuinzaine[0];
    var setVueQuinzaine = _vueQuinzaine[1];
    // '' = suivre la quinzaine EN COURS (défaut). Une valeur explicite = l'
    // utilisateur consulte/corrige une quinzaine passée, et ce choix ne doit pas
    // sauter au prochain rendu.
    var _quinzaineSel = useState('');
    var quinzaineSel = _quinzaineSel[0];
    var setQuinzaineSel = _quinzaineSel[1];

    // ── PLEIN ÉCRAN ────────────────────────────────────────────────────────
    // Ajoutés EN DERNIER, pour la même raison que les deux précédents : l'ordre
    // des useState est l'index de state de React, et le harnais de test injecte
    // les états par position.
    //
    // ⚠️ État LOCAL, contrairement à AffectationAnalytiqueTable dont TOUT
    // l'état vit chez QuinzaineTab : là-bas l'early-return `if (loading)` du
    // parent démonte le panneau à chaque changement de quinzaine, et un plein
    // écran qui se referme tout seul serait un bug. Ici le parent
    // (CampagneAnalytiqueTab) ne repasse plus par ses early-returns une fois
    // les données chargées — `setLoading(true)` n'est appelé que dans l'effet
    // de MONTAGE, et aucun changement de filtre/bascule ne le rejoue. PivotView
    // n'est donc démonté que par une vraie navigation (changement de
    // sous-onglet ou de vue), où repartir hors plein écran est attendu.
    var _fullscreen = useState(false);
    var fullscreen = _fullscreen[0];
    var setFullscreen = _fullscreen[1];
    // Index de la culture affichée EN PLEIN ÉCRAN (le carrousel ‹ › ).
    var _cultureIdx = useState(0);
    var cultureIdx = _cultureIdx[0];
    var setCultureIdx = _cultureIdx[1];

    // Sortie au clavier + gel du défilement de la page derrière l'overlay :
    // même mécanisme que l'écran Quinzaine (où il vit chez QuinzaineTab, parce
    // que le panneau y est démonté trop souvent pour le porter).
    useEffect(function () {
      if (typeof document === 'undefined' || !document.body) return undefined;
      if (!fullscreen) return undefined;
      var onKey = function (e) {
        if (e.key === 'Escape') setFullscreen(false);
      };
      document.addEventListener('keydown', onKey);
      var prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return function () {
        document.removeEventListener('keydown', onKey);
        document.body.style.overflow = prev;
      };
    }, [fullscreen]);
    var Grid = window.PivotAnalytiqueGrid;
    var AU = window.AnalytiqueUtils;
    // Nom du groupe Récolte pris dans le RÉFÉRENTIEL (jamais une chaîne
    // réécrite à la main) : c'est lui qui décide quelles lignes sortent du
    // tableau principal. Repli sur le libellé connu si le module est absent.
    var GROUPE_RECOLTE = AU && AU.GB_GROUPE_MAP && AU.GB_GROUPE_MAP.GB08 || 'M.O Récolte';
    var CR = window.CampagneRythme;
    var CBQ = window.CampagneBudgetQuinzaine;

    // Avancement de la campagne, lu sur la MÊME réponse que le réalisé affiché
    // (`periodes` + `campagne` de campagne-analytique-detail) : les quinzaines
    // restantes ne peuvent donc pas diverger des quinzaines réalisées.
    var quinzaines = useMemo(function () {
      if (!CR) return null;
      return CR.quinzainesInfo({
        periodes: data.periodes,
        campagne: data.campagne
      });
    }, [CR, data.periodes, data.campagne]);

    // BUDGET IDÉAL — part de la campagne écoulée à ce jour (repère de rythme
    // LINÉAIRE, à comparer au % consommé). Calculée sur la campagne AFFICHÉE,
    // pas sur la date du jour seule : consulter une campagne passée doit donner
    // 100 %, pas la position du calendrier dans la campagne en cours.
    // `null` = indéterminable (campagne illisible, module absent) → la
    // sous-colonne n'est pas proposée du tout, jamais un 0 % trompeur.
    var partIdeale = useMemo(function () {
      if (!CR || typeof CR.partEcoulee !== 'function') return null;
      return CR.partEcoulee({
        campagne: data.campagne,
        utils: window.CampagneUtils
      });
    }, [CR, data.campagne]);

    // NB : les classes de rythme (CR.indexClasses) ne sont plus indexées ici —
    // les séries « reste budgété » / « reste au rythme » ont quitté la grille
    // (cf. metricsBudget). `public/lib/campagneRythme.js` reste chargé et
    // utilisé pour l'avancement de la campagne ci-dessus.

    var groups = useMemo(function () {
      var rows = CAT_pivotRows(data.rows, sbMap, data.haByRef || {}, {
        farmFilter: props.farmFilter,
        cultureFilter: props.cultureFilter
      });
      return CAT_byCulture(rows, sbMap);
    }, [data, sbMap, props.farmFilter, props.cultureFilter]);
    var isJh = metric === 'jh';
    var uniteJh = totalMode ? 'JH' : 'JH/Ha';
    var fmtJh1 = function (v) {
      return (Math.round(v * 10) / 10).toFixed(1);
    };

    // Quinzaines de la campagne, DÉRIVÉES des mêmes `periodes` que le réalisé
    // (jamais un calendrier local, jamais un « 24 » en dur).
    var quinzaineOptions = useMemo(function () {
      if (!CBQ) return [];
      return CBQ.optionsFromPeriodes(data.periodes);
    }, [CBQ, data.periodes]);

    // Quinzaine EN COURS = dernière vue dans les `periodes` (celle qu'on est en
    // train de pointer). C'est le défaut du sélecteur.
    var quinzaineCourante = CBQ && quinzaines ? CBQ.quinzaineCourante(quinzaines) : '';
    // Un choix explicite disparu des options (rechargement, changement de
    // campagne) retombe sur la quinzaine en cours plutôt que d'afficher une vue
    // vide sans explication.
    var quinzaineActive = quinzaineSel && quinzaineOptions.some(function (o) {
      return o.key === quinzaineSel;
    }) ? quinzaineSel : quinzaineCourante;
    var quinzaineInfoSel = null;
    quinzaineOptions.forEach(function (o) {
      if (o.key === quinzaineActive) quinzaineInfoSel = o;
    });
    var quinzainesByLabel = props.quinzainesByLabel || {};
    // Y a-t-il un engagement saisi, quelque part, sur la quinzaine affichée ?
    // Sinon la bascule ne mènerait qu'à des « — » : on ne la propose pas.
    var hasQuinzaineBudget = !!(CBQ && quinzaineActive && Object.keys(CBQ.trancheQuinzaine(quinzainesByLabel, quinzaineActive)).some(function (l) {
      return Object.keys(CBQ.trancheQuinzaine(quinzainesByLabel, quinzaineActive)[l] || {}).length > 0;
    }));
    // La vue quinzaine n'a de sens qu'en JH (un engagement est saisi en JH/Ha,
    // il n'a aucune traduction en DH) et seulement s'il y a un engagement.
    var quinzaineDispo = !!(CBQ && Grid && isJh && hasQuinzaineBudget);
    var enQuinzaine = vueQuinzaine && quinzaineDispo;
    var coutJour = props.coutOuvrier && Number(props.coutOuvrier.coutMoyenJour) > 0 ? Number(props.coutOuvrier.coutMoyenJour) : null;
    /**
     * FACTEUR DE CHARGE — ce que coûte réellement un dirham de salaire de base.
     *
     * Le réalisé de la grille vient du `Cout` BEE ONE : une base NUE, sans
     * primes ni charges. Le budget, lui, est valorisé au coût CHARGÉ. Comparer
     * les deux tels quels sous-estimait le « % consommé » d'un quart : sur
     * MARAVILLA MD, 44,5 % en DH contre 59,2 % en JH pour le même effort et le
     * même budget. Majorer le réalisé du même facteur remet les deux côtés dans
     * la même unité — et le taux en DH redevient celui en JH.
     *
     * La variation entre parcelles est préservée : c'est le `Cout` réel de
     * chaque cellule qui est majoré, pas une moyenne qui l'écraserait.
     */
    /**
     * Le COÛT RÉALISÉ d'une cellule se calcule depuis ses JOURNÉES, jamais
     * depuis le `Cout` de BEE ONE.
     *
     * « BEE ONE ne doit donner que les jours de pointage, le calcul de la paie
     * est erroné dessus » (Omar, 2026-08-20). Majorer ce coût d'un facteur ne
     * suffisait pas : cela propageait une base fausse, simplement mise à
     * l'échelle. On valorise donc les JH — la seule donnée fiable de BEE ONE —
     * au coût ouvrier chargé calculé par Smart Berry.
     *
     * Effet secondaire recherché : le « % consommé » en dirhams devient
     * IDENTIQUE à celui en JH, puisque les deux côtés sont le même volume
     * multiplié par la même constante. Deux vues du même écran ne peuvent plus
     * se contredire.
     */
    // COÛT CHARGÉ — lu tel quel dans la cellule. Le backend l'a calculé au taux
    // de CHAQUE ouvrier (Σ JH × taux(ouvrier, quinzaine)).
    //
    // Il valait auparavant `JH × coutMoyenJour`, une moyenne d'établissement
    // appliquée à tout le monde : deux parcelles travaillées par des équipes de
    // coûts différents ressortaient au même prix, ce qu'un écran de coût par
    // parcelle est précisément censé distinguer.
    //
    // `null` quand la cellule n'a aucun coût chargé mais des JH : le taux de ces
    // ouvriers est inconnu (absents du registre de paie). On affiche « — »,
    // jamais le `Cout` BEE ONE — qui ferait passer un coût nu pour un coût
    // chargé, et jamais 0, qui se lirait « gratuit ».
    var coutCharge = function (cell) {
      if (!cell) return null;
      var c = Number(cell.coutCharge);
      if (isFinite(c) && c > 0) return c;
      return Number(cell.jh) > 0 ? null : 0;
    };
    var metrics = [{
      key: isJh ? 'jh' : 'cout',
      // En Coût DH, le réalisé est le coût CHARGÉ calculé par ouvrier. Plus
      // aucun repli sur le `Cout` BEE ONE : il n'est pas un coût, et l'afficher
      // sous ce libellé était la dernière façon d'en voir dans cet écran.
      get: isJh ? undefined : coutCharge,
      label: isJh ? 'Réalisé' : 'Coût chargé',
      unit: isJh ? uniteJh : totalMode ? 'DH' : 'DH/Ha',
      // Le pivot stocke des TOTAUX par cellule ; seul `display` bouge avec la
      // bascule Ha/Total. Le budget, lui, est déjà en JH/Ha (`basis: 'perHa'`)
      // — d'où le sens de conversion porté par série.
      basis: 'total',
      display: totalMode ? 'total' : 'perHa',
      format: isJh ? fmtJh1 : function (v) {
        return Math.round(v).toLocaleString('fr-MA');
      },
      summary: isJh ? function (t) {
        return Math.round(t).toLocaleString('fr-MA') + ' JH total';
      } : function (t) {
        return Math.round(t).toLocaleString('fr-MA') + ' DH';
      }
    }];

    /**
     * Format d'un POURCENTAGE consommé.
     *
     * Le suffixe « % » et l'italique sont portés par la VALEUR, jamais par
     * `unit` : entre deux colonnes de JH, un « 51.6 » nu se lit comme un
     * troisième volume. Passer par `unit` les afficherait bien dans les
     * sous-colonnes, mais donnerait « % consommé % » dans la colonne Total
     * (seule colonne où la grille accole le libellé de série à son unité) et
     * ne toucherait ni le pied de tableau ni le grand total.
     * Ici, la grille applique `format` à TOUS les rendus du taux (cellule,
     * total de ligne, total de colonne, grand total) : un seul endroit à
     * changer, quatre emplacements couverts.
     *
     * Au-delà de 100 %, le budget est dépassé : signalé en rouge, JAMAIS
     * plafonné — un taux ramené à 100 % masquerait ce qu'on vient lire.
     */
    function fmtPct(v) {
      var pct = Math.round(v * 1000) / 10;
      var style = {
        fontStyle: 'italic'
      };
      if (pct > 100) style.color = C.berry;
      return React.createElement('span', {
        style: style
      }, pct.toFixed(1) + ' %');
    }

    // Coût CHARGÉ d'une journée d'ouvrier, servi par l'action backend
    // `campagne-cout-ouvrier` (brut + CNSS patronale des déclarés + transport,
    // moyenné sur la campagne). `null` = indisponible : le budget en DH n'est
    // alors pas proposé du tout — surtout pas un budget nul, qui afficherait un
    // dépassement infini sur chaque ligne.
    /**
     * Le BUDGET est saisi en JH/Ha. En Coût DH, on le valorise au coût chargé
     * d'une journée : `budget DH/Ha = budget JH/Ha × coût ouvrier DH/jour`.
     *
     * Cette conversion est portée par la SÉRIE (via `get`), et pas par une
     * transformation des cellules : la grille applique ensuite ses propres
     * règles `basis`/`display` (× Ha en mode Total), et le « % consommé »
     * réutilise le même chemin. Convertir les cellules en amont obligerait à
     * refaire ces deux règles à la main, et à les maintenir en double.
     */
    function budgetDhCell(cell) {
      if (!cell || coutJour === null) return null;
      var b = Number(cell.budget);
      return isFinite(b) && b > 0 ? b * coutJour : null;
    }

    /**
     * Termes du « % consommé » en dirhams : coût réalisé / budget valorisé.
     * Même forme que `CAT_pctPartsAnnuel` (série RATIO, cf. plus haut) — les
     * deux termes en quantité TOTALE, jamais un pourcentage sommé.
     */
    function pctPartsDh(cell) {
      if (!cell || coutJour === null) return null;
      // Réalisé et budget sont le MÊME volume de JH multiplié par la MÊME
      // constante : le taux se simplifie en celui des JH. On le calcule donc
      // par le même chemin, plutôt que d'écrire une seconde formule qui
      // pourrait en diverger à l'arrondi près.
      return CAT_pctPartsAnnuel(cell);
    }
    var fmtDh0 = function (v) {
      return Math.round(v).toLocaleString('fr-MA');
    };

    // Séries Budget + % consommé — sur une culture budgétée (cf. en-tête), en JH
    // comme en Coût DH (le budget y est valorisé au coût ouvrier chargé).
    //
    // ⚠️ TROIS SOUS-COLONNES, PAS CINQ. « Reste budgété » et « reste au rythme »
    // (LOT 3a) ont QUITTÉ la grille : avec 9 parcelles, cinq séries font 45
    // colonnes, illisibles même en défilant. Le module de calcul
    // (public/lib/campagneRythme.js) et le champ `classe_rythme` en base sont
    // CONSERVÉS tels quels — seul leur affichage ici est retiré, leur sort est
    // une décision séparée. `CampagneRythme` reste d'ailleurs utilisé plus haut
    // pour l'avancement de la campagne (quinzainesInfo).
    var metricsBudget = metrics.concat([isJh ? {
      key: 'budget',
      label: 'Budget',
      unit: uniteJh,
      basis: 'perHa',
      display: totalMode ? 'total' : 'perHa',
      format: fmtJh1
    } : {
      // Budget VALORISÉ : la même série, exprimée au coût chargé du jour.
      get: budgetDhCell,
      label: 'Budget',
      unit: totalMode ? 'DH' : 'DH/Ha',
      basis: 'perHa',
      display: totalMode ? 'total' : 'perHa',
      format: fmtDh0
    }, {
      label: '% consommé',
      // Pas d'`unit` : le « % » est dans la valeur (cf. fmtPct). Le remettre
      // ici donnerait « % consommé % » dans la colonne Total.
      // Série RATIO : réalisé cumulé / budget, sommés séparément avant
      // division (cf. PivotAnalytiqueGrid, section « ratio »). `basis` et
      // `display` ne s'y appliquent pas : un taux est invariant par
      // changement d'unité, la bascule Ha/Total ne le touche pas.
      ratio: {
        parts: isJh ? CAT_pctPartsAnnuel : pctPartsDh
      },
      format: fmtPct
    }]);

    /**
     * VUE QUINZAINE — les MÊMES trois sous-colonnes que la vue annuelle, mais
     * sur le périmètre d'une seule quinzaine : réalisé, engagé, % consommé.
     *
     * ── POURQUOI UNE BASCULE ET NON TROIS SOUS-COLONNES DE PLUS ───────────────
     * Six sous-colonnes par parcelle (18 colonnes pour 3 parcelles, 54 pour 9)
     * ne se lisent pas, et se lisent encore moins au téléphone (c'est là que la
     * validation se fait). Mais la raison n'est pas que cosmétique : les deux
     * vues répondent à DEUX
     * questions différentes, et leurs chiffres ne se comparent pas.
     *   - annuelle  : « où en est la campagne, va-t-on tenir le budget ? »
     *     (cumul depuis juillet, projection jusqu'en juin) ;
     *   - quinzaine : « ce que j'ai engagé il y a 15 jours, l'ai-je consommé ? »
     *     (une seule période, aucun lien de somme avec l'annuel).
     * Les afficher ensemble inviterait à comparer un chiffre de quinzaine à un
     * cumul annuel — l'erreur de lecture qu'on ne pourrait plus rattraper.
     * La bascule garde chaque vue à trois sous-colonnes et rend le périmètre
     * explicite dans la légende.
     */
    var metricsQuinzaine = [{
      key: 'jhQuinzaine',
      label: 'Réalisé quinz.',
      unit: uniteJh,
      basis: 'total',
      display: totalMode ? 'total' : 'perHa',
      format: fmtJh1,
      summary: function (t) {
        return Math.round(t).toLocaleString('fr-MA') + ' JH sur la quinzaine';
      }
    }, {
      key: 'budgetQuinzaine',
      label: 'Engagé quinz.',
      unit: uniteJh,
      basis: 'perHa',
      display: totalMode ? 'total' : 'perHa',
      format: fmtJh1
    }, {
      label: '% consommé',
      // Pas d'`unit` : le « % » est dans la valeur (cf. fmtPct). Le remettre
      // ici donnerait « % consommé % » dans la colonne Total.
      // Série RATIO : les totaux somment numérateur et dénominateur puis
      // divisent. Une série ordinaire afficherait une SOMME de pourcentages
      // en pied de colonne (cf. PivotAnalytiqueGrid, section « ratio »).
      ratio: {
        parts: CBQ ? CBQ.pctPartsCellule : function () {
          return null;
        }
      },
      format: fmtPct
    }];

    // Périmètre de la vue annuelle : non déductible des chiffres affichés.
    // Le RÉALISÉ et le BUDGET ne sont plus valorisés de la même façon — et le
    // dire est indispensable : le « % consommé » n'est donc plus identique à
    // celui affiché en JH, contrairement à ce que cette note promettait.
    var noteCoutCharge = isJh ? '' : ' Coût CHARGÉ : chaque journée pointée est valorisée au coût de ' + 'L\'OUVRIER qui l\'a faite (salaire Smart Berry, primes et charges ' + 'comprises) — une parcelle travaillée par une équipe chère coûte donc ' + 'plus qu\'une autre à JH égal.' + (coutJour === null ? '' : ' Le BUDGET, lui, n\'a pas d\'ouvrier : il est converti au coût moyen ' + 'de la campagne (' + fmtDh0(coutJour) + ' DH/JH).') + ' Le « % consommé » reste calculé sur les JOURNÉES, pas sur les dirhams : ' + 'il est donc identique à celui affiché en JH.' + ' BEE ONE ne fournit que les journées : son calcul de paie n\'est pas repris.';
    var noteBudgetSeul = 'Budget : périmètre budgété uniquement (les familles et ' + 'parcelles sans budget saisi en sont exclues, mais restent comptées dans ' + 'le Réalisé). « % consommé » = Réalisé / Budget sur ce seul périmètre. ' + '« — » = aucun budget saisi, ou superficie inconnue.' + noteCoutCharge;

    // Garde anti-crash : une référence à un global absent fait planter TOUT le
    // rendu React (mémoire projet « tab bare global ref »).
    //
    // CultureUtils est dans la MÊME garde que la grille et le pivot, et pas
    // seulement pour éviter un crash : sans lui, aucune parcelle n'est
    // rattachable à sa culture. Afficher quand même la grille produirait des
    // tableaux dont le titre ment sur leur contenu — un écran faux est pire
    // qu'un écran absent, personne ne peut le détecter à la lecture.
    var CU = window.CultureUtils;
    if (!Grid || !AU || typeof AU.buildAnalytiquePivotByFamille !== 'function' || !CU || typeof CU.resolveCulture !== 'function') {
      return React.createElement('div', {
        style: {
          padding: '40px',
          textAlign: 'center',
          color: '#c0392b',
          fontSize: '14px'
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-triangle-exclamation',
        style: {
          marginRight: '8px'
        }
      }), 'Affectation par Ha indisponible : un module de calcul n\'a pas été chargé ' + '(grille, pivot analytique ou référentiel des cultures). Rechargez la page.');
    }

    // ── PLEIN ÉCRAN : quelles grilles sont rendues ? ────────────────────────
    // Une seule à la fois — c'est tout l'intérêt : la grille éclatée en
    // sous-colonnes a besoin de toute la largeur ET de toute la hauteur. Le
    // carrousel ‹ › remplace le défilement entre cultures.
    // Un index devenu hors bornes (filtre culture changé pendant le plein
    // écran) retombe sur la première grille plutôt que sur un écran blanc.
    var idxCulture = cultureIdx >= 0 && cultureIdx < groups.length ? cultureIdx : 0;
    var enPlein = !!fullscreen && groups.length > 0;
    var groupesAffiches = enPlein ? [groups[idxCulture]] : groups;

    // ── BUDGET IDÉAL : UN REPÈRE DE PAGE, PAS UNE COLONNE ──────────────────
    // La part de campagne écoulée est la MÊME valeur dans toutes les cellules :
    // en faire une sous-colonne coûtait une colonne par parcelle pour répéter
    // un seul chiffre. Elle est donc affichée une fois, en haut à droite, où
    // elle se lit comme ce qu'elle est — la position du CALENDRIER, à comparer
    // de tête au « % consommé » de n'importe quelle ligne.
    // Garde anti-crash sur `CR` : une référence à un global absent fait planter
    // TOUT le rendu React (mémoire projet « tab bare global ref »).
    var joursIdeal = CR && typeof CR.joursEcoules === 'function' ? CR.joursEcoules({
      campagne: data.campagne,
      utils: window.CampagneUtils
    }) : null;
    // `null` = indéterminable (campagne illisible, module absent) : on n'affiche
    // RIEN plutôt qu'un 0 % qui se lirait « campagne pas commencée ».
    /**
     * Repère « COÛT OUVRIER — DH / jour », à côté du budget idéal.
     *
     * C'est le CHIFFRE QUI VALORISE la grille en Coût DH : sans lui, aucun
     * budget en dirhams. L'afficher, c'est permettre de le contester — d'où le
     * détail complet en infobulle (brut, charges patronales, transport, nombre
     * de journées et d'ouvriers), et non un nombre tombé du ciel.
     *
     * Absent tant que le calcul n'a pas répondu, ou qu'aucune journée n'est
     * pointée : « pas de donnée » n'est pas « coût nul ».
     */
    var repereCout = coutJour === null ? null : function () {
      var d = props.coutOuvrier || {};
      var det = d.detail || {};
      var part = typeof d.partDeclares === 'number' ? Math.round(d.partDeclares * 100) + ' % de journées déclarées' : null;
      // Le détail EST l'argument : un coût moyen sans sa décomposition ne se
      // conteste pas, il se croit. Chaque terme est nommé dans l'ordre de la
      // formule validée.
      var ligne = function (label, v) {
        return Number(v) > 0 ? '\n· ' + label + ' ' + fmtDh0(v) + ' DH' : '';
      };
      var aide = 'Coût CHARGÉ d\'une journée-homme (JH), moyenné sur la campagne ' + (d.campagne || '') + '.' + '\nSalaire soumis à cotisation (barème Smart Berry) :' + ligne('salaire de base', det.salaire) + ligne('prime de fonction', det.primeFonction) + ligne('ancienneté', det.primeAnciennete) + ligne('heures sup', det.heuresSup) + ligne('jours fériés', det.feries) + '\nCharges sociales (déclarés) :' + ligne('patronales', det.chargesPatronales)
      // Part salariale : l'ouvrier étant payé sur le brut SANS retenue, ce que
      // la loi prélèverait sur son salaire est versé par la société.
      + ligne('CNSS + AMO salariales', det.cotisationsSalariales) + '\nPrimes de terrain (hors assiette) :' + ligne('transport', det.transport) + ligne('récolte', det.recolte) + ligne('traitement', det.traitement) + ligne('conditionnement', det.conditionnement) + ligne('chargement', det.chargement) + '\n\n' + fmtDh0(d.jh || 0) + ' JH (au sens BEE ONE, `Nombre_Jr`) — ' + 'c\'est le dénominateur, celui qui valorise les budgets exprimés en JH.' + '\n' + fmtDh0(d.jours || 0) + ' journées calendaires pointées, sur ' + 'lesquelles se calcule le salaire (un ouvrier pointé trois fois le ' + 'même jour touche un jour).' + '\n' + (d.ouvriers || 0) + ' ouvriers, ' + (d.quinzaines || 0) + ' quinzaines' + (part ? ' · ' + part : '') + '\nHors pointage divers (sous-traitants).' + (Number(det.baseBeeOne) > 0 ? '\nTémoin : ' + fmtDh0(det.baseBeeOne) + ' DH de coût BEE ONE sur la ' + 'même période — BEE ONE ne fournit que les journées, le salaire ' + 'vient du barème Smart Berry.' : '');
      return React.createElement('div', {
        title: aide,
        style: {
          display: 'flex',
          alignItems: 'baseline',
          gap: '8px',
          padding: '5px 14px',
          borderRadius: '16px',
          border: '1.5px solid ' + C.border,
          background: C.surface
        }
      }, React.createElement('span', {
        style: {
          fontSize: '11px',
          color: C.textSec,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontWeight: 600
        }
      }, 'Coût ouvrier chargé'), React.createElement('span', {
        style: {
          fontSize: '15px',
          fontWeight: 700,
          color: C.berry
        }
      }, fmtDh0(coutJour) + ' DH'), React.createElement('span', {
        style: {
          fontSize: '10px',
          color: C.textSec
        }
      }, '/ JH'));
    }();
    var repereIdeal = partIdeale === null ? null : React.createElement('div', {
      title: joursIdeal === null ? 'Part de la campagne écoulée depuis le 1er juillet.' : joursIdeal + ' jours écoulés depuis le 1er juillet, sur 365. Repère de ' + 'rythme linéaire : à comparer au « % consommé » de chaque ligne.',
      style: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '8px',
        padding: '5px 14px',
        borderRadius: '16px',
        border: '1.5px solid ' + C.border,
        background: C.surface
      }
    }, React.createElement('span', {
      style: {
        fontSize: '11px',
        color: C.textSec,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        fontWeight: 600
      }
    }, '% Budget idéal à ce jour'), React.createElement('span', {
      style: {
        fontSize: '15px',
        fontWeight: 700,
        color: C.berry
      }
    }, (Math.round(partIdeale * 1000) / 10).toFixed(1) + ' %'), joursIdeal === null ? null : React.createElement('span', {
      style: {
        fontSize: '10px',
        color: C.textSec
      }
    }, joursIdeal + ' j / 365'));

    /**
     * 1er juillet de la campagne affichée, ou `null`. La frontière a UNE source
     * (`CampagneUtils`) ; le libellé servi par le backend porte un slash, d'où
     * la normalisation du séparateur avant de l'interroger.
     */
    function debutCampagneISO() {
      var CU2 = window.CampagneUtils;
      if (!CU2 || typeof CU2.debutCampagne !== 'function' || !data.campagne) return null;
      var m = /^(\d{4})\D+(\d{4})$/.exec(String(data.campagne).trim());
      return m ? CU2.debutCampagne(m[1] + '-' + m[2]) : null;
    }

    /**
     * Référentiel BLOC ID (celui du DQR), tel que l'écran Qualité le configure.
     * Absent ou illisible → liste vide : les kilos ne seront simplement pas
     * rattachés à une parcelle, jamais rattachés au hasard.
     */
    function blocIdsRef() {
      try {
        var s = window.localStorage && window.localStorage.getItem('blocIdsConfig');
        var v = s ? JSON.parse(s) : null;
        return Array.isArray(v) ? v : [];
      } catch (e) {
        return [];
      }
    }

    /**
     * Format d'un taux dont DÉPASSER LE BUDGET EST UNE BONNE NOUVELLE.
     *
     * Le « % consommé » d'un budget de JH vire au rouge au-delà de 100 % : on a
     * dépensé plus que prévu. La cadence de récolte, elle, se lit à l'envers —
     * 120 % du barème, c'est 120 % de la cadence attendue, donc une équipe qui
     * ramasse vite. Réutiliser `fmtPct` ici afficherait une alerte rouge sur la
     * meilleure nouvelle de l'écran.
     */
    /** Un montant en DH par kilo : deux décimales, comme un prix. */
    function fmtDh2(v) {
      return (Math.round(v * 100) / 100).toLocaleString('fr-MA', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }
    function fmtPctCadence(v) {
      var pct = Math.round(v * 1000) / 10;
      var style = {
        fontStyle: 'italic'
      };
      if (pct >= 100) style.color = '#2e7d32';
      return React.createElement('span', {
        style: style
      }, pct.toFixed(1) + ' %');
    }

    /**
     * Ligne de RENDEMENT en pied du bloc récolte, dans l'unité de la métrique
     * affichée : « Kg / JH » en JH (la cadence, barème 18 framboise / 30
     * myrtille), « DH / kg » en Coût DH (le coût au kilo, barème 7,50 / 4,50).
     *
     * Ce n'est ni une série ni une ligne famille : c'est un RAPPORT entre deux
     * grandeurs de nature différente (des kilos, des journées), qu'aucun total
     * de colonne ne doit sommer. D'où le passage par `piedsSupplementaires`,
     * avec des valeurs déjà formatées.
     *
     * PÉRIMÈTRE : les deux termes portent sur la CAMPAGNE affichée. Les kilos
     * d'un cycle divisés par les JH d'une campagne donneraient une cadence
     * fausse, et fausse dans le sens flatteur.
     *
     * Par parcelle, la valeur n'apparaît que si le bon porte sa parcelle (le
     * DQR porte le BLOC ID depuis cette campagne) ; sinon « — » et la cadence
     * est servie au niveau CULTURE, dans la colonne TOTAL — jamais un prorata
     * inventé sur les parcelles.
     */
    function lignesRendementRecolte(culture, rowsRecolte, parcellesGrille) {
      var CP = window.CampagneProduction;
      if (!CP || typeof CP.kgParParcelle !== 'function' || !props.bons) return [];
      var bareme = (CP.BAREME_KG_PAR_JH || {})[culture];
      if (!(bareme > 0)) return [];
      var debut = debutCampagneISO();
      if (!debut) return [];
      var cles = (parcellesGrille || []).map(function (p) {
        return p[0];
      });
      var kg = CP.kgParParcelle({
        bons: props.bons,
        blocIds: blocIdsRef(),
        cles: cles,
        debut: debut
      });
      // Total de la culture = somme des kilos RATTACHÉS à ses parcelles. Surtout
      // pas un total pris dans un autre référentiel (les blocs de production
      // portent encore le découpage de la campagne précédente) : la colonne
      // TOTAL doit être la somme des colonnes qu'elle coiffe, sinon elle les
      // contredit.
      var kgCulture = Object.keys(kg.parParcelle).reduce(function (s, c) {
        return s + kg.parParcelle[c];
      }, 0);
      var jhParParcelle = {};
      (rowsRecolte || []).forEach(function (row) {
        if (!row || row.type !== 'famille') return;
        Object.keys(row.pivot || {}).forEach(function (p) {
          var j = Number((row.pivot[p] || {}).jh);
          if (isFinite(j)) jhParParcelle[p] = (jhParParcelle[p] || 0) + j;
        });
      });
      var effort = CP.effortRecolte(rowsRecolte);
      var jhTotal = effort.jh;

      // ── EN COÛT DH, L'INDICATEUR N'EST PAS LE MÊME ────────────────────────
      // La cadence (kg/JH) répond à « à quelle vitesse récolte-t-on ? », le
      // coût au kilo à « combien nous coûte ce kilo ? ». Afficher une cadence
      // sous une colonne de dirhams n'aurait aucun sens, et le SENS DU TAUX
      // s'inverse avec elle : dépasser le barème de cadence est une bonne
      // nouvelle, dépasser le coût au kilo une mauvaise.
      if (!isJh) {
        var baremeDh = (CP.BAREME_DH_PAR_KG || {})[culture];
        if (!(baremeDh > 0)) return [];
        var coutParParcelle = {};
        (rowsRecolte || []).forEach(function (row) {
          if (!row || row.type !== 'famille') return;
          Object.keys(row.pivot || {}).forEach(function (p) {
            // Coût de récolte = JH de récolte × coût ouvrier chargé (cf. plus
            // haut : le `Cout` BEE ONE n'est pas une base de paie fiable).
            var j = Number((row.pivot[p] || {}).jh);
            if (isFinite(j)) coutParParcelle[p] = (coutParParcelle[p] || 0) + j * (coutJour || 0);
          });
        });
        // Le coût de récolte au kilo est lui aussi CHARGÉ : un DH/kg calculé sur
        // une base nue se comparerait à un barème qui, lui, couvre le coût réel.
        var coutRecolteCharge = effort.jh * (coutJour || 0);
        var trioDh = function (coutVal, kgVal) {
          // Pas de kilo rattaché → pas de coût au kilo. Un « 0 » y serait faux
          // dans les deux sens : ni gratuit, ni infiniment cher.
          if (!(kgVal > 0)) return [null, fmtDh2(baremeDh), null];
          var dhKg = coutVal / kgVal;
          return [fmtDh2(dhKg), fmtDh2(baremeDh), fmtPct(dhKg / baremeDh)];
        };
        var valeursDh = {};
        cles.forEach(function (c) {
          valeursDh[c] = trioDh(coutParParcelle[c] || 0, kg.parParcelle[c] || 0);
        });
        return [{
          key: 'dh-par-kg',
          label: 'DH / kg',
          aide: 'Coût de récolte au kilo sur la campagne, en regard du barème de ' + baremeDh + ' DH/kg pour la ' + culture.toLowerCase() + '. Au-delà de 100 %, le kilo coûte plus cher que prévu. Par parcelle,' + ' la valeur n\'apparaît que là où le bon d\'apport porte sa parcelle.',
          valeurs: valeursDh,
          total: trioDh(coutRecolteCharge, kgCulture)
        }];
      }
      function trio(kgVal, jhVal) {
        // Deux « — » distincts, et aucun 0.0 :
        //  - pas de JH de récolte → la cadence n'existe pas encore ;
        //  - pas de kilo RATTACHÉ à cette parcelle → on ne sait pas ce qu'elle
        //    a ramené, ce n'est pas la même chose que « elle n'a rien ramené ».
        //    Un 0.0 kg/JH accuserait une équipe d'un défaut de rattachement.
        if (!(jhVal > 0) || !(kgVal > 0)) return [null, fmtJh1(bareme), null];
        var cadence = kgVal / jhVal;
        return [fmtJh1(cadence), fmtJh1(bareme), fmtPctCadence(cadence / bareme)];
      }
      var valeurs = {};
      cles.forEach(function (c) {
        valeurs[c] = trio(kg.parParcelle[c] || 0, jhParParcelle[c] || 0);
      });
      return [{
        key: 'kg-par-jh',
        label: 'Kg / JH',
        aide: 'Cadence de récolte sur la campagne : kilos récoltés par journée-homme' + ' de récolte, en regard du barème de ' + bareme + ' kg/JH pour la ' + culture.toLowerCase() + '. Au-delà de 100 %, on récolte plus vite que' + ' prévu. Par parcelle, la cadence n\'apparaît que là où le bon d\'apport' + ' porte sa parcelle.',
        valeurs: valeurs,
        total: trio(kgCulture, jhTotal)
      }];
    }

    /**
     * PANNEAU DE RAPPROCHEMENT — écran Quinzaine ↔ écran Campagne.
     *
     * Deux chemins additionnent la même main d'œuvre : la grille agrège le
     * pointage PAR PARCELLE (une ligne dont la parcelle ou la culture ne se
     * résout pas n'y entre pas), le coût ouvrier part du pointage BRUT. Leur
     * écart mesure donc exactement ce que la grille NE VOIT PAS — un trou qui
     * ne se signale jamais tout seul, parce qu'un total plus petit reste un
     * total plausible.
     *
     * Affiché sous les grilles, toutes cultures confondues : c'est un contrôle
     * de couverture, pas une lecture par culture.
     */
    /**
     * Ventilation POSTE PAR POSTE du coût chargé, quinzaine par quinzaine.
     *
     * Le tableau principal dit COMBIEN manque ; celui-ci dit OÙ. Sans lui, un
     * poste absent ne se lit que comme un ratio par JH trop bas — 117 DH contre
     * 136 sur la Quinzaine 01 — et il faut ouvrir le code pour savoir lequel.
     * Chaque ligne se compare directement à la tuile de même nom sur l'écran
     * Quinzaine : un zéro en face d'une tuile non nulle est la réponse.
     */
    function tableauPostes(rap) {
      var avecPostes = rap.lignes.filter(function (l) {
        return l.postes;
      });
      if (!avecPostes.length) return null;
      var POSTES = [{
        k: 'primeFonction',
        l: 'Prime de fonction'
      }, {
        k: 'primeAnciennete',
        l: 'Ancienneté'
      }, {
        k: 'transport',
        l: 'Prime transport'
      }, {
        k: 'recolte',
        l: 'Prime récolte'
      }, {
        k: 'traitement',
        l: 'Traitement'
      }, {
        k: 'conditionnement',
        l: 'Conditionnement'
      }, {
        k: 'chargement',
        l: 'Chargement'
      }, {
        k: 'feries',
        l: 'Jours fériés'
      }, {
        k: 'heuresSup',
        l: 'Heures sup (pointées)'
      }, {
        k: 'heuresSupAccordees',
        l: 'Heures sup (accordées)'
      }, {
        k: 'chargesPatronales',
        l: 'Charges patronales'
      }, {
        k: 'cotisationsSalariales',
        l: 'Cotisations salariales'
      }];
      var dh = function (v) {
        return Math.round(v).toLocaleString('fr-MA');
      };
      var th = {
        padding: '5px 10px',
        textAlign: 'right',
        fontSize: '10px',
        color: C.textSec,
        fontWeight: 600,
        borderBottom: '1px solid ' + C.border
      };
      var thL = Object.assign({}, th, {
        textAlign: 'left'
      });
      var td = {
        padding: '5px 10px',
        textAlign: 'right',
        fontSize: '11px'
      };
      var tdL = Object.assign({}, td, {
        textAlign: 'left',
        color: C.textSec
      });
      return React.createElement('div', {
        style: {
          overflowX: 'auto',
          borderTop: '1px solid ' + C.border
        }
      }, React.createElement('div', {
        style: {
          padding: '8px 16px 2px',
          fontSize: '11px',
          fontWeight: 700,
          color: C.textSec
        }
      }, 'Ventilation du coût chargé, poste par poste — à comparer aux tuiles ' + 'de l\'écran Quinzaine. Un zéro en face d\'une tuile non nulle ' + 'désigne le poste manquant.'), React.createElement('table', {
        style: {
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '11px'
        }
      }, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', {
        style: thL
      }, 'Poste'), avecPostes.map(function (l) {
        return React.createElement('th', {
          key: l.periode,
          style: th
        }, l.periode);
      }))), React.createElement('tbody', null, POSTES.map(function (p, i) {
        var total = avecPostes.reduce(function (s, l) {
          return s + (Number(l.postes[p.k]) || 0);
        }, 0);
        return React.createElement('tr', {
          key: p.k,
          style: {
            background: i % 2 ? C.surface2 : C.surface
          }
        }, React.createElement('td', {
          style: tdL
        }, p.l), avecPostes.map(function (l) {
          var v = Number(l.postes[p.k]) || 0;
          // Un poste à zéro sur TOUTE la campagne est signalé : c'est le
          // symptôme d'une donnée qui n'arrive pas, pas d'un poste vide.
          return React.createElement('td', {
            key: l.periode,
            style: Object.assign({}, td, total === 0 ? {
              color: '#c0392b',
              fontWeight: 700
            } : {})
          }, total === 0 ? '0 ⚠' : dh(v));
        }));
      }))));
    }
    function panneauRapprochement() {
      var CRap = window.CampagneRapprochement;
      var pq = props.coutOuvrier && props.coutOuvrier.parQuinzaine;
      if (!CRap || typeof CRap.rapprocher !== 'function' || !pq || !pq.length) return null;
      var rap = CRap.rapprocher({
        parQuinzaine: pq,
        rows: data.rows,
        snapshots: props.snapQuinz
      });
      if (!rap.lignes.length) return null;
      var dh = function (v) {
        return Math.round(v).toLocaleString('fr-MA');
      };
      var pct = function (v) {
        return v === null ? '—' : (Math.round(v * 1000) / 10).toFixed(1) + ' %';
      };
      // Seuil de tolérance : sous 0,5 %, l'écart relève de l'arrondi et du
      // décalage de synchronisation, pas d'un trou de périmètre.
      var alerte = function (v) {
        return v !== null && Math.abs(v) >= 0.005;
      };
      var th = {
        padding: '6px 10px',
        textAlign: 'right',
        fontSize: '10px',
        color: C.textSec,
        fontWeight: 600,
        borderBottom: '1px solid ' + C.border
      };
      var thL = Object.assign({}, th, {
        textAlign: 'left'
      });
      var td = {
        padding: '6px 10px',
        textAlign: 'right',
        fontSize: '12px'
      };
      var tdL = Object.assign({}, td, {
        textAlign: 'left',
        fontWeight: 600
      });
      return React.createElement('div', {
        style: {
          marginBottom: '20px',
          background: C.surface,
          borderRadius: '12px',
          border: '1px solid ' + C.border,
          overflow: 'hidden'
        }
      }, React.createElement('div', {
        style: {
          padding: '10px 16px',
          background: C.surface2,
          borderBottom: '1px solid ' + C.border,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap'
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-scale-balanced',
        style: {
          color: C.textSec,
          fontSize: '13px'
        }
      }), React.createElement('span', {
        style: {
          fontSize: '13px',
          fontWeight: 700
        }
      }, 'Rapprochement pointage ↔ grille'), React.createElement('span', {
        style: {
          fontSize: '11px',
          color: alerte(rap.ecartPct) ? '#c0392b' : C.textSec,
          fontWeight: alerte(rap.ecartPct) ? 700 : 400
        }
      }, 'écart total ' + dh(rap.ecart) + ' DH (' + pct(rap.ecartPct) + ')'),
      // Dire ce qui n'est PAS comparé. Un total qui paraît complet alors
      // qu'il laisse des quinzaines de côté est pire qu'un total absent.
      rap.sansSnapshot && rap.sansSnapshot.length ? React.createElement('span', {
        style: {
          fontSize: '11px',
          color: '#c0392b',
          fontWeight: 600
        },
        title: 'Ouvrir l\'écran Quinzaine sur ces périodes enregistre leur ' + 'coût et les fait entrer dans le rapprochement.'
      }, rap.sansSnapshot.length + ' quinzaine(s) hors comparaison — ' + rap.sansSnapshot.join(', ')) : null), React.createElement('div', {
        style: {
          overflowX: 'auto'
        }
      }, React.createElement('table', {
        style: {
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '12px'
        }
      }, React.createElement('thead', null, React.createElement('tr', {
        style: {
          background: C.surface2
        }
      }, React.createElement('th', {
        style: thL
      }, 'Quinzaine'), React.createElement('th', {
        style: th
      }, 'JH'), React.createElement('th', {
        style: th,
        title: 'Coût CHARGÉ agrégé par parcelle : Σ (JH × taux de l\'ouvrier), tel que la grille ci-dessus l\'additionne.'
      }, 'Grille chargée'), React.createElement('th', {
        style: th,
        title: 'Coût chargé ouvrier ENREGISTRÉ PAR l\'écran Quinzaine — pas recalculé ici. « — » signifie que personne n\'a ouvert cette quinzaine depuis la mise en service.'
      }, 'Quinzaine chargée'), React.createElement('th', {
        style: th
      }, 'Écart'), React.createElement('th', {
        style: th
      }, '%'), React.createElement('th', {
        style: Object.assign({}, th, {
          color: C.textSec
        }),
        title: 'Net à payer de l\'écran Quinzaine — À NE PAS rapprocher du coût chargé : ' + 'il exclut les charges sociales (qui vont à la CNSS) et inclut la sous-traitance. ' + 'Affiché ici parce que c\'est le chiffre qu\'on lit spontanément sur la Quinzaine.'
      }, 'Net à payer (info)'), React.createElement('th', {
        style: th,
        title: 'JH pointés dont l\'ouvrier n\'a pas de fiche de paie : ils comptent en volume, mais à coût nul.'
      }, 'JH sans taux'), React.createElement('th', {
        style: th,
        title: 'Décomposition du coût chargé de la quinzaine. Un écart qui vient d\'un poste manquant (transport, prime de fonction, ancienneté) se lit ici.'
      }, 'dont salaire'), React.createElement('th', {
        style: th
      }, 'dont primes'), React.createElement('th', {
        style: th
      }, 'dont charges'))), React.createElement('tbody', null, rap.lignes.map(function (l, i) {
        return React.createElement('tr', {
          key: l.periode,
          style: {
            background: i % 2 ? C.surface2 : C.surface,
            borderBottom: '1px solid var(--gray-100)'
          }
        }, React.createElement('td', {
          style: tdL
        }, l.periode), React.createElement('td', {
          style: Object.assign({}, td, {
            color: C.textSec
          })
        }, (Math.round(l.jours * 10) / 10).toLocaleString('fr-MA')), React.createElement('td', {
          style: td
        }, dh(l.grille)), React.createElement('td', {
          style: Object.assign({}, td, {
            fontWeight: 700
          }, l.quinzaine === null ? {
            color: C.textSec,
            fontWeight: 400
          } : {})
        }, l.quinzaine === null ? '—' : dh(l.quinzaine)), React.createElement('td', {
          style: Object.assign({}, td, {
            color: alerte(l.ecartPct) ? '#c0392b' : C.textSec,
            fontWeight: alerte(l.ecartPct) ? 700 : 400
          })
        }, l.ecart === null ? '—' : dh(l.ecart)), React.createElement('td', {
          style: Object.assign({}, td, {
            color: alerte(l.ecartPct) ? '#c0392b' : C.textSec
          })
        }, pct(l.ecartPct)), React.createElement('td', {
          style: Object.assign({}, td, {
            color: C.textSec,
            fontStyle: 'italic'
          })
        }, l.netQuinzaine === null ? '—' : dh(l.netQuinzaine)), React.createElement('td', {
          style: Object.assign({}, td, {
            color: l.jhSansTaux > 0 ? '#c0392b' : C.textSec,
            fontWeight: l.jhSansTaux > 0 ? 700 : 400
          })
        }, l.jhSansTaux > 0 ? (Math.round(l.jhSansTaux * 10) / 10).toLocaleString('fr-MA') : '—'), React.createElement('td', {
          style: Object.assign({}, td, {
            color: C.textSec
          })
        }, dh(l.quinzaine - l.primes - l.charges)), React.createElement('td', {
          style: Object.assign({}, td, {
            color: C.textSec
          })
        }, dh(l.primes)), React.createElement('td', {
          style: Object.assign({}, td, {
            color: C.textSec
          })
        }, dh(l.charges)));
      })), React.createElement('tfoot', null, React.createElement('tr', {
        style: {
          background: C.surface2,
          fontWeight: 700
        }
      }, React.createElement('td', {
        style: tdL
      }, 'TOTAL'), React.createElement('td', {
        style: td
      }, ''), React.createElement('td', {
        style: td
      }, dh(rap.totalGrilleComparable)), React.createElement('td', {
        style: td
      }, dh(rap.totalQuinzaine)), React.createElement('td', {
        style: td
      }, dh(rap.ecart)), React.createElement('td', {
        style: td
      }, pct(rap.ecartPct)), React.createElement('td', {
        style: td
      }, ''), React.createElement('td', {
        style: td
      }, rap.totalJhSansTaux > 0 ? (Math.round(rap.totalJhSansTaux * 10) / 10).toLocaleString('fr-MA') : '—'), React.createElement('td', {
        style: td
      }, dh(rap.lignes.reduce(function (s, l) {
        return s + l.quinzaine - l.primes - l.charges;
      }, 0))), React.createElement('td', {
        style: td
      }, dh(rap.lignes.reduce(function (s, l) {
        return s + l.primes;
      }, 0))), React.createElement('td', {
        style: td
      }, dh(rap.lignes.reduce(function (s, l) {
        return s + l.charges;
      }, 0))))))), tableauPostes(rap), React.createElement('div', {
        style: {
          padding: '6px 14px 10px',
          fontSize: '10px',
          color: C.textSec,
          borderTop: '1px solid var(--gray-100)'
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-circle-info',
        style: {
          marginRight: '6px'
        }
      }), 'La colonne « Quinzaine chargée » est le total ENREGISTRÉ par l\'écran ' + 'Quinzaine — il n\'est pas recalculé ici. C\'est délibéré : trois ' + 'tentatives de le reproduire ont produit trois divergences, et un ' + 'écart entre deux implémentations ne dit rien. « — » signifie que ' + 'personne n\'a ouvert cette quinzaine depuis la mise en service : ' + 'ouvrir l\'écran Quinzaine sur cette période suffit à l\'enregistrer. ' + 'La grille, elle, agrège le pointage PAR PARCELLE : une ligne dont la ' + 'parcelle ou la culture ne se résout pas n\'y entre pas. L\'écart est ' + 'donc en dirhams réels — à zéro, la grille montre tout l\'argent. Les ' + '« JH sans taux » (ouvriers sans fiche de paie) en sont la première ' + 'cause : ils pèsent en volume, rien en coût. Le pointage divers ' + '(sous-traitants) reste hors des deux chemins.'));
    }

    /** Bouton plein écran d'UNE grille de culture (posé sur son bandeau). */
    function boutonPlein(i) {
      return React.createElement('button', {
        onClick: function () {
          if (enPlein) {
            setFullscreen(false);
            return;
          }
          setCultureIdx(i);
          setFullscreen(true);
        },
        title: enPlein ? 'Quitter le plein écran' : 'Plein écran',
        style: {
          position: 'absolute',
          top: '8px',
          right: '10px',
          zIndex: 2,
          padding: '4px 10px',
          borderRadius: '6px',
          border: '1px solid ' + C.border,
          background: C.surface,
          cursor: 'pointer',
          fontSize: '12px',
          color: C.textSec
        }
      }, React.createElement('i', {
        className: enPlein ? 'fa-solid fa-compress' : 'fa-solid fa-expand'
      }));
    }
    return React.createElement('div', {
      // L'overlay porte la barre de bascules ET la grille : en plein écran, on
      // doit pouvoir basculer Ha/Total ou Récap/Détail sans en ressortir.
      style: enPlein ? {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: '#fff',
        overflowY: 'auto',
        padding: '16px'
      } : null
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '16px',
        flexWrap: 'wrap'
      }
    }, React.createElement('span', {
      style: {
        fontSize: '13px',
        color: C.textSec,
        marginRight: '4px'
      }
    }, 'Afficher :'), CAT_pills([['jh', 'JH'], ['cout', 'Coût DH']], metric, setMetric, 'm-'), React.createElement('span', {
      style: {
        width: '8px'
      }
    }), CAT_pills([['ha', 'Par Ha'], ['total', 'Total']], totalMode ? 'total' : 'ha', function (v) {
      setTotalMode(v === 'total');
    }, 't-'), React.createElement('span', {
      style: {
        width: '8px'
      }
    }), CAT_pills([['recap', 'Récap'], ['detail', 'Détail']], detailMode ? 'detail' : 'recap', function (v) {
      setDetailMode(v === 'detail');
    }, 'd-'),
    // Poussés à droite par `marginLeft: auto` : les repères ne sont pas des
    // bascules, ils ne se rangent pas avec elles.
    repereCout || repereIdeal ? React.createElement('div', {
      style: {
        marginLeft: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        flexWrap: 'wrap'
      }
    }, repereCout, repereIdeal) : null,
    // Bascule ANNUEL ↔ QUINZAINE : proposée seulement quand elle mène
    // quelque part (JH + au moins un engagement saisi sur la quinzaine
    // affichée). Sinon elle n'ouvrirait qu'une grille de « — ».
    quinzaineDispo ? React.createElement(React.Fragment, null, React.createElement('span', {
      style: {
        width: '8px'
      }
    }), CAT_pills([['annuel', 'Annuel'], ['quinzaine', 'Quinzaine']], enQuinzaine ? 'quinzaine' : 'annuel', function (v) {
      setVueQuinzaine(v === 'quinzaine');
    }, 'q-')) : null,
    // Sélecteur de quinzaine : la quinzaine en cours par défaut, mais une
    // quinzaine passée doit rester consultable (c'est le seul moyen de
    // relire un engagement tenu ou raté).
    enQuinzaine ? React.createElement('select', {
      value: quinzaineActive,
      onChange: function (e) {
        setQuinzaineSel(e.target.value);
      },
      style: {
        border: '1px solid var(--gray-200)',
        borderRadius: '8px',
        padding: '5px 8px',
        fontSize: '12px',
        outline: 'none'
      }
    }, quinzaineOptions.map(function (o) {
      return React.createElement('option', {
        key: o.key,
        value: o.key
      }, o.label + (o.key === quinzaineCourante ? ' (en cours)' : ''));
    })) : null), detailCell ? React.createElement(CAT_DetailPopup, {
      cell: detailCell,
      onClose: function () {
        setDetailCell(null);
      }
    }) : null,
    // Carrousel de cultures — MÊME geste que le panneau Affectation
    // Analytique de l'écran Quinzaine : deux chevrons qui bouclent, et une
    // pastille par culture (aux couleurs de la culture) pour y aller
    // directement. Affiché en plein écran seulement : hors plein écran,
    // toutes les grilles sont déjà là, naviguer n'aurait aucun sens.
    enPlein && groups.length > 1 ? React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        marginBottom: '12px',
        flexWrap: 'wrap'
      }
    }, React.createElement('button', {
      onClick: function () {
        setCultureIdx((idxCulture - 1 + groups.length) % groups.length);
      },
      title: 'Culture précédente',
      style: {
        padding: '6px 14px',
        borderRadius: '8px',
        border: '1px solid ' + C.border,
        background: C.surface,
        cursor: 'pointer',
        fontSize: '14px'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-chevron-left'
    })), groups.map(function (g, i) {
      return React.createElement('button', {
        key: g.culture,
        onClick: function () {
          setCultureIdx(i);
        },
        style: {
          padding: '5px 14px',
          borderRadius: '8px',
          border: '1.5px solid ' + (i === idxCulture ? g.color : C.border),
          background: i === idxCulture ? g.color : C.surface,
          color: i === idxCulture ? '#fff' : C.textSec,
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer'
        }
      }, React.createElement('i', {
        className: 'fa-solid ' + g.icon,
        style: {
          marginRight: '5px'
        }
      }), g.culture);
    }), React.createElement('button', {
      onClick: function () {
        setCultureIdx((idxCulture + 1) % groups.length);
      },
      title: 'Culture suivante',
      style: {
        padding: '6px 14px',
        borderRadius: '8px',
        border: '1px solid ' + C.border,
        background: C.surface,
        cursor: 'pointer',
        fontSize: '14px'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-chevron-right'
    }))) : null,
    // Contrôle de couverture, affiché sous les grilles — jamais en plein
    // écran, où l'on vient lire une culture, pas auditer un périmètre.
    enPlein ? null : panneauRapprochement(), groups.length === 0 ? React.createElement('div', {
      style: {
        padding: '40px',
        textAlign: 'center',
        color: C.textSec,
        fontSize: '14px'
      }
    }, 'Aucune donnée pour cette sélection.') : groupesAffiches.map(function (g) {
      var pivot = AU.buildAnalytiquePivotByFamille(g.rows, {
        detail: detailMode
      });
      if (!pivot.groupedRows || pivot.groupedRows.length === 0) return null;
      // Superposition du budget : lignes IDENTIQUES (mêmes clés, même
      // ordre), plus les familles/opérations budgétées mais jamais
      // travaillées — un budget non consommé doit rester visible.
      // Modules absents (script non chargé) → réalisé seul, jamais un
      // budget deviné.
      var CBP = window.CampagneBudgetPivot;
      var rules = window.CampagneBudgetTab;
      var budgetArgs = {
        parcelles: pivot.parcelles,
        budgetsByLabel: props.budgetsByLabel || {},
        opBudgetsByLabel: props.opBudgetsByLabel || {},
        analytique: AU,
        budgetRules: rules
      };
      // Superposition du budget construite dans LES DEUX métriques, alors
      // que les sous-colonnes de budget, elles, restent réservées au JH.
      // Ce ne sont pas les mêmes choses : la superposition ajoute les
      // LIGNES budgétées mais jamais travaillées, et en Coût DH la Récolte
      // n'en a pas d'autre (son réalisé est nul tant que la saison n'a pas
      // commencé, et le backend ne sert que les lignes ayant du réalisé).
      // Sans elle, le bloc récolte disparaissait purement et simplement en
      // Coût DH — alors qu'il est là en JH.
      var sup = CBP && typeof CBP.buildBudgetPivot === 'function' && rules ? CBP.buildBudgetPivot(Object.assign({
        groupedRows: pivot.groupedRows,
        detail: detailMode
      }, budgetArgs)) : null;
      // VUE QUINZAINE : mêmes lignes, mêmes clés, mêmes colonnes — seules
      // les séries changent. Le budget de quinzaine passe par le MÊME
      // indexeur que le budget annuel (résolution famille → code GB), avec
      // la tranche de la quinzaine affichée : aucune jointure parallèle.
      // `rules` (CampagneBudgetTab) porte la règle métier injectée dans
      // l'indexeur : sans elle, pas d'index — jamais un budget deviné.
      var quinz = enQuinzaine && CBQ && rules && CBP && typeof CBP.indexBudgets === 'function' ? CBQ.decoreQuinzaine({
        groupedRows: sup ? sup.groupedRows : pivot.groupedRows,
        parcelles: pivot.parcelles,
        num: CBQ.quinzaineNum(quinzaineActive),
        budgetIndex: CBP.indexBudgets(Object.assign({}, budgetArgs, {
          budgetsByLabel: CBQ.trancheQuinzaine(quinzainesByLabel, quinzaineActive),
          opBudgetsByLabel: {}
        }))
      }) : null;
      // Séries réellement affichées : elles décident AUSSI de la colonne
      // Total (cf. `showTotal` plus bas), d'où l'extraction en variable.
      // Sous-colonnes de budget : en JH toujours, en Coût DH seulement
      // quand le coût ouvrier chargé est connu (sinon le budget n'a pas
      // de traduction en dirhams, et un budget nul afficherait un
      // dépassement infini sur chaque ligne).
      var metricsAffichees = quinz ? metricsQuinzaine : (isJh || coutJour !== null) && sup && sup.hasBudget ? metricsBudget : metrics;
      var rowsAffichees = quinz ? quinz.groupedRows : sup ? sup.groupedRows : pivot.groupedRows;
      // ── RÉCOLTE À PART ──────────────────────────────────────────
      // Partout, plein écran ou non : la récolte sortie du tableau change
      // le sens de son TOTAL (qui devient le total HORS récolte), et ce
      // sens ne peut pas dépendre d'un bouton d'affichage.
      // Les DEUX grilles reçoivent les mêmes `parcelles`, les mêmes
      // `metrics` et les mêmes largeurs de colonnes : c'est ce qui permet
      // de lire le bloc Récolte en vis-à-vis du principal, colonne par
      // colonne.
      var partition = CAT_partitionRecolte(rowsAffichees, GROUPE_RECOLTE);
      function _aDesFamilles(rows) {
        return rows.some(function (r) {
          return r && r.type === 'famille';
        });
      }
      var aRecolte = _aDesFamilles(partition.recolte);
      // Une culture qui n'a QUE de la récolte (l'avocatier, la myrtille en
      // début de campagne) ne doit pas hériter d'un tableau principal vide
      // au-dessus de son bloc récolte : un tableau sans une seule ligne se
      // lit comme des données manquantes.
      var aPrincipal = _aDesFamilles(partition.principal);
      var propsCommunes = {
        parcelles: pivot.parcelles,
        metrics: metricsAffichees,
        color: g.color,
        // Totaux dans les bandeaux de section : même arbitrage de largeur
        // que la colonne Total et que la colonne « Budget idéal ».
        chiffresGroupe: enPlein,
        // Deux grilles empilées par culture (hors récolte / récolte) :
        // sans largeurs déterministes, chacune se dimensionne sur SON
        // contenu et les colonnes ne tombent plus en face. Vrai dans
        // toutes les vues, y compris en Coût DH où il n'y a qu'une série.
        largeursFixes: true,
        // …et elles coulissent ensemble : deux tableaux de mêmes colonnes
        // qui défilent séparément font lire une parcelle pour une autre.
        scrollGroup: 'campagne-' + g.culture,
        showTotal: enPlein && metricsAffichees.length > 1,
        parcelleLabel: function (k) {
          return sbNom(k, sbMap);
        },
        onCellClick: function (c) {
          setDetailCell(Object.assign({
            parcelleLabel: sbNom(c.parcelle, sbMap)
          }, c));
        }
      };
      // Chaque grille est encapsulée pour porter SON bouton plein écran,
      // posé sur son bandeau de titre (position absolue) : c'est la
      // culture qu'on regarde qu'on veut agrandir, pas « la première ».
      return React.createElement('div', {
        key: g.culture,
        style: {
          position: 'relative'
        }
      }, boutonPlein(groups.indexOf(g)), aPrincipal ? React.createElement(Grid, Object.assign({}, propsCommunes, {
        groupedRows: partition.principal,
        // Le périmètre du budget n'est PAS déductible des chiffres
        // affichés (un « % consommé » à 130 % sur une ligne dont la
        // moitié des familles n'est pas budgétée se lit comme une erreur
        // de calcul) : il reste énoncé sous la grille.
        note: quinz ? CBQ.noteQuinzaine(quinzaineInfoSel || {
          key: quinzaineActive
        }, quinzaineActive === quinzaineCourante) : sup && sup.hasBudget ? noteBudgetSeul : null,
        title: aRecolte ? g.culture + ' — hors récolte' : g.culture,
        icon: g.icon
      })) : null, aRecolte ? React.createElement(Grid, Object.assign({}, propsCommunes, {
        groupedRows: partition.recolte,
        title: g.culture + ' — récolte',
        icon: g.icon,
        // Un second « TOTAL » sous celui du tableau du dessus se lirait
        // comme le total général de l'écran.
        labelPied: 'TOTAL RÉCOLTE',
        piedsSupplementaires: lignesRendementRecolte(g.culture, partition.recolte, pivot.parcelles),
        // Le lecteur doit savoir POURQUOI ce bloc est à part, sinon il
        // le lit comme un oubli du tableau du dessus.
        note: 'Récolte présentée à part : son budget n\'est consommé qu\'en ' + 'saison, le laisser dans le tableau ci-dessus écrasait le TOTAL ' + '(le « % consommé » global tombait à quelques pour cent). Le TOTAL ' + 'du tableau ci-dessus est donc le total HORS récolte.'
      })) : null);
    }));
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
    var metric = _metric[0];
    var setMetric = _metric[1];

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
        var items = subTab === 'engrais' ? p.engrais || [] : p.pesticides || [];
        items.forEach(function (item) {
          if (!seen[item.article]) {
            seen[item.article] = {
              unite: item.unite
            };
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
      textAlign: 'right'
    };
    var thFirstStyle = Object.assign({}, thStyle, {
      textAlign: 'left'
    });
    var tdStyle = {
      padding: '7px 10px',
      borderBottom: '1px solid ' + C.border,
      fontSize: '13px',
      color: C.text,
      textAlign: 'right',
      whiteSpace: 'nowrap'
    };
    var tdFirstStyle = Object.assign({}, tdStyle, {
      textAlign: 'left',
      fontWeight: 500
    });
    var tdDashStyle = Object.assign({}, tdStyle, {
      color: C.textSec
    });
    var totalCellStyle = {
      padding: '8px 10px',
      fontSize: '13px',
      fontWeight: 700,
      textAlign: 'right',
      whiteSpace: 'nowrap',
      color: '#fff'
    };

    // Totaux colonnes
    var colTotals = useMemo(function () {
      var byArticle = {};
      var totalDH = 0;
      parcelles.forEach(function (p) {
        var items = subTab === 'engrais' ? p.engrais || [] : p.pesticides || [];
        var ha = p.ha || 0;
        items.forEach(function (item) {
          if (!byArticle[item.article]) byArticle[item.article] = {
            qty: 0,
            cout: 0
          };
          byArticle[item.article].qty += item.qty || 0;
          byArticle[item.article].cout += item.coutTotal || 0;
        });
        var total = subTab === 'engrais' ? p.totalEngraisCout || 0 : p.totalPesticidesCout || 0;
        totalDH += total;
      });
      return {
        byArticle: byArticle,
        totalDH: totalDH
      };
    }, [parcelles, subTab]);

    // Ha total (pour DH/Ha colonne totaux)
    var totalHa = useMemo(function () {
      return parcelles.reduce(function (sum, p) {
        return sum + (p.ha || 0);
      }, 0);
    }, [parcelles]);
    return React.createElement('div', null,
    // Barre de contrôle (métrique)
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '16px',
        flexWrap: 'wrap'
      }
    }, React.createElement('span', {
      style: {
        fontSize: '13px',
        color: C.textSec,
        marginRight: '4px'
      }
    }, 'Afficher :'), ['perha', 'total'].map(function (m) {
      var label = m === 'perha' ? 'Par Ha' : 'Total';
      return React.createElement('button', {
        key: m,
        onClick: function () {
          setMetric(m);
        },
        style: {
          padding: '5px 14px',
          border: '1.5px solid ' + (metric === m ? C.berry : C.border),
          borderRadius: '16px',
          background: metric === m ? C.berry : C.surface,
          color: metric === m ? '#fff' : C.text,
          fontSize: '12px',
          fontWeight: metric === m ? 700 : 400,
          cursor: 'pointer'
        }
      }, label);
    })), parcelles.length === 0 ? React.createElement('div', {
      style: {
        padding: '40px',
        textAlign: 'center',
        color: C.textSec,
        fontSize: '14px'
      }
    }, 'Aucune donnée pour cette sélection.') : React.createElement('div', {
      style: {
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        width: '100%'
      }
    }, React.createElement('table', {
      style: {
        minWidth: '600px',
        borderCollapse: 'collapse',
        fontSize: '13px'
      }
    }, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', {
      style: thFirstStyle
    }, 'Parcelle'), React.createElement('th', {
      style: thStyle
    }, 'Ferme'), React.createElement('th', {
      style: thStyle
    }, 'Ha'), articles.map(function (art) {
      // Trouver l'unité dans les données
      var unite = '';
      for (var pi = 0; pi < parcelles.length; pi++) {
        var items = subTab === 'engrais' ? parcelles[pi].engrais || [] : parcelles[pi].pesticides || [];
        for (var ii = 0; ii < items.length; ii++) {
          if (items[ii].article === art) {
            unite = items[ii].unite || '';
            break;
          }
        }
        if (unite) break;
      }
      return React.createElement('th', {
        key: art,
        style: thStyle
      }, art + (unite ? ' (' + unite + ')' : ''));
    }), React.createElement('th', {
      style: thStyle
    }, 'Total DH'), React.createElement('th', {
      style: thStyle
    }, 'DH/Ha'))), React.createElement('tbody', null, parcelles.map(function (p, idx) {
      var itemMap = {};
      var items = subTab === 'engrais' ? p.engrais || [] : p.pesticides || [];
      items.forEach(function (item) {
        itemMap[item.article] = item;
      });
      var totalParcelle = subTab === 'engrais' ? p.totalEngraisCout || 0 : p.totalPesticidesCout || 0;
      return React.createElement('tr', {
        key: p.parcelle,
        style: {
          background: idx % 2 === 0 ? C.surface : C.surface2
        }
      }, React.createElement('td', {
        style: tdFirstStyle
      }, p.parcelle), React.createElement('td', {
        style: tdStyle
      }, p.ferme || '—'), React.createElement('td', {
        style: tdStyle
      }, fmtHa(p.ha)), articles.map(function (art) {
        var item = itemMap[art];
        if (!item || !item.qty) return React.createElement('td', {
          key: art,
          style: tdDashStyle
        }, '—');
        if (metric === 'perha') {
          var ha = p.ha || 0;
          if (!ha) return React.createElement('td', {
            key: art,
            style: tdDashStyle
          }, '—');
          return React.createElement('td', {
            key: art,
            style: tdStyle
          }, fmtQty(item.qty / ha));
        }
        return React.createElement('td', {
          key: art,
          style: tdStyle
        }, fmtQty(item.qty));
      }), React.createElement('td', {
        style: Object.assign({}, tdStyle, {
          fontWeight: 700
        })
      }, fmtDH(totalParcelle)), React.createElement('td', {
        style: tdStyle
      }, fmtDHPerHa(totalParcelle, p.ha)));
    }),
    // Ligne de total
    React.createElement('tr', {
      style: {
        background: C.berry
      }
    }, React.createElement('td', {
      style: Object.assign({}, totalCellStyle, {
        textAlign: 'left'
      })
    }, 'TOTAL'), React.createElement('td', {
      style: totalCellStyle
    }, ''), React.createElement('td', {
      style: totalCellStyle
    }, fmtHa(totalHa)), articles.map(function (art) {
      var cell = colTotals.byArticle[art];
      if (!cell || !cell.qty) return React.createElement('td', {
        key: art,
        style: totalCellStyle
      }, '—');
      if (metric === 'perha') {
        return React.createElement('td', {
          key: art,
          style: totalCellStyle
        }, totalHa ? fmtQty(cell.qty / totalHa) : '—');
      }
      return React.createElement('td', {
        key: art,
        style: totalCellStyle
      }, fmtQty(cell.qty));
    }), React.createElement('td', {
      style: totalCellStyle
    }, fmtDH(colTotals.totalDH)), React.createElement('td', {
      style: totalCellStyle
    }, fmtDHPerHa(colTotals.totalDH, totalHa)))))));
  }

  /* ------------------------------------------------------------------ */
  /* Composant principal                                                  */
  /* ------------------------------------------------------------------ */
  function CampagneAnalytiqueTab(props) {
    var farmFilter = props.farmFilter || null;
    var _subTab = useState('mo');
    var subTab = _subTab[0];
    var setSubTab = _subTab[1];
    var _view = useState('ha');
    var view = _view[0];
    var setView = _view[1];
    var _cultureFilter = useState('Toutes');
    var cultureFilter = _cultureFilter[0];
    var setCultureFilter = _cultureFilter[1];
    var _data = useState(null);
    var data = _data[0];
    var setData = _data[1];
    var _loading = useState(true);
    var loading = _loading[0];
    var setLoading = _loading[1];
    var _err = useState(null);
    var err = _err[0];
    var setErr = _err[1];
    var _selectedParcelle = useState('');
    var selectedParcelle = _selectedParcelle[0];
    var setSelectedParcelle = _selectedParcelle[1];

    // Métrique partagée entre les 2 vues MO
    var _metric = useState('cout');
    var metric = _metric[0];
    var setMetric = _metric[1];

    // Données conso (lazy — chargées à la première activation engrais/pesticides)
    var _consoData = useState(null);
    var consoData = _consoData[0];
    var setConsoData = _consoData[1];
    var _consoLoading = useState(false);
    var consoLoading = _consoLoading[0];
    var setConsoLoading = _consoLoading[1];
    var _consoErr = useState(null);
    var consoErr = _consoErr[0];
    var setConsoErr = _consoErr[1];

    // Suivi du premier chargement conso
    var _consoFetched = useState(false);
    var consoFetched = _consoFetched[0];
    var setConsoFetched = _consoFetched[1];

    // Référentiel parcelles Smart Berry (culture_sb, nom_sb, ha) — en state :
    // window.SB_PARCELLE_REF est peuplé de façon asynchrone par app.jsx sans
    // re-render, il ne sert donc que de valeur initiale.
    var _sbMap = useState(window.SB_PARCELLE_REF || {});
    var sbMap = _sbMap[0];
    var setSbMap = _sbMap[1];

    // Budgets JH/Ha de la campagne courante : { LABEL_BEE_ONE_MAJ: { famille:
    // jhParHa } }. Alimente les colonnes de suivi budgétaire de l'export Excel
    // ET les séries Budget/Écart de la grille (PivotView).
    // Un échec de chargement n'est PAS bloquant : l'export part sans budget
    // (colonnes vides) et la grille n'affiche que le réalisé, exactement comme
    // avant toute saisie.
    var _budgets = useState({});
    var budgetsByLabel = _budgets[0];
    var setBudgetsByLabel = _budgets[1];

    // Même source, même fetch : le détail par opération du MÊME appel
    // `campagne-budget-list` (jamais un second aller-retour). Il sert la maille
    // fine de la grille en mode Détail, et la règle « les opérations écrasent la
    // famille » a besoin des deux niveaux.
    var _opBudgets = useState({});
    var opBudgetsByLabel = _opBudgets[0];
    var setOpBudgetsByLabel = _opBudgets[1];

    // Budgets DE QUINZAINE (LOT 3b), même source et même fetch : { LABEL_MAJ:
    // { Q07: { famille: jhParHa } } }. Absent des documents antérieurs → map
    // vide, aucune migration. Alimente la vue Quinzaine de la grille.
    var _quinzBudgets = useState({});
    var quinzainesByLabel = _quinzBudgets[0];
    var setQuinzainesByLabel = _quinzBudgets[1];

    // Opérations du référentiel des tâches — utilisées UNIQUEMENT pour leur
    // `classe_rythme` (continu / saisonnier / recolte), qui décide si une
    // opération se projette. Liste vide ou champ absent = aucune classe connue
    // → la grille affiche « — » sur le reste au rythme, jamais une projection
    // devinée.
    var _refOps = useState([]);
    var refOperations = _refOps[0];
    var setRefOperations = _refOps[1];

    // BONS D'APPORT (kilos) — chargés ICI, une seule fois, et descendus en prop
    // à la grille (ligne « Kg / JH ») comme au bloc production. Même source que
    // l'onglet Production (`loadBonsFromFirestore`, cache mémoire partagé) :
    // deux écrans, une lecture, donc jamais deux totaux différents pour la même
    // journée. `null` = pas encore chargé, à distinguer de `[]` (aucun bon).
    var _bons = useState(null);
    var bons = _bons[0];
    var setBons = _bons[1];
    useEffect(function () {
      // Garde anti-crash : une référence à un global absent fait planter TOUT
      // le rendu React (mémoire projet « tab bare global ref »).
      if (typeof window.loadBonsFromFirestore !== 'function') return undefined;
      var cancelled = false;
      window.loadBonsFromFirestore().then(function (b) {
        if (!cancelled) setBons(b || []);
      }).catch(function () {
        if (!cancelled) setBons([]);
      });
      return function () {
        cancelled = true;
      };
    }, []);

    // COÛT OUVRIER CHARGÉ (DH par journée pointée, moyenné sur la campagne) —
    // brut + CNSS patronale des déclarés + prime de transport. C'est ce qui
    // permet de valoriser en dirhams un budget saisi en JH/Ha.
    // `null` = indisponible (action en erreur, ou aucune journée pointée) : le
    // budget en DH n'est alors PAS affiché, jamais un budget nul.
    var _coutOuvrier = useState(null);
    var coutOuvrier = _coutOuvrier[0];
    var setCoutOuvrier = _coutOuvrier[1];
    useEffect(function () {
      var cancelled = false;
      fetch('/api/pointage-rh?action=campagne-cout-ouvrier').then(function (r) {
        return r.json();
      }).then(function (d) {
        if (cancelled || !d || !d.success) return;
        setCoutOuvrier(d);
      }).catch(function () {/* indisponible → pas de budget en DH, cf. plus bas */});
      return function () {
        cancelled = true;
      };
    }, []);

    // INSTANTANÉS DE L'ÉCRAN QUINZAINE — la référence du rapprochement.
    //
    // Ce panneau ne RECALCULE plus le coût de la quinzaine : trois tentatives de
    // le reproduire ont produit trois divergences. L'écran Quinzaine enregistre
    // son propre total, on le relit ici tel quel. L'écart affiché redevient donc
    // un écart RÉEL entre deux mesures, et non entre deux implémentations.
    //
    // Absent = personne n'a ouvert la Quinzaine depuis la mise en service. Le
    // panneau le DIT au lieu de retomber sur un calcul local : un chiffre de
    // repli s'y lirait comme la référence, et on aurait reconstruit exactement
    // le problème qu'on vient de supprimer.
    var _snapQuinz = useState(null);
    var snapQuinz = _snapQuinz[0];
    var setSnapQuinz = _snapQuinz[1];
    useEffect(function () {
      var cancelled = false;
      fetch('/api/pointage?action=cout-quinzaine').then(function (r) {
        return r.json();
      }).then(function (d) {
        if (cancelled || !d || !d.success) return;
        setSnapQuinz(d.parPeriode || {});
      }).catch(function () {/* indisponible → le panneau affiche « — » */});
      return function () {
        cancelled = true;
      };
    }, []);

    // Rechargé à CHAQUE retour sur le sous-onglet « Main Oeuvre » (d'où part
    // l'export), et pas seulement au montage : sinon un budget saisi dans le
    // sous-onglet Budget puis exporté sans recharger la page produirait un
    // fichier périmé, silencieusement.
    useEffect(function () {
      if (subTab !== 'mo') return;
      var cancelled = false;
      fetch('/api/pointage-rh?action=campagne-budget-list').then(function (r) {
        return r.json();
      }).then(function (d) {
        if (cancelled || !d || !d.success) return;
        setBudgetsByLabel(CAT_budgetsByLabel(d.budgets || []));
        setOpBudgetsByLabel(CAT_opBudgetsByLabel(d.budgets || []));
        var _cbq = window.CampagneBudgetQuinzaine;
        setQuinzainesByLabel(_cbq ? _cbq.quinzainesByLabel(d.budgets || []) : {});
      }).catch(function () {});
      return function () {
        cancelled = true;
      };
    }, [subTab]);

    // Chargé une seule fois : le référentiel des tâches ne bouge pas pendant
    // une session (contrairement aux budgets, saisissables dans l'onglet voisin).
    useEffect(function () {
      fetch('/api/pointage-rh?action=referentiel-taches-list').then(function (r) {
        return r.json();
      }).then(function (d) {
        if (!d || !d.success) return;
        setRefOperations(d.operations || []);
      }).catch(function () {});
    }, []);
    useEffect(function () {
      fetch('/api/pointage-rh?action=sb-referentiel-list').then(function (r) {
        return r.json();
      }).then(function (d) {
        if (!d || !d.success) return;
        var map = {};
        (d.parcelles || []).forEach(function (p) {
          map[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
        });
        window.SB_PARCELLE_REF = map;
        setSbMap(map);
      }).catch(function () {});
    }, []);
    useEffect(function () {
      setLoading(true);
      setErr(null);
      fetch('/api/pointage-rh?action=campagne-analytique-detail').then(function (r) {
        return r.json();
      }).then(function (d) {
        if (d && d.success) {
          setData(d);
        } else {
          setErr(d && d.error || 'Erreur lors du chargement.');
        }
      }).catch(function (e) {
        setErr(e.message || 'Erreur réseau.');
      }).finally(function () {
        setLoading(false);
      });
    }, []);

    // Chargement conso (paresseux — uniquement à la première transition vers engrais/pesticides)
    useEffect(function () {
      // 'budget' n'utilise PAS campagne-conso-parcelle (saisie, pas conso) :
      // l'exclure évite un fetch inutile à l'ouverture de l'onglet.
      if (subTab === 'mo' || subTab === 'budget' || consoFetched) return;
      setConsoFetched(true);
      setConsoLoading(true);
      setConsoErr(null);
      fetch('/api/pointage-rh?action=campagne-conso-parcelle').then(function (r) {
        return r.json();
      }).then(function (d) {
        if (d && d.success) {
          setConsoData(d);
        } else {
          setConsoErr(d && d.error || 'Erreur lors du chargement de la consommation.');
        }
      }).catch(function (e) {
        setConsoErr(e.message || 'Erreur réseau.');
      }).finally(function () {
        setConsoLoading(false);
      });
    }, [subTab]);

    // Styles communs
    var containerStyle = {
      padding: '16px',
      fontFamily: 'var(--font-sans, system-ui, sans-serif)'
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
        transition: 'all .15s'
      };
    };
    if (loading) {
      return React.createElement('div', {
        style: Object.assign({}, containerStyle, {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: C.textSec
        })
      }, React.createElement('i', {
        className: 'fa-solid fa-spinner fa-spin'
      }), 'Chargement de la campagne analytique…');
    }
    if (err) {
      return React.createElement('div', {
        style: Object.assign({}, containerStyle, {
          color: '#c0392b',
          padding: '24px'
        })
      }, React.createElement('i', {
        className: 'fa-solid fa-triangle-exclamation',
        style: {
          marginRight: '8px'
        }
      }), err);
    }
    if (!data) {
      return React.createElement('div', {
        style: containerStyle
      }, 'Aucune donnée disponible.');
    }

    // Sous-tabs definition
    // 'budget' n'est proposé que si le composant est réellement chargé : une
    // référence nue à un global absent crashe GLOBALEMENT (piège projet
    // « tab bare global ref »), on garde donc l'onglet ET son rendu.
    var subTabs = [{
      id: 'mo',
      label: 'Main Oeuvre',
      icon: 'fa-person-digging'
    }, {
      id: 'engrais',
      label: 'Engrais',
      icon: 'fa-flask'
    }, {
      id: 'pesticides',
      label: 'Pesticides',
      icon: 'fa-spray-can'
    }];
    if (window.CampagneBudgetTab) {
      subTabs.push({
        id: 'budget',
        label: 'Budget',
        icon: 'fa-bullseye'
      });
    }
    var cultures = ['Toutes', 'Framboise', 'Myrtille', 'Avocatier'];
    return React.createElement('div', {
      style: containerStyle
    },
    // En-tête : info campagne
    React.createElement('div', {
      style: {
        marginBottom: '12px'
      }
    }, React.createElement('p', {
      style: {
        margin: 0,
        fontSize: '13px',
        color: C.textSec
      }
    }, 'Campagne ' + data.campagne + ' — ' + (data.rows || []).length + ' lignes MO')),
    // Ligne 1 : Sub-tabs (MO | Engrais | Pesticides) + toggle vue (si MO)
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '10px',
        flexWrap: 'wrap',
        gap: '12px'
      }
    },
    // Sub-tab buttons
    React.createElement('div', {
      style: {
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap'
      }
    }, subTabs.map(function (st) {
      return React.createElement('button', {
        key: st.id,
        onClick: function () {
          setSubTab(st.id);
        },
        style: toggleBtnStyle(subTab === st.id)
      }, React.createElement('i', {
        className: 'fa-solid ' + st.icon,
        style: {
          marginRight: '6px'
        }
      }), st.label);
    })),
    // Vue toggle (uniquement en MO)
    subTab === 'mo' ? React.createElement('div', {
      style: {
        display: 'flex',
        gap: '8px'
      }
    }, React.createElement('button', {
      onClick: function () {
        setView('ha');
      },
      style: toggleBtnStyle(view === 'ha')
    }, React.createElement('i', {
      className: 'fa-solid fa-table-cells-large',
      style: {
        marginRight: '6px'
      }
    }), 'Affectation par Ha'), React.createElement('button', {
      onClick: function () {
        setView('variete');
      },
      style: toggleBtnStyle(view === 'variete')
    }, React.createElement('i', {
      className: 'fa-solid fa-table',
      style: {
        marginRight: '6px'
      }
    }), 'Par Variété / Quinzaine')) : null),
    // Ligne 2 : Filtre culture (masqué sur 'budget' : la saisie porte sur UNE
    // parcelle choisie explicitement, un filtre culture sans effet mentirait).
    subTab !== 'budget' && React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '16px',
        flexWrap: 'wrap'
      }
    }, React.createElement('span', {
      style: {
        fontSize: '13px',
        color: C.textSec,
        marginRight: '4px'
      }
    }, 'Culture :'), cultures.map(function (c) {
      return React.createElement('button', {
        key: c,
        onClick: function () {
          setCultureFilter(c);
        },
        style: {
          padding: '5px 14px',
          border: '1.5px solid ' + (cultureFilter === c ? C.berry : C.border),
          borderRadius: '16px',
          background: cultureFilter === c ? C.berry : C.surface,
          color: cultureFilter === c ? '#fff' : C.text,
          fontSize: '12px',
          fontWeight: cultureFilter === c ? 700 : 400,
          cursor: 'pointer'
        }
      }, c);
    })),
    // Contenu
    subTab === 'budget' ? window.CampagneBudgetTab ? React.createElement(window.CampagneBudgetTab, {
      userRole: props.userRole
    }) : null : subTab === 'mo'
    // Vue « Affectation par Ha » = la grille partagée (PivotView). L'ancienne
    // vue tabulaire parcelle × famille a été RETIRÉE : deux présentations du
    // même chiffre entretiennent une redondance que personne ne saura
    // départager plus tard (décision Omar, LOT 2b).
    ? view === 'ha' ? React.createElement(PivotView, {
      data: data,
      farmFilter: farmFilter,
      cultureFilter: cultureFilter,
      sbMap: sbMap,
      budgetsByLabel: budgetsByLabel,
      opBudgetsByLabel: opBudgetsByLabel,
      quinzainesByLabel: quinzainesByLabel,
      refOperations: refOperations,
      bons: bons,
      coutOuvrier: coutOuvrier,
      snapQuinz: snapQuinz,
      metric: metric,
      setMetric: setMetric
    }) : React.createElement(VarieteView, {
      data: data,
      farmFilter: farmFilter,
      cultureFilter: cultureFilter,
      sbMap: sbMap,
      budgetsByLabel: budgetsByLabel,
      opBudgetsByLabel: opBudgetsByLabel,
      selectedParcelle: selectedParcelle,
      setSelectedParcelle: setSelectedParcelle,
      metric: metric,
      setMetric: setMetric
    }) : consoLoading ? React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        color: C.textSec,
        padding: '24px'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-spinner fa-spin'
    }), 'Chargement de la consommation…') : consoErr ? React.createElement('div', {
      style: {
        color: '#c0392b',
        padding: '24px'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-triangle-exclamation',
      style: {
        marginRight: '8px'
      }
    }), consoErr) : React.createElement(ConsoView, {
      consoData: consoData,
      subTab: subTab,
      farmFilter: farmFilter,
      cultureFilter: cultureFilter,
      sbMap: sbMap
    }));
  }
  window.CampagneAnalytiqueTab = CampagneAnalytiqueTab;
  // Exposés pour les tests unitaires (node:test + vm), comme CampagneBudgetTab.
  CampagneAnalytiqueTab.budgetsByLabel = CAT_budgetsByLabel;
  CampagneAnalytiqueTab.opBudgetsByLabel = CAT_opBudgetsByLabel;
  CampagneAnalytiqueTab.buildCultureWorkbook = buildCultureWorkbook;
  CampagneAnalytiqueTab.CULTURE_INCONNUE = CAT_CULTURE_INCONNUE;
  CampagneAnalytiqueTab.pivotRows = CAT_pivotRows;
  CampagneAnalytiqueTab.pctPartsAnnuel = CAT_pctPartsAnnuel;
  CampagneAnalytiqueTab.byCulture = CAT_byCulture;
  CampagneAnalytiqueTab.PivotView = PivotView;
  CampagneAnalytiqueTab.VarieteView = VarieteView;
})();
