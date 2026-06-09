/**
 * paieUtils.js — Pure helpers for the unified worker payroll formula.
 *
 * Loaded twice:
 *   - In the browser via <script src="lib/paieUtils.js"> → exposes window.PaieUtils
 *   - In node:test via require('./paieUtils.js') → exposes module.exports
 *
 * All functions are pure (no DOM, no network, no Firestore).
 *
 * Source of truth for the payroll model used by:
 *   - the "Paie" tab (PaieTab) — periodic cost computation
 *   - the "Pointage du jour" worker popup — per-day estimated breakdown
 *
 * Phase 1 (2026-06) — initial creation. Extracted (single source) from app.jsx:
 *   trouverPalierAnciennete / calculerPaieOuvrier / PAIE_BAREMES_DEFAULT,
 *   plus new resolveSmagForDate (dated SMAG) and computeWorkerPaie (full breakdown
 *   with prime de fonction + prime transport).
 *
 * IMPORTANT global-name discipline (anti-boot-crash): this module uses the UNIQUE
 * name `__paieUtilsApi` for its export object and `window.PaieUtils` for the global.
 * Never reuse `__api` (collides with caisseUtils → React #200 at boot).
 */
// @ts-check
'use strict';

// IIFE-wrapped (anti-boot-crash): NO top-level name (calculerPaieOuvrier,
// trouverPalierAnciennete, PAIE_BAREMES_DEFAULT, resolveSmagForDate,
// computeWorkerPaie, __paieUtilsApi) must leak to the global scope. app.jsx (app.js)
// declares wrappers with the same names at top-level; a second global declaration
// here would be a duplicate global property → SyntaxError on Safari/iOS (issue #77).
// Only window.PaieUtils (browser) and module.exports (node) are exposed.
(function () {

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  /**
   * Default payroll barèmes. Mirrors app_settings/paie_baremes defaults.
   * @type {{
   *   smagBrutJournalier: number,
   *   smagNetJournalier: number,
   *   joursParMois: number,
   *   heuresNormalesParJour?: number,
   *   tauxChargesPatronales: number,
   *   tauxCotisationsSalariales: number,
   *   paliers: Array<{ seuilJours: number, pourcentage: number, label: string }>,
   *   smagHistory?: Array<{ dateFrom: string, smagBrutJournalier: number, smagNetJournalier: number }>
   * }}
   */
  const PAIE_BAREMES_DEFAULT = {
    smagBrutJournalier: 88.58,
    smagNetJournalier: 82.61,
    joursParMois: 26,
    heuresNormalesParJour: 8,
    tauxChargesPatronales: 0.26,
    tauxCotisationsSalariales: 0.0674,
    paliers: [
      { seuilJours: 624, pourcentage: 5, label: '≥ 2 ans' },
      { seuilJours: 1560, pourcentage: 10, label: '≥ 5 ans' },
      { seuilJours: 3120, pourcentage: 15, label: '≥ 10 ans' },
    ],
  };

  // ============================================================================
  // FUNCTIONS
  // ============================================================================

  /**
   * Find the seniority bracket (palier) applicable to a given seniority in worked days.
   * Picks the highest seuil whose threshold is reached.
   * @param {number} anciennete — seniority, in distinct worked days.
   * @param {Array<{ seuilJours: number, pourcentage: number, label: string }>} paliers
   * @returns {{ palier: string, pourcentage: number }}
   */
  function trouverPalierAnciennete(anciennete, paliers) {
    const sorted = [...(paliers || [])].sort((a, b) => (b.seuilJours || 0) - (a.seuilJours || 0));
    const p = sorted.find(x => anciennete >= (x.seuilJours || 0));
    return { palier: (p && p.label) || '—', pourcentage: (p && p.pourcentage) != null ? p.pourcentage : 0 };
  }

  /**
   * Core payroll formula — UNCHANGED behaviour from app.jsx (single source of truth).
   * Non-declared worker → net = SMAG net × jours, no charges, no seniority prime.
   * Declared worker → SMAG brut × jours + seniority prime, then patronal/salarial rates.
   * @param {{ declare: boolean, joursTravailles: number, anciennete: number, baremes?: object }} args
   * @returns {{ net: number, brut: number, prime: number, palier: string, pourcentage: number,
   *   chargesPatronales: number, cotisationsSalariales: number, coutEmployeur: number }}
   */
  function calculerPaieOuvrier({ declare, joursTravailles, anciennete, baremes }) {
    const jrs = Number(joursTravailles) || 0;
    const b = { ...PAIE_BAREMES_DEFAULT, ...(baremes || {}) };
    if (!declare) {
      const net = (b.smagNetJournalier || 0) * jrs;
      return {
        net, brut: net, prime: 0, palier: '—', pourcentage: 0,
        chargesPatronales: 0, cotisationsSalariales: 0, coutEmployeur: net,
      };
    }
    const brutBase = (b.smagBrutJournalier || 0) * jrs;
    const { palier, pourcentage } = trouverPalierAnciennete(anciennete || 0, b.paliers);
    const prime = brutBase * (pourcentage / 100);
    const brut = brutBase + prime;
    const cotisSal = brut * (b.tauxCotisationsSalariales || 0);
    const chargesPat = brut * (b.tauxChargesPatronales || 0);
    return {
      net: brut - cotisSal, brut, prime, palier, pourcentage,
      chargesPatronales: chargesPat, cotisationsSalariales: cotisSal,
      coutEmployeur: brut + chargesPat,
    };
  }

  /**
   * Resolve the SMAG (brut/net daily) applicable at a given date.
   * If baremes.smagHistory exists (array of {dateFrom, smagBrutJournalier, smagNetJournalier}),
   * pick the most recent entry whose dateFrom <= dateISO. Otherwise (or if no entry matches,
   * e.g. dateISO before the first dateFrom), fall back to the flat fields.
   * @param {object} baremes
   * @param {string} [dateISO] — 'YYYY-MM-DD'. If omitted, falls back to flat fields.
   * @returns {{ smagBrutJournalier: number, smagNetJournalier: number }}
   */
  function resolveSmagForDate(baremes, dateISO) {
    const b = baremes || {};
    const flat = {
      smagBrutJournalier: Number(b.smagBrutJournalier) || 0,
      smagNetJournalier: Number(b.smagNetJournalier) || 0,
    };
    const hist = Array.isArray(b.smagHistory) ? b.smagHistory : null;
    if (!hist || !hist.length || !dateISO) return flat;
    const eligible = hist
      .filter(h => h && typeof h.dateFrom === 'string' && h.dateFrom <= dateISO)
      .sort((a, b2) => (a.dateFrom < b2.dateFrom ? 1 : a.dateFrom > b2.dateFrom ? -1 : 0));
    const e = eligible[0];
    if (!e) return flat;
    return {
      smagBrutJournalier: Number(e.smagBrutJournalier) || 0,
      smagNetJournalier: Number(e.smagNetJournalier) || 0,
    };
  }

  /**
   * Full per-worker payroll breakdown for a given day/period.
   *
   * Model decisions:
   *   - SMAG is resolved by date via resolveSmagForDate (dated SMAG).
   *   - Prime de fonction (DH/day × jours) is added to the taxable gross, exactly like
   *     the seniority prime: it is subject to charges patronales & cotisations salariales.
   *   - Heures supplémentaires (HS) ARE part of the taxable gross (added BEFORE charges).
   *     Hourly rate = daily SMAG / heuresNormalesParJour (declared → SMAG brut,
   *     non-declared → SMAG net). Markups: HS 25% ×1.25, HS 50% ×1.5, HS 100% ×2.
   *     ⚠️ Valorisation hypothesis (taux horaire = SMAG/h normales, défaut 8h ;
   *     majorations 1,25/1,5/2) — à confirmer Omar.
   *   - Prime de transport is a reimbursement: it is NOT taxable. It is added to the net
   *     and to the employer cost as a separate line, outside the brut.
   *   - Prime de récolte is OUTSIDE the taxable gross: added to net & employer cost only,
   *     NOT subject to charges.
   *     // TODO confirmer Omar: prime récolte soumise aux charges ?
   *   - Non-declared worker: no charges, no seniority prime; HS valued on SMAG net.
   *     Primes (fonction, transport, récolte) still paid but carry no charges.
   *
   * Backward-compat: hs25/hs50/hs100/primeRecolte default to 0 → Phase 1 behaviour.
   *
   * @param {{
   *   declare: boolean,
   *   joursTravailles: number,
   *   anciennete: number,
   *   baremes?: object,
   *   dateISO?: string,
   *   primeFonctionJour?: number,
   *   primeTransport?: number,
   *   hs25?: number,
   *   hs50?: number,
   *   hs100?: number,
   *   primeRecolte?: number
   * }} args
   * @returns {{
   *   statutDeclare: boolean,
   *   smagBaseJour: number,
   *   smagBaseTotal: number,
   *   anciennetePalier: string,
   *   anciennetePourcent: number,
   *   primeAnciennete: number,
   *   primeFonction: number,
   *   heuresSup: { h25: number, h50: number, h100: number, tauxHoraire: number, montant: number },
   *   brut: number,
   *   cotisationsSalariales: number,
   *   chargesPatronales: number,
   *   primeTransport: number,
   *   primeRecolte: number,
   *   net: number,
   *   coutEmployeur: number,
   *   coutTotalEmployeur: number
   * }}
   */
  function computeWorkerPaie({ declare, joursTravailles, anciennete, baremes, dateISO, primeFonctionJour, primeTransport, hs25, hs50, hs100, primeRecolte }) {
    const jrs = Number(joursTravailles) || 0;
    const b = { ...PAIE_BAREMES_DEFAULT, ...(baremes || {}) };
    const smag = resolveSmagForDate(b, dateISO);
    const primeFonction = (Number(primeFonctionJour) || 0) * jrs;
    const transport = Number(primeTransport) || 0;
    const recolte = Number(primeRecolte) || 0;
    const isDeclare = !!declare;

    // Heures supplémentaires valuation (subject to charges → part of brut).
    const h25 = Number(hs25) || 0;
    const h50 = Number(hs50) || 0;
    const h100 = Number(hs100) || 0;
    const heuresNormalesParJour = Number(b.heuresNormalesParJour) || 8;
    const smagJourForHS = isDeclare ? smag.smagBrutJournalier : smag.smagNetJournalier;
    const tauxHoraire = heuresNormalesParJour > 0 ? smagJourForHS / heuresNormalesParJour : 0;
    const montantHS = h25 * tauxHoraire * 1.25 + h50 * tauxHoraire * 1.5 + h100 * tauxHoraire * 2;
    const heuresSup = { h25, h50, h100, tauxHoraire, montant: montantHS };

    if (!isDeclare) {
      const smagBaseTotal = smag.smagNetJournalier * jrs;
      const brut = smagBaseTotal + primeFonction + montantHS;
      const net = brut + transport + recolte;
      return {
        statutDeclare: false,
        smagBaseJour: smag.smagNetJournalier,
        smagBaseTotal,
        anciennetePalier: '—',
        anciennetePourcent: 0,
        primeAnciennete: 0,
        primeFonction,
        heuresSup,
        brut,
        cotisationsSalariales: 0,
        chargesPatronales: 0,
        primeTransport: transport,
        primeRecolte: recolte,
        net,
        coutEmployeur: net,
        coutTotalEmployeur: net,
      };
    }

    const smagBaseTotal = smag.smagBrutJournalier * jrs;
    const { palier, pourcentage } = trouverPalierAnciennete(anciennete || 0, b.paliers);
    const primeAnciennete = smagBaseTotal * (pourcentage / 100);
    // Taxable gross = SMAG brut base + seniority prime + prime de fonction + heures sup.
    const brut = smagBaseTotal + primeAnciennete + primeFonction + montantHS;
    const cotisationsSalariales = brut * (b.tauxCotisationsSalariales || 0);
    const chargesPatronales = brut * (b.tauxChargesPatronales || 0);
    // Transport & récolte are non-taxable → added to net and employer cost only.
    const net = brut - cotisationsSalariales + transport + recolte;
    const coutTotalEmployeur = brut + chargesPatronales + transport + recolte;
    return {
      statutDeclare: true,
      smagBaseJour: smag.smagBrutJournalier,
      smagBaseTotal,
      anciennetePalier: palier,
      anciennetePourcent: pourcentage,
      primeAnciennete,
      primeFonction,
      heuresSup,
      brut,
      cotisationsSalariales,
      chargesPatronales,
      primeTransport: transport,
      primeRecolte: recolte,
      net,
      // coutEmployeur kept as alias for backward-compat (= coutTotalEmployeur).
      coutEmployeur: coutTotalEmployeur,
      coutTotalEmployeur,
    };
  }

  // ============================================================================
  // UMD-style export (browser global + CommonJS for node:test)
  // ============================================================================

  const __paieUtilsApi = {
    PAIE_BAREMES_DEFAULT,
    trouverPalierAnciennete,
    calculerPaieOuvrier,
    resolveSmagForDate,
    computeWorkerPaie,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __paieUtilsApi;
  if (typeof window !== 'undefined') window.PaieUtils = __paieUtilsApi;

})();
