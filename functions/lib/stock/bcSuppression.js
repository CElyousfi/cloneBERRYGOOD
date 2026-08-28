/**
 * bcSuppression.js — Logique PURE de la SUPPRESSION d'un bon de consommation
 * (action `delete-bc` de /api/stock).
 *
 * ── POURQUOI CETTE ACTION EXISTE ──────────────────────────────────────────
 * Il n'existait AUCUNE suppression de bon de consommation : `create-bc`,
 * `list-bc` et `update-bc-date`, rien d'autre. Or la garde anti-doublon
 * (lib/stock/bcDoublons) laisse forcément passer des doublons déjà créés — les
 * 2 mesurés en production — et un doublon strictement identique doit pouvoir
 * être supprimé.
 *
 * ── LE PIÈGE : LES MOUVEMENTS DE STOCK ────────────────────────────────────
 * `create-bc` ne crée pas que le bon : il crée un `stock_movement` de type
 * `consommation` (BCS-…) par parcelle, en `valide_mag`, et DÉCRÉMENTE
 * immédiatement `stock_balances`. Supprimer le bon seul laisserait la
 * consommation déduite pour toujours : le bon disparaît, le stock reste
 * amputé, et l'inventaire devient faux dans l'AUTRE sens. La suppression doit
 * donc annuler l'impact stock — même mécanique que `delete-movement` pour les
 * réceptions (soft-delete + `reverseStockImpact`), qu'on ne réinvente pas.
 *
 * ── CE QUE FAIT CE MODULE ─────────────────────────────────────────────────
 * Il décide (rôle, motif, état du bon) et construit les patchs. Aucune lecture
 * ni écriture Firestore, aucune horloge, aucune identité : le handler lui passe
 * le rôle DÉJÀ résolu serveur depuis le token. Le câblage (lectures, reversal,
 * écritures) reste dans functions/index.js.
 *
 * Soft-delete, jamais de destruction : on marque `deleted: true` avec l'auteur,
 * la date et le motif, exactement comme `delete-movement`. Un bon effacé sort
 * des listes et des analyses (cf. `list-bc` et consoBons/fetchBons), mais reste
 * auditable.
 *
 * Testé dans tests/unit/bcSuppression.test.js (+ mutation testing, cf. PR) ;
 * le câblage l'est dans tests/unit/deleteBcWiring.test.js.
 */
// @ts-check
'use strict';

const { isImpactApplied } = require('./movementImpact');
const { peutSupprimerBonConso } = require('../stockRoles');

/** Action tracée dans l'historique du bon et de ses mouvements. */
const HISTORY_ACTION = 'suppression';

/** Longueur minimale d'un motif : un motif vide ne trace rien d'utile. */
const MOTIF_MIN = 3;

/**
 * Valide une demande de suppression.
 *
 * Ordre des refus : rôle d'abord (on ne renseigne pas un appelant non autorisé
 * sur l'existence du bon), puis motif, puis état du bon.
 *
 * @param {Object} args
 * @param {*} args.role   profileId résolu SERVEUR (`resolveCallerRole`).
 * @param {*} args.motif  motif fourni par l'appelant.
 * @param {{deleted?: *}|null|undefined} args.bc bon lu (null si introuvable).
 * @param {boolean} [args.exists] le bon existe-t-il ? (défaut : !!bc)
 * @returns {{ok: boolean, code: number, error: string, motif: string}}
 */
function validerSuppression(args) {
  const o = args || {};
  const verdictRole = peutSupprimerBonConso(o.role);
  if (!verdictRole.ok) {
    return { ok: false, code: 403, error: verdictRole.raison, motif: '' };
  }
  const motif = typeof o.motif === 'string' ? o.motif.trim() : '';
  if (motif.length < MOTIF_MIN) {
    return { ok: false, code: 400, error: 'Motif de suppression obligatoire', motif: '' };
  }
  const exists = o.exists === undefined ? !!o.bc : !!o.exists;
  if (!exists) {
    return { ok: false, code: 404, error: 'Bon de consommation introuvable', motif };
  }
  if (o.bc && o.bc.deleted === true) {
    return { ok: false, code: 400, error: 'Bon déjà supprimé', motif };
  }
  return { ok: true, code: 200, error: '', motif };
}

/**
 * Trie les mouvements liés au bon : lesquels annuler (impact stock matérialisé
 * → il faut re-créditer la source), lesquels seulement marquer supprimés.
 *
 * Un mouvement DÉJÀ soft-deleted est ignoré entièrement : le re-annuler
 * re-créditerait une seconde fois la source (double comptage).
 *
 * @param {Array<{id?: *, deleted?: *, type?: string, status?: string}>} movements
 * @returns {{aAnnuler: Array<Object>, aMarquer: Array<Object>, ignores: Array<Object>}}
 */
function trierMouvements(movements) {
  const liste = Array.isArray(movements) ? movements : [];
  /** @type {Array<Object>} */ const aAnnuler = [];
  /** @type {Array<Object>} */ const aMarquer = [];
  /** @type {Array<Object>} */ const ignores = [];
  for (const m of liste) {
    if (!m) continue;
    if (m.deleted === true) { ignores.push(m); continue; }
    aMarquer.push(m);
    if (isImpactApplied(m)) aAnnuler.push(m);
  }
  return { aAnnuler, aMarquer, ignores };
}

/**
 * Construit les patchs de soft-delete du bon et de ses mouvements.
 *
 * @param {Object} args
 * @param {Object} args.bc      document `consumption_vouchers` existant
 * @param {string} args.motif   motif validé (non vide)
 * @param {{uid?: string, profileId?: string, name?: string}} args.by acteur (résolu SERVEUR)
 * @param {number} args.at      timestamp epoch ms
 * @returns {{bcUpdate: Object, movementUpdate: Object, history: Object}}
 */
function buildSuppressionUpdate(args) {
  const o = args || {};
  const bc = o.bc || {};
  const by = {
    uid: (o.by && o.by.uid) || '',
    profileId: (o.by && o.by.profileId) || '',
    name: (o.by && o.by.name) || '',
  };
  const history = { action: HISTORY_ACTION, by, at: o.at, motif: o.motif };
  return {
    history,
    bcUpdate: {
      deleted: true,
      deleted_by: by,
      deleted_at: o.at,
      deleted_reason: o.motif,
      updated_at: o.at,
      history: (Array.isArray(bc.history) ? bc.history : []).concat([history]),
    },
    // Même forme que `delete-movement` : les mouvements du bon deviennent
    // invisibles pour les recomptes de soldes (isImpactApplied → false).
    movementUpdate: {
      deleted: true,
      deleted_by: { userId: by.uid, profileId: by.profileId },
      deleted_at: o.at,
      deleted_reason: o.motif,
      updated_at: o.at,
    },
  };
}

module.exports = {
  HISTORY_ACTION,
  MOTIF_MIN,
  validerSuppression,
  trierMouvements,
  buildSuppressionUpdate,
};
