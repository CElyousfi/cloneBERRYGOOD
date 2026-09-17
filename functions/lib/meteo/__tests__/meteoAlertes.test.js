'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TEMPLATE_NAME,
  IMAGE_TEMPLATE_NAME,
  METEOGRAM_FILENAME,
  COLLECTION,
  SEUILS,
  MARGES_AGGRAVATION,
  detecterAlertes,
  formatAlertes,
  filtrerAlertesANotifier,
  estPerimee,
  createMeteoAlertesJob,
} = require('../meteoAlertes');
const { isRealSend } = require('../sprayDigest');

const DAY = '2026-08-21'; // vendredi

/**
 * Capture les appels console.error le temps d'un test.
 * @param {() => Promise<*>} fn
 * @returns {Promise<{result: *, errors: Array<string>}>}
 */
async function captureErrors(fn) {
  const original = console.error;
  const errors = [];
  console.error = function() {
    errors.push(Array.prototype.map.call(arguments, String).join(' '));
  };
  try {
    const result = await fn();
    return { result: result, errors: errors };
  } finally {
    console.error = original;
  }
}

/**
 * Construit un payload `weather` depuis une liste de jours.
 * @param {Array<{time: string, tMax?: number, vent?: number, pluie?: number}>} days
 */
function weatherPayload(days) {
  return {
    data_day: {
      time: days.map((d) => d.time),
      temperature_max: days.map((d) => (d.tMax === undefined ? 20 : d.tMax)),
      windspeed_max: days.map((d) => (d.vent === undefined ? 5 : d.vent)),
      precipitation: days.map((d) => (d.pluie === undefined ? 0 : d.pluie)),
    },
  };
}

/** DAY + n jours, au format ISO. */
function plus(n) {
  const d = new Date(Date.UTC(2026, 7, 21 + n));
  return d.toISOString().slice(0, 10);
}

// ── seuils (bornes exactes) ─────────────────────────────────────────────

test('seuils et marges figés : chaleur 35 °C / marge 1 °C (alignés avec l\'écran)', () => {
  // Décision Omar du 2026-08-18 : 32 → 35 °C, marge 2 → 1 °C, des DEUX côtés
  // (public/app.jsx `p.tMax >= 35`). Ce test échoue si un seul côté bouge.
  assert.equal(SEUILS.chaleur, 35);
  assert.equal(MARGES_AGGRAVATION.chaleur, 1);
  assert.equal(SEUILS.vent, 25);
  assert.equal(SEUILS.pluie, 10);
  assert.equal(MARGES_AGGRAVATION.vent, 5);
  assert.equal(MARGES_AGGRAVATION.pluie, 5);
});

test('detecterAlertes: chaleur — 34.4 sous le seuil, 35 déclenche', () => {
  // La comparaison porte sur la valeur arrondie (cf. écran) : la borne basse
  // réelle est donc 34.5, pas 35.
  assert.equal(detecterAlertes(weatherPayload([{ time: DAY, tMax: 34.4 }]), { fromISO: DAY }).length, 0);
  const a = detecterAlertes(weatherPayload([{ time: DAY, tMax: 35 }]), { fromISO: DAY });
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'chaleur');
  assert.equal(a[0].label, 'Forte Chaleur');
  assert.equal(a[0].seuil, SEUILS.chaleur);
  assert.equal(a[0].cle, 'chaleur_' + DAY);
});

test('detecterAlertes: vent — 24.4 sous le seuil, 25 déclenche', () => {
  assert.equal(detecterAlertes(weatherPayload([{ time: DAY, vent: 24.4 }]), { fromISO: DAY }).length, 0);
  const a = detecterAlertes(weatherPayload([{ time: DAY, vent: 25 }]), { fromISO: DAY });
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'vent');
  assert.equal(a[0].seuil, SEUILS.vent);
});

test('detecterAlertes: pluie — 9.9 sous le seuil, 10 déclenche', () => {
  assert.equal(detecterAlertes(weatherPayload([{ time: DAY, pluie: 9.9 }]), { fromISO: DAY }).length, 0);
  const a = detecterAlertes(weatherPayload([{ time: DAY, pluie: 10 }]), { fromISO: DAY });
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'pluie');
  assert.equal(a[0].valeur, 10);
});

test('detecterAlertes: borne du seuil 35 — 34.4 non, 34.6 oui (valeur ARRONDIE)', () => {
  // public/app.jsx affiche Math.round(tMax) : 34.6 → 35 → alerte à l'écran.
  const a = detecterAlertes(weatherPayload([{ time: DAY, tMax: 34.6 }]), { fromISO: DAY });
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'chaleur');
  assert.equal(a[0].valeur, 34.6, 'la valeur brute (arrondie au dixième) reste mémorisée');
  assert.equal(detecterAlertes(weatherPayload([{ time: DAY, tMax: 34.4 }]), { fromISO: DAY }).length, 0);
});

test('detecterAlertes: vent 24.6 km/h alerte (arrondi à 25), 24.4 non', () => {
  const a = detecterAlertes(weatherPayload([{ time: DAY, vent: 24.6 }]), { fromISO: DAY });
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'vent');
  assert.equal(a[0].valeur, 24.6);
  assert.equal(detecterAlertes(weatherPayload([{ time: DAY, vent: 24.4 }]), { fromISO: DAY }).length, 0);
});

test('detecterAlertes: accepte le séparateur ISO « T » dans data_day.time', () => {
  const a = detecterAlertes(
    weatherPayload([{ time: DAY + 'T00:00', tMax: 36 }]), { fromISO: DAY }
  );
  assert.equal(a.length, 1);
  assert.equal(a[0].dateISO, DAY);
  assert.equal(a[0].cle, 'chaleur_' + DAY);
});

test('detecterAlertes: plusieurs types le même jour, ordre chaleur > vent > pluie', () => {
  const a = detecterAlertes(
    weatherPayload([{ time: DAY, tMax: 35, vent: 40, pluie: 22 }]), { fromISO: DAY }
  );
  assert.deepEqual(a.map((x) => x.type), ['chaleur', 'vent', 'pluie']);
});

test('detecterAlertes: tri par date croissante', () => {
  const a = detecterAlertes(weatherPayload([
    { time: plus(3), vent: 30 },
    { time: plus(1), tMax: 36 },
    { time: plus(2), pluie: 12 },
  ]), { fromISO: DAY });
  assert.deepEqual(a.map((x) => x.dateISO), [plus(1), plus(2), plus(3)]);
});

