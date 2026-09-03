'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CRON_CONFIG,
  TEMPLATE_NAME,
  IMAGE_TEMPLATE_NAME,
  CHART_FILENAME,
  TRIGGER_SEND_ROLES,
  isRealSend,
  AUDIENCE_PROFILE_IDS,
  parseOnlyProfile,
  audienceFor,
  buildSprayWindows,
  buildTempSummary,
  formatDigest,
  formatDateParam,
  nextDayISO,
  scoreLabel,
  formatWindDirection,
  deltaTZone,
  formatDeltaT,
  DELTA_T_LABEL,
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
  assert.equal(formatDeltaT(0.8, 2.9), 'Delta T pulvé : 0,8 → 2,9 (trop humide → idéal, cible 2-8)');
  assert.equal(formatDeltaT(3, 6.5), 'Delta T pulvé : 3 → 6,5 (idéal, cible 2-8)');
  assert.equal(formatDeltaT(9, 12), 'Delta T pulvé : 9 → 12 (trop sec, cible 2-8)');
  assert.equal(formatDeltaT(null, 5.4), 'Delta T pulvé : 5,4 (idéal, cible 2-8)');
  assert.equal(formatDeltaT(1.2, null), 'Delta T pulvé : 1,2 (trop humide, cible 2-8)');
  assert.equal(formatDeltaT(null, null), null);
});

// `functions/index.js` expose un `delta_t` = amplitude thermique (tmax − tmin),
// affiché « ΔT (°C) » sur l'écran Maturité. Le digest parle d'un TOUT AUTRE
// indicateur (psychrométrique, pulvérisation) : le libellé doit lever le doute.
test('formatDeltaT: libellé désambiguïsé vs le ΔT amplitude thermique de Maturité', () => {
  const ligne = formatDeltaT(3, 6.5);
  assert.equal(DELTA_T_LABEL, 'Delta T pulvé');
  assert.ok(ligne.startsWith(DELTA_T_LABEL + ' : '));
  assert.doesNotMatch(ligne, /ΔT/, 'le sigle ΔT est réservé à l\'amplitude thermique');
  assert.doesNotMatch(ligne, /Delta T :/, 'plus de « Delta T » nu, confondable avec l\'amplitude');
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
  assert.match(out.body, /🎯 Delta T pulvé : 0,8 → 2,9 \(trop humide → idéal, cible 2-8\)/);
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

// ── Graphique : chaîne de repli à trois étages ──────────────────────────
//
// L'image est un BONUS ; le corps texte est l'information. Ces tests vérifient
// qu'aucune panne du graphique (rendu, upload, refus Meta du template image)
// ne peut faire disparaître le corps — et que chaque dégradation est bruyante.

const { PNG_MIME } = require('../renderPng');

const FAKE_PNG = Buffer.from('\x89PNG-faux-mais-non-vide');

/**
 * Stub whatsapp AVEC support image. `impl` décide de l'issue de chaque envoi :
 * ({templateName}) => {success, error}.
 */
function makeWhatsappImageStub(recipientsByProfile, impl, uploadImpl) {
  const base = makeWhatsappStub(recipientsByProfile, impl);
  const uploads = [];
  base.uploads = uploads;
  base.uploadMedia = async (buffer, mimeType, filename) => {
    uploads.push({ buffer, mimeType, filename });
    if (uploadImpl) return uploadImpl({ buffer, mimeType, filename });
    return { id: 'MEDIA-1' };
  };
  base.sendTemplateMessageWithImage = async (to, templateName, mediaIdOrRef, bodyParams, lang, toName) => {
    base.sends.push({ to, templateName, bodyParams, lang, toName, mediaIdOrRef });
    if (impl) return impl({ to, templateName, bodyParams });
    return { success: true, waMessageId: 'wamid.img' + base.sends.length };
  };
  return base;
}

/** Capture console.error le temps d'un appel. */
async function captureErrors(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

const RECIPIENTS_2 = {
  dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }],
  chef_f1: [{ uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' }],
};

test('IMAGE_TEMPLATE_NAME : nom verrouillé, corps identique au template texte', () => {
  assert.equal(IMAGE_TEMPLATE_NAME, 'meteo_spray_digest_img');
  assert.equal(TEMPLATE_NAME, 'meteo_spray_digest');
  assert.equal(CHART_FILENAME, 'meteo-traitements.png');
});

test('run: chemin nominal — UN seul upload, template image pour tous', async () => {
  const rendus = [];
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: (svg) => { rendus.push(svg); return FAKE_PNG; },
  });
  const res = await job.run(DAY);

  assert.equal(res.sent, 2);
  assert.equal(res.chartAvailable, true);
  assert.equal(res.imageSent, 2);
  assert.equal(res.degradedToText, 0);
  assert.equal(res.fallbackUsed, 0);

  assert.equal(rendus.length, 1, 'le SVG est construit une seule fois');
  assert.equal(whatsapp.uploads.length, 1, 'UN upload pour N destinataires');
  assert.equal(whatsapp.uploads[0].mimeType, PNG_MIME);
  assert.equal(whatsapp.uploads[0].filename, CHART_FILENAME);
  assert.ok(whatsapp.uploads[0].buffer.length > 0);

  assert.equal(whatsapp.sends.length, 2);
  whatsapp.sends.forEach((s) => {
    assert.equal(s.templateName, IMAGE_TEMPLATE_NAME);
    assert.equal(s.mediaIdOrRef, 'MEDIA-1', 'le même media_id chez tous');
    assert.equal(s.bodyParams.length, 2);
    assert.equal(s.bodyParams[0], 'Ven 14/08');
    assert.match(s.bodyParams[1], /Fenêtres de traitement/);
  });
});

test('run: le SVG rendu porte bien la date, le score et les bandes du jour', async () => {
  let svg = null;
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp: makeWhatsappImageStub(RECIPIENTS_2),
    renderChartPng: (s) => { svg = s; return FAKE_PNG; },
  });
  await job.run(DAY);

  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('Ven 14/08'), 'même libellé de date que le corps texte');
  assert.ok(/Score : \d+% \(/.test(svg), 'score repris du même calcul que le texte');
  assert.ok(svg.includes('#2D8B4E'), 'les créneaux favorables 8h/9h apparaissent en vert');
  assert.doesNotMatch(svg, /NaN|undefined/);
});

