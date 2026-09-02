'use strict';
// @ts-check

/**
 * prixLigne.js — Module PUR : choix du prix d'acquisition d'une ligne de
 * réception.
 *
 * AUCUN accès Firestore, aucune lecture de fichier : toutes les données
 * arrivent en argument (injection de dépendances). Le branchement Firestore
 * vit dans functions/index.js.
 *
 * HIÉRARCHIE (sous-ensemble ordonné de valuationPMP.SOURCE_PRIORITY) :
 *   facture  >  bon_commande  >  bon_entree
 * `inventaire` n'est pas alimentable depuis Firestore (le classeur d'ouverture
 * est absent du dépôt) : il n'est volontairement pas branché ici.
 *
 * DEUX RÈGLES NON NÉGOCIABLES :
 *  1. JAMAIS de prix à zéro par défaut. Un prix nul, négatif ou illisible ne
 *     vaut PAS prix : la source est écartée et on descend la hiérarchie. Si
 *     aucune source ne donne un prix strictement positif, la ligne entre en
 *     stock NON VALORISÉE (prix_unitaire absent, motif tracé). Un zéro
 *     ressemble à un vrai chiffre ; une absence assumée se voit et se corrige.
 *  2. REFUS PLUTÔT QUE DEVINETTE sur les unités — mais UNE UNITÉ ABSENTE N'EST
 *     PAS UNE UNITÉ DIVERGENTE. Si les deux unités sont CONNUES et diffèrent
 *     (facture en KG, stock en L), aucune densité n'est fabriquée : la source
 *     est REFUSÉE et le refus est tracé. Si l'une des deux MANQUE, il n'y a rien
 *     à convertir donc rien à deviner : le prix est retenu, et la ligne porte
 *     `prix_unite_verifiee: false` pour dire que la vérification était
 *     impossible. Seule la tonne est convertie, car c'est exact (T→KG : qté
 *     ×1000, PU ÷1000).
 *
 *     Corollaire : PERSONNE NE FABRIQUE D'UNITÉ. Inventer un « kg » par défaut
 *     puis s'en servir comme critère de refus se mordait la queue — c'est ce qui
 *     faisait perdre le prix de 219 des 270 bons de commande recevables.
 *
 * INVARIANTE DE CONSERVATION : `valoriserLignes` retourne EXACTEMENT autant de
 * lignes qu'il en reçoit, dans le même ordre. Une ligne entre en stock
 * valorisée ou non valorisée — jamais rien d'autre, jamais disparue.
 */

const { canon, canonUnite, isTonne } = require('../stock/pmpDetail');
const { parsePrice } = require('../stock/valuationPMP');
const { normalizeArticleName } = require('../stockMerge/articleMerge');

/**
 * Clé de rapprochement d'un nom d'article entre une réception, un BDC et une
 * facture.
 *
 * Le rapprochement historique de `create-bl` comparait les noms en minuscules,
 * à l'égalité stricte : « Nitrate de Chaux » et « NITRATE DE CHAUX » se
 * rapprochaient, mais pas « Urée » et « UREE », ni « MAP (KG) » et « MAP ».
 * Un rapprochement manqué = une ligne non valorisée.
 *
 * On compose donc les deux normalisations déjà éprouvées du dépôt, sans en
 * réécrire aucune :
 *  - `canon` (stock/pmpDetail) : MAJUSCULES, espaces réduits, suffixe d'unité
 *    « (L) / (KG) / … » retiré ;
 *  - `normalizeArticleName` (stockMerge/articleMerge) : minuscules, diacritiques
 *    retirés (NFD), espaces réduits — la normalisation qui fait foi pour la
 *    détection de doublons du catalogue.
 *
 * @param {*} nom
 * @returns {string} clé de rapprochement (minuscules, sans accent, sans suffixe d'unité)
 */
function cleArticle(nom) {
  return normalizeArticleName(canon(nom));
}

/**
 * Ordre de priorité des sources réellement alimentables depuis Firestore.
 * @type {string[]}
 */
const SOURCES_PRIORITE = ['facture', 'bon_commande', 'bon_entree'];

/** Motifs d'absence de prix (valeurs écrites dans `prix_motif`). */
const MOTIF = {
  AUCUNE_SOURCE: 'aucune_source',
  ARTICLE_ABSENT: 'article_absent_des_sources',
  UNITE_DIVERGENTE: 'unite_divergente',
  PRIX_NON_POSITIF: 'prix_non_positif',
  PRIX_NON_CALCULABLE: 'prix_non_calculable',
};

