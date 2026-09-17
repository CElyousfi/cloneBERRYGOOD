// One-shot: CASCADE is a myrtille variety that belongs to F5 only.
// Reassigns any analyses_foliaires doc with variete=CASCADE and ferme != F5.
//
// Dry-run by default. Pass --apply to actually update Firestore.
// Usage: node functions/fix-cascade-ferme.js [--apply]

require("dotenv").config({ path: require("path").join(__dirname, "../../functions/.env") });
const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

async function main() {
  const snap = await db.collection("analyses_foliaires")
    .where("variete", "==", "CASCADE")
    .get();
  console.log(`Found ${snap.size} CASCADE analyses`);
  let fixed = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.ferme === "F5") continue;
    fixed++;
    console.log(`  ${doc.id}: ferme=${d.ferme} → F5${APPLY ? "" : " (dry-run)"}`);
    if (APPLY) {
      await doc.ref.update({ ferme: "F5", culture: d.culture || "Myrtille", updated_at: Date.now() });
    }
  }
  console.log(`\nDone. ${fixed} doc(s) ${APPLY ? "updated" : "would be updated"}.`);
  if (!APPLY) console.log("Re-run with --apply to actually write.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
