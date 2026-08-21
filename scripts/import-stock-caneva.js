#!/usr/bin/env node
/**
 * Import stock data from "CANEVA STOCK BGF POUR SMARTBERRY (1).xlsx" into Firestore.
 *
 * Phases:
 *   1. Parse Excel (6 sheets)
 *   2. Sync articles catalog (create missing articles)
 *   3. Initialize stock_balances from inventory (30/06/2025)
 *   4. Import Bons d'Entree (receptions)
 *   5. Import Bons de Transfert
 *   6. Import Bons de Consommation
 *   7. Import Bons de Sortie
 *   8. Validate vs Stock Reel (31/03/2026)
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=... node scripts/import-stock-caneva.js [--dry-run] [--clean] [--file=<path>]
 *
 * The Excel path defaults to the latest CANEVA file at repo root. Pass --file=<path>
 * (or a positional non-flag argument) to point at a different workbook. The
 * "STOCK REEL A 31.03.2026" sheet is optional: when absent, Phase 8 (reconciliation)
 * is skipped cleanly and the rest of the pipeline runs normally.
 *
 * ⚠️ RÈGLE DE TYPAGE DES LIEUX — DUPLIQUÉE EN 3 ENDROITS.
 * Règle : seules les FERMES du groupe (F1..F6, BAHIA) sont des 'magasin'. Sur
 * les BONS DE SORTIE, tout le reste (fournisseur, prestataire, décharge,
 * client) reste 'externe'. ⚠️ Asymétrie pré-existante, hors périmètre : les
 * TRANSFERTS utilisent buildLieu nu, une destination non-ferme y devient donc
 * 'parcelle'.
 * Toute modification doit être répercutée dans LES TROIS :
 *   - functions/lib/stockCaneva/mappings.js   (buildLieu — chemin Cloud Function)
 *   - scripts/import-stock-caneva.js          (buildLieu — ce fichier)
 *   - scripts/reconstruct-stock.js            (lieuFromCode)
 * Pas encore factorisé : scripts/ est hors du périmètre de déploiement de
 * functions/, la mutualisation mérite son propre ticket.
 */

const path = require("path");
const fs = require("fs");
const admin = require(path.join(__dirname, "..", "functions", "node_modules", "firebase-admin"));
const XLSX = require(path.join(__dirname, "..", "functions", "node_modules", "xlsx"));

// --- Firebase init ---
admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

// --- CLI flags ---
const DRY_RUN = process.argv.includes("--dry-run");
const CLEAN = process.argv.includes("--clean");
const IMPORT_SOURCE = "CANEVA_STOCK_BGF";

// Default workbook (the system adapts to the file, the file is not reformatted).
const DEFAULT_EXCEL_FILE = "CANEVA STOCK BGF POUR SMARTBERRY 5-30-2026.xlsx";

// Resolve the Excel path: --file=<path>, or first positional non-flag arg, else default.
function resolveExcelPath() {
  const args = process.argv.slice(2);
  const fileFlag = args.find(a => a.startsWith("--file="));
  if (fileFlag) {
    const p = fileFlag.slice("--file=".length).trim();
    return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  }
  const positional = args.find(a => !a.startsWith("--"));
  if (positional) {
    return path.isAbsolute(positional) ? positional : path.join(process.cwd(), positional);
  }
  return path.join(__dirname, "..", DEFAULT_EXCEL_FILE);
}
const IMPORT_TIMESTAMP = Date.now();

// ============================================================
// MAPPING TABLES
// ============================================================

// Excel farm ID -> System farm ID
function normalizeFerme(raw) {
  if (!raw) return "";
  const s = String(raw).trim().toUpperCase();
  if (s === "EL BAHIA") return "BAHIA";
  return s.replace("F-0", "F").replace("F-", "F");
}

// Excel date (serial or Date object) -> ISO string
function toISO(val) {
  if (!val) return "";
  if (val instanceof Date) return val.toISOString().split("T")[0];
  if (typeof val === "string") return val;
  // Excel serial
  const d = new Date((val - 25569) * 86400 * 1000);
  return d.toISOString().split("T")[0];
}

// Build lieu object from raw farm/location name
function buildLieu(raw) {
  if (!raw) return null;
  const norm = normalizeFerme(raw);
  if (["F1", "F2", "F3", "F4", "F5", "F6"].includes(norm)) {
    return { type: "magasin", id: norm };
  }
  // BAHIA est une FERME du groupe → magasin (cf. docs/spec-magasin-bahia.md).
  if (norm === "BAHIA") return { type: "magasin", id: "BAHIA" };
  // Parcelle (from consommation)
  return { type: "parcelle", id: String(raw).trim() };
}

