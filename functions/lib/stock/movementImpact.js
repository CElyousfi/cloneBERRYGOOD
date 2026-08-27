/**
 * movementImpact.js — Helper pur : l'impact stock d'un mouvement (stock_movement)
 * est-il CENSÉ être appliqué sur les soldes live ?
 *
 * Réplique exacte de la condition appliquée par les sites d'appel de
 * `applyStockImpact(...)` dans functions/index.js :
 *
 *   1. create-movement : TOUS les types, réceptions comprises, sont créés en
 *      'valide_chef' avec impact stock IMMÉDIAT. L'impact y est appliqué SI ET
 *      SEULEMENT SI `isImpactApplied` le dit — cette fonction n'est donc plus
 *      une réplique de la condition, elle EST la condition.
 *   1 bis. create-bl : depuis la suppression de l'étape Achats, la réception
 *      issue d'un BDC est créée en 'valide_chef', valorisée automatiquement,
 *      avec impact stock IMMÉDIAT.
 *   2. validate-movement, réception : CHEMIN DE REPRISE des réceptions restées
 *      en 'en_attente_achats' en production (62 au 27/08/2026 ; le compte
 *      AUGMENTE tant que le correctif n'est pas déployé, puisque create-bl en
 *      produisait encore). Leur impact n'est posé qu'à la validation, quand le
 *      status passe à 'valide_chef'.
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
 * => Réception : le statut porteur d'impact est 'valide_chef', posé désormais
 *    DÈS LA CRÉATION. Les statuts 'en_attente_achats' / 'valide_mag' /
 *    'valide_achats' ne portent PAS d'impact pour une réception — c'est ce qui
 *    rend les réceptions bloquées repérables, et leur reprise calculable.
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
