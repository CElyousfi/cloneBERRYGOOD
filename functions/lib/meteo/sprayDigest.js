'use strict';
// @ts-check
/**
 * sprayDigest.js — Digest WhatsApp quotidien « Météo & Traitements » (06h00
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

const sprayChart = require('./sprayChart');
const renderPng = require('./renderPng');

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
 * @property {number|null} ressenti      felttemperature_max (°C)
 * @property {number|null} rhMin         relativehumidity_min (%)
 * @property {number|null} rhMax         relativehumidity_max (%)
 * @property {number|null} ventDir       winddirection (degrés, 0 = Nord)
 * @property {number|null} deltaTMin     delta_t_min (°C)
 * @property {number|null} deltaTMax     delta_t_max (°C)
 * @property {number|null} humectation   leafwetnessindex
 * @property {number|null} heuresHr90    humiditygreater90_hours (h)
 * @property {number|null} etoFao        referenceevapotranspiration_fao (mm)
 * @property {number|null} humiditeSol   soilmoisture_0to10cm_mean (%)
 */

/** Première heure ouvrée prise en compte pour un traitement. */
const WORK_HOUR_START = 6;
/** Dernière heure ouvrée prise en compte (incluse). */
const WORK_HOUR_END = 20;

const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

/** Secteurs de vent, pas de 45° à partir du Nord (même table que public/app.jsx). */
const SECTEURS_VENT = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/**
 * Delta T (°C) = écart température sèche / température humide. C'est
 * l'indicateur professionnel de pulvérisation : il mesure la vitesse
 * d'évaporation de la gouttelette entre la buse et la feuille.
 *
 * Seuils standards de la profession (bulletins agro, conseils buses) :
 * - `< 2`   : air trop humide, la gouttelette n'évapore pas → coulure/lessivage ;
 * - `2 → 8` : plage idéale ;
 * - `> 8`   : air trop sec, évaporation avant impact → perte de produit et dérive.
 *
 * Bornes INCLUSES dans la zone idéale (2 et 8 sont « idéal », 1,9 « trop
 * humide », 8,1 « trop sec »).
 */
const DELTA_T_IDEAL_MIN = 2;
const DELTA_T_IDEAL_MAX = 8;

/**
 * ⚠️ Libellé volontairement désambiguïsé : `functions/index.js` expose déjà un
 * champ `delta_t` qui est l'AMPLITUDE THERMIQUE du jour (tmax − tmin), affiché
 * « ΔT (°C) » sur l'écran Maturité. Les deux indicateurs n'ont rien en commun ;
 * un « Delta T » nu dans le digest serait lu comme l'amplitude par un chef.
 */
const DELTA_T_LABEL = 'Delta T pulvé';

const DELTA_T_ZONE_HUMIDE = 'trop humide';
const DELTA_T_ZONE_IDEAL = 'idéal';
const DELTA_T_ZONE_SEC = 'trop sec';

/**
 * Barème du risque maladie — ⚠️ À VALIDER PAR OMAR (agronome).
 *
 * Aucune référence agronomique n'existe dans le repo pour ces deux champs ; le
 * barème ci-dessous est donc volontairement CONSERVATEUR (il bascule tôt vers
 * « Modéré ») et sert de point de départ, pas de vérité agronomique.
 *
 * Hypothèse d'unité : `leafwetnessindex` (Meteoblue, agro-day) est traité ici
 * comme une DURÉE d'humectation foliaire sur la journée, à la même échelle que
 * `humiditygreater90_hours` (0 → 24). Il est affiché sans unité pour ne pas
 * affirmer une unité non vérifiée ; seul `humiditygreater90_hours` porte « h ».
 *
 * Règle : on retient le PIRE des deux indicateurs (max), car l'humectation
 * foliaire et l'air saturé favorisent tous deux la germination des spores.
 * - `>= 8`  → Élevé
 * - `>= 4`  → Modéré
 * - sinon   → Faible
 */
const RISQUE_MALADIE_SEUIL_ELEVE = 8;
const RISQUE_MALADIE_SEUIL_MODERE = 4;

