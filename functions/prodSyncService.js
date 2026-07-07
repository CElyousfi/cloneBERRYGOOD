/**
 * Production Database Sync Service
 * Syncs Tracabilite_recolte (harvest kg per worker) and Presence (entry/exit times)
 * from BEE ONE production database (BEE_BERRY_GOOD) to Firestore.
 */

const sql = require("mssql");
const { admin, db: db_firestore } = require("./config/firebase");
const sqlConfigProd = require("./config/sqlConfigProd");

let poolProd = null;
async function getPoolProd() {
  if (!poolProd) {
    poolProd = new sql.ConnectionPool(sqlConfigProd);
    await poolProd.connect();
  }
  return poolProd;
}

/**
 * Sync Tracabilite_recolte → Firestore prod_tracabilite_recolte/{YYYY-MM-DD}
 * Fetches harvest scan data per worker from production DB.
 * Each worker may have multiple scans per day (different crate sizes, parcelles).
 * We aggregate by worker+date and store the total kg + total caisses.
 */
async function syncTracabiliteRecolte(startDateParam) {
  // Default: last 3 days. Pass '2025-07-01' for historical sync.
  const startDate = startDateParam || new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  console.log(`[ProdSync] Syncing Tracabilite_recolte from ${startDate}...`);
  const startTime = Date.now();

  try {
    const db = await getPoolProd();

    const result = await db.request()
      .input("startDate", startDate)
      .query(`
      SELECT
        t.DATE,
        per.Mat AS Matricule,
        per.Nom,
        per.Prenom,
        t.Poid,
        t.Total_caisse,
        t.Total_poid,
        t.Heure_scan,
        t.IDParcelle,
        pc.Ref_parcelle,
        v.Variete AS VarieteNom
      FROM Tracabilite_recolte t
      LEFT JOIN Personnel per ON t.IDPers = per.ID
      LEFT JOIN ParcelleCulturale pc ON t.IDParcelle = pc.ID
      LEFT JOIN Variete v ON pc.Variete = v.ID
      WHERE t.DATE >= @startDate
      ORDER BY t.DATE, per.Mat
    `);

    const rows = result.recordset;
    console.log(`[ProdSync] Fetched ${rows.length} Tracabilite rows`);

    // Group by date
    const byDate = {};
    for (const r of rows) {
      const date = new Date(r.DATE).toISOString().slice(0, 10);
      if (!byDate[date]) byDate[date] = [];
      byDate[date].push(r);
    }

    // For each date, aggregate by worker
    let totalDocs = 0;
    for (const [date, dateRows] of Object.entries(byDate)) {
      const byWorker = {};
      for (const r of dateRows) {
        const mat = (r.Matricule || "").trim().toUpperCase();
        if (!mat) continue;
        if (!byWorker[mat]) {
          byWorker[mat] = {
            matricule: (r.Matricule || "").trim(),
            nom: ((r.Nom || "") + " " + (r.Prenom || "")).trim(),
            totalKg: 0,
            totalCaisses: 0,
            scans: 0,
            variete: (r.VarieteNom || "").trim(),
            refParcelle: (r.Ref_parcelle || "").trim(),
            parcelles: {},
          };
        }
        byWorker[mat].totalKg += r.Total_poid || 0;
        byWorker[mat].totalCaisses += r.Total_caisse || 0;
        byWorker[mat].scans++;
        // Track kg by parcelle/variete for variety resolution
        const varName = (r.VarieteNom || "").trim();
        if (varName) {
          byWorker[mat].parcelles[varName] = (byWorker[mat].parcelles[varName] || 0) + (r.Total_poid || 0);
        }
      }

      // Determine dominant variety per worker
      const workerRows = Object.values(byWorker).map((w) => {
        // Pick the variety with most kg
        const bestVar = Object.entries(w.parcelles)
          .sort((a, b) => b[1] - a[1])[0];
        if (bestVar) w.variete = bestVar[0];
        w.totalKg = Math.round(w.totalKg * 10) / 10;
        w.totalCaisses = Math.round(w.totalCaisses * 10) / 10;
        delete w.parcelles;
        return w;
      });

      const totalKgDay = Math.round(workerRows.reduce((s, w) => s + w.totalKg, 0) * 10) / 10;

      await db_firestore.collection("prod_tracabilite_recolte").doc(date).set({
        rows: workerRows,
        rowCount: workerRows.length,
        totalKg: totalKgDay,
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      totalDocs++;
    }

    // Always write a status doc so the frontend can show the last sync time
    // even when no scans were recorded for today yet.
    await db_firestore.collection("prod_tracabilite_recolte").doc("_status").set({
      lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
      daysSynced: totalDocs,
      scans: rows.length,
    });

    const duration = Date.now() - startTime;
    console.log(`[ProdSync] Tracabilite done: ${totalDocs} days, ${rows.length} scans in ${duration}ms`);
    return { success: true, days: totalDocs, scans: rows.length, durationMs: duration };
  } catch (err) {
    console.error("[ProdSync] Tracabilite error:", err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Sync Presence → Firestore prod_presence/{YYYY-MM-DD}
 * Fetches entry/exit times for ALL Berry Good Farms workers (toutes fermes :
 * F1, F5, Avocatier). La ferme n'est pas portée par prod_presence ; elle est
 * résolue en aval via le mirror BR_Pointage (deriveFerme) pour le module HS.
 * NB: si la table Presence contenait des entités non-BGF, re-scoper ici avec
 * `AND p.IDFermes IN (<ids BGF>)`.
 * @param {string} mode - 'entree' (sync entry times) or 'sortie' (sync exit times)
 */
async function syncPresence(mode) {
  console.log(`[ProdSync] Syncing Presence (${mode})...`);
  const startTime = Date.now();

  try {
    const db = await getPoolProd();
    const today = new Date().toISOString().slice(0, 10);

    const result = await db.request().query(`
      SELECT
        per.Mat AS Matricule,
        per.Nom,
        per.Prenom,
        p.Heure_entree,
        p.Heure_sortie,
        p.Date_entree,
        p.Date_sortie,
        p.IDFermes,
        p.Caporale
      FROM Presence p
      LEFT JOIN Personnel per ON p.ID_personnel = per.ID
      WHERE CONVERT(date, p.Date_entree) = '${today}'
      ORDER BY p.Heure_entree
    `);

    const rows = result.recordset;
    console.log(`[ProdSync] Fetched ${rows.length} Presence rows for ${today}`);

    // Build worker presence map (one entry per worker)
    const byWorker = {};
    for (const r of rows) {
      const mat = (r.Matricule || "").trim().toUpperCase();
      if (!mat) continue;
      // Keep the earliest entry and latest exit
      if (!byWorker[mat]) {
        byWorker[mat] = {
          matricule: (r.Matricule || "").trim(),
          nom: ((r.Nom || "") + " " + (r.Prenom || "")).trim(),
          heureEntree: r.Heure_entree || "",
          heureSortie: r.Heure_sortie || "",
          caporal: r.Caporale || 0,
        };
      } else {
        // Update sortie if later
        if (r.Heure_sortie && r.Heure_sortie !== "0000" &&
            (!byWorker[mat].heureSortie || r.Heure_sortie > byWorker[mat].heureSortie)) {
          byWorker[mat].heureSortie = r.Heure_sortie;
        }
      }
    }

    const presenceRows = Object.values(byWorker).map((w) => {
      // Format heures: "0653" → "06:53"
      const fmtH = (h) => {
        if (!h || h === "0000") return null;
        const s = h.toString().padStart(4, "0");
        return s.substring(0, 2) + ":" + s.substring(2, 4);
      };
      return {
        ...w,
        heureEntree: fmtH(w.heureEntree),
        heureSortie: fmtH(w.heureSortie),
      };
    });

    await db_firestore.collection("prod_presence").doc(today).set({
      rows: presenceRows,
      rowCount: presenceRows.length,
      mode,
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const duration = Date.now() - startTime;
    console.log(`[ProdSync] Presence (${mode}) done: ${presenceRows.length} workers in ${duration}ms`);
    return { success: true, workers: presenceRows.length, durationMs: duration };
  } catch (err) {
    console.error(`[ProdSync] Presence (${mode}) error:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Backfill prod_presence sur une plage de dates depuis BEE ONE Production.
 * Re-lit la table Presence (TOUTES fermes) et réécrit prod_presence/{jour} avec
 * entrée mini + sortie maxi par ouvrier. Sert à rattraper les heures de sortie
 * saisies tardivement dans BEE ONE (le sync quotidien ne voit que le jour même).
 * Ne touche PAS au pointage analytique (sql_mirror_pointage).
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 */
async function syncPresenceRange(startDate, endDate) {
  console.log(`[ProdSync] Backfill Presence ${startDate} → ${endDate}...`);
  const startTime = Date.now();
  try {
    const db = await getPoolProd();
    const result = await db.request().query(`
      SELECT
        per.Mat AS Matricule,
        per.Nom,
        per.Prenom,
        p.Heure_entree,
        p.Heure_sortie,
        p.Date_entree,
        p.Caporale
      FROM Presence p
      LEFT JOIN Personnel per ON p.ID_personnel = per.ID
      WHERE CONVERT(date, p.Date_entree) BETWEEN '${startDate}' AND '${endDate}'
      ORDER BY p.Heure_entree
    `);

    const fmtH = (h) => {
      if (!h || h === "0000") return null;
      const s = h.toString().padStart(4, "0");
      return s.substring(0, 2) + ":" + s.substring(2, 4);
    };

    // Group by date → matricule (entrée mini, sortie maxi).
    const byDate = {};
    for (const r of result.recordset) {
      const mat = (r.Matricule || "").trim();
      if (!mat) continue;
      const date = new Date(r.Date_entree).toISOString().slice(0, 10);
      const key = mat.toUpperCase();
      if (!byDate[date]) byDate[date] = {};
      const w = byDate[date][key];
      if (!w) {
        byDate[date][key] = {
          matricule: mat,
          nom: ((r.Nom || "") + " " + (r.Prenom || "")).trim(),
          heureEntree: r.Heure_entree && r.Heure_entree !== "0000" ? r.Heure_entree : "",
          heureSortie: r.Heure_sortie && r.Heure_sortie !== "0000" ? r.Heure_sortie : "",
          caporal: r.Caporale || 0,
        };
      } else {
        if (r.Heure_entree && r.Heure_entree !== "0000" && (!w.heureEntree || r.Heure_entree < w.heureEntree)) w.heureEntree = r.Heure_entree;
        if (r.Heure_sortie && r.Heure_sortie !== "0000" && (!w.heureSortie || r.Heure_sortie > w.heureSortie)) w.heureSortie = r.Heure_sortie;
      }
    }

    let daysWritten = 0, totalRows = 0, withSortie = 0;
    for (const date of Object.keys(byDate)) {
      const rows = Object.values(byDate[date]).map((w) => ({
        ...w,
        heureEntree: fmtH(w.heureEntree),
        heureSortie: fmtH(w.heureSortie),
      }));
      withSortie += rows.filter((r) => r.heureSortie).length;
      totalRows += rows.length;
      await db_firestore.collection("prod_presence").doc(date).set({
        rows,
        rowCount: rows.length,
        mode: "backfill",
        syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      daysWritten++;
    }

    const duration = Date.now() - startTime;
    console.log(`[ProdSync] Backfill done: ${daysWritten} jours, ${totalRows} lignes, ${withSortie} avec sortie en ${duration}ms`);
    return { success: true, startDate, endDate, daysWritten, totalRows, withSortie, durationMs: duration };
  } catch (err) {
    console.error("[ProdSync] Backfill Presence error:", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { syncTracabiliteRecolte, syncPresence, syncPresenceRange };
