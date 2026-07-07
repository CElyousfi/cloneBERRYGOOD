/**
 * campagnePeriodes.js — Helpers purs pour ordonner les quinzaines par CAMPAGNE
 * puis par NUMÉRO (fin du bug "Quinzaine 24" juin > "Quinzaine 01" juillet).
 *
 * La campagne d'une quinzaine est DÉRIVÉE des dates de son `periodeMap` :
 *   campagne = campagneOf(min(dates de la quinzaine))
 * (année fiscale Juillet N → Juin N+1, cf. campagneUtils.campagneOf).
 *
 * Source unique : le meta pointage. Ce module ne fait AUCUN accès Firestore /
 * réseau — pur, testable en node:test, sans DOM.
 *
 * UMD-bricolé : module.exports (backend / node:test).
 */
// @ts-check
'use strict';

/** Extrait le numéro d'une quinzaine ("Quinzaine 24" → 24). */
function quinzaineNum(label) {
  const m = String(label || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/**
 * Construit le mapping { "Quinzaine N": "AAAA-BBBB" } à partir du periodeMap et
 * d'une fonction campagneOf. La campagne d'une quinzaine = campagne de sa date
 * la plus ancienne. Quinzaine sans date connue → non mappée (absente du retour).
 *
 * @param {Object<string,string[]>} periodeMap  { label: [dates ISO] }
 * @param {(d:string)=>(string|null)} campagneOf
 * @returns {Object<string,string>} { label: campagne }
 */
function buildPeriodeCampagne(periodeMap, campagneOf) {
  const out = {};
  if (!periodeMap || typeof periodeMap !== 'object') return out;
  for (const label of Object.keys(periodeMap)) {
    const dates = (periodeMap[label] || []).filter(Boolean).slice().sort();
    if (dates.length === 0) continue;
    const camp = campagneOf(dates[0]);
    if (camp) out[label] = camp;
  }
  return out;
}

/**
 * Comparateur (campagne DESC, puis numéro DESC). Une quinzaine sans campagne
 * connue est reléguée en fin de liste (campagne '' triée après tout).
 *
 * @param {Object<string,string>} periodeCampagne  { label: campagne }
 * @returns {(a:string,b:string)=>number}
 */
function makeCampagneAwareComparator(periodeCampagne) {
  const pc = periodeCampagne || {};
  return (a, b) => {
    const ca = pc[a] || '';
    const cb = pc[b] || '';
    if (ca !== cb) {
      // campagne DESC ; les inconnues ('') vont en fin
      if (!ca) return 1;
      if (!cb) return -1;
      return cb < ca ? -1 : 1;
    }
    return quinzaineNum(b) - quinzaineNum(a); // numéro DESC
  };
}

/**
 * Trie une liste de labels par (campagne DESC, numéro DESC), copie non mutante.
 *
 * @param {string[]} periodes
 * @param {Object<string,string>} periodeCampagne
 * @returns {string[]}
 */
function sortPeriodesByCampagne(periodes, periodeCampagne) {
  return (periodes || []).slice().sort(makeCampagneAwareComparator(periodeCampagne));
}

/**
 * Période par défaut = 1re quinzaine de la CAMPAGNE COURANTE (plus grand numéro
 * de la campagne d'aujourd'hui). Si la campagne courante n'a aucune quinzaine
 * dans la liste (ex. tout début de campagne, meta pas encore ré-enrichi, ou
 * periodeCampagne absent), fallback = première de la liste déjà triée (ancien
 * comportement) → aucun écran vide, aucun crash.
 *
 * `periodes` est SUPPOSÉE déjà triée (campagne DESC, numéro DESC) par le meta.
 *
 * @param {string[]} periodes
 * @param {Object<string,string>} periodeCampagne
 * @param {string} campagneCourante  libellé 'AAAA-BBBB' de la campagne du jour
 * @returns {string|undefined}
 */
function defaultPeriodeForCampagne(periodes, periodeCampagne, campagneCourante) {
  const list = periodes || [];
  if (list.length === 0) return undefined;
  const pc = periodeCampagne || {};
  if (campagneCourante) {
    // periodes triée campagne DESC puis numéro DESC → la 1re de la campagne
    // courante rencontrée est bien son plus grand numéro.
    const hit = list.find((p) => pc[p] === campagneCourante);
    if (hit) return hit;
  }
  return list[0];
}

module.exports = {
  quinzaineNum,
  buildPeriodeCampagne,
  makeCampagneAwareComparator,
  sortPeriodesByCampagne,
  defaultPeriodeForCampagne,
};