test('nextDayISO : lendemain correct, y compris fin de mois et année bissextile', () => {
  assert.equal(nextDayISO('2026-08-14'), '2026-08-15');
  assert.equal(nextDayISO('2026-08-31'), '2026-09-01');
  assert.equal(nextDayISO('2026-12-31'), '2027-01-01');
  assert.equal(nextDayISO('2024-02-28'), '2024-02-29', 'année bissextile');
  assert.equal(nextDayISO('2026-02-28'), '2026-03-01');
  assert.equal(nextDayISO('pas une date'), '');
  assert.equal(nextDayISO(undefined), '');
});

test('run: le graphique couvre AUJOURD\'HUI ET DEMAIN, avec le score de chacun', async () => {
  // Demain volontairement plus favorable qu'aujourd'hui : les deux scores
  // doivent apparaître, calculés séparément.
  const demain = nextDayISO(DAY);
  const weather2j = weatherPayload([
    { time: DAY, tMin: 17, tMax: 29, vent: 12, pluie: 0, picto: 1 },
    { time: demain, tMin: 19, tMax: 33, vent: 8, pluie: 0, picto: 1 },
  ]);
  const spray2j = {
    data_1h: {
      time: SPRAY.data_1h.time.concat(
        sprayPayload(workDay(1), demain).data_1h.time
      ),
      spraywindow: SPRAY.data_1h.spraywindow.concat(
        sprayPayload(workDay(1), demain).data_1h.spraywindow
      ),
    },
  };

  let svg = null;
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(weather2j, spray2j),
    whatsapp,
    renderChartPng: (s) => { svg = s; return FAKE_PNG; },
  });
  const res = await job.run(DAY);

  assert.equal(res.imageSent, 2);
  assert.ok(svg.includes('>Ven 14/08</text>'), 'panneau du jour');
  assert.ok(svg.includes('>Sam 15/08</text>'), 'panneau de demain');
  // Aujourd'hui : 2 créneaux favorables sur 15 → 13%. Demain : 15/15 → 100%.
  assert.ok(svg.includes('Score : 13% (Défavorable)'), 'score du jour');
  assert.ok(svg.includes('Score : 100% (Favorable)'), 'score de demain');
  assert.doesNotMatch(svg, /NaN|undefined/);
  // Le CORPS TEXTE, lui, ne parle toujours que du jour même : le graphique
  // anticipe, le message non (aucun changement de contrat côté texte).
  whatsapp.sends.forEach((snd) => {
    assert.equal(snd.bodyParams[0], 'Ven 14/08');
    assert.ok(!/15\/08/.test(snd.bodyParams[1]), 'le corps ne parle pas de demain');
  });
});

