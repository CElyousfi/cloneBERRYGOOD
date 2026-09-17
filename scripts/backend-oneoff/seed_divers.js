const https = require("https");
const { execSync } = require("child_process");

// Get access token from gcloud
let accessToken;
try {
  accessToken = execSync("gcloud auth print-access-token 2>/dev/null", { encoding: "utf8" }).trim();
} catch(e) {
  // Fallback: extract from firebase CLI config
  const fs = require("fs");
  const path = require("path");
  const configPath = path.join(require("os").homedir(), ".config", "configstore", "firebase-tools.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const refreshToken = config.tokens.refresh_token;
  const clientId = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
  const clientSecret = "j9iVZfS8kkCEFUPaAeJV0sAi";
  
  const tokenBody = new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" }).toString();
  const tokenRes = execSync(`curl -s -X POST "https://oauth2.googleapis.com/token" -H "Content-Type: application/x-www-form-urlencoded" -d '${tokenBody}'`, { encoding: "utf8" });
  accessToken = JSON.parse(tokenRes).access_token;
}

if (!accessToken) { console.error("No token"); process.exit(1); }
console.log("Token obtenu (" + accessToken.slice(0,10) + "...)");

const projectId = "berrygood-farms-dashboard";
const items = [
  { beneficiaire: "KADOUR DEBAZ TRAC", fonction: "TRACTEUR", tache: "NETTIYAGE F5", prixUnitaire: 450, unite: "JOUR" },
  { beneficiaire: "REFISSA TRAC", fonction: "TRACTEUR", tache: "Traitement Avocat", prixUnitaire: 450, unite: "JOUR" },
  { beneficiaire: "EL MESBAHI AHMED", fonction: "TRS", tache: "TRS OUVRIRE F6", prixUnitaire: 400, unite: "JOUR" },
  { beneficiaire: "MOHAMED JCB", fonction: "JCB", tache: "CHAREGEMENT", prixUnitaire: 250, unite: "HEURE" },
  { beneficiaire: "EL MAJDOUBI MUSTAPHA", fonction: "TRACTEUR", tache: "NETTIYAGE F5", prixUnitaire: 450, unite: "VOYAGES" },
  { beneficiaire: "HAMAMOU HAMZA", fonction: "TRACTEUR", tache: "Réparation de la route F1", prixUnitaire: 400, unite: "JOUR" },
  { beneficiaire: "RAGRAGUI BRAHIM", fonction: "TRS", tache: "TRS D'emballage F1", prixUnitaire: 100, unite: "VOYAGES" },
  { beneficiaire: "KRIDECHE MOHAMED", fonction: "TRS", tache: "TRS D'emballage F5", prixUnitaire: 200, unite: "VOYAGES" },
  { beneficiaire: "RAGRAGUI BRAHIM", fonction: "TRS", tache: "TRS D'emballage F5", prixUnitaire: 100, unite: "VOYAGES" },
  { beneficiaire: "EL SEGHIRE BACHIR", fonction: "TRS", tache: "TRS D'emballage F5", prixUnitaire: 150, unite: "VOYAGES" },
  { beneficiaire: "KRIDECHE MOHAMED", fonction: "TRS FRUITS", tache: "TRS FRUITS", prixUnitaire: 500, unite: "VOYAGES" },
];

async function createDoc(item) {
  const fields = {};
  for (const [k, v] of Object.entries({...item, active: true, createdAt: Date.now(), updatedAt: Date.now()})) {
    if (typeof v === "string") fields[k] = { stringValue: v };
    else if (typeof v === "number") fields[k] = { integerValue: String(v) };
    else if (typeof v === "boolean") fields[k] = { booleanValue: v };
  }
  const body = JSON.stringify({ fields });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "firestore.googleapis.com",
      path: `/v1/projects/${projectId}/databases/(default)/documents/pointage_divers_config`,
      method: "POST",
      headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = ""; res.on("data", d => data += d); res.on("end", () => resolve({ status: res.statusCode, data }));
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

(async () => {
  for (const item of items) {
    const res = await createDoc(item);
    if (res.status === 200) console.log("OK:", item.beneficiaire, "-", item.tache);
    else console.error("ERR " + res.status + ":", item.beneficiaire, JSON.parse(res.data).error?.message?.slice(0,80));
  }
  console.log("Terminé !");
})().catch(e => { console.error(e); process.exit(1); });
