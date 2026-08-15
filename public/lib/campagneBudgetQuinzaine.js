/**
 * campagneBudgetQuinzaine.js — BUDGET DE LA QUINZAINE EN COURS (LOT 3b).
 *
 * Chargé deux fois (UMD bricolé, comme public/lib/campagneRythme.js) :
 *   - navigateur, via <script src="lib/campagneBudgetQuinzaine.js">
 *       → window.CampagneBudgetQuinzaine
 *   - node:test, via require('./campagneBudgetQuinzaine.js') → module.exports
 *
 * Toutes les fonctions sont PURES : rien n'est lu dans le scope global, les
 * modules dont ce calcul a besoin (l'index budget de CampagneBudgetPivot) entrent
 * par argument.
 *
 * ── CE QUE C'EST, ET CE QUE CE N'EST PAS ─────────────────────────────────────
 * Un ENGAGEMENT COURT TERME : au début d'une quinzaine, on pose ce qu'on compte
 * dépenser sur les 15 jours à venir, par famille et par parcelle, en JH/Ha —
 * exactement l'unité du budget annuel.
 *   ⚠️ Ce n'est PAS une répartition du budget annuel. Aucune contrainte de somme
 *   n'est calculée, ni vérifiée, ni affichée comme une anomalie : Σ des budgets
 *   de quinzaine peut légitimement s'écarter du budget annuel, et cet écart est
 *   lui-même une information. Toute tentative de « rééquilibrer » les deux
 *   détruirait le sens du chiffre saisi.
 *
 * ── CLÉ D'UNE QUINZAINE ──────────────────────────────────────────────────────
 * `Q` + numéro sur deux chiffres ('Q07'). MIROIR EXACT de `quinzaineKey` de
 * functions/lib/campagneBudget/validate.js (le backend ne peut pas requérir
 * public/, cf. CLAUDE.md) : un corpus partagé vérifie que les deux
 * implémentations ne divergent pas. Elle est STRICTE — pas de « dernier nombre
 * de la chaîne » comme `CampagneRythme.quinzaineNum`, qui lit un libellé
 * d'affichage, pas une clé de persistance.
 *
 * La LISTE des quinzaines et LA QUINZAINE EN COURS ne sont jamais devinées : elles
 * viennent des `periodes` de `campagne-analytique-detail` — la même source que le
 * réalisé affiché — via `CampagneRythme.quinzainesInfo`. Aucun « 24 » en dur,
 * aucun calendrier local.
 *
 * ── CONSOMMATION D'UNE QUINZAINE ─────────────────────────────────────────────
 *   réalisé de la quinzaine = Σ des `detailRows` de la cellule dont la période
 *                             porte ce numéro (le pivot cumule la campagne
 *                             entière, il faut redescendre au détail) ;
 *   budget de la quinzaine  = JH/Ha engagé × Ha ;
 *   % consommé              = réalisé / budget.
 * Le % n'est JAMAIS sommable : agrégé, il se recalcule à partir des deux totaux
 * (cf. la série `ratio` de PivotAnalytiqueGrid). Une moyenne de pourcentages de
 * parcelles de tailles différentes serait fausse.
 * Absence de budget → « — », jamais 0 % ni 100 % : « rien d'engagé » n'est pas
 * « rien de consommé ».
 */
// @ts-check
'use strict';

