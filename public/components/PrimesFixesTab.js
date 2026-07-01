/*
 * PrimesFixesTab.jsx — Onglet « Primes Fixes » (RH / DG).
 *
 * Gestion de la PRIME DE FONCTION journalière (DH/jour travaillé) par ouvrier,
 * stockée dans ouvriers_registry/{matricule}.primeFonctionJournaliere.
 *
 * SÉCURITÉ PAIE : aucune écriture Firestore directe. Toute modification passe
 * par la Cloud Function gated POST /api/primes (rôle RH/DG vérifié SERVEUR).
 * La LECTURE de ouvriers_registry reste autorisée (read: if auth != null).
 * Le masquage de l'onglet côté nav (rhOnly) est un simple confort : la vraie
 * barrière est la CF (403 pour caporal/chef/magasinier).
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE
 * GLOBAL : tout est wrappé dans une IIFE et n'expose QU'UN seul global
 * (window.PrimesFixesTab) pour éviter toute collision top-level (mémoire
 * projet : collisions top-level => crash boot React #200). Identifiants
 * internes préfixés PFT_.
 *
 * Fonctionnalités :
 *  - Tableau ligne par ouvrier (matricule, nom, poste, prime DH/jour éditable
 *    inline → save-prime via CF).
 *  - Import Excel avec PRÉVISUALISATION dry-run (toCreate/toUpdate/unmatched/
 *    collisions) AVANT « Appliquer » (apply).
 */
