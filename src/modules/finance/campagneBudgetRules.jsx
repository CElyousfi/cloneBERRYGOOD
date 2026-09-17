/*
 * campagneBudgetRules.jsx — règles et helpers PURS de l'écran Budget Campagne
 * (CampagneBudgetTab) : clés d'opération, familles, totaux, portées de saisie,
 * payloads d'enregistrement et de propagation (fan-out), messages.
 *
 * Extrait de CampagneBudgetTab.jsx (déplacement de code, sans modification) :
 * le composant les importe et les ré-expose en propriétés statiques pour les
 * tests (CampagneBudgetTab.buildSavePayload, …) et pour CampagneAnalytiqueTab
 * (`budgetRules`).
 */

import * as CultureUtils from '../shared/lib/cultureUtils.js';
import { sbParcelleHa } from '../agronomie/sbParcelleHa.jsx';
import { sbParcelleNom } from '../agronomie/sbParcelleNom.jsx';

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

/** Culture d'une parcelle — source de vérité partagée (shared/lib/cultureUtils.js). */
function cbtCulture(cultureField, labelFallback) {
  var CU = CultureUtils;
  if (CU && typeof CU.normCulture === 'function') return CU.normCulture(cultureField, labelFallback);
  return '';
}

/** Ha d'une parcelle — sbParcelleHa (référentiel SB puis campagne). */
function cbtHa(label) {
  return typeof sbParcelleHa === 'function' ? (sbParcelleHa(label) || 0) : 0;
}

/** Nom affiché d'une parcelle — sbParcelleNom (nom SB sinon label). */
function cbtNom(label) {
  return typeof sbParcelleNom === 'function' ? sbParcelleNom(label) : (label || '—');
}

/** Séparateur de la clé persistée `CODE::Libellé` — miroir du backend. */
var CBT_OP_KEY_SEP = '::';

/** Forme d'un code de groupe BEE ONE ('GB05', 'LB03'). */
var CBT_CODE_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Clé canonique d'une opération : `CODE::Libellé`. PURE.
 *
 * Miroir exact de `opKey` de functions/lib/campagneBudget/validate.js (le
 * backend ne peut pas requérir src/ — cf. CLAUDE.md) ; un corpus partagé
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
 * même clé que SB_PARCELLE_REF. PURE.
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
 * (le backend ne peut pas requérir src/ — cf. CLAUDE.md).
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
 * REPLI : `shared/lib/cultureUtils.js` est chargé en <script> séparé —
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
  var CU = CultureUtils;
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
 * `SB_PARCELLE_REF`) : une parcelle listée deux fois ne compte qu'une.
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
 * Valeurs qui vont être ÉCRASÉES, parcelle par parcelle, par un fan-out. PURE.
 *
 * Compare l'ENREGISTRÉ au payload RÉELLEMENT construit — jamais à la saisie
 * brute (même discipline que `CBT_memeNeutralisations`) : ce qui est annoncé
 * doit être ce qui part sur le réseau, sinon la confirmation ment.
 *
 * Une valeur absente (ou 0) en base n'est PAS un écrasement : c'est une
 * création. Seules les valeurs existantes qui changent — y compris celles qui
 * passent à 0, donc supprimées — sont comptées.
 *
 * @param {Object} args
 * @param {Array<string>} args.labels parcelles cibles (labels bruts).
 * @param {{budgets?: Object, budgets_operations?: Object}} args.payload body
 *   construit par CBT_buildFanoutPayload.
 * @param {Object<string, Object<string, *>>} [args.budgetsByLabel] indexé en
 *   MAJUSCULES.
 * @param {Object<string, Object<string, Object<string, *>>>}
 *   [args.opBudgetsByLabel] indexé en MAJUSCULES.
 * @returns {Array<{label: string, nb: number, exemples: Array<{champ: string,
 *   avant: number, apres: number}>}>} uniquement les parcelles porteuses d'au
 *   moins un écrasement, dans l'ordre des labels. 3 exemples au plus.
 */
function CBT_fanoutEcrasements(args) {
  var a = args || {};
  var payload = a.payload || {};
  var budgets = payload.budgets || {};
  var ops = payload.budgets_operations || {};
  var byLabel = a.budgetsByLabel || {};
  var opsByLabel = a.opBudgetsByLabel || {};
  var out = [];
  (a.labels || []).forEach(function (label) {
    var key = String(label == null ? '' : label).trim().toUpperCase();
    if (!key) return;
    var avantFam = byLabel[key] || {};
    var avantOps = opsByLabel[key] || {};
    var nb = 0;
    var exemples = [];
    function ajoute(champ, avant, apres) {
      if (!(avant > 0)) return;
      if (avant === apres) return;
      nb += 1;
      if (exemples.length < 3) exemples.push({ champ: champ, avant: avant, apres: apres });
    }
    Object.keys(budgets).forEach(function (f) {
      ajoute(f, CBT_num(avantFam[f]), CBT_num(budgets[f]));
    });
    Object.keys(ops).forEach(function (f) {
      var famAvant = avantOps[f] || {};
      Object.keys(ops[f] || {}).forEach(function (op) {
        ajoute(f + ' — ' + CBT_operationLabel(op), CBT_num(famAvant[op]), CBT_num(ops[f][op]));
      });
    });
    if (nb > 0) out.push({ label: label, nb: nb, exemples: exemples });
  });
  return out;
}

