'use strict';
// @ts-check
/**
 * meteogram.js — Récupération du METEOGRAM AGRO tout fait de Meteoblue.
 *
 * Meteoblue publie une image prête à l'emploi (740×698) qui condense 7 jours :
 * température, précipitations + probabilité, couverture nuageuse, bande
 * « Spray window », évapotranspiration + FAO ETo, vent, rafales et direction.
 * C'est ce PNG que porte l'alerte météo à 7 jours : rien n'est dessiné ici.
 * (Le graphique horaire MAISON — 2 journées, cf. sprayChart.js — reste, lui,
 * l'illustration du digest quotidien de 6h : les deux coexistent.)
 *
 * ── LICENCE — CONTRAINTE, PAS UNE NOTE DE BAS DE PAGE ───────────────────────
 * L'image est diffusée par Meteoblue sous **CC BY-ND 4.0**. « ND » = *No
 * Derivatives*. Conséquence OPÉRATIONNELLE : on la transmet **TELLE QUELLE**.
 *   - JAMAIS recadrée, redimensionnée, compressée avec perte ou retouchée ;
 *   - JAMAIS amputée du logo ni de la mention meteoblue ;
 *   - JAMAIS recomposée avec d'autres éléments dans une image unique.
 * Toute « amélioration » de l'image (rogner les marges, la fusionner avec le
 * graphique maison, la passer en sombre…) sortirait du cadre de la licence.
 * Si un besoin d'édition apparaît : ça se tranche avec Omar, pas dans le code.
 *
 * ⚠️ VÉRIFIÉ le 2026-08-19 : le PNG réellement servi par cet endpoint ne porte
 * AUCUN chunk de métadonnées (chunks présents : IHDR, sBIT, PLTE, IDAT, IEND —
 * ni tEXt, ni iTXt, ni zTXt). La licence ne se lit donc PAS dans le fichier :
 * elle vient des conditions de Meteoblue. Ne pas conclure d'un `strings` muet
 * que l'image serait libre de retouche. La mention « meteoblue » et le logo,
 * eux, sont incrustés dans les pixels — les préserver revient à ne pas
 * recadrer.
 *
 * Module PUR en injection de dépendances (cf. meteoblueProxy.js) : aucun accès
 * réseau direct, `fetchBuffer` est injecté par l'appelant (functions/index.js).
 */

const METEOGRAM_BASE_URL = 'https://my.meteoblue.com/visimage/meteogram_agro';

/** MIME du meteogram, tel qu'attendu par whatsappService.uploadMedia. */
const PNG_MIME = 'image/png';

/** Signature d'en-tête PNG (RFC 2083, §3.1) : \x89PNG\r\n\x1a\n. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

/**
 * Taille plancher. Le meteogram réel pèse ~100 ko ; un PNG de quelques
 * centaines d'octets serait une image d'erreur ou un placeholder, pas une
 * prévision. Meteoblue a déjà servi des HTTP 200 creux au projet (cf.
 * `isValidWeatherPayload` dans meteoblueProxy.js) — on applique ici la même
 * défiance à un payload binaire.
 */
const MIN_PNG_BYTES = 2048;

/** Au-delà, l'alerte partirait en retard : on abandonne l'image. */
const DEFAULT_TIMEOUT_MS = 12000;

/**
 * Unités EXPLICITES : sans elles, Meteoblue peut servir un meteogram en unités
 * impériales (°F / mph / inch) selon le profil du compte. Une alerte « vent
 * fort » illustrée en mph serait un contresens opérationnel.
 */
const DEFAULT_UNITS = Object.freeze({
  temperature: 'C',
  windspeed: 'kmh',
  precipitationamount: 'mm',
});

/**
 * @typedef {Object} MeteogramDeps
 * @property {(url: string) => Promise<Buffer|null>} fetchBuffer HTTP GET → corps
 *   binaire. Injecté par l'appelant.
 * @property {string} apiKey Clé API Meteoblue.
 * @property {number} [timeoutMs] Défaut : DEFAULT_TIMEOUT_MS.
 */

/**
 * URL du meteogram agro pour un point donné.
 *
 * @param {{lat:number, lon:number, altitude:number}} coords
 * @param {string} apiKey
 * @param {{temperature?:string, windspeed?:string, precipitationamount?:string}} [opts]
 * @returns {string}
 */
