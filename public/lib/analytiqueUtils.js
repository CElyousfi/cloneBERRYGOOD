/**
 * analytiqueUtils.js — Pure helpers for the "Affectation Analytique — par Ha"
 * pivot table (écran Quinzaine).
 *
 * Loaded twice (UMD, hand-rolled — mirrors public/lib/quinzaineUtils.js):
 *   - In the browser via <script src="lib/analytiqueUtils.js"> → exposes window.AnalytiqueUtils
 *   - In node:test via require('./analytiqueUtils.js') → exposes module.exports
 *
 * All functions are pure (no DOM, no network, no Firestore).
 *
 * Context (ticket 2026-07 « Affectation analytique par Ha — données incorrectes ») :
 * depuis la bascule pipeline BDP, les labels Operation_Famille arrivent avec des
 * variantes de casse / ponctuation (« Entretien Structure » vs « Entretien
 * structure », « Ferti-irrigation » vs « Ferti Irrigation ») → lignes dupliquées
 * dans le pivot. Ce module regroupe les opérations sur une clé normalisée
 * MÉCANIQUE (préfixe numérique, casse, tirets/underscores, espaces multiples) —
 * il ne fait AUCUN mapping métier entre libellés réellement différents
 * (« PALISSAGE » et « Tuteurage & palissage » restent deux lignes distinctes).
 *
 * IMPORTANT global-name discipline (anti-boot-crash, cf. project memory on global
 * collisions crashing React #200 at boot): this module is IIFE-wrapped and leaks NO
 * top-level name to the global scope. Only window.AnalytiqueUtils (browser) and
 * module.exports (node) are exposed. The export object uses the UNIQUE name
 * `__analytiqueUtilsApi` (never `__api`, which collides with caisseUtils).
 */
// @ts-check
'use strict';

(function () {

  /**
   * Libellé d'affichage d'une opération/famille : retire le préfixe numérique
   * BEE ONE (« 8. Récolte » → « Récolte ») et trim.
   *
   * @param {string|null|undefined} op
   * @returns {string}
   */
  function opLabel(op) {
    return String(op || '').replace(/^\s*\d+\.\s*/, '').trim();
  }

  /**
   * Clé de regroupement normalisée d'une famille d'opération — normalisation
   * MÉCANIQUE uniquement (pas de mapping métier) :
   *   - préfixe numérique retiré (« 8. Récolte » ≡ « Récolte »)
   *   - tirets/underscores → espace (« Ferti-irrigation » ≡ « Ferti Irrigation »)
   *   - espaces multiples réduits, trim
   *   - casse ignorée (« Entretien Structure » ≡ « Entretien structure »)
   *
   * @param {string|null|undefined} op
   * @returns {string}
   */
  function opKey(op) {
    return opLabel(op)
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  /**
   * @typedef {Object} AnalytiqueRow
   * @property {string} parcelle          label brut Parcelle_Culturale (trim)
   * @property {number} ha                surface résolue côté écran (0 si inconnue)
   * @property {string} operationFamille  famille d'opération brute
   * @property {number} jh                journées-homme du groupe
   * @property {number} cout              coût du groupe (DH)
   */

  /**
   * @typedef {Object} AnalytiquePivotCell
   * @property {number} jh
   * @property {number} cout
   * @property {number} ha
   * @property {AnalytiqueRow[]} detailRows
   */

  /**
   * Construit le pivot parcelle × famille d'opération de l'Affectation Analytique.
   *
   * - Les familles sont regroupées sur opKey() (dédoublonnage casse/ponctuation) ;
   *   le libellé affiché est le plus petit libellé nettoyé rencontré (déterministe).
   * - L'ordre des familles préserve l'ordre BEE ONE (tri sur le libellé brut
   *   minimal, préfixes numériques inclus) — identique au comportement antérieur.
   * - La surface d'une parcelle est la première valeur > 0 rencontrée (une ligne
   *   sans surface n'écrase pas une ligne qui en a une).
   * - Une famille sans aucun JH > 0 est exclue (comportement antérieur).
   *
   * @param {AnalytiqueRow[]} rows
   * @returns {{
   *   parcelles: Array<[string, number]>,
   *   operations: Array<{key: string, label: string}>,
   *   pivot: Object<string, Object<string, AnalytiquePivotCell>>
   * }}
   */
  function buildAnalytiquePivot(rows) {
    const parcelleSet = {};
    const pivot = {};
    const labels = {};   // key → libellé d'affichage retenu
    const sortKeys = {}; // key → plus petit libellé brut (préserve l'ordre numérique BEE ONE)
    (rows || []).forEach(function (r) {
      const ha = r.ha || 0;
      if (!(r.parcelle in parcelleSet) || (parcelleSet[r.parcelle] === 0 && ha > 0)) {
        parcelleSet[r.parcelle] = ha;
      }
      const key = opKey(r.operationFamille);
      const label = opLabel(r.operationFamille);
      const raw = String(r.operationFamille || '').trim();
      if (!(key in labels) || label < labels[key]) labels[key] = label;
      if (!(key in sortKeys) || raw < sortKeys[key]) sortKeys[key] = raw;
      if (!pivot[key]) pivot[key] = {};
      if (!pivot[key][r.parcelle]) {
        pivot[key][r.parcelle] = { jh: 0, cout: 0, ha: ha, detailRows: [] };
      }
      const cell = pivot[key][r.parcelle];
      cell.jh += r.jh || 0;
      cell.cout += r.cout || 0;
      if (cell.ha === 0 && ha > 0) cell.ha = ha;
      cell.detailRows.push(r);
    });
    const parcelles = Object.entries(parcelleSet).sort(function (a, b) { return a[0].localeCompare(b[0]); });
    const operations = Object.keys(pivot)
      .filter(function (key) {
        return Object.values(pivot[key]).some(function (c) { return c.jh > 0; });
      })
      .sort(function (a, b) { return sortKeys[a].localeCompare(sortKeys[b]); })
      .map(function (key) { return { key: key, label: labels[key] }; });
    return { parcelles: parcelles, operations: operations, pivot: pivot };
  }

  const __analytiqueUtilsApi = { opLabel, opKey, buildAnalytiquePivot };

  if (typeof module !== 'undefined' && module.exports) module.exports = __analytiqueUtilsApi;
  if (typeof window !== 'undefined') window.AnalytiqueUtils = __analytiqueUtilsApi;

})();
