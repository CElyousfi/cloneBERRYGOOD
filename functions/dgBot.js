/**
 * dgBot.js — Open-ended WhatsApp assistant for the DG profile.
 *
 * Everything goes through the agent (Claude + tools). No menu, no structured flows.
 * - text → agent
 * - audio → Whisper transcribe → agent
 * - image → friendly "not supported here" reply
 *
 * Conversation history persists in `whatsapp_sessions/{phone}.data.history` (30 min TTL).
 * The webhook still handles `!profile <id>` as a global command (see whatsappProcessor.js).
 */

const { db } = require("./config/firebase");
const wa = require("./whatsappService");
const dgAgent = require("./dgAgent");

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 12;

async function loadHistory(phone) {
  const snap = await db.collection("whatsapp_sessions").doc(phone).get();
  if (!snap.exists) return [];
  const s = snap.data();
  if (s.expiresAt && s.expiresAt < Date.now()) return [];
  return Array.isArray(s.data?.history) ? s.data.history : [];
}

async function saveHistory(phone, history) {
  const now = Date.now();
  const trimmed = history.slice(-MAX_HISTORY);
  await db.collection("whatsapp_sessions").doc(phone).set(
    {
      phone,
      profileId: "dg",
      data: { history: trimmed },
      updatedAt: now,
      expiresAt: now + SESSION_TTL_MS,
    },
    { merge: true }
  );
}

async function handleDgMessage(phone, user, msg) {
  // ── Audio → Whisper transcribe → continue as text
  if (msg.type === "audio") {
    const audioId = msg.audio?.id;
    if (!audioId) {
      await wa.sendTextMessage(phone, "❌ Audio sans identifiant.");
      return;
    }
    const dl = await wa.downloadMedia(audioId);
    if (dl.error || !dl.buffer) {
      await wa.sendTextMessage(phone, "❌ Téléchargement audio impossible : " + (dl.error || "inconnu"));
      return;
    }
    const audioService = require("./audioService");
    const transcript = await audioService.transcribeAudio(dl.buffer, dl.mimeType);
    if (!transcript.success) {
      await wa.sendTextMessage(phone, "❌ Transcription impossible : " + transcript.error);
      return;
    }
    await wa.sendTextMessage(phone, `🎙️ « ${transcript.text} »`);
    msg = { ...msg, type: "text", text: { body: transcript.text } };
  }

  // ── Image/document → not supported in agent mode (use dashboard)
  if (msg.type === "image" || msg.type === "document") {
    await wa.sendTextMessage(
      phone,
      "📎 Les médias ne sont pas pris en charge ici. Utilise le dashboard pour uploader des fichiers (slides forecast, etc.)."
    );
    return;
  }

  // ── Interactive (button reply) → ignore, prompt to type
  if (msg.type === "interactive") {
    // No menu anymore — ignore stale button taps
    return;
  }

  // ── Text → agent
  const userText = msg.type === "text" ? (msg.text?.body || "").trim() : "";
  if (!userText) return;

  const history = await loadHistory(phone);
  const result = await dgAgent.ask({ userText, history });
  if (!result.success) {
    await wa.sendTextMessage(phone, "❌ " + (result.error || "Erreur agent"));
    return;
  }
  await wa.sendTextMessage(phone, result.reply);
  await saveHistory(phone, result.history);
}

module.exports = { handleDgMessage };
