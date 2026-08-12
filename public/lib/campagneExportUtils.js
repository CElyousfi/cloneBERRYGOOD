/**
 * campagneExportUtils.js — Pure helpers de construction de l'export Excel de
 * l'écran Campagne analytique (une feuille de synthèse + une feuille par parcelle).
 *
 * Loaded twice (UMD-bricolé) :
 *   - Browser : <script src="lib/campagneExportUtils.js"> → window.CampagneExportUtils
 *   - node:test : require('.../campagneExportUtils.js') → module.exports
 *
 * Ces helpers ne font QUE décrire les DONNÉES (lignes typées, AoA, largeurs de
 * colonnes, noms de feuille) : aucune dépendance à SheetJS/ExcelJS, au DOM ou au
 * réseau. L'écriture du classeur reste dans le composant.
 *
 * L'export ne contient QUE des journées-homme (JH) — décision produit : les
 * coûts DH restent à l'écran (toggle JH / Coût DH), pas dans le fichier.
 *
 * DEUX RENDUS, UNE SEULE SOURCE DE DONNÉES :
 *   - `build*Rows` → lignes typées (`ROW_KIND`) : consommées par le rendu
 *     ExcelJS (chargé paresseusement au clic), qui applique gras, couleurs,
 *     bordures et volets figés ;
 *   - `build*AoA`  → les MÊMES lignes aplaties : rendu de repli SheetJS (déjà
 *     chargé) puis CSV. Vérifié sur le build CDN xlsx-0.20.3 (community) en
 *     relisant sheet1.xml : `!cols` est écrit, mais `!freeze`/`!panes` et les
 *     styles de cellule sont IGNORÉS — d'où la bascule du rendu sur ExcelJS.
 *
 * IMPORTANT (mémoire #75 — collision global a déjà cassé l'app) : ce module
 * n'expose QU'UN SEUL global (`window.CampagneExportUtils`). Les const internes
 * sont préfixées `__cexp_` pour éviter toute collision dans le scope global
 * partagé par les <script> non-modulaires.
 */
// @ts-check
'use strict';

// ============================================================================
// CONSTANTS (préfixe interne unique __cexp_ — jamais exposées au global)
// ============================================================================

/** Excel plafonne les noms de feuille à 31 caractères. */
const __cexp_SHEET_MAX = 31;

/** Caractères interdits par Excel dans un nom de feuille : : \ / ? * [ ] */
const __cexp_SHEET_FORBIDDEN = /[:\\/?*[\]]/g;

/**
 * Libellé de la colonne de pourcentage. Exporté : le moteur de rendu retrouve
 * la (ou les) colonne(s) de % par leur EN-TÊTE et non par un index en dur, qui
 * se décalerait au prochain ajout de colonne.
 */
const __cexp_PERCENT_HEADER = '% Consommé';

/**
 * En-tête des 4 colonnes de suivi budgétaire, communes aux deux feuilles.
 * Elles ne sont renseignées QUE sur les lignes qui portent un budget :
 * TOTAL_FAMILLE / TOTAL_GENERAL (feuille parcelle) et DATA / TOTAL_GENERAL
 * (feuille Synthèse). Le budget est saisi par parcelle × famille : il n'existe
 * pas à la maille opération, ces cellules y restent donc vides.
 */
const __cexp_BUDGET_HEADER = [
  'Budget par Ha',
  __cexp_PERCENT_HEADER,   // source unique du libellé (repéré par le renderer)
  'JH par Ha restant',
  'Total JH Restant',
];

/** En-tête de la feuille « Synthèse » (JH uniquement, aucune colonne DH). */
const __cexp_SYNTHESE_HEADER = [
  'Parcelle',
  'Libellé BEE ONE',
  'Ferme',
  'Superficie (ha)',
  'Total JH',
  'Total JH / Ha',
].concat(__cexp_BUDGET_HEADER);

/** Indentation des opérations sous leur famille (rendu AoA/SheetJS). */
const __cexp_INDENT = '    ';

/**
 * Nature d'une ligne de feuille. C'est le CONTRAT entre les helpers purs (qui
 * décrivent la structure) et le moteur de rendu (qui décide du style) : aucun
 * renderer ne doit re-deviner le rôle d'une ligne d'après son texte.
 */
