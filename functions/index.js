const functions = require("firebase-functions");
const nodemailer = require("nodemailer");

// Shared config & middleware
const { admin, db: db_firestore, bucket } = require("./config/firebase");
const sqlConfig = require("./config/sqlConfig");
const { setCors } = require("./middleware/cors");
const { withCache } = require("./middleware/cache");
const { verifyAuth, requireAuth } = require("./middleware/requireAuth");

// =============================================
// Firestore Mirror — reads from synced collections
// =============================================
const { getConsommationRows, getCueilletteRows, getPointageRowsForDateRange, getSyncStatus } = require("./firestoreDataService");
const USE_MIRROR = process.env.USE_FIRESTORE_MIRROR !== "false";

// Import & re-export sync functions
const syncService = require("./sqlSyncService");
exports.replicationProbe = syncService.replicationProbe;
exports.sqlToFirestoreSync = syncService.sqlToFirestoreSync;
exports.sqlSyncTrigger = syncService.sqlSyncTrigger;
exports.probeAnalyzer = syncService.probeAnalyzer;
exports.probeAnalysisReport = syncService.probeAnalysisReport;
exports.probeRawData = syncService.probeRawData;

// SQL — lazy-loaded to avoid loading mssql when USE_MIRROR=true
let sql = null;
let pool = null;
async function getPool() {
  if (!sql) sql = require("mssql");
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}
function getSql() {
  if (!sql) sql = require("mssql");
  return sql;
}

// CORS helper imported from ./middleware/cors

// =============================================
// API 1: Programme Fertigation par parcelle/semaine
// =============================================
// --- Shared helper: structure consommation rows into parcelle → week → day → product ---
function structureByParcelleWeekDay(recordset, useParcelleCulturale = true) {
  const structured = {};
  recordset.forEach((row) => {
    const parc = useParcelleCulturale ? (row.Parcelle_Culturale || row.Parcelle_Physique) : row.Parcelle_Physique;
    if (!parc) return;
    const date = new Date(row.Date);
    const jan1 = new Date(date.getFullYear(), 0, 1);
    const dayOfYear = Math.floor((date - jan1) / 86400000) + 1;
    const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
    const weekKey = date.getFullYear() + "-W" + String(weekNum).padStart(2, "0");
    const dayNames = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
    const dayKey = dayNames[date.getDay()];
    if (!structured[parc]) structured[parc] = { culture: row.Culture, ferme: row.Ferme, weeks: {}, _cultureCounts: {} };
    structured[parc]._cultureCounts[row.Culture] = (structured[parc]._cultureCounts[row.Culture] || 0) + 1;
    if (!structured[parc].weeks[weekKey]) structured[parc].weeks[weekKey] = { days: {}, label: "Sem. " + parseInt(weekNum) };
    if (!structured[parc].weeks[weekKey].days[dayKey]) structured[parc].weeks[weekKey].days[dayKey] = {};
    structured[parc].weeks[weekKey].days[dayKey][row.Article] =
      (structured[parc].weeks[weekKey].days[dayKey][row.Article] || 0) + (row.Quantite || 0);
  });
  Object.values(structured).forEach(p => {
    if (p._cultureCounts) {
      let maxC = '', maxN = 0;
      Object.entries(p._cultureCounts).forEach(([c, n]) => { if (n > maxN) { maxC = c; maxN = n; } });
      if (maxC) p.culture = maxC;
      delete p._cultureCounts;
    }
  });
  return structured;
}

// --- Legacy SQL fetchers (used as fallback when USE_MIRROR=false) ---
async function legacy_fertigation(db, { parcelle, culture, ferme, weekStart, weekEnd }) {
  let query = `SELECT c.Parcelle_Culturale AS Parcelle_Physique, c.Culture, c.Ferme, c.Article, c.Article_Categorie,
    c.Quantite, c.Article_unite, c.[Date], DATEPART(dw, c.[Date]) AS JourSemaine
    FROM BR_Consommation c WHERE c.Article_Categorie = 'Engrais' AND c.[Date] >= '2025-07-01'`;
  const request = db.request();
  if (parcelle) { query += ` AND c.Parcelle_Culturale = @parcelle`; request.input("parcelle", getSql().NVarChar, parcelle); }
  if (culture) { query += ` AND c.Culture = @culture`; request.input("culture", getSql().NVarChar, culture); }
  if (ferme) { query += ` AND c.Ferme = @ferme`; request.input("ferme", getSql().NVarChar, ferme); }
  if (weekStart) { query += ` AND c.[Date] >= @weekStart`; request.input("weekStart", getSql().Date, weekStart); }
  if (weekEnd) { query += ` AND c.[Date] <= @weekEnd`; request.input("weekEnd", getSql().Date, weekEnd); }
  query += ` ORDER BY c.Parcelle_Culturale, c.[Date], c.Article`;
  const sqlResult = await request.query(query);
  return sqlResult.recordset;
}

