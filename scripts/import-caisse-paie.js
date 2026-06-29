#!/usr/bin/env node
/**
 * import-caisse-paie.js
 *
 * Imports the Caisse Paie history from "CAISSE DE LA PAIE 2025-2026-DESKTOP.xlsx"
 * (Récap sheet) into Firestore via the caisseManagement bulk-import endpoint.
 *
 * Usage: node scripts/import-caisse-paie.js [--overwrite]
 */

const XLSX = require("xlsx");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const XLSX_FILE = path.join(ROOT, "CAISSE DE LA PAIE 2025-2026-DESKTOP.xlsx");
const API_URL = "https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/caisseManagement";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
  console.error("❌ ADMIN_SECRET manquant. Exportez-le avant de lancer: export ADMIN_SECRET='...'");
  process.exit(1);
}
const CAISSE_ID = "caisse_paie";
const SHEET_NAME = "Récap";
const HEADER_ROW = 5; // 0-indexed: row 6 in Excel UI

const FORCE_OVERWRITE = process.env.FORCE_OVERWRITE === "1" || process.argv.includes("--overwrite");

/**
 * Convert quinzaine label → ISO date (end of period).
 * Examples:
 *   "1Q07/2025"  → "2025-07-15"
 *   "2Q07/2025"  → "2025-07-28"
 *   "31/06/2025" → "2025-06-30"
 */
