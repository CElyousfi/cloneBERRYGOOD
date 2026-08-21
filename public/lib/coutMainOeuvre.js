/*
 * coutMainOeuvre.js — LE modèle de coût main d'œuvre de Smart Berry.
 *
 * Fonctions PURES, aucune I/O, `PaieUtils` INJECTÉ (jamais lu dans un global) :
 * c'est ce qui permet à ce fichier d'être copié tel quel dans
 * `functions/lib/paie/` sans qu'aucun `require('../public/…')` n'apparaisse —
 * Firebase ne déploie que `functions/`, et un tel require ferait crasher TOUTES
 * les Cloud Functions au chargement (mémoire projet backend-jamais-require-public).
 * Chargé en <script> classique côté navigateur : tout est dans une IIFE, aucun
 * identifiant top-level ne fuite (une collision crashe le boot React #200).
 * Un seul global : window.CoutMainOeuvre
 *
 * ⚠️ CE FICHIER EXISTE EN DEUX EXEMPLAIRES OCTET POUR OCTET :
 *      public/lib/coutMainOeuvre.js  (source de vérité)
 *      functions/lib/paie/coutMainOeuvre.js
 * Il n'a AUCUNE dépendance — `PaieUtils` est un argument — c'est ce qui rend la
 * copie littérale possible, et donc vérifiable par simple comparaison de texte
 * (`functions/lib/paie/__tests__/coutMainOeuvre.parite.test.js`). Modifier un
 * seul des deux fait tomber la gate QA.
 *
 * ── POURQUOI CE MODULE EXISTE ──────────────────────────────────────────────
 * Le coût de la main d'œuvre était calculé à DEUX endroits, avec deux résultats
 * différents pour la même quinzaine :
 *   - inline dans `QuinzaineTab` (public/app.jsx) pour les tuiles de l'écran ;
 *   - dans `functions/lib/paie/coutOuvrierCampagne.js` pour l'écran Campagne.
 * Sur la Quinzaine 03 : ~202 900 DH d'un côté, 182 511 DH de l'autre. Un écran
 * qui affiche deux fois le même coût sous deux montants ne se corrige pas en
 * choisissant le plus plausible : il se corrige en n'ayant plus qu'un calcul.
 *
 * ── LE MODÈLE ──────────────────────────────────────────────────────────────
 * BEE ONE ne fournit QUE la présence : matricule, jour, opération, parcelle.
 * Jamais un dirham (décision d'Omar, 2026-08-21). Tout l'argent vient d'ici.
 *
 *   brut          = SMAG daté × jours + prime de fonction × jours + ancienneté
 *   net à payer   = brut − CNSS salariale − AMO          (déclarés seulement)
 *   coût employeur= brut + charges patronales
 *
 * Les ouvriers sont payés au NET : c'est lui que l'écran Quinzaine affiche dans
 * ses tuiles MO. Le coût employeur s'obtient en rajoutant les DEUX composantes
 * sociales — et pas seulement la patronale :
 *
 *   net + salariales + patronales = brut + patronales = coût employeur
 *
 * Oublier la part salariale (le défaut de la carte « Charges patronales CNSS »)
 * sous-estime le coût de 6,74 % du brut déclaré. Elle est bien un coût pour
 * l'entreprise : l'ouvrier est payé sur le brut, sans retenue, donc ce que la
 * loi prélèverait sur son salaire, la société le verse en plus.
 *
 * ── LINÉARITÉ (ce qui rend la ventilation par catégorie exacte) ────────────
 * `brut` est proportionnel aux jours : SMAG × j, prime de fonction × j, et
 * l'ancienneté est un pourcentage de leur somme. Répartir un ouvrier entre
 * « Récolte », « Hors Récolte » et « Postes fixes » au prorata de ses jours
 * dans chaque catégorie est donc EXACT, pas approché. Cette propriété est
 * verrouillée par un test : si un barème devenait progressif, la ventilation
 * cesserait d'être exacte en silence.
 */
