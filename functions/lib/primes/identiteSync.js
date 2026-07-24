'use strict';
// @ts-check

/**
 * identiteSync.js — Logique PURE du backfill automatique prenom/nom
 * (ouvriers_registry) depuis le référentiel Personnel BEE ONE.
 *
 * Aucune dépendance Firestore/SQL : la liste des docs registry et le
 * référentiel BEE ONE mappé sont passés en paramètre (comme
 * primesImport.js). Backfill PUR et idempotent — ne recommande JAMAIS
 * d'écraser un prenom/nom déjà non-vide côté Firestore, même si la
 * valeur BEE ONE diffère.
 */

const { normalizeMatricule } = require('./primesImport');

/**
 * @typedef {Object} RegistryDoc
 * @property {string} id  Doc id ouvriers_registry (matricule numérique canonique).
 * @property {{prenom?: string, nom?: string}} data
 */

/**
 * @typedef {Object} BdpPersonnel
 * @property {string|null} [nom]
 * @property {string|null} [prenom]
 */

/**
 * @typedef {Object} IdentiteSyncPlan
 * @property {Array<{id: string, update: {prenom: string, nom?: string}}>} toUpdate
 *   Mises à jour à appliquer (batch Firestore côté appelant).
 * @property {string[]} notFoundInBdp
 *   Matricules avec prenom Firestore vide ET absents/vides côté BEE ONE
 *   (tronqué à notFoundLimit).
 * @property {number} totalScanned
 */

/**
 * Construit le plan de backfill : pour chaque doc registry sans prenom,
 * cherche le prenom BEE ONE correspondant via la clé numérique canonique
 * (ouvriers_registry est keyé numérique, cf. primesImport.js ; le Mat BEE ONE
 * brut peut être alpha-préfixé, d'où la réindexation via normalizeMatricule).
 *
 * @param {RegistryDoc[]} registryDocs
 * @param {{[rawMatricule: string]: BdpPersonnel}} bdpData
 *   Sortie brute de rhBdpService.getPersonnelRef().data (clé = Mat BEE ONE brut).
 * @param {number} [notFoundLimit]  Limite la liste notFoundInBdp (défaut 200,
 *   pour ne pas surcharger la réponse HTTP si beaucoup d'ouvriers restent non résolus).
 * @returns {IdentiteSyncPlan}
 */
function buildIdentiteSyncPlan(registryDocs, bdpData, notFoundLimit) {
  const limit = typeof notFoundLimit === 'number' ? notFoundLimit : 200;

  // Réindexe BEE ONE sur la clé numérique canonique (= doc.id ouvriers_registry).
  const bdpByMatricule = {};
  const rawData = bdpData || {};
  for (const rawMat of Object.keys(rawData)) {
    const norm = normalizeMatricule(rawMat);
    if (norm) bdpByMatricule[norm] = rawData[rawMat];
  }

  const toUpdate = [];
  const notFoundInBdp = [];
  const docs = Array.isArray(registryDocs) ? registryDocs : [];

  for (const doc of docs) {
    const cur = doc.data || {};
    const curPrenom = String(cur.prenom || '').trim();
    if (curPrenom) continue; // déjà renseigné → jamais touché (backfill pur).

    const bdp = bdpByMatricule[doc.id];
    const bdpPrenom = bdp && bdp.prenom ? String(bdp.prenom).trim() : '';
    if (!bdpPrenom) {
      if (notFoundInBdp.length < limit) notFoundInBdp.push(doc.id);
      continue;
    }

    const update = { prenom: bdpPrenom };
    const curNom = String(cur.nom || '').trim();
    if (!curNom) {
      const bdpNom = bdp.nom ? String(bdp.nom).trim() : '';
      if (bdpNom) update.nom = bdpNom;
    }
    toUpdate.push({ id: doc.id, update });
  }

  return { toUpdate, notFoundInBdp, totalScanned: docs.length };
}

module.exports = { buildIdentiteSyncPlan };
