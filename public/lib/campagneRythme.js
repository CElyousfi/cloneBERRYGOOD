/**
 * campagneRythme.js — LES DEUX RESTES de la grille Campagne (LOT 3a).
 *
 * (La moyenne mobile porte sur les dernières quinzaines COMPLÈTES : la
 * quinzaine en cours, à moitié pointée, est exclue de la fenêtre — cf.
 * quinzainesInfo. Elle reste comptée dans le réalisé cumulé.)
 *
 * Chargé deux fois (UMD bricolé, comme public/lib/campagneBudgetPivot.js) :
 *   - navigateur, via <script src="lib/campagneRythme.js"> → window.CampagneRythme
 *   - node:test, via require('./campagneRythme.js')        → module.exports
 *
 * Toutes les fonctions sont PURES : rien n'est lu dans le scope global, les
 * modules dont ce calcul a besoin (AnalytiqueUtils pour la normalisation des
 * libellés d'opération) entrent par argument.
 *
 * ── DEUX RESTES, JAMAIS UN SEUL ──────────────────────────────────────────────
 *   reste budgété   = budget JH/Ha × Ha − réalisé cumulé
 *   reste au rythme = moyenne des N dernières quinzaines × quinzaines restantes
 *
 * Ils s'affichent CÔTE À CÔTE. Leur divergence EST l'information : un reste au
 * rythme supérieur au reste budgété annonce un dépassement en fin de campagne.
 * Les fusionner en un chiffre unique détruirait précisément ce signal.
 *   ⚠️ Ne jamais dériver un « atterrissage = réalisé + reste budgété » : par
 *   construction ça redonne le budget annuel, donc ça n'apprend rien.
 *
 * ── UNE MOYENNE MOBILE NE VAUT PAS PARTOUT ───────────────────────────────────
 * Projeter le rythme d'un poste SAISONNIER non démarré donnerait 0 — soit
 * « plus rien à consommer » sur un budget entier restant à dépenser, l'exact
 * inverse de la vérité. La classe est donc portée par le RÉFÉRENTIEL
 * (`referentiel_taches.classe_rythme`), au grain OPÉRATION — une famille est
 * souvent mixte (« Ferti-irrigation » contient `Irrigation & fertigation`,
 * continu, ET `Installation GAG`, saisonnier) :
 *
 *   continu      → moyenne mobile × quinzaines restantes
 *   saisonnier   → reste budgété (on suppose le budget dépensé comme prévu)
 *   recolte      → JAMAIS de projection → « — »
 *   inconnue     → pas de projection → « — » (jamais un défaut deviné)
 *
 * Le reste au rythme d'une FAMILLE est la somme des restes de ses opérations,
 * chacune selon SA classe (cf. resteRythmeCellule pour les quatre cas).
 *
 * ── PÉRIMÈTRE COMMUN AUX DEUX SÉRIES (décision structurante) ─────────────────
 * Le reste au rythme n'est calculé QUE là où le reste budgété l'est (budget
 * saisi ET Ha connu). Sans cette règle, les deux totaux porteraient sur des
 * ensembles de cellules différents et leur écart — la seule chose qu'on vient
 * lire — ne voudrait plus rien dire. Conséquence assumée : une famille non
 * budgétée n'est jamais projetée, même continue.
 *
 * ── CE QUI RESTE INDÉTERMINABLE (« — », jamais 0) ────────────────────────────
 *   - moins de MIN_QUINZAINES_CONSOMMEES quinzaines COMPLÈTES consommées ;
 *   - nombre de quinzaines restantes inconnu (campagne illisible) ;
 *   - aucun budget sur la cellule, ou superficie inconnue ;
 *   - classe d'opération inconnue, ou récolte.
 * Un 0 affiché se lirait « rien à dépenser d'ici la fin » : c'est une
 * affirmation, pas une absence de réponse.
 */
// @ts-check
'use strict';

