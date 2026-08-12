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
    berry: '#c0392b',
    green: '#1D9E75',
    amber: '#b45309',
    gray: '#888780',
    surface: '#ffffff',
    surface2: '#f5f4ef',
    border: 'rgba(0,0,0,0.10)',
    text: '#1c1c1a',
    textSec: '#5f5e5a',
    textTer: '#8a8985'
  };
  var CBT_FAMILLE_ICONS = {
    'Travaux du sol': 'fa-trowel',
    'Ferti-irrigation': 'fa-droplet',
    'Plantation': 'fa-seedling',
    'Mise en valeur': 'fa-hammer',
    'Entretien structure': 'fa-screwdriver-wrench',
    'Traitement phyto': 'fa-spray-can',
    'Tuteurage & palissage': 'fa-grip-lines-vertical',
    'Taille': 'fa-scissors',
    'Arrachage': 'fa-shovel',
    'Services généraux': 'fa-people-group',
    'Récolte': 'fa-basket-shopping'
  };
  var CULTURE_COLORS = {
    Framboise: {
      bg: '#fce4e4',
      text: '#c0392b'
    },
    Myrtille: {
      bg: '#dbeafe',
      text: '#1d4ed8'
    },
    Avocatier: {
      bg: '#d1fae5',
      text: '#065f46'
    }
  };

  /** Culture d'une parcelle — source de vérité partagée (public/lib/cultureUtils.js). */
  function cbtCulture(cultureField, labelFallback) {
    var CU = window.CultureUtils;
    if (CU && typeof CU.normCulture === 'function') return CU.normCulture(cultureField, labelFallback);
    return '';
  }

  /** Ha d'une parcelle — helper global d'app.jsx (référentiel SB puis campagne). */
  function cbtHa(label) {
    return typeof window.sbParcelleHa === 'function' ? window.sbParcelleHa(label) || 0 : 0;
  }

  /** Nom affiché d'une parcelle — helper global d'app.jsx (nom SB sinon label). */
  function cbtNom(label) {
    return typeof window.sbParcelleNom === 'function' ? window.sbParcelleNom(label) : label || '—';
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
    if (i <= 0) return {
      code: '',
      operation: raw
    };
    var code = raw.slice(0, i);
    if (!CBT_CODE_RE.test(code)) return {
      code: '',
      operation: raw
    };
    return {
      code: code.toUpperCase(),
      operation: raw.slice(i + CBT_OP_KEY_SEP.length).trim()
    };
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
    var map = famillesParCode && typeof famillesParCode === 'object' && !Array.isArray(famillesParCode) ? famillesParCode : {};
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
      return (a && a.ordre || 0) - (b && b.ordre || 0);
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
      return (a && a.ordre || 0) - (b && b.ordre || 0);
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
      var key = String(b && b.label_bee_one || '').trim().toUpperCase();
      if (!key) return;
      out[key] = b && b.budgets || {};
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
      var key = String(b && b.label_bee_one || '').trim().toUpperCase();
      if (!key) return;
      out[key] = b && b.budgets_operations || {};
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
    if (somme > 0) return {
      total: Math.round(somme * 100) / 100,
      source: 'operations'
    };
    var n = CBT_num((values || {})[key]);
    if (n > 0) return {
      total: Math.round(n * 100) / 100,
      source: 'famille'
    };
    return {
      total: 0,
      source: 'aucun'
    };
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
      out.push({
        famille: f,
        valeur: valeur,
        total: tot.total
      });
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
      return (Array.isArray(list) ? list : []).map(function (n) {
        if (!n || typeof n !== 'object') return '';
        return String(n.famille) + '|' + CBT_num(n.valeur) + '|' + CBT_num(n.total);
      }).sort().join('§');
    }
    return cle(a) === cle(b);
  }

  /**
   * Construit le body de `campagne-budget-save`. PURE.
   *
   * Toutes les familles AFFICHÉES et toutes leurs opérations sont envoyées, y
   * compris celles laissées vides (→ 0) : c'est ce qui permet d'effacer un
   * budget sans action de suppression dédiée (le backend supprime les entrées
   * à 0).
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
   * @returns {{ok: boolean, error?: string, payload?: Object}}
   */
  function CBT_buildSavePayload(args) {
    var a = args || {};
    if (!a.campagne) return {
      ok: false,
      error: 'Campagne inconnue'
    };
    if (!a.label) return {
      ok: false,
      error: 'Sélectionner une parcelle'
    };
    var familles = a.familles || [];
    if (familles.length === 0) return {
      ok: false,
      error: 'Aucune famille d\'opération'
    };
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
            error: 'Valeur invalide pour « ' + f + ' — ' + CBT_operationLabel(op) + ' »'
          };
        }
        famOps[op] = vOp;
        somme += vOp;
      }
      if (ops.length > 0) budgetsOperations[f] = famOps;
      var vFam = parseOne(values[f]);
      if (vFam === null) return {
        ok: false,
        error: 'Valeur invalide pour « ' + f + ' »'
      };
      // Famille détaillée par opération → la valeur de famille est neutralisée.
      budgets[f] = somme > 0 ? 0 : vFam;
    }
    return {
      ok: true,
      payload: {
        campagne: a.campagne,
        label_bee_one: a.label,
        budgets: budgets,
        budgets_operations: budgetsOperations
      }
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
   * @param {{familles_purgees?: Array<string>, operations_purgees?: Array<string>}
   *   |null|undefined} res réponse API.
   * @returns {{type: string, text: string, purge?: boolean}}
   */
  function CBT_saveMessage(res) {
    function clean(brutes) {
      return (Array.isArray(brutes) ? brutes : []).map(function (f) {
        return String(f == null ? '' : f).trim();
      }).filter(Boolean);
    }
    var purgees = clean(res && res.familles_purgees);
    var opsPurgees = clean(res && res.operations_purgees);
    // Valeurs de famille remplacées par le détail des opérations : le backend
    // les renvoie parce que l'écran seul ne peut pas les connaître (familles
    // hors écran neutralisées par un save global).
    var neutralisees = (Array.isArray(res && res.familles_neutralisees) ? res.familles_neutralisees : []).map(function (n) {
      if (!n || typeof n !== 'object') return '';
      var famille = String(n.famille == null ? '' : n.famille).trim();
      if (!famille) return '';
      var v = CBT_num(n.valeur_precedente);
      return v > 0 ? famille + ' (' + v + ')' : famille;
    }).filter(Boolean);
    var differee = CBT_num(res && res.purge_differee);
    if (purgees.length === 0 && opsPurgees.length === 0 && neutralisees.length === 0 && differee <= 0) {
      return {
        type: 'ok',
        text: 'Budget enregistré'
      };
    }
    var parts = [];
    if (neutralisees.length > 0) {
      parts.push(neutralisees.length + (neutralisees.length > 1 ? ' valeurs de famille remplacées par le détail des opérations : ' : ' valeur de famille remplacée par le détail des opérations : ') + neutralisees.join(', '));
    }
    if (differee > 0) {
      parts.push('nettoyage de ' + differee + (differee > 1 ? ' entrées obsolètes reporté' : ' entrée obsolète reporté') + ' (référentiel incomplet) — rien n\'a été supprimé');
    }
    if (purgees.length > 0) {
      parts.push(purgees.length + (purgees.length > 1 ? ' familles obsolètes retirées : ' : ' famille obsolète retirée : ') + purgees.join(', '));
    }
    if (opsPurgees.length > 0) {
      parts.push(opsPurgees.length + (opsPurgees.length > 1 ? ' opérations obsolètes retirées : ' : ' opération obsolète retirée : ') + opsPurgees.join(', '));
    }
    return {
      type: 'ok',
      purge: true,
      text: 'Budget enregistré — ' + parts.join(' ; ')
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
    var col = CULTURE_COLORS[culture] || {
      bg: '#f3f4f6',
      text: '#374151'
    };
    return React.createElement('span', {
      style: {
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        background: col.bg,
        color: col.text
      }
    }, culture);
  }
  function CampagneBudgetTab(props) {
    var userRole = String(props && props.userRole || '').toLowerCase();
    var canEdit = userRole === 'dg' || userRole === 'rh' || userRole === 'admin';
    var _rows = useState([]);
    var rows = _rows[0];
    var setRows = _rows[1];
    var _familles = useState([]);
    var familles = _familles[0];
    var setFamilles = _familles[1];
    var _budgets = useState({});
    var budgetsByLabel = _budgets[0];
    var setBudgetsByLabel = _budgets[1];
    var _campagne = useState('');
    var campagne = _campagne[0];
    var setCampagne = _campagne[1];
    var _sel = useState('');
    var selected = _sel[0];
    var setSelected = _sel[1];
    var _values = useState({});
    var values = _values[0];
    var setValues = _values[1];
    var _loading = useState(true);
    var loading = _loading[0];
    var setLoading = _loading[1];
    var _err = useState(null);
    var err = _err[0];
    var setErr = _err[1];
    var _saving = useState(false);
    var saving = _saving[0];
    var setSaving = _saving[1];
    var _msg = useState(null);
    var msg = _msg[0];
    var setMsg = _msg[1]; // { type: 'ok'|'ko', text }
    var _tick = useState(0);
    var tick = _tick[0];
    var setTick = _tick[1];
    // États du niveau OPÉRATION — ajoutés APRÈS les précédents à dessein :
    // l'ordre des useState est l'index de state de React, le décaler
    // renumérote tout (et casse le harnais de test qui indexe par position).
    var _opsByFamille = useState({});
    var opsByFamille = _opsByFamille[0];
    var setOpsByFamille = _opsByFamille[1];
    var _opBudgets = useState({});
    var opBudgetsByLabel = _opBudgets[0];
    var setOpBudgetsByLabel = _opBudgets[1];
    var _opValues = useState({});
    var opValues = _opValues[0];
    var setOpValues = _opValues[1];
    // Repliage par famille : ~108 opérations, tout déplier d'emblée noierait
    // l'écran. Persiste d'une parcelle à l'autre (on compare souvent la même
    // famille sur plusieurs parcelles).
    var _open = useState({});
    var openFamilles = _open[0];
    var setOpenFamilles = _open[1];
    // Familles dont la valeur de famille va être remplacée : null = pas de
    // confirmation en attente.
    var _confirm = useState(null);
    var confirmList = _confirm[0];
    var setConfirmList = _confirm[1];
    useEffect(function () {
      var cancelled = false;
      setLoading(true);
      setErr(null);
      Promise.all([fetch('/api/pointage-rh?action=parcelles-campagne-list').then(function (r) {
        return r.json();
      }), fetch('/api/pointage-rh?action=sb-referentiel-list').then(function (r) {
        return r.json();
      }), fetch('/api/pointage-rh?action=referentiel-taches-list').then(function (r) {
        return r.json();
      }), fetch('/api/pointage-rh?action=campagne-budget-list').then(function (r) {
        return r.json();
      })]).then(function (res) {
        if (cancelled) return;
        var parc = res[0];
        var sb = res[1];
        var taches = res[2];
        var buds = res[3];
        if (!parc || !parc.success) throw new Error(parc && parc.error || 'Erreur parcelles');
        if (!taches || !taches.success) throw new Error(taches && taches.error || 'Erreur référentiel tâches');
        if (!buds || !buds.success) throw new Error(buds && buds.error || 'Erreur budgets');
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
        setBudgetsByLabel(CBT_budgetsByLabel(buds.budgets || []));
        setOpBudgetsByLabel(CBT_operationsByLabel(buds.budgets || []));
        setCampagne(buds.campagne || '');
      }).catch(function (e) {
        if (!cancelled) setErr(e.message);
      }).finally(function () {
        if (!cancelled) setLoading(false);
      });
      return function () {
        cancelled = true;
      };
    }, [tick]);

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
    useEffect(function () {
      setConfirmList(null);
    }, [selected, tick]);

    // Changement de parcelle (ou de budgets connus) → recharger les champs.
    useEffect(function () {
      if (!selected) {
        setValues({});
        setOpValues({});
        return;
      }
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
    }, [selected, familles, opsByFamille, budgetsByLabel, opBudgetsByLabel]);
    var options = useMemo(function () {
      return (rows || []).slice().sort(function (a, b) {
        return cbtNom(a.label).localeCompare(cbtNom(b.label));
      });
    }, [rows]);
    var selectedRow = useMemo(function () {
      var key = String(selected || '').toUpperCase().trim();
      if (!key) return null;
      var hit = null;
      (rows || []).forEach(function (r) {
        if (String(r.label || '').toUpperCase().trim() === key) hit = r;
      });
      return hit;
    }, [rows, selected]);
    var ha = selectedRow ? cbtHa(selectedRow.label) : 0;

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
        familles: familles,
        values: values,
        opValues: opValues
      });
      if (!confirme) {
        if (menacees.length > 0) {
          setConfirmList(menacees);
          setMsg(null);
          return;
        }
      } else if (!CBT_memeNeutralisations(confirmList, menacees)) {
        // Bretelles : on ne se fie pas au seul reset de `confirmList` par les
        // effets. Ce qui a été confirmé doit être EXACTEMENT ce qui va être
        // écrit, sinon on refuse et on re-demande. Ferme aussi tout chemin
        // futur qui rendrait la confirmation obsolète autrement.
        setConfirmList(menacees.length > 0 ? menacees : null);
        setMsg({
          type: 'ko',
          text: 'La saisie a changé depuis la confirmation — vérifiez, puis enregistrez à nouveau.'
        });
        return;
      }
      setConfirmList(null);
      var built = CBT_buildSavePayload({
        campagne: campagne,
        label: selected,
        familles: familles,
        opsByFamille: opsByFamille,
        values: values,
        opValues: opValues
      });
      if (!built.ok) {
        setMsg({
          type: 'ko',
          text: built.error
        });
        return;
      }
      setSaving(true);
      setMsg(null);
      fetch('/api/pointage-rh?action=campagne-budget-save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(built.payload)
      }).then(function (r) {
        return r.json();
      }).then(function (d) {
        if (!d || !d.success) throw new Error(d && d.error || 'Erreur serveur');
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
        // Message posé APRÈS setBudgetsByLabel : l'effet de reset du message
        // ne dépend que de `selected` (cf. plus haut), la mise à jour des
        // budgets ne l'efface donc pas.
        setMsg(CBT_saveMessage(d));
      }).catch(function (e) {
        setMsg({
          type: 'ko',
          text: e.message
        });
      }).finally(function () {
        setSaving(false);
      });
    }
    var inputStyle = {
      border: '1px solid ' + CBT_C.border,
      borderRadius: 6,
      padding: '5px 8px',
      fontSize: 12,
      outline: 'none',
      width: 90,
      textAlign: 'right',
      boxSizing: 'border-box'
    };
    var thStyle = {
      textAlign: 'left',
      padding: '8px 10px',
      fontSize: 11,
      fontWeight: 700,
      color: CBT_C.textSec,
      borderBottom: '2px solid ' + CBT_C.border,
      whiteSpace: 'nowrap',
      background: CBT_C.surface2
    };
    var tdStyle = {
      padding: '8px 10px',
      fontSize: 12,
      color: CBT_C.text,
      borderBottom: '1px solid ' + CBT_C.border,
      verticalAlign: 'middle'
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
    function setOpValue(famille, operation, v) {
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
        if (next[famille]) delete next[famille];else next[famille] = true;
        return next;
      });
    }
    return React.createElement('div', {
      style: {
        padding: '20px 24px',
        maxWidth: 900
      }
    }, React.createElement('div', {
      style: {
        marginBottom: 16
      }
    }, React.createElement('h2', {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: CBT_C.text,
        margin: 0
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-bullseye',
      style: {
        marginRight: 10,
        color: CBT_C.berry
      }
    }), 'Budget JH / Ha'), React.createElement('p', {
      style: {
        margin: '4px 0 0',
        fontSize: 12,
        color: CBT_C.textTer
      }
    }, 'Budget de main d\'œuvre par parcelle et par nature d\'opération' + (campagne ? ' — campagne ' + campagne : '') + (canEdit ? '.' : ' (lecture seule — saisie réservée DG/RH).'))), loading && React.createElement('div', {
      style: {
        textAlign: 'center',
        padding: 40,
        color: CBT_C.textTer
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-notch fa-spin',
      style: {
        fontSize: 22
      }
    })), err && React.createElement('div', {
      style: {
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: 10,
        padding: '12px 16px',
        color: '#991b1b',
        fontSize: 13
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-circle-exclamation',
      style: {
        marginRight: 8
      }
    }), err), !loading && !err && React.createElement(React.Fragment, null, React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 16,
        flexWrap: 'wrap'
      }
    }, React.createElement('select', {
      value: selected,
      onChange: function (e) {
        setSelected(e.target.value);
      },
      style: {
        border: '1px solid ' + CBT_C.border,
        borderRadius: 8,
        padding: '7px 10px',
        fontSize: 12,
        outline: 'none',
        minWidth: 280,
        background: CBT_C.surface
      }
    }, React.createElement('option', {
      value: ''
    }, '— Choisir une parcelle —'), options.map(function (r) {
      return React.createElement('option', {
        key: r.label,
        value: r.label
      }, cbtNom(r.label));
    })), selectedRow && React.createElement(CBT_CultureBadge, {
      culture: cbtCulture(selectedRow.culture, selectedRow.label)
    }), selectedRow && React.createElement('span', {
      style: {
        fontSize: 12,
        color: CBT_C.textSec
      }
    }, ha > 0 ? ha.toFixed(2) + ' ha' : 'Ha non saisi — voir Parcelles & Référentiel'), React.createElement('button', {
      onClick: function () {
        setTick(function (t) {
          return t + 1;
        });
      },
      title: 'Rafraîchir',
      style: {
        padding: '6px 10px',
        borderRadius: 8,
        border: '1px solid ' + CBT_C.border,
        background: CBT_C.surface,
        color: CBT_C.textSec,
        fontSize: 12,
        cursor: 'pointer'
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-rotate'
    }))), !selected && React.createElement('div', {
      style: {
        padding: '28px 0',
        textAlign: 'center',
        color: CBT_C.textTer,
        fontSize: 13
      }
    }, 'Sélectionner une parcelle pour saisir son budget.'), selected && React.createElement('div', {
      style: {
        background: CBT_C.surface,
        border: '1px solid ' + CBT_C.border,
        borderRadius: 12,
        overflow: 'hidden'
      }
    }, React.createElement('table', {
      style: {
        width: '100%',
        borderCollapse: 'collapse'
      }
    }, React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', {
      style: thStyle
    }, 'Famille / opération'), React.createElement('th', {
      style: {
        ...thStyle,
        textAlign: 'right'
      }
    }, 'Budget JH / Ha'), React.createElement('th', {
      style: {
        ...thStyle,
        textAlign: 'right'
      }
    }, 'Total JH'))), React.createElement('tbody', null,
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
      var famRows = [React.createElement('tr', {
        key: f,
        style: {
          background: i % 2 === 0 ? CBT_C.surface : CBT_C.surface2
        }
      }, React.createElement('td', {
        style: {
          ...tdStyle,
          fontWeight: 700
        }
      }, React.createElement('button', {
        onClick: function () {
          toggleFamille(f);
        },
        title: ops.length === 0 ? 'Aucune opération au référentiel' : isOpen ? 'Replier' : 'Déplier ' + ops.length + ' opérations',
        disabled: ops.length === 0,
        style: {
          border: 'none',
          background: 'transparent',
          cursor: ops.length === 0 ? 'default' : 'pointer',
          color: CBT_C.textSec,
          fontSize: 11,
          width: 20,
          padding: 0,
          marginRight: 4,
          opacity: ops.length === 0 ? 0.25 : 1
        }
      }, React.createElement('i', {
        className: 'fa-solid ' + (isOpen ? 'fa-chevron-down' : 'fa-chevron-right')
      })), icon && React.createElement('i', {
        className: 'fa-solid ' + icon,
        style: {
          color: CBT_C.berry,
          fontSize: 12,
          width: 18
        }
      }), f, ops.length > 0 && React.createElement('span', {
        style: {
          marginLeft: 8,
          fontSize: 11,
          fontWeight: 500,
          color: CBT_C.textTer
        }
      }, ops.length + ' op.'),
      // CAS MIXTE : la famille avait un total saisi ET porte
      // maintenant des opérations. Le total bascule sur les
      // opérations et la valeur de famille sera remplacée à
      // l'enregistrement. Badge TEXTE (pas un `title=` : illisible
      // au doigt, or la validation se fait au téléphone), portant
      // la valeur menacée — sans quoi elle a déjà disparu de
      // l'écran (la cellule affiche la somme des opérations).
      ecrase && React.createElement('span', {
        style: {
          display: 'inline-block',
          marginLeft: 8,
          padding: '1px 7px',
          borderRadius: 9,
          fontSize: 10.5,
          fontWeight: 700,
          background: '#fef3c7',
          color: CBT_C.amber,
          whiteSpace: 'nowrap'
        }
      }, React.createElement('i', {
        className: 'fa-solid fa-triangle-exclamation',
        style: {
          marginRight: 5
        }
      }), 'famille ' + CBT_num(values[f]) + ' → remplacée par les opérations')), React.createElement('td', {
        style: {
          ...tdStyle,
          textAlign: 'right'
        }
      },
      // Dès qu'une opération est budgétée, le total de famille
      // est CALCULÉ : le champ devient non éditable, sinon la
      // saisie laisserait croire à une addition des deux niveaux.
      canEdit && !calcule ? React.createElement('input', {
        type: 'number',
        min: 0,
        step: 0.1,
        value: values[f] == null ? '' : values[f],
        placeholder: '0',
        title: 'Budget de la famille, à défaut de détail par opération',
        onChange: function (e) {
          var v = e.target.value;
          setValues(function (prev) {
            var next = Object.assign({}, prev);
            next[f] = v;
            return next;
          });
        },
        style: inputStyle
      }) : React.createElement('span', {
        style: {
          fontFamily: 'monospace',
          fontWeight: 700
        },
        title: calcule ? 'Somme des opérations de la famille' : undefined
      }, tot.total > 0 ? tot.total.toFixed(2) : '—')), React.createElement('td', {
        style: {
          ...tdStyle,
          textAlign: 'right',
          fontFamily: 'monospace',
          fontWeight: 700,
          color: CBT_C.textSec
        }
      }, CBT_totalJH(tot.total, ha) > 0 ? CBT_totalJH(tot.total, ha).toFixed(2) : '—'))];
      if (isOpen) {
        ops.forEach(function (op) {
          var vOp = (opValues[f] || {})[op];
          var opInfo = CBT_splitOpKey(op);
          famRows.push(React.createElement('tr', {
            key: f + '||' + op,
            style: {
              background: CBT_C.surface
            }
          }, React.createElement('td', {
            style: {
              ...tdStyle,
              paddingLeft: 46,
              color: CBT_C.textSec
            }
          }, opInfo.operation,
          // CODE GB affiché : c'est LUI la clé du budget, et le même
          // libellé peut exister sous deux codes (« Nettoyage » =
          // GB05 Entretien structure ET GB11 Service générale). Sans
          // le code, deux lignes légitimes seraient indiscernables.
          opInfo.code && React.createElement('span', {
            style: {
              marginLeft: 8,
              padding: '1px 6px',
              borderRadius: 6,
              fontSize: 10,
              fontWeight: 700,
              fontFamily: 'monospace',
              background: CBT_C.surface2,
              color: CBT_C.textTer
            },
            title: 'Code référentiel BEE ONE — clé de rapprochement avec le réalisé'
          }, opInfo.code)), React.createElement('td', {
            style: {
              ...tdStyle,
              textAlign: 'right'
            }
          }, canEdit ? React.createElement('input', {
            type: 'number',
            min: 0,
            step: 0.1,
            value: vOp == null ? '' : vOp,
            placeholder: '0',
            onChange: function (e) {
              setOpValue(f, op, e.target.value);
            },
            style: inputStyle
          }) : React.createElement('span', {
            style: {
              fontFamily: 'monospace'
            }
          }, vOp ? vOp : '—')), React.createElement('td', {
            style: {
              ...tdStyle,
              textAlign: 'right',
              fontFamily: 'monospace',
              color: CBT_C.textTer
            }
          }, CBT_totalJH(vOp, ha) > 0 ? CBT_totalJH(vOp, ha).toFixed(2) : '—')));
        });
      }
      return famRows;
    })), React.createElement('tfoot', null, React.createElement('tr', null, React.createElement('td', {
      style: {
        ...tdStyle,
        fontWeight: 700
      }
    }, 'Total'), React.createElement('td', {
      style: {
        ...tdStyle,
        textAlign: 'right',
        fontWeight: 700,
        fontFamily: 'monospace'
      }
    }, totalJhHa > 0 ? totalJhHa.toFixed(2) : '—'), React.createElement('td', {
      style: {
        ...tdStyle,
        textAlign: 'right',
        fontWeight: 700,
        fontFamily: 'monospace'
      }
    }, totalJH > 0 ? totalJH.toFixed(2) : '—')))),
    // CONFIRMATION : le save étant global à la parcelle, une famille
    // repliée peut voir sa valeur de famille remplacée sans que rien ne
    // l'ait signalé à l'écran. On liste explicitement les familles
    // concernées AVANT d'écrire, avec la valeur perdue et son
    // remplacement.
    canEdit && confirmList && confirmList.length > 0 && React.createElement('div', {
      style: {
        padding: '12px 14px',
        borderTop: '1px solid ' + CBT_C.border,
        background: '#fffbeb',
        color: CBT_C.amber,
        fontSize: 12
      }
    }, React.createElement('div', {
      style: {
        fontWeight: 700,
        marginBottom: 6
      }
    }, React.createElement('i', {
      className: 'fa-solid fa-triangle-exclamation',
      style: {
        marginRight: 8
      }
    }), confirmList.length > 1 ? confirmList.length + ' valeurs de famille vont être remplacées par le détail' + ' de leurs opérations :' : 'Une valeur de famille va être remplacée par le détail de ses opérations :'), React.createElement('ul', {
      style: {
        margin: '0 0 10px',
        paddingLeft: 26
      }
    }, confirmList.map(function (n) {
      return React.createElement('li', {
        key: n.famille,
        style: {
          marginBottom: 2
        }
      }, n.famille + ' : ' + n.valeur + ' JH/Ha → ' + n.total + ' JH/Ha');
    })), React.createElement('div', {
      style: {
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap'
      }
    }, React.createElement('button', {
      onClick: function () {
        handleSave(true);
      },
      disabled: saving,
      style: {
        padding: '6px 16px',
        borderRadius: 8,
        border: 'none',
        background: CBT_C.amber,
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
        cursor: saving ? 'not-allowed' : 'pointer'
      }
    }, 'Confirmer et enregistrer'), React.createElement('button', {
      onClick: function () {
        setConfirmList(null);
      },
      style: {
        padding: '6px 16px',
        borderRadius: 8,
        border: '1px solid ' + CBT_C.border,
        background: CBT_C.surface,
        color: CBT_C.textSec,
        fontSize: 12,
        fontWeight: 700,
        cursor: 'pointer'
      }
    }, 'Annuler'))), React.createElement('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        borderTop: '1px solid ' + CBT_C.border,
        flexWrap: 'wrap'
      }
    }, canEdit && React.createElement('button', {
      onClick: function () {
        handleSave(false);
      },
      disabled: saving,
      style: {
        padding: '7px 18px',
        borderRadius: 8,
        border: 'none',
        background: CBT_C.green,
        color: '#fff',
        fontSize: 12,
        fontWeight: 700,
        cursor: saving ? 'not-allowed' : 'pointer',
        opacity: saving ? 0.6 : 1
      }
    }, saving ? 'Enregistrement…' : 'Enregistrer'),
    // Succès, succès-avec-purge, erreur : même niveau visuel (une ligne
    // à côté du bouton). La purge est un succès, mais elle SUPPRIME des
    // données : ambre + icône d'avertissement pour qu'elle se remarque.
    msg && React.createElement('span', {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: msg.type !== 'ok' ? '#dc2626' : msg.purge ? CBT_C.amber : CBT_C.green
      }
    }, React.createElement('i', {
      className: 'fa-solid ' + (msg.type !== 'ok' ? 'fa-circle-exclamation' : msg.purge ? 'fa-triangle-exclamation' : 'fa-circle-check'),
      style: {
        marginRight: 6
      }
    }), msg.text), React.createElement('span', {
      style: {
        fontSize: 11,
        color: CBT_C.textTer
      }
    }, canEdit ? 'Déplier une famille pour saisir ses opérations. Le total de famille' + ' devient calculé dès qu\'une opération est budgétée ; sinon il reste' + ' saisissable. Un champ vide (ou 0) supprime la ligne.' : 'Saisie réservée aux profils DG/RH.')))));
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
  CampagneBudgetTab.familleTotal = CBT_familleTotal;
  CampagneBudgetTab.famillesNeutralisees = CBT_famillesNeutralisees;
  CampagneBudgetTab.memeNeutralisations = CBT_memeNeutralisations;
  CampagneBudgetTab.totalJH = CBT_totalJH;
})();