function quinzaineToISO(label) {
  const s = String(label).trim();
  // Pattern: 1Q07/2025 or 2Q07/2025
  let m = s.match(/^([12])\s*Q\s*(\d{1,2})\s*\/\s*(\d{4})$/i);
  if (m) {
    const half = m[1];
    const month = m[2].padStart(2, "0");
    const year = m[3];
    const day = half === "1" ? "15" : "28";
    return `${year}-${month}-${day}`;
  }
  // Pattern: 31/06/2025 (raw date, possibly invalid → coerce)
  m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (m) {
    const dd = parseInt(m[1]);
    const mm = parseInt(m[2]);
    const yy = m[3];
    // For "31/06" — June only has 30 days, coerce to 30
    const lastDayOfMonth = new Date(yy, mm, 0).getDate();
    const day = Math.min(dd, lastDayOfMonth);
    return `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

function quinzaineKey(label) {
  // Normalize for use in external_id (no spaces, no slashes)
  return String(label).trim().replace(/\s+/g, "").replace(/\//g, "_").replace(/[^A-Za-z0-9_]/g, "");
}

function parseRecap(wb) {
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`Sheet introuvable: ${SHEET_NAME}`);
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  const transactions = [];
  for (let i = HEADER_ROW + 1; i < data.length; i++) {
    const row = data[i];
    const label = String(row[0] || "").trim();
    if (!label) continue;
    if (label.toLowerCase().startsWith("total")) break;
    if (label.toLowerCase().includes("liste") || label.toLowerCase().includes("somme")) break;

    const date = quinzaineToISO(label);
    if (!date) {
      console.warn(`  ⚠ Quinzaine non parsable: "${label}" — skip`);
      continue;
    }

    const alimVir = parseFloat(row[2]) || 0;
    const alimOmar = parseFloat(row[3]) || 0;
    const alimRecettes = parseFloat(row[4]) || 0;
    const paye = parseFloat(row[5]) || 0;

    // Skip totally empty quinzaines
    if (alimVir === 0 && alimOmar === 0 && alimRecettes === 0 && paye === 0) continue;

    const qzKey = quinzaineKey(label);
    const codeAna = "Salaires - Paie";

    if (alimVir > 0) {
      transactions.push({
        external_id: `import_${CAISSE_ID}_${qzKey}_alim_vir`,
        caisse_id: CAISSE_ID,
        type: "alimentation",
        montant: alimVir,
        date,
        description: `Alimentation par virement — Quinzaine ${label}`,
        reference: `PAIE-VIR-${qzKey}`,
        code_analytique: codeAna,
        fournisseur: "Virement bancaire",
        _meta: { sheet: SHEET_NAME, row: i, source: "alim_virement", quinzaine: label },
      });
    }

    if (alimOmar > 0) {
      transactions.push({
        external_id: `import_${CAISSE_ID}_${qzKey}_alim_omar`,
        caisse_id: CAISSE_ID,
        type: "alimentation",
        montant: alimOmar,
        date,
        description: `Alimentation Mr Omar — Quinzaine ${label}`,
        reference: `PAIE-OMR-${qzKey}`,
        code_analytique: codeAna,
        fournisseur: "Mr Omar",
        _meta: { sheet: SHEET_NAME, row: i, source: "alim_omar", quinzaine: label },
      });
    }

    if (alimRecettes > 0) {
      transactions.push({
        external_id: `import_${CAISSE_ID}_${qzKey}_alim_rec`,
        caisse_id: CAISSE_ID,
        type: "alimentation",
        montant: alimRecettes,
        date,
        description: `Alimentation depuis caisse recettes — Quinzaine ${label}`,
        reference: `PAIE-REC-${qzKey}`,
        code_analytique: codeAna,
        fournisseur: "Caisse Recettes",
        _meta: { sheet: SHEET_NAME, row: i, source: "alim_recettes", quinzaine: label },
      });
    }

    if (paye > 0) {
      transactions.push({
        external_id: `import_${CAISSE_ID}_${qzKey}_paye`,
        caisse_id: CAISSE_ID,
        type: "depense",
        montant: paye,
        date,
        description: `Paiement salaires ouvriers — Quinzaine ${label}`,
        reference: `PAIE-OUT-${qzKey}`,
        code_analytique: codeAna,
        fournisseur: "Ouvriers (paie quinzaine)",
        _meta: { sheet: SHEET_NAME, row: i, source: "paye", quinzaine: label },
      });
    }
  }

  return transactions;
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
      },
    }, (res) => {
      let chunks = "";
      res.on("data", c => chunks += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(chunks) }); }
        catch (e) { resolve({ status: res.statusCode, body: chunks }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`[paie] Reading: ${XLSX_FILE}`);
  const wb = XLSX.readFile(XLSX_FILE);
  const transactions = parseRecap(wb);

  console.log(`[paie] ${transactions.length} transactions à envoyer`);
  // Show preview
  transactions.slice(0, 5).forEach(tx => console.log(`  - ${tx.date} | ${tx.type.padEnd(13)} | ${tx.montant.toFixed(2).padStart(12)} DH | ${tx.description}`));
  if (transactions.length > 5) console.log(`  ... +${transactions.length - 5} autres`);

  const payload = {
    action: "bulk-import-transactions",
    secret: ADMIN_SECRET,
    caisse_id: CAISSE_ID,
    transactions,
    reset_solde_initial: 0,
    force_overwrite: FORCE_OVERWRITE,
  };

  process.stdout.write("[paie] Envoi à l'API... ");
  const t0 = Date.now();
  const resp = await postJSON(`${API_URL}?action=bulk-import-transactions`, payload);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (resp.status === 200 && resp.body.success) {
    console.log(`OK en ${elapsed}s`);
    console.log("\n========== IMPORT TERMINÉ ==========");
    console.log(`Importé        : ${resp.body.imported}`);
    console.log(`Skippé         : ${resp.body.skipped}`);
    console.log(`Total en base  : ${resp.body.total_transactions}`);
    console.log(`Solde initial  : ${resp.body.solde_initial.toFixed(2)} DH`);
    console.log(`Total entrées  : +${resp.body.total_in.toFixed(2)} DH`);
    console.log(`Total sorties  : -${resp.body.total_out.toFixed(2)} DH`);
    console.log(`Solde actuel   : ${resp.body.solde_actuel.toFixed(2)} DH`);
    console.log(`\nCible Excel SOLDE PHYSIQUE: -23344.54 DH`);
  } else {
    console.error(`FAILED (status ${resp.status}):`, resp.body);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("[paie] Erreur:", err);
  process.exit(1);
});
