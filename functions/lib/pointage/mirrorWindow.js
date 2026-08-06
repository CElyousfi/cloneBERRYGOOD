/**
 * mirrorWindow.js — Helpers purs pour borner la reconstruction du meta
 * pointage (`rebuildPointageMetaFromMirror` dans sqlSyncService.js) à une
 * fenêtre glissante récente, au lieu de scanner TOUT l'historique.
 *
 * Pourquoi : la numérotation "Quinzaine N" est réinitialisée à 01 à chaque
 * nouvelle campagne agricole (cf. campagnePeriodes.js). Un scan sans fenêtre
 * de `sql_mirror_pointage` indexe uniquement par le libellé "Quinzaine N" et
 * fusionne donc les dates de deux campagnes distinctes qui partagent le même
 * numéro (ex. "Quinzaine 15" campagne 2024-2025 ET 2025-2026) sous la même
 * clé de periodeMap. `buildPeriodeCampagne` prend ensuite la date la plus
 * ancienne du lot fusionné pour dériver la campagne de TOUTE la quinzaine →
 * mal-attribution silencieuse d'une partie des dates.
 *
 * Fix : borner le scan à ~400 jours glissants (une campagne dure ~365 jours,
 * frontière 1er juillet → 30 juin, cf. campagneUtils.js). Cette fenêtre est
 * assez large pour couvrir une campagne complète + marge, mais trop courte
 * pour englober deux campagnes distinctes partageant le même numéro de
 * quinzaine dans la plupart des cas réels.
 *
 * Pur : aucun accès Firestore / réseau — testable en node:test.
 * UMD-bricolé : module.exports (backend / node:test).
 *
 * FIX RACINE (2026-08) : la fenêtre de 400 jours seule est mathématiquement
 * insuffisante — deux campagnes CONSÉCUTIVES ont forcément leurs quinzaines à
 * moins de 400 jours d'écart (une campagne dure ~365 jours), donc la fenêtre
 * ne peut jamais les séparer. `buildPeriodeMapFromDailyDocs` groupe désormais
 * les dates par (label, CAMPAGNE) via `campagnePeriodes.buildDisambiguatedPeriodeMap`
 * — élimine la fusion à la source, peu importe la fenêtre. La fenêtre de 400
 * jours reste un filet utile pour purger les tout vieux daily docs (≥2 ans).
 */
// @ts-check
'use strict';

const { buildDisambiguatedPeriodeMap } = require('./campagnePeriodes');

/** Fenêtre par défaut, en jours (~1 campagne agricole + marge). */
const REBUILD_WINDOW_DAYS = 400;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Formate une Date en identifiant 'YYYY-MM-DD' (UTC, cohérent avec les IDs de
 * documents `sql_mirror_pointage/{YYYY-MM-DD}`).
 *
 * @param {Date} d
 * @returns {string}
 */
function toDateId(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Calcule l'identifiant de date cutoff (borne basse incluse) pour une fenêtre
 * glissante de `windowDays` jours se terminant à `now`.
 *
 * @param {Date|string} [now]  date d'ancrage (défaut : maintenant)
 * @param {number} [windowDays]  taille de la fenêtre en jours (défaut : REBUILD_WINDOW_DAYS)
 * @returns {string} 'YYYY-MM-DD'
 */
function computeWindowCutoffId(now, windowDays) {
  const days = windowDays == null ? REBUILD_WINDOW_DAYS : windowDays;
  const base = now instanceof Date ? now : new Date(now || Date.now());
  const cutoff = new Date(base.getTime() - days * MS_PER_DAY);
  return toDateId(cutoff);
}

/**
 * Filtre une liste d'identifiants de dates 'YYYY-MM-DD' pour ne garder que
 * ceux compris dans la fenêtre glissante [now - windowDays, now]. Comparaison
 * lexicographique de strings ISO = comparaison chronologique.
 *
 * @param {string[]} dateIds
 * @param {Date|string} [now]
 * @param {number} [windowDays]
 * @returns {string[]}
 */
function filterDateIdsWithinWindow(dateIds, now, windowDays) {
  const cutoffId = computeWindowCutoffId(now, windowDays);
  return (dateIds || []).filter((id) => typeof id === 'string' && id >= cutoffId);
}

/**
 * Reconstruit `{ periodeMap, periodeCampagne }` à partir d'une liste de daily
 * docs déjà filtrés (window appliquée en amont par `filterDateIdsWithinWindow`).
 *
 * Campagne-aware : chaque (label, date) est groupé par (label, campagneOf(date))
 * AVANT toute fusion — deux campagnes qui réutilisent le même numéro de
 * quinzaine ne fusionnent jamais sous la même clé de periodeMap, même sans
 * fenêtre (cf. `campagnePeriodes.buildDisambiguatedPeriodeMap`).
 *
 * @param {Array<{id: string, rows?: Array<{Periode_paie?: string, DateStr?: string}>}>} dailyDocs
 * @param {(d:string)=>(string|null)} campagneOf
 * @returns {{periodeMap: Object<string,string[]>, periodeCampagne: Object<string,string>}}
 */
function buildPeriodeMapFromDailyDocs(dailyDocs, campagneOf) {
  const entries = [];
  for (const doc of dailyDocs || []) {
    const rows = (doc && doc.rows) || [];
    for (const r of rows) {
      const p = ((r && r.Periode_paie) || '').trim();
      if (!p) continue;
      entries.push({ label: p, date: (r && r.DateStr) || (doc && doc.id) });
    }
  }
  return buildDisambiguatedPeriodeMap(entries, campagneOf);
}

module.exports = {
  REBUILD_WINDOW_DAYS,
  computeWindowCutoffId,
  filterDateIdsWithinWindow,
  buildPeriodeMapFromDailyDocs,
};
