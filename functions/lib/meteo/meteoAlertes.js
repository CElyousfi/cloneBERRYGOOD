'use strict';
// @ts-check
/**
 * meteoAlertes.js — Alertes météo à 7 jours (Forte Chaleur / Vent Fort / Forte
 * Pluie), envoyées en WhatsApp au DG, au chef F1 et au chef F5 en PLUS du
 * digest quotidien (cf. sprayDigest.js).
 *
 * Seuils : tMax >= 35 °C, vent >= 25 km/h, précipitations >= 10 mm/jour.
 *
 * ⚠️ SEUILS DUPLIQUÉS, À GARDER ALIGNÉS avec l'écran Météo du frontend
 * (public/app.jsx, bloc `alertes`) : les deux côtés sont à 35 °C / 25 km/h /
 * 10 mm depuis le 2026-08-18 (passage de 32 à 35 °C sur la chaleur, décidé par
 * Omar, appliqué des DEUX côtés le même jour). Un changement d'un seul côté
 * ferait se contredire l'écran et la notification WhatsApp : toute évolution
 * doit être répercutée dans public/app.jsx, et inversement.
 * La duplication est volontaire : le backend ne peut pas require('../public/…')
 * — Firebase ne déploie que functions/, l'import ferait planter toutes les CF
 * au chargement.
 *
 * Anti-répétition : chaque couple (type, jour) est mémorisé dans la collection
 * Firestore `meteo_alertes_envoyees` ; l'alerte n'est renvoyée que si elle est
 * inconnue ou si sa valeur s'est aggravée d'au moins la marge de son type.
 *
 * Orchestrateur pur en injection de dépendances : aucun accès direct Firestore
 * ni réseau ici — le câblage prod vit dans functions/index.js.
 */

const {
  COORDS,
  AUDIENCE,
  FALLBACK_TEMPLATE_NAME,
  shouldFallback,
  todayCasablancaISO,
} = require('./sprayDigest');
const meteogram = require('./meteogram');

/**
 * @typedef {Object} Alerte
 * @property {'chaleur'|'vent'|'pluie'} type
 * @property {string} label   Libellé humain (« Forte Chaleur »).
 * @property {string} dateISO YYYY-MM-DD
 * @property {number} valeur  Valeur prévue (°C, km/h ou mm).
 * @property {number} seuil   Seuil franchi.
 * @property {string} cle     `type + '_' + dateISO` — identifiant Firestore.
 */

/** Nom du template Meta dédié (body : titre + corps multi-ligne). */
const TEMPLATE_NAME = 'meteo_alerte_7j';

/**
 * Variante à header IMAGE du même template : corps STRICTEMENT identique et
 * mêmes 2 paramètres dans le même ordre. C'est ce qui rend le repli sur
 * TEMPLATE_NAME possible sans reformater le message.
 */
const IMAGE_TEMPLATE_NAME = 'meteo_alerte_7j_img';

/** Nom de fichier du meteogram poussé à Meta (informatif côté API). */
const METEOGRAM_FILENAME = 'meteo-7-jours.png';

/** Collection d'état anti-répétition (un document par `cle`). */
const COLLECTION = 'meteo_alertes_envoyees';

/**
 * Borne (en jours après `fromISO`) de la fenêtre de surveillance : un jour est
 * retenu si `0 <= offset <= FENETRE_JOURS`, donc AUJOURD'HUI inclus.
 *
 * En pratique la borne haute n'est jamais atteinte : le package Meteoblue
 * `basic-day` ne renvoie que 7 jours (J0 → J+6), J+7 n'existe pas dans les
 * données. `FENETRE_JOURS = 7` est donc défensif — il ne coupe rien
 * aujourd'hui, et couvrirait J+7 si le package venait à en fournir un.
 */
const FENETRE_JOURS = 7;

/**
 * Seuils de déclenchement — mêmes valeurs que le bloc `alertes` de
 * public/app.jsx (cf. l'en-tête du module : duplication à garder alignée).
 * Les LIBELLÉS, eux, sont propres à la notification WhatsApp (« Forte Pluie »,
 * vocabulaire demandé) et ne prétendent pas recopier ceux de l'écran.
 */
const SEUILS = Object.freeze({
  chaleur: 35, // °C, temperature_max — miroir de public/app.jsx (`p.tMax >= 35`)
  vent: 25, // km/h, windspeed_max
  pluie: 10, // mm/jour, precipitation
});

