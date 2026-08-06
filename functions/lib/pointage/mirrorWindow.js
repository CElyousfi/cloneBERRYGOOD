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
 */
// @ts-check
'use strict';

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
 * Reconstruit un periodeMap `{ "Quinzaine N": ["2026-03-15", ...] }` à partir
 * d'une liste de daily docs déjà filtrés (window appliquée en amont par
 * `filterDateIdsWithinWindow`). Extrait tel quel de la logique historique de
 * `rebuildPointageMetaFromMirror` pour rester testable indépendamment de
 * Firestore.
 *
 * @param {Array<{id: string, rows?: Array<{Periode_paie?: string, DateStr?: string}>}>} dailyDocs
 * @returns {Object<string, string[]>}
 */
function buildPeriodeMapFromDailyDocs(dailyDocs) {
  const periodeDates = {};
  for (const doc of dailyDocs || []) {
    const rows = (doc && doc.rows) || [];
    for (const r of rows) {
      const p = ((r && r.Periode_paie) || '').trim();
      if (!p) continue;
      if (!periodeDates[p]) periodeDates[p] = new Set();
      periodeDates[p].add((r && r.DateStr) || (doc && doc.id));
    }
  }
  const periodeMap = {};
  for (const p of Object.keys(periodeDates)) periodeMap[p] = [...periodeDates[p]].sort();
  return periodeMap;
}

module.exports = {
  REBUILD_WINDOW_DAYS,
  computeWindowCutoffId,
  filterDateIdsWithinWindow,
  buildPeriodeMapFromDailyDocs,
};
