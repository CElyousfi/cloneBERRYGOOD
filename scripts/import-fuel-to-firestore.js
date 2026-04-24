/**
 * Import fuel transactions into Firestore via the /api/fuel Cloud Function
 * Usage: FUEL_IMPORT_KEY=xxx node scripts/import-fuel-to-firestore.js
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const API = "https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/fuel";
const DATA_DIR = path.join(__dirname, "..", "data");
const CHUNK_SIZE = 200;

const API_KEY = process.env.FUEL_IMPORT_KEY;
if (!API_KEY) {
  console.error("❌ FUEL_IMPORT_KEY manquant. Définissez la variable d'environnement.");
  process.exit(1);
}

function post(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API);
    const options = {
      hostname: url.hostname,
      path: url.pathname + "?action=import",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "x-api-key": API_KEY,
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", d => raw += d);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch { reject(new Error("Parse error: " + raw)); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function importData() {
  // Find the most recent fuel transactions JSON
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith("fuel-transactions-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error("❌ Aucun fichier fuel-transactions-*.json trouvé dans data/");
    process.exit(1);
  }

  const latestFile = path.join(DATA_DIR, files[0]);
  console.log(`📂 Lecture de: ${latestFile}`);
  const rawData = JSON.parse(fs.readFileSync(latestFile, "utf-8"));
  console.log(`   ${rawData.length} transactions brutes`);

  // Upload in chunks via API
  let totalImported = 0;
  for (let i = 0; i < rawData.length; i += CHUNK_SIZE) {
    const chunk = rawData.slice(i, i + CHUNK_SIZE);
    console.log(`   📤 Envoi chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(rawData.length / CHUNK_SIZE)} (${chunk.length} transactions)...`);
    const result = await post({ action: "import", transactions: chunk });
    if (result.success) {
      totalImported += result.imported;
      console.log(`   ✅ ${result.imported} importées`);
    } else {
      console.error(`   ❌ Erreur: ${result.error}`);
      process.exitCode = 1;
    }
  }

  console.log(`\n✅ Import terminé: ${totalImported} transactions importées dans Firestore`);
  if (totalImported === 0) process.exitCode = 1;
}

importData().catch(err => {
  console.error("❌ Erreur:", err);
  process.exit(1);
});
