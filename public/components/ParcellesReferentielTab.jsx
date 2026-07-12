/*
 * ParcellesReferentielTab.jsx — Parcelles & Référentiel MO (Phase 1 : visualisation)
 *
 * Onglet RH. Affiche les parcelles BEE ONE classées par campagne :
 *   - Campagne 2026/2027 : parcelles actives à partir du 1er juillet 2026
 *     (Fin >= '2026-07-01'), considérées comme la campagne courante.
 *   - Campagne 2025/2026 : parcelles dont l'activité s'est arrêtée avant le
 *     1er juillet 2026 (Fin < '2026-07-01').
 *   - Si une parcelle apparaît dans les deux campagnes → uniquement 2026/2027.
 *
 * Source : /api/parcelles (exports.parcelles, Cloud Function europe-west1).
 * Auth : token Firebase injecté automatiquement par le wrapper global fetch.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. IIFE + global unique
 * window.ParcellesReferentielTab. Préfixe interne PRT_ (anti-collision globale).
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;

  // ── Palette ──────────────────────────────────────────────────────────────────
  var PRT_C = {
    berry:    '#c0392b',
    green:    '#1D9E75',
    blue:     '#2563eb',
    amber:    '#EF9F27',
    gray:     '#888780',
    surface:  '#ffffff',
    surface2: '#f5f4ef',
    surface3: '#ebeae3',
    border:   'rgba(0,0,0,0.10)',
    text:     '#1c1c1a',
    textSec:  '#5f5e5a',
    textTer:  '#8a8985',
  };

  var CAMPAGNE_CUT = '2026-07-01'; // ISO, frontière entre les deux campagnes

  var CULTURE_COLORS = {
    Framboise: { bg: '#fce4e4', text: '#c0392b' },
    Myrtille:  { bg: '#dbeafe', text: '#1d4ed8' },
    Avocatier: { bg: '#d1fae5', text: '#065f46' },
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function toDateStr(val) {
    if (!val) return '';
    if (typeof val === 'string') return val.slice(0, 10);
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    return String(val).slice(0, 10);
  }

  function fmtDate(val) {
    var s = toDateStr(val);
    if (!s) return '—';
    var parts = s.split('-');
    if (parts.length !== 3) return s;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function fmtHa(val) {
    var n = parseFloat(val) || 0;
    if (n === 0) return '—';
    return n.toFixed(2) + ' Ha';
  }

  function classifyParcelle(p) {
    var fin = toDateStr(p.Fin);
    if (!fin) return '2026/2027'; // inconnu → courant par défaut
    return fin >= CAMPAGNE_CUT ? '2026/2027' : '2025/2026';
  }

  function normCulture(raw) {
    if (!raw) return 'Framboise';
    var u = raw.toUpperCase();
    if (u.indexOf('MYRTILL') !== -1 || u.indexOf('BLUEBERRY') !== -1) return 'Myrtille';
    if (u.indexOf('AVOCAT') !== -1 || u.indexOf('AVOCADO') !== -1)    return 'Avocatier';
    return 'Framboise';
  }

  function normFerme(raw) {
    if (!raw) return '—';
    if (/bahia/i.test(raw)) return 'BAHIA';
    var m = raw.match(/F(\d)/i);
    if (m) return 'F' + m[1];
    return raw;
  }

  // ── Badge culture ─────────────────────────────────────────────────────────
  function PRT_CultureBadge(props) {
    var culture = props.culture || 'Framboise';
    var col = CULTURE_COLORS[culture] || { bg: '#f3f4f6', text: '#374151' };
    return React.createElement('span', {
      style: {
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        background: col.bg,
        color: col.text,
      },
    }, culture);
  }

  // ── Tableau parcelles ─────────────────────────────────────────────────────
  function PRT_Table(props) {
    var rows = props.rows;
    var search = props.search;

    var filtered = useMemo(function () {
      if (!search) return rows;
      var q = search.toUpperCase();
      return rows.filter(function (r) {
        return (r.Parcelle_Physique || '').toUpperCase().indexOf(q) !== -1
          || (r.Culture || '').toUpperCase().indexOf(q) !== -1
          || (r.ferme || '').toUpperCase().indexOf(q) !== -1;
      });
    }, [rows, search]);

    if (filtered.length === 0) {
      return React.createElement('div', {
        style: { textAlign: 'center', padding: '32px 0', color: PRT_C.textTer, fontSize: 13 },
      }, search ? 'Aucune parcelle correspondant à "' + search + '"' : 'Aucune parcelle');
    }

    var thStyle = {
      textAlign: 'left', padding: '8px 10px',
      fontSize: 11, fontWeight: 700, color: PRT_C.textSec,
      borderBottom: '2px solid ' + PRT_C.border,
      whiteSpace: 'nowrap', background: PRT_C.surface2,
    };
    var tdStyle = {
      padding: '8px 10px', fontSize: 12, color: PRT_C.text,
      borderBottom: '1px solid ' + PRT_C.border, verticalAlign: 'middle',
    };

    return React.createElement('div', { style: { overflowX: 'auto' } },
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: 520 } },
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', { style: thStyle }, 'Parcelle'),
            React.createElement('th', { style: thStyle }, 'Culture'),
            React.createElement('th', { style: thStyle }, 'Ferme'),
            React.createElement('th', { style: { ...thStyle, textAlign: 'right' } }, 'Surface (Ha)'),
            React.createElement('th', { style: thStyle }, '1ère activité'),
            React.createElement('th', { style: thStyle }, 'Dernière activité'),
          )
        ),
        React.createElement('tbody', null,
          filtered.map(function (r, i) {
            var culture = normCulture(r.Culture);
            return React.createElement('tr', {
              key: r.Parcelle_Physique || i,
              style: { background: i % 2 === 0 ? PRT_C.surface : PRT_C.surface2 },
            },
              React.createElement('td', { style: { ...tdStyle, fontWeight: 600, maxWidth: 280 } }, r.Parcelle_Physique || '—'),
              React.createElement('td', { style: tdStyle }, React.createElement(PRT_CultureBadge, { culture: culture })),
              React.createElement('td', { style: tdStyle }, React.createElement('span', { style: { fontWeight: 600 } }, r.ferme || '—')),
              React.createElement('td', { style: { ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontSize: 12 } }, fmtHa(r.Sup)),
              React.createElement('td', { style: { ...tdStyle, color: PRT_C.textSec } }, fmtDate(r.Debut)),
              React.createElement('td', { style: { ...tdStyle, color: PRT_C.textSec } }, fmtDate(r.Fin)),
            );
          })
        )
      )
    );
  }

  // ── Carte résumé campagne ─────────────────────────────────────────────────
  function PRT_CampagneCard(props) {
    var label = props.label;
    var rows = props.rows;
    var accent = props.accent;
    var subtitle = props.subtitle;

    var totalHa = rows.reduce(function (s, r) { return s + (parseFloat(r.Sup) || 0); }, 0);
    var byCulture = {};
    rows.forEach(function (r) {
      var c = normCulture(r.Culture);
      byCulture[c] = (byCulture[c] || 0) + 1;
    });

    return React.createElement('div', {
      style: {
        background: PRT_C.surface, border: '1px solid ' + PRT_C.border,
        borderRadius: 12, padding: '16px 20px', flex: '1 1 220px', minWidth: 200,
        borderTop: '3px solid ' + accent,
      },
    },
      React.createElement('div', { style: { fontSize: 13, fontWeight: 700, color: accent, marginBottom: 4 } }, label),
      subtitle && React.createElement('div', { style: { fontSize: 11, color: PRT_C.textTer, marginBottom: 10 } }, subtitle),
      React.createElement('div', { style: { fontSize: 26, fontWeight: 800, color: PRT_C.text, marginBottom: 4 } }, rows.length,
        React.createElement('span', { style: { fontSize: 13, fontWeight: 400, color: PRT_C.textSec, marginLeft: 6 } }, 'parcelles')
      ),
      totalHa > 0 && React.createElement('div', { style: { fontSize: 12, color: PRT_C.textSec, marginBottom: 8 } },
        totalHa.toFixed(1) + ' Ha total (BEE ONE)'
      ),
      React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
        Object.entries(byCulture).map(function (e) {
          var col = CULTURE_COLORS[e[0]] || { bg: '#f3f4f6', text: '#374151' };
          return React.createElement('span', {
            key: e[0],
            style: { fontSize: 11, padding: '2px 8px', borderRadius: 8, background: col.bg, color: col.text, fontWeight: 600 },
          }, e[0] + ' × ' + e[1]);
        })
      )
    );
  }

  // ── Composant principal ───────────────────────────────────────────────────
  function ParcellesReferentielTab() {
    var _state = useState(null);
    var parcelles = _state[0]; var setParcelles = _state[1];
    var _load = useState(false);
    var loading = _load[0]; var setLoading = _load[1];
    var _err = useState(null);
    var error = _err[0]; var setError = _err[1];
    var _search = useState('');
    var search = _search[0]; var setSearch = _search[1];
    var _camp = useState('2026/2027');
    var selectedCamp = _camp[0]; var setSelectedCamp = _camp[1];

    useEffect(function () {
      setLoading(true);
      setError(null);
      fetch('/api/parcelles')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (!data.success) throw new Error(data.error || 'Erreur API');
          var enriched = (data.parcelles || []).map(function (p) {
            return Object.assign({}, p, {
              campagne: classifyParcelle(p),
              ferme: normFerme(p.Ferme),
            });
          });
          setParcelles(enriched);
        })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setLoading(false); });
    }, []);

    var grouped = useMemo(function () {
      if (!parcelles) return { '2026/2027': [], '2025/2026': [] };
      var g = { '2026/2027': [], '2025/2026': [] };
      parcelles.forEach(function (p) { g[p.campagne].push(p); });
      g['2026/2027'].sort(function (a, b) { return (a.Parcelle_Physique || '').localeCompare(b.Parcelle_Physique || ''); });
      g['2025/2026'].sort(function (a, b) { return (a.Parcelle_Physique || '').localeCompare(b.Parcelle_Physique || ''); });
      return g;
    }, [parcelles]);

    var currentRows = grouped[selectedCamp] || [];

    // ── render ──
    return React.createElement('div', { style: { padding: '20px 24px', maxWidth: 1100 } },

      // En-tête
      React.createElement('div', { style: { marginBottom: 20 } },
        React.createElement('h2', { style: { fontSize: 20, fontWeight: 800, color: PRT_C.text, margin: 0 } },
          React.createElement('i', { className: 'fa-solid fa-map-location-dot', style: { marginRight: 10, color: PRT_C.berry } }),
          'Parcelles & Référentiel MO'
        ),
        React.createElement('p', { style: { margin: '4px 0 0', fontSize: 12, color: PRT_C.textTer } },
          'Classification des parcelles BEE ONE par campagne — source : BR_Consommation (MIN/MAX activité)'
        )
      ),

      // Cartes résumé
      loading && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: PRT_C.textTer } },
        React.createElement('i', { className: 'fa-solid fa-circle-notch fa-spin', style: { fontSize: 24 } })
      ),

      error && React.createElement('div', {
        style: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', color: '#991b1b', fontSize: 13 },
      }, React.createElement('i', { className: 'fa-solid fa-circle-exclamation', style: { marginRight: 8 } }), error),

      !loading && !error && parcelles && React.createElement(React.Fragment, null,

        // Cartes résumé
        React.createElement('div', { style: { display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' } },
          React.createElement(PRT_CampagneCard, {
            label: 'Campagne 2026/2027',
            subtitle: 'Parcelles actives au 1er juillet 2026',
            rows: grouped['2026/2027'],
            accent: PRT_C.green,
          }),
          React.createElement(PRT_CampagneCard, {
            label: 'Campagne 2025/2026',
            subtitle: 'Parcelles terminées avant juillet 2026',
            rows: grouped['2025/2026'],
            accent: PRT_C.amber,
          })
        ),

        // Sélecteur de campagne + recherche
        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
        },
          // Tabs campagne
          React.createElement('div', { style: { display: 'flex', gap: 6 } },
            ['2026/2027', '2025/2026'].map(function (camp) {
              var active = selectedCamp === camp;
              var color = camp === '2026/2027' ? PRT_C.green : PRT_C.amber;
              return React.createElement('button', {
                key: camp,
                onClick: function () { setSelectedCamp(camp); },
                style: {
                  padding: '6px 16px', borderRadius: 8, border: '1px solid ' + (active ? color : PRT_C.border),
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: active ? color : PRT_C.surface, color: active ? '#fff' : PRT_C.textSec,
                },
              }, camp + ' (' + grouped[camp].length + ')');
            })
          ),

          // Recherche
          React.createElement('div', { style: { position: 'relative', flex: '1 1 200px', maxWidth: 320 } },
            React.createElement('i', {
              className: 'fa-solid fa-magnifying-glass',
              style: { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: PRT_C.textTer, fontSize: 12 },
            }),
            React.createElement('input', {
              type: 'text',
              placeholder: 'Rechercher une parcelle…',
              value: search,
              onChange: function (e) { setSearch(e.target.value); },
              style: {
                width: '100%', boxSizing: 'border-box',
                padding: '7px 10px 7px 30px', borderRadius: 8,
                border: '1px solid ' + PRT_C.border, fontSize: 12,
                outline: 'none',
              },
            })
          ),

          // Compteur
          React.createElement('div', { style: { fontSize: 12, color: PRT_C.textTer, whiteSpace: 'nowrap' } },
            (search
              ? currentRows.filter(function (r) {
                  var q = search.toUpperCase();
                  return (r.Parcelle_Physique || '').toUpperCase().indexOf(q) !== -1
                    || (r.Culture || '').toUpperCase().indexOf(q) !== -1
                    || (r.ferme || '').toUpperCase().indexOf(q) !== -1;
                }).length
              : currentRows.length
            ) + ' parcelles'
          )
        ),

        // Tableau
        React.createElement('div', {
          style: { background: PRT_C.surface, border: '1px solid ' + PRT_C.border, borderRadius: 12, overflow: 'hidden' },
        },
          React.createElement(PRT_Table, { rows: currentRows, search: search })
        ),

        // Note de bas de page
        React.createElement('div', {
          style: { marginTop: 12, fontSize: 11, color: PRT_C.textTer },
        },
          React.createElement('i', { className: 'fa-solid fa-circle-info', style: { marginRight: 4 } }),
          'Classification basée sur la dernière activité enregistrée dans BR_Consommation. ',
          'Parcelles avec Fin ≥ 01/07/2026 → Campagne 2026/2027. Surface (Ha) = valeur BEE ONE (Parcelle_sup).'
        )
      )
    );
  }

  window.ParcellesReferentielTab = ParcellesReferentielTab;
})();
