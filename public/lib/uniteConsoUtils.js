/**
 * uniteConsoUtils.js — conversion « unité de consommation → unité de stock »
 * pour les bons de consommation.
 *
 * LE PROBLÈME, MESURÉ : sur 648 lignes de consommation, 87 (13,4 %) sont
 * saisies dans une unité qui n'est PAS celle où le stock est tenu. Les cas
 * dominants sont légitimes (Acide Nitrique acheté au KG et dosé au L : 41
 * lignes, Acide Phosphorique 20, Rhizo amine 8, M-K-P 5, Rhizo Humus 3) —
 * ce sont des liquides achetés au poids et dosés au volume, pratique normale
 * en fertigation. Ce qui ne l'est pas : le système retirait « 5 L » d'un stock
 * tenu en kilos, sans rien convertir.
 *
 * LA FICHE ARTICLE porte donc deux champs OPTIONNELS :
 *   - `unite_consommation`            : l'unité dans laquelle on dose (ex. L)
 *   - `stock_par_unite_consommation`  : combien d'unités de STOCK vaut UNE
 *                                       unité de CONSOMMATION.
 *
 * ⚠️ LE SENS DU FACTEUR EST DANS SON NOM, et c'est délibéré. Un champ nommé
 * `facteur_conversion` valant 1.4 est illisible à six mois et sera inversé par
 * le premier lecteur (1,4 L par kg ? 1,4 kg par L ?). Lu comme une phrase,
 * `stock_par_unite_consommation` ne laisse aucun choix :
 *     « 1 <unité de consommation> = X <unité de stock> »
 *     Acide Nitrique : 1 L = 1,4 KG  →  consommer 5 L déduit 7 KG.
 * C'est cette phrase, et pas le nombre nu, qui est affichée à l'écran.
 *
 * FAIL-CLOSED — la règle centrale :
 *   - unités identiques                          → aucune conversion, quantité inchangée ;
 *   - unités différentes + facteur > 0           → conversion ;
 *   - unités différentes + facteur absent / nul /
 *     négatif / illisible / fiches en désaccord  → ON NE CONVERTIT PAS ET ON NE
 *                                                  DEVINE PAS. La ligne est
 *                                                  marquée NON CONVERTIBLE.
 * Aucune table de densités par défaut n'existe ici et il ne faut pas en créer :
 * une densité est propre au produit. En inventer une serait le patron « prix à
 * zéro par défaut » qu'on a passé deux jours à éliminer ailleurs dans ce dépôt.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ───────────────────────────────────────────
 * Il convertit la quantité DÉDUITE DU STOCK, et rien d'autre. La VALORISATION
 * (écran Campagne : functions/lib/consoBons/bonsToConsoRows.js →
 * functions/lib/valorisation/consoValorisation.js) lit toujours `item.quantite`
 * et `item.unite`, c'est-à-dire la SAISIE, et la multiplie par un PMP exprimé
 * dans l'unité de STOCK. Pour 5 L d'acide nitrique (1 L = 1,32 KG) le solde est
 * désormais juste (6,6 kg retirés) mais le coût reste calculé sur 5 : il est
 * sous-estimé de 32 %. Propager la conversion au coût est un chantier séparé,
 * au backlog (validé par Omar). Ne pas lire ce module comme s'il l'avait déjà
 * fait.
 *
 * Une ligne non convertible n'est PAS bloquée (décision d'Omar) : elle est
 * déduite telle quelle — comportement d'avant, strictement — mais SIGNALÉE, au
 * moment de la saisie et sur le bon enregistré. Même esprit que les
 * « articles non valorisés » de l'écran Campagne : ce qu'on ne sait pas
 * traiter se voit, au lieu d'être absorbé en silence.
 *
 * Chargé deux fois :
 *   - navigateur via <script src="lib/uniteConsoUtils.js"> → window.UniteConsoUtils
 *   - node:test via require('./uniteConsoUtils.js')        → module.exports
 *
 * ⚠️ COPIE STRICTE dans functions/lib/uniteConso/conversionUnite.js.
 * Duplication VOLONTAIRE : le backend ne doit JAMAIS require('../public/…')
 * (Firebase ne déploie que functions/ → Cannot find module au chargement de
 * TOUTES les Cloud Functions). L'égalité de comportement entre les deux copies
 * est verrouillée par tests/unit/uniteConsoUtils.test.js.
 *
 * Scope global partagé (script classique) : tout est enfermé dans une IIFE et
 * les symboles internes sont préfixés `UCU_` → aucune collision possible avec
 * app.jsx ou un autre public/lib/*.js (cf. crash React #200 connu).
 */
// @ts-check
'use strict';

(function () {
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

  if (typeof module !== 'undefined' && module.exports) module.exports = UCU_api;
  if (typeof window !== 'undefined') window.UniteConsoUtils = UCU_api;
})();
