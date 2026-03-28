/**
 * Script de démonstration — Budget vs Réel 2025-2026
 * Usage: node scripts/seed-budget-demo.js
 */
const admin = require("../functions/node_modules/firebase-admin");
const app = admin.initializeApp({ projectId: "berrygood-farms-dashboard" });
const db = admin.firestore();

const SEASON = "2025-2026";
const NOW = Date.now();

// ── Variétés ──────────────────────────────────────────────────────────────────
const VARIETIES_F5 = ["Corrina", "Cascade", "Breeze", "Yazmin cut back", "Reyna", "Myrtille nouvelle plantation"];
const VARIETIES_F1 = ["Maravilla LC", "Maravilla GLC"];

// ── Saison ───────────────────────────────────────────────────────────────────
const season = {
  label: "Saison 2025-2026",
  startDate: "2025-10-01",
  endDate: "2026-09-30",
  status: "active",
  createdAt: NOW,
  createdBy: { profileId: "finance", name: "Resp. Finance" },
  updatedAt: NOW,
};

// ── Budget Production F5 ──────────────────────────────────────────────────────
// Valeurs réalistes pour une ferme de myrtilles/framboises ~200ha
const productionF5 = {
  Corrina:                    { recolte_kg: 320000, export_kg: 288000, marche_local_kg: 32000 },
  Cascade:                    { recolte_kg: 180000, export_kg: 162000, marche_local_kg: 18000 },
  Breeze:                     { recolte_kg: 95000,  export_kg: 85500,  marche_local_kg: 9500  },
  "Yazmin cut back":          { recolte_kg: 62000,  export_kg: 55800,  marche_local_kg: 6200  },
  Reyna:                      { recolte_kg: 48000,  export_kg: 43200,  marche_local_kg: 4800  },
  "Myrtille nouvelle plantation": { recolte_kg: 15000, export_kg: 12000, marche_local_kg: 3000 },
};

// ── Budget Production F1 ──────────────────────────────────────────────────────
const productionF1 = {
  "Maravilla LC":  { recolte_kg: 420000, export_kg: 378000, marche_local_kg: 42000 },
  "Maravilla GLC": { recolte_kg: 280000, export_kg: 252000, marche_local_kg: 28000 },
};

// ── Budget Hors Récolte F5 ────────────────────────────────────────────────────
const horsRecolteFn = (factor = 1) => {
  const base = {
    mod_generale_jh:     Math.round(12500 * factor),
    palissage_jh:        Math.round(3200  * factor),
    aeration_jh:         Math.round(2800  * factor),
    plantation_jh:       Math.round(1500  * factor),
    irrigation_jh:       Math.round(2200  * factor),
    traitement_jh:       Math.round(3600  * factor),
    entretien_serre_jh:  Math.round(1800  * factor),
    entretien_domaine_jh: Math.round(900  * factor),
    mod_caporaux_jh:     Math.round(2400  * factor),
  };
  const varieties = {};
  VARIETIES_F5.forEach((v, i) => {
    const vFactor = [1, 0.6, 0.3, 0.2, 0.15, 0.05][i];
    const total = {};
    Object.keys(base).forEach(k => { total[k] = Math.round(base[k] * vFactor); });
    varieties[v] = total;
  });
  return varieties;
};

const horseRecoltesF1Fn = () => {
  const varieties = {};
  VARIETIES_F1.forEach((v, i) => {
    const vFactor = [0.6, 0.4][i];
    varieties[v] = {
      mod_generale_jh:      Math.round(18000 * vFactor),
      palissage_jh:         Math.round(4500  * vFactor),
      aeration_jh:          Math.round(3200  * vFactor),
      plantation_jh:        Math.round(800   * vFactor),
      irrigation_jh:        Math.round(2800  * vFactor),
      traitement_jh:        Math.round(4200  * vFactor),
      entretien_serre_jh:   Math.round(2100  * vFactor),
      entretien_domaine_jh: Math.round(1000  * vFactor),
      mod_caporaux_jh:      Math.round(2800  * vFactor),
    };
  });
  return varieties;
};

