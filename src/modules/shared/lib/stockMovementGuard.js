/**
 * stockMovementGuard.js — Pure helpers : un bon (stock_movement) est-il
 * éditable / supprimable par un demandeur donné ?
 *
 * Le backend en garde une copie BYTE-IDENTIQUE à functions/lib/stock/movementGuard.js.
 * Si tu édites l'un, édite l'autre.
 *
 * Règles métier (item #5 backlog) — un bon n'est modifiable/supprimable QUE si
 * les TROIS conditions sont réunies :
 *   1. NON importé  : ce n'est pas une ligne issue de l'import CANEVA
 *      (import_source présent, OU created_by.userId === 'import_caneva',
 *       OU numero commençant par 'IMP-').
 *   2. NON validé   : status !== 'valide_chef' (un bon validé a déjà impacté
 *      les soldes → on passe par un bon d'annulation/retour, jamais d'édition).
 *   3. DEMANDEUR == CRÉATEUR : l'identité du demandeur (résolue depuis le token
 *      côté backend) correspond au créateur du bon.
 *
 * Schéma réel (vérifié 2026-06) : created_by = { profileId, name, userId }.
 * Dans l'app, `userId` n'est pas peuplé avec l'uid Firebase (profileData
 * statique) ; l'identité effective est le `profileId`. Le contrôle créateur se
 * fait donc sur profileId, avec repli sur userId quand il est présent et non
 * vide (compat future / mouvements taggés uid).
 */
// @ts-check

/** Valeur du tag d'import CANEVA stockée dans created_by.userId. */
var IMPORT_CREATED_BY = 'import_caneva';

/** Statut « validé » : impact stock déjà comptabilisé. */
var VALIDATED_STATUS = 'valide_chef';

/**
 * Le mouvement provient-il de l'import CANEVA (donc non éditable/supprimable) ?
 * @param {*} m mouvement (objet Firestore)
 * @returns {boolean}
 */
function isImportedMovement(m) {
  if (!m) return false;
  if (m.import_source) return true;
  if (m.created_by && m.created_by.userId === IMPORT_CREATED_BY) return true;
  if (typeof m.numero === 'string' && m.numero.indexOf('IMP-') === 0) return true;
  return false;
}

/**
 * Le mouvement est-il validé (impact stock appliqué) ?
 * @param {*} m
 * @returns {boolean}
 */
function isValidatedMovement(m) {
  return !!m && m.status === VALIDATED_STATUS;
}

/**
 * Le mouvement est-il soft-deleted ?
 * @param {*} m
 * @returns {boolean}
 */
function isDeletedMovement(m) {
  return !!m && (m.deleted === true || m.status === 'supprime');
}

/**
 * Le demandeur est-il le créateur du bon ?
 * Compare en priorité userId (si peuplé des deux côtés et non vide), sinon
 * profileId (identité effective dans l'app).
 * @param {*} m mouvement
 * @param {{profileId?:string, userId?:string}} requester identité résolue côté serveur (token)
 * @returns {boolean}
 */
function isCreator(m, requester) {
  if (!m || !m.created_by || !requester) return false;
  // Un bon importé n'a jamais de créateur « humain » : refus systématique.
  if (isImportedMovement(m)) return false;
  var cb = m.created_by;
  var reqUid = requester.userId || '';
  var cbUid = cb.userId || '';
  if (reqUid && cbUid && reqUid !== IMPORT_CREATED_BY && cbUid !== IMPORT_CREATED_BY) {
    return reqUid === cbUid;
  }
  var reqProfile = requester.profileId || '';
  var cbProfile = cb.profileId || '';
  if (!reqProfile || !cbProfile) return false;
  return reqProfile === cbProfile;
}

/**
 * Évalue si un bon est modifiable/supprimable par le demandeur et renvoie le
 * détail (utile pour les messages d'erreur 403 côté backend et l'affichage UI).
 * @param {*} m mouvement
 * @param {{profileId?:string, userId?:string}} requester
 * @returns {{allowed:boolean, reason:(string|null)}}
 *   reason ∈ 'not_found' | 'imported' | 'validated' | 'deleted' | 'not_creator' | null
 */