test('detecterAlertes: fenêtre — J+7 inclus, J+8 exclu, passé exclu', () => {
  const a = detecterAlertes(weatherPayload([
    { time: plus(-1), tMax: 40 },
    { time: plus(0), tMax: 36 },
    { time: plus(7), tMax: 36 },
    { time: plus(8), tMax: 41 },
  ]), { fromISO: DAY });
  assert.deepEqual(a.map((x) => x.dateISO), [plus(0), plus(7)]);
});

test('detecterAlertes: données absentes ou incomplètes → []', () => {
  assert.deepEqual(detecterAlertes(null, { fromISO: DAY }), []);
  assert.deepEqual(detecterAlertes({}, { fromISO: DAY }), []);
  assert.deepEqual(detecterAlertes({ data_day: {} }, { fromISO: DAY }), []);
  assert.deepEqual(
    detecterAlertes({ data_day: { time: [DAY], temperature_max: [null] } }, { fromISO: DAY }), []
  );
});

// ── formatAlertes ───────────────────────────────────────────────────────

test('formatAlertes: titres en majuscules et jours FR corrects', () => {
  const alertes = detecterAlertes(weatherPayload([
    { time: plus(0), tMax: 36 },
    { time: plus(3), vent: 31 },
  ]), { fromISO: DAY });
  const out = formatAlertes(alertes);

  assert.equal(out.titreParam, '21 → 24/08');
  assert.match(out.body, /^VENDREDI 21 AOÛT — FORTE CHALEUR$/m);
  assert.match(out.body, /^LUNDI 24 AOÛT — VENT FORT$/m);
  assert.match(out.body, /36°C prévus \(seuil 35°C\)/);
  assert.match(out.body, /31 km\/h prévus \(seuil 25 km\/h\)/);
  assert.match(out.body, /phyto/);
});

test('formatAlertes: affiche la valeur RÉELLE, virgule FR, sans décimale nulle', () => {
  const out = formatAlertes([
    { type: 'chaleur', label: 'Forte Chaleur', dateISO: DAY, valeur: 35.4, seuil: 35, cle: 'chaleur_' + DAY },
    { type: 'chaleur', label: 'Forte Chaleur', dateISO: plus(1), valeur: 36.0, seuil: 35, cle: 'chaleur_' + plus(1) },
    { type: 'vent', label: 'Vent Fort', dateISO: plus(2), valeur: 25.5, seuil: 25, cle: 'vent_' + plus(2) },
    { type: 'pluie', label: 'Forte Pluie', dateISO: plus(3), valeur: 12.0, seuil: 10, cle: 'pluie_' + plus(3) },
  ]);

  // 35,4 °C ne doit PAS s'afficher « 35°C prévus (seuil 35°C) » : l'arrondi
  // sert à comparer au seuil, pas à afficher. (Incident prod du 2026-08-18 :
  // « 32°C prévus (seuil 32°C) » pour une prévision à 32,4 °C.)
  assert.match(out.body, /🌡️ 35,4°C prévus \(seuil 35°C\)/);
  assert.match(out.body, /🌡️ 36°C prévus \(seuil 35°C\)/);
  assert.equal(out.body.includes('36,0°C'), false);
  assert.match(out.body, /💨 25,5 km\/h prévus \(seuil 25 km\/h\)/);
  assert.match(out.body, /🌧️ 12 mm prévus \(seuil 10 mm\)/);
  assert.equal(out.body.includes('12,0 mm'), false);
  // Le seuil reste entier, jamais reformaté avec une décimale.
  assert.equal(/seuil \d+,\d/.test(out.body), false);
});

test('formatAlertes: fallbackText reprend la valeur réelle et reste mono-ligne', () => {
  const out = formatAlertes([
    { type: 'chaleur', label: 'Forte Chaleur', dateISO: DAY, valeur: 35.4, seuil: 35, cle: 'chaleur_' + DAY },
    { type: 'pluie', label: 'Forte Pluie', dateISO: plus(1), valeur: 12.5, seuil: 10, cle: 'pluie_' + plus(1) },
  ]);
  assert.equal(out.fallbackText.includes('\n'), false);
  assert.match(out.fallbackText, /35,4°C \(seuil 35°C\)/);
  assert.match(out.fallbackText, /12,5 mm \(seuil 10 mm\)/);
});

test('formatAlertes: période sur deux mois et jour unique', () => {
  const unJour = detecterAlertes(weatherPayload([{ time: DAY, tMax: 36 }]), { fromISO: DAY });
  assert.equal(formatAlertes(unJour).titreParam, '21/08');

  const across = formatAlertes([
    { type: 'chaleur', label: 'Forte Chaleur', dateISO: '2026-08-29', valeur: 36, seuil: 35, cle: 'chaleur_2026-08-29' },
    { type: 'vent', label: 'Vent Fort', dateISO: '2026-09-02', valeur: 30, seuil: 25, cle: 'vent_2026-09-02' },
  ]);
  assert.equal(across.titreParam, '29/08 → 02/09');
});

test('formatAlertes: fallbackText tient sur une seule ligne', () => {
  const alertes = detecterAlertes(weatherPayload([
    { time: plus(0), tMax: 36, pluie: 18 },
    { time: plus(2), vent: 31 },
  ]), { fromISO: DAY });
  const out = formatAlertes(alertes);
  assert.equal(out.fallbackText.includes('\n'), false);
  assert.match(out.fallbackText, /Alerte météo 21 → 23\/08/);
  assert.match(out.fallbackText, /FORTE CHALEUR/);
});

test('formatAlertes: aucune alerte → message vide', () => {
  assert.deepEqual(formatAlertes([]), { titreParam: '', body: '', fallbackText: '' });
});

// ── filtrerAlertesANotifier ─────────────────────────────────────────────

const A_CHALEUR = {
  type: 'chaleur', label: 'Forte Chaleur', dateISO: DAY, valeur: 36, seuil: 35, cle: 'chaleur_' + DAY,
};

test('filtrerAlertesANotifier: clé inconnue → renvoyée', () => {
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], new Map()), [A_CHALEUR]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], null), [A_CHALEUR]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], {}), [A_CHALEUR]);
});

test('filtrerAlertesANotifier: clé connue, valeur identique → non renvoyée', () => {
  const etat = new Map([[A_CHALEUR.cle, { valeur: 36 }]]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], etat), []);
});

test('filtrerAlertesANotifier: aggravation < marge → non renvoyée', () => {
  const etat = new Map([[A_CHALEUR.cle, { valeur: 36 - (MARGES_AGGRAVATION.chaleur - 0.1) }]]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], etat), []);
});

test('filtrerAlertesANotifier: aggravation == marge → renvoyée', () => {
  const etat = new Map([[A_CHALEUR.cle, { valeur: 36 - MARGES_AGGRAVATION.chaleur }]]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], etat), [A_CHALEUR]);
});

