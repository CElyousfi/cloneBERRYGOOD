'use strict';
// @ts-check
/**
 * probeStaleness.js — Détection pure de la STALENESS (fraîcheur) des données de
 * pointage remontées par la sonde de réplication (BR_Pointage / BDP).
 *
 * Contexte : la source de reporting peut se FIGER (non-vide mais gelée) sans que
 * la table ne soit vide. L'ancienne alerte ne se déclenchait que sur table VIDE
 * (0 ligne). Ce module compare l'ÂGE DE LA DONNÉE (MAX(Periode_Date)) au dernier
 * jour ouvré attendu, en tolérant les week-ends et jours fériés, pour alerter
 * dès qu'une panne silencieuse gèle la source.
 *
 * Tout est PUR (pas d'effet de bord) : dates, jours fériés et "maintenant" sont
 * injectés. La décision de ré-alerte (débounce 24h) est aussi pure.
 */

const MS_PER_DAY = 86400000;

/**
 * @param {Date} d
 * @returns {string} YYYY-MM-DD (UTC)
 */
function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * @param {string} iso YYYY-MM-DD
 * @returns {Date} minuit UTC
 */
function isoToDate(iso) {
  return new Date(iso + 'T00:00:00Z');
}

/**
 * Normalise une valeur de date SQL/Firestore (Date | string | Timestamp) en
 * chaîne 'YYYY-MM-DD', ou null si non interprétable.
 * @param {*} v
 * @returns {string|null}
 */
function normalizeMaxDate(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? null : toIsoDate(v);
  }
  // Firestore Timestamp-like
  if (typeof v.toDate === 'function') {
    try {
      const d = v.toDate();
      return d instanceof Date && !isNaN(d.getTime()) ? toIsoDate(d) : null;
    } catch (_) { return null; }
  }
  return null;
}

/**
 * Un jour est-il ouvré ? (ni samedi/dimanche, ni férié)
 * @param {string} iso YYYY-MM-DD
 * @param {Set<string>} holidays ensemble de dates fériées 'YYYY-MM-DD'
 * @returns {boolean}
 */
function isWorkingDay(iso, holidays) {
  const d = isoToDate(iso);
  const dow = d.getUTCDay(); // 0=dimanche, 6=samedi
  if (dow === 0 || dow === 6) return false;
  if (holidays && holidays.has(iso)) return false;
  return true;
}

/**
 * Dernier jour ouvré attendu à la date `todayIso` : si aujourd'hui est ouvré,
 * on attend au minimum du pointage pour HIER (dernier jour ouvré strictement
 * avant aujourd'hui). Le pointage du jour même peut légitimement ne pas encore
 * être saisi tôt le matin — on ne l'exige donc pas ici.
 *
 * On remonte au dernier jour ouvré < today. Si today n'est pas ouvré (week-end
 * / férié), on remonte quand même au dernier jour ouvré, ce qui rend la sonde
 * tolérante : un lundi matin, la donnée de vendredi reste "fraîche".
 *
 * @param {string} todayIso
 * @param {Set<string>} holidays
 * @param {number} [maxLookback] garde-fou (jours), défaut 14
 * @returns {string|null} dernier jour ouvré attendu, ou null si introuvable
 */
function lastExpectedWorkingDay(todayIso, holidays, maxLookback) {
  const cap = maxLookback == null ? 14 : maxLookback;
  let d = isoToDate(todayIso);
  for (let i = 0; i < cap; i++) {
    d = new Date(d.getTime() - MS_PER_DAY);
    const iso = toIsoDate(d);
    if (isWorkingDay(iso, holidays)) return iso;
  }
  return null;
}

/**
 * Nombre de jours calendaires entre deux dates ISO (toIso - fromIso).
 * @param {string} fromIso
 * @param {string} toIso
 * @returns {number}
 */
function daysBetween(fromIso, toIso) {
  return Math.round((isoToDate(toIso).getTime() - isoToDate(fromIso).getTime()) / MS_PER_DAY);
}

/**
 * @typedef {Object} StalenessResult
 * @property {boolean} stale       true si une alerte est requise
 * @property {'empty'|'frozen'|null} condition  cause de la staleness
 * @property {string|null} maxDate  MAX(Periode_Date) normalisé
 * @property {number|null} dataAgeDays  âge de la donnée (jours calendaires) vs today
 * @property {string|null} expectedWorkingDay  dernier jour ouvré attendu
 * @property {string} reason  message technique court
 */

/**
 * Calcule si la donnée de pointage est périmée.
 *
 * Règle :
 *  - table VIDE (totalRows === 0)                       → stale (condition 'empty')
 *  - MAX(Periode_Date) < dernier jour ouvré attendu     → stale (condition 'frozen')
 *  - sinon                                              → frais
 *
 * @param {Object} args
 * @param {*} args.maxDate           MAX(Periode_Date) (Date | string | Timestamp | null)
 * @param {number} args.totalRows    nombre total de lignes source
 * @param {Date} args.now            "maintenant" injecté
 * @param {string[]|Set<string>} [args.holidays]  dates fériées 'YYYY-MM-DD'
 * @returns {StalenessResult}
 */
