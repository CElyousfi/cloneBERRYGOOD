/*
 * HsEmargementFooter.jsx — Pied de la pop-up « Heures Supplémentaires » :
 * dépôt et suivi des ÉTATS D'ÉMARGEMENT SIGNÉS par les chefs de ferme, une
 * pièce jointe par ferme et par quinzaine.
 *
 * Le bouton « États d'émargement » GÉNÈRE déjà des PDF/XLSX à colonne signature
 * vide ; le chef signe sur papier et, jusqu'ici, rien ne revenait dans le
 * système. Ce bloc referme la boucle : la RH dépose le scan signé, et l'écran
 * dit quelle ferme a rendu son état et laquelle manque.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.HsEmargementFooter) — anti-collision UMD (cf. crashes React #200).
 * Tous les identifiants internes sont préfixés HSEF_.
 *
 * Modèle CLIENT-DIRECT (identique aux scans factures/BL/BDC et aux fichiers
 * stock) : le fichier part DIRECTEMENT vers Firebase Storage via
 * window.ScanClientUpload.uploadDirectToPath (timeout dur 90 s, contentType
 * explicite — le mobile renvoie souvent un type vide), puis l'action
 * `hs-emargement-submit` de /api/primes VALIDE (taille/MIME lus sur l'objet
 * réel) et ENREGISTRE le lien. Le fichier ne transite jamais par la Cloud
 * Function : la limite de payload de 10 Mo ne s'applique pas.
 *
 * Props :
 *   - periode (string)       quinzaine affichée
 *   - fermes (string[])      fermes de la quinzaine, dérivées des lignes de
 *                            pointage — JAMAIS une liste en dur
 *   - emargements (object)   map { FERME_KEY: { ferme, path, filename, … } }
 *                            telle que renvoyée par `heures-sup-montants`
 *   - onDepose (fn)          callback(fermeKey, entry) après dépôt réussi
 *   - disabled (bool)        neutralise le dépôt (enregistrement en cours)
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var HSEF_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.heic';

  /**
   * Clé de map Firestore d'une ferme. DOIT rester identique à
   * functions/lib/primes/emargementWrite.js#normalizeFermeKey : c'est elle qui
   * fait correspondre « Avocatier » affiché ici et « AVOCATIER » stocké là-bas.
   */
  function HSEF_fermeKey(ferme) {
    var raw = String(ferme == null ? '' : ferme).trim();
    if (!raw) return '';
    var noAccent = raw.normalize ? raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : raw;
    return noAccent.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /** Chemin Storage — miroir de emargementWrite.js#buildEmargementPath. */
  function HSEF_path(periode, ferme, filename, ts) {
    var U = window.ScanAttachmentUtils;
    var safe = U && U.sanitizeFilename ? U.sanitizeFilename(filename) : 'scan.pdf';
    // Les points consécutifs sont réduits à UN. `sanitizeFilename` les conserve
    // (le point est un caractère autorisé), or un nom comme « état signé..pdf »
    // produirait un chemin contenant '..' — que le serveur refuse comme une
    // traversée de chemin. Le fichier est déjà uploadé à ce moment-là : la RH
    // recevrait un « storage_path hors du namespace » indéchiffrable, et un
    // objet orphelin resterait dans le bucket.
    safe = safe.replace(/\.{2,}/g, '.');
    return 'rh_emargements/' + HSEF_fermeKey(periode) + '/' + HSEF_fermeKey(ferme) + '_' + ts + '_' + safe;
  }
  function HSEF_token() {
    var auth = window.firebaseAuth;
    return auth && auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null);
  }
  function HSEF_openUrl(url) {
    if (url) window.open(url, '_blank', 'noopener');
  }
  function HsEmargementFooter(props) {
    var periode = props.periode || '';
    var fermes = props.fermes || [];
    var emargements = props.emargements || {};
    var disabled = !!props.disabled;
    var stateBusy = useState('');
    var busy = stateBusy[0];
    var setBusy = stateBusy[1];
    var stateErr = useState(null);
    var erreur = stateErr[0];
    var setErreur = stateErr[1];
    function handleFile(ferme, ev) {
      var file = ev.target.files && ev.target.files[0];
      if (ev.target) ev.target.value = '';
      if (!file || !periode) return;
      var SCU = window.ScanClientUpload;
      if (!SCU || typeof SCU.uploadDirectToPath !== 'function') {
        setErreur({
          ferme: ferme,
          msg: 'Module d\'upload indisponible — rechargez la page.'
        });
        return;
      }
      if (!SCU.isStorageAvailable()) {
        setErreur({
          ferme: ferme,
          msg: 'SDK Storage non chargé — rechargez la page.'
        });
        return;
      }
      var key = HSEF_fermeKey(ferme);
      setErreur(null);
      setBusy(key);
      var chemin = HSEF_path(periode, ferme, file.name, Date.now());
      SCU.uploadDirectToPath(file, chemin).then(function (up) {
        return HSEF_token().then(function (tok) {
          var headers = {
            'Content-Type': 'application/json'
          };
          if (tok) headers['Authorization'] = 'Bearer ' + tok;
          return fetch('/api/primes?action=hs-emargement-submit', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              periode: periode,
              ferme: ferme,
              storage_path: up.storage_path,
              filename: up.filename
            })
          }).then(function (r) {
            return r.json().catch(function () {
              return {
                success: false,
                error: 'Réponse serveur invalide (HTTP ' + r.status + ').'
              };
            });
          });
        });
      }).then(function (res) {
        setBusy('');
        // Toute branche se termine par un état enregistré OU un message : le cas
        // « 0 erreur mais 0 fichier » ne doit jamais passer en silence.
        if (res && res.success) {
          if (props.onDepose) props.onDepose(res.ferme_key || key, res.emargement || null);
        } else {
          setErreur({
            ferme: ferme,
            msg: res && res.error || 'Échec inconnu — état NON enregistré.'
          });
        }
      }).catch(function (err) {
        setBusy('');
        setErreur({
          ferme: ferme,
          msg: err && err.message || 'Erreur réseau — état NON enregistré.'
        });
      });
    }
    function handleView(ferme) {
      var key = HSEF_fermeKey(ferme);
      setErreur(null);
      setBusy(key);
      HSEF_token().then(function (tok) {
        var headers = {};
        if (tok) headers['Authorization'] = 'Bearer ' + tok;
        return fetch('/api/primes?action=hs-emargement-url&periode=' + encodeURIComponent(periode) + '&ferme=' + encodeURIComponent(ferme), {
          headers: headers
        }).then(function (r) {
          return r.json().catch(function () {
            return null;
          });
        });
      }).then(function (d) {
        setBusy('');
        if (d && d.success && d.url) HSEF_openUrl(d.url);else setErreur({
          ferme: ferme,
          msg: d && d.error || 'État introuvable.'
        });
      }).catch(function () {
        setBusy('');
        setErreur({
          ferme: ferme,
          msg: 'Erreur réseau lors de l\'ouverture.'
        });
      });
    }
    var lignes = fermes.map(function (ferme) {
      var key = HSEF_fermeKey(ferme);
      var entry = emargements[key] || null;
      var depose = !!(entry && entry.path);
      var enCours = busy === key;
      var msg = erreur && erreur.ferme === ferme ? erreur.msg : null;
      return React.createElement('div', {
        key: key,
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          padding: '6px 0',
          borderBottom: '1px solid var(--gray-100)'
        }
      }, React.createElement('span', {
        style: {
          fontSize: 12,
          fontWeight: 600,
          minWidth: 90
        }
      }, ferme), React.createElement('span', {
        style: {
          fontSize: 11.5,
          color: depose ? '#0F6E56' : '#b26a00',
          fontWeight: 600
        }
      }, depose ? '✅ état signé déposé' : '⚠️ état signé manquant'), depose ? React.createElement('button', {
        onClick: function (e) {
          e.stopPropagation();
          if (!enCours) handleView(ferme);
        },
        disabled: enCours,
        style: {
          background: 'none',
          border: 'none',
          padding: 0,
          fontSize: 11.5,
          color: 'var(--blue, #1a73e8)',
          cursor: enCours ? 'wait' : 'pointer'
        }
      }, 'Voir') : null,
      // DÉPÔT — <label> qui CONTIENT l'input file, et input transparent
      // dimensionné à 100 % du label. Surtout PAS de `input.click()` en JS ni
      // de `display:none` : WebKit/Safari (iPhone) ferme alors le sélecteur
      // natif et le dépôt devient impossible (cf. ScanAttachmentButton.jsx).
      React.createElement('label', {
        title: depose ? 'Remplacer l\'état signé' : 'Déposer l\'état signé',
        'data-no-fullscreen': '',
        onClick: function (e) {
          e.stopPropagation();
        },
        style: {
          position: 'relative',
          overflow: 'hidden',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: 11.5,
          fontWeight: 600,
          padding: '3px 10px',
          borderRadius: 6,
          border: '1px solid #e67e22',
          color: '#e67e22',
          pointerEvents: enCours || disabled ? 'none' : 'auto',
          opacity: enCours || disabled ? 0.6 : 1,
          cursor: 'pointer'
        }
      }, React.createElement('i', {
        className: enCours ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-paperclip'
      }), React.createElement('span', null, enCours ? 'Envoi…' : depose ? 'Remplacer' : 'Déposer'), React.createElement('input', {
        key: 'file',
        type: 'file',
        accept: HSEF_ACCEPT,
        disabled: enCours || disabled,
        'data-no-fullscreen': '',
        onChange: function (e) {
          handleFile(ferme, e);
        },
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: 'pointer',
          fontSize: 0,
          border: 0,
          padding: 0,
          margin: 0
        }
      })), entry && entry.filename ? React.createElement('span', {
        style: {
          fontSize: 10.5,
          color: 'var(--gray-400)'
        }
      }, entry.filename) : null, msg ? React.createElement('span', {
        style: {
          fontSize: 11,
          color: 'var(--red, #c0392b)',
          flexBasis: '100%'
        }
      }, msg) : null);
    });
    return React.createElement('div', {
      style: {
        marginTop: 16,
        paddingTop: 12,
        borderTop: '1px solid var(--gray-200)'
      }
    }, React.createElement('div', {
      style: {
        fontSize: 12,
        fontWeight: 700,
        marginBottom: 6
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-file-signature',
      style: {
        marginRight: 6,
        color: '#e67e22'
      }
    }), 'États d\'émargement signés — ' + periode), fermes.length === 0 ? React.createElement('div', {
      style: {
        fontSize: 11.5,
        color: 'var(--gray-400)',
        fontStyle: 'italic'
      }
    }, 'Aucune ferme sur cette quinzaine.') : React.createElement('div', null, lignes), React.createElement('div', {
      style: {
        marginTop: 8,
        fontSize: 10.5,
        color: 'var(--gray-500)'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-info',
      style: {
        marginRight: 6
      }
    }), 'Une pièce par ferme : le scan de l\'état signé par le chef de ferme. PDF ou image, 25 Mo maximum.'));
  }
  window.HsEmargementFooter = HsEmargementFooter;
})();