const CRON_CONFIG = Object.freeze({
  schedule: '0 6 * * *',
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

/**
 * Une combinaison de paramètres du trigger HTTP déclenche-t-elle un ENVOI RÉEL
 * (WhatsApp au DG et aux chefs, plus écriture d'état) ?
 *
 * INVARIANT : toute combinaison de query qui peut atteindre un
 * `sendTemplateMessage` renvoie `true` ici, et passe donc par la gate de rôle
 * `TRIGGER_SEND_ROLES`. Concrètement :
 * - `preview=1` ne renvoie jamais rien → jamais d'envoi ;
 * - `checkRecipients=1` est un diagnostic sec, MAIS il n'a cet effet que sur le
 *   job digest ; le job d'alertes (`alertes=1`) l'honore aussi désormais, et on
 *   le traite quand même comme un envoi réel par prudence : la gate ne doit pas
 *   dépendre du comportement interne d'un job.
 *
 * @param {{preview?: boolean, checkRecipients?: boolean, alertesOnly?: boolean}} q
 * @returns {boolean}
 */
function isRealSend(q) {
  const opts = q || {};
  if (opts.preview) return false;
  if (opts.alertesOnly) return true;
  return !opts.checkRecipients;
}

const TEMPLATE_NAME = 'meteo_spray_digest';
/** Même corps que TEMPLATE_NAME, avec un header IMAGE portant le graphique. */
const IMAGE_TEMPLATE_NAME = 'meteo_spray_digest_img';
const FALLBACK_TEMPLATE_NAME = 'general_alert';

/** Nom de fichier du graphique poussé à Meta (purement informatif côté API). */
const CHART_FILENAME = 'meteo-traitements.png';

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
 * Normalise une valeur en nombre exploitable, ou `null`. Même filtre que le
 * `pick` de buildTempSummary, appliqué cette fois à l'ENTRÉE de la mise en
 * forme : `formatDigest` peut recevoir un TempSummary partiel (appel direct,
 * ancienne fixture), et un `!== null` laissait alors passer `undefined` →
 * `Math.round(undefined)` → « NaN°C » dans le message WhatsApp.
 * @param {*} v
 * @returns {number|null}
 */
function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Nombre à la française : une décimale au plus, virgule décimale, et pas de
 * décimale inutile (`3,9`, `10`). Copie locale du helper de meteoAlertes.js —
 * ce module n'expose pas le sien et le périmètre du ticket interdit d'y toucher.
 * @param {number} n
 * @returns {string}
 */
function formatNombreFr(n) {
  return String(round1(n)).replace('.', ',');
}

/**
 * Degrés → secteur français (N, NE, E, SE, S, SO, O, NO). Même arrondi au
 * secteur de 45° que `parseWindDir` (public/app.jsx) : 350° retombe sur N.
 * @param {number|null|undefined} deg
 * @returns {string|null} null si la valeur n'est pas un nombre exploitable.
 */
function formatWindDirection(deg) {
  if (typeof deg !== 'number' || !Number.isFinite(deg)) return null;
  const idx = Math.round(deg / 45);
  return SECTEURS_VENT[((idx % 8) + 8) % 8];
}

/**
 * Zone d'interprétation d'UNE valeur de Delta T.
 * @param {number} v
 * @returns {string} 'trop humide' | 'idéal' | 'trop sec'
 */
function deltaTZone(v) {
  if (v < DELTA_T_IDEAL_MIN) return DELTA_T_ZONE_HUMIDE;
  if (v > DELTA_T_IDEAL_MAX) return DELTA_T_ZONE_SEC;
  return DELTA_T_ZONE_IDEAL;
}

/**
 * Ligne « Delta T » complète, plage + interprétation + cible. Si la journée
 * traverse deux zones, les deux sont annoncées (`trop humide → idéal`).
 * @param {number|null} min
 * @param {number|null} max
 * @returns {string|null} null si aucune valeur exploitable.
 */
function formatDeltaT(min, max) {
  const cible = ', cible ' + DELTA_T_IDEAL_MIN + '-' + DELTA_T_IDEAL_MAX + ')';
  if (min !== null && max !== null) {
    const zones = deltaTZone(min) === deltaTZone(max)
      ? deltaTZone(min)
      : deltaTZone(min) + ' → ' + deltaTZone(max);
    return DELTA_T_LABEL + ' : ' + formatNombreFr(min) + ' → ' + formatNombreFr(max) + ' (' + zones + cible;
  }
  const seul = min !== null ? min : max;
  if (seul === null || seul === undefined) return null;
  return DELTA_T_LABEL + ' : ' + formatNombreFr(seul) + ' (' + deltaTZone(seul) + cible;
}

/**
 * Niveau qualitatif de risque maladie (cf. barème ci-dessus, à valider).
 * @param {number|null} humectation leafwetnessindex
 * @param {number|null} heuresHr90  humiditygreater90_hours
 * @returns {string|null} 'Faible' | 'Modéré' | 'Élevé' — null si rien d'exploitable.
 */
function niveauRisqueMaladie(humectation, heuresHr90) {
  const valeurs = [humectation, heuresHr90].filter(function(v) {
    return typeof v === 'number' && Number.isFinite(v);
  });
  if (!valeurs.length) return null;
  const pire = Math.max.apply(null, valeurs);
  if (pire >= RISQUE_MALADIE_SEUIL_ELEVE) return 'Élevé';
  if (pire >= RISQUE_MALADIE_SEUIL_MODERE) return 'Modéré';
  return 'Faible';
}

/**
 * Lendemain d'une date ISO (YYYY-MM-DD), en arithmétique UTC pure — le
 * graphique du digest couvre aujourd'hui ET demain.
 * @param {string} dateISO
 * @returns {string} '' si l'entrée n'est pas une date ISO.
 */
function nextDayISO(dateISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
 * Extrait les valeurs journalières exploitées par le digest.
 *
 * Tous les champs viennent du MÊME package déjà appelé
 * (`basic-day_agro-day_basic-1h`, cf. meteoblueProxy.buildWeatherBasicUrl) :
 * aucun appel API supplémentaire. Un champ absent ou non numérique retombe sur
 * `null` via `pick` et disparaît du message.
 *
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
    // Bloc 1 — conditions de pulvérisation
    ressenti: pick(day.felttemperature_max),
    rhMin: pick(day.relativehumidity_min),
    rhMax: pick(day.relativehumidity_max),
    ventDir: pick(day.winddirection),
    deltaTMin: pick(day.delta_t_min),
    deltaTMax: pick(day.delta_t_max),
    // Bloc 2 — risque maladie
    humectation: pick(day.leafwetnessindex),
    heuresHr90: pick(day.humiditygreater90_hours),
    // Bloc 3 — irrigation
    etoFao: pick(day.referenceevapotranspiration_fao),
    // Hypothèse d'unité : pourcentage volumique (les valeurs observées sur ce
    // point — ex. 10 — excluent une échelle m³/m³ 0-1).
    humiditeSol: pick(day.soilmoisture_0to10cm_mean),
  };
}

/**
 * Met en forme le digest : paramètre de date du template, corps multi-ligne
 * (style dailyProductionReport) et repli aplati sur une ligne.
 *
 * Le corps est assemblé par SECTIONS, chacune séparée par une ligne vide. Une
 * section vide (données absentes) n'est pas poussée du tout : pas de ligne
 * orpheline, pas de double saut de ligne.
 *
 * ⚠️ Le corps part en `{{2}}` du template Meta, limité à 1024 caractères par
 * paramètre (cf. test « corps < 900 caractères »).
 *
 * @param {{dateISO: string, temp: TempSummary|null, windows: SprayWindows|null}} input
 * @returns {{dateParam: string, body: string, fallbackText: string}}
 */
function formatDigest(input) {
  const dateISO = input && input.dateISO;
  const temp = input ? input.temp : null;
  const windows = input ? input.windows : null;
  const dateParam = formatDateParam(dateISO);

  /** @type {Array<Array<string>>} */
  const sections = [];
  const flat = [];

  // ── Section 1 : conditions de pulvérisation ────────────────────────────
  const t = temp || {};
  const tMinV = num(t.tMin);
  const tMaxV = num(t.tMax);
  const ventV = num(t.ventMax);
  const pluieV = num(t.pluie);
  const rhMin = num(t.rhMin);
  const rhMax = num(t.rhMax);

  const meteo = [];
  if (tMinV !== null || tMaxV !== null) {
    const tMin = tMinV !== null ? Math.round(tMinV) + '°C' : '?';
    const tMax = tMaxV !== null ? Math.round(tMaxV) + '°C' : '?';
    const ressentiV = num(t.ressenti);
    const ressenti = ressentiV !== null ? ' (ressenti ' + Math.round(ressentiV) + '°C)' : '';
    meteo.push('🌡️ *Température* : ' + tMin + ' → ' + tMax + ressenti);
    flat.push('Température ' + tMin + ' à ' + tMax);

    if (rhMin !== null && rhMax !== null) {
      meteo.push('💦 Humidité : ' + Math.round(rhMin) + '% → ' + Math.round(rhMax) + '%');
    } else if (rhMin !== null || rhMax !== null) {
      meteo.push('💦 Humidité : ' + Math.round(rhMin !== null ? rhMin : rhMax) + '%');
    }

    if (ventV !== null) {
      const dir = formatWindDirection(num(t.ventDir));
      meteo.push('💨 Vent max : ' + Math.round(ventV) + ' km/h' + (dir ? ' (' + dir + ')' : ''));
      flat.push('vent max ' + Math.round(ventV) + ' km/h');
    }
    if (pluieV !== null) {
      meteo.push('🌧️ Pluie : ' + formatNombreFr(pluieV) + ' mm');
      flat.push('pluie ' + formatNombreFr(pluieV) + ' mm');
    }
    const deltaT = formatDeltaT(num(t.deltaTMin), num(t.deltaTMax));
    if (deltaT) meteo.push('🎯 ' + deltaT);
  } else {
    meteo.push('🌡️ *Température* : donnée météo indisponible');
    flat.push('Température indisponible');
  }
  sections.push(meteo);

  // ── Section 2 : fenêtres de traitement ─────────────────────────────────
  const fenetres = [];
  if (!windows) {
    fenetres.push('⚠️ Fenêtres de traitement indisponibles');
    flat.push('fenêtres de traitement indisponibles');
  } else if (!windows.fenetres.length) {
    fenetres.push('🚫 Aucun créneau favorable aujourd\'hui');
    fenetres.push('Score du jour : ' + formatScore(windows.score));
    flat.push('aucun créneau favorable aujourd\'hui');
    flat.push('score ' + formatScore(windows.score));
  } else {
    fenetres.push('✅ *Fenêtres de traitement* :');
    windows.fenetres.forEach(function(f) {
      fenetres.push('• ' + formatHeure(f.de) + ' - ' + formatHeure(f.a));
    });
    fenetres.push('Score du jour : ' + formatScore(windows.score));
    flat.push('créneaux ' + windows.fenetres.map(function(f) {
      return formatHeure(f.de) + '-' + formatHeure(f.a);
    }).join(', '));
    flat.push('score ' + formatScore(windows.score));
  }
  sections.push(fenetres);

  // ── Section 3 : risque maladie ─────────────────────────────────────────
  const humectation = num(t.humectation);
  const heuresHr90 = num(t.heuresHr90);
  const niveau = niveauRisqueMaladie(humectation, heuresHr90);
  if (niveau) {
    const detail = [];
    if (humectation !== null) detail.push('humectation ' + formatNombreFr(humectation));
    if (heuresHr90 !== null) detail.push('HR>90% ' + formatNombreFr(heuresHr90) + ' h');
    sections.push([
      '🍄 *Risque maladie* : ' + niveau,
      '(' + detail.join(' · ') + ')',
    ]);
  }

  // ── Section 4 : irrigation ─────────────────────────────────────────────
  const etoFao = num(t.etoFao);
  const humiditeSol = num(t.humiditeSol);
  const irrigation = [];
  if (etoFao !== null) irrigation.push('ETo ' + formatNombreFr(etoFao) + ' mm');
  if (humiditeSol !== null) irrigation.push('humidité sol ' + formatNombreFr(humiditeSol) + '%');
  if (irrigation.length) {
    sections.push(['💧 *Irrigation* : ' + irrigation.join(' · ')]);
  }

  // Le fallback `general_alert` n'a QU'UN paramètre single-line : y déverser les
  // 4 sections le rendrait illisible sur mobile. On y garde donc l'essentiel
  // décisionnel (température, vent, pluie, créneaux, score) — inchangé par ce
  // ticket ; les indicateurs agronomiques ne survivent qu'au template complet.
  const fallbackText = ('Météo & Traitements ' + dateParam + ' : ' + flat.join(', '))
    .replace(/\s+/g, ' ')
    .trim();

  const body = sections.map(function(s) { return s.join('\n'); }).join('\n\n');
  return { dateParam: dateParam, body: body, fallbackText: fallbackText };
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
 * Exécute un envoi et le ramène à la forme d'un résultat `Promise.allSettled`,
 * pour rester compatible avec `shouldFallback` (déjà testé sur cette forme).
 * @param {() => Promise<*>} fn
 * @returns {Promise<{status:string, value?:*, reason?:*}>}
 */
async function attempt(fn) {
  try {
    return { status: 'fulfilled', value: await fn() };
  } catch (err) {
    return { status: 'rejected', reason: err };
  }
}

/** @param {*} outcome @returns {boolean} */
function outcomeOk(outcome) {
  return !!(outcome && outcome.status === 'fulfilled' && outcome.value && outcome.value.success);
}

/** @param {*} outcome @returns {string} */
function outcomeError(outcome) {
  if (!outcome) return '';
  if (outcome.status === 'rejected') {
    return String((outcome.reason && outcome.reason.message) || outcome.reason || '');
  }
  return String((outcome.value && outcome.value.error) || '');
}

/**
 * @typedef {Object} MeteoDigestDeps
 * @property {(coords: {lat:number, lon:number, altitude:number}, pkg: string) => Promise<object|null>} getMeteoblue
 * @property {{
 *   resolveRecipientsForProfile: (profileId: string, ferme: string|null) => Promise<Array<object>>,
 *   sendTemplateMessage: (to: string, templateName: string, bodyParams: Array<string>, lang: string|undefined, toName: string|undefined) => Promise<object>,
 *   sendTemplateMessageWithImage?: (to: string, templateName: string, mediaIdOrRef: *, bodyParams: Array<string>, lang: string|undefined, toName: string|undefined) => Promise<object>,
 *   uploadMedia?: (buffer: Buffer, mimeType: string, filename: string) => Promise<object>,
 *   toSingleLine: (s: *) => string,
 * }} whatsapp
 * @property {(svg: string) => Buffer} [renderChartPng] Rendu SVG → PNG. Injecté
 *   dans les tests pour ne pas dépendre du binaire natif ; par défaut
 *   `renderPng.renderSvgToPng`.
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
  const renderChartPng = typeof deps.renderChartPng === 'function'
    ? deps.renderChartPng
    : renderPng.renderSvgToPng;

  /**
   * Fabrique le graphique du jour et le pousse à Meta — UNE seule fois pour
   * tous les destinataires (le media_id est réutilisable 30 jours).
   *
   * Ne lève JAMAIS : le graphique est un bonus, le corps texte est l'essentiel.
   * Tout échec est journalisé en `console.error` et renvoie `null`, ce qui fait
   * retomber l'envoi sur le template texte. Un digest qui perdrait
   * silencieusement son image chaque matin serait un échec invisible.
   *
   * @param {string} dateISO
   * @param {{dateParam: string}} digest
   * @param {object|null} weatherData
   * @param {object|null} sprayData
   * @param {SprayWindows|null} windows
   * @returns {Promise<string|null>} media_id, ou null si indisponible.
   */
  async function prepareChartMedia(dateISO, digest, weatherData, sprayData, windows) {
    try {
      if (typeof whatsapp.uploadMedia !== 'function' ||
          typeof whatsapp.sendTemplateMessageWithImage !== 'function') {
        throw new Error('whatsappService sans support image (uploadMedia / sendTemplateMessageWithImage)');
      }
      // Deux panneaux : aujourd'hui (score déjà calculé pour le texte) et
      // demain (recalculé ici — le corps du message, lui, ne parle que du jour
      // même, cf. formatDigest ; seule l'image anticipe le lendemain).
      const demainISO = nextDayISO(dateISO);
      const days = [{
        dateISO: dateISO,
        dateLabel: digest.dateParam,
        scoreText: windows ? formatScore(windows.score) : '',
      }];
      if (demainISO) {
        const demainWindows = buildSprayWindows(sprayData, demainISO);
        days.push({
          dateISO: demainISO,
          dateLabel: formatDateParam(demainISO),
          scoreText: demainWindows ? formatScore(demainWindows.score) : '',
        });
      }
      const svg = sprayChart.buildSprayChartSvg({
        days: days,
        weatherData: weatherData,
        sprayData: sprayData,
      });
      const png = renderChartPng(svg);
      if (!png || !png.length) throw new Error('rendu PNG vide');
      const uploaded = await whatsapp.uploadMedia(png, renderPng.PNG_MIME, CHART_FILENAME);
      if (!uploaded || !uploaded.id) {
        throw new Error('upload sans media_id' + (uploaded && uploaded.error ? ' (' + uploaded.error + ')' : ''));
      }
      return uploaded.id;
    } catch (err) {
      console.error('[meteoSprayDigest] GRAPHIQUE INDISPONIBLE pour ' + dateISO +
        ' → repli sur le digest texte seul : ' + (err && err.message));
      return null;
    }
  }

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

    // Le graphique est produit et uploadé UNE fois pour tout le monde.
    const mediaId = await prepareChartMedia(day, digest, weatherData, sprayData, windows);

    const bodyParams = [digest.dateParam, digest.body];
    let fallbackUsed = 0;
    let imageSent = 0;
    let degradedToText = 0;
    const okByPhone = new Map();

    // Chaîne de repli à trois étages. Le CORPS TEXTE est identique aux étages 1
    // et 2 : il ne peut être perdu que si les deux templates sont refusés, et
    // l'étage 3 (general_alert) sauve alors l'essentiel décisionnel.
    const results = await Promise.all(recipients.map(async function(r) {
      // ── Étage 1 : template avec image ──────────────────────────────────
      if (mediaId) {
        const withImage = await attempt(function() {
          return whatsapp.sendTemplateMessageWithImage(
            r.phone, IMAGE_TEMPLATE_NAME, mediaId, bodyParams, undefined, r.displayName
          );
        });
        if (outcomeOk(withImage)) return { phone: r.phone, ok: true, image: true, degraded: false, fallback: false };
        // Toute erreur (template non encore approuvé, media_id périmé, réseau)
        // dégrade vers le texte : le corps ne doit jamais dépendre de l'image.
        console.error('[meteoSprayDigest] envoi AVEC IMAGE refusé pour ' + r.phone +
          ' → repli sur le template texte : ' + outcomeError(withImage));
      }

      // ── Étage 2 : template texte historique ────────────────────────────
      const textOutcome = await attempt(function() {
        return whatsapp.sendTemplateMessage(
          r.phone, TEMPLATE_NAME, bodyParams, undefined, r.displayName
        );
      });
      if (outcomeOk(textOutcome)) {
        return { phone: r.phone, ok: true, image: false, degraded: !!mediaId, fallback: false };
      }
      if (!shouldFallback(textOutcome)) {
        return { phone: r.phone, ok: false, image: false, degraded: !!mediaId, fallback: false };
      }

      // ── Étage 3 : general_alert (mécanisme existant, une seule reprise) ─
      console.error('[meteoSprayDigest] template texte refusé pour ' + r.phone +
        ' → repli sur ' + FALLBACK_TEMPLATE_NAME + ' : ' + outcomeError(textOutcome));
      const retry = await attempt(function() {
        return whatsapp.sendTemplateMessage(
          r.phone, FALLBACK_TEMPLATE_NAME,
          [whatsapp.toSingleLine(digest.fallbackText)], undefined, r.displayName
        );
      });
      if (!outcomeOk(retry) && retry.status === 'rejected') {
        console.error('[meteoSprayDigest] fallback send failed:', outcomeError(retry));
      }
      return {
        phone: r.phone, ok: outcomeOk(retry), image: false, degraded: !!mediaId, fallback: true,
      };
    }));

    results.forEach(function(res) {
      okByPhone.set(res.phone, res.ok);
      if (res.fallback) fallbackUsed++;
      if (res.ok && res.image) imageSent++;
      if (res.ok && !res.image && res.degraded) degradedToText++;
    });

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
      ' image=' + imageSent + ' texte=' + degradedToText + ' fallback=' + fallbackUsed;
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
      chartAvailable: !!mediaId,
      imageSent: imageSent,
      degradedToText: degradedToText,
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
  IMAGE_TEMPLATE_NAME,
  CHART_FILENAME,
  FALLBACK_TEMPLATE_NAME,
  FALLBACK_ERROR_CODES,
  TRIGGER_SEND_ROLES,
  isRealSend,
  shouldFallback,
  todayCasablancaISO,
  formatDateParam,
  nextDayISO,
  scoreLabel,
  formatNombreFr,
  formatWindDirection,
  deltaTZone,
  formatDeltaT,
  niveauRisqueMaladie,
  DELTA_T_LABEL,
  DELTA_T_IDEAL_MIN,
  DELTA_T_IDEAL_MAX,
  RISQUE_MALADIE_SEUIL_MODERE,
  RISQUE_MALADIE_SEUIL_ELEVE,
  buildSprayWindows,
  buildTempSummary,
  formatDigest,
  createMeteoDigestJob,
};
