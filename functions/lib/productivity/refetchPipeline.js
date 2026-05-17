/**
 * Productivity Report — IMAP scan + parse + Firestore write pipeline.
 *
 * Callable from:
 *   - HTTP handler (action=refetch-productivity) for manual button + backfill
 *   - Scheduled function (cron 15 min) for near-real-time ingestion
 *
 * I/O injected via deps: db (Firestore), storage (bucket), imapClient factory,
 * simpleParser. This keeps the module testable with stubs.
 */

const { parseProductivityPdf, extractWeekAndCampaign } = require('./pdfParser');
const { enrichTreatments, buildFarmSummary } = require('./ranker');

/**
 * Run one scan cycle.
 *
 * @param {{
 *   imapClient: any,                  // already-connected ImapFlow instance
 *   simpleParser: Function,           // from mailparser
 *   db: any,                          // admin.firestore()
 *   bucket: any|null,                 // admin.storage().bucket(...) for PDF archive
 *   apiKey: string,                   // ANTHROPIC_API_KEY
 *   mailbox?: string,
 *   onlyNew?: boolean,                // if true, search UNSEEN only (for cron)
 *   maxEmails?: number,
 * }} deps
 * @returns {Promise<{processed:number, skipped:number, results:Array}>}
 */
async function refetchProductivityReports(deps) {
  const {
    imapClient, simpleParser, db, bucket, apiKey,
    mailbox = 'INBOX', onlyNew = false, maxEmails = 200,
  } = deps;

  await imapClient.mailboxOpen(mailbox);

  // Always search ALL matching emails (no `seen` filter): other crons in this
  // codebase (refetch-weekly-qr, refetch-quality, ...) read the same mailbox
  // and mark messages as seen, which would hide Productivity reports from us.
  // We rely on Firestore-level idempotency (skip if doc {campaign}_W{week} exists)
  // to keep cost low. `onlyNew` toggles whether we also skip the Firestore check
  // (backfill mode forces re-parsing of every email).
  const searchResults = await imapClient.search({ subject: 'Grower productivity report' });
  console.log(`refetchProductivity: ${searchResults.length} candidate emails (onlyNew=${onlyNew})`);

  if (searchResults.length === 0) return { processed: 0, skipped: 0, results: [] };

  const uids = searchResults.slice(-maxEmails);

  let processed = 0;
  let skipped = 0;
  const results = [];

  for await (const msg of imapClient.fetch(uids, { uid: true, source: true })) {
    try {
      const parsed = await simpleParser(msg.source);
      const subject = parsed.subject || '';
      const from = (parsed.from?.text || '').toLowerCase();

      // Accepted senders: Driscoll's directly, or forwards from internal team
      // (e.g. omar.maaouni@berrygood.ma transferring historical reports).
      const fromOk = /driscolls\.com/i.test(from) || /omar\.maaouni@berrygood\.ma/i.test(from);
      if (!fromOk) {
        skipped++;
        console.log(`refetchProductivity: SKIP uid=${msg.uid} reason=bad-sender from="${from}" subject="${subject}"`);
        continue;
      }
      if (!/grower\s+productivity\s+report/i.test(subject)) {
        skipped++;
        console.log(`refetchProductivity: SKIP uid=${msg.uid} reason=bad-subject subject="${subject}"`);
        continue;
      }

      const pdfAtt = (parsed.attachments || []).find(a => /\.pdf$/i.test(a.filename || ''));
      if (!pdfAtt || !pdfAtt.content) {
        skipped++;
        results.push({ uid: msg.uid, subject, status: 'no-pdf' });
        continue;
      }

      // Cheap pre-check (no Claude call): infer week/campaign from subject+filename.
      // If the corresponding doc already exists in Firestore, skip — this is what
      // makes the cron safe to run frequently without paying for repeat parses.
      const preMeta = extractWeekAndCampaign({
        subject, filename: pdfAtt.filename || '', text: '',
      });
      if (onlyNew && preMeta.week && preMeta.campaign) {
        const predictedId = `${preMeta.campaign.replace('/', '-')}_W${preMeta.week}`;
        const existing = await db.collection('productivity_reports').doc(predictedId).get();
        if (existing.exists) {
          skipped++;
          results.push({ uid: msg.uid, subject, status: 'already-stored', docId: predictedId });
          continue;
        }
      }

      const parsedPdf = await parseProductivityPdf(pdfAtt.content, {
        subject, filename: pdfAtt.filename || '', apiKey,
      });

      const { week, campaign } = parsedPdf;
      if (!week || !campaign) {
        results.push({ uid: msg.uid, subject, status: 'skip-no-week', week, campaign });
        skipped++;
        continue;
      }

      const enrichedTreatments = enrichTreatments(parsedPdf.treatments);
      const summary = buildFarmSummary(enrichedTreatments);

      const campaignSlug = campaign.replace('/', '-');
      const docId = `${campaignSlug}_W${week}`;

      let pdfStoragePath = null;
      if (bucket) {
        try {
          pdfStoragePath = `productivity/${docId}.pdf`;
          await bucket.file(pdfStoragePath).save(pdfAtt.content, {
            metadata: { contentType: 'application/pdf' },
          });
        } catch (e) {
          console.warn(`refetchProductivity: PDF upload failed: ${e.message}`);
        }
      }

      await db.collection('productivity_reports').doc(docId).set({
        campaign,
        week,
        receivedAt: parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
        parsedAt: new Date().toISOString(),
        sourceEmail: parsed.from?.text || '',
        sourceSubject: subject,
        sourceMessageId: parsed.messageId || null,
        sourceUid: msg.uid,
        pdfStoragePath,
        pdfFilename: pdfAtt.filename || null,
        parser: { model: parsedPdf.model, version: 1 },
        rawTextLength: parsedPdf.rawTextLength,
        parseWarnings: parsedPdf.parseWarnings,
        treatments: enrichedTreatments,
        summary,
      }, { merge: false });

      processed++;
      results.push({
        uid: msg.uid, subject, status: 'ok', docId,
        treatmentsCount: enrichedTreatments.length, week, campaign,
      });
      console.log(`refetchProductivity: Stored ${docId} (${enrichedTreatments.length} treatments)`);
    } catch (err) {
      console.error(`refetchProductivity: UID ${msg.uid} error: ${err.message}`);
      results.push({ uid: msg.uid, status: 'error', error: err.message });
    }
  }

  return { processed, skipped, results };
}

module.exports = { refetchProductivityReports };
