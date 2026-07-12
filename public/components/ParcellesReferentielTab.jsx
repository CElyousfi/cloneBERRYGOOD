/*
 * ParcellesReferentielTab.jsx — Parcelles & Référentiel MO (Phase 1 : visualisation)
 *
 * Source : /api/pointage-rh?action=parcelles-campagne-list
 *   → BR_Pointage (base de production JH), pas BR_Consommation.
 *   → Campagne 2026/2027 : parcelles ayant du pointage >= 2026-07-01.
 *   → Campagne 2025/2026 : parcelles avec pointage 2025-07-01..2026-06-30
 *     NON présentes en 2026/2027.
 *
 * Auth : token Firebase injecté automatiquement par le wrapper global fetch.
 * IIFE + global unique window.ParcellesReferentielTab. Préfixe PRT_.
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;

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

  var CULTURE_COLORS = {
    Framboise: { bg: '#fce4e4', text: '#c0392b' },
    Myrtille:  { bg: '#dbeafe', text: '#1d4ed8' },
    Avocatier: { bg: '#d1fae5', text: '#065f46' },
  };

  function normCulture(raw) {
    if (!raw) return 'Framboise';
    var u = (raw || '').toUpperCase();
    if (u.indexOf('MYRTILL') !== -1 || u.indexOf('BLUEBERRY') !== -1) return 'Myrtille';
    if (u.indexOf('AVOCAT') !== -1 || u.indexOf('AVOCADO') !== -1)    return 'Avocatier';
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
    var col = CULTURE_COLORS[culture] || { bg: '#f3f4f6', text: '#374151' };
    return React.createElement('span', {
      style: { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: col.bg, color: col.text },
    }, culture);
  }

  function PRT_Table(props) {
    var rows = props.rows;
    var search = props.search;

    var filtered = useMemo(function () {
      if (!search) return rows;
      var q = search.toUpperCase();
      return rows.filter(function (r) {
        return (r.label || '').toUpperCase().indexOf(q) !== -1
          || (r.culture || '').toUpperCase().indexOf(q) !== -1
          || (r.ferme || '').toUpperCase().indexOf(q) !== -1
          || (r.variete || '').toUpperCase().indexOf(q) !== -1;
      });
    }, [rows, search]);

    if (filtered.length === 0) {
      return React.createElement('div', {
        style: { textAlign: 'center', padding: '32px 0', color: PRT_C.textTer, fontSize: 13 },
      }, search ? 'Aucune parcelle pour "' + search + '"' : 'Aucune parcelle');
    }

    var thStyle = {
      textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700,
      color: PRT_C.textSec, borderBottom: '2px solid ' + PRT_C.border,
      whiteSpace: 'nowrap', background: PRT_C.surface2,
    };
    var tdStyle = {
      padding: '8px 10px', fontSize: 12, color: PRT_C.text,
      borderBottom: '1px solid ' + PRT_C.border, verticalAlign: 'middle',
    };

    return React.createElement('div', { style: { overflowX: 'auto' } },
      React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse', minWidth: 540 } },
        React.createElement('thead', null,
          React.createElement('tr', null,
            React.createElement('th', { style: thStyle }, 'Réf BEE ONE'),
            React.createElement('th', { style: thStyle }, 'Parcelle (label BEE ONE)'),
            React.createElement('th', { style: thStyle }, 'Culture'),
            React.createElement('th', { style: thStyle }, 'Variété'),
            React.createElement('th', { style: thStyle }, 'Ferme'),
            React.createElement('th', { style: { ...thStyle, textAlign: 'right' } }, 'Ha (BEE ONE)'),
            React.createElement('th', { style: thStyle }, '1er pointage'),
            React.createElement('th', { style: thStyle }, 'Dernier pointage'),
          )
        ),
        React.createElement('tbody', null,
          filtered.map(function (r, i) {
            var culture = normCulture(r.culture);
            return React.createElement('tr', {
              key: (r.ref || '') + '|' + (r.label || '') + i,
              style: { background: i % 2 === 0 ? PRT_C.surface : PRT_C.surface2 },
            },
              React.createElement('td', { style: { ...tdStyle, color: PRT_C.textTer, fontSize: 11, fontFamily: 'monospace' } }, r.ref || '—'),
              React.createElement('td', { style: { ...tdStyle, fontWeight: 600, maxWidth: 280 } }, r.label || '—'),
              React.createElement('td', { style: tdStyle }, React.createElement(PRT_CultureBadge, { culture: culture })),
              React.createElement('td', { style: { ...tdStyle, color: PRT_C.textSec } }, r.variete || '—'),
              React.createElement('td', { style: tdStyle }, React.createElement('span', { style: { fontWeight: 600 } }, r.ferme || '—')),
              React.createElement('td', { style: { ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontSize: 12 } }, fmtHa(r.sup)),
              React.createElement('td', { style: { ...tdStyle, color: PRT_C.textSec } }, fmtDate(r.debut)),
              React.createElement('td', { style: { ...tdStyle, color: PRT_C.textSec } }, fmtDate(r.fin)),
            );
          })
        )
      )
    );
  }

  function PRT_CampagneCard(props) {
    var label = props.label;
    var rows = props.rows;
    var accent = props.accent;
    var subtitle = props.subtitle;
    var totalHa = rows.reduce(function (s, r) { return s + (parseFloat(r.sup) || 0); }, 0);
    var byCulture = {};
    rows.forEach(function (r) {
      var c = normCulture(r.culture);
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

  function ParcellesReferentielTab() {
    var _data = useState(null);
    var data = _data[0]; var setData = _data[1];
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
      fetch('/api/pointage-rh?action=parcelles-campagne-list')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d.success) throw new Error(d.error || 'Erreur API');
          setData(d);
        })
        .catch(function (e) { setError(e.message); })
        .finally(function () { setLoading(false); });
    }, []);

    var rows2627 = (data && data.campagne_courante)  || [];
    var rowsPrev = (data && data.campagne_precedente) || [];
    var currentRows = selectedCamp === '2026/2027' ? rows2627 : rowsPrev;

    return React.createElement('div', { style: { padding: '20px 24px', maxWidth: 1200 } },

      React.createElement('div', { style: { marginBottom: 20 } },
        React.createElement('h2', { style: { fontSize: 20, fontWeight: 800, color: PRT_C.text, margin: 0 } },
          React.createElement('i', { className: 'fa-solid fa-map-location-dot', style: { marginRight: 10, color: PRT_C.berry } }),
          'Parcelles & Référentiel MO'
        ),
        React.createElement('p', { style: { margin: '4px 0 0', fontSize: 12, color: PRT_C.textTer } },
          'Classification des parcelles BEE ONE par campagne — source : BR_Pointage (base de production JH)'
        )
      ),

      loading && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: PRT_C.textTer } },
        React.createElement('i', { className: 'fa-solid fa-circle-notch fa-spin', style: { fontSize: 24 } })
      ),

      error && React.createElement('div', {
        style: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', color: '#991b1b', fontSize: 13 },
      }, React.createElement('i', { className: 'fa-solid fa-circle-exclamation', style: { marginRight: 8 } }), error),

      !loading && !error && data && React.createElement(React.Fragment, null,

        React.createElement('div', { style: { display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' } },
          React.createElement(PRT_CampagneCard, {
            label: 'Campagne 2026/2027',
            subtitle: 'Parcelles avec pointage depuis le 01/07/2026',
            rows: rows2627,
            accent: PRT_C.green,
          }),
          React.createElement(PRT_CampagneCard, {
            label: 'Campagne 2025/2026',
            subtitle: 'Parcelles sans pointage depuis le 01/07/2026',
            rows: rowsPrev,
            accent: PRT_C.amber,
          })
        ),

        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
        },
          React.createElement('div', { style: { display: 'flex', gap: 6 } },
            [['2026/2027', rows2627, PRT_C.green], ['2025/2026', rowsPrev, PRT_C.amber]].map(function (e) {
              var camp = e[0]; var rws = e[1]; var color = e[2];
              var active = selectedCamp === camp;
              return React.createElement('button', {
                key: camp,
                onClick: function () { setSelectedCamp(camp); },
                style: {
                  padding: '6px 16px', borderRadius: 8,
                  border: '1px solid ' + (active ? color : PRT_C.border),
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  background: active ? color : PRT_C.surface,
                  color: active ? '#fff' : PRT_C.textSec,
                },
              }, camp + ' (' + rws.length + ')');
            })
          ),

          React.createElement('div', { style: { position: 'relative', flex: '1 1 200px', maxWidth: 320 } },
            React.createElement('i', {
              className: 'fa-solid fa-magnifying-glass',
              style: { position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: PRT_C.textTer, fontSize: 12 },
            }),
            React.createElement('input', {
              type: 'text',
              placeholder: 'Parcelle, variété, ferme…',
              value: search,
              onChange: function (e) { setSearch(e.target.value); },
              style: {
                width: '100%', boxSizing: 'border-box',
                padding: '7px 10px 7px 30px', borderRadius: 8,
                border: '1px solid ' + PRT_C.border, fontSize: 12, outline: 'none',
              },
            })
          )
        ),

        React.createElement('div', {
          style: { background: PRT_C.surface, border: '1px solid ' + PRT_C.border, borderRadius: 12, overflow: 'hidden' },
        },
          React.createElement(PRT_Table, { rows: currentRows, search: search })
        ),

        React.createElement('div', {
          style: { marginTop: 12, fontSize: 11, color: PRT_C.textTer },
        },
          React.createElement('i', { className: 'fa-solid fa-circle-info', style: { marginRight: 4 } }),
          'Source : BR_Pointage (production). ',
          'Campagne 2026/2027 = parcelles avec pointage depuis le 01/07/2026. ',
          'Les noms affichés sont les labels BEE ONE bruts — le référentiel personnalisé (noms Smart Berry + surfaces) est prévu en Phase 2.'
        )
      )
    );
  }

  window.ParcellesReferentielTab = ParcellesReferentielTab;
})();
