/**
 * Heures supplémentaires — pure helpers.
 *
 * Source de la durée travaillée : pointage entrée/sortie BEE ONE (collection
 * Firestore `prod_presence/{YYYY-MM-DD}`, champs `heureEntree`/`heureSortie` au
 * format "HH:MM"). La durée est BRUTE (sortie − entrée, sans déduction de pause).
 * Un dépassement est compté au-delà de 8h30 (510 min) de travail.
 *
 * Ces helpers sont purs (pas d'I/O) pour être testables en isolation ;
 * la jointure Firestore vit dans functions/src/modules/rh/pointageService.js (buildHeuresSup).
 */

'use strict';

// Seuil légal de déclenchement des heures supplémentaires : 8h30 = 510 minutes.
const SEUIL_MINUTES = 510;

// Famille d'opération récolte (payée au rendement) — toujours exclue des HS.
const RECOLTE_FAMILLE = '8. Récolte';

// Racine des libellés d'opération de gardiennage — toujours exclus des HS.
// Couvre "Gardiennage", "Gardien de nuit", "Gardien du jour", "Gardienne".
// Testée sur le libellé NORMALISÉ (cf. normalizeFonctionLabel).
const GARDIENNAGE_PATTERN = /gardien/;

// Longueur minimale d'une entrée configurée pour autoriser un match par
// inclusion (en deçà, le risque de match accidentel dépasse le gain).
const MIN_INCLUSION_LENGTH = 3;

/**
 * Parse une heure "HH:MM" (ou "H:MM") en minutes depuis minuit.
 * @param {string|null|undefined} s
 * @returns {number|null} minutes, ou null si vide/illisible.
 */
