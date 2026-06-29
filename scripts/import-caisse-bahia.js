#!/usr/bin/env node
/**
 * import-caisse-bahia.js
 *
 * Imports the Bahia depenses caisse from "La caisses des depenses BAHIA.xlsm"
 * (sheet "Les dépenses") into Firestore via the caisseManagement bulk-import endpoint.
 *
 * Creates a new caisse `caisse_depenses_bahia` if it doesn't exist.
 *
 * Usage: node scripts/import-caisse-bahia.js [--overwrite]
 */

const XLSX = require("xlsx");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const XLSX_FILE = path.join(ROOT, "La caisses des depenses BAHIA.xlsm");
const API_URL = "https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/caisseManagement";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
if (!ADMIN_SECRET) {
  console.error("❌ ADMIN_SECRET manquant. Exportez-le avant de lancer: export ADMIN_SECRET='...'");
  process.exit(1);
}
const CAISSE_ID = "caisse_depenses_bahia";
const SHEET_NAME = "Les dépenses";
const HEADER_ROW = 5;
const FORCE_OVERWRITE = process.env.FORCE_OVERWRITE === "1" || process.argv.includes("--overwrite");

function excelSerialToISO(serial) {
  if (!serial && serial !== 0) return null;
  if (typeof serial === "string") {
    const d = new Date(serial);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return null;
  }
  const parts = XLSX.SSF.parse_date_code(serial);
  if (!parts) return null;
  const m = String(parts.m).padStart(2, "0");
  const d = String(parts.d).padStart(2, "0");
  return `${parts.y}-${m}-${d}`;
}

function detectColumns(headerRow) {
  const cols = { date: 2, desc: 4, debit: 5, credit: 6, solde: 7, fournisseur: 8, numPiece: 9, numFacture: 10, ana1: 11, ana2: 12 };
  for (let j = 0; j < headerRow.length; j++) {
    const cell = String(headerRow[j] || "").toLowerCase().replace(/\s|\r|\n/g, "");
    if (cell.includes("désignation") || cell.includes("designation")) cols.desc = j;
    else if (cell.includes("débit") || cell === "montantdebit" || cell.includes("debit")) cols.debit = j;
    else if (cell.includes("crédit") || cell.includes("credit")) cols.credit = j;
    else if (cell === "solde") cols.solde = j;
    else if (cell.includes("fournisseur") || cell.includes("beneficiaire")) cols.fournisseur = j;
    else if (cell.includes("piéce") || cell.includes("piece")) cols.numPiece = j;
    else if (cell.includes("facture")) cols.numFacture = j;
    else if (cell.includes("analytique1") || cell.includes("codeanalytique1")) cols.ana1 = j;
    else if (cell.includes("analytique2") || cell.includes("codeanalytique2")) cols.ana2 = j;
  }
  return cols;
}

