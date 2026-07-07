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
 * SOURCE RÉELLE (validation croisée juin) : la colonne journée est la colonne
 * DIRECTE `Personnel_Pointage.Nombre_jour` — elle vaut 1 pour une journée
 * complète et 0.5 pour une demi-journée. C'est une valeur DIRECTE : on ne
 * recalcule RIEN (les colonnes JC/DJ1/DJ2 sont à 0 en BDP → l'ancienne formule
 * `JC + 0.5*(DJ1+DJ2)` renvoyait 0). La requête SQL alias `pp.Nombre_jour AS
 * Nombre_Jr`, on lit donc `raw.Nombre_jour` (fallback sur l'alias `Nombre_Jr`).
 *
 * @param {Object} raw ligne Personnel_Pointage aplatie
 * @returns {number}
 */
function deriveJournees(raw) {
  if (!raw) return 0;
  if (raw.Nombre_jour != null && raw.Nombre_jour !== '') return n(raw.Nombre_jour);
  // Alias SQL éventuel (pp.Nombre_jour AS Nombre_Jr).
  return n(raw.Nombre_Jr);
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
    // Nombre_Hr ← HJ (heures journée standard = 8). HN est NULL en BDP.
    // Fallback : seuil_horaire si HJ absent, sinon 0.
    Nombre_Hr: n(
      r.Nombre_Hr != null
        ? r.Nombre_Hr
        : r.HJ != null
        ? r.HJ
        : r.seuil_horaire
    ),
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