test('run: sans données pour demain, le graphique part quand même avec le seul panneau du jour', async () => {
  let svg = null;
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), // aucune heure pour J+1
    whatsapp: makeWhatsappImageStub(RECIPIENTS_2),
    renderChartPng: (s) => { svg = s; return FAKE_PNG; },
  });
  const res = await job.run(DAY);

  assert.equal(res.chartAvailable, true, 'un demain vide ne doit pas annuler l\'image');
  assert.equal(res.imageSent, 2);
  assert.ok(svg.includes('>Sam 15/08</text>'), 'le panneau de demain reste étiqueté');
  assert.ok(svg.includes('Température horaire indisponible'));
  assert.doesNotMatch(svg, /NaN|undefined/);
});

test('run: rendu PNG en échec → digest TEXTE complet, dégradation journalisée', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: () => { throw new Error('resvg indisponible'); },
  });
  const { result: res, lines } = await captureErrors(() => job.run(DAY));

  assert.equal(res.sent, 2, 'le corps texte part quand même');
  assert.equal(res.chartAvailable, false);
  assert.equal(res.imageSent, 0);
  assert.equal(whatsapp.uploads.length, 0, 'aucun upload si le rendu a échoué');
  whatsapp.sends.forEach((s) => {
    assert.equal(s.templateName, TEMPLATE_NAME);
    assert.match(s.bodyParams[1], /Fenêtres de traitement/, 'corps intact');
  });
  assert.ok(lines.some((l) => /GRAPHIQUE INDISPONIBLE/.test(l) && /resvg indisponible/.test(l)),
    'la dégradation doit être bruyante, pas silencieuse');
});

test('run: upload Meta en échec → digest TEXTE, dégradation journalisée', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2, null,
    () => ({ error: 'Unsupported file type' }));
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: () => FAKE_PNG,
  });
  const { result: res, lines } = await captureErrors(() => job.run(DAY));

  assert.equal(res.sent, 2);
  assert.equal(res.chartAvailable, false);
  assert.equal(whatsapp.uploads.length, 1, 'un seul upload tenté, pas un par destinataire');
  whatsapp.sends.forEach((s) => assert.equal(s.templateName, TEMPLATE_NAME));
  assert.ok(lines.some((l) => /GRAPHIQUE INDISPONIBLE/.test(l) && /Unsupported file type/.test(l)));
});

test('run: rendu PNG vide → traité comme un échec, pas comme un succès', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: () => Buffer.alloc(0),
  });
  const { result: res, lines } = await captureErrors(() => job.run(DAY));
  assert.equal(res.chartAvailable, false);
  assert.equal(res.sent, 2);
  assert.ok(lines.some((l) => /rendu PNG vide/.test(l)));
});

test('run: template image refusé par Meta → repli étage 2 sur le template texte', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2,
    ({ templateName }) => (templateName === IMAGE_TEMPLATE_NAME
      ? { success: false, error: '(#132001) Template name does not exist' }
      : { success: true, waMessageId: 'wamid.texte' }));
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: () => FAKE_PNG,
  });
  const { result: res, lines } = await captureErrors(() => job.run(DAY));

  assert.equal(res.sent, 2, 'personne ne perd le digest');
  assert.equal(res.chartAvailable, true, 'l\'image était bien prête');
  assert.equal(res.imageSent, 0);
  assert.equal(res.degradedToText, 2);
  assert.equal(res.fallbackUsed, 0, 'general_alert n\'a pas eu à servir');
  assert.equal(whatsapp.sends.length, 4, '2 tentatives image + 2 envois texte');
  assert.deepEqual(
    whatsapp.sends.map((s) => s.templateName).sort(),
    [IMAGE_TEMPLATE_NAME, IMAGE_TEMPLATE_NAME, TEMPLATE_NAME, TEMPLATE_NAME].sort()
  );
  assert.equal(lines.filter((l) => /AVEC IMAGE refusé/.test(l)).length, 2);
});

