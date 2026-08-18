'use strict';
// @ts-check
/**
 * sprayDigest.js — Digest WhatsApp quotidien « Météo & Traitements » (07h00
 * Africa/Casablanca) : température prévue du jour + fenêtres de traitement
 * phyto, envoyé au DG, au chef F1 (Framboise) et au chef F5 (Myrtille).
 *
 * Orchestrateur pur en injection de dépendances (cf. meteoblueProxy.js) :
 * aucun accès direct Firestore ni réseau ici. Le câblage prod
 * (getMeteoblueCached + whatsappService) vit dans functions/index.js.
 *
 * La logique de fenêtres est le portage backend de `transformSprayData`
 * (public/app.jsx) restreint à UN jour.
 */

/**
 * @typedef {Object} SprayWindows
 * @property {Array<{de:number, a:number}>} fenetres Plages horaires favorables
 *   (heure de début incluse, heure de fin exclue, en heures locales).
 * @property {number} bonCount   Heures ouvrées favorables (spraywindow === 1).
 * @property {number} moyenCount Heures ouvrées modérées (spraywindow === 2).
 * @property {number} mauvaisCount Heures ouvrées défavorables (spraywindow === 0).
 * @property {number} totalWork  Nombre d'heures ouvrées (6h → 20h inclus).
 * @property {number} score      Score du jour, 0-100.
 */

/**
 * @typedef {Object} TempSummary
 * @property {number|null} tMin
 * @property {number|null} tMax
 * @property {number|null} ventMax
 * @property {number|null} pluie
 * @property {number|null} pictocode
 */

/** Première heure ouvrée prise en compte pour un traitement. */
const WORK_HOUR_START = 6;
/** Dernière heure ouvrée prise en compte (incluse). */
const WORK_HOUR_END = 20;

const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

const CRON_CONFIG = Object.freeze({
  schedule: '0 7 * * *',
  timeZone: 'Africa/Casablanca',
  region: 'europe-west1',
  timeoutSeconds: 120,
  memorySize: '256MB',
});

const HTTP_CONFIG = Object.freeze({
  region: 'europe-west1',
  timeoutSeconds: 120,
  memorySize: '256MB',
  rewritePath: '/api/meteo-spray-digest',
});

/** F1 et F5 partagent la même localisation physique. */
const COORDS = Object.freeze({ lat: 35.08, lon: -6.14, altitude: 49 });

const AUDIENCE = Object.freeze([
  { profileId: 'dg', ferme: null },
  { profileId: 'chef_f1', ferme: 'F1' },
  { profileId: 'chef_f5', ferme: 'F5' },
]);

/**
 * Profils autorisés à déclencher un ENVOI réel via le trigger HTTP (les modes
 * `preview` et `checkRecipients`, qui n'envoient rien, restent ouverts à tout
 * utilisateur authentifié). Même convention que pointageService.js
 * (`['dg', 'rh', 'admin'].includes(profileId)`).
 */
const TRIGGER_SEND_ROLES = Object.freeze(['dg', 'dt', 'admin']);

const TEMPLATE_NAME = 'meteo_spray_digest';
const FALLBACK_TEMPLATE_NAME = 'general_alert';

/**
 * Codes d'erreur Meta déclenchant le repli sur `general_alert` — tous liés au
 * template ou à ses paramètres, donc rejouables sur un template plus simple :
 * 131008 = paramètre invalide (le body `{{2}}` est multi-ligne, cf.
 * whatsappService.toSingleLine), 132001 = template introuvable / non approuvé,
 * 132007 = template rejeté / non conforme à la policy, 132012 = format du
 * paramètre non conforme à l'exemple, 132018 = incohérence de paramètres.
 */
const FALLBACK_ERROR_CODES = ['131008', '132001', '132007', '132012', '132018'];

