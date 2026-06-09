/*
 * BugReportsAdmin.jsx — vue admin des signalements de bug (Phase B).
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.BugReportsAdmin) afin d'éviter toute collision top-level avec app.jsx
 * (cf. crashes #75/#77). Aucune const/function top-level qui fuite.
 *
 * Props :
 *   - currentProfile : id/label du profil courant (string ou objet). Réservé aux
 *     profils admin (dg / rh). Si non-admin → message d'accès refusé.
 *
 * Données : GET /api/bug-reports?action=list-bugs (le token Bearer est injecté
 * automatiquement par le wrapper window.fetch d'app.jsx). Le contrôle de rôle
 * réel se fait côté serveur ; ce gate client est purement cosmétique.
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useCallback = React.useCallback;

  var ADMIN_PROFILES = ['dg', 'rh'];

  var STATUS_META = {
    nouveau: { label: 'Nouveau', color: '#b3261e', bg: '#fce8e6' },
    en_cours: { label: 'En cours', color: '#b06000', bg: '#fef3e0' },
    resolu: { label: 'Résolu', color: '#137333', bg: '#e6f4ea' }
  };

  function profileIdOf(p) {
    if (!p) return null;
    if (typeof p === 'string') return p;
    return p.id || null;
  }

  function profileLabelOf(p) {
    if (!p) return '';
    if (typeof p === 'string') return p;
    return p.label || p.name || p.id || '';
  }

  function formatDate(ms) {
    if (!ms) return '—';
    try {
      return new Date(ms).toLocaleString('fr-FR');
    } catch (e) {
      return '—';
    }
  }

  function StatusBadge(props) {
    var meta = STATUS_META[props.status] || { label: props.status || '?', color: '#444', bg: '#eee' };
    return React.createElement(
      'span',
      {
        style: {
          display: 'inline-block',
          padding: '2px 10px',
          borderRadius: '999px',
          fontSize: '12px',
          fontWeight: 700,
          color: meta.color,
          background: meta.bg
        }
      },
      meta.label
    );
  }

  function BugReportsAdminComponent(props) {
    var profileId = profileIdOf(props.currentProfile);
    var isAdmin = ADMIN_PROFILES.indexOf(profileId) >= 0;

    var bugsState = useState([]);
    var bugs = bugsState[0];
    var setBugs = bugsState[1];

    var loadingState = useState(false);
    var loading = loadingState[0];
    var setLoading = loadingState[1];

    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];

    var filterState = useState('tous');
    var filter = filterState[0];
    var setFilter = filterState[1];

    var updatingState = useState(null); // id en cours de mise à jour
    var updating = updatingState[0];
    var setUpdating = updatingState[1];

    var zoomState = useState(null); // photo_url agrandie
    var zoom = zoomState[0];
    var setZoom = zoomState[1];

    var load = useCallback(function () {
      setLoading(true);
      setError(null);
      var url = '/api/bug-reports?action=list-bugs';
      if (filter && filter !== 'tous') {
        url += '&status=' + encodeURIComponent(filter);
      }
      window.fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (json) {
          if (json && json.success && Array.isArray(json.bugs)) {
            setBugs(json.bugs);
          } else {
            setError((json && json.error) || 'Chargement impossible.');
          }
        })
        .catch(function () {
          setError('Erreur réseau. Réessayez.');
        })
        .then(function () {
          setLoading(false);
        });
    }, [filter]);

    useEffect(function () {
      if (isAdmin) load();
    }, [isAdmin, load]);

    function updateStatus(id, status) {
      if (updating) return;
      setUpdating(id);
      window.fetch('/api/bug-reports?action=update-bug-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: id, status: status })
      })
        .then(function (r) { return r.json(); })
        .then(function (json) {
          if (json && json.success) {
            load();
          } else {
            setError((json && json.error) || 'Mise à jour impossible.');
          }
        })
        .catch(function () {
          setError('Erreur réseau lors de la mise à jour.');
        })
        .then(function () {
          setUpdating(null);
        });
    }

    if (!isAdmin) {
      return React.createElement(
        'div',
        { style: { padding: '24px', color: '#888', fontSize: '14px' } },
        'Accès réservé aux administrateurs.'
      );
    }

    var filters = [
      ['tous', 'Tous'],
      ['nouveau', 'Nouveau'],
      ['en_cours', 'En cours'],
      ['resolu', 'Résolu']
    ];

    var filterBar = React.createElement(
      'div',
      { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' } },
      filters.map(function (f) {
        var active = filter === f[0];
        return React.createElement(
          'button',
          {
            key: f[0],
            type: 'button',
            onClick: function () { setFilter(f[0]); },
            style: {
              padding: '6px 14px',
              borderRadius: '999px',
              border: '1px solid ' + (active ? 'var(--berry, #b3261e)' : '#ccc'),
              background: active ? 'var(--berry, #b3261e)' : '#fff',
              color: active ? '#fff' : '#444',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer'
            }
          },
          f[1]
        );
      })
    );

    var content;
    if (loading) {
      content = React.createElement('div', { style: { padding: '24px', color: '#888' } }, 'Chargement…');
    } else if (error) {
      content = React.createElement(
        'div',
        { style: { padding: '16px', borderRadius: '8px', background: '#fce8e6', color: '#b3261e', fontSize: '14px' } },
        error,
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: load,
            style: { marginLeft: '12px', border: 'none', background: 'transparent', color: '#b3261e', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }
          },
          'Réessayer'
        )
      );
    } else if (!bugs.length) {
      content = React.createElement('div', { style: { padding: '24px', color: '#888', fontSize: '14px' } }, 'Aucun signalement.');
    } else {
      content = React.createElement(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
        bugs.map(function (bug) {
          var reporterName = (bug.reporter && bug.reporter.name) || '?';
          var reporterProfile = (bug.reporter && bug.reporter.profileId) || '';
          var device = bug.device || {};
          var rows = [
            ['Signalé par', reporterName + (reporterProfile ? ' (' + reporterProfile + ')' : '')],
            ['Écran', bug.screen || '—'],
            ['Date', formatDate(bug.created_at)],
            ['Navigateur', device.userAgent || '—'],
            ['Écran (px)', device.viewport || '—']
          ];

          var photoThumb = bug.photo_url
            ? React.createElement('img', {
                src: bug.photo_url,
                alt: 'Capture',
                onClick: function () { setZoom(bug.photo_url); },
                style: { maxWidth: '120px', maxHeight: '120px', borderRadius: '8px', border: '1px solid #eee', cursor: 'zoom-in', objectFit: 'cover' }
              })
            : null;

          var actions = [];
          if (bug.status !== 'en_cours') {
            actions.push(React.createElement(
              'button',
              {
                key: 'en_cours',
                type: 'button',
                disabled: updating === bug.id,
                onClick: function () { updateStatus(bug.id, 'en_cours'); },
                style: {
                  padding: '6px 12px', borderRadius: '8px', border: '1px solid #b06000',
                  background: '#fff', color: '#b06000', fontSize: '13px', fontWeight: 600,
                  cursor: updating === bug.id ? 'not-allowed' : 'pointer'
                }
              },
              'Marquer en cours'
            ));
          }
          if (bug.status !== 'resolu') {
            actions.push(React.createElement(
              'button',
              {
                key: 'resolu',
                type: 'button',
                disabled: updating === bug.id,
                onClick: function () { updateStatus(bug.id, 'resolu'); },
                style: {
                  padding: '6px 12px', borderRadius: '8px', border: '1px solid #137333',
                  background: '#fff', color: '#137333', fontSize: '13px', fontWeight: 600,
                  cursor: updating === bug.id ? 'not-allowed' : 'pointer'
                }
              },
              'Marquer résolu'
            ));
          }

          return React.createElement(
            'div',
            {
              key: bug.id,
              style: {
                border: '1px solid #e5e5e5', borderRadius: '12px', padding: '14px',
                background: '#fff', display: 'flex', gap: '14px', flexWrap: 'wrap'
              }
            },
            photoThumb,
            React.createElement(
              'div',
              { style: { flex: '1 1 240px', minWidth: '240px', display: 'flex', flexDirection: 'column', gap: '8px' } },
              React.createElement(
                'div',
                { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' } },
                React.createElement('div', { style: { fontSize: '14px', fontWeight: 600, color: '#222', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, bug.description || '(sans description)'),
                React.createElement(StatusBadge, { status: bug.status })
              ),
              React.createElement(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                rows.map(function (row) {
                  return React.createElement(
                    'div',
                    { key: row[0], style: { display: 'flex', gap: '8px', fontSize: '12px', lineHeight: 1.4 } },
                    React.createElement('span', { style: { color: '#888', minWidth: '92px', flexShrink: 0 } }, row[0]),
                    React.createElement('span', { style: { color: '#444', wordBreak: 'break-word' } }, row[1])
                  );
                })
              ),
              actions.length
                ? React.createElement('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' } }, actions)
                : null
            )
          );
        })
      );
    }

    var zoomOverlay = zoom
      ? React.createElement(
          'div',
          {
            onClick: function () { setZoom(null); },
            style: {
              position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px'
            }
          },
          React.createElement('img', {
            src: zoom,
            alt: 'Capture agrandie',
            style: { maxWidth: '100%', maxHeight: '100%', borderRadius: '8px' }
          })
        )
      : null;

    return React.createElement(
      'div',
      { style: { padding: '16px', maxWidth: '900px' } },
      React.createElement('div', { style: { fontSize: '18px', fontWeight: 700, marginBottom: '14px' } }, '🐛 Bugs signalés'),
      filterBar,
      content,
      zoomOverlay
    );
  }

  window.BugReportsAdmin = BugReportsAdminComponent;
})();
