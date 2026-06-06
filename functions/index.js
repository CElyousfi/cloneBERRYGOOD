const functions = require("firebase-functions");
const nodemailer = require("nodemailer");

// Shared config & middleware
const { admin, db: db_firestore, bucket } = require("./config/firebase");
const sqlConfig = require("./config/sqlConfig");
const { setCors } = require("./middleware/cors");
const { withCache } = require("./middleware/cache");
const { verifyAuth, requireAuth } = require("./middleware/requireAuth");
const { dispatchNotification } = require("./notificationDispatcher");
const { validateBdcCore } = require("./bdcValidationService");
const { updateBdcVirementCore, recordVirementAvis } = require("./bdcVirementService");
const bdcWorkflow = require("./lib/bdc/workflow");
const caisseImport = require("./lib/caisseImport");
const stockCaneva = require("./lib/stockCaneva");
const whatsappService = require("./whatsappService");

// =============================================
// Firestore Mirror — reads from synced collections
// =============================================
const { getConsommationRows, getCueilletteRows, getPointageRowsForDate, getPointageRowsForDateRange, getSyncStatus, getPointageMeta } = require("./firestoreDataService");
const USE_MIRROR = process.env.USE_FIRESTORE_MIRROR !== "false";

// Import & re-export sync functions
const syncService = require("./sqlSyncService");
exports.replicationProbe = syncService.replicationProbe;
exports.sqlToFirestoreSync = syncService.sqlToFirestoreSync;
exports.sqlSyncTrigger = syncService.sqlSyncTrigger;
exports.probeAnalyzer = syncService.probeAnalyzer;
exports.probeAnalysisReport = syncService.probeAnalysisReport;
exports.probeRawData = syncService.probeRawData;

// Import & re-export production DB sync functions
const prodSync = require("./prodSyncService");

// Sync récolte prod (Tracabilite_recolte) — toutes les 30 min de 11h à 20h
exports.syncRecolteFromProd = functions.region("europe-west1").pubsub
  .schedule("*/15 11-20 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(() => prodSync.syncTracabiliteRecolte());

// Daily production digest @ 20h30 Casablanca — DG (global) + Chef F1 + Chef F5.
exports.dailyProductionDigest = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 180, memory: "512MB" })
  .pubsub.schedule("30 20 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    try {
      const dailyProductionReport = require("./dailyProductionReport");
      const result = await dailyProductionReport.sendDailyProductionReport();
      console.log("[dailyProductionDigest]", result);
    } catch (err) {
      console.error("[dailyProductionDigest] error:", err);
    }
    return null;
  });

// Manual trigger for daily production report — ?date=YYYY-MM-DD (default: today Casablanca).
exports.dailyProductionReportTrigger = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 180, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    // List configured recipients for the 3 audiences via ?checkRecipients=1.
    if (req.query.checkRecipients === '1') {
      try {
        const whatsapp = require('./whatsappService');
        const [dg, chefF1, chefF5] = await Promise.all([
          whatsapp.resolveRecipientsForProfile('dg', null),
          whatsapp.resolveRecipientsForProfile('chef_f1', null),
          whatsapp.resolveRecipientsForProfile('chef_f5', null),
        ]);
        const mask = (p) => p ? p.slice(0, 4) + '***' + p.slice(-3) : null;
        const fmt = (arr) => arr.map(r => ({ uid: r.uid, displayName: r.displayName, ferme: r.ferme, phone: mask(r.phone) }));

        // Broader scan: any user with profileId containing "chef" and any user
        // with whatsappEnabled=true, to spot misconfigurations.
        const allChefSnap = await db_firestore.collection('users').get();
        const candidates = [];
        allChefSnap.docs.forEach(d => {
          const u = d.data() || {};
          const pid = String(u.profileId || '');
          if (pid.includes('chef') || pid === 'dg') {
            candidates.push({
              uid: d.id,
              profileId: pid,
              displayName: u.displayName || null,
              ferme: u.ferme || null,
              whatsappEnabled: !!u.whatsappEnabled,
              hasPhone: !!u.whatsappPhone,
              disabled: !!u.disabled,
            });
          }
        });
        return res.json({
          dg: { count: dg.length, recipients: fmt(dg) },
          chefF1: { count: chefF1.length, recipients: fmt(chefF1) },
          chefF5: { count: chefF5.length, recipients: fmt(chefF5) },
          allCandidates: candidates,
        });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    // One-shot: submit Meta template via ?submitTemplate=1 (uses Firestore token).
    if (req.query.submitTemplate === '1') {
      try {
        const cfgDoc = await db_firestore.collection("config").doc("whatsapp").get();
        if (!cfgDoc.exists) return res.status(500).json({ error: "config/whatsapp missing" });
        const cfg = cfgDoc.data();
        const token = cfg.access_token;
        const wabaId = cfg.waba_id || "1435674314903560";
        if (!token) return res.status(500).json({ error: "access_token missing" });
        const payload = {
          name: "production_digest_dg",
          language: "fr",
          category: "UTILITY",
          components: [{
            type: "BODY",
            text: "Bonjour, voici le récap de production SmartBerry pour {{1}} :\n\n{{2}}\n\nConsultez votre tableau de bord pour le détail complet et l'historique.",
            example: { body_text: [[
              "17/05",
              "Estimation Cycle 2 : Maravilla GC 9.37 T/Ha (Budget 72%), Corina 3.48 Kg/Pl (Budget 87%).",
            ]] },
          }],
        };
        const r = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        return res.status(r.ok ? 200 : 500).json({ ok: r.ok, status: r.status, data });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)) ? req.query.date : undefined;
    const preview = req.query.preview === '1' || req.query.preview === 'true';
    const debug = req.query.debug === '1' || req.query.debug === 'true';
    try {
      const dailyProductionReport = require("./dailyProductionReport");
      const result = await dailyProductionReport.sendDailyProductionReport(date, { preview, debug });
      console.log("[dailyProductionReportTrigger]", { ...result, message: undefined, stats: undefined, diagnostic: undefined });
      res.json({ success: true, ...result, dateRequested: date || null });
    } catch (err) {
      console.error("[dailyProductionReportTrigger] error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// One-shot helper to submit the `production_digest_dg` template to Meta
// using the access token stored in Firestore (config/whatsapp). Hit once
// and watch the response, then wait for Meta to approve.
exports.submitProductionDigestTemplate = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    try {
      const cfgDoc = await db_firestore.collection("config").doc("whatsapp").get();
      if (!cfgDoc.exists) return res.status(500).json({ error: "config/whatsapp missing" });
      const cfg = cfgDoc.data();
      const token = cfg.access_token;
      const wabaId = cfg.waba_id || "1435674314903560";
      if (!token) return res.status(500).json({ error: "access_token missing in config/whatsapp" });

      const tpl = {
        name: "production_digest_dg",
        body: "SmartBerry — Production {{1}}\n\n{{2}}",
        examples: [
          "17/05",
          "🎯 Estimation Cycle 2\n🍇 Framboise\n• Maravilla Green Cane — 9.37 T/Ha (Budget 72%, Local 12.0%, Export 37.47 T)\n🫐 Myrtille\n• Corina — 3.48 Kg/Pl (Budget 87%, Local 2.8%, Export 28.72 T)",
        ],
      };
      const payload = {
        name: tpl.name,
        language: "fr",
        category: "UTILITY",
        components: [{
          type: "BODY",
          text: tpl.body,
          example: { body_text: [tpl.examples] },
        }],
      };
      const r = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      res.status(r.ok ? 200 : 500).json({ ok: r.ok, status: r.status, data });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// WhatsApp recap to DG when today's harvest totalKg jumps by ≥100 kg.
// See functions/recolteWhatsAppNotifier.js for the threshold logic.
const recolteWhatsAppNotifier = require("./recolteWhatsAppNotifier");
const { invalidateCache: invalidateApiCache } = require("./middleware/cache");
exports.onProdRecolteWriteNotify = functions
  .region("europe-west1")
  .firestore.document("prod_tracabilite_recolte/{date}")
  .onWrite(async (change, context) => {
    try {
      const result = await recolteWhatsAppNotifier.handleProdRecolteWrite(
        { db: db_firestore, whatsapp: whatsappService, admin, invalidateCache: invalidateApiCache },
        change,
        context
      );
      if (result && (result.sent || result.skipped)) {
        console.log("[onProdRecolteWriteNotify]", context.params.date, result);
      }
      return null;
    } catch (err) {
      console.error("[onProdRecolteWriteNotify] error:", err.message);
      return null;
    }
  });

// Sync présence entrée — 10h
exports.syncPresenceEntree = functions.region("europe-west1").pubsub
  .schedule("0 10 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(() => prodSync.syncPresence("entree"));

// Sync présence sortie — 20h
exports.syncPresenceSortie = functions.region("europe-west1").pubsub
  .schedule("0 20 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(() => prodSync.syncPresence("sortie"));

// Manual trigger for prod sync — ?action=recolte&since=2025-07-01 for historical
exports.syncProdTrigger = functions.region("europe-west1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest(async (req, res) => {
  const action = req.query.action || "recolte";
  let result;
  if (action === "recolte") result = await prodSync.syncTracabiliteRecolte(req.query.since || undefined);
  else if (action === "presence") result = await prodSync.syncPresence(req.query.mode || "entree");
  else result = { error: "Unknown action. Use ?action=recolte&since=2025-07-01 or ?action=presence&mode=entree|sortie" };
  res.json(result);
});

// Backfill prod_presence sur une plage (heures entrée/sortie BEE ONE Production)
// — déclenché manuellement (bouton RH dans Heures Supp.) en fin de quinzaine pour
// rattraper les sorties saisies tardivement. Ne touche pas au pointage analytique.
exports.backfillPresence = functions.region("europe-west1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const src = req.method === "POST" ? (req.body || {}) : req.query;
    const startDate = src.startDate, endDate = src.endDate;
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(startDate || "") || !dateRe.test(endDate || "")) {
      return res.status(400).json({ success: false, error: "startDate et endDate (YYYY-MM-DD) requis" });
    }
    const result = await prodSync.syncPresenceRange(startDate, endDate);
    return res.json(result);
  });

// Import & re-export backup functions
const backupService = require("./backupService");
exports.scheduledBackup = backupService.scheduledBackup;
exports.backupApi = backupService.backupApi;

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
        // Reject on HTTP error status to avoid silently swallowing 401/403/5xx
        // (without this, an auth error body parses fine but missing pagination
        // keys → farmroadFetchAllPages logs "0 items" and the job degrades silently)
        if (resp.statusCode < 200 || resp.statusCode >= 400) {
          return reject(new Error("FarmRoad HTTP " + resp.statusCode + " on " + path + ": " + data.slice(0, 200)));
        }
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

// Compute agronomic KPIs from a device's 15-min timeseries.
// Slot duration = 900s = 0.25h. Photoperiod separation: PAR > 50 µmol = day.
function computeFarmroadKPIs(timeseries, gddJour) {
  const SLOT_SEC = 900;
  const SLOT_HRS = 0.25;
  const ts = timeseries || {};
  const par = ts.PAR_INTENSITY || [];
  const rad = ts.RADIATION_INTENSITY_INSIDE || [];
  const temp = ts.TEMPERATURE_INSIDE || [];
  const rh = ts.RH_INSIDE || [];
  const vpd = ts.ESTIMATED_VPD_INSIDE || [];
  const dew = ts.DEWPOINT_INSIDE || [];
  const co2 = ts.CO2_LEVEL || [];

  const parBySlot = {};
  par.forEach(s => { if (s && s.slot != null) parBySlot[s.slot] = s.avg || 0; });
  const isDay = slot => (parBySlot[slot] || 0) > 50;

  // ---- Lumière ----
  let dliMicromol = 0, radJ = 0, hPARutile = 0, hPARsat = 0;
  par.forEach(s => {
    if (s.avg == null) return;
    dliMicromol += s.avg * SLOT_SEC;
    if (s.avg > 200) hPARutile += SLOT_HRS;
    if (s.avg > 800) hPARsat += SLOT_HRS;
  });
  const dli = dliMicromol / 1e6; // mol/m²/d
  rad.forEach(s => { if (s.avg != null) radJ += s.avg * SLOT_SEC; });
  const radum = radJ / 1e6; // MJ/m²/d

  // ---- Thermique ----
  let tDaySum = 0, tDayN = 0, tNightSum = 0, tNightN = 0;
  let tMin = Infinity, tMax = -Infinity;
  let hStressChaud = 0, hStressFroid = 0, hChill = 0;
  temp.forEach(s => {
    if (s.avg == null) return;
    if (isDay(s.slot)) { tDaySum += s.avg; tDayN++; } else { tNightSum += s.avg; tNightN++; }
    if (s.min != null && s.min < tMin) tMin = s.min;
    if (s.max != null && s.max > tMax) tMax = s.max;
    if (s.avg > 30) hStressChaud += SLOT_HRS;
    if (s.avg < 5) hStressFroid += SLOT_HRS;
    if (s.avg < 7) hChill += SLOT_HRS;
  });
  const tDay = tDayN > 0 ? tDaySum / tDayN : null;
  const tNight = tNightN > 0 ? tNightSum / tNightN : null;
  const dif = (tDay != null && tNight != null) ? tDay - tNight : null;
  const ampl24 = (tMin !== Infinity && tMax !== -Infinity) ? tMax - tMin : null;

  // ---- Hydrique / VPD ----
  let vpdDaySum = 0, vpdDayN = 0, vpdNightSum = 0, vpdNightN = 0;
  let hStressVPDHaut = 0, hStressVPDBas = 0;
  vpd.forEach(s => {
    if (s.avg == null) return;
    if (isDay(s.slot)) { vpdDaySum += s.avg; vpdDayN++; } else { vpdNightSum += s.avg; vpdNightN++; }
    if (s.avg > 1.5) hStressVPDHaut += SLOT_HRS;
    if (isDay(s.slot) && s.avg < 0.4) hStressVPDBas += SLOT_HRS;
  });
  const vpdJour = vpdDayN > 0 ? vpdDaySum / vpdDayN : null;
  const vpdNuit = vpdNightN > 0 ? vpdNightSum / vpdNightN : null;

  // ---- Phyto: heures de mouillage (T - Tdew < 2°C) ----
  const tBySlot = {}, dewBySlot = {};
  temp.forEach(s => { if (s && s.slot != null) tBySlot[s.slot] = s.avg; });
  dew.forEach(s => { if (s && s.slot != null) dewBySlot[s.slot] = s.avg; });
  let hMouillage = 0;
  Object.keys(tBySlot).forEach(k => {
    const t = tBySlot[k], d = dewBySlot[k];
    if (t != null && d != null && (t - d) < 2) hMouillage += SLOT_HRS;
  });
  let hHRsat = 0, hHR85 = 0, hTopt = 0;
  rh.forEach(s => {
    if (s.avg == null) return;
    if (s.avg > 90) hHRsat += SLOT_HRS;
    if (s.avg > 85) hHR85 += SLOT_HRS;
  });
  temp.forEach(s => { if (s.avg != null && s.avg >= 15 && s.avg <= 25) hTopt += SLOT_HRS; });
  // Index Botrytis 0-100: 40% mouillage (cap 8h), 30% T° optimale (cap 12h), 30% HR>85 (cap 12h)
  const indexBotrytis = Math.round(
    40 * Math.min(hMouillage / 8, 1) +
    30 * Math.min(hTopt / 12, 1) +
    30 * Math.min(hHR85 / 12, 1)
  );

  // ---- CO2 ----
  let hCO2sub = 0;
  let co2DaySum = 0, co2DayN = 0, co2NightSum = 0, co2NightN = 0;
  co2.forEach(s => {
    if (s.avg == null) return;
    if (isDay(s.slot)) { co2DaySum += s.avg; co2DayN++; } else { co2NightSum += s.avg; co2NightN++; }
    const parSlot = parBySlot[s.slot] || 0;
    if (parSlot > 200 && s.avg < 400) hCO2sub += SLOT_HRS;
  });
  const co2Jour = co2DayN > 0 ? co2DaySum / co2DayN : null;
  const co2Nuit = co2NightN > 0 ? co2NightSum / co2NightN : null;

  // ---- Composites ----
  const ptq = (gddJour != null && gddJour > 0 && dli > 0) ? dli / gddJour : null;
  // ETP capteur (Stanghellini simplifié, vent nul, λ=2.45 MJ/kg):
  // ETP_mm/j ≈ (0.288 × RADUM + 0.288 × VPD_jour) / 2.45
  const etpCapteur = (radum > 0 && vpdJour != null)
    ? (0.288 * radum + 0.288 * vpdJour) / 2.45
    : null;

  const r2 = v => v == null ? null : Math.round(v * 100) / 100;
  const r1 = v => v == null ? null : Math.round(v * 10) / 10;
  const r0 = v => v == null ? null : Math.round(v);
  return {
    dli: r2(dli), radum: r2(radum), hPARutile: r1(hPARutile), hPARsat: r1(hPARsat),
    dif: r1(dif), tDay: r1(tDay), tNight: r1(tNight),
    hStressChaud: r1(hStressChaud), hStressFroid: r1(hStressFroid), hChill: r1(hChill), ampl24: r1(ampl24),
    vpdJour: r2(vpdJour), vpdNuit: r2(vpdNuit), hStressVPDHaut: r1(hStressVPDHaut), hStressVPDBas: r1(hStressVPDBas),
    hMouillage: r1(hMouillage), hHRsat: r1(hHRsat), indexBotrytis,
    hCO2sub: r1(hCO2sub), co2Jour: r0(co2Jour), co2Nuit: r0(co2Nuit),
    ptq: r2(ptq), etpCapteur: r2(etpCapteur),
    gddJour: r2(gddJour),
  };
}

async function refreshFarmroadCache(dateParam, farmIdFilter) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const isPastDay = dateParam < todayStr;

  // Helper: load daily GDD (same value for all devices since 1 GDD/day for the farm)
  const fetchGddJour = async () => {
    try {
      const gddDoc = await db_firestore.collection("gdd_tracking").doc(dateParam).get();
      return gddDoc.exists ? (gddDoc.data().gdd_jour || null) : null;
    } catch (e) { return null; }
  };

  // 1) Check Firestore cache
  const cacheRef = db_firestore.collection("farmroad_cache").doc(dateParam);
  const cached = await cacheRef.get();
  if (cached.exists) {
    const cData = cached.data();
    const cacheAge = Date.now() - (cData._cachedAt || 0);
    if (isPastDay || cacheAge < FARMROAD_CACHE_TTL_MS) {
      console.log("FarmRoad cache hit for " + dateParam + (isPastDay ? " (past)" : " (today, age " + Math.round(cacheAge / 1000) + "s)"));
      // Backfill KPIs on legacy cache entries (computed on-the-fly, not persisted)
      let cachedDevices = cData.devices || [];
      const needsKpiBackfill = cachedDevices.some(d => !d.kpis);
      if (needsKpiBackfill) {
        const gddJour = await fetchGddJour();
        cachedDevices = cachedDevices.map(d => d.kpis ? d : Object.assign({}, d, { kpis: computeFarmroadKPIs(d.timeseries, gddJour) }));
      }
      return { success: true, farms: cData.farms, devices: cachedDevices, date: dateParam, lastUpdate: cData.lastUpdate, totalMeasurements: cData.totalMeasurements, cached: true };
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

  // 6) Format devices (with KPIs)
  const gddJour = await fetchGddJour();
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
    const kpis = computeFarmroadKPIs(tsObj, gddJour);
    return { deviceId: devId, compartmentId: meta.compartment_id, sectorId: meta.sector_id, farmId: meta.farm_id, hasSubstrate, measurements: measObj, timeseries: tsObj, kpis };
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
// INDOOR FORECAST — Prévisions météo intérieure
// Modèle ML: outdoor → indoor avec calibration auto
// =============================================

const METEOBLUE_API_KEY = "sWtaJy9XrwE6TAcB";
const FORECAST_FARM = { lat: 35.08, lon: -6.14, asl: 49 };

// Fetch MeteoBlue 7-day forecast (daily + hourly)
async function fetchMeteoblueForecast() {
  const https = require("https");
  const url = `https://my.meteoblue.com/packages/basic-day_agro-day_basic-1h?apikey=${METEOBLUE_API_KEY}&lat=${FORECAST_FARM.lat}&lon=${FORECAST_FARM.lon}&asl=${FORECAST_FARM.asl}&format=json`;
  return new Promise((resolve) => {
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (c) => { data += c; });
      resp.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on("error", () => resolve(null));
  });
}

// Default indoor transfer coefficients (will be learned)
const DEFAULT_MODEL = {
  canarienne: {
    temp_offset: 5.0,    // T_indoor = T_outdoor + offset
    temp_scale: 0.85,    // T_indoor_range = T_outdoor_range * scale
    hr_offset: 15,       // HR_indoor = HR_outdoor + offset (more humid inside)
    hr_cap: 99,
    co2_base: 2200,      // Base CO2 (ppm) — canarienne has higher CO2
    co2_temp_factor: 30, // CO2 increases with temperature
    par_transmittance: 0.65, // PAR inside = PAR outside * transmittance
    vpd_scale: 0.7,      // VPD dampened inside
    radiation_transmittance: 0.60, // Radiation indoor = outdoor * transmittance
    substrate_base: 55,       // Base substrate moisture %
    substrate_temp_factor: -0.3, // Substrate drops as temp rises
    pressure_offset: 0.0,    // Pressure indoor ≈ outdoor
  },
  tunnel: {
    temp_offset: 4.0,
    temp_scale: 0.9,
    hr_offset: 12,
    hr_cap: 99,
    co2_base: 1200,
    co2_temp_factor: 15,
    par_transmittance: 0.55,
    vpd_scale: 0.75,
    radiation_transmittance: 0.50,
    substrate_base: 58,
    substrate_temp_factor: -0.25,
    pressure_offset: 0.0,
  }
};

// Calculate VPD from temperature and humidity
function calcVPD(temp, hr) {
  const esat = 0.6108 * Math.exp((17.27 * temp) / (temp + 237.3));
  return Math.max(0, esat * (1 - hr / 100));
}

// Calculate dew point from temperature and humidity (Magnus formula)
function calcDewpoint(temp, hr) {
  if (hr <= 0) return temp - 20;
  const gamma = (17.27 * temp) / (237.3 + temp) + Math.log(hr / 100);
  return Math.round((237.3 * gamma) / (17.27 - gamma) * 10) / 10;
}

// Predict indoor conditions from outdoor forecast (daily)
function predictIndoor(outdoor, model) {
  const tAvgOut = (outdoor.tmax + outdoor.tmin) / 2;
  const tRangeOut = outdoor.tmax - outdoor.tmin;

  const tAvgIn = tAvgOut + model.temp_offset;
  const tRangeIn = tRangeOut * model.temp_scale;
  const tMax = Math.round((tAvgIn + tRangeIn / 2) * 10) / 10;
  const tMin = Math.round((tAvgIn - tRangeIn / 2) * 10) / 10;

  const hr = Math.min(model.hr_cap || 99, Math.round(outdoor.humidity + model.hr_offset));
  const co2 = Math.round(model.co2_base + model.co2_temp_factor * (tAvgIn - 20));
  const par = outdoor.radiation ? Math.round(outdoor.radiation * model.par_transmittance * 10) / 10 : null;
  const vpd = Math.round(calcVPD((tMax + tMin) / 2, hr) * model.vpd_scale * 100) / 100;
  const radiation = outdoor.radiation != null ? Math.round(outdoor.radiation * (model.radiation_transmittance || 0.6) * 10) / 10 : null;
  const substrate = Math.round(((model.substrate_base || 55) + (model.substrate_temp_factor || -0.3) * (tAvgIn - 20)) * 10) / 10;
  const dewpoint = calcDewpoint(tAvgIn, hr);
  const pressure = outdoor.pressure != null ? Math.round((outdoor.pressure + (model.pressure_offset || 0)) * 10) / 10 : null;

  return { tMax, tMin, tAvg: Math.round(tAvgIn * 10) / 10, hr, co2, par, vpd, radiation, substrate, dewpoint, pressure };
}

// Predict indoor conditions from outdoor forecast (hourly — single hour)
function predictIndoorHourly(hourOutdoor, model) {
  const tOut = hourOutdoor.temperature;
  const tempIndoor = Math.round((tOut + model.temp_offset) * 10) / 10;
  const hrIndoor = Math.min(model.hr_cap || 99, Math.round((hourOutdoor.relativehumidity || 70) + model.hr_offset));
  const co2 = Math.round(model.co2_base + model.co2_temp_factor * (tempIndoor - 20));
  const swRad = hourOutdoor.shortwave_radiation || 0;
  const par = Math.round(swRad * model.par_transmittance * 4.57 * 0.001 * 100) / 100; // W/m² → µmol/m²/s approx
  const radiation = Math.round(swRad * (model.radiation_transmittance || 0.6) * 10) / 10;
  const vpd = Math.round(calcVPD(tempIndoor, hrIndoor) * model.vpd_scale * 100) / 100;
  const dewpoint = calcDewpoint(tempIndoor, hrIndoor);
  const substrate = Math.round(((model.substrate_base || 55) + (model.substrate_temp_factor || -0.3) * (tempIndoor - 20)) * 10) / 10;
  const pressure = hourOutdoor.sealevelpressure != null ? Math.round((hourOutdoor.sealevelpressure + (model.pressure_offset || 0)) * 10) / 10 : null;

  return { time: hourOutdoor.time, temp: tempIndoor, hr: hrIndoor, co2, par, radiation, vpd, dewpoint, substrate, pressure };
}

// Update model coefficients using EMA (exponential moving average)
function updateModelCoeffs(currentModel, predicted, actual, alpha) {
  const a = alpha || 0.15; // learning rate
  const updated = { ...currentModel };

  // Learn temp_offset from actual vs outdoor
  if (actual.tMax != null && predicted._outdoorTmax != null) {
    const actualOffset = ((actual.tMax + actual.tMin) / 2) - ((predicted._outdoorTmax + predicted._outdoorTmin) / 2);
    updated.temp_offset = Math.round((currentModel.temp_offset * (1 - a) + actualOffset * a) * 100) / 100;
  }

  // Learn HR offset
  if (actual.hr != null && predicted._outdoorHr != null) {
    const actualHrOffset = actual.hr - predicted._outdoorHr;
    updated.hr_offset = Math.round((currentModel.hr_offset * (1 - a) + actualHrOffset * a) * 100) / 100;
  }

  // Learn temp_scale from range ratio
  if (actual.tMax != null && actual.tMin != null && predicted._outdoorTmax != null) {
    const actualRange = actual.tMax - actual.tMin;
    const outdoorRange = predicted._outdoorTmax - predicted._outdoorTmin;
    if (outdoorRange > 2) {
      const actualScale = actualRange / outdoorRange;
      updated.temp_scale = Math.round((currentModel.temp_scale * (1 - a) + actualScale * a) * 100) / 100;
      updated.temp_scale = Math.max(0.3, Math.min(1.5, updated.temp_scale));
    }
  }

  // Learn radiation_transmittance
  if (actual.radiation != null && predicted._outdoorRadiation != null && predicted._outdoorRadiation > 0) {
    const actualRadTrans = actual.radiation / predicted._outdoorRadiation;
    updated.radiation_transmittance = Math.round((currentModel.radiation_transmittance * (1 - a) + actualRadTrans * a) * 100) / 100;
    updated.radiation_transmittance = Math.max(0.1, Math.min(0.95, updated.radiation_transmittance));
  }

  // Learn substrate_base from actual substrate
  if (actual.substrat != null) {
    const actualBase = actual.substrat - (currentModel.substrate_temp_factor || -0.3) * (((actual.tMax || 25) + (actual.tMin || 15)) / 2 - 20);
    updated.substrate_base = Math.round((currentModel.substrate_base * (1 - a) + actualBase * a) * 100) / 100;
    updated.substrate_base = Math.max(20, Math.min(95, updated.substrate_base));
  }

  // Learn pressure_offset
  if (actual.pressure != null && predicted._outdoorPressure != null) {
    const actualPressOffset = actual.pressure - predicted._outdoorPressure;
    updated.pressure_offset = Math.round(((currentModel.pressure_offset || 0) * (1 - a) + actualPressOffset * a) * 100) / 100;
  }

  return updated;
}

// Compute accuracy metrics
function computeAccuracy(predicted, actual) {
  const errors = {};
  const addError = (key, pVal, aVal) => {
    if (pVal == null || aVal == null) return;
    errors[key + '_error'] = Math.round((pVal - aVal) * 10) / 10;
    errors[key + '_pct'] = aVal !== 0 ? Math.round(Math.abs(errors[key + '_error'] / aVal) * 1000) / 10 : 0;
  };
  addError('tMax', predicted.tMax, actual.tMax);
  addError('tMin', predicted.tMin, actual.tMin);
  addError('hr', predicted.hr, actual.hr);
  addError('co2', predicted.co2, actual.co2);
  addError('vpd', predicted.vpd, actual.vpd);
  addError('par', predicted.par, actual.par);
  addError('radiation', predicted.radiation, actual.radiation);
  addError('substrate', predicted.substrate, actual.substrat);
  addError('dewpoint', predicted.dewpoint, actual.dewpoint);
  addError('pressure', predicted.pressure, actual.pressure);
  // MAPE global (core params only: tMax, tMin, hr — same as before for consistency)
  const pcts = [errors.tMax_pct, errors.tMin_pct, errors.hr_pct].filter(v => v != null);
  errors.mape = pcts.length > 0 ? Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length * 10) / 10 : null;
  return errors;
}

// Main scheduled function: runs daily at 21:00
exports.indoorForecastRefresh = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .pubsub.schedule("0 21 * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    console.log("[IndoorForecast] Daily refresh for " + todayStr);

    try {
      // 1) Fetch MeteoBlue forecast
      const meteoRaw = await fetchMeteoblueForecast();
      if (!meteoRaw || !meteoRaw.data_day) {
        console.error("[IndoorForecast] MeteoBlue fetch failed");
        return null;
      }

      // 2) Store raw MeteoBlue forecast
      const dayData = meteoRaw.data_day;
      const forecastDays = (dayData.time || []).map((dateStr, i) => ({
        date: dateStr,
        tmax: dayData.temperature_max ? dayData.temperature_max[i] : null,
        tmin: dayData.temperature_min ? dayData.temperature_min[i] : null,
        humidity: dayData.relativehumidity_mean ? dayData.relativehumidity_mean[i] : null,
        vent: dayData.windspeed_max ? dayData.windspeed_max[i] : null,
        precip: dayData.precipitation ? dayData.precipitation[i] : null,
        eto: dayData.evapotranspiration ? dayData.evapotranspiration[i] : null,
        radiation: dayData.shortwave_radiation_sum ? dayData.shortwave_radiation_sum[i] : null,
        uv: dayData.uvindex ? dayData.uvindex[i] : null,
      }));

      // Parse hourly data (data_1h)
      const hourlyRaw = meteoRaw.data_1h || {};
      const hourlyTimes = hourlyRaw.time || [];
      const hourlyData = hourlyTimes.map((t, i) => ({
        time: t,
        date: t ? t.slice(0, 10) : null,
        temperature: hourlyRaw.temperature ? hourlyRaw.temperature[i] : null,
        relativehumidity: hourlyRaw.relativehumidity ? hourlyRaw.relativehumidity[i] : null,
        windspeed: hourlyRaw.windspeed ? hourlyRaw.windspeed[i] : null,
        shortwave_radiation: hourlyRaw.shortwave_radiation ? hourlyRaw.shortwave_radiation[i] : null,
        sealevelpressure: hourlyRaw.sealevelpressure ? hourlyRaw.sealevelpressure[i] : null,
      }));
      // Group hourly data by date
      const hourlyByDate = {};
      for (const h of hourlyData) {
        if (!h.date) continue;
        if (!hourlyByDate[h.date]) hourlyByDate[h.date] = [];
        hourlyByDate[h.date].push(h);
      }

      // Store in meteo_history
      await db_firestore.collection("meteo_history").doc(todayStr).set({
        fetchedAt: todayStr,
        forecast: forecastDays,
        hourlyForecast: hourlyData,
        _cachedAt: Date.now()
      });

      // 3) Get today's actual FarmRoad data for calibration
      const farmroadData = await refreshFarmroadCache(todayStr, null);
      const devices = (farmroadData && farmroadData.devices) || [];

      // Identify Canarienne / Tunnel via explicit deviceId mapping
      const { FARMROAD_DEVICE_BY_GH_TYPE } = require('./lib/irrigation/parcelleMeta');
      const byDeviceId = Object.fromEntries(
        devices.map(d => [String(d.deviceId || d.id || ''), d])
      );
      console.log('farmroadRefresh: devices found =', Object.keys(byDeviceId), 'expected =', JSON.stringify(FARMROAD_DEVICE_BY_GH_TYPE));

      // Helper: extract device actuals (daily + hourly)
      const extractActual = (d) => {
        const m = d.measurements || {};
        const ts = d.timeseries || {};
        const daily = {
          tMax: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.max : null,
          tMin: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.min : null,
          tAvg: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.avg : null,
          hr: m.RH_INSIDE ? m.RH_INSIDE.avg : null,
          co2: m.CO2_LEVEL ? m.CO2_LEVEL.avg : null,
          vpd: m.ESTIMATED_VPD_INSIDE ? m.ESTIMATED_VPD_INSIDE.avg : null,
          substrat: m.SUBSTRATE_MOISTURE_CONTENT ? m.SUBSTRATE_MOISTURE_CONTENT.avg : null,
          par: m.PAR_INTENSITY ? m.PAR_INTENSITY.avg : null,
          radiation: m.RADIATION_INTENSITY_INSIDE ? m.RADIATION_INTENSITY_INSIDE.avg : null,
          dewpoint: m.DEWPOINT_INSIDE ? m.DEWPOINT_INSIDE.avg : null,
          pressure: m.BAROMETRIC_PRESSURE_INSIDE ? m.BAROMETRIC_PRESSURE_INSIDE.avg : null,
        };
        // Aggregate 15-min timeseries → hourly
        const hourly = [];
        const hourBuckets = {};
        const params = ['TEMPERATURE_INSIDE', 'RH_INSIDE', 'CO2_LEVEL', 'PAR_INTENSITY', 'RADIATION_INTENSITY_INSIDE', 'ESTIMATED_VPD_INSIDE', 'DEWPOINT_INSIDE', 'SUBSTRATE_MOISTURE_CONTENT', 'BAROMETRIC_PRESSURE_INSIDE'];
        for (const p of params) {
          if (!ts[p]) continue;
          for (const slot of ts[p]) {
            const hh = slot.hour ? slot.hour.slice(0, 2) : null;
            if (hh == null) continue;
            if (!hourBuckets[hh]) hourBuckets[hh] = {};
            if (!hourBuckets[hh][p]) hourBuckets[hh][p] = [];
            hourBuckets[hh][p].push(slot.avg);
          }
        }
        const paramMap = { TEMPERATURE_INSIDE: 'temp', RH_INSIDE: 'hr', CO2_LEVEL: 'co2', PAR_INTENSITY: 'par', RADIATION_INTENSITY_INSIDE: 'radiation', ESTIMATED_VPD_INSIDE: 'vpd', DEWPOINT_INSIDE: 'dewpoint', SUBSTRATE_MOISTURE_CONTENT: 'substrate', BAROMETRIC_PRESSURE_INSIDE: 'pressure' };
        for (const hh of Object.keys(hourBuckets).sort()) {
          const entry = { hour: hh + ':00' };
          for (const [frKey, outKey] of Object.entries(paramMap)) {
            const vals = hourBuckets[hh][frKey];
            if (vals && vals.length > 0) entry[outKey] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100) / 100;
          }
          hourly.push(entry);
        }
        return { ...daily, hourly };
      };

      const actualByType = {};
      for (const [ghType, deviceId] of Object.entries(FARMROAD_DEVICE_BY_GH_TYPE)) {
        const d = byDeviceId[String(deviceId)];
        if (d) actualByType[ghType] = extractActual(d);
      }

      // Store FarmRoad actual in history
      await db_firestore.collection("farmroad_history").doc(todayStr).set({
        date: todayStr,
        canarienne: actualByType.canarienne || null,
        tunnel: actualByType.tunnel || null,
        _cachedAt: Date.now()
      });

      // 4) Load current model coefficients
      const modelDoc = await db_firestore.collection("forecast_model").doc("current").get();
      let model = modelDoc.exists ? modelDoc.data() : { canarienne: { ...DEFAULT_MODEL.canarienne }, tunnel: { ...DEFAULT_MODEL.tunnel }, version: 0 };

      // 5) Calibrate: compare yesterday's prediction (if exists) with today's actuals
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const yesterdayForecastDoc = await db_firestore.collection("indoor_forecasts").doc(yesterdayStr).get();
      const yesterdayActualDoc = await db_firestore.collection("farmroad_history").doc(yesterdayStr).get();

      let accuracyData = {};
      if (yesterdayForecastDoc.exists && yesterdayActualDoc.exists) {
        const yForecast = yesterdayForecastDoc.data();
        const yActual = yesterdayActualDoc.data();

        // Find yesterday's J+1 prediction (which was for today — but we check yesterday's own prediction)
        // Actually we want to compare: the prediction that was made FOR yesterday with yesterday's actual
        for (const type of ["canarienne", "tunnel"]) {
          if (yForecast[type] && yActual[type]) {
            // Find the prediction entry for yesterday's date
            const predForYesterday = (yForecast[type] || []).find(p => p.date === yesterdayStr);
            if (predForYesterday && yActual[type]) {
              const acc = computeAccuracy(predForYesterday, yActual[type]);
              accuracyData[type] = acc;

              // Update model with learned corrections
              const predWithOutdoor = { ...predForYesterday };
              // Find outdoor data for yesterday
              const yMeteo = await db_firestore.collection("meteo_history").doc(yesterdayStr).get();
              if (yMeteo.exists) {
                const yFc = (yMeteo.data().forecast || []).find(f => f.date === yesterdayStr);
                if (yFc) {
                  predWithOutdoor._outdoorTmax = yFc.tmax;
                  predWithOutdoor._outdoorTmin = yFc.tmin;
                  predWithOutdoor._outdoorHr = yFc.humidity;
                  predWithOutdoor._outdoorRadiation = yFc.radiation;
                  // Compute avg outdoor pressure from hourly data
                  const yHourly = yMeteo.data().hourlyForecast || [];
                  const yDayHours = yHourly.filter(h => h.date === yesterdayStr && h.sealevelpressure != null);
                  if (yDayHours.length > 0) {
                    predWithOutdoor._outdoorPressure = Math.round(yDayHours.reduce((s, h) => s + h.sealevelpressure, 0) / yDayHours.length * 10) / 10;
                  }
                }
              }
              model[type] = updateModelCoeffs(model[type], predWithOutdoor, yActual[type], 0.15);
            }
          }
        }
      }

      // Save accuracy
      if (Object.keys(accuracyData).length > 0) {
        await db_firestore.collection("forecast_accuracy").doc(yesterdayStr).set({
          date: yesterdayStr,
          ...accuracyData,
          _cachedAt: Date.now()
        });
      }

      // 6) Generate indoor forecasts for J+1 to J+5
      const todayOutdoor = forecastDays.find(f => f.date === todayStr);
      const futureDays = forecastDays.filter(f => f.date > todayStr).slice(0, 5);

      const predictions = { canarienne: [], tunnel: [] };

      // Also predict for today (for display)
      const allDaysToPredict = todayOutdoor ? [todayOutdoor, ...futureDays] : futureDays;

      for (const day of allDaysToPredict) {
        for (const type of ["canarienne", "tunnel"]) {
          const pred = predictIndoor(day, model[type]);
          // Generate hourly predictions for this day
          const dayHourly = (hourlyByDate[day.date] || []).map(h => predictIndoorHourly(h, model[type]));
          predictions[type].push({
            date: day.date,
            ...pred,
            hourly: dayHourly,
            outdoor: { tmax: day.tmax, tmin: day.tmin, humidity: day.humidity, eto: day.eto, precip: day.precip, radiation: day.radiation }
          });
        }
      }

      // 7) Save indoor forecast
      await db_firestore.collection("indoor_forecasts").doc(todayStr).set({
        date: todayStr,
        canarienne: predictions.canarienne,
        tunnel: predictions.tunnel,
        model: { canarienne: model.canarienne, tunnel: model.tunnel },
        _cachedAt: Date.now()
      });

      // 8) Save updated model
      model.version = (model.version || 0) + 1;
      model.lastUpdated = todayStr;
      await db_firestore.collection("forecast_model").doc("current").set(model);

      console.log("[IndoorForecast] Done. Model v" + model.version + ". Predictions for " + predictions.canarienne.length + " days.");
    } catch (err) {
      console.error("[IndoorForecast] Error:", err);
    }
    return null;
  });

// HTTP endpoint for indoor forecast
exports.indoorForecast = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const wantHourly = req.query.hourly === 'true';
      console.log("[IndoorForecast] API call — todayStr=" + todayStr + " wantHourly=" + wantHourly);

      // Get latest forecast
      const forecastDoc = await db_firestore.collection("indoor_forecasts").doc(todayStr).get();
      let forecast = forecastDoc.exists ? forecastDoc.data() : null;
      console.log("[IndoorForecast] Doc exists=" + forecastDoc.exists + (forecast ? " canarienne.length=" + (forecast.canarienne || []).length + " firstHourly=" + ((forecast.canarienne && forecast.canarienne[0] && forecast.canarienne[0].hourly) ? forecast.canarienne[0].hourly.length : "none") : ""));

      // Check if hourly data is missing but requested — need to regenerate
      const needsHourly = wantHourly && forecast && Array.isArray(forecast.canarienne) && forecast.canarienne.length > 0 && !forecast.canarienne[0].hourly;
      if (needsHourly) { console.log("[IndoorForecast] needsHourly=true, forcing regeneration"); forecast = null; }

      // If no forecast for today, generate on-the-fly
      if (!forecast) {
        console.log("[IndoorForecast] Generating on-the-fly...");
        const meteoRaw = await fetchMeteoblueForecast();
        console.log("[IndoorForecast] MeteoBlue: data_day=" + !!(meteoRaw && meteoRaw.data_day) + " data_1h_times=" + ((meteoRaw && meteoRaw.data_1h && meteoRaw.data_1h.time) ? meteoRaw.data_1h.time.length : 0));
        if (meteoRaw && meteoRaw.data_day) {
          const dayData = meteoRaw.data_day;
          const forecastDays = (dayData.time || []).map((dateStr, i) => ({
            date: dateStr,
            tmax: dayData.temperature_max ? dayData.temperature_max[i] : null,
            tmin: dayData.temperature_min ? dayData.temperature_min[i] : null,
            humidity: dayData.relativehumidity_mean ? dayData.relativehumidity_mean[i] : null,
            eto: dayData.evapotranspiration ? dayData.evapotranspiration[i] : null,
            precip: dayData.precipitation ? dayData.precipitation[i] : null,
            radiation: dayData.shortwave_radiation_sum ? dayData.shortwave_radiation_sum[i] : null,
          }));
          // Parse hourly for on-the-fly
          const hRaw = meteoRaw.data_1h || {};
          const hTimes = hRaw.time || [];
          const hData = hTimes.map((t, i) => ({
            time: t, date: t ? t.slice(0, 10) : null,
            temperature: hRaw.temperature ? hRaw.temperature[i] : null,
            relativehumidity: hRaw.relativehumidity ? hRaw.relativehumidity[i] : null,
            shortwave_radiation: hRaw.shortwave_radiation ? hRaw.shortwave_radiation[i] : null,
            sealevelpressure: hRaw.sealevelpressure ? hRaw.sealevelpressure[i] : null,
          }));
          const hByDate = {};
          for (const h of hData) { if (h.date) { if (!hByDate[h.date]) hByDate[h.date] = []; hByDate[h.date].push(h); } }

          const modelDoc = await db_firestore.collection("forecast_model").doc("current").get();
          const model = modelDoc.exists ? modelDoc.data() : DEFAULT_MODEL;

          const predictions = { canarienne: [], tunnel: [] };
          for (const day of forecastDays) {
            for (const type of ["canarienne", "tunnel"]) {
              const pred = predictIndoor(day, model[type] || DEFAULT_MODEL[type]);
              const dayHourly = (hByDate[day.date] || []).map(h => predictIndoorHourly(h, model[type] || DEFAULT_MODEL[type]));
              predictions[type].push({
                date: day.date, ...pred, hourly: dayHourly,
                outdoor: { tmax: day.tmax, tmin: day.tmin, humidity: day.humidity, eto: day.eto, precip: day.precip, radiation: day.radiation }
              });
            }
          }
          forecast = { date: todayStr, canarienne: predictions.canarienne, tunnel: predictions.tunnel, model: { canarienne: model.canarienne || DEFAULT_MODEL.canarienne, tunnel: model.tunnel || DEFAULT_MODEL.tunnel }, _cachedAt: Date.now(), live: true };
          console.log("[IndoorForecast] Generated: canarienne=" + predictions.canarienne.length + " dates=" + predictions.canarienne.map(p => p.date).join(",") + " hourly[0]=" + (predictions.canarienne[0] && predictions.canarienne[0].hourly ? predictions.canarienne[0].hourly.length : 0));
        } else {
          console.log("[IndoorForecast] MeteoBlue failed or no data_day");
        }
      }

      // Get accuracy history (last 14 days)
      const accSnap = await db_firestore.collection("forecast_accuracy").orderBy("date", "desc").limit(14).get();
      const accuracyHistory = [];
      accSnap.forEach(doc => accuracyHistory.push(doc.data()));

      // Get today's actual FarmRoad for comparison (extended params + optional hourly)
      const farmroadData = await refreshFarmroadCache(todayStr, null);
      const devices = (farmroadData && farmroadData.devices) || [];
      const { FARMROAD_DEVICE_BY_GH_TYPE: FR_MAP_API } = require('./lib/irrigation/parcelleMeta');
      const byDeviceIdAPI = Object.fromEntries(
        devices.map(d => [String(d.deviceId || d.id || ''), d])
      );

      const extractActualAPI = (d) => {
        const m = d.measurements || {};
        const ts = d.timeseries || {};
        const daily = {
          tMax: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.max : null,
          tMin: m.TEMPERATURE_INSIDE ? m.TEMPERATURE_INSIDE.min : null,
          hr: m.RH_INSIDE ? m.RH_INSIDE.avg : null,
          co2: m.CO2_LEVEL ? m.CO2_LEVEL.avg : null,
          vpd: m.ESTIMATED_VPD_INSIDE ? m.ESTIMATED_VPD_INSIDE.avg : null,
          par: m.PAR_INTENSITY ? m.PAR_INTENSITY.avg : null,
          radiation: m.RADIATION_INTENSITY_INSIDE ? m.RADIATION_INTENSITY_INSIDE.avg : null,
          dewpoint: m.DEWPOINT_INSIDE ? m.DEWPOINT_INSIDE.avg : null,
          substrate: m.SUBSTRATE_MOISTURE_CONTENT ? m.SUBSTRATE_MOISTURE_CONTENT.avg : null,
          pressure: m.BAROMETRIC_PRESSURE_INSIDE ? m.BAROMETRIC_PRESSURE_INSIDE.avg : null,
        };
        if (!wantHourly) return daily;
        const hourBuckets = {};
        const params = ['TEMPERATURE_INSIDE', 'RH_INSIDE', 'CO2_LEVEL', 'PAR_INTENSITY', 'RADIATION_INTENSITY_INSIDE', 'ESTIMATED_VPD_INSIDE', 'DEWPOINT_INSIDE', 'SUBSTRATE_MOISTURE_CONTENT', 'BAROMETRIC_PRESSURE_INSIDE'];
        const paramMap = { TEMPERATURE_INSIDE: 'temp', RH_INSIDE: 'hr', CO2_LEVEL: 'co2', PAR_INTENSITY: 'par', RADIATION_INTENSITY_INSIDE: 'radiation', ESTIMATED_VPD_INSIDE: 'vpd', DEWPOINT_INSIDE: 'dewpoint', SUBSTRATE_MOISTURE_CONTENT: 'substrate', BAROMETRIC_PRESSURE_INSIDE: 'pressure' };
        for (const p of params) {
          if (!ts[p]) continue;
          for (const slot of ts[p]) {
            const hh = slot.hour ? slot.hour.slice(0, 2) : null;
            if (hh == null) continue;
            if (!hourBuckets[hh]) hourBuckets[hh] = {};
            if (!hourBuckets[hh][p]) hourBuckets[hh][p] = [];
            hourBuckets[hh][p].push(slot.avg);
          }
        }
        const hourly = [];
        for (const hh of Object.keys(hourBuckets).sort()) {
          const entry = { hour: hh + ':00' };
          for (const [frKey, outKey] of Object.entries(paramMap)) {
            const vals = hourBuckets[hh][frKey];
            if (vals && vals.length > 0) entry[outKey] = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100) / 100;
          }
          hourly.push(entry);
        }
        return { ...daily, hourly };
      };

      const todayActual = {};
      for (const [ghType, deviceId] of Object.entries(FR_MAP_API)) {
        const d = byDeviceIdAPI[String(deviceId)];
        if (d) todayActual[ghType] = extractActualAPI(d);
      }

      // Strip hourly from forecast if not requested (backward compat)
      let forecastOut = forecast;
      if (!wantHourly && forecast) {
        forecastOut = { ...forecast };
        for (const type of ["canarienne", "tunnel"]) {
          if (Array.isArray(forecastOut[type])) {
            forecastOut[type] = forecastOut[type].map(p => { const { hourly, ...rest } = p; return rest; });
          }
        }
      }

      // Compute global MAPE from history
      let globalMape = null;
      const mapes = accuracyHistory.map(a => {
        const cm = a.canarienne ? a.canarienne.mape : null;
        const tm = a.tunnel ? a.tunnel.mape : null;
        return [cm, tm].filter(v => v != null);
      }).flat();
      if (mapes.length > 0) {
        globalMape = Math.round(mapes.reduce((s, v) => s + v, 0) / mapes.length * 10) / 10;
      }

      res.json({
        success: true,
        forecast: forecastOut,
        todayActual: todayActual,
        accuracyHistory: accuracyHistory,
        globalMape: globalMape,
        modelVersion: forecast ? (forecast.model ? forecast.model.version : 0) : 0
      });
    } catch (err) {
      console.error("[IndoorForecast] API error:", err);
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

// =============================================
// METEO OUTDOOR — farm coordinates for Open-Meteo
// =============================================
const METEO_FERMES = {
  F1:  { lat: 35.08, lon: -6.14 },
  F5:  { lat: 35.08, lon: -6.14 },
  F6:  { lat: 34.3425, lon: -6.5503 },
};

// Fetch outdoor weather from Open-Meteo including ETo
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
async function fetchMeteoForecast7d(lat, lon) {
  const https = require("https");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max,relative_humidity_2m_mean,et0_fao_evapotranspiration,shortwave_radiation_sum&timezone=Africa/Casablanca&forecast_days=7`;
  return new Promise((resolve) => {
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        try {
          const j = JSON.parse(data);
          if (!j.daily || !j.daily.time) return resolve([]);
          resolve(j.daily.time.map((d, i) => ({
            date: d,
            tmax: j.daily.temperature_2m_max[i],
            tmin: j.daily.temperature_2m_min[i],
            humidity: j.daily.relative_humidity_2m_mean ? j.daily.relative_humidity_2m_mean[i] : null,
            wind: j.daily.windspeed_10m_max[i],
            precip: j.daily.precipitation_sum[i],
            eto: j.daily.et0_fao_evapotranspiration ? j.daily.et0_fao_evapotranspiration[i] : null,
            radiation: j.daily.shortwave_radiation_sum ? j.daily.shortwave_radiation_sum[i] : null,
          })));
        } catch (e) { resolve([]); }
      });
    }).on("error", () => resolve([]));
  });
}

/**
 * Fetch hourly shortwave radiation + daily sunrise/sunset from Open-Meteo
 * for a date range. Single API call. Returns a map keyed by YYYY-MM-DD:
 *   { date, sunriseMin, sunsetMin, hourlyRadiation: number[24] (W/m²) }
 *
 * Used by the irrigation engine for radiation-driven recommendations and
 * dynamic late-day cutoff. `pastDays` ≤ 92, `forecastDays` ≤ 16.
 */
async function fetchHourlyRadiationByDate(lat, lon, pastDays, forecastDays) {
  const https = require("https");
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=shortwave_radiation&daily=sunrise,sunset&timezone=Africa/Casablanca` +
    `&past_days=${pastDays || 7}&forecast_days=${forecastDays || 2}`;
  return new Promise((resolve) => {
    https.get(url, (resp) => {
      let data = "";
      resp.on("data", (chunk) => { data += chunk; });
      resp.on("end", () => {
        try {
          const j = JSON.parse(data);
          const out = {};
          // Daily sunrise/sunset
          if (j.daily && Array.isArray(j.daily.time)) {
            j.daily.time.forEach((d, i) => {
              const sunriseStr = j.daily.sunrise ? j.daily.sunrise[i] : null;
              const sunsetStr = j.daily.sunset ? j.daily.sunset[i] : null;
              const parseHM = (s) => {
                if (!s || typeof s !== "string") return null;
                const m = /T(\d{2}):(\d{2})/.exec(s);
                return m ? Number(m[1]) * 60 + Number(m[2]) : null;
              };
              out[d] = {
                date: d,
                sunriseMin: parseHM(sunriseStr),
                sunsetMin: parseHM(sunsetStr),
                hourlyRadiation: new Array(24).fill(null),
              };
            });
          }
          // Hourly radiation, bucket into out[date].hourlyRadiation[hour]
          if (j.hourly && Array.isArray(j.hourly.time) && Array.isArray(j.hourly.shortwave_radiation)) {
            for (let i = 0; i < j.hourly.time.length; i++) {
              const t = j.hourly.time[i];
              const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):/.exec(t);
              if (!m) continue;
              const date = m[1];
              const hour = Number(m[2]);
              if (!out[date]) out[date] = { date, sunriseMin: null, sunsetMin: null, hourlyRadiation: new Array(24).fill(null) };
              out[date].hourlyRadiation[hour] = j.hourly.shortwave_radiation[i];
            }
          }
          resolve(out);
        } catch (e) { resolve({}); }
      });
    }).on("error", () => resolve({}));
  });
}

