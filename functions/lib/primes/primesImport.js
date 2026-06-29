'use strict';
// @ts-check

/**
 * primesImport.js — Logique PURE d'import Excel des primes fixes.
 *
 * La collection ouvriers_registry est keyée NUMÉRIQUE (doc.id = matricule
 * numérique), alors que les matricules de pointage sont alpha-préfixés
 * (DD10502, NA3439). normalizeMatricule extrait la clé numérique canonique.
 *
 * RISQUE COLLISION : deux lignes Excel distinctes (ex 'DD10502' et '10502',
 * ou 'DD10502' et 'XX10502') normalisent vers le même matricule numérique
 * '10502'. buildImportPreview détecte et liste ces collisions pour qu'un
 * dry-run les remonte AVANT toute écriture.
 *
 * Module PUR : aucune dépendance Firestore. La liste des matricules registry
 * existants est passée en paramètre (registryMatricules).
 */

/**
 * Normalise un matricule vers sa clé numérique canonique (= numKey front).
 * @param {unknown} m
 * @returns {string} matricule numérique (chaîne de chiffres), '' si aucun.
 */
function normalizeMatricule(m) {
  return String(m == null ? '' : m).toUpperCase().replace(/[^0-9]/g, '');
}

/**
 * @typedef {Object} ImportRow
 * @property {unknown} matricule  Matricule brut (Excel), potentiellement alpha.
 * @property {unknown} [montant]  Montant de prime (DH/jour).
 */

/**
 * @typedef {Object} ImportPreview
 * @property {Array<{matricule:string, raw:string, montant:number}>} toCreate
 *   Lignes valides dont le matricule normalisé est ABSENT du registry.
 * @property {Array<{matricule:string, raw:string, montant:number}>} toUpdate
 *   Lignes valides dont le matricule normalisé est PRÉSENT dans le registry.
 * @property {Array<{raw:string}>} unmatched
 *   Lignes dont le matricule normalisé est vide (illisible).
 * @property {Array<{matricule:string, raws:string[]}>} collisions
 *   Matricules numériques produits par >= 2 lignes Excel distinctes.
 */

/**
 * Construit la prévisualisation d'un import de primes (dry-run).
 *
 * @param {ImportRow[]} rows  Lignes brutes parsées depuis l'Excel.
 * @param {Iterable<string>} registryMatricules  Matricules numériques déjà en base.
 * @returns {ImportPreview}
 */
function buildImportPreview(rows, registryMatricules) {
  const registrySet = new Set();
  if (registryMatricules) {
    for (const m of registryMatricules) registrySet.add(normalizeMatricule(m));
  }

  const safeRows = Array.isArray(rows) ? rows : [];

  // Regroupe les lignes par matricule normalisé pour détecter les collisions.
  /** @type {Map<string, string[]>} */
  const byNorm = new Map();
  /** @type {Array<{matricule:string, raw:string, montant:number}>} */
  const valid = [];
  /** @type {Array<{raw:string}>} */
  const unmatched = [];

  for (const row of safeRows) {
    const raw = String(row && row.matricule != null ? row.matricule : '').trim();
    const norm = normalizeMatricule(raw);
    if (!norm) {
      unmatched.push({ raw });
      continue;
    }
    const montant = Number(row && row.montant) || 0;
    valid.push({ matricule: norm, raw, montant });
    const arr = byNorm.get(norm) || [];
    arr.push(raw);
    byNorm.set(norm, arr);
  }

  // Collision = même matricule numérique produit par >= 2 RAW distincts.
  /** @type {Array<{matricule:string, raws:string[]}>} */
  const collisions = [];
  const collidingNorms = new Set();
  for (const [norm, raws] of byNorm.entries()) {
    const distinctRaws = Array.from(new Set(raws));
    if (distinctRaws.length > 1) {
      collisions.push({ matricule: norm, raws: distinctRaws });
      collidingNorms.add(norm);
    }
  }

  /** @type {Array<{matricule:string, raw:string, montant:number}>} */
  const toCreate = [];
  /** @type {Array<{matricule:string, raw:string, montant:number}>} */
  const toUpdate = [];
  for (const v of valid) {
    // Les lignes en collision ne sont PAS classées toCreate/toUpdate :
    // elles sont ambiguës et seront exclues de l'apply.
    if (collidingNorms.has(v.matricule)) continue;
    if (registrySet.has(v.matricule)) toUpdate.push(v);
    else toCreate.push(v);
  }

  return { toCreate, toUpdate, unmatched, collisions };
}

module.exports = { normalizeMatricule, buildImportPreview };
