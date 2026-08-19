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
  PANEL_GAP,
  WORK_HOUR_START,
  AXIS_HOUR_END,
  BAND_COLORS,
  LEGEND_OPACITY,
  escapeXml,
  extractHourlyTemperatures,
  extractSprayHours,
  buildSprayChartSvg,
} = require('../sprayChart');
const { buildSprayWindows } = require('../sprayDigest');

const DAY = '2026-08-19';
const DEMAIN = '2026-08-20';

/** Hauteur de la zone de tracé — hauteur exacte des bandes AgroSpray. */
const INNER_H = HEIGHT - MARGIN.t - MARGIN.b;

/** Horodatage Meteoblue « YYYY-MM-DD HH:MM ». */
function stamp(day, h) {
  return day + ' ' + String(h).padStart(2, '0') + ':00';
}

/**
 * Package spray synthétique : `levels` donne la valeur spraywindow des heures
 * 0..23 (défaut 0). On ajoute la veille pour prouver que le filtrage par date
 * fonctionne.
 */
function sprayPackage(levels, levelsDemain) {
  const time = [];
  const spraywindow = [];
  // DEMAIN n'est présent que si on en fournit les niveaux : sans ça, aucun test
  // ne pourrait décrire un package qui S'ARRÊTE aujourd'hui.
  ['2026-08-18', DAY, DEMAIN].forEach((day) => {
    if (day === DEMAIN && !levelsDemain) return;
    for (let h = 0; h < 24; h++) {
      time.push(stamp(day, h));
      let v = 1; // veille : valeur repère, ne doit jamais être tracée
      if (day === DAY) v = levels[h] === undefined ? 0 : levels[h];
      else if (day === DEMAIN) v = levelsDemain[h] === undefined ? 0 : levelsDemain[h];
      spraywindow.push(v);
    }
  });
  return { data_1h: { time, spraywindow } };
}

function weatherPackage(tempByHour, tempByHourDemain) {
  const time = [];
  const temperature = [];
  for (let h = 0; h < 24; h++) {
    time.push(stamp(DAY, h));
    temperature.push(tempByHour[h] === undefined ? null : tempByHour[h]);
  }
  if (tempByHourDemain) {
    for (let h = 0; h < 24; h++) {
      time.push(stamp(DEMAIN, h));
      temperature.push(tempByHourDemain[h] === undefined ? null : tempByHourDemain[h]);
    }
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
  const vertes = (svg.match(/<rect [^>]*fill="#2D8B4E" fill-opacity="0\.3"\/>/g) || [])
    .filter((r) => new RegExp('height="' + INNER_H + '"').test(r))
    .map((r) => Number(/ x="([-\d.]+)"/.exec(r)[1]));
  assert.equal(vertes.length, 3, '3 créneaux favorables (6, 7, 8)');

  const debut = Math.min.apply(null, vertes);
  const fin = Math.max.apply(null, vertes) + cellW;
  assert.ok(Math.abs(debut - xAt(6)) < 0.02, 'la bande verte commence à l\'abscisse de 6h');
  assert.ok(Math.abs(fin - xAt(9)) < 0.02, 'et se termine à l\'abscisse de 9h (borne exclusive)');
});

