/**
 * Reprocess DQR emails from last week:
 * - For each DQR email_extraction, get the brixRows
 * - Delete all PFQ (source='email'), provisional (source='auto-created'),
 *   and old DQR (source='dqr-auto-created') expeditions for that date
 * - Recreate expeditions from DQR brixRows
 */
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const mapBerryToFrench = (bt) => {
  if (!bt) return null;
  const l = bt.toLowerCase();
  if (l.includes("blueberr")) return "Myrtille";
  if (l.includes("raspberr")) return "Framboise";
  if (l.includes("strawberr")) return "Fraise";
  if (l.includes("blackberr")) return "Mûre";
  return bt;
};

const ranchNameToCode = (name) => {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes("r-berry") || n.includes("r berry")) return "200742"; // F1
  if (n.includes("sarl 3") || n.includes("berry good farms sarl")) return "200876"; // F5
  return null;
};

async function main() {
  // Find DQR email_extractions from the last 10 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 10);
  const cutoffISO = cutoff.toISOString();

  const extractionsSnap = await db.collection("email_extractions")
    .where("category", "==", "daily_quality_report")
    .get();

  const dqrExtractions = [];
  extractionsSnap.forEach(doc => {
    const d = doc.data();
    if (d.analyzedAt >= cutoffISO || !d.analyzedAt) {
      dqrExtractions.push({ id: doc.id, ...d });
    }
  });

  console.log(`Found ${dqrExtractions.length} DQR extractions from last 10 days`);

  for (const ext of dqrExtractions) {
    const brixRows = ext.structuredData?.brixRows;
    if (!brixRows || brixRows.length === 0) {
      console.log(`  [${ext.id}] No brixRows, skipping`);
      continue;
    }

    // Get the email to determine the date
    const emailSnap = await db.collection("emails").doc(ext.id).get();
    if (!emailSnap.exists) {
      console.log(`  [${ext.id}] Email not found, skipping`);
      continue;
    }
    const emailData = emailSnap.data();
    const emailDate = emailData.date ? new Date(emailData.date) : null;
    if (!emailDate) {
      console.log(`  [${ext.id}] No date on email, skipping`);
      continue;
    }

    // DQR covers J-1
    const veille = new Date(emailDate);
    veille.setDate(veille.getDate() - 1);
    const veilleISO = veille.toISOString().split("T")[0];

    console.log(`\n  [${ext.id}] DQR for ${veilleISO} — ${brixRows.length} rows`);

    // Step 1: Delete old expeditions for this date
    let deletedCount = 0;
    for (const src of ["email", "auto-created", "dqr-auto-created"]) {
      const oldSnap = await db.collection("expeditions")
        .where("source", "==", src)
        .where("dateISO", "==", veilleISO)
        .get();
      if (!oldSnap.empty) {
        const batch = db.batch();
        oldSnap.docs.forEach(doc => {
          batch.delete(doc.ref);
          deletedCount++;
        });
        await batch.commit();
      }
    }
    console.log(`    Deleted ${deletedCount} old expeditions`);

    // Step 2: Recreate from DQR brixRows
    // Dédup Initial/Re-Inspection: garder Re-Inspection (verdict final) si présent.
    const isReInspectionRow = (t) => /re[\s-]?inspection/i.test(t || "");
    const rowsByBatch = {};
    for (const row of brixRows) {
      if (!row.batchId) continue;
      const existing = rowsByBatch[row.batchId];
      if (!existing) {
        rowsByBatch[row.batchId] = row;
      } else if (isReInspectionRow(row.inspectionType) && !isReInspectionRow(existing.inspectionType)) {
        rowsByBatch[row.batchId] = row;
      }
    }
    const dedupedRows = Object.values(rowsByBatch);
    if (dedupedRows.length !== brixRows.length) {
      console.log(`    Dedup ${brixRows.length} → ${dedupedRows.length} rows (Initial/Re-Inspection)`);
    }

    let createdCount = 0;
    const docIdCounter = {};
    for (const row of dedupedRows) {
      if (!row.inspectionResult) continue;

      const receiptId = row.receiptId || null;
      let baseDocId = receiptId
        ? `${receiptId}__${(row.batchId || "").replace(/[^a-zA-Z0-9-]/g, "-")}`
        : `DQR-${row.batchId}-${Date.now()}`;
      docIdCounter[baseDocId] = (docIdCounter[baseDocId] || 0) + 1;
      const expDocId = docIdCounter[baseDocId] > 1 ? `${baseDocId}__${docIdCounter[baseDocId]}` : baseDocId;

      const ranch = ranchNameToCode(row.ranchName);

      const newExp = {
        receiptId: receiptId,
        batchNumber: row.batchId || null,
        berryType: row.berryType || null,
        berryTypeFr: mapBerryToFrench(row.berryType),
        variety: (row.variety || "").trim().replace(/[™®]/g, "") || null,
        itemDescription: row.productName || null,
        batchWeight: row.weight || 0,
        batchQuantity: row.quantity || 0,
        totalFruitInspected: row.totalFruitInspected || 0,
        brix: row.brix || null,
        pfqBrix: row.brixPoints || 0,
        brixFromDQR: row.brix || 0,
        enrichedPqScore: row.enrichedPqScore || 0,
        initialPq: row.initialPq || 0,
        reInspectionPq: row.reInspectionPq || 0,
        pqScore: row.enrichedPqScore || row.brixPoints || 0,
        pfqTotal: row.brixPoints || 0,
        pfqCondition: 0,
        pfqApparence: 0,
        overallResult: row.inspectionResult || "PENDING",
        ranch: ranch,
        ranchName: row.ranchName || null,
        status: "DQR reçu",
        source: "dqr-auto-created",
        dateISO: veilleISO,
        date: veilleISO,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await db.collection("expeditions").doc(expDocId).set(newExp);
      createdCount++;
    }
    console.log(`    Created ${createdCount} expeditions from DQR`);
  }

  console.log("\nDone!");
  process.exit(0);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
