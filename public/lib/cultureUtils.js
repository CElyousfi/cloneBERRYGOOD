/**
 * cultureUtils.js — Pure helpers de résolution de la CULTURE d'une parcelle.
 *
 * Loaded twice (UMD-bricolé) :
 *   - Browser : <script src="lib/cultureUtils.js"> → window.CultureUtils
 *   - node:test / backend : require('.../cultureUtils.js') → module.exports
 *
 * Source unique de vérité pour « quelle culture porte cette parcelle ? ».
 * Règle de résolution (resolveCulture) :
 *   1. référentiel Smart Berry (`sbMap[LABEL].culture_sb`) s'il est renseigné —
 *      c'est la donnée saisie à la main, elle fait autorité ;
 *   2. sinon repli heuristique `normCulture` (regex sur la culture BEE ONE, à
 *      défaut sur le libellé de la parcelle), défaut 'Framboise'.
 *
 * ⚠️ PIÈGE — ne JAMAIS déduire la culture de `entry.nom_sb`. Le nom Smart Berry
 * est un nom d'usage, pas une culture : cas réel en prod, la parcelle
 * 'S12 - YAZMIN…' (framboise) est nommée 'MYRTILLE EXTENSION' côté Smart Berry.
 * Une regex sur `nom_sb` la classerait à tort en Myrtille. Seuls `culture_sb`
 * (explicite) et le repli `normCulture` sont autorisés.
 *
 * Toutes les fonctions sont pures (no DOM, no network, no Firestore) : `sbMap`
 * est TOUJOURS injecté en paramètre, jamais lu depuis `window` (même discipline
 * que PRT_filterRows). Tolérance : entrées null/undefined, champs manquants,
 * valeurs non-string → aucun throw.
 *
 * IMPORTANT (mémoire #75 — collision global a déjà cassé l'app) : ce module
 * n'expose QU'UN SEUL global (`window.CultureUtils`). Les const internes sont
 * préfixées `__cult_` pour éviter toute collision dans le scope global partagé
 * par les <script> non-modulaires.
 */
// @ts-check
'use strict';

// ============================================================================
// CONSTANTS (préfixe interne unique __cult_ — jamais exposées au global)
// ============================================================================

/** Cultures reconnues — mêmes valeurs que CULTURES_SB_VALIDES (functions/pointageService.js). */
const __cult_CULTURES = ['Framboise', 'Myrtille', 'Avocatier'];

/** Culture par défaut quand rien ne permet de trancher (comportement historique). */
const __cult_DEFAUT = 'Framboise';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Heuristique historique : déduit la culture d'un champ culture BEE ONE, à
 * défaut du libellé de la parcelle. COPIE CONFORME du helper local de
 * public/components/ParcellesReferentielTab.jsx (défaut 'Framboise' inclus) —
 * comportement volontairement inchangé.
 *
 * @param {*} cultureField   champ culture (BEE ONE), éventuellement vide
 * @param {*} [labelFallback] libellé de parcelle utilisé si la culture est vide
 * @returns {string} 'Framboise' | 'Myrtille' | 'Avocatier'
 */
function normCulture(cultureField, labelFallback) {
  const src = String(cultureField || labelFallback || '').toUpperCase();
  if (!src) return __cult_DEFAUT;
  if (/MYRTILL|BLUEBERRY|CORINA|CASCADE|BREEZE/.test(src)) return 'Myrtille';
  if (/AVOCAT|AVOCADO|HAAS|BACON/.test(src)) return 'Avocatier';
  return __cult_DEFAUT;
}

/**
 * Culture d'une parcelle : référentiel Smart Berry prioritaire, sinon repli
 * heuristique.
 *
 * La clé du référentiel est le libellé BEE ONE normalisé (MAJUSCULES, trim) —
 * `parcelle.label` ou son alias `parcelle.Parcelle_Physique`.
 *
 * @param {*} parcelle  { label|Parcelle_Physique, culture|Culture }
 * @param {*} [sbMap]   référentiel SB { LABEL: { culture_sb, ... } } (injecté)
 * @returns {string} 'Framboise' | 'Myrtille' | 'Avocatier'
 */
function resolveCulture(parcelle, sbMap) {
  const p = parcelle || {};
  const label = p.label || p.Parcelle_Physique;
  const key = String(label || '').toUpperCase().trim();
  const entry = sbMap && key ? sbMap[key] : null;
  // Uniquement culture_sb : nom_sb n'est PAS une culture (cf. en-tête du module).
  if (entry && entry.culture_sb && String(entry.culture_sb).trim()) {
    return String(entry.culture_sb).trim();
  }
  return normCulture(p.culture || p.Culture, label);
}

/**
 * Prédicat de filtre : la parcelle correspond-elle à la culture demandée ?
 * Un filtre vide (''/null/undefined) laisse tout passer.
 *
 * @param {*} parcelle  parcelle à tester
 * @param {*} [filtre]  culture attendue ('' = pas de filtre)
 * @param {*} [sbMap]   référentiel SB (injecté)
 * @returns {boolean}
 */
function matchesCulture(parcelle, filtre, sbMap) {
  if (!filtre) return true;
  return resolveCulture(parcelle, sbMap) === filtre;
}

// ============================================================================
// UMD-bricolé : un seul global exposé (window.CultureUtils)
// ============================================================================

const __cult_api = {
  CULTURES: __cult_CULTURES,
  normCulture,
  resolveCulture,
  matchesCulture,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __cult_api;
if (typeof window !== 'undefined') window.CultureUtils = __cult_api;
