/*
 * MagStockFilesTab.jsx — Onglet "Soumission Fichier Stock" (profil magasinier).
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.MagStockFilesTab) afin d'éviter toute collision top-level avec
 * app.jsx (cf. crashes #200 — mémoire umd-global-collision-smoke-load).
 * Aucune const/function top-level qui fuite — tous les identifiants internes
 * sont préfixés MSF_.
 *
 * docs/spec-collecte-stock-magasinier.md §5. Deux dropzones (Berry Good /
 * Bahia) — upload CLIENT-DIRECT vers Storage (stock_files/{date}/{farm}_{ts}.{ext})
 * puis POST /api/stock?action=stock-file-submit (écriture via Cloud Function
 * uniquement — jamais de write Firestore direct côté client). Tableau
 * historique 30 jours via GET /api/stock?action=stock-file-history&days=30.
 *
 * Pas de traitement du contenu des fichiers (parsing/import) dans ce spec —
 * uniquement dépôt + archivage + suivi (spec §1/§7).
 *
 * AJOUTÉ le 2026-08-05 (spec §4.1/§5.2) — cellule ✅ du tableau historique
 * cliquable : génère une URL signée à la demande via
 * GET /api/stock?action=stock-file-download-url puis window.open(). Aucun
 * pré-fetch au chargement du tableau.
 *
 * Props :
 *   - currentProfile : id du profil courant (string)
 *   - profileData    : objet profil (name, …)
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;

  // MISE À JOUR 2026-08-05 (confirmé Omar) : les fichiers stock réels sont
  // des classeurs Excel (.xlsx/.xls) ou CSV — priorité — PDF/image gardés en
  // secours (photo d'un relevé papier). Cf. docs/spec-collecte-stock-magasinier.md
  // §4.1/§5.2 et functions/lib/stockFiles/allowedMime.js (STOCK_FILE_ALLOWED_MIME).
  var MSF_ACCEPT = '.xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp,.heic';
  var MSF_FORMATS_LABEL = 'Excel (.xlsx/.xls), CSV, PDF ou image (JPG/PNG/WEBP/HEIC)';
  var MSF_C = {
    textPrimary: '#1c1c1a',
    textSecondary: '#5f5e5a',
    textTertiary: '#8a8985',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    border: 'rgba(0,0,0,0.12)',
    borderStrong: 'rgba(0,0,0,0.22)',
    green: '#1D9E75',
    red: '#E24B4A',
    amber: '#EF9F27'
  };
  var MSF_FARMS = [{
    key: 'berry_good',
    label: 'Berry Good'
  }, {
    key: 'bahia',
    label: 'Bahia'
  }];
  function msfExt(filename) {
    if (typeof filename !== 'string' || filename.indexOf('.') === -1) return 'bin';
    return filename.split('.').pop().toLowerCase().trim() || 'bin';
  }
  function msfMimeFromFile(file) {
    var ext = msfExt(file.name);
    // Le contentType navigateur pour .xlsx/.xls/.csv est peu fiable (souvent
    // vide ou générique selon l'OS) — l'extension prime pour ces formats afin
    // que le contentType envoyé au bucket corresponde bien à
    // STOCK_FILE_ALLOWED_MIME côté serveur.
    if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (ext === 'xls') return 'application/vnd.ms-excel';
    if (ext === 'csv') return 'text/csv';
    if (file.type && file.type !== '') return file.type;
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'heic') return 'image/heic';
    return 'application/octet-stream';
  }

  // Date locale Africa/Casablanca (YYYY-MM-DD) — usage COSMÉTIQUE côté client
  // uniquement (nom du fichier Storage, calcul "avant/après 18h" pour le
  // tableau). La date qui fait foi pour l'écriture Firestore est TOUJOURS
  // recalculée côté serveur (functions/lib/stockFiles/recordSubmission.js).
  function msfTodayCasablanca() {
    try {
      var fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Casablanca',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      return fmt.format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }
  function msfNowHourCasablanca() {
    try {
      var fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Casablanca',
        hour: '2-digit',
        hour12: false
      });
      return parseInt(fmt.format(new Date()), 10);
    } catch (e) {
      return new Date().getHours();
    }
  }
  function msfFmtTime(ms) {
    if (!ms) return '';
    try {
      return new Date(ms).toLocaleString('fr-FR', {
        timeZone: 'Africa/Casablanca',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return '';
    }
  }
  function msfFmtDate(dateStr) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    if (!m) return dateStr;
    return m[3] + '/' + m[2] + '/' + m[1];
  }
  function msfGetToken() {
    var user = window.firebaseAuth && window.firebaseAuth.currentUser;
    if (!user) return Promise.resolve(null);
    return user.getIdToken();
  }
  function msfApiGet(action, params) {
    return msfGetToken().then(function (token) {
      var headers = {};
      if (token) headers['Authorization'] = 'Bearer ' + token;
      var qs = Object.keys(params || {}).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      }).join('&');
      return fetch('/api/stock?action=' + encodeURIComponent(action) + (qs ? '&' + qs : ''), {
        headers: headers
      }).then(function (r) {
        return r.json().catch(function () {
          return {
            success: false,
            error: 'Réponse serveur invalide'
          };
        });
      });
    });
  }
  function msfApiPost(action, body) {
    return msfGetToken().then(function (token) {
      var headers = {
        'Content-Type': 'application/json'
      };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      return fetch('/api/stock?action=' + encodeURIComponent(action), {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body || {})
      }).then(function (r) {
        return r.json().catch(function () {
          return {
            success: false,
            error: 'Réponse serveur invalide'
          };
        });
      });
    });
  }
  function msfUploadDirect(file, farm, dateStr) {
    if (!window.firebase || typeof window.firebase.storage !== 'function') {
      return Promise.reject(new Error('SDK Firebase Storage non chargé — rechargez la page.'));
    }
    var ext = msfExt(file.name) !== 'bin' ? msfExt(file.name) : 'pdf';
    var path = 'stock_files/' + dateStr + '/' + farm + '_' + Date.now() + '.' + ext;
    var ref = window.firebase.storage().ref().child(path);
    var contentType = msfMimeFromFile(file);
    return ref.put(file, {
      contentType: contentType
    }).then(function () {
      return {
        storage_path: path,
        filename: file.name || 'stock_file.' + ext
      };
    });
  }

  // ── Dropzone ────────────────────────────────────────────────────────────

  function MSF_Dropzone(props) {
    var farm = props.farm; // { key, label }
    var status = props.status; // { submitted, submitted_at, submitted_by } | null
    var busy = props.busy;
    var error = props.error;
    var onFile = props.onFile;
    var dragState = useState(false);
    var dragOver = dragState[0];
    var setDragOver = dragState[1];
    function handleDrop(e) {
      e.preventDefault();
      setDragOver(false);
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) onFile(file);
    }
    function handleInput(e) {
      var file = e.target.files && e.target.files[0];
      if (e.target) e.target.value = '';
      if (file) onFile(file);
    }
    var submitted = !!(status && status.submitted);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        background: MSF_C.surface,
        border: '1px solid ' + MSF_C.border,
        borderRadius: 12,
        padding: 16,
        flex: '1 1 260px',
        minWidth: 240
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 15,
        fontWeight: 500,
        margin: '0 0 10px'
      }
    }, farm.label), submitted ? /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#E1F5EE',
        color: '#0F6E56',
        borderRadius: 8,
        padding: '10px 12px',
        fontSize: 13,
        marginBottom: 10
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: "fa-solid fa-circle-check",
      style: {
        marginRight: 6
      }
    }), "Envoy\xE9 ", status.submitted_at ? 'à ' + msfFmtTime(status.submitted_at) : '', status.submitted_by && status.submitted_by.name ? ' par ' + status.submitted_by.name : ''), /*#__PURE__*/React.createElement("label", {
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        color: MSF_C.textSecondary,
        cursor: busy ? 'wait' : 'pointer'
      },
      title: "Re-soumettre \xE9crase le fichier du jour"
    }, /*#__PURE__*/React.createElement("i", {
      className: busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-rotate'
    }), busy ? 'Envoi…' : 'Re-soumettre', /*#__PURE__*/React.createElement("input", {
      type: "file",
      accept: MSF_ACCEPT,
      onChange: handleInput,
      disabled: busy,
      style: {
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0
      }
    }))) : /*#__PURE__*/React.createElement("label", {
      onDragOver: function (e) {
        e.preventDefault();
        setDragOver(true);
      },
      onDragLeave: function () {
        setDragOver(false);
      },
      onDrop: handleDrop,
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 110,
        borderRadius: 10,
        cursor: busy ? 'wait' : 'pointer',
        border: '2px dashed ' + (dragOver ? MSF_C.green : MSF_C.borderStrong),
        background: dragOver ? '#E1F5EE' : MSF_C.surface2,
        color: MSF_C.textSecondary,
        textAlign: 'center',
        padding: 12
      }
    }, /*#__PURE__*/React.createElement("i", {
      className: busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-cloud-arrow-up',
      style: {
        fontSize: 22
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13
      }
    }, busy ? 'Envoi en cours…' : 'Glissez le fichier ici ou cliquez'), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: MSF_C.textTertiary
      }
    }, MSF_FORMATS_LABEL, ", 25 Mo max"), /*#__PURE__*/React.createElement("input", {
      type: "file",
      accept: MSF_ACCEPT,
      onChange: handleInput,
      disabled: busy,
      style: {
        position: 'absolute',
        width: 1,
        height: 1,
        opacity: 0
      }
    })), error ? /*#__PURE__*/React.createElement("p", {
      style: {
        color: MSF_C.red,
        fontSize: 12,
        margin: '8px 0 0'
      }
    }, error) : null);
  }

  // ── Main component ─────────────────────────────────────────────────────

  function MagStockFilesTab() {
    var historyState = useState([]);
    var history = historyState[0];
    var setHistory = historyState[1];
    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];
    var errState = useState(null);
    var err = errState[0];
    var setErr = errState[1];
    var busyState = useState({}); // { berry_good: bool, bahia: bool }
    var busy = busyState[0];
    var setBusy = busyState[1];
    var fieldErrState = useState({}); // { berry_good: msg, bahia: msg }
    var fieldErr = fieldErrState[0];
    var setFieldErr = fieldErrState[1];

    // AJOUTÉ le 2026-08-05 (spec §5.2) — état de chargement de l'URL signée
    // pour la cellule en cours de téléchargement. Clé = 'date|farm'. Aucune
    // pré-génération : uniquement à la demande, au clic.
    var downloadingState = useState(null);
    var downloadingKey = downloadingState[0];
    var setDownloadingKey = downloadingState[1];
    function loadHistory() {
      setLoading(true);
      return msfApiGet('stock-file-history', {
        days: 30
      }).then(function (res) {
        setLoading(false);
        if (res && res.success) {
          setHistory(res.days || []);
          setErr(null);
        } else {
          setErr(res && res.error || 'Chargement historique impossible');
        }
      }).catch(function (e) {
        setLoading(false);
        setErr(e && e.message || 'Erreur réseau');
      });
    }
    useEffect(function () {
      loadHistory();
    }, []);
    var today = msfTodayCasablanca();
    var todayRow = useMemo(function () {
      return history.find(function (h) {
        return h.date === today;
      }) || null;
    }, [history, today]);
    function handleFile(farm, file) {
      setFieldErr(function (prev) {
        var next = Object.assign({}, prev);
        delete next[farm];
        return next;
      });
      setBusy(function (prev) {
        return Object.assign({}, prev, {
          [farm]: true
        });
      });
      msfUploadDirect(file, farm, today).then(function (up) {
        return msfApiPost('stock-file-submit', {
          farm: farm,
          storage_path: up.storage_path,
          filename: up.filename
        });
      }).then(function (res) {
        setBusy(function (prev) {
          return Object.assign({}, prev, {
            [farm]: false
          });
        });
        if (res && res.success) {
          return loadHistory();
        }
        setFieldErr(function (prev) {
          return Object.assign({}, prev, {
            [farm]: res && res.error || 'Échec de la soumission — fichier non enregistré.'
          });
        });
      }).catch(function (e) {
        setBusy(function (prev) {
          return Object.assign({}, prev, {
            [farm]: false
          });
        });
        setFieldErr(function (prev) {
          return Object.assign({}, prev, {
            [farm]: e && e.message || 'Erreur réseau — fichier non enregistré.'
          });
        });
      });
    }
    var beforeDeadline = msfNowHourCasablanca() < 18;

    // AJOUTÉ le 2026-08-05 (spec §4.1/§5.2) — génère l'URL signée à la
    // demande et ouvre le fichier dans un nouvel onglet. Pas de pré-fetch :
    // appelé uniquement au clic sur une cellule soumise.
    function handleDownload(dateStr, farm) {
      var key = dateStr + '|' + farm;
      if (downloadingKey === key) return;
      setDownloadingKey(key);
      msfApiGet('stock-file-download-url', {
        date: dateStr,
        farm: farm
      }).then(function (res) {
        setDownloadingKey(function (cur) {
          return cur === key ? null : cur;
        });
        if (res && res.success && res.download_url) {
          window.open(res.download_url, '_blank');
        } else {
          setErr(res && res.error || 'Impossible de générer le lien de téléchargement.');
        }
      }).catch(function (e) {
        setDownloadingKey(function (cur) {
          return cur === key ? null : cur;
        });
        setErr(e && e.message || 'Erreur réseau lors du téléchargement.');
      });
    }
    function cellContent(dateStr, farmStatus, isToday, farm) {
      var submitted = !!(farmStatus && farmStatus.submitted);
      if (submitted) {
        var key = dateStr + '|' + farm;
        var isBusy = downloadingKey === key;
        return /*#__PURE__*/React.createElement("button", {
          type: "button",
          onClick: function () {
            handleDownload(dateStr, farm);
          },
          disabled: isBusy,
          title: (farmStatus.submitted_at ? msfFmtTime(farmStatus.submitted_at) + ' — ' : '') + 'Cliquez pour télécharger le fichier',
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            padding: 0,
            color: MSF_C.green,
            cursor: isBusy ? 'wait' : 'pointer',
            font: 'inherit'
          }
        }, /*#__PURE__*/React.createElement("i", {
          className: isBusy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-circle-check'
        }), /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-download",
          style: {
            fontSize: 11,
            color: MSF_C.textTertiary
          }
        }));
      }
      if (isToday && beforeDeadline) {
        return /*#__PURE__*/React.createElement("span", {
          style: {
            color: MSF_C.amber
          },
          title: "En attente (avant 18h)"
        }, /*#__PURE__*/React.createElement("i", {
          className: "fa-solid fa-hourglass-half"
        }), " en attente");
      }
      return /*#__PURE__*/React.createElement("span", {
        style: {
          color: MSF_C.red
        }
      }, /*#__PURE__*/React.createElement("i", {
        className: "fa-solid fa-circle-xmark"
      }));
    }
    return /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        color: MSF_C.textPrimary,
        maxWidth: 920,
        margin: '0 auto'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        marginBottom: 16
      }
    }, /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 19,
        fontWeight: 500,
        margin: 0
      }
    }, "Soumission Fichier Stock"), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 13,
        color: MSF_C.textSecondary,
        margin: '2px 0 0'
      }
    }, "D\xE9posez le fichier stock du jour pour chaque ferme \u2014 Berry Good et Bahia. Un rappel WhatsApp est envoy\xE9 \xE0 16h, 17h et 18h si un fichier manque.")), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 14,
        flexWrap: 'wrap',
        marginBottom: 24
      }
    }, MSF_FARMS.map(function (farm) {
      var status = todayRow ? todayRow[farm.key] : null;
      return /*#__PURE__*/React.createElement(MSF_Dropzone, {
        key: farm.key,
        farm: farm,
        status: status,
        busy: !!busy[farm.key],
        error: fieldErr[farm.key] || null,
        onFile: function (file) {
          handleFile(farm.key, file);
        }
      });
    })), /*#__PURE__*/React.createElement("p", {
      style: {
        fontSize: 15,
        fontWeight: 500,
        margin: '0 0 10px'
      }
    }, "Historique (30 derniers jours)"), err ? /*#__PURE__*/React.createElement("div", {
      style: {
        background: '#FCEBEB',
        color: '#A32D2D',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 13,
        marginBottom: 16
      }
    }, err) : null, loading ? /*#__PURE__*/React.createElement("div", {
      style: {
        background: MSF_C.surface2,
        borderRadius: 12,
        padding: '32px 24px',
        textAlign: 'center',
        color: MSF_C.textSecondary,
        fontSize: 14
      }
    }, "Chargement\u2026") : /*#__PURE__*/React.createElement("div", {
      style: {
        overflowX: 'auto'
      }
    }, /*#__PURE__*/React.createElement("table", {
      style: {
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: 13,
        minWidth: 420
      }
    }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", {
      style: {
        textAlign: 'left',
        color: MSF_C.textSecondary,
        borderBottom: '1px solid ' + MSF_C.borderStrong
      }
    }, /*#__PURE__*/React.createElement("th", {
      style: {
        padding: '8px 6px',
        fontWeight: 500
      }
    }, "Date"), /*#__PURE__*/React.createElement("th", {
      style: {
        padding: '8px 6px',
        fontWeight: 500
      }
    }, "Berry Good"), /*#__PURE__*/React.createElement("th", {
      style: {
        padding: '8px 6px',
        fontWeight: 500
      }
    }, "Bahia"))), /*#__PURE__*/React.createElement("tbody", null, history.map(function (row) {
      var isToday = row.date === today;
      return /*#__PURE__*/React.createElement("tr", {
        key: row.date,
        style: {
          borderBottom: '1px solid ' + MSF_C.border,
          background: isToday ? MSF_C.surface2 : 'transparent'
        }
      }, /*#__PURE__*/React.createElement("td", {
        style: {
          padding: '9px 6px'
        }
      }, msfFmtDate(row.date), isToday ? ' (aujourd\'hui)' : ''), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: '9px 6px'
        }
      }, cellContent(row.date, row.berry_good, isToday, 'berry_good')), /*#__PURE__*/React.createElement("td", {
        style: {
          padding: '9px 6px'
        }
      }, cellContent(row.date, row.bahia, isToday, 'bahia')));
    })))));
  }
  window.MagStockFilesTab = MagStockFilesTab;
})();
