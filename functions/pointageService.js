const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });

// Shared config modules
const { admin, db: db_firestore } = require("./config/firebase");
const sqlConfig = require("./config/sqlConfig");
const { withCache } = require("./middleware/cache");

// =============================================
// Firestore Mirror — reads from synced collections
// =============================================
const {
  getPointageRowsForDate,
  getPointageRowsForDateRange,
  getPointageRowsForPeriode,
  getPointageMeta,
  getAvailableDates,
  getWorkerHistory,
  getCueilletteRows,
  getSyncStatus,
} = require("./firestoreDataService");
const USE_MIRROR = process.env.USE_FIRESTORE_MIRROR !== "false";

// Heures supplémentaires — helpers purs (calcul durée/dépassement + exclusions)
const {
  SEUIL_MINUTES: HS_SEUIL_MINUTES,
  computeDurationOvertime,
  shouldExcludeWorkerDay,
} = require("./lib/heuresSup/heuresSup");

// SQL — lazy-loaded to avoid loading mssql when USE_MIRROR=true
let sql = null;
let pool = null;
async function getPool() {
  if (!sql) sql = require("mssql");
  if (!pool) pool = await sql.connect(sqlConfig);
  return pool;
}

// =============================================
// Helpers
// =============================================
function deriveFerme(refParcelle, parcelleCulturale) {
  const ref = (refParcelle || "").trim();
  if (ref) {
  if (ref.startsWith("F1") || ref === "0032" || ref === "0035" || ref === "0036") return "F1";
  if (ref.startsWith("F5") || ref === "0037" || ref === "0038" || ref === "0039") return "F5";
  if (ref.startsWith("F2") || ref.startsWith("F3") || ref.startsWith("F4") || ref.startsWith("F6") || ref === "0031" || ref === "0033") return "Avocatier";
  }
  if (parcelleCulturale) {
    if (/F1/i.test(parcelleCulturale)) return "F1";
    if (/F5/i.test(parcelleCulturale)) return "F5";
    if (/avocat/i.test(parcelleCulturale)) return "Avocatier";
    // Parcelles S1-S7 = F1, S8-S14 = F5
    const sMatch = parcelleCulturale.match(/\bS(\d{1,2})\b/i);
    if (sMatch) {
      const sNum = parseInt(sMatch[1], 10);
      if (sNum >= 1 && sNum <= 7) return "F1";
      if (sNum >= 8 && sNum <= 14) return "F5";
    }
  }
  return "Autre";
}

/**
 * Resolve specific myrtille sub-variety from parcelle name.
 * BEE ONE Variete field just says "Myrtille" — the actual sub-variety
 * (Corina, Breeze, Cascade) is encoded in the parcelle designation.
 * This is needed because prime thresholds differ: Corina=30kg, Breeze/Cascade=25kg.
 */
function resolveMyrtilleVariete(variete, parcelle) {
  const v = (variete || "").toLowerCase();
  // If already specific, keep it
  if (/corina|corrina|breeze|cascade/i.test(v)) return variete;
  // Only resolve for generic "myrtille"
  if (!/myrtille|blue/i.test(v)) return variete;
  const p = (parcelle || "").toUpperCase();
  if (p.includes("BREEZE")) return "Breeze";
  if (p.includes("CASCADE")) return "Cascade";
  if (p.includes("CORINA") || p.includes("CORRINA")) return "Corina";
  // S8-2 = Breeze, S8-1 = Cascade, S8 (alone) = Corina
  if (/\bS8[\s-]*2\b/.test(p)) return "Breeze";
  if (/\bS8[\s-]*1\b/.test(p)) return "Cascade";
  if (/\bS8\b/.test(p)) return "Corina";
  // Default to Corina (most common myrtille)
  return "Corina";
}

/**
 * Resolve parcelle name to { variete, culture, ferme } for analytical accounting.
 * Mirrors the frontend normalizeParcelle() logic.
 */
// Detect sub-cycle type from parcelle name.
// 1) Explicit keywords win: "LONG CANE/LC/MT/BI CYCLE" → Long Cane ; "MOW DOWN/MD/GREEN CANE/GC/MOTTE" → Mow Down
// 2) Fallback by sector code (S1-S14) based on cpcVarietes layout:
//    Maravilla: S1,S4 = Mow Down ; S3,S7 = Long Cane
//    Yazmin:    S2,S5,S13 = Mow Down ; S10 = Long Cane
// Returns ' Long Cane', ' Mow Down', or '' (unknown).
function detectFramboiseSubType(parcelle, varieteName) {
  const u = (parcelle || "").toUpperCase();
  if (/\bLONG\s*CANE\b|\bLC\b|\bMT\b|\bBI[\s-]*CYCLE\b/.test(u)) return ' Long Cane';
  if (/\bMOW\s*DOWN\b|\bMD\b|\bGREEN\s*CANE\b|\bGC\b|\bMOTTE\b/.test(u)) return ' Mow Down';
  // Sector-based fallback
  const sMatch = u.match(/\bS(\d{1,2})\b/);
  if (sMatch) {
    const s = parseInt(sMatch[1], 10);
    if (varieteName === 'Maravilla') {
      if (s === 1 || s === 4) return ' Mow Down';
      if (s === 3 || s === 7) return ' Long Cane';
    }
    if (varieteName === 'Yazmin') {
      if (s === 2 || s === 5 || s === 13) return ' Mow Down';
      if (s === 10) return ' Long Cane';
    }
  }
  return '';
}

function resolveVariete(parcelle, refParcelle) {
  const u = (parcelle || "").toUpperCase();
  const ferme = deriveFerme(refParcelle, parcelle);
  if (u.includes('MARAVILLA')) return { variete: 'Maravilla' + detectFramboiseSubType(parcelle, 'Maravilla'), culture: 'Framboise', ferme };
  if (u.includes('YAZMIN') || u.includes('YASMIN')) return { variete: 'Yazmin' + detectFramboiseSubType(parcelle, 'Yazmin'), culture: 'Framboise', ferme };
  if (u.includes('REYNA') || u.includes('REINA')) return { variete: 'Reyna', culture: 'Framboise', ferme };
  if (u.includes('CORINA') || u.includes('CORRINA')) return { variete: 'Corina', culture: 'Myrtille', ferme };
  if (u.includes('CASCADE')) return { variete: 'Cascade', culture: 'Myrtille', ferme };
  if (u.includes('BREEZE')) return { variete: 'Breeze', culture: 'Myrtille', ferme };
  if (u.includes('ADELITA')) return { variete: 'Adelita', culture: 'Framboise', ferme };
  if (u.includes('AVOCAT')) return { variete: 'Avocat', culture: 'Avocat', ferme: 'Avocatier' };
  if (ferme === 'Avocatier') return { variete: 'Avocat', culture: 'Avocat', ferme: 'Avocatier' };
  // Fallback: try sector-based matching
  const sMatch = u.match(/\bS(\d{1,2})\b/);
  if (sMatch) {
    const sNum = parseInt(sMatch[1], 10);
    if (sNum >= 1 && sNum <= 7) return { variete: 'Maravilla', culture: 'Framboise', ferme };
    if (sNum === 8) return { variete: 'Corina', culture: 'Myrtille', ferme };
    if (sNum === 9) return { variete: 'Reyna', culture: 'Framboise', ferme };
    if (sNum === 10) return { variete: 'Yazmin', culture: 'Framboise', ferme };
    if (sNum === 13) return { variete: 'Yazmin', culture: 'Framboise', ferme };
  }
  return { variete: 'Autre', culture: 'Autre', ferme };
}

/**
 * Extract kg from Quantite_unite using the weight per unit from Operation name.
 * Supports: "Récolte Caisse 2.4 kg", "Barquette 2.2 kg", "Seau 5 kg", etc.
 * Returns 0 if no `X kg` pattern is found — the production base
 * (prod_tracabilite_recolte) is the source of truth and overrides this value
 * for real harvesters; non-harvest support roles (Chargement, Conditionnement,
 * Caporal) have Quantite_unite=0 so they correctly produce 0 kg.
 */
const _qtkWarned = new Set();
function quantiteToKg(quantiteUnite, operation) {
  const q = quantiteUnite || 0;
  const op = operation || "";
  const match = op.match(/([\d.]+)\s*kg/i);
  if (!match) {
    if (q > 0 && op && !_qtkWarned.has(op)) {
      console.warn(`[quantiteToKg] No kg pattern in "${op}" with qty=${q} → returning 0`);
      _qtkWarned.add(op);
    }
    return 0;
  }
  return Math.round(q * parseFloat(match[1]) * 10) / 10;
}

/**
 * Compute chargement/conditionnement worker-day details from raw pointage rows.
 * Returns pre-calculated data so frontend doesn't need to filter on Operation.
 */
function computeChargCond(allRows) {
  const chargWorkers = {}; // { "periode|mat" -> { matricule, nom, periode, ferme, jours: Set } }
  const condWorkers = {};
  for (const r of allRows) {
    const mat = (r.Personnel_Matricule || "").trim();
    const nom = (r.Personnel_Nom || "").trim();
    const jour = r.DateStr;
    const op = (r.Operation || "").trim();
    const fam = (r.Operation_Famille || "").trim();
    const periode = (r.Periode_paie || "").trim();
    const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
    if (fam === "8. Récolte" && /^chargement$/i.test(op)) {
      const key = `${periode}|${mat}`;
      if (!chargWorkers[key]) chargWorkers[key] = { matricule: mat, nom, periode, ferme, jours: new Set() };
      chargWorkers[key].jours.add(jour);
    }
    if (fam === "8. Récolte" && /conditionnement/i.test(op)) {
      const key = `${periode}|${mat}`;
      if (!condWorkers[key]) condWorkers[key] = { matricule: mat, nom, periode, ferme, jours: new Set() };
      condWorkers[key].jours.add(jour);
    }
  }
  const toList = (map) => Object.values(map).map(w => ({ matricule: w.matricule, nom: w.nom, periode: w.periode, ferme: w.ferme, jh: w.jours.size, jours: [...w.jours].sort() }));

  // Jours fériés Maroc
  const JOURS_FERIES = [
    { date: '2025-01-01', label: 'Nouvel An', type: 'fixe' },
    { date: '2025-01-11', label: "Manifeste de l'Indépendance", type: 'fixe' },
    { date: '2025-01-14', label: 'Nouvel An Amazigh', type: 'fixe' },
    { date: '2025-05-01', label: 'Fête du Travail', type: 'fixe' },
    { date: '2025-07-30', label: 'Fête du Trône', type: 'fixe' },
    { date: '2025-08-14', label: 'Oued Ed-Dahab', type: 'fixe' },
    { date: '2025-08-20', label: 'Révolution du Roi et du Peuple', type: 'fixe' },
    { date: '2025-08-21', label: 'Fête de la Jeunesse', type: 'fixe' },
    { date: '2025-11-06', label: 'Marche Verte', type: 'fixe' },
    { date: '2025-11-18', label: "Fête de l'Indépendance", type: 'fixe' },
    // Islamiques 2025
    { date: '2025-03-30', label: 'Aïd Al Fitr', type: 'islamique' },
    { date: '2025-03-31', label: 'Aïd Al Fitr (2e jour)', type: 'islamique' },
    { date: '2025-06-06', label: 'Aïd Al Adha', type: 'islamique' },
    { date: '2025-06-07', label: 'Aïd Al Adha (2e jour)', type: 'islamique' },
    { date: '2025-06-27', label: '1er Moharram', type: 'islamique' },
    { date: '2025-09-05', label: 'Aïd Al Mawlid', type: 'islamique' },
    { date: '2026-01-01', label: 'Nouvel An', type: 'fixe' },
    { date: '2026-01-11', label: "Manifeste de l'Indépendance", type: 'fixe' },
    { date: '2026-01-14', label: 'Nouvel An Amazigh', type: 'fixe' },
    { date: '2026-05-01', label: 'Fête du Travail', type: 'fixe' },
    { date: '2026-07-30', label: 'Fête du Trône', type: 'fixe' },
    { date: '2026-08-14', label: 'Oued Ed-Dahab', type: 'fixe' },
    { date: '2026-08-20', label: 'Révolution du Roi et du Peuple', type: 'fixe' },
    { date: '2026-08-21', label: 'Fête de la Jeunesse', type: 'fixe' },
    { date: '2026-11-06', label: 'Marche Verte', type: 'fixe' },
    { date: '2026-11-18', label: "Fête de l'Indépendance", type: 'fixe' },
    { date: '2026-03-30', label: 'Aïd Al Fitr', type: 'islamique' },
    { date: '2026-06-06', label: 'Aïd Al Adha', type: 'islamique' },
    { date: '2026-06-26', label: '1er Moharram', type: 'islamique' },
    { date: '2026-09-04', label: 'Aïd Al Mawlid', type: 'islamique' },
  ];

  // Build date → periode mapping
  const dateToPeriode = {};
  for (const r of allRows) {
    const d = r.DateStr;
    const p = (r.Periode_paie || "").trim();
    if (d && p) dateToPeriode[d] = p;
  }

  // Build worker-per-period map with average daily cost
  const workerPeriod = {}; // "periode|mat" -> { mat, nom, periode, ferme, jours: Set, totalCout, coutCount }
  for (const r of allRows) {
    const mat = (r.Personnel_Matricule || "").trim();
    const nom = (r.Personnel_Nom || "").trim();
    const periode = (r.Periode_paie || "").trim();
    const cout = r.Cout || 0;
    const jour = r.DateStr;
    const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
    const key = `${periode}|${mat}`;
    if (!workerPeriod[key]) workerPeriod[key] = { mat, nom, periode, ferme, jours: new Set(), totalCout: 0, coutCount: 0 };
    if (!workerPeriod[key].jours.has(jour)) {
      workerPeriod[key].jours.add(jour);
      if (cout > 0) { workerPeriod[key].totalCout += cout; workerPeriod[key].coutCount++; }
    }
  }

  // For each jour férié, find its quinzaine and credit all active workers
  const ferieWorkers = {}; // "periode|mat" -> { matricule, nom, periode, details: [] }
  for (const jf of JOURS_FERIES) {
    // Determine which periode this holiday belongs to
    let holidayPeriode = dateToPeriode[jf.date];
    if (!holidayPeriode) {
      // Holiday date has no data (workers were off). Scan nearby dates to find the right period.
      const hDate = new Date(jf.date + 'T12:00:00');
      for (let offset = -3; offset <= 3; offset++) {
        if (offset === 0) continue;
        const nearby = new Date(hDate);
        nearby.setDate(nearby.getDate() + offset);
        const nearbyStr = nearby.toISOString().slice(0, 10);
        if (dateToPeriode[nearbyStr]) { holidayPeriode = dateToPeriode[nearbyStr]; break; }
      }
    }
    if (!holidayPeriode) continue; // Holiday not in any loaded period

    // All workers active in this period are eligible for 1 jour sup
    for (const [, wp] of Object.entries(workerPeriod)) {
      if (wp.periode !== holidayPeriode) continue;
      const fKey = `${wp.periode}|${wp.mat}`;
      if (!ferieWorkers[fKey]) ferieWorkers[fKey] = { matricule: wp.mat, nom: wp.nom, periode: wp.periode, ferme: wp.ferme, details: [] };
      const avgCout = wp.coutCount > 0 ? wp.totalCout / wp.coutCount : 0;
      ferieWorkers[fKey].details.push({ date: jf.date, label: jf.label, raison: 'Jour férié dans la quinzaine', cout: avgCout });
    }
  }
  const ferieList = Object.values(ferieWorkers).map(w => ({
    matricule: w.matricule, nom: w.nom, periode: w.periode, ferme: w.ferme,
    jh: w.details.length, details: w.details,
    cout: Math.round(w.details.reduce((s, d) => s + (d.cout || 0), 0) * 100) / 100,
  }));

  return {
    chargementDetail: toList(chargWorkers),
    conditionnementDetail: toList(condWorkers),
    jourFerieDetail: ferieList,
    joursFeries: JOURS_FERIES,
  };
}

function classifyType(operationFamille) {
  if (!operationFamille) return "horsRecolte";
  if (operationFamille === "8. Récolte") return "recolte";
  if (operationFamille === "11. Postes fixes") return "postesFixes";
  return "horsRecolte";
}

// =============================================
// Heures supplémentaires
// =============================================

/**
 * Lit la liste des fonctions exclues (gardiens, etc.) depuis app_settings.
 * @returns {Promise<Array<string>>}
 */
