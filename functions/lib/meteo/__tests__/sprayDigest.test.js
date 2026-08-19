'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CRON_CONFIG,
  TEMPLATE_NAME,
  TRIGGER_SEND_ROLES,
  buildSprayWindows,
  buildTempSummary,
  formatDigest,
  formatDateParam,
  scoreLabel,
  formatWindDirection,
  deltaTZone,
  formatDeltaT,
  niveauRisqueMaladie,
  todayCasablancaISO,
  createMeteoDigestJob,
} = require('../sprayDigest');

const DAY = '2026-08-14';

/**
 * Fabrique un payload spray pour un jour : values indexées par heure (0..23).
 * @param {Object<number, number>} byHour
 * @param {string} [dateISO]
 */
function sprayPayload(byHour, dateISO) {
  const day = dateISO || DAY;
  const time = [];
  const spraywindow = [];
  Object.keys(byHour).map(Number).sort((a, b) => a - b).forEach((h) => {
    time.push(day + ' ' + String(h).padStart(2, '0') + ':00');
    spraywindow.push(byHour[h]);
  });
  return { data_1h: { time, spraywindow } };
}

/** Heures 6..20 toutes à `value`, surchargées par `overrides`. */
function workDay(value, overrides) {
  const byHour = {};
  for (let h = 6; h <= 20; h++) byHour[h] = value;
  Object.assign(byHour, overrides || {});
  return byHour;
}

// ── buildSprayWindows ───────────────────────────────────────────────────

test('buildSprayWindows: une seule fenêtre favorable', () => {
  const w = buildSprayWindows(sprayPayload(workDay(0, { 8: 1, 9: 1, 10: 1 })), DAY);
  assert.deepEqual(w.fenetres, [{ de: 8, a: 11 }]);
  assert.equal(w.bonCount, 3);
  assert.equal(w.totalWork, 15);
});

test('buildSprayWindows: deux fenêtres disjointes', () => {
  const w = buildSprayWindows(sprayPayload(workDay(0, { 7: 1, 8: 1, 17: 1, 18: 1 })), DAY);
  assert.deepEqual(w.fenetres, [{ de: 7, a: 9 }, { de: 17, a: 19 }]);
  assert.equal(w.bonCount, 4);
});

test('buildSprayWindows: aucune fenêtre favorable', () => {
  const w = buildSprayWindows(sprayPayload(workDay(0)), DAY);
  assert.deepEqual(w.fenetres, []);
  assert.equal(w.bonCount, 0);
  assert.equal(w.mauvaisCount, 15);
  assert.equal(w.score, 0);
});

test('buildSprayWindows: fenêtre ouvrant sur la PREMIÈRE heure ouvrée', () => {
  // 6h et 7h favorables, 8h défavorable : la borne de fin est 8 (7h + 1).
  const w = buildSprayWindows(sprayPayload(workDay(0, { 6: 1, 7: 1 })), DAY);
  assert.deepEqual(w.fenetres, [{ de: 6, a: 8 }]);
});

test('buildSprayWindows: une seule heure favorable, la première ouvrée', () => {
  const w = buildSprayWindows(sprayPayload(workDay(0, { 6: 1 })), DAY);
  assert.deepEqual(w.fenetres, [{ de: 6, a: 7 }]);
});

test('buildSprayWindows: fenêtre ouverte jusqu\'à la dernière heure ouvrée', () => {
  const w = buildSprayWindows(sprayPayload(workDay(0, { 19: 1, 20: 1 })), DAY);
  assert.deepEqual(w.fenetres, [{ de: 19, a: 21 }]);
});

test('buildSprayWindows: heures hors 6-20 ignorées', () => {
  const byHour = workDay(0, { 8: 1 });
  byHour[3] = 1;
  byHour[23] = 1;
  const w = buildSprayWindows(sprayPayload(byHour), DAY);
  assert.equal(w.totalWork, 15);
  assert.equal(w.bonCount, 1);
  assert.deepEqual(w.fenetres, [{ de: 8, a: 9 }]);
});

