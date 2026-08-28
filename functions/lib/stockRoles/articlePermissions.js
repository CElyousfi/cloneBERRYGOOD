'use strict';
// @ts-check

/**
 * articlePermissions.js — Module PUR : qui a le droit d'écrire sur une fiche
 * `articles_catalog`.
 *
 * RÈGLE, INCHANGÉE DEPUIS TOUJOURS : `achats` OU `dg`. Les deux profils ont un
 * accès COMPLET à la fiche (nom, référence, unité, prix, catégorie…). Tout
 * autre rôle — y compris un utilisateur authentifié sans profil — est refusé.
 *
 * ⚠️ CE MODULE N'A PAS ÉLARGI NI RESTREINT QUOI QUE CE SOIT (ticket
 * sb/classer-depuis-bandeau). Il ne fait que SORTIR du monolithe une condition
 * qui y était écrite en dur et la rendre testable. La tentation de brider le
 * `dg` au seul champ `categorie` a été explicitement écartée : le DG éditait
 * déjà les fiches complètes depuis Stock › Articles, et l'écran y envoie
 * TOUJOURS le formulaire entier (11 champs) — l'aurait-on bridé qu'il aurait
 * reçu un 403 sur une action qui marchait la veille.
 *
 * Le message d'erreur historique disait « Réservé au responsable achats »
 * alors que le DG passait : c'est ce mensonge qui a fait croire à une garde
 * plus stricte qu'elle ne l'est. Il est corrigé ici, à la source.
 *
 * Aucune dépendance Firestore : 100 % pur, testable unitairement.
 */

/** Profil propriétaire du catalogue. */
const ROLE_CATALOGUE = 'achats';

/** Profil superviseur, accès complet lui aussi (historique). */
const ROLE_SUPERVISEUR = 'dg';

/** Message de refus. Nomme les DEUX profils autorisés — cf. en-tête. */
const REFUS = 'Réservé au responsable achats ou au DG';

/**
 * @typedef {Object} Verdict
 * @property {boolean} ok true si l'écriture est autorisée.
 * @property {string} raison message d'erreur destiné à l'appelant ('' si ok).
 */

/**
 * Décide si `role` peut écrire sur une fiche `articles_catalog`.
 *
 * Le rôle DOIT être celui résolu SERVEUR (`resolveCallerRole`, depuis le token),
 * jamais une valeur lue dans le body : c'était la faille historique de
 * `create-article`.
 *
 * @param {*} role profileId résolu serveur.
 * @returns {Verdict}
 */
function peutModifierArticle(role) {
  const r = typeof role === 'string' ? role : '';
  if (r === ROLE_CATALOGUE || r === ROLE_SUPERVISEUR) return { ok: true, raison: '' };
  return { ok: false, raison: REFUS };
}

/**
 * Décide si `role` peut inspecter (`suggest-article-duplicates`) et exécuter
 * (`merge-articles`) une fusion de fiches en doublon.
 *
 * MÊME POPULATION que `peutModifierArticle` — `achats` ou `dg` — et c'est
 * volontaire : fusionner deux fiches, c'est écrire au catalogue (le master
 * absorbe prix et soldes, les doublons deviennent des pierres tombales). Un
 * export DÉDIÉ plutôt qu'un alias, parce que les deux droits pourraient
 * légitimement diverger un jour ; la délégation garantit qu'ils ne divergent
 * pas PAR ACCIDENT.
 *
 * Élargi au `dg` le 2026-08-27 (demande explicite d'Omar) : la garde était en
 * dur sur `achats`, un profil qu'aucun humain n'utilise au quotidien. La
 * fusion des ~105 paires de doublons n'avait donc JAMAIS pu être exécutée en
 * production, et les prix restaient dispersés entre fiches jumelles.
 *
 * Le rôle DOIT être celui résolu SERVEUR (`resolveCallerRole`), jamais lu dans
 * le body.
 *
 * @param {*} role profileId résolu serveur.
 * @returns {Verdict}
 */
function peutFusionnerArticles(role) {
  return peutModifierArticle(role);
}

/**
 * Décide si `role` peut SUPPRIMER un bon de consommation (`delete-bc`).
 *
 * MÊME POPULATION que `peutModifierArticle` — `achats` ou `dg` — et c'est la
 * règle déjà en place pour les réceptions (`delete-movement`, chemin admin
 * métier `isAdminDeleter`) : le magasinier ne défait pas son propre bon.
 * Supprimer un bon annule des mouvements de stock déjà appliqués sur les
 * soldes ; c'est une correction d'inventaire, pas une action de saisie.
 *
 * Export DÉDIÉ plutôt qu'un alias, pour la même raison que
 * `peutFusionnerArticles` : les deux droits pourraient légitimement diverger un
 * jour, la délégation garantit qu'ils ne divergent pas PAR ACCIDENT.
 *
 * Le rôle DOIT être celui résolu SERVEUR (`resolveCallerRole`), jamais lu dans
 * le body.
 *
 * @param {*} role profileId résolu serveur.
 * @returns {Verdict}
 */
function peutSupprimerBonConso(role) {
  return peutModifierArticle(role);
}

module.exports = {
  peutModifierArticle,
  peutFusionnerArticles,
  peutSupprimerBonConso,
  ROLE_CATALOGUE,
  ROLE_SUPERVISEUR,
  REFUS,
};