async function getExcludedFonctionsHS() {
  try {
    const doc = await db_firestore.collection("app_settings").doc("heures_sup").get();
    if (!doc.exists) return [];
    const data = doc.data() || {};
    return Array.isArray(data.excludedFonctions) ? data.excludedFonctions : [];
  } catch (e) {
    console.error("getExcludedFonctionsHS error:", e.message);
    return [];
  }
}

/**
 * Construit les lignes heures supplémentaires pour les quinzaines récentes
 * (courante + précédente). Jointure prod_presence (entrée/sortie) ⨯
 * sql_mirror_pointage (fonction pointée) par matricule + jour.
 * Exclut récolte (payée au rendement) et fonctions configurées (gardiens).
 * Un ouvrier présent mais absent du mirror est conservé avec `fonctionMissing`.
 *
 * @param {Object|null} meta - sql_mirror_pointage_meta/config
 * @param {Array<string>} excludedFonctions
 * @returns {Promise<Object>} { success, periodes, excludedFonctions, seuilMinutes, periodeDates, rows }
 */
async function buildHeuresSup(meta, excludedFonctions) {
  const periodes = (meta && meta.periodes) || [];
  const periodeMap = (meta && meta.periodeMap) || {};
  const targetPeriodes = periodes.slice(0, 2);

  // Jours cibles + map jour→periode + map periode→jours (colonnes complètes,
  // même les jours sans sync, pour rendre les trous visibles côté UI).
  const periodeDates = {};
  const dayToPeriode = {};
  const allDays = [];
  for (const p of targetPeriodes) {
    const days = (periodeMap[p] || []).slice().sort();
    periodeDates[p] = days;
    for (const d of days) {
      if (!(d in dayToPeriode)) { dayToPeriode[d] = p; allDays.push(d); }
    }
  }

  // 1. Présence entrée/sortie par jour → Map(MATUPPER → {matricule,nom,heureEntree,heureSortie,caporal})
  const presenceByDay = {};
  for (let i = 0; i < allDays.length; i += 10) {
    const batch = allDays.slice(i, i + 10);
    const snaps = await Promise.all(batch.map(d => db_firestore.collection("prod_presence").doc(d).get()));
    snaps.forEach((snap, idx) => {
      const d = batch[idx];
      const map = new Map();
      if (snap.exists) {
        const rows = (snap.data().rows) || [];
        for (const r of rows) {
          const mat = String(r.matricule || "").trim();
          if (!mat) continue;
          map.set(mat.toUpperCase(), {
            matricule: mat,
            nom: (r.nom || "").trim(),
            heureEntree: r.heureEntree || null,
            heureSortie: r.heureSortie || null,
            caporal: r.caporal || 0,
          });
        }
      }
      presenceByDay[d] = map;
    });
  }

  // 2. Fonction pointée par jour (mirror) → Map(MATUPPER → fonction représentative)
  //    Représentant = couple (famille|opération) le plus fréquent ce jour-là.
  const fonctionByDay = {};
  for (let i = 0; i < allDays.length; i += 10) {
    const batch = allDays.slice(i, i + 10);
    const results = await Promise.all(batch.map(d => getPointageRowsForDate(d)));
    results.forEach((rows, idx) => {
      const d = batch[idx];
      const acc = new Map();
      for (const r of rows) {
        const mat = String(r.Personnel_Matricule || "").trim().toUpperCase();
        if (!mat) continue;
        const fam = (r.Operation_Famille || "").trim();
        const op = (r.Operation || "").trim();
        const key = `${fam}|${op}`;
        let e = acc.get(mat);
        if (!e) { e = { counts: {}, infos: {}, nom: (r.Personnel_Nom || "").trim() }; acc.set(mat, e); }
        e.counts[key] = (e.counts[key] || 0) + 1;
        if (!e.infos[key]) e.infos[key] = { operationFamille: fam, operation: op, ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) };
        if (!e.nom && r.Personnel_Nom) e.nom = (r.Personnel_Nom || "").trim();
      }
      const map = new Map();
      for (const [mat, e] of acc) {
        const bestKey = Object.entries(e.counts).sort((a, b) => b[1] - a[1])[0][0];
        const info = e.infos[bestKey];
        map.set(mat, { operationFamille: info.operationFamille, operation: info.operation, ferme: info.ferme, nom: e.nom });
      }
      fonctionByDay[d] = map;
    });
  }

  // 3. Jointure + calcul durée/dépassement + exclusions
  const rows = [];
  for (const d of allDays) {
    const presence = presenceByDay[d] || new Map();
    const fonctions = fonctionByDay[d] || new Map();
    for (const [matUpper, p] of presence) {
      const f = fonctions.get(matUpper) || null;
      const fonctionMissing = !f;
      // Récolte + fonctions configurées exclues. Fonction inconnue → conservée + flag.
      if (f && shouldExcludeWorkerDay(f, excludedFonctions)) continue;
      const { durationMin, overtimeMin, clockedIn } = computeDurationOvertime(p.heureEntree, p.heureSortie);
      rows.push({
        matricule: p.matricule,
        nom: p.nom || (f && f.nom) || "",
        jour: d,
        periode: dayToPeriode[d] || null,
        ferme: (f && f.ferme) || "Autre",
        operationFamille: f ? f.operationFamille : null,
        operation: f ? f.operation : null,
        fonctionMissing,
        caporal: p.caporal || 0,
        heureEntree: p.heureEntree || null,
        heureSortie: p.heureSortie || null,
        durationMin,
        overtimeMin,
        clockedIn,
      });
    }
  }

  return { success: true, periodes, excludedFonctions, seuilMinutes: HS_SEUIL_MINUTES, periodeDates, rows };
}

// =============================================
// Firestore mirror helpers — same output shape as SQL helpers
// =============================================

function mapMirrorRowToDetail(r) {
  return {
    matricule: (r.Personnel_Matricule || "").trim(),
    nom: (r.Personnel_Nom || "").trim(),
    operationFamille: r.Operation_Famille,
    operation: r.Operation,
    groupe: r.Operation_Groupe,
    jours: r.Nombre_Jr, heures: r.Nombre_Hr, quantite: r.Quantite_unite, cout: r.Cout,
    parcelle: (r.Parcelle_Culturale || "").trim(),
    refParcelle: (r.Ref_parcelle || "").trim(),
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    type: classifyType(r.Operation_Famille),
    variete: r.Variete, culture: r.Culture,
    hs25: r.HS_25, hs50: r.HS_50, hs100: r.HS_100,
  };
}

async function fetchDetailFromMirror(dateParam) {
  const dateStr = dateParam || new Date().toISOString().slice(0, 10);
  const rows = await getPointageRowsForDate(dateStr);
  return rows.map(mapMirrorRowToDetail);
}

async function fetchSummaryFromMirror(dateParam) {
  const dateStr = dateParam || new Date().toISOString().slice(0, 10);
  const rows = await getPointageRowsForDate(dateStr);
  const fermes = { F1: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, F5: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, Avocatier: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 } };
  // Group by ref_parcelle+operation_famille to count distinct workers
  const groups = {};
  for (const r of rows) {
    const key = `${r.Ref_parcelle}|${r.Parcelle_Culturale}|${r.Operation_Famille}`;
    if (!groups[key]) groups[key] = { Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Operation_Famille: r.Operation_Famille, workers: new Set(), totalCout: 0 };
    groups[key].workers.add(r.Personnel_Matricule);
    groups[key].totalCout += r.Cout || 0;
  }
  for (const g of Object.values(groups)) {
    const ferme = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
    const type = classifyType(g.Operation_Famille);
    if (fermes[ferme]) { fermes[ferme][type] += g.workers.size; fermes[ferme].cout += g.totalCout; }
  }
  return fermes;
}

async function fetchPostesFixesFromMirror(dateParam) {
  const dateStr = dateParam || new Date().toISOString().slice(0, 10);
  const rows = await getPointageRowsForDate(dateStr);
  return rows
    .filter(r => r.Operation_Famille === "11. Postes fixes")
    .map(r => ({
      matricule: (r.Personnel_Matricule || '').trim(),
      nom: (r.Personnel_Nom || '').trim(),
      operation: r.Operation,
      parcelle: (r.Parcelle_Culturale || '').trim(),
      ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
      jours: r.Nombre_Jr,
      heures: r.Nombre_Hr,
      cout: Math.round(r.Cout || 0),
    }));
}

// =============================================
// Internal helpers for snapshot creation
// =============================================

// Fetch detail rows from SQL for a given date, filtered by ferme
async function fetchDetailFromSQL(dateParam) {
  const db = await getPool();
  const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
  const result = await db.request().query(`
    SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
      Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle, Variete, Culture,
      HS_25, HS_50, HS_100, HS_NM
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) = ${dateSQL}
    ORDER BY Ref_parcelle, Operation_Famille, Personnel_Nom
  `);
  return result.recordset.map(r => ({
    matricule: (r.Personnel_Matricule || "").trim(),
    nom: (r.Personnel_Nom || "").trim(),
    operationFamille: r.Operation_Famille,
    operation: r.Operation,
    groupe: r.Operation_Groupe,
    jours: r.Nombre_Jr, heures: r.Nombre_Hr, quantite: r.Quantite_unite, cout: r.Cout,
    parcelle: (r.Parcelle_Culturale || "").trim(),
    refParcelle: (r.Ref_parcelle || "").trim(),
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    type: classifyType(r.Operation_Famille),
    variete: r.Variete, culture: r.Culture,
    hs25: r.HS_25, hs50: r.HS_50, hs100: r.HS_100,
  }));
}

// Fetch summary data from SQL for a given date
async function fetchSummaryFromSQL(dateParam) {
  const db = await getPool();
  const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
  const todayRes = await db.request().query(`
    SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille,
      COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) = ${dateSQL}
    GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille
  `);
  const fermes = { F1: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, F5: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, Avocatier: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 } };
  for (const row of todayRes.recordset) {
    const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale);
    const type = classifyType(row.Operation_Famille);
    if (fermes[ferme]) {
      fermes[ferme][type] += row.nbOuv;
      fermes[ferme].cout += row.totalCout || 0;
    }
  }
  return fermes;
}

// Fetch postes fixes from SQL for a given date
async function fetchPostesFixesFromSQL(dateParam) {
  const db = await getPool();
  const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
  const result = await db.request().query(`
    SELECT Personnel_Matricule, Personnel_Nom, Operation, Ref_parcelle, Parcelle_Culturale,
      Nombre_Jr, Nombre_Hr, Cout
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'11. Postes fixes'
    ORDER BY Ref_parcelle, Operation, Personnel_Nom
  `);
  return result.recordset.map(r => ({
    matricule: (r.Personnel_Matricule || '').trim(),
    nom: (r.Personnel_Nom || '').trim(),
    operation: r.Operation,
    parcelle: (r.Parcelle_Culturale || '').trim(),
    ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
    jours: r.Nombre_Jr,
    heures: r.Nombre_Hr,
    cout: Math.round(r.Cout || 0),
  }));
}

// Create a snapshot for a specific date+ferme
async function createSnapshot(dateParam, ferme, profileId) {
  const allDetail = USE_MIRROR ? await fetchDetailFromMirror(dateParam) : await fetchDetailFromSQL(dateParam);
  const fermeDetail = allDetail.filter(r => r.ferme === ferme);
  const allPostes = USE_MIRROR ? await fetchPostesFixesFromMirror(dateParam) : await fetchPostesFixesFromSQL(dateParam);
  const fermePostes = allPostes.filter(r => r.ferme === ferme);
  const summaryData = USE_MIRROR ? await fetchSummaryFromMirror(dateParam) : await fetchSummaryFromSQL(dateParam);
  const fermeSummary = summaryData[ferme] || { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 };

  const docId = `${dateParam}_${ferme}`;
  const snapRef = db_firestore.collection("pointage_snapshots").doc(docId);
  const existing = await snapRef.get();
  const version = existing.exists ? (existing.data().version || 1) + 1 : 1;

  const snapshotData = {
    date: dateParam,
    ferme,
    createdAt: Date.now(),
    createdBy: profileId || "rh",
    version,
    summary: fermeSummary,
    detailRows: fermeDetail,
    postesFixes: fermePostes,
    workerCount: new Set(fermeDetail.map(r => r.matricule)).size,
  };

  await snapRef.set(snapshotData);
  return snapshotData;
}

// Get submitted fermes for a date (those with visaRH or rejected status — i.e. have snapshots)
async function getSubmittedFermes(dateParam) {
  if (!dateParam) return {};
  const snaps = await db_firestore.collection("pointage_validations")
    .where("date", "==", dateParam).get();
  const result = {};
  snaps.forEach(doc => {
    const d = doc.data();
    if (d.visaRH || d.rejected) {
      result[d.ferme] = { snapshotId: doc.id, rejected: !!d.rejected };
    }
  });
  return result;
}

// Get snapshot data for a ferme
async function getSnapshotData(dateParam, ferme) {
  const docId = `${dateParam}_${ferme}`;
  const snap = await db_firestore.collection("pointage_snapshots").doc(docId).get();
  if (!snap.exists) return null;
  return snap.data();
}

// Exports for use by index.js
exports.createSnapshot = createSnapshot;
exports.getSubmittedFermes = getSubmittedFermes;
exports.getSnapshotData = getSnapshotData;
exports.deriveFerme = deriveFerme;