test('buildSprayWindows: score = (bon + moyen/2) / totalWork', () => {
  // 6 bonnes + 6 moyennes + 3 mauvaises sur 15 → (6 + 3) / 15 = 60 %
  const byHour = workDay(0);
  [6, 7, 8, 9, 10, 11].forEach((h) => { byHour[h] = 1; });
  [12, 13, 14, 15, 16, 17].forEach((h) => { byHour[h] = 2; });
  const w = buildSprayWindows(sprayPayload(byHour), DAY);
  assert.equal(w.bonCount, 6);
  assert.equal(w.moyenCount, 6);
  assert.equal(w.mauvaisCount, 3);
  assert.equal(w.score, 60);
  // Invariant central : « modéré » (2) compte pour un demi-point de score mais
  // CASSE la fenêtre — elle s'arrête à 12h, elle ne court pas jusqu'à 18h.
  assert.deepEqual(w.fenetres, [{ de: 6, a: 12 }]);
});

test('buildSprayWindows: une heure modérée coupe la fenêtre en deux', () => {
  const w = buildSprayWindows(sprayPayload(workDay(0, { 8: 1, 9: 1, 10: 2, 11: 1 })), DAY);
  assert.deepEqual(w.fenetres, [{ de: 8, a: 10 }, { de: 11, a: 12 }]);
  assert.equal(w.moyenCount, 1);
});

test('buildSprayWindows: données absentes ou jour introuvable → null', () => {
  assert.equal(buildSprayWindows(null, DAY), null);
  assert.equal(buildSprayWindows({}, DAY), null);
  assert.equal(buildSprayWindows({ data_1h: {} }, DAY), null);
  assert.equal(buildSprayWindows(sprayPayload(workDay(1)), '2026-08-20'), null);
});

// ── buildTempSummary ────────────────────────────────────────────────────

function weatherPayload(days) {
  return {
    data_day: {
      time: days.map((d) => d.time),
      temperature_min: days.map((d) => d.tMin),
      temperature_max: days.map((d) => d.tMax),
      windspeed_max: days.map((d) => d.vent),
      precipitation: days.map((d) => d.pluie),
      pictocode: days.map((d) => d.picto),
      felttemperature_max: days.map((d) => d.ressenti),
      relativehumidity_min: days.map((d) => d.rhMin),
      relativehumidity_max: days.map((d) => d.rhMax),
      winddirection: days.map((d) => d.ventDir),
      delta_t_min: days.map((d) => d.deltaTMin),
      delta_t_max: days.map((d) => d.deltaTMax),
      leafwetnessindex: days.map((d) => d.humectation),
      humiditygreater90_hours: days.map((d) => d.heuresHr90),
      referenceevapotranspiration_fao: days.map((d) => d.etoFao),
      soilmoisture_0to10cm_mean: days.map((d) => d.humiditeSol),
    },
  };
}

/** Champs agronomiques nuls — état attendu quand le package ne les renvoie pas. */
const AGRO_NULL = {
  ressenti: null, rhMin: null, rhMax: null, ventDir: null,
  deltaTMin: null, deltaTMax: null, humectation: null, heuresHr90: null,
  etoFao: null, humiditeSol: null,
};

test('buildTempSummary: jour présent', () => {
  const data = weatherPayload([
    { time: '2026-08-13', tMin: 15, tMax: 25, vent: 8, pluie: 1.2, picto: 2 },
    { time: DAY, tMin: 17.4, tMax: 29.1, vent: 12, pluie: 0, picto: 1 },
  ]);
  assert.deepEqual(buildTempSummary(data, DAY), {
    tMin: 17.4, tMax: 29.1, ventMax: 12, pluie: 0, pictocode: 1, ...AGRO_NULL,
  });
});

