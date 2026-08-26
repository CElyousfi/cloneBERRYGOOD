'use strict';
// @ts-check

/**
 * articleClassement.js — Module PUR : quelles fiches `articles_catalog` doivent
 * être reclassées quand on classe un article DEPUIS SON NOM.
 *
 * POURQUOI PAR NOM, ET POURQUOI TOUTES LES FICHES
 * -----------------------------------------------
 * Le bandeau « articles à classer » de l'écran Campagne ne connaît que des NOMS
 * d'articles (ceux lus sur les bons de consommation), jamais un identifiant de
 * fiche : la résolution nom → catégorie se fait à la lecture
 * (`bonsToConsoRows.lookupArticleCategorie`), sur un index construit par nom
 * NORMALISÉ.
 *
 * Or le catalogue contient environ 105 paires de doublons (même nom normalisé,
 * deux fiches actives). Si l'on ne reclassait qu'UNE fiche :
 *   - l'autre garderait son ancienne catégorie ;
 *   - l'index amont verrait deux familles différentes sur la même clé, la
 *     marquerait AMBIGUË (fail-closed) et rendrait `categorie: ''` ;
 *   - l'article resterait donc « à classer » dans le bandeau, et la correction
 *     paraîtrait sans effet.
 * On met donc à jour TOUTES les fiches actives de même nom normalisé.
 *
 * La normalisation est celle de `stockMerge/articleMerge.normalizeArticleName`
 * (source de vérité unique, partagée avec la détection de doublons et avec
 * l'index de catégories) — elle n'est jamais réécrite ici.
 *
 * Aucune lecture Firestore : les documents entrent par argument (DI).
 */

const { normalizeArticleName } = require('../stockMerge/articleMerge');

/**
 * @typedef {Object} FicheCatalogue
 * @property {string} [id] identifiant du document (= référence).
 * @property {string} [nom]
 * @property {string} [categorie]
 * @property {boolean} [active]
 */

/**
 * Sélectionne les fiches ACTIVES dont le nom normalisé correspond à `nom`.
 *
 * Seules les fiches actives sont retenues : une fiche désactivée (fusion,
 * suppression validée) n'est pas une source de vérité pour la catégorie, et la
 * ressusciter recréerait le doublon qu'une fusion vient de fermer.
 *
 * @param {Array<FicheCatalogue>} docs documents `articles_catalog`.
 * @param {*} nom nom d'article lu sur le bon.
 * @returns {Array<FicheCatalogue>} fiches à reclasser (vide si aucune).
 */
function fichesAClasserParNom(docs, nom) {
  const cible = normalizeArticleName(nom);
  if (!cible) return [];
  const list = Array.isArray(docs) ? docs : [];
  const out = [];
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    if (d.active === false) continue;
    if (!d.id) continue;
    if (normalizeArticleName(d.nom) !== cible) continue;
    out.push(d);
  }
  return out;
}

/**
 * Identifiants des fiches à reclasser (confort d'appel côté Cloud Function).
 * @param {Array<FicheCatalogue>} docs
 * @param {*} nom
 * @returns {string[]}
 */
function referencesAClasserParNom(docs, nom) {
  return fichesAClasserParNom(docs, nom).map((d) => String(d.id));
}

module.exports = {
  fichesAClasserParNom,
  referencesAClasserParNom,
};
