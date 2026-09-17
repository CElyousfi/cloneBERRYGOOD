// One-shot import of a local Driscoll's blueberry liquidation XLS into Firestore.
// Usage: GOOGLE_APPLICATION_CREDENTIALS=... node functions/import-receipt-blue.js [path] [year]
// Defaults: path = "../RECEIPT BLUE.xls", year = 2026

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

const { parseLiquidationXlsx } = require("./src/modules/finance/emailService");

async function main() {
  const xlsPath = process.argv[2] || path.join(__dirname, "..", "RECEIPT BLUE.xls");
  const year = parseInt(process.argv[3] || "2026");

  if (!fs.existsSync(xlsPath)) {
    console.error(`File not found: ${xlsPath}`);
    process.exit(1);
  }

  const buf = fs.readFileSync(xlsPath);
  const parsed = parseLiquidationXlsx(buf);
  const sheets = parsed._multiSheets || [parsed];
  const now = new Date().toISOString();

  let totalRows = 0;
  let totalUpdated = 0;

  for (const liq of sheets) {
    if (!liq.rows || liq.rows.length === 0) continue;

    const docId = `LIQ-BLUE-W${liq.week || "?"}-${year}-manual`;
    const subject = `LIQUIDATION BLUE WEEK ${String(liq.week || "?").padStart(2, "0")}-${year}`;

    const liqDoc = {
      emailId: null,
      liquidationNumber: liq.liquidationNumber || null,
      week: liq.week,
      period: liq.period || null,
      fruit: "myrtille",
      fruitCode: "BLUE",
      subject,
      date: now,
      rows: liq.rows,
      summary: liq.summary,
      totalKg: liq.summary.totalKg || 0,
      base: liq.summary.base || 0,
      fruitAdvance: liq.summary.fruitAdvance || 0,
      dedRasp: liq.summary.dedRasp || 0,
      dedPlants: liq.summary.dedPlants || 0,
      cropAdvance: liq.summary.cropAdvance || 0,
      dexAdjustment: liq.summary.dexAdjustment || 0,
      pkgDeduction: liq.summary.pkgDeduction || 0,
      netPayable: liq.summary.netPayable || 0,
      nbLots: liq.rows.length,
      importedManually: true,
      sourceFile: path.basename(xlsPath),
      createdAt: now,
      updatedAt: now,
    };

    await db.collection("liquidations").doc(docId).set(liqDoc, { merge: true });
    console.log(`Wrote ${docId} (${liq.rows.length} rows, ${liq.summary.totalKg} kg)`);

    let updated = 0;
    for (const row of liq.rows) {
      if (!row.receiptId) continue;
      const updateData = {
        status: "Liquidée",
        liquidationNumber: liq.liquidationNumber || null,
        liquidationWeek: liq.week,
        ppFruit: row.ppFruit,
        gsNet: row.gsNet,
        pricePerKg: row.receiptQtyKg > 0 ? Math.round((row.gsNet / row.receiptQtyKg) * 100) / 100 : null,
        updatedAt: now,
      };
      const expDoc = await db.collection("expeditions").doc(row.receiptId).get();
      if (expDoc.exists) {
        await expDoc.ref.update(updateData);
        updated++;
      } else {
        const q = await db.collection("expeditions").where("receiptId", "==", row.receiptId).limit(1).get();
        if (!q.empty) {
          await q.docs[0].ref.update(updateData);
          updated++;
        }
      }
    }
    console.log(`  → ${updated} expeditions updated`);
    totalRows += liq.rows.length;
    totalUpdated += updated;
  }

  console.log(`\nDone. ${totalRows} rows, ${totalUpdated} expeditions updated.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