/** Format YYYY-MM-DD au fuseau Africa/Casablanca, indépendant du fuseau process. */
const CASABLANCA_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Casablanca',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Date du jour (YYYY-MM-DD) au fuseau Africa/Casablanca. Le Maroc est à UTC+1
 * la majeure partie de l'année MAIS repasse à UTC+0 pendant le Ramadan : on
 * délègue à Intl plutôt que d'ajouter un offset fixe (un décalage codé en dur
 * renverrait la date de demain pour un appel entre 23h et minuit en Ramadan).
 * @param {Date} [now]
 * @returns {string}
 */
function todayCasablancaISO(now) {
  const base = now instanceof Date ? now : new Date();
  return CASABLANCA_DATE_FMT.format(base);
}

/**
 * Libellé qualitatif du score, aligné sur le badge de l'écran Météo
 * (public/app.jsx : `score >= 70 ? 'Favorable' : score >= 40 ? 'Partiel' :
 * 'Défavorable'`). Les seuils DOIVENT rester identiques des deux côtés.
 * @param {number} score
 * @returns {string}
 */
function scoreLabel(score) {
  if (score >= 70) return 'Favorable';
  if (score >= 40) return 'Partiel';
  return 'Défavorable';
}

/**
 * « 20% (Défavorable) » — le pourcentage seul se lit mal sur mobile.
 * @param {number} score
 * @returns {string}
 */
function formatScore(score) {
  return score + '% (' + scoreLabel(score) + ')';
}

/**
 * Formate une heure entière en « 06h00 ».
 * @param {number} h
 * @returns {string}
 */
function formatHeure(h) {
  return String(h).padStart(2, '0') + 'h00';
}

/**
 * Arrondit à une décimale, sans imposer de décimale inutile.
 * @param {number} n
 * @returns {number}
 */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * « Jeu 14/08 » depuis une date ISO. Parsing manuel (pas de `new Date(iso)`)
 * pour rester indépendant du fuseau du process.
 * @param {string} dateISO
 * @returns {string}
 */
function formatDateParam(dateISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO || ''));
  if (!m) return String(dateISO || '');
  const jour = JOURS_COURTS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  return jour + ' ' + m[3] + '/' + m[2];
}

/**
 * Construit le résumé des fenêtres de traitement pour UN jour.
 * Portage backend de `transformSprayData` (public/app.jsx) : groupement par
 * jour, filtrage des heures ouvrées, comptage bon/moyen/mauvais et extraction
 * des plages consécutives de `spraywindow === 1`.
 *
 * @param {object|null|undefined} sprayData Réponse brute du package
 *   `agromodelspray-1h` (`data_1h.time` + `data_1h.spraywindow`).
 * @param {string} dateISO YYYY-MM-DD
 * @returns {SprayWindows|null} null si données absentes ou jour introuvable.
 */
function buildSprayWindows(sprayData, dateISO) {
  if (!sprayData || !sprayData.data_1h) return null;
  const times = sprayData.data_1h.time;
  const spray = sprayData.data_1h.spraywindow;
  if (!Array.isArray(times) || !Array.isArray(spray)) return null;

  const entries = [];
  times.forEach(function(t, i) {
    const parts = String(t || '').split(' ');
    if (parts[0] !== dateISO) return;
    const heure = parseInt(parts[1], 10);
    if (!Number.isFinite(heure)) return;
    entries.push({ heure: heure, value: spray[i] });
  });
  if (!entries.length) return null;

  const workHours = entries.filter(function(e) {
    return e.heure >= WORK_HOUR_START && e.heure <= WORK_HOUR_END;
  });
  const bonCount = workHours.filter(function(e) { return e.value === 1; }).length;
  const moyenCount = workHours.filter(function(e) { return e.value === 2; }).length;
  const mauvaisCount = workHours.filter(function(e) { return e.value === 0; }).length;

  /** @type {Array<{de:number, a:number}>} */
  const fenetres = [];
  let start = null;
  workHours.forEach(function(e, idx) {
    if (e.value === 1) {
      if (start === null) start = e.heure;
      return;
    }
    if (start === null) return;
    // `start !== null` implique idx >= 1, donc `prev` est défini pour un
    // tableau d'heures contigu (cas nominal, identique au frontend). Le repli
    // `e.heure - 1` ne sert que si Meteoblue renvoyait un tableau troué, où
    // l'heure précédente du tableau n'est pas l'heure précédente de l'horloge.
    const prev = workHours[idx - 1];
    fenetres.push({ de: start, a: (prev ? prev.heure : e.heure - 1) + 1 });
    start = null;
  });
  if (start !== null) {
    fenetres.push({ de: start, a: workHours[workHours.length - 1].heure + 1 });
  }

  const totalWork = workHours.length;
  return {
    fenetres: fenetres,
    bonCount: bonCount,
    moyenCount: moyenCount,
    mauvaisCount: mauvaisCount,
    totalWork: totalWork,
    score: totalWork > 0 ? Math.round((bonCount + moyenCount * 0.5) / totalWork * 100) : 0,
  };
}

