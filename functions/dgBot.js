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
 * A pending BdC reminder (awaiting an explicit "oui") persists in
 * `whatsapp_sessions/{phone}.data.pendingRelance` — l'agent PRÉPARE la relance,
 * seul dgBot l'ENVOIE (remindBdcCore), après confirmation.
 * The webhook still handles `!profile <id>` as a global command (see whatsappProcessor.js).
 */

const { db } = require("./config/firebase");
const wa = require("./whatsappService");
const dgAgent = require("./dgAgent");
const forecastService = require("./forecastService");
const { parseForecastConfirmation } = require("./lib/forecastConfirmation");
const { remindBdcCore } = require("./bdcReminderService");

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 12;
// A pending forecast older than this is considered stale and ignored.
const PENDING_FORECAST_TTL_MS = 15 * 60 * 1000;
// Une intention de relance non confirmée expire au bout de 5 minutes.
const PENDING_RELANCE_TTL_MS = 5 * 60 * 1000;

const FRUIT_EMOJI = { RASP: "🍓", BLUE: "🫐" };
const FRUIT_NAME = { RASP: "Framboise", BLUE: "Myrtille" };

/**
 * Load the DG session: conversation history + any pending forecast / relance.
 * @returns {Promise<{history: Array, pendingForecast: object|null, pendingRelance: object|null}>}
 */
async function loadSession(phone) {
  const empty = { history: [], pendingForecast: null, pendingRelance: null };
  const snap = await db.collection("whatsapp_sessions").doc(phone).get();
  if (!snap.exists) return empty;
  const s = snap.data();
  if (s.expiresAt && s.expiresAt < Date.now()) return empty;
  return {
    history: Array.isArray(s.data?.history) ? s.data.history : [],
    pendingForecast: s.data?.pendingForecast || null,
    pendingRelance: s.data?.pendingRelance || null,
  };
}

/**
 * Persist the DG session. The doc is fully overwritten (no merge) — dgBot is the
 * sole writer of a `dg` phone's session doc, so omitting pendingForecast ou
 * pendingRelance les EFFACE. Tout appelant doit donc passer les DEUX champs,
 * même quand il n'en modifie qu'un.
 */
