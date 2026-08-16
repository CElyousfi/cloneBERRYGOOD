/*
 * CampagneBudgetTab.jsx — Saisie du budget JH / Ha par parcelle × opération
 *
 * Omar saisit un budget de main d'œuvre en JOURS-HOMME PAR HECTARE, pour une
 * parcelle donnée, au niveau NATURE OPÉRATION (≈108 opérations), regroupées par
 * famille (Ferti-irrigation, Taille, Entretien structure…). Ce budget
 * alimentera plus tard l'export Campagne (% consommé, JH/Ha restant, Total JH
 * restant) — LOT suivant, hors de ce fichier.
 *
 * DEUX NIVEAUX DE SAISIE, sans migration des données déjà enregistrées :
 *   - par OPÉRATION : le mode nominal ;
 *   - par FAMILLE : quand aucune opération de la famille n'est budgétée. C'est
 *     le cas réel de « Service générale » dans le fichier d'Omar, et c'est
 *     aussi la forme des documents écrits par le lot précédent.
 * Le niveau famille est le cas NOMINAL, pas un cas limite : dans le fichier
 * d'Omar, « Récolte » (1800 JH/Ha, ~73 % du budget) et « Service générale » ne
 * sont budgétées qu'au total de famille, aucune de leurs 11 + 18 opérations
 * n'est renseignée.
 *
 * Total d'une famille (CBT_familleTotal, PURE) : somme de ses opérations si
 * elle en porte au moins une, SINON sa valeur de famille. Jamais les deux —
 * la ligne « famille » devient donc calculée (non éditable) dès qu'une
 * opération est renseignée, et redevient saisissable si on efface toutes les
 * opérations.
 *
 * CAS MIXTE (total de famille saisi ET quelques opérations renseignées) : les
 * opérations gagnent, la valeur de famille est neutralisée à l'enregistrement.
 * Additionner reviendrait à compter deux fois ce que les opérations détaillent
 * déjà ; garder la valeur de famille en base la ferait ressurgir après
 * effacement des opérations. Comme c'est une perte de saisie, elle est signalée
 * TROIS fois, jamais par un simple `title=` (invisible au doigt) :
 *   1. badge ambre TEXTE sur la ligne, portant la valeur menacée ;
 *   2. confirmation avant l'écriture, listant TOUTES les familles concernées —
 *      le save porte sur la parcelle entière, donc une famille repliée peut
 *      être neutralisée par un enregistrement déclenché pour une autre ;
 *   3. rapport ambre après l'écriture, alimenté par `familles_neutralisees`
 *      renvoyé par le backend (seule source fiable de ce qui a réellement été
 *      remplacé).
 *
 * CLÉ D'UNE OPÉRATION = (CODE GB, LIBELLÉ), jamais (FAMILLE, LIBELLÉ). Le
 * tableau Campagne ne lit pas la famille inscrite sur la fiche d'une opération :
 * il la déduit du code GB porté par chaque ligne de pointage BEE ONE
 * (`resolveFamily` → `_refMap[code].famille`). Deux fiches légitimes portent le
 * même libellé sous deux codes — « Nettoyage » existe en GB05 (Entretien
 * structure) ET en GB11 (Service générale). Cet écran résout donc la famille
 * DEPUIS LE CODE (`familles_par_code`, servi par referentiel-taches-list),
 * identifie chaque opération par la clé `CODE::Libellé`, et AFFICHE le code à
 * côté du libellé : deux lignes distinctes, deux budgets distincts, aucune
 * ambiguïté à l'œil.
 *
 * Sources :
 *   GET  /api/pointage-rh?action=parcelles-campagne-list   (parcelles campagne)
 *   GET  /api/pointage-rh?action=sb-referentiel-list       (nom SB + Ha)
 *   GET  /api/pointage-rh?action=referentiel-taches-list   (familles — jamais figées)
 *   GET  /api/pointage-rh?action=campagne-budget-list      (budgets enregistrés)
 *   POST /api/pointage-rh?action=campagne-budget-save      (upsert, DG/RH/admin)
 *
 * Écriture Firestore : Cloud Function UNIQUEMENT (la collection
 * `sb_campagne_budget_jh` est en deny total côté règles).
 *
 * Pattern UMD — expose window.CampagneBudgetTab. Pas de JSX (le fichier est
 * babélisé mais les helpers purs sont chargés tels quels dans les tests via vm).
 */
