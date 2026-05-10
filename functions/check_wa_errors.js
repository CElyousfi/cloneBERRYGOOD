const admin = require("firebase-admin");
admin.initializeApp({ projectId: "berrygood-farms-dashboard" });
const db = admin.firestore();

(async () => {
  const since = Date.now() - 6 * 60 * 60 * 1000; // last 6h
  const snap = await db.collection("whatsapp_logs")
    .where("status", "==", "failed")
    .orderBy("sentAt", "desc")
    .limit(20)
    .get();

  console.log(`\n${snap.size} échecs récents:\n`);
  for (const doc of snap.docs) {
    const d = doc.data();
    const dt = new Date(d.sentAt).toLocaleString("fr-FR");
    console.log(`▸ ${dt} | ${d.to} | ${d.templateName}`);
    console.log(`  Error: ${d.error || "(vide)"}`);
    console.log("");
  }
  process.exit(0);
})();
