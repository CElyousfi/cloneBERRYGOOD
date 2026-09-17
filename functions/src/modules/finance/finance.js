/* Genere depuis functions/index.js — corps des blocs repris VERBATIM.
   Seul ce preambule de require/destructuration est ajoute, et les chemins
   relatifs sont reecrits depuis le nouvel emplacement. */
'use strict';

const { USE_MIRROR, db_firestore, functions, getConsommationRows, getCueilletteRows, getPointageRowsForDateRange, getPool, getSql, requireAuth, resolveCallerProfile, setCors, whatsappService, withCache } = require("../../shared/core");

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
const campagneRapportHebdo = require("../../../lib/campagneRapportHebdo");

function buildCampagneRapportHebdoDeps() {
  const { buildCampagneExportXlsx } = require("../rh/pointageService");
  return {
    buildWorkbook: (params) => buildCampagneExportXlsx({
      culture: params.culture,
      fermeFilter: null,
      cultureFilter: null,
    }),
    resolveRecipientsForProfile: (profileId, ferme) =>
      whatsappService.resolveRecipientsForProfile(profileId, ferme),
    uploadMedia: (buffer, mime, fileName) => whatsappService.uploadMedia(buffer, mime, fileName),
    sendTemplateMessageWithDocument: (to, template, ref, fileName, bodyParams, lang, toName) =>
      whatsappService.sendTemplateMessageWithDocument(to, template, ref, fileName, bodyParams, lang, toName),
    sendTemplateMessage: (to, template, bodyParams) =>
      whatsappService.sendTemplateMessage(to, template, bodyParams),
    // Numéro de repli pour l'alerte : la panne qui rendrait ce job muet est
    // justement celle où plus aucun `dg` n'est lisible (Firestore injoignable,
    // whatsappEnabled retiré). Le repli ne dépend donc PAS de `users` — il vit
    // dans config/whatsapp.alert_fallback_phone. Absent → alerte in-fine
    // seulement dans les logs, ce qui est signalé dans le résultat du job.
    fallbackAlertPhone: async () => {
      try {
        const cfg = await whatsappService.getWhatsAppConfig();
        return (cfg && cfg.alert_fallback_phone) || null;
      } catch (e) {
        return null;
      }
    },
    toSingleLine: whatsappService.toSingleLine,
    now: () => new Date(),
    logger: (msg, ctx) => console.log(msg, ctx || ""),
  };
}

exports.campagneRapportHebdo = functions
  .region(campagneRapportHebdo.CRON_CONFIG.region)
  .runWith({
    timeoutSeconds: campagneRapportHebdo.CRON_CONFIG.timeoutSeconds,
    memory: campagneRapportHebdo.CRON_CONFIG.memory,
  })
  .pubsub.schedule(campagneRapportHebdo.CRON_CONFIG.schedule)
  .timeZone(campagneRapportHebdo.CRON_CONFIG.timeZone)
  .onRun(async () => {
    try {
      const out = await campagneRapportHebdo.runRapportHebdo(buildCampagneRapportHebdoDeps());
      console.log("[campagneRapportHebdo]", JSON.stringify({
        success: out.success,
        resume: out.resume.texte,
        alerte: out.alerte,
      }));
    } catch (err) {
      // Le job avale déjà les échecs métier et alerte ; ce catch ne couvre que
      // l'imprévu (ex. Firestore injoignable) — on le trace, sans faire
      // retenter Pub/Sub un envoi potentiellement déjà parti.
      console.error("[campagneRapportHebdo] cron error:", err.message);
    }
    return null;
  });

// Trigger HTTP jumeau — GATÉ (l'URL d'une CF gen1 est publique : ce trigger
// déclenche des envois réels et sert le classeur complet). Auth Firebase +
// profil dg/dt (modèle runDailyPhenologyJobNow), et confirmation explicite
// pour l'envoi (modèle confirm=LIVE) :
//   ?checkRecipients=1        → aucun envoi, liste résolue par profil
//   ?dryRun=1                 → génère les classeurs, n'envoie rien
//   ?dryRun=1&download=<cult> → télécharge le .xlsx (confrontation serveur ↔ navigateur)
//   ?confirm=SEND             → exécution complète (envois réels)
//   ?culture=Framboise        → restreint à une culture
exports.campagneRapportHebdoTrigger = functions
  .region(campagneRapportHebdo.HTTP_CONFIG.region)
  .runWith({
    timeoutSeconds: campagneRapportHebdo.HTTP_CONFIG.timeoutSeconds,
    memory: campagneRapportHebdo.HTTP_CONFIG.memory,
  })
  .https.onRequest(campagneRapportHebdo.buildHttpHandler(Object.assign(
    buildCampagneRapportHebdoDeps(),
    {
      requireAuth,
      resolveProfile: (authUser) => resolveCallerProfile(authUser),
      setCors,
    }
  )));