test('les bandes couvrent exactement les 15 heures ouvrées, sans trou ni recouvrement', () => {
  const svg = buildSprayChartSvg({ dateISO: DAY, sprayData: sprayPackage(LEVELS) });
  const bandes = (svg.match(new RegExp('<rect [^>]*height="' + INNER_H + '"[^>]*/>', 'g')) || [])
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

test('les trois niveaux AgroSpray gardent les TEINTES de l\'écran', () => {
  const svg = buildSprayChartSvg({ dateISO: DAY, sprayData: sprayPackage(LEVELS) });
  assert.equal(BAND_COLORS[1].fill, '#2D8B4E');
  assert.equal(BAND_COLORS[2].fill, '#F39C12');
  assert.equal(BAND_COLORS[0].fill, '#E74C3C');
  assert.ok(svg.includes('fill="#2D8B4E" fill-opacity="0.3"'));
  assert.ok(svg.includes('fill="#F39C12" fill-opacity="0.24"'));
  assert.ok(svg.includes('fill="#E74C3C" fill-opacity="0.2"'));
});

test('les bandes sont ADOUCIES : opacité nettement sous celle de l\'écran', () => {
  // L'écran utilise 0.8 / 0.6 / 0.4. Au-delà de ce plafond, le fond (surtout le
  // bloc rouge) repasse devant la courbe de température sur le PNG WhatsApp.
  [0, 1, 2].forEach((level) => {
    assert.ok(BAND_COLORS[level].opacity <= 0.3,
      'niveau ' + level + ' : opacité ' + BAND_COLORS[level].opacity + ' trop forte');
  });
  // La pastille de légende, elle, reste franche (10 px à 0.2 = invisible).
  assert.ok(LEGEND_OPACITY >= 0.8);
  const svg = buildSprayChartSvg({ dateISO: DAY, sprayData: sprayPackage(LEVELS) });
  assert.ok(svg.includes('fill="#2D8B4E" fill-opacity="' + LEGEND_OPACITY + '"'), 'pastille de légende');
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

// ─────────────────────────────────────────────────────────────────────────────
// Deux journées côte à côte (aujourd'hui + demain)
// ─────────────────────────────────────────────────────────────────────────────

/** Demain : 6h-12h défavorable puis favorable — profil DIFFÉRENT d'aujourd'hui. */
const LEVELS_DEMAIN = (() => {
  const l = {};
  for (let h = 6; h < 12; h++) l[h] = 0;
  for (let h = 12; h <= 20; h++) l[h] = 1;
  return l;
})();

const TEMPS_DEMAIN = (() => {
  const t = {};
  for (let h = 0; h < 24; h++) t[h] = 18 + 8 * Math.sin(((h - 5) / 24) * Math.PI);
  return t;
})();

/** Géométrie attendue d'un graphique à 2 panneaux. */
const PANEL_W = (WIDTH - MARGIN.l - MARGIN.r - PANEL_GAP) / 2;
const CELL_W = PANEL_W / (AXIS_HOUR_END - WORK_HOUR_START);
const panelX = (i) => MARGIN.l + i * (PANEL_W + PANEL_GAP);
const xAt2 = (i, h) => panelX(i) + (h - WORK_HOUR_START) * CELL_W;

function chart2j(opts) {
  const o = opts || {};
  return buildSprayChartSvg({
    days: [
      { dateISO: DAY, dateLabel: 'Mer 19/08', scoreText: '45% (Partiel)' },
      { dateISO: DEMAIN, dateLabel: 'Jeu 20/08', scoreText: '73% (Favorable)' },
    ],
    weatherData: o.weatherData === undefined ? weatherPackage(TEMPS, TEMPS_DEMAIN) : o.weatherData,
    sprayData: o.sprayData === undefined ? sprayPackage(LEVELS, LEVELS_DEMAIN) : o.sprayData,
  });
}

/** Abscisses de toutes les bandes AgroSpray du SVG, triées. */
function bandXs(svg) {
  return (svg.match(new RegExp('<rect [^>]*height="' + INNER_H + '"[^>]*/>', 'g')) || [])
    .map((r) => Number(/ x="([-\d.]+)"/.exec(r)[1]))
    .sort((a, b) => a - b);
}

test('2 journées : 15 créneaux par panneau, cadrés 6h→21h chacun', () => {
  const xs = bandXs(chart2j());
  assert.equal(xs.length, 30, '15 heures ouvrées × 2 jours');

  const gauche = xs.slice(0, 15);
  const droite = xs.slice(15);
  assert.ok(Math.abs(gauche[0] - xAt2(0, 6)) < 0.02, 'panneau 1 démarre à 6h');
  assert.ok(Math.abs(gauche[14] + CELL_W - xAt2(0, AXIS_HOUR_END)) < 0.02, 'et finit à 21h');
  assert.ok(Math.abs(droite[0] - xAt2(1, 6)) < 0.02, 'panneau 2 démarre à 6h');
  assert.ok(Math.abs(droite[14] + CELL_W - xAt2(1, AXIS_HOUR_END)) < 0.02, 'et finit à 21h');

  [gauche, droite].forEach((serie, i) => {
    for (let k = 1; k < serie.length; k++) {
      assert.ok(Math.abs(serie[k] - serie[k - 1] - CELL_W) < 0.02, 'panneau ' + i + ' : bandes jointives');
    }
  });
});

test('2 journées : les bandes de DEMAIN suivent les niveaux de demain, pas ceux du jour', () => {
  const svg = chart2j();
  const rouges = (svg.match(/<rect [^>]*fill="#E74C3C"[^>]*\/>/g) || [])
    .filter((r) => new RegExp('height="' + INNER_H + '"').test(r))
    .map((r) => Number(/ x="([-\d.]+)"/.exec(r)[1]));
  // Aujourd'hui : 9h→16h défavorable (7 créneaux). Demain : 6h→12h (6 créneaux).
  const rougesDemain = rouges.filter((x) => x >= panelX(1) - 0.02);
  assert.equal(rouges.length - rougesDemain.length, 7, 'aujourd\'hui : 7 créneaux rouges');
  assert.equal(rougesDemain.length, 6, 'demain : 6 créneaux rouges');
  assert.ok(Math.abs(Math.min.apply(null, rougesDemain) - xAt2(1, 6)) < 0.02, 'demain commence rouge à 6h');
  assert.ok(Math.abs(Math.max.apply(null, rougesDemain) + CELL_W - xAt2(1, 12)) < 0.02, 'jusqu\'à 12h');
});

test('2 journées : chaque panneau porte SON nom de jour et SON score, en français', () => {
  const svg = chart2j();
  assert.ok(svg.includes('>Mer 19/08</text>'), 'libellé du jour 1');
  assert.ok(svg.includes('>Jeu 20/08</text>'), 'libellé du jour 2');
  assert.ok(svg.includes('Score : 45% (Partiel)'));
  assert.ok(svg.includes('Score : 73% (Favorable)'));
  assert.ok(svg.includes('Météo &amp; Traitements'), 'titre global');
  // Le libellé du jour est posé dans SON panneau (à gauche de son en-tête).
  const xJour2 = Number(/ x="([-\d.]+)"[^>]*>Jeu 20\/08</.exec(svg)[1]);
  assert.ok(xJour2 >= panelX(1) && xJour2 < panelX(1) + PANEL_W);
});

test('2 journées : une séparation verticale nette entre les deux panneaux', () => {
  const svg = chart2j();
  const sepX = panelX(0) + PANEL_W + PANEL_GAP / 2;
  const verticales = (svg.match(/<line [^>]*stroke-width="2"\/>/g) || [])
    .map((l) => ({
      x1: Number(/ x1="([-\d.]+)"/.exec(l)[1]),
      x2: Number(/ x2="([-\d.]+)"/.exec(l)[1]),
    }))
    .filter((l) => Math.abs(l.x1 - l.x2) < 0.01);
  assert.equal(verticales.length, 1, 'exactement un trait de séparation');
  assert.ok(Math.abs(verticales[0].x1 - sepX) < 0.02, 'centré dans la gouttière');
  // Aucune bande ne déborde dans la gouttière.
  bandXs(svg).forEach((x) => {
    assert.ok(x + CELL_W <= sepX + 0.02 || x >= sepX - 0.02, 'bande à cheval sur la séparation');
  });
});

test('2 journées : une seule échelle de °C, commune aux deux panneaux', () => {
  // Demain plus chaud qu'aujourd'hui : avec deux échelles indépendantes, les
  // deux courbes se ressembleraient alors que les températures diffèrent.
  const svg = chart2j();
  const labels = (svg.match(/>(-?\d+)°<\/text>/g) || []).map((m) => Number(/(-?\d+)/.exec(m)[1]));
  assert.equal(labels.length, 5, '5 graduations au total, pas 10');
  const tHi = labels[0];
  const tLo = labels[labels.length - 1];
  const tousLesTemps = Object.keys(TEMPS).map((k) => TEMPS[k])
    .concat(Object.keys(TEMPS_DEMAIN).map((k) => TEMPS_DEMAIN[k]));
  assert.ok(tHi >= Math.max.apply(null, tousLesTemps.filter((v, i) => i >= 6 && i <= 20)) - 0.5);
  assert.ok(tLo <= Math.min.apply(null, tousLesTemps.filter((v, i) => i >= 6 && i <= 20)) + 0.5);
});

test('2 journées : deux courbes distinctes, une par panneau', () => {
  const svg = chart2j();
  const paths = svg.match(/<path d="([^"]+)"/g) || [];
  assert.equal(paths.length, 2, 'une courbe par jour');
  paths.forEach((p, i) => {
    const d = /d="([^"]+)"/.exec(p)[1];
    assert.equal((d.match(/[ML]/g) || []).length, 15, 'courbe ' + i + ' : 15 points 6h→20h');
    const xs = (d.match(/[ML]([-\d.]+),/g) || []).map((m) => Number(/([-\d.]+)/.exec(m)[1]));
    xs.forEach((x) => {
      assert.ok(x >= panelX(i) - 0.02 && x <= panelX(i) + PANEL_W + 0.02,
        'courbe ' + i + ' confinée à son panneau');
    });
  });
});

test('2 journées : graduations horaires répétées sur chaque panneau', () => {
  const svg = chart2j();
  ['6h', '12h', '20h'].forEach((t) => {
    const n = (svg.match(new RegExp('>' + t + '</text>', 'g')) || []).length;
    assert.equal(n, 2, 'graduation ' + t + ' présente sur les deux panneaux');
  });
});

test('2 journées : demain sans données horaires ne casse pas le panneau d\'aujourd\'hui', () => {
  const svg = buildSprayChartSvg({
    days: [
      { dateISO: DAY, dateLabel: 'Mer 19/08', scoreText: '45% (Partiel)' },
      { dateISO: DEMAIN, dateLabel: 'Jeu 20/08', scoreText: '' },
    ],
    weatherData: weatherPackage(TEMPS), // aucune heure pour DEMAIN
    sprayData: sprayPackage(LEVELS),    // idem
  });
  assert.doesNotMatch(svg, /NaN/);
  assert.equal((svg.match(/<path d="/g) || []).length, 1, 'seule la courbe du jour est tracée');
  const msg = svg.match(/Température horaire indisponible/g) || [];
  assert.equal(msg.length, 1, 'message d\'indisponibilité sur le seul panneau concerné');
  assert.ok(svg.includes('>Jeu 20/08</text>'), 'le panneau de demain reste étiqueté');
  assert.equal(bandXs(svg).length, 15, 'seules les bandes d\'aujourd\'hui existent');
});

test('2 journées : aucun NaN quelle que soit la combinaison de trous', () => {
  const cas = [
    { days: [{ dateISO: DAY }, { dateISO: DEMAIN }] },
    { days: [] },
    { days: [{ dateISO: DAY }, {}] },
    { days: [{}, {}], weatherData: weatherPackage(TEMPS, TEMPS_DEMAIN) },
    { days: [{ dateISO: DAY }, { dateISO: DEMAIN }], sprayData: sprayPackage(LEVELS, LEVELS_DEMAIN) },
  ];
  cas.forEach((input, i) => {
    const svg = buildSprayChartSvg(/** @type {*} */ (input));
    assert.doesNotMatch(svg, /NaN/, 'cas ' + i);
    assert.doesNotMatch(svg, /undefined/, 'cas ' + i);
    attrNumbers(svg).forEach((a) => {
      const v = Number(/="([^"]*)"/.exec(a)[1]);
      assert.ok(Number.isFinite(v), 'cas ' + i + ' : attribut non numérique ' + a);
    });
  });
});

test('plus de 2 journées : tronqué à 2 panneaux (le PNG WhatsApp ne tient pas plus)', () => {
  const svg = buildSprayChartSvg({
    days: [
      { dateISO: DAY, dateLabel: 'J1' },
      { dateISO: DEMAIN, dateLabel: 'J2' },
      { dateISO: '2026-08-21', dateLabel: 'J3' },
    ],
    sprayData: sprayPackage(LEVELS, LEVELS_DEMAIN),
  });
  assert.ok(svg.includes('>J1</text>') && svg.includes('>J2</text>'));
  assert.ok(!svg.includes('>J3</text>'), '3e journée ignorée');
});

test('annotations min/max toujours DANS la zone de tracé, jamais sous l\'axe', () => {
  // Min atteint à 6h en bas d'échelle et max en haut : sans rabattement, les
  // deux libellés sortaient du cadre (le min chevauchait les graduations).
  const svg = buildSprayChartSvg({
    dateISO: DAY,
    weatherData: weatherPackage({ 6: 12, 7: 20, 8: 28, 9: 34 }),
  });
  const labels = (svg.match(/<text [^>]*>(?:min|max) \d+°C<\/text>/g) || []);
  assert.equal(labels.length, 2);
  labels.forEach((l) => {
    const y = Number(/ y="([-\d.]+)"/.exec(l)[1]);
    assert.ok(y >= MARGIN.t, 'libellé au-dessus du cadre : ' + l);
    assert.ok(y <= MARGIN.t + INNER_H, 'libellé sous l\'axe : ' + l);
  });
});