// ── Budget Intrants ───────────────────────────────────────────────────────────
const intrantsFn = (varieties, factors) => {
  const res = {};
  varieties.forEach((v, i) => {
    res[v] = {
      engrais_kdh:           Math.round(factors[i] * 850),
      phytosanitaires_kdh:   Math.round(factors[i] * 420),
      autres_intrants_kdh:   Math.round(factors[i] * 180),
    };
  });
  return res;
};

// ── Budget Coûts Récolte ─────────────────────────────────────────────────────
const recolteCostsFn = (varieties) => {
  const res = {};
  varieties.forEach(v => {
    res[v] = {
      mod_recolte_jh:      0,        // calculé à partir de la production
      vitesse_kg_h:        4.2,
      prix_ouvrier_dh_h:   18.5,
      cout_recolte_dh_kg:  4.41,     // prix_ouvrier / vitesse
    };
  });
  return res;
};

// ── Courbes Volume ────────────────────────────────────────────────────────────
// Semaines de récolte myrtille/framboise au Maroc : S12 → S38
// Distribution réaliste (pic S18-S25)
const CURVE_CORRINA = {
  "12": 1.2, "13": 2.8, "14": 5.4, "15": 7.6, "16": 9.8,
  "17": 10.2, "18": 10.8, "19": 9.5, "20": 8.3, "21": 7.2,
  "22": 6.1, "23": 5.4, "24": 4.8, "25": 4.2, "26": 3.5,
  "27": 2.8, "28": 2.1, "29": 1.5, "30": 0.9, "31": 0.5,
  "32": 0.4, "33": 0.3, "34": 0.3, "35": 0.2,
};

const CURVE_CASCADE = {
  "14": 0.8, "15": 2.1, "16": 4.5, "17": 7.8, "18": 9.6,
  "19": 10.8, "20": 11.2, "21": 10.5, "22": 9.4, "23": 8.2,
  "24": 7.1, "25": 6.0, "26": 4.8, "27": 3.6, "28": 2.4,
  "29": 1.6, "30": 0.9, "31": 0.5, "32": 0.3, "33": 0.2,
};

const CURVE_BREEZE = {
  "13": 1.5, "14": 3.2, "15": 6.8, "16": 9.5, "17": 11.2,
  "18": 11.8, "19": 10.6, "20": 9.4, "21": 8.2, "22": 7.1,
  "23": 6.0, "24": 4.9, "25": 3.8, "26": 2.7, "27": 1.8,
  "28": 1.0, "29": 0.5,
};

const CURVE_YAZMIN = {
  "16": 2.0, "17": 5.5, "18": 9.2, "19": 12.8, "20": 13.5,
  "21": 12.0, "22": 10.5, "23": 9.0, "24": 7.5, "25": 6.0,
  "26": 4.5, "27": 3.5, "28": 2.5, "29": 1.5,
};

const CURVE_REYNA = {
  "18": 3.0, "19": 7.2, "20": 11.5, "21": 13.8, "22": 13.5,
  "23": 12.0, "24": 10.0, "25": 8.5, "26": 7.0, "27": 5.5,
  "28": 4.0, "29": 3.0,
};

const CURVE_MYRTILLE_NEW = {
  "20": 5.0, "21": 10.0, "22": 15.0, "23": 18.0, "24": 18.0,
  "25": 15.0, "26": 12.0, "27": 7.0,
};

const CURVE_MARAVILLA_LC = {
  "12": 0.5, "13": 1.8, "14": 4.2, "15": 6.8, "16": 8.5,
  "17": 9.8, "18": 10.5, "19": 9.8, "20": 8.6, "21": 7.5,
  "22": 6.4, "23": 5.5, "24": 4.6, "25": 4.0, "26": 3.4,
  "27": 2.8, "28": 2.2, "29": 1.6, "30": 1.1, "31": 0.6,
};

