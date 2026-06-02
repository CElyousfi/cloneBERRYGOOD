/**
 * forecastService.js — Driscoll's price forecast extraction & persistence.
 *
 * Extracted from emailService.js (liquidation-forecast-extract / -save routes)
 * to be reusable from both HTTP handlers and the WhatsApp DG bot.
 */

const { admin, db } = require("./config/firebase");

const FRUIT_LABEL = { RASP: "Raspberries (framboise)", BLUE: "Blueberries (myrtille)" };
const FRUIT_NAME = { RASP: "framboise", BLUE: "myrtille" };

function buildPrompt(fruitCode) {
  const fruitLabel = FRUIT_LABEL[fruitCode];
  return `Tu reçois un slide Driscoll's de prévision hebdomadaire (${fruitLabel}).
Repère la ligne intitulée "2026 Grower return prices" (valeurs en MAD).
Pour chaque colonne de semaine en en-tête (format "Week NN 2026 FC" ou similaire), extrais :
- week (entier, ex 17)
- year (entier, normalement 2026 — lis-le dans l'en-tête)
- minMad (float, première valeur de la cellule, sans "MAD")
- maxMad (float, deuxième valeur, ou identique à min si une seule)

Ignore les autres lignes (2026 Price, 2025 Price, Volume, Vs 2025, etc.).
Si une cellule de cette ligne est vide ou noire, omets simplement cette semaine.

Réponds STRICTEMENT en JSON, sans prose, sans bloc markdown :
{"weeks":[{"week":17,"year":2026,"minMad":36.76,"maxMad":44.49}, ...]}`;
}

// Prompt for when the fruit is unknown — Claude detects it from the slide title.
function buildAutoPrompt() {
  return `Tu reçois un slide Driscoll's de prévision hebdomadaire de prix.

ÉTAPE 1 — Identifie le fruit d'après le titre du slide :
- "Blueberries" → fruitCode "BLUE"
- "Raspberries" → fruitCode "RASP"

ÉTAPE 2 — Repère la ligne intitulée "2026 Grower return prices" (valeurs en MAD).
Pour chaque colonne de semaine en en-tête (format "Week NN 2026 FC" ou similaire), extrais :
- week (entier, ex 17)
- year (entier, normalement 2026 — lis-le dans l'en-tête)
- minMad (float, première valeur de la cellule, sans "MAD")
- maxMad (float, deuxième valeur, ou identique à min si une seule)

Ignore les autres lignes (2026 Price, 2025 Price, Volume, Vs 2025, etc.).
Si une cellule de cette ligne est vide ou noire, omets simplement cette semaine.

Réponds STRICTEMENT en JSON, sans prose, sans bloc markdown :
{"fruitCode":"BLUE","weeks":[{"week":17,"year":2026,"minMad":36.76,"maxMad":44.49}, ...]}`;
}

// Haiku 4.5 first — 3-5x faster on simple table OCR. Falls back to Sonnet/Opus if Haiku fails.
const MODEL_CANDIDATES = ["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-7", "claude-sonnet-4-5", "claude-opus-4-6"];

/**
 * Run a Claude Vision call with model fallback.
 * @returns {Promise<{ response: object } | { error: string, detail?: string }>}
 */
async function callClaudeVision(prompt, imageBase64, mediaType) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { error: "Clé API Anthropic non configurée" };

  const cleanB64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const mt = (mediaType || "image/png").toLowerCase();

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  let response = null;
  let lastError = null;
  for (const modelId of MODEL_CANDIDATES) {
    try {
      response = await client.messages.create({
        model: modelId,
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mt, data: cleanB64 } },
            { type: "text", text: prompt },
          ],
        }],
      });
      break;
    } catch (e) {
      lastError = e;
      console.error("Forecast extract model failed", modelId, e.message);
    }
  }
  if (!response) {
    return { error: "LLM_UNAVAILABLE", detail: lastError?.message || "Aucun modèle Claude n'a répondu" };
  }
  return { response };
}

// Parse the JSON object embedded in a Claude text response.
function parseClaudeJson(response) {
  const text = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  try {
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd < 0) throw new Error("No JSON in response");
    return { parsed: JSON.parse(text.slice(jsonStart, jsonEnd + 1)) };
  } catch (e) {
    return { error: "Réponse Claude non parsable", raw: text.slice(0, 500) };
  }
}

// Normalize a raw weeks array from Claude into clean {week,year,minMad,maxMad} entries.
function normalizeWeeks(rawWeeks) {
  return (rawWeeks || []).filter(w =>
    Number.isFinite(w.week) && Number.isFinite(w.minMad) && Number.isFinite(w.maxMad)
  ).map(w => ({
    week: parseInt(w.week),
    year: parseInt(w.year) || new Date().getFullYear(),
    minMad: Math.round(w.minMad * 100) / 100,
    maxMad: Math.round(w.maxMad * 100) / 100,
  }));
}

/**
 * Extract weekly forecast prices from a Driscoll's slide image using Claude Vision.
 * @param {"RASP"|"BLUE"} fruitCode
 * @param {string} imageBase64 — raw base64 (with or without data: prefix)
 * @param {string} [mediaType] — image MIME type, default "image/png"
 * @returns {Promise<{ success: true, weeks: Array<{week,year,minMad,maxMad}>, model: string } | { success: false, error: string, detail?: string, raw?: string }>}
 */
