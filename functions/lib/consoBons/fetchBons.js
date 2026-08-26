'use strict';
// @ts-check

/**
 * fetchBons.js — Accès Firestore aux bons de consommation Smart Berry
 * (`consumption_vouchers`), avec la base de connaissance (Ha + culture_sb) que
 * l'adaptation exige.
 *
 * Seul fichier du module `consoBons` qui touche Firestore : `db` est INJECTÉ
 * (jamais requis ici) pour que les modules purs restent testables sans réseau.
 *
 * VOLUME MESURÉ (prod, 2026-08-26) : 44 documents, 500 items, ~2,5 Ko/doc,
 * soit ~108 Ko pour la collection ENTIÈRE. Une lecture complète est donc
 * largement soutenable, et elle est indispensable : le filtre de campagne porte
 * sur `date`, un champ que `create-bc` écrit en chaîne 'YYYY-MM-DD' mais qui
 * est MODIFIABLE a posteriori (`update-bc-date`). Une requête `where('date',
 * '>=', ...)` fonctionnerait, mais l'appelant met déjà le résultat en cache
 * 30 min et le gain serait nul à cette échelle. À réévaluer si la collection
 * dépasse quelques milliers de documents.
 */

const { buildArticleCategoryIndex } = require('./bonsToConsoRows');

/**
 * Lit tous les bons de consommation.
 *
 * @param {*} db instance Firestore injectée.
 * @returns {Promise<Array<Object>>} documents `{ id, ...data }`.
 */
async function fetchBonsConsommation(db) {
  const snap = await db.collection('consumption_vouchers').get();
  return snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
}

/**
 * Lit `sb_parcelle_referentiel` et en dérive les deux index nécessaires à
 * l'adaptation : Ha par libellé et référentiel de culture par libellé.
 *
 * Clé commune : `label_bee_one` NORMALISÉ (MAJUSCULES + trim), avec repli sur
 * l'id du document — même convention que `create-bc` et que
 * `campagne-conso-parcelle`.
 *
 * @param {*} db instance Firestore injectée.
 * @returns {Promise<{haByLabel: Record<string, number>, sbMap: Record<string, Object>}>}
 */
async function fetchReferentielParcelles(db) {
  const snap = await db.collection('sb_parcelle_referentiel').get();
  /** @type {Record<string, number>} */
  const haByLabel = {};
  /** @type {Record<string, Object>} */
  const sbMap = {};
  snap.forEach((doc) => {
    const d = doc.data() || {};
    const label = String(d.label_bee_one || doc.id || '').toUpperCase().trim();
    if (!label) return;
    const ha = parseFloat(d.ha);
    if (isFinite(ha) && ha > 0) haByLabel[label] = ha;
    sbMap[label] = d;
  });
  return { haByLabel, sbMap };
}

/**
 * Lit `articles_catalog` et en dérive l'index « nom d'article → catégorie »
 * consommé par `adaptBonsToConsoRows` (option `catByArticle`).
 *
 * Seules les fiches ACTIVES sont retenues (`active !== false`). Toute
 * l'arithmétique de l'index (normalisation, clé secondaire, ambiguïté) vit dans
 * le module PUR `bonsToConsoRows.buildArticleCategoryIndex` : ce wrapper ne fait
 * que la lecture Firestore. `conso-valorisee`, qui lit DÉJÀ cette collection
 * pour le PMP, appelle directement le constructeur pur — aucune seconde lecture.
 *
 * VOLUME MESURÉ (prod, 2026-08-26) : 1125 fiches actives.
 *
 * @param {*} db instance Firestore injectée.
 * @returns {Promise<import('./bonsToConsoRows').ArticleCategoryIndex>}
 */
async function fetchArticleCategories(db) {
  const snap = await db.collection('articles_catalog').get();
  const articles = [];
  snap.forEach((doc) => {
    const d = doc.data() || {};
    articles.push({ nom: d.nom, categorie: d.categorie, active: d.active });
  });
  return buildArticleCategoryIndex(articles);
}

module.exports = {
  fetchBonsConsommation,
  fetchReferentielParcelles,
  fetchArticleCategories,
};
