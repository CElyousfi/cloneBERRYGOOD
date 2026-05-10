const { PDFParse } = require("pdf-parse");

const FERMES = ["F1", "F2", "F3", "F4", "F5", "F6", "BAHIA"];

// Known berry / avocado varieties we can recognise anywhere in free text.
const VARIETES_KNOWN = [
  "MARAVILLA", "YAZMIN", "YASMINE", "ADELITA", "VERSAILLES", "KWANZA", "GLEN LYON",
  "REYNA",
  "CASCADE", "BREEZE", "CORRINA", "CORINA", "ETERNA", "REGINA", "ROSITA", "VICTORIA", "MORRISSEY", "WHITNEY",
  "HASS", "FUERTE", "BACON", "ZUTANO",
];

// Authoritative mapping extracted from public/app.jsx PARCELLES_CULTURALES (lines 2122-2162).
// Used as fallback when the PDF description doesn't carry an explicit ferme code.
// For varieties grown at multiple fermes (e.g. YAZMIN at F1 and F5), the default
// is the farm with the simpler/more common cycle; a suffix rule below refines it.
const VARIETE_TO_FERME = {
  MARAVILLA: "F1",
  YAZMIN:    "F1",  // default; YAZMIN M-D / MAT / M.D → F5 (see VARIETE_SUFFIX_RULES)
  YASMINE:   "F1",
  REYNA:     "F5",
  CASCADE:   "F5",
  BREEZE:    "F5",
  CORRINA:   "F5",
  CORINA:    "F5",
  ADELITA:   "F5",
  HASS:      "F2",  // HASS spans F2-F6; without more context, pick F2
  BACON:     "BAHIA",
};

// Suffixes appended to a variety name that pin it to a specific ferme.
// Example: "FEUILLE FRAMBOISE YASMINE M-D" → F5 (Mow Down block at F5).
const VARIETE_SUFFIX_RULES = [
  { variete: "YAZMIN",  suffixes: ["M-D", "MAT", "MATTE", "M.D"], ferme: "F5" },
  { variete: "YASMINE", suffixes: ["M-D", "MAT", "MATTE", "M.D"], ferme: "F5" },
];

