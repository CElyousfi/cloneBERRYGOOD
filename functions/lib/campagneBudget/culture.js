'use strict'
// @ts-check

/**
 * Résolution de la CULTURE d'une parcelle — MIROIR BACKEND de
 * public/lib/cultureUtils.js.
 *
 * POURQUOI UN MIROIR ET NON UN `require` : Firebase ne déploie que `functions/`,
 * un `require('../../public/lib/cultureUtils')` ferait échouer le CHARGEMENT de
 * TOUTES les Cloud Functions (cf. CLAUDE.md, mémoire projet
 * « backend-jamais-require-public »). La duplication est donc imposée ; c'est au
 * test de la surveiller : tests/unit/campagneBudgetQuinzaine.test.js charge les
 * DEUX implémentations et vérifie qu'elles rendent le même verdict sur les 17
 * libellés réels de la campagne, y compris les 14 sans `culture_sb`.
 *
 * Sert le gating AVOCATIER du budget de quinzaine (lib/campagneBudget/validate.js) :
 * une écriture forgée sur une parcelle d'avocatier doit être refusée par le
 * serveur, pas seulement absente de l'écran.
 *
 * ⚠️ Ne JAMAIS déduire la culture de `nom_sb` : c'est un nom d'usage. Cas réel en
 * production, la parcelle 'S12 - YAZMIN…' (framboise) est nommée
 * 'MYRTILLE EXTENSION' côté Smart Berry.
 *
 * Toutes les fonctions sont PURES : le référentiel `sbMap` est TOUJOURS injecté.
 */

/** Culture par défaut quand rien ne permet de trancher (comportement historique). */
const __cbc_DEFAUT = 'Framboise'

/** Termes myrtille (substring — CORINA/CASCADE/BREEZE sont des variétés). */
const __cbc_RE_MYRTILLE = /MYRTILL|BLUEBERRY|CORINA|CASCADE|BREEZE/

/** Termes avocatier — cf. public/lib/cultureUtils.js pour le détail du calibrage. */
const __cbc_RE_AVOCAT =
  /AVOCAT|AVOCADO|HAAS|BACON|\b(HASS|ZUTANO|FUERTE|ETTINGER|PINKERTON|REED|MEXICOLA|NABAL)\b/

/**
 * Heuristique de REPLI : culture BEE ONE, à défaut libellé de parcelle.
 * L'ordre compte : Myrtille est testée AVANT Avocatier (comportement historique).
 *
 * @param {*} cultureField
 * @param {*} [labelFallback]
 * @returns {string} 'Framboise' | 'Myrtille' | 'Avocatier'
 */
function normCulture(cultureField, labelFallback) {
  const src = String(cultureField || labelFallback || '').toUpperCase()
  if (!src) return __cbc_DEFAUT
  if (__cbc_RE_MYRTILLE.test(src)) return 'Myrtille'
  if (__cbc_RE_AVOCAT.test(src)) return 'Avocatier'
  return __cbc_DEFAUT
}

/**
 * Culture d'une parcelle : `culture_sb` du référentiel Smart Berry s'il est
 * renseigné (donnée saisie à la main, elle fait autorité), sinon repli
 * heuristique.
 *
 * @param {*} parcelle { label|Parcelle_Physique, culture|Culture }
 * @param {*} [sbMap] référentiel SB { LABEL_MAJ: { culture_sb, … } } (injecté).
 * @returns {string} 'Framboise' | 'Myrtille' | 'Avocatier'
 */
function resolveCulture(parcelle, sbMap) {
  const p = parcelle || {}
  const label = p.label || p.Parcelle_Physique
  const key = String(label || '').toUpperCase().trim()
  const entry = sbMap && key ? sbMap[key] : null
  if (entry && entry.culture_sb && String(entry.culture_sb).trim()) {
    return String(entry.culture_sb).trim()
  }
  return normCulture(p.culture || p.Culture, label)
}

module.exports = {
  normCulture,
  resolveCulture,
}
