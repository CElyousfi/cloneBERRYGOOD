// One-shot: cleanup duplicate liquidation docs in Firestore.
// Groups by (year, week, fruit); keeps the best doc under stable key LIQ-{CODE}-W{NN}-{YYYY}
// and deletes the rest. "Best" = most rows, tie-break by presence of liquidationNumber.
//
// Dry-run by default. Pass --apply to actually delete.
// Usage: node functions/cleanup-duplicate-liquidations.js [--apply]

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

function extractYearFromSubject(subject, fallbackDate) {
  const m = (subject || "").match(/week\s*\d+[-/](\d{4})/i);
  if (m) return parseInt(m[1]);
  if (fallbackDate) return new Date(fallbackDate).getFullYear();
  return new Date().getFullYear();
}

async function main() {
  const snap = await db.collection("liquidations").get();
  console.log(`Found ${snap.size} liquidation docs`);

  // Group by (year, week, fruit)
  const groups = {};
  snap.forEach((d) => {
    const x = d.data();
    const fruit = x.fruit || "framboise";
    const fruitCode = x.fruitCode || (fruit === "myrtille" ? "BLUE" : "RASP");
    const week = x.week;
    const year = extractYearFromSubject(x.subject, x.date);
    if (week == null) {
      console.warn(`  Skipping ${d.id}: no week`);
      return;
    }
    const key = `LIQ-${fruitCode}-W${String(week).padStart(2, "0")}-${year}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ id: d.id, data: x, ref: d.ref });
  });

  let keptCount = 0;
  let deleteCount = 0;
  let renameCount = 0;

  for (const [targetId, docs] of Object.entries(groups)) {
    // Score: more rows wins, tie-break by presence of liquidationNumber (APIV)
    docs.sort((a, b) => {
      const aRows = (a.data.rows || []).length;
      const bRows = (b.data.rows || []).length;
      if (bRows !== aRows) return bRows - aRows;
      const aApiv = a.data.liquidationNumber ? 1 : 0;
      const bApiv = b.data.liquidationNumber ? 1 : 0;
      return bApiv - aApiv;
    });
    const best = docs[0];
    const rest = docs.slice(1);

    const mustRename = best.id !== targetId;
    console.log(
      `${targetId}  →  keep=${best.id} (rows=${(best.data.rows || []).length}, apiv=${best.data.liquidationNumber || "-"}), delete=${rest.length}${mustRename ? " [RENAME]" : ""}`
    );

    if (!APPLY) continue;

    // Rename (copy + delete old) if needed
    if (mustRename) {
      await db.collection("liquidations").doc(targetId).set(best.data, { merge: true });
      await best.ref.delete();
      renameCount++;
    }
    // Delete the duplicates — SKIP any doc whose id matches the target we just wrote
    for (const r of rest) {
      if (r.id === targetId) continue;
      await r.ref.delete();
      deleteCount++;
    }
    keptCount++;
  }

  console.log("");
  console.log(`Kept: ${keptCount} | Deleted: ${deleteCount} | Renamed: ${renameCount}`);
  console.log(APPLY ? "Changes applied." : "Dry-run only. Re-run with --apply to commit.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