// =============================================
// Cache Warmer — pre-populates api_cache for pointage endpoints
// Reads from Firestore mirror only (GCP→GCP, zero farm network impact)
// =============================================
async function warmAllPointageCaches() {
  if (!USE_MIRROR) {
    console.log("[cacheWarmer] Skipping — USE_MIRROR is false");
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const meta = await getPointageMeta();
  const periodes = meta?.periodes || [];
  const results = [];

  // 1. Summary
  try {
    await withCache(`pointage_summary_${today}`, 0, async () => {
      const submittedFermes = await getSubmittedFermes(today);
      const yesterdayStr = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
      const weekStartStr = new Date(new Date(today).getTime() - 6 * 86400000).toISOString().slice(0, 10);
      const [todayRows, yesterdayRows, weekRows] = await Promise.all([
        getPointageRowsForDate(today),
        getPointageRowsForDate(yesterdayStr),
        getPointageRowsForDateRange(weekStartStr, today),
      ]);
      const fermes = { F1: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, F5: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, Avocatier: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 } };
      const todayGroups = {};
      for (const r of todayRows) {
        const key = `${r.Ref_parcelle}|${r.Parcelle_Culturale}|${r.Operation_Famille}`;
        if (!todayGroups[key]) todayGroups[key] = { ...r, workers: new Set(), totalCout: 0 };
        todayGroups[key].workers.add(r.Personnel_Matricule);
        todayGroups[key].totalCout += r.Cout || 0;
      }
      for (const g of Object.values(todayGroups)) {
        const ferme = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
        const type = classifyType(g.Operation_Famille);
        if (fermes[ferme]) { fermes[ferme][type] += g.workers.size; fermes[ferme].cout += g.totalCout; }
      }
      const fermesYesterday = { F1: { total: 0 }, F5: { total: 0 }, Avocatier: { total: 0 } };
      const yGroups = {};
      for (const r of yesterdayRows) {
        const key = `${r.Ref_parcelle}|${r.Parcelle_Culturale}|${r.Operation_Famille}`;
        if (!yGroups[key]) yGroups[key] = { ...r, workers: new Set() };
        yGroups[key].workers.add(r.Personnel_Matricule);
      }
      for (const g of Object.values(yGroups)) {
        const ferme = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
        if (fermesYesterday[ferme]) fermesYesterday[ferme].total += g.workers.size;
      }
      for (const f of Object.keys(submittedFermes)) {
        const snapData = await getSnapshotData(today, f);
        if (snapData && snapData.summary && fermes[f]) fermes[f] = snapData.summary;
      }
      const pointageJour = Object.keys(fermes).map(f => {
        const e = fermes[f]; const total = e.recolte + e.horsRecolte + e.postesFixes;
        const veille = fermesYesterday[f] ? fermesYesterday[f].total : total;
        return { ferme: f, total, recolte: e.recolte, horsRecolte: e.horsRecolte, postesFixes: e.postesFixes, cout: Math.round(e.cout), veille, diff: veille > 0 ? Math.round(((total - veille) / veille) * 1000) / 10 : 0 };
      });
      const trendMap = {};
      for (const r of weekRows) {
        const key = r.DateStr;
        if (!trendMap[key]) trendMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short" }), F1: new Set(), F5: new Set(), Avocatier: new Set() };
        const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
        if (trendMap[key][ferme]) trendMap[key][ferme].add(r.Personnel_Matricule);
      }
      const weeklyTrend = Object.values(trendMap).map(t => ({ jour: t.jour, jourLabel: t.jourLabel, F1: t.F1.size, F5: t.F5.size, Avocatier: t.Avocatier.size })).sort((a, b) => a.jour.localeCompare(b.jour));
      const recolteRows = todayRows.filter(r => r.Operation_Famille === "8. Récolte");
      const recolteWorkers = new Set(recolteRows.map(r => r.Personnel_Matricule));
      const recolteQty = recolteRows.reduce((s, r) => s + (r.Quantite_unite || 0), 0);
      const recolteCout = recolteRows.reduce((s, r) => s + (r.Cout || 0), 0);
      const syncStatus = await getSyncStatus();
      return { success: true, date: today, effectif: fermes, pointageJour, weeklyTrend, topOps: [], recolteTotal: { qty: recolteQty, nbOuv: recolteWorkers.size, cout: Math.round(recolteCout) }, lastSaisie: syncStatus?.lastSuccessAt || null, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null };
    });
    results.push("summary:ok");
  } catch (e) { results.push(`summary:${e.message}`); }

  // 2. Detail
  try {
    await withCache(`pointage_detail_${today}`, 0, async () => {
      const rows = await fetchDetailFromMirror(today);
      return { success: true, date: today, rows, count: rows.length };
    });
    results.push("detail:ok");
  } catch (e) { results.push(`detail:${e.message}`); }

  // 3. Recolte
  try {
    await withCache(`pointage_recolte_${today}`, 0, async () => {
      const [pointageRows, cueilletteRows] = await Promise.all([
        getPointageRowsForDate(today),
        getCueilletteRows(today, today),
      ]);
      const cGroups = {};
      for (const r of cueilletteRows.filter(r => r.Operation_Famille === "8. Récolte")) {
        const key = `${r.Parcelle_Culturale}|${r.Variete}`;
        if (!cGroups[key]) cGroups[key] = { parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, refTech: (r.Reference_Technique || "").trim(), totalKg: 0, totalCaisses: 0 };
        cGroups[key].totalKg += r.Poids_total_kg || 0;
        cGroups[key].totalCaisses += r.Nbre_Caisse || 0;
      }
      const cueillette = Object.values(cGroups).map(c => ({ ...c, ferme: deriveFerme(c.refTech || null, c.parcelle) })).sort((a, b) => b.totalKg - a.totalKg);
      const workers = pointageRows.filter(r => r.Operation_Famille === "8. Récolte").map((r, i) => ({
        rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
        operation: r.Operation, quantite: quantiteToKg(r.Quantite_unite, r.Operation),
        heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(),
        ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete,
      })).sort((a, b) => b.quantite - a.quantite || a.nom.localeCompare(b.nom));
      workers.forEach((w, i) => { w.rank = i + 1; });
      const totalKgCueillette = cueillette.reduce((s, c) => s + c.totalKg, 0);
      return { success: true, date: today, workers, cueillette, totalKgCueillette, count: workers.length };
    });
    results.push("recolte:ok");
  } catch (e) { results.push(`recolte:${e.message}`); }

  // 4. Quinzaine (latest)
  try {
    await withCache("pointage_quinzaine_latest", 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, periodes, totalJournees: 0, totalCout: 0, parFerme: [], parJour: [] };
      const rows = await getPointageRowsForPeriode(selectedPeriode);
      const qFermes = { F1: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, F5: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, Avocatier: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 } };
      for (const r of rows) { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); const type = classifyType(r.Operation_Famille); if (qFermes[ferme]) { qFermes[ferme].journees += r.Nombre_Jr || 0; qFermes[ferme].cout += r.Cout || 0; qFermes[ferme][type] += r.Nombre_Jr || 0; } }
      const dayMap = {};
      for (const r of rows) {
        const key = r.DateStr;
        if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: new Set(), journees: 0, cout: 0, F1: new Set(), F5: new Set(), Avocatier: new Set() };
        dayMap[key].nbOuv.add(r.Personnel_Matricule); dayMap[key].journees += r.Nombre_Jr || 0; dayMap[key].cout += r.Cout || 0;
        const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
        if (dayMap[key][ferme]) dayMap[key][ferme].add(r.Personnel_Matricule);
      }
      const perDay = Object.values(dayMap).map(d => ({ jour: d.jour, jourLabel: d.jourLabel, nbOuv: d.nbOuv.size, journees: d.journees, cout: d.cout, F1: d.F1.size, F5: d.F5.size, Avocatier: d.Avocatier.size })).sort((a, b) => a.jour.localeCompare(b.jour));
      const totalJournees = Object.values(qFermes).reduce((s, f) => s + f.journees, 0);
      const totalCout = Object.values(qFermes).reduce((s, f) => s + f.cout, 0);
      return { success: true, periode: selectedPeriode, periodes, totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay };
    });
    results.push("quinzaine:ok");
  } catch (e) { results.push(`quinzaine:${e.message}`); }

  // 4b. Quinzaine-analytique (latest)
  try {
    await withCache("pointage_quinzaine_analytique_latest", 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, periodes, rows: [] };
      const rawRows = await getPointageRowsForPeriode(selectedPeriode);
      const groups = {};
      for (const r of rawRows) {
        const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}|${r.Operation}`;
        if (!groups[key]) groups[key] = { Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Operation_Famille: r.Operation_Famille, Operation: r.Operation, workers: new Set(), JH: 0, Cout: 0 };
        groups[key].workers.add(r.Personnel_Matricule);
        groups[key].JH += r.Nombre_Jr || 0;
        groups[key].Cout += r.Cout || 0;
      }
      const rows = Object.values(groups).map(g => ({ parcelle: (g.Parcelle_Culturale || '').trim(), refParcelle: (g.Ref_parcelle || '').trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale), operationFamille: g.Operation_Famille, operation: g.Operation, nbOuv: g.workers.size, jh: Math.round(g.JH * 100) / 100, cout: Math.round(g.Cout) }));
      return { success: true, periode: selectedPeriode, periodes, rows };
    });
    results.push("quinzaine-analytique:ok");
  } catch (e) { results.push(`quinzaine-analytique:${e.message}`); }

  // 4c. Quinzaine-repos (latest)
  try {
    await withCache("pointage_quinzaine_repos_latest", 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 };
      const quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
      const rawRows = await getPointageRowsForPeriode(selectedPeriode);
      const nbJoursQuinzaine = quinzaineDates.length;
      const equipeMap = {};
      for (const row of rawRows) {
        const mat = (row.Personnel_Matricule || '').trim();
        const prefix = mat.substring(0, 2).toUpperCase();
        const jour = row.DateStr || new Date(row.jour).toISOString().slice(0, 10);
        if (!equipeMap[prefix]) equipeMap[prefix] = {};
        if (!equipeMap[prefix][mat]) equipeMap[prefix][mat] = { matricule: mat, nom: (row.Personnel_Nom || '').trim(), joursPresent: new Set() };
        equipeMap[prefix][mat].joursPresent.add(jour);
      }
      const equipes = Object.entries(equipeMap).map(([prefix, workers]) => {
        const workerList = Object.values(workers).map(w => { const nbPresent = w.joursPresent.size; const nbRepos = nbJoursQuinzaine - nbPresent; return { matricule: w.matricule, nom: w.nom, nbPresent, nbRepos, nbJoursQuinzaine }; });
        const totalRepos = workerList.reduce((s, w) => s + w.nbRepos, 0);
        const moyRepos = workerList.length > 0 ? Math.round((totalRepos / workerList.length) * 10) / 10 : 0;
        return { prefix, nbOuvriers: workerList.length, moyRepos, nbJoursQuinzaine, workers: workerList.sort((a, b) => b.nbRepos - a.nbRepos) };
      }).sort((a, b) => a.prefix.localeCompare(b.prefix));
      return { success: true, periode: selectedPeriode, periodes, nbJoursQuinzaine, quinzaineDates, equipes };
    });
    results.push("quinzaine-repos:ok");
  } catch (e) { results.push(`quinzaine-repos:${e.message}`); }

  // 4d. Quinzaine-alertes (latest)
  try {
    await withCache("pointage_quinzaine_alertes_latest", 0, async () => {
      const selectedPeriode = periodes[0];
      if (!selectedPeriode) return { success: true, periode: null, alertes: [] };
      const quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
      const rawRows = await getPointageRowsForPeriode(selectedPeriode);
      const presenceMap = {};
      for (const r of rawRows) {
        const prefix = (r.Personnel_Matricule || '').trim().substring(0, 2).toUpperCase();
        if (!presenceMap[prefix]) presenceMap[prefix] = new Set();
        presenceMap[prefix].add(r.DateStr);
      }
      const alertes = [];
      Object.entries(presenceMap).forEach(([prefix, presentDays]) => {
        let streak = 0, streakStart = null;
        for (let i = 0; i < quinzaineDates.length; i++) {
          const d = quinzaineDates[i];
          if (!presentDays.has(d)) { if (streak === 0) streakStart = d; streak++; }
          else { if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[i - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[i - 1]})` }); streak = 0; streakStart = null; }
        }
        if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[quinzaineDates.length - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[quinzaineDates.length - 1]})` });
      });
      alertes.sort((a, b) => b.joursAbsents - a.joursAbsents);
      return { success: true, periode: selectedPeriode, periodes, quinzaineDates, alertes };
    });
    results.push("quinzaine-alertes:ok");
  } catch (e) { results.push(`quinzaine-alertes:${e.message}`); }

  // 5. Recolte-equipes
  try {
    await withCache("pointage_recolte_equipes", 0, async () => {
      const targetPeriodes = periodes.slice(0, 2);
      const allRows = [];
      for (const p of targetPeriodes) { allRows.push(...await getPointageRowsForPeriode(p)); }
      const recolteRows = allRows.filter(r => r.Operation_Famille === "8. Récolte");
      const rawRows = recolteRows.map(r => ({
        matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
        jour: r.DateStr, periode: r.Periode_paie,
        kg: quantiteToKg(r.Quantite_unite, r.Operation),
        heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0),
        ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
        variete: resolveMyrtilleVariete((r.Variete || "").trim(), r.Parcelle_Culturale),
        culture: (r.Culture || "").trim(),
        parcelle: (r.Parcelle_Culturale || "").trim(), operation: (r.Operation || "").trim(),
      }));
      // Agréger par ouvrier+jour (multi-variétés/parcelles le même jour)
      const grouped = {};
      for (const r of rawRows) {
        const key = `${r.matricule}|${r.jour}`;
        if (!grouped[key]) {
          grouped[key] = { ...r, kgByVariete: { [r.variete]: r.kg } };
        } else {
          grouped[key].kg += r.kg;
          grouped[key].heures += r.heures;
          grouped[key].cout += r.cout;
          const v = r.variete || 'Autre';
          grouped[key].kgByVariete[v] = (grouped[key].kgByVariete[v] || 0) + r.kg;
        }
      }
      const rows = Object.values(grouped).map(r => {
        const bestVariete = Object.entries(r.kgByVariete).sort((a, b) => b[1] - a[1])[0]?.[0] || r.variete;
        delete r.kgByVariete;
        return { ...r, variete: bestVariete, kg: Math.round(r.kg * 10) / 10 };
      });
      return { success: true, periodes, rows };
    });
    results.push("recolte-equipes:ok");
  } catch (e) { results.push(`recolte-equipes:${e.message}`); }

  // 6. Transport
  try {
    await withCache("pointage_transport", 0, async () => {
      const targetPeriodes = periodes.slice(0, 2);
      const allRows = [];
      for (const p of targetPeriodes) { allRows.push(...await getPointageRowsForPeriode(p)); }
      const groups = {};
      for (const r of allRows) {
        const key = `${r.Personnel_Matricule}|${r.DateStr}|${r.Periode_paie}|${r.Operation_Famille}|${r.Operation}`;
        if (!groups[key]) groups[key] = { Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: r.DateStr, Periode_paie: r.Periode_paie, Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale };
      }
      const rows = Object.values(groups).map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: r.DateStr, periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), operation: (r.Operation || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) }));
      const extras = computeChargCond(allRows);
      return { success: true, periodes, rows, ...extras };
    });
    results.push("transport:ok");
  } catch (e) { results.push(`transport:${e.message}`); }

  // 6b. Heures supplémentaires
  try {
    await withCache("pointage_heures_sup", 0, async () => {
      const excludedFonctions = await getExcludedFonctionsHS();
      return await buildHeuresSup(meta, excludedFonctions);
    });
    results.push("heures-sup:ok");
  } catch (e) { results.push(`heures-sup:${e.message}`); }

  // 7. Nouveaux ouvriers
  try {
    await withCache("pointage_nouveaux_ouvriers", 0, async () => {
      const currentPeriode = periodes[0];
      if (!currentPeriode) return { success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] };
      const periodeDates = meta?.periodeMap?.[currentPeriode] || [];
      const qStart = periodeDates[0] || null;
      const qEnd = periodeDates[periodeDates.length - 1] || null;
      const targetPeriodes = periodes.slice(0, 2);
      const firstAppearance = {};
      for (const p of [...targetPeriodes].reverse()) {
        const pRows = await getPointageRowsForPeriode(p);
        for (const r of pRows) {
          const mat = (r.Personnel_Matricule || "").trim();
          if (!firstAppearance[mat]) firstAppearance[mat] = { date: r.DateStr, nom: (r.Personnel_Nom || "").trim(), Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Operation_Famille: r.Operation_Famille };
        }
      }
      const byFarm = {}; const byDayMap = {};
      const workers = Object.entries(firstAppearance)
        .filter(([_, info]) => qStart && info.date >= qStart)
        .map(([mat, info]) => {
          const ferme = deriveFerme(info.Ref_parcelle, info.Parcelle_Culturale);
          byFarm[ferme] = (byFarm[ferme] || 0) + 1;
          byDayMap[info.date] = (byDayMap[info.date] || 0) + 1;
          return { matricule: mat, nom: info.nom, firstDate: info.date, ferme, equipe: mat.substring(0, 2), operationFamille: info.Operation_Famille || "" };
        })
        .sort((a, b) => b.firstDate.localeCompare(a.firstDate) || a.nom.localeCompare(b.nom));
      const totalToday = workers.filter(w => w.firstDate === today).length;
      const byDay = Object.entries(byDayMap).map(([jour, count]) => ({ jour, count })).sort((a, b) => b.jour.localeCompare(a.jour));
      return { success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers };
    });
    results.push("nouveaux-ouvriers:ok");
  } catch (e) { results.push(`nouveaux-ouvriers:${e.message}`); }

  // 8. Hors-récolte
  try {
    await withCache(`pointage_hors_recolte_${today}`, 0, async () => {
      const rawRows = await getPointageRowsForDate(today);
      const filtered = rawRows.filter(r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes");
      const groups = {};
      for (const r of filtered) {
        const key = `${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}|${r.Parcelle_Culturale}`;
        if (!groups[key]) groups[key] = { Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, workers: new Set(), totalHr: 0, totalJr: 0, totalCout: 0 };
        groups[key].workers.add(r.Personnel_Matricule);
        groups[key].totalHr += r.Nombre_Hr || 0;
        groups[key].totalJr += r.Nombre_Jr || 0;
        groups[key].totalCout += r.Cout || 0;
      }
      const ops = Object.values(groups).map(g => ({ operationFamille: g.Operation_Famille, operation: g.Operation, effectif: g.workers.size, heures: g.totalHr, journees: g.totalJr, cout: Math.round(g.totalCout), parcelle: (g.Parcelle_Culturale || "").trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale) })).sort((a, b) => b.effectif - a.effectif);
      return { success: true, date: today, operations: ops };
    });
    results.push("hors-recolte:ok");
  } catch (e) { results.push(`hors-recolte:${e.message}`); }

  // 9. Suivi-tunnels (per ferme)
  try {
    for (const ferme of ['F1', 'F5', 'Avocatier']) {
      await withCache(`pointage_suivi_tunnels_${today}_${ferme}`, 0, async () => {
        const yesterdayStr = new Date(new Date(today).getTime() - 86400000).toISOString().slice(0, 10);
        const thirtyDaysAgo = new Date(new Date(today).getTime() - 30 * 86400000).toISOString().slice(0, 10);
        const [todayRows, cumulRows] = await Promise.all([
          getPointageRowsForDate(today),
          getPointageRowsForDateRange(thirtyDaysAgo, yesterdayStr),
        ]);
        const filterHR = r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes";
        const todayGroups = {};
        for (const r of todayRows.filter(filterHR)) {
          const key = `${r.Operation}|${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Variete}`;
          if (!todayGroups[key]) todayGroups[key] = { ...r, workers: new Set(), quantiteRealisee: 0, totalHr: 0, totalJr: 0, totalCout: 0 };
          todayGroups[key].workers.add(r.Personnel_Matricule);
          todayGroups[key].quantiteRealisee += r.Quantite_unite || 0;
          todayGroups[key].totalHr += r.Nombre_Hr || 0;
          todayGroups[key].totalCout += r.Cout || 0;
        }
        const cumulMap = {};
        for (const r of cumulRows.filter(filterHR)) {
          const key = `${(r.Parcelle_Culturale || '').trim()}_${r.Operation}`;
          if (!cumulMap[key]) cumulMap[key] = { quantiteCumul: 0, joursCumul: 0 };
          cumulMap[key].quantiteCumul += r.Quantite_unite || 0;
          cumulMap[key].joursCumul += r.Nombre_Jr || 0;
        }
        const byFerme = {};
        for (const g of Object.values(todayGroups)) {
          const f = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
          if (f !== ferme) continue;
          if (!byFerme[f]) byFerme[f] = [];
          const parcelle = (g.Parcelle_Culturale || '').trim();
          const cumul = cumulMap[`${parcelle}_${g.Operation}`] || { quantiteCumul: 0 };
          byFerme[f].push({ parcelle, variete: g.Variete || parcelle, tache: g.Operation, nbOuvriers: g.workers.size, realiseAujourdhui: Math.round(g.quantiteRealisee), dejaRealise: Math.round(cumul.quantiteCumul), totalRealise: Math.round(cumul.quantiteCumul + g.quantiteRealisee), heures: g.totalHr, cout: Math.round(g.totalCout), ferme: f });
        }
        return { success: true, date: today, tunnels: byFerme };
      });
    }
    results.push("suivi-tunnels:ok");
  } catch (e) { results.push(`suivi-tunnels:${e.message}`); }

  console.log(`[cacheWarmer] Results: ${results.join(", ")}`);
  return results;
}

// Scheduled function — runs every 10 minutes
exports.warmPointageCache = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .pubsub.schedule("every 10 minutes")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    await warmAllPointageCaches();
    return null;
  });

// =============================================
// API: pointageRH
// =============================================
exports.pointageRH = functions.region("europe-west1").https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const action = req.query.action || "summary";
      const dateParam = req.query.date; // YYYY-MM-DD
      const db = USE_MIRROR ? null : await getPool();

      // ------ CONFECTION-TYPES: extract distinct confection types from BR_Pointage ------
      if (action === "confection-types") {
        try {
          let operations = [];
          if (USE_MIRROR) {
            // Lire depuis le mirror Firestore
            const dates = await getAvailableDates();
            const recentDates = dates.slice(0, 10);
            const opsSet = new Set();
            for (const d of recentDates) {
              const rows = await getPointageRowsForDate(d);
              rows.filter(r => r.Operation_Famille === "8. Récolte" && /caisse/i.test(r.Operation || ""))
                  .forEach(r => opsSet.add((r.Operation || "").trim()));
            }
            operations = [...opsSet];
          } else {
            const result = await db.request().query(`
              SELECT DISTINCT Operation FROM BR_Pointage
              WHERE Operation_Famille = N'8. Récolte'
              AND Operation LIKE N'%Caisse%kg%'
            `);
            operations = result.recordset.map(r => (r.Operation || "").trim()).filter(Boolean);
          }
          // Extraire le poids par colis depuis le nom de l'opération (caisse, barquette, seau, etc.)
          const types = operations.map(op => {
            const match = op.match(/([\d.]+)\s*kg/i);
            const poidsParColis = match ? parseFloat(match[1]) : 1.5;
            return { id: op.replace(/\s+/g, '_').toLowerCase(), label: op, poidsParColis, composition: [], source: 'beeone' };
          }).sort((a, b) => a.poidsParColis - b.poidsParColis);
          return res.json({ success: true, types });
        } catch(e) {
          console.error('confection-types error:', e);
          return res.json({ success: true, types: [] });
        }
      }

      // ------ PRESENCE: heures entrée/sortie depuis BEE_BERRY_GOOD (mirror prod_presence) ------
      if (action === "presence") {
        const date = dateParam || new Date().toISOString().slice(0, 10);
        const snap = await db_firestore.collection("prod_presence").doc(date).get();
        if (!snap.exists) {
          return res.json({ success: true, date, rows: [], rowCount: 0, syncedAt: null });
        }
        const data = snap.data();
        return res.json({
          success: true,
          date,
          rows: data.rows || [],
          rowCount: data.rowCount || 0,
          syncedAt: data.syncedAt || null,
        });
      }

      // ------ SUMMARY: effectif today + yesterday + weekly trend + top ops ------
      if (action === "summary") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const cacheKey = `pointage_summary_${dateForCheck}`;
        const cached = await withCache(cacheKey, 2 * 60 * 1000, async () => {
        const submittedFermes = await getSubmittedFermes(dateForCheck);

        if (USE_MIRROR) {
          // === MIRROR PATH ===
          const yesterdayStr = new Date(new Date(dateForCheck).getTime() - 86400000).toISOString().slice(0, 10);
          const weekStartStr = new Date(new Date(dateForCheck).getTime() - 6 * 86400000).toISOString().slice(0, 10);
          const [todayRows, yesterdayRows, weekRows] = await Promise.all([
            getPointageRowsForDate(dateForCheck),
            getPointageRowsForDate(yesterdayStr),
            getPointageRowsForDateRange(weekStartStr, dateForCheck),
          ]);
          // Build fermes effectif from today rows
          const fermes = { F1: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, F5: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, Avocatier: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 } };
          const todayGroups = {};
          for (const r of todayRows) {
            const key = `${r.Ref_parcelle}|${r.Parcelle_Culturale}|${r.Operation_Famille}`;
            if (!todayGroups[key]) todayGroups[key] = { ...r, workers: new Set(), totalCout: 0 };
            todayGroups[key].workers.add(r.Personnel_Matricule);
            todayGroups[key].totalCout += r.Cout || 0;
          }
          for (const g of Object.values(todayGroups)) {
            const ferme = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
            const type = classifyType(g.Operation_Famille);
            if (fermes[ferme]) { fermes[ferme][type] += g.workers.size; fermes[ferme].cout += g.totalCout; }
          }
          // Yesterday
          const fermesYesterday = { F1: { total: 0 }, F5: { total: 0 }, Avocatier: { total: 0 } };
          const yGroups = {};
          for (const r of yesterdayRows) {
            const key = `${r.Ref_parcelle}|${r.Parcelle_Culturale}|${r.Operation_Famille}`;
            if (!yGroups[key]) yGroups[key] = { ...r, workers: new Set() };
            yGroups[key].workers.add(r.Personnel_Matricule);
          }
          for (const g of Object.values(yGroups)) {
            const ferme = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
            if (fermesYesterday[ferme]) fermesYesterday[ferme].total += g.workers.size;
          }
          // Override with snapshot data
          for (const f of Object.keys(submittedFermes)) {
            const snapData = await getSnapshotData(dateForCheck, f);
            if (snapData && snapData.summary && fermes[f]) fermes[f] = snapData.summary;
          }
          const pointageJour = Object.keys(fermes).map(f => {
            const e = fermes[f]; const total = e.recolte + e.horsRecolte + e.postesFixes;
            const veille = fermesYesterday[f] ? fermesYesterday[f].total : total;
            return { ferme: f, total, recolte: e.recolte, horsRecolte: e.horsRecolte, postesFixes: e.postesFixes, cout: Math.round(e.cout), veille, diff: veille > 0 ? Math.round(((total - veille) / veille) * 1000) / 10 : 0 };
          });
          // Weekly trend
          const trendMap = {};
          for (const r of weekRows) {
            const key = r.DateStr;
            if (!trendMap[key]) trendMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short" }), F1: new Set(), F5: new Set(), Avocatier: new Set() };
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            if (trendMap[key][ferme]) trendMap[key][ferme].add(r.Personnel_Matricule);
          }
          const weeklyTrend = Object.values(trendMap).map(t => ({ jour: t.jour, jourLabel: t.jourLabel, F1: t.F1.size, F5: t.F5.size, Avocatier: t.Avocatier.size })).sort((a, b) => a.jour.localeCompare(b.jour));
          // Top ops
          const opsGroups = {};
          for (const r of todayRows) {
            if (r.Operation_Famille === "8. Récolte" || r.Operation_Famille === "11. Postes fixes") continue;
            const key = `${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}|${r.Parcelle_Culturale}`;
            if (!opsGroups[key]) opsGroups[key] = { ...r, workers: new Set(), totalHr: 0 };
            opsGroups[key].workers.add(r.Personnel_Matricule);
            opsGroups[key].totalHr += r.Nombre_Hr || 0;
          }
          const topOps = Object.values(opsGroups).map(g => ({ operation: g.Operation || g.Operation_Famille, operationFamille: g.Operation_Famille, effectif: g.workers.size, heures: g.totalHr, parcelle: (g.Parcelle_Culturale || "").trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale) })).sort((a, b) => b.effectif - a.effectif).slice(0, 10);
          // Recolte kg
          const recolteRows = todayRows.filter(r => r.Operation_Famille === "8. Récolte");
          const recolteWorkers = new Set(recolteRows.map(r => r.Personnel_Matricule));
          const recolteQty = recolteRows.reduce((s, r) => s + (r.Quantite_unite || 0), 0);
          const recolteCout = recolteRows.reduce((s, r) => s + (r.Cout || 0), 0);
          const syncStatus = await getSyncStatus();
          return { success: true, date: dateForCheck, effectif: fermes, pointageJour, weeklyTrend, topOps, recolteTotal: { qty: recolteQty, nbOuv: recolteWorkers.size, cout: Math.round(recolteCout) }, lastSaisie: syncStatus?.lastSuccessAt || null, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null };
        }

        // === FALLBACK SQL PATH ===
        const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";

        const [todayRes, yesterdayRes, trendRes, topOpsRes, recolteKgRes, lastSaisieRes] = await Promise.all([
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille`),
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, COUNT(DISTINCT Personnel_Matricule) AS nbOuv FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = DATEADD(day, -1, ${dateSQL}) GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille`),
          db.request().query(`SELECT CONVERT(date, Periode_Date) AS jour, Ref_parcelle, Parcelle_Culturale, COUNT(DISTINCT Personnel_Matricule) AS nbOuv FROM BR_Pointage WHERE Periode_Date >= DATEADD(day, -6, ${dateSQL}) AND CONVERT(date, Periode_Date) <= ${dateSQL} GROUP BY CONVERT(date, Periode_Date), Ref_parcelle, Parcelle_Culturale ORDER BY jour`),
          db.request().query(`SELECT Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Hr) AS totalHr FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != '8. Récolte' AND Operation_Famille != '11. Postes fixes' GROUP BY Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale ORDER BY nbOuv DESC`),
          db.request().query(`SELECT SUM(Quantite_unite) AS totalQty, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = '8. Récolte'`),
          db.request().query(`SELECT TOP 1 Periode_Date FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} ORDER BY Periode_Date DESC`),
        ]);

        const fermes = { F1: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, F5: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 }, Avocatier: { recolte: 0, horsRecolte: 0, postesFixes: 0, cout: 0 } };
        const fermesYesterday = { F1: { total: 0 }, F5: { total: 0 }, Avocatier: { total: 0 } };

        for (const row of todayRes.recordset) {
          const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale);
          const type = classifyType(row.Operation_Famille);
          if (fermes[ferme]) { fermes[ferme][type] += row.nbOuv; fermes[ferme].cout += row.totalCout || 0; }
        }
        for (const row of yesterdayRes.recordset) {
          const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale);
          if (fermesYesterday[ferme]) fermesYesterday[ferme].total += row.nbOuv;
        }

        // Override with snapshot data for submitted fermes
        for (const f of Object.keys(submittedFermes)) {
          const snapData = await getSnapshotData(dateForCheck, f);
          if (snapData && snapData.summary && fermes[f]) {
            fermes[f] = snapData.summary;
          }
        }

        // Build pointageJour array
        const pointageJour = Object.keys(fermes).map(f => {
          const e = fermes[f];
          const total = e.recolte + e.horsRecolte + e.postesFixes;
          const veille = fermesYesterday[f] ? fermesYesterday[f].total : total;
          return {
            ferme: f, total, recolte: e.recolte, horsRecolte: e.horsRecolte, postesFixes: e.postesFixes,
            cout: Math.round(e.cout), veille, diff: veille > 0 ? Math.round(((total - veille) / veille) * 1000) / 10 : 0,
          };
        });

        // Weekly trend
        const trendMap = {};
        for (const row of trendRes.recordset) {
          const d = new Date(row.jour);
          const key = d.toISOString().slice(0, 10);
          if (!trendMap[key]) trendMap[key] = { jour: key, jourLabel: d.toLocaleDateString("fr-FR", { weekday: "short" }), F1: 0, F5: 0, Avocatier: 0 };
          const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale);
          if (trendMap[key][ferme] !== undefined) trendMap[key][ferme] += row.nbOuv;
        }
        const weeklyTrend = Object.values(trendMap).sort((a, b) => a.jour.localeCompare(b.jour));

        // Top ops
        const topOps = topOpsRes.recordset.slice(0, 10).map(r => ({
          operation: r.Operation || r.Operation_Famille,
          operationFamille: r.Operation_Famille,
          effectif: r.nbOuv,
          heures: r.totalHr,
          parcelle: (r.Parcelle_Culturale || "").trim(),
          ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
        }));

        const recolteKg = recolteKgRes.recordset[0] || {};
        const lastSaisieRow = lastSaisieRes.recordset[0];
        const lastSaisie = lastSaisieRow ? new Date(lastSaisieRow.Periode_Date).toISOString() : null;

        return {
          success: true, date: dateParam || new Date().toISOString().slice(0, 10),
          effectif: fermes, pointageJour, weeklyTrend, topOps,
          recolteTotal: { qty: recolteKg.totalQty || 0, nbOuv: recolteKg.nbOuv || 0, cout: Math.round(recolteKg.totalCout || 0) },
          lastSaisie,
        };
        }); // end withCache
        return res.json(cached);
      }

      // ------ DETAIL: detailed pointage for a date ------
      if (action === "detail") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const cached = await withCache(`pointage_detail_${dateForCheck}`, 2 * 60 * 1000, async () => {
        const submittedFermes = await getSubmittedFermes(dateForCheck);

        let rows;
        if (USE_MIRROR) {
          rows = await fetchDetailFromMirror(dateForCheck);
        } else {
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`
            SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
              Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle, Variete, Culture,
              HS_25, HS_50, HS_100, HS_NM
            FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL}
            ORDER BY Ref_parcelle, Operation_Famille, Personnel_Nom`);
          rows = result.recordset.map(r => ({
            matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
            operationFamille: r.Operation_Famille, operation: r.Operation, groupe: r.Operation_Groupe,
            jours: r.Nombre_Jr, heures: r.Nombre_Hr, quantite: r.Quantite_unite, cout: r.Cout,
            parcelle: (r.Parcelle_Culturale || "").trim(), refParcelle: (r.Ref_parcelle || "").trim(),
            ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), type: classifyType(r.Operation_Famille),
            variete: r.Variete, culture: r.Culture, hs25: r.HS_25, hs50: r.HS_50, hs100: r.HS_100,
          }));
        }

        if (Object.keys(submittedFermes).length > 0) {
          const liveRows = rows.filter(r => !submittedFermes[r.ferme]);
          let snapshotRows = [];
          for (const f of Object.keys(submittedFermes)) {
            const snapData = await getSnapshotData(dateForCheck, f);
            if (snapData && snapData.detailRows) snapshotRows = snapshotRows.concat(snapData.detailRows);
          }
          rows = [...liveRows, ...snapshotRows];
        }

        return { success: true, date: dateForCheck, rows, count: rows.length };
        }); // end withCache
        return res.json(cached);
      }

      // ------ RECOLTE: harvest workers for a date ------
      if (action === "recolte") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const cached = await withCache(`pointage_recolte_${dateForCheck}`, 2 * 60 * 1000, async () => {
        let workers, cueillette;

        if (USE_MIRROR) {
          const [pointageRows, cueilletteRows] = await Promise.all([
            getPointageRowsForDate(dateForCheck),
            getCueilletteRows(dateForCheck, dateForCheck),
          ]);
          // Cueillette
          const cGroups = {};
          for (const r of cueilletteRows.filter(r => r.Operation_Famille === "8. Récolte")) {
            const key = `${r.Parcelle_Culturale}|${r.Variete}`;
            if (!cGroups[key]) cGroups[key] = { parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, refTech: (r.Reference_Technique || "").trim(), totalKg: 0, totalCaisses: 0 };
            cGroups[key].totalKg += r.Poids_total_kg || 0;
            cGroups[key].totalCaisses += r.Nbre_Caisse || 0;
          }
          cueillette = Object.values(cGroups).map(c => ({ ...c, ferme: deriveFerme(c.refTech || null, c.parcelle) })).sort((a, b) => b.totalKg - a.totalKg);
          // Workers from pointage
          workers = pointageRows
            .filter(r => r.Operation_Famille === "8. Récolte")
            .map((r, i) => ({
              rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
              operation: r.Operation, quantite: quantiteToKg(r.Quantite_unite, r.Operation),
              heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(),
              ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete,
            }));
        } else {
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const [pointageRes, cueilletteRes] = await Promise.all([
            db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, Operation, Quantite_unite, Nombre_Hr, Cout, Parcelle_Culturale, Ref_parcelle, Variete FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'8. Récolte' ORDER BY Quantite_unite DESC, Personnel_Nom`),
            db.request().query(`SELECT Parcelle_Culturale, Variete, Reference_Technique, SUM(Poids_total_kg) AS totalKg, SUM(Nbre_Caisse) AS totalCaisses FROM BR_Cueillette WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'8. Récolte' GROUP BY Parcelle_Culturale, Variete, Reference_Technique ORDER BY totalKg DESC`),
          ]);
          cueillette = cueilletteRes.recordset.map(r => ({ parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, ferme: deriveFerme(r.Reference_Technique, r.Parcelle_Culturale), totalKg: r.totalKg || 0, totalCaisses: r.totalCaisses || 0 }));
          workers = pointageRes.recordset.map((r, i) => ({ rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), operation: r.Operation, quantite: quantiteToKg(r.Quantite_unite, r.Operation), heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete }));
        }

        // Enrich with production data (Tracabilite_recolte) if available
        let prodSyncedAt = null;
        try {
          const prodDoc = await db_firestore.collection("prod_tracabilite_recolte").doc(dateForCheck).get();
          if (prodDoc.exists) {
            const prodData = prodDoc.data();
            if (prodData.syncedAt && typeof prodData.syncedAt.toMillis === "function") {
              prodSyncedAt = prodData.syncedAt.toMillis();
            }
          }
          // Fallback: if no doc for this date (no scans yet), use the global last-run timestamp
          if (!prodSyncedAt) {
            const statusDoc = await db_firestore.collection("prod_tracabilite_recolte").doc("_status").get();
            if (statusDoc.exists) {
              const s = statusDoc.data();
              if (s.lastRunAt && typeof s.lastRunAt.toMillis === "function") {
                prodSyncedAt = s.lastRunAt.toMillis();
              }
            }
          }
          if (prodDoc.exists) {
            const prodData = prodDoc.data();
            const prodRows = prodData.rows || [];
            if (prodRows.length > 0) {
              // Deduplicate workers by matricule (keep first, merge info)
              const deduped = {};
              workers.forEach(w => {
                const matUp = (w.matricule || "").toUpperCase();
                if (!deduped[matUp]) {
                  deduped[matUp] = { ...w };
                } else {
                  // Merge: keep existing but add heures/cout
                  deduped[matUp].heures += w.heures || 0;
                  deduped[matUp].cout += w.cout || 0;
                }
              });
              workers = Object.values(deduped);

              const prodMap = {};
              prodRows.forEach(r => { prodMap[(r.matricule || "").toUpperCase()] = r; });
              // Override kg for existing workers — prod is the source of truth for kg
              workers.forEach(w => {
                const prod = prodMap[(w.matricule || "").toUpperCase()];
                if (prod) {
                  w.quantite = prod.totalKg;
                  w.variete = prod.variete || w.variete;
                } else {
                  w.quantite = 0;
                }
              });
              // Add workers in prod but missing from pointage
              prodRows.forEach(r => {
                const matUp = (r.matricule || "").toUpperCase();
                if (!workers.find(w => (w.matricule || "").toUpperCase() === matUp)) {
                  workers.push({
                    rank: 0, matricule: r.matricule, nom: r.nom,
                    operation: "Récolte (prod)", quantite: r.totalKg,
                    heures: 0, cout: 0, parcelle: r.refParcelle || "",
                    ferme: deriveFerme(r.refParcelle, ""), variete: r.variete,
                  });
                }
              });
              // Use prod totalKg instead of BR_Cueillette
              cueillette = [{ parcelle: "Total (prod)", variete: "", ferme: "", totalKg: prodData.totalKg || 0, totalCaisses: 0 }];
            }
          }
        } catch (prodErr) {
          console.warn("[recolte] Prod data unavailable, using reporting:", prodErr.message);
        }

        workers.sort((a, b) => b.quantite - a.quantite || a.nom.localeCompare(b.nom));
        workers.forEach((w, i) => { w.rank = i + 1; });
        const totalKgCueillette = cueillette.reduce((s, c) => s + c.totalKg, 0);
        return { success: true, date: dateForCheck, workers, cueillette, totalKgCueillette, count: workers.length, prodSyncedAt };
        }); // end withCache
        return res.json(cached);
      }

      // ------ QUINZAINE: bi-weekly summary ------
      if (action === "quinzaine") {
        const periodeParam = req.query.periode;
        const cacheKey = `pointage_quinzaine_${periodeParam || "latest"}`;
        const cached = await withCache(cacheKey, 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.allPeriodes || meta?.periodes || [];
          const mirrorPeriodes = meta?.periodes || [];
          const selectedPeriode = periodeParam || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, periodes, totalJournees: 0, totalCout: 0, parFerme: [], parJour: [] };

          // If selected period has mirror data, use Firestore; otherwise fallback to SQL
          let rows;
          if (mirrorPeriodes.includes(selectedPeriode) && meta?.periodeMap?.[selectedPeriode]) {
            rows = await getPointageRowsForPeriode(selectedPeriode);
          } else {
            // Check Firestore archive first
            const archiveDoc = await db_firestore.collection("quinzaine_archive").doc(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().summary) {
              const arch = archiveDoc.data().summary;
              return {
                success: true, periode: selectedPeriode, periodes,
                totalJournees: arch.totalJournees, totalCout: arch.totalCout,
                parFerme: arch.parFerme, parJour: arch.parJour,
              };
            }
            // Fallback: fetch directly from SQL for older quinzaines
            const sqlDb = await getPool();
            const sqlResult = await sqlDb.request().input('periode', selectedPeriode).query(`
              SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
                Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle,
                Variete, Culture, Periode_paie,
                CONVERT(varchar(10), Periode_Date, 23) AS DateStr,
                HS_25, HS_50, HS_100, HS_NM
              FROM BR_Pointage
              WHERE Periode_paie = @periode
              ORDER BY Periode_Date, Personnel_Nom
            `);
            rows = sqlResult.recordset.map(r => ({
              Personnel_Matricule: (r.Personnel_Matricule || "").trim(),
              Personnel_Nom: (r.Personnel_Nom || "").trim(),
              Operation_Famille: r.Operation_Famille,
              Operation: r.Operation,
              Operation_Groupe: r.Operation_Groupe,
              Nombre_Jr: r.Nombre_Jr,
              Nombre_Hr: r.Nombre_Hr,
              Quantite_unite: r.Quantite_unite,
              Cout: r.Cout,
              Parcelle_Culturale: (r.Parcelle_Culturale || "").trim(),
              Ref_parcelle: (r.Ref_parcelle || "").trim(),
              Variete: (r.Variete || "").trim(),
              Culture: (r.Culture || "").trim(),
              Periode_paie: (r.Periode_paie || "").trim(),
              DateStr: r.DateStr,
              HS_25: r.HS_25 || 0, HS_50: r.HS_50 || 0, HS_100: r.HS_100 || 0, HS_NM: r.HS_NM || 0,
            }));
          }
          // Summary per ferme
          const qFermes = { F1: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, F5: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, Avocatier: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 } };
          for (const r of rows) {
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            const type = classifyType(r.Operation_Famille);
            if (qFermes[ferme]) { qFermes[ferme].journees += r.Nombre_Jr || 0; qFermes[ferme].cout += r.Cout || 0; qFermes[ferme][type] += r.Nombre_Jr || 0; }
          }
          // Per day
          const dayMap = {};
          for (const r of rows) {
            const key = r.DateStr;
            if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: new Date(key).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: new Set(), journees: 0, cout: 0, F1: new Set(), F5: new Set(), Avocatier: new Set() };
            dayMap[key].nbOuv.add(r.Personnel_Matricule);
            dayMap[key].journees += r.Nombre_Jr || 0;
            dayMap[key].cout += r.Cout || 0;
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            if (dayMap[key][ferme]) dayMap[key][ferme].add(r.Personnel_Matricule);
          }
          const perDay = Object.values(dayMap).map(d => ({ jour: d.jour, jourLabel: d.jourLabel, nbOuv: d.nbOuv.size, journees: d.journees, cout: d.cout, F1: d.F1.size, F5: d.F5.size, Avocatier: d.Avocatier.size })).sort((a, b) => a.jour.localeCompare(b.jour));
          const totalJournees = Object.values(qFermes).reduce((s, f) => s + f.journees, 0);
          const totalCout = Object.values(qFermes).reduce((s, f) => s + f.cout, 0);
          return { success: true, periode: selectedPeriode, periodes, totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay };
        }

        // === FALLBACK SQL PATH ===
        let periodeFilter = "";
        if (periodeParam) { periodeFilter = `AND Periode_paie = '${periodeParam}'`; }
        else { const latest = await db.request().query(`SELECT TOP 1 Periode_paie FROM BR_Pointage ORDER BY Periode_Date DESC`); const latestPeriode = latest.recordset[0]?.Periode_paie || ""; periodeFilter = latestPeriode ? `AND Periode_paie = '${latestPeriode}'` : ""; }
        const [summaryRes, perDayRes, periodesRes] = await Promise.all([
          db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, Operation_Famille, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout, SUM(Quantite_unite) AS totalQty FROM BR_Pointage WHERE 1=1 ${periodeFilter} GROUP BY Ref_parcelle, Parcelle_Culturale, Operation_Famille`),
          db.request().query(`SELECT CONVERT(date, Periode_Date) AS jour, Ref_parcelle, Parcelle_Culturale, Operation_Famille, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE 1=1 ${periodeFilter} GROUP BY CONVERT(date, Periode_Date), Ref_parcelle, Parcelle_Culturale, Operation_Famille ORDER BY jour`),
          db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`),
        ]);
        const qFermes = { F1: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, F5: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 }, Avocatier: { journees: 0, cout: 0, recolte: 0, horsRecolte: 0, postesFixes: 0 } };
        for (const row of summaryRes.recordset) { const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale); const type = classifyType(row.Operation_Famille); if (qFermes[ferme]) { qFermes[ferme].journees += row.totalJr || 0; qFermes[ferme].cout += row.totalCout || 0; qFermes[ferme][type] += row.totalJr || 0; } }
        const dayMap = {};
        for (const row of perDayRes.recordset) { const d = new Date(row.jour); const key = d.toISOString().slice(0, 10); if (!dayMap[key]) dayMap[key] = { jour: key, jourLabel: d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), nbOuv: 0, journees: 0, cout: 0, F1: 0, F5: 0, Avocatier: 0 }; const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale); dayMap[key].nbOuv += row.nbOuv; dayMap[key].journees += row.totalJr || 0; dayMap[key].cout += row.totalCout || 0; if (dayMap[key][ferme] !== undefined) dayMap[key][ferme] += row.nbOuv; }
        const perDay = Object.values(dayMap).sort((a, b) => a.jour.localeCompare(b.jour));
        const totalJournees = Object.values(qFermes).reduce((s, f) => s + f.journees, 0);
        const totalCout = Object.values(qFermes).reduce((s, f) => s + f.cout, 0);
        return { success: true, periode: periodeParam || "latest", periodes: periodesRes.recordset.map(r => r.Periode_paie), totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay };
        }); // end withCache
        return res.json(cached);
      }

      // ------ QUINZAINE-ANALYTIQUE: pivot parcelle x operation ------
      if (action === "quinzaine-analytique") {
        const periodeParam = req.query.periode;
        const cacheKey = `pointage_quinzaine_analytique_${periodeParam || "latest"}`;
        const cached = await withCache(cacheKey, 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          const selectedPeriode = periodeParam || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, periodes, rows: [] };
          const rawRows = await getPointageRowsForPeriode(selectedPeriode);
          if (rawRows.length === 0) {
            // Check Firestore archive
            const archiveDoc = await db_firestore.collection("quinzaine_archive").doc(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().analytique) {
              return { success: true, periode: selectedPeriode, periodes, rows: archiveDoc.data().analytique };
            }
          }
          // Group by parcelle+ref+opFamille+operation
          const groups = {};
          for (const r of rawRows) {
            const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}|${r.Operation}`;
            if (!groups[key]) groups[key] = { Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Operation_Famille: r.Operation_Famille, Operation: r.Operation, workers: new Set(), JH: 0, Cout: 0 };
            groups[key].workers.add(r.Personnel_Matricule);
            groups[key].JH += r.Nombre_Jr || 0;
            groups[key].Cout += r.Cout || 0;
          }
          const rows = Object.values(groups).map(g => ({ parcelle: (g.Parcelle_Culturale || '').trim(), refParcelle: (g.Ref_parcelle || '').trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale), operationFamille: g.Operation_Famille, operation: g.Operation, nbOuv: g.workers.size, jh: Math.round(g.JH * 100) / 100, cout: Math.round(g.Cout) }));
          return { success: true, periode: selectedPeriode, periodes, rows };
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const selectedPeriode = periodeParam || periodes[0];
        const result = await db.request().query(`SELECT Parcelle_Culturale, Ref_parcelle, Operation_Famille, Operation, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS JH, SUM(Cout) AS Cout FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' GROUP BY Parcelle_Culturale, Ref_parcelle, Operation_Famille, Operation ORDER BY Parcelle_Culturale, Operation_Famille`);
        const rows = result.recordset.map(r => ({ parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), operationFamille: r.Operation_Famille, operation: r.Operation, nbOuv: r.nbOuv, jh: Math.round((r.JH || 0) * 100) / 100, cout: Math.round(r.Cout || 0) }));
        return { success: true, periode: selectedPeriode, periodes, rows };
        }); // end withCache
        return res.json(cached);
      }

      // ------ HORS-RECOLTE: operations breakdown ------
      if (action === "hors-recolte") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const cached = await withCache(`pointage_hors_recolte_${dateForCheck}`, 10 * 60 * 1000, async () => {
          if (USE_MIRROR) {
            const rawRows = await getPointageRowsForDate(dateForCheck);
            const filtered = rawRows.filter(r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes");
            const groups = {};
            for (const r of filtered) {
              const key = `${r.Operation_Famille}|${r.Operation}|${r.Ref_parcelle}|${r.Parcelle_Culturale}`;
              if (!groups[key]) groups[key] = { Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, workers: new Set(), totalHr: 0, totalJr: 0, totalCout: 0 };
              groups[key].workers.add(r.Personnel_Matricule);
              groups[key].totalHr += r.Nombre_Hr || 0;
              groups[key].totalJr += r.Nombre_Jr || 0;
              groups[key].totalCout += r.Cout || 0;
            }
            const ops = Object.values(groups).map(g => ({ operationFamille: g.Operation_Famille, operation: g.Operation, effectif: g.workers.size, heures: g.totalHr, journees: g.totalJr, cout: Math.round(g.totalCout), parcelle: (g.Parcelle_Culturale || "").trim(), ferme: deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale) })).sort((a, b) => b.effectif - a.effectif);
            return { success: true, date: dateForCheck, operations: ops };
          }
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`SELECT Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Hr) AS totalHr, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != '8. Récolte' AND Operation_Famille != '11. Postes fixes' GROUP BY Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale ORDER BY Operation_Famille, nbOuv DESC`);
          const ops = result.recordset.map(r => ({ operationFamille: r.Operation_Famille, operation: r.Operation, effectif: r.nbOuv, heures: r.totalHr, journees: r.totalJr, cout: Math.round(r.totalCout || 0), parcelle: (r.Parcelle_Culturale || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) }));
          return { success: true, date: dateForCheck, operations: ops };
        });
        return res.json(cached);
      }

      // ------ SUIVI-TUNNELS: hors-récolte progress by parcelle/tâche for caporal screens ------
      if (action === "suivi-tunnels") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const fermeParam = req.query.ferme;
        const cacheKey = `pointage_suivi_tunnels_${dateForCheck}_${fermeParam || 'all'}`;
        const cached = await withCache(cacheKey, 10 * 60 * 1000, async () => {
          if (USE_MIRROR) {
            const meta = await getPointageMeta();
            const earliestDate = meta?.availableDates?.[meta.availableDates.length - 1] || dateForCheck;
            const yesterdayStr = new Date(new Date(dateForCheck).getTime() - 86400000).toISOString().slice(0, 10);
            // Limit cumul range to 30 days max to avoid loading entire history
            const thirtyDaysAgo = new Date(new Date(dateForCheck).getTime() - 30 * 86400000).toISOString().slice(0, 10);
            const startDate = earliestDate > thirtyDaysAgo ? earliestDate : thirtyDaysAgo;
            const [todayRows, cumulRows] = await Promise.all([
              getPointageRowsForDate(dateForCheck),
              getPointageRowsForDateRange(startDate, yesterdayStr),
            ]);
            const filterHR = r => r.Operation_Famille !== "8. Récolte" && r.Operation_Famille !== "11. Postes fixes";
            // Today groups
            const todayGroups = {};
            for (const r of todayRows.filter(filterHR)) {
              const key = `${r.Operation}|${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Variete}`;
              if (!todayGroups[key]) todayGroups[key] = { ...r, workers: new Set(), quantiteRealisee: 0, totalHr: 0, totalJr: 0, totalCout: 0 };
              todayGroups[key].workers.add(r.Personnel_Matricule);
              todayGroups[key].quantiteRealisee += r.Quantite_unite || 0;
              todayGroups[key].totalHr += r.Nombre_Hr || 0;
              todayGroups[key].totalCout += r.Cout || 0;
            }
            // Cumul
            const cumulMap = {};
            for (const r of cumulRows.filter(filterHR)) {
              const key = `${(r.Parcelle_Culturale || '').trim()}_${r.Operation}`;
              if (!cumulMap[key]) cumulMap[key] = { quantiteCumul: 0, joursCumul: 0 };
              cumulMap[key].quantiteCumul += r.Quantite_unite || 0;
              cumulMap[key].joursCumul += r.Nombre_Jr || 0;
            }
            const byFerme = {};
            for (const g of Object.values(todayGroups)) {
              const ferme = deriveFerme(g.Ref_parcelle, g.Parcelle_Culturale);
              if (fermeParam && ferme !== fermeParam) continue;
              if (!byFerme[ferme]) byFerme[ferme] = [];
              const parcelle = (g.Parcelle_Culturale || '').trim();
              const cumul = cumulMap[`${parcelle}_${g.Operation}`] || { quantiteCumul: 0 };
              byFerme[ferme].push({ parcelle, variete: g.Variete || parcelle, tache: g.Operation, nbOuvriers: g.workers.size, realiseAujourdhui: Math.round(g.quantiteRealisee), dejaRealise: Math.round(cumul.quantiteCumul), totalRealise: Math.round(cumul.quantiteCumul + g.quantiteRealisee), heures: g.totalHr, cout: Math.round(g.totalCout), ferme });
            }
            return { success: true, date: dateForCheck, tunnels: byFerme };
          }

          // SQL fallback
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`SELECT Operation, Parcelle_Culturale, Ref_parcelle, Variete, COUNT(DISTINCT Personnel_Matricule) AS nbOuvriers, SUM(Quantite_unite) AS quantiteRealisee, SUM(Nombre_Hr) AS totalHr, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != N'8. Récolte' AND Operation_Famille != N'11. Postes fixes' GROUP BY Operation, Parcelle_Culturale, Ref_parcelle, Variete ORDER BY Parcelle_Culturale, Operation`);
          const cumulResult = await db.request().query(`SELECT Operation, Parcelle_Culturale, Ref_parcelle, SUM(Quantite_unite) AS quantiteCumul, SUM(Nombre_Jr) AS joursCumul FROM BR_Pointage WHERE CONVERT(date, Periode_Date) < ${dateSQL} AND Operation_Famille != N'8. Récolte' AND Operation_Famille != N'11. Postes fixes' GROUP BY Operation, Parcelle_Culturale, Ref_parcelle`);
          const cumulMap = {};
          for (const r of cumulResult.recordset) { cumulMap[`${(r.Parcelle_Culturale || '').trim()}_${r.Operation}`] = { quantiteCumul: r.quantiteCumul || 0, joursCumul: r.joursCumul || 0 }; }
          const byFerme = {};
          for (const r of result.recordset) {
            const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale);
            if (fermeParam && ferme !== fermeParam) continue;
            if (!byFerme[ferme]) byFerme[ferme] = [];
            const parcelle = (r.Parcelle_Culturale || '').trim();
            const cumul = cumulMap[`${parcelle}_${r.Operation}`] || { quantiteCumul: 0 };
            byFerme[ferme].push({ parcelle, variete: r.Variete || parcelle, tache: r.Operation, nbOuvriers: r.nbOuvriers, realiseAujourdhui: Math.round(r.quantiteRealisee || 0), dejaRealise: Math.round(cumul.quantiteCumul), totalRealise: Math.round(cumul.quantiteCumul + (r.quantiteRealisee || 0)), heures: r.totalHr, cout: Math.round(r.totalCout || 0), ferme });
          }
          return { success: true, date: dateForCheck, tunnels: byFerme };
        });
        return res.json(cached);
      }

      // ------ RECOLTE-EQUIPES: harvest per worker per day for team tracking ------
      if (action === "recolte-equipes") {
        // shouldCache : refuse le cache si la majorité des dates n'ont aucun kg>0.
        // some() était trop laxiste : 5 dates anciennes OK + 25 dates récentes à kg=0 passait → cache servi 5 min avec chart vide.
        // Heuristique : >= 70% des dates doivent avoir au moins une ligne kg>0.
        const shouldCacheRecolteEquipes = (r) => {
          if (!r || !r.success || !Array.isArray(r.rows) || r.rows.length === 0) return true;
          const byDate = {};
          r.rows.forEach(row => {
            const d = row.jour;
            if (!byDate[d]) byDate[d] = { total: 0, withKg: 0 };
            byDate[d].total++;
            if ((row.kg || 0) > 0) byDate[d].withKg++;
          });
          const dates = Object.keys(byDate);
          if (dates.length === 0) return true;
          const goodDates = dates.filter(d => byDate[d].withKg > 0).length;
          return (goodDates / dates.length) >= 0.7;
        };
        const cached = await withCache("pointage_recolte_equipes", 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          // Load les 4 quinzaines disponibles (~60 jours = nav historique ~45 jours pour le chart).
          // Le mirror n'expose pas plus que ça ; pas la peine de slicer plus large (= fetch perf).
          const targetPeriodes = periodes.slice(0, 4);
          const allRows = [];
          for (const p of targetPeriodes) {
            const pRows = await getPointageRowsForPeriode(p);
            allRows.push(...pRows);
          }
          const recolteRows = allRows.filter(r => r.Operation_Famille === "8. Récolte");
          const rawRows = recolteRows.map(r => ({
            matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
            jour: r.DateStr, periode: r.Periode_paie,
            kg: quantiteToKg(r.Quantite_unite, r.Operation),
            heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0),
            ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
            variete: resolveMyrtilleVariete((r.Variete || "").trim(), r.Parcelle_Culturale),
            culture: (r.Culture || "").trim(),
            parcelle: (r.Parcelle_Culturale || "").trim(), operation: (r.Operation || "").trim(),
          }));
          // Agréger par ouvrier+jour (un ouvrier peut avoir plusieurs variétés/parcelles le même jour)
          const grouped = {};
          for (const r of rawRows) {
            const key = `${r.matricule}|${r.jour}`;
            if (!grouped[key]) {
              grouped[key] = { ...r, kgByVariete: { [r.variete]: r.kg } };
            } else {
              grouped[key].kg += r.kg;
              grouped[key].heures += r.heures;
              grouped[key].cout += r.cout;
              const v = r.variete || 'Autre';
              grouped[key].kgByVariete[v] = (grouped[key].kgByVariete[v] || 0) + r.kg;
            }
          }
          // Déterminer variété dominante pour chaque jour
          let rows = Object.values(grouped).map(r => {
            const bestVariete = Object.entries(r.kgByVariete)
              .sort((a, b) => b[1] - a[1])[0]?.[0] || r.variete;
            delete r.kgByVariete;
            return { ...r, variete: bestVariete, kg: Math.round(r.kg * 10) / 10 };
          });

          // Enrich with production data (Tracabilite_recolte) — more accurate kg
          // Per-date try/catch : un date corrompu ne doit pas invalider les 16 autres.
          const prodDates = [...new Set(rows.map(r => r.jour))].sort();
          let enrichedCount = 0, addedCount = 0;
          const perDateStats = [];
          for (const date of prodDates) {
            try {
              const prodDoc = await db_firestore.collection("prod_tracabilite_recolte").doc(date).get();
              if (!prodDoc.exists) { perDateStats.push(`${date}:noDoc`); continue; }
              const prodRows = prodDoc.data().rows || [];
              if (prodRows.length === 0) { perDateStats.push(`${date}:emptyRows`); continue; }
              const prodMap = {};
              prodRows.forEach(r => { prodMap[(r.matricule || "").toUpperCase()] = r; });
              // Override kg for existing worker-days
              let perDateEnriched = 0;
              rows.forEach(r => {
                if (r.jour !== date) return;
                const prod = prodMap[(r.matricule || "").toUpperCase()];
                if (prod) {
                  r.kg = prod.totalKg;
                  r.variete = prod.variete || r.variete;
                  enrichedCount++;
                  perDateEnriched++;
                }
              });
              // Add workers in prod but missing from pointage for this date
              const existingMats = new Set(rows.filter(r => r.jour === date).map(r => (r.matricule || "").toUpperCase()));
              const periode = rows.find(r => r.jour === date)?.periode || (targetPeriodes && targetPeriodes[0]) || "";
              let perDateAdded = 0;
              prodRows.forEach(pr => {
                if (!existingMats.has((pr.matricule || "").toUpperCase()) && pr.totalKg > 0) {
                  rows.push({
                    matricule: pr.matricule, nom: pr.nom, jour: date, periode,
                    kg: pr.totalKg, heures: 0, cout: 0,
                    ferme: deriveFerme(pr.refParcelle, ""), variete: pr.variete || "",
                    culture: "", parcelle: pr.refParcelle || "", operation: "Récolte (prod)",
                  });
                  addedCount++;
                  perDateAdded++;
                }
              });
              perDateStats.push(`${date}:e${perDateEnriched}/a${perDateAdded}/prodRows${prodRows.length}`);
            } catch (dateErr) {
              perDateStats.push(`${date}:ERR(${dateErr.message})`);
              console.warn(`[recolte-equipes] enrichment failed for ${date}:`, dateErr.message);
            }
          }
          console.log(`[recolte-equipes] Prod enrichment: ${enrichedCount} overridden, ${addedCount} added, ${prodDates.length} dates checked. Per-date: ${perDateStats.join(' | ')}`);

          return { success: true, periodes, rows };
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, CONVERT(date, Periode_Date) AS jour, Periode_paie, Quantite_unite, Nombre_Hr, Cout, Ref_parcelle, Parcelle_Culturale, Variete, Culture, Operation FROM BR_Pointage WHERE Operation_Famille = N'8. Récolte' ORDER BY jour DESC`);
        const sqlRawRows = result.recordset.map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: new Date(r.jour).toISOString().slice(0, 10), periode: r.Periode_paie, kg: quantiteToKg(r.Quantite_unite, r.Operation), heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: resolveMyrtilleVariete((r.Variete || "").trim(), r.Parcelle_Culturale), culture: (r.Culture || "").trim(), parcelle: (r.Parcelle_Culturale || "").trim(), operation: (r.Operation || "").trim() }));
        // Agréger par ouvrier+jour
        const sqlGrouped = {};
        for (const r of sqlRawRows) {
          const key = `${r.matricule}|${r.jour}`;
          if (!sqlGrouped[key]) {
            sqlGrouped[key] = { ...r, kgByVariete: { [r.variete]: r.kg } };
          } else {
            sqlGrouped[key].kg += r.kg;
            sqlGrouped[key].heures += r.heures;
            sqlGrouped[key].cout += r.cout;
            const v = r.variete || 'Autre';
            sqlGrouped[key].kgByVariete[v] = (sqlGrouped[key].kgByVariete[v] || 0) + r.kg;
          }
        }
        const rows = Object.values(sqlGrouped).map(r => {
          const bestVariete = Object.entries(r.kgByVariete)
            .sort((a, b) => b[1] - a[1])[0]?.[0] || r.variete;
          delete r.kgByVariete;
          return { ...r, variete: bestVariete, kg: Math.round(r.kg * 10) / 10 };
        });
        return { success: true, periodes, rows };
        }, shouldCacheRecolteEquipes); // end withCache
        return res.json(cached);
      }

      // ------ TRANSPORT: all workers per day for transport cost calculation ------
      if (action === "transport") {
        const cached = await withCache("pointage_transport", 0, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          // Only load current + previous periode (not ALL dates)
          const targetPeriodes = periodes.slice(0, 2);
          const allRows = [];
          for (const p of targetPeriodes) {
            const pRows = await getPointageRowsForPeriode(p);
            allRows.push(...pRows);
          }
          // Group by matricule+day+periode+operationFamille
          const groups = {};
          for (const r of allRows) {
            const key = `${r.Personnel_Matricule}|${r.DateStr}|${r.Periode_paie}|${r.Operation_Famille}|${r.Operation}`;
            if (!groups[key]) groups[key] = { Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: r.DateStr, Periode_paie: r.Periode_paie, Operation_Famille: r.Operation_Famille, Operation: r.Operation, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale };
          }
          const rows = Object.values(groups).map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: r.DateStr, periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), operation: (r.Operation || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) }));
          const extras = computeChargCond(allRows);
          return { success: true, periodes, rows, ...extras };
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const result = await db.request().query(`SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, CONVERT(date, Periode_Date) AS jour, Periode_paie, Operation_Famille, Operation, MIN(Ref_parcelle) AS Ref_parcelle, MIN(Parcelle_Culturale) AS Parcelle_Culturale FROM BR_Pointage GROUP BY Personnel_Matricule, CONVERT(date, Periode_Date), Periode_paie, Operation_Famille, Operation ORDER BY jour DESC`);
        const rows = result.recordset.map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: new Date(r.jour).toISOString().slice(0, 10), periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), operation: (r.Operation || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) }));
        return { success: true, periodes, rows };
        }); // end withCache
        return res.json(cached);
      }

      // ------ HEURES-SUP: durée travaillée + dépassement 8h30 par quinzaine ------
      if (action === "heures-sup") {
        const cached = await withCache("pointage_heures_sup", 0, async () => {
          const metaHS = await getPointageMeta();
          const excludedFonctions = await getExcludedFonctionsHS();
          return await buildHeuresSup(metaHS, excludedFonctions);
        });
        return res.json(cached);
      }

      // ------ DATES: available dates ------
      if (action === "dates") {
        if (USE_MIRROR) {
          const availDates = await getAvailableDates(30);
          // For each date, we need nbOuv — read from mirror docs
          const dates = [];
          for (let i = 0; i < availDates.length; i += 10) {
            const batch = availDates.slice(i, i + 10);
            const results = await Promise.all(batch.map(async d => {
              const rows = await getPointageRowsForDate(d);
              const workers = new Set(rows.map(r => r.Personnel_Matricule));
              return { date: d, nbOuv: workers.size };
            }));
            dates.push(...results);
          }
          return res.json({ success: true, dates });
        }
        const result = await db.request().query(`SELECT DISTINCT TOP 30 CONVERT(date, Periode_Date) AS jour, COUNT(DISTINCT Personnel_Matricule) AS nbOuv FROM BR_Pointage GROUP BY CONVERT(date, Periode_Date) ORDER BY jour DESC`);
        const dates = result.recordset.map(r => ({ date: new Date(r.jour).toISOString().slice(0, 10), nbOuv: r.nbOuv }));
        return res.json({ success: true, dates });
      }

      // ------ NOUVEAUX OUVRIERS: new workers detected in current quinzaine ------
      if (action === "nouveaux-ouvriers") {
        const cached = await withCache("pointage_nouveaux_ouvriers", 5 * 60 * 1000, async () => {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const currentPeriode = meta?.periodes?.[0];
          if (!currentPeriode) return { success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] };
          const periodeDates = meta?.periodeMap?.[currentPeriode] || [];
          const qStart = periodeDates[0] || null;
          const qEnd = periodeDates[periodeDates.length - 1] || null;
          // Load only current + previous periode to find first appearances (not ALL dates)
          const targetPeriodes = (meta?.periodes || []).slice(0, 2);
          const firstAppearance = {}; // matricule → first date
          for (const p of targetPeriodes.reverse()) { // oldest first
            const pRows = await getPointageRowsForPeriode(p);
            for (const r of pRows) {
              const mat = (r.Personnel_Matricule || "").trim();
              if (!firstAppearance[mat]) firstAppearance[mat] = { date: r.DateStr, nom: (r.Personnel_Nom || "").trim(), Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Operation_Famille: r.Operation_Famille };
            }
          }
          // Filter workers whose first appearance >= qStart
          const today = new Date().toISOString().slice(0, 10);
          const byFarm = {}; const byDayMap = {};
          const workers = Object.entries(firstAppearance)
            .filter(([_, info]) => qStart && info.date >= qStart)
            .map(([mat, info]) => {
              const ferme = deriveFerme(info.Ref_parcelle, info.Parcelle_Culturale);
              byFarm[ferme] = (byFarm[ferme] || 0) + 1;
              byDayMap[info.date] = (byDayMap[info.date] || 0) + 1;
              return { matricule: mat, nom: info.nom, firstDate: info.date, ferme, equipe: mat.substring(0, 2), operationFamille: info.Operation_Famille || "" };
            })
            .sort((a, b) => b.firstDate.localeCompare(a.firstDate) || a.nom.localeCompare(b.nom));
          const totalToday = workers.filter(w => w.firstDate === today).length;
          const byDay = Object.entries(byDayMap).map(([jour, count]) => ({ jour, count })).sort((a, b) => b.jour.localeCompare(a.jour));
          return { success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers };
        }
        // SQL fallback
        const periodeRes = await db.request().query(`SELECT TOP 1 Periode_paie FROM BR_Pointage ORDER BY Periode_Date DESC`);
        const currentPeriode = (periodeRes.recordset[0] || {}).Periode_paie;
        if (!currentPeriode) return { success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] };
        const result = await db.request().query(`WITH QuinzaineBounds AS (SELECT MIN(CONVERT(date, Periode_Date)) AS q_start, MAX(CONVERT(date, Periode_Date)) AS q_end FROM BR_Pointage WHERE Periode_paie = N'${currentPeriode.replace(/'/g, "''")}'), WorkerFirst AS (SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, MIN(CONVERT(date, Periode_Date)) AS first_date FROM BR_Pointage GROUP BY Personnel_Matricule HAVING MIN(CONVERT(date, Periode_Date)) >= (SELECT q_start FROM QuinzaineBounds)), WorkerFirstDetail AS (SELECT w.Personnel_Matricule, w.Personnel_Nom, w.first_date, p.Ref_parcelle, p.Parcelle_Culturale, p.Operation_Famille FROM WorkerFirst w OUTER APPLY (SELECT TOP 1 Ref_parcelle, Parcelle_Culturale, Operation_Famille FROM BR_Pointage WHERE Personnel_Matricule = w.Personnel_Matricule AND CONVERT(date, Periode_Date) = w.first_date) p) SELECT *, (SELECT q_start FROM QuinzaineBounds) AS q_start, (SELECT q_end FROM QuinzaineBounds) AS q_end FROM WorkerFirstDetail ORDER BY first_date DESC, Personnel_Nom`);
        const rows = result.recordset;
        const today = new Date().toISOString().slice(0, 10);
        const qStart = rows.length > 0 ? new Date(rows[0].q_start).toISOString().slice(0, 10) : null;
        const qEnd = rows.length > 0 ? new Date(rows[0].q_end).toISOString().slice(0, 10) : null;
        const byFarm = {}; const byDayMap = {};
        const workers = rows.map(r => { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); const fd = new Date(r.first_date).toISOString().slice(0, 10); byFarm[ferme] = (byFarm[ferme] || 0) + 1; byDayMap[fd] = (byDayMap[fd] || 0) + 1; return { matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), firstDate: fd, ferme, equipe: (r.Personnel_Matricule || "").trim().substring(0, 2), operationFamille: r.Operation_Famille || "" }; });
        const totalToday = workers.filter(w => w.firstDate === today).length;
        const byDay = Object.entries(byDayMap).map(([jour, count]) => ({ jour, count })).sort((a, b) => b.jour.localeCompare(a.jour));
        return { success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers };
        }); // end withCache
        return res.json(cached);
      }

      // ------ WORKER-DETAIL: full BEE ONE info for a worker ------
      if (action === "worker-detail") {
        const matricule = req.query.matricule;
        if (!matricule) return res.status(400).json({ success: false, error: "matricule required" });

        let rows;
        if (USE_MIRROR) {
          const mirrorRows = await getWorkerHistory(matricule);
          rows = mirrorRows.sort((a, b) => (b.DateStr || "").localeCompare(a.DateStr || ""));
          // Map to expected shape
          rows = rows.map(r => ({ Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, Operation_Famille: r.Operation_Famille, Operation: r.Operation, Operation_Groupe: r.Operation_Groupe, Nombre_Jr: r.Nombre_Jr, Nombre_Hr: r.Nombre_Hr, Quantite_unite: r.Quantite_unite, Cout: r.Cout, Parcelle_Culturale: r.Parcelle_Culturale, Ref_parcelle: r.Ref_parcelle, Variete: r.Variete, Culture: r.Culture, Periode_paie: r.Periode_paie, jour: r.DateStr, HS_25: r.HS_25, HS_50: r.HS_50, HS_100: r.HS_100 }));
        } else {
          const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe, Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle, Variete, Culture, Periode_paie, CONVERT(date, Periode_Date) AS jour, HS_25, HS_50, HS_100, HS_NM FROM BR_Pointage WHERE Personnel_Matricule = N'${(matricule || '').replace(/'/g, "''")}' ORDER BY Periode_Date DESC`);
          rows = result.recordset;
        }

        if (rows.length === 0) return res.json({ success: true, worker: null });
        const first = rows[rows.length - 1]; const last = rows[0];
        const totalJours = rows.reduce((s, r) => s + (r.Nombre_Jr || 0), 0);
        const totalHeures = rows.reduce((s, r) => s + (r.Nombre_Hr || 0), 0);
        const totalCout = rows.reduce((s, r) => s + (r.Cout || 0), 0);
        const totalQte = rows.reduce((s, r) => s + (r.Quantite_unite || 0), 0);
        const periodes = [...new Set(rows.map(r => r.Periode_paie))];
        const operations = [...new Set(rows.map(r => r.Operation_Famille).filter(Boolean))];
        const parcelles = [...new Set(rows.map(r => r.Ref_parcelle).filter(Boolean))];
        const jourStr = r => typeof r.jour === 'string' ? r.jour.slice(0, 10) : new Date(r.jour).toISOString().slice(0, 10);
        const jours = [...new Set(rows.map(r => jourStr(r)))].sort();
        return res.json({ success: true, worker: {
          matricule: (first.Personnel_Matricule || '').trim(), nom: (first.Personnel_Nom || '').trim(),
          premierJour: jourStr(first), dernierJour: jourStr(last),
          ferme: deriveFerme(first.Ref_parcelle, first.Parcelle_Culturale),
          equipe: (first.Personnel_Matricule || '').trim().substring(0, 2),
          totalJours: Math.round(totalJours * 10) / 10, totalHeures: Math.round(totalHeures * 10) / 10,
          totalCout: Math.round(totalCout), totalQuantite: Math.round(totalQte * 10) / 10,
          nbPeriodes: periodes.length, periodes, operations, parcelles, nbJoursDistincts: jours.length,
          historique: rows.slice(0, 30).map(r => ({ jour: jourStr(r), periode: r.Periode_paie, operation: r.Operation_Famille, operationDetail: r.Operation, parcelle: r.Ref_parcelle, culture: r.Culture, variete: r.Variete, heures: r.Nombre_Hr, jours: r.Nombre_Jr, quantite: r.Quantite_unite, cout: r.Cout })),
        }});
      }

      // ------ QUINZAINE-REPOS: average rest days per team per quinzaine ------
      if (action === "quinzaine-repos") {
        const periodeParamR = req.query.periode;
        const cacheKeyR = `pointage_quinzaine_repos_${periodeParamR || "latest"}`;
        const cachedR = await withCache(cacheKeyR, 5 * 60 * 1000, async () => {
        let periodes, selectedPeriode, quinzaineDates, rawRows;
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          periodes = meta?.periodes || [];
          selectedPeriode = periodeParamR || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 };
          quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
          rawRows = await getPointageRowsForPeriode(selectedPeriode);
          // If mirror has no data, check archive
          if (rawRows.length === 0 && quinzaineDates.length === 0) {
            const archiveDoc = await db_firestore.collection("quinzaine_archive").doc(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().reposData) {
              const rd = archiveDoc.data().reposData;
              quinzaineDates = rd.quinzaineDates;
              rawRows = [];
              for (const w of rd.workers) {
                for (const d of w.joursPresent) {
                  rawRows.push({ Personnel_Matricule: w.matricule, Personnel_Nom: w.nom, DateStr: d });
                }
              }
            }
          }
        } else {
          const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
          periodes = periodesRes.recordset.map(r => r.Periode_paie);
          selectedPeriode = periodeParamR || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 };
          const datesRes = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' ORDER BY jour`);
          quinzaineDates = datesRes.recordset.map(r => new Date(r.jour).toISOString().slice(0, 10));
          const workersRes = await db.request().query(`SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' GROUP BY Personnel_Matricule, CONVERT(date, Periode_Date) ORDER BY Personnel_Matricule`);
          rawRows = workersRes.recordset.map(r => ({ Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: new Date(r.jour).toISOString().slice(0, 10) }));
        }
        const nbJoursQuinzaine = quinzaineDates.length;
        const equipeMap = {};
        for (const row of rawRows) {
          const mat = (row.Personnel_Matricule || '').trim();
          const prefix = mat.substring(0, 2).toUpperCase();
          const jour = row.DateStr || new Date(row.jour).toISOString().slice(0, 10);
          if (!equipeMap[prefix]) equipeMap[prefix] = {};
          if (!equipeMap[prefix][mat]) equipeMap[prefix][mat] = { matricule: mat, nom: (row.Personnel_Nom || '').trim(), joursPresent: new Set() };
          equipeMap[prefix][mat].joursPresent.add(jour);
        }
        const equipes = Object.entries(equipeMap).map(([prefix, workers]) => {
          const workerList = Object.values(workers).map(w => { const nbPresent = w.joursPresent.size; const nbRepos = nbJoursQuinzaine - nbPresent; return { matricule: w.matricule, nom: w.nom, nbPresent, nbRepos, nbJoursQuinzaine }; });
          const totalRepos = workerList.reduce((s, w) => s + w.nbRepos, 0);
          const moyRepos = workerList.length > 0 ? Math.round((totalRepos / workerList.length) * 10) / 10 : 0;
          return { prefix, nbOuvriers: workerList.length, moyRepos, nbJoursQuinzaine, workers: workerList.sort((a, b) => b.nbRepos - a.nbRepos) };
        }).sort((a, b) => a.prefix.localeCompare(b.prefix));
        return { success: true, periode: selectedPeriode, periodes, nbJoursQuinzaine, quinzaineDates, equipes };
        }); // end withCache
        return res.json(cachedR);
      }

      // ------ QUINZAINE-ALERTES: teams absent 5+ consecutive days ------
      if (action === "quinzaine-alertes") {
        const periodeParamA = req.query.periode;
        const cacheKeyA = `pointage_quinzaine_alertes_${periodeParamA || "latest"}`;
        const cachedA = await withCache(cacheKeyA, 5 * 60 * 1000, async () => {
        let periodes, selectedPeriode, quinzaineDates, presenceMap;
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          periodes = meta?.periodes || [];
          selectedPeriode = periodeParamA || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, alertes: [] };
          quinzaineDates = (meta?.periodeMap?.[selectedPeriode] || []).sort();
          const rawRows = await getPointageRowsForPeriode(selectedPeriode);
          if (rawRows.length > 0) {
            presenceMap = {};
            for (const r of rawRows) {
              const prefix = (r.Personnel_Matricule || '').trim().substring(0, 2).toUpperCase();
              if (!presenceMap[prefix]) presenceMap[prefix] = new Set();
              presenceMap[prefix].add(r.DateStr);
            }
          } else {
            // Check Firestore archive
            const archiveDoc = await db_firestore.collection("quinzaine_archive").doc(selectedPeriode).get();
            if (archiveDoc.exists && archiveDoc.data().alertesData) {
              const ad = archiveDoc.data().alertesData;
              quinzaineDates = ad.quinzaineDates;
              presenceMap = {};
              for (const [prefix, days] of Object.entries(ad.presenceByPrefix)) {
                presenceMap[prefix] = new Set(days);
              }
            } else {
              presenceMap = {};
            }
          }
        } else {
          const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
          periodes = periodesRes.recordset.map(r => r.Periode_paie);
          selectedPeriode = periodeParamA || periodes[0];
          if (!selectedPeriode) return { success: true, periode: null, alertes: [] };
          const datesRes = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' ORDER BY jour`);
          quinzaineDates = datesRes.recordset.map(r => new Date(r.jour).toISOString().slice(0, 10)).sort();
          const presenceRes = await db.request().query(`SELECT SUBSTRING(LTRIM(Personnel_Matricule), 1, 2) AS equipe_prefix, CONVERT(date, Periode_Date) AS jour, COUNT(DISTINCT Personnel_Matricule) AS nbOuv FROM BR_Pointage WHERE Periode_paie = N'${(selectedPeriode || '').replace(/'/g, "''")}' GROUP BY SUBSTRING(LTRIM(Personnel_Matricule), 1, 2), CONVERT(date, Periode_Date)`);
          presenceMap = {};
          for (const row of presenceRes.recordset) { const prefix = (row.equipe_prefix || '').toUpperCase(); if (!presenceMap[prefix]) presenceMap[prefix] = new Set(); presenceMap[prefix].add(new Date(row.jour).toISOString().slice(0, 10)); }
        }
        // Find consecutive absent streaks >= 5 days
        const alertes = [];
        Object.entries(presenceMap).forEach(([prefix, presentDays]) => {
          let streak = 0, streakStart = null;
          for (let i = 0; i < quinzaineDates.length; i++) {
            const d = quinzaineDates[i];
            if (!presentDays.has(d)) { if (streak === 0) streakStart = d; streak++; }
            else { if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[i - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[i - 1]})` }); streak = 0; streakStart = null; }
          }
          if (streak >= 5) alertes.push({ equipePrefix: prefix, joursAbsents: streak, dateDebut: streakStart, dateFin: quinzaineDates[quinzaineDates.length - 1], message: `Équipe ${prefix} absente depuis plus de 5 jours (${streak} jours consécutifs du ${streakStart} au ${quinzaineDates[quinzaineDates.length - 1]})` });
        });
        alertes.sort((a, b) => b.joursAbsents - a.joursAbsents);
        return { success: true, periode: selectedPeriode, periodes, quinzaineDates, alertes };
        }); // end withCache
        return res.json(cachedA);
      }

      // ------ MO-ANALYTIQUE-VARIETE: labor cost breakdown by variety across all quinzaines ------
      if (action === "mo-analytique-variete") {
        const cached = await withCache("mo_analytique_variete", 30 * 60 * 1000, async () => {
          const meta = await getPointageMeta();
          const allPeriodes = meta?.allPeriodes || [];
          const mirrorPeriodes = meta?.periodes || [];

          // Accumulate analytique rows from all quinzaines (parallel reads)
          const allRows = [];

          // Split: mirror vs archived
          const mirrorPeriodesList = allPeriodes.filter(p => mirrorPeriodes.includes(p) && meta?.periodeMap?.[p]);
          const archivedPeriodesList = allPeriodes.filter(p => !mirrorPeriodes.includes(p) || !meta?.periodeMap?.[p]);

          // Read all archives in parallel
          const [mirrorResults, archiveDocs] = await Promise.all([
            Promise.all(mirrorPeriodesList.map(async (periode) => {
              const rawRows = await getPointageRowsForPeriode(periode);
              const groups = {};
              for (const r of rawRows) {
                const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}`;
                if (!groups[key]) groups[key] = { parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), operationFamille: r.Operation_Famille, jh: 0, cout: 0 };
                groups[key].jh += r.Nombre_Jr || 0;
                groups[key].cout += r.Cout || 0;
              }
              return { periode, groups: Object.values(groups) };
            })),
            Promise.all(archivedPeriodesList.map(async (periode) => {
              const doc = await db_firestore.collection("quinzaine_archive").doc(periode).get();
              return { periode, data: doc.exists ? doc.data().analytique : null };
            })),
          ]);

          for (const { periode, groups } of mirrorResults) {
            for (const g of groups) {
              allRows.push({ parcelle: g.parcelle, refParcelle: g.refParcelle, operationFamille: g.operationFamille, jh: g.jh, cout: g.cout, periode });
            }
          }
          for (const { periode, data } of archiveDocs) {
            if (data) {
              for (const row of data) {
                allRows.push({ parcelle: row.parcelle, refParcelle: row.refParcelle, operationFamille: row.operationFamille, jh: row.jh, cout: row.cout, periode });
              }
            }
          }

          // Aggregate by variete
          const byVariete = {};
          const byQuinzaine = {};
          for (const row of allRows) {
            const resolved = resolveVariete(row.parcelle, row.refParcelle);
            const key = `${resolved.variete}|${resolved.ferme}`;
            const type = classifyType(row.operationFamille);

            if (!byVariete[key]) {
              byVariete[key] = {
                variete: resolved.variete, culture: resolved.culture, ferme: resolved.ferme,
                recolte: { jh: 0, cout: 0 }, horsRecolte: { jh: 0, cout: 0 }, postesFixes: { jh: 0, cout: 0 },
                total: { jh: 0, cout: 0 }, horsRecolteDetail: {},
              };
            }
            byVariete[key][type].jh += row.jh || 0;
            byVariete[key][type].cout += row.cout || 0;
            byVariete[key].total.jh += row.jh || 0;
            byVariete[key].total.cout += row.cout || 0;

            // Accumulate horsRecolte breakdown by operation family
            if (type === 'horsRecolte') {
              const opFam = row.operationFamille || 'Autre';
              if (!byVariete[key].horsRecolteDetail[opFam]) byVariete[key].horsRecolteDetail[opFam] = { jh: 0, cout: 0 };
              byVariete[key].horsRecolteDetail[opFam].jh += row.jh || 0;
              byVariete[key].horsRecolteDetail[opFam].cout += row.cout || 0;
            }

            // Par quinzaine
            if (!byQuinzaine[row.periode]) byQuinzaine[row.periode] = {};
            if (!byQuinzaine[row.periode][resolved.variete]) byQuinzaine[row.periode][resolved.variete] = 0;
            byQuinzaine[row.periode][resolved.variete] += row.cout || 0;
          }

          const parVariete = Object.values(byVariete)
            .map(v => {
              const hrDetail = {};
              for (const [op, val] of Object.entries(v.horsRecolteDetail || {})) {
                hrDetail[op] = { jh: Math.round(val.jh * 100) / 100, cout: Math.round(val.cout) };
              }
              return { ...v, recolte: { jh: Math.round(v.recolte.jh * 100) / 100, cout: Math.round(v.recolte.cout) }, horsRecolte: { jh: Math.round(v.horsRecolte.jh * 100) / 100, cout: Math.round(v.horsRecolte.cout) }, postesFixes: { jh: Math.round(v.postesFixes.jh * 100) / 100, cout: Math.round(v.postesFixes.cout) }, total: { jh: Math.round(v.total.jh * 100) / 100, cout: Math.round(v.total.cout) }, horsRecolteDetail: hrDetail };
            })
            .sort((a, b) => b.total.cout - a.total.cout);

          const totaux = parVariete.reduce((acc, v) => ({
            recolte: acc.recolte + v.recolte.cout, horsRecolte: acc.horsRecolte + v.horsRecolte.cout,
            postesFixes: acc.postesFixes + v.postesFixes.cout, total: acc.total + v.total.cout,
          }), { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0 });

          const parQuinzaine = allPeriodes.slice().reverse().map(p => ({
            periode: p, parVariete: byQuinzaine[p] || {},
          }));

          return { success: true, parVariete, parQuinzaine, totaux, periodes: allPeriodes };
        });
        return res.json(cached);
      }

      // ------ CAMPAGNE-MO-VARIETE: cumulative labor cost by variety for current fiscal year (Jul→Jun) ------
      if (action === "campagne-mo-variete") {
        const today = new Date();
        const y = today.getFullYear();
        const startYear = today.getMonth() >= 6 ? y : y - 1;
        const campagne = {
          start: `${startYear}-07-01`,
          end: `${startYear + 1}-06-30`,
          label: `${startYear}-${startYear + 1} (Jul-Jun)`,
        };

        const cycle1End = `${startYear}-12-31`;
        const cycle2Start = `${startYear + 1}-01-01`;

        const cached = await withCache(`campagne_mo_variete_v4_${campagne.start}`, 30 * 60 * 1000, async () => {
          const meta = await getPointageMeta();
          const allPeriodes = meta?.allPeriodes || [];
          const mirrorPeriodes = meta?.periodes || [];

          const mirrorPeriodesList = allPeriodes.filter(p => mirrorPeriodes.includes(p) && meta?.periodeMap?.[p]);
          const archivedPeriodesList = allPeriodes.filter(p => !mirrorPeriodes.includes(p) || !meta?.periodeMap?.[p]);

          // segments: each row tagged with cycle1Weight / cycle2Weight / annuelWeight
          // mirror rows: weight = 1 for the cycle the date belongs to, 0 for the other; 1 for annuel
          // archive rows: prorated by fraction of dates in each cycle within campagne range
          const taggedRows = []; // { parcelle, refParcelle, operationFamille, jh, cout, w1, w2, wA }

          // 1. Mirror periodes
          const mirrorResults = await Promise.all(mirrorPeriodesList.map(async (periode) => {
            const dates = (meta.periodeMap[periode] || []).filter(d => d >= campagne.start && d <= campagne.end);
            const out = [];
            for (let i = 0; i < dates.length; i += 10) {
              const batch = dates.slice(i, i + 10);
              const batchResults = await Promise.all(batch.map(d => getPointageRowsForDate(d).then(rows => ({ d, rows }))));
              for (const { d, rows: rawRows } of batchResults) {
                const inCycle1 = d <= cycle1End ? 1 : 0;
                const inCycle2 = d >= cycle2Start ? 1 : 0;
                // group per-date to reduce row count
                const groups = {};
                for (const r of rawRows) {
                  const key = `${r.Parcelle_Culturale}|${r.Ref_parcelle}|${r.Operation_Famille}`;
                  if (!groups[key]) groups[key] = { parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), operationFamille: r.Operation_Famille, jh: 0, cout: 0 };
                  groups[key].jh += r.Nombre_Jr || 0;
                  groups[key].cout += r.Cout || 0;
                }
                for (const g of Object.values(groups)) {
                  out.push({ ...g, w1: inCycle1, w2: inCycle2, wA: 1 });
                }
              }
            }
            return out;
          }));
          for (const arr of mirrorResults) for (const r of arr) taggedRows.push(r);

          // 2. Archive periodes — prorate per cycle
          const archiveDocs = await Promise.all(archivedPeriodesList.map(async (periode) => {
            const doc = await db_firestore.collection("quinzaine_archive").doc(periode).get();
            if (!doc.exists) return null;
            const d = doc.data();
            const analytique = d.analytique;
            if (!analytique) return null;
            const allDates = (d.reposData && d.reposData.quinzaineDates) || (d.alertesData && d.alertesData.quinzaineDates) || (meta?.periodeMap?.[periode]) || [];
            const datesInCampagne = allDates.filter(dt => dt >= campagne.start && dt <= campagne.end);
            const datesInCycle1 = datesInCampagne.filter(dt => dt <= cycle1End);
            const datesInCycle2 = datesInCampagne.filter(dt => dt >= cycle2Start);
            const total = allDates.length || datesInCampagne.length || 1;
            const fA = datesInCampagne.length / total;
            const f1 = datesInCycle1.length / total;
            const f2 = datesInCycle2.length / total;
            if (fA === 0) return null;
            return { f1, f2, fA, analytique };
          }));
          for (const result of archiveDocs) {
            if (!result) continue;
            for (const row of result.analytique) {
              taggedRows.push({
                parcelle: row.parcelle,
                refParcelle: row.refParcelle,
                operationFamille: row.operationFamille,
                jh: row.jh || 0,
                cout: row.cout || 0,
                w1: result.f1,
                w2: result.f2,
                wA: result.fA,
              });
            }
          }

          // 3. Aggregate per segment per variete
          function emptyBucket(resolved) {
            return {
              variete: resolved.variete, culture: resolved.culture, ferme: resolved.ferme,
              recolte: { jh: 0, cout: 0 }, horsRecolte: { jh: 0, cout: 0 }, postesFixes: { jh: 0, cout: 0 },
              total: { jh: 0, cout: 0 }, kgRecolte: 0,
            };
          }
          const seg = { cycle1: {}, cycle2: {}, annuel: {} };
          for (const row of taggedRows) {
            const resolved = resolveVariete(row.parcelle, row.refParcelle);
            const key = `${resolved.variete}|${resolved.ferme}`;
            const type = classifyType(row.operationFamille);
            for (const [segName, w] of [['cycle1', row.w1], ['cycle2', row.w2], ['annuel', row.wA]]) {
              if (!w) continue;
              if (!seg[segName][key]) seg[segName][key] = emptyBucket(resolved);
              const b = seg[segName][key];
              const jhW = row.jh * w;
              const coutW = row.cout * w;
              b[type].jh += jhW;
              b[type].cout += coutW;
              b.total.jh += jhW;
              b.total.cout += coutW;
            }
          }

          // 4. Kg récolté par variété (from prod_tracabilite_recolte) per segment
          //    Doc IDs are YYYY-MM-DD. Query the campagne range.
          const prodSnap = await db_firestore.collection("prod_tracabilite_recolte")
            .where(admin.firestore.FieldPath.documentId(), ">=", campagne.start)
            .where(admin.firestore.FieldPath.documentId(), "<=", campagne.end)
            .get();
          for (const docSnap of prodSnap.docs) {
            const dateStr = docSnap.id;
            const inCycle1 = dateStr <= cycle1End;
            const inCycle2 = dateStr >= cycle2Start;
            const rows = docSnap.data().rows || [];
            for (const r of rows) {
              const resolved = resolveVariete(r.variete || r.parcelle || '', r.refParcelle || '');
              const key = `${resolved.variete}|${resolved.ferme}`;
              const kg = r.totalKg || 0;
              if (!seg.annuel[key]) seg.annuel[key] = emptyBucket(resolved);
              seg.annuel[key].kgRecolte += kg;
              if (inCycle1) {
                if (!seg.cycle1[key]) seg.cycle1[key] = emptyBucket(resolved);
                seg.cycle1[key].kgRecolte += kg;
              }
              if (inCycle2) {
                if (!seg.cycle2[key]) seg.cycle2[key] = emptyBucket(resolved);
                seg.cycle2[key].kgRecolte += kg;
              }
            }
          }

          function finalizeSegment(byVariete) {
            const parVariete = Object.values(byVariete).map(v => ({
              ...v,
              recolte: { jh: Math.round(v.recolte.jh * 100) / 100, cout: Math.round(v.recolte.cout) },
              horsRecolte: { jh: Math.round(v.horsRecolte.jh * 100) / 100, cout: Math.round(v.horsRecolte.cout) },
              postesFixes: { jh: Math.round(v.postesFixes.jh * 100) / 100, cout: Math.round(v.postesFixes.cout) },
              total: { jh: Math.round(v.total.jh * 100) / 100, cout: Math.round(v.total.cout) },
              kgRecolte: Math.round(v.kgRecolte),
            })).sort((a, b) => b.total.cout - a.total.cout);
            const totaux = parVariete.reduce((acc, v) => ({
              recolte: acc.recolte + v.recolte.cout, horsRecolte: acc.horsRecolte + v.horsRecolte.cout,
              postesFixes: acc.postesFixes + v.postesFixes.cout, total: acc.total + v.total.cout,
              kgRecolte: acc.kgRecolte + v.kgRecolte,
            }), { recolte: 0, horsRecolte: 0, postesFixes: 0, total: 0, kgRecolte: 0 });
            return { parVariete, totaux };
          }

          const result = {
            success: true,
            campagne,
            cycle1: { ...finalizeSegment(seg.cycle1), start: campagne.start, end: cycle1End, label: `Cycle 1 (Juil ${startYear} → Déc ${startYear})` },
            cycle2: { ...finalizeSegment(seg.cycle2), start: cycle2Start, end: campagne.end, label: `Cycle 2 (Jan ${startYear + 1} → Juin ${startYear + 1})` },
            annuel: { ...finalizeSegment(seg.annuel), start: campagne.start, end: campagne.end, label: `Cumul annuel ${campagne.label}` },
          };
          // Back-compat with v1 shape (parVariete + totaux at root = annuel)
          result.parVariete = result.annuel.parVariete;
          result.totaux = result.annuel.totaux;
          return result;
        });
        return res.json(cached);
      }

      // ------ UPLOAD-TIMES: when was pointage uploaded to SQL per farm ------
      if (action === "upload-times") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        if (USE_MIRROR) {
          const [rows, syncStatus] = await Promise.all([getPointageRowsForDate(dateForCheck), getSyncStatus()]);
          const farmData = { F1: new Set(), F5: new Set(), Avocatier: new Set() };
          for (const r of rows) { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); if (farmData[ferme]) farmData[ferme].add(r.Personnel_Matricule); }
          const uploads = Object.entries(farmData).map(([ferme, workers]) => ({ ferme, nbOuv: workers.size }));
          const lastSync = syncStatus?.lastSuccessAt;
          const lastTableWrite = lastSync ? (lastSync.toDate ? lastSync.toDate().toISOString() : new Date(lastSync).toISOString()) : null;
          return res.json({ success: true, date: dateForCheck, lastTableWrite, uploads });
        }
        const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
        const statsRes = await db.request().query(`SELECT MAX(last_user_update) AS lastWrite FROM sys.dm_db_index_usage_stats WHERE database_id = DB_ID() AND object_id = OBJECT_ID('BR_Pointage')`);
        const lastTableWrite = statsRes.recordset[0]?.lastWrite || null;
        const result = await db.request().query(`SELECT Ref_parcelle, Parcelle_Culturale, COUNT(DISTINCT Personnel_Matricule) AS nbOuv FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} GROUP BY Ref_parcelle, Parcelle_Culturale`);
        const farmData = { F1: { nbOuv: 0 }, F5: { nbOuv: 0 }, Avocatier: { nbOuv: 0 } };
        for (const row of result.recordset) { const ferme = deriveFerme(row.Ref_parcelle, row.Parcelle_Culturale); if (farmData[ferme]) farmData[ferme].nbOuv += row.nbOuv; }
        const uploads = Object.entries(farmData).map(([ferme, d]) => ({ ferme, nbOuv: d.nbOuv }));
        return res.json({ success: true, date: dateForCheck, lastTableWrite: lastTableWrite ? new Date(lastTableWrite).toISOString() : null, uploads });
      }

      // ------ POSTES-FIXES: postes fixes detail for a date ------
      if (action === "postes-fixes") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const submittedFermes = await getSubmittedFermes(dateForCheck);

        let rows;
        if (USE_MIRROR) {
          rows = await fetchPostesFixesFromMirror(dateForCheck);
        } else {
          const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
          const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, Operation, Ref_parcelle, Parcelle_Culturale, Nombre_Jr, Nombre_Hr, Cout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille = N'11. Postes fixes' ORDER BY Ref_parcelle, Operation, Personnel_Nom`);
          rows = result.recordset.map(r => ({ matricule: (r.Personnel_Matricule || '').trim(), nom: (r.Personnel_Nom || '').trim(), operation: r.Operation, parcelle: (r.Parcelle_Culturale || '').trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), jours: r.Nombre_Jr, heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0) }));
        }

        if (Object.keys(submittedFermes).length > 0) {
          const liveRows = rows.filter(r => !submittedFermes[r.ferme]);
          let snapshotRows = [];
          for (const f of Object.keys(submittedFermes)) { const snapData = await getSnapshotData(dateForCheck, f); if (snapData && snapData.postesFixes) snapshotRows = snapshotRows.concat(snapData.postesFixes); }
          rows = [...liveRows, ...snapshotRows];
        }

        return res.json({ success: true, date: dateForCheck, rows, count: rows.length });
      }

      return res.status(400).json({ success: false, error: "Unknown action: " + action });
    } catch (err) {
      console.error("Erreur pointageRH:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});
