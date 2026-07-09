'use strict';
// @ts-check

/**
 * parcellesParams.js — Logique PURE de l'écran « Paramètres Parcelles ».
 *
 * Deux responsabilités, toutes deux sans I/O (testables en node:test) :
 *   1. `aggregateParcellesFromMirror` : réduit des lignes brutes du mirror
 *      `sql_mirror_pointage` (déjà filtrées par ferme en amont) en une liste de
 *      parcelles DISTINCTES de la campagne (ref + label + variété + culture +
 *      ferme), avec `statut` dérivé (a du pointage sur la campagne → 'active').
 *   2. `mergeReferentiel` : LEFT-JOIN de cette liste avec le référentiel
 *      `parcelle_ferme_referentiel` (clé `${campagne}__${ref}`) pour enrichir
 *      `surface_ha` / `surface_source` / `campagne_assignee`. Le référentiel est
 *      AUTHORITATIVE (BEE ONE) pour la surface ; tant qu'il est vide (serveur BEE
 *      ONE down), la surface s'affiche « manquante » (dégradé gracieux voulu).
 *
 * Cloisonnement : le filtrage ferme (chef → ses parcelles) est fait AVANT
 * l'agrégation par l'appelant (via `deriveFerme`/`_fermeFilter`), exactement
 * comme les autres actions de pointageService. Ce module ne connaît pas les
 * rôles : il reçoit des lignes déjà cloisonnées.
 *
 * IMPORTANT : CommonJS backend. Aucun require de '../public/...'.
 */

/**
 * Normalise une valeur en string trimée ('' si null/undefined).
 * @param {*} v
 * @returns {string}
 */
function str(v) {
  return v == null ? '' : String(v).trim();
}

/**
 * @typedef {Object} ParcelleAgg
 * @property {string} ref            Ref_parcelle
 * @property {string} label          Parcelle_Culturale (label dominant)
 * @property {string} ferme          ferme SB dérivée
 * @property {string} culture        Culture (best-effort, dominante)
 * @property {string} variete        Variete (best-effort, dominante)
 * @property {string} statut         'active' (a du pointage sur la campagne)
 */

/**
 * Agrège des lignes brutes du mirror en parcelles distinctes.
 *
 * Clé de regroupement = `ref` (Ref_parcelle) non vide. Une parcelle sans ref
 * exploitable est ignorée (pas de clé référentiel stable). Le label / la variété
 * / la culture retenus sont ceux de la PREMIÈRE occurrence non vide (best-effort,
 * comme le reste du référentiel). La ferme est calculée par `deriveFermeFn`
 * (injection de dépendance — le module reste pur).
 *
 * @param {Array<Object>} rows          lignes mirror (Ref_parcelle, Parcelle_Culturale, Variete, Culture, DateStr)
 * @param {(refParcelle:*, label:*, campagne?:string)=>string} deriveFermeFn
 * @param {string} campagne             libellé campagne (passé à deriveFermeFn)
 * @returns {Array<ParcelleAgg>}        parcelles triées par ref croissant
 */
function aggregateParcellesFromMirror(rows, deriveFermeFn, campagne) {
  const byRef = new Map();
  const list = Array.isArray(rows) ? rows : [];
  for (const r of list) {
    const ref = str(r && r.Ref_parcelle);
    if (!ref) continue; // pas de clé référentiel stable → ignorée
    let agg = byRef.get(ref);
    if (!agg) {
      agg = {
        ref,
        label: '',
        ferme: '',
        culture: '',
        variete: '',
        statut: 'active', // présent dans le mirror de la campagne ⇒ actif
      };
      byRef.set(ref, agg);
    }
    if (!agg.label) agg.label = str(r.Parcelle_Culturale);
    if (!agg.culture) agg.culture = str(r.Culture);
    if (!agg.variete) agg.variete = str(r.Variete);
    if (!agg.ferme) {
      const f = deriveFermeFn ? deriveFermeFn(r.Ref_parcelle, r.Parcelle_Culturale, campagne) : '';
      agg.ferme = str(f);
    }
  }
  return Array.from(byRef.values()).sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
}

/**
 * LEFT-JOIN parcelles agrégées × référentiel `parcelle_ferme_referentiel`.
 *
 * Pour chaque parcelle, on cherche le doc référentiel `${campagne}__${ref}` dans
 * `refByKey` (Map<docId, docData>). On enrichit :
 *   - `surface_ha` : `ref.surface_ha` si présent (number fini), sinon null.
 *   - `surface_source` : 'beeone' si surface présente, sinon 'manquante'.
 *   - `campagne_derivee` : la campagne demandée (dérivée du mirror).
 *   - `campagne_assignee` : override manuel `ref.campagne_assignee` si présent,
 *     sinon la dérivée (défaut = dérivée, cf. spec §7.3).
 *
 * La surface n'est JAMAIS dérivée/inventée : absente → « manquante ». Le
 * référentiel vide (serveur down) ⇒ toutes les surfaces « manquantes » (dégradé
 * gracieux voulu).
 *
 * @param {Array<ParcelleAgg>} parcelles
 * @param {Map<string, Object>|null|undefined} refByKey  Map<docId, docData>
 * @param {string} campagne
 * @returns {Array<Object>} lignes prêtes pour l'écran
 */
function mergeReferentiel(parcelles, refByKey, campagne) {
  const map = refByKey instanceof Map ? refByKey : new Map();
  const list = Array.isArray(parcelles) ? parcelles : [];
  return list.map((p) => {
    const doc = map.get(`${campagne}__${p.ref}`) || null;
    let surfaceHa = null;
    if (doc && typeof doc.surface_ha === 'number' && isFinite(doc.surface_ha)) {
      surfaceHa = doc.surface_ha;
    }
    const surfaceSource = surfaceHa != null ? 'beeone' : 'manquante';
    const campagneDerivee = campagne;
    const assignee = doc && str(doc.campagne_assignee) ? str(doc.campagne_assignee) : campagneDerivee;
    return {
      ref: p.ref,
      label: p.label,
      ferme: p.ferme,
      culture: p.culture,
      variete: p.variete,
      surface_ha: surfaceHa,
      surface_source: surfaceSource,
      campagne_derivee: campagneDerivee,
      campagne_assignee: assignee,
      statut: p.statut,
    };
  });
}

/**
 * Valide un libellé de campagne 'AAAA-BBBB' (bornes cohérentes B == A+1).
 * @param {*} campagne
 * @returns {boolean}
 */
function isValidCampagneLabel(campagne) {
  const s = str(campagne);
  const m = s.match(/^(\d{4})-(\d{4})$/);
  if (!m) return false;
  return parseInt(m[2], 10) === parseInt(m[1], 10) + 1;
}

module.exports = {
  aggregateParcellesFromMirror,
  mergeReferentiel,
  isValidCampagneLabel,
};
