'use strict';
// @ts-check
/**
 * sprayChart.js — Graphique horaire « Météo & Traitements » du digest de 6h,
 * produit en SVG PUR (chaîne de caractères), sans aucune dépendance.
 *
 * Le rendu en PNG est isolé dans `renderPng.js` : ce module reste une fonction
 * pure, testable sans binaire natif ni navigateur.
 *
 * Le dessin reprend la sémantique de deux blocs de l'écran Météo
 * (`public/app.jsx`) :
 * - la courbe de température horaire du panneau « Prévision extérieure »
 *   (mêmes viewBox 900×360 et mêmes marges) ;
 * - la timeline AgroSpray 6h-20h (mêmes couleurs et mêmes opacités par niveau).
 *
 * ── Convention d'axe (importante) ───────────────────────────────────────────
 * L'axe X couvre les heures 6 → 21. Ce n'est pas une coquille : `spraywindow`
 * à l'heure `h` qualifie le CRÉNEAU `h → h+1`, donc la dernière heure ouvrée
 * (20h) occupe la bande 20 → 21. C'est exactement la convention de
 * `buildSprayWindows` (`{de, a}` avec `a` exclusif : une fenêtre 6h-9h couvre
 * les créneaux 6, 7 et 8). Les bandes du graphique et les fenêtres du texte
 * tombent ainsi sur les mêmes abscisses.
 * La température, elle, est une valeur INSTANTANÉE : le point de l'heure `h`
 * est posé sur l'abscisse de `h`, pas au centre de la bande.
 */

/** Géométrie — identique au graphique « Prévision extérieure » de l'écran. */
const WIDTH = 900;
const HEIGHT = 360;
const MARGIN = Object.freeze({ t: 24, b: 36, l: 78, r: 96 });

/** Première heure ouvrée affichée (cf. sprayDigest.WORK_HOUR_START). */
const WORK_HOUR_START = 6;
/** Dernière heure ouvrée affichée, INCLUSE (cf. sprayDigest.WORK_HOUR_END). */
const WORK_HOUR_END = 20;
/** Borne droite de l'axe : fin du créneau de la dernière heure ouvrée. */
const AXIS_HOUR_END = WORK_HOUR_END + 1;

/** Couleurs des bandes AgroSpray — identiques à la timeline de public/app.jsx. */
const BAND_COLORS = Object.freeze({
  1: { fill: '#2D8B4E', opacity: 0.8, label: 'Favorable' },
  2: { fill: '#F39C12', opacity: 0.6, label: 'Modéré' },
  0: { fill: '#E74C3C', opacity: 0.4, label: 'Défavorable' },
});

/** Palette sombre (lisibilité WhatsApp, choix produit d'Omar). */
const THEME = Object.freeze({
  bg: '#0F0F0F',
  band: '#171717',
  grid: '#2A2A2A',
  axis: '#3A3A3A',
  text: '#ECECEC',
  muted: '#9A9A9A',
  temp: '#5DADE2',
});

/** Amplitude minimale de l'axe des °C : sans elle, une journée plate zigzague. */
const MIN_TEMP_SPAN = 6;

/**
 * Échappe les caractères interdits dans du texte / des attributs XML. Un `&`
 * nu (ex. « Météo & Traitements ») rend le SVG invalide, et resvg le rejette
 * SILENCIEUSEMENT : pas d'exception, juste une image vide.
 * @param {*} value
 * @returns {string}
 */
function escapeXml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Arrondit à `d` décimales et garantit un nombre FINI. Tout ce qui entre dans
 * une coordonnée SVG passe par ici : un seul `NaN` dans un `d="…"` et le tracé
 * disparaît sans erreur.
 * @param {*} v
 * @param {number} [d]
 * @returns {number}
 */
function coord(v, d) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const p = Math.pow(10, d === undefined ? 2 : d);
  return Math.round(n * p) / p;
}

