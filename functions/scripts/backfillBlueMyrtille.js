// ---------------------------------------------------------------------------
// One-shot backfill: re-parse the BLUE Myrtille liquidation summary PDFs for the
// 3 docs currently stuck at netPayable=0, using the NEW French BLUE parser.
//
//   • APIV-000086703  (LIQ-BLUE-W18-2026)
//   • APIV-000086893  (LIQ-BLUE-W19-2026)
//   • APIV-000087077  (LIQ-BLUE-W20-2026)
//
// SOURCE of the PDF = re-fetched via the doc's `emailId`, by reading
// emails/<emailId>.liqSummaryPdfBase64 (fallback: .pdfBase64). The PDF text is
// re-parsed with parseLiquidationSummaryText (the BLUE-aware parser).
//
// SAFETY:
//   • DRY-RUN by default. No Firestore write unless --apply is passed.
//   • --apply writes a JSON backup of the 3 docs BEFORE any update, then merges
//     ONLY the financial fields + summary on those 3 docs. Never deletes.
//   • Guard-rail: if the re-parsed `base` differs from the stored `base` for a
//     doc, that doc is flagged as ANOMALY and NOT patched.
//   • Idempotent: re-running produces the same patch; merge-only writes.
//
// Usage:
//   node functions/scripts/backfillBlueMyrtille.js            (DRY-RUN, default)
//   node functions/scripts/backfillBlueMyrtille.js --apply    (GATED — do not run
//                                                               without explicit
//                                                               validation)
// ---------------------------------------------------------------------------

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Ensure a project id is resolvable BEFORE emailService (required below) calls
// admin.initializeApp() — the monolith inits without an explicit projectId.
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "berrygood-farms-dashboard";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "berrygood-farms-dashboard";
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const { parseLiquidationSummaryText } = require("../src/modules/finance/emailService");
const { PDFParse } = require("pdf-parse");

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "berrygood-farms-dashboard",
    credential: admin.credential.applicationDefault(),
  });
}
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

// Optional CLI flags for the local-PDF mode:
//   --liq <APIV>         restrict processing to a single liquidationNumber
//   --pdf-file <chemin>  read the PDF from a local file instead of re-fetching
//                        it via the doc's emailId (used for the W18 doc whose
//                        PDF was never persisted in Firestore).
//   --stamp <label>      optional human-readable label appended to the backup
//                        filename and recorded in the _backfill trace.
function readFlag(name) {
  const i = process.argv.indexOf(name);
  if (i === -1) return null;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) return null;
  return v;
}
const LIQ_FILTER = readFlag("--liq");
const PDF_FILE = readFlag("--pdf-file");
const STAMP = readFlag("--stamp");

// The 3 target docs (by liquidationNumber). docId is resolved dynamically.
const ALL_TARGET_LIQ_NUMBERS = ["APIV-000086703", "APIV-000086893", "APIV-000087077"];
const TARGET_LIQ_NUMBERS = LIQ_FILTER ? [LIQ_FILTER] : ALL_TARGET_LIQ_NUMBERS;

// Financial fields we are allowed to patch (mirrors the analyzeEmail liqDoc shape).
const FINANCIAL_FIELDS = [
  "base",
  "fruitAdvance",
  "dedRasp",
  "dedPlants",
  "cropAdvance",
  "dexAdjustment",
  "pkgDeduction",
  "netPayable",
  "totalKg",
];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Re-extract the liquidation summary PDF text from the persisted email doc.
// Returns { text, source } or { error } — never re-fabricates data.
async function fetchPdfTextViaEmailId(emailId) {
  if (!emailId) return { error: "doc has no emailId" };
  const emailDoc = await db.collection("emails").doc(emailId).get();
  if (!emailDoc.exists) return { error: `emails/${emailId} not found` };
  const e = emailDoc.data();
  const b64 = e.liqSummaryPdfBase64 || e.pdfBase64 || null;
  if (!b64) {
    return {
      error:
        "no liqSummaryPdfBase64 / pdfBase64 persisted on the email doc " +
        "(PDF attachment exists in mailbox but was never stored in Firestore)",
    };
  }
  try {
    const buffer = Buffer.from(b64, "base64");
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const text =
      (textResult && textResult.text) ||
      (typeof textResult === "string" ? textResult : "");
    if (!text) return { error: "PDF text extraction returned empty" };
    return { text, source: "emails/" + emailId + ".liqSummaryPdfBase64" };
  } catch (err) {
    return { error: `PDF parse failed: ${err.message}` };
  }
}

