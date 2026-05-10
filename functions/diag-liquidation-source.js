// Diagnostic: dump a real Driscoll's liquidation email to /tmp/liq-diag/
// - body.html / body.txt — full bodies
// - attachments.json — list of all attachments (not just XLS)
// - RECEIPT.xls — the first XLS attachment binary
// - xls-dump.txt — all rows of all sheets (no filtering)
// - html-tables.json — all <table>s extracted via cheerio
// - tables_firestore.json — extractedTablesRaw from the matching Firestore email doc
//
// Usage: node functions/diag-liquidation-source.js
// Defaults: picks the most recent "LIQUIDATION RASP" email in IMAP

require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const fs = require("fs");
const path = require("path");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const XLSX = require("xlsx");
const cheerio = require("cheerio");
const admin = require("firebase-admin");

admin.initializeApp({
  projectId: "berrygood-farms-dashboard",
  credential: admin.credential.applicationDefault(),
});
const db = admin.firestore();

const OUT_DIR = "/tmp/liq-diag";

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function parseHtmlTables(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const tables = [];
  $("table").each((_i, t) => {
    const headers = [];
    const firstRow = $(t).find("tr").first();
    const headerCells = firstRow.find("th");
    if (headerCells.length > 0) {
      headerCells.each((_j, c) => headers.push($(c).text().trim()));
    } else {
      firstRow.find("td").each((_j, c) => headers.push($(c).text().trim()));
    }
    const rows = [];
    $(t).find("tr").each((idx, tr) => {
      if (headerCells.length > 0 && idx === 0) return;
      if (headerCells.length === 0 && idx === 0) return;
      const row = [];
      $(tr).find("td, th").each((_k, c) => row.push($(c).text().trim()));
      if (row.some((v) => v)) rows.push(row);
    });
    tables.push({ headers, rows });
  });
  return tables;
}

