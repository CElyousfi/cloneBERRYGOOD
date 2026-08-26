'use strict';
// @ts-check

/**
 * Module pur — dérivation de la période de rapprochement d'une transaction.
 *
 * Le `docId` produit ici DOIT rester identique à celui de `_periodeBounds`
 * (`functions/index.js`, bloc Sprint 3 Rapprochement) : c'est la même clé qui
 * adresse `caisse_rapprochements/${caisse_id}_${docId}`.
 *
 * Aucune écriture Firestore, aucune I/O.
 */

const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/**
 * @typedef {Object} Periode
 * @property {number} mois   Mois 1-12.
 * @property {number} annee  Année 4 chiffres.
 * @property {string} docId  Clé période `YYYY-MM`.
 * @property {string} label  Libellé humain, ex. `Août 2026`.
 */

/**
 * Période de rapprochement correspondant à une date de transaction.
 *
 * @param {string} [dateStr] Date ISO courte `YYYY-MM-DD`.
 * @returns {Periode|null} `null` si la date est absente ou mal formée.
 */
function periodeFromDate(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const annee = parseInt(m[1], 10);
  const mois = parseInt(m[2], 10);
  const jour = parseInt(m[3], 10);
  if (mois < 1 || mois > 12) return null;
  if (annee < 2000 || annee > 2100) return null;
  const lastDay = new Date(annee, mois, 0).getDate(); // jour 0 du mois suivant
  if (jour < 1 || jour > lastDay) return null;
  const mm = String(mois).padStart(2, '0');
  return { mois, annee, docId: `${annee}-${mm}`, label: `${MOIS_FR[mois - 1]} ${annee}` };
}

/**
 * Identifiant du document `caisse_rapprochements` pour un couple (caisse, date).
 *
 * @param {string} caisseId
 * @param {string} [dateStr] Date ISO courte `YYYY-MM-DD`.
 * @returns {string|null} `null` si la date est invalide.
 */
function rapprochementDocId(caisseId, dateStr) {
  const p = periodeFromDate(dateStr);
  if (!p || !caisseId) return null;
  return `${caisseId}_${p.docId}`;
}

/**
 * Couples (caisse, date) dont le rapprochement doit être vérifié avant
 * modification : la position d'origine ET la position cible. Dédupliqué.
 *
 * @param {{caisse_id?: string, date?: string}} before État avant modification.
 * @param {{caisse_id?: string, date?: string}} after  État après modification.
 * @returns {Array<{caisseId: string, date: string, docId: string, label: string}>}
 */
function periodesAVerifier(before, after) {
  /** @type {Array<{caisseId: string, date: string, docId: string, label: string}>} */
  const out = [];
  const seen = new Set();
  for (const state of [before, after]) {
    if (!state) continue;
    const caisseId = state.caisse_id;
    const p = periodeFromDate(state.date);
    if (!caisseId || !p) continue;
    const docId = `${caisseId}_${p.docId}`;
    if (seen.has(docId)) continue;
    seen.add(docId);
    out.push({ caisseId, date: String(state.date), docId, label: p.label });
  }
  return out;
}

module.exports = { periodeFromDate, rapprochementDocId, periodesAVerifier, MOIS_FR }