(function () {
  'use strict';

  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;

  // numKey : clé numérique canonique (idem app.jsx) — ouvriers_registry est
  // keyé NUMÉRIQUE alors que les matricules de pointage sont alpha-préfixés.
  function PFT_numKey(m) {
    return String(m == null ? '' : m).toUpperCase().replace(/[^0-9]/g, '');
  }

  // Appel de la Cloud Function gated. idToken Firebase en Bearer.
  function PFT_callCF(action, body) {
    var user = firebase.auth().currentUser;
    var tokenPromise = user ? user.getIdToken() : Promise.resolve(null);
    return tokenPromise.then(function (token) {
      return fetch('/api/primes?action=' + action, {
        method: 'POST',
        headers: Object.assign({
          'Content-Type': 'application/json'
        }, token ? {
          Authorization: 'Bearer ' + token
        } : {}),
        body: JSON.stringify(body || {})
      });
    }).then(function (resp) {
      return resp.json().catch(function () {
        return {};
      }).then(function (data) {
        if (!resp.ok || !data.success) {
          throw new Error(data.error || 'Erreur ' + resp.status);
        }
        return data;
      });
    });
  }
  function PFT_fmt(n) {
    return (Number(n) || 0).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // Parse une valeur saisie en gérant la virgule décimale (« 9,5 » → 9.5).
  function PFT_parse(raw) {
    return Number(String(raw == null ? '' : raw).replace(',', '.')) || 0;
  }

  // Recherche texte tolérante (matricule / nom). Réutilise FilterUtils si
  // présent, sinon helper inline équivalent (insensible à la casse, espaces).
  function PFT_matchesQuery(text, query) {
    if (window.FilterUtils && typeof window.FilterUtils.matchesTextQuery === 'function') {
      return window.FilterUtils.matchesTextQuery(text, query);
    }
    var q = String(query == null ? '' : query).trim().toLowerCase();
    if (!q) return true;
    return String(text == null ? '' : text).toLowerCase().indexOf(q) !== -1;
  }

  // Aujourd'hui au format YYYY-MM-DD (défaut effectiveFrom).
  function PFT_today() {
    return new Date().toISOString().slice(0, 10);
  }

  // Clé de groupe « À classer » pour les ouvriers sans fonction_id.
  var PFT_UNCLASSIFIED = '__unclassified__';
  function PrimesFixesTab() {
    var rowsState = useState([]);
    var rows = rowsState[0];
    var setRows = rowsState[1];
    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];
    var searchState = useState('');
    var search = searchState[0];
    var setSearch = searchState[1];

    // showZero : masque par défaut les primes à 0 ; toggle pour les afficher
    // (et les rendre éditables, pour initier une prime).
    var showZeroState = useState(false);
    var showZero = showZeroState[0];
    var setShowZero = showZeroState[1];
    var editState = useState({}); // { [docId]: stringValue }  prime éditée
    var edits = editState[0];
    var setEdits = editState[1];

    // focusedId : docId de l'input prime actuellement focusé. Le FOCUS seul ne
    // marque PAS la ligne comme éditée (pas de dirty/surlignage) : il sert juste
    // à afficher la valeur PRÉCISE (String(prime)) au lieu de la valeur formatée
    // 2 décimales, pour que l'utilisateur édite le vrai nombre sans perte.
    var focusedIdState = useState(null);
    var focusedId = focusedIdState[0];
    var setFocusedId = focusedIdState[1];
    var dateEditState = useState({}); // { [docId]: 'YYYY-MM-DD' } date d'effet éditée
    var dateEdits = dateEditState[0];
    var setDateEdits = dateEditState[1];
    var savingState = useState({}); // { [docId]: true }
    var saving = savingState[0];
    var setSaving = savingState[1];
    var savedOkState = useState({}); // { [docId]: true } confirmation ✓ transitoire
    var savedOk = savedOkState[0];
    var setSavedOk = savedOkState[1];
    var errorState = useState({}); // { [docId]: string } échec save (surlignage rouge)
    var saveErrors = errorState[0];
    var setSaveErrors = errorState[1];

    // Référentiel des fonctions : { [fonction_id]: {libelle, ordre} }.
    var fonctionsState = useState(null); // null = pas (encore) chargé
    var fonctions = fonctionsState[0];
    var setFonctions = fonctionsState[1];
    var fonctionsErrState = useState(false);
    var fonctionsErr = fonctionsErrState[0];
    var setFonctionsErr = fonctionsErrState[1];
    var previewState = useState(null); // dry-run result
    var preview = previewState[0];
    var setPreview = previewState[1];
    var importingState = useState(false);
    var importing = importingState[0];
    var setImporting = importingState[1];
    var fileRef = useRef(null);

    // Lecture du registre (autorisée en lecture pour tout user auth).
    function loadRegistry() {
      setLoading(true);
      firebase.firestore().collection('ouvriers_registry').get().then(function (snap) {
        var list = [];
        snap.forEach(function (doc) {
          var d = doc.data() || {};
          list.push({
            docId: doc.id,
            matricule: d.matricule || doc.id,
            nom: d.nom || '',
            poste: d.poste || '',
            prime: Number(d.primeFonctionJournaliere) || 0,
            fonction_id: d.fonction_id || '',
            effectiveFrom: d.prime_effectiveFrom || ''
          });
        });
        list.sort(function (a, b) {
          return b.prime - a.prime || a.docId.localeCompare(b.docId);
        });
        setRows(list);
        setLoading(false);
      }).catch(function (e) {
        console.error('PrimesFixesTab load:', e);
        setLoading(false);
      });
    }

    // Référentiel fonctions : libellés + ordre d'affichage. Lecture seule.
    // En cas d'erreur de lecture (règle absente, offline) → fallback groupement
    // par fonction_id brut, sans planter.
    function loadFonctions() {
      firebase.firestore().collection('fonctions').get().then(function (snap) {
        var map = {};
        snap.forEach(function (doc) {
          var d = doc.data() || {};
          var fid = d.fonction_id || doc.id;
          map[fid] = {
            libelle: d.libelle || fid,
            ordre: typeof d.ordre === 'number' ? d.ordre : 9998
          };
        });
        setFonctions(map);
        setFonctionsErr(false);
      }).catch(function (e) {
        console.error('PrimesFixesTab loadFonctions:', e);
        setFonctions({});
        setFonctionsErr(true);
      });
    }
    useEffect(function () {
      loadRegistry();
      loadFonctions();
    }, []);

    // Lignes visibles : masquage prime 0 (sauf toggle) + recherche.
    // Note : une ligne à 0 en cours d'édition (prime saisie) reste visible.
    var filteredRows = useMemo(function () {
      return rows.filter(function (r) {
        var editedVal = Object.prototype.hasOwnProperty.call(edits, r.docId) ? PFT_parse(edits[r.docId]) : r.prime;
        if (!showZero && !(editedVal > 0)) return false;
        if (!PFT_matchesQuery(r.matricule, search) && !PFT_matchesQuery(r.nom, search)) return false;
        return true;
      });
    }, [rows, search, showZero, edits]);

    // Compteur + total des lignes visibles.
    var summary = useMemo(function () {
      var total = 0;
      filteredRows.forEach(function (r) {
        var editedVal = Object.prototype.hasOwnProperty.call(edits, r.docId) ? PFT_parse(edits[r.docId]) : r.prime;
        total += editedVal;
      });
      return {
        count: filteredRows.length,
        total: total
      };
    }, [filteredRows, edits]);

    // Groupement par fonction_id, en-têtes triés par `ordre` du référentiel.
    // Les ouvriers sans fonction_id → groupe « À classer » en dernier.
    var groups = useMemo(function () {
      var byKey = {};
      filteredRows.forEach(function (r) {
        var key = r.fonction_id || PFT_UNCLASSIFIED;
        if (!byKey[key]) byKey[key] = [];
        byKey[key].push(r);
      });
      var fmap = fonctions || {};
      var result = Object.keys(byKey).map(function (key) {
        var meta = fmap[key];
        var libelle;
        var ordre;
        if (key === PFT_UNCLASSIFIED) {
          libelle = 'À classer';
          ordre = 9999;
        } else if (meta) {
          libelle = meta.libelle;
          ordre = meta.ordre;
        } else {
          // Fallback : référentiel non chargé ou fonction_id inconnu → slug brut.
          libelle = key;
          ordre = 9998;
        }
        var list = byKey[key];
        var subtotal = 0;
        list.forEach(function (r) {
          var editedVal = Object.prototype.hasOwnProperty.call(edits, r.docId) ? PFT_parse(edits[r.docId]) : r.prime;
          subtotal += editedVal;
        });
        return {
          key: key,
          libelle: libelle,
          ordre: ordre,
          rows: list,
          subtotal: subtotal
        };
      });
      result.sort(function (a, b) {
        return a.ordre - b.ordre || String(a.libelle).localeCompare(String(b.libelle));
      });
      return result;
    }, [filteredRows, fonctions, edits]);
    function savePrime(r) {
      var docId = r.docId;
      // Valeur précise renvoyée à la CF :
      //  - ligne ÉDITÉE → saisie utilisateur, virgule décimale gérée
      //    (Number(String(raw).replace(',','.'))), précision pleine de la saisie ;
      //  - ligne NON éditée → valeur stockée d'origine intacte (String(r.prime)),
      //    AUCUNE troncature ni reformatage.
      var editedHere = Object.prototype.hasOwnProperty.call(edits, docId);
      var raw = editedHere ? edits[docId] : String(r.prime);
      var num = editedHere ? Number(String(raw).replace(',', '.')) || 0 : Number(raw) || 0;
      var effFrom = Object.prototype.hasOwnProperty.call(dateEdits, docId) ? dateEdits[docId] : r.effectiveFrom || PFT_today();
      setSaving(function (s) {
        var n = Object.assign({}, s);
        n[docId] = true;
        return n;
      });
      setSaveErrors(function (e) {
        var n = Object.assign({}, e);
        delete n[docId];
        return n;
      });
      PFT_callCF('save-prime', {
        matricule: docId,
        montant: num,
        effectiveFrom: effFrom,
        nom: r.nom
      }).then(function () {
        setRows(function (prev) {
          return prev.map(function (x) {
            return x.docId === docId ? Object.assign({}, x, {
              prime: num,
              effectiveFrom: effFrom
            }) : x;
          });
        });
        setEdits(function (e) {
          var n = Object.assign({}, e);
          delete n[docId];
          return n;
        });
        setDateEdits(function (e) {
          var n = Object.assign({}, e);
          delete n[docId];
          return n;
        });
        // Confirmation visuelle ✓ vert transitoire.
        setSavedOk(function (s) {
          var n = Object.assign({}, s);
          n[docId] = true;
          return n;
        });
        setTimeout(function () {
          setSavedOk(function (s) {
            var n = Object.assign({}, s);
            delete n[docId];
            return n;
          });
        }, 2500);
      }).catch(function (err) {
        // Échec CF : surlignage rouge + message. AUCUNE écriture directe.
        setSaveErrors(function (e) {
          var n = Object.assign({}, e);
          n[docId] = err.message || 'Erreur';
          return n;
        });
      }).then(function () {
        setSaving(function (s) {
          var n = Object.assign({}, s);
          delete n[docId];
          return n;
        });
      });
    }

    // Import Excel : parse local → dry-run (preview) via CF.
    function handleFile(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var wb = XLSX.read(ev.target.result, {
            type: 'binary'
          });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var importRows = [];
          if (window.PrimesImportParse) {
            // Parse robuste : feuille 2D, saute les lignes de titre/vides au-dessus
            // des vraies en-têtes, accepte les alias (MTR, Prime dh Brut, …).
            var aoa = XLSX.utils.sheet_to_json(ws, {
              header: 1,
              defval: ''
            });
            var res = window.PrimesImportParse.extractPrimesRows(aoa);
            if (res.error) {
              alert('Erreur import : ' + res.error);
              return;
            }
            importRows = res.rows;
          } else {
            // Fallback (lib absente) : ancien comportement header-auto.
            var xlsxRows = XLSX.utils.sheet_to_json(ws, {
              defval: ''
            });
            xlsxRows.forEach(function (row) {
              var mat = String(row['Matricule'] || row['matricule'] || row['MATRICULE'] || '').trim();
              if (!mat) {
                importRows.push({
                  matricule: '',
                  montant: 0
                });
                return;
              }
              var montant = Number(row['Prime'] || row['prime'] || row['Montant'] || row['montant'] || row['PrimeFonction'] || 0) || 0;
              importRows.push({
                matricule: mat,
                montant: montant
              });
            });
          }
          setImporting(true);
          PFT_callCF('import-primes', {
            mode: 'dry-run',
            rows: importRows
          }).then(function (res) {
            setPreview({
              rows: importRows,
              result: res,
              fileName: file.name
            });
          }).catch(function (err) {
            alert('Erreur prévisualisation : ' + err.message);
          }).then(function () {
            setImporting(false);
          });
        } catch (e) {
          console.error('Import primes:', e);
          alert('Erreur import : ' + e.message);
        }
      };
      reader.readAsBinaryString(file);
    }
    function applyImport() {
      if (!preview) return;
      setImporting(true);
      PFT_callCF('import-primes', {
        mode: 'apply',
        rows: preview.rows,
        effectiveFrom: new Date().toISOString().slice(0, 10)
      }).then(function (res) {
        alert('Import appliqué : ' + (res.applied || 0) + ' prime(s) mise(s) à jour.');
        setPreview(null);
        loadRegistry();
      }).catch(function (err) {
        alert('Erreur application : ' + err.message);
      }).then(function () {
        setImporting(false);
      });
    }
    var c = React.createElement;
    var counts = preview && preview.result && preview.result.counts ? preview.result.counts : null;
    return c('div', {
      className: 'fade-in'
    }, c('div', {
      style: {
        background: '#fff',
        borderRadius: 12,
        padding: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)'
      }
    }, c('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 12
      }
    }, c('div', null, c('h2', {
      style: {
        fontSize: 16,
        fontWeight: 800,
        color: 'var(--berry)',
        margin: 0
      }
    }, c('i', {
      className: 'fa-solid fa-award',
      style: {
        marginRight: 8
      }
    }), 'Primes Fixes — prime de fonction (DH/jour)'), c('div', {
      style: {
        fontSize: 12,
        color: '#666',
        marginTop: 4
      }
    }, c('strong', null, summary.count), ' ouvrier', summary.count > 1 ? 's' : '', ' primé', summary.count > 1 ? 's' : '', ' · Σ prime/jour = ', c('strong', {
      style: {
        color: 'var(--berry)'
      }
    }, PFT_fmt(summary.total)), ' DH')), c('div', {
      style: {
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap'
      }
    }, c('input', {
      type: 'file',
      accept: '.xlsx,.xls,.csv',
      ref: fileRef,
      style: {
        display: 'none'
      },
      onChange: function (e) {
        handleFile(e.target.files && e.target.files[0]);
        if (e.target) e.target.value = '';
      }
    }), c('button', {
      onClick: function () {
        if (fileRef.current) fileRef.current.click();
      },
      style: {
        padding: '6px 12px',
        background: 'var(--orange)',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        cursor: 'pointer'
      }
    }, c('i', {
      className: 'fa-solid fa-file-import',
      style: {
        marginRight: 4
      }
    }), 'Importer primes (Excel)'))),
    // Bandeau prévisualisation dry-run
    preview ? c('div', {
      style: {
        border: '2px solid var(--orange)',
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
        background: '#fff8f0'
      }
    }, c('div', {
      style: {
        fontWeight: 700,
        marginBottom: 8
      }
    }, c('i', {
      className: 'fa-solid fa-magnifying-glass',
      style: {
        marginRight: 6
      }
    }), 'Prévisualisation — ', preview.fileName), counts ? c('div', {
      style: {
        display: 'flex',
        gap: 16,
        flexWrap: 'wrap',
        fontSize: 13,
        marginBottom: 8
      }
    }, c('span', null, c('strong', {
      style: {
        color: '#2e7d32'
      }
    }, counts.toCreate), ' à créer'), c('span', null, c('strong', {
      style: {
        color: '#1565c0'
      }
    }, counts.toUpdate), ' à mettre à jour'), c('span', null, c('strong', {
      style: {
        color: '#ef6c00'
      }
    }, counts.unmatched), ' non reconnus'), c('span', null, c('strong', {
      style: {
        color: '#c62828'
      }
    }, counts.collisions), ' collisions (exclues)')) : null, preview.result && preview.result.collisions && preview.result.collisions.length ? c('div', {
      style: {
        fontSize: 12,
        color: '#c62828',
        marginBottom: 8
      }
    }, c('strong', null, 'Collisions (matricule numérique ambigu, exclues de l\'import) : '), preview.result.collisions.map(function (col, i) {
      return c('span', {
        key: i,
        style: {
          marginRight: 8
        }
      }, col.matricule + ' ← [' + col.raws.join(', ') + ']');
    })) : null, preview.result && preview.result.unmatched && preview.result.unmatched.length ? c('div', {
      style: {
        fontSize: 12,
        color: '#ef6c00',
        marginBottom: 8
      }
    }, c('strong', null, 'Non reconnus : '), preview.result.unmatched.slice(0, 20).map(function (u, i) {
      return c('span', {
        key: i,
        style: {
          marginRight: 6
        }
      }, '"' + u.raw + '"');
    }), preview.result.unmatched.length > 20 ? c('span', null, ' …') : null) : null, c('div', {
      style: {
        display: 'flex',
        gap: 8
      }
    }, c('button', {
      onClick: applyImport,
      disabled: importing || !counts || counts.toCreate + counts.toUpdate === 0,
      style: {
        padding: '6px 14px',
        background: 'var(--berry)',
        color: '#fff',
        border: 'none',
        borderRadius: 8,
        fontWeight: 700,
        cursor: 'pointer',
        opacity: importing || !counts || counts.toCreate + counts.toUpdate === 0 ? 0.5 : 1
      }
    }, importing ? 'Application…' : 'Appliquer'), c('button', {
      onClick: function () {
        setPreview(null);
      },
      disabled: importing,
      style: {
        padding: '6px 14px',
        background: '#eee',
        color: '#333',
        border: 'none',
        borderRadius: 8,
        fontWeight: 600,
        cursor: 'pointer'
      }
    }, 'Annuler'))) : null,
    // Avertissement référentiel fonctions indisponible (fallback slug brut)
    fonctionsErr ? c('div', {
      style: {
        fontSize: 12,
        color: '#ef6c00',
        background: '#fff8f0',
        border: '1px solid #ffe0b2',
        borderRadius: 8,
        padding: '6px 10px',
        marginBottom: 12
      }
    }, c('i', {
      className: 'fa-solid fa-triangle-exclamation',
      style: {
        marginRight: 6
      }
    }), 'Référentiel des fonctions indisponible — regroupement par code brut.') : null,
    // Filtres
    c('div', {
      style: {
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        alignItems: 'center',
        marginBottom: 12
      }
    }, c('input', {
      type: 'text',
      value: search,
      placeholder: 'Rechercher matricule / nom…',
      onChange: function (e) {
        setSearch(e.target.value);
      },
      style: {
        flex: 1,
        minWidth: 180,
        padding: '6px 10px',
        border: '1px solid #ddd',
        borderRadius: 8,
        fontSize: 13
      }
    }), c('label', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        color: '#444',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }
    }, c('input', {
      type: 'checkbox',
      checked: showZero,
      onChange: function (e) {
        setShowZero(e.target.checked);
      }
    }), 'Afficher tous (incl. primes à 0)')), loading ? c('div', {
      style: {
        textAlign: 'center',
        padding: 30,
        color: '#888'
      }
    }, 'Chargement…') : c('div', {
      style: {
        overflowX: 'auto'
      }
    }, c('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13
      }
    }, c('thead', null, c('tr', {
      style: {
        borderBottom: '2px solid #eee',
        textAlign: 'left'
      }
    }, c('th', {
      style: {
        padding: '8px 6px'
      }
    }, 'Matricule'), c('th', {
      style: {
        padding: '8px 6px'
      }
    }, 'Nom'), c('th', {
      style: {
        padding: '8px 6px'
      }
    }, 'Poste'), c('th', {
      style: {
        padding: '8px 6px',
        textAlign: 'right'
      }
    }, 'Prime (DH/jour)'), c('th', {
      style: {
        padding: '8px 6px'
      }
    }, 'Date d\'effet'), c('th', {
      style: {
        padding: '8px 6px'
      }
    }, ''))), c('tbody', null, groups.map(function (g) {
      var headerCells = [c('tr', {
        key: 'h_' + g.key,
        style: {
          background: '#f4f0f7'
        }
      }, c('td', {
        colSpan: 3,
        style: {
          padding: '8px 6px',
          fontWeight: 800,
          color: 'var(--berry)'
        }
      }, g.libelle, g.key === PFT_UNCLASSIFIED ? c('span', {
        style: {
          marginLeft: 6,
          fontSize: 11,
          fontWeight: 600,
          color: '#ef6c00'
        }
      }, '(' + g.rows.length + ')') : null), c('td', {
        style: {
          padding: '8px 6px',
          textAlign: 'right',
          fontWeight: 800,
          color: 'var(--berry)'
        }
      }, PFT_fmt(g.subtotal)), c('td', {
        colSpan: 2,
        style: {
          padding: '8px 6px',
          fontSize: 11,
          color: '#888'
        }
      }, 'sous-total / jour'))];
      var bodyRows = g.rows.map(function (r) {
        var docId = r.docId;
        var editingPrime = Object.prototype.hasOwnProperty.call(edits, docId);
        var editingDate = Object.prototype.hasOwnProperty.call(dateEdits, docId);
        var dirty = editingPrime || editingDate;
        // Valeur de l'input prime :
        //  - dirty (édité) → chaîne saisie telle quelle ;
        //  - focusé (non édité) → valeur PRÉCISE String(r.prime) pour
        //    éditer le vrai nombre (pas la valeur tronquée) ;
        //  - au repos → valeur FORMATÉE 2 décimales virgule (PFT_fmt).
        var isFocused = focusedId === docId;
        var val = editingPrime ? edits[docId] : isFocused ? String(r.prime) : PFT_fmt(r.prime);
        var dateVal = editingDate ? dateEdits[docId] : r.effectiveFrom || PFT_today();
        var isSaving = !!saving[docId];
        var ok = !!savedOk[docId];
        var errMsg = saveErrors[docId];
        var rowBg = errMsg ? '#fdecea' : dirty ? '#fffbe6' : ok ? '#e8f5e9' : 'transparent';
        return c('tr', {
          key: docId,
          style: {
            borderBottom: '1px solid #f2f2f2',
            background: rowBg,
            transition: 'background 0.3s'
          }
        }, c('td', {
          style: {
            padding: '6px'
          }
        }, r.matricule), c('td', {
          style: {
            padding: '6px'
          }
        }, r.nom || c('span', {
          style: {
            color: '#bbb'
          }
        }, '—')), c('td', {
          style: {
            padding: '6px'
          }
        }, r.poste || c('span', {
          style: {
            color: '#bbb'
          }
        }, '—')), c('td', {
          style: {
            padding: '6px',
            textAlign: 'right'
          }
        }, c('input', {
          type: 'text',
          inputMode: 'decimal',
          value: val,
          disabled: isSaving,
          onFocus: function () {
            setFocusedId(docId);
          },
          onBlur: function () {
            setFocusedId(function (f) {
              return f === docId ? null : f;
            });
          },
          onChange: function (e) {
            var v = e.target.value;
            setEdits(function (ed) {
              var n = Object.assign({}, ed);
              n[docId] = v;
              return n;
            });
          },
          style: {
            width: 90,
            padding: '4px 6px',
            textAlign: 'right',
            border: '1px solid #ddd',
            borderRadius: 6,
            fontSize: 13
          }
        }), c('div', {
          style: {
            fontSize: 10,
            color: '#aaa',
            marginTop: 2
          }
        }, PFT_fmt(Number(String(val).replace(',', '.')) || 0))), c('td', {
          style: {
            padding: '6px'
          }
        }, c('input', {
          type: 'date',
          value: dateVal,
          disabled: isSaving,
          onChange: function (e) {
            var v = e.target.value;
            setDateEdits(function (ed) {
              var n = Object.assign({}, ed);
              n[docId] = v;
              return n;
            });
          },
          style: {
            padding: '4px 6px',
            border: '1px solid #ddd',
            borderRadius: 6,
            fontSize: 12
          }
        })), c('td', {
          style: {
            padding: '6px'
          }
        }, dirty ? c('button', {
          onClick: function () {
            savePrime(r);
          },
          disabled: isSaving,
          style: {
            padding: '4px 10px',
            background: 'var(--berry)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer'
          }
        }, isSaving ? '…' : 'Enregistrer') : ok ? c('span', {
          style: {
            color: '#2e7d32',
            fontSize: 12,
            fontWeight: 700
          }
        }, c('i', {
          className: 'fa-solid fa-check',
          style: {
            marginRight: 4
          }
        }), 'Enregistré') : errMsg ? c('span', {
          style: {
            color: '#c62828',
            fontSize: 11
          }
        }, errMsg) : c('span', {
          style: {
            color: '#bbb',
            fontSize: 12
          }
        }, PFT_fmt(r.prime))));
      });
      return c(React.Fragment, {
        key: 'g_' + g.key
      }, headerCells.concat(bodyRows));
    }))), filteredRows.length === 0 ? c('div', {
      style: {
        textAlign: 'center',
        padding: 20,
        color: '#999'
      }
    }, 'Aucun ouvrier.') : null)));
  }
  window.PrimesFixesTab = PrimesFixesTab;
})();