test('filtrerAlertesANotifier: amélioration → non renvoyée', () => {
  const etat = new Map([[A_CHALEUR.cle, { valeur: 40 }]]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], etat), []);
});

test('filtrerAlertesANotifier: marges par type (vent 5, pluie 5)', () => {
  const vent = { type: 'vent', label: 'Vent Fort', dateISO: DAY, valeur: 30, seuil: 25, cle: 'vent_' + DAY };
  assert.deepEqual(filtrerAlertesANotifier([vent], { ['vent_' + DAY]: { valeur: 26 } }), []);
  assert.deepEqual(filtrerAlertesANotifier([vent], { ['vent_' + DAY]: { valeur: 25 } }), [vent]);

  const pluie = { type: 'pluie', label: 'Forte Pluie', dateISO: DAY, valeur: 20, seuil: 10, cle: 'pluie_' + DAY };
  assert.deepEqual(filtrerAlertesANotifier([pluie], { ['pluie_' + DAY]: { valeur: 16 } }), []);
  assert.deepEqual(filtrerAlertesANotifier([pluie], { ['pluie_' + DAY]: { valeur: 15 } }), [pluie]);
});

test('filtrerAlertesANotifier: valeur mémorisée illisible → renvoyée', () => {
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], { [A_CHALEUR.cle]: {} }), [A_CHALEUR]);
});

test('estPerimee: hier oui, aujourd\'hui non, demain non', () => {
  assert.equal(estPerimee(plus(-1), DAY), true);
  assert.equal(estPerimee(DAY, DAY), false);
  assert.equal(estPerimee(plus(1), DAY), false);
  assert.equal(estPerimee('', DAY), false);
});

// ── createMeteoAlertesJob.run ───────────────────────────────────────────

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

/**
 * Firestore stubbé en mémoire, limité aux appels utilisés par le job.
 * @param {Object<string, object>} seed
 * @param {{failGet?: boolean, failSetFor?: Array<string>}} [faults]
 */
function makeDbStub(seed, faults) {
  const store = new Map(Object.entries(seed || {}));
  const f = faults || {};
  const failSetFor = new Set(f.failSetFor || []);
  const writes = [];
  const deletes = [];
  const collections = [];
  return {
    store, writes, deletes, collections,
    collection(name) {
      collections.push(name);
      return {
        async get() {
          if (f.failGet) throw new Error('firestore unavailable');
          return {
            docs: Array.from(store.entries()).map(([id, data]) => ({ id, data: () => data })),
          };
        },
        doc(id) {
          return {
            async set(data) {
              if (failSetFor.has(id)) throw new Error('write failed for ' + id);
              writes.push({ id, data });
              store.set(id, data);
            },
            async delete() { deletes.push(id); store.delete(id); },
          };
        },
      };
    },
  };
}

/** Horloge serveur figée au 21/08/2026 (= DAY), pour piloter la purge. */
const nowAtDay = () => new Date('2026-08-21T09:00:00Z');

const WEATHER = weatherPayload([
  { time: plus(0), tMax: 36 },
  { time: plus(2), vent: 31 },
]);
const getWeather = async () => WEATHER;
const DG = { uid: 'u1', displayName: 'DG', phone: '+212600000001' };

test('run: envoie aux destinataires dédoublonnés par téléphone et mémorise l\'état', async () => {
  const whatsapp = makeWhatsappStub({
    dg: [DG],
    chef_f1: [{ uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' }],
    chef_f5: [DG], // même numéro que le DG → un seul envoi
  });
  const db = makeDbStub({});
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db }).run(DAY);

  assert.equal(res.recipientsCount, 2);
  assert.equal(res.sent, 2);
  assert.equal(whatsapp.sends.length, 2);
  assert.equal(whatsapp.sends[0].templateName, TEMPLATE_NAME);
  assert.equal(whatsapp.sends[0].bodyParams.length, 2);
  assert.equal(whatsapp.sends[0].bodyParams[0], '21 → 23/08');
  assert.equal(db.collections[0], COLLECTION);
  assert.deepEqual(db.writes.map((w) => w.id).sort(), ['chaleur_' + plus(0), 'vent_' + plus(2)]);
  assert.equal(db.writes[0].data.type, 'chaleur');
  assert.equal(typeof db.writes[0].data.envoye_at, 'string');
  assert.equal(res.persisted, 2);
});

test('run: la valeur MÉMORISÉE reste la valeur brute (pas la valeur formatée)', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({});
  const weather = weatherPayload([{ time: plus(0), tMax: 35.4, vent: 25.5 }]);
  const res = await createMeteoAlertesJob({
    getMeteoblue: async () => weather, whatsapp, db,
  }).run(DAY);

  assert.equal(res.sent, 1);
  const parCle = new Map(db.writes.map((w) => [w.id, w.data]));
  // L'anti-répétition raisonne sur ces nombres : ni chaîne, ni arrondi entier.
  assert.equal(parCle.get('chaleur_' + plus(0)).valeur, 35.4);
  assert.equal(typeof parCle.get('chaleur_' + plus(0)).valeur, 'number');
  assert.equal(parCle.get('vent_' + plus(0)).valeur, 25.5);
  assert.equal(typeof parCle.get('vent_' + plus(0)).valeur, 'number');
  // …tandis que le message, lui, affiche bien la valeur réelle en français.
  assert.match(whatsapp.sends[0].bodyParams[1], /35,4°C prévus \(seuil 35°C\)/);
  assert.match(whatsapp.sends[0].bodyParams[1], /25,5 km\/h prévus \(seuil 25 km\/h\)/);
});

test('run: alerte déjà envoyée → aucun envoi, aucune écriture', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({
    ['chaleur_' + plus(0)]: { type: 'chaleur', dateISO: plus(0), valeur: 36, envoye_at: 'x' },
    ['vent_' + plus(2)]: { type: 'vent', dateISO: plus(2), valeur: 31, envoye_at: 'x' },
  });
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db }).run(DAY);

  assert.deepEqual(res.alertes, []);
  assert.equal(res.sent, 0);
  assert.equal(res.skipped, 2);
  assert.equal(whatsapp.sends.length, 0);
  assert.equal(db.writes.length, 0);
});

test('run: aggravation ≥ marge → alerte renvoyée', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({
    ['chaleur_' + plus(0)]: { type: 'chaleur', dateISO: plus(0), valeur: 35, envoye_at: 'x' },
    ['vent_' + plus(2)]: { type: 'vent', dateISO: plus(2), valeur: 30, envoye_at: 'x' },
  });
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db }).run(DAY);

  assert.deepEqual(res.alertes.map((a) => a.cle), ['chaleur_' + plus(0)]);
  assert.equal(res.skipped, 1);
  assert.equal(whatsapp.sends.length, 1);
  assert.deepEqual(db.writes.map((w) => w.id), ['chaleur_' + plus(0)]);
});

