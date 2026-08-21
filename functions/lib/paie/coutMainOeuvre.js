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
   * ⚠️ « CAPORAL HORS RÉCOLTE » CONTIENT LE MOT « RÉCOLTE » et désigne
   * exactement son contraire. Une recherche naïve du mot le range dans la
   * récolte — c'est ce que faisait le code d'origine, sans conséquence visible
   * tant que les lignes de récolte étaient jetées, et faux dès qu'on les
   * rétablit. La négation se teste donc AVANT le mot qu'elle nie.
   *
   * Défaut « horsRecolte » et non « inconnu » : une famille vide ou non
   * reconnue est du travail réel, qui doit peser quelque part. Le ranger dans
   * une catégorie fantôme le ferait disparaître du total.
   *
   * @param {string} operationFamille
   * @returns {'recolte'|'horsRecolte'|'postes'}
   */
  function categorieMO(operationFamille) {
    // Accents retirés : BEE ONE écrit aussi bien « Récolte » que « Recolte ».
    var l = String(operationFamille || '').toLowerCase()
      .replace(/[éèêë]/g, 'e').replace(/[àâä]/g, 'a').replace(/[ùûü]/g, 'u')
      .replace(/[ôö]/g, 'o').replace(/[îï]/g, 'i').replace(/ç/g, 'c');
    var parleDeRecolte = l.indexOf('recolte') >= 0;
    if (parleDeRecolte && /\bhors\b/.test(l)) return 'horsRecolte';
    if (parleDeRecolte) return 'recolte';
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
   * Journées DISTINCTES d'un ouvrier, toutes catégories confondues. PURE.
   *
   * ⚠️ Ce n'est PAS la somme des jours par catégorie. Un ouvrier qui fait de la
   * récolte le matin et de la taille l'après-midi apparaît dans DEUX catégories
   * le même jour — mais il n'a travaillé qu'un jour, et il n'est payé qu'un
   * jour.
   *
   * Calculer une paie par catégorie puis les additionner le payait deux fois.
   * Le défaut dormait tant que la récolte n'avait pas commencé (MO Récolte à 0
   * sur toute la campagne) ; il aurait mordu au premier jour de cueillette.
   */
  function nbJoursDistincts(entree) {
    if (!entree) return 0;
    var vus = {};
    CATEGORIES.forEach(function (cat) {
      var m = entree.jours[cat];
      if (m) Object.keys(m).forEach(function (j) { vus[j] = true; });
    });
    return Object.keys(vus).length;
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
   * @param {number} [args.feries] jours fériés PAYÉS. Ils entrent dans la base,
   *   portent la prime de fonction et comptent dans l'assiette de l'ancienneté —
   *   c'est ce que fait le bulletin, dont la colonne « nbr jour » du bloc primes
   *   vaut *jours travaillés + fériés*.
   * @param {Object} args.baremes barèmes de paie.
   * @param {string} args.dateISO date de référence (SMAG daté, prime datée).
   * @returns {{brut: number, net: number, chargesPatronales: number,
   *   cnss: number, amo: number, cotisationsSalariales: number,
   *   coutEmployeur: number, declare: boolean}}
   */
  function paieOuvrier(args) {
    var a = args || {};
    var paie = a.paie;
    var fiche = a.fiche || {};
    var baremes = a.baremes || {};
    var jours = Number(a.jours) || 0;
    var vide = { brut: 0, net: 0, chargesPatronales: 0, cnss: 0, amo: 0,
      cotisationsSalariales: 0, coutEmployeur: 0, declare: !!fiche.declare };
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
      jF: Number(a.feries) || 0,
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
      // CNSS et AMO restent DISTINCTES jusqu'à l'affichage : ce sont deux
      // cotisations, à deux taux, sur deux lignes de bulletin. Les fondre dès
      // le calcul obligerait à les re-déduire pour les montrer, et un total
      // qu'on ne peut plus décomposer est un total qu'on ne peut plus vérifier.
      cnss: ps.cnss || 0,
      amo: ps.amo || 0,
      cotisationsSalariales: (ps.cnss || 0) + (ps.amo || 0),
      coutEmployeur: ps.coutEmployeur || 0,
      declare: !!ps.declare,
    };
  }

  /**
   * Coût des JOURS FÉRIÉS d'un ouvrier — leur coût MARGINAL. PURE.
   *
   * = sa paie sur (jours + fériés) − sa paie sur (jours)
   *
   * Ce n'est pas « jours fériés × SMAG » : un jour férié porte aussi la prime de
   * fonction, et il gonfle l'assiette de l'ancienneté. Le calculer par
   * différence garantit qu'il vaut exactement ce que le bulletin lui donne, quel
   * que soit le détail du barème — plutôt que de réimplémenter la règle et de la
   * laisser diverger.
   *
   * Remplace une valorisation au coût journalier moyen **BEE ONE**, qui était le
   * dernier endroit où de l'argent BEE ONE entrait dans le calcul. Elle donnait
   * 110,6 DH par jour férié là où le bulletin en donne 90,9 — tout en PERDANT la
   * prime de fonction et l'ancienneté de ces journées. Deux erreurs de sens
   * contraire, dont la somme paraissait juste.
   *
   * @param {Object} args mêmes arguments que `paieOuvrier`, + `feries`.
   * @returns {{net: number, brut: number}} coût marginal des fériés.
   */
  function coutFeries(args) {
    var a = args || {};
    var f = Number(a.feries) || 0;
    if (!(f > 0)) return { net: 0, brut: 0 };
    var avec = paieOuvrier(a);
    var sans = paieOuvrier(Object.assign({}, a, { feries: 0 }));
    return { net: avec.net - sans.net, brut: avec.brut - sans.brut };
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
      // UNE seule paie, sur les journées RÉELLEMENT travaillées.
      var joursReels = nbJoursDistincts(e);
      if (joursReels <= 0) return;
      var p = paieOuvrier({ paie: a.paie, fiche: fiche, jours: joursReels,
        baremes: a.baremes, dateISO: e.premierJour });

      // Puis répartition entre catégories, au prorata des jours de chacune. La
      // somme des jours par catégorie peut DÉPASSER les journées réelles (une
      // journée partagée compte dans deux catégories) : c'est précisément
      // pourquoi on divise par elle et non par les journées réelles — sinon la
      // somme des catégories dépasserait la paie de l'ouvrier.
      var sommeCat = CATEGORIES.reduce(function (t, cat) { return t + nbJours(e, cat); }, 0);
      if (sommeCat <= 0) return;
      CATEGORIES.forEach(function (cat) {
        var j = nbJours(e, cat);
        if (j > 0) out[cat] += p.net * (j / sommeCat);
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
   * `detail` porte la LIGNE PAR OUVRIER, y compris les non déclarés (à zéro) :
   * c'est ce qui permet à la pop-up de montrer POURQUOI le total est ce qu'il
   * est. Un agrégat sans son détail se conteste sans pouvoir se vérifier.
   *
   * @param {Object} args {rows, registre, baremes, paie, cleRegistre?}
   * @returns {{cnss: number, amo: number, salariales: number,
   *   patronales: number, total: number, brutDeclare: number,
   *   nbDeclares: number, nbNonDeclares: number, detail: Array<Object>}}
   */
  function chargesSociales(args) {
    var a = args || {};
    var registre = a.registre || {};
    var hsNet = a.heuresSupNet || {};
    var feries = a.feriesParOuvrier || {};
    var b = a.baremes || {};
    var tauxSal = (Number(b.tauxCnssSalariale) || 0) + (Number(b.tauxAmo) || 0);
    var cle = typeof a.cleRegistre === 'function' ? a.cleRegistre : function (m) { return m; };
    var parOuvrier = joursParOuvrier(a.rows);
    var out = { cnss: 0, amo: 0, salariales: 0, patronales: 0, total: 0,
      brutDeclare: 0, nbDeclares: 0, nbNonDeclares: 0, detail: [] };

    Object.keys(parOuvrier).forEach(function (mat) {
      var e = parOuvrier[mat];
      var fiche = registre[cle(mat)] || {};
      var declare = !!fiche.declare;
      var ligne = { matricule: mat, declare: declare, jours: 0, brut: 0, net: 0,
        feries: 0, heuresSup: 0, cnss: 0, amo: 0, salariales: 0, patronales: 0,
        coutEmployeur: 0 };

      // UNE seule paie, sur les journées réellement travaillées — même raison
      // que dans `netParCategorie` : les catégories ne partitionnent pas les
      // journées d'un ouvrier, elles peuvent se chevaucher.
      ligne.jours = nbJoursDistincts(e);
      if (ligne.jours > 0) {
        var p = paieOuvrier({ paie: a.paie, fiche: fiche, jours: ligne.jours,
          baremes: a.baremes, dateISO: e.premierJour });
        ligne.brut += p.brut;
        ligne.net += p.net;
      }

      // HEURES SUPPLÉMENTAIRES — saisies au montant NET (ce que l'ouvrier
      // touche, comme la colonne « Prime heure sup » du bulletin). Elles sont
      // DANS L'ASSIETTE : le bulletin les range dans le brut, donc elles
      // cotisent. On remonte donc au brut avant d'appliquer les taux, sinon on
      // sous-évaluerait les charges de 6,74 % du montant accordé.
      // JOURS FÉRIÉS — coût marginal, ajouté une fois par ouvrier (ils
      // n'appartiennent à aucune catégorie de travail). Dans l'assiette : le
      // bulletin les met dans le brut.
      var nbFer = Number(feries[cle(mat)] || feries[mat]) || 0;
      if (nbFer > 0) {
        var cf = coutFeries({ paie: a.paie, fiche: fiche, jours: ligne.jours,
          feries: nbFer, baremes: a.baremes, dateISO: e.premierJour });
        ligne.feries = cf.net;
        ligne.net += cf.net;
        ligne.brut += cf.brut;
      }

      var net = Number(hsNet[cle(mat)] || hsNet[mat]) || 0;
      if (net > 0) {
        ligne.heuresSup = net;
        ligne.net += net;
        ligne.brut += (declare && tauxSal < 1) ? net / (1 - tauxSal) : net;
      }

      // Charges calculées sur l'assiette ASSEMBLÉE, et non additionnées
      // catégorie par catégorie : c'est le seul ordre qui reste juste quand un
      // terme (les HS) n'appartient à aucune catégorie.
      if (declare) {
        ligne.cnss = ligne.brut * (Number(b.tauxCnssSalariale) || 0);
        ligne.amo = ligne.brut * (Number(b.tauxAmo) || 0);
        ligne.salariales = ligne.cnss + ligne.amo;
        ligne.patronales = ligne.brut * (Number(b.tauxChargesPatronales) || 0);
      }
      ligne.coutEmployeur = ligne.brut + ligne.patronales;

      // Un non déclaré figure au détail AVEC ses jours et son brut, à charges
      // nulles. L'omettre ferait lire la liste comme l'effectif de la
      // quinzaine, alors qu'elle n'en montrerait qu'une fraction.
      out.detail.push(ligne);
      if (declare) {
        out.nbDeclares++;
        out.brutDeclare += ligne.brut;
        out.cnss += ligne.cnss;
        out.amo += ligne.amo;
        out.salariales += ligne.salariales;
        out.patronales += ligne.patronales;
      } else {
        out.nbNonDeclares++;
      }
    });

    // Les plus lourds d'abord : c'est l'ordre dans lequel on vérifie un total.
    out.detail.sort(function (x, y) { return y.coutEmployeur - x.coutEmployeur; });
    out.total = out.salariales + out.patronales;
    return out;
  }

  /**
   * Masse salariale NETTE : les 6 postes de paie, sans les charges. PURE.
   *
   * = MO Récolte + MO Hors Récolte + Postes Fixes
   *   + Prime Récolte + Prime Transport + Autres Primes
   *
   * Brique interne des deux chiffres publics ci-dessous. Elle n'inclut ni les
   * charges (qui vont à la CNSS, pas à l'ouvrier) ni la sous-traitance (qui ne
   * relève d'aucune fiche de paie).
   *
   * @param {Object} args
   * @param {{recolte: number, horsRecolte: number, postes: number}} args.mo nets.
   * @param {{recolte?: number, transport?: number, autres?: number}} args.primes
   * @returns {number}
   */
  function masseSalarialeNette(args) {
    var a = args || {};
    var mo = a.mo || {};
    var primes = a.primes || {};
    return (Number(mo.recolte) || 0)
      + (Number(mo.horsRecolte) || 0)
      + (Number(mo.postes) || 0)
      + (Number(primes.recolte) || 0)
      + (Number(primes.transport) || 0)
      + (Number(primes.autres) || 0)
      // Les heures sup vont à l'ouvrier : elles sont de la masse salariale,
      // pas une prime de terrain. Elles comptent donc dans le net à payer ET
      // dans le coût employeur, et leurs charges sont déjà dans `charges`.
      + (Number(a.heuresSup) || 0);
  }

  /**
   * NET À PAYER de la quinzaine : tout ce qui sort de la caisse. PURE.
   *
   * = masse salariale nette + Location & Engins
   *
   * SANS les charges sociales : elles ne vont pas à l'ouvrier, elles vont à la
   * CNSS. AVEC la sous-traitance : les prestataires sont payés eux aussi, et
   * c'est bien une sortie de caisse de la quinzaine (décision d'Omar).
   *
   * C'est donc le chiffre qu'on rapproche d'un décaissement, là où le coût
   * employeur est celui qu'on porte au P&L. Les confondre revient soit à
   * gonfler la paie versée, soit à sous-évaluer le coût de l'entreprise.
   *
   * @param {Object} args {mo, primes, locationEngins}
   * @returns {number}
   */
  function netAPayer(args) {
    var a = args || {};
    return masseSalarialeNette(a) + (Number(a.locationEngins) || 0);
  }

  /**
   * Coût EMPLOYEUR d'une quinzaine : les 7 postes énumérés par Omar. PURE.
   *
   * = masse salariale nette + Charges Sociales
   *
   * La sous-traitance n'en fait PAS partie : un prestataire n'a ni bulletin ni
   * cotisation. L'inclure ferait comparer à une masse salariale un chiffre qui
   * n'en est pas une.
   *
   * @param {Object} args {mo, primes, charges}
   * @returns {number}
   */
  function coutEmployeur(args) {
    var a = args || {};
    var charges = a.charges || {};
    return masseSalarialeNette(a) + (Number(charges.total) || 0);
  }

  /**
   * TOTAL de la quinzaine. PURE.
   *
   * = coût employeur + sous-traitance
   * = net à payer + charges sociales
   *
   * Les deux chemins tombent sur le même montant — c'est ce qui rend les trois
   * chiffres de l'écran vérifiables l'un par l'autre, et un test le fige.
   */
  function totalQuinzaine(args) {
    var a = args || {};
    return coutEmployeur(a) + (Number(a.locationEngins) || 0);
  }

  var __coutMainOeuvreApi = {
    CATEGORIES: CATEGORIES,
    coutFeries: coutFeries,
    nbJoursDistincts: nbJoursDistincts,
    masseSalarialeNette: masseSalarialeNette,
    netAPayer: netAPayer,
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
