/**
 * sprayChart — le SVG est le SEUL artefact vérifiable sans rendu : tout ce qui
 * suit s'assure qu'il est structurellement sain (pas de coordonnée NaN, XML
 * échappé) et surtout que les BANDES tombent sur les mêmes heures que les
 * fenêtres annoncées dans le texte par `buildSprayWindows`. Un décalage d'une
 * heure entre l'image et le message serait invisible en prod.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  WIDTH,
  HEIGHT,
  MARGIN,
  WORK_HOUR_START,
  AXIS_HOUR_END,
  BAND_COLORS,
  escapeXml,
  extractHourlyTemperatures,
  extractSprayHours,
  buildSprayChartSvg,
} = require('../sprayChart');
const { buildSprayWindows } = require('../sprayDigest');

const DAY = '2026-08-19';

/** Horodatage Meteoblue « YYYY-MM-DD HH:MM ». */
function stamp(day, h) {
  return day + ' ' + String(h).padStart(2, '0') + ':00';
}

/**
 * Package spray synthétique : `levels` donne la valeur spraywindow des heures
 * 0..23 (défaut 0). On ajoute la veille pour prouver que le filtrage par date
 * fonctionne.
 */
function sprayPackage(levels) {
  const time = [];
  const spraywindow = [];
  ['2026-08-18', DAY].forEach((day) => {
    for (let h = 0; h < 24; h++) {
      time.push(stamp(day, h));
      spraywindow.push(day === DAY ? (levels[h] === undefined ? 0 : levels[h]) : 1);
    }
  });
  return { data_1h: { time, spraywindow } };
}

function weatherPackage(tempByHour) {
  const time = [];
  const temperature = [];
  for (let h = 0; h < 24; h++) {
    time.push(stamp(DAY, h));
    temperature.push(tempByHour[h] === undefined ? null : tempByHour[h]);
  }
  return { data_1h: { time, temperature } };
}

/** Journée réaliste : 6h-9h favorable, 9h-16h défavorable, 16h-20h modéré. */
const LEVELS = (() => {
  const l = {};
  for (let h = 6; h < 9; h++) l[h] = 1;
  for (let h = 9; h < 16; h++) l[h] = 0;
  for (let h = 16; h <= 20; h++) l[h] = 2;
  return l;
})();

const TEMPS = (() => {
  const t = {};
  for (let h = 0; h < 24; h++) t[h] = 14 + 10 * Math.sin(((h - 5) / 24) * Math.PI);
  return t;
})();

/** Toutes les valeurs numériques des attributs du SVG. */
function attrNumbers(svg) {
  // Espace en tête obligatoire, sinon `x=` matcherait aussi `viewBox=`.
  return svg.match(/ (?:x|y|x1|y1|x2|y2|cx|cy|r|width|height)="([^"]*)"/g) || [];
}

test('extractHourlyTemperatures : heures ouvrées du bon jour, triées, sans trou', () => {
  const pts = extractHourlyTemperatures(weatherPackage(TEMPS), DAY);
  assert.equal(pts.length, 15, '6h → 20h inclus');
  assert.equal(pts[0].hour, 6);
  assert.equal(pts[pts.length - 1].hour, 20);
  pts.forEach((p, i) => {
    if (i > 0) assert.ok(p.hour > pts[i - 1].hour, 'strictement croissant');
    assert.ok(Number.isFinite(p.temp));
  });
});

test('extractHourlyTemperatures : entrées non exploitables ignorées, jamais de throw', () => {
  assert.deepEqual(extractHourlyTemperatures(null, DAY), []);
  assert.deepEqual(extractHourlyTemperatures({}, DAY), []);
  assert.deepEqual(extractHourlyTemperatures({ data_1h: { time: 'x' } }, DAY), []);
  const troue = {
    data_1h: {
      time: [stamp(DAY, 6), stamp(DAY, 7), stamp(DAY, 8), 'bruit'],
      temperature: [18, null, 'chaud', 20],
    },
  };
  assert.deepEqual(extractHourlyTemperatures(troue, DAY), [{ hour: 6, temp: 18 }]);
});

test('extractSprayHours : même fenêtre horaire que buildSprayWindows', () => {
  const pkg = sprayPackage(LEVELS);
  const hours = extractSprayHours(pkg, DAY);
  const windows = buildSprayWindows(pkg, DAY);
  assert.equal(hours.length, windows.totalWork, 'même nombre d\'heures ouvrées vues des deux côtés');
  assert.equal(hours.filter((h) => h.value === 1).length, windows.bonCount);
  assert.equal(hours.filter((h) => h.value === 2).length, windows.moyenCount);
  assert.equal(hours.filter((h) => h.value === 0).length, windows.mauvaisCount);
});

