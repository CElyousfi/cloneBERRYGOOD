/**
 * whatsappService.js — WhatsApp Business Cloud API integration.
 *
 * Uses Meta Cloud API (graph.facebook.com) to send template messages.
 * Config is read from Firestore document `config/whatsapp`.
 * No npm dependency needed — Node 20 native fetch.
 */

const { db } = require("./config/firebase");

// Cache config for 5 minutes to avoid repeated Firestore reads
let _configCache = null;
let _configCacheTime = 0;
const CONFIG_TTL = 5 * 60 * 1000;

/**
 * Read WhatsApp config from Firestore `config/whatsapp`.
 * Returns { phone_number_id, access_token, enabled, default_language }
 */
async function getWhatsAppConfig() {
  if (_configCache && Date.now() - _configCacheTime < CONFIG_TTL) {
    return _configCache;
  }
  const doc = await db.collection("config").doc("whatsapp").get();
  if (!doc.exists) return null;
  _configCache = doc.data();
  _configCacheTime = Date.now();
  return _configCache;
}

/**
 * Normalize a Moroccan phone number to E.164 format (+212...).
 * Handles: 06xx, 07xx, +212xx, 212xx, 00212xx
 */
function formatPhoneE164(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[\s\-\.\(\)]/g, "");
  // Remove leading 00
  if (cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  // Add + if starts with 212
  if (cleaned.startsWith("212") && !cleaned.startsWith("+")) cleaned = "+" + cleaned;
  // Convert local 0x to +212x
  if (cleaned.startsWith("0") && !cleaned.startsWith("+")) {
    cleaned = "+212" + cleaned.slice(1);
  }
  // Validate basic format
  if (!cleaned.startsWith("+212") || cleaned.length < 13) return null;
  return cleaned;
}

/**
 * Send a template message via Meta Cloud API.
 * @param {string} to - Phone number in E.164 format
 * @param {string} templateName - Registered template name
 * @param {Array} bodyParams - Array of string values for template body parameters
 * @param {string} [lang] - Template language code (default: "fr")
 * @returns {object} { success, waMessageId } or { success: false, error }
 */
async function sendTemplateMessage(to, templateName, bodyParams = [], lang, toName) {
  const config = await getWhatsAppConfig();
  if (!config || !config.enabled) {
    return { success: false, error: "WhatsApp non configuré ou désactivé" };
  }

  const phone = formatPhoneE164(to);
  if (!phone) {
    return { success: false, error: "Numéro invalide: " + to };
  }

  const language = lang || config.default_language || "fr";
  const components = [];
  if (bodyParams.length > 0) {
    // Meta rejects empty string params with error 131008. Replace any empty/null/undefined
    // value with "—" as a defensive last line of defense before sending to the API.
    const sanitized = bodyParams.map(text => {
      const str = String(text ?? "").trim();
      return { type: "text", text: str || "—" };
    });
    components.push({ type: "body", parameters: sanitized });
  }

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      console.error(`WhatsApp send failed [${templateName}] to ${phone}:`, errMsg);
      await logMessage(phone, templateName, null, "failed", errMsg, null, bodyParams, toName);
      return { success: false, error: errMsg };
    }

    const waMessageId = data.messages?.[0]?.id || null;
    await logMessage(phone, templateName, null, "sent", null, waMessageId, bodyParams, toName);
    return { success: true, waMessageId };
  } catch (err) {
    console.error(`WhatsApp send error [${templateName}] to ${phone}:`, err.message);
    await logMessage(phone, templateName, null, "failed", err.message, null, null, toName);
    return { success: false, error: err.message };
  }
}

/**
 * Send a free-form text message (only within 24h session window).
 */
async function sendTextMessage(to, text) {
  const config = await getWhatsAppConfig();
  if (!config || !config.enabled) return { success: false, error: "WhatsApp désactivé" };

  const phone = formatPhoneE164(to);
  if (!phone) return { success: false, error: "Numéro invalide" };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: text },
        }),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      return { success: false, error: data.error?.message || "Erreur WhatsApp" };
    }
    return { success: true, waMessageId: data.messages?.[0]?.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Find all WhatsApp-enabled users for a given profile and optional farm.
 * @param {string} profileId - e.g. "chef", "dg", "achats", "finance"
 * @param {string} [ferme] - Optional farm filter (for chef profiles)
 * @returns {Array<{uid, displayName, phone}>}
 */
async function resolveRecipientsForProfile(profileId, ferme) {
  let query = db.collection("users")
    .where("profileId", "==", profileId)
    .where("whatsappEnabled", "==", true);

  const snap = await query.get();
  const recipients = [];

  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.disabled) continue;
    if (!d.whatsappPhone) continue;
    // For chef profile, filter by farm if specified
    if (ferme && profileId === "chef" && d.ferme && d.ferme !== ferme) continue;
    const phone = formatPhoneE164(d.whatsappPhone);
    if (phone) {
      recipients.push({ uid: doc.id, displayName: d.displayName || "", phone });
    }
  }
  return recipients;
}

/**
 * Log a WhatsApp message to Firestore for audit trail.
 */
async function logMessage(to, templateName, relatedDoc, status, error, waMessageId, params, toName) {
  try {
    await db.collection("whatsapp_logs").add({
      to,
      toName: toName || null,
      templateName,
      relatedDoc: relatedDoc || null,
      status,
      error: error || null,
      waMessageId: waMessageId || null,
      params: params || [],
      sentAt: Date.now(),
    });
  } catch (e) {
    console.error("Failed to log WhatsApp message:", e.message);
  }
}

/**
 * Clear the config cache (useful after admin updates config).
 */
function clearConfigCache() {
  _configCache = null;
  _configCacheTime = 0;
}

module.exports = {
  getWhatsAppConfig,
  formatPhoneE164,
  sendTemplateMessage,
  sendTextMessage,
  resolveRecipientsForProfile,
  logMessage,
  clearConfigCache,
};