/**
 * SIGNATURE du body d'un fan-out : ce qui part, exactement. PURE.
 *
 * C'est le juge de « ce qui a été confirmé est-il ce qui va être écrit ». Il
 * remplace toute heuristique de « ce qui a assez changé » : au lieu de choisir
 * quels aspects comparer — et de se tromper — on compare le payload lui-même.
 * Deux trous réels sont ainsi fermés : une VALEUR corrigée entre la
 * confirmation et le clic sans que le nombre d'écrasements bouge (le panneau
 * affichait alors un chiffre faux au moment du clic), et une FAMILLE
 * supplémentaire touchée entre les deux, absente de la confirmation validée.
 *
 * Clés TRIÉES à tous les niveaux : un `JSON.stringify` brut dépend de l'ordre
 * d'insertion des clés, donc refuserait des payloads identiques (faux refus).
 * Les labels sont normalisés et triés : la cible fait partie de ce qu'on
 * confirme.
 *
 * @param {{labels?: Array<string>, budgets?: Object<string, *>,
 *   budgets_operations?: Object<string, Object<string, *>>}|null|undefined}
 *   payload body construit par CBT_buildFanoutPayload.
 * @returns {string}
 */
function CBT_signatureFanout(payload) {
  var p = payload || {};
  var budgets = p.budgets || {};
  var ops = p.budgets_operations || {};
  var labels = (Array.isArray(p.labels) ? p.labels : [])
    .map(function (l) { return String(l == null ? '' : l).trim().toUpperCase(); })
    .sort()
    .join('|');
  var fam = Object.keys(budgets).sort().map(function (f) {
    return f + '=' + CBT_num(budgets[f]);
  }).join(',');
  var parOp = Object.keys(ops).sort().map(function (f) {
    var famOps = ops[f] || {};
    return f + '{' + Object.keys(famOps).sort().map(function (op) {
      return op + '=' + CBT_num(famOps[op]);
    }).join(',') + '}';
  }).join(',');
  return labels + '§' + fam + '§' + parOp;
}

/**
 * Deux périmètres de fan-out décrivent-ils le même EFFET ANNONCÉ ? PURE.
 *
 * Complément de `CBT_signatureFanout`, pas un substitut : la signature juge ce
 * qui PART, celui-ci juge ce qui a été AFFICHÉ. Il attrape le cas où le payload
 * n'a pas bougé mais où la base a été rechargée entre-temps — les écrasements
 * annoncés ne décrivent alors plus la réalité.
 *
 * ⚠️ NE JAMAIS s'en servir seul : il ne compare que le NOMBRE de valeurs
 * écrasées par parcelle, pas les valeurs (c'est précisément le trou qui a
 * justifié l'introduction de la signature).
 *
 * @param {Array<{label?: *, nb?: *}>|null|undefined} a
 * @param {Array<{label?: *, nb?: *}>|null|undefined} b
 * @returns {boolean}
 */
function CBT_memeFanout(a, b) {
  function cle(list) {
    return (Array.isArray(list) ? list : [])
      .map(function (e) {
        if (!e || typeof e !== 'object') return '';
        return String(e.label) + '|' + CBT_num(e.nb);
      })
      .sort()
      .join('§');
  }
  return cle(a) === cle(b);
}

/**
 * Message de retour d'un enregistrement en portée MULTIPLE. PURE.
 *
 * RÈGLES, dans cet ordre :
 *   1. `results` absent alors qu'on a demandé plusieurs parcelles → JAMAIS
 *      vert. C'est la signature du skew de déploiement (les functions partent
 *      avant le hosting) : un backend antérieur ignore `labels` et n'écrit
 *      qu'UNE parcelle. On ne sait pas ce qui a été écrit, on le dit.
 *   2. Au moins un échec → `type:'ko'`. Un succès PARTIEL n'est jamais vert :
 *      18/23 enregistrées, c'est 5 parcelles dont le budget est faux.
 *   3. Tout OK avec effets de bord (purges, neutralisations) → succès `purge`
 *      (ambre), noms tronqués à 3 + « et N autres » pour rester lisible sur un
 *      téléphone.
 *
 * @param {{results?: Array<Object>, echecs?: Array<Object>}|null|undefined} res
 *   réponse de `campagne-budget-save`.
 * @param {number} nbDemandes nombre de parcelles cibles demandées.
 * @param {function(string): string} [nomOf] nom affichable d'une parcelle
 *   (INJECTÉ — `cbtNom` au call site) ; identité par défaut.
 * @returns {{type: string, text: string, purge?: boolean}}
 */