const ROW_KIND = {
  META: 'meta',                   // « Parcelle : » / valeur
  BLANK: 'blank',                 // séparateur
  COL_HEADER: 'col-header',       // bandeau d'en-tête de colonnes
  FAMILLE: 'famille',             // titre de famille
  OPERATION: 'operation',         // ligne d'opération (indentée au rendu)
  TOTAL_FAMILLE: 'total-famille',
  TOTAL_GENERAL: 'total-general',
  DATA: 'data',                   // ligne de données (feuille Synthèse)
  NOTE: 'note',                   // mention de périmètre sous le tableau
};

/** Largeurs de colonnes (unité `wch` de SheetJS ≈ nombre de caractères). */
const __cexp_WCH = {
  libelle: 42,   // colonne A des feuilles parcelle : « Famille / Opération »
  periode: 14,
  total: 12,
  parcelle: 32,  // feuille Synthèse
  ferme: 10,
  ha: 14,
  jhPerHa: 14,   // colonne « Total JH / Ha »
  budgetHa: 14,  // « Budget par Ha »
  pct: 13,       // « % Consommé »
  jhHaRest: 17,  // « JH par Ha restant »
  jhRest: 16,    // « Total JH Restant »
};

/** Largeurs des 4 colonnes de suivi budgétaire, dans l'ordre de l'en-tête. */
function __cexp_budgetCols() {
  return [
    { wch: __cexp_WCH.budgetHa },
    { wch: __cexp_WCH.pct },
    { wch: __cexp_WCH.jhHaRest },
    { wch: __cexp_WCH.jhRest },
  ];
}

// ============================================================================
// INTERNES
// ============================================================================

/**
 * Arrondi 2 décimales, en gardant un NOMBRE (pas de chaîne formatée) et en
 * renvoyant '' pour 0 / valeur non numérique → cellule vide dans Excel.
 * @param {*} v
 * @returns {number|string}
 */
function __cexp_num(v) {
  const n = Number(v);
  if (!n || !isFinite(n)) return '';
  return Math.round(n * 100) / 100;
}

/**
 * Ratio « JH / Ha » d'une ligne : JH ÷ superficie, arrondi 2 décimales, NOMBRE
 * brut (jamais une chaîne formatée). Renvoie '' — cellule vide — dès que le
 * calcul n'a pas de sens : superficie inconnue, nulle ou négative (jamais de
 * division par zéro → ni Infinity ni NaN dans le fichier), JH nuls ou non
 * numériques.
 * @param {*} jh
 * @param {*} ha
 * @returns {number|string}
 */
function __cexp_perHa(jh, ha) {
  const h = Number(ha);
  if (!h || !isFinite(h) || h <= 0) return '';
  return __cexp_num(Number(jh) / h);
}

/**
 * Comme __cexp_num, mais CONSERVE le zéro. Réservé aux colonnes de suivi
 * budgétaire : « 0 % consommé » et « 0 JH restant » sont des informations, pas
 * des cases vides — alors qu'un 0 de JH réalisé n'apporte rien et reste blanc.
 * @param {*} v
 * @returns {number|string} '' seulement si la valeur n'est pas un nombre fini.
 */
function __cexp_num0(v) {
  const n = Number(v);
  if (!isFinite(n)) return '';
  return Math.round(n * 100) / 100;
}

/**
 * Ratio de consommation, arrondi à 4 décimales : la cellule porte le RATIO
 * (0,4567), jamais 45,67 — un format Excel de pourcentage multiplie déjà par
 * 100. 4 décimales = 2 décimales à l'affichage en %.
 * @param {*} v
 * @returns {number|string}
 */
function __cexp_ratio(v) {
  const n = Number(v);
  if (!isFinite(n)) return '';
  return Math.round(n * 10000) / 10000;
}

/**
 * Somme des budgets JH/Ha d'une parcelle (toutes familles confondues).
 *
 * Un budget à 0 vaut « pas de budget défini » (même convention que le backend
 * `campagneBudget.mergeBudgets`, qui ne stocke pas les 0) : il n'entre pas dans
 * la somme et ne rend pas la parcelle budgétée.
 *
 * @param {*} budgets map famille → JH/Ha
 * @returns {number} 0 si aucun budget défini
 */
function __cexp_sumBudget(budgets) {
  const src = budgets || {};
  let s = 0;
  Object.keys(src).forEach(function (f) {
    const v = Number(src[f]);
    if (v && isFinite(v) && v > 0) s += v;
  });
  return Math.round(s * 100) / 100;
}

