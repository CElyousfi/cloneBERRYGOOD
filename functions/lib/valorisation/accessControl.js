'use strict';
// @ts-check

/**
 * accessControl.js — Logique PURE de contrôle d'accès pour l'onglet
 * « Engrais & Pesticides » (conso valorisée au PMP).
 *
 * AUCUN accès Firestore : reçoit le rôle/profil + la ferme de l'utilisateur et la
 * ferme demandée par le client, renvoie le PÉRIMÈTRE autorisé. C'est LA barrière
 * de sécurité : le périmètre ferme est IMPOSÉ serveur, jamais négociable par le
 * client. Un Chef de Ferme F1 qui demande ?ferme=F5 reçoit F1, jamais F5.
 *
 * Rôles autorisés : DG, Finance, RH (accès global), Chef de Ferme (sa ferme).
 * Tout autre profil (magasinier, achats, caporal, agronomie, inconnu…) → non
 * autorisé. NB : RH est full-access car la matrice RH voit tout le nominatif ;
 * ce module sert aussi de barrière pour le gating paie (divers / pointageRH).
 *
 * Modèle de rôles (cf. users/{uid}) :
 *  - profileId : rôle fonctionnel ('dg' | 'finance' | 'chef_f1' | 'chef_f5' |
 *    'chef_avo' | 'chef_bahia' | 'magasinier' | …).
 *  - role : rôle système ('admin' | 'user'). Un admin a accès à tout (all).
 *  - ferme : rattachement ferme (string), utile en repli pour les chefs.
 *
 * Le profileId d'un chef encode la ferme : chef_f1→F1, chef_f5→F5,
 * chef_avo→Avocatier, chef_bahia→BAHIA.
 */

/** Profils à accès global (toutes fermes). RH voit tout le nominatif (matrice RH). */
const FULL_ACCESS_PROFILES = { dg: true, finance: true, rh: true };

/**
 * Table profileId chef → ferme système. Source de vérité du rattachement.
 * @type {Record<string,string>}
 */
const CHEF_PROFILE_FERME = {
  chef_f1: null,        // Accès culture seulement (Framboise, F1 + F5-Framboise)
  chef_f5: 'F5',
  chef_avo: 'Avocatier',
  chef_bahia: 'BAHIA',
};

/**
 * Table profileId chef → filtre culture additionnel (null = pas de filtre culture).
 * chef_f5 = Myrtille uniquement dans F5 (parcelles S8 : Corina, Breeze, Cascade).
 * chef_f1 = null (F1 est 100 % Framboise, aucun filtre nécessaire).
 * @type {Record<string,string>}
 */
const CHEF_PROFILE_CULTURE = {
  chef_f1: 'Framboise', // F1 + parcelles Framboise de F5 (S9/S10/S13)
  chef_f5: 'Myrtille',  // F5 uniquement, parcelles S8 (Corina, Breeze, Cascade)
};

/**
 * Indique si un profileId correspond à un Chef de Ferme.
 * @param {*} profileId
 * @returns {boolean}
 */
function isChefProfile(profileId) {
  return typeof profileId === 'string' && profileId.indexOf('chef_') === 0;
}

/**
 * Résout la ferme d'un chef : d'abord la table profileId→ferme, sinon le champ
 * ferme du profil utilisateur (repli), sinon ''.
 * @param {string} profileId
 * @param {*} fermeUtilisateur - users/{uid}.ferme (repli)
 * @returns {string}
 */
function resolveChefFerme(profileId, fermeUtilisateur) {
  if (
    typeof profileId === 'string' &&
    Object.prototype.hasOwnProperty.call(CHEF_PROFILE_FERME, profileId)
  ) {
    // null = accès culture-only (ex. chef_f1 : Framboise sur toutes fermes)
    return CHEF_PROFILE_FERME[profileId];
  }
  const f = fermeUtilisateur == null ? '' : String(fermeUtilisateur).trim();
  return f;
}

