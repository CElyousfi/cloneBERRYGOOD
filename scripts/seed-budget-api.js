/**
 * Seed données démo via l'API REST deployée
 * Usage: node scripts/seed-budget-api.js
 */
const https = require("https");

const API = "https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/budgetService";
const SEASON = "2025-2026";
const UPDATER = { profileId: "finance", name: "Resp. Finance" };

function post(action, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ action, ...body });
    const url = new URL(API);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", d => raw += d);
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch { reject(new Error("Parse error: " + raw)); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ── Données ───────────────────────────────────────────────────────────────────
const VARIETIES_F5 = ["Corrina", "Cascade", "Breeze", "Yazmin cut back", "Reyna", "Myrtille nouvelle plantation"];
const VARIETIES_F1 = ["Maravilla LC", "Maravilla GLC"];

function normalizeCurve(raw) {
  const total = Object.values(raw).reduce((s, v) => s + v, 0);
  const out = {};
  Object.entries(raw).forEach(([w, v]) => { out[w] = Math.round(v / total * 10000) / 100; });
  return out;
}

const SEEDS = [
  // ── Saison ──
  { action: "save-season", payload: {
    id: SEASON, label: "Saison 2025-2026",
    startDate: "2025-10-01", endDate: "2026-09-30",
    status: "active", updatedBy: UPDATER,
  }},

  // ── Budget Production F5 ──
  // Corrina  : 4 kg/plant × 8 250 plants (2.5 ha) = 33 000 kg
  // Cascade  : 5 kg/plant × 5 028 plants (1.5 ha) = 25 140 kg
  // Breeze   : 4 kg/plant × 3 275 plants (1.0 ha) = 13 100 kg
  { action: "save-budget", payload: {
    season: SEASON, ferme: "F5", category: "production", updatedBy: UPDATER,
    varieties: {
      "Corrina":                        { recolte_kg:  33000, export_kg:  29700, marche_local_kg:  3300 },
      "Cascade":                        { recolte_kg:  25140, export_kg:  22626, marche_local_kg:  2514 },
      "Breeze":                         { recolte_kg:  13100, export_kg:  11790, marche_local_kg:  1310 },
      "Yazmin cut back":                { recolte_kg:  62000, export_kg:  55800, marche_local_kg:  6200 },
      "Reyna":                          { recolte_kg:  48000, export_kg:  43200, marche_local_kg:  4800 },
      "Myrtille nouvelle plantation":   { recolte_kg:  15000, export_kg:  12000, marche_local_kg:  3000 },
    },
  }},

  // ── Budget Production F1 ──
  // Maravilla LC  : 20 T/ha × 21 ha   = 420 000 kg
  // Maravilla GLC : 13 T/ha × 21.5 ha = 279 500 kg
  { action: "save-budget", payload: {
    season: SEASON, ferme: "F1", category: "production", updatedBy: UPDATER,
    varieties: {
      "Maravilla LC":  { recolte_kg: 420000, export_kg: 378000, marche_local_kg: 42000 },
      "Maravilla GLC": { recolte_kg: 279500, export_kg: 251550, marche_local_kg: 27950 },
    },
  }},

  // ── Budget Hors Récolte F5 ──
  { action: "save-budget", payload: {
    season: SEASON, ferme: "F5", category: "hors_recolte", updatedBy: UPDATER,
    varieties: Object.fromEntries(VARIETIES_F5.map((v, i) => {
      const f = [1, 0.6, 0.3, 0.2, 0.15, 0.05][i];
      return [v, {
        mod_generale_jh:      Math.round(12500 * f), palissage_jh:        Math.round(3200 * f),
        aeration_jh:          Math.round(2800  * f), plantation_jh:       Math.round(1500 * f),
        irrigation_jh:        Math.round(2200  * f), traitement_jh:       Math.round(3600 * f),
        entretien_serre_jh:   Math.round(1800  * f), entretien_domaine_jh: Math.round(900 * f),
        mod_caporaux_jh:      Math.round(2400  * f),
      }];
    })),
  }},

  // ── Budget Hors Récolte F1 ──
  { action: "save-budget", payload: {
    season: SEASON, ferme: "F1", category: "hors_recolte", updatedBy: UPDATER,
    varieties: Object.fromEntries(VARIETIES_F1.map((v, i) => {
      const f = [0.6, 0.4][i];
      return [v, {
        mod_generale_jh:      Math.round(18000 * f), palissage_jh:        Math.round(4500 * f),
        aeration_jh:          Math.round(3200  * f), plantation_jh:       Math.round(800  * f),
        irrigation_jh:        Math.round(2800  * f), traitement_jh:       Math.round(4200 * f),
        entretien_serre_jh:   Math.round(2100  * f), entretien_domaine_jh: Math.round(1000 * f),
        mod_caporaux_jh:      Math.round(2800  * f),
      }];
    })),
  }},

  // ── Budget Intrants F5 ──
  { action: "save-budget", payload: {
    season: SEASON, ferme: "F5", category: "intrants", updatedBy: UPDATER,
    varieties: Object.fromEntries(VARIETIES_F5.map((v, i) => {
      const f = [1, 0.6, 0.3, 0.2, 0.15, 0.05][i];
      return [v, { engrais_kdh: Math.round(850 * f), phytosanitaires_kdh: Math.round(420 * f), autres_intrants_kdh: Math.round(180 * f) }];
    })),
  }},

  // ── Budget Intrants F1 ──
  { action: "save-budget", payload: {
    season: SEASON, ferme: "F1", category: "intrants", updatedBy: UPDATER,
    varieties: Object.fromEntries(VARIETIES_F1.map((v, i) => {
      const f = [0.6, 0.4][i];
      return [v, { engrais_kdh: Math.round(1200 * f), phytosanitaires_kdh: Math.round(580 * f), autres_intrants_kdh: Math.round(240 * f) }];
    })),
  }},

  // ── Budget Coûts Récolte F5 ──
  { action: "save-budget", payload: {
    season: SEASON, ferme: "F5", category: "recolte_costs", updatedBy: UPDATER,
    varieties: Object.fromEntries(VARIETIES_F5.map(v => [v, { mod_recolte_jh: 0, vitesse_kg_h: 4.2, prix_ouvrier_dh_h: 18.5, cout_recolte_dh_kg: 4.41 }])),
  }},

  // ── Budget Coûts Récolte F1 ──
  { action: "save-budget", payload: {
    season: SEASON, ferme: "F1", category: "recolte_costs", updatedBy: UPDATER,
    varieties: Object.fromEntries(VARIETIES_F1.map(v => [v, { mod_recolte_jh: 0, vitesse_kg_h: 4.5, prix_ouvrier_dh_h: 18.5, cout_recolte_dh_kg: 4.11 }])),
  }},

  // ── Courbes F5 ──
  // Corrina : 4 kg/plant × 8250 plants (3300 pl/ha × 2.5 ha) = 33 000 kg
  { action: "save-curve", payload: {
    season: SEASON, ferme: "F5", variete: "Corrina", updatedBy: UPDATER,
    params: { kg_par_plante: 4, nbr_plant_ha: 3300, nbr_ha: 2.5, coefficient: 1.0, total_volume_kg: 33000 },
    weeks: normalizeCurve({ "12":1.2,"13":2.8,"14":5.4,"15":7.6,"16":9.8,"17":10.2,"18":10.8,"19":9.5,"20":8.3,"21":7.2,"22":6.1,"23":5.4,"24":4.8,"25":4.2,"26":3.5,"27":2.8,"28":2.1,"29":1.5,"30":0.9,"31":0.5,"32":0.4,"33":0.3,"34":0.3,"35":0.2 }),
  }},
  // Cascade : 5 kg/plant × 5028 plants (3352 pl/ha × 1.5 ha) = 25 140 kg
  { action: "save-curve", payload: {
    season: SEASON, ferme: "F5", variete: "Cascade", updatedBy: UPDATER,
    params: { kg_par_plante: 5, nbr_plant_ha: 3352, nbr_ha: 1.5, coefficient: 1.0, total_volume_kg: 25140 },
    weeks: normalizeCurve({ "14":0.8,"15":2.1,"16":4.5,"17":7.8,"18":9.6,"19":10.8,"20":11.2,"21":10.5,"22":9.4,"23":8.2,"24":7.1,"25":6.0,"26":4.8,"27":3.6,"28":2.4,"29":1.6,"30":0.9,"31":0.5,"32":0.3,"33":0.2 }),
  }},
  // Breeze : 4 kg/plant × 3275 plants (3275 pl/ha × 1.0 ha) = 13 100 kg
  { action: "save-curve", payload: {
    season: SEASON, ferme: "F5", variete: "Breeze", updatedBy: UPDATER,
    params: { kg_par_plante: 4, nbr_plant_ha: 3275, nbr_ha: 1.0, coefficient: 1.0, total_volume_kg: 13100 },
    weeks: normalizeCurve({ "13":1.5,"14":3.2,"15":6.8,"16":9.5,"17":11.2,"18":11.8,"19":10.6,"20":9.4,"21":8.2,"22":7.1,"23":6.0,"24":4.9,"25":3.8,"26":2.7,"27":1.8,"28":1.0,"29":0.5 }),
  }},
  { action: "save-curve", payload: {
    season: SEASON, ferme: "F5", variete: "Yazmin cut back", updatedBy: UPDATER,
    params: { kg_par_plante: 0.65, nbr_plant_ha: 18000, nbr_ha: 5, coefficient: 1.06, total_volume_kg: 62000 },
    weeks: normalizeCurve({ "16":2.0,"17":5.5,"18":9.2,"19":12.8,"20":13.5,"21":12.0,"22":10.5,"23":9.0,"24":7.5,"25":6.0,"26":4.5,"27":3.5,"28":2.5,"29":1.5 }),
  }},
  { action: "save-curve", payload: {
    season: SEASON, ferme: "F5", variete: "Reyna", updatedBy: UPDATER,
    params: { kg_par_plante: 0.60, nbr_plant_ha: 18000, nbr_ha: 4.5, coefficient: 1.0, total_volume_kg: 48000 },
    weeks: normalizeCurve({ "18":3.0,"19":7.2,"20":11.5,"21":13.8,"22":13.5,"23":12.0,"24":10.0,"25":8.5,"26":7.0,"27":5.5,"28":4.0,"29":3.0 }),
  }},
  { action: "save-curve", payload: {
    season: SEASON, ferme: "F5", variete: "Myrtille nouvelle plantation", updatedBy: UPDATER,
    params: { kg_par_plante: 0.30, nbr_plant_ha: 25000, nbr_ha: 2, coefficient: 1.0, total_volume_kg: 15000 },
    weeks: normalizeCurve({ "20":5.0,"21":10.0,"22":15.0,"23":18.0,"24":18.0,"25":15.0,"26":12.0,"27":7.0 }),
  }},

  // ── Courbes F1 ──
  // Maravilla LC  : 20 T/ha × 21 ha   = 420 000 kg   → kg/plant = 20000/25000 = 0.80
  { action: "save-curve", payload: {
    season: SEASON, ferme: "F1", variete: "Maravilla LC", updatedBy: UPDATER,
    params: { kg_par_plante: 0.80, nbr_plant_ha: 25000, nbr_ha: 21, coefficient: 1.0, total_volume_kg: 420000 },
    weeks: normalizeCurve({ "12":0.5,"13":1.8,"14":4.2,"15":6.8,"16":8.5,"17":9.8,"18":10.5,"19":9.8,"20":8.6,"21":7.5,"22":6.4,"23":5.5,"24":4.6,"25":4.0,"26":3.4,"27":2.8,"28":2.2,"29":1.6,"30":1.1,"31":0.6 }),
  }},
  // Maravilla GLC : 13 T/ha × 21.5 ha = 279 500 kg   → kg/plant = 13000/25000 = 0.52
  { action: "save-curve", payload: {
    season: SEASON, ferme: "F1", variete: "Maravilla GLC", updatedBy: UPDATER,
    params: { kg_par_plante: 0.52, nbr_plant_ha: 25000, nbr_ha: 21.5, coefficient: 1.0, total_volume_kg: 279500 },
    weeks: normalizeCurve({ "11":0.4,"12":1.2,"13":3.0,"14":5.8,"15":8.2,"16":10.0,"17":11.2,"18":10.8,"19":9.6,"20":8.4,"21":7.2,"22":6.0,"23":4.8,"24":4.0,"25":3.2,"26":2.6,"27":1.8,"28":1.2,"29":0.6 }),
  }},
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log("🌱 Seed démo Budget vs Réel via API —", SEASON);
  console.log("   Endpoint:", API, "\n");

  let ok = 0, fail = 0;
  for (const { action, payload } of SEEDS) {
    process.stdout.write(`  ${action.padEnd(15)} ${payload.ferme || ""}/${payload.category || payload.variete || payload.id || ""} … `);
    try {
      const res = await post(action, payload);
      if (res.success) { console.log("✓"); ok++; }
      else { console.log("✗", res.error); fail++; }
    } catch (e) { console.log("✗ ERR:", e.message); fail++; }
  }

  console.log(`\n${ok > 0 ? "✅" : "❌"} ${ok}/${SEEDS.length} documents créés — ${fail} erreur(s)`);

  if (ok > 0) {
    console.log("\n📊 Volumes budget réalistes:");
    console.log("   F5 — Corrina    : 4 kg/pl × 8 250 pl (2.5 ha) =  33 000 kg");
    console.log("   F5 — Cascade    : 5 kg/pl × 5 028 pl (1.5 ha) =  25 140 kg");
    console.log("   F5 — Breeze     : 4 kg/pl × 3 275 pl (1.0 ha) =  13 100 kg");
    console.log("   F5 — Yazmin     : inchangé                      =  62 000 kg");
    console.log("   F5 — Reyna      : inchangé                      =  48 000 kg");
    console.log("   F5 — Myrtille   : inchangé                      =  15 000 kg");
    console.log("   F5 TOTAL                                         = 196 240 kg");
    console.log("   F1 — Marav. LC  : 20 T/ha × 21 ha              = 420 000 kg");
    console.log("   F1 — Marav. GLC : 13 T/ha × 21.5 ha            = 279 500 kg");
    console.log("   F1 TOTAL                                         = 699 500 kg");
    console.log("   GRAND TOTAL                                      = 895 740 kg");
  }
}

run().catch(err => { console.error("Fatal:", err.message); process.exit(1); });
