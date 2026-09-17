/*
 * campagneAnalytiqueHelpers.jsx — constantes, formats et agrégations PURS de
 * l'écran Campagne (CampagneAnalytiqueTab et ses vues) : couleurs, icônes de
 * famille, formats DH/JH/Ha, résolution culture / nom / surface d'une
 * parcelle, index des budgets, vue par variété, lignes du pivot, regroupement
 * par culture.
 *
 * Extrait de CampagneAnalytiqueTab.jsx (déplacement de code, sans modification).
 */

import * as CampagneExportUtils from '../shared/lib/campagneExportUtils.js';
import * as CultureUtils from '../shared/lib/cultureUtils.js';
import { sbParcelleHa } from '../agronomie/sbParcelleHa.jsx';
import { sbParcelleNom } from '../agronomie/sbParcelleNom.jsx';

/* ------------------------------------------------------------------ */
/* Palette                                                              */
/* ------------------------------------------------------------------ */
var C = {
  berry:    '#c0392b',
  green:    '#1D9E75',
  blue:     '#2563eb',
  gray:     '#888780',
  surface:  '#ffffff',
  surface2: '#f5f4ef',
  surface3: '#ebeae3',
  border:   'rgba(0,0,0,0.10)',
  text:     '#1c1c1a',
  textSec:  '#5f5e5a',
};