test('run: AUCUNE écriture d\'état si l\'envoi échoue', async () => {
  const whatsapp = makeWhatsappStub(
    { dg: [DG] },
    () => ({ success: false, error: '(#131026) Message undeliverable' })
  );
  const db = makeDbStub({});
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db }).run(DAY);

  assert.equal(res.sent, 0);
  assert.equal(res.alertes.length, 2);
  assert.equal(db.writes.length, 0, 'un échec d\'envoi ne doit jamais faire taire l\'alerte');
});

test('run: aucun destinataire → aucun envoi ni écriture', async () => {
  const whatsapp = makeWhatsappStub({});
  const db = makeDbStub({});
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db }).run(DAY);

  assert.equal(res.recipientsCount, 0);
  assert.equal(res.sent, 0);
  assert.equal(whatsapp.sends.length, 0);
  assert.equal(db.writes.length, 0);
});

test('run: repli sur general_alert quand Meta répond 132018', async () => {
  const whatsapp = makeWhatsappStub(
    { dg: [DG] },
    ({ templateName }) => (templateName === TEMPLATE_NAME
      ? { success: false, error: '(#132018) Template param format mismatch' }
      : { success: true, waMessageId: 'wamid.fallback' })
  );
  const db = makeDbStub({});
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db }).run(DAY);

  assert.equal(res.fallbackUsed, 1);
  assert.equal(res.sent, 1);
  assert.equal(whatsapp.sends[1].templateName, 'general_alert');
  assert.equal(whatsapp.sends[1].bodyParams.length, 1);
  assert.equal(whatsapp.sends[1].bodyParams[0].includes('\n'), false);
  assert.equal(db.writes.length, 2, 'un envoi servi via repli compte comme envoyé');
});

test('run: purge les entrées dont le jour est passé', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({
    ['chaleur_' + plus(-3)]: { type: 'chaleur', dateISO: plus(-3), valeur: 36, envoye_at: 'x' },
    ['vent_' + plus(2)]: { type: 'vent', dateISO: plus(2), valeur: 31, envoye_at: 'x' },
  });
  const res = await createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db, now: nowAtDay,
  }).run(DAY);

  assert.equal(res.purged, 1);
  assert.deepEqual(db.deletes, ['chaleur_' + plus(-3)]);
  assert.equal(db.store.has('vent_' + plus(2)), true);
});

test('run: la purge suit la date SERVEUR, jamais le paramètre date', async () => {
  // ?date=2099-01-01 rendrait toute la collection « périmée » si la purge se
  // basait sur le paramètre → réarmement massif des alertes déjà envoyées.
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({
    ['chaleur_' + plus(2)]: { type: 'chaleur', dateISO: plus(2), valeur: 36, envoye_at: 'x' },
    ['vent_' + plus(5)]: { type: 'vent', dateISO: plus(5), valeur: 31, envoye_at: 'x' },
  });
  const res = await createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db, now: nowAtDay,
  }).run('2099-01-01');

  assert.equal(res.purged, 0);
  assert.deepEqual(db.deletes, []);
  assert.equal(db.store.size, 2);
});

test('run: aucune alerte détectée → rien envoyé', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({});
  const calme = weatherPayload([{ time: plus(0), tMax: 25, vent: 10, pluie: 0 }]);
  const res = await createMeteoAlertesJob({ getMeteoblue: async () => calme, whatsapp, db }).run(DAY);

  assert.deepEqual(res.alertes, []);
  assert.equal(res.sent, 0);
  assert.equal(res.skipped, 0);
  assert.equal(whatsapp.sends.length, 0);
  assert.equal(db.writes.length, 0);
});

test('run: preview n\'envoie ni n\'écrit rien', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({});
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db })
    .run(DAY, { preview: true });

  assert.equal(res.preview, true);
  assert.equal(res.alertes.length, 2);
  assert.match(res.body, /FORTE CHALEUR/);
  assert.equal(whatsapp.sends.length, 0);
  assert.equal(db.writes.length, 0);
  assert.equal(db.deletes.length, 0);
  assert.equal(db.collections.length, 0);
});

test('run: météo indisponible → aucune alerte, aucun envoi', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({});
  const boom = async () => { throw new Error('meteoblue down'); };
  const res = await createMeteoAlertesJob({ getMeteoblue: boom, whatsapp, db }).run(DAY);

  assert.deepEqual(res.alertes, []);
  assert.equal(whatsapp.sends.length, 0);
  assert.equal(db.writes.length, 0);
});

test('createMeteoAlertesJob: dépendances manquantes → TypeError', () => {
  assert.throws(() => createMeteoAlertesJob({}), TypeError);
  assert.throws(() => createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp: {} }), TypeError);
});

test('createMeteoAlertesJob: dep whatsapp incomplète → TypeError au démarrage', () => {
  const db = makeDbStub({});
  const complet = makeWhatsappStub({});
  ['sendTemplateMessage', 'resolveRecipientsForProfile', 'toSingleLine'].forEach((fn) => {
    const partiel = Object.assign({}, complet);
    delete partiel[fn];
    assert.throws(
      () => createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp: partiel, db }),
      (err) => err instanceof TypeError && err.message.includes(fn),
      'dep manquante non détectée : ' + fn
    );
  });
  // Câblage complet → construction OK.
  assert.equal(
    typeof createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp: complet, db }).run,
    'function'
  );
});

// ── mode checkRecipients (diagnostic sec, non gaté côté rôle) ───────────

test('run: checkRecipients n\'envoie rien, n\'écrit rien, ne purge rien', async () => {
  const whatsapp = makeWhatsappStub({
    dg: [DG],
    chef_f1: [{ uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' }],
  });
  const db = makeDbStub({
    ['chaleur_' + plus(-3)]: { type: 'chaleur', dateISO: plus(-3), valeur: 36, envoye_at: 'x' },
  });
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db, now: nowAtDay })
    .run(DAY, { checkRecipients: true });

  assert.equal(res.checkRecipients, true);
  assert.equal(res.recipientsCount, 2);
  assert.deepEqual(res.recipients.map((r) => r.phone), ['+212600000001', '+212600000002']);
  assert.equal(res.alertes.length, 2);
  assert.equal(whatsapp.sends.length, 0, 'aucun envoi WhatsApp');
  assert.equal(db.writes.length, 0, 'aucune écriture d\'état');
  assert.equal(db.deletes.length, 0, 'aucune purge');
  assert.equal(db.collections.length, 0, 'aucun accès Firestore');
});

