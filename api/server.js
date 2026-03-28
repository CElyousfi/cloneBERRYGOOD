const express = require("express");
const cors = require("cors");
const sql = require("mssql");

const app = express();
app.use(cors());
app.use(express.json());

// =============================================
// Configuration SQL Server Berry Good
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
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Pool de connexion réutilisable
let pool = null;
async function getPool() {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

// =============================================
// API 1: Health check / test connexion
// =============================================
app.get("/api/health", async (req, res) => {
  try {
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
// API 2: Programme Fertigation par parcelle/semaine
// =============================================
app.get("/api/fertigation", async (req, res) => {
  try {
    const db = await getPool();
    const { parcelle, culture, ferme, weekStart, weekEnd } = req.query;

    let query = `
      SELECT
        c.Parcelle_Physique, c.Culture, c.Ferme, c.Article, c.Article_Categorie,
        c.Quantite, c.Article_unite, c.[Date],
        DATEPART(dw, c.[Date]) AS JourSemaine
      FROM BR_Consommation c
      WHERE c.Article_Categorie = 'Engrais'
        AND c.[Date] >= '2025-07-01'
    `;
    const request = db.request();

    if (parcelle) {
      query += ` AND c.Parcelle_Physique = @parcelle`;
      request.input("parcelle", sql.NVarChar, parcelle);
    }
    if (culture) {
      query += ` AND c.Culture = @culture`;
      request.input("culture", sql.NVarChar, culture);
    }
    if (ferme) {
      query += ` AND c.Ferme = @ferme`;
      request.input("ferme", sql.NVarChar, ferme);
    }
    if (weekStart) {
      query += ` AND c.[Date] >= @weekStart`;
      request.input("weekStart", sql.Date, weekStart);
    }
    if (weekEnd) {
      query += ` AND c.[Date] <= @weekEnd`;
      request.input("weekEnd", sql.Date, weekEnd);
    }

    query += ` ORDER BY c.Parcelle_Physique, c.[Date], c.Article`;
    const result = await request.query(query);

    // Structurer par parcelle → semaine → jour → produit
    const structured = {};
    result.recordset.forEach((row) => {
      const parc = row.Parcelle_Physique;
      const date = new Date(row.Date);
      const jan1 = new Date(date.getFullYear(), 0, 1);
      const dayOfYear = Math.floor((date - jan1) / 86400000) + 1;
      const weekNum = Math.ceil((dayOfYear + jan1.getDay()) / 7);
      const weekKey = date.getFullYear() + "-W" + String(weekNum).padStart(2, "0");
      const dayNames = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
      const dayKey = dayNames[date.getDay()];

      if (!structured[parc]) {
        structured[parc] = { culture: row.Culture, ferme: row.Ferme, weeks: {} };
      }
      if (!structured[parc].weeks[weekKey]) {
        structured[parc].weeks[weekKey] = { days: {}, label: "Sem. " + parseInt(weekNum) };
      }
      if (!structured[parc].weeks[weekKey].days[dayKey]) {
        structured[parc].weeks[weekKey].days[dayKey] = {};
      }
      const article = row.Article;
      structured[parc].weeks[weekKey].days[dayKey][article] =
        (structured[parc].weeks[weekKey].days[dayKey][article] || 0) + (row.Quantite || 0);
    });

    res.json({ success: true, count: result.recordset.length, data: structured });
  } catch (err) {
    console.error("Erreur SQL fertigation:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================
// API 3: Liste des produits engrais uniques
// =============================================
app.get("/api/produits", async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT Article, Article_Categorie, Article_unite, SUM(Quantite) AS TotalQty,
        COUNT(DISTINCT Parcelle_Physique) AS NbParcelles,
        MIN([Date]) AS PremiereUtilisation,
        MAX([Date]) AS DerniereUtilisation
      FROM BR_Consommation
      WHERE Article_Categorie = 'Engrais'
        AND [Date] >= '2025-07-01'
      GROUP BY Article, Article_Categorie, Article_unite
      ORDER BY SUM(Quantite) DESC
    `);
    res.json({ success: true, count: result.recordset.length, produits: result.recordset });
  } catch (err) {
    console.error("Erreur SQL produits:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================
// API 4: Parcelles avec résumé
// =============================================
app.get("/api/parcelles", async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT Parcelle_Physique, Culture, Ferme,
        SUM(CASE WHEN Article_Categorie = 'Engrais' THEN Quantite ELSE 0 END) AS TotalEngrais,
        SUM(CASE WHEN Article_Categorie = 'Pesticides' THEN Quantite ELSE 0 END) AS TotalPesticides,
        COUNT(DISTINCT Article) AS NbProduits,
        MIN([Date]) AS Debut, MAX([Date]) AS Fin
      FROM BR_Consommation
      WHERE [Date] >= '2025-07-01'
      GROUP BY Parcelle_Physique, Culture, Ferme
      ORDER BY Parcelle_Physique
    `);
    res.json({ success: true, count: result.recordset.length, parcelles: result.recordset });
  } catch (err) {
    console.error("Erreur SQL parcelles:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================
// API 5: Dashboard agrégé
// =============================================
app.get("/api/dashboard", async (req, res) => {
  try {
    const db = await getPool();
    const [topEngrais, topPesticides, mensuel] = await Promise.all([
      db.request().query(`
        SELECT TOP 20 Article, SUM(Quantite) AS Qty, Article_Categorie
        FROM BR_Consommation
        WHERE Article_Categorie = 'Engrais'
          AND [Date] >= '2025-07-01'
        GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC
      `),
      db.request().query(`
        SELECT TOP 20 Article, SUM(Quantite) AS Qty, Article_Categorie
        FROM BR_Consommation
        WHERE Article_Categorie = 'Pesticides'
          AND [Date] >= '2025-07-01'
        GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC
      `),
      db.request().query(`
        SELECT FORMAT([Date],'yyyy-MM') AS Mois,
          SUM(CASE WHEN Article_Categorie = 'Engrais' THEN Quantite ELSE 0 END) AS Engrais,
          SUM(CASE WHEN Article_Categorie = 'Pesticides' THEN Quantite ELSE 0 END) AS Pesticides
        FROM BR_Consommation WHERE [Date] >= '2025-07-01'
        GROUP BY FORMAT([Date],'yyyy-MM')
        ORDER BY FORMAT([Date],'yyyy-MM')
      `),
    ]);
    res.json({
      success: true,
      topEngrais: topEngrais.recordset,
      topPesticides: topPesticides.recordset,
      consommationMensuelle: mensuel.recordset,
      dateExtraction: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Erreur SQL dashboard:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================
// API 6: Agro Summary — NPK par parcelle depuis SQL
// =============================================
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

app.get("/api/agro-summary", async (req, res) => {
  try {
    const db = await getPool();

    const parcResult = await db.request().query(`
      SELECT Parcelle_Physique, Culture, Ferme, Article, SUM(Quantite) AS Qty,
        MAX(Parcelle_sup) AS Parcelle_sup
      FROM BR_Consommation
      WHERE Article_Categorie = 'Engrais'
        AND [Date] >= '2025-07-01'
      GROUP BY Parcelle_Physique, Culture, Ferme, Article
      ORDER BY Parcelle_Physique, Article
    `);

    const topEngResult = await db.request().query(`
      SELECT TOP 20 Article, SUM(Quantite) AS Qty, Article_Categorie
      FROM BR_Consommation
      WHERE Article_Categorie = 'Engrais'
        AND [Date] >= '2025-07-01'
      GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC
    `);

    const topPestResult = await db.request().query(`
      SELECT TOP 25 Article, SUM(Quantite) AS Qty, Article_Categorie
      FROM BR_Consommation
      WHERE Article_Categorie = 'Pesticides'
        AND [Date] >= '2025-07-01'
      GROUP BY Article, Article_Categorie ORDER BY SUM(Quantite) DESC
    `);

    const pestByParc = await db.request().query(`
      SELECT Parcelle_Physique, SUM(Quantite) AS TotalPest
      FROM BR_Consommation
      WHERE Article_Categorie = 'Pesticides'
        AND [Date] >= '2025-07-01'
      GROUP BY Parcelle_Physique
    `);
    const pestMap = {};
    pestByParc.recordset.forEach(r => { pestMap[r.Parcelle_Physique] = r.TotalPest || 0; });

    const parcMap = {};
    parcResult.recordset.forEach(row => {
      const parcName = row.Parcelle_Physique;
      if (!parcMap[parcName]) {
        parcMap[parcName] = {
          parcelle: parcName, culture: row.Culture, ferme: row.Ferme,
          sup: row.Parcelle_sup || SURFACES_HA[parcName] || 1,
          N: 0, P2O5: 0, K2O: 0, CaO: 0, MgO: 0, engrais: 0, pest: 0
        };
      }
      const p = parcMap[parcName];
      const qty = row.Qty || 0;
      p.engrais += qty;
      const comp = COMPOSITION_NPK[row.Article];
      if (comp) {
        p.N += qty * comp.N; p.P2O5 += qty * comp.P2O5; p.K2O += qty * comp.K2O;
        p.CaO += qty * comp.CaO; p.MgO += qty * comp.MgO;
      }
    });

    Object.values(parcMap).forEach(p => {
      p.pest = pestMap[p.parcelle] || 0;
      p.N = Math.round(p.N * 10) / 10; p.P2O5 = Math.round(p.P2O5 * 10) / 10;
      p.K2O = Math.round(p.K2O * 10) / 10; p.CaO = Math.round(p.CaO * 10) / 10;
      p.MgO = Math.round(p.MgO * 10) / 10; p.engrais = Math.round(p.engrais * 10) / 10;
      p.pest = Math.round(p.pest * 10) / 10;
    });

    const parcelles = Object.values(parcMap);

    const cultMap = {};
    parcelles.forEach(p => {
      if (!cultMap[p.culture]) {
        cultMap[p.culture] = { culture: p.culture, sup: 0, N: 0, P2O5: 0, K2O: 0, CaO: 0, MgO: 0, engrais: 0, pest: 0 };
      }
      const c = cultMap[p.culture];
      c.sup += p.sup; c.N += p.N; c.P2O5 += p.P2O5; c.K2O += p.K2O;
      c.CaO += p.CaO; c.MgO += p.MgO; c.engrais += p.engrais; c.pest += p.pest;
    });
    const cultures = Object.values(cultMap).map(c => ({
      culture: c.culture, sup: Math.round(c.sup * 100) / 100,
      N_Ha: Math.round(c.N / c.sup * 10) / 10, P_Ha: Math.round(c.P2O5 / c.sup * 10) / 10,
      K_Ha: Math.round(c.K2O / c.sup * 10) / 10, CaO_Ha: Math.round(c.CaO / c.sup * 10) / 10,
      MgO_Ha: Math.round(c.MgO / c.sup * 10) / 10,
      Ca_K: c.K2O > 0 ? Math.round(c.CaO / c.K2O * 100) / 100 : 0,
      Eng_Ha: Math.round(c.engrais / c.sup * 10) / 10, Pest_Ha: Math.round(c.pest / c.sup * 10) / 10,
    }));

    const topEngrais = topEngResult.recordset.map(r => ({ article: r.Article, qty: Math.round(r.Qty), type: r.Article_Categorie }));
    const pesticides = topPestResult.recordset.map(r => ({ article: r.Article, qty: Math.round(r.Qty * 10) / 10, type: r.Article_Categorie }));

    res.json({
      success: true, parcelles, cultures, topEngrais, pesticides,
      campagne: "2025/2026", dateExtraction: new Date().toLocaleDateString("fr-FR"),
    });
  } catch (err) {
    console.error("Erreur SQL agro-summary:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// =============================================
// Démarrage du serveur
// =============================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Berry Good API running on port ${PORT}`);
});
