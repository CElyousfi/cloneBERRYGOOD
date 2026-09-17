/* Actions 2/3 de emailAnalysis — corps repris VERBATIM.
   Le contexte du handler arrive par `ctx` ; la destructuration ci-dessous
   recree exactement les liaisons d'origine. */
'use strict';
const { NOT_HANDLED } = require("./emailService.dispatch");
const { XLSX, admin, createImapClient, db, isDriscolsQualityReport, isLiquidationEmail, isWeeklyQualityReport, mapBerryToFrench, parseDriscolsReport, simpleParser } = require("./emailService.part1");

module.exports = async function emailServiceActions2(ctx) {
  const { req, res, authUser, action } = ctx;


      // --- REFETCH-WEEKLY-QR: Re-fetch Weekly Quality Reports from IMAP ---
      if (action === "refetch-weekly-qr") {
        const client = createImapClient();
        let processed = 0;

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          const searchResults = await client.search({ subject: "Weekly Quality Report" });
          console.log(`refetch-weekly-qr: Found ${searchResults.length} emails`);

          if (searchResults.length === 0) {
            await client.logout();
            return res.json({ success: true, message: "No Weekly Quality Report emails found", processed: 0 });
          }

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";
              if (!isWeeklyQualityReport(null, subject)) continue;

              const pdfAtt = (parsed.attachments || []).find(a => /\.pdf$/i.test(a.filename || ""));
              if (!pdfAtt || !pdfAtt.content) continue;

              const docId = (parsed.messageId || `uid-${msg.uid}`)
                .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);

              const existingSnap = await db.collection("emails").doc(docId).get();
              if (existingSnap.exists) {
                await db.collection("emails").doc(docId).delete();
                await db.collection("email_extractions").doc(docId).delete().catch(() => {});
              }

              await db.collection("emails").doc(docId).set({
                messageId: parsed.messageId || `uid-${msg.uid}`,
                uid: msg.uid,
                from: parsed.from?.text || "",
                fromName: parsed.from?.value?.[0]?.name || "",
                to: parsed.to?.text || "",
                subject,
                date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                receivedAt: new Date().toISOString(),
                textBody: (parsed.text || "").slice(0, 50000),
                htmlBody: (parsed.html || "").slice(0, 100000),
                hasAttachments: true,
                attachments: (parsed.attachments || []).map(a => ({ filename: a.filename || "unknown", contentType: a.contentType || "", size: a.size || 0 })),
                pdfBase64: pdfAtt.content.toString("base64"),
                isWeeklyQualityReport: true,
                status: "pending",
                analysisError: null,
                extractedTablesRaw: [],
              });
              processed++;
              console.log(`refetch-weekly-qr: Stored "${subject}" with PDF`);
            } catch (parseErr) {
              console.error(`refetch-weekly-qr: Error parsing UID ${msg.uid}:`, parseErr.message);
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, message: `${processed} Weekly Quality Report(s) re-fetched`, processed });
      }


      // ==================================================================
      // PRODUCTIVITY REPORTS (Driscoll's "Grower productivity report")
      // ==================================================================

      // --- PRODUCTIVITY-LIST: list available weeks + per-week summary ---
      if (action === "productivity-list") {
        const limit = parseInt(req.query.limit || "52");
        const snap = await db.collection("productivity_reports")
          .orderBy("week", "desc").limit(limit).get();
        const items = snap.docs.map(d => {
          const data = d.data();
          return {
            id: d.id,
            campaign: data.campaign || null,
            week: data.week || null,
            receivedAt: data.receivedAt || null,
            sourceSubject: data.sourceSubject || null,
            treatmentsCount: Array.isArray(data.treatments) ? data.treatments.length : 0,
            summary: data.summary || null,
            parseWarnings: data.parseWarnings || [],
          };
        });
        return res.json({ success: true, items });
      }


      // --- PRODUCTIVITY-DETAIL: full week document ---
      if (action === "productivity-detail") {
        const id = req.query.id || req.body?.id;
        if (!id) return res.status(400).json({ success: false, error: "id requis" });
        const doc = await db.collection("productivity_reports").doc(id).get();
        if (!doc.exists) return res.status(404).json({ success: false, error: "Not found" });
        return res.json({ success: true, report: { id: doc.id, ...doc.data() } });
      }


      // --- REFETCH-PRODUCTIVITY: scan IMAP for Driscoll's productivity emails,
      //     parse PDF via Claude, enrich with F1/F5 ranks, store in Firestore.
      //     Idempotent on {campaign}_W{week}: overwrites if same key.
      if (action === "refetch-productivity") {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return res.status(400).json({ success: false, error: "ANTHROPIC_API_KEY manquante" });

        const productivity = require("../../../lib/productivity");
        const client = createImapClient();

        try {
          await client.connect();
          let bucket = null;
          try { bucket = admin.storage().bucket("berrygood-farms-photos"); } catch (_) { /* no bucket */ }

          const result = await productivity.refetchProductivityReports({
            imapClient: client,
            simpleParser,
            db,
            bucket,
            apiKey,
            mailbox: process.env.IMAP_MAILBOX || "INBOX",
            onlyNew: req.query.onlyNew === "1",
            maxEmails: parseInt(req.query.maxEmails || "200"),
          });
          return res.json({ success: true, ...result });
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }
      }


      // --- REFETCH-QUALITY: Re-fetch Quality Inspection Reports from BULK .eml emails ---
      if (action === "refetch-quality") {
        const client = createImapClient();
        let processed = 0;
        const details = [];

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          // Search BULK emails
          const searchResults = await client.search({ subject: "BULK" });
          console.log(`refetch-quality: Found ${searchResults.length} BULK emails`);

          if (searchResults.length === 0) {
            await client.logout();
            return res.json({ success: true, message: "No BULK emails found", processed: 0 });
          }

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";
              if (!/bulk/i.test(subject)) continue;

              console.log(`refetch-quality: Processing BULK UID ${msg.uid}: "${subject}" — ${(parsed.attachments || []).length} attachments`);

              const emlAtts = (parsed.attachments || []).filter(
                a => (a.filename || "").toLowerCase().endsWith(".eml") || (a.contentType || "").includes("message/rfc822")
              );

              for (const emlAtt of emlAtts) {
                try {
                  const inner = await simpleParser(emlAtt.content);
                  const innerFrom = (inner.from?.text || "").toLowerCase().trim();
                  const innerSubject = inner.subject || "";

                  // Check if this is a Driscoll's Quality Inspection Report
                  const isDriscols = isDriscolsQualityReport(innerSubject, inner.text || "", inner.html || "");
                  const isFromDriscolls = innerFrom.includes("qainspectresults@driscolls.com");

                  if (!isDriscols && !isFromDriscolls) continue;

                  const docId = (inner.messageId || `bulk-qa-${msg.uid}-${processed}`)
                    .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 200);

                  // Delete existing to allow re-processing
                  const existingSnap = await db.collection("emails").doc(docId).get();
                  if (existingSnap.exists) {
                    await db.collection("emails").doc(docId).delete();
                    console.log(`refetch-quality: Deleted existing doc ${docId} for re-processing`);
                  }

                  await db.collection("emails").doc(docId).set({
                    messageId: inner.messageId || docId,
                    uid: msg.uid,
                    from: inner.from?.text || innerFrom,
                    fromName: inner.from?.value?.[0]?.name || "",
                    to: inner.to?.text || "",
                    subject: innerSubject,
                    date: inner.date ? inner.date.toISOString() : new Date().toISOString(),
                    receivedAt: new Date().toISOString(),
                    textBody: (inner.text || "").slice(0, 50000),
                    htmlBody: (inner.html || "").slice(0, 100000),
                    hasAttachments: (inner.attachments || []).length > 0,
                    attachments: (inner.attachments || []).map(a => ({ filename: a.filename || "unknown", contentType: a.contentType || "", size: a.size || 0 })),
                    isDriscolsReport: true,
                    bulkParentUid: msg.uid,
                    status: "pending",
                    analysisError: null,
                    extractedTablesRaw: [],
                  });

                  processed++;
                  details.push({ docId, subject: innerSubject, from: innerFrom });
                  console.log(`refetch-quality: Stored QA report "${innerSubject}" from ${innerFrom}`);
                } catch (innerErr) {
                  console.error(`refetch-quality: Error parsing inner .eml:`, innerErr.message);
                }
              }
            } catch (parseErr) {
              console.error(`refetch-quality: Error parsing UID ${msg.uid}:`, parseErr.message);
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, message: `${processed} Quality Inspection Report(s) extracted from BULK emails`, processed, details: details.slice(0, 20) });
      }


      // --- REFETCH-LIQUIDATION: Re-fetch Liquidation emails from IMAP ---
      if (action === "refetch-liquidation") {
        const client = createImapClient();
        let processed = 0;

        try {
          await client.connect();
          await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

          const searchResults = await client.search({ or: [{ subject: "LIQUIDATION" }, { subject: "IQUIDATION" }] });
          if (searchResults.length === 0) {
            await client.logout();
            return res.json({ success: true, message: "No liquidation emails found", processed: 0 });
          }

          for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
            try {
              const parsed = await simpleParser(msg.source);
              const subject = parsed.subject || "";

              if (!isLiquidationEmail(null, subject)) continue;
              if (!parsed.attachments || parsed.attachments.length === 0) continue;

              // Find ALL XLS/XLSX attachments (direct)
              const xlsAttachments = parsed.attachments.filter(
                (a) => /\.(xlsx|xls)$/i.test(a.filename || "") && a.content
              );

              // Find .eml attachments (nested emails containing XLS)
              const emlAttachments = parsed.attachments.filter(
                (a) => (a.filename || "").toLowerCase().endsWith(".eml") ||
                       (a.contentType || "").includes("message/rfc822")
              );

              // If we have .eml attachments, extract XLS from each inner email
              if (emlAttachments.length > 0) {
                console.log(`refetch-liquidation: BULK email "${subject}" — ${emlAttachments.length} .eml attachments`);
                let innerCount = 0;
                for (const emlAtt of emlAttachments) {
                  try {
                    const innerParsed = await simpleParser(emlAtt.content);
                    const innerSubject = innerParsed.subject || "(sans sujet)";

                    if (!innerParsed.attachments || innerParsed.attachments.length === 0) {
                      console.log(`refetch-liquidation: Inner email "${innerSubject}" has no attachments, skipping`);
                      continue;
                    }

                    const innerXls = innerParsed.attachments.filter(
                      (a) => /\.(xlsx|xls)$/i.test(a.filename || "") && a.content
                    );

                    if (innerXls.length === 0) {
                      console.log(`refetch-liquidation: Inner email "${innerSubject}" has no XLS, skipping`);
                      continue;
                    }

                    // Find the LIQUIDATION summary PDF on this inner email (same filename pattern as XLS)
                    const innerLiqPdfAtt = innerParsed.attachments.find(
                      (a) => /\.pdf$/i.test(a.filename || "") && /LIQUIDATION/i.test(a.filename || "") && a.content
                    );
                    const innerLiqPdf = innerLiqPdfAtt ? innerLiqPdfAtt.content.toString("base64") : null;
                    // Find the Grower Settlement Statement PDF (commission breakdown)
                    const innerGssAtt = innerParsed.attachments.find(
                      (a) => /\.pdf$/i.test(a.filename || "") &&
                             !/LIQUIDATION/i.test(a.filename || "") &&
                             /Berry\s*Good|RASPBERRIES\s+WEEK|BLUEBERRIES\s+WEEK|Grower\s+Settlement/i.test(a.filename || "") &&
                             a.content
                    );
                    const innerGssPdf = innerGssAtt ? innerGssAtt.content.toString("base64") : null;

                    for (let xi = 0; xi < innerXls.length; xi++) {
                      const xls = innerXls[xi];
                      const innerDocId = (innerParsed.messageId || `bulk-liq-${msg.uid}-${innerCount}-${xi}`)
                        .replace(/[^a-zA-Z0-9_-]/g, "_")
                        .slice(0, 200);

                      // Delete existing doc + extraction to force re-processing
                      const existingDoc = db.collection("emails").doc(innerDocId);
                      const existingSnap = await existingDoc.get();
                      if (existingSnap.exists) {
                        await existingDoc.delete();
                        await db.collection("email_extractions").doc(innerDocId).delete().catch(() => {});
                      }

                      await db.collection("emails").doc(innerDocId).set({
                        messageId: innerParsed.messageId || `bulk-liq-${msg.uid}-${innerCount}-${xi}`,
                        uid: msg.uid,
                        from: innerParsed.from?.text || parsed.from?.text || "",
                        fromName: innerParsed.from?.value?.[0]?.name || "",
                        to: innerParsed.to?.text || "",
                        subject: innerSubject,
                        date: innerParsed.date ? innerParsed.date.toISOString() : new Date().toISOString(),
                        receivedAt: new Date().toISOString(),
                        textBody: (innerParsed.text || "").slice(0, 50000),
                        htmlBody: (innerParsed.html || "").slice(0, 100000),
                        hasAttachments: true,
                        attachments: [{ filename: xls.filename || "unknown", contentType: xls.contentType || "application/octet-stream", size: xls.size || 0 }],
                        xlsxBase64: xls.content.toString("base64"),
                        liqSummaryPdfBase64: innerLiqPdf,
                        gssPdfBase64: innerGssPdf,
                        isLiquidation: true,
                        bulkParentUid: msg.uid,
                        status: "pending",
                        analysisError: null,
                        extractedTablesRaw: [],
                      });

                      processed++;
                      console.log(`refetch-liquidation: Extracted from inner .eml "${innerSubject}" — XLS: ${xls.filename} (${xls.size} bytes)`);
                    }
                    innerCount++;
                  } catch (innerErr) {
                    console.error(`refetch-liquidation: Error parsing inner .eml:`, innerErr.message);
                  }
                }
                // Also store the wrapper email as analyzed
                const wrapperDocId = (parsed.messageId || `uid-${msg.uid}`)
                  .replace(/[^a-zA-Z0-9_-]/g, "_")
                  .slice(0, 200);
                await db.collection("emails").doc(wrapperDocId).set({
                  messageId: parsed.messageId || `uid-${msg.uid}`,
                  uid: msg.uid,
                  from: parsed.from?.text || "",
                  subject: subject,
                  date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                  receivedAt: new Date().toISOString(),
                  isBulkWrapper: true,
                  bulkExtractedCount: innerCount,
                  isLiquidation: true,
                  status: "analyzed",
                });
                continue; // Skip direct XLS processing for this email
              }

              // Direct XLS attachments (non-bulk)
              if (xlsAttachments.length === 0) continue;

              const baseDocId = (parsed.messageId || `uid-${msg.uid}`)
                .replace(/[^a-zA-Z0-9_-]/g, "_")
                .slice(0, 180);

              // Find the LIQUIDATION summary PDF for this email (contains financial totals)
              const liqPdfAtt = parsed.attachments.find(
                (a) => /\.pdf$/i.test(a.filename || "") && /LIQUIDATION/i.test(a.filename || "") && a.content
              );
              const directLiqPdf = liqPdfAtt ? liqPdfAtt.content.toString("base64") : null;
              // Find the Grower Settlement Statement PDF (commission breakdown)
              const directGssAtt = parsed.attachments.find(
                (a) => /\.pdf$/i.test(a.filename || "") &&
                       !/LIQUIDATION/i.test(a.filename || "") &&
                       /Berry\s*Good|RASPBERRIES\s+WEEK|BLUEBERRIES\s+WEEK|Grower\s+Settlement/i.test(a.filename || "") &&
                       a.content
              );
              const directGssPdf = directGssAtt ? directGssAtt.content.toString("base64") : null;

              for (let idx = 0; idx < xlsAttachments.length; idx++) {
                const xlsAttachment = xlsAttachments[idx];
                const xlsxBase64 = xlsAttachment.content.toString("base64");
                // Use suffix for multiple attachments from same email
                const docId = xlsAttachments.length === 1 ? baseDocId : `${baseDocId}_att${idx}`;

                const existingDoc = db.collection("emails").doc(docId);
                const existingSnap = await existingDoc.get();
                if (existingSnap.exists) {
                  await existingDoc.delete();
                  await db.collection("email_extractions").doc(docId).delete().catch(() => {});
                }

                await db.collection("emails").doc(docId).set({
                  messageId: parsed.messageId || `uid-${msg.uid}`,
                  uid: msg.uid,
                  from: parsed.from?.text || "",
                  fromName: parsed.from?.value?.[0]?.name || "",
                  to: parsed.to?.text || "",
                  subject: `${subject} [${xlsAttachment.filename || `att${idx}`}]`,
                  date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                  receivedAt: new Date().toISOString(),
                  textBody: (parsed.text || "").slice(0, 50000),
                  htmlBody: (parsed.html || "").slice(0, 100000),
                  hasAttachments: true,
                  attachments: [{ filename: xlsAttachment.filename || "unknown", contentType: xlsAttachment.contentType || "application/octet-stream", size: xlsAttachment.size || 0 }],
                  xlsxBase64: xlsxBase64,
                  liqSummaryPdfBase64: directLiqPdf,
                  gssPdfBase64: directGssPdf,
                  isLiquidation: true,
                  status: "pending",
                  analysisError: null,
                  extractedTablesRaw: [],
                });

                processed++;
                console.log(`refetch-liquidation: Stored liquidation "${subject}" attachment ${idx + 1}/${xlsAttachments.length}: ${xlsAttachment.filename} (${xlsAttachment.size} bytes)${directLiqPdf ? ' + LIQUIDATION.pdf' : ''}`);
              }
            } catch (parseErr) {
              console.error(`refetch-liquidation: Error parsing UID ${msg.uid}:`, parseErr.message);
            }
          }
        } finally {
          try { await client.logout(); } catch (_) { /* ignore */ }
        }

        return res.json({ success: true, message: `${processed} Liquidation email(s) re-fetched`, processed });
      }


      // --- REANALYZE-EMAIL: force re-analysis of an existing email doc ---
      // Delete + recreate the email doc with status=pending to re-trigger the analyzeEmail onCreate function
      if (action === "reanalyze-email" && req.method === "POST") {
        const { emailId } = req.body || {};
        if (!emailId) return res.status(400).json({ success: false, error: "emailId required" });
        const snap = await db.collection("emails").doc(emailId).get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "email not found" });
        const data = snap.data();

        // AGQ emails: if agqPdfAttachments were already stripped, re-fetch from IMAP
        if (data.isAgqAnalysis && (!Array.isArray(data.agqPdfAttachments) || data.agqPdfAttachments.length === 0) && data.uid) {
          try {
            const imapClient = createImapClient();
            await imapClient.connect();
            await imapClient.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");
            const msgs = [];
            for await (const m of imapClient.fetch({ uid: `${data.uid}` }, { uid: true, source: true })) {
              if (m.uid === data.uid) msgs.push(m);
            }
            if (msgs.length > 0) {
              const reParsed = await simpleParser(msgs[0].source);
              const rePdfs = (reParsed.attachments || [])
                .filter(a => /\.pdf$/i.test(a.filename || "") && a.content)
                .map(a => ({ filename: a.filename, size: a.size || 0, contentBase64: a.content.toString("base64") }));
              if (rePdfs.length > 0) {
                data.agqPdfAttachments = rePdfs;
                console.log(`reanalyze-email: re-fetched ${rePdfs.length} AGQ PDF(s) from IMAP UID ${data.uid}`);
              }
            }
            try { await imapClient.logout(); } catch (_) {}
          } catch (e) {
            console.warn(`reanalyze-email: IMAP re-fetch failed: ${e.message}`);
          }
        }

        // Clean up previous extraction result
        await db.collection("email_extractions").doc(emailId).delete().catch(() => {});
        // Delete then recreate with pending status to trigger onCreate
        await snap.ref.delete();
        await new Promise(r => setTimeout(r, 400));
        const cleaned = { ...data, status: "pending", analysisError: null };
        delete cleaned.extractedTablesRaw;
        await db.collection("emails").doc(emailId).set(cleaned);
        return res.json({ success: true, emailId, agqRefetched: data.isAgqAnalysis && Array.isArray(data.agqPdfAttachments) && data.agqPdfAttachments.length > 0 });
      }


      // --- REPROCESS-DQR: delete PFQ expeditions and recreate from stored DQR data ---
      // --- REPROCESS-PFQ: re-trigger analyzeEmail for Driscoll's PFQ emails ---
      // --- REPROCESS-PFQ: directly parse PFQ emails and recreate expeditions ---
      if (action === "reprocess-pfq" && req.method === "POST") {
        const { days = 10 } = req.body || {};
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffISO = cutoff.toISOString().split('T')[0];

        // Load ALL emails and filter PFQ in code (Firestore can't do string contains)
        const emailsSnap = await db.collection("emails").get();
        const pfqEmails = [];
        emailsSnap.forEach(doc => {
          const data = doc.data();
          if (data.isDailyQualityReport || data.isLiquidation) return;
          const emailDate = (data.date || '').slice(0, 10);
          if (emailDate < cutoffISO) return;
          const from = (data.from || '').toLowerCase();
          const subject = (data.subject || '').toLowerCase();
          const isPfq = from.includes('qainspectresults@driscolls.com') ||
            (data.isDriscolsReport === true) ||
            (/quality\s*inspection\s*report/i.test(data.subject || ''));
          if (isPfq && data.htmlBody) {
            pfqEmails.push({ id: doc.id, ...data });
          }
        });

        let created = 0;
        const results = [];
        for (const emailData of pfqEmails) {
          try {
            const report = parseDriscolsReport(emailData.htmlBody, emailData.textBody, emailData.subject);
            if (!report || !report.receiptNumber) continue;

            const receiptId = report.receiptNumber.replace(/‑/g, "-");
            const batchSlug = report.batchNumber
              ? String(report.batchNumber).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
              : null;
            const expDocId = batchSlug ? `${receiptId}__${batchSlug}` : receiptId;

            const allDefects = [...(report.conditionDefects || []), ...(report.appearanceDefects || [])];
            const conditionRow = allDefects.find(d => d.name && d.name.toLowerCase() === "condition");
            const appearanceRow = allDefects.find(d => d.name && d.name.toLowerCase() === "appearance");
            const pfqCondition = conditionRow ? (conditionRow.points || 0) : 0;
            const pfqApparence = appearanceRow ? (appearanceRow.points || 0) : 0;

            const expedition = {
              emailId: emailData.id,
              receiptId,
              batchNumber: report.batchNumber || null,
              license: report.license || null,
              date: report.receivedDate || emailData.date,
              berryType: report.berryType || null,
              berryTypeFr: mapBerryToFrench(report.berryType),
              variety: report.variety || null,
              itemDescription: report.itemDescription || null,
              ranch: report.ranch || null,
              ranchName: report.ranchName || null,
              batchWeight: report.batchWeight || null,
              batchQuantity: report.batchQuantity || null,
              totalFruitInspected: report.totalFruitInspected || null,
              brix: report.brix || null,
              conditionDefects: report.conditionDefects || [],
              appearanceDefects: report.appearanceDefects || [],
              overallResult: report.overallResult || null,
              inspectionType: report.inspectionType || null,
              pfqCondition,
              pfqApparence,
              pfqTotal: pfqCondition + pfqApparence,
              pqScore: pfqCondition + pfqApparence,
              status: report.overallResult === "PASS" ? "PFQ Reçu. Attente Brix" : (report.overallResult === "REJECT" ? "Rejeté" : "PFQ Reçu. Attente Brix"),
              source: "email",
              updatedAt: new Date().toISOString(),
            };

            // Only set createdAt if new
            const existing = await db.collection("expeditions").doc(expDocId).get();
            if (!existing.exists) expedition.createdAt = new Date().toISOString();

            await db.collection("expeditions").doc(expDocId).set(expedition, { merge: true });
            created++;
            results.push({ docId: expDocId, receipt: receiptId, variety: report.variety, date: (report.receivedDate || emailData.date || '').slice(0, 10) });
          } catch (err) {
            console.error(`reprocess-pfq: Error for email ${emailData.id}:`, err.message);
          }
        }

        return res.json({
          success: true,
          message: `${created} expédition(s) PFQ créées à partir de ${pfqEmails.length} email(s)`,
          created,
          emailsFound: pfqEmails.length,
          expeditions: results
        });
      }

  return NOT_HANDLED;
};
