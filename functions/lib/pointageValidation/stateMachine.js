'use strict';
// @ts-check

/**
 * stateMachine.js — logique PURE du workflow de validation du pointage du jour
 * PAR FERME / PAR ÉQUIPE.
 *
 * Circuit validé (cf. item « Workflow validation du Pointage du jour par équipe ») :
 *   brouillon → (RH valide/rejette chaque équipe + le Divers) → submit-ferme (RH)
 *   → soumis → (Chef de CETTE ferme valide) → valide (FIGÉ, locked)
 *   → (DG unlock) → brouillon
 *
 * Aucune dépendance Firestore/réseau : uniquement des fonctions pures + tests
 * node:test (cf. __tests__/stateMachine.test.js). Réutilisable côté backend
 * (Cloud Function) comme garde-fou avant chaque mutation.
 *
 * Conventions :
 *   - submitState : 'brouillon' | 'soumis' | 'valide'
 *   - status équipe/divers : 'valide' | 'rejete' (et 'na' autorisé pour le divers)
 *   - profileId chef ↔ ferme : voir CHEF_FERME_BY_PROFILE
 */

/** Mapping profileId chef → ferme dont il est responsable. */
const CHEF_FERME_BY_PROFILE = {
  chef_f1: 'F1',
  chef_f5: 'F5',
  chef_avo: 'Avocatier',
  chef_bahia: 'BAHIA',
};

/** États de soumission possibles d'une ferme. */
const SUBMIT_STATES = ['brouillon', 'soumis', 'valide'];

/** Statuts d'adressage possibles d'une équipe. */
const EQUIPE_STATUSES = ['valide', 'rejete'];

/** Statuts d'adressage possibles du Pointage Divers d'une ferme. */
const DIVERS_STATUSES = ['valide', 'rejete', 'na'];

/**
 * Normalise un état de ferme potentiellement absent/partiel en objet complet.
 * @param {object|null|undefined} fermeState
 * @returns {{equipes:object, divers:object, submitState:string, locked:boolean}}
 */
function normalizeFermeState(fermeState) {
  const f = fermeState || {};
  return {
    equipes: f.equipes && typeof f.equipes === 'object' ? f.equipes : {},
    divers: f.divers && typeof f.divers === 'object' ? f.divers : { status: 'na' },
    submitState: SUBMIT_STATES.indexOf(f.submitState) >= 0 ? f.submitState : 'brouillon',
    locked: f.locked === true,
  };
}

/**
 * Une ferme est-elle figée (lecture seule) ?
 * @param {object|null|undefined} fermeState
 * @returns {boolean}
 */
function isFermeLocked(fermeState) {
  const f = normalizeFermeState(fermeState);
  return f.locked === true || f.submitState === 'valide';
}

/**
 * RH peut-il (encore) valider/rejeter une équipe ou le divers de cette ferme ?
 * Autorisé uniquement tant que la ferme est en 'brouillon' et non figée.
 * @param {object|null|undefined} fermeState
 * @returns {boolean}
 */
function canValidateEquipe(fermeState) {
  const f = normalizeFermeState(fermeState);
  if (isFermeLocked(f)) return false;
  return f.submitState === 'brouillon';
}

/**
 * RH peut-il soumettre la ferme à son chef ?
 * Exige : ferme en 'brouillon', au moins une équipe ce jour, TOUTES les équipes
 * du jour adressées (valide|rejete), et le divers adressé (valide|rejete|na).
 *
 * @param {object|null|undefined} fermeState
 * @param {Array<string>} equipesDuJour - ids des équipes présentes ce jour pour la ferme
 * @returns {{ok:boolean, reason?:string, manquantes?:Array<string>}}
 */
function canSubmitFerme(fermeState, equipesDuJour) {
  const f = normalizeFermeState(fermeState);
  if (isFermeLocked(f)) return { ok: false, reason: 'ferme_figee' };
  if (f.submitState !== 'brouillon') return { ok: false, reason: 'deja_soumis' };

  const jour = Array.isArray(equipesDuJour) ? equipesDuJour : [];
  if (jour.length === 0) return { ok: false, reason: 'aucune_equipe' };

  const manquantes = jour.filter((id) => {
    const e = f.equipes[id];
    return !e || EQUIPE_STATUSES.indexOf(e.status) < 0;
  });
  if (manquantes.length > 0) return { ok: false, reason: 'equipes_non_adressees', manquantes };

  const diversStatus = f.divers && f.divers.status;
  if (DIVERS_STATUSES.indexOf(diversStatus) < 0) return { ok: false, reason: 'divers_non_adresse' };

  return { ok: true };
}