test('gate HTTP: ?alertes=1&checkRecipients=1 reste soumis à la gate de rôle', () => {
  // Le trou corrigé : la gate supposait que checkRecipients n'envoyait rien.
  assert.equal(isRealSend({ alertesOnly: true, checkRecipients: true }), true);
  assert.equal(isRealSend({ alertesOnly: true }), true);
  assert.equal(isRealSend({}), true);
  // preview ne renvoie jamais rien, checkRecipients seul est un diagnostic sec.
  assert.equal(isRealSend({ preview: true }), false);
  assert.equal(isRealSend({ preview: true, alertesOnly: true, checkRecipients: true }), false);
  assert.equal(isRealSend({ checkRecipients: true }), false);
});

// ── robustesse I/O ──────────────────────────────────────────────────────

test('run: envoi PARTIEL → état écrit quand même + erreur journalisée', async () => {
  const whatsapp = makeWhatsappStub(
    {
      dg: [DG],
      chef_f1: [{ uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' }],
    },
    ({ to }) => (to === '+212600000002'
      ? { success: false, error: '(#131026) Message undeliverable' }
      : { success: true, waMessageId: 'wamid.1' })
  );
  const db = makeDbStub({});
  const { result: res, errors } = await captureErrors(() =>
    createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db, now: nowAtDay }).run(DAY));

  assert.equal(res.recipientsCount, 2);
  assert.equal(res.sent, 1);
  // Arbitrage assumé : on n'attend pas 100 % de succès pour mémoriser, sinon
  // l'alerte repartirait à tout le monde chaque matin.
  assert.equal(res.persisted, 2);
  assert.deepEqual(db.writes.map((w) => w.id).sort(), ['chaleur_' + plus(0), 'vent_' + plus(2)]);
  assert.ok(
    errors.some((e) => e.includes('ENVOI INCOMPLET')),
    'un envoi partiel doit être journalisé en erreur, pas silencieux'
  );
});

test('run: lecture d\'état en échec → repart d\'un état vide et notifie', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub(
    { ['chaleur_' + plus(0)]: { type: 'chaleur', dateISO: plus(0), valeur: 36, envoye_at: 'x' } },
    { failGet: true }
  );
  const { result: res, errors } = await captureErrors(() =>
    createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db, now: nowAtDay }).run(DAY));

  assert.equal(res.alertes.length, 2, 'état illisible → mieux vaut un doublon qu\'un silence');
  assert.equal(res.skipped, 0);
  assert.equal(res.purged, 0);
  assert.equal(whatsapp.sends.length, 1);
  assert.ok(errors.some((e) => e.includes('lecture état échouée')));
});

test('run: écriture d\'état partiellement en échec → persisted < alertes + erreur', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({}, { failSetFor: ['vent_' + plus(2)] });
  const { result: res, errors } = await captureErrors(() =>
    createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db, now: nowAtDay }).run(DAY));

  assert.equal(res.sent, 1);
  assert.equal(res.alertes.length, 2);
  assert.equal(res.persisted, 1);
  assert.deepEqual(db.writes.map((w) => w.id), ['chaleur_' + plus(0)]);
  assert.ok(errors.some((e) => e.includes('état partiellement écrit')));
});

// ─────────────────────────────────────────────────────────────────────────────
// Meteogram 7 jours en header IMAGE — l'image ne doit JAMAIS coûter une alerte
// ─────────────────────────────────────────────────────────────────────────────

const { PNG_MIME } = require('../meteogram');
const FAKE_PNG = Buffer.from('\x89PNG-meteogram-de-test');

/** Stub whatsapp AVEC support image (uploadMedia + sendTemplateMessageWithImage). */
function makeWhatsappImageStub(recipientsByProfile, opts) {
  const o = opts || {};
  const base = makeWhatsappStub(recipientsByProfile, o.sendImpl);
  const uploads = [];
  const imageSends = [];
  return Object.assign(base, {
    uploads,
    imageSends,
    async uploadMedia(buffer, mimeType, filename) {
      uploads.push({ buffer, mimeType, filename });
      if (o.uploadImpl) return o.uploadImpl();
      return { id: 'MEDIA-1' };
    },
    async sendTemplateMessageWithImage(to, templateName, mediaIdOrRef, bodyParams, lang, toName) {
      imageSends.push({ to, templateName, mediaIdOrRef, bodyParams, lang, toName });
      if (o.imageSendImpl) return o.imageSendImpl({ to, bodyParams });
      return { success: true, waMessageId: 'wamid.img.' + imageSends.length };
    },
  });
}

const RECIPIENTS_2 = {
  dg: [DG],
  chef_f1: [{ uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' }],
};

test('IMAGE_TEMPLATE_NAME : nom verrouillé, distinct du template texte', () => {
  assert.equal(IMAGE_TEMPLATE_NAME, 'meteo_alerte_7j_img');
  assert.notEqual(IMAGE_TEMPLATE_NAME, TEMPLATE_NAME);
  assert.equal(METEOGRAM_FILENAME, 'meteo-7-jours.png');
});

test('run: étage 1 — UN seul fetch + UN seul upload pour N destinataires', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  let fetches = 0;
  const res = await createMeteoAlertesJob({
    getMeteoblue: getWeather,
    whatsapp,
    db: makeDbStub({}),
    fetchMeteogram: async () => { fetches++; return FAKE_PNG; },
  }).run(DAY);

  assert.equal(fetches, 1, 'le meteogram n\'est récupéré qu\'une fois');
  assert.equal(whatsapp.uploads.length, 1, 'UN upload pour N destinataires');
  assert.equal(whatsapp.uploads[0].mimeType, PNG_MIME);
  assert.equal(whatsapp.uploads[0].filename, METEOGRAM_FILENAME);
  assert.ok(whatsapp.uploads[0].buffer.equals(FAKE_PNG), 'image transmise telle quelle');

  assert.equal(res.sent, 2);
  assert.equal(res.imageSent, 2);
  assert.equal(res.meteogramAvailable, true);
  assert.equal(res.fallbackUsed, 0);
  assert.equal(whatsapp.sends.length, 0, 'aucun envoi texte quand l\'image passe');
  assert.equal(whatsapp.imageSends.length, 2);
  whatsapp.imageSends.forEach((s) => {
    assert.equal(s.templateName, IMAGE_TEMPLATE_NAME);
    assert.equal(s.mediaIdOrRef, 'MEDIA-1', 'le même media_id chez tous');
    assert.equal(s.bodyParams.length, 2, 'mêmes 2 params que le template texte');
  });
  // L'état anti-répétition est mémorisé comme sur le chemin texte.
  assert.equal(res.persisted, res.alertes.length);
});

test('run: le corps envoyé avec l\'image est IDENTIQUE à celui du template texte', async () => {
  const avecImage = makeWhatsappImageStub(RECIPIENTS_2);
  await createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp: avecImage, db: makeDbStub({}),
    fetchMeteogram: async () => FAKE_PNG,
  }).run(DAY);

  const sansImage = makeWhatsappStub(RECIPIENTS_2);
  await createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp: sansImage, db: makeDbStub({}),
  }).run(DAY);

  assert.deepEqual(avecImage.imageSends[0].bodyParams, sansImage.sends[0].bodyParams,
    'un repli d\'un template sur l\'autre ne doit rien changer au message');
});

