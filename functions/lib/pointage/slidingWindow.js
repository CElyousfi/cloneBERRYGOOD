// @ts-check
'use strict';

/**
 * slidingWindow.js — Fenêtre glissante pour le pull horaire du pointage BDP.
 *
 * Le cron horaire (`sqlToFirestoreSync`, "5 * * * *") repull le pointage depuis
 * la BDP sur une fenêtre glissante de 7 jours se terminant AUJOURD'HUI (heure
 * locale Africa/Casablanca). Objectif : capter le nouveau pointage du jour ET
 * les corrections rétroactives des jours précédents. L'upsert par date de
 * `syncPointageFromProd` rend l'opération idempotente.
 */

const { isoDateInTz } = require('../dates/isoDateInTz');

const DEFAULT_WINDOW_DAYS = 7;
const CASABLANCA_TZ = 'Africa/Casablanca';

/**
 * Renvoie la date locale Africa/Casablanca (YYYY-MM-DD) pour un instant donné.
 * Délègue à isoDateInTz : le format est assemblé depuis les champs Intl, pas
 * emprunté au motif d'une locale (cf. functions/lib/dates/isoDateInTz.js).
 * @param {Date} now
 * @returns {string} YYYY-MM-DD
 */
function todayInCasablanca(now) {
  return isoDateInTz(now, CASABLANCA_TZ);
}

/**
 * Ajoute des jours à une date YYYY-MM-DD (arithmétique en UTC), renvoie YYYY-MM-DD.
 * @param {string} dateStr YYYY-MM-DD
 * @param {number} days
 * @returns {string} YYYY-MM-DD
 */
function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Calcule la fenêtre glissante {from, to} pour le pull horaire.
 * `to` = aujourd'hui (Africa/Casablanca), `from` = to − (windowDays − 1).
 * Fenêtre INCLUSIVE des deux bornes (7 jours ⇒ from = to − 6).
 *
 * @param {Date} [now] instant de référence (défaut : maintenant)
 * @param {number} [windowDays] taille de fenêtre en jours (défaut : 7)
 * @returns {{from: string, to: string, windowDays: number}}
 */
function computePointageWindow(now, windowDays) {
  const ref = now instanceof Date ? now : new Date();
  const n = Number.isFinite(windowDays) && windowDays >= 1
    ? Math.floor(windowDays)
    : DEFAULT_WINDOW_DAYS;
  const to = todayInCasablanca(ref);
  const from = addDaysStr(to, -(n - 1));
  return { from, to, windowDays: n };
}

module.exports = {
  computePointageWindow,
  todayInCasablanca,
  addDaysStr,
  DEFAULT_WINDOW_DAYS,
};
