/**
 * sqlSyncService.js
 *
 * Phase 0: Replication probe — detect SQL reporting DB refresh frequency
 * Phase 1: Hourly sync SQL → Firestore mirror collections
 */

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const sql = require("mssql");

// Reuse the initialized app from index.js (admin.initializeApp() is called there)
const db_firestore = admin.firestore();

// =============================================
// SQL Server Config (same as index.js)
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
    requestTimeout: 60000,
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
// PHASE 0: Replication Probe
// Runs every 10 minutes for 48h to detect when
// the reporting DB refreshes with new data
// =============================================
exports.replicationProbe = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .pubsub.schedule("every 10 minutes")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    const now = new Date();
    const timestampKey = now.toISOString().replace(/[:.]/g, "-");
    console.log(`[ReplicationProbe] Running at ${now.toISOString()}`);

    try {
      const db = await getPool();
      const todayStr = now.toISOString().slice(0, 10);

      const [pointageCount, pointageMax, consommationCount, cueilletteCount] = await Promise.all([
        db.request().query(`SELECT COUNT(*) AS cnt FROM BR_Pointage WHERE CONVERT(date, Periode_Date) = '${todayStr}'`),
        db.request().query(`SELECT MAX(Periode_Date) AS maxDate, COUNT(*) AS totalRows FROM BR_Pointage`),
        db.request().query(`SELECT COUNT(*) AS cnt FROM BR_Consommation WHERE [Date] >= DATEADD(day, -1, GETDATE())`),
        db.request().query(`SELECT COUNT(*) AS cnt FROM BR_Cueillette WHERE CONVERT(date, Periode_Date) = '${todayStr}'`),
      ]);

      const probeData = {
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        localTime: now.toISOString(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        pointage_today_count: pointageCount.recordset[0].cnt,
        pointage_max_date: pointageMax.recordset[0].maxDate,
        pointage_total_rows: pointageMax.recordset[0].totalRows,
        consommation_recent_count: consommationCount.recordset[0].cnt,
        cueillette_today_count: cueilletteCount.recordset[0].cnt,
      };

      await db_firestore.collection("replication_probe").doc(timestampKey).set(probeData);
      console.log(`[ReplicationProbe] Stored: pointage_today=${probeData.pointage_today_count}, consommation_recent=${probeData.consommation_recent_count}, cueillette_today=${probeData.cueillette_today_count}`);
    } catch (err) {
      console.error("[ReplicationProbe] Error:", err.message);
      await db_firestore.collection("replication_probe").doc(timestampKey).set({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        localTime: now.toISOString(),
        error: err.message,
      });
    }
    return null;
  });

// =============================================
// PHASE 1: SQL → Firestore Sync (Hourly)
// =============================================

/**
 * Helper: Group array of rows by a key function
 */
function groupBy(rows, keyFn) {
  const groups = {};
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups[key]) groups[key] = [];
    groups[key].push(row);
  }
  return groups;
}

/**
 * Helper: Format date to YYYY-MM-DD string
 */
