/**
 * bdcReceptionUtils.js — Pure helper for computing per-article delivery
 * (réception BDC) data: reçu / reliquat / statut, from a BDC's items and
 * its delivery_notes (BL).
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/bdcReceptionUtils.js"> → exposes
 *     window.BdcReceptionUtils
 *   - In node:test via require('./bdcReceptionUtils.js') → exposes
 *     module.exports
 *
 * Extracted from AchatsBDCTab.getDeliveryData (public/app.jsx, Sprint BDC
 * réception) so the same logic can be reused by MagBdcReceptionTab (plafond
 * de réception par article) and MagBonsCommandeTab (popup lecture seule
 * reçu/reliquat) without duplication.
 *
 * @typedef {Object} BdcItem
 * @property {string} [article]
 * @property {number|string} [quantite]
 * @property {string} [unite]
 *
 * @typedef {Object} BlItem
 * @property {string} [article]
 * @property {number} [quantite_recue]
 *
 * @typedef {Object} Bl
 * @property {BlItem[]} [items]
 *
 * @typedef {Object} DeliveryDataRow
 * @property {string} article
 * @property {string} unite
 * @property {number} qCmd
 * @property {number} qLiv
 * @property {number} reste
 * @property {number} pct
 * @property {'livre'|'partiel'|'en_attente'} statut
 *
 * @typedef {Object} ListBlOkResult
 * @property {true} ok
 * @property {Bl[]} data
 *
 * @typedef {Object} ListBlErrorResult
 * @property {false} ok
 * @property {string} error
 *
 * @typedef {Object} ReceptionMovementItem
 * @property {string} [article_ref]
 * @property {string} [article_nom]
 * @property {number} [quantite]
 * @property {string} [unite]
 *
 * @typedef {Object} ReceptionMovement
 * @property {string} [id]
 * @property {string} [numero]
 * @property {string} [date]
 * @property {number} [created_at]
 * @property {string} [bdc_id]
 * @property {ReceptionMovementItem[]} [items]
 *
 * @typedef {Object} ReceptionRowArticle
 * @property {string} article
 * @property {string} unite
 * @property {number} quantite_recue
 * @property {number} reliquat_apres
 *
 * @typedef {Object} ReceptionRow
 * @property {string} [numero]
 * @property {string} [date]
 * @property {ReceptionRowArticle[]} articles
 */
// @ts-check
'use strict';

