'use strict';

// @ts-check

/**
 * articleKey.js — SOURCE UNIQUE de la clé d'article du domaine stock.
 *
 * Le dépôt portait quatre copies de la même canonicalisation (pmpDetail.js,
 * scripts/reconstruct-stock.js, canonArt dans public/app.jsx,
 * normalizeArticleName dans stockMerge/articleMerge.js — cette dernière SANS le
 * suffixe d'unité). Deux écrans voisins pouvaient donc interroger le grand livre
 * avec deux clés différentes : le solde tombait dans un seau, ses mouvements dans
 * un autre, et la pop-up « Détail des mouvements » affichait « Aucun mouvement »
 * pour un article qui en avait onze.
 *
 * Règle (celle de pmpDetail.js, la seule qui retire le suffixe d'unité) :
 *   MAJUSCULE + espaces réduits + suffixe « (L|KG|G|ML|UNITE|U) » final retiré.
 * C'est ce dernier point qui fait tomber `ACIDE PHOSPHORIQUE (L)` et
 * `Acide Phosphorique` dans le MÊME seau.
 *
 * Module PUR : aucun accès Firestore, aucun effet de bord.
 */

/**
 * Canonicalise un libellé/référence d'article en clé de matching.
 * @param {*} a valeur brute (nom, référence, docId…)
 * @returns {string} clé canonique ('' si absente)
 */
function canon(a) {
  let s = (a == null ? '' : String(a)).toUpperCase().trim();
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/, '');
  return s.trim();
}

/**
 * Clé d'interrogation du grand livre pour une ligne de solde (stock_balances).
 *
 * Le NOM prime sur la référence : les mouvements portent le nom d'article
 * (bons front, bons de consommation, reconstruct-stock), alors que le solde d'un
 * article FUSIONNÉ porte le docId de sa fiche maître (ex. `Ref-Eng0052`), qui
 * n'existe dans aucun mouvement. `get-pmp-detail` applique déjà cette priorité
 * (functions/index.js, `articleNom || articleRef`) et ne souffre pas du défaut.
 *
 * @param {{article_nom?: *, article_ref?: *}} balance ligne de solde
 * @returns {string} paramètre `article` à envoyer à get-article-history ('' si vide)
 */
function articleHistoryKey(balance) {
  const b = balance || {};
  const nom = b.article_nom == null ? '' : String(b.article_nom).trim();
  const ref = b.article_ref == null ? '' : String(b.article_ref).trim();
  return nom || ref || '';
}

module.exports = { canon, articleHistoryKey }