test('bandes alignées sur les mêmes abscisses que les fenêtres de buildSprayWindows', () => {
  const pkg = sprayPackage(LEVELS);
  const windows = buildSprayWindows(pkg, DAY);
  assert.deepEqual(windows.fenetres, [{ de: 6, a: 9 }], 'fixture : une seule fenêtre 6h-9h');

  const svg = buildSprayChartSvg({ dateISO: DAY, sprayData: pkg, weatherData: weatherPackage(TEMPS) });
  const innerW = WIDTH - MARGIN.l - MARGIN.r;
  const cellW = innerW / (AXIS_HOUR_END - WORK_HOUR_START);
  const xAt = (h) => MARGIN.l + (h - WORK_HOUR_START) * cellW;

  // Toutes les bandes vertes du SVG, dans l'ordre.
  const vertes = (svg.match(/<rect [^>]*fill="#2D8B4E" fill-opacity="0\.8"\/>/g) || [])
    .filter((r) => /height="300"/.test(r))
    .map((r) => Number(/ x="([-\d.]+)"/.exec(r)[1]));
  assert.equal(vertes.length, 3, '3 créneaux favorables (6, 7, 8)');

  const debut = Math.min.apply(null, vertes);
  const fin = Math.max.apply(null, vertes) + cellW;
  assert.ok(Math.abs(debut - xAt(6)) < 0.02, 'la bande verte commence à l\'abscisse de 6h');
  assert.ok(Math.abs(fin - xAt(9)) < 0.02, 'et se termine à l\'abscisse de 9h (borne exclusive)');
});

test('les bandes couvrent exactement les 15 heures ouvrées, sans trou ni recouvrement', () => {
  const svg = buildSprayChartSvg({ dateISO: DAY, sprayData: sprayPackage(LEVELS) });
  const bandes = (svg.match(/<rect [^>]*height="300"[^>]*\/>/g) || [])
    .map((r) => Number(/ x="([-\d.]+)"/.exec(r)[1]))
    .sort((a, b) => a - b);
  assert.equal(bandes.length, 15);
  const cellW = (WIDTH - MARGIN.l - MARGIN.r) / (AXIS_HOUR_END - WORK_HOUR_START);
  for (let i = 1; i < bandes.length; i++) {
    assert.ok(Math.abs(bandes[i] - bandes[i - 1] - cellW) < 0.02, 'bandes jointives');
  }
  assert.ok(Math.abs(bandes[0] - MARGIN.l) < 0.02);
  assert.ok(Math.abs(bandes[14] + cellW - (WIDTH - MARGIN.r)) < 0.02);
});

test('les trois niveaux AgroSpray portent les couleurs et opacités de l\'écran', () => {
  const svg = buildSprayChartSvg({ dateISO: DAY, sprayData: sprayPackage(LEVELS) });
  assert.equal(BAND_COLORS[1].fill, '#2D8B4E');
  assert.equal(BAND_COLORS[2].fill, '#F39C12');
  assert.equal(BAND_COLORS[0].fill, '#E74C3C');
  assert.ok(svg.includes('fill="#2D8B4E" fill-opacity="0.8"'));
  assert.ok(svg.includes('fill="#F39C12" fill-opacity="0.6"'));
  assert.ok(svg.includes('fill="#E74C3C" fill-opacity="0.4"'));
});

test('SVG bien formé : en-tête, viewBox, fermeture, palette sombre', () => {
  const svg = buildSprayChartSvg({
    dateISO: DAY,
    weatherData: weatherPackage(TEMPS),
    sprayData: sprayPackage(LEVELS),
    dateLabel: 'Mer 19/08',
    scoreText: '45% (Partiel)',
  });
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.endsWith('</svg>'));
  assert.ok(svg.includes('viewBox="0 0 ' + WIDTH + ' ' + HEIGHT + '"'));
  assert.ok(svg.includes('fill="#0F0F0F"'), 'fond sombre');
  assert.ok(svg.includes('Mer 19/08'));
  assert.ok(svg.includes('45% (Partiel)'));
  assert.ok(svg.includes('Favorable') && svg.includes('Modéré') && svg.includes('Défavorable'), 'légende');
});

test('AUCUN NaN / undefined / null dans le SVG produit', () => {
  const cas = [
    { dateISO: DAY, weatherData: weatherPackage(TEMPS), sprayData: sprayPackage(LEVELS), scoreText: '45% (Partiel)' },
    { dateISO: DAY },
    {},
    { dateISO: DAY, weatherData: { data_1h: { time: [stamp(DAY, 6)], temperature: [NaN] } } },
    { dateISO: DAY, weatherData: weatherPackage({ 6: 21, 7: 21, 8: 21 }) },
    { dateISO: DAY, sprayData: { data_1h: { time: [stamp(DAY, 6)], spraywindow: [7] } } },
  ];
  cas.forEach((input, i) => {
    const svg = buildSprayChartSvg(/** @type {*} */ (input));
    assert.doesNotMatch(svg, /NaN/, 'cas ' + i + ' : NaN dans le SVG');
    assert.doesNotMatch(svg, /undefined/, 'cas ' + i + ' : undefined dans le SVG');
    assert.doesNotMatch(svg, /="null"/, 'cas ' + i + ' : null dans un attribut');
    attrNumbers(svg).forEach((a) => {
      const v = Number(/="([^"]*)"/.exec(a)[1]);
      assert.ok(Number.isFinite(v), 'cas ' + i + ' : attribut non numérique ' + a);
    });
  });
});

