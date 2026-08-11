/*
 * CampagneBudgetTab.jsx — Saisie du budget JH / Ha par parcelle × famille
 *
 * Omar saisit un budget de main d'œuvre en JOURS-HOMME PAR HECTARE, pour une
 * parcelle donnée et une famille d'opération donnée (Ferti-irrigation, Taille,
 * Entretien structure…). Ce budget alimentera plus tard l'export Campagne
 * (% consommé, JH/Ha restant, Total JH restant) — LOT 2, hors de ce fichier.
 *
 * Sources :
 *   GET  /api/pointage-rh?action=parcelles-campagne-list   (parcelles campagne)
 *   GET  /api/pointage-rh?action=sb-referentiel-list       (nom SB + Ha)
 *   GET  /api/pointage-rh?action=referentiel-taches-list   (familles — jamais figées)
 *   GET  /api/pointage-rh?action=campagne-budget-list      (budgets enregistrés)
 *   POST /api/pointage-rh?action=campagne-budget-save      (upsert, DG/RH/admin)
 *
 * Écriture Firestore : Cloud Function UNIQUEMENT (la collection
 * `sb_campagne_budget_jh` est en deny total côté règles).
 *
 * Pattern UMD — expose window.CampagneBudgetTab. Pas de JSX (le fichier est
 * babélisé mais les helpers purs sont chargés tels quels dans les tests via vm).
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var CBT_C = {
    berry: '#c0392b',
    green: '#1D9E75',
    gray: '#888780',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    border: 'rgba(0,0,0,0.10)',
    text: '#1c1c1a',
    textSec: '#5f5e5a',
    textTer: '#8a8985'
  };
  var CBT_FAMILLE_ICONS = {
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

  /** Culture d'une parcelle — source de vérité partagée (public/lib/cultureUtils.js). */
  function cbtCulture(cultureField, labelFallback) {
    var CU = window.CultureUtils;
    if (CU && typeof CU.normCulture === 'function') return CU.normCulture(cultureField, labelFallback);
    return '';
  }

  /** Ha d'une parcelle — helper global d'app.jsx (référentiel SB puis campagne). */
  function cbtHa(label) {
    return typeof window.sbParcelleHa === 'function' ? window.sbParcelleHa(label) || 0 : 0;
  }

  /** Nom affiché d'une parcelle — helper global d'app.jsx (nom SB sinon label). */
  function cbtNom(label) {
    return typeof window.sbParcelleNom === 'function' ? window.sbParcelleNom(label) : label || '—';
  }

  /**
   * Liste ordonnée et dédupliquée des familles d'opération. PURE.
   *
   * Même dérivation que le backend (`famillesOrdered` de
   * campagne-analytique-detail) : ordre d'apparition des opérations du
   * référentiel, JAMAIS une liste figée en dur.
   *
   * @param {Array<{famille?: string, ordre?: number}>} ops
   * @returns {Array<string>}
   */
  function CBT_famillesFromOps(ops) {
    var sorted = (ops || []).slice().sort(function (a, b) {
      return (a && a.ordre || 0) - (b && b.ordre || 0);
    });
    var seen = {};
    var out = [];
    sorted.forEach(function (o) {
      var f = o && o.famille ? String(o.famille).trim() : '';
      if (!f || seen[f]) return;
      seen[f] = true;
      out.push(f);
    });
    return out;
  }

  /**
   * Indexe les budgets renvoyés par l'API par label BEE ONE EN MAJUSCULES —
   * même clé que window.SB_PARCELLE_REF. PURE.
   *
   * @param {Array<{label_bee_one?: string, budgets?: Object}>} list
   * @returns {Object<string, Object<string, number>>}
   */
  function CBT_budgetsByLabel(list) {
    var out = {};
    (list || []).forEach(function (b) {
      var key = String(b && b.label_bee_one || '').trim().toUpperCase();
      if (!key) return;
      out[key] = b && b.budgets || {};
    });
    return out;
  }

  /**
   * Construit le body de `campagne-budget-save`. PURE.
   *
   * Toutes les familles AFFICHÉES sont envoyées, y compris celles laissées
   * vides (→ 0) : c'est ce qui permet d'effacer un budget sans action de
   * suppression dédiée (le backend supprime les familles à 0).
   *
   * @param {Object} args
   * @param {string} args.campagne
   * @param {string} args.label
   * @param {Array<string>} args.familles familles affichées, dans l'ordre.
   * @param {Object<string, string>} args.values saisie brute par famille.
   * @returns {{ok: boolean, error?: string, payload?: Object}}
   */
  function CBT_buildSavePayload(args) {
    var a = args || {};
    if (!a.campagne) return {
      ok: false,
      error: 'Campagne inconnue'
    };
    if (!a.label) return {
      ok: false,
      error: 'Sélectionner une parcelle'
    };
    var familles = a.familles || [];
    if (familles.length === 0) return {
      ok: false,
      error: 'Aucune famille d\'opération'
    };
    var values = a.values || {};
    var budgets = {};
    for (var i = 0; i < familles.length; i++) {
      var f = familles[i];
      var raw = values[f];
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        budgets[f] = 0;
        continue;
      }
      var n = parseFloat(String(raw).trim().replace(',', '.'));
      if (isNaN(n) || !isFinite(n) || n < 0) {
        return {
          ok: false,
          error: 'Valeur invalide pour « ' + f + ' »'
        };
      }
      budgets[f] = Math.round(n * 100) / 100;
    }
    return {
      ok: true,
      payload: {
        campagne: a.campagne,
        label_bee_one: a.label,
        budgets: budgets
      }
    };
  }

  /**
   * Total JH d'une famille = budget JH/Ha × surface de la parcelle. PURE.
   *
   * @param {*} jhParHa
   * @param {*} ha
   * @returns {number} 0 si l'un des deux est absent/invalide.
   */
  function CBT_totalJH(jhParHa, ha) {
    var b = parseFloat(String(jhParHa == null ? '' : jhParHa).replace(',', '.'));
    var h = parseFloat(String(ha == null ? '' : ha));
    if (isNaN(b) || isNaN(h)) return 0;
    return Math.round(b * h * 100) / 100;
  }
  function CBT_CultureBadge(props) {
    var culture = props.culture;
    if (!culture) return null;
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
  function CampagneBudgetTab(props) {
    var userRole = String(props && props.userRole || '').toLowerCase();
    var canEdit = userRole === 'dg' || userRole === 'rh' || userRole === 'admin';
    var _rows = useState([]);
    var rows = _rows[0];
    var setRows = _rows[1];
    var _familles = useState([]);
    var familles = _familles[0];
    var setFamilles = _familles[1];
    var _budgets = useState({});
    var budgetsByLabel = _budgets[0];
    var setBudgetsByLabel = _budgets[1];
    var _campagne = useState('');
    var campagne = _campagne[0];
    var setCampagne = _campagne[1];
    var _sel = useState('');
    var selected = _sel[0];
    var setSelected = _sel[1];
    var _values = useState({});
    var values = _values[0];
    var setValues = _values[1];
    var _loading = useState(true);
    var loading = _loading[0];
    var setLoading = _loading[1];
    var _err = useState(null);
    var err = _err[0];
    var setErr = _err[1];
    var _saving = useState(false);
    var saving = _saving[0];
    var setSaving = _saving[1];
    var _msg = useState(null);
    var msg = _msg[0];
    var setMsg = _msg[1]; // { type: 'ok'|'ko', text }
    var _tick = useState(0);
    var tick = _tick[0];
    var setTick = _tick[1];
    useEffect(function () {
      var cancelled = false;
      setLoading(true);
      setErr(null);
      Promise.all([fetch('/api/pointage-rh?action=parcelles-campagne-list').then(function (r) {
        return r.json();
      }), fetch('/api/pointage-rh?action=sb-referentiel-list').then(function (r) {
        return r.json();
      }), fetch('/api/pointage-rh?action=referentiel-taches-list').then(function (r) {
        return r.json();
      }), fetch('/api/pointage-rh?action=campagne-budget-list').then(function (r) {
        return r.json();
      })]).then(function (res) {
        if (cancelled) return;
        var parc = res[0];
        var sb = res[1];
        var taches = res[2];
        var buds = res[3];
        if (!parc || !parc.success) throw new Error(parc && parc.error || 'Erreur parcelles');
        if (!taches || !taches.success) throw new Error(taches && taches.error || 'Erreur référentiel tâches');
        if (!buds || !buds.success) throw new Error(buds && buds.error || 'Erreur budgets');
        // Référentiel SB : alimente window.SB_PARCELLE_REF, consommé par les
        // helpers globaux sbParcelleHa / sbParcelleNom (pas de duplication).
        if (sb && sb.success) {
          var map = {};
          (sb.parcelles || []).forEach(function (p) {
            map[String(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
          });
          window.SB_PARCELLE_REF = map;
        }
        setRows(parc.campagne_courante || []);
        setFamilles(CBT_famillesFromOps(taches.operations || []));
        setBudgetsByLabel(CBT_budgetsByLabel(buds.budgets || []));
        setCampagne(buds.campagne || '');
      }).catch(function (e) {
        if (!cancelled) setErr(e.message);
      }).finally(function () {
        if (!cancelled) setLoading(false);
      });
      return function () {
        cancelled = true;
      };
    }, [tick]);

    // Changement de parcelle → recharger les champs depuis les budgets connus.
    useEffect(function () {
      setMsg(null);
      if (!selected) {
        setValues({});
        return;
      }
      var saved = budgetsByLabel[selected.toUpperCase()] || {};
      var next = {};
      familles.forEach(function (f) {
        next[f] = saved[f] != null ? String(saved[f]) : '';
      });
      setValues(next);
    }, [selected, familles, budgetsByLabel]);
    var options = useMemo(function () {
      return (rows || []).slice().sort(function (a, b) {
        return cbtNom(a.label).localeCompare(cbtNom(b.label));
      });
    }, [rows]);
    var selectedRow = useMemo(function () {
      var key = String(selected || '').toUpperCase().trim();
      if (!key) return null;
      var hit = null;
      (rows || []).forEach(function (r) {
        if (String(r.label || '').toUpperCase().trim() === key) hit = r;
      });
      return hit;
    }, [rows, selected]);
    var ha = selectedRow ? cbtHa(selectedRow.label) : 0;
    function handleSave() {
      var built = CBT_buildSavePayload({
        campagne: campagne,
        label: selected,
        familles: familles,
        values: values
      });
      if (!built.ok) {
        setMsg({
          type: 'ko',
          text: built.error
        });
        return;
      }
      setSaving(true);
      setMsg(null);
      fetch('/api/pointage-rh?action=campagne-budget-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(built.payload)
      }).then(function (r) {
        return r.json();
      }).then(function (d) {
        if (!d || !d.success) throw new Error(d && d.error || 'Erreur serveur');
        setBudgetsByLabel(function (prev) {
          var next = Object.assign({}, prev);
          next[String(d.label_bee_one || selected).toUpperCase().trim()] = d.budgets || {};
          return next;
        });
        setMsg({
          type: 'ok',
          text: 'Budget enregistré'
        });
      }).catch(function (e) {
        setMsg({
          type: 'ko',
          text: e.message
        });
      }).finally(function () {
        setSaving(false);
      });
    }
    var inputStyle = {
      border: '1px solid ' + CBT_C.border,
      borderRadius: 6,
      padding: '5px 8px',
      fontSize: 12,
      outline: 'none',
      width: 90,
      textAlign: 'right',
      boxSizing: 'border-box'
    };
    var thStyle = {
      textAlign: 'left',
      padding: '8px 10px',
      fontSize: 11,
      fontWeight: 700,
      color: CBT_C.textSec,
      borderBottom: '2px solid ' + CBT_C.border,
      whiteSpace: 'nowrap',
      background: CBT_C.surface2
    };
    var tdStyle = {
      padding: '8px 10px',
      fontSize: 12,
      color: CBT_C.text,
      borderBottom: '1px solid ' + CBT_C.border,
      verticalAlign: 'middle'
    };
    var totalJH = 0;
    familles.forEach(function (f) {
      totalJH += CBT_totalJH(values[f], ha);
    });
    return React.createElement('div', {
      style: {
        padding: '20px 24px',
        maxWidth: 900
      }
    }, React.createElement('div', {
      style: {
        marginBottom: 16
      }
    }, React.createElement('h2', {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: CBT_C.text,
        margin: 0
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-bullseye',
      style: {
        marginRight: 10,
        color: CBT_C.berry
      }
    }), 'Budget JH / Ha'), React.createElement('p', {
      style: {
        margin: '4px 0 0',
        fontSize: 12,
        color: CBT_C.textTer
      }
    }, 'Budget de main d\'œuvre par parcelle et par famille d\'opération' + (campagne ? ' — campagne ' + campagne : '') + (canEdit ? '.' : ' (lecture seule — saisie réservée DG/RH).'))), loading && React.createElement('div', {
      style: {
        textAlign: 'center',
        padding: 40,
        color: CBT_C.textTer
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-notch fa-spin',
      style: {
        fontSize: 22
      }
    })), err && React.createElement('div', {
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
    }), err), !loading && !err && React.createElement(React.Fragment, null, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap'
      }
    }, React.createElement('select', {
      value: selected,
      onChange: function (e) {
        setSelected(e.target.value);
      },
      style: {
        border: '1px solid ' + CBT_C.border,
        borderRadius: 8,
        padding: '7px 10px',
        fontSize: 12,
        outline: 'none',
        minWidth: 280,
        background: CBT_C.surface
      }
    }, React.createElement('option', {
      value: ''
    }, '— Choisir une parcelle —'), options.map(function (r) {
      return React.createElement('option', {
        key: r.label,
        value: r.label
      }, cbtNom(r.label));
    })), selectedRow && React.createElement(CBT_CultureBadge, {
      culture: cbtCulture(selectedRow.culture, selectedRow.label)
    }), selectedRow && React.createElement('span', {
      style: {
        fontSize: 12,
        color: CBT_C.textSec
      }
    }, ha > 0 ? ha.toFixed(2) + ' ha' : 'Ha non saisi — voir Parcelles & Référentiel'), React.createElement('button', {
      onClick: function () {
        setTick(function (t) {
          return t + 1;
        });
      },
      title: 'Rafraîchir',
      style: {
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid ' + CBT_C.border,
        background: CBT_C.surface,
        color: CBT_C.textSec,
        fontSize: 12,
        cursor: 'pointer'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-rotate'
    }))), !selected && React.createElement('div', {
      style: {
        padding: '28px 0',
        textAlign: 'center',
        color: CBT_C.textTer,
        fontSize: 13
      }
    }, 'Sélectionner une parcelle pour saisir son budget.'), selected && React.createElement('div', {
      style: {
        background: CBT_C.surface,
        border: '1px solid ' + CBT_C.border,
        borderRadius: 12,
        overflow: 'hidden'
      }
    }, React.createElement('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse'
      }
    }, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', {
      style: thStyle
    }, 'Famille d\'opération'), React.createElement('th', {
      style: {
        ...thStyle,
        textAlign: 'right'
      }
    }, 'Budget JH / Ha'), React.createElement('th', {
      style: {
        ...thStyle,
        textAlign: 'right'
      }
    }, 'Total JH'))), React.createElement('tbody', null, familles.map(function (f, i) {
      var icon = CBT_FAMILLE_ICONS[f];
      return React.createElement('tr', {
        key: f,
        style: {
          background: i % 2 === 0 ? CBT_C.surface : CBT_C.surface2
        }
      }, React.createElement('td', {
        style: tdStyle
      }, icon && React.createElement('i', {
        className: 'fa-solid ' + icon,
        style: {
          color: CBT_C.berry,
          fontSize: 12,
          width: 18
        }
      }), f), React.createElement('td', {
        style: {
          ...tdStyle,
          textAlign: 'right'
        }
      }, canEdit ? React.createElement('input', {
        type: 'number',
        min: 0,
        step: 0.1,
        value: values[f] == null ? '' : values[f],
        placeholder: '0',
        onChange: function (e) {
          var v = e.target.value;
          setValues(function (prev) {
            var next = Object.assign({}, prev);
            next[f] = v;
            return next;
          });
        },
        style: inputStyle
      }) : React.createElement('span', {
        style: {
          fontFamily: 'monospace'
        }
      }, values[f] ? values[f] : '—')), React.createElement('td', {
        style: {
          ...tdStyle,
          textAlign: 'right',
          fontFamily: 'monospace',
          color: CBT_C.textSec
        }
      }, CBT_totalJH(values[f], ha) > 0 ? CBT_totalJH(values[f], ha).toFixed(2) : '—'));
    })), React.createElement('tfoot', null, React.createElement('tr', null, React.createElement('td', {
      style: {
        ...tdStyle,
        fontWeight: 700
      }
    }, 'Total'), React.createElement('td', {
      style: tdStyle
    }), React.createElement('td', {
      style: {
        ...tdStyle,
        textAlign: 'right',
        fontWeight: 700,
        fontFamily: 'monospace'
      }
    }, totalJH > 0 ? totalJH.toFixed(2) : '—')))), React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderTop: '1px solid ' + CBT_C.border,
        flexWrap: 'wrap'
      }
    }, canEdit && React.createElement('button', {
      onClick: handleSave,
      disabled: saving,
      style: {
        padding: '7px 18px',
        borderRadius: 8,
        border: 'none',
        background: CBT_C.green,
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
        cursor: saving ? 'not-allowed' : 'pointer',
        opacity: saving ? 0.6 : 1
      }
    }, saving ? 'Enregistrement…' : 'Enregistrer'), msg && React.createElement('span', {
      style: {
        fontSize: 12,
        color: msg.type === 'ok' ? CBT_C.green : '#dc2626',
        fontWeight: 600
      }
    }, React.createElement('i', {
      className: 'fa-solid ' + (msg.type === 'ok' ? 'fa-circle-check' : 'fa-circle-exclamation'),
      style: {
        marginRight: 6
      }
    }), msg.text), React.createElement('span', {
      style: {
        fontSize: 11,
        color: CBT_C.textTer
      }
    }, canEdit ? 'Laisser un champ vide (ou 0) supprime le budget de la famille.' : 'Saisie réservée aux profils DG/RH.')))));
  }
  window.CampagneBudgetTab = CampagneBudgetTab;
  // Helpers purs exposés pour les tests unitaires — accrochés au composant déjà
  // exposé, pas de nouveau nom global (collisions UMD de public/components).
  CampagneBudgetTab.famillesFromOps = CBT_famillesFromOps;
  CampagneBudgetTab.budgetsByLabel = CBT_budgetsByLabel;
  CampagneBudgetTab.buildSavePayload = CBT_buildSavePayload;
  CampagneBudgetTab.totalJH = CBT_totalJH;
})();
