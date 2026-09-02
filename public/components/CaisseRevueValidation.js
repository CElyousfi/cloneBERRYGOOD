/*
 * CaisseRevueValidation.jsx — Revue DG des bons de caisse, un bon à la fois.
 *
 * L'écran Validation historique empile toutes les cartes : à 40 bons, la DG
 * scrolle et perd le fil. Ici : UN bon en grand, navigation flèche gauche /
 * droite (et touches ← →), compteur de position, et les trois décisions
 * possibles sous la main.
 *
 * N'invente aucune règle métier : appelle les actions existantes
 * validate-transaction / reject-transaction / mark-revoir-batch. C'est la
 * validation UNITAIRE qui est utilisée — elle mouvemente le solde de la caisse
 * de façon atomique.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE (cf. crashes #75/#77). UN seul
 * global exposé : window.CaisseRevueValidation. Identifiants préfixés CRV_.
 *
 * Props :
 *   - transactions  Array   bons au statut 'soumis', dans l'ordre d'affichage
 *   - caisses       Array   pour afficher le nom de la caisse
 *   - onDecision    (id, decision) => Promise  'valide' | 'rejete' | 'a_revoir'
 *   - onQuitter     () => void   retour à la vue liste
 */
(function () {
  const {
    useState
  } = React;
  const CRV_FALLBACK_TYPES = {
    alimentation: {
      label: 'Alimentation',
      color: 'var(--green)',
      bg: 'rgba(45,139,78,0.1)',
      icon: 'fa-arrow-down'
    },
    depense: {
      label: 'Dépense',
      color: 'var(--red)',
      bg: 'rgba(231,76,60,0.1)',
      icon: 'fa-arrow-up'
    },
    sortie: {
      label: 'Sortie',
      color: 'var(--orange)',
      bg: 'rgba(243,156,18,0.1)',
      icon: 'fa-arrow-right-from-bracket'
    },
    paie: {
      label: 'Paie',
      color: '#9b59b6',
      bg: 'rgba(155,89,182,0.1)',
      icon: 'fa-money-check-dollar'
    },
    transport: {
      label: 'Transport',
      color: '#16a085',
      bg: 'rgba(22,160,133,0.1)',
      icon: 'fa-truck'
    }
  };
  function CRV_mad(n) {
    return (Number(n) || 0).toLocaleString('fr-MA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' DH';
  }

  /** Une ligne d'information du bon. Rendue même vide, pour signaler ce qui manque. */
  function CRV_Info({
    label,
    valeur,
    alerte
  }) {
    const vide = valeur === undefined || valeur === null || valeur === '';
    return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: 'var(--gray-400)'
      }
    }, label), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: vide ? 400 : 600,
        color: vide ? alerte ? 'var(--orange)' : 'var(--gray-400)' : 'var(--gray-800)'
      }
    }, vide ? alerte ? 'Non renseigné' : '—' : valeur));
  }
  function CaisseRevueValidation({
    transactions,
    caisses,
    onDecision,
    onQuitter
  }) {
    const [index, setIndex] = useState(0);
    const [busy, setBusy] = useState(false);
    const [motif, setMotif] = useState('');
    const [demandeRejet, setDemandeRejet] = useState(false);
    const [traites, setTraites] = useState({
      valide: 0,
      rejete: 0,
      a_revoir: 0,
      montantValide: 0
    });
    const total = transactions.length;
    // Après un traitement, la liste rétrécit : l'index doit rester dans les
    // bornes, sinon on affiche du vide au lieu du bon suivant.
    const pos = Math.min(index, Math.max(0, total - 1));
    const tx = transactions[pos];
    const aller = React.useCallback(delta => {
      setDemandeRejet(false);
      setMotif('');
      setIndex(cur => {
        const n = Math.min(cur, Math.max(0, total - 1)) + delta;
        if (n < 0) return 0;
        if (n > total - 1) return Math.max(0, total - 1);
        return n;
      });
    }, [total]);
    const decider = async decision => {
      if (!tx || busy) return;
      if (decision === 'rejete' && !motif.trim()) {
        setDemandeRejet(true);
        return;
      }
      setBusy(true);
      try {
        const ok = await onDecision(tx.id, decision, motif.trim());
        if (ok) {
          setTraites(t => ({
            ...t,
            [decision]: t[decision] + 1,
            montantValide: decision === 'valide' ? t.montantValide + (Number(tx.montant) || 0) : t.montantValide
          }));
          setMotif('');
          setDemandeRejet(false);
          // On NE bouge pas l'index : le bon suivant prend la place du traité.
          setIndex(cur => Math.min(cur, Math.max(0, total - 2)));
        }
      } finally {
        setBusy(false);
      }
    };

    // Raccourcis clavier : ← → pour naviguer. Volontairement PAS de raccourci
    // pour valider/rejeter — une décision qui engage le solde ne doit pas
    // partir sur une frappe involontaire.
    React.useEffect(() => {
      const onKey = e => {
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          aller(-1);
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          aller(1);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [aller]);
    const TYPES = window.TXN_TYPE_LABELS || CRV_FALLBACK_TYPES;
    if (!tx) {
      return /*#__PURE__*/React.createElement("div", {
        style: {
          textAlign: 'center',
          padding: 60
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-circle-check",
        style: {
          fontSize: 48,
          color: 'var(--green)',
          marginBottom: 12
        }
      }), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 16,
          fontWeight: 600
        }
      }, "Revue termin\xE9e"), /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 13,
          color: 'var(--gray-600)',
          marginTop: 6
        }
      }, traites.valide, " valid\xE9(s) \xB7 ", traites.a_revoir, " \xE0 revoir \xB7 ", traites.rejete, " rejet\xE9(s)"), traites.valide > 0 && /*#__PURE__*/React.createElement("div", {
        style: {
          fontSize: 13,
          color: 'var(--gray-600)',
          marginTop: 4
        }
      }, "Montant valid\xE9 : ", /*#__PURE__*/React.createElement("strong", null, CRV_mad(traites.montantValide))), /*#__PURE__*/React.createElement("button", {
        onClick: onQuitter,
        style: {
          marginTop: 18,
          padding: '10px 20px',
          borderRadius: 10,
          border: '1px solid var(--gray-200)',
          background: 'white',
          cursor: 'pointer',
          fontSize: 13
        }
      }, "Retour \xE0 la liste"));
    }
    const tt = TYPES[tx.type] || {};
    const caisseNom = (caisses.find(c => c.id === tx.caisse_id) || {}).nom || tx.caisse_id;
    const sortie = ['depense', 'sortie', 'transfer_out', 'paie', 'transport'].indexOf(tx.type) !== -1;
    const nav = {
      width: 44,
      height: 44,
      borderRadius: '50%',
      border: '1px solid var(--gray-200)',
      background: 'white',
      cursor: 'pointer',
      fontSize: 16,
      color: 'var(--berry)'
    };
    return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexWrap: 'wrap',
        marginBottom: 14
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: onQuitter,
      style: {
        padding: '7px 14px',
        borderRadius: 8,
        border: '1px solid var(--gray-200)',
        background: 'white',
        cursor: 'pointer',
        fontSize: 12,
        color: 'var(--gray-600)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-list",
      style: {
        marginRight: 6
      }
    }), "Vue liste"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => aller(-1),
      disabled: pos === 0,
      title: "Bon pr\xE9c\xE9dent (\u2190)",
      "aria-label": "Bon pr\xE9c\xE9dent",
      style: {
        ...nav,
        opacity: pos === 0 ? 0.3 : 1,
        cursor: pos === 0 ? 'default' : 'pointer'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-chevron-left"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 13,
        color: 'var(--gray-600)',
        whiteSpace: 'nowrap',
        minWidth: 96,
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("strong", {
      style: {
        color: 'var(--berry)',
        fontSize: 15
      }
    }, pos + 1), " / ", total), /*#__PURE__*/React.createElement("button", {
      onClick: () => aller(1),
      disabled: pos >= total - 1,
      title: "Bon suivant (\u2192)",
      "aria-label": "Bon suivant",
      style: {
        ...nav,
        opacity: pos >= total - 1 ? 0.3 : 1,
        cursor: pos >= total - 1 ? 'default' : 'pointer'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-chevron-right"
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 140
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        height: 6,
        background: 'var(--gray-100)',
        borderRadius: 3,
        overflow: 'hidden'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        height: '100%',
        width: `${total ? (pos + 1) / total * 100 : 0}%`,
        background: 'var(--berry)',
        transition: 'width 0.2s'
      }
    }))), traites.valide + traites.rejete + traites.a_revoir > 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--gray-400)',
        whiteSpace: 'nowrap'
      }
    }, traites.valide, " valid\xE9(s) \xB7 ", CRV_mad(traites.montantValide))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        borderRadius: 14,
        border: '1px solid var(--gray-200)',
        padding: 24,
        boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
        minHeight: 480,
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 18
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'monospace',
        fontSize: 12,
        color: 'var(--gray-400)'
      }
    }, tx.reference), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 700,
        color: 'var(--gray-800)',
        marginTop: 2
      }
    }, tx.description || 'Sans description'), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        padding: '3px 10px',
        borderRadius: 12,
        background: tt.bg || '#eee',
        color: tt.color || '#333',
        fontSize: 11,
        fontWeight: 600
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: `fa-solid ${tt.icon || ''}`,
      style: {
        marginRight: 4
      }
    }), tt.label || tx.type), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: 'var(--gray-600)'
      }
    }, caisseNom), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: 'var(--gray-400)'
      }
    }, "\xB7 ", tx.date))), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'right'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 28,
        fontWeight: 800,
        color: sortie ? 'var(--red)' : 'var(--green)',
        lineHeight: 1.1
      }
    }, sortie ? '−' : '+', CRV_mad(tx.montant)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--gray-400)',
        marginTop: 2
      }
    }, "Saisi par ", tx.saisie_by && tx.saisie_by.name || '—'))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))',
        gap: 14,
        padding: '14px 0',
        borderTop: '1px solid var(--gray-100)',
        borderBottom: '1px solid var(--gray-100)'
      }
    }, /*#__PURE__*/React.createElement(CRV_Info, {
      label: "Code analytique",
      valeur: tx.code_analytique,
      alerte: true
    }), /*#__PURE__*/React.createElement(CRV_Info, {
      label: "Ferme",
      valeur: tx.ferme,
      alerte: true
    }), /*#__PURE__*/React.createElement(CRV_Info, {
      label: "Culture",
      valeur: tx.culture
    }), /*#__PURE__*/React.createElement(CRV_Info, {
      label: "Parcelle",
      valeur: tx.parcelle,
      alerte: true
    }), /*#__PURE__*/React.createElement(CRV_Info, {
      label: "Campagne",
      valeur: tx.campagne
    }), (tx.type === 'paie' || tx.type === 'transport') && /*#__PURE__*/React.createElement(CRV_Info, {
      label: "B\xE9n\xE9ficiaire",
      valeur: tx.beneficiaire_nom
    })), Array.isArray(tx.files) && tx.files.length > 0 ? /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: 'var(--gray-400)',
        marginBottom: 6
      }
    }, "Justificatifs"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap'
      }
    }, tx.files.map((f, i) => /*#__PURE__*/React.createElement("img", {
      key: i,
      src: f.data || f.url,
      alt: "",
      onClick: () => window.open(f.data || f.url, '_blank'),
      style: {
        width: 96,
        height: 96,
        objectFit: 'cover',
        borderRadius: 8,
        border: '1px solid var(--gray-200)',
        cursor: 'zoom-in'
      }
    })))) : /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 14,
        fontSize: 12,
        color: 'var(--orange)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginRight: 6
      }
    }), "Aucun justificatif joint"), demandeRejet && /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        display: 'block',
        marginBottom: 4
      }
    }, "Motif du rejet (obligatoire)"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: motif,
      autoFocus: true,
      onChange: e => setMotif(e.target.value),
      onKeyDown: e => {
        if (e.key === 'Enter' && motif.trim()) decider('rejete');
      },
      placeholder: "Ex : montant incoh\xE9rent avec le justificatif",
      style: {
        width: '100%',
        padding: '9px 12px',
        borderRadius: 8,
        border: '1px solid var(--red)',
        fontSize: 13
      }
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        marginTop: 'auto',
        paddingTop: 18,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => decider('valide'),
      disabled: busy,
      style: {
        padding: '11px 22px',
        borderRadius: 10,
        border: 'none',
        background: 'var(--green)',
        color: 'white',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 700,
        opacity: busy ? 0.5 : 1
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-check",
      style: {
        marginRight: 6
      }
    }), "Valider"), /*#__PURE__*/React.createElement("button", {
      onClick: () => decider('a_revoir'),
      disabled: busy,
      style: {
        padding: '11px 18px',
        borderRadius: 10,
        border: 'none',
        background: '#F39C12',
        color: 'white',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        opacity: busy ? 0.5 : 1
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-rotate-right",
      style: {
        marginRight: 6
      }
    }), "\xC0 revoir"), /*#__PURE__*/React.createElement("button", {
      onClick: () => decider('rejete'),
      disabled: busy,
      style: {
        padding: '11px 18px',
        borderRadius: 10,
        border: '1px solid var(--red)',
        background: 'white',
        color: 'var(--red)',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        opacity: busy ? 0.5 : 1
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-xmark",
      style: {
        marginRight: 6
      }
    }), "Rejeter"), /*#__PURE__*/React.createElement("button", {
      onClick: () => aller(1),
      disabled: busy || pos >= total - 1,
      style: {
        marginLeft: 'auto',
        padding: '11px 18px',
        borderRadius: 10,
        border: '1px solid var(--gray-200)',
        background: 'white',
        color: 'var(--gray-600)',
        cursor: 'pointer',
        fontSize: 13,
        opacity: busy || pos >= total - 1 ? 0.4 : 1
      }
    }, "Passer", /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-arrow-right",
      style: {
        marginLeft: 6
      }
    }))))), /*#__PURE__*/React.createElement("div", {
      style: {
        textAlign: 'center',
        fontSize: 11,
        color: 'var(--gray-400)',
        marginTop: 12
      }
    }, "Fl\xE8ches \u2190 \u2192 du clavier pour naviguer d'un bon \xE0 l'autre"));
  }
  window.CaisseRevueValidation = CaisseRevueValidation;
})();