test('buildTempSummary: champs agronomiques présents', () => {
  const data = weatherPayload([{
    time: DAY, tMin: 21, tMax: 28, vent: 4.06, pluie: 0, picto: 1,
    ressenti: 29.3, rhMin: 62, rhMax: 94, ventDir: 270,
    deltaTMin: 0.8, deltaTMax: 2.9, humectation: 0, heuresHr90: 0.17,
    etoFao: 3.85, humiditeSol: 10,
  }]);
  assert.deepEqual(buildTempSummary(data, DAY), {
    tMin: 21, tMax: 28, ventMax: 4.06, pluie: 0, pictocode: 1,
    ressenti: 29.3, rhMin: 62, rhMax: 94, ventDir: 270,
    deltaTMin: 0.8, deltaTMax: 2.9, humectation: 0, heuresHr90: 0.17,
    etoFao: 3.85, humiditeSol: 10,
  });
});

test('buildTempSummary: valeurs non numériques → null (jamais NaN/undefined)', () => {
  const data = weatherPayload([{
    time: DAY, tMin: 21, tMax: 28, vent: 4, pluie: 0, picto: 1,
    ressenti: null, rhMin: 'n/a', rhMax: undefined, ventDir: NaN,
    deltaTMin: '2', deltaTMax: {}, humectation: false, heuresHr90: [],
    etoFao: Infinity, humiditeSol: '',
  }]);
  const out = buildTempSummary(data, DAY);
  Object.keys(AGRO_NULL).forEach((k) => assert.equal(out[k], null, k + ' doit être null'));
});

test('buildTempSummary: colonnes agronomiques absentes du payload → null', () => {
  const data = {
    data_day: { time: [DAY], temperature_min: [21], temperature_max: [28] },
  };
  const out = buildTempSummary(data, DAY);
  Object.keys(AGRO_NULL).forEach((k) => assert.equal(out[k], null, k + ' doit être null'));
});

// ── Helpers agronomiques ────────────────────────────────────────────────

test('formatWindDirection: secteurs français et bornes du secteur', () => {
  assert.equal(formatWindDirection(0), 'N');
  assert.equal(formatWindDirection(45), 'NE');
  assert.equal(formatWindDirection(90), 'E');
  assert.equal(formatWindDirection(135), 'SE');
  assert.equal(formatWindDirection(180), 'S');
  assert.equal(formatWindDirection(225), 'SO');
  assert.equal(formatWindDirection(270), 'O');
  assert.equal(formatWindDirection(315), 'NO');
  // Bornes : 350° retombe sur N (repli modulo), 359 aussi.
  assert.equal(formatWindDirection(350), 'N');
  assert.equal(formatWindDirection(359), 'N');
  assert.equal(formatWindDirection(360), 'N');
  assert.equal(formatWindDirection(22), 'N');
  assert.equal(formatWindDirection(23), 'NE');
});

test('formatWindDirection: valeur absente ou non numérique → null', () => {
  assert.equal(formatWindDirection(null), null);
  assert.equal(formatWindDirection(undefined), null);
  assert.equal(formatWindDirection(NaN), null);
  assert.equal(formatWindDirection('270'), null);
});

test('deltaTZone: trois zones et bornes exactes (1,9 / 2 / 8 / 8,1)', () => {
  assert.equal(deltaTZone(0), 'trop humide');
  assert.equal(deltaTZone(1.9), 'trop humide');
  assert.equal(deltaTZone(2), 'idéal');
  assert.equal(deltaTZone(5), 'idéal');
  assert.equal(deltaTZone(8), 'idéal');
  assert.equal(deltaTZone(8.1), 'trop sec');
  assert.equal(deltaTZone(14), 'trop sec');
});