/**
 * Aggravation minimale (dans l'unité du type) pour re-notifier une alerte déjà
 * envoyée. En dessous, la révision de prévision est du bruit de modèle et ne
 * justifie pas de re-notifier les mêmes personnes tous les matins.
 *
 * La marge chaleur est à 1 °C (2 °C auparavant) : au-delà de 35 °C, chaque
 * degré supplémentaire compte, une re-notification est justifiée.
 */
const MARGES_AGGRAVATION = Object.freeze({
  chaleur: 1, // °C
  vent: 5, // km/h
  pluie: 5, // mm
});

/**
 * Valeur COMPARÉE au seuil, par type. L'écran compare la valeur qu'il affiche,
 * c'est-à-dire la valeur arrondie (public/app.jsx : `Math.round` pour tMax et
 * vent, arrondi au dixième pour la pluie). Comparer la valeur brute côté
 * backend ferait diverger les deux : 31.6 °C ou 24.6 km/h alertent à l'écran
 * mais pas en WhatsApp. On arrondit donc de la même façon avant de comparer.
 */
const VALEUR_COMPAREE = Object.freeze({
  chaleur: Math.round,
  vent: Math.round,
  pluie: function(v) { return v; }, // seuil entier, arrondi au dixième : déjà aligné
});

/** Libellés affichés, par type. */
const LABELS = Object.freeze({
  chaleur: 'Forte Chaleur',
  vent: 'Vent Fort',
  pluie: 'Forte Pluie',
});

/** Ordre stable des types à date égale (tri déterministe). */
const TYPES_ORDRE = Object.freeze(['chaleur', 'vent', 'pluie']);

/** Champ `data_day` porteur de la valeur, par type. */
const CHAMPS = Object.freeze({
  chaleur: 'temperature_max',
  vent: 'windspeed_max',
  pluie: 'precipitation',
});

/** Pictogramme de section, par type. */
const ICONES = Object.freeze({
  chaleur: '🌡️',
  vent: '💨',
  pluie: '🌧️',
});

const JOURS_LONGS = [
  'DIMANCHE', 'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI',
];

const MOIS_LONGS = [
  'JANVIER', 'FÉVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN',
  'JUILLET', 'AOÛT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DÉCEMBRE',
];

/**
 * Arrondit à une décimale, sans imposer de décimale inutile.
 * @param {number} n
 * @returns {number}
 */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Convertit YYYY-MM-DD en timestamp UTC. Parsing manuel (pas de `new Date(iso)`)
 * pour rester indépendant du fuseau du process.
 * @param {string} dateISO
 * @returns {number|null} ms depuis epoch, ou null si le format est invalide.
 */
function isoToUTC(dateISO) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateISO || ''));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Écart en jours entre deux dates ISO (b - a).
 * @param {string} a
 * @param {string} b
 * @returns {number|null}
 */
function diffJours(a, b) {
  const ta = isoToUTC(a);
  const tb = isoToUTC(b);
  if (ta === null || tb === null) return null;
  return Math.round((tb - ta) / 86400000);
}

/**
 * « VENDREDI 21 AOÛT » depuis une date ISO.
 * @param {string} dateISO
 * @returns {string}
 */
function formatJourLong(dateISO) {
  const t = isoToUTC(dateISO);
  if (t === null) return String(dateISO || '');
  const d = new Date(t);
  return JOURS_LONGS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MOIS_LONGS[d.getUTCMonth()];
}

/**
 * Nombre à la française : une décimale au plus, virgule décimale, et pas de
 * décimale inutile (`33`, pas `33,0`).
 * @param {number} n
 * @returns {string}
 */
function formatNombreFr(n) {
  return String(round1(n)).replace('.', ',');
}

/**
 * Valeur formatée avec son unité, selon le type.
 *
 * ⚠️ On affiche la valeur RÉELLE (au dixième), jamais la valeur arrondie
 * utilisée pour la comparaison au seuil (`VALEUR_COMPAREE`) : arrondir à
 * l'affichage produisait « 35°C prévus (seuil 35°C) » pour une prévision à
 * 35,4 °C, ce qui se lit comme un non-événement ou un bug de l'outil (constaté
 * en prod le 2026-08-18, alors à 32,4 °C pour un seuil de 32 °C). Les seuils
 * étant entiers, ils restent affichés tels quels.
 *
 * @param {string} type
 * @param {number} valeur
 * @returns {string}
 */
