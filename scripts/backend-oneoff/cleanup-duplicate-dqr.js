/**
 * Cleanup duplicate DQR expeditions caused by Initial + Re-Inspection rows.
 *
 * Groups all `dqr-auto-created` expeditions by (receiptId, batchNumber).
 * For each group with >1 doc, keeps the Re-Inspection (verdict final) if present,
 * otherwise the most recently updated. Other docs are reported / deleted.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=... node functions/cleanup-duplicate-dqr.js          # dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=... node functions/cleanup-duplicate-dqr.js --apply  # actually delete
 */
const admin = require("firebase-admin");

admin.initializeApp({ credential: admin.credential.applicationDefault() });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

const isReInspection = (t) => /re[\s-]?inspection/i.test(t || "");

async function main() {
  console.log(`=== DQR DUPLICATE CLEANUP === (mode: ${APPLY ? "APPLY" : "DRY-RUN"})\n`);

  const snap = await db.collection("expeditions")
    .where("source", "==", "dqr-auto-created")
    .get();

  console.log(`Total dqr-auto-created expeditions: ${snap.size}\n`);

  // Group by (receiptId, batchNumber)
  const groups = {};
  snap.docs.forEach(doc => {
    const d = doc.data();
    const key = `${d.receiptId || "?"}__${d.batchNumber || "?"}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push({ id: doc.id, ref: doc.ref, ...d });
  });

  const dupGroups = Object.entries(groups).filter(([, docs]) => docs.length > 1);
  console.log(`Groups with duplicates: ${dupGroups.length}\n`);

  if (dupGroups.length === 0) {
    console.log("Nothing to cleanup.");
    process.exit(0);
  }

  const toDelete = [];
  const summary = { byDate: {} };

  for (const [key, docs] of dupGroups) {
    // Pick the one to KEEP: prefer Re-Inspection, else most recent updatedAt
    docs.sort((a, b) => {
      const aIsRI = isReInspection(a.inspectionType);
      const bIsRI = isReInspection(b.inspectionType);
      if (aIsRI !== bIsRI) return aIsRI ? -1 : 1; // Re-Inspection first
      // Same type → most recent updatedAt first
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
    const [keep, ...remove] = docs;
    const date = keep.dateISO || keep.date || "?";
    summary.byDate[date] = (summary.byDate[date] || 0) + remove.length;

    console.log(`Group ${key}  date=${date}  variety=${keep.variety}  weight=${keep.batchWeight}`);
    console.log(`  KEEP  ${keep.id}  type="${keep.inspectionType || "-"}"  result=${keep.overallResult}  updated=${keep.updatedAt}`);
    for (const r of remove) {
      console.log(`  DROP  ${r.id}  type="${r.inspectionType || "-"}"  result=${r.overallResult}  updated=${r.updatedAt}`);
      toDelete.push(r);
    }
  }

  console.log(`\nSummary by dateISO (docs to delete):`);
  Object.entries(summary.byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([d, n]) => console.log(`  ${d}: ${n}`));
  console.log(`\nTotal to delete: ${toDelete.length}`);

  if (!APPLY) {
    console.log(`\n[DRY-RUN] Re-run with --apply to delete.`);
    process.exit(0);
  }

  // Apply deletions in batches of 400
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 400) {
    const batch = db.batch();
    toDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(400, toDelete.length - i);
    console.log(`  Deleted ${deleted}/${toDelete.length}`);
  }
  console.log(`\nDone. Deleted ${deleted} duplicate DQR docs.`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
