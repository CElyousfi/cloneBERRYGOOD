'use strict';
// @ts-check

/**
 * Logique pure pour l'action `set-locations` (Cloud Function stock).
 * Sépare la validation rôle + construction du patch ciblé de l'I/O Firestore,
 * afin de la tester unitairement (node:test) sans émulateur.
 *
 * Le write réel reste dans functions/index.js (set via { merge: true }),
 * conformément à la règle « écritures Firestore via Cloud Functions uniquement ».
 */

const ROLE_CONTROLE = ['finance', 'dg'];

/**
 * Vérifie que le rôle (résolu côté serveur depuis le token) est autorisé.
 * @param {string|null|undefined} callerRole
 * @returns {{ allowed: boolean, status?: number, error?: string }}
 */
function authorizeSetLocations(callerRole) {
  if (!callerRole) {
    return { allowed: false, status: 403, error: "Rôle introuvable pour l'utilisateur authentifié" };
  }
  if (!ROLE_CONTROLE.includes(callerRole)) {
    return { allowed: false, status: 403, error: 'Réservé à Finance/DG' };
  }
  return { allowed: true };
}

/**
 * Construit le patch ciblé à partir du body. Seuls les champs présents et valides
 * sont retenus (whitelist : magasins, stations, parcelles). Les champs absents ne
 * sont jamais touchés → l'écriture Firestore se fait en merge.
 * Idempotence : réécrire la même liste produit le même patch (le merge ne change rien).
 * @param {Record<string, unknown>} body
 * @returns {{ ok: boolean, status?: number, error?: string, patch?: Record<string, unknown> }}
 */
function buildLocationsPatch(body) {
  const src = body || {};
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(src, 'magasins')) {
    if (!Array.isArray(src.magasins) || !src.magasins.every((m) => typeof m === 'string')) {
      return { ok: false, status: 400, error: 'magasins doit être un tableau de chaînes' };
    }
    patch.magasins = src.magasins;
  }
  if (Object.prototype.hasOwnProperty.call(src, 'stations')) {
    if (!Array.isArray(src.stations) || !src.stations.every((s) => typeof s === 'string')) {
      return { ok: false, status: 400, error: 'stations doit être un tableau de chaînes' };
    }
    patch.stations = src.stations;
  }
  if (Object.prototype.hasOwnProperty.call(src, 'parcelles')) {
    if (typeof src.parcelles !== 'object' || src.parcelles === null || Array.isArray(src.parcelles)) {
      return { ok: false, status: 400, error: 'parcelles doit être un objet' };
    }
    patch.parcelles = src.parcelles;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, status: 400, error: 'Aucun champ à mettre à jour (magasins/stations/parcelles)' };
  }
  return { ok: true, patch };
}

module.exports = { ROLE_CONTROLE, authorizeSetLocations, buildLocationsPatch };
