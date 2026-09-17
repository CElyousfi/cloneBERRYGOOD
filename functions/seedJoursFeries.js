/**
 * seedJoursFeries.js — Seed app_settings/jours_feries depuis la constante source.
 *
 * Source unique : JOURS_FERIES_FALLBACK (pointageService.js). Ce script écrit le
 * document Firestore `app_settings/jours_feries` que liront le calcul de prime
 * (getJoursFeries) et le calendrier RH. Le job quotidien syncJoursFeries
 * confirmera ensuite les dates lunaires via API sans écraser les overrides RH.
 *
 * Usage :
 *   node seedJoursFeries.js --dry-run   # affiche sans écrire (défaut conseillé)
 *   node seedJoursFeries.js             # écrit en prod (ADC requise)
 *
 * Auth : Application Default Credentials (gcloud auth application-default login).
 */
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "berrygood-farms-dashboard" });
const db = admin.firestore();

const { JOURS_FERIES_FALLBACK } = require("./src/modules/rh/pointageService");

const DRY_RUN = process.argv.includes("--dry-run");

// Horodatage figé (ISO) — passé en argument plutôt que Date.now() pour déterminisme.
const nowIso = new Date().toISOString();

const holidays = JOURS_FERIES_FALLBACK.map(jf => ({
  date: jf.date,
  label: jf.label,
  type: jf.type,                       // 'fixe' | 'islamique'
  status: jf.status || (jf.type === "islamique" ? "estime" : "fixe"),
  source: "seed",                      // 'seed' | 'api' | 'rh'
  manualOverride: false,
  updatedAt: nowIso,
}));

const docData = {
  holidays,
  lastSyncAt: null,                    // jamais sync API au seed
  syncSource: "seed",
  updatedAt: nowIso,
};

(async () => {
  console.log(`Seed app_settings/jours_feries — ${holidays.length} fériés`);
  console.log(`  fixes:      ${holidays.filter(h => h.status === "fixe").length}`);
  console.log(`  estimés:    ${holidays.filter(h => h.status === "estime").length}`);
  console.log(`  confirmés:  ${holidays.filter(h => h.status === "confirme").length}`);
  if (DRY_RUN) {
    console.log("\n[DRY-RUN] Document qui serait écrit :");
    console.log(JSON.stringify(docData, null, 2));
    console.log("\n[DRY-RUN] Rien écrit. Relancer sans --dry-run pour appliquer.");
    process.exit(0);
  }
  // Merge:true pour ne pas perdre d'éventuels champs ajoutés hors seed.
  await db.collection("app_settings").doc("jours_feries").set(docData, { merge: true });
  console.log("\n✔ Écrit dans app_settings/jours_feries");
  process.exit(0);
})().catch(e => { console.error("ERREUR seed:", e); process.exit(1); });