exports.fertigation = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const { parcelle, culture, ferme, weekStart, weekEnd } = req.query;
      let rows;
      if (USE_MIRROR) {
        rows = await getConsommationRows({ categorie: "Engrais", parcelle, culture, ferme, weekStart, weekEnd });
      } else {
        const cacheKey = "fert_" + [parcelle || "", culture || "", ferme || "", weekStart || "", weekEnd || ""].join("|");
        const cached = await withCache(cacheKey, 30 * 60 * 1000, async () => {
          const db = await getPool();
          const recordset = await legacy_fertigation(db, { parcelle, culture, ferme, weekStart, weekEnd });
          const structured = structureByParcelleWeekDay(recordset);
          return { success: true, count: recordset.length, data: structured };
        });
        return res.json(cached);
      }
      // Mirror path: structure rows from Firestore
      // Map Firestore row shape to expected fields
      const mapped = rows.map(r => ({ ...r, Parcelle_Physique: r.Parcelle_Culturale || r.Parcelle_Physique }));
      const structured = structureByParcelleWeekDay(mapped);
      const syncStatus = await getSyncStatus();
      res.json({ success: true, count: rows.length, data: structured, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null });
    } catch (err) {
      console.error("Erreur fertigation:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Programme Phytosanitaire par parcelle/semaine
// =============================================
exports.phytosanitaire = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      if (!USE_MIRROR) {
        const result = await withCache("phyto", 30 * 60 * 1000, async () => {
          const db = await getPool();
          const sqlRes = await db.request().query(`
            SELECT c.Parcelle_Physique, c.Parcelle_Culturale, c.Culture, c.Ferme, c.Article, c.Article_Categorie,
              c.Quantite, c.Article_unite, c.[Date], DATEPART(dw, c.[Date]) AS JourSemaine
            FROM BR_Consommation c WHERE c.Article_Categorie = 'Pesticides' AND c.[Date] >= '2025-07-01'
            ORDER BY c.Parcelle_Physique, c.[Date], c.Article`);
          const structured = {};
          const addRow = (parc, row) => {
            if (!parc) return;
            const date = new Date(row.Date); const jan1 = new Date(date.getFullYear(), 0, 1);
            const dayOfYear = Math.floor((date - jan1) / 86400000) + 1;
            const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
            const weekKey = date.getFullYear() + "-W" + String(weekNum).padStart(2, "0");
            const dayNames = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
            const dayKey = dayNames[date.getDay()];
            if (!structured[parc]) structured[parc] = { culture: row.Culture, ferme: row.Ferme, weeks: {}, _cultureCounts: {} };
            structured[parc]._cultureCounts[row.Culture] = (structured[parc]._cultureCounts[row.Culture] || 0) + 1;
            if (!structured[parc].weeks[weekKey]) structured[parc].weeks[weekKey] = { days: {}, label: "Sem. " + parseInt(weekNum) };
            if (!structured[parc].weeks[weekKey].days[dayKey]) structured[parc].weeks[weekKey].days[dayKey] = {};
            structured[parc].weeks[weekKey].days[dayKey][row.Article] = (structured[parc].weeks[weekKey].days[dayKey][row.Article] || 0) + (row.Quantite || 0);
          };
          sqlRes.recordset.forEach((row) => {
            addRow(row.Parcelle_Physique, row);
            if (row.Parcelle_Culturale && row.Parcelle_Culturale !== row.Parcelle_Physique) addRow(row.Parcelle_Culturale, row);
          });
          Object.values(structured).forEach(p => {
            if (p._cultureCounts) { let maxC = '', maxN = 0; Object.entries(p._cultureCounts).forEach(([c, n]) => { if (n > maxN) { maxC = c; maxN = n; } }); if (maxC) p.culture = maxC; delete p._cultureCounts; }
          });
          const articlesInfo = {};
          sqlRes.recordset.forEach(row => { if (!articlesInfo[row.Article]) articlesInfo[row.Article] = { type: row.Article_Categorie, unite: row.Article_unite || 'Kg' }; });
          return { success: true, count: sqlRes.recordset.length, data: structured, articlesInfo };
        });
        return res.json(result);
      }
      // Mirror path
      const rows = await getConsommationRows({ categorie: "Pesticides" });
      const structured = {};
      const addRow = (parc, row) => {
        if (!parc) return;
        const date = new Date(row.Date); const jan1 = new Date(date.getFullYear(), 0, 1);
        const dayOfYear = Math.floor((date - jan1) / 86400000) + 1;
        const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
        const weekKey = date.getFullYear() + "-W" + String(weekNum).padStart(2, "0");
        const dayNames = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
        const dayKey = dayNames[date.getDay()];
        if (!structured[parc]) structured[parc] = { culture: row.Culture, ferme: row.Ferme, weeks: {}, _cultureCounts: {} };
        structured[parc]._cultureCounts[row.Culture] = (structured[parc]._cultureCounts[row.Culture] || 0) + 1;
        if (!structured[parc].weeks[weekKey]) structured[parc].weeks[weekKey] = { days: {}, label: "Sem. " + parseInt(weekNum) };
        if (!structured[parc].weeks[weekKey].days[dayKey]) structured[parc].weeks[weekKey].days[dayKey] = {};
        structured[parc].weeks[weekKey].days[dayKey][row.Article] = (structured[parc].weeks[weekKey].days[dayKey][row.Article] || 0) + (row.Quantite || 0);
      };
      rows.forEach((row) => {
        addRow(row.Parcelle_Physique, row);
        if (row.Parcelle_Culturale && row.Parcelle_Culturale !== row.Parcelle_Physique) addRow(row.Parcelle_Culturale, row);
      });
      Object.values(structured).forEach(p => {
        if (p._cultureCounts) { let maxC = '', maxN = 0; Object.entries(p._cultureCounts).forEach(([c, n]) => { if (n > maxN) { maxC = c; maxN = n; } }); if (maxC) p.culture = maxC; delete p._cultureCounts; }
      });
      const articlesInfo = {};
      rows.forEach(row => { if (!articlesInfo[row.Article]) articlesInfo[row.Article] = { type: row.Article_Categorie, unite: row.Article_unite || 'Kg' }; });
      const syncStatus = await getSyncStatus();
      res.json({ success: true, count: rows.length, data: structured, articlesInfo, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null });
    } catch (err) {
      console.error("Erreur phytosanitaire:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API 2: Liste des produits engrais uniques
// =============================================
exports.produits = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      if (!USE_MIRROR) {
        const result = await withCache("produits", 30 * 60 * 1000, async () => {
          const db = await getPool();
          const sqlRes = await db.request().query(`
            SELECT Article, Article_Categorie, Article_unite, SUM(Quantite) AS TotalQty,
              COUNT(DISTINCT Parcelle_Culturale) AS NbParcelles,
              MIN([Date]) AS PremiereUtilisation, MAX([Date]) AS DerniereUtilisation
            FROM BR_Consommation WHERE Article_Categorie = 'Engrais' AND [Date] >= '2025-07-01'
            GROUP BY Article, Article_Categorie, Article_unite ORDER BY SUM(Quantite) DESC`);
          return { success: true, count: sqlRes.recordset.length, produits: sqlRes.recordset };
        });
        return res.json(result);
      }
      // Mirror path: aggregate from raw rows
      const rows = await getConsommationRows({ categorie: "Engrais" });
      const agg = {};
      rows.forEach(r => {
        const key = r.Article;
        if (!agg[key]) agg[key] = { Article: r.Article, Article_Categorie: r.Article_Categorie, Article_unite: r.Article_unite, TotalQty: 0, _parcelles: new Set(), _minDate: r.Date, _maxDate: r.Date };
        agg[key].TotalQty += r.Quantite || 0;
        agg[key]._parcelles.add(r.Parcelle_Culturale);
        if (r.Date < agg[key]._minDate) agg[key]._minDate = r.Date;
        if (r.Date > agg[key]._maxDate) agg[key]._maxDate = r.Date;
      });
      const produits = Object.values(agg)
        .map(a => ({ Article: a.Article, Article_Categorie: a.Article_Categorie, Article_unite: a.Article_unite, TotalQty: a.TotalQty, NbParcelles: a._parcelles.size, PremiereUtilisation: a._minDate, DerniereUtilisation: a._maxDate }))
        .sort((a, b) => b.TotalQty - a.TotalQty);
      const syncStatus = await getSyncStatus();
      res.json({ success: true, count: produits.length, produits, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null });
    } catch (err) {
      console.error("Erreur produits:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API 3: Parcelles avec résumé
// =============================================
exports.parcelles = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      if (!USE_MIRROR) {
        const result = await withCache("parcelles", 30 * 60 * 1000, async () => {
          const db = await getPool();
          const sqlRes = await db.request().query(`
            SELECT Parcelle_Culturale AS Parcelle_Physique, Culture, Ferme,
              MAX(Parcelle_sup) AS Sup,
              SUM(CASE WHEN Article_Categorie = 'Engrais' THEN Quantite ELSE 0 END) AS TotalEngrais,
              SUM(CASE WHEN Article_Categorie = 'Pesticides' THEN Quantite ELSE 0 END) AS TotalPesticides,
              COUNT(DISTINCT Article) AS NbProduits,
              MIN([Date]) AS Debut, MAX([Date]) AS Fin, COUNT(*) AS Cnt
            FROM BR_Consommation WHERE [Date] >= '2025-07-01'
            GROUP BY Parcelle_Culturale, Culture, Ferme ORDER BY Parcelle_Culturale`);
          const parcAgg = {};
          sqlRes.recordset.forEach(r => {
            const key = r.Parcelle_Physique;
            if (!parcAgg[key]) { parcAgg[key] = { ...r, _cultures: {} }; }
            else { parcAgg[key].Sup = Math.max(parcAgg[key].Sup || 0, r.Sup || 0); parcAgg[key].TotalEngrais += r.TotalEngrais || 0; parcAgg[key].TotalPesticides += r.TotalPesticides || 0; parcAgg[key].NbProduits += r.NbProduits || 0; if (r.Debut < parcAgg[key].Debut) parcAgg[key].Debut = r.Debut; if (r.Fin > parcAgg[key].Fin) parcAgg[key].Fin = r.Fin; }
            parcAgg[key]._cultures[r.Culture] = (parcAgg[key]._cultures[r.Culture] || 0) + (r.Cnt || 1);
          });
          const parcelles = Object.values(parcAgg).map(p => { let maxC = '', maxN = 0; Object.entries(p._cultures || {}).forEach(([c, n]) => { if (n > maxN) { maxC = c; maxN = n; } }); if (maxC) p.Culture = maxC; delete p._cultures; delete p.Cnt; return p; });
          return { success: true, count: parcelles.length, parcelles };
        });
        return res.json(result);
      }
      // Mirror path: aggregate from raw rows
      const rows = await getConsommationRows({});
      const parcAgg = {};
      rows.forEach(r => {
        const key = r.Parcelle_Culturale;
        if (!parcAgg[key]) {
          parcAgg[key] = { Parcelle_Physique: key, Culture: r.Culture, Ferme: r.Ferme, Sup: r.Parcelle_sup || 0, TotalEngrais: 0, TotalPesticides: 0, _articles: new Set(), _minDate: r.Date, _maxDate: r.Date, _cultures: {} };
        }
        parcAgg[key].Sup = Math.max(parcAgg[key].Sup || 0, r.Parcelle_sup || 0);
        if (r.Article_Categorie === "Engrais") parcAgg[key].TotalEngrais += r.Quantite || 0;
        if (r.Article_Categorie === "Pesticides") parcAgg[key].TotalPesticides += r.Quantite || 0;
        parcAgg[key]._articles.add(r.Article);
        if (r.Date < parcAgg[key]._minDate) parcAgg[key]._minDate = r.Date;
        if (r.Date > parcAgg[key]._maxDate) parcAgg[key]._maxDate = r.Date;
        parcAgg[key]._cultures[r.Culture] = (parcAgg[key]._cultures[r.Culture] || 0) + 1;
      });
      const parcelles = Object.values(parcAgg).map(p => {
        let maxC = '', maxN = 0;
        Object.entries(p._cultures || {}).forEach(([c, n]) => { if (n > maxN) { maxC = c; maxN = n; } });
        if (maxC) p.Culture = maxC;
        return { Parcelle_Physique: p.Parcelle_Physique, Culture: p.Culture, Ferme: p.Ferme, Sup: p.Sup, TotalEngrais: p.TotalEngrais, TotalPesticides: p.TotalPesticides, NbProduits: p._articles.size, Debut: p._minDate, Fin: p._maxDate };
      }).sort((a, b) => (a.Parcelle_Physique || "").localeCompare(b.Parcelle_Physique || ""));
      const syncStatus = await getSyncStatus();
      res.json({ success: true, count: parcelles.length, parcelles, syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null });
    } catch (err) {
      console.error("Erreur parcelles:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API 4: Dashboard agrégé
// =============================================
exports.dashboard = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "512MB", minInstances: 1 })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      if (!USE_MIRROR) {
        const result = await withCache("dashboard", 30 * 60 * 1000, async () => {
          const db = await getPool();
          const [topEngrais, topPesticides, mensuel] = await Promise.all([
            db.request().query(`SELECT TOP 20 Article, SUM(Quantite) AS Qty, Article_Categorie FROM BR_Consommation WHERE Article_Categorie = 'Engrais' AND [Date] >= '2025-07-01' GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC`),
            db.request().query(`SELECT TOP 20 Article, SUM(Quantite) AS Qty, Article_Categorie FROM BR_Consommation WHERE Article_Categorie = 'Pesticides' AND [Date] >= '2025-07-01' GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC`),
            db.request().query(`SELECT FORMAT([Date],'yyyy-MM') AS Mois, SUM(CASE WHEN Article_Categorie = 'Engrais' THEN Quantite ELSE 0 END) AS Engrais, SUM(CASE WHEN Article_Categorie = 'Pesticides' THEN Quantite ELSE 0 END) AS Pesticides FROM BR_Consommation WHERE [Date] >= '2025-07-01' GROUP BY FORMAT([Date],'yyyy-MM') ORDER BY FORMAT([Date],'yyyy-MM')`),
          ]);
          return { success: true, topEngrais: topEngrais.recordset, topPesticides: topPesticides.recordset, consommationMensuelle: mensuel.recordset, dateExtraction: new Date().toISOString() };
        });
        return res.json(result);
      }
      // Mirror path
      const rows = await getConsommationRows({});
      // Top 20 engrais
      const engAgg = {};
      rows.filter(r => r.Article_Categorie === "Engrais").forEach(r => {
        if (!engAgg[r.Article]) engAgg[r.Article] = { Article: r.Article, Qty: 0, Article_Categorie: r.Article_Categorie };
        engAgg[r.Article].Qty += r.Quantite || 0;
      });
      const topEngrais = Object.values(engAgg).sort((a, b) => b.Qty - a.Qty).slice(0, 20);
      // Top 20 pesticides
      const pestAgg = {};
      rows.filter(r => r.Article_Categorie === "Pesticides").forEach(r => {
        if (!pestAgg[r.Article]) pestAgg[r.Article] = { Article: r.Article, Qty: 0, Article_Categorie: r.Article_Categorie };
        pestAgg[r.Article].Qty += r.Quantite || 0;
      });
      const topPesticides = Object.values(pestAgg).sort((a, b) => b.Qty - a.Qty).slice(0, 20);
      // Monthly consumption
      const mensuelAgg = {};
      rows.forEach(r => {
        const mois = (r.Date || "").slice(0, 7);
        if (!mois) return;
        if (!mensuelAgg[mois]) mensuelAgg[mois] = { Mois: mois, Engrais: 0, Pesticides: 0 };
        if (r.Article_Categorie === "Engrais") mensuelAgg[mois].Engrais += r.Quantite || 0;
        if (r.Article_Categorie === "Pesticides") mensuelAgg[mois].Pesticides += r.Quantite || 0;
      });
      const consommationMensuelle = Object.values(mensuelAgg).sort((a, b) => a.Mois.localeCompare(b.Mois));
      const syncStatus = await getSyncStatus();
      res.json({ success: true, topEngrais, topPesticides, consommationMensuelle, dateExtraction: new Date().toISOString(), syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null });
    } catch (err) {
      console.error("Erreur dashboard:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API 5: Agro Summary — NPK par parcelle depuis SQL
// =============================================
// Table de composition NPK des engrais (% de matière active)
// Lookup case-insensitive pour matcher les noms SQL
const _RAW_COMPOSITIONS = {
  // --- Matières actives Berry Good ---
  "Ammonitrate":          { N: 0.335, P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0 },
  "Nitrate de Calcium":   { N: 0.155, P2O5: 0,    K2O: 0,    CaO: 0.26, MgO: 0 },
  "Nitrate de Potasse":   { N: 0.13,  P2O5: 0,    K2O: 0.46, CaO: 0,    MgO: 0 },
  "Nitrate de Magnesie":  { N: 0.11,  P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0.16 },
  "Acide Phosphorique":   { N: 0,     P2O5: 0.54, K2O: 0,    CaO: 0,    MgO: 0 },
  "Acide Nitrique":       { N: 0.13,  P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0 },
  "Sulfate de Magnesie":  { N: 0,     P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0.16 },
  "MAP":                  { N: 0.12,  P2O5: 0.61, K2O: 0,    CaO: 0,    MgO: 0 },
  "Solupotasse":          { N: 0,     P2O5: 0,    K2O: 0.50, CaO: 0,    MgO: 0 },
  // --- Catalogue TIMAC AGRO: Super SPE ---
  "BIOACTYL SUPERBE":     { N: 0.08,  P2O5: 0.22, K2O: 0.10, CaO: 0,    MgO: 0.002 },
  "EUROFERTIL PK":        { N: 0,     P2O5: 0.12, K2O: 0.24, CaO: 0.20, MgO: 0 },
  "HUMIFERTIL":           { N: 0.07,  P2O5: 0.14, K2O: 0.20, CaO: 0,    MgO: 0 },
  // --- D-CODER ---
  "D-CODER 32":           { N: 0.08,  P2O5: 0.32, K2O: 0.12, CaO: 0,    MgO: 0 },
  "D-CODER K20":          { N: 0.06,  P2O5: 0.30, K2O: 0.20, CaO: 0,    MgO: 0 },
  "D-CODER EXTRA":        { N: 0.14,  P2O5: 0.35, K2O: 0.10, CaO: 0,    MgO: 0 },
  "D-CODER K-UP":         { N: 0.09,  P2O5: 0.23, K2O: 0.30, CaO: 0,    MgO: 0 },
  "D-CODER MASTER":       { N: 0.10,  P2O5: 0.20, K2O: 0.25, CaO: 0,    MgO: 0 },
  "D-CODER MAGNUM":       { N: 0.03,  P2O5: 0.33, K2O: 0.05, CaO: 0,    MgO: 0 },
  // --- AZO-PRO ---
  "AZO-PRO 31":           { N: 0.31,  P2O5: 0.04, K2O: 0,    CaO: 0,    MgO: 0 },
  "AZO-PRO NP":           { N: 0.20,  P2O5: 0.10, K2O: 0,    CaO: 0,    MgO: 0 },
  "AZO-PRO NK":           { N: 0.12,  P2O5: 0,    K2O: 0.22, CaO: 0,    MgO: 0 },
  // --- Organo-Minéraux ---
  "CO-ACTYL-NP":          { N: 0.05,  P2O5: 0.07, K2O: 0,    CaO: 0,    MgO: 0 },
  "ORGAPHOS":             { N: 0.06,  P2O5: 0.20, K2O: 0,    CaO: 0,    MgO: 0 },
  // --- Amendements ---
  "HUMOCAL":              { N: 0,     P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0 },
  "HUMISOL":              { N: 0,     P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0 },
  // --- KSC Fertigation (Catalogue TIMAC) ---
  "KSC I":                { N: 0.14,  P2O5: 0.40, K2O: 0.05, CaO: 0,    MgO: 0 },
  "KSC II":               { N: 0.23,  P2O5: 0.05, K2O: 0.05, CaO: 0,    MgO: 0 },
  "KSC III":              { N: 0.15,  P2O5: 0.05, K2O: 0.35, CaO: 0,    MgO: 0 },
  "KSC IV":               { N: 0,     P2O5: 0.32, K2O: 0.40, CaO: 0,    MgO: 0 },
  "KSC V":                { N: 0.08,  P2O5: 0.16, K2O: 0.42, CaO: 0,    MgO: 0 },
  "KSC VI":               { N: 0.14,  P2O5: 0.12, K2O: 0.14, CaO: 0,    MgO: 0 },
  "KSC VII PERLA":        { N: 0.15,  P2O5: 0,    K2O: 0.09, CaO: 0.20, MgO: 0 },
  "KSC VII":              { N: 0.15,  P2O5: 0,    K2O: 0.09, CaO: 0.20, MgO: 0 },
  "KSC MIX":              { N: 0,     P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0.15 },
  "KSC MicroMix":         { N: 0,     P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0.15 },
  // --- TIMASOL Fertigation ---
  "TIMASOL I":            { N: 0.12,  P2O5: 0.35, K2O: 0.05, CaO: 0,    MgO: 0 },
  "TIMASOL II":           { N: 0.20,  P2O5: 0.20, K2O: 0.20, CaO: 0,    MgO: 0 },
  "TIMASOL III":          { N: 0.15,  P2O5: 0.15, K2O: 0.30, CaO: 0,    MgO: 0 },
  "TIMASOL IV":           { N: 0.10,  P2O5: 0.05, K2O: 0.40, CaO: 0,    MgO: 0 },
  "TIMASOL PHOSCAL":      { N: 0.10,  P2O5: 0,    K2O: 0,    CaO: 0.10, MgO: 0 },
  // --- NPK Liquides ---
  "SULFACID LCN":         { N: 0.15,  P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0 },
  "EXCELIS I":            { N: 0.03,  P2O5: 0.10, K2O: 0.05, CaO: 0,    MgO: 0 },
  "EXCELIS II":           { N: 0.08,  P2O5: 0.08, K2O: 0.08, CaO: 0,    MgO: 0 },
  "EXCELIS III":          { N: 0.03,  P2O5: 0.02, K2O: 0.10, CaO: 0,    MgO: 0 },
  "EXCELIS N":            { N: 0.30,  P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0 },
  // --- Biostimulants ---
  "BIO ACTYL":            { N: 0.03,  P2O5: 0,    K2O: 0.05, CaO: 0,    MgO: 0 },
  "SEACTIV VITAL":        { N: 0.09,  P2O5: 0.05, K2O: 0.04, CaO: 0,    MgO: 0 },
  "SEACTIV KALEO":        { N: 0.04,  P2O5: 0.06, K2O: 0.09, CaO: 0,    MgO: 0 },
  "SEACTIV ALPHA":        { N: 0.05,  P2O5: 0.13, K2O: 0,    CaO: 0,    MgO: 0 },
  "SEACTIV ELITE":        { N: 0.09,  P2O5: 0.06, K2O: 0.12, CaO: 0,    MgO: 0 },
  "SEACTIV AZUR Ca":      { N: 0,     P2O5: 0,    K2O: 0,    CaO: 0.15, MgO: 0 },
  "SEACTIV MAGICAL":      { N: 0,     P2O5: 0,    K2O: 0,    CaO: 0.12, MgO: 0.04 },
  "SEACTIV VERTIS":       { N: 0,     P2O5: 0,    K2O: 0,    CaO: 0,    MgO: 0.089 },
  "MAXI FRUIT":           { N: 0.03,  P2O5: 0.07, K2O: 0.07, CaO: 0,    MgO: 0 },
  "FERTIACTYL GZ":        { N: 0.13,  P2O5: 0,    K2O: 0.05, CaO: 0,    MgO: 0 },
  "FERTIACTYL STARTER":   { N: 0.13,  P2O5: 0.05, K2O: 0.08, CaO: 0,    MgO: 0 },
  "RECORD":               { N: 0,     P2O5: 0,    K2O: 0.30, CaO: 0,    MgO: 0 },
  "KALIS":                { N: 0.05,  P2O5: 0,    K2O: 0.27, CaO: 0,    MgO: 0.03 },
};
// Générer le lookup case-insensitive
const COMPOSITION_NPK = {};
Object.entries(_RAW_COMPOSITIONS).forEach(([name, comp]) => {
  COMPOSITION_NPK[name] = comp;
  COMPOSITION_NPK[name.toUpperCase()] = comp;
  COMPOSITION_NPK[name.toLowerCase()] = comp;
});

// Surfaces par parcelle (Ha) — à mettre à jour si la base inclut cette info
const SURFACES_HA = {
  "Avocat AVOCAT F6 AVOCAT": 10, "AVOCAT F5": 1, "BREEZE MYRTILLE S8-2": 1,
  "CASCADE MYRTILLE S8-1": 1.5, "EL BAHIA": 1, "F2 - HAAS": 4.86,
  "F3 -HAAS": 1, "F4 -HAAS": 4.64, "F5 CORINA": 2.5, "F6-HAAS": 9.13,
  "Parcelle avocat AVOCAT": 25, "S1.S4 Maravilla green can F1": 4,
  "S1/S4 Maravilla mow down F1": 2.1, "S10 - YAZMIN MOTTE F5": 1.9,
  "S10 YAZMIN cut back F5": 1.9, "S13 - YAZMIN MOW DOWN F5": 2.8,
  "S2 -YAZMIN MOW DOWN F1": 1.5, "S2.S3.S5.S6.S7 maravilla logn can F1": 5,
  "S3 - MARAVILLA MOTTE F1": 0.6, "S5 -YAZMIN MOW DOWN F1": 1.3,
  "S7 -MARAVILLA MOTTE F1": 2, "S9 - REYNA F5": 3,
};

exports.agroSummary = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      if (!USE_MIRROR) {
        const result = await withCache("agrosummary", 30 * 60 * 1000, async () => {
          const db = await getPool();
          const [parcResult, topEngResult, topPestResult, pestByParc] = await Promise.all([
            db.request().query(`SELECT Parcelle_Culturale AS Parcelle_Physique, Culture, Ferme, Article, SUM(Quantite) AS Qty, MAX(Parcelle_sup) AS Parcelle_sup FROM BR_Consommation WHERE Article_Categorie = 'Engrais' AND [Date] >= '2025-07-01' GROUP BY Parcelle_Culturale, Culture, Ferme, Article ORDER BY Parcelle_Culturale, Article`),
            db.request().query(`SELECT TOP 20 Article, SUM(Quantite) AS Qty, Article_Categorie FROM BR_Consommation WHERE Article_Categorie = 'Engrais' AND [Date] >= '2025-07-01' GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC`),
            db.request().query(`SELECT TOP 25 Article, SUM(Quantite) AS Qty, Article_Categorie FROM BR_Consommation WHERE Article_Categorie = 'Pesticides' AND [Date] >= '2025-07-01' GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC`),
            db.request().query(`SELECT Parcelle_Culturale AS Parcelle_Physique, SUM(Quantite) AS TotalPest FROM BR_Consommation WHERE Article_Categorie = 'Pesticides' AND [Date] >= '2025-07-01' GROUP BY Parcelle_Culturale`),
          ]);
          const pestMap = {};
          pestByParc.recordset.forEach(r => { pestMap[r.Parcelle_Physique] = r.TotalPest || 0; });
          const parcMap = {}; const parcCultureCounts = {};
          parcResult.recordset.forEach(row => {
            const parcName = row.Parcelle_Physique;
            if (!parcMap[parcName]) { parcMap[parcName] = { parcelle: parcName, culture: row.Culture, ferme: row.Ferme, sup: row.Parcelle_sup || SURFACES_HA[parcName] || 1, N: 0, P2O5: 0, K2O: 0, CaO: 0, MgO: 0, engrais: 0, pest: 0 }; parcCultureCounts[parcName] = {}; }
            parcCultureCounts[parcName][row.Culture] = (parcCultureCounts[parcName][row.Culture] || 0) + (row.Qty || 1);
            const p = parcMap[parcName]; const qty = row.Qty || 0; p.engrais += qty;
            const comp = COMPOSITION_NPK[row.Article];
            if (comp) { p.N += qty * comp.N; p.P2O5 += qty * comp.P2O5; p.K2O += qty * comp.K2O; p.CaO += qty * comp.CaO; p.MgO += qty * comp.MgO; }
          });
          Object.values(parcMap).forEach(p => { p.pest = pestMap[p.parcelle] || 0; p.N = Math.round(p.N * 10) / 10; p.P2O5 = Math.round(p.P2O5 * 10) / 10; p.K2O = Math.round(p.K2O * 10) / 10; p.CaO = Math.round(p.CaO * 10) / 10; p.MgO = Math.round(p.MgO * 10) / 10; p.engrais = Math.round(p.engrais * 10) / 10; p.pest = Math.round(p.pest * 10) / 10; });
          Object.entries(parcCultureCounts).forEach(([parcName, counts]) => { let maxC = '', maxN = 0; Object.entries(counts).forEach(([c, n]) => { if (n > maxN) { maxC = c; maxN = n; } }); if (maxC && parcMap[parcName]) parcMap[parcName].culture = maxC; });
          const parcelles = Object.values(parcMap);
          const cultMap = {};
          parcelles.forEach(p => { if (!cultMap[p.culture]) cultMap[p.culture] = { culture: p.culture, sup: 0, N: 0, P2O5: 0, K2O: 0, CaO: 0, MgO: 0, engrais: 0, pest: 0 }; const c = cultMap[p.culture]; c.sup += p.sup; c.N += p.N; c.P2O5 += p.P2O5; c.K2O += p.K2O; c.CaO += p.CaO; c.MgO += p.MgO; c.engrais += p.engrais; c.pest += p.pest; });
          const cultures = Object.values(cultMap).map(c => ({ culture: c.culture, sup: Math.round(c.sup * 100) / 100, N_Ha: Math.round(c.N / c.sup * 10) / 10, P_Ha: Math.round(c.P2O5 / c.sup * 10) / 10, K_Ha: Math.round(c.K2O / c.sup * 10) / 10, CaO_Ha: Math.round(c.CaO / c.sup * 10) / 10, MgO_Ha: Math.round(c.MgO / c.sup * 10) / 10, Ca_K: c.K2O > 0 ? Math.round(c.CaO / c.K2O * 100) / 100 : 0, Eng_Ha: Math.round(c.engrais / c.sup * 10) / 10, Pest_Ha: Math.round(c.pest / c.sup * 10) / 10 }));
          return { success: true, parcelles, cultures, topEngrais: topEngResult.recordset.map(r => ({ article: r.Article, qty: Math.round(r.Qty), type: r.Article_Categorie })), pesticides: topPestResult.recordset.map(r => ({ article: r.Article, qty: Math.round(r.Qty * 10) / 10, type: r.Article_Categorie })), campagne: "2025/2026", dateExtraction: new Date().toLocaleDateString("fr-FR") };
        });
        return res.json(result);
      }
      // Mirror path: all aggregation done in JS from raw Firestore rows
      const allRows = await getConsommationRows({});
      const engraisRows = allRows.filter(r => r.Article_Categorie === "Engrais");
      const pestRows = allRows.filter(r => r.Article_Categorie === "Pesticides");
      // Pest totals by parcelle
      const pestMap = {};
      pestRows.forEach(r => { pestMap[r.Parcelle_Culturale] = (pestMap[r.Parcelle_Culturale] || 0) + (r.Quantite || 0); });
      // Aggregate engrais by parcelle+article, then compute NPK
      const parcAgg = {};
      engraisRows.forEach(r => {
        const key = r.Parcelle_Culturale + "|" + r.Article;
        if (!parcAgg[key]) parcAgg[key] = { parcelle: r.Parcelle_Culturale, culture: r.Culture, ferme: r.Ferme, article: r.Article, qty: 0, sup: r.Parcelle_sup };
        parcAgg[key].qty += r.Quantite || 0;
        if (r.Parcelle_sup && (!parcAgg[key].sup || r.Parcelle_sup > parcAgg[key].sup)) parcAgg[key].sup = r.Parcelle_sup;
      });
      const parcMap = {}; const parcCultureCounts = {};
      Object.values(parcAgg).forEach(row => {
        const parcName = row.parcelle;
        if (!parcMap[parcName]) { parcMap[parcName] = { parcelle: parcName, culture: row.culture, ferme: row.ferme, sup: row.sup || SURFACES_HA[parcName] || 1, N: 0, P2O5: 0, K2O: 0, CaO: 0, MgO: 0, engrais: 0, pest: 0 }; parcCultureCounts[parcName] = {}; }
        parcCultureCounts[parcName][row.culture] = (parcCultureCounts[parcName][row.culture] || 0) + (row.qty || 1);
        const p = parcMap[parcName]; const qty = row.qty || 0; p.engrais += qty;
        const comp = COMPOSITION_NPK[row.article];
        if (comp) { p.N += qty * comp.N; p.P2O5 += qty * comp.P2O5; p.K2O += qty * comp.K2O; p.CaO += qty * comp.CaO; p.MgO += qty * comp.MgO; }
      });
      Object.values(parcMap).forEach(p => {
        p.pest = pestMap[p.parcelle] || 0;
        p.N = Math.round(p.N * 10) / 10; p.P2O5 = Math.round(p.P2O5 * 10) / 10; p.K2O = Math.round(p.K2O * 10) / 10;
        p.CaO = Math.round(p.CaO * 10) / 10; p.MgO = Math.round(p.MgO * 10) / 10;
        p.engrais = Math.round(p.engrais * 10) / 10; p.pest = Math.round(p.pest * 10) / 10;
      });
      Object.entries(parcCultureCounts).forEach(([parcName, counts]) => {
        let maxC = '', maxN = 0;
        Object.entries(counts).forEach(([c, n]) => { if (n > maxN) { maxC = c; maxN = n; } });
        if (maxC && parcMap[parcName]) parcMap[parcName].culture = maxC;
      });
      const parcelles = Object.values(parcMap);
      // Culture-level aggregation
      const cultMap = {};
      parcelles.forEach(p => {
        if (!cultMap[p.culture]) cultMap[p.culture] = { culture: p.culture, sup: 0, N: 0, P2O5: 0, K2O: 0, CaO: 0, MgO: 0, engrais: 0, pest: 0 };
        const c = cultMap[p.culture]; c.sup += p.sup; c.N += p.N; c.P2O5 += p.P2O5; c.K2O += p.K2O; c.CaO += p.CaO; c.MgO += p.MgO; c.engrais += p.engrais; c.pest += p.pest;
      });
      const cultures = Object.values(cultMap).map(c => ({
        culture: c.culture, sup: Math.round(c.sup * 100) / 100,
        N_Ha: Math.round(c.N / c.sup * 10) / 10, P_Ha: Math.round(c.P2O5 / c.sup * 10) / 10, K_Ha: Math.round(c.K2O / c.sup * 10) / 10,
        CaO_Ha: Math.round(c.CaO / c.sup * 10) / 10, MgO_Ha: Math.round(c.MgO / c.sup * 10) / 10,
        Ca_K: c.K2O > 0 ? Math.round(c.CaO / c.K2O * 100) / 100 : 0,
        Eng_Ha: Math.round(c.engrais / c.sup * 10) / 10, Pest_Ha: Math.round(c.pest / c.sup * 10) / 10,
      }));
      // Top engrais & pesticides
      const engByArticle = {};
      engraisRows.forEach(r => { engByArticle[r.Article] = (engByArticle[r.Article] || 0) + (r.Quantite || 0); });
      const topEngrais = Object.entries(engByArticle).map(([a, q]) => ({ article: a, qty: Math.round(q), type: "Engrais" })).sort((a, b) => b.qty - a.qty).slice(0, 20);
      const pestByArticle = {};
      pestRows.forEach(r => { pestByArticle[r.Article] = (pestByArticle[r.Article] || 0) + (r.Quantite || 0); });
      const pesticides = Object.entries(pestByArticle).map(([a, q]) => ({ article: a, qty: Math.round(q * 10) / 10, type: "Pesticides" })).sort((a, b) => b.qty - a.qty).slice(0, 25);
      const syncStatus = await getSyncStatus();
      res.json({ success: true, parcelles, cultures, topEngrais, pesticides, campagne: "2025/2026", dateExtraction: new Date().toLocaleDateString("fr-FR"), syncedAt: syncStatus?.lastSuccessAt || null, dataAge: syncStatus?.dataAge || null });
    } catch (err) {
      console.error("Erreur agro-summary:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API 6: Health check / test connexion
// =============================================
exports.health = functions
  .region("europe-west1")
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    try {
      // Default health check: Firestore ping (no SQL hit)
      const needsSQL = req.query.mode === "sql";
      if (!needsSQL) {
        const syncStatus = await getSyncStatus();
        return res.json({
          success: true,
          mode: "firestore",
          mirror: USE_MIRROR,
          syncStatus: syncStatus || {},
          timestamp: new Date().toISOString(),
        });
      }
      // SQL diagnostic mode — requires authentication
      const authUser = await requireAuth(req, res);
      if (!authUser) return;
      const db = await getPool();
      const result = await db.request().query("SELECT GETDATE() AS now, DB_NAME() AS db");
      res.json({
        success: true,
        server: sqlConfig.server,
        database: sqlConfig.database,
        serverTime: result.recordset[0].now,
        dbName: result.recordset[0].db,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Avancement Culture — CRUD Firestore
// =============================================
const COLLECTION = "avancement_culture";

exports.avancementCulture = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const method = req.method;
      const parcelle = req.query.parcelle || req.body.parcelle;

      // Encoder le nom pour l'utiliser comme ID Firestore (/ interdit)
      const docId = parcelle ? parcelle.replace(/\//g, '_SLASH_').replace(/\s+/g, ' ').trim() : null;
      const decodeName = (id) => id.replace(/_SLASH_/g, '/');

      // GET — lire toutes les parcelles ou une seule
      if (method === "GET") {
        if (docId) {
          const doc = await db_firestore.collection(COLLECTION).doc(docId).get();
          return res.json({ success: true, data: doc.exists ? doc.data() : null });
        }
        const snap = await db_firestore.collection(COLLECTION).get();
        const all = {};
        snap.forEach(d => { all[decodeName(d.id)] = d.data(); });
        return res.json({ success: true, data: all });
      }

      // POST/PUT — sauvegarder les infos d'une parcelle
      if (method === "POST" || method === "PUT") {
        if (!docId) return res.status(400).json({ success: false, error: "parcelle requise" });
        const payload = req.body.data || {};
        await db_firestore.collection(COLLECTION).doc(docId).set(payload, { merge: true });
        return res.json({ success: true });
      }

      res.status(405).json({ success: false, error: "Méthode non supportée" });
    } catch (err) {
      console.error("Erreur avancement:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Upload photo parcelle — Firebase Storage
// =============================================
exports.uploadPhoto = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST uniquement" });
    try {
      const parcelle = req.query.parcelle || req.body.parcelle;
      if (!parcelle) return res.status(400).json({ success: false, error: "parcelle requise" });

      const { image, filename, date, note } = req.body;
      if (!image) return res.status(400).json({ success: false, error: "image (base64) requise" });

      // Décoder base64 et uploader dans Storage
      const docId = parcelle.replace(/\//g, '_SLASH_').replace(/\s+/g, ' ').trim();
      const safeStorageName = parcelle.replace(/\//g, '_').replace(/\s+/g, '_');
      const buffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const ext = (filename || "photo.jpg").split(".").pop() || "jpg";
      const storagePath = `avancement/${safeStorageName}/${Date.now()}.${ext}`;
      const file = bucket.file(storagePath);
      await file.save(buffer, { metadata: { contentType: `image/${ext}` } });
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

      // Enregistrer la référence dans Firestore
      const docRef = db_firestore.collection(COLLECTION).doc(docId);
      const doc = await docRef.get();
      const photos = (doc.exists && doc.data().photos) || [];
      photos.push({ url: publicUrl, date: date || new Date().toISOString().slice(0, 10), note: note || "", path: storagePath, uploadedAt: new Date().toISOString() });
      await docRef.set({ photos }, { merge: true });

      return res.json({ success: true, url: publicUrl, photosCount: photos.length });
    } catch (err) {
      console.error("Erreur upload photo:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Recommandation Claude AI
// =============================================
// Helper: Récupérer météo Open-Meteo (Agadir, Maroc — gratuit, sans clé)
async function getMeteo() {
  const https = require("https");
  return new Promise((resolve) => {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=30.42&longitude=-9.60&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&current_weather=true&timezone=Africa/Casablanca&forecast_days=4";
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

exports.recommandation = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST uniquement" });
    try {
      const { parcelle, stade, culture, fertigationData, photoUrl, customPrompt } = req.body;
      if (!parcelle) return res.status(400).json({ success: false, error: "parcelle requise" });

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.json({
          success: true,
          recommandation: {
            date: new Date().toISOString().slice(0, 10),
            stade: stade || "N/A",
            message: "⚠️ Clé API Anthropic non configurée. Ajoutez ANTHROPIC_API_KEY dans functions/.env puis redéployez.",
            source: "error"
          }
        });
      }

      // 1) Météo
      const meteo = await getMeteo();
      let meteoText = "Météo non disponible.";
      if (meteo && meteo.daily) {
        const d = meteo.daily;
        meteoText = "Météo Agadir (aujourd'hui + 3 jours):\n";
        for (let i = 0; i < Math.min(4, d.time.length); i++) {
          meteoText += `${d.time[i]}: ${d.temperature_2m_min[i]}–${d.temperature_2m_max[i]}°C, pluie ${d.precipitation_sum[i]}mm, vent ${d.windspeed_10m_max[i]}km/h\n`;
        }
        if (meteo.current_weather) {
          meteoText += `Actuellement: ${meteo.current_weather.temperature}°C, vent ${meteo.current_weather.windspeed}km/h`;
        }
      }

      // 2) Construire le prompt
      const STADE_LABELS = {
        enracinement: "Enracinement", cannes_20: "Cannes de 20cm", cannes_50: "Cannes de 50cm",
        cannes_100: "Cannes de 1m", differenciation: "Différenciation", floraison: "Floraison", fructification: "Fructification"
      };

      const DEFAULT_PROMPT_TEMPLATE = `Tu es un ingénieur agronome expert en cultures de petits fruits rouges (myrtilles, framboises) et avocatiers au Maroc (région d'Agadir / Souss-Massa).

En te basant sur ces informations, fournis une recommandation agronomique concise et actionnable:
1. **État de la culture**: Analyse de l'état végétatif basé sur le stade et la photo si disponible
2. **Fertigation**: Ajustements recommandés du programme en cours (N, P, K, Ca, Mg, oligo-éléments)
3. **Protection phytosanitaire**: Risques identifiés vu la météo et le stade (maladies fongiques, ravageurs)
4. **Actions prioritaires**: 2-3 actions concrètes pour les 7 prochains jours

Réponds en français, de manière structurée et concise. Utilise des données chiffrées quand possible.`;

      const promptTemplate = customPrompt || DEFAULT_PROMPT_TEMPLATE;

      // Construire le contexte données (toujours injecté automatiquement)
      const dataContext = `PARCELLE: ${parcelle}
CULTURE: ${culture || "Non spécifiée"}
STADE PHÉNOLOGIQUE ACTUEL: ${STADE_LABELS[stade] || stade || "Non défini"}

${meteoText}

${fertigationData ? "PROGRAMME DE FERTIGATION RÉCENT:\n" + fertigationData : "Programme de fertigation non fourni."}

${photoUrl ? "Une photo de la parcelle est jointe pour analyse visuelle." : "Pas de photo disponible."}`;

      const prompt = promptTemplate + "\n\n--- DONNÉES ---\n" + dataContext;

      // 3) Appeler Claude API
      const Anthropic = require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });

      const messageContent = [];

      // Ajouter la photo si disponible
      if (photoUrl) {
        try {
          const imgResp = await new Promise((resolve, reject) => {
            const https = require("https");
            https.get(photoUrl, (resp) => {
              const chunks = [];
              resp.on("data", (c) => chunks.push(c));
              resp.on("end", () => resolve({ data: Buffer.concat(chunks), type: resp.headers["content-type"] }));
            }).on("error", reject);
          });
          const base64 = imgResp.data.toString("base64");
          const mediaType = imgResp.type || "image/jpeg";
          messageContent.push({
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 }
          });
        } catch (imgErr) {
          console.error("Erreur chargement image:", imgErr.message);
        }
      }

      messageContent.push({ type: "text", text: prompt });

      let response;
      const models = ["claude-opus-4-20250514", "claude-sonnet-4-20250514"];
      for (const modelId of models) {
        try {
          console.log("Essai modèle:", modelId);
          response = await client.messages.create({
            model: modelId,
            max_tokens: 2000,
            messages: [{ role: "user", content: messageContent }]
          });
          console.log("Succès avec:", modelId);
          break;
        } catch (modelErr) {
          console.error("Erreur modèle " + modelId + ":", modelErr.status, modelErr.message);
          if (modelId === models[models.length - 1]) throw modelErr;
        }
      }

      const recoMessage = response.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("\n");

      const reco = {
        date: new Date().toISOString().slice(0, 10),
        timestamp: new Date().toISOString(),
        stade: STADE_LABELS[stade] || stade || "N/A",
        message: recoMessage,
        source: "claude",
        meteo: meteoText,
        hasPhoto: !!photoUrl,
        photoUrl: photoUrl || null,
        fertigationData: fertigationData || null,
        culture: culture || null,
        promptUsed: promptTemplate,
        model: response.model || "claude"
      };

      // Sauvegarder dans Firestore — lastReco + historique
      const recoDocId = parcelle.replace(/\//g, '_SLASH_').replace(/\s+/g, ' ').trim();
      const docRef = db_firestore.collection(COLLECTION).doc(recoDocId);
      const existing = await docRef.get();
      const existingData = existing.exists ? existing.data() : {};
      const history = existingData.recoHistory || [];
      history.push(reco);
      // Garder max 20 dernières recommandations
      if (history.length > 20) history.splice(0, history.length - 20);
      await docRef.set({ lastReco: reco, recoHistory: history }, { merge: true });

      return res.json({ success: true, recommandation: reco });
    } catch (err) {
      console.error("Erreur recommandation:", err.status, err.message, err.error || '');
      res.status(500).json({ success: false, error: err.message, detail: err.status ? ("API " + err.status + ": " + (err.error && err.error.message || err.message)) : err.message });
    }
  });

// =============================================
// API: FarmRoad — Climate measurements
// =============================================
// Helper: HTTPS GET with headers, returns parsed JSON
function farmroadFetch(path) {
  const https = require("https");
  const apiKey = process.env.FARMROAD_API_KEY;
  const baseUrl = "https://developer.farmroad.io/api";
  return new Promise((resolve, reject) => {
    const url = baseUrl + path;
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: "GET",
      headers: { "x-api-key": apiKey },
    };
    https.request(options, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error("Invalid JSON from FarmRoad: " + data.slice(0, 200))); }
      });
    }).on("error", reject).end();
  });
}

// Helper: Download a URL and return its text content
function downloadUrl(url) {
  const https = require("https");
  return new Promise((resolve, reject) => {
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

// Helper: Fetch all pages from a paginated FarmRoad endpoint
async function farmroadFetchAllPages(basePath, contentKey) {
  const key = contentKey || "content";
  let allItems = [];
  let page = 0;
  const MAX_PAGES = 20;
  while (page < MAX_PAGES) {
    const sep = basePath.includes("?") ? "&" : "?";
    const data = await farmroadFetch(basePath + sep + "page=" + page);
    const items = data[key] || [];
    allItems = allItems.concat(items);
    console.log("FarmRoad pagination: " + basePath.split("?")[0] + " page=" + page + ", got " + items.length + " items, totalPages=" + data.totalPages + ", last=" + data.last);
    if (data.last === true || data.last === undefined || page + 1 >= (data.totalPages || 1)) break;
    page++;
  }
  return allItems;
}

// =============================================
// FarmRoad — Shared fetch & cache logic
// =============================================
const FARMROAD_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min for today

async function refreshFarmroadCache(dateParam, farmIdFilter) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const isPastDay = dateParam < todayStr;

  // 1) Check Firestore cache
  const cacheRef = db_firestore.collection("farmroad_cache").doc(dateParam);
  const cached = await cacheRef.get();
  if (cached.exists) {
    const cData = cached.data();
    const cacheAge = Date.now() - (cData._cachedAt || 0);
    if (isPastDay || cacheAge < FARMROAD_CACHE_TTL_MS) {
      console.log("FarmRoad cache hit for " + dateParam + (isPastDay ? " (past)" : " (today, age " + Math.round(cacheAge / 1000) + "s)"));
      return { success: true, farms: cData.farms, devices: cData.devices, date: dateParam, lastUpdate: cData.lastUpdate, totalMeasurements: cData.totalMeasurements, cached: true };
    }
  }

  // 2) Fetch farms structure (all pages)
  const farms = await farmroadFetchAllPages("/farms", "content");

  // 3) Calculate time range
  const dayStart = new Date(dateParam + "T00:00:00Z");
  const dayEnd = new Date(dateParam + "T23:59:59Z");
  const now = new Date();
  const effectiveEnd = dayEnd > now ? now : dayEnd;
  const totalHours = Math.ceil((effectiveEnd - dayStart) / 3600000);

  if (totalHours <= 0) {
    return { success: true, farms: Array.isArray(farms) ? farms : [], devices: [], date: dateParam, totalMeasurements: 0 };
  }

  // 4) Fetch ALL hours in parallel (no batching — faster)
  const allMeasurements = [];
  const hourPromises = [];
  for (let h = 0; h < totalHours; h++) {
    const startMs = dayStart.getTime() + h * 3600000;
    const endMs = Math.min(startMs + 3600000, effectiveEnd.getTime());
    const startTime = new Date(startMs).toISOString();
    const endTime = new Date(endMs).toISOString();
    hourPromises.push(
      farmroadFetchAllPages("/measurements?startTime=" + encodeURIComponent(startTime) + "&endTime=" + encodeURIComponent(endTime), "presignedDownloadUrlData")
        .then(async (allUrlData) => {
          const urls = allUrlData.map((d) => d.downloadUrl).filter(Boolean);
          const downloads = await Promise.all(urls.map((u) => downloadUrl(u).catch(() => "")));
          const results = [];
          for (const text of downloads) {
            for (const line of text.split("\n")) {
              if (!line.trim()) continue;
              try {
                const m = JSON.parse(line);
                if (!farmIdFilter || m.farm_id === farmIdFilter) {
                  // Assign 15-min slot based on measurement timestamp
                  const mTime = new Date(m.time || m.timestamp || startTime);
                  const minutesSinceDayStart = (mTime.getTime() - dayStart.getTime()) / 60000;
                  m._slot = Math.floor(minutesSinceDayStart / 15); // 0, 1, 2, ... (96 slots per day)
                  results.push(m);
                }
              } catch (e) { /* skip */ }
            }
          }
          return results;
        })
        .catch((err) => { console.error("FarmRoad hour " + h + " error:", err.message); return []; })
    );
  }
  const allResults = await Promise.all(hourPromises);
  for (const arr of allResults) allMeasurements.push(...arr);

  // Log device summary for debugging
  const deviceIds = [...new Set(allMeasurements.map(m => m.device_identifier || String(m.compartment_id)))];
  console.log("FarmRoad: " + allMeasurements.length + " measurements across " + deviceIds.length + " devices: " + deviceIds.join(", "));

  // 5) Aggregate by device (15-min slots)
  const agg = {};
  const slotData = {};
  const deviceMeta = {};

  for (const m of allMeasurements) {
    const devId = m.device_identifier || String(m.compartment_id) || "unknown";
    const type = m.measurement_type;
    const val = m.measurement_value;
    const slot = m._slot;

    if (!deviceMeta[devId]) deviceMeta[devId] = { compartment_id: m.compartment_id, sector_id: m.sector_id, farm_id: m.farm_id, types: {} };
    deviceMeta[devId].types[type] = true;

    if (!agg[devId]) agg[devId] = {};
    if (!agg[devId][type]) agg[devId][type] = { sum: 0, min: Infinity, max: -Infinity, last: null, lastTime: 0, unit: m.measurement_unit, count: 0 };
    const a = agg[devId][type];
    a.sum += val; a.count++;
    if (val < a.min) a.min = val;
    if (val > a.max) a.max = val;
    if (m.time > a.lastTime) { a.last = val; a.lastTime = m.time; }

    if (!slotData[devId]) slotData[devId] = {};
    if (!slotData[devId][type]) slotData[devId][type] = {};
    if (!slotData[devId][type][slot]) slotData[devId][type][slot] = { sum: 0, min: Infinity, max: -Infinity, count: 0 };
    const s = slotData[devId][type][slot];
    s.sum += val; s.count++;
    if (val < s.min) s.min = val;
    if (val > s.max) s.max = val;
  }

  // 6) Format devices
  const devices = Object.keys(agg).map((devId) => {
    const meta = deviceMeta[devId] || {};
    const hasSubstrate = !!meta.types["SUBSTRATE_MOISTURE_CONTENT"];
    const measObj = {};
    for (const type of Object.keys(agg[devId])) {
      const a = agg[devId][type];
      measObj[type] = { avg: Math.round((a.sum / a.count) * 100) / 100, min: Math.round(a.min * 100) / 100, max: Math.round(a.max * 100) / 100, last: a.last, unit: a.unit, count: a.count };
    }
    const tsObj = {};
    if (slotData[devId]) {
      for (const type of Object.keys(slotData[devId])) {
        const slots = slotData[devId][type];
        tsObj[type] = Object.keys(slots).map(Number).sort((a, b) => a - b).map((sl) => {
          const s = slots[sl];
          const totalMin = sl * 15;
          const hh = Math.floor(totalMin / 60);
          const mm = totalMin % 60;
          const label = hh + ':' + (mm < 10 ? '0' + mm : mm);
          return { hour: label, slot: sl, avg: Math.round((s.sum / s.count) * 100) / 100, min: Math.round(s.min * 100) / 100, max: Math.round(s.max * 100) / 100 };
        });
      }
    }
    return { deviceId: devId, compartmentId: meta.compartment_id, sectorId: meta.sector_id, farmId: meta.farm_id, hasSubstrate, measurements: measObj, timeseries: tsObj };
  });

  const response = {
    success: true,
    farms: Array.isArray(farms) ? farms : [],
    devices,
    date: dateParam,
    lastUpdate: new Date().toISOString(),
    totalMeasurements: allMeasurements.length,
  };

  // 7) Cache in Firestore
  if (devices.length > 0) {
    await cacheRef.set(Object.assign({}, response, { _cachedAt: Date.now() })).catch((e) => console.error("Cache write error:", e.message));
  }

  return response;
}

// =============================================
// FarmRoad — Scheduled refresh every 15 minutes
// =============================================
exports.farmroadRefresh = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .pubsub.schedule("every 15 minutes")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    console.log("FarmRoad scheduled refresh for " + todayStr);
    try {
      const result = await refreshFarmroadCache(todayStr, null);
      console.log("FarmRoad refresh done: " + (result.totalMeasurements || 0) + " measurements, " + (result.devices ? result.devices.length : 0) + " devices");
    } catch (err) {
      console.error("FarmRoad scheduled refresh error:", err.message);
    }
    return null;
  });

// =============================================
// FarmRoad — HTTP endpoint (reads from cache)
// =============================================
exports.farmroad = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const farmIdFilter = req.query.farmId ? parseInt(req.query.farmId) : null;
      const dateParam = req.query.date || new Date().toISOString().slice(0, 10);
      const result = await refreshFarmroadCache(dateParam, farmIdFilter);
      res.json(result);
    } catch (err) {
      console.error("Erreur FarmRoad:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// GDD & IMC — Indice de Maturation Composite
// Maravilla Long Cane | Larache | J0 = 29 mars 2026
// =============================================

const GDD_CONFIG = {
  J0: "2026-03-29",
  VARIETE: "Maravilla Long Cane",
  SERRE: "tunnel_larache",
  TBASE: 5,
  TUPPER: 30,
  GDD_CIBLE: 300, // milieu fourchette 250–350
};

// --- GDD journalier ---
function calcGDD(tmax, tmin, tbase = GDD_CONFIG.TBASE, tupper = GDD_CONFIG.TUPPER) {
  const tmaxCap = Math.min(tmax, tupper);
  const tminCap = Math.min(tmin, tupper);
  return Math.max(0, (tmaxCap + tminCap) / 2 - tbase);
}

// --- Facteurs normalisés (0 à 1) ---
function normGDD(gddCumule, cible = GDD_CONFIG.GDD_CIBLE) {
  return Math.min(gddCumule / cible, 1);
}

function normDIF(tmax, tmin) {
  const dif = tmax - tmin;
  if (dif <= 0) return 0;
  if (dif <= 12) return dif / 12;
  if (dif <= 18) return 1;
  return Math.max(0, 1 - (dif - 18) / 10);
}

function normDLI(dli) {
  if (!dli) return 0.8; // valeur par défaut Larache printemps
  if (dli < 12) return dli / 12;
  if (dli <= 25) return 1;
  return Math.max(0.6, 1 - (dli - 25) / 30);
}

// --- Facteurs de stress ---
function calcVPDFromTH(tair, hr) {
  const esat = 0.6108 * Math.exp((17.27 * tair) / (tair + 237.3));
  return esat * (1 - hr / 100);
}

function stressVPD(vpd) {
  if (vpd <= 1.2) return 0;
  if (vpd <= 2.0) return (vpd - 1.2) / 0.8;
  return 1;
}

function stressTemperature(tmax) {
  if (tmax <= 28) return 0;
  if (tmax <= 32) return (tmax - 28) / 4;
  return 1;
}

// --- Pondérations IMC ---
const POIDS_IMC = {
  alpha: 0.50,   // GDD — moteur principal
  beta: 0.20,    // DIF — qualité sucre/couleur
  gamma: 0.15,   // DLI — photosynthèse
  delta: 0.10,   // stress VPD
  epsilon: 0.05, // stress chaleur
};

function calcIMC({ gddCumule, tmax, tmin, hr, dli }) {
  const vpd = calcVPDFromTH((tmax + tmin) / 2, hr);
  const composante_positive =
    POIDS_IMC.alpha * normGDD(gddCumule) +
    POIDS_IMC.beta * normDIF(tmax, tmin) +
    POIDS_IMC.gamma * normDLI(dli);
  const composante_stress =
    POIDS_IMC.delta * stressVPD(vpd) +
    POIDS_IMC.epsilon * stressTemperature(tmax);
  const imc = Math.max(0, Math.min(1, composante_positive - composante_stress));
  return {
    imc: parseFloat(imc.toFixed(3)),
    pourcentage: Math.round(imc * 100),
    vpd: parseFloat(vpd.toFixed(2)),
    stressVPD: parseFloat(stressVPD(vpd).toFixed(2)),
    stressThermal: parseFloat(stressTemperature(tmax).toFixed(2)),
    alerte: imc >= 0.85 ? "RECOLTE_IMMINENTE" :
            imc >= 0.70 ? "SURVEILLER_J3" :
            imc >= 0.50 ? "EN_COURS" : "PRECOCE",
  };
}

// =============================================
// GDD Nightly Job — runs at 23:00 Africa/Casablanca
// =============================================
exports.gddNightlyJob = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .pubsub.schedule("0 23 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    console.log("GDD nightly job for", todayStr);

    // Skip if before J0
    if (todayStr < GDD_CONFIG.J0) {
      console.log("Before J0, skipping");
      return null;
    }

    try {
      // 1. Get FarmRoad data
      const farmroadData = await refreshFarmroadCache(todayStr, null);
      if (!farmroadData || !farmroadData.devices || farmroadData.devices.length === 0) {
        console.error("GDD: No FarmRoad data available for", todayStr);
        return null;
      }

      // 2. Select sensor with lowest CO2 (better ventilated tunnel)
      const serreDevices = farmroadData.devices.filter(d => d.hasSubstrate);
      const devicesToUse = serreDevices.length > 0 ? serreDevices : farmroadData.devices;

      let bestDevice = null;
      let lowestCO2 = Infinity;
      for (const dev of devicesToUse) {
        const co2 = dev.measurements && dev.measurements.CO2_LEVEL ? dev.measurements.CO2_LEVEL.avg : Infinity;
        if (co2 < lowestCO2) {
          lowestCO2 = co2;
          bestDevice = dev;
        }
      }
      if (!bestDevice) {
        console.error("GDD: No suitable device found");
        return null;
      }

      const m = bestDevice.measurements || {};
      const tmax = m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.max : null;
      const tmin = m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.min : null;
      const hr = m.RH_INSIDE ? m.RH_INSIDE.avg : 70;
      const parAvg = m.PAR_INTENSITY ? m.PAR_INTENSITY.avg : 0;
      const parCount = m.PAR_INTENSITY ? m.PAR_INTENSITY.count : 0;
      const dli = parCount > 0 ? Math.round(parAvg * 3600 * 12 / 1e6 * 100) / 100 : null;

      if (tmax === null || tmin === null) {
        console.error("GDD: Missing temperature data from device", bestDevice.deviceId);
        return null;
      }

      // 3. Get previous day's cumulative GDD
      let gddCumulePrev = 0;
      const yesterdayDate = new Date(todayStr);
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

      if (yesterdayStr >= GDD_CONFIG.J0) {
        const prevDoc = await db_firestore.collection("gdd_tracking").doc(yesterdayStr).get();
        if (prevDoc.exists) {
          gddCumulePrev = prevDoc.data().gdd_cumule || 0;
        }
      }

      // 4. Calculate GDD + IMC
      const gddJour = Math.round(calcGDD(tmax, tmin) * 100) / 100;
      const gddCumule = Math.round((gddCumulePrev + gddJour) * 100) / 100;
      const imcResult = calcIMC({ gddCumule, tmax, tmin, hr, dli });

      // 5. Save to Firestore
      const doc = {
        date: todayStr,
        tmax: Math.round(tmax * 100) / 100,
        tmin: Math.round(tmin * 100) / 100,
        gdd_jour: gddJour,
        gdd_cumule: gddCumule,
        hr_moyenne: Math.round(hr * 100) / 100,
        dli: dli,
        imc: imcResult.imc,
        imc_pourcentage: imcResult.pourcentage,
        vpd: imcResult.vpd,
        stress_vpd: imcResult.stressVPD,
        stress_thermal: imcResult.stressThermal,
        alerte: imcResult.alerte,
        capteur_id: bestDevice.deviceId || bestDevice.compartmentId || "unknown",
        variete: GDD_CONFIG.VARIETE,
        j0: GDD_CONFIG.J0,
        serre: GDD_CONFIG.SERRE,
        _createdAt: Date.now(),
      };

      await db_firestore.collection("gdd_tracking").doc(todayStr).set(doc);
      console.log("GDD saved:", todayStr, "GDD_jour:", gddJour, "GDD_cumule:", gddCumule, "IMC:", imcResult.pourcentage + "%", "Alerte:", imcResult.alerte);

      // 6. Notification si récolte imminente (placeholder — WhatsApp à intégrer)
      if (imcResult.alerte === "RECOLTE_IMMINENTE") {
        console.log("🚨 RECOLTE_IMMINENTE — GDD cumulés:", gddCumule, "/ IMC:", imcResult.pourcentage + "%");
        // TODO: Intégrer WhatsApp Cloud API notification ici
      }

      return null;
    } catch (err) {
      console.error("GDD nightly job error:", err.message);
      return null;
    }
  });

// =============================================
// GDD Tracking — HTTP endpoint
// =============================================
exports.gddTracking = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const snapshot = await db_firestore.collection("gdd_tracking")
        .orderBy("date", "asc")
        .get();

      const data = [];
      snapshot.forEach(doc => data.push(doc.data()));

      if (data.length === 0) {
        return res.json({ success: true, data: [], gddCumule: 0, imcActuel: null, joursDepuisJ0: 0, jourRecolteEstime: null });
      }

      const latest = data[data.length - 1];
      const joursDepuisJ0 = data.length;
      const gddMoyenJour = latest.gdd_cumule / joursDepuisJ0;

      // Estimation date récolte
      let jourRecolteEstime = null;
      if (gddMoyenJour > 0 && latest.gdd_cumule < GDD_CONFIG.GDD_CIBLE) {
        const joursRestants = Math.ceil((GDD_CONFIG.GDD_CIBLE - latest.gdd_cumule) / gddMoyenJour);
        const dateEstimee = new Date(latest.date);
        dateEstimee.setDate(dateEstimee.getDate() + joursRestants);
        jourRecolteEstime = dateEstimee.toISOString().slice(0, 10);
      }

      res.json({
        success: true,
        data,
        gddCumule: latest.gdd_cumule,
        imcActuel: {
          imc: latest.imc,
          pourcentage: latest.imc_pourcentage,
          alerte: latest.alerte,
          vpd: latest.vpd,
          stress_vpd: latest.stress_vpd,
          stress_thermal: latest.stress_thermal,
        },
        joursDepuisJ0,
        gddMoyenJour: Math.round(gddMoyenJour * 100) / 100,
        jourRecolteEstime,
        config: {
          j0: GDD_CONFIG.J0,
          gddCible: GDD_CONFIG.GDD_CIBLE,
          variete: GDD_CONFIG.VARIETE,
        },
      });
    } catch (err) {
      console.error("GDD tracking error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// Harvest Prediction — Helpers
// =============================================

// Helper: Open-Meteo forecast for Laouamra (35.08°N, 6.14°W)
async function getMeteoLaouamra() {
  const https = require("https");
  return new Promise((resolve) => {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=35.08&longitude=-6.14&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration,relative_humidity_2m_max&timezone=Africa/Casablanca&forecast_days=7";
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

// Helper: Aggregate FarmRoad serre data for a date, fallback to Open-Meteo + delta
async function aggregateSerreData(dateStr) {
  // Check Firestore cache first
  const cacheRef = db_firestore.collection("farms").doc("larache").collection("serre_data").doc(dateStr);
  const cached = await cacheRef.get();
  const todayStr = new Date().toISOString().slice(0, 10);
  const isPast = dateStr < todayStr;
  if (cached.exists) {
    const d = cached.data();
    if (isPast || (Date.now() - (d._cachedAt || 0)) < FARMROAD_CACHE_TTL_MS) return d;
  }

  // Try FarmRoad
  try {
    const farmroadCacheRef = db_firestore.collection("farmroad_cache").doc(dateStr);
    let farmroadData = null;
    const snap = await farmroadCacheRef.get();
    if (snap.exists) {
      farmroadData = snap.data();
    } else {
      // Fetch live — reuse the same logic as the farmroad endpoint
      await farmroadFetch("/farms?page=0"); // validate API connectivity
      const dayStart = new Date(dateStr + "T00:00:00Z");
      const dayEnd = new Date(dateStr + "T23:59:59Z");
      const now = new Date();
      const effectiveEnd = dayEnd > now ? now : dayEnd;
      const totalHours = Math.ceil((effectiveEnd - dayStart) / 3600000);
      if (totalHours > 0) {
        const allMeasurements = [];
        const hourPromises = [];
        for (let h = 0; h < totalHours; h++) {
          const startMs = dayStart.getTime() + h * 3600000;
          const endMs = Math.min(startMs + 3600000, effectiveEnd.getTime());
          hourPromises.push(
            farmroadFetchAllPages("/measurements?startTime=" + encodeURIComponent(new Date(startMs).toISOString()) + "&endTime=" + encodeURIComponent(new Date(endMs).toISOString()), "presignedDownloadUrlData")
              .then(async (allUrlData) => {
                const urls = allUrlData.map((d) => d.downloadUrl).filter(Boolean);
                const downloads = await Promise.all(urls.map((u) => downloadUrl(u).catch(() => "")));
                const results = [];
                for (const text of downloads) {
                  for (const line of text.split("\n")) {
                    if (!line.trim()) continue;
                    try { results.push(JSON.parse(line)); } catch (e) { /* skip */ }
                  }
                }
                return results;
              }).catch(() => [])
          );
        }
        const allResults = await Promise.all(hourPromises);
        for (const arr of allResults) allMeasurements.push(...arr);
        farmroadData = { measurements: allMeasurements };
      }
    }

    if (farmroadData) {
      // Extract from cached farmroad data (devices array) or raw measurements
      let T_max = -Infinity, T_min = Infinity, HR_sum = 0, HR_count = 0, PAR_sum = 0, PAR_count = 0, RAD_sum = 0, RAD_count = 0;
      let hourlyHR = {};

      if (farmroadData.devices) {
        // From cached farmroad response — only use greenhouse device (hasSubstrate=true)
        const serreDevices = farmroadData.devices.filter(d => d.hasSubstrate);
        const devicesToUse = serreDevices.length > 0 ? serreDevices : farmroadData.devices;
        for (const dev of devicesToUse) {
          const m = dev.measurements || {};
          if (m.TEMPERATURE_INSIDE) {
            if (m.TEMPERATURE_INSIDE.max > T_max) T_max = m.TEMPERATURE_INSIDE.max;
            if (m.TEMPERATURE_INSIDE.min < T_min) T_min = m.TEMPERATURE_INSIDE.min;
          }
          if (m.RH_INSIDE) { HR_sum += m.RH_INSIDE.avg; HR_count++; }
          if (m.PAR_INTENSITY) { PAR_sum += m.PAR_INTENSITY.avg * m.PAR_INTENSITY.count; PAR_count += m.PAR_INTENSITY.count; }
          if (m.RADIATION_INTENSITY_INSIDE) { RAD_sum += m.RADIATION_INTENSITY_INSIDE.avg * m.RADIATION_INTENSITY_INSIDE.count; RAD_count += m.RADIATION_INTENSITY_INSIDE.count; }
          // Hourly HR for alerts
          const ts = dev.timeseries || {};
          if (ts.RH_INSIDE) {
            for (const h of ts.RH_INSIDE) {
              if (!hourlyHR[h.hour]) hourlyHR[h.hour] = [];
              hourlyHR[h.hour].push(h.avg);
            }
          }
        }
      } else if (farmroadData.measurements) {
        // From raw measurements
        for (const m of farmroadData.measurements) {
          const val = m.measurement_value;
          if (m.measurement_type === "TEMPERATURE_INSIDE") { if (val > T_max) T_max = val; if (val < T_min) T_min = val; }
          if (m.measurement_type === "RH_INSIDE") { HR_sum += val; HR_count++; }
          if (m.measurement_type === "PAR_INTENSITY") { PAR_sum += val; PAR_count++; }
          if (m.measurement_type === "RADIATION_INTENSITY_INSIDE") { RAD_sum += val; RAD_count++; }
        }
      }

      if (T_max > -Infinity && T_min < Infinity) {
        // PAR: convert from µmol/m²/s average to mol/m²/day (avg × seconds_in_day / 1e6)
        const PAR_avg = PAR_count > 0 ? PAR_sum / PAR_count : 0;
        const PAR_mol = PAR_avg * 3600 * 12 / 1e6; // ~12h daylight
        const result = {
          date: dateStr,
          T_max_serre: Math.round(T_max * 100) / 100,
          T_min_serre: Math.round(T_min * 100) / 100,
          HR_moyenne: HR_count > 0 ? Math.round((HR_sum / HR_count) * 100) / 100 : null,
          PAR_sum: Math.round(PAR_mol * 100) / 100,
          RAD_sum: RAD_count > 0 ? Math.round((RAD_sum / RAD_count) * 100) / 100 : null,
          hourlyHR,
          source: "farmroad",
          _cachedAt: Date.now(),
        };
        cacheRef.set(result).catch(() => {});
        return result;
      }
    }
  } catch (e) {
    console.error("FarmRoad aggregation error for " + dateStr + ":", e.message);
  }

  // Fallback: Open-Meteo + delta T° +4°C
  const meteo = await getMeteoLaouamra();
  if (meteo && meteo.daily) {
    const idx = (meteo.daily.time || []).indexOf(dateStr);
    if (idx >= 0) {
      const d = meteo.daily;
      const result = {
        date: dateStr,
        T_max_serre: d.temperature_2m_max[idx] + 4,
        T_min_serre: d.temperature_2m_min[idx] + 4,
        HR_moyenne: d.relative_humidity_2m_max[idx] || 80,
        PAR_sum: d.sunshine_duration[idx] ? Math.round((d.sunshine_duration[idx] / 3600) * 1.2 * 100) / 100 : 10,
        RAD_sum: null,
        hourlyHR: {},
        source: "openmeteo_fallback",
        _cachedAt: Date.now(),
      };
      cacheRef.set(result).catch(() => {});
      return result;
    }
  }
  return null;
}

// Helper: Compute weather adjustment factor (attenuated — ±15% max)
// Weather modulates around 1.0, never dominates the prediction
function computeWeatherFactor(serreData, gddRef) {
  if (!serreData) return { GDD: 0, facteur_HR: 1, facteur_PAR: 1, gddRatio: 1, weatherFactor: 1, rawFactor: 1 };
  const T_avg = (serreData.T_max_serre + serreData.T_min_serre) / 2;
  const GDD = Math.max(0, T_avg - 7);

  // Facteur humidité — attenuated (±5% max)
  const hr = serreData.HR_moyenne || 80;
  let facteur_HR = 1.0;
  if (hr < 75) facteur_HR = 1.03;
  else if (hr <= 85) facteur_HR = 1.00;
  else if (hr <= 92) facteur_HR = 0.97;
  else facteur_HR = 0.93;

  // Facteur PAR — attenuated (±5% max)
  const par = serreData.PAR_sum || 10;
  let facteur_PAR = 1.0;
  if (par > 15) facteur_PAR = 1.05;
  else if (par >= 8) facteur_PAR = 1.00;
  else facteur_PAR = 0.95;

  // GDD ratio — damped toward 1.0 (50% dampening)
  const rawGddRatio = gddRef > 0 ? GDD / gddRef : 1;
  const gddRatio = 1 + (rawGddRatio - 1) * 0.5; // dampened

  const rawFactor = gddRatio * facteur_HR * facteur_PAR;
  // Clamp total weather factor to [0.85, 1.15]
  const weatherFactor = Math.max(0.85, Math.min(1.15, rawFactor));

  return {
    GDD: Math.round(GDD * 100) / 100,
    facteur_HR, facteur_PAR,
    gddRatio: Math.round(gddRatio * 100) / 100,
    rawFactor: Math.round(rawFactor * 1000) / 1000,
    weatherFactor: Math.round(weatherFactor * 1000) / 1000,
  };
}

// Legacy alias for backward compat with explanation builder
function computeMaturationCoeff(serreData, gddRef) {
  const wf = computeWeatherFactor(serreData, gddRef);
  return { GDD: wf.GDD, facteur_HR: wf.facteur_HR, facteur_PAR: wf.facteur_PAR, gddRatio: wf.gddRatio, rawCoeff: wf.rawFactor, coeff: wf.weatherFactor };
}

// Auto-calibration: EMA of prediction error ratio, clamped to [-0.3, +0.3]
// Compares past predictions stored in Firestore to actual SQL harvest
async function computeCalibrationOffset(harvestActuals, todayStr, todayIsComplete) {
  let calibrationOffset = 0;
  try {
    const predsSnap = await db_firestore.collection("farms").doc("larache").collection("harvest_predictions")
      .orderBy("date", "desc").limit(10).get();
    let emaOffset = 0;
    const alpha = 0.3;
    let count = 0;
    for (const doc of predsSnap.docs) {
      const pred = doc.data();
      const d = pred.date;
      // Only calibrate on complete days
      if (d >= todayStr && !(d === todayStr && todayIsComplete)) continue;
      const actual = harvestActuals[d];
      if (actual && pred.predicted_kg && actual.total > 0 && pred.predicted_kg > 0) {
        const errorRatio = (actual.total - pred.predicted_kg) / actual.total;
        emaOffset = alpha * errorRatio + (1 - alpha) * emaOffset;
        count++;
      }
    }
    if (count > 0) calibrationOffset = Math.max(-0.3, Math.min(0.3, emaOffset));
  } catch (e) { /* use 0 */ }
  return calibrationOffset;
}

// Helper: Generate alerts from serre data and weather forecast
function generateAlerts(serreData, weatherForecast) {
  const alerts = [];
  if (!serreData) return alerts;

  // Alert 1: Botrytis — HR > 90% pendant 3h consécutives
  const hourlyHR = serreData.hourlyHR || {};
  const hours = Object.keys(hourlyHR).map(Number).sort((a, b) => a - b);
  let consecutiveHigh = 0;
  for (const h of hours) {
    const hrArr = hourlyHR[h];
    if (!Array.isArray(hrArr) || hrArr.length === 0) continue;
    const avgHR = hrArr.reduce((s, v) => s + v, 0) / hrArr.length;
    if (avgHR > 90) {
      consecutiveHigh++;
      if (consecutiveHigh >= 3) {
        alerts.push({ type: "botrytis", severity: "warning", icon: "fa-droplet", message: "Risque botrytis — HR serre > 90% pendant 3h+ — aérer tunnels" });
        break;
      }
    } else {
      consecutiveHigh = 0;
    }
  }

  // Alert 2: Coup de chaleur — T° serre > 28°C en journée
  if (serreData.T_max_serre > 28) {
    alerts.push({ type: "chaleur", severity: "danger", icon: "fa-temperature-high", message: "Coup de chaleur — T° serre " + serreData.T_max_serre + "°C — récolter tôt demain" });
  }

  // Alert 3: Pluie J+1 > 10mm
  if (weatherForecast && weatherForecast.daily) {
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const idx = (weatherForecast.daily.time || []).indexOf(tomorrowStr);
    if (idx >= 0 && weatherForecast.daily.precipitation_sum[idx] > 10) {
      alerts.push({ type: "pluie", severity: "warning", icon: "fa-cloud-rain", message: "Pluie prévue J+1 (" + weatherForecast.daily.precipitation_sum[idx] + "mm) — anticiper récolte cet après-midi" });
    }
  }

  return alerts;
}

// =============================================
// API: Harvest Weather — Open-Meteo Laouamra
// =============================================
exports.harvestWeather = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const data = await withCache("harvest_weather_laouamra", 3 * 3600 * 1000, async () => {
        const meteo = await getMeteoLaouamra();
        if (!meteo || !meteo.daily) throw new Error("Open-Meteo indisponible");
        // Also store in farms/larache/weather_forecast
        db_firestore.collection("farms").doc("larache").collection("weather_forecast").doc("current").set({
          ...meteo.daily,
          _cachedAt: Date.now(),
        }).catch(() => {});
        return meteo;
      });
      res.json({ success: true, ...data });
    } catch (err) {
      console.error("Erreur harvestWeather:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Harvest Prediction — Main endpoint
// =============================================
exports.harvestPrediction = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const todayStr = new Date().toISOString().slice(0, 10);

      // 1) Fetch harvest from BR_Cueillette (Firestore mirror or SQL fallback)
      const varietyFilter = req.query.variete || null;
      const HISTORY_DAYS = 14;
      const harvestActuals = {};
      const allVarieties = new Set();
      try {
        const startDate = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
        let cueilletteData;
        if (USE_MIRROR) {
          cueilletteData = await getCueilletteRows(startDate, todayStr);
          cueilletteData = cueilletteData
            .filter(r => r.Operation_Famille === "8. Récolte")
            .filter(r => !varietyFilter || (r.Variete || "").includes(varietyFilter))
            .map(r => ({ dateStr: r.DateStr, Variete: r.Variete, totalKg: r.Poids_total_kg || 0 }));
        } else {
          const pool = await sql.connect(sqlConfig);
          const varietyClause = varietyFilter ? ` AND Variete LIKE N'%${varietyFilter.replace(/'/g, "''")}%'` : "";
          const result = await pool.request().query(`
            SELECT CONVERT(varchar(10), Periode_Date, 23) AS dateStr, Variete,
                   SUM(Poids_total_kg) AS totalKg, SUM(Nbre_Caisse) AS totalCaisses
            FROM BR_Cueillette
            WHERE CONVERT(date, Periode_Date) >= '${startDate}' AND Operation_Famille = N'8. Récolte'${varietyClause}
            GROUP BY CONVERT(varchar(10), Periode_Date, 23), Variete
            ORDER BY dateStr DESC, totalKg DESC`);
          cueilletteData = (result.recordset || []).map(r => ({ dateStr: r.dateStr, Variete: r.Variete, totalKg: r.totalKg || 0 }));
        }
        for (const r of cueilletteData) {
          const ds = r.dateStr;
          const vName = (r.Variete || "Autre").trim();
          if (!harvestActuals[ds]) harvestActuals[ds] = { total: 0, byVariety: {} };
          const kg = Math.round((r.totalKg || 0) * 10) / 10;
          harvestActuals[ds].total += kg;
          harvestActuals[ds].byVariety[vName] = (harvestActuals[ds].byVariety[vName] || 0) + kg;
          if (kg > 0) allVarieties.add(vName);
        }
      } catch (sqlErr) {
        console.error("Harvest data error:", sqlErr.message);
      }

      // 2) Aggregate serre data for last 10 days + today (enough for GDD ref + recent training)
      const serreDataByDate = {};
      const serrePromises = [];
      for (let i = 0; i < 11; i++) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toISOString().slice(0, 10);
        serrePromises.push(aggregateSerreData(dateStr).then(data => { if (data) serreDataByDate[dateStr] = data; }));
      }
      await Promise.all(serrePromises);

      // 3) Compute GDD reference (7-day moving average)
      const gddValues = [];
      for (let i = 1; i <= 7; i++) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toISOString().slice(0, 10);
        const sd = serreDataByDate[dateStr];
        if (sd) {
          const gdd = Math.max(0, ((sd.T_max_serre + sd.T_min_serre) / 2) - 7);
          gddValues.push(gdd);
        }
      }
      const gddRef = gddValues.length > 0 ? gddValues.reduce((s, v) => s + v, 0) / gddValues.length : 8.0;

      // 4) Weather forecast + calibration offset (EMA)
      const nowHour = new Date().getHours();
      const todayIsComplete = nowHour >= 20;
      const weatherForecast = await getMeteoLaouamra();
      const calibrationOffset = await computeCalibrationOffset(harvestActuals, todayStr, todayIsComplete);

      // 5) Compute coefficients (simple discrete model + calibration)
      const todaySerre = serreDataByDate[todayStr];
      const coeffToday = computeMaturationCoeff(todaySerre, gddRef);
      // Apply calibration: adjusted coeff = raw × (1 + offset)
      coeffToday.coeff = Math.round(coeffToday.rawCoeff * (1 + calibrationOffset) * 1000) / 1000;

      // For J+1, J+2, J+3: use Open-Meteo forecast + delta +4°C for serre simulation
      const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      const dayAfterStr = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      const j3Str = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
      let coeffTomorrow = { GDD: 0, facteur_HR: 1, facteur_PAR: 1, coeff: 1, rawCoeff: 1 };
      let coeffDayAfter = { GDD: 0, facteur_HR: 1, facteur_PAR: 1, coeff: 1, rawCoeff: 1 };
      let coeffJ3 = { GDD: 0, facteur_HR: 1, facteur_PAR: 1, coeff: 1, rawCoeff: 1 };

      // Helper to build serre estimate from Open-Meteo forecast index
      function serreFromForecast(wf, idx) {
        return {
          T_max_serre: wf.temperature_2m_max[idx] + 4,
          T_min_serre: wf.temperature_2m_min[idx] + 4,
          HR_moyenne: wf.relative_humidity_2m_max[idx] || 80,
          PAR_sum: wf.sunshine_duration[idx] ? Math.round((wf.sunshine_duration[idx] / 3600) * 1.2 * 100) / 100 : 10,
        };
      }

      if (weatherForecast && weatherForecast.daily) {
        const wf = weatherForecast.daily;
        const applyCalib = (c) => { c.coeff = Math.round(c.rawCoeff * (1 + calibrationOffset) * 1000) / 1000; return c; };

        const idxTom = (wf.time || []).indexOf(tomorrowStr);
        if (idxTom >= 0) coeffTomorrow = applyCalib(computeMaturationCoeff(serreFromForecast(wf, idxTom), gddRef));

        const idxDA = (wf.time || []).indexOf(dayAfterStr);
        if (idxDA >= 0) coeffDayAfter = applyCalib(computeMaturationCoeff(serreFromForecast(wf, idxDA), gddRef));

        const idxJ3 = (wf.time || []).indexOf(j3Str);
        if (idxJ3 >= 0) coeffJ3 = applyCalib(computeMaturationCoeff(serreFromForecast(wf, idxJ3), gddRef));
      }

      // 6) Find most recent COMPLETE actual harvest
      // Today's data is partial (expeditions arrive throughout the day) — only final after 20h
      const completeDates = Object.keys(harvestActuals)
        .filter(d => d < todayStr || (d === todayStr && todayIsComplete))
        .sort().reverse();
      const lastActualDate = completeDates[0] || null;
      const lastActualKg = lastActualDate ? harvestActuals[lastActualDate].total : null;
      // Also expose today's partial data separately for display
      const todayPartial = (!todayIsComplete && harvestActuals[todayStr]) ? harvestActuals[todayStr] : null;

      // 7) NEW MODEL — Moving average base + day-of-week pattern + attenuated weather
      // Step A: Compute 5-day moving average as stable baseline
      const recentComplete = completeDates.slice(0, 7).map(d => ({ date: d, kg: harvestActuals[d].total, dow: new Date(d + "T12:00:00Z").getDay() }));
      const ma5Values = recentComplete.slice(0, 5).map(r => r.kg);
      const ma5 = ma5Values.length > 0 ? ma5Values.reduce((s, v) => s + v, 0) / ma5Values.length : null;

      // Step B: Day-of-week factor — detect if certain days consistently differ
      // Group all actuals by day-of-week, compute ratio to overall mean
      const dowTotals = {}; // { 0: [kg, kg], 1: [...], ... }
      const allCompleteKgs = [];
      for (const d of completeDates.slice(0, 14)) {
        const kg = harvestActuals[d].total;
        const dow = new Date(d + "T12:00:00Z").getDay();
        if (!dowTotals[dow]) dowTotals[dow] = [];
        dowTotals[dow].push(kg);
        allCompleteKgs.push(kg);
      }
      const overallMean = allCompleteKgs.length > 0 ? allCompleteKgs.reduce((s, v) => s + v, 0) / allCompleteKgs.length : 1;
      // Compute day-of-week factor, dampened and clamped to [0.85, 1.15]
      function getDowFactor(targetDate) {
        const dow = new Date(targetDate + "T12:00:00Z").getDay();
        if (!dowTotals[dow] || dowTotals[dow].length < 2 || overallMean <= 0) return 1.0;
        const dowMean = dowTotals[dow].reduce((s, v) => s + v, 0) / dowTotals[dow].length;
        const rawRatio = dowMean / overallMean;
        // Dampen: move only 50% toward observed ratio
        return Math.max(0.85, Math.min(1.15, 1 + (rawRatio - 1) * 0.5));
      }

      // Step C: Per-variety predictions — MA5 per variety × dowFactor × weatherFactor
      // Build per-variety history: { "MARAVILLA GC": { "2026-03-23": 500, ... }, ... }
      const varietyHistory = {};
      for (const d of completeDates) {
        const bv = harvestActuals[d].byVariety || {};
        for (const [v, kg] of Object.entries(bv)) {
          if (!varietyHistory[v]) varietyHistory[v] = {};
          varietyHistory[v][d] = kg;
        }
      }

      // Compute MA5 per variety
      function getVarietyMA5(variety) {
        const vh = varietyHistory[variety];
        if (!vh) return 0;
        const dates = Object.keys(vh).sort().reverse().slice(0, 5);
        if (dates.length === 0) return 0;
        return dates.reduce((s, d) => s + vh[d], 0) / dates.length;
      }

      // Predict per variety for a given date and weather coeff
      function predictByVariety(targetDate, weatherCoeff) {
        const byVariety = {};
        let total = 0;
        for (const v of allVarieties) {
          const vma5 = getVarietyMA5(v);
          if (vma5 <= 0) continue;
          const pred = Math.round(vma5 * getDowFactor(targetDate) * weatherCoeff);
          byVariety[v] = pred;
          total += pred;
        }
        return { total, byVariety };
      }

      let predTodayKg = null, predTomorrowKg = null, predJ2Kg = null, predJ3Kg = null;
      let predTodayByVar = {}, predTomorrowByVar = {}, predJ2ByVar = {}, predJ3ByVar = {};

      if (ma5) {
        if (todayIsComplete && harvestActuals[todayStr]) {
          predTodayKg = harvestActuals[todayStr].total;
          predTodayByVar = harvestActuals[todayStr].byVariety || {};
        } else {
          const p = predictByVariety(todayStr, coeffToday.coeff);
          predTodayKg = p.total; predTodayByVar = p.byVariety;
        }
        const pTom = predictByVariety(tomorrowStr, coeffTomorrow.coeff);
        predTomorrowKg = pTom.total; predTomorrowByVar = pTom.byVariety;
        const pJ2 = predictByVariety(dayAfterStr, coeffDayAfter.coeff);
        predJ2Kg = pJ2.total; predJ2ByVar = pJ2.byVariety;
        const pJ3 = predictByVariety(j3Str, coeffJ3.coeff);
        predJ3Kg = pJ3.total; predJ3ByVar = pJ3.byVariety;
      }

      // 8) Retroactive predictions: MA5 base × dowFactor × weatherFactor (same logic as live)
      const retroPredictions = {};
      const sortedActualDates = Object.keys(harvestActuals)
        .filter(d => d < todayStr || (d === todayStr && todayIsComplete))
        .sort();
      for (let i = 0; i < sortedActualDates.length; i++) {
        const currDate = sortedActualDates[i];
        // Compute MA5 from the 5 complete days before currDate
        const priorDates = sortedActualDates.filter(d => d < currDate).slice(-5);
        if (priorDates.length < 2) continue; // need at least 2 days of history
        const retroMA5 = priorDates.reduce((s, d) => s + harvestActuals[d].total, 0) / priorDates.length;
        const sd = serreDataByDate[currDate];
        const retroWeather = sd ? computeWeatherFactor(sd, gddRef) : { weatherFactor: 1 };
        const retroDow = getDowFactor(currDate);
        retroPredictions[currDate] = Math.round(retroMA5 * retroDow * retroWeather.weatherFactor);
      }

      // 9) Alerts
      const alerts = generateAlerts(todaySerre, weatherForecast);

      // 10) Confidence score based on MAPE of retro-predictions (real accuracy measure)
      let mapeSum = 0, mapeCount = 0;
      for (const d of sortedActualDates) {
        if (retroPredictions[d] && harvestActuals[d]) {
          const actual = harvestActuals[d].total;
          const pred = retroPredictions[d];
          if (actual > 0) { mapeSum += Math.abs(pred - actual) / actual; mapeCount++; }
        }
      }
      const mape = mapeCount > 0 ? mapeSum / mapeCount : 0.5;
      const daysSinceActual = lastActualDate ? Math.round((Date.now() - new Date(lastActualDate).getTime()) / 86400000) : 7;
      const confidence = Math.max(0.3, Math.min(0.95, 1.0 - mape - daysSinceActual * 0.02));

      // 10b) Build correlation table (last 14 days with data)
      const correlationTable = [];
      for (let i = 0; i < Math.min(14, sortedActualDates.length); i++) {
        const dateStr = sortedActualDates[sortedActualDates.length - 1 - i];
        const actual = harvestActuals[dateStr].total;
        const predicted = retroPredictions[dateStr] || null;
        const sd = serreDataByDate[dateStr];
        const errPct = (actual > 0 && predicted) ? Math.round(((predicted - actual) / actual) * 100) : null;
        correlationTable.push({
          date: dateStr,
          actual_kg: actual,
          predicted_kg: predicted,
          error_pct: errPct,
          T_min: sd ? sd.T_min_serre : null,
          T_max: sd ? sd.T_max_serre : null,
          HR: sd ? sd.HR_moyenne : null,
          PAR: sd ? sd.PAR_sum : null,
          GDD: sd ? Math.round(Math.max(0, ((sd.T_max_serre + sd.T_min_serre) / 2) - 7) * 100) / 100 : null,
        });
      }

      // 11) Build 7-day history with serre data
      const history = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const dateStr = d.toISOString().slice(0, 10);
        const dayLabel = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
        const isComplete = dateStr < todayStr || (dateStr === todayStr && todayIsComplete);
        const hasData = harvestActuals[dateStr];
        const sd = serreDataByDate[dateStr];
        history.push({
          date: dateStr,
          label: dayLabel,
          actual: (hasData && isComplete) ? hasData.total : null,
          actualByVariety: (hasData && isComplete) ? hasData.byVariety : null,
          partial: (hasData && !isComplete) ? hasData.total : null,
          partialByVariety: (hasData && !isComplete) ? hasData.byVariety : null,
          predicted: retroPredictions[dateStr] || (dateStr === todayStr ? predTodayKg : null),
          serre: sd ? {
            T_max: sd.T_max_serre, T_min: sd.T_min_serre,
            HR: sd.HR_moyenne, PAR: sd.PAR_sum,
            GDD: Math.round(Math.max(0, ((sd.T_max_serre + sd.T_min_serre) / 2) - 7) * 100) / 100,
          } : null,
        });
      }
      // Compute error % for history entries that have both actual and predicted
      for (const h of history) {
        if (h.actual && h.predicted) {
          h.error = Math.round(((h.predicted - h.actual) / h.actual) * 100);
        }
      }

      // 12) Weather summary for J+1 / J+2
      let weatherJ1 = null, weatherJ2 = null, weatherJ3 = null;
      if (weatherForecast && weatherForecast.daily) {
        const wf = weatherForecast.daily;
        const makeWeather = (dateStr) => { const idx = (wf.time || []).indexOf(dateStr); return idx >= 0 ? { date: dateStr, T_max: wf.temperature_2m_max[idx], T_min: wf.temperature_2m_min[idx], precipitation: wf.precipitation_sum[idx], humidity: wf.relative_humidity_2m_max[idx] } : null; };
        weatherJ1 = makeWeather(tomorrowStr);
        weatherJ2 = makeWeather(dayAfterStr);
        weatherJ3 = makeWeather(j3Str);
      }

      // 13) Current serre readings
      const serreCurrent = todaySerre ? {
        temperature: todaySerre.T_max_serre,
        humidity: todaySerre.HR_moyenne,
        PAR: todaySerre.PAR_sum,
        RAD: todaySerre.RAD_sum,
        source: todaySerre.source,
      } : null;

      // 14) Generate explanation text for today's and tomorrow's predictions
      function buildExplanation(coeff, _serreData, label, baseKg, predKg) {
        if (!coeff || !predKg || !baseKg) return null;
        const reasons = [];
        const direction = predKg > baseKg ? "supérieure" : predKg < baseKg ? "inférieure" : "stable par rapport";
        reasons.push("base = moyenne mobile 5 jours (" + Math.round(baseKg) + " kg)");

        // GDD effect
        if (coeff.gddRatio > 1.1) reasons.push("accumulation thermique élevée (GDD ratio " + coeff.gddRatio + "x) — les températures chaudes des jours précédents accélèrent la maturation");
        else if (coeff.gddRatio < 0.9) reasons.push("accumulation thermique faible (GDD ratio " + coeff.gddRatio + "x) — températures basses ralentissent la maturation");

        // HR effect
        if (coeff.facteur_HR < 1) {
          if (coeff.facteur_HR <= 0.93) reasons.push("humidité très élevée (>92%) — risque botrytis, léger ajustement (facteur " + coeff.facteur_HR + ")");
          else if (coeff.facteur_HR <= 0.97) reasons.push("humidité élevée (85-92%) — ajustement modéré (facteur " + coeff.facteur_HR + ")");
        } else if (coeff.facteur_HR > 1) {
          reasons.push("humidité optimale (<75%) — conditions favorables (facteur " + coeff.facteur_HR + ")");
        }

        // PAR effect
        if (coeff.facteur_PAR > 1.02) reasons.push("fort ensoleillement — maturation accélérée (facteur " + coeff.facteur_PAR + ")");
        else if (coeff.facteur_PAR < 0.98) reasons.push("faible ensoleillement — maturation ralentie (facteur " + coeff.facteur_PAR + ")");

        if (reasons.length <= 1) reasons.push("conditions climatiques proches de la moyenne des 7 derniers jours");

        const summary = "Production " + label + " estimée " + direction + " à la moyenne 5j (" + predKg + " kg vs " + Math.round(baseKg) + " kg) :";
        return { summary, reasons, coefficient: coeff.coeff };
      }

      const explanationToday = buildExplanation(coeffToday, todaySerre, "aujourd'hui", ma5, predTodayKg);
      const explanationTomorrow = buildExplanation(coeffTomorrow, null, "demain (J+1)", ma5, predTomorrowKg);
      const explanationJ2 = buildExplanation(coeffDayAfter, null, "J+2", ma5, predJ2Kg);
      const explanationJ3 = buildExplanation(coeffJ3, null, "J+3", ma5, predJ3Kg);

      // 15) Store today's prediction for future calibration
      const predDoc = {
        date: todayStr,
        predicted_kg: predTodayKg,
        actual_kg: harvestActuals[todayStr] ? harvestActuals[todayStr].total : null,
        coefficients: coeffToday,
        ma5: ma5 ? Math.round(ma5) : null,
        confidence: Math.round(confidence * 100) / 100,
        _cachedAt: Date.now(),
      };
      db_firestore.collection("farms").doc("larache").collection("harvest_predictions").doc(todayStr).set(predDoc).catch(() => {});

      res.json({
        success: true,
        varietyFilter: varietyFilter || "TOUTES",
        varieties: [...allVarieties],
        today: todayStr,
        todayIsComplete,
        lastActual: lastActualDate ? { date: lastActualDate, kg: lastActualKg, byVariety: harvestActuals[lastActualDate].byVariety } : null,
        todayPartial: todayPartial ? { kg: todayPartial.total, byVariety: todayPartial.byVariety } : null,
        prediction: {
          today: { date: todayStr, kg: predTodayKg, byVariety: predTodayByVar, coefficients: coeffToday, isActual: todayIsComplete && !!harvestActuals[todayStr], explanation: explanationToday },
          tomorrow: { date: tomorrowStr, kg: predTomorrowKg, byVariety: predTomorrowByVar, coefficients: coeffTomorrow, explanation: explanationTomorrow },
          j2: { date: dayAfterStr, kg: predJ2Kg, byVariety: predJ2ByVar, coefficients: coeffDayAfter, explanation: explanationJ2 },
          j3: { date: j3Str, kg: predJ3Kg, byVariety: predJ3ByVar, coefficients: coeffJ3, explanation: explanationJ3 },
        },
        history,
        alerts,
        confidence: Math.round(confidence * 100) / 100,
        mape: Math.round(mape * 1000) / 1000,
        gddRef: Math.round(gddRef * 100) / 100,
        calibrationOffset: Math.round(calibrationOffset * 1000) / 1000,
        ma5: ma5 ? Math.round(ma5) : null,
        correlationTable,
        serreCurrent,
        weatherJ1,
        weatherJ2,
        weatherJ3,
      });
    } catch (err) {
      console.error("Erreur harvestPrediction:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Upload Écarts Excel — parse and store in Firestore
// =============================================
exports.uploadEcarts = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST only" });
    try {
      const XLSX = require("xlsx");
      // Parse base64 body (file sent as base64 from frontend)
      const base64Data = req.body.file;
      if (!base64Data) return res.status(400).json({ success: false, error: "No file data" });

      const buffer = Buffer.from(base64Data, "base64");
      const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

      // Find header row (look for "Semaine" or "Date" column)
      let headerIdx = -1;
      for (let i = 0; i < Math.min(10, rows.length); i++) {
        const r = rows[i];
        if (r && r.some(c => String(c || "").toLowerCase().includes("semaine"))) { headerIdx = i; break; }
      }
      if (headerIdx < 0) return res.status(400).json({ success: false, error: "Format Excel non reconnu — colonne 'Semaine' introuvable" });

      const headers = rows[headerIdx].map(h => String(h || "").trim());
      const dateCol = headers.findIndex(h => h.toLowerCase().includes("date"));
      const desCol = headers.findIndex(h => h.toLowerCase().includes("signation") || h.toLowerCase().includes("designation"));
      const qtyCol = headers.findIndex(h => h.toLowerCase().includes("quantit") || h.toLowerCase().includes("kg"));
      if (dateCol < 0 || qtyCol < 0) return res.status(400).json({ success: false, error: "Colonnes Date/Quantité introuvables" });

      // Aggregate by date and variety
      const byDate = {}; // { "2026-03-12": { total: 232, byVariety: { "MARAVILLA GG F1": 120, ... } } }
      let totalRows = 0;
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[dateCol] || !r[qtyCol]) continue;
        let dateVal = r[dateCol];
        let dateStr;
        if (dateVal instanceof Date) {
          dateStr = dateVal.toISOString().slice(0, 10);
        } else {
          dateStr = String(dateVal).slice(0, 10);
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
        const qty = parseFloat(r[qtyCol]) || 0;
        if (qty <= 0) continue;
        const designation = String(r[desCol] || "Autre").trim();

        // Determine variety from designation
        let variety = "Autre";
        const desUp = designation.toUpperCase();
        if (desUp.includes("MARAVILLA")) variety = "MARAVILLA";
        else if (desUp.includes("YAZMIN")) variety = "YAZMIN";
        else if (desUp.includes("REYNA")) variety = "REYNA";
        else if (desUp.includes("MYRTILLE") || desUp.includes("CORINA") || desUp.includes("BREEZE")) variety = "MYRTILLE";

        if (!byDate[dateStr]) byDate[dateStr] = { total: 0, byVariety: {} };
        byDate[dateStr].total += qty;
        byDate[dateStr].byVariety[variety] = (byDate[dateStr].byVariety[variety] || 0) + qty;
        totalRows++;
      }

      // Store in Firestore: farms/larache/ecarts_data/{date}
      const batch = db_firestore.batch();
      const ecartsColl = db_firestore.collection("farms").doc("larache").collection("ecarts_data");
      const dates = Object.keys(byDate);
      for (const d of dates) {
        const doc = ecartsColl.doc(d);
        batch.set(doc, {
          date: d,
          total: Math.round(byDate[d].total * 10) / 10,
          byVariety: Object.fromEntries(Object.entries(byDate[d].byVariety).map(([k, v]) => [k, Math.round(v * 10) / 10])),
          _uploadedAt: Date.now(),
        });
      }
      await batch.commit();

      res.json({
        success: true,
        message: `${totalRows} lignes importées, ${dates.length} jours, ${Math.round(Object.values(byDate).reduce((s, d) => s + d.total, 0))} kg total`,
        dateRange: { from: dates.sort()[0], to: dates.sort().reverse()[0] },
        totalDays: dates.length,
        totalKg: Math.round(Object.values(byDate).reduce((s, d) => s + d.total, 0) * 10) / 10,
      });
    } catch (err) {
      console.error("Erreur uploadEcarts:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// Email Analysis Functions (from emailService.js)
// =============================================
Object.assign(exports, require("./emailService"));
const pointageMod = require("./pointageService");
// Keep pointageRH/pointageRH2 exported to avoid GCP deletion issues
exports.pointageRH = pointageMod.pointageRH;
exports.pointageRH2 = pointageMod.pointageRH;
exports.warmPointageCache = pointageMod.warmPointageCache;
// Fresh function name to bypass GCP operation lock
exports.pointageV3 = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB", minInstances: 1 })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    return pointageMod.pointageRH(req, res);
  });

// =============================================
// API: Écarts & Défauts (Firestore CRUD)
// Collection: ecarts_pesages, ecarts_config
// =============================================
exports.ecarts = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const action = req.query.action || req.body?.action || "list";

    try {
      // --- LIST PESAGES ---
      if (action === "list") {
        const limit = parseInt(req.query.limit || "200");
        const snap = await db_firestore
          .collection("ecarts_pesages")
          .orderBy("createdAt", "desc")
          .limit(limit)
          .get();
        const pesages = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, pesages });
      }

      // --- CREATE PESAGE ---
      if (action === "create" && req.method === "POST") {
        const { date, ferme, variete, culture, kgExport, kgLocal, defauts, operateur } = req.body;
        if (!ferme || !variete || kgExport === undefined || kgLocal === undefined) {
          return res.status(400).json({ success: false, error: "Champs requis: ferme, variete, kgExport, kgLocal" });
        }
        const docRef = await db_firestore.collection("ecarts_pesages").add({
          date: date || new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }),
          ferme,
          variete,
          culture: culture || "",
          kgExport: parseFloat(kgExport) || 0,
          kgLocal: parseFloat(kgLocal) || 0,
          defauts: defauts || {},
          operateur: operateur || "FatimZahra",
          photoId: null,
          createdAt: Date.now(),
        });
        return res.json({ success: true, id: docRef.id });
      }

      // --- UPDATE PESAGE ---
      if (action === "update" && req.method === "POST") {
        const { id, ...updates } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        await db_firestore.collection("ecarts_pesages").doc(id).update({
          ...updates,
          updatedAt: Date.now(),
        });
        return res.json({ success: true });
      }

      // --- DELETE PESAGE ---
      if (action === "delete" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        await db_firestore.collection("ecarts_pesages").doc(id).delete();
        return res.json({ success: true });
      }

      // --- GET CONFIG (defauts list) ---
      if (action === "config") {
        const snap = await db_firestore.collection("ecarts_config").doc("defauts").get();
        if (snap.exists) {
          return res.json({ success: true, config: snap.data() });
        }
        // Default config
        const defaultConfig = {
          defauts: ["Rouille", "Thrips", "Fruit cassé", "Surmaturité", "Fruit mou", "Botrytis", "Calibre insuffisant"],
        };
        await db_firestore.collection("ecarts_config").doc("defauts").set(defaultConfig);
        return res.json({ success: true, config: defaultConfig });
      }

      // --- SAVE CONFIG ---
      if (action === "save-config" && req.method === "POST") {
        const { defauts } = req.body;
        if (!Array.isArray(defauts)) return res.status(400).json({ success: false, error: "defauts doit être un tableau" });
        await db_firestore.collection("ecarts_config").doc("defauts").set({ defauts, updatedAt: Date.now() });
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur Ecarts:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// Validation Pointage (Visa RH → Caporal → Chef)
// =============================================
exports.validation = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const action = req.query.action || (req.body && req.body.action);

      // Delegate pointage-rh actions to pointageService
      const pointageActions = ['summary', 'detail', 'dates', 'recolte', 'hors-recolte', 'recolte-equipes', 'quinzaine', 'quinzaine-analytique', 'quinzaine-repos', 'quinzaine-alertes', 'upload-times', 'postes-fixes', 'suivi-tunnels'];
      if (pointageActions.includes(action)) {
        const { pointageRH } = require("./pointageService");
        return pointageRH(req, res);
      }

      // GET status for a date + ferme
      if (action === "status") {
        const date = req.query.date;
        const ferme = req.query.ferme;
        if (!date) return res.status(400).json({ success: false, error: "date required" });

        if (ferme) {
          const docId = `${date}_${ferme}`;
          const snap = await db_firestore.collection("pointage_validations").doc(docId).get();
          return res.json({ success: true, validation: snap.exists ? snap.data() : null });
        }

        // Return all fermes for the date
        const snaps = await db_firestore.collection("pointage_validations")
          .where("date", "==", date).get();
        const validations = {};
        snaps.forEach(doc => { validations[doc.data().ferme] = doc.data(); });
        return res.json({ success: true, validations });
      }

      // POST validate
      if (action === "validate") {
        const { date, ferme, role, profileId, comment } = req.body || {};
        if (!date || !ferme || !role) return res.status(400).json({ success: false, error: "date, ferme, role required" });

        const docId = `${date}_${ferme}`;
        const docRef = db_firestore.collection("pointage_validations").doc(docId);
        const snap = await docRef.get();
        const current = snap.exists ? snap.data() : { date, ferme, visaRH: null, visaCaporal: null, visaChef: null, locked: false };

        const visa = { validatedBy: profileId || role, validatedAt: Date.now(), comment: comment || "" };

        if (role === "rh") {
          // Create snapshot of SQL data (freeze data at submission time)
          const { createSnapshot } = require("./pointageService");
          const snapshotData = await createSnapshot(date, ferme, profileId);
          current.visaRH = visa;
          current.snapshotId = docId;
          current.workerCount = snapshotData.workerCount || 0;
          // Clear rejection fields if re-submitting after rejection
          current.rejected = false;
          current.rejectedBy = null;
          current.rejectedAt = null;
          current.rejectionComment = null;
          current.rejectionRole = null;
        } else if (role === "caporal") {
          if (!current.visaRH) return res.status(400).json({ success: false, error: "RH doit soumettre avant le Caporal" });
          const pieceJointeUrl = (req.body || {}).pieceJointeUrl;
          const pieceJointeFilename = (req.body || {}).pieceJointeFilename;
          if (!pieceJointeUrl) return res.status(400).json({ success: false, error: "Pièce jointe obligatoire (scan du pointage papier)" });
          current.visaCaporal = visa;
          current.pieceJointeUrl = pieceJointeUrl;
          current.pieceJointeFilename = pieceJointeFilename || "";
        } else if (role === "chef") {
          if (!current.visaRH) return res.status(400).json({ success: false, error: "RH doit soumettre d'abord" });
          if (!current.visaCaporal) return res.status(400).json({ success: false, error: "Caporal doit valider avant le Chef" });
          current.visaChef = visa;
          current.locked = true;
        } else {
          return res.status(400).json({ success: false, error: "Role inconnu: " + role });
        }

        current.updatedAt = Date.now();
        await docRef.set(current);
        return res.json({ success: true, validation: current });
      }

      // POST reject (Caporal or Chef)
      if (action === "reject") {
        const { date, ferme, role, profileId, comment } = req.body || {};
        if (!date || !ferme || !role || !comment) return res.status(400).json({ success: false, error: "date, ferme, role, comment required" });

        const docId = `${date}_${ferme}`;
        const docRef = db_firestore.collection("pointage_validations").doc(docId);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Validation introuvable" });

        const current = snap.data();

        if (role === "caporal") {
          if (!current.visaRH) return res.status(400).json({ success: false, error: "Rien à rejeter" });
          if (current.visaCaporal) return res.status(400).json({ success: false, error: "Déjà validé par le Caporal" });
          // Reset RH visa — RH must re-verify and re-submit
          current.visaRH = null;
        } else if (role === "chef") {
          if (!current.visaCaporal) return res.status(400).json({ success: false, error: "Caporal n'a pas encore validé" });
          if (current.visaChef) return res.status(400).json({ success: false, error: "Déjà validé par le Chef" });
          // Reset caporal visa — caporal must re-validate
          current.visaCaporal = null;
        } else {
          return res.status(400).json({ success: false, error: "Seul le Caporal ou Chef peut rejeter" });
        }

        current.locked = false;
        current.rejected = true;
        current.rejectedBy = profileId || role;
        current.rejectedAt = Date.now();
        current.rejectionComment = comment;
        current.rejectionRole = role;
        current.updatedAt = Date.now();
        // Snapshot is KEPT — data remains frozen for RH to review/edit

        await docRef.set(current);
        return res.json({ success: true, validation: current });
      }

      // POST unlock (RH only, or DG override)
      if (action === "unlock") {
        const { date, ferme, profileId } = req.body || {};
        if (!date || !ferme) return res.status(400).json({ success: false, error: "date, ferme required" });

        const docId = `${date}_${ferme}`;
        const docRef = db_firestore.collection("pointage_validations").doc(docId);

        // Guard: RH cannot unlock a validated (locked & not rejected) pointage — only DG can
        const existingSnap = await docRef.get();
        if (existingSnap.exists) {
          const existing = existingSnap.data();
          if (existing.locked && !existing.rejected && profileId !== 'dg') {
            return res.status(403).json({ success: false, error: "Impossible de déverrouiller un pointage validé. Seul le DG peut le faire." });
          }
        }

        await docRef.set({ date, ferme, visaRH: null, visaCaporal: null, visaChef: null, locked: false, rejected: false, rejectedBy: null, rejectedAt: null, rejectionComment: null, rejectionRole: null, pieceJointeUrl: null, pieceJointeFilename: null, updatedAt: Date.now() });
        // Delete snapshot — return to SQL as data source
        await db_firestore.collection("pointage_snapshots").doc(docId).delete().catch(() => {});
        return res.json({ success: true, message: "Déverrouillé" });
      }

      // GET quinzaine-status: validation status for all dates in a quinzaine
      if (action === "quinzaine-status") {
        const metaSnap = await db_firestore.collection("sql_mirror_pointage_meta").doc("config").get();
        if (!metaSnap.exists) return res.json({ success: true, periodes: [], dates: [], validations: {} });
        const meta = metaSnap.data();
        const periodes = meta.periodes || [];
        const periodeMap = meta.periodeMap || {};
        const selectedPeriode = req.query.periode || periodes[0] || "";
        const dates = (periodeMap[selectedPeriode] || []).sort();
        if (!dates.length) return res.json({ success: true, periodes, selectedPeriode, dates: [], validations: {} });

        // Firestore 'in' supports up to 30 values — quinzaines have ~15 days
        const valSnaps = await db_firestore.collection("pointage_validations")
          .where("date", "in", dates).get();
        const validations = {};
        dates.forEach(d => { validations[d] = {}; });
        valSnaps.forEach(doc => {
          const v = doc.data();
          if (!validations[v.date]) validations[v.date] = {};
          validations[v.date][v.ferme] = v;
        });
        return res.json({ success: true, periodes, selectedPeriode, dates, validations });
      }

      // GET sql-comparison: compare SQL mirror vs snapshot for locked days
      if (action === "sql-comparison") {
        const metaSnap = await db_firestore.collection("sql_mirror_pointage_meta").doc("config").get();
        if (!metaSnap.exists) return res.json({ success: true, comparisons: [] });
        const meta = metaSnap.data();
        const periodes = meta.periodes || [];
        const periodeMap = meta.periodeMap || {};
        const selectedPeriode = req.query.periode || periodes[0] || "";
        const dates = (periodeMap[selectedPeriode] || []).sort();

        // Find locked validations
        const valSnaps = await db_firestore.collection("pointage_validations")
          .where("date", "in", dates.length ? dates : ["__none__"]).get();
        const lockedItems = [];
        valSnaps.forEach(doc => {
          const v = doc.data();
          if (v.locked) lockedItems.push({ date: v.date, ferme: v.ferme });
        });

        const { deriveFerme } = require("./pointageService");
        const comparisons = [];
        for (const item of lockedItems) {
          // Load SQL mirror
          const sqlSnap = await db_firestore.collection("sql_mirror_pointage").doc(item.date).get();
          const sqlRows = sqlSnap.exists ? (sqlSnap.data().rows || []) : [];
          const sqlFermeRows = sqlRows.filter(r => deriveFerme(r.Ref_parcelle, r.Parcelle_Culturale) === item.ferme);
          const sqlRowCount = sqlFermeRows.length;
          const sqlTotalCout = sqlFermeRows.reduce((s, r) => s + (parseFloat(r.Cout) || 0), 0);
          const sqlWorkers = new Set(sqlFermeRows.map(r => r.Personnel_Matricule)).size;

          // Load snapshot
          const snapDoc = await db_firestore.collection("pointage_snapshots").doc(`${item.date}_${item.ferme}`).get();
          const snapData = snapDoc.exists ? snapDoc.data() : {};
          const snapRows = snapData.detailRows || [];
          const snapRowCount = snapRows.length;
          const snapTotalCout = snapRows.reduce((s, r) => s + (parseFloat(r.Cout) || 0), 0);
          const snapWorkers = new Set(snapRows.map(r => r.Personnel_Matricule)).size;

          comparisons.push({
            date: item.date, ferme: item.ferme,
            sql: { rowCount: sqlRowCount, totalCout: Math.round(sqlTotalCout * 100) / 100, workerCount: sqlWorkers },
            snapshot: { rowCount: snapRowCount, totalCout: Math.round(snapTotalCout * 100) / 100, workerCount: snapWorkers },
            match: sqlRowCount === snapRowCount && Math.abs(sqlTotalCout - snapTotalCout) < 1
          });
        }
        return res.json({ success: true, comparisons });
      }

      // POST upload-attachment: upload pointage paper scan for Caporal
      if (action === "upload-attachment") {
        if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST uniquement" });
        const { date, ferme, file_base64, filename, contentType } = req.body || {};
        if (!date || !ferme || !file_base64) return res.status(400).json({ success: false, error: "date, ferme, file_base64 required" });
        const buffer = Buffer.from(file_base64.replace(/^data:[^;]+;base64,/, ""), "base64");
        const ext = (filename || "scan.jpg").split(".").pop() || "jpg";
        const storagePath = `pointage_attachments/${date}_${ferme}/${Date.now()}.${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType: contentType || `image/${ext}` } });
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        return res.json({ success: true, url: publicUrl, filename: filename || `scan.${ext}` });
      }

      // ------ TRANSPORT CONFIG: list, submit changes, approve/reject by finance ------
      // GET: action=transport-config → list current config + pending changes
      if (action === "transport-config") {
        const configSnap = await db_firestore.collection("transport_config").orderBy("prefix").get();
        const config = [];
        configSnap.forEach(doc => config.push({ id: doc.id, ...doc.data() }));

        const pendingSnap = await db_firestore.collection("transport_config_changes")
          .where("status", "==", "en_attente").orderBy("createdAt", "desc").get();
        const pending = [];
        pendingSnap.forEach(doc => pending.push({ id: doc.id, ...doc.data() }));

        return res.json({ success: true, config, pendingChanges: pending });
      }

      // POST: action=transport-config-init → initialize Firestore from array (one-time setup)
      if (action === "transport-config-init" && req.method === "POST") {
        const { equipes } = req.body || {};
        if (!equipes || !Array.isArray(equipes)) return res.status(400).json({ success: false, error: "equipes array required" });
        const batch = db_firestore.batch();
        for (const eq of equipes) {
          const ref = db_firestore.collection("transport_config").doc(eq.prefix);
          batch.set(ref, { prefix: eq.prefix, equipe: eq.equipe, caporal: eq.caporal, coutParOuvrier: eq.coutParOuvrier, updatedAt: Date.now() });
        }
        await batch.commit();
        return res.json({ success: true, message: `${equipes.length} équipes initialisées` });
      }

      // POST: action=transport-config-submit → RH submits a change request (pending finance approval)
      if (action === "transport-config-submit" && req.method === "POST") {
        const { changeType, data: changeData, submittedBy } = req.body || {};
        // changeType: "modifier_prix" | "ajouter_equipe" | "supprimer_equipe"
        if (!changeType || !changeData) return res.status(400).json({ success: false, error: "changeType and data required" });

        const docRef = db_firestore.collection("transport_config_changes").doc();
        await docRef.set({
          changeType,
          data: changeData,
          submittedBy: submittedBy || "RH",
          status: "en_attente",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return res.json({ success: true, id: docRef.id, message: "Demande soumise, en attente de validation Finance" });
      }

      // POST: action=transport-config-validate → Finance approves or rejects
      if (action === "transport-config-validate" && req.method === "POST") {
        const { changeId, decision, validatedBy, comment } = req.body || {};
        // decision: "approuver" | "rejeter"
        if (!changeId || !decision) return res.status(400).json({ success: false, error: "changeId and decision required" });

        const changeRef = db_firestore.collection("transport_config_changes").doc(changeId);
        const changeSnap = await changeRef.get();
        if (!changeSnap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
        const change = changeSnap.data();
        if (change.status !== "en_attente") return res.status(400).json({ success: false, error: "Demande déjà traitée" });

        if (decision === "approuver") {
          // Apply the change to transport_config collection
          const d = change.data;
          if (change.changeType === "modifier_prix") {
            await db_firestore.collection("transport_config").doc(d.prefix).update({ coutParOuvrier: d.newCout, updatedAt: Date.now() });
          } else if (change.changeType === "ajouter_equipe") {
            await db_firestore.collection("transport_config").doc(d.prefix).set({
              prefix: d.prefix, equipe: d.equipe, caporal: d.caporal, coutParOuvrier: d.coutParOuvrier, updatedAt: Date.now(),
            });
          } else if (change.changeType === "supprimer_equipe") {
            await db_firestore.collection("transport_config").doc(d.prefix).delete();
          }
          await changeRef.update({ status: "approuvée", validatedBy: validatedBy || "Finance", validatedAt: Date.now(), comment: comment || "" });
          return res.json({ success: true, message: "Changement approuvé et appliqué" });
        } else {
          await changeRef.update({ status: "rejetée", validatedBy: validatedBy || "Finance", validatedAt: Date.now(), comment: comment || "" });
          return res.json({ success: true, message: "Changement rejeté" });
        }
      }

      return res.status(400).json({ success: false, error: "Action inconnue" });
    } catch (err) {
      console.error("Erreur Validation:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Stock Management (Achats, BDC, BL, Factures, BC)
// Collections: suppliers, purchase_orders, delivery_notes, invoices, consumption_vouchers, stock_config
// =============================================

// Helper: generate sequential number with Firestore transaction
async function getNextNumber(type, prefix) {
  const counterRef = db_firestore.collection("stock_config").doc("counters");
  const year = new Date().getFullYear();
  const result = await db_firestore.runTransaction(async (t) => {
    const snap = await t.get(counterRef);
    const data = snap.exists ? snap.data() : {};
    const current = (data[type] || 0) + 1;
    t.set(counterRef, { ...data, [type]: current }, { merge: true });
    return `${prefix}-${year}-${String(current).padStart(4, "0")}`;
  });
  return result;
}

exports.stockManagement = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const action = req.query.action || req.body?.action || "stock-dashboard";

    try {
      // ========== SUPPLIERS ==========

      if (action === "list-suppliers") {
        const status = req.query.status; // "valide", "en_attente", "rejete", or empty for all active
        let snap;
        if (status) {
          snap = await db_firestore.collection("suppliers")
            .where("active", "==", true)
            .where("status", "==", status)
            .get();
        } else {
          snap = await db_firestore.collection("suppliers")
            .where("active", "==", true)
            .get();
        }
        const suppliers = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        suppliers.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr", { sensitivity: "base" }));
        return res.json({ success: true, suppliers });
      }

      if (action === "create-supplier" && req.method === "POST") {
        const { nom, ice, adresse, ville, tel, email, contact_nom, categorie, created_by } = req.body;
        if (!nom) return res.status(400).json({ success: false, error: "Nom du fournisseur requis" });
        const now = Date.now();
        const docRef = await db_firestore.collection("suppliers").add({
          nom, ice: ice || "", adresse: adresse || "", ville: ville || "",
          tel: tel || "", email: email || "", contact_nom: contact_nom || "",
          categorie: categorie || "autre",
          status: "en_attente", // Requires Finance validation
          active: true, created_by: created_by || {},
          history: [{ action: "creation", by: created_by || {}, at: now, comment: "Fournisseur créé, en attente de validation Finance" }],
          created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: docRef.id });
      }

      if (action === "update-supplier" && req.method === "POST") {
        const { id, updated_by, ...updates } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("suppliers").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Fournisseur non trouvé" });
        const current = doc.data();
        // If supplier was rejected, resubmit for validation
        const newStatus = current.status === "rejete" ? "en_attente" : current.status;
        const historyEntry = current.status === "rejete"
          ? { action: "resoumission", by: updated_by || {}, at: Date.now(), comment: "Fournisseur modifié et resoumis pour validation" }
          : { action: "modification", by: updated_by || {}, at: Date.now(), comment: "Fournisseur modifié" };
        await db_firestore.collection("suppliers").doc(id).update({
          ...updates, status: newStatus, updated_at: Date.now(),
          history: [...(current.history || []), historyEntry],
        });
        return res.json({ success: true });
      }

      if (action === "validate-supplier" && req.method === "POST") {
        const { id, decision, comment, validated_by } = req.body;
        if (!id || !decision) return res.status(400).json({ success: false, error: "ID et décision requis" });
        if (!["valide", "rejete"].includes(decision)) return res.status(400).json({ success: false, error: "Décision invalide (valide|rejete)" });
        const doc = await db_firestore.collection("suppliers").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Fournisseur non trouvé" });
        const current = doc.data();
        if (current.status !== "en_attente") return res.status(400).json({ success: false, error: "Ce fournisseur n'est pas en attente de validation" });
        const now = Date.now();
        await db_firestore.collection("suppliers").doc(id).update({
          status: decision,
          validated_by: validated_by || {},
          validated_at: now,
          updated_at: now,
          history: [...(current.history || []), {
            action: decision === "valide" ? "validation" : "rejet",
            by: validated_by || {}, at: now,
            comment: comment || (decision === "valide" ? "Fournisseur validé par Finance" : "Fournisseur rejeté par Finance"),
          }],
        });
        return res.json({ success: true, status: decision });
      }

      // ========== PURCHASE ORDERS (BDC) ==========

      if (action === "list-bdc") {
        const ferme = req.query.ferme;
        const status = req.query.status;
        const limit = parseInt(req.query.limit || "200");
        let query = db_firestore.collection("purchase_orders");
        const hasFilter = ferme || status;
        if (ferme) query = query.where("ferme", "==", ferme);
        if (status) query = query.where("status", "==", status);
        if (!hasFilter) query = query.orderBy("created_at", "desc");
        query = query.limit(limit);
        const snap = await query.get();
        let bdc = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        if (hasFilter) bdc.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, bdc });
      }

      if (action === "get-bdc") {
        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        // Fetch linked delivery notes
        const blSnap = await db_firestore.collection("delivery_notes").where("bdc_id", "==", id).orderBy("created_at", "desc").get();
        const bls = blSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Fetch linked invoices
        const facSnap = await db_firestore.collection("invoices").where("bdc_id", "==", id).orderBy("created_at", "desc").get();
        const factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, bdc: { id: doc.id, ...doc.data() }, bls, factures });
      }

      if (action === "create-bdc" && req.method === "POST") {
        const { supplier_id, fournisseur, ferme, date_livraison_prevue, items, created_by,
          purchase_request_id, consultation_id, code_analytique, mode_paiement } = req.body;
        if (!fournisseur?.nom || !ferme || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: fournisseur.nom, ferme, items[]" });
        }
        const numero = await getNextNumber("purchase_order", "BDC");
        // Compute totals
        let total_ht = 0, total_tva = 0, total_ttc = 0;
        const computedItems = items.map((item) => {
          const montant_ht = (parseFloat(item.quantite) || 0) * (parseFloat(item.prix_unitaire) || 0);
          const taux = parseFloat(item.taux_tva) || 20;
          const montant_tva = montant_ht * taux / 100;
          const montant_ttc = montant_ht + montant_tva;
          total_ht += montant_ht;
          total_tva += montant_tva;
          total_ttc += montant_ttc;
          return { ...item, montant_ht: Math.round(montant_ht * 100) / 100, montant_tva: Math.round(montant_tva * 100) / 100, montant_ttc: Math.round(montant_ttc * 100) / 100, taux_tva: taux };
        });
        const bdcData = {
          numero, status: "brouillon",
          purchase_request_id: purchase_request_id || null,
          consultation_id: consultation_id || null,
          supplier_id: supplier_id || null,
          fournisseur, ferme,
          date_livraison_prevue: date_livraison_prevue || "",
          code_analytique: code_analytique || "",
          mode_paiement: mode_paiement || "virement_bancaire",
          items: computedItems,
          total_ht: Math.round(total_ht * 100) / 100,
          total_tva: Math.round(total_tva * 100) / 100,
          total_ttc: Math.round(total_ttc * 100) / 100,
          delivery_status: "non_livre",
          invoice_status: "non_facture",
          created_by: created_by || {},
          validated_by_chef: null,
          validated_by_dg: null,
          history: [{ action: "creation", by: created_by || {}, at: Date.now(), comment: "" }],
          created_at: Date.now(), updated_at: Date.now(),
        };
        const docRef = await db_firestore.collection("purchase_orders").add(bdcData);
        return res.json({ success: true, id: docRef.id, numero });
      }

      if (action === "update-bdc" && req.method === "POST") {
        const { id, items, fournisseur, supplier_id, ferme, date_livraison_prevue, updated_by,
          code_analytique, mode_paiement } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        if (current.status !== "brouillon" && current.status !== "rejete") {
          return res.status(400).json({ success: false, error: "Le BDC ne peut être modifié que s'il est en brouillon ou rejeté" });
        }
        const updates = { updated_at: Date.now() };
        if (fournisseur) updates.fournisseur = fournisseur;
        if (supplier_id) updates.supplier_id = supplier_id;
        if (ferme) updates.ferme = ferme;
        if (date_livraison_prevue) updates.date_livraison_prevue = date_livraison_prevue;
        if (code_analytique !== undefined) updates.code_analytique = code_analytique;
        if (mode_paiement) updates.mode_paiement = mode_paiement;
        if (items?.length) {
          let total_ht = 0, total_tva = 0, total_ttc = 0;
          updates.items = items.map((item) => {
            const montant_ht = (parseFloat(item.quantite) || 0) * (parseFloat(item.prix_unitaire) || 0);
            const taux = parseFloat(item.taux_tva) || 20;
            const montant_tva = montant_ht * taux / 100;
            const montant_ttc = montant_ht + montant_tva;
            total_ht += montant_ht;
            total_tva += montant_tva;
            total_ttc += montant_ttc;
            return { ...item, montant_ht: Math.round(montant_ht * 100) / 100, montant_tva: Math.round(montant_tva * 100) / 100, montant_ttc: Math.round(montant_ttc * 100) / 100, taux_tva: taux };
          });
          updates.total_ht = Math.round(total_ht * 100) / 100;
          updates.total_tva = Math.round(total_tva * 100) / 100;
          updates.total_ttc = Math.round(total_ttc * 100) / 100;
        }
        const history = current.history || [];
        history.push({ action: "modification", by: updated_by || {}, at: Date.now(), comment: "" });
        updates.history = history;
        await db_firestore.collection("purchase_orders").doc(id).update(updates);
        return res.json({ success: true });
      }

      if (action === "submit-bdc" && req.method === "POST") {
        const { id, submitted_by } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        if (current.status !== "brouillon" && current.status !== "rejete") {
          return res.status(400).json({ success: false, error: "Seul un BDC en brouillon ou rejeté peut être soumis" });
        }
        const history = current.history || [];
        history.push({ action: "soumission", by: submitted_by || {}, at: Date.now(), comment: "" });
        await db_firestore.collection("purchase_orders").doc(id).update({
          status: "en_attente_chef", history, updated_at: Date.now(),
        });
        return res.json({ success: true });
      }

      if (action === "validate-bdc" && req.method === "POST") {
        const { id, decision, role, profileId, name, comment, ferme: validatorFerme } = req.body;
        if (!id || !decision || !role) {
          return res.status(400).json({ success: false, error: "id, decision (approve/reject), role requis" });
        }
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        const visa = { profileId: profileId || role, name: name || role, at: Date.now(), comment: comment || "" };
        const history = current.history || [];

        if (role === "chef") {
          if (current.status !== "en_attente_chef") {
            return res.status(400).json({ success: false, error: "Ce BDC n'est pas en attente de validation Chef" });
          }
          // Chef can only validate BDC for their own farm
          if (validatorFerme && current.ferme !== validatorFerme) {
            return res.status(403).json({ success: false, error: "Vous ne pouvez valider que les BDC de votre ferme" });
          }
          if (decision === "approve") {
            history.push({ action: "validation_chef", by: visa, at: Date.now(), comment: comment || "" });
            await db_firestore.collection("purchase_orders").doc(id).update({
              status: "en_attente_dg", validated_by_chef: visa, history, updated_at: Date.now(),
            });
          } else {
            history.push({ action: "rejet_chef", by: visa, at: Date.now(), comment: comment || "" });
            await db_firestore.collection("purchase_orders").doc(id).update({
              status: "rejete", history, updated_at: Date.now(),
            });
          }
          return res.json({ success: true });
        }

        if (role === "dg") {
          if (current.status !== "en_attente_dg") {
            return res.status(400).json({ success: false, error: "Ce BDC n'est pas en attente de validation DG" });
          }
          if (decision === "approve") {
            const now = Date.now();
            history.push({ action: "validation_dg", by: visa, at: now, comment: comment || "" });
            history.push({ action: "transmission_finance", by: { profileId: "system", name: "Système" }, at: now, comment: "BDC transmis à Finance pour information après validation DG" });
            await db_firestore.collection("purchase_orders").doc(id).update({
              status: "valide_dg", validated_by_dg: visa, history, updated_at: now,
              notified_finance: true, notified_finance_at: now,
            });
          } else {
            history.push({ action: "rejet_dg", by: visa, at: Date.now(), comment: comment || "" });
            await db_firestore.collection("purchase_orders").doc(id).update({
              status: "rejete", history, updated_at: Date.now(),
            });
          }
          return res.json({ success: true });
        }

        return res.status(400).json({ success: false, error: "Rôle inconnu: " + role });
      }

      if (action === "send-bdc" && req.method === "POST") {
        const { id, sent_by } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        if (current.status !== "valide_dg") {
          return res.status(400).json({ success: false, error: "Le BDC doit être validé par le DG avant envoi" });
        }
        const history = current.history || [];
        history.push({ action: "envoi_fournisseur", by: sent_by || {}, at: Date.now(), comment: "" });
        await db_firestore.collection("purchase_orders").doc(id).update({
          status: "envoye", history, updated_at: Date.now(),
        });
        return res.json({ success: true });
      }

      if (action === "send-bdc-email" && req.method === "POST") {
        const { bdc_id, to, subject, message, pdf_base64, pdf_filename, sent_by } = req.body;
        if (!bdc_id || !to) return res.status(400).json({ success: false, error: "bdc_id et email destinataire requis" });

        // Load SMTP config from Firestore
        const configDoc = await db_firestore.collection("config").doc("email_smtp").get();
        const smtp = configDoc.exists ? configDoc.data() : {};
        if (!smtp.user || !smtp.pass) return res.status(400).json({ success: false, error: "Configuration SMTP non définie. Créez le document config/email_smtp dans Firestore avec les champs: host, port, user, pass" });

        const transporter = nodemailer.createTransport({
          host: smtp.host || "smtp.gmail.com",
          port: parseInt(smtp.port) || 587,
          secure: (smtp.port === "465" || smtp.port === 465),
          auth: { user: smtp.user, pass: smtp.pass },
        });

        const mailOptions = {
          from: smtp.from || smtp.user,
          to,
          subject: subject || "Bon de Commande - Berry Good Farms",
          text: message || "",
          attachments: pdf_base64 ? [{
            filename: pdf_filename || "BDC.pdf",
            content: Buffer.from(pdf_base64, "base64"),
            contentType: "application/pdf",
          }] : [],
        };

        await transporter.sendMail(mailOptions);

        // Update BDC status to envoye and log history
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (bdcDoc.exists) {
          const current = bdcDoc.data();
          const history = current.history || [];
          history.push({ action: "envoi_email", by: sent_by || {}, at: Date.now(), comment: "Envoyé par email à " + to });
          const updates = { history, updated_at: Date.now(), email_sent_to: to, email_sent_at: Date.now() };
          if (current.status === "valide_dg") updates.status = "envoye";
          await db_firestore.collection("purchase_orders").doc(bdc_id).update(updates);
        }

        return res.json({ success: true });
      }

      // ========== PENDING VALIDATIONS ==========

      if (action === "pending-validations") {
        const role = req.query.role;
        const ferme = req.query.ferme;
        const result = { bdc_chef: 0, bdc_dg: 0, factures_achats: 0, factures_finance: 0, factures_dg: 0 };

        if (role === "chef" && ferme) {
          const snap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef")
            .where("ferme", "==", ferme)
            .get();
          result.bdc_chef = snap.size;
        }
        if (role === "dg") {
          const bdcSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get();
          result.bdc_dg = bdcSnap.size;
          const facSnap = await db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_finance").get();
          result.factures_dg = facSnap.size;
        }
        if (role === "finance") {
          const facSnap = await db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_achats").get();
          result.factures_finance = facSnap.size;
        }
        if (role === "achats") {
          const facSnap = await db_firestore.collection("invoices")
            .where("payment_status", "==", "en_validation").get();
          result.factures_achats = facSnap.size;
          // DAs pending approval
          const daSnap = await db_firestore.collection("purchase_requests")
            .where("status", "==", "soumise").get();
          result.da_soumises = daSnap.size;
          result.da_list = daSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          // BDCs en brouillon (created from DA, need completion)
          const bdcBrouillonSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "brouillon").get();
          result.bdc_brouillon = bdcBrouillonSnap.size;
          // BDCs en attente validation chef
          const bdcChefSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef").get();
          result.bdc_attente_chef = bdcChefSnap.size;
          // BDCs en attente validation DG
          const bdcDgSnap = await db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get();
          result.bdc_attente_dg = bdcDgSnap.size;
        }
        return res.json({ success: true, pending: result });
      }

      // ========== PURCHASE REQUESTS (DA) ==========

      if (action === "list-da") {
        const ferme = req.query.ferme;
        const status = req.query.status;
        const limit = parseInt(req.query.limit || "200");
        let query = db_firestore.collection("purchase_requests");
        const hasFilter = ferme || status;
        if (ferme) query = query.where("ferme", "==", ferme);
        if (status) query = query.where("status", "==", status);
        if (!hasFilter) query = query.orderBy("created_at", "desc");
        query = query.limit(limit);
        const snap = await query.get();
        let das = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        if (hasFilter) das.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, das });
      }

      if (action === "create-da" && req.method === "POST") {
        const { ferme, urgence, justification, items, created_by } = req.body;
        if (!ferme || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: ferme, items[]" });
        }
        const numero = await getNextNumber("purchase_request", "DA");
        const daData = {
          numero, status: "soumise", ferme,
          urgence: urgence || "normale",
          justification: justification || "",
          items: items.map((it) => ({ article: it.article || "", categorie: it.categorie || "autre", quantite: parseFloat(it.quantite) || 0, unite: it.unite || "kg", note: it.note || "" })),
          created_by: created_by || {},
          history: [{ action: "creation", by: created_by || {}, at: Date.now(), comment: "" }],
          created_at: Date.now(), updated_at: Date.now(),
        };
        const docRef = await db_firestore.collection("purchase_requests").add(daData);
        return res.json({ success: true, id: docRef.id, numero });
      }

      if (action === "update-da" && req.method === "POST") {
        const { id, status, items, urgence, justification, updated_by, comment } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_requests").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "DA non trouvée" });
        const current = doc.data();
        const updates = { updated_at: Date.now() };
        if (status) updates.status = status;
        if (items) updates.items = items;
        if (urgence) updates.urgence = urgence;
        if (justification !== undefined) updates.justification = justification;
        const history = current.history || [];
        history.push({ action: status === "approuvee" ? "approbation" : status === "rejetee" ? "rejet" : "modification", by: updated_by || {}, at: Date.now(), comment: comment || "" });
        updates.history = history;
        await db_firestore.collection("purchase_requests").doc(id).update(updates);

        // Auto-create BDC when DA is approved
        if (status === "approuvee") {
          const daData = { ...current, ...updates };
          const bdcNumero = await getNextNumber("purchase_order", "BDC");
          // Load catalogue to auto-fill prices and TVA
          const catalogSnap = await db_firestore.collection("articles_catalog").where("active", "==", true).get();
          const catalogMap = {};
          catalogSnap.docs.forEach(d => { const data = d.data(); catalogMap[(data.nom || "").toLowerCase().trim()] = data; });
          const bdcItems = (daData.items || []).map((item) => {
            const catArticle = catalogMap[(item.article || "").toLowerCase().trim()] || {};
            const pu = catArticle.prix_ht || 0;
            const tva = catArticle.taux_tva || 20;
            const qty = parseFloat(item.quantite) || 1;
            const mht = pu * qty;
            return {
            article: item.article || "",
            categorie: item.categorie || catArticle.categorie || "autre",
            quantite: qty,
            unite: item.unite || catArticle.unite || "unité",
            prix_unitaire: pu,
            taux_tva: tva,
            montant_ht: Math.round(mht * 100) / 100,
            montant_tva: Math.round(mht * tva / 100 * 100) / 100,
            montant_ttc: Math.round(mht * (1 + tva / 100) * 100) / 100,
            note: item.note || "",
          };});
          const bdcData = {
            numero: bdcNumero,
            status: "brouillon",
            purchase_request_id: id,
            consultation_id: null,
            supplier_id: null,
            fournisseur: { nom: "À définir" },
            ferme: daData.ferme || "",
            date_livraison_prevue: "",
            code_analytique: "",
            mode_paiement: "virement_bancaire",
            items: bdcItems,
            total_ht: bdcItems.reduce((s, i) => s + (i.montant_ht || 0), 0),
            total_tva: bdcItems.reduce((s, i) => s + (i.montant_tva || 0), 0),
            total_ttc: bdcItems.reduce((s, i) => s + (i.montant_ttc || 0), 0),
            delivery_status: "non_livre",
            invoice_status: "non_facture",
            created_by: updated_by || {},
            validated_by_chef: null,
            validated_by_dg: null,
            history: [
              { action: "creation", by: updated_by || {}, at: Date.now(), comment: "Créé automatiquement depuis DA " + (daData.numero || id) },
            ],
            created_at: Date.now(), updated_at: Date.now(),
          };
          const bdcRef = await db_firestore.collection("purchase_orders").add(bdcData);
          // Link BDC back to DA
          await db_firestore.collection("purchase_requests").doc(id).update({
            bdc_id: bdcRef.id, bdc_numero: bdcNumero,
          });
          return res.json({ success: true, bdc_created: true, bdc_id: bdcRef.id, bdc_numero: bdcNumero });
        }

        return res.json({ success: true });
      }

      // ========== DELIVERY NOTES (BL) ==========

      if (action === "list-bl") {
        const bdc_id = req.query.bdc_id;
        const limit = parseInt(req.query.limit || "200");
        let query = db_firestore.collection("delivery_notes").orderBy("created_at", "desc").limit(limit);
        if (bdc_id) query = query.where("bdc_id", "==", bdc_id);
        const snap = await query.get();
        const bls = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, bls });
      }

      if (action === "create-bl" && req.method === "POST") {
        const { bdc_id, date_reception, numero_bl_fournisseur, items, created_by, scan_url, scan_id } = req.body;
        if (!bdc_id || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: bdc_id, items[]" });
        }
        // Fetch the BDC
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (!bdcDoc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = bdcDoc.data();
        if (!["valide_dg", "envoye"].includes(bdc.status)) {
          return res.status(400).json({ success: false, error: "Le BDC doit être validé ou envoyé pour recevoir un BL" });
        }

        const numero = await getNextNumber("delivery_note", "BL");
        const blItems = items.map((it) => ({
          article: it.article || "",
          quantite_commandee: parseFloat(it.quantite_commandee) || 0,
          quantite_recue: parseFloat(it.quantite_recue) || 0,
          unite: it.unite || "kg",
          ecart: (parseFloat(it.quantite_recue) || 0) - (parseFloat(it.quantite_commandee) || 0),
          note: it.note || "",
        }));

        const blData = {
          numero, bdc_id, bdc_numero: bdc.numero,
          fournisseur_nom: bdc.fournisseur?.nom || "",
          date_reception: date_reception || new Date().toISOString().split("T")[0],
          numero_bl_fournisseur: numero_bl_fournisseur || "",
          items: blItems,
          scan_url: scan_url || null, scan_id: scan_id || null,
          created_by: created_by || {},
          created_at: Date.now(),
        };
        const docRef = await db_firestore.collection("delivery_notes").add(blData);

        // Update scan record if created from scan
        if (scan_id) {
          await db_firestore.collection("bl_scans").doc(scan_id).update({ bl_id: docRef.id, bl_numero: numero }).catch(() => {});
        }

        // Update BDC delivery_status
        const allBlSnap = await db_firestore.collection("delivery_notes").where("bdc_id", "==", bdc_id).get();
        const allBls = allBlSnap.docs.map((d) => d.data());
        // Sum received per article
        const received = {};
        allBls.forEach((bl) => (bl.items || []).forEach((it) => { received[it.article] = (received[it.article] || 0) + (it.quantite_recue || 0); }));
        // Check if fully delivered
        const ordered = {};
        (bdc.items || []).forEach((it) => { ordered[it.article] = (ordered[it.article] || 0) + (parseFloat(it.quantite) || 0); });
        const allDelivered = Object.keys(ordered).every((art) => (received[art] || 0) >= ordered[art]);
        const anyDelivered = Object.values(received).some((v) => v > 0);
        const deliveryStatus = allDelivered ? "complet" : anyDelivered ? "partiel" : "non_livre";
        await db_firestore.collection("purchase_orders").doc(bdc_id).update({ delivery_status: deliveryStatus, updated_at: Date.now() });

        return res.json({ success: true, id: docRef.id, numero, delivery_status: deliveryStatus });
      }

      // ========== STOCK LEVELS ==========

      if (action === "stock-levels") {
        const ferme = req.query.ferme;
        const cacheKey = "stock_levels" + (ferme ? "_" + ferme : "_all");
        const result = await withCache(cacheKey, 2 * 60 * 1000, async () => {
          const [blSnap, bcSnap] = await Promise.all([
            db_firestore.collection("delivery_notes").get(),
            db_firestore.collection("consumption_vouchers").get(),
          ]);
          const entries = {};
          blSnap.docs.forEach((doc) => {
            const bl = doc.data();
            (bl.items || []).forEach((it) => {
              const key = it.article;
              if (!entries[key]) entries[key] = { article: key, entrees: 0, sorties: 0, unite: it.unite || "kg" };
              entries[key].entrees += it.quantite_recue || 0;
            });
          });
          bcSnap.docs.forEach((doc) => {
            const bc = doc.data();
            if (ferme && bc.ferme !== ferme) return;
            (bc.items || []).forEach((it) => {
              const key = it.article;
              if (!entries[key]) entries[key] = { article: key, entrees: 0, sorties: 0, unite: it.unite || "kg" };
              entries[key].sorties += it.quantite || 0;
            });
          });
          let stocks = Object.values(entries).map((e) => ({
            article: e.article, unite: e.unite,
            entrees: Math.round(e.entrees * 100) / 100,
            sorties: Math.round(e.sorties * 100) / 100,
            stock: Math.round((e.entrees - e.sorties) * 100) / 100,
          }));
          stocks.sort((a, b) => b.stock - a.stock);
          return { success: true, stocks, count: stocks.length };
        });
        return res.json(result);
      }

      // ========== INVOICES (FACTURES) ==========

      if (action === "list-factures") {
        const limit = parseInt(req.query.limit || "200");
        const status = req.query.payment_status;
        let query = db_firestore.collection("invoices").orderBy("created_at", "desc").limit(limit);
        if (status) query = query.where("payment_status", "==", status);
        const snap = await query.get();
        const factures = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, factures });
      }

      if (action === "create-facture" && req.method === "POST") {
        const { bdc_id, numero_facture, date_facture, items, created_by, ferme, scan_url, scan_id } = req.body;
        if (!bdc_id || !numero_facture || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: bdc_id, numero_facture, items[]" });
        }
        // Fetch BDC for discrepancy detection
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (!bdcDoc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = bdcDoc.data();

        // Build BDC lookup by article
        const bdcLookup = {};
        (bdc.items || []).forEach((it) => {
          bdcLookup[it.article] = { quantite: parseFloat(it.quantite) || 0, prix_unitaire: parseFloat(it.prix_unitaire) || 0 };
        });

        // Process items and detect discrepancies
        const discrepancies = [];
        let total_ht = 0, total_tva = 0;
        const facItems = items.map((it) => {
          const qty = parseFloat(it.quantite) || 0;
          const pu = parseFloat(it.prix_unitaire) || 0;
          const tva_rate = parseFloat(it.taux_tva) || 20;
          const mht = qty * pu;
          const mtva = mht * tva_rate / 100;
          total_ht += mht;
          total_tva += mtva;

          // Check discrepancies vs BDC
          const bdcItem = bdcLookup[it.article];
          if (bdcItem) {
            if (qty !== bdcItem.quantite) {
              discrepancies.push({ article: it.article, type: "quantite", bdc_value: bdcItem.quantite, facture_value: qty, ecart: qty - bdcItem.quantite });
            }
            if (pu !== bdcItem.prix_unitaire) {
              discrepancies.push({ article: it.article, type: "prix", bdc_value: bdcItem.prix_unitaire, facture_value: pu, ecart: pu - bdcItem.prix_unitaire });
            }
          }

          return { article: it.article || "", quantite: qty, unite: it.unite || "kg", prix_unitaire: pu, taux_tva: tva_rate, montant_ht: Math.round(mht * 100) / 100, montant_tva: Math.round(mtva * 100) / 100, montant_ttc: Math.round((mht + mtva) * 100) / 100 };
        });

        const numero = await getNextNumber("invoice", "FAC");
        const now = Date.now();
        const facData = {
          numero, numero_facture, bdc_id, bdc_numero: bdc.numero,
          fournisseur: bdc.fournisseur || {},
          date_facture: date_facture || new Date().toISOString().split("T")[0],
          date_saisie: new Date().toISOString().split("T")[0],
          items: facItems, total_ht: Math.round(total_ht * 100) / 100,
          total_tva: Math.round(total_tva * 100) / 100,
          total_ttc: Math.round((total_ht + total_tva) * 100) / 100,
          discrepancies, has_discrepancies: discrepancies.length > 0,
          payment_status: "non_payee", ferme: ferme || bdc.ferme || "",
          created_by: created_by || {},
          scan_url: scan_url || null, scan_id: scan_id || null,
          history: [{ action: "creation", by: created_by || {}, at: now, comment: scan_id ? "Facture créée depuis scan" : "Facture saisie" }],
          created_at: now, updated_at: now,
        };
        const docRef = await db_firestore.collection("invoices").add(facData);

        // Update scan record if created from scan
        if (scan_id) {
          await db_firestore.collection("invoice_scans").doc(scan_id).update({ invoice_id: docRef.id, invoice_numero: numero, updated_at: now }).catch(() => {});
        }

        // Update BDC invoice_status
        const allFacSnap = await db_firestore.collection("invoices").where("bdc_id", "==", bdc_id).get();
        const totalFactured = allFacSnap.docs.reduce((sum, d) => sum + (d.data().total_ttc || 0), 0);
        const invoiceStatus = totalFactured >= (bdc.total_ttc || 0) ? "complet" : totalFactured > 0 ? "partiel" : "non_facture";
        await db_firestore.collection("purchase_orders").doc(bdc_id).update({ invoice_status: invoiceStatus, updated_at: now });

        return res.json({ success: true, id: docRef.id, numero, has_discrepancies: discrepancies.length > 0, discrepancies });
      }

      if (action === "validate-facture" && req.method === "POST") {
        const { id, decision, step, comment, validated_by } = req.body;
        if (!id || !decision || !step) return res.status(400).json({ success: false, error: "ID, décision et étape requis" });

        const doc = await db_firestore.collection("invoices").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Facture non trouvée" });
        const fac = doc.data();

        // Workflow: non_payee -> en_validation -> validee_achats -> validee_finance -> validee_dg -> payee
        const transitions = {
          "submit": { from: "non_payee", to: "en_validation" },
          "achats": { from: "en_validation", to: "validee_achats" },
          "finance": { from: "validee_achats", to: "validee_finance" },
          "dg": { from: "validee_finance", to: "validee_dg" },
          "pay": { from: "validee_dg", to: "payee" },
        };
        const t = transitions[step];
        if (!t) return res.status(400).json({ success: false, error: "Étape invalide" });

        if (decision === "rejete") {
          const now = Date.now();
          await db_firestore.collection("invoices").doc(id).update({
            payment_status: "non_payee", updated_at: now,
            history: [...(fac.history || []), { action: "rejet_" + step, by: validated_by || {}, at: now, comment: comment || "Rejeté" }],
          });
          return res.json({ success: true, status: "non_payee" });
        }

        if (fac.payment_status !== t.from) {
          return res.status(400).json({ success: false, error: `Statut actuel "${fac.payment_status}" incompatible avec l'étape "${step}" (attendu: "${t.from}")` });
        }

        const now = Date.now();
        const updateData = {
          payment_status: t.to, updated_at: now,
          history: [...(fac.history || []), { action: step + "_validation", by: validated_by || {}, at: now, comment: comment || `Validé (${step})` }],
        };
        if (step === "achats") updateData.validated_by_achats = validated_by;
        if (step === "finance") updateData.validated_by_finance = validated_by;
        if (step === "dg") updateData.validated_by_dg = validated_by;
        if (step === "pay") updateData.paid_at = now;

        await db_firestore.collection("invoices").doc(id).update(updateData);
        return res.json({ success: true, status: t.to });
      }

      // ========== CONSUMPTION VOUCHERS (BONS DE CONSOMMATION) ==========

      if (action === "list-bc") {
        const limit = parseInt(req.query.limit || "200");
        const type = req.query.type; // "engrais" or "pesticide"
        const ferme = req.query.ferme;
        let query = db_firestore.collection("consumption_vouchers").orderBy("created_at", "desc").limit(limit);
        if (type) query = query.where("type", "==", type);
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        const bcs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, bcs });
      }

      if (action === "create-bc" && req.method === "POST") {
        const { type, parcelle, culture, ferme, date, authorized_by, items, created_by } = req.body;
        if (!type || !parcelle || !ferme || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: type, parcelle, ferme, items[]" });
        }
        if (!["engrais", "pesticide"].includes(type)) {
          return res.status(400).json({ success: false, error: "Type invalide (engrais|pesticide)" });
        }
        const numero = await getNextNumber("consumption_voucher", "BC");
        const bcItems = items.map((it) => ({
          article: it.article || "", quantite: parseFloat(it.quantite) || 0, unite: it.unite || "kg",
        }));
        const bcData = {
          numero, type, parcelle, culture: culture || "", ferme,
          date: date || new Date().toISOString().split("T")[0],
          authorized_by: authorized_by || {},
          items: bcItems,
          cpc_categorie: type === "engrais" ? "Engrais" : "Pesticides",
          created_by: created_by || {},
          created_at: Date.now(),
        };
        const docRef = await db_firestore.collection("consumption_vouchers").add(bcData);
        return res.json({ success: true, id: docRef.id, numero });
      }

      // ========== STOCK DASHBOARD ==========

      if (action === "stock-dashboard") {
        const result = await withCache("stock_dashboard", 2 * 60 * 1000, async () => {
          const [bdcSnap, facSnap, bcSnap2, blSnap2] = await Promise.all([
            db_firestore.collection("purchase_orders").get(),
            db_firestore.collection("invoices").get(),
            db_firestore.collection("consumption_vouchers").get(),
            db_firestore.collection("delivery_notes").get(),
          ]);

          const bdcs = bdcSnap.docs.map((d) => d.data());
          const factures = facSnap.docs.map((d) => d.data());

          const bdcEnCours = bdcs.filter((b) => !["rejete", "envoye"].includes(b.status)).length;
          const bdcEnAttente = bdcs.filter((b) => b.status?.startsWith("en_attente")).length;
          const totalBdcTTC = bdcs.filter((b) => b.status !== "rejete").reduce((s, b) => s + (b.total_ttc || 0), 0);

          const facturesNonPayees = factures.filter((f) => f.payment_status !== "payee").length;
          const totalFacturesTTC = factures.reduce((s, f) => s + (f.total_ttc || 0), 0);
          const facturesAvecEcarts = factures.filter((f) => f.has_discrepancies).length;

          const pipelinePaiement = {
            non_payee: factures.filter((f) => f.payment_status === "non_payee").length,
            en_validation: factures.filter((f) => f.payment_status === "en_validation").length,
            validee_achats: factures.filter((f) => f.payment_status === "validee_achats").length,
            validee_finance: factures.filter((f) => f.payment_status === "validee_finance").length,
            validee_dg: factures.filter((f) => f.payment_status === "validee_dg").length,
            payee: factures.filter((f) => f.payment_status === "payee").length,
          };

          return {
            success: true,
            kpis: {
              bdc_en_cours: bdcEnCours, bdc_en_attente: bdcEnAttente,
              total_bdc_ttc: Math.round(totalBdcTTC * 100) / 100,
              factures_non_payees: facturesNonPayees,
              total_factures_ttc: Math.round(totalFacturesTTC * 100) / 100,
              factures_avec_ecarts: facturesAvecEcarts,
              pipeline_paiement: pipelinePaiement,
              nb_bl: blSnap2.size, nb_bc: bcSnap2.size,
            },
          };
        });
        return res.json(result);
      }

      if (action === "pending-validations") {
        const role = req.query.role;
        const ferme = req.query.ferme;
        const results = { bdc: [], factures: [] };

        if (role === "chef" && ferme) {
          const snap = await db_firestore.collection("purchase_orders").where("status", "==", "en_attente_chef").where("ferme", "==", ferme).get();
          results.bdc = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (role === "dg") {
          const bdcSnap = await db_firestore.collection("purchase_orders").where("status", "==", "en_attente_dg").get();
          results.bdc = bdcSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const facSnap = await db_firestore.collection("invoices").where("payment_status", "==", "validee_finance").get();
          results.factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (role === "finance") {
          const facSnap = await db_firestore.collection("invoices").where("payment_status", "==", "validee_achats").get();
          results.factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const suppSnap = await db_firestore.collection("suppliers").where("status", "==", "en_attente").get();
          results.fournisseurs = suppSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (role === "achats") {
          const facSnap = await db_firestore.collection("invoices").where("payment_status", "==", "en_validation").get();
          results.factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }

        return res.json({ success: true, ...results });
      }

      // ========== IMPORT FOURNISSEURS DEPUIS SQL ==========

      if (action === "import-fournisseurs-sql" && req.method === "POST") {
        const { imported_by } = req.body || {};
        const db = await getPool();

        // Phase 1 : Découverte des colonnes réelles de BR_Achat
        const schemaRes = await db.request()
          .input("tbl", getSql().NVarChar, "BR_Achat")
          .query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_NAME = @tbl ORDER BY ORDINAL_POSITION`);

        if (schemaRes.recordset.length === 0) {
          return res.status(404).json({ success: false, error: "Table BR_Achat introuvable dans SQL Server" });
        }

        const actualCols = schemaRes.recordset.map(r => r.COLUMN_NAME);
        const colsLower = actualCols.map(c => c.toLowerCase());

        const findCol = (...candidates) => {
          for (const c of candidates) {
            const idx = colsLower.indexOf(c.toLowerCase());
            if (idx !== -1) return actualCols[idx];
          }
          return null;
        };

        // Phase 2 : Mapping colonnes → champs Firestore
        const nomCol       = findCol("Fournisseur", "NomFournisseur", "Nom_Fournisseur", "Nom", "RaisonSociale");
        const iceCol       = findCol("ICE", "Ice", "NumICE", "Num_ICE", "CodeFisc");
        const adresseCol   = findCol("Adresse", "Adress", "Address");
        const villeCol     = findCol("Ville", "City", "Localite");
        const telCol       = findCol("Tel", "Telephone", "Phone", "GSM", "Mobile");
        const emailCol     = findCol("Email", "Mail");
        const contactCol   = findCol("Contact", "NomContact", "Nom_Contact", "Interlocuteur");
        const categorieCol = findCol("Categorie", "TypeFournisseur", "Famille", "Type");

        if (!nomCol) {
          return res.status(422).json({
            success: false,
            error: "Colonne Nom/Fournisseur introuvable dans BR_Achat",
            columns_found: actualCols,
          });
        }

        // Phase 3 : SELECT fournisseurs distincts avec normalisation et exclusions
        // - Exclus : fermes (F-01/F-02/F-05), entrées internes (INVENTAIRE, STOCK INITIAL, INV-*)
        // - Normalisé : variantes HAROUACH → "STE AGRI HAROUACH", AGRIVIVOS → "STÉ AGRIVIVOS", TIMAC → "TIMAC AGRO MAROC"
        // - Catégorie inférée depuis Article_Categorie le plus fréquent
        const hasArchive = colsLower.includes("is_archive");
        const archiveFilter = hasArchive ? "AND is_archive = 0" : "";
        const hasCatCol = colsLower.includes("article_categorie");

        const sqlQuery = `
          WITH normalized AS (
            SELECT
              CASE
                WHEN UPPER(LTRIM(RTRIM([${nomCol}]))) LIKE '%HAROUACH%' THEN 'STE AGRI HAROUACH'
                WHEN UPPER(LTRIM(RTRIM([${nomCol}]))) LIKE '%AGRIVIVOS%' THEN 'STÉ AGRIVIVOS'
                WHEN UPPER(LTRIM(RTRIM([${nomCol}]))) = 'TIMAC' THEN 'TIMAC AGRO MAROC'
                ELSE LTRIM(RTRIM([${nomCol}]))
              END AS nom,
              ${hasCatCol ? "[Article_Categorie]" : "NULL AS Article_Categorie"}
            FROM BR_Achat
            WHERE [${nomCol}] IS NOT NULL
              AND LEN(LTRIM(RTRIM([${nomCol}]))) > 0
              AND UPPER(LTRIM(RTRIM([${nomCol}]))) NOT IN (
                'INVENTAIRE','STOCK INITIAL','INV-291125',
                'F-01','F-02','F-02 AVOCAT','F-05'
              )
              AND UPPER(LTRIM(RTRIM([${nomCol}]))) NOT LIKE 'INV-%'
              ${archiveFilter}
          ),
          ${hasCatCol ? `
          cat_counts AS (
            SELECT nom, Article_Categorie,
              ROW_NUMBER() OVER (PARTITION BY nom ORDER BY COUNT(*) DESC) AS rn
            FROM normalized
            WHERE Article_Categorie IS NOT NULL
            GROUP BY nom, Article_Categorie
          ),` : ""}
          fournisseurs AS (
            SELECT DISTINCT nom FROM normalized
          )
          SELECT
            f.nom,
            NULL AS ice, NULL AS adresse, NULL AS ville,
            NULL AS tel, NULL AS email, NULL AS contact_nom,
            ${hasCatCol ? "cc.Article_Categorie AS categorie" : "NULL AS categorie"}
          FROM fournisseurs f
          ${hasCatCol ? "LEFT JOIN cat_counts cc ON f.nom = cc.nom AND cc.rn = 1" : ""}
          ORDER BY f.nom
        `;
        const sqlRows = (await db.request().query(sqlQuery)).recordset;

        // Phase 4 : Chargement Firestore pour déduplication
        const existingSnap = await db_firestore.collection("suppliers").get();
        const existingByIce = {}, existingByNom = {};
        existingSnap.docs.forEach(doc => {
          const d = doc.data();
          if (d.ice && d.ice.trim()) existingByIce[d.ice.trim().toLowerCase()] = doc.id;
          if (d.nom && d.nom.trim()) existingByNom[d.nom.trim().toLowerCase()] = doc.id;
        });

        // Phase 5 : Normalisation catégorie
        const CATS = ["engrais","phyto","emballage","materiel","semences","autre"];
        const normCat = (raw) => {
          if (!raw) return "autre";
          const v = String(raw).toLowerCase().trim();
          return CATS.find(c => v.includes(c)) || "autre";
        };

        // Phase 6 : Écriture Firestore en batch (chunks de 400)
        const now = Date.now();
        const importedBy = imported_by || { uid: "system", email: "import@sql", name: "Import SQL" };
        let imported = 0, skipped = 0;
        const skippedNames = [];
        let batch = db_firestore.batch(), batchCount = 0;

        for (const row of sqlRows) {
          const nom = (row.nom || "").toString().trim();
          const ice = (row.ice || "").toString().trim();
          if (!nom) { skipped++; continue; }
          const iceKey = ice ? ice.toLowerCase() : null;
          if ((iceKey && existingByIce[iceKey]) || existingByNom[nom.toLowerCase()]) {
            skipped++; skippedNames.push(nom); continue;
          }
          const docRef = db_firestore.collection("suppliers").doc();
          batch.set(docRef, {
            nom, ice: ice || "",
            adresse: (row.adresse || "").toString().trim(),
            ville: (row.ville || "").toString().trim(),
            tel: (row.tel || "").toString().trim(),
            email: (row.email || "").toString().trim(),
            contact_nom: (row.contact_nom || "").toString().trim(),
            categorie: normCat(row.categorie),
            status: "valide",
            active: true,
            created_by: importedBy,
            source: "sql_import",
            history: [{ action: "import_sql", by: importedBy, at: now,
              comment: "Importé automatiquement depuis BR_Achat (SQL Server)" }],
            created_at: now, updated_at: now,
          });
          batchCount++; imported++;
          if (batchCount >= 400) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();

        await db_firestore.collection("supplier_imports").add({
          type: "sql_import", source: "BR_Achat", imported_by: importedBy, imported_at: now,
          stats: { total_sql: sqlRows.length, imported, skipped },
          columns_mapped: { nomCol, iceCol, adresseCol, villeCol, telCol, emailCol, contactCol, categorieCol },
        });

        return res.json({
          success: true,
          stats: { total_found: sqlRows.length, imported, skipped, skipped_sample: skippedNames.slice(0, 10) },
          columns_mapped: { nomCol, iceCol, adresseCol, villeCol, telCol, emailCol, contactCol, categorieCol },
        });
      }

      // ========== IMPORT FOURNISSEURS DEPUIS EXCEL ==========

      if (action === "import-fournisseurs-xls" && req.method === "POST") {
        const { file_base64, imported_by, dry_run } = req.body || {};
        if (!file_base64) return res.status(400).json({ success: false, error: "Fichier Excel requis (file_base64)" });

        const XLSX = require("xlsx");
        const buffer = Buffer.from(file_base64, "base64");
        const wb = XLSX.read(buffer, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (rows.length < 2) return res.status(400).json({ success: false, error: "Fichier vide ou sans données" });

        // Normalisation des villes
        const VILLE_CORRECTIONS = {
          "CASA BLANCA": "CASABLANCA", "CIDI KACEM": "SIDI KACEM",
          "MOULAY": "MOULAY BOUSELHAM",
        };
        const normalizeVille = (v) => {
          const trimmed = (v || "").toString().trim().toUpperCase();
          return VILLE_CORRECTIONS[trimmed] || trimmed;
        };

        // Parse rows (skip header)
        const parsed = [];
        const warnings = [];
        const seenICE = {};

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const nom = (r[1] || "").toString().trim();
          if (!nom) { warnings.push(`Ligne ${i + 1}: nom vide, ignorée`); continue; }

          const code = (r[0] || "").toString().trim();
          const prenom = (r[3] || "").toString().trim();
          const civilite = (r[4] || "").toString().trim();
          const nomContact = (r[2] || "").toString().trim();
          const contactParts = [civilite, nomContact, prenom].filter(Boolean);
          const contact_nom = contactParts.join(" ");

          const ice = (r[12] || "").toString().trim();
          const identifiant_fiscal = (r[13] || "").toString().trim();
          const tel = (r[8] || "").toString().trim();
          const gsm = (r[9] || "").toString().trim();
          const email = (r[11] || "").toString().trim().toLowerCase();
          const adresse = (r[5] || "").toString().trim();
          const ville = normalizeVille(r[6]);

          // Détection ICE dupliqué dans le fichier
          if (ice) {
            if (seenICE[ice]) {
              warnings.push(`ICE dupliqué "${ice}" : "${nom}" (ligne ${i + 1}) et "${seenICE[ice].nom}" — ICE ignoré pour le second`);
              parsed.push({ code, nom, contact_nom, adresse, ville, tel, gsm, email, ice: "", identifiant_fiscal });
              continue;
            }
            seenICE[ice] = { nom, line: i + 1 };
          }

          parsed.push({ code, nom, contact_nom, adresse, ville, tel, gsm, email, ice, identifiant_fiscal });
        }

        // Déduplication avec Firestore existant
        const existingSnap = await db_firestore.collection("suppliers").get();
        const existingByIce = {}, existingByNom = {};
        existingSnap.docs.forEach(doc => {
          const d = doc.data();
          if (d.ice && d.ice.trim()) existingByIce[d.ice.trim().toLowerCase()] = { id: doc.id, nom: d.nom };
          if (d.nom && d.nom.trim()) existingByNom[d.nom.trim().toLowerCase()] = { id: doc.id, nom: d.nom };
        });

        const toImport = [], duplicates = [], incomplete = [];
        for (const row of parsed) {
          const iceKey = row.ice ? row.ice.toLowerCase() : null;
          const nomKey = row.nom.toLowerCase();
          if (iceKey && existingByIce[iceKey]) {
            duplicates.push({ ...row, reason: `ICE "${row.ice}" existe déjà (${existingByIce[iceKey].nom})` });
          } else if (existingByNom[nomKey]) {
            duplicates.push({ ...row, reason: `Nom "${row.nom}" existe déjà` });
          } else {
            toImport.push(row);
            if (!row.ice && !row.tel && !row.adresse) {
              incomplete.push(row.nom);
            }
          }
        }

        // Dry-run : retourner le rapport sans écrire
        if (dry_run) {
          return res.json({
            success: true, dry_run: true,
            stats: { total_fichier: parsed.length, a_importer: toImport.length, doublons: duplicates.length, incomplets: incomplete.length },
            duplicates: duplicates.map(d => ({ code: d.code, nom: d.nom, reason: d.reason })),
            incomplete,
            warnings,
            preview: toImport.slice(0, 10).map(r => ({ code: r.code, nom: r.nom, ville: r.ville, ice: r.ice })),
          });
        }

        // Écriture Firestore en batch
        const now = Date.now();
        const importedBy = imported_by || { uid: "system", email: "import@xls", name: "Import Excel" };
        let imported = 0;
        let batch = db_firestore.batch(), batchCount = 0;

        for (const row of toImport) {
          const docRef = db_firestore.collection("suppliers").doc();
          batch.set(docRef, {
            nom: row.nom, ice: row.ice, adresse: row.adresse, ville: row.ville,
            tel: row.tel, gsm: row.gsm, email: row.email,
            contact_nom: row.contact_nom,
            code_fournisseur: row.code,
            identifiant_fiscal: row.identifiant_fiscal,
            categorie: "autre",
            status: "en_attente",
            active: true,
            created_by: importedBy,
            source: "xls_import",
            history: [{ action: "import_xls", by: importedBy, at: now,
              comment: "Importé depuis fichier Excel (Les fournisseurs)" }],
            created_at: now, updated_at: now,
          });
          batchCount++; imported++;
          if (batchCount >= 400) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();

        await db_firestore.collection("supplier_imports").add({
          type: "xls_import", source: "fichier_excel", imported_by: importedBy, imported_at: now,
          stats: { total_fichier: parsed.length, imported, doublons: duplicates.length, incomplets: incomplete.length },
          warnings,
        });

        return res.json({
          success: true,
          stats: { total_fichier: parsed.length, imported, doublons: duplicates.length, incomplets: incomplete.length },
          duplicates: duplicates.map(d => ({ code: d.code, nom: d.nom, reason: d.reason })),
          warnings,
        });
      }

      // ========== CATALOGUE ARTICLES SQL ==========

      if (action === "import-articles-sql" && req.method === "POST") {
        const db = await getPool();
        const sqlRes = await db.request().query(`
          SELECT LTRIM(RTRIM(Article)) AS nom,
            Article_Categorie AS categorie,
            Article_Sous_Categorie AS sous_categorie,
            UPPER(LTRIM(RTRIM(Unite))) AS unite,
            AVG(NULLIF(Cout,0)/NULLIF(Quantite,0)) AS prix_ref,
            COUNT(*) AS nb_achats
          FROM BR_Achat
          WHERE is_archive=0 AND Article IS NOT NULL AND LEN(LTRIM(RTRIM(Article)))>0
            AND Article NOT IN ('INVENTAIRE','STOCK INITIAL')
            AND Article NOT LIKE 'INV-%'
          GROUP BY LTRIM(RTRIM(Article)), Article_Categorie, Article_Sous_Categorie, UPPER(LTRIM(RTRIM(Unite)))
          ORDER BY Article_Categorie, LTRIM(RTRIM(Article))
        `);
        const rows = sqlRes.recordset;
        const now = Date.now();
        let imported = 0, updated = 0;
        let batch = db_firestore.batch(), batchCount = 0;

        for (const row of rows) {
          const nom = (row.nom || "").trim();
          if (!nom) continue;
          const docId = Buffer.from(`${nom}|${row.categorie || ""}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
          const existSnap = await db_firestore.collection("articles_catalog").doc(docId).get();
          const data = {
            nom,
            categorie: (row.categorie || "autre").toLowerCase(),
            sous_categorie: row.sous_categorie || "",
            unite: row.unite || "KG",
            prix_ref: row.prix_ref ? Math.round(row.prix_ref * 100) / 100 : null,
            nb_achats: row.nb_achats || 0,
            source: "sql_import",
            active: true,
            updated_at: now,
          };
          const docRef = db_firestore.collection("articles_catalog").doc(docId);
          if (existSnap.exists) { batch.update(docRef, data); updated++; }
          else { batch.set(docRef, { ...data, created_at: now }); imported++; }
          batchCount++;
          if (batchCount >= 400) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        return res.json({ success: true, stats: { total: rows.length, imported, updated } });
      }

      if (action === "import-articles-excel" && req.method === "POST") {
        const { articles } = req.body;
        if (!articles || !articles.length) return res.status(400).json({ success: false, error: "articles[] requis" });
        const now = Date.now();
        let imported = 0, updated = 0, skipped = 0;

        // Pre-fetch all existing articles in one query
        const existingSnap = await db_firestore.collection("articles_catalog").get();
        const existingMap = {};
        existingSnap.docs.forEach(d => { existingMap[d.id] = d.data(); });

        let batch = db_firestore.batch(), batchCount = 0;
        for (const art of articles) {
          const nom = (art.nom || "").trim();
          if (!nom) { skipped++; continue; }
          const ref = (art.reference || "").trim();
          const docId = ref
            ? ref.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50)
            : Buffer.from(`${nom}|${art.categorie || ""}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
          const data = {
            nom, reference: ref,
            reference_technique: (art.reference_technique || "").trim(),
            categorie: (art.categorie || "autre").trim(),
            sous_categorie: (art.sous_categorie || "").trim(),
            unite: (art.unite || "U").trim(),
            prix_ht: art.prix_ht || 0, taux_tva: art.taux_tva || 0, prix_ttc: art.prix_ttc || 0,
            prix_ref: art.prix_ht || null,
            type_article: (art.type || "").trim(),
            invisible: art.invisible || 0, multi_ferme: art.multi_ferme || 0,
            source: "excel_import", active: true, updated_at: now,
          };
          const docRef = db_firestore.collection("articles_catalog").doc(docId);
          const existing = existingMap[docId];
          if (existing) {
            if (data.prix_ht > 0 || !existing.prix_ref) data.prix_ref = data.prix_ht || existing.prix_ref;
            data.nb_achats = existing.nb_achats || 0;
            batch.update(docRef, data);
            updated++;
          } else {
            batch.set(docRef, { ...data, nb_achats: 0, created_at: now });
            imported++;
          }
          batchCount++;
          if (batchCount >= 450) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        return res.json({ success: true, stats: { total: articles.length, imported, updated, skipped } });
      }

      if (action === "list-articles") {
        const { categorie, q } = req.query;
        let query = db_firestore.collection("articles_catalog").where("active", "==", true);
        const snap = await query.get();
        let articles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (categorie) {
          const catLower = categorie.toLowerCase();
          articles = articles.filter(a => (a.categorie || "").toLowerCase() === catLower);
        }
        articles.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr", { sensitivity: "base" }));
        if (q) { const ql = q.toLowerCase(); articles = articles.filter(a => a.nom.toLowerCase().includes(ql)); }
        return res.json({ success: true, articles });
      }

      if (action === "update-article" && req.method === "POST") {
        const { id, updates, updated_by } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const allowed = ["nom", "reference", "reference_technique", "unite", "prix_ht", "taux_tva", "prix_ttc", "categorie", "sous_categorie", "type", "multi_ferme"];
        const clean = {};
        for (const k of allowed) { if (updates && updates[k] !== undefined) clean[k] = updates[k]; }
        clean.updated_at = Date.now();
        clean.updated_by = updated_by || {};
        await db_firestore.collection("articles_catalog").doc(id).update(clean);
        return res.json({ success: true });
      }

      if (action === "create-article" && req.method === "POST") {
        const { reference, nom, unite, prix_ht, taux_tva, prix_ttc, categorie, sous_categorie, type, reference_technique, multi_ferme, created_by } = req.body;
        if (!nom || !reference) return res.status(400).json({ success: false, error: "Nom et référence requis" });
        const existing = await db_firestore.collection("articles_catalog").doc(reference).get();
        if (existing.exists && existing.data().active !== false) return res.status(400).json({ success: false, error: "Un article avec cette référence existe déjà" });
        const now = Date.now();
        await db_firestore.collection("articles_catalog").doc(reference).set({
          reference, nom, unite: unite || "U", prix_ht: prix_ht || 0, taux_tva: taux_tva || 20,
          prix_ttc: prix_ttc || 0, categorie: categorie || "", sous_categorie: sous_categorie || "",
          type: type || "", reference_technique: reference_technique || "", multi_ferme: multi_ferme || false,
          active: true, invisible: false, created_at: now, updated_at: now, created_by: created_by || {}
        });
        return res.json({ success: true, id: reference });
      }

      if (action === "request-delete-article" && req.method === "POST") {
        const { article_id, article_nom, requested_by } = req.body;
        if (!article_id) return res.status(400).json({ success: false, error: "article_id requis" });
        const now = Date.now();
        const ref = await db_firestore.collection("article_delete_requests").add({
          article_id, article_nom: article_nom || "", status: "pending",
          requested_by: requested_by || {}, requested_at: now, validated_by: null, validated_at: null
        });
        return res.json({ success: true, id: ref.id });
      }

      if (action === "validate-delete-article" && req.method === "POST") {
        const { request_id, approved, validated_by } = req.body;
        if (!request_id) return res.status(400).json({ success: false, error: "request_id requis" });
        const docRef = db_firestore.collection("article_delete_requests").doc(request_id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
        const data = snap.data();
        const now = Date.now();
        if (approved) {
          await db_firestore.collection("articles_catalog").doc(data.article_id).update({ active: false, updated_at: now });
          await docRef.update({ status: "approved", validated_by: validated_by || {}, validated_at: now });
        } else {
          await docRef.update({ status: "rejected", validated_by: validated_by || {}, validated_at: now });
        }
        return res.json({ success: true });
      }

      if (action === "list-delete-requests") {
        const { status } = req.query;
        let query = db_firestore.collection("article_delete_requests");
        if (status) query = query.where("status", "==", status);
        const snap = await query.get();
        const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        requests.sort((a, b) => (b.requested_at || 0) - (a.requested_at || 0));
        return res.json({ success: true, requests });
      }

      // ========== CODES ANALYTIQUES ==========

      if (action === "list-codes-analytiques") {
        const snap = await db_firestore.collection("config_analytique").where("actif", "==", true).orderBy("code").get();
        return res.json({ success: true, codes: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }

      if (action === "save-code-analytique" && req.method === "POST") {
        const { id, code, libelle, ferme, categorie_achat, nature_cpc, saved_by } = req.body;
        if (!code || !libelle) return res.status(400).json({ success: false, error: "Code et libellé requis" });
        const data = { code, libelle, ferme: ferme || "Toutes", categorie_achat: categorie_achat || "autre",
          nature_cpc: nature_cpc || "621", actif: true, updated_at: Date.now(), updated_by: saved_by || {} };
        if (id) {
          await db_firestore.collection("config_analytique").doc(id).update(data);
          return res.json({ success: true, id });
        } else {
          const ref = await db_firestore.collection("config_analytique").add({ ...data, created_at: Date.now() });
          return res.json({ success: true, id: ref.id });
        }
      }

      if (action === "delete-code-analytique" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        await db_firestore.collection("config_analytique").doc(id).update({ actif: false });
        return res.json({ success: true });
      }

      // ========== CONSULTATIONS (Appels d'offres) ==========

      if (action === "list-consultations") {
        const { ferme, status } = req.query;
        let q = db_firestore.collection("consultations");
        if (ferme) q = q.where("ferme", "==", ferme);
        if (status) q = q.where("status", "==", status);
        const snap = await q.orderBy("created_at", "desc").get();
        return res.json({ success: true, consultations: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }

      if (action === "create-consultation" && req.method === "POST") {
        const { ferme, objet, date_limite_reponse, items_demandes, created_by } = req.body;
        if (!ferme || !objet) return res.status(400).json({ success: false, error: "Ferme et objet requis" });
        const numero = await getNextNumber("consultation", "CON");
        const now = Date.now();
        const ref = await db_firestore.collection("consultations").add({
          numero, status: "en_cours", ferme, objet,
          date_limite_reponse: date_limite_reponse || "",
          items_demandes: items_demandes || [],
          offres: [],
          offre_retenue_index: null,
          bdc_id: null,
          created_by: created_by || {},
          created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: ref.id, numero });
      }

      if (action === "add-offre" && req.method === "POST") {
        const { consultation_id, offre, updated_by } = req.body;
        if (!consultation_id || !offre) return res.status(400).json({ success: false, error: "consultation_id et offre requis" });
        const docRef = db_firestore.collection("consultations").doc(consultation_id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Consultation introuvable" });
        const data = snap.data();
        const offres = data.offres || [];
        // Upsert: remplacer si même fournisseur_id, sinon ajouter
        const idx = offres.findIndex(o => o.fournisseur_id === offre.fournisseur_id);
        const newOffre = {
          fournisseur_id: offre.fournisseur_id || "",
          fournisseur_nom: offre.fournisseur_nom || "",
          date_reception: offre.date_reception || "",
          delai_livraison: offre.delai_livraison || 0,
          conditions_paiement: offre.conditions_paiement || "",
          items: offre.items || [],
          total_ht: offre.total_ht || 0,
          justificatif_url: offre.justificatif_url || null,
          retenu: false,
        };
        if (idx >= 0) offres[idx] = newOffre; else offres.push(newOffre);
        await docRef.update({ offres, updated_at: Date.now(), updated_by: updated_by || {} });
        return res.json({ success: true, offre_index: idx >= 0 ? idx : offres.length - 1 });
      }

      if (action === "retenir-offre" && req.method === "POST") {
        const { consultation_id, offre_index, retained_by } = req.body;
        if (consultation_id === undefined || offre_index === undefined) {
          return res.status(400).json({ success: false, error: "consultation_id et offre_index requis" });
        }
        const docRef = db_firestore.collection("consultations").doc(consultation_id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Consultation introuvable" });
        const data = snap.data();
        const offres = (data.offres || []).map((o, i) => ({ ...o, retenu: i === offre_index }));
        await docRef.update({
          offres,
          offre_retenue_index: offre_index,
          status: "cloturee",
          retained_by: retained_by || {},
          retained_at: Date.now(),
          updated_at: Date.now(),
        });
        return res.json({ success: true });
      }

      if (action === "link-bdc-consultation" && req.method === "POST") {
        const { consultation_id, bdc_id } = req.body;
        if (!consultation_id || !bdc_id) return res.status(400).json({ success: false, error: "consultation_id et bdc_id requis" });
        await db_firestore.collection("consultations").doc(consultation_id).update({ bdc_id, updated_at: Date.now() });
        return res.json({ success: true });
      }

      // ========== DEMANDES DE VIREMENT ==========

      if (action === "list-demandes-virement") {
        const { status } = req.query;
        let q = db_firestore.collection("demandes_virement");
        if (status) q = q.where("status", "==", status);
        const snap = await q.orderBy("created_at", "desc").get();
        return res.json({ success: true, demandes: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }

      if (action === "create-demande-virement" && req.method === "POST") {
        const { facture_id, bdc_id, fournisseur, montant_ttc, motif, created_by } = req.body;
        if (!facture_id || !montant_ttc) return res.status(400).json({ success: false, error: "facture_id et montant_ttc requis" });
        const numero = await getNextNumber("virement", "VIR");
        const now = Date.now();
        const ref = await db_firestore.collection("demandes_virement").add({
          numero, facture_id, bdc_id: bdc_id || null,
          fournisseur: fournisseur || { nom: "", ice: "", rib: "" },
          montant_ttc: Number(montant_ttc),
          motif: motif || "",
          status: "en_attente",
          created_by: created_by || {},
          approved_by: null, executed_by: null,
          created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: ref.id, numero });
      }

      if (action === "validate-virement" && req.method === "POST") {
        const { id, decision, rib, date_execution, comment, validated_by } = req.body;
        if (!id || !decision) return res.status(400).json({ success: false, error: "id et decision requis" });
        if (!["approuve", "execute", "rejete"].includes(decision)) {
          return res.status(400).json({ success: false, error: "Decision invalide" });
        }
        const updates = { status: decision, updated_at: Date.now(), validated_by: validated_by || {} };
        if (decision === "approuve") {
          updates.approved_by = validated_by || {};
          updates.approved_at = Date.now();
          if (rib) updates["fournisseur.rib"] = rib;
        } else if (decision === "execute") {
          updates.executed_by = validated_by || {};
          updates.executed_at = date_execution ? new Date(date_execution).getTime() : Date.now();
          if (rib) updates["fournisseur.rib"] = rib;
        } else if (decision === "rejete") {
          updates.rejected_by = validated_by || {};
          updates.rejected_at = Date.now();
          updates.reject_comment = comment || "";
        }
        await db_firestore.collection("demandes_virement").doc(id).update(updates);
        return res.json({ success: true });
      }

      // ========== TRACKING COMMANDES PAR FERME ==========

      if (action === "track-orders") {
        const { ferme } = req.query;
        const now = Date.now();

        // 3 requêtes en parallèle
        const bdcQuery = ferme
          ? db_firestore.collection("purchase_orders").where("ferme", "==", ferme).orderBy("created_at", "desc").limit(100)
          : db_firestore.collection("purchase_orders").orderBy("created_at", "desc").limit(100);

        const [bdcSnap, blSnap, invSnap] = await Promise.all([
          bdcQuery.get(),
          db_firestore.collection("delivery_notes").orderBy("created_at", "desc").limit(500).get(),
          db_firestore.collection("invoices").orderBy("created_at", "desc").limit(500).get(),
        ]);

        // Index BL et factures par bdc_id
        const blsByBdc = {};
        blSnap.docs.forEach(d => {
          const bl = d.data();
          if (bl.bdc_id && !blsByBdc[bl.bdc_id]) blsByBdc[bl.bdc_id] = { id: d.id, ...bl };
        });
        const invsByBdc = {};
        invSnap.docs.forEach(d => {
          const inv = d.data();
          if (inv.bdc_id && !invsByBdc[inv.bdc_id]) invsByBdc[inv.bdc_id] = { id: d.id, ...inv };
        });

        const STEPS = [
          { key: "cree",    label: "BDC Créé",   icon: "📋" },
          { key: "chef",    label: "Chef Ferme",  icon: "✅" },
          { key: "dg",      label: "DG Approuvé", icon: "🔏" },
          { key: "envoye",  label: "Envoyé",      icon: "📤" },
          { key: "livre",   label: "BL Reçu",     icon: "📦" },
          { key: "facture", label: "Facturé",     icon: "🧾" },
          { key: "paye",    label: "Payé",        icon: "💳" },
        ];

        // SLA par étape (en ms) pour détecter les retards
        const SLA = { cree: 2, chef: 3, dg: 3, envoye: 7, livre: 14, facture: 7, paye: 30 };

        const orders = bdcSnap.docs.map(doc => {
          const bdc = { id: doc.id, ...doc.data() };
          const history = bdc.history || [];
          const bl  = blsByBdc[bdc.id];
          const inv = invsByBdc[bdc.id];

          const getHistAt = (actionName) => {
            const e = history.find(h => h.action === actionName);
            return e ? e.at : null;
          };

          const paidAt = inv && inv.payment_status === "payee"
            ? (inv.paid_at || (inv.history || []).find(h => h.action === "paiement")?.at || null)
            : null;

          const stepTimes = {
            cree:    bdc.created_at,
            chef:    getHistAt("validation_chef"),
            dg:      getHistAt("validation_dg"),
            envoye:  getHistAt("envoi_fournisseur"),
            livre:   bl  ? bl.created_at  : null,
            facture: inv ? inv.created_at : null,
            paye:    paidAt,
          };

          // Si BDC rejeté, marquer la dernière étape atteinte comme bloquée
          const isRejected = ["rejete"].includes(bdc.status);

          let lastDoneIdx = -1;
          const steps = STEPS.map((s, i) => {
            const at = stepTimes[s.key];
            const done = at !== null;
            if (done) lastDoneIdx = i;
            return { ...s, at, done };
          });

          const isComplete = lastDoneIdx === STEPS.length - 1;
          const currentStepIdx = isComplete ? STEPS.length - 1 : Math.min(lastDoneIdx + 1, STEPS.length - 1);

          steps.forEach((s, i) => {
            s.isCurrent = !isComplete && i === currentStepIdx;
            s.isBlocked  = isRejected && i === currentStepIdx;
          });

          // Durées entre étapes
          const durations = [];
          for (let i = 1; i < STEPS.length; i++) {
            const prev = steps[i - 1];
            const curr = steps[i];
            if (prev.at && curr.at) {
              durations.push({ from: prev.key, to: curr.key, ms: curr.at - prev.at, pending: false });
            } else if (prev.at && !curr.at && curr.isCurrent) {
              durations.push({ from: prev.key, to: curr.key, ms: now - prev.at, pending: true });
            } else {
              durations.push({ from: prev.key, to: curr.key, ms: null, pending: false });
            }
          }

          // Retard : étape courante dépasse son SLA
          const slaDays = SLA[STEPS[currentStepIdx]?.key] || 7;
          const lastDoneAt = lastDoneIdx >= 0 ? steps[lastDoneIdx].at : bdc.created_at;
          const isLate = !isComplete && !isRejected && lastDoneAt && (now - lastDoneAt) > slaDays * 86400000;

          return {
            id: bdc.id, numero: bdc.numero, ferme: bdc.ferme,
            fournisseur: bdc.fournisseur, total_ttc: bdc.total_ttc,
            code_analytique: bdc.code_analytique, mode_paiement: bdc.mode_paiement,
            status: bdc.status, is_complete: isComplete, is_late: isLate, is_rejected: isRejected,
            current_step: STEPS[currentStepIdx]?.key,
            current_step_label: STEPS[currentStepIdx]?.label,
            steps, durations,
            created_at: bdc.created_at,
            bl_numero: bl?.numero_bl_fournisseur || null,
            facture_numero: inv?.numero_facture || null,
          };
        });

        // KPIs globaux
        const enCours  = orders.filter(o => !o.is_complete && !o.is_rejected);
        const termines = orders.filter(o => o.is_complete);
        const enRetard = orders.filter(o => o.is_late);

        // Délai moyen total (de créé à payé) sur commandes terminées
        let delaiMoyenMs = null;
        const withFullDuration = termines.filter(o => o.steps[0].at && o.steps[STEPS.length - 1].at);
        if (withFullDuration.length) {
          const total = withFullDuration.reduce((sum, o) => sum + (o.steps[STEPS.length - 1].at - o.steps[0].at), 0);
          delaiMoyenMs = Math.round(total / withFullDuration.length);
        }

        // Délai moyen par étape
        const stepAvg = {};
        STEPS.slice(1).forEach((s, idx) => {
          const vals = orders.map(o => o.durations[idx]).filter(d => d && d.ms !== null && !d.pending);
          if (vals.length) stepAvg[s.key] = Math.round(vals.reduce((s, d) => s + d.ms, 0) / vals.length);
        });

        return res.json({ success: true, orders, kpis: {
          en_cours: enCours.length,
          termines: termines.length,
          en_retard: enRetard.length,
          delai_moyen_ms: delaiMoyenMs,
          step_avg_ms: stepAvg,
        }});
      }

      // ========== ANALYSES FOLIAIRES ==========

      if (action === "list-analyses-foliaires") {
        const { ferme, parcelle, statut } = req.query;
        const now = Date.now();
        const PARCELLES_MAP = {
          F1: ["P1-Myrtille A","P2-Myrtille B","P3-Framboise","P4-Myrtille C","P5-Framboise B"],
          F5: ["P1-Myrtille","P2-Framboise A","P3-Framboise B","P4-Myrtille D"],
          Avocatier: ["P1-Hass","P2-Hass B","P3-Fuerte"],
        };
        let q = db_firestore.collection("analyses_foliaires");
        if (ferme) q = q.where("ferme", "==", ferme);
        if (parcelle) q = q.where("parcelle", "==", parcelle);
        if (statut) q = q.where("statut", "==", statut);
        const snap = await q.orderBy("created_at", "desc").get();
        const THREE_DAYS = 3 * 86400000;
        const THIRTY_DAYS = 30 * 86400000;
        const analyses = snap.docs.map(d => {
          const a = { id: d.id, ...d.data() };
          a.is_result_late = a.statut === "prelevee" && a.date_prelevement && (now - a.date_prelevement) > THREE_DAYS;
          return a;
        });

        // Parcelles en retard de fréquence (>30j sans completee)
        const parcelles_overdue = [];
        const fermes = ferme ? [ferme] : Object.keys(PARCELLES_MAP);
        for (const f of fermes) {
          for (const p of (PARCELLES_MAP[f] || [])) {
            const derniere = analyses.filter(a => a.ferme === f && a.parcelle === p && a.statut === "completee")
              .sort((a, b) => (b.date_resultat || 0) - (a.date_resultat || 0))[0];
            const sinceMs = derniere ? now - derniere.date_resultat : Infinity;
            if (sinceMs > THIRTY_DAYS) parcelles_overdue.push({ ferme: f, parcelle: p, days_since: Math.floor(sinceMs / 86400000), never: !derniere });
          }
        }

        const counts = {
          demandees: analyses.filter(a => a.statut === "demandee").length,
          commandees: analyses.filter(a => a.statut === "commandee").length,
          prelevees: analyses.filter(a => a.statut === "prelevee").length,
          completees: analyses.filter(a => a.statut === "completee").length,
          en_retard: analyses.filter(a => a.is_result_late).length,
        };
        return res.json({ success: true, analyses, parcelles_overdue, counts });
      }

      if (action === "create-analyse-foliaire" && req.method === "POST") {
        const { ferme, parcelle, culture, note_demande, photo_base64, photo_filename, created_by } = req.body;
        if (!ferme || !parcelle) return res.status(400).json({ success: false, error: "ferme et parcelle requis" });
        const numero = await getNextNumber("analyse_foliaire", "AF");
        const now = Date.now();
        const data = {
          numero, ferme, parcelle,
          culture: culture || (parcelle.toLowerCase().includes("hass") || parcelle.toLowerCase().includes("fuerte") ? "Avocatier" : parcelle.toLowerCase().includes("framboise") ? "Framboise" : "Myrtille"),
          statut: "demandee",
          date_demande: now,
          date_prelevement: null,
          date_resultat: null,
          bdc_id: null,
          photo_parcelle_url: null,
          scan_resultat_url: null,
          note_demande: note_demande || "",
          recommandations_ia: [],
          history: [{ action: "creation", by: created_by || {}, at: now, comment: "" }],
          created_by: created_by || {},
          created_at: now, updated_at: now,
        };
        const ref = await db_firestore.collection("analyses_foliaires").add(data);

        // Upload photo si fournie
        if (photo_base64) {
          try {
            const buffer = Buffer.from(photo_base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
            const ext = (photo_filename || "photo.jpg").split(".").pop() || "jpg";
            const storagePath = `analyses_foliaires/${ref.id}/photo_parcelle.${ext}`;
            const file = bucket.file(storagePath);
            await file.save(buffer, { metadata: { contentType: `image/${ext}` } });
            const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
            await ref.update({ photo_parcelle_url: url });
            data.photo_parcelle_url = url;
          } catch (e) { console.error("Upload photo AF:", e.message); }
        }

        return res.json({ success: true, id: ref.id, numero });
      }

      if (action === "update-analyse-foliaire" && req.method === "POST") {
        const { id, statut, bdc_id, comment, updated_by } = req.body;
        if (!id || !statut) return res.status(400).json({ success: false, error: "id et statut requis" });
        const VALID = ["demandee","commandee","prelevee","completee"];
        if (!VALID.includes(statut)) return res.status(400).json({ success: false, error: "Statut invalide" });
        const docRef = db_firestore.collection("analyses_foliaires").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Analyse non trouvée" });
        const current = snap.data();
        const updates = { statut, updated_at: Date.now(), updated_by: updated_by || {} };
        if (bdc_id) updates.bdc_id = bdc_id;
        if (statut === "prelevee" && !current.date_prelevement) updates.date_prelevement = Date.now();
        const history = current.history || [];
        history.push({ action: `passage_${statut}`, by: updated_by || {}, at: Date.now(), comment: comment || "" });
        updates.history = history;
        await docRef.update(updates);
        return res.json({ success: true });
      }

      if (action === "upload-scan-analyse" && req.method === "POST") {
        const { id, scan_base64, filename, uploaded_by } = req.body;
        if (!id || !scan_base64) return res.status(400).json({ success: false, error: "id et scan_base64 requis" });
        const docRef = db_firestore.collection("analyses_foliaires").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Analyse non trouvée" });
        const buffer = Buffer.from(scan_base64.replace(/^data:image\/\w+;base64,|^data:application\/pdf;base64,/, ""), "base64");
        const ext = (filename || "scan.pdf").split(".").pop() || "pdf";
        const storagePath = `analyses_foliaires/${id}/scan_resultat.${ext}`;
        const contentType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        const current = snap.data();
        const history = current.history || [];
        history.push({ action: "upload_scan", by: uploaded_by || {}, at: Date.now(), comment: "" });
        await docRef.update({ scan_resultat_url: scan_url, date_resultat: Date.now(), statut: "completee", history, updated_at: Date.now() });
        return res.json({ success: true, scan_url });
      }

      if (action === "generate-reco-foliaire" && req.method === "POST") {
        const { id, parcelle, ferme, culture, photo_url, scan_url, note_demande } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.json({ success: false, error: "Clé API Anthropic non configurée" });

        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const messageContent = [];

        // Charger les images depuis leurs URLs
        const loadImage = async (url) => {
          if (!url) return null;
          try {
            const https = require("https");
            const http = require("http");
            const mod = url.startsWith("https") ? https : http;
            return await new Promise((resolve, reject) => {
              mod.get(url, (resp) => {
                const chunks = [];
                resp.on("data", c => chunks.push(c));
                resp.on("end", () => resolve({ data: Buffer.concat(chunks), type: resp.headers["content-type"] || "image/jpeg" }));
              }).on("error", reject);
            });
          } catch (e) { console.error("Erreur image AF:", e.message); return null; }
        };

        const [photoImg, scanImg] = await Promise.all([loadImage(photo_url), loadImage(scan_url)]);
        if (photoImg) messageContent.push({ type: "image", source: { type: "base64", media_type: photoImg.type, data: photoImg.data.toString("base64") } });
        if (scanImg && !scanImg.type.includes("pdf")) messageContent.push({ type: "image", source: { type: "base64", media_type: scanImg.type, data: scanImg.data.toString("base64") } });

        const prompt = `Tu es un ingénieur agronome expert en analyses foliaires pour cultures de petits fruits rouges (myrtilles, framboises) et avocatiers au Maroc (région Souss-Massa).

PARCELLE : ${parcelle || "Non spécifiée"}
FERME : ${ferme || "Non spécifiée"}
CULTURE : ${culture || "Non spécifiée"}
NOTES DU CHEF DE FERME : ${note_demande || "Aucune"}

${photoImg ? "Une photo de la parcelle au moment du prélèvement est jointe." : ""}
${scanImg ? "Le rapport d'analyse foliaire est joint (scan)." : "Pas de scan fourni — basez-vous sur les informations disponibles."}

Sur la base de ces éléments, fournis une analyse structurée :

1. **État nutritionnel** : Interprétation des niveaux (N, P, K, Ca, Mg, Fe, Zn, Mn, B) par rapport aux normes foliaires pour la culture. Indiquer si chaque élément est déficient, optimal ou en excès.
2. **Diagnostic visuel** (si photo disponible) : Signes observés sur le feuillage — couleur, texture, symptômes éventuels.
3. **Plan de correction fertigation** : Ajustements recommandés (éléments, doses en kg/ha ou g/L, fréquence, formulations commerciales disponibles au Maroc).
4. **Actions prioritaires** : 3 actions concrètes à entreprendre dans les 7 prochains jours.
5. **Suivi** : KPIs à mesurer et fréquence recommandée de la prochaine analyse foliaire.

Réponds en français. Utilise des données chiffrées et des comparaisons avec les normes standard.`;

        messageContent.push({ type: "text", text: prompt });

        let response;
        for (const modelId of ["claude-opus-4-20250514", "claude-sonnet-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2500, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle", modelId, e.message);
            if (modelId === "claude-sonnet-4-20250514") throw e;
          }
        }

        const message = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        const reco = { message, model: response.model || "claude", generated_at: Date.now(), has_photo: !!photoImg, has_scan: !!scanImg };

        // Sauvegarder dans Firestore
        const docRef = db_firestore.collection("analyses_foliaires").doc(id);
        const snap = await docRef.get();
        if (snap.exists) {
          const existing = snap.data().recommandations_ia || [];
          existing.push(reco);
          await docRef.update({ recommandations_ia: existing, updated_at: Date.now() });
        }

        return res.json({ success: true, recommandation: reco });
      }

      // ========== SCAN FACTURES (AI-powered invoice scanning) ==========

      if (action === "scan-facture" && req.method === "POST") {
        const { scan_base64, filename, ferme, created_by } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.pdf").split(".").pop().toLowerCase() || "pdf";
        const ts = Date.now();
        const storagePath = `scans/factures/${ts}_${filename || "scan." + ext}`;
        const contentType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const messageContent = [];
        const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
        const isPdf = ext === "pdf";

        if (isImage) {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } });
        } else if (isPdf) {
          // Try text extraction first
          let pdfText = "";
          try {
            const pdfParse = require("pdf-parse");
            const pdfData = await pdfParse(buffer);
            pdfText = pdfData.text || "";
          } catch (e) { console.error("pdf-parse error:", e.message); }

          if (pdfText.length > 50) {
            messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
          } else {
            // Scanned PDF - send as document to Claude
            messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 } });
          }
        }

        const currentYear = new Date().getFullYear();
        const FACTURE_PROMPT = `Tu es un assistant spécialisé dans l'analyse de factures fournisseur pour Berry Good Farms.

ÉTAPE 1 - VÉRIFICATION (les 3 conditions doivent être remplies, sinon ACCEPTE):
1. Le nom du client sur la facture contient "BERRY GOOD" ou "BGF" (peu importe la forme juridique ou la ville)
2. Une adresse postale du client est mentionnée (n'importe quelle adresse au Maroc)
3. Un numéro ICE client est présent (nos ICE: 002106859000069 ou 001536944000082)
4. La date de la facture est de l'année ${currentYear}

IMPORTANT: Berry Good Farms a PLUSIEURS sites au Maroc (Agadir, Laarache, etc). Ne rejette PAS à cause de la ville ou l'adresse. Accepte tant que le nom contient "BERRY GOOD" ou "BGF".
Si ce n'est clairement PAS une facture pour Berry Good Farms → REJETTE avec explication.

ÉTAPE 2 - EXTRACTION DES DONNÉES:
Extrais les champs suivants en JSON strict:
{
  "accepted": true/false,
  "rejection_reason": "..." (si rejeté, explique pourquoi),
  "fournisseur": { "nom": "...", "ice": "...", "adresse": "..." },
  "numero_facture": "...",
  "date_facture": "YYYY-MM-DD",
  "date_echeance": "YYYY-MM-DD",
  "items": [
    { "article": "...", "quantite": 0, "unite": "...", "prix_unitaire": 0, "taux_tva": 20, "montant_ht": 0 }
  ],
  "total_ht": 0,
  "total_tva": 0,
  "total_ttc": 0,
  "confidence": 0.0,
  "notes": "..."
}

IMPORTANT: Retourne UNIQUEMENT le JSON, sans texte avant ou après. Les montants sont en MAD (Dirhams marocains). Si un champ n'est pas lisible, mets null.`;

        messageContent.push({ type: "text", text: FACTURE_PROMPT });

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-facture", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const aiText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis;
        try {
          // Try to extract JSON from the response
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA impossible - réponse non structurée", raw: aiText });
        }

        // 4) BDC Matching (if accepted)
        let matched_bdc = null;
        if (analysis.accepted) {
          const fournisseurNom = (analysis.fournisseur?.nom || "").toLowerCase().trim();
          const totalTtc = parseFloat(analysis.total_ttc) || 0;

          // Try matching by fournisseur name
          if (fournisseurNom) {
            const bdcSnap = await db_firestore.collection("purchase_orders")
              .where("status", "in", ["valide_dg", "envoye"])
              .orderBy("created_at", "desc").limit(100).get();

            const candidates = bdcSnap.docs
              .map(d => ({ id: d.id, ...d.data() }))
              .filter(b => {
                const bNom = (b.fournisseur?.nom || "").toLowerCase().trim();
                return bNom.includes(fournisseurNom) || fournisseurNom.includes(bNom);
              });

            if (candidates.length > 0) {
              // Rank by amount proximity
              candidates.sort((a, b) => {
                const aDiff = Math.abs((a.total_ttc || 0) - totalTtc);
                const bDiff = Math.abs((b.total_ttc || 0) - totalTtc);
                return aDiff - bDiff;
              });
              const best = candidates[0];
              const ecartPct = totalTtc > 0 ? Math.abs((best.total_ttc || 0) - totalTtc) / totalTtc * 100 : 100;
              matched_bdc = {
                id: best.id, numero: best.numero,
                fournisseur_nom: best.fournisseur?.nom || "",
                total_ttc: best.total_ttc || 0,
                ecart_pct: Math.round(ecartPct * 10) / 10,
                confidence: ecartPct < 5 ? "high" : ecartPct < 15 ? "medium" : "low",
                all_candidates: candidates.slice(0, 5).map(c => ({ id: c.id, numero: c.numero, total_ttc: c.total_ttc })),
              };
            }
          }
        }

        // 5) Save scan metadata to Firestore
        const scanData = {
          scan_url, scan_filename: filename || "scan." + ext, scan_type: isImage ? "image" : "pdf",
          status: analysis.accepted ? "accepted" : "rejected",
          rejection_reason: analysis.rejection_reason || null,
          analysis, matched_bdc_id: matched_bdc?.id || null, matched_bdc_numero: matched_bdc?.numero || null,
          invoice_id: null, invoice_numero: null, ferme: ferme || "",
          created_by: created_by || {}, created_at: ts, updated_at: ts,
        };
        const scanDocRef = await db_firestore.collection("invoice_scans").add(scanData);

        return res.json({ success: true, scan_id: scanDocRef.id, scan_url, analysis, matched_bdc });
      }

      // ========== SCAN BL (AI-powered delivery note scanning) ==========

      if (action === "scan-bl" && req.method === "POST") {
        const { scan_base64, filename, created_by } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.pdf").split(".").pop().toLowerCase() || "pdf";
        const ts = Date.now();
        const storagePath = `scans/bl/${ts}_${filename || "scan." + ext}`;
        const contentType = ext === "pdf" ? "application/pdf" : `image/${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const messageContent = [];
        const isImage = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
        const isPdf = ext === "pdf";

        if (isImage) {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } });
        } else if (isPdf) {
          let pdfText = "";
          try {
            const pdfParse = require("pdf-parse");
            const pdfData = await pdfParse(buffer);
            pdfText = pdfData.text || "";
          } catch (e) { console.error("pdf-parse error:", e.message); }

          if (pdfText.length > 50) {
            messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
          } else {
            messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 } });
          }
        }

        const BL_PROMPT = `Tu es un assistant spécialisé dans l'analyse de bons de livraison (BL) pour Berry Good Farms SARL.

Extrais les données du bon de livraison en JSON strict:
{
  "fournisseur_nom": "...",
  "date_reception": "YYYY-MM-DD",
  "numero_bl_fournisseur": "...",
  "numero_bdc_reference": "..." (si un numéro de bon de commande est mentionné, sinon null),
  "items": [
    { "article": "...", "quantite_recue": 0, "unite": "...", "lot": "..." }
  ],
  "notes": "..."
}

IMPORTANT: Retourne UNIQUEMENT le JSON, sans texte avant ou après. Si un champ n'est pas lisible, mets null.`;

        messageContent.push({ type: "text", text: BL_PROMPT });

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-bl", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const aiText = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis;
        try {
          const jsonMatch = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(jsonMatch ? jsonMatch[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA impossible - réponse non structurée", raw: aiText });
        }

        // 4) BDC Matching
        let matched_bdc = null;
        const fournisseurNom = (analysis.fournisseur_nom || "").toLowerCase().trim();
        const bdcRef = analysis.numero_bdc_reference;

        // Try by BDC number reference first
        if (bdcRef) {
          const bdcSnap = await db_firestore.collection("purchase_orders")
            .where("numero", "==", bdcRef).limit(1).get();
          if (!bdcSnap.empty) {
            const d = bdcSnap.docs[0];
            matched_bdc = { id: d.id, numero: d.data().numero, fournisseur_nom: d.data().fournisseur?.nom || "", items: d.data().items || [], confidence: "high" };
          }
        }

        // Fallback: match by fournisseur name
        if (!matched_bdc && fournisseurNom) {
          const bdcSnap = await db_firestore.collection("purchase_orders")
            .where("status", "in", ["valide_dg", "envoye"])
            .orderBy("created_at", "desc").limit(100).get();
          const candidates = bdcSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(b => {
              const bNom = (b.fournisseur?.nom || "").toLowerCase().trim();
              return bNom.includes(fournisseurNom) || fournisseurNom.includes(bNom);
            })
            .filter(b => b.delivery_status !== "complet");

          if (candidates.length > 0) {
            const best = candidates[0];
            matched_bdc = {
              id: best.id, numero: best.numero,
              fournisseur_nom: best.fournisseur?.nom || "",
              items: best.items || [],
              confidence: "medium",
              all_candidates: candidates.slice(0, 5).map(c => ({ id: c.id, numero: c.numero })),
            };
          }
        }

        // 5) Save scan metadata
        const scanData = {
          scan_url, scan_filename: filename || "scan." + ext, scan_type: isImage ? "image" : "pdf",
          analysis, matched_bdc_id: matched_bdc?.id || null, matched_bdc_numero: matched_bdc?.numero || null,
          bl_id: null, bl_numero: null,
          created_by: created_by || {}, created_at: ts,
        };
        const scanDocRef = await db_firestore.collection("bl_scans").add(scanData);

        return res.json({ success: true, scan_id: scanDocRef.id, scan_url, analysis, matched_bdc });
      }

      // ========== SCAN HISTORY ==========

      if (action === "list-scan-history") {
        const type = req.query.type || "facture"; // "facture" or "bl"
        const limit = parseInt(req.query.limit || "50");
        const collection = type === "bl" ? "bl_scans" : "invoice_scans";
        const snap = await db_firestore.collection(collection).orderBy("created_at", "desc").limit(limit).get();
        const scans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, scans });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur Stock Management:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// AUTH: User management & authentication
// =============================================

// verifyAuth imported from ./middleware/requireAuth (see top of file)

// GET /api/auth?action=me — get current user's profile
// POST /api/auth?action=login-check — same but for POST
exports.authApi = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB", minInstances: 1 })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const action = req.query.action || "me";

      if (action === "me") {
        const decoded = await verifyAuth(req);
        if (!decoded) return res.status(401).json({ success: false, error: "Non authentifié" });

        let userDoc = await db_firestore.collection("users").doc(decoded.uid).get();
        // If no doc by UID (e.g. first Google login), search by email and migrate
        if (!userDoc.exists && decoded.email) {
          const emailSnap = await db_firestore.collection("users")
            .where("email", "==", decoded.email).limit(1).get();
          if (!emailSnap.empty) {
            const oldDoc = emailSnap.docs[0];
            const oldData = oldDoc.data();
            // Create doc with correct UID and delete old placeholder
            await db_firestore.collection("users").doc(decoded.uid).set(oldData);
            if (oldDoc.id !== decoded.uid) await oldDoc.ref.delete();
            userDoc = await db_firestore.collection("users").doc(decoded.uid).get();
          }
        }
        if (!userDoc.exists) {
          return res.status(404).json({ success: false, error: "Utilisateur non configuré. Contactez l'administrateur." });
        }
        const data = userDoc.data();
        if (data.disabled) {
          return res.json({ success: false, error: "Compte désactivé", disabled: true });
        }

        // Log connection for non-admin users (direct connections only)
        if (data.role !== 'admin') {
          const now = Date.now();
          const lastLogged = data.lastLoggedAt || 0;
          if (now - lastLogged > 5 * 60 * 1000) {
            db_firestore.collection('connection_logs').add({
              uid: decoded.uid,
              email: decoded.email,
              profileId: data.profileId || '',
              displayName: data.displayName || '',
              role: data.role || 'user',
              timestampMs: now,
            }).catch(err => console.warn('Connection log error:', err));
            db_firestore.collection('users').doc(decoded.uid).update({ lastLoggedAt: now })
              .catch(err => console.warn('Update lastLoggedAt error:', err));
          }
        }

        return res.json({ success: true, user: { uid: decoded.uid, email: decoded.email, ...data } });
      }

      // ---- Admin actions ----
      const decoded = await verifyAuth(req);
      if (!decoded) return res.status(401).json({ success: false, error: "Non authentifié" });

      const callerDoc = await db_firestore.collection("users").doc(decoded.uid).get();
      if (!callerDoc.exists || callerDoc.data().role !== "admin") {
        return res.status(403).json({ success: false, error: "Accès réservé aux administrateurs" });
      }

      // LIST users
      if (action === "list") {
        const snap = await db_firestore.collection("users").get();
        const users = [];
        for (const doc of snap.docs) {
          const d = doc.data();
          let authUser = null;
          try { authUser = await admin.auth().getUser(doc.id); } catch (e) {}
          users.push({
            uid: doc.id,
            email: authUser ? authUser.email : d.email,
            displayName: d.displayName || "",
            profileId: d.profileId || "",
            role: d.role || "user",
            disabled: d.disabled || false,
            googleLinked: authUser ? authUser.providerData.some(p => p.providerId === "google.com") : false,
            lastSignIn: authUser ? authUser.metadata.lastSignInTime : null,
            createdAt: d.createdAt || null,
          });
        }
        return res.json({ success: true, users });
      }

      // CREATE user
      if (action === "create" && req.method === "POST") {
        const { email, password, displayName, profileId, role } = req.body;
        if (!email || !password || !profileId) {
          return res.status(400).json({ success: false, error: "Email, mot de passe et profil requis" });
        }
        const userRecord = await admin.auth().createUser({
          email, password, displayName: displayName || email,
        });
        await db_firestore.collection("users").doc(userRecord.uid).set({
          email, displayName: displayName || "", profileId,
          role: role || "user", disabled: false,
          createdAt: Date.now(), createdBy: decoded.uid, updatedAt: Date.now(),
        });
        return res.json({ success: true, uid: userRecord.uid });
      }

      // UPDATE user
      if (action === "update" && req.method === "POST") {
        const { uid, displayName, profileId, role, disabled, password } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: "UID requis" });

        const updates = { updatedAt: Date.now() };
        const authUpdates = {};

        if (displayName !== undefined) { updates.displayName = displayName; authUpdates.displayName = displayName; }
        if (profileId !== undefined) updates.profileId = profileId;
        if (role !== undefined) updates.role = role;
        if (disabled !== undefined) updates.disabled = disabled;
        if (password) authUpdates.password = password;

        if (Object.keys(authUpdates).length > 0) {
          try {
            await admin.auth().updateUser(uid, authUpdates);
          } catch (authErr) {
            // User doesn't exist in Auth — recreate if password provided
            if (authErr.code === 'auth/user-not-found') {
              const userDoc = await db_firestore.collection("users").doc(uid).get();
              const email = userDoc.exists ? userDoc.data().email : null;
              if (email && password) {
                await admin.auth().createUser({ uid, email, password, displayName: displayName || '', disabled: !!disabled });
              } else {
                return res.status(404).json({ success: false, error: "Utilisateur introuvable dans Auth. Fournissez un nouveau mot de passe pour le recréer." });
              }
            } else {
              throw authErr;
            }
          }
        }
        await db_firestore.collection("users").doc(uid).set(updates, { merge: true });
        return res.json({ success: true });
      }

      // DELETE user
      if (action === "delete" && req.method === "POST") {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: "UID requis" });
        if (uid === decoded.uid) return res.status(400).json({ success: false, error: "Impossible de supprimer votre propre compte" });
        try { await admin.auth().deleteUser(uid); } catch (e) {}
        await db_firestore.collection("users").doc(uid).delete();
        return res.json({ success: true });
      }

      // TOGGLE Google Auth
      if (action === "toggle-google" && req.method === "POST") {
        // This is handled client-side via Firebase Auth. Just a placeholder.
        return res.json({ success: true, message: "Google auth is configured client-side" });
      }

      // CONNECTION STATS — for DG adoption tracking
      if (action === "connection-stats") {
        const days = parseInt(req.query.days) || 90;
        const since = Date.now() - (days * 24 * 60 * 60 * 1000);

        const snap = await db_firestore.collection('connection_logs')
          .where('timestampMs', '>=', since)
          .orderBy('timestampMs', 'desc')
          .get();

        const logs = snap.docs.map(doc => {
          const d = doc.data();
          return { uid: d.uid, email: d.email, profileId: d.profileId, displayName: d.displayName, role: d.role, timestampMs: d.timestampMs };
        });

        const usersSnap = await db_firestore.collection('users').get();
        const allUsers = usersSnap.docs
          .map(d => ({ uid: d.id, email: d.data().email, displayName: d.data().displayName || '', profileId: d.data().profileId || '', role: d.data().role || 'user', disabled: d.data().disabled || false }))
          .filter(u => u.role !== 'admin' && !u.disabled);

        return res.json({ success: true, logs, allUsers });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur Auth API:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// Hors Récolte Suivi — Saisie caporal + progression
// =============================================
function setCorsHR(res) {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

exports.horsRecolteService = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCorsHR(res);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const action = req.query.action || (req.body && req.body.action);

      // ---- SAISIE: caporal enregistre le réel du jour ----
      if (action === "saisie" && req.method === "POST") {
        const { ferme, parcelle, tache, nbRealise, nbOuvriers, caporal, nbTotal } = req.body;
        if (!ferme || !parcelle || !tache || nbRealise === undefined || !caporal) {
          return res.status(400).json({ success: false, error: "ferme, parcelle, tache, nbRealise, caporal requis" });
        }

        const today = new Date().toISOString().slice(0, 10);
        const cumulId = `${ferme}_${parcelle}_${tache}`.replace(/\s+/g, "_");
        const saisieId = `${cumulId}_${caporal}`;

        // Upsert today's saisie
        const saisieRef = db_firestore.collection("suivi-hors-recolte").doc(today).collection("saisies").doc(saisieId);
        await saisieRef.set({
          ferme, parcelle, tache,
          nbRealise: Number(nbRealise),
          nbOuvriers: Number(nbOuvriers) || 0,
          caporal,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Update cumul
        const cumulRef = db_firestore.collection("suivi-hors-recolte-cumul").doc(cumulId);
        const cumulSnap = await cumulRef.get();
        const cumulData = cumulSnap.exists ? cumulSnap.data() : { ferme, parcelle, tache, totalRealise: 0, termine: false, historique: [] };

        // Check if we already have a saisie for today in historique
        const existingIdx = (cumulData.historique || []).findIndex(h => h.date === today && h.caporal === caporal);
        let oldNb = 0;
        if (existingIdx >= 0) {
          oldNb = cumulData.historique[existingIdx].nb;
          cumulData.historique[existingIdx].nb = Number(nbRealise);
        } else {
          cumulData.historique.push({ date: today, nb: Number(nbRealise), caporal });
        }

        const newTotal = (cumulData.totalRealise || 0) - oldNb + Number(nbRealise);
        const termine = nbTotal ? newTotal >= Number(nbTotal) : false;

        await cumulRef.set({
          ferme, parcelle, tache,
          totalRealise: newTotal,
          termine,
          derniereMaj: admin.firestore.FieldValue.serverTimestamp(),
          historique: cumulData.historique,
        });

        // ---- Compute daily rendement snapshot for norm detection ----
        try {
          const allSaisiesSnap = await db_firestore.collection("suivi-hors-recolte").doc(today).collection("saisies").get();
          let totalRealiseTask = 0, totalOuvriersTask = 0;
          allSaisiesSnap.forEach(doc => {
            const d = doc.data();
            if (d.ferme === ferme && d.tache === tache) {
              totalRealiseTask += d.nbRealise || 0;
              totalOuvriersTask += d.nbOuvriers || 0;
            }
          });
          const rendementParOuvrier = totalOuvriersTask > 0
            ? Math.round(totalRealiseTask / totalOuvriersTask * 100) / 100
            : 0;

          // Get current norm from Firestore (fallback to hardcoded)
          let normeVal = 0;
          const normeId = `${tache}_${ferme}`.replace(/\s+/g, "_");
          const normeSnap = await db_firestore.collection("normes-productivite").doc(normeId).get();
          if (normeSnap.exists && normeSnap.data().actif) {
            normeVal = normeSnap.data().normeParJourParOuvrier || 0;
          } else {
            // Fallback: try generic norm (no ferme)
            const normeGenSnap = await db_firestore.collection("normes-productivite").doc(tache.replace(/\s+/g, "_")).get();
            if (normeGenSnap.exists && normeGenSnap.data().actif) {
              normeVal = normeGenSnap.data().normeParJourParOuvrier || 0;
            }
          }

          const rendementId = `${ferme}_${tache}`.replace(/\s+/g, "_");
          await db_firestore.collection("suivi-hors-recolte").doc(today).collection("rendements").doc(rendementId).set({
            ferme, tache,
            nbOuvriers: totalOuvriersTask,
            nbRealise: totalRealiseTask,
            rendementParOuvrier,
            normeEnVigueur: normeVal,
            ratioVsNorme: normeVal > 0 ? Math.round(rendementParOuvrier / normeVal * 10000) / 100 : 0,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (rendErr) {
          console.error("Erreur calcul rendement snapshot:", rendErr);
        }

        return res.json({ success: true, totalRealise: newTotal, termine });
      }

      // ---- GET-PROGRESS: récupère la progression par ferme ----
      if (action === "get-progress") {
        const ferme = req.query.ferme;
        let query = db_firestore.collection("suivi-hors-recolte-cumul");
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        const progress = [];
        snap.forEach(doc => {
          const d = doc.data();
          progress.push({
            id: doc.id,
            ferme: d.ferme,
            parcelle: d.parcelle,
            tache: d.tache,
            totalRealise: d.totalRealise || 0,
            termine: d.termine || false,
            derniereMaj: d.derniereMaj ? d.derniereMaj.toDate().toISOString() : null,
            historique: d.historique || [],
          });
        });
        return res.json({ success: true, progress });
      }

      // ---- GET-SAISIES-TODAY: récupère les saisies du jour ----
      if (action === "get-saisies-today") {
        const ferme = req.query.ferme;
        const today = new Date().toISOString().slice(0, 10);
        const snap = await db_firestore.collection("suivi-hors-recolte").doc(today).collection("saisies").get();
        const saisies = [];
        snap.forEach(doc => {
          const d = doc.data();
          if (!ferme || d.ferme === ferme) {
            saisies.push({ id: doc.id, ...d, timestamp: d.timestamp ? d.timestamp.toDate().toISOString() : null });
          }
        });
        return res.json({ success: true, date: today, saisies });
      }

      // ---- DEMANDE-REEXECUTION: caporal demande à refaire une tâche terminée ----
      if (action === "demande-reexecution" && req.method === "POST") {
        const { ferme, parcelle, tache, justification, nbTunnels, caporal } = req.body;
        if (!ferme || !parcelle || !tache || !justification || !caporal) {
          return res.status(400).json({ success: false, error: "ferme, parcelle, tache, justification, caporal requis" });
        }

        const docRef = await db_firestore.collection("suivi-hors-recolte-demandes").add({
          ferme, parcelle, tache,
          justification,
          nbTunnels: Number(nbTunnels) || 0,
          caporal,
          statut: "en_attente",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return res.json({ success: true, id: docRef.id });
      }

      // ---- VALIDER-REEXECUTION: chef valide ou refuse ----
      if (action === "valider-reexecution" && req.method === "POST") {
        const { demandeId, decision, chef } = req.body;
        if (!demandeId || decision === undefined || !chef) {
          return res.status(400).json({ success: false, error: "demandeId, decision, chef requis" });
        }

        const demandeRef = db_firestore.collection("suivi-hors-recolte-demandes").doc(demandeId);
        const demandeSnap = await demandeRef.get();
        if (!demandeSnap.exists) return res.status(404).json({ success: false, error: "Demande non trouvée" });

        const demande = demandeSnap.data();
        await demandeRef.update({
          statut: decision ? "validee" : "refusee",
          validePar: chef,
          valideAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If approved, reset cumul for this task to allow re-execution
        if (decision) {
          const cumulId = `${demande.ferme}_${demande.parcelle}_${demande.tache}`.replace(/\s+/g, "_");
          const cumulRef = db_firestore.collection("suivi-hors-recolte-cumul").doc(cumulId);
          await cumulRef.update({
            totalRealise: 0,
            termine: false,
            historique: admin.firestore.FieldValue.arrayUnion({ date: new Date().toISOString().slice(0, 10), action: "reset", chef, reason: demande.justification }),
          });
        }

        return res.json({ success: true, statut: decision ? "validee" : "refusee" });
      }

      // ---- GET-DEMANDES: récupère les demandes en attente pour une ferme ----
      if (action === "get-demandes") {
        const ferme = req.query.ferme;
        let query = db_firestore.collection("suivi-hors-recolte-demandes").where("statut", "==", "en_attente");
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        const demandes = [];
        snap.forEach(doc => {
          const d = doc.data();
          demandes.push({
            id: doc.id,
            ...d,
            createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
          });
        });
        return res.json({ success: true, demandes });
      }

      // ---- GET-NORMES: retourne les normes actives ----
      if (action === "get-normes") {
        const ferme = req.query.ferme;
        const HARDCODED_NORMES = [
          { tache: 'Désherbage', normeParJourParOuvrier: 4, unite: 'tunnels' },
          { tache: 'Nettoyage', normeParJourParOuvrier: 5, unite: 'tunnels' },
          { tache: 'Aération', normeParJourParOuvrier: 8, unite: 'tunnels' },
          { tache: 'Désherbage à sape', normeParJourParOuvrier: 3, unite: 'tunnels' },
          { tache: 'Nivellement des pots', normeParJourParOuvrier: 2, unite: 'tunnels' },
          { tache: 'Nivellement des sol', normeParJourParOuvrier: 3, unite: 'tunnels' },
          { tache: 'Palissage', normeParJourParOuvrier: 2, unite: 'tunnels' },
          { tache: 'Feuille du sol', normeParJourParOuvrier: 3, unite: 'tunnels' },
          { tache: 'Palissage Pots', normeParJourParOuvrier: 5, unite: 'tunnels' },
          { tache: 'Ramassage Ficelle', normeParJourParOuvrier: 6, unite: 'tunnels' },
        ];
        const snap = await db_firestore.collection("normes-productivite").where("actif", "==", true).get();
        if (snap.empty) {
          return res.json({ success: true, source: "hardcoded", normes: HARDCODED_NORMES });
        }
        const normes = [];
        snap.forEach(doc => {
          const d = doc.data();
          if (!ferme || !d.ferme || d.ferme === ferme) {
            normes.push({ id: doc.id, ...d });
          }
        });
        return res.json({ success: true, source: "firestore", normes });
      }

      // ---- UPDATE-NORME: chef modifie une norme ----
      if (action === "update-norme" && req.method === "POST") {
        const { tache, ferme, nouvelleValeur, raison, modifiePar } = req.body;
        if (!tache || nouvelleValeur === undefined || !modifiePar) {
          return res.status(400).json({ success: false, error: "tache, nouvelleValeur, modifiePar requis" });
        }
        const normeId = ferme ? `${tache}_${ferme}`.replace(/\s+/g, "_") : tache.replace(/\s+/g, "_");
        const normeRef = db_firestore.collection("normes-productivite").doc(normeId);
        const normeSnap = await normeRef.get();
        const ancienneValeur = normeSnap.exists ? (normeSnap.data().normeParJourParOuvrier || 0) : 0;

        await normeRef.set({
          tache, ferme: ferme || null,
          unite: "tunnels",
          normeParJourParOuvrier: Number(nouvelleValeur),
          actif: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        await db_firestore.collection("normes-historique").add({
          tache, ferme: ferme || null,
          ancienneValeur, nouvelleValeur: Number(nouvelleValeur),
          raison: raison || "manual",
          proposePar: modifiePar,
          validePar: modifiePar,
          statut: "validee",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return res.json({ success: true, normeId, ancienneValeur, nouvelleValeur: Number(nouvelleValeur) });
      }

      // ---- GET-PARCELLES-CONFIG: retourne la config parcelles par ferme ----
      if (action === "get-parcelles-config") {
        const ferme = req.query.ferme;
        const HARDCODED_PARCELLES = {
          F5: [
            { parcelle: 'Corina', variete: 'Corina', nbTunnels: 64, unite: 'tunnels' },
            { parcelle: 'Cascade', variete: 'Cascade', nbTunnels: 34, unite: 'tunnels' },
            { parcelle: 'Breeze', variete: 'Breeze', nbTunnels: 16, unite: 'tunnels' },
            { parcelle: 'Reina S9', variete: 'Reyna', nbTunnels: 66, unite: 'tunnels' },
          ],
          F1: [
            { parcelle: 'Maravilla Green Cane', variete: 'Maravilla', nbTunnels: 72, unite: 'tunnels' },
            { parcelle: 'Yazmin Cut Back', variete: 'Yazmin', nbTunnels: 43, unite: 'tunnels' },
          ],
        };
        let query = db_firestore.collection("parcelles-config").where("actif", "==", true);
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        if (snap.empty) {
          if (ferme && HARDCODED_PARCELLES[ferme]) {
            return res.json({ success: true, source: "hardcoded", parcelles: HARDCODED_PARCELLES[ferme] });
          }
          return res.json({ success: true, source: "hardcoded", parcelles: ferme ? [] : HARDCODED_PARCELLES });
        }
        const parcelles = [];
        snap.forEach(doc => parcelles.push({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, source: "firestore", parcelles });
      }

      // ---- UPDATE-PARCELLE-CONFIG: modifie la config d'une parcelle ----
      if (action === "update-parcelle-config" && req.method === "POST") {
        const { ferme, parcelle, variete, nbTunnels, unite } = req.body;
        if (!ferme || !parcelle || nbTunnels === undefined) {
          return res.status(400).json({ success: false, error: "ferme, parcelle, nbTunnels requis" });
        }
        const docId = `${ferme}_${parcelle}`.replace(/\s+/g, "_");
        await db_firestore.collection("parcelles-config").doc(docId).set({
          ferme, parcelle,
          variete: variete || "",
          nbTunnels: Number(nbTunnels),
          unite: unite || "tunnels",
          actif: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return res.json({ success: true, id: docId });
      }

      // ---- DETECT-NORM-ADJUSTMENTS: analyse rendements et propose des ajustements ----
      if (action === "detect-norm-adjustments") {
        const DAYS_LOOKBACK = 14;
        const MIN_DAYS = 7;
        const MIN_WORKERS_PER_DAY = 3;
        const THRESHOLD_PCT = 120;

        const dates = [];
        for (let i = 0; i < DAYS_LOOKBACK; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          dates.push(d.toISOString().slice(0, 10));
        }

        const taskStats = {};
        for (const date of dates) {
          const snap = await db_firestore.collection("suivi-hors-recolte").doc(date).collection("rendements").get();
          snap.forEach(doc => {
            const d = doc.data();
            const key = `${d.ferme}_${d.tache}`;
            if (!taskStats[key]) taskStats[key] = { ferme: d.ferme, tache: d.tache, ratios: [], totalWorkers: 0, normeEnVigueur: d.normeEnVigueur };
            if (d.nbOuvriers >= MIN_WORKERS_PER_DAY) {
              taskStats[key].ratios.push(d.ratioVsNorme);
              taskStats[key].totalWorkers += d.nbOuvriers;
              taskStats[key].normeEnVigueur = d.normeEnVigueur;
            }
          });
        }

        const proposals = [];
        for (const [, stats] of Object.entries(taskStats)) {
          if (stats.ratios.length < MIN_DAYS || stats.normeEnVigueur <= 0) continue;
          const avgRatio = stats.ratios.reduce((a, b) => a + b, 0) / stats.ratios.length;
          if (avgRatio >= THRESHOLD_PCT) {
            const rawNorm = stats.normeEnVigueur * avgRatio / 100;
            const proposedNorm = Math.round(rawNorm * 2) / 2; // arrondi à 0.5
            proposals.push({
              ferme: stats.ferme,
              tache: stats.tache,
              currentNorm: stats.normeEnVigueur,
              proposedNorm,
              avgRatio: Math.round(avgRatio),
              daysAnalyzed: stats.ratios.length,
              avgWorkers: Math.round(stats.totalWorkers / stats.ratios.length),
            });
          }
        }

        return res.json({ success: true, proposals, analyzedDays: DAYS_LOOKBACK, threshold: THRESHOLD_PCT });
      }

      // ---- PROPOSE-NORM-CHANGE: crée une proposition de changement de norme ----
      if (action === "propose-norm-change" && req.method === "POST") {
        const { ferme, tache, currentNorm, proposedNorm, avgRatio, daysAnalyzed, avgWorkers, proposePar } = req.body;
        if (!tache || proposedNorm === undefined) {
          return res.status(400).json({ success: false, error: "tache, proposedNorm requis" });
        }
        const docRef = await db_firestore.collection("normes-historique").add({
          tache, ferme: ferme || null,
          ancienneValeur: Number(currentNorm) || 0,
          nouvelleValeur: Number(proposedNorm),
          raison: "auto-detection",
          detailsDetection: {
            nbJours: daysAnalyzed || 0,
            rendementMoyen: avgRatio || 0,
            nbOuvriers: avgWorkers || 0,
            periode: { debut: null, fin: new Date().toISOString().slice(0, 10) },
          },
          proposePar: proposePar || "system",
          validePar: null,
          statut: "proposee",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true, id: docRef.id });
      }

      // ---- VALIDATE-NORM-CHANGE: chef valide ou refuse une proposition ----
      if (action === "validate-norm-change" && req.method === "POST") {
        const { proposalId, decision, chef } = req.body;
        if (!proposalId || decision === undefined || !chef) {
          return res.status(400).json({ success: false, error: "proposalId, decision, chef requis" });
        }
        const propRef = db_firestore.collection("normes-historique").doc(proposalId);
        const propSnap = await propRef.get();
        if (!propSnap.exists) return res.status(404).json({ success: false, error: "Proposition non trouvée" });

        const prop = propSnap.data();
        const newStatut = decision ? "validee" : "refusee";

        await propRef.update({
          statut: newStatut,
          validePar: chef,
          validatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If approved, update the active norm
        if (decision) {
          const normeId = prop.ferme
            ? `${prop.tache}_${prop.ferme}`.replace(/\s+/g, "_")
            : prop.tache.replace(/\s+/g, "_");
          await db_firestore.collection("normes-productivite").doc(normeId).set({
            tache: prop.tache,
            ferme: prop.ferme || null,
            unite: "tunnels",
            normeParJourParOuvrier: prop.nouvelleValeur,
            actif: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        return res.json({ success: true, statut: newStatut });
      }

      // ---- GET-NORM-PROPOSALS: récupère les propositions en attente ----
      if (action === "get-norm-proposals") {
        const ferme = req.query.ferme;
        let query = db_firestore.collection("normes-historique").where("statut", "==", "proposee");
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        const proposals = [];
        snap.forEach(doc => {
          const d = doc.data();
          proposals.push({
            id: doc.id, ...d,
            createdAt: d.createdAt ? d.createdAt.toDate().toISOString() : null,
          });
        });
        return res.json({ success: true, proposals });
      }

      // ---- MIGRATE-CONFIG: migration one-shot des données hardcodées vers Firestore ----
      if (action === "migrate-config" && req.method === "POST") {
        const batch = db_firestore.batch();
        let count = 0;

        // Migrate normes
        const normesHardcoded = [
          { tache: 'Désherbage', normeParJourParOuvrier: 4 },
          { tache: 'Nettoyage', normeParJourParOuvrier: 5 },
          { tache: 'Aération', normeParJourParOuvrier: 8 },
          { tache: 'Désherbage à sape', normeParJourParOuvrier: 3 },
          { tache: 'Nivellement des pots', normeParJourParOuvrier: 2 },
          { tache: 'Nivellement des sol', normeParJourParOuvrier: 3 },
          { tache: 'Palissage', normeParJourParOuvrier: 2 },
          { tache: 'Feuille du sol', normeParJourParOuvrier: 3 },
          { tache: 'Palissage Pots', normeParJourParOuvrier: 5 },
          { tache: 'Ramassage Ficelle', normeParJourParOuvrier: 6 },
        ];
        for (const n of normesHardcoded) {
          const docId = n.tache.replace(/\s+/g, "_");
          batch.set(db_firestore.collection("normes-productivite").doc(docId), {
            tache: n.tache, ferme: null, unite: "tunnels",
            normeParJourParOuvrier: n.normeParJourParOuvrier,
            actif: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          count++;
        }

        // Migrate parcelles config
        const parcConfig = {
          F5: [
            { parcelle: 'Corina', variete: 'Corina', nbTunnels: 64 },
            { parcelle: 'Cascade', variete: 'Cascade', nbTunnels: 34 },
            { parcelle: 'Breeze', variete: 'Breeze', nbTunnels: 16 },
            { parcelle: 'Reina S9', variete: 'Reyna', nbTunnels: 66 },
          ],
          F1: [
            { parcelle: 'Maravilla Green Cane', variete: 'Maravilla', nbTunnels: 72 },
            { parcelle: 'Yazmin Cut Back', variete: 'Yazmin', nbTunnels: 43 },
          ],
        };
        for (const [ferme, parcelles] of Object.entries(parcConfig)) {
          for (const p of parcelles) {
            const docId = `${ferme}_${p.parcelle}`.replace(/\s+/g, "_");
            batch.set(db_firestore.collection("parcelles-config").doc(docId), {
              ferme, parcelle: p.parcelle, variete: p.variete,
              nbTunnels: p.nbTunnels, unite: "tunnels", actif: true,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            count++;
          }
        }

        await batch.commit();
        return res.json({ success: true, migrated: count });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur horsRecolteService:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Budget vs Réel — Suivi budgétaire
// =============================================
exports.budgetService = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const action = req.query.action || req.body?.action;

    try {
      // ========== SEASONS ==========

      if (action === "get-seasons") {
        const snap = await db_firestore.collection("budget_seasons").orderBy("startDate", "desc").get();
        const seasons = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, seasons });
      }

      if (action === "save-season" && req.method === "POST") {
        const { id, label, startDate, endDate, status, updatedBy } = req.body;
        if (!id || !label || !startDate || !endDate) {
          return res.status(400).json({ success: false, error: "id, label, startDate et endDate requis" });
        }
        const now = Date.now();
        const docRef = db_firestore.collection("budget_seasons").doc(id);
        const existing = await docRef.get();
        if (existing.exists) {
          await docRef.update({ label, startDate, endDate, status: status || "active", updatedAt: now, updatedBy: updatedBy || null });
        } else {
          await docRef.set({ label, startDate, endDate, status: status || "draft", createdAt: now, createdBy: updatedBy || null, updatedAt: now });
        }
        return res.json({ success: true, id });
      }

      // ========== BUDGET ENTRIES ==========

      if (action === "get-budget") {
        const { season, ferme } = req.query;
        if (!season) return res.status(400).json({ success: false, error: "season requis" });
        let query = db_firestore.collection("budget_entries").where("season", "==", season);
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        const entries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, entries });
      }

      if (action === "save-budget" && req.method === "POST") {
        const { season, ferme, category, varieties, updatedBy } = req.body;
        if (!season || !ferme || !category || !varieties) {
          return res.status(400).json({ success: false, error: "season, ferme, category et varieties requis" });
        }
        const docId = `${season}_${ferme}_${category}`;
        const now = Date.now();
        await db_firestore.collection("budget_entries").doc(docId).set({
          season, ferme, category, varieties, updatedBy: updatedBy || null, updatedAt: now,
        }, { merge: true });
        return res.json({ success: true, id: docId });
      }

      // ========== BUDGET CURVES ==========

      if (action === "get-curves") {
        const { season, ferme } = req.query;
        if (!season) return res.status(400).json({ success: false, error: "season requis" });
        let query = db_firestore.collection("budget_curves").where("season", "==", season);
        if (ferme) query = query.where("ferme", "==", ferme);
        const snap = await query.get();
        const curves = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, curves });
      }

      if (action === "save-curve" && req.method === "POST") {
        const { season, ferme, variete, params, weeks, updatedBy } = req.body;
        if (!season || !ferme || !variete || !params || !weeks) {
          return res.status(400).json({ success: false, error: "season, ferme, variete, params et weeks requis" });
        }
        const docId = `${season}_${ferme}_${variete.replace(/\s+/g, "_")}`;
        const now = Date.now();
        await db_firestore.collection("budget_curves").doc(docId).set({
          season, ferme, variete, params, weeks, updatedBy: updatedBy || null, updatedAt: now,
        }, { merge: true });
        return res.json({ success: true, id: docId });
      }

      // ========== IMPORT CANEVAS EXCEL ==========

      if (action === "import-canevas" && req.method === "POST") {
        const XLSX = require("xlsx");
        const { file, season, updatedBy } = req.body;
        if (!file || !season) return res.status(400).json({ success: false, error: "file et season requis" });

        const buffer = Buffer.from(file, "base64");
        const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

        const FARM_VARIETIES = {
          "F05": ["Corrina", "Cascade", "Breeze", "Yazmin cut back", "Reyna", "Myrtille nouvelle plantation"],
          "F01": ["Maravilla LC", "Maravilla GLC"],
        };

        const CATEGORY_ROWS = {
          production: { startRow: 4, fields: { recolte_kg: 0, export_kg: 1, marche_local_kg: 2 } },
          hors_recolte: { startRow: 9, fields: { mod_generale_jh: 0, palissage_jh: 1, aeration_jh: 2, plantation_jh: 3, irrigation_jh: 4, traitement_jh: 5, entretien_serre_jh: 6, entretien_domaine_jh: 7, mod_caporaux_jh: 8 } },
          intrants: { startRow: 20, fields: { engrais_kdh: 0, phytosanitaires_kdh: 1, autres_intrants_kdh: 2 } },
          qualite: { startRow: 25, fields: { pfq_score: 0 } },
          recolte_costs: { startRow: 28, fields: { mod_recolte_jh: 0, vitesse_kg_h: 1, prix_ouvrier_dh_h: 2, cout_recolte_dh_kg: 3 } },
        };

        const batch = db_firestore.batch();
        const imported = [];

        for (const sheetName of wb.SheetNames) {
          const ferme = sheetName.toUpperCase().replace("0", "0"); // F05, F01
          const varieties = FARM_VARIETIES[ferme];
          if (!varieties) continue;

          const ws = wb.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

          for (const [category, config] of Object.entries(CATEGORY_ROWS)) {
            const varietiesData = {};
            const fieldNames = Object.keys(config.fields);

            for (let vi = 0; vi < varieties.length; vi++) {
              const variety = varieties[vi];
              const budgetColOffset = vi * 3 + 5; // Budget YTD column for each variety group
              const varData = {};

              for (let fi = 0; fi < fieldNames.length; fi++) {
                const rowIdx = config.startRow + fi;
                if (rowIdx < data.length) {
                  const val = parseFloat(data[rowIdx][budgetColOffset]) || 0;
                  varData[fieldNames[fi]] = val;
                }
              }
              varietiesData[variety] = varData;
            }

            const docId = `${season}_${ferme}_${category}`;
            const docRef = db_firestore.collection("budget_entries").doc(docId);
            batch.set(docRef, {
              season, ferme, category, varieties: varietiesData,
              updatedBy: updatedBy || null, updatedAt: Date.now(),
            }, { merge: true });
            imported.push(docId);
          }
        }

        await batch.commit();

        // Log import
        await db_firestore.collection("budget_imports").add({
          season, importedAt: Date.now(), importedBy: updatedBy || null,
          type: "canevas", entriesCreated: imported,
        });

        return res.json({ success: true, imported });
      }

      // ========== IMPORT COURBES VOLUME EXCEL ==========

      if (action === "import-curves" && req.method === "POST") {
        const XLSX = require("xlsx");
        const { file, season, updatedBy } = req.body;
        if (!file || !season) return res.status(400).json({ success: false, error: "file et season requis" });

        const buffer = Buffer.from(file, "base64");
        const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

        const batch = db_firestore.batch();
        const imported = [];

        for (const sheetName of wb.SheetNames) {
          const ferme = sheetName.toUpperCase();
          const ws = wb.Sheets[sheetName];
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

          // Row 1: variety names (starting col 2)
          const varietyNames = [];
          if (data[1]) {
            for (let c = 2; c < data[1].length; c++) {
              const name = String(data[1][c] || "").trim();
              if (name && name !== "") varietyNames.push({ col: c, name });
            }
          }

          // Row 2-6: plant parameters per variety
          const paramRows = { kg_par_plante: 2, nbr_plant_ha: 3, nbr_ha: 4, coefficient: 5, total_volume_kg: 6 };

          for (const vInfo of varietyNames) {
            const params = {};
            for (const [key, rowIdx] of Object.entries(paramRows)) {
              params[key] = parseFloat(data[rowIdx]?.[vInfo.col]) || 0;
            }

            // Weekly distribution (starting from row 12)
            // Row 11 is header: Mois, Semaine, then variety percentages
            const weeks = {};
            const pctColIdx = vInfo.col; // % column matches variety position

            for (let r = 12; r < data.length; r++) {
              const row = data[r];
              if (!row || !row[1]) continue; // skip empty rows
              const weekNum = String(Math.round(parseFloat(row[1]) || 0));
              if (!weekNum || weekNum === "0") continue;
              const pctVal = parseFloat(row[pctColIdx]);
              if (!isNaN(pctVal) && pctVal > 0) {
                weeks[weekNum] = Math.round(pctVal * 10000) / 100; // Convert 0.053 → 5.3%
              }
            }

            const docId = `${season}_${ferme}_${vInfo.name.replace(/\s+/g, "_")}`;
            const docRef = db_firestore.collection("budget_curves").doc(docId);
            batch.set(docRef, {
              season, ferme, variete: vInfo.name, params, weeks,
              updatedBy: updatedBy || null, updatedAt: Date.now(),
            }, { merge: true });
            imported.push(docId);
          }
        }

        await batch.commit();

        await db_firestore.collection("budget_imports").add({
          season, importedAt: Date.now(), importedBy: updatedBy || null,
          type: "curves", curvesCreated: imported,
        });

        return res.json({ success: true, imported });
      }

      // ========== GET ACTUALS (from SQL Server) ==========

      if (action === "get-actuals") {
        const { season, ferme, startDate, endDate, granularity } = req.query;
        if (!startDate || !endDate) return res.status(400).json({ success: false, error: "startDate et endDate requis" });

        const gran = granularity || "week"; // "day", "week", "month"
        let dateGroupSQL;
        if (gran === "day") dateGroupSQL = "CONVERT(varchar, Periode_Date, 23)";
        else if (gran === "month") dateGroupSQL = "FORMAT(Periode_Date, 'yyyy-MM')";
        else dateGroupSQL = "CONCAT(YEAR(Periode_Date), '-W', RIGHT('0' + CAST(DATEPART(ISO_WEEK, Periode_Date) AS VARCHAR), 2))";

        const cacheKey = `budget_actuals_${startDate}_${endDate}_${ferme || "all"}_${gran}`;

        const result = await withCache(cacheKey, 30 * 60 * 1000, async () => {
          // Helper: compute period key from date string
          const getPeriodKey = (dateStr) => {
            const d = new Date(dateStr);
            if (gran === "day") return dateStr.slice(0, 10);
            if (gran === "month") return dateStr.slice(0, 7);
            // week: ISO week
            const jan1 = new Date(d.getFullYear(), 0, 1);
            const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
            return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
          };
          // Helper: deriveFerme for pointage rows
          const deriveFerme = (ref) => {
            if (!ref) return "Autre";
            const r = ref.trim();
            if (r.startsWith("F1") || r === "0032" || r === "0035" || r === "0036") return "F1";
            if (r.startsWith("F5") || r === "0037" || r === "0038" || r === "0039") return "F5";
            if (r.startsWith("F2") || r.startsWith("F3") || r.startsWith("F4") || r.startsWith("F6") || r === "0031" || r === "0033") return "Avocatier";
            return "Autre";
          };

          if (USE_MIRROR) {
            // === FIRESTORE MIRROR PATH ===
            const [cueilletteRows, pointageRows, consommationRows] = await Promise.all([
              getCueilletteRows(startDate, endDate),
              getPointageRowsForDateRange(startDate, endDate),
              getConsommationRows({ weekStart: startDate, weekEnd: endDate, ...(ferme ? { ferme } : {}) }),
            ]);

            // 1. Production (cueillette)
            const prodMap = {};
            for (const r of cueilletteRows) {
              if (ferme && r.Ferme !== ferme) continue;
              const key = `${r.Variete || "Autre"}|${getPeriodKey(r.DateStr || r.Date || "")}`;
              if (!prodMap[key]) prodMap[key] = { Variete: r.Variete || "Autre", periode: getPeriodKey(r.DateStr || r.Date || ""), total_kg: 0, nb_jours: 0 };
              prodMap[key].total_kg += r.Poids_total_kg || 0;
            }

            // 2. Hors Récolte (pointage - non récolte)
            const hrMap = {};
            for (const r of pointageRows) {
              if (r.Operation_Famille === "8. Récolte" || r.Operation_Famille === "11. Postes fixes") continue;
              if (ferme && deriveFerme(r.Ref_parcelle) !== ferme) continue;
              const key = `${r.Operation || ""}|${getPeriodKey(r.DateStr || "")}`;
              if (!hrMap[key]) hrMap[key] = { Operation: r.Operation || "", periode: getPeriodKey(r.DateStr || ""), total_jh: 0, total_cout: 0 };
              hrMap[key].total_jh += r.Nombre_Jr || 0;
              hrMap[key].total_cout += r.Cout || 0;
            }

            // 3. Récolte costs
            const recMap = {};
            for (const r of pointageRows) {
              if (r.Operation_Famille !== "8. Récolte") continue;
              if (ferme && deriveFerme(r.Ref_parcelle) !== ferme) continue;
              const key = `${r.Variete || "Autre"}|${getPeriodKey(r.DateStr || "")}`;
              if (!recMap[key]) recMap[key] = { Variete: r.Variete || "Autre", periode: getPeriodKey(r.DateStr || ""), total_jh: 0, total_cout: 0, total_hr: 0 };
              recMap[key].total_jh += r.Nombre_Jr || 0;
              recMap[key].total_cout += r.Cout || 0;
              recMap[key].total_hr += r.Nombre_Hr || 0;
            }

            // 4. Intrants (consommation)
            const intMap = {};
            for (const r of consommationRows) {
              const key = `${r.Article_Categorie || "Autre"}|${getPeriodKey(r.Date || "")}`;
              if (!intMap[key]) intMap[key] = { Article_Categorie: r.Article_Categorie || "Autre", periode: getPeriodKey(r.Date || ""), total_qty: 0 };
              intMap[key].total_qty += r.Quantite || 0;
            }

            return {
              production: Object.values(prodMap).sort((a, b) => (a.periode || "").localeCompare(b.periode || "")),
              hors_recolte: Object.values(hrMap).sort((a, b) => (a.periode || "").localeCompare(b.periode || "")),
              recolte_costs: Object.values(recMap).sort((a, b) => (a.periode || "").localeCompare(b.periode || "")),
              intrants: Object.values(intMap).sort((a, b) => (a.periode || "").localeCompare(b.periode || "")),
            };
          }

          // === SQL FALLBACK ===
          const p = await getPool();
          const prodResult = await p.request().input("startDate", getSql().Date, startDate).input("endDate", getSql().Date, endDate).input("ferme", getSql().NVarChar, ferme || "")
            .query(`SELECT Variete, ${dateGroupSQL} AS periode, SUM(Poids_total_kg) AS total_kg, COUNT(DISTINCT Periode_Date) AS nb_jours FROM BR_Cueillette WHERE Periode_Date BETWEEN @startDate AND @endDate ${ferme ? "AND Ferme = @ferme" : ""} GROUP BY Variete, ${dateGroupSQL} ORDER BY periode`);
          const hrResult = await p.request().input("startDate", getSql().Date, startDate).input("endDate", getSql().Date, endDate).input("ferme", getSql().NVarChar, ferme || "")
            .query(`SELECT Operation, ${dateGroupSQL} AS periode, SUM(Nombre_Jr) AS total_jh, SUM(Cout) AS total_cout FROM BR_Pointage WHERE Periode_Date BETWEEN @startDate AND @endDate AND Operation_Famille NOT IN (N'8. Récolte', N'11. Postes fixes') ${ferme ? "AND Ferme = @ferme" : ""} GROUP BY Operation, ${dateGroupSQL} ORDER BY periode`);
          const recResult = await p.request().input("startDate", getSql().Date, startDate).input("endDate", getSql().Date, endDate).input("ferme", getSql().NVarChar, ferme || "")
            .query(`SELECT Variete, ${dateGroupSQL} AS periode, SUM(Nombre_Jr) AS total_jh, SUM(Cout) AS total_cout, SUM(Nombre_Hr) AS total_hr FROM BR_Pointage WHERE Periode_Date BETWEEN @startDate AND @endDate AND Operation_Famille = N'8. Récolte' ${ferme ? "AND Ferme = @ferme" : ""} GROUP BY Variete, ${dateGroupSQL} ORDER BY periode`);
          const intResult = await p.request().input("startDate", getSql().Date, startDate).input("endDate", getSql().Date, endDate).input("ferme", getSql().NVarChar, ferme || "")
            .query(`SELECT Article_Categorie, ${dateGroupSQL.replace(/Periode_Date/g, '[Date]')} AS periode, SUM(Quantite) AS total_qty FROM BR_Consommation WHERE [Date] BETWEEN @startDate AND @endDate ${ferme ? "AND Ferme = @ferme" : ""} GROUP BY Article_Categorie, ${dateGroupSQL.replace(/Periode_Date/g, '[Date]')} ORDER BY periode`);
          return { production: prodResult.recordset, hors_recolte: hrResult.recordset, recolte_costs: recResult.recordset, intrants: intResult.recordset };
        });

        return res.json({ success: true, actuals: result });
      }

      // ========== GET COMPARISON (Budget vs Réel) ==========

      if (action === "get-comparison") {
        const { season, ferme, startDate, endDate, granularity } = req.query;
        if (!season || !startDate || !endDate) {
          return res.status(400).json({ success: false, error: "season, startDate et endDate requis" });
        }

        // Get budget data from Firestore
        let budgetQuery = db_firestore.collection("budget_entries").where("season", "==", season);
        if (ferme) budgetQuery = budgetQuery.where("ferme", "==", ferme);
        const budgetSnap = await budgetQuery.get();
        const budgetEntries = {};
        budgetSnap.forEach(doc => {
          const d = doc.data();
          const key = `${d.ferme}_${d.category}`;
          budgetEntries[key] = d.varieties;
        });

        // Get curves for weekly distribution
        let curvesQuery = db_firestore.collection("budget_curves").where("season", "==", season);
        if (ferme) curvesQuery = curvesQuery.where("ferme", "==", ferme);
        const curvesSnap = await curvesQuery.get();
        const curves = {};
        curvesSnap.forEach(doc => {
          const d = doc.data();
          curves[`${d.ferme}_${d.variete}`] = d;
        });

        // Get actuals via internal call logic
        const gran = granularity || "week";
        let dateGroupSQL;
        if (gran === "day") dateGroupSQL = "CONVERT(varchar, Periode_Date, 23)";
        else if (gran === "month") dateGroupSQL = "FORMAT(Periode_Date, 'yyyy-MM')";
        else dateGroupSQL = "CONCAT(YEAR(Periode_Date), '-W', RIGHT('0' + CAST(DATEPART(ISO_WEEK, Periode_Date) AS VARCHAR), 2))";

        const cacheKey = `budget_actuals_${startDate}_${endDate}_${ferme || "all"}_${gran}`;
        const actuals = await withCache(cacheKey, 30 * 60 * 1000, async () => {
          const getPeriodKey = (dateStr) => {
            const d = new Date(dateStr);
            if (gran === "day") return dateStr.slice(0, 10);
            if (gran === "month") return dateStr.slice(0, 7);
            const jan1 = new Date(d.getFullYear(), 0, 1);
            const week = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
            return `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
          };
          const deriveFerme = (ref) => {
            if (!ref) return "Autre";
            const r = ref.trim();
            if (r.startsWith("F1") || r === "0032" || r === "0035" || r === "0036") return "F1";
            if (r.startsWith("F5") || r === "0037" || r === "0038" || r === "0039") return "F5";
            if (r.startsWith("F2") || r.startsWith("F3") || r.startsWith("F4") || r.startsWith("F6") || r === "0031" || r === "0033") return "Avocatier";
            return "Autre";
          };

          if (USE_MIRROR) {
            const [cueilletteRows, pointageRows, consommationRows] = await Promise.all([
              getCueilletteRows(startDate, endDate),
              getPointageRowsForDateRange(startDate, endDate),
              getConsommationRows({ weekStart: startDate, weekEnd: endDate, ...(ferme ? { ferme } : {}) }),
            ]);
            const prodMap = {};
            for (const r of cueilletteRows) {
              if (ferme && r.Ferme !== ferme) continue;
              const key = `${r.Variete || "Autre"}|${getPeriodKey(r.DateStr || r.Date || "")}`;
              if (!prodMap[key]) prodMap[key] = { Variete: r.Variete || "Autre", periode: getPeriodKey(r.DateStr || r.Date || ""), total_kg: 0 };
              prodMap[key].total_kg += r.Poids_total_kg || 0;
            }
            const hrMap = {};
            for (const r of pointageRows) {
              if (r.Operation_Famille === "8. Récolte" || r.Operation_Famille === "11. Postes fixes") continue;
              if (ferme && deriveFerme(r.Ref_parcelle) !== ferme) continue;
              const key = `${r.Operation || ""}|${getPeriodKey(r.DateStr || "")}`;
              if (!hrMap[key]) hrMap[key] = { Operation: r.Operation || "", periode: getPeriodKey(r.DateStr || ""), total_jh: 0, total_cout: 0 };
              hrMap[key].total_jh += r.Nombre_Jr || 0;
              hrMap[key].total_cout += r.Cout || 0;
            }
            const intMap = {};
            for (const r of consommationRows) {
              const key = `${r.Article_Categorie || "Autre"}|${getPeriodKey(r.Date || "")}`;
              if (!intMap[key]) intMap[key] = { Article_Categorie: r.Article_Categorie || "Autre", periode: getPeriodKey(r.Date || ""), total_qty: 0 };
              intMap[key].total_qty += r.Quantite || 0;
            }
            return {
              production: Object.values(prodMap).sort((a, b) => (a.periode || "").localeCompare(b.periode || "")),
              hors_recolte: Object.values(hrMap).sort((a, b) => (a.periode || "").localeCompare(b.periode || "")),
              intrants: Object.values(intMap).sort((a, b) => (a.periode || "").localeCompare(b.periode || "")),
            };
          }

          // === SQL FALLBACK ===
          const p = await getPool();
          const prodResult = await p.request().input("startDate", getSql().Date, startDate).input("endDate", getSql().Date, endDate).input("ferme", getSql().NVarChar, ferme || "")
            .query(`SELECT Variete, ${dateGroupSQL} AS periode, SUM(Poids_total_kg) AS total_kg FROM BR_Cueillette WHERE Periode_Date BETWEEN @startDate AND @endDate ${ferme ? "AND Ferme = @ferme" : ""} GROUP BY Variete, ${dateGroupSQL}`);
          const hrResult = await p.request().input("startDate", getSql().Date, startDate).input("endDate", getSql().Date, endDate).input("ferme", getSql().NVarChar, ferme || "")
            .query(`SELECT Operation, ${dateGroupSQL} AS periode, SUM(Nombre_Jr) AS total_jh, SUM(Cout) AS total_cout FROM BR_Pointage WHERE Periode_Date BETWEEN @startDate AND @endDate AND Operation_Famille NOT IN (N'8. Récolte', N'11. Postes fixes') ${ferme ? "AND Ferme = @ferme" : ""} GROUP BY Operation, ${dateGroupSQL}`);
          const intResult = await p.request().input("startDate", getSql().Date, startDate).input("endDate", getSql().Date, endDate).input("ferme", getSql().NVarChar, ferme || "")
            .query(`SELECT Article_Categorie, ${dateGroupSQL.replace(/Periode_Date/g, '[Date]')} AS periode, SUM(Quantite) AS total_qty FROM BR_Consommation WHERE [Date] BETWEEN @startDate AND @endDate ${ferme ? "AND Ferme = @ferme" : ""} GROUP BY Article_Categorie, ${dateGroupSQL.replace(/Periode_Date/g, '[Date]')}`);
          return { production: prodResult.recordset, hors_recolte: hrResult.recordset, intrants: intResult.recordset };
        });

        // Build comparison summary
        const summary = { production: {}, hors_recolte: {}, intrants: {} };

        // Aggregate production actuals by variety
        for (const row of actuals.production) {
          const v = row.Variete || "Autre";
          if (!summary.production[v]) summary.production[v] = { actual_kg: 0 };
          summary.production[v].actual_kg += row.total_kg || 0;
        }

        // Map budget production
        for (const [key, varieties] of Object.entries(budgetEntries)) {
          if (!key.endsWith("_production")) continue;
          for (const [variety, data] of Object.entries(varieties)) {
            if (!summary.production[variety]) summary.production[variety] = { actual_kg: 0 };
            summary.production[variety].budget_kg = data.recolte_kg || 0;
            summary.production[variety].ecart_kg = (summary.production[variety].actual_kg || 0) - (data.recolte_kg || 0);
            const budget = data.recolte_kg || 1;
            summary.production[variety].ecart_pct = Math.round(((summary.production[variety].actual_kg || 0) - budget) / budget * 100);
          }
        }

        // Aggregate hors_recolte actuals
        const hrOps = {};
        for (const row of actuals.hors_recolte) {
          const op = row.Operation || "Autre";
          if (!hrOps[op]) hrOps[op] = { actual_jh: 0, actual_cout: 0 };
          hrOps[op].actual_jh += row.total_jh || 0;
          hrOps[op].actual_cout += row.total_cout || 0;
        }
        summary.hors_recolte = hrOps;

        // Aggregate intrants actuals
        for (const row of actuals.intrants) {
          const cat = row.Article_Categorie || "Autre";
          if (!summary.intrants[cat]) summary.intrants[cat] = { actual_qty: 0 };
          summary.intrants[cat].actual_qty += row.total_qty || 0;
        }

        return res.json({
          success: true,
          budget: budgetEntries,
          curves,
          actuals,
          summary,
          period: { startDate, endDate, granularity: gran },
        });
      }

      // ========== IMPORT HISTORY ==========

      if (action === "get-import-history") {
        const { season } = req.query;
        let query = db_firestore.collection("budget_imports").orderBy("importedAt", "desc").limit(20);
        if (season) query = db_firestore.collection("budget_imports").where("season", "==", season).orderBy("importedAt", "desc").limit(20);
        const snap = await query.get();
        const imports = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, imports });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur budgetService:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// ===================== TASKS API =====================
exports.tasks = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const action = req.query.action;

      // ---- LIST all tasks ----
      if (action === "list") {
        const snap = await db_firestore.collection("tasks").orderBy("createdAt", "desc").get();
        const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, tasks });
      }

      // ---- MY TASKS (by assignedTo) ----
      if (action === "my-tasks") {
        const profile = req.query.profile;
        if (!profile) return res.status(400).json({ success: false, error: "profile requis" });
        const snap = await db_firestore.collection("tasks").where("assignedTo", "==", profile).get();
        const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, tasks });
      }

      // ---- CREATE task ----
      if (action === "create" && req.method === "POST") {
        const { title, description, assignedTo, assignedToName, priority, deadline, createdBy } = req.body;
        if (!title || !assignedTo || !deadline) return res.status(400).json({ success: false, error: "title, assignedTo, deadline requis" });
        const now = admin.firestore.FieldValue.serverTimestamp();
        const ref = await db_firestore.collection("tasks").add({
          title: title.trim(),
          description: (description || "").trim(),
          assignedTo,
          assignedToName: assignedToName || assignedTo,
          priority: priority || "moyenne",
          deadline,
          status: "a_faire",
          createdBy: createdBy || authUser.uid,
          sourceType: "manual",
          sourceCrId: null,
          sourceCrTitle: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        });
        return res.json({ success: true, id: ref.id });
      }

      // ---- UPDATE task ----
      if (action === "update" && req.method === "POST") {
        const { id, title, description, assignedTo, assignedToName, priority, deadline } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        await db_firestore.collection("tasks").doc(id).update({
          title: (title || "").trim(),
          description: (description || "").trim(),
          assignedTo,
          assignedToName: assignedToName || assignedTo,
          priority: priority || "moyenne",
          deadline,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true });
      }

      // ---- UPDATE STATUS ----
      if (action === "update-status" && req.method === "POST") {
        const { id, status } = req.body;
        if (!id || !status) return res.status(400).json({ success: false, error: "id, status requis" });
        const update = { status, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (status === "termine") update.completedAt = admin.firestore.FieldValue.serverTimestamp();
        await db_firestore.collection("tasks").doc(id).update(update);
        return res.json({ success: true });
      }

      // ---- DELETE task ----
      if (action === "delete" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        await db_firestore.collection("tasks").doc(id).delete();
        return res.json({ success: true });
      }

      // ---- FARM TODOS: list ----
      if (action === "farm-todos") {
        const snap = await db_firestore.collection("farm_todos").orderBy("createdAt", "desc").get();
        const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, todos });
      }

      // ---- FARM TODOS: add ----
      if (action === "farm-todo-add" && req.method === "POST") {
        const { farm, text } = req.body;
        if (!farm || !text) return res.status(400).json({ success: false, error: "farm, text requis" });
        await db_firestore.collection("farm_todos").add({
          farm, text: text.trim(), done: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true });
      }

      // ---- FARM TODOS: toggle done ----
      if (action === "farm-todo-toggle" && req.method === "POST") {
        const { id, done } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        await db_firestore.collection("farm_todos").doc(id).update({ done: !!done });
        return res.json({ success: true });
      }

      // ---- FARM TODOS: delete ----
      if (action === "farm-todo-delete" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        await db_firestore.collection("farm_todos").doc(id).delete();
        return res.json({ success: true });
      }

      // ---- FARM TODOS: edit ----
      if (action === "farm-todo-edit" && req.method === "POST") {
        const { id, text } = req.body;
        if (!id || !text) return res.status(400).json({ success: false, error: "id, text requis" });
        await db_firestore.collection("farm_todos").doc(id).update({ text: text.trim() });
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur tasks API:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// ===================== MEETING CR API =====================
exports.meetingCR = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const action = req.query.action;

      // ---- LIST CRs ----
      if (action === "list") {
        const snap = await db_firestore.collection("meeting_crs").orderBy("date", "desc").get();
        const crs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        // Load linked tasks
        const taskSnap = await db_firestore.collection("tasks").where("sourceType", "==", "cr").get();
        const taskMap = {};
        taskSnap.docs.forEach(d => {
          const t = { id: d.id, ...d.data() };
          if (t.sourceCrId) {
            if (!taskMap[t.sourceCrId]) taskMap[t.sourceCrId] = [];
            taskMap[t.sourceCrId].push(t);
          }
        });
        return res.json({ success: true, crs, crTasks: taskMap });
      }

      // ---- SAVE CR (create or update) ----
      if (action === "save" && req.method === "POST") {
        const { id, title, date, participants, notes, actionItems, createdBy } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ success: false, error: "Titre requis" });
        if (!date) return res.status(400).json({ success: false, error: "Date requise" });

        const now = admin.firestore.FieldValue.serverTimestamp();
        const validActions = (actionItems || []).filter(a => a.title && a.title.trim() && a.assignedTo && a.deadline);

        if (id) {
          // UPDATE existing CR
          await db_firestore.collection("meeting_crs").doc(id).update({
            title: title.trim(), date, participants: participants || [], notes: (notes || "").trim(),
            actionItems: validActions, updatedAt: now,
          });
          return res.json({ success: true, id });
        } else {
          // CREATE new CR + tasks
          const batch = db_firestore.batch();
          const crRef = db_firestore.collection("meeting_crs").doc();
          const actionItemsWithIds = [];

          validActions.forEach(action => {
            const taskRef = db_firestore.collection("tasks").doc();
            batch.set(taskRef, {
              title: action.title.trim(),
              description: "",
              assignedTo: action.assignedTo,
              assignedToName: action.assignedToName || action.assignedTo,
              createdBy: createdBy || "system",
              status: "a_faire",
              priority: "moyenne",
              deadline: action.deadline,
              sourceType: "cr",
              sourceCrId: crRef.id,
              sourceCrTitle: title.trim(),
              createdAt: now, updatedAt: now, completedAt: null,
            });
            actionItemsWithIds.push({ ...action, taskId: taskRef.id });
          });

          batch.set(crRef, {
            title: title.trim(), date, participants: participants || [],
            notes: (notes || "").trim(), actionItems: actionItemsWithIds,
            createdBy: createdBy || "system",
            createdAt: now, updatedAt: now,
          });

          await batch.commit();
          return res.json({ success: true, id: crRef.id });
        }
      }

      // ---- DELETE CR ----
      if (action === "delete" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const batch = db_firestore.batch();
        batch.delete(db_firestore.collection("meeting_crs").doc(id));
        const taskSnap = await db_firestore.collection("tasks").where("sourceCrId", "==", id).get();
        taskSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur meetingCR:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Carburant — TotalEnergies fuel data
// =============================================
exports.fuel = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const action = req.query.action || "summary";
      const COLLECTION = "fuel_transactions";

      // Campaign starts in July
      const now = new Date();
      const campagneYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      const campagneStart = new Date(campagneYear, 6, 1); // July 1st
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      if (action === "summary") {
        const cacheKey = `fuel_summary_${now.getFullYear()}_${now.getMonth()}`;
        const cached = await withCache(cacheKey, 15 * 60 * 1000, async () => {
          // Fetch all transactions and filter in memory
          const snap = await db_firestore.collection(COLLECTION)
            .orderBy("date", "desc")
            .get();

          const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          const transactions = allDocs.filter(t => {
            const tDate = t.date && t.date.toDate ? t.date.toDate() : new Date(t.date);
            return tDate >= campagneStart;
          });

          // Aggregate
          let totalMoisCarburant = 0, totalMoisPeages = 0;
          let totalCampagneCarburant = 0, totalCampagnePeages = 0;
          let totalLitres = 0, totalMontantCarburant = 0;
          const parCarteMap = {};
          const evolutionMap = {};
          const stationMap = {};

          for (const t of transactions) {
            const tDate = t.date.toDate ? t.date.toDate() : new Date(t.date);
            const isCurrentMonth = tDate >= currentMonthStart;
            const montant = t.montant || 0;
            const litres = t.quantite || 0;

            if (t.isPeage) {
              totalCampagnePeages += montant;
              if (isCurrentMonth) totalMoisPeages += montant;
            } else {
              totalCampagneCarburant += montant;
              totalLitres += litres;
              totalMontantCarburant += montant;
              if (isCurrentMonth) totalMoisCarburant += montant;
            }

            // Par carte
            if (!parCarteMap[t.carte]) {
              parCarteMap[t.carte] = { carte: t.carte, montant: 0, litres: 0, peages: 0, count: 0 };
            }
            if (t.isPeage) {
              parCarteMap[t.carte].peages += montant;
            } else {
              parCarteMap[t.carte].montant += montant;
              parCarteMap[t.carte].litres += litres;
            }
            parCarteMap[t.carte].count++;

            // Evolution par mois
            const moisKey = t.mois || `${tDate.getFullYear()}-${String(tDate.getMonth() + 1).padStart(2, "0")}`;
            if (!evolutionMap[moisKey]) {
              evolutionMap[moisKey] = { mois: moisKey, carburant: 0, peages: 0 };
            }
            if (t.isPeage) {
              evolutionMap[moisKey].peages += montant;
            } else {
              evolutionMap[moisKey].carburant += montant;
            }

            // Top stations (only carburant, not péages)
            if (!t.isPeage && t.lieu) {
              if (!stationMap[t.lieu]) {
                stationMap[t.lieu] = { station: t.lieu, count: 0, montant: 0 };
              }
              stationMap[t.lieu].count++;
              stationMap[t.lieu].montant += montant;
            }
          }

          // Format evolution with month labels
          const moisLabels = { "01": "Jan", "02": "Fév", "03": "Mars", "04": "Avr", "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc" };
          const evolution = Object.values(evolutionMap)
            .sort((a, b) => a.mois.localeCompare(b.mois))
            .map(e => ({
              ...e,
              label: moisLabels[e.mois.split("-")[1]] || e.mois,
              carburant: Math.round(e.carburant),
              peages: Math.round(e.peages),
            }));

          const parCarte = Object.values(parCarteMap)
            .sort((a, b) => b.montant - a.montant)
            .map(c => ({
              ...c,
              montant: Math.round(c.montant),
              litres: Math.round(c.litres * 100) / 100,
              peages: Math.round(c.peages),
            }));

          const topStations = Object.values(stationMap)
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map(s => ({ ...s, montant: Math.round(s.montant) }));

          // 20 dernières transactions
          const dernieres = transactions.slice(0, 20).map(t => ({
            carte: t.carte,
            date: t.dateStr,
            lieu: t.lieu,
            produit: t.produit,
            quantite: t.quantite,
            montant: t.montant,
          }));

          const prixMoyenLitre = totalLitres > 0 ? Math.round(totalMontantCarburant / totalLitres * 100) / 100 : 0;

          // ===== ANOMALIES DETECTION =====
          const anomalies = [];

          // 1. Multi-pleins: >3 fills per card per day
          const dailyFills = {};
          const dailyTxMap = {}; // carte_day → transactions list
          for (const t of transactions) {
            const tDate = t.date.toDate ? t.date.toDate() : new Date(t.date);
            const dayKey = `${t.carte}_${tDate.getFullYear()}-${String(tDate.getMonth()+1).padStart(2,"0")}-${String(tDate.getDate()).padStart(2,"0")}`;
            if (!dailyFills[dayKey]) dailyFills[dayKey] = { carte: t.carte, date: t.dateStr ? t.dateStr.split(" ")[0] : "", count: 0, montant: 0 };
            dailyFills[dayKey].count++;
            dailyFills[dayKey].montant += t.montant || 0;
            if (!dailyTxMap[dayKey]) dailyTxMap[dayKey] = [];
            dailyTxMap[dayKey].push({ heure: (t.dateStr || "").split(" ")[1] || "", lieu: t.lieu || "", produit: t.produit || "", quantite: t.quantite || 0, montant: t.montant || 0 });
          }

          // Build daily distribution per card (for histogram)
          const cardDailyDist = {};
          for (const [key, d] of Object.entries(dailyFills)) {
            if (!cardDailyDist[d.carte]) cardDailyDist[d.carte] = {};
            const cnt = d.count;
            cardDailyDist[d.carte][cnt] = (cardDailyDist[d.carte][cnt] || 0) + 1;
          }

          for (const [key, d] of Object.entries(dailyFills)) {
            if (d.count > 3) {
              anomalies.push({
                type: "multi_fill", carte: d.carte, date: d.date, count: d.count, montant: Math.round(d.montant),
                transactions: (dailyTxMap[key] || []).sort((a, b) => (a.heure || "").localeCompare(b.heure || "")),
                dailyDistribution: cardDailyDist[d.carte] || {},
              });
            }
          }

          // 2. High amount: >2.5x median for the card
          const cardMontants = {};
          for (const t of transactions) {
            if (t.isPeage) continue;
            if (!cardMontants[t.carte]) cardMontants[t.carte] = [];
            cardMontants[t.carte].push({ montant: t.montant || 0, date: t.dateStr || "", lieu: t.lieu || "", produit: t.produit || "", quantite: t.quantite || 0 });
          }
          for (const [carte, arr] of Object.entries(cardMontants)) {
            if (arr.length < 5) continue;
            const sorted = arr.map(a => a.montant).sort((a, b) => a - b);
            const mediane = sorted[Math.floor(sorted.length / 2)];
            if (mediane <= 0) continue;

            // Build amount distribution in 6 ranges for histogram
            const maxMontant = sorted[sorted.length - 1];
            const step = Math.ceil(maxMontant / 6 / 50) * 50; // round to nearest 50
            const distRanges = [];
            for (let r = 0; r < 6; r++) {
              const lo = r * step;
              const hi = (r + 1) * step;
              const cnt = arr.filter(a => a.montant >= lo && a.montant < hi).length;
              distRanges.push({ range: `${lo}-${hi}`, lo, hi, count: cnt });
            }

            for (const a of arr) {
              if (a.montant > mediane * 2.5 && a.montant > 500) {
                anomalies.push({
                  type: "high_amount", carte, date: a.date, lieu: a.lieu, montant: Math.round(a.montant), mediane: Math.round(mediane),
                  produit: a.produit, quantite: a.quantite,
                  historique: { min: Math.round(sorted[0]), max: Math.round(maxMontant), mediane: Math.round(mediane), distribution: distRanges },
                });
              }
            }
          }

          // Sort anomalies: multi_fill first, then by montant desc
          anomalies.sort((a, b) => {
            if (a.type !== b.type) return a.type === "multi_fill" ? -1 : 1;
            return (b.montant || 0) - (a.montant || 0);
          });

          // ===== SUIVI KILOMETRIQUE (L/100km) =====
          let suiviKm = null;
          const kmTransactions = transactions
            .filter(t => t.carte === "476452" && (t.kms || 0) > 200000 && !t.isPeage)
            .map(t => ({
              date: t.dateStr || "",
              kms: t.kms,
              litres: t.quantite || 0,
              dateObj: t.date.toDate ? t.date.toDate() : new Date(t.date),
            }))
            .sort((a, b) => a.dateObj - b.dateObj);

          if (kmTransactions.length >= 3) {
            const points = [];
            for (let i = 1; i < kmTransactions.length; i++) {
              const deltaKm = kmTransactions[i].kms - kmTransactions[i - 1].kms;
              const litres = kmTransactions[i].litres;
              if (deltaKm > 10 && deltaKm < 3000 && litres > 5) {
                const l100 = Math.round((litres / deltaKm) * 100 * 10) / 10;
                if (l100 >= 3 && l100 <= 50) {
                  points.push({ date: kmTransactions[i].date, kms: kmTransactions[i].kms, litres, l100km: l100 });
                }
              }
            }
            if (points.length > 0) {
              const kmTotal = kmTransactions[kmTransactions.length - 1].kms - kmTransactions[0].kms;
              const moyL100 = Math.round(points.reduce((s, p) => s + p.l100km, 0) / points.length * 10) / 10;
              suiviKm = { carte: "476452", kmTotal, moyenneL100: moyL100, points };
            }
          }

          // ===== TENDANCE LITRES/SEMAINE PAR CARTE =====
          // ISO week helper
          function getISOWeek(d) {
            const date = new Date(d.getTime());
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
            const week1 = new Date(date.getFullYear(), 0, 4);
            const weekNum = 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
            return `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
          }

          // Find top 5 cards by total litres
          const cardLitresTotal = {};
          for (const t of transactions) {
            if (t.isPeage) continue;
            cardLitresTotal[t.carte] = (cardLitresTotal[t.carte] || 0) + (t.quantite || 0);
          }
          const top5Cards = Object.entries(cardLitresTotal)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(e => e[0]);

          // Build weekly data per card
          const weeklyMap = {};
          const allWeeks = new Set();
          for (const t of transactions) {
            if (t.isPeage || !top5Cards.includes(t.carte)) continue;
            const tDate = t.date.toDate ? t.date.toDate() : new Date(t.date);
            const week = getISOWeek(tDate);
            allWeeks.add(week);
            if (!weeklyMap[t.carte]) weeklyMap[t.carte] = {};
            weeklyMap[t.carte][week] = (weeklyMap[t.carte][week] || 0) + (t.quantite || 0);
          }

          const sortedWeeks = [...allWeeks].sort();
          const consumptionWeekly = top5Cards.map(carte => ({
            carte,
            semaines: sortedWeeks.map(w => ({
              semaine: w,
              litres: Math.round((weeklyMap[carte]?.[w] || 0) * 10) / 10,
            })),
          }));

          return {
            success: true,
            totalMois: Math.round(totalMoisCarburant),
            totalCampagne: Math.round(totalCampagneCarburant),
            totalPeages: Math.round(totalCampagnePeages),
            totalPeagesMois: Math.round(totalMoisPeages),
            prixMoyenLitre,
            parCarte,
            evolution,
            topStations,
            dernieresTransactions: dernieres,
            anomalies,
            suiviKm,
            consumptionWeekly,
            nbTransactions: transactions.length,
            campagne: `${campagneYear}-${campagneYear + 1}`,
          };
        });
        return res.json(cached);
      }

      if (action === "import" && req.method === "POST") {
        const transactions = req.body.transactions || [];
        if (!Array.isArray(transactions) || transactions.length === 0) {
          return res.status(400).json({ success: false, error: "transactions array requis" });
        }

        let imported = 0;
        const BATCH_SIZE = 400;
        let batch = db_firestore.batch();
        let batchCount = 0;

        for (const t of transactions) {
          // Parse montant: "620.04 MAD" → 620.04
          const montant = parseFloat((t.montant || "0").replace(/\s*MAD\s*/i, "").replace(",", ".")) || 0;
          const quantite = parseFloat((t.quantite || "0").replace(",", ".")) || 0;
          const kms = parseInt(t.kms || "0", 10) || 0;
          // Parse date
          const [datePart, timePart] = (t.date || "").split(" ");
          const [day, month, year] = (datePart || "").split("/");
          const [hour, minute] = (timePart || "00:00").split(":");
          const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
          const isPeage = (t.produit || "").toLowerCase().includes("badge") || (t.produit || "").toLowerCase().includes("peage");

          const docId = `${t.carte}_${t.ticket}_${(t.date || "").replace(/[\/\s:]/g, "-")}`;
          const ref = db_firestore.collection(COLLECTION).doc(docId);
          batch.set(ref, {
            carte: t.carte || "",
            date: admin.firestore.Timestamp.fromDate(dateObj),
            dateStr: t.date || "",
            ticket: t.ticket || "",
            lieu: t.lieu || "",
            produit: t.produit || "",
            kms, quantite, montant, isPeage,
            dateFacture: t.dateFacture || "",
            numFacture: t.numFacture || "",
            mois: `${year}-${month}`,
            annee: parseInt(year, 10),
          }, { merge: true });
          batchCount++;
          imported++;

          if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batch = db_firestore.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();

        // Invalidate cache
        const now = new Date();
        const cacheKey = `fuel_summary_${now.getFullYear()}_${now.getMonth()}`;
        await db_firestore.collection("api_cache").doc(cacheKey.replace(/[\/\.\s#\[\]*]/g, "_").slice(0, 200)).delete().catch(() => {});

        return res.json({ success: true, imported });
      }

      if (action === "transactions") {
        const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
        const snap = await db_firestore.collection(COLLECTION).limit(limit).get();
        const data = snap.docs.map(d => {
          const t = d.data();
          const dateType = t.date ? (t.date.toDate ? "Timestamp" : typeof t.date) : "missing";
          return { id: d.id, carte: t.carte, date: t.dateStr, lieu: t.lieu, produit: t.produit, quantite: t.quantite, montant: t.montant, kms: t.kms, dateType };
        });
        return res.json({ success: true, data, count: data.length });
      }

      if (action === "count") {
        const snap = await db_firestore.collection(COLLECTION).count().get();
        return res.json({ success: true, total: snap.data().count });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur fuel:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Notifications — Aggregated notifications per profile
// =============================================
exports.notifications = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const profile = req.query.profile || "";
      const ferme = req.query.ferme || "";
      const today = new Date().toISOString().slice(0, 10);

      const categories = { validations: [], taches: [], alertes: [] };

      // ---- Helper: get dates for last 7 days ----
      const last7 = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        last7.push(d.toISOString().slice(0, 10));
      }

      // ---- COMMON: Tasks assigned to this profile ----
      const tasksPromise = db_firestore.collection("tasks")
        .where("assignedTo", "==", profile)
        .where("status", "in", ["a_faire", "en_cours"])
        .get();

      // ---- Profile-specific queries ----
      const promises = [tasksPromise];

      // RH: pointage_validations not fully validated (last 7 days)
      if (profile === "rh") {
        promises.push(
          db_firestore.collection("pointage_validations")
            .where("date", "in", last7).get()
            .then(snap => {
              const pending = snap.docs.filter(d => {
                const v = d.data();
                return !v.locked && !v.rejected;
              });
              if (pending.length > 0) {
                categories.validations.push({ key: "pointage_pending", label: "Pointages en attente de validation", count: pending.length, icon: "fa-clipboard-check", color: "#e67e22", tab: "pointage" });
              }
            })
        );
      }

      // Chef: BDC + pointage attente visa chef + demandes ré-exécution
      if (profile.startsWith("chef_")) {
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef")
            .where("ferme", "==", ferme)
            .get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_chef", label: "BDC à valider", count: snap.size, icon: "fa-file-contract", color: "#e67e22", tab: "chef_validations" });
            })
        );
        promises.push(
          db_firestore.collection("pointage_validations")
            .where("date", "in", last7).get()
            .then(snap => {
              const pending = snap.docs.filter(d => {
                const v = d.data();
                return v.ferme === ferme && v.visaCaporal && !v.visaChef && !v.locked;
              });
              if (pending.length > 0) categories.validations.push({ key: "pointage_chef", label: "Pointages attente visa Chef", count: pending.length, icon: "fa-clipboard-check", color: "#2c3e50", tab: "pointage" });
            })
        );
        promises.push(
          db_firestore.collection("suivi-hors-recolte-demandes")
            .where("ferme", "==", ferme)
            .where("statut", "==", "en_attente")
            .get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "demandes_reexec", label: "Demandes ré-exécution en attente", count: snap.size, icon: "fa-rotate", color: "#9b59b6", tab: "hors_recolte" });
            })
        );
      }

      // Caporal: pointages en attente validation + rejetés + tâches HR non terminées + demandes résultat
      if (profile.startsWith("caporal_")) {
        promises.push(
          db_firestore.collection("pointage_validations")
            .where("date", "in", last7).get()
            .then(snap => {
              const pending = snap.docs.filter(d => {
                const v = d.data();
                return v.ferme === ferme && v.visaRH && !v.visaCaporal && !v.rejected && !v.locked;
              });
              if (pending.length > 0) categories.validations.push({ key: "pointage_caporal", label: "Pointages en attente de votre validation", count: pending.length, icon: "fa-clipboard-check", color: "#e67e22", tab: "pointage" });
              const rejected = snap.docs.filter(d => {
                const v = d.data();
                return v.ferme === ferme && v.rejected;
              });
              if (rejected.length > 0) categories.alertes.push({ key: "pointage_rejected", label: "Pointages rejetés à corriger", count: rejected.length, icon: "fa-exclamation-triangle", color: "#e74c3c", tab: "pointage" });
            })
        );
        promises.push(
          db_firestore.collection("suivi-hors-recolte-cumul")
            .where("ferme", "==", ferme)
            .where("termine", "==", false)
            .get()
            .then(snap => {
              if (snap.size > 0) categories.taches.push({ key: "hr_non_terminees", label: "Tâches hors-récolte en cours", count: snap.size, icon: "fa-list-check", color: "#f39c12", tab: "suivi_avancement" });
            })
        );
        promises.push(
          db_firestore.collection("suivi-hors-recolte-demandes")
            .where("ferme", "==", ferme)
            .get()
            .then(snap => {
              const recent = snap.docs.filter(d => {
                const data = d.data();
                return (data.statut === "validee" || data.statut === "refusee") && data.valideAt;
              });
              if (recent.length > 0) categories.alertes.push({ key: "demandes_result", label: "Demandes ré-exécution traitées", count: recent.length, icon: "fa-bell", color: "#3498db", tab: "suivi_avancement" });
            })
        );
      }

      // DG: BDC attente DG + factures DG
      if (profile === "dg") {
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_dg", label: "BDC en attente DG", count: snap.size, icon: "fa-stamp", color: "#9b59b6", tab: "dg_validations" });
            })
        );
        promises.push(
          db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_finance").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "factures_dg", label: "Factures à valider", count: snap.size, icon: "fa-file-invoice-dollar", color: "#e74c3c", tab: "dg_validations" });
            })
        );
      }

      // Finance: factures + virements
      if (profile === "finance") {
        promises.push(
          db_firestore.collection("invoices")
            .where("payment_status", "==", "validee_achats").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "factures_finance", label: "Factures à valider", count: snap.size, icon: "fa-file-invoice-dollar", color: "#3498db", tab: "fin_factures" });
            })
        );
        promises.push(
          db_firestore.collection("demandes_virement")
            .where("status", "==", "en_attente").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "virements_pending", label: "Virements en attente", count: snap.size, icon: "fa-money-bill-transfer", color: "#27ae60", tab: "fin_virements" });
            })
        );
      }

      // Achats: DA + BDC + factures + fournisseurs
      if (profile === "achats") {
        promises.push(
          db_firestore.collection("purchase_requests")
            .where("status", "==", "soumise").get()
            .then(snap => {
              const daList = snap.docs.map(d => ({ id: d.id, ...d.data() }));
              if (snap.size > 0) categories.validations.push({
                key: "da_soumises", label: "DA à approuver", count: snap.size, icon: "fa-file-lines", color: "#f39c12", tab: "achats_da",
                details: daList.slice(0, 5).map(d => ({ text: (d.numero || "") + " — " + (d.ferme || "") + (d.urgence && d.urgence !== "normale" ? " (" + d.urgence + ")" : ""), urgent: d.urgence === "critique" || d.urgence === "urgente" }))
              });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "brouillon").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_brouillon", label: "BDC brouillon à compléter", count: snap.size, icon: "fa-file-pen", color: "#3498db", tab: "achats_bdc" });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_chef").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_attente_chef", label: "BDC attente Chef", count: snap.size, icon: "fa-user-check", color: "#e67e22", tab: "achats_bdc" });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "en_attente_dg").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_attente_dg", label: "BDC attente DG", count: snap.size, icon: "fa-stamp", color: "#9b59b6", tab: "achats_bdc" });
            })
        );
        promises.push(
          db_firestore.collection("invoices")
            .where("payment_status", "==", "en_validation").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "factures_achats", label: "Factures à valider", count: snap.size, icon: "fa-file-invoice-dollar", color: "#e74c3c", tab: "achats_paiements" });
            })
        );
        promises.push(
          db_firestore.collection("suppliers")
            .where("status", "==", "en_attente").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "fournisseurs", label: "Fournisseurs à valider", count: snap.size, icon: "fa-building", color: "#27ae60", tab: "achats_fournisseurs" });
            })
        );
      }

      // Qualité: expéditions en attente
      if (profile === "qualite") {
        promises.push(
          db_firestore.collection("expeditions")
            .where("status", "==", "en_attente").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "expeditions_pending", label: "Expéditions en attente", count: snap.size, icon: "fa-truck", color: "#8e44ad", tab: "qualite_expeditions" });
            })
        );
      }

      // DT: pointages F1+F5 non validés
      if (profile === "dt") {
        promises.push(
          db_firestore.collection("pointage_validations")
            .where("date", "in", last7).get()
            .then(snap => {
              const pending = snap.docs.filter(d => {
                const v = d.data();
                return (v.ferme === "F1" || v.ferme === "F5") && !v.locked && !v.rejected;
              });
              if (pending.length > 0) categories.validations.push({ key: "pointage_dt", label: "Pointages non validés (F1+F5)", count: pending.length, icon: "fa-clipboard-check", color: "#1a5276", tab: "pointage" });
            })
        );
      }

      // ---- Alerts from Firestore (expedition_manquante etc.) for relevant profiles ----
      const alertProfiles = ['chef_f1', 'chef_f5', 'qualite', 'dg', 'achats', 'finance'];
      if (alertProfiles.includes(profile)) {
        promises.push(
          db_firestore.collection("alerts")
            .where("profiles", "array-contains", profile)
            .orderBy("createdAt", "desc")
            .limit(20)
            .get()
            .then(snap => {
              snap.docs.forEach(doc => {
                const a = doc.data();
                const isRead = a.read && a.read[profile];
                if (!isRead) {
                  categories.alertes.push({
                    key: 'alert_' + doc.id,
                    label: a.message || 'Alerte',
                    count: 1,
                    icon: a.type === 'expedition_manquante' ? 'fa-truck-ramp-box' : 'fa-triangle-exclamation',
                    color: a.severity === 'warning' ? '#f39c12' : '#e74c3c',
                    tab: 'qualite_expeditions',
                    alertId: doc.id,
                  });
                }
              });
            })
            .catch(err => console.warn('Alerts query error:', err))
        );
      }

      // ---- Await all promises ----
      await Promise.all(promises);

      // ---- Process tasks result ----
      const tasksSnap = await tasksPromise;
      const allTasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const overdue = allTasks.filter(t => t.deadline && t.deadline < today);
      const inProgress = allTasks.filter(t => t.status === "en_cours");
      const todo = allTasks.filter(t => t.status === "a_faire");

      if (overdue.length > 0) {
        categories.taches.push({ key: "tasks_overdue", label: "Tâches en retard", count: overdue.length, icon: "fa-clock", color: "#e74c3c", tab: "dg_taches" });
      }
      if (inProgress.length > 0) {
        categories.taches.push({ key: "tasks_en_cours", label: "Tâches en cours", count: inProgress.length, icon: "fa-spinner", color: "#3498db", tab: "dg_taches" });
      }
      if (todo.length > 0) {
        categories.taches.push({ key: "tasks_a_faire", label: "Tâches à faire", count: todo.length, icon: "fa-list-check", color: "#f39c12", tab: "dg_taches" });
      }

      const totalCount = Object.values(categories).reduce((sum, cat) => sum + cat.reduce((s, item) => s + item.count, 0), 0);

      return res.json({ success: true, categories, totalCount });
    } catch (err) {
      console.error("Erreur notifications:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Alerts — List and manage alerts
// =============================================
exports.alerts = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const action = req.query.action || req.body?.action || "list";
      const profile = req.query.profile || req.body?.profile || "";

      if (action === "list") {
        const snap = await db_firestore.collection("alerts")
          .orderBy("createdAt", "desc")
          .limit(50)
          .get();
        const alerts = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(a => !profile || (a.profiles && a.profiles.includes(profile)));
        return res.json({ success: true, alerts });
      }

      if (action === "mark-read") {
        const alertId = req.body?.alertId;
        if (!alertId || !profile) return res.status(400).json({ success: false, error: "alertId and profile required" });
        await db_firestore.collection("alerts").doc(alertId).update({
          [`read.${profile}`]: true,
        });
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Unknown action" });
    } catch (err) {
      console.error("Erreur alerts:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });
