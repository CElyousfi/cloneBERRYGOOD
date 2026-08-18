'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TEMPLATE_NAME,
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

test('detecterAlertes: chaleur — 31.4 sous le seuil, 32 déclenche', () => {
  // La comparaison porte sur la valeur arrondie (cf. écran) : la borne basse
  // réelle est donc 31.5, pas 32.
  assert.equal(detecterAlertes(weatherPayload([{ time: DAY, tMax: 31.4 }]), { fromISO: DAY }).length, 0);
  const a = detecterAlertes(weatherPayload([{ time: DAY, tMax: 32 }]), { fromISO: DAY });
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

test('detecterAlertes: compare la valeur ARRONDIE, comme l\'écran (31.6 °C alerte)', () => {
  // public/app.jsx affiche Math.round(tMax) : 31.6 → 32 → alerte à l'écran.
  const a = detecterAlertes(weatherPayload([{ time: DAY, tMax: 31.6 }]), { fromISO: DAY });
  assert.equal(a.length, 1);
  assert.equal(a[0].type, 'chaleur');
  assert.equal(a[0].valeur, 31.6, 'la valeur brute (arrondie au dixième) reste mémorisée');
  assert.equal(detecterAlertes(weatherPayload([{ time: DAY, tMax: 31.4 }]), { fromISO: DAY }).length, 0);
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
    weatherPayload([{ time: DAY + 'T00:00', tMax: 34 }]), { fromISO: DAY }
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
    { time: plus(1), tMax: 33 },
    { time: plus(2), pluie: 12 },
  ]), { fromISO: DAY });
  assert.deepEqual(a.map((x) => x.dateISO), [plus(1), plus(2), plus(3)]);
});

test('detecterAlertes: fenêtre — J+7 inclus, J+8 exclu, passé exclu', () => {
  const a = detecterAlertes(weatherPayload([
    { time: plus(-1), tMax: 40 },
    { time: plus(0), tMax: 33 },
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
    { time: plus(0), tMax: 34 },
    { time: plus(3), vent: 31 },
  ]), { fromISO: DAY });
  const out = formatAlertes(alertes);

  assert.equal(out.titreParam, '21 → 24/08');
  assert.match(out.body, /^VENDREDI 21 AOÛT — FORTE CHALEUR$/m);
  assert.match(out.body, /^LUNDI 24 AOÛT — VENT FORT$/m);
  assert.match(out.body, /34°C prévus \(seuil 32°C\)/);
  assert.match(out.body, /31 km\/h prévus \(seuil 25 km\/h\)/);
  assert.match(out.body, /phyto/);
});

test('formatAlertes: période sur deux mois et jour unique', () => {
  const unJour = detecterAlertes(weatherPayload([{ time: DAY, tMax: 34 }]), { fromISO: DAY });
  assert.equal(formatAlertes(unJour).titreParam, '21/08');

  const across = formatAlertes([
    { type: 'chaleur', label: 'Forte Chaleur', dateISO: '2026-08-29', valeur: 34, seuil: 32, cle: 'chaleur_2026-08-29' },
    { type: 'vent', label: 'Vent Fort', dateISO: '2026-09-02', valeur: 30, seuil: 25, cle: 'vent_2026-09-02' },
  ]);
  assert.equal(across.titreParam, '29/08 → 02/09');
});

test('formatAlertes: fallbackText tient sur une seule ligne', () => {
  const alertes = detecterAlertes(weatherPayload([
    { time: plus(0), tMax: 34, pluie: 18 },
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
  type: 'chaleur', label: 'Forte Chaleur', dateISO: DAY, valeur: 34, seuil: 32, cle: 'chaleur_' + DAY,
};

test('filtrerAlertesANotifier: clé inconnue → renvoyée', () => {
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], new Map()), [A_CHALEUR]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], null), [A_CHALEUR]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], {}), [A_CHALEUR]);
});

test('filtrerAlertesANotifier: clé connue, valeur identique → non renvoyée', () => {
  const etat = new Map([[A_CHALEUR.cle, { valeur: 34 }]]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], etat), []);
});

test('filtrerAlertesANotifier: aggravation < marge → non renvoyée', () => {
  const etat = new Map([[A_CHALEUR.cle, { valeur: 34 - (MARGES_AGGRAVATION.chaleur - 0.1) }]]);
  assert.deepEqual(filtrerAlertesANotifier([A_CHALEUR], etat), []);
});

test('filtrerAlertesANotifier: aggravation == marge → renvoyée', () => {
  const etat = new Map([[A_CHALEUR.cle, { valeur: 34 - MARGES_AGGRAVATION.chaleur }]]);
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
  { time: plus(0), tMax: 34 },
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

test('run: alerte déjà envoyée → aucun envoi, aucune écriture', async () => {
  const whatsapp = makeWhatsappStub({ dg: [DG] });
  const db = makeDbStub({
    ['chaleur_' + plus(0)]: { type: 'chaleur', dateISO: plus(0), valeur: 34, envoye_at: 'x' },
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
    ['chaleur_' + plus(0)]: { type: 'chaleur', dateISO: plus(0), valeur: 32, envoye_at: 'x' },
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
    ['chaleur_' + plus(-3)]: { type: 'chaleur', dateISO: plus(-3), valeur: 34, envoye_at: 'x' },
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
    ['chaleur_' + plus(2)]: { type: 'chaleur', dateISO: plus(2), valeur: 34, envoye_at: 'x' },
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
    ['chaleur_' + plus(-3)]: { type: 'chaleur', dateISO: plus(-3), valeur: 34, envoye_at: 'x' },
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
    { ['chaleur_' + plus(0)]: { type: 'chaleur', dateISO: plus(0), valeur: 34, envoye_at: 'x' } },
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
