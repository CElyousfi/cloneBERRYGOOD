/**
 * campagneRapportHebdo/runJob — orchestration du rapport Campagne hebdomadaire.
 *
 * Toutes les dépendances (génération du classeur, WhatsApp, horloge) sont
 * INJECTÉES : functions/index.js ne fait que le câblage Firebase, et les tests
 * prouvent le comportement sans émulateur, sans réseau et sans le moindre
 * message réel.
 *
 * Principe directeur : ÉCHOUER BRUYAMMENT plutôt qu'envoyer un fichier faux.
 * Un classeur qui ne se produit pas → on alerte, on n'envoie pas. Une culture
 * sans destinataire joignable → c'est un échec, pas un succès à vide.
 */
// @ts-check
'use strict';

const C = require('./constants');
const E = require('./envois');

/**
 * @typedef {Object} RunDeps
 * @property {(params: {culture: string, fermeFilter: null}) => Promise<{fileName: string, buffer: Buffer, nbFeuilles: number}>} buildWorkbook
 * @property {(profileId: string, ferme: null) => Promise<Array<{phone: string, displayName?: string, uid?: string}>>} resolveRecipientsForProfile
 * @property {(buffer: Buffer, mime: string, fileName: string) => Promise<{id?: string, error?: string}>} uploadMedia
 * @property {(to: string, template: string, ref: {mediaId: string}, fileName: string, bodyParams: Array<string>, lang: undefined, toName: string) => Promise<{success: boolean, error?: string, waMessageId?: string}>} sendTemplateMessageWithDocument
 * @property {(to: string, template: string, bodyParams: Array<string>) => Promise<{success: boolean, error?: string}>} sendTemplateMessage
 * @property {() => Promise<string|null>} [fallbackAlertPhone] numéro de repli
 *   quand l'alerte n'a plus aucun destinataire (cf. config/whatsapp).
 * @property {(s: *) => string} [toSingleLine]
 * @property {() => Date} [now]
 * @property {(msg: string, ctx?: *) => void} [logger]
 */

/**
 * Résout, UNE seule fois par profil, les destinataires de la matrice (+ le
 * profil d'alerte). `ferme = null` : le périmètre est la culture entière.
 *
 * ⚠️ Les erreurs de résolution sont CONSERVÉES et remontées : un Firestore
 * indisponible donne 0 destinataire partout, ce qui, sans cette information,
 * se raconterait comme « personne n'a de whatsappPhone » et enverrait chercher
 * la panne dans la collection `users`. On distingue « mal configuré » de
 * « injoignable ».
 *
 * @param {RunDeps} deps
 * @param {Record<string, ReadonlyArray<string>>} [audience]
 * @returns {Promise<{recipientsByProfile: Record<string, Array<{phone: string, displayName?: string, uid?: string}>>,
 *                    erreurs: Array<{profileId: string, error: string}>}>}
 */
async function resolveRecipientsByProfile(deps, audience) {
  const aud = audience || C.AUDIENCE;
  const profils = new Set();
  Object.keys(aud).forEach((culture) => (aud[culture] || []).forEach((p) => profils.add(p)));
  profils.add(C.ALERT_PROFILE_ID);

  /** @type {Record<string, Array<{phone: string, displayName?: string, uid?: string}>>} */
  const recipientsByProfile = {};
  /** @type {Array<{profileId: string, error: string}>} */
  const erreurs = [];
  const noms = Array.from(profils);
  const resolus = await Promise.all(
    noms.map(async (p) => {
      try {
        return await deps.resolveRecipientsForProfile(p, null);
      } catch (err) {
        return { __error: err && err.message ? err.message : String(err) };
      }
    })
  );
  noms.forEach((p, i) => {
    const r = resolus[i];
    if (Array.isArray(r)) {
      recipientsByProfile[p] = r;
    } else {
      recipientsByProfile[p] = [];
      erreurs.push({ profileId: p, error: (r && r.__error) || 'erreur inconnue' });
    }
  });
  return { recipientsByProfile: recipientsByProfile, erreurs: erreurs };
}