const CURVE_MARAVILLA_GLC = {
  "11": 0.4, "12": 1.2, "13": 3.0, "14": 5.8, "15": 8.2,
  "16": 10.0, "17": 11.2, "18": 10.8, "19": 9.6, "20": 8.4,
  "21": 7.2, "22": 6.0, "23": 4.8, "24": 4.0, "25": 3.2,
  "26": 2.6, "27": 1.8, "28": 1.2, "29": 0.6,
};

// ── Normalise les % pour sommer à 100 ────────────────────────────────────────
function normalizeCurve(raw) {
  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  const normalized = {};
  Object.entries(raw).forEach(([w, v]) => {
    normalized[w] = Math.round((v / total) * 10000) / 100;
  });
  return normalized;
}

// ── Données des courbes ───────────────────────────────────────────────────────
const CURVES_F5 = [
  {
    variete: "Corrina",
    params: { kg_par_plante: 0.85, nbr_plant_ha: 25000, nbr_ha: 15, coefficient: 1.0, total_volume_kg: 320000 },
    weeks: normalizeCurve(CURVE_CORRINA),
  },
  {
    variete: "Cascade",
    params: { kg_par_plante: 0.90, nbr_plant_ha: 22000, nbr_ha: 9, coefficient: 1.0, total_volume_kg: 180000 },
    weeks: normalizeCurve(CURVE_CASCADE),
  },
  {
    variete: "Breeze",
    params: { kg_par_plante: 0.75, nbr_plant_ha: 20000, nbr_ha: 6, coefficient: 1.06, total_volume_kg: 95000 },
    weeks: normalizeCurve(CURVE_BREEZE),
  },
  {
    variete: "Yazmin cut back",
    params: { kg_par_plante: 0.65, nbr_plant_ha: 18000, nbr_ha: 5, coefficient: 1.06, total_volume_kg: 62000 },
    weeks: normalizeCurve(CURVE_YAZMIN),
  },
  {
    variete: "Reyna",
    params: { kg_par_plante: 0.60, nbr_plant_ha: 18000, nbr_ha: 4.5, coefficient: 1.0, total_volume_kg: 48000 },
    weeks: normalizeCurve(CURVE_REYNA),
  },
  {
    variete: "Myrtille nouvelle plantation",
    params: { kg_par_plante: 0.30, nbr_plant_ha: 25000, nbr_ha: 2, coefficient: 1.0, total_volume_kg: 15000 },
    weeks: normalizeCurve(CURVE_MYRTILLE_NEW),
  },
];

const CURVES_F1 = [
  {
    variete: "Maravilla LC",
    params: { kg_par_plante: 0.95, nbr_plant_ha: 22000, nbr_ha: 20, coefficient: 1.01, total_volume_kg: 420000 },
    weeks: normalizeCurve(CURVE_MARAVILLA_LC),
  },
  {
    variete: "Maravilla GLC",
    params: { kg_par_plante: 0.93, nbr_plant_ha: 22000, nbr_ha: 13.8, coefficient: 1.0, total_volume_kg: 280000 },
    weeks: normalizeCurve(CURVE_MARAVILLA_GLC),
  },
];

