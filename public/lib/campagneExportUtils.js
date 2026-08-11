/**
 * campagneExportUtils.js — Pure helpers de construction de l'export Excel de
 * l'écran Campagne analytique (une feuille de synthèse + une feuille par parcelle).
 *
 * Loaded twice (UMD-bricolé) :
 *   - Browser : <script src="lib/campagneExportUtils.js"> → window.CampagneExportUtils
 *   - node:test : require('.../campagneExportUtils.js') → module.exports
 *
 * Ces helpers ne font QUE produire des tableaux de tableaux (AoA) et des noms de
 * feuille : aucune dépendance à SheetJS, au DOM ou au réseau. L'écriture du
 * classeur reste dans le composant (window.XLSX).
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

/** En-tête de la feuille « Synthèse ». */
const __cexp_SYNTHESE_HEADER = [
  'Parcelle',
  'Libellé BEE ONE',
  'Ferme',
  'Superficie (ha)',
  'Total JH',
  'Total DH',
  'DH/ha',
];

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
 * Superficie affichée dans l'en-tête d'une feuille parcelle : '2,40 ha' ou '—'.
 * @param {*} ha
 * @returns {string}
 */
function __cexp_haLabel(ha) {
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
 * Feuille « Synthèse » : une ligne par parcelle exportée.
 *
 * @param {Array<*>} parcelles [{ nomSb, label, ferme, ha, totalJh, totalCout }]
 * @returns {Array<Array<*>>} AoA prête pour XLSX.utils.aoa_to_sheet
 */
function buildSyntheseAoA(parcelles) {
  const aoa = [__cexp_SYNTHESE_HEADER.slice()];
  (parcelles || []).forEach(function (p) {
    const src = p || {};
    const ha = Number(src.ha) || 0;
    const cout = Number(src.totalCout) || 0;
    aoa.push([
      src.nomSb || src.label || '',
      src.label || '',
      src.ferme || '',
      __cexp_num(ha),
      __cexp_num(src.totalJh),
      __cexp_num(cout),
      ha > 0 && cout ? Math.round(cout / ha) : '',
    ]);
  });
  return aoa;
}

/**
 * Feuille d'une parcelle : en-tête (nom SB, superficie, culture, campagne),
 * ligne vide, puis le pivot Famille/Opération × quinzaines (JH + DH), avec une
 * ligne `Total <famille>` par famille et une ligne `TOTAL GÉNÉRAL` finale —
 * mêmes agrégats que l'écran.
 *
 * `opRows` est la sortie de buildVarieteView (CampagneAnalytiqueTab) :
 * [{ famille, operation, byPeriode: { <periode>: { jh, cout } }, total: { jh, cout } }]
 *
 * @param {*} params { nomSb, ha, culture, campagne, periodes, opRows, famillesOrdered }
 * @returns {Array<Array<*>>} AoA prête pour XLSX.utils.aoa_to_sheet
 */
function buildParcelleSheetAoA(params) {
  const p = params || {};
  const periodes = p.periodes || [];
  const opRows = p.opRows || [];

  const aoa = [
    ['Parcelle : ' + (p.nomSb || ''), 'Superficie : ' + __cexp_haLabel(p.ha)],
    ['Culture : ' + (p.culture || ''), 'Campagne : ' + (p.campagne || '')],
    [],
  ];

  const header = ['Famille / Opération'];
  periodes.forEach(function (per) {
    header.push(per + ' JH');
    header.push(per + ' DH');
  });
  header.push('Total JH');
  header.push('Total DH');
  aoa.push(header);

  const grand = { byP: {}, jh: 0, cout: 0 };

  __cexp_orderFamilles(opRows, p.famillesOrdered).forEach(function (famille) {
    const famRows = opRows.filter(function (r) { return r && r.famille === famille; });
    if (famRows.length === 0) return;
    const famTotal = { byP: {}, jh: 0, cout: 0 };

    famRows.forEach(function (r) {
      const line = [r.operation || ''];
      periodes.forEach(function (per) {
        const cell = (r.byPeriode || {})[per];
        const jh = cell ? Number(cell.jh) || 0 : 0;
        const cout = cell ? Number(cell.cout) || 0 : 0;
        line.push(__cexp_num(jh));
        line.push(__cexp_num(cout));
        if (!famTotal.byP[per]) famTotal.byP[per] = { jh: 0, cout: 0 };
        famTotal.byP[per].jh += jh;
        famTotal.byP[per].cout += cout;
        if (!grand.byP[per]) grand.byP[per] = { jh: 0, cout: 0 };
        grand.byP[per].jh += jh;
        grand.byP[per].cout += cout;
      });
      const tJh = Number((r.total || {}).jh) || 0;
      const tCout = Number((r.total || {}).cout) || 0;
      line.push(__cexp_num(tJh));
      line.push(__cexp_num(tCout));
      famTotal.jh += tJh;
      famTotal.cout += tCout;
      grand.jh += tJh;
      grand.cout += tCout;
      aoa.push(line);
    });

    const famLine = ['Total ' + famille];
    periodes.forEach(function (per) {
      const cell = famTotal.byP[per];
      famLine.push(__cexp_num(cell ? cell.jh : 0));
      famLine.push(__cexp_num(cell ? cell.cout : 0));
    });
    famLine.push(__cexp_num(famTotal.jh));
    famLine.push(__cexp_num(famTotal.cout));
    aoa.push(famLine);
  });

  const totalLine = ['TOTAL GÉNÉRAL'];
  periodes.forEach(function (per) {
    const cell = grand.byP[per];
    totalLine.push(__cexp_num(cell ? cell.jh : 0));
    totalLine.push(__cexp_num(cell ? cell.cout : 0));
  });
  totalLine.push(__cexp_num(grand.jh));
  totalLine.push(__cexp_num(grand.cout));
  aoa.push(totalLine);

  return aoa;
}

// ============================================================================
// UMD-bricolé : un seul global exposé (window.CampagneExportUtils)
// ============================================================================

const __cexp_api = {
  SHEET_MAX: __cexp_SHEET_MAX,
  safeSheetName,
  buildSyntheseAoA,
  buildParcelleSheetAoA,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __cexp_api;
if (typeof window !== 'undefined') window.CampagneExportUtils = __cexp_api;
