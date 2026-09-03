'use strict';
const { NOT_HANDLED } = require("./emailService.dispatch");
const __actions = [
  require("./emailService.actions1"),
  require("./emailService.actions2"),
  require("./emailService.actions3"),
];
/* Extrait de emailService.js — blocs repris VERBATIM.
   Seul ce preambule de require est ajoute. */
'use strict';
const { PDFParse, XLSX, admin, createImapClient, createTimacInvoiceFromParsed, db, functions, isAgqAnalysisEmail, isDailyQualityReport, isDriscolsQualityReport, isLiquidationEmail, isTimacInvoice, isWeeklyQualityReport, mapBerryToFrench, mapRanchToFermeCode, parseDriscolsReport, parseEmailHtmlTables, parseLiquidationSummaryPdf, parseLiquidationSummaryText, parseLiquidationXlsx, parseSettlementStatementPdf, parseTimacInvoicePdf, parseTimacInvoiceText, parseWeeklyQualityReportPdf, requireAuth, simpleParser } = require("./emailService.part1");
const { notifyNewAgqAnalyses, parseDailyQualityReportXlsx, setCors } = require("./emailService.part2");


// =============================================
// Function 1: fetchEmails (Scheduled — every 1 minute, GCP minimum)
// =============================================
exports.fetchEmails = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .pubsub.schedule("every 1 minutes")
  .timeZone("Africa/Casablanca")
  .onRun(async (_context) => {
    const configRef = db.collection("email_config").doc("settings");

    let lastPollUid = 0;
    try {
      const configSnap = await configRef.get();
      if (configSnap.exists) {
        lastPollUid = configSnap.data().lastPollUid || 0;
      }
    } catch (e) {
      console.warn("Could not read email config:", e.message);
    }

    const client = createImapClient();
    let fetchedCount = 0;
    let maxUid = lastPollUid;

    try {
      await client.connect();
      const mailbox = process.env.IMAP_MAILBOX || "INBOX";
      await client.mailboxOpen(mailbox);

      // Search for unseen messages (or all messages with UID > lastPollUid)
      let searchCriteria;
      if (lastPollUid > 0) {
        searchCriteria = { uid: `${lastPollUid + 1}:*` };
      } else {
        // First run: only fetch unseen to avoid flooding
        searchCriteria = { unseen: true };
      }

      const messages = [];
      for await (const msg of client.fetch(searchCriteria, {
        uid: true,
        envelope: true,
        source: true,
      })) {
        // Skip the lastPollUid itself (IMAP range is inclusive)
        if (msg.uid <= lastPollUid) continue;
        messages.push(msg);
        if (messages.length >= 50) break; // Safety limit per poll
      }

      for (const msg of messages) {
        try {
          const parsed = await simpleParser(msg.source);

          // Check if this is a Daily Quality Report — if so, store PDF content
          const emailFrom = (parsed.from?.text || "").toLowerCase().trim();
          const emailSubject = parsed.subject || "(sans sujet)";
          const isDQR = isDailyQualityReport(emailFrom, emailSubject);
          const isLiquidation = isLiquidationEmail(emailFrom, emailSubject);
          const isWeeklyQR = isWeeklyQualityReport(emailFrom, emailSubject);
          // AGQ labs: also check the body for the forwarded original sender.
          const bodyForAgq = `${parsed.text || ""} ${parsed.html || ""}`;
          const isAgq = isAgqAnalysisEmail(emailFrom, emailSubject) ||
            /envioresultatsmaroc@agqlabs/i.test(bodyForAgq);
          const isPfqDirect = isDriscolsQualityReport(emailSubject, parsed.text || "", parsed.html || "");
          const isTimac = isTimacInvoice(emailFrom, emailSubject);

          // Store XLSX attachments for Daily Quality Reports and Liquidations
          const attachmentsMeta = (parsed.attachments || []).map((a) => ({
            filename: a.filename || "unknown",
            contentType: a.contentType || "application/octet-stream",
            size: a.size || 0,
          }));

          let xlsxBase64 = null;
          let pdfBase64 = null;
          // AGQ emails carry N PDFs (1 per analysis). Keep them all in-line so
          // analyzeEmail can fan out without re-fetching from IMAP.
          let agqPdfAttachments = null;
          if (isAgq && parsed.attachments && parsed.attachments.length > 0) {
            agqPdfAttachments = parsed.attachments
              .filter(a => /\.pdf$/i.test(a.filename || "") && a.content)
              .map(a => ({
                filename: a.filename,
                size: a.size || 0,
                contentBase64: a.content.toString("base64"),
              }));
          }

          // Store PDF for Weekly Quality Reports
          if (isWeeklyQR && parsed.attachments && parsed.attachments.length > 0) {
            const pdfAtt = parsed.attachments.find(a => /\.pdf$/i.test(a.filename || ""));
            if (pdfAtt && pdfAtt.content) pdfBase64 = pdfAtt.content.toString("base64");
          }

          // Store the first PDF attachment for TIMAC supplier invoices
          let timacInvoicePdfBase64 = null;
          if (isTimac && parsed.attachments && parsed.attachments.length > 0) {
            const pdfAtt = parsed.attachments.find(a => /\.pdf$/i.test(a.filename || "") && a.content);
            if (pdfAtt && pdfAtt.content) timacInvoicePdfBase64 = pdfAtt.content.toString("base64");
          }

          // For liquidation emails, also grab the "LIQUIDATION*.pdf" summary attachment (contains financial totals)
          let liqSummaryPdfBase64 = null;
          if (isLiquidation && parsed.attachments && parsed.attachments.length > 0) {
            const summaryPdf = parsed.attachments.find(
              (a) => /\.pdf$/i.test(a.filename || "") &&
                     /LIQUIDATION/i.test(a.filename || "") &&
                     a.content
            );
            if (summaryPdf) {
              liqSummaryPdfBase64 = summaryPdf.content.toString("base64");
              console.log(`fetchEmails: Found liquidation summary PDF: ${summaryPdf.filename} (${summaryPdf.size} bytes)`);
            }
          }

          // For liquidation emails, also grab the Grower Settlement Statement PDF (commission breakdown)
          let gssPdfBase64 = null;
          if (isLiquidation && parsed.attachments && parsed.attachments.length > 0) {
            const gssPdf = parsed.attachments.find(
              (a) => /\.pdf$/i.test(a.filename || "") &&
                     !/LIQUIDATION/i.test(a.filename || "") &&
                     /Berry\s*Good|RASPBERRIES\s+WEEK|BLUEBERRIES\s+WEEK|Grower\s+Settlement/i.test(a.filename || "") &&
                     a.content
            );
            if (gssPdf) {
              gssPdfBase64 = gssPdf.content.toString("base64");
              console.log(`fetchEmails: Found GSS PDF: ${gssPdf.filename} (${gssPdf.size} bytes)`);
            }
          }

          if ((isDQR || isLiquidation) && parsed.attachments && parsed.attachments.length > 0) {
            const allXls = parsed.attachments.filter(
              (a) => /\.(xlsx|xls)$/i.test(a.filename || "") && a.content
            );

            // For liquidation emails with multiple XLS attachments, create one doc per attachment
            if (isLiquidation && allXls.length > 1) {
              const baseId = (parsed.messageId || `uid-${msg.uid}`)
                .replace(/[^a-zA-Z0-9_-]/g, "_")
                .slice(0, 180);
              for (let xi = 0; xi < allXls.length; xi++) {
                const att = allXls[xi];
                const attDocId = `${baseId}_att${xi}`;
                const existing = await db.collection("emails").doc(attDocId).get();
                if (!existing.exists) {
                  await db.collection("emails").doc(attDocId).set({
                    messageId: parsed.messageId || `uid-${msg.uid}`,
                    uid: msg.uid,
                    from: parsed.from?.text || "",
                    fromName: parsed.from?.value?.[0]?.name || "",
                    to: parsed.to?.text || "",
                    subject: `${emailSubject} [${att.filename}]`,
                    date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
                    receivedAt: new Date().toISOString(),
                    textBody: (parsed.text || "").slice(0, 50000),
                    htmlBody: (parsed.html || "").slice(0, 100000),
                    hasAttachments: true,
                    attachments: [{ filename: att.filename || "unknown", contentType: att.contentType || "application/octet-stream", size: att.size || 0 }],
                    xlsxBase64: att.content.toString("base64"),
                    liqSummaryPdfBase64: liqSummaryPdfBase64,
                    gssPdfBase64: gssPdfBase64,
                    isDailyQualityReport: false,
                    isLiquidation: true,
                    status: "pending",
                    analysisError: null,
                    extractedTablesRaw: [],
                  });
                  console.log(`fetchEmails: Stored liquidation attachment ${xi + 1}/${allXls.length}: ${att.filename} (${att.size} bytes)`);
                }
              }
              // Skip storing the main email doc with single xlsxBase64
              xlsxBase64 = null;
            } else if (allXls.length > 0) {
              xlsxBase64 = allXls[0].content.toString("base64");
              console.log(`fetchEmails: Stored XLS(X) attachment (${allXls[0].filename}, ${allXls[0].size} bytes) for ${isDQR ? 'DQR' : 'Liquidation'}`);
            }
          }

          const emailDoc = {
            messageId: parsed.messageId || `uid-${msg.uid}`,
            uid: msg.uid,
            from: parsed.from?.text || "",
            fromName: parsed.from?.value?.[0]?.name || "",
            to: parsed.to?.text || "",
            subject: emailSubject,
            date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            textBody: (parsed.text || "").slice(0, 50000),
            htmlBody: (parsed.html || "").slice(0, 100000),
            hasAttachments: (parsed.attachments || []).length > 0,
            attachments: attachmentsMeta,
            xlsxBase64: xlsxBase64,
            pdfBase64: pdfBase64,
            liqSummaryPdfBase64: liqSummaryPdfBase64,
            gssPdfBase64: gssPdfBase64,
            isDailyQualityReport: isDQR,
            isLiquidation: isLiquidation,
            isWeeklyQualityReport: isWeeklyQR,
            isAgqAnalysis: isAgq,
            isDriscolsReport: isPfqDirect,
            isTimacInvoice: isTimac,
            timacInvoicePdfBase64: timacInvoicePdfBase64,
            agqPdfAttachments: agqPdfAttachments,
            status: "pending",
            analysisError: null,
            extractedTablesRaw: [],
          };

          // Use sanitized messageId as doc ID
          const docId = (emailDoc.messageId || `uid-${msg.uid}`)
            .replace(/[^a-zA-Z0-9_-]/g, "_")
            .slice(0, 200);

          // --- BULK EMAILS: extract .eml attachments (quality reports OR liquidations) ---
          const hasEmlAttachments = parsed.attachments && parsed.attachments.some(
            (a) => (a.filename || "").toLowerCase().endsWith(".eml") ||
                   (a.contentType || "").includes("message/rfc822")
          );
          const isBulk = hasEmlAttachments && (
            /bulk.*(quality|qualit|rapport)/i.test(emailSubject) ||
            isLiquidation ||
            isDQR ||
            isAgq ||
            /ANALYSES?\s*FOLIAIRES?/i.test(emailSubject)
          );
          if (isBulk && parsed.attachments && parsed.attachments.length > 0) {
            const emlAttachments = parsed.attachments.filter(
              (a) => (a.filename || "").toLowerCase().endsWith(".eml") ||
                     (a.contentType || "").includes("message/rfc822")
            );
            console.log(`fetchEmails: BULK email detected — ${emlAttachments.length} .eml attachments, ${parsed.attachments.length} total attachments`);

            let bulkCount = 0;
            for (const emlAtt of emlAttachments) {
              try {
                const innerParsed = await simpleParser(emlAtt.content);
                const innerFrom = (innerParsed.from?.text || "").toLowerCase().trim();
                const innerSubject = innerParsed.subject || "(sans sujet)";
                const innerIsDQR = isDailyQualityReport(innerFrom, innerSubject);
                const innerIsLiquidation = isLiquidationEmail(innerFrom, innerSubject);

                const innerAttachmentsMeta = (innerParsed.attachments || []).map((a) => ({
                  filename: a.filename || "unknown",
                  contentType: a.contentType || "application/octet-stream",
                  size: a.size || 0,
                }));

                let innerXlsx = null;
                let innerLiqPdf = null;
                if ((innerIsDQR || innerIsLiquidation) && innerParsed.attachments) {
                  const xa = innerParsed.attachments.find((a) => /\.(xlsx|xls)$/i.test(a.filename || ""));
                  if (xa && xa.content) innerXlsx = xa.content.toString("base64");
                  if (innerIsLiquidation) {
                    const pa = innerParsed.attachments.find(
                      (a) => /\.pdf$/i.test(a.filename || "") && /LIQUIDATION/i.test(a.filename || "") && a.content
                    );
                    if (pa) innerLiqPdf = pa.content.toString("base64");
                  }
                }
                // GSS PDF for inner liquidation emails
                let innerGssPdf = null;
                if (innerIsLiquidation && innerParsed.attachments) {
                  const ga = innerParsed.attachments.find(
                    (a) => /\.pdf$/i.test(a.filename || "") &&
                           !/LIQUIDATION/i.test(a.filename || "") &&
                           /Berry\s*Good|RASPBERRIES\s+WEEK|BLUEBERRIES\s+WEEK|Grower\s+Settlement/i.test(a.filename || "") &&
                           a.content
                  );
                  if (ga) innerGssPdf = ga.content.toString("base64");
                }

                // AGQ detection for inner .eml emails
                const innerBodyForAgq = `${innerParsed.text || ""} ${innerParsed.html || ""}`;
                const innerIsAgq = isAgqAnalysisEmail(innerFrom, innerSubject) ||
                  /envioresultatsmaroc@agqlabs/i.test(innerBodyForAgq);
                let innerAgqPdfs = null;
                if (innerIsAgq && innerParsed.attachments && innerParsed.attachments.length > 0) {
                  innerAgqPdfs = innerParsed.attachments
                    .filter(a => /\.pdf$/i.test(a.filename || "") && a.content)
                    .map(a => ({ filename: a.filename, size: a.size || 0, contentBase64: a.content.toString("base64") }));
                }

                const innerDoc = {
                  messageId: innerParsed.messageId || `bulk-${msg.uid}-${bulkCount}`,
                  uid: msg.uid,
                  from: innerParsed.from?.text || emailFrom,
                  fromName: innerParsed.from?.value?.[0]?.name || "",
                  to: innerParsed.to?.text || "",
                  subject: innerSubject,
                  date: innerParsed.date ? innerParsed.date.toISOString() : emailDoc.date,
                  receivedAt: new Date().toISOString(),
                  textBody: (innerParsed.text || "").slice(0, 50000),
                  htmlBody: (innerParsed.html || "").slice(0, 100000),
                  hasAttachments: (innerParsed.attachments || []).length > 0,
                  attachments: innerAttachmentsMeta,
                  xlsxBase64: innerXlsx,
                  liqSummaryPdfBase64: innerLiqPdf,
                  gssPdfBase64: innerGssPdf,
                  isDailyQualityReport: innerIsDQR,
                  isLiquidation: innerIsLiquidation,
                  isDriscolsReport: isDriscolsQualityReport(innerSubject, innerParsed.text || "", innerParsed.html || ""),
                  isAgqAnalysis: innerIsAgq,
                  agqPdfAttachments: innerAgqPdfs,
                  bulkParentUid: msg.uid,
                  status: "pending",
                  analysisError: null,
                  extractedTablesRaw: [],
                };

                const innerDocId = (innerDoc.messageId || `bulk-${msg.uid}-${bulkCount}`)
                  .replace(/[^a-zA-Z0-9_-]/g, "_")
                  .slice(0, 200);

                // Check if already exists (avoid re-processing duplicates)
                const existing = await db.collection("emails").doc(innerDocId).get();
                if (!existing.exists) {
                  await db.collection("emails").doc(innerDocId).set(innerDoc);
                  bulkCount++;
                  console.log(`fetchEmails: Extracted inner email ${bulkCount}: "${innerSubject}"`);
                } else {
                  console.log(`fetchEmails: Skipping duplicate inner email: "${innerSubject}"`);
                }
              } catch (innerErr) {
                console.error(`Error parsing inner .eml attachment:`, innerErr.message);
              }
            }

            // Also check for forwarded emails as inline message/rfc822 parts that might not be in attachments
            // Store the bulk wrapper email itself (for tracking)
            emailDoc.isBulkWrapper = true;
            emailDoc.bulkExtractedCount = bulkCount;
            emailDoc.status = "analyzed"; // The wrapper itself doesn't need analysis
            await db.collection("emails").doc(docId).set(emailDoc);
            fetchedCount += bulkCount;
            console.log(`fetchEmails: BULK processing complete — ${bulkCount} inner emails extracted`);
          } else {
            await db.collection("emails").doc(docId).set(emailDoc);
            fetchedCount++;
          }

          if (msg.uid > maxUid) maxUid = msg.uid;

          // Mark as seen on the IMAP server
          await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
        } catch (parseErr) {
          console.error(`Error parsing email UID ${msg.uid}:`, parseErr.message);
        }
      }

      // Update config
      await configRef.set(
        {
          lastPollTimestamp: new Date().toISOString(),
          lastPollUid: maxUid,
          totalEmailsFetched: admin.firestore.FieldValue.increment(fetchedCount),
          lastError: null,
          lastErrorTimestamp: null,
        },
        { merge: true }
      );

      console.log(`fetchEmails: ${fetchedCount} emails fetched, maxUid=${maxUid}`);
    } catch (err) {
      console.error("fetchEmails error:", err.message);
      await configRef.set(
        {
          lastError: err.message,
          lastErrorTimestamp: new Date().toISOString(),
        },
        { merge: true }
      );
    } finally {
      try {
        await client.logout();
      } catch (_) {
        // ignore logout errors
      }
    }

    // --- Retry emails stuck in "error" or "analyzing" status ---
    try {
      const erroredSnap = await db.collection("emails")
        .where("status", "==", "error")
        .limit(5)
        .get();
      for (const doc of erroredSnap.docs) {
        const data = doc.data();
        if ((data.retryCount || 0) >= 3) continue;
        const age = Date.now() - new Date(data.receivedAt).getTime();
        if (age > 3600000) continue; // Only retry recent (< 1h)
        await doc.ref.delete();
        await db.collection("emails").doc(doc.id).set({
          ...data,
          status: "pending",
          analysisError: null,
          retryCount: (data.retryCount || 0) + 1,
        });
        console.log(`fetchEmails: Retrying errored email ${doc.id} (attempt ${(data.retryCount || 0) + 1})`);
      }

      const stuckSnap = await db.collection("emails")
        .where("status", "==", "analyzing")
        .limit(5)
        .get();
      for (const doc of stuckSnap.docs) {
        const data = doc.data();
        if ((data.retryCount || 0) >= 3) continue;
        const age = Date.now() - new Date(data.receivedAt).getTime();
        if (age < 300000) continue; // Wait 5 min before retrying
        await doc.ref.delete();
        await db.collection("emails").doc(doc.id).set({
          ...data,
          status: "pending",
          analysisError: null,
          retryCount: (data.retryCount || 0) + 1,
        });
        console.log(`fetchEmails: Retrying stuck email ${doc.id} (was analyzing for ${Math.round(age / 60000)}min)`);
      }
    } catch (retryErr) {
      console.error("fetchEmails retry error:", retryErr.message);
    }

    return null;
  });


