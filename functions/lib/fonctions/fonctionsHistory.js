'use strict';
// @ts-check

/**
 * fonctionsHistory.js — Historisation PURE des classements de fonction.
 *
 * SÉCURITÉ CRITIQUE (paie/RH) : le classement d'un ouvrier dans une fonction
 * (fonction_id sur ouvriers_registry/{matricule}) conditionne sa prime de
 * fonction. Toute écriture passe EXCLUSIVEMENT par la Cloud Function gatée
 * fonctionsManagement (rôle RH/DG vérifié SERVEUR). Ce module ne fait QUE
 * construire l'objet d'update — il ne touche jamais Firestore.
 *
 * Sémantique :
 *  - Le champ `fonction_id` reflète la fonction COURANTE de l'ouvrier.
 *  - Chaque changement ajoute une entrée dans `fonction_history` (array sur le
 *    doc) : NON destructif, on conserve toujours la trace du classement
 *    précédent (previousFonctionId), l'auteur (identité serveur) et
 *    l'horodatage. Cohérent avec le pattern `history` de caisse_transactions
 *    et `prime_history` de primeHistory.js.
 *  - Déclassement : fonctionId falsy (null/'') → l'ouvrier retourne « À
 *    classer ». Le caller (CF) traduit ce cas en FieldValue.delete() sur
 *    fonction_id ; ce module signale le déclassement via unset:true et ne pose
 *    PAS fonction_id dans l'objet retourné (à charge de la CF).
 *
 * Module PUR : aucune dépendance Firestore. `now` et l'auteur sont injectés.
 */

/**
 * @typedef {Object} FonctionActor
 * @property {string} uid
 * @property {string} profileId
 * @property {string} name
 */

/**
 * @typedef {Object} FonctionHistoryEntry
 * @property {string|null} fonction_id  Nouvelle fonction (null si déclassement).
 * @property {string|null} previousFonctionId  Fonction courante avant ce changement.
 * @property {FonctionActor} changedBy
 * @property {number} changedAt  Horodatage (ms epoch).
 */

/**
 * Construit l'objet de mise à jour à fusionner (merge) dans
 * ouvriers_registry/{matricule} lors d'un changement de fonction.
 *
 * @param {Object} params
 * @param {Object|null|undefined} params.current  Doc actuel (ou null si nouveau).
 * @param {string|null|undefined} params.fonctionId  Nouvelle fonction (falsy = déclassement).
 * @param {FonctionActor} params.actor  Identité serveur (jamais du body).
 * @param {number} params.now  Horodatage serveur (ms epoch).
 * @returns {{fonction_id?:string, unset:boolean,
 *   fonction_by:FonctionActor, fonction_updated_at:number,
 *   fonction_history:FonctionHistoryEntry[], updatedAt:number}}
 *   Objet à écrire en merge. Si unset===true, la CF doit poser fonction_id via
 *   FieldValue.delete() (le champ fonction_id est ABSENT de l'objet retourné).
 */
function buildFonctionUpdate(params) {
  const current = params.current || {};
  const rawFonctionId = params.fonctionId;
  const fonctionId = (rawFonctionId === undefined || rawFonctionId === null)
    ? '' : String(rawFonctionId).trim();
  const unset = !fonctionId;

  const actor = {
    uid: String((params.actor && params.actor.uid) || ''),
    profileId: String((params.actor && params.actor.profileId) || ''),
    name: String((params.actor && params.actor.name) || ''),
  };
  const now = Number(params.now) || Date.now();

  const previousFonctionId = current.fonction_id ? String(current.fonction_id) : null;
  const prevHistory = Array.isArray(current.fonction_history) ? current.fonction_history : [];

  /** @type {FonctionHistoryEntry} */
  const entry = {
    fonction_id: unset ? null : fonctionId,
    previousFonctionId: previousFonctionId,
    changedBy: actor,
    changedAt: now,
  };

  /** @type {{unset:boolean, fonction_by:FonctionActor, fonction_updated_at:number, fonction_history:FonctionHistoryEntry[], updatedAt:number, fonction_id?:string}} */
  const update = {
    unset: unset,
    fonction_by: actor,
    fonction_updated_at: now,
    fonction_history: prevHistory.concat([entry]),
    updatedAt: now,
  };
  // Classement : on pose fonction_id. Déclassement : on l'omet (la CF le
  // supprime via FieldValue.delete()) — jamais de string vide en base.
  if (!unset) update.fonction_id = fonctionId;

  return update;
}

module.exports = { buildFonctionUpdate };
