/*
 * campagneProduction.js — PRODUCTION EN KG de l'écran Campagne.
 *
 * Fonctions PURES, aucune I/O, aucun accès au scope global : tout entre par
 * argument (les bons d'apport, le référentiel des blocs, la date). Chargé en
 * <script> classique comme les autres modules de public/lib : tout est wrappé
 * dans une IIFE, aucun identifiant top-level ne fuite (cf. mémoire projet
 * umd-global-collision-smoke-load — une collision crashe le boot React #200).
 * UN SEUL global exposé : window.CampagneProduction.
 *
 * ── LE RATTACHEMENT PASSE PAR LA PARCELLE DU BON, ET PAR ELLE SEULE ────────
 * Les kilos viennent des bons d'apport (`pfq_interne`), qui portent leur
 * parcelle : le BLOC ID du DQR depuis la campagne 2026/2027, et le champ
 * « Parcelle / Bloc » imprimé sur le bon (« BREEZE MYRTILLE S8-2 »), mot pour
 * mot l'intitulé de la colonne côté référentiel parcelle.
 * Ce module ne connaît AUCUN autre référentiel : passer par les blocs de
 * production (variété × cycle) ferait ressortir le découpage de la campagne
 * PRÉCÉDENTE en face des parcelles de la campagne en cours. Ce qui ne se
 * rattache pas ressort en `kgNonRattaches`, jamais réparti au jugé.
 */
