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
 * ── DEUX RÉFÉRENTIELS QUI NE SE RECOUVRENT PAS ─────────────────────────────
 * Les kilos viennent des bons d'apport (`pfq_interne`), dont la maille est le
 * BLOC DE PRODUCTION (`PARCELLES_CULTURALES` : variété × sous-variété × cycle,
 * ex. « Maravilla Green Cane F1 », 4 Ha). La grille MO au-dessus, elle, a pour
 * colonnes les PARCELLES BEE ONE (`sb_parcelle_referentiel` : « F1- S5
 * MARAVILLA MD », 1.25 Ha), qui ne portent AUCUNE variété et dont le découpage
 * en secteurs est différent.
 * Il n'existe donc pas de jointure exacte entre les deux, et ce module n'en
 * invente aucune : il rend les kilos à leur maille NATIVE. Les rattacher aux
 * colonnes de la grille demanderait d'ajouter la variété au référentiel
 * parcelle — décision produit, pas un détail d'implémentation.
 */
// @ts-check
(function () {
  'use strict';

  /** Clé de rapprochement d'une désignation de bon : casse et espaces neutralisés. */
  function _cp_key(v) {
    return String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, ' ');
  }

  /**
   * Index `désignation → bloc` construit depuis le référentiel des blocs.
   * Chaque bloc y déclare les libellés exacts sous lesquels il apparaît dans
   * les bons (champ `designations`) : c'est un rapprochement DÉCLARÉ, jamais
   * deviné. PURE.
   *
   * @param {Array<Object>} blocs `PARCELLES_CULTURALES` (ou un sous-ensemble).
   * @returns {Object<string, Object>} désignation normalisée → bloc.
   */
  function indexDesignations(blocs) {
    var index = {};
    (blocs || []).forEach(function (bloc) {
      if (!bloc) return;
      (bloc.designations || []).forEach(function (d) {
        var k = _cp_key(d);
        if (k) index[k] = bloc;
      });
    });
    return index;
  }

  /**
   * Agrège les kilos des bons par BLOC DE PRODUCTION. PURE.
   *
   * Périmètre : celui de l'onglet Production — un `typeVente` donné (Export par
   * défaut) et un cycle donné. `cycleOf` est INJECTÉ (c'est `getCycle` de
   * app.jsx, la seule définition du découpage Sep-Déc / Jan-Juin) : le
   * dupliquer ici en ferait une seconde source de vérité, qui divergerait.
   *
   * Les bons qu'aucune désignation ne rattache ne sont PAS jetés en silence :
   * leurs kilos ressortent dans `kgNonRattaches`. Un rapprochement qui se
   * dégrade (nouvelle désignation côté terrain) doit se voir à l'écran, sinon
   * la production paraît simplement baisser.
   *
   * @param {Object} args
   * @param {Array<Object>} args.bons documents `pfq_interne` ({poidsLot, date, typeVente, designation, blocLabel}).
   * @param {Array<Object>} args.blocs référentiel des blocs de production.
   * @param {number} [args.cycle] cycle retenu (1 ou 2). Avec `cycleOf`.
   * @param {Function} [args.cycleOf] (date) => cycle.
   * @param {string} [args.debut] borne basse 'YYYY-MM-DD' incluse (fenêtre de
   *   campagne). Alternative au couple cycle/cycleOf — l'une OU l'autre, jamais
   *   les deux : un cycle et une campagne ne découpent pas le même calendrier.
   * @param {string} [args.fin] borne haute 'YYYY-MM-DD' incluse.
   * @param {string} [args.typeVente] défaut 'Export'. '' = tous.
   * @returns {{lignes: Array<Object>, kgNonRattaches: number, bonsNonRattaches: number, kgTotal: number}}
   */
  function agregeBlocs(args) {
    var a = args || {};
    var typeVente = a.typeVente === undefined ? 'Export' : a.typeVente;
    var index = indexDesignations(a.blocs);
    var parBloc = {};
    var kgNonRattaches = 0;
    var bonsNonRattaches = 0;
    var kgTotal = 0;

    var parCycle = typeof a.cycleOf === 'function' && a.cycle !== undefined && a.cycle !== null;
    var parFenetre = !!(a.debut || a.fin);
    // Aucun filtre temporel = tous les bons de l'historique confondus, soit un
    // total qui ne veut rien dire. On préfère ne rien rendre.
    if (!parCycle && !parFenetre) {
      return { lignes: [], kgNonRattaches: 0, bonsNonRattaches: 0, kgTotal: 0 };
    }

    (a.bons || []).forEach(function (b) {
      if (!b) return;
      var kg = Number(b.poidsLot);
      if (!isFinite(kg) || !(kg > 0)) return;
      if (typeVente && b.typeVente !== typeVente) return;
      if (parCycle && a.cycleOf(b.date) !== a.cycle) return;
      if (parFenetre) {
        // `dateISO` est la date normalisée du bon ; `date` est le champ brut,
        // repli quand l'import n'a pas produit l'ISO.
        var d = String(b.dateISO || b.date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        if (a.debut && d < a.debut) return;
        if (a.fin && d > a.fin) return;
      }
      kgTotal += kg;
      var bloc = index[_cp_key(b.designation)] || index[_cp_key(b.blocLabel)];
      if (!bloc) { kgNonRattaches += kg; bonsNonRattaches += 1; return; }
      var e = parBloc[bloc.id];
      if (!e) {
        e = parBloc[bloc.id] = {
          id: bloc.id,
          label: bloc.sousVariete ? bloc.variete + ' ' + bloc.sousVariete : bloc.variete,
          culture: bloc.culture || '',
          ferme: bloc.ferme || '',
          ha: Number(bloc.ha) || 0,
          nbPlants: Number(bloc.nbPlants) || 0,
          kg: 0,
          bons: 0,
        };
      }
      e.kg += kg;
      e.bons += 1;
    });

    var lignes = Object.keys(parBloc).map(function (k) { return parBloc[k]; })
      .sort(function (x, y) { return y.kg - x.kg; });
    return {
      lignes: lignes,
      kgNonRattaches: kgNonRattaches,
      bonsNonRattaches: bonsNonRattaches,
      kgTotal: kgTotal,
    };
  }

  /**
   * Rendement d'un bloc : kg/Ha et kg/plant. PURE.
   * `null` = dénominateur inconnu — jamais 0, qui se lirait « rendement nul ».
   * Le kg/plant n'a de sens que sur la myrtille (les framboisiers ne sont pas
   * comptés en plants : `nbPlants` y vaut 0).
   *
   * @param {{kg?: number, ha?: number, nbPlants?: number}} ligne
   * @returns {{kgHa: number|null, kgPlant: number|null}}
   */
  function rendements(ligne) {
    var l = ligne || {};
    var kg = Number(l.kg) || 0;
    var ha = Number(l.ha);
    var pl = Number(l.nbPlants);
    return {
      kgHa: (isFinite(ha) && ha > 0) ? kg / ha : null,
      kgPlant: (isFinite(pl) && pl > 0) ? kg / pl : null,
    };
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
    indexDesignations: indexDesignations,
    agregeBlocs: agregeBlocs,
    rendements: rendements,
    vitesseRecolte: vitesseRecolte,
    effortRecolte: effortRecolte,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __campagneProductionApi;
  if (typeof window !== 'undefined') window.CampagneProduction = __campagneProductionApi;

})();
