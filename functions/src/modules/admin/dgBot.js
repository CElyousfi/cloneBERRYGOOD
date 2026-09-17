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

const { db } = require("../../../config/firebase");
const wa = require("./whatsappService");
const dgAgent = require("./dgAgent");
const forecastService = require("../recolte/forecastService");
const { parseForecastConfirmation } = require("../../../lib/forecastConfirmation");
const { remindBdcCore } = require("../magasin/bdcReminderService");

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
  // Session expirée (30 min) : la relance en attente disparaît AVEC elle, sans
  // annonce. Sens sûr (une intention de 30 min n'aurait de toute façon pas passé
  // le TTL de 5 min), mais l'annulation est ici la seule qui soit silencieuse.
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
 * Deux intentions désignent-elles le MÊME BdC ? Comparaison sur l'id ET sur le
 * numéro : le libellé affiché retombe sur l'id quand `numero` manque, comparer
 * le libellé seul manquerait alors l'égalité et annoncerait un faux remplacement.
 * @param {{numero?:string, id?:string}|null|undefined} a
 * @param {{numero?:string, id?:string}|null|undefined} b
 */
function isSameBdc(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return Boolean(a.numero) && a.numero === b.numero;
}

/**
 * Message d'annulation à afficher au DG. Une annulation n'est JAMAIS silencieuse
 * — sauf quand la nouvelle demande porte sur le MÊME BdC : on redemande alors
 * simplement confirmation (idempotent), annoncer une annulation serait faux.
 *
 * @param {'none'|'confirm'|'cancel'|'expired'} outcome
 * @param {{numero?:string, id?:string}|null|undefined} pending
 * @param {{numero?:string, id?:string}|null|undefined} newIntent — intention posée par le même tour
 * @returns {string|null}
 */
function buildRelanceNotice(outcome, pending, newIntent) {
  if (!pending) return null;
  if (outcome !== "cancel" && outcome !== "expired") return null;
  const numero = pending.numero || pending.id || "ce BdC";
  if (isSameBdc(pending, newIntent)) return null;
  if (newIntent) {
    return `🚫 La demande de relance sur *${numero}* est annulée (rien envoyé) ; je te demande confirmation pour *${newIntent.numero}*.`;
  }
  if (outcome === "expired") {
    return `⏳ La demande de relance sur *${numero}* a expiré (5 min sans confirmation) — aucun rappel n'a été envoyé.`;
  }
  return `🚫 La demande de relance sur *${numero}* est annulée faute de confirmation — aucun rappel n'a été envoyé.`;
}

/**
 * Le message va-t-il être capté par la confirmation forecast ? Décidé AVANT de
 * consommer la relance : un « oui » adressé au slide de prévision ne doit jamais
 * partir en rappel WhatsApp. Réplique exactement les conditions de sortie de
 * handleForecastConfirmation (pending vivant + réponse oui/non reconnue).
 *
 * @param {{at?:number}|null|undefined} pendingForecast
 * @param {string} userText
 * @param {number} now — timestamp ms injecté
 * @returns {boolean}
 */
function forecastCaptures(pendingForecast, userText, now) {
  if (!pendingForecast) return false;
  if (pendingForecast.at && now - pendingForecast.at > PENDING_FORECAST_TTL_MS) return false;
  return parseForecastConfirmation(userText) !== "unknown";
}

/**
 * Sort de la relance pour CE message. Un « oui » capté par la confirmation
 * forecast ne confirme PAS la relance : il est dégradé en annulation (annoncée),
 * jamais en envoi. Le défaut penche toujours vers le non-envoi.
 *
 * @param {{numero?:string, id?:string, at?:number}|null|undefined} pendingRelance
 * @param {{at?:number}|null|undefined} pendingForecast
 * @param {string} userText
 * @param {number} now — timestamp ms injecté
 * @returns {'none'|'confirm'|'cancel'|'expired'}
 */
function relanceOutcomeForMessage(pendingRelance, pendingForecast, userText, now) {
  const { outcome } = resolvePendingRelance(pendingRelance, userText, now);
  if (outcome === "confirm" && forecastCaptures(pendingForecast, userText, now)) return "cancel";
  return outcome;
}

/**
 * Intentions écrasées DANS le même tour (le modèle a appelé `relancer_bdc`
 * plusieurs fois) : seule la dernière est armée, les précédentes disparaissent —
 * on l'annonce au lieu de les perdre en silence.
 *
 * @param {Array<string>|null|undefined} discardedNumeros
 * @param {{numero?:string}|null|undefined} newIntent
 * @returns {string|null}
 */
function buildDiscardedIntentsNotice(discardedNumeros, newIntent) {
  const list = (discardedNumeros || []).filter(Boolean);
  if (!list.length) return null;
  const cible = (newIntent && newIntent.numero) || "la dernière demande";
  return `🚫 ${list.map((n) => `*${n}*`).join(", ")} : demande(s) de relance abandonnée(s), rien envoyé — je ne garde que *${cible}*.`;
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

  // ── Text → relance en attente, puis pending-forecast confirmation, puis agent
  const userText = msg.type === "text" ? (msg.text?.body || "").trim() : "";

  const session = await loadSession(phone);

  // ── INVARIANT : l'intention de relance est consommée par CE message, quel
  // qu'il soit — y compris un texte vide, et y compris quand la confirmation
  // forecast capte le message et sort avant l'agent. La consommation est donc
  // CENTRALISÉE ICI, en amont de tout autre mécanisme, et PERSISTÉE tout de
  // suite : aucun chemin de sortie en aval ne peut laisser l'intention vivante.
  const pendingRelance = session.pendingRelance;
  const outcome = relanceOutcomeForMessage(pendingRelance, session.pendingForecast, userText, Date.now());
  session.pendingRelance = null;

  if (outcome === "confirm") {
    await sendConfirmedRelance(phone, session, pendingRelance);
    return;
  }
  if (outcome === "cancel" || outcome === "expired") {
    // Persistance immédiate de la consommation. L'annonce, elle, attend de
    // savoir si le tour repose une demande sur le même BdC (idempotence).
    await saveSession(phone, {
      history: session.history,
      pendingForecast: session.pendingForecast,
      pendingRelance: null,
    });
  }

  const announceCancellation = async () => {
    const notice = buildRelanceNotice(outcome, pendingRelance, null);
    if (notice) await wa.sendTextMessage(phone, notice);
  };

  if (!userText) {
    await announceCancellation();
    return;
  }

  if (await handleForecastConfirmation(phone, user, userText, session)) {
    await announceCancellation();
    return;
  }

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
  const notices = [
    buildRelanceNotice(outcome, pendingRelance, newIntent),
    // Plusieurs `relancer_bdc` dans le même tour : les intentions écrasées en
    // cours de route sont annoncées, jamais perdues en silence.
    buildDiscardedIntentsNotice(result.relanceDiscarded, newIntent),
  ].filter(Boolean);

  await wa.sendTextMessage(phone, [result.reply, ...notices].join("\n\n"));
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
  relanceOutcomeForMessage,
  buildRelanceNotice,
  buildDiscardedIntentsNotice,
  PENDING_RELANCE_TTL_MS,
};