function parseSheet(wb) {
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) throw new Error(`Sheet introuvable: ${SHEET_NAME}`);
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const cols = detectColumns(data[HEADER_ROW] || []);

  const transactions = [];
  for (let i = HEADER_ROW + 1; i < data.length; i++) {
    const row = data[i];
    const dateSerial = row[cols.date];
    const debit = parseFloat(row[cols.debit]) || 0;
    const credit = parseFloat(row[cols.credit]) || 0;

    if (!dateSerial || (debit === 0 && credit === 0)) continue;

    const dateISO = excelSerialToISO(dateSerial);
    if (!dateISO) continue;

    const isAlimentation = debit > 0;
    const montant = isAlimentation ? debit : credit;
    if (montant <= 0) continue;

    const variete = String(row[0] || "").trim();
    const ferme = String(row[1] || "").trim();
    const description = String(row[cols.desc] || "").trim();
    const fournisseur = String(row[cols.fournisseur] || "").trim();
    const numPiece = String(row[cols.numPiece] || "").trim();
    const numFacture = String(row[cols.numFacture] || "").trim();
    const ana1 = String(row[cols.ana1] || "").trim();
    const ana2 = String(row[cols.ana2] || "").trim();
    const codeAnalytique = [ana1, ana2].filter(Boolean).join(" - ") || [variete, ferme].filter(Boolean).join(" - ");

    transactions.push({
      external_id: `import_${CAISSE_ID}_les_depenses_r${i}`,
      caisse_id: CAISSE_ID,
      type: isAlimentation ? "alimentation" : "depense",
      montant,
      date: dateISO,
      description,
      reference: numPiece || numFacture || `IMPORT-BAHIA-${i}`,
      code_analytique: codeAnalytique,
      fournisseur,
      _meta: { sheet: SHEET_NAME, row: i, debit, credit, variete, ferme, ana1, ana2 },
    });
  }
  return transactions;
}

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: 443,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
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
  console.log(`[bahia] Reading: ${XLSX_FILE}`);
  const wb = XLSX.readFile(XLSX_FILE);
  const transactions = parseSheet(wb);

  console.log(`[bahia] ${transactions.length} transactions à envoyer`);
  const sumAlim = transactions.filter(t => t.type === "alimentation").reduce((s, t) => s + t.montant, 0);
  const sumDep = transactions.filter(t => t.type === "depense").reduce((s, t) => s + t.montant, 0);
  console.log(`[bahia] Total alimentations: ${sumAlim.toFixed(2)} DH`);
  console.log(`[bahia] Total dépenses     : ${sumDep.toFixed(2)} DH`);
  console.log(`[bahia] Solde calculé      : ${(sumAlim - sumDep).toFixed(2)} DH`);

  const CHUNK_SIZE = 500;
  let totalImported = 0, totalSkipped = 0, lastResult = null;

  for (let i = 0; i < transactions.length; i += CHUNK_SIZE) {
    const chunk = transactions.slice(i, i + CHUNK_SIZE);
    const isFirstChunk = i === 0;
    const payload = {
      action: "bulk-import-transactions",
      secret: ADMIN_SECRET,
      caisse_id: CAISSE_ID,
      transactions: chunk,
      force_overwrite: FORCE_OVERWRITE,
    };
    if (isFirstChunk) {
      payload.reset_solde_initial = 0;
      payload.caisse_def = {
        nom: "Caisse Dépenses Bahia",
        description: "Caisse des dépenses pour la ferme Bahia (Avocatier B6, B7)",
      };
    }

    process.stdout.write(`[bahia] Chunk ${Math.floor(i / CHUNK_SIZE) + 1} (${chunk.length} tx)... `);
    const t0 = Date.now();
    const resp = await postJSON(`${API_URL}?action=bulk-import-transactions`, payload);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (resp.status === 200 && resp.body.success) {
      console.log(`OK en ${elapsed}s — imported=${resp.body.imported}, skipped=${resp.body.skipped}`);
      totalImported += resp.body.imported;
      totalSkipped += resp.body.skipped;
      lastResult = resp.body;
    } else {
      console.error(`FAILED (status ${resp.status}):`, resp.body);
      process.exit(1);
    }
  }

  console.log("\n========== IMPORT TERMINÉ ==========");
  console.log(`Importé        : ${totalImported}`);
  console.log(`Skippé         : ${totalSkipped}`);
  if (lastResult) {
    console.log(`Total en base  : ${lastResult.total_transactions}`);
    console.log(`Solde initial  : ${lastResult.solde_initial.toFixed(2)} DH`);
    console.log(`Total entrées  : +${lastResult.total_in.toFixed(2)} DH`);
    console.log(`Total sorties  : -${lastResult.total_out.toFixed(2)} DH`);
    console.log(`Solde actuel   : ${lastResult.solde_actuel.toFixed(2)} DH`);
  }
}

main().catch(err => {
  console.error("[bahia] Erreur:", err);
  process.exit(1);
});
