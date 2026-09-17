/**
 * magasinierBot.js — Bot WhatsApp entrant pour le canal de soumission des
 * fichiers stock quotidiens (Berry Good / Bahia), EN PLUS de l'onglet
 * "Soumission Fichier Stock" côté app. Les 2 canaux convergent sur la même
 * écriture Firestore partagée (functions/lib/stockFiles/recordSubmission.js)
 * — voir docs/spec-collecte-stock-magasinier.md §4.5.
 *
 * Modelé sur securityBot.js : téléchargement média → validation taille/MIME
 * (même règle que le canal app, scanAttachment.validateAttachmentMetadata)
 * → upload Storage → confirmation par boutons SI la ferme est ambiguë →
 * écriture Firestore.
 *
 * Désambiguïsation ferme (spec §2) :
 *   1. Légende (caption) contient un mot-clé sans ambiguïté → upload direct
 *      vers le chemin final, enregistrement immédiat, pas de question.
 *   2. Sinon → upload vers un chemin TEMPORAIRE (stock_files/_pending/...),
 *      état conservé dans whatsapp_sessions/{phone} (state
 *      "awaiting_farm_choice"), boutons interactifs "Berry Good" / "Bahia".
 *      La réponse au bouton déplace l'objet Storage vers le chemin final
 *      puis enregistre.
 *
 * Toute erreur (téléchargement, upload, écriture Firestore) répond un
 * message WhatsApp explicite au magasinier + console.error détaillé — un
 * fichier envoyé ne doit JAMAIS "disparaître" silencieusement.
 */

const { db, bucket } = require("../../../config/firebase");
const wa = require("../admin/whatsappService");
const scanAttachment = require("../../../lib/stock/scanAttachment");
const stockFilesRecord = require("../../../lib/stockFiles/recordSubmission");
const { detectFarmFromCaption } = require("../../../lib/stockFiles/farmDetection");
const { STOCK_FILE_ALLOWED_MIME, STOCK_FILE_ALLOWED_FORMATS_LABEL } = require("../../../lib/stockFiles/allowedMime");

const SESSION_TTL_MS = 30 * 60 * 1000;

const BTN = {
  FARM_BG: "MAG_FARM_BG",
  FARM_BAHIA: "MAG_FARM_BAHIA",
};

const FARM_LABELS = stockFilesRecord.FARM_LABELS;

// ─────────────────────────────────────────────────────────────────────────────
// Session helpers (même pattern que securityBot.js — whatsapp_sessions/{phone})
// ─────────────────────────────────────────────────────────────────────────────

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
    { phone, bot: "magasinier", ...patch, updatedAt: now, expiresAt: now + SESSION_TTL_MS },
    { merge: true }
  );
}

