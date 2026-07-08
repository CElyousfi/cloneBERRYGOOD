'use strict';
// @ts-check
/**
 * pullHealth.js — Détection pure de la PANNE DU PULL horaire du pointage
 * (« mode b »), complémentaire de probeStaleness.js (« mode a » = panne SOURCE).
 *
 * Contexte : le cron `sqlToFirestoreSync` ("5 * * * *") tire le pointage de la
 * BDP vers le mirror Firestore. Deux pannes NE sont PAS couvertes par la sonde
 * de staleness source :
 *   1. le cron plante en boucle (SQL down, timeout…) → `consecutiveFailures`
 *      s'accumule dans `sql_sync_status/latest` mais personne n'est alerté ;
 *   2. le pull se casse SILENCIEUSEMENT alors que la BDP est fraîche → le mirror
 *      (`sql_mirror_pointage_meta/config.availableDates`) prend du retard sur la
 *      source (`pointage_max_date` de la sonde) sans que le compteur d'échecs
 *      bouge (ex. échec partiel non remonté).
 *
 * Ce module compare le MAX du mirror au MAX de la BDP : il est WEEKEND-SAFE par
 * construction (un week-end où la BDP est aussi gelée donne lag≈0 → pas de faux
 * positif). Aucune dépendance Firestore/SQL : tout est injecté et pur.
 */

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;

/**
 * Normalise une valeur de date (Date | string 'YYYY-MM-DD...' | Timestamp-like)
 * en timestamp ms UTC à minuit, ou null si non interprétable.
 * @param {*} v
 * @returns {number|null}
 */
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const ms = Date.parse(s + 'T00:00:00Z');
    return Number.isNaN(ms) ? null : ms;
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : Date.parse(v.toISOString().slice(0, 10) + 'T00:00:00Z');
  }
  if (typeof v.toDate === 'function') {
    try {
      const d = v.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime())
        ? Date.parse(d.toISOString().slice(0, 10) + 'T00:00:00Z')
        : null;
    } catch (_) { return null; }
  }
  return null;
}

/**
 * Formatte un timestamp ms en 'JJ/MM' (UTC), ou '?' si null.
 * @param {number|null} ms
 * @returns {string}
 */
function ddmm(ms) {
  if (ms == null) return '?';
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return dd + '/' + mm;
}

/**
 * @typedef {Object} PullHealth
 * @property {boolean} alert
 * @property {'pull_failing'|'mirror_lag'|null} kind
 * @property {number|null} lagHours  retard mirror↔BDP en heures (mirror_lag), sinon null
 * @property {number|null} consecutiveFailures  reporté (pull_failing), sinon null
 * @property {string} reason
 */

/**
 * Calcule l'état de santé du PULL horaire du pointage.
 *
 * Règles (dans l'ordre) :
 *  1. `consecutiveFailures >= 2`                                → 'pull_failing'
 *  2. sinon si mirrorMaxDate ET bdpMaxDate lisibles ET
 *     (bdpMaxDate − mirrorMaxDate) > 24h                        → 'mirror_lag'
 *  3. sinon                                                     → pas d'alerte
 *
 * Données illisibles/manquantes (dates ou compteur) → PAS d'alerte : on ne veut
 * pas alerter sur une erreur de lecture transitoire.
 *
 * @param {Object} args
 * @param {*} args.consecutiveFailures  sql_sync_status/latest.consecutiveFailures
 * @param {*} args.mirrorMaxDate        max de availableDates (Date|string|Timestamp)
 * @param {*} args.bdpMaxDate           pointage_max_date de la sonde (source BDP)
 * @param {Date} args.now               non utilisé pour la décision (compat signature), injecté
 * @returns {PullHealth}
 */
function computePullHealth(args) {
  const cf = Number(args.consecutiveFailures);

  // 1. Cron en panne : échecs consécutifs.
  if (!Number.isNaN(cf) && cf >= 2) {
    return {
      alert: true,
      kind: 'pull_failing',
      lagHours: null,
      consecutiveFailures: cf,
      reason: 'cron sqlToFirestoreSync a échoué ' + cf + ' fois consécutives',
    };
  }

  // 2. Mirror en retard sur la source.
  const mirrorMs = toMs(args.mirrorMaxDate);
  const bdpMs = toMs(args.bdpMaxDate);
  if (mirrorMs == null || bdpMs == null) {
    return {
      alert: false,
      kind: null,
      lagHours: null,
      consecutiveFailures: null,
      reason: 'dates mirror/BDP illisibles — pas d\'alerte (lecture transitoire)',
    };
  }

  const lagHours = Math.round((bdpMs - mirrorMs) / MS_PER_HOUR);
  if (bdpMs - mirrorMs > 24 * MS_PER_HOUR) {
    return {
      alert: true,
      kind: 'mirror_lag',
      lagHours,
      consecutiveFailures: null,
      reason: 'mirror (' + ddmm(mirrorMs) + ') en retard de ' + lagHours +
        'h sur la BDP (' + ddmm(bdpMs) + ')',
    };
  }

  return {
    alert: false,
    kind: null,
    lagHours: lagHours >= 0 ? lagHours : 0,
    consecutiveFailures: null,
    reason: 'pull sain (mirror=' + ddmm(mirrorMs) + ', BDP=' + ddmm(bdpMs) + ')',
  };
}