/**
 * Load FarmRoad indoor hourly radiation per greenhouse type for a list of dates.
 * Reads `farmroad_history/{date}.{ghType}.hourly[].radiation` (already aggregated
 * 15-min → hourly W/m² by farmroadRefresh).
 *
 * @param {string[]} dates  YYYY-MM-DD strings
 * @returns {Promise<{canarienne: Record<string, Array<number|null>>, tunnel: Record<string, Array<number|null>>}>}
 *          Each ghType maps date → 24-element hourly W/m² array (indoor).
 *          Date entry omitted if no FarmRoad data for that day/type.
 */
async function loadIndoorHourlyRadiationByGhType(dates) {
  const out = { canarienne: {}, tunnel: {} };
  if (!Array.isArray(dates) || dates.length === 0) return out;
  const snaps = await Promise.all(
    dates.map(d => db_firestore.collection('farmroad_history').doc(d).get())
  );
  snaps.forEach((snap, i) => {
    const date = dates[i];
    if (!snap.exists) return;
    const data = snap.data() || {};
    for (const ghType of ['canarienne', 'tunnel']) {
      const block = data[ghType];
      const hourly = block && Array.isArray(block.hourly) ? block.hourly : null;
      if (!hourly || hourly.length === 0) continue;
      const arr = new Array(24).fill(null);
      let hits = 0;
      for (const slot of hourly) {
        const hh = typeof slot.hour === 'string' ? parseInt(slot.hour.slice(0, 2), 10) : null;
        if (Number.isFinite(hh) && hh >= 0 && hh < 24 && Number.isFinite(slot.radiation)) {
          arr[hh] = slot.radiation;
          hits++;
        }
      }
      if (hits > 0) out[ghType][date] = arr;
    }
  });
  return out;
}

// Persist outdoor meteo for all farms for a given date
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

// Helper: local date string in Africa/Casablanca timezone
function localDateStr(date) {
  const d = date || new Date();
  // Use Intl to get Casablanca date reliably
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // returns YYYY-MM-DD
}

// Core GDD computation for a given date string
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

function pearsonCorrelation(x, y) {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += x[i]; sumY += y[i]; }
  const meanX = sumX / n, meanY = sumY / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX, dy = y[i] - meanY;
    num += dx * dy; denX += dx * dx; denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function laggedCorrelation(production, indicator, maxLag = 5) {
  let bestR = 0, bestLag = 0;
  for (let lag = 0; lag <= maxLag; lag++) {
    // production[i] correlated with indicator[i - lag]
    const prodSlice = production.slice(lag);
    const indSlice = indicator.slice(0, indicator.length - lag);
    const n = Math.min(prodSlice.length, indSlice.length);
    if (n < 5) continue;
    const r = pearsonCorrelation(prodSlice.slice(0, n), indSlice.slice(0, n));
    if (Math.abs(r) > Math.abs(bestR)) { bestR = r; bestLag = lag; }
  }
  const absR = Math.abs(bestR);
  const interpretation = absR >= 0.7 ? "Forte" : absR >= 0.4 ? "Modérée" : absR >= 0.2 ? "Faible" : "Non significative";
  return { r: Math.round(bestR * 100) / 100, lag_optimal: bestLag, interpretation };
}

// Normalise Parcelle_Culturale → nom d'affichage avec sous-variété
// (miroir simplifié de normalizeParcelle() dans app.jsx)
function normalizeVarieteSousVariete(parcelleCulturale) {
  if (!parcelleCulturale) return null;
  const u = parcelleCulturale.trim().toUpperCase();
  if (u.includes('MARAVILLA')) {
    if (u.includes('GG') || u.includes('GREEN') || /\bGC\b/.test(u)) return 'Maravilla Green Cane';
    if (u.includes('MOTTE') || u.includes('LONG') || /\bLG\b/.test(u)) return 'Maravilla Long Cane';
    if (u.includes('MOW')) return 'Maravilla Mow Down';
    return 'Maravilla';
  }
  if (u.includes('YAZMIN') || u.includes('YASMIN')) {
    if (u.includes('MOTTE') || u.includes('BI')) return 'Yazmin Bi Cycle';
    if (u.includes('MOW')) return 'Yazmin Mow Down';
    if (u.includes('CUT')) return 'Yazmin Bi Cycle';
    return 'Yazmin';
  }
  if (u.includes('REYNA') || u.includes('REINA')) return 'Reyna';
  if (u.includes('CORINA') || u.includes('CORRINA')) return 'Corina';
  if (u.includes('CASCADE')) return 'Cascade';
  if (u.includes('BREEZE')) return 'Breeze';
  if (u.includes('ADELITA')) return 'Adelita';
  return null;
}