function buildMeteogramUrl({ lat, lon, altitude }, apiKey, opts) {
  const o = opts || {};
  const temperature = o.temperature || DEFAULT_UNITS.temperature;
  const windspeed = o.windspeed || DEFAULT_UNITS.windspeed;
  const precipitationamount = o.precipitationamount || DEFAULT_UNITS.precipitationamount;
  return METEOGRAM_BASE_URL + '?apikey=' + apiKey +
    '&lat=' + lat + '&lon=' + lon + '&asl=' + altitude +
    '&temperature=' + temperature +
    '&windspeed=' + windspeed +
    '&precipitationamount=' + precipitationamount;
}

/**
 * Vrai si le buffer est un PNG plausible. Rejette notamment une page d'erreur
 * HTML servie en HTTP 200 (« <!DOCTYPE… ») et un corps vide ou tronqué.
 *
 * @param {*} buf
 * @returns {boolean}
 */
function isValidPng(buf) {
  if (!Buffer.isBuffer(buf)) return false;
  if (buf.length < MIN_PNG_BYTES) return false;
  return buf.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/**
 * Borne la durée d'une promesse.
 *
 * ⚠️ Le timer n'est PAS `unref`é — c'était un bug, corrigé après un rouge CI
 * (PR #275). Un timer `unref`é n'empêche pas la boucle d'événements de se
 * vider : si le `fetch` injecté ne répond jamais et que rien d'autre ne tient
 * la boucle, Node conclut qu'il n'y a plus de travail, le timer ne se déclenche
 * JAMAIS et la promesse rendue ici ne se règle jamais. Le garde-fou censé
 * borner l'attente était donc lui-même sans garantie.
 *
 * Le timer est en revanche nettoyé sur TOUS les chemins de sortie (succès,
 * erreur, timeout) via `finally` : systématiquement nettoyé, il ne peut pas
 * retenir le process, et n'a donc aucun besoin d'être `unref`é.
 *
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms) {
  /** @type {*} */
  let timer = null;
  const garde = new Promise(function(_resolve, reject) {
    timer = setTimeout(function() {
      reject(new Error('timeout après ' + ms + ' ms'));
    }, ms);
  });
  return Promise.race([Promise.resolve(promise), garde])
    .finally(function() { clearTimeout(timer); });
}

/**
 * Récupère le meteogram agro. Ne lève JAMAIS pour une raison réseau : l'image
 * est un bonus, le texte de l'alerte est l'essentiel. Retourne `null` au
 * moindre doute — mieux vaut une alerte sans image qu'une alerte illustrée
 * d'une page d'erreur.
 *
 * @param {{lat:number, lon:number, altitude:number}} coords
 * @param {MeteogramDeps} deps
 * @returns {Promise<Buffer|null>}
 */
async function fetchMeteogram({ lat, lon, altitude }, deps) {
  if (!deps || typeof deps.fetchBuffer !== 'function' || typeof deps.apiKey !== 'string') {
    throw new TypeError('fetchMeteogram: deps.fetchBuffer(url) et deps.apiKey requis');
  }
  const url = buildMeteogramUrl({ lat, lon, altitude }, deps.apiKey);
  const timeoutMs = typeof deps.timeoutMs === 'number' && deps.timeoutMs > 0
    ? deps.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  let buf;
  try {
    buf = await withTimeout(Promise.resolve().then(function() {
      return deps.fetchBuffer(url);
    }), timeoutMs);
  } catch (err) {
    console.warn('meteogram.fetchMeteogram: échec réseau —', err && err.message);
    return null;
  }

  if (!isValidPng(buf)) {
    const taille = Buffer.isBuffer(buf) ? buf.length + ' octets' : typeof buf;
    console.warn('meteogram.fetchMeteogram: réponse non PNG ou creuse (' + taille +
      '), traitée comme une absence d\'image');
    return null;
  }
  return buf;
}

module.exports = {
  METEOGRAM_BASE_URL,
  PNG_MIME,
  PNG_SIGNATURE,
  MIN_PNG_BYTES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_UNITS,
  buildMeteogramUrl,
  isValidPng,
  withTimeout,
  fetchMeteogram,
};
