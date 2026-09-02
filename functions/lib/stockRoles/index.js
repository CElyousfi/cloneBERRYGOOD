'use strict';
// @ts-check

/**
 * stockRoles — point d'entrée du module « droits d'écriture sur le catalogue
 * d'articles » (ticket sb/classer-depuis-bandeau).
 *
 * - `peutModifierArticle` : la règle de rôle (`achats` ou `dg`), extraite du
 *   monolithe SANS être modifiée — ni élargie, ni restreinte.
 * - `peutFusionnerArticles` : même population, pour la fusion de doublons
 *   (`suggest-article-duplicates` / `merge-articles`), qui était verrouillée
 *   en dur sur `achats` et donc inexécutable par le DG.
 * - `fichesAClasserParNom` : toutes les fiches actives d'un même nom normalisé,
 *   parce que le catalogue contient des doublons et qu'en reclasser une seule
 *   laisse l'article « à classer ».
 */

const {
  peutModifierArticle,
  peutModifierChampsArticle,
  champsDemandes,
  peutFusionnerArticles,
  peutSupprimerBonConso,
  ROLE_CATALOGUE,
  ROLE_SUPERVISEUR,
  ROLE_MAGASINIER,
  CHAMPS_CONVERSION_UNITE,
  REFUS,
  REFUS_HORS_CONVERSION,
  REFUS_SUPPRESSION_BC,
} = require('./articlePermissions');
const { fichesAClasserParNom, referencesAClasserParNom } = require('./articleClassement');

module.exports = {
  peutModifierArticle,
  peutModifierChampsArticle,
  champsDemandes,
  peutFusionnerArticles,
  peutSupprimerBonConso,
  fichesAClasserParNom,
  referencesAClasserParNom,
  ROLE_CATALOGUE,
  ROLE_SUPERVISEUR,
  ROLE_MAGASINIER,
  CHAMPS_CONVERSION_UNITE,
  REFUS,
  REFUS_HORS_CONVERSION,
  REFUS_SUPPRESSION_BC,
};
