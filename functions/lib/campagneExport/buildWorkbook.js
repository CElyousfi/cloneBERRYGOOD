/**
 * buildWorkbook.js — Description PURE du classeur Excel « Campagne » d'une
 * culture : une feuille « Synthèse » + une feuille par parcelle.
 *
 * Port serveur de `buildCultureWorkbook` (public/components/CampagneAnalytiqueTab.jsx).
 * Même entrée (le payload de l'action `campagne-analytique-detail`), mêmes
 * helpers de lignes (campagneExportUtils), donc MÊME contenu que le fichier
 * produit par le navigateur. Seules deux choses changent, par nécessité :
 *   - aucune globale `window.*` : le référentiel parcelle (`sbMap`) et les
 *     budgets sont TOUJOURS injectés en paramètre (même discipline que
 *     CultureUtils.resolveCulture) ;
 *   - la date du nom de fichier est injectable, pour des tests déterministes.
 *
 * Aucune dépendance Firestore / réseau / ExcelJS ici : ce module ne décrit que
 * des DONNÉES. Le rendu stylé vit dans renderXlsx.js.
 */
// @ts-check
'use strict';

const CEU = require('./campagneExportUtils');
const CU = require('./cultureUtils');
// Référentiel analytique (code GB + libellé normalisé) : copie backend, c'est
// la jointure entre les budgets saisis et les lignes de l'export.
const AU = require('./analytiqueUtils');
// RÈGLE MÉTIER du budget — SOURCE DE VÉRITÉ backend. `window.CampagneBudgetTab`
// (que le navigateur injecte) en est le miroir front, l'équivalence des deux
// implémentations étant verrouillée par tests/unit/campagneBudgetTab.test.js
// (familleTotal, opKey, splitOpKey sur corpus partagé).
const BUDGET_RULES = require('../campagneBudget/validate');

/**
 * Clé de jointure du référentiel Smart Berry : libellé BEE ONE en MAJUSCULES,
 * trimé. EXACTEMENT la normalisation du front (sbMap / sbHa / sbNom) et du
 * backend (`haByRef`) — toute autre normalisation ferait silencieusement rater
 * la jointure (colonnes vides, sans erreur).
 * @param {*} label
 * @returns {string}
 */
function refKey(label) {
  return String(label == null ? '' : label).toUpperCase().trim();
}

/**
 * Culture d'une parcelle depuis le référentiel Smart Berry, repli heuristique.
 * @param {*} label libellé BEE ONE
 * @param {*} [sbMap] référentiel { LABEL: { culture_sb, nom_sb, ha } }
 * @returns {string}
 */
function cultureOf(label, sbMap) {
  return CU.resolveCulture({ label: label }, sbMap);
}

/**
 * Nom Smart Berry d'une parcelle, repli sur le libellé BEE ONE.
 *
 * Écart de FORME avec le front, sans écart de FOND : l'écran interroge d'abord
 * `window.sbParcelleNom`, qui lit `window.SB_PARCELLE_REF` — alimenté par
 * l'action `sb-referentiel-list`, donc par la MÊME collection
 * `sb_parcelle_referentiel` que le `sbMap` injecté ici, avec la même clé
 * (`toUpperCase().trim()`) et le même champ (`nom_sb`). Les deux chemins
 * convergent ; cf. sbHa, qui aligne de la même façon la superficie.
 *
 * @param {*} label
 * @param {*} [sbMap]
 * @returns {string}
 */
function sbNom(label, sbMap) {
  const entry = sbMap && sbMap[refKey(label)];
  if (entry && entry.nom_sb) return String(entry.nom_sb);
  return label ? String(label) : '—';
}

/**
 * Superficie (ha) d'une parcelle. 0 si inconnue — les helpers d'export laissent
 * alors les colonnes « / Ha » ET les 4 colonnes budgétaires vides (jamais
 * d'Infinity/NaN).
 *
 * TROIS NIVEAUX, ALIGNÉS SUR LE NAVIGATEUR (`window.sbParcelleHa`,
 * public/app.jsx ~L545) — c'est le « point ouvert » que la PR #251 laissait :
 *   1. `SB_PARCELLE_REF[key].ha`, le référentiel Smart Berry — ici `sbMap.ha`,
 *      puis `haByRef` du payload, qui est la MÊME donnée
 *      (`sb_parcelle_referentiel.ha`) vue par l'autre bout ;
 *   2. `SB_PARCELLE_CAMPAGNE[key]`, la surface BEE ONE — ici `supByLabel`,
 *      alimenté par `fetchBrParcelleSupMap()` (BR_Parcelle.Sup_Parcelle_Culturale),
 *      qui est EXACTEMENT la source du `sup` que l'action
 *      `parcelles-campagne-list` renvoie à l'écran ;
 *   3. 0.
 *
 * Sans le niveau 2, une parcelle sans `ha` saisi dans le référentiel SB mais
 * connue de BEE ONE avait une superficie à l'écran et 0 dans le fichier
 * serveur — et avec elle la colonne « / Ha » et les 4 colonnes budgétaires.
 * Aucun arbitrage produit n'a été inventé ici : on reprend l'ORDRE de priorité
 * déjà en vigueur côté navigateur, référentiel SB d'abord.
 *
 * @param {*} label
 * @param {*} [sbMap]
 * @param {*} [haByRef]
 * @param {*} [supByLabel] surfaces BEE ONE { LABEL: ha }, clés déjà normalisées
 * @returns {number}
 */