function toDateStr(d) {
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

/**
 * Helper: Format date to YYYY-MM string
 */
function toMonthStr(d) {
  if (typeof d === "string") return d.slice(0, 7);
  if (d instanceof Date) return d.toISOString().slice(0, 7);
  return String(d).slice(0, 7);
}

/**
 * Sync BR_Consommation → sql_mirror_consommation/{YYYY-MM}
 */
async function syncConsommation(db) {
  console.log("[Sync] Syncing BR_Consommation...");
  const result = await db.request().query(`
    SELECT Parcelle_Culturale, Parcelle_Physique, Culture, Ferme, Article, Article_Categorie,
      Quantite, Article_unite, [Date], Parcelle_sup
    FROM BR_Consommation
    WHERE [Date] >= '2025-07-01'
    ORDER BY [Date]
  `);

  const rows = result.recordset.map(r => ({
    Parcelle_Culturale: (r.Parcelle_Culturale || "").trim(),
    Parcelle_Physique: (r.Parcelle_Physique || "").trim(),
    Culture: (r.Culture || "").trim(),
    Ferme: (r.Ferme || "").trim(),
    Article: (r.Article || "").trim(),
    Article_Categorie: (r.Article_Categorie || "").trim(),
    Quantite: r.Quantite || 0,
    Article_unite: (r.Article_unite || "").trim(),
    Date: toDateStr(r.Date),
    Parcelle_sup: r.Parcelle_sup || null,
  }));

  const byMonth = groupBy(rows, r => toMonthStr(r.Date));
  const batch = db_firestore.batch();
  let docCount = 0;

  for (const [month, monthRows] of Object.entries(byMonth)) {
    const docRef = db_firestore.collection("sql_mirror_consommation").doc(month);
    batch.set(docRef, {
      rows: monthRows,
      rowCount: monthRows.length,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    docCount++;
  }

  await batch.commit();
  console.log(`[Sync] BR_Consommation: ${rows.length} rows → ${docCount} monthly docs`);
  return rows.length;
}

/**
 * Sync BR_Cueillette → sql_mirror_cueillette/{YYYY-MM-DD}
 * Only last 30 days
 */
async function syncCueillette(db) {
  console.log("[Sync] Syncing BR_Cueillette...");
  const result = await db.request().query(`
    SELECT CONVERT(varchar(10), Periode_Date, 23) AS DateStr, Variete,
      Poids_total_kg, Nbre_Caisse, Operation_Famille, Parcelle_Culturale
    FROM BR_Cueillette
    WHERE CONVERT(date, Periode_Date) >= DATEADD(day, -30, GETDATE())
    ORDER BY Periode_Date
  `);

  const rows = result.recordset.map(r => ({
    DateStr: r.DateStr,
    Variete: (r.Variete || "").trim(),
    Poids_total_kg: r.Poids_total_kg || 0,
    Nbre_Caisse: r.Nbre_Caisse || 0,
    Operation_Famille: (r.Operation_Famille || "").trim(),
    Parcelle_Culturale: (r.Parcelle_Culturale || "").trim(),
  }));

  const byDate = groupBy(rows, r => r.DateStr);
  const batch = db_firestore.batch();
  let docCount = 0;

  for (const [date, dateRows] of Object.entries(byDate)) {
    const docRef = db_firestore.collection("sql_mirror_cueillette").doc(date);
    batch.set(docRef, {
      rows: dateRows,
      rowCount: dateRows.length,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    docCount++;
  }

  await batch.commit();
  console.log(`[Sync] BR_Cueillette: ${rows.length} rows → ${docCount} daily docs`);
  return rows.length;
}

/**
 * Sync BR_Pointage → sql_mirror_pointage/{YYYY-MM-DD}
 * + sql_mirror_pointage_meta/config
 * + sql_mirror_pointage_workers/{matricule}
 */
async function syncPointage(db) {
  console.log("[Sync] Syncing BR_Pointage...");

  // Get the last 2 quinzaines worth of data (roughly 30 days)
  // First, find the distinct Periode_paie values
  const periodesResult = await db.request().query(`
    SELECT DISTINCT Periode_paie
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) >= DATEADD(day, -45, GETDATE())
    ORDER BY Periode_paie DESC
  `);
  const periodes = periodesResult.recordset.map(r => (r.Periode_paie || "").trim()).filter(Boolean);

  // Fetch all pointage data for the covered period
  const result = await db.request().query(`
    SELECT Personnel_Matricule, Personnel_Nom, Operation_Famille, Operation, Operation_Groupe,
      Nombre_Jr, Nombre_Hr, Quantite_unite, Cout, Parcelle_Culturale, Ref_parcelle,
      Variete, Culture, Periode_paie,
      CONVERT(varchar(10), Periode_Date, 23) AS DateStr,
      HS_25, HS_50, HS_100, HS_NM
    FROM BR_Pointage
    WHERE CONVERT(date, Periode_Date) >= DATEADD(day, -45, GETDATE())
    ORDER BY Periode_Date, Personnel_Nom
  `);

  const rows = result.recordset.map(r => ({
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
    HS_25: r.HS_25 || 0,
    HS_50: r.HS_50 || 0,
    HS_100: r.HS_100 || 0,
    HS_NM: r.HS_NM || 0,
  }));

  // Group by date
  const byDate = groupBy(rows, r => r.DateStr);
  const availableDates = Object.keys(byDate).sort().reverse();

  // Build periodeMap: { "Quinzaine 17": ["2026-03-15", ...] }
  const periodeMap = {};
  for (const row of rows) {
    if (!row.Periode_paie) continue;
    if (!periodeMap[row.Periode_paie]) periodeMap[row.Periode_paie] = new Set();
    periodeMap[row.Periode_paie].add(row.DateStr);
  }
  // Convert Sets to sorted arrays
  for (const key of Object.keys(periodeMap)) {
    periodeMap[key] = [...periodeMap[key]].sort();
  }

  // Write daily pointage docs (in batches of 500 max Firestore ops)
  const dateEntries = Object.entries(byDate);
  for (let i = 0; i < dateEntries.length; i += 200) {
    const batch = db_firestore.batch();
    const chunk = dateEntries.slice(i, i + 200);
    for (const [date, dateRows] of chunk) {
      const docRef = db_firestore.collection("sql_mirror_pointage").doc(date);
      batch.set(docRef, {
        rows: dateRows,
        rowCount: dateRows.length,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  // Write meta document
  await db_firestore.collection("sql_mirror_pointage_meta").doc("config").set({
    periodes,
    periodeMap,
    availableDates,
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Build worker index for active workers (last 2 quinzaines)
  const byWorker = groupBy(rows, r => r.Personnel_Matricule);
  const workerEntries = Object.entries(byWorker);
  for (let i = 0; i < workerEntries.length; i += 200) {
    const batch = db_firestore.batch();
    const chunk = workerEntries.slice(i, i + 200);
    for (const [matricule, workerRows] of chunk) {
      if (!matricule) continue;
      const docRef = db_firestore.collection("sql_mirror_pointage_workers").doc(matricule);
      batch.set(docRef, {
        rows: workerRows,
        rowCount: workerRows.length,
        nom: workerRows[0]?.Personnel_Nom || "",
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }

  console.log(`[Sync] BR_Pointage: ${rows.length} rows → ${dateEntries.length} daily docs, ${workerEntries.length} worker docs, ${periodes.length} periodes`);
  return rows.length;
}

/**
 * Main sync orchestrator
 */
async function runFullSync() {
  const startTime = Date.now();
  const statusRef = db_firestore.collection("sql_sync_status").doc("latest");

  try {
    const db = await getPool();

    const [consommationCount, cueilletteCount, pointageCount] = await Promise.all([
      syncConsommation(db),
      syncCueillette(db),
      syncPointage(db),
    ]);

    const durationMs = Date.now() - startTime;
    await statusRef.set({
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSuccessAt: admin.firestore.FieldValue.serverTimestamp(),
      error: null,
      consecutiveFailures: 0,
      durationMs,
      rowCounts: {
        consommation: consommationCount,
        cueillette: cueilletteCount,
        pointage: pointageCount,
      },
    });

    console.log(`[Sync] Full sync completed in ${durationMs}ms`);
    return { success: true, durationMs, consommationCount, cueilletteCount, pointageCount };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("[Sync] Full sync FAILED:", err.message);

    // Read current status to increment consecutiveFailures
    let currentFailures = 0;
    try {
      const snap = await statusRef.get();
      if (snap.exists) currentFailures = snap.data().consecutiveFailures || 0;
    } catch (_) {}

    await statusRef.set({
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      error: err.message,
      consecutiveFailures: currentFailures + 1,
      durationMs,
    }, { merge: true });

    throw err;
  }
}

// =============================================
// Scheduled Sync — Every hour at :05
// =============================================
exports.sqlToFirestoreSync = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "2GB" })
  .pubsub.schedule("5 * * * *")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    console.log("[Sync] Scheduled sync starting...");
    try {
      const result = await runFullSync();
      console.log("[Sync] Scheduled sync done:", JSON.stringify(result));
    } catch (err) {
      console.error("[Sync] Scheduled sync error:", err.message);
    }
    return null;
  });

// =============================================
// PHASE 0.5: Probe Analyzer — runs every 12h,
// after 48h of data, analyzes refresh pattern
// and stores recommended sync schedule
// =============================================

/**
 * Analyze replication_probe docs to detect SQL refresh timing.
 * Looks for "jumps" in row counts — a jump means fresh data arrived.
 * Returns { refreshHours: [7, 13, ...], recommendedCron: "10 7,13 * * *", confidence: "high" }
 */
async function analyzeProbeData() {
  const snapshot = await db_firestore.collection("replication_probe")
    .orderBy("localTime")
    .get();

  if (snapshot.empty) return { error: "No probe data found", probeCount: 0 };

  const probes = [];
  for (const doc of snapshot.docs) {
    const d = doc.data();
    if (d.error || !d.localTime) continue;
    probes.push({
      localTime: d.localTime,
      hour: d.hour,
      minute: d.minute,
      pointage_today_count: d.pointage_today_count || 0,
      pointage_total_rows: d.pointage_total_rows || 0,
      consommation_recent_count: d.consommation_recent_count || 0,
      cueillette_today_count: d.cueillette_today_count || 0,
    });
  }

  if (probes.length < 20) {
    return { error: "Not enough data yet", probeCount: probes.length, needed: 20 };
  }

  // Detect jumps: compare each probe to the previous one
  const jumps = [];
  for (let i = 1; i < probes.length; i++) {
    const prev = probes[i - 1];
    const curr = probes[i];

    const pointageDelta = curr.pointage_total_rows - prev.pointage_total_rows;
    const consoDelta = curr.consommation_recent_count - prev.consommation_recent_count;
    const cueilletteDelta = curr.cueillette_today_count - prev.cueillette_today_count;
    const pointageTodayDelta = curr.pointage_today_count - prev.pointage_today_count;

    // A "jump" = significant increase in any counter
    const totalDelta = Math.max(0, pointageDelta) + Math.max(0, consoDelta) +
      Math.max(0, cueilletteDelta) + Math.max(0, pointageTodayDelta);

    if (totalDelta > 0) {
      jumps.push({
        time: curr.localTime,
        hour: curr.hour,
        minute: curr.minute,
        pointageDelta,
        consoDelta,
        cueilletteDelta,
        pointageTodayDelta,
        totalDelta,
      });
    }
  }

  // Count jumps per hour slot
  const hourCounts = {};
  const hourTotalDelta = {};
  for (const j of jumps) {
    hourCounts[j.hour] = (hourCounts[j.hour] || 0) + 1;
    hourTotalDelta[j.hour] = (hourTotalDelta[j.hour] || 0) + j.totalDelta;
  }

  // Find significant refresh hours (hours with large delta spikes)
  // Sort hours by total delta descending
  const hoursSorted = Object.keys(hourTotalDelta)
    .map(h => ({ hour: parseInt(h), count: hourCounts[h], totalDelta: hourTotalDelta[h] }))
    .sort((a, b) => b.totalDelta - a.totalDelta);

  // The top hours with significant deltas are likely refresh times
  const avgDelta = jumps.reduce((s, j) => s + j.totalDelta, 0) / Math.max(jumps.length, 1);
  const significantHours = hoursSorted
    .filter(h => h.totalDelta > avgDelta * 1.5 && h.count >= 1)
    .map(h => h.hour)
    .sort((a, b) => a - b);

  // Determine confidence
  let confidence = "low";
  const firstProbeTime = new Date(probes[0].localTime);
  const lastProbeTime = new Date(probes[probes.length - 1].localTime);
  const hoursOfData = (lastProbeTime - firstProbeTime) / 3600000;

  if (hoursOfData >= 48 && significantHours.length > 0) confidence = "high";
  else if (hoursOfData >= 24 && significantHours.length > 0) confidence = "medium";

  // Build recommended cron: sync 10 min after each detected refresh hour
  let recommendedCron;
  if (significantHours.length > 0) {
    recommendedCron = `10 ${significantHours.join(",")} * * *`;
  } else {
    // Fallback: every hour at :05 (current default)
    recommendedCron = "5 * * * *";
  }

  return {
    probeCount: probes.length,
    hoursOfData: Math.round(hoursOfData),
    totalJumps: jumps.length,
    hourBreakdown: hoursSorted.slice(0, 10),
    significantRefreshHours: significantHours,
    recommendedCron,
    confidence,
    topJumps: jumps
      .sort((a, b) => b.totalDelta - a.totalDelta)
      .slice(0, 10)
      .map(j => ({ time: j.time, hour: j.hour, minute: j.minute, totalDelta: j.totalDelta })),
  };
}

exports.probeAnalyzer = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .pubsub.schedule("every 12 hours")
  .timeZone("Africa/Casablanca")
  .onRun(async () => {
    console.log("[ProbeAnalyzer] Running analysis...");

    try {
      const analysis = await analyzeProbeData();

      // Store analysis result
      await db_firestore.collection("replication_probe_analysis").doc("latest").set({
        ...analysis,
        analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`[ProbeAnalyzer] Result: confidence=${analysis.confidence}, refreshHours=${JSON.stringify(analysis.significantRefreshHours)}, recommendedCron=${analysis.recommendedCron}`);

      // If high confidence, mark probe as complete
      if (analysis.confidence === "high") {
        await db_firestore.collection("replication_probe_analysis").doc("latest").update({
          status: "complete",
          message: `Analyse terminée. Refresh SQL détecté aux heures: ${analysis.significantRefreshHours.join("h, ")}h. Cron recommandé: "${analysis.recommendedCron}". Vous pouvez maintenant désactiver replicationProbe et mettre à jour le schedule de sqlToFirestoreSync.`,
        });
        console.log("[ProbeAnalyzer] HIGH CONFIDENCE — probe analysis complete. Recommended cron:", analysis.recommendedCron);
      }
    } catch (err) {
      console.error("[ProbeAnalyzer] Error:", err.message);
      await db_firestore.collection("replication_probe_analysis").doc("latest").set({
        error: err.message,
        analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    return null;
  });

// HTTP endpoint to view raw probe data (last N probes)
exports.probeRawData = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 60, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const limit = parseInt(req.query.limit || "60");
      const snap = await db_firestore.collection("replication_probe")
        .orderBy("localTime", "desc")
        .limit(limit)
        .get();

      const probes = [];
      snap.forEach(doc => {
        const d = doc.data();
        probes.push({
          time: d.localTime ? d.localTime.slice(11, 16) : "?",
          localTime: d.localTime,
          ptg_today: d.pointage_today_count,
          ptg_total: d.pointage_total_rows,
          conso: d.consommation_recent_count,
          cueill: d.cueillette_today_count,
          error: d.error,
        });
      });

      // Sort ascending and compute deltas
      probes.reverse();
      const withDeltas = probes.map((p, i) => {
        if (i === 0) return { ...p, delta_ptg_total: null, delta_conso: null };
        const prev = probes[i - 1];
        return {
          ...p,
          delta_ptg_total: (p.ptg_total || 0) - (prev.ptg_total || 0),
          delta_conso: (p.conso || 0) - (prev.conso || 0),
          delta_ptg_today: (p.ptg_today || 0) - (prev.ptg_today || 0),
        };
      });

      // Summary of deltas > 0
      const jumps = withDeltas.filter(p => (p.delta_ptg_total > 0 || p.delta_conso > 0 || p.delta_ptg_today > 0));

      res.json({
        totalProbes: snap.size,
        hoursOfData: probes.length > 1
          ? Math.round((new Date(probes[probes.length-1].localTime) - new Date(probes[0].localTime)) / 3600000 * 10) / 10
          : 0,
        jumpsDetected: jumps.length,
        jumps,
        allProbes: withDeltas,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// HTTP endpoint to check probe analysis on-demand
exports.probeAnalysisReport = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "256MB" })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const analysis = await analyzeProbeData();
      await db_firestore.collection("replication_probe_analysis").doc("latest").set({
        ...analysis,
        analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
        ...(analysis.confidence === "high" ? {
          status: "complete",
          message: `Refresh SQL détecté aux heures: ${analysis.significantRefreshHours.join("h, ")}h. Cron recommandé: "${analysis.recommendedCron}".`,
        } : {}),
      });
      res.json(analysis);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

// =============================================
// Manual Sync Trigger — HTTP endpoint
// =============================================
exports.sqlSyncTrigger = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 540, memory: "2GB" })
  .https.onRequest(async (req, res) => {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).send("");

    try {
      const result = await runFullSync();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