/**
 * PÉRIMÈTRE BUDGÉTÉ d'une parcelle — RÈGLE UNIQUE du suivi budgétaire :
 * **on compare à périmètre égal**. Le numérateur (JH consommés) ne retient que
 * les familles qui ont un budget, exactement comme le dénominateur.
 *
 * Pourquoi c'est indispensable : tant que le budget n'est saisi que sur une
 * partie des familles — l'état NOMINAL des prochaines semaines, la collection
 * étant vide aujourd'hui — imputer TOUS les JH réalisés à un budget partiel
 * produit un dépassement fantôme. Cas réel (2 ha, Travaux du sol 30 JH sans
 * budget, Récolte 15 JH budget 10/ha) : la ligne Récolte affichait 75 % et le
 * TOTAL 225 % en rouge, irréconciliables. Avec cette règle le TOTAL affiche
 * 75 %, cohérent avec les lignes visibles.
 *
 * Les colonnes de VOLUME (« Total JH ») ne sont pas concernées : elles restent
 * exhaustives.
 *
 * @param {*} budgets      map famille → JH/Ha
 * @param {*} jhByFamille  map famille → JH réalisés
 * @returns {{budget:number, jh:number, nBudgetees:number, nFamilles:number}}
 *   `budget` = Σ des budgets JH/Ha retenus ; `jh` = Σ des JH des SEULES familles
 *   budgétées ; `nBudgetees`/`nFamilles` alimentent la mention de périmètre.
 */
function __cexp_budgetScope(budgets, jhByFamille) {
  const b = budgets || {};
  const jhMap = jhByFamille || {};
  const familles = {};
  Object.keys(jhMap).forEach(function (f) { familles[f] = true; });
  let budget = 0;
  let jh = 0;
  let nBudgetees = 0;
  Object.keys(b).forEach(function (f) {
    const v = Number(b[f]);
    if (!v || !isFinite(v) || v <= 0) return;   // 0 = pas de budget défini
    familles[f] = true;
    budget += v;
    nBudgetees += 1;
    // Une famille budgétée mais pas encore travaillée compte 0 JH : son budget
    // pèse au dénominateur, ce qui est bien le reste à consommer.
    jh += Number(jhMap[f]) || 0;
  });
  return {
    budget: Math.round(budget * 100) / 100,
    jh: Math.round(jh * 100) / 100,
    nBudgetees: nBudgetees,
    nFamilles: Object.keys(familles).length,
  };
}

/**
 * Mention de périmètre affichée sous le tableau. Les compteurs sont CALCULÉS,
 * jamais approximés : le lecteur doit pouvoir vérifier que les colonnes de
 * budget ne couvrent pas le même périmètre que les colonnes de JH.
 *
 * Le libellé reste au pluriel quel que soit le compte : « des familles
 * budgétées (1/2) » se lit correctement, là où un accord conditionnel
 * produirait « des famille budgétée ».
 *
 * @param {number} n      éléments dans le périmètre budgété
 * @param {number} total  éléments au total
 * @param {string} label  libellé au pluriel ('familles budgétées')
 * @returns {string}
 */
function __cexp_scopeNote(n, total, label) {
  return 'Colonnes budget : périmètre des ' + label
    + ' (' + n + '/' + total + '). Les colonnes JH couvrent l\'ensemble.';
}

/**
 * Les 4 cellules de suivi budgétaire d'une ligne :
 *   [ Budget par Ha, % Consommé, JH par Ha restant, Total JH Restant ]
 *
 * Règle cardinale : SANS budget défini (absent, 0, négatif, non numérique) ou
 * SANS superficie connue, les quatre cellules sont VIDES. Jamais 0, jamais
 * 100 %, jamais ∞, jamais NaN — c'est le cas NOMINAL tant qu'aucun budget n'a
 * été saisi, et une colonne remplie de 0 ou de 100 % laisserait croire à un
 * dépassement généralisé.
 *
 * Le dépassement (> 100 %) est légitime et n'est PAS plafonné : les restants
 * deviennent négatifs, ce qui est l'information attendue.
 *
 * @param {*} budgetJhParHa budget de la ligne, en JH/Ha
 * @param {*} ha            superficie de la parcelle
 * @param {*} jh            JH réellement consommés sur le périmètre de la ligne
 * @returns {Array<number|string>} toujours 4 cellules
 */
