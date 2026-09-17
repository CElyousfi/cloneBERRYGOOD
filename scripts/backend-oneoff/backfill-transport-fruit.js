// One-shot: backfill Transport Fruit entries dans pointage_divers depuis
// SITUATION DE PRODUCTION 2025-2026.xlsx (feuille SITUATION EXPORT 2025-2026).
// Ne touche PAS pfq_interne — uniquement pointage_divers / pointage_divers_config.
// Dry-run par défaut. Pass --apply pour écrire en prod.
// Usage: node functions/backfill-transport-fruit.js [chemin/excel.xlsx] [--apply]

require("dotenv").config({ path: require("path").join(__dirname, "../../functions/.env") });
const admin = require("firebase-admin");
const XLSX = require("xlsx");
const path = require("path");
const fs = require("fs");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const pathArg = args.find((a) => !a.startsWith("--"));
const EXCEL_PATH = pathArg
  ? path.resolve(pathArg)
  : path.join(__dirname, "..", "SITUATION DE PRODUCTION 2025-2026.xlsx");
const SHEET = "SITUATION EXPORT 2025-2026";

function parseDate(raw) {
  if (typeof raw === "number") return new Date((raw - 25569) * 86400 * 1000).toISOString().split("T")[0];
  if (typeof raw === "string") {
    const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : raw;
  }
  return "";
}

