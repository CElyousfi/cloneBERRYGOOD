'use strict';
// @ts-check

/**
 * receptionBdc.js — Module PUR : construit les lignes de la réception (bon
 * d'entrée) à partir d'un bon de livraison et du bon de commande lié.
 *
 * AUCUN accès Firestore : `create-bl` (functions/index.js) lui passe le BL et
 * le BDC déjà lus, et écrit le résultat. Ce fichier existe pour que le
 * BRANCHEMENT soit testable, et pas seulement le choix du prix : c'est
 * précisément à la jointure que se logeait le défaut d'origine
 * (`prix_unitaire: bdcItem ? (parseFloat(...) || 0) : 0`, deux zéros par
 * défaut, functions/index.js:7566 avant ce chantier).
 *
 * CE QUI A CHANGÉ :
 *  - le prix n'est plus recopié du BDC par une égalité stricte de noms en
 *    minuscules — c'est `prixLigne` qui décide, avec la normalisation d'article
 *    qui fait foi sur ce dépôt ;
 *  - une ligne sans prix exploitable entre en stock NON valorisée, avec son
 *    motif. Jamais de zéro : un stock valorisé à zéro ressemble à un vrai
 *    chiffre, une absence assumée se voit et se corrige.
 */

const { valoriserLignes, cleArticle } = require('./prixLigne');

/**
 * Lignes de stock à créer depuis les lignes du bon de livraison.
 *
 * Seules les lignes réellement reçues (quantité > 0) deviennent des lignes de
 * stock : une ligne commandée mais non livrée n'entre pas en stock. C'est le
 * SEUL filtrage légitime — aucun filtrage sur le prix (cf. invariante de
 * conservation de prixLigne).
 *
 * @param {Array<{article?:string, quantite_recue?:*, unite?:*}>} blItems
 * @returns {Array<{article_ref:string, article_nom:string, quantite:number, unite:string}>}
 */
function lignesDepuisBl(blItems) {
  const list = Array.isArray(blItems) ? blItems : [];
  return list
    .map((it) => ({
      // ⚠️ `article_ref` porte ici le LIBELLÉ du bon de livraison, PAS une
      // identité. Ce module est PUR : il n'a pas le catalogue, il ne peut donc
      // pas résoudre. C'est `create-bl` qui substitue le docId de la fiche
      // (lib/stock/identiteArticle) AVANT d'écrire le mouvement et d'appliquer
      // l'impact stock.
      // Une RÉCEPTION N'EST JAMAIS REFUSÉE pour un article inconnu (décision
      // d'Omar) : la ligne vient d'un BDC déjà validé par le DG. `create-bl`
      // ne lui passe que les lignes dont l'identité est résolue ; les autres
      // sont reçues, écartées du stock et signalées.
      // Ne jamais écrire ces lignes telles quelles dans `stock_balances` :
      // c'est ce chemin-là qui rangeait le solde sous le nom, à côté de celui
      // rangé sous la référence.
      article_ref: (it && it.article) || '',
      article_nom: (it && it.article) || '',
      quantite: parseFloat(String(it && it.quantite_recue)) || 0,
      // AUCUNE unité fabriquée. Un « kg » inventé ici redevenait ensuite un
      // critère de refus dans prixLigne : le prix du BDC était perdu pour
      // divergence avec une unité qu'on venait d'inventer. Unité absente =
      // chaîne vide, et la comparaison se déclare impossible plutôt que fausse.
      unite: (it && it.unite) || '',
    }))
    .filter((it) => it.quantite > 0);
}

/**
 * Lignes de prix `bon_commande` extraites du BDC lié.
 *
 * @param {{numero?:string, items?:Array<{article?:string, unite?:*, prix_unitaire?:*, quantite?:*}>}} bdc
 * @returns {Array<{article:string, unite:*, prix_unitaire:*, quantite:*, reference:string}>}
 */
function sourcesPrixDepuisBdc(bdc) {
  const b = bdc || {};
  const items = Array.isArray(b.items) ? b.items : [];
  return items.map((bi) => ({
    article: (bi && bi.article) || '',
    unite: bi && bi.unite,
    prix_unitaire: bi && bi.prix_unitaire,
    quantite: bi && bi.quantite,
    reference: b.numero || '',
  }));
}

/**
 * Valorise des lignes DÉJÀ au format stock (`article_ref` / `article_nom` /
 * `quantite` / `unite`).
 *
 * C'est le point d'entrée de `create-movement`, qui construit ses lignes
 * lui-même. Les deux chemins de création d'une réception (`create-bl` et
 * `create-movement`) traversent ainsi la MÊME décision de prix : une seule
 * règle dans le dépôt, aucune divergence silencieuse possible.
 *
 * `bdc` peut être null : une réception sans bon de commande n'a aucune source
 * de prix, ses lignes entrent en stock non valorisées. Jamais un zéro.
 *
 * @param {Array<Object>} lignes - lignes au format stock
 * @param {Object|null} [bdc] - bon de commande lié, s'il y en a un
 * @param {{facture?:Array<Object>}} [autresSources]
 * @returns {{items:Array<Object>, resume:{total:number, valorisees:number, non_valorisees:number, non_verifiees:number, par_source:Object<string,number>, par_motif:Object<string,number>}}}
 */
function valoriserItemsReception(lignes, bdc, autresSources) {
  const bonCommande = sourcesPrixDepuisBdc(bdc);
  const extra = autresSources || {};
  const facture = Array.isArray(extra.facture) ? extra.facture : [];
  return valoriserLignes(lignes, () => ({ facture, bon_commande: bonCommande }));
}

