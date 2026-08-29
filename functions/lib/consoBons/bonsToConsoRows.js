'use strict';
// @ts-check

/**
 * bonsToConsoRows.js — Adaptation PURE des bons de consommation Smart Berry
 * (`consumption_vouchers`) vers la forme de ligne historiquement produite par la
 * collection miroir BEE ONE `sql_mirror_consommation`.
 *
 * CONTEXTE (décision Omar, ticket sb/conso-campagne-bons)
 * -------------------------------------------------------
 * La source BEE ONE est TARIE : `sql_mirror_consommation` ne contient plus rien
 * depuis avril 2026 (10 mois, 2025-07 → 2026-04, 0 ligne sur la campagne
 * courante). La consommation réelle est désormais saisie par le magasinier dans
 * `consumption_vouchers` (action `create-bc`). On tourne la page : les écrans de
 * consommation lisent les BONS SMART BERRY UNIQUEMENT — pas d'union avec BEE
 * ONE, pas de bascule à une date. Conséquence assumée : les campagnes
 * antérieures s'affichent vides sur ces écrans. Les données BEE ONE restent en
 * base (rien n'est supprimé).
 *
 * Ce module ne fait QUE de la transformation : aucune lecture Firestore, toutes
 * les données de contexte entrent par argument (DI), comme
 * functions/lib/irrigation/ et functions/lib/parcelleGroupes/.
 *
 * FORME DE SORTIE (contrat consommé tel quel par les agrégations existantes —
 * `aggregateConsoValorisee`, `aggregateConsoParcelle`) :
 *   { Date, Parcelle_Culturale, Article, Article_Categorie, Quantite,
 *     Article_unite, Culture, Ferme, Parcelle_sup, Bon_Id, Bon_Numero }
 *
 * DÉCISIONS DE MAPPING (chacune vérifiée sur les données réelles, 44 bons /
 * 500 items au 2026-08-26) :
 *
 *  - `Ferme` est DÉRIVÉE DU LIBELLÉ DE PARCELLE, jamais reprise de `item.ferme`.
 *    Mesuré en prod : 212 items sur 500 portent `ferme: "BERRY GOOD Farms"`
 *    (valeur fourre-tout, exactement la même pathologie que le champ `Ferme` du
 *    miroir BEE ONE), les 288 autres portent F1..F5. Un champ à moitié
 *    inexploitable ne peut pas servir de base au cloisonnement : on applique la
 *    règle UNIQUE `fermeDeParcelle` (fermeConso.js), partagée par les deux
 *    écrans de consommation, FAIL-CLOSED (libellé non dérivable → `''`, jamais
 *    rattaché à un chef).
 *
 *  - `Culture` passe par `resolveCulture` : `culture_sb` du référentiel Smart
 *    Berry en priorité, sinon repli heuristique `normCulture` sur `item.culture`
 *    puis sur le libellé de parcelle. Nécessaire : mesuré en prod, `item.culture`
 *    est vide sur 260 items /500 et sale sur le reste (« FRAMBOISE » et
 *    « Framboise », « AVOCATIER » et « Avocatier », « MYRTILLES » au pluriel).
 *    `resolveCulture` canonise en 'Framboise' | 'Myrtille' | 'Avocatier'.
 *
 *  - `Parcelle_Culturale` = `item.parcelle` TEL QUEL. C'est déjà le libellé
 *    RÉEL : `create-bc` éclate les groupes de parcelles au prorata des Ha à
 *    l'écriture (functions/index.js) et ne persiste JAMAIS un libellé de groupe.
 *
 *  - `Article_Categorie` = la catégorie DE L'ARTICLE, résolue au catalogue
 *    (`articles_catalog`) via l'index injecté `catByArticle`.
 *    ⚠️ CORRECTION 2026-08-26 (ticket sb/conso-categorie-article). Jusqu'ici ce
 *    champ valait `bon.cpc_categorie` — donc une catégorie posée sur le BON
 *    ENTIER, dérivée du type d'onglet du magasinier. Mesuré en prod : 48 bons
 *    sur 48 en `type: engrais` (le front repliait `type || 'engrais'`), l'onglet
 *    Pesticides structurellement vide, et BENEVIA — un pesticide — compté en
 *    engrais. Un même bon papier mélange légitimement les deux familles
 *    (BC-2026-0048 : BENEVIA + DEPTIL + Ammonitrate + MAP) : une catégorie par
 *    bon ne PEUT pas être juste.
 *    La catégorie n'est pas dénormalisée à l'écriture, elle est dérivée à la
 *    LECTURE : aucune migration Firestore, et une fiche catalogue corrigée
 *    reperfuse tout l'historique.
 *    `bon.type` et `bon.cpc_categorie` restent écrits et INTACTS — ils gardent
 *    la trace de ce que le magasinier a déclaré, ils ne pilotent simplement plus
 *    la classification analytique.
 *    FAIL-CLOSED : un article absent du catalogue, ou dont la clé est ambiguë,
 *    reçoit '' — il partira « à classer » (cf. aggregateParcelle.js), JAMAIS
 *    dans une famille par défaut. Le repli sur `categorieOf(bon)` ne subsiste
 *    que lorsque AUCUN index n'est injecté (appelant historique / test) : sans
 *    catalogue, on ne peut rien résoudre et l'ancien comportement vaut mieux
 *    qu'un écran vide.
 *    ⚠️ Les consommateurs doivent classer avec `familleBucket` (tolérant à la
 *    casse), JAMAIS avec une égalité stricte.
 *
 *  - Le rattachement à une CAMPAGNE se fait par la DATE DU BON (`campagneOf`) :
 *    aucun champ campagne n'est persisté sur `consumption_vouchers`. La date
 *    d'un bon est modifiable a posteriori (`update-bc-date`), donc un bon PEUT
 *    changer de campagne — c'est voulu.
 *
 * EXCLUSIONS (une ligne non émise ne doit jamais devenir une ligne à zéro) :
 *  - bon sans `items` exploitable ;
 *  - item sans parcelle (la jointure aval se fait par libellé : sans parcelle,
 *    la ligne n'est rattachable à rien) ;
 *  - item de quantité nulle, négative ou non numérique — même règle que
 *    `create-bc`, qui ne crée un mouvement de stock que pour `quantite > 0`.
 */