// ── Seed function ─────────────────────────────────────────────────────────────
async function seed() {
  console.log("🌱 Seed données démonstration Budget vs Réel — Saison", SEASON);

  const batch = db.batch();

  // 1. Saison
  batch.set(db.collection("budget_seasons").doc(SEASON), season);
  console.log("  ✓ Saison", SEASON);

  // 2. Budget entries F5
  const entries = [
    { ferme: "F5", category: "production",     varieties: productionF5 },
    { ferme: "F5", category: "hors_recolte",   varieties: horsRecolteFn() },
    { ferme: "F5", category: "intrants",        varieties: intrantsFn(VARIETIES_F5, [1, 0.6, 0.3, 0.2, 0.15, 0.05]) },
    { ferme: "F5", category: "recolte_costs",   varieties: recolteCostsFn(VARIETIES_F5) },
    { ferme: "F1", category: "production",     varieties: productionF1 },
    { ferme: "F1", category: "hors_recolte",   varieties: horseRecoltesF1Fn() },
    { ferme: "F1", category: "intrants",        varieties: intrantsFn(VARIETIES_F1, [0.6, 0.4]) },
    { ferme: "F1", category: "recolte_costs",   varieties: recolteCostsFn(VARIETIES_F1) },
  ];

  entries.forEach(e => {
    const docId = `${SEASON}_${e.ferme}_${e.category}`;
    batch.set(db.collection("budget_entries").doc(docId), {
      season: SEASON, ferme: e.ferme, category: e.category,
      varieties: e.varieties,
      updatedBy: { profileId: "finance", name: "Resp. Finance" },
      updatedAt: NOW,
    });
    console.log("  ✓ budget_entries:", docId);
  });

  // 3. Courbes F5
  CURVES_F5.forEach(c => {
    const docId = `${SEASON}_F5_${c.variete.replace(/\s+/g, "_")}`;
    batch.set(db.collection("budget_curves").doc(docId), {
      season: SEASON, ferme: "F5", variete: c.variete,
      params: c.params, weeks: c.weeks,
      updatedBy: { profileId: "finance", name: "Resp. Finance" },
      updatedAt: NOW,
    });
    console.log("  ✓ budget_curves:", docId);
  });

  // 4. Courbes F1
  CURVES_F1.forEach(c => {
    const docId = `${SEASON}_F1_${c.variete.replace(/\s+/g, "_")}`;
    batch.set(db.collection("budget_curves").doc(docId), {
      season: SEASON, ferme: "F1", variete: c.variete,
      params: c.params, weeks: c.weeks,
      updatedBy: { profileId: "finance", name: "Resp. Finance" },
      updatedAt: NOW,
    });
    console.log("  ✓ budget_curves:", docId);
  });

  // 5. Log import demo
  batch.set(db.collection("budget_imports").doc("seed_demo"), {
    season: SEASON, importedAt: NOW,
    importedBy: { profileId: "finance", name: "Resp. Finance" },
    type: "canevas",
    entriesCreated: entries.map(e => `${SEASON}_${e.ferme}_${e.category}`),
  });

  await batch.commit();
  console.log("\n✅ Seed terminé —", 1 + entries.length + CURVES_F5.length + CURVES_F1.length, "documents créés dans Firestore");

  // Résumé volumes
  console.log("\n📊 Volumes budget F5:");
  Object.entries(productionF5).forEach(([v, d]) => {
    console.log(`   ${v.padEnd(35)} ${d.recolte_kg.toLocaleString()} kg`);
  });
  const totalF5 = Object.values(productionF5).reduce((s, d) => s + d.recolte_kg, 0);
  console.log(`   ${"TOTAL F5".padEnd(35)} ${totalF5.toLocaleString()} kg`);

  console.log("\n📊 Volumes budget F1:");
  Object.entries(productionF1).forEach(([v, d]) => {
    console.log(`   ${v.padEnd(35)} ${d.recolte_kg.toLocaleString()} kg`);
  });
  const totalF1 = Object.values(productionF1).reduce((s, d) => s + d.recolte_kg, 0);
  console.log(`   ${"TOTAL F1".padEnd(35)} ${totalF1.toLocaleString()} kg`);
  console.log(`   ${"TOTAL FERMES".padEnd(35)} ${(totalF5 + totalF1).toLocaleString()} kg`);

  process.exit(0);
}

seed().catch(err => { console.error("❌ Erreur:", err.message); process.exit(1); });
