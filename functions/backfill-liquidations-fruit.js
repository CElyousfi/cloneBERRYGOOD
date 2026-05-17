// One-shot: backfill `fruit` and `fruitCode` on existing `liquidations` docs.
// Re-detects fruit using subject + sheetName (if persisted) + variety codes in rows.
// Dry-run by default. Pass --apply to actually update.
// Usage: node functions/backfill-liquidations-fruit.js [--apply]

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");

const MYRTILLE_CODES = new Set(["COR", "CAS", "BRE", "ETE", "REG", "ROS"]);
const FRAMBOISE_CODES = new Set(["REY", "MAR", "YAZ", "ADE"]);

function detectFruit(doc) {
  const subject = String(doc.subject || "").toUpperCase();
  const sheetName = String(doc.sheetName || "").toUpperCase();
  if (/BLUE|MYRTILLE|BLUEBERR/i.test(sheetName)) return { fruit: "myrtille", fruitCode: "BLUE", signal: "sheetName" };
  if (/RASP|FRAMBOISE|RASPBERRY/i.test(sheetName)) return { fruit: "framboise", fruitCode: "RASP", signal: "sheetName" };
  let nMyr = 0, nFra = 0;
  for (const r of (doc.rows || [])) {
    const c = r && r.varietyCode;
    if (!c) continue;
    if (MYRTILLE_CODES.has(c)) nMyr++;
    else if (FRAMBOISE_CODES.has(c)) nFra++;
  }
  if (nMyr > nFra) return { fruit: "myrtille", fruitCode: "BLUE", signal: `rows(myr=${nMyr},fra=${nFra})` };
  if (nFra > nMyr) return { fruit: "framboise", fruitCode: "RASP", signal: `rows(myr=${nMyr},fra=${nFra})` };
  if (/BLUE|MYRTILLE|BLUEBERR/i.test(subject)) return { fruit: "myrtille", fruitCode: "BLUE", signal: "subject" };
  if (/RASP|FRAMBOISE|RASPBERRY/i.test(subject)) return { fruit: "framboise", fruitCode: "RASP", signal: "subject" };
  return { fruit: "framboise", fruitCode: "RASP", signal: "default" };
}

async function main() {
  const snap = await db.collection("liquidations").get();
  console.log(`Found ${snap.size} liquidation docs. Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const stats = { unchanged: 0, willUpdate: 0, byTarget: { myrtille: 0, framboise: 0 }, bySignal: {} };
  const updates = [];

  for (const d of snap.docs) {
    const x = d.data();
    const current = { fruit: x.fruit || "framboise", fruitCode: x.fruitCode || "RASP" };
    const detected = detectFruit(x);
    if (current.fruit === detected.fruit && current.fruitCode === detected.fruitCode) {
      stats.unchanged++;
      continue;
    }
    stats.willUpdate++;
    stats.byTarget[detected.fruit] = (stats.byTarget[detected.fruit] || 0) + 1;
    stats.bySignal[detected.signal] = (stats.bySignal[detected.signal] || 0) + 1;
    updates.push({ id: d.id, ref: d.ref, from: current, to: detected });
    console.log(`  ${d.id}  ${current.fruit}/${current.fruitCode} -> ${detected.fruit}/${detected.fruitCode}  [${detected.signal}]`);
  }

  console.log(`\nSummary: unchanged=${stats.unchanged}  toUpdate=${stats.willUpdate}`);
  console.log(`  target fruit:`, stats.byTarget);
  console.log(`  signal mix:`, stats.bySignal);

  if (!APPLY) {
    console.log(`\nDry-run only. Re-run with --apply to persist changes.`);
    return;
  }

  const now = new Date().toISOString();
  let written = 0;
  for (const u of updates) {
    await u.ref.set({ fruit: u.to.fruit, fruitCode: u.to.fruitCode, updatedAt: now }, { merge: true });
    written++;
  }
  console.log(`\nUpdated ${written} docs.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