function __cexp_budgetCells(budgetJhParHa, ha, jh) {
  const b = Number(budgetJhParHa);
  const h = Number(ha);
  if (!b || !isFinite(b) || b <= 0) return ['', '', '', ''];
  if (!h || !isFinite(h) || h <= 0) return ['', '', '', ''];
  const realized = Number(jh) || 0;
  const budgetJh = b * h;
  return [
    __cexp_num0(b),
    __cexp_ratio(realized / budgetJh),
    __cexp_num0(b - realized / h),
    __cexp_num0(budgetJh - realized),
  ];
}

/**
 * Superficie AFFICHÉE (locale fr, virgule décimale) : '2,40 ha' ou '—'.
 * Utilisée par l'en-tête des feuilles parcelle ET par l'écran Campagne — même
 * format des deux côtés. Ne concerne QUE l'affichage : les cellules de données
 * de l'AoA restent des Number bruts.
 * @param {*} ha
 * @returns {string}
 */
function haLabel(ha) {
  const n = Number(ha);
  if (!n || !isFinite(n) || n <= 0) return '—';
  return n.toFixed(2).replace('.', ',') + ' ha';
}

/**
 * Familles présentes dans les lignes, dans l'ordre du référentiel, les familles
 * inconnues étant ajoutées à la fin (même règle qu'à l'écran).
 * @param {Array<*>} opRows
 * @param {Array<string>} [famillesOrdered]
 * @returns {Array<string>}
 */
function __cexp_orderFamilles(opRows, famillesOrdered) {
  const seen = {};
  (opRows || []).forEach(function (r) {
    if (r && r.famille) seen[r.famille] = true;
  });
  const ordered = (famillesOrdered || []).filter(function (f) { return seen[f]; });
  Object.keys(seen).forEach(function (f) {
    if (ordered.indexOf(f) === -1) ordered.push(f);
  });
  return ordered;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Format numérique Excel (`numFmt`) d'une cellule, choisi VALEUR PAR VALEUR.
 *
 * Pourquoi pas un format unique : `#,##0.##` laisse le séparateur décimal
 * traîner sur les entiers — Excel affiche « 6. », « 12. », « 28. » (les `#`
 * suppriment les chiffres décimaux, pas le séparateur qui les précède ;
 * reproduit sur le moteur de formatage SSF : format('#,##0.##', 6) === '6.').
 * Aucun code de format ne sait masquer ce séparateur conditionnellement, donc
 * on décide du format à l'écriture, avec un nombre de décimales EXACT :
 *   6     → `#,##0`     → « 6 »
 *   6,5   → `#,##0.0`   → « 6,5 »
 *   11,81 → `#,##0.00`  → « 11,81 »
 * (le `.` du CODE de format est un marqueur : Excel le rend avec le
 * séparateur décimal de la locale — virgule en fr.)
 *
 * Les valeurs sont déjà arrondies à 2 décimales en amont (`__cexp_num`,
 * `__cexp_perHa`) : l'arrondi ici n'est qu'un garde-fou.
 *
 * @param {*} v valeur de la cellule (seuls les nombres sont formatés)
 * @returns {string|null} code de format, ou null si la valeur n'est pas un nombre
 */
function numFmtFor(v) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const r = Math.round(v * 100) / 100;
  // Décimales réellement portées par la valeur (String évite les artefacts
  // flottants d'un test `r * 10 % 1 === 0`, cf. 2.1 * 10 = 21.000000000000004).
  const dec = (String(r).split('.')[1] || '').length;
  if (dec === 0) return '#,##0';
  return dec === 1 ? '#,##0.0' : '#,##0.00';
}

/**
 * Format Excel de la colonne « % Consommé ». La cellule contient le RATIO
 * (0,4567) : le code `0.00%` le multiplie par 100 à l'affichage → « 45,67 % ».
 * Même logique de décimales exactes que numFmtFor (pas de « 50, % » ni de
 * « 45,70 % » factice).
 *
 * @param {*} v ratio de consommation
 * @returns {string|null} null si la valeur n'est pas un nombre fini
 */
function __cexp_percentFmtFor(v) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  const shown = Math.round(v * 10000) / 100; // valeur telle qu'Excel l'affichera
  const dec = (String(shown).split('.')[1] || '').length;
  if (dec === 0) return '0%';
  return dec === 1 ? '0.0%' : '0.00%';
}

/**
 * Index (base 1, comme ExcelJS) des colonnes de pourcentage d'une feuille,
 * repérées par leur EN-TÊTE dans la ligne COL_HEADER. Le renderer n'a ainsi
 * aucun index en dur à maintenir quand une colonne est insérée.
 *
 * @param {Array<{kind:string, cells:Array<*>}>} rows lignes typées de la feuille
 * @returns {Array<number>}
 */