(function () {

  /** Classes d'opération admises (champ `classe_rythme` du référentiel). */
  var CLASSES = { CONTINU: 'continu', SAISONNIER: 'saisonnier', RECOLTE: 'recolte' };

  /** Une quinzaine = une demi-quinzaine de mois. Sert à DÉRIVER le nombre de
   *  quinzaines d'une campagne — jamais un « 24 » écrit en dur, qui deviendrait
   *  faux le jour où la campagne change de longueur. */
  var QUINZAINES_PAR_MOIS = 2;

  /** Fenêtre de la moyenne mobile, en quinzaines écoulées (2 mois). Assez
   *  courte pour suivre une accélération récente, assez large pour absorber une
   *  opération à cadence mensuelle (qui, sur 3 quinzaines, oscillerait entre 1
   *  et 2 occurrences, soit ±50 %). */
  var FENETRE_PAR_DEFAUT = 4;

  /** Historique minimum avant toute projection, en quinzaines COMPLÈTES
   *  consommées (cf. `completes` ci-dessous). En dessous, une moyenne dit
   *  surtout quand la campagne a commencé. */
  var MIN_QUINZAINES_CONSOMMEES = 3;

  /** Numéro d'une quinzaine depuis son libellé (« Quinzaine 07 » → 7). 0 = illisible. */
  function quinzaineNum(label) {
    var m = /(\d{1,2})\s*$/.exec(String(label == null ? '' : label).trim());
    if (!m) return 0;
    var n = parseInt(m[1], 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * Nombre total de quinzaines d'une campagne, DÉRIVÉ de son libellé
   * (« 2026/2027 » ou « 2026-2027 » → 12 mois → 24 quinzaines).
   * @returns {number|null} null si le libellé n'est pas exploitable.
   */
  function totalQuinzaines(campagne) {
    var m = /^(\d{4})\D+(\d{4})$/.exec(String(campagne == null ? '' : campagne).trim());
    if (!m) return null;
    var mois = (parseInt(m[2], 10) - parseInt(m[1], 10)) * 12;
    if (!(mois > 0)) return null;
    return mois * QUINZAINES_PAR_MOIS;
  }

  /**
   * État d'avancement de la campagne, lu sur la réponse de
   * `campagne-analytique-detail` (`periodes` + `campagne`) — la MÊME source que
   * le réalisé affiché, donc jamais désynchronisée de lui.
   *
   * `ecoulees` = numéro de la DERNIÈRE quinzaine vue, pas le nombre de
   * quinzaines vues : une quinzaine sans le moindre pointage (absente de
   * `periodes`) est écoulée quand même, et le projeter comme si elle restait à
   * venir gonflerait le reste au rythme.
   *
   * ── LA QUINZAINE EN COURS N'ENTRE PAS DANS LE RYTHME (`completes`) ──────────
   * La dernière quinzaine vue est celle qu'on est en train de pointer : elle
   * n'est remplie qu'à moitié quand on regarde l'écran. La compter dans la
   * moyenne mobile écrase le rythme (jusqu'à −1/k), et cette sous-estimation est
   * ensuite MULTIPLIÉE par les quinzaines restantes. L'erreur va toujours dans
   * le même sens : elle SOUS-projette, donc elle SOUS-ALERTE — inacceptable pour
   * un indicateur dont l'unique rôle est d'avertir d'un dépassement.
   * `completes` = ecoulees − 1 : la quinzaine en cours reste comptée dans le
   * réalisé cumulé et dans les quinzaines écoulées (donc dans `restantes`), elle
   * est seulement exclue de la FENÊTRE qui mesure le rythme.
   *
   * `consommeesCompletes` (et non `consommees`) porte le minimum d'historique :
   * exiger 3 quinzaines dont la dernière est à moitié pointée reviendrait à
   * projeter sur 2 quinzaines et demie.
   *
   * @param {{periodes?: Array<string>, campagne?: string}} args
   * @returns {{consommees: number, consommeesCompletes: number, ecoulees: number,
   *   completes: number, total: number|null, restantes: number|null,
   *   projetable: boolean}}
   */
  function quinzainesInfo(args) {
    var a = args || {};
    var vues = {};
    var ecoulees = 0;
    (a.periodes || []).forEach(function (p) {
      var n = quinzaineNum(p);
      if (!(n > 0)) return;
      vues[n] = true;
      if (n > ecoulees) ecoulees = n;
    });
    var completes = Math.max(0, ecoulees - 1);
    var consommees = Object.keys(vues).length;
    var consommeesCompletes = Object.keys(vues).filter(function (n) {
      return Number(n) <= completes;
    }).length;
    var total = totalQuinzaines(a.campagne);
    var restantes = (total !== null && ecoulees > 0) ? Math.max(0, total - ecoulees) : null;
    return {
      consommees: consommees,
      consommeesCompletes: consommeesCompletes,
      ecoulees: ecoulees,
      completes: completes,
      total: total,
      restantes: restantes,
      projetable: consommeesCompletes >= MIN_QUINZAINES_CONSOMMEES && restantes !== null,
    };
  }

  /** Normalise un `classe_rythme` de fiche. Valeur absente ou inconnue → null
   *  (INCONNUE, pas « saisonnier par défaut » : on ne devine pas ici, c'est le
   *  script d'écriture du référentiel qui pose le défaut, explicitement). */
  function _cr_classe(raw) {
    var v = String(raw == null ? '' : raw).trim().toLowerCase();
    if (v === CLASSES.CONTINU || v === CLASSES.SAISONNIER || v === CLASSES.RECOLTE) return v;
    return null;
  }

  function _cr_opk(operation, opKeyFn) {
    if (typeof opKeyFn === 'function') return opKeyFn(operation);
    return String(operation == null ? '' : operation).trim().toLowerCase();
  }

  function _cr_code(code) {
    return String(code == null ? '' : code).trim().toUpperCase();
  }

  /**
   * Indexe les classes du référentiel des tâches.
   *
   * Clé PRINCIPALE = `CODE::opKey(libellé)`. Le libellé seul ne suffit pas :
   * « Nettoyage » existe sous GB05 (entretien de structure, saisonnier) ET sous
   * GB11 (ménage de ferme, continu). Une clé par libellé nu élirait l'une des
   * deux au hasard de l'ordre de lecture. Le repli par libellé nu n'est utilisé
   * que si le libellé est NON AMBIGU dans tout le référentiel (sinon : null).
   *
   * `byCode` sert les cellules sans aucune opération identifiable (famille
   * budgétée jamais travaillée) : la classe n'y est retenue que si TOUTES les
   * fiches du code la partagent — une famille mixte n'a pas de classe.
   *
   * @param {Array<{code?: string, operation?: string, classe_rythme?: string, classe?: string}>} fiches
   * @param {Function} [opKeyFn] AnalytiqueUtils.opKey (normalisation des libellés).
   */
  function indexClasses(fiches, opKeyFn) {
    var byCodeOp = {};
    var byOp = {};
    var byCode = {};
    (fiches || []).forEach(function (f) {
      if (!f || !f.operation) return;
      var classe = _cr_classe(f.classe_rythme !== undefined ? f.classe_rythme : f.classe);
      var code = _cr_code(f.code);
      var opk = _cr_opk(f.operation, opKeyFn);
      if (code) byCodeOp[code + '::' + opk] = classe;
      if (Object.prototype.hasOwnProperty.call(byOp, opk)) {
        if (byOp[opk] !== classe) byOp[opk] = null;   // libellé ambigu
      } else {
        byOp[opk] = classe;
      }
      if (!code) return;
      if (!Object.prototype.hasOwnProperty.call(byCode, code)) byCode[code] = classe;
      else if (byCode[code] !== classe) byCode[code] = null;
    });
    return { byCodeOp: byCodeOp, byOp: byOp, byCode: byCode };
  }

  /**
   * Classe d'une opération dont la clé est DÉJÀ normalisée (sortie de
   * `opKeyFn`). Les clés de l'index et celles des lignes du pivot passent par
   * la même fonction : re-normaliser ici casserait la jointure (opKey met en
   * MAJUSCULES, un `toLowerCase` de repli ne retrouverait plus rien).
   */
  function _cr_classeParOpk(index, code, opk) {
    var idx = index || {};
    var c = _cr_code(code);
    var byCodeOp = idx.byCodeOp || {};
    if (c && Object.prototype.hasOwnProperty.call(byCodeOp, c + '::' + opk)) {
      return byCodeOp[c + '::' + opk];
    }
    var byOp = idx.byOp || {};
    return Object.prototype.hasOwnProperty.call(byOp, opk) ? byOp[opk] : null;
  }

  /**
   * Classe d'une opération depuis son libellé BRUT. `null` = inconnue → aucune
   * projection.
   * @param {{byCodeOp: Object, byOp: Object}} index
   */
  function classeOf(index, code, operation, opKeyFn) {
    return _cr_classeParOpk(index, code, _cr_opk(operation, opKeyFn));
  }

  /** Classe d'une famille entière (code GB) — seulement si ses fiches sont unanimes. */
  function classeFamille(index, code) {
    var byCode = (index || {}).byCode || {};
    var c = _cr_code(code);
    return Object.prototype.hasOwnProperty.call(byCode, c) ? byCode[c] : null;
  }

  /**
   * Reste budgété d'une cellule, en JH TOTAL. PURE.
   *
   * `null` = NON CALCULABLE — deux causes, aucune ne doit produire 0 (qui se
   * lirait « budget épuisé, pile à zéro ») :
   *   - aucun budget saisi sur cette (ligne, parcelle) — le cas nominal ;
   *   - superficie inconnue : un budget JH/Ha ne se convertit pas en JH.
   * Aucun plafonnement : un dépassement sort en négatif, tel quel.
   *
   * C'est l'opposé exact de `CampagneBudgetPivot.ecartCell` (réalisé − budget) :
   * afficher les deux côte à côte montrerait deux fois le même nombre, au signe
   * près.
   *
   * @param {{budget?: number, ha?: number, jh?: number}} cell
   * @returns {number|null}
   */
  function resteBudgetCellule(cell) {
    if (!cell) return null;
    var budget = Number(cell.budget);
    if (!isFinite(budget) || !(budget > 0)) return null;
    var ha = Number(cell.ha);
    if (!isFinite(ha) || !(ha > 0)) return null;
    var jh = Number(cell.jh);
    return budget * ha - (isFinite(jh) ? jh : 0);
  }

  /**
   * Moyenne mobile des JH sur les `k` dernières quinzaines COMPLÈTES, avec
   * k = min(fenetre, jusqua).
   *
   * `jusqua` = dernière quinzaine INCLUSE dans la fenêtre — jamais la quinzaine
   * en cours (cf. `completes` dans quinzainesInfo) : à moitié pointée, elle
   * tirerait la moyenne vers le bas et ferait manquer des dépassements.
   *
   * Le diviseur est k, PAS le nombre de quinzaines effectivement travaillées :
   * une quinzaine sans travail sur cette ligne est un vrai zéro du rythme, pas
   * une absence de mesure. La diviser hors du calcul remonterait artificiellement
   * la moyenne d'un poste en train de s'arrêter.
   *
   * @param {Array<{periode?: string, jh?: number}>} detailRows
   * @param {{jusqua?: number, ecoulees?: number, fenetre?: number}} opts
   *   `ecoulees` reste accepté comme alias historique de `jusqua`.
   * @returns {number|null} null si aucune quinzaine complète.
   */
  function moyenneMobile(detailRows, opts) {
    var o = opts || {};
    var jusqua = Number(o.jusqua !== undefined ? o.jusqua : o.ecoulees) || 0;
    var fenetre = Number(o.fenetre) || FENETRE_PAR_DEFAUT;
    var k = Math.min(fenetre, jusqua);
    if (!(k > 0)) return null;
    var debut = jusqua - k + 1;
    var somme = 0;
    (detailRows || []).forEach(function (r) {
      var n = quinzaineNum(r && r.periode);
      if (!(n >= debut && n <= jusqua)) return;
      var jh = Number(r && r.jh);
      if (isFinite(jh)) somme += jh;
    });
    return somme / k;
  }

  /**
   * Opérations portées par une cellule : celles RÉALISÉES (regroupées depuis
   * `detailRows`) plus celles seulement BUDGÉTÉES (présentes dans l'index du
   * budget mais jamais travaillées — leur budget reste entièrement à consommer,
   * les ignorer sous-estimerait le reste).
   *
   * @returns {Array<{code: string, opk: string, jh: number, budget: number|null,
   *   rows: Array<Object>}>}
   */
  function _cr_opsDeCellule(row, parcelle, cell, budgetIndex, AU) {
    var opKeyFn = AU && AU.opKey;
    var out = [];
    var parOpk = {};
    function ajoute(code, opk) {
      if (parOpk[opk]) return parOpk[opk];
      var o = { code: code, opk: opk, jh: 0, budget: null, rows: [] };
      parOpk[opk] = o;
      out.push(o);
      return o;
    }
    if (row.type === 'operation') {
      var parts = String(row.key || '').split('::');
      var op = ajoute(parts.length > 1 ? parts[0] : (row.familleKey || ''), parts[parts.length - 1]);
      op.rows = (cell && cell.detailRows) || [];
      op.jh = Number(cell && cell.jh) || 0;
      op.budget = (cell && Number(cell.budget) > 0) ? Number(cell.budget) : null;
      return out;
    }
    ((cell && cell.detailRows) || []).forEach(function (r) {
      var o = ajoute(_cr_code(r.operationGroupe) || _cr_code(row.key), _cr_opk(r.operation, opKeyFn));
      o.rows.push(r);
      o.jh += Number(r.jh) || 0;
    });
    var ops = (budgetIndex && budgetIndex.operations) || {};
    Object.keys(ops).forEach(function (rowKey) {
      var b = ops[rowKey];
      if (!b || b.familleKey !== row.key) return;
      var v = Number((b.cells || {})[parcelle]);
      if (!(v > 0)) return;
      var segs = String(rowKey).split('::');
      var o2 = ajoute(_cr_code(row.key), segs[segs.length - 1]);
      o2.budget = v;
    });
    return out;
  }

  /**
   * Reste au rythme d'une cellule, en JH TOTAL. PURE.
   *
   * Quatre cas, dans cet ordre (le premier qui s'applique gagne) :
   *   1. une opération de classe INCONNUE ou RÉCOLTE → null. Un « — » sur la
   *      Récolte est voulu : son rythme dépend de la maturité des fruits, pas
   *      du passé récent.
   *   2. toutes SAISONNIÈRES → reste budgété (rythme nul ≠ rien à dépenser).
   *   3. toutes CONTINUES → moyenne mobile de la cellule × quinzaines restantes.
   *   4. MIXTE → somme opération par opération. Une opération saisonnière a
   *      alors besoin de SON budget (`budgets_operations`) ; sans lui, sa part
   *      est indéterminable et la cellule entière passe à « — » plutôt que de
   *      sortir une somme amputée.
   *
   * @param {Object} args
   * @param {Object} args.cell cellule du pivot (jh, ha, budget, detailRows).
   * @param {Array} args.ops sortie de _cr_opsDeCellule.
   * @param {string} args.familleKey code GB de la ligne (repli de classe).
   * @param {Object} args.classes index de indexClasses.
   * @param {{restantes: number|null, completes: number, projetable: boolean}} args.quinzaines
   * @param {number} [args.fenetre]
   * @returns {number|null}
   */
  function resteRythmeCellule(args) {
    var a = args || {};
    var q = a.quinzaines || {};
    var cell = a.cell;
    // PÉRIMÈTRE COMMUN : là où le reste budgété n'existe pas, on ne projette
    // pas non plus — sinon les deux totaux ne seraient plus comparables.
    var resteBudget = resteBudgetCellule(cell);
    if (resteBudget === null) return null;
    if (!q.projetable) return null;
    var restantes = Number(q.restantes);
    if (!isFinite(restantes)) return null;
    var ops = a.ops || [];
    var classes = ops.map(function (o) {
      return _cr_classeParOpk(a.classes, o.code, o.opk);
    });
    if (ops.length === 0) classes = [classeFamille(a.classes, a.familleKey)];
    var inconnue = classes.some(function (c) { return c === null || c === CLASSES.RECOLTE; });
    if (inconnue) return null;
    var continues = classes.filter(function (c) { return c === CLASSES.CONTINU; }).length;
    if (continues === 0) return resteBudget;                       // tout saisonnier
    if (continues === classes.length) {                            // tout continu
      var m = moyenneMobile((cell && cell.detailRows) || [],
        { jusqua: q.completes, fenetre: a.fenetre });
      return m === null ? null : m * restantes;
    }
    var ha = Number(cell && cell.ha) || 0;
    var somme = 0;
    for (var i = 0; i < ops.length; i += 1) {
      if (classes[i] === CLASSES.CONTINU) {
        var mo = moyenneMobile(ops[i].rows, { jusqua: q.completes, fenetre: a.fenetre });
        if (mo === null) return null;
        somme += mo * restantes;
        continue;
      }
      var b = Number(ops[i].budget);
      if (!(b > 0) || !(ha > 0)) return null;   // part saisonnière non chiffrable
      somme += b * ha - (Number(ops[i].jh) || 0);
    }
    return somme;
  }

  /** Copie de surface d'une cellule, enrichie des deux restes. Jamais de mutation :
   *  les lignes source sont partagées avec le pivot du réalisé. */
  function _cr_decoreCell(cell, resteBudget, resteRythme) {
    var copie = {};
    Object.keys(cell).forEach(function (k) { copie[k] = cell[k]; });
    if (resteBudget !== null) copie.resteBudget = resteBudget;
    if (resteRythme !== null) copie.resteRythme = resteRythme;
    return copie;
  }

  /**
   * Ajoute `resteBudget` et `resteRythme` (JH TOTAL) sur chaque cellule des
   * lignes famille et opération. PURE — aucun argument n'est muté.
   *
   * Les lignes `groupe` (bandeaux de section) sont laissées telles quelles :
   * la grille n'y affiche que la série primaire.
   *
   * @param {Object} args
   * @param {Array<Object>} args.groupedRows lignes DÉJÀ décorées du budget
   *   (CampagneBudgetPivot.buildBudgetPivot) — l'ordre est conservé à l'identique.
   * @param {Object} args.classes index de indexClasses.
   * @param {{restantes: number|null, completes: number, projetable: boolean}} args.quinzaines
   * @param {{familles: Object, operations: Object}} [args.budgetIndex]
   *   CampagneBudgetPivot.indexBudgets — sert les opérations budgétées non travaillées.
   * @param {Object} [args.analytique] AnalytiqueUtils.
   * @param {number} [args.fenetre]
   * @returns {{groupedRows: Array<Object>, perimetre: {famillesBudgetees: number,
   *   famillesProjetees: number, partiellementProjetees: Array<string>,
   *   nonProjetees: Array<string>}}}
   */
  function decoreRestes(args) {
    var a = args || {};
    var rows = a.groupedRows || [];
    var budgetees = 0;
    var projetees = 0;
    var partielles = [];
    var nonProjetees = [];
    var out = rows.map(function (row) {
      if (!row || row.type === 'groupe') return row;
      var pivot = {};
      // Comptage PAR CELLULE, pas « au moins une » : une famille budgétée sur 5
      // parcelles et projetée sur une seule n'est pas « projetée ». La compter
      // comme telle rendrait la légende optimiste au moment précis où elle doit
      // avertir que les deux totaux ne se comparent pas.
      var cellulesBudgetees = 0;
      var cellulesProjetees = 0;
      Object.keys(row.pivot || {}).forEach(function (p) {
        var cell = row.pivot[p];
        if (!cell) { pivot[p] = cell; return; }
        var resteBudget = resteBudgetCellule(cell);
        var resteRythme = resteRythmeCellule({
          cell: cell,
          ops: _cr_opsDeCellule(row, p, cell, a.budgetIndex, a.analytique),
          familleKey: row.type === 'famille' ? row.key : row.familleKey,
          classes: a.classes,
          quinzaines: a.quinzaines,
          fenetre: a.fenetre,
        });
        if (resteBudget !== null) cellulesBudgetees += 1;
        if (resteRythme !== null) cellulesProjetees += 1;
        pivot[p] = _cr_decoreCell(cell, resteBudget, resteRythme);
      });
      if (row.type === 'famille' && cellulesBudgetees > 0) {
        budgetees += 1;
        if (cellulesProjetees === cellulesBudgetees) projetees += 1;
        else if (cellulesProjetees > 0) partielles.push(row.label || row.key);
        else nonProjetees.push(row.label || row.key);
      }
      var copie = {};
      Object.keys(row).forEach(function (k) { copie[k] = row[k]; });
      copie.pivot = pivot;
      return copie;
    });
    return {
      groupedRows: out,
      perimetre: {
        famillesBudgetees: budgetees,
        famillesProjetees: projetees,
        partiellementProjetees: partielles,
        nonProjetees: nonProjetees,
      },
    };
  }

  /**
   * Phrase de PÉRIMÈTRE à afficher sous la grille. Elle n'est pas cosmétique :
   * la Récolte pèse l'essentiel du budget et n'est JAMAIS projetée, donc le
   * total « reste au rythme » est structurellement très inférieur au total
   * « reste budgété ». Sans cette mention, ça se lit comme une sous-consommation
   * massive alors que ce n'est qu'un périmètre différent.
   *
   * @param {{famillesBudgetees: number, famillesProjetees: number,
   *   partiellementProjetees?: Array<string>, nonProjetees: Array<string>}} perimetre
   * @param {{restantes: number|null, completes: number, consommeesCompletes: number,
   *   projetable: boolean}} q
   * @param {number} [fenetre]
   * @returns {string}
   */
  function noteRestes(perimetre, q, fenetre) {
    var p = perimetre || {};
    var quinz = q || {};
    var base = 'Reste budgété = budget × Ha − réalisé. ';
    var sfin = 'Le « — » signale une valeur non calculable : aucun budget saisi,'
      + ' superficie inconnue, ou pas de projection.';
    // Rien de projeté : on n'ANNONCE PAS une formule pour la nier dans la phrase
    // suivante — et surtout jamais un « × ? quinzaine restante » quand la durée
    // de la campagne est illisible.
    if (!quinz.projetable) {
      var cause = quinz.restantes === null
        ? 'la durée de la campagne n\'a pas pu être déterminée'
        : 'moins de ' + MIN_QUINZAINES_CONSOMMEES + ' quinzaines complètes consommées'
          + ' (la quinzaine en cours ne compte pas, elle n\'est pointée qu\'en partie)';
      return base + 'Aucun reste au rythme n\'est calculé : ' + cause + '. ' + sfin;
    }
    var f = Math.min(Number(fenetre) || FENETRE_PAR_DEFAUT, Number(quinz.completes) || 0);
    var r = Number(quinz.restantes);
    var txt = base + 'Reste au rythme = moyenne des ' + f + ' dernières quinzaines'
      + ' complètes × ' + r + ' quinzaine' + (r > 1 ? 's' : '')
      + ' restante' + (r > 1 ? 's' : '') + '. ';
    txt += 'Projeté sur ' + p.famillesProjetees + ' famille'
      + (p.famillesProjetees > 1 ? 's' : '') + ' budgétée'
      + (p.famillesProjetees > 1 ? 's' : '') + ' sur ' + p.famillesBudgetees + '.';
    if (p.partiellementProjetees && p.partiellementProjetees.length) {
      txt += ' Projetée' + (p.partiellementProjetees.length > 1 ? 's' : '')
        + ' sur une partie des parcelles seulement : '
        + p.partiellementProjetees.join(', ') + '.';
    }
    if (p.nonProjetees && p.nonProjetees.length) {
      txt += ' Non projetée' + (p.nonProjetees.length > 1 ? 's' : '') + ' : '
        + p.nonProjetees.join(', ')
        + ' (récolte jamais projetée, ou opération sans classe de rythme connue).';
    }
    if ((p.nonProjetees && p.nonProjetees.length)
      || (p.partiellementProjetees && p.partiellementProjetees.length)) {
      txt += ' Les deux totaux ne portent donc pas sur le même périmètre.';
    }
    return txt + ' ' + sfin;
  }

  var __campagneRythmeApi = {
    CLASSES: CLASSES,
    QUINZAINES_PAR_MOIS: QUINZAINES_PAR_MOIS,
    FENETRE_PAR_DEFAUT: FENETRE_PAR_DEFAUT,
    MIN_QUINZAINES_CONSOMMEES: MIN_QUINZAINES_CONSOMMEES,
    quinzaineNum: quinzaineNum,
    totalQuinzaines: totalQuinzaines,
    quinzainesInfo: quinzainesInfo,
    indexClasses: indexClasses,
    classeOf: classeOf,
    classeFamille: classeFamille,
    resteBudgetCellule: resteBudgetCellule,
    moyenneMobile: moyenneMobile,
    resteRythmeCellule: resteRythmeCellule,
    decoreRestes: decoreRestes,
    noteRestes: noteRestes,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = __campagneRythmeApi;
  if (typeof window !== 'undefined') window.CampagneRythme = __campagneRythmeApi;

})();