test('formatDeltaT: plage traversant deux zones, plage homogène, valeur seule', () => {
  assert.equal(formatDeltaT(0.8, 2.9), 'Delta T : 0,8 → 2,9 (trop humide → idéal, cible 2-8)');
  assert.equal(formatDeltaT(3, 6.5), 'Delta T : 3 → 6,5 (idéal, cible 2-8)');
  assert.equal(formatDeltaT(9, 12), 'Delta T : 9 → 12 (trop sec, cible 2-8)');
  assert.equal(formatDeltaT(null, 5.4), 'Delta T : 5,4 (idéal, cible 2-8)');
  assert.equal(formatDeltaT(1.2, null), 'Delta T : 1,2 (trop humide, cible 2-8)');
  assert.equal(formatDeltaT(null, null), null);
});

test('niveauRisqueMaladie: barème aux bornes (4 / 8), pire des deux indicateurs', () => {
  assert.equal(niveauRisqueMaladie(0, 0.17), 'Faible');
  assert.equal(niveauRisqueMaladie(3.9, 3.9), 'Faible');
  assert.equal(niveauRisqueMaladie(4, 0), 'Modéré');
  assert.equal(niveauRisqueMaladie(0, 4), 'Modéré');
  assert.equal(niveauRisqueMaladie(7.9, 7.9), 'Modéré');
  assert.equal(niveauRisqueMaladie(8, 0), 'Élevé');
  assert.equal(niveauRisqueMaladie(0, 8), 'Élevé');
  assert.equal(niveauRisqueMaladie(24, 24), 'Élevé');
});

test('niveauRisqueMaladie: un seul indicateur suffit, aucun → null', () => {
  assert.equal(niveauRisqueMaladie(9, null), 'Élevé');
  assert.equal(niveauRisqueMaladie(null, 1), 'Faible');
  assert.equal(niveauRisqueMaladie(null, null), null);
});

test('buildTempSummary: jour absent ou données vides → null', () => {
  const data = weatherPayload([{ time: '2026-08-13', tMin: 15, tMax: 25, vent: 8, pluie: 0, picto: 1 }]);
  assert.equal(buildTempSummary(data, DAY), null);
  assert.equal(buildTempSummary(null, DAY), null);
  assert.equal(buildTempSummary({}, DAY), null);
});

// ── formatDigest ────────────────────────────────────────────────────────

const TEMP = { tMin: 17, tMax: 29, ventMax: 12, pluie: 0, pictocode: 1 };

/** Journée « tout renseigné » — valeurs réelles du 2026-08-19 sur le site F1/F5. */
const TEMP_COMPLET = {
  tMin: 21, tMax: 28, ventMax: 4.06, pluie: 0, pictocode: 1,
  ressenti: 29.3, rhMin: 62, rhMax: 94, ventDir: 270,
  deltaTMin: 0.8, deltaTMax: 2.9, humectation: 0, heuresHr90: 0.17,
  etoFao: 3.85, humiditeSol: 10,
};

test('formatDateParam: jour court FR + JJ/MM', () => {
  assert.equal(formatDateParam(DAY), 'Ven 14/08');
  assert.equal(formatDateParam('2026-08-13'), 'Jeu 13/08');
});

test('formatDigest: liste les créneaux et le score', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(0, { 6: 1, 7: 1, 8: 1, 18: 1, 19: 1 })), DAY);
  const out = formatDigest({ dateISO: DAY, temp: TEMP, windows });
  assert.match(out.body, /17°C → 29°C/);
  assert.match(out.body, /12 km\/h/);
  assert.match(out.body, /• 06h00 - 09h00/);
  assert.match(out.body, /• 18h00 - 20h00/);
  // 5 heures favorables sur 15 → 33 %, sous le seuil 40 de l'écran Météo.
  assert.equal(windows.score, 33);
  assert.match(out.body, /Score du jour : 33% \(Défavorable\)/);
});

test('scoreLabel: mêmes seuils que le badge de l\'écran Météo (70 / 40)', () => {
  assert.equal(scoreLabel(100), 'Favorable');
  assert.equal(scoreLabel(70), 'Favorable');
  assert.equal(scoreLabel(69), 'Partiel');
  assert.equal(scoreLabel(40), 'Partiel');
  assert.equal(scoreLabel(39), 'Défavorable');
  assert.equal(scoreLabel(0), 'Défavorable');
});

