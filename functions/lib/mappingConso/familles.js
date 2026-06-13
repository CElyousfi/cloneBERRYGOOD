'use strict'
// @ts-check

/**
 * AFFICHAGE uniquement — la dimension analytique réelle = `cpc_code`.
 *
 * RÉALIGNEMENT PARCELLE_TO_CPC (2026-06, décision DG) :
 * l'ancien `CULTURE_TO_FAMILLE` (Avocatier/Framboise/Myrtille → libellé) était
 * un référentiel INVENTÉ qui doublonnait la dimension parcelle du Stock. Il a
 * été SUPPRIMÉ. La dimension analytique du module vient désormais EXCLUSIVEMENT
 * de `PARCELLE_TO_CPC` (functions/lib/stockCaneva/mappings.js) :
 *   PARCELLE_TO_CPC[cible].cpc_code  (ex. 'AVOCAT', 'S1S4_MAR_MD', 'CASCADE').
 *
 * Le resolver agrège par `cpc_code`. Le champ `famille` du seed (libellé culture)
 * ne sert plus qu'à l'affichage groupé dans l'UI (filtres « Avocatier /
 * Framboise / Myrtille »), JAMAIS au routage analytique.
 *
 * `familleForCulture` est conservé comme simple identité défensive pour le front
 * (libellé d'affichage). Aucune table de correspondance maintenue ici.
 *
 * @param {string|null|undefined} culture libellé culture (affichage)
 * @returns {string|null}
 */
function familleForCulture(culture) {
  if (culture == null) return null
  return String(culture)
}

module.exports = { familleForCulture }