const TYPE_RULES = [
  { type: "eau_irrigation", keywords: [/EAU\s*D[' ]?IRR?I?GATION/i, /IRRIGATION/i] },
  { type: "eau_apport",     keywords: [/EAU\s*D[' ]?APPORT/i] },
  { type: "eau_du_sol",     keywords: [/EAU\s*DU\s*SOL/i, /SOLUTION\s*DU\s*SOL/i] },
  { type: "sol",            keywords: [/\bSOL\b/i] },
  { type: "foliaire",       keywords: [/FOLIAIRE/i, /FEUILLE/i, /TISSUS/i, /HOJA/i] },
];

// Template signatures found in the first line of the PDF text extraction.
const TEMPLATE_SIGNATURES = [
  { id: "suivi_nutritionnel", re: /RAPPORT\s+DE\s+SUIVI\s+NUTRITIONNEL/i },
  { id: "analyse_eau",        re: /RAPPORT\s+D[' ]ANALYSE\s*-\s*D[' ]EAU/i },
  { id: "analyse_sol",        re: /RAPPORT\s+D[' ]ANALYSE\s*-\s*DE\s+SOL/i },
  { id: "analyse_tissus",     re: /RAPPORT\s+D[' ]ANALYSE\s+DE\s+TISSUS\s+V[ÉE]G[ÉE]TAUX/i },
];

function normalizeSpaces(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function parseFrDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (!m) return null;
  const [_, d, mo, y] = m;
  const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  const dt = new Date(Date.UTC(year, parseInt(mo, 10) - 1, parseInt(d, 10)));
  return isNaN(dt.getTime()) ? null : dt.getTime();
}

function detectTemplate(text) {
  const head = text.slice(0, 500);
  for (const t of TEMPLATE_SIGNATURES) {
    if (t.re.test(head)) return t.id;
  }
  // Check for out-of-scope templates (fertilizer, residue analyses).
  if (/RAPPORT\s+D[' ]ANALYSE\b/i.test(head)) {
    const first1500 = text.slice(0, 1500);
    if (/ENGRAIS\s+INORGANIQUE|ENGRAIS\s+\d/i.test(first1500)) return "analyse_engrais";
    // Residue analyses list many pesticides (Azoxystrobine, Boscalid, Cyprodinil...).
    if (/Azoxystrobine|Boscalid|Cyprodinil|r[ée]sidu/i.test(first1500)) return "analyse_residus";
    return "analyse_generic";
  }
  return "unknown";
}

// --- Extractors for each template ---------------------------------------

// Template 1: modern "RAPPORT DE SUIVI NUTRITIONNEL"
// Layout: labels appear AFTER their values in pdf-parse output, e.g.
//   "Varieté MARAVILLA\tF1 FRUITS ROUGES\tPropriété"
// We search for known tokens anywhere in the first 1200 chars.
function extractHeaderSuiviNutritionnel(text) {
  const headRegion = text.slice(0, 1500);

  let propriete = null;
  const propM = headRegion.match(/\b(F[1-6])\s+FRUITS\s+ROUGES?\b/i) ||
                headRegion.match(/\b(BAHIA)\b/i) ||
                headRegion.match(/\bAVOCAT\w*\s+(F[1-6])\b/i) ||
                headRegion.match(/\b(F[1-6])\s+AVOCAD?O?\b/i);
  if (propM) propriete = propM[0];

  let variete = null;
  for (const v of VARIETES_KNOWN) {
    if (new RegExp(`\\b${v}\\b`, "i").test(headRegion)) { variete = v.toUpperCase(); break; }
  }

  let culture = null;
  const cultM = headRegion.match(/\b(FRAMBOISE|FRAMBUESA|BLUEBERR\w*|MYRTILLE|ARANDANO|AVOCAT\w*|AVOCADO)\b/i);
  if (cultM) culture = cultM[1];

  let terrain = null;
  const terrainCandidates = [
    /(EAU\s*D[' ]?IRR?I?GATION[^\t\n]*)/i,
    /(EAU\s*D[' ]?APPORT[^\t\n]*)/i,
    /(EAU\s*DU\s*SOL[^\t\n]*)/i,
    /(FEUILLE\s*DE\s*\w+[^\t\n]*)/i,
  ];
  for (const re of terrainCandidates) {
    const m = headRegion.match(re);
    if (m) { terrain = m[1].trim(); break; }
  }

  let date = null;
  const dateAfterLabel = text.match(/Date\s*:?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i);
  const dateBeforeLabel = text.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\s*\t?\s*Date\s*:?/i);
  date = (dateAfterLabel && dateAfterLabel[1]) || (dateBeforeLabel && dateBeforeLabel[1]) || null;

  const clientM = text.match(/Client\s*:\s*([^\n\t]+?)(?=\s{2,}|\t|$)/i);
  const client = clientM ? normalizeSpaces(clientM[1]) : null;

  return {
    client,
    propriete: propriete ? normalizeSpaces(propriete) : null,
    culture: culture ? normalizeSpaces(culture) : null,
    variete,
    terrain,
    date,
  };
}

// Templates 2-4: older "RAPPORT D'ANALYSE - <X>" family.
// Layout: "Déscription: <value>" is the key signal; "Type d'échantillon: <value>"
// tells us the kind; "Prélèvement: dd/mm/yyyy" gives the sampling date.
function extractHeaderAnalyseOld(text) {
  const head = text.slice(0, 2000);

  const descM = head.match(/D[ée]scription\s*:\s*([^\n\t]+)/i);
  const description = descM ? normalizeSpaces(descM[1]) : null;

  const typeM = head.match(/Type\s*d[`' ]?[ée]chantillon\s*:?\s*([^\n\t]+)/i);
  const type_echantillon = typeM ? normalizeSpaces(typeM[1]) : null;

  // Dates — PDFs often show them as "dd/mm/yyyy\tPrélèvement:" or "Prélèvement: dd/mm/yyyy".
  const prelevM = head.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s*\t?\s*Pr[ée]l[èe]vement\s*:?/i) ||
                  head.match(/Pr[ée]l[èe]vement\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const prelevement_date = prelevM ? prelevM[1] : null;

  const recepM = head.match(/Date\s*de\s*R[ée]ception\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const reception_date = recepM ? recepM[1] : null;

  // Client confirmation (we expect "BERRY GOOD FARMS" in Domicile/Client line).
  const clientLine = head.match(/BERRY\s+GOOD\s+FARMS/i);
  const client = clientLine ? "BERRY GOOD FARMS" : null;

  return { client, description, type_echantillon, prelevement_date, reception_date };
}

// --- Cross-template helpers ---------------------------------------------

function detectFermeFromDescription(desc) {
  if (!desc) return { ferme: null, variete: null };
  const up = desc.toUpperCase();

  // 1) Explicit ferme code in the description.
  const fermeM = up.match(/\b(F[1-6]|BAHIA)\b/);
  if (fermeM) {
    // Also try to extract a variety name from the same description.
    let variete = null;
    for (const v of VARIETES_KNOWN) {
      if (new RegExp(`\\b${v}\\b`).test(up)) { variete = v.toUpperCase(); break; }
    }
    return { ferme: fermeM[1], variete };
  }

  // 2) Suffix-refined rules (YASMINE M-D → F5 etc.)
  for (const rule of VARIETE_SUFFIX_RULES) {
    if (new RegExp(`\\b${rule.variete}\\b`).test(up)) {
      for (const suf of rule.suffixes) {
        if (up.includes(suf.toUpperCase())) return { ferme: rule.ferme, variete: rule.variete };
      }
    }
  }

  // 3) Fallback: first known variety → mapped ferme.
  for (const v of VARIETES_KNOWN) {
    if (new RegExp(`\\b${v}\\b`).test(up)) {
      const key = v.toUpperCase();
      const mapped = VARIETE_TO_FERME[key];
      if (mapped) return { ferme: mapped, variete: key };
    }
  }

  return { ferme: null, variete: null };
}

function detectTypeAnalyse(terrainOrDescription, subjectOrFilename, bodyText = "") {
  const name = subjectOrFilename || "";
  if (/EAU\s*D?[' ]?IRR?I?GATION/i.test(name)) return "eau_irrigation";
  if (/EAU\s*D?[' ]?APPORT/i.test(name)) return "eau_apport";
  if (/EAU\s*DU\s*SOL/i.test(name)) return "eau_du_sol";
  if (/FOLIAIRE|FEUILLE/i.test(name)) return "foliaire";
  if (/\bSOL\b/i.test(name) && !/SOLUTION/i.test(name)) return "sol";

  const hay = `${terrainOrDescription || ""}`;
  for (const rule of TYPE_RULES) {
    if (rule.keywords.some(k => k.test(hay))) return rule.type;
  }

  if (/FEUILLE\s*DE|FEUILLES\s*\w+|TISSUS\s+V[ÉE]G[ÉE]TAUX/i.test(bodyText)) return "foliaire";
  if (/EAU\s*D?[' ]?IRR?I?GATION/i.test(bodyText)) return "eau_irrigation";
  if (/\bANALYSE\s+DE\s+SOL\b/i.test(bodyText)) return "sol";

  return "foliaire";
}

function detectCulture(hint, descOrTerrain) {
  const hay = `${hint || ""} ${descOrTerrain || ""}`.toUpperCase();
  if (/FRAMBOIS/.test(hay)) return "Framboise";
  if (/MYRTILLE|BLUEBERR|ARANDANO|FEUILLES\s+MYRTILLE/.test(hay)) return "Myrtille";
  if (/AVOCAT|HASS|FUERTE/.test(hay)) return "Avocatier";
  return null;
}

// Pull the numeric data row from the analytical table (best-effort).
function extractAnalyticalTable(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let headerLine = null;
  for (const line of lines) {
    if (/\bpH\b/.test(line) && /(CE|HCO3|Ca|K\+|NO3|Cl)/i.test(line)) {
      headerLine = line;
      break;
    }
  }

  let dataTokens = [];
  for (const line of lines) {
    if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/.test(line)) {
      dataTokens = line.split(/\s+/).slice(1);
      if (dataTokens.length >= 3) break;
    }
  }

  if (!headerLine || dataTokens.length === 0) {
    return { headerLine, values: {}, rawTokens: dataTokens };
  }
  const headerTokens = headerLine.split(/\s+/).filter(t => /^[A-Za-z][A-Za-z0-9+\-]*$/.test(t));
  const values = {};
  const count = Math.min(headerTokens.length, dataTokens.length);
  for (let i = 0; i < count; i++) values[headerTokens[i]] = dataTokens[i];
  return { headerLine, values, rawTokens: dataTokens };
}

// --- Main entry ----------------------------------------------------------

async function parseAgqPdf(pdfBuffer, { subject = "", attachmentName = "" } = {}) {
  const parser = new PDFParse({ data: pdfBuffer });
  const textResult = await parser.getText();
  const text = (textResult && textResult.text) || (typeof textResult === "string" ? textResult : "");

  const template = detectTemplate(text);

  // Out-of-scope templates are acknowledged but skipped.
  if (template === "analyse_engrais") {
    return { skip: "out_of_scope_template", reason: "Rapport engrais (fertilizer analysis)", template, raw_text_snippet: text.slice(0, 800) };
  }
  if (template === "analyse_residus") {
    return { skip: "out_of_scope_template", reason: "Rapport résidus pesticides", template, raw_text_snippet: text.slice(0, 800) };
  }

  if (template === "suivi_nutritionnel") {
    const header = extractHeaderSuiviNutritionnel(text);
    const ferme = (() => {
      // 1. From propriete field in the PDF header
      if (header.propriete) {
        if (/BAHIA/i.test(header.propriete)) return "BAHIA";
        const m = header.propriete.match(/\bF([1-6])\b/i);
        if (m) return `F${m[1]}`;
      }
      // 2. Fallback: extract from attachment filename (e.g., "115045 AVOCAT F3.pdf")
      const fnMatch = (attachmentName || "").match(/\bF([1-6])\b/i);
      if (fnMatch) return `F${fnMatch[1]}`;
      // 3. Fallback: from subject line
      const subjMatch = (subject || "").match(/\bF([1-6])\b/i);
      if (subjMatch) return `F${subjMatch[1]}`;
      // 4. Fallback: VARIETE_TO_FERME mapping
      if (header.variete && VARIETE_TO_FERME[header.variete.toUpperCase()]) return VARIETE_TO_FERME[header.variete.toUpperCase()];
      return null;
    })();
    const table = extractAnalyticalTable(text);
    return {
      template,
      ferme,
      variete: header.variete,
      culture: detectCulture(header.culture, header.terrain),
      type_analyse: detectTypeAnalyse(header.terrain, attachmentName || subject, text),
      date_analyse: parseFrDate(header.date),
      propriete_raw: header.propriete,
      terrain_raw: header.terrain,
      client_raw: header.client,
      phenologie: null,
      description_raw: null,
      type_echantillon_raw: null,
      parsed_values: table.values,
      parsed_header_line: table.headerLine,
      raw_tokens: table.rawTokens,
      raw_text_snippet: text.slice(0, 2000),
    };
  }

  if (template === "analyse_eau" || template === "analyse_sol" || template === "analyse_tissus" || template === "analyse_generic") {
    const header = extractHeaderAnalyseOld(text);
    let { ferme, variete } = detectFermeFromDescription(header.description);
    // Fallback: filename, then subject, then variety mapping
    if (!ferme) {
      const fnM = (attachmentName || "").match(/\bF([1-6])\b/i);
      if (fnM) ferme = `F${fnM[1]}`;
    }
    if (!ferme) {
      const sjM = (subject || "").match(/\bF([1-6])\b/i);
      if (sjM) ferme = `F${sjM[1]}`;
    }
    if (!ferme && variete && VARIETE_TO_FERME[variete.toUpperCase()]) ferme = VARIETE_TO_FERME[variete.toUpperCase()];

    // Date: prefer Prélèvement, fall back to Date de Réception.
    const date_analyse = parseFrDate(header.prelevement_date) || parseFrDate(header.reception_date);

    const culture = detectCulture(header.type_echantillon, header.description);
    const type_analyse = detectTypeAnalyse(header.type_echantillon || header.description, attachmentName || subject, text);

    const table = extractAnalyticalTable(text);

    return {
      template,
      ferme,
      variete,
      culture,
      type_analyse,
      date_analyse,
      propriete_raw: null,
      terrain_raw: header.type_echantillon,
      client_raw: header.client,
      phenologie: null,
      description_raw: header.description,
      type_echantillon_raw: header.type_echantillon,
      parsed_values: table.values,
      parsed_header_line: table.headerLine,
      raw_tokens: table.rawTokens,
      raw_text_snippet: text.slice(0, 2000),
    };
  }

  // Template unknown — still try to extract ferme/variete from filename or subject
  // so the analysis is not silently discarded.
  let fallbackFerme = null;
  let fallbackVariete = null;
  const fnFallback = (attachmentName || "").match(/\b(F[1-6])\b/i);
  if (fnFallback) fallbackFerme = fnFallback[1].toUpperCase();
  if (!fallbackFerme) {
    const sjFallback = (subject || "").match(/\b(F[1-6])\b/i);
    if (sjFallback) fallbackFerme = sjFallback[1].toUpperCase();
  }
  if (!fallbackFerme && /BAHIA/i.test(attachmentName || subject || "")) fallbackFerme = "BAHIA";
  for (const v of VARIETES_KNOWN) {
    if (new RegExp(`\\b${v}\\b`, "i").test(attachmentName || "")) { fallbackVariete = v.toUpperCase(); break; }
  }
  if (!fallbackVariete) {
    for (const v of VARIETES_KNOWN) {
      if (new RegExp(`\\b${v}\\b`, "i").test(text.slice(0, 1500))) { fallbackVariete = v.toUpperCase(); break; }
    }
  }
  if (!fallbackFerme && fallbackVariete && VARIETE_TO_FERME[fallbackVariete]) {
    fallbackFerme = VARIETE_TO_FERME[fallbackVariete];
  }

  if (fallbackFerme) {
    return {
      template: "unknown_with_fallback",
      ferme: fallbackFerme,
      variete: fallbackVariete,
      culture: detectCulture(null, attachmentName || subject),
      type_analyse: detectTypeAnalyse(null, attachmentName || subject, text),
      date_analyse: null,
      propriete_raw: null,
      terrain_raw: null,
      client_raw: null,
      phenologie: null,
      description_raw: null,
      type_echantillon_raw: null,
      parsed_values: {},
      parsed_header_line: null,
      raw_tokens: [],
      raw_text_snippet: text.slice(0, 2000),
    };
  }

  return { template, skip: "unknown_template", reason: "Template AGQ inconnu", raw_text_snippet: text.slice(0, 800) };
}

module.exports = {
  parseAgqPdf,
  detectTemplate,
  detectFermeFromDescription,
  detectTypeAnalyse,
  detectCulture,
  parseFrDate,
  VARIETE_TO_FERME,
  VARIETE_SUFFIX_RULES,
  FERMES,
  VARIETES_KNOWN,
};