test('formatDigest: le score porte son libellé qualitatif', () => {
  const bon = buildSprayWindows(sprayPayload(workDay(1)), DAY);
  assert.match(formatDigest({ dateISO: DAY, temp: TEMP, windows: bon }).body,
    /Score du jour : 100% \(Favorable\)/);

  const nul = buildSprayWindows(sprayPayload(workDay(0)), DAY);
  const outNul = formatDigest({ dateISO: DAY, temp: TEMP, windows: nul });
  assert.match(outNul.body, /Score du jour : 0% \(Défavorable\)/);
  assert.match(outNul.fallbackText, /score 0% \(Défavorable\)/);
});

test('formatDigest: aucun créneau favorable', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(0)), DAY);
  const out = formatDigest({ dateISO: DAY, temp: TEMP, windows });
  assert.match(out.body, /Aucun créneau favorable/);
  assert.doesNotMatch(out.body, /•/);
});

test('formatDigest: spray indisponible → température seule', () => {
  const out = formatDigest({ dateISO: DAY, temp: TEMP, windows: null });
  assert.match(out.body, /Fenêtres de traitement indisponibles/);
  assert.match(out.body, /17°C → 29°C/);
  assert.doesNotMatch(out.body, /Score du jour/);
});

test('formatDigest: température absente → on ne l\'invente pas', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(1)), DAY);
  const out = formatDigest({ dateISO: DAY, temp: null, windows });
  assert.match(out.body, /indisponible/);
  assert.doesNotMatch(out.body, /°C/);
});

test('formatDigest: fallbackText tient sur une seule ligne', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(0, { 8: 1, 9: 1 })), DAY);
  const out = formatDigest({ dateISO: DAY, temp: TEMP, windows });
  assert.equal(out.fallbackText.includes('\n'), false);
  assert.match(out.fallbackText, /Ven 14\/08/);
  assert.match(out.fallbackText, /08h00-10h00/);
  assert.equal(out.dateParam, 'Ven 14/08');
});

test('formatDigest: journée complète → 4 sections agronomiques rendues', () => {
  const windows = buildSprayWindows(
    sprayPayload(workDay(0, { 6: 1, 7: 1, 11: 1, 12: 1, 13: 1, 14: 1, 15: 1, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1 })),
    DAY
  );
  const out = formatDigest({ dateISO: DAY, temp: TEMP_COMPLET, windows });
  assert.match(out.body, /🌡️ \*Température\* : 21°C → 28°C \(ressenti 29°C\)/);
  assert.match(out.body, /💦 Humidité : 62% → 94%/);
  assert.match(out.body, /💨 Vent max : 4 km\/h \(O\)/);
  assert.match(out.body, /🌧️ Pluie : 0 mm/);
  assert.match(out.body, /🎯 Delta T : 0,8 → 2,9 \(trop humide → idéal, cible 2-8\)/);
  assert.match(out.body, /🍄 \*Risque maladie\* : Faible/);
  assert.match(out.body, /\(humectation 0 · HR>90% 0,2 h\)/);
  assert.match(out.body, /💧 \*Irrigation\* : ETo 3,9 mm · humidité sol 10%/);
});

test('formatDigest: aucun undefined / NaN / ligne vide orpheline', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(0, { 8: 1, 9: 1 })), DAY);
  [TEMP, TEMP_COMPLET, null, {}, { tMin: 21, tMax: 28 }].forEach((temp) => {
    [windows, null].forEach((w) => {
      const out = formatDigest({ dateISO: DAY, temp, windows: w });
      assert.doesNotMatch(out.body, /undefined|NaN|null/);
      assert.doesNotMatch(out.fallbackText, /undefined|NaN|null/);
      // Pas de double saut de ligne surnuméraire ni de ligne vide en bord.
      assert.doesNotMatch(out.body, /\n\n\n/);
      assert.equal(out.body.startsWith('\n'), false);
      assert.equal(out.body.endsWith('\n'), false);
    });
  });
});

