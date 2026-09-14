/**
 * Chemin « image » de whatsappService — `uploadMedia` (PNG) puis
 * `sendTemplateMessageWithImage`, qui porte le graphique du digest de 6h.
 *
 * Même méthode que lib/campagneRapportHebdo/__tests__/whatsappDocument.test.js :
 * on teste le VRAI service en interceptant `fetch`, donc le payload réellement
 * émis vers Meta. Deux points sont non négociables ici :
 *  - `header.parameters[0].type === "image"` ;
 *  - AUCUN `filename` — Meta rejette ce champ sur un header IMAGE (c'est le
 *    seul écart de fond avec la variante DOCUMENT).
 *
 * Firestore est neutralisé par injection dans le cache de modules : aucun
 * réseau, aucun émulateur.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG = {
  enabled: true,
  phone_number_id: '1040240149168335',
  access_token: 'TOKEN-TEST',
  default_language: 'fr',
};

const logs = [];
const fakeDb = {
  collection(name) {
    if (name === 'config') {
      return { doc: () => ({ get: async () => ({ exists: true, data: () => CONFIG }) }) };
    }
    if (name === 'whatsapp_logs') {
      return { add: async (doc) => { logs.push(doc); return { id: 'log' + logs.length }; } };
    }
    throw new Error('collection Firestore inattendue: ' + name);
  },
};

const fbPath = require.resolve('../../../config/firebase');
require.cache[fbPath] = {
  id: fbPath,
  filename: fbPath,
  loaded: true,
  exports: { admin: {}, db: fakeDb, bucket: {} },
};

const whatsapp = require('../../../whatsappService');
const { PNG_MIME } = require('../renderPng');
// Nom du template en dur : ce fichier couvre le TRANSPORT (whatsappService),
// pas le job. Le lien avec `sprayDigest.IMAGE_TEMPLATE_NAME` est verrouillé
// côté sprayDigest.test.js.
const IMAGE_TEMPLATE_NAME = 'meteo_spray_digest_img';

const PHONE = '+212600000001';
const PARAMS = ['Mer 19/08', '🌡️ Température : 17°C → 29°C\n\n✅ Fenêtres : 06h00 - 09h00'];

/** Remplace fetch et enregistre chaque appel. */
function stubFetch(responder) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    const r = responder ? await responder(String(url), init || {}, calls.length) : null;
    const payload = r && r.body !== undefined ? r.body : { messages: [{ id: 'wamid.TEST' }] };
    return {
      ok: r ? r.ok !== false : true,
      status: r && r.status ? r.status : 200,
      json: async () => payload,
    };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

function bodyOf(call) {
  return JSON.parse(call.init.body);
}

test('uploadMedia : un PNG part en multipart avec le bon MIME', async () => {
  const f = stubFetch(async () => ({ body: { id: 'MEDIA-PNG-1' } }));
  try {
    const res = await whatsapp.uploadMedia(Buffer.from('\x89PNG-fake'), PNG_MIME, 'spray-chart.png');
    assert.deepEqual(res, { id: 'MEDIA-PNG-1' });
    assert.match(f.calls[0].url, /\/1040240149168335\/media$/);
    const form = f.calls[0].init.body;
    assert.equal(form.get('type'), PNG_MIME);
    assert.equal(form.get('file').type, PNG_MIME);
    assert.equal(form.get('file').name, 'spray-chart.png');
  } finally {
    f.restore();
  }
});

test('sendTemplateMessageWithImage : header image(media_id), body aplati sur une ligne', async () => {
  logs.length = 0;
  const f = stubFetch();
  try {
    const res = await whatsapp.sendTemplateMessageWithImage(
      PHONE, IMAGE_TEMPLATE_NAME, { mediaId: 'MEDIA-PNG-1' }, PARAMS, undefined, 'Chef F1'
    );
    assert.equal(res.success, true);

    const body = bodyOf(f.calls[0]);
    assert.equal(body.messaging_product, 'whatsapp');
    assert.equal(body.to, PHONE);
    assert.equal(body.type, 'template');
    assert.equal(body.template.name, 'meteo_spray_digest_img');
    assert.equal(body.template.language.code, 'fr');

    const header = body.template.components.find((c) => c.type === 'header');
    assert.ok(header, 'un composant header est obligatoire pour un template IMAGE');
    assert.equal(header.parameters[0].type, 'image');
    assert.deepEqual(header.parameters[0].image, { id: 'MEDIA-PNG-1' });

    // Régression du 2026-09-14 (production readiness) : Meta rejette tout param
    // contenant '\n'/tab/4+ espaces avec l'erreur #132018 ("Param text cannot
    // have new-line/tab characters or more than 4 consecutive spaces") —
    // confirmé en direct contre l'API réelle, 559 envois échoués sur 5
    // templates dont meteo_spray_digest_img. whatsappService aplatit donc
    // chaque param via toSingleLine() avant envoi ; PARAMS reste volontairement
    // multi-ligne en entrée pour couvrir exactement ce cas.
    const bodyComp = body.template.components.find((c) => c.type === 'body');
    assert.deepEqual(bodyComp.parameters.map((p) => p.text), PARAMS.map((p) => whatsapp.toSingleLine(p)));
    bodyComp.parameters.forEach((p) => {
      assert.equal(p.type, 'text');
      assert.ok(!/[\n\t]/.test(p.text), 'aucun param envoyé à Meta ne doit contenir de saut de ligne/tab');
    });
  } finally {
    f.restore();
  }
});