function __cexp_percentColumns(rows) {
  const out = [];
  const header = (rows || []).filter(function (r) {
    return r && r.kind === ROW_KIND.COL_HEADER;
  })[0];
  if (!header) return out;
  (header.cells || []).forEach(function (c, i) {
    if (c === __cexp_PERCENT_HEADER) out.push(i + 1);
  });
  return out;
}

/**
 * Nom de feuille Excel valide : caractères interdits nettoyés, 31 caractères
 * max, dédupliqué avec un suffixe `~2`, `~3`… en cas de collision (fréquent
 * après troncature : deux libellés longs se ressemblent sur leurs 31 premiers
 * caractères).
 *
 * `used` est un dictionnaire des noms déjà attribués (clé = nom en minuscules,
 * Excel étant insensible à la casse). Il est MUTÉ pour enregistrer le nom rendu,
 * afin d'enchaîner les appels sur un même classeur.
 *
 * @param {*} nom      nom souhaité (nom Smart Berry ou libellé BEE ONE)
 * @param {*} [index]  rang de la feuille, utilisé si le nom est vide
 * @param {*} [used]   { nomMinuscule: true } des noms déjà pris (muté)
 * @returns {string}
 */
function safeSheetName(nom, index, used) {
  let base = String(nom == null ? '' : nom)
    .replace(__cexp_SHEET_FORBIDDEN, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) base = 'Feuille ' + (index == null ? 1 : index);
  base = base.slice(0, __cexp_SHEET_MAX).trim();
  if (!base) base = 'Feuille ' + (index == null ? 1 : index);

  const taken = used || {};
  let candidate = base;
  let n = 2;
  while (taken[candidate.toLowerCase()]) {
    const suffix = '~' + n;
    candidate = (base.slice(0, __cexp_SHEET_MAX - suffix.length).trim() + suffix);
    n += 1;
  }
  taken[candidate.toLowerCase()] = true;
  return candidate;
}

/**
 * Feuille « Synthèse » — description STRUCTURÉE : une ligne par parcelle, plus
 * une ligne de total quand il y a au moins une parcelle. Chaque ligne porte son
 * `kind`, ce qui permet au moteur de rendu (ExcelJS) d'appliquer un style SANS
 * re-deviner la nature de la ligne à partir de son texte.
 *
 * @param {Array<*>} parcelles
 *   [{ nomSb, label, ferme, ha, totalJh, budgets, jhByFamille }]
 *   `budgets` = map famille → JH/Ha saisie sur l'écran Budget ; absente ou vide
 *   → colonnes de suivi budgétaire vides pour cette parcelle.
 *   `jhByFamille` = map famille → JH réalisés, indispensable pour comparer à
 *   PÉRIMÈTRE ÉGAL (cf. __cexp_budgetScope) : sans elle, seules les familles
 *   budgétées sans JH seraient correctement traitées.
 * @returns {Array<{kind:string, cells:Array<*>}>}
 */