/**
 * Mode `?checkRecipients=1` — AUCUN envoi, aucune génération : rend la liste
 * résolue par profil et le nombre d'envois qui partiraient par culture. C'est
 * ce qui permet de vérifier AVANT lundi que les 5 profils de la matrice ont un
 * `whatsappPhone` et `whatsappEnabled: true` dans `users`.
 *
 * @param {RunDeps} deps
 * @returns {Promise<*>}
 */
async function checkRecipients(deps) {
  const { recipientsByProfile, erreurs } = await resolveRecipientsByProfile(deps);
  const envois = E.buildEnvois({ audience: C.AUDIENCE, recipientsByProfile });

  const parProfil = {};
  Object.keys(recipientsByProfile).forEach((p) => {
    parProfil[p] = {
      count: recipientsByProfile[p].length,
      recipients: recipientsByProfile[p].map((r) => ({
        uid: r.uid || null,
        displayName: r.displayName || null,
        phone: maskPhone(r.phone),
      })),
    };
  });

  const parCulture = {};
  Object.keys(C.AUDIENCE).forEach((culture) => {
    const pour = envois.filter((e) => e.culture === culture);
    parCulture[culture] = {
      profils: C.AUDIENCE[culture].slice(),
      nbEnvois: pour.length,
      // Une culture à 0 envoi PARTIRAIT en échec lundi : le dire ici, pas après.
      ok: pour.length > 0,
      destinataires: pour.map((e) => ({
        profileId: e.profileId,
        displayName: e.displayName || null,
        phone: maskPhone(e.phone),
      })),
    };
  });

  return {
    audience: C.AUDIENCE,
    parProfil: parProfil,
    parCulture: parCulture,
    nbEnvoisTotal: envois.length,
    // Une résolution en échec (Firestore injoignable) n'est PAS un problème de
    // configuration : le diagnostic doit le dire, sinon on cherche au mauvais
    // endroit dans `users`.
    erreursResolution: erreurs,
    ok: erreurs.length === 0 && Object.keys(parCulture).every((c) => parCulture[c].ok),
  };
}

/**
 * Masque un numéro pour une réponse HTTP de diagnostic : on ne montre que la
 * longueur et les 4 premiers caractères (indicatif pays). Laisser les derniers
 * chiffres visibles rendrait l'énumération triviale sur un préfixe marocain.
 */
function maskPhone(p) {
  const s = String(p || '');
  if (!s) return null;
  return s.slice(0, 4) + '*'.repeat(Math.max(0, s.length - 4));
}

/**
 * Génère les classeurs SANS RIEN ENVOYER (`?dryRun=1`).
 * Rend de quoi inspecter/récupérer chaque fichier (taille, feuilles, buffer).
 *
 * @param {RunDeps} deps
 * @param {{cultures?: Array<string>}} [options]
 * @returns {Promise<{dryRun: true, cultures: Array<*>, buffers: Record<string, Buffer>}>}
 */
async function dryRun(deps, options) {
  const cultures = (options && options.cultures) || Object.keys(C.AUDIENCE);
  const out = [];
  /** @type {Record<string, Buffer>} */
  const buffers = {};

  for (const culture of cultures) {
    try {
      const wb = await deps.buildWorkbook({ culture: culture, fermeFilter: null });
      if (!wb || !wb.buffer || !wb.buffer.length) {
        out.push({ culture: culture, status: 'error', error: 'classeur vide' });
        continue;
      }
      buffers[culture] = wb.buffer;
      out.push({
        culture: culture,
        status: 'ok',
        fileName: wb.fileName,
        octets: wb.buffer.length,
        nbFeuilles: wb.nbFeuilles,
        nbParcelles: E.nbParcellesFromFeuilles(wb.nbFeuilles),
      });
    } catch (err) {
      out.push({ culture: culture, status: 'error', error: err && err.message ? err.message : String(err) });
    }
  }

  return { dryRun: true, cultures: out, buffers: buffers };
}

/**
 * Exécution complète : un classeur par culture, UN SEUL upload par culture
 * (le media_id vaut 30 jours et est réutilisé pour tous ses destinataires),
 * puis un message par destinataire. Alerte WhatsApp au profil `dg` si le
 * résultat n'est pas un succès complet.
 *
 * @param {RunDeps} deps
 * @param {{cultures?: Array<string>}} [options]
 * @returns {Promise<*>}
 */