test('AUCUN filename sur un header IMAGE (Meta le rejette)', async () => {
  const f = stubFetch();
  try {
    await whatsapp.sendTemplateMessageWithImage(PHONE, IMAGE_TEMPLATE_NAME, 'MEDIA-PNG-1', PARAMS);
    const raw = f.calls[0].init.body;
    assert.ok(!/filename/.test(raw), 'le payload ne doit contenir aucun filename');
    const header = bodyOf(f.calls[0]).template.components[0];
    assert.deepEqual(Object.keys(header.parameters[0].image), ['id']);
  } finally {
    f.restore();
  }
});

test('référence par link acceptée, media_id nu accepté aussi', async () => {
  const f = stubFetch();
  try {
    await whatsapp.sendTemplateMessageWithImage(PHONE, IMAGE_TEMPLATE_NAME, { link: 'https://x/y.png' }, PARAMS);
    await whatsapp.sendTemplateMessageWithImage(PHONE, IMAGE_TEMPLATE_NAME, 'MEDIA-NU', PARAMS);
    assert.deepEqual(bodyOf(f.calls[0]).template.components[0].parameters[0].image, { link: 'https://x/y.png' });
    assert.deepEqual(bodyOf(f.calls[1]).template.components[0].parameters[0].image, { id: 'MEDIA-NU' });
  } finally {
    f.restore();
  }
});

test('référence image manquante → aucun appel réseau', async () => {
  const f = stubFetch();
  try {
    const res = await whatsapp.sendTemplateMessageWithImage(PHONE, IMAGE_TEMPLATE_NAME, {}, PARAMS);
    assert.equal(res.success, false);
    assert.match(res.error, /Référence image manquante/);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('journalisation whatsapp_logs : succès ET échec', async () => {
  logs.length = 0;
  const ok = stubFetch();
  try {
    await whatsapp.sendTemplateMessageWithImage(PHONE, IMAGE_TEMPLATE_NAME, 'M', PARAMS, undefined, 'Chef F5');
  } finally {
    ok.restore();
  }
  assert.equal(logs.length, 1);
  assert.equal(logs[0].status, 'sent');
  assert.equal(logs[0].templateName, 'meteo_spray_digest_img');
  assert.equal(logs[0].toName, 'Chef F5');

  const ko = stubFetch(async () => ({
    ok: false, status: 400, body: { error: { message: 'Template name does not exist in the translation' } },
  }));
  try {
    const res = await whatsapp.sendTemplateMessageWithImage(PHONE, IMAGE_TEMPLATE_NAME, 'M', PARAMS);
    assert.equal(res.success, false);
    assert.match(res.error, /Template name does not exist/);
  } finally {
    ko.restore();
  }
  assert.equal(logs.length, 2);
  assert.equal(logs[1].status, 'failed');
});

test('UN upload pour N destinataires : le même media_id part chez tous', async () => {
  const f = stubFetch(async (url) => (url.endsWith('/media') ? { body: { id: 'MEDIA-XYZ' } } : null));
  try {
    const up = await whatsapp.uploadMedia(Buffer.from('png'), PNG_MIME, 'spray-chart.png');
    const destinataires = [PHONE, '+212600000002', '+212600000003'];
    for (const to of destinataires) {
      await whatsapp.sendTemplateMessageWithImage(to, IMAGE_TEMPLATE_NAME, { mediaId: up.id }, PARAMS);
    }
    const uploads = f.calls.filter((c) => c.url.endsWith('/media'));
    const messages = f.calls.filter((c) => c.url.endsWith('/messages'));
    assert.equal(uploads.length, 1, '1 seul upload');
    assert.equal(messages.length, 3, '3 envois');
    const ids = new Set(messages.map((c) => bodyOf(c).template.components[0].parameters[0].image.id));
    assert.deepEqual(Array.from(ids), ['MEDIA-XYZ']);
    assert.deepEqual(messages.map((c) => bodyOf(c).to), destinataires);
  } finally {
    f.restore();
  }
});