function formatValeur(type, valeur) {
  const n = formatNombreFr(valeur);
  if (type === 'pluie') return n + ' mm';
  if (type === 'vent') return n + ' km/h';
  return n + '°C';
}

/**
 * Détecte les alertes sur la fenêtre de surveillance.
 *
 * @param {object|null|undefined} weatherData Réponse brute du package `weather`
 *   (`data_day.time` + `temperature_max` / `windspeed_max` / `precipitation`).
 * @param {{fromISO?: string, jours?: number}} [opts] `fromISO` = premier jour
 *   inclus (défaut : aujourd'hui à Casablanca) ; `jours` = nombre de jours
 *   SUIVANTS couverts (défaut 7, donc J+7 inclus et J+8 exclu).
 * @returns {Array<Alerte>} trié par date puis par type ; `[]` si données absentes.
 */
function detecterAlertes(weatherData, opts) {
  const options = opts || {};
  const from = options.fromISO || todayCasablancaISO();
  const jours = Number.isFinite(options.jours) ? Number(options.jours) : FENETRE_JOURS;
  if (!weatherData || !weatherData.data_day) return [];
  const day = weatherData.data_day;
  if (!Array.isArray(day.time)) return [];

  /** @type {Array<Alerte>} */
  const alertes = [];
  day.time.forEach(function(raw, i) {
    // Meteoblue renvoie « YYYY-MM-DD » ou « YYYY-MM-DD HH:mm » ; on accepte
    // aussi le séparateur ISO `T` : sans ça, un changement de format côté
    // fournisseur ferait échouer diffJours et éteindrait TOUTES les alertes en
    // silence.
    const dateISO = String(raw || '').split(/[ T]/)[0];
    const offset = diffJours(from, dateISO);
    if (offset === null || offset < 0 || offset > jours) return;
    TYPES_ORDRE.forEach(function(type) {
      const arr = day[CHAMPS[type]];
      if (!Array.isArray(arr)) return;
      const v = arr[i];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      if (VALEUR_COMPAREE[type](v) < SEUILS[type]) return;
      alertes.push({
        type: /** @type {'chaleur'|'vent'|'pluie'} */ (type),
        label: LABELS[type],
        dateISO: dateISO,
        valeur: round1(v),
        seuil: SEUILS[type],
        cle: type + '_' + dateISO,
      });
    });
  });

  alertes.sort(function(a, b) {
    if (a.dateISO !== b.dateISO) return a.dateISO < b.dateISO ? -1 : 1;
    return TYPES_ORDRE.indexOf(a.type) - TYPES_ORDRE.indexOf(b.type);
  });
  return alertes;
}

/**
 * « 21 → 24/08 » (même mois) ou « 29/08 → 02/09 » (mois différents).
 * @param {string} debutISO
 * @param {string} finISO
 * @returns {string}
 */
function formatPeriode(debutISO, finISO) {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(debutISO || ''));
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(finISO || ''));
  if (!a || !b) return String(debutISO || '');
  if (debutISO === finISO) return a[3] + '/' + a[2];
  if (a[2] === b[2] && a[1] === b[1]) return a[3] + ' → ' + b[3] + '/' + b[2];
  return a[3] + '/' + a[2] + ' → ' + b[3] + '/' + b[2];
}

/**
 * Met en forme le message d'alertes : paramètre de période, corps multi-ligne
 * groupé (une section par alerte) et repli aplati sur une ligne.
 *
 * @param {Array<Alerte>} alertes
 * @returns {{titreParam: string, body: string, fallbackText: string}}
 */
function formatAlertes(alertes) {
  const list = Array.isArray(alertes) ? alertes : [];
  if (!list.length) {
    return { titreParam: '', body: '', fallbackText: '' };
  }
  const titreParam = formatPeriode(list[0].dateISO, list[list.length - 1].dateISO);

  const lines = [];
  const flat = [];
  list.forEach(function(a, idx) {
    if (idx > 0) lines.push('');
    lines.push(formatJourLong(a.dateISO) + ' — ' + String(a.label).toUpperCase());
    const valeur = formatValeur(a.type, a.valeur);
    const seuil = formatValeur(a.type, a.seuil);
    lines.push(ICONES[a.type] + ' ' + valeur + ' prévus (seuil ' + seuil + ')');
    flat.push(formatJourLong(a.dateISO) + ' ' + String(a.label).toUpperCase() +
      ' ' + valeur + ' (seuil ' + seuil + ')');
  });

  const conseil = 'Reporter les traitements phyto sur ces journées et prévoir les ' +
    'protections adaptées.';
  lines.push('');
  lines.push('⚠️ ' + conseil);
  flat.push(conseil);

  const fallbackText = ('Alerte météo ' + titreParam + ' : ' + flat.join(' ; '))
    .replace(/\s+/g, ' ')
    .trim();

  return { titreParam: titreParam, body: lines.join('\n'), fallbackText: fallbackText };
}

