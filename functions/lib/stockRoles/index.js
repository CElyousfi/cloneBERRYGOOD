'use strict';
// @ts-check

/**
 * stockRoles — point d'entrée du module « droits d'écriture sur le catalogue
 * d'articles » (ticket sb/classer-depuis-bandeau).
 *
 * - `peutModifierArticle` : la règle de rôle (`achats` ou `dg`), extraite du
 *   monolithe SANS être modifiée — ni élargie, ni restreinte.
 * - `fichesAClasserParNom` : toutes les fiches actives d'un même nom normalisé,
 *   parce que le catalogue contient des doublons et qu'en reclasser une seule
 *   laisse l'article « à classer ».
 */

const {
  peutModifierArticle,
  ROLE_CATALOGUE,
  ROLE_SUPERVISEUR,
  REFUS,
} = require('./articlePermissions');
const { fichesAClasserParNom, referencesAClasserParNom } = require('./articleClassement');

module.exports = {
  peutModifierArticle,
  fichesAClasserParNom,
  referencesAClasserParNom,
  ROLE_CATALOGUE,
  ROLE_SUPERVISEUR,
  REFUS,
};
