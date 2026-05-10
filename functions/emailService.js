const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const cheerio = require("cheerio");
const XLSX = require("xlsx");
const { PDFParse } = require("pdf-parse");
const { requireAuth } = require("./middleware/requireAuth");

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

  // Parse a single sheet and return { week, rows, summary }
  function parseSheet(sheetName) {
    const sheet = workbook.Sheets[sheetName];
    const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

    const weekMatch = sheetName.match(/W\s*(\d+)/i);
    const week = weekMatch ? parseInt(weekMatch[1]) : null;
    const rows = [];

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

    return { week, rows, summary };
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
    const single = sheets[0] || { week: null, rows: [], summary: {} };
    return { week: single.week, period: null, liquidationNumber: null, rows: single.rows, summary: single.summary, _multiSheets: null };
  }

  // Multiple sheets: return first sheet as main result + attach all sheets
  const first = sheets[0];
  return { week: first.week, period: null, liquidationNumber: null, rows: first.rows, summary: first.summary, _multiSheets: sheets };
}

/**
 * Parse a Driscoll's LIQUIDATION summary PDF (separate from RECEIPT.xls).
 * The PDF contains a summary table with columns:
 *   Total in Kg | Base | Fruit Advance | DED Rasp (or Plant Deduction) | Crop Advance | DEX Adjustment | PKG deduction | Net Payable
 * and metadata: Numéro de liquidation (APIV-...), Periode, Date.
 * Returns { liquidationNumber, period, summary:{ totalKg, base, fruitAdvance, dedRasp, dedPlants, cropAdvance, dexAdjustment, pkgDeduction, netPayable } } or null.
 */