/**
 * Décide quelles alertes doivent être notifiées, compte tenu de l'état déjà
 * envoyé. Fonction PURE : aucun accès Firestore, testable seule.
 *
 * Règle : on notifie si la clé est inconnue, OU si la valeur s'est aggravée
 * d'au moins `MARGES_AGGRAVATION[type]` par rapport à la valeur mémorisée.
 *
 * @param {Array<Alerte>} alertes
 * @param {Map<string, {valeur?: number}>|Object<string, {valeur?: number}>|null|undefined} dejaEnvoyees
 *   Indexé par `cle`.
 * @returns {Array<Alerte>}
 */
function filtrerAlertesANotifier(alertes, dejaEnvoyees) {
  const list = Array.isArray(alertes) ? alertes : [];
  const lookup = function(cle) {
    if (!dejaEnvoyees) return null;
    if (typeof (/** @type {*} */ (dejaEnvoyees).get) === 'function') {
      return /** @type {Map<string, *>} */ (dejaEnvoyees).get(cle) || null;
    }
    return Object.prototype.hasOwnProperty.call(dejaEnvoyees, cle)
      ? /** @type {Object<string, *>} */ (dejaEnvoyees)[cle]
      : null;
  };

  return list.filter(function(a) {
    const prev = lookup(a.cle);
    if (!prev) return true;
    const prevValeur = typeof prev.valeur === 'number' && Number.isFinite(prev.valeur)
      ? prev.valeur
      : null;
    // Valeur mémorisée illisible → on renotifie plutôt que de risquer le silence.
    if (prevValeur === null) return true;
    const marge = MARGES_AGGRAVATION[a.type];
    return a.valeur - prevValeur >= marge;
  });
}

/**
 * Une entrée d'état est-elle périmée (jour déjà passé) ?
 * @param {string} dateISO
 * @param {string} todayISO
 * @returns {boolean}
 */
function estPerimee(dateISO, todayISO) {
  const d = isoToUTC(dateISO);
  const t = isoToUTC(todayISO);
  if (d === null || t === null) return false;
  return d < t;
}

/**
 * @typedef {Object} MeteoAlertesDeps
 * @property {(coords: {lat:number, lon:number, altitude:number}, pkg: string) => Promise<object|null>} getMeteoblue
 * @property {{
 *   resolveRecipientsForProfile: (profileId: string, ferme: string|null) => Promise<Array<object>>,
 *   sendTemplateMessage: (to: string, templateName: string, bodyParams: Array<string>, lang: string|undefined, toName: string|undefined) => Promise<object>,
 *   toSingleLine: (s: *) => string,
 * }} whatsapp
 * @property {{collection: (name: string) => *}} db Firestore (admin) — seul accès I/O.
 * @property {() => Date} [now]
 */

/**
 * Fabrique le job « alertes météo 7 jours ».
 * @param {MeteoAlertesDeps} deps
 * @returns {{run: (dateISO?: string, opts?: object) => Promise<object>}}
 */