/**
 * Extrait les valeurs journalières (température, vent, pluie, pictocode).
 * @param {object|null|undefined} weatherData Réponse brute du package weather.
 * @param {string} dateISO YYYY-MM-DD
 * @returns {TempSummary|null} null si le jour est absent.
 */
function buildTempSummary(weatherData, dateISO) {
  if (!weatherData || !weatherData.data_day) return null;
  const day = weatherData.data_day;
  if (!Array.isArray(day.time)) return null;
  const idx = day.time.indexOf(dateISO);
  if (idx === -1) return null;
  const pick = function(arr) {
    if (!Array.isArray(arr)) return null;
    const v = arr[idx];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return {
    tMin: pick(day.temperature_min),
    tMax: pick(day.temperature_max),
    ventMax: pick(day.windspeed_max),
    pluie: pick(day.precipitation),
    pictocode: pick(day.pictocode),
  };
}

/**
 * Met en forme le digest : paramètre de date du template, corps multi-ligne
 * (style dailyProductionReport) et repli aplati sur une ligne.
 *
 * @param {{dateISO: string, temp: TempSummary|null, windows: SprayWindows|null}} input
 * @returns {{dateParam: string, body: string, fallbackText: string}}
 */
function formatDigest(input) {
  const dateISO = input && input.dateISO;
  const temp = input ? input.temp : null;
  const windows = input ? input.windows : null;
  const dateParam = formatDateParam(dateISO);

  const lines = [];
  const flat = [];

  if (temp && (temp.tMin !== null || temp.tMax !== null)) {
    const tMin = temp.tMin !== null ? Math.round(temp.tMin) + '°C' : '?';
    const tMax = temp.tMax !== null ? Math.round(temp.tMax) + '°C' : '?';
    lines.push('🌡️ *Température* : ' + tMin + ' → ' + tMax);
    flat.push('Température ' + tMin + ' à ' + tMax);
    if (temp.ventMax !== null) {
      lines.push('💨 Vent max : ' + Math.round(temp.ventMax) + ' km/h');
      flat.push('vent max ' + Math.round(temp.ventMax) + ' km/h');
    }
    if (temp.pluie !== null) {
      lines.push('🌧️ Pluie : ' + round1(temp.pluie) + ' mm');
      flat.push('pluie ' + round1(temp.pluie) + ' mm');
    }
  } else {
    lines.push('🌡️ *Température* : donnée météo indisponible');
    flat.push('Température indisponible');
  }

  lines.push('');

  if (!windows) {
    lines.push('⚠️ Fenêtres de traitement indisponibles');
    flat.push('fenêtres de traitement indisponibles');
  } else if (!windows.fenetres.length) {
    lines.push('🚫 Aucun créneau favorable aujourd\'hui');
    lines.push('Score du jour : ' + formatScore(windows.score));
    flat.push('aucun créneau favorable aujourd\'hui');
    flat.push('score ' + formatScore(windows.score));
  } else {
    lines.push('✅ *Fenêtres de traitement* :');
    windows.fenetres.forEach(function(f) {
      lines.push('• ' + formatHeure(f.de) + ' - ' + formatHeure(f.a));
    });
    lines.push('Score du jour : ' + formatScore(windows.score));
    flat.push('créneaux ' + windows.fenetres.map(function(f) {
      return formatHeure(f.de) + '-' + formatHeure(f.a);
    }).join(', '));
    flat.push('score ' + formatScore(windows.score));
  }

  const fallbackText = ('Météo & Traitements ' + dateParam + ' : ' + flat.join(', '))
    .replace(/\s+/g, ' ')
    .trim();

  return { dateParam: dateParam, body: lines.join('\n'), fallbackText: fallbackText };
}

/**
 * Un envoi doit-il être rejoué via `general_alert` ?
 * @param {*} outcome Résultat brut d'un `Promise.allSettled`.
 * @returns {boolean}
 */
function shouldFallback(outcome) {
  let msg = '';
  if (outcome && outcome.status === 'rejected') {
    msg = String((outcome.reason && outcome.reason.message) || outcome.reason || '');
  } else if (outcome && outcome.status === 'fulfilled') {
    const v = outcome.value;
    if (v && v.success) return false;
    msg = String((v && v.error) || '');
  }
  return FALLBACK_ERROR_CODES.some(function(code) { return msg.indexOf(code) !== -1; });
}

/**
 * @typedef {Object} MeteoDigestDeps
 * @property {(coords: {lat:number, lon:number, altitude:number}, pkg: string) => Promise<object|null>} getMeteoblue
 * @property {{
 *   resolveRecipientsForProfile: (profileId: string, ferme: string|null) => Promise<Array<object>>,
 *   sendTemplateMessage: (to: string, templateName: string, bodyParams: Array<string>, lang: string|undefined, toName: string|undefined) => Promise<object>,
 *   toSingleLine: (s: *) => string,
 * }} whatsapp
 * @property {() => Date} [now]
 */

/**
 * Fabrique le job « digest météo & traitements ».
 * @param {MeteoDigestDeps} deps
 * @returns {{run: (dateISO?: string, opts?: object) => Promise<object>}}
 */
function createMeteoDigestJob(deps) {
  if (!deps || typeof deps.getMeteoblue !== 'function' || !deps.whatsapp) {
    throw new TypeError('createMeteoDigestJob: deps.getMeteoblue et deps.whatsapp requis');
  }
  const whatsapp = deps.whatsapp;
  const now = typeof deps.now === 'function' ? deps.now : function() { return new Date(); };

  /**
   * @param {string} [dateISO]
   * @param {{preview?: boolean, checkRecipients?: boolean}} [opts]
   */
  async function run(dateISO, opts) {
    const options = opts || {};
    const day = dateISO || todayCasablancaISO(now());

    // Tolérant : une des deux sources peut manquer → cas dégradé, pas de throw.
    const [weatherData, sprayData] = await Promise.all([
      Promise.resolve()
        .then(function() { return deps.getMeteoblue(COORDS, 'weather'); })
        .catch(function(err) {
          console.warn('[meteoSprayDigest] weather fetch failed:', err && err.message);
          return null;
        }),
      Promise.resolve()
        .then(function() { return deps.getMeteoblue(COORDS, 'spray'); })
        .catch(function(err) {
          console.warn('[meteoSprayDigest] spray fetch failed:', err && err.message);
          return null;
        }),
    ]);

    const temp = buildTempSummary(weatherData, day);
    const windows = buildSprayWindows(sprayData, day);
    const digest = formatDigest({ dateISO: day, temp: temp, windows: windows });

    if (options.preview) {
      return {
        preview: true,
        dateISO: day,
        dateParam: digest.dateParam,
        body: digest.body,
        fallbackText: digest.fallbackText,
      };
    }

    const resolved = await Promise.all(AUDIENCE.map(function(a) {
      return Promise.resolve()
        .then(function() { return whatsapp.resolveRecipientsForProfile(a.profileId, a.ferme); })
        .catch(function(err) {
          console.error('[meteoSprayDigest] resolve failed for ' + a.profileId + ':', err && err.message);
          return [];
        })
        .then(function(list) { return { audience: a, recipients: list || [] }; });
    }));

    // Contenu identique pour tous → un même numéro ne reçoit qu'une fois.
    const byPhone = new Map();
    resolved.forEach(function(r) {
      r.recipients.forEach(function(rec) {
        if (!rec || !rec.phone || byPhone.has(rec.phone)) return;
        byPhone.set(rec.phone, {
          phone: rec.phone,
          displayName: rec.displayName || '',
          uid: rec.uid || null,
          profileId: r.audience.profileId,
          ferme: r.audience.ferme,
        });
      });
    });
    const recipients = Array.from(byPhone.values());

    if (options.checkRecipients) {
      return {
        checkRecipients: true,
        dateISO: day,
        recipientsCount: recipients.length,
        recipients: recipients,
      };
    }

    if (!recipients.length) {
      console.error('[meteoSprayDigest] AUCUN destinataire résolu (dg/chef_f1/chef_f5) — ' +
        'digest non distribué pour ' + day);
      return {
        dateISO: day, sent: 0, recipientsCount: 0,
        byProfile: AUDIENCE.map(function(a) {
          return { profileId: a.profileId, ferme: a.ferme, recipientsCount: 0, sent: 0 };
        }),
        fallbackUsed: 0,
      };
    }

    const outcomes = await Promise.allSettled(recipients.map(function(r) {
      return whatsapp.sendTemplateMessage(
        r.phone, TEMPLATE_NAME, [digest.dateParam, digest.body], undefined, r.displayName
      );
    }));

    let fallbackUsed = 0;
    const okByPhone = new Map();
    for (let i = 0; i < recipients.length; i++) {
      const r = recipients[i];
      const outcome = outcomes[i];
      let ok = outcome && outcome.status === 'fulfilled' && outcome.value && !!outcome.value.success;
      if (!ok && shouldFallback(outcome)) {
        // Template inconnu / format rejeté → une seule reprise via general_alert.
        fallbackUsed++;
        try {
          const retry = await whatsapp.sendTemplateMessage(
            r.phone, FALLBACK_TEMPLATE_NAME,
            [whatsapp.toSingleLine(digest.fallbackText)], undefined, r.displayName
          );
          ok = !!(retry && retry.success);
        } catch (err) {
          console.error('[meteoSprayDigest] fallback send failed:', err && err.message);
          ok = false;
        }
      }
      okByPhone.set(r.phone, ok);
    }

    const byProfile = AUDIENCE.map(function(a) {
      const mine = recipients.filter(function(r) { return r.profileId === a.profileId; });
      return {
        profileId: a.profileId,
        ferme: a.ferme,
        recipientsCount: mine.length,
        sent: mine.filter(function(r) { return okByPhone.get(r.phone); }).length,
      };
    });
    const sent = recipients.filter(function(r) { return okByPhone.get(r.phone); }).length;

    // Un destinataire non servi = digest non délivré : ça doit remonter en
    // erreur dans les logs, pas se noyer dans un console.log de routine.
    const logLine = '[meteoSprayDigest] ' + day + ': sent=' + sent + '/' + recipients.length +
      ' fallback=' + fallbackUsed;
    if (sent < recipients.length) {
      console.error(logLine + ' — ENVOI INCOMPLET');
    } else {
      console.log(logLine);
    }
    return {
      dateISO: day,
      sent: sent,
      recipientsCount: recipients.length,
      byProfile: byProfile,
      fallbackUsed: fallbackUsed,
    };
  }

  return { run: run };
}

module.exports = {
  CRON_CONFIG,
  HTTP_CONFIG,
  COORDS,
  AUDIENCE,
  TEMPLATE_NAME,
  FALLBACK_TEMPLATE_NAME,
  TRIGGER_SEND_ROLES,
  todayCasablancaISO,
  formatDateParam,
  scoreLabel,
  buildSprayWindows,
  buildTempSummary,
  formatDigest,
  createMeteoDigestJob,
};
