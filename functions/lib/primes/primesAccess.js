'use strict';
// @ts-check

/**
 * primesAccess.js — Contrôle d'accès PUR pour la gestion des primes fixes.
 *
 * SÉCURITÉ CRITIQUE : seuls les profils RH/DG (ou le rôle système admin)
 * peuvent gérer les primes fixes (écriture de paie). Toute autre identité
 * (caporal, chef, magasinier, inconnu, vide) est refusée.
 *
 * Module PUR : aucune dépendance Firestore, aucun effet de bord. Reçoit en
 * paramètre l'identité DÉJÀ résolue côté serveur (profileId + role système),
 * jamais des données du body client.
 */

/**
 * Profils métier autorisés à gérer les primes fixes.
 * @type {ReadonlyArray<string>}
 */
const PRIMES_PROFILES_AUTORISES = Object.freeze(['rh', 'dg']);

/**
 * Indique si l'identité serveur fournie peut gérer les primes fixes.
 * Autorise UNIQUEMENT profileId ∈ {rh, dg} OU role système === 'admin'.
 *
 * @param {{profileId?: unknown, role?: unknown}|null|undefined} identity
 *   Identité résolue côté serveur : { profileId, role }.
 * @returns {boolean} true si autorisé, false sinon.
 */
function canManagePrimes(identity) {
  if (!identity || typeof identity !== 'object') return false;
  const role = typeof identity.role === 'string' ? identity.role : '';
  if (role === 'admin') return true;
  const profileId = typeof identity.profileId === 'string' ? identity.profileId : '';
  // Utilise indexOf sur un tableau gelé : pas de risque de clé prototype.
  return PRIMES_PROFILES_AUTORISES.indexOf(profileId) !== -1;
}

/**
 * Raison de refus standardisée (message 403). Constante : ne fuit aucune
 * information sur l'identité refusée.
 * @returns {string}
 */
function forbiddenReason() {
  return 'Accès non autorisé';
}

module.exports = { canManagePrimes, forbiddenReason, PRIMES_PROFILES_AUTORISES };
