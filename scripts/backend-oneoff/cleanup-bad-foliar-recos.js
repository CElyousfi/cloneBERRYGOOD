// One-shot: remove invalid recommandations_ia entries from analyses_foliaires.
// A reco is considered "bad" when the LLM refused to read the PDF or produced
// a too-short message. After this script, the UI falls back to "Generate" so a
// fresh (fixed) call can produce a real report.
//
// Dry-run by default. Pass --apply to actually update Firestore.
// Usage: node functions/cleanup-bad-foliar-recos.js [--apply]

require("dotenv").config({ path: require("path").join(__dirname, "../../functions/.env") });
const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

const refusalRe = /^\s*(je ne peux pas|je n'ai pas (accès|pu|de)|je ne (vois|dispose)|désolé|sorry|i (cannot|can't|don't|am (unable|not able)))/i;

function isBad(r) {
  if (!r || !r.message) return true;
  if (r.message.length < 600) return true;
  if (refusalRe.test(r.message)) return true;
  return false;
}

async function main() {
  const snap = await db.collection("analyses_foliaires").get();
  console.log(`Scanning ${snap.size} analyses_foliaires docs`);
  let touched = 0;
  let removed = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const recos = data.recommandations_ia || [];
    if (!recos.length) continue;
    const cleaned = recos.filter(r => !isBad(r));
    const gone = recos.length - cleaned.length;
    if (gone === 0) continue;
    touched++;
    removed += gone;
    console.log(`  ${doc.id}: ${gone} bad reco(s) ${APPLY ? "→ removing" : "(dry-run)"}`);
    if (APPLY) {
      await doc.ref.update({ recommandations_ia: cleaned, updated_at: Date.now() });
    }
  }
  console.log(`\nDone. ${touched} doc(s) touched, ${removed} reco(s) ${APPLY ? "removed" : "would be removed"}.`);
  if (!APPLY) console.log("Re-run with --apply to actually update Firestore.");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
