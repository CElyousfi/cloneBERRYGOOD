/*
 * MagBonsCommandeTab.jsx — Liste de TOUS les bons de commande (tous statuts)
 * pour le profil magasinier, en LECTURE, SANS AUCUN PRIX NI MONTANT.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.MagBonsCommandeTab) afin d'éviter toute collision top-level avec
 * app.jsx (cf. crashes #75/#77 — mémoire umd-global-collision-smoke-load).
 * Aucune const/function top-level qui fuite — tous les identifiants internes
 * sont préfixés MBC_.
 *
 * Contexte métier : le magasinier gère la réception physique des BDC, pas les
 * aspects financiers. Cette page complète MagBdcReceptionTab ("BDC à
 * réceptionner") qui, elle, filtre sur valide_dg/envoye et affiche le Total
 * TTC. Ici : tous les statuts, aucun prix — ni dans la liste, ni dans le
 * détail d'un BDC.
 *
 * Backend : action list-bdc (functions/index.js) retourne le document
 * purchase_orders complet (total_ttc, prix_unitaire, montant_* compris). Le
 * masquage se fait CÔTÉ CLIENT UNIQUEMENT : ce composant ne lit/affiche
 * JAMAIS total_ht, total_tva, total_ttc, ni prix_unitaire/montant_ht/
 * montant_tva/montant_ttc sur les lignes d'articles.
 *
 * Props :
 *   - currentProfile : id du profil courant (string)
 *   - profileData    : objet profil (non utilisé pour l'instant, écran 100% lecture)
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useMemo = React.useMemo;
  var useEffect = React.useEffect;
  var MBC_STATUS_META = {
    brouillon: {
      label: 'Brouillon',
      cls: 'brouillon'
    },
    en_attente_chef: {
      label: 'Attente Chef',
      cls: 'en-attente'
    },
    valide_chef: {
      label: 'Validé Chef',
      cls: 'valide'
    },
    en_attente_dg: {
      label: 'Attente DG',
      cls: 'en-attente'
    },
    valide_dg: {
      label: 'Validé DG',
      cls: 'valide'
    },
    envoye: {
      label: 'Envoyé',
      cls: 'envoye'
    },
    virement_lance: {
      label: 'Virement lancé',
      cls: 'en-attente'
    },
    virement_signe: {
      label: 'Virement signé',
      cls: 'valide'
    },
    rejete: {
      label: 'Rejeté',
      cls: 'rejete'
    },
    rejete_dg: {
      label: 'Rejeté DG',
      cls: 'rejete'
    },
    annule: {
      label: 'Annulé',
      cls: 'rejete'
    }
  };
  var MBC_DELIVERY_META = {
    complet: {
      label: 'Complet',
      cls: 'valide'
    },
    partiel: {
      label: 'Partiel',
      cls: 'en-attente'
    },
    non_livre: {
      label: 'Non livré',
      cls: 'brouillon'
    }
  };
  function mbcStatusMeta(status) {
    return MBC_STATUS_META[status] || {
      label: status || '—',
      cls: 'brouillon'
    };
  }
  function mbcDeliveryMeta(status) {
    return MBC_DELIVERY_META[status] || MBC_DELIVERY_META.non_livre;
  }
  function mbcFmtDate(v) {
    if (!v) return '—';
    // created_at est un timestamp epoch (Date.now()) côté backend BDC.
    var d = typeof v === 'number' ? new Date(v) : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('fr-FR');
  }
  function MBC_Badge(props) {
    return /*#__PURE__*/React.createElement("span", {
      className: 'status-badge ' + props.cls
    }, props.label);
  }
  function MagBonsCommandeTab() {
    var listState = useState([]);
    var bdcList = listState[0];
    var setBdcList = listState[1];
    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];
    var errState = useState(null);
    var err = errState[0];
    var setErr = errState[1];
    var queryState = useState('');
    var query = queryState[0];
    var setQuery = queryState[1];
    var detailState = useState(null);
    var detail = detailState[0];
    var setDetail = detailState[1];

    // Reçu/Reliquat par article pour le BDC ouvert dans la popup (lecture seule,
    // aucun prix). Reset à chaque ouverture/fermeture — cf. openDetail/closeDetail.
    var detailReceptionState = useState(null);
    var detailReception = detailReceptionState[0];
    var setDetailReception = detailReceptionState[1];
    function openDetail(b) {
      setDetail(b);
      setDetailReception({
        loading: true,
        byArticle: {}
      });
      fetch('/api/stock?action=list-bl&bdc_id=' + b.id).then(function (r) {
        return r.json();
      }).then(function (json) {
        var bls = json && json.success ? json.bls || [] : [];
        var delivery = window.BdcReceptionUtils.computeDeliveryData(b.items, bls);
        var byArticle = {};
        delivery.forEach(function (d) {
          byArticle[d.article] = d;
        });
        setDetailReception({
          loading: false,
          byArticle: byArticle
        });
      }).catch(function () {
        setDetailReception({
          loading: false,
          byArticle: {}
        });
      });
    }
    function closeDetail() {
      setDetail(null);
      setDetailReception(null);
    }
    useEffect(function () {
      setLoading(true);
      fetch('/api/stock?action=list-bdc').then(function (r) {
        return r.json();
      }).then(function (json) {
        if (json && json.success) {
          setBdcList(json.bdc || []);
        } else {
          setErr(json && json.error || 'Erreur de chargement des bons de commande');
        }
      }).catch(function () {
        setErr('Erreur réseau');
      }).finally(function () {
        setLoading(false);
      });
    }, []);
    var visible = useMemo(function () {
      var q = query.trim().toLowerCase();
      if (!q) return bdcList;
      return bdcList.filter(function (b) {
        var numero = (b.numero || '').toLowerCase();
        var fournisseur = (b.fournisseur && b.fournisseur.nom || '').toLowerCase();
        return numero.indexOf(q) !== -1 || fournisseur.indexOf(q) !== -1;
      });
    }, [bdcList, query]);
    if (loading) {
      return /*#__PURE__*/React.createElement("div", {
        style: {
          textAlign: 'center',
          padding: 60
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-spinner fa-spin",
        style: {
          fontSize: 32,
          color: 'var(--berry)'
        }
      }));
    }
    return /*#__PURE__*/React.createElement("div", {
      className: "fade-in"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
        flexWrap: 'wrap',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        margin: 0
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-file-contract",
      style: {
        marginRight: 8,
        color: 'var(--berry)'
      }
    }), "Bons de Commande"), /*#__PURE__*/React.createElement("input", {
      type: "search",
      placeholder: "Rechercher (n\xB0 BDC, fournisseur\u2026)",
      value: query,
      onChange: function (e) {
        setQuery(e.target.value);
      },
      style: {
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 12,
        minWidth: 260
      }
    })), err ? /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#FCEBEB',
        color: '#A32D2D',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 13,
        marginBottom: 16
      }
    }, err) : null, /*#__PURE__*/React.createElement("div", {
      className: "panel"
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        marginTop: 0,
        marginBottom: 12,
        fontSize: 13,
        color: 'var(--gray-400)'
      }
    }, visible.length, " bon", visible.length === 1 ? '' : 's', " de commande"), visible.length === 0 ? /*#__PURE__*/React.createElement("p", {
      style: {
        color: 'var(--gray-400)',
        textAlign: 'center',
        padding: 20
      }
    }, "Aucun bon de commande.") : /*#__PURE__*/React.createElement("div", {
      className: "table-responsive"
    }, /*#__PURE__*/React.createElement("table", {
      className: "data-table"
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "N\xB0 BDC"), /*#__PURE__*/React.createElement("th", null, "Date"), /*#__PURE__*/React.createElement("th", null, "Fournisseur"), /*#__PURE__*/React.createElement("th", null, "Ferme"), /*#__PURE__*/React.createElement("th", null, "Articles"), /*#__PURE__*/React.createElement("th", null, "Statut"), /*#__PURE__*/React.createElement("th", null, "Livraison"))), /*#__PURE__*/React.createElement("tbody", null, visible.map(function (b) {
      var statusMeta = mbcStatusMeta(b.status);
      var deliveryMeta = mbcDeliveryMeta(b.delivery_status);
      return /*#__PURE__*/React.createElement("tr", {
        key: b.id,
        onClick: function () {
          openDetail(b);
        },
        style: {
          cursor: 'pointer'
        }
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          fontWeight: 700,
          color: 'var(--berry)',
          fontSize: 12
        }
      }, b.numero), /*#__PURE__*/React.createElement("td", null, mbcFmtDate(b.created_at)), /*#__PURE__*/React.createElement("td", {
        style: {
          fontWeight: 600
        }
      }, b.fournisseur && b.fournisseur.nom || '—'), /*#__PURE__*/React.createElement("td", null, b.ferme || '—'), /*#__PURE__*/React.createElement("td", {
        style: {
          textAlign: 'center'
        }
      }, b.items && b.items.length || 0), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(MBC_Badge, {
        cls: statusMeta.cls,
        label: statusMeta.label
      })), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement(MBC_Badge, {
        cls: deliveryMeta.cls,
        label: deliveryMeta.label
      })));
    }))))), detail ? /*#__PURE__*/React.createElement("div", {
      className: "modal-overlay",
      onClick: function (e) {
        if (e.target === e.currentTarget) closeDetail();
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal-content",
      style: {
        maxWidth: 640,
        maxHeight: '85vh',
        overflowY: 'auto'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: 'var(--berry)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-file-contract",
      style: {
        marginRight: 8
      }
    }), "BDC ", detail.numero), /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#f8f8f8',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        fontSize: 13,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, "Fournisseur :"), " ", detail.fournisseur && detail.fournisseur.nom || '—'), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, "Ferme :"), " ", detail.ferme || '—'), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, "Date :"), " ", mbcFmtDate(detail.created_at)), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("strong", null, "Statut :"), " ", /*#__PURE__*/React.createElement(MBC_Badge, {
      cls: mbcStatusMeta(detail.status).cls,
      label: mbcStatusMeta(detail.status).label
    }))), /*#__PURE__*/React.createElement("h4", {
      style: {
        marginBottom: 8
      }
    }, "Articles"), /*#__PURE__*/React.createElement("table", {
      className: "data-table",
      style: {
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "D\xE9signation"), /*#__PURE__*/React.createElement("th", null, "Quantit\xE9"), /*#__PURE__*/React.createElement("th", null, "Unit\xE9"), /*#__PURE__*/React.createElement("th", null, "Re\xE7u"), /*#__PURE__*/React.createElement("th", null, "Reliquat"))), /*#__PURE__*/React.createElement("tbody", null, (detail.items || []).map(function (it, idx) {
      var d = detailReception && detailReception.byArticle ? detailReception.byArticle[it.article] : null;
      var loadingReception = detailReception && detailReception.loading;
      return /*#__PURE__*/React.createElement("tr", {
        key: idx
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          fontWeight: 600
        }
      }, it.article), /*#__PURE__*/React.createElement("td", {
        style: {
          textAlign: 'center'
        }
      }, it.quantite), /*#__PURE__*/React.createElement("td", null, it.unite || '—'), /*#__PURE__*/React.createElement("td", {
        style: {
          textAlign: 'center'
        }
      }, loadingReception ? '…' : d ? d.qLiv : 0), /*#__PURE__*/React.createElement("td", {
        style: {
          textAlign: 'center',
          fontWeight: 700,
          color: d && d.reste <= 0 ? 'var(--gray-400)' : 'var(--berry)'
        }
      }, loadingReception ? '…' : d ? d.reste : it.quantite));
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: function () {
        closeDetail();
      },
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid #ddd',
        background: '#fff',
        cursor: 'pointer',
        fontSize: 13
      }
    }, "Fermer")))) : null);
  }
  window.MagBonsCommandeTab = MagBonsCommandeTab;
})();
