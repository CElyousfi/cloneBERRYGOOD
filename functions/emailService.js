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
  };

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

  const varMap = { REY: "Reyna", MAR: "Maravilla", YAZ: "Yazmin Sol", COR: "Corrina", ADE: "Adelita" };

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
      if (/^(Maravilla|Reyna|RN0523|Yazmin)/i.test(trimmed)) {
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
  const ranchLineRegex = /^(20\d{4})\s+(20\d{4})\s+RASP$/;
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
  const rows = XLSX.utils.sheet_to_json(sheet);

  const results = [];
  for (const row of rows) {
    const batchId = row["Batchid"] || row["BatchId"] || row["batchid"] || null;
    if (!batchId) continue;

    results.push({
      receiptId: (row["Receipt ID"] || "").replace(/‑/g, "-"),
      berryType: row["Berry Type"] || null,
      variety: (row["Variety"] || "").replace(/[™®]/g, ""),
      productName: row["Product Name"] || null,
      inspectionResult: row["Inspection Result"] || null,
      batchId: batchId,
      quantity: parseFloat(row["Quantity"]) || 0,
      weight: parseFloat(row["Weight (KG)"]) || 0,
      brix: parseFloat(row["Brix"]) || 0,
      brixPoints: parseFloat(row["Brix Points"]) || 0,
      enrichedPqScore: parseFloat(row["Enriched PQ Score"]) || 0,
      initialPq: parseFloat(row["Initial Inspection PQ score"]) || 0,
      totalFruitInspected: parseFloat(row["Total Fruit Inspected"]) || 0,
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
// Function 1: fetchEmails (Scheduled — every 2 minutes)
// =============================================
exports.fetchEmails = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .pubsub.schedule("every 2 minutes")
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

          // Store XLSX attachments for Daily Quality Reports and Liquidations
          const attachmentsMeta = (parsed.attachments || []).map((a) => ({
            filename: a.filename || "unknown",
            contentType: a.contentType || "application/octet-stream",
            size: a.size || 0,
          }));

          let xlsxBase64 = null;
          let pdfBase64 = null;

          // Store PDF for Weekly Quality Reports
          if (isWeeklyQR && parsed.attachments && parsed.attachments.length > 0) {
            const pdfAtt = parsed.attachments.find(a => /\.pdf$/i.test(a.filename || ""));
            if (pdfAtt && pdfAtt.content) pdfBase64 = pdfAtt.content.toString("base64");
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
            isDailyQualityReport: isDQR,
            isLiquidation: isLiquidation,
            isWeeklyQualityReport: isWeeklyQR,
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
            isDQR
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
                if ((innerIsDQR || innerIsLiquidation) && innerParsed.attachments) {
                  const xa = innerParsed.attachments.find((a) => /\.(xlsx|xls)$/i.test(a.filename || ""));
                  if (xa && xa.content) innerXlsx = xa.content.toString("base64");
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
                  isDailyQualityReport: innerIsDQR,
                  isLiquidation: innerIsLiquidation,
                  isDriscolsReport: isDriscolsQualityReport(innerSubject, innerParsed.text || "", innerParsed.html || ""),
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

      let category = "other";
      let summary = "";
      const structuredData = {};
      let expeditionId = null;

      if (isDriscols) {
        // ---- Driscoll's Quality Inspection Report ----
        category = "quality_inspection";
        const report = parseDriscolsReport(emailData.htmlBody, emailData.textBody, emailData.subject);

        // Build expedition document
        const now = new Date().toISOString();
        const receiptId = report.receiptNumber || null;
        const expDocId = receiptId
          ? receiptId
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

        summary = `Rapport Qualité Driscoll's — ${report.berryType || "?"} ${report.variety || "?"} — Receipt ${receiptId || "?"} — ${report.overallResult || "?"}`;
        structuredData.driscolsReport = report;
        structuredData.expeditionId = expeditionId;

        console.log(`analyzeEmail: Created/updated expedition ${expDocId} from email ${emailId}`);
      } else if (emailData.isDailyQualityReport && emailData.xlsxBase64) {
        // ---- Driscoll's Daily Quality Report (XLSX with Brix Points) ----
        category = "daily_quality_report";

        const xlsxBuffer = Buffer.from(emailData.xlsxBase64, "base64");
        const brixRows = parseDailyQualityReportXlsx(xlsxBuffer);

        let updatedCount = 0;
        for (const row of brixRows) {
          // Match by batchNumber in existing expeditions
          const expQuery = await db.collection("expeditions")
            .where("batchNumber", "==", row.batchId)
            .limit(1)
            .get();

          if (!expQuery.empty) {
            const expDoc = expQuery.docs[0];
            const expData = expDoc.data();
            const isReject = (expData.overallResult || "").toUpperCase() === "REJECT";
            const pfqTotalWithBrix = (expData.pfqCondition || 0) + (expData.pfqApparence || 0) + (row.brixPoints || 0);
            const updateData = {
              pfqBrix: row.brixPoints,
              brixFromDQR: row.brix,
              enrichedPqScore: row.enrichedPqScore,
              pfqTotal: pfqTotalWithBrix,
              pqScore: pfqTotalWithBrix,
              updatedAt: new Date().toISOString(),
            };
            // REJECT expeditions keep their status — don't overwrite with "PFQ Brix reçu"
            if (!isReject) {
              updateData.status = "PFQ Brix reçu";
            }
            await expDoc.ref.update(updateData);
            updatedCount++;
            console.log(`analyzeEmail DQR: Updated expedition ${expDoc.id} with brixPoints=${row.brixPoints}, pfqTotal=${pfqTotalWithBrix}${isReject ? ' (REJECT — status preserved)' : ''}`);
          } else if (row.receiptId) {
            // Try matching by receiptId
            const receiptId = row.receiptId;
            const expByReceipt = await db.collection("expeditions").doc(receiptId).get();
            if (expByReceipt.exists) {
              const expData = expByReceipt.data();
              const isReject = (expData.overallResult || "").toUpperCase() === "REJECT";
              const pfqTotalWithBrix = (expData.pfqCondition || 0) + (expData.pfqApparence || 0) + (row.brixPoints || 0);
              const updateData = {
                pfqBrix: row.brixPoints,
                brixFromDQR: row.brix,
                enrichedPqScore: row.enrichedPqScore,
                pfqTotal: pfqTotalWithBrix,
                pqScore: pfqTotalWithBrix,
                updatedAt: new Date().toISOString(),
              };
              if (!isReject) {
                updateData.status = "PFQ Brix reçu";
              }
              await expByReceipt.ref.update(updateData);
              updatedCount++;
              console.log(`analyzeEmail DQR: Updated expedition ${receiptId} (by receipt) with brixPoints=${row.brixPoints}, pfqTotal=${pfqTotalWithBrix}${isReject ? ' (REJECT — status preserved)' : ''}`);
            } else {
              console.warn(`analyzeEmail DQR: No expedition found for batchId=${row.batchId} or receiptId=${receiptId}`);
            }
          } else {
            console.warn(`analyzeEmail DQR: No expedition found for batchId=${row.batchId} (no receiptId)`);
          }
        }

        summary = `Daily Quality Report — ${brixRows.length} lots, ${updatedCount} expéditions mises à jour avec PFQ Brix`;
        structuredData.brixRows = brixRows;
        structuredData.updatedExpeditions = updatedCount;

        // Clean up the large XLSX content from the email doc to save storage
        await emailRef.update({ xlsxBase64: admin.firestore.FieldValue.delete() });

        console.log(`analyzeEmail DQR: ${emailId} → ${brixRows.length} rows extracted, ${updatedCount} expeditions updated`);

        // ---- VOLET 3: Vérification bons Export J-1 vs expéditions ----
        try {
          // Determine the date the DQR covers (J-1 from the email date)
          const emailDate = emailData.date ? new Date(emailData.date) : new Date();
          const veille = new Date(emailDate);
          veille.setDate(veille.getDate() - 1);
          const veilleISO = veille.toISOString().split('T')[0]; // YYYY-MM-DD

          // Fetch all bons d'apport Export for that date
          const bonsSnap = await db.collection("bons_apport")
            .where("date", "==", veilleISO)
            .get();

          const bonsExport = [];
          bonsSnap.forEach(doc => {
            const d = doc.data();
            // Only Export bons (exclude Marché Local)
            if ((d.typeVente || '').toLowerCase() !== 'marché local' && (d.typeVente || '').toLowerCase() !== 'marche local') {
              bonsExport.push({ id: doc.id, ...d });
            }
          });

          if (bonsExport.length > 0) {
            // Get all expeditions for that date
            const expsSnap = await db.collection("expeditions")
              .where("dateISO", "==", veilleISO)
              .get();

            const existingExps = [];
            expsSnap.forEach(doc => existingExps.push({ id: doc.id, ...doc.data() }));

            // Normalize variety for matching
            const normV = (v) => (v || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');

            // Match each bon to an expedition (strict: same day, same variety, quantity ±2%)
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

            // Auto-create provisional expeditions for unmatched bons
            let autoCreated = 0;
            for (const bon of unmatchedBons) {
              const provId = `PROV-${bon.bonApport || bon.id}-${Date.now()}`;
              const ranch = (bon.blocFerme || '').toUpperCase().includes('F1') ? '200742' : '200876';
              await db.collection("expeditions").doc(provId).set({
                receiptId: null,
                variety: bon.blocVariete || '',
                batchWeight: parseFloat(bon.poidsLot) || 0,
                dateISO: veilleISO,
                ranch: ranch,
                status: 'Provisoire — En attente inspection',
                source: 'auto-created',
                linkedBon: bon.bonApport || bon.id,
                overallResult: 'PENDING',
                createdAt: new Date().toISOString(),
              });
              autoCreated++;
            }

            // Generate alert if there are unmatched bons
            if (unmatchedBons.length > 0) {
              const bonsList = unmatchedBons.map(b => `${b.bonApport} (${b.blocVariete}, ${b.poidsLot}kg)`).join(', ');
              await db.collection("alerts").add({
                type: 'expedition_manquante',
                message: `${unmatchedBons.length} bon(s) Export du ${veilleISO} sans expédition Driscoll's correspondante. Expéditions provisoires créées. Bons: ${bonsList}`,
                severity: 'warning',
                profiles: ['chef_f1', 'chef_f5', 'qualite', 'dg'],
                read: {},
                createdAt: new Date().toISOString(),
                date: veilleISO,
                unmatchedBons: unmatchedBons.map(b => ({ id: b.id, bonApport: b.bonApport, variete: b.blocVariete, poids: b.poidsLot })),
                autoCreatedCount: autoCreated,
              });
              console.log(`analyzeEmail DQR: ${unmatchedBons.length} unmatched bons for ${veilleISO}, ${autoCreated} provisional expeditions created, alert generated`);
            } else {
              console.log(`analyzeEmail DQR: All ${bonsExport.length} bons Export for ${veilleISO} matched to expeditions`);
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

        // Extract extra info from email text
        const htmlBody = emailData.htmlBody || "";
        const textBody = emailData.textBody || "";
        const combined = htmlBody + " " + textBody;
        const apivMatch = (textBody || "").match(/(APIV-\d+)/i);
        const periodMatch = (textBody || "").match(/(\d{2}\/\d{2}\/\d{2,4})\s+(\d{2}\/\d{2}\/\d{2,4})/);
        const fruitAdvanceMatch = combined.match(/fruit\s*advance[^0-9]*([\d,]+\.?\d*)/i);
        const netPayableMatch = combined.match(/net\s*payable[^0-9]*([\d,]+\.?\d*)/i);

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
            const textWeek = (textBody || "").match(/semaine\s*(\d+)/i);
            if (textWeek) liq.week = parseInt(textWeek[1]);
          }
          if (!liq.liquidationNumber && apivMatch) liq.liquidationNumber = apivMatch[1];
          if (!liq.period && periodMatch) liq.period = `${periodMatch[1]} - ${periodMatch[2]}`;
          if (fruitAdvanceMatch) liq.summary.fruitAdvance = parseFloat(fruitAdvanceMatch[1].replace(/,/g, "")) || 0;
          if (netPayableMatch) liq.summary.netPayable = parseFloat(netPayableMatch[1].replace(/,/g, "")) || 0;

          const liqDocId = liq.liquidationNumber || `LIQ-${fruitCode}-W${liq.week || "?"}-${emailId.slice(0, 20)}`;
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
            cropAdvance: liq.summary.cropAdvance || 0,
            dexAdjustment: liq.summary.dexAdjustment || 0,
            pkgDeduction: liq.summary.pkgDeduction || 0,
            netPayable: liq.summary.netPayable || 0,
            nbLots: liq.rows.length,
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

        // Clean up XLSX from email doc
        await emailRef.update({ xlsxBase64: admin.firestore.FieldValue.delete() });

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
        const limit = parseInt(req.query.limit || "100");
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
        const expeditions = snap.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));

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
                  isLiquidation: true,
                  status: "pending",
                  analysisError: null,
                  extractedTablesRaw: [],
                });

                processed++;
                console.log(`refetch-liquidation: Stored liquidation "${subject}" attachment ${idx + 1}/${xlsAttachments.length}: ${xlsAttachment.filename} (${xlsAttachment.size} bytes)`);
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
