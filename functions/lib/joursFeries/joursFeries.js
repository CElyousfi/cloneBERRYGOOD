'use strict';
// @ts-check
/**
 * joursFeries.js — Synchronisation des jours fériés Maroc (fixes + lunaires).
 *
 * Source unique : Firestore app_settings/jours_feries. Les fêtes religieuses
 * (lunaires) ne sont confirmées qu'à l'approche (veille au soir). Ce module
 * fusionne une source API réputée (date.nager.at) dans le document existant :
 *  - jamais écraser une entrée manualOverride (vérité RH prioritaire) ;
 *  - réaligner la date des fêtes islamiques depuis l'API ;
 *  - passer le statut 'estime' → 'confirme' quand l'événement est imminent ;
 *  - notifier RH/DG quand une fête imminente est confirmée ou change de date.
 *
 * La logique de fusion est pure (mergeHolidays) ; les effets de bord (fetch,
 * Firestore, notif) sont injectés (runSyncJoursFeries(deps)) pour testabilité.
 */

// ── Mapping noms API (anglais) → libellé canonique fr + type ──────────────
// date.nager.at renvoie des noms anglais pour les fêtes islamiques.
const NAGER_ISLAMIC_MAP = [
  { match: ['eid al-fitr', 'eid ul-fitr', 'end of ramadan'], label: 'Aïd Al Fitr' },
  { match: ['eid al-adha', 'eid ul-adha', 'feast of the sacrifice'], label: 'Aïd Al Adha' },
  { match: ['islamic new year', 'hijri new year', "muharram", 'al-hijra'], label: '1er Moharram' },
  { match: ["prophet's birthday", "prophet muhammad's birthday", 'mawlid', 'mouloud'], label: 'Aïd Al Mawlid' },
];

/**
 * @typedef {Object} Holiday
 * @property {string} date  YYYY-MM-DD
 * @property {string} label
 * @property {'fixe'|'islamique'} type
 * @property {'fixe'|'estime'|'confirme'} status
 * @property {string} [source]  'seed'|'api'|'rh'
 * @property {boolean} [manualOverride]
 * @property {string} [updatedAt]
 */

