// @ts-check
'use strict';

/**
 * stockGuard.js — Helper PUR (sans accès Firestore) : un mouvement de stock
 * peut-il être créé sans rendre un solde négatif au lieu de départ ?
 *
 * Périmètre (item « Contrôle stock avant sortie ») : on bloque uniquement les
 * SORTIES et TRANSFERTS quand le stock disponible de l'article au lieu de départ
 * est insuffisant. Les RÉCEPTIONS (ajout de stock) et la CONSOMMATION (hors
 * périmètre pour l'instant) sont exemptées.
 *
 * La source de vérité reste le backend : ce module ne fait QUE de l'arithmétique
 * sur une map de soldes fournie par l'appelant.
 */

/** Types de mouvement gardés par défaut (stock décrémenté au lieu de départ). */
var DEFAULT_GUARDED_TYPES = ['sortie', 'transfert'];

/**
 * Vérifie la disponibilité du stock pour les articles d'un mouvement.
 *
 * @param {{type:string, items:Array<{article_ref?:string, article_nom?:string, quantite:(number|string), unite?:string}>}} movement
 *   mouvement à créer (type + lignes article).
 * @param {Record<string, number>} availableByRef
 *   map article_ref -> solde disponible au lieu de départ (number).
 * @param {{guardedTypes?: string[]}} [opts]
 *   options ; `guardedTypes` permet de surcharger les types contrôlés.
 * @returns {{allowed: boolean, error?: string, offending?: Array<{article_ref:string, article_nom:string, disponible:number, demande:number}>}}
 */
function checkStockAvailability(movement, availableByRef, opts) {
  var guardedTypes = (opts && opts.guardedTypes) || DEFAULT_GUARDED_TYPES;
  /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
  var mov = movement || {};
  var type = mov.type;

  // Type non gardé (reception, consommation, …) → exempté.
  if (guardedTypes.indexOf(type) === -1) {
    return { allowed: true };
  }

  var balances = availableByRef || {};
  var items = mov.items || [];
  var offending = [];

  for (var i = 0; i < items.length; i++) {
    var it = items[i] || {};
    var demande = parseFloat(/** @type {*} */ (it.quantite)) || 0;
    // Ligne sans quantité réelle (0 ou négative) → ignorée.
    if (demande <= 0) continue;
    var ref = it.article_ref || '';
    var disponible = balances[ref] || 0;
    if (demande > disponible) {
      offending.push({
        article_ref: ref,
        article_nom: it.article_nom || ref,
        disponible: disponible,
        demande: demande,
      });
    }
  }

  if (offending.length === 0) {
    return { allowed: true };
  }

  var messages = offending.map(function (o) {
    var label = o.article_nom || o.article_ref;
    return 'Stock insuffisant pour ' + label + ' : ' + o.disponible + ' disponible, ' + o.demande + ' demandé';
  });

  return {
    allowed: false,
    error: messages.join(' ; '),
    offending: offending,
  };
}

// ============================================================================
// UMD-style export (CommonJS pour node:test / backend ; global navigateur).
// ============================================================================

var __stockGuardApi = {
  DEFAULT_GUARDED_TYPES: DEFAULT_GUARDED_TYPES,
  checkStockAvailability: checkStockAvailability,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __stockGuardApi
if (typeof window !== 'undefined') window.StockGuard = __stockGuardApi