const { campagneOf } = require('../mappingConso/campagneUtils');
const { resolveCulture } = require('../campagneExport/cultureUtils');
const { fermeDeParcelle } = require('./fermeConso');
const { normalizeArticleName } = require('../stockMerge/articleMerge');
const { familleBucket } = require('../valorisation/consoValorisation');

/** Regex stricte d'une date ISO 'YYYY-MM-DD'. */
const __cb_ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Repli `bon.type` → catégorie CPC, quand `cpc_categorie` est absent. */
const __cb_TYPE_TO_CATEGORIE = {
  engrais: 'Engrais',
  pesticide: 'Pesticides',
};

/**
 * Normalise une valeur en chaîne trimée ('' si null/undefined/non-string).
 * @param {*} v
 * @returns {string}
 */
function __cb_str(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Catégorie CPC d'un bon : `cpc_categorie` prioritaire, repli sur `type`.
 * Retourne '' si rien n'est exploitable (la ligne sera classée « autre » par
 * `familleBucket` en aval — jamais silencieusement rangée dans Engrais).
 *
 * @param {*} bon
 * @returns {string}
 */
function categorieOf(bon) {
  const b = bon || {};
  const cat = __cb_str(b.cpc_categorie);
  if (cat) return cat;
  const type = __cb_str(b.type).toLowerCase();
  return __cb_TYPE_TO_CATEGORIE[type] || '';
}

/**
 * @typedef {Object} CatEntry
 * @property {string} categorie catégorie catalogue telle qu'écrite ('Engrais').
 * @property {('engrais'|'pesticide'|'autre')} famille bucket de `familleBucket`.
 * @property {boolean} ambigu deux fiches actives, DEUX FAMILLES différentes sur
 *   la même clé : la clé ne tranche plus jamais.
 */

/**
 * @typedef {Object} ArticleCategoryIndex
 * @property {Record<string, CatEntry>} byName clé = nom NORMALISÉ
 *   (`normalizeArticleName` : NFD + diacritiques + minuscules + espaces réduits).
 * @property {Record<string, CatEntry>} byAlnum clé « alphanumérique seule »
 *   (ponctuation retirée), consultée en SECOND recours uniquement.
 */

/**
 * Clé secondaire « alphanumérique seule » : nom normalisé dont toute la
 * ponctuation est retirée.
 *
 * Justifiée par la mesure (prod, 2026-08-26) : `M.K.P` est absent du catalogue
 * mais `M-K-P` / `MKP` y sont, en `Engrais`. Sur 1125 fiches actives, cette clé
 * produit 1003 clés dont 2 seulement sont ambiguës (`bioenergy`, `prioritop`).
 *
 * @param {*} nom
 * @returns {string}
 */