function CBT_fanoutMessage(res, nbDemandes, nomOf) {
  var n = CBT_num(nbDemandes) > 0 ? CBT_num(nbDemandes) : 1;
  var nom = typeof nomOf === 'function' ? nomOf : function (l) { return String(l); };
  function liste(labels) {
    var reste = labels.length - 3;
    return labels.slice(0, 3).map(nom).join(', ')
      + (reste > 0 ? ' et ' + reste + (reste > 1 ? ' autres' : ' autre') : '');
  }
  var results = Array.isArray(res && res.results) ? res.results : null;
  if (!results) {
    // Réponse d'un backend qui ne connaît pas `labels` : il a écrit UNE
    // parcelle (celle de `label_bee_one`) et n'a rien dit des autres.
    // Une seule cible demandée → cette parcelle EST la bonne : le message
    // historique est exact, prétendre le contraire serait un faux négatif.
    if (n <= 1) return CBT_saveMessage(res);
    return {
      type: 'ko',
      text: 'Le serveur n\'a pas traité les ' + n + ' parcelles (version antérieure)'
        + ' — une seule a été enregistrée. Rafraîchir avant de réessayer.',
    };
  }
  var oks = results.filter(function (r) { return r && r.ok; });
  var kos = results.filter(function (r) { return !(r && r.ok); });
  if (kos.length > 0) {
    return {
      type: 'ko',
      text: oks.length + '/' + n + ' parcelles enregistrées — ' + kos.length + ' en échec : '
        + liste(kos.map(function (r) { return String((r && r.label_bee_one) || '?'); }))
        + '. Rafraîchir avant de réessayer.',
    };
  }
  var base = 'Budget enregistré sur ' + oks.length
    + (oks.length > 1 ? ' parcelles' : ' parcelle');
  // Effets de bord agrégés : chaque parcelle a son propre rapport serveur, et
  // une suppression de données ne doit jamais passer inaperçue — même diluée
  // dans 23 succès.
  var avecNeutralisation = [];
  var avecPurge = [];
  oks.forEach(function (r) {
    var lbl = String((r && r.label_bee_one) || '');
    var neutr = Array.isArray(r.familles_neutralisees) ? r.familles_neutralisees : [];
    if (neutr.length > 0) avecNeutralisation.push(lbl);
    var purges = (Array.isArray(r.familles_purgees) ? r.familles_purgees.length : 0)
      + (Array.isArray(r.operations_purgees) ? r.operations_purgees.length : 0)
      + (Array.isArray(r.quinzaines_purgees) ? r.quinzaines_purgees.length : 0)
      + (Array.isArray(r.quinzaines_supprimees) ? r.quinzaines_supprimees.length : 0)
      + CBT_num(r.purge_differee);
    if (purges > 0) avecPurge.push(lbl);
  });
  if (avecNeutralisation.length === 0 && avecPurge.length === 0) {
    return { type: 'ok', text: base };
  }
  var parts = [];
  if (avecNeutralisation.length > 0) {
    parts.push('valeur de famille remplacée par le détail des opérations sur '
      + avecNeutralisation.length + ' parcelle'
      + (avecNeutralisation.length > 1 ? 's' : '') + ' : ' + liste(avecNeutralisation));
  }
  if (avecPurge.length > 0) {
    parts.push('entrées obsolètes retirées sur ' + avecPurge.length + ' parcelle'
      + (avecPurge.length > 1 ? 's' : '') + ' : ' + liste(avecPurge));
  }
  return { type: 'ok', purge: true, text: base + ' — ' + parts.join(' ; ') };
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

export { CBT_C, CBT_FAMILLE_ICONS, CULTURE_COLORS, cbtCulture, cbtHa, cbtNom, CBT_OP_KEY_SEP, CBT_CODE_RE, CBT_opKey, CBT_splitOpKey, CBT_familleDuCode, CBT_operationLabel, CBT_famillesFromOps, CBT_opsByFamille, CBT_budgetsByLabel, CBT_operationsByLabel, CBT_num, CBT_familleTotal, CBT_famillesNeutralisees, CBT_memeNeutralisations, CBT_CULTURES_QUINZAINE, CBT_quinzaineApplicable, CBT_CULTURES_MASQUEES, CBT_cultureRow, CBT_parcelleAffichable, CBT_VAR_KEY_SEP, CBT_PORTEES, CBT_normVariete, CBT_varieteKey, CBT_porteeOptions, CBT_targetLabels, CBT_accordValeurs, CBT_valeursCommunes, CBT_surfaceCible, CBT_quinzainesSupprimees, CBT_buildSavePayload, CBT_buildFanoutPayload, CBT_saveMessage, CBT_fanoutEcrasements, CBT_signatureFanout, CBT_memeFanout, CBT_fanoutMessage, CBT_totalJH, CBT_CultureBadge };
