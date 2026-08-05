/**
 * whatsappProcessor.js — Processes incoming WhatsApp events asynchronously.
 *
 * Triggered by Pub/Sub messages published by the HTTP webhook (whatsappWebhook).
 * Decoupling lets the HTTP webhook ack Meta in <100ms while heavy work
 * (Vision OCR, bot dispatch) runs reliably on a separate, longer-lived
 * Cloud Function execution.
 *
 * Idempotency: incoming Meta messages have unique `id` (msg.id). We skip
 * a message if its id was already recorded in `whatsapp_messages` recently.
 */

const { admin, db } = require("./config/firebase");
const whatsappService = require("./whatsappService");

/**
 * Process one Meta webhook payload (the `body` from POST /whatsappWebhook).
 * Safe to call multiple times for the same payload — idempotency via msg.id.
 */
async function processIncomingEvent(body) {
  for (const entry of (body.entry || [])) {
    for (const change of (entry.changes || [])) {
      const value = change.value || {};

      // ── Status updates (delivered, read, failed, sent)
      for (const status of (value.statuses || [])) {
        try {
          await updateLogStatus(status);
        } catch (err) {
          console.error("Status update failed:", status.id, err.message);
        }
      }

      // ── Incoming messages
      for (const msg of (value.messages || [])) {
        try {
          await processIncomingMessage(msg, value);
        } catch (err) {
          console.error("Message processing failed:", msg.id, err);
        }
      }
    }
  }
}

async function updateLogStatus(status) {
  const waMessageId = status.id;
  const newStatus = status.status;
  const timestamp = parseInt(status.timestamp) * 1000;
  const snap = await db.collection("whatsapp_logs")
    .where("waMessageId", "==", waMessageId).limit(1).get();
  if (snap.empty) return;
  const updates = { status: newStatus, [`${newStatus}_at`]: timestamp };
  if (status.errors) updates.error = JSON.stringify(status.errors);
  await snap.docs[0].ref.update(updates);
}

async function processIncomingMessage(msg, value) {
  // Idempotency: skip if we already processed this msg.id
  const existing = await db.collection("whatsapp_messages")
    .where("waMessageId", "==", msg.id).limit(1).get();
  if (!existing.empty) {
    console.log("Skipping duplicate message:", msg.id);
    return;
  }

  const from = "+" + msg.from;
  const messageData = {
    waMessageId: msg.id,
    from,
    timestamp: parseInt(msg.timestamp) * 1000,
    type: msg.type,
    receivedAt: Date.now(),
  };

  if (msg.type === "text") messageData.text = msg.text?.body || "";
  else if (msg.type === "button") messageData.text = msg.button?.text || "";
  else if (msg.type === "interactive") messageData.text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "";
  else if (msg.type === "image") messageData.mediaId = msg.image?.id;
  else if (msg.type === "document") messageData.mediaId = msg.document?.id;
  else if (msg.type === "audio") messageData.mediaId = msg.audio?.id;
  else messageData.raw = JSON.stringify(msg).slice(0, 1000);

  // Match phone to a user
  const userSnap = await db.collection("users")
    .where("whatsappPhone", "==", from).limit(1).get();
  let matchedUser = null;
  if (!userSnap.empty) {
    const userData = userSnap.docs[0].data();
    matchedUser = { uid: userSnap.docs[0].id, ...userData };
    messageData.userUid = matchedUser.uid;
    messageData.userName = userData.displayName || "";
  }

  const contact = (value.contacts || []).find(c => c.wa_id === msg.from);
  if (contact?.profile?.name) messageData.contactName = contact.profile.name;

  // Persist audit log (now blocking since we're not on the critical-ack path)
  await db.collection("whatsapp_messages").add(messageData);

  // Route to bot
  if (!matchedUser || matchedUser.whatsappEnabled === false || matchedUser.disabled) return;

  // !profile <id> command — DG can switch which bot handles their messages
  const cmdText = msg.type === "text" ? (msg.text?.body || "").trim() : "";
  const profileCmd = cmdText.match(/^!profile\s+([\w-]+)$/i);
  if (profileCmd && matchedUser.profileId === "dg") {
    const target = profileCmd[1].toLowerCase();
    try {
      if (target === "reset" || target === "off") {
        await db.collection("users").doc(matchedUser.uid).update({
          testProfileOverride: admin.firestore.FieldValue.delete(),
        });
        await whatsappService.sendTextMessage(from, `✅ Override désactivé. Tu es routé comme \`${matchedUser.profileId}\`.`);
      } else {
        await db.collection("users").doc(matchedUser.uid).update({ testProfileOverride: target });
        await whatsappService.sendTextMessage(from, `✅ Override actif: prochains messages routés comme \`${target}\`. Envoie \`!profile reset\` pour annuler.`);
      }
    } catch (cmdErr) {
      console.error(`!profile command error for ${from}:`, cmdErr);
    }
    return;
  }

  const effectiveProfile = matchedUser.testProfileOverride || matchedUser.profileId;
  try {
    // BDC approval session takes precedence
    const chefBdcBot = require("./chefBdcBot");
    if (await chefBdcBot.hasActiveBdcSession(from)) {
      const handled = await chefBdcBot.handleBdcMessage(
        from,
        { ...matchedUser, profileId: effectiveProfile },
        msg
      );
      if (handled) return;
    }

    if (effectiveProfile === "securite") {
      const securityBot = require("./securityBot");
      await securityBot.handleSecurityMessage(from, { ...matchedUser, profileId: effectiveProfile }, msg);
    } else if (effectiveProfile === "dg") {
      const dgBot = require("./dgBot");
      await dgBot.handleDgMessage(from, { ...matchedUser, profileId: effectiveProfile }, msg);
    } else if (effectiveProfile === "magasinier") {
      const magasinierBot = require("./magasinierBot");
      await magasinierBot.handleMessage(from, { ...matchedUser, profileId: effectiveProfile }, msg);
    }
  } catch (botErr) {
    console.error(`Bot routing error for ${from} (${effectiveProfile}):`, botErr);
  }
}

module.exports = { processIncomingEvent };
