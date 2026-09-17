/* Extrait de emailService.js — blocs repris VERBATIM.
   Seul ce preambule de require est ajoute. */
'use strict';
const functions = require("firebase-functions");

const admin = require("firebase-admin");

const { ImapFlow } = require("imapflow");

const { simpleParser } = require("mailparser");

const cheerio = require("cheerio");

const XLSX = require("xlsx");

const { PDFParse } = require("pdf-parse");

const { requireAuth } = require("../../../middleware/requireAuth");


// Firestore reference (admin already initialized in index.js)
const db = admin.firestore();


// =============================================
// Helpers
// =============================================

/**
 * Map Driscoll's ranch (numeric code "200742"/"200876" or full name "R-BERRY"/"SARL 3")
 * to internal ferme F-code used on user documents ("F1" / "F5").
 * Driscoll's only has 2 fermes: F1 (R-BERRY, 200742) and F5 (SARL 3, 200876).
 * Returns null when the ranch can't be mapped.
 */
function mapRanchToFermeCode(ranchOrName) {
  if (!ranchOrName) return null;
  const n = String(ranchOrName).toLowerCase().trim();
  if (n === "f1" || n === "f5") return n.toUpperCase();
  if (n.includes("r-berry") || n.includes("r berry") || n.includes("200742")) return "F1";
  if (n.includes("sarl 3") || n.includes("berry good farms") || n.includes("200876")) return "F5";
  return null;
}


/**
 * Create an IMAP client from environment variables.
 * Each invocation creates a fresh connection (no pooling in serverless).
 */
function createImapClient() {
  return new ImapFlow({
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || "993"),
    secure: process.env.IMAP_TLS !== "false",
    auth: {
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASSWORD,
    },
    logger: false,
  });
}


/**
 * Extract all HTML tables from an email body using cheerio.
 * Returns an array of { headers: string[], rows: string[][] }
 */
function parseEmailHtmlTables(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const tables = [];

  $("table").each((_i, table) => {
    const headers = [];
    const firstRow = $(table).find("tr").first();

    // Try <th> first, fallback to <td> in first row
    const headerCells = firstRow.find("th");
    if (headerCells.length > 0) {
      headerCells.each((_j, cell) => headers.push($(cell).text().trim()));
    } else {
      firstRow.find("td").each((_j, cell) => headers.push($(cell).text().trim()));
    }

    const rows = [];
    $(table)
      .find("tr")
      .slice(1)
      .each((_j, row) => {
        const cells = [];
        $(row)
          .find("td")
          .each((_k, cell) => cells.push($(cell).text().trim()));
        if (cells.length > 0) rows.push(cells);
      });

    if (rows.length > 0 || headers.length > 0) {
      tables.push({ headers, rows });
    }
  });

  return tables;
}


/**
 * Detect if an email is a Driscoll's Quality Inspection Report.
 */
function isDriscolsQualityReport(subject, textBody, htmlBody) {
  const combined = ((subject || "") + " " + (textBody || "") + " " + (htmlBody || "")).toLowerCase();
  return (
    /quality\s*inspection\s*report/i.test(combined) ||
    (/driscoll/i.test(combined) && /inspection|receipt|batch/i.test(combined))
  );
}


/**
 * Parse a Driscoll's Quality Inspection Report from HTML body.
 * Extracts: berry type, variety, item, ranch, receipt, batch, license, dates,
 * defects tables (condition + appearance), flavor (brix), batch details, result.
 */