test('run: meteogram indisponible → alerte TEXTE complète, dégradation journalisée', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  const { result: res, errors } = await captureErrors(() => createMeteoAlertesJob({
    getMeteoblue: getWeather,
    whatsapp,
    db: makeDbStub({}),
    fetchMeteogram: async () => null, // réseau KO / HTML / payload creux
  }).run(DAY));

  assert.equal(res.sent, 2, 'l\'alerte part quand même');
  assert.equal(res.meteogramAvailable, false);
  assert.equal(res.imageSent, 0);
  assert.equal(whatsapp.uploads.length, 0, 'aucun upload sans image valide');
  assert.equal(whatsapp.sends.length, 2);
  whatsapp.sends.forEach((s) => assert.equal(s.templateName, TEMPLATE_NAME));
  assert.ok(errors.some((l) => /METEOGRAM INDISPONIBLE/.test(l)),
    'la dégradation doit être bruyante, pas silencieuse');
});

test('run: fetch du meteogram qui throw → alerte texte, jamais de crash du job', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  const { result: res, errors } = await captureErrors(() => createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db: makeDbStub({}),
    fetchMeteogram: async () => { throw new Error('boom réseau'); },
  }).run(DAY));

  assert.equal(res.sent, 2);
  assert.equal(res.imageSent, 0);
  assert.ok(errors.some((l) => /METEOGRAM INDISPONIBLE/.test(l) && /boom réseau/.test(l)));
});

test('run: upload Meta en échec → alerte texte, dégradation journalisée', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2, {
    uploadImpl: () => ({ error: 'quota media dépassé' }),
  });
  const { result: res, errors } = await captureErrors(() => createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db: makeDbStub({}),
    fetchMeteogram: async () => FAKE_PNG,
  }).run(DAY));

  assert.equal(res.sent, 2);
  assert.equal(res.meteogramAvailable, false);
  assert.equal(whatsapp.sends.length, 2, 'tout le monde reçoit le texte');
  assert.ok(errors.some((l) => /METEOGRAM INDISPONIBLE/.test(l) && /quota media dépassé/.test(l)));
});

test('run: étage 2 — template image refusé par Meta → repli texte, alerte préservée', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2, {
    imageSendImpl: () => ({ success: false, error: 'Template name does not exist (132001)' }),
  });
  const { result: res, errors } = await captureErrors(() => createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db: makeDbStub({}),
    fetchMeteogram: async () => FAKE_PNG,
  }).run(DAY));

  assert.equal(res.meteogramAvailable, true, 'l\'upload, lui, a réussi');
  assert.equal(res.imageSent, 0);
  assert.equal(res.sent, 2, 'les 2 destinataires sont servis par le texte');
  assert.equal(whatsapp.sends.length, 2);
  whatsapp.sends.forEach((s) => assert.equal(s.templateName, TEMPLATE_NAME));
  assert.ok(errors.some((l) => /envoi AVEC IMAGE refusé/.test(l) && /132001/.test(l)));
  assert.equal(res.persisted, res.alertes.length, 'état mémorisé : les humains ont bien reçu');
});

test('run: étage 3 — image ET texte refusés → general_alert, corps essentiel sauvé', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2, {
    imageSendImpl: () => ({ success: false, error: 'error code 132001' }),
    sendImpl: ({ templateName }) => (templateName === TEMPLATE_NAME
      ? { success: false, error: 'error code 132018' }
      : { success: true, waMessageId: 'wamid.fallback' }),
  });
  const { result: res } = await captureErrors(() => createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db: makeDbStub({}),
    fetchMeteogram: async () => FAKE_PNG,
  }).run(DAY));

  assert.equal(res.sent, 2, 'personne n\'est perdu');
  assert.equal(res.imageSent, 0);
  assert.equal(res.fallbackUsed, 2);
  const derniers = whatsapp.sends.filter((s) => s.templateName === 'general_alert');
  assert.equal(derniers.length, 2);
  derniers.forEach((s) => {
    assert.equal(s.bodyParams.length, 1, 'general_alert : corps mis à plat');
    assert.ok(/FORTE CHALEUR|VENT FORT/i.test(s.bodyParams[0]), 'l\'essentiel décisionnel survit');
  });
});

test('run: échec image PARTIEL — seul le destinataire non servi repasse par le texte', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2, {
    imageSendImpl: ({ to }) => (to === DG.phone
      ? { success: true, waMessageId: 'wamid.img' }
      : { success: false, error: 'media id expired' }),
  });
  const { result: res } = await captureErrors(() => createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db: makeDbStub({}),
    fetchMeteogram: async () => FAKE_PNG,
  }).run(DAY));

  assert.equal(res.imageSent, 1);
  assert.equal(res.sent, 2, 'les deux sont servis, par des voies différentes');
  assert.equal(whatsapp.sends.length, 1, 'le DG ne reçoit PAS un doublon en texte');
  assert.equal(whatsapp.sends[0].to, '+212600000002');
});

test('run: whatsappService sans support image → comportement texte strictement inchangé', async () => {
  const whatsapp = makeWhatsappStub(RECIPIENTS_2); // ni uploadMedia ni …WithImage
  const { result: res, errors } = await captureErrors(() => createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db: makeDbStub({}),
    fetchMeteogram: async () => FAKE_PNG,
  }).run(DAY));

  assert.equal(res.sent, 2);
  assert.equal(res.imageSent, 0);
  assert.equal(res.meteogramAvailable, false);
  assert.ok(errors.some((l) => /sans support image/.test(l)));
});

test('run: sans dep fetchMeteogram, aucun bruit et aucun upload (câblage texte)', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  const { result: res, errors } = await captureErrors(() => createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db: makeDbStub({}),
  }).run(DAY));

  assert.equal(res.sent, 2);
  assert.equal(res.meteogramAvailable, false);
  assert.equal(whatsapp.uploads.length, 0);
  assert.equal(whatsapp.imageSends.length, 0);
  assert.equal(errors.length, 0, 'un câblage volontairement sans image n\'est pas une erreur');
});