/**
 * Heure entière extraite d'un horodatage Meteoblue « YYYY-MM-DD HH:MM », pour
 * la date demandée uniquement.
 * @param {*} stamp
 * @param {string} dateISO
 * @returns {number|null}
 */
function hourOf(stamp, dateISO) {
  const parts = String(stamp === null || stamp === undefined ? '' : stamp).split(' ');
  if (parts[0] !== dateISO) return null;
  const h = parseInt(parts[1], 10);
  return Number.isFinite(h) ? h : null;
}

/**
 * Températures horaires du jour, restreintes aux heures ouvrées et triées.
 * @param {object|null|undefined} weatherData Package weather (`data_1h`).
 * @param {string} dateISO
 * @returns {Array<{hour:number, temp:number}>}
 */
function extractHourlyTemperatures(weatherData, dateISO) {
  if (!weatherData || !weatherData.data_1h) return [];
  const times = weatherData.data_1h.time;
  const temps = weatherData.data_1h.temperature;
  if (!Array.isArray(times) || !Array.isArray(temps)) return [];

  /** @type {Array<{hour:number, temp:number}>} */
  const out = [];
  times.forEach(function(t, i) {
    const h = hourOf(t, dateISO);
    if (h === null || h < WORK_HOUR_START || h > WORK_HOUR_END) return;
    const v = temps[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    out.push({ hour: h, temp: v });
  });
  return out.sort(function(a, b) { return a.hour - b.hour; });
}

/**
 * Niveaux AgroSpray horaires du jour, restreints aux heures ouvrées et triés.
 * Même filtre que `buildSprayWindows` : les deux voient exactement les mêmes
 * heures, donc les bandes ne peuvent pas diverger des fenêtres annoncées.
 * @param {object|null|undefined} sprayData Package spray (`data_1h`).
 * @param {string} dateISO
 * @returns {Array<{hour:number, value:number}>}
 */
function extractSprayHours(sprayData, dateISO) {
  if (!sprayData || !sprayData.data_1h) return [];
  const times = sprayData.data_1h.time;
  const values = sprayData.data_1h.spraywindow;
  if (!Array.isArray(times) || !Array.isArray(values)) return [];

  /** @type {Array<{hour:number, value:number}>} */
  const out = [];
  times.forEach(function(t, i) {
    const h = hourOf(t, dateISO);
    if (h === null || h < WORK_HOUR_START || h > WORK_HOUR_END) return;
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    out.push({ hour: h, value: v });
  });
  return out.sort(function(a, b) { return a.hour - b.hour; });
}

/**
 * Balise `<text>` prête à concaténer. Le contenu est TOUJOURS échappé.
 * @param {number} x
 * @param {number} y
 * @param {string} content
 * @param {{size?:number, fill?:string, anchor?:string, weight?:number|string}} [opt]
 * @returns {string}
 */
function textEl(x, y, content, opt) {
  const o = opt || {};
  return '<text x="' + coord(x) + '" y="' + coord(y) + '"' +
    ' font-size="' + coord(o.size === undefined ? 11 : o.size, 1) + '"' +
    ' fill="' + escapeXml(o.fill || THEME.text) + '"' +
    ' text-anchor="' + escapeXml(o.anchor || 'start') + '"' +
    ' font-weight="' + escapeXml(o.weight === undefined ? 400 : o.weight) + '"' +
    '>' + escapeXml(content) + '</text>';
}

/**
 * @typedef {Object} SprayChartInput
 * @property {string} dateISO      Jour tracé (YYYY-MM-DD).
 * @property {object|null} [weatherData] Package weather brut (`data_1h`).
 * @property {object|null} [sprayData]   Package spray brut (`data_1h`).
 * @property {string} [dateLabel]  Libellé lisible (ex. « Jeu 14/08 »).
 * @property {string} [scoreText]  Score déjà mis en forme (ex. « 62% (Partiel) »).
 */

/**
 * Construit le SVG du graphique horaire du jour.
 *
 * Ne lève jamais : une entrée vide produit un graphique valide portant un
 * message d'indisponibilité (le digest doit partir même sans données horaires).
 *
 * @param {SprayChartInput} input
 * @returns {string} Document SVG complet.
 */
function buildSprayChartSvg(input) {
  const cfg = input || /** @type {SprayChartInput} */ ({});
  const dateISO = String(cfg.dateISO || '');
  const temps = extractHourlyTemperatures(cfg.weatherData, dateISO);
  const bands = extractSprayHours(cfg.sprayData, dateISO);

  const innerW = WIDTH - MARGIN.l - MARGIN.r;
  const innerH = HEIGHT - MARGIN.t - MARGIN.b;
  const hourSpan = AXIS_HOUR_END - WORK_HOUR_START;
  const cellW = innerW / hourSpan;
  /** Abscisse d'une heure (bornes de bande ET points de courbe). */
  const xAt = function(hour) { return MARGIN.l + (hour - WORK_HOUR_START) * cellW; };

  // Axe des °C : cadré sur les données, avec une amplitude plancher.
  const values = temps.map(function(p) { return p.temp; });
  const rawMin = values.length ? Math.min.apply(null, values) : 0;
  const rawMax = values.length ? Math.max.apply(null, values) : 0;
  let tLo = Math.floor(rawMin - 1);
  let tHi = Math.ceil(rawMax + 1);
  if (tHi - tLo < MIN_TEMP_SPAN) {
    const mid = (tHi + tLo) / 2;
    tLo = Math.floor(mid - MIN_TEMP_SPAN / 2);
    tHi = tLo + MIN_TEMP_SPAN;
  }
  const yAt = function(v) { return MARGIN.t + innerH * (1 - (v - tLo) / (tHi - tLo)); };

  const parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + WIDTH + '" height="' + HEIGHT +
    '" viewBox="0 0 ' + WIDTH + ' ' + HEIGHT + '">');
  parts.push('<rect x="0" y="0" width="' + WIDTH + '" height="' + HEIGHT + '" fill="' + THEME.bg + '"/>');

  // ── Bandeau titre : date à gauche, légende au centre, score à droite ──────
  parts.push('<rect x="0" y="0" width="' + WIDTH + '" height="' + MARGIN.t + '" fill="' + THEME.band + '"/>');
  parts.push(textEl(10, 16, 'Météo & Traitements — ' + (cfg.dateLabel || dateISO || '—'),
    { size: 12, weight: 700 }));
  if (cfg.scoreText) {
    parts.push(textEl(WIDTH - 10, 16, 'Score du jour : ' + cfg.scoreText,
      { size: 12, weight: 700, anchor: 'end' }));
  }
  let legendX = 372;
  [1, 2, 0].forEach(function(level) {
    const b = BAND_COLORS[level];
    parts.push('<rect x="' + coord(legendX) + '" y="7" width="10" height="10" rx="2" fill="' + b.fill +
      '" fill-opacity="' + b.opacity + '"/>');
    parts.push(textEl(legendX + 14, 16, b.label, { size: 10, fill: THEME.muted }));
    legendX += 14 + b.label.length * 6 + 14;
  });

  // ── Bandes AgroSpray en fond : une par créneau horaire ────────────────────
  bands.forEach(function(b) {
    const style = BAND_COLORS[b.value];
    if (!style) return;
    parts.push('<rect x="' + coord(xAt(b.hour)) + '" y="' + coord(MARGIN.t) +
      '" width="' + coord(cellW) + '" height="' + coord(innerH) +
      '" fill="' + style.fill + '" fill-opacity="' + style.opacity + '"/>');
  });

  // ── Grille horizontale + graduations °C ───────────────────────────────────
  for (let i = 0; i <= 4; i++) {
    const y = MARGIN.t + innerH * (i / 4);
    const v = tHi - (tHi - tLo) * (i / 4);
    parts.push('<line x1="' + coord(MARGIN.l) + '" y1="' + coord(y) + '" x2="' + coord(WIDTH - MARGIN.r) +
      '" y2="' + coord(y) + '" stroke="' + THEME.grid + '" stroke-width="1"/>');
    parts.push(textEl(MARGIN.l - 8, y + 4, Math.round(v) + '°', { size: 11, fill: THEME.muted, anchor: 'end' }));
  }
  parts.push('<line x1="' + coord(MARGIN.l) + '" y1="' + coord(MARGIN.t + innerH) +
    '" x2="' + coord(WIDTH - MARGIN.r) + '" y2="' + coord(MARGIN.t + innerH) +
    '" stroke="' + THEME.axis + '" stroke-width="1"/>');

  // ── Graduations horaires, toutes les 2 h ──────────────────────────────────
  for (let h = WORK_HOUR_START; h <= AXIS_HOUR_END; h += 2) {
    parts.push('<line x1="' + coord(xAt(h)) + '" y1="' + coord(MARGIN.t) + '" x2="' + coord(xAt(h)) +
      '" y2="' + coord(MARGIN.t + innerH) + '" stroke="' + THEME.grid + '" stroke-width="1"/>');
    parts.push(textEl(xAt(h), HEIGHT - 14, String(h) + 'h',
      { size: 11, fill: THEME.muted, anchor: 'middle' }));
  }
  parts.push(textEl(MARGIN.l - 8, MARGIN.t - 6, '°C', { size: 10, fill: THEME.temp, anchor: 'end', weight: 700 }));

  // ── Courbe de température ─────────────────────────────────────────────────
  if (temps.length >= 2) {
    const d = temps.map(function(p, i) {
      return (i === 0 ? 'M' : 'L') + coord(xAt(p.hour)) + ',' + coord(yAt(p.temp));
    }).join(' ');
    parts.push('<path d="' + d + '" fill="none" stroke="' + THEME.temp +
      '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>');
  }

  // ── Annotations min / max ─────────────────────────────────────────────────
  if (temps.length) {
    const minPt = temps.reduce(function(a, b) { return b.temp < a.temp ? b : a; }, temps[0]);
    const maxPt = temps.reduce(function(a, b) { return b.temp > a.temp ? b : a; }, temps[0]);
    [
      { pt: maxPt, dy: -12, label: 'max ' + Math.round(maxPt.temp) + '°C' },
      { pt: minPt, dy: 18, label: 'min ' + Math.round(minPt.temp) + '°C' },
    ].forEach(function(a) {
      const x = xAt(a.pt.hour);
      parts.push('<circle cx="' + coord(x) + '" cy="' + coord(yAt(a.pt.temp)) +
        '" r="4" fill="' + THEME.temp + '" stroke="' + THEME.bg + '" stroke-width="1.5"/>');
      // Ancrage rabattu près des bords pour que le libellé reste dans le cadre.
      const anchor = x < MARGIN.l + 40 ? 'start' : (x > WIDTH - MARGIN.r - 40 ? 'end' : 'middle');
      parts.push(textEl(x, yAt(a.pt.temp) + a.dy, a.label,
        { size: 11, fill: THEME.text, weight: 700, anchor: anchor }));
    });
  } else {
    parts.push(textEl(MARGIN.l + innerW / 2, MARGIN.t + innerH / 2,
      'Température horaire indisponible', { size: 14, fill: THEME.muted, anchor: 'middle', weight: 700 }));
  }

  parts.push('</svg>');
  return parts.join('');
}

module.exports = {
  WIDTH,
  HEIGHT,
  MARGIN,
  WORK_HOUR_START,
  WORK_HOUR_END,
  AXIS_HOUR_END,
  BAND_COLORS,
  THEME,
  escapeXml,
  extractHourlyTemperatures,
  extractSprayHours,
  buildSprayChartSvg,
};