// =============================================
// Function 2: analyzeEmail (Firestore trigger — onCreate)
// =============================================
exports.analyzeEmail = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 120, memory: "512MB" })
  .firestore.document("emails/{emailId}")
  .onCreate(async (snap, context) => {
    const emailId = context.params.emailId;
    const emailData = snap.data();

    if (emailData.status !== "pending") return null;

    const emailRef = db.collection("emails").doc(emailId);
    await emailRef.update({ status: "analyzing" });

    try {
      // 1. Extract HTML tables with cheerio
      const tables = parseEmailHtmlTables(emailData.htmlBody);

      // Save raw tables to the email doc (flatten rows to avoid Firestore nested array error)
      const tablesForFirestore = tables.map(t => ({
        headers: t.headers,
        rows: t.rows.map(row => row.join(" | ")),
      }));
      await emailRef.update({ extractedTablesRaw: tablesForFirestore });

      // 2. Check if this is a Driscoll's Quality Inspection Report from the official sender
      const emailFrom = (emailData.from || "").toLowerCase().trim();
      const isFromQaInspect = emailFrom === "qainspectresults@driscolls.com" || emailFrom.includes("qainspectresults@driscolls.com");
      // Also accept emails flagged as isDriscolsReport (from bulk extraction) BUT exclude DQR and liquidation emails
      const isDriscolsFlagged = emailData.isDriscolsReport === true && !emailData.isDailyQualityReport && !emailData.isLiquidation;
      const isDriscols = (isFromQaInspect || isDriscolsFlagged) &&
        isDriscolsQualityReport(emailData.subject, emailData.textBody, emailData.htmlBody);

      console.log(`analyzeEmail: ${emailId} — from="${emailFrom}" isFromQaInspect=${isFromQaInspect} isDriscolsFlagged=${isDriscolsFlagged} isDriscols=${isDriscols} subject="${(emailData.subject || '').slice(0, 80)}"`);

      let category = "other";
      let summary = "";
      const structuredData = {};
      let expeditionId = null;

      if (isDriscols) {
        // ---- Driscoll's Quality Inspection Report ----
        category = "quality_inspection";
        const report = parseDriscolsReport(emailData.htmlBody, emailData.textBody, emailData.subject);

        // Skip if parsing failed — avoid creating ghost expeditions with empty fields
        if (!report || !report.receiptNumber) {
          console.log(`analyzeEmail: Skipping email ${emailId} — PFQ parsing returned no receiptNumber`);
          summary = "Email détecté comme PFQ mais parsing échoué (pas de receiptNumber)";
          await emailRef.update({ category: "quality_inspection_failed", analysis: { summary }, analyzedAt: new Date().toISOString() });
          return res.json({ success: true, emailId, category: "quality_inspection_failed", summary });
        }

        // Build expedition document
        const now = new Date().toISOString();
        const receiptId = report.receiptNumber.replace(/‑/g, "-");
        // A single Driscoll's receipt can contain multiple batches (different varieties),
        // each inspected separately → include batchNumber in docId to avoid overwriting.
        const batchSlug = report.batchNumber
          ? String(report.batchNumber).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
          : null;
        const expDocId = receiptId
          ? (batchSlug ? `${receiptId}__${batchSlug}` : receiptId)
          : `EXP-${emailId}`;

        const expedition = {
          emailId,
          receiptId: receiptId || null,
          batchNumber: report.batchNumber || null,
          license: report.license || null,
          date: report.receivedDate || emailData.date,
          inspectedDate: report.inspectedDate || null,
          berryType: report.berryType || null,
          berryTypeFr: mapBerryToFrench(report.berryType),
          variety: report.variety || null,
          item: report.item || null,
          itemDescription: report.itemDescription || null,
          ranch: report.ranch || null,
          ranchName: report.ranchName || null,
          batchWeight: report.batchWeight || null,
          batchQuantity: report.batchQuantity || null,
          sampleSize: report.sampleSize || null,
          avgFruitsPerPunnet: report.avgFruitsPerPunnet || null,
          avgPunnetWeight: report.avgPunnetWeight || null,
          totalFruitInspected: report.totalFruitInspected || null,
          brix: report.brix || null,
          conditionDefects: report.conditionDefects || [],
          appearanceDefects: report.appearanceDefects || [],
          overallResult: report.overallResult || null,
          inspectionType: report.inspectionType || null,
          status: report.overallResult === "PASS" ? "PFQ Reçu. Attente Brix" : (report.overallResult === "REJECT" ? "Rejeté" : (report.overallResult === "FAIL" ? "PFQ rejeté" : "PFQ Reçu. Attente Brix")),
          updatedAt: now,
          source: "email",
        };

        // Calculate PFQ scores from the summary rows in defects
        const allDefects = [...(report.conditionDefects || []), ...(report.appearanceDefects || [])];
        const conditionRow = allDefects.find(d => d.name && d.name.toLowerCase() === "condition");
        const appearanceRow = allDefects.find(d => d.name && d.name.toLowerCase() === "appearance");
        expedition.pfqCondition = conditionRow ? (conditionRow.points || 0) : 0;
        expedition.pfqApparence = appearanceRow ? (appearanceRow.points || 0) : 0;
        expedition.pfqTotal = expedition.pfqCondition + expedition.pfqApparence;

        expedition.totalDefectPoints = allDefects.reduce((sum, d) => sum + (d.points || 0), 0);
        expedition.totalDefectPercent = allDefects.reduce((sum, d) => sum + (d.percent || 0), 0);
        expedition.pqScore = expedition.pfqTotal;

        // Only set createdAt if expedition doesn't already exist (avoid overwriting on duplicates)
        const existingExp = await db.collection("expeditions").doc(expDocId).get();
        if (!existingExp.exists) {
          expedition.createdAt = now;
        } else {
          // Protect higher-priority statuses from being overwritten
          const existingStatus = (existingExp.data().status || "").toLowerCase();
          const protectedStatuses = ["liquidée", "pfq brix reçu", "pfq brix recu", "annulée (doublon)"];
          if (protectedStatuses.some(ps => existingStatus.includes(ps.replace("é", "e")) || existingStatus === ps)) {
            delete expedition.status; // Don't regress the status
          }
          // Also protect existing Rejeté status
          if (existingStatus.includes("rejet")) {
            delete expedition.status;
          }
        }

        await db.collection("expeditions").doc(expDocId).set(expedition, { merge: true });
        expeditionId = expDocId;

        // WhatsApp: notify chef de ferme + qualité + DG en cas de rejet (REJECT/FAIL)
        if ((report.overallResult === "REJECT" || report.overallResult === "FAIL") && !existingExp.exists) {
          try {
            const { dispatchNotification } = require("./notificationDispatcher");
            // Build top defects summary as reason
            const defects = [...(report.conditionDefects || []), ...(report.appearanceDefects || [])]
              .filter(d => d.percent > 0 || d.points > 0)
              .sort((a, b) => (b.percent || 0) - (a.percent || 0))
              .slice(0, 2)
              .map(d => `${d.name} ${d.percent ? d.percent + "%" : ""}`.trim())
              .join(", ");
            const ferme = report.ranchName || report.ranch || "—";
            const dateTime = expedition.inspectedDate || expedition.date
              ? new Date(expedition.inspectedDate || expedition.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
              : "—";
            // Map Driscoll's ranch → internal F-code so chef-de-ferme users get matched
            // (their `ferme` field stores "F1"/"F5", not Driscoll's name/code).
            const fermeCode = mapRanchToFermeCode(report.ranch) || mapRanchToFermeCode(report.ranchName);
            if (!fermeCode) {
              // Unknown ranch: notify all chefs as fallback + log admin alert so mapping can be fixed.
              console.error(
                `[expedition_rejected] Unmapped Driscoll's ranch — notifying all chefs as fallback. ranch="${report.ranch}" ranchName="${report.ranchName}" receipt="${receiptId || expDocId}"`
              );
              try {
                await db.collection("admin_alerts").add({
                  type: "unmapped_ranch",
                  context: "expedition_rejected",
                  ranch: report.ranch || null,
                  ranchName: report.ranchName || null,
                  receiptId: receiptId || expDocId || null,
                  expeditionId: expDocId || null,
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              } catch (alertErr) {
                console.error("Failed to write admin_alerts entry for unmapped ranch:", alertErr);
              }
            }
            const rejectData = {
              receiptId: receiptId || expDocId || "—",
              dateTime,
              variety: report.variety || report.berryType || "—",
              ranch: ferme,
              weightKg: report.batchWeight ? String(Math.round(report.batchWeight)) : "0",
              reason: defects || (report.overallResult === "FAIL" ? "Qualité en dessous du seuil" : "Rejet"),
              message: `Expédition ${receiptId || expDocId} rejetée (${report.overallResult})`,
            };
            const relatedDoc = `expeditions/${expDocId}`;

            // Text-only template → chef de la ferme concernée + qualité.
            // Driscoll's = F1 (R-BERRY) ou F5 (SARL 3) uniquement.
            // Si ranch inconnu, fallback : prévenir les deux chefs.
            const chefProfiles = fermeCode === "F1" ? ["chef_f1"]
              : fermeCode === "F5" ? ["chef_f5"]
              : ["chef_f1", "chef_f5"];
            const textProfiles = [...chefProfiles, "qualite"];
            console.log(`[expedition_rejected] dispatch profils=${JSON.stringify(textProfiles)} ferme=${fermeCode || "?"} receipt=${receiptId || expDocId}`);
            dispatchNotification({
              type: "expedition_rejected",
              profiles: textProfiles,
              data: rejectData,
              relatedDoc,
            }).catch(err => console.error("WhatsApp expedition rejected (text) dispatch error:", err));

            // DG: try to send the PDF d'inspection en pièce jointe via the doc-variant
            // template. Fall back to the text template if no PDF / upload fails.
            (async () => {
              const whatsapp = require("./whatsappService");
              let mediaId = null;
              if (emailData.pdfBase64) {
                try {
                  const pdfBuffer = Buffer.from(emailData.pdfBase64, "base64");
                  const filename = `PFQ-${receiptId || expDocId}.pdf`;
                  const upload = await whatsapp.uploadMedia(pdfBuffer, "application/pdf", filename);
                  if (upload.id) {
                    mediaId = upload.id;
                  } else {
                    console.warn(`[expedition_rejected_doc] upload échoué (${upload.error}) — fallback texte pour DG`);
                  }
                } catch (e) {
                  console.error("[expedition_rejected_doc] erreur upload PDF:", e.message);
                }
              } else {
                console.log("[expedition_rejected_doc] pas de pdfBase64 sur l'email — fallback texte pour DG");
              }

              if (mediaId) {
                await dispatchNotification({
                  type: "expedition_rejected_doc",
                  profiles: ["dg"],
                  data: rejectData,
                  relatedDoc,
                  document: { mediaId, filename: `PFQ-${receiptId || expDocId}.pdf` },
                });
              } else {
                await dispatchNotification({
                  type: "expedition_rejected",
                  profiles: ["dg"],
                  data: rejectData,
                  relatedDoc,
                });
              }
            })().catch(err => console.error("WhatsApp expedition rejected (DG doc) dispatch error:", err));
          } catch (err) {
            console.error("Failed to dispatch expedition rejected notification:", err);
          }
        }

        summary = `Rapport Qualité Driscoll's — ${report.berryType || "?"} ${report.variety || "?"} — Receipt ${receiptId || "?"} — ${report.overallResult || "?"}`;
        structuredData.driscolsReport = report;
        structuredData.expeditionId = expeditionId;

        console.log(`analyzeEmail: Created/updated expedition ${expDocId} from email ${emailId}`);
      } else if (emailData.isDailyQualityReport && emailData.xlsxBase64) {
        // ---- Driscoll's Daily Quality Report (XLSX) ----
        // Workflow: DQR arrives on J+1 and REPLACES all PFQ inspections for J.
        // 1. Delete all PFQ (source='email') and provisional (source='auto-created') expeditions for J
        // 2. Recreate expeditions from DQR rows as source of truth
        category = "daily_quality_report";

        const xlsxBuffer = Buffer.from(emailData.xlsxBase64, "base64");
        const brixRows = parseDailyQualityReportXlsx(xlsxBuffer);

        // Determine the date the DQR covers
        // Prefer receiptDate from XLSX (actual expedition date), fallback to email date - 1
        const dqrEmailDate = emailData.date ? new Date(emailData.date) : new Date();
        const dqrVeille = new Date(dqrEmailDate);
        dqrVeille.setDate(dqrVeille.getDate() - 1);
        const dqrVeilleISO = dqrVeille.toISOString().split('T')[0];

        // Parse receiptDate from XLSX (can be Excel serial number or string)
        const parseReceiptDateXlsx = (rd) => {
          if (!rd) return null;
          if (typeof rd === 'number') {
            // Excel serial date → JS Date (Excel epoch = 1899-12-30)
            const d = new Date((rd - 25569) * 86400000);
            return d.toISOString().split('T')[0];
          }
          const s = rd.toString().trim();
          // Try ISO format YYYY-MM-DD
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
          // Try MM/DD/YYYY
          const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
          // Try Date parse
          const d = new Date(s);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
          return null;
        };

        // Ranch name → ranch code mapping
        const ranchNameToCode = (name) => {
          if (!name) return null;
          const n = name.toLowerCase();
          if (n.includes('r-berry') || n.includes('r berry') || n.includes('200742')) return '200742'; // F1
          if (n.includes('sarl 3') || n.includes('berry good farms sarl') || n.includes('berry good farms') || n.includes('200876')) return '200876'; // F5
          console.log(`analyzeEmail DQR: Unknown ranch name "${name}" — could not map to F1/F5`);
          return null;
        };

        // ---- Step 1: Delete old DQR expeditions (keep PFQ intact) ----
        // Delete for both J-1 and J (receiptDate may differ from email date - 1)
        let deletedCount = 0;
        const dqrEmailDateISO = dqrEmailDate.toISOString().split('T')[0];
        const datesToClean = [...new Set([dqrVeilleISO, dqrEmailDateISO])];
        for (const cleanDate of datesToClean) {
          const oldDqrSnap = await db.collection("expeditions")
            .where("source", "==", "dqr-auto-created")
            .where("dateISO", "==", cleanDate)
            .get();
          if (!oldDqrSnap.empty) {
            const delBatch = db.batch();
            oldDqrSnap.docs.forEach(doc => { delBatch.delete(doc.ref); deletedCount++; });
            await delBatch.commit();
          }
        }
        console.log(`analyzeEmail DQR: Deleted ${deletedCount} old DQR expeditions for ${dqrVeilleISO} (PFQ preserved)`);

        // ---- Step 2: Create fresh expeditions from DQR rows ----
        let createdCount = 0;
        const dqrCreated = [];
        const docIdCounter = {}; // Track duplicate docIds to avoid overwriting

        // Dédup Initial/Re-Inspection: si un batch a une Re-Inspection (verdict final
        // de Driscoll's), on ignore la ligne Initial pour éviter le doublonnage.
        const isReInspectionRow = (t) => /re[\s-]?inspection/i.test(t || '');
        const rowsByBatch = {};
        for (const row of brixRows) {
          if (!row.batchId) continue;
          const existing = rowsByBatch[row.batchId];
          if (!existing) {
            rowsByBatch[row.batchId] = row;
          } else if (isReInspectionRow(row.inspectionType) && !isReInspectionRow(existing.inspectionType)) {
            rowsByBatch[row.batchId] = row;
          }
        }
        const dedupedRows = Object.values(rowsByBatch);
        if (dedupedRows.length !== brixRows.length) {
          console.log(`analyzeEmail DQR: dedup ${brixRows.length} → ${dedupedRows.length} (removed Initial when Re-Inspection exists)`);
        }

        for (const row of dedupedRows) {
          // By-Pass inspections have null/Null result but valid inspectionType
          const isByPass = (row.inspectionType || '').toLowerCase().includes('by') && (row.inspectionType || '').toLowerCase().includes('pass');
          const effectiveResult = (row.inspectionResult && row.inspectionResult !== 'Null') ? row.inspectionResult : (isByPass ? 'PASS' : null);
          if (!effectiveResult) continue; // Skip sub-lots/samples without result

          const receiptId = row.receiptId || null;
          let baseDocId = receiptId
            ? `${receiptId}__${(row.batchId || '').replace(/[^a-zA-Z0-9-]/g, '-')}`
            : `DQR-${row.batchId}-${Date.now()}`;
          // If same batchId+receiptId appears multiple times (initial + re-inspection), add suffix
          docIdCounter[baseDocId] = (docIdCounter[baseDocId] || 0) + 1;
          const expDocId = docIdCounter[baseDocId] > 1 ? `${baseDocId}__${docIdCounter[baseDocId]}` : baseDocId;

          const ranch = ranchNameToCode(row.ranchName);

          const newExp = {
            receiptId: receiptId,
            batchNumber: row.batchId || null,
            berryType: row.berryType || null,
            berryTypeFr: mapBerryToFrench(row.berryType),
            variety: (row.variety || "").trim() || null,
            itemDescription: row.productName || null,
            batchWeight: row.weight || 0,
            batchQuantity: row.quantity || 0,
            totalFruitInspected: row.totalFruitInspected || 0,
            brix: row.brix || null,
            pfqBrix: row.brixPoints || 0,
            brixFromDQR: row.brix || 0,
            enrichedPqScore: row.enrichedPqScore || 0,
            initialPq: row.initialPq || 0,
            reInspectionPq: row.reInspectionPq || 0,
            pqScore: row.enrichedPqScore || row.brixPoints || 0,
            pfqTotal: row.brixPoints || 0,
            pfqCondition: 0,
            pfqApparence: 0,
            overallResult: effectiveResult,
            inspectionType: row.inspectionType || null,
            ranch: ranch,
            ranchName: row.ranchName || null,
            status: "DQR reçu",
            source: "dqr-auto-created",
            dateISO: parseReceiptDateXlsx(row.receiptDate) || dqrVeilleISO,
            date: parseReceiptDateXlsx(row.receiptDate) || dqrVeilleISO,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await db.collection("expeditions").doc(expDocId).set(newExp);
          dqrCreated.push({
            docId: expDocId,
            batchId: row.batchId,
            receiptId: receiptId,
            variety: row.variety,
            berryType: row.berryType,
            weight: row.weight,
          });
          createdCount++;
          console.log(`analyzeEmail DQR: Created expedition ${expDocId} from DQR (${row.variety}, ${row.weight}kg, ${row.inspectionResult})`);
        }

        summary = `Daily Quality Report ${dqrVeilleISO} — ${deletedCount} anciennes inspections supprimées, ${createdCount} expéditions créées depuis DQR`;
        structuredData.brixRows = brixRows;
        structuredData.deletedExpeditions = deletedCount;
        structuredData.createdExpeditions = createdCount;

        // Keep xlsxBase64 for DQR emails so reprocess-dqr can re-parse the XLSX
        // (previously deleted to save storage, but needed for accurate reprocessing)

        console.log(`analyzeEmail DQR: ${emailId} → ${dqrVeilleISO}: ${deletedCount} deleted, ${createdCount} created from ${brixRows.length} DQR rows`);

        // ---- VOLET 3: Vérification bons Export J-1 vs expéditions DQR ----
        try {
          // Fetch all bons d'apport Export for that date
          const bonsSnap = await db.collection("bons_apport")
            .where("date", "==", dqrVeilleISO)
            .get();

          const bonsExport = [];
          bonsSnap.forEach(doc => {
            const d = doc.data();
            if ((d.typeVente || '').toLowerCase() !== 'marché local' && (d.typeVente || '').toLowerCase() !== 'marche local') {
              bonsExport.push({ id: doc.id, ...d });
            }
          });

          if (bonsExport.length > 0) {
            // Get all expeditions for that date (now all from DQR)
            const expsSnap = await db.collection("expeditions")
              .where("dateISO", "==", dqrVeilleISO)
              .get();

            const existingExps = [];
            expsSnap.forEach(doc => existingExps.push({ id: doc.id, ...doc.data() }));

            const normV = (v) => (v || '').toLowerCase().trim().replace(/[^a-z0-9]/g, '');
            const matchedExpIds = new Set();
            const unmatchedBons = [];

            for (const bon of bonsExport) {
              const bonVar = normV(bon.blocVariete);
              const bonWeight = parseFloat(bon.poidsLot) || 0;
              let found = false;

              for (const exp of existingExps) {
                if (matchedExpIds.has(exp.id)) continue;
                const expVar = normV(exp.variety);
                const expWeight = parseFloat(exp.batchWeight) || 0;
                if (bonVar !== expVar) continue;
                if (bonWeight <= 0 || expWeight <= 0) continue;
                const ratio = Math.min(bonWeight, expWeight) / Math.max(bonWeight, expWeight);
                if (ratio >= 0.98) {
                  matchedExpIds.add(exp.id);
                  found = true;
                  break;
                }
              }

              if (!found) {
                unmatchedBons.push(bon);
              }
            }

            if (unmatchedBons.length > 0) {
              const bonsList = unmatchedBons.map(b => `${b.bonApport} (${b.blocVariete}, ${b.poidsLot}kg)`).join(', ');
              await db.collection("alerts").add({
                type: 'expedition_manquante',
                message: `${unmatchedBons.length} bon(s) Export du ${dqrVeilleISO} sans expédition DQR correspondante. Bons: ${bonsList}`,
                severity: 'warning',
                profiles: ['chef_f1', 'chef_f5', 'qualite'],
                read: {},
                createdAt: new Date().toISOString(),
                date: dqrVeilleISO,
                unmatchedBons: unmatchedBons.map(b => ({ id: b.id, bonApport: b.bonApport, variete: b.blocVariete, poids: b.poidsLot })),
              });
              console.log(`analyzeEmail DQR: ${unmatchedBons.length} unmatched bons for ${dqrVeilleISO}`);
            } else {
              console.log(`analyzeEmail DQR: All ${bonsExport.length} bons Export for ${dqrVeilleISO} matched to DQR expeditions`);
            }
          }
        } catch (verifErr) {
          console.error('analyzeEmail DQR verification error:', verifErr);
        }

      } else if (emailData.isLiquidation && emailData.xlsxBase64) {
        // ---- Driscoll's Liquidation Report (XLSX) ----
        category = "liquidation";

        const xlsxBuffer = Buffer.from(emailData.xlsxBase64, "base64");
        const liquidation = parseLiquidationXlsx(xlsxBuffer);
        const now = new Date().toISOString();

        // Build list of liquidation sheets to process
        const sheetsToProcess = liquidation._multiSheets || [liquidation];

        // Multi-signal fruit detection (subject + sheetName + variety codes in rows).
        // Per-liq because a single email may contain mixed sheets.
        // Myrtille variety codes: COR, CAS, BRE, ETE, REG, ROS (cf. varMap at line ~328).
        const MYRTILLE_CODES = new Set(["COR", "CAS", "BRE", "ETE", "REG", "ROS"]);
        const FRAMBOISE_CODES = new Set(["REY", "MAR", "YAZ", "ADE"]);
        const subjectUpper = (emailData.subject || "").toUpperCase();
        const subjectIsMyrtille = /BLUE|MYRTILLE|BLUEBERR/i.test(subjectUpper);
        const subjectIsFramboise = /RASP|FRAMBOISE|RASPBERRY/i.test(subjectUpper);
        const detectFruit = (liq) => {
          const sn = (liq.sheetName || "").toUpperCase();
          if (/BLUE|MYRTILLE|BLUEBERR/i.test(sn)) return { fruitType: "myrtille", fruitCode: "BLUE" };
          if (/RASP|FRAMBOISE|RASPBERRY/i.test(sn)) return { fruitType: "framboise", fruitCode: "RASP" };
          let nMyr = 0, nFra = 0;
          for (const r of (liq.rows || [])) {
            const c = r.varietyCode;
            if (!c) continue;
            if (MYRTILLE_CODES.has(c)) nMyr++;
            else if (FRAMBOISE_CODES.has(c)) nFra++;
          }
          if (nMyr > nFra) return { fruitType: "myrtille", fruitCode: "BLUE" };
          if (nFra > nMyr) return { fruitType: "framboise", fruitCode: "RASP" };
          if (subjectIsMyrtille) return { fruitType: "myrtille", fruitCode: "BLUE" };
          if (subjectIsFramboise) return { fruitType: "framboise", fruitCode: "RASP" };
          return { fruitType: "framboise", fruitCode: "RASP" };
        };

        // Parse the LIQUIDATION summary PDF (contains Fruit Advance / Crop Advance / Net Payable / etc.)
        // The mail body is just a French cover note, no financial data — all totals live in the PDF.
        let pdfSummary = null;
        if (emailData.liqSummaryPdfBase64) {
          try {
            const pdfBuffer = Buffer.from(emailData.liqSummaryPdfBase64, "base64");
            pdfSummary = await parseLiquidationSummaryPdf(pdfBuffer);
            if (pdfSummary) {
              console.log(`analyzeEmail Liquidation: parsed PDF summary — apiv=${pdfSummary.liquidationNumber} net=${pdfSummary.summary?.netPayable}`);
            }
          } catch (e) {
            console.warn(`analyzeEmail Liquidation: PDF parse failed — ${e.message}`);
          }
        }

        // Parse the Grower Settlement Statement PDF (commission breakdown in EUR/kilo)
        let gssData = null;
        if (emailData.gssPdfBase64) {
          try {
            const gssBuffer = Buffer.from(emailData.gssPdfBase64, "base64");
            gssData = await parseSettlementStatementPdf(gssBuffer);
            if (gssData) {
              console.log(`analyzeEmail Liquidation: GSS parsed — commission=${gssData.commissionPct}%`);
            }
          } catch (e) {
            console.warn(`analyzeEmail Liquidation: GSS parse failed — ${e.message}`);
          }
        }

        let totalUpdatedCount = 0;
        let totalRows = 0;
        const processedWeeks = [];

        for (const liq of sheetsToProcess) {
          // Try to extract week from subject/text if not from XLS
          if (!liq.week) {
            const subjectWeek = (emailData.subject || "").match(/week\s*(\d+)/i);
            if (subjectWeek) liq.week = parseInt(subjectWeek[1]);
          }
          if (!liq.week) {
            const textWeek = ((emailData.textBody || "") + " " + (emailData.htmlBody || "")).match(/semaine\s*(\d+)/i);
            if (textWeek) liq.week = parseInt(textWeek[1]);
          }
          // Merge PDF summary (the authoritative source for financial fields)
          if (pdfSummary) {
            if (!liq.liquidationNumber && pdfSummary.liquidationNumber) liq.liquidationNumber = pdfSummary.liquidationNumber;
            if (!liq.period && pdfSummary.period) liq.period = pdfSummary.period;
            Object.assign(liq.summary, pdfSummary.summary || {});
          }

          // Per-liq fruit detection (sheet name + variety codes + subject) — emails may mix sheets.
          const { fruitType, fruitCode } = detectFruit(liq);

          // Stable docId: LIQ-{RASP|BLUE}-W{NN}-{YYYY} — upserts cleanly on re-runs.
          // The APIV number lives in the doc body (liquidationNumber field).
          const subjYearMatch = (emailData.subject || "").match(/week\s*\d+[-\/](\d{4})/i);
          const liqYear = subjYearMatch
            ? parseInt(subjYearMatch[1])
            : (emailData.date ? new Date(emailData.date).getFullYear() : new Date().getFullYear());
          const liqDocId = `LIQ-${fruitCode}-W${String(liq.week || 0).padStart(2, "0")}-${liqYear}`;
          const liqDoc = {
            emailId,
            liquidationNumber: liq.liquidationNumber,
            week: liq.week,
            period: liq.period,
            fruit: fruitType,
            fruitCode: fruitCode,
            subject: emailData.subject,
            date: emailData.date,
            rows: liq.rows,
            summary: liq.summary,
            totalKg: liq.summary.totalKg || 0,
            base: liq.summary.base || 0,
            fruitAdvance: liq.summary.fruitAdvance || 0,
            dedRasp: liq.summary.dedRasp || 0,
            dedPlants: liq.summary.dedPlants || 0,
            cropAdvance: liq.summary.cropAdvance || 0,
            dexAdjustment: liq.summary.dexAdjustment || 0,
            pkgDeduction: liq.summary.pkgDeduction || 0,
            netPayable: liq.summary.netPayable || 0,
            nbLots: liq.rows.length,
            commissionPct: gssData?.commissionPct ?? null,
            netSalesEurKg: gssData?.netSalesEurKg ?? null,
            commissionEurKg: gssData?.commissionEurKg ?? null,
            rebateEurKg: gssData?.rebateEurKg ?? null,
            returnToGrowerEurKg: gssData?.returnToGrowerEurKg ?? null,
            createdAt: now,
            updatedAt: now,
          };

          await db.collection("liquidations").doc(liqDocId).set(liqDoc, { merge: true });

          // Update matching expeditions with liquidation data
          let updatedCount = 0;
          for (const row of liq.rows) {
            if (!row.receiptId) continue;

            const updateData = {
              status: "Liquidée",
              liquidationNumber: liq.liquidationNumber,
              liquidationWeek: liq.week,
              ppFruit: row.ppFruit,
              gsNet: row.gsNet,
              pricePerKg: row.receiptQtyKg > 0 ? Math.round((row.gsNet / row.receiptQtyKg) * 100) / 100 : null,
              updatedAt: now,
            };

            const expDoc = await db.collection("expeditions").doc(row.receiptId).get();
            if (expDoc.exists) {
              await expDoc.ref.update(updateData);
              updatedCount++;
            } else {
              const expQuery = await db.collection("expeditions")
                .where("receiptId", "==", row.receiptId)
                .limit(1).get();
              if (!expQuery.empty) {
                await expQuery.docs[0].ref.update(updateData);
                updatedCount++;
              }
            }
          }

          totalUpdatedCount += updatedCount;
          totalRows += liq.rows.length;
          processedWeeks.push(liq.week);
          console.log(`analyzeEmail Liquidation W${liq.week}: ${liq.rows.length} rows, ${updatedCount} expeditions updated`);
        }

        summary = `Liquidation ${processedWeeks.map(w => `W${w}`).join(", ")} — ${totalRows} lots total, ${totalUpdatedCount} expéditions mises à jour`;
        structuredData.liquidation = liquidation;
        structuredData.updatedExpeditions = totalUpdatedCount;
        structuredData.processedWeeks = processedWeeks;

        // Clean up XLSX + PDF blobs from email doc
        await emailRef.update({
          xlsxBase64: admin.firestore.FieldValue.delete(),
          liqSummaryPdfBase64: admin.firestore.FieldValue.delete(),
          gssPdfBase64: admin.firestore.FieldValue.delete(),
        });

        console.log(`analyzeEmail Liquidation: ${emailId} → ${sheetsToProcess.length} sheets, ${totalRows} rows, ${totalUpdatedCount} expeditions updated`);
      } else if (emailData.isWeeklyQualityReport && emailData.pdfBase64) {
        // ---- Weekly Quality Report (PDF) ----
        category = "weekly_quality_report";

        const pdfBuffer = Buffer.from(emailData.pdfBase64, "base64");
        const report = await parseWeeklyQualityReportPdf(pdfBuffer);

        const now = new Date().toISOString();
        const berry = report.berry || "framboise";
        const docId = `WQR-${berry.toUpperCase().slice(0, 4)}-W${report.week || "?"}-${report.year || "?"}`;

        await db.collection("weekly_quality_reports").doc(docId).set({
          emailId,
          week: report.week,
          year: report.year,
          berry: report.berry,
          pwResults: report.pwResults,
          brixSummary: report.brixSummary,
          ourRanches: report.ourRanches,
          allRanchCount: report.allRanchCount,
          totalVolume: report.totalVolume,
          subject: emailData.subject,
          createdAt: now,
          updatedAt: now,
        });

        summary = `Weekly Quality Report — W${report.week}/${report.year} — ${report.berry} — Ranches: ${report.ourRanches.map(r => `${r.farmName} (PQ: ${r.pqWeightedAvg || '?'}, Rank: ${r.rank}/${r.totalRanches})`).join(', ')}`;
        structuredData.weeklyQualityReport = report;

        // Clean up PDF from email doc
        await emailRef.update({ pdfBase64: admin.firestore.FieldValue.delete() });

        console.log(`analyzeEmail WeeklyQR: ${emailId} → W${report.week}/${report.year}, ${report.berry}, ${report.ourRanches.length} farms`);
      } else if (emailData.isAgqAnalysis && Array.isArray(emailData.agqPdfAttachments) && emailData.agqPdfAttachments.length > 0) {
        // ---- AGQ Labs analytical reports (foliar / soil / water) ----
        category = "agq_analysis";
        const { parseAgqPdf } = require("./agqParser");
        const bucket = admin.storage().bucket("berrygood-farms-photos");

        const createdAnalyses = [];
        const skipped = [];
        const errors = [];
        const receivedAt = emailData.date ? new Date(emailData.date).getTime() : Date.now();

        for (const att of emailData.agqPdfAttachments) {
          try {
            // Idempotence by (messageId, attachment_name)
            const dupSnap = await db.collection("analyses_foliaires")
              .where("source_email.messageId", "==", emailData.messageId || "")
              .where("source_email.attachment_name", "==", att.filename || "")
              .limit(1)
              .get();
            if (!dupSnap.empty) {
              skipped.push({ filename: att.filename, id: dupSnap.docs[0].id });
              continue;
            }

            const pdfBuffer = Buffer.from(att.contentBase64, "base64");
            const parsed = await parseAgqPdf(pdfBuffer, {
              subject: emailData.subject || "",
              attachmentName: att.filename || "",
            });

            if (!parsed.ferme) {
              errors.push({ filename: att.filename, error: "Ferme non détectée" });
              continue;
            }

            const now = Date.now();
            const analyseData = {
              numero: null, // AGQ imports are not numbered; the PDF is the source of truth.
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
                messageId: emailData.messageId || null,
                subject: emailData.subject || null,
                from: emailData.from || null,
                received_at: receivedAt,
                attachment_name: att.filename || null,
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
              history: [{ action: "import_email_agq", by: { name: "auto" }, at: now, comment: att.filename || "" }],
              created_by: { name: "auto" },
              created_at: now,
              updated_at: now,
            };
            const ref = await db.collection("analyses_foliaires").add(analyseData);

            // Upload the PDF to Storage and wire the URL back.
            const safeName = (att.filename || "agq_report.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
            const storagePath = `analyses_foliaires/${ref.id}/${safeName}`;
            const file = bucket.file(storagePath);
            await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
            const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
            await ref.update({ scan_resultat_url: url });

            createdAnalyses.push({ id: ref.id, ferme: parsed.ferme, variete: parsed.variete, type_analyse: parsed.type_analyse, filename: att.filename });
          } catch (e) {
            console.error(`analyzeEmail AGQ ${att.filename}:`, e.message);
            errors.push({ filename: att.filename, error: e.message });
          }
        }

        summary = `AGQ — ${createdAnalyses.length} analyse(s) importée(s), ${skipped.length} doublon(s), ${errors.length} erreur(s)`;
        structuredData.agq = { created: createdAnalyses, skipped, errors };

        // Strip the heavy base64 payloads once processed to keep the email doc slim.
        await emailRef.update({ agqPdfAttachments: admin.firestore.FieldValue.delete() });

        // Fire notifications (alerts + emails) for the chef of each concerned ferme + DT.
        if (createdAnalyses.length > 0) {
          try {
            await notifyNewAgqAnalyses(createdAnalyses);
          } catch (e) {
            console.error("notifyNewAgqAnalyses failed:", e.message);
          }
        }

        console.log(`analyzeEmail AGQ: ${emailId} → ${createdAnalyses.length} created, ${skipped.length} skipped, ${errors.length} errors`);
      } else if (emailData.isTimacInvoice && emailData.timacInvoicePdfBase64) {
        // ---- TIMAC supplier invoice (PDF) ----
        category = "invoice";

        const buf = Buffer.from(emailData.timacInvoicePdfBase64, "base64");
        const inv = await parseTimacInvoicePdf(buf);

        const safeName = (emailData.subject || "facture_timac")
          .replace(/[^a-zA-Z0-9._-]/g, "_")
          .slice(0, 60);

        const result = await createTimacInvoiceFromParsed(inv, {
          pdfBuffer: buf,
          filename: safeName,
          source: "email_timac",
          dryRun: false,
        });

        if (result.status === "a_revoir") {
          // TÂCHE A — facture sans numéro : revue manuelle, aucune écriture facture/scan.
          await emailRef.update({
            status: "error",
            category: "invoice_a_revoir",
            analysisError: "TIMAC: num_facture absent — à revoir manuellement",
            timacInvoicePdfBase64: admin.firestore.FieldValue.delete(),
          });
          console.warn(`analyzeEmail TIMAC: ${emailId} → num_facture absent, à revoir manuellement`);
          return null;
        }

        if (result.status === "skipped") {
          await emailRef.update({
            status: "analyzed",
            category: "invoice",
            invoice_id: result.existing_id,
            timacInvoicePdfBase64: admin.firestore.FieldValue.delete(),
          });
          console.log(`analyzeEmail TIMAC: ${emailId} → duplicate of invoice ${result.existing_id} (numero_facture=${inv.num_facture}), skipped`);
          return null;
        }

        // result.status === 'created'
        await emailRef.update({
          status: "analyzed",
          category: "invoice",
          invoice_id: result.invoice_id,
          timacInvoicePdfBase64: admin.firestore.FieldValue.delete(),
        });
        console.log(`analyzeEmail TIMAC: ${emailId} → invoice ${result.invoice_id} (${result.numero}, numero_facture=${inv.num_facture}), ${(inv.lignes || []).length} line(s)`);
        return null;
      } else {
        // ---- Generic email analysis ----
        const textContent = emailData.textBody || "";
        const amountMatches = textContent.match(/[\d\s,.]+\s*(MAD|DH|EUR|USD|€|\$)/gi) || [];
        if (amountMatches.length > 0) {
          structuredData.amounts = amountMatches.map((m) => m.trim());
        }
        const dateMatches = textContent.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/g) || [];
        if (dateMatches.length > 0) {
          structuredData.dates = dateMatches;
        }

        const subjectLower = (emailData.subject || "").toLowerCase();
        const bodyLower = textContent.toLowerCase();
        const combinedText = subjectLower + " " + bodyLower;

        if (/commande|order|bon de commande|purchase/i.test(combinedText)) {
          category = "order";
        } else if (/facture|invoice|facturation/i.test(combinedText)) {
          category = "invoice";
        } else if (/rapport|report|estimation|quinzaine|bilan/i.test(combinedText)) {
          category = "report";
        } else if (/alerte|alert|notification|warning/i.test(combinedText)) {
          category = "notification";
        }

        const firstLines = textContent.split("\n").slice(0, 3).join(" ").slice(0, 200);
        summary = emailData.subject || firstLines || "Email sans contenu identifiable";
      }

      // 3. Write extraction result
      const extraction = {
        emailId,
        analyzedAt: new Date().toISOString(),
        category,
        summary,
        structuredData: {
          ...structuredData,
          tables: tables.map((t, i) => ({
            tableIndex: i,
            headers: t.headers,
            rowCount: t.rows.length,
            rows: t.rows.slice(0, 100).map(row => row.join(" | ")),
          })),
        },
        confidence: isDriscols ? "high" : (tables.length > 0 ? "medium" : "low"),
        expeditionId: expeditionId || null,
      };

      await db.collection("email_extractions").doc(emailId).set(extraction);
      await emailRef.update({ status: "analyzed" });

      console.log(`analyzeEmail: ${emailId} → category=${category}, tables=${tables.length}`);
    } catch (err) {
      console.error(`analyzeEmail error for ${emailId}:`, err.message);
      await emailRef.update({
        status: "error",
        analysisError: err.message,
      });
    }

    return null;
  });


// =============================================
// Function 3: emailAnalysis (HTTP API for dashboard)
// =============================================
exports.emailAnalysis = functions
  .region("europe-west1")
  .runWith({ timeoutSeconds: 300, memory: "512MB" })
  .https.onRequest(async (req, res) => {
    setCors(res, req);
    if (req.method === "OPTIONS") return res.status(204).send("");
    const authUser = await requireAuth(req, res);
    if (!authUser) return;

    const action = req.query.action || req.body?.action || "list";

    try {


      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });

      const __ctx = { req, res, authUser, action };
      for (const __handle of __actions) {
        const __r = await __handle(__ctx);
        if (__r !== NOT_HANDLED) return __r;
      }

    } catch (err) {
      console.error("emailAnalysis error:", err);
      return res.status(500).json({ success: false, error: err.message });
    }
  });


// Exported for manual import scripts (e.g. import-receipt-blue.js, diag)
module.exports.parseLiquidationXlsx = parseLiquidationXlsx;

module.exports.parseLiquidationSummaryPdf = parseLiquidationSummaryPdf;

module.exports.parseLiquidationSummaryText = parseLiquidationSummaryText;

module.exports.parseTimacInvoiceText = parseTimacInvoiceText;

module.exports.parseTimacInvoicePdf = parseTimacInvoicePdf;

module.exports.createTimacInvoiceFromParsed = createTimacInvoiceFromParsed;

module.exports.isTimacInvoice = isTimacInvoice;

module.exports.isLiquidationEmail = isLiquidationEmail;

module.exports.isDailyQualityReport = isDailyQualityReport;

module.exports.isWeeklyQualityReport = isWeeklyQualityReport;

module.exports.notifyNewAgqAnalyses = notifyNewAgqAnalyses;
