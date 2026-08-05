'use strict';
// @ts-check

/**
 * reminders.js — Rappels 16h/17h/18h + escalade DG pour la soumission
 * quotidienne des fichiers stock (Berry Good / Bahia).
 *
 * Voir docs/spec-collecte-stock-magasinier.md §4.4. 3 crons distincts dans
 * `functions/index.js` (stockFileReminder16h/17h/18h) appellent tous
 * `sendReminder(slot, opts)` sur l'instance créée par `createStockFileReminders`.
 *
 * Logique PURE isolée dans des fonctions dédiées (`computeMissingFarms`,
 * `buildReminderText`, `buildEscalationText`) — testables en `node:test`
 * sans I/O. L'orchestration (`sendReminder`) reste testable via DI (db +
 * whatsapp injectés, aucun accès direct à firebase-admin/whatsappService).
 *
 * WhatsApp proactif = TOUJOURS un template (`general_alert`), jamais
 * `sendTextMessage` (mémoire `whatsapp-proactif-doit-etre-template`).
 */

const {
  COLLECTION,
  VALID_FARMS,
  FARM_LABELS,
  todayInCasablanca,
  emptySubmissionDoc,
} = require('./recordSubmission');

/**
 * Fermes non soumises pour un doc `stock_file_submissions` donné.
 * @param {Object|null|undefined} doc
 * @returns {string[]} sous-ensemble de VALID_FARMS
 */
function computeMissingFarms(doc) {
  const d = doc || {};
  return VALID_FARMS.filter((farm) => !(d[farm] && d[farm].submitted));
}

/**
 * Texte du rappel envoyé au(x) magasinier(s) pour UNE ferme manquante.
 * @param {string} slot "16h"|"17h"|"18h"
 * @param {string} farmLabel ex. "Berry Good"
 * @returns {string}
 */
function buildReminderText(slot, farmLabel) {
  return `Rappel ${slot} : fichier stock ${farmLabel} pas encore reçu aujourd'hui.`;
}

/**
 * Texte de l'escalade DG à 18h si au moins une ferme reste manquante après
 * le rappel.
 * @param {string[]} missingLabels ex. ["Berry Good", "Bahia"]
 * @returns {string}
 */
function buildEscalationText(missingLabels) {
  const list = (missingLabels || []).join(' et ');
  return `Fichier(s) stock manquant(s) à 18h : ${list}. Le magasinier n'a pas soumis via l'app ni WhatsApp.`;
}

/**
 * Crée l'orchestrateur de rappels, dépendances injectées (aucun accès direct
 * à firebase-admin/whatsappService — testable en `node:test` avec des stubs).
 *
 * @param {{
 *   db: Object,
 *   whatsapp: {
 *     resolveRecipientsForProfile: (profileId: string, ferme: any) => Promise<Array<{phone: string}>>,
 *     sendTemplateMessage: (phone: string, templateName: string, bodyParams: string[]) => Promise<any>,
 *     toSingleLine: (s: string) => string,
 *   },
 *   serverTimestamp?: () => any,
 *   now?: () => Date,
 * }} deps
 */
function createStockFileReminders(deps) {
  const db = deps && deps.db;
  const whatsapp = deps && deps.whatsapp;
  const serverTimestamp = (deps && deps.serverTimestamp) || (() => Date.now());
  const nowFn = (deps && deps.now) || (() => new Date());

  if (!db) throw new Error('createStockFileReminders: db requis');
  if (!whatsapp) throw new Error('createStockFileReminders: whatsapp requis');

  /**
   * @param {string} slot "16h"|"17h"|"18h"
   * @param {{escalateToDg?: boolean}} [opts]
   * @returns {Promise<{success: boolean, date?: string, missing?: string[], escalated?: boolean, error?: string}>}
   */
  async function sendReminder(slot, opts) {
    const escalateToDg = !!(opts && opts.escalateToDg);
    const date = todayInCasablanca(nowFn());
    try {
      const docRef = db.collection(COLLECTION).doc(date);
      const snap = await docRef.get();
      const doc = snap.exists ? snap.data() : emptySubmissionDoc(date);

      const missing = computeMissingFarms(doc);

      if (missing.length) {
        const recipients = await whatsapp.resolveRecipientsForProfile('magasinier', null);
        if (!recipients || !recipients.length) {
          // Ne jamais échouer silencieusement (mémoire pipeline-pointage-bdr-panne-silencieuse) :
          // si personne n'est configuré côté profil magasinier, le rappel part à personne.
          console.error(
            `[stockFileReminders] Aucun destinataire WhatsApp profileId="magasinier" pour le rappel ${slot} (${date}). ` +
            'Vérifier users.profileId="magasinier" + whatsappEnabled=true + whatsappPhone renseigné.'
          );
        } else {
          for (const farm of missing) {
            const text = buildReminderText(slot, FARM_LABELS[farm] || farm);
            await Promise.all(
              recipients.map((r) => whatsapp.sendTemplateMessage(r.phone, 'general_alert', [whatsapp.toSingleLine(text)]))
            );
          }
        }
      }

      const now = serverTimestamp();
      const updates = { reminders_sent: { [slot]: true }, updated_at: now };

      let escalated = false;
      if (escalateToDg && missing.length) {
        const dgRecipients = await whatsapp.resolveRecipientsForProfile('dg', null);
        if (!dgRecipients || !dgRecipients.length) {
          console.error(`[stockFileReminders] Aucun destinataire WhatsApp profileId="dg" pour l'escalade 18h (${date}).`);
        } else {
          const missingLabels = missing.map((f) => FARM_LABELS[f] || f);
          const text = buildEscalationText(missingLabels);
          await Promise.all(
            dgRecipients.map((r) => whatsapp.sendTemplateMessage(r.phone, 'general_alert', [whatsapp.toSingleLine(text)]))
          );
          updates.missing_alert_sent_at = now;
          escalated = true;
        }
      }

      await docRef.set(updates, { merge: true });

      return { success: true, date, missing, escalated };
    } catch (err) {
      // Jamais laisser un cron planter sans log (pattern dailyProductionDigest).
      console.error(`[stockFileReminders] sendReminder(${slot}) error:`, err && err.message);
      return { success: false, error: err && err.message };
    }
  }

  return { sendReminder };
}

module.exports = {
  computeMissingFarms,
  buildReminderText,
  buildEscalationText,
  createStockFileReminders,
};
