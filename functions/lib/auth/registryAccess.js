'use strict';
// @ts-check

/**
 * registryAccess.js — Projections PURES du registre ouvrier (ouvriers_registry)
 * selon le périmètre de l'appelant (Étape 1 sécurité paie — écran get-registry).
 *
 * Le registre est lu en client-direct par 4 écrans (fuite nominative de paie).
 * On migre chaque écran vers la Cloud Function gatée `/api/registry?action=get-registry`.
 * Ce module concentre la logique PURE testable :
 *  - projection des champs par rôle (scope 'all' = tous champs ; chef = champs réduits) ;
 *  - filtrage des docs registry pour un chef par set de matricules autorisés
 *    (matricules ayant pointé SA ferme sur la fenêtre [from,to]).
 *
 * AUCUN accès I/O : reçoit des docs bruts + le périmètre, renvoie la projection.
 *
 * ⚠️ PONT MATRICULE alpha↔numérique : le mirror pointage est alpha-préfixé
 * (`DD10502`), le registre est numérique (`10502` = docId). Le set autorisé
 * dérivé du mirror DOIT être normalisé (normalizeMatricule → digits only) AVANT
 * de filtrer les docs registry. Ce module attend un set DÉJÀ normalisé (numérique)
 * et normalise le matricule de chaque doc registry avant comparaison (défense).
 */

/** Champs exposés au scope FULL ('all' : RH/DG/Finance/admin) — tel quel, tout le doc. */
const FULL_FIELDS = null; // null = renvoyer le doc complet (spread), pas de whitelist.

/**
 * Champs exposés à un CHEF (périmètre réduit, jamais d'historique nominatif de paie).
 * On NE renvoie JAMAIS prime_history / fonction_history / updatedBy / declareSource
 * à un chef (données sensibles de paie hors de son périmètre de saisie).
 * @type {string[]}
 */
const CHEF_FIELDS = [
  'matricule',
  'nom',
  'declare',
  'baselineJours',
  'baselineDate',
  'primeFonctionJournaliere',
  'prime_effectiveFrom',
  'fonction_id',
];

/**
 * Normalise un matricule vers sa forme numérique (digits only, uppercase-safe).
 * Réplique la sémantique de normalizeMatricule (functions/lib/primes/primesImport)
 * SANS créer de dépendance circulaire : on inline la même transformation.
 * @param {*} m
 * @returns {string} matricule numérique (ex. 'DD10502' → '10502'), '' si vide.
 */
function normalizeMatriculeNum(m) {
  return String(m == null ? '' : m).toUpperCase().replace(/[^0-9]/g, '');
}

/**
 * Projette un doc registry sur les champs autorisés pour un chef.
 * @param {Object} doc doc registry brut (data() + id éventuel).
 * @returns {Object}
 */
function projectChefFields(doc) {
  const d = doc || {};
  const out = {};
  for (const f of CHEF_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(d, f)) out[f] = d[f];
  }
  // matricule est la clé de jointure : garantir sa présence (docId en repli).
  if (!out.matricule && d.__id) out.matricule = d.__id;
  return out;
}

/**
 * Construit la liste `ouvriers` du registre pour un scope FULL ('all').
 * Renvoie TOUS les champs de chaque doc, tel quel (pas de whitelist).
 *
 * @param {Array<Object>} docs docs registry bruts (chaque objet = data(), avec
 *   optionnellement __id = docId).
 * @returns {Array<Object>}
 */
function projectRegistryFull(docs) {
  const list = Array.isArray(docs) ? docs : [];
  return list.map(d => {
    const data = d || {};
    // Copie superficielle : renvoie tout le doc tel quel. On garantit matricule.
    const out = Object.assign({}, data);
    if (!out.matricule && data.__id) out.matricule = data.__id;
    delete out.__id;
    return out;
  });
}

/**
 * Construit la liste `ouvriers` pour un CHEF : ne garde QUE les docs dont le
 * matricule numérique ∈ allowedNumericSet, projetés sur les champs réduits.
 *
 * @param {Array<Object>} docs docs registry bruts (data() + optionnel __id).
 * @param {Set<string>} allowedNumericSet set de matricules NUMÉRIQUES autorisés
 *   (déjà normalisés depuis le mirror). Fail-closed : set vide → aucun doc.
 * @returns {Array<Object>}
 */
function projectRegistryForChef(docs, allowedNumericSet) {
  const list = Array.isArray(docs) ? docs : [];
  const allowed = allowedNumericSet instanceof Set ? allowedNumericSet : new Set();
  const out = [];
  for (const d of list) {
    const data = d || {};
    // Matricule numérique du doc : champ matricule OU docId (__id), normalisé.
    const num = normalizeMatriculeNum(data.matricule || data.__id);
    if (!num) continue; // fail-closed : pas de matricule exploitable → exclu.
    if (!allowed.has(num)) continue; // hors périmètre ferme → exclu.
    out.push(projectChefFields(data));
  }
  return out;
}

/**
 * Normalise un set de matricules mirror (alpha-préfixés, ex. 'DD10502') vers un
 * set numérique ('10502') comparable aux docId registry. 'Autre' / vide exclus.
 *
 * @param {Set<string>|Array<string>|null} allowedRaw set/array de matricules mirror.
 * @returns {Set<string>} set numérique.
 */
function normalizeAllowedSet(allowedRaw) {
  const out = new Set();
  if (!allowedRaw) return out;
  const iter = allowedRaw instanceof Set ? allowedRaw : Array.isArray(allowedRaw) ? allowedRaw : [];
  for (const m of iter) {
    const num = normalizeMatriculeNum(m);
    if (num) out.add(num); // 'Autre', '', non-numérique → exclu (fail-closed).
  }
  return out;
}

module.exports = {
  CHEF_FIELDS,
  FULL_FIELDS,
  normalizeMatriculeNum,
  normalizeAllowedSet,
  projectChefFields,
  projectRegistryFull,
  projectRegistryForChef,
};