function evaluateMutable(m, requester) {
  if (!m) return { allowed: false, reason: 'not_found' };
  if (isDeletedMovement(m)) return { allowed: false, reason: 'deleted' };
  if (isImportedMovement(m)) return { allowed: false, reason: 'imported' };
  if (isValidatedMovement(m)) return { allowed: false, reason: 'validated' };
  if (!isCreator(m, requester)) return { allowed: false, reason: 'not_creator' };
  return { allowed: true, reason: null };
}

/**
 * Bon modifiable par ce demandeur ? (boolean simple pour l'UI)
 * @param {*} m
 * @param {{profileId?:string, userId?:string}} requester
 * @returns {boolean}
 */
function canEditMovement(m, requester) {
  return evaluateMutable(m, requester).allowed;
}

/**
 * Bon supprimable par ce demandeur ? Mêmes règles que l'édition (un bon validé
 * n'est jamais supprimable — impact déjà comptabilisé).
 * @param {*} m
 * @param {{profileId?:string, userId?:string}} requester
 * @returns {boolean}
 */
function canDeleteMovement(m, requester) {
  return evaluateMutable(m, requester).allowed;
}

/**
 * Rôles « admin métier stock » autorisés à supprimer un bon SAISI app même
 * validé / dont ils ne sont pas créateurs (item suppression bons).
 */
var ADMIN_DELETE_ROLES = ['achats', 'dg'];

/**
 * Le demandeur a-t-il un rôle admin (Achats/DG) habilité à la suppression élargie ?
 * @param {{profileId?:string}} requester
 * @returns {boolean}
 */
function isAdminDeleter(requester) {
  return !!requester && ADMIN_DELETE_ROLES.indexOf(requester.profileId || '') !== -1;
}

/**
 * Évalue la suppression « admin » (Achats/DG) : autorisée pour tout bon SAISI app
 * (non importé) non déjà supprimé, sans restriction validé/créateur. Les bons
 * importés du grand livre restent INSUPPRIMABLES.
 * @param {*} m
 * @param {{profileId?:string, userId?:string}} requester
 * @returns {{allowed:boolean, reason:(string|null)}}
 */
function evaluateAdminDelete(m, requester) {
  if (!m) return { allowed: false, reason: 'not_found' };
  if (!isAdminDeleter(requester)) return { allowed: false, reason: 'not_admin' };
  if (isDeletedMovement(m)) return { allowed: false, reason: 'deleted' };
  if (isImportedMovement(m)) return { allowed: false, reason: 'imported' };
  return { allowed: true, reason: null };
}

/**
 * Bon supprimable par un admin (Achats/DG) ? (boolean simple pour l'UI)
 * @param {*} m
 * @param {{profileId?:string, userId?:string}} requester
 * @returns {boolean}
 */
function canAdminDeleteMovement(m, requester) {
  return evaluateAdminDelete(m, requester).allowed;
}

/** Message FR lisible pour un refus donné. */
function refusalMessage(reason) {
  switch (reason) {
    case 'not_found': return 'Mouvement introuvable';
    case 'imported': return 'Les bons importés (CANEVA) ne peuvent pas être modifiés ni supprimés';
    case 'validated': return 'Bon déjà validé : impact stock comptabilisé. Passez par un bon d\'annulation/retour';
    case 'deleted': return 'Bon déjà supprimé';
    case 'not_creator': return 'Seul le créateur du bon peut le modifier ou le supprimer';
    case 'not_admin': return 'Seuls les profils Achats et DG peuvent supprimer ce bon';
    default: return 'Action non autorisée';
  }
}

export { IMPORT_CREATED_BY, VALIDATED_STATUS, isImportedMovement, isValidatedMovement, isDeletedMovement, isCreator, evaluateMutable, canEditMovement, canDeleteMovement, ADMIN_DELETE_ROLES, isAdminDeleter, evaluateAdminDelete, canAdminDeleteMovement, refusalMessage };
