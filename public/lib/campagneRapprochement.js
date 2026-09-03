/*
 * campagneRapprochement.js — RAPPROCHEMENT écran Quinzaine ↔ écran Campagne.
 *
 * Fonctions PURES, aucune I/O. Chargé en <script> classique comme les autres
 * modules de public/lib : tout est wrappé dans une IIFE, aucun identifiant
 * top-level ne fuite (cf. mémoire projet umd-global-collision-smoke-load — une
 * collision crashe le boot React #200). Un seul global :
 *   window.CampagneRapprochement
 *
 * ── POURQUOI CE CONTRÔLE EXISTE ────────────────────────────────────────────
 * Deux écrans additionnent la même main d'œuvre par deux chemins différents :
 *   - l'écran Campagne agrège le pointage PAR PARCELLE, puis par culture. Une
 *     ligne dont la parcelle ou la culture ne se résout pas n'y entre PAS ;
 *   - l'écran Quinzaine, lui, part du pointage BRUT, sans passer par la parcelle.
 * L'écart entre les deux mesure donc exactement ce que la grille NE VOIT PAS.
 * À zéro, la grille couvre tout le pointage. Non nul, il y a du travail pointé
 * hors périmètre — et c'est le genre de trou qui ne se voit jamais tout seul,
 * parce qu'un total plus petit reste un total plausible.
 *
 * ── D'OÙ VIENT LA RÉFÉRENCE ────────────────────────────────────────────────
 * La colonne « Quinzaine » n'est PAS recalculée ici. Elle vient d'un instantané
 * que l'écran Quinzaine enregistre lui-même (`rh_cout_quinzaine`). Trois
 * tentatives de reproduire son total ont produit trois divergences — transport
 * résolu au mauvais format de date, préfixe d'équipe deviné, part salariale
 * comptée d'un seul côté. Un écart entre deux implémentations ne dit rien sur
 * l'argent ; un écart entre deux mesures, si.
 *
 * Instantané absent → `quinzaine` et `ecart` valent `null`, et l'écran affiche
 * « — ». JAMAIS un repli sur un calcul local : un chiffre de repli se lirait
 * comme la référence, et on aurait reconstruit le problème qu'on supprime.
 *
 * ── CE QU'ON COMPARE, ET POURQUOI ÇA A CHANGÉ ──────────────────────────────
 * Ce panneau rapprochait les deux chemins sur le SALAIRE DE BASE BEE ONE. Ce
 * témoin ne sert plus : Smart Berry n'affiche plus le coût BEE ONE, qui ne
 * porte ni les primes, ni les heures sup, ni les charges. Rapprocher deux
 * écrans sur un chiffre qu'aucun des deux n'affiche revient à valider une
 * couverture sans jamais contrôler le montant qu'on lit.
 *
 * On compare donc désormais COÛT CHARGÉ contre COÛT CHARGÉ :
 *   - « Grille »    = Σ (JH × taux de l'ouvrier), tel que la grille l'additionne ;
 *   - « Quinzaine » = le coût chargé de l'écran Quinzaine, la source de vérité.
 * L'écart est alors en DIRHAMS RÉELS : c'est l'argent que la grille ne montre
 * pas, pas une base théorique.
 *
 * `jhSansTaux` compte les JH d'ouvriers sans fiche de paie. Ces JH entrent dans
 * la grille en volume mais à coût nul : ils expliquent un écart sans qu'aucun
 * total ne paraisse anormal. C'est la première chose à regarder quand l'écart
 * ne tombe pas à zéro.
 *
 * Le POINTAGE DIVERS (sous-traitants) est hors des deux chemins : il n'a ni
 * parcelle ni fiche de paie. Il n'entre donc pas dans l'écart.
 */