function addDaysIso(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso + 'T12:00:00Z').getTime();
  const b = new Date(toIso + 'T12:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

function baseLabel(label) {
  return String(label || '').replace(/\s*\(2e jour\)\s*$/i, '').trim();
}
function isSecondDay(label) {
  return /\(2e jour\)/i.test(String(label || ''));
}

/**
 * Classe une entrée brute date.nager.at en {label, type} canonique.
 * @param {{name?:string, localName?:string}} h
 * @returns {{label:string, type:'fixe'|'islamique'}}
 */
function classifyNager(h) {
  const hay = `${(h.name || '')} ${(h.localName || '')}`.toLowerCase();
  for (const entry of NAGER_ISLAMIC_MAP) {
    if (entry.match.some(m => hay.includes(m))) return { label: entry.label, type: 'islamique' };
  }
  return { label: h.localName || h.name || 'Jour férié', type: 'fixe' };
}

/**
 * Fusionne les fériés API dans la liste existante (pure, sans effet de bord).
 * @param {Holiday[]} existing
 * @param {Array<{date:string, name?:string, localName?:string}>} apiHolidays
 * @param {{todayIso:string, nowIso:string, horizonDays?:number, notifyWithinDays?:number}} opts
 * @returns {{holidays:Holiday[], notifications:Array, changed:boolean}}
 */
function mergeHolidays(existing, apiHolidays, opts) {
  const todayIso = opts.todayIso;
  const nowIso = opts.nowIso || todayIso;
  const horizonDays = opts.horizonDays == null ? 5 : opts.horizonDays;
  const notifyWithinDays = opts.notifyWithinDays == null ? 2 : opts.notifyWithinDays;

  const result = (existing || []).map(h => Object.assign({}, h));
  const notifications = [];
  let changed = false;

  // Index API : libellé islamique canonique + année → date de base
  const apiIslamicByLabelYear = {};
  for (const h of apiHolidays || []) {
    const c = classifyNager(h);
    if (c.type === 'islamique') {
      apiIslamicByLabelYear[`${c.label}|${h.date.slice(0, 4)}`] = h.date;
    }
  }

  // 1. Réaligner les fêtes islamiques existantes depuis l'API
  for (const e of result) {
    if (e.type !== 'islamique') continue;
    if (e.manualOverride) continue; // RH prioritaire
    const year = e.date.slice(0, 4);
    const apiBase = apiIslamicByLabelYear[`${baseLabel(e.label)}|${year}`];
    if (!apiBase) continue;
    const newDate = isSecondDay(e.label) ? addDaysIso(apiBase, 1) : apiBase;
    const dStart = daysBetween(todayIso, newDate);
    const withinHorizon = dStart >= 0 && dStart <= horizonDays;
    const newStatus = withinHorizon ? 'confirme' : 'estime';
    const dateChanged = newDate !== e.date;
    const statusChanged = newStatus !== e.status;
    if (!dateChanged && !statusChanged) continue;
    const imminent = dStart >= 0 && dStart <= notifyWithinDays;
    if (imminent && (dateChanged || newStatus === 'confirme')) {
      notifications.push({
        date: newDate, label: e.label, oldDate: e.date,
        dateChanged, confirmed: newStatus === 'confirme',
      });
    }
    e.date = newDate;
    e.status = newStatus;
    e.source = 'api';
    e.updatedAt = nowIso;
    changed = true;
  }

  // 2. Ajouter les fériés API absents de la liste
  const existingDates = new Set(result.map(h => h.date));
  for (const h of apiHolidays || []) {
    if (existingDates.has(h.date)) continue;
    const c = classifyNager(h);
    if (c.type === 'islamique') {
      // déjà couvert par une entrée existante (même libellé+année) → skip l'ajout
      const year = h.date.slice(0, 4);
      const covered = result.some(e =>
        e.type === 'islamique' && baseLabel(e.label) === c.label && e.date.slice(0, 4) === year);
      if (covered) continue;
    }
    const dStart = daysBetween(todayIso, h.date);
    const status = c.type === 'islamique'
      ? (dStart >= 0 && dStart <= horizonDays ? 'confirme' : 'estime')
      : 'fixe';
    result.push({
      date: h.date, label: c.label, type: c.type, status,
      source: 'api', manualOverride: false, updatedAt: nowIso,
    });
    existingDates.add(h.date);
    changed = true;
  }

  result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { holidays: result, notifications, changed };
}

/**
 * Orchestration du job (DI). Récupère l'API pour l'année courante + suivante,
 * fusionne, écrit si changé, notifie les fêtes imminentes.
 * @param {string} todayIso  YYYY-MM-DD (Africa/Casablanca)
 * @param {Object} deps
 * @param {(year:string)=>Promise<Array>} deps.fetchHolidays
 * @param {()=>Promise<{holidays?:Holiday[]}|null>} deps.getExisting
 * @param {(doc:object)=>Promise<void>} deps.saveDoc
 * @param {(notif:object)=>Promise<void>} [deps.notify]
 * @param {()=>string} [deps.nowIso]
 * @param {(msg:string)=>void} [deps.logger]
 * @returns {Promise<{changed:boolean, count:number, notified:number}>}
 */
async function runSyncJoursFeries(todayIso, deps) {
  const log = deps.logger || (() => {});
  const nowIso = (deps.nowIso ? deps.nowIso() : new Date().toISOString());
  const year = Number(todayIso.slice(0, 4));
  const years = [String(year), String(year + 1)];

  const apiHolidays = [];
  for (const y of years) {
    try {
      const list = await deps.fetchHolidays(y);
      if (Array.isArray(list)) apiHolidays.push(...list);
    } catch (e) {
      log(`[syncJoursFeries] fetch ${y} échec: ${e.message}`);
    }
  }
  if (apiHolidays.length === 0) {
    log('[syncJoursFeries] aucune donnée API — abandon (pas d\'écrasement)');
    return { changed: false, count: 0, notified: 0 };
  }

  const existingDoc = await deps.getExisting();
  const existing = (existingDoc && Array.isArray(existingDoc.holidays)) ? existingDoc.holidays : [];

  const { holidays, notifications, changed } = mergeHolidays(existing, apiHolidays, { todayIso, nowIso });

  if (changed) {
    await deps.saveDoc({ holidays, lastSyncAt: nowIso, syncSource: 'api', updatedAt: nowIso });
    log(`[syncJoursFeries] écrit ${holidays.length} fériés (changements détectés)`);
  } else {
    log('[syncJoursFeries] aucun changement');
  }

  let notified = 0;
  if (deps.notify) {
    for (const n of notifications) {
      try { await deps.notify(n); notified++; }
      catch (e) { log(`[syncJoursFeries] notif échec (${n.label}): ${e.message}`); }
    }
  }
  return { changed, count: holidays.length, notified };
}

const NAGER_BASE = 'https://date.nager.at/api/v3/PublicHolidays';

/**
 * Fetch production des fériés Maroc pour une année (date.nager.at, sans clé).
 * @param {string} year
 * @returns {Promise<Array>}
 */
async function fetchNagerHolidays(year) {
  const res = await fetch(`${NAGER_BASE}/${year}/MA`);
  if (!res.ok) throw new Error(`date.nager.at HTTP ${res.status}`);
  return res.json();
}

const CRON_CONFIG = Object.freeze({
  schedule: '0 5 * * *',          // 05:00 chaque jour
  timeZone: 'Africa/Casablanca',
  region: 'europe-west1',
  timeoutSeconds: 120,
  memorySize: '256MB',
});

const HTTP_CONFIG = Object.freeze({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memorySize: '256MB',
  rewritePath: '/api/run-sync-jours-feries-now',
});

module.exports = {
  classifyNager,
  mergeHolidays,
  runSyncJoursFeries,
  fetchNagerHolidays,
  addDaysIso,
  daysBetween,
  baseLabel,
  isSecondDay,
  CRON_CONFIG,
  HTTP_CONFIG,
};
