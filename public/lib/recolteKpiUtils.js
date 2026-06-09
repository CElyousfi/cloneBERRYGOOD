/**
 * recolteKpiUtils.js — Pure helpers for the "Coût Récolte" screen KPI cards.
 *
 * Loaded twice (UMD-bricolé) :
 *   - Browser : <script src="lib/recolteKpiUtils.js"> → window.RecolteKpiUtils
 *   - node:test : require('./recolteKpiUtils.js') → module.exports
 *
 * All functions are pure (no DOM, no network, no Firestore).
 *
 * Item « fix coût récolte : KPI suivent la période + fallback variété/culture » — 2026-06.
 *
 * Contexte BUG 2 : les KPI cards (Coût Net/Brut/Total, Total Kg, Ouvriers,
 * Coût Moyen/Ouvrier/Jour) doivent s'agréger sur la MÊME plage que le graphe
 * « Historique DH/Kg » (7/30/60/90 jours), pas seulement sur le jour courant.
 */
// @ts-check
'use strict';

/**
 * Agrège une série de jours (déjà agrégés par jour) en KPI de période.
 *
 * Chaque entrée de `daySeries` représente UN jour de la fenêtre sélectionnée,
 * avec ses coûts déjà calculés (salaire/transport/prime/charges) et le nombre
 * d'ouvrier-jours du jour (`nbOuvJour` = nb d'ouvriers distincts CE jour-là).
 *
 * - Coûts (salaire/transport/prime/charges) : SOMME sur la plage.
 * - Total Kg : SOMME sur la plage.
 * - coutMoyenOuvrierJour : moyenne PONDÉRÉE = somme des coûts / somme des
 *   (ouvrier×jour). PAS une moyenne de moyennes journalières.
 * - totalOuvrierJours : somme des nbOuvJour (dénominateur de la moyenne).
 *
 * Le nombre d'ouvriers DISTINCTS sur la période n'est pas dérivable d'une
 * série déjà agrégée par jour ; il est fourni séparément par l'appelant
 * (cf. `distinctOuvriersFromRows`).
 *
 * @param {Array<{salaire?:number, transport?:number, prime?:number, charges?:number, kg?:number, nbOuvJour?:number}>} daySeries
 * @returns {{
 *   totalSalaire:number, totalTransport:number, totalPrime:number, totalCharges:number,
 *   totalCout:number, totalKg:number, totalOuvrierJours:number,
 *   dhParKgBrut:(number|null), coutMoyenOuvrierJour:number
 * }}
 */
function aggregatePeriodKpis(daySeries) {
  const rows = Array.isArray(daySeries) ? daySeries : [];
  let totalSalaire = 0;
  let totalTransport = 0;
  let totalPrime = 0;
  let totalCharges = 0;
  let totalKg = 0;
  let totalOuvrierJours = 0;
  rows.forEach(function (d) {
    totalSalaire += d.salaire || 0;
    totalTransport += d.transport || 0;
    totalPrime += d.prime || 0;
    totalCharges += d.charges || 0;
    totalKg += d.kg || 0;
    totalOuvrierJours += d.nbOuvJour || 0;
  });
  const totalCout = totalSalaire + totalTransport + totalPrime + totalCharges;
  const dhParKgBrut = totalKg > 0 ? Math.round((totalCout / totalKg) * 100) / 100 : null;
  // Moyenne PONDÉRÉE (somme coûts / somme ouvrier-jours), arrondi DH entier
  // pour rester cohérent avec l'affichage existant du jour.
  const coutMoyenOuvrierJour = totalOuvrierJours > 0 ? Math.round(totalCout / totalOuvrierJours) : 0;
  return {
    totalSalaire: totalSalaire,
    totalTransport: totalTransport,
    totalPrime: totalPrime,
    totalCharges: totalCharges,
    totalCout: totalCout,
    totalKg: totalKg,
    totalOuvrierJours: totalOuvrierJours,
    dhParKgBrut: dhParKgBrut,
    coutMoyenOuvrierJour: coutMoyenOuvrierJour,
  };
}

/**
 * Coût logistique net agrégé sur une série de jours logistique.
 * dhParKgNet = (coût récolte + coût logistique) / kg récolté.
 *
 * @param {number} totalCoutRecolte coût récolte sommé sur la plage
 * @param {number} totalLogCout coût logistique sommé sur la plage
 * @param {number} totalKg kg récolté sommé sur la plage
 * @returns {{dhParKgLog:(number|null), dhParKgNet:(number|null)}}
 */
function computeNetDhParKg(totalCoutRecolte, totalLogCout, totalKg) {
  const dhParKgLog = totalKg > 0 ? Math.round((totalLogCout / totalKg) * 100) / 100 : null;
  const dhParKgNet = totalKg > 0 ? Math.round(((totalCoutRecolte + totalLogCout) / totalKg) * 100) / 100 : null;
  return { dhParKgLog: dhParKgLog, dhParKgNet: dhParKgNet };
}

/**
 * Nombre d'ouvriers DISTINCTS (matricules uniques) sur un ensemble de lignes.
 * Sémantique du KPI « Ouvriers Récolte » (libellé sans « /jour ») =
 * effectif distinct ayant récolté sur la période.
 *
 * @param {Array<{matricule?:string, nom?:string}>} rows
 * @returns {number}
 */
function distinctOuvriersFromRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const seen = {};
  let n = 0;
  list.forEach(function (r) {
    const key = (r.matricule || r.nom || '').toString().toUpperCase().trim();
    if (!key) return;
    if (!seen[key]) {
      seen[key] = true;
      n += 1;
    }
  });
  return n;
}

// ============================================================================
// UMD-style export (browser global + CommonJS for node:test)
// ============================================================================

const __recolteKpiApi = {
  aggregatePeriodKpis: aggregatePeriodKpis,
  computeNetDhParKg: computeNetDhParKg,
  distinctOuvriersFromRows: distinctOuvriersFromRows,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __recolteKpiApi;
if (typeof window !== 'undefined') window.RecolteKpiUtils = __recolteKpiApi;
