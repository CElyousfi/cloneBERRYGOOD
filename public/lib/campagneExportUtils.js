/**
 * campagneExportUtils.js — Pure helpers de construction de l'export Excel de
 * l'écran Campagne analytique (une feuille de synthèse + une feuille par parcelle).
 *
 * Loaded twice (UMD-bricolé) :
 *   - Browser : <script src="lib/campagneExportUtils.js"> → window.CampagneExportUtils
 *   - node:test : require('.../campagneExportUtils.js') → module.exports
 *
 * Ces helpers ne font QUE produire des tableaux de tableaux (AoA), des largeurs
 * de colonnes et des noms de feuille : aucune dépendance à SheetJS, au DOM ou au
 * réseau. L'écriture du classeur reste dans le composant (window.XLSX).
 *
 * L'export ne contient QUE des journées-homme (JH) — décision produit : les
 * coûts DH restent à l'écran (toggle JH / Coût DH), pas dans le fichier.
 *
 * MISE EN FORME — vérifié sur le build réellement chargé (CDN xlsx-0.20.3,
 * community) en écrivant un .xlsx et en relisant sheet1.xml :
 *   - `ws['!cols'] = [{ wch }]`      → écrit `<cols><col customWidth/>` : SUPPORTÉ ;
 *   - `ws['!freeze']` / `ws['!panes']` → aucun `<pane>` produit : IGNORÉ ;
 *   - styles de cellule (`cell.s` gras/couleurs) → aucun `s=` produit : IGNORÉ
 *     (réservé à la version Pro).
 * La lisibilité vient donc de la STRUCTURE (indentation par espaces — préservée
 * par `xml:space="preserve"` —, lignes de total, ligne vide entre familles).
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

/** En-tête de la feuille « Synthèse » (JH uniquement, aucune colonne DH). */
const __cexp_SYNTHESE_HEADER = [
  'Parcelle',
  'Libellé BEE ONE',
  'Ferme',
  'Superficie (ha)',
  'Total JH',
];

/** Indentation des opérations sous leur famille (préservée par Excel). */
const __cexp_INDENT = '    ';

/** Largeurs de colonnes (unité `wch` de SheetJS ≈ nombre de caractères). */
const __cexp_WCH = {
  libelle: 42,   // colonne A des feuilles parcelle : « Famille / Opération »
  periode: 14,
  total: 12,
  parcelle: 32,  // feuille Synthèse
  ferme: 10,
  ha: 14,
};

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
 * Feuille « Synthèse » : une ligne par parcelle exportée. JH uniquement.
 *
 * @param {Array<*>} parcelles [{ nomSb, label, ferme, ha, totalJh }]
 * @returns {Array<Array<*>>} AoA prête pour XLSX.utils.aoa_to_sheet
 */
function buildSyntheseAoA(parcelles) {
  const aoa = [__cexp_SYNTHESE_HEADER.slice()];
  (parcelles || []).forEach(function (p) {
    const src = p || {};
    aoa.push([
      src.nomSb || src.label || '',
      src.label || '',
      src.ferme || '',
      __cexp_num(src.ha),
      __cexp_num(src.totalJh),
    ]);
  });
  return aoa;
}

/** Largeurs de colonnes de la feuille « Synthèse » (ws['!cols']). */
function syntheseSheetCols() {
  return [
    { wch: __cexp_WCH.parcelle },
    { wch: __cexp_WCH.parcelle },
    { wch: __cexp_WCH.ferme },
    { wch: __cexp_WCH.ha },
    { wch: __cexp_WCH.total },
  ];
}

/**
 * Largeurs de colonnes d'une feuille parcelle (ws['!cols']) : libellé large,
 * une colonne par quinzaine, colonne Total.
 * @param {*} nbPeriodes
 * @returns {Array<{wch:number}>}
 */
function parcelleSheetCols(nbPeriodes) {
  const n = Math.max(0, Number(nbPeriodes) || 0);
  const cols = [{ wch: __cexp_WCH.libelle }];
  for (let i = 0; i < n; i += 1) cols.push({ wch: __cexp_WCH.periode });
  cols.push({ wch: __cexp_WCH.total });
  return cols;
}

/**
 * Feuille d'une parcelle. JH uniquement (aucune colonne DH) :
 *   A1..A4 : libellés `Parcelle :` / `Superficie :` / `Culture :` / `Campagne :`
 *            avec la VALEUR en colonne B (cellules distinctes → pas de troncature) ;
 *   ligne vide, puis `Famille / Opération | <quinzaine> … | Total JH` ;
 *   par famille : une ligne titre, les opérations indentées, `Total <famille>`
 *   et une ligne vide de séparation ; `TOTAL GÉNÉRAL` en dernier.
 *
 * `opRows` est la sortie de buildVarieteView (CampagneAnalytiqueTab) :
 * [{ famille, operation, byPeriode: { <periode>: { jh, cout } }, total: { jh, cout } }]
 * — le champ `cout` est volontairement ignoré (export JH uniquement).
 *
 * @param {*} params { nomSb, ha, culture, campagne, periodes, opRows, famillesOrdered }
 * @returns {Array<Array<*>>} AoA prête pour XLSX.utils.aoa_to_sheet
 */
function buildParcelleSheetAoA(params) {
  const p = params || {};
  const periodes = p.periodes || [];
  const opRows = p.opRows || [];

  const aoa = [
    ['Parcelle :', p.nomSb || ''],
    ['Superficie :', haLabel(p.ha)],
    ['Culture :', p.culture || ''],
    ['Campagne :', p.campagne || ''],
    [],
  ];

  const header = ['Famille / Opération'];
  periodes.forEach(function (per) { header.push(per); });
  header.push('Total JH');
  aoa.push(header);

  const grand = { byP: {}, jh: 0 };

  __cexp_orderFamilles(opRows, p.famillesOrdered).forEach(function (famille) {
    const famRows = opRows.filter(function (r) { return r && r.famille === famille; });
    if (famRows.length === 0) return;
    const famTotal = { byP: {}, jh: 0 };

    aoa.push([famille]);

    famRows.forEach(function (r) {
      const line = [__cexp_INDENT + (r.operation || '')];
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
      famTotal.jh += tJh;
      grand.jh += tJh;
      aoa.push(line);
    });

    const famLine = ['Total ' + famille];
    periodes.forEach(function (per) { famLine.push(__cexp_num(famTotal.byP[per])); });
    famLine.push(__cexp_num(famTotal.jh));
    aoa.push(famLine);
    aoa.push([]);
  });

  const totalLine = ['TOTAL GÉNÉRAL'];
  periodes.forEach(function (per) { totalLine.push(__cexp_num(grand.byP[per])); });
  totalLine.push(__cexp_num(grand.jh));
  aoa.push(totalLine);

  return aoa;
}

// ============================================================================
// UMD-bricolé : un seul global exposé (window.CampagneExportUtils)
// ============================================================================

const __cexp_api = {
  SHEET_MAX: __cexp_SHEET_MAX,
  haLabel,
  safeSheetName,
  buildSyntheseAoA,
  syntheseSheetCols,
  buildParcelleSheetAoA,
  parcelleSheetCols,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __cexp_api;
if (typeof window !== 'undefined') window.CampagneExportUtils = __cexp_api;
