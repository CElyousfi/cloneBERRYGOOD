/**
 * campagneBudgetPivot.js — SUPERPOSITION DU BUDGET sur le pivot analytique.
 *
 * Chargé deux fois (UMD bricolé, comme public/lib/analytiqueUtils.js) :
 *   - navigateur, via <script src="lib/campagneBudgetPivot.js"> → window.CampagneBudgetPivot
 *   - node:test, via require('./campagneBudgetPivot.js')        → module.exports
 *
 * Toutes les fonctions sont PURES : aucune dépendance globale n'est lue ici, les
 * modules dont ce builder a besoin (AnalytiqueUtils, la règle métier du budget)
 * entrent par argument (DI) — c'est ce qui le rend testable hors navigateur.
 *
 * ── POURQUOI UN BUILDER DÉDIÉ ────────────────────────────────────────────────
 * `AnalytiqueUtils.buildAnalytiquePivotByFamille` agrège le RÉALISÉ de façon
 * strictement ADDITIVE (les JH d'une famille = Σ des JH de ses opérations). Le
 * BUDGET, lui, suit la règle métier inverse : « les opérations ÉCRASENT la
 * famille, jamais d'addition » (`familleTotal`, functions/lib/campagneBudget/
 * validate.js et son miroir front `CampagneBudgetTab.familleTotal`). Passer le
 * budget dans le même agrégateur produirait un double comptage sur toute
 * famille saisie aux deux niveaux. D'où ce builder : il produit les MÊMES lignes
 * (mêmes clés, même ordre, mêmes libellés) que le pivot du réalisé, mais il
 * calcule la valeur budget avec la règle du budget — et il n'en réimplémente
 * aucune : `familleTotal` et `splitOpKey` sont INJECTÉS (`budgetRules`).
 *
 * ── CE QU'IL PRODUIT ─────────────────────────────────────────────────────────
 * Les groupedRows du réalisé, RECOPIÉES (jamais mutées), dont chaque cellule
 * porte en plus `budget` = JH/Ha budgété pour cette (ligne, parcelle).
 *   - `budget` ABSENT = aucun budget saisi. Jamais 0 : la grille distingue les
 *     deux (une valeur absente s'affiche « — », un 0 s'afficherait « 0.0 » et se
 *     lirait « budget nul », ce qui est faux). C'est le cas NOMINAL aujourd'hui
 *     (les parcelles d'avocatier ne sont pas budgétées).
 *   - Un budget à 0 en base vaut « pas de budget défini » (convention backend,
 *     cf. mergeBudgets) : il ne produit donc jamais de cellule.
 *
 * ── LIGNES AJOUTÉES (budget non consommé) ────────────────────────────────────
 * Une famille (ou une opération) BUDGÉTÉE mais JAMAIS TRAVAILLÉE n'a aucune
 * ligne dans le pivot du réalisé. La masquer reviendrait à cacher un budget
 * entièrement non consommé — exactement l'information qu'on vient chercher. Ces
 * lignes sont donc AJOUTÉES, avec un réalisé à 0 :
 *   - à la position canonique (ordre GB01→GB11 puis AUTRE, à l'intérieur de leur
 *     groupe M.O ; ordre des groupes = GROUPE_ORDER), obtenue par un tri STABLE
 *     qui préserve l'ordre des lignes déjà présentes ;
 *   - le groupe M.O est créé s'il manque ;
 *   - les opérations budgétées non travaillées sont ajoutées APRÈS les opérations
 *     réalisées de leur famille (celles-ci sont triées par JH décroissant : à 0
 *     JH, elles sont de toute façon en fin de liste), entre elles par libellé.
 * Les COLONNES, elles, ne sont pas touchées : une parcelle budgétée sans aucun
 * pointage n'apparaît pas (elle n'existe dans aucune ligne de la campagne). Le
 * jeu de colonnes reste celui du réalisé, décidé par l'appelant.
 *
 * ── JOINTURES (les deux endroits où ça peut casser en silence) ───────────────
 * 1. PARCELLE : clé `trim().toUpperCase()` du label BEE ONE — la même que
 *    sbMap / sbHa / CAT_budgetsByLabel. Une autre normalisation raterait TOUS
 *    les budgets, sans la moindre erreur (colonnes vides).
 * 2. FAMILLE : le budget est keyé par NOM de famille du référentiel des tâches
 *    (« Service générale »), le pivot du réalisé par CODE GB (« GB11 », libellé
 *    « Services généraux »). Le pont est `AnalytiqueUtils.resolveGbCode`, celui-là
 *    même qui range les lignes de pointage — jamais une table de correspondance
 *    parallèle. Quand le budget porte un détail par opération, le code inscrit
 *    dans les clés `CODE::Libellé` fait foi (il est plus fiable que le nom de
 *    famille : c'est le code qui range le réalisé). Deux familles distinctes du
 *    référentiel qui résolvent vers le MÊME code GB s'additionnent : elles ne
 *    forment qu'une seule ligne côté réalisé, leurs budgets doivent la couvrir.
 */
