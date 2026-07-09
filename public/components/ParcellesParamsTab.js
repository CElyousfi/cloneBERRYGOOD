/*
 * ParcellesParamsTab.jsx — Écran « Paramètres Parcelles ».
 *
 * Onglet Magasin/Mapping (à côté de MagMappingConsoTab). Affiche, pour une
 * campagne sélectionnée, la liste des parcelles (dérivée du mirror
 * sql_mirror_pointage + LEFT-JOIN référentiel parcelle_ferme_referentiel) :
 *   Ref · Label · Ferme · Culture · Variété · Surface (Ha) · Campagne · Statut
 *
 * - Surface (Ha) : LECTURE SEULE, authoritative BEE ONE. Badge « BEE ONE »
 *   (valeur) ou « ⚠️ manquante » (null, tant que le pull BEE ONE n'a pas tourné —
 *   dégradé gracieux voulu, spec §7.2).
 * - Campagne : <select> éditable (assignation/correction) → SEULE écriture SB,
 *   via CF /api/pointage-rh?action=assign-campagne-parcelle. Visible/actif
 *   UNIQUEMENT pour DG/admin (sinon lecture seule).
 * - Cloisonnement chef hérité côté serveur (un chef ne voit que ses parcelles).
 *
 * Données via /api/pointage-rh (Cloud Function) : action=parcelles-params-list
 * (GET) et action=assign-campagne-parcelle (POST). Le token Firebase est injecté
 * automatiquement par le wrapper global window.fetch de app.jsx (/api/*).
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * IIFE + un SEUL global unique (window.ParcellesParamsTab). Idents internes
 * préfixés PPT_ (cf. crashes #75/#77/#200).
 *
 * Props :
 *   - currentProfile : id du profil courant (string)
 *   - profileData    : objet profil (peut contenir name)
 *   - authUser       : objet auth Firebase ({ uid, ... })
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var PPT_C = {
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

  // Rôles autorisés à ÉCRIRE l'assignation de campagne (spec §7.1 : DG + admin).
  function pptCanAssign(currentProfile) {
    return currentProfile === 'dg' || currentProfile === 'admin';
  }

  // Liste des campagnes proposées : la courante (dérivée client via CampagneUtils)
  // + les 2 précédentes. Fallback statique si CampagneUtils indisponible.
  function pptCampagnes() {
    var CU = window.CampagneUtils;
    var courante = CU && CU.campagneCourante && CU.campagneCourante() || '2026-2027';
    var startY = parseInt(courante.slice(0, 4), 10);
    var out = [];
    for (var i = 0; i < 3; i++) {
      var y = startY - i;
      out.push(y + '-' + (y + 1));
    }
    return out;
  }

  // Appel API liste (GET). Le Bearer token est injecté par le wrapper global.
  function pptFetchList(campagne) {
    return fetch('/api/pointage-rh?action=parcelles-params-list&campagne=' + encodeURIComponent(campagne)).then(function (r) {
      return r.json();
    }).then(function (json) {
      if (!json || !json.success) throw new Error(json && json.error || 'Échec du chargement');
      return json;
    });
  }

  // Appel API assignation (POST). Écriture via CF only.
  function pptAssign(ref, campagneOrigine, campagneCible) {
    return fetch('/api/pointage-rh?action=assign-campagne-parcelle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: ref,
        campagne_origine: campagneOrigine,
        campagne: campagneCible
      })
    }).then(function (r) {
      return r.json();
    }).then(function (json) {
      if (!json || !json.success) throw new Error(json && json.error || "Échec de l'assignation");
      return json;
    });
  }
  function PptSurfaceBadge(props) {
    var ha = props.surface_ha;
    if (ha == null) {
      return React.createElement('span', {
        style: {
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 6,
          background: '#FCEBEB',
          color: '#A32D2D',
          fontSize: 11,
          fontWeight: 600
        }
      }, '⚠️ manquante');
    }
    return React.createElement('span', {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 6,
        background: '#E1F5EE',
        color: '#0F6E56',
        fontSize: 11,
        fontWeight: 600
      }
    }, React.createElement('span', null, Number(ha).toLocaleString('fr-FR') + ' Ha'), React.createElement('span', {
      style: {
        fontSize: 9,
        opacity: 0.7,
        fontWeight: 700
      }
    }, 'BEE ONE'));
  }
  function ParcellesParamsTab(props) {
    var currentProfile = props.currentProfile;
    var canAssign = pptCanAssign(currentProfile);
    var campagnes = useMemo(pptCampagnes, []);
    var campagneState = useState(campagnes[0]);
    var campagne = campagneState[0];
    var setCampagne = campagneState[1];
    var rowsState = useState([]);
    var rows = rowsState[0];
    var setRows = rowsState[1];
    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];
    var errState = useState(null);
    var err = errState[0];
    var setErr = errState[1];

    // ref en cours d'assignation (pour désactiver le select le temps du POST).
    var savingState = useState(null);
    var savingRef = savingState[0];
    var setSavingRef = savingState[1];
    function load(camp) {
      setLoading(true);
      setErr(null);
      pptFetchList(camp).then(function (json) {
        setRows(json.parcelles || []);
      }).catch(function (e) {
        setErr(e && e.message || 'Erreur de chargement');
        setRows([]);
      }).finally(function () {
        setLoading(false);
      });
    }
    useEffect(function () {
      load(campagne);
    }, [campagne]);
    function onAssign(row, cible) {
      if (cible === row.campagne_assignee) return;
      setSavingRef(row.ref);
      setErr(null);
      pptAssign(row.ref, campagne, cible).then(function () {
        load(campagne);
      }).catch(function (e) {
        setErr(e && e.message || "Échec de l'assignation");
      }).finally(function () {
        setSavingRef(null);
      });
    }
    var thStyle = {
      textAlign: 'left',
      padding: '8px 10px',
      fontSize: 11,
      fontWeight: 700,
      color: PPT_C.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
      borderBottom: '1px solid ' + PPT_C.border,
      whiteSpace: 'nowrap'
    };
    var tdStyle = {
      padding: '8px 10px',
      fontSize: 13,
      color: PPT_C.textPrimary,
      borderBottom: '1px solid ' + PPT_C.surface3,
      verticalAlign: 'middle'
    };
    return React.createElement('div', {
      style: {
        padding: '4px 2px'
      }
    },
    // En-tête + sélecteur campagne
    React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 16
      }
    }, React.createElement('div', null, React.createElement('h2', {
      style: {
        margin: 0,
        fontSize: 18,
        fontWeight: 600,
        color: PPT_C.textPrimary
      }
    }, 'Paramètres Parcelles'), React.createElement('p', {
      style: {
        margin: '2px 0 0',
        fontSize: 12,
        color: PPT_C.textTertiary
      }
    }, 'Surface = BEE ONE (lecture seule). ' + (canAssign ? 'Assignation de campagne : DG/admin.' : 'Lecture seule.'))), React.createElement('div', {
      style: {
        marginLeft: 'auto',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, React.createElement('label', {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: PPT_C.textSecondary
      }
    }, 'Campagne'), React.createElement('select', {
      value: campagne,
      onChange: function (e) {
        setCampagne(e.target.value);
      },
      style: {
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid ' + PPT_C.border,
        fontSize: 13,
        fontWeight: 600,
        background: PPT_C.surface
      }
    }, campagnes.map(function (c) {
      return React.createElement('option', {
        key: c,
        value: c
      }, c);
    })))), err ? React.createElement('div', {
      style: {
        padding: '10px 14px',
        borderRadius: 8,
        background: '#FCEBEB',
        color: '#A32D2D',
        fontSize: 13,
        marginBottom: 12
      }
    }, err) : null, loading ? React.createElement('div', {
      style: {
        padding: 40,
        textAlign: 'center',
        color: PPT_C.textTertiary,
        fontSize: 14
      }
    }, 'Chargement des parcelles…') : rows.length === 0 ? React.createElement('div', {
      style: {
        padding: 40,
        textAlign: 'center',
        color: PPT_C.textTertiary,
        fontSize: 14
      }
    }, 'Aucune parcelle avec du pointage pour cette campagne.') : React.createElement('div', {
      style: {
        overflowX: 'auto',
        border: '1px solid ' + PPT_C.border,
        borderRadius: 12,
        background: PPT_C.surface
      }
    }, React.createElement('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        minWidth: 820
      }
    }, React.createElement('thead', null, React.createElement('tr', {
      style: {
        background: PPT_C.surface2
      }
    }, React.createElement('th', {
      style: thStyle
    }, 'Ref'), React.createElement('th', {
      style: thStyle
    }, 'Label'), React.createElement('th', {
      style: thStyle
    }, 'Ferme'), React.createElement('th', {
      style: thStyle
    }, 'Culture'), React.createElement('th', {
      style: thStyle
    }, 'Variété'), React.createElement('th', {
      style: thStyle
    }, 'Surface (Ha)'), React.createElement('th', {
      style: thStyle
    }, 'Campagne'), React.createElement('th', {
      style: thStyle
    }, 'Statut'))), React.createElement('tbody', null, rows.map(function (row) {
      var missing = row.surface_ha == null;
      var unknownFerme = !row.ferme || row.ferme === 'Autre' || row.ferme === 'INCONNU';
      var highlight = missing || unknownFerme;
      return React.createElement('tr', {
        key: row.ref,
        style: highlight ? {
          background: '#FFF8F0'
        } : null
      }, React.createElement('td', {
        style: Object.assign({}, tdStyle, {
          fontWeight: 600,
          whiteSpace: 'nowrap'
        })
      }, row.ref), React.createElement('td', {
        style: tdStyle
      }, row.label || '—'), React.createElement('td', {
        style: Object.assign({}, tdStyle, unknownFerme ? {
          color: PPT_C.red,
          fontWeight: 600
        } : null)
      }, row.ferme || '—'), React.createElement('td', {
        style: tdStyle
      }, row.culture || '—'), React.createElement('td', {
        style: tdStyle
      }, row.variete || '—'), React.createElement('td', {
        style: tdStyle
      }, React.createElement(PptSurfaceBadge, {
        surface_ha: row.surface_ha
      })), React.createElement('td', {
        style: tdStyle
      }, canAssign ? React.createElement('select', {
        value: row.campagne_assignee || row.campagne_derivee,
        disabled: savingRef === row.ref,
        onChange: function (e) {
          onAssign(row, e.target.value);
        },
        style: {
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid ' + PPT_C.border,
          fontSize: 12,
          fontWeight: 600,
          background: PPT_C.surface,
          opacity: savingRef === row.ref ? 0.5 : 1
        }
      }, campagnes.map(function (c) {
        return React.createElement('option', {
          key: c,
          value: c
        }, c);
      })) : React.createElement('span', {
        style: {
          fontSize: 12,
          fontWeight: 600
        }
      }, row.campagne_assignee || row.campagne_derivee)), React.createElement('td', {
        style: tdStyle
      }, React.createElement('span', {
        style: {
          display: 'inline-block',
          padding: '2px 8px',
          borderRadius: 6,
          background: row.statut === 'active' ? '#E1F5EE' : PPT_C.surface3,
          color: row.statut === 'active' ? '#0F6E56' : PPT_C.textSecondary,
          fontSize: 11,
          fontWeight: 600
        }
      }, row.statut === 'active' ? 'Active' : row.statut || '—')));
    })))));
  }
  window.ParcellesParamsTab = ParcellesParamsTab;
})();