async function resetSession(phone) {
  await db.collection("whatsapp_sessions").doc(phone).delete().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────────────────────────

function extOfFilenameOrMime(filename, mimeType) {
  const fromName = scanAttachment.utils.extOf(filename);
  if (fromName) return fromName;
  const m = mimeType || "";
  if (m.indexOf("pdf") >= 0) return "pdf";
  if (m.indexOf("jpeg") >= 0 || m.indexOf("jpg") >= 0) return "jpg";
  if (m.indexOf("png") >= 0) return "png";
  if (m.indexOf("webp") >= 0) return "webp";
  if (m.indexOf("heic") >= 0) return "heic";
  return "bin";
}

async function uploadStockFile(buffer, mimeType, storagePath) {
  await bucket.file(storagePath).save(buffer, { metadata: { contentType: mimeType } });
  return storagePath;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Traite un message WhatsApp entrant du magasinier.
 * @param {string} phone — numéro E.164 de l'expéditeur (ex. "+212661...")
 * @param {object} user — { uid, displayName, profileId, ... } (déjà résolu par whatsappProcessor.js)
 * @param {object} msg — message brut du webhook Meta
 */
async function handleMessage(phone, user, msg) {
  const buttonId = msg.type === "interactive" ? (msg.interactive?.button_reply?.id || null) : null;
  if (buttonId) {
    return handleFarmButtonReply(phone, user, buttonId);
  }

  const mediaId = msg.type === "document" ? msg.document?.id
                : msg.type === "image" ? msg.image?.id
                : null;
  if (mediaId) {
    return handleIncomingFile(phone, user, msg, mediaId);
  }

  // Tout autre type de message (texte libre, audio, …)
  const session = await loadSession(phone);
  if (session && session.state === "awaiting_farm_choice") {
    await wa.sendTextMessage(phone, "Merci de répondre avec les boutons « Berry Good » / « Bahia » ci-dessus.");
    return;
  }
  await wa.sendTextMessage(
    phone,
    "📦 Envoyez le fichier stock du jour (" + STOCK_FILE_ALLOWED_FORMATS_LABEL + "), avec « BG » ou « Bahia » dans la légende si possible."
  );
}

async function handleIncomingFile(phone, user, msg, mediaId) {
  const dl = await wa.downloadMedia(mediaId);
  if (dl.error || !dl.buffer) {
    console.error("[magasinierBot] downloadMedia error:", phone, dl.error);
    await wa.sendTextMessage(phone, "❌ Téléchargement impossible : " + (dl.error || "inconnu") + ". Réessayez.");
    return;
  }

  // Même règle taille/MIME que le canal app — pas de règle dupliquée.
  const metaCheck = scanAttachment.validateAttachmentMetadata({ size: dl.buffer.length, contentType: dl.mimeType }, STOCK_FILE_ALLOWED_MIME);
  if (!metaCheck.valid) {
    await wa.sendTextMessage(phone, "❌ " + metaCheck.error + " Envoyez un fichier " + STOCK_FILE_ALLOWED_FORMATS_LABEL + ".");
    return;
  }

  const caption = msg.type === "document" ? (msg.document?.caption || "") : (msg.image?.caption || "");
  const rawFilename = (msg.type === "document" && msg.document?.filename) || null;
  const ext = extOfFilenameOrMime(rawFilename, dl.mimeType);
  const filename = rawFilename || ("stock_file." + ext);
  // Date TOUJOURS calculée côté serveur (Africa/Casablanca) — jamais l'horodatage du message.
  const date = stockFilesRecord.todayInCasablanca();
  const farm = detectFarmFromCaption(caption);
  const ts = Date.now();
  const submittedBy = { uid: user.uid || null, name: user.displayName || null, email: null, source: "whatsapp" };

  if (farm) {
    // Légende sans ambiguïté → upload direct, enregistrement immédiat.
    const finalPath = `stock_files/${date}/${farm}_${ts}.${ext}`;
    try {
      await uploadStockFile(dl.buffer, dl.mimeType, finalPath);
    } catch (err) {
      console.error("[magasinierBot] upload error:", phone, err.message);
      await wa.sendTextMessage(phone, "❌ Envoi au stockage impossible. Réessayez.");
      return;
    }
    const result = await stockFilesRecord.recordSubmission(
      { db, serverTimestamp: () => Date.now() },
      { date, farm, storagePath: finalPath, filename, submittedBy }
    );
    if (!result.success) {
      console.error("[magasinierBot] recordSubmission error:", phone, result.error);
      await wa.sendTextMessage(phone, "❌ Enregistrement impossible : " + result.error);
      return;
    }
    await resetSession(phone);
    await wa.sendTextMessage(phone, `✅ Fichier ${FARM_LABELS[farm]} reçu pour aujourd'hui.`);
    console.log(`[magasinierBot] Confirmation soumission envoyée — phone=${phone} ferme=${farm} date=${date}`);
    return;
  }

  // Ambiguïté → chemin temporaire + question par boutons interactifs.
  const pendingPath = `stock_files/_pending/${phone.replace(/[^0-9]/g, "")}_${ts}.${ext}`;
  try {
    await uploadStockFile(dl.buffer, dl.mimeType, pendingPath);
  } catch (err) {
    console.error("[magasinierBot] pending upload error:", phone, err.message);
    await wa.sendTextMessage(phone, "❌ Envoi au stockage impossible. Réessayez.");
    return;
  }

  await saveSession(phone, {
    state: "awaiting_farm_choice",
    pending_path: pendingPath,
    pending_filename: filename,
    pending_date: date,
  });

  await wa.sendInteractiveButtons(
    phone,
    "Pour quelle ferme est ce fichier stock ?",
    [
      { id: BTN.FARM_BG, title: "Berry Good" },
      { id: BTN.FARM_BAHIA, title: "Bahia" },
    ]
  );
}

async function handleFarmButtonReply(phone, user, buttonId) {
  const session = await loadSession(phone);
  if (!session || session.state !== "awaiting_farm_choice") {
    await wa.sendTextMessage(phone, "Rien à confirmer, envoyez d'abord un fichier.");
    return;
  }
  const farm = buttonId === BTN.FARM_BG ? "berry_good" : buttonId === BTN.FARM_BAHIA ? "bahia" : null;
  if (!farm) {
    await wa.sendTextMessage(phone, "Merci de répondre avec les boutons « Berry Good » / « Bahia » ci-dessus.");
    return;
  }

  const pendingPath = session.pending_path;
  const filename = session.pending_filename;
  const date = session.pending_date;
  const ext = scanAttachment.utils.extOf(pendingPath) || "bin";
  const finalPath = `stock_files/${date}/${farm}_${Date.now()}.${ext}`;

  try {
    await bucket.file(pendingPath).move(finalPath);
  } catch (err) {
    console.error("[magasinierBot] move pending→final error:", phone, err.message);
    await wa.sendTextMessage(phone, "❌ Impossible de finaliser l'envoi. Réessayez en renvoyant le fichier.");
    await resetSession(phone);
    return;
  }

  const submittedBy = { uid: user.uid || null, name: user.displayName || null, email: null, source: "whatsapp" };
  const result = await stockFilesRecord.recordSubmission(
    { db, serverTimestamp: () => Date.now() },
    { date, farm, storagePath: finalPath, filename, submittedBy }
  );
  if (!result.success) {
    console.error("[magasinierBot] recordSubmission error:", phone, result.error);
    await wa.sendTextMessage(phone, "❌ Enregistrement impossible : " + result.error);
    await resetSession(phone);
    return;
  }

  await resetSession(phone);
  await wa.sendTextMessage(phone, `✅ Fichier ${FARM_LABELS[farm]} reçu pour aujourd'hui.`);
  console.log(`[magasinierBot] Confirmation soumission envoyée — phone=${phone} ferme=${farm} date=${date}`);
}

module.exports = {
  handleMessage,
  // Exposed for testing/diagnostics
  detectFarmFromCaption,
};