/**
 * @typedef {Object} Perimetre
 * @property {boolean} autorise        - false => 403.
 * @property {string} role             - rôle normalisé renvoyé au client.
 * @property {('all'|string)} perimetre_ferme - 'all' (DG/Finance/admin) ou la
 *                                       ferme imposée (chef). '' si non résolue.
 * @property {(null|string)} ferme_filtre - ferme à injecter dans le filtre
 *                                       getConsommationRows (null = pas de filtre).
 * @property {(null|string)} culture_filtre - culture additionnelle à filtrer en plus
 *                                       de la ferme (ex. 'Myrtille' pour chef_f5).
 *                                       null = pas de filtre culture (passthrough).
 * @property {(undefined|string)} error - message d'erreur si non autorisé.
 */

/**
 * Calcule le périmètre ferme autorisé pour l'appelant.
 *
 * @param {Object} user - { profileId, role, ferme } (depuis users/{uid}).
 * @param {*} fermeDemandee - param ?ferme= du client (peut être 'all', '', undefined).
 * @returns {Perimetre}
 */
function resolvePerimetre(user, fermeDemandee) {
  const u = user || {};
  // Normalisation stricte : seules les strings sont retenues. Un profileId/role
  // non-string (objet, array, …) devient '' → fail-closed (non autorisé).
  const profileId = typeof u.profileId === 'string' ? u.profileId.trim() : '';
  const systemRole = typeof u.role === 'string' ? u.role.trim() : '';

  // Admin système : accès global (toutes fermes).
  if (systemRole === 'admin') {
    return { autorise: true, role: 'admin', perimetre_ferme: 'all', ferme_filtre: null, culture_filtre: null };
  }

  // DG / Finance : toutes fermes, avec filtre optionnel côté client.
  if (Object.prototype.hasOwnProperty.call(FULL_ACCESS_PROFILES, profileId)) {
    // fermeDemandee : seul un string non vide ≠ 'all' restreint le périmètre.
    // Tout autre type (objet, array, …) est ignoré → périmètre 'all'.
    const demande = typeof fermeDemandee === 'string' ? fermeDemandee.trim() : '';
    if (demande && demande.toLowerCase() !== 'all') {
      return { autorise: true, role: profileId, perimetre_ferme: demande, ferme_filtre: demande, culture_filtre: null };
    }
    return { autorise: true, role: profileId, perimetre_ferme: 'all', ferme_filtre: null, culture_filtre: null };
  }

  // Chef de Ferme : périmètre FORCÉ. Tout param ?ferme= est ignoré.
  if (isChefProfile(profileId)) {
    const ferme = resolveChefFerme(profileId, u.ferme);
    const cultureFiltre = Object.prototype.hasOwnProperty.call(CHEF_PROFILE_CULTURE, profileId)
      ? CHEF_PROFILE_CULTURE[profileId]
      : null;
    // ferme === null  → accès culture-only (chef_f1 : Framboise toutes fermes)
    // ferme === ''    → chef inconnu, périmètre vide (fail-closed)
    // ferme === 'F5'  → filtre ferme strict
    const fermeFiltre = ferme === null ? null : (ferme || '__none__');
    return {
      autorise: true,
      role: profileId,
      perimetre_ferme: ferme === null ? 'all' : (ferme || ''),
      ferme_filtre: fermeFiltre,
      culture_filtre: cultureFiltre,
    };
  }

  // Tout autre profil : non autorisé.
  return {
    autorise: false,
    role: profileId || 'inconnu',
    perimetre_ferme: '',
    ferme_filtre: null,
    culture_filtre: null,
    error: 'Accès non autorisé',
  };
}

module.exports = {
  FULL_ACCESS_PROFILES,
  CHEF_PROFILE_FERME,
  CHEF_PROFILE_CULTURE,
  isChefProfile,
  resolveChefFerme,
  resolvePerimetre,
};