async function saveSession(phone, { history, pendingForecast, pendingRelance }) {
  const now = Date.now();
  const data = { history: (history || []).slice(-MAX_HISTORY) };
  if (pendingForecast) data.pendingForecast = pendingForecast;
  if (pendingRelance) data.pendingRelance = pendingRelance;
  await db.collection("whatsapp_sessions").doc(phone).set({
    phone,
    profileId: "dg",
    data,
    updatedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Relance BdC — décisions PURES (aucun I/O, temps injecté)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ensemble FERMÉ des réponses qui confirment un envoi. Tout le reste annule :
 * le défaut penche toujours vers le NON-ENVOI.
 * @type {Set<string>}
 */
const RELANCE_CONFIRM_REPLIES = new Set(["oui", "ok", "confirme", "vas y", "go"]);

/**
 * Normalise une réponse utilisateur : minuscules, accents retirés, ponctuation
 * et espaces superflus ignorés, puis comparaison au vocabulaire fermé.
 * La confirmation porte sur le message ENTIER — « oui mais attends » n'est pas
 * une confirmation.
 * @param {string} text
 * @returns {'confirme'|'autre'}
 */
function normalizeRelanceReply(text) {
  const norm = String(text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return RELANCE_CONFIRM_REPLIES.has(norm) ? "confirme" : "autre";
}

/**
 * Machine à états de l'intention de relance, évaluée au message SUIVANT quel
 * qu'il soit. L'intention est TOUJOURS consommée dès qu'elle existe : c'est ce
 * qui empêche un « oui » tardif, répondant à autre chose, de déclencher un envoi.
 *
 * @param {{numero?:string, id?:string, at?:number}|null|undefined} pending
 * @param {string} userText — message reçu ("" pour un message non textuel)
 * @param {number} now — timestamp ms injecté
 * @returns {{outcome: 'none'|'confirm'|'cancel'|'expired'}}
 */
function resolvePendingRelance(pending, userText, now) {
  if (!pending) return { outcome: "none" };
  // Pas d'horodatage exploitable → traité comme expiré (fail-closed).
  if (!pending.at || now - pending.at > PENDING_RELANCE_TTL_MS) return { outcome: "expired" };
  return { outcome: normalizeRelanceReply(userText) === "confirme" ? "confirm" : "cancel" };
}

/**
 * Message d'annulation à afficher au DG. Une annulation n'est JAMAIS silencieuse
 * — sauf quand la nouvelle demande porte sur le MÊME BdC : on redemande alors
 * simplement confirmation (idempotent), annoncer une annulation serait faux.
 *
 * @param {'none'|'confirm'|'cancel'|'expired'} outcome
 * @param {{numero?:string, id?:string}|null|undefined} pending
 * @param {{numero?:string}|null|undefined} newIntent — intention posée par le même tour
 * @returns {string|null}
 */
function buildRelanceNotice(outcome, pending, newIntent) {
  if (!pending) return null;
  if (outcome !== "cancel" && outcome !== "expired") return null;
  const numero = pending.numero || pending.id || "ce BdC";
  if (newIntent && newIntent.numero === numero) return null;
  if (newIntent) {
    return `🚫 La demande de relance sur *${numero}* est annulée (rien envoyé) ; je te demande confirmation pour *${newIntent.numero}*.`;
  }
  if (outcome === "expired") {
    return `⏳ La demande de relance sur *${numero}* a expiré (5 min sans confirmation) — aucun rappel n'a été envoyé.`;
  }
  return `🚫 La demande de relance sur *${numero}* est annulée faute de confirmation — aucun rappel n'a été envoyé.`;
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
    // Déjà consommée en amont de handleDgMessage pour un message non textuel :
    // on relit la session ici, donc ce champ vaut null — on le propage quand
    // même, saveSession étant seul rédacteur du document.
    pendingRelance: session.pendingRelance,
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
    await saveSession(phone, { history: session.history, pendingForecast: null, pendingRelance: session.pendingRelance });
    session.pendingForecast = null;
    return false;
  }

  const intent = parseForecastConfirmation(userText);
  if (intent === "unknown") return false; // not a yes/no → let the agent answer

  if (intent === "cancel") {
    await saveSession(phone, { history: session.history, pendingForecast: null, pendingRelance: session.pendingRelance });
    session.pendingForecast = null;
    await wa.sendTextMessage(phone, "🗑️ Import du forecast annulé. Rien n'a été enregistré.");
    return true;
  }

  // intent === "confirm"
  const save = await forecastService.saveForecast(pf.fruitCode, pf.year, pf.weeks, {
    updatedBy: "whatsapp:" + ((user && user.name) || phone),
    sourceImageUrl: pf.sourceImageUrl,
  });
  await saveSession(phone, { history: session.history, pendingForecast: null, pendingRelance: session.pendingRelance });
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

/**
 * Consomme une intention de relance sur un message NON textuel (image, document,
 * bouton). Aucun de ces messages ne peut valoir confirmation : l'intention est
 * annulée, et l'annulation est annoncée.
 */
async function consumeRelanceOnNonText(phone) {
  const session = await loadSession(phone);
  if (!session.pendingRelance) return;
  const { outcome } = resolvePendingRelance(session.pendingRelance, "", Date.now());
  await saveSession(phone, {
    history: session.history,
    pendingForecast: session.pendingForecast,
    pendingRelance: null,
  });
  const notice = buildRelanceNotice(outcome, session.pendingRelance, null);
  if (notice) await wa.sendTextMessage(phone, notice);
}

/**
 * Envoie le rappel confirmé. SEUL point d'appel de remindBdcCore côté bot :
 * l'agent prépare, dgBot envoie — jamais l'inverse.
 */
async function sendConfirmedRelance(phone, session, pending) {
  await saveSession(phone, {
    history: session.history,
    pendingForecast: session.pendingForecast,
    pendingRelance: null,
  });
  const result = await remindBdcCore({ id: pending.id, by: pending.by || {}, via: "whatsapp" });
  if (!result.success) {
    await wa.sendTextMessage(
      phone,
      `❌ Rappel *${pending.numero}* non envoyé : ${result.error || "erreur inconnue"}`
    );
    return;
  }
  await wa.sendTextMessage(
    phone,
    `✅ Rappel *${pending.numero}* envoyé à ${(result.profiles || []).join(", ")}` +
    (result.duration ? ` (en attente depuis ${result.duration})` : "") + "."
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

  // ── Message non textuel : une relance en attente est consommée quand même.
  // « Consommée au message suivant, quel qu'il soit » — un slide ou un document
  // envoyé après la demande annule la relance, et on le DIT.
  if (msg.type !== "text") {
    await consumeRelanceOnNonText(phone);
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

  // ── Relance en attente : consommée par CE message, quel qu'il soit.
  const pendingRelance = session.pendingRelance;
  const { outcome } = resolvePendingRelance(pendingRelance, userText, Date.now());
  session.pendingRelance = null;
  if (outcome === "confirm") {
    await sendConfirmedRelance(phone, session, pendingRelance);
    return;
  }
  // outcome "cancel"/"expired" : on répond quand même à la question du DG, et on
  // annonce l'annulation une fois qu'on sait si le tour repose une demande.

  const result = await dgAgent.ask({ userText, history: session.history, user });
  if (!result.success) {
    const notice = buildRelanceNotice(outcome, pendingRelance, null);
    await saveSession(phone, {
      history: session.history,
      pendingForecast: session.pendingForecast,
      pendingRelance: null,
    });
    await wa.sendTextMessage(phone, "❌ " + (result.error || "Erreur agent") + (notice ? "\n\n" + notice : ""));
    return;
  }

  // Nouvelle intention posée par l'agent → horodatée ICI (le compte à rebours
  // part au moment où la confirmation est demandée au DG).
  const newIntent = result.relanceIntent ? { ...result.relanceIntent, at: Date.now() } : null;
  const notice = buildRelanceNotice(outcome, pendingRelance, newIntent);

  await wa.sendTextMessage(phone, result.reply + (notice ? "\n\n" + notice : ""));
  await saveSession(phone, {
    history: result.history,
    pendingForecast: session.pendingForecast,
    pendingRelance: newIntent,
  });
}

module.exports = {
  handleDgMessage,
  // Exposés pour les tests unitaires (fonctions pures, sans I/O).
  normalizeRelanceReply,
  resolvePendingRelance,
  buildRelanceNotice,
  PENDING_RELANCE_TTL_MS,
};
