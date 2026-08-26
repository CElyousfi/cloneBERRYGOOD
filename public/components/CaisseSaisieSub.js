/*
 * CaisseSaisieSub.jsx — Formulaire de bon de caisse (Gestion de Caisse).
 *
 * BIMODAL :
 *   - création  (editTx absent)  → POST /api/caisse?action=create-transaction
 *   - édition   (editTx fourni)  → POST /api/caisse?action=update-transaction
 *
 * Extrait de public/app.jsx à comportement IDENTIQUE en mode création (règle de
 * modularisation progressive, CLAUDE.md) ; le mode édition est l'ajout.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL
 * du navigateur : tout est wrappé dans une IIFE, aucun identifiant top-level ne
 * fuite (cf. crashes #75/#77 — mémoire umd-global-collision-smoke-load). UN seul
 * global exposé : window.CaisseSaisieSub. Identifiants internes préfixés CSAI_.
 *
 * Dépendances lues sur window (elles vivaient dans le scope d'app.jsx) :
 *   - window.TXN_TYPE_LABELS  (libellés/couleurs des types de transaction)
 *
 * Props :
 *   - caisses        Array<{id, nom}>   caisses actives
 *   - onDone         () => void         succès (le parent recharge + ferme)
 *   - onCancel       () => void         annulation (mode édition uniquement)
 *   - defaultType    string             type pré-sélectionné (création)
 *   - defaultCaisseId string            caisse pré-sélectionnée (création)
 *   - editTx         Object|null        transaction à modifier ; active le mode édition
 */