/**
 * Décide s'il faut (ré-)émettre une alerte « mode b », avec débounce.
 *
 * - Première détection → alerter.
 * - Panne persistante → rappel seulement si le dernier envoi remonte à plus de
 *   `reAlertHours` (défaut 24h).
 * - Changement de kind (pull_failing ↔ mirror_lag) → alerter immédiatement.
 * - Retour au vert alors qu'une alerte était active → message 'resolved'.
 *
 * État distinct de celui de la staleness source (mode a) : NE PAS partager le
 * même doc/champ de débounce.
 *
 * @param {PullHealth} health
 * @param {Object|null} state  {lastAlertAt, stillAlerting, kind}
 * @param {Date} now
 * @param {number} [reAlertHours] défaut 24
 * @returns {{shouldSend:boolean, kind:'alert'|'reminder'|'resolved'|null, nextState:Object}}
 */
function decidePullAlert(health, state, now, reAlertHours) {
  const hours = reAlertHours == null ? 24 : reAlertHours;
  const prev = state || {};
  const wasAlerting = prev.stillAlerting === true;
  const nowIso = now.toISOString();

  if (health.alert) {
    const lastAlertMs = prev.lastAlertAt ? Date.parse(prev.lastAlertAt) : null;
    const kindChanged = wasAlerting && prev.kind !== health.kind;
    let shouldSend;
    let outKind;
    if (!wasAlerting) {
      shouldSend = true;
      outKind = 'alert';
    } else if (kindChanged) {
      shouldSend = true;
      outKind = 'alert';
    } else if (lastAlertMs == null || (now.getTime() - lastAlertMs) >= hours * MS_PER_HOUR) {
      shouldSend = true;
      outKind = 'reminder';
    } else {
      shouldSend = false;
      outKind = null;
    }
    const nextState = {
      stillAlerting: true,
      kind: health.kind,
      lastAlertAt: shouldSend ? nowIso : (prev.lastAlertAt || null),
      since: wasAlerting ? (prev.since || nowIso) : nowIso,
      updatedAt: nowIso,
    };
    return { shouldSend, kind: outKind, nextState };
  }

  // Sain
  if (wasAlerting) {
    return {
      shouldSend: true,
      kind: 'resolved',
      nextState: {
        stillAlerting: false,
        kind: null,
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
      stillAlerting: false,
      kind: null,
      lastAlertAt: prev.lastAlertAt || null,
      updatedAt: nowIso,
    },
  };
}

/**
 * Construit le message WhatsApp single-line (param template general_alert).
 * Meta rejette (131008) tout param avec '\n', tab ou espaces multiples : chaque
 * variante est sur une seule ligne + collapse final des espaces.
 *
 * @param {'alert'|'reminder'|'resolved'} kind
 * @param {PullHealth} health
 * @param {Object} [ctx]  {lastSuccessLabel}
 * @returns {string}
 */
function buildPullMessage(kind, health, ctx) {
  const c = ctx || {};
  let msg;
  if (kind === 'resolved') {
    msg = '✅ Pull pointage rétabli. Le mirror se remet à jour depuis la source.';
  } else {
    const rappel = kind === 'reminder' ? ' (RAPPEL — toujours en panne)' : '';
    if (health.kind === 'pull_failing') {
      const last = c.lastSuccessLabel ? c.lastSuccessLabel : '?';
      msg = '🔴 SmartBerry — pull pointage en panne' + rappel + ' : le cron a échoué ' +
        health.consecutiveFailures + ' fois (dernier succès ' + last + '). Données figées.';
    } else {
      msg = '🔴 SmartBerry — mirror pointage en retard' + rappel + ' de ' +
        health.lagHours + 'h sur la source. Pull cassé, source OK.';
    }
  }
  return String(msg).replace(/\s+/g, ' ').trim();
}

module.exports = {
  computePullHealth,
  decidePullAlert,
  buildPullMessage,
  toMs,
  ddmm,
};