function extractTransportRows(filepath) {
  const buf = fs.readFileSync(filepath);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const ws = wb.Sheets[SHEET];
  if (!ws) throw new Error(`Feuille "${SHEET}" introuvable. Dispo: ${wb.SheetNames.join(", ")}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const out = [];
  for (const row of rows) {
    const bonNum = String(row[6] || "").trim();
    if (!bonNum || isNaN(parseInt(bonNum))) continue;
    const rowType = String(row[1] || "").trim();
    if (rowType === "ENC" || rowType === "DÉC") continue;
    const dateISO = parseDate(row[5]);
    const matricule = String(row[11] || "").trim().toUpperCase();
    const voyage = String(row[12] || "").trim().toUpperCase();
    if (matricule && voyage && dateISO) out.push({ date: dateISO, matricule, voyage });
  }
  return out;
}

async function main() {
  console.log("═".repeat(78));
  console.log(`Backfill Transport Fruit ${APPLY ? "(--APPLY)" : "(dry-run)"}`);
  console.log("═".repeat(78));
  console.log(`📂 Excel : ${EXCEL_PATH}`);

  const transportRows = extractTransportRows(EXCEL_PATH);
  console.log(`🚚 Lignes Excel avec matricule+N-V : ${transportRows.length}\n`);

  // Agrégation
  const byDate = new Map();
  for (const r of transportRows) {
    if (!byDate.has(r.date)) byDate.set(r.date, new Map());
    const m = byDate.get(r.date);
    if (!m.has(r.matricule)) m.set(r.matricule, new Set());
    m.get(r.matricule).add(r.voyage);
  }

  // Charger configs TRANSPORT FRUIT (index par matricule, fallback beneficiaire pour legacy)
  const cfgSnap = await db.collection("pointage_divers_config").where("fonction", "==", "TRANSPORT FRUIT").get();
  const cfgByMat = new Map();
  cfgSnap.docs.forEach((d) => {
    const v = d.data();
    if (v.active === false) return;
    const key = String(v.matricule || v.beneficiaire || "").trim().toUpperCase();
    if (key) cfgByMat.set(key, { id: d.id, ...v });
  });
  console.log(`📋 Configs TRANSPORT FRUIT en prod : ${cfgByMat.size}`);
  for (const [mat, cfg] of cfgByMat.entries()) {
    console.log(`   • ${mat.padEnd(14)} → ${cfg.beneficiaire || '(sans nom)'} @ ${cfg.prixUnitaire} DH/voyage (id=${cfg.id})`);
  }

  // Matricules manquants
  const allMat = new Set();
  for (const m of byDate.values()) for (const k of m.keys()) allMat.add(k);
  const missingPrices = [];
  const autoCreated = [];
  for (const mat of allMat) {
    if (!cfgByMat.has(mat)) {
      const docData = {
        beneficiaire: "",
        matricule: mat,
        fonction: "TRANSPORT FRUIT",
        tache: "Transport fruit",
        prixUnitaire: 0,
        unite: "VOYAGES",
        active: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (APPLY) {
        const ref = await db.collection("pointage_divers_config").add(docData);
        cfgByMat.set(mat, { id: ref.id, ...docData });
        autoCreated.push({ mat, id: ref.id });
      } else {
        cfgByMat.set(mat, { id: `<would-create>`, ...docData });
        autoCreated.push({ mat, id: "<would-create>" });
      }
      missingPrices.push(mat);
    } else if (!Number(cfgByMat.get(mat).prixUnitaire)) {
      missingPrices.push(mat);
    }
  }
  if (autoCreated.length) {
    console.log(`\n➕ Configs auto-créés (prix=0) :`);
    for (const c of autoCreated) console.log(`   • ${c.mat.padEnd(14)} ${APPLY ? "✓ id=" + c.id : "(dry-run)"}`);
  }

  // Upsert par date
  console.log(`\n📝 Dates à traiter : ${byDate.size}\n`);
  const sortedDates = [...byDate.keys()].sort();
  const lockedDates = [];
  let totalVoyages = 0;
  let docsWritten = 0;

  for (const date of sortedDates) {
    // Lock check
    let isLocked = false;
    try {
      const v = await db.collection("pointage_validations").doc(date + "_DIVERS").get();
      if (v.exists && v.data().locked === true) isLocked = true;
    } catch (_) {}
    if (isLocked) {
      lockedDates.push(date);
      console.log(`🔒 ${date}  SKIP (locked)`);
      continue;
    }

    // Lire entries existantes, filtrer TRANSPORT FRUIT
    let existing = [];
    try {
      const d = await db.collection("pointage_divers").doc(date).get();
      if (d.exists) existing = (d.data().entries || []).filter((e) => e.fonction !== "TRANSPORT FRUIT");
    } catch (_) {}
    const preservedCount = existing.length;

    // Push entries
    const matMap = byDate.get(date);
    for (const [mat, voySet] of matMap.entries()) {
      const cfg = cfgByMat.get(mat);
      const nbVoyages = voySet.size;
      const prix = Number(cfg.prixUnitaire) || 0;
      existing.push({
        configId: cfg.id,
        beneficiaire: cfg.beneficiaire || "",
        matricule: mat,
        fonction: "TRANSPORT FRUIT",
        tache: "Transport fruit",
        quantite: nbVoyages,
        prixUnitaire: prix,
        unite: "VOYAGES",
        montant: Math.round(nbVoyages * prix * 100) / 100,
        commentaire: "Backfill situation production",
      });
      totalVoyages += nbVoyages;
    }
    const totalMontant = Math.round(existing.reduce((s, e) => s + (Number(e.quantite) || 0) * (Number(e.prixUnitaire) || 0), 0) * 100) / 100;

    const docData = {
      date,
      entries: existing,
      totalMontant,
      createdBy: "Backfill Transport Fruit",
      updatedAt: Date.now(),
    };

    if (APPLY) {
      await db.collection("pointage_divers").doc(date).set(docData);
      docsWritten++;
    }

    console.log(`📅 ${date}  ${APPLY ? "✓ écrit" : "(dry-run)"}  préservées=${preservedCount}  transport=${matMap.size}  total=${totalMontant} DH`);
    for (const [mat, voySet] of matMap.entries()) {
      const cfg = cfgByMat.get(mat);
      const prix = Number(cfg.prixUnitaire) || 0;
      console.log(`     🚚 ${mat.padEnd(12)} ${voySet.size} voyages × ${prix} = ${voySet.size * prix} DH  [${[...voySet].sort().join(",")}]`);
    }
  }

  // Rapport final
  console.log("\n" + "═".repeat(78));
  console.log("📊 RÉSUMÉ");
  console.log("═".repeat(78));
  console.log(`Total voyages    : ${totalVoyages}`);
  console.log(`Dates traitées   : ${sortedDates.length - lockedDates.length}`);
  console.log(`Dates lockées    : ${lockedDates.length}${lockedDates.length ? "  → " + lockedDates.join(", ") : ""}`);
  console.log(`Matricules       : ${allMat.size}  (${[...allMat].join(", ")})`);
  if (missingPrices.length) {
    console.log(`\n⚠️ Matricules à tarifer (prix=0) :`);
    for (const m of missingPrices) console.log(`   • ${m}`);
    console.log(`→ Renseigner dans Pointage Divers › Config Sous-traitants puis re-runner.`);
  }
  console.log("");
  if (APPLY) {
    console.log(`✅ ${docsWritten} docs pointage_divers écrits.`);
  } else {
    console.log(`ℹ️ DRY-RUN — aucune écriture. Re-runner avec --apply pour appliquer.`);
  }
  console.log("═".repeat(78));

  await admin.app().delete();
}

main().catch((err) => {
  console.error("ERREUR:", err);
  process.exit(1);
});