test('formatDigest: bloc maladie/irrigation absent quand la donnée manque', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(1)), DAY);
  const out = formatDigest({ dateISO: DAY, temp: TEMP, windows });
  assert.doesNotMatch(out.body, /Risque maladie/);
  assert.doesNotMatch(out.body, /Irrigation/);
  assert.doesNotMatch(out.body, /Delta T/);
  assert.doesNotMatch(out.body, /Humidité/);
  assert.doesNotMatch(out.body, /ressenti/);
});

test('formatDigest: un seul indicateur d\'irrigation → pas de séparateur orphelin', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(1)), DAY);
  const etoSeul = { ...TEMP, etoFao: 3.85 };
  assert.match(formatDigest({ dateISO: DAY, temp: etoSeul, windows }).body,
    /💧 \*Irrigation\* : ETo 3,9 mm\n?$/);
  const solSeul = { ...TEMP, humiditeSol: 12.5 };
  assert.match(formatDigest({ dateISO: DAY, temp: solSeul, windows }).body,
    /💧 \*Irrigation\* : humidité sol 12,5%$/);
});

test('formatDigest: un seul indicateur de risque → détail sans séparateur orphelin', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(1)), DAY);
  assert.match(formatDigest({ dateISO: DAY, temp: { ...TEMP, humectation: 12 }, windows }).body,
    /🍄 \*Risque maladie\* : Élevé\n\(humectation 12\)/);
  assert.match(formatDigest({ dateISO: DAY, temp: { ...TEMP, heuresHr90: 5 }, windows }).body,
    /🍄 \*Risque maladie\* : Modéré\n\(HR>90% 5 h\)/);
});

test('formatDigest: humidité partielle → une seule borne affichée', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(1)), DAY);
  assert.match(formatDigest({ dateISO: DAY, temp: { ...TEMP, rhMin: 62 }, windows }).body,
    /💦 Humidité : 62%$/m);
  assert.match(formatDigest({ dateISO: DAY, temp: { ...TEMP, rhMax: 94 }, windows }).body,
    /💦 Humidité : 94%$/m);
});

test('formatDigest: vent sans direction → pas de parenthèse vide', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(1)), DAY);
  const out = formatDigest({ dateISO: DAY, temp: { ...TEMP, ventDir: null }, windows });
  assert.match(out.body, /💨 Vent max : 12 km\/h$/m);
});

test('formatDigest: corps < 900 caractères sur le pire cas (limite Meta 1024)', () => {
  // Pire cas réaliste : toutes les données présentes, valeurs les plus larges
  // possibles, et le maximum de fenêtres (une heure sur deux favorable → 8
  // plages listées sur la journée ouvrée).
  const pire = {
    tMin: -12.7, tMax: 48.6, ventMax: 128.4, pluie: 188.8, pictocode: 1,
    ressenti: -18.4, rhMin: 100, rhMax: 100, ventDir: 225,
    deltaTMin: 18.8, deltaTMax: 28.8, humectation: 24, heuresHr90: 23.8,
    etoFao: 18.8, humiditeSol: 100,
  };
  const byHour = workDay(0);
  for (let h = 6; h <= 20; h += 2) byHour[h] = 1;
  const windows = buildSprayWindows(sprayPayload(byHour), DAY);
  assert.equal(windows.fenetres.length, 8);
  const out = formatDigest({ dateISO: DAY, temp: pire, windows });
  assert.ok(out.body.length < 900,
    'corps de ' + out.body.length + ' caractères, marge Meta dépassée:\n' + out.body);
  assert.ok(out.dateParam.length < 1024);
});