exports.climatProduction = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    try {
      const days = Math.min(parseInt(req.query.days) || 7, 60);
      const varieteFilter = req.query.variete || null;

      // Date range
      const endDate = localDateStr();
      const startD = new Date(endDate + "T12:00:00");
      startD.setDate(startD.getDate() - days - 5); // extra 5 days for lag
      const startDate = startD.toISOString().slice(0, 10);

      // 1. Get production data
      const cueilletteRows = await getCueilletteRows(startDate, endDate);

      // Enrich each row with normalized sub-variety name
      cueilletteRows.forEach(r => {
        r._displayVariete = normalizeVarieteSousVariete(r.Parcelle_Culturale) || r.Variete || null;
      });

      // Get available varieties (with sub-varieties)
      const varietesSet = new Set();
      cueilletteRows.forEach(r => { if (r._displayVariete) varietesSet.add(r._displayVariete); });
      const varietesDisponibles = Array.from(varietesSet).sort();

      // Aggregate production by date and variety
      const prodByDate = {};
      cueilletteRows.forEach(r => {
        if (varieteFilter && r._displayVariete !== varieteFilter) return;
        if (!prodByDate[r.DateStr]) prodByDate[r.DateStr] = 0;
        prodByDate[r.DateStr] += r.Poids_total_kg || 0;
      });

      // 2. Get serre data for each date
      const allDates = [];
      const d = new Date(startDate + "T12:00:00");
      const endD = new Date(endDate + "T12:00:00");
      while (d <= endD) {
        allDates.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }

      // Batch read serre_data
      const serreRefs = allDates.map(ds => db_firestore.collection("farms").doc("larache").collection("serre_data").doc(ds));
      const serreDocs = [];
      // Read in chunks of 10
      for (let i = 0; i < serreRefs.length; i += 10) {
        const chunk = serreRefs.slice(i, i + 10);
        const snaps = await Promise.all(chunk.map(ref => ref.get()));
        serreDocs.push(...snaps);
      }

      const serreByDate = {};
      serreDocs.forEach(snap => {
        if (snap.exists) {
          const data = snap.data();
          serreByDate[data.date || snap.id] = data;
        }
      });

      // 2b. Fallback: batch read gdd_tracking for dates missing from serre_data
      const gddRefs = allDates.map(ds => db_firestore.collection("gdd_tracking").doc(ds));
      const gddDocs = [];
      for (let i = 0; i < gddRefs.length; i += 10) {
        const chunk = gddRefs.slice(i, i + 10);
        const snaps = await Promise.all(chunk.map(ref => ref.get()));
        gddDocs.push(...snaps);
      }
      const gddByDate = {};
      gddDocs.forEach(snap => {
        if (snap.exists) gddByDate[snap.id] = snap.data();
      });

      // 3. Build daily data array (serre_data preferred, gdd_tracking as fallback)
      // Also walk gdd_tracking in date order to obtain a running cumulative GDD when not stored.
      const dailyData = [];
      let runningGddCumule = 0;
      let lastStoredCumule = null;
      for (const date of allDates) {
        const serre = serreByDate[date];
        const gdd = gddByDate[date];
        const prodKg = prodByDate[date] || 0;
        const tmax = serre ? serre.T_max_serre : (gdd ? gdd.tmax : null);
        const tmin = serre ? serre.T_min_serre : (gdd ? gdd.tmin : null);
        const hr = serre ? serre.HR_moyenne : (gdd ? gdd.hr_moyenne : null);
        const dli = serre ? serre.PAR_sum : (gdd ? gdd.dli : null);

        const dailyGdd = tmax != null && tmin != null ? calcGDD(tmax, tmin) : null;
        // Prefer stored cumulative; otherwise accumulate from previous stored value.
        let gddCumule = null;
        if (gdd && typeof gdd.gdd_cumule === "number") {
          gddCumule = gdd.gdd_cumule;
          lastStoredCumule = gddCumule;
          runningGddCumule = gddCumule;
        } else if (dailyGdd != null) {
          if (lastStoredCumule != null) runningGddCumule = runningGddCumule + dailyGdd;
          else runningGddCumule = runningGddCumule + dailyGdd;
          gddCumule = runningGddCumule;
        }

        // IMC: prefer stored; else compute on the fly when we have all inputs.
        let imcPourcentage = null;
        let alerte = null;
        if (gdd && typeof gdd.imc_pourcentage === "number") {
          imcPourcentage = gdd.imc_pourcentage;
          alerte = gdd.alerte || null;
        } else if (gddCumule != null && tmax != null && tmin != null && hr != null && dli != null) {
          const imcRes = calcIMC({ gddCumule, tmax, tmin, hr, dli });
          imcPourcentage = imcRes.pourcentage;
          alerte = imcRes.alerte;
        }

        dailyData.push({
          date,
          production_kg: Math.round(prodKg * 10) / 10,
          tmax: tmax != null ? Math.round(tmax * 10) / 10 : null,
          tmin: tmin != null ? Math.round(tmin * 10) / 10 : null,
          delta_t: tmax != null && tmin != null ? Math.round((tmax - tmin) * 10) / 10 : null,
          gdd: dailyGdd != null ? Math.round(dailyGdd * 10) / 10 : null,
          gdd_cumule: gddCumule != null ? Math.round(gddCumule * 10) / 10 : null,
          imc: imcPourcentage,
          alerte,
          vpd: tmax != null && tmin != null && hr != null ? Math.round(calcVPDFromTH((tmax + tmin) / 2, hr) * 100) / 100 : null,
          dli: dli != null ? Math.round(dli * 10) / 10 : null,
          hr: hr != null ? Math.round(hr) : null,
        });
      }

      // 4. Tendance récente — uniquement les jours actifs de récolte (>0 kg).
      // L'objectif opérationnel : prédire les kg de demain pour dimensionner l'équipe.
      // On exclut explicitement les jours sans récolte (pré-saison) qui pollueraient la baseline.
      const activeDays = dailyData.filter(d => d.production_kg > 0);
      const recentActive = activeDays.slice(-5);
      const ma3Prod = recentActive.length >= 2
        ? recentActive.slice(-3).reduce((s, d) => s + d.production_kg, 0) / Math.min(3, recentActive.length)
        : null;

      // Tendance IMC : pente sur les 3 derniers jours actifs (pts par jour).
      let imcSlope = 0;
      const imcRecent = recentActive.filter(d => d.imc != null).slice(-3);
      if (imcRecent.length >= 2) {
        imcSlope = (imcRecent[imcRecent.length - 1].imc - imcRecent[0].imc) / (imcRecent.length - 1);
      }
      // Tendance production : pente sur les 3 derniers jours actifs (kg par jour).
      let prodSlope = 0;
      if (recentActive.length >= 2) {
        const tail = recentActive.slice(-3);
        prodSlope = (tail[tail.length - 1].production_kg - tail[0].production_kg) / (tail.length - 1);
      }

      // lastDay = dernière entrée avec IMC populé (le doc gdd_tracking du jour
      // n'est écrit qu'à 23h00, donc l'entrée pour "aujourd'hui" peut être nulle).
      let lastDay = null;
      for (let li = dailyData.length - 1; li >= 0; li--) {
        if (dailyData[li].imc != null && dailyData[li].gdd_cumule != null) { lastDay = dailyData[li]; break; }
      }
      if (!lastDay) lastDay = dailyData[dailyData.length - 1];
      const todayImc = lastDay && lastDay.imc != null ? lastDay.imc : null;
      const todayAlerte = lastDay ? lastDay.alerte : null;

      // 6. Forecast demain via indoor_forecasts (météo intérieure prédite)
      // NB: les docs sont stockés sous la date UTC alors qu'ici endDate est en heure locale
      // → on récupère le doc le plus récent au lieu de deviner la clé.
      let forecastTomorrow = null;
      let imcTomorrow = null;
      let tomorrowFcMeta = null;
      try {
        const fcSnap = await db_firestore.collection("indoor_forecasts").orderBy("date", "desc").limit(1).get();
        if (!fcSnap.empty) {
          const fc = fcSnap.docs[0].data();
          const tomorrowDate = new Date(endDate + "T12:00:00");
          tomorrowDate.setDate(tomorrowDate.getDate() + 1);
          const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);
          const tunnelDays = fc.tunnel || [];
          let tomorrowFc = tunnelDays.find(d => d.date === tomorrowStr);
          if (!tomorrowFc) tomorrowFc = tunnelDays.find(d => d.date > endDate);
          const todayCum = lastDay && lastDay.gdd_cumule != null ? lastDay.gdd_cumule : null;
          if (tomorrowFc && tomorrowFc.tMax != null && tomorrowFc.tMin != null && todayCum != null) {
            const gddCumTomorrow = todayCum + calcGDD(tomorrowFc.tMax, tomorrowFc.tMin);
            const dliTomorrow = tomorrowFc.par != null ? tomorrowFc.par : (tomorrowFc.radiation != null ? tomorrowFc.radiation : null);
            const hrTomorrow = tomorrowFc.hr != null ? tomorrowFc.hr : 70;
            const imcRes = calcIMC({
              gddCumule: gddCumTomorrow,
              tmax: tomorrowFc.tMax,
              tmin: tomorrowFc.tMin,
              hr: hrTomorrow,
              dli: dliTomorrow != null ? dliTomorrow : 18,
            });
            imcTomorrow = imcRes;
            tomorrowFcMeta = {
              date: tomorrowFc.date,
              tmax: tomorrowFc.tMax,
              tmin: tomorrowFc.tMin,
              hr: hrTomorrow,
              dli: dliTomorrow,
              gdd_cumule: Math.round(gddCumTomorrow * 10) / 10,
            };
          }
        }
      } catch (fcErr) {
        console.warn("Climat-Production forecast tomorrow failed:", fcErr.message);
      }

      // 6. Prédiction opérationnelle — pilotée par maturité, ancrée sur jours actifs uniquement.
      // Logique :
      //   baseline = MA3 des derniers jours actifs (>0 kg)
      //   facteur tendance prod : extrapolation linéaire de la pente (amortie)
      //   facteur maturité : zone IMC + variation IMC aujourd'hui→demain
      //   prédiction = baseline × facteur_tendance × facteur_maturité (borné [0.6, 1.5])
      let prediction = null;
      let teamRecommendation = null;
      if (ma3Prod) {
        // Facteur tendance prod (extrapolation de la pente sur 1 jour, amortie 50%)
        const trendFactor = ma3Prod > 0 ? 1 + (prodSlope / ma3Prod) * 0.5 : 1;

        // Facteur maturité : combine zone IMC (niveau) + variation IMC aujourd'hui→demain
        const imcRef = imcTomorrow ? imcTomorrow.pourcentage : todayImc;
        let zoneFactor = 1;
        if (imcRef != null) {
          if (imcRef >= 85) zoneFactor = 1.15;       // RECOLTE_IMMINENTE → pic
          else if (imcRef >= 70) zoneFactor = 1.05;  // SURVEILLER_J3 → ramp-up
          else if (imcRef >= 50) zoneFactor = 0.95;  // EN_COURS → maturation
          else zoneFactor = 0.5;                      // PRECOCE → quasi nul
        }
        // Variation IMC : si IMC monte vers la zone récolte, anticiper +5-10%
        let deltaFactor = 1;
        if (imcTomorrow && todayImc != null) {
          const dImc = imcTomorrow.pourcentage - todayImc;
          deltaFactor = 1 + Math.max(-0.10, Math.min(0.10, dImc / 100));
        } else if (imcSlope) {
          deltaFactor = 1 + Math.max(-0.10, Math.min(0.10, imcSlope / 100));
        }

        let combined = trendFactor * zoneFactor * deltaFactor;
        combined = Math.max(0.6, Math.min(1.5, combined));
        const predKg = Math.round(ma3Prod * combined);

        // Recommandation équipe : seuil 15% pour éviter micro-ajustements
        const ratio = ma3Prod > 0 ? predKg / ma3Prod : 1;
        const deltaPct = Math.round((ratio - 1) * 100);
        let action = "stable";
        let actionLabel = "Maintenir l'équipe actuelle";
        if (deltaPct >= 15) { action = "augmenter"; actionLabel = "Renforcer l'équipe (+" + deltaPct + "%)"; }
        else if (deltaPct <= -15) { action = "reduire"; actionLabel = "Réduire l'équipe (" + deltaPct + "%)"; }

        teamRecommendation = {
          action,
          label: actionLabel,
          delta_pct: deltaPct,
          baseline_kg: Math.round(ma3Prod),
          predicted_kg: predKg,
          n_jours_actifs: recentActive.length,
        };

        prediction = {
          kg_estime: predKg,
          baseline_kg: Math.round(ma3Prod),
          facteur_tendance: Math.round(trendFactor * 100) / 100,
          facteur_zone: Math.round(zoneFactor * 100) / 100,
          facteur_delta_imc: Math.round(deltaFactor * 100) / 100,
          imc_aujourdhui: todayImc,
          imc_demain: imcTomorrow ? imcTomorrow.pourcentage : null,
          alerte_demain: imcTomorrow ? imcTomorrow.alerte : todayAlerte,
          source: imcTomorrow ? "baseline + maturité + forecast intérieur" : "baseline + maturité (sans forecast)",
        };
      }

      if (tomorrowFcMeta && imcTomorrow) {
        forecastTomorrow = {
          date: tomorrowFcMeta.date,
          imc: imcTomorrow.pourcentage,
          alerte: imcTomorrow.alerte,
          gdd_cumule: tomorrowFcMeta.gdd_cumule,
          tmax: tomorrowFcMeta.tmax,
          tmin: tomorrowFcMeta.tmin,
          hr: tomorrowFcMeta.hr,
          dli: tomorrowFcMeta.dli,
          prod_estime: prediction ? prediction.kg_estime : null,
          source: "indoor_forecast",
        };
      }

      // Tendance pour le frontend (sparkline)
      const tendance = {
        jours_actifs: recentActive.map(d => ({ date: d.date, prod: d.production_kg, imc: d.imc })),
        imc_slope_par_jour: Math.round(imcSlope * 100) / 100,
        prod_slope_kg_par_jour: Math.round(prodSlope),
      };

      const cutoffDate = new Date(endDate + "T12:00:00");
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoff = cutoffDate.toISOString().slice(0, 10);
      const filteredDaily = dailyData.filter(d => d.date >= cutoff);

      res.json({
        success: true,
        variete: varieteFilter || "Toutes",
        varietesDisponibles,
        dailyData: filteredDaily,
        prediction,
        teamRecommendation,
        forecastTomorrow,
        tendance,
        periode: { start: cutoff, end: endDate, jours: filteredDaily.length },
      });
    } catch (err) {
      console.error("Climat-Production error:", err);
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
  const todayStr = localDateStr();
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

// =============================================
// Productivity Reports — scheduled IMAP scan (15 min)
// Picks up new Driscoll's "Grower productivity report" emails near-realtime.
// =============================================
exports.productivityReportsCron = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .pubsub.schedule("every 15 minutes")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { console.warn("productivityReportsCron: ANTHROPIC_API_KEY missing, skipping"); return null; }

    const { ImapFlow } = require("imapflow");
    const { simpleParser } = require("mailparser");
    const productivity = require("./lib/productivity");

    const client = new ImapFlow({
      host: process.env.IMAP_HOST,
      port: parseInt(process.env.IMAP_PORT || "993"),
      secure: process.env.IMAP_TLS !== "false",
      auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
      logger: false,
    });

    try {
      await client.connect();
      let bucket = null;
      try { bucket = admin.storage().bucket("berrygood-farms-photos"); } catch (_) { /* no bucket */ }
      const result = await productivity.refetchProductivityReports({
        imapClient: client,
        simpleParser,
        db: admin.firestore(),
        bucket,
        apiKey,
        mailbox: process.env.IMAP_MAILBOX || "INBOX",
        onlyNew: true,    // cron only picks unseen messages
        maxEmails: 50,
      });
      console.log(`productivityReportsCron: processed=${result.processed} skipped=${result.skipped}`);
    } catch (err) {
      console.error("productivityReportsCron error:", err.message);
    } finally {
      try { await client.logout(); } catch (_) { /* ignore */ }
    }
    return null;
  });

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
      const pointageActions = ['summary', 'detail', 'dates', 'recolte', 'hors-recolte', 'recolte-equipes', 'quinzaine', 'quinzaine-analytique', 'quinzaine-repos', 'quinzaine-alertes', 'upload-times', 'postes-fixes', 'suivi-tunnels', 'presence'];
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
          if (ferme === "DIVERS") {
            // Snapshot = freeze Firestore divers entries
            const diversDoc = await db_firestore.collection("pointage_divers").doc(date).get();
            const diversData = diversDoc.exists ? diversDoc.data() : { entries: [] };
            await db_firestore.collection("pointage_snapshots").doc(docId).set({
              ...diversData, snapshotAt: Date.now(), snapshotBy: profileId,
            });
            current.workerCount = (diversData.entries || []).length;
          } else {
            // Create snapshot of SQL data (freeze data at submission time)
            const { createSnapshot } = require("./pointageService");
            const snapshotData = await createSnapshot(date, ferme, profileId);
            current.workerCount = snapshotData.workerCount || 0;
          }
          current.visaRH = visa;
          current.snapshotId = docId;
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

      // ------ POINTAGE DIVERS (DVR): config CRUD + daily entries ------

      // ONE-TIME SEED: populate initial divers config from DVR Excel (remove after use)
      if (action === "divers-seed") {
        const existing = await db_firestore.collection("pointage_divers_config").where("active", "==", true).limit(1).get();
        if (!existing.empty) return res.json({ success: true, message: "Déjà initialisé", count: 0 });
        const items = [
          { beneficiaire: "KADOUR DEBAZ TRAC", fonction: "TRACTEUR", tache: "NETTIYAGE F5", prixUnitaire: 450, unite: "JOUR" },
          { beneficiaire: "REFISSA TRAC", fonction: "TRACTEUR", tache: "Traitement Avocat", prixUnitaire: 450, unite: "JOUR" },
          { beneficiaire: "EL MESBAHI AHMED", fonction: "TRS", tache: "TRS OUVRIRE F6", prixUnitaire: 400, unite: "JOUR" },
          { beneficiaire: "MOHAMED JCB", fonction: "JCB", tache: "CHAREGEMENT", prixUnitaire: 250, unite: "HEURE" },
          { beneficiaire: "EL MAJDOUBI MUSTAPHA", fonction: "TRACTEUR", tache: "NETTIYAGE F5", prixUnitaire: 450, unite: "VOYAGES" },
          { beneficiaire: "HAMAMOU HAMZA", fonction: "TRACTEUR", tache: "Réparation de la route F1", prixUnitaire: 400, unite: "JOUR" },
          { beneficiaire: "RAGRAGUI BRAHIM", fonction: "TRS", tache: "TRS D'emballage F1", prixUnitaire: 100, unite: "VOYAGES" },
          { beneficiaire: "KRIDECHE MOHAMED", fonction: "TRS", tache: "TRS D'emballage F5", prixUnitaire: 200, unite: "VOYAGES" },
          { beneficiaire: "RAGRAGUI BRAHIM", fonction: "TRS", tache: "TRS D'emballage F5", prixUnitaire: 100, unite: "VOYAGES" },
          { beneficiaire: "EL SEGHIRE BACHIR", fonction: "TRS", tache: "TRS D'emballage F5", prixUnitaire: 150, unite: "VOYAGES" },
          { beneficiaire: "KRIDECHE MOHAMED", fonction: "TRS FRUITS", tache: "TRS FRUITS", prixUnitaire: 500, unite: "VOYAGES" },
        ];
        const batch = db_firestore.batch();
        items.forEach(item => {
          const ref = db_firestore.collection("pointage_divers_config").doc();
          batch.set(ref, { ...item, active: true, createdAt: Date.now(), updatedAt: Date.now() });
        });
        await batch.commit();
        return res.json({ success: true, message: items.length + " sous-traitants créés", count: items.length });
      }

      // GET: list active divers config items
      if (action === "divers-config") {
        const snap = await db_firestore.collection("pointage_divers_config").where("active", "==", true).orderBy("beneficiaire").get();
        const items = [];
        snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, items });
      }

      // POST: create or update a divers config item
      if (action === "divers-config-save" && req.method === "POST") {
        const { id, beneficiaire, fonction, tache, prixUnitaire, unite } = req.body || {};
        if (!beneficiaire || !fonction || !tache || !prixUnitaire || !unite) {
          return res.status(400).json({ success: false, error: "beneficiaire, fonction, tache, prixUnitaire, unite required" });
        }
        const data = { beneficiaire: beneficiaire.trim(), fonction: fonction.trim(), tache: tache.trim(), prixUnitaire: Number(prixUnitaire), unite: unite.trim(), active: true, updatedAt: Date.now() };
        if (id) {
          await db_firestore.collection("pointage_divers_config").doc(id).update(data);
          return res.json({ success: true, id, message: "Mis à jour" });
        } else {
          data.createdAt = Date.now();
          const ref = await db_firestore.collection("pointage_divers_config").add(data);
          return res.json({ success: true, id: ref.id, message: "Créé" });
        }
      }

      // POST: soft-delete a divers config item
      if (action === "divers-config-delete" && req.method === "POST") {
        const { id } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: "id required" });
        await db_firestore.collection("pointage_divers_config").doc(id).update({ active: false, updatedAt: Date.now() });
        return res.json({ success: true, message: "Supprimé" });
      }

      // ── Jours fériés Maroc — source unique app_settings/jours_feries ──
      // GET: liste des fériés (calendrier RH + éditeur)
      if (action === "jours-feries") {
        const snap = await db_firestore.collection("app_settings").doc("jours_feries").get();
        const data = snap.exists ? snap.data() : {};
        return res.json({
          success: true,
          holidays: Array.isArray(data.holidays) ? data.holidays : [],
          lastSyncAt: data.lastSyncAt || null,
          syncSource: data.syncSource || null,
        });
      }

      // POST: upsert RH d'un férié (override = vérité finale, jamais écrasé par le job)
      if (action === "jours-feries-save" && req.method === "POST") {
        const { originalDate, date, label, type, status } = req.body || {};
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !label) {
          return res.status(400).json({ success: false, error: "date (YYYY-MM-DD) et label requis" });
        }
        const t = (type === "islamique") ? "islamique" : "fixe";
        const st = ["fixe", "estime", "confirme"].includes(status) ? status : (t === "fixe" ? "fixe" : "confirme");
        const nowIso = new Date().toISOString();
        const ref = db_firestore.collection("app_settings").doc("jours_feries");
        await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const cur = snap.exists ? snap.data() : {};
          const holidays = Array.isArray(cur.holidays) ? cur.holidays.slice() : [];
          const matchDate = originalDate || date;
          const idx = holidays.findIndex(h => h.date === matchDate);
          const entry = {
            date, label: label.trim(), type: t, status: st,
            source: "rh", manualOverride: true, updatedAt: nowIso,
          };
          if (idx >= 0) holidays[idx] = Object.assign({}, holidays[idx], entry);
          else holidays.push(entry);
          holidays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
          tx.set(ref, { holidays, updatedAt: nowIso }, { merge: true });
        });
        return res.json({ success: true, message: originalDate ? "Mis à jour" : "Créé" });
      }

      // POST: suppression RH d'un férié par date
      if (action === "jours-feries-delete" && req.method === "POST") {
        const { date } = req.body || {};
        if (!date) return res.status(400).json({ success: false, error: "date requise" });
        const nowIso = new Date().toISOString();
        const ref = db_firestore.collection("app_settings").doc("jours_feries");
        await db_firestore.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const cur = snap.exists ? snap.data() : {};
          const holidays = (Array.isArray(cur.holidays) ? cur.holidays : []).filter(h => h.date !== date);
          tx.set(ref, { holidays, updatedAt: nowIso }, { merge: true });
        });
        return res.json({ success: true, message: "Supprimé" });
      }

      // GET: get divers entries for a specific date
      if (action === "divers-entries") {
        const date = req.query.date;
        if (!date) return res.status(400).json({ success: false, error: "date required" });
        const doc = await db_firestore.collection("pointage_divers").doc(date).get();
        return res.json({ success: true, data: doc.exists ? doc.data() : { date, entries: [], totalMontant: 0 } });
      }

      // GET: divers entries for a whole quinzaine (vue quinzaine + carte récap)
      if (action === "divers-entries-range") {
        const meta = await getPointageMeta();
        const periodes = (meta && meta.periodes) || [];
        const periodeMap = (meta && meta.periodeMap) || {};
        let periode = req.query.periode;
        if (!periode || !periodeMap[periode]) {
          const d = req.query.date;
          periode = (d && periodes.find(p => (periodeMap[p] || []).includes(d))) || periodes[0] || null;
        }
        // Plage CALENDAIRE complète de la quinzaine (pas seulement les jours de production),
        // pour capter les saisies divers manuelles sur des jours sans pointage production.
        const shiftD = (ds, n) => { const x = new Date(ds + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
        const pDays = (periode && periodeMap[periode] ? periodeMap[periode] : []).slice().sort();
        const dates = [];
        if (pDays.length) {
          const start = pDays[0];
          const idxP = periodes.indexOf(periode);
          const newerDays = (idxP > 0 ? (periodeMap[periodes[idxP - 1]] || []) : []).slice().sort(); // periodes triés DESC → idx-1 = quinzaine plus récente
          const end = newerDays.length ? shiftD(newerDays[0], -1) : shiftD(start, 15);
          for (let d = start; d <= end; d = shiftD(d, 1)) dates.push(d);
        }
        const byDate = {};
        for (let i = 0; i < dates.length; i += 10) {
          const batch = dates.slice(i, i + 10);
          const snaps = await Promise.all(batch.map(dd => db_firestore.collection("pointage_divers").doc(dd).get()));
          snaps.forEach((s, idx) => {
            const dd = batch[idx];
            const data = s.exists ? s.data() : null;
            byDate[dd] = { entries: (data && data.entries) || [], totalMontant: (data && data.totalMontant) || 0 };
          });
        }
        return res.json({ success: true, periodes, periode, dates, byDate });
      }

      // POST: save divers entries for a date (blocked if locked)
      if (action === "divers-entries-save" && req.method === "POST") {
        const { date, entries, profileId } = req.body || {};
        if (!date || !entries) return res.status(400).json({ success: false, error: "date, entries required" });

        // Check if locked
        const valDoc = await db_firestore.collection("pointage_validations").doc(`${date}_DIVERS`).get();
        if (valDoc.exists && valDoc.data().locked) {
          return res.status(403).json({ success: false, error: "Pointage verrouillé pour cette date" });
        }

        const cleanEntries = entries.map(e => ({
          configId: e.configId || "",
          beneficiaire: (e.beneficiaire || "").trim(),
          matricule: (e.matricule || "").trim(),
          fonction: (e.fonction || "").trim(),
          tache: (e.tache || "").trim(),
          quantite: Number(e.quantite) || 0,
          prixUnitaire: Number(e.prixUnitaire) || 0,
          unite: (e.unite || "").trim(),
          montant: Math.round((Number(e.quantite) || 0) * (Number(e.prixUnitaire) || 0) * 100) / 100,
          commentaire: (e.commentaire || "").trim(),
        }));
        const totalMontant = Math.round(cleanEntries.reduce((s, e) => s + e.montant, 0) * 100) / 100;

        await db_firestore.collection("pointage_divers").doc(date).set({
          date, entries: cleanEntries, totalMontant,
          createdBy: profileId || "rh", updatedAt: Date.now(),
        });
        return res.json({ success: true, totalMontant, count: cleanEntries.length });
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

// =============================================================================
// generateRecoForAnalyse — shared logic used by both the HTTP handler
// (action=generate-reco-foliaire) and the Firestore trigger that auto-runs
// when a new analysis with a PDF is created.
// Returns { success, cached, recommandation, error }. Never throws.
// =============================================================================
async function generateRecoForAnalyse(id, opts = {}) {
  const { force = false, parcelle, ferme, culture, photo_url, scan_url: scanUrlOverride, note_demande } = opts;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { success: false, error: "Clé API Anthropic non configurée" };
  if (!id) return { success: false, error: "id requis" };

  const analyseSnap = await db_firestore.collection("analyses_foliaires").doc(id).get();
  if (!analyseSnap.exists) return { success: false, error: "Analyse introuvable" };
  const analyse = analyseSnap.data();

  const refusalRe = /^\s*(je ne peux pas|je n'ai pas (accès|pu|de)|je ne (vois|dispose)|désolé|sorry|i (cannot|can't|don't|am (unable|not able)))/i;
  const isValidReco = (r) => {
    if (!r || !r.message || r.message.length < 600) return false;
    if (refusalRe.test(r.message)) return false;
    if (r.has_scan === true) return true;
    return Object.keys(analyse.parsed_values || {}).length >= 5;
  };

  if (!force) {
    const existing = (analyse.recommandations_ia || []).slice().sort((a, b) => (b.generated_at || 0) - (a.generated_at || 0));
    const lastValid = existing.find(isValidReco);
    if (lastValid) return { success: true, recommandation: lastValid, cached: true };
  }

  const docRef = db_firestore.collection("analyses_foliaires").doc(id);
  const startedAt = Date.now();
  const writeProgress = async (patch) => {
    try {
      await docRef.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`reco_progress.${k}`, v])));
    } catch (e) { console.warn("reco_progress write failed", e.message); }
  };
  const clearProgress = async () => {
    try {
      await docRef.update({ reco_progress: admin.firestore.FieldValue.delete() });
    } catch (e) { console.warn("reco_progress clear failed", e.message); }
  };
  // Initial state — full reset (not a nested patch) so stale fields from a previous run are gone.
  try {
    await docRef.update({
      reco_progress: {
        state: "loading_pdf",
        started_at: startedAt,
        updated_at: startedAt,
        source: opts.source || "manual",
      },
    });
  } catch (e) { console.warn("reco_progress init failed", e.message); }

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const messageContent = [];

  const bucketStoragePath = (url) => {
    if (!url) return null;
    try {
      const bName = bucket.name;
      const gcs = new RegExp("^https?://storage\\.googleapis\\.com/" + bName.replace(/[-.]/g, "\\$&") + "/(.+)$");
      const m1 = url.match(gcs);
      if (m1) return decodeURIComponent(m1[1].split("?")[0]);
      const fb = new RegExp("^https?://firebasestorage\\.googleapis\\.com/v0/b/" + bName.replace(/[-.]/g, "\\$&") + "/o/([^?]+)");
      const m2 = url.match(fb);
      if (m2) return decodeURIComponent(m2[1]);
    } catch (e) { /* ignore */ }
    return null;
  };

  const loadFile = async (url) => {
    if (!url) return null;
    const p = bucketStoragePath(url);
    if (p) {
      try {
        const [buf] = await bucket.file(p).download();
        const [meta] = await bucket.file(p).getMetadata().catch(() => [{}]);
        return { data: buf, type: meta?.contentType || "application/octet-stream" };
      } catch (e) { console.error("bucket download failed", p, e.message); return null; }
    }
    try {
      const https = require("https");
      const http = require("http");
      const mod = url.startsWith("https") ? https : http;
      return await new Promise((resolve) => {
        mod.get(url, (resp) => {
          if (resp.statusCode !== 200) { resp.resume(); return resolve(null); }
          const chunks = [];
          resp.on("data", c => chunks.push(c));
          resp.on("end", () => resolve({ data: Buffer.concat(chunks), type: resp.headers["content-type"] || "application/octet-stream" }));
          resp.on("error", () => resolve(null));
        }).on("error", () => resolve(null));
      });
    } catch (e) { console.error("loadFile error:", e.message); return null; }
  };

  const scanUrl = scanUrlOverride || analyse.scan_resultat_url;
  const scanFile = await loadFile(scanUrl);
  if (scanFile) console.log("scan loaded", scanFile.data.length, "bytes", scanFile.type);

  // Load all terrain observation photos for the same ferme+variete (last 3 months).
  let terrainPhotoCount = 0;
  try {
    const THREE_MONTHS = 90 * 86400000;
    const cutoff = Date.now() - THREE_MONTHS;
    const terrainSnap = await db_firestore.collection("analyses_foliaires")
      .where("ferme", "==", analyse.ferme || ferme)
      .where("variete", "==", analyse.variete || parcelle)
      .where("type_analyse", "==", "observation_terrain")
      .get();
    const allPhotoUrls = [];
    terrainSnap.docs.forEach(d => {
      const data = d.data();
      if ((data.date_analyse || data.created_at || 0) < cutoff) return;
      (data.photo_urls || []).forEach(p => { if (p.url) allPhotoUrls.push(p.url); });
    });
    // Also include legacy single photo and photo_urls on the current analyse doc.
    if (photo_url) allPhotoUrls.unshift(photo_url);
    (analyse.photo_urls || []).forEach(p => { if (p.url && !allPhotoUrls.includes(p.url)) allPhotoUrls.push(p.url); });
    // Cap at 6 images to stay within Claude message size limits.
    const toLoad = allPhotoUrls.slice(0, 6);
    const photoFiles = await Promise.all(toLoad.map(url => loadFile(url)));
    photoFiles.filter(Boolean).forEach(img => {
      if (img.type.startsWith("image/")) {
        messageContent.push({ type: "image", source: { type: "base64", media_type: img.type, data: img.data.toString("base64") } });
        terrainPhotoCount++;
      }
    });
    if (terrainPhotoCount) console.log(`terrain photos loaded: ${terrainPhotoCount}`);
  } catch (e) {
    console.warn("terrain photo loading failed, continuing:", e.message);
  }

  let scanPdfSent = false;
  let scanImageSent = false;
  if (scanFile) {
    const looksLikePdf = scanFile.data.length >= 4 && scanFile.data.slice(0, 4).toString("ascii") === "%PDF";
    const mimeIsPdf = scanFile.type.includes("pdf") || (scanUrl && /\.pdf$/i.test(scanUrl));
    if (looksLikePdf && mimeIsPdf) {
      messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: scanFile.data.toString("base64") } });
      scanPdfSent = true;
    } else if (scanFile.type.startsWith("image/")) {
      messageContent.push({ type: "image", source: { type: "base64", media_type: scanFile.type, data: scanFile.data.toString("base64") } });
      scanImageSent = true;
    } else if (mimeIsPdf && !looksLikePdf) {
      console.error("scan url claims pdf but buffer does not start with %PDF-", scanUrl);
    }
  }

  const parsedValuesLines = Object.entries(analyse.parsed_values || {})
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");
  const typeLabel = {
    foliaire: "Analyse foliaire (feuilles)",
    sol: "Analyse de sol",
    eau_irrigation: "Analyse d'eau d'irrigation",
    eau_apport: "Analyse d'eau d'apport",
    eau_du_sol: "Analyse d'eau du sol",
  }[analyse.type_analyse] || analyse.type_analyse || "Analyse foliaire";
  const dateStr = analyse.date_analyse ? new Date(analyse.date_analyse).toLocaleDateString("fr-FR") : "Non précisée";

  // Fetch variety general context
  let contexteGeneral = "";
  try {
    const ctxVariete = (analyse.variete || parcelle || "").toUpperCase().replace(/\s+/g, "_");
    const ctxFerme = analyse.ferme || ferme || "";
    if (ctxVariete && ctxFerme) {
      const ctxDoc = await db_firestore.collection("variete_contextes").doc(`${ctxFerme}_${ctxVariete}`).get();
      if (ctxDoc.exists) contexteGeneral = ctxDoc.data().contexte_general || "";
    }
  } catch (e) { console.warn("variete contexte fetch failed", e.message); }

  const prompt = `Tu es **Ingénieur Agronome Senior**, expert reconnu des petits fruits rouges (myrtille, framboise) et de l'avocatier sous serre dans la région Souss-Massa (Maroc). Tu rédiges un **rapport de consultation agronomique professionnel** destiné au Directeur Technique et au Chef de Ferme de Berry Good Farms. Le ton est celui d'un expert : sobre, précis, chiffré, actionnable — jamais promotionnel, jamais alarmiste sans justification.

Tu disposes du rapport d'analyse complet AGQ Labs en pièce jointe PDF. **Lis-le intégralement** et intègre toutes les données pertinentes (foliaire, eau d'irrigation, SFR, sonde sol, drainage si présents).

## Dossier client
- **Exploitation** : Berry Good Farms — ${ferme || analyse.ferme || "?"}
- **Parcelle / Variété** : ${analyse.variete || parcelle || "Non spécifiée"}
- **Culture** : ${culture || analyse.culture || "?"}
- **Type d'analyse** : ${typeLabel}
- **Date de prélèvement** : ${dateStr}
- **Stade phénologique** : ${analyse.phenologie || "Non précisé"}
- **Laboratoire** : ${analyse.source === "email_agq" ? "AGQ Labs Maroc" : "Analyse manuelle"}
- **Observations terrain** : ${analyse.terrain_raw || analyse.description_raw || "Aucune"}
- **Notes du chef de ferme** : ${note_demande || "Aucune"}
- **Contexte général de la variété** : ${contexteGeneral || "Aucun"}

## Valeurs pré-extraites par notre parseur (à compléter depuis le PDF)
${parsedValuesLines || "(Vide — toutes les valeurs doivent être lues directement depuis le PDF joint.)"}

${scanPdfSent ? "📎 **PDF AGQ joint** — source primaire, à lire intégralement." : ""}
${scanImageSent ? "🖼️ **Scan image joint** — lis les valeurs visibles." : ""}
${terrainPhotoCount ? `📷 **${terrainPhotoCount} photo(s) terrain jointe(s)** (observations récentes de la parcelle) — intègre les symptômes visuels si pertinent (chlorose, nécrose, stress hydrique, état des fruits…).` : ""}
${(!scanPdfSent && !scanImageSent) ? "⚠️ **Aucun rapport scan disponible** — base ton analyse uniquement sur les valeurs pré-extraites ci-dessus et indique clairement les limites." : ""}

---

## Structure obligatoire du rapport

Rédige en **français professionnel**, en markdown strict (pas d'emojis décoratifs, sauf 🟢/🟡/🔴 pour les statuts dans les tableaux). Utilise des **tableaux markdown** pour chaque jeu de données.

### 1. Synthèse exécutive
Un paragraphe de 4-6 lignes : état global de la parcelle, 2-3 points critiques, niveau de priorité (**Faible / Moyen / Élevé / Critique**).

### 2. État nutritionnel détaillé
Pour **chaque matrice présente** (foliaire, eau d'irrigation, SFR, sonde sol, drainage), produis un tableau | Élément | Valeur | Norme | Statut |. Couvre macro + oligos + pH/CE/HCO₃/Cl/Na/ratios. Normes spécifiques à la culture. Statuts 🟢/🟡/🔴.

### 3. Diagnostic agronomique
#### 3.1 Rapports et équilibres ioniques — tableau des ratios critiques (K/Ca, K/Mg, Ca/Mg, N/K, SAR), commentaires.
#### 3.2 Problèmes identifiés (hiérarchisés) — pour chacun : nom court, preuves multi-matrices, mécanisme agronomique, conséquence.
#### 3.3 Niveau de priorité global — **Faible / Moyen / Élevé / Critique** + justification.

### 4. Plan de correction — Fertigation
Tableau | Élément à corriger | Action | Produit commercial (Maroc) | Dose | Fréquence | Durée |. Produits usuels (MAP, MKP, KNO₃, K₂SO₄, Ca(NO₃)₂, MgSO₄, acide nitrique/phosphorique, chélates EDDHA-Fe…). Distingue correction foliaire d'urgence vs ajustement SFR.

### 5. Actions prioritaires à 7 jours
Tableau | # | Action | Quand | Responsable | Critère de réussite | — exactement 3 actions.

### 6. Suivi et KPIs
Indicateurs + prochaine analyse recommandée + seuils de re-alerte.

### 7. Limites et hypothèses
Données manquantes ou incohérentes, explicitement.

---

**Contraintes**
- Unités SI ou horticoles (% MS, mg/kg, meq/L, dS/m).
- Toujours des doses chiffrées.
- Pas d'intro générale, pas de disclaimer.
- Longueur cible : 2000-3500 mots (hors tableaux).
- Signe en bas : "*Rapport généré par l'outil d'aide à la décision Berry Good Farms — À valider par le responsable technique.*"`;

  messageContent.push({ type: "text", text: prompt });

  const modelCandidates = [
    "claude-opus-4-6",
    "claude-sonnet-4-5",
    "claude-opus-4-20250514",
    "claude-sonnet-4-20250514",
  ];
  let response = null;
  let lastError = null;
  const claudeStart = Date.now();
  console.log(`generateRecoForAnalyse START id=${id} scanPdf=${scanPdfSent} scanImg=${scanImageSent} photo=${!!photoImg}`);
  await writeProgress({
    state: "calling_llm",
    updated_at: Date.now(),
    detail: scanFile ? `PDF ${Math.round(scanFile.data.length / 1024)} KB` : "Pas de scan",
    model: modelCandidates[0],
  });
  for (const modelId of modelCandidates) {
    try {
      response = await client.messages.create({
        model: modelId,
        max_tokens: 16000,
        messages: [{ role: "user", content: messageContent }],
      });
      console.log(`generateRecoForAnalyse DONE id=${id} model=${modelId} duration=${Date.now() - claudeStart}ms`);
      break;
    } catch (e) {
      lastError = e;
      console.error("Claude model failed", modelId, e.message);
    }
  }
  if (!response) {
    await writeProgress({ state: "error", detail: lastError?.message?.slice(0, 200) || "LLM_UNAVAILABLE", updated_at: Date.now() });
    setTimeout(clearProgress, 10000);
    return { success: false, error: "LLM_UNAVAILABLE", detail: lastError?.message || "Aucun modèle Claude n'a répondu" };
  }

  const message = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
  const reco = {
    message,
    model: response.model || "claude",
    generated_at: Date.now(),
    has_photo: !!photoImg,
    has_scan: !!(scanPdfSent || scanImageSent),
    scan_format: scanPdfSent ? "pdf" : scanImageSent ? "image" : null,
  };

  if (!isValidReco(reco)) {
    console.error("LLM refusal or too-short reco, not storing:", message.slice(0, 200));
    await writeProgress({ state: "error", detail: "LLM_NO_PDF", updated_at: Date.now() });
    setTimeout(clearProgress, 10000); // leave the error state visible for 10s then clear
    return { success: false, error: "LLM_NO_PDF", preview: message.slice(0, 300) };
  }

  await writeProgress({ state: "saving", updated_at: Date.now() });
  const snap = await docRef.get();
  if (snap.exists) {
    const existing = snap.data().recommandations_ia || [];
    existing.push(reco);
    await docRef.update({ recommandations_ia: existing, updated_at: Date.now() });
  }
  await clearProgress();
  return { success: true, recommandation: reco };
}

// =============================================================================
// Auto-generate AI recommendation when a new foliar analysis gets a PDF attached.
// Fires on any write to analyses_foliaires/{id}. Triggers generation only when
// scan_resultat_url has just appeared (was null/undefined, now set) AND there
// is no existing valid reco yet. This covers AGQ email imports (where the PDF
// is uploaded right after doc creation via an update).
// =============================================================================
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

