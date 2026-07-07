/**
 * campagneUtils.js — Pure helpers for "campagne / phase" (fiscal-year scoping).
 *
 * Loaded twice (UMD-bricolé) :
 *   - Browser : <script src="lib/campagneUtils.js"> → window.CampagneUtils
 *   - node:test / backend : require('.../campagneUtils.js') → module.exports
 *
 * Source unique de vérité pour la notion de campagne (année fiscale Juillet N →
 * Juin N+1, label `${N}-${N+1}`) et de phase (primocane / floricane / unique).
 * Factorise le `campagneOf` qui était dupliqué inline dans :
 *   - functions/lib/mappingConso/resolver.js
 *   - public/app.jsx (helper local `bcCampagneOf` de MagBCTab)
 *
 * Toutes les fonctions sont pures (no DOM, no network, no Firestore).
 * Robustesse : toute date non ISO 'YYYY-MM-DD' → null / garde défensive.
 *
 * Spec : docs/spec-gestion-campagnes.md §§10-12. Item M0 (2026-06).
 *
 * IMPORTANT (mémoire #75 — collision global a déjà cassé l'app) : ce module
 * n'expose QU'UN SEUL global (`window.CampagneUtils`). Les const internes sont
 * préfixées `__cu_` pour éviter toute collision dans le scope global partagé
 * par les <script> non-modulaires.
 */
// @ts-check
'use strict';

// ============================================================================
// CONSTANTS (préfixe interne unique __cu_ — jamais exposées au global)
// ============================================================================

/** Regex stricte d'une date ISO 'YYYY-MM-DD'. */
const __cu_ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Regex stricte d'un libellé de campagne 'AAAA-BBBB'. */
const __cu_CAMPAGNE_RE = /^(\d{4})-(\d{4})$/;

/** Phase par défaut quand la culture n'a pas de bascule primocane/floricane. */
const __cu_PHASE_UNIQUE = 'unique';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Détermine la campagne (année fiscale Juillet N → Juin N+1) d'une date.
 *
 * Convention : `month >= 7 ? year : year-1` → `${start}-${start+1}`.
 * Frontière = 1er juillet. Reprise de resolver.js / pointageService.js.
 *
 * @param {string} dateStr  date 'YYYY-MM-DD'
 * @returns {string|null} libellé de campagne, ou null si date invalide
 */
function campagneOf(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.match(__cu_ISO_DATE_RE);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10); // 1-12
  const start = month >= 7 ? year : year - 1;
  return `${start}-${start + 1}`;
}

/**
 * Campagne courante = campagne de la date du jour (année fiscale Juillet→Juin).
 *
 * @param {string} [todayStr]  date 'YYYY-MM-DD' (défaut : aujourd'hui, TZ locale)
 * @returns {string|null} libellé de campagne, ou null si date invalide
 */
function campagneCourante(todayStr) {
  let d = todayStr;
  if (!d) {
    const now = new Date();
    const y = now.getFullYear();
    const mo = String(now.getMonth() + 1).padStart(2, '0');
    const da = String(now.getDate()).padStart(2, '0');
    d = `${y}-${mo}-${da}`;
  }
  return campagneOf(d);
}

/**
 * Premier jour (1er juillet) d'une campagne.
 *
 * @param {string} campagne  libellé 'AAAA-BBBB'
 * @returns {string|null} 'AAAA-07-01', ou null si libellé invalide
 */
function debutCampagne(campagne) {
  if (!campagne || typeof campagne !== 'string') return null;
  const m = campagne.match(__cu_CAMPAGNE_RE);
  if (!m) return null;
  return `${m[1]}-07-01`;
}

/**
 * Dernier jour (30 juin) d'une campagne.
 *
 * @param {string} campagne  libellé 'AAAA-BBBB'
 * @returns {string|null} 'BBBB-06-30', ou null si libellé invalide
 */
function finCampagne(campagne) {
  if (!campagne || typeof campagne !== 'string') return null;
  const m = campagne.match(__cu_CAMPAGNE_RE);
  if (!m) return null;
  return `${m[2]}-06-30`;
}

/**
 * Campagne de charge d'une date, avec cutoff optionnel qui TIRE le début vers
 * une campagne cible (spec §12.2).
 *
 * Règle : si un `cutoff_date` est fourni et que
 *   `cutoff_date <= date <= finCampagne(campagne_cible)`
 * alors la date est rattachée à `campagne_cible` (le cutoff tire le début, mais
 * la fin reste le 30 juin de la cible). Sinon, dérivation standard `campagneOf`.
 *
 * Cas tordu (DG §12) : une date APRÈS la fin de la cible (ex. 2027-07-10 pour une
 * cible 2026-2027) retombe sur la dérivation standard → 2027-2028.
 *
 * @param {Object} args
 * @param {string} args.date            date 'YYYY-MM-DD'
 * @param {string} [args.cutoff_date]   date 'YYYY-MM-DD' à partir de laquelle la cible s'applique
 * @param {string} [args.campagne_cible] libellé 'AAAA-BBBB'
 * @returns {string|null} libellé de campagne, ou null si date invalide
 */
function campagneDeCharge(args) {
  const opts = args || {};
  const date = opts.date;
  if (!date || typeof date !== 'string' || !__cu_ISO_DATE_RE.test(date)) return null;

  const cutoff = opts.cutoff_date;
  const cible = opts.campagne_cible;
  if (cutoff && typeof cutoff === 'string' && __cu_ISO_DATE_RE.test(cutoff) && cible) {
    const fin = finCampagne(cible);
    if (fin && cutoff <= date && date <= fin) return cible;
  }
  return campagneOf(date);
}

/**
 * Phase de charge d'une date selon la bascule primocane → floricane (spec §11).
 *
 * Règle : `date < bascule_date ? 'primocane' : 'floricane'`. Si aucune
 * `bascule_date` n'est fournie (culture sans phase) → 'unique'.
 *
 * @param {Object} args
 * @param {string} args.date            date 'YYYY-MM-DD'
 * @param {string} [args.bascule_date]  date 'YYYY-MM-DD' de bascule primocane→floricane
 * @returns {string|null} 'primocane' | 'floricane' | 'unique', ou null si date invalide
 */
function phaseDeCharge(args) {
  const opts = args || {};
  const date = opts.date;
  if (!date || typeof date !== 'string' || !__cu_ISO_DATE_RE.test(date)) return null;

  const bascule = opts.bascule_date;
  if (!bascule || typeof bascule !== 'string' || !__cu_ISO_DATE_RE.test(bascule)) {
    return __cu_PHASE_UNIQUE;
  }
  return date < bascule ? 'primocane' : 'floricane';
}

// ============================================================================
// UMD-bricolé : un seul global exposé (window.CampagneUtils)
// ============================================================================

const __cu_api = {
  campagneOf,
  campagneCourante,
  debutCampagne,
  finCampagne,
  campagneDeCharge,
  phaseDeCharge,
};

if (typeof module !== 'undefined' && module.exports) module.exports = __cu_api;
if (typeof window !== 'undefined') window.CampagneUtils = __cu_api;
