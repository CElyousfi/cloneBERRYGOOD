const functions = require("firebase-functions");
const sql = require("mssql");
const cors = require("cors")({ origin: true });
const admin = require("firebase-admin");
const db_firestore = admin.firestore();

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

// =============================================
// SQL Server Config (reuse from env)
// =============================================
const sqlConfig = {
  user: process.env.SQL_USER || "BEEONE",
  password: process.env.SQL_PASSWORD || "BEEONE",
  server: process.env.SQL_SERVER || "105.145.33.128",
  port: parseInt(process.env.SQL_PORT || "1433"),
  database: process.env.SQL_DATABASE || "BR_BERRY_GOOD",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    requestTimeout: 30000,
    connectionTimeout: 15000,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

let pool = null;
async function getPool() {
  if (!pool) pool = await sql.connect(sqlConfig);
  return pool;
}

// =============================================
// Helpers
// =============================================
function deriveFerme(refParcelle, parcelleCulturale) {
  if (!refParcelle) return "Autre";
  const ref = refParcelle.trim();
  if (ref.startsWith("F1") || ref === "0032" || ref === "0035" || ref === "0036") return "F1";
  if (ref.startsWith("F5") || ref === "0037" || ref === "0038" || ref === "0039") return "F5";
  if (ref.startsWith("F2") || ref.startsWith("F3") || ref.startsWith("F4") || ref.startsWith("F6") || ref === "0031" || ref === "0033") return "Avocatier";
  if (parcelleCulturale) {
    if (/F1/i.test(parcelleCulturale)) return "F1";
    if (/F5/i.test(parcelleCulturale)) return "F5";
    if (/avocat/i.test(parcelleCulturale)) return "Avocatier";
  }
  return "Autre";
}

function classifyType(operationFamille) {
  if (!operationFamille) return "horsRecolte";
  if (operationFamille === "8. Récolte") return "recolte";
  if (operationFamille === "11. Postes fixes") return "postesFixes";
  return "horsRecolte";
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
// API: pointageRH
// =============================================
exports.pointageRH = functions.region("europe-west1").https.onRequest((req, res) => {
  cors(req, res, async () => {
    try {
      const action = req.query.action || "summary";
      const dateParam = req.query.date; // YYYY-MM-DD
      const db = USE_MIRROR ? null : await getPool();

      // ------ SUMMARY: effectif today + yesterday + weekly trend + top ops ------
      if (action === "summary") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
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
          return res.json({ success: true, date: dateForCheck, effectif: fermes, pointageJour, weeklyTrend, topOps, recolteTotal: { qty: recolteQty, nbOuv: recolteWorkers.size, cout: Math.round(recolteCout) }, lastSaisie: syncStatus?.lastSuccessAt || null, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null });
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

        return res.json({
          success: true, date: dateParam || new Date().toISOString().slice(0, 10),
          effectif: fermes, pointageJour, weeklyTrend, topOps,
          recolteTotal: { qty: recolteKg.totalQty || 0, nbOuv: recolteKg.nbOuv || 0, cout: Math.round(recolteKg.totalCout || 0) },
          lastSaisie,
        });
      }

      // ------ DETAIL: detailed pointage for a date ------
      if (action === "detail") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
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

        return res.json({ success: true, date: dateForCheck, rows, count: rows.length });
      }

      // ------ RECOLTE: harvest workers for a date ------
      if (action === "recolte") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
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
            if (!cGroups[key]) cGroups[key] = { parcelle: (r.Parcelle_Culturale || "").trim(), variete: r.Variete, totalKg: 0, totalCaisses: 0 };
            cGroups[key].totalKg += r.Poids_total_kg || 0;
            cGroups[key].totalCaisses += r.Nbre_Caisse || 0;
          }
          cueillette = Object.values(cGroups).map(c => ({ ...c, ferme: deriveFerme(null, c.parcelle) })).sort((a, b) => b.totalKg - a.totalKg);
          // Workers from pointage
          workers = pointageRows
            .filter(r => r.Operation_Famille === "8. Récolte")
            .map((r, i) => ({
              rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
              operation: r.Operation, quantite: Math.round(((r.Quantite_unite || 0) * 1.5) * 10) / 10,
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
          workers = pointageRes.recordset.map((r, i) => ({ rank: i + 1, matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), operation: r.Operation, quantite: Math.round(((r.Quantite_unite || 0) * 1.5) * 10) / 10, heures: r.Nombre_Hr, cout: r.Cout, parcelle: (r.Parcelle_Culturale || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: r.Variete }));
        }

        workers.sort((a, b) => b.quantite - a.quantite || a.nom.localeCompare(b.nom));
        workers.forEach((w, i) => { w.rank = i + 1; });
        const totalKgCueillette = cueillette.reduce((s, c) => s + c.totalKg, 0);
        return res.json({ success: true, date: dateForCheck, workers, cueillette, totalKgCueillette, count: workers.length });
      }

      // ------ QUINZAINE: bi-weekly summary ------
      if (action === "quinzaine") {
        const periodeParam = req.query.periode;

        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          const selectedPeriode = periodeParam || periodes[0];
          if (!selectedPeriode) return res.json({ success: true, periode: null, periodes, totalJournees: 0, totalCout: 0, parFerme: [], parJour: [] });
          const rows = await getPointageRowsForPeriode(selectedPeriode);
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
          return res.json({ success: true, periode: selectedPeriode, periodes, totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay });
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
        return res.json({ success: true, periode: periodeParam || "latest", periodes: periodesRes.recordset.map(r => r.Periode_paie), totalJournees: Math.round(totalJournees), totalCout: Math.round(totalCout), parFerme: Object.entries(qFermes).map(([f, d]) => ({ ferme: f, journees: Math.round(d.journees), cout: Math.round(d.cout), recolte: Math.round(d.recolte), horsRecolte: Math.round(d.horsRecolte), postesFixes: Math.round(d.postesFixes) })), parJour: perDay });
      }

      // ------ QUINZAINE-ANALYTIQUE: pivot parcelle x operation ------
      if (action === "quinzaine-analytique") {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          const periodeParam = req.query.periode || periodes[0];
          if (!periodeParam) return res.json({ success: true, periode: null, periodes, rows: [] });
          const rawRows = await getPointageRowsForPeriode(periodeParam);
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
          return res.json({ success: true, periode: periodeParam, periodes, rows });
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const periodeParam = req.query.periode || periodes[0];
        const result = await db.request().query(`SELECT Parcelle_Culturale, Ref_parcelle, Operation_Famille, Operation, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Jr) AS JH, SUM(Cout) AS Cout FROM BR_Pointage WHERE Periode_paie = N'${(periodeParam || '').replace(/'/g, "''")}' GROUP BY Parcelle_Culturale, Ref_parcelle, Operation_Famille, Operation ORDER BY Parcelle_Culturale, Operation_Famille`);
        const rows = result.recordset.map(r => ({ parcelle: (r.Parcelle_Culturale || '').trim(), refParcelle: (r.Ref_parcelle || '').trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), operationFamille: r.Operation_Famille, operation: r.Operation, nbOuv: r.nbOuv, jh: Math.round((r.JH || 0) * 100) / 100, cout: Math.round(r.Cout || 0) }));
        return res.json({ success: true, periode: periodeParam, periodes, rows });
      }

      // ------ HORS-RECOLTE: operations breakdown ------
      if (action === "hors-recolte") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
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
          return res.json({ success: true, date: dateForCheck, operations: ops });
        }
        const dateSQL = dateParam ? `'${dateParam}'` : "CONVERT(date, GETDATE())";
        const result = await db.request().query(`SELECT Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale, COUNT(DISTINCT Personnel_Matricule) AS nbOuv, SUM(Nombre_Hr) AS totalHr, SUM(Nombre_Jr) AS totalJr, SUM(Cout) AS totalCout FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = ${dateSQL} AND Operation_Famille != '8. Récolte' AND Operation_Famille != '11. Postes fixes' GROUP BY Operation_Famille, Operation, Ref_parcelle, Parcelle_Culturale ORDER BY Operation_Famille, nbOuv DESC`);
        const ops = result.recordset.map(r => ({ operationFamille: r.Operation_Famille, operation: r.Operation, effectif: r.nbOuv, heures: r.totalHr, journees: r.totalJr, cout: Math.round(r.totalCout || 0), parcelle: (r.Parcelle_Culturale || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) }));
        return res.json({ success: true, date: dateForCheck, operations: ops });
      }

      // ------ SUIVI-TUNNELS: hors-récolte progress by parcelle/tâche for caporal screens ------
      if (action === "suivi-tunnels") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        const fermeParam = req.query.ferme;

        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const earliestDate = meta?.availableDates?.[meta.availableDates.length - 1] || dateForCheck;
          const yesterdayStr = new Date(new Date(dateForCheck).getTime() - 86400000).toISOString().slice(0, 10);
          const [todayRows, cumulRows] = await Promise.all([
            getPointageRowsForDate(dateForCheck),
            getPointageRowsForDateRange(earliestDate, yesterdayStr),
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
          return res.json({ success: true, date: dateForCheck, tunnels: byFerme });
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
        return res.json({ success: true, date: dateForCheck, tunnels: byFerme });
      }

      // ------ RECOLTE-EQUIPES: harvest per worker per day for team tracking ------
      if (action === "recolte-equipes") {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          // Get all available pointage data and filter to recolte
          const allDates = meta?.availableDates || [];
          const allRows = [];
          for (let i = 0; i < allDates.length; i += 10) {
            const batch = allDates.slice(i, i + 10);
            const results = await Promise.all(batch.map(d => getPointageRowsForDate(d)));
            for (const rows of results) allRows.push(...rows);
          }
          const recolteRows = allRows.filter(r => r.Operation_Famille === "8. Récolte");
          const rows = recolteRows.map(r => ({
            matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(),
            jour: r.DateStr, periode: r.Periode_paie,
            kg: Math.round(((r.Quantite_unite || 0) * 1.5) * 10) / 10,
            heures: r.Nombre_Hr, cout: Math.round(r.Cout || 0),
            ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale),
            variete: (r.Variete || "").trim(), culture: (r.Culture || "").trim(),
            parcelle: (r.Parcelle_Culturale || "").trim(), operation: (r.Operation || "").trim(),
          }));
          return res.json({ success: true, periodes, rows });
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const result = await db.request().query(`SELECT Personnel_Matricule, Personnel_Nom, CONVERT(date, Periode_Date) AS jour, Periode_paie, SUM(Quantite_unite * 1.5) AS totalKg, SUM(Nombre_Hr) AS totalHr, SUM(Cout) AS totalCout, Ref_parcelle, Parcelle_Culturale, Variete, Culture, Operation FROM BR_Pointage WHERE Operation_Famille = N'8. Récolte' GROUP BY Personnel_Matricule, Personnel_Nom, CONVERT(date, Periode_Date), Periode_paie, Ref_parcelle, Parcelle_Culturale, Variete, Culture, Operation ORDER BY jour DESC`);
        const rows = result.recordset.map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: new Date(r.jour).toISOString().slice(0, 10), periode: r.Periode_paie, kg: Math.round((r.totalKg || 0) * 10) / 10, heures: r.totalHr, cout: Math.round(r.totalCout || 0), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale), variete: (r.Variete || "").trim(), culture: (r.Culture || "").trim(), parcelle: (r.Parcelle_Culturale || "").trim(), operation: (r.Operation || "").trim() }));
        return res.json({ success: true, periodes, rows });
      }

      // ------ TRANSPORT: all workers per day for transport cost calculation ------
      if (action === "transport") {
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const periodes = meta?.periodes || [];
          const allDates = meta?.availableDates || [];
          const allRows = [];
          for (let i = 0; i < allDates.length; i += 10) {
            const batch = allDates.slice(i, i + 10);
            const results = await Promise.all(batch.map(d => getPointageRowsForDate(d)));
            for (const rows of results) allRows.push(...rows);
          }
          // Group by matricule+day+periode+operationFamille
          const groups = {};
          for (const r of allRows) {
            const key = `${r.Personnel_Matricule}|${r.DateStr}|${r.Periode_paie}|${r.Operation_Famille}`;
            if (!groups[key]) groups[key] = { Personnel_Matricule: r.Personnel_Matricule, Personnel_Nom: r.Personnel_Nom, DateStr: r.DateStr, Periode_paie: r.Periode_paie, Operation_Famille: r.Operation_Famille, Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale };
          }
          const rows = Object.values(groups).map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: r.DateStr, periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) }));
          return res.json({ success: true, periodes, rows });
        }
        // SQL fallback
        const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
        const periodes = periodesRes.recordset.map(r => r.Periode_paie);
        const result = await db.request().query(`SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, CONVERT(date, Periode_Date) AS jour, Periode_paie, Operation_Famille, MIN(Ref_parcelle) AS Ref_parcelle, MIN(Parcelle_Culturale) AS Parcelle_Culturale FROM BR_Pointage GROUP BY Personnel_Matricule, CONVERT(date, Periode_Date), Periode_paie, Operation_Famille ORDER BY jour DESC`);
        const rows = result.recordset.map(r => ({ matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), jour: new Date(r.jour).toISOString().slice(0, 10), periode: r.Periode_paie, operationFamille: (r.Operation_Famille || "").trim(), ferme: deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) }));
        return res.json({ success: true, periodes, rows });
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
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          const currentPeriode = meta?.periodes?.[0];
          if (!currentPeriode) return res.json({ success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] });
          const periodeDates = meta?.periodeMap?.[currentPeriode] || [];
          const qStart = periodeDates[0] || null;
          const qEnd = periodeDates[periodeDates.length - 1] || null;
          // Get all rows for all available dates to find first appearances
          const allDates = meta?.availableDates || [];
          const firstAppearance = {}; // matricule → first date
          for (let i = allDates.length - 1; i >= 0; i--) { // oldest first
            const dateRows = await getPointageRowsForDate(allDates[i]);
            for (const r of dateRows) {
              const mat = (r.Personnel_Matricule || "").trim();
              if (!firstAppearance[mat]) firstAppearance[mat] = { date: allDates[i], nom: (r.Personnel_Nom || "").trim(), Ref_parcelle: r.Ref_parcelle, Parcelle_Culturale: r.Parcelle_Culturale, Operation_Famille: r.Operation_Famille };
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
          return res.json({ success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers });
        }
        // SQL fallback
        const periodeRes = await db.request().query(`SELECT TOP 1 Periode_paie FROM BR_Pointage ORDER BY Periode_Date DESC`);
        const currentPeriode = (periodeRes.recordset[0] || {}).Periode_paie;
        if (!currentPeriode) return res.json({ success: true, periode: null, summary: { totalQuinzaine: 0, totalToday: 0, byFarm: {}, byDay: [] }, workers: [] });
        const result = await db.request().query(`WITH QuinzaineBounds AS (SELECT MIN(CONVERT(date, Periode_Date)) AS q_start, MAX(CONVERT(date, Periode_Date)) AS q_end FROM BR_Pointage WHERE Periode_paie = N'${currentPeriode.replace(/'/g, "''")}'), WorkerFirst AS (SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, MIN(CONVERT(date, Periode_Date)) AS first_date FROM BR_Pointage GROUP BY Personnel_Matricule HAVING MIN(CONVERT(date, Periode_Date)) >= (SELECT q_start FROM QuinzaineBounds)), WorkerFirstDetail AS (SELECT w.Personnel_Matricule, w.Personnel_Nom, w.first_date, p.Ref_parcelle, p.Parcelle_Culturale, p.Operation_Famille FROM WorkerFirst w OUTER APPLY (SELECT TOP 1 Ref_parcelle, Parcelle_Culturale, Operation_Famille FROM BR_Pointage WHERE Personnel_Matricule = w.Personnel_Matricule AND CONVERT(date, Periode_Date) = w.first_date) p) SELECT *, (SELECT q_start FROM QuinzaineBounds) AS q_start, (SELECT q_end FROM QuinzaineBounds) AS q_end FROM WorkerFirstDetail ORDER BY first_date DESC, Personnel_Nom`);
        const rows = result.recordset;
        const today = new Date().toISOString().slice(0, 10);
        const qStart = rows.length > 0 ? new Date(rows[0].q_start).toISOString().slice(0, 10) : null;
        const qEnd = rows.length > 0 ? new Date(rows[0].q_end).toISOString().slice(0, 10) : null;
        const byFarm = {}; const byDayMap = {};
        const workers = rows.map(r => { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); const fd = new Date(r.first_date).toISOString().slice(0, 10); byFarm[ferme] = (byFarm[ferme] || 0) + 1; byDayMap[fd] = (byDayMap[fd] || 0) + 1; return { matricule: (r.Personnel_Matricule || "").trim(), nom: (r.Personnel_Nom || "").trim(), firstDate: fd, ferme, equipe: (r.Personnel_Matricule || "").trim().substring(0, 2), operationFamille: r.Operation_Famille || "" }; });
        const totalToday = workers.filter(w => w.firstDate === today).length;
        const byDay = Object.entries(byDayMap).map(([jour, count]) => ({ jour, count })).sort((a, b) => b.jour.localeCompare(a.jour));
        return res.json({ success: true, periode: currentPeriode, quinzaineStart: qStart, quinzaineEnd: qEnd, summary: { totalQuinzaine: workers.length, totalToday, byFarm, byDay }, workers });
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
        let periodes, periodeParam, quinzaineDates, rawRows;
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          periodes = meta?.periodes || [];
          periodeParam = req.query.periode || periodes[0];
          if (!periodeParam) return res.json({ success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 });
          quinzaineDates = (meta?.periodeMap?.[periodeParam] || []).sort();
          rawRows = await getPointageRowsForPeriode(periodeParam);
        } else {
          const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
          periodes = periodesRes.recordset.map(r => r.Periode_paie);
          periodeParam = req.query.periode || periodes[0];
          if (!periodeParam) return res.json({ success: true, periode: null, equipes: [], nbJoursQuinzaine: 0 });
          const datesRes = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(periodeParam || '').replace(/'/g, "''")}' ORDER BY jour`);
          quinzaineDates = datesRes.recordset.map(r => new Date(r.jour).toISOString().slice(0, 10));
          const workersRes = await db.request().query(`SELECT Personnel_Matricule, MIN(Personnel_Nom) AS Personnel_Nom, CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(periodeParam || '').replace(/'/g, "''")}' GROUP BY Personnel_Matricule, CONVERT(date, Periode_Date) ORDER BY Personnel_Matricule`);
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
        return res.json({ success: true, periode: periodeParam, periodes, nbJoursQuinzaine, quinzaineDates, equipes });
      }

      // ------ QUINZAINE-ALERTES: teams absent 5+ consecutive days ------
      if (action === "quinzaine-alertes") {
        let periodes, periodeParam, quinzaineDates, presenceMap;
        if (USE_MIRROR) {
          const meta = await getPointageMeta();
          periodes = meta?.periodes || [];
          periodeParam = req.query.periode || periodes[0];
          if (!periodeParam) return res.json({ success: true, periode: null, alertes: [] });
          quinzaineDates = (meta?.periodeMap?.[periodeParam] || []).sort();
          const rawRows = await getPointageRowsForPeriode(periodeParam);
          presenceMap = {};
          for (const r of rawRows) {
            const prefix = (r.Personnel_Matricule || '').trim().substring(0, 2).toUpperCase();
            if (!presenceMap[prefix]) presenceMap[prefix] = new Set();
            presenceMap[prefix].add(r.DateStr);
          }
        } else {
          const periodesRes = await db.request().query(`SELECT DISTINCT Periode_paie FROM BR_Pointage WHERE Periode_paie IS NOT NULL ORDER BY Periode_paie DESC`);
          periodes = periodesRes.recordset.map(r => r.Periode_paie);
          periodeParam = req.query.periode || periodes[0];
          if (!periodeParam) return res.json({ success: true, periode: null, alertes: [] });
          const datesRes = await db.request().query(`SELECT DISTINCT CONVERT(date, Periode_Date) AS jour FROM BR_Pointage WHERE Periode_paie = N'${(periodeParam || '').replace(/'/g, "''")}' ORDER BY jour`);
          quinzaineDates = datesRes.recordset.map(r => new Date(r.jour).toISOString().slice(0, 10)).sort();
          const presenceRes = await db.request().query(`SELECT SUBSTRING(LTRIM(Personnel_Matricule), 1, 2) AS equipe_prefix, CONVERT(date, Periode_Date) AS jour, COUNT(DISTINCT Personnel_Matricule) AS nbOuv FROM BR_Pointage WHERE Periode_paie = N'${(periodeParam || '').replace(/'/g, "''")}' GROUP BY SUBSTRING(LTRIM(Personnel_Matricule), 1, 2), CONVERT(date, Periode_Date)`);
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
        return res.json({ success: true, periode: periodeParam, periodes, quinzaineDates, alertes });
      }

      // ------ UPLOAD-TIMES: when was pointage uploaded to SQL per farm ------
      if (action === "upload-times") {
        const dateForCheck = dateParam || new Date().toISOString().slice(0, 10);
        if (USE_MIRROR) {
          const [rows, syncStatus] = await Promise.all([getPointageRowsForDate(dateForCheck), getSyncStatus()]);
          const farmData = { F1: new Set(), F5: new Set(), Avocatier: new Set() };
          for (const r of rows) { const ferme = deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale); if (farmData[ferme]) farmData[ferme].add(r.Personnel_Matricule); }
          const uploads = Object.entries(farmData).map(([ferme, workers]) => ({ ferme, nbOuv: workers.size }));
          return res.json({ success: true, date: dateForCheck, lastTableWrite: syncStatus?.lastSuccessAt || null, uploads });
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