// Excel article name -> catalogue reference (84 known mappings)
const ARTICLE_MAP = {
  "ACIDE NITRIQUE (L)": "Ref-Eng0051",
  "ACIDE PHOSPHORIQUE (L)": "Ref-Eng0052",
  "AFRO- CUIVRE": "A00933",
  "AFRO- CUIVRE ": "A00933",
  "AGROZITE": "A00936",
  "AGROZITE ": "A00936",
  "ALPHA": "Ref-Eng0206",
  "AMMONITRATE (KG)": "Ref-Eng0113",
  "BACTOSPEINE": "NALSYABACTOSOEINE",
  "BARBARIAN": "A00840",
  "BARBARIAN ": "A00840",
  "BENEVIA (L)": "ONSSA-0782",
  "BETAMAX": "A00925",
  "BIOFORGE": "A00943",
  "BOUST FRUIT": "A00932",
  "BOUST FRUIT ": "A00932",
  "CARGO": "ONSSA-00235",
  "CLOCHE": "ONSSA-0326",
  "CO-ACTYL-H (KG)": "Ref-Eng0152",
  "CODACIDE": "A00912",
  "CODACIDE ": "A00912",
  "CUAJER": "A00919",
  "CYTORAD": "A00949",
  "DECIS expert": "ONSSA-0105",
  "DECIS expert ": "ONSSA-0105",
  "DIPEL DF": "A00931",
  "DIPEL DF ": "A00931",
  "ECOVIGOR (L)": "Ref-Eng0200",
  "EKLIPSO": "A00935",
  "ESCARDIX": "A00951",
  "EUROFIT MAX": "ref-Eng0790",
  "EXIREL": "ONSSA-00302",
  "EXTREME": "Ref-Eng0027",
  "FERTICOL": "onSSA-0745",
  "FOLI PLUS": "A00950",
  "FOLICIST": "Ref-Eng0158",
  "folicist": "Ref-Eng0158",
  "GC-MITE": "ONSSA-0135",
  "GC-MITE ": "ONSSA-0135",
  "GZ (L)": "Ref-Eng0028",
  "gz (L)": "Ref-Eng0028",
  "HUMOCAL (KG)": "ENG0146",
  "ISABION (L)": "ENG00522",
  "KALEO L": "A00924",
  "KALIGREEN": "ONSSA-0147",
  "KOLATIM (L)": "0096",
  "KSC 1 (KG)": "eng 456",
  "KSC 2 (KG)": "enr 14",
  "KSC 7": "eng 1245",
  "KSC MIX  (KG)": "Ref-Eng0062",
  "LAREKI": "ENG 0952",
  "MAGICAL (L)": "ENG 0150",
  "MAP (GK)": "Ref-Eng0065",
  "MASAMITE": "A00909",
  "MAXI FRUIT (L)": "ref-Eng0780",
  "MEGAFOL": "A00887",
  "MICRO MIX ORGA": "A00928",
  "MILBEKNOCK": "A00923",
  "N-K-P": "A00921",
  "NATURALIS": "ONSSA-0171",
  "NITRATE DE CALCIUM  (KG)": "Ref-Eng0073",
  "NITRATE DE MAGNESIE (KG)": "Ref-Eng0184",
  "OPAL (L)": "A00926",
  "ORIS": "Ref-Eng0203",
  "ORTIVA": "A00927",
  "PIRIMOR": "ONSSA-0203",
  "POTABIO": "A00930",
  "POTABIO ": "A00930",
  "PRESTIGE (KG)": "A00774",
  "RADIAN": "ONSSA-0350",
  "RAIZANTE": "Ref-Eng0012",
  "RHIZO AMINE (L)": "Ref-Eng0056",
  "RHIZO BOR (KG)": "Ref-Eng0044",
  "RHIZO CAL": "Ref-Eng0045",
  "RHIZO HUMUS (L)": "Ref-Eng0046",
  "RHIZO hUMUS (L)": "Ref-Eng0046",
  "SALTRAD": "Ref-Eng0049",
  "SC CALCUIM": "A00922",
  "SCORE (L)": "ONSSA-0322",
  "SERGOMIL": "A60",
  "SERGOMIL ": "A60",
  "SIBERIO": "A2",
  "SIGNUM": "ONSSA-0221",
  "SMART PH": "A00911",
  "smart ph": "A00911",
  "SOLUPOTASSE (Kg)": "Ref-Eng0101",
  "SULFACIDE (L)": "Eng0220",
  "Sulfate d'ammoniaque": "Ref-Eng0103",
  "Sulfate d'ammoniaque ": "Ref-Eng0103",
  "SULFATE DE MAGNESIE (KG)": "Ref-Eng0106",
  "SULFATE DE MANGANESE": "Ref-Eng0107",
  "SULFATE DE ZINC  (KG)": "Ref-Eng0110",
  "SWITCH (KG)": "ONSSA-0242",
  "TELDOR (KG)": "ONSSA-0244",
  "TEPPEKI": "A00877",
  "TOPAS (L)": "ONSSA-0200",
  "VERIMARK": "A00883",
  "VIDISHINE": "A61",
  "VITAL": "Ref-Eng0183",
};

// Articles that need to be created (not in catalogue)
const NEW_ARTICLES = [
  { nom: "ACIDE SULFRIQUE (L)", unite: "L", categorie: "Engrais" },
  { nom: "ACRAMET (KG)", unite: "L", categorie: "Pesticides" },
  { nom: "ALIÉTTE", unite: "L", categorie: "Pesticides" },
  { nom: "APPOLO (L)", unite: "L", categorie: "Pesticides" },
  { nom: "AZO PRO 31 (KG)", unite: "L", categorie: "Engrais" },
  { nom: "Alga 600", unite: "L", categorie: "Engrais" },
  { nom: "BIOACTYL SUPERBE (KG)", unite: "L", categorie: "Engrais" },
  { nom: "BOOM SUPER", unite: "L", categorie: "Pesticides" },
  { nom: "DEPTIL PA5 (L)", unite: "L", categorie: "Engrais" },
  { nom: "GOLD BMO", unite: "L", categorie: "Engrais" },
  { nom: "GREENTON", unite: "L", categorie: "Engrais" },
  { nom: "KELPARK", unite: "KG", categorie: "Engrais" },
  { nom: "KSC 3 (KG)", unite: "L", categorie: "Engrais" },
  { nom: "KSC 5", unite: "KG", categorie: "Engrais" },
  { nom: "M-K-P", unite: "L", categorie: "Engrais" },
  { nom: "MALATHION 50 (L)", unite: "KG", categorie: "Pesticides" },
  { nom: "MERJANE CAPTANE", unite: "L", categorie: "Pesticides" },
  { nom: "MOVINTO", unite: "L", categorie: "Pesticides" },
  { nom: "NITRETE DE POTASSE", unite: "L", categorie: "Engrais" },
  { nom: "PRIORITOP", unite: "KG", categorie: "Engrais" },
  { nom: "PROGIBB", unite: "L", categorie: "Engrais" },
  { nom: "RHIZO MN ZN (KG)", unite: "L", categorie: "Engrais" },
  { nom: "TOUCHDOWN", unite: "L", categorie: "Pesticides" },
  { nom: "UNIFORME", unite: "KG", categorie: "Pesticides" },
  { nom: "URÉE 46%", unite: "L", categorie: "Engrais" },
  { nom: "VERTIMIC", unite: "KG", categorie: "Pesticides" },
];