function sbHa(label, sbMap, haByRef, supByLabel) {
  const key = refKey(label);
  let v = 0;
  if (sbMap && sbMap[key] && Number(sbMap[key].ha) > 0) v = Number(sbMap[key].ha);
  if (!v && haByRef && Number(haByRef[key]) > 0) v = Number(haByRef[key]);
  if (!v && supByLabel && Number(supByLabel[key]) > 0) v = Number(supByLabel[key]);
  return v || 0;
}

/**
 * Pivot « par variété » d'une parcelle : une ligne par (famille, opération),
 * ventilée par quinzaine. Port EXACT de `buildVarieteView`
 * (CampagneAnalytiqueTab.jsx) — même clé de regroupement, même tri.
 *
 * @param {Array<*>} rows      lignes du payload campagne-analytique-detail
 * @param {*} parcelle         libellé BEE ONE (ou Ref_parcelle) de la parcelle
 * @returns {Array<{famille:string, code:string, operation:string,
 *   byPeriode:Object<string,{jh:number,cout:number}>, total:{jh:number,cout:number}}>}
 */
function buildVarieteView(rows, parcelle) {
  const filtered = (rows || []).filter(function (r) {
    return r && (r.parcelle === parcelle || r.refParcelle === parcelle);
  });
  const byOp = {};
  filtered.forEach(function (r) {
    const key = r.famille + '||' + r.operation;
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
    byOp[key].byPeriode[r.periode].jh += r.jh || 0;
    byOp[key].byPeriode[r.periode].cout += r.cout || 0;
    byOp[key].total.jh += r.jh || 0;
    byOp[key].total.cout += r.cout || 0;
  });
  return Object.keys(byOp).map(function (k) { return byOp[k]; }).sort(function (a, b) {
    const fc = String(a.famille || '').localeCompare(String(b.famille || ''));
    return fc !== 0 ? fc : String(a.operation || '').localeCompare(String(b.operation || ''));
  });
}

/**
 * Construit la description du classeur d'une culture.
 *
 * @param {*} params
 *   - `culture` : 'Framboise' | 'Myrtille' | 'Avocatier' (obligatoire) ;
 *   - `data` : payload `campagne-analytique-detail`
 *     ({ campagne, periodes, famillesOrdered, haByRef, rows }) ;
 *   - `fermeFilter` : périmètre du profil appelant, ou null (toutes fermes).
 *     ⚠️ Le payload `data` est DÉJÀ filtré côté serveur ; ce filtre est une
 *     défense en profondeur, identique au `farmFilter` de l'écran ;
 *   - `sbMap` : référentiel Smart Berry { LABEL: { nom_sb, culture_sb, ha } } ;
 *   - `budgetsByLabel` : { LABEL: { famille: JH/Ha } } — niveau FAMILLE ;
 *   - `opBudgetsByLabel` : { LABEL: { famille: { 'CODE::Libellé': JH/Ha } } } —
 *     niveau OPÉRATION. Sans lui, une parcelle budgétée à cette seule maille
 *     sort ses 4 colonnes de budget VIDES alors que l'écran les remplit ;
 *   - `supByLabel` : surfaces BEE ONE { LABEL: ha } — 2ᵉ niveau de résolution
 *     de la superficie, celui du navigateur (cf. sbHa). Absent → une parcelle
 *     sans `ha` au référentiel SB sort à 0 et perd la colonne « / Ha » ET ses
 *     4 colonnes budgétaires ;
 *   - `budgetRules` / `analytique` : injections de test uniquement — par défaut
 *     la règle métier backend et la copie backend d'AnalytiqueUtils ;
 *   - `today` : Date du nom de fichier (défaut : maintenant).
 * @returns {{fileName:string, sheets:Array<{name:string,
 *   rows:Array<{kind:string,cells:Array<*>}>, aoa:Array<Array<*>>,
 *   cols:Array<{wch:number}>}>}}
 */
