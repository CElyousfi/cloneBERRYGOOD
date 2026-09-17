/**
 * Quick script to reprocess today's PFQ emails.
 * Run: cd functions && node reprocess-pfq-today.js
 */
process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Inline helpers from emailService.js
const cheerio = require("cheerio");

function isDriscolsQualityReport(subject, textBody, htmlBody) {
  const combined = ((subject || "") + " " + (textBody || "") + " " + (htmlBody || "")).toLowerCase();
  return (
    /quality\s*inspection\s*report/i.test(combined) ||
    (/driscoll/i.test(combined) && /inspection|receipt|batch/i.test(combined))
  );
}

function parseDriscolsReport(htmlBody, textBody, subject) {
  const text = textBody || "";
  const html = htmlBody || "";
  const combined = text + "\n" + (html ? cheerio.load(html).text() : "");
  const result = {
    berryType: null, variety: null, item: null, itemDescription: null,
    ranch: null, ranchName: null, receiptNumber: null, batchNumber: null,
    license: null, receivedDate: null, inspectedDate: null,
    conditionDefects: [], appearanceDefects: [], brix: null,
    batchWeight: null, batchQuantity: null, sampleSize: null,
    avgFruitsPerPunnet: null, avgPunnetWeight: null, totalFruitInspected: null,
    overallResult: null,
  };

  if (subject) {
    const subjectMatch = subject.match(/\b(REJECT|FAIL|PASS)\b/i);
    if (subjectMatch) result.overallResult = subjectMatch[1].toUpperCase();
  }
  if (!result.overallResult) {
    const passFailMatch = combined.match(/^[\s]*(PASS|FAIL|REJECT)\b/im);
    if (passFailMatch) result.overallResult = passFailMatch[1].toUpperCase();
  }

  const berryMatch = combined.match(/Berry\s+[\xa0\s]*([A-Z]+)\s+Variety\s+(\S+)\s+Item\s+(\d+)/i);
  if (berryMatch) { result.berryType = berryMatch[1]; result.variety = berryMatch[2]; result.item = berryMatch[3]; }

  const itemDescMatch = combined.match(/Item\s+\d+\s*\n\s*(.+?)\s+Ranch\s+\d+/i);
  if (itemDescMatch) result.itemDescription = itemDescMatch[1].trim();

  const ranchMatch = combined.match(/Ranch\s+(\d+)/i);
  if (ranchMatch) result.ranch = ranchMatch[1];

  const ranchNameMatch = combined.match(/Ranch\s+\d+\s*\n\s*(.+?)(?:\n|$)/im);
  if (ranchNameMatch) result.ranchName = ranchNameMatch[1].replace(/[\u200e\u202c\u200f]/g, "").trim();

  const receiptMatch = combined.match(/Receipt\s+(RID[‑\-]?\d+)/i);
  if (receiptMatch) result.receiptNumber = receiptMatch[1];

  const batchMatch = combined.match(/Batch\s+Number\s+([\w\-]+)/i);
  if (batchMatch) result.batchNumber = batchMatch[1];

  const licenseMatch = combined.match(/Licen[sc]e\s+([\d]+(?:[<]br[>][\d]+|[\n\s]+[\d]+)*)/i);
  if (licenseMatch) {
    const licenseNums = licenseMatch[1].replace(/<br>/gi, " ").match(/\d+/g);
    result.license = licenseNums ? licenseNums.join(", ") : licenseMatch[1];
  }

  const receivedMatch = combined.match(/Received\s+([\d\/]+\s+[\d:]+\s*(?:GMT|UTC)?)/i);
  if (receivedMatch) result.receivedDate = receivedMatch[1].trim();
  const inspectedMatch = combined.match(/Inspected\s+([\d\/]+\s+[\d:]+\s*(?:GMT|UTC)?)/i);
  if (inspectedMatch) result.inspectedDate = inspectedMatch[1].trim();

  const brixMatch = combined.match(/Degrees?\s*Brix\s+([\d.]+)/i);
  if (brixMatch) result.brix = parseFloat(brixMatch[1]);
  else {
    const brixLineMatch = combined.match(/Degrees?\s*Brix\s*\n\s*([\d.]+)/i);
    if (brixLineMatch) result.brix = parseFloat(brixLineMatch[1]);
  }

  const batchDetailsMatch = combined.match(/Batch\s+Weight\s*\(kg\)\s+Batch\s+Quantity\s+Sample\s+Size\s+Average\s+Fruits?\s+Per\s+Punnet\s+Average\s+Punnet\s+Weight\s+Total\s+Fruit\s+Inspected\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (batchDetailsMatch) {
    result.batchWeight = parseFloat(batchDetailsMatch[1]);
    result.batchQuantity = parseFloat(batchDetailsMatch[2]);
    result.sampleSize = parseFloat(batchDetailsMatch[3]);
    result.avgFruitsPerPunnet = parseFloat(batchDetailsMatch[4]);
    result.avgPunnetWeight = parseFloat(batchDetailsMatch[5]);
    result.totalFruitInspected = parseFloat(batchDetailsMatch[6]);
  }

  if (html) {
    const $ = cheerio.load(html);
    const tables = [];
    $("table").each((_i, table) => {
      const headers = [];
      const firstRow = $(table).find("tr").first();
      const headerCells = firstRow.find("th");
      if (headerCells.length > 0) headerCells.each((_j, cell) => headers.push($(cell).text().trim()));
      else firstRow.find("td").each((_j, cell) => headers.push($(cell).text().trim()));
      const rows = [];
      $(table).find("tr").slice(1).each((_j, row) => {
        const cells = [];
        $(row).find("td").each((_k, cell) => cells.push($(cell).text().trim()));
        if (cells.length > 0) rows.push(cells);
      });
      tables.push({ headers, rows });
    });

    const conditionNames = ["decay", "mold", "wet", "leaky", "soft", "shriveled", "green"];
    const appearanceNames = ["size", "skin", "damage", "bloom", "stem", "blossom", "foreign", "bodies"];

    for (const table of tables) {
      const headersLower = table.headers.map(h => h.toLowerCase());
      const hasDefectColumns = headersLower.some(h => h.includes("berries") || h.includes("points") || h === "%");
      if (!hasDefectColumns && table.rows.length === 0) continue;

      let isCondition = false, isAppearance = false;
      for (const row of table.rows) {
        const defectName = (row[0] || "").toLowerCase();
        if (conditionNames.some(n => defectName.includes(n))) isCondition = true;
        if (appearanceNames.some(n => defectName.includes(n))) isAppearance = true;
      }

      const defects = table.rows.map(row => {
        const defect = { name: row[0] || "" };
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

function mapBerryToFrench(berryType) {
  const map = { blueberry: "Myrtille", raspberry: "Framboise", strawberry: "Fraise", blackberry: "Mûre" };
  return map[(berryType || "").toLowerCase()] || berryType || null;
}

async function main() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 1);
  const cutoffISO = cutoff.toISOString().split("T")[0];

  console.log(`Searching for PFQ emails since ${cutoffISO}...`);

  const emailsSnap = await db.collection("emails").get();
  const pfqEmails = [];
  let totalToday = 0;
  const statusCounts = {};

  emailsSnap.forEach(doc => {
    const data = doc.data();
    const emailDate = (data.date || "").slice(0, 10);
    if (emailDate < cutoffISO) return;

    totalToday++;
    const st = data.status || "unknown";
    statusCounts[st] = (statusCounts[st] || 0) + 1;

    if (data.isDailyQualityReport || data.isLiquidation) return;
    const from = (data.from || "").toLowerCase();
    const isPfq = from.includes("qainspectresults@driscolls.com") ||
      (data.isDriscolsReport === true) ||
      (/quality\s*inspection\s*report/i.test(data.subject || ""));
    if (isPfq && data.htmlBody) {
      pfqEmails.push({ id: doc.id, ...data });
    }
  });

  console.log(`\nEmails depuis ${cutoffISO}: ${totalToday}`);
  console.log("Status breakdown:", statusCounts);
  console.log(`PFQ emails trouvés: ${pfqEmails.length}`);
  console.log("");

  let created = 0;
  for (const emailData of pfqEmails) {
    const report = parseDriscolsReport(emailData.htmlBody, emailData.textBody, emailData.subject);
    if (!report || !report.receiptNumber) {
      console.log(`  SKIP ${emailData.id} — no receiptNumber (subject: "${(emailData.subject || '').slice(0, 60)}")`);
      continue;
    }

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
      pfqCondition,
      pfqApparence,
      pfqTotal: pfqCondition + pfqApparence,
      pqScore: pfqCondition + pfqApparence,
      status: report.overallResult === "PASS" ? "PFQ Reçu. Attente Brix" :
        (report.overallResult === "REJECT" ? "Rejeté" : "PFQ Reçu. Attente Brix"),
      source: "email",
      updatedAt: new Date().toISOString(),
    };

    const existing = await db.collection("expeditions").doc(expDocId).get();
    if (!existing.exists) expedition.createdAt = new Date().toISOString();

    await db.collection("expeditions").doc(expDocId).set(expedition, { merge: true });
    created++;
    console.log(`  OK ${expDocId} — ${report.berryType} ${report.variety} (${report.overallResult})`);
  }

  console.log(`\nDone: ${created} expédition(s) créées/mises à jour à partir de ${pfqEmails.length} email(s) PFQ.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
