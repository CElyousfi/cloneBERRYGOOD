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

/**
 * Regex d'un label désambiguïsé "Quinzaine N (AAAA-BBBB)" — le suffixe ajouté
 * par `buildDisambiguatedPeriodeMap` pour distinguer une occurrence ANCIENNE
 * d'un numéro de quinzaine réutilisé par une campagne plus récente.
 */
const COMPOSITE_LABEL_RE = / \((\d{4}-\d{4})\)$/;

/**
 * Détecte si un label de quinzaine est composite (désambiguïsé) et, si oui,
 * extrait le label brut (celui connu de `Periode_paie` en SQL/mirror/archive,
 * qui ne contient JAMAIS le suffixe de campagne) + la campagne suffixée.
 *
 * @param {string} label
 * @returns {{rawLabel: string, campagne: string|null, isComposite: boolean}}
 */
function splitCompositeLabel(label) {
  const str = String(label || '');
  const m = str.match(COMPOSITE_LABEL_RE);
  if (!m) return { rawLabel: str, campagne: null, isComposite: false };
  return { rawLabel: str.slice(0, str.length - m[0].length), campagne: m[1], isComposite: true };
}

/**
 * Filtre une liste de rows (portant un champ `DateStr`) pour ne garder que
 * celles dont la date appartient à `dates`. Garde-fou de résolution de
 * requête : après avoir matché des lignes SQL/mirror par LABEL BRUT (ambigu
 * entre deux campagnes partageant le même numéro de quinzaine), on ne fait
 * jamais confiance au matching par label seul — on filtre explicitement par
 * la liste de dates exacte issue de `periodeMap[label composite]`.
 *
 * @param {Array<{DateStr?: string}>} rows
 * @param {string[]|undefined|null} dates
 * @returns {Array}
 */
function filterRowsByExactDates(rows, dates) {
  if (!Array.isArray(dates)) return rows || [];
  const dateSet = new Set(dates);
  return (rows || []).filter((r) => r && dateSet.has(r.DateStr));
}

/**
 * Groupe des paires (label, date) par label PUIS par campagne — sans jamais
 * fusionner deux campagnes sous la même clé de sortie — puis dérive les
 * sorties `periodeMap`/`periodeCampagne` déjà consommées par le reste du
 * système, en désambiguïsant les labels en collision.
 *
 * Fonction pure UNIQUE réutilisée par tous les chemins qui construisent le
 * meta pointage (chemin normal ET self-heal `rebuildPointageMetaFromMirror`)
 * — évite de dupliquer la logique de désambiguïsation à deux endroits qui
 * pourraient diverger silencieusement.
 *
 * Règle de désambiguïsation, par label :
 * - 1 seule campagne présente → sortie inchangée (comportement actuel
 *   préservé pour l'immense majorité des labels, non-régression).
 * - ≥2 campagnes partagent le label → la campagne la plus RÉCENTE garde le
 *   label tel quel (compat rétroactive maximale, c'est celle qui est en
 *   cours d'utilisation) ; les autres campagnes reçoivent un label composite
 *   `"<label> (AAAA-BBBB)"` qui devient la clé dans periodeMap/periodeCampagne.
 * - Dates dont `campagneOf` ne peut rien déduire (format invalide) sont
 *   regroupées sous une campagne '' — jamais fusionnées avec une campagne
 *   connue, mais aussi jamais suffixées si c'est l'unique groupe du label
 *   (comportement legacy de `buildPeriodeCampagne`, qui ignore ces dates).
 *
 * @param {Array<{label: string, date: string}>} entries
 * @param {(d:string)=>(string|null)} campagneOf
 * @returns {{periodeMap: Object<string,string[]>, periodeCampagne: Object<string,string>}}
 */
function buildDisambiguatedPeriodeMap(entries, campagneOf) {
  /** @type {Object<string, Object<string, Set<string>>>} */
  const byLabel = {};
  for (const e of entries || []) {
    if (!e) continue;
    const label = String(e.label || '').trim();
    const date = e.date;
    if (!label || !date) continue;
    const camp = campagneOf(date) || '';
    if (!byLabel[label]) byLabel[label] = {};
    if (!byLabel[label][camp]) byLabel[label][camp] = new Set();
    byLabel[label][camp].add(date);
  }

  /** @type {Object<string,string[]>} */
  const periodeMap = {};
  /** @type {Object<string,string>} */
  const periodeCampagne = {};

  for (const label of Object.keys(byLabel)) {
    const campKeys = Object.keys(byLabel[label]);
    // Tri campagne DESC (plus récente d'abord) ; '' (campagne inconnue) en dernier.
    campKeys.sort((a, b) => {
      if (a === b) return 0;
      if (!a) return 1;
      if (!b) return -1;
      return b < a ? -1 : 1;
    });
    campKeys.forEach((camp, idx) => {
      const dates = [...byLabel[label][camp]].sort();
      const outLabel = idx === 0 ? label : `${label} (${camp})`;
      periodeMap[outLabel] = dates;
      if (camp) periodeCampagne[outLabel] = camp;
    });
  }

  return { periodeMap, periodeCampagne };
}

module.exports = {
  quinzaineNum,
  buildPeriodeCampagne,
  makeCampagneAwareComparator,
  sortPeriodesByCampagne,
  defaultPeriodeForCampagne,
  splitCompositeLabel,
  filterRowsByExactDates,
  buildDisambiguatedPeriodeMap,
};
