'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CRON_CONFIG,
  TEMPLATE_NAME,
  buildSprayWindows,
  buildTempSummary,
  formatDigest,
  formatDateParam,
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

test('buildSprayWindows: fenêtre ouvrant sur la PREMIÈRE heure ouvrée (cas limite frontend)', () => {
  // 6h et 7h favorables, 8h défavorable : le frontend lisait workHours[idx-1]
  // sans garde — ici la borne de fin doit rester 8 (7h + 1), sans crash.
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
    },
  };
}

test('buildTempSummary: jour présent', () => {
  const data = weatherPayload([
    { time: '2026-08-13', tMin: 15, tMax: 25, vent: 8, pluie: 1.2, picto: 2 },
    { time: DAY, tMin: 17.4, tMax: 29.1, vent: 12, pluie: 0, picto: 1 },
  ]);
  assert.deepEqual(buildTempSummary(data, DAY), {
    tMin: 17.4, tMax: 29.1, ventMax: 12, pluie: 0, pictocode: 1,
  });
});

test('buildTempSummary: jour absent ou données vides → null', () => {
  const data = weatherPayload([{ time: '2026-08-13', tMin: 15, tMax: 25, vent: 8, pluie: 0, picto: 1 }]);
  assert.equal(buildTempSummary(data, DAY), null);
  assert.equal(buildTempSummary(null, DAY), null);
  assert.equal(buildTempSummary({}, DAY), null);
});

// ── formatDigest ────────────────────────────────────────────────────────

const TEMP = { tMin: 17, tMax: 29, ventMax: 12, pluie: 0, pictocode: 1 };

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
  assert.match(out.body, /Score du jour : \d+% favorable/);
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

test('CRON_CONFIG: 07h00 Africa/Casablanca en europe-west1', () => {
  assert.equal(CRON_CONFIG.schedule, '0 7 * * *');
  assert.equal(CRON_CONFIG.timeZone, 'Africa/Casablanca');
  assert.equal(CRON_CONFIG.region, 'europe-west1');
});
