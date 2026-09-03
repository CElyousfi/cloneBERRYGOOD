/**
 * paieUtils.js (BACKEND) — COPIE de public/lib/paieUtils.js.
 *
 * ── POURQUOI UNE COPIE, ET PAS UN require('../../public/lib/paieUtils.js') ──
 * Firebase ne déploie QUE le dossier `functions/`. Un require vers `public/`
 * passe en local et échoue au chargement en production : le module est
 * introuvable, la Cloud Function crashe AU LOAD, et TOUTES les fonctions du
 * même fichier tombent avec elle — sans qu'aucun test local ne le voie
 * (mémoire projet `backend-jamais-require-public`).
 *
 * ── COMMENT LA DIVERGENCE EST ATTRAPÉE ─────────────────────────────────────
 * Une copie qui dérive de son original est pire que pas de copie : deux écrans
 * afficheraient deux paies différentes pour le même ouvrier. Le fichier de test
 * `__tests__/paieUtils.parite.test.js` charge LES DEUX modules et compare leurs
 * sorties sur une batterie de cas. Toute modification faite d'un seul côté fait
 * tomber la gate.
 *
 * NE PAS modifier ce fichier seul : la source reste public/lib/paieUtils.js.
 */
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
   *   tauxCnssSalariale?: number,
   *   tauxAmo?: number,
   *   paliers: Array<{ seuilJours: number, pourcentage: number, label: string }>,
   *   smagHistory?: Array<{ dateFrom: string, smagBrutJournalier: number, smagNetJournalier: number }>
   * }}
   */
  const PAIE_BAREMES_DEFAULT = {
    smagBrutJournalier: 97.44,
    smagNetJournalier: 90.88,
    joursParMois: 26,
    heuresNormalesParJour: 8,
    tauxChargesPatronales: 0.1926,
    tauxCotisationsSalariales: 0.0674,
    // Modèle paie complet validé Omar 2026-06 : retenues salariales détaillées (déclaré).
    tauxCnssSalariale: 0.0448,
    tauxAmo: 0.0226,
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
   * Core payroll formula (PaieTab) — modèle validé Omar 2026-06.
   * SMAG base = BRUT pour TOUS (déclarés ET non-déclarés). AUCUNE retenue salariale
   * (cotisationsSalariales = 0 partout). Net ouvrier = brut + primes pour tous.
   *   - NON-DÉCLARÉ : (base brut + prime fonction) × jours, pas de CNSS patronale,
   *     pas de prime d'ancienneté. net = brut ; coutEmployeur = brut.
   *   - DÉCLARÉ : (base brut + prime fonction) × jours + prime d'ancienneté ; la société
   *     paie EN PLUS la CNSS patronale (chargesPatronales) → impacte UNIQUEMENT
   *     coutEmployeur, pas le net. net = brut ; coutEmployeur = brut + chargesPatronales.
   * Forme de sortie inchangée (consommée par PaieTab) ; seules les valeurs changent
   * (base brut pour tous, cotisationsSalariales = 0, net = brut).
   *
   * Prime de fonction (primeFonctionJour, DH/jour) — optionnelle, rétro-compatible :
   * absente ou 0 → comportement strictement identique au modèle d'origine. Quand
   * présente, elle entre dans la base AVANT l'ancienneté (cohérent avec computeWorkerPaie)
   * → brut déclaré = (SMAG brut×jours + prime fonction×jours) × (1 + ancienneté%).
   * @param {{ declare: boolean, joursTravailles: number, anciennete: number, baremes?: object, primeFonctionJour?: number }} args
   * @returns {{ net: number, brut: number, prime: number, palier: string, pourcentage: number,
   *   chargesPatronales: number, cotisationsSalariales: number, coutEmployeur: number }}
   */
  function calculerPaieOuvrier({ declare, joursTravailles, anciennete, baremes, primeFonctionJour }) {
    const jrs = Number(joursTravailles) || 0;
    const b = { ...PAIE_BAREMES_DEFAULT, ...(baremes || {}) };
    const primeFonctionTotal = (Number(primeFonctionJour) || 0) * jrs;
    const brutBase = (b.smagBrutJournalier || 0) * jrs + primeFonctionTotal;
    if (!declare) {
      // Non-déclaré : base brut (+ prime fonction), pas de CNSS, pas d'ancienneté, pas de retenue.
      return {
        net: brutBase, brut: brutBase, prime: 0, palier: '—', pourcentage: 0,
        chargesPatronales: 0, cotisationsSalariales: 0, coutEmployeur: brutBase,
      };
    }
    const { palier, pourcentage } = trouverPalierAnciennete(anciennete || 0, b.paliers);
    const prime = brutBase * (pourcentage / 100);
    const brut = brutBase + prime;
    // Modèle validé Omar 2026-06 : aucune retenue salariale ; net = brut.
    // La CNSS patronale s'ajoute uniquement au coût employeur du déclaré.
    const chargesPat = brut * (b.tauxChargesPatronales || 0);
    return {
      net: brut, brut, prime, palier, pourcentage,
      chargesPatronales: chargesPat, cotisationsSalariales: 0,
      coutEmployeur: brut + chargesPat,
    };
  }

  /**
   * Resolve the SMAG (brut/net daily) applicable at a given date.
   * If baremes.smagHistory exists (array of {dateFrom, smagBrutJournalier, smagNetJournalier}),
   * pick the most recent entry whose dateFrom <= dateISO. Otherwise (or if no entry matches,
   * e.g. dateISO before the first dateFrom), fall back to the flat fields.
   * @param {object} baremes
   * @param {string} [dateISO] - 'YYYY-MM-DD'. If omitted, falls back to flat fields.
   * @returns {{ smagBrutJournalier: number, smagNetJournalier: number }}
   */
  function resolveSmagForDate(baremes, dateISO) {
    /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
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
   *   - Heures supplémentaires (HS) ARE part of the gross (added BEFORE charges patronales).
   *     Hourly rate = SMAG BRUT / heuresNormalesParJour for ALL workers (déclaré ET
   *     non-déclaré sont payés sur le brut). Markups: HS 25% ×1.25, HS 50% ×1.5, HS 100% ×2.
   *     ⚠️ Valorisation hypothesis (taux horaire = SMAG brut/h normales, défaut 8h ;
   *     majorations 1,25/1,5/2) — à confirmer Omar.
   *   - Prime de transport is a reimbursement: it is NOT in the brut. It is added to the net
   *     and to the employer cost as a separate line.
   *   - Prime de récolte is OUTSIDE the brut: added to net & employer cost only.
   *     // TODO confirmer Omar: prime récolte soumise aux charges patronales ?
   *   - Modèle validé Omar 2026-06 : SMAG base = BRUT pour TOUS ; AUCUNE retenue salariale
   *     (cotisationsSalariales = 0 partout) ; net = brut + primes pour tous.
   *     DÉCLARÉ : la société paie EN PLUS la CNSS patronale (chargesPatronales) → impacte
   *     UNIQUEMENT coutTotalEmployeur, pas le net ouvrier.
   *     NON-DÉCLARÉ : pas de CNSS (chargesPatronales = 0), pas de prime d'ancienneté.
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
    // Tous les ouvriers sont payés sur le SMAG brut → les HS se valorisent sur le brut
    // (déclaré ET non-déclaré), modèle validé Omar 2026-06.
    const smagJourForHS = smag.smagBrutJournalier;
    const tauxHoraire = heuresNormalesParJour > 0 ? smagJourForHS / heuresNormalesParJour : 0;
    const montantHS = h25 * tauxHoraire * 1.25 + h50 * tauxHoraire * 1.5 + h100 * tauxHoraire * 2;
    const heuresSup = { h25, h50, h100, tauxHoraire, montant: montantHS };

    if (!isDeclare) {
      // ARBITRAGE 2026-08-21 — ALIGNEMENT SUR LES BULLETINS.
      // Tout le monde est payé NET, déclaré comme non déclaré : sur les trois
      // quinzaines, la colonne « Montant » vaut brut × 0,933 sur LES DEUX
      // feuilles, et la feuille VIREMENT totalise exactement ce montant-là.
      // Remplace l'arbitrage 2026-06 (« payé sur le brut, aucune retenue »).
      //
      // Le non-déclaré ne reverse rien : ce qu'il touche EST le coût entreprise.
      const retenue = 1 - ((Number(b.tauxCnssSalariale) || 0) + (Number(b.tauxAmo) || 0));
      const smagBaseTotal = smag.smagBrutJournalier * jrs;
      const brut = smagBaseTotal + primeFonction + montantHS;
      // Primes de terrain hors retenue : ce n'est pas du salaire.
      const net = brut * retenue + transport + recolte;
      return {
        statutDeclare: false,
        smagBaseJour: smag.smagBrutJournalier,
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
    // Modèle validé Omar 2026-06 : la prime de fonction entre dans la base AVANT
    // l'ancienneté → brut = (SMAG brut×jours + prime fonction×jours) × (1 + ancienneté%).
    const baseAnciennete = smagBaseTotal + primeFonction;
    const primeAnciennete = baseAnciennete * (pourcentage / 100);
    // Taxable gross = base (SMAG brut + prime de fonction) + prime ancienneté + heures sup.
    const brut = baseAnciennete + primeAnciennete + montantHS;
    // ARBITRAGE 2026-08-21 : le déclaré est payé NET, comme sur son bulletin.
    // La part salariale n'est pas perdue pour autant — l'entreprise la REVERSE à
    // la CNSS. Elle est donc dans le coût, mais À TRAVERS le brut, pas en plus :
    //     coût = net + salariales + patronales = brut + patronales
    // L'ajouter une seconde fois au brut la compterait deux fois.
    const retenue = 1 - ((Number(b.tauxCnssSalariale) || 0) + (Number(b.tauxAmo) || 0));
    const cotisationsSalariales = brut * (1 - retenue);
    const chargesPatronales = brut * (b.tauxChargesPatronales || 0);
    const net = brut * retenue + transport + recolte;
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

  /**
   * Modèle de paie COMPLET — validé Omar 2026-06 contre le fichier Excel de référence.
   *
   * Fonction pure : retourne TOUT le breakdown en nombres NON arrondis (l'AFFICHAGE
   * arrondit à 2 décimales), plus `netArrondi` (entier, arrondi au plus proche).
   * Aucune lecture Firestore, aucun DOM, aucun formatage.
   *
   * DÉCLARÉ (declare = true) :
   *   base          = smagBrut × jT
   *   feries        = smagBrut × jF
   *   anciennete    = (base + feries) × ancienneteTaux        (ex 0.05, 0.10…)
   *   primeFonction = primeFonctionJour × (jT + jF)            (interprété BRUT)
   *   primesOpt     = somme(primesOptionnelles)                (def 0)
   *   BRUT          = base + feries + anciennete + primeFonction + primesOpt
   *   cnss          = BRUT × tauxCnssSalariale  (def 0.0448)
   *   amo           = BRUT × tauxAmo            (def 0.0226)
   *   NET           = BRUT − cnss − amo
   *   chargesPat    = BRUT × tauxChargesPatronales (def 0.26)
   *   coutEmployeur = BRUT + chargesPat          (transport EXCLU, séparé)
   *
   * NON DÉCLARÉ (declare = false) :
   *   base          = smagNet × jT
   *   primeFonction = primeFonctionJour × jT                   (interprété NET)
   *   pas d'ancienneté, pas de fériés, pas de retenue, pas de charge patronale
   *   BRUT = NET = coutEmployeur = base + primeFonction
   *
   * Le transport est séparé dans les deux cas (jamais inclus dans ces montants).
   * netArrondi = Math.round(NET) (au plus proche, validé Omar — PAS floor).
   *
   * @param {{
   *   declare: boolean,
   *   smagBrut?: number,
   *   smagNet?: number,
   *   jT?: number,
   *   jF?: number,
   *   ancienneteTaux?: number,
   *   primeFonctionJour?: number,
   *   primesOptionnelles?: number | Array<number> | Object<string, number>,
   *   baremes?: object
   * }} args
   * @returns {{
   *   declare: boolean,
   *   smagBase: number, jT: number, jF: number,
   *   base: number, feries: number,
   *   ancienneteTaux: number, anciennete: number,
   *   primeFonctionJour: number, primeFonction: number,
   *   primesOptionnelles: number,
   *   brut: number,
   *   tauxCnss: number, cnss: number,
   *   tauxAmo: number, amo: number,
   *   net: number,
   *   tauxChargesPatronales: number, chargesPatronales: number,
   *   coutEmployeur: number,
   *   netArrondi: number
   * }}
   */
  function computePayslip({ declare, smagBrut, smagNet, jT, jF, ancienneteTaux, primeFonctionJour, primesOptionnelles, baremes }) {
    const b = { ...PAIE_BAREMES_DEFAULT, ...(baremes || {}) };
    const jTn = Number(jT) || 0;
    const jFn = Number(jF) || 0;
    const pfJour = Number(primeFonctionJour) || 0;

    // Somme des primes optionnelles, tolérant nombre | tableau | objet de montants.
    let primesOpt = 0;
    if (Array.isArray(primesOptionnelles)) {
      primesOpt = primesOptionnelles.reduce((s, v) => s + (Number(v) || 0), 0);
    } else if (primesOptionnelles && typeof primesOptionnelles === 'object') {
      primesOpt = Object.keys(primesOptionnelles).reduce((s, k) => s + (Number(primesOptionnelles[k]) || 0), 0);
    } else {
      primesOpt = Number(primesOptionnelles) || 0;
    }

    if (!declare) {
      // Le SMAG est déjà pris NET ici (barème `smagNetJournalier`). Il manquait
      // la même retenue sur la prime de fonction et sur les primes optionnelles :
      // la prime est stockée en BRUT au registre, donc l'appliquer telle quelle
      // donnait au non-déclaré 6,74 % de prime de plus qu'à son collègue déclaré.
      // Cf. l'arbitrage 2026-08-21 documenté dans computeWorkerPaie.
      const retenue = 1 - ((Number(b.tauxCnssSalariale) || 0) + (Number(b.tauxAmo) || 0));
      const smagBase = smagNet != null ? (Number(smagNet) || 0) : (Number(b.smagNetJournalier) || 0);
      const base = smagBase * jTn;
      // JOURS FÉRIÉS — au MÊME SMAG que les journées travaillées de cette
      // branche. `jF` était ignoré et `feries` forcé à 0 : le férié d'un non
      // déclaré ne valait RIEN.
      //
      // Mesuré le 2026-08-22 sur le 30/07 : 24 journées fériées valorisées, 40
      // à zéro (13 non-déclarés + 27 sans fiche, traités comme non-déclarés).
      // D'où un jour férié payé ~46 DH en moyenne au lieu de 90,87 — la moitié.
      // Le fichier de paie, lui, porte bien une colonne « Jour férié » sur la
      // feuille SANS CNSS (29 journées sur la quinzaine d'août) et l'inclut
      // dans le Montant Brut.
      //
      // Rien ne le signalait : un non-déclaré n'a ni CNSS ni ancienneté, et
      // « pas de férié non plus » passait pour une conséquence du statut.
      const feries = smagBase * jFn;
      // La prime de fonction porte sur les journées fériées AUSSI, comme dans la
      // branche déclarée (`pfJour * (jTn + jFn)`) : un ouvrier ne perd pas sa
      // fonction un jour férié.
      const primeFonction = pfJour * (jTn + jFn) * retenue;
      // `primesOpt` était calculé puis JAMAIS ajouté dans cette branche : les
      // heures sup d'un non-déclaré disparaissaient de son net sans rien lever.
      const net = base + feries + primeFonction + primesOpt * retenue;
      return {
        declare: false,
        smagBase, jT: jTn, jF: jFn,
        base, feries,
        ancienneteTaux: 0, anciennete: 0,
        primeFonctionJour: pfJour, primeFonction,
        primesOptionnelles: primesOpt,
        brut: net,
        tauxCnss: 0, cnss: 0,
        tauxAmo: 0, amo: 0,
        net,
        tauxChargesPatronales: 0, chargesPatronales: 0,
        coutEmployeur: net,
        netArrondi: Math.round(net),
      };
    }

    const smagBase = smagBrut != null ? (Number(smagBrut) || 0) : (Number(b.smagBrutJournalier) || 0);
    const ancTaux = Number(ancienneteTaux) || 0;
    const base = smagBase * jTn;
    const feries = smagBase * jFn;
    const anciennete = (base + feries) * ancTaux;
    const primeFonction = pfJour * (jTn + jFn);
    const brut = base + feries + anciennete + primeFonction + primesOpt;
    const tauxCnss = Number(b.tauxCnssSalariale) || 0;
    const tauxAmo = Number(b.tauxAmo) || 0;
    const cnss = brut * tauxCnss;
    const amo = brut * tauxAmo;
    const net = brut - cnss - amo;
    const tauxChargesPatronales = Number(b.tauxChargesPatronales) || 0;
    const chargesPatronales = brut * tauxChargesPatronales;
    return {
      declare: true,
      smagBase, jT: jTn, jF: jFn,
      base, feries,
      ancienneteTaux: ancTaux, anciennete,
      primeFonctionJour: pfJour, primeFonction,
      primesOptionnelles: primesOpt,
      brut,
      tauxCnss, cnss,
      tauxAmo, amo,
      net,
      tauxChargesPatronales, chargesPatronales,
      coutEmployeur: brut + chargesPatronales,
      netArrondi: Math.round(net),
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
    computePayslip,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __paieUtilsApi;
  if (typeof window !== 'undefined') window.PaieUtils = __paieUtilsApi;

})();