function buildSyntheseRows(parcelles) {
  const rows = [{ kind: ROW_KIND.COL_HEADER, cells: __cexp_SYNTHESE_HEADER.slice() }];
  let totalHa = 0;
  let totalJh = 0;
  // Sommes du RATIO : périmètre restreint aux parcelles dont la superficie est
  // connue (cf. ligne TOTAL plus bas).
  let ratioHa = 0;
  let ratioJh = 0;
  // Sommes du BUDGET : périmètre encore plus restreint — parcelles à la fois
  // budgétées ET de superficie connue (cf. ligne TOTAL).
  let budHa = 0;
  let budJh = 0;    // Σ (budget JH/Ha × ha) = budget total en JH
  let budReel = 0;  // Σ JH des SEULES familles budgétées, sur ce même périmètre
  let nBudParcelles = 0;
  let n = 0;
  (parcelles || []).forEach(function (p) {
    const src = p || {};
    const ha = Number(src.ha);
    const jh = Number(src.totalJh) || 0;
    // Périmètre budgété de la parcelle : budget ET JH restreints aux familles
    // budgétées (règle unique — cf. __cexp_budgetScope).
    const scope = __cexp_budgetScope(src.budgets, src.jhByFamille);
    totalHa += ha || 0;
    totalJh += jh;
    if (ha && isFinite(ha) && ha > 0) {
      ratioHa += ha;
      ratioJh += jh;
      if (scope.budget > 0) {
        budHa += ha;
        budJh += scope.budget * ha;
        budReel += scope.jh;
        nBudParcelles += 1;
      }
    }
    n += 1;
    rows.push({
      kind: ROW_KIND.DATA,
      cells: [
        src.nomSb || src.label || '',
        src.label || '',
        src.ferme || '',
        __cexp_num(src.ha),
        __cexp_num(src.totalJh),
        __cexp_perHa(src.totalJh, src.ha),
      ].concat(__cexp_budgetCells(scope.budget, src.ha, scope.jh)),
    });
  });
  if (n > 0) {
    // Ligne TOTAL — DEUX périmètres différents, volontairement :
    //
    // • « Total JH » = somme de TOUS les JH, y compris ceux des parcelles sans
    //   superficie connue : c'est un total de VOLUME, il ne doit rien perdre.
    //
    // • « Total JH / Ha » = ΣJH ÷ Σha calculés sur les SEULES parcelles dont on
    //   connaît la superficie — exclusion DOUBLE (numérateur ET dénominateur).
    //   Garder les JH d'une parcelle au numérateur alors que ses hectares
    //   manquent au dénominateur gonflerait le ratio : le chiffre serait faux,
    //   et faux dans le sens qui inquiète (consommation de main-d'œuvre
    //   surestimée). Le ratio se lit « JH/ha sur le périmètre dont la surface
    //   est connue ». C'est aussi, pour la même raison, une moyenne PONDÉRÉE
    //   (ΣJH ÷ Σha) et non la moyenne des ratios ligne à ligne, qui donnerait
    //   le même poids à une parcelle de 0,2 ha qu'à une de 5 ha.
    //   Aucune parcelle avec superficie → Σha = 0 → cellule vide (pas de
    //   division par zéro).
    //
    // • Colonnes de suivi budgétaire = MÊME règle de périmètre, resserrée de
    //   deux crans : seules les parcelles budgétées ET de superficie connue
    //   comptent, et à l'intérieur de chacune, seules les familles budgétées
    //   (numérateur comme dénominateur). « Budget par Ha » est donc la moyenne
    //   PONDÉRÉE Σ(budget × ha) ÷ Σha de ce périmètre. Aucune parcelle budgétée
    //   → les quatre cellules restent vides (cas nominal au démarrage).
    //
    // Trois périmètres cohabitent donc sur cette ligne : la NOTE qui la suit
    // les rend explicites plutôt que de les laisser deviner.
    rows.push({
      kind: ROW_KIND.TOTAL_GENERAL,
      cells: [
        'TOTAL (' + n + ' parcelle' + (n > 1 ? 's' : '') + ')',
        '', '',
        __cexp_num(totalHa),
        __cexp_num(totalJh),
        __cexp_perHa(ratioJh, ratioHa),
      ].concat(__cexp_budgetCells(budHa > 0 ? budJh / budHa : 0, budHa, budReel)),
    });
    rows.push({
      kind: ROW_KIND.NOTE,
      cells: [__cexp_scopeNote(
        nBudParcelles, n, 'parcelles budgétées à superficie connue'
      )],
    });
  }
  return rows;
}

/**
 * Feuille « Synthèse » en AoA (rendu SheetJS / CSV de repli).
 *
 * @param {Array<*>} parcelles [{ nomSb, label, ferme, ha, totalJh }]
 * @returns {Array<Array<*>>} AoA prête pour XLSX.utils.aoa_to_sheet
 */
function buildSyntheseAoA(parcelles) {
  return buildSyntheseRows(parcelles).map(function (r) { return r.cells; });
}

/** Largeurs de colonnes de la feuille « Synthèse » (ws['!cols']). */
function syntheseSheetCols() {
  return [
    { wch: __cexp_WCH.parcelle },
    { wch: __cexp_WCH.parcelle },
    { wch: __cexp_WCH.ferme },
    { wch: __cexp_WCH.ha },
    { wch: __cexp_WCH.total },
    { wch: __cexp_WCH.jhPerHa },
  ].concat(__cexp_budgetCols());
}

/**
 * Largeurs de colonnes d'une feuille parcelle (ws['!cols']) : libellé large,
 * une colonne par quinzaine, colonne Total, colonne Total JH / Ha.
 *
 * Le compte DOIT rester égal au nombre de colonnes de la ligne COL_HEADER : le
 * rendu ExcelJS dérive la largeur des bandeaux pleine largeur de
 * `cols.length` (cf. styleFullWidth).
 * @param {*} nbPeriodes
 * @returns {Array<{wch:number}>}
 */