// @ts-check
'use strict';

(function () {

  /** Clé de jointure d'une parcelle — identique à sbMap / sbHa. */
  function _cbp_normLabel(label) {
    return String(label == null ? '' : label).trim().toUpperCase();
  }

  /** Nombre saisi (chaîne FR ou number) → number, 0 si vide/invalide. */
  function _cbp_num(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return 0;
    var n = parseFloat(String(raw).trim().replace(',', '.'));
    return isNaN(n) || !isFinite(n) ? 0 : n;
  }

  /**
   * Code GB d'une famille budgétée.
   *
   * Priorité au CODE porté par les clés d'opération (`CODE::Libellé`) : c'est le
   * code qui range le réalisé, et il est saisi depuis le référentiel. Le nom de
   * famille ne sert que si le budget n'a pas de détail par opération, ou si ses
   * opérations portent des codes divergents (jamais vu, garde de robustesse).
   *
   * @param {string} famille
   * @param {Object<string, *>} familleOps clés d'opération de cette famille.
   * @param {Object} AU AnalytiqueUtils.
   * @param {Function} splitOpKey miroir injecté de splitOpKey (backend).
   * @returns {string} code GB, ou 'AUTRE' si non résolu (même repli que le pivot).
   */
  function _cbp_gbDeFamille(famille, familleOps, AU, splitOpKey) {
    var codes = {};
    Object.keys(familleOps || {}).forEach(function (k) {
      if (!(_cbp_num(familleOps[k]) > 0)) return;
      var c = splitOpKey(k).code;
      if (c) codes[c] = true;
    });
    var uniques = Object.keys(codes);
    if (uniques.length === 1) {
      var gb = AU.resolveGbCode(uniques[0], famille);
      if (gb) return gb;
    }
    return AU.resolveGbCode(null, famille) || 'AUTRE';
  }

  /**
   * Indexe les budgets d'une campagne à la maille du pivot analytique. PURE.
   *
   * @param {Object} args
   * @param {Array<[string, number]>} args.parcelles colonnes de la grille.
   * @param {Object<string, Object<string, *>>} args.budgetsByLabel
   *   LABEL_MAJ → famille → JH/Ha (niveau famille).
   * @param {Object<string, Object<string, Object<string, *>>>} args.opBudgetsByLabel
   *   LABEL_MAJ → famille → `CODE::Libellé` → JH/Ha (niveau opération).
   * @param {Object} args.analytique AnalytiqueUtils (resolveGbCode, resolveGroupeFamille,
   *   opKey, opLabel).
   * @param {{familleTotal: Function, splitOpKey: Function}} args.budgetRules règle
   *   métier INJECTÉE (miroir de functions/lib/campagneBudget/validate.js).
   * @returns {{familles: Object<string, {label: string, cells: Object<string, number>}>,
   *   operations: Object<string, {label: string, familleKey: string,
   *   cells: Object<string, number>}>}} `familles` : code GB → cellules + libellé ;
   *   `operations` : clé de ligne `GBxx::OPKEY` → cellules + libellé.
   */
  function indexBudgets(args) {
    /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
    var a = args || {};
    var AU = a.analytique;
    var rules = a.budgetRules || {};
    var familles = {};
    var operations = {};
    (a.parcelles || []).forEach(function (p) {
      var parcelle = p[0];
      var key = _cbp_normLabel(parcelle);
      var bFam = (a.budgetsByLabel || {})[key] || {};
      var bOps = (a.opBudgetsByLabel || {})[key] || {};
      var noms = {};
      Object.keys(bFam).forEach(function (f) { noms[f] = true; });
      Object.keys(bOps).forEach(function (f) { noms[f] = true; });
      Object.keys(noms).forEach(function (famille) {
        // RÈGLE MÉTIER, non réimplémentée : opérations > famille, jamais la somme.
        var t = rules.familleTotal(famille, bFam, bOps);
        if (!t || !(t.total > 0)) return;
        var famOps = bOps[famille] || {};
        var gb = _cbp_gbDeFamille(famille, famOps, AU, rules.splitOpKey);
        if (!familles[gb]) {
          // Libellé résolu par le MÊME helper que le pivot du réalisé : une
          // famille budgétée sous « Service générale » s'affiche « Services
          // généraux », comme la ligne du réalisé qu'elle rejoindra. Le nom du
          // référentiel ne sert que de repli (code GB inconnu → 'AUTRE').
          familles[gb] = { label: AU.resolveGroupeFamille(gb, famille), cells: {} };
        }
        familles[gb].cells[parcelle] = (familles[gb].cells[parcelle] || 0) + t.total;
        // Le détail par opération n'est repris QUE s'il porte le total (source
        // 'operations') : sinon il vaut 0 et la famille est budgétée en bloc.
        if (t.source !== 'operations') return;
        Object.keys(famOps).forEach(function (opk) {
          var v = _cbp_num(famOps[opk]);
          if (!(v > 0)) return;
          var operation = rules.splitOpKey(opk).operation;
          // Même clé de ligne que le pivot du réalisé : code GB de la FAMILLE +
          // libellé normalisé mécaniquement (AU.opKey).
          var rowKey = gb + '::' + AU.opKey(operation);
          if (!operations[rowKey]) {
            operations[rowKey] = {
              label: AU.opLabel(operation) || '—',
              familleKey: gb,
              cells: {},
            };
          }
          operations[rowKey].cells[parcelle] =
            (operations[rowKey].cells[parcelle] || 0) + v;
        });
      });
    });
    return { familles: familles, operations: operations };
  }

  /** Cellule vierge : réalisé à zéro, seul le budget est renseigné. */
  function _cbp_cellVierge(ha) {
    return { jh: 0, cout: 0, ha: ha || 0, detailRows: [] };
  }

  /**
   * Recopie une ligne en injectant `budget` dans les cellules concernées, et en
   * CRÉANT les cellules des parcelles budgétées mais non travaillées.
   *
   * @param {Object} row
   * @param {Object<string, number>} budgetCells parcelle → JH/Ha.
   * @param {Object<string, number>} haByParcelle
   * @returns {Object} nouvelle ligne (aucun argument muté).
   */
  function _cbp_decoreRow(row, budgetCells, haByParcelle) {
    var pivot = {};
    Object.keys(row.pivot || {}).forEach(function (p) { pivot[p] = row.pivot[p]; });
    Object.keys(budgetCells || {}).forEach(function (p) {
      var base = pivot[p] || _cbp_cellVierge(haByParcelle[p]);
      // Copie de surface : `detailRows` reste partagé (lecture seule côté pop-up).
      var copie = {};
      Object.keys(base).forEach(function (k) { copie[k] = base[k]; });
      copie.budget = budgetCells[p];
      pivot[p] = copie;
    });
    var out = {};
    Object.keys(row).forEach(function (k) { out[k] = row[k]; });
    out.pivot = pivot;
    return out;
  }

  /** Index de tri d'une famille (ordre canonique GB01→GB11, puis AUTRE/inconnu). */
  function _cbp_gbIndex(key, AU) {
    var i = (AU.GB_ORDER || []).indexOf(key);
    return i < 0 ? (AU.GB_ORDER || []).length : i;
  }

  /** Index de tri d'un groupe M.O (GROUPE_ORDER, inconnus à la fin). */
  function _cbp_groupeIndex(key, AU) {
    var i = (AU.GROUPE_ORDER || []).indexOf(key);
    return i < 0 ? (AU.GROUPE_ORDER || []).length : i;
  }

  /** Tri STABLE (Array#sort l'est en Node 20 / navigateurs modernes, mais on ne
   *  s'appuie pas dessus : l'index d'origine départage les ex æquo). */
  function _cbp_stableSort(list, rank) {
    return list
      .map(function (v, i) { return { v: v, i: i, r: rank(v) }; })
      .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
      .map(function (x) { return x.v; });
  }

  /**
   * Superpose le budget sur les lignes du pivot analytique. PURE.
   *
   * @param {Object} args
   * @param {Array<Object>} args.groupedRows lignes du RÉALISÉ
   *   (AnalytiqueUtils.buildAnalytiquePivotByFamille).
   * @param {Array<[string, number]>} args.parcelles colonnes (clé, Ha).
   * @param {Object} args.budgetsByLabel LABEL_MAJ → famille → JH/Ha.
   * @param {Object} args.opBudgetsByLabel LABEL_MAJ → famille → op → JH/Ha.
   * @param {Object} args.analytique AnalytiqueUtils.
   * @param {{familleTotal: Function, splitOpKey: Function}} args.budgetRules
   * @param {boolean} [args.detail] mode Détail : les lignes opération sont
   *   présentes dans `groupedRows` et reçoivent leur budget. En mode Récap, le
   *   budget des opérations reste porté par la ligne famille (cf. familleTotal),
   *   rien n'est ajouté.
   * @returns {{groupedRows: Array<Object>, hasBudget: boolean}} `hasBudget` =
   *   au moins une cellule budgétée. À false, l'appelant n'a aucune raison
   *   d'afficher les séries Budget/Écart (elles ne montreraient que des « — »).
   */
  function buildBudgetPivot(args) {
    /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
    var a = args || {};
    var rows = a.groupedRows || [];
    var AU = a.analytique;
    var rules = a.budgetRules || {};
    // Dégradation SÛRE : sans la règle métier ou sans le pivot, on rend le
    // réalisé tel quel plutôt qu'un budget calculé au jugé.
    if (!AU || typeof AU.resolveGbCode !== 'function' || typeof AU.opKey !== 'function'
      || typeof rules.familleTotal !== 'function' || typeof rules.splitOpKey !== 'function') {
      return { groupedRows: rows, hasBudget: false };
    }

    var haByParcelle = {};
    (a.parcelles || []).forEach(function (p) { haByParcelle[p[0]] = p[1]; });

    var index = indexBudgets({
      parcelles: a.parcelles,
      budgetsByLabel: a.budgetsByLabel,
      opBudgetsByLabel: a.opBudgetsByLabel,
      analytique: AU,
      budgetRules: rules,
    });

    // 1. Découpe des lignes source en segments { groupe → familles → opérations }.
    var segments = [];
    var parSegment = {};
    var cur = null;
    rows.forEach(function (r) {
      if (r.type === 'groupe') {
        cur = { key: r.key, row: r, items: [] };
        segments.push(cur);
        parSegment[r.key] = cur;
        return;
      }
      if (!cur) {
        cur = { key: r.groupeKey || '', row: null, items: [] };
        segments.push(cur);
        parSegment[cur.key] = cur;
      }
      if (r.type === 'famille') {
        cur.items.push({ key: r.key, row: r, ops: [] });
        return;
      }
      var last = cur.items[cur.items.length - 1];
      if (last) last.ops.push(r);
      else cur.items.push({ key: r.familleKey || r.key, row: null, ops: [r] });
    });

    // 2. Budget sur les lignes existantes.
    var vues = {};
    var vuesOps = {};
    segments.forEach(function (seg) {
      seg.items.forEach(function (item) {
        if (item.row) {
          vues[item.key] = item;
          var b = index.familles[item.key];
          item.row = _cbp_decoreRow(item.row, (b && b.cells) || {}, haByParcelle);
        }
        item.ops = item.ops.map(function (op) {
          vuesOps[op.key] = true;
          var b = index.operations[op.key];
          return _cbp_decoreRow(op, (b && b.cells) || {}, haByParcelle);
        });
      });
    });

    // 3. Familles budgétées sans aucun réalisé → lignes ajoutées (cf. en-tête).
    Object.keys(index.familles).forEach(function (gb) {
      if (vues[gb]) return;
      var groupeName = (AU.GB_GROUPE_MAP || {})[gb] || 'M.O Service générale';
      var seg = parSegment[groupeName];
      if (!seg) {
        seg = {
          key: groupeName,
          row: { type: 'groupe', key: groupeName, label: groupeName, pivot: {} },
          items: [],
        };
        segments.push(seg);
        parSegment[groupeName] = seg;
      }
      var item = {
        key: gb,
        row: _cbp_decoreRow(
          { type: 'famille', key: gb, label: index.familles[gb].label || gb,
            pivot: {}, groupeKey: groupeName },
          index.familles[gb].cells, haByParcelle
        ),
        ops: [],
      };
      seg.items.push(item);
      vues[gb] = item;
    });

    // 4. Opérations budgétées sans aucun réalisé (mode Détail uniquement).
    if (a.detail) {
      var ajouts = {};
      Object.keys(index.operations).forEach(function (rowKey) {
        if (vuesOps[rowKey]) return;
        var b = index.operations[rowKey];
        if (!ajouts[b.familleKey]) ajouts[b.familleKey] = [];
        ajouts[b.familleKey].push({ rowKey: rowKey, b: b });
      });
      Object.keys(ajouts).forEach(function (familleKey) {
        var item = vues[familleKey];
        if (!item) return;   // famille absente ET non budgétée : rien à rattacher
        ajouts[familleKey]
          .sort(function (x, y) { return String(x.b.label).localeCompare(String(y.b.label)); })
          .forEach(function (add) {
            item.ops.push(_cbp_decoreRow({
              type: 'operation',
              key: add.rowKey,
              label: add.b.label,
              pivot: {},
              familleKey: familleKey,
              groupeKey: (AU.GB_GROUPE_MAP || {})[familleKey] || 'M.O Service générale',
            }, add.b.cells, haByParcelle));
          });
      });
    }

    // 5. Remise en ordre canonique. Les lignes déjà présentes sont DÉJÀ dans cet
    //    ordre (même source) : le tri stable ne les bouge pas, il ne fait
    //    qu'insérer les nouvelles à leur place.
    var out = [];
    _cbp_stableSort(segments, function (s) { return _cbp_groupeIndex(s.key, AU); })
      .forEach(function (seg) {
        if (seg.row) out.push(seg.row);
        _cbp_stableSort(seg.items, function (it) { return _cbp_gbIndex(it.key, AU); })
          .forEach(function (item) {
            if (item.row) out.push(item.row);
            item.ops.forEach(function (op) { out.push(op); });
          });
      });

    var hasBudget = Object.keys(index.familles).some(function (gb) {
      return Object.keys(index.familles[gb].cells).length > 0;
    });
    return { groupedRows: out, hasBudget: hasBudget };
  }

  /**
   * Écart d'une cellule, en JH TOTAL (réalisé − budget). PURE.
   *
   * `null` = NON CALCULABLE, et il y a deux façons de l'être — aucune ne doit
   * produire 0, qui se lirait « pile sur le budget » :
   *   - aucun budget saisi sur cette (ligne, parcelle) : le cas nominal ;
   *   - superficie inconnue (F2 - ZUTANO, F4 -FUERTE en production) : un budget
   *     JH/Ha ne peut pas être converti en JH sans Ha.
   * Aucun plafonnement : un dépassement s'affiche tel quel.
   *
   * @param {Object} cell cellule du pivot ({jh, ha, budget}).
   * @returns {number|null}
   */
  function ecartCell(cell) {
    if (!cell) return null;
    var budget = Number(cell.budget);
    if (!isFinite(budget) || !(budget > 0)) return null;
    var ha = Number(cell.ha);
    if (!isFinite(ha) || !(ha > 0)) return null;
    var jh = Number(cell.jh);
    return (isFinite(jh) ? jh : 0) - budget * ha;
  }

  var __campagneBudgetPivotApi = {
    indexBudgets: indexBudgets,
    buildBudgetPivot: buildBudgetPivot,
    ecartCell: ecartCell,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __campagneBudgetPivotApi;
  if (typeof window !== 'undefined') window.CampagneBudgetPivot = __campagneBudgetPivotApi;

})();
