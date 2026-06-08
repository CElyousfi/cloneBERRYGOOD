/**
 * movementImpact.js — Helper pur : l'impact stock d'un mouvement (stock_movement)
 * est-il CENSÉ être appliqué sur les soldes live ?
 *
 * Réplique exacte de la condition appliquée par les sites d'appel de
 * `applyStockImpact(...)` dans functions/index.js :
 *
 *   1. create-movement (~8853) : impact immédiat SEULEMENT pour les types
 *      auto-validés (sortie / transfert / consommation), créés en status
 *      'valide_chef'. Les réceptions sont créées en 'en_attente_achats' SANS
 *      impact.
 *   2. validate-movement, réception (~8908-8951) : l'impact d'une réception
 *      n'est posé qu'après validation/valorisation Achats, quand le status
 *      passe à 'valide_chef'.
 *   3. validate-movement, chemin legacy (~8959-8985) : chef valide depuis
 *      'valide_mag' / 'valide_achats' → status 'valide_chef' → impact appliqué.
 *   4. reject-movement (~9002) : status 'rejete' → jamais d'impact.
 *   5. import CANEVA (buildMovementDoc, ~8518/8532) : réception/sortie créées
 *      en 'valide_chef' ; transfert/consommation créés en 'valide_mag'. Ces
 *      transfert/consommation 'valide_mag' produisent un delta réel sur les
 *      soldes (movementDelta est agnostique au statut) et DOIVENT compter dans
 *      le recompte (cf. action migrate-auto-validate ~9211 qui confirme que
 *      valide_mag transfert/consommation est un statut impactant en prod).
 *
 * => Réception : impact posé SEULEMENT après validation Achats → statut final
 *    'valide_chef'. Les statuts intermédiaires 'en_attente_achats' /
 *    'valide_mag' / 'valide_achats' ne portent PAS d'impact pour une réception.
 *    sortie / transfert / consommation : impactants en live ('valide_chef') ET
 *    en import CANEVA ('valide_mag'), + chemin legacy 'valide_achats'.
 *    Un mouvement 'rejete' ou soft-deleted (deleted:true / status 'supprime')
 *    n'a jamais d'impact.
 *
 * Utilisé par rebuildBalances (import CANEVA) pour ne sommer que les
 * mouvements réellement impactants — sinon les réceptions non encore validées
 * gonflent les soldes reconstruits, et les transfert/consommation CANEVA
 * 'valide_mag' exclus à tort sous-comptent les soldes.
 */
// @ts-check
'use strict';

var stockMovementGuard = require('./movementGuard');

/** Statut « validé » live : statut final unique portant l'impact stock. */
var IMPACT_STATUS = stockMovementGuard.VALIDATED_STATUS; // 'valide_chef'

/**
 * L'impact stock de ce mouvement est-il appliqué sur les soldes ?
 * Faux si soft-deleted ou rejeté. Pour une réception : vrai SSI status
 * 'valide_chef' (impact posé après validation Achats). Pour sortie / transfert
 * / consommation : vrai en 'valide_chef' (live), 'valide_mag' (import CANEVA)
 * ou 'valide_achats' (chemin legacy). Défensif : type/status manquants → false.
 * @param {{type?:string, status?:string, deleted?:boolean}} mData
 * @returns {boolean}
 */
function isImpactApplied(mData) {
  if (!mData) return false;
  if (stockMovementGuard.isDeletedMovement(mData)) return false; // soft-deleted
  if (mData.status === 'rejete') return false; // rejeté
  // Réception : impact posé SEULEMENT après validation Achats → 'valide_chef'.
  if (mData.type === 'reception') return mData.status === IMPACT_STATUS;
  // sortie / transfert / consommation : impactants en live (valide_chef)
  // ET en import CANEVA (valide_mag), + chemin legacy valide_achats.
  return mData.status === IMPACT_STATUS
      || mData.status === 'valide_mag'
      || mData.status === 'valide_achats';
}

module.exports = { isImpactApplied, IMPACT_STATUS }
