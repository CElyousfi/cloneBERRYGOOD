/**
 * dgBot.js — Open-ended WhatsApp assistant for the DG profile.
 *
 * Everything goes through the agent (Claude + tools). No menu, no structured flows.
 * - text → agent
 * - audio → Whisper transcribe → agent
 * - image → Driscoll's forecast slide → Claude Vision extract → confirm → save
 * - document → friendly "not supported here" reply
 *
 * Conversation history persists in `whatsapp_sessions/{phone}.data.history` (30 min TTL).
 * A pending forecast (awaiting OUI/NON confirmation) persists in
 * `whatsapp_sessions/{phone}.data.pendingForecast`.
 * The webhook still handles `!profile <id>` as a global command (see whatsappProcessor.js).
 */

const { db } = require("./config/firebase");
const wa = require("./whatsappService");
const dgAgent = require("./dgAgent");
const forecastService = require("./forecastService");
const { parseForecastConfirmation } = require("./lib/forecastConfirmation");

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 12;
// A pending forecast older than this is considered stale and ignored.
const PENDING_FORECAST_TTL_MS = 15 * 60 * 1000;

const FRUIT_EMOJI = { RASP: "🍓", BLUE: "🫐" };
const FRUIT_NAME = { RASP: "Framboise", BLUE: "Myrtille" };

/**
 * Load the DG session: conversation history + any pending forecast.
 * @returns {Promise<{history: Array, pendingForecast: object|null}>}
 */
async function loadSession(phone) {
  const snap = await db.collection("whatsapp_sessions").doc(phone).get();
  if (!snap.exists) return { history: [], pendingForecast: null };
  const s = snap.data();
  if (s.expiresAt && s.expiresAt < Date.now()) return { history: [], pendingForecast: null };
  return {
    history: Array.isArray(s.data?.history) ? s.data.history : [],
    pendingForecast: s.data?.pendingForecast || null,
  };
}

/**
 * Persist the DG session. The doc is fully overwritten (no merge) — dgBot is the
 * sole writer of a `dg` phone's session doc, so omitting pendingForecast clears it.
 */