test('run: aucune alerte à notifier → AUCUN appel au meteogram', async () => {
  // Pas d'appel Meteoblue ni d'upload Meta pour une matinée calme.
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  let fetches = 0;
  const res = await createMeteoAlertesJob({
    getMeteoblue: async () => weatherPayload([{ time: plus(0), tMax: 20 }]),
    whatsapp, db: makeDbStub({}),
    fetchMeteogram: async () => { fetches++; return FAKE_PNG; },
  }).run(DAY);

  assert.equal(res.sent, 0);
  assert.equal(fetches, 0);
  assert.equal(whatsapp.uploads.length, 0);
});

test('run: preview et checkRecipients ne récupèrent ni n\'uploadent aucune image', async () => {
  const whatsapp = makeWhatsappImageStub(RECIPIENTS_2);
  let fetches = 0;
  const deps = {
    getMeteoblue: getWeather, whatsapp, db: makeDbStub({}),
    fetchMeteogram: async () => { fetches++; return FAKE_PNG; },
  };
  await createMeteoAlertesJob(deps).run(DAY, { preview: true });
  await createMeteoAlertesJob(deps).run(DAY, { checkRecipients: true });

  assert.equal(fetches, 0, 'aucun appel Meteoblue en diagnostic');
  assert.equal(whatsapp.uploads.length, 0);
  assert.equal(whatsapp.imageSends.length, 0);
});

test('template Meta : meteo_alerte_7j_img déclaré en IMAGE, corps identique au texte', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'scripts', 'backend-oneoff', 'create-whatsapp-templates.js'), 'utf8');

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
// ?only=<profileId> — alerte de test sur un seul numéro
// ─────────────────────────────────────────────────────────────────────────────

const CHEF_F1 = { uid: 'u2', displayName: 'Chef F1', phone: '+212600000002' };
const CHEF_F5 = { uid: 'u3', displayName: 'Chef F5', phone: '+212600000003' };
const AUDIENCE_3 = { dg: [DG], chef_f1: [CHEF_F1], chef_f5: [CHEF_F5] };

test('run: only=dg → seul le DG reçoit, les chefs ne sont pas notifiés', async () => {
  const whatsapp = makeWhatsappStub(AUDIENCE_3);
  const db = makeDbStub({});
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db })
    .run(DAY, { only: 'dg' });

  assert.equal(res.recipientsCount, 1);
  assert.equal(res.sent, 1);
  assert.equal(res.restrictedTo, 'dg');
  assert.equal(whatsapp.sends.length, 1);
  assert.equal(whatsapp.sends[0].to, DG.phone);
});

test('run: only → AUCUNE écriture d\'état anti-répétition (le point critique)', async () => {
  // Si un envoi de test marquait les alertes comme « déjà envoyées », la VRAIE
  // alerte du lendemain ne partirait plus aux chefs F1/F5. Ce test verrouille
  // ce comportement.
  const whatsapp = makeWhatsappStub(AUDIENCE_3);
  const db = makeDbStub({});
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db })
    .run(DAY, { only: 'dg' });

  assert.ok(res.alertes.length > 0, 'des alertes ont bien été détectées et envoyées');
  assert.equal(res.sent, 1, 'et reçues');
  assert.equal(db.writes.length, 0, 'AUCUN document d\'état écrit');
  assert.equal(db.store.size, 0, 'la collection reste vide');
  assert.equal(res.persisted, 0);
});

test('run: only → AUCUNE purge de l\'état existant', async () => {
  // Une entrée périmée (jour passé) serait normalement purgée : un envoi de
  // test ne doit toucher à rien.
  const perimee = { type: 'chaleur', dateISO: '2020-01-01', valeur: 40, envoye_at: 'x' };
  const whatsapp = makeWhatsappStub(AUDIENCE_3);
  const db = makeDbStub({ chaleur_2020_01_01: perimee });
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db })
    .run(DAY, { only: 'dg' });

  assert.equal(res.purged, 0);
  assert.equal(db.deletes.length, 0, 'aucune suppression');
  assert.ok(db.store.has('chaleur_2020_01_01'), 'l\'entrée périmée est intacte');
  assert.equal(db.writes.length, 0);
});

test('run: un envoi de test ne rend PAS muette la vraie alerte du lendemain', async () => {
  // Scénario complet : test sur le DG, puis envoi normal → les chefs reçoivent
  // toujours, et l'état n'est écrit qu'à l'envoi normal.
  const db = makeDbStub({});
  const test1 = makeWhatsappStub(AUDIENCE_3);
  await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp: test1, db })
    .run(DAY, { only: 'dg' });
  assert.equal(db.writes.length, 0);

  const reel = makeWhatsappStub(AUDIENCE_3);
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp: reel, db }).run(DAY);

  assert.equal(res.sent, 3, 'les 3 destinataires sont servis normalement');
  assert.ok(res.alertes.length > 0, 'les alertes n\'ont PAS été neutralisées par le test');
  assert.equal(res.persisted, res.alertes.length, 'l\'état n\'est écrit qu\'ici');
  assert.equal(res.restrictedTo, null);
});

test('run: only absent → écriture d\'état et purge inchangées', async () => {
  const perimee = { type: 'chaleur', dateISO: '2020-01-01', valeur: 40, envoye_at: 'x' };
  const whatsapp = makeWhatsappStub(AUDIENCE_3);
  const db = makeDbStub({ chaleur_2020_01_01: perimee });
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db }).run(DAY);

  assert.equal(res.restrictedTo, null);
  assert.equal(res.purged, 1, 'la purge normale a bien lieu');
  assert.equal(res.persisted, res.alertes.length, 'l\'état normal est bien écrit');
  assert.equal(res.recipientsCount, 3);
});

test('run: only + image → le meteogram part aussi, toujours sans écriture d\'état', async () => {
  const whatsapp = makeWhatsappImageStub(AUDIENCE_3);
  const db = makeDbStub({});
  const res = await createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp, db,
    fetchMeteogram: async () => FAKE_PNG,
  }).run(DAY, { only: 'dg' });

  assert.equal(res.imageSent, 1);
  assert.equal(whatsapp.imageSends.length, 1);
  assert.equal(whatsapp.imageSends[0].to, DG.phone);
  assert.equal(db.writes.length, 0, 'toujours aucune écriture d\'état');
  assert.equal(res.restrictedTo, 'dg');
});