(function () {
  'use strict';

  var React = window.React;
  if (!React) return;
  var useState = React.useState;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;

  var CBT_C = {
    berry:    '#c0392b',
    green:    '#1D9E75',
    amber:    '#b45309',
    gray:     '#888780',
    surface:  '#ffffff',
    surface2: '#f5f4ef',
    border:   'rgba(0,0,0,0.10)',
    text:     '#1c1c1a',
    textSec:  '#5f5e5a',
    textTer:  '#8a8985',
  };

  var CBT_FAMILLE_ICONS = {
    'Travaux du sol':        'fa-trowel',
    'Ferti-irrigation':      'fa-droplet',
    'Plantation':            'fa-seedling',
    'Mise en valeur':        'fa-hammer',
    'Entretien structure':   'fa-screwdriver-wrench',
    'Traitement phyto':      'fa-spray-can',
    'Tuteurage & palissage': 'fa-grip-lines-vertical',
    'Taille':                'fa-scissors',
    'Arrachage':             'fa-shovel',
    'Services généraux':     'fa-people-group',
    'Récolte':               'fa-basket-shopping',
  };

  var CULTURE_COLORS = {
    Framboise: { bg: '#fce4e4', text: '#c0392b' },
    Myrtille:  { bg: '#dbeafe', text: '#1d4ed8' },
    Avocatier: { bg: '#d1fae5', text: '#065f46' },
  };

  /** Culture d'une parcelle — source de vérité partagée (public/lib/cultureUtils.js). */
  function cbtCulture(cultureField, labelFallback) {
    var CU = window.CultureUtils;
    if (CU && typeof CU.normCulture === 'function') return CU.normCulture(cultureField, labelFallback);
    return '';
  }

  /** Ha d'une parcelle — helper global d'app.jsx (référentiel SB puis campagne). */
  function cbtHa(label) {
    return typeof window.sbParcelleHa === 'function' ? (window.sbParcelleHa(label) || 0) : 0;
  }

  /** Nom affiché d'une parcelle — helper global d'app.jsx (nom SB sinon label). */
  function cbtNom(label) {
    return typeof window.sbParcelleNom === 'function' ? window.sbParcelleNom(label) : (label || '—');
  }

  /** Séparateur de la clé persistée `CODE::Libellé` — miroir du backend. */
  var CBT_OP_KEY_SEP = '::';

  /** Forme d'un code de groupe BEE ONE ('GB05', 'LB03'). */
  var CBT_CODE_RE = /^[A-Za-z0-9_-]+$/;

  /**
   * Clé canonique d'une opération : `CODE::Libellé`. PURE.
   *
   * Miroir exact de `opKey` de functions/lib/campagneBudget/validate.js (le
   * backend ne peut pas requérir public/ — cf. CLAUDE.md) ; un corpus partagé
   * vérifie que les deux implémentations ne divergent pas.
   *
   * @param {*} code
   * @param {*} operation
   * @returns {string}
   */
  function CBT_opKey(code, operation) {
    var c = String(code == null ? '' : code).trim().toUpperCase();
    var op = String(operation == null ? '' : operation).trim();
    if (!c || !CBT_CODE_RE.test(c)) return op;
    return c + CBT_OP_KEY_SEP + op;
  }

  /**
   * Décompose une clé d'opération. PURE. Miroir de `splitOpKey` (backend).
   *
   * @param {*} key
   * @returns {{code: string, operation: string}} `code: ''` = clé sans code.
   */
  function CBT_splitOpKey(key) {
    var raw = String(key == null ? '' : key).trim();
    var i = raw.indexOf(CBT_OP_KEY_SEP);
    if (i <= 0) return { code: '', operation: raw };
    var code = raw.slice(0, i);
    if (!CBT_CODE_RE.test(code)) return { code: '', operation: raw };
    return { code: code.toUpperCase(), operation: raw.slice(i + CBT_OP_KEY_SEP.length).trim() };
  }

  /**
   * Famille d'une opération, résolue DEPUIS LE CODE GB. PURE.
   *
   * Miroir de `familleDuCode` (backend), lui-même miroir de `resolveFamily` de
   * functions/pointageService.js : le tableau Campagne n'utilise JAMAIS la
   * famille inscrite sur la fiche, il la déduit du code porté par la ligne de
   * pointage. L'écran de saisie doit faire pareil, sinon un budget peut être
   * saisi sous une famille que le réalisé n'alimentera jamais.
   *
   * @param {*} code
   * @param {*} familleFiche repli quand le code est inconnu de la table.
   * @param {Object<string, *>} famillesParCode code → famille (ou → {famille}).
   * @returns {string}
   */
  function CBT_familleDuCode(code, familleFiche, famillesParCode) {
    var c = String(code == null ? '' : code).trim();
    var map = famillesParCode && typeof famillesParCode === 'object'
      && !Array.isArray(famillesParCode) ? famillesParCode : {};
    var hit = c ? map[c] : null;
    var resolved = hit && typeof hit === 'object' ? hit.famille : hit;
    var r = String(resolved == null ? '' : resolved).trim();
    if (r) return r;
    return String(familleFiche == null ? '' : familleFiche).trim();
  }

  /**
   * Libellé lisible d'une opération : « Libellé (CODE) ». PURE.
   *
   * @param {*} key clé d'opération.
   * @returns {string}
   */
  function CBT_operationLabel(key) {
    var p = CBT_splitOpKey(key);
    return p.operation + (p.code ? ' (' + p.code + ')' : '');
  }

  /**
   * Liste ordonnée et dédupliquée des familles d'opération. PURE.
   *
   * Familles RÉSOLUES DEPUIS LE CODE (cf. CBT_familleDuCode), triées par l'ordre
   * du référentiel — la même maille et le même ordre que le tableau Campagne,
   * jamais une liste figée en dur.
   *
   * @param {Array<{code?: string, famille?: string, ordre?: number}>} ops
   * @param {Object<string, *>} [famillesParCode] table code → famille.
   * @returns {Array<string>}
   */
  function CBT_famillesFromOps(ops, famillesParCode) {
    var sorted = (ops || []).slice().sort(function (a, b) {
      return ((a && a.ordre) || 0) - ((b && b.ordre) || 0);
    });
    var seen = {};
    var out = [];
    sorted.forEach(function (o) {
      var f = CBT_familleDuCode(o && o.code, o && o.famille, famillesParCode);
      if (!f || seen[f]) return;
      seen[f] = true;
      out.push(f);
    });
    return out;
  }

  /**
   * Opérations du référentiel groupées par famille, dans l'ordre. PURE.
   *
   * Chaque opération est identifiée par sa CLÉ `CODE::Libellé` : un même libellé
   * porté par deux codes donne DEUX lignes distinctes, donc deux budgets
   * distincts (cas réel « Nettoyage » GB05/GB11). La déduplication porte sur la
   * clé, jamais sur le seul libellé — sinon la seconde opération disparaissait
   * silencieusement de l'écran.
   *
   * @param {Array<{code?: string, famille?: string, operation?: string,
   *   ordre?: number}>} ops
   * @param {Object<string, *>} [famillesParCode] table code → famille.
   * @returns {Object<string, Array<string>>} famille → clés d'opération.
   */
  function CBT_opsByFamille(ops, famillesParCode) {
    var sorted = (ops || []).slice().sort(function (a, b) {
      return ((a && a.ordre) || 0) - ((b && b.ordre) || 0);
    });
    var out = {};
    sorted.forEach(function (o) {
      var f = CBT_familleDuCode(o && o.code, o && o.famille, famillesParCode);
      var op = o && o.operation ? String(o.operation).trim() : '';
      if (!f || !op) return;
      var key = CBT_opKey(o && o.code, op);
      if (!out[f]) out[f] = [];
      if (out[f].indexOf(key) === -1) out[f].push(key);
    });
    return out;
  }

  /**
   * Indexe les budgets renvoyés par l'API par label BEE ONE EN MAJUSCULES —
   * même clé que window.SB_PARCELLE_REF. PURE.
   *
   * @param {Array<{label_bee_one?: string, budgets?: Object}>} list
   * @returns {Object<string, Object<string, number>>}
   */
  function CBT_budgetsByLabel(list) {
    var out = {};
    (list || []).forEach(function (b) {
      var key = String((b && b.label_bee_one) || '').trim().toUpperCase();
      if (!key) return;
      out[key] = (b && b.budgets) || {};
    });
    return out;
  }

  /**
   * Idem pour les budgets PAR OPÉRATION. PURE. Séparé de CBT_budgetsByLabel :
   * un document du lot précédent n'a pas de champ `budgets_operations` — il
   * doit rester lisible tel quel, sans migration (→ map vide).
   *
   * @param {Array<{label_bee_one?: string, budgets_operations?: Object}>} list
   * @returns {Object<string, Object<string, Object<string, number>>>}
   */
  function CBT_operationsByLabel(list) {
    var out = {};
    (list || []).forEach(function (b) {
      var key = String((b && b.label_bee_one) || '').trim().toUpperCase();
      if (!key) return;
      out[key] = (b && b.budgets_operations) || {};
    });
    return out;
  }

  /**
   * Nombre saisi (chaîne FR ou nombre) → number, 0 si vide/invalide. PURE.
   *
   * @param {*} raw
   * @returns {number}
   */
  function CBT_num(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return 0;
    var n = parseFloat(String(raw).trim().replace(',', '.'));
    return isNaN(n) || !isFinite(n) ? 0 : n;
  }

  /**
   * RÈGLE MÉTIER CENTRALE — total JH/Ha d'une famille. PURE.
   *
   * Somme des opérations de la famille si elle en porte au moins une > 0,
   * SINON la valeur saisie au niveau famille. Les deux niveaux ne s'additionnent
   * JAMAIS : le niveau famille est un total de repli (cas « Service générale »,
   * et documents historiques saisis avant la descente au niveau opération).
   *
   * Miroir exact de `familleTotal` de functions/lib/campagneBudget/validate.js
   * (le backend ne peut pas requérir public/ — cf. CLAUDE.md).
   *
   * @param {string} famille
   * @param {Object<string, *>} values saisie niveau famille.
   * @param {Object<string, Object<string, *>>} opValues saisie niveau opération.
   * @returns {{total: number, source: 'operations'|'famille'|'aucun'}}
   */
  function CBT_familleTotal(famille, values, opValues) {
    var key = String(famille == null ? '' : famille);
    var ops = (opValues || {})[key];
    var somme = 0;
    // `!Array.isArray` : garde alignée sur le miroir backend. Inatteignable via
    // l'UI, mais les deux implémentations doivent rester STRICTEMENT
    // équivalentes — un test à corpus partagé le vérifie.
    if (ops && typeof ops === 'object' && !Array.isArray(ops)) {
      Object.keys(ops).forEach(function (op) {
        var n = CBT_num(ops[op]);
        if (n > 0) somme += n;
      });
    }
    if (somme > 0) return { total: Math.round(somme * 100) / 100, source: 'operations' };
    var n = CBT_num((values || {})[key]);
    if (n > 0) return { total: Math.round(n * 100) / 100, source: 'famille' };
    return { total: 0, source: 'aucun' };
  }

  /**
   * Familles dont la valeur de famille va être REMPLACÉE par le détail des
   * opérations au prochain enregistrement. PURE.
   *
   * Indispensable parce que le save est global à la parcelle, pas limité à la
   * famille éditée : une famille repliée — ou jamais ouverte — peut être
   * neutralisée par un enregistrement déclenché pour une autre. L'utilisateur
   * n'a aucun moyen de le deviner ; cette liste alimente la confirmation.
   *
   * @param {Object} args
   * @param {Array<string>} args.familles
   * @param {Object<string, *>} args.values
   * @param {Object<string, Object<string, *>>} args.opValues
   * @returns {Array<{famille: string, valeur: number, total: number}>}
   */
  function CBT_famillesNeutralisees(args) {
    var a = args || {};
    var out = [];
    (a.familles || []).forEach(function (f) {
      var valeur = CBT_num((a.values || {})[f]);
      if (!(valeur > 0)) return;
      var tot = CBT_familleTotal(f, a.values, a.opValues);
      if (tot.source !== 'operations') return;
      out.push({ famille: f, valeur: valeur, total: tot.total });
    });
    return out;
  }

  /**
   * Deux listes de neutralisations décrivent-elles EXACTEMENT le même effet ?
   * PURE.
   *
   * Sert à refuser une confirmation devenue caduque (parcelle changée, données
   * rechargées, saisie modifiée entre-temps) : ce qui a été confirmé doit être
   * ce qui est écrit, sinon on ne écrit pas.
   *
   * @param {Array<{famille?: *, valeur?: *, total?: *}>|null|undefined} a
   * @param {Array<{famille?: *, valeur?: *, total?: *}>|null|undefined} b
   * @returns {boolean}
   */
  function CBT_memeNeutralisations(a, b) {
    function cle(list) {
      return (Array.isArray(list) ? list : [])
        .map(function (n) {
          if (!n || typeof n !== 'object') return '';
          return String(n.famille) + '|' + CBT_num(n.valeur) + '|' + CBT_num(n.total);
        })
        .sort()
        .join('§');
    }
    return cle(a) === cle(b);
  }

  /**
   * Cultures pour lesquelles un budget de QUINZAINE se saisit. Miroir de
   * `CULTURES_BUDGET_QUINZAINE` (functions/lib/campagneBudget/validate.js) : le
   * serveur refuse une écriture forgée sur l'avocatier, l'écran ne fait que ne
   * pas la proposer. Les deux, jamais l'un sans l'autre.
   */
  var CBT_CULTURES_QUINZAINE = ['Framboise', 'Myrtille'];

  /**
   * Cette parcelle accepte-t-elle un budget de quinzaine ? PURE.
   *
   * La culture est résolue par `CultureUtils.resolveCulture` (référentiel SB
   * prioritaire, repli sur le libellé) — JAMAIS par une regex locale : le repli
   * résout correctement les 17 libellés réels, dont les 14 qui n'ont pas de
   * `culture_sb`.
   *
   * @param {string} culture culture DÉJÀ résolue.
   * @returns {boolean} false si la culture est inconnue (fail-closed, comme le
   *   serveur).
   */
  function CBT_quinzaineApplicable(culture) {
    return CBT_CULTURES_QUINZAINE.indexOf(String(culture || '').trim()) !== -1;
  }

  /**
   * Cultures MASQUÉES du sélecteur de parcelle de cet écran.
   *
   * Décision d'INTERFACE uniquement : l'avocatier n'est pas budgété en JH/Ha
   * ici, l'écran cesse donc de le proposer. AUCUNE écriture, aucune purge,
   * aucun gate serveur — les documents avocatier déjà en base (473 valeurs en
   * prod) restent lisibles par les écrans de suivi, et la réversion tient au
   * retrait d'un élément de ce tableau.
   *
   * ⚠️ Contrairement à `CBT_CULTURES_QUINZAINE`, cette liste n'a **PAS** de
   * miroir dans `functions/` — c'est VOULU. Une écriture avocatier forgée reste
   * acceptée par le backend, et c'est le comportement attendu : rien n'est
   * interdit, c'est seulement retiré de l'offre. Ne pas « corriger la
   * divergence » en ajoutant un refus serveur, ce serait un changement de
   * comportement produit (GATED), pas un alignement.
   *
   * Liste d'EXCLUSION et non d'inclusion : une culture inconnue reste VISIBLE
   * (fail-open). Le budget annuel est ouvert à toutes les cultures — à
   * l'inverse du budget de quinzaine, fail-closed parce que le serveur y refuse
   * ce qu'il ne connaît pas.
   */
  var CBT_CULTURES_MASQUEES = ['Avocatier'];

  /**
   * Culture RÉSOLUE d'une ligne de parcelle. PURE (`sbMap` TOUJOURS injecté).
   *
   * Passe par `CultureUtils.resolveCulture`, et NON `normCulture` : le
   * `culture_sb` du référentiel Smart Berry est une donnée saisie à la main,
   * elle fait autorité sur l'heuristique de libellé. Une parcelle mal classée
   * par le repli se corrige donc dans Paramètres → Parcelles, sans toucher à
   * cet écran.
   *
   * `cbtCulture` (:107) reste inchangé et continue de servir le badge de
   * culture et le gating quinzaine : ce ticket ne rouvre pas ce comportement.
   *
   * REPLI : `public/lib/cultureUtils.js` est chargé en <script> séparé —
   * absent (404, déploiement partiel), on retombe sur `cbtCulture`, qui renvoie
   * alors ''. Une culture '' laisse la parcelle VISIBLE (cf.
   * `CBT_CULTURES_MASQUEES`, fail-open) : une résolution impossible ne doit
   * JAMAIS faire disparaître des parcelles de l'écran de saisie.
   *
   * @param {{label?: string, culture?: string}|null|undefined} row ligne de
   *   `parcelles-campagne-list`.
   * @param {Object<string, *>} [sbMap] référentiel SB `{ LABEL: {culture_sb} }`.
   * @returns {string} culture résolue, '' si aucune résolution n'est possible.
   */
  function CBT_cultureRow(row, sbMap) {
    var r = row || {};
    var CU = window.CultureUtils;
    if (CU && typeof CU.resolveCulture === 'function') {
      return CU.resolveCulture({ label: r.label, culture: r.culture }, sbMap);
    }
    return cbtCulture(r.culture, r.label);
  }

  /**
   * Cette parcelle est-elle PROPOSABLE à la saisie de budget ? PURE.
   *
   * @param {{label?: string, culture?: string}|null|undefined} row
   * @param {Object<string, *>} [sbMap] référentiel SB (injecté).
   * @returns {boolean} true par défaut (fail-open, cf. CBT_CULTURES_MASQUEES).
   */
  function CBT_parcelleAffichable(row, sbMap) {
    return CBT_CULTURES_MASQUEES.indexOf(CBT_cultureRow(row, sbMap)) === -1;
  }

  // ==========================================================================
  // PORTÉE DE SAISIE (Parcelle / Variété / Culture) — helpers PURS
  //
  // Le stockage reste PAR PARCELLE (un document `{campagne}__{LABEL}`) : la
  // portée n'est qu'un moyen de saisir une grille une fois et de l'écrire sur
  // les N parcelles cibles. Aucun nouveau niveau de document, aucun héritage.
  // ==========================================================================

  /** Séparateur de la clé de bucket de variété. */
  var CBT_VAR_KEY_SEP = '||';

  /** Portées de saisie proposées par l'écran, dans l'ordre d'affichage. */
  var CBT_PORTEES = [
    {
      key: 'parcelle', label: 'Parcelle',
      aide: 'Saisir le budget d\'une seule parcelle',
    },
    {
      key: 'variete', label: 'Variété',
      aide: 'Saisir la même grille pour toutes les parcelles d\'une variété',
    },
    {
      key: 'culture', label: 'Culture',
      aide: 'Saisir la même grille pour toutes les parcelles d\'une culture',
    },
  ];

  /**
   * Normalise une variété : trim, MAJUSCULES, espaces internes réduits à un.
   *
   * @param {*} raw
   * @returns {string} '' si absente.
   */
  function CBT_normVariete(raw) {
    return String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, ' ');
  }

  /**
   * Clé de bucket de variété : `CULTURE||VARIETE`. PURE (`sbMap` injecté).
   *
   * Clé COMPOSITE volontairement : chaque bucket est ainsi mono-culture, ce qui
   * importe parce que la culture porte deux décisions (le masquage de cet écran
   * et l'applicabilité du budget de quinzaine). Une variété seule pourrait, en
   * théorie, être partagée par deux cultures et produire un bucket mixte.
   *
   * Source de la variété : `row.variete`, déjà servi par `toRow`
   * (functions/pointageService.js) et jamais consommé par cet écran jusqu'ici —
   * AUCUN changement serveur n'est nécessaire.
   *
   * @param {{label?: string, culture?: string, variete?: string}|null|undefined} row
   * @param {Object<string, *>} [sbMap] référentiel SB (injecté).
   * @returns {string} '' si la variété est absente OU si la culture n'a pas pu
   *   être résolue : un bucket dont une composante est l'absence de donnée n'est
   *   pas proposable (cf. CBT_porteeOptions).
   */
  function CBT_varieteKey(row, sbMap) {
    var r = row || {};
    var culture = String(CBT_cultureRow(r, sbMap) || '').trim();
    var variete = CBT_normVariete(r.variete);
    if (!culture || !variete) return '';
    return culture + CBT_VAR_KEY_SEP + variete;
  }

  /**
   * Buckets de portée proposables, dérivés des parcelles affichées. PURE.
   *
   * `rows` doit être la liste DÉJÀ masquée (`rowsAffichables`). Le filtre est
   * néanmoins REJOUÉ ici : un bucket de culture masquée ne doit pas exister,
   * même si l'appelant se trompe de liste. Sur `rowsAffichables` c'est un no-op.
   *
   * Le bucket de variété VIDE est EXCLU de `varietes` : un bucket dont la clé
   * est l'absence de donnée est précisément celui sur lequel on ne veut pas
   * d'écriture en aveugle. Ces parcelles restent saisissables en portée
   * Parcelle, et elles comptent normalement dans leur bucket de Culture.
   *
   * Déduplication sur le label en MAJUSCULES (même clé que
   * `window.SB_PARCELLE_REF`) : une parcelle listée deux fois ne compte qu'une.
   * Tri alphabétique, donc indépendant de l'ordre d'arrivée des lignes.
   *
   * @param {Object} args
   * @param {Array<{label?: string, culture?: string, variete?: string}>} args.rows
   * @param {Object<string, *>} [args.sbMap] référentiel SB (injecté).
   * @returns {{varietes: Array<{key: string, label: string, culture: string,
   *   variete: string, nb: number}>, cultures: Array<{key: string,
   *   label: string, nb: number}>}}
   */
  function CBT_porteeOptions(args) {
    var a = args || {};
    var sbMap = a.sbMap;
    var vues = {};
    var parVariete = {};
    var parCulture = {};
    (a.rows || []).forEach(function (r) {
      var label = String((r && r.label) || '').trim().toUpperCase();
      if (!label || vues[label]) return;
      vues[label] = true;
      var culture = String(CBT_cultureRow(r, sbMap) || '').trim();
      if (CBT_CULTURES_MASQUEES.indexOf(culture) !== -1) return;
      if (culture) {
        parCulture[culture] = (parCulture[culture] || 0) + 1;
      }
      var key = CBT_varieteKey(r, sbMap);
      if (!key) return;
      if (!parVariete[key]) {
        parVariete[key] = { culture: culture, variete: CBT_normVariete(r && r.variete), nb: 0 };
      }
      parVariete[key].nb += 1;
    });
    var varietes = Object.keys(parVariete).sort().map(function (key) {
      var b = parVariete[key];
      return {
        key: key,
        label: b.culture + ' / ' + b.variete,
        culture: b.culture,
        variete: b.variete,
        nb: b.nb,
      };
    });
    var cultures = Object.keys(parCulture).sort().map(function (key) {
      return { key: key, label: key, nb: parCulture[key] };
    });
    return { varietes: varietes, cultures: cultures };
  }

  /**
   * Labels BEE ONE des parcelles CIBLES d'un enregistrement. PURE.
   *
   * Labels rendus BRUTS, dans la forme du référentiel (pas en MAJUSCULES) : le
   * backend normalise lui-même, mais le label envoyé doit être celui du
   * référentiel — c'est lui qui identifie le document.
   *
   * `rows` doit être la liste DÉJÀ masquée. Le filtre de masquage est REJOUÉ
   * ici — double garde : l'avocatier ne peut pas entrer dans une cible
   * d'écriture même si l'appelant se trompe de liste. Sur `rowsAffichables`,
   * c'est un no-op. La portée Parcelle, elle, ne consulte pas `rows` du tout :
   * elle écrit sur le label sélectionné, dont le sélecteur est déjà filtré.
   *
   * Dédup sur la clé MAJUSCULES ; ordre alphabétique sur cette même clé, donc
   * déterministe quel que soit l'ordre d'arrivée des lignes.
   *
   * @param {Object} args
   * @param {'parcelle'|'variete'|'culture'} args.portee
   * @param {Array<{label?: string, culture?: string, variete?: string}>} [args.rows]
   * @param {string} [args.label] parcelle sélectionnée (portée Parcelle).
   * @param {string} [args.cible] clé de bucket (`'Myrtille||CORINA'` ou
   *   `'Myrtille'`), comparée en MAJUSCULES.
   * @param {Object<string, *>} [args.sbMap] référentiel SB (injecté).
   * @returns {Array<string>} [] si la portée est inconnue ou la cible absente.
   */
  function CBT_targetLabels(args) {
    var a = args || {};
    var portee = String(a.portee || '').trim();
    if (portee === 'parcelle') {
      var one = String(a.label == null ? '' : a.label).trim();
      return one ? [one] : [];
    }
    if (portee !== 'variete' && portee !== 'culture') return [];
    var cible = String(a.cible == null ? '' : a.cible).trim().toUpperCase();
    if (!cible) return [];
    var sbMap = a.sbMap;
    var vus = {};
    (a.rows || []).forEach(function (r) {
      var label = String((r && r.label) || '').trim();
      if (!label) return;
      var culture = String(CBT_cultureRow(r, sbMap) || '').trim();
      if (CBT_CULTURES_MASQUEES.indexOf(culture) !== -1) return;
      var clef = portee === 'variete' ? CBT_varieteKey(r, sbMap) : culture;
      if (!clef || clef.toUpperCase() !== cible) return;
      var up = label.toUpperCase();
      if (vus[up]) return;
      vus[up] = label;
    });
    return Object.keys(vus).sort().map(function (up) { return vus[up]; });
  }

  /**
   * Valeur COMMUNE d'une liste de nombres. PURE.
   *
   * @param {Array<number>} list
   * @returns {{accord: boolean, valeur: number, nb: number, min: number,
   *   max: number}} `nb` = nombre de valeurs DISTINCTES. Liste vide → accord sur
   *   0 (aucune cible : rien à pré-remplir, rien à signaler).
   */
  function CBT_accordValeurs(list) {
    var vals = Array.isArray(list) ? list : [];
    if (vals.length === 0) return { accord: true, valeur: 0, nb: 0, min: 0, max: 0 };
    var distinctes = [];
    var min = vals[0];
    var max = vals[0];
    vals.forEach(function (v) {
      if (distinctes.indexOf(v) === -1) distinctes.push(v);
      if (v < min) min = v;
      if (v > max) max = v;
    });
    return {
      accord: distinctes.length === 1,
      valeur: distinctes.length === 1 ? distinctes[0] : 0,
      nb: distinctes.length,
      min: min,
      max: max,
    };
  }

  /**
   * Valeurs à pré-remplir pour un ensemble de parcelles cibles, et lignes
   * DIVERGENTES entre elles. PURE.
   *
   * RÈGLE CRITIQUE — une cible SANS document compte **0**. « 4 sur deux
   * parcelles, absent sur la troisième » est une DIVERGENCE, pas un accord.
   * Sans cette règle, le fan-out réécrirait 4 partout sans jamais le dire :
   * l'absence de budget est une information, pas un trou à combler en silence.
   *
   * ⚠️ PIÈGE — `values[f] === ''` a DEUX causes : soit toutes les cibles sont à
   * 0 (convention existante du composant : un 0 s'affiche vide), soit elles
   * divergent. L'entrée dans `divergentes` / `divergentesOps` est le SEUL
   * porteur de la distinction — l'UI de portée, le payload partiel et le refus
   * d'enregistrer une famille divergente non résolue en dépendent tous.
   *
   * @param {Object} args
   * @param {Array<string>} args.labels labels des parcelles cibles (bruts).
   * @param {Array<string>} args.familles familles affichées.
   * @param {Object<string, Array<string>>} [args.opsByFamille] clés d'opération
   *   affichées par famille.
   * @param {Object<string, Object<string, *>>} [args.budgetsByLabel] indexé en
   *   MAJUSCULES (cf. CBT_budgetsByLabel).
   * @param {Object<string, Object<string, Object<string, *>>>}
   *   [args.opBudgetsByLabel] indexé en MAJUSCULES (cf. CBT_operationsByLabel).
   * @returns {{values: Object<string, string>,
   *   opValues: Object<string, Object<string, string>>,
   *   divergentes: Object<string, {nb: number, min: number, max: number}>,
   *   divergentesOps: Object<string, Object<string, {nb: number, min: number,
   *   max: number}>>}}
   */
  function CBT_valeursCommunes(args) {
    var a = args || {};
    var keys = (a.labels || []).map(function (l) {
      return String(l == null ? '' : l).trim().toUpperCase();
    }).filter(Boolean);
    var familles = a.familles || [];
    var opsByFamille = a.opsByFamille || {};
    var byLabel = a.budgetsByLabel || {};
    var opsByLabel = a.opBudgetsByLabel || {};
    var values = {};
    var opValues = {};
    var divergentes = {};
    var divergentesOps = {};
    familles.forEach(function (f) {
      // Une cible sans document → CBT_num(undefined) = 0, donc comptée 0.
      var acc = CBT_accordValeurs(keys.map(function (k) {
        return CBT_num((byLabel[k] || {})[f]);
      }));
      values[f] = acc.accord && acc.valeur !== 0 ? String(acc.valeur) : '';
      if (!acc.accord) divergentes[f] = { nb: acc.nb, min: acc.min, max: acc.max };
      var famOut = {};
      (opsByFamille[f] || []).forEach(function (op) {
        var accOp = CBT_accordValeurs(keys.map(function (k) {
          return CBT_num(((opsByLabel[k] || {})[f] || {})[op]);
        }));
        famOut[op] = accOp.accord && accOp.valeur !== 0 ? String(accOp.valeur) : '';
        if (!accOp.accord) {
          if (!divergentesOps[f]) divergentesOps[f] = {};
          divergentesOps[f][op] = { nb: accOp.nb, min: accOp.min, max: accOp.max };
        }
      });
      opValues[f] = famOut;
    });
    return {
      values: values, opValues: opValues,
      divergentes: divergentes, divergentesOps: divergentesOps,
    };
  }

  /**
   * Surface totale des parcelles cibles. PURE — `haOf` est INJECTÉ (`cbtHa` au
   * call site), jamais lu depuis `window` ici.
   *
   * `Total JH = JH/Ha × Σ ha` est EXACT en portée multiple, et non une
   * approximation, précisément parce que le fan-out écrit la même valeur de
   * JH/Ha sur chaque parcelle.
   *
   * @param {Array<string>} labels labels des parcelles cibles.
   * @param {function(string): *} haOf surface d'une parcelle.
   * @returns {{ha: number, sansHa: Array<string>, nb: number}} `sansHa` = labels
   *   dont la surface est absente, nulle ou non finie : leur budget est bien
   *   enregistré, mais leur Total JH n'est pas calculable.
   */
  function CBT_surfaceCible(labels, haOf) {
    var list = Array.isArray(labels) ? labels : [];
    var fn = typeof haOf === 'function' ? haOf : function () { return 0; };
    var ha = 0;
    var sansHa = [];
    list.forEach(function (l) {
      var v = parseFloat(String(fn(l)));
      if (isNaN(v) || !isFinite(v) || !(v > 0)) { sansHa.push(l); return; }
      ha += v;
    });
    return { ha: Math.round(ha * 100) / 100, sansHa: sansHa, nb: list.length };
  }

  /**
   * Valeurs de quinzaine qui vont être SUPPRIMÉES par l'enregistrement. PURE.
   *
   * Une famille qui portait un engagement et dont le champ est maintenant vide
   * (ou 0) sera effacée en base. C'est légitime — c'est le moyen d'annuler un
   * engagement — mais jamais anodin : comme pour `familles_neutralisees`, ça
   * s'annonce AVANT l'écriture et se rapporte APRÈS.
   *
   * @param {Object} args
   * @param {Array<string>} args.familles familles affichées.
   * @param {Object<string, *>} args.enregistrees valeurs actuellement en base
   *   pour la quinzaine éditée.
   * @param {Object<string, *>} args.values saisie courante.
   * @returns {Array<{famille: string, valeur: number}>}
   */
  function CBT_quinzainesSupprimees(args) {
    var a = args || {};
    var out = [];
    (a.familles || []).forEach(function (f) {
      var avant = CBT_num((a.enregistrees || {})[f]);
      if (!(avant > 0)) return;
      if (CBT_num((a.values || {})[f]) > 0) return;
      out.push({ famille: f, valeur: avant });
    });
    return out;
  }

  /**
   * Construit le body de `campagne-budget-save` pour la portée PARCELLE. PURE.
   *
   * Toutes les familles AFFICHÉES et toutes leurs opérations sont envoyées, y
   * compris celles laissées vides (→ 0) : c'est ce qui permet d'effacer un
   * budget sans action de suppression dédiée (le backend supprime les entrées
   * à 0).
   *
   * ⚠️ NE PAS CONFONDRE avec `CBT_buildFanoutPayload` (portée multiple), qui
   * n'envoie QUE les familles touchées. Les deux ne sont PAS interchangeables :
   * celui-ci EFFACE ce qui est vide, l'autre ne parle pas de ce qu'on n'a pas
   * saisi. Utiliser l'un à la place de l'autre en portée multiple viderait le
   * budget de N parcelles d'un seul geste.
   *
   * Cohérence des deux niveaux : dès qu'une famille porte au moins une
   * opération budgétée, sa valeur de famille est envoyée à 0. Sans ça,
   * l'ancienne valeur de famille (saisie avant la descente au niveau opération)
   * resterait en base et ressortirait le jour où l'utilisateur efface toutes
   * les opérations — un budget qu'il croyait supprimé.
   *
   * @param {Object} args
   * @param {string} args.campagne
   * @param {string} args.label
   * @param {Array<string>} args.familles familles affichées, dans l'ordre.
   * @param {Object<string, Array<string>>} [args.opsByFamille] clés d'opération
   *   affichées par famille (référentiel), forme `CODE::Libellé`.
   * @param {Object<string, string>} args.values saisie brute niveau famille.
   * @param {Object<string, Object<string, string>>} [args.opValues] saisie brute
   *   niveau opération.
   * @param {string} [args.quinzaine] clé de la quinzaine éditée ('Q07'). Absente
   *   = aucun engagement court terme dans ce save (le champ n'est alors PAS
   *   envoyé : une map vide effacerait la quinzaine en base).
   * @param {Object<string, string>} [args.quinzValues] saisie brute du budget de
   *   quinzaine, par famille.
   * @returns {{ok: boolean, error?: string, payload?: Object}}
   */
  function CBT_buildSavePayload(args) {
    var a = args || {};
    if (!a.campagne) return { ok: false, error: 'Campagne inconnue' };
    if (!a.label) return { ok: false, error: 'Sélectionner une parcelle' };
    var familles = a.familles || [];
    if (familles.length === 0) return { ok: false, error: 'Aucune famille d\'opération' };
    var values = a.values || {};
    var opValues = a.opValues || {};
    var opsByFamille = a.opsByFamille || {};
    var budgets = {};
    var budgetsOperations = {};

    /** @returns {number|null} null = saisie invalide. */
    function parseOne(raw) {
      if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
      var n = parseFloat(String(raw).trim().replace(',', '.'));
      if (isNaN(n) || !isFinite(n) || n < 0) return null;
      return Math.round(n * 100) / 100;
    }

    for (var i = 0; i < familles.length; i++) {
      var f = familles[i];
      var ops = opsByFamille[f] || [];
      var famOps = {};
      var somme = 0;
      for (var j = 0; j < ops.length; j++) {
        var op = ops[j];
        var vOp = parseOne((opValues[f] || {})[op]);
        if (vOp === null) {
          return {
            ok: false,
            error: 'Valeur invalide pour « ' + f + ' — ' + CBT_operationLabel(op) + ' »',
          };
        }
        famOps[op] = vOp;
        somme += vOp;
      }
      if (ops.length > 0) budgetsOperations[f] = famOps;

      var vFam = parseOne(values[f]);
      if (vFam === null) return { ok: false, error: 'Valeur invalide pour « ' + f + ' »' };
      // Famille détaillée par opération → la valeur de famille est neutralisée.
      budgets[f] = somme > 0 ? 0 : vFam;
    }

    var payload = {
      campagne: a.campagne,
      label_bee_one: a.label,
      budgets: budgets,
      budgets_operations: budgetsOperations,
    };

    // Budget de QUINZAINE — envoyé seulement quand une quinzaine est éditée, et
    // seulement pour CELLE-LÀ : le backend est autoritaire sur les quinzaines
    // qu'il reçoit et conserve les autres. Toutes les familles affichées sont
    // envoyées, vides comprises (→ 0) : c'est ce qui permet d'annuler un
    // engagement sans action de suppression dédiée.
    if (a.quinzaine) {
      var quinzValues = a.quinzValues || {};
      var qBudgets = {};
      for (var k = 0; k < familles.length; k++) {
        var fq = familles[k];
        var vq = parseOne(quinzValues[fq]);
        if (vq === null) {
          return { ok: false, error: 'Valeur de quinzaine invalide pour « ' + fq + ' »' };
        }
        qBudgets[fq] = vq;
      }
      payload.budgets_quinzaine = {};
      payload.budgets_quinzaine[a.quinzaine] = qBudgets;
    }

    return { ok: true, payload: payload };
  }

  /**
   * Construit le body d'un enregistrement en portée MULTIPLE (variété, culture).
   * PURE.
   *
   * ⚠️ SÉMANTIQUE OPPOSÉE À `CBT_buildSavePayload` (portée Parcelle), et les deux
   * ne sont PAS interchangeables :
   *   - `CBT_buildSavePayload` envoie TOUTES les familles affichées, vide → 0,
   *     donc il EFFACE ce qui n'est pas saisi ;
   *   - celui-ci n'envoie QUE les familles TOUCHÉES. Les autres ne sont pas dans
   *     le payload, et `mergeBudgets` (functions/lib/campagneBudget/validate.js)
   *     les conserve telles quelles en base — c'est la garantie qui permet de
   *     promettre « une ligne divergente non retouchée n'est pas modifiée ».
   *
   * UNITÉ D'ENVOI = LA FAMILLE, pas le champ. Dès qu'un champ d'une famille est
   * touché, la famille entière part : sa valeur ET toutes ses opérations
   * affichées. C'est ce qui préserve l'invariant de cohérence des deux niveaux
   * (une famille détaillée par opération voit sa valeur de famille neutralisée à
   * 0). Envoyer un champ isolé rouvrirait le bug de l'ancienne valeur de famille
   * qui survit en base et ressurgit après effacement des opérations.
   *
   * COROLLAIRE — une famille touchée qui contient encore un champ DIVERGENT non
   * résolu fait ÉCHOUER l'enregistrement. Puisque la famille part en entier, ce
   * champ laissé vide serait envoyé à 0, donc supprimé : exactement la valeur
   * qu'on venait de promettre de ne pas toucher. Le refus est la seule issue
   * honnête ; le message dit quoi faire.
   *
   * Le budget de QUINZAINE n'est JAMAIS envoyé ici : l'engagement se saisit
   * parcelle par parcelle (la colonne est masquée en portée multiple).
   *
   * @param {Object} args
   * @param {string} args.campagne
   * @param {Array<string>} args.labels parcelles cibles (labels BEE ONE bruts).
   * @param {Array<string>} args.familles familles affichées, dans l'ordre.
   * @param {Object<string, Array<string>>} [args.opsByFamille] clés d'opération
   *   affichées par famille, forme `CODE::Libellé`.
   * @param {Object<string, string>} args.values saisie brute niveau famille.
   * @param {Object<string, Object<string, string>>} [args.opValues] saisie brute
   *   niveau opération.
   * @param {Object<string, *>} [args.touched] familles touchées : `{famille: true}`.
   *   Clé = FAMILLE, jamais un champ — cf. « unité d'envoi » ci-dessus.
   * @param {Object<string, *>} [args.divergentes] divergences niveau famille
   *   (cf. CBT_valeursCommunes).
   * @param {Object<string, Object<string, *>>} [args.divergentesOps] divergences
   *   niveau opération.
   * @returns {{ok: boolean, error?: string, payload?: Object,
   *   famillesEnvoyees?: Array<string>}}
   */
  function CBT_buildFanoutPayload(args) {
    var a = args || {};
    if (!a.campagne) return { ok: false, error: 'Campagne inconnue' };
    var labels = (a.labels || []).filter(function (l) {
      return String(l == null ? '' : l).trim() !== '';
    });
    if (labels.length === 0) return { ok: false, error: 'Aucune parcelle cible' };
    var familles = a.familles || [];
    if (familles.length === 0) return { ok: false, error: 'Aucune famille d\'opération' };
    var values = a.values || {};
    var opValues = a.opValues || {};
    var opsByFamille = a.opsByFamille || {};
    var touched = a.touched || {};
    var divergentes = a.divergentes || {};
    var divergentesOps = a.divergentesOps || {};

    /** @returns {number|null} null = saisie invalide. */
    function parseOne(raw) {
      if (raw === undefined || raw === null || String(raw).trim() === '') return 0;
      var n = parseFloat(String(raw).trim().replace(',', '.'));
      if (isNaN(n) || !isFinite(n) || n < 0) return null;
      return Math.round(n * 100) / 100;
    }

    /** Un champ divergent est RÉSOLU dès que l'utilisateur y a mis une valeur. */
    function vide(raw) {
      return raw === undefined || raw === null || String(raw).trim() === '';
    }

    var touchees = familles.filter(function (f) { return !!touched[f]; });
    if (touchees.length === 0) {
      return {
        ok: false,
        error: 'Aucune valeur saisie — modifier au moins une ligne à propager.',
      };
    }

    var budgets = {};
    var budgetsOperations = {};
    for (var i = 0; i < touchees.length; i++) {
      var f = touchees[i];
      var ops = opsByFamille[f] || [];
      var famOps = {};
      var somme = 0;
      for (var j = 0; j < ops.length; j++) {
        var op = ops[j];
        var rawOp = (opValues[f] || {})[op];
        if ((divergentesOps[f] || {})[op] && vide(rawOp)) {
          return {
            ok: false,
            error: '« ' + f + ' — ' + CBT_operationLabel(op) + ' » a '
              + divergentesOps[f][op].nb + ' valeurs différentes selon les parcelles :'
              + ' saisis cette valeur, ou repasse en portée Parcelle.',
          };
        }
        var vOp = parseOne(rawOp);
        if (vOp === null) {
          return {
            ok: false,
            error: 'Valeur invalide pour « ' + f + ' — ' + CBT_operationLabel(op) + ' »',
          };
        }
        famOps[op] = vOp;
        somme += vOp;
      }
      if (ops.length > 0) budgetsOperations[f] = famOps;

      // La valeur de famille n'est menacée que si elle est encore la source du
      // total : une famille détaillée par opération part de toute façon à 0.
      if (divergentes[f] && vide(values[f]) && !(somme > 0)) {
        return {
          ok: false,
          error: '« ' + f + ' » a ' + divergentes[f].nb
            + ' valeurs différentes selon les parcelles :'
            + ' saisis cette valeur, ou repasse en portée Parcelle.',
        };
      }
      var vFam = parseOne(values[f]);
      if (vFam === null) return { ok: false, error: 'Valeur invalide pour « ' + f + ' »' };
      // Même invariant que CBT_buildSavePayload : famille détaillée → 0.
      budgets[f] = somme > 0 ? 0 : vFam;
    }

    return {
      ok: true,
      famillesEnvoyees: touchees,
      payload: {
        campagne: a.campagne,
        // `labels` = le fan-out ; `label_bee_one` = garde-fou de la fenêtre de
        // skew de déploiement (functions d'abord, hosting ensuite) : un backend
        // pas encore à jour ignore `labels` et écrit UNE parcelle au lieu de
        // crasher. L'absence de `results` dans sa réponse est ce qui trahit le
        // cas côté client — jamais un message vert.
        labels: labels,
        label_bee_one: labels[0],
        budgets: budgets,
        budgets_operations: budgetsOperations,
      },
    };
  }

  /**
   * Message de retour d'une sauvegarde réussie. PURE.
   *
   * Le backend renvoie TROIS effets de bord possibles d'un save :
   * `familles_purgees` / `operations_purgees` (entrées hors référentiel),
   * `familles_neutralisees` (valeur de famille remplacée par le détail des
   * opérations) et `purge_differee` (nettoyage bloqué par le garde-fou).
   * Une suppression de données ne doit jamais passer inaperçue,
   * même si elle est légitime. Le message reste du niveau « succès » (ce n'est
   * pas une erreur) mais porte `purge: true`, que le rendu traduit par une
   * couleur ambre et une icône d'avertissement.
   *
   * S'y ajoutent les deux effets du budget de QUINZAINE :
   * `quinzaines_supprimees` (engagements effacés, comparaison avant/après faite
   * dans la transaction) et `quinzaines_purgees` (familles hors référentiel).
   *
   * @param {{familles_purgees?: Array<string>, operations_purgees?: Array<string>,
   *   quinzaines_purgees?: Array<string>, quinzaines_supprimees?: Array<Object>}
   *   |null|undefined} res réponse API.
   * @returns {{type: string, text: string, purge?: boolean}}
   */
  function CBT_saveMessage(res) {
    function clean(brutes) {
      return (Array.isArray(brutes) ? brutes : [])
        .map(function (f) { return String(f == null ? '' : f).trim(); })
        .filter(Boolean);
    }
    var purgees = clean(res && res.familles_purgees);
    var opsPurgees = clean(res && res.operations_purgees);
    // Valeurs de famille remplacées par le détail des opérations : le backend
    // les renvoie parce que l'écran seul ne peut pas les connaître (familles
    // hors écran neutralisées par un save global).
    var neutralisees = (Array.isArray(res && res.familles_neutralisees)
      ? res.familles_neutralisees : [])
      .map(function (n) {
        if (!n || typeof n !== 'object') return '';
        var famille = String(n.famille == null ? '' : n.famille).trim();
        if (!famille) return '';
        var v = CBT_num(n.valeur_precedente);
        return v > 0 ? famille + ' (' + v + ')' : famille;
      })
      .filter(Boolean);
    var quinzPurgees = clean(res && res.quinzaines_purgees);
    // Engagements de quinzaine réellement effacés — la comparaison avant/après
    // est faite DANS la transaction serveur : seule preuve fiable de ce qui a
    // disparu (le client ne connaît que ce qu'il croyait envoyer).
    var quinzSupprimees = (Array.isArray(res && res.quinzaines_supprimees)
      ? res.quinzaines_supprimees : [])
      .map(function (n) {
        if (!n || typeof n !== 'object') return '';
        var famille = String(n.famille == null ? '' : n.famille).trim();
        var q = String(n.quinzaine == null ? '' : n.quinzaine).trim();
        if (!famille) return '';
        var v = CBT_num(n.valeur_precedente);
        return (q ? q + ' ' : '') + famille + (v > 0 ? ' (' + v + ')' : '');
      })
      .filter(Boolean);
    var differee = CBT_num(res && res.purge_differee);
    if (purgees.length === 0 && opsPurgees.length === 0
      && neutralisees.length === 0 && differee <= 0
      && quinzPurgees.length === 0 && quinzSupprimees.length === 0) {
      return { type: 'ok', text: 'Budget enregistré' };
    }
    var parts = [];
    if (quinzSupprimees.length > 0) {
      parts.push(quinzSupprimees.length
        + (quinzSupprimees.length > 1
          ? ' engagements de quinzaine supprimés : '
          : ' engagement de quinzaine supprimé : ')
        + quinzSupprimees.join(', '));
    }
    if (quinzPurgees.length > 0) {
      parts.push(quinzPurgees.length
        + (quinzPurgees.length > 1
          ? ' engagements de quinzaine obsolètes retirés : '
          : ' engagement de quinzaine obsolète retiré : ')
        + quinzPurgees.join(', '));
    }
    if (neutralisees.length > 0) {
      parts.push(neutralisees.length
        + (neutralisees.length > 1
          ? ' valeurs de famille remplacées par le détail des opérations : '
          : ' valeur de famille remplacée par le détail des opérations : ')
        + neutralisees.join(', '));
    }
    if (differee > 0) {
      parts.push('nettoyage de ' + differee
        + (differee > 1 ? ' entrées obsolètes reporté' : ' entrée obsolète reporté')
        + ' (référentiel incomplet) — rien n\'a été supprimé');
    }
    if (purgees.length > 0) {
      parts.push(purgees.length
        + (purgees.length > 1 ? ' familles obsolètes retirées : ' : ' famille obsolète retirée : ')
        + purgees.join(', '));
    }
    if (opsPurgees.length > 0) {
      parts.push(opsPurgees.length
        + (opsPurgees.length > 1 ? ' opérations obsolètes retirées : ' : ' opération obsolète retirée : ')
        + opsPurgees.join(', '));
    }
    return {
      type: 'ok',
      purge: true,
      text: 'Budget enregistré — ' + parts.join(' ; '),
    };
  }

  /**
   * Total JH d'une famille = budget JH/Ha × surface de la parcelle. PURE.
   *
   * @param {*} jhParHa
   * @param {*} ha
   * @returns {number} 0 si l'un des deux est absent/invalide.
   */
  function CBT_totalJH(jhParHa, ha) {
    var b = parseFloat(String(jhParHa == null ? '' : jhParHa).replace(',', '.'));
    var h = parseFloat(String(ha == null ? '' : ha));
    if (isNaN(b) || isNaN(h)) return 0;
    return Math.round(b * h * 100) / 100;
  }

  function CBT_CultureBadge(props) {
    var culture = props.culture;
    if (!culture) return null;
    var col = CULTURE_COLORS[culture] || { bg: '#f3f4f6', text: '#374151' };
    return React.createElement('span', {
      style: {
        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
        fontSize: 11, fontWeight: 600, background: col.bg, color: col.text,
      },
    }, culture);
  }

  function CampagneBudgetTab(props) {
    var userRole = String((props && props.userRole) || '').toLowerCase();
    var canEdit = userRole === 'dg' || userRole === 'rh' || userRole === 'admin';

    var _rows = useState([]);
    var rows = _rows[0]; var setRows = _rows[1];
    var _familles = useState([]);
    var familles = _familles[0]; var setFamilles = _familles[1];
    var _budgets = useState({});
    var budgetsByLabel = _budgets[0]; var setBudgetsByLabel = _budgets[1];
    var _campagne = useState('');
    var campagne = _campagne[0]; var setCampagne = _campagne[1];
    var _sel = useState('');
    var selected = _sel[0]; var setSelected = _sel[1];
    var _values = useState({});
    var values = _values[0]; var setValues = _values[1];
    var _loading = useState(true);
    var loading = _loading[0]; var setLoading = _loading[1];
    var _err = useState(null);
    var err = _err[0]; var setErr = _err[1];
    var _saving = useState(false);
    var saving = _saving[0]; var setSaving = _saving[1];
    var _msg = useState(null);
    var msg = _msg[0]; var setMsg = _msg[1]; // { type: 'ok'|'ko', text }
    var _tick = useState(0);
    var tick = _tick[0]; var setTick = _tick[1];
    // États du niveau OPÉRATION — ajoutés APRÈS les précédents à dessein :
    // l'ordre des useState est l'index de state de React, le décaler
    // renumérote tout (et casse le harnais de test qui indexe par position).
    var _opsByFamille = useState({});
    var opsByFamille = _opsByFamille[0]; var setOpsByFamille = _opsByFamille[1];
    var _opBudgets = useState({});
    var opBudgetsByLabel = _opBudgets[0]; var setOpBudgetsByLabel = _opBudgets[1];
    var _opValues = useState({});
    var opValues = _opValues[0]; var setOpValues = _opValues[1];
    // Repliage par famille : ~108 opérations, tout déplier d'emblée noierait
    // l'écran. Persiste d'une parcelle à l'autre (on compare souvent la même
    // famille sur plusieurs parcelles).
    var _open = useState({});
    var openFamilles = _open[0]; var setOpenFamilles = _open[1];
    // Familles dont la valeur de famille va être remplacée : null = pas de
    // confirmation en attente.
    var _confirm = useState(null);
    var confirmList = _confirm[0]; var setConfirmList = _confirm[1];
    // États du BUDGET DE QUINZAINE — ajoutés APRÈS les précédents à dessein
    // (l'ordre des useState est l'index de state de React).
    // Quinzaines de la campagne, DÉRIVÉES des `periodes` de
    // `campagne-analytique-detail` : jamais un calendrier local, jamais « 24 ».
    var _quinzOpts = useState([]);
    var quinzOptions = _quinzOpts[0]; var setQuinzOptions = _quinzOpts[1];
    var _quinzCour = useState('');
    var quinzCourante = _quinzCour[0]; var setQuinzCourante = _quinzCour[1];
    // '' = suivre la quinzaine en cours ; une valeur = consultation/correction
    // d'une quinzaine passée.
    var _quinzSel = useState('');
    var quinzSel = _quinzSel[0]; var setQuinzSel = _quinzSel[1];
    var _quinzBudgets = useState({});
    var quinzByLabel = _quinzBudgets[0]; var setQuinzByLabel = _quinzBudgets[1];
    var _quinzValues = useState({});
    var quinzValues = _quinzValues[0]; var setQuinzValues = _quinzValues[1];
    // Engagements qui vont être effacés — confirmés séparément des
    // neutralisations de famille, mais dans le même panneau.
    var _confirmQuinz = useState(null);
    var confirmQuinz = _confirmQuinz[0]; var setConfirmQuinz = _confirmQuinz[1];
    // États de la PORTÉE DE SAISIE — APPENDUS après les précédents à dessein :
    // l'ordre des useState EST l'index de state de React, et le harnais de test
    // (tests/unit/campagneBudgetTab.test.js) indexe par position. Insérer un
    // state au milieu renumérote tout et fait basculer silencieusement les tests
    // de rendu existants sur les mauvais états.
    //
    // `selected` (index 4) n'est PAS réutilisé pour porter la cible multiple :
    // trois effets en dépendent et la portée Parcelle doit rester bit pour bit
    // identique à ce qu'elle est aujourd'hui.
    var _portee = useState('parcelle');
    var portee = _portee[0]; var setPortee = _portee[1];
    var _varieteSel = useState('');
    var varieteSel = _varieteSel[0]; var setVarieteSel = _varieteSel[1];
    var _cultureSel = useState('');
    var cultureSel = _cultureSel[0]; var setCultureSel = _cultureSel[1];
    // Déclarés MAINTENANT pour figer l'ordre des states une fois pour toutes ;
    // ils ne seront consommés qu'au lot « confirmation et remontée » (fan-out) :
    // périmètre confirmé avant écriture, et résultat par parcelle après.
    var _confirmFanout = useState(null);
    var confirmFanout = _confirmFanout[0]; var setConfirmFanout = _confirmFanout[1];
    var _fanoutResults = useState(null);
    var fanoutResults = _fanoutResults[0]; var setFanoutResults = _fanoutResults[1];
    // Familles TOUCHÉES depuis le dernier changement de portée / de cible /
    // rafraîchissement. Clé = FAMILLE et non le champ : c'est l'unité d'envoi du
    // fan-out (cf. CBT_buildFanoutPayload). Alimenté aussi en portée Parcelle —
    // c'est sans effet là-bas (CBT_buildSavePayload envoie tout), et une garde
    // conditionnelle sur un `onChange` serait une source de bug muet.
    var _touched = useState({});
    var touched = _touched[0]; var setTouched = _touched[1];

    useEffect(function () {
      var cancelled = false;
      setLoading(true);
      setErr(null);
      Promise.all([
        fetch('/api/pointage-rh?action=parcelles-campagne-list').then(function (r) { return r.json(); }),
        fetch('/api/pointage-rh?action=sb-referentiel-list').then(function (r) { return r.json(); }),
        fetch('/api/pointage-rh?action=referentiel-taches-list').then(function (r) { return r.json(); }),
        fetch('/api/pointage-rh?action=campagne-budget-list').then(function (r) { return r.json(); }),
        // MÊME source que le réalisé affiché sur l'écran Campagne : la liste des
        // quinzaines et la quinzaine en cours en sont dérivées, elles ne peuvent
        // donc pas diverger de lui. Réponse mise en cache 30 min côté serveur.
        // Échec ISOLÉ (`catch` local) : le budget annuel doit rester saisissable
        // même si cet appel tombe — on perd alors le seul suivi court terme.
        fetch('/api/pointage-rh?action=campagne-analytique-detail')
          .then(function (r) { return r.json(); })
          .catch(function () { return null; }),
      ])
        .then(function (res) {
          if (cancelled) return;
          var parc = res[0]; var sb = res[1]; var taches = res[2]; var buds = res[3];
          var detail = res[4];
          if (!parc || !parc.success) throw new Error((parc && parc.error) || 'Erreur parcelles');
          if (!taches || !taches.success) throw new Error((taches && taches.error) || 'Erreur référentiel tâches');
          if (!buds || !buds.success) throw new Error((buds && buds.error) || 'Erreur budgets');
          // Référentiel SB : alimente window.SB_PARCELLE_REF, consommé par les
          // helpers globaux sbParcelleHa / sbParcelleNom (pas de duplication).
          if (sb && sb.success) {
            var map = {};
            (sb.parcelles || []).forEach(function (p) {
              map[String(p.label_bee_one || p.id || '').toUpperCase().trim()] = p;
            });
            window.SB_PARCELLE_REF = map;
          }
          setRows(parc.campagne_courante || []);
          // `familles_par_code` = la table de résolution du tableau Campagne.
          // Absente (backend antérieur) → repli sur la famille de la fiche, comme
          // avant : l'écran reste utilisable, il perd seulement l'alignement.
          var famillesParCode = taches.familles_par_code || {};
          setFamilles(CBT_famillesFromOps(taches.operations || [], famillesParCode));
          setOpsByFamille(CBT_opsByFamille(taches.operations || [], famillesParCode));
          // Les budgets sont indexés TELS QUELS, sans retirer les documents des
          // cultures masquées : `budgetsByLabel` n'est jamais parcouru, il n'est
          // lu que PAR LABEL, et tous les labels lus dérivent de
          // `rowsAffichables` → les documents avocatier sont inertes.
          // RÉSERVE : le jour où cet écran affichera un total « toutes
          // parcelles », c'est ICI qu'il faudra filtrer.
          setBudgetsByLabel(CBT_budgetsByLabel(buds.budgets || []));
          setOpBudgetsByLabel(CBT_operationsByLabel(buds.budgets || []));
          setCampagne(buds.campagne || '');
          // Budget de quinzaine : mêmes documents, même appel. Les modules purs
          // sont chargés en <script> séparés — absents (404, déploiement
          // partiel), l'écran perd la section quinzaine et rien d'autre.
          var CBQ = window.CampagneBudgetQuinzaine;
          var CR = window.CampagneRythme;
          setQuinzByLabel(CBQ ? CBQ.quinzainesByLabel(buds.budgets || []) : {});
          if (CBQ && CR && detail && detail.success) {
            setQuinzOptions(CBQ.optionsFromPeriodes(detail.periodes));
            setQuinzCourante(CBQ.quinzaineCourante(
              CR.quinzainesInfo({ periodes: detail.periodes, campagne: detail.campagne })
            ));
          } else {
            setQuinzOptions([]);
            setQuinzCourante('');
          }
        })
        .catch(function (e) { if (!cancelled) setErr(e.message); })
        .finally(function () { if (!cancelled) setLoading(false); });
      return function () { cancelled = true; };
    }, [tick]);

    // Parcelles PROPOSABLES à la saisie — dérivé, jamais un filtre sur le state
    // `rows` : `selectedRow` (plus bas) doit continuer de retrouver une parcelle
    // masquée, sinon une sélection héritée cesse d'être identifiable (Ha, badge,
    // culture) au lieu d'être simplement désélectionnée.
    // Ce dérivé n'est utilisé que là où l'écran peut ÉCRIRE : le sélecteur, les
    // buckets de portée et les cibles d'enregistrement.
    // Deps `[rows]` VOLONTAIRES : `window.SB_PARCELLE_REF` est posé dans le MÊME
    // `.then()` que `setRows` (cf. le chargement ci-dessus), la map est donc
    // présente dès que ce memo recalcule. Ne pas ajouter de dépendance
    // supplémentaire ni d'effet séparé qui lirait la map avant qu'elle existe.
    // Déclaré AVANT les effets de synchronisation des champs : ceux-ci en
    // dérivent leurs dépendances, et un `var` encore `undefined` au moment où le
    // tableau de deps est évalué (au rendu) figerait l'effet à jamais.
    var rowsAffichables = useMemo(function () {
      var sbMap = window.SB_PARCELLE_REF || {};
      return (rows || []).filter(function (r) { return CBT_parcelleAffichable(r, sbMap); });
    }, [rows]);

    var options = useMemo(function () {
      return (rowsAffichables || []).slice().sort(function (a, b) {
        return cbtNom(a.label).localeCompare(cbtNom(b.label));
      });
    }, [rowsAffichables]);

    // PORTÉE : buckets proposables (variétés et cultures réellement présentes),
    // jamais une liste figée. Un bucket vide n'existe pas — il n'y a donc rien à
    // choisir qui ne désigne aucune parcelle.
    var porteeOpts = useMemo(function () {
      return CBT_porteeOptions({ rows: rowsAffichables, sbMap: window.SB_PARCELLE_REF || {} });
    }, [rowsAffichables]);

    var porteeMulti = portee === 'variete' || portee === 'culture';
    var cible = portee === 'variete' ? varieteSel : (portee === 'culture' ? cultureSel : '');

    // Parcelles réellement visées par un enregistrement. Portée Parcelle : la
    // seule parcelle sélectionnée — le chemin d'aujourd'hui, inchangé.
    var targetLabels = useMemo(function () {
      return CBT_targetLabels({
        portee: portee, rows: rowsAffichables, label: selected, cible: cible,
        sbMap: window.SB_PARCELLE_REF || {},
      });
    }, [portee, rowsAffichables, selected, cible]);

    // Une parcelle sélectionnée peut cesser d'être proposable (référentiel SB
    // rechargé, `culture_sb` corrigée en cours de session) : on désélectionne
    // plutôt que de laisser une saisie ouverte sur une parcelle que le sélecteur
    // n'affiche plus. Les effets ci-dessous vident alors `values` / `opValues` /
    // `msg`.
    useEffect(function () {
      if (!selected) return;
      var key = String(selected).toUpperCase().trim();
      var present = (rowsAffichables || []).some(function (r) {
        return String((r && r.label) || '').toUpperCase().trim() === key;
      });
      if (!present) setSelected('');
    }, [selected, rowsAffichables]);

    // Une cible de portée multiple peut disparaître elle aussi (rechargement,
    // dernière parcelle de la variété reclassée) : même traitement, on retombe
    // sur « aucune cible » plutôt que d'afficher une grille qui n'écrirait nulle
    // part. Le rendu gère `targetLabels.length === 0` explicitement.
    useEffect(function () {
      if (varieteSel && !porteeOpts.varietes.some(function (v) { return v.key === varieteSel; })) {
        setVarieteSel('');
      }
      if (cultureSel && !porteeOpts.cultures.some(function (c) { return c.key === cultureSel; })) {
        setCultureSel('');
      }
    }, [porteeOpts, varieteSel, cultureSel]);

    // Le suivi des champs touchés est LOCAL à une portée et à une cible : garder
    // « Récolte touchée » après un changement de variété propagerait à la variété
    // B une saisie faite pour la A. Même raison pour `tick` (tout est relu).
    useEffect(function () {
      setTouched({});
    }, [portee, cible, tick]);

    /** Marque une famille comme touchée — unité d'envoi du fan-out. */
    function marquerTouchee(famille) {
      setTouched(function (prev) {
        if (prev && prev[famille]) return prev;
        var next = Object.assign({}, prev);
        next[famille] = true;
        return next;
      });
    }

    // Le message (succès/erreur) n'est effacé QUE par un changement de parcelle.
    // Effet séparé À DESSEIN : la synchro des champs ci-dessous dépend aussi de
    // `budgetsByLabel`, que le save met à jour — regrouper les deux effaçait
    // « Budget enregistré » dans le même rendu (React 18 batche les setState),
    // l'utilisateur ne voyait jamais un succès, seulement les erreurs.
    useEffect(function () {
      setMsg(null);
    }, [selected]);

    // Une confirmation en attente devient CADUQUE dès que l'état qui l'a
    // produite change. Le panneau vit dans le tableau, sous un sélecteur de
    // parcelle resté actif : sans ce reset, on pouvait changer de parcelle puis
    // confirmer — le panneau affichant les chiffres de la parcelle A pendant que
    // l'écriture portait sur B, dont les valeurs de famille n'ont jamais été
    // confirmées. Même mécanisme via « Rafraîchir » (tick), qui recharge tout.
    // Le changement de QUINZAINE invalide la confirmation au même titre que le
    // changement de parcelle : le panneau afficherait les engagements de la
    // quinzaine A pendant que l'écriture porterait sur la B.
    useEffect(function () {
      setConfirmList(null);
      setConfirmQuinz(null);
    }, [selected, tick, quinzSel]);

    // Valeurs COMMUNES aux parcelles cibles, en portée multiple : ce qui est
    // identique partout est pré-rempli, ce qui diverge reste vide et est SIGNALÉ.
    // null en portée Parcelle — c'est la garde qui garantit que le chemin
    // historique ne change pas d'un octet.
    var communCibles = useMemo(function () {
      if (!porteeMulti) return null;
      return CBT_valeursCommunes({
        labels: targetLabels, familles: familles, opsByFamille: opsByFamille,
        budgetsByLabel: budgetsByLabel, opBudgetsByLabel: opBudgetsByLabel,
      });
    }, [porteeMulti, targetLabels, familles, opsByFamille, budgetsByLabel, opBudgetsByLabel]);

    // Lignes divergentes entre les parcelles cibles. ⚠️ Un champ vide a DEUX
    // causes (tout à 0, ou divergence) : ces deux maps sont le SEUL porteur de la
    // distinction, cf. CBT_valeursCommunes.
    var divergentes = (communCibles && communCibles.divergentes) || {};
    var divergentesOps = (communCibles && communCibles.divergentesOps) || {};

    // Changement de parcelle, de portée, de cible (ou de budgets connus) →
    // recharger les champs. UNE SEULE source de `setValues` / `setOpValues`,
    // guardée par la portée : deux effets en course sur les mêmes champs
    // produiraient une grille dont la valeur dépend de l'ordre de résolution.
    useEffect(function () {
      if (porteeMulti) {
        setValues(communCibles ? communCibles.values : {});
        setOpValues(communCibles ? communCibles.opValues : {});
        return;
      }
      if (!selected) { setValues({}); setOpValues({}); return; }
      var key = selected.toUpperCase();
      var saved = budgetsByLabel[key] || {};
      var savedOps = opBudgetsByLabel[key] || {};
      var next = {};
      var nextOps = {};
      familles.forEach(function (f) {
        next[f] = saved[f] != null ? String(saved[f]) : '';
        var famSaved = savedOps[f] || {};
        var famNext = {};
        (opsByFamille[f] || []).forEach(function (op) {
          famNext[op] = famSaved[op] != null ? String(famSaved[op]) : '';
        });
        nextOps[f] = famNext;
      });
      setValues(next);
      setOpValues(nextOps);
    }, [porteeMulti, communCibles, selected, familles, opsByFamille,
      budgetsByLabel, opBudgetsByLabel]);

    // Quinzaine éditée : la quinzaine en cours par défaut ; un choix explicite
    // devenu invalide (rechargement, campagne changée) y retombe plutôt que
    // d'écrire dans une quinzaine que l'écran n'affiche plus.
    var quinzaineActive = (quinzSel && (quinzOptions || []).some(function (o) {
      return o.key === quinzSel;
    })) ? quinzSel : quinzCourante;

    // Valeurs enregistrées pour la parcelle et la quinzaine éditées.
    var quinzEnregistrees = useMemo(function () {
      var key = String(selected || '').toUpperCase().trim();
      if (!key || !quinzaineActive) return {};
      return ((quinzByLabel[key] || {})[quinzaineActive]) || {};
    }, [quinzByLabel, selected, quinzaineActive]);

    // Champs de saisie de la quinzaine : rechargés à chaque changement de
    // parcelle OU de quinzaine (jamais de report implicite d'une quinzaine sur
    // l'autre — le report est un geste explicite, cf. le bouton dédié).
    useEffect(function () {
      if (!selected || !quinzaineActive) { setQuinzValues({}); return; }
      var next = {};
      familles.forEach(function (f) {
        next[f] = quinzEnregistrees[f] != null ? String(quinzEnregistrees[f]) : '';
      });
      setQuinzValues(next);
    }, [selected, quinzaineActive, familles, quinzEnregistrees]);

    var selectedRow = useMemo(function () {
      var key = String(selected || '').toUpperCase().trim();
      if (!key) return null;
      var hit = null;
      (rows || []).forEach(function (r) {
        if (String(r.label || '').toUpperCase().trim() === key) hit = r;
      });
      return hit;
    }, [rows, selected]);

    // Surface CUMULÉE des parcelles cibles en portée multiple.
    // `Total JH = JH/Ha × Σ ha` est EXACT, et non une approximation : le fan-out
    // écrit la MÊME valeur de JH/Ha sur chaque parcelle, donc
    // Σ(jhHa × ha_i) = jhHa × Σha_i. Ne pas « corriger » ce calcul.
    // Les parcelles sans Ha reçoivent bien le budget, elles ne contribuent
    // simplement pas au Total JH — l'entête le dit explicitement.
    var surfaceCible = useMemo(function () {
      return CBT_surfaceCible(targetLabels, cbtHa);
    }, [targetLabels]);

    var ha = porteeMulti ? surfaceCible.ha : (selectedRow ? cbtHa(selectedRow.label) : 0);
    // Bucket de variété sélectionné (portée Variété) — porte la culture du bucket.
    var varieteBucket = null;
    porteeOpts.varietes.forEach(function (v) { if (v.key === varieteSel) varieteBucket = v; });
    // Culture : dérivée du BUCKET en portée multiple (`selectedRow` y est null).
    // Sans ça le badge disparaîtrait et CBT_quinzaineApplicable recevrait ''.
    var culture = porteeMulti
      ? (portee === 'culture' ? cultureSel : (varieteBucket ? varieteBucket.culture : ''))
      : (selectedRow ? cbtCulture(selectedRow.culture, selectedRow.label) : '');
    // Section quinzaine affichée seulement si : module chargé, quinzaine connue,
    // culture budgétée (l'avocatier ne l'est pas — refus miroir côté serveur) ET
    // portée Parcelle. L'engagement est une décision à 15 jours prise parcelle
    // par parcelle ; comme `CBT_buildSavePayload` n'ajoute `budgets_quinzaine`
    // que si une quinzaine est éditée, le masquage est le seul choix qui
    // PRÉSERVE PROUVABLEMENT les engagements déjà en base.
    var quinzaineSaisissable = !!(quinzaineActive && CBT_quinzaineApplicable(culture))
      && !porteeMulti;
    // Clé envoyée au backend : '' = aucun engagement dans ce save (le champ n'est
    // alors pas transmis du tout, cf. CBT_buildSavePayload).
    var quinzaineAEnvoyer = quinzaineSaisissable ? quinzaineActive : '';
    var quinzaineLabel = '';
    (quinzOptions || []).forEach(function (o) {
      if (o.key === quinzaineActive) quinzaineLabel = o.label;
    });
    // Quinzaine précédente RÉELLEMENT présente dans la campagne (jamais num − 1
    // en aveugle) — source du report en un clic.
    var quinzPrecedente = (function () {
      var CBQ = window.CampagneBudgetQuinzaine;
      return CBQ ? CBQ.quinzainePrecedente(quinzaineActive, quinzOptions || []) : '';
    })();
    var quinzPrecedenteValeurs = (function () {
      var key = String(selected || '').toUpperCase().trim();
      if (!key || !quinzPrecedente) return {};
      return ((quinzByLabel[key] || {})[quinzPrecedente]) || {};
    })();
    var quinzPrecedenteLabel = '';
    (quinzOptions || []).forEach(function (o) {
      if (o.key === quinzPrecedente) quinzPrecedenteLabel = o.label;
    });

    /**
     * Report des valeurs de la quinzaine précédente dans les champs de la
     * quinzaine éditée. Sans ce geste, la saisie repart de zéro tous les quinze
     * jours et l'écran ne sert pas.
     *
     * Il ne REMPLIT que les champs — rien n'est écrit tant que « Enregistrer »
     * n'a pas été cliqué, et les suppressions qui en découleraient passent par la
     * même confirmation que les autres.
     */
    function reporterQuinzainePrecedente() {
      var next = {};
      familles.forEach(function (f) {
        var v = quinzPrecedenteValeurs[f];
        next[f] = v != null ? String(v) : '';
      });
      setQuinzValues(next);
    }

    /**
     * @param {boolean} [confirme] true = l'utilisateur a validé la liste des
     *   valeurs de famille qui vont être remplacées.
     */
    function handleSave(confirme) {
      // Le save porte sur TOUTE la parcelle, pas sur la famille éditée : une
      // famille repliée peut être neutralisée sans que rien ne l'ait montré.
      // C'est la seule protection possible pour ce cas — on demande donc une
      // confirmation explicite, avec la liste et les valeurs concernées.
      var menacees = CBT_famillesNeutralisees({
        familles: familles, values: values, opValues: opValues,
      });
      // Engagements de quinzaine qui vont disparaître : même exigence de
      // confirmation explicite. Ils ne sont visibles nulle part ailleurs une
      // fois le champ vidé.
      var quinzMenacees = quinzaineAEnvoyer
        ? CBT_quinzainesSupprimees({
          familles: familles, enregistrees: quinzEnregistrees, values: quinzValues,
        })
        : [];
      if (!confirme) {
        if (menacees.length > 0 || quinzMenacees.length > 0) {
          setConfirmList(menacees);
          setConfirmQuinz(quinzMenacees);
          setMsg(null);
          return;
        }
      } else if (!CBT_memeNeutralisations(confirmList, menacees)
        || !CBT_memeNeutralisations(confirmQuinz, quinzMenacees)) {
        // Bretelles : on ne se fie pas au seul reset de `confirmList` par les
        // effets. Ce qui a été confirmé doit être EXACTEMENT ce qui va être
        // écrit, sinon on refuse et on re-demande. Ferme aussi tout chemin
        // futur qui rendrait la confirmation obsolète autrement.
        setConfirmList(menacees.length > 0 ? menacees : null);
        setMsg({
          type: 'ko',
          text: 'La saisie a changé depuis la confirmation — vérifiez, puis enregistrez à nouveau.',
        });
        return;
      }
      setConfirmList(null);
      setConfirmQuinz(null);
      var built = CBT_buildSavePayload({
        campagne: campagne, label: selected, familles: familles,
        opsByFamille: opsByFamille, values: values, opValues: opValues,
        quinzaine: quinzaineAEnvoyer, quinzValues: quinzValues,
      });
      if (!built.ok) { setMsg({ type: 'ko', text: built.error }); return; }
      setSaving(true);
      setMsg(null);
      fetch('/api/pointage-rh?action=campagne-budget-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(built.payload),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.success) throw new Error((d && d.error) || 'Erreur serveur');
          var savedKey = String(d.label_bee_one || selected).toUpperCase().trim();
          setBudgetsByLabel(function (prev) {
            var next = Object.assign({}, prev);
            next[savedKey] = d.budgets || {};
            return next;
          });
          setOpBudgetsByLabel(function (prev) {
            var next = Object.assign({}, prev);
            next[savedKey] = d.budgets_operations || {};
            return next;
          });
          // Réponse RELUE en base par le backend : on réaligne l'écran sur ce
          // qui est persisté, jamais sur ce qu'on croyait envoyer.
          setQuinzByLabel(function (prev) {
            var next = Object.assign({}, prev);
            var CBQ = window.CampagneBudgetQuinzaine;
            next[savedKey] = CBQ
              ? (CBQ.quinzainesByLabel([{
                label_bee_one: savedKey, budgets_quinzaine: d.budgets_quinzaine || {},
              }])[savedKey] || {})
              : (d.budgets_quinzaine || {});
            return next;
          });
          // Message posé APRÈS setBudgetsByLabel : l'effet de reset du message
          // ne dépend que de `selected` (cf. plus haut), la mise à jour des
          // budgets ne l'efface donc pas.
          setMsg(CBT_saveMessage(d));
        })
        .catch(function (e) { setMsg({ type: 'ko', text: e.message }); })
        .finally(function () { setSaving(false); });
    }

    // Libellé de la cible et parcelles sans Ha, pour l'entête de portée.
    var porteeCibleLabel = portee === 'culture'
      ? cultureSel
      : (varieteBucket ? varieteBucket.label : '');
    var porteeSansHaNoms = surfaceCible.sansHa.slice(0, 3).map(cbtNom).join(', ')
      + (surfaceCible.sansHa.length > 3
        ? ' et ' + (surfaceCible.sansHa.length - 3) + ' autres' : '');
    // La grille n'a de sens que si l'enregistrement porterait sur au moins une
    // parcelle. En portée multiple, une cible non choisie donne 0 cible.
    var grilleVisible = porteeMulti ? targetLabels.length > 0 : !!selected;

    var inputStyle = {
      border: '1px solid ' + CBT_C.border, borderRadius: 6, padding: '5px 8px',
      fontSize: 12, outline: 'none', width: 90, textAlign: 'right',
      boxSizing: 'border-box',
    };
    // Badge ambre — style PARTAGÉ par l'avertissement de neutralisation de
    // famille et par le signalement de divergence entre parcelles cibles. Extrait
    // une fois : deux copies divergeraient à la première retouche visuelle.
    var badgeAmbre = {
      display: 'inline-block', marginLeft: 8, padding: '1px 7px',
      borderRadius: 9, fontSize: 10.5, fontWeight: 700,
      background: '#fef3c7', color: CBT_C.amber, whiteSpace: 'nowrap',
    };
    var thStyle = {
      textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 700,
      color: CBT_C.textSec, borderBottom: '2px solid ' + CBT_C.border,
      whiteSpace: 'nowrap', background: CBT_C.surface2,
    };
    var tdStyle = {
      padding: '8px 10px', fontSize: 12, color: CBT_C.text,
      borderBottom: '1px solid ' + CBT_C.border, verticalAlign: 'middle',
    };

    // Total de la parcelle = somme des totaux de famille (règle métier), donc
    // jamais un double comptage famille + opérations.
    var totalJH = 0;
    var totalJhHa = 0;
    familles.forEach(function (f) {
      var t = CBT_familleTotal(f, values, opValues);
      totalJhHa += t.total;
      totalJH += CBT_totalJH(t.total, ha);
    });
    totalJhHa = Math.round(totalJhHa * 100) / 100;

    // Total ENGAGÉ sur la quinzaine éditée. Somme simple des familles : aucune
    // règle « opérations > famille » ici, l'engagement n'a qu'un seul niveau.
    var totalQuinzJhHa = 0;
    familles.forEach(function (f) { totalQuinzJhHa += CBT_num(quinzValues[f]); });
    totalQuinzJhHa = Math.round(totalQuinzJhHa * 100) / 100;

    function setOpValue(famille, operation, v) {
      // Toucher une opération touche SA FAMILLE : c'est la famille entière qui
      // partira (cf. CBT_buildFanoutPayload).
      marquerTouchee(famille);
      setOpValues(function (prev) {
        var next = Object.assign({}, prev);
        next[famille] = Object.assign({}, next[famille] || {});
        next[famille][operation] = v;
        return next;
      });
    }

    function toggleFamille(famille) {
      setOpenFamilles(function (prev) {
        var next = Object.assign({}, prev);
        if (next[famille]) delete next[famille];
        else next[famille] = true;
        return next;
      });
    }

    return React.createElement('div', { style: { padding: '20px 24px', maxWidth: 900 } },

      React.createElement('div', { style: { marginBottom: 16 } },
        React.createElement('h2', { style: { fontSize: 18, fontWeight: 800, color: CBT_C.text, margin: 0 } },
          React.createElement('i', { className: 'fa-solid fa-bullseye', style: { marginRight: 10, color: CBT_C.berry } }),
          'Budget JH / Ha'
        ),
        React.createElement('p', { style: { margin: '4px 0 0', fontSize: 12, color: CBT_C.textTer } },
          'Budget de main d\'œuvre par parcelle et par nature d\'opération'
            + (campagne ? ' — campagne ' + campagne : '')
            + (canEdit ? '.' : ' (lecture seule — saisie réservée DG/RH).')
        )
      ),

      loading && React.createElement('div', { style: { textAlign: 'center', padding: 40, color: CBT_C.textTer } },
        React.createElement('i', { className: 'fa-solid fa-circle-notch fa-spin', style: { fontSize: 22 } })
      ),

      err && React.createElement('div', {
        style: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', color: '#991b1b', fontSize: 13 },
      }, React.createElement('i', { className: 'fa-solid fa-circle-exclamation', style: { marginRight: 8 } }), err),

      !loading && !err && React.createElement(React.Fragment, null,

        React.createElement('div', {
          style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' },
        },
          // SÉLECTEUR DE PORTÉE. Un budget est en pratique identique pour toutes
          // les parcelles d'une même variété : le saisir 23 fois est le vrai coût
          // d'usage de l'écran. Boutons segmentés (et non un <select>) : la cible
          // est visible d'un coup d'œil et atteignable au doigt — la validation
          // se fait au téléphone. VISIBLE en lecture seule : consulter le budget
          // d'une variété est légitime, seul « Enregistrer » disparaît.
          React.createElement('div', {
            style: {
              display: 'flex', border: '1px solid ' + CBT_C.border,
              borderRadius: 8, overflow: 'hidden',
            },
          },
            CBT_PORTEES.map(function (p, i) {
              var actif = portee === p.key;
              return React.createElement('button', {
                key: p.key,
                onClick: function () { setPortee(p.key); },
                title: p.aide,
                style: {
                  padding: '9px 14px', border: 'none',
                  borderLeft: i === 0 ? 'none' : '1px solid ' + CBT_C.border,
                  background: actif ? CBT_C.berry : CBT_C.surface,
                  color: actif ? '#fff' : CBT_C.textSec,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                },
              }, p.label);
            })
          ),
          portee === 'parcelle' && React.createElement('select', {
            value: selected,
            onChange: function (e) { setSelected(e.target.value); },
            style: {
              border: '1px solid ' + CBT_C.border, borderRadius: 8,
              padding: '7px 10px', fontSize: 12, outline: 'none',
              minWidth: 280, background: CBT_C.surface,
            },
          },
            React.createElement('option', { value: '' }, '— Choisir une parcelle —'),
            options.map(function (r) {
              return React.createElement('option', { key: r.label, value: r.label }, cbtNom(r.label));
            })
          ),
          // Cible de portée VARIÉTÉ : chaque bucket porte son nombre de
          // parcelles, pour qu'on sache combien on est en train d'engager.
          portee === 'variete' && React.createElement('select', {
            value: varieteSel,
            onChange: function (e) { setVarieteSel(e.target.value); },
            style: {
              border: '1px solid ' + CBT_C.border, borderRadius: 8,
              padding: '7px 10px', fontSize: 12, outline: 'none',
              minWidth: 280, background: CBT_C.surface,
            },
          },
            React.createElement('option', { value: '' }, '— Choisir une variété —'),
            porteeOpts.varietes.map(function (v) {
              return React.createElement('option', { key: v.key, value: v.key },
                v.label + ' (' + v.nb + (v.nb > 1 ? ' parcelles)' : ' parcelle)'));
            })
          ),
          portee === 'culture' && React.createElement('select', {
            value: cultureSel,
            onChange: function (e) { setCultureSel(e.target.value); },
            style: {
              border: '1px solid ' + CBT_C.border, borderRadius: 8,
              padding: '7px 10px', fontSize: 12, outline: 'none',
              minWidth: 280, background: CBT_C.surface,
            },
          },
            React.createElement('option', { value: '' }, '— Choisir une culture —'),
            porteeOpts.cultures.map(function (c) {
              return React.createElement('option', { key: c.key, value: c.key },
                c.label + ' (' + c.nb + (c.nb > 1 ? ' parcelles)' : ' parcelle)'));
            })
          ),
          culture && React.createElement(CBT_CultureBadge, { culture: culture }),
          !porteeMulti && selectedRow && React.createElement('span', { style: { fontSize: 12, color: CBT_C.textSec } },
            ha > 0 ? ha.toFixed(2) + ' ha' : 'Ha non saisi — voir Parcelles & Référentiel'
          ),
          // Sélecteur de QUINZAINE : la quinzaine en cours par défaut, une
          // quinzaine passée reste consultable et corrigeable. Masqué quand la
          // parcelle n'est pas budgétable (avocatier) ou qu'aucune quinzaine
          // n'est connue — proposer un champ qui ne s'enregistrerait nulle part
          // serait pire que ne rien afficher.
          selectedRow && quinzaineSaisissable && React.createElement('select', {
            value: quinzaineActive,
            onChange: function (e) { setQuinzSel(e.target.value); },
            title: 'Quinzaine dont on saisit l\'engagement',
            style: {
              border: '1px solid ' + CBT_C.border, borderRadius: 8,
              padding: '7px 10px', fontSize: 12, outline: 'none',
              background: CBT_C.surface,
            },
          }, (quinzOptions || []).map(function (o) {
            return React.createElement('option', { key: o.key, value: o.key },
              o.label + (o.key === quinzCourante ? ' (en cours)' : ''));
          })),
          React.createElement('button', {
            onClick: function () { setTick(function (t) { return t + 1; }); },
            title: 'Rafraîchir',
            style: {
              padding: '6px 10px', borderRadius: 8, border: '1px solid ' + CBT_C.border,
              background: CBT_C.surface, color: CBT_C.textSec, fontSize: 12, cursor: 'pointer',
            },
          }, React.createElement('i', { className: 'fa-solid fa-rotate' }))
        ),

        // ENTÊTE DE PORTÉE MULTIPLE : combien de parcelles, quelle surface, et ce
        // que la portée retire (l'engagement de quinzaine). Un champ qui
        // disparaît sans explication se lit comme un bug.
        porteeMulti && React.createElement('div', {
          style: {
            marginBottom: 16, padding: '10px 12px', borderRadius: 10,
            background: CBT_C.surface2, border: '1px solid ' + CBT_C.border,
            fontSize: 12, color: CBT_C.textSec, lineHeight: 1.6,
          },
        },
          React.createElement('div', null,
            React.createElement('strong', null, 'Portée : ' + (porteeCibleLabel || '—')),
            targetLabels.length === 0
              ? ' — aucune parcelle : choisir une cible ci-dessus.'
              : ' — ' + targetLabels.length
                + (targetLabels.length > 1 ? ' parcelles' : ' parcelle')
                + ' — ' + surfaceCible.ha.toFixed(2) + ' ha'
                + (surfaceCible.sansHa.length > 0
                  ? ' (' + surfaceCible.sansHa.length + ' sans Ha : ' + porteeSansHaNoms
                    + ' — leur Total JH n\'est pas compté, leur budget l\'est)'
                  : '')
          ),
          React.createElement('div', { style: { color: CBT_C.textTer } },
            'Engagement quinzaine : saisie par parcelle uniquement.')
        ),

        !grilleVisible && React.createElement('div', {
          style: { padding: '28px 0', textAlign: 'center', color: CBT_C.textTer, fontSize: 13 },
        }, porteeMulti
          ? (portee === 'variete'
            ? 'Choisir une variété pour saisir son budget.'
            : 'Choisir une culture pour saisir son budget.')
          : 'Sélectionner une parcelle pour saisir son budget.'),

        grilleVisible && React.createElement('div', {
          style: { background: CBT_C.surface, border: '1px solid ' + CBT_C.border, borderRadius: 12, overflow: 'hidden' },
        },
          React.createElement('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            React.createElement('thead', null,
              React.createElement('tr', null,
                React.createElement('th', { style: thStyle }, 'Famille / opération'),
                React.createElement('th', { style: { ...thStyle, textAlign: 'right' } }, 'Budget JH / Ha'),
                React.createElement('th', { style: { ...thStyle, textAlign: 'right' } }, 'Total JH'),
                // Colonne d'ENGAGEMENT court terme. Volontairement à droite du
                // budget annuel et non entre ses deux colonnes : les deux ne se
                // comparent pas terme à terme (l'un couvre la campagne, l'autre
                // 15 jours) et rien ne doit inviter à les soustraire.
                quinzaineSaisissable && React.createElement('th', {
                  style: { ...thStyle, textAlign: 'right', color: CBT_C.berry },
                  title: 'Engagement de la quinzaine, indépendant du budget annuel',
                }, 'Engagé ' + (quinzaineLabel || quinzaineActive) + ' JH / Ha')
              )
            ),
            React.createElement('tbody', null,
              // Une ligne « famille » (repliable) + une ligne par opération
              // quand la famille est dépliée. Le tableau reste utilisable avec
              // ~108 opérations parce que tout est replié par défaut.
              familles.map(function (f, i) {
                var icon = CBT_FAMILLE_ICONS[f];
                var ops = opsByFamille[f] || [];
                var tot = CBT_familleTotal(f, values, opValues);
                var calcule = tot.source === 'operations';
                // Cas MIXTE : total de famille saisi ET opérations renseignées.
                var ecrase = calcule && CBT_num(values[f]) > 0;
                var isOpen = !!openFamilles[f];
                var famRows = [
                  React.createElement('tr', {
                    key: f,
                    style: { background: i % 2 === 0 ? CBT_C.surface : CBT_C.surface2 },
                  },
                    React.createElement('td', { style: { ...tdStyle, fontWeight: 700 } },
                      React.createElement('button', {
                        onClick: function () { toggleFamille(f); },
                        title: ops.length === 0 ? 'Aucune opération au référentiel'
                          : (isOpen ? 'Replier' : 'Déplier ' + ops.length + ' opérations'),
                        disabled: ops.length === 0,
                        style: {
                          border: 'none', background: 'transparent', cursor: ops.length === 0 ? 'default' : 'pointer',
                          color: CBT_C.textSec, fontSize: 11, width: 20, padding: 0,
                          marginRight: 4, opacity: ops.length === 0 ? 0.25 : 1,
                        },
                      }, React.createElement('i', {
                        className: 'fa-solid ' + (isOpen ? 'fa-chevron-down' : 'fa-chevron-right'),
                      })),
                      icon && React.createElement('i', {
                        className: 'fa-solid ' + icon,
                        style: { color: CBT_C.berry, fontSize: 12, width: 18 },
                      }),
                      f,
                      ops.length > 0 && React.createElement('span', {
                        style: { marginLeft: 8, fontSize: 11, fontWeight: 500, color: CBT_C.textTer },
                      }, ops.length + ' op.'),
                      // CAS MIXTE : la famille avait un total saisi ET porte
                      // maintenant des opérations. Le total bascule sur les
                      // opérations et la valeur de famille sera remplacée à
                      // l'enregistrement. Badge TEXTE (pas un `title=` : illisible
                      // au doigt, or la validation se fait au téléphone), portant
                      // la valeur menacée — sans quoi elle a déjà disparu de
                      // l'écran (la cellule affiche la somme des opérations).
                      ecrase && React.createElement('span', { style: badgeAmbre },
                        React.createElement('i', {
                          className: 'fa-solid fa-triangle-exclamation',
                          style: { marginRight: 5 },
                        }),
                        'famille ' + CBT_num(values[f]) + ' → remplacée par les opérations'
                      ),
                      // DIVERGENCE entre les parcelles cibles (portée multiple) :
                      // le champ est vide, mais pas parce que rien n'est budgété.
                      // Annoncée EN TEXTE, jamais dans un seul `title=` : la
                      // validation se fait au téléphone, un survol n'existe pas.
                      divergentes[f] && React.createElement('span', { style: badgeAmbre },
                        React.createElement('i', {
                          className: 'fa-solid fa-triangle-exclamation',
                          style: { marginRight: 5 },
                        }),
                        divergentes[f].nb + ' valeurs différentes ('
                          + divergentes[f].min + ' → ' + divergentes[f].max
                          + ') — non modifiée à l\'enregistrement'
                      )
                    ),
                    React.createElement('td', { style: { ...tdStyle, textAlign: 'right' } },
                      // Dès qu'une opération est budgétée, le total de famille
                      // est CALCULÉ : le champ devient non éditable, sinon la
                      // saisie laisserait croire à une addition des deux niveaux.
                      (canEdit && !calcule)
                        ? React.createElement('input', {
                          type: 'number', min: 0, step: 0.1,
                          value: values[f] == null ? '' : values[f],
                          placeholder: '0',
                          title: 'Budget de la famille, à défaut de détail par opération',
                          onChange: function (e) {
                            var v = e.target.value;
                            marquerTouchee(f);
                            setValues(function (prev) {
                              var next = Object.assign({}, prev);
                              next[f] = v;
                              return next;
                            });
                          },
                          style: inputStyle,
                        })
                        : React.createElement('span', {
                          style: { fontFamily: 'monospace', fontWeight: 700 },
                          title: calcule ? 'Somme des opérations de la famille' : undefined,
                        },
                          tot.total > 0 ? tot.total.toFixed(2) : '—')
                    ),
                    React.createElement('td', {
                      style: { ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: CBT_C.textSec },
                    }, CBT_totalJH(tot.total, ha) > 0 ? CBT_totalJH(tot.total, ha).toFixed(2) : '—'),
                    // Engagement de la quinzaine : saisi au niveau FAMILLE
                    // uniquement — c'est la maille de l'engagement, le détail par
                    // opération reste annuel.
                    quinzaineSaisissable && React.createElement('td', {
                      style: { ...tdStyle, textAlign: 'right' },
                    },
                      canEdit
                        ? React.createElement('input', {
                          type: 'number', min: 0, step: 0.1,
                          value: quinzValues[f] == null ? '' : quinzValues[f],
                          placeholder: '0',
                          title: 'JH/Ha engagés sur ' + (quinzaineLabel || quinzaineActive),
                          onChange: function (e) {
                            var v = e.target.value;
                            setQuinzValues(function (prev) {
                              var next = Object.assign({}, prev);
                              next[f] = v;
                              return next;
                            });
                          },
                          style: inputStyle,
                        })
                        : React.createElement('span', { style: { fontFamily: 'monospace' } },
                          quinzValues[f] ? quinzValues[f] : '—')
                    )
                  ),
                ];
                if (isOpen) {
                  ops.forEach(function (op) {
                    var vOp = (opValues[f] || {})[op];
                    var opInfo = CBT_splitOpKey(op);
                    famRows.push(React.createElement('tr', {
                      key: f + '||' + op,
                      style: { background: CBT_C.surface },
                    },
                      React.createElement('td', { style: { ...tdStyle, paddingLeft: 46, color: CBT_C.textSec } },
                        opInfo.operation,
                        // CODE GB affiché : c'est LUI la clé du budget, et le même
                        // libellé peut exister sous deux codes (« Nettoyage » =
                        // GB05 Entretien structure ET GB11 Service générale). Sans
                        // le code, deux lignes légitimes seraient indiscernables.
                        opInfo.code && React.createElement('span', {
                          style: {
                            marginLeft: 8, padding: '1px 6px', borderRadius: 6,
                            fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                            background: CBT_C.surface2, color: CBT_C.textTer,
                          },
                          title: 'Code référentiel BEE ONE — clé de rapprochement avec le réalisé',
                        }, opInfo.code),
                        // Divergence au niveau OPÉRATION — indépendante de celle
                        // de la famille (une famille en accord peut porter une
                        // opération divergente).
                        (divergentesOps[f] || {})[op] && React.createElement('span', {
                          style: badgeAmbre,
                        },
                          React.createElement('i', {
                            className: 'fa-solid fa-triangle-exclamation',
                            style: { marginRight: 5 },
                          }),
                          divergentesOps[f][op].nb + ' valeurs différentes ('
                            + divergentesOps[f][op].min + ' → ' + divergentesOps[f][op].max
                            + ') — non modifiée à l\'enregistrement'
                        )
                      ),
                      React.createElement('td', { style: { ...tdStyle, textAlign: 'right' } },
                        canEdit
                          ? React.createElement('input', {
                            type: 'number', min: 0, step: 0.1,
                            value: vOp == null ? '' : vOp,
                            placeholder: '0',
                            onChange: function (e) { setOpValue(f, op, e.target.value); },
                            style: inputStyle,
                          })
                          : React.createElement('span', { style: { fontFamily: 'monospace' } },
                            vOp ? vOp : '—')
                      ),
                      React.createElement('td', {
                        style: { ...tdStyle, textAlign: 'right', fontFamily: 'monospace', color: CBT_C.textTer },
                      }, CBT_totalJH(vOp, ha) > 0 ? CBT_totalJH(vOp, ha).toFixed(2) : '—'),
                      // Pas d'engagement au niveau opération : cellule vide, et
                      // non un champ qui ne s'enregistrerait nulle part.
                      quinzaineSaisissable && React.createElement('td', {
                        style: { ...tdStyle, textAlign: 'right', color: CBT_C.textTer },
                      }, '')
                    ));
                  });
                }
                return famRows;
              })
            ),
            React.createElement('tfoot', null,
              React.createElement('tr', null,
                React.createElement('td', { style: { ...tdStyle, fontWeight: 700 } }, 'Total'),
                React.createElement('td', {
                  style: { ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' },
                }, totalJhHa > 0 ? totalJhHa.toFixed(2) : '—'),
                React.createElement('td', {
                  style: { ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' },
                }, totalJH > 0 ? totalJH.toFixed(2) : '—'),
                // Total ENGAGÉ sur la quinzaine. Aucune comparaison n'est
                // affichée avec le total annuel : leur écart est légitime (un
                // engagement de 15 jours n'est pas une tranche du budget annuel),
                // le signaler comme une anomalie serait faux.
                quinzaineSaisissable && React.createElement('td', {
                  style: { ...tdStyle, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: CBT_C.berry },
                }, totalQuinzJhHa > 0 ? totalQuinzJhHa.toFixed(2) : '—')
              )
            )
          ),

          // CONFIRMATION : le save étant global à la parcelle, une famille
          // repliée peut voir sa valeur de famille remplacée sans que rien ne
          // l'ait signalé à l'écran. On liste explicitement les familles
          // concernées AVANT d'écrire, avec la valeur perdue et son
          // remplacement.
          canEdit && ((confirmList && confirmList.length > 0)
            || (confirmQuinz && confirmQuinz.length > 0)) && React.createElement('div', {
            style: {
              padding: '12px 14px', borderTop: '1px solid ' + CBT_C.border,
              background: '#fffbeb', color: CBT_C.amber, fontSize: 12,
            },
          },
            confirmList && confirmList.length > 0 && React.createElement('div', { style: { fontWeight: 700, marginBottom: 6 } },
              React.createElement('i', {
                className: 'fa-solid fa-triangle-exclamation', style: { marginRight: 8 },
              }),
              confirmList.length > 1
                ? confirmList.length + ' valeurs de famille vont être remplacées par le détail'
                  + ' de leurs opérations :'
                : 'Une valeur de famille va être remplacée par le détail de ses opérations :'
            ),
            confirmList && confirmList.length > 0 && React.createElement('ul', { style: { margin: '0 0 10px', paddingLeft: 26 } },
              confirmList.map(function (n) {
                return React.createElement('li', { key: n.famille, style: { marginBottom: 2 } },
                  n.famille + ' : ' + n.valeur + ' JH/Ha → ' + n.total + ' JH/Ha');
              })
            ),
            // Engagements de quinzaine effacés : même traitement que les
            // neutralisations — annoncés AVANT l'écriture, avec la valeur perdue.
            confirmQuinz && confirmQuinz.length > 0 && React.createElement('div', { style: { fontWeight: 700, marginBottom: 6 } },
              React.createElement('i', {
                className: 'fa-solid fa-triangle-exclamation', style: { marginRight: 8 },
              }),
              (confirmQuinz.length > 1
                ? confirmQuinz.length + ' engagements de ' : 'Un engagement de ')
                + (quinzaineLabel || quinzaineActive) + ' vont être supprimés :'
            ),
            confirmQuinz && confirmQuinz.length > 0 && React.createElement('ul', { style: { margin: '0 0 10px', paddingLeft: 26 } },
              confirmQuinz.map(function (n) {
                return React.createElement('li', { key: 'q-' + n.famille, style: { marginBottom: 2 } },
                  n.famille + ' : ' + n.valeur + ' JH/Ha → supprimé');
              })
            ),
            React.createElement('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
              React.createElement('button', {
                onClick: function () { handleSave(true); },
                disabled: saving,
                style: {
                  padding: '6px 16px', borderRadius: 8, border: 'none',
                  background: CBT_C.amber, color: '#fff', fontSize: 12, fontWeight: 700,
                  cursor: saving ? 'not-allowed' : 'pointer',
                },
              }, 'Confirmer et enregistrer'),
              React.createElement('button', {
                onClick: function () { setConfirmList(null); setConfirmQuinz(null); },
                style: {
                  padding: '6px 16px', borderRadius: 8,
                  border: '1px solid ' + CBT_C.border, background: CBT_C.surface,
                  color: CBT_C.textSec, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                },
              }, 'Annuler')
            )
          ),

          React.createElement('div', {
            style: {
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
              borderTop: '1px solid ' + CBT_C.border, flexWrap: 'wrap',
            },
          },
            // ⚠️ ÉTAT INTERMÉDIAIRE ASSUMÉ : en portée multiple, le bouton est
            // ABSENT tant que le fan-out n'est pas livré (payload partiel + envoi
            // multi-labels + confirmation, lots suivants). `handleSave`
            // n'écrirait aujourd'hui que sur `selected` avec la grille commune de
            // N parcelles — un budget faux sur une parcelle, et un silence sur
            // les 22 autres. Mieux vaut pas de bouton qu'un bouton qui ment.
            canEdit && !porteeMulti && React.createElement('button', {
              onClick: function () { handleSave(false); },
              disabled: saving,
              style: {
                padding: '7px 18px', borderRadius: 8, border: 'none',
                background: CBT_C.green, color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
              },
            }, saving ? 'Enregistrement…' : 'Enregistrer'),
            // REPORT EN UN CLIC : sans lui, 12 valeurs se re-saisissent tous les
            // quinze jours et l'écran n'est pas utilisé. Il ne fait que REMPLIR
            // les champs — rien n'est écrit avant « Enregistrer ».
            canEdit && quinzaineSaisissable && quinzPrecedente && React.createElement('button', {
              onClick: reporterQuinzainePrecedente,
              title: 'Recopier les engagements de ' + (quinzPrecedenteLabel || quinzPrecedente)
                + ' dans les champs de ' + (quinzaineLabel || quinzaineActive)
                + ' (rien n\'est enregistré avant de cliquer sur Enregistrer)',
              style: {
                padding: '7px 14px', borderRadius: 8, border: '1px solid ' + CBT_C.border,
                background: CBT_C.surface, color: CBT_C.textSec, fontSize: 12,
                fontWeight: 700, cursor: 'pointer',
              },
            },
              React.createElement('i', { className: 'fa-solid fa-copy', style: { marginRight: 6 } }),
              'Reporter ' + (quinzPrecedenteLabel || quinzPrecedente)
            ),
            // Succès, succès-avec-purge, erreur : même niveau visuel (une ligne
            // à côté du bouton). La purge est un succès, mais elle SUPPRIME des
            // données : ambre + icône d'avertissement pour qu'elle se remarque.
            msg && React.createElement('span', {
              style: {
                fontSize: 12, fontWeight: 600,
                color: msg.type !== 'ok' ? '#dc2626' : (msg.purge ? CBT_C.amber : CBT_C.green),
              },
            },
              React.createElement('i', {
                className: 'fa-solid ' + (msg.type !== 'ok'
                  ? 'fa-circle-exclamation'
                  : (msg.purge ? 'fa-triangle-exclamation' : 'fa-circle-check')),
                style: { marginRight: 6 },
              }),
              msg.text
            ),
            React.createElement('span', { style: { fontSize: 11, color: CBT_C.textTer } },
              !canEdit
                ? 'Saisie réservée aux profils DG/RH.'
                : (porteeMulti
                  ? 'Grille commune aux parcelles de la portée : ce qui concorde est'
                    + ' pré-rempli, ce qui diverge reste vide et est signalé.'
                    + ' L\'enregistrement en portée multiple arrive avec le lot suivant.'
                  : 'Déplier une famille pour saisir ses opérations. Le total de famille'
                    + ' devient calculé dès qu\'une opération est budgétée ; sinon il reste'
                    + ' saisissable. Un champ vide (ou 0) supprime la ligne.')
            )
          )
        )
      )
    );
  }

  window.CampagneBudgetTab = CampagneBudgetTab;
  // Helpers purs exposés pour les tests unitaires — accrochés au composant déjà
  // exposé, pas de nouveau nom global (collisions UMD de public/components).
  CampagneBudgetTab.famillesFromOps = CBT_famillesFromOps;
  CampagneBudgetTab.opsByFamille = CBT_opsByFamille;
  CampagneBudgetTab.opKey = CBT_opKey;
  CampagneBudgetTab.splitOpKey = CBT_splitOpKey;
  CampagneBudgetTab.familleDuCode = CBT_familleDuCode;
  CampagneBudgetTab.operationLabel = CBT_operationLabel;
  CampagneBudgetTab.saveMessage = CBT_saveMessage;
  CampagneBudgetTab.budgetsByLabel = CBT_budgetsByLabel;
  CampagneBudgetTab.operationsByLabel = CBT_operationsByLabel;
  CampagneBudgetTab.buildSavePayload = CBT_buildSavePayload;
  CampagneBudgetTab.buildFanoutPayload = CBT_buildFanoutPayload;
  CampagneBudgetTab.familleTotal = CBT_familleTotal;
  CampagneBudgetTab.famillesNeutralisees = CBT_famillesNeutralisees;
  CampagneBudgetTab.memeNeutralisations = CBT_memeNeutralisations;
  CampagneBudgetTab.totalJH = CBT_totalJH;
  CampagneBudgetTab.quinzaineApplicable = CBT_quinzaineApplicable;
  CampagneBudgetTab.quinzainesSupprimees = CBT_quinzainesSupprimees;
  CampagneBudgetTab.CULTURES_QUINZAINE = CBT_CULTURES_QUINZAINE;
  CampagneBudgetTab.cultureRow = CBT_cultureRow;
  CampagneBudgetTab.parcelleAffichable = CBT_parcelleAffichable;
  CampagneBudgetTab.CULTURES_MASQUEES = CBT_CULTURES_MASQUEES;
  CampagneBudgetTab.varieteKey = CBT_varieteKey;
  CampagneBudgetTab.porteeOptions = CBT_porteeOptions;
  CampagneBudgetTab.targetLabels = CBT_targetLabels;
  CampagneBudgetTab.valeursCommunes = CBT_valeursCommunes;
  CampagneBudgetTab.surfaceCible = CBT_surfaceCible;
})();