async function parseLiquidationSummaryPdf(pdfBuffer) {
  try {
    const parser = new PDFParse({ data: pdfBuffer });
    const textResult = await parser.getText();
    const text = (textResult && textResult.text) || (typeof textResult === "string" ? textResult : "");
    if (!text) return null;

    const result = { liquidationNumber: null, period: null, summary: {} };

    const apiv = text.match(/(APIV-\d+)/i);
    if (apiv) result.liquidationNumber = apiv[1];

    const period = text.match(/P[eé]riode\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if (period) result.period = `${period[1]} - ${period[2]}`;

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const headerIdx = lines.findIndex(l =>
      /Total\s+in\s+Kg.*Base.*Fruit\s+Advance.*Net\s+Payable/i.test(l)
    );
    if (headerIdx < 0) return result;

    const headerLine = lines[headerIdx];
    const valuesLine = lines[headerIdx + 1];
    if (!valuesLine) return result;

    // Detect whether column 4 is "DED Rasp" (framboise) or "Plant Deduction" / "DED Plants" (myrtille)
    const isBlueLayout = /plant\s*deduction|ded\.?\s*plants?/i.test(headerLine);

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
    // Expected 8 values: [totalKg, base, fruitAdvance, ded(Rasp|Plants), cropAdvance, dexAdjustment, pkg(deduction|Caution), netPayable]
    if (nums.length < 8) return result;

    const [tk, b, fa, dedCol, ca, dex, pkg, np] = nums.slice(0, 8);
    result.summary = {
      totalKg: tk,
      base: b,
      fruitAdvance: fa,
      dedRasp: isBlueLayout ? 0 : dedCol,
      dedPlants: isBlueLayout ? dedCol : 0,
      cropAdvance: ca,
      dexAdjustment: dex,
      pkgDeduction: pkg,
      netPayable: np,
    };
    return result;
  } catch (err) {
    console.error("parseLiquidationSummaryPdf error:", err.message);
    return null;
  }
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

/**
 * Parse the first page of a Daily Quality Report PDF.
 * Extracts the "Inspections By Batch" table with BrixPoints per batch.
 * Returns an array of { receiptId, berryType, variety, productName, inspectionResult,
 *   batchId, quantity, weight, brix, brixPoints, enrichedPqScore, initialPq, totalFruitInspected }
 */
/**
 * Parse a Daily Quality Report XLSX attachment.
 * Sheet "InspectionsByBatch" has columns: Batchid, Brix, Brix Points, Enriched PQ Score, etc.
 * Returns array of extracted rows.
 */
function parseDailyQualityReportXlsx(xlsxBuffer) {
  const workbook = XLSX.read(xlsxBuffer, { type: "buffer" });
  const sheetName = workbook.SheetNames.find(n => /inspection/i.test(n)) || workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Expand merged cells: copy the value from the top-left cell to all cells in the merged range
  // This is required because DQR XLSX uses merged cells for Receipt ID, Ranch Name, etc.
  if (sheet['!merges']) {
    for (const merge of sheet['!merges']) {
      const origin = sheet[XLSX.utils.encode_cell({ r: merge.s.r, c: merge.s.c })];
      if (!origin) continue;
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        for (let c = merge.s.c; c <= merge.e.c; c++) {
          if (r === merge.s.r && c === merge.s.c) continue;
          sheet[XLSX.utils.encode_cell({ r, c })] = { ...origin };
        }
      }
    }
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  console.log(`parseDailyQualityReportXlsx: sheet "${sheetName}" has ${rows.length} rows after merge expansion`);

  const results = [];
  let lastReceiptId = null;
  let lastReceiptDate = null;
  let lastRanchName = null;
  let lastWarehouse = null;
  let lastBerryType = null;
  let lastVariety = null;
  let lastProductName = null;
  for (const row of rows) {
    const batchId = row["Batchid"] || row["BatchId"] || row["batchid"] || row["BatchID"] || row["BATCHID"] || null;
    if (!batchId) continue;

    const currentReceiptId = (row["Receipt ID"] || row["ReceiptID"] || "").toString().replace(/‑/g, "-");
    if (currentReceiptId) lastReceiptId = currentReceiptId;
    const currentReceiptDate = row["Receipt Date"] || row["ReceiptDate"] || null;
    if (currentReceiptDate) lastReceiptDate = currentReceiptDate;
    const currentRanchName = row["Ranch Name"] || row["RanchName"] || null;
    if (currentRanchName) lastRanchName = currentRanchName;
    const currentWarehouse = row["Warehouse"] || null;
    if (currentWarehouse) lastWarehouse = currentWarehouse;
    const currentBerryType = row["Berry Type"] || row["BerryType"] || null;
    if (currentBerryType) lastBerryType = currentBerryType;
    const currentVariety = row["Variety"] || null;
    if (currentVariety) lastVariety = currentVariety;
    const currentProductName = row["Product Name"] || row["ProductName"] || null;
    if (currentProductName) lastProductName = currentProductName;

    const rawInspResult = row["Inspection Result"] || row["InspectionResult"] || null;
    const rawInspType = row["Inspection Type"] || row["InspectionType"] || null;
    // By-Pass inspections have "Null" as result — treat as PASS
    const isByPass = (rawInspType || '').toLowerCase().includes('by') && (rawInspType || '').toLowerCase().includes('pass');
    const inspectionResult = (rawInspResult && rawInspResult !== 'Null') ? rawInspResult : (isByPass ? 'PASS' : null);

    results.push({
      receiptId: currentReceiptId || lastReceiptId || "",
      berryType: currentBerryType || lastBerryType || null,
      variety: ((currentVariety || lastVariety || "").toString()).replace(/[™®]/g, ""),
      productName: currentProductName || lastProductName || null,
      inspectionResult: inspectionResult,
      inspectionType: rawInspType,
      batchId: batchId,
      quantity: parseFloat(row["Quantity"] || 0) || 0,
      weight: parseFloat(row["Weight (KG)"] || row["Weight(KG)"] || row["Weight"] || 0) || 0,
      brix: parseFloat(row["Brix"]) || 0,
      brixPoints: parseFloat(row["Brix Points"]) || 0,
      enrichedPqScore: parseFloat(row["Enriched PQ Score"]) || 0,
      initialPq: parseFloat(row["Initial Inspection PQ score"]) || 0,
      reInspectionPq: parseFloat(row["Re-Inspection PQ"]) || 0,
      totalFruitInspected: parseFloat(row["Total Fruit Inspected"]) || 0,
      ranchName: currentRanchName || lastRanchName || null,
      receiptDate: currentReceiptDate || lastReceiptDate || null,
      warehouse: currentWarehouse || lastWarehouse || null,
    });
  }

  console.log(`parseDailyQualityReportXlsx: extracted ${results.length} rows from sheet "${sheetName}"`);
  return results;
}

/**
 * CORS headers helper (same pattern as index.js)
 */
const ALLOWED_ORIGINS = [
  "https://berrygood-farms-dashboard.web.app",
  "https://berrygood-farms-dashboard.firebaseapp.com",
  "http://localhost:8088",
  "http://localhost:5000",
];

function setCors(res, req) {
  const origin = req && req.headers && req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
  }
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// =============================================
// Function 1: fetchEmails (Scheduled — every 1 minute, GCP minimum)
// =============================================
exports.fetchEmails = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .pubsub.schedule("every 1 minutes")
  .timeZone("Africa/Casablanca")
  .onRun(async (_context) => {
    const configRef = db.collection("email_config").doc("settings");

    let lastPollUid = 0;
    try {
      const configSnap = await configRef.get();
      if (configSnap.exists) {
        lastPollUid = configSnap.data().lastPollUid || 0;
      }
    } catch (e) {
      console.warn("Could not read email config:", e.message);
    }

    const client = createImapClient();
    let fetchedCount = 0;
    let maxUid = lastPollUid;

    try {
      await client.connect();
      const mailbox = process.env.IMAP_MAILBOX || "INBOX";
      await client.mailboxOpen(mailbox);

      // Search for unseen messages (or all messages with UID > lastPollUid)
      let searchCriteria;
      if (lastPollUid > 0) {
        searchCriteria = { uid: `${lastPollUid + 1}:*` };
      } else {
        // First run: only fetch unseen to avoid flooding
        searchCriteria = { unseen: true };
      }

      const messages = [];
      for await (const msg of client.fetch(searchCriteria, {
        uid: true,
        envelope: true,
        source: true,
      })) {
        // Skip the lastPollUid itself (IMAP range is inclusive)
        if (msg.uid <= lastPollUid) continue;
        messages.push(msg);
        if (messages.length >= 50) break; // Safety limit per poll
      }

      for (const msg of messages) {
        try {
          const parsed = await simpleParser(msg.source);

          // Check if this is a Daily Quality Report — if so, store PDF content
          const emailFrom = (parsed.from?.text || "").toLowerCase().trim();
          const emailSubject = parsed.subject || "(sans sujet)";
          const isDQR = isDailyQualityReport(emailFrom, emailSubject);
          const isLiquidation = isLiquidationEmail(emailFrom, emailSubject);
          const isWeeklyQR = isWeeklyQualityReport(emailFrom, emailSubject);
          // AGQ labs: also check the body for the forwarded original sender.
          const bodyForAgq = `${parsed.text || ""} ${parsed.html || ""}`;
          const isAgq = isAgqAnalysisEmail(emailFrom, emailSubject) ||
            /envioresultatsmaroc@agqlabs/i.test(bodyForAgq);
          const isPfqDirect = isDriscolsQualityReport(emailSubject, parsed.text || "", parsed.html || "");

          // Store XLSX attachments for Daily Quality Reports and Liquidations
          const attachmentsMeta = (parsed.attachments || []).map((a) => ({
            filename: a.filename || "unknown",
            contentType: a.contentType || "application/octet-stream",
            size: a.size || 0,
          }));

          let xlsxBase64 = null;
          let pdfBase64 = null;
          // AGQ emails carry N PDFs (1 per analysis). Keep them all in-line so
          // analyzeEmail can fan out without re-fetching from IMAP.
          let agqPdfAttachments = null;
          if (isAgq && parsed.attachments && parsed.attachments.length > 0) {
            agqPdfAttachments = parsed.attachments
              .filter(a => /\.pdf$/i.test(a.filename || "") && a.content)
              .map(a => ({
                filename: a.filename,
                size: a.size || 0,
                contentBase64: a.content.toString("base64"),
              }));
          }

          // Store PDF for Weekly Quality Reports
          if (isWeeklyQR && parsed.attachments && parsed.attachments.length > 0) {
            const pdfAtt = parsed.attachments.find(a => /\.pdf$/i.test(a.filename || ""));
            if (pdfAtt && pdfAtt.content) pdfBase64 = pdfAtt.content.toString("base64");
          }

          // For liquidation emails, also grab the "LIQUIDATION*.pdf" summary attachment (contains financial totals)
          let liqSummaryPdfBase64 = null;
          if (isLiquidation && parsed.attachments && parsed.attachments.length > 0) {
            const summaryPdf = parsed.attachments.find(
              (a) => /\.pdf$/i.test(a.filename || "") &&
                     /LIQUIDATION/i.test(a.filename || "") &&
                     a.content
            );
            if (summaryPdf) {
              liqSummaryPdfBase64 = summaryPdf.content.toString("base64");
              console.log(`fetchEmails: Found liquidation summary PDF: ${summaryPdf.filename} (${summaryPdf.size} bytes)`);
            }
          }

          // For liquidation emails, also grab the Grower Settlement Statement PDF (commission breakdown)
          let gssPdfBase64 = null;
          if (isLiquidation && parsed.attachments && parsed.attachments.length > 0) {
            const gssPdf = parsed.attachments.find(
              (a) => /\.pdf$/i.test(a.filename || "") &&
                     !/LIQUIDATION/i.test(a.filename || "") &&
                     /Berry\s*Good|RASPBERRIES\s+WEEK|BLUEBERRIES\s+WEEK|Grower\s+Settlement/i.test(a.filename || "") &&
                     a.content
            );
            if (gssPdf) {
              gssPdfBase64 = gssPdf.content.toString("base64");
              console.log(`fetchEmails: Found GSS PDF: ${gssPdf.filename} (${gssPdf.size} bytes)`);
            }
          }

          if ((isDQR || isLiquidation) && parsed.attachments && parsed.attachments.length > 0) {
            const allXls = parsed.attachments.filter(
              (a) => /\.(xlsx|xls)$/i.test(a.filename || "") && a.content
            );

            // For liquidation emails with multiple XLS attachments, create one doc per attachment
            if (isLiquidation && allXls.length > 1) {
              const baseId = (parsed.messageId || `uid-${msg.uid}`)
                .replace(/[^a-zA-Z0-9_-]/g, "_")
                .slice(0, 180);
              for (let xi = 0; xi < allXls.length; xi++) {
                const att = allXls[xi];
                const attDocId = `${baseId}_att${xi}`;
                const existing = await db.collection("emails").doc(attDocId).get();
                if (!existing.exists) {
                  await db.collection("emails").doc(attDocId).set({
                    messageId: parsed.messageId || `uid-${msg.uid}`,
                    uid: msg.uid,
                    from: parsed.from?.text || "",
                    fromName: parsed.from?.value?.[0]?.name || "",
                    to: parsed.to?.text || "",
                    subject: `${emailSubject} [${att.filename}]`,
                    date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                    receivedAt: new Date().toISOString(),
                    textBody: (parsed.text || "").slice(0, 50000),
                    htmlBody: (parsed.html || "").slice(0, 100000),
                    hasAttachments: true,
                    attachments: [{ filename: att.filename || "unknown", contentType: att.contentType || "application/octet-stream", size: att.size || 0 }],
                    xlsxBase64: att.content.toString("base64"),
                    liqSummaryPdfBase64: liqSummaryPdfBase64,
                    gssPdfBase64: gssPdfBase64,
                    isDailyQualityReport: false,
                    isLiquidation: true,
                    status: "pending",
                    analysisError: null,
                    extractedTablesRaw: [],
                  });
                  console.log(`fetchEmails: Stored liquidation attachment ${xi + 1}/${allXls.length}: ${att.filename} (${att.size} bytes)`);
                }
              }
              // Skip storing the main email doc with single xlsxBase64
              xlsxBase64 = null;
            } else if (allXls.length > 0) {
              xlsxBase64 = allXls[0].content.toString("base64");
              console.log(`fetchEmails: Stored XLS(X) attachment (${allXls[0].filename}, ${allXls[0].size} bytes) for ${isDQR ? 'DQR' : 'Liquidation'}`);
            }
          }

          const emailDoc = {
            messageId: parsed.messageId || `uid-${msg.uid}`,
            uid: msg.uid,
            from: parsed.from?.text || "",
            fromName: parsed.from?.value?.[0]?.name || "",
            to: parsed.to?.text || "",
            subject: emailSubject,
            date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            textBody: (parsed.text || "").slice(0, 50000),
            htmlBody: (parsed.html || "").slice(0, 100000),
            hasAttachments: (parsed.attachments || []).length > 0,
            attachments: attachmentsMeta,
            xlsxBase64: xlsxBase64,
            pdfBase64: pdfBase64,
            liqSummaryPdfBase64: liqSummaryPdfBase64,
            gssPdfBase64: gssPdfBase64,
            isDailyQualityReport: isDQR,
            isLiquidation: isLiquidation,
            isWeeklyQualityReport: isWeeklyQR,
            isAgqAnalysis: isAgq,
            isDriscolsReport: isPfqDirect,
            agqPdfAttachments: agqPdfAttachments,
            status: "pending",
            analysisError: null,
            extractedTablesRaw: [],
          };

          // Use sanitized messageId as doc ID
          const docId = (emailDoc.messageId || `uid-${msg.uid}`)
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(0, 200);

          // --- BULK EMAILS: extract .eml attachments (quality reports OR liquidations) ---
          const hasEmlAttachments = parsed.attachments && parsed.attachments.some(
            (a) => (a.filename || "").toLowerCase().endsWith(".eml") ||
                   (a.contentType || "").includes("message/rfc822")
          );
          const isBulk = hasEmlAttachments && (
            /bulk.*(quality|qualit|rapport)/i.test(emailSubject) ||
            isLiquidation ||
            isDQR ||
            isAgq ||
            /ANALYSES?\s*FOLIAIRES?/i.test(emailSubject)
          );
          if (isBulk && parsed.attachments && parsed.attachments.length > 0) {
            const emlAttachments = parsed.attachments.filter(
              (a) => (a.filename || "").toLowerCase().endsWith(".eml") ||
                     (a.contentType || "").includes("message/rfc822")
            );
            console.log(`fetchEmails: BULK email detected — ${emlAttachments.length} .eml attachments, ${parsed.attachments.length} total attachments`);

            let bulkCount = 0;
            for (const emlAtt of emlAttachments) {
              try {
                const innerParsed = await simpleParser(emlAtt.content);
                const innerFrom = (innerParsed.from?.text || "").toLowerCase().trim();
                const innerSubject = innerParsed.subject || "(sans sujet)";
                const innerIsDQR = isDailyQualityReport(innerFrom, innerSubject);
                const innerIsLiquidation = isLiquidationEmail(innerFrom, innerSubject);

                const innerAttachmentsMeta = (innerParsed.attachments || []).map((a) => ({
                  filename: a.filename || "unknown",
                  contentType: a.contentType || "application/octet-stream",
                  size: a.size || 0,
                }));

                let innerXlsx = null;
                let innerLiqPdf = null;
                if ((innerIsDQR || innerIsLiquidation) && innerParsed.attachments) {
                  const xa = innerParsed.attachments.find((a) => /\.(xlsx|xls)$/i.test(a.filename || ""));
                  if (xa && xa.content) innerXlsx = xa.content.toString("base64");
                  if (innerIsLiquidation) {
                    const pa = innerParsed.attachments.find(
                      (a) => /\.pdf$/i.test(a.filename || "") && /LIQUIDATION/i.test(a.filename || "") && a.content
                    );
                    if (pa) innerLiqPdf = pa.content.toString("base64");
                  }
                }
                // GSS PDF for inner liquidation emails
                let innerGssPdf = null;
                if (innerIsLiquidation && innerParsed.attachments) {
                  const ga = innerParsed.attachments.find(
                    (a) => /\.pdf$/i.test(a.filename || "") &&
                           !/LIQUIDATION/i.test(a.filename || "") &&
                           /Berry\s*Good|RASPBERRIES\s+WEEK|BLUEBERRIES\s+WEEK|Grower\s+Settlement/i.test(a.filename || "") &&
                           a.content
                  );
                  if (ga) innerGssPdf = ga.content.toString("base64");
                }

                // AGQ detection for inner .eml emails
                const innerBodyForAgq = `${innerParsed.text || ""} ${innerParsed.html || ""}`;
                const innerIsAgq = isAgqAnalysisEmail(innerFrom, innerSubject) ||
                  /envioresultatsmaroc@agqlabs/i.test(innerBodyForAgq);
                let innerAgqPdfs = null;
                if (innerIsAgq && innerParsed.attachments && innerParsed.attachments.length > 0) {
                  innerAgqPdfs = innerParsed.attachments
                    .filter(a => /\.pdf$/i.test(a.filename || "") && a.content)
                    .map(a => ({ filename: a.filename, size: a.size || 0, contentBase64: a.content.toString("base64") }));
                }

                const innerDoc = {
                  messageId: innerParsed.messageId || `bulk-${msg.uid}-${bulkCount}`,
                  uid: msg.uid,
                  from: innerParsed.from?.text || emailFrom,
                  fromName: innerParsed.from?.value?.[0]?.name || "",
                  to: innerParsed.to?.text || "",
                  subject: innerSubject,
                  date: innerParsed.date ? innerParsed.date.toISOString() : emailDoc.date,
                  receivedAt: new Date().toISOString(),
                  textBody: (innerParsed.text || "").slice(0, 50000),
                  htmlBody: (innerParsed.html || "").slice(0, 100000),
                  hasAttachments: (innerParsed.attachments || []).length > 0,
                  attachments: innerAttachmentsMeta,
                  xlsxBase64: innerXlsx,
                  liqSummaryPdfBase64: innerLiqPdf,
                  gssPdfBase64: innerGssPdf,
                  isDailyQualityReport: innerIsDQR,
                  isLiquidation: innerIsLiquidation,
                  isDriscolsReport: isDriscolsQualityReport(innerSubject, innerParsed.text || "", innerParsed.html || ""),
                  isAgqAnalysis: innerIsAgq,
                  agqPdfAttachments: innerAgqPdfs,
                  bulkParentUid: msg.uid,
                  status: "pending",
                  analysisError: null,
                  extractedTablesRaw: [],
                };

                const innerDocId = (innerDoc.messageId || `bulk-${msg.uid}-${bulkCount}`)
                  .replace(/[^a-zA-Z0-9_-]/g, "_")
                  .slice(0, 200);

                // Check if already exists (avoid re-processing duplicates)
                const existing = await db.collection("emails").doc(innerDocId).get();
                if (!existing.exists) {
                  await db.collection("emails").doc(innerDocId).set(innerDoc);
                  bulkCount++;
                  console.log(`fetchEmails: Extracted inner email ${bulkCount}: "${innerSubject}"`);
                } else {
                  console.log(`fetchEmails: Skipping duplicate inner email: "${innerSubject}"`);
                }
              } catch (innerErr) {
                console.error(`Error parsing inner .eml attachment:`, innerErr.message);
              }
            }

            // Also check for forwarded emails as inline message/rfc822 parts that might not be in attachments
            // Store the bulk wrapper email itself (for tracking)
            emailDoc.isBulkWrapper = true;
            emailDoc.bulkExtractedCount = bulkCount;
            emailDoc.status = "analyzed"; // The wrapper itself doesn't need analysis
            await db.collection("emails").doc(docId).set(emailDoc);
            fetchedCount += bulkCount;
            console.log(`fetchEmails: BULK processing complete — ${bulkCount} inner emails extracted`);
          } else {
            await db.collection("emails").doc(docId).set(emailDoc);
            fetchedCount++;
          }

          if (msg.uid > maxUid) maxUid = msg.uid;

          // Mark as seen on the IMAP server
          await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
        } catch (parseErr) {
          console.error(`Error parsing email UID ${msg.uid}:`, parseErr.message);
        }
      }

      // Update config
      await configRef.set(
        {
          lastPollTimestamp: new Date().toISOString(),
          lastPollUid: maxUid,
          totalEmailsFetched: admin.firestore.FieldValue.increment(fetchedCount),
          lastError: null,
          lastErrorTimestamp: null,
        },
        { merge: true }
      );

      console.log(`fetchEmails: ${fetchedCount} emails fetched, maxUid=${maxUid}`);
    } catch (err) {
      console.error("fetchEmails error:", err.message);
      await configRef.set(
        {
          lastError: err.message,
          lastErrorTimestamp: new Date().toISOString(),
        },
        { merge: true }
      );
    } finally {
      try {
        await client.logout();
      } catch (_) {
        // ignore logout errors
      }
    }

    // --- Retry emails stuck in "error" or "analyzing" status ---
    try {
      const erroredSnap = await db.collection("emails")
        .where("status", "==", "error")
        .limit(5)
        .get();
      for (const doc of erroredSnap.docs) {
        const data = doc.data();
        if ((data.retryCount || 0) >= 3) continue;
        const age = Date.now() - new Date(data.receivedAt).getTime();
        if (age > 3600000) continue; // Only retry recent (< 1h)
        await doc.ref.delete();
        await db.collection("emails").doc(doc.id).set({
          ...data,
          status: "pending",
          analysisError: null,
          retryCount: (data.retryCount || 0) + 1,
        });
        console.log(`fetchEmails: Retrying errored email ${doc.id} (attempt ${(data.retryCount || 0) + 1})`);
      }

      const stuckSnap = await db.collection("emails")
        .where("status", "==", "analyzing")
        .limit(5)
        .get();
      for (const doc of stuckSnap.docs) {
        const data = doc.data();
        if ((data.retryCount || 0) >= 3) continue;
        const age = Date.now() - new Date(data.receivedAt).getTime();
        if (age < 300000) continue; // Wait 5 min before retrying
        await doc.ref.delete();
        await db.collection("emails").doc(doc.id).set({
          ...data,
          status: "pending",
          analysisError: null,
          retryCount: (data.retryCount || 0) + 1,
        });
        console.log(`fetchEmails: Retrying stuck email ${doc.id} (was analyzing for ${Math.round(age / 60000)}min)`);
      }
    } catch (retryErr) {
      console.error("fetchEmails retry error:", retryErr.message);
    }

    return null;
  });

// =============================================
// Function 2: analyzeEmail (Firestore trigger — onCreate)
// =============================================
exports.analyzeEmail = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .firestore.document("emails/{emailId}")
  .onCreate(async (snap, context) => {
    const emailId = context.params.emailId;
    const emailData = snap.data();

    if (emailData.status !== "pending") return null;

    const emailRef = db.collection("emails").doc(emailId);
    await emailRef.update({ status: "analyzing" });

    try {
      // 1. Extract HTML tables with cheerio
      const tables = parseEmailHtmlTables(emailData.htmlBody);

      // Save raw tables to the email doc (flatten rows to avoid Firestore nested array error)
      const tablesForFirestore = tables.map(t => ({
        headers: t.headers,
        rows: t.rows.map(row => row.join(" | ")),
      }));
      await emailRef.update({ extractedTablesRaw: tablesForFirestore });

      // 2. Check if this is a Driscoll's Quality Inspection Report from the official sender
      const emailFrom = (emailData.from || "").toLowerCase().trim();
      const isFromQaInspect = emailFrom === "qainspectresults@driscolls.com" || emailFrom.includes("qainspectresults@driscolls.com");
      // Also accept emails flagged as isDriscolsReport (from bulk extraction) BUT exclude DQR and liquidation emails
      const isDriscolsFlagged = emailData.isDriscolsReport === true && !emailData.isDailyQualityReport && !emailData.isLiquidation;
      const isDriscols = (isFromQaInspect || isDriscolsFlagged) &&
        isDriscolsQualityReport(emailData.subject, emailData.textBody, emailData.htmlBody);

      console.log(`analyzeEmail: ${emailId} — from="${emailFrom}" isFromQaInspect=${isFromQaInspect} isDriscolsFlagged=${isDriscolsFlagged} isDriscols=${isDriscols} subject="${(emailData.subject || '').slice(0, 80)}"`);

      let category = "other";
      let summary = "";
      const structuredData = {};
      let expeditionId = null;

      if (isDriscols) {
        // ---- Driscoll's Quality Inspection Report ----
        category = "quality_inspection";
        const report = parseDriscolsReport(emailData.htmlBody, emailData.textBody, emailData.subject);

        // Skip if parsing failed — avoid creating ghost expeditions with empty fields
        if (!report || !report.receiptNumber) {
          console.log(`analyzeEmail: Skipping email ${emailId} — PFQ parsing returned no receiptNumber`);
          summary = "Email détecté comme PFQ mais parsing échoué (pas de receiptNumber)";
          await emailRef.update({ category: "quality_inspection_failed", analysis: { summary }, analyzedAt: new Date().toISOString() });
          return res.json({ success: true, emailId, category: "quality_inspection_failed", summary });
        }

        // Build expedition document
        const now = new Date().toISOString();
        const receiptId = report.receiptNumber.replace(/‑/g, "-");
        // A single Driscoll's receipt can contain multiple batches (different varieties),
        // each inspected separately → include batchNumber in docId to avoid overwriting.
        const batchSlug = report.batchNumber
          ? String(report.batchNumber).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
          : null;
        const expDocId = receiptId
          ? (batchSlug ? `${receiptId}__${batchSlug}` : receiptId)
          : `EXP-${emailId}`;

        const expedition = {
          emailId,
          receiptId: receiptId || null,
          batchNumber: report.batchNumber || null,
          license: report.license || null,
          date: report.receivedDate || emailData.date,
          inspectedDate: report.inspectedDate || null,
          berryType: report.berryType || null,
          berryTypeFr: mapBerryToFrench(report.berryType),
          variety: report.variety || null,
          item: report.item || null,
          itemDescription: report.itemDescription || null,
          ranch: report.ranch || null,
          ranchName: report.ranchName || null,
          batchWeight: report.batchWeight || null,
          batchQuantity: report.batchQuantity || null,
          sampleSize: report.sampleSize || null,
          avgFruitsPerPunnet: report.avgFruitsPerPunnet || null,
          avgPunnetWeight: report.avgPunnetWeight || null,
          totalFruitInspected: report.totalFruitInspected || null,
          brix: report.brix || null,
          conditionDefects: report.conditionDefects || [],
          appearanceDefects: report.appearanceDefects || [],
          overallResult: report.overallResult || null,
          inspectionType: report.inspectionType || null,
          status: report.overallResult === "PASS" ? "PFQ Reçu. Attente Brix" : (report.overallResult === "REJECT" ? "Rejeté" : (report.overallResult === "FAIL" ? "PFQ rejeté" : "PFQ Reçu. Attente Brix")),
          updatedAt: now,
          source: "email",
        };

        // Calculate PFQ scores from the summary rows in defects
        const allDefects = [...(report.conditionDefects || []), ...(report.appearanceDefects || [])];
        const conditionRow = allDefects.find(d => d.name && d.name.toLowerCase() === "condition");
        const appearanceRow = allDefects.find(d => d.name && d.name.toLowerCase() === "appearance");
        expedition.pfqCondition = conditionRow ? (conditionRow.points || 0) : 0;
        expedition.pfqApparence = appearanceRow ? (appearanceRow.points || 0) : 0;
        expedition.pfqTotal = expedition.pfqCondition + expedition.pfqApparence;

        expedition.totalDefectPoints = allDefects.reduce((sum, d) => sum + (d.points || 0), 0);
        expedition.totalDefectPercent = allDefects.reduce((sum, d) => sum + (d.percent || 0), 0);
        expedition.pqScore = expedition.pfqTotal;

        // Only set createdAt if expedition doesn't already exist (avoid overwriting on duplicates)
        const existingExp = await db.collection("expeditions").doc(expDocId).get();
        if (!existingExp.exists) {
          expedition.createdAt = now;
        } else {
          // Protect higher-priority statuses from being overwritten
          const existingStatus = (existingExp.data().status || "").toLowerCase();
          const protectedStatuses = ["liquidée", "pfq brix reçu", "pfq brix recu", "annulée (doublon)"];
          if (protectedStatuses.some(ps => existingStatus.includes(ps.replace("é", "e")) || existingStatus === ps)) {
            delete expedition.status; // Don't regress the status
          }
          // Also protect existing Rejeté status
          if (existingStatus.includes("rejet")) {
            delete expedition.status;
          }
        }

        await db.collection("expeditions").doc(expDocId).set(expedition, { merge: true });
        expeditionId = expDocId;

        // WhatsApp: notify chef de ferme + qualité + DG en cas de rejet (REJECT/FAIL)
        if ((report.overallResult === "REJECT" || report.overallResult === "FAIL") && !existingExp.exists) {
          try {
            const { dispatchNotification } = require("./notificationDispatcher");
            // Build top defects summary as reason
            const defects = [...(report.conditionDefects || []), ...(report.appearanceDefects || [])]
              .filter(d => d.percent > 0 || d.points > 0)
              .sort((a, b) => (b.percent || 0) - (a.percent || 0))
              .slice(0, 2)
              .map(d => `${d.name} ${d.percent ? d.percent + "%" : ""}`.trim())
              .join(", ");
            const ferme = report.ranchName || report.ranch || "—";
            const dateTime = expedition.inspectedDate || expedition.date
              ? new Date(expedition.inspectedDate || expedition.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
              : "—";
            // Map Driscoll's ranch → internal F-code so chef-de-ferme users get matched
            // (their `ferme` field stores "F1"/"F5", not Driscoll's name/code).
            const fermeCode = mapRanchToFermeCode(report.ranch) || mapRanchToFermeCode(report.ranchName);
            if (!fermeCode) {
              // Unknown ranch: notify all chefs as fallback + log admin alert so mapping can be fixed.
              console.error(
                `[expedition_rejected] Unmapped Driscoll's ranch — notifying all chefs as fallback. ranch="${report.ranch}" ranchName="${report.ranchName}" receipt="${receiptId || expDocId}"`
              );
              try {
                await db.collection("admin_alerts").add({
                  type: "unmapped_ranch",
                  context: "expedition_rejected",
                  ranch: report.ranch || null,
                  ranchName: report.ranchName || null,
                  receiptId: receiptId || expDocId || null,
                  expeditionId: expDocId || null,
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              } catch (alertErr) {
                console.error("Failed to write admin_alerts entry for unmapped ranch:", alertErr);
              }
            }
            dispatchNotification({
              type: "expedition_rejected",
              profiles: ["chef", "qualite", "dg"],
              ferme: fermeCode || undefined, // undefined = no farm filter (all chefs as fallback)
              data: {
                receiptId: receiptId || expDocId || "—",
                dateTime,
                variety: report.variety || report.berryType || "—",
                ranch: ferme,
                weightKg: report.batchWeight ? String(Math.round(report.batchWeight)) : "0",
                reason: defects || (report.overallResult === "FAIL" ? "Qualité en dessous du seuil" : "Rejet"),
                message: `Expédition ${receiptId || expDocId} rejetée (${report.overallResult})`,
              },
              relatedDoc: `expeditions/${expDocId}`,
            }).catch(err => console.error("WhatsApp expedition rejected dispatch error:", err));
          } catch (err) {
            console.error("Failed to dispatch expedition rejected notification:", err);
          }
        }

        summary = `Rapport Qualité Driscoll's — ${report.berryType || "?"} ${report.variety || "?"} — Receipt ${receiptId || "?"} — ${report.overallResult || "?"}`;
        structuredData.driscolsReport = report;
        structuredData.expeditionId = expeditionId;

        console.log(`analyzeEmail: Created/updated expedition ${expDocId} from email ${emailId}`);
      } else if (emailData.isDailyQualityReport && emailData.xlsxBase64) {
        // ---- Driscoll's Daily Quality Report (XLSX) ----
        // Workflow: DQR arrives on J+1 and REPLACES all PFQ inspections for J.
        // 1. Delete all PFQ (source='email') and provisional (source='auto-created') expeditions for J
        // 2. Recreate expeditions from DQR rows as source of truth
        category = "daily_quality_report";

        const xlsxBuffer = Buffer.from(emailData.xlsxBase64, "base64");
        const brixRows = parseDailyQualityReportXlsx(xlsxBuffer);

        // Determine the date the DQR covers
        // Prefer receiptDate from XLSX (actual expedition date), fallback to email date - 1
        const dqrEmailDate = emailData.date ? new Date(emailData.date) : new Date();
        const dqrVeille = new Date(dqrEmailDate);
        dqrVeille.setDate(dqrVeille.getDate() - 1);
        const dqrVeilleISO = dqrVeille.toISOString().split('T')[0];

        // Parse receiptDate from XLSX (can be Excel serial number or string)
        const parseReceiptDateXlsx = (rd) => {
          if (!rd) return null;
          if (typeof rd === 'number') {
            // Excel serial date → JS Date (Excel epoch = 1899-12-30)
            const d = new Date((rd - 25569) * 86400000);
            return d.toISOString().split('T')[0];
          }
          const s = rd.toString().trim();
          // Try ISO format YYYY-MM-DD
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
          // Try MM/DD/YYYY
          const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
          // Try Date parse
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
          return null;
        };

        // Ranch name → ranch code mapping
        const ranchNameToCode = (name) => {
          if (!name) return null;
          const n = name.toLowerCase();
          if (n.includes('r-berry') || n.includes('r berry') || n.includes('200742')) return '200742'; // F1
          if (n.includes('sarl 3') || n.includes('berry good farms sarl') || n.includes('berry good farms') || n.includes('200876')) return '200876'; // F5
          console.log(`analyzeEmail DQR: Unknown ranch name "${name}" — could not map to F1/F5`);
          return null;
        };

        // ---- Step 1: Delete old DQR expeditions (keep PFQ intact) ----
        // Delete for both J-1 and J (receiptDate may differ from email date - 1)
        let deletedCount = 0;
        const dqrEmailDateISO = dqrEmailDate.toISOString().split('T')[0];
        const datesToClean = [...new Set([dqrVeilleISO, dqrEmailDateISO])];
        for (const cleanDate of datesToClean) {
          const oldDqrSnap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", cleanDate)
            .get();
          if (!oldDqrSnap.empty) {
            const delBatch = db.batch();
            oldDqrSnap.docs.forEach(doc => { delBatch.delete(doc.ref); deletedCount++; });
            await delBatch.commit();
          }
        }
        console.log(`analyzeEmail DQR: Deleted ${deletedCount} old DQR expeditions for ${dqrVeilleISO} (PFQ preserved)`);

        // ---- Step 2: Create fresh expeditions from DQR rows ----
        let createdCount = 0;
        const dqrCreated = [];
        const docIdCounter = {}; // Track duplicate docIds to avoid overwriting

        // Dédup Initial/Re-Inspection: si un batch a une Re-Inspection (verdict final
        // de Driscoll's), on ignore la ligne Initial pour éviter le doublonnage.
        const isReInspectionRow = (t) => /re[\s-]?inspection/i.test(t || '');
        const rowsByBatch = {};
        for (const row of brixRows) {
          if (!row.batchId) continue;
          const existing = rowsByBatch[row.batchId];
          if (!existing) {
            rowsByBatch[row.batchId] = row;
          } else if (isReInspectionRow(row.inspectionType) && !isReInspectionRow(existing.inspectionType)) {
            rowsByBatch[row.batchId] = row;
          }
        }
        const dedupedRows = Object.values(rowsByBatch);
        if (dedupedRows.length !== brixRows.length) {
          console.log(`analyzeEmail DQR: dedup ${brixRows.length} → ${dedupedRows.length} (removed Initial when Re-Inspection exists)`);
        }

        for (const row of dedupedRows) {
          // By-Pass inspections have null/Null result but valid inspectionType
          const isByPass = (row.inspectionType || '').toLowerCase().includes('by') && (row.inspectionType || '').toLowerCase().includes('pass');
          const effectiveResult = (row.inspectionResult && row.inspectionResult !== 'Null') ? row.inspectionResult : (isByPass ? 'PASS' : null);
          if (!effectiveResult) continue; // Skip sub-lots/samples without result

          const receiptId = row.receiptId || null;
          let baseDocId = receiptId
            ? `${receiptId}__${(row.batchId || '').replace(/[^a-zA-Z0-9-]/g, '-')}`
            : `DQR-${row.batchId}-${Date.now()}`;
          // If same batchId+receiptId appears multiple times (initial + re-inspection), add suffix
          docIdCounter[baseDocId] = (docIdCounter[baseDocId] || 0) + 1;
          const expDocId = docIdCounter[baseDocId] > 1 ? `${baseDocId}__${docIdCounter[baseDocId]}` : baseDocId;

          const ranch = ranchNameToCode(row.ranchName);

          const newExp = {
            receiptId: receiptId,
            batchNumber: row.batchId || null,
            berryType: row.berryType || null,
            berryTypeFr: mapBerryToFrench(row.berryType),
            variety: (row.variety || "").trim() || null,
            itemDescription: row.productName || null,
            batchWeight: row.weight || 0,
            batchQuantity: row.quantity || 0,
            totalFruitInspected: row.totalFruitInspected || 0,
            brix: row.brix || null,
            pfqBrix: row.brixPoints || 0,
            brixFromDQR: row.brix || 0,
            enrichedPqScore: row.enrichedPqScore || 0,
            initialPq: row.initialPq || 0,
            reInspectionPq: row.reInspectionPq || 0,
            pqScore: row.enrichedPqScore || row.brixPoints || 0,
            pfqTotal: row.brixPoints || 0,
            pfqCondition: 0,
            pfqApparence: 0,
            overallResult: effectiveResult,
            inspectionType: row.inspectionType || null,
            ranch: ranch,
            ranchName: row.ranchName || null,
            status: "DQR reçu",
            source: "dqr-auto-created",
            dateISO: parseReceiptDateXlsx(row.receiptDate) || dqrVeilleISO,
            date: parseReceiptDateXlsx(row.receiptDate) || dqrVeilleISO,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await db.collection("expeditions").doc(expDocId).set(newExp);
          dqrCreated.push({
            docId: expDocId,
            batchId: row.batchId,
            receiptId: receiptId,
            variety: row.variety,
            berryType: row.berryType,
            weight: row.weight,
          });
          createdCount++;
          console.log(`analyzeEmail DQR: Created expedition ${expDocId} from DQR (${row.variety}, ${row.weight}kg, ${row.inspectionResult})`);
        }

        summary = `Daily Quality Report ${dqrVeilleISO} — ${deletedCount} anciennes inspections supprimées, ${createdCount} expéditions créées depuis DQR`;
        structuredData.brixRows = brixRows;
        structuredData.deletedExpeditions = deletedCount;
        structuredData.createdExpeditions = createdCount;

        // Keep xlsxBase64 for DQR emails so reprocess-dqr can re-parse the XLSX
        // (previously deleted to save storage, but needed for accurate reprocessing)

        console.log(`analyzeEmail DQR: ${emailId} → ${dqrVeilleISO}: ${deletedCount} deleted, ${createdCount} created from ${brixRows.length} DQR rows`);

        // ---- VOLET 3: Vérification bons Export J-1 vs expéditions DQR ----
        try {
          // Fetch all bons d'apport Export for that date
          const bonsSnap = await db.collection("bons_apport")
            .where("date", "==", dqrVeilleISO)
            .get();

          const bonsExport = [];
          bonsSnap.forEach(doc => {
            const d = doc.data();
            if ((d.typeVente || '').toLowerCase() !== 'marché local' && (d.typeVente || '').toLowerCase() !== 'marche local') {
              bonsExport.push({ id: doc.id, ...d });
            }
          });

          if (bonsExport.length > 0) {
            // Get all expeditions for that date (now all from DQR)
            const expsSnap = await db.collection("expeditions")
              .where("dateISO", "==", dqrVeilleISO)
              .get();

            const existingExps = [];
            expsSnap.forEach(doc => existingExps.push({ id: doc.id, ...doc.data() }));

            const normV = (v) => (v || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            const matchedExpIds = new Set();
            const unmatchedBons = [];

            for (const bon of bonsExport) {
              const bonVar = normV(bon.blocVariete);
              const bonWeight = parseFloat(bon.poidsLot) || 0;
              let found = false;

              for (const exp of existingExps) {
                if (matchedExpIds.has(exp.id)) continue;
                const expVar = normV(exp.variety);
                const expWeight = parseFloat(exp.batchWeight) || 0;
                if (bonVar !== expVar) continue;
                if (bonWeight <= 0 || expWeight <= 0) continue;
                const ratio = Math.min(bonWeight, expWeight) / Math.max(bonWeight, expWeight);
                if (ratio >= 0.98) {
                  matchedExpIds.add(exp.id);
                  found = true;
                  break;
                }
              }

              if (!found) {
                unmatchedBons.push(bon);
              }
            }

            if (unmatchedBons.length > 0) {
              const bonsList = unmatchedBons.map(b => `${b.bonApport} (${b.blocVariete}, ${b.poidsLot}kg)`).join(', ');
              await db.collection("alerts").add({
                type: 'expedition_manquante',
                message: `${unmatchedBons.length} bon(s) Export du ${dqrVeilleISO} sans expédition DQR correspondante. Bons: ${bonsList}`,
                severity: 'warning',
                profiles: ['chef_f1', 'chef_f5', 'qualite'],
                read: {},
                createdAt: new Date().toISOString(),
                date: dqrVeilleISO,
                unmatchedBons: unmatchedBons.map(b => ({ id: b.id, bonApport: b.bonApport, variete: b.blocVariete, poids: b.poidsLot })),
              });
              console.log(`analyzeEmail DQR: ${unmatchedBons.length} unmatched bons for ${dqrVeilleISO}`);
            } else {
              console.log(`analyzeEmail DQR: All ${bonsExport.length} bons Export for ${dqrVeilleISO} matched to DQR expeditions`);
            }
          }
        } catch (verifErr) {
          console.error('analyzeEmail DQR verification error:', verifErr);
        }

      } else if (emailData.isLiquidation && emailData.xlsxBase64) {
        // ---- Driscoll's Liquidation Report (XLSX) ----
        category = "liquidation";

        const xlsxBuffer = Buffer.from(emailData.xlsxBase64, "base64");
        const liquidation = parseLiquidationXlsx(xlsxBuffer);
        const now = new Date().toISOString();

        // Build list of liquidation sheets to process
        const sheetsToProcess = liquidation._multiSheets || [liquidation];

        // Detect fruit type from subject: RASP = Framboise, BLUE = Myrtille
        const subjectUpper = (emailData.subject || "").toUpperCase();
        let fruitType = "framboise"; // default
        let fruitCode = "RASP";
        if (/BLUE|MYRTILLE|BLUEBERR/i.test(subjectUpper)) {
          fruitType = "myrtille";
          fruitCode = "BLUE";
        } else if (/RASP|FRAMBOISE|RASPBERRY/i.test(subjectUpper)) {
          fruitType = "framboise";
          fruitCode = "RASP";
        }

        // Parse the LIQUIDATION summary PDF (contains Fruit Advance / Crop Advance / Net Payable / etc.)
        // The mail body is just a French cover note, no financial data — all totals live in the PDF.
        let pdfSummary = null;
        if (emailData.liqSummaryPdfBase64) {
          try {
            const pdfBuffer = Buffer.from(emailData.liqSummaryPdfBase64, "base64");
            pdfSummary = await parseLiquidationSummaryPdf(pdfBuffer);
            if (pdfSummary) {
              console.log(`analyzeEmail Liquidation: parsed PDF summary — apiv=${pdfSummary.liquidationNumber} net=${pdfSummary.summary?.netPayable}`);
            }
          } catch (e) {
            console.warn(`analyzeEmail Liquidation: PDF parse failed — ${e.message}`);
          }
        }

        // Parse the Grower Settlement Statement PDF (commission breakdown in EUR/kilo)
        let gssData = null;
        if (emailData.gssPdfBase64) {
          try {
            const gssBuffer = Buffer.from(emailData.gssPdfBase64, "base64");
            gssData = await parseSettlementStatementPdf(gssBuffer);
            if (gssData) {
              console.log(`analyzeEmail Liquidation: GSS parsed — commission=${gssData.commissionPct}%`);
            }
          } catch (e) {
            console.warn(`analyzeEmail Liquidation: GSS parse failed — ${e.message}`);
          }
        }

        let totalUpdatedCount = 0;
        let totalRows = 0;
        const processedWeeks = [];

        for (const liq of sheetsToProcess) {
          // Try to extract week from subject/text if not from XLS
          if (!liq.week) {
            const subjectWeek = (emailData.subject || "").match(/week\s*(\d+)/i);
            if (subjectWeek) liq.week = parseInt(subjectWeek[1]);
          }
          if (!liq.week) {
            const textWeek = ((emailData.textBody || "") + " " + (emailData.htmlBody || "")).match(/semaine\s*(\d+)/i);
            if (textWeek) liq.week = parseInt(textWeek[1]);
          }
          // Merge PDF summary (the authoritative source for financial fields)
          if (pdfSummary) {
            if (!liq.liquidationNumber && pdfSummary.liquidationNumber) liq.liquidationNumber = pdfSummary.liquidationNumber;
            if (!liq.period && pdfSummary.period) liq.period = pdfSummary.period;
            Object.assign(liq.summary, pdfSummary.summary || {});
          }

          // Stable docId: LIQ-{RASP|BLUE}-W{NN}-{YYYY} — upserts cleanly on re-runs.
          // The APIV number lives in the doc body (liquidationNumber field).
          const subjYearMatch = (emailData.subject || "").match(/week\s*\d+[-\/](\d{4})/i);
          const liqYear = subjYearMatch
            ? parseInt(subjYearMatch[1])
            : (emailData.date ? new Date(emailData.date).getFullYear() : new Date().getFullYear());
          const liqDocId = `LIQ-${fruitCode}-W${String(liq.week || 0).padStart(2, "0")}-${liqYear}`;
          const liqDoc = {
            emailId,
            liquidationNumber: liq.liquidationNumber,
            week: liq.week,
            period: liq.period,
            fruit: fruitType,
            fruitCode: fruitCode,
            subject: emailData.subject,
            date: emailData.date,
            rows: liq.rows,
            summary: liq.summary,
            totalKg: liq.summary.totalKg || 0,
            base: liq.summary.base || 0,
            fruitAdvance: liq.summary.fruitAdvance || 0,
            dedRasp: liq.summary.dedRasp || 0,
            dedPlants: liq.summary.dedPlants || 0,
            cropAdvance: liq.summary.cropAdvance || 0,
            dexAdjustment: liq.summary.dexAdjustment || 0,
            pkgDeduction: liq.summary.pkgDeduction || 0,
            netPayable: liq.summary.netPayable || 0,
            nbLots: liq.rows.length,
            commissionPct: gssData?.commissionPct ?? null,
            netSalesEurKg: gssData?.netSalesEurKg ?? null,
            commissionEurKg: gssData?.commissionEurKg ?? null,
            rebateEurKg: gssData?.rebateEurKg ?? null,
            returnToGrowerEurKg: gssData?.returnToGrowerEurKg ?? null,
            createdAt: now,
            updatedAt: now,
          };

          await db.collection("liquidations").doc(liqDocId).set(liqDoc, { merge: true });

          // Update matching expeditions with liquidation data
          let updatedCount = 0;
          for (const row of liq.rows) {
            if (!row.receiptId) continue;

            const updateData = {
              status: "Liquidée",
              liquidationNumber: liq.liquidationNumber,
              liquidationWeek: liq.week,
              ppFruit: row.ppFruit,
              gsNet: row.gsNet,
              pricePerKg: row.receiptQtyKg > 0 ? Math.round((row.gsNet / row.receiptQtyKg) * 100) / 100 : null,
              updatedAt: now,
            };

            const expDoc = await db.collection("expeditions").doc(row.receiptId).get();
            if (expDoc.exists) {
              await expDoc.ref.update(updateData);
              updatedCount++;
            } else {
              const expQuery = await db.collection("expeditions")
                .where("receiptId", "==", row.receiptId)
                .limit(1).get();
              if (!expQuery.empty) {
                await expQuery.docs[0].ref.update(updateData);
                updatedCount++;
              }
            }
          }

          totalUpdatedCount += updatedCount;
          totalRows += liq.rows.length;
          processedWeeks.push(liq.week);
          console.log(`analyzeEmail Liquidation W${liq.week}: ${liq.rows.length} rows, ${updatedCount} expeditions updated`);
        }

        summary = `Liquidation ${processedWeeks.map(w => `W${w}`).join(", ")} — ${totalRows} lots total, ${totalUpdatedCount} expéditions mises à jour`;
        structuredData.liquidation = liquidation;
        structuredData.updatedExpeditions = totalUpdatedCount;
        structuredData.processedWeeks = processedWeeks;

        // Clean up XLSX + PDF blobs from email doc
        await emailRef.update({
          xlsxBase64: admin.firestore.FieldValue.delete(),
          liqSummaryPdfBase64: admin.firestore.FieldValue.delete(),
          gssPdfBase64: admin.firestore.FieldValue.delete(),
        });

        console.log(`analyzeEmail Liquidation: ${emailId} → ${sheetsToProcess.length} sheets, ${totalRows} rows, ${totalUpdatedCount} expeditions updated`);
      } else if (emailData.isWeeklyQualityReport && emailData.pdfBase64) {
        // ---- Weekly Quality Report (PDF) ----
        category = "weekly_quality_report";

        const pdfBuffer = Buffer.from(emailData.pdfBase64, "base64");
        const report = await parseWeeklyQualityReportPdf(pdfBuffer);

        const now = new Date().toISOString();
        const berry = report.berry || "framboise";
        const docId = `WQR-${berry.toUpperCase().slice(0, 4)}-W${report.week || "?"}-${report.year || "?"}`;

        await db.collection("weekly_quality_reports").doc(docId).set({
          emailId,
          week: report.week,
          year: report.year,
          berry: report.berry,
          pwResults: report.pwResults,
          brixSummary: report.brixSummary,
          ourRanches: report.ourRanches,
          allRanchCount: report.allRanchCount,
          totalVolume: report.totalVolume,
          subject: emailData.subject,
          createdAt: now,
          updatedAt: now,
        });

        summary = `Weekly Quality Report — W${report.week}/${report.year} — ${report.berry} — Ranches: ${report.ourRanches.map(r => `${r.farmName} (PQ: ${r.pqWeightedAvg || '?'}, Rank: ${r.rank}/${r.totalRanches})`).join(', ')}`;
        structuredData.weeklyQualityReport = report;

        // Clean up PDF from email doc
        await emailRef.update({ pdfBase64: admin.firestore.FieldValue.delete() });

        console.log(`analyzeEmail WeeklyQR: ${emailId} → W${report.week}/${report.year}, ${report.berry}, ${report.ourRanches.length} farms`);
      } else if (emailData.isAgqAnalysis && Array.isArray(emailData.agqPdfAttachments) && emailData.agqPdfAttachments.length > 0) {
        // ---- AGQ Labs analytical reports (foliar / soil / water) ----
        category = "agq_analysis";
        const { parseAgqPdf } = require("./agqParser");
        const bucket = admin.storage().bucket("berrygood-farms-photos");

        const createdAnalyses = [];
        const skipped = [];
        const errors = [];
        const receivedAt = emailData.date ? new Date(emailData.date).getTime() : Date.now();

        for (const att of emailData.agqPdfAttachments) {
          try {
            // Idempotence by (messageId, attachment_name)
            const dupSnap = await db.collection("analyses_foliaires")
              .where("source_email.messageId", "==", emailData.messageId || "")
              .where("source_email.attachment_name", "==", att.filename || "")
              .limit(1)
              .get();
            if (!dupSnap.empty) {
              skipped.push({ filename: att.filename, id: dupSnap.docs[0].id });
              continue;
            }

            const pdfBuffer = Buffer.from(att.contentBase64, "base64");
            const parsed = await parseAgqPdf(pdfBuffer, {
              subject: emailData.subject || "",
              attachmentName: att.filename || "",
            });

            if (!parsed.ferme) {
              errors.push({ filename: att.filename, error: "Ferme non détectée" });
              continue;
            }

            const now = Date.now();
            const analyseData = {
              numero: null, // AGQ imports are not numbered; the PDF is the source of truth.
              ferme: parsed.ferme,
              parcelle: null,
              culture: parsed.culture,
              type_analyse: parsed.type_analyse,
              variete: parsed.variete,
              propriete_raw: parsed.propriete_raw,
              terrain_raw: parsed.terrain_raw,
              client_raw: parsed.client_raw,
              phenologie: parsed.phenologie,
              parsed_values: parsed.parsed_values || {},
              parsed_header_line: parsed.parsed_header_line || null,
              source: "email_agq",
              source_email: {
                messageId: emailData.messageId || null,
                subject: emailData.subject || null,
                from: emailData.from || null,
                received_at: receivedAt,
                attachment_name: att.filename || null,
              },
              statut: "completee",
              date_demande: receivedAt,
              date_prelevement: parsed.date_analyse || receivedAt,
              date_resultat: receivedAt,
              date_analyse: parsed.date_analyse || null,
              bdc_id: null,
              photo_parcelle_url: null,
              scan_resultat_url: null,
              note_demande: "",
              recommandations_ia: [],
              history: [{ action: "import_email_agq", by: { name: "auto" }, at: now, comment: att.filename || "" }],
              created_by: { name: "auto" },
              created_at: now,
              updated_at: now,
            };
            const ref = await db.collection("analyses_foliaires").add(analyseData);

            // Upload the PDF to Storage and wire the URL back.
            const safeName = (att.filename || "agq_report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
            const storagePath = `analyses_foliaires/${ref.id}/${safeName}`;
            const file = bucket.file(storagePath);
            await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
            const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
            await ref.update({ scan_resultat_url: url });

            createdAnalyses.push({ id: ref.id, ferme: parsed.ferme, variete: parsed.variete, type_analyse: parsed.type_analyse, filename: att.filename });
          } catch (e) {
            console.error(`analyzeEmail AGQ ${att.filename}:`, e.message);
            errors.push({ filename: att.filename, error: e.message });
          }
        }

        summary = `AGQ — ${createdAnalyses.length} analyse(s) importée(s), ${skipped.length} doublon(s), ${errors.length} erreur(s)`;
        structuredData.agq = { created: createdAnalyses, skipped, errors };

        // Strip the heavy base64 payloads once processed to keep the email doc slim.
        await emailRef.update({ agqPdfAttachments: admin.firestore.FieldValue.delete() });

        // Fire notifications (alerts + emails) for the chef of each concerned ferme + DT.
        if (createdAnalyses.length > 0) {
          try {
            await notifyNewAgqAnalyses(createdAnalyses);
          } catch (e) {
            console.error("notifyNewAgqAnalyses failed:", e.message);
          }
        }

        console.log(`analyzeEmail AGQ: ${emailId} → ${createdAnalyses.length} created, ${skipped.length} skipped, ${errors.length} errors`);
      } else {
        // ---- Generic email analysis ----
        const textContent = emailData.textBody || "";
        const amountMatches = textContent.match(/[\d\s,.]+\s*(MAD|DH|EUR|USD|€|\$)/gi) || [];
        if (amountMatches.length > 0) {
          structuredData.amounts = amountMatches.map((m) => m.trim());
        }
        const dateMatches = textContent.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g) || [];
        if (dateMatches.length > 0) {
          structuredData.dates = dateMatches;
        }

        const subjectLower = (emailData.subject || "").toLowerCase();
        const bodyLower = textContent.toLowerCase();
        const combinedText = subjectLower + " " + bodyLower;

        if (/commande|order|bon de commande|purchase/i.test(combinedText)) {
          category = "order";
        } else if (/facture|invoice|facturation/i.test(combinedText)) {
          category = "invoice";
        } else if (/rapport|report|estimation|quinzaine|bilan/i.test(combinedText)) {
          category = "report";
        } else if (/alerte|alert|notification|warning/i.test(combinedText)) {
          category = "notification";
        }

        const firstLines = textContent.split("\n").slice(0, 3).join(" ").slice(0, 200);
        summary = emailData.subject || firstLines || "Email sans contenu identifiable";
      }

      // 3. Write extraction result
      const extraction = {
        emailId,
        analyzedAt: new Date().toISOString(),
        category,
        summary,
        structuredData: {
          ...structuredData,
          tables: tables.map((t, i) => ({
            tableIndex: i,
            headers: t.headers,
            rowCount: t.rows.length,
            rows: t.rows.slice(0, 100).map(row => row.join(" | ")),
          })),
        },
        confidence: isDriscols ? "high" : (tables.length > 0 ? "medium" : "low"),
        expeditionId: expeditionId || null,
      };

      await db.collection("email_extractions").doc(emailId).set(extraction);
      await emailRef.update({ status: "analyzed" });

      console.log(`analyzeEmail: ${emailId} → category=${category}, tables=${tables.length}`);
    } catch (err) {
      console.error(`analyzeEmail error for ${emailId}:`, err.message);
      await emailRef.update({
        status: "error",
        analysisError: err.message,
      });
    }

    return null;
  });

// =============================================
// Function 3: emailAnalysis (HTTP API for dashboard)
// =============================================
exports.emailAnalysis = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const action = req.query.action || req.body?.action || "list";

    try {
      // --- STATUS ---
      if (action === "status") {
        const configSnap = await db.collection("email_config").doc("settings").get();
        const config = configSnap.exists ? configSnap.data() : {};
        return res.json({
          success: true,
          status: {
            lastPollTimestamp: config.lastPollTimestamp || null,
            lastPollUid: config.lastPollUid || 0,
            totalEmailsFetched: config.totalEmailsFetched || 0,
            lastError: config.lastError || null,
            lastErrorTimestamp: config.lastErrorTimestamp || null,
          },
        });
      }

      // --- LIST ---
      if (action === "list") {
        const limit = parseInt(req.query.limit || "50");
        const statusFilter = req.query.status || null;

        let query = db.collection("emails").orderBy("receivedAt", "desc").limit(limit);
        if (statusFilter) {
          query = query.where("status", "==", statusFilter);
        }

        const snap = await query.get();
        const emails = snap.docs.map((doc) => ({
          id: doc.id,
          from: doc.data().from,
          fromName: doc.data().fromName,
          subject: doc.data().subject,
          date: doc.data().date,
          receivedAt: doc.data().receivedAt,
          status: doc.data().status,
          hasAttachments: doc.data().hasAttachments,
          category: null, // will be enriched below
        }));

        // Enrich with extraction category
        const emailIds = emails.map((e) => e.id);
        if (emailIds.length > 0) {
          // Firestore 'in' query limited to 30 items
          const chunks = [];
          for (let i = 0; i < emailIds.length; i += 30) {
            chunks.push(emailIds.slice(i, i + 30));
          }
          for (const chunk of chunks) {
            const extSnap = await db
              .collection("email_extractions")
              .where(admin.firestore.FieldPath.documentId(), "in", chunk)
              .get();
            extSnap.docs.forEach((doc) => {
              const email = emails.find((e) => e.id === doc.id);
              if (email) email.category = doc.data().category;
            });
          }
        }

        return res.json({ success: true, count: emails.length, emails });
      }

      // --- DETAIL ---
      if (action === "detail") {
        const emailId = req.query.emailId;
        if (!emailId) return res.status(400).json({ success: false, error: "emailId required" });

        const [emailSnap, extractionSnap] = await Promise.all([
          db.collection("emails").doc(emailId).get(),
          db.collection("email_extractions").doc(emailId).get(),
        ]);

        if (!emailSnap.exists) {
          return res.status(404).json({ success: false, error: "Email not found" });
        }

        return res.json({
          success: true,
          email: { id: emailSnap.id, ...emailSnap.data() },
          extraction: extractionSnap.exists ? extractionSnap.data() : null,
        });
      }

      // --- FETCH (manual trigger) ---
      if (action === "fetch" && req.method === "POST") {
        // Trigger a manual fetch by calling the same logic as fetchEmails
        // For simplicity, we return a message — the actual fetch runs via the scheduled function
        // or can be triggered manually via the Firebase console
        return res.json({
          success: true,
          message: "Pour déclencher un fetch manuel, utilisez: firebase functions:shell > fetchEmails()",
        });
      }

      // --- CLEANUP-BROKEN-EXPEDITIONS: Remove expedition docs with no receiptId (created from DQR emails by mistake) ---
      if (action === "cleanup-broken-expeditions" && req.method === "POST") {
        const snap = await db.collection("expeditions").get();
        let deleted = 0;
        const details = [];
        for (const doc of snap.docs) {
          const data = doc.data();
          if (!data.receiptId && doc.id.startsWith("EXP-")) {
            await doc.ref.delete();
            deleted++;
            details.push({ id: doc.id, date: data.date, emailId: data.emailId });
          }
        }
        return res.json({ success: true, deleted, details: details.slice(0, 20) });
      }

      // --- REANALYZE-QUALITY: Re-process Driscoll's quality emails that weren't parsed as expeditions ---
      if (action === "reanalyze-quality" && req.method === "POST") {
        // Find emails with isDriscolsReport=true that don't have a corresponding expedition
        const snap = await db.collection("emails").where("isDriscolsReport", "==", true).get();
        let reprocessed = 0;
        let alreadyHaveExp = 0;
        let total = snap.size;
        const details = [];

        for (const doc of snap.docs) {
          const data = doc.data();
          // Check if an expedition already exists for this email
          const expByEmail = await db.collection("expeditions").where("emailId", "==", doc.id).limit(1).get();
          if (!expByEmail.empty) {
            alreadyHaveExp++;
            continue;
          }
          // Also check by receiptId extracted from content
          const receiptMatch = ((data.textBody || "") + " " + (data.htmlBody || "")).match(/Receipt\s+(RID[\-‑]?\d+)/i);
          if (receiptMatch) {
            const rid = receiptMatch[1];
            const expByRid = await db.collection("expeditions").doc(rid).get();
            if (expByRid.exists) {
              alreadyHaveExp++;
              continue;
            }
          }
          // Re-trigger by deleting and re-creating with status=pending
          const newData = { ...data, status: "pending", analysisError: null };
          await doc.ref.delete();
          await db.collection("emails").doc(doc.id).set(newData);
          reprocessed++;
          details.push({ id: doc.id, subject: data.subject, from: data.from });
        }

        return res.json({ success: true, total, alreadyHaveExp, reprocessed, details: details.slice(0, 30) });
      }

      // --- REANALYZE (reset emails to pending, delete old expeditions, re-trigger) ---
      if (action === "reanalyze" && req.method === "POST") {
        const statusFilter = req.query.status || "error";
        const forceAll = req.query.force === "true";
        const query = forceAll
          ? db.collection("emails")
          : db.collection("emails").where("status", "==", statusFilter);
        const snap = await query.get();

        let count = 0;
        for (const doc of snap.docs) {
          const data = doc.data();
          data.status = "pending";
          data.analysisError = null;
          data.extractedTablesRaw = [];
          await doc.ref.delete();
          await db.collection("emails").doc(doc.id).set(data);
          count++;
        }
        return res.json({ success: true, reanalyzed: count });
      }

      // --- EXPEDITIONS LIST ---
      if (action === "expeditions") {
        const limit = parseInt(req.query.limit || "2000");
        let query = db.collection("expeditions").limit(limit);

        const varietyFilter = req.query.variety || null;
        if (varietyFilter) {
          query = query.where("variety", "==", varietyFilter);
        }
        const resultFilter = req.query.result || null;
        if (resultFilter) {
          query = query.where("overallResult", "==", resultFilter.toUpperCase());
        }

        const snap = await query.get();
        const expeditions = [];
        const ghostIds = [];
        snap.docs.forEach((doc) => {
          const data = doc.data();
          // Filter out ghost PFQ expeditions (source=email but no receiptId/variety)
          if (data.source === "email" && !data.receiptId && !data.variety) {
            ghostIds.push(doc.id);
            return;
          }
          expeditions.push({ id: doc.id, ...data });
        });

        // Auto-cleanup ghost expeditions in background
        if (ghostIds.length > 0) {
          const cleanBatch = db.batch();
          ghostIds.forEach(id => cleanBatch.delete(db.collection("expeditions").doc(id)));
          cleanBatch.commit().catch(err => console.warn("Ghost cleanup failed:", err.message));
          console.log(`expeditions: Auto-cleaned ${ghostIds.length} ghost PFQ expeditions`);
        }

        return res.json({ success: true, count: expeditions.length, expeditions });
      }

      // --- EXPEDITION DETAIL ---
      if (action === "expedition-detail") {
        const expId = req.query.expeditionId;
        if (!expId) return res.status(400).json({ success: false, error: "expeditionId required" });

        const expSnap = await db.collection("expeditions").doc(expId).get();
        if (!expSnap.exists) {
          return res.status(404).json({ success: false, error: "Expedition not found" });
        }

        return res.json({
          success: true,
          expedition: { id: expSnap.id, ...expSnap.data() },
        });
      }

      // --- UPDATE-EXPEDITION: Update expedition fields (photo, duplicate, cancel) ---
      // --- FIX-EXPEDITION-STATUS: Restore correct status for expeditions with liquidation data ---
      if (action === "fix-expedition-status") {
        const expsSnap = await db.collection("expeditions").get();
        let fixed = 0;
        const fixes = [];
        for (const doc of expsSnap.docs) {
          const data = doc.data();
          const hasLiq = data.liquidationWeek || data.pricePerKg || data.gsNet;
          const hasBrix = data.pfqBrix !== undefined && data.pfqBrix !== null;
          const isReject = (data.overallResult || "").toUpperCase() === "REJECT";
          const status = data.status || "";

          let correctStatus = null;
          if (isReject) {
            correctStatus = "Rejeté";
          } else if (hasLiq) {
            correctStatus = "Liquidée";
          } else if (hasBrix) {
            correctStatus = "PFQ Brix reçu";
          }

          if (correctStatus && status !== correctStatus) {
            await doc.ref.update({ status: correctStatus, updatedAt: new Date().toISOString() });
            fixes.push({ id: doc.id, from: status, to: correctStatus });
            fixed++;
          }
        }
        return res.json({ success: true, message: `${fixed} expedition(s) status fixed`, fixed, fixes: fixes.slice(0, 30) });
      }

      if (action === "update-expedition" && req.method === "POST") {
        const { expeditionId, updates } = req.body;
        if (!expeditionId) return res.status(400).json({ success: false, error: "expeditionId required" });

        const expRef = db.collection("expeditions").doc(expeditionId);
        const expSnap = await expRef.get();
        if (!expSnap.exists) return res.status(404).json({ success: false, error: "Expedition not found" });

        const allowedFields = [
          "duplicateFlag", "duplicateRequestedBy", "duplicateRequestedAt", "duplicateReason",
          "duplicateValidatedBy", "duplicateValidatedAt", "duplicateCancelled",
          "bonApportPhotos", "bonApportNote",
          "status", "updatedAt",
        ];
        const safeUpdates = {};
        for (const key of Object.keys(updates || {})) {
          if (allowedFields.includes(key)) safeUpdates[key] = updates[key];
        }
        safeUpdates.updatedAt = new Date().toISOString();
        await expRef.update(safeUpdates);

        return res.json({ success: true, updated: Object.keys(safeUpdates) });
      }

      // --- UPLOAD-EXPEDITION-PHOTO: Upload bon d'apport photo ---
      if (action === "upload-expedition-photo" && req.method === "POST") {
        const { expeditionId, image, filename } = req.body;
        if (!expeditionId) return res.status(400).json({ success: false, error: "expeditionId required" });
        if (!image) return res.status(400).json({ success: false, error: "image (base64) required" });

        const expRef = db.collection("expeditions").doc(expeditionId);
        const expSnap = await expRef.get();
        if (!expSnap.exists) return res.status(404).json({ success: false, error: "Expedition not found" });

        const admin = require("firebase-admin");
        const bucket = admin.storage().bucket("berrygood-farms-photos");
        const buffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64");
        const ext = (filename || "photo.jpg").split(".").pop() || "jpg";
        const storagePath = `expeditions/${expeditionId}/${Date.now()}.${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType: `image/${ext}` } });
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // Append to bonApportPhotos array
        const existingPhotos = (expSnap.data().bonApportPhotos) || [];
        existingPhotos.push({ url: publicUrl, path: storagePath, uploadedAt: new Date().toISOString(), filename: filename || "photo.jpg" });
        await expRef.update({ bonApportPhotos: existingPhotos, updatedAt: new Date().toISOString() });

        return res.json({ success: true, url: publicUrl, photosCount: existingPhotos.length });
      }

      // --- CREATE-MANUAL-EXPEDITION: Import expedition from liquidation data ---
      if (action === "create-manual-expedition" && req.method === "POST") {
        const { receiptId, variety, kg, week, year, fruit, source: manualSource } = req.body;
        if (!receiptId) return res.status(400).json({ success: false, error: "receiptId required" });

        // Check for existing expedition with same receipt ID
        const existing = await db.collection("expeditions").where("receiptId", "==", receiptId).limit(1).get();
        if (!existing.empty) {
          return res.status(409).json({ success: false, error: "Expedition with this receiptId already exists", existingId: existing.docs[0].id });
        }

        const docId = `MANUAL-${receiptId}`;
        await db.collection("expeditions").doc(docId).set({
          receiptId,
          variety: variety || "Inconnue",
          batchWeight: parseFloat(kg) || 0,
          berryType: (fruit || "framboise").toUpperCase() === "MYRTILLE" ? "BLUEBERRY" : "RASPBERRY",
          berryTypeFr: (fruit || "framboise").toLowerCase() === "myrtille" ? "Myrtille" : "Framboise",
          date: new Date().toISOString(),
          overallResult: "PASS",
          status: "Saisie manuelle",
          source: manualSource || "manual",
          manualImport: true,
          liquidationWeek: parseInt(week) || null,
          liquidationYear: parseInt(year) || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        return res.json({ success: true, id: docId, receiptId });
      }

      // --- AUDIT DQR: Compare XLSX source vs expeditions ---
      if (action === "audit-dqr") {
        const limitEmails = parseInt(req.query.limit || "10");
        const emailsSnap = await db.collection("emails")
          .where("isDailyQualityReport", "==", true)
          .limit(limitEmails)
          .get();

        const ranchNameToCodeLocal = (name) => {
          if (!name) return null;
          const n = name.toLowerCase();
          if (n.includes('r-berry') || n.includes('r berry') || n.includes('200742')) return '200742';
          if (n.includes('sarl 3') || n.includes('berry good farms sarl') || n.includes('berry good farms') || n.includes('200876')) return '200876';
          return null;
        };

        const results = [];
        for (const emailDoc of emailsSnap.docs) {
          const email = emailDoc.data();
          const emailId = emailDoc.id;
          const report = { emailId, subject: email.subject || '', date: email.date || '', hasXlsx: !!email.xlsxBase64, issues: [], xlsxRowCount: 0, validRowCount: 0, expeditionCount: 0, matched: 0, fieldMismatches: [] };

          if (!email.xlsxBase64) {
            report.issues.push('NO_XLSX_DATA');
            results.push(report);
            continue;
          }

          // Re-parse XLSX
          const xlsxBuffer = Buffer.from(email.xlsxBase64, "base64");
          let brixRows;
          try {
            brixRows = parseDailyQualityReportXlsx(xlsxBuffer);
          } catch (e) {
            report.issues.push('XLSX_PARSE_ERROR: ' + e.message);
            results.push(report);
            continue;
          }
          report.xlsxRowCount = brixRows.length;

          // Also report actual XLSX headers (only for first email)
          if (results.length === 0) {
            try {
              const workbook = XLSX.read(xlsxBuffer, { type: "buffer" });
              const sn = workbook.SheetNames.find(n => /inspection/i.test(n)) || workbook.SheetNames[0];
              const sh = workbook.Sheets[sn];
              const rawRows = XLSX.utils.sheet_to_json(sh, { defval: "" });
              if (rawRows.length > 0) report.xlsxHeaders = Object.keys(rawRows[0]);
              report.sheetName = sn;
              report.sheetNames = workbook.SheetNames;
            } catch (e) { /* ignore */ }
          }

          // Filter valid rows
          const validRows = brixRows.filter(r => {
            const isByPass = (r.inspectionType || '').toLowerCase().includes('by') && (r.inspectionType || '').toLowerCase().includes('pass');
            const eff = (r.inspectionResult && r.inspectionResult !== 'Null') ? r.inspectionResult : (isByPass ? 'PASS' : null);
            return !!eff;
          });
          report.validRowCount = validRows.length;
          report.skippedRows = brixRows.length - validRows.length;

          // Date J-1
          const dqrEmailDate = email.date ? new Date(email.date) : new Date();
          const dqrVeille = new Date(dqrEmailDate);
          dqrVeille.setDate(dqrVeille.getDate() - 1);
          const dqrVeilleISO = dqrVeille.toISOString().split('T')[0];
          report.expectedDateISO = dqrVeilleISO;

          // Receipt dates from XLSX
          report.xlsxReceiptDates = [...new Set(brixRows.map(r => r.receiptDate).filter(Boolean))];

          // Fetch expeditions
          const expSnap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", dqrVeilleISO)
            .get();
          const expeditions = [];
          expSnap.forEach(doc => expeditions.push({ id: doc.id, ...doc.data() }));
          report.expeditionCount = expeditions.length;

          if (validRows.length !== expeditions.length) {
            report.issues.push(`COUNT_MISMATCH: ${validRows.length} xlsx vs ${expeditions.length} expeditions`);
          }

          // Match by batchId — use array to handle duplicates (initial + re-inspection)
          const expByBatch = {};
          for (const exp of expeditions) {
            const k = exp.batchNumber || exp.batchId;
            if (k) {
              if (!expByBatch[k]) expByBatch[k] = [];
              expByBatch[k].push(exp);
            }
          }
          // Track which expedition has been consumed per batchId
          const consumedExp = new Set();

          let matched = 0;
          const unmatchedXlsx = [];
          for (const row of validRows) {
            const candidates = expByBatch[row.batchId] || [];
            // Pick the candidate with matching overallResult, else first unconsumed
            let exp = candidates.find(e => !consumedExp.has(e.id) && e.overallResult === row.inspectionResult);
            if (!exp) exp = candidates.find(e => !consumedExp.has(e.id));
            if (!exp) { unmatchedXlsx.push(row.batchId); continue; }
            consumedExp.add(exp.id);
            matched++;

            const checks = [
              { field: 'variety', xlsx: (row.variety || '').trim(), fs: (exp.variety || '').trim() },
              { field: 'batchWeight', xlsx: row.weight, fs: parseFloat(exp.batchWeight) || 0 },
              { field: 'batchQuantity', xlsx: row.quantity, fs: parseFloat(exp.batchQuantity) || 0 },
              { field: 'brix', xlsx: row.brix, fs: parseFloat(exp.brixFromDQR || exp.brix) || 0 },
              { field: 'overallResult', xlsx: row.inspectionResult, fs: exp.overallResult },
              { field: 'enrichedPqScore', xlsx: row.enrichedPqScore, fs: parseFloat(exp.enrichedPqScore) || 0 },
              { field: 'receiptId', xlsx: (row.receiptId || '').trim(), fs: (exp.receiptId || '').trim() },
            ];
            for (const chk of checks) {
              const xv = typeof chk.xlsx === 'number' ? chk.xlsx : (chk.xlsx || '');
              const fv = typeof chk.fs === 'number' ? chk.fs : (chk.fs || '');
              if (String(xv) !== String(fv)) {
                report.fieldMismatches.push({ batchId: row.batchId, field: chk.field, xlsx: xv, firestore: fv });
              }
            }

            // Ranch check
            const expectedRanch = ranchNameToCodeLocal(row.ranchName);
            if (row.ranchName && !expectedRanch) {
              report.issues.push(`UNMAPPED_RANCH: "${row.ranchName}" for batch ${row.batchId}`);
            }
          }
          report.matched = matched;
          // For unmatched XLSX batches, check if they exist at OTHER dates (cross-date lookup)
          // This handles bulk catch-up emails where receiptDate ≠ J-1
          const trulyMissing = [];
          const foundElsewhere = [];
          for (const batchId of unmatchedXlsx) {
            const otherSnap = await db.collection("expeditions")
              .where("source", "==", "dqr-auto-created")
              .where("batchNumber", "==", batchId)
              .get();
            if (otherSnap.empty) {
              trulyMissing.push(batchId);
            } else {
              const dates = otherSnap.docs.map(d => d.data().dateISO);
              foundElsewhere.push({ batchId, foundAt: dates });
            }
          }
          if (trulyMissing.length > 0) report.unmatchedXlsxBatches = trulyMissing;
          if (foundElsewhere.length > 0) report.batchesAtOtherDates = foundElsewhere;

          // Show existing expedition docIds for comparison
          report.existingExpDocIds = expeditions.map(e => ({ docId: e.id, batchNumber: e.batchNumber, receiptId: e.receiptId }));

          // Unmatched expeditions = those not consumed by any XLSX row
          const unmatchedExp = expeditions.filter(e => !consumedExp.has(e.id)).map(e => ({ docId: e.id, batchNumber: e.batchNumber, receiptId: e.receiptId, overallResult: e.overallResult }));
          if (unmatchedExp.length > 0) report.unmatchedExpBatches = unmatchedExp;

          // Summary by ranch
          const byRanch = {};
          for (const row of validRows) {
            const ranch = ranchNameToCodeLocal(row.ranchName) || 'unknown';
            const ferme = ranch === '200742' ? 'F1' : ranch === '200876' ? 'F5' : ranch;
            if (!byRanch[ferme]) byRanch[ferme] = { count: 0, kg: 0, pass: 0, fail: 0 };
            byRanch[ferme].count++;
            byRanch[ferme].kg += row.weight;
            if ((row.inspectionResult || '').toLowerCase() === 'pass') byRanch[ferme].pass++;
            else byRanch[ferme].fail++;
          }
          report.summaryByFerme = byRanch;

          results.push(report);
        }

        return res.json({ success: true, emailsAudited: results.length, results });
      }

      // --- LIQUIDATIONS: List all liquidations ---
      // --- WEEKLY-QUALITY-REPORTS: List weekly quality reports ---
      if (action === "weekly-quality-reports") {
        const limit = parseInt(req.query.limit || "50");
        const snap = await db.collection("weekly_quality_reports").orderBy("createdAt", "desc").limit(limit).get();
        const reports = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, count: reports.length, reports });
      }

      if (action === "liquidations") {
        const limit = parseInt(req.query.limit || "50");
        const snap = await db.collection("liquidations").orderBy("createdAt", "desc").limit(limit).get();
        const liquidations = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, count: liquidations.length, liquidations });
      }

      // --- VARIETY-MAPPING: Get or update batch code → variety name mapping ---
      if (action === "variety-mapping") {
        const docRef = db.collection("email_config").doc("variety_mapping");

        if (req.method === "POST") {
          // Save mapping: { "172-R01": "Maravilla", "195-R50": "Reyna", ... }
          const mapping = req.body.mapping || req.body;
          await docRef.set({ mapping, updatedAt: new Date().toISOString() }, { merge: true });
          return res.json({ success: true, mapping });
        }

        // GET: return current mapping
        const snap = await docRef.get();
        const mapping = snap.exists ? (snap.data().mapping || {}) : {};
        return res.json({ success: true, mapping });
      }

      // --- REFETCH-DQR: Re-fetch DQR emails from IMAP (scans BULK .eml + direct DQR) ---
      if (action === "refetch-dqr") {
        const client = createImapClient();
        let processed = 0;

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          // Search only BULK and DQR emails by subject
          const searchResults = await client.search({ or: [
            { subject: "BULK" },
            { subject: "Daily Quality Report" },
          ]});

          if (searchResults.length === 0) {
            await client.logout();
            return res.json({ success: true, message: "No matching emails found", processed: 0 });
          }

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";

              // Process BULK emails: extract inner .eml DQR attachments
              if (/bulk/i.test(subject)) {
                const emlAtts = (parsed.attachments || []).filter(
                  a => (a.filename || "").toLowerCase().endsWith(".eml") || (a.contentType || "").includes("message/rfc822")
                );
                for (const emlAtt of emlAtts) {
                  try {
                    const inner = await simpleParser(emlAtt.content);
                    const innerSubject = inner.subject || "";
                    if (!isDailyQualityReport(null, innerSubject)) continue;
                    const xa = (inner.attachments || []).find(a => /\.(xlsx|xls)$/i.test(a.filename || ""));
                    if (!xa || !xa.content) continue;

                    const docId = (inner.messageId || `bulk-dqr-${msg.uid}-${processed}`)
                      .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
                    const existingSnap = await db.collection("emails").doc(docId).get();
                    if (existingSnap.exists) {
                      await db.collection("emails").doc(docId).delete();
                      await db.collection("email_extractions").doc(docId).delete().catch(() => {});
                    }
                    await db.collection("emails").doc(docId).set({
                      messageId: inner.messageId || docId,
                      uid: msg.uid,
                      from: inner.from?.text || "", fromName: inner.from?.value?.[0]?.name || "",
                      to: inner.to?.text || "", subject: innerSubject,
                      date: inner.date ? inner.date.toISOString() : new Date().toISOString(),
                      receivedAt: new Date().toISOString(),
                      textBody: (inner.text || "").slice(0, 50000),
                      htmlBody: (inner.html || "").slice(0, 100000),
                      hasAttachments: true,
                      attachments: (inner.attachments || []).map(a => ({ filename: a.filename || "unknown", contentType: a.contentType || "", size: a.size || 0 })),
                      xlsxBase64: xa.content.toString("base64"),
                      isDailyQualityReport: true,
                      status: "pending", analysisError: null, extractedTablesRaw: [],
                    });
                    processed++;
                    console.log(`refetch-dqr: Extracted DQR "${innerSubject}" from BULK`);
                  } catch (innerErr) {
                    console.error(`refetch-dqr: Error parsing inner .eml:`, innerErr.message);
                  }
                }
                continue;
              }

              // Direct DQR email
              if (!isDailyQualityReport(null, subject)) continue;
              const xa = (parsed.attachments || []).find(a => /\.(xlsx|xls)$/i.test(a.filename || ""));
              if (!xa || !xa.content) continue;

              const docId = (parsed.messageId || `uid-${msg.uid}`).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
              const existingSnap = await db.collection("emails").doc(docId).get();
              if (existingSnap.exists) {
                await db.collection("emails").doc(docId).delete();
                await db.collection("email_extractions").doc(docId).delete().catch(() => {});
              }
              await db.collection("emails").doc(docId).set({
                messageId: parsed.messageId || `uid-${msg.uid}`,
                uid: msg.uid,
                from: parsed.from?.text || "", fromName: parsed.from?.value?.[0]?.name || "",
                to: parsed.to?.text || "", subject,
                date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                receivedAt: new Date().toISOString(),
                textBody: (parsed.text || "").slice(0, 50000),
                htmlBody: (parsed.html || "").slice(0, 100000),
                hasAttachments: true,
                attachments: (parsed.attachments || []).map(a => ({ filename: a.filename || "unknown", contentType: a.contentType || "", size: a.size || 0 })),
                xlsxBase64: xa.content.toString("base64"),
                isDailyQualityReport: true,
                status: "pending", analysisError: null, extractedTablesRaw: [],
              });
              processed++;
              console.log(`refetch-dqr: Stored DQR "${subject}" with XLSX`);
            } catch (parseErr) {
              console.error(`refetch-dqr: Error parsing UID ${msg.uid}:`, parseErr.message);
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, message: `${processed} Daily Quality Report(s) re-fetched with XLSX`, processed });
      }

      // --- PROCESS-WEEKLY-QR: Fetch from IMAP, parse PDF, store directly (bypass trigger) ---
      if (action === "process-weekly-qr") {
        const client = createImapClient();
        let processed = 0;
        const results = [];

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          const searchResults = await client.search({ subject: "Weekly Quality Report" });
          console.log(`process-weekly-qr: Found ${searchResults.length} emails`);

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";
              if (!isWeeklyQualityReport(null, subject)) continue;

              const pdfAtt = (parsed.attachments || []).find(a => /\.pdf$/i.test(a.filename || ""));
              if (!pdfAtt || !pdfAtt.content) { results.push({ subject, error: "No PDF attachment" }); continue; }

              console.log(`process-weekly-qr: Parsing PDF from "${subject}" (${pdfAtt.content.length} bytes)`);
              const report = await parseWeeklyQualityReportPdf(pdfAtt.content);

              const berry = report.berry || "framboise";
              const docId = `WQR-${berry.toUpperCase().slice(0, 4)}-W${report.week || "?"}-${report.year || "?"}`;

              await db.collection("weekly_quality_reports").doc(docId).set({
                emailId: (parsed.messageId || `uid-${msg.uid}`).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200),
                week: report.week,
                year: report.year,
                berry: report.berry,
                pwResults: report.pwResults,
                brixSummary: report.brixSummary,
                ourRanches: report.ourRanches,
                allRanchCount: report.allRanchCount,
                totalVolume: report.totalVolume,
                subject,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });

              processed++;
              results.push({ docId, subject, week: report.week, year: report.year, berry: report.berry, ranches: report.ourRanches });
            } catch (parseErr) {
              console.error(`process-weekly-qr: Error:`, parseErr.message);
              results.push({ error: parseErr.message });
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, processed, results });
      }

      // --- DEBUG-WEEKLY-QR: Show raw PDF text for debugging parser ---
      if (action === "debug-weekly-qr") {
        const client = createImapClient();
        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");
          const searchResults = await client.search({ subject: "Weekly Quality Report" });
          if (searchResults.length === 0) return res.json({ success: false, error: "No WQR emails found" });
          // Get first one
          for await (const msg of client.fetch([searchResults[0]], { uid: true, source: true })) {
            const parsed = await simpleParser(msg.source);
            const pdfAtt = (parsed.attachments || []).find(a => /\.pdf$/i.test(a.filename || ""));
            if (!pdfAtt) return res.json({ success: false, error: "No PDF" });
            const pdfParser = new PDFParse({ data: pdfAtt.content });
            const textResult = await pdfParser.getText();
            const text = (textResult && textResult.text) || "";
            return res.json({ success: true, subject: parsed.subject, textLength: text.length, text });
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }
      }

      // --- REFETCH-WEEKLY-QR: Re-fetch Weekly Quality Reports from IMAP ---
      if (action === "refetch-weekly-qr") {
        const client = createImapClient();
        let processed = 0;

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          const searchResults = await client.search({ subject: "Weekly Quality Report" });
          console.log(`refetch-weekly-qr: Found ${searchResults.length} emails`);

          if (searchResults.length === 0) {
            await client.logout();
            return res.json({ success: true, message: "No Weekly Quality Report emails found", processed: 0 });
          }

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";
              if (!isWeeklyQualityReport(null, subject)) continue;

              const pdfAtt = (parsed.attachments || []).find(a => /\.pdf$/i.test(a.filename || ""));
              if (!pdfAtt || !pdfAtt.content) continue;

              const docId = (parsed.messageId || `uid-${msg.uid}`)
                .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);

              const existingSnap = await db.collection("emails").doc(docId).get();
              if (existingSnap.exists) {
                await db.collection("emails").doc(docId).delete();
                await db.collection("email_extractions").doc(docId).delete().catch(() => {});
              }

              await db.collection("emails").doc(docId).set({
                messageId: parsed.messageId || `uid-${msg.uid}`,
                uid: msg.uid,
                from: parsed.from?.text || "",
                fromName: parsed.from?.value?.[0]?.name || "",
                to: parsed.to?.text || "",
                subject,
                date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                receivedAt: new Date().toISOString(),
                textBody: (parsed.text || "").slice(0, 50000),
                htmlBody: (parsed.html || "").slice(0, 100000),
                hasAttachments: true,
                attachments: (parsed.attachments || []).map(a => ({ filename: a.filename || "unknown", contentType: a.contentType || "", size: a.size || 0 })),
                pdfBase64: pdfAtt.content.toString("base64"),
                isWeeklyQualityReport: true,
                status: "pending",
                analysisError: null,
                extractedTablesRaw: [],
              });
              processed++;
              console.log(`refetch-weekly-qr: Stored "${subject}" with PDF`);
            } catch (parseErr) {
              console.error(`refetch-weekly-qr: Error parsing UID ${msg.uid}:`, parseErr.message);
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, message: `${processed} Weekly Quality Report(s) re-fetched`, processed });
      }

      // --- REFETCH-QUALITY: Re-fetch Quality Inspection Reports from BULK .eml emails ---
      if (action === "refetch-quality") {
        const client = createImapClient();
        let processed = 0;
        const details = [];

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          // Search BULK emails
          const searchResults = await client.search({ subject: "BULK" });
          console.log(`refetch-quality: Found ${searchResults.length} BULK emails`);

          if (searchResults.length === 0) {
            await client.logout();
            return res.json({ success: true, message: "No BULK emails found", processed: 0 });
          }

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";
              if (!/bulk/i.test(subject)) continue;

              console.log(`refetch-quality: Processing BULK UID ${msg.uid}: "${subject}" — ${(parsed.attachments || []).length} attachments`);

              const emlAtts = (parsed.attachments || []).filter(
                a => (a.filename || "").toLowerCase().endsWith(".eml") || (a.contentType || "").includes("message/rfc822")
              );

              for (const emlAtt of emlAtts) {
                try {
                  const inner = await simpleParser(emlAtt.content);
                  const innerFrom = (inner.from?.text || "").toLowerCase().trim();
                  const innerSubject = inner.subject || "";

                  // Check if this is a Driscoll's Quality Inspection Report
                  const isDriscols = isDriscolsQualityReport(innerSubject, inner.text || "", inner.html || "");
                  const isFromDriscolls = innerFrom.includes("qainspectresults@driscolls.com");

                  if (!isDriscols && !isFromDriscolls) continue;

                  const docId = (inner.messageId || `bulk-qa-${msg.uid}-${processed}`)
                    .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);

                  // Delete existing to allow re-processing
                  const existingSnap = await db.collection("emails").doc(docId).get();
                  if (existingSnap.exists) {
                    await db.collection("emails").doc(docId).delete();
                    console.log(`refetch-quality: Deleted existing doc ${docId} for re-processing`);
                  }

                  await db.collection("emails").doc(docId).set({
                    messageId: inner.messageId || docId,
                    uid: msg.uid,
                    from: inner.from?.text || innerFrom,
                    fromName: inner.from?.value?.[0]?.name || "",
                    to: inner.to?.text || "",
                    subject: innerSubject,
                    date: inner.date ? inner.date.toISOString() : new Date().toISOString(),
                    receivedAt: new Date().toISOString(),
                    textBody: (inner.text || "").slice(0, 50000),
                    htmlBody: (inner.html || "").slice(0, 100000),
                    hasAttachments: (inner.attachments || []).length > 0,
                    attachments: (inner.attachments || []).map(a => ({ filename: a.filename || "unknown", contentType: a.contentType || "", size: a.size || 0 })),
                    isDriscolsReport: true,
                    bulkParentUid: msg.uid,
                    status: "pending",
                    analysisError: null,
                    extractedTablesRaw: [],
                  });

                  processed++;
                  details.push({ docId, subject: innerSubject, from: innerFrom });
                  console.log(`refetch-quality: Stored QA report "${innerSubject}" from ${innerFrom}`);
                } catch (innerErr) {
                  console.error(`refetch-quality: Error parsing inner .eml:`, innerErr.message);
                }
              }
            } catch (parseErr) {
              console.error(`refetch-quality: Error parsing UID ${msg.uid}:`, parseErr.message);
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, message: `${processed} Quality Inspection Report(s) extracted from BULK emails`, processed, details: details.slice(0, 20) });
      }

      // --- REFETCH-LIQUIDATION: Re-fetch Liquidation emails from IMAP ---
      if (action === "refetch-liquidation") {
        const client = createImapClient();
        let processed = 0;

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          const searchResults = await client.search({ or: [{ subject: "LIQUIDATION" }, { subject: "IQUIDATION" }] });
          if (searchResults.length === 0) {
            await client.logout();
            return res.json({ success: true, message: "No liquidation emails found", processed: 0 });
          }

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";

              if (!isLiquidationEmail(null, subject)) continue;
              if (!parsed.attachments || parsed.attachments.length === 0) continue;

              // Find ALL XLS/XLSX attachments (direct)
              const xlsAttachments = parsed.attachments.filter(
                (a) => /\.(xlsx|xls)$/i.test(a.filename || "") && a.content
              );

              // Find .eml attachments (nested emails containing XLS)
              const emlAttachments = parsed.attachments.filter(
                (a) => (a.filename || "").toLowerCase().endsWith(".eml") ||
                       (a.contentType || "").includes("message/rfc822")
              );

              // If we have .eml attachments, extract XLS from each inner email
              if (emlAttachments.length > 0) {
                console.log(`refetch-liquidation: BULK email "${subject}" — ${emlAttachments.length} .eml attachments`);
                let innerCount = 0;
                for (const emlAtt of emlAttachments) {
                  try {
                    const innerParsed = await simpleParser(emlAtt.content);
                    const innerSubject = innerParsed.subject || "(sans sujet)";

                    if (!innerParsed.attachments || innerParsed.attachments.length === 0) {
                      console.log(`refetch-liquidation: Inner email "${innerSubject}" has no attachments, skipping`);
                      continue;
                    }

                    const innerXls = innerParsed.attachments.filter(
                      (a) => /\.(xlsx|xls)$/i.test(a.filename || "") && a.content
                    );

                    if (innerXls.length === 0) {
                      console.log(`refetch-liquidation: Inner email "${innerSubject}" has no XLS, skipping`);
                      continue;
                    }

                    // Find the LIQUIDATION summary PDF on this inner email (same filename pattern as XLS)
                    const innerLiqPdfAtt = innerParsed.attachments.find(
                      (a) => /\.pdf$/i.test(a.filename || "") && /LIQUIDATION/i.test(a.filename || "") && a.content
                    );
                    const innerLiqPdf = innerLiqPdfAtt ? innerLiqPdfAtt.content.toString("base64") : null;
                    // Find the Grower Settlement Statement PDF (commission breakdown)
                    const innerGssAtt = innerParsed.attachments.find(
                      (a) => /\.pdf$/i.test(a.filename || "") &&
                             !/LIQUIDATION/i.test(a.filename || "") &&
                             /Berry\s*Good|RASPBERRIES\s+WEEK|BLUEBERRIES\s+WEEK|Grower\s+Settlement/i.test(a.filename || "") &&
                             a.content
                    );
                    const innerGssPdf = innerGssAtt ? innerGssAtt.content.toString("base64") : null;

                    for (let xi = 0; xi < innerXls.length; xi++) {
                      const xls = innerXls[xi];
                      const innerDocId = (innerParsed.messageId || `bulk-liq-${msg.uid}-${innerCount}-${xi}`)
                        .replace(/[^a-zA-Z0-9_-]/g, "_")
                        .slice(0, 200);

                      // Delete existing doc + extraction to force re-processing
                      const existingDoc = db.collection("emails").doc(innerDocId);
                      const existingSnap = await existingDoc.get();
                      if (existingSnap.exists) {
                        await existingDoc.delete();
                        await db.collection("email_extractions").doc(innerDocId).delete().catch(() => {});
                      }

                      await db.collection("emails").doc(innerDocId).set({
                        messageId: innerParsed.messageId || `bulk-liq-${msg.uid}-${innerCount}-${xi}`,
                        uid: msg.uid,
                        from: innerParsed.from?.text || parsed.from?.text || "",
                        fromName: innerParsed.from?.value?.[0]?.name || "",
                        to: innerParsed.to?.text || "",
                        subject: innerSubject,
                        date: innerParsed.date ? innerParsed.date.toISOString() : new Date().toISOString(),
                        receivedAt: new Date().toISOString(),
                        textBody: (innerParsed.text || "").slice(0, 50000),
                        htmlBody: (innerParsed.html || "").slice(0, 100000),
                        hasAttachments: true,
                        attachments: [{ filename: xls.filename || "unknown", contentType: xls.contentType || "application/octet-stream", size: xls.size || 0 }],
                        xlsxBase64: xls.content.toString("base64"),
                        liqSummaryPdfBase64: innerLiqPdf,
                        gssPdfBase64: innerGssPdf,
                        isLiquidation: true,
                        bulkParentUid: msg.uid,
                        status: "pending",
                        analysisError: null,
                        extractedTablesRaw: [],
                      });

                      processed++;
                      console.log(`refetch-liquidation: Extracted from inner .eml "${innerSubject}" — XLS: ${xls.filename} (${xls.size} bytes)`);
                    }
                    innerCount++;
                  } catch (innerErr) {
                    console.error(`refetch-liquidation: Error parsing inner .eml:`, innerErr.message);
                  }
                }
                // Also store the wrapper email as analyzed
                const wrapperDocId = (parsed.messageId || `uid-${msg.uid}`)
                  .replace(/[^a-zA-Z0-9_-]/g, "_")
                  .slice(0, 200);
                await db.collection("emails").doc(wrapperDocId).set({
                  messageId: parsed.messageId || `uid-${msg.uid}`,
                  uid: msg.uid,
                  from: parsed.from?.text || "",
                  subject: subject,
                  date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                  receivedAt: new Date().toISOString(),
                  isBulkWrapper: true,
                  bulkExtractedCount: innerCount,
                  isLiquidation: true,
                  status: "analyzed",
                });
                continue; // Skip direct XLS processing for this email
              }

              // Direct XLS attachments (non-bulk)
              if (xlsAttachments.length === 0) continue;

              const baseDocId = (parsed.messageId || `uid-${msg.uid}`)
                .replace(/[^a-zA-Z0-9_-]/g, "_")
                .slice(0, 180);

              // Find the LIQUIDATION summary PDF for this email (contains financial totals)
              const liqPdfAtt = parsed.attachments.find(
                (a) => /\.pdf$/i.test(a.filename || "") && /LIQUIDATION/i.test(a.filename || "") && a.content
              );
              const directLiqPdf = liqPdfAtt ? liqPdfAtt.content.toString("base64") : null;
              // Find the Grower Settlement Statement PDF (commission breakdown)
              const directGssAtt = parsed.attachments.find(
                (a) => /\.pdf$/i.test(a.filename || "") &&
                       !/LIQUIDATION/i.test(a.filename || "") &&
                       /Berry\s*Good|RASPBERRIES\s+WEEK|BLUEBERRIES\s+WEEK|Grower\s+Settlement/i.test(a.filename || "") &&
                       a.content
              );
              const directGssPdf = directGssAtt ? directGssAtt.content.toString("base64") : null;

              for (let idx = 0; idx < xlsAttachments.length; idx++) {
                const xlsAttachment = xlsAttachments[idx];
                const xlsxBase64 = xlsAttachment.content.toString("base64");
                // Use suffix for multiple attachments from same email
                const docId = xlsAttachments.length === 1 ? baseDocId : `${baseDocId}_att${idx}`;

                const existingDoc = db.collection("emails").doc(docId);
                const existingSnap = await existingDoc.get();
                if (existingSnap.exists) {
                  await existingDoc.delete();
                  await db.collection("email_extractions").doc(docId).delete().catch(() => {});
                }

                await db.collection("emails").doc(docId).set({
                  messageId: parsed.messageId || `uid-${msg.uid}`,
                  uid: msg.uid,
                  from: parsed.from?.text || "",
                  fromName: parsed.from?.value?.[0]?.name || "",
                  to: parsed.to?.text || "",
                  subject: `${subject} [${xlsAttachment.filename || `att${idx}`}]`,
                  date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                  receivedAt: new Date().toISOString(),
                  textBody: (parsed.text || "").slice(0, 50000),
                  htmlBody: (parsed.html || "").slice(0, 100000),
                  hasAttachments: true,
                  attachments: [{ filename: xlsAttachment.filename || "unknown", contentType: xlsAttachment.contentType || "application/octet-stream", size: xlsAttachment.size || 0 }],
                  xlsxBase64: xlsxBase64,
                  liqSummaryPdfBase64: directLiqPdf,
                  gssPdfBase64: directGssPdf,
                  isLiquidation: true,
                  status: "pending",
                  analysisError: null,
                  extractedTablesRaw: [],
                });

                processed++;
                console.log(`refetch-liquidation: Stored liquidation "${subject}" attachment ${idx + 1}/${xlsAttachments.length}: ${xlsAttachment.filename} (${xlsAttachment.size} bytes)${directLiqPdf ? ' + LIQUIDATION.pdf' : ''}`);
              }
            } catch (parseErr) {
              console.error(`refetch-liquidation: Error parsing UID ${msg.uid}:`, parseErr.message);
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, message: `${processed} Liquidation email(s) re-fetched`, processed });
      }

      // --- REANALYZE-EMAIL: force re-analysis of an existing email doc ---
      // Delete + recreate the email doc with status=pending to re-trigger the analyzeEmail onCreate function
      if (action === "reanalyze-email" && req.method === "POST") {
        const { emailId } = req.body || {};
        if (!emailId) return res.status(400).json({ success: false, error: "emailId required" });
        const snap = await db.collection("emails").doc(emailId).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "email not found" });
        const data = snap.data();

        // AGQ emails: if agqPdfAttachments were already stripped, re-fetch from IMAP
        if (data.isAgqAnalysis && (!Array.isArray(data.agqPdfAttachments) || data.agqPdfAttachments.length === 0) && data.uid) {
          try {
            const imapClient = createImapClient();
            await imapClient.connect();
            await imapClient.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");
            const msgs = [];
            for await (const m of imapClient.fetch({ uid: `${data.uid}` }, { uid: true, source: true })) {
              if (m.uid === data.uid) msgs.push(m);
            }
            if (msgs.length > 0) {
              const reParsed = await simpleParser(msgs[0].source);
              const rePdfs = (reParsed.attachments || [])
                .filter(a => /\.pdf$/i.test(a.filename || "") && a.content)
                .map(a => ({ filename: a.filename, size: a.size || 0, contentBase64: a.content.toString("base64") }));
              if (rePdfs.length > 0) {
                data.agqPdfAttachments = rePdfs;
                console.log(`reanalyze-email: re-fetched ${rePdfs.length} AGQ PDF(s) from IMAP UID ${data.uid}`);
              }
            }
            try { await imapClient.logout(); } catch (_) {}
          } catch (e) {
            console.warn(`reanalyze-email: IMAP re-fetch failed: ${e.message}`);
          }
        }

        // Clean up previous extraction result
        await db.collection("email_extractions").doc(emailId).delete().catch(() => {});
        // Delete then recreate with pending status to trigger onCreate
        await snap.ref.delete();
        await new Promise(r => setTimeout(r, 400));
        const cleaned = { ...data, status: "pending", analysisError: null };
        delete cleaned.extractedTablesRaw;
        await db.collection("emails").doc(emailId).set(cleaned);
        return res.json({ success: true, emailId, agqRefetched: data.isAgqAnalysis && Array.isArray(data.agqPdfAttachments) && data.agqPdfAttachments.length > 0 });
      }

      // --- REPROCESS-DQR: delete PFQ expeditions and recreate from stored DQR data ---
      // --- REPROCESS-PFQ: re-trigger analyzeEmail for Driscoll's PFQ emails ---
      // --- REPROCESS-PFQ: directly parse PFQ emails and recreate expeditions ---
      if (action === "reprocess-pfq" && req.method === "POST") {
        const { days = 10 } = req.body || {};
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffISO = cutoff.toISOString().split('T')[0];

        // Load ALL emails and filter PFQ in code (Firestore can't do string contains)
        const emailsSnap = await db.collection("emails").get();
        const pfqEmails = [];
        emailsSnap.forEach(doc => {
          const data = doc.data();
          if (data.isDailyQualityReport || data.isLiquidation) return;
          const emailDate = (data.date || '').slice(0, 10);
          if (emailDate < cutoffISO) return;
          const from = (data.from || '').toLowerCase();
          const subject = (data.subject || '').toLowerCase();
          const isPfq = from.includes('qainspectresults@driscolls.com') ||
            (data.isDriscolsReport === true) ||
            (/quality\s*inspection\s*report/i.test(data.subject || ''));
          if (isPfq && data.htmlBody) {
            pfqEmails.push({ id: doc.id, ...data });
          }
        });

        let created = 0;
        const results = [];
        for (const emailData of pfqEmails) {
          try {
            const report = parseDriscolsReport(emailData.htmlBody, emailData.textBody, emailData.subject);
            if (!report || !report.receiptNumber) continue;

            const receiptId = report.receiptNumber.replace(/‑/g, "-");
            const batchSlug = report.batchNumber
              ? String(report.batchNumber).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
              : null;
            const expDocId = batchSlug ? `${receiptId}__${batchSlug}` : receiptId;

            const allDefects = [...(report.conditionDefects || []), ...(report.appearanceDefects || [])];
            const conditionRow = allDefects.find(d => d.name && d.name.toLowerCase() === "condition");
            const appearanceRow = allDefects.find(d => d.name && d.name.toLowerCase() === "appearance");
            const pfqCondition = conditionRow ? (conditionRow.points || 0) : 0;
            const pfqApparence = appearanceRow ? (appearanceRow.points || 0) : 0;

            const expedition = {
              emailId: emailData.id,
              receiptId,
              batchNumber: report.batchNumber || null,
              license: report.license || null,
              date: report.receivedDate || emailData.date,
              berryType: report.berryType || null,
              berryTypeFr: mapBerryToFrench(report.berryType),
              variety: report.variety || null,
              itemDescription: report.itemDescription || null,
              ranch: report.ranch || null,
              ranchName: report.ranchName || null,
              batchWeight: report.batchWeight || null,
              batchQuantity: report.batchQuantity || null,
              totalFruitInspected: report.totalFruitInspected || null,
              brix: report.brix || null,
              conditionDefects: report.conditionDefects || [],
              appearanceDefects: report.appearanceDefects || [],
              overallResult: report.overallResult || null,
              inspectionType: report.inspectionType || null,
              pfqCondition,
              pfqApparence,
              pfqTotal: pfqCondition + pfqApparence,
              pqScore: pfqCondition + pfqApparence,
              status: report.overallResult === "PASS" ? "PFQ Reçu. Attente Brix" : (report.overallResult === "REJECT" ? "Rejeté" : "PFQ Reçu. Attente Brix"),
              source: "email",
              updatedAt: new Date().toISOString(),
            };

            // Only set createdAt if new
            const existing = await db.collection("expeditions").doc(expDocId).get();
            if (!existing.exists) expedition.createdAt = new Date().toISOString();

            await db.collection("expeditions").doc(expDocId).set(expedition, { merge: true });
            created++;
            results.push({ docId: expDocId, receipt: receiptId, variety: report.variety, date: (report.receivedDate || emailData.date || '').slice(0, 10) });
          } catch (err) {
            console.error(`reprocess-pfq: Error for email ${emailData.id}:`, err.message);
          }
        }

        return res.json({
          success: true,
          message: `${created} expédition(s) PFQ créées à partir de ${pfqEmails.length} email(s)`,
          created,
          emailsFound: pfqEmails.length,
          expeditions: results
        });
      }

      if (action === "reprocess-dqr" && req.method === "POST") {
        const { days = 10 } = req.body || {};
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffISO = cutoff.toISOString();

        const ranchNameToCode = (name) => {
          if (!name) return null;
          const n = name.toLowerCase();
          if (n.includes("r-berry") || n.includes("r berry") || n.includes("200742")) return "200742";
          if (n.includes("sarl 3") || n.includes("berry good farms sarl") || n.includes("berry good farms") || n.includes("200876")) return "200876";
          return null;
        };

        // Carry-forward missing fields in brixRows (Receipt ID, Ranch Name, Berry Type, Variety, Product Name)
        // Note: inspectionResult and inspectionType are NOT carried forward — each batch has its own
        const applyCarryForward = (rows) => {
          let lastReceiptId = null, lastRanchName = null, lastBerryType = null, lastVariety = null, lastProductName = null;
          return rows.map(row => {
            if (row.receiptId) lastReceiptId = row.receiptId;
            if (row.ranchName) lastRanchName = row.ranchName;
            if (row.berryType) lastBerryType = row.berryType;
            if (row.variety) lastVariety = row.variety;
            if (row.productName) lastProductName = row.productName;
            return {
              ...row,
              receiptId: row.receiptId || lastReceiptId || null,
              ranchName: row.ranchName || lastRanchName || null,
              berryType: row.berryType || lastBerryType || null,
              variety: row.variety || lastVariety || null,
              productName: row.productName || lastProductName || null,
            };
          });
        };

        // Parse receiptDate from XLSX (Excel serial or string) — same as analyzeEmail
        const parseReceiptDateXlsx = (rd) => {
          if (!rd) return null;
          if (typeof rd === 'number') {
            const d = new Date((rd - 25569) * 86400000);
            return d.toISOString().split('T')[0];
          }
          const s = rd.toString().trim();
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
          const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
          return null;
        };

        // Find DQR email_extractions
        const extractionsSnap = await db.collection("email_extractions")
          .where("category", "==", "daily_quality_report")
          .get();

        // Phase 1: Collect ALL brixRows from ALL emails, grouped by REAL receiptDate
        // (handles bulk catch-up emails where one email covers multiple past days)
        const rowsByDate = {}; // dateISO → array of {row, emailId, fallbackDate}
        const emailIdsProcessed = new Set();

        for (const doc of extractionsSnap.docs) {
          const ext = doc.data();
          if (ext.analyzedAt < cutoffISO) continue;

          const emailSnap = await db.collection("emails").doc(doc.id).get();
          if (!emailSnap.exists) continue;
          const emailData = emailSnap.data();
          const emailDate = emailData.date ? new Date(emailData.date) : null;
          if (!emailDate) continue;

          let brixRows;
          if (emailData.xlsxBase64) {
            const xlsxBuffer = Buffer.from(emailData.xlsxBase64, "base64");
            brixRows = parseDailyQualityReportXlsx(xlsxBuffer);
            await db.collection("email_extractions").doc(doc.id).update({
              "structuredData.brixRows": brixRows
            });
          } else {
            const rawBrixRows = ext.structuredData?.brixRows;
            if (!rawBrixRows || rawBrixRows.length === 0) continue;
            brixRows = applyCarryForward(rawBrixRows);
          }

          emailIdsProcessed.add(doc.id);
          const veille = new Date(emailDate);
          veille.setDate(veille.getDate() - 1);
          const veilleISO = veille.toISOString().split("T")[0];

          for (const row of brixRows) {
            // Use receiptDate from XLSX if available, else email J-1
            const realDate = parseReceiptDateXlsx(row.receiptDate) || veilleISO;
            if (!rowsByDate[realDate]) rowsByDate[realDate] = [];
            rowsByDate[realDate].push({ row, emailId: doc.id, emailDate: emailDate.toISOString() });
          }
        }

        // Phase 2: For each unique date, delete existing DQR expeditions and recreate from union
        const results = [];
        for (const [dateISO, entries] of Object.entries(rowsByDate)) {
          // Delete old DQR expeditions for this date
          let deletedCount = 0;
          const oldDqrSnap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", dateISO)
            .get();
          if (!oldDqrSnap.empty) {
            const batch = db.batch();
            oldDqrSnap.docs.forEach(d => { batch.delete(d.ref); deletedCount++; });
            await batch.commit();
          }

          // Sort entries: prefer most recent email (last write wins for same docId)
          entries.sort((a, b) => a.emailDate.localeCompare(b.emailDate));

          // Dédup Initial/Re-Inspection par batchId : garder Re-Inspection (verdict final)
          // si elle existe, sinon Initial. Évite le doublonnage sur les batches ré-inspectés.
          const isReInspectionRow = (t) => /re[\s-]?inspection/i.test(t || '');
          const entriesByBatch = {};
          for (const entry of entries) {
            const bId = entry.row.batchId;
            if (!bId) continue;
            const existing = entriesByBatch[bId];
            if (!existing) {
              entriesByBatch[bId] = entry;
            } else if (isReInspectionRow(entry.row.inspectionType) && !isReInspectionRow(existing.row.inspectionType)) {
              entriesByBatch[bId] = entry;
            } else if (isReInspectionRow(entry.row.inspectionType) === isReInspectionRow(existing.row.inspectionType)) {
              // same type → keep most recent emailDate (already sorted, last wins)
              entriesByBatch[bId] = entry;
            }
          }
          const dedupedEntries = Object.values(entriesByBatch);
          if (dedupedEntries.length !== entries.length) {
            console.log(`reprocess-dqr ${dateISO}: dedup ${entries.length} → ${dedupedEntries.length} (Initial/Re-Inspection)`);
          }

          // Recreate, deduping by docId across emails
          let createdCount = 0;
          const reprocessDocIdCounter = {};
          const seenDocIds = new Set();
          for (const { row, emailId } of dedupedEntries) {
            const isByPass = (row.inspectionType || '').toLowerCase().includes('by') && (row.inspectionType || '').toLowerCase().includes('pass');
            const effectiveResult = (row.inspectionResult && row.inspectionResult !== 'Null') ? row.inspectionResult : (isByPass ? 'PASS' : null);
            if (!effectiveResult) continue;
            const receiptId = row.receiptId || null;
            let baseDocId = receiptId
              ? `${receiptId}__${(row.batchId || "").replace(/[^a-zA-Z0-9-]/g, "-")}`
              : `DQR-${row.batchId}-${emailId.substring(0, 20)}`;
            reprocessDocIdCounter[baseDocId] = (reprocessDocIdCounter[baseDocId] || 0) + 1;
            const expDocId = reprocessDocIdCounter[baseDocId] > 1 ? `${baseDocId}__${reprocessDocIdCounter[baseDocId]}` : baseDocId;
            const ranch = ranchNameToCode(row.ranchName);

            await db.collection("expeditions").doc(expDocId).set({
              receiptId, batchNumber: row.batchId || null,
              berryType: row.berryType || null, berryTypeFr: mapBerryToFrench(row.berryType),
              variety: (row.variety || "").trim().replace(/[™®]/g, "") || null,
              itemDescription: row.productName || null,
              batchWeight: row.weight || 0, batchQuantity: row.quantity || 0,
              totalFruitInspected: row.totalFruitInspected || 0,
              brix: row.brix || null, pfqBrix: row.brixPoints || 0,
              brixFromDQR: row.brix || 0, enrichedPqScore: row.enrichedPqScore || 0,
              initialPq: row.initialPq || 0, reInspectionPq: row.reInspectionPq || 0,
              pqScore: row.enrichedPqScore || row.brixPoints || 0,
              pfqTotal: row.brixPoints || 0, pfqCondition: 0, pfqApparence: 0,
              overallResult: effectiveResult,
              inspectionType: row.inspectionType || null,
              ranch, ranchName: row.ranchName || null,
              status: "DQR reçu", source: "dqr-auto-created",
              dateISO, date: dateISO,
              sourceEmailId: emailId,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });
            seenDocIds.add(expDocId);
            createdCount++;
          }

          results.push({ date: dateISO, emails: [...new Set(entries.map(e => e.emailId))].length, deleted: deletedCount, created: createdCount });
        }

        // ---- Step 3: Shift J+1 expeditions to J when they match unmatched bons ----
        const normV = (v) => (v || '').toLowerCase().replace(/[™®\s-]/g, '').replace(/sol$/, '').replace(/(.)\1+/g, '$1');
        let totalShifted = 0;

        // Collect all unique dates processed
        const processedDates = [...new Set(results.map(r => r.date))].sort();

        for (const dateISO of processedDates) {
          // Get bons d'apport Export for this date (stored in pfq_interne collection)
          const bonsSnap = await db.collection("pfq_interne").where("date", "==", dateISO).get();
          const bonsExport = [];
          bonsSnap.forEach(d => {
            const data = d.data();
            if ((data.typeVente || '').toLowerCase() !== 'marché local' && (data.typeVente || '').toLowerCase() !== 'marche local') {
              bonsExport.push({ id: d.id, ...data });
            }
          });
          if (bonsExport.length === 0) continue;

          // Get DQR expeditions for this date (J)
          const expJSnap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", dateISO)
            .get();
          const expJ = [];
          expJSnap.forEach(d => expJ.push({ id: d.id, ...d.data() }));

          // Get DQR expeditions for J+1
          const nextD = new Date(dateISO + 'T00:00:00');
          nextD.setDate(nextD.getDate() + 1);
          const nextISO = nextD.toISOString().split('T')[0];
          const expJ1Snap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", nextISO)
            .get();
          const expJ1 = [];
          expJ1Snap.forEach(d => expJ1.push({ id: d.id, ...d.data() }));

          if (expJ1.length === 0) continue;

          // Match bons to J expeditions first
          const usedJIds = new Set();
          const unmatchedBons = [];
          for (const bon of bonsExport) {
            const bonVar = normV(bon.blocVariete || '');
            const bonKg = parseFloat(bon.poidsLot) || 0;
            let found = false;
            for (const exp of expJ) {
              if (usedJIds.has(exp.id)) continue;
              const expVar = normV(exp.variety || '');
              if (!(bonVar && expVar && (bonVar.includes(expVar) || expVar.includes(bonVar)))) continue;
              const expKg = parseFloat(exp.batchWeight) || 0;
              if (bonKg > 0 && expKg > 0) {
                const ratio = Math.min(bonKg, expKg) / Math.max(bonKg, expKg);
                if (ratio >= 0.5) { usedJIds.add(exp.id); found = true; break; }
              }
            }
            if (!found) unmatchedBons.push(bon);
          }

          // Try to match unmatched bons with J+1 expeditions → shift them to J
          const usedJ1Ids = new Set();
          for (const bon of unmatchedBons) {
            const bonVar = normV(bon.blocVariete || '');
            const bonKg = parseFloat(bon.poidsLot) || 0;
            for (const exp of expJ1) {
              if (usedJ1Ids.has(exp.id)) continue;
              const expVar = normV(exp.variety || '');
              if (!(bonVar && expVar && (bonVar.includes(expVar) || expVar.includes(bonVar)))) continue;
              const expKg = parseFloat(exp.batchWeight) || 0;
              if (bonKg > 0 && expKg > 0) {
                const ratio = Math.min(bonKg, expKg) / Math.max(bonKg, expKg);
                if (ratio >= 0.5) {
                  // Shift this J+1 expedition to J
                  await db.collection("expeditions").doc(exp.id).set({
                    dateISO: dateISO,
                    date: dateISO,
                    dateOrigine: nextISO,
                    decalage: true,
                    updatedAt: new Date().toISOString(),
                  }, { merge: true });
                  usedJ1Ids.add(exp.id);
                  totalShifted++;
                  console.log(`reprocess-dqr: Shifted expedition ${exp.id} (${exp.variety}, ${exp.batchWeight}kg) from ${nextISO} → ${dateISO}`);
                  break;
                }
              }
            }
          }
        }

        const shiftMsg = totalShifted > 0 ? `, ${totalShifted} expédition(s) décalée(s) J+1→J` : '';
        return res.json({ success: true, message: `${results.length} DQR(s) reprocessed${shiftMsg}`, results, shifted: totalShifted });
      }

      // --- CLEANUP-DUPLICATE-DQR: drop Initial-Inspection docs when Re-Inspection exists for same batch ---
      if (action === "cleanup-duplicate-dqr" && req.method === "POST") {
        const { apply = false } = req.body || {};
        const isReInsp = (t) => /re[\s-]?inspection/i.test(t || "");
        const snap = await db.collection("expeditions").where("source", "==", "dqr-auto-created").get();
        const groups = {};
        snap.docs.forEach(doc => {
          const d = doc.data();
          const key = `${d.receiptId || "?"}__${d.batchNumber || "?"}`;
          if (!groups[key]) groups[key] = [];
          groups[key].push({ id: doc.id, ref: doc.ref, ...d });
        });
        const toDelete = [];
        const summaryByDate = {};
        const groupReports = [];
        for (const [key, docs] of Object.entries(groups)) {
          if (docs.length < 2) continue;
          docs.sort((a, b) => {
            const ari = isReInsp(a.inspectionType), bri = isReInsp(b.inspectionType);
            if (ari !== bri) return ari ? -1 : 1;
            return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
          });
          const [keep, ...remove] = docs;
          const date = keep.dateISO || keep.date || "?";
          summaryByDate[date] = (summaryByDate[date] || 0) + remove.length;
          groupReports.push({
            key, date, variety: keep.variety, weight: keep.batchWeight,
            keep: { id: keep.id, type: keep.inspectionType, result: keep.overallResult },
            drop: remove.map(r => ({ id: r.id, type: r.inspectionType, result: r.overallResult })),
          });
          toDelete.push(...remove);
        }
        if (apply && toDelete.length > 0) {
          for (let i = 0; i < toDelete.length; i += 400) {
            const batch = db.batch();
            toDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
        }
        return res.json({
          success: true,
          mode: apply ? "applied" : "dry-run",
          totalDqrDocs: snap.size,
          duplicateGroups: groupReports.length,
          docsToDelete: toDelete.length,
          deleted: apply ? toDelete.length : 0,
          summaryByDate,
          groups: groupReports.slice(0, 100),
        });
      }

      // --- PLANT-INVOICES: list all uploaded Driscoll's plant invoices ---
      if (action === "plant-invoices") {
        const snap = await db.collection("plant_invoices").orderBy("date", "asc").get();
        const invoices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, count: invoices.length, invoices });
      }

      // --- DELETE-PLANT-INVOICE: remove one (or all variants of a ref) + storage cleanup ---
      if (action === "delete-plant-invoice" && req.method === "POST") {
        const { id, ref, deleteStorage } = req.body || {};
        const bucket = admin.storage().bucket("berrygood-farms-photos");
        const storagePathsToDelete = new Set();

        if (id) {
          const docRef = db.collection("plant_invoices").doc(id);
          const snap = await docRef.get();
          if (snap.exists && snap.data().storagePath) storagePathsToDelete.add(snap.data().storagePath);
          await docRef.delete();
        } else if (ref) {
          const snap = await db.collection("plant_invoices").where("ref", "==", ref).get();
          for (const d of snap.docs) {
            if (d.data().storagePath) storagePathsToDelete.add(d.data().storagePath);
            await d.ref.delete();
          }
        } else {
          return res.status(400).json({ success: false, error: "id or ref required" });
        }

        // Delete the underlying PDF file(s) from Storage if requested (default true)
        if (deleteStorage !== false) {
          for (const path of storagePathsToDelete) {
            try { await bucket.file(path).delete(); } catch (e) { console.warn("Storage delete fail:", path, e.message); }
          }
        }
        return res.json({ success: true, deleted: 1 });
      }

      // --- RESCAN-PLANT-INVOICE: re-run AI extraction on an existing PDF in Storage ---
      if (action === "rescan-plant-invoice" && req.method === "POST") {
        const { ref } = req.body || {};
        if (!ref) return res.status(400).json({ success: false, error: "ref required" });
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "ANTHROPIC_API_KEY manquante" });

        // Find any existing doc to recover the storagePath (or pdfUrl)
        const existing = await db.collection("plant_invoices").where("ref", "==", ref).limit(1).get();
        if (existing.empty) return res.status(404).json({ success: false, error: "Facture introuvable" });
        const existingDoc = existing.docs[0].data();
        let storagePath = existingDoc.storagePath;
        if (!storagePath && existingDoc.pdfUrl) {
          // Recover storagePath from public URL
          const m = existingDoc.pdfUrl.match(/storage\.googleapis\.com\/[^/]+\/(.+)$/);
          if (m) storagePath = decodeURIComponent(m[1]);
        }
        if (!storagePath) return res.status(404).json({ success: false, error: "Chemin Storage introuvable pour cette facture" });

        // Download the PDF from Storage
        const bucket = admin.storage().bucket("berrygood-farms-photos");
        const [buffer] = await bucket.file(storagePath).download();
        const cleanBase64 = buffer.toString("base64");
        const ext = storagePath.split(".").pop().toLowerCase();
        const isPdf = ext === "pdf";

        // Try pdf-parse first
        let pdfText = "";
        if (isPdf) {
          try {
            const p = new PDFParse({ data: buffer });
            const r = await p.getText();
            pdfText = (r && r.text) || "";
          } catch (e) { console.warn("rescan pdf-parse:", e.message); }
        }

        // Same prompt as scan-plant-invoice
        const PROMPT = `Tu analyses une facture de plants framboise/myrtille émise par Driscoll's Du Maroc SARL à Berry Good Farms SARL.

VÉRIFICATION (toutes doivent être vraies, sinon accepted=false):
- Le fournisseur (en-tête, émetteur) contient "Driscoll" dans son nom.
- Le client (destinataire) contient "Berry Good" ou "BGF" dans son nom.

STRUCTURE DES FACTURES DRISCOLL'S — TRÈS IMPORTANT:
Une facture peut contenir PLUSIEURS lignes. Chaque ligne a son propre numéro de commande (SO...) et son propre packing slip (PS-...).

EXTRACTION — retourne UNIQUEMENT ce JSON (pas de markdown):
{
  "accepted": true,
  "rejection_reason": null,
  "ref": "INV17074653",
  "date": "2024-12-19",
  "echeance": "2025-03-19",
  "livraison": "2024-12-18",
  "items": [
    { "variete": "Corrina PL 1L", "qte": 4000, "montant": 159200.00, "commande": "SO17109654", "packing": "PS-000103860" }
  ],
  "total_montant": 328350.00,
  "confidence": 0.95
}

Règles:
- Chaque item DOIT avoir son "commande" (SO...) et "packing" (PS-...).
- "qte" et "montant" sont des nombres purs (pas de virgule ni espace).
- Vérifie que la somme des items.montant ≈ total_montant.`;

        const Anthropic = require("@anthropic-ai/sdk");
        const aiClient = new Anthropic({ apiKey });
        const messageContent = [];
        if (pdfText && pdfText.length > 50) messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
        else if (isPdf) messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 }});
        else {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 }});
        }
        messageContent.push({ type: "text", text: PROMPT });

        let resp;
        for (const model of ["claude-sonnet-4-5", "claude-opus-4-5"]) {
          try {
            resp = await aiClient.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            if (model === "claude-opus-4-5") throw e;
          }
        }
        const aiText = resp.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis = null;
        try {
          const m = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(m ? m[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA non structurée", raw: aiText });
        }
        if (!analysis || analysis.accepted === false) {
          return res.json({ success: false, analysis, error: analysis?.rejection_reason || "Facture rejetée" });
        }

        // Wipe stale docs for this ref
        const stale = await db.collection("plant_invoices").where("ref", "==", ref).get();
        for (const d of stale.docs) await d.ref.delete();

        // Re-classify and persist
        const isMyrtille = (v) => /corina|corrina|cascade|breeze|eterna|regina|rosita|biloxi|emerald|jewel|liberty|myrtille|blueberr|blue/i.test(v || "");
        const now = new Date().toISOString();
        const created = [];
        const items = analysis.items || [];
        const pdfUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it || !it.variete) continue;
          const slug = String(it.variete).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const cmd = it.commande || analysis.commande || `idx${i}`;
          const cmdSlug = String(cmd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const docId = `${analysis.ref}__${cmdSlug}__${slug}__${i}`;
          await db.collection("plant_invoices").doc(docId).set({
            ref: analysis.ref || ref,
            date: analysis.date || null,
            echeance: analysis.echeance || null,
            livraison: analysis.livraison || null,
            commande: it.commande || analysis.commande || null,
            packing: it.packing || analysis.packing || null,
            variete: it.variete,
            qte: typeof it.qte === "number" ? it.qte : (parseFloat(it.qte) || 0),
            montant: typeof it.montant === "number" ? it.montant : (parseFloat(it.montant) || 0),
            culture: isMyrtille(it.variete) ? "myrtille" : "framboise",
            pdfUrl,
            storagePath,
            confidence: analysis.confidence || null,
            invoiceTotal: analysis.total_montant || null,
            uploadedAt: existingDoc.uploadedAt || now,
            updatedAt: now,
          }, { merge: true });
          created.push(docId);
        }
        return res.json({ success: true, analysis, created });
      }

      // --- SCAN-PLANT-INVOICE: upload + AI extract a Driscoll's plant invoice PDF ---
      if (action === "scan-plant-invoice" && req.method === "POST") {
        const { pdf_base64, filename } = req.body || {};
        if (!pdf_base64) return res.status(400).json({ success: false, error: "pdf_base64 requis" });
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "ANTHROPIC_API_KEY manquante" });

        // Strip data URL prefix
        const cleanBase64 = pdf_base64.replace(/^data:(application\/pdf|image\/\w+);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const safeName = (filename || `plant_invoice_${Date.now()}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "_");
        const ext = safeName.split(".").pop().toLowerCase() || "pdf";
        const isPdf = ext === "pdf";
        const isImage = ["jpg", "jpeg", "png", "webp"].includes(ext);
        if (!isPdf && !isImage) return res.status(400).json({ success: false, error: "Format non supporté (pdf/jpg/png/webp)" });

        // 1) Upload to Storage
        const storagePath = `plant_invoices/${new Date().getFullYear()}/${Date.now()}_${safeName}`;
        const bucket = admin.storage().bucket("berrygood-farms-photos");
        const contentType = isPdf ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`;
        await bucket.file(storagePath).save(buffer, { metadata: { contentType } });
        const pdfUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Try pdf-parse text first (cheap path); fallback to Claude document/image
        let pdfText = "";
        if (isPdf) {
          try {
            const p = new PDFParse({ data: buffer });
            const r = await p.getText();
            pdfText = (r && r.text) || "";
          } catch (e) { console.warn("scan-plant-invoice pdf-parse:", e.message); }
        }

        // 3) Call Claude with Driscoll's-specific prompt
        const PROMPT = `Tu analyses une facture de plants framboise/myrtille émise par Driscoll's Du Maroc SARL à Berry Good Farms SARL.

VÉRIFICATION (toutes doivent être vraies, sinon accepted=false):
- Le fournisseur (en-tête, émetteur) contient "Driscoll" dans son nom.
- Le client (destinataire) contient "Berry Good" ou "BGF" dans son nom.

STRUCTURE DES FACTURES DRISCOLL'S — TRÈS IMPORTANT:
Une facture peut contenir PLUSIEURS lignes. Chaque ligne a son propre numéro de commande (SO...) et son propre packing slip (PS-...). Exemple:

  SO17109654
  Packing slip PS-000103860:
  4 000 Corrina PL 1L  ...  MAD 159,200.00

  SO17109752
  Packing slip PS-000103967:
  4 250 Corrina PL 1L  ...  MAD 169,150.00

  Total before VAT MAD 328,350.00

Dans cet exemple il y a 2 items DIFFÉRENTS (même variété mais commandes différentes). Tu DOIS retourner les 2.

EXTRACTION — retourne UNIQUEMENT ce JSON (pas de markdown, pas de texte avant/après):
{
  "accepted": true,
  "rejection_reason": null,
  "ref": "INV17074653",
  "date": "2024-12-19",
  "echeance": "2025-03-19",
  "livraison": "2024-12-18",
  "items": [
    { "variete": "Corrina PL 1L", "qte": 4000, "montant": 159200.00, "commande": "SO17109654", "packing": "PS-000103860" },
    { "variete": "Corrina PL 1L", "qte": 4250, "montant": 169150.00, "commande": "SO17109752", "packing": "PS-000103967" }
  ],
  "total_montant": 328350.00,
  "confidence": 0.95
}

Règles strictes:
- "ref" = numéro de facture (champ "Facture N°", commence par "INV").
- Chaque item DOIT avoir son propre "commande" (SO...) et "packing" (PS-...). N'omets jamais ces champs s'ils sont visibles.
- "qte" = quantité numérique pure (4000, pas "4 000" ni "4,000").
- "montant" = montant ligne en MAD numérique (159200.00, pas "MAD 159,200.00").
- "total_montant" = "Total before VAT" ou "Total TTC" en bas de facture.
- Dates au format ISO YYYY-MM-DD.
- Si un champ est illisible, mets null.
- Vérifie que la somme des items.montant ≈ total_montant. Sinon tu as oublié des lignes — relis la facture.`;

        const Anthropic = require("@anthropic-ai/sdk");
        const aiClient = new Anthropic({ apiKey });
        const messageContent = [];
        if (pdfText && pdfText.length > 50) {
          messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
        } else if (isPdf) {
          messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 }});
        } else {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 }});
        }
        messageContent.push({ type: "text", text: PROMPT });

        let resp;
        for (const model of ["claude-sonnet-4-5", "claude-opus-4-5"]) {
          try {
            resp = await aiClient.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("scan-plant-invoice model error", model, e.message);
            if (model === "claude-opus-4-5") throw e;
          }
        }
        const aiText = resp.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis = null;
        try {
          const m = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(m ? m[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA non structurée", raw: aiText, pdfUrl });
        }
        if (!analysis || analysis.accepted === false) {
          return res.json({ success: false, analysis, error: analysis?.rejection_reason || "Facture rejetée", pdfUrl });
        }

        // 4) Classify culture from variety name (myrtille vs framboise)
        const isMyrtille = (v) => /corina|corrina|cascade|breeze|eterna|regina|rosita|biloxi|emerald|jewel|liberty|myrtille|blueberr|blue/i.test(v || "");

        // 5) Persist one doc per item — uniqueness key includes line INDEX because a
        // single invoice can have multiple rows with the same (variety, commande) but
        // different quantities (e.g. INV17095087 has 9028 Maravilla + 12960 Maravilla).
        // We wipe stale docs first to keep re-uploads idempotent.
        const now = new Date().toISOString();
        const created = [];
        const stale = await db.collection("plant_invoices").where("ref", "==", analysis.ref).get();
        for (const d of stale.docs) await d.ref.delete();

        const items = analysis.items || [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it || !it.variete) continue;
          const slug = String(it.variete).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const cmd = it.commande || analysis.commande || `idx${i}`;
          const cmdSlug = String(cmd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const docId = `${analysis.ref}__${cmdSlug}__${slug}__${i}`;
          const doc = {
            ref: analysis.ref || null,
            date: analysis.date || null,
            echeance: analysis.echeance || null,
            livraison: analysis.livraison || null,
            commande: it.commande || analysis.commande || null,
            packing: it.packing || analysis.packing || null,
            variete: it.variete,
            qte: typeof it.qte === "number" ? it.qte : (parseFloat(it.qte) || 0),
            montant: typeof it.montant === "number" ? it.montant : (parseFloat(it.montant) || 0),
            culture: isMyrtille(it.variete) ? "myrtille" : "framboise",
            pdfUrl,
            storagePath,
            confidence: analysis.confidence || null,
            invoiceTotal: analysis.total_montant || null,
            uploadedAt: now,
            updatedAt: now,
          };
          await db.collection("plant_invoices").doc(docId).set(doc, { merge: true });
          created.push(docId);
        }

        return res.json({ success: true, analysis, created, pdfUrl });
      }

      // --- STORE-EMAIL: Accept a pre-parsed email doc via POST (for local refetch scripts) ---
      // --- IMPORT-LIQUIDATION: Manually import a liquidation document ---
      if (action === "import-liquidation" && req.method === "POST") {
        const { week, period, date, fruit, fruitCode, liquidationNumber, rows, summary } = req.body;
        if (!week || !rows || !rows.length) {
          return res.status(400).json({ success: false, error: "week and rows required" });
        }
        const now = new Date().toISOString();
        const liqDocId = liquidationNumber || `LIQ-MANUAL-${fruitCode || "RASP"}-W${week}`;
        const liqDoc = {
          emailId: "manual-import",
          liquidationNumber: liquidationNumber || liqDocId,
          week: parseInt(week),
          period: period || null,
          fruit: fruit || "framboise",
          fruitCode: fruitCode || "RASP",
          subject: `LIQUIDATION Berry Good Farms SARL ${fruitCode || "RASP"} W ${week}`,
          date: date || now,
          rows,
          summary: summary || {},
          totalKg: rows.reduce((s, r) => s + (r.receiptQtyKg || 0), 0),
          base: (summary && summary.base) || 0,
          fruitAdvance: (summary && summary.fruitAdvance) || 0,
          dedRasp: (summary && summary.dedRasp) || 0,
          cropAdvance: (summary && summary.cropAdvance) || 0,
          dexAdjustment: (summary && summary.dexAdjustment) || 0,
          pkgDeduction: (summary && summary.pkgDeduction) || 0,
          netPayable: (summary && summary.netPayable) || 0,
          nbLots: rows.length,
          createdAt: now,
          updatedAt: now,
          source: "manual-import",
        };

        await db.collection("liquidations").doc(liqDocId).set(liqDoc, { merge: true });

        // Also update matching expeditions
        let updatedCount = 0;
        for (const row of rows) {
          if (!row.receiptId) continue;
          const updateData = {
            liquidationWeek: parseInt(week),
            liquidationGsNet: row.gsNet || 0,
            liquidationPriceKg: row.pricePerKg || 0,
            liquidationPfq: row.pfqScore || 0,
            status: "Liquidée",
            updatedAt: now,
          };
          const expDoc = await db.collection("expeditions").doc(row.receiptId).get();
          if (expDoc.exists) {
            await expDoc.ref.update(updateData);
            updatedCount++;
          } else {
            const expQuery = await db.collection("expeditions").where("receiptId", "==", row.receiptId).limit(1).get();
            if (!expQuery.empty) {
              await expQuery.docs[0].ref.update(updateData);
              updatedCount++;
            }
          }
        }

        return res.json({ success: true, docId: liqDocId, totalRows: rows.length, totalKg: liqDoc.totalKg, expeditionsUpdated: updatedCount });
      }

      if (action === "import-weekly-report" && req.method === "POST") {
        const report = req.body;
        if (!report || !report.week || !report.year || !report.berry) {
          return res.status(400).json({ success: false, error: "week, year, berry required" });
        }
        const berryCode = report.berry === "myrtille" ? "MYRT" : "FRAM";
        const docId = `WQR-${berryCode}-W${report.week}-${report.year}`;
        const now = new Date().toISOString();

        await db.collection("weekly_quality_reports").doc(docId).set({
          emailId: `manual-import-${docId}`,
          week: report.week,
          year: report.year,
          berry: report.berry,
          pwResults: report.pwResults || {},
          brixSummary: report.brixSummary || [],
          ourRanches: report.ourRanches || [],
          allRanchCount: report.allRanchCount || 0,
          totalVolume: report.totalVolume || 0,
          subject: report.subject || `Manual import — W${report.week}/${report.year} — ${report.berry}`,
          createdAt: now,
          updatedAt: now,
        });

        return res.json({ success: true, docId });
      }

      if (action === "store-email" && req.method === "POST") {
        const emailDoc = req.body;
        if (!emailDoc || !emailDoc.docId) {
          return res.status(400).json({ success: false, error: "docId required in body" });
        }
        const docId = emailDoc.docId;
        delete emailDoc.docId;

        // Set defaults
        emailDoc.status = "pending";
        emailDoc.receivedAt = emailDoc.receivedAt || new Date().toISOString();
        emailDoc.analysisError = null;
        emailDoc.extractedTablesRaw = [];

        // Delete first then create, so Firestore onCreate trigger fires
        const docRef = db.collection("emails").doc(docId);
        const existing = await docRef.get();
        if (existing.exists) {
          await docRef.delete();
          // Small delay to ensure delete propagates before create
          await new Promise((r) => setTimeout(r, 500));
        }
        await docRef.set(emailDoc);
        console.log(`store-email: Stored ${docId} (subject: ${(emailDoc.subject || "").slice(0, 60)})`);

        return res.json({ success: true, docId });
      }

      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
    } catch (err) {
      console.error("emailAnalysis error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// AGQ notifications — create an `alerts` doc + send transactional email
// =============================================
const FERME_TO_CHEF = {
  F1: "chef_f1",
  F5: "chef_f5",
  F2: "chef_avo",
  F3: "chef_avo",
  F4: "chef_avo",
  F6: "chef_avo",
  BAHIA: "chef_avo",
};

async function notifyNewAgqAnalyses(createdAnalyses) {
  const nodemailer = require("nodemailer");

  // Group analyses by ferme so chefs only see their own farm.
  const byFerme = {};
  for (const a of createdAnalyses) {
    const f = a.ferme || "UNKNOWN";
    if (!byFerme[f]) byFerme[f] = [];
    byFerme[f].push(a);
  }

  // Load SMTP config once.
  const smtpDoc = await db.collection("config").doc("email_smtp").get();
  const smtp = smtpDoc.exists ? smtpDoc.data() : null;
  const canSendMail = smtp && smtp.user && smtp.pass;
  const transporter = canSendMail
    ? nodemailer.createTransport({
        host: smtp.host || "smtp.gmail.com",
        port: parseInt(smtp.port) || 587,
        secure: smtp.port === "465" || smtp.port === 465,
        auth: { user: smtp.user, pass: smtp.pass },
      })
    : null;

  for (const ferme of Object.keys(byFerme)) {
    const analyses = byFerme[ferme];
    const chef = FERME_TO_CHEF[ferme];
    const targetProfiles = [];
    if (chef) targetProfiles.push(chef);
    targetProfiles.push("dt");

    const uniqueVarietes = [...new Set(analyses.map(a => a.variete).filter(Boolean))];
    const uniqueTypes = [...new Set(analyses.map(a => a.type_analyse).filter(Boolean))];
    const varietesTxt = uniqueVarietes.length ? uniqueVarietes.join(", ") : "diverses";
    const typesTxt = uniqueTypes.join(", ");

    // 1) Create the in-app alert doc (the existing /api/notifications endpoint reads it).
    const alertDoc = {
      type: "new_agq_analyses",
      severity: "info",
      message: `${analyses.length} nouvelle(s) analyse(s) AGQ disponible(s) — ${ferme} (${varietesTxt})`,
      ferme,
      varietes: uniqueVarietes,
      types: uniqueTypes,
      count: analyses.length,
      analyse_ids: analyses.map(a => a.id),
      profiles: targetProfiles,
      read: {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
      const ref = await db.collection("alerts").add(alertDoc);
      console.log(`notifyNewAgqAnalyses: alert ${ref.id} created for ${ferme} → ${targetProfiles.join(",")}`);
    } catch (e) {
      console.error("notifyNewAgqAnalyses: alert write failed:", e.message);
    }

    // 2) Resolve email addresses for target profiles and send transactional email.
    if (!canSendMail) {
      console.warn("notifyNewAgqAnalyses: SMTP not configured, skipping email");
      continue;
    }
    try {
      const usersSnap = await db.collection("users").where("profileId", "in", targetProfiles).get();
      const recipients = usersSnap.docs
        .map(d => d.data().email)
        .filter(Boolean);
      if (recipients.length === 0) {
        console.warn(`notifyNewAgqAnalyses: no user email found for profiles ${targetProfiles.join(",")}`);
        continue;
      }

      const rowsHtml = analyses.map(a => {
        const date = a.date_analyse
          ? new Date(a.date_analyse).toLocaleDateString("fr-FR")
          : "—";
        return `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${a.variete || "—"}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${a.type_analyse}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee">${date}</td>
        </tr>`;
      }).join("");

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#f9fafb">
          <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.05)">
            <h2 style="color:#7c3aed;margin:0 0 8px">🧪 Nouvelles analyses AGQ disponibles</h2>
            <p style="color:#6b7280;margin:0 0 16px;font-size:14px">
              ${analyses.length} analyse${analyses.length > 1 ? "s" : ""} vient${analyses.length > 1 ? "nent" : ""} d'être importée${analyses.length > 1 ? "s" : ""} pour la ferme <strong>${ferme}</strong> (types : ${typesTxt}).
            </p>
            <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
              <thead>
                <tr style="background:#f3f4f6">
                  <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #ddd">Variété</th>
                  <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #ddd">Type</th>
                  <th style="padding:8px 12px;text-align:left;border-bottom:1px solid #ddd">Date</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
            <div style="text-align:center;margin-top:24px">
              <a href="https://berrygood-farms-dashboard.web.app" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600">
                Ouvrir le dashboard
              </a>
            </div>
            <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;text-align:center">
              Berry Good Farms — Agronomie
            </p>
          </div>
        </div>
      `;

      await transporter.sendMail({
        from: smtp.from || smtp.user,
        to: recipients.join(","),
        subject: `🧪 Nouvelles analyses AGQ — ${ferme} (${analyses.length})`,
        html,
      });
      console.log(`notifyNewAgqAnalyses: email sent to ${recipients.join(",")} for ${ferme}`);
    } catch (e) {
      console.error("notifyNewAgqAnalyses: email send failed:", e.message);
    }
  }
}

// Exported for manual import scripts (e.g. import-receipt-blue.js, diag)
module.exports.parseLiquidationXlsx = parseLiquidationXlsx;
module.exports.parseLiquidationSummaryPdf = parseLiquidationSummaryPdf;
module.exports.notifyNewAgqAnalyses = notifyNewAgqAnalyses;
