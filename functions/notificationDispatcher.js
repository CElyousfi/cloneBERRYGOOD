/**
 * notificationDispatcher.js — Unified notification dispatcher.
 *
 * Orchestrates sending notifications across multiple channels:
 * - In-app alerts (Firestore `alerts` collection)
 * - WhatsApp (Meta Cloud API via whatsappService)
 *
 * All dispatches are fire-and-forget to avoid blocking API responses.
 */

const { db } = require("./config/firebase");
const whatsapp = require("./whatsappService");

/**
 * Template mapping: notification type → WhatsApp template name + param builder.
 * Each entry maps a notification type to:
 *   - template: the registered Meta template name
 *   - params: function(data) → array of string values for template body params
 */
const TEMPLATE_MAP = {
  bdc_submit: {
    template: "bdc_validation_needed",
    params: (d) => [d.numero || "—", d.description || "Aucune description", d.montant || "Non précisé"],
  },
  bdc_chef_approved: {
    template: "bdc_chef_approved",
    params: (d) => [d.numero || "—"],
  },
  bdc_dg_approved: {
    template: "bdc_dg_approved",
    params: (d) => [d.numero || "—", d.description || "Aucune description", d.montant || "Non précisé"],
  },
  bdc_rejected: {
    template: "bdc_rejected",
    params: (d) => [d.numero || "—", d.motif || "Aucun motif précisé"],
  },
  bdc_sent_to_supplier: {
    template: "bdc_sent_to_supplier",
    params: (d) => [d.numero || "—", d.supplier || "Fournisseur inconnu"],
  },
  bdc_virement_launched: {
    template: "bdc_virement_update",
    params: (d) => [d.numero || "—", "Virement lancé"],
  },
  bdc_virement_signed: {
    template: "bdc_virement_update",
    params: (d) => [d.numero || "—", "Virement signé"],
  },
  pointage_validation: {
    template: "pointage_validation_needed",
    params: (d) => [d.date || "—", d.ferme || "—"],
  },
  quality_alert: {
    template: "quality_alert",
    params: (d) => [d.message || "Nouvelle alerte qualité"],
  },
  general_alert: {
    template: "general_alert",
    params: (d) => [d.message || "Nouvelle notification"],
  },
  welcome: {
    template: "welcome_smartberry",
    params: (d) => [d.displayName || d.name || "utilisateur"],
  },
  expedition_rejected: {
    template: "expedition_rejected",
    params: (d) => [
      d.receiptId || "—",
      d.dateTime || "—",
      d.variety || "—",
      d.ranch || "—",
      d.weightKg || "0",
      d.reason || "Non précisé",
    ],
  },
  bdc_reminder: {
    template: "bdc_reminder",
    params: (d) => [d.numero || "—", d.montant || "—", d.duration || "quelques jours"],
  },
};

/**
 * Dispatch a notification to one or more profiles.
 *
 * @param {object} opts
 * @param {string} opts.type - Notification type (key in TEMPLATE_MAP)
 * @param {string[]} opts.profiles - Profile IDs to notify (e.g. ["chef", "dg"])
 * @param {string} [opts.ferme] - Farm filter (for chef profiles)
 * @param {object} opts.data - Data for template params and alert message
 * @param {string} [opts.data.message] - Human-readable message for in-app alert
 * @param {string[]} [opts.channels] - Channels to use (default: ["in_app", "whatsapp"])
 * @param {string} [opts.relatedDoc] - Related Firestore document path for logging
 */
async function dispatchNotification({ type, profiles, ferme, data, channels, relatedDoc }) {
  const activeChannels = channels || ["in_app", "whatsapp"];

  const promises = [];
  const willSendWhatsApp = activeChannels.includes("whatsapp") && !!TEMPLATE_MAP[type];

  // In-app alert (marked so onAlertCreated trigger doesn't re-send WhatsApp)
  if (activeChannels.includes("in_app") && data.message) {
    promises.push(createInAppAlert(type, profiles, data.message, data.severity, willSendWhatsApp));
  }

  // WhatsApp
  if (willSendWhatsApp) {
    const mapping = TEMPLATE_MAP[type];
    promises.push(sendWhatsAppToProfiles(profiles, ferme, mapping, data, relatedDoc));
  }

  // Execute all channels in parallel, catch errors silently
  await Promise.allSettled(promises);
}

/**
 * Create an in-app alert in the `alerts` collection.
 * Marks the alert with `whatsapp_dispatched: true` if the dispatcher is also
 * sending WhatsApp itself, so the onAlertCreated trigger doesn't re-send.
 */
async function createInAppAlert(type, profiles, message, severity, whatsappDispatched) {
  try {
    await db.collection("alerts").add({
      type,
      message,
      profiles,
      severity: severity || "info",
      createdAt: Date.now(),
      read: {},
      whatsapp_dispatched: !!whatsappDispatched,
    });
  } catch (err) {
    console.error("Failed to create in-app alert:", err.message);
  }
}

/**
 * Send WhatsApp template messages to all users matching the given profiles.
 */
async function sendWhatsAppToProfiles(profiles, ferme, mapping, data, relatedDoc) {
  try {
    // Resolve all recipients across all target profiles
    const recipientSets = await Promise.all(
      profiles.map(p => whatsapp.resolveRecipientsForProfile(p, ferme))
    );
    const allRecipients = recipientSets.flat();

    // Deduplicate by phone number
    const seen = new Set();
    const unique = allRecipients.filter(r => {
      if (seen.has(r.phone)) return false;
      seen.add(r.phone);
      return true;
    });

    if (unique.length === 0) return;

    const bodyParams = mapping.params(data);

    // Send to all recipients in parallel
    const results = await Promise.allSettled(
      unique.map(async (recipient) => {
        const result = await whatsapp.sendTemplateMessage(
          recipient.phone,
          mapping.template,
          bodyParams,
          undefined,
          recipient.displayName
        );
        // Update log with related doc reference
        if (relatedDoc && result.success) {
          try {
            const logSnap = await db.collection("whatsapp_logs")
              .where("waMessageId", "==", result.waMessageId)
              .limit(1).get();
            if (!logSnap.empty) {
              await logSnap.docs[0].ref.update({ relatedDoc, profile: recipient.profileId });
            }
          } catch (_) {}
        }
        return result;
      })
    );

    const sent = results.filter(r => r.status === "fulfilled" && r.value?.success).length;
    const failed = results.length - sent;
    if (failed > 0) {
      console.warn(`WhatsApp dispatch [${mapping.template}]: ${sent} sent, ${failed} failed`);
    }
  } catch (err) {
    console.error("WhatsApp dispatch error:", err.message);
  }
}

module.exports = { dispatchNotification, TEMPLATE_MAP };