// Parcelle name mapping (Excel -> system)
const PARCELLE_MAP = {
  "S3 MARAVILLA MOTTE F1": "S3 Maravilla Motte",
  "S7 MARAVILLA MOTTE F1": "S7 Maravilla Motte",
  "S1/S4 MARAVILLA MOW DOWN F1": "S1 Maravilla",
  "S2 YAZMIN MOW DOWN F1": "S2 Yazmin",
  "S5 YAZMIN MOW DOWN F1": "S5 Yazmin",
  " S1.S4 Maravilla green can F1": "S1 Maravilla",
  "S1.S4 Maravilla green can F1": "S1 Maravilla",
  "S2.S3.S5.S6.S7 maravilla logn can F1": "S7 Maravilla Motte",
  "S10 YAZMIN MOTTE F5": "S10 Yazmin",
  "S10 YAZMIN CUT BACK F5": "S10 Yazmin",
  "S13 YAZMIN MOW DOWN F5": "S13 Yazmin",
  "S9 REYNA F5": "S9 Reyna",
  "CORINA MYRTILLE S8": "S8 Corina",
  "BREEZE MYRTILLE S8-2": "S8 Corina",
  "CASCADE MYRTILLE S8-1": "S8 Corina",
  "1/Σ AVOCAT": "Avocat F2",
  "Σ AVOCAT   F-06": "Avocat F6",
};

// Sortie motif -> sortie_type
function mapMotifToSortieType(motif) {
  if (!motif) return "pret";
  const m = String(motif).toLowerCase();
  if (m.includes("retour")) return "retour_fournisseur";
  return "pret";
}

// Normalize article name for lookup
function resolveArticle(rawName) {
  if (!rawName) return { ref: "", nom: "" };
  const name = String(rawName).trim();
  // Direct map (exact)
  if (ARTICLE_MAP[name]) return { ref: ARTICLE_MAP[name], nom: name };
  // Try with trailing space stripped
  const stripped = name.replace(/\s+$/, "");
  if (ARTICLE_MAP[stripped]) return { ref: ARTICLE_MAP[stripped], nom: stripped };
  // Try uppercase
  for (const [k, v] of Object.entries(ARTICLE_MAP)) {
    if (k.trim().toUpperCase() === stripped.toUpperCase()) return { ref: v, nom: stripped };
  }
  // New article: use IMP- ref
  const ref = "IMP-" + stripped.replace(/[^a-zA-Z0-9]/g, "").slice(0, 30).toUpperCase();
  return { ref, nom: stripped };
}

// ============================================================
// HELPERS
// ============================================================

const BATCH_LIMIT = 450;

async function commitBatches(operations) {
  for (let i = 0; i < operations.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = operations.slice(i, i + BATCH_LIMIT);
    for (const op of chunk) {
      if (op.type === "set") batch.set(op.ref, op.data, op.options || {});
      else if (op.type === "delete") batch.delete(op.ref);
    }
    if (!DRY_RUN) await batch.commit();
    process.stdout.write(`  batch ${Math.floor(i / BATCH_LIMIT) + 1}/${Math.ceil(operations.length / BATCH_LIMIT)} committed\n`);
  }
}

// Update stock balance atomically (mirrors functions/index.js:5953)
async function updateStockBalance(lieuType, lieuId, articleRef, articleNom, unite, delta) {
  if (DRY_RUN) return;
  const balanceId = `${lieuType}_${lieuId}_${articleRef}`.replace(/\s+/g, "_");
  const balRef = db.collection("stock_balances").doc(balanceId);
  await db.runTransaction(async (t) => {
    const snap = await t.get(balRef);
    const current = snap.exists ? (snap.data().balance || 0) : 0;
    const newBalance = Math.round((current + delta) * 100) / 100;
    t.set(balRef, {
      lieu_type: lieuType,
      lieu_id: lieuId,
      article_ref: articleRef,
      article_nom: articleNom,
      unite: unite || "kg",
      balance: newBalance,
      updated_at: IMPORT_TIMESTAMP,
    }, { merge: true });
  });
}

// Run tasks with limited concurrency
async function runConcurrent(tasks, limit = 10) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Common fields for imported movements
function baseMovement(type, numero) {
  const needsMulti = type === "reception" || type === "sortie";
  const validations = {
    magasinier: { by: "import_caneva", name: "Import CANEVA", at: IMPORT_TIMESTAMP },
  };
  if (needsMulti) {
    validations.achats = { by: "import_caneva", name: "Import CANEVA", at: IMPORT_TIMESTAMP };
    validations.chef = { by: "import_caneva", name: "Import CANEVA", at: IMPORT_TIMESTAMP };
  }
  return {
    numero,
    type,
    status: needsMulti ? "valide_chef" : "valide_mag",
    validations,
    rejection: null,
    created_by: { userId: "import_caneva", name: "Import CANEVA" },
    created_at: IMPORT_TIMESTAMP,
    updated_at: IMPORT_TIMESTAMP,
    import_source: IMPORT_SOURCE,
    scan_url: null,
  };
}

// ============================================================
// PRICE & COST TRACKING
// ============================================================

// Map article_ref -> { prix_ttc_inventaire, prix_ttc_achat, derniere_date_achat }
const articlePriceMap = {};

function resolvePrice(artRef) {
  const p = articlePriceMap[artRef];
  if (!p) return 0;
  return p.prix_ttc_achat || p.prix_ttc_inventaire || 0;
}

// Parcelle (system name after PARCELLE_MAP) -> CPC variety
const PARCELLE_TO_CPC = {
  "S3 Maravilla Motte": { variete: "Maravilla MT", cpc_code: "S3S7_MAR_MT", ferme: "F1" },
  "S7 Maravilla Motte": { variete: "Maravilla MT", cpc_code: "S3S7_MAR_MT", ferme: "F1" },
  "S1 Maravilla":       { variete: "Maravilla MD", cpc_code: "S1S4_MAR_MD", ferme: "F1" },
  "S2 Yazmin":          { variete: "Yazmin MD", cpc_code: "S2S5_YAZ_MD", ferme: "F1" },
  "S5 Yazmin":          { variete: "Yazmin MD", cpc_code: "S2S5_YAZ_MD", ferme: "F1" },
  "S10 Yazmin":         { variete: "Yazmin MT", cpc_code: "S10_YAZ_MT", ferme: "F5" },
  "S13 Yazmin":         { variete: "Yazmin MD", cpc_code: "S13_YAZ_MD", ferme: "F5" },
  "S9 Reyna":           { variete: "Reyna", cpc_code: "S9_REYNA", ferme: "F5" },
  "S8 Corina":          { variete: "Corina", cpc_code: "CORINA", ferme: "F5" },
  "Avocat F2":          { variete: "Avocat", cpc_code: "AVOCAT", ferme: "Avocatier" },
  "Avocat F6":          { variete: "Avocat", cpc_code: "AVOCAT", ferme: "Avocatier" },
  "CASCADE MYRTILLE S8-1": { variete: "Cascade", cpc_code: "CASCADE", ferme: "F1" },
  "CASCADE S13 F5":        { variete: "Cascade", cpc_code: "CASCADE", ferme: "F5" },
  "BREEZE MYRTILLE S8-2":  { variete: "Breeze", cpc_code: "BREEZE", ferme: "F1" },
  "BREEZE S14 F5":         { variete: "Breeze", cpc_code: "BREEZE", ferme: "F5" },
};

