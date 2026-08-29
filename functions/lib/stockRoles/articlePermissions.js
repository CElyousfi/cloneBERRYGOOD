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

/** Profil qui saisit les bons de consommation, et donc les corrige. */
const ROLE_MAGASINIER = 'magasinier';

/**
 * Refus propre à `delete-bc` : la population y est PLUS LARGE que celle du
 * catalogue, le message doit donc nommer les trois profils. Réutiliser `REFUS`
 * aurait menti à l'utilisateur (« réservé achats ou DG » alors que le
 * magasinier passe) — exactement le mensonge corrigé en en-tête de ce fichier.
 */
const REFUS_SUPPRESSION_BC = 'Réservé au magasinier, au responsable achats ou au DG';

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
 * POPULATION PLUS LARGE que `peutModifierArticle` : `achats`, `dg` ET
 * `magasinier`. C'est un ÉLARGISSEMENT ASSUMÉ du 2026-08-29 (demande explicite
 * d'Omar), qui inverse la règle livrée en PR #353. Celle-ci s'alignait sur les
 * réceptions (« le magasinier ne défait pas son propre bon ») ; mais le
 * magasinier est justement celui qui repère son doublon dans la seconde, et le
 * faire passer par le DG ajoutait un délai sans rien sécuriser.
 *
 * Ce qui compense le risque n'est PAS une garde de rôle plus stricte : c'est le
 * motif obligatoire, la trace (qui/quand/pourquoi), le soft-delete réversible,
 * et — côté interface seulement — une double confirmation demandée au
 * magasinier. ⚠️ Cette double confirmation est une protection d'ERGONOMIE :
 * elle vit dans MagBCTab.jsx et n'a AUCUN équivalent serveur. Ne jamais la
 * transformer en drapeau envoyé par le client et vérifié ici : un drapeau
 * client est usurpable et ne donnerait qu'une fausse impression de sûreté.
 *
 * Export DÉDIÉ plutôt qu'un alias, pour la même raison que
 * `peutFusionnerArticles` — et cette fois la divergence est RÉELLE : le
 * magasinier supprime un bon sans pour autant pouvoir écrire au catalogue.
 *
 * Le rôle DOIT être celui résolu SERVEUR (`resolveCallerRole`), jamais lu dans
 * le body.
 *
 * @param {*} role profileId résolu serveur.
 * @returns {Verdict}
 */
function peutSupprimerBonConso(role) {
  const r = typeof role === 'string' ? role : '';
  if (r === ROLE_CATALOGUE || r === ROLE_SUPERVISEUR || r === ROLE_MAGASINIER) {
    return { ok: true, raison: '' };
  }
  return { ok: false, raison: REFUS_SUPPRESSION_BC };
}

module.exports = {
  peutModifierArticle,
  peutFusionnerArticles,
  peutSupprimerBonConso,
  ROLE_CATALOGUE,
  ROLE_SUPERVISEUR,
  ROLE_MAGASINIER,
  REFUS,
  REFUS_SUPPRESSION_BC,
};