async function saveSession(phone, { history, pendingForecast }) {
  const now = Date.now();
  const data = { history: (history || []).slice(-MAX_HISTORY) };
  if (pendingForecast) data.pendingForecast = pendingForecast;
  await db.collection("whatsapp_sessions").doc(phone).set({
    phone,
    profileId: "dg",
    data,
    updatedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
}

// Map a forecastService error code to a WhatsApp-friendly French message.
function friendlyForecastError(err) {
  if (err === "LLM_UNAVAILABLE") return "service d'analyse momentanément indisponible, réessaie dans un instant";
  if (err === "Réponse Claude non parsable") return "le slide n'a pas pu être lu correctement";
  return err || "erreur inconnue";
}

// Build the confirmation message listing the extracted weeks.
function buildForecastSummary(fruitCode, year, weeks) {
  const sorted = [...weeks].sort((a, b) => a.week - b.week);
  const lines = sorted.map(w => {
    const range = w.minMad === w.maxMad
      ? `${w.minMad.toFixed(2)}`
      : `${w.minMad.toFixed(2)}–${w.maxMad.toFixed(2)}`;
    return `• S${w.week} : ${range} MAD/kg`;
  });
  return [
    `${FRUIT_EMOJI[fruitCode]} *Forecast ${FRUIT_NAME[fruitCode]} ${year}* — ${sorted.length} semaine(s) détectée(s) :`,
    "",
    ...lines,
    "",
    "Réponds *OUI* pour enregistrer, *NON* pour annuler.",
  ].join("\n");
}

/**
 * Handle an incoming forecast slide image: download → extract → store pending.
 */
async function handleForecastImage(phone, user, msg) {
  const imageId = msg.image?.id;
  if (!imageId) {
    await wa.sendTextMessage(phone, "❌ Image sans identifiant.");
    return;
  }
  await wa.sendTextMessage(phone, "📸 Analyse du slide de prévision en cours…");

  const dl = await wa.downloadMedia(imageId);
  if (dl.error || !dl.buffer) {
    await wa.sendTextMessage(phone, "❌ Téléchargement de l'image impossible : " + (dl.error || "inconnu"));
    return;
  }

  const imageB64 = dl.buffer.toString("base64");
  const mediaType = dl.mimeType || "image/png";

  const result = await forecastService.extractForecastAuto(imageB64, mediaType);
  if (!result.success) {
    await wa.sendTextMessage(
      phone,
      "❌ Lecture du slide impossible : " + friendlyForecastError(result.error) +
      "\n\nEnvoie un slide Driscoll's lisible (Blueberries ou Raspberries), ou passe par le dashboard."
    );
    return;
  }

  const { fruitCode, weeks } = result;
  const year = (weeks[0] && weeks[0].year) || new Date().getFullYear();

  // Archive the slide in Storage now — only the URL is kept in the session.
  const sourceImageUrl = await forecastService.uploadForecastImage(fruitCode, year, imageB64, mediaType);

  const session = await loadSession(phone);
  await saveSession(phone, {
    history: session.history,
    pendingForecast: { fruitCode, year, weeks, sourceImageUrl, at: Date.now() },
  });

  await wa.sendTextMessage(phone, buildForecastSummary(fruitCode, year, weeks));
}

/**
 * Resolve a pending forecast on OUI/NON. Returns true if the message was consumed.
 */
async function handleForecastConfirmation(phone, user, userText, session) {
  const pf = session.pendingForecast;
  if (!pf) return false;

  // Stale pending → drop it silently and let the message flow to the agent.
  if (pf.at && Date.now() - pf.at > PENDING_FORECAST_TTL_MS) {
    await saveSession(phone, { history: session.history, pendingForecast: null });
    session.pendingForecast = null;
    return false;
  }

  const intent = parseForecastConfirmation(userText);
  if (intent === "unknown") return false; // not a yes/no → let the agent answer

  if (intent === "cancel") {
    await saveSession(phone, { history: session.history, pendingForecast: null });
    session.pendingForecast = null;
    await wa.sendTextMessage(phone, "🗑️ Import du forecast annulé. Rien n'a été enregistré.");
    return true;
  }

  // intent === "confirm"
  const save = await forecastService.saveForecast(pf.fruitCode, pf.year, pf.weeks, {
    updatedBy: "whatsapp:" + ((user && user.name) || phone),
    sourceImageUrl: pf.sourceImageUrl,
  });
  await saveSession(phone, { history: session.history, pendingForecast: null });
  session.pendingForecast = null;

  if (!save.success) {
    await wa.sendTextMessage(phone, "❌ Enregistrement échoué : " + (save.error || "erreur inconnue"));
    return true;
  }
  await wa.sendTextMessage(
    phone,
    `✅ Forecast ${FRUIT_NAME[pf.fruitCode]} ${pf.year} enregistré (${pf.weeks.length} semaine(s)).`
  );
  return true;
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

  // ── Image → Driscoll's forecast slide upload
  if (msg.type === "image") {
    await handleForecastImage(phone, user, msg);
    return;
  }

  // ── Document → not supported (PDF extraction not wired)
  if (msg.type === "document") {
    await wa.sendTextMessage(
      phone,
      "📎 Les documents ne sont pas pris en charge. Pour un forecast Driscoll's, envoie le slide en *photo*, ou utilise le dashboard."
    );
    return;
  }

  // ── Interactive (button reply) → ignore, prompt to type
  if (msg.type === "interactive") {
    // No menu anymore — ignore stale button taps
    return;
  }

  // ── Text → pending-forecast confirmation, else agent
  const userText = msg.type === "text" ? (msg.text?.body || "").trim() : "";
  if (!userText) return;

  const session = await loadSession(phone);

  if (await handleForecastConfirmation(phone, user, userText, session)) return;

  const result = await dgAgent.ask({ userText, history: session.history });
  if (!result.success) {
    await wa.sendTextMessage(phone, "❌ " + (result.error || "Erreur agent"));
    return;
  }
  await wa.sendTextMessage(phone, result.reply);
  await saveSession(phone, { history: result.history, pendingForecast: session.pendingForecast });
}

module.exports = { handleDgMessage };
