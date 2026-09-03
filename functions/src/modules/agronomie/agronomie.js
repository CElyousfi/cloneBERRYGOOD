/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { COLLECTION, GDD_CONFIG, METEO_FERMES, USE_MIRROR, aggregateSerreData, calcGDD, calcIMC, db_firestore, dispatchNotification, functions, getConsommationRows, getPool, getSql, getSyncStatus, localDateStr, refreshFarmroadCache, requireAuth, resolveCallerRole, setCors, withCache } = require("../../shared/core");

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
// API: Suivi Croissance Framboise (points de contrôle)
// Lecture toute auth ; écriture réservée au profil "agronomie".
// Collections : growth_measurements, growth_plot_config
// =============================================
const GROWTH_MEASUREMENTS = "growth_measurements";
const GROWTH_PLOT_CONFIG = "growth_plot_config";
const GROWTH_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Trim + dedupe + drop empties, keep order. */
function normalizeGrowthCheckpoints(arr) {
  if (!Array.isArray(arr)) return [];
  const seen = new Set();
  const out = [];
  arr.forEach(raw => {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  });
  return out;
}

/** Inline mirror of growthUtils.validateMeasurement (no cross-import from public/). */
function validateGrowthMeasurement(m) {
  const obj = m || {};
  if (!obj.parcelle_id || !String(obj.parcelle_id).trim()) {
    return { valid: false, error: "Parcelle manquante." };
  }
  if (!obj.checkpoint || !String(obj.checkpoint).trim()) {
    return { valid: false, error: "Point de contrôle manquant." };
  }
  if (typeof obj.date !== "string" || !GROWTH_DATE_REGEX.test(obj.date)) {
    return { valid: false, error: "Date invalide (format attendu AAAA-MM-JJ)." };
  }
  const n = typeof obj.length_cm === "number" ? obj.length_cm : parseFloat(obj.length_cm);
  if (!Number.isFinite(n) || n <= 0) {
    return { valid: false, error: "Longueur invalide (doit être un nombre supérieur à 0)." };
  }
  if (n >= 1000) {
    return { valid: false, error: "Longueur trop grande (doit être inférieure à 1000 cm)." };
  }
  return { valid: true };
}

