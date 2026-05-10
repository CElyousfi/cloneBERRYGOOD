/**
 * import-excel-kilos.js
 *
 * One-shot script to import harvest kilos from BEE ONE Excel file
 * into Firestore sql_mirror_pointage documents.
 *
 * Uses Firebase REST API with refresh token from firebase-tools config.
 *
 * Usage: cd functions && node import-excel-kilos.js
 */

const XLSX = require("xlsx");
const path = require("path");
const https = require("https");
const fs = require("fs");

const DAYS_TO_FIX = [16, 17, 18, 19];
const MONTH = "2026-03";
const PROJECT = "berrygood-farms-dashboard";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const EXCEL_PATH = path.join(__dirname, "..", "Rendement Récolte.xlsx");

// --- HTTP helpers ---
function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        else resolve(JSON.parse(body));
      });
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getAccessToken() {
  const configPath = path.join(process.env.HOME, ".config/configstore/firebase-tools.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const rt = config.tokens.refresh_token;
  const params = new URLSearchParams({
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: rt,
    grant_type: "refresh_token",
  });
  const result = await httpRequest("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  return result.access_token;
}

async function firestoreGet(token, docPath) {
  return httpRequest(`${BASE}/${docPath}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function firestorePatch(token, docPath, fields) {
  const fieldPaths = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join("&");
  const url = `${BASE}/${docPath}?${fieldPaths}`;
  return httpRequest(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
}

// --- Main ---
async function main() {
  console.log("=== Import Excel Kilos → Firestore ===\n");

  const token = await getAccessToken();
  console.log("Auth OK\n");

  // 1. Read Excel
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const excelData = {}; // "MAT|day" -> kg
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const mat = (row[0] || "").toString().trim();
    if (!mat) continue;
    for (let dayIdx = 0; dayIdx < 15; dayIdx++) {
      const day = 16 + dayIdx;
      if (!DAYS_TO_FIX.includes(day)) continue;
      const kg = parseFloat(row[3 + dayIdx]) || 0;
      if (kg > 0) excelData[`${mat}|${day}`] = kg;
    }
  }
  console.log(`Excel: ${Object.keys(excelData).length} worker-day entries to import\n`);

  // 2. Patch each day
  for (const day of DAYS_TO_FIX) {
    const dateStr = `${MONTH}-${String(day).padStart(2, "0")}`;
    console.log(`--- ${dateStr} ---`);

    const doc = await firestoreGet(token, `sql_mirror_pointage/${dateStr}`);
    const rowsArray = doc.fields.rows.arrayValue.values;
    let patchedCount = 0;

    for (const rowVal of rowsArray) {
      const f = rowVal.mapValue.fields;
      const op = f.Operation_Famille?.stringValue || "";
      if (!op.includes("8. Récolte") && !op.toLowerCase().includes("colte")) continue;

      const mat = (f.Personnel_Matricule?.stringValue || "").trim();
      const key = `${mat}|${day}`;
      const excelKg = excelData[key];
      if (!excelKg || excelKg <= 0) continue;

      const currentQu = parseFloat(f.Quantite_unite?.doubleValue || f.Quantite_unite?.integerValue || 0);
      const targetQu = Math.round((excelKg / 1.5) * 10000) / 10000;

      if (Math.abs(currentQu - targetQu) > 0.01) {
        // Update in place
        if (f.Quantite_unite?.integerValue !== undefined) {
          delete f.Quantite_unite.integerValue;
        }
        f.Quantite_unite = { doubleValue: targetQu };
        patchedCount++;
      }
    }

    // Write back with manualOverride flag
    await firestorePatch(token, `sql_mirror_pointage/${dateStr}`, {
      rows: doc.fields.rows,
      rowCount: { integerValue: String(rowsArray.length) },
      manualOverride: { booleanValue: true },
      syncedAt: { timestampValue: new Date().toISOString() },
    });

    console.log(`  Patched ${patchedCount} rows`);
  }

  console.log("\n=== Done ===");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
