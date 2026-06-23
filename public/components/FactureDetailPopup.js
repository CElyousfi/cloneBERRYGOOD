/*
 * FactureDetailPopup.jsx — Popup READ-ONLY du détail d'une facture (écrans
 * Factures Achats + Factures Finance).
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.FactureDetailPopup) afin d'éviter toute collision top-level avec
 * app.jsx (cf. crashes #75/#77/#200). Tous les identifiants internes sont
 * préfixés FDP_.
 *
 * AUCUNE écriture, AUCUN fetch Firestore : pur affichage. Les données viennent
 * de l'objet `facture` déjà chargé dans la liste du tab (props). La TVA par
 * ligne RÉUTILISE EXACTEMENT la logique v5 de l'export Excel via
 * window.FactureExportUtils.buildFactureLines(facture) — mêmes chiffres que
 * l'export (taux saisi / non déterminé, résidu, total TVA = TTC − HT).
 *
 * Props :
 *   - facture (object)        la facture telle que dans le state de la liste
 *   - statusLabels (object)   map payment_status → libellé capitalisé
 *   - onClose () => void
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useEffect = React.useEffect;
  var FDP_C = {
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

  /** Format a number with fixed decimals, '—' if not finite. */
  function FDP_fmtMoney(n) {
    var x = parseFloat(n);
    if (!isFinite(x)) return '—';
    return x.toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  function FDP_fmtQty(n) {
    var x = parseFloat(n);
    if (!isFinite(x)) return '—';
    return x.toLocaleString('fr-FR', {
      maximumFractionDigits: 3
    });
  }

  /** Taux fraction (0.2) → '20 %' ; null → '—'. */
  function FDP_fmtTaux(rate) {
    if (rate == null) return '—';
    var x = parseFloat(rate);
    if (!isFinite(x)) return '—';
    return (x * 100).toLocaleString('fr-FR', {
      maximumFractionDigits: 2
    }) + ' %';
  }
  function FDP_sourceLabel(source) {
    if (source === 'saisi') return 'Saisi';
    return 'Non déterminé';
  }
  function FDP_Th(props) {
    return React.createElement('th', {
      style: {
        textAlign: props.align || 'left',
        fontSize: 10,
        fontWeight: 600,
        color: FDP_C.textTertiary,
        padding: '8px 10px',
        borderBottom: '1px solid ' + FDP_C.border,
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
        whiteSpace: 'nowrap'
      }
    }, props.children);
  }
  function FDP_Td(props) {
    return React.createElement('td', {
      style: {
        textAlign: props.align || 'left',
        fontSize: 12,
        color: props.muted ? FDP_C.textTertiary : FDP_C.textPrimary,
        padding: '7px 10px',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        fontWeight: props.bold ? 700 : 400
      }
    }, props.children);
  }

  /** En-tête : libellé + valeur. */
  function FDP_HeadField(props) {
    return React.createElement('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        minWidth: 120
      }
    }, React.createElement('span', {
      style: {
        fontSize: 10,
        fontWeight: 600,
        color: FDP_C.textTertiary,
        textTransform: 'uppercase',
        letterSpacing: '0.03em'
      }
    }, props.label), React.createElement('span', {
      style: {
        fontSize: 13,
        fontWeight: props.strong ? 700 : 500,
        color: props.strong ? FDP_C.berry : FDP_C.textPrimary,
        marginTop: 2
      }
    }, props.value == null || props.value === '' ? '—' : props.value));
  }
  function FactureDetailPopup(props) {
    var facture = props.facture || {};
    var statusLabels = props.statusLabels || {};
    var onClose = props.onClose || function () {};

    // Échap → fermeture (self-contained, ne dépend pas du parent).
    useEffect(function () {
      var onKey = function (e) {
        if (e.key === 'Escape') onClose();
      };
      window.addEventListener('keydown', onKey);
      return function () {
        window.removeEventListener('keydown', onKey);
      };
    }, [onClose]);
    var FEU = window.FactureExportUtils;
    var built = FEU && typeof FEU.buildFactureLines === 'function' ? FEU.buildFactureLines(facture) : {
      lines: [],
      tvaBase: 0,
      anomalieType: null,
      anomalieLabel: ''
    };
    var lines = built.lines || [];

    // Totaux d'EN-TÊTE — source de vérité = mêmes chiffres que l'export.
    // HT = total_ht base ; TVA = (TTC − HT) = built.tvaBase ; TTC = total_ttc base.
    var fxRound2 = FEU && FEU.fxRound2 ? FEU.fxRound2 : function (n) {
      return Math.round((Number(n) || 0) * 100) / 100;
    };
    var totalHt = fxRound2(facture.total_ht);
    var totalTtc = facture.total_ttc != null ? fxRound2(facture.total_ttc) : fxRound2(totalHt + fxRound2(facture.total_tva));
    var totalTva = built.tvaBase != null ? built.tvaBase : fxRound2(totalTtc - totalHt);
    var statusKey = facture.payment_status;
    var statusLabel = statusLabels[statusKey] || statusKey || '—';
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
      background: FDP_C.surface,
      borderRadius: 14,
      width: '100%',
      maxWidth: 980,
      maxHeight: '90vh',
      overflow: 'auto',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
    };

    // -- EN-TÊTE -------------------------------------------------------------
    var headerBar = React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        padding: '16px 18px',
        borderBottom: '1px solid ' + FDP_C.border,
        position: 'sticky',
        top: 0,
        background: FDP_C.surface,
        zIndex: 1
      }
    }, React.createElement('div', null, React.createElement('div', {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: FDP_C.textPrimary
      }
    }, 'Détail facture'), React.createElement('div', {
      style: {
        fontSize: 12,
        color: FDP_C.textSecondary,
        marginTop: 2
      }
    }, facture.fournisseur && facture.fournisseur.nom || '—')), React.createElement('button', {
      onClick: onClose,
      style: {
        border: 'none',
        background: 'transparent',
        fontSize: 24,
        lineHeight: 1,
        color: FDP_C.textTertiary,
        cursor: 'pointer',
        padding: 4
      },
      'aria-label': 'Fermer'
    }, '×'));
    var headFields = React.createElement('div', {
      style: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '14px 28px',
        padding: 16,
        background: FDP_C.surface2
      }
    }, React.createElement(FDP_HeadField, {
      label: 'N° interne',
      value: facture.numero || facture.reference || facture.id,
      strong: true
    }), React.createElement(FDP_HeadField, {
      label: 'N° facture',
      value: facture.numero_facture
    }), React.createElement(FDP_HeadField, {
      label: 'Fournisseur',
      value: facture.fournisseur && facture.fournisseur.nom
    }), React.createElement(FDP_HeadField, {
      label: 'Date',
      value: facture.date_facture
    }), React.createElement(FDP_HeadField, {
      label: 'Statut',
      value: statusLabel
    }), React.createElement(FDP_HeadField, {
      label: 'Total HT',
      value: FDP_fmtMoney(totalHt) + ' MAD'
    }), React.createElement(FDP_HeadField, {
      label: 'TVA',
      value: FDP_fmtMoney(totalTva) + ' MAD'
    }), React.createElement(FDP_HeadField, {
      label: 'Total TTC',
      value: FDP_fmtMoney(totalTtc) + ' MAD',
      strong: true
    }));

    // -- NOTE TVA (informatif / anomalie) ------------------------------------
    var note = null;
    if (built.anomalieType === 'info') {
      note = React.createElement('div', {
        style: {
          margin: '12px 16px 0',
          fontSize: 12,
          color: FDP_C.amber,
          background: 'rgba(185,119,14,0.08)',
          padding: '8px 10px',
          borderRadius: 8
        }
      }, built.anomalieLabel || 'TVA par ligne non saisie — le détail TVA par ligne n’est pas disponible (total facture exact).');
    } else if (built.anomalieType === 'B') {
      note = React.createElement('div', {
        style: {
          margin: '12px 16px 0',
          fontSize: 12,
          color: FDP_C.red,
          background: 'rgba(192,57,43,0.08)',
          padding: '8px 10px',
          borderRadius: 8
        }
      }, built.anomalieLabel || 'Incohérence de saisie TVA.');
    }

    // -- TABLEAU DES LIGNES --------------------------------------------------
    var rows = lines.map(function (l, i) {
      return React.createElement('tr', {
        key: i
      }, React.createElement(FDP_Td, null, l.designation || '—'), React.createElement(FDP_Td, {
        align: 'right'
      }, FDP_fmtQty(l.quantite)), React.createElement(FDP_Td, {
        align: 'right'
      }, FDP_fmtMoney(l.prix_unitaire)), React.createElement(FDP_Td, {
        align: 'right'
      }, FDP_fmtMoney(l.montant_ht)), React.createElement(FDP_Td, {
        align: 'right',
        muted: l.taux_tva == null
      }, FDP_fmtTaux(l.taux_tva)), React.createElement(FDP_Td, {
        muted: l.taux_source !== 'saisi'
      }, FDP_sourceLabel(l.taux_source)), React.createElement(FDP_Td, {
        align: 'right',
        muted: l.montant_tva == null
      }, FDP_fmtMoney(l.montant_tva)), React.createElement(FDP_Td, {
        align: 'right',
        muted: l.montant_ttc == null
      }, FDP_fmtMoney(l.montant_ttc)));
    });

    // Ligne TOTAL : HT / TVA(=TTC−HT) / TTC. Les colonnes non agrégeables (PU,
    // taux, source) → '—', comme l'export n'y porte pas de total.
    var totalRow = React.createElement('tr', {
      style: {
        background: FDP_C.surface2
      }
    }, React.createElement(FDP_Td, {
      bold: true
    }, 'TOTAL'), React.createElement(FDP_Td, {
      align: 'right',
      muted: true
    }, '—'), React.createElement(FDP_Td, {
      align: 'right',
      muted: true
    }, '—'), React.createElement(FDP_Td, {
      align: 'right',
      bold: true
    }, FDP_fmtMoney(totalHt)), React.createElement(FDP_Td, {
      align: 'right',
      muted: true
    }, '—'), React.createElement(FDP_Td, {
      muted: true
    }, '—'), React.createElement(FDP_Td, {
      align: 'right',
      bold: true
    }, FDP_fmtMoney(totalTva)), React.createElement(FDP_Td, {
      align: 'right',
      bold: true
    }, FDP_fmtMoney(totalTtc)));
    var table = React.createElement('div', {
      style: {
        padding: 16,
        overflowX: 'auto'
      }
    }, React.createElement('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        minWidth: 720
      }
    }, React.createElement('thead', null, React.createElement('tr', null, React.createElement(FDP_Th, null, 'Désignation'), React.createElement(FDP_Th, {
      align: 'right'
    }, 'Quantité'), React.createElement(FDP_Th, {
      align: 'right'
    }, 'PU HT'), React.createElement(FDP_Th, {
      align: 'right'
    }, 'Montant HT'), React.createElement(FDP_Th, {
      align: 'right'
    }, 'Taux TVA'), React.createElement(FDP_Th, null, 'Source taux'), React.createElement(FDP_Th, {
      align: 'right'
    }, 'Montant TVA'), React.createElement(FDP_Th, {
      align: 'right'
    }, 'Montant TTC'))), React.createElement('tbody', null, rows), React.createElement('tfoot', null, totalRow)));
    var body = React.createElement(React.Fragment, null, headFields, note, table);
    if (!window.FactureExportUtils) {
      body = React.createElement('div', {
        style: {
          padding: 40,
          textAlign: 'center',
          color: FDP_C.red
        }
      }, 'Module TVA (FactureExportUtils) indisponible — détail non affichable.');
    }
    return React.createElement('div', {
      style: overlay,
      onClick: onClose
    }, React.createElement('div', {
      style: card,
      onClick: function (e) {
        e.stopPropagation();
      }
    }, headerBar, body));
  }
  window.FactureDetailPopup = FactureDetailPopup;
})();