/* ------------------------------------------------------------------ */
/* Icônes familles (copié de ParcellesReferentielTab pour cohérence)   */
/* ------------------------------------------------------------------ */
var FAMILLE_ICONS = {
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

/**
 * Identité visuelle des cultures dans la vue Pivot analytique — MÊMES
 * couleurs et icônes que le panneau Affectation Analytique de l'écran
 * Quinzaine, pour qu'un utilisateur reconnaisse la même grille d'un écran à
 * l'autre.
 */
var CAT_CULTURES_DEF = [
  { culture: 'Framboise', color: '#8B2252', icon: 'fa-seedling' },
  { culture: 'Myrtille',  color: '#3498DB', icon: 'fa-circle-dot' },
  { culture: 'Avocatier', color: '#2D8B4E', icon: 'fa-tree' },
];

/** Titre du groupe quand la culture n'a PAS pu être résolue (cf. CAT_byCulture). */
var CAT_CULTURE_INCONNUE = 'Culture non résolue';

/* ------------------------------------------------------------------ */
/* Formatage                                                            */
/* ------------------------------------------------------------------ */
function fmtDH(v) {
  if (!v || v === 0) return '—';
  return Math.round(v).toLocaleString('fr-MA');
}

function fmtJH(v) {
  if (!v || v === 0) return '—';
  return (Math.round(v * 10) / 10).toLocaleString('fr-MA');
}

function fmtHa(v) {
  if (!v || v === 0) return '—';
  return parseFloat(v).toFixed(2);
}

/**
 * Superficie affichée en locale fr ('2,40 ha' / '—'). Même format que
 * l'en-tête des feuilles Excel (source unique : CampagneExportUtils.haLabel),
 * avec un repli local si le module n'est pas chargé. fmtHa est laissé
 * inchangé : il sert aussi aux colonnes Ha des tableaux.
 */
function fmtHaLabel(v) {
  var CEU = CampagneExportUtils;
  if (CEU && typeof CEU.haLabel === 'function') return CEU.haLabel(v);
  if (!v || v <= 0) return '—';
  return parseFloat(v).toFixed(2).replace('.', ',') + ' ha';
}

function fmtDHPerHa(cout, ha) {
  if (!ha || ha === 0 || !cout) return '—';
  return Math.round(cout / ha).toLocaleString('fr-MA');
}

function fmtQty(v) {
  if (!v || v === 0) return '—';
  return (Math.round(v * 100) / 100).toLocaleString('fr-MA');
}

/* ------------------------------------------------------------------ */
/* Culture / nom / superficie — référentiel Smart Berry                 */
/* ------------------------------------------------------------------ */

/**
 * Culture d'une parcelle depuis le référentiel SB (CultureUtils).
 * Renvoie null si le module n'est pas chargé (garde défensive : on ne
 * filtre alors rien plutôt que de vider l'écran).
 */
function cultureOf(label, sbMap) {
  var CU = CultureUtils;
  if (!CU || typeof CU.resolveCulture !== 'function') return null;
  return CU.resolveCulture({ label: label }, sbMap);
}

/** Prédicat du filtre Culture de l'écran ('Toutes' = pas de filtre). */
function matchCulture(label, cultureFilter, sbMap) {
  if (!cultureFilter || cultureFilter === 'Toutes') return true;
  var c = cultureOf(label, sbMap);
  if (c === null) return true;
  return c === cultureFilter;
}

/** Nom Smart Berry d'une parcelle, repli sur le libellé BEE ONE. */
function sbNom(label, sbMap) {
  if (typeof sbParcelleNom === 'function') {
    var n = sbParcelleNom(label);
    if (n && n !== '—' && n !== label) return n;
  }
  var key = String(label || '').toUpperCase().trim();
  var entry = sbMap && sbMap[key];
  if (entry && entry.nom_sb) return entry.nom_sb;
  return label || '—';
}

/** Superficie (ha) d'une parcelle : sbParcelleHa, puis sbMap, puis haByRef. */
function sbHa(label, sbMap, haByRef) {
  var key = String(label || '').toUpperCase().trim();
  var v = 0;
  if (typeof sbParcelleHa === 'function') v = sbParcelleHa(label) || 0;
  if (!v && sbMap && sbMap[key] && sbMap[key].ha > 0) v = sbMap[key].ha;
  if (!v && haByRef && haByRef[key] > 0) v = haByRef[key];
  return v || 0;
}

/**
 * Indexe la réponse de `campagne-budget-list` par libellé BEE ONE. PURE.
 *
 * Clé normalisée `trim().toUpperCase()` — la MÊME normalisation que sbMap /
 * sbHa / sbNom : c'est la jointure entre les budgets saisis et les libellés
 * BEE ONE des lignes de pointage. Une normalisation différente ici ferait
 * silencieusement rater tous les budgets (colonnes vides, sans erreur).
 *
 * @param {Array<{label_bee_one?: string, budgets?: Object}>} list
 * @returns {Object<string, Object<string, number>>} LABEL_MAJ → famille → JH/Ha
 */
function CAT_budgetsByLabel(list) {
  var out = {};
  (list || []).forEach(function (b) {
    var key = String((b && b.label_bee_one) || '').trim().toUpperCase();
    if (!key) return;
    out[key] = (b && b.budgets) || {};
  });
  return out;
}

/**
 * Idem pour les budgets PAR OPÉRATION (`budgets_operations`). PURE.
 *
 * Séparé de CAT_budgetsByLabel, comme côté saisie (CampagneBudgetTab) : un
 * document écrit avant la descente au niveau opération n'a pas ce champ et
 * doit rester lisible tel quel (→ map vide, aucune migration).
 *
 * @param {Array<{label_bee_one?: string, budgets_operations?: Object}>} list
 * @returns {Object<string, Object<string, Object<string, number>>>}
 *   LABEL_MAJ → famille → `CODE::Libellé` → JH/Ha
 */
function CAT_opBudgetsByLabel(list) {
  var out = {};
  (list || []).forEach(function (b) {
    var key = String((b && b.label_bee_one) || '').trim().toUpperCase();
    if (!key) return;
    out[key] = (b && b.budgets_operations) || {};
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers de calcul pivot                                              */
/* ------------------------------------------------------------------ */
// `buildHaView` (agrégation parcelle × famille de l'ancienne vue tabulaire)
// est SUPPRIMÉ : la vue « Affectation par Ha » est désormais rendue par la
// grille partagée (PivotView + AnalytiqueUtils.buildAnalytiquePivotByFamille),
// qui agrège la même chose. Aucun autre appelant (vérifié dans tout le repo).

function buildVarieteView(rows, parcelle, periodes) {
  var filtered = rows.filter(function (r) {
    return r.parcelle === parcelle || r.refParcelle === parcelle;
  });
  var byOp = {};
  for (var i = 0; i < filtered.length; i++) {
    var r = filtered[i];
    var key = r.famille + '||' + r.operation;
    if (!byOp[key]) {
      byOp[key] = {
        famille: r.famille,
        code: r.code,
        operation: r.operation,
        byPeriode: {},
        total: { jh: 0, cout: 0 },
      };
    }
    if (!byOp[key].byPeriode[r.periode]) byOp[key].byPeriode[r.periode] = { jh: 0, cout: 0 };
    byOp[key].byPeriode[r.periode].jh  += r.jh;
    byOp[key].byPeriode[r.periode].cout += r.cout;
    byOp[key].total.jh  += r.jh;
    byOp[key].total.cout += r.cout;
  }
  return Object.values(byOp).sort(function (a, b) {
    var fc = a.famille.localeCompare(b.famille);
    return fc !== 0 ? fc : a.operation.localeCompare(b.operation);
  });
}

/**
 * Mappe les lignes de `campagne-analytique-detail` vers la forme attendue par
 * AnalytiqueUtils.buildAnalytiquePivotByFamille. PURE (sbMap/haByRef injectés).
 *
 * Le seul écart entre les deux sources est le NOM des champs — les valeurs
 * (jh, cout) sont reprises telles quelles, sans recalcul :
 *   campagne-analytique-detail        →  AnalytiqueRow (shared/lib/analytiqueUtils.js)
 *   ────────────────────────────────     ──────────────────────────────────────────
 *   code    (ex. 'GB09')              →  operationGroupe   (code GB, clé du pivot)
 *   famille (libellé BEE ONE résolu)  →  operationFamille  (repli si code absent)
 *   operation                         →  operation         (lignes du mode Détail)
 *   parcelle || refParcelle           →  parcelle          (clé de colonne)
 *   —                                 →  ha  = sbHa(label, sbMap, haByRef)
 *
 * La clé de colonne reste le LIBELLÉ BEE ONE (pas le nom Smart Berry) : c'est
 * la clé de jointure du référentiel (sbHa/sbNom/culture), et l'affichage passe
 * par la prop `parcelleLabel` de la grille. `nbOuv` est conservé pour la
 * pop-up de détail.
 *
 * ⚠️ VENTILATION DIFFÉRENTE DE L'ANCIENNE VUE TABULAIRE (attendu, pas un bug).
 * `buildHaView` regroupait sur `refParcelle || parcelle`, cette grille sur
 * `parcelle || refParcelle`. Or plusieurs libellés culturaux partagent un même
 * Ref_parcelle en production — relevé exhaustivement sur la campagne
 * 2026-2027 (44 journées, 4 328 lignes de sql_mirror_pointage, 2026-08-13) :
 *   F5 → « CASCADE MYRTILLE S8-1 », « BREEZE MYRTILLE S8-2 »,
 *        « F5 CORINA myrtille S8-3 », « AVOCAT F5 »
 *   F2 → « F2 - HAAS », « F2 - ZUTANO »
 *   F4 → « F4 -HAAS », « F4 -FUERTE »
 * L'ancienne vue en faisait UNE ligne (« F5 » mélangeait donc trois parcelles
 * de myrtille ET l'avocatier, avec le Ha d'un seul libellé au dénominateur du
 * DH/Ha) ; la grille en fait autant de colonnes, chacune avec SON Ha et SA
 * culture. Les totaux généraux sont identiques, la ventilation est plus fine.
 * Aucun libellé ne porte deux Ref_parcelle (0 cas), donc rien n'est éclaté à
 * tort dans l'autre sens.
 *
 * Les filtres de l'écran sont appliqués ICI, en amont du pivot : filtrer après
 * coup laisserait des colonnes de parcelles vides dans la grille.
 *
 * @param {Array<Object>} rows            data.rows de campagne-analytique-detail
 * @param {Object} sbMap                  référentiel SB indexé LABEL_MAJ → entrée
 * @param {Object} haByRef                data.haByRef (repli Ha)
 * @param {{farmFilter?: string, cultureFilter?: string}} [opts]
 * @returns {Array<Object>} lignes prêtes pour buildAnalytiquePivotByFamille
 */
function CAT_pivotRows(rows, sbMap, haByRef, opts) {
  var farmFilter = (opts && opts.farmFilter) || null;
  var cultureFilter = (opts && opts.cultureFilter) || null;
  var out = [];
  (rows || []).forEach(function (r) {
    var label = r.parcelle || r.refParcelle;
    if (!label) return;
    if (farmFilter && r.ferme !== farmFilter) return;
    if (!matchCulture(label, cultureFilter, sbMap)) return;
    out.push({
      parcelle: label,
      ferme: r.ferme,
      ha: sbHa(label, sbMap, haByRef),
      jh: r.jh || 0,
      cout: r.cout || 0,
      coutCharge: r.coutCharge || 0,
      nbOuv: r.nbOuv || 0,
      // Quinzaine de la ligne : recopiée telle quelle, uniquement pour que la
      // moyenne mobile du « reste au rythme » (CampagneRythme) la retrouve
      // dans les `detailRows` des cellules. Le pivot ne s'en sert pas.
      periode: r.periode,
      operation: r.operation,
      operationGroupe: r.code,
      operationFamille: r.famille,
    });
  });
  return out;
}

/**
 * Regroupe les lignes mappées par culture (référentiel SB prioritaire, cf.
 * cultureOf). PURE. Retourne la liste ordonnée des cultures présentes avec
 * leurs lignes — l'ordre suit CAT_CULTURES_DEF, les cultures inconnues du
 * référentiel visuel sont ajoutées à la fin plutôt que perdues.
 *
 * ⚠️ Culture NON RÉSOLUE (module CultureUtils absent) → groupe explicite
 * `CAT_CULTURE_INCONNUE`, JAMAIS un repli sur 'Framboise' : une grille titrée
 * « Framboise » remplie de myrtilles est un mensonge silencieux, que personne
 * ne peut détecter en lisant l'écran. L'appelant (PivotView) intercepte le cas
 * en amont avec un message d'erreur ; ce groupe est la ceinture de sécurité
 * pour tout autre appelant.
 *
 * @param {Array<Object>} pivotRows
 * @param {Object} sbMap
 * @returns {Array<{culture: string, color: string, icon: string, rows: Array<Object>}>}
 */
function CAT_byCulture(pivotRows, sbMap) {
  var groups = {};
  (pivotRows || []).forEach(function (r) {
    var c = cultureOf(r.parcelle, sbMap) || CAT_CULTURE_INCONNUE;
    if (!groups[c]) groups[c] = [];
    groups[c].push(r);
  });
  var out = [];
  CAT_CULTURES_DEF.forEach(function (def) {
    if (groups[def.culture] && groups[def.culture].length) {
      out.push({ culture: def.culture, color: def.color, icon: def.icon, rows: groups[def.culture] });
    }
  });
  Object.keys(groups).forEach(function (c) {
    if (out.some(function (o) { return o.culture === c; })) return;
    out.push({ culture: c, color: C.gray, icon: 'fa-leaf', rows: groups[c] });
  });
  return out;
}

export { C, FAMILLE_ICONS, CAT_CULTURES_DEF, CAT_CULTURE_INCONNUE, fmtDH, fmtJH, fmtHa, fmtHaLabel, fmtDHPerHa, fmtQty, cultureOf, matchCulture, sbNom, sbHa, CAT_budgetsByLabel, CAT_opBudgetsByLabel, buildVarieteView, CAT_pivotRows, CAT_byCulture };
