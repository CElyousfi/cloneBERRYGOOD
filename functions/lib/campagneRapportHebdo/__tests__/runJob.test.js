/**
 * Orchestration du rapport hebdo : un classeur par culture, UN SEUL upload par
 * culture réutilisé pour tous ses destinataires, alerte au profil dg dès qu'un
 * humain n'a pas été servi — et jamais d'envoi d'un fichier douteux.
 *
 * Tout est injecté : aucun réseau, aucun Firestore, aucun message réel.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runRapportHebdo, checkRecipients, dryRun, buildHttpHandler, XLSX_MIME, TEMPLATE_NAME } = require('../index');

const USERS = {
  chef_f1: [{ uid: 'c1', displayName: 'Chef F1', phone: '+212600000002' }],
  chef_f5: [{ uid: 'c5', displayName: 'Chef F5', phone: '+212600000003' }],
  dg: [{ uid: 'dg', displayName: 'Omar', phone: '+212600000001' }],
  dt: [{ uid: 'dt', displayName: 'Youssef', phone: '+212600000004' }],
  rh: [{ uid: 'rh', displayName: 'Salma', phone: '+212600000005' }],
};

function makeDeps(over) {
  const calls = { workbooks: [], uploads: [], docs: [], alerts: [], auth: 0 };
  const deps = {
    calls,
    // Gate du trigger HTTP (ignorée par runRapportHebdo/checkRecipients/dryRun).
    requireAuth: async (req, res) => { calls.auth += 1; return { uid: 'u-dg' }; },
    resolveProfile: async () => ({ profileId: 'dg', role: null }),
    buildWorkbook: async ({ culture, fermeFilter }) => {
      calls.workbooks.push({ culture, fermeFilter });
      return { fileName: 'Campagne_' + culture + '.xlsx', buffer: Buffer.from('XLSX-' + culture), nbFeuilles: 24 };
    },
    resolveRecipientsForProfile: async (profileId, ferme) => {
      assert.equal(ferme, null, 'périmètre = culture entière → aucun filtre ferme');
      return (USERS[profileId] || []).slice();
    },
    uploadMedia: async (buffer, mime, fileName) => {
      calls.uploads.push({ mime, fileName, octets: buffer.length });
      return { id: 'media-' + fileName };
    },
    sendTemplateMessageWithDocument: async (to, template, ref, fileName, bodyParams, lang, toName) => {
      calls.docs.push({ to, template, ref, fileName, bodyParams, lang, toName });
      return { success: true, waMessageId: 'wamid.' + to };
    },
    sendTemplateMessage: async (to, template, bodyParams) => {
      calls.alerts.push({ to, template, bodyParams });
      return { success: true };
    },
    toSingleLine: (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim(),
    now: () => new Date('2026-08-17T15:00:00Z'), // lundi
  };
  return Object.assign(deps, over || {});
}

test('nominal : 2 classeurs, 2 uploads, 8 envois, aucune alerte', async () => {
  const deps = makeDeps();
  const out = await runRapportHebdo(deps);

  assert.equal(out.success, true);
  assert.equal(deps.calls.workbooks.length, 2);
  deps.calls.workbooks.forEach((w) => assert.equal(w.fermeFilter, null, 'toute la culture'));
  assert.equal(deps.calls.docs.length, 8, '4 destinataires × 2 cultures');
  assert.equal(deps.calls.alerts.length, 0, 'succès complet = silence');
  assert.equal(out.resume.totalEnvoyes, 8);
});

test('UN SEUL upload par culture : le media_id est réutilisé pour les 4 destinataires', async () => {
  const deps = makeDeps();
  await runRapportHebdo(deps, { cultures: ['Framboise'] });

  assert.equal(deps.calls.uploads.length, 1, '1 upload, pas 1 par destinataire');
  assert.equal(deps.calls.uploads[0].mime, XLSX_MIME);
  assert.equal(deps.calls.uploads[0].fileName, 'Campagne_Framboise.xlsx');
  assert.equal(deps.calls.docs.length, 4);
  const mediaIds = new Set(deps.calls.docs.map((d) => d.ref.mediaId));
  assert.equal(mediaIds.size, 1);
  assert.equal(mediaIds.has('media-Campagne_Framboise.xlsx'), true);
});

test('les paramètres du template décrivent le bon classeur', async () => {
  const deps = makeDeps();
  await runRapportHebdo(deps, { cultures: ['Framboise'] });
  const d = deps.calls.docs[0];
  assert.equal(d.template, TEMPLATE_NAME);
  assert.equal(d.fileName, 'Campagne_Framboise.xlsx');
  assert.deepEqual(d.bodyParams, ['Framboise', '17/08/2026', '23']);
  assert.equal(d.lang, undefined, 'langue par défaut du service');
  assert.equal(d.toName, 'Chef F1', 'traçabilité nominative dans whatsapp_logs');
});

test('classeur impossible → AUCUN envoi pour cette culture, et alerte au dg', async () => {
  const deps = makeDeps({
    buildWorkbook: async ({ culture }) => {
      if (culture === 'Framboise') throw new Error('campagne invalide (2029-2030)');
      return { fileName: 'Campagne_Myrtille.xlsx', buffer: Buffer.from('X'), nbFeuilles: 5 };
    },
  });
  const out = await runRapportHebdo(deps);

  assert.equal(out.success, false);
  assert.equal(deps.calls.docs.filter((d) => d.fileName.includes('Framboise')).length, 0,
    'jamais de fichier faux : on n\'envoie rien plutôt qu\'un classeur douteux');
  assert.equal(deps.calls.docs.length, 4, 'la Myrtille part quand même');
  assert.equal(deps.calls.alerts.length, 1, 'alerte au seul destinataire dg');
  assert.equal(deps.calls.alerts[0].template, 'general_alert');
  assert.equal(deps.calls.alerts[0].bodyParams.length, 1, 'general_alert n\'a QU\'UN paramètre');
  assert.match(deps.calls.alerts[0].bodyParams[0], /campagne invalide/);
  assert.ok(!/[\n\t]/.test(deps.calls.alerts[0].bodyParams[0]), 'Meta rejette les retours ligne');
});

test('classeur vide → traité comme un échec, pas envoyé', async () => {
  const deps = makeDeps({
    buildWorkbook: async () => ({ fileName: 'vide.xlsx', buffer: Buffer.alloc(0), nbFeuilles: 0 }),
  });
  const out = await runRapportHebdo(deps, { cultures: ['Framboise'] });
  assert.equal(out.success, false);
  assert.equal(deps.calls.docs.length, 0);
  assert.match(out.resume.texte, /classeur vide/);
});

test('classeur « Synthèse seule » (0 parcelle) → on alerte, on n\'envoie pas', async () => {
  const deps = makeDeps({
    buildWorkbook: async () => ({ fileName: 'synthese.xlsx', buffer: Buffer.from('X'), nbFeuilles: 1 }),
  });
  const out = await runRapportHebdo(deps, { cultures: ['Framboise'] });
  assert.equal(out.success, false);
  assert.equal(deps.calls.uploads.length, 0, 'rien n\'est poussé chez Meta');
  assert.equal(deps.calls.docs.length, 0, '« 0 parcelles » se lirait comme une info, pas comme une panne');
  assert.match(out.resume.texte, /aucune parcelle/);
  assert.equal(deps.calls.alerts.length, 1);
});

test('culture sans destinataire : ni génération, ni upload (pas de media_id orphelin)', async () => {
  const deps = makeDeps({ resolveRecipientsForProfile: async () => [] });
  const out = await runRapportHebdo(deps, { cultures: ['Framboise'] });
  assert.equal(deps.calls.workbooks.length, 0, 'aucun classeur produit pour personne');
  assert.equal(deps.calls.uploads.length, 0, 'aucun upload Meta pour personne');
  assert.equal(out.success, false);
  assert.match(out.resume.texte, /AUCUN destinataire joignable/);
});

test('upload en échec → aucun envoi pour la culture, alerte', async () => {
  const deps = makeDeps({ uploadMedia: async () => ({ error: 'Upload HTTP 400' }) });
  const out = await runRapportHebdo(deps, { cultures: ['Framboise'] });
  assert.equal(out.success, false);
  assert.equal(deps.calls.docs.length, 0);
  assert.match(out.resume.texte, /Upload HTTP 400/);
  assert.equal(deps.calls.alerts.length, 1);
});

test('un profil de la matrice sans numéro = ÉCHEC nommé, même si tout le reste part', async () => {
  const deps = makeDeps({
    resolveRecipientsForProfile: async (profileId) => (profileId === 'dg' ? USERS.dg.slice() : []),
  });
  const out = await runRapportHebdo(deps);

  // dg est servi (2 messages), mais le chef, le dt et la rh ne recevront RIEN :
  // des humains non atteints, donc un échec — pas un succès à vide.
  assert.equal(out.success, false, 'une opération de canal qui réussit à vide ne prouve rien');
  assert.equal(deps.calls.docs.length, 2, 'dg reçoit quand même ses 2 cultures');
  assert.equal(deps.calls.alerts.length, 1);
  const texte = deps.calls.alerts[0].bodyParams[0];
  assert.match(texte, /chef_f1/);
  assert.match(texte, /chef_f5/);
  assert.match(texte, /whatsappPhone/);
});

test('zéro destinataire partout → échec ET alerte non délivrable, signalée', async () => {
  const deps = makeDeps({ resolveRecipientsForProfile: async () => [] });
  const out = await runRapportHebdo(deps);
  assert.equal(out.success, false);
  assert.equal(deps.calls.docs.length, 0);
  assert.equal(deps.calls.alerts.length, 0);
  assert.equal(out.alerte.envoyee, false);
  assert.match(out.alerte.error, /aucun destinataire dg/);
});

test('Firestore injoignable : le diagnostic dit PANNE, pas « users mal configuré »', async () => {
  const deps = makeDeps({
    resolveRecipientsForProfile: async () => { throw new Error('DEADLINE_EXCEEDED'); },
  });
  const out = await runRapportHebdo(deps);

  assert.equal(out.success, false);
  assert.equal(out.erreursResolution.length, 5, 'les 5 profils en échec de lecture');
  const texte = out.resume.texte;
  assert.match(texte, /lecture des destinataires en ÉCHEC/);
  assert.match(texte, /DEADLINE_EXCEEDED/);
  assert.match(texte, /PAS une configuration users/,
    'sinon on part chercher la panne dans la mauvaise collection');
});

test('alerte de repli : elle part même quand plus aucun dg n\'est lisible', async () => {
  const deps = makeDeps({
    resolveRecipientsForProfile: async () => { throw new Error('DEADLINE_EXCEEDED'); },
    fallbackAlertPhone: async () => '+212611111111',
  });
  const out = await runRapportHebdo(deps);

  assert.equal(deps.calls.alerts.length, 1, 'la panne ne doit pas rendre le job muet');
  assert.equal(deps.calls.alerts[0].to, '+212611111111');
  assert.equal(deps.calls.alerts[0].template, 'general_alert');
  assert.equal(out.alerte.envoyee, true);
  assert.equal(out.alerte.repli, true);
});

test('le repli n\'est PAS utilisé quand le dg a bien été alerté', async () => {
  const deps = makeDeps({
    buildWorkbook: async () => { throw new Error('boom'); },
    fallbackAlertPhone: async () => '+212611111111',
  });
  await runRapportHebdo(deps, { cultures: ['Framboise'] });
  assert.equal(deps.calls.alerts.length, 1);
  assert.equal(deps.calls.alerts[0].to, USERS.dg[0].phone, 'pas de doublon vers le repli');
});

test('échec d\'envoi pour une personne → alerte nominative, les autres partent', async () => {
  const deps = makeDeps({
    sendTemplateMessageWithDocument: async (to) => {
      if (to === USERS.dt[0].phone) return { success: false, error: 'Template non approuvé' };
      return { success: true, waMessageId: 'wamid' };
    },
  });
  const out = await runRapportHebdo(deps, { cultures: ['Framboise'] });
  assert.equal(out.success, false);
  assert.equal(out.resume.totalEnvoyes, 3);
  assert.equal(out.resume.totalEchecs, 1);
  assert.match(deps.calls.alerts[0].bodyParams[0], /Youssef \(dt\)/);
  assert.match(deps.calls.alerts[0].bodyParams[0], /Template non approuvé/);
});

test('une exception de l\'envoi ne fait pas tomber le job', async () => {
  const deps = makeDeps({
    sendTemplateMessageWithDocument: async () => { throw new Error('socket hang up'); },
  });
  const out = await runRapportHebdo(deps, { cultures: ['Framboise'] });
  assert.equal(out.success, false);
  assert.equal(out.resume.totalEchecs, 4);
  assert.match(deps.calls.alerts[0].bodyParams[0], /socket hang up/);
});

test('checkRecipients : aucune génération, aucun envoi, numéros masqués', async () => {
  const deps = makeDeps();
  const out = await checkRecipients(deps);
  assert.equal(deps.calls.workbooks.length, 0);
  assert.equal(deps.calls.docs.length, 0);
  assert.equal(out.ok, true);
  assert.equal(out.nbEnvoisTotal, 8);
  assert.equal(out.parCulture.Framboise.nbEnvois, 4);
  assert.equal(out.parProfil.dg.count, 1);
  // Masquage complet après l'indicatif : laisser les derniers chiffres rendrait
  // l'énumération triviale sur un préfixe marocain connu.
  assert.equal(out.parProfil.dg.recipients[0].phone, '+212*********');
  assert.ok(!out.parProfil.dg.recipients[0].phone.includes('001'));
});

test('checkRecipients : une culture sans destinataire est signalée AVANT lundi', async () => {
  const deps = makeDeps({
    resolveRecipientsForProfile: async (p) => (p === 'chef_f5' ? USERS.chef_f5.slice() : []),
  });
  const out = await checkRecipients(deps);
  assert.equal(out.ok, false);
  assert.equal(out.parCulture.Framboise.ok, false);
  assert.equal(out.parCulture.Myrtille.ok, true);
});

test('checkRecipients : un profil qui explose n\'empêche pas le diagnostic', async () => {
  const deps = makeDeps({
    resolveRecipientsForProfile: async (p) => {
      if (p === 'dt') throw new Error('Firestore indisponible');
      return (USERS[p] || []).slice();
    },
  });
  const out = await checkRecipients(deps);
  assert.equal(out.parProfil.dt.count, 0);
  assert.equal(out.nbEnvoisTotal, 6);
  // Un profil illisible ≠ un profil vide : le verdict global doit le refuser.
  assert.equal(out.ok, false);
  assert.deepEqual(out.erreursResolution, [{ profileId: 'dt', error: 'Firestore indisponible' }]);
});

test('dryRun : génère les classeurs, n\'envoie RIEN, rend de quoi les inspecter', async () => {
  const deps = makeDeps();
  const out = await dryRun(deps);
  assert.equal(deps.calls.uploads.length, 0);
  assert.equal(deps.calls.docs.length, 0);
  assert.equal(out.cultures.length, 2);
  assert.equal(out.cultures[0].status, 'ok');
  assert.equal(out.cultures[0].nbFeuilles, 24);
  assert.equal(out.cultures[0].nbParcelles, 23);
  assert.ok(out.cultures[0].octets > 0);
  assert.ok(Buffer.isBuffer(out.buffers.Framboise));
});

test('dryRun : une culture qui ne se génère pas est signalée, sans faire tomber l\'autre', async () => {
  const deps = makeDeps({
    buildWorkbook: async ({ culture }) => {
      if (culture === 'Framboise') throw new Error('boom');
      return { fileName: 'm.xlsx', buffer: Buffer.from('X'), nbFeuilles: 3 };
    },
  });
  const out = await dryRun(deps);
  assert.equal(out.cultures[0].status, 'error');
  assert.match(out.cultures[0].error, /boom/);
  assert.equal(out.cultures[1].status, 'ok');
});

// ─────────────────────────────────────────────────────────────────────
// Handler HTTP
// ─────────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    sent: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.sent = b; return this; },
    set(k, v) { this.headers[k] = v; return this; },
  };
}

test('handler ?checkRecipients=1 : ne génère ni n\'envoie rien', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await buildHttpHandler(deps)({ query: { checkRecipients: '1' } }, res);
  assert.equal(res.body.success, true);
  assert.equal(deps.calls.workbooks.length, 0);
  assert.equal(deps.calls.docs.length, 0);
});

test('handler ?dryRun=1 : liste les classeurs et les URLs de récupération', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await buildHttpHandler(deps)({ query: { dryRun: '1' } }, res);
  assert.equal(res.body.dryRun, true);
  assert.equal(deps.calls.docs.length, 0);
  assert.deepEqual(res.body.download, ['?dryRun=1&download=Framboise', '?dryRun=1&download=Myrtille']);
});

test('handler ?dryRun=1&download=Framboise : rend le .xlsx pour la confrontation navigateur', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await buildHttpHandler(deps)({ query: { dryRun: '1', download: 'Framboise' } }, res);
  assert.equal(res.headers['Content-Type'], XLSX_MIME);
  assert.match(res.headers['Content-Disposition'], /Campagne_Framboise\.xlsx/);
  assert.equal(res.sent.toString(), 'XLSX-Framboise');
  assert.equal(deps.calls.docs.length, 0);
});

test('handler ?dryRun=1&download=Inconnue → 404 explicite', async () => {
  const res = makeRes();
  await buildHttpHandler(makeDeps())({ query: { dryRun: '1', download: 'Inconnue' } }, res);
  assert.equal(res.statusCode, 404);
});

test('handler complet : 200 si tout part, 500 si un humain n\'a pas été servi', async () => {
  const ok = makeRes();
  await buildHttpHandler(makeDeps())({ query: { confirm: 'SEND' } }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.success, true);

  const ko = makeRes();
  await buildHttpHandler(makeDeps({ resolveRecipientsForProfile: async () => [] }))(
    { query: { confirm: 'SEND' } }, ko
  );
  assert.equal(ko.statusCode, 500);
  assert.equal(ko.body.success, false);
});

test('handler ?culture= restreint à une culture', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await buildHttpHandler(deps)({ query: { culture: 'Myrtille', confirm: 'SEND' } }, res);
  assert.deepEqual(deps.calls.workbooks.map((w) => w.culture), ['Myrtille']);
});

// ─────────────────────────────────────────────────────────────────────
// Gate du trigger — l'URL d'une CF gen1 est publique (invoker allUsers) :
// sans ces verrous, n'importe qui déclenche les envois et télécharge le
// classeur d'exploitation.
// ─────────────────────────────────────────────────────────────────────

test('GATE : sans authentification, AUCUN classeur, AUCUN envoi', async () => {
  const deps = makeDeps({
    requireAuth: async (req, res) => { res.status(401).json({ success: false, error: 'Non authentifié' }); return null; },
  });
  for (const query of [{}, { confirm: 'SEND' }, { dryRun: '1' }, { dryRun: '1', download: 'Framboise' }, { checkRecipients: '1' }]) {
    const res = makeRes();
    await buildHttpHandler(deps)({ query }, res);
    assert.equal(res.statusCode, 401, JSON.stringify(query));
  }
  assert.equal(deps.calls.workbooks.length, 0, 'aucun classeur produit');
  assert.equal(deps.calls.uploads.length, 0, 'aucun upload Meta');
  assert.equal(deps.calls.docs.length, 0, 'aucun message envoyé');
  assert.equal(deps.calls.alerts.length, 0);
});

test('GATE : un compte authentifié mais non dirigeant est refusé (403)', async () => {
  const deps = makeDeps({ resolveProfile: async () => ({ profileId: 'magasinier', role: null }) });
  for (const query of [{ confirm: 'SEND' }, { dryRun: '1', download: 'Framboise' }, { checkRecipients: '1' }]) {
    const res = makeRes();
    await buildHttpHandler(deps)({ query }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.sent, null, 'aucun octet de classeur servi');
  }
  assert.equal(deps.calls.workbooks.length, 0);
  assert.equal(deps.calls.docs.length, 0);
});

test('GATE : dg, dt et admin passent', async () => {
  for (const profil of [{ profileId: 'dg' }, { profileId: 'dt' }, { profileId: 'autre', role: 'admin' }]) {
    const deps = makeDeps({ resolveProfile: async () => profil });
    const res = makeRes();
    await buildHttpHandler(deps)({ query: { checkRecipients: '1' } }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(profil));
  }
});

test('GATE : l\'URL nue n\'envoie RIEN sans ?confirm=SEND', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await buildHttpHandler(deps)({ query: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /confirm=SEND/);
  assert.equal(deps.calls.workbooks.length, 0);
  assert.equal(deps.calls.docs.length, 0, 'ouvrir le lien « pour voir » ne doit rien expédier');
});

test('GATE : OPTIONS répond 204 sans authentifier ni rien produire', async () => {
  const deps = makeDeps();
  const res = makeRes();
  await buildHttpHandler(deps)({ method: 'OPTIONS', query: {} }, res);
  assert.equal(res.statusCode, 204);
  assert.equal(deps.calls.auth, 0);
});

test('buildHttpHandler : dépendances obligatoires, gate comprise', () => {
  assert.throws(() => buildHttpHandler(null), TypeError);
  assert.throws(() => buildHttpHandler({}), TypeError);
  assert.throws(() => buildHttpHandler({ buildWorkbook: () => {} }), TypeError);
  // Impossible de câbler ce trigger SANS gate, même par inadvertance.
  const sansGate = makeDeps();
  delete sansGate.requireAuth;
  assert.throws(() => buildHttpHandler(sansGate), TypeError);
  const sansProfil = makeDeps();
  delete sansProfil.resolveProfile;
  assert.throws(() => buildHttpHandler(sansProfil), TypeError);
});
