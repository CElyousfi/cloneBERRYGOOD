'use strict';
// @ts-check

/**
 * fonctionsValidate.js — Validation PURE des entrées du référentiel fonctions.
 *
 * Module PUR : aucune dépendance Firestore. Utilisé par fonctionsManagement
 * pour rejeter (400) les entrées invalides AVANT toute écriture.
 */

/**
 * Valide un slug de fonction : [a-z0-9_], non vide, longueur raisonnable.
 * @param {unknown} raw
 * @returns {string} slug normalisé (trim) si valide, '' sinon.
 */
function normalizeFonctionSlug(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  if (s.length > 64) return '';
  if (!/^[a-z0-9_]+$/.test(s)) return '';
  return s;
}

/**
 * Valide un libellé : chaîne non vide (après trim).
 * @param {unknown} raw
 * @returns {string} libellé trimé si valide, '' sinon.
 */
function normalizeLibelle(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return s;
}

/**
 * Normalise l'ordre d'affichage. Défaut 9990 si absent/non numérique.
 * @param {unknown} raw
 * @param {number} [fallback=9990]
 * @returns {number}
 */
function normalizeOrdre(raw, fallback) {
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  return typeof fallback === 'number' ? fallback : 9990;
}

module.exports = { normalizeFonctionSlug, normalizeLibelle, normalizeOrdre };
