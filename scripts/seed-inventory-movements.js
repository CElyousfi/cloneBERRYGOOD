#!/usr/bin/env node
/**
 * Creates stock_movements of type "reception" for the initial inventory (30/06/2025).
 * This ensures the get-balances-at-date endpoint can reconstruct stock at any date
 * by replaying movements only (no need to separately load stock_balances).
 *
 * Usage: GOOGLE_APPLICATION_CREDENTIALS=... node scripts/seed-inventory-movements.js
 */

const path = require("path");
const fs = require("fs");
const admin = require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin"));
const XLSX = require(path.join(__dirname, "..", "functions", "node_modules", "xlsx"));

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

// Reuse mappings from import script
function normalizeFerme(raw) {
  if (!raw) return "";
  const s = String(raw).trim().toUpperCase();
  if (s === "EL BAHIA") return "BAHIA";
  return s.replace("F-0", "F").replace("F-", "F");
}

// Same ARTICLE_MAP as import-stock-caneva.js (we need resolveArticle)
const ARTICLE_MAP = {
  "ACIDE NITRIQUE (L)": "Ref-Eng0051", "ACIDE PHOSPHORIQUE (L)": "Ref-Eng0052",
  "AFRO- CUIVRE": "A00933", "AFRO- CUIVRE ": "A00933", "AGROZITE": "A00936", "AGROZITE ": "A00936",
  "ALPHA": "Ref-Eng0206", "AMMONITRATE (KG)": "Ref-Eng0113",
  "BACTOSPEINE": "NALSYABACTOSOEINE", "BARBARIAN": "A00840", "BARBARIAN ": "A00840",
  "BENEVIA (L)": "ONSSA-0782", "BETAMAX": "A00925", "BIOFORGE": "A00943",
  "BOUST FRUIT": "A00932", "BOUST FRUIT ": "A00932", "CARGO": "ONSSA-00235",
  "CLOCHE": "ONSSA-0326", "CO-ACTYL-H (KG)": "Ref-Eng0152", "CODACIDE": "A00912", "CODACIDE ": "A00912",
  "CUAJER": "A00919", "CYTORAD": "A00949", "DECIS expert": "ONSSA-0105", "DECIS expert ": "ONSSA-0105",
  "DIPEL DF": "A00931", "DIPEL DF ": "A00931", "ECOVIGOR (L)": "Ref-Eng0200",
  "EKLIPSO": "A00935", "ESCARDIX": "A00951", "EUROFIT MAX": "ref-Eng0790",
  "EXIREL": "ONSSA-00302", "EXTREME": "Ref-Eng0027", "FERTICOL": "onSSA-0745",
  "FOLI PLUS": "A00950", "FOLICIST": "Ref-Eng0158", "folicist": "Ref-Eng0158",
  "GC-MITE": "ONSSA-0135", "GC-MITE ": "ONSSA-0135", "GZ (L)": "Ref-Eng0028", "gz (L)": "Ref-Eng0028",
  "HUMOCAL (KG)": "ENG0146", "ISABION (L)": "ENG00522", "KALEO L": "A00924",
  "KALIGREEN": "ONSSA-0147", "KOLATIM (L)": "0096",
  "KSC 1 (KG)": "eng 456", "KSC 2 (KG)": "enr 14", "KSC 7": "eng 1245",
  "KSC MIX  (KG)": "Ref-Eng0062", "LAREKI": "ENG 0952", "MAGICAL (L)": "ENG 0150",
  "MAP (GK)": "Ref-Eng0065", "MASAMITE": "A00909", "MAXI FRUIT (L)": "ref-Eng0780",
  "MEGAFOL": "A00887", "MICRO MIX ORGA": "A00928", "MILBEKNOCK": "A00923",
  "N-K-P": "A00921", "NATURALIS": "ONSSA-0171",
  "NITRATE DE CALCIUM  (KG)": "Ref-Eng0073", "NITRATE DE MAGNESIE (KG)": "Ref-Eng0184",
  "OPAL (L)": "A00926", "ORIS": "Ref-Eng0203", "ORTIVA": "A00927",
  "PIRIMOR": "ONSSA-0203", "POTABIO": "A00930", "POTABIO ": "A00930",
  "PRESTIGE (KG)": "A00774", "RADIAN": "ONSSA-0350", "RAIZANTE": "Ref-Eng0012",
  "RHIZO AMINE (L)": "Ref-Eng0056", "RHIZO BOR (KG)": "Ref-Eng0044",
  "RHIZO CAL": "Ref-Eng0045", "RHIZO HUMUS (L)": "Ref-Eng0046", "RHIZO hUMUS (L)": "Ref-Eng0046",
  "SALTRAD": "Ref-Eng0049", "SC CALCUIM": "A00922", "SCORE (L)": "ONSSA-0322",
  "SERGOMIL": "A60", "SERGOMIL ": "A60", "SIBERIO": "A2",
  "SIGNUM": "ONSSA-0221", "SMART PH": "A00911", "smart ph": "A00911",
  "SOLUPOTASSE (Kg)": "Ref-Eng0101", "SULFACIDE (L)": "Eng0220",
  "Sulfate d'ammoniaque": "Ref-Eng0103", "Sulfate d'ammoniaque ": "Ref-Eng0103",
  "SULFATE DE MAGNESIE (KG)": "Ref-Eng0106", "SULFATE DE MANGANESE": "Ref-Eng0107",
  "SULFATE DE ZINC  (KG)": "Ref-Eng0110", "SWITCH (KG)": "ONSSA-0242",
  "TELDOR (KG)": "ONSSA-0244", "TEPPEKI": "A00877", "TOPAS (L)": "ONSSA-0200",
  "VERIMARK": "A00883", "VIDISHINE": "A61", "VITAL": "Ref-Eng0183",
  // New articles from import
  "ACIDE SULFRIQUE (L)": "IMP-001", "ACRAMET (KG)": "IMP-002", "ALIÉTTE": "IMP-003",
  "APPOLO (L)": "IMP-004", "AZO PRO 31 (KG)": "IMP-005", "Alga 600": "IMP-006",
  "BIOACTYL SUPERBE (KG)": "IMP-007", "BOOM SUPER": "IMP-008", "DEPTIL PA5 (L)": "IMP-009",
  "GOLD BMO": "IMP-010", "GREENTON": "IMP-011", "KELPARK": "IMP-012",
  "KSC 3 (KG)": "IMP-013", "KSC 5": "IMP-014", "M-K-P": "IMP-015",
  "MALATHION 50 (L)": "IMP-016", "MERJANE CAPTANE": "IMP-017", "MOVINTO": "IMP-018",
  "NITRETE DE POTASSE": "IMP-019", "PRIORITOP": "IMP-020", "PROGIBB": "IMP-021",
  "RHIZO MN ZN (KG)": "IMP-022", "TOUCHDOWN": "IMP-023", "UNIFORME": "IMP-024",
  "URÉE 46%": "IMP-025", "VERTIMIC": "IMP-026",
};

