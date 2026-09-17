/**
 * cultureUtils.js — Pure helpers de résolution de la CULTURE d'une parcelle.
 *
 * BACKEND COPY (duplication assumée). Source de vérité fonctionnelle :
 *   public/lib/cultureUtils.js (UMD front + node:test repo-root).
 * Cette copie existe car le package déployé des Cloud Functions n'embarque QUE
 * functions/ : un require('../../../public/lib/...') depuis le backend throw
 * "Cannot find module .../public/..." au runtime et fait tomber TOUTES les
 * Cloud Functions au chargement. Le backend ne dépend JAMAIS de public/.
 * Toute évolution de la logique pure doit être répliquée des 2 côtés — le test
 * d'équivalence tests/unit/campagneExportBackend.test.js charge LES DEUX copies
 * et compare leurs sorties.
 *
 * Loaded as a plain CommonJS module from the backend :
 *   - require('./cultureUtils') → module.exports
 * (le bloc UMD de fin est conservé tel quel pour rester copie conforme ; la
 * branche window n'est jamais prise côté Node.)
 *
 * Le corps ci-dessous est une copie CONFORME de la source front : ne rien
 * réécrire ici, seulement recopier.
 *
 * ---- en-tête d'origine (source front) ----
 * Règle de résolution (resolveCulture) : référentiel Smart Berry
 * (sbMap[LABEL].culture_sb) prioritaire, sinon repli heuristique normCulture.
 * ⚠️ Ne JAMAIS déduire la culture de nom_sb (nom d'usage, pas une culture).
 */
// @ts-check
'use strict';

// ============================================================================
// CONSTANTS (préfixe interne unique __cult_ — jamais exposées au global)
// ============================================================================

/** Cultures reconnues — mêmes valeurs que CULTURES_SB_VALIDES (functions/src/modules/rh/pointageService.js). */
const __cult_CULTURES = ['Framboise', 'Myrtille', 'Avocatier'];

/** Culture par défaut quand rien ne permet de trancher (comportement historique). */
const __cult_DEFAUT = 'Framboise';

/** Termes myrtille (substring, historique : CORINA/CASCADE/BREEZE sont des variétés). */
const __cult_RE_MYRTILLE = /MYRTILL|BLUEBERRY|CORINA|CASCADE|BREEZE/;

/**
 * Termes avocatier. Historique en substring (AVOCAT|AVOCADO|HAAS|BACON), puis
 * variétés d'avocatier ajoutées en MOT ENTIER (`\b`) — un libellé de parcelle
 * ne porte souvent que le nom de variété (cas réel : « F2 ZUTANO », classé à
 * tort en Framboise par défaut). Le `\b` évite qu'un mot plus long contenant
 * la séquence ne déclenche à tort (ex. REED dans « BREEDER »).
 * Volontairement NON inclus : « GEM », « LULA », « ORO » — trop courts ou trop
 * ambigus pour un repli automatique.
 */
const __cult_RE_AVOCAT = /AVOCAT|AVOCADO|HAAS|BACON|\b(HASS|ZUTANO|FUERTE|ETTINGER|PINKERTON|REED|MEXICOLA|NABAL)\b/;

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Heuristique de REPLI : déduit la culture d'un champ culture BEE ONE, à défaut
 * du libellé de la parcelle. Source de vérité partagée — ParcellesReferentielTab
 * consomme cette fonction (plus de copie locale).
 *
 * ⚠️ Ce n'est qu'un repli : la correction durable d'une parcelle mal classée est
 * de renseigner `culture_sb` dans Paramètres → Parcelles (resolveCulture lui
 * donne la priorité). Le regex ne fait que limiter les dégâts par défaut.
 *
 * L'ordre compte : Myrtille est testée AVANT Avocatier (comportement historique).
 *
 * @param {*} cultureField   champ culture (BEE ONE), éventuellement vide
 * @param {*} [labelFallback] libellé de parcelle utilisé si la culture est vide
 * @returns {string} 'Framboise' | 'Myrtille' | 'Avocatier'
 */
function normCulture(cultureField, labelFallback) {
  const src = String(cultureField || labelFallback || '').toUpperCase();
  if (!src) return __cult_DEFAUT;
  if (__cult_RE_MYRTILLE.test(src)) return 'Myrtille';
  if (__cult_RE_AVOCAT.test(src)) return 'Avocatier';
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