function parseDriscolsReport(htmlBody, textBody, subject) {
  const text = textBody || "";
  const html = htmlBody || "";
  const combined = text + "\n" + (html ? cheerio.load(html).text() : "");

  const result = {
    berryType: null,
    variety: null,
    item: null,
    itemDescription: null,
    ranch: null,
    ranchName: null,
    receiptNumber: null,
    batchNumber: null,
    license: null,
    receivedDate: null,
    inspectedDate: null,
    conditionDefects: [],
    appearanceDefects: [],
    brix: null,
    batchWeight: null,
    batchQuantity: null,
    sampleSize: null,
    avgFruitsPerPunnet: null,
    avgPunnetWeight: null,
    totalFruitInspected: null,
    overallResult: null,
    inspectionType: null,
  };

  // --- Extract Inspection Type (By-Pass, Initial, Re-Inspection) ---
  const inspTypeMatch = combined.match(/Inspection\s*:\s*(By[- ]?Pass|Initial|Re[- ]?Inspection)/i);
  if (inspTypeMatch) result.inspectionType = inspTypeMatch[1].trim();

  // --- Extract PASS/FAIL/REJECT — subject takes priority (REJECT in subject overrides body) ---
  if (subject) {
    const subjectMatch = subject.match(/\b(REJECT|FAIL|PASS)\b/i);
    if (subjectMatch) result.overallResult = subjectMatch[1].toUpperCase();
  }
  if (!result.overallResult) {
    const passFailMatch = combined.match(/^[\s]*(PASS|FAIL|REJECT)\b/im);
    if (passFailMatch) result.overallResult = passFailMatch[1].toUpperCase();
  }

  // --- Extract key-value fields using regex on combined text ---
  // Format: "Berry   \xa0 RASPBERRY Variety Maravilla Item 170090"
  const berryMatch = combined.match(/Berry\s+[\xa0\s]*([A-Z]+)\s+Variety\s+(\S+)\s+Item\s+(\d+)/i);
  if (berryMatch) {
    result.berryType = berryMatch[1];
    result.variety = berryMatch[2];
    result.item = berryMatch[3];
  }

  // Item description: "RASP Conv Drisc 12x125 Ranch 200742" — text before "Ranch"
  const itemDescMatch = combined.match(/Item\s+\d+\s*\n\s*(.+?)\s+Ranch\s+\d+/i);
  if (itemDescMatch) result.itemDescription = itemDescMatch[1].trim();

  // Ranch: "Ranch 200742"
  const ranchMatch = combined.match(/Ranch\s+(\d+)/i);
  if (ranchMatch) result.ranch = ranchMatch[1];

  // Ranch name: line after "Ranch NNNN\n<ranch name>"
  const ranchNameMatch = combined.match(/Ranch\s+\d+\s*\n\s*(.+?)(?:\n|$)/im);
  if (ranchNameMatch) {
    result.ranchName = ranchNameMatch[1].replace(/[\u200e\u202c\u200f]/g, "").trim();
  }

  // Receipt: "Receipt RID-001296273"
  const receiptMatch = combined.match(/Receipt\s+(RID[‑\-]?\d+)/i);
  if (receiptMatch) result.receiptNumber = receiptMatch[1];

  // Batch Number: "Batch Number 172068172-R0101"
  const batchMatch = combined.match(/Batch\s+Number\s+([\w\-]+)/i);
  if (batchMatch) result.batchNumber = batchMatch[1];

  // License: "License 105532686<br>105532685" or "License 105532686\n105532685"
  const licenseMatch = combined.match(/Licen[sc]e\s+([\d]+(?:[<]br[>][\d]+|[\n\s]+[\d]+)*)/i);
  if (licenseMatch) {
    // Normalize separators (newlines, <br>, spaces) then split on non-digits
    const licenseNums = licenseMatch[1].replace(/<br>/gi, " ").match(/\d+/g);
    result.license = licenseNums ? licenseNums.join(", ") : licenseMatch[1];
  }

  // Dates: "Received 03/09/2026 13:12 GMT" and "Inspected 03/09/2026 13:25 GMT"
  const receivedMatch = combined.match(/Received\s+([\d\/]+\s+[\d:]+\s*(?:GMT|UTC)?)/i);
  if (receivedMatch) result.receivedDate = receivedMatch[1].trim();
  const inspectedMatch = combined.match(/Inspected\s+([\d\/]+\s+[\d:]+\s*(?:GMT|UTC)?)/i);
  if (inspectedMatch) result.inspectedDate = inspectedMatch[1].trim();

  // Brix: "Degrees Brix 10.3" or "Degrees Brix\n10.3"
  const brixMatch = combined.match(/Degrees?\s*Brix\s+([\d.]+)/i);
  if (brixMatch) {
    result.brix = parseFloat(brixMatch[1]);
  } else {
    // Value on next line
    const brixLineMatch = combined.match(/Degrees?\s*Brix\s*\n\s*([\d.]+)/i);
    if (brixLineMatch) result.brix = parseFloat(brixLineMatch[1]);
  }

  // Batch details: all on one line
  // "Batch Weight (kg) Batch Quantity Sample Size Average Fruits Per Punnet Average Punnet Weight Total Fruit Inspected 559.5 373 17 30 145.6 510"
  const batchDetailsMatch = combined.match(/Batch\s+Weight\s*\(kg\)\s+Batch\s+Quantity\s+Sample\s+Size\s+Average\s+Fruits?\s+Per\s+Punnet\s+Average\s+Punnet\s+Weight\s+Total\s+Fruit\s+Inspected\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (batchDetailsMatch) {
    result.batchWeight = parseFloat(batchDetailsMatch[1]);
    result.batchQuantity = parseFloat(batchDetailsMatch[2]);
    result.sampleSize = parseFloat(batchDetailsMatch[3]);
    result.avgFruitsPerPunnet = parseFloat(batchDetailsMatch[4]);
    result.avgPunnetWeight = parseFloat(batchDetailsMatch[5]);
    result.totalFruitInspected = parseFloat(batchDetailsMatch[6]);
  } else {
    // By-Pass inspections only have Batch Weight + Batch Quantity (no sample/defect details)
    // Format 1: "Batch Weight (kg) Batch Quantity 1338 446" (headers then values)
    const bypassBatchMatch = combined.match(/Batch\s+Weight\s*\(kg\)\s+Batch\s+Quantity\s+([\d.]+)\s+([\d.]+)/i);
    // Format 2: "Batch Weight (kg) 1338 Batch Quantity 446" (interleaved)
    const bypassBatchMatch2 = combined.match(/Batch\s+Weight\s*\(kg\)\s*([\d.]+)\s*Batch\s+Quantity\s*([\d.]+)/i);
    const bpm = bypassBatchMatch || bypassBatchMatch2;
    if (bpm) {
      result.batchWeight = parseFloat(bpm[1]);
      result.batchQuantity = parseFloat(bpm[2]);
    }
  }

  // --- Parse defects from HTML tables ---
  if (html) {
    const $ = cheerio.load(html);
    const tables = [];
    $("table").each((_i, table) => {
      const headers = [];
      const firstRow = $(table).find("tr").first();
      const headerCells = firstRow.find("th");
      if (headerCells.length > 0) {
        headerCells.each((_j, cell) => headers.push($(cell).text().trim()));
      } else {
        firstRow.find("td").each((_j, cell) => headers.push($(cell).text().trim()));
      }
      const rows = [];
      $(table).find("tr").slice(1).each((_j, row) => {
        const cells = [];
        $(row).find("td").each((_k, cell) => cells.push($(cell).text().trim()));
        if (cells.length > 0) rows.push(cells);
      });
      tables.push({ headers, rows });
    });

    // Identify defect tables by looking for columns like "# of Berries", "%", "Points"
    for (const table of tables) {
      const headersLower = table.headers.map(h => h.toLowerCase());
      const hasDefectColumns = headersLower.some(h => h.includes("berries") || h.includes("points") || h === "%");
      if (!hasDefectColumns && table.rows.length === 0) continue;

      // Check if this is a condition or appearance table based on defect names
      const conditionNames = ["decay", "mold", "wet", "leaky", "soft", "shriveled", "green"];
      const appearanceNames = ["size", "skin", "damage", "bloom", "stem", "blossom", "foreign", "bodies"];

      let isCondition = false;
      let isAppearance = false;
      for (const row of table.rows) {
        const defectName = (row[0] || "").toLowerCase();
        if (conditionNames.some(n => defectName.includes(n))) isCondition = true;
        if (appearanceNames.some(n => defectName.includes(n))) isAppearance = true;
      }

      const defects = table.rows.map(row => {
        const defect = { name: row[0] || "" };
        // Try to find numeric columns
        for (let c = 1; c < row.length; c++) {
          const val = parseFloat(row[c]);
          const header = (table.headers[c] || "").toLowerCase();
          if (header.includes("berries") || header.includes("#")) defect.count = isNaN(val) ? 0 : val;
          else if (header === "%" || header.includes("percent")) defect.percent = isNaN(val) ? 0 : val;
          else if (header.includes("point")) defect.points = isNaN(val) ? 0 : val;
        }
        return defect;
      }).filter(d => d.name);

      if (isCondition) result.conditionDefects = defects;
      else if (isAppearance) result.appearanceDefects = defects;
      else if (result.conditionDefects.length === 0) result.conditionDefects = defects;
      else result.appearanceDefects = defects;
    }
  }

  return result;
}


/**
 * Map berry type from Driscoll's report to the farm's French naming.
 */
function mapBerryToFrench(berryType) {
  const map = {
    blueberry: "Myrtille",
    raspberry: "Framboise",
    strawberry: "Fraise",
    blackberry: "Mûre",
  };
  return map[(berryType || "").toLowerCase()] || berryType || "Inconnu";
}


/**
 * Detect if an email is a Driscoll's Liquidation report.
 */
function isLiquidationEmail(_from, subject) {
  return /l?iquidation/i.test(subject || "");
}


/**
 * Detect if an email is a TIMAC supplier invoice.
 * STRICT: only matches when the sender is on timacmaroc.com AND the subject
 * mentions "facture". Must never capture Driscoll's / liquidation / DQR mails.
 */
function isTimacInvoice(from, subject) {
  return /timacmaroc\.com/i.test(from || "") && /facture/i.test(subject || "");
}


/**
 * Parse a Liquidation XLS/XLSX attachment.
 * Format: Sheet name = "W 6" (week number), headers in row 1, data rows 2+.
 * Dates are Excel serial numbers. PFQ score = "80.85 REY".
 * Returns { week, period, liquidationNumber, rows: [...], summary: {...} }
 */
function parseLiquidationXlsx(xlsxBuffer) {
  const workbook = XLSX.read(xlsxBuffer, { type: "buffer" });

  // Convert Excel serial date to MM/DD/YYYY
  const excelDateToStr = (serial) => {
    const num = parseFloat(serial);
    if (isNaN(num) || num < 40000) return String(serial);
    const d = new Date((num - 25569) * 86400 * 1000);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  };

  const varMap = {
    // Framboise
    REY: "Reyna", MAR: "Maravilla", YAZ: "Yazmin Sol", ADE: "Adelita",
    // Myrtille (Driscoll's blueberry varieties — COR/Corrina is classified as myrtille)
    COR: "Corrina", CAS: "Cascade", BRE: "Breeze",
    ETE: "Eterna", REG: "Regina", ROS: "Rosita",
  };

  // Parse a single sheet and return { sheetName, week, rows, summary }
  function parseSheet(sheetName) {
    const sheet = workbook.Sheets[sheetName];
    const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const weekMatch = sheetName.match(/W\s*(\d+)/i);
    const week = weekMatch ? parseInt(weekMatch[1]) : null;
    const rows = [];
    const _sheetName = sheetName;

    let headerIdx = -1;
    for (let i = 0; i < allRows.length; i++) {
      const cells = allRows[i].map(c => String(c || "").trim().toLowerCase());
      if (cells.includes("receipt id") || cells.includes("receipt qty")) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx < 0) return { week, rows, summary: {} };

    const headers = allRows[headerIdx].map(c => String(c || "").trim());
    const colIdx = {};
    headers.forEach((h, i) => {
      const hl = h.toLowerCase();
      if (hl === "date") colIdx.date = i;
      if (hl === "receipt id") colIdx.receiptId = i;
      if (hl.includes("receipt qty") && hl.includes("kg")) colIdx.receiptQtyKg = i;
      else if (hl.includes("receipt qty")) colIdx.receiptQty = i;
      if (hl === "pfq score") colIdx.pfqScore = i;
      if (hl === "pp fruit") colIdx.ppFruit = i;
      if (hl === "gs net") colIdx.gsNet = i;
      if (hl === "item number") colIdx.item = i;
      if (hl === "contract id") colIdx.contractId = i;
    });

    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const cells = allRows[i];
      const receiptId = String(cells[colIdx.receiptId] || "").trim();
      if (!receiptId || !receiptId.startsWith("RID-")) continue;

      const dateVal = cells[colIdx.date];
      const date = excelDateToStr(dateVal);
      const receiptQty = parseFloat(cells[colIdx.receiptQty]) || 0;
      const receiptQtyKg = parseFloat(cells[colIdx.receiptQtyKg]) || 0;
      const ppFruit = parseFloat(cells[colIdx.ppFruit]) || 0;
      const gsNet = parseFloat(cells[colIdx.gsNet]) || 0;

      const pfqRaw = String(cells[colIdx.pfqScore] || "").trim();
      const pfqMatch = pfqRaw.match(/([\d.]+)\s*([A-Z]{3})/);
      const pfqScore = pfqMatch ? parseFloat(pfqMatch[1]) : null;
      const varietyCode = pfqMatch ? pfqMatch[2] : null;

      rows.push({
        date, receiptId, receiptQty, receiptQtyKg,
        pfqScore, varietyCode, ppFruit, gsNet,
        pricePerKg: receiptQtyKg > 0 ? Math.round((gsNet / receiptQtyKg) * 100) / 100 : 0,
        variety: varMap[varietyCode] || varietyCode || null,
      });
    }

    const summary = {
      totalKg: Math.round(rows.reduce((s, r) => s + r.receiptQtyKg, 0) * 100) / 100,
      base: Math.round(rows.reduce((s, r) => s + r.gsNet, 0) * 100) / 100,
    };

    return { sheetName: _sheetName, week, rows, summary };
  }

  // Parse ALL sheets (multi-week workbook support)
  const sheets = [];
  for (const sheetName of workbook.SheetNames) {
    const parsed = parseSheet(sheetName);
    if (parsed.rows.length > 0) {
      sheets.push({ ...parsed, period: null, liquidationNumber: null });
    }
  }

  // If only one sheet with data, return single result (backward compatible)
  if (sheets.length <= 1) {
    const single = sheets[0] || { sheetName: null, week: null, rows: [], summary: {} };
    return { sheetName: single.sheetName, week: single.week, period: null, liquidationNumber: null, rows: single.rows, summary: single.summary, _multiSheets: null };
  }

  // Multiple sheets: return first sheet as main result + attach all sheets
  const first = sheets[0];
  return { sheetName: first.sheetName, week: first.week, period: null, liquidationNumber: null, rows: first.rows, summary: first.summary, _multiSheets: sheets };
}