// @ts-check
(function () {
  'use strict';

  /** Catégories MO, dans l'ordre d'affichage des tuiles. */
  var CATEGORIES = ['recolte', 'horsRecolte', 'postes'];

  /**
   * Catégorie MO d'une ligne de pointage, depuis sa famille d'opération. PURE.
   *
   * Défaut « horsRecolte » et non « inconnu » : une famille vide ou non
   * reconnue est du travail réel, qui doit peser quelque part. Le ranger dans
   * une catégorie fantôme le ferait disparaître du total.
   *
   * @param {string} operationFamille
   * @returns {'recolte'|'horsRecolte'|'postes'}
   */
  function categorieMO(operationFamille) {
    var l = String(operationFamille || '').toLowerCase();
    if (l.indexOf('récolte') >= 0 || l.indexOf('recolte') >= 0) return 'recolte';
    if (l.indexOf('poste') >= 0) return 'postes';
    return 'horsRecolte';
  }

  /**
   * Prime de fonction journalière EN VIGUEUR à une date. PURE.
   *
   * Le registre porte un montant courant et un historique de révisions. Une
   * quinzaine passée doit être payée au montant de l'époque, pas au dernier
   * connu — sinon revaloriser une prime réécrit tout l'historique des coûts.
   *
   * @param {Array<{effectiveFrom: string, montant: number, previousMontant: number}>} historique
   * @param {number} montantCourant
   * @param {string} dateISO
   * @returns {number}
   */
  function primeFonctionADate(historique, montantCourant, dateISO) {
    if (!dateISO || !Array.isArray(historique) || historique.length === 0) {
      return Number(montantCourant) || 0;
    }
    var applicables = historique.filter(function (h) {
      return h && h.effectiveFrom && h.effectiveFrom <= dateISO;
    });
    if (applicables.length === 0) {
      // Date ANTÉRIEURE à toute révision connue : c'est le montant d'avant la
      // plus ancienne, pas le montant courant.
      var croissant = historique.slice().sort(function (a, b) {
        return a.effectiveFrom < b.effectiveFrom ? -1 : 1;
      });
      return Number(croissant[0].previousMontant) || 0;
    }
    var decroissant = applicables.slice().sort(function (a, b) {
      return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
    });
    return Number(decroissant[0].montant) || 0;
  }

  /**
   * Jours travaillés par ouvrier ET par catégorie. PURE.
   *
   * Un JOUR par ouvrier et par catégorie, jamais une ligne : un ouvrier pointé
   * trois fois le même jour sur la même catégorie a travaillé un jour. Compter
   * les lignes gonflerait le coût sans que rien ne le signale.
   *
   * @param {Array<{matricule: string, jour: string, operationFamille?: string}>} rows
   * @returns {Object<string, {jours: Object<string, Object>, premierJour: string}>}
   *   matricule → { jours: {categorie: Set-like d'ISO}, premierJour }
   */
  function joursParOuvrier(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r) return;
      var mat = String(r.matricule || '').trim();
      var jour = String(r.jour || '').trim();
      if (!mat || !jour) return;
      var cat = categorieMO(r.operationFamille);
      if (!out[mat]) out[mat] = { jours: {}, premierJour: jour };
      if (!out[mat].jours[cat]) out[mat].jours[cat] = {};
      out[mat].jours[cat][jour] = true;
      if (jour < out[mat].premierJour) out[mat].premierJour = jour;
    });
    return out;
  }

  /** Nombre de jours distincts d'une catégorie pour un ouvrier. PURE. */
  function nbJours(entree, categorie) {
    if (!entree || !entree.jours[categorie]) return 0;
    return Object.keys(entree.jours[categorie]).length;
  }

  /**
   * Fiche de paie d'un ouvrier pour un nombre de jours donné. PURE.
   *
   * @param {Object} args
   * @param {Object} args.paie API PaieUtils INJECTÉE (computePayslip,
   *   resolveSmagForDate, trouverPalierAnciennete).
   * @param {Object} args.fiche fiche registre {declare, baselineJours,
   *   primeFonctionJournaliere, prime_history}.
   * @param {number} args.jours jours travaillés.
   * @param {Object} args.baremes barèmes de paie.
   * @param {string} args.dateISO date de référence (SMAG daté, prime datée).
   * @returns {{brut: number, net: number, chargesPatronales: number,
   *   cotisationsSalariales: number, coutEmployeur: number, declare: boolean}}
   */
  function paieOuvrier(args) {
    var a = args || {};
    var paie = a.paie;
    var fiche = a.fiche || {};
    var baremes = a.baremes || {};
    var jours = Number(a.jours) || 0;
    var vide = { brut: 0, net: 0, chargesPatronales: 0, cotisationsSalariales: 0,
      coutEmployeur: 0, declare: !!fiche.declare };
    if (!paie || typeof paie.computePayslip !== 'function' || jours <= 0) return vide;

    var smag = (typeof paie.resolveSmagForDate === 'function')
      ? paie.resolveSmagForDate(baremes, a.dateISO || null)
      : { smagBrutJournalier: baremes.smagBrutJournalier || 0,
        smagNetJournalier: baremes.smagNetJournalier || 0 };
    var tauxAnc = 0;
    if (typeof paie.trouverPalierAnciennete === 'function') {
      var palier = paie.trouverPalierAnciennete(Number(fiche.baselineJours) || 0,
        baremes.paliers || []);
      tauxAnc = ((palier && palier.pourcentage) || 0) / 100;
    }

    var ps = paie.computePayslip({
      declare: !!fiche.declare,
      smagBrut: smag.smagBrutJournalier,
      smagNet: smag.smagNetJournalier,
      jT: jours,
      jF: 0,
      ancienneteTaux: tauxAnc,
      primeFonctionJour: primeFonctionADate(fiche.prime_history,
        fiche.primeFonctionJournaliere, a.dateISO || null),
      // Les primes de terrain sont HORS assiette : elles s'ajoutent à côté,
      // dans leurs propres tuiles, pour qu'on garde la maîtrise de ce qui
      // cotise. Les y mettre les ferait cotiser sans que rien ne le dise.
      primesOptionnelles: [],
      baremes: baremes,
    });

    return {
      brut: ps.brut || 0,
      net: ps.net || 0,
      chargesPatronales: ps.chargesPatronales || 0,
      // `computePayslip` rend CNSS et AMO séparément ; ensemble, elles font la
      // part salariale que l'entreprise verse en plus du net.
      cotisationsSalariales: (ps.cnss || 0) + (ps.amo || 0),
      coutEmployeur: ps.coutEmployeur || 0,
      declare: !!ps.declare,
    };
  }

  /**
   * Les trois montants MO des tuiles, en NET À PAYER. PURE.
   *
   * Net et non coût employeur : c'est ce que l'ouvrier touche, et c'est la
   * lecture que l'écran Quinzaine doit garder (décision d'Omar). Le coût
   * employeur s'obtient en ajoutant `chargesSociales` — cf. `coutEmployeur`.
   *
   * @param {Object} args {rows, registre, baremes, paie, cleRegistre?}
   * @returns {{recolte: number, horsRecolte: number, postes: number, total: number}}
   */
  function netParCategorie(args) {
    var a = args || {};
    var registre = a.registre || {};
    var cle = typeof a.cleRegistre === 'function' ? a.cleRegistre : function (m) { return m; };
    var parOuvrier = joursParOuvrier(a.rows);
    var out = { recolte: 0, horsRecolte: 0, postes: 0, total: 0 };

    Object.keys(parOuvrier).forEach(function (mat) {
      var e = parOuvrier[mat];
      var fiche = registre[cle(mat)] || {};
      CATEGORIES.forEach(function (cat) {
        var j = nbJours(e, cat);
        if (j <= 0) return;
        var p = paieOuvrier({ paie: a.paie, fiche: fiche, jours: j,
          baremes: a.baremes, dateISO: e.premierJour });
        out[cat] += p.net;
      });
    });
    out.total = out.recolte + out.horsRecolte + out.postes;
    return out;
  }

  /**
   * Les DEUX composantes sociales, sur le brut des ouvriers DÉCLARÉS. PURE.
   *
   * Un non déclaré n'appelle ni l'une ni l'autre — ce n'est pas un oubli, c'est
   * le modèle : il est payé son brut, sans cotisation. Le compteur
   * `nbNonDeclares` est rendu pour que l'écran puisse le dire plutôt que de
   * laisser croire à des charges anormalement basses.
   *
   * @param {Object} args {rows, registre, baremes, paie, cleRegistre?}
   * @returns {{salariales: number, patronales: number, total: number,
   *   brutDeclare: number, nbDeclares: number, nbNonDeclares: number}}
   */
  function chargesSociales(args) {
    var a = args || {};
    var registre = a.registre || {};
    var cle = typeof a.cleRegistre === 'function' ? a.cleRegistre : function (m) { return m; };
    var parOuvrier = joursParOuvrier(a.rows);
    var out = { salariales: 0, patronales: 0, total: 0, brutDeclare: 0,
      nbDeclares: 0, nbNonDeclares: 0 };

    Object.keys(parOuvrier).forEach(function (mat) {
      var e = parOuvrier[mat];
      var fiche = registre[cle(mat)] || {};
      if (!fiche.declare) { out.nbNonDeclares++; return; }
      out.nbDeclares++;
      CATEGORIES.forEach(function (cat) {
        var j = nbJours(e, cat);
        if (j <= 0) return;
        var p = paieOuvrier({ paie: a.paie, fiche: fiche, jours: j,
          baremes: a.baremes, dateISO: e.premierJour });
        out.brutDeclare += p.brut;
        out.salariales += p.cotisationsSalariales;
        out.patronales += p.chargesPatronales;
      });
    });
    out.total = out.salariales + out.patronales;
    return out;
  }

  /**
   * Coût EMPLOYEUR d'une quinzaine : les 7 postes énumérés par Omar. PURE.
   *
   * = MO Récolte + MO Hors Récolte + Postes Fixes + Prime Récolte
   *   + Prime Transport + Autres Primes + Charges Sociales
   *
   * La sous-traitance (Location & Engins) n'en fait PAS partie : c'est un coût
   * de la quinzaine, pas un coût d'employé. Elle s'ajoute dans `totalQuinzaine`.
   *
   * @param {Object} args
   * @param {{recolte: number, horsRecolte: number, postes: number}} args.mo nets.
   * @param {{recolte?: number, transport?: number, autres?: number}} args.primes
   * @param {{total: number}} args.charges
   * @returns {number}
   */
  function coutEmployeur(args) {
    var a = args || {};
    var mo = a.mo || {};
    var primes = a.primes || {};
    var charges = a.charges || {};
    return (Number(mo.recolte) || 0)
      + (Number(mo.horsRecolte) || 0)
      + (Number(mo.postes) || 0)
      + (Number(primes.recolte) || 0)
      + (Number(primes.transport) || 0)
      + (Number(primes.autres) || 0)
      + (Number(charges.total) || 0);
  }

  /** Coût employeur + sous-traitance. PURE. */
  function totalQuinzaine(args) {
    var a = args || {};
    return coutEmployeur(a) + (Number(a.locationEngins) || 0);
  }

  var __coutMainOeuvreApi = {
    CATEGORIES: CATEGORIES,
    categorieMO: categorieMO,
    primeFonctionADate: primeFonctionADate,
    joursParOuvrier: joursParOuvrier,
    paieOuvrier: paieOuvrier,
    netParCategorie: netParCategorie,
    chargesSociales: chargesSociales,
    coutEmployeur: coutEmployeur,
    totalQuinzaine: totalQuinzaine,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __coutMainOeuvreApi;
  if (typeof window !== 'undefined') window.CoutMainOeuvre = __coutMainOeuvreApi;

})();