exports.growthTracking = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    try {
      const action = req.query.action;

      // ---- Writes require role "agronomie" ----
      const requireAgro = async () => {
        const role = await resolveCallerRole(authUser);
        if (role !== "agronomie") {
          res.status(403).json({ success: false, error: "Réservé au profil Agronomie" });
          return null;
        }
        return role;
      };
      const actor = (role) => ({ uid: authUser.uid, name: authUser.name || "", profileId: role });

      // ---- GET list-measurements (toute auth) ----
      if (action === "list-measurements" && req.method === "GET") {
        const { parcelle_id, variete, from, to } = req.query;
        let q = db_firestore.collection(GROWTH_MEASUREMENTS);
        if (parcelle_id) q = q.where("parcelle_id", "==", parcelle_id);
        if (variete) q = q.where("variete", "==", variete);
        const snap = await q.get();
        let measurements = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        if (from) measurements = measurements.filter(m => typeof m.date === "string" && m.date >= from);
        if (to) measurements = measurements.filter(m => typeof m.date === "string" && m.date <= to);
        measurements.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
        return res.json({ success: true, measurements, count: measurements.length });
      }

      // ---- GET list-config (toute auth) ----
      if (action === "list-config" && req.method === "GET") {
        const snap = await db_firestore.collection(GROWTH_PLOT_CONFIG).get();
        const configs = snap.docs.map(d => {
          const data = d.data();
          return {
            parcelle_id: data.parcelle_id || d.id,
            parcelle_nom: data.parcelle_nom || "",
            checkpoints: Array.isArray(data.checkpoints) ? data.checkpoints : [],
          };
        });
        return res.json({ success: true, configs });
      }

      // ---- POST set-checkpoints (agronomie) ----
      if (action === "set-checkpoints" && req.method === "POST") {
        const role = await requireAgro();
        if (!role) return;
        const { parcelle_id, parcelle_nom } = req.body || {};
        if (!parcelle_id || !String(parcelle_id).trim()) {
          return res.status(400).json({ success: false, error: "parcelle_id requis" });
        }
        const checkpoints = normalizeGrowthCheckpoints((req.body || {}).checkpoints);
        await db_firestore.collection(GROWTH_PLOT_CONFIG).doc(parcelle_id).set({
          parcelle_id,
          parcelle_nom: parcelle_nom || "",
          checkpoints,
          updated_by: actor(role),
          updated_at: Date.now(),
        }, { merge: true });
        return res.json({ success: true, checkpoints });
      }

      // ---- POST create-measurement (agronomie) ----
      if (action === "create-measurement" && req.method === "POST") {
        const role = await requireAgro();
        if (!role) return;
        const b = req.body || {};
        const check = validateGrowthMeasurement({
          parcelle_id: b.parcelle_id,
          checkpoint: b.checkpoint,
          date: b.date,
          length_cm: b.length_cm,
        });
        if (!check.valid) return res.status(400).json({ success: false, error: check.error });
        const length_cm = parseFloat(b.length_cm);
        const ref = await db_firestore.collection(GROWTH_MEASUREMENTS).add({
          parcelle_id: String(b.parcelle_id).trim(),
          parcelle_nom: b.parcelle_nom || "",
          variete: b.variete || "",
          sous_variete: b.sous_variete || "",
          ferme: b.ferme || "",
          checkpoint: String(b.checkpoint).trim(),
          date: b.date,
          length_cm,
          created_by: actor(role),
          created_at: Date.now(),
        });
        return res.json({ success: true, id: ref.id });
      }

      // ---- POST delete-measurement (agronomie) ----
      if (action === "delete-measurement" && req.method === "POST") {
        const role = await requireAgro();
        if (!role) return;
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        await db_firestore.collection(GROWTH_MEASUREMENTS).doc(String(id)).delete();
        return res.json({ success: true });
      }

      return res.status(400).json({ success: false, error: "Action inconnue ou méthode invalide" });
    } catch (err) {
      console.error("Erreur growthTracking:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: Mapping parcelles de consommation — /api/mapping-conso
// Route: mappingConsoManagement (rewrite firebase.json)
// Lectures client : onSnapshot direct (rules read auth). Écritures : ICI uniquement.
// Collections : parcelles_consommation, mapping_campagne, parcelles_culturales_charge
// =============================================
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
async function fetchMeteoOutdoor(lat, lon, dateStr) {
  const https = require("https");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,relative_humidity_2m_mean,et0_fao_evapotranspiration,shortwave_radiation_sum&timezone=Africa/Casablanca&start_date=${dateStr}&end_date=${dateStr}`;
  return new Promise((resolve) => {
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        try {
          const j = JSON.parse(data);
          if (!j.daily || !j.daily.time || j.daily.time.length === 0) return resolve(null);
          resolve({
            date: j.daily.time[0],
            tmax: j.daily.temperature_2m_max[0],
            tmin: j.daily.temperature_2m_min[0],
            humidity: j.daily.relative_humidity_2m_mean ? j.daily.relative_humidity_2m_mean[0] : null,
            wind: j.daily.windspeed_10m_max[0],
            precip: j.daily.precipitation_sum[0],
            eto: j.daily.et0_fao_evapotranspiration ? j.daily.et0_fao_evapotranspiration[0] : null,
            radiation: j.daily.shortwave_radiation_sum ? j.daily.shortwave_radiation_sum[0] : null,
            source: "open-meteo",
          });
        } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

// Fetch 7-day forecast from Open-Meteo
async function persistMeteoOutdoor(dateStr) {
  const results = {};
  for (const [ferme, coords] of Object.entries(METEO_FERMES)) {
    const data = await fetchMeteoOutdoor(coords.lat, coords.lon, dateStr);
    if (data) {
      await db_firestore.collection("meteo_outdoor").doc(`${dateStr}_${ferme}`).set({
        ...data, ferme, _cachedAt: Date.now(),
      });
      results[ferme] = data;
    }
  }
  console.log("Meteo outdoor persisted for", dateStr, "farms:", Object.keys(results).join(","));
  return results;
}

// =============================================
// CLIMAT MODEL — linear regression outdoor→indoor
// =============================================
function linearRegression(xs, ys) {
  const n = xs.length;
  if (n < 5) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i];
    sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; syy += ys[i] * ys[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-10) return null;
  const a = (n * sxy - sx * sy) / denom;
  const b = (sy - a * sx) / n;
  const yMean = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (ys[i] - yMean) ** 2;
    ssRes += (ys[i] - (a * xs[i] + b)) ** 2;
  }
  const r2 = ssTot > 0 ? Math.round((1 - ssRes / ssTot) * 1000) / 1000 : 0;
  return { a: Math.round(a * 1000) / 1000, b: Math.round(b * 100) / 100, r2 };
}

async function updateClimatModel(dateStr) {
  // Collect last 45 days of outdoor + indoor data
  const days = [];
  const d = new Date(dateStr + "T12:00:00");
  for (let i = 45; i >= 0; i--) {
    const dd = new Date(d); dd.setDate(dd.getDate() - i);
    days.push(dd.toISOString().slice(0, 10));
  }

  // Fetch outdoor data
  const outdoorMap = {};
  const outdoorSnap = await db_firestore.collection("meteo_outdoor")
    .where("ferme", "==", "F1") // primary serre farm
    .orderBy("date", "asc").get();
  outdoorSnap.forEach(doc => { const d = doc.data(); outdoorMap[d.date] = d; });

  // Fetch indoor data (serre_data)
  const indoorMap = {};
  const indoorSnap = await db_firestore.collection("farms").doc("larache")
    .collection("serre_data").orderBy("date", "asc").get();
  indoorSnap.forEach(doc => { const d = doc.data(); indoorMap[d.date] = d; });

  // Build paired arrays
  const paired = days.filter(d => outdoorMap[d] && indoorMap[d] && indoorMap[d].T_max_serre != null && outdoorMap[d].tmax != null);
  if (paired.length < 7) {
    console.log("Climat model: not enough paired data (" + paired.length + " days)");
    return null;
  }

  const outTmax = paired.map(d => outdoorMap[d].tmax);
  const outTmin = paired.map(d => outdoorMap[d].tmin);
  const outHR = paired.map(d => outdoorMap[d].humidity || 60);
  const inTmax = paired.map(d => indoorMap[d].T_max_serre);
  const inTmin = paired.map(d => indoorMap[d].T_min_serre);
  const inHR = paired.map(d => indoorMap[d].HR_moyenne || 70);

  const regTmax = linearRegression(outTmax, inTmax);
  const regTmin = linearRegression(outTmin, inTmin);
  const regHR = linearRegression(outHR, inHR);

  if (!regTmax || !regTmin) {
    console.log("Climat model: regression failed");
    return null;
  }

  // Compare yesterday's prediction with today's reality
  const yesterday = new Date(d); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  let dailyError = null;
  if (outdoorMap[yesterdayStr] && indoorMap[dateStr]) {
    const predTmax = regTmax.a * outdoorMap[yesterdayStr].tmax + regTmax.b;
    const actualTmax = indoorMap[dateStr].T_max_serre;
    if (actualTmax != null) {
      dailyError = {
        date: dateStr,
        predicted_tmax: Math.round(predTmax * 10) / 10,
        actual_tmax: Math.round(actualTmax * 10) / 10,
        error: Math.round(Math.abs(predTmax - actualTmax) * 10) / 10,
      };
    }
  }

  const modelDoc = {
    ferme: "F1",
    serre_type: "tunnel",
    coefficients: {
      tmax: regTmax,
      tmin: regTmin,
      hr: regHR || { a: 1, b: 0, r2: 0 },
    },
    training_days: paired.length,
    last_updated: Date.now(),
  };

  // Merge daily_errors array (keep last 30)
  const existingDoc = await db_firestore.collection("climat_models").doc("F1_tunnel").get();
  let errors = existingDoc.exists ? (existingDoc.data().daily_errors || []) : [];
  if (dailyError) errors.push(dailyError);
  if (errors.length > 30) errors = errors.slice(-30);
  modelDoc.daily_errors = errors;

  await db_firestore.collection("climat_models").doc("F1_tunnel").set(modelDoc);
  console.log("Climat model updated: tmax R²=" + regTmax.r2 + ", tmin R²=" + (regTmin ? regTmin.r2 : "N/A") + ", HR R²=" + (regHR ? regHR.r2 : "N/A") + ", training=" + paired.length + " days");

  return modelDoc;
}

// --- GDD journalier ---
async function computeGDDForDate(dateStr) {
  // Skip if before J0
  if (dateStr < GDD_CONFIG.J0) return { skipped: true, reason: "Before J0" };

  // 1. Get FarmRoad data
  const farmroadData = await refreshFarmroadCache(dateStr, null);
  if (!farmroadData || !farmroadData.devices || farmroadData.devices.length === 0) {
    // Fallback: try aggregateSerreData (may use Open-Meteo)
    const serre = await aggregateSerreData(dateStr);
    if (!serre || serre.T_max_serre === undefined) {
      return { error: "No data available for " + dateStr };
    }
    // Use serre data directly
    const tmax = serre.T_max_serre;
    const tmin = serre.T_min_serre;
    const hr = serre.HR_moyenne || 70;
    const dli = serre.PAR_sum || null;
    return await _saveGDD(dateStr, tmax, tmin, hr, dli, "serre_fallback");
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
  if (!bestDevice) return { error: "No suitable device found" };

  const m = bestDevice.measurements || {};
  const tmax = m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.max : null;
  const tmin = m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.min : null;
  const hr = m.RH_INSIDE ? m.RH_INSIDE.avg : 70;
  const parAvg = m.PAR_INTENSITY ? m.PAR_INTENSITY.avg : 0;
  const parCount = m.PAR_INTENSITY ? m.PAR_INTENSITY.count : 0;
  const dli = parCount > 0 ? Math.round(parAvg * 3600 * 12 / 1e6 * 100) / 100 : null;

  if (tmax === null || tmin === null) return { error: "Missing temperature data" };

  return await _saveGDD(dateStr, tmax, tmin, hr, dli, bestDevice.deviceId || bestDevice.compartmentId || "unknown");
}

async function _saveGDD(dateStr, tmax, tmin, hr, dli, capteurId) {
  // Get previous day's cumulative GDD
  let gddCumulePrev = 0;
  const prevDate = new Date(dateStr + "T12:00:00");
  prevDate.setDate(prevDate.getDate() - 1);
  const prevStr = prevDate.toISOString().slice(0, 10);

  if (prevStr >= GDD_CONFIG.J0) {
    const prevDoc = await db_firestore.collection("gdd_tracking").doc(prevStr).get();
    if (prevDoc.exists) {
      gddCumulePrev = prevDoc.data().gdd_cumule || 0;
    }
  }

  const gddJour = Math.round(calcGDD(tmax, tmin) * 100) / 100;
  const gddCumule = Math.round((gddCumulePrev + gddJour) * 100) / 100;
  const imcResult = calcIMC({ gddCumule, tmax, tmin, hr, dli });

  const doc = {
    date: dateStr,
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
    capteur_id: capteurId,
    variete: GDD_CONFIG.VARIETE,
    j0: GDD_CONFIG.J0,
    serre: GDD_CONFIG.SERRE,
    _createdAt: Date.now(),
  };

  await db_firestore.collection("gdd_tracking").doc(dateStr).set(doc);

  // Also populate serre_data so climatProduction endpoint has fresh data
  await db_firestore.collection("farms").doc("larache").collection("serre_data").doc(dateStr).set({
    date: dateStr,
    T_max_serre: Math.round(tmax * 100) / 100,
    T_min_serre: Math.round(tmin * 100) / 100,
    HR_moyenne: Math.round(hr * 100) / 100,
    PAR_sum: dli,
    source: capteurId,
    _cachedAt: Date.now(),
  }, { merge: true });

  console.log("GDD saved:", dateStr, "GDD_jour:", gddJour, "GDD_cumule:", gddCumule, "IMC:", imcResult.pourcentage + "%", "Alerte:", imcResult.alerte);

  if (imcResult.alerte === "RECOLTE_IMMINENTE") {
    console.log("RECOLTE_IMMINENTE — GDD cumules:", gddCumule, "/ IMC:", imcResult.pourcentage + "%");
  }

  return doc;
}

// =============================================
// FarmRoad health monitoring — alert on consecutive empty nights
// =============================================
// State lives at _health/farmroad_status:
//   { consecutiveEmptyNights, lastEmptyDate, lastNonEmptyDate, lastNotifiedDate }
// Alert fires on the 2nd consecutive empty night (and not again until data resumes).
async function checkFarmroadHealthAndAlert(todayStr) {
  try {
    const cacheDoc = await db_firestore.collection("farmroad_cache").doc(todayStr).get();
    const totalMeasurements = cacheDoc.exists ? (cacheDoc.data().totalMeasurements || 0) : 0;
    const isEmpty = totalMeasurements === 0;

    const healthRef = db_firestore.collection("_health").doc("farmroad_status");
    const healthSnap = await healthRef.get();
    const prev = healthSnap.exists ? healthSnap.data() : {};

    if (!isEmpty) {
      // Healthy night → reset counters and notification flag
      await healthRef.set({
        consecutiveEmptyNights: 0,
        lastEmptyDate: prev.lastEmptyDate || null,
        lastNonEmptyDate: todayStr,
        lastNotifiedDate: null,
        lastMeasurements: totalMeasurements,
        updatedAt: Date.now(),
      });
      console.log("FarmRoad health: OK (" + totalMeasurements + " measurements " + todayStr + ")");
      return;
    }

    // Empty night — increment counter (idempotent vs same-day re-run)
    const prevCount = prev.consecutiveEmptyNights || 0;
    const newCount = (prev.lastEmptyDate === todayStr) ? prevCount : prevCount + 1;
    const lastNotifiedDate = prev.lastNotifiedDate || null;
    const shouldAlert = newCount >= 2 && lastNotifiedDate !== todayStr;

    await healthRef.set({
      consecutiveEmptyNights: newCount,
      lastEmptyDate: todayStr,
      lastNonEmptyDate: prev.lastNonEmptyDate || null,
      lastNotifiedDate: shouldAlert ? todayStr : lastNotifiedDate,
      lastMeasurements: 0,
      updatedAt: Date.now(),
    });

    console.log("FarmRoad health: EMPTY (consecutive=" + newCount + ", lastNonEmpty=" + (prev.lastNonEmptyDate || "n/a") + ", willAlert=" + shouldAlert + ")");

    if (shouldAlert) {
      const lastOk = prev.lastNonEmptyDate || "inconnue";
      // Wrapping rappel : template general_alert encadre déjà par
      // "SmartBerry — Notification : {{1}}. Consultez votre tableau de bord pour plus de détails."
      // → on commence par un titre explicite pour que le push WhatsApp soit immédiatement reconnaissable.
      const message =
        "⚠️ CAPTEUR FARMROAD — Problème de connexion. " +
        "Sondes Larache hors-ligne depuis le " + lastOk + " (" + newCount + " nuits consécutives sans données). " +
        "Action : vérifier état physique et connectivité des 2 capteurs (canarienne 210506929 + tunnel 210506960)";
      try {
        await dispatchNotification({
          type: "general_alert",
          profiles: ["dg", "dt", "rh"],
          data: { message, severity: "warning" },
        });
        console.log("FarmRoad health: WhatsApp alert dispatched to [dg,dt,rh] — " + message);
      } catch (err) {
        console.error("FarmRoad health alert dispatch failed:", err.message);
      }
    }
  } catch (err) {
    console.error("checkFarmroadHealthAndAlert error:", err.message);
  }
}

// =============================================
// GDD Nightly Job — runs at 23:00 Africa/Casablanca
// =============================================
exports.gddNightlyJob = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .pubsub.schedule("0 23 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const todayStr = localDateStr();
    console.log("GDD nightly job for", todayStr);

    // 1. GDD computation (existing)
    const result = await computeGDDForDate(todayStr);
    if (result.error) console.error("GDD job error:", result.error);
    if (result.skipped) console.log("GDD job skipped:", result.reason);

    // 2. Persist outdoor meteo for all farms
    try {
      await persistMeteoOutdoor(todayStr);
    } catch (err) {
      console.error("Meteo outdoor persist error:", err.message);
    }

    // 3. Update climat model (outdoor→indoor regression)
    try {
      await updateClimatModel(todayStr);
    } catch (err) {
      console.error("Climat model update error:", err.message);
    }

    // 4. FarmRoad health check — WhatsApp alert on 2nd consecutive empty night
    await checkFarmroadHealthAndAlert(todayStr);

    return null;
  });

// =============================================
// GDD Tracking — HTTP endpoint
// =============================================
exports.gddTracking = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      // Manual trigger: POST /api/gdd-tracking?action=compute&date=2026-03-29
      // or POST /api/gdd-tracking?action=backfill to fill all days from J0 to today
      if (req.method === "POST") {
        const action = req.query.action;
        if (action === "compute") {
          const dateParam = req.query.date || localDateStr();
          const result = await computeGDDForDate(dateParam);
          return res.json({ success: !result.error, ...result });
        }
        if (action === "backfill") {
          const today = localDateStr();
          const results = [];
          let d = new Date(GDD_CONFIG.J0 + "T12:00:00");
          const end = new Date(today + "T12:00:00");
          while (d <= end) {
            const ds = d.toISOString().slice(0, 10);
            const r = await computeGDDForDate(ds);
            results.push({ date: ds, ...r });
            d.setDate(d.getDate() + 1);
          }
          return res.json({ success: true, backfilled: results.length, results });
        }
        return res.status(400).json({ error: "Unknown action. Use ?action=compute or ?action=backfill" });
      }

      const snapshot = await db_firestore.collection("gdd_tracking")
        .orderBy("date", "asc")
        .get();

      const data = [];
      snapshot.forEach(doc => data.push(doc.data()));

      if (data.length === 0) {
        return res.json({ success: true, data: [], gddCumule: 0, imcActuel: null, joursDepuisJ0: 0, jourRecolteEstime: null, config: { j0: GDD_CONFIG.J0, gddCible: GDD_CONFIG.GDD_CIBLE, variete: GDD_CONFIG.VARIETE } });
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
// Climat-Production — Corrélations décalées
// =============================================

exports.onAnalyseFoliaireWrite = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .firestore.document("analyses_foliaires/{id}")
  .onWrite(async (change, context) => {
    if (!change.after.exists) return null; // deletion
    const after = change.after.data() || {};
    const before = change.before.exists ? change.before.data() || {} : {};
    const id = context.params.id;

    const beforeUrl = before.scan_resultat_url || null;
    const afterUrl = after.scan_resultat_url || null;

    // Only fire when the PDF appears for the first time.
    if (!afterUrl) return null;
    if (beforeUrl === afterUrl) return null; // no scan change; irrelevant write

    // Skip if a valid reco already exists (avoid loops on self-updates).
    const existingRecos = after.recommandations_ia || [];
    const refusalRe = /^\s*(je ne peux pas|je n'ai pas|désolé|sorry|i (cannot|can't|don't))/i;
    const hasValid = existingRecos.some(r => r && r.message && r.message.length >= 600 && !refusalRe.test(r.message));
    if (hasValid) return null;

    console.log(`onAnalyseFoliaireWrite: auto-generating reco for ${id} (ferme=${after.ferme}, variete=${after.variete})`);
    try {
      const result = await generateRecoForAnalyse(id, {
        ferme: after.ferme,
        culture: after.culture,
        parcelle: after.variete || after.parcelle,
        scan_url: afterUrl,
        note_demande: after.terrain_raw || "",
        force: false,
      });
      if (result.success) {
        console.log(`onAnalyseFoliaireWrite: reco saved for ${id}, cached=${!!result.cached}`);
      } else {
        console.error(`onAnalyseFoliaireWrite: reco failed for ${id}:`, result.error);
      }
    } catch (e) {
      console.error(`onAnalyseFoliaireWrite: uncaught error for ${id}:`, e.message, e.stack);
    }
    return null;
  });

const netafim = require("../../../lib/netafim");

// Daily sync — 04:00 Africa/Casablanca, well outside business hours.
// Each run burns 1 token call + ~1-3 pages; quota cap is 25/day.
exports.netafimSyncDaily = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .pubsub.schedule("0 4 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const out = await netafim.syncBahia({ db: db_firestore, generatedBy: "cron" });
    console.log("[netafimSyncDaily]", JSON.stringify(out));
    return null;
  });

// Manual one-shot trigger for backfill / debugging.
//   GET /netafimSyncOnce?from=2026-05-09&to=2026-05-16&dryRun=true
// Protected by admin-secret header to avoid exposing the call to anyone with
// the function URL. Set NETAFIM_ADMIN_SECRET in the runtime env (or Firebase
// functions config) and pass it as `x-admin-secret`.
exports.netafimSyncOnce = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    const expected = process.env.NETAFIM_ADMIN_SECRET;
    const provided = req.get("x-admin-secret") || req.query.secret;
    if (!expected || provided !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const dateFrom = req.query.from ? String(req.query.from) : undefined;
    const dateTo = req.query.to ? String(req.query.to) : undefined;
    const dryRun = req.query.dryRun === "true" || req.query.dryRun === "1";
    try {
      const out = await netafim.syncBahia({
        db: db_firestore,
        dateFrom,
        dateTo,
        dryRun,
        generatedBy: "manual",
      });
      res.json(out);
    } catch (err) {
      console.error("[netafimSyncOnce]", err);
      res.status(500).json({ error: err && err.message ? err.message : String(err) });
    }
  });

// =============================================
// Sprint 2 — Phenology daily cron + HTTP trigger (T7)
// =============================================
// New phenology engine running in PARALLEL to the legacy gddNightlyJob.
// Pure modules + DI live in lib/phenology/. This block only WIRES the
// 2 exports to firebase-functions + production deps; no business logic
// is duplicated here.
//
// Coexistence: legacy gddNightlyJob writes gdd_tracking/{date}, new
// dailyPhenologyJob writes plots/{plotId}/phenology_daily/{date}.
// Independent, no race, same 23:00 schedule. Cf. project memory
// project_phenology_sprint2_design.md.

const phenologyJob = require("../../../lib/phenology/dailyPhenologyJob");
const phenologyRefLoader = require("../../../lib/phenology/referenceLoader");
const phenologyStation = require("../../../lib/phenology/farmroadStationResolver");
const phenologyOutdoor = require("../../../lib/phenology/outdoorWeatherFallback");
const phenologyFetcher = require("../../../lib/phenology/radiationFetcher");
const phenologyWriter = require("../../../lib/phenology/phenologyDailyWriter");

// Production deps wiring — done lazily inside handlers so module load stays cheap.
function buildPhenologyProdDeps() {
  const httpsGet = (url) => new Promise((resolve) => {
    const https = require("https");
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (c) => { data += c; });
      resp.on("end", () => {
        if (resp.statusCode >= 200 && resp.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch (_) { resolve(null); }
        } else resolve(null);
      });
    }).on("error", () => resolve(null));
  });

  const refDeps = {
    readReferenceDoc: async (docId) => {
      const snap = await db_firestore.collection("phenology_references").doc(docId).get();
      return snap.exists ? snap.data() : null;
    },
  };
  const stationDeps = {
    readStationById: async (stationId) => {
      const snap = await db_firestore.collection("farmroad_stations").doc(stationId).get();
      return snap.exists ? snap.data() : null;
    },
    listStationsByType: async (type) => {
      const snap = await db_firestore.collection("farmroad_stations").where("type", "==", type).get();
      return snap.docs.map((d) => d.data());
    },
    logWarn: (msg, ctx) => console.warn(msg, ctx || ""),
  };
  const outdoorWrapped = (params) => phenologyOutdoor.fetchOutdoorDaily(params, { fetchJson: httpsGet });
  const fetcherDeps = {
    readFarmroadCache: async (date) => {
      const snap = await db_firestore.collection("farmroad_cache").doc(date).get();
      return snap.exists ? snap.data() : null;
    },
    fetchOutdoorDaily: outdoorWrapped,
  };
  const writerDeps = {
    writeDoc: async (plotId, date, doc) => {
      await db_firestore.collection("plots").doc(plotId).collection("phenology_daily").doc(date).set(doc);
    },
    updatePlotPhenologyState: async (plotId, partial) => {
      await db_firestore.collection("plots").doc(plotId).update(partial);
    },
  };

  return {
    listEnabledPlots: async () => {
      const snap = await db_firestore.collection("plots").where("phenology.enabled", "==", true).get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    resolveStation: (plot) => phenologyStation.resolveStation(plot, stationDeps),
    fetchRadiationDaily: (params) => phenologyFetcher.fetchRadiationDaily(params, fetcherDeps),
    loadReference: (variety, cycleType) => phenologyRefLoader.loadReference(variety, cycleType, refDeps),
    readPhenologyDaily: async (plotId, date) => {
      const snap = await db_firestore.collection("plots").doc(plotId).collection("phenology_daily").doc(date).get();
      return snap.exists ? snap.data() : null;
    },
    writePhenologyDaily: (plotId, date, computed) => phenologyWriter.writePhenologyDaily(plotId, date, computed, writerDeps),
    logger: (msg, ctx) => console.log(msg, ctx || ""),
  };
}

// Cron — 23:00 Africa/Casablanca (cohabitation with legacy gddNightlyJob)
exports.dailyPhenologyJob = functions
  .region(phenologyJob.CRON_CONFIG.region)
  .runWith({
    timeoutSeconds: phenologyJob.CRON_CONFIG.timeoutSeconds,
    memory: phenologyJob.CRON_CONFIG.memorySize,
  })
  .pubsub.schedule(phenologyJob.CRON_CONFIG.schedule)
  .timeZone(phenologyJob.CRON_CONFIG.timeZone)
  .onRun(async () => {
    const date = localDateStr();
    console.log("[dailyPhenologyJob] cron start date=" + date);
    try {
      const summary = await phenologyJob.runDailyPhenologyJob(date, buildPhenologyProdDeps());
      console.log("[dailyPhenologyJob] cron done", JSON.stringify(summary));
    } catch (err) {
      console.error("[dailyPhenologyJob] cron error:", err.message);
    }
    return null;
  });

// HTTP trigger — manual one-shot (auth-required, optional ?date= for replay)
exports.runDailyPhenologyJobNow = functions
  .region(phenologyJob.HTTP_CONFIG.region)
  .runWith({
    timeoutSeconds: phenologyJob.HTTP_CONFIG.timeoutSeconds,
    memory: phenologyJob.HTTP_CONFIG.memorySize,
  })
  .https.onRequest(phenologyJob.buildHttpHandler({
    requireAuth,
    runJob: (date) => phenologyJob.runDailyPhenologyJob(date, buildPhenologyProdDeps()),
    todayISO: () => localDateStr(),
    setCors,
    logger: (msg, ctx) => console.error(msg, ctx || ""),
  }));

// =============================================
// Jours fériés Maroc — job hebdomadaire (lundi) + trigger test
// Source unique : app_settings/jours_feries. Fêtes civiles via date.nager.at,
// fêtes islamiques estimées par conversion Hijri (Aladhan). Réaligne les dates,
// confirme à l'approche, notifie RH/DG ; respecte TOUJOURS les overrides RH.
// =============================================
