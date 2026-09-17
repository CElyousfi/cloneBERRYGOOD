/* Actions 3/3 de emailAnalysis — corps repris VERBATIM.
   Le contexte du handler arrive par `ctx` ; la destructuration ci-dessous
   recree exactement les liaisons d'origine. */
'use strict';
const { NOT_HANDLED } = require("./emailService.dispatch");
const { PDFParse, XLSX, admin, db, mapBerryToFrench } = require("./emailService.part1");
const { parseDailyQualityReportXlsx } = require("./emailService.part2");

module.exports = async function emailServiceActions3(ctx) {
  const { req, res, authUser, action } = ctx;


      if (action === "reprocess-dqr" && req.method === "POST") {
        const { days = 10 } = req.body || {};
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffISO = cutoff.toISOString();

        const ranchNameToCode = (name) => {
          if (!name) return null;
          const n = name.toLowerCase();
          if (n.includes("r-berry") || n.includes("r berry") || n.includes("200742")) return "200742";
          if (n.includes("sarl 3") || n.includes("berry good farms sarl") || n.includes("berry good farms") || n.includes("200876")) return "200876";
          return null;
        };

        // Carry-forward missing fields in brixRows (Receipt ID, Ranch Name, Berry Type, Variety, Product Name)
        // Note: inspectionResult and inspectionType are NOT carried forward — each batch has its own
        const applyCarryForward = (rows) => {
          let lastReceiptId = null, lastRanchName = null, lastBerryType = null, lastVariety = null, lastProductName = null;
          return rows.map(row => {
            if (row.receiptId) lastReceiptId = row.receiptId;
            if (row.ranchName) lastRanchName = row.ranchName;
            if (row.berryType) lastBerryType = row.berryType;
            if (row.variety) lastVariety = row.variety;
            if (row.productName) lastProductName = row.productName;
            return {
              ...row,
              receiptId: row.receiptId || lastReceiptId || null,
              ranchName: row.ranchName || lastRanchName || null,
              berryType: row.berryType || lastBerryType || null,
              variety: row.variety || lastVariety || null,
              productName: row.productName || lastProductName || null,
            };
          });
        };

        // Parse receiptDate from XLSX (Excel serial or string) — same as analyzeEmail
        const parseReceiptDateXlsx = (rd) => {
          if (!rd) return null;
          if (typeof rd === 'number') {
            const d = new Date((rd - 25569) * 86400000);
            return d.toISOString().split('T')[0];
          }
          const s = rd.toString().trim();
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
          const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
          return null;
        };

        // Find DQR email_extractions
        const extractionsSnap = await db.collection("email_extractions")
          .where("category", "==", "daily_quality_report")
          .get();

        // Phase 1: Collect ALL brixRows from ALL emails, grouped by REAL receiptDate
        // (handles bulk catch-up emails where one email covers multiple past days)
        const rowsByDate = {}; // dateISO → array of {row, emailId, fallbackDate}
        const emailIdsProcessed = new Set();

        for (const doc of extractionsSnap.docs) {
          const ext = doc.data();
          if (ext.analyzedAt < cutoffISO) continue;

          const emailSnap = await db.collection("emails").doc(doc.id).get();
          if (!emailSnap.exists) continue;
          const emailData = emailSnap.data();
          const emailDate = emailData.date ? new Date(emailData.date) : null;
          if (!emailDate) continue;

          let brixRows;
          if (emailData.xlsxBase64) {
            const xlsxBuffer = Buffer.from(emailData.xlsxBase64, "base64");
            brixRows = parseDailyQualityReportXlsx(xlsxBuffer);
            await db.collection("email_extractions").doc(doc.id).update({
              "structuredData.brixRows": brixRows
            });
          } else {
            const rawBrixRows = ext.structuredData?.brixRows;
            if (!rawBrixRows || rawBrixRows.length === 0) continue;
            brixRows = applyCarryForward(rawBrixRows);
          }

          emailIdsProcessed.add(doc.id);
          const veille = new Date(emailDate);
          veille.setDate(veille.getDate() - 1);
          const veilleISO = veille.toISOString().split("T")[0];

          for (const row of brixRows) {
            // Use receiptDate from XLSX if available, else email J-1
            const realDate = parseReceiptDateXlsx(row.receiptDate) || veilleISO;
            if (!rowsByDate[realDate]) rowsByDate[realDate] = [];
            rowsByDate[realDate].push({ row, emailId: doc.id, emailDate: emailDate.toISOString() });
          }
        }

        // Phase 2: For each unique date, delete existing DQR expeditions and recreate from union
        const results = [];
        for (const [dateISO, entries] of Object.entries(rowsByDate)) {
          // Delete old DQR expeditions for this date
          let deletedCount = 0;
          const oldDqrSnap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", dateISO)
            .get();
          if (!oldDqrSnap.empty) {
            const batch = db.batch();
            oldDqrSnap.docs.forEach(d => { batch.delete(d.ref); deletedCount++; });
            await batch.commit();
          }

          // Sort entries: prefer most recent email (last write wins for same docId)
          entries.sort((a, b) => a.emailDate.localeCompare(b.emailDate));

          // Dédup Initial/Re-Inspection par batchId : garder Re-Inspection (verdict final)
          // si elle existe, sinon Initial. Évite le doublonnage sur les batches ré-inspectés.
          const isReInspectionRow = (t) => /re[\s-]?inspection/i.test(t || '');
          const entriesByBatch = {};
          for (const entry of entries) {
            const bId = entry.row.batchId;
            if (!bId) continue;
            const existing = entriesByBatch[bId];
            if (!existing) {
              entriesByBatch[bId] = entry;
            } else if (isReInspectionRow(entry.row.inspectionType) && !isReInspectionRow(existing.row.inspectionType)) {
              entriesByBatch[bId] = entry;
            } else if (isReInspectionRow(entry.row.inspectionType) === isReInspectionRow(existing.row.inspectionType)) {
              // same type → keep most recent emailDate (already sorted, last wins)
              entriesByBatch[bId] = entry;
            }
          }
          const dedupedEntries = Object.values(entriesByBatch);
          if (dedupedEntries.length !== entries.length) {
            console.log(`reprocess-dqr ${dateISO}: dedup ${entries.length} → ${dedupedEntries.length} (Initial/Re-Inspection)`);
          }

          // Recreate, deduping by docId across emails
          let createdCount = 0;
          const reprocessDocIdCounter = {};
          const seenDocIds = new Set();
          for (const { row, emailId } of dedupedEntries) {
            const isByPass = (row.inspectionType || '').toLowerCase().includes('by') && (row.inspectionType || '').toLowerCase().includes('pass');
            const effectiveResult = (row.inspectionResult && row.inspectionResult !== 'Null') ? row.inspectionResult : (isByPass ? 'PASS' : null);
            if (!effectiveResult) continue;
            const receiptId = row.receiptId || null;
            let baseDocId = receiptId
              ? `${receiptId}__${(row.batchId || "").replace(/[^a-zA-Z0-9-]/g, "-")}`
              : `DQR-${row.batchId}-${emailId.substring(0, 20)}`;
            reprocessDocIdCounter[baseDocId] = (reprocessDocIdCounter[baseDocId] || 0) + 1;
            const expDocId = reprocessDocIdCounter[baseDocId] > 1 ? `${baseDocId}__${reprocessDocIdCounter[baseDocId]}` : baseDocId;
            const ranch = ranchNameToCode(row.ranchName);

            await db.collection("expeditions").doc(expDocId).set({
              receiptId, batchNumber: row.batchId || null,
              berryType: row.berryType || null, berryTypeFr: mapBerryToFrench(row.berryType),
              variety: (row.variety || "").trim().replace(/[™®]/g, "") || null,
              itemDescription: row.productName || null,
              batchWeight: row.weight || 0, batchQuantity: row.quantity || 0,
              totalFruitInspected: row.totalFruitInspected || 0,
              brix: row.brix || null, pfqBrix: row.brixPoints || 0,
              brixFromDQR: row.brix || 0, enrichedPqScore: row.enrichedPqScore || 0,
              initialPq: row.initialPq || 0, reInspectionPq: row.reInspectionPq || 0,
              pqScore: row.enrichedPqScore || row.brixPoints || 0,
              pfqTotal: row.brixPoints || 0, pfqCondition: 0, pfqApparence: 0,
              overallResult: effectiveResult,
              inspectionType: row.inspectionType || null,
              ranch, ranchName: row.ranchName || null,
              status: "DQR reçu", source: "dqr-auto-created",
              dateISO, date: dateISO,
              sourceEmailId: emailId,
              createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });
            seenDocIds.add(expDocId);
            createdCount++;
          }

          results.push({ date: dateISO, emails: [...new Set(entries.map(e => e.emailId))].length, deleted: deletedCount, created: createdCount });
        }

        // ---- Step 3: Shift J+1 expeditions to J when they match unmatched bons ----
        const normV = (v) => (v || '').toLowerCase().replace(/[™®\s-]/g, '').replace(/sol$/, '').replace(/(.)\1+/g, '$1');
        let totalShifted = 0;

        // Collect all unique dates processed
        const processedDates = [...new Set(results.map(r => r.date))].sort();

        for (const dateISO of processedDates) {
          // Get bons d'apport Export for this date (stored in pfq_interne collection)
          const bonsSnap = await db.collection("pfq_interne").where("date", "==", dateISO).get();
          const bonsExport = [];
          bonsSnap.forEach(d => {
            const data = d.data();
            if ((data.typeVente || '').toLowerCase() !== 'marché local' && (data.typeVente || '').toLowerCase() !== 'marche local') {
              bonsExport.push({ id: d.id, ...data });
            }
          });
          if (bonsExport.length === 0) continue;

          // Get DQR expeditions for this date (J)
          const expJSnap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", dateISO)
            .get();
          const expJ = [];
          expJSnap.forEach(d => expJ.push({ id: d.id, ...d.data() }));

          // Get DQR expeditions for J+1
          const nextD = new Date(dateISO + 'T00:00:00');
          nextD.setDate(nextD.getDate() + 1);
          const nextISO = nextD.toISOString().split('T')[0];
          const expJ1Snap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", nextISO)
            .get();
          const expJ1 = [];
          expJ1Snap.forEach(d => expJ1.push({ id: d.id, ...d.data() }));

          if (expJ1.length === 0) continue;

          // Match bons to J expeditions first
          const usedJIds = new Set();
          const unmatchedBons = [];
          for (const bon of bonsExport) {
            const bonVar = normV(bon.blocVariete || '');
            const bonKg = parseFloat(bon.poidsLot) || 0;
            let found = false;
            for (const exp of expJ) {
              if (usedJIds.has(exp.id)) continue;
              const expVar = normV(exp.variety || '');
              if (!(bonVar && expVar && (bonVar.includes(expVar) || expVar.includes(bonVar)))) continue;
              const expKg = parseFloat(exp.batchWeight) || 0;
              if (bonKg > 0 && expKg > 0) {
                const ratio = Math.min(bonKg, expKg) / Math.max(bonKg, expKg);
                if (ratio >= 0.5) { usedJIds.add(exp.id); found = true; break; }
              }
            }
            if (!found) unmatchedBons.push(bon);
          }

          // Try to match unmatched bons with J+1 expeditions → shift them to J
          const usedJ1Ids = new Set();
          for (const bon of unmatchedBons) {
            const bonVar = normV(bon.blocVariete || '');
            const bonKg = parseFloat(bon.poidsLot) || 0;
            for (const exp of expJ1) {
              if (usedJ1Ids.has(exp.id)) continue;
              const expVar = normV(exp.variety || '');
              if (!(bonVar && expVar && (bonVar.includes(expVar) || expVar.includes(bonVar)))) continue;
              const expKg = parseFloat(exp.batchWeight) || 0;
              if (bonKg > 0 && expKg > 0) {
                const ratio = Math.min(bonKg, expKg) / Math.max(bonKg, expKg);
                if (ratio >= 0.5) {
                  // Shift this J+1 expedition to J
                  await db.collection("expeditions").doc(exp.id).set({
                    dateISO: dateISO,
                    date: dateISO,
                    dateOrigine: nextISO,
                    decalage: true,
                    updatedAt: new Date().toISOString(),
                  }, { merge: true });
                  usedJ1Ids.add(exp.id);
                  totalShifted++;
                  console.log(`reprocess-dqr: Shifted expedition ${exp.id} (${exp.variety}, ${exp.batchWeight}kg) from ${nextISO} → ${dateISO}`);
                  break;
                }
              }
            }
          }
        }

        const shiftMsg = totalShifted > 0 ? `, ${totalShifted} expédition(s) décalée(s) J+1→J` : '';
        return res.json({ success: true, message: `${results.length} DQR(s) reprocessed${shiftMsg}`, results, shifted: totalShifted });
      }


      // --- CLEANUP-DUPLICATE-DQR: drop Initial-Inspection docs when Re-Inspection exists for same batch ---
      if (action === "cleanup-duplicate-dqr" && req.method === "POST") {
        const { apply = false } = req.body || {};
        const isReInsp = (t) => /re[\s-]?inspection/i.test(t || "");
        const snap = await db.collection("expeditions").where("source", "==", "dqr-auto-created").get();
        const groups = {};
        snap.docs.forEach(doc => {
          const d = doc.data();
          const key = `${d.receiptId || "?"}__${d.batchNumber || "?"}`;
          if (!groups[key]) groups[key] = [];
          groups[key].push({ id: doc.id, ref: doc.ref, ...d });
        });
        const toDelete = [];
        const summaryByDate = {};
        const groupReports = [];
        for (const [key, docs] of Object.entries(groups)) {
          if (docs.length < 2) continue;
          docs.sort((a, b) => {
            const ari = isReInsp(a.inspectionType), bri = isReInsp(b.inspectionType);
            if (ari !== bri) return ari ? -1 : 1;
            return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
          });
          const [keep, ...remove] = docs;
          const date = keep.dateISO || keep.date || "?";
          summaryByDate[date] = (summaryByDate[date] || 0) + remove.length;
          groupReports.push({
            key, date, variety: keep.variety, weight: keep.batchWeight,
            keep: { id: keep.id, type: keep.inspectionType, result: keep.overallResult },
            drop: remove.map(r => ({ id: r.id, type: r.inspectionType, result: r.overallResult })),
          });
          toDelete.push(...remove);
        }
        if (apply && toDelete.length > 0) {
          for (let i = 0; i < toDelete.length; i += 400) {
            const batch = db.batch();
            toDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
            await batch.commit();
          }
        }
        return res.json({
          success: true,
          mode: apply ? "applied" : "dry-run",
          totalDqrDocs: snap.size,
          duplicateGroups: groupReports.length,
          docsToDelete: toDelete.length,
          deleted: apply ? toDelete.length : 0,
          summaryByDate,
          groups: groupReports.slice(0, 100),
        });
      }


      // --- PLANT-INVOICES: list all uploaded Driscoll's plant invoices ---
      if (action === "plant-invoices") {
        const snap = await db.collection("plant_invoices").orderBy("date", "asc").get();
        const invoices = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return res.json({ success: true, count: invoices.length, invoices });
      }


      // --- DELETE-PLANT-INVOICE: remove one (or all variants of a ref) + storage cleanup ---
      if (action === "delete-plant-invoice" && req.method === "POST") {
        const { id, ref, deleteStorage } = req.body || {};
        const bucket = admin.storage().bucket("berrygood-farms-photos");
        const storagePathsToDelete = new Set();

        if (id) {
          const docRef = db.collection("plant_invoices").doc(id);
          const snap = await docRef.get();
          if (snap.exists && snap.data().storagePath) storagePathsToDelete.add(snap.data().storagePath);
          await docRef.delete();
        } else if (ref) {
          const snap = await db.collection("plant_invoices").where("ref", "==", ref).get();
          for (const d of snap.docs) {
            if (d.data().storagePath) storagePathsToDelete.add(d.data().storagePath);
            await d.ref.delete();
          }
        } else {
          return res.status(400).json({ success: false, error: "id or ref required" });
        }

        // Delete the underlying PDF file(s) from Storage if requested (default true)
        if (deleteStorage !== false) {
          for (const path of storagePathsToDelete) {
            try { await bucket.file(path).delete(); } catch (e) { console.warn("Storage delete fail:", path, e.message); }
          }
        }
        return res.json({ success: true, deleted: 1 });
      }


      // --- RESCAN-PLANT-INVOICE: re-run AI extraction on an existing PDF in Storage ---
      if (action === "rescan-plant-invoice" && req.method === "POST") {
        const { ref } = req.body || {};
        if (!ref) return res.status(400).json({ success: false, error: "ref required" });
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "ANTHROPIC_API_KEY manquante" });

        // Find any existing doc to recover the storagePath (or pdfUrl)
        const existing = await db.collection("plant_invoices").where("ref", "==", ref).limit(1).get();
        if (existing.empty) return res.status(404).json({ success: false, error: "Facture introuvable" });
        const existingDoc = existing.docs[0].data();
        let storagePath = existingDoc.storagePath;
        if (!storagePath && existingDoc.pdfUrl) {
          // Recover storagePath from public URL
          const m = existingDoc.pdfUrl.match(/storage\.googleapis\.com\/[^/]+\/(.+)$/);
          if (m) storagePath = decodeURIComponent(m[1]);
        }
        if (!storagePath) return res.status(404).json({ success: false, error: "Chemin Storage introuvable pour cette facture" });

        // Download the PDF from Storage
        const bucket = admin.storage().bucket("berrygood-farms-photos");
        const [buffer] = await bucket.file(storagePath).download();
        const cleanBase64 = buffer.toString("base64");
        const ext = storagePath.split(".").pop().toLowerCase();
        const isPdf = ext === "pdf";

        // Try pdf-parse first
        let pdfText = "";
        if (isPdf) {
          try {
            const p = new PDFParse({ data: buffer });
            const r = await p.getText();
            pdfText = (r && r.text) || "";
          } catch (e) { console.warn("rescan pdf-parse:", e.message); }
        }

        // Same prompt as scan-plant-invoice
        const PROMPT = `Tu analyses une facture de plants framboise/myrtille émise par Driscoll's Du Maroc SARL à Berry Good Farms SARL.

VÉRIFICATION (toutes doivent être vraies, sinon accepted=false):
- Le fournisseur (en-tête, émetteur) contient "Driscoll" dans son nom.
- Le client (destinataire) contient "Berry Good" ou "BGF" dans son nom.

STRUCTURE DES FACTURES DRISCOLL'S — TRÈS IMPORTANT:
Une facture peut contenir PLUSIEURS lignes. Chaque ligne a son propre numéro de commande (SO...) et son propre packing slip (PS-...).

EXTRACTION — retourne UNIQUEMENT ce JSON (pas de markdown):
{
  "accepted": true,
  "rejection_reason": null,
  "ref": "INV17074653",
  "date": "2024-12-19",
  "echeance": "2025-03-19",
  "livraison": "2024-12-18",
  "items": [
    { "variete": "Corrina PL 1L", "qte": 4000, "montant": 159200.00, "commande": "SO17109654", "packing": "PS-000103860" }
  ],
  "total_montant": 328350.00,
  "confidence": 0.95
}

Règles:
- Chaque item DOIT avoir son "commande" (SO...) et "packing" (PS-...).
- "qte" et "montant" sont des nombres purs (pas de virgule ni espace).
- Vérifie que la somme des items.montant ≈ total_montant.`;

        const Anthropic = require("@anthropic-ai/sdk");
        const aiClient = new Anthropic({ apiKey });
        const messageContent = [];
        if (pdfText && pdfText.length > 50) messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
        else if (isPdf) messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 }});
        else {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 }});
        }
        messageContent.push({ type: "text", text: PROMPT });

        let resp;
        for (const model of ["claude-sonnet-4-5", "claude-opus-4-5"]) {
          try {
            resp = await aiClient.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            if (model === "claude-opus-4-5") throw e;
          }
        }
        const aiText = resp.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis = null;
        try {
          const m = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(m ? m[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA non structurée", raw: aiText });
        }
        if (!analysis || analysis.accepted === false) {
          return res.json({ success: false, analysis, error: analysis?.rejection_reason || "Facture rejetée" });
        }

        // Wipe stale docs for this ref
        const stale = await db.collection("plant_invoices").where("ref", "==", ref).get();
        for (const d of stale.docs) await d.ref.delete();

        // Re-classify and persist
        const isMyrtille = (v) => /corina|corrina|cascade|breeze|eterna|regina|rosita|biloxi|emerald|jewel|liberty|myrtille|blueberr|blue/i.test(v || "");
        const now = new Date().toISOString();
        const created = [];
        const items = analysis.items || [];
        const pdfUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it || !it.variete) continue;
          const slug = String(it.variete).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const cmd = it.commande || analysis.commande || `idx${i}`;
          const cmdSlug = String(cmd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const docId = `${analysis.ref}__${cmdSlug}__${slug}__${i}`;
          await db.collection("plant_invoices").doc(docId).set({
            ref: analysis.ref || ref,
            date: analysis.date || null,
            echeance: analysis.echeance || null,
            livraison: analysis.livraison || null,
            commande: it.commande || analysis.commande || null,
            packing: it.packing || analysis.packing || null,
            variete: it.variete,
            qte: typeof it.qte === "number" ? it.qte : (parseFloat(it.qte) || 0),
            montant: typeof it.montant === "number" ? it.montant : (parseFloat(it.montant) || 0),
            culture: isMyrtille(it.variete) ? "myrtille" : "framboise",
            pdfUrl,
            storagePath,
            confidence: analysis.confidence || null,
            invoiceTotal: analysis.total_montant || null,
            uploadedAt: existingDoc.uploadedAt || now,
            updatedAt: now,
          }, { merge: true });
          created.push(docId);
        }
        return res.json({ success: true, analysis, created });
      }


      // --- SCAN-PLANT-INVOICE: upload + AI extract a Driscoll's plant invoice PDF ---
      if (action === "scan-plant-invoice" && req.method === "POST") {
        const { pdf_base64, filename } = req.body || {};
        if (!pdf_base64) return res.status(400).json({ success: false, error: "pdf_base64 requis" });
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "ANTHROPIC_API_KEY manquante" });

        // Strip data URL prefix
        const cleanBase64 = pdf_base64.replace(/^data:(application\/pdf|image\/\w+);base64,/, "");
        const buffer = Buffer.from(cleanBase64, "base64");
        const safeName = (filename || `plant_invoice_${Date.now()}.pdf`).replace(/[^a-zA-Z0-9._-]/g, "_");
        const ext = safeName.split(".").pop().toLowerCase() || "pdf";
        const isPdf = ext === "pdf";
        const isImage = ["jpg", "jpeg", "png", "webp"].includes(ext);
        if (!isPdf && !isImage) return res.status(400).json({ success: false, error: "Format non supporté (pdf/jpg/png/webp)" });

        // 1) Upload to Storage
        const storagePath = `plant_invoices/${new Date().getFullYear()}/${Date.now()}_${safeName}`;
        const bucket = admin.storage().bucket("berrygood-farms-photos");
        const contentType = isPdf ? "application/pdf" : `image/${ext === "jpg" ? "jpeg" : ext}`;
        await bucket.file(storagePath).save(buffer, { metadata: { contentType } });
        const pdfUrl = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;

        // 2) Try pdf-parse text first (cheap path); fallback to Claude document/image
        let pdfText = "";
        if (isPdf) {
          try {
            const p = new PDFParse({ data: buffer });
            const r = await p.getText();
            pdfText = (r && r.text) || "";
          } catch (e) { console.warn("scan-plant-invoice pdf-parse:", e.message); }
        }

        // 3) Call Claude with Driscoll's-specific prompt
        const PROMPT = `Tu analyses une facture de plants framboise/myrtille émise par Driscoll's Du Maroc SARL à Berry Good Farms SARL.

VÉRIFICATION (toutes doivent être vraies, sinon accepted=false):
- Le fournisseur (en-tête, émetteur) contient "Driscoll" dans son nom.
- Le client (destinataire) contient "Berry Good" ou "BGF" dans son nom.

STRUCTURE DES FACTURES DRISCOLL'S — TRÈS IMPORTANT:
Une facture peut contenir PLUSIEURS lignes. Chaque ligne a son propre numéro de commande (SO...) et son propre packing slip (PS-...). Exemple:

  SO17109654
  Packing slip PS-000103860:
  4 000 Corrina PL 1L  ...  MAD 159,200.00

  SO17109752
  Packing slip PS-000103967:
  4 250 Corrina PL 1L  ...  MAD 169,150.00

  Total before VAT MAD 328,350.00

Dans cet exemple il y a 2 items DIFFÉRENTS (même variété mais commandes différentes). Tu DOIS retourner les 2.

EXTRACTION — retourne UNIQUEMENT ce JSON (pas de markdown, pas de texte avant/après):
{
  "accepted": true,
  "rejection_reason": null,
  "ref": "INV17074653",
  "date": "2024-12-19",
  "echeance": "2025-03-19",
  "livraison": "2024-12-18",
  "items": [
    { "variete": "Corrina PL 1L", "qte": 4000, "montant": 159200.00, "commande": "SO17109654", "packing": "PS-000103860" },
    { "variete": "Corrina PL 1L", "qte": 4250, "montant": 169150.00, "commande": "SO17109752", "packing": "PS-000103967" }
  ],
  "total_montant": 328350.00,
  "confidence": 0.95
}

Règles strictes:
- "ref" = numéro de facture (champ "Facture N°", commence par "INV").
- Chaque item DOIT avoir son propre "commande" (SO...) et "packing" (PS-...). N'omets jamais ces champs s'ils sont visibles.
- "qte" = quantité numérique pure (4000, pas "4 000" ni "4,000").
- "montant" = montant ligne en MAD numérique (159200.00, pas "MAD 159,200.00").
- "total_montant" = "Total before VAT" ou "Total TTC" en bas de facture.
- Dates au format ISO YYYY-MM-DD.
- Si un champ est illisible, mets null.
- Vérifie que la somme des items.montant ≈ total_montant. Sinon tu as oublié des lignes — relis la facture.`;

        const Anthropic = require("@anthropic-ai/sdk");
        const aiClient = new Anthropic({ apiKey });
        const messageContent = [];
        if (pdfText && pdfText.length > 50) {
          messageContent.push({ type: "text", text: "CONTENU TEXTE DU PDF:\n" + pdfText });
        } else if (isPdf) {
          messageContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: cleanBase64 }});
        } else {
          const mediaType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
          messageContent.push({ type: "image", source: { type: "base64", media_type: mediaType, data: cleanBase64 }});
        }
        messageContent.push({ type: "text", text: PROMPT });

        let resp;
        for (const model of ["claude-sonnet-4-5", "claude-opus-4-5"]) {
          try {
            resp = await aiClient.messages.create({ model, max_tokens: 2000, messages: [{ role: "user", content: messageContent }] });
            break;
          } catch (e) {
            console.error("scan-plant-invoice model error", model, e.message);
            if (model === "claude-opus-4-5") throw e;
          }
        }
        const aiText = resp.content.filter(b => b.type === "text").map(b => b.text).join("\n");
        let analysis = null;
        try {
          const m = aiText.match(/\{[\s\S]*\}/);
          analysis = JSON.parse(m ? m[0] : aiText);
        } catch (e) {
          return res.json({ success: false, error: "Analyse IA non structurée", raw: aiText, pdfUrl });
        }
        if (!analysis || analysis.accepted === false) {
          return res.json({ success: false, analysis, error: analysis?.rejection_reason || "Facture rejetée", pdfUrl });
        }

        // 4) Classify culture from variety name (myrtille vs framboise)
        const isMyrtille = (v) => /corina|corrina|cascade|breeze|eterna|regina|rosita|biloxi|emerald|jewel|liberty|myrtille|blueberr|blue/i.test(v || "");

        // 5) Persist one doc per item — uniqueness key includes line INDEX because a
        // single invoice can have multiple rows with the same (variety, commande) but
        // different quantities (e.g. INV17095087 has 9028 Maravilla + 12960 Maravilla).
        // We wipe stale docs first to keep re-uploads idempotent.
        const now = new Date().toISOString();
        const created = [];
        const stale = await db.collection("plant_invoices").where("ref", "==", analysis.ref).get();
        for (const d of stale.docs) await d.ref.delete();

        const items = analysis.items || [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          if (!it || !it.variete) continue;
          const slug = String(it.variete).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const cmd = it.commande || analysis.commande || `idx${i}`;
          const cmdSlug = String(cmd).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
          const docId = `${analysis.ref}__${cmdSlug}__${slug}__${i}`;
          const doc = {
            ref: analysis.ref || null,
            date: analysis.date || null,
            echeance: analysis.echeance || null,
            livraison: analysis.livraison || null,
            commande: it.commande || analysis.commande || null,
            packing: it.packing || analysis.packing || null,
            variete: it.variete,
            qte: typeof it.qte === "number" ? it.qte : (parseFloat(it.qte) || 0),
            montant: typeof it.montant === "number" ? it.montant : (parseFloat(it.montant) || 0),
            culture: isMyrtille(it.variete) ? "myrtille" : "framboise",
            pdfUrl,
            storagePath,
            confidence: analysis.confidence || null,
            invoiceTotal: analysis.total_montant || null,
            uploadedAt: now,
            updatedAt: now,
          };
          await db.collection("plant_invoices").doc(docId).set(doc, { merge: true });
          created.push(docId);
        }

        return res.json({ success: true, analysis, created, pdfUrl });
      }


      // --- STORE-EMAIL: Accept a pre-parsed email doc via POST (for local refetch scripts) ---
      // --- IMPORT-LIQUIDATION: Manually import a liquidation document ---
      if (action === "import-liquidation" && req.method === "POST") {
        const { week, period, date, fruit, fruitCode, liquidationNumber, rows, summary } = req.body;
        if (!week || !rows || !rows.length) {
          return res.status(400).json({ success: false, error: "week and rows required" });
        }
        const now = new Date().toISOString();
        const liqDocId = liquidationNumber || `LIQ-MANUAL-${fruitCode || "RASP"}-W${week}`;
        const liqDoc = {
          emailId: "manual-import",
          liquidationNumber: liquidationNumber || liqDocId,
          week: parseInt(week),
          period: period || null,
          fruit: fruit || "framboise",
          fruitCode: fruitCode || "RASP",
          subject: `LIQUIDATION Berry Good Farms SARL ${fruitCode || "RASP"} W ${week}`,
          date: date || now,
          rows,
          summary: summary || {},
          totalKg: rows.reduce((s, r) => s + (r.receiptQtyKg || 0), 0),
          base: (summary && summary.base) || 0,
          fruitAdvance: (summary && summary.fruitAdvance) || 0,
          dedRasp: (summary && summary.dedRasp) || 0,
          cropAdvance: (summary && summary.cropAdvance) || 0,
          dexAdjustment: (summary && summary.dexAdjustment) || 0,
          pkgDeduction: (summary && summary.pkgDeduction) || 0,
          netPayable: (summary && summary.netPayable) || 0,
          nbLots: rows.length,
          createdAt: now,
          updatedAt: now,
          source: "manual-import",
        };

        await db.collection("liquidations").doc(liqDocId).set(liqDoc, { merge: true });

        // Also update matching expeditions
        let updatedCount = 0;
        for (const row of rows) {
          if (!row.receiptId) continue;
          const updateData = {
            liquidationWeek: parseInt(week),
            liquidationGsNet: row.gsNet || 0,
            liquidationPriceKg: row.pricePerKg || 0,
            liquidationPfq: row.pfqScore || 0,
            status: "Liquidée",
            updatedAt: now,
          };
          const expDoc = await db.collection("expeditions").doc(row.receiptId).get();
          if (expDoc.exists) {
            await expDoc.ref.update(updateData);
            updatedCount++;
          } else {
            const expQuery = await db.collection("expeditions").where("receiptId", "==", row.receiptId).limit(1).get();
            if (!expQuery.empty) {
              await expQuery.docs[0].ref.update(updateData);
              updatedCount++;
            }
          }
        }

        return res.json({ success: true, docId: liqDocId, totalRows: rows.length, totalKg: liqDoc.totalKg, expeditionsUpdated: updatedCount });
      }


      if (action === "import-weekly-report" && req.method === "POST") {
        const report = req.body;
        if (!report || !report.week || !report.year || !report.berry) {
          return res.status(400).json({ success: false, error: "week, year, berry required" });
        }
        const berryCode = report.berry === "myrtille" ? "MYRT" : "FRAM";
        const docId = `WQR-${berryCode}-W${report.week}-${report.year}`;
        const now = new Date().toISOString();

        await db.collection("weekly_quality_reports").doc(docId).set({
          emailId: `manual-import-${docId}`,
          week: report.week,
          year: report.year,
          berry: report.berry,
          pwResults: report.pwResults || {},
          brixSummary: report.brixSummary || [],
          ourRanches: report.ourRanches || [],
          allRanchCount: report.allRanchCount || 0,
          totalVolume: report.totalVolume || 0,
          subject: report.subject || `Manual import — W${report.week}/${report.year} — ${report.berry}`,
          createdAt: now,
          updatedAt: now,
        });

        return res.json({ success: true, docId });
      }


      if (action === "store-email" && req.method === "POST") {
        const emailDoc = req.body;
        if (!emailDoc || !emailDoc.docId) {
          return res.status(400).json({ success: false, error: "docId required in body" });
        }
        const docId = emailDoc.docId;
        delete emailDoc.docId;

        // Set defaults
        emailDoc.status = "pending";
        emailDoc.receivedAt = emailDoc.receivedAt || new Date().toISOString();
        emailDoc.analysisError = null;
        emailDoc.extractedTablesRaw = [];

        // Delete first then create, so Firestore onCreate trigger fires
        const docRef = db.collection("emails").doc(docId);
        const existing = await docRef.get();
        if (existing.exists) {
          await docRef.delete();
          // Small delay to ensure delete propagates before create
          await new Promise((r) => setTimeout(r, 500));
        }
        await docRef.set(emailDoc);
        console.log(`store-email: Stored ${docId} (subject: ${(emailDoc.subject || "").slice(0, 60)})`);

        return res.json({ success: true, docId });
      }

  return NOT_HANDLED;
};
