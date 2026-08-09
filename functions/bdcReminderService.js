/**
 * bdcReminderService.js — Core BDC reminder logic, callable from:
 *  - HTTP endpoint (action=remind-bdc in functions/index.js)
 *  - WhatsApp bot (functions/chefBdcBot.js) — à venir
 *
 * Returns { success, error?, statusCode?, profiles?, duration? } and triggers the
 * downstream WhatsApp notification (template `bdc_reminder`, 3 paramètres).
 *
 * Ce fichier ne contient que des I/O : la décision de ciblage, le cooldown 4 h et
 * le format de durée sont purs et testés dans functions/lib/bdc/reminder.js.
 */

const { db } = require("./config/firebase");
const { dispatchNotification } = require("./notificationDispatcher");
const bdcReminder = require("./lib/bdc/reminder");

/**
 * Send a reminder for a pending BDC.
 *
 * @param {object} payload
 * @param {string} payload.id     - BDC id
 * @param {object} [payload.by]   - Auteur du rappel ({uid, profileId, name, …})
 * @param {string} [payload.via]  - "dashboard" | "whatsapp" (audit only)
 * @returns {Promise<{success:boolean,error?:string,statusCode?:number,profiles?:string[],duration?:string}>}
 */
async function remindBdcCore({ id, by, via }) {
  if (!id) return { success: false, statusCode: 400, error: "ID requis" };

  const docRef = db.collection("purchase_orders").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) return { success: false, statusCode: 404, error: "BDC non trouvé" };
  const current = doc.data();

  // Determine target profiles based on current status
  const targets = bdcReminder.resolveReminderTargets(current);
  if (!targets) {
    return { success: false, statusCode: 400, error: `Aucun rappel possible dans le statut "${current.status}"` };
  }
  const { profiles, ferme } = targets;

  // Cooldown: prevent reminders more often than every 4h
  const now = Date.now();
  const cooldown = bdcReminder.reminderCooldown(current.last_reminded_at, now);
  if (cooldown.blocked) {
    return {
      success: false,
      statusCode: 400,
      error: `Rappel déjà envoyé récemment. Patientez encore ${cooldown.hoursLeft}h avant un nouveau rappel.`,
    };
  }

  // Calculate duration
  const lastUpdate = current.updated_at || current.created_at || now;
  const duration = bdcReminder.formatWaitingDuration(lastUpdate, now);

  await dispatchNotification({
    type: "bdc_reminder",
    profiles, ferme,
    data: {
      numero: current.numero || id,
      montant: current.total_ttc ? `${current.total_ttc} MAD` : "—",
      duration,
      message: `Rappel: BDC ${current.numero || id} en attente depuis ${duration}`,
    },
    relatedDoc: `purchase_orders/${id}`,
  });

  // Track reminder
  const history = current.history || [];
  history.push({
    action: "rappel",
    by: by || {},
    at: now,
    comment: `Rappel envoyé à ${profiles.join(", ")} (en attente depuis ${duration})`,
    via: via || "dashboard",
  });
  await docRef.update({
    last_reminded_at: now,
    reminder_count: (current.reminder_count || 0) + 1,
    history,
  });

  return { success: true, profiles, duration };
}

module.exports = { remindBdcCore };
