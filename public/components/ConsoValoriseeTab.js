/*
 * ConsoValoriseeTab.jsx — Onglet « Engrais & Pesticides » : état CONSOMMATION
 * par parcelle / Ha / famille, VALORISÉ au PMP grand livre
 * (articles_catalog.prix_pmp), depuis le 01/07/2025.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.ConsoValoriseeTab) afin d'éviter toute collision top-level avec
 * app.jsx (mémoire projet : collisions top-level => crash boot React #200).
 * Tous les identifiants internes sont préfixés CVT_ par prudence.
 *
 * ACCÈS : réservé DG / Finance / Chef de Ferme. La VRAIE barrière est backend
 * (action conso-valorisee : 403 si non autorisé, filtre ferme IMPOSÉ serveur
 * pour un Chef). Le frontend ne fait que masquer l'onglet par confort.
 *
 * LECTURE SEULE : aucune écriture Firestore. Lit l'endpoint Cloud Function
 * GET /api/stock?action=conso-valorisee (idToken Firebase en Bearer), qui agrège
 * sql_mirror_consommation (>=2025-07-01) valorisé au PMP catalogue. Filtres :
 * ?since= (période), ?culture=, ?ferme= (DG/Finance seulement ; ignoré pour Chef).
 *
 * PÉRIMÈTRE (bandeau) : consommation SAISIE uniquement (plancher). Coût/Ha = plancher.
 *
 * Props :
 *   - getAlias       : (parcelle) => libellé d'affichage (optionnel)
 *   - currentProfile : profileId courant ('dg' | 'finance' | 'chef_f1' | …)
 *   - fermesDispo    : liste des fermes pour le sélecteur DG/Finance
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var CVT_C = {
    berry: 'var(--berry, #8e2c4d)',
    textPrimary: '#1c1c1a',
    textSecondary: '#5f5e5a',
    textTertiary: '#8a8985',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    surface3: '#ebeae3',
    border: 'rgba(0,0,0,0.12)',
    green: '#1D9E75',
    red: '#E24B4A',
    amber: '#EF9F27',
    gray: '#888780'
  };

  // Format DH (entier, séparateur d'espace), '—' si null/0.
  function CVT_dh(n) {
    if (n == null || !isFinite(n)) return '—';
    var v = Math.round(n);
    return v.toLocaleString('fr-FR') + ' DH';
  }
  function CVT_num(n, dec) {
    if (n == null || !isFinite(n)) return '—';
    var d = dec == null ? 0 : dec;
    return n.toLocaleString('fr-FR', {
      minimumFractionDigits: d,
      maximumFractionDigits: d
    });
  }
  function CVT_isChef(profile) {
    return typeof profile === 'string' && profile.indexOf('chef_') === 0;
  }

  // Appel LECTURE seule via Cloud Function /api/stock. idToken Firebase en Bearer.
  // Filtres optionnels passés en query : since, culture, ferme.
  function CVT_fetch(filters) {
    var f = filters || {};
    var user = firebase.auth().currentUser;
    if (!user) return Promise.reject(new Error('Non authentifié'));
    var qs = ['action=conso-valorisee'];
    if (f.since) qs.push('since=' + encodeURIComponent(f.since));
    if (f.culture) qs.push('culture=' + encodeURIComponent(f.culture));
    if (f.ferme && f.ferme !== 'all') qs.push('ferme=' + encodeURIComponent(f.ferme));
    return user.getIdToken().then(function (token) {
      return fetch('/api/stock?' + qs.join('&'), {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token
        }
      });
    }).then(function (resp) {
      return resp.json().catch(function () {
        return {
          success: false,
          error: 'Réponse serveur invalide'
        };
      });
    }).then(function (json) {
      if (!json || !json.success) {
        throw new Error(json && json.error || 'Échec de la requête');
      }
      return json;
    });
  }

  // Bandeau OBLIGATOIRE : périmètre saisie + N articles non valorisés.
  function CVT_Bandeau(props) {
    var nbNonVal = props.nbNonVal || 0;
    return React.createElement('div', {
      style: {
        background: '#fffbeb',
        border: '1.5px solid #fde68a',
        borderRadius: 10,
        padding: '12px 16px',
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.5,
        color: '#7a5a10'
      }
    }, React.createElement('div', {
      style: {
        fontWeight: 700,
        marginBottom: 4
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-info',
      style: {
        marginRight: 8
      }
    }), 'Périmètre : consommation SAISIE.'), React.createElement('div', null, 'Coût/Ha = ', React.createElement('strong', null, 'PLANCHER'), ' — hors sorties magasin non rapprochées et ', React.createElement('strong', null, nbNonVal + ' article' + (nbNonVal > 1 ? 's' : '') + ' non valorisé' + (nbNonVal > 1 ? 's' : '')), '.'));
  }

  // Tableau des lignes article d'une famille (engrais ou pesticide) — popup détail.
  function CVT_LignesTable(props) {
    var lignes = props.lignes || [];
    if (!lignes.length) return null;
    var th = {
      textAlign: 'left',
      padding: '4px 8px',
      fontSize: 11,
      color: CVT_C.textTertiary,
      fontWeight: 600,
      textTransform: 'uppercase'
    };
    var thR = Object.assign({}, th, {
      textAlign: 'right'
    });
    var td = {
      padding: '4px 8px',
      fontSize: 12.5,
      color: CVT_C.textPrimary,
      borderTop: '1px solid ' + CVT_C.border
    };
    var tdR = Object.assign({}, td, {
      textAlign: 'right'
    });
    var sousTotal = 0;
    lignes.forEach(function (l) {
      sousTotal += l.cout_ligne || 0;
    });
    return React.createElement('div', {
      style: {
        marginBottom: 14
      }
    }, React.createElement('div', {
      style: {
        fontWeight: 700,
        fontSize: 12.5,
        color: props.color,
        marginBottom: 4
      }
    }, React.createElement('i', {
      className: props.icon,
      style: {
        marginRight: 6
      }
    }), props.titre), React.createElement('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse'
      }
    }, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', {
      style: th
    }, 'Article'), React.createElement('th', {
      style: thR
    }, 'Qté'), React.createElement('th', {
      style: th
    }, 'Unité'), React.createElement('th', {
      style: thR
    }, 'PMP'), React.createElement('th', {
      style: thR
    }, 'Coût ligne'), React.createElement('th', {
      style: th
    }, 'Source prix'))), React.createElement('tbody', null, lignes.map(function (l, i) {
      var nonVal = !l.valorise;
      return React.createElement('tr', {
        key: i,
        style: nonVal ? {
          background: '#fafafa'
        } : null
      }, React.createElement('td', {
        style: td
      }, l.article, nonVal ? React.createElement('span', {
        style: {
          color: CVT_C.amber,
          fontSize: 11,
          marginLeft: 6
        }
      }, '(non valorisé)') : null), React.createElement('td', {
        style: tdR
      }, CVT_num(l.quantite, 1)), React.createElement('td', {
        style: td
      }, l.unite || '—'), React.createElement('td', {
        style: tdR
      }, nonVal ? '—' : CVT_num(l.pmp, 2)), React.createElement('td', {
        style: Object.assign({}, tdR, {
          fontWeight: nonVal ? 400 : 600,
          color: nonVal ? CVT_C.textTertiary : CVT_C.textPrimary
        })
      }, nonVal ? '—' : CVT_dh(l.cout_ligne)), React.createElement('td', {
        style: Object.assign({}, td, {
          color: CVT_C.textTertiary,
          fontSize: 11
        })
      }, l.source_prix || '—'));
    }), React.createElement('tr', {
      key: 'st'
    }, React.createElement('td', {
      style: Object.assign({}, td, {
        fontWeight: 700,
        borderTop: '2px solid ' + CVT_C.border
      })
    }, 'Sous-total ' + props.famille), React.createElement('td', {
      style: Object.assign({}, tdR, {
        borderTop: '2px solid ' + CVT_C.border
      })
    }), React.createElement('td', {
      style: Object.assign({}, td, {
        borderTop: '2px solid ' + CVT_C.border
      })
    }), React.createElement('td', {
      style: Object.assign({}, tdR, {
        borderTop: '2px solid ' + CVT_C.border
      })
    }), React.createElement('td', {
      style: Object.assign({}, tdR, {
        fontWeight: 800,
        color: props.color,
        borderTop: '2px solid ' + CVT_C.border
      })
    }, CVT_dh(sousTotal)), React.createElement('td', {
      style: Object.assign({}, td, {
        borderTop: '2px solid ' + CVT_C.border
      })
    })))));
  }

  // POPUP détail d'une parcelle : engrais d'abord, puis pesticides.
  function CVT_DetailPopup(props) {
    var p = props.parcelle;
    var getAlias = props.getAlias;
    if (!p) return null;
    var nom = getAlias && getAlias(p.parcelle) || p.parcelle;
    return React.createElement('div', {
      onClick: props.onClose,
      style: {
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 16px',
        overflowY: 'auto'
      }
    }, React.createElement('div', {
      onClick: function (e) {
        e.stopPropagation();
      },
      style: {
        background: CVT_C.surface,
        borderRadius: 14,
        padding: 20,
        maxWidth: 760,
        width: '100%',
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 4
      }
    }, React.createElement('div', null, React.createElement('span', {
      style: {
        fontWeight: 800,
        fontSize: 18,
        color: CVT_C.berry
      }
    }, nom), React.createElement('span', {
      style: {
        fontSize: 12.5,
        color: CVT_C.textTertiary,
        marginLeft: 10
      }
    }, (p.culture || '—') + ' · ' + (p.ferme || '—') + ' · ' + (p.sup_ha != null ? CVT_num(p.sup_ha, 2) + ' Ha' : 'surface inconnue'))), React.createElement('button', {
      onClick: props.onClose,
      style: {
        border: 'none',
        background: 'transparent',
        fontSize: 22,
        cursor: 'pointer',
        color: CVT_C.textTertiary,
        lineHeight: 1
      }
    }, '×')), React.createElement('div', {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 14,
        margin: '10px 0 16px',
        padding: '8px 0',
        borderTop: '1px solid ' + CVT_C.border,
        borderBottom: '1px solid ' + CVT_C.border
      }
    }, React.createElement('div', null, React.createElement('div', {
      style: {
        fontWeight: 700,
        fontSize: 15
      }
    }, CVT_dh(p.cout_ha_total)), React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: CVT_C.textTertiary,
        textTransform: 'uppercase'
      }
    }, 'Coût total/Ha')), React.createElement('div', null, React.createElement('div', {
      style: {
        fontWeight: 700,
        fontSize: 15,
        color: CVT_C.green
      }
    }, CVT_dh(p.cout_ha_engrais)), React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: CVT_C.textTertiary,
        textTransform: 'uppercase'
      }
    }, 'Engrais/Ha')), React.createElement('div', null, React.createElement('div', {
      style: {
        fontWeight: 700,
        fontSize: 15,
        color: CVT_C.red
      }
    }, CVT_dh(p.cout_ha_pest)), React.createElement('div', {
      style: {
        fontSize: 10.5,
        color: CVT_C.textTertiary,
        textTransform: 'uppercase'
      }
    }, 'Pesticide/Ha'))),
    // ENGRAIS d'abord, puis PESTICIDES.
    CVT_LignesTable({
      lignes: p.engrais,
      titre: 'Engrais — ' + CVT_dh(p.total_engrais_mad),
      famille: 'engrais',
      icon: 'fa-solid fa-flask',
      color: CVT_C.green
    }), CVT_LignesTable({
      lignes: p.pesticides,
      titre: 'Pesticides — ' + CVT_dh(p.total_pest_mad),
      famille: 'pesticides',
      icon: 'fa-solid fa-bug',
      color: CVT_C.red
    }), p.autres && p.autres.length ? CVT_LignesTable({
      lignes: p.autres,
      titre: 'Autres — ' + CVT_dh(p.total_autre_mad),
      famille: 'autres',
      icon: 'fa-solid fa-box',
      color: CVT_C.gray
    }) : null));
  }

  // Sous-totaux par ferme/culture.
  function CVT_SousTotaux(props) {
    var rows = props.rows || [];
    var labelKey = props.labelKey;
    if (!rows.length) return React.createElement('div', {
      style: {
        color: CVT_C.textTertiary,
        padding: 16
      }
    }, 'Aucune donnée.');
    var th = {
      textAlign: 'left',
      padding: '6px 8px',
      fontSize: 11,
      color: CVT_C.textTertiary,
      fontWeight: 600,
      textTransform: 'uppercase'
    };
    var thR = Object.assign({}, th, {
      textAlign: 'right'
    });
    var td = {
      padding: '6px 8px',
      fontSize: 13,
      color: CVT_C.textPrimary,
      borderTop: '1px solid ' + CVT_C.border
    };
    var tdR = Object.assign({}, td, {
      textAlign: 'right'
    });
    return React.createElement('div', {
      style: {
        background: CVT_C.surface,
        border: '1px solid ' + CVT_C.border,
        borderRadius: 12,
        padding: 16,
        marginBottom: 14,
        overflowX: 'auto'
      }
    }, React.createElement('div', {
      style: {
        fontWeight: 800,
        fontSize: 15,
        color: CVT_C.berry,
        marginBottom: 8
      }
    }, props.titre), React.createElement('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        minWidth: 560
      }
    }, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', {
      style: th
    }, props.colLabel), React.createElement('th', {
      style: thR
    }, 'Surface'), React.createElement('th', {
      style: thR
    }, 'Engrais'), React.createElement('th', {
      style: thR
    }, 'Pesticide'), React.createElement('th', {
      style: thR
    }, 'Total'), React.createElement('th', {
      style: thR
    }, 'Coût/Ha'))), React.createElement('tbody', null, rows.map(function (r, i) {
      return React.createElement('tr', {
        key: i
      }, React.createElement('td', {
        style: td
      }, r[labelKey] || '—'), React.createElement('td', {
        style: tdR
      }, r.sup_ha != null ? CVT_num(r.sup_ha, 2) + ' Ha' : '—'), React.createElement('td', {
        style: tdR
      }, CVT_dh(r.total_engrais_mad)), React.createElement('td', {
        style: tdR
      }, CVT_dh(r.total_pest_mad)), React.createElement('td', {
        style: Object.assign({}, tdR, {
          fontWeight: 700
        })
      }, CVT_dh(r.total_mad)), React.createElement('td', {
        style: tdR
      }, r.cout_ha_total != null ? CVT_dh(r.cout_ha_total) : '—'));
    }))));
  }

  // VUE SYNTHÈSE : 1 ligne / parcelle, triable.
  function CVT_SyntheseTable(props) {
    var parcelles = props.parcelles || [];
    var getAlias = props.getAlias;
    var sortKey = props.sortKey;
    var sortDir = props.sortDir;
    var onSort = props.onSort;
    var onClickParcelle = props.onClickParcelle;
    var cols = [{
      key: 'parcelle',
      label: 'Parcelle',
      align: 'left'
    }, {
      key: 'culture',
      label: 'Culture',
      align: 'left'
    }, {
      key: 'sup_ha',
      label: 'Surface Ha',
      align: 'right'
    }, {
      key: 'total_engrais_mad',
      label: 'Engrais MAD',
      align: 'right'
    }, {
      key: 'cout_ha_engrais',
      label: 'Engrais/Ha',
      align: 'right'
    }, {
      key: 'total_pest_mad',
      label: 'Pesticide MAD',
      align: 'right'
    }, {
      key: 'cout_ha_pest',
      label: 'Pesticide/Ha',
      align: 'right'
    }, {
      key: 'cout_ha_total',
      label: 'Total/Ha',
      align: 'right'
    }];
    var th = {
      padding: '7px 8px',
      fontSize: 11,
      color: CVT_C.textTertiary,
      fontWeight: 700,
      textTransform: 'uppercase',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      userSelect: 'none'
    };
    var td = {
      padding: '7px 8px',
      fontSize: 13,
      color: CVT_C.textPrimary,
      borderTop: '1px solid ' + CVT_C.border
    };
    if (!parcelles.length) {
      return React.createElement('div', {
        style: {
          color: CVT_C.textTertiary,
          padding: 24,
          textAlign: 'center'
        }
      }, 'Aucune parcelle dans ce périmètre.');
    }
    return React.createElement('div', {
      style: {
        background: CVT_C.surface,
        border: '1px solid ' + CVT_C.border,
        borderRadius: 12,
        padding: 8,
        overflowX: 'auto'
      }
    }, React.createElement('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        minWidth: 760
      }
    }, React.createElement('thead', null, React.createElement('tr', null, cols.map(function (c) {
      var arrow = sortKey === c.key ? sortDir === 'asc' ? ' ▲' : ' ▼' : '';
      return React.createElement('th', {
        key: c.key,
        onClick: function () {
          onSort(c.key);
        },
        style: Object.assign({}, th, {
          textAlign: c.align
        })
      }, c.label + arrow);
    }))), React.createElement('tbody', null, parcelles.map(function (p, i) {
      var nom = getAlias && getAlias(p.parcelle) || p.parcelle;
      return React.createElement('tr', {
        key: i,
        onClick: function () {
          onClickParcelle(p);
        },
        style: {
          cursor: 'pointer'
        },
        onMouseEnter: function (e) {
          e.currentTarget.style.background = CVT_C.surface2;
        },
        onMouseLeave: function (e) {
          e.currentTarget.style.background = 'transparent';
        }
      }, React.createElement('td', {
        style: Object.assign({}, td, {
          fontWeight: 700,
          color: CVT_C.berry
        })
      }, nom, p.articles_non_valorises && p.articles_non_valorises.length ? React.createElement('span', {
        title: p.articles_non_valorises.length + ' article(s) non valorisé(s)',
        style: {
          color: CVT_C.amber,
          fontSize: 11,
          marginLeft: 6
        }
      }, '⚠') : null), React.createElement('td', {
        style: td
      }, p.culture || '—'), React.createElement('td', {
        style: Object.assign({}, td, {
          textAlign: 'right'
        })
      }, p.sup_ha != null ? CVT_num(p.sup_ha, 2) : '—'), React.createElement('td', {
        style: Object.assign({}, td, {
          textAlign: 'right'
        })
      }, CVT_dh(p.total_engrais_mad)), React.createElement('td', {
        style: Object.assign({}, td, {
          textAlign: 'right',
          color: CVT_C.green
        })
      }, CVT_dh(p.cout_ha_engrais)), React.createElement('td', {
        style: Object.assign({}, td, {
          textAlign: 'right'
        })
      }, CVT_dh(p.total_pest_mad)), React.createElement('td', {
        style: Object.assign({}, td, {
          textAlign: 'right',
          color: CVT_C.red
        })
      }, CVT_dh(p.cout_ha_pest)), React.createElement('td', {
        style: Object.assign({}, td, {
          textAlign: 'right',
          fontWeight: 800
        })
      }, CVT_dh(p.cout_ha_total)));
    }))));
  }

  // EXPORT EXCEL : 2 feuilles (Synthèse parcelles + Détail lignes valorisé PMP).
  // Respecte le périmètre du rôle (n'exporte que ce que le backend a renvoyé).
  function CVT_exportExcel(d) {
    var parcelles = d && d.parcelles || [];
    var perim = d && d.perimetre_ferme || 'all';

    // Feuille 1 : synthèse parcelles.
    var synthHeader = ['Parcelle', 'Culture', 'Ferme', 'Surface (Ha)', 'Coût engrais (MAD)', 'Coût engrais/Ha', 'Coût pesticide (MAD)', 'Coût pesticide/Ha', 'Coût total (MAD)', 'Coût total/Ha', 'Articles non valorisés'];
    var synthRows = [synthHeader];
    parcelles.forEach(function (p) {
      synthRows.push([p.parcelle, p.culture || '', p.ferme || '', p.sup_ha != null ? p.sup_ha : '', p.total_engrais_mad || 0, p.cout_ha_engrais != null ? p.cout_ha_engrais : '', p.total_pest_mad || 0, p.cout_ha_pest != null ? p.cout_ha_pest : '', p.total_mad || 0, p.cout_ha_total != null ? p.cout_ha_total : '', (p.articles_non_valorises || []).length]);
    });

    // Feuille 2 : détail lignes valorisé PMP (engrais puis pesticides puis autres).
    var detHeader = ['Parcelle', 'Culture', 'Ferme', 'Famille', 'Article', 'Quantité', 'Unité', 'PMP', 'Coût ligne (MAD)', 'Source prix', 'Valorisé'];
    var detRows = [detHeader];
    parcelles.forEach(function (p) {
      var fams = [['engrais', p.engrais], ['pesticide', p.pesticides], ['autre', p.autres]];
      fams.forEach(function (pair) {
        (pair[1] || []).forEach(function (l) {
          detRows.push([p.parcelle, p.culture || '', p.ferme || '', pair[0], l.article, l.quantite || 0, l.unite || '', l.valorise ? l.pmp : '', l.valorise ? l.cout_ligne : 0, l.source_prix || '', l.valorise ? 'oui' : 'non']);
        });
      });
    });
    if (window.XLSX) {
      var wb = window.XLSX.utils.book_new();
      var ws1 = window.XLSX.utils.aoa_to_sheet(synthRows);
      var ws2 = window.XLSX.utils.aoa_to_sheet(detRows);
      window.XLSX.utils.book_append_sheet(wb, ws1, 'Synthèse parcelles');
      window.XLSX.utils.book_append_sheet(wb, ws2, 'Détail lignes PMP');
      window.XLSX.writeFile(wb, 'Engrais_Pesticides_' + perim + '_' + new Date().toISOString().slice(0, 10) + '.xlsx');
      return;
    }
    // Fallback CSV (feuille synthèse) si SheetJS absent.
    var csv = synthRows.map(function (r) {
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
    a.download = 'Engrais_Pesticides_' + perim + '_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function ConsoValoriseeTab(props) {
    var getAlias = props.getAlias;
    var currentProfile = props.currentProfile || '';
    var fermesDispo = props.fermesDispo || ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier'];
    var isChef = CVT_isChef(currentProfile);
    var canFilterFerme = currentProfile === 'dg' || currentProfile === 'finance';
    var st = useState({
      loading: true,
      error: null,
      data: null
    });
    var state = st[0];
    var setState = st[1];
    var viewSt = useState('synthese');
    var view = viewSt[0];
    var setView = viewSt[1];
    var popupSt = useState(null);
    var popup = popupSt[0];
    var setPopup = popupSt[1];

    // Filtres (since défaut >= 01/07/2025 ; ferme seulement DG/Finance).
    var sinceSt = useState('2025-07-01');
    var since = sinceSt[0];
    var setSince = sinceSt[1];
    var fermeSt = useState('all');
    var ferme = fermeSt[0];
    var setFerme = fermeSt[1];
    var cultureSt = useState('');
    var culture = cultureSt[0];
    var setCulture = cultureSt[1];

    // Tri vue synthèse.
    var sortSt = useState({
      key: 'cout_ha_total',
      dir: 'desc'
    });
    var sort = sortSt[0];
    var setSort = sortSt[1];
    function loadData() {
      setState({
        loading: true,
        error: null,
        data: null
      });
      var filters = {
        since: since
      };
      if (culture) filters.culture = culture;
      if (canFilterFerme && ferme && ferme !== 'all') filters.ferme = ferme;
      CVT_fetch(filters).then(function (json) {
        setState({
          loading: false,
          error: null,
          data: json
        });
      }).catch(function (e) {
        setState({
          loading: false,
          error: e.message || String(e),
          data: null
        });
      });
    }
    useEffect(function () {
      loadData();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    var d = state.data || {};
    var total = d.total || {};
    var rawParcelles = d.parcelles || [];
    var nonValList = d.articles_non_valorises || [];

    // Liste des cultures disponibles (pour le filtre).
    var culturesDispo = useMemo(function () {
      var set = {};
      rawParcelles.forEach(function (p) {
        if (p.culture) set[p.culture] = true;
      });
      return Object.keys(set).sort();
    }, [rawParcelles]);

    // Tri vue synthèse (client-side).
    var parcelles = useMemo(function () {
      var arr = rawParcelles.slice();
      var k = sort.key;
      var dir = sort.dir === 'asc' ? 1 : -1;
      arr.sort(function (a, b) {
        var va = a[k];
        var vb = b[k];
        if (typeof va === 'string' || typeof vb === 'string') {
          return String(va || '').localeCompare(String(vb || ''), 'fr') * dir;
        }
        if (va == null) va = -Infinity;
        if (vb == null) vb = -Infinity;
        return (va - vb) * dir;
      });
      return arr;
    }, [rawParcelles, sort]);
    function onSort(key) {
      setSort(function (prev) {
        if (prev.key === key) return {
          key: key,
          dir: prev.dir === 'asc' ? 'desc' : 'asc'
        };
        return {
          key: key,
          dir: 'desc'
        };
      });
    }
    var btn = function (id, label) {
      var active = view === id;
      return React.createElement('button', {
        onClick: function () {
          setView(id);
        },
        style: {
          padding: '6px 14px',
          borderRadius: 8,
          border: '1px solid ' + (active ? CVT_C.berry : CVT_C.border),
          background: active ? CVT_C.berry : CVT_C.surface,
          color: active ? '#fff' : CVT_C.textSecondary,
          fontWeight: 600,
          fontSize: 13,
          cursor: 'pointer'
        }
      }, label);
    };
    var inputStyle = {
      padding: '6px 10px',
      borderRadius: 8,
      border: '1px solid ' + CVT_C.border,
      fontSize: 13,
      color: CVT_C.textPrimary,
      background: CVT_C.surface
    };

    // Bandeau ferme imposée pour les chefs.
    var perimLabel = d.perimetre_ferme && d.perimetre_ferme !== 'all' ? d.perimetre_ferme : 'Toutes fermes';
    return React.createElement('div', {
      style: {
        padding: '8px 4px 40px'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12
      }
    }, React.createElement('h2', {
      style: {
        margin: 0,
        fontSize: 20,
        fontWeight: 800,
        color: CVT_C.textPrimary
      }
    }, 'Engrais & Pesticides'), React.createElement('div', {
      style: {
        fontSize: 12,
        color: CVT_C.textTertiary
      }
    }, 'Périmètre : ' + perimLabel + ' · depuis le ' + (d.since || since) + (d.dateExtraction ? ' · extrait le ' + d.dateExtraction : ''))), CVT_Bandeau({
      nbNonVal: nonValList.length
    }),
    // FILTRES.
    React.createElement('div', {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        alignItems: 'flex-end',
        marginBottom: 16
      }
    }, React.createElement('label', {
      style: {
        fontSize: 12,
        color: CVT_C.textSecondary
      }
    }, React.createElement('div', {
      style: {
        marginBottom: 3
      }
    }, 'Depuis le'), React.createElement('input', {
      type: 'date',
      value: since,
      min: '2025-07-01',
      onChange: function (e) {
        setSince(e.target.value || '2025-07-01');
      },
      style: inputStyle
    })), React.createElement('label', {
      style: {
        fontSize: 12,
        color: CVT_C.textSecondary
      }
    }, React.createElement('div', {
      style: {
        marginBottom: 3
      }
    }, 'Culture'), React.createElement('select', {
      value: culture,
      onChange: function (e) {
        setCulture(e.target.value);
      },
      style: inputStyle
    }, React.createElement('option', {
      value: ''
    }, 'Toutes'), culturesDispo.map(function (c) {
      return React.createElement('option', {
        key: c,
        value: c
      }, c);
    }))), canFilterFerme ? React.createElement('label', {
      style: {
        fontSize: 12,
        color: CVT_C.textSecondary
      }
    }, React.createElement('div', {
      style: {
        marginBottom: 3
      }
    }, 'Ferme'), React.createElement('select', {
      value: ferme,
      onChange: function (e) {
        setFerme(e.target.value);
      },
      style: inputStyle
    }, React.createElement('option', {
      value: 'all'
    }, 'Toutes fermes'), fermesDispo.map(function (f) {
      return React.createElement('option', {
        key: f,
        value: f
      }, f);
    }))) : isChef ? React.createElement('div', {
      style: {
        fontSize: 12,
        color: CVT_C.textTertiary,
        padding: '6px 10px',
        background: CVT_C.surface2,
        borderRadius: 8
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-lock',
      style: {
        marginRight: 6
      }
    }), 'Ferme : ' + perimLabel) : null, React.createElement('button', {
      onClick: loadData,
      disabled: state.loading,
      style: {
        padding: '7px 16px',
        borderRadius: 8,
        border: 'none',
        background: CVT_C.berry,
        color: '#fff',
        fontWeight: 700,
        fontSize: 13,
        cursor: 'pointer'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-filter',
      style: {
        marginRight: 6
      }
    }), 'Appliquer'), React.createElement('button', {
      onClick: function () {
        CVT_exportExcel(d);
      },
      disabled: state.loading || !rawParcelles.length,
      style: {
        padding: '7px 16px',
        borderRadius: 8,
        border: '1px solid ' + CVT_C.border,
        background: CVT_C.surface,
        color: CVT_C.textPrimary,
        fontWeight: 700,
        fontSize: 13,
        cursor: rawParcelles.length ? 'pointer' : 'default'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-file-excel',
      style: {
        marginRight: 6,
        color: CVT_C.green
      }
    }), 'Export Excel')), state.loading ? React.createElement('div', {
      style: {
        padding: 40,
        textAlign: 'center',
        color: CVT_C.textTertiary
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-spinner fa-spin',
      style: {
        fontSize: 24,
        marginBottom: 10
      }
    }), React.createElement('div', null, 'Chargement…')) : state.error ? React.createElement('div', {
      style: {
        padding: 24,
        color: CVT_C.red
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-triangle-exclamation',
      style: {
        marginRight: 8
      }
    }), 'Erreur : ' + state.error) : React.createElement('div', null,
    // Total général (périmètre du rôle).
    React.createElement('div', {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: 16,
        marginBottom: 16,
        padding: '14px 16px',
        background: CVT_C.surface2,
        borderRadius: 12,
        border: '1px solid ' + CVT_C.border
      }
    }, React.createElement('div', null, React.createElement('div', {
      style: {
        fontWeight: 800,
        fontSize: 18,
        color: CVT_C.berry
      }
    }, CVT_dh(total.total_mad)), React.createElement('div', {
      style: {
        fontSize: 11,
        color: CVT_C.textTertiary,
        textTransform: 'uppercase'
      }
    }, 'Total valorisé')), React.createElement('div', null, React.createElement('div', {
      style: {
        fontWeight: 700,
        fontSize: 16,
        color: CVT_C.green
      }
    }, CVT_dh(total.total_engrais_mad)), React.createElement('div', {
      style: {
        fontSize: 11,
        color: CVT_C.textTertiary,
        textTransform: 'uppercase'
      }
    }, 'Engrais')), React.createElement('div', null, React.createElement('div', {
      style: {
        fontWeight: 700,
        fontSize: 16,
        color: CVT_C.red
      }
    }, CVT_dh(total.total_pest_mad)), React.createElement('div', {
      style: {
        fontSize: 11,
        color: CVT_C.textTertiary,
        textTransform: 'uppercase'
      }
    }, 'Pesticides')), React.createElement('div', null, React.createElement('div', {
      style: {
        fontWeight: 700,
        fontSize: 16,
        color: CVT_C.textPrimary
      }
    }, CVT_num(total.nb_parcelles, 0)), React.createElement('div', {
      style: {
        fontSize: 11,
        color: CVT_C.textTertiary,
        textTransform: 'uppercase'
      }
    }, 'Parcelles'))),
    // Sélecteur de vue.
    React.createElement('div', {
      style: {
        display: 'flex',
        gap: 8,
        marginBottom: 16
      }
    }, btn('synthese', 'Synthèse parcelles'), btn('ferme', 'Par ferme'), btn('culture', 'Par culture')), view === 'synthese' ? React.createElement(CVT_SyntheseTable, {
      parcelles: parcelles,
      getAlias: getAlias,
      sortKey: sort.key,
      sortDir: sort.dir,
      onSort: onSort,
      onClickParcelle: function (p) {
        setPopup(p);
      }
    }) : view === 'ferme' ? CVT_SousTotaux({
      rows: d.par_ferme,
      labelKey: 'ferme',
      colLabel: 'Ferme',
      titre: 'Sous-totaux par ferme'
    }) : CVT_SousTotaux({
      rows: d.par_culture,
      labelKey: 'culture',
      colLabel: 'Culture',
      titre: 'Sous-totaux par culture'
    })), popup ? React.createElement(CVT_DetailPopup, {
      parcelle: popup,
      getAlias: getAlias,
      onClose: function () {
        setPopup(null);
      }
    }) : null);
  }
  window.ConsoValoriseeTab = ConsoValoriseeTab;
})();
