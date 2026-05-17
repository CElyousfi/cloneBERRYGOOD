/**
 * chefBdcBot.js — WhatsApp bot for BDC workflow (Chef, DG, Finance).
 *
 * Supported flows (session.flow):
 *  - "bdc_approval"   : Chef / DG approves or rejects a BDC submission.
 *  - "virement_lance" : Finance confirms the virement has been entered.
 *  - "virement_signe" : DG confirms the virement has been signed.
 *
 * Session lookup is keyed by E.164 phone (matches `whatsapp_sessions` doc id used
 * by dgBot / securityBot).
 */

const { db } = require("./config/firebase");
const wa = require("./whatsappService");
const { validateBdcCore } = require("./bdcValidationService");
const { updateBdcVirementCore } = require("./bdcVirementService");

const SESSION_TTL_MS = 30 * 60 * 1000;

const BTN = {
  APPROVE: "BDC_APPROVE",
  REJECT: "BDC_REJECT",
  VIREMENT_SAISI: "VIREMENT_SAISI",
  VIREMENT_SIGNED: "VIREMENT_SIGNED",
};

const TEXT_APPROVE = new Set(["ok", "oui", "valider", "valide", "validé", "approuver", "yes", "y", "✅"]);
const TEXT_REJECT = new Set(["non", "no", "rejeter", "rejete", "rejeté", "refuser", "refuse", "n", "❌"]);
const TEXT_SAISI = new Set(["ok", "oui", "saisi", "saisie", "lance", "lancé", "lancée", "yes", "y", "✅"]);
const TEXT_SIGNED = new Set(["ok", "oui", "signe", "signé", "signée", "yes", "y", "✅"]);

const ACTIVE_FLOWS = new Set(["bdc_approval", "virement_lance", "virement_signe"]);

async function loadSession(phone) {
  const snap = await db.collection("whatsapp_sessions").doc(phone).get();
  if (!snap.exists) return null;
  const s = snap.data();
  if (s.expiresAt && s.expiresAt < Date.now()) return null;
  return s;
}

async function saveSession(phone, patch) {
  const now = Date.now();
  await db.collection("whatsapp_sessions").doc(phone).set(
    { phone, ...patch, updatedAt: now, expiresAt: now + SESSION_TTL_MS },
    { merge: true }
  );
}

async function resetSession(phone) {
  await db.collection("whatsapp_sessions").doc(phone).delete().catch(() => {});
}

function extractInput(msg) {
  const buttonId = msg.type === "interactive"
    ? (msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || null)
    : null;
  const buttonText = msg.type === "button" ? (msg.button?.text || "") : "";
  const text = (msg.text?.body || buttonText || "").trim();
  return { buttonId, text };
}

/**
 * Decide whether this message should be handled by chefBdcBot.
 * Returns true iff there is an active BDC-related session for the phone.
 */
async function hasActiveBdcSession(phone) {
  const session = await loadSession(phone);
  return !!(session && ACTIVE_FLOWS.has(session.flow));
}

/**
 * Main handler. Called from the webhook when hasActiveBdcSession() returned true.
 *
 * @param {string} phone - E.164 phone of sender
 * @param {object} user  - { uid, profileId, displayName, ferme, ... } from users collection
 * @param {object} msg   - raw Meta message object
 * @returns {Promise<boolean>} true if the message was handled
 */
async function handleBdcMessage(phone, user, msg) {
  const session = await loadSession(phone);
  if (!session || !ACTIVE_FLOWS.has(session.flow)) return false;

  if (session.flow === "virement_lance") return handleVirementLance(phone, user, msg, session);
  if (session.flow === "virement_signe") return handleVirementSigne(phone, user, msg, session);

  // Default: bdc_approval flow
  const { bdc_id, role, ferme } = session.data || {};
  if (!bdc_id || !role) {
    await resetSession(phone);
    return false;
  }

  const { buttonId, text } = extractInput(msg);
  const lower = text.toLowerCase();

  // Step 1 — décision
  if (session.step === "awaiting_decision") {
    const isApprove = buttonId === BTN.APPROVE || TEXT_APPROVE.has(lower);
    const isReject = buttonId === BTN.REJECT || TEXT_REJECT.has(lower);

    if (isApprove) {
      const result = await validateBdcCore({
        id: bdc_id, decision: "approve", role,
        profileId: user.profileId, name: user.displayName || user.uid,
        ferme: role === "chef" ? (ferme || user.ferme) : null,
        via: "whatsapp",
      });
      if (result.success) {
        await wa.sendTextMessage(phone, `✅ BDC validé. Merci !`);
      } else if (result.currentStatus) {
        await wa.sendTextMessage(phone, `⚠️ Ce BDC a déjà été traité (statut actuel: ${result.currentStatus}).`);
      } else {
        await wa.sendTextMessage(phone, `❌ Validation impossible : ${result.error || "erreur inconnue"}`);
      }
      await resetSession(phone);
      return true;
    }

    if (isReject) {
      await saveSession(phone, { step: "awaiting_reject_reason" });
      await wa.sendTextMessage(phone, "Merci de préciser le motif du rejet (texte libre) :");
      return true;
    }

    // Unknown reply — re-prompt with buttons
    await wa.sendInteractiveButtons(
      phone,
      `Réponse non reconnue. Pour le BDC en attente, tapez *OK* (valider) ou *NON* (rejeter), ou utilisez les boutons :`,
      [
        { id: BTN.APPROVE, title: "✅ Valider" },
        { id: BTN.REJECT, title: "❌ Rejeter" },
      ]
    );
    return true;
  }

  // Step 2 — motif de rejet
  if (session.step === "awaiting_reject_reason") {
    const reason = text;
    if (!reason) {
      await wa.sendTextMessage(phone, "Motif vide. Merci d'envoyer un *texte* décrivant le motif.");
      return true;
    }
    const result = await validateBdcCore({
      id: bdc_id, decision: "reject", role,
      profileId: user.profileId, name: user.displayName || user.uid,
      ferme: role === "chef" ? (ferme || user.ferme) : null,
      comment: reason,
      via: "whatsapp",
    });
    if (result.success) {
      await wa.sendTextMessage(phone, `❌ BDC rejeté. Motif enregistré : "${reason}"`);
    } else if (result.currentStatus) {
      await wa.sendTextMessage(phone, `⚠️ Ce BDC a déjà été traité (statut actuel: ${result.currentStatus}).`);
    } else {
      await wa.sendTextMessage(phone, `❌ Rejet impossible : ${result.error || "erreur inconnue"}`);
    }
    await resetSession(phone);
    return true;
  }

  // Unknown step → cleanup
  await resetSession(phone);
  return false;
}