function createMeteoAlertesJob(deps) {
  if (!deps || typeof deps.getMeteoblue !== 'function' || !deps.whatsapp || !deps.db) {
    throw new TypeError('createMeteoAlertesJob: deps.getMeteoblue, deps.whatsapp et deps.db requis');
  }
  // Câblage vérifié AU DÉMARRAGE : une dep WhatsApp manquante doit faire échouer
  // la construction du job, pas le premier envoi du matin en prod.
  ['sendTemplateMessage', 'resolveRecipientsForProfile', 'toSingleLine'].forEach(function(fn) {
    if (typeof deps.whatsapp[fn] !== 'function') {
      throw new TypeError('createMeteoAlertesJob: deps.whatsapp.' + fn + ' requis');
    }
  });
  const whatsapp = deps.whatsapp;
  const db = deps.db;
  const now = typeof deps.now === 'function' ? deps.now : function() { return new Date(); };

  /**
   * Lit l'état anti-répétition. Un échec de lecture est journalisé et traité
   * comme un état vide : mieux vaut une alerte en double qu'une alerte muette.
   * @returns {Promise<{etat: Map<string, *>, ids: Array<{id: string, dateISO: string}>}>}
   */
  async function lireEtat() {
    const etat = new Map();
    const ids = [];
    try {
      const snap = await db.collection(COLLECTION).get();
      const docs = (snap && snap.docs) || [];
      docs.forEach(function(doc) {
        const data = (typeof doc.data === 'function' ? doc.data() : doc.data) || {};
        etat.set(doc.id, data);
        ids.push({ id: doc.id, dateISO: String(data.dateISO || '') });
      });
    } catch (err) {
      console.error('[meteoAlertes] lecture état échouée (on repart d\'un état vide):',
        err && err.message);
    }
    return { etat: etat, ids: ids };
  }

  /**
   * Supprime les entrées dont le jour est déjà passé.
   *
   * ⚠️ `todayISO` DOIT être la date du jour côté serveur, jamais une date
   * fournie par l'appelant : avec `?date=2099-01-01`, toutes les entrées
   * seraient périmées et l'état anti-répétition serait vidé (réarmement massif
   * des alertes déjà envoyées).
   *
   * @param {Array<{id: string, dateISO: string}>} ids
   * @param {string} todayISO
   * @returns {Promise<number>}
   */
  async function purger(ids, todayISO) {
    const perimees = ids.filter(function(e) { return estPerimee(e.dateISO, todayISO); });
    if (!perimees.length) return 0;
    const results = await Promise.allSettled(perimees.map(function(e) {
      return db.collection(COLLECTION).doc(e.id).delete();
    }));
    const ko = results.filter(function(r) { return r.status === 'rejected'; }).length;
    if (ko) console.error('[meteoAlertes] purge partielle : ' + ko + ' suppression(s) en échec');
    return perimees.length - ko;
  }

  /**
   * Récupère le meteogram 7 jours et le pousse à Meta — UNE seule fois pour
   * tous les destinataires (le media_id est réutilisable 30 jours).
   *
   * Ne lève JAMAIS : l'image est un bonus, le TEXTE de l'alerte est
   * l'essentiel. Tout échec est journalisé en `console.error` (une image qui
   * disparaîtrait en silence serait un échec invisible) et renvoie `null`, ce
   * qui fait retomber l'envoi sur le template texte historique.
   *
   * @param {string} dateISO Pour le contexte des logs.
   * @returns {Promise<string|null>} media_id, ou null si indisponible.
   */
  async function prepareMeteogramMedia(dateISO) {
    // Dep absente = câblage volontairement sans image (tests, environnements
    // sans clé) : chemin texte historique, sans bruit dans les logs d'erreur.
    if (typeof deps.fetchMeteogram !== 'function') return null;
    try {
      if (typeof whatsapp.uploadMedia !== 'function' ||
          typeof whatsapp.sendTemplateMessageWithImage !== 'function') {
        throw new Error('whatsappService sans support image (uploadMedia / sendTemplateMessageWithImage)');
      }
      const png = await deps.fetchMeteogram(COORDS);
      // fetchMeteogram rend déjà null sur réseau KO, HTML ou payload creux.
      if (!png || !png.length) throw new Error('meteogram indisponible ou invalide');
      const uploaded = await whatsapp.uploadMedia(png, meteogram.PNG_MIME, METEOGRAM_FILENAME);
      if (!uploaded || !uploaded.id) {
        throw new Error('upload sans media_id' + (uploaded && uploaded.error ? ' (' + uploaded.error + ')' : ''));
      }
      return uploaded.id;
    } catch (err) {
      console.error('[meteoAlertes] METEOGRAM INDISPONIBLE pour ' + dateISO +
        ' → repli sur l\'alerte texte seule : ' + (err && err.message));
      return null;
    }
  }

  /**
   * Résout l'audience (DG + chefs F1/F5) et dédoublonne par numéro : le contenu
   * est identique pour tous, un même numéro ne doit recevoir qu'une fois.
   * @returns {Promise<Array<{phone: string, displayName: string, uid: string|null, profileId: string, ferme: string|null}>>}
   */
  async function resoudreDestinataires() {
    const resolved = await Promise.all(AUDIENCE.map(function(a) {
      return Promise.resolve()
        .then(function() { return whatsapp.resolveRecipientsForProfile(a.profileId, a.ferme); })
        .catch(function(err) {
          console.error('[meteoAlertes] resolve failed for ' + a.profileId + ':', err && err.message);
          return [];
        })
        .then(function(list) { return { audience: a, recipients: list || [] }; });
    }));

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
    return Array.from(byPhone.values());
  }

  /**
   * @param {string} [dateISO]
   * @param {{preview?: boolean, checkRecipients?: boolean}} [opts]
   */
  async function run(dateISO, opts) {
    const options = opts || {};
    const day = dateISO || todayCasablancaISO(now());

    const weatherData = await Promise.resolve()
      .then(function() { return deps.getMeteoblue(COORDS, 'weather'); })
      .catch(function(err) {
        console.warn('[meteoAlertes] weather fetch failed:', err && err.message);
        return null;
      });

    const detectees = detecterAlertes(weatherData, { fromISO: day, jours: FENETRE_JOURS });

    if (options.preview) {
      const apercu = formatAlertes(detectees);
      return {
        preview: true,
        dateISO: day,
        alertes: detectees,
        titreParam: apercu.titreParam,
        body: apercu.body,
        fallbackText: apercu.fallbackText,
      };
    }

    // Diagnostic sec, calqué sur sprayDigest : on résout l'audience et on
    // s'arrête. AUCUN envoi, AUCUNE écriture, AUCUNE purge — ce mode est
    // ouvert à tout utilisateur authentifié par le trigger HTTP, il ne doit
    // donc avoir strictement aucun effet de bord.
    if (options.checkRecipients) {
      const dryRecipients = await resoudreDestinataires();
      return {
        checkRecipients: true,
        dateISO: day,
        alertes: detectees,
        recipientsCount: dryRecipients.length,
        recipients: dryRecipients,
      };
    }

    const { etat, ids } = await lireEtat();
    // Purge indexée sur la date du jour SERVEUR, pas sur `day` (qui peut venir
    // de ?date= et vider toute la collection d'état — cf. purger()).
    const purged = await purger(ids, todayCasablancaISO(now()));

    const aNotifier = filtrerAlertesANotifier(detectees, etat);
    const skipped = detectees.length - aNotifier.length;

    if (!aNotifier.length) {
      console.log('[meteoAlertes] ' + day + ': aucune alerte à notifier (détectées=' +
        detectees.length + ', déjà envoyées=' + skipped + ')');
      return {
        dateISO: day, alertes: [], sent: 0, skipped: skipped,
        recipientsCount: 0, fallbackUsed: 0, purged: purged,
      };
    }

    const message = formatAlertes(aNotifier);

    const recipients = await resoudreDestinataires();

    if (!recipients.length) {
      console.error('[meteoAlertes] AUCUN destinataire résolu (dg/chef_f1/chef_f5) — ' +
        aNotifier.length + ' alerte(s) NON distribuée(s) pour ' + day);
      return {
        dateISO: day, alertes: aNotifier, sent: 0, skipped: skipped,
        recipientsCount: 0, fallbackUsed: 0, purged: purged,
      };
    }

    const bodyParams = [message.titreParam, message.body];

    // Le meteogram est récupéré et uploadé UNE fois pour tout le monde. Il
    // n'est demandé qu'ici : ni en preview, ni en checkRecipients, ni quand
    // aucune alerte n'est à notifier — pas d'appel Meteoblue pour rien.
    const mediaId = await prepareMeteogramMedia(day);

    // ── Chaîne de repli à TROIS étages ────────────────────────────────────
    // 1. template IMAGE (meteogram en header)
    // 2. template TEXTE historique (corps identique — rien n'est perdu)
    // 3. general_alert (mécanisme existant, corps mis à plat)
    // L'image ne peut donc JAMAIS empêcher une alerte de partir.
    const imageOk = recipients.map(function() { return false; });
    let imageSent = 0;
    if (mediaId) {
      const imgOutcomes = await Promise.allSettled(recipients.map(function(r) {
        return whatsapp.sendTemplateMessageWithImage(
          r.phone, IMAGE_TEMPLATE_NAME, mediaId, bodyParams, undefined, r.displayName
        );
      }));
      imgOutcomes.forEach(function(o, i) {
        const ok = o.status === 'fulfilled' && o.value && !!o.value.success;
        imageOk[i] = ok;
        if (ok) { imageSent++; return; }
        // Template pas encore approuvé, media_id périmé, réseau… : on dégrade
        // vers le texte. Le corps ne doit jamais dépendre de l'image.
        const raison = o.status === 'rejected'
          ? String((o.reason && o.reason.message) || o.reason || '')
          : String((o.value && o.value.error) || '');
        console.error('[meteoAlertes] envoi AVEC IMAGE refusé pour ' + recipients[i].phone +
          ' → repli sur le template texte : ' + raison);
      });
    }

    // Seuls les destinataires non servis par l'image passent par le texte.
    const restants = recipients.filter(function(r, i) { return !imageOk[i]; });

    const outcomes = await Promise.allSettled(restants.map(function(r) {
      return whatsapp.sendTemplateMessage(
        r.phone, TEMPLATE_NAME, bodyParams, undefined, r.displayName
      );
    }));

    let fallbackUsed = 0;
    let sent = imageSent;
    for (let i = 0; i < restants.length; i++) {
      const r = restants[i];
      const outcome = outcomes[i];
      let ok = outcome && outcome.status === 'fulfilled' && outcome.value && !!outcome.value.success;
      if (!ok && shouldFallback(outcome)) {
        fallbackUsed++;
        try {
          const retry = await whatsapp.sendTemplateMessage(
            r.phone, FALLBACK_TEMPLATE_NAME,
            [whatsapp.toSingleLine(message.fallbackText)], undefined, r.displayName
          );
          ok = !!(retry && retry.success);
        } catch (err) {
          console.error('[meteoAlertes] fallback send failed:', err && err.message);
          ok = false;
        }
      }
      if (ok) sent++;
    }

    // L'état n'est mémorisé QUE si au moins un humain a reçu l'alerte : écrire
    // après un envoi totalement raté ferait taire l'alerte pour toujours.
    // ARBITRAGE ASSUMÉ sur l'envoi PARTIEL (1 destinataire sur 2 en échec) :
    // on écrit quand même l'état et on journalise l'échec en `console.error`.
    // Ne pas écrire renverrait l'alerte à TOUS chaque matin jusqu'à ce que le
    // numéro cassé soit réparé — le DG serait spammé pour un problème qui ne
    // le concerne pas. Comportement figé par test.
    let persisted = 0;
    if (sent > 0) {
      const envoyeAt = now().toISOString();
      const writes = await Promise.allSettled(aNotifier.map(function(a) {
        return db.collection(COLLECTION).doc(a.cle).set({
          type: a.type,
          dateISO: a.dateISO,
          valeur: a.valeur,
          envoye_at: envoyeAt,
        });
      }));
      persisted = writes.filter(function(w) { return w.status === 'fulfilled'; }).length;
      if (persisted < aNotifier.length) {
        console.error('[meteoAlertes] état partiellement écrit : ' + persisted + '/' +
          aNotifier.length + ' — des alertes pourraient être renvoyées demain');
      }
    }

    const logLine = '[meteoAlertes] ' + day + ': alertes=' + aNotifier.length +
      ' sent=' + sent + '/' + recipients.length + ' image=' + imageSent +
      ' fallback=' + fallbackUsed + ' skipped=' + skipped + ' purged=' + purged;
    if (sent < recipients.length) {
      console.error(logLine + ' — ENVOI INCOMPLET');
    } else {
      console.log(logLine);
    }

    return {
      dateISO: day,
      alertes: aNotifier,
      sent: sent,
      skipped: skipped,
      recipientsCount: recipients.length,
      fallbackUsed: fallbackUsed,
      purged: purged,
      persisted: persisted,
      meteogramAvailable: !!mediaId,
      imageSent: imageSent,
    };
  }

  return { run: run };
}

module.exports = {
  TEMPLATE_NAME,
  IMAGE_TEMPLATE_NAME,
  METEOGRAM_FILENAME,
  COLLECTION,
  FENETRE_JOURS,
  SEUILS,
  MARGES_AGGRAVATION,
  LABELS,
  detecterAlertes,
  formatAlertes,
  filtrerAlertesANotifier,
  estPerimee,
  createMeteoAlertesJob,
};