function parseHHMM(s) {
  if (s == null) return null;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Calcule la durée travaillée et le dépassement à partir des heures
 * entrée/sortie brutes.
 *
 * - Sortie absente (ouvrier encore pointé) → durée inconnue, `clockedIn: true`.
 * - Sortie < entrée → shift de nuit qui passe minuit, on ajoute 24h.
 *
 * @param {string|null} heureEntree - "HH:MM"
 * @param {string|null} heureSortie - "HH:MM"
 * @param {number} [seuilMin=SEUIL_MINUTES]
 * @returns {{durationMin: number|null, overtimeMin: number, clockedIn: boolean}}
 */
function computeDurationOvertime(heureEntree, heureSortie, seuilMin) {
  const seuil = seuilMin == null ? SEUIL_MINUTES : seuilMin;
  const entry = parseHHMM(heureEntree);
  const exit = parseHHMM(heureSortie);
  // Entrée présente mais pas de sortie → encore pointé.
  if (entry != null && exit == null) {
    return { durationMin: null, overtimeMin: 0, clockedIn: true };
  }
  if (entry == null || exit == null) {
    return { durationMin: null, overtimeMin: 0, clockedIn: false };
  }
  let durationMin = exit - entry;
  if (durationMin < 0) durationMin += 1440; // passage minuit
  const overtimeMin = Math.max(0, durationMin - seuil);
  return { durationMin, overtimeMin, clockedIn: false };
}

/**
 * Formate une durée en minutes vers "Xh YY" (ex. 510 → "8h 30").
 * @param {number|null|undefined} min
 * @returns {string}
 */
function formatDuration(min) {
  if (min == null || !isFinite(min)) return '—';
  const sign = min < 0 ? '-' : '';
  const abs = Math.abs(Math.round(min));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h ${String(m).padStart(2, '0')}`;
}

/**
 * Normalise un libellé de fonction pour comparaison.
 *
 * Étapes : trim → minuscule → dépliage des accents (é → e) → réduction des
 * espaces → retrait du préfixe numérique BEE ONE ("08. ", "8.").
 * Le retrait du préfixe rend '8. Récolte' (code) et '08. Récolte' (mirror
 * zéro-padé) identiques, et neutralise toute renumérotation côté BEE ONE.
 *
 * @param {string|null|undefined} s
 * @returns {string}
 */
function normalizeFonctionLabel(s) {
  return String(s == null ? '' : s)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^\d+\s*\.\s*/, '')
    .trim();
}

/**
 * Indique si une fonction pointée relève du gardiennage.
 *
 * Le test porte sur l'OPÉRATION uniquement, jamais sur la famille : en prod les
 * gardiens sont rattachés à la famille "08. Service générale", qui contient
 * aussi Magasinier, Technicien ou Conducteur de voiture — lesquels doivent
 * rester comptés en heures supplémentaires.
 *
 * @param {string|null} operationFamille - non utilisé pour la décision, présent
 *   pour l'homogénéité de signature avec matchesExcludedFonction.
 * @param {string|null} operation
 * @returns {boolean}
 */
function isGardiennage(operationFamille, operation) {
  return GARDIENNAGE_PATTERN.test(normalizeFonctionLabel(operation));
}

/**
 * Indique si une fonction pointée correspond à un libellé exclu configuré.
 *
 * Deux mécanismes :
 * - égalité stricte (normalisée) contre la famille d'opération, l'opération,
 *   ou la concaténation "famille|opération" ;
 * - inclusion de l'entrée configurée dans l'OPÉRATION normalisée, pour qu'une
 *   entrée courte ("gardien") attrape les variantes longues ("gardien de
 *   nuit"). Pas d'inclusion sur la famille (trop large), et les entrées de
 *   moins de MIN_INCLUSION_LENGTH caractères n'ouvrent pas ce mécanisme.
 *
 * @param {string|null} operationFamille
 * @param {string|null} operation
 * @param {Array<string>} excludedFonctions
 * @returns {boolean}
 */
function matchesExcludedFonction(operationFamille, operation, excludedFonctions) {
  if (!Array.isArray(excludedFonctions) || excludedFonctions.length === 0) return false;
  const fam = normalizeFonctionLabel(operationFamille);
  const op = normalizeFonctionLabel(operation);
  // Les deux côtés du combo sont normalisés de la même façon que l'entrée
  // configurée (préfixe numérique retiré ici comme là).
  const combo = `${fam}|${op}`;
  for (const raw of excludedFonctions) {
    const ex = normalizeFonctionLabel(raw);
    if (!ex) continue;
    if (ex === fam || ex === op || ex === combo) return true;
    if (ex.length >= MIN_INCLUSION_LENGTH && op && op.includes(ex)) return true;
  }
  return false;
}

/**
 * Décide si un couple ouvrier-jour doit être exclu des heures supplémentaires.
 *
 * Exclut la récolte (payée au rendement, toujours), le gardiennage (toujours,
 * indépendamment de la configuration) et toute fonction configurée.
 * Une fonction inconnue (absente du mirror) n'est jamais exclue ici — l'appelant
 * la conserve avec un flag pour réconciliation manuelle.
 *
 * @param {{operationFamille: string|null, operation: string|null}} fonction
 * @param {Array<string>} excludedFonctions
 * @returns {boolean}
 */
function shouldExcludeWorkerDay(fonction, excludedFonctions) {
  if (!fonction) return false;
  if (normalizeFonctionLabel(fonction.operationFamille) === normalizeFonctionLabel(RECOLTE_FAMILLE)) {
    return true;
  }
  if (isGardiennage(fonction.operationFamille, fonction.operation)) return true;
  return matchesExcludedFonction(fonction.operationFamille, fonction.operation, excludedFonctions);
}

/**
 * Un ouvrier « sans équipe » : son matricule ne porte aucune lettre, donc aucun
 * préfixe d'équipe (cf. functions/src/modules/rh/equipesConfig.js — MM, AY, HT, HA, KR, NA, JA,
 * AZ, CC, CA, RE, NV, LG). Ces ouvriers sont exclus des heures supplémentaires.
 *
 * Le prédicat est bien « aucune lettre », PAS « commence par un chiffre » :
 * un matricule '1A234' porte une lettre et reste donc rattachable à une équipe.
 *
 * ⚠️ La réciproque est fausse et c'est volontaire : porter une lettre ne garantit
 * pas un préfixe CONNU. 'ZU11501', 'ZZ44594' et 'DD10502' existent en production
 * sans figurer dans les 13 préfixes ci-dessus, et restent conservés — la règle
 * demandée exclut l'absence de lettre, pas l'absence de correspondance.
 *
 * Matricule vide/null → true : une chaîne vide ne peut porter aucun préfixe.
 * En pratique ce cas n'atteint pas la décision côté buildHeuresSup, qui écarte
 * déjà les matricules vides à la lecture de prod_presence (`if (!mat) continue`).
 *
 * @param {string|null|undefined} matricule
 * @returns {boolean} true si le matricule ne contient aucune lettre A-Z/a-z.
 */
function isSansEquipe(matricule) {
  return !/[A-Za-z]/.test(String(matricule == null ? '' : matricule).trim());
}

module.exports = {
  SEUIL_MINUTES,
  RECOLTE_FAMILLE,
  GARDIENNAGE_PATTERN,
  parseHHMM,
  computeDurationOvertime,
  formatDuration,
  normalizeFonctionLabel,
  isGardiennage,
  matchesExcludedFonction,
  shouldExcludeWorkerDay,
  isSansEquipe,
};