async function runRapportHebdo(deps, options) {
  const logger = deps.logger || function () {};
  const toSingleLine = deps.toSingleLine || ((s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim());
  const now = deps.now || (() => new Date());
  const cultures = (options && options.cultures) || Object.keys(C.AUDIENCE);
  const dateLabel = E.formatDateLabel(now(), C.CRON_CONFIG.timeZone);

  const { recipientsByProfile, erreurs: erreursResolution } = await resolveRecipientsByProfile(deps);
  const tousEnvois = E.buildEnvois({ audience: C.AUDIENCE, recipientsByProfile });

  /** @type {Array<*>} */
  const resultats = [];

  for (const culture of cultures) {
    const envoisCulture = tousEnvois.filter((e) => e.culture === culture);
    // Profils de la matrice sans AUCUN destinataire joignable : le chef (ou le
    // RH) concerné ne recevra rien. C'est un humain non atteint, donc un échec,
    // même si tous les messages effectivement émis partent bien.
    const profilsManquants = (C.AUDIENCE[culture] || [])
      .filter((p) => ((recipientsByProfile[p] || []).length === 0));

    // 0. Personne à servir : ni génération, ni upload. Produire un classeur et
    //    le pousser chez Meta pour ne l'envoyer à personne coûte du temps, du
    //    quota et laisse un media_id orphelin.
    if (envoisCulture.length === 0) {
      resultats.push({ culture, status: 'ok', envois: [], profilsManquants: profilsManquants });
      continue;
    }

    // 1. Le classeur. Une exception ici (campagne invalide, données absentes)
    //    NE DOIT PAS produire un fichier dégradé : on n'envoie rien pour cette
    //    culture et on alerte.
    let wb;
    try {
      wb = await deps.buildWorkbook({ culture: culture, fermeFilter: null });
    } catch (err) {
      resultats.push({ culture, status: 'error', error: 'génération: ' + (err && err.message ? err.message : String(err)), envois: [] });
      continue;
    }
    if (!wb || !wb.buffer || !wb.buffer.length) {
      resultats.push({ culture, status: 'error', error: 'génération: classeur vide', envois: [] });
      continue;
    }
    // Un classeur réduit à sa feuille Synthèse annoncerait « 0 parcelles » :
    // c'est un rapport vide, qui se lit comme une information (« il n'y a rien
    // eu cette semaine ») alors que c'est une panne de données. Même verdict
    // que le classeur vide : on alerte, on n'envoie pas.
    const nbParcelles = E.nbParcellesFromFeuilles(wb.nbFeuilles);
    if (nbParcelles === 0) {
      resultats.push({
        culture,
        status: 'error',
        error: 'génération: classeur sans aucune parcelle (' + wb.nbFeuilles + ' feuille(s))',
        envois: [],
      });
      continue;
    }

    // 2. Un SEUL upload par culture — le media_id est réutilisé pour tous les
    //    destinataires (N envois, 1 upload).
    const up = await deps.uploadMedia(wb.buffer, C.XLSX_MIME, wb.fileName);
    if (!up || !up.id) {
      resultats.push({
        culture,
        status: 'error',
        error: 'upload: ' + ((up && up.error) || 'media_id absent'),
        envois: [],
      });
      continue;
    }

    // 3. Un message par destinataire.
    const bodyParams = E.buildBodyParams({
      culture: culture,
      dateLabel: dateLabel,
      nbParcelles: nbParcelles,
    });
    const envoyes = [];
    for (const envoi of envoisCulture) {
      let res;
      try {
        res = await deps.sendTemplateMessageWithDocument(
          envoi.phone,
          C.TEMPLATE_NAME,
          { mediaId: up.id },
          wb.fileName,
          bodyParams,
          undefined,
          envoi.displayName
        );
      } catch (err) {
        res = { success: false, error: err && err.message ? err.message : String(err) };
      }
      envoyes.push({
        phone: envoi.phone,
        profileId: envoi.profileId,
        displayName: envoi.displayName,
        success: !!(res && res.success),
        error: res && res.success ? undefined : (res && res.error) || 'erreur inconnue',
      });
    }

    resultats.push({
      culture,
      status: 'ok',
      fileName: wb.fileName,
      octets: wb.buffer.length,
      nbFeuilles: wb.nbFeuilles,
      mediaId: up.id,
      envois: envoyes,
      profilsManquants: profilsManquants,
    });
  }

  const resume = E.resumeEnvois(resultats, { erreursResolution: erreursResolution });
  logger('[campagneRapportHebdo] ' + resume.texte);

  // 4. Alerte — canal établi du repo : general_alert (1 SEUL paramètre, et
  //    Meta rejette les retours ligne) vers les destinataires du profil dg.
  let alertesEnvoyees = 0;
  let alerteError = null;
  let alerteRepli = false;
  if (resume.alerte) {
    const texteAlerte = toSingleLine(resume.texte);
    const destAlerte = recipientsByProfile[C.ALERT_PROFILE_ID] || [];
    for (const r of destAlerte) {
      try {
        const res = await deps.sendTemplateMessage(r.phone, C.ALERT_TEMPLATE_NAME, [texteAlerte]);
        if (res && res.success) alertesEnvoyees += 1;
        else alerteError = (res && res.error) || 'échec envoi alerte';
      } catch (err) {
        alerteError = err && err.message ? err.message : String(err);
      }
    }

    // NUMÉRO DE REPLI — le cas qui rend ce job muet est précisément celui où
    // l'alerte n'a plus de destinataire : Firestore injoignable, ou plus aucun
    // `dg` avec whatsappPhone. La panne serait alors invisible jusqu'au lundi
    // suivant. On tente donc un numéro de repli, indépendant de la collection
    // `users` (cf. config/whatsapp.alert_fallback_phone).
    if (alertesEnvoyees === 0 && typeof deps.fallbackAlertPhone === 'function') {
      let repli = null;
      try {
        repli = await deps.fallbackAlertPhone();
      } catch (err) {
        alerteError = 'repli indisponible: ' + (err && err.message ? err.message : String(err));
      }
      if (repli) {
        try {
          const res = await deps.sendTemplateMessage(repli, C.ALERT_TEMPLATE_NAME, [texteAlerte]);
          if (res && res.success) {
            alertesEnvoyees += 1;
            alerteRepli = true;
          } else {
            alerteError = (res && res.error) || 'échec envoi alerte (repli)';
          }
        } catch (err) {
          alerteError = err && err.message ? err.message : String(err);
        }
      }
    }

    if (alertesEnvoyees === 0) {
      alerteError = alerteError
        || 'aucun destinataire ' + C.ALERT_PROFILE_ID + ' joignable et aucun numéro de repli configuré';
      // Dernier filet : une trace explicite, la seule chose qui reste quand
      // WhatsApp ne peut plus rien porter.
      logger('[campagneRapportHebdo] ALERTE NON DÉLIVRÉE: ' + alerteError + ' — ' + resume.texte);
    }
  }

  return {
    success: !resume.alerte,
    date: dateLabel,
    resume: resume,
    cultures: resultats,
    erreursResolution: erreursResolution,
    alerte: resume.alerte
      ? {
        envoyee: alertesEnvoyees > 0,
        destinataires: alertesEnvoyees,
        repli: alerteRepli,
        error: alertesEnvoyees > 0 && !alerteError ? null : alerteError,
      }
      : null,
  };
}

/**
 * Handler HTTP du trigger jumeau.
 *
 * ⚠️ GATE — une Cloud Function gen1 `https.onRequest` est déployée avec
 * l'invoker `allUsers` : son URL est joignable par n'importe qui, sans compte.
 * Or ce trigger DÉCLENCHE des envois WhatsApp réels et SERT le classeur
 * d'exploitation complet. Trois verrous, sur le modèle de
 * `runDailyPhenologyJobNow` (requireAuth injecté) et des triggers sensibles du
 * repo (`confirm=LIVE`) :
 *   1. `deps.requireAuth` OBLIGATOIRE (TypeError s'il manque : impossible de
 *      câbler ce handler sans gate, même par inadvertance) ;
 *   2. profil du caller restreint à TRIGGER_PROFILES — être authentifié ne
 *      suffit pas, un ouvrier ne télécharge pas le rapport de campagne ;
 *   3. `?confirm=SEND` obligatoire pour le chemin d'ENVOI RÉEL : sans lui,
 *      ouvrir l'URL nue « pour voir » expédierait 8 messages aux dirigeants.
 *
 * Modes :
 *   ?checkRecipients=1        → aucun envoi, liste résolue par profil
 *   ?dryRun=1                 → génère les classeurs, n'envoie rien
 *   ?dryRun=1&download=<cult> → renvoie le .xlsx de la culture (confrontation
 *                               serveur ↔ navigateur)
 *   ?confirm=SEND             → exécution complète (envois réels)
 *   ?culture=Framboise        → restreint à une culture
 *
 * @param {RunDeps & {requireAuth: (req, res) => Promise<*>,
 *                    resolveProfile: (user: *) => Promise<{profileId: (string|null), role: (string|null)}>,
 *                    setCors?: (res: *, req: *) => void}} deps
 * @returns {(req: *, res: *) => Promise<void>}
 */
function buildHttpHandler(deps) {
  if (!deps || typeof deps.buildWorkbook !== 'function' || typeof deps.resolveRecipientsForProfile !== 'function') {
    throw new TypeError('buildHttpHandler: deps.buildWorkbook + deps.resolveRecipientsForProfile requis');
  }
  if (typeof deps.requireAuth !== 'function' || typeof deps.resolveProfile !== 'function') {
    throw new TypeError('buildHttpHandler: deps.requireAuth + deps.resolveProfile requis (le trigger déclenche des envois réels)');
  }
  const setCors = deps.setCors || function () {};
  return async function handler(req, res) {
    const q = (req && req.query) || {};
    const cultures = q.culture ? [String(q.culture)] : undefined;
    setCors(res, req);
    if (req && req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    try {
      // Verrou 1 — authentification Firebase (requireAuth a déjà répondu 401).
      const user = await deps.requireAuth(req, res);
      if (!user) return;

      // Verrou 2 — profil dirigeant uniquement, résolu SERVEUR (users/{uid}),
      // jamais depuis la requête.
      /** @type {any} */ // le `|| {}` defensif efface la forme documentee par le @param ci-dessus
      const profil = (await deps.resolveProfile(user)) || {};
      const autorise = C.TRIGGER_PROFILES.indexOf(profil.profileId) !== -1 || profil.role === 'admin';
      if (!autorise) {
        res.status(403).json({ success: false, error: 'Accès non autorisé' });
        return;
      }

      if (q.checkRecipients === '1' || q.checkRecipients === 'true') {
        const out = await checkRecipients(deps);
        res.json(Object.assign({ success: true }, out));
        return;
      }
      if (q.dryRun === '1' || q.dryRun === 'true') {
        const out = await dryRun(deps, { cultures: cultures });
        const wanted = q.download ? String(q.download) : null;
        if (wanted) {
          const buf = out.buffers[wanted];
          if (!buf) {
            res.status(404).json({ success: false, error: 'aucun classeur pour la culture ' + wanted, cultures: out.cultures });
            return;
          }
          const info = out.cultures.find((c) => c.culture === wanted) || {};
          res.set('Content-Type', C.XLSX_MIME);
          res.set('Content-Disposition', 'attachment; filename="' + (info.fileName || 'campagne.xlsx') + '"');
          res.send(buf);
          return;
        }
        res.json({
          success: out.cultures.every((c) => c.status === 'ok'),
          dryRun: true,
          cultures: out.cultures,
          // Rappel du chemin de récupération pour la confrontation exigée par la PR #251.
          download: out.cultures
            .filter((c) => c.status === 'ok')
            .map((c) => '?dryRun=1&download=' + encodeURIComponent(c.culture)),
        });
        return;
      }
      // Verrou 3 — l'envoi réel se confirme explicitement.
      if (q.confirm !== C.CONFIRM_SEND) {
        res.status(400).json({
          success: false,
          error: 'Envoi réel non confirmé : ajouter ?confirm=' + C.CONFIRM_SEND
            + ' (ou utiliser ?dryRun=1 / ?checkRecipients=1 pour vérifier sans envoyer)',
        });
        return;
      }
      const out = await runRapportHebdo(deps, { cultures: cultures });
      res.status(out.success ? 200 : 500).json(out);
    } catch (err) {
      res.status(500).json({ success: false, error: err && err.message ? err.message : String(err) });
    }
  };
}

module.exports = {
  resolveRecipientsByProfile,
  checkRecipients,
  dryRun,
  runRapportHebdo,
  buildHttpHandler,
  maskPhone,
};