function parcelleSheetCols(nbPeriodes) {
  const n = Math.max(0, Number(nbPeriodes) || 0);
  const cols = [{ wch: __cexp_WCH.libelle }];
  for (let i = 0; i < n; i += 1) cols.push({ wch: __cexp_WCH.periode });
  cols.push({ wch: __cexp_WCH.total });
  cols.push({ wch: __cexp_WCH.jhPerHa });
  return cols.concat(__cexp_budgetCols());
}

/**
 * Feuille d'une parcelle — description STRUCTURÉE. JH uniquement (aucune
 * colonne DH) :
 *   4 lignes META : libellés `Parcelle :` / `Superficie :` / `Culture :` /
 *   `Campagne :` en colonne A, valeur en colonne B (cellules distinctes → pas
 *   de troncature) ; une ligne vide ; la ligne COL_HEADER
 *   `Famille / Opération | <quinzaine> … | Total JH` ; par famille une ligne
 *   FAMILLE, ses OPERATION, un TOTAL_FAMILLE et une ligne vide ;
 *   TOTAL_GENERAL en dernier.
 *
 * Le libellé d'une ligne OPERATION n'est PAS indenté ici : l'indentation est
 * une décision de rendu (espaces en dur pour l'AoA SheetJS/CSV, alignement
 * `indent` natif pour ExcelJS).
 *
 * `opRows` est la sortie de buildVarieteView (CampagneAnalytiqueTab) :
 * [{ famille, operation, byPeriode: { <periode>: { jh, cout } }, total: { jh, cout } }]
 * — le champ `cout` est volontairement ignoré (export JH uniquement).
 *
 * @param {*} params { nomSb, ha, culture, campagne, periodes, opRows,
 *   famillesOrdered, budgets } — `budgets` = map famille → JH/Ha.
 * @returns {Array<{kind:string, cells:Array<*>}>}
 */