test('graduations °C entières : aucune ligne étiquetée à un demi-degré près', () => {
  // Amplitude brute 19 → 29 = 10, non divisible par les 4 intervalles de la
  // grille : sans correction, la 2e ligne vaut 26,5° et s'afficherait « 27° ».
  const svg = buildSprayChartSvg({ dateISO: DAY, weatherData: weatherPackage({ 6: 20, 12: 28, 20: 22 }) });
  const labels = (svg.match(/>(-?\d+)°<\/text>/g) || []).map((m) => Number(/(-?\d+)/.exec(m)[1]));
  assert.equal(labels.length, 5, '5 graduations');
  const pas = labels[0] - labels[1];
  labels.forEach((v, i) => {
    if (i > 0) assert.equal(labels[i - 1] - v, pas, 'pas constant et entier');
  });
  assert.ok(Number.isInteger(pas) && pas > 0);
});

test('journée plate : amplitude d\'axe plancher, pas de division par zéro', () => {
  const svg = buildSprayChartSvg({ dateISO: DAY, weatherData: weatherPackage({ 6: 20, 7: 20, 8: 20 }) });
  assert.doesNotMatch(svg, /NaN/);
  assert.ok(svg.includes('stroke="#5DADE2"'), 'la courbe existe quand même');
});

test('pas de données horaires → aucune courbe, message explicite à la place', () => {
  const svg = buildSprayChartSvg({ dateISO: DAY, sprayData: sprayPackage(LEVELS) });
  assert.ok(!/<path /.test(svg), 'aucun tracé de courbe');
  assert.ok(!/<circle /.test(svg), 'aucune annotation min/max');
  assert.ok(svg.includes('Température horaire indisponible'));
  // Les bandes, elles, restent affichées : l'information spray n'est pas perdue.
  assert.ok(svg.includes('fill="#2D8B4E"'));
});

test('un seul point horaire : pas de courbe (rien à relier) mais annotation présente', () => {
  const svg = buildSprayChartSvg({
    dateISO: DAY,
    weatherData: { data_1h: { time: [stamp(DAY, 6)], temperature: [19] } },
  });
  assert.ok(!/<path /.test(svg));
  assert.ok(svg.includes('max 19°C'));
  assert.ok(svg.includes('min 19°C'));
});

test('courbe présente dès 2 points, avec les attributs de style demandés', () => {
  const svg = buildSprayChartSvg({ dateISO: DAY, weatherData: weatherPackage(TEMPS) });
  const path = /<path d="([^"]+)"([^>]*)\/>/.exec(svg);
  assert.ok(path, 'un <path> de courbe');
  assert.match(path[2], /stroke="#5DADE2"/);
  assert.match(path[2], /stroke-width="2\.5"/);
  assert.match(path[2], /stroke-linecap="round"/);
  assert.match(path[2], /stroke-linejoin="round"/);
  assert.equal((path[1].match(/[ML]/g) || []).length, 15, '15 points, 6h → 20h');
  assert.ok(path[1].startsWith('M'));
});

test('graduations horaires toutes les 2 h, de 6h à 20h', () => {
  const svg = buildSprayChartSvg({ dateISO: DAY, weatherData: weatherPackage(TEMPS) });
  ['6h', '8h', '10h', '12h', '14h', '16h', '18h', '20h'].forEach((t) => {
    assert.ok(svg.includes('>' + t + '</text>'), 'graduation ' + t);
  });
  assert.ok(!svg.includes('>7h</text>'), 'pas de graduation impaire');
});

test('escapeXml : les cinq caractères dangereux, & en premier', () => {
  assert.equal(escapeXml('Météo & Traitements'), 'Météo &amp; Traitements');
  assert.equal(escapeXml('<script>'), '&lt;script&gt;');
  assert.equal(escapeXml('a"b\'c'), 'a&quot;b&apos;c');
  assert.equal(escapeXml('&amp;'), '&amp;amp;', 'pas de double décodage');
  assert.equal(escapeXml(null), '');
  assert.equal(escapeXml(undefined), '');
});

test('le texte injecté est échappé : un & nu ne peut pas casser le rendu', () => {
  const svg = buildSprayChartSvg({
    dateISO: DAY,
    dateLabel: 'Jeu 14/08 <F1 & F5>',
    scoreText: '62% "Partiel" & co',
    weatherData: weatherPackage(TEMPS),
  });
  assert.ok(svg.includes('Jeu 14/08 &lt;F1 &amp; F5&gt;'));
  assert.ok(svg.includes('62% &quot;Partiel&quot; &amp; co'));
  // Aucune esperluette non suivie d'une entité connue.
  assert.doesNotMatch(svg, /&(?!amp;|lt;|gt;|quot;|apos;)/);
  // Le titre statique porte lui aussi un & (« Météo & Traitements »).
  assert.ok(svg.includes('Météo &amp; Traitements'));
});
