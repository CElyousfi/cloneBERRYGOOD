/*
 * plafondDeclaration.js — le PLAFOND de journées déclarables par quinzaine.
 *
 * Fonctions PURES, aucune I/O. Chargé en <script> classique : IIFE, aucun
 * identifiant top-level ne fuite (une collision dans le scope global crashe le
 * boot React #200). Un seul global : window.PlafondDeclaration.
 *
 * ── LA RÈGLE ───────────────────────────────────────────────────────────────
 * Un ouvrier déclaré ne peut voir déclarer qu'un nombre limité de journées par
 * quinzaine. Au-delà, il travaille et il est payé, mais HORS CNSS.
 *
 * Confirmée par le RH le 2026-08-22, puis vérifiée sur les trois fichiers de
 * paie de la campagne :
 *
 *   plafond = jours calendaires de la quinzaine − DIMANCHES
 *
 *   01–15/07 : 15 j − 2 dimanches = 13   plafond observé 13  ✅
 *   16–31/07 : 16 j − 2 dimanches = 14   plafond observé 14  ✅
 *   01–15/08 : 15 j − 2 dimanches = 13   plafond observé 13  ✅
 *
 * ⚠️ « 13 » N'EST PAS UNE CONSTANTE. C'est la valeur d'une quinzaine de 15 jours
 * portant deux dimanches. La coder en dur donnerait un plafond faux sur toutes
 * les quinzaines de 16 jours — soit une sur deux — et ferait déclarer une
 * journée de moins que la paie à 25 ouvriers sur la seule quinzaine du 16–31/07.
 *
 * ── LES JOURS FÉRIÉS SONT HORS PLAFOND ─────────────────────────────────────
 * Ils sont déclarés EN PLUS. Vérifié : sur les 50 ouvriers dépassant le plafond,
 * AUCUN ne porte de jour férié sur sa ligne hors CNSS — les fériés restent tous
 * du côté déclaré.
 *
 * ── CE QUE VAUT UNE JOURNÉE HORS PLAFOND ───────────────────────────────────
 * SMAG + ancienneté, SANS prime de fonction, sans CNSS ni patronales. Mesuré sur
 * les 50 cas : prime de fonction nulle dans 49, et `brut = SMAG × jours +
 * ancienneté` dans 49 également.
 */
// @ts-check
(function () {
  'use strict';

  /**
   * Bornes de la quinzaine qui contient une date. PURE.
   *
   * Une quinzaine de paie va du 1er au 15, ou du 16 à la fin du mois. On les
   * reconstitue à partir d'une date quelconque de la période, et NON à partir
   * des journées pointées : si personne n'a travaillé le 1er, l'amplitude
   * observée serait plus courte que la quinzaine réelle et le plafond
   * baisserait d'autant. Un plafond trop bas déclarerait moins que la paie.
   *
   * @param {string} dateISO 'YYYY-MM-DD'.
   * @returns {{debut: string, fin: string}|null}
   */
  function bornesQuinzaine(dateISO) {
    var m = String(dateISO || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var annee = Number(m[1]);
    var mois = Number(m[2]);
    var jour = Number(m[3]);
    if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
    var deuxChiffres = function (n) { return (n < 10 ? '0' : '') + n; };
    var prefixe = annee + '-' + deuxChiffres(mois) + '-';
    if (jour <= 15) return { debut: prefixe + '01', fin: prefixe + '15' };
    // Dernier jour du mois : le jour 0 du mois SUIVANT, seule façon de le
    // calculer sans table des mois ni règle bissextile écrite à la main.
    var dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
    return { debut: prefixe + '16', fin: prefixe + deuxChiffres(dernier) };
  }

  /**
   * Nombre de journées déclarables sur une période. PURE.
   *
   * = jours calendaires − dimanches.
   *
   * @param {string} debutISO
   * @param {string} finISO
   * @returns {number} 0 si les bornes sont illisibles ou inversées.
   */
  function plafondSurPeriode(debutISO, finISO) {
    var d = new Date(String(debutISO || '') + 'T00:00:00Z');
    var f = new Date(String(finISO || '') + 'T00:00:00Z');
    if (isNaN(d.getTime()) || isNaN(f.getTime()) || d > f) return 0;
    var n = 0;
    while (d <= f) {
      // getUTCDay() : 0 = dimanche.
      if (d.getUTCDay() !== 0) n++;
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return n;
  }

  /**
   * Plafond de la quinzaine contenant une date. PURE.
   *
   * @param {string} dateISO n'importe quelle date de la quinzaine.
   * @returns {number} 0 si la date est illisible — l'appelant doit alors
   *   traiter le plafond comme INCONNU, et non comme nul : un plafond de 0
   *   déclarerait zéro journée à tout le monde.
   */
  function plafondQuinzaine(dateISO) {
    var b = bornesQuinzaine(dateISO);
    if (!b) return 0;
    return plafondSurPeriode(b.debut, b.fin);
  }

  /**
   * Répartit les journées travaillées d'un ouvrier DÉCLARÉ. PURE.
   *
   * Les jours fériés ne consomment pas le plafond : ils sont déclarés en plus.
   *
   * @param {number} jours journées travaillées (hors fériés).
   * @param {number} plafond 0 = inconnu → tout reste déclaré, comme avant.
   * @returns {{declares: number, horsPlafond: number}}
   */
  function repartir(jours, plafond) {
    var j = Number(jours) || 0;
    var p = Number(plafond) || 0;
    if (j <= 0) return { declares: 0, horsPlafond: 0 };
    // Plafond inconnu : on ne coupe RIEN. Inventer une coupure serait pire que
    // l'absence de plafond — elle sortirait des journées de la CNSS sans preuve.
    if (p <= 0 || j <= p) return { declares: j, horsPlafond: 0 };
    return { declares: p, horsPlafond: j - p };
  }

  var __plafondDeclarationApi = {
    bornesQuinzaine: bornesQuinzaine,
    plafondSurPeriode: plafondSurPeriode,
    plafondQuinzaine: plafondQuinzaine,
    repartir: repartir,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __plafondDeclarationApi;
  if (typeof window !== 'undefined') window.PlafondDeclaration = __plafondDeclarationApi;

})();
