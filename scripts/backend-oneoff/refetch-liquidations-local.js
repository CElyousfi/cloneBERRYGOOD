// Local script: re-fetch historical LIQUIDATION emails via IMAP and store them as
// pending email docs in Firestore. The deployed analyzeEmail Cloud Function
// (onCreate trigger) will automatically parse them via the updated parseLiquidationXlsx.
//
// Usage: node functions/refetch-liquidations-local.js
//
// Requires:
//   - functions/.env with IMAP_HOST/IMAP_PORT/IMAP_USER/IMAP_PASSWORD/IMAP_MAILBOX
//   - gcloud ADC set up (gcloud auth application-default login)

require("dotenv").config({ path: require("path").join(__dirname, "../../functions/.env") });

const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

function createImapClient() {
  return new ImapFlow({
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || "993"),
    secure: process.env.IMAP_TLS !== "false",
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false,
  });
}

function isLiquidationEmail(_from, subject) {
  return /l?iquidation/i.test(subject || "");
}

async function main() {
  const client = createImapClient();
  let processed = 0;

  try {
    await client.connect();
    await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

    const searchResults = await client.search({ or: [{ subject: "LIQUIDATION" }, { subject: "IQUIDATION" }] });
    console.log(`Found ${searchResults.length} candidate email(s) in IMAP`);
    if (searchResults.length === 0) {
      await client.logout();
      return;
    }

    for await (const msg of client.fetch(searchResults, { uid: true, source: true })) {
      try {
        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject || "";
        if (!isLiquidationEmail(null, subject)) continue;
        if (!parsed.attachments || parsed.attachments.length === 0) continue;

        const xlsAttachments = parsed.attachments.filter(
          (a) => /\.(xlsx|xls)$/i.test(a.filename || "") && a.content
        );
        const emlAttachments = parsed.attachments.filter(
          (a) => (a.filename || "").toLowerCase().endsWith(".eml") ||
                 (a.contentType || "").includes("message/rfc822")
        );

        // Bulk .eml wrapper path
        if (emlAttachments.length > 0) {
          console.log(`BULK "${subject}" — ${emlAttachments.length} .eml`);
          let innerCount = 0;
          for (const emlAtt of emlAttachments) {
            try {
              const innerParsed = await simpleParser(emlAtt.content);
              const innerSubject = innerParsed.subject || "(sans sujet)";
              if (!innerParsed.attachments || innerParsed.attachments.length === 0) continue;
              const innerXls = innerParsed.attachments.filter(
                (a) => /\.(xlsx|xls)$/i.test(a.filename || "") && a.content
              );
              if (innerXls.length === 0) continue;

              const innerLiqPdfAtt = innerParsed.attachments.find(
                (a) => /\.pdf$/i.test(a.filename || "") && /LIQUIDATION/i.test(a.filename || "") && a.content
              );
              const innerLiqPdf = innerLiqPdfAtt ? innerLiqPdfAtt.content.toString("base64") : null;

              for (let xi = 0; xi < innerXls.length; xi++) {
                const xls = innerXls[xi];
                const innerDocId = (innerParsed.messageId || `bulk-liq-${msg.uid}-${innerCount}-${xi}`)
                  .replace(/[^a-zA-Z0-9_-]/g, "_")
                  .slice(0, 200);

                const existingDoc = db.collection("emails").doc(innerDocId);
                const existingSnap = await existingDoc.get();
                if (existingSnap.exists) {
                  await existingDoc.delete();
                  await db.collection("email_extractions").doc(innerDocId).delete().catch(() => {});
                  // Give Firestore a moment so onCreate fires on the re-creation
                  await new Promise((r) => setTimeout(r, 400));
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
                  isLiquidation: true,
                  bulkParentUid: msg.uid,
                  status: "pending",
                  analysisError: null,
                  extractedTablesRaw: [],
                });

                processed++;
                console.log(`  ↳ inner "${innerSubject}" — ${xls.filename} (${xls.size} bytes)${innerLiqPdf ? ' + LIQ.pdf' : ''}`);
              }
              innerCount++;
            } catch (innerErr) {
              console.error(`  inner .eml parse error: ${innerErr.message}`);
            }
          }
          continue;
        }

        // Direct XLS attachment path
        if (xlsAttachments.length === 0) continue;
        const baseDocId = (parsed.messageId || `uid-${msg.uid}`).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);

        const directLiqPdfAtt = parsed.attachments.find(
          (a) => /\.pdf$/i.test(a.filename || "") && /LIQUIDATION/i.test(a.filename || "") && a.content
        );
        const directLiqPdf = directLiqPdfAtt ? directLiqPdfAtt.content.toString("base64") : null;

        for (let idx = 0; idx < xlsAttachments.length; idx++) {
          const xls = xlsAttachments[idx];
          const docId = xlsAttachments.length === 1 ? baseDocId : `${baseDocId}_att${idx}`;

          const existingDoc = db.collection("emails").doc(docId);
          const existingSnap = await existingDoc.get();
          if (existingSnap.exists) {
            await existingDoc.delete();
            await db.collection("email_extractions").doc(docId).delete().catch(() => {});
            await new Promise((r) => setTimeout(r, 400));
          }

          await db.collection("emails").doc(docId).set({
            messageId: parsed.messageId || `uid-${msg.uid}`,
            uid: msg.uid,
            from: parsed.from?.text || "",
            fromName: parsed.from?.value?.[0]?.name || "",
            to: parsed.to?.text || "",
            subject: `${subject} [${xls.filename || `att${idx}`}]`,
            date: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
            receivedAt: new Date().toISOString(),
            textBody: (parsed.text || "").slice(0, 50000),
            htmlBody: (parsed.html || "").slice(0, 100000),
            hasAttachments: true,
            attachments: [{ filename: xls.filename || "unknown", contentType: xls.contentType || "application/octet-stream", size: xls.size || 0 }],
            xlsxBase64: xls.content.toString("base64"),
            liqSummaryPdfBase64: directLiqPdf,
            isLiquidation: true,
            status: "pending",
            analysisError: null,
            extractedTablesRaw: [],
          });

          processed++;
          console.log(`  ↳ "${subject}" — ${xls.filename} (${xls.size} bytes)${directLiqPdf ? ' + LIQ.pdf' : ''}`);
        }
      } catch (parseErr) {
        console.error(`UID ${msg.uid} parse error: ${parseErr.message}`);
      }
    }
  } finally {
    try { await client.logout(); } catch (_) { /* ignore */ }
  }

  console.log(`\nDone. ${processed} liquidation attachment(s) queued for re-analysis.`);
  console.log(`The deployed analyzeEmail Cloud Function will process them automatically.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