// @ts-check
(function () {
  'use strict';

  /**
   * Coût CHARGÉ cumulé par quinzaine, tel que la GRILLE le voit. PURE.
   *
   * Somme le `coutCharge` des lignes du pivot campagne (Σ JH × taux ouvrier),
   * groupées par période — le chiffre que la grille affiche réellement en mode
   * Coût DH. On somme au passage `jhSansTaux` : ces JH pèsent dans le volume
   * mais rien dans le coût, et sans eux un écart resterait inexplicable.
   *
   * @param {Array<{periode?: string, coutCharge?: number, jhSansTaux?: number}>} rows
   *   lignes de `campagne-analytique-detail`.
   * @returns {Object<string, {cout: number, jhSansTaux: number}>} période → cumuls.
   */
  function chargeParQuinzaine(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r) return;
      var p = String(r.periode || '').trim();
      if (!p) return;
      if (!out[p]) out[p] = { cout: 0, jhSansTaux: 0 };
      var c = Number(r.coutCharge);
      if (isFinite(c)) out[p].cout += c;
      var j = Number(r.jhSansTaux);
      if (isFinite(j)) out[p].jhSansTaux += j;
    });
    return out;
  }

  /**
   * Postes COMPARABLES entre les deux calculs. PURE.
   *
   * Les deux ventilations ne se correspondent pas terme à terme : la campagne
   * décompose en salaire / prime de fonction / ancienneté / patronales, l'écran
   * Quinzaine en MO Récolte / Hors Récolte / Postes Fixes / charges sociales.
   * Aligner ces lignes-là serait inventer une correspondance.
   *
   * QUATRE postes, en revanche, ont la même définition des deux côtés : les
   * primes de terrain et les heures sup. On les compare, et tout le reste —
   * salaires et charges — se déduit par différence. C'est suffisant pour
   * répondre à la seule question qui compte : l'écart vient-il d'une prime
   * absente, ou de la masse salariale elle-même ?
   *
   * @param {Object} q ligne `parQuinzaine` (côté campagne).
   * @param {Object} snap instantané de l'écran Quinzaine.
   * @returns {Array<{cle: string, libelle: string, campagne: number,
   *   quinzaine: number, ecart: number}>|null}
   */
  function ecartParPoste(q, snap) {
    if (!q || !q.postes || !snap || !snap.postes) return null;
    var pc = q.postes;
    var ps = snap.postes;
    var n = function (v) { var x = Number(v); return isFinite(x) ? x : 0; };

    /** @type {Array<{cle: string, libelle: string, campagne: number, quinzaine: number, ecart?: number}>} */
    var lignes = [ // `ecart` est calcule juste apres, dans le forEach
      { cle: 'transport', libelle: 'Prime transport',
        campagne: n(pc.transport), quinzaine: n(ps.primeTransport) },
      { cle: 'recolte', libelle: 'Prime récolte',
        campagne: n(pc.recolte), quinzaine: n(ps.primeRecolte) },
      // Le fériés est rangé dans « Autres Primes » côté Quinzaine : on agrège
      // donc la campagne de la même façon, sinon on comparerait un poste à
      // une somme de postes.
      { cle: 'autres', libelle: 'Autres primes (traitement, cond., charg., fériés)',
        campagne: n(pc.traitement) + n(pc.conditionnement) + n(pc.chargement) + n(pc.feries),
        quinzaine: n(ps.autresPrimes) },
      { cle: 'hs', libelle: 'Heures supplémentaires',
        campagne: n(pc.heuresSup) + n(pc.heuresSupAccordees),
        quinzaine: n(ps.heuresSup) },
    ];
    var sommeC = 0;
    var sommeQ = 0;
    lignes.forEach(function (l) {
      l.ecart = l.quinzaine - l.campagne;
      sommeC += l.campagne;
      sommeQ += l.quinzaine;
    });
    // LE RESTE : salaires et charges. Calculé par différence des TOTAUX, jamais
    // en additionnant des postes — c'est ce qui garantit que la ventilation
    // boucle exactement sur l'écart affiché, quelles que soient les
    // conventions de décomposition de chaque côté.
    var totalC = Number(q.coutTotal) || 0;
    var totalQ = Number(snap.coutEmployeur) || 0;
    lignes.push({
      cle: 'salaires', libelle: 'Salaires et charges (reste)',
      campagne: totalC - sommeC, quinzaine: totalQ - sommeQ,
      ecart: (totalQ - sommeQ) - (totalC - sommeC),
    });
    // `ecart` est renseigne pour chaque ligne par le forEach ci-dessus : la
    // forme finale est bien celle du @returns.
    return /** @type {Array<{cle: string, libelle: string, campagne: number, quinzaine: number, ecart: number}>} */ (lignes);
  }

  /**
   * Rapprochement quinzaine par quinzaine. PURE.
   *
   * @param {Object} args
   * @param {Array<{periode: string, jours: number, base: number, primes: number,
   *   charges: number, coutTotal: number}>} args.parQuinzaine sortie de
   *   l'action `campagne-cout-ouvrier`.
   * @param {Array<Object>} args.rows lignes de la grille (toutes cultures).
   * @param {Object<string, {coutEmployeur: number}>} [args.snapshots] instantanés
   *   enregistrés par l'écran Quinzaine, indexés par période.
   * @returns {{lignes: Array<Object>, totalGrille: number,
   *   totalGrilleComparable: number, totalQuinzaine: number,
   *   totalJhSansTaux: number, ecart: number, ecartPct: number|null,
   *   sansSnapshot: Array<string>}}
   */
  function rapprocher(args) {
    /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
    var a = args || {};
    var parGrille = chargeParQuinzaine(a.rows);
    var totalGrille = 0;
    var totalQuinzaine = 0;
    var totalJhSansTaux = 0;

    var snaps = a.snapshots || {};
    var lignes = (a.parQuinzaine || []).map(function (q) {
      var g = parGrille[q.periode] || { cout: 0, jhSansTaux: 0 };
      var grille = g.cout;
      // La référence est l'instantané de l'écran QUINZAINE — celui qu'Omar
      // rapproche de son fichier de paie. Absent : `null`, jamais un repli sur
      // `q.coutTotal`, qui est l'autre implémentation et ferait passer pour une
      // référence le chiffre même qu'on cherche à contrôler.
      var snap = snaps[q.periode];
      var quinzaine = (snap && Number(snap.coutEmployeur) > 0)
        ? Number(snap.coutEmployeur) : null;
      // Le NET À PAYER de la même quinzaine, servi à côté. Ce n'est PAS le
      // chiffre à rapprocher — il exclut les charges sociales (qui vont à la
      // CNSS, pas à l'ouvrier) et inclut la sous-traitance. Mais c'est celui
      // qu'on lit spontanément sur l'écran Quinzaine, et le comparer au coût
      // chargé fabrique un écart qui n'existe pas. L'afficher côte à côte est le
      // seul moyen fiable de ne pas les confondre.
      var netQuinzaine = (snap && Number(snap.netAPayer) > 0)
        ? Number(snap.netAPayer) : null;
      totalGrille += grille;
      if (quinzaine !== null) totalQuinzaine += quinzaine;
      totalJhSansTaux += g.jhSansTaux;
      var ecart = quinzaine === null ? null : quinzaine - grille;
      return {
        periode: q.periode,
        // ⚠️ DEUX GRANDEURS DIFFÉRENTES, et c'est un piège.
        // `q.jours` = journées calendaires DISTINCTES (assiette de la paie : un
        // ouvrier pointé deux fois le même jour touche un jour).
        // `q.jh` et `snap.jours` = JOURNÉES-HOMME (les demi-journées comptent
        // pour 0,5). Sur la Quinzaine 01 : 1 488 contre 1 484.
        // Les afficher sous un même en-tête « JH » ferait passer un écart de
        // mesure pour un écart de périmètre.
        jours: Number(q.jours) || 0,
        jh: Number(q.jh) || 0,
        joursQuinzaine: (snap && Number(snap.jours) > 0) ? Number(snap.jours) : null,
        grille: grille,
        quinzaine: quinzaine,
        netQuinzaine: netQuinzaine,
        ecart: ecart,
        // `null` et non 0 quand il n'y a rien à rapporter : un « 0,0 % » sur
        // une quinzaine vide se lirait « parfaitement rapproché ».
        ecartPct: (quinzaine !== null && quinzaine > 0) ? ecart / quinzaine : null,
        // JH pointés dont l'ouvrier n'a pas de taux : du volume à coût nul,
        // première cause d'un écart qui ne se voit pas dans les totaux.
        jhSansTaux: g.jhSansTaux,
        primes: Number(q.primes) || 0,
        charges: Number(q.charges) || 0,
        // Ventilation poste par poste, telle que le backend la rend. Servie
        // brute : c'est elle qui permet de comparer poste à poste avec les
        // tuiles de l'écran Quinzaine, au lieu de déduire le poste manquant
        // d'un ratio par JH.
        postes: (q && q.postes) || null,
        // Total du calcul CAMPAGNE. Distinct de `grille` (qui passe par la
        // parcelle) et de `quinzaine` (l'instantané). Les trois se lisent
        // ensemble ; les mélanger dans une même soustraction — ce que faisait
        // la décomposition « dont salaire » — produit un nombre qui n'est le
        // total de rien.
        campagne: Number(q && q.coutTotal) || 0,
        ecartPostes: ecartParPoste(q, snap),
      };
    });

    // Le total ne compare que les quinzaines DOCUMENTÉES des deux côtés :
    // additionner une grille dont la référence manque gonflerait l'écart d'un
    // montant qui n'a jamais été mesuré.
    var grilleComparable = lignes.reduce(function (t, l) {
      return t + (l.quinzaine === null ? 0 : l.grille);
    }, 0);
    var ecart = totalQuinzaine - grilleComparable;
    return {
      lignes: lignes,
      totalGrille: totalGrille,
      // Somme de la grille RESTREINTE aux quinzaines qui ont un instantané —
      // c'est elle qui fait face à `totalQuinzaine`. Afficher `totalGrille` en
      // regard donnerait une soustraction que le lecteur ne retrouve pas.
      totalGrilleComparable: grilleComparable,
      totalQuinzaine: totalQuinzaine,
      totalJhSansTaux: totalJhSansTaux,
      ecart: ecart,
      ecartPct: totalQuinzaine > 0 ? ecart / totalQuinzaine : null,
      // Quinzaines encore sans instantané : l'écran doit pouvoir DIRE qu'il ne
      // compare pas tout, plutôt que d'afficher un total qui paraît complet.
      sansSnapshot: lignes.filter(function (l) { return l.quinzaine === null; })
        .map(function (l) { return l.periode; }),
    };
  }

  var __campagneRapprochementApi = {
    chargeParQuinzaine: chargeParQuinzaine,
    rapprocher: rapprocher,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __campagneRapprochementApi;
  if (typeof window !== 'undefined') window.CampagneRapprochement = __campagneRapprochementApi;

})();