// @ts-check
(function () {
  'use strict';

  /** Clé de rapprochement d'une désignation de bon : casse et espaces neutralisés. */
  function _cp_key(v) {
    return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' ');
  }

  /**
   * BARÈME DE VITESSE DE RÉCOLTE, en kg par journée-homme, PAR CULTURE.
   * Valeurs arrêtées par Omar (2026-08-20). Ce n'est pas un budget saisi en
   * base : c'est une norme de cadence, la même pour toutes les parcelles d'une
   * culture — d'où sa place ici, nommée, plutôt qu'en dur dans un rendu.
   */
  var BAREME_KG_PAR_JH = { Framboise: 18, Myrtille: 30 };

  /**
   * BARÈME DE COÛT DE RÉCOLTE, en DH par kilo, PAR CULTURE (Omar, 2026-08-20).
   * Sert la ligne « DH / kg » du bloc récolte en mode Coût DH.
   */
  var BAREME_DH_PAR_KG = { Framboise: 7.5, Myrtille: 4.5 };

  /**
   * Kilos par PARCELLE de la grille. PURE.
   *
   * Chaîne de résolution, par ordre de confiance décroissant :
   *   1. `bon.bloc` → référentiel BLOC ID (le DQR porte le BLOC ID depuis la
   *      campagne 2026/2027) → sa `parcelle` ;
   *   2. `bon.parcelle` s'il est servi directement ;
   *   3. la **désignation du bon** — le champ « Parcelle / Bloc » imprimé sur le
   *      bon d'apport (« BREEZE MYRTILLE S8-2 »), qui est souvent MOT POUR MOT
   *      l'intitulé de la colonne côté référentiel parcelle.
   *
   * Dans les trois cas, rapprochement EXACT (casse et espaces neutralisés) avec
   * les clés de colonnes de la grille. Aucun rapprochement approché : un kilo
   * posé sur la mauvaise parcelle est pire qu'un kilo non rattaché, parce qu'il
   * ne se voit pas. Ce qui ne se résout pas ressort dans `kgNonRattaches`.
   *
   * @param {Object} args
   * @param {Array<Object>} args.bons
   * @param {Array<Object>} args.blocIds référentiel BLOC ID ({id, parcelle, …}).
   * @param {Array<string>} args.cles clés de colonnes de la grille.
   * @param {string} [args.debut] fenêtre (cf. agregeBlocs).
   * @param {string} [args.fin]
   * @param {string} [args.typeVente] défaut 'Export'.
   * @returns {{parParcelle: Object<string, number>, kgTotal: number, kgNonRattaches: number}}
   */
  function kgParParcelle(args) {
    var a = args || {};
    var typeVente = a.typeVente === undefined ? 'Export' : a.typeVente;
    var parBlocId = {};
    (a.blocIds || []).forEach(function (b) { if (b && b.id) parBlocId[b.id] = b; });
    var parCle = {};
    (a.cles || []).forEach(function (c) { parCle[_cp_key(c)] = c; });

    var parParcelle = {};
    var kgTotal = 0;
    var kgNonRattaches = 0;

    (a.bons || []).forEach(function (b) {
      if (!b) return;
      var kg = Number(b.poidsLot);
      if (!isFinite(kg) || !(kg > 0)) return;
      if (typeVente && b.typeVente !== typeVente) return;
      var d = String(b.dateISO || b.date || '').slice(0, 10);
      if (a.debut || a.fin) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        if (a.debut && d < a.debut) return;
        if (a.fin && d > a.fin) return;
      }
      kgTotal += kg;
      var bloc = parBlocId[b.bloc];
      var cible = parCle[_cp_key(bloc && bloc.parcelle)]
        || parCle[_cp_key(b.parcelle)]
        || parCle[_cp_key(b.designation)]
        || parCle[_cp_key(b.blocLabel)];
      if (!cible) { kgNonRattaches += kg; return; }
      parParcelle[cible] = (parParcelle[cible] || 0) + kg;
    });

    return { parParcelle: parParcelle, kgTotal: kgTotal, kgNonRattaches: kgNonRattaches };
  }

  /**
   * VITESSE DE RÉCOLTE : combien de kilos une journée-homme de récolte ramène,
   * et combien un dirham de main d'œuvre de récolte achète. PURE.
   *
   * `null` partout où le dénominateur est absent ou nul — surtout PAS 0, ni
   * l'infini : « aucune récolte pointée » et « récolte improductive » sont deux
   * états opposés, et c'est précisément le cas courant en début de campagne
   * (la récolte n'a pas commencé, le ratio n'existe pas encore).
   *
   * `dhParKg` est l'inverse de `kgParDh` : c'est la forme sous laquelle le coût
   * de récolte se lit habituellement, servie ici pour ne pas la recalculer
   * ailleurs (et diverger d'un arrondi).
   *
   * @param {{kg?: number, jh?: number, cout?: number}} args
   * @returns {{kgParJh: number|null, kgParDh: number|null, dhParKg: number|null}}
   */
  function vitesseRecolte(args) {
    var a = args || {};
    var kg = Number(a.kg);
    var jh = Number(a.jh);
    var cout = Number(a.cout);
    if (!isFinite(kg)) kg = 0;
    return {
      kgParJh: (isFinite(jh) && jh > 0) ? kg / jh : null,
      kgParDh: (isFinite(cout) && cout > 0) ? kg / cout : null,
      dhParKg: (isFinite(cout) && cout > 0 && kg > 0) ? cout / kg : null,
    };
  }

  /**
   * JH et coût de RÉCOLTE d'un jeu de lignes du pivot (celles du bloc Récolte).
   * PURE. Ne somme que les lignes `famille` : les bandeaux de groupe et les
   * lignes opération rejouent les mêmes JH, les compter les doublerait.
   *
   * @param {Array<Object>} groupedRows lignes du pivot (bloc Récolte).
   * @returns {{jh: number, cout: number}}
   */
  function effortRecolte(groupedRows) {
    var jh = 0;
    var cout = 0;
    (groupedRows || []).forEach(function (row) {
      if (!row || row.type !== 'famille') return;
      var pivot = row.pivot || {};
      Object.keys(pivot).forEach(function (p) {
        var cell = pivot[p];
        if (!cell) return;
        var j = Number(cell.jh);
        var c = Number(cell.cout);
        if (isFinite(j)) jh += j;
        if (isFinite(c)) cout += c;
      });
    });
    return { jh: jh, cout: cout };
  }

  var __campagneProductionApi = {
    BAREME_KG_PAR_JH: BAREME_KG_PAR_JH,
    BAREME_DH_PAR_KG: BAREME_DH_PAR_KG,
    kgParParcelle: kgParParcelle,
    vitesseRecolte: vitesseRecolte,
    effortRecolte: effortRecolte,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __campagneProductionApi;
  if (typeof window !== 'undefined') window.CampagneProduction = __campagneProductionApi;

})();