test('run: image ET texte refusés → étage 3 general_alert, corps essentiel sauvé', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2,
    ({ templateName }) => (templateName === 'general_alert'
      ? { success: true, waMessageId: 'wamid.alert' }
      : { success: false, error: '(#132018) Template param format mismatch' }));
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: () => FAKE_PNG,
  });
  const { result: res, lines } = await captureErrors(() => job.run(DAY));

  assert.equal(res.sent, 2);
  assert.equal(res.fallbackUsed, 2);
  assert.equal(res.imageSent, 0);
  const alertes = whatsapp.sends.filter((s) => s.templateName === 'general_alert');
  assert.equal(alertes.length, 2);
  alertes.forEach((s) => {
    assert.equal(s.bodyParams.length, 1);
    assert.equal(s.bodyParams[0].includes('\n'), false);
    assert.match(s.bodyParams[0], /Météo & Traitements/);
  });
  assert.ok(lines.some((l) => /AVEC IMAGE refusé/.test(l)));
  assert.ok(lines.some((l) => /template texte refusé/.test(l)));
});

test('run: échec image non lié au template (réseau) → repli texte aussi', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2,
    ({ templateName }) => {
      if (templateName === IMAGE_TEMPLATE_NAME) throw new Error('socket hang up');
      return { success: true, waMessageId: 'wamid.texte' };
    });
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: () => FAKE_PNG,
  });
  const { result: res, lines } = await captureErrors(() => job.run(DAY));

  assert.equal(res.sent, 2, 'une panne réseau sur l\'image ne coûte pas le digest');
  assert.equal(res.degradedToText, 2);
  assert.ok(lines.some((l) => /socket hang up/.test(l)));
});

test('run: whatsappService sans support image → comportement texte inchangé', async () => {
  // Rétrocompatibilité : le stub historique n'a ni uploadMedia ni
  // sendTemplateMessageWithImage.
  const whatsapp = makeWhatsappStub(RECIPIENTS_2);
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: () => FAKE_PNG,
  });
  const { result: res, lines } = await captureErrors(() => job.run(DAY));

  assert.equal(res.sent, 2);
  assert.equal(res.chartAvailable, false);
  whatsapp.sends.forEach((s) => assert.equal(s.templateName, TEMPLATE_NAME));
  assert.ok(lines.some((l) => /sans support image/.test(l)));
});

test('run: preview et checkRecipients ne rendent ni n\'uploadent rien', async () => {
  let rendus = 0;
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: () => { rendus++; return FAKE_PNG; },
  });
  await job.run(DAY, { preview: true });
  await job.run(DAY, { checkRecipients: true });
  assert.equal(rendus, 0, 'aucun rendu inutile');
  assert.equal(whatsapp.uploads.length, 0);
  assert.equal(whatsapp.sends.length, 0);
});

test('run: aucun destinataire → ni rendu ni upload', async () => {
  let rendus = 0;
  const whatsapp = makeWhatsappImageStub({});
  const job = createMeteoDigestJob({
    getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY),
    whatsapp,
    renderChartPng: () => { rendus++; return FAKE_PNG; },
  });
  const { result: res } = await captureErrors(() => job.run(DAY));
  assert.equal(res.sent, 0);
  assert.equal(rendus, 0);
  assert.equal(whatsapp.uploads.length, 0);
});

// ── Déclaration du template Meta ────────────────────────────────────────
//
// `create-whatsapp-templates.js` est un CLI (il `process.exit` sans WA_TOKEN) :
// on l'inspecte comme du texte. C'est volontairement grossier, mais ça
// verrouille le seul invariant qui compte : le job envoie les MÊMES bodyParams
// aux deux templates et retombe de l'image sur le texte — leurs corps doivent
// donc être rigoureusement identiques.

