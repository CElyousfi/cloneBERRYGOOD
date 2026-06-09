/*
 * BugReportButton.jsx — bouton flottant + modal de signalement de bug in-app.
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.BugReportButton) afin d'éviter toute collision top-level avec app.jsx
 * (cf. crashes #75/#77).
 *
 * Props :
 *   - currentProfile : id/label du profil courant (string ou objet) — affiché en lecture seule
 *   - currentScreen  : id/label de l'onglet actif — affiché + envoyé au backend
 *
 * Envoi : POST /api/bug-reports?action=submit-bug. Le token Firebase est injecté
 * automatiquement par le wrapper window.fetch d'app.jsx pour toute URL /api/.
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useRef = React.useRef;

  // dataURL -> base64 pur (sans le préfixe "data:image/...;base64,").
  // On envoie le base64 pur ; le backend gère aussi le préfixe par sécurité.
  function stripDataUrlPrefix(dataUrl) {
    if (!dataUrl) return '';
    var idx = dataUrl.indexOf('base64,');
    return idx >= 0 ? dataUrl.slice(idx + 'base64,'.length) : dataUrl;
  }
  function profileToText(p) {
    if (!p) return 'Inconnu';
    if (typeof p === 'string') return p;
    return p.label || p.name || p.id || 'Inconnu';
  }
  function BugReportButtonComponent(props) {
    var currentProfile = props.currentProfile;
    var currentScreen = props.currentScreen;
    var openState = useState(false);
    var open = openState[0];
    var setOpen = openState[1];
    var descState = useState('');
    var description = descState[0];
    var setDescription = descState[1];
    var photoState = useState(null); // { dataUrl, name }
    var photo = photoState[0];
    var setPhoto = photoState[1];
    var sendingState = useState(false);
    var sending = sendingState[0];
    var setSending = sendingState[1];
    var toastState = useState(null); // { type: 'success'|'error', msg }
    var toast = toastState[0];
    var setToast = toastState[1];
    var fileInputRef = useRef(null);
    var screenText = currentScreen && (currentScreen.label || currentScreen.id || currentScreen) || 'Inconnu';
    var profileText = profileToText(currentProfile);
    var nowText = new Date().toLocaleString('fr-FR');
    var viewport = window.innerWidth + '×' + window.innerHeight;
    var userAgent = window.navigator && window.navigator.userAgent || '';
    var profileId = currentProfile && (currentProfile.id || currentProfile) || null;
    function resetForm() {
      setDescription('');
      setPhoto(null);
      setToast(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    function closeModal() {
      if (sending) return;
      setOpen(false);
    }
    function onPickPhoto(e) {
      var file = e.target.files && e.target.files[0];
      if (!file) {
        setPhoto(null);
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        setPhoto({
          dataUrl: reader.result,
          name: file.name
        });
      };
      reader.readAsDataURL(file);
    }
    function showToast(type, msg) {
      setToast({
        type: type,
        msg: msg
      });
      if (type === 'success') {
        setTimeout(function () {
          setToast(null);
        }, 3500);
      }
    }
    function submit() {
      var trimmed = (description || '').trim();
      if (!trimmed || sending) return;
      setSending(true);
      setToast(null);
      var body = {
        description: trimmed,
        screen: screenText,
        device: {
          userAgent: userAgent,
          viewport: viewport
        },
        profileId: profileId
      };
      if (photo && photo.dataUrl) {
        body.photoBase64 = stripDataUrlPrefix(photo.dataUrl);
      }
      window.fetch('/api/bug-reports?action=submit-bug', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }).then(function (r) {
        return r.json();
      }).then(function (json) {
        if (json && json.success) {
          showToast('success', 'Merci ! Votre signalement a été envoyé.');
          resetForm();
          setTimeout(function () {
            setOpen(false);
          }, 1200);
        } else {
          showToast('error', json && json.error || 'Échec de l\'envoi. Réessayez.');
        }
      }).catch(function () {
        showToast('error', 'Erreur réseau. Réessayez.');
      }).then(function () {
        setSending(false);
      });
    }
    var floatBtn = React.createElement('button', {
      type: 'button',
      onClick: function () {
        setOpen(true);
      },
      title: 'Signaler un bug',
      'aria-label': 'Signaler un bug',
      style: {
        position: 'fixed',
        right: '16px',
        bottom: '76px',
        zIndex: 9000,
        background: '#fff',
        color: '#b3261e',
        border: '1px solid rgba(179,38,30,0.35)',
        borderRadius: '999px',
        padding: '8px 14px',
        fontSize: '13px',
        fontWeight: 600,
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        cursor: 'pointer',
        opacity: 0.92
      }
    }, '🐛 Signaler un bug');
    if (!open) return floatBtn;
    var contextRows = [['Profil', profileText], ['Écran', screenText], ['Date / heure', nowText], ['Navigateur', userAgent], ['Écran (px)', viewport]].map(function (row) {
      return React.createElement('div', {
        key: row[0],
        style: {
          display: 'flex',
          gap: '8px',
          fontSize: '12px',
          lineHeight: 1.4
        }
      }, React.createElement('span', {
        style: {
          color: '#666',
          minWidth: '92px',
          flexShrink: 0
        }
      }, row[0]), React.createElement('span', {
        style: {
          color: '#222',
          wordBreak: 'break-word'
        }
      }, row[1]));
    });
    var modal = React.createElement('div', {
      onClick: closeModal,
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 9001,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center'
      }
    }, React.createElement('div', {
      onClick: function (e) {
        e.stopPropagation();
      },
      style: {
        background: '#fff',
        width: '100%',
        maxWidth: '480px',
        maxHeight: '90vh',
        overflowY: 'auto',
        borderRadius: '16px 16px 0 0',
        padding: '18px 18px 24px'
      }
    }, React.createElement('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px'
      }
    }, React.createElement('div', {
      style: {
        fontWeight: 700,
        fontSize: '16px'
      }
    }, '🐛 Signaler un bug'), React.createElement('button', {
      type: 'button',
      onClick: closeModal,
      'aria-label': 'Fermer',
      style: {
        border: 'none',
        background: 'transparent',
        fontSize: '22px',
        cursor: 'pointer',
        color: '#888'
      }
    }, '×')), React.createElement('label', {
      style: {
        display: 'block',
        fontSize: '13px',
        fontWeight: 600,
        marginBottom: '6px'
      }
    }, 'Description ', React.createElement('span', {
      style: {
        color: '#b3261e'
      }
    }, '*')), React.createElement('textarea', {
      value: description,
      onChange: function (e) {
        setDescription(e.target.value);
      },
      placeholder: 'Décrivez le problème : ce que vous faisiez, ce qui s\'est passé…',
      rows: 4,
      style: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '10px',
        border: '1px solid #ccc',
        borderRadius: '8px',
        fontSize: '14px',
        fontFamily: 'inherit',
        resize: 'vertical',
        marginBottom: '14px'
      }
    }), React.createElement('label', {
      style: {
        display: 'block',
        fontSize: '13px',
        fontWeight: 600,
        marginBottom: '6px'
      }
    }, 'Photo / capture (optionnel)'), React.createElement('input', {
      ref: fileInputRef,
      type: 'file',
      accept: 'image/*',
      capture: 'environment',
      onChange: onPickPhoto,
      style: {
        fontSize: '13px',
        marginBottom: '8px'
      }
    }), photo && photo.dataUrl ? React.createElement('div', {
      style: {
        marginBottom: '14px'
      }
    }, React.createElement('img', {
      src: photo.dataUrl,
      alt: 'Aperçu',
      style: {
        maxWidth: '100%',
        maxHeight: '180px',
        borderRadius: '8px',
        border: '1px solid #eee'
      }
    }), React.createElement('button', {
      type: 'button',
      onClick: function () {
        setPhoto(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      },
      style: {
        display: 'block',
        marginTop: '6px',
        border: 'none',
        background: 'transparent',
        color: '#b3261e',
        fontSize: '12px',
        cursor: 'pointer',
        padding: 0
      }
    }, 'Retirer la photo')) : null, React.createElement('div', {
      style: {
        background: '#f6f6f6',
        borderRadius: '8px',
        padding: '10px',
        marginBottom: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      }
    }, React.createElement('div', {
      style: {
        fontSize: '11px',
        fontWeight: 700,
        color: '#888',
        textTransform: 'uppercase',
        marginBottom: '2px'
      }
    }, 'Contexte (auto)'), contextRows), toast ? React.createElement('div', {
      style: {
        marginBottom: '12px',
        padding: '8px 10px',
        borderRadius: '8px',
        fontSize: '13px',
        background: toast.type === 'success' ? '#e6f4ea' : '#fce8e6',
        color: toast.type === 'success' ? '#137333' : '#b3261e'
      }
    }, toast.msg) : null, React.createElement('button', {
      type: 'button',
      onClick: submit,
      disabled: !description.trim() || sending,
      style: {
        width: '100%',
        padding: '12px',
        borderRadius: '10px',
        border: 'none',
        fontSize: '15px',
        fontWeight: 700,
        color: '#fff',
        cursor: !description.trim() || sending ? 'not-allowed' : 'pointer',
        background: !description.trim() || sending ? '#bbb' : '#b3261e'
      }
    }, sending ? 'Envoi…' : 'Envoyer')));
    return React.createElement(React.Fragment, null, floatBtn, modal);
  }
  window.BugReportButton = BugReportButtonComponent;
})();
