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
 * Détermine le Nombre_Jr (journées) BRUT d'une ligne Personnel_Pointage, AVANT
 * split multi-parcelle.
 *
 * SOURCE RÉELLE (validation croisée juin) : la colonne journée est la colonne
 * DIRECTE `Personnel_Pointage.Nombre_jour` — elle vaut 1 pour une journée
 * complète et 0.5 pour une demi-journée. C'est une valeur DIRECTE : on ne
 * recalcule RIEN (les colonnes JC/DJ1/DJ2 sont à 0 en BDP → l'ancienne formule
 * `JC + 0.5*(DJ1+DJ2)` renvoyait 0). La requête SQL (P2b) alias
 * `pp.Nombre_jour AS Nombre_jour_raw` ; on lit dans l'ordre : Nombre_jour_raw,
 * Nombre_jour, puis l'alias historique Nombre_Jr.
 *
 * @param {Object} raw ligne Personnel_Pointage aplatie
 * @returns {number}
 */
function deriveJournees(raw) {
  if (!raw) return 0;
  if (raw.Nombre_jour_raw != null && raw.Nombre_jour_raw !== '') return n(raw.Nombre_jour_raw);
  if (raw.Nombre_jour != null && raw.Nombre_jour !== '') return n(raw.Nombre_jour);
  // Alias SQL historique (pp.Nombre_jour AS Nombre_Jr).
  return n(raw.Nombre_Jr);
}

/**
 * Poids w_p de la parcelle pour le split multi-parcelle.
 *
 * P2b : quand un ouvrier couvre N parcelles dans un bon, chaque ligne
 * (ouvrier × parcelle) porte un poids w_p = coût_parcelle / somme_coûts_du_bon,
 * calculé côté SQL (fenêtre) et exposé dans la colonne `w_p`. Ici on se contente
 * de le lire et de le borner.
 *
 * Défaut = 1 (cas mono-parcelle OU colonne absente → aucun split, comportement
 * identique à l'avant-P2b). w_p négatif ou non fini → 1 (garde-fou).
 *
 * @param {Object} raw
 * @returns {number}
 */
function deriveParcelWeight(raw) {
  if (!raw || raw.w_p == null || raw.w_p === '') return 1;
  const w = Number(raw.w_p);
  if (!Number.isFinite(w) || w < 0) return 1;
  return w;
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
  // Poids de la parcelle (P2b) : 1 en mono-parcelle / colonne absente.
  const w = deriveParcelWeight(r);
  // Coût BEE ONE BRUT (niveau ouvrier), avant split. Ordre de lecture :
  // cout_raw (P2b) → cout → Cout (alias historiques). = valeur de RÉFÉRENCE.
  const coutRawVal = n(r.cout_raw != null ? r.cout_raw : (r.cout != null ? r.cout : r.Cout));
  // SPLIT multi-parcelle : × w_p (w=1 → inchangé en mono-parcelle).
  const coutRef = coutRawVal * w;
  const qteRaw = n(
    r.Qte_Unite_raw != null
      ? r.Qte_Unite_raw
      : (r.Quantite_unite != null ? r.Quantite_unite : r.Qte_Unite)
  );
  return {
    Personnel_Matricule: s(r.Personnel_Matricule != null ? r.Personnel_Matricule : r.Mat),
    Personnel_Nom: s(r.Personnel_Nom != null ? r.Personnel_Nom : r.Nom),
    Operation_Famille: s(r.Operation_Famille),
    Operation: s(r.Operation != null ? r.Operation : r.OpeRef_Intitule),
    Operation_Groupe: s(r.Operation_Groupe),
    // Nombre_Jr splitté au poids de la parcelle (clé de validation croisée).
    Nombre_Jr: deriveJournees(r) * w,
    // Nombre_Hr ← HJ (heures journée standard = 8). NON splitté (heure journée
    // standard, pas un cumul du bon). Fallback seuil_horaire si HJ absent.
    Nombre_Hr: n(
      r.Nombre_Hr != null
        ? r.Nombre_Hr
        : r.HJ != null
        ? r.HJ
        : r.seuil_horaire
    ),
    // Quantité splittée au même ratio w_p.
    Quantite_unite: qteRaw * w,
    // Champ contrat Cout : RÉFÉRENCE BEE ONE splittée (voir en-tête module).
    Cout: coutRef,
    // Colonne SÉPARÉE de référence/comparaison (source de vérité du coût BEE ONE).
    cout_beeone_ref: coutRef,
    Parcelle_Culturale: s(r.Parcelle_Culturale),
    Ref_parcelle: s(r.Ref_parcelle),
    Variete: s(r.Variete),
    Culture: s(r.Culture),
    Periode_paie: derivePeriodePaie(r),
    DateStr: s(r.DateStr),
    // HS splittés au même ratio w_p (aliases P2b HS_*_raw, sinon HS_*).
    HS_25: n(r.HS_25_raw != null ? r.HS_25_raw : r.HS_25) * w,
    HS_50: n(r.HS_50_raw != null ? r.HS_50_raw : r.HS_50) * w,
    HS_100: n(r.HS_100_raw != null ? r.HS_100_raw : r.HS_100) * w,
    // HS_NM inutilisé (décision DG) → toujours 0.
    HS_NM: 0,
  };
}

module.exports = { s, n, deriveJournees, deriveParcelWeight, derivePeriodePaie, mapBdpRowToContract };
