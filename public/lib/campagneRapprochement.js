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
 *   - le coût ouvrier, lui, part du pointage BRUT, sans passer par la parcelle.
 * L'écart entre les deux mesure donc exactement ce que la grille NE VOIT PAS.
 * À zéro, la grille couvre tout le pointage. Non nul, il y a du travail pointé
 * hors périmètre — et c'est le genre de trou qui ne se voit jamais tout seul,
 * parce qu'un total plus petit reste un total plausible.
 *
 * Le POINTAGE DIVERS (sous-traitants) est hors des deux chemins : il n'a ni
 * parcelle ni fiche de paie. Il n'entre donc pas dans l'écart.
 */
// @ts-check
(function () {
  'use strict';

  /**
   * Salaire de base cumulé par quinzaine, tel que la GRILLE le voit.
   * PURE.
   *
   * Somme le `cout` des lignes du pivot campagne, groupées par période. C'est
   * la base NUE (BEE ONE), avant tout facteur de charge : c'est elle qui se
   * compare au `base` du calcul de coût, terme à terme.
   *
   * @param {Array<{periode?: string, cout?: number}>} rows lignes de
   *   `campagne-analytique-detail`.
   * @returns {Object<string, number>} période → base en DH.
   */
  function baseParQuinzaine(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r) return;
      var p = String(r.periode || '').trim();
      if (!p) return;
      var c = Number(r.cout);
      if (!isFinite(c)) return;
      out[p] = (out[p] || 0) + c;
    });
    return out;
  }

  /**
   * Rapprochement quinzaine par quinzaine. PURE.
   *
   * @param {Object} args
   * @param {Array<{periode: string, jours: number, base: number, primes: number,
   *   charges: number, coutTotal: number}>} args.parQuinzaine sortie de
   *   l'action `campagne-cout-ouvrier`.
   * @param {Array<Object>} args.rows lignes de la grille (toutes cultures).
   * @returns {{lignes: Array<Object>, totalGrille: number, totalPointage: number,
   *   ecart: number, ecartPct: number|null}}
   */
  function rapprocher(args) {
    var a = args || {};
    var parGrille = baseParQuinzaine(a.rows);
    var totalGrille = 0;
    var totalPointage = 0;

    var lignes = (a.parQuinzaine || []).map(function (q) {
      var grille = parGrille[q.periode] || 0;
      var pointage = Number(q.base) || 0;
      totalGrille += grille;
      totalPointage += pointage;
      var ecart = pointage - grille;
      return {
        periode: q.periode,
        jours: Number(q.jours) || 0,
        // Base vue par la GRILLE (agrégée par parcelle) et base vue par le
        // POINTAGE brut. Leur écart = ce que la grille ne rattache à aucune
        // parcelle ou culture.
        grille: grille,
        pointage: pointage,
        ecart: ecart,
        // `null` et non 0 quand il n'y a rien à rapporter : un « 0,0 % » sur
        // une quinzaine vide se lirait « parfaitement rapproché ».
        ecartPct: pointage > 0 ? ecart / pointage : null,
        // Le coût CHARGÉ de la quinzaine, pour recouper avec l'écran Quinzaine
        // (dont le total, lui, inclut le pointage divers — à retrancher).
        coutCharge: Number(q.coutTotal) || 0,
        primes: Number(q.primes) || 0,
        charges: Number(q.charges) || 0,
      };
    });

    var ecart = totalPointage - totalGrille;
    return {
      lignes: lignes,
      totalGrille: totalGrille,
      totalPointage: totalPointage,
      ecart: ecart,
      ecartPct: totalPointage > 0 ? ecart / totalPointage : null,
    };
  }

  var __campagneRapprochementApi = {
    baseParQuinzaine: baseParQuinzaine,
    rapprocher: rapprocher,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __campagneRapprochementApi;
  if (typeof window !== 'undefined') window.CampagneRapprochement = __campagneRapprochementApi;

})();
