/*
 * ParcellesReferentielTab.jsx — Parcelles & Référentiel MO
 *
 * Phase 1 : visualisation (source BR_Pointage + BR_Parcelle)
 * Phase 2 : référentiel SB éditable (nom + Ha par label BEE ONE)
 *
 * Édition : RH/DG uniquement. Save → POST /api/pointage-rh?action=sb-referentiel-save
 * Les Ha saisis ici alimentent l'Affectation Analytique (window.SB_PARCELLE_REF).
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var PRT_C = {
    berry: '#c0392b',
    green: '#1D9E75',
    blue: '#2563eb',
    amber: '#EF9F27',
    gray: '#888780',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    surface3: '#ebeae3',
    border: 'rgba(0,0,0,0.10)',
    text: '#1c1c1a',
    textSec: '#5f5e5a',
    textTer: '#8a8985'
  };
  var CULTURE_COLORS = {
    Framboise: {
      bg: '#fce4e4',
      text: '#c0392b'
    },
    Myrtille: {
      bg: '#dbeafe',
      text: '#1d4ed8'
    },
    Avocatier: {
      bg: '#d1fae5',
      text: '#065f46'
    }
  };
  function normCulture(cultureField, labelFallback) {
    var src = (cultureField || labelFallback || '').toUpperCase();
    if (!src) return 'Framboise';
    if (/MYRTILL|BLUEBERRY|CORINA|CASCADE|BREEZE/.test(src)) return 'Myrtille';
    if (/AVOCAT|AVOCADO|HAAS|BACON/.test(src)) return 'Avocatier';
    return 'Framboise';
  }
  function fmtDate(val) {
    if (!val) return '—';
    var s = String(val).slice(0, 10);
    var p = s.split('-');
    if (p.length !== 3) return s;
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  function fmtHa(val) {
    var n = parseFloat(val) || 0;
    if (n === 0) return '—';
    return n.toFixed(2) + ' Ha';
  }
  function PRT_CultureBadge(props) {
    var culture = props.culture || 'Framboise';
    var col = CULTURE_COLORS[culture] || {
      bg: '#f3f4f6',
      text: '#374151'
    };
    return React.createElement('span', {
      style: {
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        background: col.bg,
        color: col.text
      }
    }, culture);
  }
  function PRT_EditRow(props) {
    var r = props.row;
    var sbEntry = props.sbEntry;
    var onSaved = props.onSaved;
    var onCancel = props.onCancel;
    var _ha = useState(sbEntry ? String(sbEntry.ha || '') : '');
    var haVal = _ha[0];
    var setHaVal = _ha[1];
    var _nom = useState(sbEntry ? sbEntry.nom_sb || '' : '');
    var nomVal = _nom[0];
    var setNomVal = _nom[1];
    var _saving = useState(false);
    var saving = _saving[0];
    var setSaving = _saving[1];
    var _err = useState(null);
    var err = _err[0];
    var setErr = _err[1];
    function handleSave() {
      var haNum = parseFloat(haVal.replace(',', '.'));
      if (isNaN(haNum) || haNum < 0) {
        setErr('Ha invalide');
        return;
      }
      setSaving(true);
      setErr(null);
      fetch('/api/pointage-rh?action=sb-referentiel-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          label_bee_one: r.label,
          nom_sb: nomVal.trim(),
          ha: haNum
        })
      }).then(function (res) {
        return res.json();
      }).then(function (d) {
        if (!d.success) throw new Error(d.error || 'Erreur');
        // Mettre à jour le cache global SB_PARCELLE_REF
        if (window.SB_PARCELLE_REF) {
          var key = (r.label || '').toUpperCase().trim();
          window.SB_PARCELLE_REF[key] = {
            label_bee_one: r.label,
            nom_sb: nomVal.trim(),
            ha: haNum
          };
        }
        onSaved({
          label_bee_one: r.label,
          nom_sb: nomVal.trim(),
          ha: haNum
        });
      }).catch(function (e) {
        setErr(e.message);
        setSaving(false);
      });
    }
    var inputStyle = {
      border: '1px solid ' + PRT_C.border,
      borderRadius: 6,
      padding: '4px 8px',
      fontSize: 12,
      outline: 'none',
      width: '100%',
      boxSizing: 'border-box'
    };
    return React.createElement('tr', {
      style: {
        background: '#fffbf0'
      }
    }, React.createElement('td', {
      style: {
        padding: '8px 10px',
        fontSize: 11,
        color: PRT_C.textTer,
        fontFamily: 'monospace'
      }
    }, r.ref || '—'), React.createElement('td', {
      style: {
        padding: '8px 10px',
        fontSize: 12
      }
    }, React.createElement('input', {
      type: 'text',
      value: nomVal,
      placeholder: r.label,
      onChange: function (e) {
        setNomVal(e.target.value);
      },
      style: {
        ...inputStyle,
        maxWidth: 260
      }
    })), React.createElement('td', {
      style: {
        padding: '8px 10px'
      }
    }, React.createElement(PRT_CultureBadge, {
      culture: normCulture(r.culture, r.label)
    })), React.createElement('td', {
      style: {
        padding: '8px 10px',
        fontSize: 12,
        color: PRT_C.textSec
      }
    }, r.variete || '—'), React.createElement('td', {
      style: {
        padding: '8px 10px'
      }
    }, React.createElement('span', {
      style: {
        fontWeight: 600,
        fontSize: 12
      }
    }, r.ferme || '—')), React.createElement('td', {
      style: {
        padding: '8px 10px'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 4
      }
    }, React.createElement('input', {
      type: 'number',
      value: haVal,
      placeholder: fmtHa(r.sup) || '0.00',
      min: 0,
      step: 0.01,
      onChange: function (e) {
        setHaVal(e.target.value);
      },
      style: {
        ...inputStyle,
        width: 80,
        textAlign: 'right'
      }
    }), React.createElement('span', {
      style: {
        fontSize: 11,
        color: PRT_C.textTer
      }
    }, 'Ha'))), React.createElement('td', {
      style: {
        padding: '8px 10px',
        fontSize: 12,
        color: PRT_C.textSec
      }
    }, fmtDate(r.debut)), React.createElement('td', {
      style: {
        padding: '8px 10px'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        gap: 6,
        alignItems: 'center'
      }
    }, err && React.createElement('span', {
      style: {
        fontSize: 11,
        color: '#dc2626'
      }
    }, err), React.createElement('button', {
      onClick: handleSave,
      disabled: saving,
      style: {
        padding: '4px 12px',
        borderRadius: 6,
        border: 'none',
        background: PRT_C.green,
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        cursor: saving ? 'not-allowed' : 'pointer'
      }
    }, saving ? '…' : 'Sauver'), React.createElement('button', {
      onClick: onCancel,
      style: {
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid ' + PRT_C.border,
        background: PRT_C.surface,
        color: PRT_C.textSec,
        fontSize: 11,
        cursor: 'pointer'
      }
    }, 'Annuler'))));
  }
  function PRT_Table(props) {
    var rows = props.rows;
    var search = props.search;
    var sbMap = props.sbMap;
    var canEdit = props.canEdit;
    var onRowSaved = props.onRowSaved;
    var _editLabel = useState(null);
    var editLabel = _editLabel[0];
    var setEditLabel = _editLabel[1];
    var filtered = useMemo(function () {
      if (!search) return rows;
      var q = search.toUpperCase();
      return rows.filter(function (r) {
        return (r.label || '').toUpperCase().indexOf(q) !== -1 || (r.culture || '').toUpperCase().indexOf(q) !== -1 || (r.ferme || '').toUpperCase().indexOf(q) !== -1 || (r.variete || '').toUpperCase().indexOf(q) !== -1;
      });
    }, [rows, search]);
    if (filtered.length === 0) {
      return React.createElement('div', {
        style: {
          textAlign: 'center',
          padding: '32px 0',
          color: PRT_C.textTer,
          fontSize: 13
        }
      }, search ? 'Aucune parcelle pour "' + search + '"' : 'Aucune parcelle');
    }
    var thStyle = {
      textAlign: 'left',
      padding: '8px 10px',
      fontSize: 11,
      fontWeight: 700,
      color: PRT_C.textSec,
      borderBottom: '2px solid ' + PRT_C.border,
      whiteSpace: 'nowrap',
      background: PRT_C.surface2
    };
    var tdStyle = {
      padding: '8px 10px',
      fontSize: 12,
      color: PRT_C.text,
      borderBottom: '1px solid ' + PRT_C.border,
      verticalAlign: 'middle'
    };
    return React.createElement('div', {
      style: {
        overflowX: 'auto'
      }
    }, React.createElement('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        minWidth: 600
      }
    }, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', {
      style: thStyle
    }, 'Réf BEE ONE'), React.createElement('th', {
      style: thStyle
    }, 'Parcelle'), React.createElement('th', {
      style: thStyle
    }, 'Culture'), React.createElement('th', {
      style: thStyle
    }, 'Variété'), React.createElement('th', {
      style: thStyle
    }, 'Ferme'), React.createElement('th', {
      style: {
        ...thStyle,
        textAlign: 'right'
      }
    }, 'Ha'), React.createElement('th', {
      style: thStyle
    }, '1er pointage'), canEdit && React.createElement('th', {
      style: {
        ...thStyle,
        width: 110
      }
    }, ''))), React.createElement('tbody', null, filtered.map(function (r, i) {
      var culture = normCulture(r.culture, r.label);
      var sbKey = (r.label || '').toUpperCase().trim();
      var sbEntry = sbMap && sbMap[sbKey];
      var haDisplay = sbEntry && sbEntry.ha > 0 ? sbEntry.ha : r.sup;
      var nomDisplay = sbEntry && sbEntry.nom_sb ? sbEntry.nom_sb : r.label;
      var isCustom = sbEntry && (sbEntry.ha > 0 || sbEntry.nom_sb);
      if (editLabel === r.label) {
        return React.createElement(PRT_EditRow, {
          key: r.label,
          row: r,
          sbEntry: sbEntry || null,
          onSaved: function (saved) {
            setEditLabel(null);
            if (onRowSaved) onRowSaved(saved);
          },
          onCancel: function () {
            setEditLabel(null);
          }
        });
      }
      return React.createElement('tr', {
        key: (r.ref || '') + '|' + (r.label || '') + i,
        style: {
          background: i % 2 === 0 ? PRT_C.surface : PRT_C.surface2
        }
      }, React.createElement('td', {
        style: {
          ...tdStyle,
          color: PRT_C.textTer,
          fontSize: 11,
          fontFamily: 'monospace'
        }
      }, r.ref || '—'), React.createElement('td', {
        style: {
          ...tdStyle,
          fontWeight: 600,
          maxWidth: 280
        }
      }, nomDisplay, isCustom && React.createElement('span', {
        style: {
          marginLeft: 6,
          fontSize: 10,
          padding: '1px 5px',
          borderRadius: 6,
          background: '#e0f2fe',
          color: '#0369a1',
          fontWeight: 600,
          verticalAlign: 'middle'
        }
      }, 'SB')), React.createElement('td', {
        style: tdStyle
      }, React.createElement(PRT_CultureBadge, {
        culture: culture
      })), React.createElement('td', {
        style: {
          ...tdStyle,
          color: PRT_C.textSec
        }
      }, r.variete || '—'), React.createElement('td', {
        style: tdStyle
      }, React.createElement('span', {
        style: {
          fontWeight: 600
        }
      }, r.ferme || '—')), React.createElement('td', {
        style: {
          ...tdStyle,
          textAlign: 'right',
          fontFamily: 'monospace',
          fontSize: 12
        }
      }, fmtHa(haDisplay)), React.createElement('td', {
        style: {
          ...tdStyle,
          color: PRT_C.textSec
        }
      }, fmtDate(r.debut)), canEdit && React.createElement('td', {
        style: {
          ...tdStyle,
          textAlign: 'right'
        }
      }, React.createElement('button', {
        onClick: function () {
          setEditLabel(r.label);
        },
        style: {
          padding: '3px 10px',
          borderRadius: 6,
          border: '1px solid ' + PRT_C.border,
          background: PRT_C.surface,
          color: PRT_C.textSec,
          fontSize: 11,
          cursor: 'pointer'
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-pen-to-square',
        style: {
          marginRight: 4
        }
      }), 'Éditer')));
    }))));
  }
  function PRT_CampagneCard(props) {
    var label = props.label;
    var rows = props.rows;
    var accent = props.accent;
    var subtitle = props.subtitle;
    var sbMap = props.sbMap;
    var totalHa = rows.reduce(function (s, r) {
      var sbKey = (r.label || '').toUpperCase().trim();
      var sbEntry = sbMap && sbMap[sbKey];
      var ha = sbEntry && sbEntry.ha > 0 ? sbEntry.ha : parseFloat(r.sup) || 0;
      return s + ha;
    }, 0);
    var byCulture = {};
    rows.forEach(function (r) {
      var c = normCulture(r.culture, r.label);
      byCulture[c] = (byCulture[c] || 0) + 1;
    });
    return React.createElement('div', {
      style: {
        background: PRT_C.surface,
        border: '1px solid ' + PRT_C.border,
        borderRadius: 12,
        padding: '16px 20px',
        flex: '1 1 220px',
        minWidth: 200,
        borderTop: '3px solid ' + accent
      }
    }, React.createElement('div', {
      style: {
        fontSize: 13,
        fontWeight: 700,
        color: accent,
        marginBottom: 4
      }
    }, label), subtitle && React.createElement('div', {
      style: {
        fontSize: 11,
        color: PRT_C.textTer,
        marginBottom: 10
      }
    }, subtitle), React.createElement('div', {
      style: {
        fontSize: 26,
        fontWeight: 800,
        color: PRT_C.text,
        marginBottom: 4
      }
    }, rows.length, React.createElement('span', {
      style: {
        fontSize: 13,
        fontWeight: 400,
        color: PRT_C.textSec,
        marginLeft: 6
      }
    }, 'parcelles')), totalHa > 0 && React.createElement('div', {
      style: {
        fontSize: 12,
        color: PRT_C.textSec,
        marginBottom: 8
      }
    }, totalHa.toFixed(1) + ' Ha total'), React.createElement('div', {
      style: {
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap'
      }
    }, Object.entries(byCulture).map(function (e) {
      var col = CULTURE_COLORS[e[0]] || {
        bg: '#f3f4f6',
        text: '#374151'
      };
      return React.createElement('span', {
        key: e[0],
        style: {
          fontSize: 11,
          padding: '2px 8px',
          borderRadius: 8,
          background: col.bg,
          color: col.text,
          fontWeight: 600
        }
      }, e[0] + ' × ' + e[1]);
    })));
  }
  var PRT_FAMILLE_ICONS = {
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
  function MOReferentielView() {
    var _ops = useState(null);
    var opsData = _ops[0];
    var setOpsData = _ops[1];
    var _loading = useState(false);
    var loading = _loading[0];
    var setLoading = _loading[1];
    var _err = useState(null);
    var err = _err[0];
    var setErr = _err[1];
    var _loaded = useState(false);
    var loaded = _loaded[0];
    var setLoaded = _loaded[1];
    useEffect(function () {
      if (loaded) return;
      setLoading(true);
      setErr(null);
      fetch('/api/pointage-rh?action=referentiel-taches-list').then(function (r) {
        return r.json();
      }).then(function (d) {
        if (!d.success) throw new Error(d.error || 'Erreur API');
        setOpsData(d.ops || []);
        setLoaded(true);
      }).catch(function (e) {
        setErr(e.message);
      }).finally(function () {
        setLoading(false);
      });
    }, []);
    if (loading) {
      return React.createElement('div', {
        style: {
          textAlign: 'center',
          padding: 40,
          color: PRT_C.textTer
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-circle-notch fa-spin',
        style: {
          fontSize: 24
        }
      }));
    }
    if (err) {
      return React.createElement('div', {
        style: {
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 10,
          padding: '12px 16px',
          color: '#991b1b',
          fontSize: 13
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-circle-exclamation',
        style: {
          marginRight: 8
        }
      }), err);
    }
    if (!opsData) return null;

    // Group by groupe -> famille -> ops
    var grouped = {};
    var groupeOrder = [];
    opsData.forEach(function (op) {
      var g = op.groupe || 'Autre';
      var f = op.famille || 'Autre';
      if (!grouped[g]) {
        grouped[g] = {};
        groupeOrder.push(g);
      }
      if (!grouped[g][f]) grouped[g][f] = {
        code: op.code,
        ops: []
      };
      grouped[g][f].ops.push(op.operation);
    });

    // Dedupe groupeOrder (forEach may push duplicates)
    var seenGroupe = {};
    groupeOrder = groupeOrder.filter(function (g) {
      if (seenGroupe[g]) return false;
      seenGroupe[g] = true;
      return true;
    });
    var totalGroupes = groupeOrder.length;
    var totalFamilles = 0;
    var totalOps = opsData.length;
    groupeOrder.forEach(function (g) {
      totalFamilles += Object.keys(grouped[g]).length;
    });
    return React.createElement('div', null,
    // Totals banner
    React.createElement('div', {
      style: {
        fontSize: 12,
        color: PRT_C.textSec,
        marginBottom: 16,
        padding: '8px 12px',
        background: PRT_C.surface2,
        borderRadius: 8,
        display: 'inline-block'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-list-check',
      style: {
        marginRight: 6,
        color: PRT_C.berry
      }
    }), totalGroupes + ' groupes · ' + totalFamilles + ' familles · ' + totalOps + ' opérations'),
    // Groups
    groupeOrder.map(function (groupe) {
      var familles = grouped[groupe];
      var familleNames = Object.keys(familles);
      return React.createElement('div', {
        key: groupe,
        style: {
          marginBottom: 24
        }
      },
      // Groupe header
      React.createElement('div', {
        style: {
          background: PRT_C.surface3,
          padding: '8px 14px',
          borderRadius: 8,
          marginBottom: 10,
          fontWeight: 700,
          fontSize: 13,
          color: PRT_C.text,
          borderLeft: '3px solid ' + PRT_C.berry
        }
      }, groupe),
      // Familles
      familleNames.map(function (famille) {
        var entry = familles[famille];
        var icon = PRT_FAMILLE_ICONS[famille];
        return React.createElement('div', {
          key: famille,
          style: {
            marginLeft: 16,
            marginBottom: 12
          }
        },
        // Famille header
        React.createElement('div', {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 6
          }
        }, icon && React.createElement('i', {
          className: 'fa-solid ' + icon,
          style: {
            color: PRT_C.berry,
            fontSize: 13,
            width: 16,
            textAlign: 'center'
          }
        }), React.createElement('span', {
          style: {
            fontWeight: 600,
            fontSize: 12,
            color: PRT_C.text
          }
        }, famille), React.createElement('span', {
          style: {
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 6,
            background: '#e0f2fe',
            color: '#0369a1',
            fontWeight: 700,
            fontFamily: 'monospace'
          }
        }, entry.code)),
        // Operations list
        React.createElement('ul', {
          style: {
            margin: 0,
            paddingLeft: 32,
            listStyle: 'disc'
          }
        }, entry.ops.map(function (op, idx) {
          return React.createElement('li', {
            key: idx,
            style: {
              fontSize: 12,
              color: PRT_C.textSec,
              marginBottom: 2
            }
          }, op);
        })));
      }));
    }));
  }
  function ParcellesReferentielTab(props) {
    var userRole = (props.userRole || '').toLowerCase();
    var canEdit = userRole === 'dg' || userRole === 'rh';
    var _view = useState('parcelles');
    var view = _view[0];
    var setView = _view[1];
    var _data = useState(null);
    var data = _data[0];
    var setData = _data[1];
    var _load = useState(false);
    var loading = _load[0];
    var setLoading = _load[1];
    var _err = useState(null);
    var error = _err[0];
    var setError = _err[1];
    var _search = useState('');
    var search = _search[0];
    var setSearch = _search[1];
    var _camp = useState('2026/2027');
    var selectedCamp = _camp[0];
    var setSelectedCamp = _camp[1];
    var _sbMap = useState(window.SB_PARCELLE_REF || {});
    var sbMap = _sbMap[0];
    var setSbMap = _sbMap[1];
    useEffect(function () {
      setLoading(true);
      setError(null);
      Promise.all([fetch('/api/pointage-rh?action=parcelles-campagne-list').then(function (r) {
        return r.json();
      }), fetch('/api/pointage-rh?action=sb-referentiel-list').then(function (r) {
        return r.json();
      })]).then(function (results) {
        var d = results[0];
        var sb = results[1];
        if (!d.success) throw new Error(d.error || 'Erreur API');
        setData(d);
        var map = {};
        if (sb.success) {
          (sb.parcelles || []).forEach(function (p) {
            map[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
          });
          window.SB_PARCELLE_REF = map;
        }
        setSbMap(map);
      }).catch(function (e) {
        setError(e.message);
      }).finally(function () {
        setLoading(false);
      });
    }, []);
    function handleRowSaved(saved) {
      setSbMap(function (prev) {
        var next = Object.assign({}, prev);
        next[(saved.label_bee_one || '').toUpperCase().trim()] = saved;
        window.SB_PARCELLE_REF = next;
        return next;
      });
    }
    var rows2627 = data && data.campagne_courante || [];
    var rowsPrev = data && data.campagne_precedente || [];
    var currentRows = selectedCamp === '2026/2027' ? rows2627 : rowsPrev;
    return React.createElement('div', {
      style: {
        padding: '20px 24px',
        maxWidth: 1200
      }
    }, React.createElement('div', {
      style: {
        marginBottom: 20
      }
    }, React.createElement('h2', {
      style: {
        fontSize: 20,
        fontWeight: 800,
        color: PRT_C.text,
        margin: 0
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-map-location-dot',
      style: {
        marginRight: 10,
        color: PRT_C.berry
      }
    }), 'Parcelles & Référentiel MO'), React.createElement('p', {
      style: {
        margin: '4px 0 0',
        fontSize: 12,
        color: PRT_C.textTer
      }
    }, 'Surfaces et noms Smart Berry — éditables par RH/DG, propagés à l\'Affectation Analytique.')),
    // View toggle buttons
    React.createElement('div', {
      style: {
        display: 'flex',
        gap: 8,
        marginBottom: 16
      }
    }, React.createElement('button', {
      className: 'chip c-green' + (view === 'parcelles' ? ' active' : ''),
      onClick: function () {
        setView('parcelles');
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-map',
      style: {
        marginRight: 6
      }
    }), 'Parcelles'), React.createElement('button', {
      className: 'chip c-berry' + (view === 'mo' ? ' active' : ''),
      onClick: function () {
        setView('mo');
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-list-check',
      style: {
        marginRight: 6
      }
    }), 'Référentiel MO')),
    // MO view
    view === 'mo' && React.createElement(MOReferentielView, null),
    // Parcelles view
    view === 'parcelles' && React.createElement(React.Fragment, null, loading && React.createElement('div', {
      style: {
        textAlign: 'center',
        padding: 40,
        color: PRT_C.textTer
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-notch fa-spin',
      style: {
        fontSize: 24
      }
    })), error && React.createElement('div', {
      style: {
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: 10,
        padding: '12px 16px',
        color: '#991b1b',
        fontSize: 13
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-exclamation',
      style: {
        marginRight: 8
      }
    }), error), !loading && !error && data && React.createElement(React.Fragment, null, React.createElement('div', {
      style: {
        display: 'flex',
        gap: 16,
        marginBottom: 24,
        flexWrap: 'wrap'
      }
    }, React.createElement(PRT_CampagneCard, {
      label: 'Campagne 2026/2027',
      subtitle: 'Parcelles avec pointage depuis le 01/07/2026',
      rows: rows2627,
      accent: PRT_C.green,
      sbMap: sbMap
    }), React.createElement(PRT_CampagneCard, {
      label: 'Campagne 2025/2026',
      subtitle: 'Parcelles sans pointage depuis le 01/07/2026',
      rows: rowsPrev,
      accent: PRT_C.amber,
      sbMap: sbMap
    })), React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        gap: 6
      }
    }, [['2026/2027', rows2627, PRT_C.green], ['2025/2026', rowsPrev, PRT_C.amber]].map(function (e) {
      var camp = e[0];
      var rws = e[1];
      var color = e[2];
      var active = selectedCamp === camp;
      return React.createElement('button', {
        key: camp,
        onClick: function () {
          setSelectedCamp(camp);
        },
        style: {
          padding: '6px 16px',
          borderRadius: 8,
          border: '1px solid ' + (active ? color : PRT_C.border),
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          background: active ? color : PRT_C.surface,
          color: active ? '#fff' : PRT_C.textSec
        }
      }, camp + ' (' + rws.length + ')');
    })), React.createElement('div', {
      style: {
        position: 'relative',
        flex: '1 1 200px',
        maxWidth: 320
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-magnifying-glass',
      style: {
        position: 'absolute',
        left: 10,
        top: '50%',
        transform: 'translateY(-50%)',
        color: PRT_C.textTer,
        fontSize: 12
      }
    }), React.createElement('input', {
      type: 'text',
      placeholder: 'Parcelle, variété, ferme…',
      value: search,
      onChange: function (e) {
        setSearch(e.target.value);
      },
      style: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '7px 10px 7px 30px',
        borderRadius: 8,
        border: '1px solid ' + PRT_C.border,
        fontSize: 12,
        outline: 'none'
      }
    })), canEdit && React.createElement('div', {
      style: {
        fontSize: 11,
        color: PRT_C.textTer
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-pen-to-square',
      style: {
        marginRight: 4,
        color: PRT_C.green
      }
    }), 'Cliquez Éditer pour saisir le Ha réel et le nom SB')), React.createElement('div', {
      style: {
        background: PRT_C.surface,
        border: '1px solid ' + PRT_C.border,
        borderRadius: 12,
        overflow: 'hidden'
      }
    }, React.createElement(PRT_Table, {
      rows: currentRows,
      search: search,
      sbMap: sbMap,
      canEdit: canEdit,
      onRowSaved: handleRowSaved
    })), React.createElement('div', {
      style: {
        marginTop: 12,
        fontSize: 11,
        color: PRT_C.textTer
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-info',
      style: {
        marginRight: 4
      }
    }), 'Ha saisis ici → propagés immédiatement à l\'Affectation Analytique (sans rechargement). ', canEdit ? 'Badge "SB" = surface personnalisée.' : 'Saisie réservée aux profils RH/DG.'))));
  }
  window.ParcellesReferentielTab = ParcellesReferentielTab;
})();
