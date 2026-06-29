'use strict';
// @ts-check

/**
 * primeHistory.js — Historisation PURE des changements de prime fixe.
 *
 * Sémantique effectiveFrom :
 *  - Le champ `primeFonctionJournaliere` reflète la valeur COURANTE (utilisée
 *    par le calcul de paie temps réel côté front).
 *  - Chaque modification ajoute une entrée dans `prime_history` (array sur le
 *    doc ouvriers_registry/{matricule}) avec la valeur, sa date d'effet
 *    (effectiveFrom), l'auteur (identité serveur) et l'horodatage serveur.
 *  - On NE supprime JAMAIS l'ancienne valeur : l'historique conserve la trace
 *    pour que les périodes de paie CLOSES ne soient pas réécrites (application
 *    stricte par période = raffinement futur). On stocke l'info dès maintenant.
 *
 * Choix : array `prime_history` sur le doc (et non sous-collection) — lecture
 * atomique avec le doc, volume faible (1 entrée par modif, 57 ouvriers
 * concernés), cohérent avec le pattern `history` de caisse_transactions.
 *
 * Module PUR : aucune dépendance Firestore. `now` et l'auteur sont injectés.
 */

/**
 * @typedef {Object} PrimeActor
 * @property {string} uid
 * @property {string} profileId
 * @property {string} name
 */

/**
 * @typedef {Object} PrimeHistoryEntry
 * @property {number} montant
 * @property {string} effectiveFrom  Date d'effet (YYYY-MM-DD).
 * @property {number} previousMontant  Valeur courante avant ce changement.
 * @property {PrimeActor} changedBy
 * @property {number} changedAt  Horodatage (ms epoch).
 */

/**
 * Construit l'objet de mise à jour à fusionner (merge) dans
 * ouvriers_registry/{matricule} lors d'un changement de prime.
 *
 * @param {Object} params
 * @param {Object|null|undefined} params.current  Doc actuel (ou null si nouveau).
 * @param {number} params.montant  Nouveau montant (DH/jour).
 * @param {string} params.effectiveFrom  Date d'effet (YYYY-MM-DD).
 * @param {PrimeActor} params.actor  Identité serveur (jamais du body).
 * @param {number} params.now  Horodatage serveur (ms epoch).
 * @returns {{primeFonctionJournaliere:number, prime_effectiveFrom:string,
 *   prime_history:PrimeHistoryEntry[], updatedAt:number,
 *   updatedBy:PrimeActor}}
 *   Objet à écrire en merge (conserve l'historique antérieur + nouvelle entrée).
 */
function buildPrimeUpdate(params) {
  const current = params.current || {};
  const montant = Number(params.montant) || 0;
  const effectiveFrom = String(params.effectiveFrom || '').trim();
  const actor = {
    uid: String((params.actor && params.actor.uid) || ''),
    profileId: String((params.actor && params.actor.profileId) || ''),
    name: String((params.actor && params.actor.name) || ''),
  };
  const now = Number(params.now) || Date.now();

  const previousMontant = Number(current.primeFonctionJournaliere) || 0;
  const prevHistory = Array.isArray(current.prime_history) ? current.prime_history : [];

  /** @type {PrimeHistoryEntry} */
  const entry = {
    montant,
    effectiveFrom,
    previousMontant,
    changedBy: actor,
    changedAt: now,
  };

  return {
    primeFonctionJournaliere: montant,
    prime_effectiveFrom: effectiveFrom,
    prime_history: prevHistory.concat([entry]),
    updatedAt: now,
    updatedBy: actor,
  };
}

module.exports = { buildPrimeUpdate };
