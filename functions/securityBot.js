/**
 * securityBot.js — Conversational WhatsApp bot for security agents.
 *
 * Flows:
 *  - Daily visitor register : photo → Claude Vision OCR → confirm/cancel → save
 *  - Incident report        : badge photo → OCR → incident photo → description → save
 *
 * State is persisted in Firestore collection `whatsapp_sessions` keyed by phone.
 * Sessions expire after 30 minutes of inactivity.
 */

const { db, bucket } = require("./config/firebase");
const wa = require("./whatsappService");

const SESSION_TTL_MS = 30 * 60 * 1000;

const BTN = {
  REGISTRE: "SEC_REGISTRE",
  INCIDENT: "SEC_INCIDENT",
  CONFIRM: "SEC_CONFIRM",
  CANCEL: "SEC_CANCEL",
  INCIDENT_FIN: "SEC_INC_FIN",
};

// ─────────────────────────────────────────────────────────────────────────────
// Session helpers
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
    { phone, ...patch, updatedAt: now, expiresAt: now + SESSION_TTL_MS },
    { merge: true }
  );
}

async function resetSession(phone) {
  await db.collection("whatsapp_sessions").doc(phone).delete().catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// Outbound helpers
// ─────────────────────────────────────────────────────────────────────────────

function sendMenu(phone) {
  return wa.sendInteractiveButtons(
    phone,
    "Bonjour 👋 Que souhaitez-vous faire ?",
    [
      { id: BTN.REGISTRE, title: "Registre quotidien" },
      { id: BTN.INCIDENT, title: "Signaler incident" },
    ]
  );
}

function sendText(phone, text) {
  return wa.sendTextMessage(phone, text);
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────────────────────────

async function uploadToStorage(buffer, mimeType, subpath) {
  const ts = Date.now();
  const ext = mimeExt(mimeType);
  const storagePath = `scans/security/${subpath}/${ts}.${ext}`;
  const file = bucket.file(storagePath);
  await file.save(buffer, { metadata: { contentType: mimeType } });
  // Make publicly readable via tokenless URL (bucket-level rules govern access)
  return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
}

function mimeExt(mime) {
  if (!mime) return "bin";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("pdf")) return "pdf";
  return "bin";
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Vision OCR
// ─────────────────────────────────────────────────────────────────────────────

async function callClaudeVision(buffer, mimeType, prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY manquante");
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const base64 = buffer.toString("base64");
  const mediaType = mimeType.startsWith("image/") ? mimeType : "image/jpeg";
  const content = [
    { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
    { type: "text", text: prompt },
  ];

  let response;
  for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
    try {
      response = await client.messages.create({
        model: modelId,
        max_tokens: 3000,
        messages: [{ role: "user", content }],
      });
      break;
    } catch (e) {
      console.error("Claude vision model error", modelId, e.message);
      if (modelId === "claude-opus-4-20250514") throw e;
    }
  }
  const text = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Réponse IA non-JSON: " + text.slice(0, 200));
  return JSON.parse(m[0]);
}

const REGISTRE_PROMPT = `Tu analyses la photo d'une page de registre de sécurité (visiteurs / intervenants) d'une ferme au Maroc. Écriture manuscrite, papier à carreaux, mélange français/arabe possible.

Colonnes typiques (gauche à droite) : Date, Nom et Prénom, Entreprise/Service, Pièce d'identité (type + numéro), Heure d'arrivée, Heure de départ, N° Badge, Immatriculation véhicule, Motif de visite.

Retourne UNIQUEMENT un JSON strict (sans texte avant/après) :
{
  "date_page": "YYYY-MM-DD ou null",
  "lignes": [
    {
      "date": "JJ/MM/AA ou null",
      "nom": "...",
      "entreprise": "... ou null",
      "piece_type": "CNI|Passeport|Permis|null",
      "piece_num": "... ou null",
      "heure_arrivee": "HH:MM ou null",
      "heure_depart": "HH:MM ou null",
      "badge": "... ou null",
      "immatriculation": "... ou null",
      "motif": "... ou null"
    }
  ],
  "confidence": 0.0,
  "notes": "remarques de lecture"
}

Si une cellule est illisible, mets null. Ne jamais inventer.`;

const BADGE_PROMPT = `Tu analyses la photo d'un badge employé d'une ferme agricole au Maroc. Le badge contient typiquement : matricule (numéro), nom, prénom, fonction/poste, parfois ferme.

Retourne UNIQUEMENT un JSON strict :
{
  "matricule": "...",
  "nom": "...",
  "prenom": "...",
  "fonction": "... ou null",
  "ferme": "... ou null",
  "confidence": 0.0
}

Si un champ est illisible ou absent : null. Ne jamais inventer.`;

async function ocrRegistreVisiteurs(buffer, mimeType) {
  return await callClaudeVision(buffer, mimeType, REGISTRE_PROMPT);
}

async function ocrBadgeEmploye(buffer, mimeType) {
  return await callClaudeVision(buffer, mimeType, BADGE_PROMPT);
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatRegistreRecap(ocr) {
  const lignes = ocr.lignes || [];
  if (!lignes.length) return "⚠️ Aucune ligne détectée sur le scan.";
  const lines = lignes.map((l, i) => {
    const parts = [
      `${i + 1}. ${l.nom || "?"}`,
      l.entreprise ? `(${l.entreprise})` : "",
      l.heure_arrivee ? `arr.${l.heure_arrivee}` : "",
      l.heure_depart ? `dép.${l.heure_depart}` : "",
      l.immatriculation ? `🚗${l.immatriculation}` : "",
      l.motif ? `— ${l.motif}` : "",
    ].filter(Boolean).join(" ");
    return parts;
  });
  const header = `📋 ${lignes.length} visiteur(s) détecté(s)`;
  // WhatsApp interactive body max 1024 chars
  const body = [header, "", ...lines].join("\n");
  return body.length > 950 ? body.slice(0, 950) + "\n…" : body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle one inbound message from a security agent.
 * @param {string} phone — sender E.164 phone (e.g. "+212661...")
 * @param {object} user — { uid, displayName, profileId, ferme, ... }
 * @param {object} msg  — raw WhatsApp message object from webhook
 */
async function handleSecurityMessage(phone, user, msg) {
  const session = await loadSession(phone);
  const flow = session?.flow || null;
  const step = session?.step || null;

  // Extract input
  const buttonId = msg.type === "interactive"
    ? (msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || null)
    : null;
  const textBody = msg.type === "text" ? (msg.text?.body || "").trim() : "";
  const mediaId = msg.type === "image" ? msg.image?.id
                : msg.type === "document" ? msg.document?.id
                : null;

  // ── No active session → show menu (ignore content)
  if (!session) {
    await saveSession(phone, { profileId: user.profileId, flow: "menu", step: "awaiting_choice", data: {} });
    await sendMenu(phone);
    return;
  }

  // ── Menu choice
  if (step === "awaiting_choice") {
    if (buttonId === BTN.REGISTRE) {
      await saveSession(phone, { flow: "registre", step: "awaiting_registre_photo", data: {} });
      await sendText(phone, "📸 Envoyez la photo de la page du registre.");
      return;
    }
    if (buttonId === BTN.INCIDENT) {
      await saveSession(phone, { flow: "incident", step: "awaiting_badge_photo", data: {} });
      await sendText(phone, "🪪 Envoyez d'abord la photo du badge de l'employé concerné.");
      return;
    }
    // Re-prompt menu
    await sendMenu(phone);
    return;
  }

  // ── Registre flow
  if (flow === "registre" && step === "awaiting_registre_photo") {
    if (!mediaId) {
      await sendText(phone, "Merci d'envoyer une *photo* du registre.");
      return;
    }
    const dl = await wa.downloadMedia(mediaId);
    if (dl.error || !dl.buffer) {
      await sendText(phone, "❌ Téléchargement impossible : " + (dl.error || "inconnu"));
      return;
    }
    let ocr, scanUrl;
    try {
      scanUrl = await uploadToStorage(dl.buffer, dl.mimeType, "registres");
      ocr = await ocrRegistreVisiteurs(dl.buffer, dl.mimeType);
    } catch (e) {
      console.error("OCR registre error:", e);
      await sendText(phone, "❌ Analyse impossible : " + e.message + "\nEssayez avec une photo plus nette.");
      await resetSession(phone);
      return;
    }
    await saveSession(phone, {
      step: "awaiting_registre_confirm",
      data: { scanUrl, ocr, mediaId },
    });
    const recap = formatRegistreRecap(ocr);
    await wa.sendInteractiveButtons(
      phone,
      recap + "\n\nConfirmer l'enregistrement ?",
      [
        { id: BTN.CONFIRM, title: "✅ Confirmer" },
        { id: BTN.CANCEL, title: "❌ Annuler" },
      ]
    );
    return;
  }

  if (flow === "registre" && step === "awaiting_registre_confirm") {
    if (buttonId === BTN.CONFIRM) {
      const data = session.data || {};
      const todayISO = new Date().toISOString().slice(0, 10);
      await db.collection("security_envois_registre").add({
        date: todayISO,
        ferme: user.ferme || null,
        scan_url: data.scanUrl || null,
        ocr: data.ocr || null,
        agent_phone: phone,
        agent_name: user.displayName || null,
        agent_uid: user.uid || null,
        wa_media_id: data.mediaId || null,
        wa_message_id: msg.id || null,
        confirmed: true,
        createdAt: Date.now(),
      });
      await sendText(phone, "✅ Registre enregistré. Merci.");
      await resetSession(phone);
      return;
    }
    if (buttonId === BTN.CANCEL) {
      await sendText(phone, "❌ Envoi annulé. Renvoyez n'importe quel message pour revenir au menu.");
      await resetSession(phone);
      return;
    }
    // Any other input → re-ask
    await sendText(phone, "Veuillez répondre par les boutons Confirmer ou Annuler.");
    return;
  }

  // ── Incident flow
  if (flow === "incident" && step === "awaiting_badge_photo") {
    if (!mediaId) {
      await sendText(phone, "Merci d'envoyer une *photo* du badge employé.");
      return;
    }
    const dl = await wa.downloadMedia(mediaId);
    if (dl.error || !dl.buffer) {
      await sendText(phone, "❌ Téléchargement impossible : " + (dl.error || "inconnu"));
      return;
    }
    let badgeOcr, badgeUrl;
    try {
      badgeUrl = await uploadToStorage(dl.buffer, dl.mimeType, "badges");
      badgeOcr = await ocrBadgeEmploye(dl.buffer, dl.mimeType);
    } catch (e) {
      console.error("OCR badge error:", e);
      await sendText(phone, "❌ Analyse du badge impossible : " + e.message);
      await resetSession(phone);
      return;
    }
    await saveSession(phone, {
      step: "awaiting_incident_photo",
      data: { ...(session.data || {}), badgeUrl, badgeOcr },
    });
    const nomComplet = [badgeOcr.prenom, badgeOcr.nom].filter(Boolean).join(" ") || "(employé non identifié)";
    const matr = badgeOcr.matricule ? `(matricule ${badgeOcr.matricule})` : "";
    await sendText(phone, `🪪 Employé identifié : ${nomComplet} ${matr}\n\n📸 Envoyez maintenant la photo de l'incident.`);
    return;
  }

  if (flow === "incident" && step === "awaiting_incident_photo") {
    if (!mediaId) {
      await sendText(phone, "Merci d'envoyer une *photo* de l'incident.");
      return;
    }
    const dl = await wa.downloadMedia(mediaId);
    if (dl.error || !dl.buffer) {
      await sendText(phone, "❌ Téléchargement impossible : " + (dl.error || "inconnu"));
      return;
    }
    let incidentUrl;
    try {
      incidentUrl = await uploadToStorage(dl.buffer, dl.mimeType, "incidents");
    } catch (e) {
      await sendText(phone, "❌ Upload impossible : " + e.message);
      await resetSession(phone);
      return;
    }
    await saveSession(phone, {
      step: "awaiting_incident_desc",
      data: { ...(session.data || {}), incidentUrl },
    });
    await sendText(phone, "📝 Décrivez brièvement l'incident (un message texte). Tapez « fin » pour enregistrer sans description.");
    return;
  }

  if (flow === "incident" && step === "awaiting_incident_desc") {
    if (!textBody) {
      await sendText(phone, "Merci d'envoyer une *description texte* (ou « fin »).");
      return;
    }
    const data = session.data || {};
    const description = textBody.toLowerCase() === "fin" ? "" : textBody;
    const todayISO = new Date().toISOString().slice(0, 10);
    await db.collection("security_incidents").add({
      date: todayISO,
      ferme: user.ferme || null,
      badge_url: data.badgeUrl || null,
      badge_ocr: data.badgeOcr || null,
      incident_url: data.incidentUrl || null,
      description,
      agent_phone: phone,
      agent_name: user.displayName || null,
      agent_uid: user.uid || null,
      wa_message_id: msg.id || null,
      createdAt: Date.now(),
    });
    await sendText(phone, "✅ Incident enregistré. Merci de votre vigilance.");
    await resetSession(phone);
    return;
  }

  // Unknown state → reset + menu
  await resetSession(phone);
  await sendMenu(phone);
}

module.exports = {
  handleSecurityMessage,
  // Exposed for testing
  ocrRegistreVisiteurs,
  ocrBadgeEmploye,
};
