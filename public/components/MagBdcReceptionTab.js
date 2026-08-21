/*
 * MagBdcReceptionTab.jsx — Onglet magasinier "BDC à réceptionner" : réception
 * physique (BL) d'un bon de commande validé.
 *
 * La "réception libre" (sans BDC) a été retirée de cet onglet sur décision
 * d'Omar (2026-08 : « elle n'a pas de sens ») — elle faisait doublon avec le
 * bon d'entrée de l'onglet "Bons de Réception" (même action create-movement,
 * même payload reception_libre). Le chemin SERVEUR reste en place : les
 * réceptions libres déjà en base doivent rester lisibles dans l'Historique.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE, aucun identifiant top-level qui fuite (cf.
 * crashes #75/#77 — mémoire umd-global-collision-smoke-load). Un seul global
 * exposé : window.MagBdcReceptionTab.
 *
 * Reliquat par article : le plafond de réception (reliquat = commandé − déjà
 * reçu) est calculé via public/lib/bdcReceptionUtils.js (window.BdcReceptionUtils
 * .computeDeliveryData), à partir des BL déjà créés pour ce BDC
 * (/api/stock?action=list-bl&bdc_id=...). La validation serveur (functions/index.js,
 * action create-bl) reste la garde qui fait foi — celle-ci n'est qu'un filet
 * côté UI pour éviter une sur-réception évidente et donner de la visibilité au
 * magasinier (colonnes "Déjà reçu" / "Reliquat", input plafonné et désactivé
 * quand il n'y a plus de reliquat pour la ligne).
 *
 * Props :
 *   - currentProfile : id du profil courant (string)
 *   - profileData    : objet profil (name, userId, …)
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  function MagBdcReceptionTab({
    currentProfile,
    profileData
  }) {
    // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
    const MAGASINS = window.useStockLocations().magasins;
    // La destination d'une réception sur BDC est IMPOSÉE par la ferme du BDC
    // (décision produit) : resolveBdcDestination tranche « imposé » vs « libre »
    // (BDC mutualisé `ferme: 'Toutes'` ou sans ferme).
    // Pas de fallback si lib/stockDestinations.js manque : un échec visible vaut
    // mieux qu'une réception BAHIA imputée silencieusement à F1.
    const resolveBdcDest = window.StockDestinations.resolveBdcDestination;
    const resolveReceptionDest = window.StockDestinations.resolveReceptionDestination;
    const [bdcList, setBdcList] = useState([]);
    const [receptions, setReceptions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [bdcQuery, setBdcQuery] = useState('');
    const [selectedBdc, setSelectedBdc] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [blForm, setBlForm] = useState({
      date_reception: '',
      numero_bl_fournisseur: '',
      magasin: MAGASINS[0] || '',
      items: []
    });
    const [blFormError, setBlFormError] = useState(null);
    const [blScanFile, setBlScanFile] = useState(null);
    const [blScanPreview, setBlScanPreview] = useState(null);
    const loadData = () => {
      setLoading(true);
      // list-articles / list-suppliers ne sont plus chargés : ils n'alimentaient que
      // le formulaire de réception libre, retiré de cet onglet.
      Promise.all([fetch('/api/stock?action=list-bdc&status=valide_dg,envoye,virement_lance,virement_signe&limit=500').then(r => r.json()), fetch('/api/stock?action=list-movements&type=reception&limit=100').then(r => r.json())]).then(([bdcJson, movJson]) => {
        if (bdcJson.success) setBdcList((bdcJson.bdc || []).filter(b => ['valide_dg', 'envoye', 'virement_lance', 'virement_signe'].includes(b.status) && b.delivery_status !== 'complet'));
        if (movJson.success) setReceptions(movJson.movements || []);
      }).catch(err => console.warn('Reception error:', err)).finally(() => setLoading(false));
    };
    useEffect(() => {
      loadData();
    }, []);
    const handleScanFile = (file, setter, previewSetter) => {
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) {
        alert('Fichier trop volumineux (max 10 Mo)');
        return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        setter(e.target.result);
        previewSetter(file.type.startsWith('image/') ? e.target.result : file.name);
      };
      reader.readAsDataURL(file);
    };
    const uploadScan = async base64 => {
      if (!base64) return null;
      const res = await fetch('/api/stock?action=upload-scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          file_base64: base64,
          filename: 'scan_bl.jpg',
          contentType: 'image/jpeg'
        })
      });
      const json = await res.json();
      return json.success ? json.url : null;
    };
    const openBdcForBl = bdc => {
      if (bdc.delivery_status === 'complet') {
        alert('Ce BDC est déjà entièrement réceptionné.');
        return;
      }
      setSelectedBdc(bdc);
      setBlForm({
        date_reception: new Date().toISOString().split('T')[0],
        numero_bl_fournisseur: '',
        magasin: resolveBdcDest(MAGASINS, bdc.ferme).magasin,
        items: []
      });
      setBlFormError(null);
      setBlScanFile(null);
      setBlScanPreview(null);
      setShowForm(true);
      // Reliquat par article : fetch les BL déjà créés pour ce BDC et calcule reçu/reliquat
      // via l'utilitaire partagé (même logique que AchatsBDCTab / MagBonsCommandeTab).
      fetch('/api/stock?action=list-bl&bdc_id=' + bdc.id).then(r => r.json()).then(json => {
        const resolved = window.BdcReceptionUtils.resolveDeliveryDataOrError(json);
        if (!resolved.ok) {
          // NE JAMAIS retomber sur reliquat = quantité commandée quand la donnée
          // est en fait indisponible (bug BDC-2026-0142) : on bloque la saisie
          // et on affiche l'erreur au magasinier, la garde serveur (create-bl)
          // reste la protection qui fait foi contre la sur-réception.
          setBlFormError(resolved.error);
          setBlForm(prev => ({
            ...prev,
            items: []
          }));
          return;
        }
        const delivery = window.BdcReceptionUtils.computeDeliveryData(bdc.items, resolved.data);
        const deliveryByArticle = {};
        delivery.forEach(d => {
          deliveryByArticle[d.article] = d;
        });
        const items = (bdc.items || []).map(it => {
          const d = deliveryByArticle[it.article];
          return {
            article: it.article,
            quantite_commandee: it.quantite,
            quantite_deja_recue: d ? d.qLiv : 0,
            reliquat: d ? d.reste : parseFloat(it.quantite) || 0,
            quantite_recue: '',
            unite: it.unite || 'kg',
            note: ''
          };
        });
        setBlForm(prev => ({
          ...prev,
          items
        }));
      }).catch(() => {
        // Filet réseau : ne pas prétendre à un reliquat fiable, bloquer la saisie.
        setBlFormError('Impossible de charger les réceptions déjà faites pour ce BDC — reliquat indisponible. Réessaie ou contacte le support.');
        setBlForm(prev => ({
          ...prev,
          items: []
        }));
      });
    };
    const updateBlItem = (idx, field, value) => {
      const items = [...blForm.items];
      // Clampe en temps réel la quantité reçue au reliquat de la ligne : on ne
      // doit pas pouvoir dépasser le reliquat en saisie (bug BDC-2026-0142,
      // max={reliquat} ne bloque que les flèches +/- du input number, pas le
      // clavier/collage). Le filet handleCreateBl reste en place en complément.
      const finalValue = field === 'quantite_recue' ? window.BdcReceptionUtils.clampReceivedQty(value, items[idx].reliquat) : value;
      items[idx] = {
        ...items[idx],
        [field]: finalValue
      };
      setBlForm({
        ...blForm,
        items
      });
    };
    const handleCreateBl = async () => {
      if (blFormError) {
        alert('Réception impossible : ' + blFormError);
        return;
      }
      if (!blForm.items.some(i => parseFloat(i.quantite_recue) > 0)) {
        alert('Saisissez au moins une quantité reçue');
        return;
      }
      const validItems = blForm.items.filter(i => parseFloat(i.quantite_recue) > 0);
      // Filet client : rejette si une quantité saisie dépasse son reliquat. La garde qui fait
      // foi reste la validation serveur (create-bl) — ceci n'évite qu'une soumission évidente.
      const overReliquat = validItems.find(i => parseFloat(i.quantite_recue) > (parseFloat(i.reliquat) || 0) + 0.01);
      if (overReliquat) {
        alert('Quantité reçue supérieure au reliquat pour ' + overReliquat.article + ' (reliquat: ' + overReliquat.reliquat + ')');
        return;
      }
      let scanUrl = null;
      if (blScanFile) {
        scanUrl = await uploadScan(blScanFile);
      }
      // Destination recalculée à la soumission : quand elle est imposée, c'est
      // la ferme du BDC qui part au serveur, jamais un reliquat de state (la
      // config stock peut être arrivée après l'ouverture du formulaire).
      const destAtSubmit = resolveBdcDest(MAGASINS, selectedBdc.ferme);
      const magasinFinal = destAtSubmit.locked ? destAtSubmit.magasin : blForm.magasin;
      fetch('/api/stock?action=create-bl', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bdc_id: selectedBdc.id,
          date_reception: blForm.date_reception,
          numero_bl_fournisseur: blForm.numero_bl_fournisseur,
          magasin: magasinFinal,
          items: validItems,
          scan_url: scanUrl,
          created_by: {
            profileId: currentProfile,
            name: profileData?.name || currentProfile,
            userId: profileData?.userId || ''
          }
        })
      }).then(r => r.json()).then(json => {
        if (json.success) {
          alert('Bon de réception créé. En attente de valorisation Achats.');
          setShowForm(false);
          setSelectedBdc(null);
          loadData();
        } else alert('Erreur: ' + (json.error || 'Echec'));
      }).catch(() => alert('Erreur réseau'));
    };
    const statusLabel = s => s === 'valide_chef' ? 'Validé' : s === 'en_attente_achats' ? 'À valoriser par Achats' : s === 'valide_mag' ? 'À valider par Achats' : s === 'valide_achats' ? 'À valider par Chef' : s === 'rejete' ? 'Rejeté' : s;
    const statusClass = s => s === 'valide_chef' ? 'valide' : s === 'rejete' ? 'rejete' : 'en-attente';
    if (loading) return React.createElement('div', {
      className: 'fade-in',
      style: {
        textAlign: 'center',
        padding: 60
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-spinner fa-spin',
      style: {
        fontSize: 32,
        color: 'var(--berry)'
      }
    }));
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
      className: "fa-solid fa-clipboard-check",
      style: {
        marginRight: 8,
        color: 'var(--berry)'
      }
    }), "BDC \xE0 r\xE9ceptionner"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap'
      }
    }, /*#__PURE__*/React.createElement("input", {
      type: "search",
      placeholder: "Rechercher (n\xB0, fournisseur, article\u2026)",
      value: bdcQuery,
      onChange: e => setBdcQuery(e.target.value),
      style: {
        padding: '6px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 12,
        minWidth: 240
      }
    }))), /*#__PURE__*/React.createElement("div", {
      className: "panel",
      style: {
        marginBottom: 20
      }
    }, (() => {
      const q = bdcQuery.toLowerCase();
      const filteredBdc = !q ? bdcList : bdcList.filter(b => (b.numero || '').toLowerCase().includes(q) || (b.fournisseur?.nom || '').toLowerCase().includes(q) || (b.ferme || '').toLowerCase().includes(q) || (b.items || []).some(i => (i.article || '').toLowerCase().includes(q)));
      return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h4", {
        style: {
          marginTop: 0
        }
      }, "BDC en attente de livraison (", filteredBdc.length, ")"), filteredBdc.length === 0 ? /*#__PURE__*/React.createElement("p", {
        style: {
          color: 'var(--gray-400)',
          textAlign: 'center',
          padding: 20
        }
      }, "Aucun BDC valid\xE9 en attente de livraison.") : /*#__PURE__*/React.createElement("div", {
        className: "table-responsive"
      }, /*#__PURE__*/React.createElement("table", {
        className: "data-table"
      }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "N\xB0 BDC"), /*#__PURE__*/React.createElement("th", null, "Fournisseur"), /*#__PURE__*/React.createElement("th", null, "Ferme"), /*#__PURE__*/React.createElement("th", null, "Articles"), /*#__PURE__*/React.createElement("th", null, "Total TTC"), /*#__PURE__*/React.createElement("th", null, "Livraison"), /*#__PURE__*/React.createElement("th", null))), /*#__PURE__*/React.createElement("tbody", null, filteredBdc.map(b => /*#__PURE__*/React.createElement("tr", {
        key: b.id
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          fontWeight: 700,
          color: 'var(--berry)',
          fontSize: 12
        }
      }, b.numero), /*#__PURE__*/React.createElement("td", {
        style: {
          fontWeight: 600
        }
      }, b.fournisseur?.nom || '—'), /*#__PURE__*/React.createElement("td", null, b.ferme), /*#__PURE__*/React.createElement("td", {
        style: {
          textAlign: 'center'
        }
      }, b.items?.length || 0), /*#__PURE__*/React.createElement("td", {
        style: {
          fontWeight: 700
        }
      }, (b.total_ttc || 0).toLocaleString('fr-FR', {
        minimumFractionDigits: 2
      }), " MAD"), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("span", {
        className: 'status-badge ' + (b.delivery_status === 'complet' ? 'valide' : b.delivery_status === 'partiel' ? 'en-attente' : 'brouillon')
      }, b.delivery_status === 'complet' ? 'Complet' : b.delivery_status === 'partiel' ? 'Partiel' : 'Non livré')), /*#__PURE__*/React.createElement("td", null, currentProfile === 'magasinier' && /*#__PURE__*/React.createElement("button", {
        onClick: () => openBdcForBl(b),
        style: {
          padding: '5px 12px',
          borderRadius: 6,
          border: 'none',
          background: 'var(--berry)',
          color: '#fff',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: 11
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-plus",
        style: {
          marginRight: 4
        }
      }), "R\xE9ceptionner"))))))));
    })()), showForm && selectedBdc && /*#__PURE__*/React.createElement("div", {
      className: "modal-overlay",
      onClick: e => {
        if (e.target === e.currentTarget) {
          setShowForm(false);
          setSelectedBdc(null);
        }
      }
    }, /*#__PURE__*/React.createElement("div", {
      className: "modal-content",
      style: {
        maxWidth: 800,
        maxHeight: '90vh',
        overflowY: 'auto'
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        marginTop: 0,
        color: 'var(--berry)'
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-truck-ramp-box",
      style: {
        marginRight: 8
      }
    }), "R\xE9ception \u2014 BDC ", selectedBdc.numero), /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#f8f8f8',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("strong", null, "Fournisseur:"), " ", selectedBdc.fournisseur?.nom, " \u2014 ", /*#__PURE__*/React.createElement("strong", null, "Ferme:"), " ", selectedBdc.ferme), blFormError && /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#fdecea',
        border: '1px solid var(--red)',
        color: 'var(--red)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-triangle-exclamation",
      style: {
        marginRight: 6
      }
    }), blFormError), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: 12,
        marginBottom: 16,
        opacity: blFormError ? 0.5 : 1,
        pointerEvents: blFormError ? 'none' : 'auto'
      }
    }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "Date de r\xE9ception"), /*#__PURE__*/React.createElement("input", {
      type: "date",
      value: blForm.date_reception,
      onChange: e => setBlForm({
        ...blForm,
        date_reception: e.target.value
      }),
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, "N\xB0 BL Fournisseur"), /*#__PURE__*/React.createElement("input", {
      value: blForm.numero_bl_fournisseur,
      onChange: e => setBlForm({
        ...blForm,
        numero_bl_fournisseur: e.target.value
      }),
      placeholder: "R\xE9f BL",
      style: {
        width: '100%',
        padding: '8px 12px',
        borderRadius: 8,
        border: '1px solid #ddd',
        fontSize: 13
      }
    })), (() => {
      // Destination IMPOSÉE uniquement pour une ferme à stock non
      // mutualisé (BAHIA, entité juridique distincte) : champ en
      // lecture seule — pas un select désactivé, qui laisserait
      // croire à un choix. Partout ailleurs (F1..F6, Avocatier,
      // BDC mutualisé), le choix reste libre.
      const bdcDest = resolveBdcDest(MAGASINS, selectedBdc.ferme);
      if (bdcDest.locked) {
        return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
          style: {
            fontSize: 12,
            fontWeight: 600,
            display: 'block',
            marginBottom: 4
          }
        }, "Magasin destination"), /*#__PURE__*/React.createElement("div", {
          style: {
            width: '100%',
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-lock",
          style: {
            fontSize: 11,
            color: 'var(--gray-400)'
          }
        }), /*#__PURE__*/React.createElement("span", {
          style: {
            fontWeight: 700,
            color: 'var(--berry)'
          }
        }, bdcDest.magasin), /*#__PURE__*/React.createElement("span", {
          style: {
            fontSize: 11,
            color: 'var(--gray-400)'
          }
        }, "impos\xE9 par le BDC")), bdcDest.note && /*#__PURE__*/React.createElement("div", {
          style: {
            marginTop: 4,
            fontSize: 11,
            color: 'var(--gray-400)',
            lineHeight: 1.4
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-circle-info",
          style: {
            marginRight: 4
          }
        }), bdcDest.note));
      }
      // Choix libre. Les options passent par resolveReceptionDestination
      // pour que blForm.magasin corresponde toujours à une <option>
      // rendue, y compris après la bascule fallback → vraie config de
      // useStockLocations, et pour que la ferme du BDC reste proposée.
      // fermePreselection vaut '' sur un BDC mutualisé : pas d'option
      // « Toutes (hors config stock) » fabriquée à partir du fourre-tout.
      const dest = resolveReceptionDest(MAGASINS, bdcDest.fermePreselection, blForm.magasin);
      const showWarning = !!dest.warning;
      return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("label", {
        style: {
          fontSize: 12,
          fontWeight: 600,
          display: 'block',
          marginBottom: 4
        }
      }, "Magasin destination"), /*#__PURE__*/React.createElement("select", {
        value: blForm.magasin,
        onChange: e => setBlForm({
          ...blForm,
          magasin: e.target.value
        }),
        style: {
          width: '100%',
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid ' + (showWarning ? '#b45309' : '#ddd'),
          fontSize: 13
        }
      }, dest.options.map(o => /*#__PURE__*/React.createElement("option", {
        key: o.value,
        value: o.value
      }, o.label))), showWarning && /*#__PURE__*/React.createElement("div", {
        style: {
          marginTop: 4,
          fontSize: 11,
          color: '#b45309',
          lineHeight: 1.4
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-triangle-exclamation",
        style: {
          marginRight: 4
        }
      }), dest.warning));
    })()), /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 16
      }
    }, /*#__PURE__*/React.createElement("label", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        display: 'block',
        marginBottom: 4
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-paperclip",
      style: {
        marginRight: 4
      }
    }), "Scanner le BL fournisseur"), /*#__PURE__*/React.createElement("input", {
      type: "file",
      accept: "image/*,application/pdf",
      onChange: e => handleScanFile(e.target.files[0], setBlScanFile, setBlScanPreview),
      style: {
        fontSize: 12
      }
    }), blScanPreview && (typeof blScanPreview === 'string' && blScanPreview.startsWith('data:image') ? /*#__PURE__*/React.createElement("img", {
      src: blScanPreview,
      alt: "Scan",
      style: {
        maxHeight: 80,
        marginTop: 6,
        borderRadius: 6
      }
    }) : /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: 'var(--green)',
        marginLeft: 8
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-check"
    }), " Fichier s\xE9lectionn\xE9"))), !blFormError && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("h4", {
      style: {
        marginBottom: 8
      }
    }, "Articles \xE0 r\xE9ceptionner"), /*#__PURE__*/React.createElement("table", {
      className: "data-table",
      style: {
        fontSize: 12
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, /*#__PURE__*/React.createElement("th", null, "Article"), /*#__PURE__*/React.createElement("th", null, "Qt\xE9 command\xE9e"), /*#__PURE__*/React.createElement("th", null, "D\xE9j\xE0 re\xE7u"), /*#__PURE__*/React.createElement("th", null, "Reliquat"), /*#__PURE__*/React.createElement("th", null, "Qt\xE9 re\xE7ue"), /*#__PURE__*/React.createElement("th", null, "Unit\xE9"), /*#__PURE__*/React.createElement("th", null, "\xC9cart"), /*#__PURE__*/React.createElement("th", null, "Note"))), /*#__PURE__*/React.createElement("tbody", null, blForm.items.map((it, idx) => {
      const reliquat = parseFloat(it.reliquat);
      const ecart = window.BdcReceptionUtils.computeReceptionEcart(it.quantite_recue, it.reliquat, it.quantite_commandee);
      const noReliquat = !isNaN(reliquat) && reliquat <= 0;
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
      }, it.quantite_commandee), /*#__PURE__*/React.createElement("td", {
        style: {
          textAlign: 'center',
          color: 'var(--gray-400)'
        }
      }, it.quantite_deja_recue ?? 0), /*#__PURE__*/React.createElement("td", {
        style: {
          textAlign: 'center',
          fontWeight: 700,
          color: noReliquat ? 'var(--gray-400)' : 'var(--berry)'
        }
      }, isNaN(reliquat) ? it.quantite_commandee : reliquat), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
        type: "number",
        value: it.quantite_recue,
        min: "0",
        max: isNaN(reliquat) ? undefined : reliquat,
        disabled: noReliquat,
        onChange: e => updateBlItem(idx, 'quantite_recue', e.target.value),
        style: {
          width: 80,
          padding: '4px 8px',
          borderRadius: 6,
          border: ecart < 0 ? '2px solid var(--red)' : ecart > 0 ? '2px solid var(--blue)' : '1px solid #ddd',
          fontSize: 12,
          textAlign: 'right',
          background: noReliquat ? '#f1f5f9' : '#fff',
          cursor: noReliquat ? 'not-allowed' : 'text'
        }
      })), /*#__PURE__*/React.createElement("td", null, it.unite), /*#__PURE__*/React.createElement("td", {
        style: {
          textAlign: 'center',
          fontWeight: 600,
          color: ecart < 0 ? 'var(--red)' : ecart > 0 ? 'var(--blue)' : 'var(--green)'
        }
      }, it.quantite_recue ? (ecart > 0 ? '+' : '') + ecart : '—'), /*#__PURE__*/React.createElement("td", null, /*#__PURE__*/React.createElement("input", {
        value: it.note || '',
        onChange: e => updateBlItem(idx, 'note', e.target.value),
        placeholder: "Note...",
        style: {
          width: '100%',
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid #ddd',
          fontSize: 11
        }
      })));
    })))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 8,
        justifyContent: 'flex-end',
        marginTop: 16
      }
    }, /*#__PURE__*/React.createElement("button", {
      onClick: () => {
        setShowForm(false);
        setSelectedBdc(null);
      },
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: '1px solid #ddd',
        background: '#fff',
        cursor: 'pointer',
        fontSize: 13
      }
    }, "Annuler"), /*#__PURE__*/React.createElement("button", {
      onClick: handleCreateBl,
      disabled: !!blFormError,
      style: {
        padding: '8px 16px',
        borderRadius: 8,
        border: 'none',
        background: blFormError ? 'var(--gray-400)' : 'var(--berry)',
        color: '#fff',
        cursor: blFormError ? 'not-allowed' : 'pointer',
        fontWeight: 600,
        fontSize: 13
      }
    }, "Valider la r\xE9ception")))));
  }
  window.MagBdcReceptionTab = MagBdcReceptionTab;
})();
