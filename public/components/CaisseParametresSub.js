/*
 * CaisseParametresSub.jsx — Paramètres de la Gestion de Caisse.
 *
 * Configure les deux listes qui alimentent les menus déroulants du bon de
 * caisse : les FERMES et les CODES ANALYTIQUES. Ce qui est enregistré ici est
 * exactement ce qui est proposé à la saisie — c'est la seule source.
 *
 * Volontairement séparé de `config_analytique` (écran Finance) : ce dernier est
 * le plan analytique des ACHATS, avec ferme / catégorie d'achat / nature CPC
 * par code. Ici, une simple liste de natures de dépense propre à la caisse.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. crashes #75/#77 — mémoire umd-global-collision-smoke-load). UN seul
 * global exposé : window.CaisseParametresSub. Identifiants internes préfixés CPAR_.
 *
 * Props :
 *   - canEdit  bool        DG/Finance : peut enregistrer. Sinon lecture seule.
 *   - onSaved  () => void  appelé après un enregistrement réussi
 */
(function () {
  const {
    useState
  } = React;
  const CPAR_MAX_LEN = 60;
  const CPAR_CLIENT_PREFIX = 'compte_client_';
  const CPAR_ENTITES = [{
    code: 'BGF',
    label: 'BERRY GOOD FARMS'
  }, {
    code: 'BAHIA',
    label: 'BAHIA'
  }];
  /** Repli de rattachement tant qu'aucune entité n'est choisie. */
  function CPAR_entiteDefaut(c) {
    return `${c && c.id || ''} ${c && c.nom || ''}`.toLowerCase().indexOf('bahia') !== -1 ? 'BAHIA' : 'BGF';
  }

  /** Une liste éditable : ajout, suppression, réordonnancement. */
  function CPAR_ListeEditable({
    titre,
    icone,
    aide,
    items,
    onChange,
    canEdit,
    placeholder
  }) {
    const [nouveau, setNouveau] = useState('');
    const ajouter = () => {
      const v = nouveau.trim();
      if (!v) return;
      if (v.length > CPAR_MAX_LEN) return alert(`Maximum ${CPAR_MAX_LEN} caractères.`);
      if (items.some(x => x.toLowerCase() === v.toLowerCase())) {
        setNouveau('');
        return alert(`« ${v} » est déjà dans la liste.`);
      }
      onChange([...items, v]);
      setNouveau('');
    };
    const supprimer = i => {
      if (items.length === 1) return alert('La liste ne peut pas être vide.');
      if (!window.confirm(`Retirer « ${items[i]} » ?\n\nLes bons déjà enregistrés avec cette valeur la conservent ; elle ne sera simplement plus proposée à la saisie.`)) return;
      onChange(items.filter((_, k) => k !== i));
    };
    const deplacer = (i, delta) => {
      const j = i + delta;
      if (j < 0 || j >= items.length) return;
      const copie = items.slice();
      const tmp = copie[i];
      copie[i] = copie[j];
      copie[j] = tmp;
      onChange(copie);
    };
    const btn = {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'var(--gray-400)',
      padding: '2px 5px',
      fontSize: 12
    };
    return /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        borderRadius: 12,
        border: '1px solid var(--gray-200)',
        padding: 20,
        flex: '1 1 340px',
        minWidth: 300
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        margin: '0 0 4px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 14
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: `fa-solid ${icone}`,
      style: {
        color: 'var(--berry)'
      }
    }), titre, /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto',
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--gray-400)'
      }
    }, items.length)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: 'var(--gray-600)',
        marginBottom: 12
      }
    }, aide), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        marginBottom: 12
      }
    }, items.map((item, i) => /*#__PURE__*/React.createElement("div", {
      key: item + i,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: 'var(--gray-100)',
        borderRadius: 8,
        fontSize: 12.5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, item), canEdit && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      onClick: () => deplacer(i, -1),
      disabled: i === 0,
      title: "Monter",
      style: {
        ...btn,
        opacity: i === 0 ? 0.25 : 1
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-chevron-up"
    })), /*#__PURE__*/React.createElement("button", {
      onClick: () => deplacer(i, 1),
      disabled: i === items.length - 1,
      title: "Descendre",
      style: {
        ...btn,
        opacity: i === items.length - 1 ? 0.25 : 1
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-chevron-down"
    })), /*#__PURE__*/React.createElement("button", {
      onClick: () => supprimer(i),
      title: "Retirer",
      style: {
        ...btn,
        color: 'var(--red)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-xmark"
    })))))), canEdit && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 6
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: nouveau,
      onChange: e => setNouveau(e.target.value),
      onKeyDown: e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          ajouter();
        }
      },
      placeholder: placeholder,
      maxLength: CPAR_MAX_LEN,
      style: {
        flex: 1,
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid var(--gray-200)',
        fontSize: 12.5
      }
    }), /*#__PURE__*/React.createElement("button", {
      onClick: ajouter,
      disabled: !nouveau.trim(),
      style: {
        padding: '8px 14px',
        borderRadius: 8,
        border: 'none',
        background: 'var(--berry)',
        color: 'white',
        cursor: 'pointer',
        fontSize: 12.5,
        fontWeight: 600,
        opacity: nouveau.trim() ? 1 : 0.4
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-plus"
    }))));
  }
  function CaisseParametresSub({
    canEdit,
    onSaved
  }) {
    const [fermes, setFermes] = useState([]);
    const [codes, setCodes] = useState([]);
    const [initial, setInitial] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [seeded, setSeeded] = useState(true);
    const [erreur, setErreur] = useState(null);
    const [toast, setToast] = useState(null);
    // Parcelles FIGÉES dans les paramètres : c'est ce qui rend la saisie d'un
    // bon instantanée. Rafraîchies à la demande depuis le référentiel de
    // campagne (requête lente, donc jamais au moment de saisir).
    // Rattachement caisse → entité, et clients du Marché Local suivis.
    const [caissesRef, setCaissesRef] = useState([]);
    const [entites, setEntites] = useState({});
    const [clients, setClients] = useState([]);
    const [busyClient, setBusyClient] = useState(null);
    const [clientsErreur, setClientsErreur] = useState(null);
    const [parcelles, setParcelles] = useState([]);
    const [parcellesMajAt, setParcellesMajAt] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const charger = React.useCallback(() => {
      setLoading(true);
      setErreur(null);
      fetch('/api/caisse?action=caisse-parametres-get').then(r => r.json()).then(j => {
        // Ne JAMAIS retomber silencieusement sur deux listes vides : c'est
        // indiscernable d'un « il n'y a rien à configurer ». Le cas typique
        // est un backend pas encore déployé (l'action n'existe pas encore).
        if (!j || !j.success) {
          setErreur(j && j.error || "Les paramètres n'ont pas pu être chargés.");
          return;
        }
        setFermes(j.fermes || []);
        setCodes(j.codes_analytiques || []);
        setParcelles(j.parcelles || []);
        setParcellesMajAt(j.parcelles_maj_at || null);
        setEntites(j.entites || {});
        setSeeded(!!j.seeded);
        setInitial(JSON.stringify({
          f: j.fermes || [],
          c: j.codes_analytiques || [],
          e: j.entites || {}
        }));
      }).catch(err => setErreur('Erreur réseau : ' + err.message)).finally(() => setLoading(false));
    }, []);
    React.useEffect(() => {
      charger();
    }, [charger]);

    // Caisses de gestion (pour le rattachement) et clients du Marché Local.
    const chargerClients = React.useCallback(() => {
      setClientsErreur(null);
      fetch('/api/caisse?action=caisse-clients-list').then(r => r.json()).then(j => {
        // Ne pas confondre « aucun client » avec « la liste n'a pas pu être
        // chargée » : le second cas doit être dit, sinon l'ajout échoue
        // ensuite sans que l'utilisateur comprenne pourquoi.
        if (!j || !j.success) {
          setClientsErreur(j && j.error || 'Liste des clients indisponible.');
          return;
        }
        setClients(j.clients || []);
      }).catch(err => setClientsErreur('Erreur réseau : ' + err.message));
    }, []);
    React.useEffect(() => {
      fetch('/api/caisse?action=dashboard').then(r => r.json()).then(j => {
        if (!j.success) return;
        setCaissesRef((j.caisses || []).filter(c => String(c.id || '').indexOf(CPAR_CLIENT_PREFIX) !== 0));
      }).catch(() => {});
      chargerClients();
    }, [chargerClients]);
    const changerEntite = (caisseId, code) => setEntites(cur => ({
      ...cur,
      [caisseId]: code
    }));
    const majClient = (client_id, nom, actif) => {
      setBusyClient(client_id || nom);
      return fetch('/api/caisse?action=caisse-client-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id,
          nom,
          actif
        })
      }).then(r => r.json()).then(j => {
        if (!j.success) {
          setToast({
            msg: 'Erreur : ' + (j.error || 'inconnue'),
            kind: 'error'
          });
          return false;
        }
        chargerClients();
        if (onSaved) onSaved();
        return true;
      }).catch(err => {
        setToast({
          msg: 'Erreur réseau : ' + err.message,
          kind: 'error'
        });
        return false;
      }).finally(() => {
        setBusyClient(null);
        setTimeout(() => setToast(null), 2600);
      });
    };
    const modifie = initial !== null && initial !== JSON.stringify({
      f: fermes,
      c: codes,
      e: entites
    });
    const enregistrer = () => {
      setSaving(true);
      fetch('/api/caisse?action=caisse-parametres-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fermes,
          codes_analytiques: codes,
          entites
        })
      }).then(r => r.json()).then(j => {
        if (!j.success) {
          setToast({
            msg: 'Erreur : ' + (j.error || 'inconnue'),
            kind: 'error'
          });
          return;
        }
        setFermes(j.fermes);
        setCodes(j.codes_analytiques);
        setSeeded(true);
        setEntites(j.entites || {});
        setInitial(JSON.stringify({
          f: j.fermes,
          c: j.codes_analytiques,
          e: j.entites || {}
        }));
        setToast({
          msg: 'Paramètres enregistrés',
          kind: 'success'
        });
        if (onSaved) onSaved();
      }).catch(err => setToast({
        msg: 'Erreur réseau : ' + err.message,
        kind: 'error'
      })).finally(() => {
        setSaving(false);
        setTimeout(() => setToast(null), 2600);
      });
    };

    /**
     * Rafraîchit la liste des parcelles depuis le référentiel de campagne.
     * C'est LE seul endroit où la requête lente est faite : la culture est
     * résolue ici une fois pour toutes (référentiel Smart Berry prioritaire),
     * puis figée, pour que le formulaire de saisie n'ait plus rien à calculer.
     */
    const rafraichirParcelles = async () => {
      if (!window.confirm('Recharger la liste des parcelles depuis la campagne ?\n\nCela peut prendre quelques secondes. La liste actuelle sera remplacée.')) return;
      setRefreshing(true);
      try {
        const [ref, sb] = await Promise.all([fetch('/api/pointage-rh?action=parcelles-campagne-list').then(r => r.json()), fetch('/api/pointage-rh?action=sb-referentiel-list').then(r => r.json()).catch(() => ({
          success: false
        }))]);
        if (!ref || !ref.success) throw new Error(ref && ref.error || 'Référentiel de campagne indisponible');
        const sbMap = {};
        if (sb && sb.success) (sb.parcelles || []).forEach(p => {
          sbMap[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
        });
        const CU = window.CultureUtils;
        const campagneOf = d => window.CampagneUtils && window.CampagneUtils.campagneOf ? window.CampagneUtils.campagneOf(d) : '';
        const campCourante = campagneOf(new Date().toISOString().slice(0, 10));
        const anneePrec = parseInt(String(campCourante).slice(0, 4), 10) - 1;
        const campPrecedente = Number.isFinite(anneePrec) ? `${anneePrec}-${anneePrec + 1}` : '';
        const construire = (liste, campagne) => (liste || []).map(p => {
          const e = sbMap[(p.label || '').toUpperCase().trim()];
          return {
            label: p.label,
            nom: e && e.nom_sb ? e.nom_sb : p.label,
            culture: CU ? CU.resolveCulture({
              label: p.label,
              culture: p.culture
            }, sbMap) : p.culture || '',
            ferme: p.ferme || '',
            campagne
          };
        });
        const nouvelles = [...construire(ref.campagne_courante, campCourante), ...construire(ref.campagne_precedente, campPrecedente)];
        if (nouvelles.length === 0) throw new Error('Le référentiel de campagne est vide.');
        const r = await fetch('/api/caisse?action=caisse-parametres-save', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fermes,
            codes_analytiques: codes,
            parcelles: nouvelles
          })
        }).then(x => x.json());
        if (!r.success) throw new Error(r.error || 'Enregistrement refusé');
        setParcelles(r.parcelles || []);
        setParcellesMajAt(r.parcelles_maj_at || Date.now());
        setSeeded(true);
        setToast({
          msg: `${(r.parcelles || []).length} parcelles enregistrées`,
          kind: 'success'
        });
        if (onSaved) onSaved();
      } catch (err) {
        setToast({
          msg: 'Rafraîchissement impossible : ' + err.message,
          kind: 'error'
        });
      } finally {
        setRefreshing(false);
        setTimeout(() => setToast(null), 3200);
      }
    };
    if (loading) return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: 30,
        textAlign: 'center',
        color: 'var(--gray-400)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-spinner fa-spin"
    }), " Chargement\u2026");
    if (erreur) return /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '16px 18px',
        borderRadius: 12,
        background: '#FEE2E2',
        border: '1px solid #FCA5A5',
        color: '#991B1B',
        fontSize: 13,
        maxWidth: 700
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontWeight: 700,
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginRight: 8
      }
    }), "Param\xE8tres indisponibles"), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 10
      }
    }, erreur), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: '#7F1D1D'
      }
    }, "Si l'\xE9cran vient d'\xEAtre livr\xE9, le backend n'est peut-\xEAtre pas encore d\xE9ploy\xE9. Le bon de caisse continue de fonctionner avec les listes par d\xE9faut."), /*#__PURE__*/React.createElement("button", {
      onClick: charger,
      style: {
        marginTop: 12,
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: '#991B1B',
        color: 'white',
        cursor: 'pointer',
        fontSize: 12.5,
        fontWeight: 600
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-arrow-rotate-right",
      style: {
        marginRight: 6
      }
    }), "R\xE9essayer"));
    return /*#__PURE__*/React.createElement("div", null, !seeded && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 14px',
        marginBottom: 14,
        borderRadius: 10,
        background: '#E8F0FE',
        border: '1px solid #C3D9F7',
        fontSize: 12,
        color: '#1A56DB'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-circle-info",
      style: {
        marginTop: 2
      }
    }), /*#__PURE__*/React.createElement("span", null, "Listes par d\xE9faut propos\xE9es \u2014 ", /*#__PURE__*/React.createElement("strong", null, "rien n'est encore enregistr\xE9"), ". Ajustez-les puis cliquez sur Enregistrer pour les figer.")), !canEdit && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '10px 14px',
        marginBottom: 14,
        borderRadius: 10,
        background: 'var(--gray-100)',
        fontSize: 12,
        color: 'var(--gray-600)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-lock",
      style: {
        marginRight: 6
      }
    }), "Lecture seule \u2014 seuls la DG et la Finance peuvent modifier ces listes."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        alignItems: 'flex-start'
      }
    }, /*#__PURE__*/React.createElement(CPAR_ListeEditable, {
      titre: "Fermes",
      icone: "fa-warehouse",
      canEdit: canEdit,
      aide: "Propos\xE9es dans le champ Ferme d'un bon de caisse. GENERAL = d\xE9pense non rattach\xE9e \xE0 une ferme.",
      placeholder: "Ajouter une ferme\u2026",
      items: fermes,
      onChange: setFermes
    }), /*#__PURE__*/React.createElement(CPAR_ListeEditable, {
      titre: "Codes analytiques",
      icone: "fa-tags",
      canEdit: canEdit,
      aide: "Propos\xE9s dans le champ Code Analytique d'un bon de caisse. L'ordre de la liste est l'ordre d'affichage.",
      placeholder: "Ajouter un code analytique\u2026",
      items: codes,
      onChange: setCodes
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        borderRadius: 12,
        border: '1px solid var(--gray-200)',
        padding: 20,
        flex: '1 1 340px',
        minWidth: 300
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        margin: '0 0 4px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 14
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-map-location-dot",
      style: {
        color: 'var(--berry)'
      }
    }), "Parcelles", /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto',
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--gray-400)'
      }
    }, parcelles.length)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: 'var(--gray-600)',
        marginBottom: 12
      }
    }, "Fig\xE9es depuis le r\xE9f\xE9rentiel de campagne pour que la saisie d'un bon soit instantan\xE9e. Rafra\xEEchir quand les parcelles de la campagne changent."), parcelles.length === 0 ? /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '12px 14px',
        borderRadius: 8,
        background: '#FEF3C7',
        border: '1px solid #FDE68A',
        fontSize: 12,
        color: '#92400E',
        marginBottom: 12
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginRight: 6
      }
    }), "Aucune parcelle enregistr\xE9e \u2014 le champ Parcelle d'un bon ne proposera que GENERAL. Lancez un premier rafra\xEEchissement.") : /*#__PURE__*/React.createElement("div", {
      style: {
        maxHeight: 260,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        marginBottom: 12
      }
    }, parcelles.map((p, i) => /*#__PURE__*/React.createElement("div", {
      key: p.label + i,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '5px 10px',
        background: 'var(--gray-100)',
        borderRadius: 8,
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      },
      title: p.label
    }, p.nom || p.label), p.culture && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        padding: '2px 7px',
        borderRadius: 10,
        background: 'white',
        color: 'var(--gray-600)',
        border: '1px solid var(--gray-200)'
      }
    }, p.culture), p.ferme && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10,
        color: 'var(--gray-400)'
      }
    }, p.ferme)))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap'
      }
    }, canEdit && /*#__PURE__*/React.createElement("button", {
      onClick: rafraichirParcelles,
      disabled: refreshing,
      style: {
        padding: '8px 14px',
        borderRadius: 8,
        border: '1px solid var(--berry)',
        background: 'white',
        color: 'var(--berry)',
        cursor: refreshing ? 'default' : 'pointer',
        fontSize: 12.5,
        fontWeight: 600,
        opacity: refreshing ? 0.5 : 1
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: `fa-solid ${refreshing ? 'fa-spinner fa-spin' : 'fa-arrow-rotate-right'}`,
      style: {
        marginRight: 6
      }
    }), refreshing ? 'Rafraîchissement…' : 'Rafraîchir depuis la campagne'), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--gray-400)'
      }
    }, parcellesMajAt ? `Dernière mise à jour : ${new Date(parcellesMajAt).toLocaleString('fr-FR')}` : 'Jamais rafraîchie')))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        borderRadius: 12,
        border: '1px solid var(--gray-200)',
        padding: 20,
        flex: '1 1 340px',
        minWidth: 300
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        margin: '0 0 4px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 14
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-building",
      style: {
        color: 'var(--berry)'
      }
    }), "Entit\xE9s", /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto',
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--gray-400)'
      }
    }, caissesRef.length, " caisse(s)")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: 'var(--gray-600)',
        marginBottom: 12
      }
    }, "D\xE9termine dans quel bloc du dashboard chaque caisse appara\xEEt. Une caisse non r\xE9gl\xE9e est rattach\xE9e d'apr\xE8s son nom."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 5
      }
    }, caissesRef.map(c => /*#__PURE__*/React.createElement("div", {
      key: c.id,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'var(--gray-100)',
        borderRadius: 8,
        fontSize: 12.5
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, c.nom || c.id), /*#__PURE__*/React.createElement("select", {
      value: entites[c.id] || CPAR_entiteDefaut(c),
      disabled: !canEdit,
      onChange: e => changerEntite(c.id, e.target.value),
      "aria-label": `Entité de ${c.nom || c.id}`,
      style: {
        padding: '5px 8px',
        borderRadius: 6,
        border: '1px solid var(--gray-200)',
        fontSize: 11.5,
        background: 'white'
      }
    }, CPAR_ENTITES.map(e => /*#__PURE__*/React.createElement("option", {
      key: e.code,
      value: e.code
    }, e.label))))), caissesRef.length === 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--gray-400)'
      }
    }, "Aucune caisse charg\xE9e."))), /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        borderRadius: 12,
        border: '1px solid var(--gray-200)',
        padding: 20,
        flex: '1 1 340px',
        minWidth: 300
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        margin: '0 0 4px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 14
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-store",
      style: {
        color: 'var(--berry)'
      }
    }), "Clients March\xE9 Local", /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: 'auto',
        fontSize: 11,
        fontWeight: 500,
        color: 'var(--gray-400)'
      }
    }, clients.filter(c => c.actif).length, " suivi(s) / ", clients.length)), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11.5,
        color: 'var(--gray-600)',
        marginBottom: 12
      }
    }, "Les clients viennent des ", /*#__PURE__*/React.createElement("strong", null, "Bons d'Apport"), " (Achats). Ici on choisit lesquels sont ", /*#__PURE__*/React.createElement("strong", null, "suivis en caisse"), " : un client suivi appara\xEEt au dashboard et ses encaissements sont accept\xE9s \xE0 l'import. D\xE9sactiver n'efface rien."), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        marginBottom: 12,
        maxHeight: 240,
        overflowY: 'auto'
      }
    }, clients.map(cl => /*#__PURE__*/React.createElement("div", {
      key: cl.id,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 8,
        fontSize: 12.5,
        background: cl.actif ? 'var(--gray-100)' : 'transparent',
        border: cl.actif ? 'none' : '1px dashed var(--gray-200)',
        opacity: cl.actif ? 1 : 0.65
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      },
      title: cl.nom
    }, cl.nom), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--gray-400)',
        whiteSpace: 'nowrap'
      }
    }, (Number(cl.solde_actuel) || 0).toLocaleString('fr-MA', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }), " DH"), canEdit && /*#__PURE__*/React.createElement("button", {
      onClick: () => majClient(cl.client_id, cl.nom, !cl.actif),
      disabled: busyClient === cl.client_id,
      title: cl.actif ? 'Ne plus suivre en caisse' : 'Suivre en caisse',
      style: {
        padding: '3px 10px',
        borderRadius: 12,
        border: 'none',
        cursor: 'pointer',
        fontSize: 10.5,
        fontWeight: 700,
        background: cl.actif ? 'var(--green)' : 'var(--gray-200)',
        color: cl.actif ? 'white' : 'var(--gray-600)'
      }
    }, busyClient === cl.client_id ? '…' : cl.actif ? 'SUIVI' : 'NON SUIVI'))), clientsErreur && /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '9px 12px',
        borderRadius: 8,
        background: '#FEE2E2',
        border: '1px solid #FCA5A5',
        color: '#991B1B',
        fontSize: 11.5
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginRight: 6
      }
    }), clientsErreur, /*#__PURE__*/React.createElement("div", {
      style: {
        marginTop: 4,
        color: '#7F1D1D'
      }
    }, "La cr\xE9ation de client est indisponible tant que ce point n'est pas r\xE9solu.")), !clientsErreur && clients.length === 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 12,
        color: 'var(--gray-400)'
      }
    }, "Aucun client dans le r\xE9f\xE9rentiel des Bons d'Apport.")), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--gray-400)',
        borderTop: '1px solid var(--gray-100)',
        paddingTop: 10
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-circle-info",
      style: {
        marginRight: 5
      }
    }), "Pour ajouter un client, passez par ", /*#__PURE__*/React.createElement("strong", null, "Achats \u2192 Bons d'Apport \u2192 March\xE9 Local \u2192 + Nouveau client"), ". Il appara\xEEtra ici, pr\xEAt \xE0 \xEAtre suivi."))), canEdit && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginTop: 18
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: enregistrer,
      disabled: saving || !modifie,
      style: {
        padding: '10px 22px',
        borderRadius: 10,
        border: 'none',
        background: 'var(--berry)',
        color: 'white',
        cursor: modifie ? 'pointer' : 'default',
        fontSize: 13,
        fontWeight: 600,
        opacity: saving || !modifie ? 0.45 : 1
      }
    }, saving ? /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-spinner fa-spin",
      style: {
        marginRight: 6
      }
    }) : /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-floppy-disk",
      style: {
        marginRight: 6
      }
    }), "Enregistrer"), modifie && /*#__PURE__*/React.createElement("button", {
      onClick: charger,
      disabled: saving,
      style: {
        padding: '10px 18px',
        borderRadius: 10,
        border: '1px solid var(--gray-200)',
        background: 'white',
        cursor: 'pointer',
        fontSize: 13,
        color: 'var(--gray-600)'
      }
    }, "Annuler les modifications"), modifie && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: 'var(--orange)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-circle-exclamation",
      style: {
        marginRight: 5
      }
    }), "Modifications non enregistr\xE9es")), toast && /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 1000,
        padding: '10px 16px',
        borderRadius: 8,
        background: toast.kind === 'error' ? '#E74C3C' : '#1A7A3F',
        color: 'white',
        fontSize: 12.5,
        fontWeight: 600,
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: `fa-solid ${toast.kind === 'error' ? 'fa-triangle-exclamation' : 'fa-circle-check'}`,
      style: {
        marginRight: 6
      }
    }), toast.msg));
  }
  window.CaisseParametresSub = CaisseParametresSub;
})();
