/*
 * InventaireMouvementsPopup.jsx — Popup READ-ONLY du détail des mouvements de
 * stock d'un article (pour un lieu), borné à la DATE D'INVENTAIRE sélectionnée
 * (écran Inventaire / Magasinier).
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.InventaireMouvementsPopup) afin d'éviter toute collision top-level avec
 * app.jsx (cf. crashes #75/#77). Tous les identifiants internes sont préfixés IMP_.
 *
 * AUCUNE écriture : pur affichage. Appelle
 *   GET /api/stock?action=get-article-history&article=...&lieu_id=...
 * récupère le grand livre de l'article (entries triées par date asc avec
 * quantité signée), puis :
 *   - filtre côté client les mouvements de date <= dateInventaire (incluse) ;
 *   - recalcule un cumul courant sur ce sous-ensemble (le cumul_apres renvoyé par
 *     le backend inclut aussi les mouvements POSTÉRIEURS à la date d'inventaire,
 *     donc on ne peut pas le réutiliser tel quel) ;
 *   - le dernier cumul doit finir EXACTEMENT sur le SOLDE de la ligne inventaire.
 *
 * Props :
 *   - article (string)        article_ref ou article_nom (param de matching backend)
 *   - article_nom (string)    libellé affiché
 *   - lieu_id (string)        lieu de la ligne inventaire (filtre)
 *   - unite (string)          unité stock
 *   - dateInventaire (string) 'YYYY-MM-DD' borne haute incluse
 *   - soldeAttendu (number)   solde affiché sur la ligne (contrôle de cohérence)
 *   - onClose () => void
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var IMP_C = {
    berry: 'var(--berry)',
    textPrimary: '#1c1c1a',
    textSecondary: '#5f5e5a',
    textTertiary: '#8a8985',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    border: 'rgba(0,0,0,0.12)',
    green: '#1e8449',
    amber: '#b9770e',
    red: '#c0392b'
  };
  var IMP_TYPE_LABELS = {
    reception: 'Réception',
    sortie: 'Sortie',
    transfert: 'Transfert',
    consommation: 'Consommation',
    conso: 'Consommation',
    ajustement: 'Ajustement',
    inventaire: 'Inventaire ouverture'
  };
  function IMP_typeLabel(t) {
    return IMP_TYPE_LABELS[t] || t || '—';
  }
  function IMP_fmtNum(n, dec) {
    var x = parseFloat(n);
    if (!isFinite(x)) return '—';
    return x.toLocaleString('fr-FR', {
      minimumFractionDigits: dec,
      maximumFractionDigits: dec
    });
  }
  function IMP_fmtDateFr(iso) {
    if (!iso) return '—';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return iso;
    return m[3] + '/' + m[2] + '/' + m[1];
  }
  function IMP_Th(props) {
    return React.createElement('th', {
      style: {
        textAlign: props.align || 'left',
        fontSize: 10,
        fontWeight: 600,
        color: IMP_C.textTertiary,
        padding: '6px 8px',
        borderBottom: '1px solid ' + IMP_C.border,
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        position: 'sticky',
        top: 0,
        background: IMP_C.surface2
      }
    }, props.children);
  }
  function IMP_Td(props) {
    return React.createElement('td', {
      style: {
        textAlign: props.align || 'left',
        fontSize: 12,
        color: props.color || IMP_C.textPrimary,
        padding: '6px 8px',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        fontWeight: props.bold ? 700 : 400
      }
    }, props.children);
  }
  function InventaireMouvementsPopup(props) {
    var article = props.article || props.article_nom || '';
    var articleNom = props.article_nom || article;
    var lieuId = props.lieu_id || '';
    var unite = props.unite || '';
    var dateInventaire = props.dateInventaire || '';
    var soldeAttendu = props.soldeAttendu;
    var onClose = props.onClose || function () {};
    var st = useState({
      loading: true,
      error: null,
      data: null
    });
    var state = st[0];
    var setState = st[1];
    useEffect(function () {
      var params = [];
      if (article) params.push('article=' + encodeURIComponent(article));
      if (lieuId) params.push('lieu_id=' + encodeURIComponent(lieuId));
      var url = '/api/stock?action=get-article-history&' + params.join('&');
      var aborted = false;
      setState({
        loading: true,
        error: null,
        data: null
      });
      fetch(url).then(function (r) {
        return r.json();
      }).then(function (j) {
        if (aborted) return;
        if (j && j.success) setState({
          loading: false,
          error: null,
          data: j
        });else setState({
          loading: false,
          error: j && j.error || 'Erreur de chargement',
          data: null
        });
      }).catch(function (e) {
        if (aborted) return;
        setState({
          loading: false,
          error: e && e.message || 'Erreur réseau',
          data: null
        });
      });
      return function () {
        aborted = true;
      };
    }, [article, lieuId]);
    var data = state.data || {};
    var resolvedUnite = data.article && data.article.unite || unite || '';

    // Filtre date <= dateInventaire (incluse) + recalcul du cumul courant sur le
    // sous-ensemble (le cumul_apres backend inclut les mouvements postérieurs).
    var rawEntries = data.entries || [];
    var bounded = dateInventaire ? rawEntries.filter(function (e) {
      return !e.date || e.date <= dateInventaire;
    }) : rawEntries.slice();
    var running = 0;
    var rows = bounded.map(function (e) {
      var q = parseFloat(e.quantite) || 0;
      running = Math.round((running + q) * 100) / 100;
      return {
        date: e.date,
        type: e.type,
        sens: e.sens,
        numero: e.numero,
        lieu_id: e.lieu_id,
        quantite: Math.round(q * 100) / 100,
        solde_courant: running,
        unite: e.unite || resolvedUnite
      };
    });
    var soldeFinal = rows.length ? rows[rows.length - 1].solde_courant : 0;
    var ecart = soldeAttendu != null && isFinite(parseFloat(soldeAttendu)) ? Math.round((soldeFinal - parseFloat(soldeAttendu)) * 100) / 100 : null;
    var overlay = {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.45)',
      zIndex: 9000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16
    };
    var card = {
      background: IMP_C.surface,
      borderRadius: 14,
      width: '100%',
      maxWidth: 760,
      maxHeight: '90vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    };
    var body;
    if (state.loading) {
      body = React.createElement('div', {
        style: {
          padding: 40,
          textAlign: 'center',
          color: IMP_C.textSecondary
        }
      }, 'Chargement des mouvements…');
    } else if (state.error) {
      body = React.createElement('div', {
        style: {
          padding: 40,
          textAlign: 'center',
          color: IMP_C.red
        }
      }, 'Erreur : ' + state.error);
    } else if (rows.length === 0) {
      body = React.createElement('div', {
        style: {
          padding: 40,
          textAlign: 'center',
          color: IMP_C.textSecondary
        }
      }, 'Aucun mouvement pour cet article' + (lieuId ? ' au lieu ' + lieuId : '') + (dateInventaire ? ' jusqu’au ' + IMP_fmtDateFr(dateInventaire) : '') + '.');
    } else {
      body = React.createElement('div', {
        style: {
          overflow: 'auto',
          padding: '0 16px 8px'
        }
      }, React.createElement('table', {
        style: {
          width: '100%',
          borderCollapse: 'collapse'
        }
      }, React.createElement('thead', null, React.createElement('tr', null, React.createElement(IMP_Th, null, 'Date'), React.createElement(IMP_Th, null, 'Type'), React.createElement(IMP_Th, null, 'Lieu'), React.createElement(IMP_Th, {
        align: 'right'
      }, 'Quantité'), React.createElement(IMP_Th, {
        align: 'right'
      }, 'Solde courant'))), React.createElement('tbody', null, rows.map(function (r, i) {
        var positif = r.quantite >= 0;
        return React.createElement('tr', {
          key: i
        }, React.createElement(IMP_Td, null, IMP_fmtDateFr(r.date)), React.createElement(IMP_Td, null, IMP_typeLabel(r.type) + (r.numero ? ' · ' + r.numero : '')), React.createElement(IMP_Td, null, r.lieu_id || '—'), React.createElement(IMP_Td, {
          align: 'right',
          bold: true,
          color: positif ? IMP_C.green : IMP_C.red
        }, (positif ? '+' : '−') + IMP_fmtNum(Math.abs(r.quantite), 2)), React.createElement(IMP_Td, {
          align: 'right',
          bold: true
        }, IMP_fmtNum(r.solde_courant, 2)));
      }))));
    }
    var headerSub = articleNom + (lieuId ? ' · ' + lieuId : '') + (resolvedUnite ? ' · ' + resolvedUnite : '') + (dateInventaire ? ' · solde au ' + IMP_fmtDateFr(dateInventaire) : '');
    var footer = !state.loading && !state.error && rows.length > 0 ? React.createElement('div', {
      style: {
        padding: '10px 18px',
        borderTop: '1px solid ' + IMP_C.border,
        background: IMP_C.surface2,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8
      }
    }, React.createElement('span', {
      style: {
        fontSize: 12,
        color: IMP_C.textSecondary
      }
    }, rows.length + ' mouvement(s)'), React.createElement('span', {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: IMP_C.textPrimary
      }
    }, 'Solde final : ' + IMP_fmtNum(soldeFinal, 2) + (resolvedUnite ? ' ' + resolvedUnite : ''), ecart != null && Math.abs(ecart) >= 0.01 ? React.createElement('span', {
      style: {
        marginLeft: 8,
        fontSize: 11,
        fontWeight: 600,
        color: IMP_C.amber
      }
    }, '(écart inventaire ' + IMP_fmtNum(ecart, 2) + ')') : null)) : null;
    return React.createElement('div', {
      style: overlay,
      onClick: onClose
    }, React.createElement('div', {
      style: card,
      onClick: function (e) {
        e.stopPropagation();
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 18px',
        borderBottom: '1px solid ' + IMP_C.border,
        background: IMP_C.surface
      }
    }, React.createElement('div', null, React.createElement('div', {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: IMP_C.textPrimary
      }
    }, 'Détail des mouvements'), React.createElement('div', {
      style: {
        fontSize: 12,
        color: IMP_C.textSecondary,
        marginTop: 2
      }
    }, headerSub)), React.createElement('button', {
      onClick: onClose,
      style: {
        border: 'none',
        background: 'transparent',
        fontSize: 22,
        lineHeight: 1,
        color: IMP_C.textTertiary,
        cursor: 'pointer',
        padding: 4
      },
      'aria-label': 'Fermer'
    }, '×')), body, footer));
  }
  window.InventaireMouvementsPopup = InventaireMouvementsPopup;
})();
