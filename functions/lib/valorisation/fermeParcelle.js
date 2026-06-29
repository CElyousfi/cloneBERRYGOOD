'use strict';
// @ts-check

/**
 * fermeParcelle.js — Dérivation PURE de la ferme à partir du libellé de parcelle.
 *
 * Contexte : dans sql_mirror_consommation, le champ `Ferme` vaut « BERRY GOOD
 * Farms » sur les 9208 lignes (constant, inexploitable pour cloisonner par chef).
 * La VRAIE ferme est encodée dans le libellé `Parcelle_Culturale`. Cette fonction
 * la dérive de façon déterministe, en restant FAIL-CLOSED : un libellé non
 * dérivable renvoie `null` et NE DOIT JAMAIS être attribué à un chef.
 *
 * Mapping chef → ferme (cf. accessControl.CHEF_PROFILE_FERME) :
 *   chef_f1 → 'F1', chef_f5 → 'F5', chef_avo → 'Avocatier', chef_bahia → 'BAHIA'.
 *
 * Valeurs de retour possibles : 'F1'..'F6' | 'Avocatier' | 'BAHIA' | null.
 * On dérive la ferme RÉELLE telle que lue (y compris 'F2'/'F3'/'F4'/'F6' non
 * avocatiers, qui n'ont pas de chef dédié) ; le matching chef se fait en aval.
 * On n'invente JAMAIS de rattachement.
 *
 * ── RÈGLE DE DÉRIVATION (ordre important) ──────────────────────────────────
 * 1. Normaliser : MAJUSCULES + trim.
 * 2. Si le libellé contient « HAAS » ou « AVOCAT » → 'Avocatier'.
 *    Les avocatiers sont rattachés au périmètre Avocatier (chef_avo='Avocatier'),
 *    MÊME si le libellé contient aussi un token F2/F3/F4/F5/F6
 *    (ex « AVOCAT F5 », « Avocat AVOCAT F6 AVOCAT », « F2 - HAAS »).
 * 3. Sinon si « BAHIA » → 'BAHIA' (ex « EL BAHIA »).
 * 4. Sinon extraire un token ferme : « F » suivi d'un chiffre 1..6, en tolérant
 *    un séparateur (« F1 », « F-06 »→F6, « F 1 »→F1). On retourne 'F' + chiffre.
 *    F1/F5 = fermes framboise/myrtille (chef_f1, chef_f5) ; F2/F3/F4/F6 sont
 *    dérivées telles quelles (pas de chef dédié → ne matcheront aucun chef).
 * 5. Sinon (aucun token clair, ex « CASCADE MYRTILLE S8-1 ») → null (fail-closed).
 *
 * @param {*} label - valeur Parcelle_Culturale (peut être null/undefined/non-string).
 * @returns {('F1'|'F2'|'F3'|'F4'|'F5'|'F6'|'Avocatier'|'BAHIA'|null)}
 */
function deriveFermeFromParcelle(label) {
  if (typeof label !== 'string') return null;
  const s = label.toUpperCase().trim();
  if (!s) return null;

  // 2. Avocatier : HAAS ou AVOCAT priment sur tout token Fx.
  if (s.indexOf('HAAS') !== -1 || s.indexOf('AVOCAT') !== -1) {
    return 'Avocatier';
  }

  // 3. BAHIA.
  if (s.indexOf('BAHIA') !== -1) {
    return 'BAHIA';
  }

  // 4. Token ferme « F<sep?><chiffre> », chiffre 1..6 (gère F1, F-06, F 1).
  //    \b évite de matcher le « F » d'un mot plus large mal placé ; on accepte
  //    un séparateur optionnel ('-', espace, point) et des zéros de tête.
  const m = s.match(/\bF[\s\-.]*0*([1-6])\b/);
  if (m) {
    return /** @type {'F1'|'F2'|'F3'|'F4'|'F5'|'F6'} */ ('F' + m[1]);
  }

  // 5. Non dérivable → fail-closed.
  return null;
}

module.exports = {
  deriveFermeFromParcelle,
};
