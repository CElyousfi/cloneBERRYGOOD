/**
 * Chemin « pièce jointe » de whatsappService — jusqu'ici NON couvert alors
 * qu'il porte tout le rapport hebdo : `uploadMedia` puis
 * `sendTemplateMessageWithDocument`.
 *
 * On teste le VRAI service (pas un double) en interceptant `fetch` : ce qui est
 * vérifié, c'est le payload réellement émis vers Meta — MIME xlsx, header
 * `document`, filename, et la réutilisation d'un unique media_id pour N envois.
 * Un double maison n'aurait prouvé que la cohérence du double avec lui-même.
 *
 * Firestore est neutralisé par injection dans le cache de modules (config +
 * journal `whatsapp_logs` en mémoire) : aucun réseau, aucun émulateur.
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
const { XLSX_MIME, TEMPLATE_NAME } = require('../index');

const PHONE = '+212600000001';

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

test('uploadMedia : POST /media multipart, MIME xlsx et filename conservés', async () => {
  const f = stubFetch(async () => ({ body: { id: 'MEDIA-123' } }));
  try {
    const res = await whatsapp.uploadMedia(Buffer.from('PKfake-xlsx'), XLSX_MIME, 'Campagne_Framboise.xlsx');
    assert.deepEqual(res, { id: 'MEDIA-123' });
    assert.equal(f.calls.length, 1);
    assert.match(f.calls[0].url, /\/1040240149168335\/media$/);
    assert.equal(f.calls[0].init.method, 'POST');
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer TOKEN-TEST');

    const form = f.calls[0].init.body;
    assert.equal(form.get('messaging_product'), 'whatsapp');
    assert.equal(form.get('type'), XLSX_MIME);
    const file = form.get('file');
    assert.equal(file.type, XLSX_MIME, 'le Blob porte bien le MIME xlsx');
    assert.equal(file.name, 'Campagne_Framboise.xlsx', 'nom de fichier transmis à Meta');
    assert.ok(file.size > 0);
  } finally {
    f.restore();
  }
});

test('uploadMedia : erreur Meta remontée, jamais un media_id fantôme', async () => {
  const f = stubFetch(async () => ({ ok: false, status: 400, body: { error: { message: 'Unsupported file type' } } }));
  try {
    const res = await whatsapp.uploadMedia(Buffer.from('x'), XLSX_MIME, 'f.xlsx');
    assert.equal(res.id, undefined);
    assert.match(res.error, /Unsupported file type/);
  } finally {
    f.restore();
  }
});

test('uploadMedia : buffer vide refusé sans appeler Meta', async () => {
  const f = stubFetch();
  try {
    const res = await whatsapp.uploadMedia(Buffer.alloc(0), XLSX_MIME, 'f.xlsx');
    assert.match(res.error, /Buffer vide/);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('sendTemplateMessageWithDocument : payload template + header document(media_id)', async () => {
  logs.length = 0;
  const f = stubFetch();
  try {
    const res = await whatsapp.sendTemplateMessageWithDocument(
      PHONE,
      TEMPLATE_NAME,
      { mediaId: 'MEDIA-123' },
      'Campagne_Framboise.xlsx',
      ['Framboise', '17/08/2026', '23'],
      undefined,
      'Chef F1'
    );
    assert.equal(res.success, true);

    const body = bodyOf(f.calls[0]);
    assert.equal(body.messaging_product, 'whatsapp');
    assert.equal(body.to, PHONE);
    assert.equal(body.type, 'template');
    assert.equal(body.template.name, 'campagne_rapport_hebdo');
    assert.equal(body.template.language.code, 'fr');

    const header = body.template.components.find((c) => c.type === 'header');
    assert.ok(header, 'un composant header est obligatoire pour un template DOCUMENT');
    assert.equal(header.parameters[0].type, 'document');
    assert.deepEqual(header.parameters[0].document, { id: 'MEDIA-123', filename: 'Campagne_Framboise.xlsx' });

    const bodyComp = body.template.components.find((c) => c.type === 'body');
    assert.deepEqual(bodyComp.parameters.map((p) => p.text), ['Framboise', '17/08/2026', '23']);
    bodyComp.parameters.forEach((p) => assert.equal(p.type, 'text'));

    // Traçabilité whatsapp_logs assurée par le service (pas à refaire côté job).
    assert.equal(logs.length, 1);
    assert.equal(logs[0].status, 'sent');
    assert.equal(logs[0].templateName, 'campagne_rapport_hebdo');
    assert.equal(logs[0].toName, 'Chef F1');
  } finally {
    f.restore();
  }
});

test('UN upload pour N envois : le même media_id part chez tous les destinataires', async () => {
  const f = stubFetch(async (url) => (url.endsWith('/media') ? { body: { id: 'MEDIA-XYZ' } } : null));
  try {
    const up = await whatsapp.uploadMedia(Buffer.from('classeur'), XLSX_MIME, 'Campagne_Framboise.xlsx');
    const destinataires = [PHONE, '+212600000002', '+212600000003'];
    for (const to of destinataires) {
      await whatsapp.sendTemplateMessageWithDocument(
        to, TEMPLATE_NAME, { mediaId: up.id }, 'Campagne_Framboise.xlsx', ['Framboise', '17/08/2026', '23']
      );
    }

    const uploads = f.calls.filter((c) => c.url.endsWith('/media'));
    const messages = f.calls.filter((c) => c.url.endsWith('/messages'));
    assert.equal(uploads.length, 1, '1 seul upload');
    assert.equal(messages.length, 3, '3 envois');
    const ids = new Set(messages.map((c) => bodyOf(c).template.components[0].parameters[0].document.id));
    assert.deepEqual(Array.from(ids), ['MEDIA-XYZ']);
    assert.deepEqual(messages.map((c) => bodyOf(c).to), destinataires);
  } finally {
    f.restore();
  }
});

test('sendTemplateMessageWithDocument : refus Meta → success:false et log failed', async () => {
  logs.length = 0;
  const f = stubFetch(async () => ({
    ok: false,
    status: 400,
    body: { error: { message: 'Template name does not exist in the translation' } },
  }));
  try {
    const res = await whatsapp.sendTemplateMessageWithDocument(
      PHONE, TEMPLATE_NAME, { mediaId: 'M' }, 'f.xlsx', ['Framboise', '17/08/2026', '23']
    );
    assert.equal(res.success, false);
    assert.match(res.error, /Template name does not exist/);
    assert.equal(logs[0].status, 'failed');
  } finally {
    f.restore();
  }
});

test('sendTemplateMessageWithDocument : référence document manquante → aucun appel réseau', async () => {
  const f = stubFetch();
  try {
    const res = await whatsapp.sendTemplateMessageWithDocument(PHONE, TEMPLATE_NAME, {}, 'f.xlsx', []);
    assert.equal(res.success, false);
    assert.match(res.error, /Référence document manquante/);
    assert.equal(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

test('general_alert : un seul paramètre, sur une seule ligne (toSingleLine)', async () => {
  const f = stubFetch();
  try {
    const texte = whatsapp.toSingleLine('Rapport Campagne hebdo INCOMPLET —\nFramboise\t: 0 envoi');
    assert.ok(!/[\n\t]/.test(texte));
    await whatsapp.sendTemplateMessage(PHONE, 'general_alert', [texte]);
    const body = bodyOf(f.calls[0]);
    assert.equal(body.template.name, 'general_alert');
    assert.equal(body.template.components[0].parameters.length, 1);
    assert.ok(!/[\n\t]/.test(body.template.components[0].parameters[0].text));
  } finally {
    f.restore();
  }
});