// IIFE d'isolation : tout le corps du module vit dans cette fonction pour
// qu'AUCUN identifiant top-level (computeDeliveryData, __api, …) ne fuie
// dans le scope lexical global partagé par les <script> classiques de
// public/lib/. Sans ça, `const __api` entre en collision avec
// caisseUtils.js → erreur "Identifier '__api' has already been declared"
// au boot → React #200 en cascade (cf. incident commit 1754a64, et son
// premier fix dans encaissementsCanevas.js). Les exports passent par
// window/module en fin d'IIFE. TOUT nouveau fichier public/lib/ doit
// suivre ce même pattern.
(function () {

/**
 * Calcule, pour chaque article d'un BDC, la quantité commandée, reçue
 * (somme des BL existants) et le reliquat (reste à recevoir).
 *
 * @param {BdcItem[]} bdcItems
 * @param {Bl[]} bls
 * @returns {DeliveryDataRow[]}
 */
function computeDeliveryData(bdcItems, bls) {
  const received = {};
  (bls || []).forEach((bl) => (bl.items || []).forEach((it) => {
    received[it.article] = (received[it.article] || 0) + (it.quantite_recue || 0);
  }));
  return (bdcItems || []).map((it) => {
    const qCmd = parseFloat(it.quantite) || 0;
    const qLiv = received[it.article] || 0;
    const reste = Math.max(0, Math.round((qCmd - qLiv) * 100) / 100);
    const pct = qCmd > 0 ? Math.min(100, Math.round((qLiv / qCmd) * 100)) : 0;
    const statut = pct >= 100 ? 'livre' : pct > 0 ? 'partiel' : 'en_attente';
    return { article: it.article, unite: it.unite || 'kg', qCmd, qLiv, reste, pct, statut };
  });
}

/**
 * Calcule l'écart entre la quantité reçue saisie et le reliquat restant
 * à recevoir sur cet article (PAS la quantité commandée totale — bug
 * BDC-2026-0142 : recevoir exactement le reliquat doit afficher Écart=0,
 * pas "quantité reçue - quantité commandée totale").
 *
 * Fallback sur quantiteCommandee UNIQUEMENT si reliquat est indisponible
 * (NaN) — cas déjà normalement bloqué en amont par
 * resolveDeliveryDataOrError/blFormError, gardé ici par robustesse
 * défensive.
 *
 * @param {number|string} quantiteRecue
 * @param {number|string} reliquat
 * @param {number|string} [quantiteCommandee]
 * @returns {number}
 */
function computeReceptionEcart(quantiteRecue, reliquat, quantiteCommandee) {
  const recue = parseFloat(quantiteRecue) || 0;
  const rel = parseFloat(reliquat);
  const base = !isNaN(rel) ? rel : (parseFloat(quantiteCommandee) || 0);
  return recue - base;
}

/**
 * Clampe une saisie de "quantité reçue" au reliquat de la ligne, pour
 * empêcher une sur-réception en temps réel (pas seulement au submit).
 * Ne clampe QUE si reliquat ET la valeur saisie sont tous deux des
 * nombres valides ET que la valeur dépasse strictement le reliquat.
 * Laisse passer tel quel : chaîne vide, saisie en cours non numérique
 * (isNaN), valeur <= reliquat, reliquat indisponible (NaN).
 *
 * @param {string} value - valeur brute du champ (peut être '', 'abc', ...)
 * @param {number|string} reliquat
 * @returns {string}
 */
function clampReceivedQty(value, reliquat) {
  const rel = parseFloat(reliquat);
  const val = parseFloat(value);
  if (isNaN(rel) || isNaN(val)) return value;
  if (val < 0) return '0';
  if (val > rel) return String(rel);
  return value;
}

/**
 * Décide, à partir de la réponse JSON brute de /api/stock?action=list-bl,
 * si les BL reçus sont fiables (reliquat calculable) ou si l'appel a
 * échoué — auquel cas il ne faut JAMAIS retomber sur une liste vide
 * silencieuse (ça affiche à tort un reliquat = quantité commandée,
 * cf. bug BDC-2026-0142 : Reçu=0/Reliquat=100% alors que le BDC était
 * reçu à 95%). Utilisé par MagBdcReceptionTab et MagBonsCommandeTab
 * pour partager la même décision au lieu du pattern dupliqué
 * `json.success ? (json.bls || []) : []`.
 *
 * @param {any} json - réponse JSON de list-bl (peut être null/undefined
 *   si le fetch a rejeté avant de parser une réponse).
 * @returns {ListBlOkResult|ListBlErrorResult}
 */
function resolveDeliveryDataOrError(json) {
  if (json && json.success) {
    return { ok: true, data: json.bls || [] };
  }
  const error = (json && json.error) || 'Impossible de charger les réceptions déjà faites pour ce BDC — reliquat indisponible.';
  return { ok: false, error };
}

/**
 * Filtre les mouvements de stock (`stock_movements`, réponse brute de
 * `/api/stock?action=list-movements&type=reception`) pour ne garder que ceux
 * rattachés à un BDC donné (`bdc_id`), triés par date décroissante (les
 * réceptions les plus récentes en premier). Utilisé par la popup lecture
 * seule MagBonsCommandeTab pour afficher les Bons de Réception (BR-XXXX)
 * ayant produit le Reçu/Reliquat calculé par computeDeliveryData — un BR
 * (stock_movements/reception) est un document distinct du BL
 * (delivery_notes) mais les deux sont créés ensemble par create-bl et
 * partagent le même bdc_id.
 *
 * `date` est une string 'YYYY-MM-DD' (tri lexical valide) ; `created_at` sert
 * de départage si deux mouvements ont la même date.
 *
 * @param {ReceptionMovement[]} movements
 * @param {string} bdcId
 * @returns {ReceptionMovement[]}
 */
function filterReceptionsForBdc(movements, bdcId) {
  return (movements || [])
    .filter((m) => m && m.bdc_id === bdcId)
    .slice()
    .sort((a, b) => {
      const dateA = a.date || '';
      const dateB = b.date || '';
      if (dateA !== dateB) return dateA < dateB ? 1 : -1;
      return (b.created_at || 0) - (a.created_at || 0);
    });
}

/**
 * Calcule, pour chaque Bon de Réception (BR) rattaché à un BDC, le reliquat
 * restant PAR ARTICLE juste après cette réception — calcul cumulatif fait en
 * ordre CHRONOLOGIQUE ASCENDANT (le plus ancien BR en premier, pour que
 * l'accumulation soit correcte), puis restitué dans l'ordre d'AFFICHAGE
 * voulu par la popup (le plus récent en premier — cohérent avec
 * `filterReceptionsForBdc`).
 *
 * Un même BR peut réceptionner plusieurs articles à la fois : chaque ligne
 * de résultat correspond à UN SEUL BR ("le BR en une ligne", demande Omar)
 * et porte un tableau `articles` (un élément par article touché par ce BR),
 * avec le reliquat cumulatif propre à cet article (trajectoire indépendante
 * par article).
 *
 * Réutilise `filterReceptionsForBdc` en amont : cette fonction ne filtre ni
 * ne déduplique par bdc_id — elle suppose que `receptions` est déjà la
 * liste des mouvements du BDC concerné (peu importe l'ordre d'entrée, elle
 * re-trie elle-même en interne).
 *
 * @param {BdcItem[]} bdcItems
 * @param {ReceptionMovement[]} receptions
 * @returns {ReceptionRow[]}
 */
function computeReceptionRowsWithReliquat(bdcItems, receptions) {
  const qCmdByArticle = {};
  (bdcItems || []).forEach((it) => {
    qCmdByArticle[it.article] = parseFloat(it.quantite) || 0;
  });

  const chronological = (receptions || []).slice().sort((a, b) => {
    const dateA = a.date || '';
    const dateB = b.date || '';
    if (dateA !== dateB) return dateA < dateB ? -1 : 1;
    return (a.created_at || 0) - (b.created_at || 0);
  });

  const cumulByArticle = {};
  const rowsChronological = chronological.map((mv) => {
    const articles = (mv.items || []).map((it) => {
      const key = it.article_ref || it.article_nom || '';
      const qty = it.quantite || 0;
      cumulByArticle[key] = (cumulByArticle[key] || 0) + qty;
      const qCmd = qCmdByArticle[key] || 0;
      const reliquatApres = Math.max(0, Math.round((qCmd - cumulByArticle[key]) * 100) / 100);
      return {
        article: it.article_nom || it.article_ref || '—',
        unite: it.unite || '',
        quantite_recue: qty,
        reliquat_apres: reliquatApres,
      };
    });
    return { numero: mv.numero, date: mv.date, articles };
  });

  return rowsChronological.slice().reverse();
}

/**
 * Message de confirmation après création d'une réception.
 *
 * Les deux onglets annonçaient « En attente de valorisation Achats ». Cette
 * étape n'existe plus : la marchandise entre en stock immédiatement. Laisser ce
 * message reviendrait à faire attendre le magasinier pour une validation qui ne
 * viendra jamais — c'est précisément ce qui a laissé 59 réceptions hors stock.
 *
 * Le message DIT ce qui n'a pas été valorisé. Un article entré sans prix est
 * invisible dans les coûts s'il n'est pas signalé ici : c'est le seul moment où
 * quelqu'un qui connaît la livraison a la scène sous les yeux.
 *
 * Signale DEUX choses distinctes, qu'il ne faut pas confondre :
 *  - les lignes sans prix (elles ne compteront pas dans les coûts) ;
 *  - les lignes valorisées dont l'unité n'a pas pu être comparée à celle du bon
 *    de commande. Le prix est utilisé, mais rien n'a pu confirmer qu'il porte
 *    sur la même unité. C'est le cas de 86 % du flux : l'écrire dans la base
 *    sans jamais le dire à personne reviendrait à ne pas l'écrire.
 *
 * @param {string} numero - numéro du bon créé (ex. 'BR-2026-0084')
 * @param {{total?:number, valorisees?:number, non_valorisees?:number, non_verifiees?:number}|null|undefined} valorisation
 * @returns {string}
 */
function buildReceptionCreatedMessage(numero, valorisation) {
  const base = 'Réception ' + (numero || '') + ' créée. Entrée en stock immédiate.';
  const v = valorisation || {};
  const total = parseFloat(String(v.total));
  const suffixe = isFinite(total) && total > 0 ? ' sur ' + total : '';
  let msg = base;

  const sansPrix = parseFloat(String(v.non_valorisees));
  if (isFinite(sansPrix) && sansPrix > 0) {
    const p = sansPrix > 1 ? 's' : '';
    msg += '\n\n⚠️ ' + sansPrix + ' ligne' + p + suffixe
      + ' sans prix : entrée' + p + ' en stock NON valorisée' + p + '.'
      + '\nCes quantités ne compteront pas dans les coûts tant qu\'un prix n\'est pas connu.';
  }

  const nonVerif = parseFloat(String(v.non_verifiees));
  if (isFinite(nonVerif) && nonVerif > 0) {
    const p = nonVerif > 1 ? 's' : '';
    msg += '\n\nℹ️ ' + nonVerif + ' ligne' + p + suffixe
      + ' valorisée' + p + ' sans unité au bon de commande : le prix a été repris tel quel,'
      + '\nsans qu\'on puisse vérifier qu\'il porte sur la même unité. À contrôler si le montant surprend.';
  }

  return msg;
}

// ============================================================================
// UMD-style export (browser global + CommonJS for node:test)
// ============================================================================

const __api = {
  computeDeliveryData,
  resolveDeliveryDataOrError,
  filterReceptionsForBdc,
  computeReceptionRowsWithReliquat,
  computeReceptionEcart,
  clampReceivedQty,
  buildReceptionCreatedMessage,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __api;
if (typeof window !== 'undefined') window.BdcReceptionUtils = __api;

})();
