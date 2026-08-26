'use strict';
// @ts-check

/**
 * aggregateParcelle.js — Agrégation PURE de lignes de conso par
 * parcelle × article, pour l'action `campagne-conso-parcelle`
 * (écran Campagne › Engrais / Pesticides).
 *
 * Extraction à l'identique du bloc inline de `functions/pointageService.js`,
 * AVEC deux corrections délibérées :
 *
 *  1. CLASSIFICATION TOLÉRANTE. L'inline comparait `cat === 'Engrais'` /
 *     `cat === 'Pesticides'` : sensible à la casse, il faisait disparaître
 *     SILENCIEUSEMENT toute variante ('engrais', 'PHYTO-SANITAIRE',
 *     'pesticides' — toutes présentes dans le catalogue réel). On passe par
 *     `familleBucket` (functions/lib/valorisation/consoValorisation.js), seule
 *     version résistante aux catégories sales.
 *
 *  2. CLOISONNEMENT PAR FERME ET PAR CULTURE. L'action est ferme-aware côté
 *     cache (`pointageCacheKey(..., _fermeFilter)`) mais ne filtrait AUCUNE
 *     ligne : personne ne l'a vu tant que l'écran renvoyait 0 parcelle. Dès
 *     lors qu'il affiche des données, un chef verrait la consommation des
 *     autres fermes. Le filtre est donc appliqué ici, FAIL-CLOSED : une
 *     parcelle dont la ferme n'est pas déterminable est EXCLUE du périmètre
 *     d'un chef. Le filtre culture existe pour `chef_f1`, dont le périmètre
 *     ferme vaut 'all' et dont le cloisonnement est purement cultural
 *     (cf. accessControl.CHEF_PROFILE_CULTURE) : sans lui, `chef_f1` verrait
 *     tout.
 *
 * Aucune lecture Firestore : Ha, dérivation de ferme et référentiel de culture
 * entrent par argument (DI).
 *
 * ⚠️ HORS PÉRIMÈTRE (décision produit séparée) : `totalEngraisCout` et
 * `totalPesticidesCout` restent figés à 0, comme dans l'implémentation
 * d'origine. Les valoriser au PMP changerait ce que l'écran AFFICHE.
 *
 * ⚠️ LIMITE CONNUE, PRÉEXISTANTE, NON INTRODUITE ICI : les quantités sont
 * cumulées SANS normalisation d'unité. Deux occurrences du même article en 'kg'
 * et en 't' s'additionneraient donc comme si l'unité était la même, et l'unité
 * affichée serait celle de la PREMIÈRE occurrence. L'agrégation valorisée de
 * `conso-valorisee` gère ce cas (`normalizeQte` convertit les tonnes en kg) ;
 * cet écran-ci ne l'a jamais fait. Sans conséquence sur les données réelles à ce
 * jour : les 500 items de `consumption_vouchers` n'utilisent que 'kg', 'l' et
 * 'L'. Corriger relève d'un ticket séparé — l'aligner ici changerait les
 * quantités affichées, donc le contenu de l'écran.
 */

const { familleBucket } = require('../valorisation/consoValorisation');
const { resolveCulture } = require('../campagneExport/cultureUtils');

/**
 * @typedef {Object} AggregateOptions
 * @property {Record<string, number>} [haByLabel] Ha par libellé NORMALISÉ
 *   (MAJUSCULES + trim), depuis `sb_parcelle_referentiel`.
 * @property {(parcelle: string) => string} [deriveFerme] dérivation de la ferme
 *   affichée. Défaut : `() => ''`.
 * @property {Record<string, {culture_sb?: string}>} [sbMap] référentiel Smart
 *   Berry pour `resolveCulture`.
 * @property {string|null} [fermeFilter] périmètre chef ('F1'|'F5'|'Avocatier'|
 *   'BAHIA'). null/'' = aucune restriction.
 * @property {string|null} [cultureFilter] périmètre cultural chef ('Framboise'|
 *   'Myrtille'). null/'' = aucune restriction.
 */

/**
 * Normalise une valeur en chaîne trimée.
 * @param {*} v
 * @returns {string}
 */
