// One-shot: backfill `culture` on existing `plant_invoices` docs.
// Re-runs the isMyrtille() regex against the `variete` field.
// Dry-run by default. Pass --apply to actually update.
// Usage: node functions/backfill-plant-invoices-culture.js [--apply]

require("dotenv").config({ path: require("path").join(__dirname, "../../functions/.env") });
const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

// Mirrors emailService.js:4085 / 4237.
const isMyrtille = (v) => /corina|corrina|cascade|breeze|eterna|regina|rosita|biloxi|emerald|jewel|liberty|myrtille|blueberr|blue/i.test(v || "");

async function main() {
  const snap = await db.collection("plant_invoices").get();
  console.log(`Found ${snap.size} plant_invoice docs. Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const stats = { unchanged: 0, willUpdate: 0, byTarget: {} };
  const unknownVarietes = new Set();
  const updates = [];

  for (const d of snap.docs) {
    const x = d.data();
    const variete = x.variete || "";
    const current = x.culture || null;
    const detected = isMyrtille(variete) ? "myrtille" : "framboise";
    if (current === detected) {
      stats.unchanged++;
      continue;
    }
    // Flag varieties where detection might be wrong (current set but regex doesn't match either way obviously).
    if (variete && !isMyrtille(variete) && !/maravilla|reyna|adelita|yazmin|framboise|raspberry|rasp/i.test(variete)) {
      unknownVarietes.add(variete);
    }
    stats.willUpdate++;
    stats.byTarget[detected] = (stats.byTarget[detected] || 0) + 1;
    updates.push({ id: d.id, ref: d.ref, variete, from: current, to: detected });
    console.log(`  ${d.id}  "${variete}"  ${current || "(none)"} -> ${detected}`);
  }

  console.log(`\nSummary: unchanged=${stats.unchanged}  toUpdate=${stats.willUpdate}`);
  console.log(`  target culture:`, stats.byTarget);
  if (unknownVarietes.size) {
    console.log(`  varietes not matching myrtille AND not matching known framboise (worth review):`);
    for (const v of unknownVarietes) console.log(`    - ${v}`);
  }

  if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to persist changes.`);
    return;
  }

  const now = new Date().toISOString();
  let written = 0;
  for (const u of updates) {
    await u.ref.set({ culture: u.to, updatedAt: now }, { merge: true });
    written++;
  }
  console.log(`\nUpdated ${written} docs.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