(function () {

  /** Clé persistée. */
  var _cbq_QKEY_RE = /^Q(\d{1,2})$/;
  /** Libellé d'affichage d'une période (« Quinzaine 07 »). */
  var _cbq_QLABEL_RE = /^QUINZAINE\s*0*(\d{1,2})$/;
  /** Numéro nu. */
  var _cbq_QNUM_RE = /^0*(\d{1,2})$/;

  /**
   * Clé canonique d'une quinzaine : 'Q07'. PURE. Miroir du backend.
   * @param {*} raw 'Q07' | 'Quinzaine 7' | 7
   * @returns {string} '' si illisible ou hors 1..99.
   */
  function quinzaineKey(raw) {
    if (typeof raw === 'boolean') return '';
    var s = String(raw == null ? '' : raw).trim().toUpperCase();
    if (!s) return '';
    var m = _cbq_QKEY_RE.exec(s) || _cbq_QLABEL_RE.exec(s) || _cbq_QNUM_RE.exec(s);
    if (!m) return '';
    var n = parseInt(m[1], 10);
    if (!isFinite(n) || n < 1 || n > 99) return '';
    return 'Q' + (n < 10 ? '0' + n : String(n));
  }

  /**
   * Numéro d'une clé de quinzaine. PURE.
   * @param {*} key
   * @returns {number} 0 si illisible.
   */
  function quinzaineNum(key) {
    var k = quinzaineKey(key);
    return k ? parseInt(k.slice(1), 10) : 0;
  }

  /**
   * Options du sélecteur de quinzaine, DÉRIVÉES des `periodes` de la campagne.
   * PURE.
   *
   * Triées par numéro DÉCROISSANT : on saisit et on relit la quinzaine récente
   * bien plus souvent que celle d'il y a six mois. Les périodes illisibles sont
   * écartées (jamais une option qui n'écrirait nulle part).
   *
   * @param {Array<string>} periodes libellés bruts (« Quinzaine 07 »).
   * @returns {Array<{key: string, num: number, label: string}>}
   */
  function optionsFromPeriodes(periodes) {
    var vues = {};
    var out = [];
    (periodes || []).forEach(function (p) {
      var key = quinzaineKey(p);
      if (!key || vues[key]) return;
      vues[key] = true;
      out.push({ key: key, num: quinzaineNum(key), label: String(p).trim() });
    });
    return out.sort(function (a, b) { return b.num - a.num; });
  }

  /**
   * Clé de la quinzaine EN COURS. PURE.
   *
   * `ecoulees` de `CampagneRythme.quinzainesInfo` = numéro de la DERNIÈRE
   * quinzaine vue dans les `periodes`, c'est-à-dire celle qu'on est en train de
   * pointer. C'est exactement celle dont on veut suivre la consommation.
   *
   * @param {{ecoulees?: number}|null|undefined} quinzainesInfo
   * @returns {string} '' si l'avancement de la campagne est indéterminable.
   */
  function quinzaineCourante(quinzainesInfo) {
    var n = quinzainesInfo && Number(quinzainesInfo.ecoulees);
    return isFinite(n) && n > 0 ? quinzaineKey(n) : '';
  }

  /**
   * Quinzaine PRÉCÉDENTE réellement disponible. PURE.
   *
   * Sert le report en un clic : sans lui, la saisie repart de zéro tous les
   * quinze jours et l'écran ne sert pas. On prend la quinzaine existante de
   * numéro immédiatement inférieur — pas `num - 1` en aveugle : une quinzaine
   * sans aucun pointage n'apparaît pas dans les `periodes`, et proposer une clé
   * absente donnerait un report vide sans rien expliquer.
   *
   * @param {string} key quinzaine de référence.
   * @param {Array<{key: string, num: number}>} options
   * @returns {string} '' si aucune quinzaine antérieure.
   */
  function quinzainePrecedente(key, options) {
    var n = quinzaineNum(key);
    if (!(n > 0)) return '';
    var best = null;
    (options || []).forEach(function (o) {
      if (!o || !(o.num < n)) return;
      if (!best || o.num > best.num) best = o;
    });
    return best ? best.key : '';
  }

  /**
   * Indexe `budgets_quinzaine` de la réponse `campagne-budget-list` par libellé
   * BEE ONE EN MAJUSCULES. PURE.
   *
   * Séparé des deux autres index (famille, opération) comme côté saisie : un
   * document antérieur à ce lot n'a pas ce champ et doit rester lisible tel quel
   * (→ map vide, aucune migration).
   *
   * @param {Array<{label_bee_one?: string, budgets_quinzaine?: Object}>} list
   * @returns {Object<string, Object<string, Object<string, number>>>}
   *   LABEL_MAJ → 'Q07' → famille → JH/Ha
   */
  function quinzainesByLabel(list) {
    var out = {};
    (list || []).forEach(function (b) {
      var key = String((b && b.label_bee_one) || '').trim().toUpperCase();
      if (!key) return;
      var src = (b && b.budgets_quinzaine) || {};
      var norm = {};
      Object.keys(src).forEach(function (q) {
        var qk = quinzaineKey(q);
        if (qk) norm[qk] = src[q] || {};
      });
      out[key] = norm;
    });
    return out;
  }

  /**
   * Budgets d'UNE quinzaine, à la maille attendue par
   * `CampagneBudgetPivot.indexBudgets` (LABEL_MAJ → famille → JH/Ha). PURE.
   *
   * C'est ce qui permet de NE PAS réimplémenter la résolution famille → code GB
   * (le pont entre le nom du référentiel et la ligne du pivot) : on réutilise
   * l'indexeur du budget annuel en lui passant la tranche d'une quinzaine.
   *
   * @param {Object<string, Object<string, Object<string, number>>>} parLabel
   * @param {string} key quinzaine.
   * @returns {Object<string, Object<string, number>>}
   */
  function trancheQuinzaine(parLabel, key) {
    var qk = quinzaineKey(key);
    var out = {};
    if (!qk) return out;
    Object.keys(parLabel || {}).forEach(function (label) {
      var q = (parLabel[label] || {})[qk];
      if (q && typeof q === 'object') out[label] = q;
    });
    return out;
  }

  /**
   * JH RÉALISÉS sur une quinzaine dans une cellule du pivot. PURE.
   *
   * Le pivot cumule la campagne entière ; le détail par période vit dans
   * `detailRows` — la même source que la moyenne mobile du reste au rythme
   * (CampagneRythme.moyenneMobile), donc jamais désynchronisée d'elle.
   *
   * @param {{detailRows?: Array<{periode?: string, jh?: number}>}|null|undefined} cell
   * @param {number} num numéro de la quinzaine.
   * @returns {number} 0 si rien n'a été pointé (un vrai zéro : la cellule existe).
   */
  function realiseQuinzaine(cell, num) {
    var somme = 0;
    if (!cell || !(num > 0)) return 0;
    (cell.detailRows || []).forEach(function (r) {
      if (_cbq_periodeNum(r && r.periode) !== num) return;
      var jh = Number(r && r.jh);
      if (isFinite(jh)) somme += jh;
    });
    return somme;
  }

  /**
   * Numéro porté par un libellé de période. Tolérant À DESSEIN, contrairement à
   * `quinzaineKey` : ici on LIT une donnée d'affichage produite par le backend
   * (« Quinzaine 07 »), on n'écrit aucune clé. Même règle que
   * `CampagneRythme.quinzaineNum`, dont ce code partage la source.
   */
  function _cbq_periodeNum(label) {
    var m = /(\d{1,2})\s*$/.exec(String(label == null ? '' : label).trim());
    if (!m) return 0;
    var n = parseInt(m[1], 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** Cellule vierge : rien de réalisé, seul un budget de quinzaine est engagé. */
  function _cbq_cellVierge(ha) {
    return { jh: 0, cout: 0, ha: ha || 0, detailRows: [] };
  }

  /**
   * Ajoute `jhQuinzaine` et `budgetQuinzaine` sur les cellules. PURE — aucun
   * argument n'est muté (les lignes source sont partagées avec le pivot du
   * réalisé et sa pop-up de détail).
   *
   *   `jhQuinzaine`     JH réalisés sur la quinzaine (lignes famille ET
   *                     opération : le détail reste lisible).
   *   `budgetQuinzaine` JH/Ha engagés — au seul niveau FAMILLE, parce que c'est
   *                     la maille de saisie. Une ligne opération n'en porte pas :
   *                     la grille y affichera « — », ce qui est la vérité, plutôt
   *                     qu'une répartition inventée.
   *
   * Une parcelle ENGAGÉE mais jamais travaillée reçoit une cellule créée de
   * toutes pièces : c'est le cas qu'on vient précisément surveiller (0 %
   * consommé), le masquer viderait l'écran de son intérêt.
   *
   * @param {Object} args
   * @param {Array<Object>} args.groupedRows lignes du pivot (ordre conservé).
   * @param {Array<[string, number]>} args.parcelles colonnes (clé, Ha).
   * @param {number} args.num numéro de la quinzaine suivie.
   * @param {{familles?: Object<string, {cells?: Object<string, number>}>}} args.budgetIndex
   *   sortie de `CampagneBudgetPivot.indexBudgets` sur la tranche de quinzaine.
   * @returns {{groupedRows: Array<Object>, hasBudget: boolean}} `hasBudget` =
   *   au moins un engagement saisi sur ce périmètre. À false, l'appelant n'a
   *   aucune raison d'afficher la vue quinzaine (elle ne montrerait que des « — »).
   */
  function decoreQuinzaine(args) {
    var a = args || {};
    var rows = a.groupedRows || [];
    var num = Number(a.num) || 0;
    var index = (a.budgetIndex && a.budgetIndex.familles) || {};
    var haByParcelle = {};
    (a.parcelles || []).forEach(function (p) { haByParcelle[p[0]] = p[1]; });
    var hasBudget = false;

    var out = rows.map(function (row) {
      if (!row || row.type === 'groupe') return row;
      var budgetCells = (row.type === 'famille' && index[row.key] && index[row.key].cells) || {};
      var pivot = {};
      Object.keys(row.pivot || {}).forEach(function (p) { pivot[p] = row.pivot[p]; });
      Object.keys(budgetCells).forEach(function (p) {
        if (!pivot[p]) pivot[p] = _cbq_cellVierge(haByParcelle[p]);
      });
      Object.keys(pivot).forEach(function (p) {
        var cell = pivot[p];
        if (!cell) return;
        var copie = {};
        Object.keys(cell).forEach(function (k) { copie[k] = cell[k]; });
        copie.jhQuinzaine = realiseQuinzaine(cell, num);
        var b = Number(budgetCells[p]);
        if (isFinite(b) && b > 0) { copie.budgetQuinzaine = b; hasBudget = true; }
        pivot[p] = copie;
      });
      var copieRow = {};
      Object.keys(row).forEach(function (k) { copieRow[k] = row[k]; });
      copieRow.pivot = pivot;
      return copieRow;
    });
    return { groupedRows: out, hasBudget: hasBudget };
  }

  /**
   * Numérateur / dénominateur du « % consommé » d'une cellule, en JH TOTAL. PURE.
   *
   * Rendus SÉPARÉMENT et jamais divisés ici : un agrégat de pourcentages se
   * calcule en sommant les deux termes puis en divisant, jamais en moyennant des
   * ratios (les parcelles n'ont pas la même surface).
   *
   * `null` = indéterminable, jamais 0 % : aucun engagement saisi, ou superficie
   * inconnue (un JH/Ha ne se convertit pas en JH sans Ha).
   *
   * @param {{jhQuinzaine?: number, budgetQuinzaine?: number, ha?: number}|null|undefined} cell
   * @returns {{num: number, den: number}|null}
   */
  function pctPartsCellule(cell) {
    if (!cell) return null;
    var budget = Number(cell.budgetQuinzaine);
    if (!isFinite(budget) || !(budget > 0)) return null;
    var ha = Number(cell.ha);
    if (!isFinite(ha) || !(ha > 0)) return null;
    var jh = Number(cell.jhQuinzaine);
    return { num: isFinite(jh) ? jh : 0, den: budget * ha };
  }

  /**
   * Reste ENGAGÉ sur la quinzaine, en JH total (budget − réalisé). PURE.
   * Négatif = engagement dépassé, rendu tel quel (aucun plafonnement : le
   * dépassement est précisément ce qu'on vient lire).
   *
   * @param {{jhQuinzaine?: number, budgetQuinzaine?: number, ha?: number}|null|undefined} cell
   * @returns {number|null} null = indéterminable (cf. pctPartsCellule).
   */
  function resteQuinzaineCellule(cell) {
    var parts = pctPartsCellule(cell);
    return parts === null ? null : parts.den - parts.num;
  }

  /**
   * Phrase de périmètre affichée sous la grille en vue Quinzaine. Le lecteur ne
   * peut pas deviner que le budget affiché est un ENGAGEMENT de 15 jours et non
   * une tranche du budget annuel — sans cette mention, il lit un phasage.
   *
   * @param {{label?: string, key?: string}} quinzaine
   * @param {boolean} courante
   * @returns {string}
   */
  function noteQuinzaine(quinzaine, courante) {
    var q = quinzaine || {};
    var nom = q.label || q.key || 'la quinzaine';
    return 'Budget de ' + nom + (courante ? ' (quinzaine en cours)' : ' (quinzaine passée)')
      + ' : engagement saisi pour ces 15 jours, indépendant du budget annuel — leur'
      + ' somme n\'a pas à s\'y ramener. Réalisé et % consommé portent sur cette seule'
      + ' quinzaine. « — » = aucun engagement saisi, ou superficie inconnue.';
  }

  var __campagneBudgetQuinzaineApi = {
    quinzaineKey: quinzaineKey,
    quinzaineNum: quinzaineNum,
    optionsFromPeriodes: optionsFromPeriodes,
    quinzaineCourante: quinzaineCourante,
    quinzainePrecedente: quinzainePrecedente,
    quinzainesByLabel: quinzainesByLabel,
    trancheQuinzaine: trancheQuinzaine,
    realiseQuinzaine: realiseQuinzaine,
    decoreQuinzaine: decoreQuinzaine,
    pctPartsCellule: pctPartsCellule,
    resteQuinzaineCellule: resteQuinzaineCellule,
    noteQuinzaine: noteQuinzaine,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __campagneBudgetQuinzaineApi;
  if (typeof window !== 'undefined') window.CampagneBudgetQuinzaine = __campagneBudgetQuinzaineApi;

})();