test('template Meta : meteo_spray_digest_img déclaré en IMAGE, corps identique au texte', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'create-whatsapp-templates.js'), 'utf8');

  const bodyOf = (name) => {
    const idx = src.indexOf('name: "' + name + '"');
    assert.notEqual(idx, -1, 'template ' + name + ' déclaré');
    const m = /body: "((?:[^"\\]|\\.)*)"/.exec(src.slice(idx, idx + 2000));
    assert.ok(m, 'body trouvé pour ' + name);
    return m[1];
  };

  assert.equal(bodyOf(IMAGE_TEMPLATE_NAME), bodyOf(TEMPLATE_NAME),
    'corps strictement identiques, sinon le repli image → texte change le message');

  const bloc = src.slice(src.indexOf('name: "' + IMAGE_TEMPLATE_NAME + '"'));
  assert.match(bloc.slice(0, 400), /headerType: "IMAGE"/);

  // Règles Meta (cf. en-tête du fichier) : ni variable en début ni en fin de
  // corps, et assez de texte statique pour 2 variables.
  const body = bodyOf(IMAGE_TEMPLATE_NAME);
  assert.ok(!body.trimStart().startsWith('{{'), 'pas de variable en début de corps');
  assert.ok(!body.trimEnd().endsWith('}}'), 'pas de variable en fin de corps');
  assert.deepEqual(body.match(/\{\{\d\}\}/g), ['{{1}}', '{{2}}'], '2 variables, dans l\'ordre');
  assert.ok(body.replace(/\{\{\d\}\}/g, '').length > 150, 'assez de texte statique');
});

// ─────────────────────────────────────────────────────────────────────────────
// ?only=<profileId> — envoi restreint à un seul profil (test sans spammer)
// ─────────────────────────────────────────────────────────────────────────────

test('parseOnlyProfile : liste blanche stricte, dérivée d\'AUDIENCE', () => {
  assert.deepEqual(AUDIENCE_PROFILE_IDS.slice(), ['dg', 'chef_f1', 'chef_f5']);
  assert.deepEqual(parseOnlyProfile('dg'), { ok: true, only: 'dg' });
  assert.deepEqual(parseOnlyProfile('chef_f1'), { ok: true, only: 'chef_f1' });
  assert.deepEqual(parseOnlyProfile('chef_f5'), { ok: true, only: 'chef_f5' });
  assert.deepEqual(parseOnlyProfile(' dg '), { ok: true, only: 'dg' }, 'espaces tolérés');
});

test('parseOnlyProfile : absence = audience complète, jamais une erreur', () => {
  [undefined, null, '', '   '].forEach((v) => {
    assert.deepEqual(parseOnlyProfile(/** @type {*} */ (v)), { ok: true, only: null },
      'valeur ' + JSON.stringify(v));
  });
});

test('parseOnlyProfile : tout profil hors audience est REFUSÉ', () => {
  // Aucun profil arbitraire venu de la query ne doit atteindre
  // resolveRecipientsForProfile.
  ['inconnu', 'admin', 'rh', 'DG', 'chef_f2', 'dg,chef_f1', '*'].forEach((v) => {
    const r = parseOnlyProfile(v);
    assert.equal(r.ok, false, 'valeur ' + v + ' devrait être refusée');
    assert.match(r.error, /only invalide/);
  });
  // ?only=a&only=b → Express rend un tableau : refusé net.
  const multi = parseOnlyProfile(/** @type {*} */ (['dg', 'chef_f1']));
  assert.equal(multi.ok, false);
  assert.match(multi.error, /une seule valeur/);
});

test('audienceFor : restreint sans jamais inventer de destinataire', () => {
  assert.equal(audienceFor(null).length, 3, 'sans only : audience complète');
  assert.deepEqual(audienceFor('dg'), [{ profileId: 'dg', ferme: null }]);
  assert.deepEqual(audienceFor('chef_f5'), [{ profileId: 'chef_f5', ferme: 'F5' }]);
  // Défensif : un only inconnu donne ZÉRO destinataire, jamais l'audience
  // complète — le pire cas est un message qui ne part pas.
  assert.deepEqual(audienceFor('inconnu'), []);
});

test('?only= reste soumis à la gate de rôle : ce n\'est PAS un mode preview', () => {
  // La gate ne connaît que preview/checkRecipients/alertes : un envoi restreint
  // est un envoi RÉEL et doit donc mordre sur TRIGGER_SEND_ROLES.
  assert.equal(isRealSend({ preview: false, checkRecipients: false, alertesOnly: false }), true);
  assert.equal(isRealSend({ preview: false, checkRecipients: false, alertesOnly: true }), true);
  assert.deepEqual(TRIGGER_SEND_ROLES.slice(), ['dg', 'dt', 'admin'],
    'un envoi restreint reste réservé à DG/DT/admin');
});