test('run: checkRecipients + only → diagnostic restreint, sans effet de bord', async () => {
  const whatsapp = makeWhatsappStub(AUDIENCE_3);
  const db = makeDbStub({});
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db })
    .run(DAY, { checkRecipients: true, only: 'chef_f1' });

  assert.equal(res.recipientsCount, 1);
  assert.equal(res.recipients[0].phone, CHEF_F1.phone);
  assert.equal(res.restrictedTo, 'chef_f1');
  assert.equal(whatsapp.sends.length, 0);
  assert.equal(db.writes.length, 0);
  assert.equal(db.deletes.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Contournement de l'anti-répétition — RÉSERVÉ au mode ?only=
// ─────────────────────────────────────────────────────────────────────────────

/**
 * État Firestore où les DEUX alertes de WEATHER sont déjà mémorisées à leur
 * valeur exacte : en temps normal, plus rien ne doit partir.
 * (clé = `type_dateISO`, cf. detecterAlertes.)
 */
function etatDejaEnvoye() {
  return {
    ['chaleur_' + plus(0)]: { type: 'chaleur', dateISO: plus(0), valeur: 36, envoye_at: 'hier' },
    ['vent_' + plus(2)]: { type: 'vent', dateISO: plus(2), valeur: 31, envoye_at: 'hier' },
  };
}

test('anti-répétition: HORS mode only, une alerte déjà mémorisée reste FILTRÉE', () => {
  // LE test important : c'est lui qui garantit qu'on n'a pas ouvert une brèche
  // dans l'anti-répétition en facilitant le test. Si celui-ci tombe, les chefs
  // se font notifier les mêmes alertes tous les matins.
  const detectees = detecterAlertes(WEATHER, { fromISO: DAY, jours: 7 });
  assert.equal(detectees.length, 2);
  const etat = new Map(Object.entries(etatDejaEnvoye()));
  assert.deepEqual(filtrerAlertesANotifier(detectees, etat), [],
    'le filtre lui-même n\'a pas bougé');
});

test('run: HORS mode only, alertes déjà mémorisées → aucun envoi (comportement du cron)', async () => {
  const whatsapp = makeWhatsappStub(AUDIENCE_3);
  const db = makeDbStub(etatDejaEnvoye());
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db }).run(DAY);

  assert.equal(res.sent, 0, 'personne n\'est re-notifié');
  assert.deepEqual(res.alertes, []);
  assert.equal(res.skipped, 2, 'les 2 alertes sont comptées comme déjà envoyées');
  assert.equal(res.dedupBypassed, false, 'le filtrage est bien actif');
  assert.equal(res.restrictedTo, null);
  assert.equal(whatsapp.sends.length, 0);
});

test('run: en mode only, une alerte déjà mémorisée est QUAND MÊME envoyée', async () => {
  // Un mode test doit être déterministe : son résultat ne peut pas dépendre de
  // si le cron de 6h est déjà passé.
  const whatsapp = makeWhatsappStub(AUDIENCE_3);
  const db = makeDbStub(etatDejaEnvoye());
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db })
    .run(DAY, { only: 'dg' });

  assert.equal(res.alertes.length, 2, 'les 2 alertes détectées partent malgré l\'état');
  assert.equal(res.sent, 1, 'au seul destinataire restreint');
  assert.equal(res.skipped, 0);
  assert.equal(res.dedupBypassed, true, 'le contournement est tracé dans le retour');
  assert.equal(res.restrictedTo, 'dg');
  assert.equal(whatsapp.sends.length, 1);
  assert.equal(whatsapp.sends[0].to, DG.phone);
});

test('run: le contournement ne modifie NI n\'efface l\'état existant', async () => {
  const seed = etatDejaEnvoye();
  const whatsapp = makeWhatsappStub(AUDIENCE_3);
  const db = makeDbStub(seed);
  const res = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp, db })
    .run(DAY, { only: 'dg' });

  assert.equal(res.sent, 1);
  assert.equal(db.writes.length, 0, 'aucune écriture');
  assert.equal(db.deletes.length, 0, 'aucune suppression');
  assert.equal(res.persisted, 0);
  assert.equal(db.store.size, 2, 'les 2 entrées d\'origine sont intactes');
  assert.deepEqual(db.store.get('chaleur_' + plus(0)), seed['chaleur_' + plus(0)],
    'valeur d\'état inchangée');
});

test('run: après un test en mode only, le cron du lendemain filtre TOUJOURS', async () => {
  // Bout en bout : le contournement est strictement local à l'appel restreint,
  // il ne « réarme » rien pour l\'envoi complet suivant.
  const db = makeDbStub(etatDejaEnvoye());
  const testDg = makeWhatsappStub(AUDIENCE_3);
  const resTest = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp: testDg, db })
    .run(DAY, { only: 'dg' });
  assert.equal(resTest.sent, 1, 'le test a bien envoyé');

  const cron = makeWhatsappStub(AUDIENCE_3);
  const resCron = await createMeteoAlertesJob({ getMeteoblue: getWeather, whatsapp: cron, db }).run(DAY);

  assert.equal(resCron.dedupBypassed, false);
  assert.equal(resCron.sent, 0, 'les chefs ne sont pas spammés à cause du test');
  assert.equal(cron.sends.length, 0);
});

test('run: sans état préalable, only et envoi complet détectent les mêmes alertes', async () => {
  // Le contournement ne doit rien INVENTER : mêmes alertes des deux côtés.
  const dbA = makeDbStub({});
  const resOnly = await createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp: makeWhatsappStub(AUDIENCE_3), db: dbA,
  }).run(DAY, { only: 'dg' });

  const dbB = makeDbStub({});
  const resPlein = await createMeteoAlertesJob({
    getMeteoblue: getWeather, whatsapp: makeWhatsappStub(AUDIENCE_3), db: dbB,
  }).run(DAY);

  assert.deepEqual(resOnly.alertes.map((a) => a.cle), resPlein.alertes.map((a) => a.cle));
  assert.equal(resOnly.dedupBypassed, true);
  assert.equal(resPlein.dedupBypassed, false);
});

test('run: le log d\'un envoi restreint annonce le contournement, pas une panne', async () => {
  const { errors } = await captureErrors(async () => {
    const logs = [];
    const orig = console.log;
    console.log = (...a) => { logs.push(a.join(' ')); };
    try {
      await createMeteoAlertesJob({
        getMeteoblue: getWeather, whatsapp: makeWhatsappStub(AUDIENCE_3), db: makeDbStub({}),
      }).run(DAY, { only: 'dg' });
    } finally {
      console.log = orig;
    }
    assert.ok(logs.some((l) => /ENVOI RESTREINT À dg/.test(l)), 'restriction annoncée');
    assert.ok(logs.some((l) => /anti-répétition CONTOURNÉ/.test(l)),
      'sinon on relira ce log comme une panne de l\'anti-répétition');
    assert.ok(logs.some((l) => /état NON mémorisé/.test(l)));
    return null;
  });
  assert.equal(errors.length, 0);
});
