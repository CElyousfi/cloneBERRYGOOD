/**
 * audioService.js — Speech-to-text via OpenAI Whisper.
 *
 * Uses direct fetch to OpenAI REST API (no SDK needed).
 * WhatsApp voice notes arrive as ogg/opus — natively supported by Whisper.
 */

async function transcribeAudio(buffer, mimeType) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { success: false, error: "OPENAI_API_KEY manquante" };

  const mt = (mimeType || "audio/ogg").toLowerCase();
  const ext = mt.includes("ogg") ? "ogg"
            : mt.includes("webm") ? "webm"
            : mt.includes("mp3") || mt.includes("mpeg") ? "mp3"
            : mt.includes("wav") ? "wav"
            : mt.includes("m4a") || mt.includes("mp4") ? "m4a"
            : "ogg";

  try {
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mt }), `audio.${ext}`);
    form.append("model", "whisper-1");
    form.append("language", "fr");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Whisper error:", data);
      return { success: false, error: data.error?.message || `HTTP ${res.status}` };
    }
    const text = (data.text || "").trim();
    if (!text) return { success: false, error: "Transcription vide" };
    return { success: true, text };
  } catch (err) {
    console.error("Whisper call failed:", err);
    return { success: false, error: err.message };
  }
}

module.exports = { transcribeAudio };