function __ap_str(v) {
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Agrège des lignes de conso par parcelle, en séparant engrais et pesticides.
 *
 * @param {Array<Object>} rows lignes `{Date, Parcelle_Culturale, Article,
 *   Article_Categorie, Quantite, Article_unite, Culture, Parcelle_sup}`.
 * @param {AggregateOptions} [options]
 * @returns {Array<Object>} parcelles `{parcelle, ferme, ha, engrais,
 *   pesticides, totalEngraisCout, totalPesticidesCout}`.
 */
function aggregateConsoParcelle(rows, options) {
  const list = Array.isArray(rows) ? rows : [];
  const opts = options || {};
  const haByLabel = opts.haByLabel || {};
  const sbMap = opts.sbMap || {};
  const deriveFerme = typeof opts.deriveFerme === 'function' ? opts.deriveFerme : function () { return ''; };
  const fermeFilter = __ap_str(opts.fermeFilter);
  const cultureFilter = __ap_str(opts.cultureFilter);

  const byParcelle = {};

  for (const row of list) {
    if (!row || typeof row !== 'object') continue;

    const parcelle = __ap_str(row.Parcelle_Culturale);
    if (!parcelle) continue;

    const famille = familleBucket(row.Article_Categorie);
    // 'autre' n'a pas de colonne sur cet écran : la ligne est ignorée.
    if (famille !== 'engrais' && famille !== 'pesticide') continue;

    const qty = parseFloat(String(row.Quantite));
    if (!isFinite(qty)) continue;

    if (!Object.prototype.hasOwnProperty.call(byParcelle, parcelle)) {
      const ferme = __ap_str(deriveFerme(parcelle));
      // Cloisonnement FAIL-CLOSED : un chef ne voit QUE sa ferme, et une
      // parcelle non dérivable ('' ou 'Autre') ne lui est jamais attribuée.
      if (fermeFilter && ferme !== fermeFilter) {
        byParcelle[parcelle] = null;
        continue;
      }
      if (cultureFilter && resolveCulture({ label: parcelle }, sbMap) !== cultureFilter) {
        byParcelle[parcelle] = null;
        continue;
      }
      const ha = parseFloat(String(haByLabel[parcelle.toUpperCase()]));
      byParcelle[parcelle] = {
        parcelle,
        ferme,
        ha: isFinite(ha) && ha > 0 ? ha : 0,
        engraisMap: {},
        pesticidesMap: {},
      };
    }
    const acc = byParcelle[parcelle];
    if (!acc) continue; // parcelle hors périmètre, déjà tranchée.

    const article = __ap_str(row.Article);
    const unite = __ap_str(row.Article_unite);
    const map = famille === 'engrais' ? acc.engraisMap : acc.pesticidesMap;
    if (!map[article]) {
      map[article] = { article, qty: 0, unite, coutTotal: 0 };
    }
    map[article].qty += qty;
  }

  return Object.keys(byParcelle)
    .map((k) => byParcelle[k])
    .filter(Boolean)
    .map((p) => ({
      parcelle: p.parcelle,
      ferme: p.ferme,
      ha: p.ha,
      engrais: Object.values(p.engraisMap).sort((a, b) => a.article.localeCompare(b.article)),
      pesticides: Object.values(p.pesticidesMap).sort((a, b) => a.article.localeCompare(b.article)),
      // Hors périmètre du ticket : la valorisation au PMP de cet écran est une
      // décision produit séparée.
      totalEngraisCout: 0,
      totalPesticidesCout: 0,
    }))
    // NB : pas de `.filter(p => p.engrais.length || p.pesticides.length)`.
    // L'implémentation d'origine en avait un, mais il est INATTEIGNABLE ici :
    // une entrée n'est créée qu'APRÈS les gardes famille et quantité, et un
    // article lui est ajouté dans la foulée — il n'existe donc aucun chemin
    // produisant une parcelle vide. Un filtre qu'aucun test ne peut exercer est
    // du bruit : la mutation qui le supprimait survivait, à juste titre.
    .sort((a, b) => a.parcelle.localeCompare(b.parcelle));
}

module.exports = {
  aggregateConsoParcelle,
};
