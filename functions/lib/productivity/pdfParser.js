/**
 * Productivity Report — PDF parser.
 *
 * Pipeline:
 *   1. pdf-parse → flat text
 *   2. Heuristic: extract week + campaign from filename/subject/text
 *   3. Claude SDK → structured JSON of treatments
 *   4. Caller passes through ranker.enrichTreatments() for F1/F5 stats
 *
 * The Claude prompt is intentionally permissive: when a section's structure
 * is ambiguous, Claude returns the best guess and we log warnings.
 */

const { PDFParse } = require('pdf-parse');

/** Models to try in order (first success wins). */
const MODEL_CANDIDATES = [
  'claude-opus-4-6',
  'claude-sonnet-4-5',
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
];

/**
 * Extract raw text from a PDF buffer.
 * @param {Buffer} pdfBuffer
 * @returns {Promise<string>}
 */
async function extractPdfText(pdfBuffer) {
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  return (result && result.text) || (typeof result === 'string' ? result : '');
}

/**
 * Heuristic extraction of week + campaign from subject/filename/text.
 *
 * Examples:
 *   subject "Grower productivity report W18 Moulay 2025/2026" → {week:18, campaign:"2025/2026"}
 *   filename "Grower Productivity report Moulay YTD (2025-2026) W18.pdf" → idem
 *   text "Week 18" + "Moulay 2025/2026" → idem
 *
 * @param {{ subject?: string, filename?: string, text?: string }} sources
 * @returns {{ week: number|null, campaign: string|null }}
 */
function extractWeekAndCampaign({ subject = '', filename = '', text = '' }) {
  const haystack = [subject, filename, text.slice(0, 2000)].join('\n');

  const weekMatch = haystack.match(/\bW(?:eek)?\s*[-_]?\s*(\d{1,2})\b/i);
  const week = weekMatch ? parseInt(weekMatch[1], 10) : null;

  // Match "2025/2026" or "2025-2026" → normalize to "2025/2026"
  const campMatch = haystack.match(/\b(20\d{2})\s*[/\-–]\s*(20\d{2})\b/);
  const campaign = campMatch ? `${campMatch[1]}/${campMatch[2]}` : null;

  return { week, campaign };
}

/**
 * Build the Claude prompt asking for structured JSON.
 */
function buildPrompt(pdfText) {
  return `Tu reçois le texte brut d'un PDF Driscoll's "Grower Productivity Report" (rapport hebdomadaire de productivité par grower).

Le PDF est organisé en sections par catégorie de baie (Raspberry, Blackberry, Strawberry, Blueberry) puis par traitement (variété × type de culture × cycle). Chaque traitement contient un histogramme listant pour chaque grower (identifié par un code numérique de 3-4 chiffres ou alphanumérique) :
- son rendement (Yield/ha en kg/ha, ou G/Plant en g/plant, ou Kg/Plant en kg/plant)
- sa semaine de plantation (Planting week, optionnel)

Une ligne "Average" (ou "AVR", "AVG", "Averag e") donne la moyenne du traitement.

**Ta tâche** : extraire chaque section en JSON strict, sans prose, sans bloc markdown :

{
  "treatments": [
    {
      "category": "raspberry" | "blackberry" | "strawberry" | "blueberry",
      "title": "Maravilla TP Substrate (Primocane)",
      "unit": "kg/ha" | "kg/plant" | "g/plant",
      "average": 11650,
      "growers": [
        { "code": "193", "yield": 15224, "plantingWeek": 18 },
        { "code": "152", "yield": 14869, "plantingWeek": 18 }
      ]
    }
  ]
}

**Règles importantes** :
- Exclure la ligne "Average"/"AVG"/"AVR" du tableau growers (mets sa valeur dans le champ "average").
- Le "title" doit être exactement le titre de la section (sans le ▪).
- "category" est déduit du titre de la page-séparateur précédente (Raspberry / Blackberry / Strawberry / Blueberry). Si ambigu, choisis selon la variété : Maravilla/Yazmin/Reyna/Mya = raspberry ; Clara = blackberry ; Marquis/Fandango/JS059 = strawberry ; Corrina/Rosita/Regina/Eterna/Breeze/Cascade = blueberry.
- "unit" : si l'axe Y du graphique est en kg/ha (rendement) → "kg/ha" ; si en kg/Plant → "kg/plant" ; si en g/Plant → "g/plant".
- Les codes growers sont les valeurs littérales (ex: "193", "2057", "0017", "172", "195"). Ne pas les convertir en entier (préserver les zéros initiaux). Ignorer "Average".
- Si une cellule yield est vide ou non lisible, omets le grower.
- Inclure TOUTES les sections présentes dans le PDF (typiquement 50-70 sections).

Texte du PDF :
"""
${pdfText.slice(0, 120000)}
"""`;
}

/**
 * Parse the PDF with Claude. Returns { treatments, parseWarnings, model }.
 *
 * @param {string} pdfText - raw text from pdf-parse
 * @param {{ apiKey: string }} opts
 */
async function parseWithClaude(pdfText, opts) {
  const apiKey = opts && opts.apiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY missing');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const prompt = buildPrompt(pdfText);
  let response = null;
  let lastError = null;
  let usedModel = null;

  for (const modelId of MODEL_CANDIDATES) {
    try {
      response = await client.messages.create({
        model: modelId,
        max_tokens: 16000,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      });
      usedModel = modelId;
      break;
    } catch (e) {
      lastError = e;
      console.error(`productivity parser: model ${modelId} failed: ${e.message}`);
    }
  }

  if (!response) {
    throw new Error(`All Claude models failed. Last error: ${lastError?.message || 'unknown'}`);
  }

  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd < 0) {
    throw new Error(`No JSON in Claude response. First 500 chars: ${text.slice(0, 500)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  } catch (e) {
    throw new Error(`Claude returned invalid JSON: ${e.message}`);
  }

  const treatments = Array.isArray(parsed.treatments) ? parsed.treatments : [];
  const parseWarnings = [];
  if (treatments.length === 0) parseWarnings.push('No treatments extracted from PDF');
  if (treatments.length < 30) parseWarnings.push(`Only ${treatments.length} treatments extracted (expected 50+)`);

  return { treatments, parseWarnings, model: usedModel };
}

/**
 * Full pipeline: PDF buffer → enriched JSON.
 *
 * @param {Buffer} pdfBuffer
 * @param {{ subject?: string, filename?: string, apiKey: string }} opts
 * @returns {Promise<{
 *   week: number|null,
 *   campaign: string|null,
 *   treatments: Array,        // raw, not yet enriched (call ranker.enrichTreatments)
 *   parseWarnings: string[],
 *   model: string,
 *   rawTextLength: number
 * }>}
 */
async function parseProductivityPdf(pdfBuffer, opts = {}) {
  const text = await extractPdfText(pdfBuffer);
  const { week, campaign } = extractWeekAndCampaign({
    subject: opts.subject || '',
    filename: opts.filename || '',
    text,
  });

  const { treatments, parseWarnings, model } = await parseWithClaude(text, { apiKey: opts.apiKey });

  return {
    week,
    campaign,
    treatments,
    parseWarnings,
    model,
    rawTextLength: text.length,
  };
}

module.exports = {
  extractPdfText,
  extractWeekAndCampaign,
  parseProductivityPdf,
  parseWithClaude,
  buildPrompt,
};