function alnumArticleKey(nom) {
  return normalizeArticleName(nom).replace(/[^a-z0-9]/g, '');
}

/**
 * Ajoute une fiche à un index, en marquant la clé AMBIGUË si elle porte déjà
 * une autre famille. Une clé ambiguë ne tranche plus jamais (fail-closed).
 *
 * @param {Record<string, CatEntry>} index
 * @param {string} key
 * @param {string} categorie
 * @param {('engrais'|'pesticide'|'autre')} famille
 * @returns {void}
 */
function __cb_addCat(index, key, categorie, famille) {
  if (!key) return;
  const prev = index[key];
  if (!prev) {
    index[key] = { categorie, famille, ambigu: false };
    return;
  }
  if (prev.famille !== famille) prev.ambigu = true;
}

/**
 * Construit l'index catalogue « nom d'article → catégorie ». PUR : c'est la
 * forme injectable de `fetchArticleCategories` (fetchBons.js), pour que
 * `conso-valorisee` — qui lit DÉJÀ `articles_catalog` pour le PMP — le
 * réutilise sans une seconde lecture Firestore.
 *
 * Seules les fiches ACTIVES comptent (`active !== false`) : une fiche
 * désactivée n'est pas une source de vérité.
 *
 * @param {Array<{nom?: string, categorie?: string, active?: boolean}>} articles
 * @returns {ArticleCategoryIndex}
 */
function buildArticleCategoryIndex(articles) {
  const list = Array.isArray(articles) ? articles : [];
  /** @type {Record<string, CatEntry>} */
  const byName = {};
  /** @type {Record<string, CatEntry>} */
  const byAlnum = {};
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    if (a.active === false) continue;
    const nom = __cb_str(a.nom);
    if (!nom) continue;
    const categorie = __cb_str(a.categorie);
    const famille = familleBucket(categorie);
    __cb_addCat(byName, normalizeArticleName(nom), categorie, famille);
    __cb_addCat(byAlnum, alnumArticleKey(nom), categorie, famille);
  }
  return { byName, byAlnum };
}

/**
 * Résout la catégorie catalogue d'un libellé d'article.
 *
 * Ordre : clé normalisée, puis clé alphanumérique. Une clé AMBIGUË (deux
 * familles) est traitée comme non résolue — jamais de devinette.
 *
 * @param {*} article libellé lu sur le bon.
 * @param {ArticleCategoryIndex} [index]
 * @returns {{categorie: string, statut: ('exact'|'alnum'|'ambigu'|'absent')}}
 */
function lookupArticleCategorie(article, index) {
  const idx = index || {};
  const byName = idx.byName || {};
  const byAlnum = idx.byAlnum || {};
  const nom = __cb_str(article);
  if (!nom) return { categorie: '', statut: 'absent' };

  const exact = byName[normalizeArticleName(nom)];
  if (exact) {
    if (exact.ambigu) return { categorie: '', statut: 'ambigu' };
    return { categorie: exact.categorie, statut: 'exact' };
  }
  const alnum = byAlnum[alnumArticleKey(nom)];
  if (alnum) {
    if (alnum.ambigu) return { categorie: '', statut: 'ambigu' };
    return { categorie: alnum.categorie, statut: 'alnum' };
  }
  return { categorie: '', statut: 'absent' };
}

/**
 * Quantité exploitable d'un item : nombre fini strictement positif, sinon null.
 * Accepte les quantités saisies en CHAÎNE ('12.5').
 *
 * @param {*} v
 * @returns {number|null}
 */
function quantiteOf(v) {
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * @typedef {Object} AdaptOptions
 * @property {Record<string, number>} [haByLabel] Ha par libellé de parcelle
 *   NORMALISÉ (MAJUSCULES + trim), depuis `sb_parcelle_referentiel`.
 * @property {Record<string, {culture_sb?: string}>} [sbMap] référentiel Smart
 *   Berry indexé par libellé normalisé, pour `resolveCulture`.
 * @property {string} [campagne] ne garder que les bons dont `campagneOf(date)`
 *   vaut ce libellé ('2026-2027').
 * @property {string} [since] borne basse inclusive 'YYYY-MM-DD'.
 * @property {string} [until] borne haute inclusive 'YYYY-MM-DD'.
 * @property {ArticleCategoryIndex} [catByArticle] index catalogue
 *   « nom d'article → catégorie » (`buildArticleCategoryIndex` /
 *   `fetchArticleCategories`). ABSENT → l'ancien comportement s'applique
 *   (catégorie du BON) ; PRÉSENT → la catégorie vient de l'ARTICLE, et un
 *   article non résolu reçoit '' (il partira « à classer »).
 */