async function extractForecastFromImage(fruitCode, imageBase64, mediaType) {
  if (!["RASP", "BLUE"].includes(fruitCode)) {
    return { success: false, error: "fruitCode (RASP|BLUE) requis" };
  }
  if (!imageBase64) return { success: false, error: "imageBase64 requis" };

  const call = await callClaudeVision(buildPrompt(fruitCode), imageBase64, mediaType);
  if (call.error) return { success: false, error: call.error, detail: call.detail };

  const j = parseClaudeJson(call.response);
  if (j.error) return { success: false, error: j.error, raw: j.raw };

  return { success: true, fruitCode, weeks: normalizeWeeks(j.parsed.weeks), model: call.response.model };
}

/**
 * Extract a forecast WITHOUT knowing the fruit upfront — Claude detects it from
 * the slide title. Used by the WhatsApp DG bot where the user just sends a photo.
 * @param {string} imageBase64 — raw base64 (with or without data: prefix)
 * @param {string} [mediaType] — image MIME type, default "image/png"
 * @returns {Promise<{ success: true, fruitCode: "RASP"|"BLUE", weeks: Array, model: string } | { success: false, error: string, detail?: string, raw?: string }>}
 */
async function extractForecastAuto(imageBase64, mediaType) {
  if (!imageBase64) return { success: false, error: "imageBase64 requis" };

  const call = await callClaudeVision(buildAutoPrompt(), imageBase64, mediaType);
  if (call.error) return { success: false, error: call.error, detail: call.detail };

  const j = parseClaudeJson(call.response);
  if (j.error) return { success: false, error: j.error, raw: j.raw };

  const fruitCode = String(j.parsed.fruitCode || "").toUpperCase();
  if (!["RASP", "BLUE"].includes(fruitCode)) {
    return { success: false, error: "Fruit non reconnu sur le slide (attendu Blueberries ou Raspberries)" };
  }
  const weeks = normalizeWeeks(j.parsed.weeks);
  if (weeks.length === 0) {
    return { success: false, error: "Aucune semaine de prix détectée sur le slide" };
  }
  return { success: true, fruitCode, weeks, model: call.response.model };
}

/**
 * Upload a forecast slide image to Storage and return its public URL.
 * Returns null on failure (non-fatal).
 */
async function uploadForecastImage(fruitCode, year, imageBase64, mediaType) {
  try {
    const bucket = admin.storage().bucket("berrygood-farms-photos");
    const cleanB64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
    const mt = (mediaType || "image/png").toLowerCase();
    const ext = mt.split("/")[1] || "png";
    const storagePath = `liquidation_forecasts/${fruitCode}_${year}_${Date.now()}.${ext}`;
    const file = bucket.file(storagePath);
    await file.save(Buffer.from(cleanB64, "base64"), { metadata: { contentType: mt } });
    return `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
  } catch (e) {
    console.warn("Forecast image upload failed (continuing):", e.message);
    return null;
  }
}

/**
 * Save (merge) weekly forecast prices into Firestore.
 * @param {"RASP"|"BLUE"} fruitCode
 * @param {number} year
 * @param {Array<{week,minMad,maxMad}>} weeks
 * @param {object} [opts]
 * @param {string} [opts.updatedBy] — actor identifier (email/uid/phone)
 * @param {string} [opts.imageBase64] — optional source image to archive
 * @param {string} [opts.mediaType]
 * @param {string} [opts.sourceImageUrl] — pre-uploaded image URL (skips re-upload)
 * @returns {Promise<{ success: true, forecast: object } | { success: false, error: string }>}
 */
async function saveForecast(fruitCode, year, weeks, opts = {}) {
  if (!["RASP", "BLUE"].includes(fruitCode)) {
    return { success: false, error: "fruitCode (RASP|BLUE) requis" };
  }
  const yr = parseInt(year);
  if (!yr) return { success: false, error: "year requis" };
  if (!Array.isArray(weeks) || weeks.length === 0) {
    return { success: false, error: "weeks (array non vide) requis" };
  }

  let sourceImageUrl = opts.sourceImageUrl || null;
  if (!sourceImageUrl && opts.imageBase64) {
    sourceImageUrl = await uploadForecastImage(fruitCode, yr, opts.imageBase64, opts.mediaType);
  }

  const docId = `FORECAST-${fruitCode}-${yr}`;
  const weeksObj = {};
  weeks.forEach(w => {
    const wk = parseInt(w.week);
    const mn = parseFloat(w.minMad);
    const mx = parseFloat(w.maxMad);
    if (!Number.isFinite(wk) || !Number.isFinite(mn) || !Number.isFinite(mx)) return;
    weeksObj[String(wk)] = {
      minMad: Math.round(mn * 100) / 100,
      maxMad: Math.round(mx * 100) / 100,
      avgMad: Math.round(((mn + mx) / 2) * 100) / 100,
    };
  });

  const payload = {
    fruit: FRUIT_NAME[fruitCode],
    fruitCode,
    year: yr,
    weeks: weeksObj,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: opts.updatedBy || "unknown",
  };
  if (sourceImageUrl) payload.sourceImageUrl = sourceImageUrl;

  const ref = db.collection("liquidation_forecasts").doc(docId);
  const existing = await ref.get();
  if (existing.exists) {
    const prev = existing.data() || {};
    const mergedWeeks = { ...(prev.weeks || {}), ...weeksObj };
    await ref.set({ ...payload, weeks: mergedWeeks }, { merge: true });
  } else {
    await ref.set(payload);
  }
  const after = await ref.get();
  return { success: true, forecast: { id: docId, ...after.data() } };
}

/**
 * Read forecast for a fruit/year. Returns null if not found.
 */
async function getForecast(fruitCode, year) {
  const docId = `FORECAST-${fruitCode}-${year}`;
  const snap = await db.collection("liquidation_forecasts").doc(docId).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

module.exports = {
  extractForecastFromImage,
  extractForecastAuto,
  uploadForecastImage,
  saveForecast,
  getForecast,
};