(function () {
  const {
    useState
  } = React;

  // Repli local si app.js n'a pas encore posé le global (ordre de <script>).
  const CSAI_FALLBACK_TYPES = {
    alimentation: {
      label: 'Alimentation',
      icon: 'fa-arrow-down',
      color: 'var(--green)',
      bg: 'rgba(45,139,78,0.1)'
    },
    depense: {
      label: 'Dépense',
      icon: 'fa-arrow-up',
      color: 'var(--red)',
      bg: 'rgba(231,76,60,0.1)'
    },
    sortie: {
      label: 'Sortie',
      icon: 'fa-arrow-right-from-bracket',
      color: 'var(--orange)',
      bg: 'rgba(243,156,18,0.1)'
    },
    paie: {
      label: 'Paie',
      icon: 'fa-money-check-dollar',
      color: '#9b59b6',
      bg: 'rgba(155,89,182,0.1)'
    },
    transport: {
      label: 'Transport',
      icon: 'fa-truck',
      color: '#16a085',
      bg: 'rgba(22,160,133,0.1)'
    }
  };
  function CSAI_types() {
    return window.TXN_TYPE_LABELS || CSAI_FALLBACK_TYPES;
  }

  // ---- Axes analytiques : ferme / campagne / culture / parcelle ------------
  // Les 4 champs sont FACULTATIFS (les bons existants n'en portent aucun).
  // La campagne n'est jamais saisie : elle est DÉRIVÉE de la date du bon.
  // La parcelle est filtrée par CULTURE + CAMPAGNE, exactement comme dans les
  // Bons de Consommation (MagBCTab). La FERME n'alimente PAS cette liste : elle
  // est déduite de la parcelle choisie.
  const CSAI_FERMES = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'BGF'];
  const CSAI_CULTURES_FALLBACK = ['Framboise', 'Myrtille', 'Avocatier'];
  const CSAI_GENERAL = 'GENERAL';

  /** Campagne agricole d'une date (bascule au 1er juillet). */
  function CSAI_campagneOf(dateStr) {
    if (window.CampagneUtils && window.CampagneUtils.campagneOf) {
      return window.CampagneUtils.campagneOf(dateStr) || '';
    }
    const m = (dateStr || '').match(/^(\d{4})-(\d{2})/);
    if (!m) return '';
    const y = +m[1],
      mo = +m[2];
    const start = mo >= 7 ? y : y - 1;
    return start + '-' + (start + 1);
  }

  /** Prédicat de filtre culture — lib absente ou filtre vide → on ne filtre pas. */
  function CSAI_cultureOk(parcelle, filtre, sbMap) {
    const CU = window.CultureUtils;
    if (!CU || !filtre) return true;
    return CU.matchesCulture(parcelle, filtre, sbMap);
  }
  function CaisseSaisieSub({
    caisses,
    onDone,
    onCancel,
    defaultType,
    defaultCaisseId,
    editTx
  }) {
    const CSAI_isEdit = !!(editTx && editTx.id);
    const CSAI_wasValide = CSAI_isEdit && editTx.status === 'valide';
    const [form, setForm] = useState(() => CSAI_isEdit ? {
      caisse_id: editTx.caisse_id || '',
      type: editTx.type || 'depense',
      montant: editTx.montant === undefined || editTx.montant === null ? '' : String(editTx.montant),
      reference: editTx.reference || '',
      description: editTx.description || '',
      code_analytique: editTx.code_analytique || '',
      date: editTx.date || new Date().toISOString().slice(0, 10),
      files: Array.isArray(editTx.files) ? editTx.files.slice(0, 3) : [],
      matricule: editTx.matricule || '',
      beneficiaire_nom: editTx.beneficiaire_nom || '',
      ferme: editTx.ferme || '',
      culture: editTx.culture || '',
      parcelle: editTx.parcelle || ''
    } : {
      caisse_id: defaultCaisseId || caisses[0] && caisses[0].id || '',
      type: defaultType || 'depense',
      montant: '',
      reference: '',
      description: '',
      code_analytique: '',
      date: new Date().toISOString().slice(0, 10),
      files: [],
      matricule: '',
      beneficiaire_nom: '',
      ferme: '',
      culture: '',
      parcelle: ''
    });
    const [saving, setSaving] = useState(false);
    const [codesAnalytiques, setCodesAnalytiques] = useState([]);
    // Parcelles de la campagne courante / précédente (même source que les Bons
    // de Consommation : action parcelles-campagne-list).
    const [refParcelles, setRefParcelles] = useState({
      courante: [],
      precedente: []
    });
    // Référentiel Smart Berry (culture_sb fait autorité sur la culture BEE ONE).
    const [sbRefMap, setSbRefMap] = useState(() => window.SB_PARCELLE_REF || {});
    React.useEffect(() => {
      fetch('/api/stock?action=list-codes-analytiques').then(r => r.json()).then(json => {
        if (json.success && json.codes) setCodesAnalytiques(json.codes);
      }).catch(() => {});
    }, []);
    React.useEffect(() => {
      fetch('/api/pointage-rh?action=parcelles-campagne-list').then(r => r.json()).then(j => {
        if (j.success) setRefParcelles({
          courante: j.campagne_courante || [],
          precedente: j.campagne_precedente || []
        });
      }).catch(() => {});
    }, []);
    React.useEffect(() => {
      fetch('/api/pointage-rh?action=sb-referentiel-list').then(r => r.json()).then(j => {
        if (!j.success) return;
        const map = {};
        (j.parcelles || []).forEach(p => {
          map[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
        });
        window.SB_PARCELLE_REF = map;
        setSbRefMap(map);
      }).catch(() => {});
    }, []);

    // --- Dérivations des axes analytiques ---
    const campagne = CSAI_campagneOf(form.date);
    const campagneToday = CSAI_campagneOf(new Date().toISOString().slice(0, 10));
    // Le bon appartient à la campagne de SA date : on propose donc les parcelles
    // de cette campagne-là, pas celles d'aujourd'hui.
    const refForCampagne = campagne && campagne !== campagneToday && refParcelles.precedente.length > 0 ? refParcelles.precedente : refParcelles.courante;
    const cultures = window.CultureUtils && window.CultureUtils.CULTURES || CSAI_CULTURES_FALLBACK;
    const parcellesDispo = refForCampagne.filter(p => CSAI_cultureOk(p, form.culture, sbRefMap));
    // Nom affiché = nom_sb du référentiel s'il existe ; la VALEUR stockée reste
    // toujours le libellé BEE ONE (clé de jointure analytique).
    const parcelleNom = label => {
      const e = sbRefMap[(label || '').toUpperCase().trim()];
      return e && e.nom_sb ? e.nom_sb : label || '';
    };
    const parcelleReelle = !!form.parcelle && form.parcelle !== CSAI_GENERAL;

    // Choix d'une parcelle → la ferme en est DÉDUITE (elle reste saisissable à
    // la main sur GENERAL ou sans parcelle).
    const changeParcelle = val => {
      if (!val || val === CSAI_GENERAL) return setForm(f => ({
        ...f,
        parcelle: val
      }));
      const ref = refForCampagne.find(p => p.label === val);
      setForm(f => ({
        ...f,
        parcelle: val,
        ferme: ref && ref.ferme ? ref.ferme : f.ferme
      }));
    };

    // Changement de culture : une parcelle qui sort de la liste filtrée est
    // désélectionnée (GENERAL survit toujours).
    const changeCulture = val => {
      setForm(f => {
        if (!f.parcelle || f.parcelle === CSAI_GENERAL) return {
          ...f,
          culture: val
        };
        const encoreDispo = refForCampagne.some(p => p.label === f.parcelle && CSAI_cultureOk(p, val, sbRefMap));
        return encoreDispo ? {
          ...f,
          culture: val
        } : {
          ...f,
          culture: val,
          parcelle: ''
        };
      });
    };
    const handleFile = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxW = 1200;
          let w = img.width,
            h = img.height;
          if (w > maxW) {
            h = h * maxW / w;
            w = maxW;
          }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          const compressed = canvas.toDataURL('image/jpeg', 0.7);
          setForm(f => ({
            ...f,
            files: [...f.files, {
              name: file.name,
              data: compressed
            }].slice(0, 3)
          }));
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    };
    const removeFile = idx => setForm(f => ({
      ...f,
      files: f.files.filter((_, i) => i !== idx)
    }));

    // ---- Création (comportement d'origine, inchangé) ----
    const submit = asBrouillon => {
      if (!form.caisse_id || !form.type || !form.montant || !form.date) return alert('Veuillez remplir les champs obligatoires');
      if (parseFloat(form.montant) <= 0) return alert('Le montant doit être positif');
      setSaving(true);
      fetch('/api/caisse?action=create-transaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...form,
          montant: parseFloat(form.montant),
          submit: !asBrouillon
        })
      }).then(r => r.json()).then(json => {
        if (json.success) {
          alert(asBrouillon ? 'Brouillon enregistré' : 'Transaction soumise pour validation');
          onDone();
        } else alert('Erreur: ' + (json.error || 'Inconnue'));
      }).catch(err => alert('Erreur: ' + err.message)).finally(() => setSaving(false));
    };

    // ---- Édition ----
    const submitEdit = () => {
      if (!form.caisse_id || !form.type || !form.montant || !form.date) return alert('Veuillez remplir les champs obligatoires');
      if (parseFloat(form.montant) <= 0) return alert('Le montant doit être positif');
      if (CSAI_wasValide && !window.confirm('Ce bon est VALIDÉ.\n\nL\'enregistrer le remettra au statut « Saisi » : le solde de la caisse sera réajusté et le bon devra être re-validé par la DG.\n\nContinuer ?')) return;
      setSaving(true);
      // 'reference' volontairement absente du payload : identifiant métier gelé.
      fetch('/api/caisse?action=update-transaction', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: editTx.id,
          caisse_id: form.caisse_id,
          type: form.type,
          montant: parseFloat(form.montant),
          description: form.description,
          code_analytique: form.code_analytique,
          date: form.date,
          matricule: form.matricule,
          beneficiaire_nom: form.beneficiaire_nom,
          files: form.files,
          // Axes analytiques. La campagne n'est PAS envoyée : le backend la
          // dérive de la date, source unique de vérité.
          ferme: form.ferme,
          culture: form.culture,
          parcelle: form.parcelle
        })
      }).then(r => r.json()).then(json => {
        if (!json.success) return alert('Erreur: ' + (json.error || 'Inconnue'));
        if (!json.changes || json.changes.length === 0) alert('Aucune modification à enregistrer');else if (json.devalidated) alert('Modifications enregistrées — le bon repasse en « Saisi » et doit être re-validé par la DG.');else alert('Modifications enregistrées');
        onDone();
      }).catch(err => alert('Erreur: ' + err.message)).finally(() => setSaving(false));
    };
    const inputStyle = {
      width: '100%',
      padding: '10px 14px',
      borderRadius: 10,
      border: '1px solid var(--gray-200)',
      fontSize: 13,
      fontFamily: 'Inter, sans-serif'
    };
    const TYPES = CSAI_types();
    return /*#__PURE__*/React.createElement("div", {
      style: {
        maxWidth: 640
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'white',
        borderRadius: 12,
        border: '1px solid var(--gray-200)',
        padding: 24
      }
    }, /*#__PURE__*/React.createElement("h4", {
      style: {
        margin: '0 0 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: `fa-solid ${CSAI_isEdit ? 'fa-pen-to-square' : 'fa-plus-circle'}`,
      style: {
        color: 'var(--berry)'
      }
    }), CSAI_isEdit ? `Modifier la transaction — ${editTx.reference || ''}` : 'Nouvelle Transaction'), CSAI_wasValide && /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '10px 14px',
        marginBottom: 16,
        borderRadius: 10,
        background: '#FEF3C7',
        border: '1px solid #FDE68A',
        fontSize: 12,
        color: '#92400E'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginTop: 2
      }
    }), /*#__PURE__*/React.createElement("span", null, "Ce bon est ", /*#__PURE__*/React.createElement("strong", null, "valid\xE9"), ". L'enregistrer le remettra au statut \xAB Saisi \xBB : le solde de la caisse sera r\xE9ajust\xE9 et le bon devra \xEAtre ", /*#__PURE__*/React.createElement("strong", null, "re-valid\xE9 par la DG"), ".")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Caisse *"), /*#__PURE__*/React.createElement("select", {
      value: form.caisse_id,
      onChange: e => setForm({
        ...form,
        caisse_id: e.target.value
      }),
      style: inputStyle
    }, caisses.map(c => /*#__PURE__*/React.createElement("option", {
      key: c.id,
      value: c.id
    }, c.nom)))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Type *"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 6,
        flexWrap: 'wrap'
      }
    }, ['alimentation', 'depense', 'sortie', 'paie', 'transport'].map(t => {
      const tt = TYPES[t] || {};
      return /*#__PURE__*/React.createElement("button", {
        key: t,
        onClick: () => setForm({
          ...form,
          type: t
        }),
        style: {
          flex: '1 0 calc(33% - 6px)',
          padding: '8px 6px',
          borderRadius: 8,
          border: form.type === t ? `2px solid ${tt.color}` : '1px solid var(--gray-200)',
          background: form.type === t ? tt.bg : 'white',
          color: form.type === t ? tt.color : 'var(--gray-600)',
          fontSize: 11,
          fontWeight: form.type === t ? 700 : 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: `fa-solid ${tt.icon}`
      }), tt.label);
    }))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Montant (DH) *"), /*#__PURE__*/React.createElement("input", {
      type: "number",
      step: "0.01",
      min: "0",
      value: form.montant,
      onChange: e => setForm({
        ...form,
        montant: e.target.value
      }),
      style: inputStyle,
      placeholder: "0.00"
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Date *"), /*#__PURE__*/React.createElement("input", {
      type: "date",
      value: form.date,
      onChange: e => setForm({
        ...form,
        date: e.target.value
      }),
      style: inputStyle
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "R\xE9f\xE9rence"), CSAI_isEdit ? /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: form.reference,
      readOnly: true,
      disabled: true,
      title: "La r\xE9f\xE9rence d'un bon ne se modifie pas",
      style: {
        ...inputStyle,
        background: 'var(--gray-100)',
        color: 'var(--gray-600)',
        fontFamily: 'monospace',
        cursor: 'not-allowed'
      }
    }) : /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: form.reference,
      onChange: e => setForm({
        ...form,
        reference: e.target.value
      }),
      style: inputStyle,
      placeholder: "Auto-g\xE9n\xE9r\xE9e si vide"
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Code Analytique"), /*#__PURE__*/React.createElement("select", {
      value: form.code_analytique,
      onChange: e => setForm({
        ...form,
        code_analytique: e.target.value
      }),
      style: inputStyle
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u2014 Aucun \u2014"), codesAnalytiques.map(c => /*#__PURE__*/React.createElement("option", {
      key: c,
      value: c
    }, c)), form.code_analytique && codesAnalytiques.indexOf(form.code_analytique) === -1 && /*#__PURE__*/React.createElement("option", {
      value: form.code_analytique
    }, form.code_analytique))), /*#__PURE__*/React.createElement("div", {
      style: {
        gridColumn: '1/-1',
        marginTop: 4,
        paddingTop: 12,
        borderTop: '1px dashed var(--gray-200)',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-400)'
      }
    }, "AFFECTATION ", /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 400,
        textTransform: 'none'
      }
    }, "\u2014 facultatif")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Campagne"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: campagne || '—',
      readOnly: true,
      disabled: true,
      title: "D\xE9duite automatiquement de la date du bon",
      style: {
        ...inputStyle,
        background: 'var(--gray-100)',
        color: 'var(--gray-600)',
        cursor: 'not-allowed'
      }
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Culture"), /*#__PURE__*/React.createElement("select", {
      value: form.culture,
      onChange: e => changeCulture(e.target.value),
      style: inputStyle
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u2014 Toutes \u2014"), cultures.map(v => /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, v)))), /*#__PURE__*/React.createElement("div", {
      style: {
        gridColumn: '1/-1'
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Parcelle"), /*#__PURE__*/React.createElement("select", {
      value: form.parcelle,
      onChange: e => changeParcelle(e.target.value),
      style: inputStyle
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u2014 Aucune \u2014"), /*#__PURE__*/React.createElement("option", {
      value: CSAI_GENERAL
    }, CSAI_GENERAL, " \u2014 d\xE9pense non rattach\xE9e \xE0 une parcelle"), parcellesDispo.map(p => /*#__PURE__*/React.createElement("option", {
      key: p.label,
      value: p.label
    }, parcelleNom(p.label))), form.parcelle && form.parcelle !== CSAI_GENERAL && !parcellesDispo.some(p => p.label === form.parcelle) && /*#__PURE__*/React.createElement("option", {
      value: form.parcelle
    }, parcelleNom(form.parcelle), " (hors campagne/culture)")), form.culture && parcellesDispo.length === 0 && /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: 'var(--orange)',
        marginTop: 4
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-circle-info",
      style: {
        marginRight: 4
      }
    }), "Aucune parcelle ", form.culture, " pour la campagne ", campagne || '—', ".")), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Ferme", parcelleReelle && /*#__PURE__*/React.createElement("span", {
      style: {
        fontWeight: 400,
        color: 'var(--gray-400)'
      }
    }, " \u2014 d\xE9duite de la parcelle")), parcelleReelle ? /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: form.ferme || '—',
      readOnly: true,
      disabled: true,
      style: {
        ...inputStyle,
        background: 'var(--gray-100)',
        color: 'var(--gray-600)',
        cursor: 'not-allowed'
      }
    }) : /*#__PURE__*/React.createElement("select", {
      value: form.ferme,
      onChange: e => setForm({
        ...form,
        ferme: e.target.value
      }),
      style: inputStyle
    }, /*#__PURE__*/React.createElement("option", {
      value: ""
    }, "\u2014 Aucune \u2014"), CSAI_FERMES.map(f => /*#__PURE__*/React.createElement("option", {
      key: f,
      value: f
    }, f)))), /*#__PURE__*/React.createElement("div", null), (form.type === 'paie' || form.type === 'transport') && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Matricule"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: form.matricule,
      onChange: e => setForm({
        ...form,
        matricule: e.target.value
      }),
      style: inputStyle,
      placeholder: "Ex: 02123"
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "B\xE9n\xE9ficiaire (Nom)"), /*#__PURE__*/React.createElement("input", {
      type: "text",
      value: form.beneficiaire_nom,
      onChange: e => setForm({
        ...form,
        beneficiaire_nom: e.target.value
      }),
      style: inputStyle,
      placeholder: "Nom de l'employ\xE9"
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        gridColumn: '1/-1'
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Description"), /*#__PURE__*/React.createElement("textarea", {
      value: form.description,
      onChange: e => setForm({
        ...form,
        description: e.target.value
      }),
      style: {
        ...inputStyle,
        minHeight: 70,
        resize: 'vertical'
      },
      placeholder: "Description de la transaction..."
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        gridColumn: '1/-1'
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--gray-600)',
        marginBottom: 4,
        display: 'block'
      }
    }, "Pi\xE8ces jointes (max 3)"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 8
      }
    }, form.files.map((f, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      style: {
        position: 'relative',
        width: 70,
        height: 70
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: f.data || f.url,
      alt: "",
      style: {
        width: 70,
        height: 70,
        objectFit: 'cover',
        borderRadius: 8,
        border: '1px solid var(--gray-200)'
      }
    }), /*#__PURE__*/React.createElement("button", {
      onClick: () => removeFile(i),
      style: {
        position: 'absolute',
        top: -6,
        right: -6,
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: 'var(--red)',
        color: 'white',
        border: 'none',
        cursor: 'pointer',
        fontSize: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-xmark"
    }))))), form.files.length < 3 && /*#__PURE__*/React.createElement("label", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        borderRadius: 8,
        border: '1px dashed var(--gray-200)',
        cursor: 'pointer',
        fontSize: 12,
        color: 'var(--gray-600)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-camera"
    }), "Ajouter une photo", /*#__PURE__*/React.createElement("input", {
      type: "file",
      accept: "image/*",
      onChange: handleFile,
      style: {
        display: 'none'
      }
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10,
        marginTop: 20,
        justifyContent: 'flex-end'
      }
    }, CSAI_isEdit ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      onClick: () => onCancel && onCancel(),
      disabled: saving,
      style: {
        padding: '10px 20px',
        borderRadius: 10,
        border: '1px solid var(--gray-200)',
        background: 'white',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 500,
        opacity: saving ? 0.5 : 1
      }
    }, "Annuler"), /*#__PURE__*/React.createElement("button", {
      onClick: submitEdit,
      disabled: saving,
      style: {
        padding: '10px 20px',
        borderRadius: 10,
        border: 'none',
        background: 'var(--berry)',
        color: 'white',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        opacity: saving ? 0.5 : 1
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
    }), "Enregistrer les modifications")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("button", {
      onClick: () => submit(true),
      disabled: saving,
      style: {
        padding: '10px 20px',
        borderRadius: 10,
        border: '1px solid var(--gray-200)',
        background: 'white',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 500,
        opacity: saving ? 0.5 : 1
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-floppy-disk",
      style: {
        marginRight: 6
      }
    }), "Enregistrer brouillon"), /*#__PURE__*/React.createElement("button", {
      onClick: () => submit(false),
      disabled: saving,
      style: {
        padding: '10px 20px',
        borderRadius: 10,
        border: 'none',
        background: 'var(--berry)',
        color: 'white',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        opacity: saving ? 0.5 : 1
      }
    }, saving ? /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-spinner fa-spin",
      style: {
        marginRight: 6
      }
    }) : /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-paper-plane",
      style: {
        marginRight: 6
      }
    }), "Soumettre pour validation")))));
  }
  window.CaisseSaisieSub = CaisseSaisieSub;
})();
