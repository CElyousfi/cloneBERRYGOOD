/* Extrait de emailService.js — blocs repris VERBATIM.
   Seul ce preambule de require est ajoute. */
'use strict';
const { XLSX, admin, db } = require("./emailService.part1");


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
module.exports = { ALLOWED_ORIGINS, FERME_TO_CHEF, notifyNewAgqAnalyses, parseDailyQualityReportXlsx, setCors };