function resolveArticle(rawName) {
  if (!rawName) return { ref: "", nom: "" };
  const name = String(rawName).trim();
  if (ARTICLE_MAP[name]) return { ref: ARTICLE_MAP[name], nom: name };
  const stripped = name.replace(/\s+$/, "");
  if (ARTICLE_MAP[stripped]) return { ref: ARTICLE_MAP[stripped], nom: stripped };
  for (const [k, v] of Object.entries(ARTICLE_MAP)) {
    if (k.trim().toUpperCase() === stripped.toUpperCase()) return { ref: v, nom: stripped };
  }
  const ref = "IMP-" + stripped.replace(/[^a-zA-Z0-9]/g, "").slice(0, 30).toUpperCase();
  return { ref, nom: stripped };
}

async function main() {
  const EXCEL_PATH = path.join(__dirname, "..", "CANEVA STOCK BGF POUR SMARTBERRY (1).xlsx");
  if (!fs.existsSync(EXCEL_PATH)) { console.error("Excel file not found"); process.exit(1); }

  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const ws = wb.Sheets["INVENTAIRE AU 30-06-25"];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }).slice(1).filter(r => r[2]);

  console.log(`Parsed ${rows.length} inventory rows`);

  // Check if already seeded
  const existing = await db.collection("stock_movements")
    .where("import_source", "==", "CANEVA_STOCK_BGF_INV").limit(1).get();
  if (!existing.empty) {
    console.log("Inventory movements already exist. Skipping.");
    process.exit(0);
  }

  // Group by ferme
  const groups = {};
  for (const row of rows) {
    const lieu = normalizeFerme(row[1]);
    const { ref: artRef, nom: artNom } = resolveArticle(row[2]);
    const unite = String(row[3] || "kg").trim();
    const qte = parseFloat(row[4]) || 0;
    if (!lieu || !artRef || qte === 0) continue;
    if (!groups[lieu]) groups[lieu] = [];
    groups[lieu].push({ article_ref: artRef, article_nom: artNom, quantite: Math.round(qte * 100) / 100, unite });
  }

  const now = Date.now();
  const batch = db.batch();
  let count = 0;

  for (const [ferme, items] of Object.entries(groups)) {
    count++;
    const ref = db.collection("stock_movements").doc();
    batch.set(ref, {
      numero: `IMP-INV-${String(count).padStart(4, "0")}`,
      type: "reception",
      date: "2025-06-30",
      lieu_source: null,
      lieu_destination: { type: "magasin", id: ferme },
      ferme,
      items,
      ref_bl_fournisseur: "",
      fournisseur_nom: "Inventaire initial",
      bdc_id: null,
      bl_id: null,
      reception_libre: true,
      reception_libre_motif: "Inventaire initial au 30/06/2025",
      ref_bon_physique: "",
      sortie_type: null,
      scan_url: null,
      status: "valide_chef",
      validations: {
        magasinier: { by: "import_caneva", name: "Import CANEVA", at: now },
        achats: { by: "import_caneva", name: "Import CANEVA", at: now },
        chef: { by: "import_caneva", name: "Import CANEVA", at: now },
      },
      rejection: null,
      created_by: { userId: "import_caneva", name: "Import CANEVA" },
      created_at: now,
      updated_at: now,
      import_source: "CANEVA_STOCK_BGF_INV",
    });
  }

  await batch.commit();
  console.log(`Created ${count} inventory movements (1 per ferme: ${Object.keys(groups).join(", ")})`);
  console.log("Done.");
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