// Re-extract the liquidation summary PDF text from a LOCAL file on disk.
// Same extraction path as fetchPdfTextViaEmailId (PDFParse.getText) so the
// downstream parse + apply logic is byte-for-byte identical.
async function fetchPdfTextFromFile(filePath) {
  if (!filePath) return { error: "no --pdf-file path given" };
  if (!fs.existsSync(filePath)) return { error: `file not found: ${filePath}` };
  try {
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    const textResult = await parser.getText();
    const text =
      (textResult && textResult.text) ||
      (typeof textResult === "string" ? textResult : "");
    if (!text) return { error: "PDF text extraction returned empty" };
    return { text, source: "local-file:" + filePath };
  } catch (err) {
    return { error: `PDF parse failed: ${err.message}` };
  }
}

function fmt(n) {
  return Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function main() {
  console.log("=".repeat(78));
  console.log(`BACKFILL BLUE MYRTILLE — ${APPLY ? "APPLY (WRITE)" : "DRY-RUN (no write)"}`);
  console.log("=".repeat(78));

  const plans = [];
  const anomalies = [];
  const blocked = [];

  for (const liqNumber of TARGET_LIQ_NUMBERS) {
    console.log(`\n──────── ${liqNumber} ────────`);
    const snap = await db
      .collection("liquidations")
      .where("liquidationNumber", "==", liqNumber)
      .get();

    if (snap.empty) {
      console.log("  STATUS: NOT FOUND — skipped");
      blocked.push({ liqNumber, reason: "doc not found" });
      continue;
    }
    if (snap.size > 1) {
      console.log(`  STATUS: ${snap.size} docs match this liquidationNumber — ambiguous, skipped`);
      blocked.push({ liqNumber, reason: `${snap.size} matching docs (ambiguous)` });
      continue;
    }

    const doc = snap.docs[0];
    const data = doc.data();
    console.log(`  docId=${doc.id}  week=${data.week}  fruit=${data.fruit}  emailId=${data.emailId}`);

    const baseStored = round2(data.base);
    const netStored = round2(data.netPayable);
    console.log(`  STORED:   base=${fmt(baseStored)}  netPayable=${fmt(netStored)}`);

    const pdf = PDF_FILE
      ? await fetchPdfTextFromFile(PDF_FILE)
      : await fetchPdfTextViaEmailId(data.emailId);
    if (pdf.error) {
      console.log(`  STATUS: BLOCKED — cannot re-fetch PDF: ${pdf.error}`);
      blocked.push({ liqNumber, docId: doc.id, reason: pdf.error });
      continue;
    }
    console.log(`  PDF source: ${pdf.source}`);

    const parsed = parseLiquidationSummaryText(pdf.text);
    if (!parsed || !parsed.summary || Object.keys(parsed.summary).length === 0) {
      console.log("  STATUS: BLOCKED — parser returned no summary from this PDF");
      blocked.push({ liqNumber, docId: doc.id, reason: "parser returned no summary" });
      continue;
    }
    const s = parsed.summary;
    const baseReparsed = round2(s.base);

    console.log(`  RE-PARSED: base=${fmt(baseReparsed)}  fruitAdvance=${fmt(s.fruitAdvance)}  dedPlants=${fmt(s.dedPlants)}  cropAdvance=${fmt(s.cropAdvance)}  dexAdjustment=${fmt(s.dexAdjustment)}  pkgDeduction=${fmt(s.pkgDeduction)}  netPayable=${fmt(s.netPayable)}`);

    // Guard-rail: re-parsed base MUST equal stored base.
    if (baseStored !== baseReparsed) {
      console.log(`  ⚠️  ANOMALY: base mismatch (stored=${fmt(baseStored)} vs reparsed=${fmt(baseReparsed)}) — NOT patching this doc`);
      anomalies.push({ liqNumber, docId: doc.id, baseStored, baseReparsed });
      continue;
    }
    console.log("  ✓ base matches — patch eligible");

    // Extra guard-rail (local-file mode only): the re-parsed netPayable must
    // match the DG-validated expected value to within 0.5. Protects the
    // one-shot W18 correction against a wrong file / mis-parse.
    if (PDF_FILE) {
      const EXPECTED_NET = { "APIV-000086703": 176410.49 };
      const expected = EXPECTED_NET[liqNumber];
      if (expected != null) {
        const netReparsed = round2(s.netPayable);
        if (Math.abs(netReparsed - expected) > 0.5) {
          console.log(
            `  ⚠️  ANOMALY: netPayable mismatch (reparsed=${fmt(netReparsed)} vs expected=${fmt(expected)}) — NOT patching this doc`
          );
          anomalies.push({ liqNumber, docId: doc.id, netReparsed, expected });
          continue;
        }
        console.log(`  ✓ netPayable matches DG-validated value (${fmt(expected)})`);
      }
    }

    const patch = {
      base: round2(s.base),
      fruitAdvance: round2(s.fruitAdvance),
      dedRasp: round2(s.dedRasp),
      dedPlants: round2(s.dedPlants),
      cropAdvance: round2(s.cropAdvance),
      dexAdjustment: round2(s.dexAdjustment),
      pkgDeduction: round2(s.pkgDeduction),
      netPayable: round2(s.netPayable),
      totalKg: round2(s.totalKg),
    };
    plans.push({ docId: doc.id, liqNumber, before: data, patch, summary: s });
  }

  console.log(`\n${"=".repeat(78)}`);
  console.log(`SUMMARY: ${plans.length} patch-eligible, ${anomalies.length} anomaly, ${blocked.length} blocked`);
  if (anomalies.length) console.log("  ANOMALIES:", JSON.stringify(anomalies, null, 2));
  if (blocked.length) console.log("  BLOCKED:", JSON.stringify(blocked.map(b => ({ liqNumber: b.liqNumber, reason: b.reason })), null, 2));

  if (!APPLY) {
    console.log("\nDRY-RUN complete — no Firestore write performed. Re-run with --apply (GATED) to write.");
    process.exit(0);
  }

  if (plans.length === 0) {
    console.log("\n--apply: nothing patch-eligible, no write.");
    process.exit(0);
  }

  // --- APPLY path (GATED) -------------------------------------------------
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const stampSuffix = STAMP ? `-${STAMP}` : "";
  const backupDir = path.join(__dirname, "..", "..", "docs");
  const backupPath = path.join(backupDir, `BACKUP-liquidations-blue${stampSuffix}-${ts}.json`);
  const backup = plans.map((p) => ({ docId: p.docId, liquidationNumber: p.liqNumber, data: p.before }));
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nBACKUP written: ${backupPath} (${plans.length} docs)`);

  for (const p of plans) {
    const updatePayload = {
      ...p.patch,
      summary: { ...(p.before.summary || {}), ...p.summary },
      _backfill: {
        source: "backfill_blue_myrtille",
        updated_at: new Date().toISOString(),
        ...(STAMP ? { stamp: STAMP } : {}),
        ...(PDF_FILE ? { pdfFile: PDF_FILE } : {}),
      },
      updatedAt: new Date().toISOString(),
    };
    if (p.before.version != null) updatePayload.version = p.before.version;
    await db.collection("liquidations").doc(p.docId).set(updatePayload, { merge: true });
    console.log(`  UPDATED ${p.docId} (${p.liqNumber}) → netPayable=${fmt(p.patch.netPayable)}`);
  }

  console.log("\n--apply complete. Only the eligible BLUE docs were patched (merge). No deletes.");
  process.exit(0);
}

main().catch((err) => {
  console.error("backfillBlueMyrtille FATAL:", err);
  process.exit(1);
});
