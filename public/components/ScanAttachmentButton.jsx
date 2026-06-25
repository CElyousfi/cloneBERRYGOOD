/*
 * ScanAttachmentButton.jsx — Bouton unifié "Voir / Joindre le scan" pour les
 * LISTES factures, BL et BDC (cause D : le scan n'apparaissait que dans
 * l'historique → perçu comme "disparu").
 *
 * Chargé en <script> séparé (build Babel) AVANT app.js. PARTAGE LE SCOPE GLOBAL :
 * tout est wrappé dans une IIFE et n'expose QU'UN seul global au nom unique
 * (window.ScanAttachmentButton) — anti-collision UMD (cf. crashes #200). Tous
 * les identifiants internes sont préfixés SAB_.
 *
 * Modèle CLIENT-DIRECT : l'upload du fichier va DIRECTEMENT vers Firebase
 * Storage (via window.ScanClientUpload), puis l'action upload-attachment
 * enregistre les métadonnées + renvoie une signed URL V4. La lecture régénère
 * une signed URL fraîche (window.ScanClientUpload.getAttachmentUrl) pour éviter
 * toute URL publique/expirée (cause C).
 *
 * Props :
 *   - entityType (string)   invoices | delivery_notes | purchase_orders
 *   - entityId (string)     id du doc cible
 *   - scanUrl (string|null) signed URL déjà connue (sinon régénérée à la lecture)
 *   - scanPath (string|null) présence => un scan existe déjà
 *   - uploadedBy (object)   { name, profileId } pour la traçabilité
 *   - canUpload (bool)      autoriser le bouton d'upload (défaut true)
 *   - onUploaded (fn)       callback(result) après upload réussi (rafraîchir liste)
 *   - compact (bool)        rendu icône-only pour les cellules de tableau
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useRef = React.useRef;

  var SAB_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';

  function SAB_openUrl(url) {
    if (url) window.open(url, '_blank', 'noopener');
  }

  function ScanAttachmentButton(props) {
    var entityType = props.entityType;
    var entityId = props.entityId;
    var scanPath = props.scanPath;
    var canUpload = props.canUpload !== false;
    var compact = !!props.compact;

    var stateUrl = useState(props.scanUrl || null);
    var url = stateUrl[0]; var setUrl = stateUrl[1];
    var stateHasScan = useState(!!props.scanPath);
    var hasScan = stateHasScan[0]; var setHasScan = stateHasScan[1];
    var stateBusy = useState(false);
    var busy = stateBusy[0]; var setBusy = stateBusy[1];
    var fileRef = useRef(null);

    var SCU = window.ScanClientUpload;

    function handleView(e) {
      if (e) e.stopPropagation();
      if (url) { SAB_openUrl(url); return; }
      // régénère une signed URL fraîche
      if (!SCU) return;
      setBusy(true);
      SCU.getAttachmentUrl(entityType, entityId).then(function (u) {
        setBusy(false);
        if (u) { setUrl(u); SAB_openUrl(u); }
        else alert('Scan introuvable.');
      }).catch(function () { setBusy(false); alert('Erreur lors de la récupération du scan.'); });
    }

    function handlePick(e) {
      if (e) e.stopPropagation();
      if (fileRef.current) fileRef.current.click();
    }

    function handleFile(e) {
      var file = e.target.files && e.target.files[0];
      if (e.target) e.target.value = '';
      if (!file) return;
      if (!SCU) { alert('Module d\'upload indisponible.'); return; }
      if (!SCU.isStorageAvailable()) { alert('SDK Storage non chargé — rechargez la page.'); return; }
      setBusy(true);
      SCU.uploadAndRecord({
        file: file,
        entity_type: entityType,
        entity_id: entityId,
        uploaded_by: props.uploadedBy || {},
      }).then(function (res) {
        setBusy(false);
        if (res && res.success) {
          setHasScan(true);
          setUrl(res.scan_url || null);
          if (props.onUploaded) props.onUploaded(res);
        } else {
          alert('Erreur upload: ' + ((res && res.error) || 'Échec'));
        }
      }).catch(function (err) {
        setBusy(false);
        alert('Erreur upload: ' + (err && err.message ? err.message : 'réseau'));
      });
    }

    var btnBase = {
      background: 'none', border: 'none', cursor: busy ? 'wait' : 'pointer',
      fontSize: compact ? 13 : 12, padding: compact ? 0 : '4px 8px',
      display: 'inline-flex', alignItems: 'center', gap: 4,
    };

    var children = [];
    if (hasScan || scanPath) {
      children.push(React.createElement('button', {
        key: 'view', onClick: handleView, disabled: busy, title: 'Voir le scan',
        style: Object.assign({}, btnBase, { color: 'var(--blue, #1a73e8)' }),
      },
        React.createElement('i', { className: busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-file-lines' }),
        compact ? null : React.createElement('span', null, 'Voir le scan')
      ));
    } else if (canUpload) {
      children.push(React.createElement('button', {
        key: 'up', onClick: handlePick, disabled: busy, title: 'Joindre un scan',
        style: Object.assign({}, btnBase, { color: 'var(--gray-400, #888)' }),
      },
        React.createElement('i', { className: busy ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-paperclip' }),
        compact ? null : React.createElement('span', null, busy ? 'Envoi…' : 'Joindre')
      ));
    } else {
      children.push(React.createElement('span', { key: 'none', style: { color: 'var(--gray-400, #bbb)', fontSize: 12 } }, '—'));
    }

    if (canUpload) {
      children.push(React.createElement('input', {
        key: 'input', ref: fileRef, type: 'file', accept: SAB_ACCEPT,
        style: { display: 'none' }, onChange: handleFile,
      }));
    }

    return React.createElement('span', { style: { whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 6 } }, children);
  }

  window.ScanAttachmentButton = ScanAttachmentButton;
})();