function buildCultureWorkbook(params) {
  const p = params || {};
  const culture = p.culture;
  const data = p.data || {};
  const fermeFilter = p.fermeFilter || null;
  const sbMap = p.sbMap || {};
  const budgets = p.budgetsByLabel || {};
  const opBudgets = p.opBudgetsByLabel || {};
  const supByLabel = p.supByLabel || {};
  // Injectables pour les tests ; en production ce sont TOUJOURS les modules
  // backend (le navigateur, lui, injecte ses miroirs front).
  const budgetRules = p.budgetRules || BUDGET_RULES;
  const analytique = p.analytique || AU;
  const rows = data.rows || [];
  const periodes = data.periodes || [];
  const haByRef = data.haByRef || {};

  // Parcelles de la culture (distinctes, ordre alphabétique du nom SB)
  const seen = {};
  const labels = [];
  rows.forEach(function (r) {
    const label = (r && (r.parcelle || r.refParcelle)) || '';
    if (!label || seen[label]) return;
    if (fermeFilter && r.ferme !== fermeFilter) return;
    if (cultureOf(label, sbMap) !== culture) return;
    seen[label] = { ferme: r.ferme };
    labels.push(label);
  });
  labels.sort(function (a, b) {
    return sbNom(a, sbMap).localeCompare(sbNom(b, sbMap));
  });

  const synthese = [];
  const sheets = [];
  // Dictionnaire de noms de feuille PARTAGÉ : la Synthèse réserve son nom en
  // premier, sinon une parcelle nommée « Synthèse » produirait un doublon de
  // nom de feuille (classeur invalide).
  const used = {};
  const syntheseName = CEU.safeSheetName('Synthèse', 0, used);

  labels.forEach(function (label, i) {
    const opRows = buildVarieteView(rows, label);
    let totalJh = 0;
    // JH par famille : le suivi budgétaire compare à PÉRIMÈTRE ÉGAL — sans ce
    // détail, la Synthèse imputerait au budget les JH de familles non
    // budgétées (dépassement fantôme).
    const jhByFamille = {};
    opRows.forEach(function (r) {
      totalJh += r.total.jh;
      if (!r.famille) return;
      jhByFamille[r.famille] = (jhByFamille[r.famille] || 0) + (r.total.jh || 0);
    });
    const ha = sbHa(label, sbMap, haByRef, supByLabel);
    const nom = sbNom(label, sbMap);
    // Budgets JH/Ha de la parcelle : jointure sur le libellé BEE ONE normalisé,
    // EXACTEMENT comme sbMap/sbHa (trim + majuscules) — toute autre
    // normalisation ferait silencieusement rater la jointure.
    const budParcelle = budgets[refKey(label)] || {};
    // Détail par opération : MÊME clé, même normalisation — une divergence ici
    // ne lève rien, elle vide simplement les colonnes.
    const opBudParcelle = opBudgets[refKey(label)] || {};
    const sheetParams = {
      nomSb: nom,
      ha: ha,
      culture: culture,
      campagne: data.campagne || '',
      periodes: periodes,
      opRows: opRows,
      famillesOrdered: data.famillesOrdered || [],
      budgets: budParcelle,
      budgetsOperations: opBudParcelle,
      budgetRules: budgetRules,
      analytique: analytique,
    };
    // La Synthèse reçoit les budgets EFFECTIFS par famille (règle
    // `familleTotal` appliquée), pas la saisie brute : sinon une parcelle
    // budgétée à la maille opération sortirait remplie sur sa feuille et vide
    // sur la Synthèse.
    const budgetIndex = CEU.buildParcelleBudgetIndex({
      budgets: budParcelle,
      budgetsOperations: opBudParcelle,
      budgetRules: budgetRules,
      analytique: analytique,
    });
    synthese.push({
      nomSb: nom,
      label: label,
      ferme: seen[label].ferme,
      ha: ha,
      totalJh: totalJh,
      budgets: budgetIndex.resolveFamilles(opRows, sheetParams.famillesOrdered).scope,
      jhByFamille: jhByFamille,
    });
    sheets.push({
      name: CEU.safeSheetName(nom, i + 1, used),
      rows: CEU.buildParcelleSheetRows(sheetParams),
      aoa: CEU.buildParcelleSheetAoA(sheetParams),
      cols: CEU.parcelleSheetCols(periodes.length),
    });
  });

  const day = (p.today instanceof Date ? p.today : new Date()).toISOString().slice(0, 10);
  return {
    fileName: 'Campagne_' + culture + '_' + day,
    sheets: [{
      name: syntheseName,
      rows: CEU.buildSyntheseRows(synthese),
      aoa: CEU.buildSyntheseAoA(synthese),
      cols: CEU.syntheseSheetCols(),
    }].concat(sheets),
  };
}

module.exports = {
  refKey,
  cultureOf,
  sbNom,
  sbHa,
  buildVarieteView,
  buildCultureWorkbook,
};