function buildParcelleSheetRows(params) {
  const p = params || {};
  const periodes = p.periodes || [];
  const opRows = p.opRows || [];

  const rows = [
    { kind: ROW_KIND.META, cells: ['Parcelle :', p.nomSb || ''] },
    { kind: ROW_KIND.META, cells: ['Superficie :', haLabel(p.ha)] },
    { kind: ROW_KIND.META, cells: ['Culture :', p.culture || ''] },
    { kind: ROW_KIND.META, cells: ['Campagne :', p.campagne || ''] },
    { kind: ROW_KIND.BLANK, cells: [] },
  ];

  const header = ['Famille / Opération'];
  periodes.forEach(function (per) { header.push(per); });
  header.push('Total JH');
  header.push('Total JH / Ha');
  __cexp_BUDGET_HEADER.forEach(function (h) { header.push(h); });
  rows.push({ kind: ROW_KIND.COL_HEADER, cells: header });

  // Budgets JH/Ha de la parcelle, par famille (écran Campagne › Budget).
  const budgets = p.budgets || {};
  // JH réalisés par famille, alimenté au fil des totaux de famille : c'est le
  // numérateur du TOTAL GÉNÉRAL, restreint plus bas aux familles budgétées.
  const jhByFamille = {};

  // Superficie de la parcelle : dénominateur de TOUTE la colonne JH / Ha
  // (opérations, totaux famille, total général). Inconnue ou nulle → colonne
  // vide sur toute la feuille, jamais d'Infinity/NaN.
  const ha = p.ha;

  const grand = { byP: {}, jh: 0 };

  __cexp_orderFamilles(opRows, p.famillesOrdered).forEach(function (famille) {
    const famRows = opRows.filter(function (r) { return r && r.famille === famille; });
    if (famRows.length === 0) return;
    const famTotal = { byP: {}, jh: 0 };

    rows.push({ kind: ROW_KIND.FAMILLE, cells: [famille] });

    famRows.forEach(function (r) {
      const line = [r.operation || ''];
      periodes.forEach(function (per) {
        const cell = (r.byPeriode || {})[per];
        const jh = cell ? Number(cell.jh) || 0 : 0;
        line.push(__cexp_num(jh));
        if (!famTotal.byP[per]) famTotal.byP[per] = 0;
        famTotal.byP[per] += jh;
        if (!grand.byP[per]) grand.byP[per] = 0;
        grand.byP[per] += jh;
      });
      const tJh = Number((r.total || {}).jh) || 0;
      line.push(__cexp_num(tJh));
      line.push(__cexp_perHa(tJh, ha));
      // Suivi budgétaire : rien à la maille opération — le budget est saisi
      // par famille. Cellules présentes mais vides pour garder l'alignement
      // des colonnes (AoA/CSV inclus).
      line.push('', '', '', '');
      famTotal.jh += tJh;
      grand.jh += tJh;
      rows.push({ kind: ROW_KIND.OPERATION, cells: line });
    });

    const famLine = ['Total ' + famille];
    periodes.forEach(function (per) { famLine.push(__cexp_num(famTotal.byP[per])); });
    famLine.push(__cexp_num(famTotal.jh));
    famLine.push(__cexp_perHa(famTotal.jh, ha));
    __cexp_budgetCells(budgets[famille], ha, famTotal.jh)
      .forEach(function (c) { famLine.push(c); });
    jhByFamille[famille] = famTotal.jh;
    rows.push({ kind: ROW_KIND.TOTAL_FAMILLE, cells: famLine });
    rows.push({ kind: ROW_KIND.BLANK, cells: [] });
  });

  const totalLine = ['TOTAL GÉNÉRAL'];
  periodes.forEach(function (per) { totalLine.push(__cexp_num(grand.byP[per])); });
  totalLine.push(__cexp_num(grand.jh));
  totalLine.push(__cexp_perHa(grand.jh, ha));
  // Suivi budgétaire du TOTAL GÉNÉRAL — comparaison à PÉRIMÈTRE ÉGAL :
  //  - au dénominateur, TOUS les budgets saisis sur la parcelle, y compris ceux
  //    de familles pas encore pointées (elles n'ont pas de ligne ici) : c'est le
  //    budget du PLAN complet, sinon le « % consommé » frôlerait 100 % dès la
  //    première quinzaine ;
  //  - au numérateur, les JH des SEULES familles budgétées : imputer les JH
  //    d'une famille non budgétée à ce budget produisait un dépassement
  //    fantôme (30 JH hors budget + 15 JH sur un budget de 20 → 225 % au lieu
  //    de 75 %), irréconciliable avec les lignes TOTAL_FAMILLE visibles.
  // La NOTE sous le tableau annonce ce périmètre.
  const scope = __cexp_budgetScope(budgets, jhByFamille);
  __cexp_budgetCells(scope.budget, ha, scope.jh).forEach(function (c) { totalLine.push(c); });
  rows.push({ kind: ROW_KIND.TOTAL_GENERAL, cells: totalLine });
  if (scope.nFamilles > 0) {
    rows.push({
      kind: ROW_KIND.NOTE,
      cells: [__cexp_scopeNote(scope.nBudgetees, scope.nFamilles, 'familles budgétées')],
    });
  }

  return rows;
}

/**
 * Feuille d'une parcelle en AoA (rendu SheetJS / CSV de repli) : mêmes données
 * que buildParcelleSheetRows, avec l'indentation des opérations matérialisée
 * par des espaces (SheetJS ne sait pas indenter).
 *
 * @param {*} params cf. buildParcelleSheetRows
 * @returns {Array<Array<*>>} AoA prête pour XLSX.utils.aoa_to_sheet
 */
function buildParcelleSheetAoA(params) {
  return buildParcelleSheetRows(params).map(function (r) {
    if (r.kind !== ROW_KIND.OPERATION) return r.cells;
    const cells = r.cells.slice();
    cells[0] = __cexp_INDENT + cells[0];
    return cells;
  });
}

// ============================================================================
// UMD-bricolé : un seul global exposé (window.CampagneExportUtils)
// ============================================================================

const __cexp_api = {
  SHEET_MAX: __cexp_SHEET_MAX,
  ROW_KIND,
  PERCENT_HEADER: __cexp_PERCENT_HEADER,
  haLabel,
  numFmtFor,
  percentFmtFor: __cexp_percentFmtFor,
  percentColumns: __cexp_percentColumns,
  sumBudget: __cexp_sumBudget,
  budgetScope: __cexp_budgetScope,
  budgetCells: __cexp_budgetCells,
  safeSheetName,
  buildSyntheseRows,
  buildSyntheseAoA,
  syntheseSheetCols,
  buildParcelleSheetRows,
  buildParcelleSheetAoA,
  parcelleSheetCols,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __cexp_api;
if (typeof window !== 'undefined') window.CampagneExportUtils = __cexp_api;
