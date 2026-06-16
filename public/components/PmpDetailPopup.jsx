/*
 * PmpDetailPopup.jsx — Popup READ-ONLY du détail du calcul du coût PMP d'un
 * article (écran Inventaire / Magasinier).
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.PmpDetailPopup) afin d'éviter toute collision top-level avec app.jsx
 * (cf. crashes #75/#77). Tous les identifiants internes sont préfixés PDP_.
 *
 * AUCUNE écriture, AUCUNE re-valorisation : pur affichage. Appelle
 *   GET /api/stock?action=get-pmp-detail&article_ref=...&article_nom=...&lieu=...
 * et rend 2 colonnes :
 *   (1) PMP actuel (grand livre) — bons d'entrée + inventaire ouverture, PMP =
 *       la valeur affichée (articles_catalog.prix_pmp).
 *   (2) PMP au prix facturé — lignes factures TIMAC, PMP facturé pondéré OU la
 *       note de divergence d'unité (aucune densité fabriquée).
 *
 * Props :
 *   - article_ref (string)
 *   - article_nom (string)
 *   - unite (string)         unité stock (fallback affichage)
 *   - lieu (string|null)     lieu_id optionnel
 *   - onClose () => void
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;

  var PDP_C = {
    berry: 'var(--berry)',
    textPrimary: '#1c1c1a',
    textSecondary: '#5f5e5a',
    textTertiary: '#8a8985',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    border: 'rgba(0,0,0,0.12)',
    green: '#1e8449',
    amber: '#b9770e',
    red: '#c0392b',
  };

  function PDP_fmtNum(n, dec) {
    var x = parseFloat(n);
    if (!isFinite(x)) return '—';
    return x.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function PDP_SourceBadge(props) {
    var src = props.source;
    var label = src === 'bon_entree' ? "Bon d'entrée" : src === 'inventaire' ? 'Inventaire 30/06' : (src || '—');
    var col = src === 'bon_entree' ? PDP_C.green : src === 'inventaire' ? PDP_C.amber : PDP_C.textTertiary;
    return React.createElement('span', {
      style: { fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10, background: 'rgba(0,0,0,0.05)', color: col },
    }, label);
  }

  function PDP_Th(props) {
    return React.createElement('th', {
      style: { textAlign: props.align || 'left', fontSize: 10, fontWeight: 600, color: PDP_C.textTertiary, padding: '6px 8px', borderBottom: '1px solid ' + PDP_C.border, textTransform: 'uppercase', letterSpacing: '0.03em' },
    }, props.children);
  }

  function PDP_Td(props) {
    return React.createElement('td', {
      style: { textAlign: props.align || 'left', fontSize: 12, color: PDP_C.textPrimary, padding: '6px 8px', borderBottom: '1px solid rgba(0,0,0,0.05)' },
    }, props.children);
  }

  function PmpDetailPopup(props) {
    var articleRef = props.article_ref || '';
    var articleNom = props.article_nom || '';
    var lieu = props.lieu || '';
    var uniteFallback = props.unite || '';
    var onClose = props.onClose || function () {};

    var st = useState({ loading: true, error: null, data: null });
    var state = st[0];
    var setState = st[1];

    useEffect(function () {
      var params = [];
      if (articleRef) params.push('article_ref=' + encodeURIComponent(articleRef));
      if (articleNom) params.push('article_nom=' + encodeURIComponent(articleNom));
      if (lieu) params.push('lieu=' + encodeURIComponent(lieu));
      var url = '/api/stock?action=get-pmp-detail&' + params.join('&');
      var aborted = false;
      setState({ loading: true, error: null, data: null });
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (aborted) return;
          if (j && j.success) setState({ loading: false, error: null, data: j });
          else setState({ loading: false, error: (j && j.error) || 'Erreur de chargement', data: null });
        })
        .catch(function (e) {
          if (aborted) return;
          setState({ loading: false, error: (e && e.message) || 'Erreur réseau', data: null });
        });
      return function () { aborted = true; };
    }, [articleRef, articleNom, lieu]);

    var data = state.data || {};
    var uniteStock = data.unite_stock || uniteFallback || '';
    var gl = data.grand_livre || {};
    var fac = data.facture || {};
    var glLignes = gl.lignes || [];
    var facLignes = fac.lignes || [];

    var overlay = {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    };
    var card = {
      background: PDP_C.surface, borderRadius: 14, width: '100%', maxWidth: 920,
      maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    };

    function colPmp(value, sub) {
      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
        React.createElement('span', { style: { fontSize: 22, fontWeight: 800, color: PDP_C.berry } },
          value == null ? '—' : PDP_fmtNum(value, 2) + ' DH'),
        React.createElement('span', { style: { fontSize: 10, color: PDP_C.textTertiary } }, sub)
      );
    }

    var glPanel = React.createElement('div', { style: { flex: '1 1 0', minWidth: 280, padding: 14, background: PDP_C.surface2, borderRadius: 10 } },
      React.createElement('div', { style: { fontSize: 13, fontWeight: 700, color: PDP_C.textPrimary, marginBottom: 2 } }, 'PMP actuel (grand livre)'),
      React.createElement('div', { style: { fontSize: 10, color: PDP_C.textTertiary, marginBottom: 10 } }, 'Bons d’entrée + inventaire d’ouverture 30/06'),
      colPmp(gl.pmp_pondere, 'Valeur affichée · ' + (gl.prix_pmp_source === 'bon_entree' ? "prix d'un bon d'entrée réel" : gl.prix_pmp_source === 'inventaire' ? 'snapshot inventaire 30/06' : 'source PMP')),
      React.createElement('div', { style: { marginTop: 6, marginBottom: 10 } }, React.createElement(PDP_SourceBadge, { source: gl.prix_pmp_source })),
      glLignes.length === 0
        ? React.createElement('div', { style: { fontSize: 12, color: PDP_C.textSecondary, padding: '8px 0' } }, 'Aucune ligne d’entrée grand livre pour cet article.')
        : React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement(PDP_Th, null, 'Date'),
              React.createElement(PDP_Th, null, 'Lieu'),
              React.createElement(PDP_Th, { align: 'right' }, 'Qté'),
              React.createElement(PDP_Th, null, 'Unité'))),
            React.createElement('tbody', null, glLignes.map(function (l, i) {
              return React.createElement('tr', { key: i },
                React.createElement(PDP_Td, null, l.date || '—'),
                React.createElement(PDP_Td, null, (l.lieu || '').split('|').pop() || '—'),
                React.createElement(PDP_Td, { align: 'right' }, PDP_fmtNum(l.qte, 2)),
                React.createElement(PDP_Td, null, l.unite || uniteStock || '—'));
            }))
          ),
      React.createElement('div', { style: { fontSize: 10, color: PDP_C.textTertiary, marginTop: 8, fontStyle: 'italic' } },
        'Les prix par ligne du grand livre ne sont pas conservés en base : seule la valeur PMP finale l’est.')
    );

    var facCoherence = fac.coherence_unite;
    var facNote = fac.note;
    var facPanel = React.createElement('div', { style: { flex: '1 1 0', minWidth: 280, padding: 14, background: PDP_C.surface2, borderRadius: 10 } },
      React.createElement('div', { style: { fontSize: 13, fontWeight: 700, color: PDP_C.textPrimary, marginBottom: 2 } }, 'PMP au prix facturé'),
      React.createElement('div', { style: { fontSize: 10, color: PDP_C.textTertiary, marginBottom: 10 } }, 'Factures fournisseur (TIMAC)'),
      facCoherence === 'divergente' || facCoherence === 'inconnue'
        ? React.createElement('div', { style: { fontSize: 12, color: PDP_C.amber, background: 'rgba(185,119,14,0.08)', padding: '8px 10px', borderRadius: 8, marginBottom: 10 } }, facNote || 'Calcul non disponible.')
        : colPmp(fac.pmp_pondere, 'Pondéré Σ(qté×PU)/Σ(qté) · unité ' + (fac.unite_dominante || uniteStock || '?')),
      React.createElement('div', { style: { height: 10 } }),
      facLignes.length === 0
        ? React.createElement('div', { style: { fontSize: 12, color: PDP_C.textSecondary, padding: '8px 0' } }, 'Aucune facture TIMAC pour cet article.')
        : React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            React.createElement('thead', null, React.createElement('tr', null,
              React.createElement(PDP_Th, null, 'Facture'),
              React.createElement(PDP_Th, null, 'Date'),
              React.createElement(PDP_Th, { align: 'right' }, 'Qté'),
              React.createElement(PDP_Th, null, 'Unité'),
              React.createElement(PDP_Th, { align: 'right' }, 'PU (DH)'))),
            React.createElement('tbody', null, facLignes.map(function (l, i) {
              return React.createElement('tr', { key: i },
                React.createElement(PDP_Td, null, l.numero_facture || '—'),
                React.createElement(PDP_Td, null, l.date_facture || '—'),
                React.createElement(PDP_Td, { align: 'right' }, PDP_fmtNum(l.qte, 2)),
                React.createElement(PDP_Td, null, l.unite || '—'),
                React.createElement(PDP_Td, { align: 'right' }, PDP_fmtNum(l.prix_unitaire, 2)));
            }))
          )
    );

    var body;
    if (state.loading) {
      body = React.createElement('div', { style: { padding: 40, textAlign: 'center', color: PDP_C.textSecondary } }, 'Chargement du détail PMP…');
    } else if (state.error) {
      body = React.createElement('div', { style: { padding: 40, textAlign: 'center', color: PDP_C.red } }, 'Erreur : ' + state.error);
    } else {
      body = React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 14, padding: 16 } }, glPanel, facPanel);
    }

    return React.createElement('div', { style: overlay, onClick: onClose },
      React.createElement('div', { style: card, onClick: function (e) { e.stopPropagation(); } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid ' + PDP_C.border, position: 'sticky', top: 0, background: PDP_C.surface, zIndex: 1 } },
          React.createElement('div', null,
            React.createElement('div', { style: { fontSize: 15, fontWeight: 800, color: PDP_C.textPrimary } }, 'Détail du coût PMP'),
            React.createElement('div', { style: { fontSize: 12, color: PDP_C.textSecondary, marginTop: 2 } }, (data.article || articleNom || articleRef || '') + (uniteStock ? ' · unité stock ' + uniteStock : ''))
          ),
          React.createElement('button', {
            onClick: onClose,
            style: { border: 'none', background: 'transparent', fontSize: 22, lineHeight: 1, color: PDP_C.textTertiary, cursor: 'pointer', padding: 4 },
            'aria-label': 'Fermer',
          }, '×')
        ),
        body
      )
    );
  }

  window.PmpDetailPopup = PmpDetailPopup;
})();
