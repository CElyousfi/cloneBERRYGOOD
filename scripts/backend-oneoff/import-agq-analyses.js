// One-shot backfill script for AGQ Labs analytical reports.
//
// Firestore modes (reads from the `emails` collection populated by fetchEmails):
//   node import-agq-analyses.js --email-id <firestore-email-doc-id>
//   node import-agq-analyses.js --subject "ANALYSES FOLIAIRES"
//   node import-agq-analyses.js --uid <imap-uid>
//
// IMAP mode (re-fetches directly from the mailbox — needed for emails ingested
// before the AGQ detection was deployed, since their PDFs were never stored):
//   node import-agq-analyses.js --imap-uid 287
//   node import-agq-analyses.js --imap-uid 282,287
//
// Flags:
//   --dry-run   parse & classify but don't write to Firestore/Storage
//
// Env: GOOGLE_APPLICATION_CREDENTIALS for Firestore; IMAP_HOST/IMAP_USER/... for IMAP.

require("dotenv").config();
const admin = require("firebase-admin");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: "berrygood-farms-dashboard",
    credential: admin.credential.applicationDefault(),
  });
}

const db = admin.firestore();
// Match the bucket used by functions/config/firebase.js so scan_resultat_url
// points at the same place as manually-created analyses.
const bucket = admin.storage().bucket("berrygood-farms-photos");

const { parseAgqPdf } = require("../../functions/src/modules/agronomie/agqParser");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--email-id") args.emailId = argv[++i];
    else if (k === "--subject") args.subject = argv[++i];
    else if (k === "--uid") args.uid = parseInt(argv[++i], 10);
    else if (k === "--imap-uid") args.imapUids = argv[++i].split(",").map(s => parseInt(s.trim(), 10)).filter(Boolean);
    else if (k === "--dry-run") args.dryRun = true;
  }
  return args;
}

// Recursively walk a parsed email and every nested .eml attachment to collect
// all PDF attachments. Returns [{filename, content: Buffer, parentMessageId}]
async function collectPdfAttachments(parsed, parentMessageId = null) {
  const out = [];
  const atts = parsed.attachments || [];
  for (const att of atts) {
    const isPdf = /\.pdf$/i.test(att.filename || "") || (att.contentType || "").includes("pdf");
    const isEml = /\.eml$/i.test(att.filename || "") || (att.contentType || "").includes("message/rfc822");
    if (isPdf && att.content) {
      out.push({ filename: att.filename || "report.pdf", content: att.content, parentMessageId: parentMessageId || parsed.messageId || null });
    } else if (isEml && att.content) {
      try {
        const inner = await simpleParser(att.content);
        const nested = await collectPdfAttachments(inner, inner.messageId || parentMessageId);
        out.push(...nested);
      } catch (e) {
        console.warn(`[WARN .eml parse] ${att.filename}: ${e.message}`);
      }
    }
  }
  return out;
}

function createImapClient() {
  return new ImapFlow({
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || "993"),
    secure: process.env.IMAP_TLS !== "false",
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false,
  });
}

async function fetchByImapUid(uids) {
  if (!process.env.IMAP_USER || !process.env.IMAP_HOST) {
    throw new Error("IMAP_HOST/IMAP_USER/IMAP_PASSWORD not set in env (check functions/.env).");
  }
  const client = createImapClient();
  const results = [];
  try {
    await client.connect();
    await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");
    for (const uid of uids) {
      const messages = [];
      for await (const msg of client.fetch({ uid: `${uid}` }, { uid: true, envelope: true, source: true })) {
        if (msg.uid !== uid) continue;
        messages.push(msg);
      }
      if (!messages.length) {
        console.warn(`[WARN] IMAP UID ${uid} not found`);
        continue;
      }
      const parsed = await simpleParser(messages[0].source);
      const pdfs = await collectPdfAttachments(parsed);
      results.push({
        imapUid: uid,
        messageId: parsed.messageId || `uid-${uid}`,
        subject: parsed.subject || "",
        from: parsed.from?.text || "",
        date: parsed.date ? parsed.date.toISOString() : null,
        pdfs,
      });
      console.log(`[IMAP] UID ${uid}: "${parsed.subject}" — ${pdfs.length} PDF(s) collected (incl. nested)`);
    }
  } finally {
    try { await client.logout(); } catch (_) {}
  }
  return results;
}

async function findEmails(args) {
  if (args.emailId) {
    const snap = await db.collection("emails").doc(args.emailId).get();
    return snap.exists ? [{ id: snap.id, data: snap.data() }] : [];
  }
  if (args.uid) {
    const snap = await db.collection("emails").where("uid", "==", args.uid).get();
    return snap.docs.map(d => ({ id: d.id, data: d.data() }));
  }
  if (args.subject) {
    // Firestore has no ILIKE — pull recent AGQ flagged emails and filter client-side.
    const snap = await db.collection("emails").where("isAgqAnalysis", "==", true).get();
    return snap.docs
      .map(d => ({ id: d.id, data: d.data() }))
      .filter(e => (e.data.subject || "").toLowerCase().includes(args.subject.toLowerCase()));
  }
  // No filter: grab every AGQ email with unprocessed attachments still inline.
  const snap = await db.collection("emails").where("isAgqAnalysis", "==", true).get();
  return snap.docs.map(d => ({ id: d.id, data: d.data() }));
}

async function isDuplicate(messageId, filename) {
  if (!messageId || !filename) return false;
  const snap = await db.collection("analyses_foliaires")
    .where("source_email.messageId", "==", messageId)
    .where("source_email.attachment_name", "==", filename)
    .limit(1)
    .get();
  return !snap.empty;
}

