'use strict';
// @ts-check

/**
 * validationAccess.js — décision PURE d'autorisation pour exports.validation
 * (workflow Visa RH → Caporal → Chef sur pointage_validations).
 *
 * SÉCURITÉ : ce module ne prend AUCUNE décision à partir du body client.
 * Le `callerProfile` passé ici DOIT être résolu serveur (resolveCallerRole sur
 * le token Firebase vérifié), jamais lu depuis req.body. Le rôle/ferme/identité
 * en découlent. Voir functions/index.js exports.validation.
 *
 * Aucune dépendance Firestore/réseau : uniquement des fonctions pures + tests
 * node:test (cf. tests/unit/validationAccess.test.js).
 *
 * Mapping chef → ferme réutilisé depuis le state machine du pointage par équipe
 * (source de vérité unique : CHEF_FERME_BY_PROFILE).
 */

const { fermeForChefProfile } = require('../pointageValidation/stateMachine');

/** Mapping profileId caporal → ferme dont il est responsable. */
const CAPORAL_FERME_BY_PROFILE = {
  caporal_f1: 'F1',
  caporal_f5: 'F5',
  caporal_avo: 'Avocatier',
};

/**
 * Rôle générique d'un profileId pour le workflow de validation.
 * @param {string|null|undefined} profileId
 * @returns {'rh'|'dg'|'caporal'|'chef'|null}
 */
function genericRoleFor(profileId) {
  if (typeof profileId !== 'string' || profileId.length === 0) return null;
  if (profileId === 'rh') return 'rh';
  if (profileId === 'dg') return 'dg';
  if (profileId.indexOf('caporal_') === 0) return 'caporal';
  if (profileId.indexOf('chef_') === 0) return 'chef';
  return null;
}

/**
 * Résout la ferme dont un profil caporal est responsable.
 * @param {string|null|undefined} profileId
 * @returns {'F1'|'F5'|'Avocatier'|null}
 */
function fermeForCaporalProfile(profileId) {
  if (typeof profileId !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(CAPORAL_FERME_BY_PROFILE, profileId)) return null;
  return CAPORAL_FERME_BY_PROFILE[profileId];
}

/**
 * Le caller (résolu serveur) est-il habilité sur cette ferme pour valider/rejeter ?
 * - rh/dg : toutes les fermes (y compris DIVERS).
 * - chef  : uniquement la ferme dont il est responsable.
 * - caporal : uniquement la ferme dont il est responsable.
 * @param {'rh'|'dg'|'caporal'|'chef'} role
 * @param {string} callerProfile
 * @param {string} ferme
 * @returns {boolean}
 */
function isOnOwnScope(role, callerProfile, ferme) {
  if (role === 'rh' || role === 'dg') return true;
  if (role === 'chef') return fermeForChefProfile(callerProfile) === ferme;
  if (role === 'caporal') return fermeForCaporalProfile(callerProfile) === ferme;
  return false;
}

/**
 * Décision d'autorisation pour une action de validation.
 *
 * @param {object} params
 * @param {string|null|undefined} params.callerProfile - profileId résolu SERVEUR
 * @param {'validate'|'reject'|'unlock'} params.action
 * @param {string} [params.ferme] - ferme ciblée (du body, mais l'habilitation est vérifiée serveur)
 * @param {boolean} [params.locked] - état actuel du doc (lu serveur)
 * @param {boolean} [params.rejected] - état actuel du doc (lu serveur)
 * @returns {{allowed: boolean, role: ('rh'|'dg'|'caporal'|'chef'|null), reason?: string}}
 */
function authorizeValidationAction(params) {
  const p = params || {};
  const role = genericRoleFor(p.callerProfile);
  if (!role) return { allowed: false, role: null, reason: 'Profil non habilité' };

  if (p.action === 'validate') {
    // rh/dg : toutes fermes (DIVERS inclus). chef/caporal : leur ferme uniquement.
    if (isOnOwnScope(role, p.callerProfile, p.ferme)) {
      return { allowed: true, role };
    }
    return { allowed: false, role, reason: 'Pas habilité sur cette ferme' };
  }

  if (p.action === 'reject') {
    // Comportement existant : seul Caporal ou Chef peut rejeter, sur sa ferme.
    // (rh/dg ne rejettent pas dans le code actuel — préservé.)
    if (role !== 'caporal' && role !== 'chef') {
      return { allowed: false, role, reason: 'Seul le Caporal ou Chef peut rejeter' };
    }
    if (isOnOwnScope(role, p.callerProfile, p.ferme)) {
      return { allowed: true, role };
    }
    return { allowed: false, role, reason: 'Pas habilité sur cette ferme' };
  }

  if (p.action === 'unlock') {
    // Garde paie validée : un pointage verrouillé non rejeté ne peut être
    // déverrouillé que par le DG (rôle résolu serveur, jamais profileId du body).
    if (p.locked === true && p.rejected !== true) {
      if (role === 'dg') return { allowed: true, role };
      return {
        allowed: false,
        role,
        reason: 'Impossible de déverrouiller un pointage validé. Seul le DG peut le faire.',
      };
    }
    // Sinon (non verrouillé ou déjà rejeté) : comportement existant — tout
    // caller authentifié et habilité peut réinitialiser l'état.
    return { allowed: true, role };
  }

  return { allowed: false, role, reason: 'Action inconnue' };
}

module.exports = {
  CAPORAL_FERME_BY_PROFILE,
  genericRoleFor,
  fermeForCaporalProfile,
  authorizeValidationAction,
};