exports.stockManagement = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");

    const action = req.query.action || req.body?.action || "stock-dashboard";

    // Admin-only actions (no Firebase Auth, uses env secret)
    const adminSecret = process.env.ADMIN_SECRET || "bgf-admin-2026";
    if (action === "reset-email-cursor" && req.method === "POST") {
      if (req.body.secret !== adminSecret) return res.status(403).json({ success: false, error: "forbidden" });
      const { uid } = req.body;
      if (typeof uid !== "number") return res.status(400).json({ success: false, error: "uid (number) requis" });
      await db_firestore.collection("config").doc("email_fetch").set({ lastPollUid: uid }, { merge: true });
      return res.json({ success: true, message: `lastPollUid reset to ${uid}` });
    }
    if (action === "reprocess-email" && req.method === "POST") {
      if (req.body.secret !== adminSecret) return res.status(403).json({ success: false, error: "forbidden" });
      const { uid } = req.body;
      if (!uid) return res.status(400).json({ success: false, error: "uid requis" });
      // Find the email doc by scanning for matching uid
      const snap = await db_firestore.collection("emails").where("uid", "==", uid).limit(1).get();
      if (snap.empty) return res.json({ success: false, error: `No email doc found with uid=${uid}` });
      const docRef = snap.docs[0].ref;
      const docId = snap.docs[0].id;
      const data = snap.docs[0].data();
      // Delete and re-create to trigger analyzeEmail (onCreate)
      await docRef.delete();
      await db_firestore.collection("emails").doc(docId).set({ ...data, status: "pending", reprocessed_at: Date.now() });
      return res.json({ success: true, message: `Email doc ${docId} (uid=${uid}) deleted and re-created with status=pending` });
    }

    // Skip Firebase Auth when admin secret is provided (CLI/scripts)
    let authUser;
    if (req.body?.secret === adminSecret) {
      authUser = { uid: "admin-cli", email: "admin@berrygood.ma" };
    } else {
      authUser = await requireAuth(req, res);
      if (!authUser) return;
    }

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

      // Validate ALL pending suppliers at once
      if (action === "validate-all-suppliers" && req.method === "POST") {
        const { validated_by } = req.body;
        const snap = await db_firestore.collection("suppliers").where("status", "==", "en_attente").where("active", "==", true).get();
        if (snap.empty) return res.json({ success: true, count: 0 });
        const now = Date.now();
        const batch = db_firestore.batch();
        snap.docs.forEach(doc => {
          const current = doc.data();
          batch.update(doc.ref, {
            status: "valide",
            validated_by: validated_by || {},
            validated_at: now,
            updated_at: now,
            history: [...(current.history || []), {
              action: "validation",
              by: validated_by || {},
              at: now,
              comment: "Validation groupée par Finance",
            }],
          });
        });
        await batch.commit();
        return res.json({ success: true, count: snap.size });
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
        // Fetch linked delivery notes (no orderBy to avoid composite index requirement)
        const blSnap = await db_firestore.collection("delivery_notes").where("bdc_id", "==", id).get();
        const bls = blSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at || '') > (a.created_at || '') ? -1 : 1);
        // Fetch linked invoices
        const facSnap = await db_firestore.collection("invoices").where("bdc_id", "==", id).get();
        const factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.created_at || '') > (a.created_at || '') ? -1 : 1);
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
          const taux = item.taux_tva != null && item.taux_tva !== '' ? parseFloat(item.taux_tva) : 20;
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
            const taux = item.taux_tva != null && item.taux_tva !== '' ? parseFloat(item.taux_tva) : 20;
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
        const { id, submitted_by, pdf_url } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        if (current.status !== "brouillon" && current.status !== "rejete") {
          return res.status(400).json({ success: false, error: "Seul un BDC en brouillon ou rejeté peut être soumis" });
        }
        const history = current.history || [];
        const now = Date.now();
        // Fermes sans chef de ferme (Avocatier, F2, F3, F4, F6, BAHIA) → soumission directe au DG.
        // Source de vérité : functions/lib/bdc/workflow.js (mirror public/lib/bdcWorkflow.js).
        const skipChef = !bdcWorkflow.requiresChefValidation(current.ferme);
        const nextStatus = bdcWorkflow.nextStatusOnSubmit(current.ferme);
        const historyEntry = {
          action: skipChef ? "soumission_directe_dg" : "soumission",
          by: submitted_by || {},
          at: now,
          comment: skipChef ? `Ferme ${current.ferme} sans Chef de Ferme — soumission directe au DG` : "",
        };
        const bypassReason = bdcWorkflow.bypassReason(current.ferme);
        if (bypassReason) historyEntry.bypass_reason = bypassReason;
        history.push(historyEntry);
        const updatePatch = { status: nextStatus, history, updated_at: now };
        if (pdf_url) updatePatch.pdf_url = pdf_url;
        await db_firestore.collection("purchase_orders").doc(id).update(updatePatch);
        // WhatsApp: notify chef de ferme OU DG selon le cas
        const { buildBdcWhatsAppSummary } = require("./notificationDispatcher");
        const bdcForSummary = { ...current, id };
        const bdcPdfUrl = pdf_url || current.pdf_url || null;
        const useDocTemplate = !!bdcPdfUrl;
        // Résumé articles sur une ligne (params Meta : pas de saut de ligne ni 4+ espaces).
        const _items = Array.isArray(current.items) ? current.items : [];
        const _clean = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
        const _itemLabel = (it) => {
          const lib = _clean(it.article || it.designation || "Article");
          const qte = it.quantite != null && it.quantite !== "" ? it.quantite : "?";
          const unite = it.unite ? ` ${_clean(it.unite)}` : "";
          return `${lib} ×${qte}${unite}`;
        };
        const articlesSummary = _items.length
          ? _items.slice(0, 3).map(_itemLabel).join(", ") + (_items.length > 3 ? ` (+${_items.length - 3} autres)` : "")
          : "—";
        const fournisseurNom = _clean((current.fournisseur && current.fournisseur.nom) || "") || "—";
        dispatchNotification({
          type: useDocTemplate ? "bdc_submit_doc" : "bdc_submit",
          profiles: skipChef ? ["dg"] : ["chef"],
          ferme: skipChef ? null : current.ferme,
          data: {
            numero: current.numero || id,
            fournisseur: fournisseurNom,
            articles: articlesSummary,
            montant: current.total_ttc ? `${current.total_ttc} MAD` : "Non précisé",
            message: `BDC ${current.numero || id} en attente de validation ${skipChef ? "DG" : "Chef"}`,
            bdc_id: id,
            pdf_url: bdcPdfUrl,
            summary: buildBdcWhatsAppSummary(bdcForSummary),
          },
          relatedDoc: `purchase_orders/${id}`,
          ...(useDocTemplate ? { document: { link: bdcPdfUrl, filename: `BDC_${current.numero || id}.pdf` } } : {}),
        }).catch(err => console.error("WhatsApp dispatch error:", err));
        return res.json({ success: true });
      }

      // One-shot migration: redirige les BdC actuellement en `en_attente_chef` pour
      // des fermes DIRECT_DG_FARMS (Avocatier/F2/F3/F4/F6/BAHIA) vers `en_attente_dg`.
      // Protégé par admin-secret. À lancer une fois après déploiement de la nouvelle règle.
      if (action === "migrate-bdc-direct-dg" && req.method === "POST") {
        if (req.body.secret !== adminSecret) return res.status(403).json({ success: false, error: "forbidden" });
        const snap = await db_firestore.collection("purchase_orders")
          .where("status", "==", "en_attente_chef").get();
        const targets = snap.docs.filter(d => !bdcWorkflow.requiresChefValidation(d.data().ferme));
        const now = Date.now();
        const migratedIds = [];
        const unknownFermes = new Set();
        // Firestore batch limit = 500 ; on chunke à 400 par convention CLAUDE.md.
        for (let i = 0; i < targets.length; i += 400) {
          const batch = db_firestore.batch();
          const chunk = targets.slice(i, i + 400);
          for (const d of chunk) {
            const data = d.data();
            const history = (data.history || []).concat([{
              action: "migration_direct_dg",
              by: { profileId: "system", name: "Migration script" },
              at: now,
              comment: `BDC redirigé vers DG (règle DIRECT_DG_FARMS, ferme=${data.ferme})`,
              bypass_reason: "no_chef_de_ferme",
              previous_status: "en_attente_chef",
            }]);
            batch.update(d.ref, { status: "en_attente_dg", history, updated_at: now });
            migratedIds.push(d.id);
          }
          await batch.commit();
        }
        // Data-quality signal : log les fermes inconnues croisées (ni F1/F5 ni 6 fermes ciblées).
        for (const d of snap.docs) {
          const f = d.data().ferme;
          if (!f || (bdcWorkflow.requiresChefValidation(f) && !["F1", "F5"].includes(f))) unknownFermes.add(f || "(empty)");
        }
        return res.json({
          success: true,
          scanned: snap.size,
          migrated: targets.length,
          migrated_ids: migratedIds,
          unknown_fermes: Array.from(unknownFermes),
        });
      }

      if (action === "delete-bdc" && req.method === "POST") {
        const { id, deleted_by } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const requesterProfile = deleted_by && deleted_by.profileId;
        const canForceDelete = requesterProfile === "achats" || requesterProfile === "admin";
        if (doc.data().status !== "brouillon" && !canForceDelete) {
          return res.status(400).json({ success: false, error: "Seul un BDC en brouillon peut être supprimé" });
        }
        await db_firestore.collection("purchase_orders").doc(id).delete();
        return res.json({ success: true });
      }

      if (action === "validate-bdc" && req.method === "POST") {
        const { id, decision, role, profileId, name, comment, ferme: validatorFerme } = req.body;
        const result = await validateBdcCore({
          id, decision, role, profileId, name, comment, ferme: validatorFerme, via: "dashboard",
        });
        if (!result.success) {
          return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        }
        return res.json({ success: true });
      }

      if (action === "send-bdc" && req.method === "POST") {
        const { id, sent_by } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();
        const isVirement = current.mode_paiement === "comptant_virement" || current.mode_paiement === "virement_bancaire";
        if (isVirement) {
          if (current.status !== "virement_signe") {
            return res.status(400).json({ success: false, error: "Le virement doit être signé avant l'envoi au fournisseur" });
          }
        } else {
          if (current.status !== "valide_dg") {
            return res.status(400).json({ success: false, error: "Le BDC doit être validé par le DG avant envoi" });
          }
        }
        const history = current.history || [];
        history.push({ action: "envoi_fournisseur", by: sent_by || {}, at: Date.now(), comment: "" });
        await db_firestore.collection("purchase_orders").doc(id).update({
          status: "envoye", history, updated_at: Date.now(),
        });
        // WhatsApp: notify finance
        dispatchNotification({
          type: "bdc_sent_to_supplier", profiles: ["finance"],
          data: {
            numero: current.numero || id,
            supplier: current.supplier_name || "Fournisseur inconnu",
            message: `BDC ${current.numero || id} envoyé au fournisseur`,
          },
          relatedDoc: `purchase_orders/${id}`,
        }).catch(err => console.error("WhatsApp dispatch error:", err));
        return res.json({ success: true });
      }

      if (action === "update-bdc-virement" && req.method === "POST") {
        const { id, decision, by } = req.body;
        const result = await updateBdcVirementCore({ id, decision, by, via: "dashboard" });
        if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        return res.json({ success: true });
      }

      if (action === "upload-virement-avis" && req.method === "POST") {
        const { id, avis_pdf_url, uploaded_by } = req.body;
        const result = await recordVirementAvis({ id, avis_pdf_url, uploaded_by });
        if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
        return res.json({ success: true });
      }

      if (action === "migrate-bdc-mode-paiement" && req.method === "POST") {
        // One-shot migration: virement_bancaire → comptant_virement, caisse → comptant_especes, comptant → facilite
        const snap = await db_firestore.collection("purchase_orders").get();
        const map = { virement_bancaire: "comptant_virement", caisse: "comptant_especes", comptant: "facilite" };
        let updated = 0;
        const batch = db_firestore.batch();
        snap.forEach(doc => {
          const m = doc.data().mode_paiement;
          if (m && map[m]) {
            batch.update(doc.ref, { mode_paiement: map[m] });
            updated++;
          }
        });
        if (updated > 0) await batch.commit();
        return res.json({ success: true, updated, total: snap.size });
      }

      if (action === "remind-bdc" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const doc = await db_firestore.collection("purchase_orders").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const current = doc.data();

        // Determine target profiles based on current status
        let profiles = [];
        let ferme = null;
        const status = current.status;
        const isVirementMode = current.mode_paiement === "comptant_virement" || current.mode_paiement === "virement_bancaire";
        if (status === "en_attente_chef") { profiles = ["chef"]; ferme = current.ferme; }
        else if (status === "en_attente_dg") { profiles = ["dg"]; }
        else if (status === "valide_dg" && isVirementMode) { profiles = ["finance"]; }
        else if (status === "valide_dg" && !isVirementMode) { profiles = ["achats"]; }
        else if (status === "virement_lance") { profiles = ["dg"]; }
        else if (status === "virement_signe") { profiles = ["achats"]; }
        else {
          return res.status(400).json({ success: false, error: `Aucun rappel possible dans le statut "${status}"` });
        }

        // Cooldown: prevent reminders more often than every 4h
        const lastReminded = current.last_reminded_at || 0;
        const cooldownMs = 4 * 60 * 60 * 1000; // 4h
        if (Date.now() - lastReminded < cooldownMs) {
          const hoursLeft = Math.ceil((cooldownMs - (Date.now() - lastReminded)) / (60 * 60 * 1000));
          return res.status(400).json({ success: false, error: `Rappel déjà envoyé récemment. Patientez encore ${hoursLeft}h avant un nouveau rappel.` });
        }

        // Calculate duration
        const lastUpdate = current.updated_at || current.created_at || Date.now();
        const ageMs = Date.now() - lastUpdate;
        const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        const ageHours = Math.floor(ageMs / (60 * 60 * 1000));
        const duration = ageDays > 0 ? `${ageDays} jour${ageDays > 1 ? "s" : ""}` : `${Math.max(1, ageHours)} heure${ageHours > 1 ? "s" : ""}`;

        const { dispatchNotification } = require("./notificationDispatcher");
        await dispatchNotification({
          type: "bdc_reminder",
          profiles, ferme,
          data: {
            numero: current.numero || id,
            montant: current.total_ttc ? `${current.total_ttc} MAD` : "—",
            duration,
            message: `Rappel: BDC ${current.numero || id} en attente depuis ${duration}`,
          },
          relatedDoc: `purchase_orders/${id}`,
        });

        // Track reminder
        const history = current.history || [];
        history.push({
          action: "rappel",
          by: req.body.by || {},
          at: Date.now(),
          comment: `Rappel envoyé à ${profiles.join(", ")} (en attente depuis ${duration})`,
        });
        await db_firestore.collection("purchase_orders").doc(id).update({
          last_reminded_at: Date.now(),
          reminder_count: (current.reminder_count || 0) + 1,
          history,
        });

        return res.json({ success: true, profiles, duration });
      }

      // ---- BDC Change Requests (modification/annulation) ----
      if (action === "request-bdc-change" && req.method === "POST") {
        const { bdc_id, type, motif, requested_by } = req.body;
        if (!bdc_id || !type || !motif) return res.status(400).json({ success: false, error: "bdc_id, type et motif requis" });
        if (!["modification", "annulation"].includes(type)) return res.status(400).json({ success: false, error: "type doit être modification ou annulation" });
        const doc = await db_firestore.collection("purchase_orders").doc(bdc_id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = doc.data();
        if (!["valide_dg", "envoye", "virement_lance", "virement_signe"].includes(bdc.status)) {
          return res.status(400).json({ success: false, error: "Le BDC doit être validé DG ou au-delà pour demander une modification/annulation" });
        }
        // Check no pending request exists
        const existing = await db_firestore.collection("bdc_change_requests").where("bdc_id", "==", bdc_id).where("status", "==", "en_attente").get();
        if (!existing.empty) return res.status(400).json({ success: false, error: "Une demande est déjà en cours pour ce BDC" });
        const now = Date.now();
        const ref = await db_firestore.collection("bdc_change_requests").add({
          bdc_id, bdc_numero: bdc.numero || "", type, motif, status: "en_attente",
          requested_by: requested_by || {}, created_at: now,
        });
        const history = bdc.history || [];
        history.push({ action: "demande_" + type, by: requested_by || {}, at: now, comment: motif });
        await db_firestore.collection("purchase_orders").doc(bdc_id).update({ history, updated_at: now, pending_change_request: ref.id });
        return res.json({ success: true, id: ref.id });
      }

      if (action === "list-bdc-change-requests") {
        const { status } = req.query;
        let q = db_firestore.collection("bdc_change_requests");
        if (status) q = q.where("status", "==", status);
        const snap = await q.get();
        const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        requests.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
        return res.json({ success: true, requests });
      }

      if (action === "approve-bdc-change" && req.method === "POST") {
        const { id, decision, comment, approved_by } = req.body;
        if (!id || !decision) return res.status(400).json({ success: false, error: "id et decision requis" });
        const reqDoc = await db_firestore.collection("bdc_change_requests").doc(id).get();
        if (!reqDoc.exists) return res.status(404).json({ success: false, error: "Demande non trouvée" });
        const request = reqDoc.data();
        if (request.status !== "en_attente") return res.status(400).json({ success: false, error: "Cette demande n'est plus en attente" });
        const bdcDoc = await db_firestore.collection("purchase_orders").doc(request.bdc_id).get();
        if (!bdcDoc.exists) return res.status(404).json({ success: false, error: "BDC non trouvé" });
        const bdc = bdcDoc.data();
        const history = bdc.history || [];
        const now = Date.now();
        if (decision === "approve") {
          if (request.type === "modification") {
            history.push({ action: "retour_brouillon_dg", by: approved_by || {}, at: now, comment: comment || "Modification approuvée par DG" });
            await db_firestore.collection("purchase_orders").doc(request.bdc_id).update({
              status: "brouillon", validated_by_dg: null, validated_by_chef: null, notified_finance: false,
              history, updated_at: now, pending_change_request: null,
            });
          } else {
            history.push({ action: "annulation_dg", by: approved_by || {}, at: now, comment: comment || "Annulation approuvée par DG" });
            await db_firestore.collection("purchase_orders").doc(request.bdc_id).update({
              status: "annule", history, updated_at: now, pending_change_request: null,
            });
          }
          await db_firestore.collection("bdc_change_requests").doc(id).update({ status: "approuve", approved_by: approved_by || {}, approved_at: now, comment: comment || "" });
        } else {
          history.push({ action: "demande_rejetee_dg", by: approved_by || {}, at: now, comment: comment || "Demande refusée" });
          await db_firestore.collection("purchase_orders").doc(request.bdc_id).update({ history, updated_at: now, pending_change_request: null });
          await db_firestore.collection("bdc_change_requests").doc(id).update({ status: "rejete", approved_by: approved_by || {}, approved_at: now, comment: comment || "" });
        }
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
            const tva = catArticle.taux_tva != null && catArticle.taux_tva !== '' ? parseFloat(catArticle.taux_tva) : 20;
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

        // Create stock_movement of type reception (brouillon, needs achats+chef validation)
        const brNumero = await getNextNumber("stock_reception", "BR");
        const brItems = blItems.map((it) => {
          const bdcItem = (bdc.items || []).find(bi => (bi.article || "").toLowerCase() === (it.article || "").toLowerCase());
          return {
            article_ref: it.article || "", article_nom: it.article || "",
            quantite: it.quantite_recue || 0, unite: it.unite || "kg",
            prix_unitaire: bdcItem ? (parseFloat(bdcItem.prix_unitaire) || 0) : 0,
          };
        }).filter((it) => it.quantite > 0);
        if (brItems.length > 0) {
          const magasin = req.body.magasin || bdc.ferme || "";
          await db_firestore.collection("stock_movements").add({
            numero: brNumero, type: "reception",
            date: date_reception || new Date().toISOString().split("T")[0],
            lieu_source: null,
            lieu_destination: { type: "magasin", id: magasin },
            ferme: magasin, items: brItems,
            ref_bl_fournisseur: numero_bl_fournisseur || "",
            bdc_id: bdc_id, bl_id: docRef.id,
            reception_libre: false, reception_libre_motif: "",
            ref_bon_physique: "", sortie_type: null, scan_url: scan_url || null,
            status: "valide_mag",
            validations: { magasinier: { by: (created_by || {}).userId || "", name: (created_by || {}).name || "", at: Date.now() } },
            rejection: null,
            created_by: created_by || {}, created_at: Date.now(), updated_at: Date.now(),
          });
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
        const { type, date, authorized_by, items, scan_url, created_by } = req.body;
        if (!type || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: type, items[]" });
        }
        if (!["engrais", "pesticide"].includes(type)) {
          return res.status(400).json({ success: false, error: "Type invalide (engrais|pesticide)" });
        }
        for (const it of items) {
          if (!it.parcelle) return res.status(400).json({ success: false, error: "Parcelle requise pour chaque article" });
        }
        const numero = await getNextNumber("consumption_voucher", "BC");
        const bcItems = items.map((it) => ({
          article: it.article || "", quantite: parseFloat(it.quantite) || 0, unite: it.unite || "kg",
          parcelle: it.parcelle || "", culture: it.culture || "", ferme: it.ferme || "",
        }));
        const allParcelles = [...new Set(bcItems.map(i => i.parcelle).filter(Boolean))];
        const allFermes = [...new Set(bcItems.map(i => i.ferme).filter(Boolean))];
        const bcData = {
          numero, type,
          parcelle: allParcelles.join(", "), culture: "", ferme: allFermes.join(", "),
          date: date || new Date().toISOString().split("T")[0],
          authorized_by: authorized_by || {},
          items: bcItems,
          cpc_categorie: type === "engrais" ? "Engrais" : "Pesticides",
          scan_url: scan_url || null,
          created_by: created_by || {},
          created_at: Date.now(),
        };
        const docRef = await db_firestore.collection("consumption_vouchers").add(bcData);

        // Create stock_movements grouped by parcelle + update stock_balances
        const lieuSource = req.body.lieu_source || { type: "magasin", id: allFermes[0] || "F1" };
        const validBcItems = bcItems.filter((it) => it.quantite > 0);
        const itemsByParcelle = {};
        for (const it of validBcItems) {
          const key = it.parcelle || "unknown";
          if (!itemsByParcelle[key]) itemsByParcelle[key] = [];
          itemsByParcelle[key].push(it);
        }
        for (const [parcelle, parcItems] of Object.entries(itemsByParcelle)) {
          const bcsNumero = await getNextNumber("stock_consommation", "BCS");
          const bcsItems = parcItems.map((it) => ({
            article_ref: it.article || "", article_nom: it.article || "",
            quantite: it.quantite || 0, unite: it.unite || "kg",
          }));
          const movData = {
            numero: bcsNumero, type: "consommation",
            date: date || new Date().toISOString().split("T")[0],
            lieu_source: lieuSource,
            lieu_destination: { type: "parcelle", id: parcelle },
            ferme: parcItems[0]?.ferme || "", items: bcsItems,
            ref_bl_fournisseur: "", bdc_id: null, bl_id: null,
            reception_libre: false, reception_libre_motif: "",
            ref_bon_physique: req.body.ref_bon_physique || "",
            sortie_type: null, scan_url: null,
            status: "valide_mag",
            validations: { magasinier: { by: (created_by || {}).userId || "", name: (created_by || {}).name || "", at: Date.now() } },
            rejection: null, created_by: created_by || {},
            created_at: Date.now(), updated_at: Date.now(),
            bc_id: docRef.id, bc_numero: numero,
          };
          await db_firestore.collection("stock_movements").add(movData);
          const balPromises = bcsItems.map((it) =>
            updateStockBalance(lieuSource.type, lieuSource.id, it.article_ref, it.article_nom, it.unite, -it.quantite)
          );
          await Promise.all(balPromises);
        }

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
        // Seul le profil achats peut créer des articles
        if (created_by?.profileId && created_by.profileId !== "achats" && created_by.profileId !== "dg") {
          return res.status(403).json({ success: false, error: "Seul le responsable achats peut créer des articles" });
        }
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
        const { ferme, parcelle, statut, type_analyse, variete } = req.query;
        const now = Date.now();
        const PARCELLES_MAP = {
          F1: ["P1-Myrtille A","P2-Myrtille B","P3-Framboise","P4-Myrtille C","P5-Framboise B"],
          F2: [],
          F3: [],
          F4: [],
          F5: ["P1-Myrtille","P2-Framboise A","P3-Framboise B","P4-Myrtille D"],
          F6: [],
          BAHIA: [],
          Avocatier: ["P1-Hass","P2-Hass B","P3-Fuerte"],
        };
        // Variety → canonical ferme overrides. Used to correct historical mis-assignments
        // (e.g. CASCADE is a myrtille cultivar planted only on F5).
        const VARIETE_FERME_OVERRIDE = {
          CASCADE: "F5",
        };

        // We *must* fetch without a ferme filter when an override may apply, otherwise
        // docs stored under the wrong ferme stay hidden forever. Cheap: small collection.
        let q = db_firestore.collection("analyses_foliaires");
        if (parcelle) q = q.where("parcelle", "==", parcelle);
        if (statut) q = q.where("statut", "==", statut);
        if (type_analyse) q = q.where("type_analyse", "==", type_analyse);
        if (variete) q = q.where("variete", "==", variete);
        const snap = await q.get();
        const THREE_DAYS = 3 * 86400000;
        const THIRTY_DAYS = 30 * 86400000;

        // Persist ferme corrections as we see them, so subsequent queries are fast.
        const fixPromises = [];
        let analyses = snap.docs.map(d => {
          const a = { id: d.id, ...d.data() };
          if (!a.type_analyse) a.type_analyse = "foliaire";
          if (!a.source) a.source = "manual";
          a.is_result_late = a.statut === "prelevee" && a.date_prelevement && (now - a.date_prelevement) > THREE_DAYS;
          const canonical = VARIETE_FERME_OVERRIDE[(a.variete || "").toUpperCase()];
          if (canonical && a.ferme !== canonical) {
            console.log(`ferme override: ${d.id} variete=${a.variete} ${a.ferme}→${canonical}`);
            a.ferme = canonical;
            fixPromises.push(d.ref.update({ ferme: canonical, updated_at: Date.now() }).catch(e => console.error("override persist failed", d.id, e.message)));
          }
          return a;
        });
        if (fixPromises.length) await Promise.all(fixPromises);
        if (ferme) analyses = analyses.filter(a => a.ferme === ferme);
        analyses.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        // parcelles_overdue was per-parcelle and couldn't credit AGQ imports
        // (which have parcelle: null, classified by ferme+variete instead).
        // The V5 AI panel now surfaces gaps contextually. Field kept for API back-compat.
        const parcelles_overdue = [];

        const counts = {
          demandees: analyses.filter(a => a.statut === "demandee").length,
          commandees: analyses.filter(a => a.statut === "commandee").length,
          prelevees: analyses.filter(a => a.statut === "prelevee").length,
          completees: analyses.filter(a => a.statut === "completee").length,
          en_retard: analyses.filter(a => a.is_result_late).length,
        };
        return res.json({ success: true, analyses, parcelles_overdue, counts });
      }

      if (action === "get-variete-contexte") {
        const { ferme, variete } = req.query;
        if (!ferme || !variete) return res.status(400).json({ success: false, error: "ferme et variete requis" });
        const docId = `${ferme}_${(variete || "").toUpperCase().replace(/\s+/g, "_")}`;
        const doc = await db_firestore.collection("variete_contextes").doc(docId).get();
        return res.json({ success: true, contexte: doc.exists ? doc.data() : null });
      }

      if (action === "save-variete-contexte" && req.method === "POST") {
        const { ferme, variete, contexte_general, updated_by } = req.body;
        if (!ferme || !variete) return res.status(400).json({ success: false, error: "ferme et variete requis" });
        const docId = `${ferme}_${(variete || "").toUpperCase().replace(/\s+/g, "_")}`;
        await db_firestore.collection("variete_contextes").doc(docId).set({
          ferme, variete, contexte_general: contexte_general || "",
          updated_at: Date.now(), updated_by: updated_by || {},
        }, { merge: true });
        return res.json({ success: true });
      }

      if (action === "create-analyse-foliaire" && req.method === "POST") {
        const { ferme, parcelle, culture, type_analyse, variete, phenologie, note_demande, photo_base64, photo_filename, created_by } = req.body;
        if (!ferme) return res.status(400).json({ success: false, error: "ferme requis" });
        const numero = await getNextNumber("analyse_foliaire", "AF");
        const now = Date.now();
        const cultureInferred = culture || (parcelle && (parcelle.toLowerCase().includes("hass") || parcelle.toLowerCase().includes("fuerte")) ? "Avocatier" : parcelle && parcelle.toLowerCase().includes("framboise") ? "Framboise" : parcelle ? "Myrtille" : null);
        const data = {
          numero, ferme,
          parcelle: parcelle || null,
          culture: cultureInferred,
          type_analyse: type_analyse || "foliaire",
          variete: variete || null,
          phenologie: phenologie || null,
          source: "manual",
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

      // ========== SURVEILLANCE AGRO — observation terrain (photos) ==========

      if (action === "create-observation-terrain" && req.method === "POST") {
        const { ferme, variete, culture, note, photos, created_by } = req.body;
        if (!ferme) return res.status(400).json({ success: false, error: "ferme requis" });
        if (!variete) return res.status(400).json({ success: false, error: "variete requis" });
        if (!photos || !photos.length) return res.status(400).json({ success: false, error: "au moins 1 photo requise" });
        if (photos.length > 5) return res.status(400).json({ success: false, error: "max 5 photos" });

        const now = Date.now();
        const docData = {
          type_analyse: "observation_terrain",
          ferme,
          variete,
          culture: culture || null,
          parcelle: null,
          date_analyse: now,
          statut: "completee",
          source: "manual",
          photo_urls: [],
          note_demande: note || "",
          parsed_values: {},
          recommandations_ia: [],
          terrain_raw: note || "",
          created_by: created_by || { name: "unknown" },
          created_at: now,
          updated_at: now,
        };
        const ref = await db_firestore.collection("analyses_foliaires").add(docData);

        const photoUrls = [];
        for (let i = 0; i < photos.length; i++) {
          const p = photos[i];
          const cleanBase64 = (p.base64 || "").replace(/^data:image\/\w+;base64,/, "");
          if (!cleanBase64) continue;
          const buffer = Buffer.from(cleanBase64, "base64");
          const storagePath = `analyses_foliaires/${ref.id}/photos/${now}_${i}.jpg`;
          const file = bucket.file(storagePath);
          await file.save(buffer, { metadata: { contentType: "image/jpeg" } });
          const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
          photoUrls.push({
            url,
            storage_path: storagePath,
            caption: p.caption || "",
            taken_at: now,
            location: p.location || null,
          });
        }

        const firstGeo = photoUrls.find(p => p.location);
        const updateData = { photo_urls: photoUrls, updated_at: Date.now() };
        if (firstGeo) updateData.location = firstGeo.location;
        await ref.update(updateData);
        return res.json({ success: true, id: ref.id, photo_count: photoUrls.length });
      }

      if (action === "import-analyse-agq" && req.method === "POST") {
        const { pdf_base64, filename, source_email, created_by } = req.body;
        if (!pdf_base64) return res.status(400).json({ success: false, error: "pdf_base64 requis" });
        const { parseAgqPdf } = require("./agqParser");
        const pdfBuffer = Buffer.from(pdf_base64.replace(/^data:application\/pdf;base64,/, ""), "base64");

        let parsed;
        try {
          parsed = await parseAgqPdf(pdfBuffer, {
            subject: source_email?.subject || "",
            attachmentName: filename || "",
          });
        } catch (e) {
          return res.status(500).json({ success: false, error: "Parse AGQ: " + e.message });
        }

        if (!parsed.ferme) {
          return res.status(422).json({ success: false, error: "Ferme non détectée dans le PDF", parsed });
        }

        // Idempotence: skip if we already imported this exact attachment.
        if (source_email?.messageId && filename) {
          const dup = await db_firestore.collection("analyses_foliaires")
            .where("source_email.messageId", "==", source_email.messageId)
            .where("source_email.attachment_name", "==", filename)
            .limit(1)
            .get();
          if (!dup.empty) {
            return res.json({ success: true, skipped: true, id: dup.docs[0].id, reason: "duplicate" });
          }
        }

        const numero = await getNextNumber("analyse_foliaire", "AF");
        const now = Date.now();
        const receivedAt = source_email?.received_at ? new Date(source_email.received_at).getTime() : now;
        const data = {
          numero,
          ferme: parsed.ferme,
          parcelle: null,
          culture: parsed.culture,
          type_analyse: parsed.type_analyse,
          variete: parsed.variete,
          propriete_raw: parsed.propriete_raw,
          terrain_raw: parsed.terrain_raw,
          client_raw: parsed.client_raw,
          phenologie: parsed.phenologie,
          parsed_values: parsed.parsed_values || {},
          parsed_header_line: parsed.parsed_header_line || null,
          source: "email_agq",
          source_email: {
            messageId: source_email?.messageId || null,
            subject: source_email?.subject || null,
            from: source_email?.from || null,
            received_at: receivedAt,
            attachment_name: filename || null,
          },
          statut: "completee",
          date_demande: receivedAt,
          date_prelevement: parsed.date_analyse || receivedAt,
          date_resultat: receivedAt,
          date_analyse: parsed.date_analyse || null,
          bdc_id: null,
          photo_parcelle_url: null,
          scan_resultat_url: null,
          note_demande: "",
          recommandations_ia: [],
          history: [{ action: "import_email_agq", by: created_by || { name: "system" }, at: now, comment: filename || "" }],
          created_by: created_by || { name: "system" },
          created_at: now,
          updated_at: now,
        };
        const ref = await db_firestore.collection("analyses_foliaires").add(data);

        // Upload the PDF as the analysis result scan.
        try {
          const safeName = (filename || "agq_report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
          const storagePath = `analyses_foliaires/${ref.id}/${safeName}`;
          const file = bucket.file(storagePath);
          await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
          const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
          await ref.update({ scan_resultat_url: url });
          data.scan_resultat_url = url;
        } catch (e) {
          console.error("Upload PDF AGQ:", e.message);
        }

        return res.json({ success: true, id: ref.id, numero, parsed });
      }

      if (action === "generate-reco-foliaire" && req.method === "POST") {
        const result = await generateRecoForAnalyse(req.body.id, req.body);
        if (result.success) return res.json(result);
        return res.json(result);
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

      // ========== SCAN BON D'APPORT (AI-powered production bon scanning) ==========

      if (action === "scan-bon-apport" && req.method === "POST") {
        const { scan_base64, filename, created_by } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.jpg").split(".").pop().toLowerCase() || "jpg";
        const ts = Date.now();
        const storagePath = `scans/bons_apport/${ts}_${filename || "scan." + ext}`;
        const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        const messageContent = [
          { type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } },
          { type: "text", text: `Tu es un assistant spécialisé dans la lecture de bons d'apport de production agricole pour Berry Good Farms (culture de framboise et myrtille au Maroc).

DATE IMPORTANTE: Nous sommes en ${new Date().toISOString().split('T')[0]}. Les bons scannés datent généralement de J-1 ou J-2 (hier ou avant-hier). L'année est TOUJOURS 2026 (saison 2025-2026). Si tu lis une date ambiguë, utilise 2026 comme année.

Extrais les données du bon d'apport en JSON strict:
{
  "numero_bon": "..." (numéro du bon d'apport, souvent en haut du document en rouge),
  "date": "YYYY-MM-DD" (date de récolte — sur le bon elle est au format français JJ/MM/AAAA, convertis en YYYY-MM-DD. L'année est 2026),
  "ferme": "F1" ou "F5" (IMPORTANT: détermine la ferme par le secteur/parcelle: S1-S7 et GG → F1, S8, S8-1, S8-2, S9, S10, S13 → F5. Aussi par N° Camion: 172 → F1, 195 → F5. Cherche dans "Producteur / Ferme" ou "Parcelle / Bloc"),
  "variete": "..." (désignation EXACTE du bloc — utilise une de ces valeurs: "MARAVILLA GG F1", "S10 YAZMIN CUT BACK F5", "S9 REYNA F5", "CORINA MYRTILLE S8", "BREEZE MYRTILLE S8-2", "CASCADE MYRTILLE S8-1". Identifie la variété et la ferme pour choisir la bonne désignation),
  "parcelle": "..." (parcelle/bloc si mentionné),
  "lignes": [
    {
      "description": "..." (type d'unité de livraison, ex: "Carton Driscoll's Barquette en quarton 10x300g PPE". Pour Marché Local, inclure le nom de la variété si visible),
      "variete": "..." (variété de cette ligne si identifiable — utiliser les mêmes désignations que le champ variete ci-dessus. Important pour les bons Marché Local multi-variétés),
      "nombre_colis": 0 (nombre dans la colonne "Nombre"),
      "poids_unitaire_kg": 0 (quantité de produit par unité de chargement en kg, ex: 3 pour "163 x3"),
      "quantite_kg": 0 (quantité totale en kg pour cette ligne)
    }
  ],
  "poids_kg": 0 (poids TOTAL de toutes les lignes en kg — somme des quantite_kg),
  "nombre_colis_total": 0 (somme de tous les nombre_colis),
  "type_vente": "Export" ou "Marché Local" (si mentionné, sinon "Export"),
  "client": "..." (nom du client si mentionné, sinon "Driscoll's" pour export),
  "semaine": "..." (numéro de semaine si mentionné, sinon null),
  "notes": "..." (informations supplémentaires, traitement phytosanitaire, etc.)
}

IMPORTANT:
- Retourne UNIQUEMENT le JSON, sans texte avant ou après
- Le numéro de bon est crucial — cherche-le attentivement (souvent en rouge en haut)
- Lis CHAQUE ligne du tableau "Type d'unité de livraison" séparément
- Vérifie que la somme des quantite_kg des lignes = poids_kg total
- Pour les bons "Marché Local", un même bon peut contenir PLUSIEURS variétés — identifie la variété de chaque ligne et remplis le champ "variete" de chaque ligne
- Si un champ n'est pas lisible, mets null` }
        ];

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 1500, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-bon-apport", modelId, e.message);
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

        return res.json({ success: true, scan_url, analysis });
      }

      // ========== SCAN FICHE IRRIGATION (AI-powered irrigation sheet scanning) ==========

      if (action === "scan-irrigation-sheet" && req.method === "POST") {
        const { scan_base64, filename } = req.body;
        if (!scan_base64) return res.status(400).json({ success: false, error: "scan_base64 requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "Clé API Anthropic non configurée" });

        // 1) Upload scan to Firebase Storage
        const cleanBase64 = scan_base64.replace(/^data:(image\/\w+|application\/pdf);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const ext = (filename || "scan.jpg").split(".").pop().toLowerCase() || "jpg";
        const ts = Date.now();
        const storagePath = `scans/irrigation/${ts}_${filename || "scan." + ext}`;
        const contentType = `image/${ext === "jpg" ? "jpeg" : ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType } });
        const scan_url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Prepare content for Claude AI
        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });
        const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
        const messageContent = [
          { type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 } },
          { type: "text", text: `Tu es un assistant spécialisé dans la lecture de fiches d'irrigation manuscrites de Berry Good Farms (culture de framboise et myrtille au Maroc).

La fiche contient un tableau avec des lectures d'irrigation relevées par les stationnaires.
L'en-tête indique généralement la ferme (F1 ou F5) et la parcelle (ex: CORINA MYRTILLE S8).
Le tableau contient plusieurs lignes, chaque ligne correspondant à un relevé à une date/heure donnée.

Pour chaque ligne, on trouve :
- Heure de début
- Parcelle / secteur
- Pour chaque POINT d'irrigation (jusqu'à 4 points) : EC (conductivité électrique en mS/cm), pH, Volume (en litres)
- Pour chaque point de DRAINAGE correspondant : EC, pH, Volume (en % ou litres)

Les dates peuvent être inscrites en ligne ou en en-tête de section (ex: "14/03/2026" ou "14/ 03/ 2026").
L'année est TOUJOURS 2025 ou 2026 (saison 2025-2026).

Extrais TOUTES les lignes du tableau. Retourne un JSON strict :
{
  "ferme": "F1" ou "F5",
  "parcelle": "nom exact de la parcelle tel qu'inscrit sur la fiche",
  "lectures": [
    {
      "date": "YYYY-MM-DD",
      "heure": "HH:MM",
      "duree": 0,
      "points": [
        { "ec": 1.8, "ph": 6.2, "volume": 12.5 },
        { "ec": 1.9, "ph": 6.1, "volume": 11.8 }
      ],
      "drainage": [
        { "ec": 2.5, "ph": 5.8, "volume": 22 },
        { "ec": 2.6, "ph": 5.7, "volume": 25 }
      ]
    }
  ]
}

IMPORTANT:
- Retourne UNIQUEMENT le JSON, sans texte avant ou après
- Lis CHAQUE ligne du tableau, même si l'écriture est difficile à lire
- Les valeurs EC sont généralement entre 0.5 et 5.0 mS/cm
- Les valeurs pH sont généralement entre 4.0 et 8.0
- Si la durée n'est pas indiquée, mets 0
- Si une valeur n'est pas lisible, mets null
- Fais attention aux séparateurs décimaux : virgule ou point
- Les dates en en-tête s'appliquent à toutes les lignes en dessous jusqu'à la prochaine date` }
        ];

        // 3) Call Claude
        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 4000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("Erreur modèle scan-irrigation", modelId, e.message);
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

        return res.json({ success: true, scan_url, analysis });
      }

      // ========== ANALYSE IRRIGATION (AI-powered agronomic analysis) ==========

      if (action === "analyse-irrigation" && req.method === "POST") {
        const { readings, ferme, parcelle } = req.body;
        if (!readings || !readings.length) return res.status(400).json({ success: false, error: "readings requis" });

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.json({ success: true, analyse: "⚠️ Clé API Anthropic non configurée." });

        // Build data summary for Claude
        const dataLines = readings.map(r => {
          const ptsEc = (r.points || []).filter(p => p.ec > 0).map(p => p.ec);
          const ptsPh = (r.points || []).filter(p => p.ph > 0).map(p => p.ph);
          const ptsVol = (r.points || []).filter(p => p.volume > 0).map(p => p.volume);
          const drEc = (r.drainage || []).filter(d => d.ec > 0).map(d => d.ec);
          const drPh = (r.drainage || []).filter(d => d.ph > 0).map(d => d.ph);
          const drVol = (r.drainage || []).filter(d => d.volume > 0).map(d => d.volume);
          const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 'N/A';
          return `${r.date} ${r.heure || ''} | Parcelle: ${r.parcelleLabel || r.parcelle} | Durée: ${r.duree || 0}min | Apport EC=${avg(ptsEc)} pH=${avg(ptsPh)} Vol=${avg(ptsVol)}L | Drainage EC=${avg(drEc)} pH=${avg(drPh)} Vol=${avg(drVol)}%`;
        }).join('\n');

        const Anthropic = require("@anthropic-ai/sdk");
        const client = new Anthropic({ apiKey });

        const prompt = `Tu es un ingénieur agronome spécialisé dans l'irrigation des cultures de framboise et myrtille sous serre au Maroc (Berry Good Farms).

Voici les données d'irrigation des derniers jours pour la ferme ${ferme || 'N/A'}${parcelle ? ', parcelle ' + parcelle : ''} :

${dataLines}

Analyse ces données comme le ferait un expert en irrigation et fournis :

## 1. Diagnostic EC (Conductivité Électrique)
- EC apport vs EC drainage : le ratio est-il dans la norme (drainage/apport < 1.5) ?
- Tendance : l'EC dérive-t-elle ? Accumulation saline ?
- Recommandation : faut-il ajuster la concentration de la solution nutritive ?

## 2. Diagnostic pH
- Le pH est-il dans la plage optimale (5.5-6.5 pour framboise, 4.5-5.5 pour myrtille) ?
- Écart pH apport vs drainage : y a-t-il un problème de tampon du substrat ?
- Recommandation : ajustement acide/base nécessaire ?

## 3. Drainage
- Le % de drainage est-il dans la cible (20-30%) ?
- Est-il régulier ou très variable ?
- Recommandation : ajuster le volume par irrigation ?

## 4. Fréquence & Volume
- Le nombre d'irrigations par jour est-il adapté au stade et à la saison ?
- Le volume par cycle est-il cohérent ?
- Recommandation : modifier la fréquence ou le volume ?

## 5. Actions Prioritaires (3 max)
Liste les 3 actions les plus urgentes à prendre, classées par priorité.

Réponds en français, de manière concise et actionnable. Utilise des émojis pour les niveaux d'alerte :
🟢 = OK, 🟡 = À surveiller, 🔴 = Action urgente`;

        let response;
        for (const modelId of ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]) {
          try {
            response = await client.messages.create({ model: modelId, max_tokens: 2000, messages: [{ role: "user", content: prompt }] });
            break;
          } catch (e) {
            console.error("Erreur modèle analyse-irrigation", modelId, e.message);
            if (modelId === "claude-opus-4-20250514") throw e;
          }
        }

        const analyse = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        return res.json({ success: true, analyse });
      }

      // ========== STOCK MOVEMENTS (Gestion de stock) ==========

      // --- Helper: update stock_balances atomically ---
      async function updateStockBalance(lieuType, lieuId, articleRef, articleNom, unite, delta) {
        const balanceId = `${lieuType}_${lieuId}_${articleRef}`.replace(/\s+/g, '_');
        const balRef = db_firestore.collection("stock_balances").doc(balanceId);
        await db_firestore.runTransaction(async (t) => {
          const snap = await t.get(balRef);
          const current = snap.exists ? (snap.data().balance || 0) : 0;
          const newBalance = Math.round((current + delta) * 100) / 100;
          t.set(balRef, {
            lieu_type: lieuType, lieu_id: lieuId,
            article_ref: articleRef, article_nom: articleNom,
            unite: unite || "kg", balance: newBalance,
            updated_at: Date.now()
          }, { merge: true });
        });
      }

      // --- Helper: apply stock impact for a validated movement ---
      async function applyStockImpact(movement) {
        const promises = [];
        for (const item of (movement.items || [])) {
          const ref = item.article_ref || item.article || "";
          const nom = item.article_nom || item.article || "";
          const qty = parseFloat(item.quantite) || 0;
          const unite = item.unite || "kg";
          if (qty <= 0) continue;
          // Decrease source
          if (movement.lieu_source && movement.lieu_source.id) {
            promises.push(updateStockBalance(movement.lieu_source.type, movement.lieu_source.id, ref, nom, unite, -qty));
          }
          // Increase destination (not for parcelles or external)
          if (movement.lieu_destination && movement.lieu_destination.id && movement.lieu_destination.type !== "parcelle") {
            promises.push(updateStockBalance(movement.lieu_destination.type, movement.lieu_destination.id, ref, nom, unite, qty));
          }
        }
        await Promise.all(promises);
      }

      // --- Helper: determine chef profile for a ferme ---
      function getChefProfileForFerme(ferme) {
        if (ferme === "F1") return "chef_f1";
        if (ferme === "F5") return "chef_f5";
        if (["F2", "F3", "F4", "F6"].includes(ferme)) return "chef_avo";
        return null;
      }

      // --- Helper: check if movement needs multi-level validation ---
      function movementNeedsMultiValidation(type) {
        return type === "reception" || type === "sortie";
      }

      // --- UPLOAD SCAN for stock movements ---
      if (action === "upload-scan" && req.method === "POST") {
        const { file_base64, filename, contentType } = req.body || {};
        if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
        const buffer = Buffer.from(file_base64.replace(/^data:[^;]+;base64,/, ""), "base64");
        const ext = (filename || "scan.jpg").split(".").pop() || "jpg";
        const storagePath = `stock_scans/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType: contentType || `image/${ext}` } });
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        return res.json({ success: true, url: publicUrl });
      }

      // --- IMPORT CANEVA STOCK (workflow Achats → validation Finance) ---
      if (action === "import-caneva-stock" && req.method === "POST") {
        const XLSX = require("xlsx");
        const { mode, file_base64, request_id, motif, requested_by, reviewed_by } = req.body || {};
        const IMPORT_SOURCE = stockCaneva.IMPORT_SOURCE;
        const COL = "stock_caneva_imports";
        const ROLE_CONTROLE = ["finance", "dg"];
        const BATCH = 450;

        const actor = mode === "approve" || mode === "reject" || mode === "restore"
          ? (reviewed_by || {})
          : (requested_by || {});

        // ---- helpers ----
        async function commitOps(ops) {
          for (let i = 0; i < ops.length; i += BATCH) {
            const batch = db_firestore.batch();
            for (const op of ops.slice(i, i + BATCH)) {
              if (op.type === "set") batch.set(op.ref, op.data, op.options || {});
              else if (op.type === "delete") batch.delete(op.ref);
            }
            await batch.commit();
          }
        }
        function decodeB64(b64) {
          return Buffer.from(String(b64 || "").replace(/^data:[^;]+;base64,/, ""), "base64");
        }
        // Load all CANEVA movements once (for shrink count + per-day diff)
        async function loadCaneva() {
          const snap = await db_firestore.collection("stock_movements").where("import_source", "==", IMPORT_SOURCE).get();
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        // Parse + guard + per-day diff against existing CANEVA ledger
        async function analyze(buffer) {
          const plan = stockCaneva.parseWorkbook(buffer, XLSX);
          const allCaneva = await loadCaneva();
          const dates = new Set(plan.movements.map((m) => m.date).filter(Boolean));
          const existing = allCaneva.filter((m) => dates.has(m.date));
          const guard = stockCaneva.evaluateGuard(plan, { currentMovementCount: allCaneva.length });
          const diff = stockCaneva.computeDayDiff(plan, existing);
          const summary = stockCaneva.buildDrySummary(plan, guard, diff);
          return { plan, guard, diff, summary, allCaneva };
        }
        // Build a stored stock_movement doc from a parsed plan movement
        function buildMovementDoc(m) {
          const needsMulti = m.type === "reception" || m.type === "sortie";
          const validations = { magasinier: { by: "import_caneva", name: "Import CANEVA", at: Date.now() } };
          if (needsMulti) {
            validations.achats = { by: "import_caneva", name: "Import CANEVA", at: Date.now() };
            validations.chef = { by: "import_caneva", name: "Import CANEVA", at: Date.now() };
          }
          return {
            numero: m.numero, type: m.type, date: m.date,
            lieu_source: m.lieu_source || null, lieu_destination: m.lieu_destination || null,
            ferme: m.ferme || "", items: m.items || [],
            ref_bl_fournisseur: m.ref_bl_fournisseur || "", fournisseur_nom: m.fournisseur_nom || null,
            reception_libre: !!m.reception_libre, reception_libre_motif: m.reception_libre_motif || "",
            ref_bon_physique: m.ref_bon_physique || "", sortie_type: m.sortie_type || null,
            numero_source: m.numero_source || "", bdc_id: null, bl_id: null, scan_url: null,
            status: needsMulti ? "valide_chef" : "valide_mag",
            validations, rejection: null,
            import_source: IMPORT_SOURCE,
            created_by: { userId: "import_caneva", name: "Import CANEVA" },
            imported_by: { userId: actor.userId || "", name: actor.name || "", profileId: actor.profileId || "" },
            created_at: Date.now(), updated_at: Date.now(),
          };
        }
        // Rebuild ALL stock_balances from inventory baseline + full movement ledger
        async function rebuildBalances(balancesInit) {
          const bal = new Map(); // balanceId -> {fields, balance}
          const keyOf = (lt, li, ref) => `${lt}_${li}_${ref}`.replace(/\s+/g, "_");
          const add = (lt, li, ref, nom, unite, delta) => {
            const k = keyOf(lt, li, ref);
            const cur = bal.get(k) || { lieu_type: lt, lieu_id: li, article_ref: ref, article_nom: nom, unite: unite || "kg", balance: 0 };
            cur.balance = Math.round((cur.balance + delta) * 100) / 100;
            if (nom) cur.article_nom = nom;
            bal.set(k, cur);
          };
          for (const b of balancesInit) add(b.lieu_type, b.lieu_id, b.article_ref, b.article_nom, b.unite, b.balance);
          const allMovSnap = await db_firestore.collection("stock_movements").get();
          for (const doc of allMovSnap.docs) {
            for (const d of stockCaneva.movementDelta(doc.data())) add(d.lieu_type, d.lieu_id, d.article_ref, d.article_nom, d.unite, d.delta);
          }
          // Write computed balances; delete stale ones absent from the rebuild
          const existingBalSnap = await db_firestore.collection("stock_balances").get();
          const ops = [];
          const seen = new Set();
          for (const [k, v] of bal) {
            seen.add(k);
            ops.push({ type: "set", ref: db_firestore.collection("stock_balances").doc(k), data: { ...v, updated_at: Date.now() } });
          }
          for (const doc of existingBalSnap.docs) {
            if (!seen.has(doc.id)) ops.push({ type: "delete", ref: doc.ref });
          }
          await commitOps(ops);
        }
        // Execute the per-day import for the impacted dates
        async function executeImport(plan, diff, allCaneva) {
          const impacted = stockCaneva.impactedDates(diff);
          const ops = [];
          // 1. delete impacted-day CANEVA movements (strictly import_source + date)
          for (const m of allCaneva) {
            if (impacted.has(m.date)) ops.push({ type: "delete", ref: db_firestore.collection("stock_movements").doc(m.id) });
          }
          // 2. upsert articles from the workbook
          for (const art of plan.articlesToCreate) {
            ops.push({
              type: "set",
              ref: db_firestore.collection("articles_catalog").doc(art.reference),
              data: {
                reference: art.reference, nom: art.nom, unite: art.unite,
                categorie: art.categorie, type: "Stockable", active: true,
                import_source: IMPORT_SOURCE, updated_at: Date.now(),
              },
              options: { merge: true },
            });
          }
          // 3. create movements for impacted dates
          for (const m of plan.movements) {
            if (impacted.has(m.date)) ops.push({ type: "set", ref: db_firestore.collection("stock_movements").doc(), data: buildMovementDoc(m) });
          }
          await commitOps(ops);
          // 4. replace CANEVA cost docs (derived wholesale from the workbook)
          const costSnap = await db_firestore.collection("consumption_costs_by_variety").where("import_source", "==", IMPORT_SOURCE).get();
          const costOps = costSnap.docs.map((d) => ({ type: "delete", ref: d.ref }));
          for (const [code, agg] of Object.entries(plan.costsByVariety)) {
            costOps.push({ type: "set", ref: db_firestore.collection("consumption_costs_by_variety").doc(code), data: { ...agg, import_source: IMPORT_SOURCE, updated_at: Date.now() } });
          }
          await commitOps(costOps);
          // 5. rebuild balances from full ledger
          await rebuildBalances(plan.balancesInit);
          return { impacted_dates: [...impacted].sort() };
        }
        // Archive uploaded workbook to Storage, keep only the last 7 files
        async function storeFile(buffer) {
          const path = `stock_caneva_imports/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.xlsx`;
          await bucket.file(path).save(buffer, { metadata: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } });
          return path;
        }
        async function pruneArchive() {
          const snap = await db_firestore.collection(COL).where("file_pruned", "==", false).get();
          const withFile = snap.docs
            .map((d) => ({ id: d.id, ref: d.ref, ...d.data() }))
            .filter((d) => d.file_path)
            .sort((a, b) => (b.requested_at || 0) - (a.requested_at || 0));
          for (const d of withFile.slice(7)) {
            try { await bucket.file(d.file_path).delete(); } catch (_) {}
            await d.ref.update({ file_pruned: true });
          }
        }

        try {
          // ===== PREVIEW (achats) — aucune écriture =====
          if (mode === "preview") {
            if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
            const { summary } = await analyze(decodeB64(file_base64));
            if (summary.guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: summary.guard.reasons, summary });
            return res.json({ success: true, summary });
          }

          // ===== APPLY (achats) — uniquement si aucun jour modifié =====
          if (mode === "apply") {
            if (actor.profileId !== "achats") return res.status(403).json({ success: false, error: "Réservé au rôle Achats" });
            if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
            const buffer = decodeB64(file_base64);
            const { plan, guard, diff, summary, allCaneva } = await analyze(buffer);
            if (guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: guard.reasons, summary });
            if (diff.jours_modifies.length > 0) return res.json({ success: false, error: "Validation Finance requise (jours déjà importés)", summary });
            const exec = await executeImport(plan, diff, allCaneva);
            const file_path = await storeFile(buffer);
            const docRef = await db_firestore.collection(COL).add({
              status: "importe", file_path, file_pruned: false, filename: req.body.filename || "canevas.xlsx",
              summary, jours_nouveaux: diff.jours_nouveaux, jours_modifies: diff.jours_modifies,
              prior_import_existed: allCaneva.length > 0, requested_by: actor, requested_at: Date.now(),
              reviewed_by: null, reviewed_at: null, motif_rejet: null,
              history: [{ action: "apply", by: actor, at: Date.now() }],
            });
            await pruneArchive();
            return res.json({ success: true, request_id: docRef.id, status: "importe", summary, ...exec });
          }

          // ===== REQUEST (achats) — jours modifiés → file d'attente Finance =====
          if (mode === "request") {
            if (actor.profileId !== "achats") return res.status(403).json({ success: false, error: "Réservé au rôle Achats" });
            if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });
            const buffer = decodeB64(file_base64);
            const { diff, summary, allCaneva } = await analyze(buffer);
            if (summary.guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: summary.guard.reasons, summary });
            if (diff.jours_modifies.length === 0) return res.json({ success: false, error: "Aucun jour modifié — utilisez l'import direct", summary });
            const file_path = await storeFile(buffer);
            const docRef = await db_firestore.collection(COL).add({
              status: "en_attente_finance", file_path, file_pruned: false, filename: req.body.filename || "canevas.xlsx",
              summary, jours_nouveaux: diff.jours_nouveaux, jours_modifies: diff.jours_modifies,
              prior_import_existed: allCaneva.length > 0, requested_by: actor, requested_at: Date.now(),
              reviewed_by: null, reviewed_at: null, motif_rejet: null,
              history: [{ action: "request", by: actor, at: Date.now() }],
            });
            await pruneArchive();
            await dispatchNotification({
              type: "caneva_import_request", profiles: ["finance"], channels: ["in_app"],
              data: { message: `Import canevas Stock à valider — ${diff.jours_modifies.length} jour(s) seront remplacés (demandé par ${actor.name || "Achats"})`, severity: "warning" },
              relatedDoc: `${COL}/${docRef.id}`,
            });
            return res.json({ success: true, request_id: docRef.id, status: "en_attente_finance", summary });
          }

          // ===== APPROVE / RESTORE (finance/dg) =====
          if (mode === "approve" || mode === "restore") {
            if (!ROLE_CONTROLE.includes(actor.profileId)) return res.status(403).json({ success: false, error: "Réservé à Finance/DG" });
            if (!request_id) return res.status(400).json({ success: false, error: "request_id requis" });
            const docRef = db_firestore.collection(COL).doc(request_id);
            const docSnap = await docRef.get();
            if (!docSnap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
            const reqDoc = docSnap.data();
            if (mode === "approve" && reqDoc.status !== "en_attente_finance") return res.status(400).json({ success: false, error: `Statut ${reqDoc.status} non approuvable` });
            if (reqDoc.file_pruned || !reqDoc.file_path) return res.status(400).json({ success: false, error: "Fichier archivé indisponible (élagué)" });
            const [buffer] = await bucket.file(reqDoc.file_path).download();
            const { plan, guard, diff, summary, allCaneva } = await analyze(buffer);
            if (guard.hardBlock) return res.json({ success: false, error: "Classeur invalide", reasons: guard.reasons, summary });
            const exec = await executeImport(plan, diff, allCaneva);
            const history = (reqDoc.history || []).concat([{ action: mode, by: actor, at: Date.now() }]);
            await docRef.update({ status: "importe", reviewed_by: actor, reviewed_at: Date.now(), summary, history });
            await dispatchNotification({
              type: "caneva_import_approved", profiles: ["achats"], channels: ["in_app"],
              data: { message: `Import canevas Stock ${mode === "restore" ? "restauré" : "approuvé"} par ${actor.name || "Finance"}`, severity: "info" },
              relatedDoc: `${COL}/${request_id}`,
            });
            return res.json({ success: true, status: "importe", summary, ...exec });
          }

          // ===== REJECT (finance/dg) =====
          if (mode === "reject") {
            if (!ROLE_CONTROLE.includes(actor.profileId)) return res.status(403).json({ success: false, error: "Réservé à Finance/DG" });
            if (!request_id) return res.status(400).json({ success: false, error: "request_id requis" });
            const docRef = db_firestore.collection(COL).doc(request_id);
            const docSnap = await docRef.get();
            if (!docSnap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
            const reqDoc = docSnap.data();
            if (reqDoc.status !== "en_attente_finance") return res.status(400).json({ success: false, error: `Statut ${reqDoc.status} non rejetable` });
            const history = (reqDoc.history || []).concat([{ action: "reject", by: actor, at: Date.now(), motif: motif || "" }]);
            await docRef.update({ status: "rejete", reviewed_by: actor, reviewed_at: Date.now(), motif_rejet: motif || "", history });
            await dispatchNotification({
              type: "caneva_import_rejected", profiles: ["achats"], channels: ["in_app"],
              data: { message: `Import canevas Stock rejeté par ${actor.name || "Finance"}${motif ? " : " + motif : ""}`, severity: "warning" },
              relatedDoc: `${COL}/${request_id}`,
            });
            return res.json({ success: true, status: "rejete" });
          }

          // ===== LIST (achats/finance) =====
          if (mode === "list") {
            const snap = await db_firestore.collection(COL).orderBy("requested_at", "desc").limit(50).get();
            const requests = snap.docs.map((d) => {
              const x = d.data();
              return {
                id: d.id, status: x.status, filename: x.filename, file_pruned: !!x.file_pruned,
                requested_by: x.requested_by, requested_at: x.requested_at,
                reviewed_by: x.reviewed_by, reviewed_at: x.reviewed_at, motif_rejet: x.motif_rejet,
                jours_nouveaux: x.jours_nouveaux || [], jours_modifies: x.jours_modifies || [],
                summary: x.summary || null,
              };
            });
            const pending = requests.filter((r) => r.status === "en_attente_finance").length;
            return res.json({ success: true, requests, pending });
          }

          return res.status(400).json({ success: false, error: "mode invalide" });
        } catch (e) {
          console.error("import-caneva-stock error:", e);
          return res.status(500).json({ success: false, error: e.message });
        }
      }

      // --- CREATE MOVEMENT ---
      if (action === "create-movement" && req.method === "POST") {
        const { type, date, lieu_source, lieu_destination, ferme, items, ref_bl_fournisseur,
          bdc_id, bl_id, reception_libre, reception_libre_motif, ref_bon_physique,
          sortie_type, scan_url, fournisseur_nom, beneficiaire, created_by,
          motif_rebut, justificatif_url } = req.body;

        if (!type || !items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: type, items[]" });
        }
        const validTypes = ["reception", "transfert", "consommation", "sortie"];
        if (!validTypes.includes(type)) {
          return res.status(400).json({ success: false, error: "Type invalide. Valeurs: " + validTypes.join(", ") });
        }
        if (type === "sortie" && !["retour_fournisseur", "pret", "rebut"].includes(sortie_type)) {
          return res.status(400).json({ success: false, error: "sortie_type requis: retour_fournisseur, pret, rebut" });
        }
        if (type === "reception" && reception_libre && !reception_libre_motif) {
          return res.status(400).json({ success: false, error: "Motif obligatoire pour réception libre" });
        }

        const prefixMap = { reception: "BR", transfert: "BT", consommation: "BCS", sortie: "BS" };
        const numType = "stock_" + type;
        const numero = await getNextNumber(numType, prefixMap[type]);

        const movItems = items.map((it) => ({
          article_ref: it.article_ref || it.article || "",
          article_nom: it.article_nom || it.article || "",
          quantite: parseFloat(it.quantite) || 0,
          unite: it.unite || "kg",
        }));

        const singleValidation = !!req.body.single_validation;
        const needsMulti = movementNeedsMultiValidation(type) && !singleValidation;
        // Reception/sortie need chef validation (valide_mag = en attente)
        // Transfert/consommation are auto-validated (stock impact applied immediately)
        // single_validation=true bypasses multi-step approval (used for bon d'entrée libre simple)
        const initialStatus = needsMulti ? "valide_mag" : "valide_chef";

        const movData = {
          numero, type,
          date: date || new Date().toISOString().split("T")[0],
          lieu_source: lieu_source || null,
          lieu_destination: lieu_destination || null,
          ferme: ferme || "",
          items: movItems,
          ref_bl_fournisseur: ref_bl_fournisseur || "",
          bdc_id: bdc_id || null,
          bl_id: bl_id || null,
          reception_libre: !!reception_libre,
          reception_libre_motif: reception_libre_motif || "",
          single_validation: singleValidation,
          ref_bon_physique: ref_bon_physique || "",
          sortie_type: sortie_type || null,
          scan_url: scan_url || null,
          fournisseur_nom: fournisseur_nom || null,
          beneficiaire: beneficiaire || null,
          motif_rebut: motif_rebut || null,
          justificatif_url: justificatif_url || null,
          status: initialStatus,
          validations: {
            magasinier: { by: (created_by || {}).userId || "", name: (created_by || {}).name || "", at: Date.now() }
          },
          rejection: null,
          created_by: created_by || {},
          created_at: Date.now(),
          updated_at: Date.now(),
        };

        const docRef = await db_firestore.collection("stock_movements").add(movData);

        // For single-validation types (transfert, consommation), apply stock impact immediately
        if (!needsMulti) {
          await applyStockImpact(movData);
        }

        return res.json({ success: true, id: docRef.id, numero, status: initialStatus });
      }

      // --- LIST MOVEMENTS ---
      if (action === "list-movements") {
        const { type, status, ferme: movFerme, limit: movLimit } = req.query;
        const lim = parseInt(movLimit || "200");
        let q = db_firestore.collection("stock_movements").orderBy("created_at", "desc").limit(lim);
        if (type) q = q.where("type", "==", type);
        if (status) q = q.where("status", "==", status);
        if (movFerme) q = q.where("ferme", "==", movFerme);
        const snap = await q.get();
        const movements = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, movements, count: movements.length });
      }

      // --- GET SINGLE MOVEMENT ---
      if (action === "get-movement") {
        const { id } = req.query;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        const snap = await db_firestore.collection("stock_movements").doc(id).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        return res.json({ success: true, movement: { id: snap.id, ...snap.data() } });
      }

      // --- VALIDATE MOVEMENT ---
      if (action === "validate-movement" && req.method === "POST") {
        const { id, role, validated_by } = req.body;
        if (!id || !role) return res.status(400).json({ success: false, error: "id et role requis" });

        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });
        const mov = snap.data();

        if (mov.status === "rejete") {
          return res.status(400).json({ success: false, error: "Mouvement rejeté, impossible de valider" });
        }

        // Determine expected validation sequence (chef valide directement depuis valide_mag)
        let nextStatus = null;
        if ((role === "chef_f1" || role === "chef_f5" || role === "chef_avo") && (mov.status === "valide_mag" || mov.status === "valide_achats")) {
          // Verify the chef matches the ferme
          const expectedChef = getChefProfileForFerme(mov.ferme);
          if (expectedChef && role !== expectedChef) {
            return res.status(403).json({ success: false, error: `Seul ${expectedChef} peut valider pour ${mov.ferme}` });
          }
          nextStatus = "valide_chef";
        } else {
          return res.status(400).json({ success: false, error: `Validation ${role} non applicable au statut ${mov.status}` });
        }

        const validationKey = "chef";
        await docRef.update({
          status: nextStatus,
          [`validations.${validationKey}`]: {
            by: (validated_by || {}).userId || "",
            name: (validated_by || {}).name || "",
            at: Date.now()
          },
          rejection: null,
          updated_at: Date.now()
        });

        // If fully validated, apply stock impact
        if (nextStatus === "valide_chef") {
          const updatedSnap = await docRef.get();
          await applyStockImpact(updatedSnap.data());
        }

        return res.json({ success: true, status: nextStatus });
      }

      // --- REJECT MOVEMENT ---
      if (action === "reject-movement" && req.method === "POST") {
        const { id, role, reason, rejected_by } = req.body;
        if (!id || !role || !reason) {
          return res.status(400).json({ success: false, error: "id, role et reason requis" });
        }

        const docRef = db_firestore.collection("stock_movements").doc(id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Mouvement introuvable" });

        await docRef.update({
          status: "rejete",
          rejection: {
            by: (rejected_by || {}).userId || "",
            name: (rejected_by || {}).name || "",
            role,
            reason,
            at: Date.now()
          },
          updated_at: Date.now()
        });

        return res.json({ success: true, status: "rejete" });
      }

      // --- GET CONSUMPTION COSTS BY VARIETY ---
      if (action === "get-consumption-costs") {
        const snap = await db_firestore.collection("consumption_costs_by_variety").get();
        const data = {};
        snap.docs.forEach(d => { data[d.id] = d.data(); });
        return res.json({ success: true, data });
      }

      // --- GET BALANCES ---
      if (action === "get-balances") {
        const { lieu_type, lieu_id } = req.query;
        let q = db_firestore.collection("stock_balances");
        if (lieu_type) q = q.where("lieu_type", "==", lieu_type);
        if (lieu_id) q = q.where("lieu_id", "==", lieu_id);
        const snap = await q.get();
        const balances = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        balances.sort((a, b) => (b.balance || 0) - (a.balance || 0));
        return res.json({ success: true, balances, count: balances.length });
      }

      // --- GET BALANCES AT DATE (recalcul historique) ---
      if (action === "get-balances-at-date") {
        const { date } = req.query;
        if (!date) return res.status(400).json({ success: false, error: "date requis (YYYY-MM-DD)" });

        const snap = await db_firestore.collection("stock_movements")
          .where("date", "<=", date)
          .get();

        const balMap = {};
        for (const doc of snap.docs) {
          const m = doc.data();
          const needsMulti = m.type === "reception" || m.type === "sortie";
          if (needsMulti && m.status !== "valide_chef") continue;
          if (!m.status) continue;

          for (const item of (m.items || [])) {
            const ref = item.article_ref || "";
            const nom = item.article_nom || "";
            const qty = parseFloat(item.quantite) || 0;
            const unite = item.unite || "kg";
            if (qty <= 0 || !ref) continue;

            if (m.lieu_source && m.lieu_source.id) {
              const key = `${m.lieu_source.type}|${m.lieu_source.id}|${ref}`;
              if (!balMap[key]) balMap[key] = { lieu_type: m.lieu_source.type, lieu_id: m.lieu_source.id, article_ref: ref, article_nom: nom, unite, balance: 0 };
              balMap[key].balance -= qty;
            }
            if (m.lieu_destination && m.lieu_destination.id && m.lieu_destination.type !== "parcelle") {
              const key = `${m.lieu_destination.type}|${m.lieu_destination.id}|${ref}`;
              if (!balMap[key]) balMap[key] = { lieu_type: m.lieu_destination.type, lieu_id: m.lieu_destination.id, article_ref: ref, article_nom: nom, unite, balance: 0 };
              balMap[key].balance += qty;
            }
          }
        }

        const balances = Object.values(balMap)
          .map(b => ({ ...b, balance: Math.round(b.balance * 100) / 100 }))
          .filter(b => Math.abs(b.balance) >= 0.01)
          .sort((a, b) => (b.balance || 0) - (a.balance || 0));

        return res.json({ success: true, balances, count: balances.length, date });
      }

      // --- GET STOCK LOCATIONS CONFIG ---
      if (action === "get-locations") {
        const snap = await db_firestore.collection("stock_config").doc("locations").get();
        if (!snap.exists) {
          // Initialize default locations
          const defaultLocations = {
            magasins: ["F1", "F2", "F5", "F6"],
            stations: ["Station F1", "Station F2", "Station F3", "Station F4", "Station F5", "Station F6"],
            parcelles: {
              "F1": ["S1 Maravilla", "S2 Yazmin", "S3 Maravilla Motte", "S4 Maravilla", "S5 Yazmin", "S7 Maravilla Motte", "P3-Framboise", "P5-Framboise B"],
              "F5": ["S8 Corina", "S9 Reyna", "S10 Yazmin", "S13 Yazmin", "P2-Framboise A", "P3-Framboise B"],
              "Avocatier": ["Avocat F2", "Avocat F4", "Avocat F5"]
            }
          };
          await db_firestore.collection("stock_config").doc("locations").set(defaultLocations);
          return res.json({ success: true, locations: defaultLocations });
        }
        return res.json({ success: true, locations: snap.data() });
      }

      // --- MIGRATE: auto-validate transfert/consommation stuck in valide_mag ---
      if (action === "migrate-auto-validate" && req.method === "POST") {
        const dryRun = req.body?.dry_run === true;
        const snap = await db_firestore.collection("stock_movements")
          .where("status", "==", "valide_mag")
          .get();
        const sampleByType = { transfert: [], consommation: [], reception: [], sortie: [] };
        const counts = { transfert: 0, consommation: 0, reception: 0, sortie: 0, autre: 0 };
        const toUpdate = [];
        for (const doc of snap.docs) {
          const m = doc.data();
          counts[m.type] = (counts[m.type] || 0) + 1;
          if (m.type === "transfert" || m.type === "consommation") {
            toUpdate.push(doc);
            if (sampleByType[m.type].length < 3) sampleByType[m.type].push({ numero: m.numero, date: m.date, ferme: m.ferme });
          }
        }
        if (dryRun) {
          return res.json({ success: true, dry_run: true, total_scanned: snap.size, counts, would_update: toUpdate.length, sample: sampleByType });
        }
        // Real apply
        let updated = 0;
        let batch = db_firestore.batch();
        let batchCount = 0;
        for (const doc of toUpdate) {
          batch.update(doc.ref, { status: "valide_chef", updated_at: Date.now() });
          updated++;
          batchCount++;
          if (batchCount >= 400) {
            await batch.commit();
            batch = db_firestore.batch();
            batchCount = 0;
          }
        }
        if (batchCount > 0) await batch.commit();
        return res.json({ success: true, updated, total_scanned: snap.size });
      }

      // --- GET PRICE HISTORY FOR AN ARTICLE ---
      if (action === "get-price-history") {
        const { article, date_from, date_to } = req.query;
        if (!article) return res.status(400).json({ success: false, error: "article requis" });

        let q = db_firestore.collection("stock_movements")
          .where("type", "==", "reception");
        if (date_from) q = q.where("date", ">=", date_from);
        if (date_to) q = q.where("date", "<=", date_to);
        const snap = await q.get();

        const articleLower = article.toLowerCase();
        const history = [];
        const bdcCache = {};

        for (const doc of snap.docs) {
          const mov = doc.data();
          if (mov.status === "rejete") continue;

          const item = (mov.items || []).find(i =>
            (i.article_nom || "").toLowerCase() === articleLower ||
            (i.article_ref || "").toLowerCase() === articleLower
          );
          if (!item) continue;

          // Try multiple price field names (legacy/import data uses prix_unitaire_ttc)
          let prix = parseFloat(item.prix_unitaire) || parseFloat(item.prix_unitaire_ttc) || parseFloat(item.prix_unitaire_ht) || null;
          let fournisseur = mov.fournisseur_nom || mov.fourn || null;
          let bdc_numero = null;

          if (!prix && mov.bdc_id) {
            if (!bdcCache[mov.bdc_id]) {
              const bdcSnap = await db_firestore.collection("purchase_orders").doc(mov.bdc_id).get();
              bdcCache[mov.bdc_id] = bdcSnap.exists ? bdcSnap.data() : null;
            }
            const bdc = bdcCache[mov.bdc_id];
            if (bdc) {
              const bdcItem = (bdc.items || []).find(i =>
                (i.article || "").toLowerCase() === articleLower
              );
              if (bdcItem) prix = parseFloat(bdcItem.prix_unitaire) || null;
              fournisseur = fournisseur || (bdc.fournisseur || {}).nom || null;
              bdc_numero = bdc.numero || null;
            }
          }

          if (prix && prix > 0) {
            history.push({
              date: mov.date, prix_unitaire: prix, quantite: item.quantite,
              unite: item.unite || "kg", fournisseur, bdc_numero, numero: mov.numero
            });
          }
        }

        history.sort((a, b) => a.date.localeCompare(b.date));
        return res.json({ success: true, article, history, count: history.length });
      }

      // --- PENDING VALIDATIONS (for chef badges) ---
      if (action === "pending-validations") {
        const { role: pendingRole } = req.query;
        let targetStatus = null;
        if (["chef_f1", "chef_f5", "chef_avo"].includes(pendingRole)) targetStatus = "valide_mag";
        else return res.status(400).json({ success: false, error: "Role invalide" });

        let q = db_firestore.collection("stock_movements").where("status", "==", targetStatus);
        // For chef, filter by ferme
        if (pendingRole === "chef_f1") q = q.where("ferme", "==", "F1");
        else if (pendingRole === "chef_f5") q = q.where("ferme", "==", "F5");
        else if (pendingRole === "chef_avo") q = q.where("ferme", "in", ["F2", "F3", "F4", "F6"]);

        const snap = await q.get();
        const pending = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, pending, count: pending.length });
      }

      // =============================================
      // IRRIGATION CONFIG & FORECAST
      // =============================================
      if (action === "get-irrigation-config") {
        const ferme = req.query.ferme || "F1";
        const doc = await db_firestore.collection("config_irrigation").doc(ferme).get();
        return res.json({ success: true, config: doc.exists ? doc.data() : null });
      }

      if (action === "save-irrigation-config" && req.method === "POST") {
        const { ferme, parcelles, updated_by } = req.body;
        if (!ferme || !parcelles) return res.status(400).json({ success: false, error: "ferme et parcelles requis" });
        await db_firestore.collection("config_irrigation").doc(ferme).set({
          ferme, parcelles, updated_by: updated_by || "unknown", updated_at: Date.now(),
        }, { merge: true });
        return res.json({ success: true });
      }

      if (action === "get-irrigation-forecast") {
        const ferme = req.query.ferme || "F1";
        const coords = METEO_FERMES[ferme] || METEO_FERMES.F1;

        // 1. Get irrigation config
        const configDoc = await db_firestore.collection("config_irrigation").doc(ferme).get();
        const irriConfig = configDoc.exists ? configDoc.data() : null;

        // 2. Get 7-day outdoor forecast
        const forecast = await fetchMeteoForecast7d(coords.lat, coords.lon);

        // 3. Get climat model (indoor prediction)
        const modelDoc = await db_firestore.collection("climat_models").doc(ferme + "_tunnel").get();
        const model = modelDoc.exists ? modelDoc.data() : null;

        // 4. Get latest soil analyses for this farm
        const soilSnap = await db_firestore.collection("analyses_foliaires")
          .where("ferme", "==", ferme)
          .where("type_analyse", "==", "sol")
          .where("statut", "==", "completee")
          .orderBy("date_resultat", "desc").limit(3).get();
        const soilAnalyses = soilSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // 5. Build indoor forecast using model
        let indoorForecast = [];
        if (model && model.coefficients && forecast.length > 0) {
          const c = model.coefficients;
          indoorForecast = forecast.map(day => {
            const tmaxIn = c.tmax ? Math.round((c.tmax.a * day.tmax + c.tmax.b) * 10) / 10 : day.tmax;
            const tminIn = c.tmin ? Math.round((c.tmin.a * day.tmin + c.tmin.b) * 10) / 10 : day.tmin;
            const hrIn = c.hr ? Math.min(100, Math.max(20, Math.round(c.hr.a * (day.humidity || 60) + c.hr.b))) : day.humidity || 60;
            const tMean = (tmaxIn + tminIn) / 2;
            const esat = 0.6108 * Math.exp((17.27 * tMean) / (tMean + 237.3));
            const vpd = Math.round(esat * (1 - hrIn / 100) * 100) / 100;
            return { date: day.date, tmax: tmaxIn, tmin: tminIn, hr: hrIn, vpd, eto_outdoor: day.eto, precip: day.precip, radiation: day.radiation };
          });
        }

        // 6. Compute irrigation recommendations per parcelle
        const parcelles = irriConfig ? irriConfig.parcelles || {} : {};
        const recommendations = {};
        const todayForecast = forecast.length > 0 ? forecast[0] : null;

        let soilCE = null;
        if (soilAnalyses.length > 0 && soilAnalyses[0].parsed_values) {
          const ce = soilAnalyses[0].parsed_values.CE || soilAnalyses[0].parsed_values["C.E."];
          if (ce) soilCE = parseFloat(ce);
        }

        for (const [parcName, parcConfig] of Object.entries(parcelles)) {
          if (!todayForecast) continue;
          const eto = todayForecast.eto || 4;
          const kc = parcConfig.kc || 0.85;
          const coeffTunnel = parcConfig.coeff_tunnel || (parcConfig.type_abri === "plein_champ" ? 1.0 : 0.7);
          const efficacite = parcConfig.efficacite || 0.90;
          const surfaceHa = parcConfig.surface_ha || 1;
          const debitPompe = parcConfig.debit_pompe || 10;
          const ru = parcConfig.reserve_utile || 120;
          const profondeur = parcConfig.profondeur_racinaire || 0.4;
          const seuil = parcConfig.seuil_declenchement || 0.4;

          const etc = eto * kc * coeffTunnel;
          let besoinNet = etc - Math.max(0, (todayForecast.precip || 0) * (parcConfig.type_abri === "plein_champ" ? 0.8 : 0));
          if (besoinNet < 0) besoinNet = 0;
          let besoinBrut = besoinNet / efficacite;
          if (soilCE && soilCE > 2.5) besoinBrut *= 1.15;

          const ruTotale = ru * profondeur;
          const doseMax = ruTotale * seuil;
          const nbTours = besoinBrut > 0 ? Math.max(1, Math.ceil(besoinBrut / doseMax)) : 0;
          const doseParTour = nbTours > 0 ? besoinBrut / nbTours : 0;
          const volumeM3 = doseParTour * surfaceHa * 10;
          const dureeH = debitPompe > 0 ? volumeM3 / debitPompe : 0;

          recommendations[parcName] = {
            eto, kc, coeff_tunnel: coeffTunnel, etc: Math.round(etc * 10) / 10,
            besoin_net: Math.round(besoinNet * 10) / 10,
            besoin_brut: Math.round(besoinBrut * 10) / 10,
            ru_totale: Math.round(ruTotale),
            dose_max: Math.round(doseMax * 10) / 10,
            nb_tours: nbTours,
            dose_par_tour: Math.round(doseParTour * 10) / 10,
            volume_m3: Math.round(volumeM3 * 10) / 10,
            duree_h: Math.round(dureeH * 100) / 100,
            duree_label: Math.floor(dureeH) + "h" + String(Math.round((dureeH % 1) * 60)).padStart(2, "0"),
            alerte_ce: soilCE && soilCE > 2.5 ? "CE élevée (" + soilCE + " dS/m) — +15% lessivage" : null,
            culture: parcConfig.culture, type_abri: parcConfig.type_abri,
          };
        }

        // 7. Build 7-day irrigation plan
        const plan7j = forecast.map((day, i) => {
          let totalDuree = 0;
          for (const [, parcConfig] of Object.entries(parcelles)) {
            const eto = day.eto || 4;
            const kc = parcConfig.kc || 0.85;
            const coeffT = parcConfig.coeff_tunnel || 0.7;
            const eff = parcConfig.efficacite || 0.90;
            const surf = parcConfig.surface_ha || 1;
            const debit = parcConfig.debit_pompe || 10;
            let besoin = (eto * kc * coeffT) / eff;
            if (parcConfig.type_abri === "plein_champ") besoin -= Math.max(0, (day.precip || 0) * 0.8) / eff;
            if (besoin < 0) besoin = 0;
            totalDuree += (besoin * surf * 10) / debit;
          }
          return {
            date: day.date, eto: day.eto, precip: day.precip,
            duree_totale_h: Math.round(totalDuree * 100) / 100,
            indoor: indoorForecast[i] || null,
          };
        });

        return res.json({
          success: true, ferme, forecast, indoorForecast,
          model: model ? { coefficients: model.coefficients, training_days: model.training_days, r2_tmax: model.coefficients.tmax?.r2, daily_errors: (model.daily_errors || []).slice(-7) } : null,
          recommendations, plan7j,
          soilAnalyses: soilAnalyses.map(a => ({ id: a.id, date: a.date_resultat, parsed_values: a.parsed_values, ferme: a.ferme })),
          config: irriConfig,
        });
      }

      // ========== IRRIGATION META — dynamic per-parcelle config ==========
      // GET  ?action=irrigation-meta-list                → all parcelle meta
      // POST ?action=irrigation-meta-save  body={id, meta} → upsert one
      // POST ?action=irrigation-meta-seed                → seed Firestore from static
      if (action === "irrigation-meta-list") {
        const II = require("./lib/irrigation");
        const snap = await db_firestore.collection(II.FIRESTORE_COLLECTION).get();
        const fromDb = {};
        snap.docs.forEach(d => { fromDb[d.id] = d.data(); });
        // Merge with static fallback so caller sees the union
        const merged = { ...II.PARCELLE_META, ...fromDb };
        return res.json({ success: true, meta: merged, source: { hardcoded: Object.keys(II.PARCELLE_META).length, firestore: Object.keys(fromDb).length } });
      }
      if (action === "irrigation-meta-save" && req.method === "POST") {
        const { id, meta } = req.body || {};
        if (!id || !meta) return res.status(400).json({ success: false, error: "id et meta requis" });
        const II = require("./lib/irrigation");
        await db_firestore.collection(II.FIRESTORE_COLLECTION).doc(id).set({
          ...meta,
          updated_at: Date.now(),
        }, { merge: true });
        II.clearParcelleMetaCache();
        return res.json({ success: true, id });
      }
      if (action === "irrigation-meta-seed" && req.method === "POST") {
        const II = require("./lib/irrigation");
        const batch = db_firestore.batch();
        const ids = Object.keys(II.PARCELLE_META);
        for (const id of ids) {
          const ref = db_firestore.collection(II.FIRESTORE_COLLECTION).doc(id);
          batch.set(ref, { ...II.PARCELLE_META[id], seeded_at: Date.now() }, { merge: true });
        }
        await batch.commit();
        II.clearParcelleMetaCache();
        return res.json({ success: true, seeded: ids.length });
      }

      // ========== IRRIGATION NEXT-PULSE — operator feedback ==========
      // Returns a single concise recommendation for the stationnaire who
      // just saved a pulse: continue / shorter / longer / wait / stop.
      // Includes radiation-driven "next pulse at HH:MM" prediction.
      if (action === "irrigation-intelligence-next-pulse") {
        const ferme = req.query.ferme;
        const parcelle = req.query.parcelle;
        // "Now" in Africa/Casablanca local time — heure de pulse stockée en local
        const _nowParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Casablanca",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(new Date());
        const _np = {};
        _nowParts.forEach(p => { _np[p.type] = p.value; });
        const todayDate = `${_np.year}-${_np.month}-${_np.day}`;
        const nowMin = Number(_np.hour) * 60 + Number(_np.minute);
        const date = req.query.date || todayDate;
        if (!ferme || !parcelle) {
          return res.status(400).json({ success: false, error: "ferme et parcelle requis" });
        }
        const II = require("./lib/irrigation");
        const raws = await II.fetchIrrigationReadings(db_firestore, {
          ferme, dateFrom: date, dateTo: date, parcelle,
        });
        let weatherToday = null;
        let weatherByDate = {};
        try {
          const coords = METEO_FERMES[ferme] || METEO_FERMES.F1;
          const [fc, hourlyByDate] = await Promise.all([
            fetchMeteoForecast7d(coords.lat, coords.lon),
            fetchHourlyRadiationByDate(coords.lat, coords.lon, 1, 2),
          ]);
          weatherToday = fc && fc[0];
          weatherByDate = hourlyByDate || {};
          // Augment weatherToday with today's hourly radiation + sunrise/sunset
          if (weatherToday && weatherByDate[date]) {
            weatherToday = { ...weatherToday, ...weatherByDate[date] };
          }
        } catch (e) { /* best effort, ignore */ }
        const parcelleMetaById = await II.loadParcelleMetaFromFirestore(db_firestore, [parcelle]);
        const meta = parcelleMetaById[parcelle] || II.getParcelleMeta(parcelle);
        const indoorRadByGhType = await loadIndoorHourlyRadiationByGhType(Object.keys(weatherByDate));
        const { summaries } = II.analyseReadings(raws, undefined, undefined, { weatherByDate, parcelleMetaById, indoorRadByGhType, todayDate, nowMin });
        const todaysSummary = summaries[0] || null;
        const advice = II.recommendNextPulse(todaysSummary, weatherToday, undefined, meta);

        // F3 live data — RadSum since last pulse to "now".
        // Prefer FarmRoad indoor radiation; fallback to Open-Meteo × transmittance
        // for the live ETA (UX: don't leave the ops user without a prediction
        // when today's FarmRoad doc isn't yet populated).
        let radSumSinceLastPulseNow = null;
        let radTargetJPerCm2 = II.getRadiationTarget((meta && meta.culture) || null, II.DEFAULT_THRESHOLDS);
        let radEtaMin = null;
        let radEtaTime = null;
        let radDataSource = null;
        const ghTypeF3 = meta && meta.greenhouseType;
        const indoorHourlyF3 = ghTypeF3 && indoorRadByGhType && indoorRadByGhType[ghTypeF3]
          ? (indoorRadByGhType[ghTypeF3][date] || null)
          : null;
        const outdoorHourlyF3 = (weatherByDate && weatherByDate[date] && Array.isArray(weatherByDate[date].hourlyRadiation))
          ? weatherByDate[date].hourlyRadiation : null;
        const useIndoorF3 = Array.isArray(indoorHourlyF3);
        const liveSource = useIndoorF3 ? indoorHourlyF3 : outdoorHourlyF3;
        const liveScale = useIndoorF3 ? 1 : II.getTransmittance(ghTypeF3, II.DEFAULT_THRESHOLDS);
        if (liveSource) radDataSource = useIndoorF3 ? 'farmroad' : 'openmeteo';
        if (date === todayDate && Array.isArray(liveSource)) {
          const sunriseMin = weatherByDate[date] && Number.isFinite(weatherByDate[date].sunriseMin) ? weatherByDate[date].sunriseMin : 6 * 60;
          const lastPulseMin = (todaysSummary && todaysSummary.pulses && todaysSummary.pulses.length > 0)
            ? todaysSummary.pulses[todaysSummary.pulses.length - 1].minutesFromMidnight
            : null;
          const fromMin = Number.isFinite(lastPulseMin) ? lastPulseMin : sunriseMin;
          if (nowMin > fromMin) {
            radSumSinceLastPulseNow = Math.round(II.integrateRadiation(liveSource, fromMin, nowMin) * liveScale * 100) / 100;
          } else {
            radSumSinceLastPulseNow = 0;
          }
          const remaining = Math.max(0, radTargetJPerCm2 - radSumSinceLastPulseNow);
          if (remaining > 0) {
            // predictNextPulseTime walks outdoor/indoor and looks for total target
            // (in raw integrated units). If using outdoor with transmittance, scale target up.
            const targetForPredict = useIndoorF3 ? radTargetJPerCm2 : radTargetJPerCm2 / Math.max(0.1, liveScale);
            const eta = II.predictNextPulseTime(liveSource, fromMin, targetForPredict);
            if (eta && eta.etaMin !== null) {
              radEtaMin = Math.max(0, eta.etaMin - nowMin);
              radEtaTime = eta.etaTime;
            }
          } else {
            radEtaMin = 0;
            radEtaTime = String(Math.floor(nowMin / 60)).padStart(2, "0") + ":" + String(nowMin % 60).padStart(2, "0");
          }
        }

        return res.json({
          success: true, ferme, parcelle, date,
          weatherToday, ...advice,
          radSumSinceLastPulseNow, radTargetJPerCm2, radEtaMin, radEtaTime, radDataSource,
          lastPulseHeure: (todaysSummary && todaysSummary.pulses && todaysSummary.pulses.length > 0)
            ? todaysSummary.pulses[todaysSummary.pulses.length - 1].heure
            : null,
        });
      }

      // ========== IRRIGATION INTELLIGENCE — analytics engine ==========
      // Pulls raw irrigation_readings, runs the domain pipeline, and returns
      // daily summaries + actionable recommendations + per-parcelle comparison.
      // Backed by functions/lib/irrigation/ — UI must stay logic-free.
      if (action === "irrigation-intelligence") {
        const ferme = req.query.ferme;
        const dateFrom = req.query.dateFrom;
        const dateTo = req.query.dateTo;
        const parcelle = req.query.parcelle || null;
        if (!ferme || !dateFrom || !dateTo) {
          return res.status(400).json({ success: false, error: "ferme, dateFrom, dateTo requis" });
        }
        // "Now" in Africa/Casablanca local time
        const _nowParts = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Africa/Casablanca",
          year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).formatToParts(new Date());
        const _np = {};
        _nowParts.forEach(p => { _np[p.type] = p.value; });
        const todayDate = `${_np.year}-${_np.month}-${_np.day}`;
        const nowMin = Number(_np.hour) * 60 + Number(_np.minute);
        const II = require("./lib/irrigation");
        const raws = await II.fetchIrrigationReadings(db_firestore, { ferme, dateFrom, dateTo, parcelle });
        // Build parcelle metadata map: Firestore overrides static, falls back if absent
        const parcelleIds = Array.from(new Set(raws.map(r => r.parcelle).filter(Boolean)));
        const parcelleMetaById = await II.loadParcelleMetaFromFirestore(db_firestore, parcelleIds);

        // Best-effort weather fetch (Open-Meteo). Never blocks the analysis.
        let weatherForecast = null;
        let weatherByDate = {};
        try {
          const coords = METEO_FERMES[ferme] || METEO_FERMES.F1;
          // Span enough past_days to cover the requested range
          const daysSpan = Math.max(1, Math.ceil((new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24)));
          const pastDays = Math.min(60, daysSpan + 1);
          const [fc, hourlyByDate] = await Promise.all([
            fetchMeteoForecast7d(coords.lat, coords.lon),
            fetchHourlyRadiationByDate(coords.lat, coords.lon, pastDays, 2),
          ]);
          weatherForecast = fc;
          weatherByDate = hourlyByDate || {};
        } catch (e) {
          console.warn("irrigation-intelligence: weather fetch failed:", e.message);
        }

        const indoorRadByGhType = await loadIndoorHourlyRadiationByGhType(Object.keys(weatherByDate));
        const {
          summaries,
          recommendationsByKey,
          radiationRecommendationsByKey,
          pulseTrailByKey,
          periodTrendsByParcelle,
          periodRecommendationsByParcelle,
          weatherToday: weatherTodayRaw,
          weatherRecommendationsByParcelle,
        } = II.analyseReadings(raws, undefined, weatherForecast, { weatherByDate, parcelleMetaById, indoorRadByGhType, todayDate, nowMin });

        // F4 — enrich weatherToday with farm-level outdoor RadSum (no transmittance)
        let weatherToday = weatherTodayRaw;
        if (weatherToday && weatherByDate[todayDate] && Array.isArray(weatherByDate[todayDate].hourlyRadiation)) {
          const ctx = weatherByDate[todayDate];
          const sunriseMin = Number.isFinite(ctx.sunriseMin) ? ctx.sunriseMin : 6 * 60;
          const sunsetMin = Number.isFinite(ctx.sunsetMin) ? ctx.sunsetMin : 19 * 60;
          const upTo = Math.min(sunsetMin, Math.max(sunriseMin, nowMin));
          const outdoorRadSumSoFarJPerCm2 = Math.round(II.integrateRadiation(ctx.hourlyRadiation, sunriseMin, upTo) * 100) / 100;
          const outdoorDailyRadJPerCm2 = Math.round(II.dailyRadiationTotal(ctx.hourlyRadiation, sunriseMin, sunsetMin) * 100) / 100;
          weatherToday = { ...weatherToday, outdoorRadSumSoFarJPerCm2, outdoorDailyRadJPerCm2, sunriseMin, sunsetMin };
        }

        // Per-parcelle aggregates for the comparison view
        const byParcelle = {};
        for (const s of summaries) {
          const key = s.parcelle;
          if (!byParcelle[key]) {
            byParcelle[key] = {
              parcelle: key, parcelleLabel: s.parcelleLabel,
              days: 0, totalInputMl: 0, totalDrainMl: 0,
              sumDrainPct: 0, drainPctSamples: 0,
              pulseCount: 0, highDrainPulseCount: 0, lowDrainPulseCount: 0,
              ecPtsValues: [], phPtsValues: [], diagnosesCounts: {},
            };
          }
          const agg = byParcelle[key];
          agg.days++;
          agg.totalInputMl += s.totalInputMl || 0;
          agg.totalDrainMl += s.totalDrainMl || 0;
          if (s.totalDrainPct !== null) { agg.sumDrainPct += s.totalDrainPct; agg.drainPctSamples++; }
          agg.pulseCount += s.pulseCount;
          agg.highDrainPulseCount += s.highDrainPulseCount;
          agg.lowDrainPulseCount += s.lowDrainPulseCount;
          if (s.avgEcPts) agg.ecPtsValues.push(s.avgEcPts);
          if (s.avgPhPts) agg.phPtsValues.push(s.avgPhPts);
          agg.diagnosesCounts[s.diagnosis] = (agg.diagnosesCounts[s.diagnosis] || 0) + 1;
        }
        const stddev = (arr) => {
          if (!arr.length) return null;
          const m = arr.reduce((a, b) => a + b, 0) / arr.length;
          return Math.sqrt(arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length);
        };
        const comparison = Object.values(byParcelle).map(agg => ({
          parcelle: agg.parcelle,
          parcelleLabel: agg.parcelleLabel,
          days: agg.days,
          avgDrainPct: agg.drainPctSamples > 0 ? agg.sumDrainPct / agg.drainPctSamples : null,
          totalInputMl: agg.totalInputMl,
          totalDrainMl: agg.totalDrainMl,
          pulseCount: agg.pulseCount,
          highDrainPulseCount: agg.highDrainPulseCount,
          lowDrainPulseCount: agg.lowDrainPulseCount,
          problemRatio: agg.pulseCount > 0
            ? (agg.highDrainPulseCount + agg.lowDrainPulseCount) / agg.pulseCount
            : null,
          ecStability: stddev(agg.ecPtsValues),
          phStability: stddev(agg.phPtsValues),
          diagnosesCounts: agg.diagnosesCounts,
        }));

        return res.json({
          success: true,
          ferme, dateFrom, dateTo, parcelle,
          summaries,
          recommendationsByKey,
          radiationRecommendationsByKey,
          pulseTrailByKey,
          periodTrendsByParcelle,
          periodRecommendationsByParcelle,
          weatherForecast,
          weatherToday,
          weatherRecommendationsByParcelle,
          comparison,
          generatedAt: Date.now(),
          todayDate, nowMin,
        });
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
            whatsappPhone: d.whatsappPhone || "",
            whatsappEnabled: d.whatsappEnabled || false,
            ferme: d.ferme || "",
          });
        }
        return res.json({ success: true, users });
      }

      // CREATE user
      if (action === "create" && req.method === "POST") {
        const { email, password, displayName, profileId, role, whatsappPhone, ferme } = req.body;
        if (!email || !password || !profileId) {
          return res.status(400).json({ success: false, error: "Email, mot de passe et profil requis" });
        }
        const userRecord = await admin.auth().createUser({
          email, password, displayName: displayName || email,
        });
        const userData = {
          email, displayName: displayName || "", profileId,
          role: role || "user", disabled: false,
          createdAt: Date.now(), createdBy: decoded.uid, updatedAt: Date.now(),
          whatsappEnabled: !!whatsappPhone,
        };
        if (whatsappPhone) userData.whatsappPhone = whatsappPhone;
        if (ferme) userData.ferme = ferme;
        await db_firestore.collection("users").doc(userRecord.uid).set(userData);
        return res.json({ success: true, uid: userRecord.uid });
      }

      // UPDATE user
      if (action === "update" && req.method === "POST") {
        const { uid, displayName, profileId, role, disabled, password, whatsappPhone, whatsappEnabled, ferme } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: "UID requis" });

        const updates = { updatedAt: Date.now() };
        const authUpdates = {};

        if (displayName !== undefined) { updates.displayName = displayName; authUpdates.displayName = displayName; }
        if (profileId !== undefined) updates.profileId = profileId;
        if (role !== undefined) updates.role = role;
        if (disabled !== undefined) updates.disabled = disabled;
        if (password) authUpdates.password = password;
        if (whatsappPhone !== undefined) updates.whatsappPhone = whatsappPhone;
        if (whatsappEnabled !== undefined) updates.whatsappEnabled = whatsappEnabled;
        if (ferme !== undefined) updates.ferme = ferme;

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

      // ---- GET-POINTAGE-WORKERS: nb ouvriers hors-récolte par parcelle/tâche depuis pointage du jour ----
      if (action === "get-pointage-workers") {
        const ferme = req.query.ferme;
        const today = new Date().toISOString().slice(0, 10);
        const rows = await getPointageRowsForDate(today);

        // deriveFerme inline (same logic as pointageService.js)
        function deriveFermeLocal(refParcelle, parcelleCulturale) {
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
            const sMatch = parcelleCulturale.match(/\bS(\d{1,2})\b/i);
            if (sMatch) { const sNum = parseInt(sMatch[1], 10); if (sNum >= 1 && sNum <= 7) return "F1"; if (sNum >= 8 && sNum <= 14) return "F5"; }
          }
          return "Autre";
        }

        // Filter hors-récolte only, group by parcelle × operation
        const groups = {};
        for (const r of rows) {
          const opFamille = r.Operation_Famille || "";
          if (opFamille === "8. Récolte" || opFamille === "11. Postes fixes") continue;
          const rowFerme = deriveFermeLocal(r.Ref_parcelle, r.Parcelle_Culturale);
          if (ferme && rowFerme !== ferme) continue;

          const parcelle = (r.Parcelle_Culturale || "").trim();
          const operation = (r.Operation || "").trim();
          const key = `${parcelle}|${operation}`;
          if (!groups[key]) groups[key] = { parcelle, tache: operation, ferme: rowFerme, workers: new Set() };
          if (r.Personnel_Matricule) groups[key].workers.add(r.Personnel_Matricule);
        }

        const result = Object.values(groups).map(g => ({
          parcelle: g.parcelle,
          tache: g.tache,
          ferme: g.ferme,
          nbOuvriers: g.workers.size,
        }));

        return res.json({ success: true, date: today, workers: result });
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
    const action = req.query.action || "summary";
    // Import action uses API key auth (for CI/GitHub Actions)
    if (action === "import" && req.method === "POST") {
      const apiKey = req.headers["x-api-key"] || req.query.key;
      const expectedKey = process.env.FUEL_IMPORT_KEY;
      if (!expectedKey || apiKey !== expectedKey) {
        return res.status(401).json({ success: false, error: "Clé API invalide" });
      }
    } else {
      const authUser = await requireAuth(req, res);
      if (!authUser) return;
    }
    try {
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

          // ===== PRIX MOYEN PAR SEMAINE =====
          function getISOWeekForPrice(d) {
            const date = new Date(d.getTime());
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
            const week1 = new Date(date.getFullYear(), 0, 4);
            const weekNum = 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
            return `${date.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
          }
          const prixWeeklyMap = {};
          for (const t of transactions) {
            if (t.isPeage || !t.quantite || t.quantite <= 0) continue;
            const tDate = t.date.toDate ? t.date.toDate() : new Date(t.date);
            const week = getISOWeekForPrice(tDate);
            if (!prixWeeklyMap[week]) prixWeeklyMap[week] = { montant: 0, litres: 0 };
            prixWeeklyMap[week].montant += t.montant || 0;
            prixWeeklyMap[week].litres += t.quantite || 0;
          }
          const prixMoyenParSemaine = Object.entries(prixWeeklyMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([semaine, v]) => ({
              semaine,
              prixMoyen: Math.round(v.montant / v.litres * 100) / 100,
            }));

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

          const summaryResult = {
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
            prixMoyenParSemaine,
            nbTransactions: transactions.length,
            campagne: `${campagneYear}-${campagneYear + 1}`,
          };

          // Persist CPC snapshot for fast reads (no API call needed)
          try {
            await db_firestore.collection("cpc_snapshots").doc("fuel").set({
              totalCampagne: summaryResult.totalCampagne,
              totalPeages: summaryResult.totalPeages,
              campagne: summaryResult.campagne,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          } catch (e) { console.warn("[Fuel] CPC snapshot save failed:", e.message); }

          return summaryResult;
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
// API: Telecom — Maroc Télécom (IAM) billing data
// =============================================
exports.telecom = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const action = req.query.action || "summary";
    // Import action uses API key auth (for CI/GitHub Actions)
    if (action === "import" && req.method === "POST") {
      const apiKey = req.headers["x-api-key"] || req.query.key;
      const expectedKey = process.env.TELECOM_IMPORT_KEY;
      if (!expectedKey || apiKey !== expectedKey) {
        return res.status(401).json({ success: false, error: "Clé API invalide" });
      }
    } else {
      const authUser = await requireAuth(req, res);
      if (!authUser) return;
    }
    try {
      const COLLECTION = "telecom_bills";

      // Campaign starts in July
      const now = new Date();
      const campagneYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      const campagneStart = new Date(campagneYear, 6, 1); // July 1st
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      if (action === "summary") {
        const cacheKey = `telecom_summary_${now.getFullYear()}_${now.getMonth()}`;
        const cached = await withCache(cacheKey, 15 * 60 * 1000, async () => {
          const snap = await db_firestore.collection(COLLECTION).get();

          if (snap.empty) {
            return {
              success: true,
              totalMois: 0, totalCampagne: 0, nbLignes: 0, coutMoyenLigne: 0,
              parLigne: [], evolution: [], dernieresFactures: [], anomalies: [],
              nbFactures: 0, campagne: `${campagneYear}-${campagneYear + 1}`,
            };
          }

          const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
              const da = a.date && a.date.toDate ? a.date.toDate() : new Date(a.date || 0);
              const db2 = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date || 0);
              return db2 - da;
            });
          const bills = allDocs.filter(b => {
            const bDate = b.date && b.date.toDate ? b.date.toDate() : new Date(b.date);
            return bDate >= campagneStart;
          });

          // Aggregate
          let totalMois = 0, totalCampagne = 0;
          const parLigneMap = {};
          const evolutionMap = {};
          const lignesSet = new Set();

          for (const b of bills) {
            const bDate = b.date.toDate ? b.date.toDate() : new Date(b.date);
            const isCurrentMonth = bDate >= currentMonthStart;
            const montant = b.montant || 0;

            totalCampagne += montant;
            if (isCurrentMonth) totalMois += montant;
            lignesSet.add(b.ligne);

            // Par ligne
            if (!parLigneMap[b.ligne]) {
              parLigneMap[b.ligne] = { ligne: b.ligne, montant: 0, count: 0, forfait: b.forfait || "" };
            }
            parLigneMap[b.ligne].montant += montant;
            parLigneMap[b.ligne].count++;
            if (b.forfait) parLigneMap[b.ligne].forfait = b.forfait;

            // Evolution par mois
            const moisKey = b.mois || `${bDate.getFullYear()}-${String(bDate.getMonth() + 1).padStart(2, "0")}`;
            if (!evolutionMap[moisKey]) {
              evolutionMap[moisKey] = { mois: moisKey, montant: 0, appels: 0, sms: 0, data: 0 };
            }
            evolutionMap[moisKey].montant += montant;
            evolutionMap[moisKey].appels += (b.appels || 0);
            evolutionMap[moisKey].sms += (b.sms || 0);
            evolutionMap[moisKey].data += (b.data || 0);
          }

          // Format evolution with month labels
          const moisLabels = { "01": "Jan", "02": "Fév", "03": "Mars", "04": "Avr", "05": "Mai", "06": "Jun", "07": "Jul", "08": "Aoû", "09": "Sep", "10": "Oct", "11": "Nov", "12": "Déc" };
          const evolution = Object.values(evolutionMap)
            .sort((a, b) => a.mois.localeCompare(b.mois))
            .map(e => ({
              ...e,
              label: moisLabels[e.mois.split("-")[1]] || e.mois,
              montant: Math.round(e.montant),
              appels: Math.round(e.appels),
              sms: Math.round(e.sms),
              data: Math.round(e.data),
            }));

          const nbLignes = lignesSet.size;
          const parLigne = Object.values(parLigneMap)
            .sort((a, b) => b.montant - a.montant)
            .map(l => ({
              ...l,
              montant: Math.round(l.montant),
            }));

          const coutMoyenLigne = nbLignes > 0 ? Math.round(totalCampagne / nbLignes) : 0;

          // 20 dernières factures
          const dernieres = bills.slice(0, 20).map(b => ({
            ligne: b.ligne,
            periode: b.periode,
            montant: b.montant,
            forfait: b.forfait || "",
            dateFacture: b.dateFacture || "",
          }));

          // Anomalies: lignes avec montant dernier mois > 2× leur moyenne
          const anomalies = [];
          for (const [ligne, info] of Object.entries(parLigneMap)) {
            if (info.count < 3) continue;
            const moyenne = info.montant / info.count;
            const ligneBills = bills.filter(b => b.ligne === ligne);
            // Check last bill
            if (ligneBills.length > 0) {
              const lastBill = ligneBills[0]; // already sorted desc
              if (lastBill.montant > moyenne * 2 && lastBill.montant > 200) {
                anomalies.push({
                  type: "spike",
                  ligne,
                  periode: lastBill.periode,
                  montant: Math.round(lastBill.montant),
                  moyenne: Math.round(moyenne),
                  ratio: Math.round(lastBill.montant / moyenne * 10) / 10,
                });
              }
            }
          }
          anomalies.sort((a, b) => b.montant - a.montant);

          // Récupérer la date de dernière synchro depuis api_metadata
          let lastSyncAt = null;
          try {
            const metaSnap = await db_firestore.collection("api_metadata").doc("telecom").get();
            if (metaSnap.exists) {
              const m = metaSnap.data();
              if (m.lastSyncAt && m.lastSyncAt.toDate) lastSyncAt = m.lastSyncAt.toDate().toISOString();
              else if (m.lastSyncAt) lastSyncAt = new Date(m.lastSyncAt).toISOString();
            }
          } catch (_) { /* ignore */ }

          return {
            success: true,
            totalMois: Math.round(totalMois),
            totalCampagne: Math.round(totalCampagne),
            nbLignes,
            coutMoyenLigne,
            parLigne,
            evolution,
            dernieresFactures: dernieres,
            anomalies,
            nbFactures: bills.length,
            campagne: `${campagneYear}-${campagneYear + 1}`,
            lastSyncAt,
          };
        });
        return res.json(cached);
      }

      if (action === "import" && req.method === "POST") {
        const bills = req.body.bills || [];
        if (!Array.isArray(bills) || bills.length === 0) {
          return res.status(400).json({ success: false, error: "bills array requis" });
        }

        let imported = 0;
        const BATCH_SIZE = 400;
        let batch = db_firestore.batch();
        let batchCount = 0;

        for (const b of bills) {
          const montant = parseFloat(b.montant) || 0;
          const appels = parseFloat(b.appels) || 0;
          const sms = parseFloat(b.sms) || 0;
          const dataVal = parseFloat(b.data) || 0;
          const roaming = parseFloat(b.roaming) || 0;

          // Parse periode to date (YYYY-MM → 1st of month)
          const [year, month] = (b.periode || "").split("-");
          const dateObj = year && month ? new Date(parseInt(year), parseInt(month) - 1, 1) : new Date();

          const docId = `${(b.ligne || "").replace(/\s/g, "")}_${b.periode || "unknown"}`;
          const ref = db_firestore.collection(COLLECTION).doc(docId);
          batch.set(ref, {
            ligne: b.ligne || "",
            periode: b.periode || "",
            montant, appels, sms, data: dataVal, roaming,
            forfait: b.forfait || "",
            dateFacture: b.dateFacture || "",
            numFacture: b.numFacture || "",
            mois: b.periode || "",
            annee: parseInt(year, 10) || dateObj.getFullYear(),
            date: admin.firestore.Timestamp.fromDate(dateObj),
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

        // Track last sync timestamp
        await db_firestore.collection("api_metadata").doc("telecom").set({
          lastSyncAt: admin.firestore.Timestamp.fromDate(new Date()),
          lastImportCount: imported,
        }, { merge: true }).catch(() => {});

        // Invalidate cache
        const cacheKey = `telecom_summary_${now.getFullYear()}_${now.getMonth()}`;
        await db_firestore.collection("api_cache").doc(cacheKey.replace(/[\/\.\s#\[\]*]/g, "_").slice(0, 200)).delete().catch(() => {});

        return res.json({ success: true, imported });
      }

      if (action === "bills") {
        const limit = Math.min(parseInt(req.query.limit || "50", 10), 200);
        const snap = await db_firestore.collection(COLLECTION).limit(limit).get();
        const data = snap.docs.map(d => {
          const b = d.data();
          return { id: d.id, ligne: b.ligne, periode: b.periode, montant: b.montant, forfait: b.forfait, dateFacture: b.dateFacture };
        });
        return res.json({ success: true, data, count: data.length });
      }

      if (action === "count") {
        const snap = await db_firestore.collection(COLLECTION).count().get();
        return res.json({ success: true, total: snap.data().count });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur telecom:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// API: OJRA — Payroll & social charges (manual Excel upload)
// =============================================
// Phase 1 (RDP discovery) is pending; in the meantime users export the OJRA
// payroll Excel via Remote Desktop and upload it through the OJRA tab.
// The parser (./ojraParser.js) detects columns heuristically — when the OJRA
// schema is fixed, tighten its COLUMN_PATTERNS.
exports.ojra = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const action = req.query.action || "summary";

    // import accepts either an authenticated user OR a server-side API key.
    if (action === "import" && req.method === "POST") {
      const apiKey = req.headers["x-api-key"] || req.query.key;
      const expectedKey = process.env.OJRA_IMPORT_KEY;
      const keyOk = expectedKey && apiKey === expectedKey;
      if (!keyOk) {
        const authUser = await requireAuth(req, res);
        if (!authUser) return;
      }
    } else {
      const authUser = await requireAuth(req, res);
      if (!authUser) return;
    }

    try {
      const COLLECTION = "ojra_payroll";
      const META_DOC = db_firestore.collection("api_metadata").doc("ojra");

      if (action === "import" && req.method === "POST") {
        const { file, period, importedBy, dryRun } = req.body || {};
        if (!file) return res.status(400).json({ success: false, error: "file (base64) requis" });
        if (!period || !/^\d{4}-\d{2}-\d{2}$/.test(period)) {
          return res.status(400).json({ success: false, error: "period requis au format YYYY-MM-DD (samedi début de quinzaine)" });
        }

        const { parseOjraExcel } = require("./ojraParser");
        let parsed;
        try {
          parsed = parseOjraExcel(file);
        } catch (err) {
          return res.status(400).json({ success: false, error: "Excel illisible: " + err.message });
        }

        const allRecords = [];
        for (const s of parsed.sheets) {
          if (s.skipped) continue;
          for (const r of s.records) allRecords.push({ ...r, _sheet: s.name });
        }

        if (allRecords.length === 0) {
          return res.status(400).json({
            success: false,
            error: "Aucune ligne de paie reconnue. Vérifier que les en-têtes contiennent au moins matricule/nom et un montant (brut, net, CNSS).",
            meta: parsed.meta,
            sheets: parsed.sheets.map(s => ({ name: s.name, skipped: !!s.skipped, reason: s.reason || null, detectedColumns: s.detectedColumns || [] })),
          });
        }

        if (dryRun) {
          return res.json({
            success: true,
            dryRun: true,
            period,
            totals: parsed.totals,
            sheets: parsed.sheets.map(s => ({
              name: s.name, skipped: !!s.skipped, reason: s.reason || null,
              detectedColumns: s.detectedColumns || [], nbRecords: s.records ? s.records.length : 0,
            })),
            sample: allRecords.slice(0, 5),
          });
        }

        const importedAt = admin.firestore.Timestamp.fromDate(new Date());
        const periodKey = period;

        const BATCH_SIZE = 400;
        let batch = db_firestore.batch();
        let batchCount = 0;
        let imported = 0;

        for (const rec of allRecords) {
          const matKey = (rec.matricule || "").replace(/[\/\.\s#\[\]*]/g, "_");
          const nomKey = (rec.nomComplet || rec.nom || "anon").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
          const docId = `${periodKey}__${matKey || nomKey}`.slice(0, 200);

          batch.set(db_firestore.collection(COLLECTION).doc(docId), {
            period: periodKey,
            matricule: rec.matricule || "",
            nom: rec.nomComplet || rec.nom || "",
            poste: rec.poste || "",
            service: rec.service || "",
            ferme: rec.ferme || "",
            joursTravailles: rec.joursTravailles || 0,
            heuresNormales: rec.heuresNormales || 0,
            heuresSupp: rec.heuresSupp || 0,
            salaireBase: rec.salaireBase || 0,
            salaireBrut: rec.salaireBrut || 0,
            salaireImposable: rec.salaireImposable || 0,
            salaireNet: rec.salaireNet || 0,
            cnssEmploye: rec.cnssEmploye || 0,
            cnssEmployeur: rec.cnssEmployeur || 0,
            amoEmploye: rec.amoEmploye || 0,
            amoEmployeur: rec.amoEmployeur || 0,
            ir: rec.ir || 0,
            cimr: rec.cimr || 0,
            primes: rec.primes || 0,
            avances: rec.avances || 0,
            sourceSheet: rec._sheet || "",
            source: "ojra",
            importedAt,
            importedBy: importedBy || null,
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

        await db_firestore.collection("ojra_period_totals").doc(periodKey).set({
          period: periodKey,
          ...parsed.totals,
          importedAt,
          importedBy: importedBy || null,
          sheets: parsed.sheets.filter(s => !s.skipped).map(s => s.name),
        }, { merge: true });

        await META_DOC.set({
          lastImportAt: importedAt,
          lastPeriod: periodKey,
          lastImportCount: imported,
        }, { merge: true });

        await db_firestore.collection("api_cache").doc("ojra_summary").delete().catch(() => {});

        return res.json({ success: true, imported, period: periodKey, totals: parsed.totals });
      }

      if (action === "summary") {
        const cached = await withCache("ojra_summary", 10 * 60 * 1000, async () => {
          const periodsSnap = await db_firestore.collection("ojra_period_totals")
            .orderBy("period", "desc").limit(24).get();
          const periods = periodsSnap.docs.map(d => {
            const t = d.data();
            return {
              period: t.period,
              nbEmployes: t.nbEmployes || 0,
              salaireBrut: t.salaireBrut || 0,
              salaireNet: t.salaireNet || 0,
              chargesSocialesTotal: t.chargesSocialesTotal || 0,
              cnssEmploye: t.cnssEmploye || 0,
              cnssEmployeur: t.cnssEmployeur || 0,
              amoEmploye: t.amoEmploye || 0,
              amoEmployeur: t.amoEmployeur || 0,
              ir: t.ir || 0,
              cimr: t.cimr || 0,
              importedAt: t.importedAt && t.importedAt.toDate ? t.importedAt.toDate().toISOString() : null,
            };
          });

          let lastImportAt = null;
          let lastPeriod = null;
          try {
            const meta = await META_DOC.get();
            if (meta.exists) {
              const m = meta.data();
              lastImportAt = m.lastImportAt && m.lastImportAt.toDate ? m.lastImportAt.toDate().toISOString() : null;
              lastPeriod = m.lastPeriod || null;
            }
          } catch (_) { /* ignore */ }

          return {
            success: true,
            latest: periods[0] || null,
            periods,
            lastImportAt,
            lastPeriod,
          };
        });
        return res.json(cached);
      }

      if (action === "detail") {
        const period = req.query.period;
        if (!period) return res.status(400).json({ success: false, error: "period requis" });
        const snap = await db_firestore.collection(COLLECTION).where("period", "==", period).get();
        const records = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.salaireBrut || 0) - (a.salaireBrut || 0));
        return res.json({ success: true, period, count: records.length, records });
      }

      if (action === "periods") {
        const snap = await db_firestore.collection("ojra_period_totals")
          .orderBy("period", "desc").limit(48).get();
        const periods = snap.docs.map(d => d.data().period).filter(Boolean);
        return res.json({ success: true, periods });
      }

      if (action === "delete-period" && req.method === "POST") {
        const period = (req.body && req.body.period) || req.query.period;
        if (!period) return res.status(400).json({ success: false, error: "period requis" });
        const snap = await db_firestore.collection(COLLECTION).where("period", "==", period).get();
        let deleted = 0;
        let batch = db_firestore.batch();
        for (const doc of snap.docs) {
          batch.delete(doc.ref);
          deleted++;
          if (deleted % 400 === 0) {
            await batch.commit();
            batch = db_firestore.batch();
          }
        }
        if (deleted % 400 !== 0) await batch.commit();
        await db_firestore.collection("ojra_period_totals").doc(period).delete().catch(() => {});
        await db_firestore.collection("api_cache").doc("ojra_summary").delete().catch(() => {});
        return res.json({ success: true, deleted });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur ojra:", err);
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
        promises.push(
          db_firestore.collection("suppliers")
            .where("status", "==", "en_attente").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "fournisseurs_finance", label: "Fournisseurs en attente de validation", count: snap.size, icon: "fa-building-circle-check", color: "#27ae60", tab: "fin_fournisseurs" });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "envoye").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_envoye", label: "BDC envoyés — virement à lancer", count: snap.size, icon: "fa-file-contract", color: "#e67e22", tab: "fin_bdc" });
            })
        );
        promises.push(
          db_firestore.collection("purchase_orders")
            .where("status", "==", "virement_lance").get()
            .then(snap => {
              if (snap.size > 0) categories.validations.push({ key: "bdc_virement_lance", label: "Virements lancés — en attente signature", count: snap.size, icon: "fa-pen-nib", color: "#9b59b6", tab: "fin_bdc" });
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

      // ---- Alerts from Firestore (expedition_manquante, new_agq_analyses, etc.) ----
      const alertProfiles = ['chef_f1', 'chef_f5', 'chef_avo', 'qualite', 'dg', 'achats', 'finance', 'dt'];
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
                  if ((profile === 'dg' || profile === 'qualite') && a.type === 'expedition_manquante') return;
                  const isAgq = a.type === 'new_agq_analyses';
                  categories.alertes.push({
                    key: 'alert_' + doc.id,
                    label: a.message || 'Alerte',
                    count: 1,
                    icon: isAgq
                      ? 'fa-flask-vial'
                      : (a.type === 'expedition_manquante' ? 'fa-truck-ramp-box' : 'fa-triangle-exclamation'),
                    color: isAgq
                      ? '#7c3aed'
                      : (a.severity === 'info' ? '#2563eb' : a.severity === 'warning' ? '#f39c12' : '#e74c3c'),
                    tab: isAgq ? 'chef_agronomie' : 'qualite_expeditions',
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
        categories.taches.push({ key: "tasks_overdue", label: "Tâches en retard", count: overdue.length, icon: "fa-clock", color: "#e74c3c", tab: "dg_tasks" });
      }
      if (inProgress.length > 0) {
        categories.taches.push({ key: "tasks_en_cours", label: "Tâches en cours", count: inProgress.length, icon: "fa-spinner", color: "#3498db", tab: "dg_tasks" });
      }
      if (todo.length > 0) {
        categories.taches.push({ key: "tasks_a_faire", label: "Tâches à faire", count: todo.length, icon: "fa-list-check", color: "#f39c12", tab: "dg_tasks" });
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

// =============================================
// Gestion de Caisse — Cash Management
// =============================================
const CAISSE_PROFILES_SAISIE = ["achats"];
const CAISSE_PROFILES_CONTROLE = ["dg", "finance"];

exports.caisseManagement = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    const action = req.query.action || req.body?.action || "dashboard";
    const adminSecret = process.env.ADMIN_SECRET || "bgf-admin-2026";

    // ========== BULK IMPORT (admin-secret protected, no Firebase Auth) ==========
    if (action === "bulk-import-transactions" && req.method === "POST") {
      if (req.body.secret !== adminSecret) {
        return res.status(403).json({ success: false, error: "forbidden" });
      }
      try {
        const { caisse_id, transactions, reset_solde_initial, force_overwrite, caisse_def } = req.body;
        if (!caisse_id || !Array.isArray(transactions)) {
          return res.status(400).json({ success: false, error: "caisse_id et transactions[] requis" });
        }

        const caisseRef = db_firestore.collection("caisse_definitions").doc(caisse_id);
        const caisseDoc = await caisseRef.get();

        // Auto-seed the 4 default caisses + the target caisse if it doesn't exist
        if (!caisseDoc.exists) {
          const DEFAULT_CAISSES = {
            caisse_paie: { nom: "Caisse Paie", description: "Caisse pour les paiements salariaux" },
            caisse_depenses: { nom: "Caisse Dépenses", description: "Caisse pour les dépenses courantes" },
            caisse_marche_local_f1: { nom: "Caisse Marché Local F1", description: "Caisse du marché local Ferme 1" },
            caisse_marche_local_f5: { nom: "Caisse Marché Local F5", description: "Caisse du marché local Ferme 5" },
          };
          const seedBatch = db_firestore.batch();
          const importer = { uid: "import-script", email: "import@berrygood.ma", profileId: "admin", name: "Import Excel" };
          const nowTs = admin.firestore.FieldValue.serverTimestamp();
          for (const [id, def] of Object.entries(DEFAULT_CAISSES)) {
            const ref = db_firestore.collection("caisse_definitions").doc(id);
            const existing = await ref.get();
            if (!existing.exists) {
              seedBatch.set(ref, {
                nom: def.nom, description: def.description,
                solde_initial: 0, solde_actuel: 0,
                devise: "MAD", is_default: true, active: true,
                created_by: importer, created_at: nowTs, updated_at: nowTs,
              });
            }
          }
          // If the target caisse is NOT a default, create it from caisse_def or fallback
          if (!DEFAULT_CAISSES[caisse_id]) {
            const ref = db_firestore.collection("caisse_definitions").doc(caisse_id);
            const existing = await ref.get();
            if (!existing.exists) {
              const customDef = caisse_def || {};
              seedBatch.set(ref, {
                nom: customDef.nom || caisse_id,
                description: customDef.description || "",
                solde_initial: 0, solde_actuel: 0,
                devise: "MAD", is_default: false, active: true,
                created_by: importer, created_at: nowTs, updated_at: nowTs,
              });
            }
          }
          await seedBatch.commit();
        }

        if (typeof reset_solde_initial === "number") {
          await caisseRef.update({
            solde_initial: reset_solde_initial,
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
          });
        }

        const importer = { uid: "import-script", email: "import@berrygood.ma", profileId: "admin", name: "Import Excel" };
        let imported = 0, skipped = 0;

        // Process in batches (Firestore limit = 500 ops per batch)
        const BATCH_SIZE = 400;
        for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
          const slice = transactions.slice(i, i + BATCH_SIZE);
          const refs = slice.map(tx => db_firestore.collection("caisse_transactions").doc(tx.external_id));
          const docs = await Promise.all(refs.map(r => r.get()));
          const batch = db_firestore.batch();
          slice.forEach((tx, idx) => {
            if (docs[idx].exists && !force_overwrite) { skipped++; return; }
            const now = Date.now();
            batch.set(refs[idx], {
              caisse_id: tx.caisse_id,
              type: tx.type,
              montant: tx.montant,
              reference: tx.reference || "",
              description: tx.description || "",
              code_analytique: tx.code_analytique || "",
              fournisseur: tx.fournisseur || "",
              date: tx.date,
              status: "valide",
              files: [],
              saisie_by: importer,
              soumis_par: importer,
              soumis_at: admin.firestore.FieldValue.serverTimestamp(),
              valide_par: importer,
              valide_at: admin.firestore.FieldValue.serverTimestamp(),
              created_at: admin.firestore.FieldValue.serverTimestamp(),
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
              history: [
                { action: "import", by: importer, at: now, source: tx._meta || {} },
                { action: "validation", by: importer, at: now },
              ],
              _import_meta: tx._meta || {},
            });
            imported++;
          });
          await batch.commit();
        }

        // Recompute caisse balance from all VALIDATED transactions
        const allTxSnap = await db_firestore.collection("caisse_transactions")
          .where("caisse_id", "==", caisse_id)
          .where("status", "==", "valide")
          .get();
        let totalIn = 0, totalOut = 0;
        allTxSnap.docs.forEach(d => {
          const tx = d.data();
          if (tx.type === "alimentation" || tx.type === "transfer_in") totalIn += (tx.montant || 0);
          else if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") totalOut += (tx.montant || 0);
        });

        const updatedCaisseDoc = await caisseRef.get();
        const soldeInitial = updatedCaisseDoc.data().solde_initial || 0;
        const soldeActuel = soldeInitial + totalIn - totalOut;
        await caisseRef.update({ solde_actuel: soldeActuel, updated_at: admin.firestore.FieldValue.serverTimestamp() });

        return res.json({
          success: true, imported, skipped,
          total_transactions: allTxSnap.size,
          solde_initial: soldeInitial, solde_actuel: soldeActuel,
          total_in: totalIn, total_out: totalOut,
        });
      } catch (err) {
        console.error("Erreur bulk-import:", err);
        return res.status(500).json({ success: false, error: err.message });
      }
    }

    // ========== STANDARD AUTH FLOW ==========
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    // Lookup user profile
    const userDoc = await db_firestore.collection("users").doc(authUser.uid).get();
    const userProfile = userDoc.exists ? userDoc.data() : {};
    const profileId = userProfile.profileId || "";

    const isSaisie = CAISSE_PROFILES_SAISIE.includes(profileId);
    const isControle = CAISSE_PROFILES_CONTROLE.includes(profileId);
    const isAdmin = userProfile.role === "admin";
    const hasAccess = isSaisie || isControle || isAdmin;

    if (!hasAccess) return res.status(403).json({ success: false, error: "Accès non autorisé à la gestion de caisse" });

    const userInfo = { uid: authUser.uid, email: authUser.email || "", profileId, name: userProfile.fullName || userProfile.name || authUser.email || "" };

    try {
      // ========== DASHBOARD ==========
      if (action === "dashboard") {
        const caissesSnap = await db_firestore.collection("caisse_definitions").where("active", "==", true).get();
        const caisses = caissesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Pending validations count
        const pendingSnap = await db_firestore.collection("caisse_transactions").where("status", "==", "soumis").get();
        const pendingCount = pendingSnap.size;

        // This week totals (Saturday to Friday)
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
        const daysSinceSat = dayOfWeek === 6 ? 0 : dayOfWeek + 1;
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - daysSinceSat);
        weekStart.setHours(0, 0, 0, 0);
        const weekStartStr = weekStart.toISOString().slice(0, 10);

        // Weekly totals — wrapped in try/catch so a missing composite index
        // (status ASC, date ASC) doesn't bring down the whole dashboard.
        // Degraded mode: returns 0/0 + an indicator instead of failing.
        let weekAlimentations = 0, weekDepenses = 0, weeklyDegraded = false;
        try {
          const weekTxSnap = await db_firestore.collection("caisse_transactions")
            .where("status", "==", "valide")
            .where("date", ">=", weekStartStr)
            .get();
          weekTxSnap.docs.forEach(d => {
            const tx = d.data();
            if (tx.type === "alimentation" || tx.type === "transfer_in") weekAlimentations += (tx.montant || 0);
            if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") weekDepenses += (tx.montant || 0);
          });
        } catch (e) {
          console.warn("[dashboard] weekly query failed (likely index building):", e.message);
          weeklyDegraded = true;
        }

        // Recent transactions (last 10) — same defensive wrap
        let recentTx = [];
        try {
          const recentSnap = await db_firestore.collection("caisse_transactions")
            .orderBy("created_at", "desc").limit(10).get();
          recentTx = recentSnap.docs.map(d => ({ id: d.id, ...d.data(), created_at: d.data().created_at?.toMillis?.() || d.data().created_at }));
        } catch (e) {
          console.warn("[dashboard] recent query failed:", e.message);
        }

        return res.json({ success: true, caisses, pendingCount, weekAlimentations, weekDepenses, recentTx, weeklyDegraded });
      }

      // ========== LIST CAISSES ==========
      if (action === "list-caisses") {
        const snap = await db_firestore.collection("caisse_definitions").where("active", "==", true).get();
        const caisses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, caisses });
      }

      // ========== CREATE CAISSE ==========
      if (action === "create-caisse" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut créer une caisse" });
        const { nom, description } = req.body;
        if (!nom) return res.status(400).json({ success: false, error: "Nom de la caisse requis" });
        const now = admin.firestore.FieldValue.serverTimestamp();
        const docRef = await db_firestore.collection("caisse_definitions").add({
          nom, description: description || "", solde_initial: 0, solde_actuel: 0,
          devise: "MAD", is_default: false, active: true,
          created_by: userInfo, created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: docRef.id });
      }

      // ========== UPDATE CAISSE ==========
      if (action === "update-caisse" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut modifier une caisse" });
        const { id, nom, description } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        const updates = { updated_at: admin.firestore.FieldValue.serverTimestamp() };
        if (nom !== undefined) updates.nom = nom;
        if (description !== undefined) updates.description = description;
        await db_firestore.collection("caisse_definitions").doc(id).update(updates);
        return res.json({ success: true });
      }

      // ========== LIST TRANSACTIONS ==========
      if (action === "list-transactions") {
        const caisseId = req.query.caisse_id;
        const status = req.query.status;
        const dateFrom = req.query.date_from;
        const dateTo = req.query.date_to;
        const limit = parseInt(req.query.limit) || 100;

        let query = db_firestore.collection("caisse_transactions");
        if (caisseId) query = query.where("caisse_id", "==", caisseId);
        if (status) query = query.where("status", "==", status);
        if (dateFrom) query = query.where("date", ">=", dateFrom);
        if (dateTo) query = query.where("date", "<=", dateTo);
        query = query.orderBy("date", "desc").limit(limit);

        const snap = await query.get();
        const transactions = snap.docs.map(d => {
          const data = d.data();
          return { id: d.id, ...data, created_at: data.created_at?.toMillis?.() || data.created_at, updated_at: data.updated_at?.toMillis?.() || data.updated_at };
        });
        return res.json({ success: true, transactions });
      }

      // ========== CREATE TRANSACTION ==========
      if (action === "create-transaction" && req.method === "POST") {
        if (!isSaisie && !isAdmin) return res.status(403).json({ success: false, error: "Seul le service Achats peut saisir des transactions" });
        const { caisse_id, type, montant, reference, description, code_analytique, date, files, submit,
          matricule, beneficiaire_nom } = req.body;
        if (!caisse_id || !type || !montant || !date) return res.status(400).json({ success: false, error: "caisse_id, type, montant et date sont requis" });
        if (!["alimentation", "depense", "sortie", "paie", "transport"].includes(type)) return res.status(400).json({ success: false, error: "Type invalide" });
        if (montant <= 0) return res.status(400).json({ success: false, error: "Le montant doit être positif" });

        // Verify caisse exists
        const caisseDoc = await db_firestore.collection("caisse_definitions").doc(caisse_id).get();
        if (!caisseDoc.exists || !caisseDoc.data().active) return res.status(404).json({ success: false, error: "Caisse introuvable" });

        // Generate reference if not provided
        const refNum = reference || `REF-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

        const now = admin.firestore.FieldValue.serverTimestamp();
        const status = submit ? "soumis" : "brouillon";
        const txData = {
          caisse_id, type, montant: parseFloat(montant), reference: refNum,
          description: description || "", code_analytique: code_analytique || "",
          matricule: matricule || "", beneficiaire_nom: beneficiaire_nom || "",
          date, status, files: (files || []).slice(0, 3), // Max 3 files
          saisie_by: userInfo, created_at: now, updated_at: now,
          history: [{ action: "creation", by: userInfo, at: Date.now() }],
        };
        if (submit) {
          txData.soumis_par = userInfo;
          txData.soumis_at = now;
          txData.history.push({ action: "soumission", by: userInfo, at: Date.now() });
        }

        const docRef = await db_firestore.collection("caisse_transactions").add(txData);
        return res.json({ success: true, id: docRef.id, reference: refNum });
      }

      // ========== UPDATE TRANSACTION ==========
      if (action === "update-transaction" && req.method === "POST") {
        if (!isSaisie && !isAdmin) return res.status(403).json({ success: false, error: "Seul le service Achats peut modifier des transactions" });
        const { id, caisse_id, type, montant, reference, description, code_analytique, date, files } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });

        const doc = await db_firestore.collection("caisse_transactions").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const current = doc.data();

        // Can only edit own brouillon or rejete
        if (!["brouillon", "rejete"].includes(current.status)) return res.status(400).json({ success: false, error: "Seul un brouillon ou une transaction rejetée peut être modifié" });
        if (current.saisie_by?.uid !== authUser.uid && !isAdmin) return res.status(403).json({ success: false, error: "Vous ne pouvez modifier que vos propres transactions" });

        const updates = { updated_at: admin.firestore.FieldValue.serverTimestamp() };
        if (caisse_id) updates.caisse_id = caisse_id;
        if (type) updates.type = type;
        if (montant) updates.montant = parseFloat(montant);
        if (reference) updates.reference = reference;
        if (description !== undefined) updates.description = description;
        if (code_analytique !== undefined) updates.code_analytique = code_analytique;
        if (date) updates.date = date;
        if (files) updates.files = files.slice(0, 3);
        updates.history = [...(current.history || []), { action: "modification", by: userInfo, at: Date.now() }];

        await db_firestore.collection("caisse_transactions").doc(id).update(updates);
        return res.json({ success: true });
      }

      // ========== SUBMIT TRANSACTION ==========
      if (action === "submit-transaction" && req.method === "POST") {
        if (!isSaisie && !isAdmin) return res.status(403).json({ success: false, error: "Seul le service Achats peut soumettre" });
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });

        const doc = await db_firestore.collection("caisse_transactions").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const current = doc.data();

        if (!["brouillon", "rejete"].includes(current.status)) return res.status(400).json({ success: false, error: "Seul un brouillon ou une transaction rejetée peut être soumis" });
        if (current.saisie_by?.uid !== authUser.uid && !isAdmin) return res.status(403).json({ success: false, error: "Vous ne pouvez soumettre que vos propres transactions" });

        const now = admin.firestore.FieldValue.serverTimestamp();
        await db_firestore.collection("caisse_transactions").doc(id).update({
          status: "soumis", soumis_par: userInfo, soumis_at: now, updated_at: now,
          history: [...(current.history || []), { action: "soumission", by: userInfo, at: Date.now() }],
        });
        return res.json({ success: true });
      }

      // ========== VALIDATE TRANSACTION ==========
      if (action === "validate-transaction" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut valider" });
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });

        // Atomic: update status + update caisse balance
        await db_firestore.runTransaction(async (t) => {
          const txRef = db_firestore.collection("caisse_transactions").doc(id);
          const txDoc = await t.get(txRef);
          if (!txDoc.exists) throw new Error("Transaction introuvable");
          const txData = txDoc.data();
          if (txData.status !== "soumis") throw new Error("Seule une transaction soumise peut être validée");

          const caisseRef = db_firestore.collection("caisse_definitions").doc(txData.caisse_id);
          const caisseDoc = await t.get(caisseRef);
          if (!caisseDoc.exists) throw new Error("Caisse introuvable");

          // Calculate balance change
          const montant = txData.montant || 0;
          let delta = 0;
          if (txData.type === "alimentation" || txData.type === "transfer_in") delta = montant;
          else if (["depense", "sortie", "transfer_out", "paie", "transport"].includes(txData.type)) delta = -montant;

          const newSolde = (caisseDoc.data().solde_actuel || 0) + delta;

          t.update(txRef, {
            status: "valide", valide_par: userInfo, valide_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
            history: [...(txData.history || []), { action: "validation", by: userInfo, at: Date.now() }],
          });
          t.update(caisseRef, { solde_actuel: newSolde, updated_at: admin.firestore.FieldValue.serverTimestamp() });
        });

        return res.json({ success: true });
      }

      // ========== REJECT TRANSACTION ==========
      if (action === "reject-transaction" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut rejeter" });
        const { id, motif } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        if (!motif) return res.status(400).json({ success: false, error: "Motif de rejet requis" });

        const doc = await db_firestore.collection("caisse_transactions").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const current = doc.data();
        if (current.status !== "soumis") return res.status(400).json({ success: false, error: "Seule une transaction soumise peut être rejetée" });

        const now = admin.firestore.FieldValue.serverTimestamp();
        await db_firestore.collection("caisse_transactions").doc(id).update({
          status: "rejete", rejete_par: userInfo, rejete_at: now, motif_rejet: motif, updated_at: now,
          history: [...(current.history || []), { action: "rejet", by: userInfo, at: Date.now(), motif }],
        });
        return res.json({ success: true });
      }

      // ========== DELETE TRANSACTION ==========
      if (action === "delete-transaction" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });

        const doc = await db_firestore.collection("caisse_transactions").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const current = doc.data();

        if (current.status !== "brouillon") return res.status(400).json({ success: false, error: "Seul un brouillon peut être supprimé" });
        if (current.saisie_by?.uid !== authUser.uid && !isAdmin) return res.status(403).json({ success: false, error: "Vous ne pouvez supprimer que vos propres brouillons" });

        await db_firestore.collection("caisse_transactions").doc(id).delete();
        return res.json({ success: true });
      }

      // ========== CREATE TRANSFER ==========
      if (action === "create-transfer" && req.method === "POST") {
        if (!isSaisie && !isAdmin) return res.status(403).json({ success: false, error: "Seul le service Achats peut créer des transferts" });
        const { from_caisse_id, to_caisse_id, montant, description, date, submit } = req.body;
        if (!from_caisse_id || !to_caisse_id || !montant || !date) return res.status(400).json({ success: false, error: "from_caisse_id, to_caisse_id, montant et date requis" });
        if (from_caisse_id === to_caisse_id) return res.status(400).json({ success: false, error: "La caisse source et destination doivent être différentes" });
        if (montant <= 0) return res.status(400).json({ success: false, error: "Le montant doit être positif" });

        // Verify both caisses exist
        const [fromDoc, toDoc] = await Promise.all([
          db_firestore.collection("caisse_definitions").doc(from_caisse_id).get(),
          db_firestore.collection("caisse_definitions").doc(to_caisse_id).get(),
        ]);
        if (!fromDoc.exists || !fromDoc.data().active) return res.status(404).json({ success: false, error: "Caisse source introuvable" });
        if (!toDoc.exists || !toDoc.data().active) return res.status(404).json({ success: false, error: "Caisse destination introuvable" });

        const transferId = `TRF-${Date.now().toString(36).toUpperCase()}`;
        const refOut = `${transferId}-OUT`;
        const refIn = `${transferId}-IN`;
        const now = admin.firestore.FieldValue.serverTimestamp();
        const status = submit ? "soumis" : "brouillon";
        const historyBase = [{ action: "creation", by: userInfo, at: Date.now() }];
        if (submit) historyBase.push({ action: "soumission", by: userInfo, at: Date.now() });

        const batch = db_firestore.batch();

        const outRef = db_firestore.collection("caisse_transactions").doc();
        const inRef = db_firestore.collection("caisse_transactions").doc();

        batch.set(outRef, {
          caisse_id: from_caisse_id, type: "transfer_out", montant: parseFloat(montant),
          reference: refOut, description: description || `Transfert vers ${toDoc.data().nom}`,
          code_analytique: "", date, status,
          transfer_linked_id: inRef.id, transfer_caisse_dest: to_caisse_id,
          files: [], saisie_by: userInfo, created_at: now, updated_at: now,
          ...(submit ? { soumis_par: userInfo, soumis_at: now } : {}),
          history: [...historyBase],
        });

        batch.set(inRef, {
          caisse_id: to_caisse_id, type: "transfer_in", montant: parseFloat(montant),
          reference: refIn, description: description || `Transfert depuis ${fromDoc.data().nom}`,
          code_analytique: "", date, status,
          transfer_linked_id: outRef.id, transfer_caisse_dest: from_caisse_id,
          files: [], saisie_by: userInfo, created_at: now, updated_at: now,
          ...(submit ? { soumis_par: userInfo, soumis_at: now } : {}),
          history: [...historyBase],
        });

        await batch.commit();
        return res.json({ success: true, transferId, outId: outRef.id, inId: inRef.id });
      }

      // ========== WEEKLY REPORT ==========
      if (action === "weekly-report") {
        const weekStart = req.query.week_start; // YYYY-MM-DD (Saturday)
        if (!weekStart) return res.status(400).json({ success: false, error: "week_start (YYYY-MM-DD) requis" });

        // Calculate week end (Friday)
        const startDate = new Date(weekStart);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        const weekEnd = endDate.toISOString().slice(0, 10);

        // Get all caisses
        const caissesSnap = await db_firestore.collection("caisse_definitions").where("active", "==", true).get();
        const caisses = caissesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Get all validated transactions in the week
        const txSnap = await db_firestore.collection("caisse_transactions")
          .where("status", "==", "valide")
          .where("date", ">=", weekStart)
          .where("date", "<=", weekEnd)
          .get();
        const transactions = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Get all validated transactions before the week (for opening balance calculation)
        const beforeTxSnap = await db_firestore.collection("caisse_transactions")
          .where("status", "==", "valide")
          .where("date", "<", weekStart)
          .get();

        // Build report per caisse
        const report = caisses.map(c => {
          // Opening balance: initial + all transactions before week
          let soldeOuverture = c.solde_initial || 0;
          beforeTxSnap.docs.forEach(d => {
            const tx = d.data();
            if (tx.caisse_id !== c.id) return;
            if (tx.type === "alimentation" || tx.type === "transfer_in") soldeOuverture += (tx.montant || 0);
            else if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") soldeOuverture -= (tx.montant || 0);
          });

          const caisseTx = transactions.filter(tx => tx.caisse_id === c.id);
          let alimentations = 0, depenses = 0, sorties = 0, transfersIn = 0, transfersOut = 0;
          caisseTx.forEach(tx => {
            if (tx.type === "alimentation") alimentations += (tx.montant || 0);
            if (tx.type === "depense") depenses += (tx.montant || 0);
            if (tx.type === "sortie") sorties += (tx.montant || 0);
            if (tx.type === "transfer_in") transfersIn += (tx.montant || 0);
            if (tx.type === "transfer_out") transfersOut += (tx.montant || 0);
          });

          const soldeCloture = soldeOuverture + alimentations + transfersIn - depenses - sorties - transfersOut;

          return {
            caisse_id: c.id, nom: c.nom,
            solde_ouverture: soldeOuverture, solde_cloture: soldeCloture,
            alimentations, depenses, sorties, transfers_in: transfersIn, transfers_out: transfersOut,
            nb_transactions: caisseTx.length, transactions: caisseTx,
          };
        });

        return res.json({ success: true, weekStart, weekEnd, report });
      }

      // ========== IMPORT FROM EXCEL FILE ==========
      // Authenticated users (Achats/DG/Finance) can upload an Excel and have it parsed + imported.
      // Format is determined by caisse_id (each caisse has its own template).
      if (action === "import-excel-file" && req.method === "POST") {
        const { caisse_id, file_base64, format: requestedFormat, force_overwrite, dry_run } = req.body;
        if (!caisse_id) return res.status(400).json({ success: false, error: "caisse_id requis" });
        if (!file_base64) return res.status(400).json({ success: false, error: "file_base64 requis" });

        const CAISSE_FORMATS = {
          caisse_depenses: "depenses_monthly",
          caisse_paie: "paie_recap",
          caisse_depenses_bahia: "bahia_single",
        };
        const format = requestedFormat || CAISSE_FORMATS[caisse_id];
        if (!format) return res.status(400).json({ success: false, error: `Aucun format Excel défini pour ${caisse_id}` });

        const XLSX = require("xlsx");
        let buffer;
        try {
          const b64 = file_base64.replace(/^data:[^;]+;base64,/, "");
          buffer = Buffer.from(b64, "base64");
        } catch (e) {
          return res.status(400).json({ success: false, error: "file_base64 invalide" });
        }

        const wb = XLSX.read(buffer, { type: "buffer" });

        let parsed;
        try {
          parsed = caisseImport.parseWorkbook(wb, { caisse_id, format, XLSX });
        } catch (parseErr) {
          console.error("Erreur parsing Excel:", parseErr);
          return res.status(400).json({ success: false, error: "Erreur parsing Excel: " + parseErr.message });
        }
        const { transactions, resetSoldeInitial, perSheet, warnings, ignoredSheets } = parsed;

        if (transactions.length === 0) {
          return res.json({ success: false, error: "Aucune transaction trouvée dans le fichier" });
        }

        const caisseRef = db_firestore.collection("caisse_definitions").doc(caisse_id);
        const caisseDoc = await caisseRef.get();
        if (!caisseDoc.exists) return res.status(404).json({ success: false, error: "Caisse introuvable: " + caisse_id });

        // --- Mode DRY-RUN : prévisualisation sans écriture ---
        // Réutilise STRICTEMENT le même parsing que l'import réel. Aucune écriture Firestore.
        if (dry_run) {
          const soldeInitialActuel = caisseDoc.data().solde_initial || 0;
          // totaux actuels (tx validées existantes)
          const curSnap = await db_firestore.collection("caisse_transactions")
            .where("caisse_id", "==", caisse_id).where("status", "==", "valide").get();
          let totalInActuel = 0, totalOutActuel = 0;
          curSnap.docs.forEach(d => {
            const tx = d.data();
            if (tx.type === "alimentation" || tx.type === "transfer_in") totalInActuel += (tx.montant || 0);
            else if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") totalOutActuel += (tx.montant || 0);
          });
          // détecter les external_id déjà présents (lecture seule, par lots de 400)
          const existingIds = new Set();
          for (let i = 0; i < transactions.length; i += 400) {
            const slice = transactions.slice(i, i + 400);
            const refs = slice.map(tx => db_firestore.collection("caisse_transactions").doc(tx.external_id));
            const docs = await Promise.all(refs.map(r => r.get()));
            docs.forEach((d, idx) => { if (d.exists) existingIds.add(slice[idx].external_id); });
          }
          const summary = caisseImport.buildDrySummary(
            { transactions, perSheet, warnings, ignoredSheets, resetSoldeInitial, format },
            { caisse_id, soldeInitialActuel, totalInActuel, totalOutActuel, existingIds, force_overwrite: !!force_overwrite }
          );
          return res.json(summary);
        }

        if (typeof resetSoldeInitial === "number") {
          await caisseRef.update({ solde_initial: resetSoldeInitial, updated_at: admin.firestore.FieldValue.serverTimestamp() });
        }

        let imported = 0, skipped = 0;
        const BATCH_SIZE = 400;
        for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
          const slice = transactions.slice(i, i + BATCH_SIZE);
          const refs = slice.map(tx => db_firestore.collection("caisse_transactions").doc(tx.external_id));
          const docs = await Promise.all(refs.map(r => r.get()));
          const batch = db_firestore.batch();
          slice.forEach((tx, idx) => {
            if (docs[idx].exists && !force_overwrite) { skipped++; return; }
            const now = Date.now();
            batch.set(refs[idx], {
              caisse_id: tx.caisse_id, type: tx.type, montant: tx.montant,
              reference: tx.reference || "", description: tx.description || "",
              code_analytique: tx.code_analytique || "", fournisseur: tx.fournisseur || "",
              date: tx.date, status: "valide", files: [],
              saisie_by: userInfo, soumis_par: userInfo, valide_par: userInfo,
              soumis_at: admin.firestore.FieldValue.serverTimestamp(),
              valide_at: admin.firestore.FieldValue.serverTimestamp(),
              created_at: admin.firestore.FieldValue.serverTimestamp(),
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
              history: [
                { action: "import_excel", by: userInfo, at: now, source: tx._meta || {} },
                { action: "validation", by: userInfo, at: now },
              ],
              _import_meta: tx._meta || {},
            });
            imported++;
          });
          await batch.commit();
        }

        const allTxSnap = await db_firestore.collection("caisse_transactions")
          .where("caisse_id", "==", caisse_id).where("status", "==", "valide").get();
        let totalIn = 0, totalOut = 0;
        allTxSnap.docs.forEach(d => {
          const tx = d.data();
          if (tx.type === "alimentation" || tx.type === "transfer_in") totalIn += (tx.montant || 0);
          else if (tx.type === "depense" || tx.type === "sortie" || tx.type === "transfer_out") totalOut += (tx.montant || 0);
        });
        const updatedDoc = await caisseRef.get();
        const soldeInitial = updatedDoc.data().solde_initial || 0;
        const soldeActuel = soldeInitial + totalIn - totalOut;
        await caisseRef.update({ solde_actuel: soldeActuel, updated_at: admin.firestore.FieldValue.serverTimestamp() });

        return res.json({
          success: true, imported, skipped, parsed: transactions.length,
          total_transactions: allTxSnap.size,
          solde_initial: soldeInitial, solde_actuel: soldeActuel,
          total_in: totalIn, total_out: totalOut, format,
          per_sheet: perSheet.map(s => ({
            key: s.key, label: s.label, rows_parsed: s.rows_parsed,
            alimentations: s.alimentations, depenses: s.depenses,
            montant_in: s.montant_in, montant_out: s.montant_out, warnings: s.warnings.length,
          })),
          warnings, ignored_sheets: ignoredSheets,
        });
      }

      // ========== SEED DEFAULT CAISSES ==========
      if (action === "seed-defaults" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Accès refusé" });
        const defaults = [
          { id: "caisse_paie", nom: "Caisse Paie", description: "Caisse pour les paiements salariaux" },
          { id: "caisse_depenses", nom: "Caisse Dépenses", description: "Caisse pour les dépenses courantes" },
          { id: "caisse_marche_local_f1", nom: "Caisse Marché Local F1", description: "Caisse du marché local Ferme 1" },
          { id: "caisse_marche_local_f5", nom: "Caisse Marché Local F5", description: "Caisse du marché local Ferme 5" },
        ];
        const now = admin.firestore.FieldValue.serverTimestamp();
        const batch = db_firestore.batch();
        for (const c of defaults) {
          const ref = db_firestore.collection("caisse_definitions").doc(c.id);
          const existing = await ref.get();
          if (!existing.exists) {
            batch.set(ref, {
              nom: c.nom, description: c.description, solde_initial: 0, solde_actuel: 0,
              devise: "MAD", is_default: true, active: true,
              created_by: userInfo, created_at: now, updated_at: now,
            });
          }
        }
        await batch.commit();
        return res.json({ success: true, message: "Caisses par défaut créées" });
      }

      // =============================================================
      // Sprint 2 — Batch actions for control workflow
      // =============================================================
      // Helper: chunk an array into pieces of <= 400 (Firestore batch limit = 500, margin 100)
      function _chunkIds(ids) {
        const out = [];
        for (let i = 0; i < ids.length; i += 400) out.push(ids.slice(i, i + 400));
        return out;
      }

      // Helper: build a history entry and persist a batch update on a list of tx ids.
      // Skips tx that don't exist or fail the optional pre-check.
      async function _applyBatchUpdate(ids, buildUpdate, opts) {
        opts = opts || {};
        let updated = 0, skipped = 0;
        const errors = [];
        const chunks = _chunkIds(ids);
        for (const chunkIds of chunks) {
          const refs = chunkIds.map(id => db_firestore.collection("caisse_transactions").doc(id));
          const snaps = await Promise.all(refs.map(r => r.get()));
          const wb = db_firestore.batch();
          let writes = 0;
          snaps.forEach((snap, i) => {
            if (!snap.exists) { skipped++; errors.push({ id: chunkIds[i], reason: "not_found" }); return; }
            const data = snap.data();
            if (opts.preCheck && !opts.preCheck(data)) { skipped++; errors.push({ id: chunkIds[i], reason: opts.preCheckReason || "pre_check_failed" }); return; }
            const updates = buildUpdate(data, chunkIds[i]);
            if (!updates) { skipped++; return; }
            wb.update(refs[i], updates);
            writes++;
            updated++;
          });
          if (writes > 0) await wb.commit();
        }
        return { updated, skipped, errors };
      }

      // ----- validate-transactions-batch -----
      // status → 'valide', valide_par, valide_at, history. DG/Finance only.
      if (action === "validate-transactions-batch" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut valider" });
        const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
        if (!ids || ids.length === 0) return res.status(400).json({ success: false, error: "ids[] requis" });
        const now = Date.now();
        const result = await _applyBatchUpdate(ids, (data) => ({
          status: "valide",
          valide_par: userInfo,
          valide_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          history: [...(data.history || []), { action: "batch_validate", by: userInfo, at: now }],
        }));
        return res.json({ success: true, count: result.updated, ...result });
      }

      // ----- mark-revoir-batch -----
      // status → 'a_revoir' (nouveau statut Sprint 2), history. DG/Finance only.
      if (action === "mark-revoir-batch" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut marquer à revoir" });
        const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
        const motif = (req.body.motif || "").toString();
        if (!ids || ids.length === 0) return res.status(400).json({ success: false, error: "ids[] requis" });
        const now = Date.now();
        const result = await _applyBatchUpdate(ids, (data) => ({
          status: "a_revoir",
          a_revoir_par: userInfo,
          a_revoir_at: admin.firestore.FieldValue.serverTimestamp(),
          a_revoir_motif: motif,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          history: [...(data.history || []), { action: "batch_mark_revoir", by: userInfo, at: now, motif }],
        }));
        return res.json({ success: true, count: result.updated, ...result });
      }

      // ----- reassign-analytique-batch -----
      // Set code_analytique on every targeted tx. DG/Finance only.
      if (action === "reassign-analytique-batch" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut réaffecter l'analytique" });
        const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
        const code = (req.body.code_analytique || "").toString().trim();
        if (!ids || ids.length === 0) return res.status(400).json({ success: false, error: "ids[] requis" });
        if (!code) return res.status(400).json({ success: false, error: "code_analytique requis" });
        const now = Date.now();
        const result = await _applyBatchUpdate(ids, (data) => ({
          code_analytique: code,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          history: [...(data.history || []), { action: "batch_reassign_analytique", by: userInfo, at: now, from: data.code_analytique || "", to: code }],
        }));
        return res.json({ success: true, count: result.updated, ...result });
      }

      // ----- accept-anomalies-batch -----
      // Mark anomalies as accepted (visible in UI as ℹ instead of 🚩). No status change.
      // Accessible aussi à Achats (les saisies peuvent reconnaître leurs propres anomalies).
      if (action === "accept-anomalies-batch" && req.method === "POST") {
        const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
        if (!ids || ids.length === 0) return res.status(400).json({ success: false, error: "ids[] requis" });
        const now = Date.now();
        const result = await _applyBatchUpdate(ids, (data) => ({
          anomalies_acceptees_par: userInfo,
          anomalies_acceptees_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          history: [...(data.history || []), { action: "batch_accept_anomalies", by: userInfo, at: now }],
        }));
        return res.json({ success: true, count: result.updated, ...result });
      }

      // =============================================================
      // Sprint 3 — Rapprochement mensuel + Avances
      // =============================================================

      // Helpers locaux
      function _periodeBounds(mois, annee) {
        // mois 1-12, annee 4 digits → bornes ISO YYYY-MM-DD inclusives
        const m = parseInt(mois, 10);
        const y = parseInt(annee, 10);
        if (!Number.isFinite(m) || m < 1 || m > 12) return null;
        if (!Number.isFinite(y) || y < 2000 || y > 2100) return null;
        const mm = String(m).padStart(2, "0");
        const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month
        return {
          from: `${y}-${mm}-01`,
          to:   `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
          docId: `${y}-${mm}`,
        };
      }

      async function _computeRapprochementTotals(caisseId, mois, annee) {
        const b = _periodeBounds(mois, annee);
        if (!b) return null;
        // Both queries wrapped in try/catch: when a required composite index
        // is still building, return a "degraded" result with totals=0 +
        // degraded flag so the UI can show a meaningful message instead of
        // crashing with a 500.
        let degraded = false;
        // Solde initial = somme des tx valide < from
        let soldeInitial = 0;
        try {
          const beforeSnap = await db_firestore.collection("caisse_transactions")
            .where("caisse_id", "==", caisseId)
            .where("status", "==", "valide")
            .where("date", "<", b.from)
            .get();
          beforeSnap.docs.forEach(d => {
            const t = d.data();
            const m = Number(t.montant) || 0;
            if (t.type === "alimentation" || t.type === "transfer_in") soldeInitial += m;
            else if (t.type === "depense" || t.type === "sortie" || t.type === "transfer_out") soldeInitial -= m;
          });
        } catch (e) {
          console.warn("[rapprochement] solde-initial query failed (likely index building):", e.message);
          degraded = true;
        }
        // Période : valide ET en attente (pour pouvoir lister les bloquants)
        let totalRecettes = 0, totalDepenses = 0;
        const blocking = []; // tx avec status != valide
        try {
          const periodSnap = await db_firestore.collection("caisse_transactions")
            .where("caisse_id", "==", caisseId)
            .where("date", ">=", b.from)
            .where("date", "<=", b.to)
            .get();
          periodSnap.docs.forEach(d => {
            const t = d.data();
            const m = Number(t.montant) || 0;
            if (t.status !== "valide") {
              blocking.push({ id: d.id, reference: t.reference || "", description: t.description || "", date: t.date || "", status: t.status || "", montant: m, type: t.type });
              return;
            }
            if (t.type === "alimentation" || t.type === "transfer_in") totalRecettes += m;
            else if (t.type === "depense" || t.type === "sortie" || t.type === "transfer_out") totalDepenses += m;
          });
        } catch (e) {
          console.warn("[rapprochement] period query failed (likely index building):", e.message);
          degraded = true;
        }
        const soldeTheorique = soldeInitial + totalRecettes - totalDepenses;
        return {
          periode: b,
          degraded,
          solde_initial: Number(soldeInitial.toFixed(2)),
          total_recettes: Number(totalRecettes.toFixed(2)),
          total_depenses: Number(totalDepenses.toFixed(2)),
          solde_theorique: Number(soldeTheorique.toFixed(2)),
          blocking_count: blocking.length,
          blocking_transactions: blocking,
        };
      }

      // ---- rapprochement-get (GET) ----
      if (action === "rapprochement-get") {
        const caisseId = req.query.caisse_id;
        const mois = req.query.mois;
        const annee = req.query.annee;
        if (!caisseId || !mois || !annee) return res.status(400).json({ success: false, error: "caisse_id + mois + annee requis" });
        const totals = await _computeRapprochementTotals(caisseId, mois, annee);
        if (!totals) return res.status(400).json({ success: false, error: "mois/annee invalides" });
        // Lit le doc rapprochement existant si présent
        const docId = `${caisseId}_${totals.periode.docId}`;
        const doc = await db_firestore.collection("caisse_rapprochements").doc(docId).get();
        const saved = doc.exists ? doc.data() : null;
        return res.json({
          success: true,
          caisse_id: caisseId,
          mois: parseInt(mois, 10),
          annee: parseInt(annee, 10),
          periode: totals.periode,
          totals: {
            solde_initial: totals.solde_initial,
            total_recettes: totals.total_recettes,
            total_depenses: totals.total_depenses,
            solde_theorique: totals.solde_theorique,
          },
          blocking_count: totals.blocking_count,
          blocking_transactions: totals.blocking_transactions,
          rapprochement: saved, // null si pas encore saisi
        });
      }

      // ---- rapprochement-save (POST) ----
      // Sauvegarde solde_physique + commentaire, statut reste 'ouvert'.
      if (action === "rapprochement-save" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut éditer un rapprochement" });
        const { caisse_id, mois, annee, solde_physique, commentaire } = req.body;
        if (!caisse_id || !mois || !annee || solde_physique === undefined) return res.status(400).json({ success: false, error: "caisse_id + mois + annee + solde_physique requis" });
        const totals = await _computeRapprochementTotals(caisse_id, mois, annee);
        if (!totals) return res.status(400).json({ success: false, error: "mois/annee invalides" });
        const sp = Number(solde_physique);
        if (!Number.isFinite(sp)) return res.status(400).json({ success: false, error: "solde_physique doit être un nombre" });
        const ecart = Number((sp - totals.solde_theorique).toFixed(2));
        if (Math.abs(ecart) > 0.005 && (!commentaire || !String(commentaire).trim())) {
          return res.status(400).json({ success: false, error: "Commentaire obligatoire si écart != 0" });
        }
        const docId = `${caisse_id}_${totals.periode.docId}`;
        const ref = db_firestore.collection("caisse_rapprochements").doc(docId);
        const existing = await ref.get();
        if (existing.exists && existing.data().statut === "cloture") {
          return res.status(400).json({ success: false, error: "Rapprochement déjà clôturé" });
        }
        const now = admin.firestore.FieldValue.serverTimestamp();
        const payload = {
          caisse_id, periode: { mois: parseInt(mois, 10), annee: parseInt(annee, 10) },
          solde_initial: totals.solde_initial,
          total_recettes: totals.total_recettes,
          total_depenses: totals.total_depenses,
          solde_theorique: totals.solde_theorique,
          solde_physique: sp,
          ecart,
          commentaire: String(commentaire || "").trim(),
          statut: "ouvert",
          updated_at: now,
          updated_by: userInfo,
          ...(existing.exists ? {} : { created_at: now, created_by: userInfo }),
        };
        await ref.set(payload, { merge: true });
        return res.json({ success: true, id: docId, rapprochement: payload });
      }

      // ---- rapprochement-cloture (POST) ----
      // Bloque si transactions non-validées dans la période.
      if (action === "rapprochement-cloture" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut clôturer un rapprochement" });
        const { caisse_id, mois, annee } = req.body;
        if (!caisse_id || !mois || !annee) return res.status(400).json({ success: false, error: "caisse_id + mois + annee requis" });
        const totals = await _computeRapprochementTotals(caisse_id, mois, annee);
        if (!totals) return res.status(400).json({ success: false, error: "mois/annee invalides" });
        if (totals.blocking_count > 0) {
          return res.status(400).json({
            success: false,
            error: `Impossible de clôturer : ${totals.blocking_count} transaction(s) non validées dans la période.`,
            blocking_count: totals.blocking_count,
            blocking_transactions: totals.blocking_transactions,
          });
        }
        const docId = `${caisse_id}_${totals.periode.docId}`;
        const ref = db_firestore.collection("caisse_rapprochements").doc(docId);
        const existing = await ref.get();
        if (!existing.exists) return res.status(400).json({ success: false, error: "Rapprochement non saisi (solde physique manquant) — sauvegardez d'abord." });
        const data = existing.data();
        if (data.statut === "cloture") return res.status(400).json({ success: false, error: "Déjà clôturé" });
        if (Math.abs(Number(data.ecart) || 0) > 0.005 && (!data.commentaire || !String(data.commentaire).trim())) {
          return res.status(400).json({ success: false, error: "Commentaire obligatoire si écart != 0" });
        }
        await ref.update({
          statut: "cloture",
          cloture_par: userInfo,
          cloture_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true, id: docId });
      }

      // ---- rapprochement-list (GET, optional) ----
      // Liste des rapprochements existants, triés DESC par période.
      if (action === "rapprochement-list") {
        const caisseId = req.query.caisse_id;
        let q = db_firestore.collection("caisse_rapprochements");
        if (caisseId) q = q.where("caisse_id", "==", caisseId);
        const snap = await q.get();
        const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        items.sort((a, b) => {
          const ka = (a.periode && (a.periode.annee * 100 + a.periode.mois)) || 0;
          const kb = (b.periode && (b.periode.annee * 100 + b.periode.mois)) || 0;
          return kb - ka;
        });
        return res.json({ success: true, items });
      }

      // ---- avances-liste (GET) ----
      // Retourne la liste des transactions d'avance pour aggregateAvances côté client.
      // Filtres : caisse_id (optional), status=valide, type=depense, description match avance keyword.
      if (action === "avances-liste") {
        const caisseId = req.query.caisse_id;
        let q = db_firestore.collection("caisse_transactions")
          .where("status", "==", "valide")
          .where("type", "==", "depense");
        if (caisseId) q = q.where("caisse_id", "==", caisseId);
        const snap = await q.get();
        const transactions = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id, ...data,
            created_at: data.created_at && data.created_at.toMillis ? data.created_at.toMillis() : data.created_at,
            updated_at: data.updated_at && data.updated_at.toMillis ? data.updated_at.toMillis() : data.updated_at,
          };
        }).filter(t => {
          const d = (t.description || "").trim();
          return /^(avances?|acomptes?)\b/i.test(d);
        });
        return res.json({ success: true, transactions });
      }

      // ---- avance-regulariser (POST) ----
      // Ajoute une entrée dans regularisations[] sur la tx d'avance.
      if (action === "avance-regulariser" && req.method === "POST") {
        if (!isControle && !isAdmin) return res.status(403).json({ success: false, error: "Seul DG/Finance peut régulariser une avance" });
        const { tx_id, montant, ref: regRef, commentaire } = req.body;
        if (!tx_id) return res.status(400).json({ success: false, error: "tx_id requis" });
        const m = Number(montant);
        if (!Number.isFinite(m) || m <= 0) return res.status(400).json({ success: false, error: "montant > 0 requis" });
        const ref = db_firestore.collection("caisse_transactions").doc(tx_id);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Transaction introuvable" });
        const data = doc.data();
        if (data.type !== "depense" || data.status !== "valide") {
          return res.status(400).json({ success: false, error: "La transaction doit être une dépense validée." });
        }
        const regs = Array.isArray(data.regularisations) ? data.regularisations.slice() : [];
        const sumExisting = regs.reduce((s, r) => s + (Number(r && r.montant) || 0), 0);
        const restant = (Number(data.montant) || 0) - sumExisting;
        if (m > restant + 0.005) {
          return res.status(400).json({ success: false, error: `Montant dépasse le solde dû (${restant.toFixed(2)} DH restant).` });
        }
        const now = Date.now();
        const newReg = {
          montant: Number(m.toFixed(2)),
          ref: String(regRef || "").trim(),
          commentaire: String(commentaire || "").trim(),
          regularise_par: userInfo,
          regularise_at: now,
        };
        regs.push(newReg);
        await ref.update({
          regularisations: regs,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          history: [...(data.history || []), { action: "regularisation_avance", by: userInfo, at: now, montant: newReg.montant, ref: newReg.ref }],
        });
        return res.json({ success: true, regularisation: newReg, total_regularise: sumExisting + newReg.montant, solde_du: restant - newReg.montant });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur caisseManagement:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

// =============================================
// WhatsApp — Firestore trigger on alerts + admin config API
// =============================================

/**
 * onAlertCreated — Firestore trigger that sends WhatsApp for new alerts.
 */
exports.onAlertCreated = functions
  .region("europe-west1")
  .firestore.document("alerts/{alertId}")
  .onCreate(async (snap) => {
    const alert = snap.data();
    if (!alert.profiles || alert.profiles.length === 0) return;
    // Skip if dispatcher already sent WhatsApp for this alert (avoid double send)
    if (alert.whatsapp_dispatched) return;
    const type = alert.type === "expedition_manquante" ? "quality_alert" : "general_alert";
    await dispatchNotification({
      type,
      profiles: alert.profiles,
      data: { message: alert.message || "Nouvelle alerte" },
      channels: ["whatsapp"], // in-app alert already exists
    }).catch(err => console.error("WhatsApp onAlertCreated error:", err));
  });

/**
 * whatsappAdmin — Admin API for WhatsApp configuration.
 * Actions: get-config, update-config, test-message, get-logs
 */
exports.whatsappAdmin = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 30, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const decoded = await verifyAuth(req);
      if (!decoded) return res.status(401).json({ success: false, error: "Non authentifié" });

      const callerDoc = await db_firestore.collection("users").doc(decoded.uid).get();
      if (!callerDoc.exists || callerDoc.data().role !== "admin") {
        return res.status(403).json({ success: false, error: "Accès réservé aux administrateurs" });
      }

      const action = req.query.action || "get-config";

      if (action === "get-config") {
        const doc = await db_firestore.collection("config").doc("whatsapp").get();
        const config = doc.exists ? doc.data() : {};
        // Mask the access token for security
        if (config.access_token) {
          config.access_token_masked = config.access_token.slice(0, 10) + "..." + config.access_token.slice(-4);
          delete config.access_token;
        }
        return res.json({ success: true, config });
      }

      if (action === "update-config" && req.method === "POST") {
        const { phone_number_id, waba_id, access_token, enabled, default_language } = req.body;
        const updates = { updated_at: Date.now(), updated_by: decoded.uid };
        if (phone_number_id !== undefined) updates.phone_number_id = phone_number_id;
        if (waba_id !== undefined) updates.waba_id = waba_id;
        if (access_token !== undefined && access_token !== "") updates.access_token = access_token;
        if (enabled !== undefined) updates.enabled = enabled;
        if (default_language !== undefined) updates.default_language = default_language;
        await db_firestore.collection("config").doc("whatsapp").set(updates, { merge: true });
        whatsappService.clearConfigCache();
        return res.json({ success: true });
      }

      if (action === "test-message" && req.method === "POST") {
        const { phone, template_name } = req.body;
        if (!phone) return res.status(400).json({ success: false, error: "Numéro requis" });
        const result = await whatsappService.sendTemplateMessage(
          phone,
          template_name || "general_alert",
          [template_name ? "Test depuis SmartBerry" : "Ceci est un message de test SmartBerry"]
        );
        return res.json({ success: result.success, error: result.error, waMessageId: result.waMessageId });
      }

      if (action === "simulate-template" && req.method === "POST") {
        const { template_name, params, phone, profiles, ferme, type } = req.body;
        if (!template_name) return res.status(400).json({ success: false, error: "template_name requis" });

        // Direct send to a specific phone
        if (phone) {
          const result = await whatsappService.sendTemplateMessage(phone, template_name, params || []);
          return res.json({ success: result.success, error: result.error, waMessageId: result.waMessageId });
        }

        // Dispatch via type to profiles (uses notificationDispatcher mapping)
        if (type && profiles && profiles.length > 0) {
          const { dispatchNotification } = require("./notificationDispatcher");
          // Build data object based on params for known types
          const data = req.body.data || {};
          if (params && Array.isArray(params)) {
            // Map params positionally to common fields
            data._raw_params = params;
          }
          await dispatchNotification({
            type, profiles, ferme,
            data: { ...data, message: data.message || `Test ${type}` },
            relatedDoc: `simulation/${type}-${Date.now()}`,
          });
          return res.json({ success: true });
        }

        return res.status(400).json({ success: false, error: "phone OU (type + profiles) requis" });
      }

      if (action === "test-expedition-rejected" && req.method === "POST") {
        const { ferme, variety, weightKg, reason, profiles } = req.body;
        const { dispatchNotification } = require("./notificationDispatcher");
        const dateTime = new Date().toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
        const receiptId = `RPT-TEST-${Date.now().toString().slice(-6)}`;
        await dispatchNotification({
          type: "expedition_rejected",
          profiles: profiles || ["chef", "qualite", "dg"],
          ferme: ferme || "BSAA",
          data: {
            receiptId,
            dateTime,
            variety: variety || "Sweet Sensation",
            ranch: ferme || "BSAA",
            weightKg: weightKg || "1250",
            reason: reason || "Soft fruit 18%, Bruising 12%",
            message: `Expédition ${receiptId} rejetée (TEST)`,
          },
          relatedDoc: `expeditions/TEST-${receiptId}`,
        });
        return res.json({ success: true, receiptId });
      }

      if (action === "send-welcome" && req.method === "POST") {
        const { uid } = req.body;
        if (!uid) return res.status(400).json({ success: false, error: "UID utilisateur requis" });
        const userDoc = await db_firestore.collection("users").doc(uid).get();
        if (!userDoc.exists) return res.status(404).json({ success: false, error: "Utilisateur introuvable" });
        const u = userDoc.data();
        if (!u.whatsappPhone) return res.status(400).json({ success: false, error: "Cet utilisateur n'a pas de numéro WhatsApp" });
        const firstName = (u.displayName || "").split(" ")[0] || u.displayName || u.email?.split("@")[0] || "utilisateur";
        const result = await whatsappService.sendTemplateMessage(
          u.whatsappPhone,
          "welcome_smartberry",
          [firstName]
        );
        if (result.success) {
          await db_firestore.collection("users").doc(uid).update({ welcome_sent_at: Date.now() });
        }
        return res.json({ success: result.success, error: result.error });
      }

      if (action === "send-welcome-all" && req.method === "POST") {
        const { force } = req.body || {};
        const snap = await db_firestore.collection("users").get();
        let sent = 0, skipped = 0, failed = 0;
        const errors = [];
        for (const doc of snap.docs) {
          const u = doc.data();
          if (!u.whatsappPhone || u.disabled) { skipped++; continue; }
          if (!force && u.welcome_sent_at) { skipped++; continue; }
          const firstName = (u.displayName || "").split(" ")[0] || u.displayName || u.email?.split("@")[0] || "utilisateur";
          const result = await whatsappService.sendTemplateMessage(
            u.whatsappPhone,
            "welcome_smartberry",
            [firstName]
          );
          if (result.success) {
            sent++;
            await db_firestore.collection("users").doc(doc.id).update({ welcome_sent_at: Date.now() });
          } else {
            failed++;
            errors.push({ user: u.displayName || u.email, error: result.error });
          }
          await new Promise(r => setTimeout(r, 200));
        }
        return res.json({ success: true, sent, skipped, failed, errors });
      }

      if (action === "get-logs") {
        const limit = parseInt(req.query.limit) || 50;
        const snap = await db_firestore.collection("whatsapp_logs")
          .orderBy("sentAt", "desc").limit(limit).get();
        const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, logs });
      }

      if (action === "retry-log" && req.method === "POST") {
        const { log_id } = req.body;
        if (!log_id) return res.status(400).json({ success: false, error: "log_id requis" });
        const logDoc = await db_firestore.collection("whatsapp_logs").doc(log_id).get();
        if (!logDoc.exists) return res.status(404).json({ success: false, error: "Log introuvable" });
        const log = logDoc.data();
        if (log.retried_at) return res.status(400).json({ success: false, error: "Ce message a déjà été retenté" });
        const result = await whatsappService.sendTemplateMessage(
          log.to,
          log.templateName,
          log.params || []
        );
        if (result.success) {
          await db_firestore.collection("whatsapp_logs").doc(log_id).update({
            retried_at: Date.now(),
            retry_message_id: result.waMessageId || null,
          });
        }
        return res.json({ success: result.success, error: result.error, waMessageId: result.waMessageId });
      }

      if (action === "get-messages") {
        const limit = parseInt(req.query.limit) || 50;
        const snap = await db_firestore.collection("whatsapp_messages")
          .orderBy("receivedAt", "desc").limit(limit).get();
        const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, messages });
      }

      if (action === "generate-verify-token" && req.method === "POST") {
        const token = require("crypto").randomBytes(32).toString("hex");
        await db_firestore.collection("config").doc("whatsapp").set(
          { webhook_verify_token: token, updated_at: Date.now() }, { merge: true }
        );
        whatsappService.clearConfigCache();
        return res.json({ success: true, verify_token: token });
      }

      if (action === "get-verify-token") {
        const doc = await db_firestore.collection("config").doc("whatsapp").get();
        const verify_token = doc.exists ? doc.data().webhook_verify_token : null;
        return res.json({ success: true, verify_token });
      }

      return res.status(400).json({ success: false, error: "Action inconnue: " + action });
    } catch (err) {
      console.error("Erreur whatsappAdmin:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

/**
 * whatsappWebhook — Receives status updates and incoming messages from Meta.
 *
 * GET: verification challenge (Meta sends ?hub.verify_token=...&hub.challenge=...)
 * POST: notification payload with statuses[] or messages[]
 *
 * Setup in Meta App → WhatsApp → Configuration:
 *   URL: https://europe-west1-berrygood-farms-dashboard.cloudfunctions.net/whatsappWebhook
 *   Verify token: stored in config/whatsapp.webhook_verify_token
 *   Subscribe to: messages, message_status
 */
const WA_INCOMING_TOPIC = "whatsapp-incoming";
let _pubsubClient = null;
function getPubSub() {
  if (!_pubsubClient) {
    const { PubSub } = require("@google-cloud/pubsub");
    _pubsubClient = new PubSub();
  }
  return _pubsubClient;
}

exports.whatsappWebhook = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 15, memory: "256MB", minInstances: 1 })
  .https.onRequest(async (req, res) => {
    try {
      // GET — verification handshake
      if (req.method === "GET") {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];
        const configDoc = await db_firestore.collection("config").doc("whatsapp").get();
        const expectedToken = configDoc.exists ? configDoc.data().webhook_verify_token : null;
        if (mode === "subscribe" && token && token === expectedToken) {
          console.log("Webhook verified");
          return res.status(200).send(challenge);
        }
        return res.status(403).send("Forbidden");
      }

      // POST — publish to Pub/Sub and ack immediately
      if (req.method === "POST") {
        const body = req.body || {};
        try {
          const data = Buffer.from(JSON.stringify(body));
          await getPubSub().topic(WA_INCOMING_TOPIC).publishMessage({ data });
        } catch (pubErr) {
          console.error("Pub/Sub publish failed:", pubErr.message);
          // Still ack 200 to prevent Meta retries — we'd rather drop than retry
        }
        return res.status(200).send("EVENT_RECEIVED");
      }

      return res.status(405).send("Method not allowed");
    } catch (err) {
      console.error("Erreur whatsappWebhook:", err);
      if (!res.headersSent) res.status(200).send("ERROR_LOGGED");
    }
  });

/**
 * processWhatsappIncoming — Pub/Sub triggered processor for incoming Meta events.
 *
 * Decouples heavy work (Vision OCR, Firestore writes, Graph API sends) from the
 * HTTP webhook ack path. Functions Gen 1 HTTP can't reliably do background work
 * after res.send() — Pub/Sub triggers run for their full duration without freeze.
 */
exports.processWhatsappIncoming = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "1GB" })
  .pubsub.topic(WA_INCOMING_TOPIC)
  .onPublish(async (message) => {
    try {
      const body = message.json || (message.data ? JSON.parse(Buffer.from(message.data, "base64").toString()) : {});
      const { processIncomingEvent } = require("./whatsappProcessor");
      await processIncomingEvent(body);
    } catch (err) {
      console.error("processWhatsappIncoming error:", err);
      throw err; // Let Pub/Sub retry
    }
  });

// =============================================
// Netafim GrowSphere V3 — irrigation sync for ferme BAHIA
// =============================================
// Reads programmateur events (vannes, volumes, durées, EC/pH) and persists
// them into the existing `irrigation_readings` collection with ferme="BAHIA"
// so the irrigation UI surfaces BAHIA alongside F1/F5. Config lives in
// Firestore doc `config/netafim`; daily quota and last-run cursor in
// `config/netafim_sync`. See functions/lib/netafim/index.js for details.

const netafim = require("./lib/netafim");

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

const phenology = require("./lib/phenology");
const phenologyJob = require("./lib/phenology/dailyPhenologyJob");
const phenologyRefLoader = require("./lib/phenology/referenceLoader");
const phenologyStation = require("./lib/phenology/farmroadStationResolver");
const phenologyOutdoor = require("./lib/phenology/outdoorWeatherFallback");
const phenologyFetcher = require("./lib/phenology/radiationFetcher");
const phenologyWriter = require("./lib/phenology/phenologyDailyWriter");

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
// Jours fériés Maroc — job quotidien (API date.nager.at) + trigger test
// Source unique : app_settings/jours_feries. Confirme les dates lunaires à
// l'approche de l'événement et notifie RH/DG ; respecte les overrides RH.
// =============================================
const joursFeriesJob = require("./lib/joursFeries/joursFeries");

function buildJoursFeriesProdDeps() {
  const docRef = db_firestore.collection("app_settings").doc("jours_feries");
  return {
    fetchHolidays: (year) => joursFeriesJob.fetchNagerHolidays(year),
    getExisting: async () => {
      const snap = await docRef.get();
      return snap.exists ? snap.data() : null;
    },
    saveDoc: (doc) => docRef.set(doc, { merge: true }),
    notify: async (n) => {
      const dateFr = (() => {
        try { return new Date(n.date + "T12:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "long" }); }
        catch (_) { return n.date; }
      })();
      const msg = n.dateChanged
        ? `📅 Jour férié « ${n.label} » : date mise à jour au ${dateFr} (était ${n.oldDate}).`
        : `📅 Jour férié « ${n.label} » confirmé pour le ${dateFr}.`;
      await dispatchNotification({
        type: "jour_ferie_update",
        profiles: ["rh", "dg"],
        channels: ["in_app"],
        data: { message: msg, severity: "info" },
        relatedDoc: "app_settings/jours_feries",
      });
    },
    nowIso: () => new Date().toISOString(),
    logger: (msg) => console.log(msg),
  };
}

exports.syncJoursFeries = functions
  .region(joursFeriesJob.CRON_CONFIG.region)
  .runWith({
    timeoutSeconds: joursFeriesJob.CRON_CONFIG.timeoutSeconds,
    memory: joursFeriesJob.CRON_CONFIG.memorySize,
  })
  .pubsub.schedule(joursFeriesJob.CRON_CONFIG.schedule)
  .timeZone(joursFeriesJob.CRON_CONFIG.timeZone)
  .onRun(async () => {
    const today = localDateStr();
    console.log("[syncJoursFeries] cron start date=" + today);
    try {
      const summary = await joursFeriesJob.runSyncJoursFeries(today, buildJoursFeriesProdDeps());
      console.log("[syncJoursFeries] cron done", JSON.stringify(summary));
    } catch (err) {
      console.error("[syncJoursFeries] cron error:", err.message);
    }
    return null;
  });

// HTTP trigger — one-shot manuel (auth requise, ?date=YYYY-MM-DD pour rejouer)
exports.runSyncJoursFeriesNow = functions
  .region(joursFeriesJob.HTTP_CONFIG.region)
  .runWith({
    timeoutSeconds: joursFeriesJob.HTTP_CONFIG.timeoutSeconds,
    memory: joursFeriesJob.HTTP_CONFIG.memorySize,
  })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;
    const today = localDateStr();
    const date = (req.query && req.query.date) || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "date must be YYYY-MM-DD" });
    }
    try {
      const summary = await joursFeriesJob.runSyncJoursFeries(date, buildJoursFeriesProdDeps());
      return res.json({ success: true, ...summary });
    } catch (err) {
      console.error("[runSyncJoursFeriesNow] error:", err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });
