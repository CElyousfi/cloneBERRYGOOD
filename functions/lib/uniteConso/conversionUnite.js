/**
 * conversionUnite.js — COPIE BACKEND de public/lib/uniteConsoUtils.js.
 *
 * Duplication VOLONTAIRE et documentée (cf. functions/lib/stock/scanAttachmentUtils.js) :
 * le backend ne doit JAMAIS require('../../../public/lib/...'). Firebase ne
 * déploie QUE le dossier functions/ → « Cannot find module » au chargement, et
 * ce sont TOUTES les Cloud Functions qui tombent, pas seulement celle-ci. Les
 * tests locaux ne voient pas cette panne : elle n'apparaît qu'en production.
 *
 * SOURCE DE VÉRITÉ FONCTIONNELLE : public/lib/uniteConsoUtils.js (en-tête
 * complet : pourquoi ce module existe, les 87 lignes divergentes mesurées, le
 * sens du facteur `stock_par_unite_consommation`, la règle fail-closed).
 * Toute évolution doit être répliquée des DEUX côtés ; l'égalité de
 * comportement est verrouillée par tests/unit/uniteConsoUtils.test.js, qui
 * fait passer les mêmes cas dans les deux copies — Y COMPRIS des fiches
 * HOMONYMES, d'accord et en désaccord : la règle d'ambiguïté est la seule
 * règle fail-closed non triviale du module, et une divergence silencieuse
 * entre les deux copies y ferait afficher au magasinier une conversion que le
 * serveur n'applique pas.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ───────────────────────────────────────────
 * Il convertit la quantité DÉDUITE DU STOCK, et rien d'autre. La VALORISATION
 * (functions/lib/consoBons/bonsToConsoRows.js → lib/valorisation/consoValorisation.js)
 * lit toujours la quantité SAISIE et la multiplie par un PMP exprimé dans
 * l'unité de STOCK : pour 5 L d'acide nitrique (1 L = 1,32 KG), le solde est
 * juste mais le coût reste sous-estimé de 32 %. Chantier séparé, au backlog
 * (validé par Omar).
 *
 * Module PUR : aucune lecture Firestore, aucune dépendance, injectable.
 */
// @ts-check
'use strict';

/** Champ « unité dans laquelle l'article est consommé » sur la fiche. */
var UCU_CHAMP_UNITE = 'unite_consommation';
/** Champ « 1 unité de consommation = X unités de stock ». */
var UCU_CHAMP_FACTEUR = 'stock_par_unite_consommation';

/** Motifs de verdict. Codes INTERNES : jamais affichés bruts à l'écran. */
var UCU_MOTIFS = {
  IDENTIQUE: 'unites_identiques',
  CONVERTI: 'conversion_appliquee',
  ARTICLE_INCONNU: 'article_inconnu',
  ARTICLE_AMBIGU: 'article_ambigu',
  FACTEUR_ABSENT: 'facteur_absent',
  FACTEUR_INVALIDE: 'facteur_invalide',
  QUANTITE_INVALIDE: 'quantite_invalide',
};

/** Décimales conservées sur une quantité convertie (bruit flottant). */
var UCU_DECIMALS = 6;

/**
 * @param {number} n
 * @returns {number}
 */
function UCU_round(n) {
  var f = Math.pow(10, UCU_DECIMALS);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Forme comparable d'une unité : « KG », « kg » et « Kg  » sont la MÊME
 * unité (le catalogue mélange les trois orthographes).
 * @param {*} u
 * @returns {string}
 */
function UCU_normaliserUnite(u) {
  if (u === null || u === undefined) return '';
  return String(u).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Lit un facteur de conversion. Renvoie `null` — et JAMAIS une valeur de
 * repli — dès que le nombre est absent, nul, négatif ou illisible.
 * La virgule décimale est acceptée (saisie française).
 * @param {*} v
 * @returns {number|null}
 */
function UCU_lireFacteur(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return null;
  var n = typeof v === 'number' ? v : parseFloat(String(v).trim().replace(',', '.'));
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Unité de STOCK d'une fiche (celle où le solde est tenu).
 * @param {*} article
 * @returns {string} unité telle qu'écrite sur la fiche ('' si absente)
 */
function UCU_uniteStock(article) {
  if (!article || typeof article !== 'object') return '';
  return article.unite === null || article.unite === undefined ? '' : String(article.unite).trim();
}

/**
 * Unité de CONSOMMATION d'une fiche ('' si non renseignée : on consomme
 * alors dans l'unité de stock et rien ne change).
 * @param {*} article
 * @returns {string}
 */
function UCU_uniteConsommation(article) {
  if (!article || typeof article !== 'object') return '';
  var u = article[UCU_CHAMP_UNITE];
  return u === null || u === undefined ? '' : String(u).trim();
}

/**
 * Unités qu'un magasinier a le droit de choisir pour cet article : l'unité
 * de stock, et l'unité de consommation SI elle existe et diffère. Rien
 * d'autre — le choix libre est précisément ce qui a produit les 87 lignes
 * divergentes.
 * Article inconnu du catalogue → tableau VIDE : l'appelant décide alors quoi
 * proposer (ici, on ne sait rien, on n'invente rien).
 * @param {*} article
 * @returns {string[]}
 */
function UCU_unitesSaisissables(article) {
  var stock = UCU_uniteStock(article);
  if (!stock) return [];
  var conso = UCU_uniteConsommation(article);
  if (!conso || UCU_normaliserUnite(conso) === UCU_normaliserUnite(stock)) return [stock];
  return [stock, conso];
}

/**
 * La conversion écrite en toutes lettres : « 1 L = 1.4 KG ». Renvoie '' si
 * l'article n'a pas de conversion exploitable — on n'affiche jamais une
 * phrase à moitié vraie.
 * @param {*} article
 * @returns {string}
 */
function UCU_phraseConversion(article) {
  var stock = UCU_uniteStock(article);
  var conso = UCU_uniteConsommation(article);
  if (!stock || !conso) return '';
  if (UCU_normaliserUnite(conso) === UCU_normaliserUnite(stock)) return '';
  var f = UCU_lireFacteur(article ? article[UCU_CHAMP_FACTEUR] : null);
  if (f === null) return '';
  return '1 ' + conso + ' = ' + String(f) + ' ' + stock;
}

/**
 * @typedef {Object} VerdictConversion
 * @property {boolean} convertible  false → la ligne doit être SIGNALÉE.
 * @property {boolean} converti     true → une conversion a été appliquée.
 * @property {number|null} quantite_stock quantité en unité de STOCK.
 * @property {string} unite_stock
 * @property {string} unite_saisie
 * @property {number|null} facteur
 * @property {string} motif         code interne (UCU_MOTIFS).
 * @property {string} message       phrase lisible ('' si convertible).
 */

/**
 * Convertit une ligne saisie vers l'unité de stock de son article.
 *
 * @param {{article?:*, quantite?:*, unite?:*}} ligne ligne du bon.
 * @param {*} article fiche catalogue (null/undefined = inconnue).
 * @returns {VerdictConversion}
 */
function UCU_convertirQuantite(ligne, article) {
  var l = ligne || {};
  var nom = l.article === null || l.article === undefined ? '' : String(l.article).trim();
  var uniteSaisie = l.unite === null || l.unite === undefined ? '' : String(l.unite).trim();
  var qte = typeof l.quantite === 'number' ? l.quantite : parseFloat(String(l.quantite == null ? '' : l.quantite).replace(',', '.'));
  var uniteStock = UCU_uniteStock(article);

  var base = {
    convertible: false, converti: false, quantite_stock: null,
    unite_stock: uniteStock, unite_saisie: uniteSaisie,
    facteur: null, motif: '', message: '',
  };

  if (!isFinite(qte)) {
    base.motif = UCU_MOTIFS.QUANTITE_INVALIDE;
    base.message = (nom || 'Article') + ' : quantité illisible, aucune conversion possible.';
    return base;
  }
  if (!article || !uniteStock) {
    // Article absent du catalogue : on ne connaît même pas son unité de
    // stock. Rien à convertir, rien à deviner.
    base.motif = UCU_MOTIFS.ARTICLE_INCONNU;
    base.message = (nom || 'Article') + ' : article absent du catalogue, l\'unité de stock est inconnue.';
    return base;
  }
  if (UCU_normaliserUnite(uniteSaisie) === UCU_normaliserUnite(uniteStock) || !uniteSaisie) {
    // Unités identiques (ou unité non précisée : on suppose l'unité de
    // stock, comme aujourd'hui) → AUCUNE conversion. Appliquer un facteur
    // ici fausserait 549 lignes sur 648, celles qui vont bien.
    base.convertible = true;
    base.quantite_stock = UCU_round(qte);
    base.unite_saisie = uniteSaisie || uniteStock;
    base.motif = UCU_MOTIFS.IDENTIQUE;
    return base;
  }

  var facteur = UCU_lireFacteur(article[UCU_CHAMP_FACTEUR]);
  var uniteConso = UCU_uniteConsommation(article);
  var brut = article[UCU_CHAMP_FACTEUR];

  if (!uniteConso || UCU_normaliserUnite(uniteConso) !== UCU_normaliserUnite(uniteSaisie) || facteur === null) {
    base.motif = (brut === null || brut === undefined || brut === '')
      ? UCU_MOTIFS.FACTEUR_ABSENT
      : (facteur === null ? UCU_MOTIFS.FACTEUR_INVALIDE : UCU_MOTIFS.FACTEUR_ABSENT);
    base.message = (nom || 'Article') + ' : saisi en ' + uniteSaisie + ', stock tenu en ' + uniteStock
      + ' — conversion non renseignée sur la fiche article. La quantité est déduite telle quelle.';
    return base;
  }

  base.convertible = true;
  base.converti = true;
  base.facteur = facteur;
  base.quantite_stock = UCU_round(qte * facteur);
  base.motif = UCU_MOTIFS.CONVERTI;
  return base;
}

/**
 * Clé de rapprochement d'un nom d'article (le catalogue porte ~105 paires de
 * doublons : le nom est la seule jointure disponible depuis un bon).
 * @param {*} nom
 * @returns {string}
 */
function UCU_canonNom(nom) {
  if (nom === null || nom === undefined) return '';
  return String(nom).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Index nom canonique → fiche de conversion. Deux fiches homonymes qui
 * DIVERGENT sur la conversion rendent l'article AMBIGU (fail-closed) plutôt
 * que d'en élire une au hasard ; deux fiches homonymes d'accord entre elles
 * sont traitées comme une seule.
 * @param {Array<*>} articles
 * @returns {Object<string,*>}
 */
function UCU_indexerArticles(articles) {
  var index = {};
  var liste = Array.isArray(articles) ? articles : [];
  for (var i = 0; i < liste.length; i++) {
    var a = liste[i];
    if (!a || typeof a !== 'object') continue;
    var k = UCU_canonNom(a.nom);
    if (!k) continue;
    var fiche = {
      unite: UCU_uniteStock(a),
      ambigu: false,
    };
    fiche[UCU_CHAMP_UNITE] = UCU_uniteConsommation(a);
    fiche[UCU_CHAMP_FACTEUR] = UCU_lireFacteur(a[UCU_CHAMP_FACTEUR]);
    var deja = index[k];
    if (!deja) { index[k] = fiche; continue; }
    if (deja.ambigu) continue;
    var memeConfig = UCU_normaliserUnite(deja.unite) === UCU_normaliserUnite(fiche.unite)
      && UCU_normaliserUnite(deja[UCU_CHAMP_UNITE]) === UCU_normaliserUnite(fiche[UCU_CHAMP_UNITE])
      && deja[UCU_CHAMP_FACTEUR] === fiche[UCU_CHAMP_FACTEUR];
    if (!memeConfig) index[k] = { unite: '', ambigu: true };
  }
  return index;
}

/**
 * Fiche de conversion d'un nom d'article, ou null si inconnu/ambigu.
 * @param {Object<string,*>} index
 * @param {*} nom
 * @returns {*}
 */
function UCU_trouverArticle(index, nom) {
  var a = index ? index[UCU_canonNom(nom)] : null;
  if (!a || a.ambigu) return null;
  return a;
}

/**
 * Vrai si `nom` désigne PLUSIEURS fiches qui se contredisent sur la
 * conversion. À distinguer d'un article inconnu : ici la fiche existe, elle
 * est seulement en double et en désaccord — et c'est réparable (renseigner
 * la même conversion sur les deux). Dire « article absent du catalogue »
 * enverrait le magasinier chercher un problème qui n'existe pas.
 * @param {Object<string,*>} index
 * @param {*} nom
 * @returns {boolean}
 */
function UCU_estAmbigu(index, nom) {
  var a = index ? index[UCU_canonNom(nom)] : null;
  return !!(a && a.ambigu);
}

/**
 * Verdict de conversion pour CHAQUE ligne d'un bon, + la liste de celles qui
 * ne sont pas convertibles (celle qu'on affiche et qu'on persiste).
 * @param {Array<*>} items lignes du bon.
 * @param {Object<string,*>} index index produit par `indexerArticles`.
 * @returns {{lignes: Array<*>, non_convertibles: Array<*>}}
 */
function UCU_analyserLignes(items, index) {
  var lignes = [];
  var non = [];
  var liste = Array.isArray(items) ? items : [];
  for (var i = 0; i < liste.length; i++) {
    var it = liste[i] || {};
    var v = UCU_convertirQuantite(it, UCU_trouverArticle(index, it.article));
    lignes.push(v);
    if (!v.convertible) {
      non.push({
        article: it.article === null || it.article === undefined ? '' : String(it.article),
        quantite: typeof it.quantite === 'number' ? it.quantite : parseFloat(String(it.quantite == null ? '' : it.quantite).replace(',', '.')) || 0,
        unite_saisie: v.unite_saisie,
        unite_stock: v.unite_stock,
        motif: v.motif,
        message: v.message,
      });
    }
  }
  return { lignes: lignes, non_convertibles: non };
}

var UCU_api = {
  CHAMP_UNITE_CONSOMMATION: UCU_CHAMP_UNITE,
  CHAMP_FACTEUR: UCU_CHAMP_FACTEUR,
  MOTIFS: UCU_MOTIFS,
  normaliserUnite: UCU_normaliserUnite,
  lireFacteur: UCU_lireFacteur,
  uniteStock: UCU_uniteStock,
  uniteConsommation: UCU_uniteConsommation,
  unitesSaisissables: UCU_unitesSaisissables,
  phraseConversion: UCU_phraseConversion,
  convertirQuantite: UCU_convertirQuantite,
  canonNom: UCU_canonNom,
  indexerArticles: UCU_indexerArticles,
  trouverArticle: UCU_trouverArticle,
  estAmbigu: UCU_estAmbigu,
  analyserLignes: UCU_analyserLignes,
};

module.exports = UCU_api;