/**
 * @typedef {Object} LigneSource
 * @property {string} [article]        libellé de l'article dans la source
 * @property {*} [unite]               unité de la source
 * @property {*} [prix_unitaire]       prix brut (nombre ou chaîne)
 * @property {*} [quantite]            quantité (pondération)
 * @property {string} [reference]      n° de facture / de BDC (traçabilité)
 */

/**
 * @typedef {Object} ResolutionPrix
 * @property {number|null} prix_unitaire  prix retenu (> 0) ou null
 * @property {string|null} source         'facture' | 'bon_commande' | 'bon_entree' | null
 * @property {string|null} reference      n° du document porteur du prix
 * @property {string} motif               '' si valorisé, sinon cause de l'absence
 * @property {boolean} unite_verifiee     false si les unités n'ont pas pu être comparées
 * @property {Array<{source:string, motif:string, unite_source:string, unite_stock:string}>} refus
 */

/**
 * Normalise une ligne source vers l'unité de stock : convertit la tonne
 * (qté ×1000, PU ÷1000) et renvoie l'unité canonique comparable.
 *
 * @param {LigneSource} ligneSource
 * @returns {{prix:(number|null), qte:number, unite:string}}
 */
function normaliserSource(ligneSource) {
  const l = ligneSource || {};
  let prix = parsePrice(l.prix_unitaire);
  let qte = parseFloat(String(l.quantite));
  if (!isFinite(qte) || qte <= 0) qte = 1; // pondération neutre si qté absente
  if (prix != null && isTonne(l.unite)) {
    prix = prix / 1000;
    qte = qte * 1000;
  }
  return { prix, qte, unite: canonUnite(l.unite) };
}

/**
 * Prix pondéré d'une source pour un article donné, à l'unité de stock.
 *
 * UNE UNITÉ ABSENTE N'EST PAS UNE UNITÉ DIVERGENTE.
 * « Refus plutôt que devinette » vise le cas où l'on SAIT que les deux unités
 * diffèrent (facture en KG, stock en L) : convertir demanderait une densité
 * qu'on n'a pas. Ça ne vise pas le cas où l'une des deux manque — là il n'y a
 * rien à convertir, donc rien à deviner, juste une vérification impossible.
 *
 * La distinction n'est pas théorique : 491 des 573 lignes de bons de commande
 * recevables en production (85,7 %) n'ont AUCUNE unité, et portent toutes un
 * prix. Les refuser reviendrait à ne plus valoriser 219 des 270 BDC de l'écran
 * « BDC à réceptionner » — alors que le code d'avant ce chantier recopiait
 * simplement leur prix.
 *
 * Une ligne retenue sans que les unités aient pu être comparées est signalée
 * par `unite_verifiee: false` : le prix est utilisé, et le fait qu'on n'ait pas
 * pu le vérifier reste visible.
 *
 * CONTRAT (le seul endroit où « valorisé » se décide) : `motif === ''` SI ET
 * SEULEMENT SI `prix` est un nombre FINI et strictement positif. Les appelants
 * branchent sur `motif`, jamais sur la valeur.
 *
 * @param {Array<LigneSource>} lignesSource - lignes de la source (déjà filtrées sur le fournisseur)
 * @param {string} articleCle - cleArticle() du nom d'article de la ligne de réception
 * @param {string} uniteStock - canonUnite() de l'unité de stock de la ligne
 * @returns {{prix:(number|null), reference:(string|null), motif:string, unite_source:string, unite_verifiee:boolean}}
 */
function prixPondereSource(lignesSource, articleCle, uniteStock) {
  const lignes = Array.isArray(lignesSource) ? lignesSource : [];
  const candidates = lignes.filter((l) => cleArticle(l && l.article) === articleCle);
  if (!candidates.length) {
    return { prix: null, reference: null, motif: MOTIF.ARTICLE_ABSENT, unite_source: '', unite_verifiee: false };
  }

  let qSum = 0;
  let vSum = 0;
  let reference = null;
  let uniteVue = '';
  let vuLigneRetenue = false;
  let vuPrixPositif = false;
  let uniteVerifiee = true;

  for (const l of candidates) {
    const n = normaliserSource(l);
    if (n.unite) uniteVue = uniteVue || n.unite;
    if (n.prix == null || !(n.prix > 0)) continue; // jamais de zéro : source écartée
    vuPrixPositif = true;
    // DIVERGENCE (les deux unités sont connues et différentes) → refus, on ne
    // fabrique aucune densité. C'est le seul cas de refus sur l'unité.
    if (uniteStock && n.unite && n.unite !== uniteStock) continue;
    // ABSENCE d'un côté → comparaison impossible, mais le prix reste utilisable.
    if (!uniteStock || !n.unite) uniteVerifiee = false;
    vuLigneRetenue = true;
    qSum += n.qte;
    vSum += n.qte * n.prix;
    if (!reference && l.reference) reference = String(l.reference);
  }

  if (!vuPrixPositif) {
    return { prix: null, reference: null, motif: MOTIF.PRIX_NON_POSITIF, unite_source: uniteVue, unite_verifiee: false };
  }
  if (!vuLigneRetenue) {
    return { prix: null, reference: null, motif: MOTIF.UNITE_DIVERGENTE, unite_source: uniteVue, unite_verifiee: false };
  }

  const pondere = vSum / qSum;
  // Un pondéré non fini n'est PAS un prix. Cas réel bien qu'improbable : des
  // quantités énormes font déborder vSum/qSum à Infinity, et Infinity/Infinity
  // rend NaN. Sans cette garde, la ligne ressort `motif: ''` avec `prix: null` —
  // déclarée valorisée sans prix, exactement la classe de défaut que ce module
  // existe pour fermer.
  if (!isFinite(pondere) || !(pondere > 0)) {
    return { prix: null, reference: null, motif: MOTIF.PRIX_NON_CALCULABLE, unite_source: uniteVue, unite_verifiee: false };
  }
  return { prix: pondere, reference, motif: '', unite_source: uniteVue, unite_verifiee: uniteVerifiee };
}

/**
 * Choisit le prix d'UNE ligne de réception en descendant la hiérarchie
 * facture > bon_commande > bon_entree.
 *
 * @param {{article_nom?:string, article_ref?:string, article?:string, unite?:*, prix_unitaire?:*}} ligne
 *   ligne de réception (article + unité de stock). `prix_unitaire`, s'il est
 *   strictement positif, alimente automatiquement la source `bon_entree` :
 *   c'est le prix déjà saisi sur le bon, la source la moins prioritaire.
 * @param {{facture?:Array<LigneSource>, bon_commande?:Array<LigneSource>, bon_entree?:Array<LigneSource>}} [sources]
 * @returns {ResolutionPrix}
 */
function resolvePrixLigne(ligne, sources) {
  const l = ligne || {};
  const articleCle = cleArticle(l.article_nom || l.article_ref || l.article);
  const uniteStock = canonUnite(l.unite);
  const src = Object.assign({}, sources || {});

  // Le prix déjà porté par la ligne EST une source (bon d'entrée), la moins
  // prioritaire. Ajouté ici et pas côté appelant : impossible de l'oublier.
  const prixPorte = parsePrice(l.prix_unitaire);
  if (prixPorte != null && prixPorte > 0) {
    const propre = [{ article: l.article_nom || l.article_ref || l.article, unite: l.unite, prix_unitaire: prixPorte, quantite: 1, reference: 'bon' }];
    src.bon_entree = (src.bon_entree || []).concat(propre);
  }

  /** @type {Array<{source:string, motif:string, unite_source:string, unite_stock:string}>} */
  const refus = [];
  let motifFinal = MOTIF.AUCUNE_SOURCE;

  for (const source of SOURCES_PRIORITE) {
    const lignes = src[source];
    if (!Array.isArray(lignes) || !lignes.length) continue;
    const r = prixPondereSource(lignes, articleCle, uniteStock);
    // Contrat de prixPondereSource : motif '' <=> prix fini et > 0. On branche
    // sur le SIGNAL, pas sur la valeur, pour n'avoir qu'un seul endroit où
    // « valorisé » se décide.
    //
    // Ce commentaire a déjà affirmé qu'une seconde garde serait « jamais
    // falsifiable par un test ». C'était faux : le débordement des sommes
    // rendait motif:'' avec prix:null, et la biconditionnelle tombait. Elle est
    // rétablie par la garde isFinite() de prixPondereSource et vérifiée par un
    // balayage qui inclut désormais les extrêmes. Ne pas redéclarer une garde
    // infalsifiable sans avoir cherché le contre-exemple.
    if (r.motif === '') {
      return {
        prix_unitaire: r.prix,
        source,
        reference: r.reference,
        motif: '',
        unite_verifiee: r.unite_verifiee,
        refus,
      };
    }
    if (r.motif !== MOTIF.ARTICLE_ABSENT) {
      refus.push({ source, motif: r.motif, unite_source: r.unite_source, unite_stock: uniteStock });
      motifFinal = r.motif;
    }
  }

  return { prix_unitaire: null, source: null, reference: null, motif: motifFinal, unite_verifiee: false, refus };
}

