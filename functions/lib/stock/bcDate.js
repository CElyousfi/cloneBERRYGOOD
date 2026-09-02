/**
 * bcDate.js — Logique pure de la MODIFICATION DE LA DATE d'un bon de
 * consommation (action `update-bc-date` de /api/stock).
 *
 * Périmètre volontairement étroit (ticket sb/bc-modifier-date, arbitrage Omar) :
 * la DATE, et rien d'autre. Ni articles, ni quantités, ni parcelles — les
 * modifier obligerait à recalculer des soldes de stock déjà décrémentés.
 *
 * Ce module ne fait AUCUN accès Firestore / réseau : il valide une date et
 * décide si le changement fait basculer le bon de campagne. Le câblage
 * (transaction, écritures) reste dans functions/index.js.
 *
 * Rappel métier : un bon de consommation porte une date, ET les
 * `stock_movements` (type `consommation`, numéro BCS-…) créés par `create-bc`
 * en portent une COPIE. Ce sont ces mouvements que lisent les analyses par
 * période : les deux dates doivent être mises à jour ensemble, sinon elles
 * divergent silencieusement. D'où `buildDateUpdate()`, qui produit d'un seul
 * tenant le patch du bon et celui des mouvements liés.
 *
 * Toutes les fonctions sont pures et testées dans
 * tests/unit/bcDate.test.js (+ mutation testing, cf. PR).
 */
// @ts-check
'use strict';

const { campagneOf } = require('../mappingConso/campagneUtils');

/** Regex stricte d'une date ISO 'YYYY-MM-DD' (aucun autre format accepté). */
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Action tracée dans l'historique du bon. */
const HISTORY_ACTION = 'modification_date';

/**
 * Nombre de jours d'un mois (gère les années bissextiles).
 * @param {number} year
 * @param {number} month 1-12
 * @returns {number}
 */
function daysInMonth(year, month) {
  // Date.UTC(y, month, 0) → dernier jour du mois `month` (1-12 → index 0-based +1).
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * La chaîne est-elle une date ISO 'YYYY-MM-DD' RÉELLE (pas seulement bien
 * formée) ? '2026-02-31' est bien formée mais n'existe pas → false.
 * @param {*} dateStr
 * @returns {boolean}
 */
function isRealIsoDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const m = dateStr.match(ISO_DATE_RE);
  if (!m) return false;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  return day <= daysInMonth(year, month);
}

/**
 * Valide la date demandée pour un bon de consommation.
 *
 * Règles :
 *   1. format 'AAAA-MM-JJ' strict ;
 *   2. date réellement existante (31 février refusé) ;
 *   3. jamais dans le futur — une consommation ne peut pas avoir eu lieu
 *      demain. La date « aujourd'hui » est fournie par l'appelant (calculée
 *      serveur, Africa/Casablanca) : ce module ne lit jamais l'horloge.
 *
 * @param {*} dateStr    date demandée
 * @param {string} todayStr date du jour 'AAAA-MM-JJ' (serveur)
 * @returns {{valid: boolean, error?: string}}
 */
function validateBcDate(dateStr, todayStr) {
  if (!isRealIsoDate(dateStr)) {
    return { valid: false, error: 'Date invalide (format attendu : AAAA-MM-JJ)' };
  }
  if (!isRealIsoDate(todayStr)) {
    return { valid: false, error: 'Date du jour indisponible côté serveur' };
  }
  if (String(dateStr) > todayStr) {
    return { valid: false, error: 'Date future refusée : une consommation ne peut pas être postérieure à aujourd\'hui' };
  }
  return { valid: true };
}

/**
 * Le passage de `fromDate` à `toDate` fait-il changer le bon de CAMPAGNE
 * (année fiscale Juillet→Juin) ? Un basculement silencieux de campagne fausse
 * les analyses : le front doit avertir avant de valider.
 *
 * Une date illisible des deux côtés (→ campagne null) n'est pas un changement.
 *
 * @param {*} fromDate
 * @param {*} toDate
 * @returns {{changed: boolean, from: (string|null), to: (string|null)}}
 */
function campagneChange(fromDate, toDate) {
  const from = campagneOf(typeof fromDate === 'string' ? fromDate : '');
  const to = campagneOf(typeof toDate === 'string' ? toDate : '');
  return { changed: from !== to, from, to };
}

/**
 * Construit le patch atomique { bon, mouvements } à appliquer dans UNE SEULE
 * transaction Firestore.
 *
 * @param {Object} args
 * @param {Object} args.bc          document `consumption_vouchers` existant
 * @param {string} args.date        nouvelle date 'AAAA-MM-JJ' (déjà validée)
 * @param {{uid?: string, profileId?: string, name?: string}} args.by acteur (résolu SERVEUR)
 * @param {number} args.at          timestamp epoch ms
 * @returns {{bcUpdate: Object, movementUpdate: Object, history: Object, changed: boolean}}
 */
function buildDateUpdate(args) {
  const o = args || {};
  const bc = o.bc || {};
  const date = o.date;
  const at = o.at;
  const by = {
    uid: (o.by && o.by.uid) || '',
    profileId: (o.by && o.by.profileId) || '',
    name: (o.by && o.by.name) || '',
  };
  const dateAvant = bc.date || '';
  const history = {
    action: HISTORY_ACTION,
    by,
    at,
    date_avant: dateAvant,
    date_apres: date,
  };
  return {
    changed: dateAvant !== date,
    history,
    bcUpdate: {
      date,
      updated_at: at,
      history: (Array.isArray(bc.history) ? bc.history : []).concat([history]),
    },
    // Les mouvements liés portent leur PROPRE `date` : sans ce patch, les
    // analyses par période resteraient sur l'ancienne date.
    movementUpdate: { date, updated_at: at },
  };
}

module.exports = {
  ISO_DATE_RE,
  HISTORY_ACTION,
  isRealIsoDate,
  validateBcDate,
  campagneChange,
  buildDateUpdate,
};
