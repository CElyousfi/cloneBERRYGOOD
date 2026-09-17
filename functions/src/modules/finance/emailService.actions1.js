/* Actions 1/3 de emailAnalysis — corps repris VERBATIM.
   Le contexte du handler arrive par `ctx` ; la destructuration ci-dessous
   recree exactement les liaisons d'origine. */
'use strict';
const { NOT_HANDLED } = require("./emailService.dispatch");
const { PDFParse, XLSX, admin, createImapClient, db, functions, isDailyQualityReport, isWeeklyQualityReport, parseWeeklyQualityReportPdf, simpleParser } = require("./emailService.part1");
const { parseDailyQualityReportXlsx } = require("./emailService.part2");

module.exports = async function emailServiceActions1(ctx) {
  const { req, res, authUser, action } = ctx;

      // --- STATUS ---
      if (action === "status") {
        const configSnap = await db.collection("email_config").doc("settings").get();
        const config = configSnap.exists ? configSnap.data() : {};
        return res.json({
          success: true,
          status: {
            lastPollTimestamp: config.lastPollTimestamp || null,
            lastPollUid: config.lastPollUid || 0,
            totalEmailsFetched: config.totalEmailsFetched || 0,
            lastError: config.lastError || null,
            lastErrorTimestamp: config.lastErrorTimestamp || null,
          },
        });
      }


      // --- LIST ---
      if (action === "list") {
        const limit = parseInt(req.query.limit || "50");
        const statusFilter = req.query.status || null;

        let query = db.collection("emails").orderBy("receivedAt", "desc").limit(limit);
        if (statusFilter) {
          query = query.where("status", "==", statusFilter);
        }

        const snap = await query.get();
        const emails = snap.docs.map((doc) => ({
          id: doc.id,
          from: doc.data().from,
          fromName: doc.data().fromName,
          subject: doc.data().subject,
          date: doc.data().date,
          receivedAt: doc.data().receivedAt,
          status: doc.data().status,
          hasAttachments: doc.data().hasAttachments,
          category: null, // will be enriched below
        }));

        // Enrich with extraction category
        const emailIds = emails.map((e) => e.id);
        if (emailIds.length > 0) {
          // Firestore 'in' query limited to 30 items
          const chunks = [];
          for (let i = 0; i < emailIds.length; i += 30) {
            chunks.push(emailIds.slice(i, i + 30));
          }
          for (const chunk of chunks) {
            const extSnap = await db
              .collection("email_extractions")
              .where(admin.firestore.FieldPath.documentId(), "in", chunk)
              .get();
            extSnap.docs.forEach((doc) => {
              const email = emails.find((e) => e.id === doc.id);
              if (email) email.category = doc.data().category;
            });
          }
        }

        return res.json({ success: true, count: emails.length, emails });
      }


      // --- DETAIL ---
      if (action === "detail") {
        const emailId = req.query.emailId;
        if (!emailId) return res.status(400).json({ success: false, error: "emailId required" });

        const [emailSnap, extractionSnap] = await Promise.all([
          db.collection("emails").doc(emailId).get(),
          db.collection("email_extractions").doc(emailId).get(),
        ]);

        if (!emailSnap.exists) {
          return res.status(404).json({ success: false, error: "Email not found" });
        }

        return res.json({
          success: true,
          email: { id: emailSnap.id, ...emailSnap.data() },
          extraction: extractionSnap.exists ? extractionSnap.data() : null,
        });
      }


      // --- FETCH (manual trigger) ---
      if (action === "fetch" && req.method === "POST") {
        // Trigger a manual fetch by calling the same logic as fetchEmails
        // For simplicity, we return a message — the actual fetch runs via the scheduled function
        // or can be triggered manually via the Firebase console
        return res.json({
          success: true,
          message: "Pour déclencher un fetch manuel, utilisez: firebase functions:shell > fetchEmails()",
        });
      }


      // --- CLEANUP-BROKEN-EXPEDITIONS: Remove expedition docs with no receiptId (created from DQR emails by mistake) ---
      if (action === "cleanup-broken-expeditions" && req.method === "POST") {
        const snap = await db.collection("expeditions").get();
        let deleted = 0;
        const details = [];
        for (const doc of snap.docs) {
          const data = doc.data();
          if (!data.receiptId && doc.id.startsWith("EXP-")) {
            await doc.ref.delete();
            deleted++;
            details.push({ id: doc.id, date: data.date, emailId: data.emailId });
          }
        }
        return res.json({ success: true, deleted, details: details.slice(0, 20) });
      }


      // --- REANALYZE-QUALITY: Re-process Driscoll's quality emails that weren't parsed as expeditions ---
      if (action === "reanalyze-quality" && req.method === "POST") {
        // Find emails with isDriscolsReport=true that don't have a corresponding expedition
        const snap = await db.collection("emails").where("isDriscolsReport", "==", true).get();
        let reprocessed = 0;
        let alreadyHaveExp = 0;
        let total = snap.size;
        const details = [];

        for (const doc of snap.docs) {
          const data = doc.data();
          // Check if an expedition already exists for this email
          const expByEmail = await db.collection("expeditions").where("emailId", "==", doc.id).limit(1).get();
          if (!expByEmail.empty) {
            alreadyHaveExp++;
            continue;
          }
          // Also check by receiptId extracted from content
          const receiptMatch = ((data.textBody || "") + " " + (data.htmlBody || "")).match(/Receipt\s+(RID[\-‑]?\d+)/i);
          if (receiptMatch) {
            const rid = receiptMatch[1];
            const expByRid = await db.collection("expeditions").doc(rid).get();
            if (expByRid.exists) {
              alreadyHaveExp++;
              continue;
            }
          }
          // Re-trigger by deleting and re-creating with status=pending
          const newData = { ...data, status: "pending", analysisError: null };
          await doc.ref.delete();
          await db.collection("emails").doc(doc.id).set(newData);
          reprocessed++;
          details.push({ id: doc.id, subject: data.subject, from: data.from });
        }

        return res.json({ success: true, total, alreadyHaveExp, reprocessed, details: details.slice(0, 30) });
      }


      // --- REANALYZE (reset emails to pending, delete old expeditions, re-trigger) ---
      if (action === "reanalyze" && req.method === "POST") {
        const statusFilter = req.query.status || "error";
        const forceAll = req.query.force === "true";
        const query = forceAll
          ? db.collection("emails")
          : db.collection("emails").where("status", "==", statusFilter);
        const snap = await query.get();

        let count = 0;
        for (const doc of snap.docs) {
          const data = doc.data();
          data.status = "pending";
          data.analysisError = null;
          data.extractedTablesRaw = [];
          await doc.ref.delete();
          await db.collection("emails").doc(doc.id).set(data);
          count++;
        }
        return res.json({ success: true, reanalyzed: count });
      }


      // --- EXPEDITIONS LIST ---
      if (action === "expeditions") {
        const limit = parseInt(req.query.limit || "2000");
        let query = db.collection("expeditions").limit(limit);

        const varietyFilter = req.query.variety || null;
        if (varietyFilter) {
          query = query.where("variety", "==", varietyFilter);
        }
        const resultFilter = req.query.result || null;
        if (resultFilter) {
          query = query.where("overallResult", "==", resultFilter.toUpperCase());
        }

        const snap = await query.get();
        const expeditions = [];
        const ghostIds = [];
        snap.docs.forEach((doc) => {
          const data = doc.data();
          // Filter out ghost PFQ expeditions (source=email but no receiptId/variety)
          if (data.source === "email" && !data.receiptId && !data.variety) {
            ghostIds.push(doc.id);
            return;
          }
          expeditions.push({ id: doc.id, ...data });
        });

        // Auto-cleanup ghost expeditions in background
        if (ghostIds.length > 0) {
          const cleanBatch = db.batch();
          ghostIds.forEach(id => cleanBatch.delete(db.collection("expeditions").doc(id)));
          cleanBatch.commit().catch(err => console.warn("Ghost cleanup failed:", err.message));
          console.log(`expeditions: Auto-cleaned ${ghostIds.length} ghost PFQ expeditions`);
        }

        return res.json({ success: true, count: expeditions.length, expeditions });
      }


      // --- EXPEDITION DETAIL ---
      if (action === "expedition-detail") {
        const expId = req.query.expeditionId;
        if (!expId) return res.status(400).json({ success: false, error: "expeditionId required" });

        const expSnap = await db.collection("expeditions").doc(expId).get();
        if (!expSnap.exists) {
          return res.status(404).json({ success: false, error: "Expedition not found" });
        }

        return res.json({
          success: true,
          expedition: { id: expSnap.id, ...expSnap.data() },
        });
      }


      // --- UPDATE-EXPEDITION: Update expedition fields (photo, duplicate, cancel) ---
      // --- FIX-EXPEDITION-STATUS: Restore correct status for expeditions with liquidation data ---
      if (action === "fix-expedition-status") {
        const expsSnap = await db.collection("expeditions").get();
        let fixed = 0;
        const fixes = [];
        for (const doc of expsSnap.docs) {
          const data = doc.data();
          const hasLiq = data.liquidationWeek || data.pricePerKg || data.gsNet;
          const hasBrix = data.pfqBrix !== undefined && data.pfqBrix !== null;
          const isReject = (data.overallResult || "").toUpperCase() === "REJECT";
          const status = data.status || "";

          let correctStatus = null;
          if (isReject) {
            correctStatus = "Rejeté";
          } else if (hasLiq) {
            correctStatus = "Liquidée";
          } else if (hasBrix) {
            correctStatus = "PFQ Brix reçu";
          }

          if (correctStatus && status !== correctStatus) {
            await doc.ref.update({ status: correctStatus, updatedAt: new Date().toISOString() });
            fixes.push({ id: doc.id, from: status, to: correctStatus });
            fixed++;
          }
        }
        return res.json({ success: true, message: `${fixed} expedition(s) status fixed`, fixed, fixes: fixes.slice(0, 30) });
      }


      if (action === "update-expedition" && req.method === "POST") {
        const { expeditionId, updates } = req.body;
        if (!expeditionId) return res.status(400).json({ success: false, error: "expeditionId required" });

        const expRef = db.collection("expeditions").doc(expeditionId);
        const expSnap = await expRef.get();
        if (!expSnap.exists) return res.status(404).json({ success: false, error: "Expedition not found" });

        const allowedFields = [
          "duplicateFlag", "duplicateRequestedBy", "duplicateRequestedAt", "duplicateReason",
          "duplicateValidatedBy", "duplicateValidatedAt", "duplicateCancelled",
          "bonApportPhotos", "bonApportNote",
          "status", "updatedAt",
        ];
        const safeUpdates = {};
        for (const key of Object.keys(updates || {})) {
          if (allowedFields.includes(key)) safeUpdates[key] = updates[key];
        }
        safeUpdates.updatedAt = new Date().toISOString();
        await expRef.update(safeUpdates);

        return res.json({ success: true, updated: Object.keys(safeUpdates) });
      }


      // --- UPLOAD-EXPEDITION-PHOTO: Upload bon d'apport photo ---
      if (action === "upload-expedition-photo" && req.method === "POST") {
        const { expeditionId, image, filename } = req.body;
        if (!expeditionId) return res.status(400).json({ success: false, error: "expeditionId required" });
        if (!image) return res.status(400).json({ success: false, error: "image (base64) required" });

        const expRef = db.collection("expeditions").doc(expeditionId);
        const expSnap = await expRef.get();
        if (!expSnap.exists) return res.status(404).json({ success: false, error: "Expedition not found" });

        const admin = require("firebase-admin");
        const bucket = admin.storage().bucket("berrygood-farms-photos");
        const buffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), "base64");
        const ext = (filename || "photo.jpg").split(".").pop() || "jpg";
        const storagePath = `expeditions/${expeditionId}/${Date.now()}.${ext}`;
        const file = bucket.file(storagePath);
        await file.save(buffer, { metadata: { contentType: `image/${ext}` } });
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // Append to bonApportPhotos array
        const existingPhotos = (expSnap.data().bonApportPhotos) || [];
        existingPhotos.push({ url: publicUrl, path: storagePath, uploadedAt: new Date().toISOString(), filename: filename || "photo.jpg" });
        await expRef.update({ bonApportPhotos: existingPhotos, updatedAt: new Date().toISOString() });

        return res.json({ success: true, url: publicUrl, photosCount: existingPhotos.length });
      }


      // --- CREATE-MANUAL-EXPEDITION: Import expedition from liquidation data ---
      if (action === "create-manual-expedition" && req.method === "POST") {
        const { receiptId, variety, kg, week, year, fruit, source: manualSource } = req.body;
        if (!receiptId) return res.status(400).json({ success: false, error: "receiptId required" });

        // Check for existing expedition with same receipt ID
        const existing = await db.collection("expeditions").where("receiptId", "==", receiptId).limit(1).get();
        if (!existing.empty) {
          return res.status(409).json({ success: false, error: "Expedition with this receiptId already exists", existingId: existing.docs[0].id });
        }

        const docId = `MANUAL-${receiptId}`;
        await db.collection("expeditions").doc(docId).set({
          receiptId,
          variety: variety || "Inconnue",
          batchWeight: parseFloat(kg) || 0,
          berryType: (fruit || "framboise").toUpperCase() === "MYRTILLE" ? "BLUEBERRY" : "RASPBERRY",
          berryTypeFr: (fruit || "framboise").toLowerCase() === "myrtille" ? "Myrtille" : "Framboise",
          date: new Date().toISOString(),
          overallResult: "PASS",
          status: "Saisie manuelle",
          source: manualSource || "manual",
          manualImport: true,
          liquidationWeek: parseInt(week) || null,
          liquidationYear: parseInt(year) || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        return res.json({ success: true, id: docId, receiptId });
      }


      // --- AUDIT DQR: Compare XLSX source vs expeditions ---
      if (action === "audit-dqr") {
        const limitEmails = parseInt(req.query.limit || "10");
        const emailsSnap = await db.collection("emails")
          .where("isDailyQualityReport", "==", true)
          .limit(limitEmails)
          .get();

        const ranchNameToCodeLocal = (name) => {
          if (!name) return null;
          const n = name.toLowerCase();
          if (n.includes('r-berry') || n.includes('r berry') || n.includes('200742')) return '200742';
          if (n.includes('sarl 3') || n.includes('berry good farms sarl') || n.includes('berry good farms') || n.includes('200876')) return '200876';
          return null;
        };

        const results = [];
        for (const emailDoc of emailsSnap.docs) {
          const email = emailDoc.data();
          const emailId = emailDoc.id;
          const report = { emailId, subject: email.subject || '', date: email.date || '', hasXlsx: !!email.xlsxBase64, issues: [], xlsxRowCount: 0, validRowCount: 0, expeditionCount: 0, matched: 0, fieldMismatches: [] };

          if (!email.xlsxBase64) {
            report.issues.push('NO_XLSX_DATA');
            results.push(report);
            continue;
          }

          // Re-parse XLSX
          const xlsxBuffer = Buffer.from(email.xlsxBase64, "base64");
          let brixRows;
          try {
            brixRows = parseDailyQualityReportXlsx(xlsxBuffer);
          } catch (e) {
            report.issues.push('XLSX_PARSE_ERROR: ' + e.message);
            results.push(report);
            continue;
          }
          report.xlsxRowCount = brixRows.length;

          // Also report actual XLSX headers (only for first email)
          if (results.length === 0) {
            try {
              const workbook = XLSX.read(xlsxBuffer, { type: "buffer" });
              const sn = workbook.SheetNames.find(n => /inspection/i.test(n)) || workbook.SheetNames[0];
              const sh = workbook.Sheets[sn];
              const rawRows = XLSX.utils.sheet_to_json(sh, { defval: "" });
              if (rawRows.length > 0) report.xlsxHeaders = Object.keys(rawRows[0]);
              report.sheetName = sn;
              report.sheetNames = workbook.SheetNames;
            } catch (e) { /* ignore */ }
          }

          // Filter valid rows
          const validRows = brixRows.filter(r => {
            const isByPass = (r.inspectionType || '').toLowerCase().includes('by') && (r.inspectionType || '').toLowerCase().includes('pass');
            const eff = (r.inspectionResult && r.inspectionResult !== 'Null') ? r.inspectionResult : (isByPass ? 'PASS' : null);
            return !!eff;
          });
          report.validRowCount = validRows.length;
          report.skippedRows = brixRows.length - validRows.length;

          // Date J-1
          const dqrEmailDate = email.date ? new Date(email.date) : new Date();
          const dqrVeille = new Date(dqrEmailDate);
          dqrVeille.setDate(dqrVeille.getDate() - 1);
          const dqrVeilleISO = dqrVeille.toISOString().split('T')[0];
          report.expectedDateISO = dqrVeilleISO;

          // Receipt dates from XLSX
          report.xlsxReceiptDates = [...new Set(brixRows.map(r => r.receiptDate).filter(Boolean))];

          // Fetch expeditions
          const expSnap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", dqrVeilleISO)
            .get();
          const expeditions = [];
          expSnap.forEach(doc => expeditions.push({ id: doc.id, ...doc.data() }));
          report.expeditionCount = expeditions.length;

          if (validRows.length !== expeditions.length) {
            report.issues.push(`COUNT_MISMATCH: ${validRows.length} xlsx vs ${expeditions.length} expeditions`);
          }

          // Match by batchId — use array to handle duplicates (initial + re-inspection)
          const expByBatch = {};
          for (const exp of expeditions) {
            const k = exp.batchNumber || exp.batchId;
            if (k) {
              if (!expByBatch[k]) expByBatch[k] = [];
              expByBatch[k].push(exp);
            }
          }
          // Track which expedition has been consumed per batchId
          const consumedExp = new Set();

          let matched = 0;
          const unmatchedXlsx = [];
          for (const row of validRows) {
            const candidates = expByBatch[row.batchId] || [];
            // Pick the candidate with matching overallResult, else first unconsumed
            let exp = candidates.find(e => !consumedExp.has(e.id) && e.overallResult === row.inspectionResult);
            if (!exp) exp = candidates.find(e => !consumedExp.has(e.id));
            if (!exp) { unmatchedXlsx.push(row.batchId); continue; }
            consumedExp.add(exp.id);
            matched++;

            const checks = [
              { field: 'variety', xlsx: (row.variety || '').trim(), fs: (exp.variety || '').trim() },
              { field: 'batchWeight', xlsx: row.weight, fs: parseFloat(exp.batchWeight) || 0 },
              { field: 'batchQuantity', xlsx: row.quantity, fs: parseFloat(exp.batchQuantity) || 0 },
              { field: 'brix', xlsx: row.brix, fs: parseFloat(exp.brixFromDQR || exp.brix) || 0 },
              { field: 'overallResult', xlsx: row.inspectionResult, fs: exp.overallResult },
              { field: 'enrichedPqScore', xlsx: row.enrichedPqScore, fs: parseFloat(exp.enrichedPqScore) || 0 },
              { field: 'receiptId', xlsx: (row.receiptId || '').trim(), fs: (exp.receiptId || '').trim() },
            ];
            for (const chk of checks) {
              const xv = typeof chk.xlsx === 'number' ? chk.xlsx : (chk.xlsx || '');
              const fv = typeof chk.fs === 'number' ? chk.fs : (chk.fs || '');
              if (String(xv) !== String(fv)) {
                report.fieldMismatches.push({ batchId: row.batchId, field: chk.field, xlsx: xv, firestore: fv });
              }
            }

            // Ranch check
            const expectedRanch = ranchNameToCodeLocal(row.ranchName);
            if (row.ranchName && !expectedRanch) {
              report.issues.push(`UNMAPPED_RANCH: "${row.ranchName}" for batch ${row.batchId}`);
            }
          }
          report.matched = matched;
          // For unmatched XLSX batches, check if they exist at OTHER dates (cross-date lookup)
          // This handles bulk catch-up emails where receiptDate ≠ J-1
          const trulyMissing = [];
          const foundElsewhere = [];
          for (const batchId of unmatchedXlsx) {
            const otherSnap = await db.collection("expeditions")
              .where("source", "==", "dqr-auto-created")
              .where("batchNumber", "==", batchId)
              .get();
            if (otherSnap.empty) {
              trulyMissing.push(batchId);
            } else {
              const dates = otherSnap.docs.map(d => d.data().dateISO);
              foundElsewhere.push({ batchId, foundAt: dates });
            }
          }
          if (trulyMissing.length > 0) report.unmatchedXlsxBatches = trulyMissing;
          if (foundElsewhere.length > 0) report.batchesAtOtherDates = foundElsewhere;

          // Show existing expedition docIds for comparison
          report.existingExpDocIds = expeditions.map(e => ({ docId: e.id, batchNumber: e.batchNumber, receiptId: e.receiptId }));

          // Unmatched expeditions = those not consumed by any XLSX row
          const unmatchedExp = expeditions.filter(e => !consumedExp.has(e.id)).map(e => ({ docId: e.id, batchNumber: e.batchNumber, receiptId: e.receiptId, overallResult: e.overallResult }));
          if (unmatchedExp.length > 0) report.unmatchedExpBatches = unmatchedExp;

          // Summary by ranch
          const byRanch = {};
          for (const row of validRows) {
            const ranch = ranchNameToCodeLocal(row.ranchName) || 'unknown';
            const ferme = ranch === '200742' ? 'F1' : ranch === '200876' ? 'F5' : ranch;
            if (!byRanch[ferme]) byRanch[ferme] = { count: 0, kg: 0, pass: 0, fail: 0 };
            byRanch[ferme].count++;
            byRanch[ferme].kg += row.weight;
            if ((row.inspectionResult || '').toLowerCase() === 'pass') byRanch[ferme].pass++;
            else byRanch[ferme].fail++;
          }
          report.summaryByFerme = byRanch;

          results.push(report);
        }

        return res.json({ success: true, emailsAudited: results.length, results });
      }


      // --- LIQUIDATIONS: List all liquidations ---
      // --- WEEKLY-QUALITY-REPORTS: List weekly quality reports ---
      if (action === "weekly-quality-reports") {
        const limit = parseInt(req.query.limit || "50");
        const snap = await db.collection("weekly_quality_reports").orderBy("createdAt", "desc").limit(limit).get();
        const reports = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, count: reports.length, reports });
      }


      if (action === "liquidations") {
        const limit = parseInt(req.query.limit || "50");
        const snap = await db.collection("liquidations").orderBy("createdAt", "desc").limit(limit).get();
        const liquidations = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ success: true, count: liquidations.length, liquidations });
      }


      // --- LIQUIDATION FORECAST: extract from Driscoll's slide via Claude Vision ---
      if (action === "liquidation-forecast-extract") {
        if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST uniquement" });
        const { fruitCode, imageBase64, mediaType } = req.body || {};
        const forecastService = require("../recolte/forecastService");
        const result = await forecastService.extractForecastFromImage(fruitCode, imageBase64, mediaType);
        if (!result.success) {
          const status = result.error === "LLM_UNAVAILABLE" || result.error === "Réponse Claude non parsable" ? 502
                       : result.error === "Clé API Anthropic non configurée" ? 500 : 400;
          return res.status(status).json(result);
        }
        return res.json(result);
      }


      if (action === "liquidation-forecast-save") {
        if (req.method !== "POST") return res.status(405).json({ success: false, error: "POST uniquement" });
        const { fruitCode, year, weeks, imageBase64, mediaType } = req.body || {};
        const forecastService = require("../recolte/forecastService");
        const result = await forecastService.saveForecast(fruitCode, year, weeks, {
          updatedBy: authUser.email || authUser.uid || "unknown",
          imageBase64,
          mediaType,
        });
        if (!result.success) return res.status(400).json(result);
        return res.json(result);
      }


      if (action === "liquidation-forecast-list") {
        const yr = parseInt(req.query.year) || new Date().getFullYear();
        const codes = ["RASP", "BLUE"];
        const forecasts = [];
        for (const code of codes) {
          const snap = await db.collection("liquidation_forecasts").doc(`FORECAST-${code}-${yr}`).get();
          if (snap.exists) forecasts.push({ id: snap.id, ...snap.data() });
        }
        return res.json({ success: true, year: yr, forecasts });
      }


      // --- VARIETY-MAPPING: Get or update batch code → variety name mapping ---
      if (action === "variety-mapping") {
        const docRef = db.collection("email_config").doc("variety_mapping");

        if (req.method === "POST") {
          // Save mapping: { "172-R01": "Maravilla", "195-R50": "Reyna", ... }
          const mapping = req.body.mapping || req.body;
          await docRef.set({ mapping, updatedAt: new Date().toISOString() }, { merge: true });
          return res.json({ success: true, mapping });
        }

        // GET: return current mapping
        const snap = await docRef.get();
        const mapping = snap.exists ? (snap.data().mapping || {}) : {};
        return res.json({ success: true, mapping });
      }


      // --- REFETCH-DQR: Re-fetch DQR emails from IMAP (scans BULK .eml + direct DQR) ---
      if (action === "refetch-dqr") {
        const client = createImapClient();
        let processed = 0;

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          // Search only BULK and DQR emails by subject
          const searchResults = await client.search({ or: [
            { subject: "BULK" },
            { subject: "Daily Quality Report" },
          ]});

          if (searchResults.length === 0) {
            await client.logout();
            return res.json({ success: true, message: "No matching emails found", processed: 0 });
          }

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";

              // Process BULK emails: extract inner .eml DQR attachments
              if (/bulk/i.test(subject)) {
                const emlAtts = (parsed.attachments || []).filter(
                  a => (a.filename || "").toLowerCase().endsWith(".eml") || (a.contentType || "").includes("message/rfc822")
                );
                for (const emlAtt of emlAtts) {
                  try {
                    const inner = await simpleParser(emlAtt.content);
                    const innerSubject = inner.subject || "";
                    if (!isDailyQualityReport(null, innerSubject)) continue;
                    const xa = (inner.attachments || []).find(a => /\.(xlsx|xls)$/i.test(a.filename || ""));
                    if (!xa || !xa.content) continue;

                    const docId = (inner.messageId || `bulk-dqr-${msg.uid}-${processed}`)
                      .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
                    const existingSnap = await db.collection("emails").doc(docId).get();
                    if (existingSnap.exists) {
                      await db.collection("emails").doc(docId).delete();
                      await db.collection("email_extractions").doc(docId).delete().catch(() => {});
                    }
                    await db.collection("emails").doc(docId).set({
                      messageId: inner.messageId || docId,
                      uid: msg.uid,
                      from: inner.from?.text || "", fromName: inner.from?.value?.[0]?.name || "",
                      to: inner.to?.text || "", subject: innerSubject,
                      date: inner.date ? inner.date.toISOString() : new Date().toISOString(),
                      receivedAt: new Date().toISOString(),
                      textBody: (inner.text || "").slice(0, 50000),
                      htmlBody: (inner.html || "").slice(0, 100000),
                      hasAttachments: true,
                      attachments: (inner.attachments || []).map(a => ({ filename: a.filename || "unknown", contentType: a.contentType || "", size: a.size || 0 })),
                      xlsxBase64: xa.content.toString("base64"),
                      isDailyQualityReport: true,
                      status: "pending", analysisError: null, extractedTablesRaw: [],
                    });
                    processed++;
                    console.log(`refetch-dqr: Extracted DQR "${innerSubject}" from BULK`);
                  } catch (innerErr) {
                    console.error(`refetch-dqr: Error parsing inner .eml:`, innerErr.message);
                  }
                }
                continue;
              }

              // Direct DQR email
              if (!isDailyQualityReport(null, subject)) continue;
              const xa = (parsed.attachments || []).find(a => /\.(xlsx|xls)$/i.test(a.filename || ""));
              if (!xa || !xa.content) continue;

              const docId = (parsed.messageId || `uid-${msg.uid}`).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);
              const existingSnap = await db.collection("emails").doc(docId).get();
              if (existingSnap.exists) {
                await db.collection("emails").doc(docId).delete();
                await db.collection("email_extractions").doc(docId).delete().catch(() => {});
              }
              await db.collection("emails").doc(docId).set({
                messageId: parsed.messageId || `uid-${msg.uid}`,
                uid: msg.uid,
                from: parsed.from?.text || "", fromName: parsed.from?.value?.[0]?.name || "",
                to: parsed.to?.text || "", subject,
                date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                receivedAt: new Date().toISOString(),
                textBody: (parsed.text || "").slice(0, 50000),
                htmlBody: (parsed.html || "").slice(0, 100000),
                hasAttachments: true,
                attachments: (parsed.attachments || []).map(a => ({ filename: a.filename || "unknown", contentType: a.contentType || "", size: a.size || 0 })),
                xlsxBase64: xa.content.toString("base64"),
                isDailyQualityReport: true,
                status: "pending", analysisError: null, extractedTablesRaw: [],
              });
              processed++;
              console.log(`refetch-dqr: Stored DQR "${subject}" with XLSX`);
            } catch (parseErr) {
              console.error(`refetch-dqr: Error parsing UID ${msg.uid}:`, parseErr.message);
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, message: `${processed} Daily Quality Report(s) re-fetched with XLSX`, processed });
      }


      // --- PROCESS-WEEKLY-QR: Fetch from IMAP, parse PDF, store directly (bypass trigger) ---
      if (action === "process-weekly-qr") {
        const client = createImapClient();
        let processed = 0;
        const results = [];

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          const searchResults = await client.search({ subject: "Weekly Quality Report" });
          console.log(`process-weekly-qr: Found ${searchResults.length} emails`);

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";
              if (!isWeeklyQualityReport(null, subject)) continue;

              const pdfAtt = (parsed.attachments || []).find(a => /\.pdf$/i.test(a.filename || ""));
              if (!pdfAtt || !pdfAtt.content) { results.push({ subject, error: "No PDF attachment" }); continue; }

              console.log(`process-weekly-qr: Parsing PDF from "${subject}" (${pdfAtt.content.length} bytes)`);
              const report = await parseWeeklyQualityReportPdf(pdfAtt.content);

              const berry = report.berry || "framboise";
              const docId = `WQR-${berry.toUpperCase().slice(0, 4)}-W${report.week || "?"}-${report.year || "?"}`;

              await db.collection("weekly_quality_reports").doc(docId).set({
                emailId: (parsed.messageId || `uid-${msg.uid}`).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200),
                week: report.week,
                year: report.year,
                berry: report.berry,
                pwResults: report.pwResults,
                brixSummary: report.brixSummary,
                ourRanches: report.ourRanches,
                allRanchCount: report.allRanchCount,
                totalVolume: report.totalVolume,
                subject,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });

              processed++;
              results.push({ docId, subject, week: report.week, year: report.year, berry: report.berry, ranches: report.ourRanches });
            } catch (parseErr) {
              console.error(`process-weekly-qr: Error:`, parseErr.message);
              results.push({ error: parseErr.message });
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, processed, results });
      }


      // --- DEBUG-WEEKLY-QR: Show raw PDF text for debugging parser ---
      if (action === "debug-weekly-qr") {
        const client = createImapClient();
        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");
          const searchResults = await client.search({ subject: "Weekly Quality Report" });
          if (searchResults.length === 0) return res.json({ success: false, error: "No WQR emails found" });
          // Get first one
          for await (const msg of client.fetch([searchResults[0]], { uid: true, source: true })) {
            const parsed = await simpleParser(msg.source);
            const pdfAtt = (parsed.attachments || []).find(a => /\.pdf$/i.test(a.filename || ""));
            if (!pdfAtt) return res.json({ success: false, error: "No PDF" });
            const pdfParser = new PDFParse({ data: pdfAtt.content });
            const textResult = await pdfParser.getText();
            const text = (textResult && textResult.text) || "";
            return res.json({ success: true, subject: parsed.subject, textLength: text.length, text });
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }
      }

  return NOT_HANDLED;
};