/**
 * Le chef identifié par `profileId` peut-il valider la ferme ?
 * Exige : profil chef correspondant à la ferme, et ferme en état 'soumis'.
 * @param {object|null|undefined} fermeState
 * @param {string} ferme - ferme ciblée (ex. 'F1')
 * @param {string} profileId - profileId du caller (résolu serveur)
 * @returns {{ok:boolean, reason?:string}}
 */
function canChefValidate(fermeState, ferme, profileId) {
  const f = normalizeFermeState(fermeState);
  const chefFerme = CHEF_FERME_BY_PROFILE[profileId];
  if (!chefFerme) return { ok: false, reason: 'pas_un_chef' };
  if (chefFerme !== ferme) return { ok: false, reason: 'mauvaise_ferme' };
  if (f.submitState !== 'soumis') return { ok: false, reason: 'pas_soumis' };
  return { ok: true };
}

/**
 * Le chef identifié par `profileId` peut-il REJETER (renvoyer au RH) la ferme ?
 * Mêmes gardes que `canChefValidate` : profil chef de CETTE ferme, état 'soumis'.
 * Effet attendu côté action : soumis → brouillon (rouvre la saisie RH).
 * @param {object|null|undefined} fermeState
 * @param {string} ferme - ferme ciblée (ex. 'F1')
 * @param {string} profileId - profileId du caller (résolu serveur)
 * @returns {{ok:boolean, reason?:string}}
 */
function canChefReject(fermeState, ferme, profileId) {
  const f = normalizeFermeState(fermeState);
  const chefFerme = CHEF_FERME_BY_PROFILE[profileId];
  if (!chefFerme) return { ok: false, reason: 'pas_un_chef' };
  if (chefFerme !== ferme) return { ok: false, reason: 'mauvaise_ferme' };
  if (f.submitState !== 'soumis') return { ok: false, reason: 'pas_soumis' };
  return { ok: true };
}

/**
 * Le DG peut-il déverrouiller la ferme ?
 * Exige : ferme figée (locked === true).
 * @param {object|null|undefined} fermeState
 * @returns {{ok:boolean, reason?:string}}
 */
function canUnlock(fermeState) {
  const f = normalizeFermeState(fermeState);
  if (f.locked !== true) return { ok: false, reason: 'pas_verrouillee' };
  return { ok: true };
}

/**
 * Calcule le prochain submitState pour une transition donnée.
 * Transitions valides :
 *   submit       : brouillon → soumis
 *   chef         : soumis    → valide
 *   chef-reject  : soumis    → brouillon
 *   unlock       : valide    → brouillon
 * @param {string} currentState
 * @param {'submit'|'chef'|'chef-reject'|'unlock'} transition
 * @returns {string|null} nouvel état, ou null si transition invalide
 */
function nextSubmitState(currentState, transition) {
  const state = SUBMIT_STATES.indexOf(currentState) >= 0 ? currentState : 'brouillon';
  if (transition === 'submit' && state === 'brouillon') return 'soumis';
  if (transition === 'chef' && state === 'soumis') return 'valide';
  if (transition === 'chef-reject' && state === 'soumis') return 'brouillon';
  if (transition === 'unlock' && state === 'valide') return 'brouillon';
  return null;
}

/**
 * Résout la ferme dont un profil chef est responsable.
 * @param {string} profileId
 * @returns {string|null}
 */
function fermeForChefProfile(profileId) {
  return CHEF_FERME_BY_PROFILE[profileId] || null;
}

module.exports = {
  CHEF_FERME_BY_PROFILE,
  SUBMIT_STATES,
  EQUIPE_STATUSES,
  DIVERS_STATUSES,
  normalizeFermeState,
  isFermeLocked,
  canValidateEquipe,
  canSubmitFerme,
  canChefValidate,
  canChefReject,
  canUnlock,
  nextSubmitState,
  fermeForChefProfile,
}