test('formatDigest: fallbackText reste single-line même avec tout le contenu', () => {
  const windows = buildSprayWindows(sprayPayload(workDay(0, { 8: 1, 9: 1 })), DAY);
  const out = formatDigest({ dateISO: DAY, temp: TEMP_COMPLET, windows });
  assert.equal(out.fallbackText.includes('\n'), false);
  // L'essentiel décisionnel y reste : température, créneaux, score.
  assert.match(out.fallbackText, /Température 21°C à 28°C/);
  assert.match(out.fallbackText, /08h00-10h00/);
  assert.match(out.fallbackText, /score /);
  // Les indicateurs agronomiques n'y sont volontairement PAS (lisibilité).
  assert.doesNotMatch(out.fallbackText, /Delta T|humectation|ETo/);
});

// ── createMeteoDigestJob.run ────────────────────────────────────────────

function makeWhatsappStub(recipientsByProfile, sendImpl) {
  const sends = [];
  return {
    sends,
    toSingleLine: (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim(),
    async resolveRecipientsForProfile(profileId) {
      return recipientsByProfile[profileId] || [];
    },
    async sendTemplateMessage(to, templateName, bodyParams, lang, toName) {
      sends.push({ to, templateName, bodyParams, lang, toName });
      if (sendImpl) return sendImpl({ to, templateName, bodyParams });
      return { success: true, waMessageId: 'wamid.' + sends.length };
    },
  };
}

function makeGetMeteoblue(weather, spray) {
  return async (coords, pkg) => (pkg === 'spray' ? spray : weather);
}

const WEATHER = weatherPayload([{ time: DAY, tMin: 17, tMax: 29, vent: 12, pluie: 0, picto: 1 }]);
const SPRAY = sprayPayload(workDay(0, { 8: 1, 9: 1 }));

test('run: envoie aux destinataires dédoublonnés par téléphone', async () => {
  const whatsapp = makeWhatsappStub({
    dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }],
    chef_f1: [{ uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' }],
    // Même numéro que le DG → ne doit pas recevoir 2 fois.
    chef_f5: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }],
  });
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY);

  assert.equal(res.recipientsCount, 2);
  assert.equal(res.sent, 2);
  assert.equal(whatsapp.sends.length, 2);
  assert.equal(whatsapp.sends[0].templateName, TEMPLATE_NAME);
  assert.equal(whatsapp.sends[0].bodyParams.length, 2);
  assert.equal(whatsapp.sends[0].bodyParams[0], 'Ven 14/08');
  assert.equal(res.fallbackUsed, 0);
  assert.deepEqual(res.byProfile.map((p) => p.recipientsCount), [1, 1, 0]);
});

test('run: repli sur general_alert quand Meta répond 132018', async () => {
  const whatsapp = makeWhatsappStub(
    { dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }] },
    ({ templateName }) => (templateName === TEMPLATE_NAME
      ? { success: false, error: '(#132018) Template param format mismatch' }
      : { success: true, waMessageId: 'wamid.fallback' })
  );
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY);

  assert.equal(res.fallbackUsed, 1);
  assert.equal(res.sent, 1);
  assert.equal(whatsapp.sends.length, 2);
  assert.equal(whatsapp.sends[1].templateName, 'general_alert');
  assert.equal(whatsapp.sends[1].bodyParams.length, 1);
  assert.equal(whatsapp.sends[1].bodyParams[0].includes('\n'), false);
});

test('run: repli aussi sur 131008 (paramètre multi-ligne rejeté par Meta)', async () => {
  const whatsapp = makeWhatsappStub(
    { dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }] },
    ({ templateName }) => (templateName === TEMPLATE_NAME
      ? { success: false, error: '(#131008) Required parameter is missing or invalid' }
      : { success: true, waMessageId: 'wamid.fallback' })
  );
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY);

  assert.equal(res.fallbackUsed, 1);
  assert.equal(res.sent, 1);
  assert.equal(whatsapp.sends[1].templateName, 'general_alert');
  assert.equal(whatsapp.sends[1].bodyParams[0].includes('\n'), false);
});

