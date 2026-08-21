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
        pivot[key][r.parcelle] = { jh: 0, cout: 0, coutCharge: 0, ha: ha, detailRows: [] };
      }
      const cell = pivot[key][r.parcelle];
      cell.jh += r.jh || 0;
      cell.cout += r.cout || 0;
      cell.coutCharge += r.coutCharge || 0;
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

  /**
   * Mapping Operation_Groupe (code GB) → Famille (niveau intermédiaire).
   * Source : référentiel Firestore referentiel_taches (11 familles).
   * Utilisé par buildAnalytiquePivotByFamille.
   */
  /** Mapping GB code → groupe MO (3 groupes). */
  var GB_GROUPE_MAP = {
    'GB01': 'M.O Hors récolte', 'GB02': 'M.O Hors récolte', 'GB03': 'M.O Hors récolte',
    'GB04': 'M.O Hors récolte', 'GB05': 'M.O Hors récolte', 'GB06': 'M.O Hors récolte',
    'GB07': 'M.O Hors récolte', 'GB09': 'M.O Hors récolte', 'GB10': 'M.O Hors récolte',
    'GB08': 'M.O Récolte',
    'GB11': 'M.O Service générale',
  };

  /** Ordre d'affichage des 3 groupes MO. */
  var GROUPE_ORDER = ['M.O Hors récolte', 'M.O Récolte', 'M.O Service générale'];

  /** Ordre canonique des familles GB01→GB11 dans le tableau. */
  var GB_ORDER = ['GB01','GB02','GB03','GB04','GB05','GB06','GB07','GB08','GB09','GB10','GB11'];

  var GROUPE_FAMILLE_MAP = {
    'GB01': 'Travaux du sol',
    'GB02': 'Ferti-irrigation',
    'GB03': 'Plantation',
    'GB04': 'Mise en valeur',
    'GB05': 'Entretien structure',
    'GB06': 'Traitement phyto',
    'GB07': 'Tuteurage & palissage',
    'GB08': 'Récolte',
    'GB09': 'Taille',
    'GB10': 'Arrachage',
    'GB11': 'Services généraux',
  };

  // Inverted lookup : normalized(operationFamille) → GB code
  // Sert de fallback quand Operation_Groupe est NULL dans BEE ONE.
  var _OP_FAM_TO_GB = (function () {
    function norm(s) {
      return String(s || '').toLowerCase()
        .replace(/[éèêë]/g, 'e').replace(/[àâ]/g, 'a').replace(/[ùû]/g, 'u')
        .replace(/[^a-z0-9]/g, '');
    }
    var m = {};
    // Noms canoniques
    Object.keys(GROUPE_FAMILLE_MAP).forEach(function (code) {
      m[norm(GROUPE_FAMILLE_MAP[code])] = code;
    });
    // Variantes BEE ONE fréquentes
    [
      ['GB02', 'Ferti Irrigation'], ['GB02', 'Fertirrigation'], ['GB02', 'Fert irrigation'],
      ['GB05', 'Entretien cultures'], ['GB05', 'Entretien culture'],
      ['GB05', 'Nettoyage'], ['GB05', 'Désherbage'], ['GB05', 'Desherbage'],
      ['GB05', 'Entretien des serres'], ['GB05', 'Entretien serres'],
      ['GB06', 'Traitement phyto/Désherbage'], ['GB06', 'Traitement phyto desherbage'],
      ['GB06', 'Traitement'], ['GB06', 'Phyto'],
      ['GB07', 'Tuteurage'], ['GB07', 'Palissage'], ['GB07', 'PALISSAGE'],
      ['GB07', 'Elimination des rejets'], ['GB07', 'élimination des rejets'],
      ['GB07', 'Elimination rejets'],
      ['GB08', 'Recolte'],
      ['GB11', 'Services generaux'], ['GB11', 'Service générale'],
      ['GB11', 'Service general'], ['GB11', 'Service généraux'],
      ['GB11', 'Postes fixes'], ['GB11', 'Poste fixe'],
      ['GB11', 'Caporal hors récolte'], ['GB11', 'Caporal hors recolte'],
      ['GB11', 'Caporal'], ['GB11', 'Caporales'],
    ].forEach(function (pair) { m[norm(pair[1])] = pair[0]; });
    return m;
  })();

  /** Normalise une chaîne pour la comparaison de noms de familles. */
  function _normFam(s) {
    return String(s || '').toLowerCase()
      .replace(/[éèêë]/g, 'e').replace(/[àâ]/g, 'a').replace(/[ùû]/g, 'u')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Résout le code GB à partir du champ operationGroupe (code GB direct) ou,
   * en fallback, depuis le libellé operationFamille via le dictionnaire inversé.
   * Retourne le code GB (ex: 'GB05') ou null si non reconnu.
   */
  function resolveGbCode(operationGroupe, operationFamille) {
    var code = String(operationGroupe || '').trim().toUpperCase();
    if (GROUPE_FAMILLE_MAP[code]) return code;
    // Nettoyer le libellé : retirer préfixe "N. " et suffixe " GBxx" avant lookup
    var famClean = String(operationFamille || '')
      .replace(/^\s*\d+\.\s*/, '')
      .replace(/\s*GB\d+\s*$/i, '')
      .trim();
    return _OP_FAM_TO_GB[_normFam(famClean)] || null;
  }

  /**
   * Résout le libellé famille à partir du champ operationGroupe.
   * Fallback : lookup par nom de famille, puis strip suffixe GBxx.
   *
   * @param {string|null|undefined} operationGroupe  ex: "GB01", "gb08 "
   * @returns {string}
   */
  function resolveGroupeFamille(operationGroupe, operationFamille) {
    var gb = resolveGbCode(operationGroupe, operationFamille);
    if (gb) return GROUPE_FAMILLE_MAP[gb];
    // Dernier recours : retirer préfixe numéroté et suffixe GBxx du libellé brut
    var fam = String(operationFamille || '')
      .replace(/^\s*\d+\.\s*/, '')
      .replace(/\s*GB\d+\s*$/i, '')
      .trim();
    return fam || 'Autre';
  }

  /**
   * @typedef {Object} AnalytiqueGroupedRow
   * @property {'groupe'|'famille'|'operation'} type
   * @property {string} key          — groupe: nom du groupe ; famille: code GB (GB01…GB11) ou
   *                                   'AUTRE' ; operation: '<gbCode>::<clé opKey normalisée>'
   * @property {string} label
   * @property {Object<string, {jh:number, cout:number, ha:number, detailRows:AnalytiqueRow[]}>} pivot
   * @property {string} [groupeKey]  — présent quand type==='famille' ou 'operation'
   * @property {string} [familleKey] — présent uniquement quand type==='operation' (code GB parent)
   */

  /**
   * Construit un pivot hiérarchique 3 groupes → 11 familles pour le mode Famille.
   *
   * Retourne `groupedRows` : liste plate alternant lignes en-tête groupe (type='groupe')
   * et lignes famille (type='famille', indentées). Le détail opération est accessible
   * via detailRows dans chaque cellule pivot, pour popup au clic.
   *
   * Option `{ detail: true }` : insère en plus, APRÈS chaque ligne famille, ses lignes
   * d'opérations fines (type='operation'), triées par JH total décroissant — même ordre
   * que la pop-up de détail. Les lignes famille restent présentes et inchangées : les
   * lignes opération sont un DÉTAIL de la famille, pas un remplacement.
   *
   * ⚠️ INVARIANT : les lignes opération ne sont JAMAIS typées 'famille'. Le `tfoot` du
   * tableau (et tout autre total) somme uniquement `type === 'famille'` — les typer
   * 'famille' doublerait tous les totaux.
   *
   * Sans `opts` (ou avec `{detail:false}`) la sortie est STRICTEMENT identique au
   * comportement historique (non-régression du mode Récap).
   *
   * @param {Array<AnalytiqueRow & {operationGroupe?: string, haRef?: number, operation?: string}>} rows
   * @param {{detail?: boolean}} [opts]
   * @returns {{ parcelles: Array<[string, number]>, groupedRows: AnalytiqueGroupedRow[] }}
   */
  /**
   * Somme des JH d'un pivot { [parcelle]: {jh, …} } — utilisé pour trier les
   * lignes opération par poids décroissant.
   *
   * @param {Object<string, {jh:number}>} pivot
   * @returns {number}
   */
  function sumJh(pivot) {
    return Object.keys(pivot || {}).reduce(function (s, p) { return s + (pivot[p].jh || 0); }, 0);
  }

  function buildAnalytiquePivotByFamille(rows, opts) {
    var wantDetail = !!(opts && opts.detail);
    // 1. Parcelles
    var parcelleMap = {};
    (rows || []).forEach(function (r) {
      var ha = r.ha || r.haRef || 0;
      if (!(r.parcelle in parcelleMap) || (parcelleMap[r.parcelle] === 0 && ha > 0))
        parcelleMap[r.parcelle] = ha;
    });
    var parcelles = Object.entries(parcelleMap).sort(function (a, b) { return a[0].localeCompare(b[0]); });

    // 2. Agréger par famille (GB code) et par groupe
    var famillePivot = {}; // { [gbCode]: { nom, groupeName, total: {[parc]: cell} } }
    var groupePivot  = {}; // { [groupeName]: { total: {[parc]: cell} } }
    // { [gbCode + ' ' + opKey(operation)]: { gbCode, opKeyNorm, label, groupeName, total } }
    // Alimenté systématiquement (coût négligeable) mais consommé seulement si opts.detail.
    var operationPivot = {};

    (rows || []).forEach(function (r) {
      var gbCode     = resolveGbCode(r.operationGroupe, r.operationFamille) || 'AUTRE';
      var gbNom      = GROUPE_FAMILLE_MAP[gbCode] || String(r.operationFamille || 'Autre').replace(/^\s*\d+\.\s*/, '').trim();
      var groupeName = GB_GROUPE_MAP[gbCode] || 'M.O Service générale';
      var parc = r.parcelle;
      var jh   = r.jh   || 0;
      var cout = r.cout  || 0;
      // Coût CHARGÉ (Σ JH × taux de l'ouvrier). `cout` reste le témoin BEE ONE
      // du rapprochement — il n'est jamais affiché comme de l'argent.
      var coutCharge = r.coutCharge || 0;
      var ha   = r.ha || r.haRef || 0;

      // Famille
      if (!famillePivot[gbCode]) famillePivot[gbCode] = { nom: gbNom, groupeName: groupeName, total: {} };
      var fam = famillePivot[gbCode];
      if (!fam.total[parc]) fam.total[parc] = { jh: 0, cout: 0, coutCharge: 0, ha: ha, detailRows: [] };
      fam.total[parc].jh   += jh;
      fam.total[parc].cout += cout;
      fam.total[parc].coutCharge += coutCharge;
      if (fam.total[parc].ha === 0 && ha > 0) fam.total[parc].ha = ha;
      fam.total[parc].detailRows.push(r);

      // Groupe
      if (!groupePivot[groupeName]) groupePivot[groupeName] = { total: {} };
      var grp = groupePivot[groupeName];
      if (!grp.total[parc]) grp.total[parc] = { jh: 0, cout: 0, coutCharge: 0, ha: ha, detailRows: [] };
      grp.total[parc].jh   += jh;
      grp.total[parc].cout += cout;
      grp.total[parc].coutCharge += coutCharge;
      if (grp.total[parc].ha === 0 && ha > 0) grp.total[parc].ha = ha;
      grp.total[parc].detailRows.push(r);

      // Opération fine (détail sous la famille) — même normalisation MÉCANIQUE que
      // le reste du module (opKey : préfixe numérique, casse, tirets). Aucun mapping
      // métier : « 3. Désherbage » et « désherbage » fusionnent, deux libellés
      // réellement différents restent deux lignes.
      var opKeyNorm = opKey(r.operation);
      var opRowKey  = gbCode + ' ' + opKeyNorm;
      if (!operationPivot[opRowKey]) operationPivot[opRowKey] = {
        gbCode: gbCode,
        opKeyNorm: opKeyNorm,
        label: opLabel(r.operation) || '—',
        groupeName: groupeName,
        total: {},
      };
      var op = operationPivot[opRowKey];
      if (!op.total[parc]) op.total[parc] = { jh: 0, cout: 0, coutCharge: 0, ha: ha, detailRows: [] };
      op.total[parc].jh   += jh;
      op.total[parc].cout += cout;
      op.total[parc].coutCharge += coutCharge;
      if (op.total[parc].ha === 0 && ha > 0) op.total[parc].ha = ha;
      op.total[parc].detailRows.push(r);
    });

    // 3. Liste plate : groupe header → familles triées GB01..GB11, puis AUTRE
    var groupedRows = [];
    var allGroupes = GROUPE_ORDER.slice();
    Object.keys(groupePivot).forEach(function(g) {
      if (allGroupes.indexOf(g) < 0) allGroupes.push(g);
    });

    allGroupes.forEach(function (groupeName) {
      if (!groupePivot[groupeName]) return;
      groupedRows.push({ type: 'groupe', key: groupeName, label: groupeName, pivot: groupePivot[groupeName].total });
      GB_ORDER.concat(['AUTRE']).forEach(function (gbCode) {
        var fam = famillePivot[gbCode];
        if (!fam || fam.groupeName !== groupeName) return;
        groupedRows.push({ type: 'famille', key: gbCode, label: fam.nom, pivot: fam.total, groupeKey: groupeName });
        if (!wantDetail) return;
        // Lignes opération de CETTE famille, triées par JH total décroissant (même
        // ordre que la pop-up de détail : `(a, b) => b.jh - a.jh`). Le tri natif est
        // stable → à JH égal, l'ordre de première apparition est conservé.
        Object.keys(operationPivot)
          .filter(function (k) { return operationPivot[k].gbCode === gbCode; })
          .map(function (k) { return operationPivot[k]; })
          .sort(function (a, b) { return sumJh(b.total) - sumJh(a.total); })
          .forEach(function (op) {
            groupedRows.push({
              type: 'operation',
              key: gbCode + '::' + op.opKeyNorm,
              label: op.label,
              pivot: op.total,
              familleKey: gbCode,
              groupeKey: groupeName,
            });
          });
      });
    });

    return { parcelles: parcelles, groupedRows: groupedRows };
  }

  const __analytiqueUtilsApi = { opLabel, opKey, buildAnalytiquePivot, resolveGroupeFamille, resolveGbCode, buildAnalytiquePivotByFamille, GB_GROUPE_MAP, GROUPE_ORDER, GB_ORDER };

  if (typeof module !== 'undefined' && module.exports) module.exports = __analytiqueUtilsApi;
  if (typeof window !== 'undefined') window.AnalytiqueUtils = __analytiqueUtilsApi;

})();