/**
 * Helper used by the dispatcher to create the BDC approval session after sending
 * the document + interactive buttons.
 */
async function startBdcApprovalSession(phone, { bdc_id, role, ferme }) {
  await saveSession(phone, {
    flow: "bdc_approval",
    step: "awaiting_decision",
    data: { bdc_id, role, ferme: ferme || null },
  });
}

/**
 * Finance confirms "virement saisi" via WhatsApp.
 */
async function handleVirementLance(phone, user, msg, session) {
  const { bdc_id } = session.data || {};
  if (!bdc_id) { await resetSession(phone); return false; }

  const { buttonId, text } = extractInput(msg);
  const lower = text.toLowerCase();
  const isConfirm = buttonId === BTN.VIREMENT_SAISI || TEXT_SAISI.has(lower);

  if (!isConfirm) {
    await wa.sendInteractiveButtons(
      phone,
      `Confirmez-vous que le virement a été *saisi* ? Tapez *OK* ou utilisez le bouton.`,
      [{ id: BTN.VIREMENT_SAISI, title: "💸 Virement saisi" }]
    );
    return true;
  }

  const result = await updateBdcVirementCore({
    id: bdc_id, decision: "lancer",
    by: { profileId: user.profileId, name: user.displayName || user.uid },
    via: "whatsapp",
  });
  if (result.success) {
    await wa.sendTextMessage(phone, `✅ Virement saisi enregistré. Le DG est notifié pour signature.`);
  } else if (result.currentStatus) {
    await wa.sendTextMessage(phone, `⚠️ Ce BDC est déjà au statut "${result.currentStatus}". Aucune action requise.`);
  } else {
    await wa.sendTextMessage(phone, `❌ Action impossible : ${result.error || "erreur inconnue"}`);
  }
  await resetSession(phone);
  return true;
}

/**
 * DG confirms "virement signé" via WhatsApp.
 */
async function handleVirementSigne(phone, user, msg, session) {
  const { bdc_id } = session.data || {};
  if (!bdc_id) { await resetSession(phone); return false; }

  const { buttonId, text } = extractInput(msg);
  const lower = text.toLowerCase();
  const isConfirm = buttonId === BTN.VIREMENT_SIGNED || TEXT_SIGNED.has(lower);

  if (!isConfirm) {
    await wa.sendInteractiveButtons(
      phone,
      `Confirmez-vous avoir *signé* le virement ? Tapez *OK* ou utilisez le bouton.`,
      [{ id: BTN.VIREMENT_SIGNED, title: "✍️ Virement signé" }]
    );
    return true;
  }

  const result = await updateBdcVirementCore({
    id: bdc_id, decision: "signer",
    by: { profileId: user.profileId, name: user.displayName || user.uid },
    via: "whatsapp",
  });
  if (result.success) {
    await wa.sendTextMessage(phone, `✅ Virement signé enregistré. Finance est notifiée pour l'envoi de l'avis de virement.`);
  } else if (result.currentStatus) {
    await wa.sendTextMessage(phone, `⚠️ Ce BDC est au statut "${result.currentStatus}". Aucune action requise.`);
  } else {
    await wa.sendTextMessage(phone, `❌ Action impossible : ${result.error || "erreur inconnue"}`);
  }
  await resetSession(phone);
  return true;
}

/**
 * Helper used by the dispatcher to create a virement-lance session for Finance.
 */
async function startVirementLanceSession(phone, { bdc_id }) {
  await saveSession(phone, {
    flow: "virement_lance",
    step: "awaiting_decision",
    data: { bdc_id },
  });
}

/**
 * Helper used by the dispatcher to create a virement-signe session for DG.
 */
async function startVirementSigneSession(phone, { bdc_id }) {
  await saveSession(phone, {
    flow: "virement_signe",
    step: "awaiting_decision",
    data: { bdc_id },
  });
}

module.exports = {
  handleBdcMessage,
  hasActiveBdcSession,
  startBdcApprovalSession,
  startVirementLanceSession,
  startVirementSigneSession,
  BTN,
};