test('run: only=dg → UN seul profil résolu, les chefs ne sont même pas interrogés', async () => {
  const whatsapp = makeWhatsappStub({
    dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }],
    chef_f1: [{ uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' }],
    chef_f5: [{ uid: 'u3', displayName: 'Chef F5', phone: '+212600000003' }],
  });
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY, { only: 'dg' });

  assert.equal(res.recipientsCount, 1);
  assert.equal(res.sent, 1);
  assert.equal(res.restrictedTo, 'dg', 'la restriction est tracée dans le retour');
  assert.equal(whatsapp.sends.length, 1);
  assert.equal(whatsapp.sends[0].to, '+212600000001');
  assert.deepEqual(res.byProfile.map((p) => p.profileId), ['dg'],
    'aucune ligne pour les chefs : ils n\'ont pas été résolus');
});

test('run: only absent → comportement strictement inchangé (3 profils, restrictedTo null)', async () => {
  const whatsapp = makeWhatsappStub({
    dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }],
    chef_f1: [{ uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' }],
    chef_f5: [{ uid: 'u3', displayName: 'Chef F5', phone: '+212600000003' }],
  });
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY);

  assert.equal(res.recipientsCount, 3);
  assert.equal(res.sent, 3);
  assert.equal(res.restrictedTo, null);
  assert.deepEqual(res.byProfile.map((p) => p.profileId), ['dg', 'chef_f1', 'chef_f5']);
});

test('run: only=chef_f5 → seul le chef F5 reçoit, le DG n\'est pas servi', async () => {
  const whatsapp = makeWhatsappStub({
    dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }],
    chef_f5: [{ uid: 'u3', displayName: 'Chef F5', phone: '+212600000003' }],
  });
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY, { only: 'chef_f5' });

  assert.equal(whatsapp.sends.length, 1);
  assert.equal(whatsapp.sends[0].to, '+212600000003');
  assert.equal(res.restrictedTo, 'chef_f5');
});

test('run: checkRecipients + only → diagnostic restreint, toujours aucun envoi', async () => {
  const whatsapp = makeWhatsappStub({
    dg: [{ uid: 'u1', displayName: 'DG', phone: '+212600000001' }],
    chef_f1: [{ uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' }],
  });
  const job = createMeteoDigestJob({ getMeteoblue: makeGetMeteoblue(WEATHER, SPRAY), whatsapp });
  const res = await job.run(DAY, { checkRecipients: true, only: 'dg' });

  assert.equal(res.checkRecipients, true);
  assert.equal(res.recipientsCount, 1);
  assert.equal(res.restrictedTo, 'dg');
  assert.equal(whatsapp.sends.length, 0);
});

test('trigger HTTP : ?only= validé en liste blanche (400), APRÈS la gate de rôle (403)', () => {
  // Le handler vit dans le monolithe functions/index.js : on verrouille son
  // câblage au niveau de la source. Une future édition qui supprimerait la
  // validation, ou qui la placerait avant la gate de rôle, casse ce test.
  const fs = require('fs');
  const path = require('path');
  const src = require('../../../../tests/helpers/backendSource').backendSource();

  const bloc = src.slice(src.indexOf('exports.meteoSprayDigestTrigger'));
  const handler = bloc.slice(0, bloc.indexOf('exports.', 10));

  const iGate = handler.indexOf('TRIGGER_SEND_ROLES');
  const i403 = handler.indexOf('status(403)');
  const iParse = handler.indexOf('sprayDigest.parseOnlyProfile(req.query.only)');
  const i400 = handler.indexOf('status(400)');

  assert.notEqual(iGate, -1, 'la gate de rôle est toujours là');
  assert.notEqual(iParse, -1, '?only= passe par parseOnlyProfile (liste blanche)');
  assert.notEqual(i400, -1, 'une valeur hors liste blanche → 400');
  assert.ok(i403 < iParse, 'gate de rôle AVANT la validation : 403 prime sur 400');
  assert.ok(iParse < i400, 'le 400 découle bien du parsing de ?only=');

  // `only` est transmis aux DEUX jobs, jamais bricolé sur place.
  assert.match(handler, /alertesJob\.run\(date, \{ preview, checkRecipients, only \}\)/);
  assert.match(handler, /job\.run\(date, \{ preview, checkRecipients, only \}\)/);

  // Aucun chemin d'envoi parallèle : un seul appel à chaque job dans le handler.
  assert.equal((handler.match(/alertesJob\.run\(/g) || []).length, 2,
    'alertes : un envoi + l\'aperçu joint au preview, rien de plus');
});
