/*
 * BCDoublonDialog.jsx — Fenêtre « ce bon existe déjà », partagée par les DEUX
 * écrans qui créent un bon de consommation : la saisie manuelle (MagBCTab) et
 * le modal de scan IA (MagBCScanModal).
 *
 * ── POURQUOI ELLE EXISTE ──────────────────────────────────────────────────
 * `create-bc` refuse désormais un doublon avec un 409 (lib/stock/bcDoublons).
 * Sans cet écran, le magasinier ne verrait qu'un « Erreur: … » brut, sans
 * savoir QUEL bon fait obstacle ni comment passer outre : le blocage seul,
 * c'est la moitié qui gêne. Ici on affiche le NUMÉRO du bon existant, ce que
 * le serveur a reconnu, et une échappatoire explicite.
 *
 * ── LE FORÇAGE DOIT ÊTRE DÉLIBÉRÉ ─────────────────────────────────────────
 * « Annuler » est le bouton d'accent (celui vers lequel la main va, celui qui
 * reçoit l'autofocus) ; « Créer quand même ce bon » est volontairement
 * secondaire, en bordure orange, libellé en toutes lettres. On ne doit pas
 * pouvoir forcer par réflexe ni en tapant Entrée. Le forçage est tracé côté
 * serveur (`doublon_force`) : ce n'est pas un clic anodin.
 *
 * Identifiants internes préfixés BCD_.
 *
 * Composant PUREMENT présentationnel : il ne connaît ni fetch, ni payload. Le
 * drapeau `force_doublon` est envoyé par l'écran appelant, dans son propre
 * `onForce` — c'est là que ça se teste.
 *
 * Props :
 *   - doublon (object|null) { motif, bon_numero, bon_id, message } tel que
 *                           renvoyé par le 409 de create-bc. null => rien.
 *   - saving (bool)         création en cours (désactive les deux boutons)
 *   - onCancel (fn)         abandon (obligatoire)
 *   - onForce (fn)          création forcée — DOIT envoyer force_doublon
 */


/** Motif serveur du doublon CERTAIN (même fichier de scan réutilisé). */
var BCD_MOTIF_SCAN = 'scan_identique';

/**
 * Explication en clair du motif renvoyé par le serveur. Le message serveur
 * nomme déjà le bon ; celui-ci dit ce que la machine a reconnu, pour que le
 * magasinier sache QUOI vérifier avant de forcer.
 */
function BCD_explication(motif) {
  if (motif === BCD_MOTIF_SCAN) {
    return 'La même photo de bon a déjà été enregistrée. C\'est presque toujours une double soumission du même scan.';
  }
  return 'Un bon existant a déjà les mêmes articles, les mêmes quantités, les mêmes parcelles, la même ferme et la même date.';
}

function BCDoublonDialog(props) {
  var doublon = props.doublon;
  if (!doublon) return null;
  var saving = !!props.saving;
  var numero = doublon.bon_numero || '';
  var certain = doublon.motif === BCD_MOTIF_SCAN;

  return React.createElement(
    'div', { className: 'modal-overlay', style: { zIndex: 10003 } },
    React.createElement(
      'div', { className: 'modal-content', style: { maxWidth: 460, width: '90vw' } },
      React.createElement(
        'h3', { style: { marginTop: 0, color: '#a01d10' } },
        React.createElement('i', { className: 'fa-solid fa-triangle-exclamation', style: { marginRight: 8 } }),
        certain ? 'Ce bon a déjà été enregistré' : 'Ce bon existe peut-être déjà'
      ),
      // Le NUMÉRO du bon existant, en évidence : sans lui le magasinier ne
      // peut rien vérifier, et forcera systématiquement.
      numero
        ? React.createElement(
          'div', { style: { padding: '10px 12px', borderRadius: 8, background: '#fdecea', border: '1px solid #e74c3c', color: '#a01d10', fontSize: 13, marginBottom: 12 } },
          'Bon existant : ',
          React.createElement('strong', { style: { fontSize: 15 } }, numero)
        )
        : null,
      React.createElement(
        'div', { style: { fontSize: 12, color: 'var(--gray-400)', marginBottom: 8 } },
        BCD_explication(doublon.motif)
      ),
      // Message du serveur, affiché tel quel — jamais reformulé côté client.
      doublon.message
        ? React.createElement('div', { style: { fontSize: 12, color: '#555', marginBottom: 14 } }, doublon.message)
        : null,
      React.createElement(
        'div', { style: { fontSize: 11, color: 'var(--gray-400)', marginBottom: 14 } },
        'Vérifiez le bon ', numero || 'existant',
        ' dans la liste avant de continuer. Si vous créez quand même ce bon, votre nom et la raison du blocage seront enregistrés.'
      ),
      React.createElement(
        'div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' } },
        // Forçage : SECONDAIRE et explicite. Placé en premier dans le flux,
        // donc à gauche, loin du geste par défaut ; jamais autofocus.
        React.createElement(
          'button', {
            onClick: props.onForce,
            disabled: saving,
            title: 'Créer ce bon malgré le doublon (action tracée)',
            style: { padding: '8px 16px', borderRadius: 8, border: '1px solid #e67e22', background: '#fff', color: '#b35400', cursor: 'pointer', fontSize: 12, opacity: saving ? 0.6 : 1 },
          },
          saving ? 'Création...' : 'Créer quand même ce bon'
        ),
        // Abandon : bouton d'accent, celui qui reçoit le focus.
        React.createElement(
          'button', {
            onClick: props.onCancel,
            disabled: saving,
            autoFocus: true,
            style: { padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--berry)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13, opacity: saving ? 0.6 : 1 },
          },
          'Annuler'
        )
      )
    )
  );
}

export { BCDoublonDialog };
