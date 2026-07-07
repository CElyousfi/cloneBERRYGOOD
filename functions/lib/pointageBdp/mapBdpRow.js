'use strict';

// @ts-check

/**
 * Helpers PURS de reconstruction du contrat mirror pointage à partir des lignes
 * BRUTES de la BDP prod BEE_BERRY_GOOD (tables Pointage / Personnel_Pointage /
 * Pointage_ParcelleCulturale / Pointage_Operation_REF + réf).
 *
 * ⚠️ ISOLÉ : ce module ne fait AUCUN accès SQL ni Firestore. Il transforme une
 * ligne « aplatie » (déjà jointe côté SQL) en objet contrat 19 champs
 * (+ colonne de référence cout_beeone_ref). Testable unitairement (node:test).
 *
 * Décision DG (pull FACTUEL, PAS base de paie) :
 *   - Le coût BEE ONE (Personnel_Pointage.cout) est une valeur de RÉFÉRENCE.
 *     On le stocke dans `cout_beeone_ref`. On remplit AUSSI le champ contrat
 *     `Cout` avec cette même valeur pour ne pas casser les écrans « coût M.O »
 *     qui lisent r.Cout — MAIS c'est explicitement une référence, jamais
 *     recalculée en paie : Smart Berry recalcule la paie via paieUtils.
 */

/**
 * Nettoie une chaîne : null/undefined → '', sinon trim.
 * @param {*} v
 * @returns {string}
 */
function s(v) {
  return (v == null ? '' : String(v)).trim();
}

/**
 * Coerce en nombre : null/undefined/'' → 0, NaN → 0.
 * @param {*} v
 * @returns {number}
 */
function n(v) {
  if (v == null || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Détermine le Nombre_Jr (journées) d'une ligne Personnel_Pointage.
 *
 * GRAIN / HYPOTHÈSE : la BDP porte plusieurs colonnes candidates de journées sur
 * Personnel_Pointage — JC (journée complète), DJ1/DJ2 (demi-journées ?). Le
 * mirror historique n'expose qu'un scalaire `Nombre_Jr`. On le reconstruit :
 *   Nombre_Jr = JC + 0.5*(DJ1 + DJ2)
 * si ces colonnes existent, sinon on retombe sur une colonne journée directe.
 * Cette hypothèse est l'objet de la VALIDATION CROISÉE juin (oracle) : si l'écart
 * strict Nombre_Jr apparaît, on ajuste ici (et SEULEMENT ici — helper pur).
 *
 * @param {Object} raw ligne Personnel_Pointage aplatie
 * @returns {number}
 */
function deriveJournees(raw) {
  if (!raw) return 0;
  // Colonne journée directe éventuelle (ex. HJ / Nombre_Jr déjà agrégé côté BDP).
  if (raw.Nombre_Jr != null && raw.Nombre_Jr !== '') return n(raw.Nombre_Jr);
  if (raw.HJ != null && raw.HJ !== '') return n(raw.HJ);
  // Sinon reconstruction JC + demi-journées.
  const jc = n(raw.JC);
  const dj1 = n(raw.DJ1);
  const dj2 = n(raw.DJ2);
  return jc + 0.5 * (dj1 + dj2);
}

/**
 * Reconstruit le libellé Periode_paie « Quinzaine N ».
 * La BDP porte déjà `Periode_paie.Periode` = "Quinzaine N" → on le prend tel
 * quel s'il est présent, sinon on le fabrique depuis un numéro de quinzaine.
 * @param {Object} raw ligne aplatie (peut porter Periode_paie ou Quinzaine_Num)
 * @returns {string}
 */
function derivePeriodePaie(raw) {
  if (!raw) return '';
  const direct = s(raw.Periode_paie || raw.Periode);
  if (direct) return direct;
  const num = raw.Quinzaine_Num;
  if (num != null && num !== '') return `Quinzaine ${s(num)}`;
  return '';
}

/**
 * Transforme une ligne BRUTE aplatie (une jointure Personnel_Pointage ×
 * Pointage × réf, avec parcelle/opération résolues côté SQL) en objet contrat
 * mirror 19 champs + cout_beeone_ref.
 *
 * @param {Object} raw ligne aplatie issue de la requête SQL de reconstruction
 * @returns {Object} objet contrat
 */
function mapBdpRowToContract(raw) {
  const r = raw || {};
  // Coût BEE ONE = valeur de RÉFÉRENCE (jamais base de paie recalculée par SB).
  const coutRef = n(r.cout != null ? r.cout : r.Cout);
  return {
    Personnel_Matricule: s(r.Personnel_Matricule != null ? r.Personnel_Matricule : r.Mat),
    Personnel_Nom: s(r.Personnel_Nom != null ? r.Personnel_Nom : r.Nom),
    Operation_Famille: s(r.Operation_Famille),
    Operation: s(r.Operation != null ? r.Operation : r.OpeRef_Intitule),
    Operation_Groupe: s(r.Operation_Groupe),
    Nombre_Jr: deriveJournees(r),
    Nombre_Hr: n(r.Nombre_Hr != null ? r.Nombre_Hr : r.HN),
    Quantite_unite: n(r.Quantite_unite != null ? r.Quantite_unite : r.Qte_Unite),
    // Champ contrat Cout : rempli avec la RÉFÉRENCE BEE ONE (voir en-tête module).
    Cout: coutRef,
    // Colonne SÉPARÉE de référence/comparaison (source de vérité du coût BEE ONE).
    cout_beeone_ref: coutRef,
    Parcelle_Culturale: s(r.Parcelle_Culturale),
    Ref_parcelle: s(r.Ref_parcelle),
    Variete: s(r.Variete),
    Culture: s(r.Culture),
    Periode_paie: derivePeriodePaie(r),
    DateStr: s(r.DateStr),
    HS_25: n(r.HS_25),
    HS_50: n(r.HS_50),
    HS_100: n(r.HS_100),
    // HS_NM inutilisé (décision DG) → toujours 0.
    HS_NM: 0,
  };
}

module.exports = { s, n, deriveJournees, derivePeriodePaie, mapBdpRowToContract };