/**
 * Parse a Driscoll's LIQUIDATION summary PDF (separate from RECEIPT.xls).
 *
 * Two layouts exist with DIFFERENT column orders:
 *   Raspberry (RASP) — English header:
 *     Total in Kg | Base | Fruit Advance | DED Rasp (or Plant Deduction) | Crop Advance | DEX Adjustment | PKG deduction | Net Payable
 *   Blueberry (BLUE) — French header, columns reordered:
 *     Total en Kg | Base | DED BLUE | ADVANCE FRUIT | Adjustment DEX | LOAN | Straw Plants | Montant
 *
 * Both layouts produce the same normalized output shape:
 *   { totalKg, base, fruitAdvance, dedRasp, dedPlants, cropAdvance, dexAdjustment, pkgDeduction, netPayable }
 *
 * and metadata: Numéro de liquidation (APIV-...), Periode.
 */
// Pure helper: parse the already-extracted PDF text into the normalized summary shape.
// Exposed for unit testing without needing a real PDF buffer.
function parseLiquidationSummaryText(text) {
  if (!text) return null;
  const result = { liquidationNumber: null, period: null, summary: {} };

  const apiv = text.match(/(APIV-\d+)/i);
  if (apiv) result.liquidationNumber = apiv[1];

  const period = text.match(/P[eé]riode\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (period) result.period = `${period[1]} - ${period[2]}`;

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Detect blueberry layout by distinctive French markers anywhere in the text.
  const isBlueLayout = /DED\s+BLUE|ADVANCE\s+FRUIT|Straw\s+Plants|Total\s+en\s+Kg/i.test(text);

  const headerIdx = lines.findIndex(l => isBlueLayout
    ? /Total\s+en\s+Kg.*Base.*DED\s+BLUE.*Montant/i.test(l)
    : /Total\s+in\s+Kg.*Base.*Fruit\s+Advance.*Net\s+Payable/i.test(l)
  );
  if (headerIdx < 0) return result;

  const headerLine = lines[headerIdx];
  const valuesLine = lines[headerIdx + 1];
  if (!valuesLine) return result;

  // Robust number extraction — handles both PDF locales:
  //   English (newer): "3,226.50 231,656.27 166,525.18 - - - 0.00 65,131.09"
  //   Space-separated (older): "6 492.00 373 923.94 274 234.08 24 971.38 44 271.50 - 0.00 30 446.97"
  //
  // Strategy: match either a literal "-" placeholder, or a number with optional
  // thousand separators (space or comma, always followed by exactly 3 digits)
  // and optional decimal part. Matches are ordered left-to-right as table columns.
  const numRe = /-(?=\s|$)|\d{1,3}(?:[\s,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  const matches = valuesLine.match(numRe) || [];
  const nums = matches.map((m) => {
    if (m === "-") return 0;
    return parseFloat(m.replace(/[\s,]/g, "")) || 0;
  });
  if (nums.length < 8) return result;

  const [c1, c2, c3, c4, c5, c6, c7, c8] = nums.slice(0, 8);

  if (isBlueLayout) {
    // Blueberry columns: [totalKg, base, DED BLUE, ADVANCE FRUIT, Adjustment DEX, LOAN, Straw Plants, Montant]
    result.summary = {
      totalKg: c1,
      base: c2,
      fruitAdvance: c4,
      dedRasp: 0,
      dedPlants: c3,
      cropAdvance: c6,
      dexAdjustment: c5,
      pkgDeduction: c7,
      netPayable: c8,
    };
  } else {
    // Raspberry columns: [totalKg, base, Fruit Advance, DED Rasp|Plant Deduction, Crop Advance, DEX, PKG, Net Payable]
    // Column 4 is either "DED Rasp" (framboise) or "Plant Deduction"/"DED Plants" (variante).
    const raspIsPlantDed = /plant\s*deduction|ded\.?\s*plants?/i.test(headerLine);
    result.summary = {
      totalKg: c1,
      base: c2,
      fruitAdvance: c3,
      dedRasp: raspIsPlantDed ? 0 : c4,
      dedPlants: raspIsPlantDed ? c4 : 0,
      cropAdvance: c5,
      dexAdjustment: c6,
      pkgDeduction: c7,
      netPayable: c8,
    };
  }
  return result;
}


async function parseLiquidationSummaryPdf(pdfBuffer) {
  try {
    const parser = new PDFParse({ data: pdfBuffer });
    const textResult = await parser.getText();
    const text = (textResult && textResult.text) || (typeof textResult === "string" ? textResult : "");
    return parseLiquidationSummaryText(text);
  } catch (err) {
    console.error("parseLiquidationSummaryPdf error:", err.message);
    return null;
  }
}


// ---------------------------------------------------------------------------
// TIMAC AGRO MAROC — supplier invoices (native-text PDF, no OCR)
// ---------------------------------------------------------------------------

/**
 * Parse a French-formatted number from a TIMAC invoice.
 * Examples: "27.445,00" -> 27445.00 ; "800,000" -> 800.0 ;
 *           "1,750" -> 1.75 ; "2 708,331" -> 2708.331 ; "8 400,00" -> 8400.0
 * Strategy: drop spaces (thousand sep), drop dots (thousand sep), comma -> decimal point.
 * @param {string} s
 * @returns {number}
 */
function parseTimacNumber(s) {
  if (s == null) return NaN;
  const cleaned = String(s).trim().replace(/\s/g, "").replace(/\./g, "").replace(/,/g, ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : NaN;
}


// A French number token as it appears in the body: optional thousand groups
// separated by space or dot, decimal part separated by comma.
// e.g. "800,000", "2 708,331", "27.445,00", "152,291", "1 950,00"
//
// Disambiguation rule (critical): the column separator is ALSO a space, while
// "5 100,00" is a single amount. To avoid splitting "5 100,00" into "5" and
// "100,00", a number that uses a SPACE thousand-separator MUST end with a
// decimal part (",dd"). Plain integers / decimals without thousand-grouping
// stay valid too (e.g. "0,500", "34,000").
const TIMAC_NUM =
  "(?:\\d{1,3}(?: \\d{3})+,\\d+" + // grouped-by-space amounts must have decimals: "5 100,00", "2 708,331"
  "|\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?" + // dot-grouped thousands: "27.445,00"
  "|\\d+(?:,\\d+)?)";
 // plain: "800,000", "34,000", "0,500", "1950"
// Units (matched case-insensitively via the `i` flag below, so "kG", "Kg",
// "KG" all hit). Order longest-first so "Litre"/"Tonne" win over "L".
const TIMAC_UNIT = "TONNE|LITRE|UNITE|UNIT[ÉE]|KG|Tonne|Litre|Unit[ée]|TON|KG|L|U";


// Tail of an article line. After the unit there are NUMBER columns:
//   [remise] prix_unitaire montant   (remise column usually empty in TIMAC).
// Because an optional remise group fights with the greedy amount parsing of
// "5 100,00", we instead capture the unit + the whole trailing number region,
// then split that region into number tokens deterministically (left to right,
// each token grabbing maximal thousand-grouping). The last token = montant,
// the one before = prix_unitaire, an optional earlier one = remise.
const TIMAC_NUM_RE = new RegExp(TIMAC_NUM, "g");

const TIMAC_LINE_TAIL = new RegExp(
  "^(?<designation>.*?)\\s+" +
  "(?<quantite>" + TIMAC_NUM + ")\\s*" +
  "(?<unite>" + TIMAC_UNIT + ")\\s+" +
  "(?<numbers>(?:" + TIMAC_NUM + ")(?:\\s+(?:" + TIMAC_NUM + ")){1,2})\\s*$",
  "i"
);


/**
 * Does the accumulated text form a complete article line
 * (i.e. ends with qty + unit + [rem] + PU + montant)?
 * Returns a normalized object or null.
 * @param {string} body  text after the 4-digit code
 * @returns {{designation:string,quantite:string,unite:string,remise:?string,prix_unitaire:string,montant:string}|null}
 */
function matchTimacLineTail(body) {
  const m = TIMAC_LINE_TAIL.exec(body);
  if (!m || !m.groups) return null;
  const nums = m.groups.numbers.match(TIMAC_NUM_RE) || [];
  if (nums.length < 2) return null;
  const montant = nums[nums.length - 1];
  const prix_unitaire = nums[nums.length - 2];
  const remise = nums.length >= 3 ? nums[nums.length - 3] : null;
  return {
    designation: m.groups.designation,
    quantite: m.groups.quantite,
    unite: m.groups.unite,
    remise,
    prix_unitaire,
    montant,
  };
}


/**
 * Parse the plain text extracted from a TIMAC invoice PDF.
 * Pure function (string -> object), testable without any PDF.
 * @param {string} text
 * @returns {object}
 */
function parseTimacInvoiceText(text) {
  const result = {
    fournisseur: "TIMAC AGRO MAROC",
    code_client: null,
    num_facture: null,
    date_facture: null,
    num_bcde: null,
    date_bcde: null,
    num_bl: null,
    date_bl: null,
    bls: [],
    ice: null,
    date_echeance: null,
    net_a_payer: null,
    total_ht: null,
    total_tva: null,
    lignes: [],
    reconciliation: { somme_lignes: 0, total_ht: null, ok: false, ecart: null },
  };
  if (!text || typeof text !== "string") return result;

  // Strip the metadata footer (#subj#...) if present.
  const body = text.split("#subj#")[0];
  const rawLines = body.split(/\r?\n/);
  const lines = rawLines.map((l) => l.replace(/\t/g, " ").replace(/\s+$/g, ""));

  // --- Header: "<code_client> <date_fac> <num_facture> <ATC label...>" ---
  for (const l of lines) {
    const m = l.match(/^\s*(\d{4,6})\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{4,8})\b/);
    if (m) {
      result.code_client = m[1];
      result.date_facture = m[2];
      result.num_facture = m[3];
      break;
    }
  }

  // --- ICE ---
  const iceM = body.match(/N°\s*ICE\s*:?\s*(\d{6,})/i);
  if (iceM) result.ice = iceM[1];

  // --- Date échéance (value may be on the same or a following line) ---
  for (let i = 0; i < lines.length; i++) {
    const inline = lines[i].match(/Date\s+[ée]ch[ée]ance\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (inline) { result.date_echeance = inline[1]; break; }
    if (/Date\s+[ée]ch[ée]ance\s*:?\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const dm = lines[j].match(/^(\d{2}\/\d{2}\/\d{4})\s*$/);
        if (dm) { result.date_echeance = dm[1]; break; }
      }
      break;
    }
  }

  // --- B.Cde N° ---
  const bcdeM = body.match(/B\.?\s*Cde\s*N°\s*:?\s*(\d+)/i);
  if (bcdeM) result.num_bcde = bcdeM[1];

  // --- Two "Du :" dates in order: 1st = date B.Cde, 2nd = date BL ---
  const duDates = [];
  for (const l of lines) {
    const dm = l.match(/^\s*Du\s*:?\s*(\d{2}\/\d{2}\/\d{4})\s*$/i);
    if (dm) duDates.push(dm[1]);
  }
  if (duDates[0]) result.date_bcde = duDates[0];
  if (duDates[1]) result.date_bl = duDates[1];

  // --- BL number(s): may be inline after "BL N° :" or on its own line ---
  // Collect BL-shaped tokens (e.g. "106036-1", "132253-7") in the BL region.
  const blIdx = lines.findIndex((l) => /^\s*BL\s*N°/i.test(l));
  const blTokens = [];
  if (blIdx >= 0) {
    // inline after the label
    const inlineBl = lines[blIdx].match(/BL\s*N°\s*:?\s*(.+)$/i);
    if (inlineBl && inlineBl[1].trim()) {
      const toks = inlineBl[1].match(/\d{3,7}-\d+/g);
      if (toks) blTokens.push(...toks);
    }
    // standalone BL tokens in the following few lines (before first article).
    // A "BL line" is made up exclusively of BL-shaped tokens (one or several).
    for (let j = blIdx + 1; j < Math.min(blIdx + 8, lines.length); j++) {
      if (/^\d{4}\s/.test(lines[j])) break;
      const stripped = lines[j].replace(/\d{3,7}-\d+/g, "").replace(/[\s,]/g, "");
      if (stripped === "") {
        const toks = lines[j].match(/\d{3,7}-\d+/g);
        if (toks) blTokens.push(...toks);
      }
    }
  }
  result.bls = blTokens;
  if (blTokens.length) result.num_bl = blTokens[0];

  // --- Articles: reconstitute logical lines, then parse tail ---
  // The articles section starts at the "Article Désignation ..." header (or the
  // first 4-digit line) and ends at the "Régime TVA" / "Mt TVA" block.
  const startIdx = lines.findIndex((l) => /Article\s+D[ée]signation/i.test(l));
  const lignes = [];
  let acc = null; // accumulator { code, body }

  const flush = () => {
    if (!acc) return;
    const g = matchTimacLineTail(acc.body);
    if (g) {
      lignes.push({
        code_article: acc.code,
        designation: g.designation.replace(/\s+/g, " ").trim(),
        quantite: parseTimacNumber(g.quantite),
        unite: g.unite,
        remise: g.remise != null ? parseTimacNumber(g.remise) : 0,
        prix_unitaire: parseTimacNumber(g.prix_unitaire),
        montant: parseTimacNumber(g.montant),
      });
    }
    acc = null;
  };

  const isSectionEnd = (l) =>
    /^R[ée]gime\s+TVA/i.test(l) ||
    /^Mt\s+TVA\b/i.test(l) ||
    /Net\s+à\s+Payer/i.test(l);

  const scanFrom = startIdx >= 0 ? startIdx + 1 : 0;
  for (let i = scanFrom; i < lines.length; i++) {
    const l = lines[i];
    if (isSectionEnd(l)) { flush(); break; }
    const codeM = l.match(/^(\d{4})\s+(.*)$/);
    if (codeM) {
      // New article line begins -> flush the previous accumulation.
      flush();
      acc = { code: codeM[1], body: codeM[2] };
      // If this single line already completes, flush immediately.
      if (matchTimacLineTail(acc.body)) flush();
    } else if (acc) {
      // Continuation of a wrapped designation / line.
      acc.body = (acc.body + " " + l.trim()).replace(/\s+/g, " ").trim();
      if (matchTimacLineTail(acc.body)) flush();
    }
  }
  flush();
  result.lignes = lignes;

  // --- TVA block: total_ht = sum of 1st number of each "Cx" line ---
  // e.g. "8.500,00 0.00% 0.00 C1 8.500,00"  /  "31.627,03 20.00% 6,325.41 C2 37.952,44"
  let totalHt = 0;
  let totalTva = 0;
  let sawCx = false;
  for (const l of lines) {
    const cm = l.match(
      new RegExp("^\\s*(" + TIMAC_NUM + ")\\s+(\\d+[.,]\\d+)%\\s+\\S+.*\\bC\\d\\b")
    );
    if (cm) {
      sawCx = true;
      totalHt += parseTimacNumber(cm[1]) || 0;
      const rate = parseFloat(cm[2].replace(",", "."));
      if (rate > 0) {
        totalTva += (parseTimacNumber(cm[1]) || 0) * (rate / 100);
      }
    }
  }
  if (sawCx) {
    result.total_ht = Math.round(totalHt * 100) / 100;
    result.total_tva = Math.round(totalTva * 100) / 100;
  }

  // --- Net à Payer (TTC) ---
  // Find the "Net à Payer :" line and take the number before it on that line.
  for (let i = lines.length - 1; i >= 0; i--) {
    const nm = lines[i].match(new RegExp("^\\s*(" + TIMAC_NUM + ")\\s+Net\\s*à\\s*Payer\\s*:", "i"));
    if (nm) { result.net_a_payer = parseTimacNumber(nm[1]); break; }
  }

  // --- Reconciliation: Σ(lignes.montant) vs total_ht ---
  const sommeLignes = lignes.reduce((s, x) => s + (x.montant || 0), 0);
  const sommeRounded = Math.round(sommeLignes * 100) / 100;
  if (result.total_ht != null) {
    const ecart = Math.round((sommeRounded - result.total_ht) * 100) / 100;
    result.reconciliation = {
      somme_lignes: sommeRounded,
      total_ht: result.total_ht,
      ok: Math.abs(sommeRounded - result.total_ht) < 0.01,
      ecart,
    };
  } else {
    result.reconciliation = {
      somme_lignes: sommeRounded,
      total_ht: null,
      ok: false,
      ecart: null,
    };
  }

  return result;
}


/**
 * Parse a TIMAC invoice PDF buffer (native text, no OCR).
 * @param {Buffer} buffer
 * @returns {Promise<object>}
 */
async function parseTimacInvoicePdf(buffer) {
  const text = (await new PDFParse({ data: buffer }).getText()).text;
  return parseTimacInvoiceText(text);
}


/**
 * Create a TIMAC invoice from a parsed PDF object — shared by the email cron
 * (analyzeEmail) AND the historical backfill script so both go through the
 * exact same idempotence guard and write path.
 *
 * Hardening (décision Omar): an invoice without a supplier number
 * (`num_facture`) NEVER enters the payment workflow — it is flagged
 * `a_revoir` and nothing is written.
 *
 * @param {object} parsed  Output of parseTimacInvoicePdf / parseTimacInvoiceText.
 * @param {object} opts
 * @param {Buffer} [opts.pdfBuffer]  Raw PDF bytes (required for real writes).
 * @param {string} [opts.filename]   Source filename, used for the Storage path.
 * @param {string} [opts.source]     'email_timac' (cron) | 'backfill_timac'.
 * @param {boolean} [opts.dryRun]    When true, read-only: runs the idempotence
 *                                   check then returns 'would_create' without
 *                                   writing anything.
 * @returns {Promise<object>} One of:
 *   { status:'a_revoir', reason }
 *   { status:'skipped', reason, existing_numero, existing_id }
 *   { status:'would_create', numero_facture, fournisseur, date_facture, total_ttc, nb_lignes }
 *   { status:'created', numero, invoice_id, scan_id }
 */
async function createTimacInvoiceFromParsed(parsed, opts) {
  opts = opts || {};
  const source = opts.source || "email_timac";
  const dryRun = !!opts.dryRun;
  const parsedObj = parsed || {};

  const fournisseur = parsedObj.fournisseur || "TIMAC AGRO MAROC";
  const dateFacture = parsedObj.date_facture || null;
  const totalTtc = parsedObj.net_a_payer != null ? parsedObj.net_a_payer : null;
  const lignes = parsedObj.lignes || [];

  // --- TÂCHE A — Garde num_facture : jamais de facture sans numéro. ---
  if (!parsedObj.num_facture) {
    return { status: "a_revoir", reason: "num_facture absent" };
  }

  // --- Garde idempotence (lecture, faite même en dry-run). ---
  const dupSnap = await db
    .collection("invoices")
    .where("numero_facture", "==", parsedObj.num_facture)
    .limit(1)
    .get();
  if (!dupSnap.empty) {
    const existingDoc = dupSnap.docs[0];
    return {
      status: "skipped",
      reason: "existe déjà",
      existing_numero: existingDoc.data().numero || null,
      existing_id: existingDoc.id,
    };
  }

  if (dryRun) {
    return {
      status: "would_create",
      numero_facture: parsedObj.num_facture,
      fournisseur,
      date_facture: dateFacture,
      total_ttc: totalTtc,
      nb_lignes: lignes.length,
    };
  }

  // --- Écriture réelle. ---
  if (!opts.pdfBuffer) {
    throw new Error("createTimacInvoiceFromParsed: pdfBuffer requis pour une écriture réelle");
  }

  // a) Upload PDF to Storage (same bucket/path scheme as scan-facture).
  const bucket = admin.storage().bucket("berrygood-farms-photos");
  const ts = Date.now();
  const baseName = (opts.filename || parsedObj.num_facture || "facture_timac")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 60);
  const storagePath = `scans/factures/${ts}_${baseName}.pdf`;
  const storageFile = bucket.file(storagePath);
  await storageFile.save(opts.pdfBuffer, {
    metadata: { contentType: "application/pdf" },
  });
  const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

  // b) Create the invoice_scans record.
  const scanData = {
    source,
    status: "accepted",
    analysis: parsedObj,
    scan_url,
    matched_bdc_id: null,
    invoice_id: null,
    created_at: ts,
    updated_at: ts,
  };
  const scanRef = await db.collection("invoice_scans").add(scanData);

  // c) Allocate the next invoice number with the SAME counter as create-facture.
  const counterRef = db.collection("stock_config").doc("counters");
  const numero = await db.runTransaction(async (t) => {
    const csnap = await t.get(counterRef);
    const cdata = csnap.exists ? csnap.data() : {};
    const current = (cdata.invoice || 0) + 1;
    t.set(counterRef, { ...cdata, invoice: current }, { merge: true });
    return `FAC-${new Date().getFullYear()}-${String(current).padStart(4, "0")}`;
  });

  // d) Create the invoices doc with the same schema as create-facture.
  const items = lignes.map((ligne) => ({
    article: ligne.designation || "",
    quantite: ligne.quantite != null ? ligne.quantite : null,
    unite: ligne.unite || null,
    prix_unitaire: ligne.prix_unitaire != null ? ligne.prix_unitaire : null,
    taux_tva: null,
    montant_ht: ligne.montant != null ? ligne.montant : null,
    montant_tva: null,
    montant_ttc: null,
  }));
  const facData = {
    numero,
    numero_facture: parsedObj.num_facture,
    bdc_id: null,
    bdc_numero: null,
    fournisseur: { nom: "TIMAC AGRO MAROC", ice: parsedObj.ice || null },
    date_facture: dateFacture,
    items,
    total_ht: parsedObj.total_ht != null ? parsedObj.total_ht : null,
    total_tva: parsedObj.total_tva != null ? parsedObj.total_tva : null,
    total_ttc: totalTtc,
    discrepancies: [],
    has_discrepancies: false,
    payment_status: "non_payee",
    ferme: null,
    scan_url,
    scan_id: scanRef.id,
    source,
    history: [{ action: "created_from_email", at: new Date().toISOString() }],
    created_at: ts,
    updated_at: ts,
  };
  const invRef = await db.collection("invoices").add(facData);

  // e) Wire the invoice back onto the scan record.
  await scanRef.update({
    invoice_id: invRef.id,
    invoice_numero: numero,
    updated_at: Date.now(),
  });

  return { status: "created", numero, invoice_id: invRef.id, scan_id: scanRef.id };
}


/**
 * Parse a Driscoll's Grower Settlement Statement PDF to extract commission data.
 * The PDF contains per-kilo values in EUR: Net Sales, Commission, Rebate, Return to Grower.
 * Commission % = -(Commission + Rebate) / Net Sales
 */
async function parseSettlementStatementPdf(pdfBuffer) {
  try {
    const parser = new PDFParse({ data: pdfBuffer });
    const textResult = await parser.getText();
    const text = (textResult && textResult.text) || (typeof textResult === "string" ? textResult : "");
    if (!text) return null;

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    let netSalesEurKg = null;
    let commissionEurKg = null;
    let rebateEurKg = null;
    let returnToGrowerEurKg = null;
    let volumeKg = null;

    // Extract the last number on each relevant line (EUR/kilo column is rightmost)
    const lastNum = (line) => {
      const matches = line.match(/([-]?\d[\d,]*\.\d+)/g);
      if (!matches || matches.length === 0) return null;
      return parseFloat(matches[matches.length - 1].replace(/,/g, ""));
    };

    for (const line of lines) {
      if (/^net\s+sales\b/i.test(line) && netSalesEurKg === null) {
        netSalesEurKg = lastNum(line);
      } else if (/^commission\b/i.test(line) && !/commission\s*%/i.test(line) && commissionEurKg === null) {
        commissionEurKg = lastNum(line);
      } else if (/^rebate\b/i.test(line) && rebateEurKg === null) {
        rebateEurKg = lastNum(line);
      } else if (/return\s+to\s+grower/i.test(line) && returnToGrowerEurKg === null) {
        returnToGrowerEurKg = lastNum(line);
      } else if (/^volume\s+kg/i.test(line) && volumeKg === null) {
        const m = line.match(/([\d,]+\.\d+)/);
        if (m) volumeKg = parseFloat(m[1].replace(/,/g, ""));
      }
    }

    if (netSalesEurKg === null || commissionEurKg === null) return null;

    // Commission is negative (e.g. -3.70), Rebate is positive (e.g. 0.85)
    // Formula: -(Commission + Rebate) / Net Sales * 100
    const commissionPct = netSalesEurKg !== 0
      ? Math.round(-(commissionEurKg + (rebateEurKg || 0)) / netSalesEurKg * 10000) / 100
      : null;

    return { netSalesEurKg, commissionEurKg, rebateEurKg, returnToGrowerEurKg, volumeKg, commissionPct };
  } catch (err) {
    console.error("parseSettlementStatementPdf error:", err.message);
    return null;
  }
}


/**
 * Detect if an email is a Driscoll's Daily Quality Report (PDF with Brix points).
 */
function isDailyQualityReport(_from, subject) {
  const subjectText = (subject || "");
  // Match original sender or forwarded emails — subject always contains "Vendor 200741 - Daily Quality Report"
  return /vendor\s*200741.*daily\s*quality\s*report/i.test(subjectText);
}


/**
 * Detect if an email is a Weekly Quality Report (PDF with ranch-level quality data).
 */
function isWeeklyQualityReport(_from, subject) {
  return /weekly\s*(quality|grower)\s*report/i.test(subject || "");
}


/**
 * Detect if an email carries AGQ Labs analytical reports (foliar / soil / water).
 * Original sender is envioresultatsmaroc@agqlabs.com; transferred emails keep either
 * the sender visible in the body or a telltale subject.
 */
function isAgqAnalysisEmail(from, subject) {
  const f = (from || "").toLowerCase();
  const s = (subject || "");
  if (f.includes("agqlabs") || f.includes("envioresultatsmaroc")) return true;
  if (/ANALYSES?\s*FOLIAIRES?/i.test(s)) return true;
  if (/AGQ\s*LAB/i.test(s)) return true;
  if (/RAPPORT\s*DE\s*SUIVI\s*NUTRITIONNEL/i.test(s)) return true;
  return false;
}


/**
 * Parse a Weekly Quality Report PDF.
 * Extracts ranch-level data for our farms (200876 = F5, 200742 = F1).
 * Returns { week, year, berry, ourRanches: [...], allRanches: [...], brixSummary, pwResults, ytdResults }
 */
async function parseWeeklyQualityReportPdf(pdfBuffer) {
  const parser = new PDFParse({ data: pdfBuffer });
  const textResult = await parser.getText();
  const text = (textResult && textResult.text) || (typeof textResult === "string" ? textResult : "");
  const lines = text.split("\n");

  // Extract settlement week + year from header
  const weekMatch = text.match(/Settlement\s*Week\s*(\d+)/i);
  const yearMatch = text.match(/Year\s*(\d{4})/i) || text.match(/Year\s*of\s*Date\s*(\d{4})/i);
  const week = weekMatch ? parseInt(weekMatch[1]) : null;
  const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();

  // Detect berry type from subject context (RASP = framboise, BLUE = myrtille)
  const isBlueberry = /blueberr/i.test(text);
  const berry = isBlueberry ? "myrtille" : "framboise";

  // Extract PW Results - parse from the structured header
  // Format: "5.30%\t0.49%\t94.47%" on first data line
  const pwResultsLine = lines.find(l => /^\d+\.\d+%\t\d+\.\d+%\t\d+\.\d+%$/.test(l.trim()));
  const pwNums = pwResultsLine ? pwResultsLine.trim().split("\t").map(s => parseFloat(s)) : [];
  const pwResults = {
    inspectionPassRate: pwNums[0] || null,
    preInspRejectRate: pwNums[1] || null,
    reInspRejectRate: pwNums[2] || null,
  };

  // Also get YTD results (4 values)
  const ytdIdx = lines.findIndex(l => l.trim() === "YTD results");
  let ytdResults = null;
  if (ytdIdx > 0) {
    // Line after "YTD results" header row has 4 tab-separated values
    for (let i = ytdIdx + 1; i < Math.min(ytdIdx + 5, lines.length); i++) {
      const parts = lines[i].trim().split("\t").map(s => parseFloat(s));
      if (parts.length === 4 && parts.every(p => !isNaN(p))) {
        ytdResults = { inspPassRate: parts[0], reInspPassRate: parts[1], preInspRejectRate: parts[2], reInspRejectRate: parts[3] };
        break;
      }
    }
  }

  // Extract Brix Summary - varieties listed then 3 columns of numbers
  // Structure: Maravilla / Reyna™ / RN0523.2 / Yazmin™ then min/max/avg values
  const brixSummary = {};
  const brixSectionIdx = lines.findIndex(l => /Brix\s*Weighted\s*Avg/.test(l));
  if (brixSectionIdx > 0) {
    const varieties = [];
    const brixValues = [];
    for (let i = brixSectionIdx + 1; i < Math.min(brixSectionIdx + 20, lines.length); i++) {
      const trimmed = lines[i].trim();
      if (/^(Maravilla|Reyna|RN0523|RN0582|Yazmin|Breeze|Cascade|Corrina|Eterna|Regina|Rosita)/i.test(trimmed)) {
        // May have a number appended like "Yazmin™ \t0.00"
        const parts = trimmed.split("\t").map(s => s.trim());
        varieties.push(parts[0].replace("™", ""));
        if (parts.length > 1 && /^\d/.test(parts[1])) brixValues.push(parseFloat(parts[1]));
      } else if (/^\d+\.\d+$/.test(trimmed)) {
        brixValues.push(parseFloat(trimmed));
      } else if (/Brix\s*Summary/i.test(trimmed)) break;
    }
    // Values come in groups of 3 per variety: min, max, avg (or similar order)
    // From the PDF: varieties have 4 entries, then 12 numbers (3 per variety)
    if (varieties.length > 0 && brixValues.length >= varieties.length * 3) {
      for (let v = 0; v < varieties.length; v++) {
        brixSummary[varieties[v]] = {
          min: brixValues[v * 3],
          max: brixValues[v * 3 + 1],
          avg: brixValues[v * 3 + 2],
        };
      }
    }
  }

  // === RANKING SECTION: Extract ranch list + PQ scores ===
  // Ranch list: lines like "200981 \t200979 \tRASP" after "Tier Breakdown"
  // PQ scores: lines with just a number (e.g., "92.69") after the ranch list
  const ranchListEntries = [];
  const ranchLineRegex = /^(20\d{4})\s+(20\d{4})\s+(RASP|BLUE)$/;
  let inRanchList = false;
  let afterRanchList = false;
  const pqScores = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (/Tier\s*Breakdown/i.test(trimmed)) { inRanchList = true; continue; }
    if (inRanchList && !afterRanchList) {
      const rm = trimmed.match(ranchLineRegex);
      if (rm) {
        ranchListEntries.push({ ranchId: rm[1], vendorAcc: rm[2] });
      } else if (ranchListEntries.length > 0 && /^\d+\.\d+$/.test(trimmed)) {
        afterRanchList = true;
        pqScores.push(parseFloat(trimmed));
      }
    } else if (afterRanchList) {
      if (/^\d+\.\d+$/.test(trimmed)) {
        pqScores.push(parseFloat(trimmed));
      } else if (/^\d+%/.test(trimmed)) {
        break; // Tier breakdown percentages follow — stop
      }
    }
  }

  // Build allRanches with PQ scores matched by index
  const allRanches = ranchListEntries.map((entry, idx) => ({
    ranchId: entry.ranchId,
    vendorAcc: entry.vendorAcc,
    pqWeightedAvg: idx < pqScores.length ? pqScores[idx] : null,
  }));

  // === DETAIL SECTION: Parse ranch Pass/Fail rows + data rows ===
  // Structure: first all ranch+result entries, then all data rows in same order
  const detailStartIdx = lines.findIndex(l => /^Ranch\s*ID\s+Growing\s*Method/.test(l.trim()));
  const detailEntries = []; // { ranchId, result } — in order
  const dataRows = []; // { defects, brix, weight }

  if (detailStartIdx > 0) {
    let phase = "entries"; // "entries" then "data"
    for (let i = detailStartIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || /^--\s*\d+\s*of\s*\d+\s*--$/.test(trimmed) || /^Defects\s*%\s*by\s*Ranch$/i.test(trimmed)) continue;
      // Skip header continuation lines
      if (/^(Weight|KG|Brix|ghted|Leaky|Revers|ion|Insect|Decay|Mold|Shrivel|Overripe|Collap|Weak|Cells|Sooty|Yellow|Rust|Bruising|Mildew|Malfor|med|Green|Size|Skin|Damage|Foreign|Bloom|Stem|Blossom|Broken|Attach|ed\.\.|Shape|Calyx|\(KG\)|%$)/.test(trimmed)) continue;

      if (phase === "entries") {
        // Ranch entry: "200166 \tConventional \tPass"
        const entryMatch = trimmed.match(/^(20\d{4})\s+Conventional\s+(Pass|Fail|Incorrect Traceability)$/);
        if (entryMatch) {
          detailEntries.push({ ranchId: entryMatch[1], result: entryMatch[2] });
        } else if (/^(Pass|Fail|Incorrect Traceability)$/.test(trimmed)) {
          // Continuation of previous ranch (e.g., Fail after Pass)
          if (detailEntries.length > 0) {
            detailEntries.push({ ranchId: detailEntries[detailEntries.length - 1].ranchId, result: trimmed });
          }
        } else if (/^\d+\.\d+%/.test(trimmed)) {
          // Data rows start
          phase = "data";
          i--; // Re-process this line
        }
      } else {
        // Data row: "0.00%\t0.00%\t...\t8.00\t189"
        if (/^\d+\.\d+%/.test(trimmed) || /^0\.00\t/.test(trimmed)) {
          const parts = trimmed.split("\t").map(s => s.trim());
          // Last 2 columns are brix and weight
          const weight = parts.length >= 2 ? parseFloat(parts[parts.length - 1].replace(/,/g, "")) : 0;
          const brix = parts.length >= 2 ? parseFloat(parts[parts.length - 2]) : 0;
          // Defect percentages are the rest
          const defectPcts = parts.slice(0, -2).map(s => parseFloat(s));
          dataRows.push({ brix, weight, defectPcts });
        }
      }
    }
  }

  // Match detail entries to data rows by index
  const ourRanchIds = ["200876", "200742"];
  const ourRanches = [];
  const defectNames = ["Decay", "Wet/Leaky", "Reversion", "Insect/SWD", "Decay/Mold", "Soft", "Shriveled", "Overripe", "Collapsed", "Weak Cells", "Sooty Mold", "Yellow Rust", "Wet/Bruising", "Dry Bruising", "Mildew"];

  for (const ranchId of ourRanchIds) {
    const farmName = ranchId === "200742" ? "F1" : "F5";
    const ranchPq = allRanches.find(r => r.ranchId === ranchId);

    // Find all detail entries for this ranch
    const entryIndices = [];
    detailEntries.forEach((e, idx) => { if (e.ranchId === ranchId) entryIndices.push(idx); });

    let passWeight = 0, passBrix = 0, failWeight = 0, failBrix = 0;
    const defects = {};

    for (const idx of entryIndices) {
      if (idx < dataRows.length) {
        const row = dataRows[idx];
        const entry = detailEntries[idx];
        if (entry.result === "Pass") {
          passWeight = row.weight;
          passBrix = row.brix;
          // Store pass defects
          row.defectPcts.forEach((pct, di) => {
            if (di < defectNames.length) defects[defectNames[di]] = pct;
          });
        } else if (entry.result === "Fail") {
          failWeight = row.weight;
          failBrix = row.brix;
        }
      }
    }

    ourRanches.push({
      ranchId,
      farmName,
      pqWeightedAvg: ranchPq ? ranchPq.pqWeightedAvg : null,
      passWeight,
      passBrix,
      failWeight,
      failBrix,
      totalWeight: passWeight + failWeight,
      defects,
    });
  }

  // Extract global volume
  const volumeMatch = text.match(/([\d,]+)\s*\n.*Volume\s*by\s*PW/i);
  const totalVolume = volumeMatch ? parseFloat(volumeMatch[1].replace(/,/g, "")) : null;

  // Extract PQ summary (MIN/MAX/Weighted Avg)
  const maxPqMatch = text.match(/MAX\s*PQ[\s\S]*?([\d.]+)/i);
  const avgPqMatch = text.match(/PQ\s*Weighted\s*Avg[\s\S]*?([\d.]+)/i);
  const minPqMatch = text.match(/MIN\s*PQ[\s\S]*?([\d.]+)/i);
  const pqSummary = {
    max: maxPqMatch ? parseFloat(maxPqMatch[1]) : null,
    avg: avgPqMatch ? parseFloat(avgPqMatch[1]) : null,
    min: minPqMatch ? parseFloat(minPqMatch[1]) : null,
  };

  // Rank our ranches among all
  const sortedRanches = [...allRanches].filter(r => r.pqWeightedAvg != null).sort((a, b) => b.pqWeightedAvg - a.pqWeightedAvg);
  ourRanches.forEach(r => {
    const idx = sortedRanches.findIndex(sr => sr.ranchId === r.ranchId);
    r.rank = idx >= 0 ? idx + 1 : null;
    r.totalRanches = sortedRanches.length;
  });

  return {
    week,
    year,
    berry,
    pwResults,
    ytdResults,
    brixSummary,
    pqSummary,
    ourRanches,
    allRanchCount: allRanches.length,
    totalVolume,
    rawTextLength: text.length,
  };
}
module.exports = { ImapFlow, PDFParse, TIMAC_LINE_TAIL, TIMAC_NUM, TIMAC_NUM_RE, TIMAC_UNIT, XLSX, admin, cheerio, createImapClient, createTimacInvoiceFromParsed, db, functions, isAgqAnalysisEmail, isDailyQualityReport, isDriscolsQualityReport, isLiquidationEmail, isTimacInvoice, isWeeklyQualityReport, mapBerryToFrench, mapRanchToFermeCode, matchTimacLineTail, parseDriscolsReport, parseEmailHtmlTables, parseLiquidationSummaryPdf, parseLiquidationSummaryText, parseLiquidationXlsx, parseSettlementStatementPdf, parseTimacInvoicePdf, parseTimacInvoiceText, parseTimacNumber, parseWeeklyQualityReportPdf, requireAuth, simpleParser };