/**
 * Transforme une liste de bons de consommation en lignes de conso (forme
 * miroir). Un item exploitable = une ligne ; l'agrégation par
 * parcelle × article est du ressort de l'appelant.
 *
 * @param {Array<Object>} bons documents `consumption_vouchers`.
 * @param {AdaptOptions} [options]
 * @returns {Array<Object>} lignes de conso.
 */
function adaptBonsToConsoRows(bons, options) {
  const list = Array.isArray(bons) ? bons : [];
  const opts = options || {};
  const haByLabel = opts.haByLabel || {};
  const sbMap = opts.sbMap || {};
  const campagne = __cb_str(opts.campagne);
  const since = __cb_str(opts.since);
  const until = __cb_str(opts.until);
  const catByArticle = opts.catByArticle || null;

  const rows = [];

  for (const bon of list) {
    if (!bon || typeof bon !== 'object') continue;

    const date = __cb_str(bon.date);
    // Date non ISO → aucune fenêtre temporelle ne peut trancher : on exclut.
    if (!__cb_ISO_DATE_RE.test(date)) continue;
    if (campagne && campagneOf(date) !== campagne) continue;
    if (since && date < since) continue;
    if (until && date > until) continue;

    // Catégorie DU BON : ne sert plus que de repli quand aucun index catalogue
    // n'est injecté (cf. en-tête).
    const categorieBon = categorieOf(bon);
    const items = Array.isArray(bon.items) ? bon.items : [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const parcelle = __cb_str(item.parcelle);
      if (!parcelle) continue;

      const quantite = quantiteOf(item.quantite);
      if (quantite === null) continue;

      const key = parcelle.toUpperCase();
      const ha = parseFloat(String(haByLabel[key]));

      const article = __cb_str(item.article);
      // La catégorie vient de l'ARTICLE dès qu'un catalogue est disponible.
      // Non résolu (absent / clé ambiguë) → '' : la ligne partira « à classer »,
      // jamais rangée d'office dans la famille déclarée sur le bon.
      const categorie = catByArticle
        ? lookupArticleCategorie(article, catByArticle).categorie
        : categorieBon;

      rows.push({
        Date: date,
        Parcelle_Culturale: parcelle,
        Article: article,
        Article_Categorie: categorie,
        // ⚠️ QUANTITÉ ET UNITÉ **SAISIES**, PAS CELLES DU STOCK — limite connue,
        // assumée, et bornée ici pour qu'on ne la découvre pas dans un écart de
        // coût. Depuis le ticket sb/unite-conversion, un article peut être
        // stocké au KG et consommé au L (acide nitrique : 1 L = 1,32 KG) : le
        // bon porte alors AUSSI `item.quantite_stock` / `item.unite_stock`, et
        // c'est cette quantité-là qui a été retirée du solde.
        // La VALORISATION, elle, lit toujours la saisie et la multiplie par un
        // PMP exprimé dans l'unité de STOCK : pour 5 L d'acide nitrique, le
        // stock est juste (6,6 kg retirés) mais le coût est sous-estimé de 32 %.
        // Basculer sur `quantite_stock` ici n'est PAS un détail — les lignes
        // antérieures au ticket n'ont pas ce champ, et les mélanger fabriquerait
        // un historique incohérent. Chantier séparé, au backlog (validé par
        // Omar). Ne pas « corriger » cette ligne sans traiter l'historique.
        Quantite: quantite,
        Article_unite: __cb_str(item.unite),
        Culture: resolveCulture({ label: parcelle, culture: item.culture }, sbMap),
        // FAIL-CLOSED : jamais `item.ferme` (fourre-tout « BERRY GOOD Farms »).
        // Règle UNIQUE partagée par les deux écrans — cf. fermeConso.js.
        Ferme: fermeDeParcelle(parcelle) || '',
        Parcelle_sup: isFinite(ha) && ha > 0 ? ha : 0,
        // Traçabilité : ignoré par les agrégations, précieux au débogage.
        Bon_Id: __cb_str(bon.id),
        Bon_Numero: __cb_str(bon.numero),
      });
    }
  }

  return rows;
}

module.exports = {
  adaptBonsToConsoRows,
  categorieOf,
  quantiteOf,
  alnumArticleKey,
  buildArticleCategoryIndex,
  lookupArticleCategorie,
};