/**
 * Construit les lignes valorisées de la réception issue d'un BDC.
 *
 * @param {Array<Object>} blItems - lignes du bon de livraison
 * @param {Object} bdc - bon de commande lié (déjà lu depuis Firestore)
 * @param {{facture?:Array<Object>}} [autresSources] - sources supplémentaires
 *   (les factures fournisseur, branchées dans un lot ultérieur). La forme est
 *   déjà celle attendue : rien à changer ici le jour venu.
 * @returns {{items:Array<Object>, resume:{total:number, valorisees:number, non_valorisees:number, non_verifiees:number, par_source:Object<string,number>, par_motif:Object<string,number>}}}
 */
function construireItemsReception(blItems, bdc, autresSources) {
  return valoriserItemsReception(lignesDepuisBl(blItems), bdc, autresSources);
}

/**
 * Résout le magasin de destination d'une réception.
 *
 * Le magasin demandé prime ; à défaut, la ferme du BDC. La règle vit ICI et pas
 * dans le monolithe : une destination vide écrite dans `lieu_destination.id`
 * fait qu'`applyStockImpact` ne crédite AUCUN solde, alors que la réception est
 * écrite en `valide_chef`, donc déclarée impactante. Les soldes divergeraient du
 * grand livre sans le moindre signal.
 *
 * @param {*} magasinDemande - magasin explicitement choisi à la saisie
 * @param {{ferme?:string}} [bdc] - bon de commande lié (sa ferme sert de défaut)
 * @returns {string} magasin de destination, '' si indéterminable
 */
function resoudreMagasinDestination(magasinDemande, bdc) {
  const demande = magasinDemande == null ? '' : String(magasinDemande).trim();
  if (demande) return demande;
  const ferme = bdc && bdc.ferme != null ? String(bdc.ferme).trim() : '';
  return ferme;
}

/**
 * Statut d'une réception à la création.
 *
 * `valide_chef` = le statut qui porte l'impact stock (cf. stock/movementImpact).
 * La réception d'un BDC entre en stock IMMÉDIATEMENT : le BDC est déjà validé
 * par le DG, et l'étape Achats qui retenait la marchandise est supprimée.
 *
 * Constante exportée plutôt qu'écrite en dur dans le monolithe : c'est une
 * décision métier, elle doit vivre là où elle est testée.
 * @type {string}
 */
const STATUT_RECEPTION_A_LA_CREATION = 'valide_chef';

/**
 * Construit le document `stock_movements` COMPLET d'une réception issue d'un BDC.
 *
 * Toutes les décisions (quelles lignes, quel prix, quel statut) sont prises ici,
 * en code pur et testé. `create-bl` ne fait plus que deux choses avec ce
 * résultat : l'écrire dans Firestore, et appliquer l'impact stock. Rien de ce
 * qui se décide n'est laissé au monolithe.
 *
 * Retourne `null` si aucune ligne n'a été réellement reçue — il n'y a alors
 * aucune réception à créer.
 *
 * @param {Object} params
 * @param {string} params.numero - numéro BR déjà alloué
 * @param {Array<Object>} params.blItems - lignes du bon de livraison
 * @param {Object} params.bdc - bon de commande lié
 * @param {*} [params.magasinDemande] - magasin choisi à la saisie ; à défaut, la ferme du BDC
 * @param {string} params.bdcId
 * @param {string} params.blId
 * @param {string} [params.date]
 * @param {string} [params.refBlFournisseur]
 * @param {string|null} [params.scanUrl]
 * @param {Object} [params.createdBy]
 * @param {number} [params.maintenant] - horodatage injecté (testabilité)
 * @param {{facture?:Array<Object>}} [params.autresSources]
 * @returns {Object|null} document stock_movements prêt à écrire
 */
function construireMouvementReception(params) {
  const p = params || {};
  const valo = construireItemsReception(p.blItems, p.bdc, p.autresSources);
  if (!valo.items.length) return null;

  // Destination résolue ICI, jamais reçue toute faite : une destination vide
  // produit un mouvement déclaré impactant qui ne crédite aucun solde.
  const magasin = resoudreMagasinDestination(p.magasinDemande, p.bdc);
  if (!magasin) {
    throw new Error(
      'Destination de réception indéterminable : aucun magasin choisi et le bon de commande ne porte pas de ferme.'
    );
  }

  const at = typeof p.maintenant === 'number' ? p.maintenant : Date.now();
  const createdBy = p.createdBy || {};
  return {
    numero: p.numero,
    type: 'reception',
    date: p.date || new Date(at).toISOString().split('T')[0],
    lieu_source: null,
    lieu_destination: { type: 'magasin', id: magasin },
    ferme: magasin,
    items: valo.items,
    ref_bl_fournisseur: p.refBlFournisseur || '',
    bdc_id: p.bdcId || null,
    bl_id: p.blId || null,
    // `reception_libre` / `reception_libre_motif` ne sont plus écrits : la
    // réception libre est supprimée, toute réception exige un bon de commande.
    ref_bon_physique: '',
    sortie_type: null,
    scan_url: p.scanUrl || null,
    status: STATUT_RECEPTION_A_LA_CREATION,
    validations: {
      magasinier: { by: createdBy.userId || '', name: createdBy.name || '', at },
    },
    // Traçabilité de la valorisation automatique : combien de lignes ont reçu un
    // prix, depuis quelle source, et pourquoi les autres n'en ont pas.
    valorisation: valo.resume,
    rejection: null,
    created_by: createdBy,
    created_at: at,
    updated_at: at,
  };
}

module.exports = {
  STATUT_RECEPTION_A_LA_CREATION,
  cleArticle,
  lignesDepuisBl,
  sourcesPrixDepuisBdc,
  resoudreMagasinDestination,
  valoriserItemsReception,
  construireItemsReception,
  construireMouvementReception,
};
