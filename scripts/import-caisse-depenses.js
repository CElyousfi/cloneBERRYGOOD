#!/usr/bin/env node
/**
 * import-caisse-depenses.js
 *
 * Imports historical transactions from "Caisse de dépenses 2025-2026.xlsx"
 * into Firestore via the caisseManagement Cloud Function bulk-import endpoint.
 *
 * Usage: node scripts/import-caisse-depenses.js
 *
 * Re-runnable (idempotent): each row gets a deterministic external_id,
 * existing rows are skipped on the server side.
 */

const XLSX = require("xlsx");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const XLSX_FILE = path.join(ROOT, "Caisse de dépenses 2025-2026.xlsx");
const API_URL = "https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/caisseManagement";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "bgf-admin-2026";
const CAISSE_ID = "caisse_depenses";

// Sheets to import (Jan 2025 → Apr 2026)
const SHEETS_TO_IMPORT = [
  "JANVIER 2025 ACHRAF",
  "FEVRIER 2025 ACHRAF",
  "MARS 2025 ACHRAF",
  "AVRIL 2025 ACHRAF",
  "MAI 2025 ACHRAF",
  "JUIN 2025 ACHRAF",
  "JUILLET 2025 ACHRAF",
  "AOUT 2025 ACHRAF",
  "SEPTEMBER",
  "OCTOBRE ",
  "NOVEMBER",
  "DECEMBRE ",
  "JANVIER 2026",
  "Fevriér 2026",
  "Mars 2026",
  "AVRIL ",
];

const HEADER_ROW = 6; // 0-indexed: row 7 in Excel UI
const FORCE_OVERWRITE = process.env.FORCE_OVERWRITE === "1" || process.argv.includes("--overwrite");

// Solde initial pour la première feuille (Janvier 2025) : lu depuis cellule C3
const INITIAL_SOLDE_JAN_2025 = 24728.19;

function excelSerialToISO(serial) {
  if (!serial && serial !== 0) return null;
  // Sometimes the date is already a string
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

function sanitizeSheetName(name) {
  return name.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]/g, "");
}

function detectColumns(headerRow) {
  // Default to standard layout
  const cols = { debit: 5, credit: 6, solde: 7, fournisseur: 8, numPiece: 9, numFacture: 11 };
  for (let j = 0; j < headerRow.length; j++) {
    const cell = String(headerRow[j] || "").toLowerCase().replace(/\s|\r|\n/g, "");
    if (cell.includes("débit") || cell === "montantdebit" || cell.includes("debit")) cols.debit = j;
    else if (cell.includes("crédit") || cell.includes("credit")) cols.credit = j;
    else if (cell === "solde") cols.solde = j;
    else if (cell.includes("fournisseur") || cell.includes("beneficiaire")) cols.fournisseur = j;
    else if (cell.includes("piéce") || cell.includes("piece")) cols.numPiece = j;
    else if (cell.includes("facture")) cols.numFacture = j;
  }
  return cols;
}

function parseSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.error(`  ! Sheet not found: ${sheetName}`);
    return [];
  }
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const transactions = [];
  const sheetKey = sanitizeSheetName(sheetName);
  const cols = detectColumns(data[HEADER_ROW] || []);

  for (let i = HEADER_ROW + 1; i < data.length; i++) {
    const row = data[i];
    const dateSerial = row[2];
    const debit = parseFloat(row[cols.debit]) || 0;
    const credit = parseFloat(row[cols.credit]) || 0;

    // Skip empty rows
    if (!dateSerial || (debit === 0 && credit === 0)) continue;

    const dateISO = excelSerialToISO(dateSerial);
    if (!dateISO) continue;

    const isAlimentation = debit > 0;
    const montant = isAlimentation ? debit : credit;
    if (montant <= 0) continue;

    const variete = String(row[0] || "").trim();
    const ferme = String(row[1] || "").trim();
    const description = String(row[3] || "").trim();
    const fournisseur = String(row[cols.fournisseur] || "").trim();
    const numPiece = String(row[cols.numPiece] || "").trim();
    const numFacture = String(row[cols.numFacture] || "").trim();
    const codeAnalytique = [variete, ferme].filter(Boolean).join(" - ");

    transactions.push({
      external_id: `import_${CAISSE_ID}_${sheetKey}_r${i}`,
      caisse_id: CAISSE_ID,
      type: isAlimentation ? "alimentation" : "depense",
      montant,
      date: dateISO,
      description,
      reference: numPiece || numFacture || `IMPORT-${sheetKey}-${i}`,
      code_analytique: codeAnalytique,
      fournisseur,
      _meta: { sheet: sheetName, row: i, debit, credit },
    });
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
        try {
          resolve({ status: res.statusCode, body: JSON.parse(chunks) });
        } catch (e) {
          resolve({ status: res.statusCode, body: chunks });
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log(`[import] Reading: ${XLSX_FILE}`);
  const wb = XLSX.readFile(XLSX_FILE);

  // Collect all transactions
  const allTransactions = [];
  for (const sheetName of SHEETS_TO_IMPORT) {
    const tx = parseSheet(wb, sheetName);
    console.log(`  - ${sheetName.padEnd(28)} → ${tx.length} transactions`);
    allTransactions.push(...tx);
  }
  console.log(`[import] Total transactions to send: ${allTransactions.length}`);

  if (allTransactions.length === 0) {
    console.log("[import] No transactions found. Aborting.");
    return;
  }

  // Send in chunks to avoid hitting timeout/payload limits
  const CHUNK_SIZE = 500;
  let totalImported = 0, totalSkipped = 0;
  let lastResult = null;

  for (let i = 0; i < allTransactions.length; i += CHUNK_SIZE) {
    const chunk = allTransactions.slice(i, i + CHUNK_SIZE);
    const isFirstChunk = i === 0;
    const payload = {
      action: "bulk-import-transactions",
      secret: ADMIN_SECRET,
      caisse_id: CAISSE_ID,
      transactions: chunk,
      force_overwrite: FORCE_OVERWRITE,
    };
    // First chunk also resets the solde initial
    if (isFirstChunk) payload.reset_solde_initial = INITIAL_SOLDE_JAN_2025;

    process.stdout.write(`[import] Sending chunk ${i / CHUNK_SIZE + 1} (${chunk.length} tx)... `);
    const t0 = Date.now();
    const resp = await postJSON(`${API_URL}?action=bulk-import-transactions`, payload);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    if (resp.status === 200 && resp.body.success) {
      console.log(`OK in ${elapsed}s — imported=${resp.body.imported}, skipped=${resp.body.skipped}`);
      totalImported += resp.body.imported;
      totalSkipped += resp.body.skipped;
      lastResult = resp.body;
    } else {
      console.error(`FAILED (status ${resp.status}):`, resp.body);
      throw new Error("Import failed");
    }
  }

  console.log("\n========== IMPORT TERMINÉ ==========");
  console.log(`Total importé   : ${totalImported}`);
  console.log(`Total skippé    : ${totalSkipped} (déjà présent)`);
  if (lastResult) {
    console.log(`Total en base   : ${lastResult.total_transactions}`);
    console.log(`Solde initial   : ${lastResult.solde_initial.toFixed(2)} DH`);
    console.log(`Total entrées   : +${lastResult.total_in.toFixed(2)} DH`);
    console.log(`Total sorties   : -${lastResult.total_out.toFixed(2)} DH`);
    console.log(`Solde actuel    : ${lastResult.solde_actuel.toFixed(2)} DH`);
  }
}

main().catch(err => {
  console.error("[import] Erreur:", err);
  process.exit(1);
});