async function main() {
  ensureDir(OUT_DIR);

  const client = new ImapFlow({
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || "993"),
    secure: process.env.IMAP_TLS !== "false",
    auth: { user: process.env.IMAP_USER, pass: process.env.IMAP_PASSWORD },
    logger: false,
  });

  await client.connect();
  await client.mailboxOpen(process.env.IMAP_MAILBOX || "INBOX");

  // Find the most recent direct-attachment liquidation email (not a .eml bulk wrapper)
  const results = await client.search({ subject: "LIQUIDATION RASP" });
  console.log(`IMAP search: ${results.length} matches`);
  if (results.length === 0) {
    await client.logout();
    console.error("No LIQUIDATION RASP email found in IMAP");
    process.exit(1);
  }
  // Sort desc and try each until we find one with a direct RECEIPT.xls attachment
  // (or ascending if ARG_OLD=1 — useful to fetch the oldest for locale diff checking)
  if (process.env.ARG_OLD === "1") results.sort((a, b) => a - b);
  else results.sort((a, b) => b - a);

  let picked = null;
  for (const uid of results) {
    let msg = null;
    for await (const m of client.fetch([uid], { uid: true, source: true })) {
      msg = m; break;
    }
    if (!msg) continue;
    const parsed = await simpleParser(msg.source);
    const xls = (parsed.attachments || []).find(
      (a) => /\.(xlsx|xls)$/i.test(a.filename || "") && a.content
    );
    if (xls) {
      picked = { uid, parsed, xls };
      break;
    }
  }
  await client.logout();

  if (!picked) {
    console.error("No liquidation email with a direct XLS attachment found (only .eml bulk wrappers).");
    process.exit(1);
  }

  const { uid, parsed, xls } = picked;
  console.log(`Picked UID ${uid}: "${parsed.subject}" — attachment ${xls.filename} (${xls.size} bytes)`);

  // 1. Write body + attachments + XLS binary
  fs.writeFileSync(path.join(OUT_DIR, "body.html"), parsed.html || "");
  fs.writeFileSync(path.join(OUT_DIR, "body.txt"), parsed.text || "");
  fs.writeFileSync(
    path.join(OUT_DIR, "attachments.json"),
    JSON.stringify(
      (parsed.attachments || []).map((a) => ({
        filename: a.filename || null,
        contentType: a.contentType || null,
        size: a.size || null,
        contentDisposition: a.contentDisposition || null,
      })),
      null,
      2
    )
  );
  fs.writeFileSync(path.join(OUT_DIR, "RECEIPT.xls"), xls.content);

  // 1b. Save all PDF attachments (they often contain the financial summary)
  const pdfs = (parsed.attachments || []).filter(
    (a) => /\.pdf$/i.test(a.filename || "") && a.content
  );
  for (const pdf of pdfs) {
    const safe = pdf.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    fs.writeFileSync(path.join(OUT_DIR, safe), pdf.content);
  }
  console.log(`  saved ${pdfs.length} PDF attachment(s)`);

  // Parse PDFs via PDFParse (already used in emailService for Weekly Quality Report)
  try {
    const { PDFParse } = require("pdf-parse");
    for (const pdf of pdfs) {
      const p = new PDFParse({ data: pdf.content });
      const r = await p.getText();
      const safe = pdf.filename.replace(/[^a-zA-Z0-9._-]/g, "_") + ".txt";
      fs.writeFileSync(path.join(OUT_DIR, safe), r.text || "");
    }
  } catch (e) {
    // pdf-parse not installed with that name — try alt
    try {
      const pdfParse = require("pdf-parse");
      for (const pdf of pdfs) {
        const r = await pdfParse(pdf.content);
        const safe = pdf.filename.replace(/[^a-zA-Z0-9._-]/g, "_") + ".txt";
        fs.writeFileSync(path.join(OUT_DIR, safe), r.text || "");
      }
    } catch (e2) {
      console.warn("PDF text extraction failed:", e2.message);
    }
  }

  // 2. Full XLS dump — every sheet, every row, no filtering
  const wb = XLSX.read(xls.content, { type: "buffer" });
  const dumpLines = [];
  dumpLines.push(`Workbook: ${xls.filename}`);
  dumpLines.push(`Sheets: ${wb.SheetNames.join(", ")}`);
  for (const name of wb.SheetNames) {
    const sh = wb.Sheets[name];
    const range = sh["!ref"] || "(empty)";
    dumpLines.push(`\n===== Sheet: "${name}" range: ${range} =====`);
    const rows = XLSX.utils.sheet_to_json(sh, { header: 1, defval: "" });
    rows.forEach((r, i) => {
      dumpLines.push(`${i}: ${JSON.stringify(r)}`);
    });
  }
  fs.writeFileSync(path.join(OUT_DIR, "xls-dump.txt"), dumpLines.join("\n"));

  // 3. HTML tables
  const htmlTables = parseHtmlTables(parsed.html || "");
  fs.writeFileSync(path.join(OUT_DIR, "html-tables.json"), JSON.stringify(htmlTables, null, 2));

  // 4. Firestore extractedTablesRaw for matching email docs
  const messageId = parsed.messageId || `uid-${uid}`;
  const snap = await db
    .collection("emails")
    .where("uid", "==", uid)
    .limit(5)
    .get();
  const fsTables = [];
  snap.forEach((d) => {
    const x = d.data();
    fsTables.push({
      docId: d.id,
      subject: x.subject,
      extractedTablesRaw: x.extractedTablesRaw || [],
    });
  });
  fs.writeFileSync(path.join(OUT_DIR, "tables_firestore.json"), JSON.stringify(fsTables, null, 2));

  console.log(`\nDiag dumped to ${OUT_DIR}:`);
  for (const f of fs.readdirSync(OUT_DIR)) {
    const s = fs.statSync(path.join(OUT_DIR, f));
    console.log(`  ${f} (${s.size} bytes)`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
