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
          total: {
            jh: 0,
            cout: 0
          }
        };
      }
      var fam = r.famille;
      if (!byParcelle[key].byFamille[fam]) byParcelle[key].byFamille[fam] = {
        jh: 0,
        cout: 0
      };
      byParcelle[key].byFamille[fam].jh += r.jh;
      byParcelle[key].byFamille[fam].cout += r.cout;
      byParcelle[key].total.jh += r.jh;
      byParcelle[key].total.cout += r.cout;
    }
    return Object.values(byParcelle).sort(function (a, b) {
      return b.total.cout - a.total.cout;
    });
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

  /* ------------------------------------------------------------------ */
  /* Export Excel — une feuille Synthèse + une feuille par parcelle       */
  /* ------------------------------------------------------------------ */

  /**
   * Construit les feuilles du classeur d'une culture. Indépendant du filtre
   * Culture de l'écran et de la parcelle sélectionnée, mais respecte le
   * farmFilter (périmètre du profil chef).
   * Retourne { fileName, sheets: [{ name, aoa }] }.
   */
  function buildCultureWorkbook(culture, data, farmFilter, sbMap) {
    var CEU = window.CampagneExportUtils;
    var rows = data && data.rows || [];
    var periodes = data && data.periodes || [];
    var haByRef = data && data.haByRef || {};

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
      var totalCout = 0;
      opRows.forEach(function (r) {
        totalJh += r.total.jh;
        totalCout += r.total.cout;
      });
      var ha = sbHa(label, sbMap, haByRef);
      var nom = sbNom(label, sbMap);
      synthese.push({
        nomSb: nom,
        label: label,
        ferme: seen[label].ferme,
        ha: ha,
        totalJh: totalJh,
        totalCout: totalCout
      });
      sheets.push({
        name: CEU.safeSheetName(nom, i + 1, used),
        aoa: CEU.buildParcelleSheetAoA({
          nomSb: nom,
          ha: ha,
          culture: culture,
          campagne: data && data.campagne || '',
          periodes: periodes,
          opRows: opRows,
          famillesOrdered: data && data.famillesOrdered || []
        })
      });
    });
    return {
      fileName: 'Campagne_' + culture + '_' + new Date().toISOString().slice(0, 10),
      sheets: [{
        name: syntheseName,
        aoa: CEU.buildSyntheseAoA(synthese)
      }].concat(sheets)
    };
  }

  /** Écrit le classeur (SheetJS via CDN) ou, à défaut, la Synthèse en CSV. */
  function exportCulture(culture, data, farmFilter, sbMap) {
    if (!window.CampagneExportUtils) return;
    var wbData = buildCultureWorkbook(culture, data, farmFilter, sbMap);
    if (wbData.sheets.length <= 1) {
      window.alert('Aucune parcelle ' + culture + ' dans le périmètre.');
      return;
    }
    if (window.XLSX) {
      var wb = window.XLSX.utils.book_new();
      wbData.sheets.forEach(function (s) {
        window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(s.aoa), s.name);
      });
      window.XLSX.writeFile(wb, wbData.fileName + '.xlsx');
      return;
    }

    // Fallback CSV (feuille Synthèse) si SheetJS absent.
    var csv = wbData.sheets[0].aoa.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\n');
    var blob = new Blob(['﻿' + csv], {
      type: 'text/csv;charset=utf-8;'
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = wbData.fileName + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
      var ordered = (data.famillesOrdered || []).filter(function (f) {
        return famSet[f];
      });
      // Ajouter les familles non reconnues dans le référentiel
      Object.keys(famSet).forEach(function (f) {
        if (ordered.indexOf(f) === -1) ordered.push(f);
      });
      return ordered;
    }, [rows, data.famillesOrdered]);

    // Filtrer par ferme puis par culture
    var filteredRows = useMemo(function () {
      var r = rows;
      if (farmFilter) r = r.filter(function (row) {
        return row.ferme === farmFilter;
      });
      r = r.filter(function (row) {
        return matchCulture(row.parcelle || row.refParcelle, cultureFilter, sbMap);
      });
      return r;
    }, [rows, farmFilter, cultureFilter, sbMap]);

    // Totaux colonnes
    var colTotals = useMemo(function () {
      var t = {
        byFamille: {},
        total: {
          jh: 0,
          cout: 0
        }
      };
      filteredRows.forEach(function (r) {
        activeFamilles.forEach(function (f) {
          if (!t.byFamille[f]) t.byFamille[f] = {
            jh: 0,
            cout: 0
          };
          var cell = r.byFamille[f];
          if (cell) {
            t.byFamille[f].jh += cell.jh;
            t.byFamille[f].cout += cell.cout;
          }
        });
        t.total.jh += r.total.jh;
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
    var totalRowStyle = {
      background: C.berry,
      color: '#fff'
    };
    var totalCellStyle = {
      padding: '8px 10px',
      fontSize: '13px',
      fontWeight: 700,
      textAlign: 'right',
      whiteSpace: 'nowrap',
      color: '#fff'
    };
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
    }, 'Afficher :'), ['cout', 'jh'].map(function (m) {
      var label = m === 'cout' ? 'Coût DH' : 'Journées-Homme';
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
    })),
    // Tableau
    filteredRows.length === 0 ? React.createElement('div', {
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
    }, 'Ha'), activeFamilles.map(function (f) {
      var icon = FAMILLE_ICONS[f];
      return React.createElement('th', {
        key: f,
        style: thStyle,
        title: f
      }, icon ? React.createElement('span', null, React.createElement('i', {
        className: 'fa-solid ' + icon,
        style: {
          marginRight: '4px'
        }
      }), f) : f);
    }), React.createElement('th', {
      style: thStyle
    }, 'Total DH'), React.createElement('th', {
      style: thStyle
    }, 'DH/Ha'))), React.createElement('tbody', null, filteredRows.map(function (row, idx) {
      return React.createElement('tr', {
        key: row.refParcelle || row.parcelle,
        style: {
          background: idx % 2 === 0 ? C.surface : C.surface2
        }
      }, React.createElement('td', {
        style: tdFirstStyle,
        title: row.parcelle || row.refParcelle
      }, sbNom(row.parcelle || row.refParcelle, sbMap)), React.createElement('td', {
        style: tdStyle
      }, row.ferme || '—'), React.createElement('td', {
        style: tdStyle
      }, fmtHa(row.ha)), activeFamilles.map(function (f) {
        var cell = row.byFamille[f];
        var val = cell ? metric === 'cout' ? cell.cout : cell.jh : 0;
        if (!val || val === 0) return React.createElement('td', {
          key: f,
          style: tdDashStyle
        }, '—');
        return React.createElement('td', {
          key: f,
          style: tdStyle
        }, metric === 'cout' ? fmtDH(val) : fmtJH(val));
      }), React.createElement('td', {
        style: Object.assign({}, tdStyle, {
          fontWeight: 700
        })
      }, fmtDH(row.total.cout)), React.createElement('td', {
        style: tdStyle
      }, fmtDHPerHa(row.total.cout, row.ha)));
    }),
    // Ligne de total
    React.createElement('tr', {
      style: totalRowStyle
    }, React.createElement('td', {
      style: Object.assign({}, totalCellStyle, {
        textAlign: 'left'
      })
    }, 'TOTAL'), React.createElement('td', {
      style: totalCellStyle
    }, ''), React.createElement('td', {
      style: totalCellStyle
    }, ''), activeFamilles.map(function (f) {
      var cell = colTotals.byFamille[f];
      var val = cell ? metric === 'cout' ? cell.cout : cell.jh : 0;
      return React.createElement('td', {
        key: f,
        style: totalCellStyle
      }, val ? metric === 'cout' ? fmtDH(val) : fmtJH(val) : '—');
    }), React.createElement('td', {
      style: totalCellStyle
    }, fmtDH(colTotals.total.cout)), React.createElement('td', {
      style: totalCellStyle
    }, ''))))));
  }

  /* ------------------------------------------------------------------ */
  /* Sous-composant : Vue Par Variété / Quinzaine                        */
  /* ------------------------------------------------------------------ */
  function VarieteView(props) {
    var data = props.data;
    var farmFilter = props.farmFilter;
    var cultureFilter = props.cultureFilter;
    var sbMap = props.sbMap || {};
    var selectedParcelle = props.selectedParcelle;
    var setSelectedParcelle = props.setSelectedParcelle;
    var metric = props.metric;
    var setMetric = props.setMetric;

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
      return React.createElement('button', {
        key: 'export-' + cult,
        onClick: function () {
          exportCulture(cult, data, farmFilter, sbMap);
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
          cursor: 'pointer'
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-file-excel',
        style: {
          marginRight: '6px'
        }
      }), 'Export ' + cult);
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
    }, 'Total'))), React.createElement('tbody', null, familles.map(function (famille) {
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
        colSpan: periodes.length + 2,
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
        }, metric === 'cout' ? fmtDH(r.total.cout) : fmtJH(r.total.jh))));
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
      }, metric === 'cout' ? fmtDH(famTotal.total.cout) : fmtJH(famTotal.total.jh))));
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
    }, metric === 'cout' ? fmtDH(grandTotals.total.cout) : fmtJH(grandTotals.total.jh)))))));
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
      if (subTab === 'mo' || consoFetched) return;
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
      className: 'fa-solid fa-chart-bar',
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
    // Ligne 2 : Filtre culture (toujours visible)
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
    subTab === 'mo' ? view === 'ha' ? React.createElement(HaView, {
      data: data,
      farmFilter: farmFilter,
      cultureFilter: cultureFilter,
      sbMap: sbMap,
      metric: metric,
      setMetric: setMetric
    }) : React.createElement(VarieteView, {
      data: data,
      farmFilter: farmFilter,
      cultureFilter: cultureFilter,
      sbMap: sbMap,
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
})();
