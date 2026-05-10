/**
 * Audit: mesure combien de pointages "Récolte" tombent encore dans le fallback
 * `quantiteToKg()` (parsing du nom d'opération) au lieu d'être écrasés par
 * la base de production (prod_tracabilite_recolte).
 *
 * Usage: cd functions && node audit-recolte-fallback.js
 */
const { db: db_firestore } = require("./config/firebase");
const { getPointageMeta, getPointageRowsForPeriode } = require("./firestoreDataService");

function quantiteToKg(quantiteUnite, operation) {
  const q = quantiteUnite || 0;
  const op = operation || "";
  const match = op.match(/([\d.]+)\s*kg/i);
  const factor = match ? parseFloat(match[1]) : 1.5;
  return { kg: Math.round(q * factor * 10) / 10, matched: !!match, factor };
}

(async () => {
  const meta = await getPointageMeta();
  const periodes = (meta?.periodes || []).slice(0, 2);
  console.log(`[audit] Periodes analysées: ${periodes.join(", ")}\n`);

  const allRows = [];
  for (const p of periodes) {
    const rows = await getPointageRowsForPeriode(p);
    allRows.push(...rows);
  }
  const recolteRows = allRows.filter(r => r.Operation_Famille === "8. Récolte");
  console.log(`[audit] Lignes Récolte: ${recolteRows.length}`);

  // Agréger par ouvrier+jour (mêmes clés que recolte-equipes)
  const grouped = {};
  for (const r of recolteRows) {
    const mat = (r.Personnel_Matricule || "").trim();
    const jour = r.DateStr;
    const op = (r.Operation || "").trim();
    const key = `${mat}|${jour}`;
    const { kg, matched } = quantiteToKg(r.Quantite_unite, op);
    if (!grouped[key]) {
      grouped[key] = {
        matricule: mat, jour, kg: 0, hadMatch: false, hadNoMatch: false,
        operations: new Set(), unmatchedOps: new Set(),
      };
    }
    grouped[key].kg += kg;
    grouped[key].operations.add(op);
    if (matched) grouped[key].hadMatch = true;
    else { grouped[key].hadNoMatch = true; grouped[key].unmatchedOps.add(op); }
  }
  const workerDays = Object.values(grouped);
  console.log(`[audit] Ouvrier-jours uniques: ${workerDays.length}\n`);

  // Vérifier couverture prod_tracabilite_recolte
  const dates = [...new Set(workerDays.map(w => w.jour))];
  const prodByDate = {};
  let docsExisting = 0;
  for (const d of dates) {
    const doc = await db_firestore.collection("prod_tracabilite_recolte").doc(d).get();
    if (doc.exists) {
      docsExisting++;
      const map = {};
      (doc.data().rows || []).forEach(r => {
        map[(r.matricule || "").toUpperCase()] = r;
      });
      prodByDate[d] = map;
    } else {
      prodByDate[d] = null;
    }
  }
  console.log(`[audit] Dates: ${dates.length}, dates avec doc prod: ${docsExisting}\n`);

  // Classer chaque ouvrier-jour
  let overridden = 0;          // remplacé par totalKg prod
  let fallbackParse = 0;        // pas de prod → quantiteToKg utilisé
  let fallbackDefault15 = 0;    // pas de prod ET au moins une op sans pattern kg
  let fallbackDefaultOnly = 0;  // pas de prod ET *aucune* op n'a de pattern kg
  const unmatchedOpsGlobal = {};
  const fallbackByDate = {};

  for (const w of workerDays) {
    const prodMap = prodByDate[w.jour];
    const prod = prodMap && prodMap[(w.matricule || "").toUpperCase()];
    if (prod) {
      overridden++;
    } else {
      fallbackParse++;
      fallbackByDate[w.jour] = (fallbackByDate[w.jour] || 0) + 1;
      if (w.hadNoMatch) {
        fallbackDefault15++;
        if (!w.hadMatch) fallbackDefaultOnly++;
        for (const op of w.unmatchedOps) {
          unmatchedOpsGlobal[op] = (unmatchedOpsGlobal[op] || 0) + 1;
        }
      }
    }
  }

  const total = workerDays.length;
  const pct = n => total ? ((n / total) * 100).toFixed(1) + "%" : "0%";

  console.log("===== RÉSULTAT AUDIT =====");
  console.log(`Total ouvrier-jours Récolte:        ${total}`);
  console.log(`✓ Écrasés par base prod:            ${overridden}  (${pct(overridden)})`);
  console.log(`✗ Fallback parsing nom d'opération: ${fallbackParse}  (${pct(fallbackParse)})`);
  console.log(`  └─ dont au moins 1 op sans "X kg" (→ default 1.5): ${fallbackDefault15}`);
  console.log(`  └─ dont *aucune* op n'a de pattern (100% default 1.5): ${fallbackDefaultOnly}`);
  console.log("");

  if (Object.keys(fallbackByDate).length) {
    console.log("Fallbacks par date (top 10):");
    Object.entries(fallbackByDate)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([d, n]) => console.log(`  ${d}: ${n}`));
    console.log("");
  }

  if (Object.keys(unmatchedOpsGlobal).length) {
    console.log("Opérations sans pattern 'X kg' rencontrées (default 1.5 appliqué):");
    Object.entries(unmatchedOpsGlobal)
      .sort((a, b) => b[1] - a[1])
      .forEach(([op, n]) => console.log(`  [${n}x] "${op}"`));
    console.log("");
  }

  console.log("Conclusion:");
  if (fallbackParse === 0) {
    console.log("  ✅ Aucun pointage ne dépend du parsing du nom — le basculement vers la base prod est complet.");
  } else {
    console.log(`  ⚠️  ${pct(fallbackParse)} des ouvrier-jours dépendent encore du parsing du nom d'opération.`);
    console.log("     → Étendre la sync prod_tracabilite_recolte pour couvrir ces dates/ouvriers,");
    console.log("       ou supprimer le fallback quantiteToKg pour forcer la donnée prod.");
  }

  process.exit(0);
})().catch(err => {
  console.error("[audit] ERROR:", err);
  process.exit(1);
});