function computeStaleness(args) {
  const now = args.now;
  const todayIso = toIsoDate(now);
  const holidays = args.holidays instanceof Set
    ? args.holidays
    : new Set(args.holidays || []);
  const maxDate = normalizeMaxDate(args.maxDate);
  const totalRows = Number(args.totalRows);

  // 1. Table vide
  if (!Number.isNaN(totalRows) && totalRows === 0) {
    return {
      stale: true,
      condition: 'empty',
      maxDate,
      dataAgeDays: null,
      expectedWorkingDay: null,
      reason: 'table BR_Pointage vide (0 ligne)',
    };
  }

  const expected = lastExpectedWorkingDay(todayIso, holidays);
  const dataAgeDays = maxDate ? daysBetween(maxDate, todayIso) : null;

  // 2. Non-vide mais pas de MAX(date) exploitable → suspect, on alerte.
  if (!maxDate) {
    return {
      stale: true,
      condition: 'frozen',
      maxDate: null,
      dataAgeDays: null,
      expectedWorkingDay: expected,
      reason: 'MAX(Periode_Date) illisible alors que la table est non-vide',
    };
  }

  // 3. Donnée figée : le max de la source est antérieur au dernier jour ouvré attendu.
  if (expected && maxDate < expected) {
    return {
      stale: true,
      condition: 'frozen',
      maxDate,
      dataAgeDays,
      expectedWorkingDay: expected,
      reason: `donnée périmée: max=${maxDate} < jour ouvré attendu=${expected}`,
    };
  }

  return {
    stale: false,
    condition: null,
    maxDate,
    dataAgeDays,
    expectedWorkingDay: expected,
    reason: 'donnée fraîche',
  };
}

/**
 * Décide s'il faut (ré-)émettre une alerte, en respectant un débounce.
 *
 * - Première détection (aucune alerte antérieure pour cette condition) → alerter.
 * - Staleness persistante → rappel seulement si le dernier envoi remonte à plus
 *   de `reAlertHours` (défaut 24h).
 * - Changement de condition (ex. frozen → empty) → alerter immédiatement.
 * - Donnée redevenue fraîche alors qu'une alerte était active → message de
 *   RÉSOLUTION (kind: 'resolved').
 *
 * @param {StalenessResult} staleness
 * @param {Object|null} state  état persistant précédent {lastAlertAt, stillStale, condition}
 * @param {Date} now
 * @param {number} [reAlertHours] défaut 24
 * @returns {{shouldSend:boolean, kind:'alert'|'reminder'|'resolved'|null, nextState:Object}}
 */
function decideAlert(staleness, state, now, reAlertHours) {
  const hours = reAlertHours == null ? 24 : reAlertHours;
  const prev = state || {};
  const wasStale = prev.stillStale === true;
  const nowIso = now.toISOString();

  if (staleness.stale) {
    const lastAlertMs = prev.lastAlertAt ? Date.parse(prev.lastAlertAt) : null;
    const conditionChanged = wasStale && prev.condition !== staleness.condition;
    let shouldSend;
    let kind;
    if (!wasStale) {
      shouldSend = true;
      kind = 'alert';
    } else if (conditionChanged) {
      shouldSend = true;
      kind = 'alert';
    } else if (lastAlertMs == null || (now.getTime() - lastAlertMs) >= hours * 3600000) {
      shouldSend = true;
      kind = 'reminder';
    } else {
      shouldSend = false;
      kind = null;
    }
    const nextState = {
      stillStale: true,
      condition: staleness.condition,
      lastAlertAt: shouldSend ? nowIso : (prev.lastAlertAt || null),
      since: wasStale ? (prev.since || nowIso) : nowIso,
      updatedAt: nowIso,
    };
    return { shouldSend, kind, nextState };
  }

  // Donnée fraîche
  if (wasStale) {
    return {
      shouldSend: true,
      kind: 'resolved',
      nextState: {
        stillStale: false,
        condition: null,
        lastAlertAt: prev.lastAlertAt || null,
        recoveredAt: nowIso,
        updatedAt: nowIso,
      },
    };
  }
  return {
    shouldSend: false,
    kind: null,
    nextState: {
      stillStale: false,
      condition: null,
      lastAlertAt: prev.lastAlertAt || null,
      updatedAt: nowIso,
    },
  };
}

module.exports = {
  normalizeMaxDate,
  isWorkingDay,
  lastExpectedWorkingDay,
  daysBetween,
  computeStaleness,
  decideAlert,
  toIsoDate,
};