// ============================================================
// MAIN
// ============================================================

async function main() {
  console.log(`=== Import CANEVA Stock BGF ===`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN (no writes)" : "LIVE"}`);
  console.log("");

  // --- PHASE 1: Parse Excel ---
  console.log("Phase 1: Parsing Excel...");
  const EXCEL_PATH = resolveExcelPath();
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`File not found: ${EXCEL_PATH}`);
    console.error(`Pass --file=<path> to point at the workbook (default: ${DEFAULT_EXCEL_FILE}).`);
    process.exit(1);
  }
  console.log(`  File: ${EXCEL_PATH}`);

  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  console.log("  Sheet names:", wb.SheetNames);

  // optional=true silences the "not found" log for sheets that may legitimately be absent.
  function parseSheet(name, optional) {
    const ws = wb.Sheets[name];
    if (!ws) {
      if (!optional) console.error(`Sheet "${name}" not found`);
      return [];
    }
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  }

  const rawInventaire = parseSheet("INVENTAIRE AU 30-06-25").slice(1).filter(r => r[2]);
  const rawEntrees = parseSheet("BONS D ENTREE").slice(1).filter(r => r[4] && String(r[4]).trim());
  const rawTransferts = parseSheet("BONS DE TRANSFERT").slice(1).filter(r => r[4] && String(r[4]).trim());
  const rawConsommations = parseSheet("BONS CONSOMMATION").slice(1).filter(r => r[5] && String(r[5]).trim());
  const rawSorties = parseSheet("BONS SORTIE").slice(1).filter(r => r[5] && String(r[5]).trim());
  const STOCK_REEL_SHEET = "STOCK REEL A 31.03.2026";
  const hasStockReel = !!wb.Sheets[STOCK_REEL_SHEET];
  const rawStockReel = hasStockReel
    ? parseSheet(STOCK_REEL_SHEET, true).slice(3).filter(r => r[0] && String(r[0]).trim())
    : [];

  // The TRANSFERT sheet exists in two layouts: with or without a UNITE column.
  //   layout A (legacy): DATE, BON, DEPART, ARRIVEE, NOM ARTICLE, UNITE, QUNTITE
  //   layout B (new):    DATE, BON, DEPART, ARRIVEE, NOM ARTICLE, QUNTITE
  // Detect from the header so the right column indexes are used for each file.
  const rawTransfertHeader = parseSheet("BONS DE TRANSFERT")[0] || [];
  const transfertHasUnite = String(rawTransfertHeader[5] || "").trim().toUpperCase() === "UNITE";
  const TRANSFERT_COLS = transfertHasUnite
    ? { unite: 5, qte: 6 }
    : { unite: null, qte: 5 };

  console.log(`  Inventaire: ${rawInventaire.length} rows`);
  console.log(`  Bons Entree: ${rawEntrees.length} rows`);
  console.log(`  Bons Transfert: ${rawTransferts.length} rows (layout ${transfertHasUnite ? "avec UNITE" : "sans UNITE"})`);
  console.log(`  Bons Consommation: ${rawConsommations.length} rows`);
  console.log(`  Bons Sortie: ${rawSorties.length} rows`);
  console.log(`  Stock Reel: ${hasStockReel ? rawStockReel.length + " rows" : "feuille absente"}`);
  console.log("");

  // --- PHASE 0: Clean if requested ---
  if (CLEAN && !DRY_RUN) {
    console.log("Phase 0: Cleaning previous import...");
    const colls = ["stock_movements", "stock_balances", "articles_catalog", "consumption_costs_by_variety"];
    for (const coll of colls) {
      let q;
      if (coll === "stock_balances" || coll === "consumption_costs_by_variety") {
        // Delete all docs (will be rebuilt)
        const snap = await db.collection(coll).get();
        const ops = snap.docs.map(d => ({ type: "delete", ref: d.ref }));
        if (ops.length > 0) {
          await commitBatches(ops);
          console.log(`  Deleted ${ops.length} docs from ${coll}`);
        }
      } else {
        const snap = await db.collection(coll).where("import_source", "==", IMPORT_SOURCE).get();
        const ops = snap.docs.map(d => ({ type: "delete", ref: d.ref }));
        if (ops.length > 0) {
          await commitBatches(ops);
          console.log(`  Deleted ${ops.length} docs from ${coll}`);
        }
      }
    }
    console.log("");
  }

  // --- PHASE 2: Sync articles ---
  console.log("Phase 2: Syncing articles catalog...");

  // Register new articles mapping
  for (let i = 0; i < NEW_ARTICLES.length; i++) {
    const art = NEW_ARTICLES[i];
    const ref = "IMP-" + String(i + 1).padStart(3, "0");
    ARTICLE_MAP[art.nom] = ref;
  }

  // Create missing articles in Firestore
  const newOps = NEW_ARTICLES.map((art, i) => {
    const ref = "IMP-" + String(i + 1).padStart(3, "0");
    return {
      type: "set",
      ref: db.collection("articles_catalog").doc(ref),
      data: {
        reference: ref,
        nom: art.nom,
        unite: art.unite,
        prix_ht: 0,
        taux_tva: 20,
        prix_ttc: 0,
        categorie: art.categorie,
        sous_categorie: "",
        type: "Stockable",
        active: true,
        import_source: IMPORT_SOURCE,
        created_at: IMPORT_TIMESTAMP,
        updated_at: IMPORT_TIMESTAMP,
      },
    };
  });

  if (newOps.length > 0) {
    console.log(`  Creating ${newOps.length} new articles...`);
    await commitBatches(newOps);
  }
  console.log(`  Total mapped: ${Object.keys(ARTICLE_MAP).length} article names`);
  console.log("");

  // --- PHASE 3: Initialize stock balances from inventory ---
  console.log("Phase 3: Initializing stock balances (inventaire 30/06/2025)...");

  const balOps = [];
  for (const row of rawInventaire) {
    const lieu = normalizeFerme(row[1]);
    const { ref: artRef, nom: artNom } = resolveArticle(row[2]);
    const unite = String(row[3] || "kg").trim();
    const qte = parseFloat(row[4]) || 0;
    const prixTTC = parseFloat(row[5]) || 0;
    if (!lieu || !artRef || qte === 0) continue;

    // Track inventory price
    if (artRef && prixTTC > 0) {
      if (!articlePriceMap[artRef]) articlePriceMap[artRef] = {};
      articlePriceMap[artRef].prix_ttc_inventaire = prixTTC;
    }

    const balanceId = `magasin_${lieu}_${artRef}`.replace(/\s+/g, "_");
    balOps.push({
      type: "set",
      ref: db.collection("stock_balances").doc(balanceId),
      data: {
        lieu_type: "magasin",
        lieu_id: lieu,
        article_ref: artRef,
        article_nom: artNom,
        unite,
        balance: Math.round(qte * 100) / 100,
        updated_at: IMPORT_TIMESTAMP,
      },
    });
  }

  console.log(`  Writing ${balOps.length} balance documents...`);
  await commitBatches(balOps);
  console.log("");

  // --- PHASE 4: Import Bons d'Entree (receptions) ---
  console.log("Phase 4: Importing Bons d'Entree (receptions)...");

  // Group by (date, lieu, bl_number, fournisseur)
  // New file columns: [0]=LIEU, [1]=DATE, [2]=BL, [3]=FOURNISSEUR, [4]=NOM ARTICLE, [5]=UNITE, [6]=QUANTITE, [7]=PRIX TTC
  const entreeGroups = new Map();
  for (const row of rawEntrees) {
    const lieu = normalizeFerme(row[0]);
    const date = toISO(row[1]);
    const bl = String(row[2] || "").trim();
    const fourn = String(row[3] || "").trim();
    const { ref: artRef, nom: artNom } = resolveArticle(row[4]);
    const unite = String(row[5] || "kg").trim();
    const qte = parseFloat(row[6]) || 0;
    const prixFourn = parseFloat(row[7]) || 0;
    if (!artRef || qte === 0) continue;

    // Track purchase price (keep most recent)
    if (artRef && prixFourn > 0) {
      const dateISO = toISO(row[1]);
      const existing = articlePriceMap[artRef];
      if (!existing || !existing.derniere_date_achat || dateISO > existing.derniere_date_achat) {
        if (!articlePriceMap[artRef]) articlePriceMap[artRef] = {};
        articlePriceMap[artRef].prix_ttc_achat = prixFourn;
        articlePriceMap[artRef].derniere_date_achat = dateISO;
      }
    }

    const key = `${date}|${lieu}|${bl}|${fourn}`;
    if (!entreeGroups.has(key)) {
      entreeGroups.set(key, { date, lieu, bl, fourn, items: [] });
    }
    entreeGroups.get(key).items.push({
      article_ref: artRef, article_nom: artNom, quantite: qte, unite,
      prix_unitaire_ttc: prixFourn, montant_ttc: Math.round(qte * prixFourn * 100) / 100,
    });
  }

  let brCounter = 0;
  const brOps = [];
  const brBalanceTasks = [];

  for (const [, group] of entreeGroups) {
    brCounter++;
    const numero = `IMP-BR-${String(brCounter).padStart(4, "0")}`;
    const movData = {
      ...baseMovement("reception", numero),
      date: group.date,
      lieu_source: null,
      lieu_destination: { type: "magasin", id: group.lieu },
      ferme: group.lieu,
      items: group.items,
      ref_bl_fournisseur: group.bl,
      fournisseur_nom: group.fourn,
      bdc_id: null,
      bl_id: null,
      reception_libre: true,
      reception_libre_motif: "Import historique CANEVA",
      ref_bon_physique: "",
      sortie_type: null,
    };

    brOps.push({
      type: "set",
      ref: db.collection("stock_movements").doc(),
      data: movData,
    });

    // Stock impact: increase destination magasin
    for (const item of group.items) {
      brBalanceTasks.push(() => updateStockBalance(
        "magasin", group.lieu, item.article_ref, item.article_nom, item.unite, item.quantite
      ));
    }
  }

  console.log(`  ${entreeGroups.size} reception movements (${rawEntrees.length} line items)`);
  await commitBatches(brOps);
  console.log("  Updating balances...");
  await runConcurrent(brBalanceTasks, 10);
  console.log("");

  // --- PHASE 5: Import Bons de Transfert ---
  console.log("Phase 5: Importing Bons de Transfert...");

  // Group by (date, bt_number, depart, arrivee)
  // Columns: [0]=DATE, [1]=BON, [2]=DEPART, [3]=ARRIVEE, [4]=NOM ARTICLE, then either
  //   [5]=UNITE, [6]=QUANTITE (legacy) or [5]=QUANTITE (new, no UNITE column).
  // TRANSFERT_COLS resolves the right indexes from the header (see Phase 1).
  const transfertGroups = new Map();
  for (const row of rawTransferts) {
    const date = toISO(row[0]);
    const bt = String(row[1] || "").trim();
    const depart = String(row[2] || "").trim();
    const arrivee = String(row[3] || "").trim();
    const { ref: artRef, nom: artNom } = resolveArticle(row[4]);
    const unite = TRANSFERT_COLS.unite !== null ? String(row[TRANSFERT_COLS.unite] || "kg").trim() : "kg";
    const qte = parseFloat(row[TRANSFERT_COLS.qte]) || 0;
    if (!artRef || qte === 0 || !depart) continue;

    const key = `${date}|${bt}|${depart}|${arrivee}`;
    if (!transfertGroups.has(key)) {
      transfertGroups.set(key, { date, bt, depart, arrivee, items: [] });
    }
    transfertGroups.get(key).items.push({ article_ref: artRef, article_nom: artNom, quantite: qte, unite });
  }

  let btCounter = 0;
  const btOps = [];
  const btBalanceTasks = [];

  for (const [, group] of transfertGroups) {
    btCounter++;
    const numero = `IMP-BT-${String(btCounter).padStart(4, "0")}`;
    const lieuSource = buildLieu(group.depart);
    const lieuDest = buildLieu(group.arrivee);

    const movData = {
      ...baseMovement("transfert", numero),
      date: group.date,
      lieu_source: lieuSource,
      lieu_destination: lieuDest,
      ferme: normalizeFerme(group.depart),
      items: group.items,
      ref_bl_fournisseur: "",
      bdc_id: null,
      bl_id: null,
      reception_libre: false,
      reception_libre_motif: "",
      ref_bon_physique: group.bt ? `BT-${group.bt}` : "",
      sortie_type: null,
    };

    btOps.push({
      type: "set",
      ref: db.collection("stock_movements").doc(),
      data: movData,
    });

    // Stock impact: decrease source, increase dest (unless parcelle)
    for (const item of group.items) {
      if (lieuSource && lieuSource.id) {
        btBalanceTasks.push(() => updateStockBalance(
          lieuSource.type, lieuSource.id, item.article_ref, item.article_nom, item.unite, -item.quantite
        ));
      }
      if (lieuDest && lieuDest.id && lieuDest.type !== "parcelle") {
        btBalanceTasks.push(() => updateStockBalance(
          lieuDest.type, lieuDest.id, item.article_ref, item.article_nom, item.unite, item.quantite
        ));
      }
    }
  }

  console.log(`  ${transfertGroups.size} transfert movements (${rawTransferts.length} line items)`);
  await commitBatches(btOps);
  console.log("  Updating balances...");
  await runConcurrent(btBalanceTasks, 10);
  console.log("");

  // --- PHASE 6: Import Bons de Consommation ---
  console.log("Phase 6: Importing Bons de Consommation...");

  // Group by (date, bc_number, depart, parcelle)
  // Columns: [0]=DATE, [1]=BON, [2]=DEPART, [3]=PARCELLE, [4]=CODE ARTICLE (vide), [5]=NOM ARTICLE, [6]=UNITE, [7]=QUANTITE
  const consoGroups = new Map();
  for (const row of rawConsommations) {
    const date = toISO(row[0]);
    const bc = String(row[1] || "").trim();
    const depart = String(row[2] || "").trim();
    const parcelle = String(row[3] || "").trim();
    const { ref: artRef, nom: artNom } = resolveArticle(row[5]);
    const unite = String(row[6] || "kg").trim();
    const qte = parseFloat(row[7]) || 0;
    if (!artRef || qte === 0 || !depart) continue;

    const prix = resolvePrice(artRef);
    const key = `${date}|${bc}|${depart}|${parcelle}`;
    if (!consoGroups.has(key)) {
      consoGroups.set(key, { date, bc, depart, parcelle, items: [] });
    }
    consoGroups.get(key).items.push({
      article_ref: artRef, article_nom: artNom, quantite: qte, unite,
      prix_unitaire_ttc: prix, montant_ttc: Math.round(qte * prix * 100) / 100,
    });
  }

  let bcsCounter = 0;
  const bcsOps = [];
  const bcsBalanceTasks = [];

  for (const [, group] of consoGroups) {
    bcsCounter++;
    const numero = `IMP-BCS-${String(bcsCounter).padStart(4, "0")}`;
    const ferme = normalizeFerme(group.depart);
    const parcelleName = PARCELLE_MAP[group.parcelle] || group.parcelle;

    const movData = {
      ...baseMovement("consommation", numero),
      date: group.date,
      lieu_source: { type: "magasin", id: ferme },
      lieu_destination: { type: "parcelle", id: parcelleName },
      ferme,
      items: group.items,
      ref_bl_fournisseur: "",
      bdc_id: null,
      bl_id: null,
      reception_libre: false,
      reception_libre_motif: "",
      ref_bon_physique: group.bc ? `BC-${group.bc}` : "",
      sortie_type: null,
    };

    bcsOps.push({
      type: "set",
      ref: db.collection("stock_movements").doc(),
      data: movData,
    });

    // Stock impact: decrease source magasin only (parcelles excluded from increase)
    for (const item of group.items) {
      bcsBalanceTasks.push(() => updateStockBalance(
        "magasin", ferme, item.article_ref, item.article_nom, item.unite, -item.quantite
      ));
    }
  }

  console.log(`  ${consoGroups.size} consommation movements (${rawConsommations.length} line items)`);
  // Commit movements in batches
  await commitBatches(bcsOps);
  console.log("  Updating balances...");
  await runConcurrent(bcsBalanceTasks, 10);
  console.log("");

  // --- PHASE 7: Import Bons de Sortie ---
  console.log("Phase 7: Importing Bons de Sortie...");

  // Group by (date, bs_number, lieu, destination)
  const sortieGroups = new Map();
  for (const row of rawSorties) {
    const lieu = normalizeFerme(row[0]);
    const date = toISO(row[1]);
    const bs = String(row[2] || "").trim();
    const dest = String(row[3] || "").trim();
    const { ref: artRef, nom: artNom } = resolveArticle(row[5]);
    const unite = String(row[6] || "kg").trim();
    const qte = parseFloat(row[7]) || 0;
    const motif = String(row[8] || "").trim();
    if (!artRef || qte === 0) continue;

    const key = `${date}|${bs}|${lieu}|${dest}`;
    if (!sortieGroups.has(key)) {
      sortieGroups.set(key, { date, bs, lieu, dest, motif, items: [] });
    }
    sortieGroups.get(key).items.push({ article_ref: artRef, article_nom: artNom, quantite: qte, unite });
  }

  let bsCounter = 0;
  const bsOps = [];
  const bsBalanceTasks = [];

  for (const [, group] of sortieGroups) {
    bsCounter++;
    const numero = `IMP-BS-${String(bsCounter).padStart(4, "0")}`;

    // Destination d'un Bon de Sortie : SEULES les fermes du groupe (F1..F6,
    // BAHIA) deviennent un magasin. Tout le reste (client, prestataire,
    // décharge…) garde 'externe' — variante restrictive identique à
    // functions/lib/stockCaneva/parseWorkbook.js.
    const bsDestLieu = buildLieu(group.dest);
    const movData = {
      ...baseMovement("sortie", numero),
      date: group.date,
      lieu_source: { type: "magasin", id: group.lieu },
      lieu_destination: (bsDestLieu && bsDestLieu.type === "magasin")
        ? bsDestLieu
        : { type: "externe", id: normalizeFerme(group.dest) },
      ferme: group.lieu,
      items: group.items,
      ref_bl_fournisseur: "",
      bdc_id: null,
      bl_id: null,
      reception_libre: false,
      reception_libre_motif: "",
      ref_bon_physique: group.bs ? `BS-${group.bs}` : "",
      sortie_type: mapMotifToSortieType(group.motif),
    };

    bsOps.push({
      type: "set",
      ref: db.collection("stock_movements").doc(),
      data: movData,
    });

    // Stock impact: decrease source magasin
    for (const item of group.items) {
      bsBalanceTasks.push(() => updateStockBalance(
        "magasin", group.lieu, item.article_ref, item.article_nom, item.unite, -item.quantite
      ));
    }
  }

  console.log(`  ${sortieGroups.size} sortie movements (${rawSorties.length} line items)`);
  await commitBatches(bsOps);
  console.log("  Updating balances...");
  await runConcurrent(bsBalanceTasks, 10);
  console.log("");

  // --- PHASE 8: Validation vs Stock Reel ---
  console.log("Phase 8: Validation vs Stock Reel (31/03/2026)...");

  let matchCount = 0;
  let mismatchCount = 0;
  const mismatches = [];

  if (!hasStockReel || rawStockReel.length === 0) {
    console.log("  ignorée (pas de feuille STOCK REEL dans ce fichier — réconciliation non disponible)");
    console.log("");
  } else {

  // Read computed balances from Firestore
  const balSnap = DRY_RUN ? { docs: [] } : await db.collection("stock_balances").get();
  const computed = {};
  for (const doc of balSnap.docs) {
    const d = doc.data();
    if (d.lieu_type === "magasin") {
      const key = `${d.lieu_id}|${d.article_ref}`;
      computed[key] = d.balance || 0;
    }
  }

  // Parse stock reel from Excel (col 0=article, 1=F01, 2=F02, 3=F05, 4=total)
  const REEL_FARM_MAP = { 1: "F1", 2: "F2", 3: "F5" };

  for (const row of rawStockReel) {
    const articleName = String(row[0] || "").trim();
    if (!articleName || articleName === "ARTICLE") continue;
    const { ref: artRef } = resolveArticle(articleName);

    for (const [col, farmId] of Object.entries(REEL_FARM_MAP)) {
      const rawVal = parseFloat(row[col]) || 0;
      const reelQty = Math.round(rawVal * 100) / 100;
      if (Math.abs(reelQty) < 0.01) continue; // skip near-zero
      const compKey = `${farmId}|${artRef}`;
      const compQty = computed[compKey] || 0;
      const delta = Math.round((compQty - reelQty) * 100) / 100;

      if (Math.abs(delta) < 0.5) {
        matchCount++;
      } else {
        mismatchCount++;
        mismatches.push({ article: articleName, farm: farmId, computed: compQty, reel: reelQty, delta });
      }
    }
  }

  console.log(`  Matches (< 0.5 ecart): ${matchCount}`);
  console.log(`  Mismatches: ${mismatchCount}`);
  if (mismatches.length > 0) {
    console.log("  Ecarts:");
    for (const m of mismatches.slice(0, 30)) {
      console.log(`    ${m.farm} | ${m.article.padEnd(30)} | computed=${m.computed.toFixed(2).padStart(10)} | reel=${m.reel.toFixed(2).padStart(10)} | delta=${m.delta.toFixed(2).padStart(10)}`);
    }
    if (mismatches.length > 30) console.log(`    ... and ${mismatches.length - 30} more`);
  }
  console.log("");
  } // end Phase 8 (has stock reel)

  // --- PHASE 8b: Update article prices in catalog ---
  console.log("Phase 8b: Updating article prices in catalog...");

  const priceOps = [];
  let priceCount = 0;
  for (const [artRef, prices] of Object.entries(articlePriceMap)) {
    const prixTTC = prices.prix_ttc_achat || prices.prix_ttc_inventaire || 0;
    if (prixTTC > 0) {
      priceCount++;
      priceOps.push({
        type: "set",
        ref: db.collection("articles_catalog").doc(artRef),
        data: {
          prix_ttc: Math.round(prixTTC * 100) / 100,
          prix_ht: Math.round(prixTTC / 1.2 * 100) / 100,
          updated_at: IMPORT_TIMESTAMP,
        },
        options: { merge: true },
      });
    }
  }

  console.log(`  ${priceCount} articles with prices to update`);
  if (priceOps.length > 0) await commitBatches(priceOps);
  console.log("");

  // --- PHASE 9: Aggregate consumption costs by variety ---
  console.log("Phase 9: Aggregating consumption costs by variety...");

  // Fetch article categories from Firestore
  const artCatSnap = DRY_RUN ? { docs: [] } : await db.collection("articles_catalog").get();
  const articleCategoryMap = {};
  for (const doc of artCatSnap.docs) {
    const d = doc.data();
    if (d.categorie) articleCategoryMap[doc.id] = d.categorie;
  }
  // Also add categories from NEW_ARTICLES (in case Firestore not yet populated)
  for (const art of NEW_ARTICLES) {
    const ref = ARTICLE_MAP[art.nom];
    if (ref && art.categorie) articleCategoryMap[ref] = art.categorie;
  }

  // Classify category to CPC bucket
  function toCPCBucket(categorie) {
    if (!categorie) return null;
    const c = categorie.toLowerCase();
    if (c.includes("engrais") || c.includes("fertilisant")) return "engrais";
    if (c.includes("pesticide") || c.includes("phyto")) return "pesticides";
    return null;
  }

  // Aggregate: scan all consumption groups
  const costAgg = {}; // key: cpc_code -> { variete, ferme, cpc_code, engrais_ttc, pesticides_ttc, par_mois: { "2025-07": {engrais, pesticides} }, detail: [] }
  let unmappedParcelles = new Set();
  let noPriceArticles = new Set();
  let noCategoryArticles = new Set();

  for (const [, group] of consoGroups) {
    // Resolve parcelle to CPC code (check original Excel name first to avoid PARCELLE_MAP mismatches)
    const parcelleName = PARCELLE_MAP[group.parcelle] || group.parcelle;
    const cpcInfo = PARCELLE_TO_CPC[group.parcelle] || PARCELLE_TO_CPC[parcelleName];
    if (!cpcInfo) {
      unmappedParcelles.add(parcelleName);
      continue;
    }

    const month = group.date ? group.date.slice(0, 7) : "unknown"; // "2025-07"

    if (!costAgg[cpcInfo.cpc_code]) {
      costAgg[cpcInfo.cpc_code] = {
        variete: cpcInfo.variete,
        ferme: cpcInfo.ferme,
        cpc_code: cpcInfo.cpc_code,
        engrais_ttc: 0,
        pesticides_ttc: 0,
        total_ttc: 0,
        par_mois: {},
        detail_articles: {},
      };
    }
    const agg = costAgg[cpcInfo.cpc_code];

    for (const item of group.items) {
      const cat = articleCategoryMap[item.article_ref];
      const bucket = toCPCBucket(cat);
      if (!bucket) {
        if (cat) noCategoryArticles.add(`${item.article_nom} (${cat})`);
        else noCategoryArticles.add(item.article_nom);
        continue;
      }

      const montant = item.montant_ttc || 0;
      if (montant === 0) {
        noPriceArticles.add(item.article_nom);
      }

      agg[`${bucket}_ttc`] += montant;
      agg.total_ttc += montant;

      // Monthly breakdown
      if (!agg.par_mois[month]) agg.par_mois[month] = { engrais: 0, pesticides: 0 };
      agg.par_mois[month][bucket] += montant;

      // Detail by article
      const detKey = `${item.article_ref}|${bucket}`;
      if (!agg.detail_articles[detKey]) {
        agg.detail_articles[detKey] = { article_ref: item.article_ref, article_nom: item.article_nom, categorie: bucket, quantite: 0, montant_ttc: 0 };
      }
      agg.detail_articles[detKey].quantite += item.quantite;
      agg.detail_articles[detKey].montant_ttc += montant;
    }
  }

  // Round all amounts
  let totalEngrais = 0, totalPesticides = 0, totalGlobal = 0;
  const summaryParMois = {};

  for (const [code, agg] of Object.entries(costAgg)) {
    agg.engrais_ttc = Math.round(agg.engrais_ttc * 100) / 100;
    agg.pesticides_ttc = Math.round(agg.pesticides_ttc * 100) / 100;
    agg.total_ttc = Math.round(agg.total_ttc * 100) / 100;
    totalEngrais += agg.engrais_ttc;
    totalPesticides += agg.pesticides_ttc;
    totalGlobal += agg.total_ttc;

    // Round monthly
    for (const [m, vals] of Object.entries(agg.par_mois)) {
      vals.engrais = Math.round(vals.engrais * 100) / 100;
      vals.pesticides = Math.round(vals.pesticides * 100) / 100;
      if (!summaryParMois[m]) summaryParMois[m] = { engrais: 0, pesticides: 0 };
      summaryParMois[m].engrais += vals.engrais;
      summaryParMois[m].pesticides += vals.pesticides;
    }

    // Convert detail to array and round
    agg.detail_articles = Object.values(agg.detail_articles).map(d => ({
      ...d,
      quantite: Math.round(d.quantite * 100) / 100,
      montant_ttc: Math.round(d.montant_ttc * 100) / 100,
    })).sort((a, b) => b.montant_ttc - a.montant_ttc);
  }

  // Round summary monthly
  for (const vals of Object.values(summaryParMois)) {
    vals.engrais = Math.round(vals.engrais * 100) / 100;
    vals.pesticides = Math.round(vals.pesticides * 100) / 100;
  }

  // Write to Firestore
  const costOps = [];
  for (const [code, agg] of Object.entries(costAgg)) {
    costOps.push({
      type: "set",
      ref: db.collection("consumption_costs_by_variety").doc(code),
      data: { ...agg, import_source: IMPORT_SOURCE, updated_at: IMPORT_TIMESTAMP },
    });
  }

  // Summary document
  costOps.push({
    type: "set",
    ref: db.collection("consumption_costs_by_variety").doc("_summary"),
    data: {
      total_engrais_ttc: Math.round(totalEngrais * 100) / 100,
      total_pesticides_ttc: Math.round(totalPesticides * 100) / 100,
      total_ttc: Math.round(totalGlobal * 100) / 100,
      par_mois: summaryParMois,
      nb_varietes: Object.keys(costAgg).length,
      import_source: IMPORT_SOURCE,
      updated_at: IMPORT_TIMESTAMP,
    },
  });

  console.log(`  ${Object.keys(costAgg).length} variétés avec coûts`);
  console.log(`  Total Engrais: ${Math.round(totalEngrais).toLocaleString()} DH`);
  console.log(`  Total Pesticides: ${Math.round(totalPesticides).toLocaleString()} DH`);
  console.log(`  Total Global: ${Math.round(totalGlobal).toLocaleString()} DH`);
  if (unmappedParcelles.size > 0) {
    console.log(`  ⚠ Parcelles non mappées (${unmappedParcelles.size}): ${[...unmappedParcelles].join(", ")}`);
  }
  if (noPriceArticles.size > 0) {
    console.log(`  ⚠ Articles sans prix (${noPriceArticles.size}): ${[...noPriceArticles].slice(0, 10).join(", ")}`);
  }
  if (noCategoryArticles.size > 0) {
    console.log(`  ⚠ Articles sans catégorie Engrais/Pesticides (${noCategoryArticles.size}): ${[...noCategoryArticles].slice(0, 10).join(", ")}`);
  }

  if (costOps.length > 0) await commitBatches(costOps);
  console.log("");

  // --- Summary ---
  console.log("");
  console.log("=== IMPORT SUMMARY ===");
  console.log(`  Articles created: ${NEW_ARTICLES.length}`);
  console.log(`  Articles with prices: ${priceCount}`);
  console.log(`  Balances initialized: ${balOps.length}`);
  console.log(`  Receptions (BR): ${entreeGroups.size}`);
  console.log(`  Transferts (BT): ${transfertGroups.size}`);
  console.log(`  Consommations (BCS): ${consoGroups.size}`);
  console.log(`  Sorties (BS): ${sortieGroups.size}`);
  console.log(`  Total movements: ${entreeGroups.size + transfertGroups.size + consoGroups.size + sortieGroups.size}`);
  console.log(`  Validation: ${hasStockReel ? `${matchCount} OK, ${mismatchCount} ecarts` : "ignorée (pas de feuille STOCK REEL)"}`);
  console.log(`  Coûts par variété: Engrais=${Math.round(totalEngrais).toLocaleString()} DH, Pesticides=${Math.round(totalPesticides).toLocaleString()} DH`);
  if (DRY_RUN) console.log("\n  *** DRY RUN - no data was written to Firestore ***");
  console.log("");
}

main().then(() => {
  console.log("Done.");
  process.exit(0);
}).catch(err => {
  console.error("FATAL ERROR:", err);
  process.exit(1);
});