/**
 * Valorise TOUTES les lignes d'une réception.
 *
 * INVARIANTE DE CONSERVATION : autant de lignes en sortie qu'en entrée, même
 * ordre. Une ligne non valorisée est conservée SANS champ `prix_unitaire`
 * (jamais 0, jamais null implicite) et porte `prix_motif`.
 *
 * @param {Array<Object>} lignes - items de la réception
 * @param {function(string):({facture?:Array<LigneSource>, bon_commande?:Array<LigneSource>, bon_entree?:Array<LigneSource>})} sourcesPourArticle
 *   fonction pure fournie par l'appelant : cleArticle(article) → sources de prix
 * @returns {{items:Array<Object>, resume:{total:number, valorisees:number, non_valorisees:number, non_verifiees:number, par_source:Object<string,number>, par_motif:Object<string,number>}}}
 */
function valoriserLignes(lignes, sourcesPourArticle) {
  const list = Array.isArray(lignes) ? lignes : [];
  const lookup = typeof sourcesPourArticle === 'function' ? sourcesPourArticle : function () { return {}; };
  /** @type {Object<string,number>} */
  const parSource = {};
  /** @type {Object<string,number>} */
  const parMotif = {};
  let valorisees = 0;
  let nonVerifiees = 0;

  const items = list.map((ligne) => {
    const articleCle = cleArticle(ligne && (ligne.article_nom || ligne.article_ref || ligne.article));
    const r = resolvePrixLigne(ligne, lookup(articleCle) || {});
    const out = Object.assign({}, ligne);
    // Même contrat que prixPondereSource : motif '' <=> prix retenu.
    if (r.motif === '') {
      out.prix_unitaire = r.prix_unitaire;
      out.prix_source = r.source;
      out.prix_reference = r.reference || '';
      // Le prix est retenu, mais les unités n'ont pas pu être comparées (l'une
      // des deux manque). Tracé sur la ligne : utiliser un prix invérifiable est
      // un choix, le taire n'en serait pas un.
      if (r.unite_verifiee === false) {
        out.prix_unite_verifiee = false;
        nonVerifiees += 1;
      } else {
        // Le `delete` compte : une ligne DÉJÀ valorisée peut être re-valorisée
        // (l'arrivée d'une facture recalcule le PMP rétroactivement, cf. spec §C).
        // Sans lui, un drapeau posé au premier passage survivrait à une seconde
        // valorisation pourtant vérifiable, et gonflerait le compte à jamais.
        delete out.prix_unite_verifiee;
      }
      delete out.prix_motif;
      valorisees += 1;
      parSource[String(r.source)] = (parSource[String(r.source)] || 0) + 1;
    } else {
      // Non valorisée : on RETIRE tout prix résiduel (un 0 hérité est un faux chiffre).
      delete out.prix_unitaire;
      out.prix_source = null;
      out.prix_motif = r.motif;
      parMotif[r.motif] = (parMotif[r.motif] || 0) + 1;
    }
    return out;
  });

  return {
    items,
    resume: {
      total: items.length,
      valorisees,
      non_valorisees: items.length - valorisees,
      // Lignes valorisées dont l'unité n'a PAS pu être comparée. Compté ici pour
      // que le chiffre existe là où on le lit, et pas seulement sur la ligne :
      // 86 % du flux porte ce drapeau, l'écrire sans jamais l'agréger revient à
      // ne pas l'écrire.
      non_verifiees: nonVerifiees,
      par_source: parSource,
      par_motif: parMotif,
    },
  };
}

module.exports = {
  SOURCES_PRIORITE,
  MOTIF,
  cleArticle,
  normaliserSource,
  prixPondereSource,
  resolvePrixLigne,
  valoriserLignes,
};