test('run: pas de repli sur une erreur non liée au template', async () => {
  const whatsapp = makeWhatsappStub(
    { dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }] },
    () => ({ success: false, error: '(#131026) Message undeliverable' })
  );
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY);

  assert.equal(res.fallbackUsed, 0);
  assert.equal(res.sent, 0);
  assert.equal(whatsapp.sends.length, 1);
});

test('run: aucun destinataire → sent 0 et aucun envoi', async () => {
  const whatsapp = makeWhatsappStub({});
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY);

  assert.equal(res.sent, 0);
  assert.equal(res.recipientsCount, 0);
  assert.equal(whatsapp.sends.length, 0);
});

test('run: mode preview n\'envoie rien', async () => {
  const whatsapp = makeWhatsappStub({ dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }] });
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY, { preview: true });

  assert.equal(res.preview, true);
  assert.equal(res.dateParam, 'Ven 14/08');
  assert.match(res.body, /Fenêtres de traitement/);
  assert.equal(whatsapp.sends.length, 0);
});

test('run: mode checkRecipients liste sans envoyer', async () => {
  const whatsapp = makeWhatsappStub({ dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }] });
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY, { checkRecipients: true });

  assert.equal(res.recipientsCount, 1);
  assert.equal(whatsapp.sends.length, 0);
});

test('run: une source météo en échec → cas dégradé, pas de throw', async () => {
  const whatsapp = makeWhatsappStub({ dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }] });
  const job = createMeteoDigestJob({
    getMeteoblue: async (coords, pkg) => {
      if (pkg === 'spray') throw new Error('Meteoblue down');
      return WEATHER;
    },
    whatsapp,
  });
  const res = await job.run(DAY);

  assert.equal(res.sent, 1);
  assert.match(whatsapp.sends[0].bodyParams[1], /Fenêtres de traitement indisponibles/);
});

// ── Config cron ─────────────────────────────────────────────────────────

test('CRON_CONFIG: 06h00 Africa/Casablanca en europe-west1', () => {
  assert.equal(CRON_CONFIG.schedule, '0 6 * * *');
  assert.equal(CRON_CONFIG.timeZone, 'Africa/Casablanca');
  assert.equal(CRON_CONFIG.region, 'europe-west1');
});

test('TRIGGER_SEND_ROLES: envoi manuel réservé à dg/dt/admin', () => {
  assert.deepEqual([...TRIGGER_SEND_ROLES], ['dg', 'dt', 'admin']);
  assert.equal(TRIGGER_SEND_ROLES.includes('magasinier'), false);
  assert.equal(TRIGGER_SEND_ROLES.includes('chef_f1'), false);
});

// ── Fuseau Africa/Casablanca ────────────────────────────────────────────

test('todayCasablancaISO: UTC+1 hors Ramadan (23h30 UTC = lendemain local)', () => {
  assert.equal(todayCasablancaISO(new Date('2026-08-14T23:30:00Z')), '2026-08-15');
  assert.equal(todayCasablancaISO(new Date('2026-08-14T06:00:00Z')), '2026-08-14');
});

test('todayCasablancaISO: UTC+0 pendant le Ramadan (pas de +1h fictif)', () => {
  // Le Maroc repasse à UTC+0 pendant le Ramadan : un offset codé en dur
  // renverrait 2026-03-02 pour cet instant.
  assert.equal(todayCasablancaISO(new Date('2026-03-01T23:30:00Z')), '2026-03-01');
});

test('todayCasablancaISO: heure du cron (06h00 local) → jour courant', () => {
  assert.equal(todayCasablancaISO(new Date('2026-08-14T05:00:00Z')), '2026-08-14'); // 06h local
  assert.equal(todayCasablancaISO(new Date('2026-03-01T06:00:00Z')), '2026-03-01'); // 06h local
});