async function importPdf(source, filename, pdfBuffer, dryRun) {
  // source: { messageId, subject, from, date }
  const messageId = source.messageId || null;

  if (messageId && filename && await isDuplicate(messageId, filename)) {
    console.log(`[SKIP dup] ${filename}`);
    return { status: "skipped" };
  }

  let parsed;
  try {
    parsed = await parseAgqPdf(pdfBuffer, {
      subject: source.subject || "",
      attachmentName: filename,
    });
  } catch (e) {
    console.log(`[ERR parse] ${filename}: ${e.message}`);
    return { status: "error", error: e.message };
  }

  if (parsed.skip === "out_of_scope_template") {
    console.log(`[SKIP out-of-scope] ${filename}: ${parsed.reason}`);
    return { status: "skipped", reason: "out_of_scope" };
  }
  if (parsed.skip === "unknown_template") {
    console.log(`[SKIP unknown] ${filename}: ${parsed.reason}`);
    return { status: "skipped", reason: "unknown_template" };
  }

  if (!parsed.ferme) {
    console.log(`[SKIP no-ferme] ${filename}: description="${parsed.description_raw || parsed.propriete_raw}"`);
    return { status: "skipped", reason: "no-ferme", parsed };
  }

  if (dryRun) {
    console.log(`[DRY] ${filename} → ferme=${parsed.ferme} variete=${parsed.variete} type=${parsed.type_analyse} date=${parsed.date_analyse ? new Date(parsed.date_analyse).toISOString().slice(0,10) : "?"}`);
    return { status: "dry" };
  }

  const now = Date.now();
  const receivedAt = source.date ? new Date(source.date).getTime() : now;
  const analyseData = {
    numero: null,
    ferme: parsed.ferme,
    parcelle: null,
    culture: parsed.culture,
    type_analyse: parsed.type_analyse,
    variete: parsed.variete,
    template_type: parsed.template || null,
    propriete_raw: parsed.propriete_raw || null,
    terrain_raw: parsed.terrain_raw || null,
    client_raw: parsed.client_raw || null,
    description_raw: parsed.description_raw || null,
    type_echantillon_raw: parsed.type_echantillon_raw || null,
    phenologie: parsed.phenologie || null,
    parsed_values: parsed.parsed_values || {},
    parsed_header_line: parsed.parsed_header_line || null,
    source: "email_agq",
    source_email: {
      messageId,
      subject: source.subject || null,
      from: source.from || null,
      received_at: receivedAt,
      attachment_name: filename,
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
    history: [{ action: "import_email_agq_script", by: { name: "backfill" }, at: now, comment: filename }],
    created_by: { name: "backfill" },
    created_at: now,
    updated_at: now,
  };

  const ref = await db.collection("analyses_foliaires").add(analyseData);

  try {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `analyses_foliaires/${ref.id}/${safeName}`;
    const file = bucket.file(storagePath);
    await file.save(pdfBuffer, { metadata: { contentType: "application/pdf" } });
    const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
    await ref.update({ scan_resultat_url: url });
  } catch (e) {
    console.warn(`[WARN upload] ${filename}: ${e.message}`);
  }

  console.log(`[OK]       ${filename} → ${parsed.ferme} ${parsed.variete || ""} ${parsed.type_analyse} (doc ${ref.id})`);
  return { status: "ok", id: ref.id };
}

(async () => {
  const args = parseArgs(process.argv);
  console.log("Backfill AGQ analyses — args:", args);

  let totalOk = 0, totalSkip = 0, totalErr = 0;

  if (args.imapUids && args.imapUids.length > 0) {
    // IMAP mode — re-fetch messages by UID, recurse into .eml, parse PDFs.
    const emails = await fetchByImapUid(args.imapUids);
    for (const email of emails) {
      console.log(`\n[imap uid ${email.imapUid}] "${email.subject}" — ${email.pdfs.length} PDF(s)`);
      for (const pdf of email.pdfs) {
        // For nested .eml, use the inner email's messageId to keep idempotence stable.
        const source = {
          messageId: pdf.parentMessageId || email.messageId,
          subject: email.subject,
          from: email.from,
          date: email.date,
        };
        const r = await importPdf(source, pdf.filename, pdf.content, args.dryRun);
        if (r.status === "ok") totalOk++;
        else if (r.status === "skipped") totalSkip++;
        else if (r.status === "error") totalErr++;
      }
    }
  } else {
    // Firestore mode — read pre-extracted agqPdfAttachments from email docs.
    const emails = await findEmails(args);
    if (emails.length === 0) {
      console.log("No matching emails found.");
      process.exit(0);
    }
    console.log(`Found ${emails.length} email(s) in Firestore`);
    for (const email of emails) {
      const atts = email.data.agqPdfAttachments || [];
      if (atts.length === 0) {
        console.log(`[email ${email.id}] no agqPdfAttachments stored — use --imap-uid ${email.data.uid} to re-fetch`);
        continue;
      }
      console.log(`\n[email ${email.id}] "${email.data.subject}" — ${atts.length} PDF(s)`);
      const source = { messageId: email.data.messageId || email.id, subject: email.data.subject, from: email.data.from, date: email.data.date };
      for (const att of atts) {
        const buf = Buffer.from(att.contentBase64, "base64");
        const r = await importPdf(source, att.filename, buf, args.dryRun);
        if (r.status === "ok") totalOk++;
        else if (r.status === "skipped") totalSkip++;
        else if (r.status === "error") totalErr++;
      }
    }
  }

  console.log(`\nDone. OK=${totalOk} SKIP=${totalSkip} ERR=${totalErr}`);
  process.exit(0);
})().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
