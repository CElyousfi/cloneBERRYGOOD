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
 * En-tête des 4 colonnes de suivi budgétaire, communes aux deux feuilles.
 * Elles ne sont renseignées QUE sur les lignes qui portent un budget :
 * TOTAL_FAMILLE / TOTAL_GENERAL (feuille parcelle) et DATA / TOTAL_GENERAL
 * (feuille Synthèse). Le budget est saisi par parcelle × famille : il n'existe
 * pas à la maille opération, ces cellules y restent donc vides.
 */
const __cexp_BUDGET_HEADER = [
  'Budget par Ha',
  '% Consommé',
  'JH par Ha restant',
  'Total JH Restant',
];

/**
 * Libellé de la colonne de pourcentage. Exporté : le moteur de rendu retrouve
 * la (ou les) colonne(s) de % par leur EN-TÊTE et non par un index en dur, qui
 * se décalerait au prochain ajout de colonne.
 */
const PERCENT_HEADER = '% Consommé';

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
function sumBudget(budgets) {
  const src = budgets || {};
  let s = 0;
  Object.keys(src).forEach(function (f) {
    const v = Number(src[f]);
    if (v && isFinite(v) && v > 0) s += v;
  });
  return Math.round(s * 100) / 100;
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
function budgetCells(budgetJhParHa, ha, jh) {
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
function percentFmtFor(v) {
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
function percentColumns(rows) {
  const out = [];
  const header = (rows || []).filter(function (r) {
    return r && r.kind === ROW_KIND.COL_HEADER;
  })[0];
  if (!header) return out;
  (header.cells || []).forEach(function (c, i) {
    if (c === PERCENT_HEADER) out.push(i + 1);
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
 * @param {Array<*>} parcelles [{ nomSb, label, ferme, ha, totalJh, budgets }]
 *   `budgets` = map famille → JH/Ha saisie sur l'écran Budget ; absente ou vide
 *   → colonnes de suivi budgétaire vides pour cette parcelle.
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
  let budReel = 0;  // Σ JH réalisés sur ce même périmètre
  let n = 0;
  (parcelles || []).forEach(function (p) {
    const src = p || {};
    const ha = Number(src.ha);
    const jh = Number(src.totalJh) || 0;
    const bud = sumBudget(src.budgets);
    totalHa += ha || 0;
    totalJh += jh;
    if (ha && isFinite(ha) && ha > 0) {
      ratioHa += ha;
      ratioJh += jh;
      if (bud > 0) {
        budHa += ha;
        budJh += bud * ha;
        budReel += jh;
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
      ].concat(budgetCells(bud, src.ha, jh)),
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
    // • Colonnes de suivi budgétaire = MÊME règle de périmètre, resserrée d'un
    //   cran : seules les parcelles budgétées ET de superficie connue comptent.
    //   « Budget par Ha » est donc la moyenne PONDÉRÉE Σ(budget × ha) ÷ Σha de
    //   ce périmètre, et le « % Consommé » ne rapporte que les JH de ces mêmes
    //   parcelles à leur budget — sinon les JH d'une parcelle non budgétée
    //   viendraient consommer le budget des autres. Aucune parcelle budgétée →
    //   les quatre cellules restent vides (cas nominal au démarrage).
    rows.push({
      kind: ROW_KIND.TOTAL_GENERAL,
      cells: [
        'TOTAL (' + n + ' parcelle' + (n > 1 ? 's' : '') + ')',
        '', '',
        __cexp_num(totalHa),
        __cexp_num(totalJh),
        __cexp_perHa(ratioJh, ratioHa),
      ].concat(budgetCells(budHa > 0 ? budJh / budHa : 0, budHa, budReel)),
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
    budgetCells(budgets[famille], ha, famTotal.jh).forEach(function (c) { famLine.push(c); });
    rows.push({ kind: ROW_KIND.TOTAL_FAMILLE, cells: famLine });
    rows.push({ kind: ROW_KIND.BLANK, cells: [] });
  });

  const totalLine = ['TOTAL GÉNÉRAL'];
  periodes.forEach(function (per) { totalLine.push(__cexp_num(grand.byP[per])); });
  totalLine.push(__cexp_num(grand.jh));
  totalLine.push(__cexp_perHa(grand.jh, ha));
  // Budget de la ligne TOTAL GÉNÉRAL = somme de TOUS les budgets saisis sur la
  // parcelle, y compris ceux de familles sur lesquelles aucune journée n'a
  // encore été pointée (elles n'ont donc pas de ligne dans la feuille). C'est
  // le budget du PLAN complet : ne compter que les familles déjà travaillées
  // ferait afficher un « % consommé » proche de 100 % dès la première
  // quinzaine, exactement l'illusion de dépassement qu'on veut éviter.
  budgetCells(sumBudget(budgets), ha, grand.jh).forEach(function (c) { totalLine.push(c); });
  rows.push({ kind: ROW_KIND.TOTAL_GENERAL, cells: totalLine });

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
  PERCENT_HEADER,
  haLabel,
  numFmtFor,
  percentFmtFor,
  percentColumns,
  sumBudget,
  budgetCells,
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
