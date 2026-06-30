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
    var filterState = useState('all'); // all | withPrime
    var filter = filterState[0];
    var setFilter = filterState[1];
    var editState = useState({}); // { [docId]: stringValue }
    var edits = editState[0];
    var setEdits = editState[1];
    var savingState = useState({}); // { [docId]: true }
    var saving = savingState[0];
    var setSaving = savingState[1];
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
    useEffect(function () {
      loadRegistry();
    }, []);
    var filteredRows = useMemo(function () {
      var q = search.trim().toLowerCase();
      return rows.filter(function (r) {
        if (filter === 'withPrime' && !(r.prime > 0)) return false;
        if (q && !(String(r.nom).toLowerCase().indexOf(q) !== -1 || String(r.matricule).toLowerCase().indexOf(q) !== -1)) return false;
        return true;
      });
    }, [rows, search, filter]);
    function savePrime(r) {
      var docId = r.docId;
      var raw = Object.prototype.hasOwnProperty.call(edits, docId) ? edits[docId] : String(r.prime);
      var num = Number(raw) || 0;
      setSaving(function (s) {
        var n = Object.assign({}, s);
        n[docId] = true;
        return n;
      });
      PFT_callCF('save-prime', {
        matricule: docId,
        montant: num,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        nom: r.nom
      }).then(function () {
        setRows(function (prev) {
          return prev.map(function (x) {
            return x.docId === docId ? Object.assign({}, x, {
              prime: num
            }) : x;
          });
        });
        setEdits(function (e) {
          var n = Object.assign({}, e);
          delete n[docId];
          return n;
        });
      }).catch(function (err) {
        alert('Erreur enregistrement : ' + err.message);
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
    }, c('h2', {
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
    // Filtres
    c('div', {
      style: {
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
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
    }), c('select', {
      value: filter,
      onChange: function (e) {
        setFilter(e.target.value);
      },
      style: {
        padding: '6px 10px',
        border: '1px solid #ddd',
        borderRadius: 8,
        fontSize: 13
      }
    }, c('option', {
      value: 'all'
    }, 'Tous'), c('option', {
      value: 'withPrime'
    }, 'Avec prime > 0'))), loading ? c('div', {
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
    }, ''))), c('tbody', null, filteredRows.map(function (r) {
      var docId = r.docId;
      var editing = Object.prototype.hasOwnProperty.call(edits, docId);
      var val = editing ? edits[docId] : String(r.prime);
      var isSaving = !!saving[docId];
      return c('tr', {
        key: docId,
        style: {
          borderBottom: '1px solid #f2f2f2'
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
        type: 'number',
        min: 0,
        step: 'any',
        value: val,
        disabled: isSaving,
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
      })), c('td', {
        style: {
          padding: '6px'
        }
      }, editing ? c('button', {
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
      }, isSaving ? '…' : 'Enregistrer') : c('span', {
        style: {
          color: '#bbb',
          fontSize: 12
        }
      }, PFT_fmt(r.prime))));
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
