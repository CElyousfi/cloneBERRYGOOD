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
    var parGrille = chargeParQuinzaine(a.rows);
    var totalGrille = 0;
    var totalQuinzaine = 0;
    var totalJhSansTaux = 0;

    var lignes = (a.parQuinzaine || []).map(function (q) {
      var g = parGrille[q.periode] || { cout: 0, jhSansTaux: 0 };
      var grille = g.cout;
      // La référence est l'écran QUINZAINE, pas BEE ONE : c'est lui qu'Omar
      // rapproche de son fichier de paie, et c'est donc lui qui fait foi.
      var quinzaine = Number(q.coutTotal) || 0;
      totalGrille += grille;
      totalQuinzaine += quinzaine;
      totalJhSansTaux += g.jhSansTaux;
      var ecart = quinzaine - grille;
      return {
        periode: q.periode,
        jours: Number(q.jours) || 0,
        grille: grille,
        quinzaine: quinzaine,
        ecart: ecart,
        // `null` et non 0 quand il n'y a rien à rapporter : un « 0,0 % » sur
        // une quinzaine vide se lirait « parfaitement rapproché ».
        ecartPct: quinzaine > 0 ? ecart / quinzaine : null,
        // JH pointés dont l'ouvrier n'a pas de taux : du volume à coût nul,
        // première cause d'un écart qui ne se voit pas dans les totaux.
        jhSansTaux: g.jhSansTaux,
        primes: Number(q.primes) || 0,
        charges: Number(q.charges) || 0,
      };
    });

    var ecart = totalQuinzaine - totalGrille;
    return {
      lignes: lignes,
      totalGrille: totalGrille,
      totalQuinzaine: totalQuinzaine,
      totalJhSansTaux: totalJhSansTaux,
      ecart: ecart,
      ecartPct: totalQuinzaine > 0 ? ecart / totalQuinzaine : null,
    };
  }

  var __campagneRapprochementApi = {
    chargeParQuinzaine: chargeParQuinzaine,
    rapprocher: rapprocher,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __campagneRapprochementApi;
  if (typeof window !== 'undefined') window.CampagneRapprochement = __campagneRapprochementApi;

})();
