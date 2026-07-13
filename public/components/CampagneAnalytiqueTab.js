/*
 * CampagneAnalytiqueTab.jsx — Campagne analytique (Affectation par Ha + Par Variété)
 *
 * Remplace CampagneTab dans l'onglet "Campagne".
 * 2 vues toggleables :
 *   - "Affectation par Ha"  : tableau parcelles × familles MO
 *   - "Par Variété"         : pivot quinzaines × opérations pour une parcelle
 *
 * Source : GET /api/pointage-rh?action=campagne-analytique-detail
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
  function fmtDHPerHa(cout, ha) {
    if (!ha || ha === 0 || !cout) return '—';
    return Math.round(cout / ha).toLocaleString('fr-MA');
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
  /* Sous-composant : Vue Affectation par Ha                              */
  /* ------------------------------------------------------------------ */
  function HaView(props) {
    var data = props.data;
    var farmFilter = props.farmFilter;
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

    // Filtrer par ferme
    var filteredRows = useMemo(function () {
      if (!farmFilter) return rows;
      return rows.filter(function (r) {
        return r.ferme === farmFilter;
      });
    }, [rows, farmFilter]);

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
        overflowX: 'auto'
      }
    }, React.createElement('table', {
      style: {
        width: '100%',
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
        style: tdFirstStyle
      }, row.parcelle || row.refParcelle), React.createElement('td', {
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
    var selectedParcelle = props.selectedParcelle;
    var setSelectedParcelle = props.setSelectedParcelle;
    var metric = props.metric;
    var setMetric = props.setMetric;

    // Liste distincte des parcelles
    var parcelles = useMemo(function () {
      var seen = {};
      var list = [];
      (data.rows || []).forEach(function (r) {
        var key = r.parcelle || r.refParcelle;
        if (key && !seen[key]) {
          seen[key] = true;
          list.push(key);
        }
      });
      return list.sort();
    }, [data]);

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
        key: p,
        value: p
      }, p);
    })), React.createElement('span', {
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
        overflowX: 'auto'
      }
    }, React.createElement('table', {
      style: {
        width: '100%',
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
  /* Composant principal                                                  */
  /* ------------------------------------------------------------------ */
  function CampagneAnalytiqueTab(props) {
    var farmFilter = props.farmFilter || null;
    var _view = useState('ha');
    var view = _view[0];
    var setView = _view[1];
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

    // Métrique partagée entre les 2 vues
    var _metric = useState('cout');
    var metric = _metric[0];
    var setMetric = _metric[1];
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
    return React.createElement('div', {
      style: containerStyle
    },
    // En-tête
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
        flexWrap: 'wrap',
        gap: '12px'
      }
    }, React.createElement('div', null, React.createElement('h2', {
      style: {
        margin: 0,
        fontSize: '18px',
        fontWeight: 700,
        color: C.text
      }
    }, 'Campagne analytique MO'), React.createElement('p', {
      style: {
        margin: '2px 0 0',
        fontSize: '13px',
        color: C.textSec
      }
    }, 'Campagne ' + data.campagne + ' — ' + (data.rows || []).length + ' lignes')),
    // Toggle vue
    React.createElement('div', {
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
    }), 'Par Variété / Quinzaine'))),
    // Contenu
    view === 'ha' ? React.createElement(HaView, {
      data: data,
      farmFilter: farmFilter,
      metric: metric,
      setMetric: setMetric
    }) : React.createElement(VarieteView, {
      data: data,
      selectedParcelle: selectedParcelle,
      setSelectedParcelle: setSelectedParcelle,
      metric: metric,
      setMetric: setMetric
    }));
  }
  window.CampagneAnalytiqueTab = CampagneAnalytiqueTab;
})();
