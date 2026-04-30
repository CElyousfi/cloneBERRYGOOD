/**
 * Import telecom bills into Firestore via the /api/telecom Cloud Function
 * Usage: TELECOM_IMPORT_KEY=xxx node scripts/import-telecom-to-firestore.js
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const API = "https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/telecom";
const DATA_DIR = path.join(__dirname, "..", "data");
const CHUNK_SIZE = 200;

const API_KEY = process.env.TELECOM_IMPORT_KEY;
if (!API_KEY) {
  console.error("❌ TELECOM_IMPORT_KEY manquant. Définissez la variable d'environnement.");
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
  // Find the most recent telecom bills JSON
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith("telecom-bills-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    console.error("❌ Aucun fichier telecom-bills-*.json trouvé dans data/");
    process.exit(1);
  }

  const latestFile = path.join(DATA_DIR, files[0]);
  console.log(`📂 Lecture de: ${latestFile}`);
  const rawData = JSON.parse(fs.readFileSync(latestFile, "utf-8"));
  console.log(`   ${rawData.length} factures brutes`);

  // Upload in chunks via API
  let totalImported = 0;
  for (let i = 0; i < rawData.length; i += CHUNK_SIZE) {
    const chunk = rawData.slice(i, i + CHUNK_SIZE);
    console.log(`   📤 Envoi chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(rawData.length / CHUNK_SIZE)} (${chunk.length} factures)...`);
    const result = await post({ action: "import", bills: chunk });
    if (result.success) {
      totalImported += result.imported;
      console.log(`   ✅ ${result.imported} importées`);
    } else {
      console.error(`   ❌ Erreur: ${result.error}`);
      process.exitCode = 1;
    }
  }

  console.log(`\n✅ Import terminé: ${totalImported} factures importées dans Firestore`);
  if (totalImported === 0) process.exitCode = 1;
}

importData().catch(err => {
  console.error("❌ Erreur:", err);
  process.exit(1);
});
