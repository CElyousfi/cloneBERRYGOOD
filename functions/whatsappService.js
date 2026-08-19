/**
 * whatsappService.js — WhatsApp Business Cloud API integration.
 *
 * Uses Meta Cloud API (graph.facebook.com) to send template messages.
 * Config is read from Firestore document `config/whatsapp`.
 * No npm dependency needed — Node 20 native fetch.
 */

const { db } = require("./config/firebase");
const { formatPhoneE164 } = require("./lib/phone/formatPhoneE164");

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

// formatPhoneE164 is defined in ./lib/phone/formatPhoneE164 (pure module,
// reused here and by the Sentinel recipients helper) and re-exported below.

/**
 * Collapse any whitespace run (newlines, tabs, multiple spaces) into a single
 * space and trim. Required for WhatsApp template body params: Meta rejects a
 * param containing '\n', tab, or 4+ consecutive spaces (error 131008).
 * @param {*} s
 * @returns {string}
 */
function toSingleLine(s) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim();
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
 * Send interactive button message (max 3 buttons). Within 24h session only.
 * buttons = [{ id, title }] — title max 20 chars, id max 256 chars.
 */
async function sendInteractiveButtons(to, bodyText, buttons, header) {
  const config = await getWhatsAppConfig();
  if (!config || !config.enabled) return { success: false, error: "WhatsApp désactivé" };
  const phone = formatPhoneE164(to);
  if (!phone) return { success: false, error: "Numéro invalide" };

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "interactive",
    interactive: {
      type: "button",
      ...(header && header.type === "document" && header.link
        ? { header: { type: "document", document: { link: header.link, filename: header.filename } } }
        : {}),
      body: { text: bodyText },
      action: {
        buttons: buttons.slice(0, 3).map(b => ({
          type: "reply",
          reply: { id: String(b.id).slice(0, 256), title: String(b.title).slice(0, 20) },
        })),
      },
    },
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${config.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      console.error(`WhatsApp interactive send failed to ${phone}:`, errMsg);
      return { success: false, error: errMsg };
    }
    return { success: true, waMessageId: data.messages?.[0]?.id };
  } catch (err) {
    console.error(`WhatsApp interactive send error to ${phone}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send an image message by public URL. Within 24h session only.
 */
async function sendImageMessage(to, imageLink, caption) {
  const config = await getWhatsAppConfig();
  if (!config || !config.enabled) return { success: false, error: "WhatsApp désactivé" };
  const phone = formatPhoneE164(to);
  if (!phone) return { success: false, error: "Numéro invalide" };

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "image",
    image: { link: imageLink, ...(caption ? { caption: String(caption).slice(0, 1024) } : {}) },
  };
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${config.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!response.ok) return { success: false, error: data.error?.message || "Erreur image" };
    return { success: true, waMessageId: data.messages?.[0]?.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Send a document (PDF, etc.) message by public URL. Within 24h session only.
 * @param {string} to - E.164 phone
 * @param {string} documentLink - HTTPS URL fetchable by Meta
 * @param {string} [filename] - Display filename (e.g. "BDC_2026-0142.pdf")
 * @param {string} [caption] - Caption shown below the document (≤1024 chars)
 */
async function sendDocumentMessage(to, documentLink, filename, caption) {
  const config = await getWhatsAppConfig();
  if (!config || !config.enabled) return { success: false, error: "WhatsApp désactivé" };
  const phone = formatPhoneE164(to);
  if (!phone) return { success: false, error: "Numéro invalide" };

  const document = { link: documentLink };
  if (filename) document.filename = String(filename).slice(0, 240);
  if (caption) document.caption = String(caption).slice(0, 1024);

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "document",
    document,
  };
  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${config.phone_number_id}/messages`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${config.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    if (!response.ok) {
      const errMsg = data.error?.message || JSON.stringify(data);
      console.error(`WhatsApp document send failed to ${phone}:`, errMsg);
      return { success: false, error: errMsg };
    }
    return { success: true, waMessageId: data.messages?.[0]?.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Upload a media file (PDF, image, etc.) to Meta and return a media_id.
 * The id is valid 30 days and can be used as header.document.id in a template send,
 * which is the only way to attach a file to a business-initiated (non-session) message.
 *
 * @param {Buffer} buffer - File bytes
 * @param {string} mimeType - e.g. "application/pdf"
 * @param {string} filename - Display filename used by Meta
 * @returns {{id: string} | {error: string}}
 */
async function uploadMedia(buffer, mimeType, filename) {
  const config = await getWhatsAppConfig();
  if (!config || !config.enabled) return { error: "WhatsApp désactivé" };
  if (!buffer || !buffer.length) return { error: "Buffer vide" };

  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", new Blob([buffer], { type: mimeType }), filename || "file.bin");

    const response = await fetch(
      `https://graph.facebook.com/v21.0/${config.phone_number_id}/media`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${config.access_token}` },
        body: form,
      }
    );
    const data = await response.json();
    if (!response.ok || !data.id) {
      return { error: data.error?.message || `Upload HTTP ${response.status}` };
    }
    return { id: data.id };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Send a template message with a DOCUMENT header referencing either an uploaded
 * media_id or a public link. Use this for business-initiated messages that need
 * a PDF attachment (outside 24h window). The template must be registered with a
 * header of format DOCUMENT.
 *
 * @param {string|object} mediaIdOrRef - Either a media_id string, or { mediaId } / { link }.
 */
async function sendTemplateMessageWithDocument(to, templateName, mediaIdOrRef, filename, bodyParams = [], lang, toName) {
  const config = await getWhatsAppConfig();
  if (!config || !config.enabled) {
    return { success: false, error: "WhatsApp non configuré ou désactivé" };
  }

  const phone = formatPhoneE164(to);
  if (!phone) return { success: false, error: "Numéro invalide: " + to };

  // Normalize the document reference: accept legacy string media_id or { mediaId | link }.
  let docRef;
  if (typeof mediaIdOrRef === "string") {
    docRef = { id: mediaIdOrRef };
  } else if (mediaIdOrRef && mediaIdOrRef.mediaId) {
    docRef = { id: mediaIdOrRef.mediaId };
  } else if (mediaIdOrRef && mediaIdOrRef.link) {
    docRef = { link: mediaIdOrRef.link };
  } else {
    return { success: false, error: "Référence document manquante (mediaId ou link)" };
  }
  if (filename) docRef.filename = String(filename).slice(0, 240);

  const language = lang || config.default_language || "fr";
  const components = [
    {
      type: "header",
      parameters: [{ type: "document", document: docRef }],
    },
  ];
  if (bodyParams.length > 0) {
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
      components,
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
      console.error(`WhatsApp doc-template send failed [${templateName}] to ${phone}:`, errMsg);
      await logMessage(phone, templateName, null, "failed", errMsg, null, bodyParams, toName);
      return { success: false, error: errMsg };
    }
    const waMessageId = data.messages?.[0]?.id || null;
    await logMessage(phone, templateName, null, "sent", null, waMessageId, bodyParams, toName);
    return { success: true, waMessageId };
  } catch (err) {
    console.error(`WhatsApp doc-template send error [${templateName}] to ${phone}:`, err.message);
    await logMessage(phone, templateName, null, "failed", err.message, null, null, toName);
    return { success: false, error: err.message };
  }
}

/**
 * Send a template message with an IMAGE header referencing either an uploaded
 * media_id or a public link. Business-initiated equivalent of sendImageMessage
 * (which only works inside the 24h session window). The template must be
 * registered with a header of format IMAGE.
 *
 * Copie conforme de sendTemplateMessageWithDocument à deux écarts près :
 *  - le paramètre de header est `{ type: "image", image: … }` ;
 *  - PAS de `filename` : Meta rejette ce champ sur un header IMAGE.
 *
 * @param {string} to - E.164 phone
 * @param {string} templateName
 * @param {string|object} mediaIdOrRef - Either a media_id string, or { mediaId } / { link }.
 * @param {Array<string>} [bodyParams]
 * @param {string} [lang]
 * @param {string} [toName]
 */
async function sendTemplateMessageWithImage(to, templateName, mediaIdOrRef, bodyParams = [], lang, toName) {
  const config = await getWhatsAppConfig();
  if (!config || !config.enabled) {
    return { success: false, error: "WhatsApp non configuré ou désactivé" };
  }

  const phone = formatPhoneE164(to);
  if (!phone) return { success: false, error: "Numéro invalide: " + to };

  // Normalize the image reference: accept legacy string media_id or { mediaId | link }.
  let imgRef;
  if (typeof mediaIdOrRef === "string") {
    imgRef = { id: mediaIdOrRef };
  } else if (mediaIdOrRef && mediaIdOrRef.mediaId) {
    imgRef = { id: mediaIdOrRef.mediaId };
  } else if (mediaIdOrRef && mediaIdOrRef.link) {
    imgRef = { link: mediaIdOrRef.link };
  } else {
    return { success: false, error: "Référence image manquante (mediaId ou link)" };
  }

  const language = lang || config.default_language || "fr";
  const components = [
    {
      type: "header",
      parameters: [{ type: "image", image: imgRef }],
    },
  ];
  if (bodyParams.length > 0) {
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
      components,
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
      console.error(`WhatsApp img-template send failed [${templateName}] to ${phone}:`, errMsg);
      await logMessage(phone, templateName, null, "failed", errMsg, null, bodyParams, toName);
      return { success: false, error: errMsg };
    }
    const waMessageId = data.messages?.[0]?.id || null;
    await logMessage(phone, templateName, null, "sent", null, waMessageId, bodyParams, toName);
    return { success: true, waMessageId };
  } catch (err) {
    console.error(`WhatsApp img-template send error [${templateName}] to ${phone}:`, err.message);
    await logMessage(phone, templateName, null, "failed", err.message, null, null, toName);
    return { success: false, error: err.message };
  }
}

/**
 * Download media by mediaId via Graph API (2-step: resolve URL, then GET bytes).
 * Returns { buffer, mimeType, sha256 } or { error }.
 */
async function downloadMedia(mediaId) {
  const config = await getWhatsAppConfig();
  if (!config || !config.access_token) return { error: "WhatsApp non configuré" };

  try {
    const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { "Authorization": `Bearer ${config.access_token}` },
    });
    const meta = await metaRes.json();
    if (!metaRes.ok || !meta.url) {
      return { error: meta.error?.message || "Media lookup failed" };
    }
    const binRes = await fetch(meta.url, {
      headers: { "Authorization": `Bearer ${config.access_token}` },
    });
    if (!binRes.ok) return { error: `Media download HTTP ${binRes.status}` };
    const arrBuf = await binRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrBuf),
      mimeType: meta.mime_type || binRes.headers.get("content-type") || "application/octet-stream",
      sha256: meta.sha256 || null,
    };
  } catch (err) {
    return { error: err.message };
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
 * @param {string} profileId - e.g. "chef_f1", "dg", "achats", "finance"
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
    if (ferme && typeof profileId === "string" && profileId.indexOf("chef_") === 0 && d.ferme && d.ferme !== ferme) continue;
    const phone = formatPhoneE164(d.whatsappPhone);
    if (phone) {
      recipients.push({
        uid: doc.id,
        displayName: d.displayName || "",
        phone,
        profileId: d.profileId,
        ferme: d.ferme || null,
      });
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
  toSingleLine,
  sendTemplateMessage,
  sendTextMessage,
  sendInteractiveButtons,
  sendImageMessage,
  sendDocumentMessage,
  uploadMedia,
  sendTemplateMessageWithDocument,
  sendTemplateMessageWithImage,
  downloadMedia,
  resolveRecipientsForProfile,
  logMessage,
  clearConfigCache,
};
